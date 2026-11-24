import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

import { buildUiSnapshot, exportUiHtml } from '../cli/ui.js';
import type { UiSnapshot } from '../cli/ui.js';
import { renderUiClientHtml } from '../templates/ui-client.js';
import { findNearestEvoWorkspace, hasValidEvoStructure } from '../core/storage.js';
import { isRealSubpathOf } from '../core/memory.js';
import { syncManagedRuleBlocks } from '../cli/init.js';
import { executeWorkbenchAction } from '../core/workbench-actions.js';

// --- Ambient Structural Types for VS Code API (Zero Runtime Dependencies) ---
export type Thenable<T> = PromiseLike<T>;

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
    showSaveDialog?(options?: { defaultUri?: VsCodeUri; filters?: Record<string, string[]>; saveLabel?: string }): Promise<VsCodeUri | undefined> | Thenable<VsCodeUri | undefined>;
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

const IGNORED_CHILD_SCAN_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
]);

function parseUriQueryPath(uri: any): string {
  if (typeof uri?.query !== 'string' || !uri.query.trim()) return '';
  try {
    const parsed = JSON.parse(uri.query) as { path?: unknown };
    if (typeof parsed?.path === 'string') {
      const trimmed = parsed.path.trim();
      if (trimmed && path.isAbsolute(trimmed)) return trimmed;
    }
  } catch {}
  return '';
}

function extractEditorFsPath(uri: any): string {
  if (!uri || typeof uri !== 'object') return '';
  const scheme = typeof uri.scheme === 'string' ? uri.scheme.trim().toLowerCase() : '';
  if (scheme === 'untitled' || scheme === 'output' || scheme === 'vscode-webview' || scheme === 'webview' || scheme === 'inmemory') {
    return '';
  }

  const queryPath = parseUriQueryPath(uri);
  if (scheme === 'git' && queryPath) {
    return queryPath;
  }

  if (typeof uri.fsPath === 'string') {
    const fsPath = uri.fsPath.trim();
    if (fsPath && path.isAbsolute(fsPath)) {
      return fsPath;
    }
  }

  if (queryPath) {
    return queryPath;
  }

  if (scheme === 'file' && typeof uri.path === 'string') {
    const rawPath = uri.path.trim();
    if (rawPath && path.isAbsolute(rawPath)) {
      return rawPath;
    }
  }

  return '';
}

function findChildEvoWorkspace(parentDir: string, maxDepth = 2): string | null {
  if (!parentDir) return null;
  if (hasValidEvoStructure(path.join(parentDir, '.evo'))) {
    return parentDir;
  }

  const queue: Array<{ dir: string; depth: number }> = [{ dir: parentDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs
        .readdirSync(current.dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      continue;
    }

    const nextDirs: Array<{ dir: string; depth: number }> = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_CHILD_SCAN_DIRS.has(entry.name)) {
        continue;
      }
      const childPath = path.join(current.dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(childPath).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      if (hasValidEvoStructure(path.join(childPath, '.evo'))) {
        return childPath;
      }
      if (current.depth + 1 < maxDepth) {
        nextDirs.push({ dir: childPath, depth: current.depth + 1 });
      }
    }
    queue.push(...nextDirs);
  }

  return null;
}

export function resolveActiveWorkspaceRoot(vscode: any, fallbackCwd: string = process.cwd()): string {
  const activeDocUri = vscode?.window?.activeTextEditor?.document?.uri;
  const docFsPath = extractEditorFsPath(activeDocUri);
  if (docFsPath) {
    const nearestFromDoc = findNearestEvoWorkspace(docFsPath);
    if (nearestFromDoc) return nearestFromDoc;
  }

  let activeFolderFallback = '';
  if (activeDocUri) {
    const folder = vscode?.workspace?.getWorkspaceFolder?.(activeDocUri);
    const folderPath = folder?.uri?.fsPath || folder?.fsPath || '';
    if (folderPath) {
      const nearestFromFolder = findNearestEvoWorkspace(folderPath);
      if (nearestFromFolder) return nearestFromFolder;
      const childFromFolder = findChildEvoWorkspace(folderPath, 2);
      if (childFromFolder) return childFromFolder;
      activeFolderFallback = folderPath;
    }
  }

  const folders = vscode?.workspace?.workspaceFolders;
  if (Array.isArray(folders) && folders.length > 0) {
    for (const f of folders) {
      const fsPath = f?.uri?.fsPath || f?.fsPath;
      if (fsPath) {
        if (hasValidEvoStructure(path.join(fsPath, '.evo'))) {
          return fsPath;
        }
        const nearest = findNearestEvoWorkspace(fsPath);
        if (nearest) return nearest;
      }
    }
    // Check depth 1-2 subdirectories when a parent/umbrella directory was opened
    for (const f of folders) {
      const fsPath = f?.uri?.fsPath || f?.fsPath;
      if (fsPath) {
        const childWs = findChildEvoWorkspace(fsPath, 2);
        if (childWs) return childWs;
      }
    }
    const firstPath = folders[0]?.uri?.fsPath || folders[0]?.fsPath || '';
    if (activeFolderFallback || firstPath) {
      return activeFolderFallback || firstPath;
    }
  }

  if (activeFolderFallback) {
    return activeFolderFallback;
  }

  const nearestCwd = findNearestEvoWorkspace(fallbackCwd);
  if (nearestCwd) return nearestCwd;

  const childCwd = findChildEvoWorkspace(fallbackCwd, 2);
  if (childCwd) return childCwd;

  return fallbackCwd;
}

export function buildSecuredWebviewHtml(snapshot: UiSnapshot): string {
  let html = renderUiClientHtml(snapshot, { token: '', isExport: false, anon: false }).replace(/\r\n/g, '\n');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const scriptContent = scriptMatch[1];
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
  vscode?: any
): Promise<{
  ok: boolean;
  data?: any;
  result?: any;
  snapshot?: any;
  tokenUsage?: number;
  error?: string;
  code?: string;
  gate_failed?: string;
  details?: any;
}> {
  try {
    const res = await executeWorkbenchAction(ws, action, params || {}, {
      buildSnapshot: (targetWs, opts) => buildUiSnapshot(targetWs, opts),
      allowEvoDirOpen: true,
      syncRuleBlocks: syncManagedRuleBlocks,
      openEditor: async (targetPath, line) => {
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

        return { opened: targetPath, line, editor: 'vscode-api', launched: true };
      },
      exportHtml: async (targetWs, exportParams) => {
        const defaultExportFilename = `evo-workbench-${new Date().toISOString().slice(0, 10)}.html`;
        let outPath = '';
        if (typeof exportParams?.outPath === 'string' && exportParams.outPath.trim()) {
          const resolvedOut = path.resolve(targetWs, exportParams.outPath.trim());
          if (!isRealSubpathOf(targetWs, resolvedOut)) {
            return {
              status: 403,
              body: { ok: false, error: 'Forbidden: Export path outside workspace root' },
            };
          }
          outPath = resolvedOut;
        } else if (typeof vscode?.window?.showSaveDialog === 'function') {
          const defaultUri = vscode?.Uri?.file
            ? vscode.Uri.file(path.join(targetWs, defaultExportFilename))
            : undefined;
          const selectedUri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { HTML: ['html'] },
            saveLabel: 'Export EvoKernel Workbench HTML',
          });
          if (!selectedUri) {
            return { status: 200, body: { ok: true, data: { cancelled: true } } };
          }
          outPath = selectedUri.fsPath || selectedUri.path || path.join(targetWs, defaultExportFilename);
        } else {
          outPath = path.join(targetWs, defaultExportFilename);
        }
        const exportAnon = exportParams?.anon === false ? false : true;
        exportUiHtml(targetWs, outPath, { anon: exportAnon });
        return {
          status: 200,
          body: { ok: true, data: { path: outPath, exportedPath: outPath } },
        };
      },
    });
    return res.body;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Internal action dispatch error' };
  }
}

// Alias for architecture report compatibility
export const dispatchExtensionAction = handleWebviewAction;

let activePanel: VsCodeWebviewPanel | undefined = undefined;
let activePanelWatchers: fs.FSWatcher[] = [];
let activePanelDebounce: ReturnType<typeof setTimeout> | undefined = undefined;
const disposedPanels = new WeakSet<VsCodeWebviewPanel>();

function disposeActivePanelResources(): void {
  if (activePanelDebounce) {
    clearTimeout(activePanelDebounce);
    activePanelDebounce = undefined;
  }
  for (const w of activePanelWatchers) {
    try {
      w.close();
    } catch {}
  }
  activePanelWatchers = [];
}

export function getActivePanel(): VsCodeWebviewPanel | undefined {
  return activePanel;
}

export async function activate(
  context: VsCodeExtensionContext | any,
  vscodeOverride?: any
): Promise<void> {
  const vscode = resolveVsCode(vscodeOverride);
  if (!vscode) return;

  let currentWs = '';

  const pushSnapshot = () => {
    if (!activePanel || disposedPanels.has(activePanel) || !currentWs) return;
    try {
      const snap = buildUiSnapshot(currentWs);
      if (!activePanel || disposedPanels.has(activePanel)) return;
      void activePanel.webview.postMessage({
        type: 'evoSnapshotPush',
        snapshot: snap,
      });
    } catch {}
  };

  const scheduleSnapshotPush = () => {
    if (activePanelDebounce) clearTimeout(activePanelDebounce);
    activePanelDebounce = setTimeout(() => {
      activePanelDebounce = undefined;
      pushSnapshot();
    }, 250);
  };

  const attachWatchers = (wsRoot: string) => {
    disposeActivePanelResources();
    const evoDir = path.join(wsRoot, '.evo');
    if (fs.existsSync(evoDir)) {
      try {
        const w = fs.watch(evoDir, { recursive: true }, (_e, f) => {
          if (!f) {
            scheduleSnapshotPush();
            return;
          }
          const norm = String(f).replace(/\\/g, '/');
          if (norm.startsWith('.cache') || norm.includes('telemetry.db')) {
            return;
          }
          scheduleSnapshotPush();
        });
        w.on('error', () => {});
        activePanelWatchers.push(w);
      } catch {}
    }
    const gitHead = path.join(wsRoot, '.git', 'HEAD');
    if (fs.existsSync(gitHead)) {
      try {
        const w = fs.watch(gitHead, () => scheduleSnapshotPush());
        w.on('error', () => {});
        activePanelWatchers.push(w);
      } catch {}
    }
  };

  const syncResolvedWorkspace = (
    forcePush = false,
    hasActiveEditor = Boolean(vscode?.window?.activeTextEditor)
  ) => {
    if (!activePanel) return;
    // Switching focus to a non-text view (e.g., the Workbench Webview itself) leaves activeTextEditor
    // undefined; preserve an already-valid active workspace instead of jumping to the first child folder.
    if (!hasActiveEditor && currentWs && hasValidEvoStructure(path.join(currentWs, '.evo'))) {
      if (forcePush) {
        pushSnapshot();
      }
      return;
    }
    const nextWs = resolveActiveWorkspaceRoot(vscode, currentWs || process.cwd());
    if (nextWs && nextWs !== currentWs) {
      const nextHasEvo = hasValidEvoStructure(path.join(nextWs, '.evo'));
      const currHasEvo = currentWs ? hasValidEvoStructure(path.join(currentWs, '.evo')) : false;
      if (nextHasEvo || !currHasEvo) {
        currentWs = nextWs;
        attachWatchers(currentWs);
        pushSnapshot();
        return;
      }
    }
    if (forcePush) {
      pushSnapshot();
    }
  };

  const openWorkbenchHandler = async () => {
    const ws = resolveActiveWorkspaceRoot(vscode);
    if (!ws) {
      if (vscode?.window?.showWarningMessage) {
        vscode.window.showWarningMessage('EvoKernel: Please open a workspace folder to view Workbench.');
      }
      return;
    }

    currentWs = ws;

    if (activePanel && !disposedPanels.has(activePanel)) {
      activePanel.reveal(vscode?.ViewColumn?.One ?? 1, false);
      attachWatchers(currentWs);
      pushSnapshot();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'evoWorkbench',
      'EvoKernel Workbench',
      vscode?.ViewColumn?.One ?? 1,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );
    activePanel = panel;
    let panelDisposed = false;

    panel.onDidDispose(() => {
      panelDisposed = true;
      disposedPanels.add(panel);
      disposeActivePanelResources();
      if (activePanel === panel) {
        activePanel = undefined;
      }
    }, null, context?.subscriptions);

    panel.onDidChangeViewState?.((e: any) => {
      if (panelDisposed || disposedPanels.has(panel)) return;
      const isVisible = e?.webviewPanel?.visible ?? panel.visible;
      if (!isVisible) return;
      syncResolvedWorkspace(true);
    }, null, context?.subscriptions);

    panel.webview.html = renderWorkbenchHtml(currentWs);
    attachWatchers(currentWs);

    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (panelDisposed || disposedPanels.has(panel)) {
        return;
      }
      if (!message || message.type !== 'evoAction' || !message.reqId || !message.action) {
        return;
      }

      const res = await handleWebviewAction(message.action, message.params || {}, currentWs, vscode);
      if (panelDisposed || disposedPanels.has(panel)) {
        return;
      }
      try {
        await panel.webview.postMessage({
          type: 'evoActionResult',
          reqId: message.reqId,
          action: message.action,
          ...res,
        });
      } catch {}
    }, null, context?.subscriptions);
  };

  const d1 = vscode.commands.registerCommand('evo.openWorkbench', openWorkbenchHandler);
  const d2 = vscode.commands.registerCommand('evo.viewCockpit', openWorkbenchHandler);
  const dEditor = vscode?.window?.onDidChangeActiveTextEditor?.((editor: any) => {
    syncResolvedWorkspace(false, Boolean(editor));
  }, null, context?.subscriptions);
  const dFolders = vscode?.workspace?.onDidChangeWorkspaceFolders?.(() => {
    syncResolvedWorkspace(true, true);
  }, null, context?.subscriptions);

  if (context?.subscriptions) {
    context.subscriptions.push(d1, d2);
    if (dEditor) context.subscriptions.push(dEditor);
    if (dFolders) context.subscriptions.push(dFolders);
  }
}

export function deactivate(): void {
  disposeActivePanelResources();
  if (activePanel) {
    disposedPanels.add(activePanel);
    try {
      activePanel.dispose();
    } catch {}
    activePanel = undefined;
  }
}
