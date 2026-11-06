import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildScoreReport } from './score.js';
import type { ScoreReport } from './score.js';
import { EvoStorage, hasValidEvoStructure, sanitizeId } from '../core/storage.js';
import type { EvoKind } from '../core/types.js';
import { EvoTelemetry, redactSensitiveDiagnostics } from '../core/telemetry.js';
import {
  buildFingerprintsForTargets,
  clearMemoryVerificationCache,
  resolveCurrentGitBranch,
  resolveCurrentGitCommit,
  verifyMemoryFreshness,
} from '../core/memory.js';
import { renderUiClientHtml } from '../templates/ui-client.js';
import { executeSandboxedScript } from '../core/sandbox.js';
import { mountIdeExtensions, syncManagedRuleBlocks } from './init.js';
import { isSubpathOf } from '../mcp/handlers.js';

export interface UiSnapshot {
  score: ScoreReport;
  rules: any[];
  skills: any[];
  tools: any[];
  memories: any[];
  archived: any[];
  gatekeeperEvents: any[];
}

export function buildUiSnapshot(
  workspaceRoot: string,
  options?: { anon?: boolean; cacheDb?: DatabaseSync }
): UiSnapshot {
  const ws = path.resolve(workspaceRoot);
  const storage = new EvoStorage(ws);
  const dbPath = path.join(storage.cacheDir, 'telemetry.db');
  let db: DatabaseSync | undefined = options?.cacheDb;
  let openedDb = false;

  if (!db && fs.existsSync(dbPath)) {
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      openedDb = true;
    } catch {}
  }

  try {
    const score = buildScoreReport(ws, { anon: options?.anon, cacheDb: db });
    const rules: any[] = [];
    const skills: any[] = [];
    const tools: any[] = [];
    const memories: any[] = [];
    const archived: any[] = [];
    let gatekeeperEvents: any[] = [];
    const telemMap = new Map<string, { hit_count: number; attribution: string }>();

    if (db) {
      try {
        const rows = db.prepare(
          'SELECT id, hit_count, helped_count, hurt_count, contested FROM telemetry'
        ).all() as any[];
        for (const r of rows) {
          const h = r.hit_count || 0;
          const attr = r.contested ? 'contested' : (r.hurt_count > r.helped_count ? 'hurt' : (r.helped_count > 0 ? 'helped' : 'unverified'));
          telemMap.set(r.id, { hit_count: h, attribution: attr });
        }
      } catch {}

      try {
        const gRows = db.prepare(
          'SELECT id, timestamp, kind, target_id, target_name, passed, stage_failed, diagnostics FROM gatekeeper_events ORDER BY id DESC LIMIT 200'
        ).all() as any[];
        gatekeeperEvents = gRows.map((r) => ({
          ...r,
          passed: r.passed === 1,
          diagnostics: redactSensitiveDiagnostics(r.diagnostics || '', ws),
        }));
      } catch {}
    }

    const attach = (item: any) => {
      const t = telemMap.get(item.id) || { hit_count: 0, attribution: 'unverified' };
      return { ...item, hit_count: t.hit_count, attribution: t.attribution };
    };

    if (hasValidEvoStructure(storage.evoDir)) {
      try {
        rules.push(...storage.listRules().map(attach));
        skills.push(...storage.listSkills().map(attach));
        tools.push(...storage.listTools().map(attach));
        for (const m of storage.listMemories()) {
          const v = verifyMemoryFreshness(ws, m, { includeCallers: true, cacheDb: db });
          const callers = Array.from(new Set((v.topology_anchors || []).flatMap((a: any) => a.callers || [])));
          memories.push(attach({ ...m, freshness: { ...v, callers } }));
        }
        archived.push(...storage.listArchivedCapabilities());
      } catch {}
    }

    return { score, rules, skills, tools, memories, archived, gatekeeperEvents };
  } finally {
    if (openedDb && db) {
      try { db.close(); } catch {}
    }
  }
}

export interface UiServerOptions {
  port?: number;
  token?: string;
  anon?: boolean;
}

export interface UiServerInstance {
  port: number;
  token: string;
  url: string;
  server: http.Server;
  close: () => Promise<void>;
}

export const MAX_ACTION_BODY_BYTES = 1024 * 1024; // 1MB limit

export function sendJsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): void {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

export function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = MAX_ACTION_BODY_BYTES
): Promise<{ ok: true; body: any } | { ok: false; status: number; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    const onData = (chunk: Buffer) => {
      if (settled) return;
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        settled = true;
        cleanup();
        req.pause();
        resolve({
          ok: false,
          status: 413,
          error: `Payload Too Large: Request body exceeds ${maxBytes} byte limit`,
        });
      } else {
        chunks.push(chunk);
      }
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({ ok: false, status: 400, error: 'Bad Request: Empty request body' });
        return;
      }
      try {
        const body = JSON.parse(raw);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          resolve({ ok: false, status: 400, error: 'Bad Request: Body must be a JSON object' });
          return;
        }
        resolve({ ok: true, body });
      } catch (err: any) {
        resolve({ ok: false, status: 400, error: `Bad Request: Malformed JSON (${err?.message || 'syntax error'})` });
      }
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, status: 400, error: `Bad Request: Stream error (${err.message})` });
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, status: 400, error: 'Bad Request: Connection closed prematurely' });
    };

    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('close', onClose);
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

function findBinaryInPath(binaryName: string): string | null {
  const envPath = process.env.PATH || '';
  const dirs = envPath.split(path.delimiter);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ? process.env.PATHEXT.split(';') : ['.EXE', '.CMD', '.BAT']).map((e) => e.toLowerCase())
    : [''];

  for (const dir of dirs) {
    if (!dir.trim()) continue;
    for (const ext of exts) {
      const candidate = binaryName.toLowerCase().endsWith(ext.toLowerCase()) ? binaryName : `${binaryName}${ext}`;
      const full = path.join(dir, candidate);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return full;
        }
      } catch {}
    }
  }
  return null;
}

export function findEditorExecutable(editorName: string): string | null {
  const pathEnv = process.env.PATH || '';
  const isWindows = process.platform === 'win32';
  const delimiter = path.delimiter;
  const exts = isWindows
    ? (process.env.PATHEXT ? process.env.PATHEXT.split(';') : ['.EXE', '.CMD', '.BAT']).map((e) => e.toLowerCase())
    : [''];
  const dirs = pathEnv.split(delimiter);

  for (const dir of dirs) {
    if (!dir) continue;
    if (isWindows) {
      for (const ext of exts) {
        const full = path.join(dir, editorName + ext);
        try {
          if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
        } catch {}
      }
    } else {
      const full = path.join(dir, editorName);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch {}
    }
  }
  return null;
}

export function isTestEnvironment(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT || process.env.EVO_TEST_MODE);
}

export function launchEditorAtLocation(filePath: string, line: number): { launched: boolean; editor?: string } {
  const targetArg = `${filePath}:${line}`;
  const candidates = ['cursor', 'code', 'windsurf'];

  for (const name of candidates) {
    const execPath = findEditorExecutable(name);
    if (execPath) {
      if (isTestEnvironment()) {
        return { launched: false, editor: name };
      }
      try {
        if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(execPath)) {
          spawn('cmd.exe', ['/c', execPath, '--goto', targetArg], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } else {
          spawn(execPath, ['--goto', targetArg], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        }
        return { launched: true, editor: name };
      } catch {}
    }
  }

  if (isTestEnvironment()) {
    return { launched: false, editor: 'test-noop' };
  }

  // Fallback to platform system opener if no IDE CLI detected
  try {
    if (process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${JSON.stringify(filePath)}`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    }
    return { launched: true, editor: 'system-default' };
  } catch {
    return { launched: false };
  }
}

export function detectChromiumBrowser(): string | null {
  const platform = process.platform;

  if (platform === 'win32') {
    const progFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const progFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const localAppData = process.env.LOCALAPPDATA || '';

    const candidates = [
      path.join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(progFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      localAppData ? path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') : '',
    ].filter(Boolean);

    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch {}
    }

    return findBinaryInPath('msedge.exe') || findBinaryInPath('chrome.exe') || findBinaryInPath('brave.exe');
  }

  if (platform === 'darwin') {
    const home = os.homedir();
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      path.join(home, 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
    ];
    for (const c of macCandidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      } catch {}
    }
    return findBinaryInPath('google-chrome') || findBinaryInPath('microsoft-edge') || findBinaryInPath('chromium');
  }

  // Linux / other Unix
  const linuxCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
  ];
  for (const c of linuxCandidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch {}
  }
  return (
    findBinaryInPath('google-chrome-stable') ||
    findBinaryInPath('google-chrome') ||
    findBinaryInPath('microsoft-edge-stable') ||
    findBinaryInPath('microsoft-edge') ||
    findBinaryInPath('chromium') ||
    findBinaryInPath('chromium-browser')
  );
}

/**
 * Strict local HTTP loopback URL validator.
 * Validates protocol, hostname, absence of userinfo (@ spoofing defense),
 * and valid numeric port range [0, 65535].
 */
export function isValidLocalHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:') return false;
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false;
    if (u.username || u.password) return false;
    const port = parseInt(u.port, 10);
    return Number.isFinite(port) && port >= 0 && port <= 65535;
  } catch {
    return false;
  }
}

export function launchDefaultBrowser(url: string): boolean {
  if (!isValidLocalHttpUrl(url)) {
    return false;
  }
  if (isTestEnvironment()) {
    return true;
  }
  try {
    if (process.platform === 'win32') {
      const escapedUrl = url.replace(/'/g, "''");
      const psCommand = `Start-Process -FilePath '${escapedUrl}'`;
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

export interface DesktopWindowOptions {
  windowSize?: string;
  fallbackToDefault?: boolean;
}

export function launchNativeDesktopWindow(
  url: string,
  options: DesktopWindowOptions = {}
): boolean {
  if (!isValidLocalHttpUrl(url)) {
    return false;
  }
  if (isTestEnvironment()) {
    return true;
  }

  const fallback = options.fallbackToDefault !== false;
  const windowSize = options.windowSize || '1440,900';
  const browserPath = detectChromiumBrowser();

  if (!browserPath) {
    if (fallback) {
      return launchDefaultBrowser(url);
    }
    return false;
  }

  try {
    const child = spawn(browserPath, [`--app=${url}`, `--window-size=${windowSize}`], {
      detached: true,
      stdio: 'ignore',
    });

    child.on('error', () => {
      if (fallback) {
        launchDefaultBrowser(url);
      }
    });

    child.unref();
    return true;
  } catch {
    if (fallback) {
      return launchDefaultBrowser(url);
    }
    return false;
  }
}

export async function startUiServer(
  workspaceRoot: string,
  options: UiServerOptions = {}
): Promise<UiServerInstance> {
  if (
    options.port !== undefined &&
    (!Number.isFinite(options.port) || options.port < 0 || options.port > 65535)
  ) {
    throw new RangeError(`options.port must be an integer between 0 and 65535 (received ${options.port})`);
  }
  const resolved = path.resolve(workspaceRoot);
  const ws = fs.existsSync(resolved)
    ? (fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved))
    : resolved;
  const storage = new EvoStorage(ws);
  const token =
    options.token && options.token.trim()
      ? options.token.trim()
      : crypto.randomBytes(16).toString('hex');
  const clients = new Set<http.ServerResponse>();
  let snapshot = buildUiSnapshot(ws, { anon: options.anon });

  const server = http.createServer(async (req, res) => {
    try {
      const hostHeader = (req.headers.host || '').toLowerCase();
      const hostname = hostHeader.split(':')[0];
      if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Invalid Host header');
        return;
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Cross-site requests blocked');
        return;
      }

      const reqUrl = new URL(req.url || '/', `http://${hostHeader || '127.0.0.1'}`);
      const pathname = reqUrl.pathname;
      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderUiClientHtml(snapshot, { token, anon: options.anon }));
        return;
      }

      const headerToken = req.headers['x-evo-ui-token'];
      const queryToken = reqUrl.searchParams.get('token');
      if (headerToken !== token && queryToken !== token) {
        sendJsonResponse(res, 401, { ok: false, error: 'Unauthorized: Valid X-Evo-UI-Token required' });
        return;
      }

      if (pathname === '/api/snapshot') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snapshot));
        return;
      }
      if (pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      // --- POST /api/action Router ---
      if (pathname === '/api/action') {
        if (req.method !== 'POST') {
          sendJsonResponse(res, 405, { ok: false, error: 'Method Not Allowed: Expected POST' }, { Allow: 'POST' });
          return;
        }

        const rawContentType = (req.headers['content-type'] || '').trim();
        const mimeType = rawContentType.split(';')[0].trim().toLowerCase();
        if (mimeType !== 'application/json') {
          sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Content-Type must be application/json' });
          return;
        }

        const bodyResult = await readJsonBody(req);
        if (!bodyResult.ok) {
          sendJsonResponse(
            res,
            bodyResult.status,
            { ok: false, error: bodyResult.error },
            bodyResult.status === 413 ? { Connection: 'close' } : {}
          );
          return;
        }

        const body = bodyResult.body;
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        if (!action) {
          sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing or invalid action' });
          return;
        }

        const params = (body.params && typeof body.params === 'object' && !Array.isArray(body.params))
          ? body.params
          : body;

        switch (action) {
          case 'open-editor': {
            const rawPath = typeof params.filePath === 'string' ? params.filePath.trim() : '';
            if (!rawPath) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing or invalid filePath' });
              return;
            }
            const targetPath = path.resolve(ws, rawPath);
            if (!isSubpathOf(ws, targetPath)) {
              sendJsonResponse(res, 403, { ok: false, error: 'Forbidden: Path traversal outside workspace root' });
              return;
            }
            if (!fs.existsSync(targetPath)) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: File not found: ${rawPath}` });
              return;
            }
            const lineNum = Math.max(
              1,
              typeof params.line === 'number' && Number.isFinite(params.line)
                ? Math.floor(params.line)
                : parseInt(String(params.line || 1), 10) || 1
            );
            const { launched, editor } = launchEditorAtLocation(targetPath, lineNum);
            sendJsonResponse(res, 200, {
              ok: true,
              action: 'open-editor',
              data: { opened: targetPath, line: lineNum, editor, launched },
            });
            return;
          }

          case 'verify-memory': {
            const rawId = typeof params.id === 'string' ? params.id.trim() : '';
            let targetMemories = storage.listMemories();
            if (rawId) {
              const cleanId = sanitizeId(rawId);
              const mem = storage.getMemory(cleanId);
              if (!mem) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Memory "${cleanId}" not found` });
                return;
              }
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

              snapshot = buildUiSnapshot(ws, { anon: options.anon, cacheDb });
              notifyChange();

              sendJsonResponse(res, 200, {
                ok: true,
                action: 'verify-memory',
                snapshot,
                data: { verifiedCount: updatedItems.length, memories: updatedItems, snapshot },
              });
            } finally {
              if (cacheDb) try { cacheDb.close(); } catch {}
            }
            return;
          }

          case 'run-tool-test': {
            const rawId = typeof params.id === 'string' ? params.id.trim() : '';
            if (!rawId) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing tool id' });
              return;
            }
            const cleanId = sanitizeId(rawId);
            const tool = storage.getTool(cleanId);
            if (!tool) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: Tool "${cleanId}" not found` });
              return;
            }
            if (!fs.existsSync(tool.script_path)) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: Tool script "${tool.script_path}" not found` });
              return;
            }

            const execResult = executeSandboxedScript(
              tool.runtime,
              tool.script_path,
              {},
              { selfTest: true, timeoutMs: 5000, workspaceRoot: ws }
            );

            sendJsonResponse(res, 200, {
              ok: true,
              action: 'run-tool-test',
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
            });
            return;
          }

          case 'archive-item': {
            const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
            const rawId = typeof params.id === 'string' ? params.id.trim() : '';
            if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind)) {
              sendJsonResponse(res, 400, { ok: false, error: `Bad Request: Invalid kind "${rawKind}". Must be rule|skill|tool|memory` });
              return;
            }
            if (!rawId) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing item id' });
              return;
            }
            const cleanId = sanitizeId(rawId);
            const reason = typeof params.reason === 'string' && params.reason.trim()
              ? params.reason.trim()
              : 'Archived via EvoKernel Workbench 2.0';
            const archived = storage.archiveCapability(cleanId, rawKind as EvoKind, reason);
            if (!archived) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: ${rawKind} "${cleanId}" not found` });
              return;
            }

            if (rawKind === 'rule') {
              syncManagedRuleBlocks(ws);
            }
            const telem = new EvoTelemetry(storage);
            try { telem.syncFromDisk(true); } finally { telem.close(); }

            snapshot = buildUiSnapshot(ws, { anon: options.anon });
            notifyChange();

            sendJsonResponse(res, 200, {
              ok: true,
              action: 'archive-item',
              snapshot,
              data: { archived: { kind: rawKind, id: cleanId }, reason, snapshot },
            });
            return;
          }

          case 'restore-item': {
            const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
            const rawId = typeof params.id === 'string' ? params.id.trim() : '';
            if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind)) {
              sendJsonResponse(res, 400, { ok: false, error: `Bad Request: Invalid kind "${rawKind}". Must be rule|skill|tool|memory` });
              return;
            }
            if (!rawId) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing item id' });
              return;
            }
            const cleanId = sanitizeId(rawId);
            const restored = storage.restoreCapability(cleanId, rawKind as EvoKind);
            if (!restored) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: Archived ${rawKind} "${cleanId}" not found` });
              return;
            }

            if (rawKind === 'rule') {
              syncManagedRuleBlocks(ws);
            }
            const telem = new EvoTelemetry(storage);
            try { telem.syncFromDisk(true); } finally { telem.close(); }

            snapshot = buildUiSnapshot(ws, { anon: options.anon });
            notifyChange();

            sendJsonResponse(res, 200, {
              ok: true,
              action: 'restore-item',
              snapshot,
              data: { restored: { kind: rawKind, id: cleanId }, snapshot },
            });
            return;
          }

          case 'toggle-enabled': {
            if (typeof params.enabled !== 'boolean') {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Parameter "enabled" must be a boolean' });
              return;
            }
            const targetEnabled = params.enabled;
            const batchItems = Array.isArray(params.items)
              ? params.items
              : [{ kind: params.kind, id: params.id }];
            if (batchItems.length === 0) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing target item(s)' });
              return;
            }

            let touchedRules = false;
            let updatedCount = 0;
            const now = new Date().toISOString();

            for (const entry of batchItems) {
              const rawKind = typeof entry?.kind === 'string' ? entry.kind.trim().toLowerCase() : '';
              const rawId = typeof entry?.id === 'string' ? entry.id.trim() : '';
              if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind) || !rawId) {
                sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Invalid kind or id in toggle-enabled' });
                return;
              }
              const cleanId = sanitizeId(rawId);
              if (rawKind === 'rule') {
                const rule = storage.getRule(cleanId);
                if (!rule) {
                  if (batchItems.length === 1) {
                    sendJsonResponse(res, 404, { ok: false, error: `Not Found: Rule "${cleanId}" not found` });
                    return;
                  }
                  continue;
                }
                if (targetEnabled && rule.core && rule.enabled === false) {
                  const { totalTokens } = storage.getCoreRulesTokenUsage();
                  const maxBudget = storage.getConfig()?.maxCoreRuleTokens ?? 1500;
                  if (totalTokens + rule.tokens > maxBudget) {
                    sendJsonResponse(res, 400, {
                      ok: false,
                      error: `Bad Request: Core rule budget exceeded (${totalTokens + rule.tokens}/${maxBudget} tokens)`,
                      code: 'ERR_BUDGET_EXCEEDED',
                      details: { currentTokens: totalTokens, candidateTokens: rule.tokens, maxTokens: maxBudget },
                    });
                    return;
                  }
                }
                storage.saveRule({ ...rule, enabled: targetEnabled, updated_at: now });
                touchedRules = true;
                updatedCount++;
              } else if (rawKind === 'skill') {
                const skill = storage.getSkill(cleanId);
                if (!skill) {
                  if (batchItems.length === 1) {
                    sendJsonResponse(res, 404, { ok: false, error: `Not Found: Skill "${cleanId}" not found` });
                    return;
                  }
                  continue;
                }
                storage.saveSkill({ ...skill, enabled: targetEnabled, updated_at: now });
                updatedCount++;
              } else if (rawKind === 'tool') {
                const tool = storage.getTool(cleanId);
                if (!tool) {
                  if (batchItems.length === 1) {
                    sendJsonResponse(res, 404, { ok: false, error: `Not Found: Tool "${cleanId}" not found` });
                    return;
                  }
                  continue;
                }
                const { script_code, script_path: _sp, ...manifest } = tool;
                storage.saveTool({ ...manifest, enabled: targetEnabled, updated_at: now }, script_code);
                updatedCount++;
              } else if (rawKind === 'memory') {
                const mem = storage.getMemory(cleanId);
                if (!mem) {
                  if (batchItems.length === 1) {
                    sendJsonResponse(res, 404, { ok: false, error: `Not Found: Memory "${cleanId}" not found` });
                    return;
                  }
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

            snapshot = buildUiSnapshot(ws, { anon: options.anon });
            notifyChange();

            const latestUsage = storage.getCoreRulesTokenUsage().totalTokens;
            sendJsonResponse(res, 200, {
              ok: true,
              action: 'toggle-enabled',
              snapshot,
              tokenUsage: latestUsage,
              data: { updatedCount, enabled: targetEnabled, tokenUsage: latestUsage, snapshot },
            });
            return;
          }

          case 'approve-item': {
            const approveAll = Boolean(params.approveAll);
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
              const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
              const rawId = typeof params.id === 'string' ? params.id.trim() : '';
              if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind) || !rawId) {
                sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Invalid kind or id for approve-item' });
                return;
              }
              const cleanId = sanitizeId(rawId);
              if (rawKind === 'rule') {
                const r = storage.getRule(cleanId);
                if (!r) {
                  sendJsonResponse(res, 404, { ok: false, error: `Not Found: Rule "${cleanId}" not found` });
                  return;
                }
                storage.saveRule({ ...r, review_status: 'approved', updated_at: now });
                approvedCount = 1;
              } else if (rawKind === 'skill') {
                const s = storage.getSkill(cleanId);
                if (!s) {
                  sendJsonResponse(res, 404, { ok: false, error: `Not Found: Skill "${cleanId}" not found` });
                  return;
                }
                storage.saveSkill({ ...s, review_status: 'approved', updated_at: now });
                approvedCount = 1;
              } else if (rawKind === 'tool') {
                const t = storage.getTool(cleanId);
                if (!t) {
                  sendJsonResponse(res, 404, { ok: false, error: `Not Found: Tool "${cleanId}" not found` });
                  return;
                }
                const { script_code, script_path: _sp, ...manifest } = t;
                storage.saveTool({ ...manifest, review_status: 'approved', updated_at: now }, script_code);
                approvedCount = 1;
              } else if (rawKind === 'memory') {
                const m = storage.getMemory(cleanId);
                if (!m) {
                  sendJsonResponse(res, 404, { ok: false, error: `Not Found: Memory "${cleanId}" not found` });
                  return;
                }
                storage.saveMemory({ ...m, review_status: 'approved', updated_at: now });
                approvedCount = 1;
              }
            }

            snapshot = buildUiSnapshot(ws, { anon: options.anon });
            notifyChange();

            sendJsonResponse(res, 200, {
              ok: true,
              action: 'approve-item',
              snapshot,
              data: { approvedCount, approveAll, snapshot },
            });
            return;
          }

          case 'rebind-memory-ast': {
            const rawId = typeof params.id === 'string' ? params.id.trim() : '';
            if (!rawId) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing memory id' });
              return;
            }
            const cleanId = sanitizeId(rawId);
            const mem = storage.getMemory(cleanId);
            if (!mem) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: Memory "${cleanId}" not found` });
              return;
            }

            const { fingerprints, resolvedSymbols, missingSymbols } = buildFingerprintsForTargets(
              ws,
              mem.target_symbols || []
            );
            const nextFingerprints = { ...(mem.ast_fingerprints || {}), ...fingerprints };
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

            snapshot = buildUiSnapshot(ws, { anon: options.anon });
            notifyChange();

            const retriggered = (snapshot.memories || []).find((m: any) => m.id === cleanId);
            sendJsonResponse(res, 200, {
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
            });
            return;
          }

          case 'toggle-rule-tier': {
            const rawId = typeof params.id === 'string' ? params.id.trim() : '';
            if (!rawId) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing rule id' });
              return;
            }
            if (typeof params.core !== 'boolean') {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Parameter "core" must be a boolean' });
              return;
            }
            const cleanId = sanitizeId(rawId);
            const rule = storage.getRule(cleanId);
            if (!rule) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: Rule "${cleanId}" not found` });
              return;
            }

            const targetCore = params.core;
            if (targetCore && !rule.core && rule.enabled !== false) {
              const { totalTokens } = storage.getCoreRulesTokenUsage();
              const maxBudget = storage.getConfig()?.maxCoreRuleTokens ?? 1500;
              if (totalTokens + rule.tokens > maxBudget) {
                sendJsonResponse(res, 400, {
                  ok: false,
                  error: `Bad Request: Core rule budget exceeded (${totalTokens + rule.tokens}/${maxBudget} tokens)`,
                  code: 'ERR_BUDGET_EXCEEDED',
                  details: { currentTokens: totalTokens, candidateTokens: rule.tokens, maxTokens: maxBudget },
                });
                return;
              }
            }

            storage.saveRule({ ...rule, core: targetCore, updated_at: new Date().toISOString() });
            syncManagedRuleBlocks(ws);

            const telem = new EvoTelemetry(storage);
            try { telem.syncFromDisk(true); } finally { telem.close(); }

            snapshot = buildUiSnapshot(ws, { anon: options.anon });
            notifyChange();

            const latestUsage = storage.getCoreRulesTokenUsage().totalTokens;
            sendJsonResponse(res, 200, {
              ok: true,
              action: 'toggle-rule-tier',
              snapshot,
              tokenUsage: latestUsage,
              data: { id: cleanId, core: targetCore, tokenUsage: latestUsage, snapshot },
            });
            return;
          }

          case 'update-content': {
            const rawKind = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : '';
            const rawId = typeof params.id === 'string' ? params.id.trim() : '';
            const rawContent = typeof params.content === 'string' ? params.content : '';

            if (!['rule', 'skill', 'tool', 'memory'].includes(rawKind)) {
              sendJsonResponse(res, 400, { ok: false, error: `Bad Request: Invalid kind "${rawKind}"` });
              return;
            }
            if (!rawId) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing item id' });
              return;
            }
            if (!rawContent.trim()) {
              sendJsonResponse(res, 400, { ok: false, error: 'Bad Request: Missing or empty content' });
              return;
            }

            const cleanId = sanitizeId(rawId);
            if (rawKind === 'rule') {
              const corePath = path.join(storage.rulesDir, `${cleanId}.md`);
              const scopedPath = path.join(storage.rulesDir, 'scoped', `${cleanId}.md`);
              const targetPath = fs.existsSync(corePath) ? corePath : (fs.existsSync(scopedPath) ? scopedPath : null);
              if (!targetPath) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Rule "${cleanId}" not found` });
                return;
              }
              fs.writeFileSync(targetPath, rawContent.trim() + '\n', 'utf8');
              storage.rebuildCoreInvariantsDigest();
              syncManagedRuleBlocks(ws);
            } else if (rawKind === 'skill') {
              const skillPath = path.join(storage.skillsDir, cleanId, 'SKILL.md');
              if (!fs.existsSync(skillPath)) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Skill "${cleanId}" not found` });
                return;
              }
              fs.writeFileSync(skillPath, rawContent.trim() + '\n', 'utf8');
            } else if (rawKind === 'memory') {
              const memPath = path.join(storage.memoriesDir, `${cleanId}.md`);
              if (!fs.existsSync(memPath)) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Memory "${cleanId}" not found` });
                return;
              }
              fs.writeFileSync(memPath, rawContent.trim() + '\n', 'utf8');
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
            } else if (rawKind === 'tool') {
              const tool = storage.getTool(cleanId);
              if (!tool || !fs.existsSync(tool.script_path)) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Tool "${cleanId}" not found` });
                return;
              }
              fs.writeFileSync(tool.script_path, rawContent, 'utf8');
            }

            const telem = new EvoTelemetry(storage);
            try { telem.syncFromDisk(true); } finally { telem.close(); }

            snapshot = buildUiSnapshot(ws, { anon: options.anon });
            notifyChange();

            sendJsonResponse(res, 200, {
              ok: true,
              action: 'update-content',
              snapshot,
              data: { id: cleanId, kind: rawKind, updated: true, snapshot },
            });
            return;
          }

          default:
            sendJsonResponse(res, 400, { ok: false, error: `Bad Request: Unknown action "${action}"` });
            return;
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err: any) {
      sendJsonResponse(res, 500, { ok: false, error: `Internal Server Error: ${err?.message || 'unknown error'}` });
    }
  });

  const watchers: fs.FSWatcher[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;
  function notifyChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        snapshot = buildUiSnapshot(ws, { anon: options.anon });
        const payload = `data: ${JSON.stringify({ type: 'change', timestamp: Date.now() })}\n\n`;
        for (const c of clients) { try { c.write(payload); } catch {} }
      } catch {}
    }, 300);
  }

  const evoDir = path.join(ws, '.evo');
  if (fs.existsSync(evoDir)) {
    try {
      const w = fs.watch(evoDir, { recursive: true }, (_e, f) => {
        if (!f) return notifyChange();
        const norm = f.replace(/\\/g, '/');
        if (norm.startsWith('.cache') || norm.includes('telemetry.db') || norm.startsWith('optimize')) return;
        notifyChange();
      });
      w.on('error', () => {}); watchers.push(w);
    } catch {}
  }
  const gitHead = path.join(ws, '.git', 'HEAD');
  if (fs.existsSync(gitHead)) {
    try { const w = fs.watch(gitHead, () => notifyChange()); w.on('error', () => {}); watchers.push(w); } catch {}
  }
  const watchedFiles = new Set<string>();
  for (const m of snapshot.memories || []) {
    for (const d of Object.values(m.ast_fingerprints || {}) as any[]) {
      const rel = d?.file_path || d?.file;
      if (rel) {
        const full = path.resolve(ws, rel);
        if (fs.existsSync(full) && !watchedFiles.has(full)) {
          watchedFiles.add(full);
          try { const w = fs.watch(full, () => notifyChange()); w.on('error', () => {}); watchers.push(w); } catch {}
        }
      }
    }
  }

  const startPort = options.port !== undefined ? options.port : 4310;
  let boundPort = startPort;
  await new Promise<void>((resolve, reject) => {
    function tryListen(p: number) {
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && options.port === undefined && p < 4320) tryListen(p + 1);
        else reject(err);
      });
      server.listen(p, '127.0.0.1', () => {
        const addr = server.address();
        boundPort = typeof addr === 'object' && addr ? addr.port : p;
        resolve();
      });
    }
    tryListen(startPort);
  });

  const url = `http://127.0.0.1:${boundPort}/?token=${encodeURIComponent(token)}`;
  return {
    port: boundPort,
    token,
    url,
    server,
    close: async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) { try { w.close(); } catch {} }
      for (const c of clients) { try { c.end(); } catch {} }
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export function exportUiHtml(
  workspaceRoot: string,
  outPath: string,
  options?: { anon?: boolean }
): void {
  const ws = path.resolve(workspaceRoot);
  const snapshot = buildUiSnapshot(ws, { anon: options?.anon });
  const rawHtml = renderUiClientHtml(snapshot, { isExport: true, anon: options?.anon });

  const scriptMatch = rawHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    fs.writeFileSync(outPath, rawHtml.replace(/\r\n/g, '\n'), 'utf8');
    return;
  }

  const scriptContent = scriptMatch[1].replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(scriptContent, 'utf8').digest('base64');
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; script-src 'sha256-${hash}'; connect-src 'none';">`;

  const finalHtml = rawHtml
    .replace('<meta name="viewport"', `${cspMeta}\n  <meta name="viewport"`)
    .replace(/\r\n/g, '\n');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, finalHtml, 'utf8');
}

function parseCliOption(args: string[], flag: string): { matched: boolean; value?: string } {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag) {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        return { matched: true, value: next };
      }
      return { matched: true, value: undefined };
    }
    if (a.startsWith(`${flag}=`)) {
      return { matched: true, value: a.slice(flag.length + 1) };
    }
  }
  return { matched: false, value: undefined };
}

export async function runUiCli(workspaceRoot: string, args: string[]): Promise<void> {
  if (args.includes('--install-ide')) {
    console.log('🔌 Mounting EvoKernel IDE extension into detected IDEs...');
    const mountRes = mountIdeExtensions(workspaceRoot);
    if (mountRes.mounts && mountRes.mounts.length > 0) {
      for (const m of mountRes.mounts) {
        console.log(`  ├─ ${m.name}: ${m.targetPath} (${m.method} - ${m.status})`);
      }
    } else {
      console.log('  └─ (no supported IDE extensions directory detected)');
    }
  }

  const isAnon = args.includes('--anon');
  const exportOpt = parseCliOption(args, '--export');

  if (exportOpt.matched) {
    const out =
      exportOpt.value && exportOpt.value.trim()
        ? path.resolve(exportOpt.value.trim())
        : path.join(path.resolve(workspaceRoot), 'evo-cockpit.html');
    exportUiHtml(workspaceRoot, out, { anon: isAnon });
    console.log(`✅ EvoKernel Workbench 2.0 exported to: ${out}`);
    return;
  }

  const portOpt = parseCliOption(args, '--port');
  let port: number | undefined;
  if (portOpt.matched) {
    if (!portOpt.value) {
      console.error('❌ Missing value for --port. Please specify a port number (e.g. --port 4310).');
      process.exit(1);
    }
    const parsed = parseInt(portOpt.value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
      console.error(`❌ Invalid port "${portOpt.value}". Must be a valid port number between 0 and 65535.`);
      process.exit(1);
    }
    port = parsed;
  }

  const tokenOpt = parseCliOption(args, '--token');
  let token: string | undefined;
  if (tokenOpt.matched) {
    if (!tokenOpt.value || !tokenOpt.value.trim()) {
      console.error('❌ Missing value for --token. Please specify a non-empty token string.');
      process.exit(1);
    }
    token = tokenOpt.value.trim();
  }

  const instance = await startUiServer(workspaceRoot, { port, token, anon: isAnon });
  console.log(`🧬 EvoKernel Workbench 2.0 started at: ${instance.url}`);
  console.log('   Press Ctrl+C to terminate server.');

  const isAppMode = args.includes('--app') || args.includes('--desktop');
  const shouldOpen = (args.includes('--open') || isAppMode) && !process.env.CI && !process.argv[1]?.includes('.test.');

  if (shouldOpen) {
    if (isValidLocalHttpUrl(instance.url)) {
      if (isAppMode) {
        launchNativeDesktopWindow(instance.url, { fallbackToDefault: true });
      } else {
        launchDefaultBrowser(instance.url);
      }
    }
  }
}
