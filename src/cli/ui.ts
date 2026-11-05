import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildScoreReport } from './score.js';
import type { ScoreReport } from './score.js';
import { EvoStorage, hasValidEvoStructure } from '../core/storage.js';
import { redactSensitiveDiagnostics } from '../core/telemetry.js';
import { verifyMemoryFreshness } from '../core/memory.js';
import { renderUiClientHtml } from '../templates/ui-client.js';

export interface UiSnapshot {
  score: ScoreReport;
  rules: any[];
  skills: any[];
  tools: any[];
  memories: any[];
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
      } catch {}
    }

    return { score, rules, skills, tools, memories, gatekeeperEvents };
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
  const ws = path.resolve(workspaceRoot);
  const token =
    options.token && options.token.trim()
      ? options.token.trim()
      : crypto.randomBytes(16).toString('hex');
  const clients = new Set<http.ServerResponse>();
  let snapshot = buildUiSnapshot(ws, { anon: options.anon });

  const server = http.createServer((req, res) => {
    const hostHeader = (req.headers.host || '').toLowerCase();
    const hostname = hostHeader.split(':')[0];
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
      res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden: Invalid Host header'); return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden: Cross-site requests blocked'); return;
    }

    const reqUrl = new URL(req.url || '/', `http://${hostHeader || '127.0.0.1'}`);
    const pathname = reqUrl.pathname;
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderUiClientHtml(snapshot, { token, anon: options.anon })); return;
    }

    const headerToken = req.headers['x-evo-ui-token'];
    const queryToken = reqUrl.searchParams.get('token');
    if (headerToken !== token && queryToken !== token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Valid X-Evo-UI-Token required' })); return;
    }

    if (pathname === '/api/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(snapshot)); return;
    }
    if (pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`); clients.add(res);
      req.on('close', () => clients.delete(res)); return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found');
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
  const isAnon = args.includes('--anon');
  const exportOpt = parseCliOption(args, '--export');

  if (exportOpt.matched) {
    const out =
      exportOpt.value && exportOpt.value.trim()
        ? path.resolve(exportOpt.value.trim())
        : path.join(path.resolve(workspaceRoot), 'evo-cockpit.html');
    exportUiHtml(workspaceRoot, out, { anon: isAnon });
    console.log(`✅ EvoKernel Live Cockpit exported to: ${out}`);
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
  console.log(`🧬 EvoKernel Live Cockpit started at: ${instance.url}`);
  console.log('   Press Ctrl+C to terminate server.');

  if (args.includes('--open') && !process.env.CI && !process.argv[1]?.includes('.test.')) {
    if (instance.url.startsWith('http://127.0.0.1:')) {
      try {
        if (process.platform === 'win32') {
          const psCommand = `Start-Process -FilePath ${JSON.stringify(instance.url)}`;
          spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } else if (process.platform === 'darwin') {
          spawn('open', [instance.url], { detached: true, stdio: 'ignore' }).unref();
        } else {
          spawn('xdg-open', [instance.url], { detached: true, stdio: 'ignore' }).unref();
        }
      } catch {}
    }
  }
}
