import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  EvoStorage,
  PREFERENCE_CATEGORIES,
  estimateTokens,
  formatUserProfileDigestForPreferences,
  hasValidEvoStructure,
  openSqliteReadOnly,
  parseFrontmatter,
  parseSkillSectionsFromMarkdown,
  resolveGlobalFallbackDir,
  sanitizeId,
} from './storage.js';
import type {
  ConfidenceLevel,
  EvoKind,
  EvoMemory,
  EvoPreference,
  EvoRule,
  EvoSkill,
  EvoTool,
  PreferenceCategory,
  ProposalPayload,
  SymbolFingerprint,
} from './types.js';
import { EvoTelemetry } from './telemetry.js';
import {
  EvoGatekeeper,
  captureWorkspaceMutationSignature,
  captureWorkspaceRollbackSnapshot,
  isGlobalFallbackRoot,
  restoreWorkspaceFromSnapshot,
} from './gatekeeper.js';
import {
  clearMemoryVerificationCache,
  extractSymbolFingerprint,
  isRealSubpathOf,
  parseSymbolTarget,
  resolveCurrentGitBranch,
  resolveCurrentGitCommit,
  verifyMemoryFreshness,
  verifyMemoryFreshnessAsync,
} from './memory.js';
import { executeSandboxedScriptAsync } from './sandbox.js';
import { syncGlobalUserProfile } from './profile-sync.js';
import { parseMarkdownToPreferenceCandidates } from './profile-import.js';
import { renderUserProfileBlock } from '../templates/meta-rule.js';

export interface WorkbenchActionResult {
  status: number;
  body: {
    ok: boolean;
    action?: string;
    snapshot?: any;
    tokenUsage?: number;
    result?: any;
    data?: any;
    error?: string;
    code?: string;
    gate_failed?: string;
    details?: any;
  };
}

export interface ProfileSyncResult {
  digestPath: string;
  totalTokens: number;
  maxTokens: number;
  updatedTargets: string[];
  syncedHosts?: unknown;
}

export interface WorkbenchActionHooks {
  buildSnapshot?: (ws: string, options?: { anon?: boolean; cacheDb?: DatabaseSync }) => any;
  anon?: boolean;
  notifyChange?: () => void;
  openEditor?: (
    targetPath: string,
    line: number,
    ws: string
  ) =>
    | Promise<{ opened: string; line: number; editor?: string; launched: boolean }>
    | { opened: string; line: number; editor?: string; launched: boolean };
  exportHtml?: (
    ws: string,
    params: Record<string, unknown>
  ) => Promise<WorkbenchActionResult> | WorkbenchActionResult;
  syncRuleBlocks?: (ws: string) => unknown;
  syncGlobalProfile?: (
    globalRoot?: string,
    options?: { dryRun?: boolean; targetFiles?: string[]; homeDir?: string }
  ) => ProfileSyncResult;
  allowEvoDirOpen?: boolean;
}

/**
 * Normalize a memory target symbol specifier for equality comparison by trimming,
 * converting backslashes to forward slashes, and stripping leading `./` on the file segment.
 */
export function normalizeSymbolForCompare(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return '';
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx !== -1) {
    const filePart = trimmed.slice(0, hashIdx).trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
    return `${filePart}${trimmed.slice(hashIdx)}`;
  }
  return trimmed.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

async function invokeSyncGlobalUserProfile(
  globalRoot: string,
  hooks: WorkbenchActionHooks,
  options?: { dryRun?: boolean; targetFiles?: string[]; homeDir?: string }
): Promise<ProfileSyncResult> {
  if (hooks.syncGlobalProfile) {
    return hooks.syncGlobalProfile(globalRoot, options);
  }
  return syncGlobalUserProfile(globalRoot, options);
}

async function invokeSyncRuleBlocks(ws: string, hooks: WorkbenchActionHooks): Promise<void> {
  if (hooks.syncRuleBlocks) {
    hooks.syncRuleBlocks(ws);
    return;
  }
  try {
    const cliInitPath = '../cli/init.js';
    const cliMod = (await import(cliInitPath)) as {
      syncManagedRuleBlocks?: (workspaceRoot: string) => unknown;
    };
    if (typeof cliMod?.syncManagedRuleBlocks === 'function') {
      cliMod.syncManagedRuleBlocks(ws);
    }
  } catch {
    // Ignore if unavailable
  }
}

function buildSnapshotSafe(
  ws: string,
  hooks: WorkbenchActionHooks,
  cacheDb?: DatabaseSync
): any | undefined {
  if (!hooks.buildSnapshot) return undefined;
  return hooks.buildSnapshot(ws, {
    ...(hooks.anon !== undefined ? { anon: hooks.anon } : {}),
    ...(cacheDb ? { cacheDb } : {}),
  });
}

function resolveTargetStorage(
  ws: string,
  kind: EvoKind | '',
  params: Record<string, unknown>,
  idForLookup?: string,
  mode: 'active' | 'archive' = 'active'
): { storage: EvoStorage; isGlobal: boolean; rootDir: string } {
  const tier = typeof params.tier === 'string' ? params.tier.trim().toUpperCase() : '';
  const scope = typeof params.scope === 'string' ? params.scope.trim().toLowerCase() : '';
  const globalRoot = resolveGlobalFallbackDir();
  const isWsGlobal =
    path.resolve(ws).toLowerCase() === path.resolve(globalRoot).toLowerCase() ||
    isGlobalFallbackRoot(ws);

  if (tier === 'GLOBAL' || scope === 'global') {
    return { storage: new EvoStorage(globalRoot), isGlobal: true, rootDir: globalRoot };
  }
  if (tier === 'LOCAL' || scope === 'project') {
    return { storage: new EvoStorage(ws), isGlobal: isWsGlobal, rootDir: ws };
  }

  if (kind === 'preference') {
    const localStorage = new EvoStorage(ws);
    if (idForLookup && hasValidEvoStructure(localStorage.evoDir)) {
      if (mode === 'archive') {
        const archivedLocal = localStorage
          .listArchivedCapabilities()
          .some((a) => a.kind === 'preference' && a.id === idForLookup);
        if (archivedLocal) {
          return { storage: localStorage, isGlobal: isWsGlobal, rootDir: ws };
        }
      } else if (localStorage.getPreference(idForLookup)) {
        return { storage: localStorage, isGlobal: isWsGlobal, rootDir: ws };
      }
    }
    return { storage: new EvoStorage(globalRoot), isGlobal: true, rootDir: globalRoot };
  }

  return { storage: new EvoStorage(ws), isGlobal: isWsGlobal, rootDir: ws };
}

function inspectLatestArchivedItem(
  storage: EvoStorage,
  cleanId: string,
  kind: EvoKind
): Record<string, unknown> | null {
  if (!fs.existsSync(storage.archiveDir)) return null;
  const matches: Array<{ mtime: number; item: Record<string, unknown> }> = [];
  for (const fileName of fs.readdirSync(storage.archiveDir)) {
    if (!fileName.endsWith('.json')) continue;
    const fullPath = path.join(storage.archiveDir, fileName);
    try {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
      const item = (raw.item && typeof raw.item === 'object' ? raw.item : raw) as Record<
        string,
        unknown
      >;
      const nameMatch = fileName.match(/_(rule|skill|tool|memory|preference)_([^.]+)\.json$/);
      const fileKind = nameMatch ? (nameMatch[1] as EvoKind) : (raw.kind as EvoKind | undefined);
      const itemId = sanitizeId(String(item.id || (nameMatch ? nameMatch[2] : '')));
      if (itemId === cleanId && (!fileKind || fileKind === kind)) {
        const mtime = Date.parse(String(raw.archived_at || '')) || fs.statSync(fullPath).mtimeMs;
        matches.push({ mtime, item });
      }
    } catch {
      // Ignore malformed archive entries
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0].item;
}

let runToolTestMutexTail: Promise<void> = Promise.resolve();

async function withRunToolTestMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = runToolTestMutexTail;
  let release!: () => void;
  runToolTestMutexTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function tokenizeSimpleForDryRun(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = String(text || '').toLowerCase();
  for (const m of lower.match(/[a-z0-9_]{2,}/g) || []) {
    tokens.add(m);
  }
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of cjk) {
    if (run.length === 1) {
      tokens.add(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.add(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

function jaccardSetSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter++;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function createDryRunReadOnlyTelemetry(storage: EvoStorage): EvoTelemetry {
  let roDb: DatabaseSync | undefined;
  if (fs.existsSync(storage.telemetryDbPath)) {
    try {
      roDb = openSqliteReadOnly(storage.telemetryDbPath);
    } catch {
      roDb = undefined;
    }
  }
  const stub = {
    getSessionFlag(key: string): string | null {
      if (!roDb) return null;
      try {
        const row = roDb.prepare('SELECT value FROM session_state WHERE key = ?').get(key) as
          | { value?: string }
          | undefined;
        return row && typeof row.value === 'string' ? row.value : null;
      } catch {
        return null;
      }
    },
    setSessionFlag(): void {},
    syncFromDisk(): void {},
    recordGatekeeperEvent(): void {},
    getTelemetryMap(): Map<string, any> {
      const map = new Map<string, any>();
      if (!roDb) return map;
      try {
        const rows = roDb.prepare('SELECT * FROM telemetry').all() as Array<Record<string, unknown>>;
        for (const r of rows) {
          map.set(String(r.id), {
            id: String(r.id),
            kind: String(r.kind),
            title: String(r.title || r.id),
            l0_summary: String(r.l0_summary || ''),
            hit_count: Number(r.hit_count || 0),
          });
        }
      } catch {}
      return map;
    },
    findSimilarCapabilities(
      title: string,
      l0Summary: string,
      kind: EvoKind,
      excludeId?: string,
      extraText = '',
      candidateBody = ''
    ): Array<{ id: string; similarity: number; l0_summary: string }> {
      if (!hasValidEvoStructure(storage.evoDir)) return [];
      const headerTokens = tokenizeSimpleForDryRun(`${title} ${l0Summary} ${extraText}`);
      const bodyTokens = candidateBody && candidateBody.trim().length >= 20
        ? tokenizeSimpleForDryRun(candidateBody)
        : new Set<string>();
      if (headerTokens.size === 0 && bodyTokens.size === 0) return [];
      const items = kind === 'preference' ? storage.listPreferences() : [];
      const matches: Array<{ id: string; similarity: number; l0_summary: string }> = [];
      for (const item of items) {
        if (excludeId && item.id === excludeId) continue;
        const hSim = jaccardSetSim(
          headerTokens,
          tokenizeSimpleForDryRun(`${item.title} ${item.l0_summary}`)
        );
        const bSim =
          bodyTokens.size > 0 && item.content && item.content.trim().length >= 20
            ? jaccardSetSim(bodyTokens, tokenizeSimpleForDryRun(item.content))
            : 0;
        const sim = bSim > 0 ? Math.max(hSim, bSim * 0.95, hSim * 0.5 + bSim * 0.5) : hSim;
        if (sim > 0) {
          matches.push({ id: item.id, similarity: sim, l0_summary: item.l0_summary });
        }
      }
      return matches.sort((a, b) => b.similarity - a.similarity);
    },
    close(): void {
      if (roDb) {
        try {
          roDb.close();
        } catch {}
        roDb = undefined;
      }
    },
  };
  return stub as unknown as EvoTelemetry;
}

export async function executeWorkbenchAction(
  workspaceRoot: string,
  rawAction: string,
  rawParams: Record<string, unknown>,
  hooks: WorkbenchActionHooks = {}
): Promise<WorkbenchActionResult> {
  const ws = path.resolve(workspaceRoot);
  const action = typeof rawAction === 'string' ? rawAction.trim() : '';
  const params = rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? rawParams : {};
  const localStorage = new EvoStorage(ws);

  const normalizedAction =
    action === 'run-tool'
      ? 'run-tool-test'
      : action === 'refresh-memories'
        ? 'verify-memory'
        : action;

  switch (normalizedAction) {
    case 'open-editor': {
      const rawPath = typeof params.filePath === 'string' ? params.filePath.trim() : '';
      if (!rawPath) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Missing or invalid filePath' },
        };
      }
      const tier = typeof params.tier === 'string' ? params.tier.trim().toUpperCase() : '';
      const globalRoot = resolveGlobalFallbackDir();
      const baseRoot = tier === 'GLOBAL' ? globalRoot : ws;
      const targetPath = path.resolve(baseRoot, rawPath);
      const allowedInWs = isRealSubpathOf(ws, targetPath);
      const allowedInEvo = Boolean(hooks.allowEvoDirOpen) && isRealSubpathOf(localStorage.evoDir, targetPath);
      const allowedInGlobal = tier === 'GLOBAL' && isRealSubpathOf(globalRoot, targetPath);

      if (!allowedInWs && !allowedInEvo && !allowedInGlobal) {
        return {
          status: 403,
          body: { ok: false, error: 'Forbidden: Path traversal outside workspace root' },
        };
      }
      if (!fs.existsSync(targetPath)) {
        return {
          status: 404,
          body: { ok: false, error: `Not Found: File not found: ${rawPath}` },
        };
      }
      const lineNum = Math.max(
        1,
        typeof params.line === 'number' && Number.isFinite(params.line)
          ? Math.floor(params.line)
          : parseInt(String(params.line || 1), 10) || 1
      );
      const openRes = hooks.openEditor
        ? await hooks.openEditor(targetPath, lineNum, ws)
        : { opened: targetPath, line: lineNum, editor: 'noop', launched: false };
      return {
        status: 200,
        body: {
          ok: true,
          action: 'open-editor',
          data: openRes,
        },
      };
    }

    case 'verify-memory': {
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      const resolved = resolveTargetStorage(ws, 'memory', params);
      const targetStorage = resolved.storage;
      let targetMemories = targetStorage.listMemories();
      if (rawId) {
        const cleanId = sanitizeId(rawId);
        if (!cleanId) {
          return {
            status: 400,
            body: { ok: false, error: 'Bad Request: Invalid memory id' },
          };
        }
        const mem = targetStorage.getMemory(cleanId);
        if (!mem) {
          return {
            status: 404,
            body: { ok: false, error: `Not Found: Memory "${cleanId}" not found` },
          };
        }
        targetMemories = [mem];
      }

      const dbPath = path.join(targetStorage.cacheDir, 'telemetry.db');
      let cacheDb: DatabaseSync | undefined;
      try {
        if (fs.existsSync(dbPath)) cacheDb = openSqliteReadOnly(dbPath);
        const updatedItems = targetMemories.map((m) => {
          const v = verifyMemoryFreshness(targetStorage.rootDir, m, {
            includeCallers: true,
            cacheDb,
          });
          const callers = Array.from(
            new Set((v.topology_anchors || []).flatMap((a: any) => a.callers || []))
          );
          return { ...m, freshness: { ...v, callers } };
        });

        const snapshot = buildSnapshotSafe(ws, hooks, resolved.isGlobal ? undefined : cacheDb);
        hooks.notifyChange?.();
        return {
          status: 200,
          body: {
            ok: true,
            action: 'verify-memory',
            snapshot,
            data: { verifiedCount: updatedItems.length, memories: updatedItems, snapshot },
          },
        };
      } finally {
        if (cacheDb) {
          try {
            cacheDb.close();
          } catch {}
        }
      }
    }

    case 'run-tool-test': {
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      if (!rawId) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Missing tool id' },
        };
      }
      const cleanId = sanitizeId(rawId);
      if (!cleanId) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Invalid tool id' },
        };
      }
      const resolved = resolveTargetStorage(ws, 'tool', params, cleanId);
      let targetStorage = resolved.storage;
      let tool = targetStorage.getTool(cleanId);
      if (!tool && !params.tier) {
        const globalStorage = new EvoStorage(resolveGlobalFallbackDir());
        const gTool = globalStorage.getTool(cleanId);
        if (gTool) {
          targetStorage = globalStorage;
          tool = gTool;
        }
      }
      if (!tool) {
        return {
          status: 404,
          body: { ok: false, error: `Not Found: Tool "${cleanId}" not found` },
        };
      }
      const toolDir = path.join(targetStorage.toolsDir, cleanId);
      if (!isRealSubpathOf(toolDir, tool.script_path)) {
        return {
          status: 403,
          body: { ok: false, error: 'Forbidden: Tool script path escapes tool directory' },
        };
      }
      if (!fs.existsSync(tool.script_path)) {
        return {
          status: 404,
          body: { ok: false, error: `Not Found: Tool script "${tool.script_path}" not found` },
        };
      }

      const rootsToGuard: string[] = [targetStorage.rootDir];
      if (path.resolve(ws).toLowerCase() !== path.resolve(targetStorage.rootDir).toLowerCase()) {
        rootsToGuard.push(ws);
      }

      const execResult = await withRunToolTestMutex(async () => {
        const preSnapshots = rootsToGuard.map((root) => ({
          root,
          pre: captureWorkspaceRollbackSnapshot(root),
        }));
        try {
          return await executeSandboxedScriptAsync(
            tool.runtime,
            tool.script_path,
            {},
            { selfTest: true, timeoutMs: 5000, workspaceRoot: ws }
          );
        } finally {
          for (let i = preSnapshots.length - 1; i >= 0; i--) {
            const { root, pre } = preSnapshots[i];
            const postSig = captureWorkspaceMutationSignature(root);
            restoreWorkspaceFromSnapshot(root, pre, postSig);
          }
        }
      });

      const resultObj = {
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        durationMs: execResult.durationMs,
        timedOut: execResult.timedOut,
      };
      return {
        status: 200,
        body: {
          ok: true,
          action: 'run-tool-test',
          result: resultObj,
          data: { id: tool.id, ...resultObj },
        },
      };
    }

    case 'archive-item': {
      const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      if (!['rule', 'skill', 'tool', 'memory', 'preference'].includes(rawKind)) {
        return {
          status: 400,
          body: {
            ok: false,
            error: `Bad Request: Invalid kind "${rawKind}". Must be rule|skill|tool|memory|preference`,
          },
        };
      }
      if (!rawId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Missing item id' } };
      }
      const cleanId = sanitizeId(rawId);
      if (!cleanId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Invalid item id' } };
      }
      const reason =
        typeof params.reason === 'string' && params.reason.trim()
          ? params.reason.trim()
          : 'Archived via EvoKernel Workbench';

      const resolved = resolveTargetStorage(ws, rawKind as EvoKind, params, cleanId, 'active');
      const targetStorage = resolved.storage;
      if (!hasValidEvoStructure(targetStorage.evoDir)) {
        return {
          status: 404,
          body: { ok: false, error: `Not Found: ${rawKind} "${cleanId}" not found` },
        };
      }
      let prevProfileSnapshot: string | undefined;
      let prevProfileTitle = cleanId;
      let shouldRecordProfileHistory = false;
      if (rawKind === 'preference') {
        const existingPref = targetStorage.getPreference(cleanId);
        if (existingPref) {
          shouldRecordProfileHistory = resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir);
          prevProfileTitle = existingPref.title || cleanId;
          const pPath = path.join(targetStorage.preferencesDir, `${cleanId}.md`);
          if (shouldRecordProfileHistory && fs.existsSync(pPath)) {
            try { prevProfileSnapshot = fs.readFileSync(pPath, 'utf8'); } catch {}
          }
        }
      } else if (rawKind === 'memory') {
        const existingMem = targetStorage.getMemory(cleanId);
        if (
          existingMem &&
          (existingMem.memory_type === 'personal' ||
            resolved.isGlobal ||
            isGlobalFallbackRoot(targetStorage.rootDir))
        ) {
          shouldRecordProfileHistory = true;
          prevProfileTitle = existingMem.title || cleanId;
          const mPath = path.join(targetStorage.memoriesDir, `${cleanId}.md`);
          if (fs.existsSync(mPath)) {
            try { prevProfileSnapshot = fs.readFileSync(mPath, 'utf8'); } catch {}
          }
        }
      }

      const archived = targetStorage.archiveCapability(cleanId, rawKind as EvoKind, reason);
      if (!archived) {
        return {
          status: 404,
          body: { ok: false, error: `Not Found: ${rawKind} "${cleanId}" not found` },
        };
      }

      if (shouldRecordProfileHistory) {
        targetStorage.appendProfileHistory({
          ts: new Date().toISOString(),
          action: 'archive',
          id: cleanId,
          kind: rawKind as 'preference' | 'memory',
          title: prevProfileTitle,
          ...(prevProfileSnapshot ? { previous_snapshot: prevProfileSnapshot } : {}),
          reason,
        });
      }

      if (rawKind === 'preference' || (rawKind === 'skill' && (resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir)))) {
        if (resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir)) {
          await invokeSyncGlobalUserProfile(targetStorage.rootDir, hooks);
        } else {
          await invokeSyncRuleBlocks(ws, hooks);
        }
      } else if (rawKind !== 'memory' && !resolved.isGlobal) {
        await invokeSyncRuleBlocks(ws, hooks);
      }
      const telem = new EvoTelemetry(targetStorage);
      try {
        telem.syncFromDisk(true);
      } finally {
        telem.close();
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      return {
        status: 200,
        body: {
          ok: true,
          action: 'archive-item',
          snapshot,
          data: {
            archived: { kind: rawKind, id: cleanId, tier: resolved.isGlobal ? 'GLOBAL' : 'LOCAL' },
            reason,
            snapshot,
          },
        },
      };
    }

    case 'restore-item': {
      const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      if (!['rule', 'skill', 'tool', 'memory', 'preference'].includes(rawKind)) {
        return {
          status: 400,
          body: {
            ok: false,
            error: `Bad Request: Invalid kind "${rawKind}". Must be rule|skill|tool|memory|preference`,
          },
        };
      }
      if (!rawId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Missing item id' } };
      }
      const cleanId = sanitizeId(rawId);
      if (!cleanId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Invalid item id' } };
      }
      const resolved = resolveTargetStorage(ws, rawKind as EvoKind, params, cleanId, 'archive');
      const targetStorage = resolved.storage;

      // D14: Budget pre-check before restoring core rules or always_on preferences
      const archivedItem = inspectLatestArchivedItem(targetStorage, cleanId, rawKind as EvoKind);
      if (archivedItem) {
        const willBeEnabled =
          archivedItem.enabled === false || archivedItem.enabled === 'false' ? false : true;
        if (rawKind === 'rule' && Boolean(archivedItem.core) && willBeEnabled) {
          const candidateTokens = Number(
            archivedItem.tokens ||
              estimateTokens(
                `${String(archivedItem.l0_summary || '')}\n${String(archivedItem.content || '')}`
              ) ||
              40
          );
          const { rules: existingCoreRules } = targetStorage.getCoreRulesTokenUsage();
          const currentCoreTokens = existingCoreRules
            .filter((r) => r.id !== cleanId)
            .reduce((acc, r) => acc + r.tokens, 0);
          const maxBudget = targetStorage.getConfig()?.maxCoreRuleTokens ?? 1500;
          if (currentCoreTokens + candidateTokens > maxBudget) {
            return {
              status: 400,
              body: {
                ok: false,
                code: 'ERR_BUDGET_EXCEEDED',
                error: `ERR_BUDGET_EXCEEDED: Restoring core rule "${cleanId}" (${currentCoreTokens + candidateTokens}/${maxBudget} tokens) would exceed maxCoreRuleTokens`,
                details: {
                  currentTokens: currentCoreTokens,
                  candidateTokens,
                  maxTokens: maxBudget,
                },
              },
            };
          }
        } else if (rawKind === 'preference') {
          const willBeAlwaysOn =
            archivedItem.always_on === false || archivedItem.always_on === 'false' ? false : true;
          const preservedReviewStatus =
            archivedItem.review_status === 'pending' ? 'pending' : 'approved';
          if (willBeAlwaysOn && willBeEnabled && preservedReviewStatus !== 'pending') {
            const rawCat = String(archivedItem.category || 'style').trim().toLowerCase() as PreferenceCategory;
            const cat: PreferenceCategory = PREFERENCE_CATEGORIES.includes(rawCat) ? rawCat : 'style';
            const prefL0 = String(archivedItem.l0_summary || cleanId);
            const prefContent = String(archivedItem.content || archivedItem.l0_summary || '');
            const candidateTokens = Number(
              archivedItem.tokens ||
                estimateTokens(`- **[${cleanId}]** (${cat}): ${prefL0}\n  ${prefContent}`) ||
                30
            );
            const nowIso = new Date().toISOString();
            const candidatePref: EvoPreference = {
              id: cleanId,
              title: String(archivedItem.title || cleanId),
              l0_summary: prefL0,
              category: cat,
              always_on: true,
              content: prefContent,
              tokens: candidateTokens,
              tags: Array.isArray(archivedItem.tags) ? archivedItem.tags.map(String) : [],
              origin: String(archivedItem.origin || 'restored'),
              enabled: true,
              review_status: preservedReviewStatus,
              created_at: String(archivedItem.created_at || nowIso),
              updated_at: nowIso,
            };
            const { totalTokens, preferences: existingPrefs } = targetStorage.getProfileTokenUsage();
            const projectedDigest = formatUserProfileDigestForPreferences([
              ...existingPrefs.filter((p) => p.id !== cleanId),
              candidatePref,
            ]);
            const projectedTokens = projectedDigest
              ? estimateTokens(renderUserProfileBlock(projectedDigest, ''))
              : 0;
            const maxProfileBudget = targetStorage.getConfig()?.maxGlobalProfileTokens ?? 800;
            if (projectedTokens > maxProfileBudget) {
              return {
                status: 400,
                body: {
                  ok: false,
                  code: 'ERR_PROFILE_BUDGET_EXCEEDED',
                  error: `ERR_PROFILE_BUDGET_EXCEEDED: Restoring always_on preference "${cleanId}" (${projectedTokens}/${maxProfileBudget} tokens) would exceed maxGlobalProfileTokens`,
                  details: {
                    currentTokens: totalTokens,
                    candidateTokens,
                    projectedTokens,
                    maxTokens: maxProfileBudget,
                  },
                },
              };
            }
          }
        }
      }

      let restored = false;
      try {
        restored = targetStorage.restoreCapability(cleanId, rawKind as EvoKind);
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = msg.includes('ERR_PROFILE_BUDGET_EXCEEDED')
          ? 'ERR_PROFILE_BUDGET_EXCEEDED'
          : msg.includes('ERR_BUDGET_EXCEEDED')
            ? 'ERR_BUDGET_EXCEEDED'
            : 'ERR_RESTORE_FAILED';
        return {
          status: 400,
          body: { ok: false, code, error: msg },
        };
      }
      if (!restored) {
        return {
          status: 404,
          body: { ok: false, error: `Not Found: Archived ${rawKind} "${cleanId}" not found` },
        };
      }

      const isGlobalTarget = resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir);
      if (rawKind === 'preference' || (rawKind === 'skill' && isGlobalTarget)) {
        if (isGlobalTarget) {
          await invokeSyncGlobalUserProfile(targetStorage.rootDir, hooks);
        } else {
          await invokeSyncRuleBlocks(ws, hooks);
        }
      } else if (rawKind !== 'memory' && !isGlobalTarget) {
        await invokeSyncRuleBlocks(ws, hooks);
      }
      const telem = new EvoTelemetry(targetStorage);
      try {
        telem.syncFromDisk(true);
      } finally {
        telem.close();
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      return {
        status: 200,
        body: {
          ok: true,
          action: 'restore-item',
          snapshot,
          data: {
            restored: { kind: rawKind, id: cleanId, tier: resolved.isGlobal ? 'GLOBAL' : 'LOCAL' },
            snapshot,
          },
        },
      };
    }

    case 'toggle-enabled': {
      if (typeof params.enabled !== 'boolean') {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Parameter "enabled" must be a boolean' },
        };
      }
      const targetEnabled = params.enabled;
      const batchItems = Array.isArray(params.items)
        ? params.items
        : [{ kind: params.kind, id: params.id, tier: params.tier, scope: params.scope }];
      if (batchItems.length === 0) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Missing target item(s)' },
        };
      }

      const MAX_ATOMIC_PREF_TOKENS = 150;
      const now = new Date().toISOString();
      type PlannedToggleOp =
        | { kind: 'rule'; storage: EvoStorage; isGlobal: boolean; item: EvoRule }
        | { kind: 'skill'; storage: EvoStorage; isGlobal: boolean; item: EvoSkill }
        | { kind: 'tool'; storage: EvoStorage; isGlobal: boolean; item: EvoTool }
        | { kind: 'memory'; storage: EvoStorage; isGlobal: boolean; item: EvoMemory }
        | { kind: 'preference'; storage: EvoStorage; isGlobal: boolean; item: EvoPreference };
      const plannedOps: PlannedToggleOp[] = [];
      const projectedCoreTokensByRoot = new Map<
        string,
        { totalTokens: number; maxBudget: number; seenIds: Set<string> }
      >();
      const projectedPrefsByRoot = new Map<
        string,
        { baselineTokens: number; maxBudget: number; prefs: EvoPreference[] }
      >();

      // Phase 1: Pre-validate ALL items & projected budgets before mutating any file on disk
      for (const entry of batchItems) {
        const rawKind = typeof entry?.kind === 'string' ? entry.kind.trim().toLowerCase() : '';
        const rawId = typeof entry?.id === 'string' ? entry.id.trim() : '';
        if (!['rule', 'skill', 'tool', 'memory', 'preference'].includes(rawKind) || !rawId) {
          return {
            status: 400,
            body: { ok: false, error: 'Bad Request: Invalid kind or id in toggle-enabled' },
          };
        }
        const cleanId = sanitizeId(rawId);
        if (!cleanId) {
          return {
            status: 400,
            body: { ok: false, error: 'Bad Request: Invalid id in toggle-enabled' },
          };
        }
        const entryParams: Record<string, unknown> = {
          ...params,
          ...(entry && typeof entry === 'object' ? entry : {}),
        };
        const resolved = resolveTargetStorage(ws, rawKind as EvoKind, entryParams, cleanId, 'active');
        const targetStorage = resolved.storage;
        const rootKey = path.resolve(targetStorage.rootDir);
        const isGlobalTarget = resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir);

        if (rawKind === 'rule') {
          const rule = targetStorage.getRule(cleanId);
          if (!rule) {
            if (batchItems.length === 1) {
              return { status: 404, body: { ok: false, error: `Not Found: Rule "${cleanId}" not found` } };
            }
            continue;
          }
          if (targetEnabled && rule.core && rule.enabled === false) {
            let coreState = projectedCoreTokensByRoot.get(rootKey);
            if (!coreState) {
              const { totalTokens, rules } = targetStorage.getCoreRulesTokenUsage();
              coreState = {
                totalTokens,
                maxBudget: targetStorage.getConfig()?.maxCoreRuleTokens ?? 1500,
                seenIds: new Set(rules.map((r) => r.id)),
              };
              projectedCoreTokensByRoot.set(rootKey, coreState);
            }
            if (!coreState.seenIds.has(rule.id)) {
              coreState.totalTokens += rule.tokens;
              coreState.seenIds.add(rule.id);
            }
            if (coreState.totalTokens > coreState.maxBudget) {
              return {
                status: 400,
                body: {
                  ok: false,
                  error: `Bad Request: Core rule budget exceeded (${coreState.totalTokens}/${coreState.maxBudget} tokens)`,
                  code: 'ERR_BUDGET_EXCEEDED',
                  details: {
                    currentTokens: coreState.totalTokens - rule.tokens,
                    candidateTokens: rule.tokens,
                    maxTokens: coreState.maxBudget,
                  },
                },
              };
            }
          }
          plannedOps.push({ kind: 'rule', storage: targetStorage, isGlobal: isGlobalTarget, item: rule });
        } else if (rawKind === 'skill') {
          const skill = targetStorage.getSkill(cleanId);
          if (!skill) {
            if (batchItems.length === 1) {
              return { status: 404, body: { ok: false, error: `Not Found: Skill "${cleanId}" not found` } };
            }
            continue;
          }
          plannedOps.push({ kind: 'skill', storage: targetStorage, isGlobal: isGlobalTarget, item: skill });
        } else if (rawKind === 'tool') {
          const tool = targetStorage.getTool(cleanId);
          if (!tool) {
            if (batchItems.length === 1) {
              return { status: 404, body: { ok: false, error: `Not Found: Tool "${cleanId}" not found` } };
            }
            continue;
          }
          plannedOps.push({ kind: 'tool', storage: targetStorage, isGlobal: isGlobalTarget, item: tool });
        } else if (rawKind === 'memory') {
          const mem = targetStorage.getMemory(cleanId);
          if (!mem) {
            if (batchItems.length === 1) {
              return { status: 404, body: { ok: false, error: `Not Found: Memory "${cleanId}" not found` } };
            }
            continue;
          }
          plannedOps.push({ kind: 'memory', storage: targetStorage, isGlobal: isGlobalTarget, item: mem });
        } else if (rawKind === 'preference') {
          const pref = targetStorage.getPreference(cleanId);
          if (!pref) {
            if (batchItems.length === 1) {
              return {
                status: 404,
                body: { ok: false, error: `Not Found: Preference "${cleanId}" not found` },
              };
            }
            continue;
          }
          if (targetEnabled && pref.always_on !== false && pref.enabled === false) {
            const prefLineTokens = estimateTokens(
              `- **[${pref.id}]** (${pref.category}): ${pref.l0_summary}\n  ${pref.content.replace(/\n/g, '\n  ')}`
            );
            const atomicTokens = Math.max(Number(pref.tokens || 0), prefLineTokens);
            if (atomicTokens > MAX_ATOMIC_PREF_TOKENS) {
              return {
                status: 400,
                body: {
                  ok: false,
                  error: `Bad Request: Preference '${pref.id}' exceeds per-item atomic cap (${atomicTokens}/${MAX_ATOMIC_PREF_TOKENS} tokens)`,
                  code: 'ERR_PROFILE_BUDGET_EXCEEDED',
                  details: {
                    candidateTokens: atomicTokens,
                    maxAtomicTokens: MAX_ATOMIC_PREF_TOKENS,
                  },
                },
              };
            }
            let prefState = projectedPrefsByRoot.get(rootKey);
            if (!prefState) {
              const { totalTokens, preferences: activePrefs } = targetStorage.getProfileTokenUsage();
              prefState = {
                baselineTokens: totalTokens,
                maxBudget: targetStorage.getConfig()?.maxGlobalProfileTokens ?? 800,
                prefs: [...activePrefs],
              };
              projectedPrefsByRoot.set(rootKey, prefState);
            }
            prefState.prefs = [
              ...prefState.prefs.filter((p) => p.id !== pref.id),
              { ...pref, enabled: true },
            ];
            const projectedDigest = formatUserProfileDigestForPreferences(prefState.prefs);
            const projectedTokens = projectedDigest
              ? estimateTokens(renderUserProfileBlock(projectedDigest, ''))
              : 0;
            if (projectedTokens > prefState.maxBudget) {
              return {
                status: 400,
                body: {
                  ok: false,
                  error: `Bad Request: Global profile budget exceeded (${projectedTokens}/${prefState.maxBudget} tokens)`,
                  code: 'ERR_PROFILE_BUDGET_EXCEEDED',
                  details: {
                    currentTokens: prefState.baselineTokens,
                    candidateTokens: atomicTokens,
                    projectedTokens,
                    maxTokens: prefState.maxBudget,
                  },
                },
              };
            }
          }
          plannedOps.push({ kind: 'preference', storage: targetStorage, isGlobal: isGlobalTarget, item: pref });
        }
      }

      // Phase 2: Commit validated mutations
      let touchedManagedCatalog = false;
      const touchedProfileRoots = new Set<string>();
      const touchedStorages = new Map<string, EvoStorage>();
      let updatedCount = 0;

      for (const op of plannedOps) {
        touchedStorages.set(path.resolve(op.storage.rootDir), op.storage);
        if (op.kind === 'rule') {
          op.storage.saveRule({ ...op.item, enabled: targetEnabled, updated_at: now });
          if (!op.isGlobal) touchedManagedCatalog = true;
          updatedCount++;
        } else if (op.kind === 'skill') {
          op.storage.saveSkill({ ...op.item, enabled: targetEnabled, updated_at: now });
          if (op.isGlobal) touchedProfileRoots.add(op.storage.rootDir);
          else touchedManagedCatalog = true;
          updatedCount++;
        } else if (op.kind === 'tool') {
          const { script_code, script_path: _sp, ...manifest } = op.item;
          op.storage.saveTool({ ...manifest, enabled: targetEnabled, updated_at: now }, script_code);
          if (!op.isGlobal) touchedManagedCatalog = true;
          updatedCount++;
        } else if (op.kind === 'memory') {
          op.storage.saveMemory({ ...op.item, enabled: targetEnabled, updated_at: now });
          updatedCount++;
        } else if (op.kind === 'preference') {
          let prevProfileSnapshot: string | undefined;
          const pPath = path.join(op.storage.preferencesDir, `${op.item.id}.md`);
          if (op.isGlobal && fs.existsSync(pPath)) {
            try {
              prevProfileSnapshot = fs.readFileSync(pPath, 'utf8');
            } catch {}
          }
          op.storage.savePreference({ ...op.item, enabled: targetEnabled, updated_at: now });
          if (op.isGlobal) {
            op.storage.appendProfileHistory({
              ts: now,
              action: 'update',
              id: op.item.id,
              kind: 'preference',
              title: op.item.title || op.item.id,
              ...(prevProfileSnapshot ? { previous_snapshot: prevProfileSnapshot } : {}),
              reason: targetEnabled ? 'Resumed preference' : 'Paused preference',
            });
            touchedProfileRoots.add(op.storage.rootDir);
          } else {
            touchedManagedCatalog = true;
          }
          updatedCount++;
        }
      }

      if (touchedManagedCatalog) {
        await invokeSyncRuleBlocks(ws, hooks);
      }
      for (const gRoot of touchedProfileRoots) {
        await invokeSyncGlobalUserProfile(gRoot, hooks);
      }
      if (touchedStorages.size === 0 && hasValidEvoStructure(localStorage.evoDir)) {
        touchedStorages.set(path.resolve(ws), localStorage);
      }
      for (const st of touchedStorages.values()) {
        const telem = new EvoTelemetry(st);
        try {
          telem.syncFromDisk(true);
        } finally {
          telem.close();
        }
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      const latestUsage = localStorage.getCoreRulesTokenUsage().totalTokens;
      return {
        status: 200,
        body: {
          ok: true,
          action: 'toggle-enabled',
          snapshot,
          tokenUsage: latestUsage,
          data: { updatedCount, enabled: targetEnabled, tokenUsage: latestUsage, snapshot },
        },
      };
    }

    case 'approve-item': {
      const approveAll = Boolean(params.approveAll);
      const now = new Date().toISOString();
      let approvedCount = 0;
      let touchedManagedCatalog = false;
      const touchedProfileRoots = new Set<string>();

      const approvePendingInStorage = (st: EvoStorage, isGlobalStore: boolean) => {
        const isGlobalTarget = isGlobalStore || isGlobalFallbackRoot(st.rootDir);
        for (const r of st.listRules()) {
          if (r.review_status === 'pending') {
            st.saveRule({ ...r, review_status: 'approved', updated_at: now });
            approvedCount++;
            if (!isGlobalTarget) touchedManagedCatalog = true;
          }
        }
        for (const s of st.listSkills()) {
          if (s.review_status === 'pending') {
            st.saveSkill({ ...s, review_status: 'approved', updated_at: now });
            approvedCount++;
            if (isGlobalTarget) touchedProfileRoots.add(st.rootDir);
            else touchedManagedCatalog = true;
          }
        }
        for (const t of st.listTools()) {
          if (t.review_status === 'pending') {
            const { script_code, script_path: _sp, ...manifest } = t;
            st.saveTool({ ...manifest, review_status: 'approved', updated_at: now }, script_code);
            approvedCount++;
            if (!isGlobalTarget) touchedManagedCatalog = true;
          }
        }
        for (const m of st.listMemories()) {
          if (m.review_status === 'pending') {
            st.saveMemory({ ...m, review_status: 'approved', updated_at: now });
            approvedCount++;
          }
        }
        for (const p of st.listPreferences()) {
          if (p.review_status === 'pending') {
            st.savePreference({ ...p, review_status: 'approved', updated_at: now });
            approvedCount++;
            if (isGlobalTarget) {
              touchedProfileRoots.add(st.rootDir);
            } else {
              touchedManagedCatalog = true;
            }
          }
        }
      };

      if (approveAll) {
        const tier = typeof params.tier === 'string' ? params.tier.trim().toUpperCase() : '';
        if (tier === 'GLOBAL') {
          const gRoot = resolveGlobalFallbackDir();
          if (hasValidEvoStructure(path.join(gRoot, '.evo'))) {
            approvePendingInStorage(new EvoStorage(gRoot), true);
          }
        } else {
          if (hasValidEvoStructure(localStorage.evoDir)) {
            approvePendingInStorage(localStorage, isGlobalFallbackRoot(ws));
          }
          const gRoot = resolveGlobalFallbackDir();
          if (
            path.resolve(gRoot).toLowerCase() !== path.resolve(ws).toLowerCase() &&
            hasValidEvoStructure(path.join(gRoot, '.evo'))
          ) {
            const gStorage = new EvoStorage(gRoot);
            for (const p of gStorage.listPreferences()) {
              if (p.review_status === 'pending') {
                gStorage.savePreference({ ...p, review_status: 'approved', updated_at: now });
                approvedCount++;
                touchedProfileRoots.add(gRoot);
              }
            }
          }
        }
      } else {
        const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
        const rawId = typeof params.id === 'string' ? params.id.trim() : '';
        if (!['rule', 'skill', 'tool', 'memory', 'preference'].includes(rawKind) || !rawId) {
          return {
            status: 400,
            body: { ok: false, error: 'Bad Request: Invalid kind or id for approve-item' },
          };
        }
        const cleanId = sanitizeId(rawId);
        if (!cleanId) {
          return {
            status: 400,
            body: { ok: false, error: 'Bad Request: Invalid id for approve-item' },
          };
        }
        const resolved = resolveTargetStorage(ws, rawKind as EvoKind, params, cleanId, 'active');
        const targetStorage = resolved.storage;
        const isGlobalTarget = resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir);

        if (rawKind === 'rule') {
          const r = targetStorage.getRule(cleanId);
          if (!r) return { status: 404, body: { ok: false, error: `Not Found: Rule "${cleanId}" not found` } };
          targetStorage.saveRule({ ...r, review_status: 'approved', updated_at: now });
          approvedCount = 1;
          if (!isGlobalTarget) touchedManagedCatalog = true;
        } else if (rawKind === 'skill') {
          const s = targetStorage.getSkill(cleanId);
          if (!s) return { status: 404, body: { ok: false, error: `Not Found: Skill "${cleanId}" not found` } };
          targetStorage.saveSkill({ ...s, review_status: 'approved', updated_at: now });
          approvedCount = 1;
          if (isGlobalTarget) touchedProfileRoots.add(targetStorage.rootDir);
          else touchedManagedCatalog = true;
        } else if (rawKind === 'tool') {
          const t = targetStorage.getTool(cleanId);
          if (!t) return { status: 404, body: { ok: false, error: `Not Found: Tool "${cleanId}" not found` } };
          const { script_code, script_path: _sp, ...manifest } = t;
          targetStorage.saveTool({ ...manifest, review_status: 'approved', updated_at: now }, script_code);
          approvedCount = 1;
          if (!isGlobalTarget) touchedManagedCatalog = true;
        } else if (rawKind === 'memory') {
          const m = targetStorage.getMemory(cleanId);
          if (!m) return { status: 404, body: { ok: false, error: `Not Found: Memory "${cleanId}" not found` } };
          targetStorage.saveMemory({ ...m, review_status: 'approved', updated_at: now });
          approvedCount = 1;
        } else if (rawKind === 'preference') {
          const p = targetStorage.getPreference(cleanId);
          if (!p) {
            return {
              status: 404,
              body: { ok: false, error: `Not Found: Preference "${cleanId}" not found` },
            };
          }
          targetStorage.savePreference({ ...p, review_status: 'approved', updated_at: now });
          approvedCount = 1;
          if (isGlobalTarget) {
            touchedProfileRoots.add(targetStorage.rootDir);
          } else {
            touchedManagedCatalog = true;
          }
        }
      }

      if (touchedManagedCatalog) {
        await invokeSyncRuleBlocks(ws, hooks);
      }
      for (const gRoot of touchedProfileRoots) {
        await invokeSyncGlobalUserProfile(gRoot, hooks);
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      return {
        status: 200,
        body: {
          ok: true,
          action: 'approve-item',
          snapshot,
          data: { approvedCount, approveAll, snapshot },
        },
      };
    }

    case 'rebind-memory-ast': {
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      if (!rawId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Missing memory id' } };
      }
      const cleanId = sanitizeId(rawId);
      if (!cleanId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Invalid memory id' } };
      }
      const resolved = resolveTargetStorage(ws, 'memory', params, cleanId);
      const targetStorage = resolved.storage;
      const mem = targetStorage.getMemory(cleanId);
      if (!mem) {
        return { status: 404, body: { ok: false, error: `Not Found: Memory "${cleanId}" not found` } };
      }

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
        const liveRaw = extractSymbolFingerprint(targetStorage.rootDir, fastQuery);
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
          status: 400,
          body: {
            ok: false,
            code: 'ERR_MISSING_AST_SYMBOL',
            error: `Cannot re-bind AST: target symbol(s) missing in workspace: ${missingSymbols.join(', ')}`,
            details: { id: cleanId, resolvedSymbols, missingSymbols },
          },
        };
      }

      const updatedMem = {
        ...mem,
        ast_fingerprints: nextFingerprints,
        created_commit: resolveCurrentGitCommit(targetStorage.rootDir),
        created_branch: resolveCurrentGitBranch(targetStorage.rootDir),
        updated_at: new Date().toISOString(),
      };
      targetStorage.saveMemory(updatedMem);
      clearMemoryVerificationCache();

      const telem = new EvoTelemetry(targetStorage);
      try {
        telem.syncFromDisk(true);
      } finally {
        telem.close();
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      const retriggered = (snapshot?.memories || []).find((m: any) => m.id === cleanId);
      return {
        status: 200,
        body: {
          ok: true,
          action: 'rebind-memory-ast',
          snapshot,
          data: {
            id: cleanId,
            resolvedSymbols,
            missingSymbols,
            overallStatus: retriggered?.freshness?.overall_status || 'VERIFIED',
            memory: retriggered || updatedMem,
            snapshot,
          },
        },
      };
    }

    case 'toggle-rule-tier': {
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      if (!rawId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Missing rule id' } };
      }
      if (typeof params.core !== 'boolean') {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Parameter "core" must be a boolean' },
        };
      }
      const cleanId = sanitizeId(rawId);
      if (!cleanId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Invalid rule id' } };
      }
      const resolved = resolveTargetStorage(ws, 'rule', params, cleanId);
      const targetStorage = resolved.storage;
      const rule = targetStorage.getRule(cleanId);
      if (!rule) {
        return { status: 404, body: { ok: false, error: `Not Found: Rule "${cleanId}" not found` } };
      }

      const targetCore = params.core;
      const telem = new EvoTelemetry(targetStorage);
      try {
        if (targetCore && !rule.core) {
          const gatekeeper = new EvoGatekeeper(targetStorage, telem);
          const payload: ProposalPayload = {
            kind: 'rule',
            id: cleanId,
            title: rule.title,
            l0_summary: rule.l0_summary,
            scope_glob: rule.scope_glob,
            core: true,
            priority: rule.priority,
            confidence: rule.confidence,
            contrastive_evidence: rule.contrastive_evidence,
            transfer_scenarios:
              rule.transfer_scenarios && rule.transfer_scenarios.length > 0
                ? rule.transfer_scenarios
                : undefined,
            content: rule.content,
            origin: rule.origin || 'session',
            supersedes_id: cleanId,
            enabled: rule.enabled,
            review_status: rule.review_status,
            visibility: rule.visibility,
          };
          const gateRes = await gatekeeper.evaluateAndCommitAsync(payload, {
            bypassConfoundedCheck: true,
          });
          if (!gateRes.passed) {
            const snapshot = buildSnapshotSafe(ws, hooks);
            hooks.notifyChange?.();
            return {
              status: 400,
              body: {
                ok: false,
                code: gateRes.error_code,
                gate_failed: gateRes.gate_failed,
                error: gateRes.message || 'Gatekeeper rejected rule promotion to core',
                details: gateRes.low_value_candidates,
                snapshot,
              },
            };
          }
          telem.syncFromDisk(true);
        } else {
          const prevSnap = targetStorage.snapshotCapabilityForHistory(cleanId, 'rule');
          const nowIso = new Date().toISOString();
          targetStorage.saveRule({ ...rule, core: targetCore, updated_at: nowIso });
          if (prevSnap?.snapshot) {
            targetStorage.appendProfileHistory({
              ts: nowIso,
              action: 'update',
              id: cleanId,
              kind: 'rule',
              title: rule.title || cleanId,
              previous_snapshot: prevSnap.snapshot,
              was_core: prevSnap.wasCore,
              reason: targetCore ? 'Promoted to Core in Workbench' : 'Demoted to Scoped in Workbench',
            });
          }
          telem.syncFromDisk(true);
        }
      } finally {
        telem.close();
      }

      if (!resolved.isGlobal) {
        await invokeSyncRuleBlocks(ws, hooks);
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      const latestUsage = targetStorage.getCoreRulesTokenUsage().totalTokens;
      return {
        status: 200,
        body: {
          ok: true,
          action: 'toggle-rule-tier',
          snapshot,
          tokenUsage: latestUsage,
          data: { id: cleanId, core: targetCore, tokenUsage: latestUsage, snapshot },
        },
      };
    }

    case 'update-content': {
      const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      const rawContent = typeof params.content === 'string' ? params.content : '';
      const hasStructuredSkillFields =
        rawKind === 'skill' &&
        (typeof params.l1_contract === 'string' || typeof params.l2_sop === 'string');
      const hasStructuredMemoryFields =
        rawKind === 'memory' &&
        (typeof params.symptom === 'string' ||
          typeof params.root_cause === 'string' ||
          typeof params.solution === 'string');
      const hasStructuredToolField = rawKind === 'tool' && typeof params.script_code === 'string';

      if (!['rule', 'skill', 'tool', 'memory', 'preference'].includes(rawKind)) {
        return { status: 400, body: { ok: false, error: `Bad Request: Invalid kind "${rawKind}"` } };
      }
      if (!rawId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Missing item id' } };
      }
      if (
        !rawContent.trim() &&
        !hasStructuredSkillFields &&
        !hasStructuredMemoryFields &&
        !hasStructuredToolField
      ) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Missing or empty content' } };
      }

      const cleanId = sanitizeId(rawId);
      if (!cleanId) {
        return { status: 400, body: { ok: false, error: 'Bad Request: Invalid item id' } };
      }
      const resolved = resolveTargetStorage(ws, rawKind as EvoKind, params, cleanId, 'active');
      const targetStorage = resolved.storage;

      const effectiveRawContent = hasStructuredToolField ? String(params.script_code) : rawContent;
      const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(effectiveRawContent.trimStart());
      const { meta, body } =
        rawKind !== 'tool' && hasFrontmatter
          ? parseFrontmatter(effectiveRawContent.trimStart())
          : { meta: {} as Record<string, unknown>, body: effectiveRawContent.trim() };

      let payload: ProposalPayload;
      let preservedEnabled: boolean | undefined;
      let preservedReviewStatus: 'pending' | 'approved' | undefined;
      let preserveMemoryAnchorOnEdit = false;

      if (rawKind === 'rule') {
        const existingRule = targetStorage.getRule(cleanId);
        const corePath = path.join(targetStorage.rulesDir, `${cleanId}.md`);
        const scopedPath = path.join(targetStorage.rulesDir, 'scoped', `${cleanId}.md`);
        const targetPath = fs.existsSync(corePath)
          ? corePath
          : fs.existsSync(scopedPath)
            ? scopedPath
            : null;
        if (
          !targetPath ||
          (!isRealSubpathOf(targetStorage.rootDir, targetPath) &&
            !isRealSubpathOf(targetStorage.evoDir, targetPath)) ||
          !existingRule
        ) {
          return { status: 404, body: { ok: false, error: `Not Found: Rule "${cleanId}" not found` } };
        }

        const isCore =
          meta.core !== undefined ? Boolean(meta.core === true || meta.core === 'true') : existingRule.core;
        const scopeGlob = meta.scope_glob ? String(meta.scope_glob).trim() : existingRule.scope_glob;
        const parsedScenarios = Array.isArray(meta.transfer_scenarios)
          ? meta.transfer_scenarios.map(String).filter(Boolean)
          : [];
        const rawScenarios =
          parsedScenarios.length > 0 ? parsedScenarios : existingRule.transfer_scenarios || [];
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
          title:
            typeof params.title === 'string' && params.title.trim()
              ? params.title.trim()
              : meta.title
                ? String(meta.title).trim()
                : existingRule.title,
          l0_summary:
            typeof params.l0_summary === 'string' && params.l0_summary.trim()
              ? params.l0_summary.trim()
              : meta.l0_summary
                ? String(meta.l0_summary).trim()
                : existingRule.l0_summary,
          scope_glob:
            typeof params.scope_glob === 'string' && params.scope_glob.trim()
              ? params.scope_glob.trim()
              : scopeGlob,
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
          origin: meta.origin ? String(meta.origin) : existingRule.origin || 'session',
          supersedes_id: cleanId,
          enabled: preservedEnabled,
          review_status: preservedReviewStatus,
        };
      } else if (rawKind === 'skill') {
        const existingSkill = targetStorage.getSkill(cleanId);
        const skillPath = path.join(targetStorage.skillsDir, cleanId, 'SKILL.md');
        if (
          !fs.existsSync(skillPath) ||
          (!isRealSubpathOf(targetStorage.rootDir, skillPath) &&
            !isRealSubpathOf(targetStorage.evoDir, skillPath)) ||
          !existingSkill
        ) {
          return { status: 404, body: { ok: false, error: `Not Found: Skill "${cleanId}" not found` } };
        }

        const trimmedBody = body.trim();
        let l1_contract: string;
        let l2_sop: string;
        if (hasStructuredSkillFields) {
          l1_contract =
            typeof params.l1_contract === 'string' && params.l1_contract.trim()
              ? params.l1_contract.trim()
              : existingSkill.l1_contract || 'Standard skill contract';
          l2_sop =
            typeof params.l2_sop === 'string' && params.l2_sop.trim()
              ? params.l2_sop.trim()
              : existingSkill.l2_sop || '';
        } else {
          const parsedSec = parseSkillSectionsFromMarkdown(trimmedBody);
          l1_contract = parsedSec.l1 || existingSkill.l1_contract || 'Standard skill contract';
          l2_sop =
            parsedSec.l2 ||
            (!parsedSec.hasL1Header && trimmedBody ? trimmedBody : existingSkill.l2_sop || '');
        }

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
          tags:
            Array.isArray(meta.tags) && meta.tags.length > 0 ? meta.tags.map(String) : existingSkill.tags,
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
          origin: meta.origin ? String(meta.origin) : existingSkill.origin || 'session',
          supersedes_id: cleanId,
          enabled: preservedEnabled,
          review_status: preservedReviewStatus,
        };
      } else if (rawKind === 'memory') {
        const existingMem = targetStorage.getMemory(cleanId);
        const memPath = path.join(targetStorage.memoriesDir, `${cleanId}.md`);
        if (
          !fs.existsSync(memPath) ||
          (!isRealSubpathOf(targetStorage.rootDir, memPath) &&
            !isRealSubpathOf(targetStorage.evoDir, memPath)) ||
          !existingMem
        ) {
          return { status: 404, body: { ok: false, error: `Not Found: Memory "${cleanId}" not found` } };
        }

        const trimmedBody = body.trim();
        let symptom: string;
        let root_cause: string;
        let solution: string;
        if (hasStructuredMemoryFields) {
          symptom =
            typeof params.symptom === 'string' && params.symptom.trim()
              ? params.symptom.trim()
              : existingMem.symptom || 'Observed symptom';
          root_cause =
            typeof params.root_cause === 'string' && params.root_cause.trim()
              ? params.root_cause.trim()
              : existingMem.root_cause || 'Diagnosed root cause';
          solution =
            typeof params.solution === 'string' && params.solution.trim()
              ? params.solution.trim()
              : existingMem.solution || 'Verified solution';
        } else {
          const symptomMatch = trimmedBody.match(/## Symptom\s+([\s\S]*?)(?=## Root Cause|$)/i);
          const rootCauseMatch = trimmedBody.match(/## Root Cause\s+([\s\S]*?)(?=## Solution|$)/i);
          const solutionMatch = trimmedBody.match(/## Solution\s+([\s\S]*)$/i);
          symptom =
            symptomMatch && symptomMatch[1].trim()
              ? symptomMatch[1].trim()
              : !rootCauseMatch && !solutionMatch && trimmedBody
                ? trimmedBody
                : existingMem.symptom || 'Observed symptom';
          root_cause =
            rootCauseMatch && rootCauseMatch[1].trim()
              ? rootCauseMatch[1].trim()
              : existingMem.root_cause || 'Diagnosed root cause';
          solution =
            solutionMatch && solutionMatch[1].trim()
              ? solutionMatch[1].trim()
              : existingMem.solution || 'Verified solution';
        }

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

        const nextTargetSymbols = (
          Array.isArray(meta.target_symbols) && meta.target_symbols.length > 0
            ? meta.target_symbols.map((s) => String(s))
            : existingMem.target_symbols || []
        )
          .map(normalizeSymbolForCompare)
          .filter(Boolean);
        const prevTargetSymbols = (existingMem.target_symbols || [])
          .map(normalizeSymbolForCompare)
          .filter(Boolean);
        const sameTargetSymbols =
          prevTargetSymbols.length === nextTargetSymbols.length &&
          prevTargetSymbols.every((s, idx) => s === nextTargetSymbols[idx]);

        const explicitMetaCommit =
          typeof meta.created_commit === 'string' ? meta.created_commit.trim() : '';
        const resolvedCreatedCommit = explicitMetaCommit
          ? explicitMetaCommit !== 'uncommitted'
            ? explicitMetaCommit
            : undefined
          : sameTargetSymbols && existingMem.created_commit && existingMem.created_commit !== 'uncommitted'
            ? existingMem.created_commit
            : undefined;

        preserveMemoryAnchorOnEdit = sameTargetSymbols && Boolean(resolvedCreatedCommit);

        payload = {
          kind: 'memory',
          id: cleanId,
          title: meta.title ? String(meta.title).trim() : existingMem.title || cleanId,
          l0_summary: meta.l0_summary
            ? String(meta.l0_summary).trim()
            : existingMem.l0_summary || cleanId,
          symptom,
          root_cause,
          solution,
          target_symbols: nextTargetSymbols,
          tags: Array.isArray(meta.tags) ? meta.tags.map(String) : existingMem.tags,
          origin: meta.origin ? String(meta.origin) : existingMem.origin || 'session',
          supersedes_id: cleanId,
          enabled: preservedEnabled,
          review_status: preservedReviewStatus,
          ...(resolvedCreatedCommit ? { created_commit: resolvedCreatedCommit } : {}),
          created_branch:
            typeof meta.created_branch === 'string' && meta.created_branch.trim()
              ? meta.created_branch.trim()
              : sameTargetSymbols
                ? existingMem.created_branch
                : undefined,
        };
      } else if (rawKind === 'preference') {
        const existingPref = targetStorage.getPreference(cleanId);
        const prefPath = path.join(targetStorage.preferencesDir, `${cleanId}.md`);
        if (
          !fs.existsSync(prefPath) ||
          (!isRealSubpathOf(targetStorage.rootDir, prefPath) &&
            !isRealSubpathOf(targetStorage.evoDir, prefPath)) ||
          !existingPref
        ) {
          return {
            status: 404,
            body: { ok: false, error: `Not Found: Preference "${cleanId}" not found` },
          };
        }

        const rawCategory =
          typeof params.category === 'string'
            ? params.category.trim().toLowerCase()
            : meta.category !== undefined
              ? String(meta.category).trim().toLowerCase()
              : existingPref.category;
        const category: PreferenceCategory = PREFERENCE_CATEGORIES.includes(
          rawCategory as PreferenceCategory
        )
          ? (rawCategory as PreferenceCategory)
          : existingPref.category;

        const alwaysOn =
          typeof params.always_on === 'boolean'
            ? params.always_on
            : meta.always_on !== undefined
              ? !(meta.always_on === false || meta.always_on === 'false')
              : existingPref.always_on;

        preservedEnabled =
          meta.enabled !== undefined
            ? meta.enabled === false || meta.enabled === 'false'
              ? false
              : true
            : existingPref.enabled;
        preservedReviewStatus =
          meta.review_status === 'pending' || meta.review_status === 'approved'
            ? meta.review_status
            : existingPref.review_status;

        const prefTitle =
          typeof params.title === 'string' && params.title.trim()
            ? params.title.trim()
            : meta.title
              ? String(meta.title).trim()
              : existingPref.title;
        const prefL0 =
          typeof params.l0_summary === 'string' && params.l0_summary.trim()
            ? params.l0_summary.trim()
            : meta.l0_summary
              ? String(meta.l0_summary).trim()
              : existingPref.l0_summary || body.replace(/\s+/g, ' ').trim().slice(0, 130);

        const prefTriggerCue =
          typeof params.trigger_cue === 'string'
            ? params.trigger_cue.trim()
            : typeof meta.trigger_cue === 'string'
              ? meta.trigger_cue.trim()
              : existingPref.trigger_cue;

        payload = {
          kind: 'preference',
          id: cleanId,
          title: prefTitle,
          l0_summary: prefL0,
          category,
          always_on: alwaysOn,
          ...(prefTriggerCue ? { trigger_cue: prefTriggerCue } : {}),
          scope: resolved.isGlobal ? 'global' : 'project',
          content: body.trim(),
          tags: Array.isArray(params.tags)
            ? params.tags.map(String)
            : Array.isArray(meta.tags)
              ? meta.tags.map(String)
              : existingPref.tags,
          origin: meta.origin ? String(meta.origin) : existingPref.origin || 'session',
          supersedes_id: cleanId,
          enabled: preservedEnabled,
          review_status: preservedReviewStatus,
        };
      } else {
        const tool = targetStorage.getTool(cleanId);
        if (
          !tool ||
          !fs.existsSync(tool.script_path) ||
          (!isRealSubpathOf(targetStorage.rootDir, tool.script_path) &&
            !isRealSubpathOf(targetStorage.evoDir, tool.script_path))
        ) {
          return { status: 404, body: { ok: false, error: `Not Found: Tool "${cleanId}" not found` } };
        }

        preservedEnabled = tool.enabled;
        preservedReviewStatus = tool.review_status;

        payload = {
          kind: 'tool',
          id: cleanId,
          title: tool.title || cleanId,
          l0_summary: tool.l0_summary || (tool as any).description || 'Tool',
          runtime: tool.runtime,
          script_code: effectiveRawContent,
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

      const telem = new EvoTelemetry(targetStorage);
      let gateRes;
      try {
        const gatekeeper = new EvoGatekeeper(targetStorage, telem);
        gateRes = await gatekeeper.evaluateAndCommitAsync(payload, {
          bypassConfoundedCheck: true,
          ...(preserveMemoryAnchorOnEdit ? { preserveAnchorOnMetadataEdit: true } : {}),
        });
        if (gateRes.passed) {
          telem.syncFromDisk(true);
        }
      } finally {
        telem.close();
      }

      if (!gateRes.passed) {
        const snapshot = buildSnapshotSafe(ws, hooks);
        hooks.notifyChange?.();
        return {
          status: 400,
          body: {
            ok: false,
            code: gateRes.error_code,
            gate_failed: gateRes.gate_failed,
            error: gateRes.message || 'Gatekeeper rejected content update',
            snapshot,
          },
        };
      }

      const isGlobalTarget = resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir);
      if (rawKind === 'preference' || (rawKind === 'skill' && isGlobalTarget)) {
        if (isGlobalTarget) {
          await invokeSyncGlobalUserProfile(targetStorage.rootDir, hooks);
        } else {
          await invokeSyncRuleBlocks(ws, hooks);
        }
      } else if (rawKind !== 'memory') {
        if (!isGlobalTarget) {
          await invokeSyncRuleBlocks(ws, hooks);
        }
      } else {
        const updatedMem = targetStorage.getMemory(cleanId);
        if (updatedMem) {
          const dbPath = path.join(targetStorage.cacheDir, 'telemetry.db');
          let cacheDb: DatabaseSync | undefined;
          try {
            if (fs.existsSync(dbPath)) cacheDb = openSqliteReadOnly(dbPath);
            await verifyMemoryFreshnessAsync(targetStorage.rootDir, updatedMem, {
              includeCallers: true,
              cacheDb,
            });
          } finally {
            if (cacheDb) {
              try {
                cacheDb.close();
              } catch {}
            }
          }
        }
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      return {
        status: 200,
        body: {
          ok: true,
          action: 'update-content',
          snapshot,
          data: {
            id: cleanId,
            kind: rawKind,
            tier: resolved.isGlobal ? 'GLOBAL' : 'LOCAL',
            updated: true,
            snapshot,
          },
        },
      };
    }

    case 'create-preference': {
      const rawContent = typeof params.content === 'string' ? params.content.trim() : '';
      const rawL0 = typeof params.l0_summary === 'string' ? params.l0_summary.trim() : '';
      const rawTitle = typeof params.title === 'string' ? params.title.trim() : '';
      const content = rawContent || rawL0 || rawTitle;
      if (!content) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Preference content is required' },
        };
      }

      const title = rawTitle || rawL0 || content.split(/\r?\n/)[0].slice(0, 72);
      const l0Summary =
        rawL0 ||
        (rawTitle ? rawTitle.replace(/\s+/g, ' ').slice(0, 130) : '') ||
        content.replace(/\s+/g, ' ').slice(0, 130);
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      const sanitizedFromRaw = rawId ? sanitizeId(rawId) : '';
      if (rawId && !sanitizedFromRaw) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Invalid preference id' },
        };
      }
      const sanitizedFromTitle = sanitizeId(title);
      const cleanId =
        sanitizedFromRaw ||
        (sanitizedFromTitle.length >= 3
          ? sanitizedFromTitle
          : `pref-${crypto.createHash('sha256').update(`${title}\0${content}`).digest('hex').slice(0, 8)}`);

      const rawCategory =
        typeof params.category === 'string' ? params.category.trim().toLowerCase() : 'style';
      if (!PREFERENCE_CATEGORIES.includes(rawCategory as PreferenceCategory)) {
        return {
          status: 400,
          body: {
            ok: false,
            code: 'ERR_INVALID_SCHEMA',
            error: `Invalid preference category '${rawCategory}'. Must be one of: ${PREFERENCE_CATEGORIES.join(', ')}`,
          },
        };
      }
      const category = rawCategory as PreferenceCategory;
      const alwaysOn = params.always_on === false || params.always_on === 'false' ? false : true;
      const tags = Array.isArray(params.tags) ? params.tags.map(String).filter(Boolean) : [];
      const supersedesCleanId =
        typeof params.supersedes_id === 'string' && params.supersedes_id.trim()
          ? sanitizeId(params.supersedes_id)
          : '';
      const lookupId = sanitizedFromRaw || supersedesCleanId || cleanId;
      const resolved = resolveTargetStorage(ws, 'preference', params, lookupId);
      const targetStorage = resolved.storage;
      const existingPref = targetStorage.getPreference(cleanId);
      const supersededPref =
        !existingPref && supersedesCleanId ? targetStorage.getPreference(supersedesCleanId) : null;
      const basePref = existingPref ?? supersededPref;
      targetStorage.ensureInitialized();

      const payload: ProposalPayload = {
        kind: 'preference',
        id: cleanId,
        title,
        l0_summary: l0Summary,
        category,
        always_on: alwaysOn,
        ...(typeof params.trigger_cue === 'string' && params.trigger_cue.trim()
          ? { trigger_cue: params.trigger_cue.trim() }
          : {}),
        scope: resolved.isGlobal ? 'global' : 'project',
        content,
        tags,
        origin: typeof params.origin === 'string' && params.origin.trim() ? params.origin.trim() : 'ui',
        enabled: params.enabled === false ? false : true,
        review_status:
          params.review_status === 'pending' || params.review_status === 'approved'
            ? params.review_status
            : (basePref?.review_status || 'approved'),
        ...(supersedesCleanId ? { supersedes_id: supersedesCleanId } : {}),
      };

      const telem = new EvoTelemetry(targetStorage);
      let gateRes;
      try {
        const gatekeeper = new EvoGatekeeper(targetStorage, telem);
        gateRes = await gatekeeper.evaluateAndCommitAsync(payload, { bypassConfoundedCheck: true });
        if (gateRes.passed) {
          telem.syncFromDisk(true);
        }
      } finally {
        telem.close();
      }

      if (!gateRes.passed) {
        const snapshot = buildSnapshotSafe(ws, hooks);
        return {
          status: 400,
          body: {
            ok: false,
            code: gateRes.error_code,
            gate_failed: gateRes.gate_failed,
            error: gateRes.message || 'Gatekeeper rejected preference creation',
            details: gateRes.low_value_candidates,
            snapshot,
          },
        };
      }

      let syncRes: ProfileSyncResult | undefined;
      if (resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir)) {
        syncRes = await invokeSyncGlobalUserProfile(targetStorage.rootDir, hooks);
      } else {
        await invokeSyncRuleBlocks(ws, hooks);
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      const receipt = `🧬 EvoKernel Evolution Receipt: [preference] ${cleanId} (${l0Summary})`;
      return {
        status: 200,
        body: {
          ok: true,
          action: 'create-preference',
          snapshot,
          data: {
            id: cleanId,
            scope: resolved.isGlobal ? 'global' : 'project',
            syncedTargets: syncRes?.updatedTargets || [],
            ...(syncRes?.warnings?.length ? { warnings: syncRes.warnings } : {}),
            receipt,
            snapshot,
          },
        },
      };
    }

    case 'undo-preference': {
      const hasExplicitId = params.id !== undefined && params.id !== null;
      const rawId = typeof params.id === 'string' ? params.id.trim() : '';
      const targetId = rawId ? sanitizeId(rawId) : undefined;
      if (hasExplicitId && !targetId) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Invalid preference id' },
        };
      }
      let resolved = resolveTargetStorage(ws, 'preference', params, targetId);
      if (
        targetId &&
        !params.tier &&
        !params.scope &&
        resolved.isGlobal &&
        hasValidEvoStructure(localStorage.evoDir) &&
        !isGlobalFallbackRoot(ws)
      ) {
        const hasLocalMatch =
          Boolean(localStorage.getPreference(targetId)) ||
          localStorage.listArchivedCapabilities().some((a) => a.kind === 'preference' && a.id === targetId) ||
          localStorage.listProfileHistory(50).some((e) => sanitizeId(e.id) === targetId);
        if (hasLocalMatch) {
          resolved = { storage: localStorage, isGlobal: false, rootDir: ws };
        }
      }
      const targetStorage = resolved.storage;
      const undoFn = (targetStorage as any).undoLastProfileChange;
      if (typeof undoFn !== 'function') {
        return {
          status: 400,
          body: {
            ok: false,
            code: 'ERR_UNDO_UNAVAILABLE',
            error: 'Undo history is not available on EvoStorage yet',
          },
        };
      }

      const undoRes = await undoFn.call(targetStorage, targetId);
      if (!undoRes || (typeof undoRes === 'object' && undoRes.ok === false)) {
        return {
          status: 400,
          body: {
            ok: false,
            error:
              (typeof undoRes === 'object' && (undoRes?.error || undoRes?.message)) ||
              'No reversible profile change available to undo',
          },
        };
      }

      let syncRes: ProfileSyncResult | undefined;
      if (resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir)) {
        syncRes = await invokeSyncGlobalUserProfile(targetStorage.rootDir, hooks);
      } else {
        await invokeSyncRuleBlocks(ws, hooks);
      }
      const telem = new EvoTelemetry(targetStorage);
      try {
        telem.syncFromDisk(true);
      } finally {
        telem.close();
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      return {
        status: 200,
        body: {
          ok: true,
          action: 'undo-preference',
          snapshot,
          data: {
            undone: undoRes,
            syncedTargets: syncRes?.updatedTargets || [],
            snapshot,
          },
        },
      };
    }

    case 'sync-profile': {
      const globalRoot = resolveGlobalFallbackDir();
      const syncRes = await invokeSyncGlobalUserProfile(globalRoot, hooks, {
        dryRun: Boolean(params.dryRun),
      });
      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      return {
        status: 200,
        body: {
          ok: true,
          action: 'sync-profile',
          snapshot,
          data: {
            ...syncRes,
            syncedHosts: syncRes.syncedHosts ?? syncRes.updatedTargets,
            snapshot,
          },
        },
      };
    }

    case 'import-profile-markdown': {
      const rawMd =
        typeof params.markdown === 'string'
          ? params.markdown
          : typeof params.content === 'string'
            ? params.content
            : '';
      if (!rawMd.trim()) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Missing markdown content to import' },
        };
      }
      const rawCat =
        typeof params.category === 'string' ? params.category.trim().toLowerCase() : '';
      const explicitCategory: PreferenceCategory | undefined =
        rawCat && PREFERENCE_CATEGORIES.includes(rawCat as PreferenceCategory)
          ? (rawCat as PreferenceCategory)
          : undefined;
      const rawMode = typeof params.mode === 'string' ? params.mode.trim().toLowerCase() : '';
      const hasExplicitAlwaysOnFalse =
        rawMode === 'on-demand' || params.always_on === false || params.always_on === 'false';
      const hasExplicitAlwaysOnTrue =
        rawMode === 'always-on' || (rawMode === '' && (params.always_on === true || params.always_on === 'true'));
      const dryRun = Boolean(params.dryRun);

      const candidates = parseMarkdownToPreferenceCandidates(
        rawMd,
        typeof params.sourceLabel === 'string' ? params.sourceLabel : undefined
      );
      if (candidates.length === 0) {
        return {
          status: 400,
          body: {
            ok: false,
            error: 'Bad Request: No importable preference bullets or sections found in markdown',
          },
        };
      }

      const resolved = resolveTargetStorage(ws, 'preference', params);
      const targetStorage = resolved.storage;
      if (!dryRun) {
        targetStorage.ensureInitialized();
      }

      const imported: Array<{ id: string; title: string; category: PreferenceCategory; always_on: boolean }> = [];
      const rejected: Array<{
        id: string;
        title: string;
        error_code?: string;
        message: string;
      }> = [];

      const telem = dryRun
        ? createDryRunReadOnlyTelemetry(targetStorage)
        : new EvoTelemetry(targetStorage);
      try {
        const gatekeeper = new EvoGatekeeper(targetStorage, telem);
        for (const cand of candidates) {
          const candCategory = explicitCategory || cand.category;
          const candAlwaysOn = hasExplicitAlwaysOnFalse
            ? false
            : hasExplicitAlwaysOnTrue
              ? true
              : cand.always_on;
          const payload: ProposalPayload = {
            kind: 'preference',
            id: cand.id,
            title: cand.title,
            l0_summary: cand.l0_summary,
            category: candCategory,
            always_on: candAlwaysOn,
            ...(cand.trigger_cue ? { trigger_cue: cand.trigger_cue } : {}),
            scope: resolved.isGlobal ? 'global' : 'project',
            content: cand.content,
            origin: 'imported',
            enabled: true,
            review_status: 'approved',
          };
          const gateRes = await gatekeeper.evaluateAndCommitAsync(payload, {
            bypassConfoundedCheck: true,
            dryRun,
          });
          if (gateRes.passed) {
            imported.push({ id: cand.id, title: cand.title, category: candCategory, always_on: candAlwaysOn });
          } else {
            rejected.push({
              id: cand.id,
              title: cand.title,
              error_code: gateRes.error_code,
              message: gateRes.message,
            });
          }
        }
        if (imported.length > 0 && !dryRun) {
          telem.syncFromDisk(true);
        }
      } finally {
        telem.close();
      }

      let syncRes: ProfileSyncResult | undefined;
      if (imported.length > 0 && !dryRun) {
        if (resolved.isGlobal || isGlobalFallbackRoot(targetStorage.rootDir)) {
          syncRes = await invokeSyncGlobalUserProfile(targetStorage.rootDir, hooks);
        } else {
          await invokeSyncRuleBlocks(ws, hooks);
        }
      }

      const snapshot = buildSnapshotSafe(ws, hooks);
      if (imported.length > 0 && !dryRun) {
        hooks.notifyChange?.();
      }
      return {
        status: 200,
        body: {
          ok: true,
          action: 'import-profile-markdown',
          snapshot,
          data: {
            importedCount: imported.length,
            rejectedCount: rejected.length,
            imported,
            rejected,
            syncedTargets: syncRes?.updatedTargets || [],
            ...(syncRes?.warnings?.length ? { warnings: syncRes.warnings } : {}),
            snapshot,
          },
        },
      };
    }

    case 'create-memory': {
      const targetFile = typeof params.filePath === 'string' ? params.filePath.trim() : '';
      const symptom = typeof params.symptom === 'string' ? params.symptom.trim() : '';
      const rootCause = typeof params.root_cause === 'string' ? params.root_cause.trim() : '';
      const solution = typeof params.solution === 'string' ? params.solution.trim() : '';
      if (!symptom || !solution) {
        return {
          status: 400,
          body: { ok: false, error: 'Bad Request: Symptom and solution are required to record a lesson.' },
        };
      }
      const rawTitle =
        typeof params.title === 'string' && params.title.trim()
          ? params.title.trim()
          : symptom.slice(0, 72);
      const rawL0 =
        typeof params.l0_summary === 'string' && params.l0_summary.trim()
          ? params.l0_summary.trim()
          : `${rawTitle}: ${solution}`.slice(0, 130);
      const rawTargets = Array.isArray(params.target_symbols)
        ? params.target_symbols.map((s: unknown) => String(s).trim()).filter(Boolean)
        : targetFile
          ? [targetFile]
          : [];
      const rawId = typeof params.id === 'string' && params.id.trim() ? sanitizeId(params.id.trim()) : '';
      const cleanId =
        rawId && rawId.length >= 3
          ? rawId
          : `mem-${crypto.createHash('sha256').update(`${targetFile}\0${rawTitle}\0${symptom}`).digest('hex').slice(0, 8)}`;

      localStorage.ensureInitialized();
      const telem = new EvoTelemetry(localStorage);
      let gateRes;
      try {
        const gatekeeper = new EvoGatekeeper(localStorage, telem);
        gateRes = await gatekeeper.evaluateAndCommitAsync(
          {
            kind: 'memory',
            id: cleanId,
            title: rawTitle,
            l0_summary: rawL0,
            symptom,
            root_cause: rootCause || symptom,
            solution,
            target_symbols: rawTargets,
            ...(rawTargets.length === 0 ? { memory_type: 'personal' as const } : {}),
            origin: 'workbench',
            enabled: true,
            review_status: 'approved',
          },
          { bypassConfoundedCheck: true }
        );
        if (gateRes.passed) {
          telem.syncFromDisk(true);
        }
      } finally {
        telem.close();
      }
      if (!gateRes.passed) {
        const snapshot = buildSnapshotSafe(ws, hooks);
        return {
          status: 400,
          body: {
            ok: false,
            code: gateRes.error_code,
            gate_failed: gateRes.gate_failed,
            error: gateRes.message || 'Gatekeeper rejected memory creation',
            snapshot,
          },
        };
      }
      const snapshot = buildSnapshotSafe(ws, hooks);
      hooks.notifyChange?.();
      return {
        status: 200,
        body: {
          ok: true,
          action: 'create-memory',
          snapshot,
          data: { id: cleanId, snapshot },
        },
      };
    }

    case 'export-html': {
      if (hooks.exportHtml) {
        return await hooks.exportHtml(ws, params);
      }
      return {
        status: 400,
        body: { ok: false, error: 'Bad Request: export-html is not available in this context' },
      };
    }

    default:
      return {
        status: 400,
        body: { ok: false, error: `Bad Request: Unknown action "${action}"` },
      };
  }
}
