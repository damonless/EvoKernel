import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

import { buildUiSnapshot } from '../cli/ui.js';
import type { UiSnapshot } from '../cli/ui.js';
import { renderUiClientHtml } from '../templates/ui-client.js';
import { EvoStorage, estimateTokens, findNearestEvoWorkspace, parseFrontmatter, sanitizeId } from '../core/storage.js';
import type { ConfidenceLevel, EvoKind, ProposalPayload, SymbolFingerprint } from '../core/types.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';
import {
  clearMemoryVerificationCache,
  extractSymbolFingerprint,
  parseSymbolTarget,
  resolveCurrentGitBranch,
  resolveCurrentGitCommit,
  verifyMemoryFreshness,
} from '../core/memory.js';
import { executeSandboxedScriptAsync } from '../core/sandbox.js';
import { syncManagedRuleBlocks } from '../cli/init.js';
import { isSubpathOf } from '../mcp/handlers.js';

// --- Ambient Structural Types for VS Code API (Zero Runtime Dependencies) ---
export interface VsCodePosition {
  readonly line: number;
  readonly character: number;
}

export interface VsCodeRange {
  readonly start: VsCodePosition;
  readonly end: VsCodePosition;
}

export interface VsCodeSelection extends VsCodeRange {
  readonly anchor: VsCodePosition;
  readonly active: VsCodePosition;
}

export interface VsCodeUri {
  readonly fsPath: string;
  readonly scheme: string;
  readonly path: string;
  toString(): string;
}

export interface VsCodeTextDocument {
  readonly uri: VsCodeUri;
  readonly fileName: string;
  readonly lineCount: number;
  getText(range?: VsCodeRange): string;
}

export interface VsCodeTextEditor {
  readonly document: VsCodeTextDocument;
  selection: VsCodeSelection;
  readonly selections: readonly VsCodeSelection[];
  revealRange(range: VsCodeRange, revealType?: number): void;
}

export interface VsCodeWebviewOptions {
  enableScripts?: boolean;
  localResourceRoots?: readonly VsCodeUri[];
}

export interface VsCodeWebviewPanelOptions {
  retainContextWhenHidden?: boolean;
  enableFindWidget?: boolean;
}

export interface VsCodeWebview {
  html: string;
  options: VsCodeWebviewOptions;
  readonly onDidReceiveMessage: (listener: (e: any) => any, thisArgs?: any, disposables?: any[]) => { dispose(): any };
  postMessage(message: any): Promise<boolean> | Thenable<boolean>;
  asWebviewUri(localResource: VsCodeUri): VsCodeUri;
}

export interface VsCodeWebviewPanel {
  readonly viewType: string;
  title: string;
  readonly webview: VsCodeWebview;
  readonly visible: boolean;
  readonly active: boolean;
  reveal(viewColumn?: number, preserveFocus?: boolean): void;
  dispose(): any;
  readonly onDidDispose: (listener: () => any, thisArgs?: any, disposables?: any[]) => { dispose(): any };
  readonly onDidChangeViewState: (listener: (e: any) => any, thisArgs?: any, disposables?: any[]) => { dispose(): any };
}

export interface VsCodeWorkspaceFolder {
  readonly uri: VsCodeUri;
  readonly name: string;
  readonly index: number;
}

export interface VsCodeExtensionContext {
  readonly subscriptions: { dispose(): any }[];
  readonly extensionUri?: VsCodeUri;
  readonly extensionPath?: string;
  readonly workspaceState?: any;
  readonly globalState?: any;
}

export interface VsCodeApi {
  window: {
    createWebviewPanel(
      viewType: string,
      title: string,
      showOptions: number | { viewColumn: number; preserveFocus?: boolean },
      options?: VsCodeWebviewOptions & VsCodeWebviewPanelOptions
    ): VsCodeWebviewPanel;
    showTextDocument(
      document: VsCodeTextDocument,
      options?: { selection?: VsCodeRange | VsCodeSelection; viewColumn?: number; preserveFocus?: boolean; preview?: boolean }
    ): Promise<VsCodeTextEditor> | Thenable<VsCodeTextEditor>;
    showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> | Thenable<string | undefined>;
    showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> | Thenable<string | undefined>;
    showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> | Thenable<string | undefined>;
    activeTextEditor?: VsCodeTextEditor;
  };
  workspace: {
    readonly workspaceFolders?: readonly VsCodeWorkspaceFolder[];
    openTextDocument(uri: VsCodeUri | string): Promise<VsCodeTextDocument> | Thenable<VsCodeTextDocument>;
    getWorkspaceFolder(uri: VsCodeUri): VsCodeWorkspaceFolder | undefined;
  };
  commands: {
    registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any): { dispose(): any };
    executeCommand<T>(command: string, ...rest: any[]): Promise<T> | Thenable<T>;
  };
  Uri: {
    file(path: string): VsCodeUri;
    parse(uri: string): VsCodeUri;
  };
  Position: new (line: number, character: number) => VsCodePosition;
  Selection: new (anchor: VsCodePosition, active: VsCodePosition) => VsCodeSelection;
  Range?: new (start: VsCodePosition, end: VsCodePosition) => VsCodeRange;
  ViewColumn?: {
    Active: -1;
    Beside: -2;
    One: 1;
    Two: 2;
    Three: 3;
  };
}

const req = createRequire(import.meta.url);

export function resolveVsCode(injected?: any): any {
  if (injected) return injected;
  if ((globalThis as any).vscode) return (globalThis as any).vscode;
  try {
    return req('vscode');
  } catch {
    return null;
  }
}

export function resolveActiveWorkspaceRoot(vscode: any, fallbackCwd: string = process.cwd()): string {
  const activeDocUri = vscode?.window?.activeTextEditor?.document?.uri;
  if (activeDocUri && (activeDocUri.scheme === 'file' || activeDocUri.fsPath)) {
    const folder = vscode.workspace?.getWorkspaceFolder?.(activeDocUri);
    if (folder) {
      const folderPath = folder.uri?.fsPath || folder.fsPath;
      if (folderPath) {
        const nearest = findNearestEvoWorkspace(folderPath);
        if (nearest) return nearest;
        return folderPath;
      }
    }
  }

  const folders = vscode?.workspace?.workspaceFolders;
  if (folders && folders.length > 0) {
    for (const f of folders) {
      const fsPath = f.uri?.fsPath || f.fsPath;
      if (fsPath && fs.existsSync(path.join(fsPath, '.evo'))) {
        return fsPath;
      }
    }
    // Check immediate subdirectories if parent directory was opened
    for (const f of folders) {
      const fsPath = f.uri?.fsPath || f.fsPath;
      if (fsPath) {
        try {
          const entries = fs.readdirSync(fsPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const childPath = path.join(fsPath, entry.name);
              if (fs.existsSync(path.join(childPath, '.evo'))) {
                return childPath;
              }
            }
          }
        } catch {}
      }
    }
    const firstPath = folders[0].uri?.fsPath || folders[0].fsPath;
    if (firstPath) {
      const nearest = findNearestEvoWorkspace(firstPath);
      if (nearest) return nearest;
      return firstPath;
    }
  }

  const nearestCwd = findNearestEvoWorkspace(fallbackCwd);
  if (nearestCwd) return nearestCwd;

  return fallbackCwd;
}

export function buildSecuredWebviewHtml(snapshot: UiSnapshot): string {
  let html = renderUiClientHtml(snapshot, { token: '', isExport: false, anon: false });
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const scriptContent = scriptMatch[1].replace(/\r\n/g, '\n');
    const hash = crypto.createHash('sha256').update(scriptContent, 'utf8').digest('base64');
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; connect-src 'none'; img-src data:;">`;
    html = html.replace('<head>', `<head>\n  ${csp}`);
  }
  return html;
}

export function renderWorkbenchHtml(workspaceRoot: string, options?: { anon?: boolean }): string {
  const snapshot = buildUiSnapshot(workspaceRoot, { anon: options?.anon });
  return buildSecuredWebviewHtml(snapshot);
}

export async function handleWebviewAction(
  action: string,
  params: any,
  ws: string,
  vscode: any
): Promise<{
  ok: boolean;
  data?: any;
  result?: any;
  snapshot?: any;
  tokenUsage?: number;
  error?: string;
  code?: string;
  details?: any;
}> {
  try {
    switch (action) {
      case 'open-editor': {
        const rawPath = typeof params?.filePath === 'string' ? params.filePath.trim() : '';
        if (!rawPath) return { ok: false, error: 'Bad Request: Missing or invalid filePath' };
        const targetPath = path.resolve(ws, rawPath);
        if (!isSubpathOf(ws, targetPath)) {
          return { ok: false, error: 'Forbidden: Path traversal outside workspace root' };
        }
        if (!fs.existsSync(targetPath)) {
          return { ok: false, error: `Not Found: File not found: ${rawPath}` };
        }

        const rawLine = params.line;
        const line = Math.max(
          1,
          typeof rawLine === 'number' && Number.isFinite(rawLine)
            ? Math.floor(rawLine)
            : parseInt(String(rawLine || 1), 10) || 1
        );

        const uri = vscode?.Uri?.file ? vscode.Uri.file(targetPath) : targetPath;
        const doc = await vscode.workspace.openTextDocument(uri);
        const line0 = line - 1;
        const pos =
          typeof vscode?.Position === 'function'
            ? new vscode.Position(line0, 0)
            : { line: line0, character: 0 };
        const selection =
          typeof vscode?.Selection === 'function'
            ? new vscode.Selection(pos, pos)
            : { anchor: pos, active: pos, start: pos, end: pos };

        await vscode.window.showTextDocument(doc, {
          selection,
          preview: false,
          viewColumn: vscode?.ViewColumn?.One ?? 1,
        });

        return {
          ok: true,
          data: { opened: targetPath, line, editor: 'vscode-api', launched: true },
        };
      }

      case 'verify-memory': {
        const storage = new EvoStorage(ws);
        const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
        let targetMemories = storage.listMemories();

        if (rawId) {
          const cleanId = sanitizeId(rawId);
          const mem = storage.getMemory(cleanId);
          if (!mem) return { ok: false, error: `Not Found: Memory "${cleanId}" not found` };
          targetMemories = [mem];
        }

        const dbPath = path.join(storage.cacheDir, 'telemetry.db');
        let cacheDb: DatabaseSync | undefined;
        try {
          if (fs.existsSync(dbPath)) cacheDb = new DatabaseSync(dbPath, { readOnly: true });
          const updatedItems = targetMemories.map((m) => {
            const v = verifyMemoryFreshness(ws, m, { includeCallers: true, cacheDb });
            const callers = Array.from(new Set((v.topology_anchors || []).flatMap((a: any) => a.callers || [])));
            return { ...m, freshness: { ...v, callers } };
          });

          const snapshot = buildUiSnapshot(ws, { cacheDb });
          return {
            ok: true,
            snapshot,
            data: { verifiedCount: updatedItems.length, memories: updatedItems, snapshot },
          };
        } finally {
          if (cacheDb) try { cacheDb.close(); } catch {}
        }
      }

      case 'run-tool-test': {
        const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
        if (!rawId) return { ok: false, error: 'Bad Request: Missing tool id' };
        const cleanId = sanitizeId(rawId);

        const storage = new EvoStorage(ws);
        const tool = storage.getTool(cleanId);
        if (!tool) return { ok: false, error: `Not Found: Tool "${cleanId}" not found` };
        if (!fs.existsSync(tool.script_path)) {
          return { ok: false, error: `Not Found: Tool script "${tool.script_path}" not found` };
        }

        const execResult = await executeSandboxedScriptAsync(
          tool.runtime,
          tool.script_path,
          {},
          { selfTest: true, timeoutMs: 5000, workspaceRoot: ws }
        );

        return {
          ok: true,
          result: {
            exitCode: execResult.exitCode,
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            durationMs: execResult.durationMs,
            timedOut: execResult.timedOut,
          },
          data: {
            id: tool.id,
            exitCode: execResult.exitCode,
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            durationMs: execResult.durationMs,
            timedOut: execResult.timedOut,
          },
        };
      }

      case 'archive-item': {
        const rawKind = typeof params?.kind === 'string' ? params.kind.trim().toLowerCase() : '';
        const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
        if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind)) {
          return { ok: false, error: `Bad Request: Invalid kind "${rawKind}". Must be rule|skill|tool|memory` };
        }
        if (!rawId) return { ok: false, error: 'Bad Request: Missing item id' };

        const cleanId = sanitizeId(rawId);
        const reason =
          typeof params.reason === 'string' && params.reason.trim()
            ? params.reason.trim()
            : 'Archived via EvoKernel Workbench 2.0';

        const storage = new EvoStorage(ws);
        const archived = storage.archiveCapability(cleanId, rawKind as EvoKind, reason);
        if (!archived) return { ok: false, error: `Not Found: ${rawKind} "${cleanId}" not found` };

        if (rawKind === 'rule') {
          syncManagedRuleBlocks(ws);
        }

        const telem = new EvoTelemetry(storage);
        try { telem.syncFromDisk(true); } finally { telem.close(); }

        const snapshot = buildUiSnapshot(ws);
        return {
          ok: true,
          snapshot,
          data: { archived: { kind: rawKind, id: cleanId }, reason, snapshot },
        };
      }

      case 'restore-item': {
        const rawKind = typeof params?.kind === 'string' ? params.kind.trim().toLowerCase() : '';
        const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
        if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind)) {
          return { ok: false, error: `Bad Request: Invalid kind "${rawKind}". Must be rule|skill|tool|memory` };
        }
        if (!rawId) return { ok: false, error: 'Bad Request: Missing item id' };

        const cleanId = sanitizeId(rawId);
        const storage = new EvoStorage(ws);
        const restored = storage.restoreCapability(cleanId, rawKind as EvoKind);
        if (!restored) {
          return { ok: false, error: `Not Found: Archived ${rawKind} "${cleanId}" not found` };
        }

        if (rawKind === 'rule') {
          syncManagedRuleBlocks(ws);
        }
        const telem = new EvoTelemetry(storage);
        try { telem.syncFromDisk(true); } finally { telem.close(); }

        const snapshot = buildUiSnapshot(ws);
        return {
          ok: true,
          snapshot,
          data: { restored: { kind: rawKind, id: cleanId }, snapshot },
        };
      }

      case 'toggle-enabled': {
        if (typeof params?.enabled !== 'boolean') {
          return { ok: false, error: 'Bad Request: Parameter "enabled" must be a boolean' };
        }
        const targetEnabled = params.enabled;
        const batchItems = Array.isArray(params.items)
          ? params.items
          : [{ kind: params.kind, id: params.id }];
        if (batchItems.length === 0) {
          return { ok: false, error: 'Bad Request: Missing target item(s)' };
        }

        const storage = new EvoStorage(ws);
        let touchedRules = false;
        let updatedCount = 0;
        const now = new Date().toISOString();

        for (const entry of batchItems) {
          const rawKind = typeof entry?.kind === 'string' ? entry.kind.trim().toLowerCase() : '';
          const rawId = typeof entry?.id === 'string' ? entry.id.trim() : '';
          if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind) || !rawId) {
            return { ok: false, error: 'Bad Request: Invalid kind or id in toggle-enabled' };
          }
          const cleanId = sanitizeId(rawId);
          if (rawKind === 'rule') {
            const rule = storage.getRule(cleanId);
            if (!rule) {
              if (batchItems.length === 1) return { ok: false, error: `Not Found: Rule "${cleanId}" not found` };
              continue;
            }
            if (targetEnabled && rule.core && rule.enabled === false) {
              const { totalTokens } = storage.getCoreRulesTokenUsage();
              const maxBudget = storage.getConfig()?.maxCoreRuleTokens ?? 1500;
              if (totalTokens + rule.tokens > maxBudget) {
                return {
                  ok: false,
                  error: `Bad Request: Core rule budget exceeded (${totalTokens + rule.tokens}/${maxBudget} tokens)`,
                  code: 'ERR_BUDGET_EXCEEDED',
                  details: { currentTokens: totalTokens, candidateTokens: rule.tokens, maxTokens: maxBudget },
                };
              }
            }
            storage.saveRule({ ...rule, enabled: targetEnabled, updated_at: now });
            touchedRules = true;
            updatedCount++;
          } else if (rawKind === 'skill') {
            const skill = storage.getSkill(cleanId);
            if (!skill) {
              if (batchItems.length === 1) return { ok: false, error: `Not Found: Skill "${cleanId}" not found` };
              continue;
            }
            storage.saveSkill({ ...skill, enabled: targetEnabled, updated_at: now });
            updatedCount++;
          } else if (rawKind === 'tool') {
            const tool = storage.getTool(cleanId);
            if (!tool) {
              if (batchItems.length === 1) return { ok: false, error: `Not Found: Tool "${cleanId}" not found` };
              continue;
            }
            const { script_code, script_path: _sp, ...manifest } = tool;
            storage.saveTool({ ...manifest, enabled: targetEnabled, updated_at: now }, script_code);
            updatedCount++;
          } else if (rawKind === 'memory') {
            const mem = storage.getMemory(cleanId);
            if (!mem) {
              if (batchItems.length === 1) return { ok: false, error: `Not Found: Memory "${cleanId}" not found` };
              continue;
            }
            storage.saveMemory({ ...mem, enabled: targetEnabled, updated_at: now });
            updatedCount++;
          }
        }

        if (touchedRules) {
          syncManagedRuleBlocks(ws);
        }
        const telem = new EvoTelemetry(storage);
        try { telem.syncFromDisk(true); } finally { telem.close(); }

        const snapshot = buildUiSnapshot(ws);
        const latestUsage = storage.getCoreRulesTokenUsage().totalTokens;
        return {
          ok: true,
          snapshot,
          tokenUsage: latestUsage,
          data: { updatedCount, enabled: targetEnabled, tokenUsage: latestUsage, snapshot },
        };
      }

      case 'approve-item': {
        const storage = new EvoStorage(ws);
        const approveAll = Boolean(params?.approveAll);
        const now = new Date().toISOString();
        let approvedCount = 0;

        if (approveAll) {
          for (const r of storage.listRules()) {
            if (r.review_status === 'pending') {
              storage.saveRule({ ...r, review_status: 'approved', updated_at: now });
              approvedCount++;
            }
          }
          for (const s of storage.listSkills()) {
            if (s.review_status === 'pending') {
              storage.saveSkill({ ...s, review_status: 'approved', updated_at: now });
              approvedCount++;
            }
          }
          for (const t of storage.listTools()) {
            if (t.review_status === 'pending') {
              const { script_code, script_path: _sp, ...manifest } = t;
              storage.saveTool({ ...manifest, review_status: 'approved', updated_at: now }, script_code);
              approvedCount++;
            }
          }
          for (const m of storage.listMemories()) {
            if (m.review_status === 'pending') {
              storage.saveMemory({ ...m, review_status: 'approved', updated_at: now });
              approvedCount++;
            }
          }
        } else {
          const rawKind = typeof params?.kind === 'string' ? params.kind.trim().toLowerCase() : '';
          const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
          if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind) || !rawId) {
            return { ok: false, error: 'Bad Request: Invalid kind or id for approve-item' };
          }
          const cleanId = sanitizeId(rawId);
          if (rawKind === 'rule') {
            const r = storage.getRule(cleanId);
            if (!r) return { ok: false, error: `Not Found: Rule "${cleanId}" not found` };
            storage.saveRule({ ...r, review_status: 'approved', updated_at: now });
            approvedCount = 1;
          } else if (rawKind === 'skill') {
            const s = storage.getSkill(cleanId);
            if (!s) return { ok: false, error: `Not Found: Skill "${cleanId}" not found` };
            storage.saveSkill({ ...s, review_status: 'approved', updated_at: now });
            approvedCount = 1;
          } else if (rawKind === 'tool') {
            const t = storage.getTool(cleanId);
            if (!t) return { ok: false, error: `Not Found: Tool "${cleanId}" not found` };
            const { script_code, script_path: _sp, ...manifest } = t;
            storage.saveTool({ ...manifest, review_status: 'approved', updated_at: now }, script_code);
            approvedCount = 1;
          } else if (rawKind === 'memory') {
            const m = storage.getMemory(cleanId);
            if (!m) return { ok: false, error: `Not Found: Memory "${cleanId}" not found` };
            storage.saveMemory({ ...m, review_status: 'approved', updated_at: now });
            approvedCount = 1;
          }
        }

        const snapshot = buildUiSnapshot(ws);
        return {
          ok: true,
          snapshot,
          data: { approvedCount, approveAll, snapshot },
        };
      }

      case 'rebind-memory-ast': {
        const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
        if (!rawId) return { ok: false, error: 'Bad Request: Missing memory id' };
        const cleanId = sanitizeId(rawId);
        const storage = new EvoStorage(ws);
        const mem = storage.getMemory(cleanId);
        if (!mem) return { ok: false, error: `Not Found: Memory "${cleanId}" not found` };

        const targetKeys =
          mem.target_symbols && mem.target_symbols.length > 0
            ? mem.target_symbols
            : Object.keys(mem.ast_fingerprints || {});
        const resolvedSymbols: string[] = [];
        const missingSymbols: string[] = [];
        const nextFingerprints: Record<string, SymbolFingerprint> = { ...(mem.ast_fingerprints || {}) };

        for (const symKey of targetKeys) {
          const recorded = mem.ast_fingerprints?.[symKey];
          const parsed = parseSymbolTarget(symKey);
          const fastQuery =
            !parsed.fileHint &&
            !parsed.isWholeFile &&
            recorded?.file_path &&
            recorded.file_path !== '(unrecorded)'
              ? `${recorded.file_path}#${symKey}`
              : symKey;
          const liveRaw = extractSymbolFingerprint(ws, fastQuery);
          if (!liveRaw) {
            missingSymbols.push(symKey);
          } else {
            resolvedSymbols.push(symKey);
            nextFingerprints[symKey] = {
              ...liveRaw,
              symbol: symKey,
            };
          }
        }

        if (missingSymbols.length > 0) {
          return {
            ok: false,
            code: 'ERR_MISSING_AST_SYMBOL',
            error: `Cannot re-bind AST: target symbol(s) missing in workspace: ${missingSymbols.join(', ')}`,
            details: { id: cleanId, resolvedSymbols, missingSymbols },
          };
        }

        const updatedMem = {
          ...mem,
          ast_fingerprints: nextFingerprints,
          created_commit: resolveCurrentGitCommit(ws),
          created_branch: resolveCurrentGitBranch(ws),
          updated_at: new Date().toISOString(),
        };
        storage.saveMemory(updatedMem);
        clearMemoryVerificationCache();

        const telem = new EvoTelemetry(storage);
        try { telem.syncFromDisk(true); } finally { telem.close(); }

        const snapshot = buildUiSnapshot(ws);
        const retriggered = (snapshot.memories || []).find((m: any) => m.id === cleanId);
        return {
          ok: true,
          snapshot,
          data: {
            id: cleanId,
            resolvedSymbols,
            missingSymbols,
            overallStatus: retriggered?.freshness?.overall_status || 'VERIFIED',
            memory: retriggered || updatedMem,
            snapshot,
          },
        };
      }

      case 'toggle-rule-tier': {
        const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
        if (!rawId) return { ok: false, error: 'Bad Request: Missing rule id' };
        if (typeof params?.core !== 'boolean') return { ok: false, error: 'Bad Request: Parameter "core" must be a boolean' };

        const cleanId = sanitizeId(rawId);
        const storage = new EvoStorage(ws);
        const rule = storage.getRule(cleanId);
        if (!rule) return { ok: false, error: `Not Found: Rule "${cleanId}" not found` };

        const targetCore = params.core;
        if (targetCore && !rule.core && rule.enabled !== false) {
          const { totalTokens } = storage.getCoreRulesTokenUsage();
          const maxBudget = storage.getConfig()?.maxCoreRuleTokens ?? 1500;
          if (totalTokens + rule.tokens > maxBudget) {
            return {
              ok: false,
              error: `Bad Request: Core rule budget exceeded (${totalTokens + rule.tokens}/${maxBudget} tokens)`,
              code: 'ERR_BUDGET_EXCEEDED',
              details: { currentTokens: totalTokens, candidateTokens: rule.tokens, maxTokens: maxBudget },
            };
          }
        }

        storage.saveRule({ ...rule, core: targetCore, updated_at: new Date().toISOString() });
        syncManagedRuleBlocks(ws);

        const telem = new EvoTelemetry(storage);
        try { telem.syncFromDisk(true); } finally { telem.close(); }

        const snapshot = buildUiSnapshot(ws);
        const latestUsage = storage.getCoreRulesTokenUsage().totalTokens;
        return {
          ok: true,
          snapshot,
          tokenUsage: latestUsage,
          data: { id: cleanId, core: targetCore, tokenUsage: latestUsage, snapshot },
        };
      }

      case 'update-content': {
        const rawKind = typeof params?.kind === 'string' ? params.kind.trim().toLowerCase() : '';
        const rawId = typeof params?.id === 'string' ? params.id.trim() : '';
        const rawContent = typeof params?.content === 'string' ? params.content : '';

        if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind)) {
          return { ok: false, error: `Bad Request: Invalid kind "${rawKind}"` };
        }
        if (!rawId) return { ok: false, error: 'Bad Request: Missing item id' };
        if (!rawContent.trim()) return { ok: false, error: 'Bad Request: Missing or empty content' };

        const cleanId = sanitizeId(rawId);
        const storage = new EvoStorage(ws);
        const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(rawContent.trimStart());
        const { meta, body } =
          rawKind !== 'tool' && hasFrontmatter
            ? parseFrontmatter(rawContent.trimStart())
            : { meta: {} as Record<string, unknown>, body: rawContent.trim() };

        let payload: ProposalPayload;
        let preservedEnabled = true;
        let preservedReviewStatus: 'pending' | 'approved' = 'pending';

        if (rawKind === 'rule') {
          const existingRule = storage.getRule(cleanId);
          const corePath = path.join(storage.rulesDir, `${cleanId}.md`);
          const scopedPath = path.join(storage.rulesDir, 'scoped', `${cleanId}.md`);
          const targetPath = fs.existsSync(corePath) ? corePath : (fs.existsSync(scopedPath) ? scopedPath : null);
          if (!targetPath || !isSubpathOf(ws, targetPath) || !existingRule) {
            return { ok: false, error: `Not Found: Rule "${cleanId}" not found` };
          }
          const isCore =
            meta.core !== undefined ? Boolean(meta.core === true || meta.core === 'true') : existingRule.core;
          const scopeGlob = meta.scope_glob ? String(meta.scope_glob).trim() : existingRule.scope_glob;
          const rawScenarios = Array.isArray(meta.transfer_scenarios)
            ? meta.transfer_scenarios.map(String).filter(Boolean)
            : (existingRule.transfer_scenarios || []);
          const transferScenarios =
            rawScenarios.length >= 2
              ? rawScenarios
              : !isCore
                ? ['Module boundary enforcement', 'Cross-component invariant check']
                : undefined;

          preservedEnabled =
            meta.enabled !== undefined
              ? meta.enabled === false || meta.enabled === 'false'
                ? false
                : true
              : existingRule.enabled;
          preservedReviewStatus =
            meta.review_status === 'pending' || meta.review_status === 'approved'
              ? meta.review_status
              : existingRule.review_status;

          payload = {
            kind: 'rule',
            id: cleanId,
            title: meta.title ? String(meta.title).trim() : existingRule.title,
            l0_summary: meta.l0_summary ? String(meta.l0_summary).trim() : existingRule.l0_summary,
            scope_glob: scopeGlob,
            core: isCore,
            priority:
              meta.priority !== undefined && Number.isFinite(Number(meta.priority))
                ? Number(meta.priority)
                : existingRule.priority,
            confidence:
              meta.confidence && ['high', 'medium', 'low', 'confounded'].includes(String(meta.confidence))
                ? (String(meta.confidence) as ConfidenceLevel)
                : existingRule.confidence,
            contrastive_evidence: meta.contrastive_evidence
              ? String(meta.contrastive_evidence)
              : existingRule.contrastive_evidence,
            transfer_scenarios: transferScenarios,
            content: body.trim(),
            origin: meta.origin ? String(meta.origin) : (existingRule.origin || 'session'),
            supersedes_id: cleanId,
            enabled: preservedEnabled,
            review_status: preservedReviewStatus,
          };
        } else if (rawKind === 'skill') {
          const existingSkill = storage.getSkill(cleanId);
          const skillPath = path.join(storage.skillsDir, cleanId, 'SKILL.md');
          if (!fs.existsSync(skillPath) || !isSubpathOf(ws, skillPath) || !existingSkill) {
            return { ok: false, error: `Not Found: Skill "${cleanId}" not found` };
          }
          const trimmedBody = body.trim();
          const l1Match = trimmedBody.match(/## L1 Contract\s+([\s\S]*?)(?=## L2 SOP|$)/i);
          const l2Match = trimmedBody.match(/## L2 SOP\s+([\s\S]*)$/i);
          const l1_contract =
            l1Match && l1Match[1].trim()
              ? l1Match[1].trim()
              : (existingSkill.l1_contract || 'Standard skill contract');
          const l2_sop = l2Match && l2Match[1].trim() ? l2Match[1].trim() : trimmedBody;

          preservedEnabled =
            meta.enabled !== undefined
              ? meta.enabled === false || meta.enabled === 'false'
                ? false
                : true
              : existingSkill.enabled;
          preservedReviewStatus =
            meta.review_status === 'pending' || meta.review_status === 'approved'
              ? meta.review_status
              : existingSkill.review_status;

          const skillTitle = String(
            meta.title || meta.name || existingSkill.title || existingSkill.name || cleanId
          ).trim();
          const skillL0 = meta.l0_summary
            ? String(meta.l0_summary).trim()
            : meta.description
              ? String(meta.description).trim()
              : (existingSkill.l0_summary || existingSkill.description || cleanId).trim().slice(0, 140);

          payload = {
            kind: 'skill',
            id: cleanId,
            name: String(meta.name || existingSkill.name || cleanId).trim(),
            title: skillTitle,
            description: String(meta.description || skillL0).trim(),
            l0_summary: skillL0,
            l1_contract,
            l2_sop,
            tags: Array.isArray(meta.tags) ? meta.tags.map(String) : existingSkill.tags,
            trigger_cue:
              meta.trigger_cue !== undefined && String(meta.trigger_cue).trim()
                ? String(meta.trigger_cue).trim()
                : existingSkill.trigger_cue,
            confidence:
              meta.confidence && ['high', 'medium', 'low', 'confounded'].includes(String(meta.confidence))
                ? (String(meta.confidence) as ConfidenceLevel)
                : existingSkill.confidence,
            contrastive_evidence: meta.contrastive_evidence
              ? String(meta.contrastive_evidence)
              : existingSkill.contrastive_evidence,
            origin: meta.origin ? String(meta.origin) : (existingSkill.origin || 'session'),
            supersedes_id: cleanId,
            enabled: preservedEnabled,
            review_status: preservedReviewStatus,
          };
        } else if (rawKind === 'memory') {
          const existingMem = storage.getMemory(cleanId);
          const memPath = path.join(storage.memoriesDir, `${cleanId}.md`);
          if (!fs.existsSync(memPath) || !isSubpathOf(ws, memPath) || !existingMem) {
            return { ok: false, error: `Not Found: Memory "${cleanId}" not found` };
          }
          const trimmedBody = body.trim();
          const symptomMatch = trimmedBody.match(/## Symptom\s+([\s\S]*?)(?=## Root Cause|$)/i);
          const rootCauseMatch = trimmedBody.match(/## Root Cause\s+([\s\S]*?)(?=## Solution|$)/i);
          const solutionMatch = trimmedBody.match(/## Solution\s+([\s\S]*)$/i);
          const symptom =
            symptomMatch && symptomMatch[1].trim()
              ? symptomMatch[1].trim()
              : !rootCauseMatch && !solutionMatch && trimmedBody
                ? trimmedBody
                : (existingMem.symptom || 'Observed symptom');
          const root_cause =
            rootCauseMatch && rootCauseMatch[1].trim()
              ? rootCauseMatch[1].trim()
              : (existingMem.root_cause || 'Diagnosed root cause');
          const solution =
            solutionMatch && solutionMatch[1].trim()
              ? solutionMatch[1].trim()
              : (existingMem.solution || 'Verified solution');

          preservedEnabled =
            meta.enabled !== undefined
              ? meta.enabled === false || meta.enabled === 'false'
                ? false
                : true
              : existingMem.enabled;
          preservedReviewStatus =
            meta.review_status === 'pending' || meta.review_status === 'approved'
              ? meta.review_status
              : existingMem.review_status;

          payload = {
            kind: 'memory',
            id: cleanId,
            title: meta.title ? String(meta.title).trim() : (existingMem.title || cleanId),
            l0_summary: meta.l0_summary
              ? String(meta.l0_summary).trim()
              : (existingMem.l0_summary || cleanId),
            symptom,
            root_cause,
            solution,
            target_symbols:
              Array.isArray(meta.target_symbols) && meta.target_symbols.length > 0
                ? meta.target_symbols.map(String)
                : existingMem.target_symbols,
            tags: Array.isArray(meta.tags) ? meta.tags.map(String) : existingMem.tags,
            origin: meta.origin ? String(meta.origin) : (existingMem.origin || 'session'),
            supersedes_id: cleanId,
            enabled: preservedEnabled,
            review_status: preservedReviewStatus,
          };
        } else {
          const tool = storage.getTool(cleanId);
          if (!tool || !fs.existsSync(tool.script_path) || !isSubpathOf(ws, tool.script_path)) {
            return { ok: false, error: `Not Found: Tool "${cleanId}" not found` };
          }

          preservedEnabled = tool.enabled;
          preservedReviewStatus = tool.review_status;

          payload = {
            kind: 'tool',
            id: cleanId,
            title: tool.title || cleanId,
            l0_summary: tool.l0_summary || (tool as any).description || 'Tool',
            runtime: tool.runtime,
            script_code: rawContent,
            input_schema: tool.input_schema,
            self_test_args: tool.self_test_args,
            timeout_ms: tool.timeout_ms,
            hook_trigger: tool.hook_trigger,
            tags: tool.tags,
            origin: tool.origin || 'session',
            supersedes_id: cleanId,
            enabled: preservedEnabled,
            review_status: preservedReviewStatus,
          };
        }

        const telem = new EvoTelemetry(storage);
        let gateRes;
        try {
          const gatekeeper = new EvoGatekeeper(storage, telem);
          gateRes = gatekeeper.evaluateAndCommit(payload, { bypassConfoundedCheck: true });
          if (gateRes.passed) {
            telem.syncFromDisk(true);
          }
        } finally {
          telem.close();
        }

        if (!gateRes.passed) {
          return {
            ok: false,
            code: gateRes.error_code,
            gate_failed: gateRes.gate_failed,
            error: gateRes.message || 'Gatekeeper rejected content update',
          };
        }

        if (rawKind !== 'memory') {
          syncManagedRuleBlocks(ws);
        } else {
          const updatedMem = storage.getMemory(cleanId);
          if (updatedMem) {
            const dbPath = path.join(storage.cacheDir, 'telemetry.db');
            let cacheDb: DatabaseSync | undefined;
            try {
              if (fs.existsSync(dbPath)) cacheDb = new DatabaseSync(dbPath, { readOnly: true });
              verifyMemoryFreshness(ws, updatedMem, { includeCallers: true, cacheDb });
            } finally {
              if (cacheDb) try { cacheDb.close(); } catch {}
            }
          }
        }

        const snapshot = buildUiSnapshot(ws);
        return {
          ok: true,
          snapshot,
          data: { id: cleanId, kind: rawKind, updated: true },
        };
      }

      default:
        return { ok: false, error: `Bad Request: Unknown action "${action}"` };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Internal action dispatch error' };
  }
}

// Alias for architecture report compatibility
export const dispatchExtensionAction = handleWebviewAction;

let activePanel: VsCodeWebviewPanel | undefined = undefined;

export function getActivePanel(): VsCodeWebviewPanel | undefined {
  return activePanel;
}

export async function activate(
  context: VsCodeExtensionContext | any,
  vscodeOverride?: any
): Promise<void> {
  const vscode = resolveVsCode(vscodeOverride);
  if (!vscode) return;

  const openWorkbenchHandler = async () => {
    const ws = resolveActiveWorkspaceRoot(vscode);
    if (!ws) {
      if (vscode?.window?.showWarningMessage) {
        vscode.window.showWarningMessage('EvoKernel: Please open a workspace folder to view Workbench.');
      }
      return;
    }

    if (activePanel) {
      activePanel.reveal(vscode?.ViewColumn?.One ?? 1, false);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'evoWorkbench',
      'EvoKernel Workbench 2.0',
      vscode?.ViewColumn?.One ?? 1,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );
    activePanel = panel;

    panel.onDidDispose(() => {
      activePanel = undefined;
    }, null, context?.subscriptions);

    panel.webview.html = renderWorkbenchHtml(ws);

    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (!message || message.type !== 'evoAction' || !message.reqId || !message.action) {
        return;
      }

      const res = await handleWebviewAction(message.action, message.params || {}, ws, vscode);
      panel.webview.postMessage({
        type: 'evoActionResult',
        reqId: message.reqId,
        action: message.action,
        ...res,
      });
    }, null, context?.subscriptions);
  };

  const d1 = vscode.commands.registerCommand('evo.openWorkbench', openWorkbenchHandler);
  const d2 = vscode.commands.registerCommand('evo.viewCockpit', openWorkbenchHandler);

  if (context?.subscriptions) {
    context.subscriptions.push(d1, d2);
  }
}

export function deactivate(): void {
  if (activePanel) {
    try {
      activePanel.dispose();
    } catch {}
    activePanel = undefined;
  }
}
