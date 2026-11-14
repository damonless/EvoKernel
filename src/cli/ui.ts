import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildScoreReport, computeGitBugHotspots } from './score.js';
import type { ScoreReport } from './score.js';
import { EvoStorage, estimateTokens, hasValidEvoStructure, openSqliteReadOnly, parseFrontmatter, sanitizeId } from '../core/storage.js';
import type { ConfidenceLevel, EvoKind, ProposalPayload, SymbolFingerprint } from '../core/types.js';
import {
  type RecallWindowStats,
  EvoTelemetry,
  emptyRecallWindowStats,
  readRecallWindowStatsFromDb,
  redactSensitiveDiagnostics,
} from '../core/telemetry.js';
import {
  EvoGatekeeper,
  captureWorkspaceMutationSignature,
  captureWorkspaceRollbackSnapshot,
  parseSkillSectionsFromMarkdown,
  restoreWorkspaceFromSnapshot,
} from '../core/gatekeeper.js';
import {
  clearMemoryVerificationCache,
  extractSymbolFingerprint,
  parseSymbolTarget,
  resolveCurrentGitBranch,
  resolveCurrentGitCommit,
  verifyMemoryFreshness,
} from '../core/memory.js';
import { renderUiClientHtml } from '../templates/ui-client.js';
import { executeSandboxedScriptAsync } from '../core/sandbox.js';
import { mountIdeExtensions, syncManagedRuleBlocks } from './init.js';
import { formatTerminalOutput, isAsciiMode, isColorEnabled } from './term.js';
import { isSubpathOf } from '../mcp/handlers.js';

export interface UiSnapshot {
  score: ScoreReport;
  window7d: RecallWindowStats;
  rules: any[];
  skills: any[];
  tools: any[];
  memories: any[];
  archived: any[];
  gatekeeperEvents: any[];
}

function scrubAnonTextValue(val: string, ws: string, relativePathReplacements?: Array<[RegExp, string]>): string {
  let out = val;
  if (ws) {
    const escapedWs = ws
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/(?:\\\\|\\\/)+/g, '[\\\\/]+');
    out = out.replace(new RegExp(`${escapedWs}(?:[\\\\/][^\\s"'<>|]*)?`, 'gi'), '<WORKSPACE>');
  }
  out = out.replace(/(?<![A-Za-z])[A-Za-z]:[\\/]+[^\s"'<>|]*/g, '<PATH>');
  out = out.replace(/\/(?:Users|home|private\/var|var\/folders)\/[^\s"'<>|]*/g, '<HOME>');
  out = redactSensitiveDiagnostics(out, ws);
  out = out.replace(/<HOME>[\\/]+[^\s"'<>|]*/g, '<HOME>');
  out = out.replace(/\b(?:ghp_[A-Za-z0-9_]*|sk-ant-[A-Za-z0-9_-]*|AKIA[0-9A-Z]*)/g, '[REDACTED]');
  if (relativePathReplacements && relativePathReplacements.length > 0) {
    for (const [re, replacement] of relativePathReplacements) {
      out = out.replace(re, replacement);
    }
  }
  return out;
}

function deepScrubAnonObject<T>(
  input: T,
  ws: string,
  relativePathReplacements?: Array<[RegExp, string]>
): T {
  if (typeof input === 'string') {
    return scrubAnonTextValue(input, ws, relativePathReplacements) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => deepScrubAnonObject(item, ws, relativePathReplacements)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = deepScrubAnonObject(v, ws, relativePathReplacements);
    }
    return out as T;
  }
  return input;
}

export function buildUiSnapshot(
  workspaceRoot: string,
  optionsOrAnon?: boolean | { anon?: boolean; cacheDb?: DatabaseSync }
): UiSnapshot {
  const options = typeof optionsOrAnon === 'boolean' ? { anon: optionsOrAnon } : optionsOrAnon;
  const ws = path.resolve(workspaceRoot);
  const storage = new EvoStorage(ws);
  const dbPath = path.join(storage.cacheDir, 'telemetry.db');
  let db: DatabaseSync | undefined = options?.cacheDb;
  let openedDb = false;

  if (!db && fs.existsSync(dbPath)) {
    try {
      db = openSqliteReadOnly(dbPath);
      openedDb = true;
    } catch {}
  }

  try {
    const score = buildScoreReport(ws, { anon: options?.anon, cacheDb: db });
    const window7d = db ? readRecallWindowStatsFromDb(db, 7) : emptyRecallWindowStats(7);
    const rules: any[] = [];
    const skills: any[] = [];
    const tools: any[] = [];
    const memories: any[] = [];
    const archived: any[] = [];
    let gatekeeperEvents: any[] = [];
    const telemMap = new Map<string, { hit_count: number; attribution: string }>();

    const anonPathMap = new Map<string, string>();
    const relativePathReplacements: Array<[RegExp, string]> = [];
    const genericBasenames = new Set([
      'index.ts',
      'index.js',
      'main.ts',
      'main.js',
      'run.mjs',
      'types.ts',
      'utils.ts',
      'config.json',
      'package.json',
      'agents.md',
      'claude.md',
      'gemini.md',
      'skill.md',
    ]);
    const resolveAnonModulePath = (rawFilePath: string, fallbackExt = '.ts'): string => {
      const cleanRel = String(rawFilePath || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
      if (!cleanRel || /^src\/module-\d+\.[a-z0-9]+$/i.test(cleanRel)) {
        return cleanRel || `src/module-1${fallbackExt}`;
      }
      const key = cleanRel.toLowerCase();
      const existing = anonPathMap.get(key);
      if (existing) return existing;
      const ext = path.extname(cleanRel) || fallbackExt;
      const mapped = `src/module-${anonPathMap.size + 1}${ext}`;
      anonPathMap.set(key, mapped);
      if (cleanRel.includes('/')) {
        const escapedRel = cleanRel
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\//g, '[\\\\/]+');
        relativePathReplacements.push([new RegExp(escapedRel, 'gi'), mapped]);
      }
      const base = path.basename(cleanRel);
      if (
        base.includes('.') &&
        base.length >= 6 &&
        !genericBasenames.has(base.toLowerCase()) &&
        !/^module-\d+\./i.test(base)
      ) {
        const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        relativePathReplacements.push([new RegExp(`\\b${escapedBase}\\b`, 'gi'), mapped]);
      }
      return mapped;
    };

    if (options?.anon) {
      for (const rawHs of computeGitBugHotspots(ws, 10)) {
        resolveAnonModulePath(rawHs.filePath);
      }
    }

    const isSelfEvoRepo =
      fs.existsSync(path.join(ws, 'templates', 'seed-evo')) &&
      fs.existsSync(path.join(ws, 'src', 'core', 'gatekeeper.ts'));
    const seedAllowedIds = new Set([
      'esm-typescript-imports',
      'bug-to-guardrail-sop',
      'evo-rule-architect',
      'agy-config-auditor',
      'deliverable-canonical-inspector',
      'git-hotspot-analyzer',
      'workspace-metrics-scanner',
    ]);
    const localOnlyIds = new Set([
      'ceo-team-orchestrator',
      'dual-agent-team',
      'evo-dev-verification-sop',
      'embedded-fsm-lookup-audit',
      'evo-release-preflight',
      'local-workflow-skill-isolation-guard',
      'embedded-power-bms-guardrail',
    ]);
    const shouldIncludeAnonId = (id: string, origin?: string): boolean => {
      if (!options?.anon) return true;
      if (localOnlyIds.has(id)) return false;
      if (isSelfEvoRepo) {
        return origin === 'seed' || origin === 'demo' || seedAllowedIds.has(id);
      }
      return true;
    };

    if (db) {
      try {
        let rows: any[] = [];
        try {
          rows = db.prepare(
            'SELECT id, hit_count, helped_count, hurt_count, contested_count FROM telemetry'
          ).all() as any[];
        } catch {
          rows = db.prepare(
            'SELECT id, hit_count, helped_count, hurt_count FROM telemetry'
          ).all() as any[];
        }
        for (const r of rows) {
          const h = Number(r.hit_count || 0);
          const helped = Number(r.helped_count || 0);
          const hurt = Number(r.hurt_count || 0);
          const contested = Number(r.contested_count ?? r.contested ?? 0);
          const attr =
            contested > 0 && contested >= helped
              ? 'contested'
              : hurt > helped
                ? 'hurt'
                : helped > 0
                  ? 'helped'
                  : contested > 0
                    ? 'contested'
                    : 'unverified';
          telemMap.set(r.id, { hit_count: h, attribution: attr });
        }
      } catch {}

      try {
        const gRows = db.prepare(
          'SELECT id, timestamp, kind, target_id, target_name, passed, stage_failed, diagnostics FROM gatekeeper_events ORDER BY id DESC LIMIT 200'
        ).all() as any[];
        gatekeeperEvents = gRows
          .filter((r) => shouldIncludeAnonId(String(r.target_id || ''), isSelfEvoRepo ? undefined : 'demo'))
          .map((r) => ({
            ...r,
            target_id: options?.anon && !seedAllowedIds.has(String(r.target_id || '')) && isSelfEvoRepo
              ? 'sanitized-capability'
              : r.target_id,
            target_name: options?.anon
              ? scrubAnonTextValue(r.target_name || '', ws)
              : r.target_name,
            passed: r.passed === 1,
            diagnostics: options?.anon
              ? scrubAnonTextValue(r.diagnostics || '', ws)
              : redactSensitiveDiagnostics(r.diagnostics || '', ws),
          }));
      } catch {}
    }

    const attach = (item: any) => {
      const t = telemMap.get(item.id) || { hit_count: 0, attribution: 'unverified' };
      return { ...item, hit_count: t.hit_count, attribution: t.attribution };
    };

    if (hasValidEvoStructure(storage.evoDir)) {
      try {
        const filterAnon = <T extends { id: string; origin?: string }>(items: T[]): T[] =>
          options?.anon ? items.filter((item) => shouldIncludeAnonId(item.id, item.origin)) : items;
        const scrubAnonText = (val: unknown) =>
          options?.anon && typeof val === 'string' ? scrubAnonTextValue(val, ws) : val;
        rules.push(
          ...filterAnon(storage.listRules()).map((rule) => {
            const attached = attach(rule);
            if (options?.anon) {
              attached.title = scrubAnonText(attached.title);
              attached.l0_summary = scrubAnonText(attached.l0_summary);
              attached.content = scrubAnonText(attached.content);
              if (typeof attached.contrastive_evidence === 'string') {
                attached.contrastive_evidence = scrubAnonText(attached.contrastive_evidence);
              }
              if (Array.isArray(attached.transfer_scenarios)) {
                attached.transfer_scenarios = attached.transfer_scenarios.map((s: string) =>
                  scrubAnonText(s)
                );
              }
            }
            return attached;
          })
        );
        skills.push(
          ...filterAnon(storage.listSkills()).map((skill) => {
            const attached = attach(skill);
            if (options?.anon) {
              attached.name = scrubAnonText(attached.name);
              attached.title = scrubAnonText(attached.title);
              attached.description = scrubAnonText(attached.description);
              attached.l0_summary = scrubAnonText(attached.l0_summary);
              attached.l1_contract = scrubAnonText(attached.l1_contract);
              attached.l2_sop = scrubAnonText(attached.l2_sop);
              if (typeof attached.trigger_cue === 'string') {
                attached.trigger_cue = scrubAnonText(attached.trigger_cue);
              }
              if (typeof attached.contrastive_evidence === 'string') {
                attached.contrastive_evidence = scrubAnonText(attached.contrastive_evidence);
              }
            }
            return attached;
          })
        );
        tools.push(
          ...filterAnon(storage.listTools()).map((tool) => {
            const attached = attach(tool);
            if (options?.anon) {
              attached.title = scrubAnonText(attached.title);
              attached.l0_summary = scrubAnonText(attached.l0_summary);
              attached.script_code = scrubAnonText(attached.script_code);
              if (typeof attached.script_path === 'string') {
                const rel = path.relative(ws, attached.script_path).replace(/\\/g, '/');
                attached.script_path = rel.startsWith('..')
                  ? path.basename(attached.script_path)
                  : rel;
              }
            }
            return attached;
          })
        );
        for (const m of filterAnon(storage.listMemories())) {
          const v = verifyMemoryFreshness(ws, m, { includeCallers: true, cacheDb: db });
          const callers = Array.from(new Set((v.topology_anchors || []).flatMap((a: any) => a.callers || [])));
          const attached = attach({ ...m, freshness: { ...v, callers } });
          if (options?.anon) {
            if (Array.isArray(attached.target_symbols)) {
              attached.target_symbols = attached.target_symbols.map((sym: string) => {
                const parts = String(sym).split('#');
                const ext = path.extname(parts[0] || '') || '.ts';
                const safeFile = resolveAnonModulePath(parts[0] || '', ext);
                return parts[1] ? `${safeFile}#${parts[1]}` : safeFile;
              });
            }
            if (attached.ast_fingerprints && typeof attached.ast_fingerprints === 'object') {
              const sanitizedFps: Record<string, any> = {};
              for (const [fpKey, fpVal] of Object.entries(attached.ast_fingerprints as Record<string, any>)) {
                const parts = String(fpKey).split('#');
                const rawFpFile = parts[0] || fpVal?.file_path || fpVal?.file || '';
                const ext = path.extname(rawFpFile) || '.ts';
                const newFile = resolveAnonModulePath(rawFpFile, ext);
                const newKey = parts[1] ? `${newFile}#${parts[1]}` : newFile;
                sanitizedFps[newKey] = {
                  ...(fpVal || {}),
                  file_path: newFile,
                  file: undefined,
                };
              }
              attached.ast_fingerprints = sanitizedFps;
            }
            if (attached.freshness && typeof attached.freshness === 'object') {
              if (Array.isArray(attached.freshness.checks)) {
                attached.freshness.checks = attached.freshness.checks.map(
                  (chk: any) => {
                    const rawSym = String(chk?.symbol || '');
                    const parts = rawSym.split('#');
                    const rawFile = parts[0] || chk?.recorded?.file_path || '';
                    const ext = path.extname(rawFile) || '.ts';
                    const safeFile = resolveAnonModulePath(rawFile, ext);
                    const safeSym = parts[1] ? `${safeFile}#${parts[1]}` : safeFile;
                    return {
                      ...chk,
                      symbol: safeSym,
                      detail:
                        typeof chk?.detail === 'string'
                          ? scrubAnonTextValue(chk.detail, ws, relativePathReplacements).replace(
                              /[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp)/g,
                              safeFile
                            )
                          : chk?.detail,
                      recorded: chk?.recorded
                        ? {
                            ...chk.recorded,
                            file_path: safeFile,
                            file: undefined,
                            symbol: parts[1] || safeFile,
                            signature:
                              typeof chk.recorded.signature === 'string'
                                ? chk.recorded.signature.includes('#')
                                  ? safeSym
                                  : scrubAnonTextValue(chk.recorded.signature, ws, relativePathReplacements).replace(
                                      /[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp)/g,
                                      safeFile
                                    )
                                : chk.recorded.signature,
                          }
                        : chk?.recorded,
                      current: chk?.current
                        ? {
                            ...chk.current,
                            file_path: safeFile,
                            file: undefined,
                            symbol: parts[1] || safeFile,
                            signature:
                              typeof chk.current.signature === 'string'
                                ? chk.current.signature.includes('#')
                                  ? safeSym
                                  : scrubAnonTextValue(chk.current.signature, ws, relativePathReplacements).replace(
                                      /[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp)/g,
                                      safeFile
                                    )
                                : chk.current.signature,
                          }
                        : chk?.current,
                    };
                  }
                );
              }
              if (Array.isArray(attached.freshness.callers)) {
                attached.freshness.callers = attached.freshness.callers.map(
                  (_c: string, cIdx: number) => `src/caller-${cIdx + 1}.ts:10`
                );
              }
              if (Array.isArray(attached.freshness.topology_anchors)) {
                attached.freshness.topology_anchors = attached.freshness.topology_anchors.map(
                  (a: any) => {
                    const rawSym = String(a?.symbol || '');
                    const parts = rawSym.split('#');
                    const rawAnchorFile = a?.file_path || parts[0] || '';
                    const safeFile = resolveAnonModulePath(rawAnchorFile, path.extname(rawAnchorFile) || '.ts');
                    const safeSym = parts[1] ? `${safeFile}#${parts[1]}` : safeFile;
                    return {
                      ...a,
                      symbol: safeSym,
                      file_path: safeFile,
                      codegraph_hint: `view_file ${safeFile} (lines ${a?.lines || '1-1'})`,
                      callers: Array.isArray(a?.callers)
                        ? a.callers.map((_c: string, cIdx: number) => `src/caller-${cIdx + 1}.ts:10`)
                        : [],
                    };
                  }
                );
              }
            }
            attached.title = scrubAnonTextValue(String(attached.title || ''), ws, relativePathReplacements);
            attached.l0_summary = scrubAnonTextValue(String(attached.l0_summary || ''), ws, relativePathReplacements);
            attached.symptom = scrubAnonTextValue(String(attached.symptom || ''), ws, relativePathReplacements);
            attached.root_cause = scrubAnonTextValue(String(attached.root_cause || ''), ws, relativePathReplacements);
            attached.solution = scrubAnonTextValue(String(attached.solution || ''), ws, relativePathReplacements);
          }
          memories.push(attached);
        }
        archived.push(
          ...filterAnon(storage.listArchivedCapabilities() as any[]).map((item) => {
            if (!options?.anon) return item;
            return {
              ...item,
              title: scrubAnonText(item.title),
              l0_summary: scrubAnonText(item.l0_summary),
              archive_reason: scrubAnonText(item.archive_reason),
            };
          })
        );
      } catch {}
    }

    const rawSnapshot: UiSnapshot = {
      score,
      window7d,
      rules,
      skills,
      tools,
      memories,
      archived,
      gatekeeperEvents,
    };
    return options?.anon ? deepScrubAnonObject(rawSnapshot, ws, relativePathReplacements) : rawSnapshot;
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
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
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
      if (pathname === '/api/export') {
        const exportHtml = buildExportHtmlContent(ws, { anon: options.anon });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'attachment; filename="evo-workbench-export.html"',
        });
        res.end(exportHtml);
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
              if (fs.existsSync(dbPath)) cacheDb = openSqliteReadOnly(dbPath);
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

            const preSnapshot = captureWorkspaceRollbackSnapshot(ws);
            let execResult: any;
            try {
              execResult = await executeSandboxedScriptAsync(
                tool.runtime,
                tool.script_path,
                {},
                { selfTest: true, timeoutMs: 5000, workspaceRoot: ws }
              );
            } finally {
              const postSig = captureWorkspaceMutationSignature(ws);
              restoreWorkspaceFromSnapshot(ws, preSnapshot, postSig);
            }

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
              : 'Archived via EvoKernel Workbench';
            const archived = storage.archiveCapability(cleanId, rawKind as EvoKind, reason);
            if (!archived) {
              sendJsonResponse(res, 404, { ok: false, error: `Not Found: ${rawKind} "${cleanId}" not found` });
              return;
            }

            if (rawKind !== 'memory') {
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

            if (rawKind !== 'memory') {
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

            let touchedManagedCatalog = false;
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
                touchedManagedCatalog = true;
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
                touchedManagedCatalog = true;
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
                touchedManagedCatalog = true;
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

            if (touchedManagedCatalog) {
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
              sendJsonResponse(res, 400, {
                ok: false,
                code: 'ERR_MISSING_AST_SYMBOL',
                error: `Cannot re-bind AST: target symbol(s) missing in workspace: ${missingSymbols.join(', ')}`,
                details: { id: cleanId, resolvedSymbols, missingSymbols },
              });
              return;
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
            const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(rawContent.trimStart());
            const { meta, body } =
              rawKind !== 'tool' && hasFrontmatter
                ? parseFrontmatter(rawContent.trimStart())
                : { meta: {} as Record<string, unknown>, body: rawContent.trim() };

            let payload: ProposalPayload;
            let preservedEnabled: boolean | undefined;
            let preservedReviewStatus: 'pending' | 'approved' | undefined;

            if (rawKind === 'rule') {
              const existingRule = storage.getRule(cleanId);
              const corePath = path.join(storage.rulesDir, `${cleanId}.md`);
              const scopedPath = path.join(storage.rulesDir, 'scoped', `${cleanId}.md`);
              const targetPath = fs.existsSync(corePath) ? corePath : (fs.existsSync(scopedPath) ? scopedPath : null);
              if (!targetPath || !existingRule) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Rule "${cleanId}" not found` });
                return;
              }

              const isCore =
                meta.core !== undefined
                  ? Boolean(meta.core === true || meta.core === 'true')
                  : existingRule.core;
              const scopeGlob = meta.scope_glob ? String(meta.scope_glob).trim() : existingRule.scope_glob;
              const parsedScenarios = Array.isArray(meta.transfer_scenarios)
                ? meta.transfer_scenarios.map(String).filter(Boolean)
                : [];
              const rawScenarios =
                parsedScenarios.length > 0
                  ? parsedScenarios
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
              if (!fs.existsSync(skillPath) || !existingSkill) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Skill "${cleanId}" not found` });
                return;
              }

              const trimmedBody = body.trim();
              const parsedSec = parseSkillSectionsFromMarkdown(trimmedBody);
              const l1_contract = parsedSec.l1 || existingSkill.l1_contract || 'Standard skill contract';
              const l2_sop =
                parsedSec.l2 ||
                (!parsedSec.hasL1Header && trimmedBody ? trimmedBody : existingSkill.l2_sop || '');

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
                  Array.isArray(meta.tags) && meta.tags.length > 0
                    ? meta.tags.map(String)
                    : existingSkill.tags,
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
              if (!fs.existsSync(memPath) || !existingMem) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Memory "${cleanId}" not found` });
                return;
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

              const nextTargetSymbols =
                Array.isArray(meta.target_symbols) && meta.target_symbols.length > 0
                  ? meta.target_symbols.map((s) => String(s).trim()).filter(Boolean)
                  : existingMem.target_symbols;
              const prevTargetSymbols = (existingMem.target_symbols || []).map((s) => s.trim()).filter(Boolean);
              const sameTargetSymbols =
                prevTargetSymbols.length === nextTargetSymbols.length &&
                prevTargetSymbols.every((s, idx) => s === nextTargetSymbols[idx]);

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
                target_symbols: nextTargetSymbols,
                tags: Array.isArray(meta.tags) ? meta.tags.map(String) : existingMem.tags,
                origin: meta.origin ? String(meta.origin) : (existingMem.origin || 'session'),
                supersedes_id: cleanId,
                enabled: preservedEnabled,
                review_status: preservedReviewStatus,
                ...(typeof meta.created_commit === 'string' && meta.created_commit.trim()
                  ? { created_commit: meta.created_commit.trim() }
                  : sameTargetSymbols && existingMem.created_commit
                    ? { created_commit: existingMem.created_commit }
                    : {}),
                created_branch:
                  typeof meta.created_branch === 'string' && meta.created_branch.trim()
                    ? meta.created_branch.trim()
                    : sameTargetSymbols
                      ? existingMem.created_branch
                      : undefined,
              } as ProposalPayload;
            } else {
              const tool = storage.getTool(cleanId);
              if (!tool || !fs.existsSync(tool.script_path)) {
                sendJsonResponse(res, 404, { ok: false, error: `Not Found: Tool "${cleanId}" not found` });
                return;
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
              snapshot = buildUiSnapshot(ws, { anon: options.anon });
              notifyChange();
              sendJsonResponse(res, 400, {
                ok: false,
                code: gateRes.error_code,
                gate_failed: gateRes.gate_failed,
                error: gateRes.message || 'Gatekeeper rejected content update',
                snapshot,
              });
              return;
            }

            if (rawKind !== 'memory') {
              syncManagedRuleBlocks(ws);
            } else {
              const updatedMem = storage.getMemory(cleanId);
              if (updatedMem) {
                const dbPath = path.join(storage.cacheDir, 'telemetry.db');
                let cacheDb: DatabaseSync | undefined;
                try {
                  if (fs.existsSync(dbPath)) cacheDb = openSqliteReadOnly(dbPath);
                  verifyMemoryFreshness(ws, updatedMem, { includeCallers: true, cacheDb });
                } finally {
                  if (cacheDb) try { cacheDb.close(); } catch {}
                }
              }
            }

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

export function buildExportHtmlContent(
  workspaceRoot: string,
  options?: { anon?: boolean }
): string {
  const ws = path.resolve(workspaceRoot);
  const snapshot = buildUiSnapshot(ws, { anon: options?.anon });
  const rawHtml = renderUiClientHtml(snapshot, { isExport: true, token: '', anon: options?.anon });

  const scriptMatch = rawHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    return rawHtml.replace(/\r\n/g, '\n');
  }

  const scriptContent = scriptMatch[1].replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(scriptContent, 'utf8').digest('base64');
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; script-src 'sha256-${hash}'; connect-src 'none';">`;

  return rawHtml
    .replace('<meta name="viewport"', `${cspMeta}\n  <meta name="viewport"`)
    .replace(/\r\n/g, '\n');
}

export function exportUiHtml(
  workspaceRoot: string,
  outPath: string,
  options?: { anon?: boolean }
): void {
  const finalHtml = buildExportHtmlContent(workspaceRoot, options);
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
  const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
  const logUi = (line: string) => console.log(formatTerminalOutput(line, termOpts));
  const errUi = (line: string) => console.error(formatTerminalOutput(line, termOpts));

  const ideOpt = parseCliOption(args, '--ide');
  if (args.includes('--install-ide')) {
    logUi('🔌 Mounting EvoKernel IDE extension into detected IDEs...');
    const targetIdes = ideOpt.value
      ? ideOpt.value.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const mountRes = mountIdeExtensions(workspaceRoot, { ide: targetIdes });
    if (mountRes.mounts && mountRes.mounts.length > 0) {
      for (const m of mountRes.mounts) {
        logUi(`  ├─ ${m.name}: ${m.targetPath} (${m.method} - ${m.status})`);
      }
    } else {
      logUi('  └─ (no supported IDE extensions directory detected)');
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
    logUi(`✅ EvoKernel Workbench exported to: ${out}`);
    return;
  }

  const portLong = parseCliOption(args, '--port');
  const portShort = parseCliOption(args, '-p');
  const portOpt = portLong.matched ? portLong : portShort;
  let port: number | undefined;
  if (portOpt.matched) {
    if (!portOpt.value) {
      errUi('❌ Missing value for --port. Please specify a port number (e.g. --port 4310).');
      process.exitCode = 1;
      return;
    }
    const parsed = parseInt(portOpt.value, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
      errUi(`❌ Invalid port "${portOpt.value}". Must be a valid port number between 0 and 65535.`);
      process.exitCode = 1;
      return;
    }
    port = parsed;
  }

  const hostOpt = parseCliOption(args, '--host');
  if (hostOpt.matched) {
    if (!hostOpt.value || !hostOpt.value.trim()) {
      errUi('❌ Missing value for --host. Please specify a loopback host (e.g. --host 127.0.0.1).');
      process.exitCode = 1;
      return;
    }
    const normalizedHost = hostOpt.value.trim().toLowerCase();
    if (normalizedHost !== '127.0.0.1' && normalizedHost !== 'localhost') {
      errUi(
        `❌ Invalid --host "${hostOpt.value}". Only loopback addresses (127.0.0.1 or localhost) are permitted.`
      );
      process.exitCode = 1;
      return;
    }
  }

  const tokenOpt = parseCliOption(args, '--token');
  let token: string | undefined;
  if (tokenOpt.matched) {
    if (!tokenOpt.value || !tokenOpt.value.trim()) {
      errUi('❌ Missing value for --token. Please specify a non-empty token string.');
      process.exitCode = 1;
      return;
    }
    token = tokenOpt.value.trim();
  }

  const instance = await startUiServer(workspaceRoot, { port, token, anon: isAnon });
  logUi(`🧬 EvoKernel Workbench started at: ${instance.url}`);
  logUi('   Press Ctrl+C to terminate server.');

  const isAppMode = args.includes('--app') || args.includes('--desktop');
  const noOpen = args.includes('--no-open');
  const shouldOpen = !noOpen && (args.includes('--open') || isAppMode) && !process.env.CI && !process.argv[1]?.includes('.test.');

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
