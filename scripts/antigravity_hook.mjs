#!/usr/bin/env node
/**
 * Antigravity Native Hook Handler for EvoKernel (`PreInvocation` & `Stop`).
 *
 * Guarantees:
 * - Zero external dependencies; O(1) latency (< 30ms) by reading only the last 128 KB of transcriptPath.
 * - Wrapped in top-level try/catch: never exits non-zero or blocks the host IDE.
 * - Unquotes double-JSON-serialized Antigravity transcript arguments (`args.Path`, `args.ToolName`, `args.CommandLine`).
 * - Injects an ephemeral evolution reminder via `injectSteps` when user corrections,
 *   multi-file bug fixes, scratch script iterations, command error-recovery loops, or
 *   post-crystallization source code mutations are detected in the conversation transcript.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const TAIL_BYTES = 128 * 1024;
const COOLDOWN_STEPS = 4;

const STYLE_PREFERENCE_REGEX =
  /(?:太啰嗦|稍微精简|不美观|格式不对|排版|语言风格|文风|以后都这样|不要用表格)/i;

const CORRECTION_REGEX =
  /(?:不对|错了|还是有|乱码|漏了|为什么(?:把|会|没|要|不|是)|怎么会|难道不是|不就是|不是吗|这么理解对吗|@\[Quote\]|已经确认|实测.*(?:发现|却是|不对|不行)|实际.*(?:显示|追不上|掉|不对|不行|却是)|但(?:实验室|实际|现场)|(?:分析|前面的)?推断是否合理|重新核实|怎么回事|我不是说了|不一致|重新检查|没改对|不生效|回退|不要把|只有一半|显示不全|稍微精简|精简一些|太详细|太啰嗦|吃力|费劲|不美观|不要冲突|不要重复|重写|重新整理|调整一下|换一种|格式不对|格式有误|排版|语言风格|文风|以后都这样|不要用表格|you broke|still broken|that's wrong|incorrect|regression|why would|isn't it|shouldn't it|confirmed that|actually[\s,]|in fact[\s,])/i;

const CMD_ERROR_OUTPUT_REGEX =
  /(?:Traceback \(most recent call last\)|SyntaxError:|TypeError:|ValueError:|AttributeError:|KeyError:|ModuleNotFoundError:|ImportError:|PermissionError:|FileNotFoundError:|Command exited with code [1-9]|Exception calling|At line:\d+ char:\d+)/i;

const CMD_FATAL_SEARCH_ERROR_REGEX =
  /(?:command not found|not recognized as an internal or external command|SyntaxError:|PermissionError:|invalid option|unrecognized option|fatal:)/i;

const DELIVERABLE_CMD_REGEX =
  /(?:\.(?:xlsx?|docx?|pptx?|pdf|csv)\b|openpyxl|xlsxwriter|pandas|python-docx|win32com|New-Object\s+-ComObject\s+Excel)/i;

const EDIT_TOOL_NAMES = new Set([
  'edit_file',
  'write_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

const READ_TOOL_NAMES = new Set([
  'read_file',
  'view_file',
  'view_file_outline',
  'view_code_item',
  'grep_search',
  'find_by_name',
]);

const EVO_MCP_TOOL_NAMES = new Set([
  'evo_search',
  'evo_inspect',
  'evo_run',
  'evo_propose',
  'evo_compact',
]);

export function normalizeTranscriptString(val) {
  if (val === undefined || val === null) return '';
  let s = String(val).trim();
  for (let depth = 0; depth < 2; depth++) {
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string') {
          s = parsed.trim();
          continue;
        }
      } catch {
        s = s.slice(1, -1).trim();
      }
    }
    break;
  }
  return s;
}

export function parseTranscriptObject(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    let cur = val.trim();
    for (let depth = 0; depth < 2; depth++) {
      try {
        const parsed = JSON.parse(cur);
        if (typeof parsed === 'string') {
          cur = parsed.trim();
          continue;
        }
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        break;
      }
    }
  }
  return {};
}

export function normalizePath(val) {
  return normalizeTranscriptString(val).replace(/[\\/]+/g, '/');
}

export function normalizeCandidatePath(raw) {
  if (typeof raw !== 'string') return '';
  let s = normalizeTranscriptString(raw);
  if (!s) return '';
  if (/^file:\/\//i.test(s)) {
    try {
      s = fileURLToPath(s);
    } catch {
      return '';
    }
  }
  try {
    return path.resolve(s);
  } catch {
    return '';
  }
}

function isSameDbPath(a, b) {
  if (!a || !b) return false;
  const resolveReal = (p) => {
    const resolved = path.resolve(p);
    try {
      if (fs.existsSync(resolved)) {
        return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
      }
    } catch {}
    return resolved;
  };
  const ra = resolveReal(a);
  const rb = resolveReal(b);
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return ra.toLowerCase() === rb.toLowerCase();
  }
  return ra === rb;
}

function parseJsonStripBom(raw) {
  return JSON.parse(String(raw).replace(/^\uFEFF/, ''));
}

function readStdinJson(initialTimeoutMs = 200, chunkTimeoutMs = 300) {
  try {
    if (process.stdin.isTTY) return Promise.resolve({});
    const stat = fs.fstatSync(0);
    if (stat.isFile()) {
      if (stat.size === 0) return Promise.resolve({});
      const raw = fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trim();
      return Promise.resolve(raw ? parseJsonStripBom(raw) : {});
    }
  } catch {
    // fstat failed, proceed with stream
  }

  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    let timer = null;

    function finish(raw) {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        try { process.stdin.pause(); } catch {}
        try { process.stdin.destroy(); } catch {}
        try {
          const cleaned = raw ? raw.replace(/^\uFEFF/, '').trim() : '';
          resolve(cleaned ? parseJsonStripBom(cleaned) : {});
        } catch {
          resolve({});
        }
      }
    }

    timer = setTimeout(() => {
      finish(data);
    }, initialTimeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
      try {
        const cleaned = data.replace(/^\uFEFF/, '').trim();
        const parsed = parseJsonStripBom(cleaned);
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          try { process.stdin.pause(); } catch {}
          try { process.stdin.destroy(); } catch {}
          resolve(parsed);
        }
      } catch {
        // Multi-chunk stream: reset timer so subsequent chunks are received
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          finish(data);
        }, chunkTimeoutMs);
      }
    });

    process.stdin.on('end', () => {
      finish(data);
    });

    process.stdin.on('error', () => {
      finish('');
    });

    process.stdin.resume();
  });
}

function readTranscriptTailSteps(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) {
    return [];
  }
  const stat = fs.statSync(transcriptPath);
  if (!stat.isFile() || stat.size === 0) return [];

  const readSize = Math.min(stat.size, TAIL_BYTES);
  const startOffset = Math.max(0, stat.size - readSize);
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, startOffset);
    const text = buf.toString('utf8');
    const rawLines = text.split(/\r?\n/);
    if (startOffset > 0 && rawLines.length > 1) {
      rawLines.shift();
    }
    const steps = [];
    for (const line of rawLines) {
      const trimmed = line.replace(/^\uFEFF/, '').trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        steps.push(parseJsonStripBom(trimmed));
      } catch {
        // Ignore malformed/truncated JSONL lines
      }
    }
    return steps;
  } finally {
    fs.closeSync(fd);
  }
}

function sleepSyncMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Fallback if SharedArrayBuffer is unavailable
  }
}

function loadHookStateSafe(statePath) {
  let parseFailed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!fs.existsSync(statePath)) return { state: {}, parseFailed: false };
      const stat = fs.statSync(statePath);
      const raw = fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, '');
      if (!raw.trim()) {
        if (stat.size > 0) parseFailed = true;
        if (attempt < 2) sleepSyncMs(10);
        continue;
      }
      const parsed = parseJsonStripBom(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { state: parsed, parseFailed: false };
      }
      parseFailed = true;
    } catch {
      parseFailed = true;
    }
    if (attempt < 2) sleepSyncMs(10);
  }
  try {
    if (fs.existsSync(statePath) && fs.statSync(statePath).size > 0) {
      return { state: {}, parseFailed: true };
    }
  } catch {}
  return { state: {}, parseFailed };
}

function loadHookState(statePath) {
  return loadHookStateSafe(statePath).state;
}

function saveHookState(statePath, state, conversationId, convState) {
  let lockFd = null;
  const lockPath = `${statePath}.lock`;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        lockFd = fs.openSync(lockPath, 'wx');
        break;
      } catch (err) {
        if (err && err.code === 'EEXIST') {
          try {
            const st = fs.statSync(lockPath);
            if (Date.now() - st.mtimeMs > 2000) {
              fs.unlinkSync(lockPath);
              continue;
            }
          } catch {}
          sleepSyncMs(10);
          continue;
        }
        break;
      }
    }

    const { state: diskState, parseFailed } = loadHookStateSafe(statePath);
    if (parseFailed) {
      return;
    }
    const merged = { ...state, ...diskState };
    if (conversationId && convState) {
      merged[conversationId] = convState;
    }
    const serialized = JSON.stringify(merged);
    const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tmpPath, statePath);
    } catch {
      fs.writeFileSync(statePath, serialized, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup error
      }
    }
  } catch {
    // Ignore write errors
  } finally {
    if (lockFd !== null) {
      try {
        fs.closeSync(lockFd);
      } catch {}
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    }
  }
}

export function findNearestEvoTelemetryDb(startDir) {
  const normStart = normalizeCandidatePath(startDir);
  if (!normStart) return '';
  let dir = normStart;
  try {
    if (fs.existsSync(dir) && fs.statSync(dir).isFile()) {
      dir = path.dirname(dir);
    }
  } catch {}

  const homeDir = os.homedir();
  const tmpDir = os.tmpdir();
  const globalHome = process.env.EVO_GLOBAL_DIR
    ? path.resolve(process.env.EVO_GLOBAL_DIR)
    : path.join(homeDir, '.evo', 'global');
  const startIsGlobalDir = isSameDbPath(dir, globalHome);

  for (let depth = 0; depth < 32; depth++) {
    const isFirst = depth === 0;
    const isBoundaryStop =
      isSameDbPath(dir, homeDir) ||
      isSameDbPath(dir, tmpDir) ||
      /[\\/]\.(?:gemini|claude|cursor)(?:[\\/]|$)/i.test(dir);

    if (isBoundaryStop && !(isFirst && startIsGlobalDir)) {
      break;
    }

    const dbCand = path.join(dir, '.evo', '.cache', 'telemetry.db');
    if (fs.existsSync(dbCand)) {
      return dbCand;
    }
    if (isFirst && startIsGlobalDir) {
      const globalCacheCand = path.join(dir, '.cache', 'telemetry.db');
      if (fs.existsSync(globalCacheCand)) {
        return globalCacheCand;
      }
    }

    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return '';
}

function isSameOrSubpath(childPath, parentPath) {
  const normChild = normalizeCandidatePath(childPath);
  const normParent = normalizeCandidatePath(parentPath);
  if (!normChild || !normParent) return false;
  const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
  const c = isCaseInsensitive ? normChild.toLowerCase() : normChild;
  const p = isCaseInsensitive ? normParent.toLowerCase() : normParent;
  if (c === p) return true;
  const pWithSep = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(pWithSep);
}

function extractWorkspaceDbFromTranscriptSteps(steps, allowedRoots = []) {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const toolCalls = Array.isArray(step?.tool_calls) ? step.tool_calls : [];
    for (let j = toolCalls.length - 1; j >= 0; j--) {
      const tc = toolCalls[j];
      const toolName = normalizeTranscriptString(tc?.name || tc?.tool_name || tc?.ToolName || '');
      const args = parseTranscriptObject(tc?.arguments || tc?.args || tc?.Arguments || {});
      const innerToolName = normalizeTranscriptString(args.ToolName || args.tool_name || '');
      const innerArgs = parseTranscriptObject(args.Arguments || args);
      const isEvoCall =
        EVO_MCP_TOOL_NAMES.has(toolName) ||
        EVO_MCP_TOOL_NAMES.has(innerToolName) ||
        [...EVO_MCP_TOOL_NAMES].some((t) => toolName.endsWith(`_${t}`) || toolName.includes(t));
      if (!isEvoCall) continue;
      const wsCand =
        innerArgs.workspace ||
        innerArgs.workspace_path ||
        args.workspace ||
        args.workspace_path ||
        '';
      const dbPath = findNearestEvoTelemetryDb(wsCand);
      if (dbPath) return dbPath;
    }
  }

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const toolCalls = Array.isArray(step?.tool_calls) ? step.tool_calls : [];
    for (let j = toolCalls.length - 1; j >= 0; j--) {
      const tc = toolCalls[j];
      const toolName = normalizeTranscriptString(tc?.name || tc?.tool_name || tc?.ToolName || '');
      const args = parseTranscriptObject(tc?.arguments || tc?.args || tc?.Arguments || {});
      const innerToolName = normalizeTranscriptString(args.ToolName || args.tool_name || '');
      const innerArgs = parseTranscriptObject(args.Arguments || args);
      const isTrackedFileOrCmdTool =
        EDIT_TOOL_NAMES.has(toolName) ||
        EDIT_TOOL_NAMES.has(innerToolName) ||
        READ_TOOL_NAMES.has(toolName) ||
        READ_TOOL_NAMES.has(innerToolName) ||
        toolName === 'run_command' ||
        innerToolName === 'run_command';
      if (!isTrackedFileOrCmdTool) continue;

      const pathCandidates = [
        innerArgs.AbsolutePath,
        innerArgs.Path,
        innerArgs.path,
        innerArgs.TargetFile,
        innerArgs.target_file,
        innerArgs.DirectoryPath,
        innerArgs.SearchDirectory,
        innerArgs.Cwd,
        innerArgs.cwd,
        args.AbsolutePath,
        args.Path,
        args.path,
        args.TargetFile,
        args.target_file,
        args.DirectoryPath,
        args.SearchDirectory,
        args.Cwd,
        args.cwd,
      ];
      for (const rawCand of pathCandidates) {
        if (typeof rawCand !== 'string' || !rawCand.trim()) continue;
        const normCand = normalizeCandidatePath(rawCand);
        if (!normCand) continue;
        if (
          allowedRoots.length > 0 &&
          !allowedRoots.some((root) => isSameOrSubpath(normCand, root))
        ) {
          continue;
        }
        const dbPath = findNearestEvoTelemetryDb(normCand);
        if (dbPath) return dbPath;
      }
    }
  }
  return '';
}

function parseTimestampMs(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return NaN;
  const trimmed = raw.trim();
  if (!trimmed) return NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return Date.parse(trimmed.replace(' ', 'T') + 'Z');
  }
  return Date.parse(trimmed);
}

function isChildTelemetryDbActive(dbPath, cutoffMs) {
  let db;
  try {
    try {
      db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });
    } catch {
      db = new DatabaseSync(dbPath, { timeout: 1000 });
    }
    let row;
    try {
      row = db
        .prepare("SELECT value, updated_at FROM session_state WHERE key = 'recalled_capabilities'")
        .get();
    } catch {
      row = db
        .prepare("SELECT value FROM session_state WHERE key = 'recalled_capabilities'")
        .get();
    }
    if (!row || typeof row.value !== 'string' || !row.value.trim()) return false;
    let parsed;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return false;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const validItems = parsed.filter(
      (item) => item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim() !== ''
    );
    if (validItems.length === 0) return false;

    const rowUpdatedAtMs = parseTimestampMs(row.updated_at);
    if (Number.isFinite(rowUpdatedAtMs) && rowUpdatedAtMs >= cutoffMs) {
      return true;
    }
    return validItems.some((item) => {
      const tsMs = typeof item.at === 'number' ? item.at : parseTimestampMs(item.ts);
      return Number.isFinite(tsMs) && tsMs >= cutoffMs;
    });
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

function findSingleActiveChildTelemetryDb(candidateRoots) {
  if (!Array.isArray(candidateRoots) || candidateRoots.length === 0) return '';
  const homeDir = os.homedir();
  const tmpDir = os.tmpdir();
  const skipDirNames = new Set(['node_modules', '.git', 'dist', 'build']);
  const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
  const visitedDirs = new Set();
  const seenDbs = new Set();
  const candidateDbs = [];
  const queue = [];

  for (const root of candidateRoots) {
    let dir = root;
    try {
      if (!fs.existsSync(dir)) continue;
      if (fs.statSync(dir).isFile()) dir = path.dirname(dir);
    } catch {
      continue;
    }
    if (isSameDbPath(dir, homeDir) || isSameDbPath(dir, tmpDir)) continue;
    const key = isCaseInsensitive ? dir.toLowerCase() : dir;
    if (visitedDirs.has(key)) continue;
    visitedDirs.add(key);
    queue.push({ dir, depth: 0 });
  }

  let scannedEntries = 0;
  const MAX_SCANNED_ENTRIES = 64;
  while (queue.length > 0 && scannedEntries < MAX_SCANNED_ENTRIES) {
    const { dir, depth } = queue.shift();
    if (depth >= 2) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (scannedEntries >= MAX_SCANNED_ENTRIES) break;
      scannedEntries++;
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (skipDirNames.has(name)) continue;
      if (name.startsWith('.') && name !== '.evo') continue;
      if (name === '.evo') continue;

      const childPath = path.join(dir, name);
      if (isSameDbPath(childPath, homeDir) || isSameDbPath(childPath, tmpDir)) continue;
      const childKey = isCaseInsensitive ? childPath.toLowerCase() : childPath;
      if (visitedDirs.has(childKey)) continue;
      visitedDirs.add(childKey);

      const candDb = path.join(childPath, '.evo', '.cache', 'telemetry.db');
      try {
        if (fs.existsSync(candDb)) {
          const dbKey = isCaseInsensitive ? candDb.toLowerCase() : candDb;
          if (!seenDbs.has(dbKey)) {
            seenDbs.add(dbKey);
            candidateDbs.push(candDb);
          }
        }
      } catch {}

      if (depth + 1 < 2) {
        queue.push({ dir: childPath, depth: depth + 1 });
      }
    }
  }

  if (candidateDbs.length === 0) return '';
  const cutoffMs = Date.now() - 1_800_000;
  const activeDbs = candidateDbs.filter((candDb) => isChildTelemetryDbActive(candDb, cutoffMs));
  return activeDbs.length === 1 ? activeDbs[0] : '';
}

function resolveWorkspaceCwd(rawCwd) {
  const norm = normalizeCandidatePath(rawCwd);
  if (!norm) return '';
  return path.basename(norm) === '.agents' ? path.dirname(norm) : norm;
}

function resolveTelemetryDbsForStop(input, steps = []) {
  const rawCandidates = [
    ...(Array.isArray(input.workspacePaths) ? input.workspacePaths : []),
    ...(Array.isArray(input.workspace_paths) ? input.workspace_paths : []),
    input.workspace,
    input.workspaceRoot,
    input.workspace_root,
    resolveWorkspaceCwd(input.cwd),
  ];
  const seen = new Set();
  const normalizedCandidates = [];
  let localDbPath = '';
  for (const raw of rawCandidates) {
    const norm = normalizeCandidatePath(raw);
    if (!norm) continue;
    const key =
      process.platform === 'win32' || process.platform === 'darwin' ? norm.toLowerCase() : norm;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedCandidates.push(norm);
    if (!localDbPath) {
      const found = findNearestEvoTelemetryDb(norm);
      if (found) {
        localDbPath = found;
      }
    }
  }
  if (!localDbPath && Array.isArray(steps) && steps.length > 0) {
    localDbPath = extractWorkspaceDbFromTranscriptSteps(steps, normalizedCandidates);
  }
  if (!localDbPath && normalizedCandidates.length > 0) {
    localDbPath = findSingleActiveChildTelemetryDb(normalizedCandidates);
  }
  if (!localDbPath && normalizedCandidates.length === 0) {
    const fallbackRoot = resolveWorkspaceCwd(process.cwd());
    if (fallbackRoot) {
      normalizedCandidates.push(fallbackRoot);
      localDbPath = findNearestEvoTelemetryDb(fallbackRoot);
      if (!localDbPath) {
        localDbPath = findSingleActiveChildTelemetryDb([fallbackRoot]);
      }
    }
  }

  const globalHome = process.env.EVO_GLOBAL_DIR
    ? path.resolve(process.env.EVO_GLOBAL_DIR)
    : path.join(os.homedir(), '.evo', 'global');
  let globalDbPath = '';
  for (const cand of [
    path.join(globalHome, '.evo', '.cache', 'telemetry.db'),
    path.join(globalHome, '.cache', 'telemetry.db'),
  ]) {
    if (fs.existsSync(cand)) {
      globalDbPath = cand;
      break;
    }
  }
  return { localDbPath, globalDbPath };
}

function isSqliteBusyError(err) {
  if (!err) return false;
  const code = String(err.code || err.errcode || '');
  const msg = String(err.message || err);
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(`${code} ${msg}`);
}

function withSqliteBusyRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isSqliteBusyError(err) || attempt >= maxRetries) {
        throw err;
      }
      sleepSyncMs(25 * (attempt + 1));
    }
  }
  throw lastErr;
}

function openTelemetryDb(dbPath) {
  const db = new DatabaseSync(dbPath, { timeout: 3000 });
  try {
    db.exec('PRAGMA busy_timeout = 3000;');
  } catch {}
  return db;
}

function markRecallEventHelpedInDb(db, rawId, cleanId = rawId) {
  const raw = String(rawId || cleanId || '');
  const clean = String(cleanId || rawId || '');
  if (!raw && !clean) return;
  const recentCutoff = new Date(Date.now() - 86_400_000).toISOString();
  db.prepare(
    `UPDATE recall_events
     SET helped = 1
     WHERE id = (
       SELECT id FROM recall_events
       WHERE (capability_id = ? OR lower(capability_id) = ? OR capability_id = ?)
         AND helped = 0
         AND event_type IN ('inspect', 'run')
         AND timestamp >= ?
       ORDER BY id DESC
       LIMIT 1
     )`
  ).run(raw, raw.toLowerCase(), clean, recentCutoff);
}

function applyStopOutcomeToDb(db, cleanId, kind, outcome, options = {}) {
  const col = outcome === 'helped' ? 'helped_count' : 'contested_count';
  const res = db
    .prepare(`UPDATE telemetry SET ${col} = ${col} + 1 WHERE id = ? OR lower(id) = ?`)
    .run(cleanId, cleanId);
  if (res.changes === 0) {
    const nowIso = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO telemetry (id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, tokens_saved, last_used_at, created_at, ${col})
         VALUES (?, ?, ?, '', '', 1, 0, 0, 0, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET ${col} = ${col} + 1`
      ).run(cleanId, kind || 'rule', cleanId, nowIso, nowIso);
    } catch {
      // ignore insert failure on partial schema
    }
  }
  if (outcome === 'helped' && options.updateRecallEvents !== false) {
    markRecallEventHelpedInDb(db, options.rawId || cleanId, cleanId);
  }
}

function createSessionStateUpserter(db) {
  let hasUpdatedAt = false;
  try {
    const cols = db.prepare('PRAGMA table_info(session_state)').all();
    hasUpdatedAt = Array.isArray(cols) && cols.some((col) => col && col.name === 'updated_at');
  } catch {
    hasUpdatedAt = false;
  }
  if (hasUpdatedAt) {
    const stmt = db.prepare(
      'INSERT INTO session_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    );
    return (key, value) => stmt.run(key, String(value), new Date().toISOString());
  }
  const stmt = db.prepare(
    'INSERT INTO session_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  return (key, value) => stmt.run(key, String(value));
}

function syncSessionStateToTelemetryDb(dbPath, syncInfo) {
  const result = { alreadySettledByPropose: false, synced: false };
  if (!dbPath || !fs.existsSync(dbPath)) return result;
  if (
    !syncInfo.setUserCorrectionTrue &&
    !syncInfo.clearUserCorrection &&
    syncInfo.hadCommandErrorValue === null &&
    syncInfo.unproposedEditCountValue === null &&
    !syncInfo.sessionEpoch
  ) {
    return result;
  }
  let db;
  try {
    db = openTelemetryDb(dbPath);
    const getFlag = (key) => {
      const row = db.prepare('SELECT value FROM session_state WHERE key = ?').get(key);
      return row && row.value !== undefined ? String(row.value) : undefined;
    };
    if (syncInfo.hasProposeAfterCorrection) {
      const contestedAttr = getFlag('contested_attributed') === 'true';
      const cliProposeAt = getFlag('last_propose_at');
      const userCorrFlag = getFlag('user_correction_detected');
      if (contestedAttr || (cliProposeAt && userCorrFlag === 'false')) {
        result.alreadySettledByPropose = true;
      }
    }
    withSqliteBusyRetry(() => {
      const upsert = createSessionStateUpserter(db);
      if (syncInfo.clearUserCorrection) {
        upsert('user_correction_detected', 'false');
      } else if (syncInfo.setUserCorrectionTrue && !result.alreadySettledByPropose) {
        upsert('user_correction_detected', 'true');
      }
      if (syncInfo.hadCommandErrorValue !== null) {
        upsert('had_command_error', syncInfo.hadCommandErrorValue);
      }
      if (syncInfo.unproposedEditCountValue !== null) {
        upsert('unproposed_edit_count', syncInfo.unproposedEditCountValue);
      }
      if (syncInfo.sessionEpoch) {
        upsert('active_session_epoch', syncInfo.sessionEpoch);
      }
    });
    result.synced = true;
  } catch {
    // Non-fatal: partial DB or read-only environment
  } finally {
    try {
      db?.close();
    } catch {}
  }
  return result;
}

function closeRecalledTelemetryOnStop(
  input,
  hadTurnCorrection,
  resolvedDbs = null,
  partitionInfo = null
) {
  let localDb;
  let globalDb;
  try {
    const { localDbPath, globalDbPath } = resolvedDbs || resolveTelemetryDbsForStop(input);
    if (!localDbPath || !fs.existsSync(localDbPath)) {
      return;
    }
    localDb = openTelemetryDb(localDbPath);
    const getFlag = (key) => {
      const row = localDb.prepare('SELECT value FROM session_state WHERE key = ?').get(key);
      return row && row.value !== undefined ? String(row.value) : undefined;
    };
    const rawSetFlag = createSessionStateUpserter(localDb);
    const setFlag = (key, value) => withSqliteBusyRetry(() => rawSetFlag(key, value));

    const userCorrectionFlag = getFlag('user_correction_detected') === 'true';
    const hadCommandErrorFlag = getFlag('had_command_error') === 'true';
    const contestedAttributed = getFlag('contested_attributed') === 'true';
    const contestedAt = parseInt(getFlag('contested_at') || '0', 10);
    const hasCorrection = hadTurnCorrection || userCorrectionFlag;

    const recalledRaw = getFlag('recalled_capabilities');
    let validEntries = [];
    if (recalledRaw) {
      let parsed = [];
      try {
        const candidate = JSON.parse(recalledRaw);
        if (Array.isArray(candidate)) parsed = candidate;
      } catch {}
      const now = Date.now();
      validEntries = parsed.filter((item) => {
        if (!item || typeof item.id !== 'string') return false;
        const tsMs = typeof item.at === 'number' ? item.at : Date.parse(String(item.ts || ''));
        if (Number.isFinite(tsMs) && now - tsMs > 86_400_000) return false;
        return true;
      });
    }

    const recordEntries = (entries, targetOutcome) => {
      for (const entry of entries) {
        const rawId = String(entry.id || '').trim();
        const cleanId = rawId.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');
        if (!cleanId) continue;
        const kind = String(entry.kind || 'rule');
        if (entry.tier === 'GLOBAL') {
          if (globalDbPath && !isSameDbPath(localDbPath, globalDbPath)) {
            if (!globalDb) {
              globalDb = openTelemetryDb(globalDbPath);
            }
            withSqliteBusyRetry(() => {
              applyStopOutcomeToDb(globalDb, cleanId, kind, targetOutcome, {
                updateRecallEvents: false,
                rawId,
              });
            });
            if (targetOutcome === 'helped') {
              withSqliteBusyRetry(() => {
                markRecallEventHelpedInDb(localDb, rawId, cleanId);
              });
            }
          } else if (!globalDbPath) {
            if (targetOutcome === 'helped') {
              withSqliteBusyRetry(() => {
                markRecallEventHelpedInDb(localDb, rawId, cleanId);
              });
            }
          } else {
            withSqliteBusyRetry(() => {
              applyStopOutcomeToDb(localDb, cleanId, kind, targetOutcome, { rawId });
            });
          }
        } else {
          withSqliteBusyRetry(() => {
            applyStopOutcomeToDb(localDb, cleanId, kind, targetOutcome, { rawId });
          });
        }
      }
    };

    if (hasCorrection) {
      if (!contestedAttributed && validEntries.length > 0) {
        const proposeCutoff =
          partitionInfo && partitionInfo.isPartitioned && partitionInfo.proposeCutoffMs > 0
            ? partitionInfo.proposeCutoffMs
            : 0;
        let entriesToRecord = validEntries;
        let keptAfterPropose = null;
        if (proposeCutoff > 0) {
          entriesToRecord = validEntries.filter((c) => {
            const tsMs = typeof c.at === 'number' ? c.at : Date.parse(String(c.ts || ''));
            return !Number.isFinite(tsMs) || tsMs <= proposeCutoff;
          });
          keptAfterPropose = validEntries.filter((c) => {
            const tsMs = typeof c.at === 'number' ? c.at : Date.parse(String(c.ts || ''));
            return Number.isFinite(tsMs) && tsMs > proposeCutoff;
          });
        }
        if (entriesToRecord.length > 0) {
          recordEntries(entriesToRecord, 'contested');
        }
        if (keptAfterPropose !== null) {
          if (keptAfterPropose.length > 0) {
            setFlag('recalled_capabilities', JSON.stringify(keptAfterPropose));
            setFlag('contested_attributed', 'true');
            setFlag('contested_at', String(proposeCutoff));
          } else {
            withSqliteBusyRetry(() => {
              localDb.exec("DELETE FROM session_state WHERE key = 'recalled_capabilities'");
            });
            setFlag('contested_attributed', 'true');
            setFlag('contested_at', String(Date.now()));
          }
        } else {
          setFlag('contested_attributed', 'true');
          setFlag('contested_at', String(Date.now()));
        }
      }
      setFlag('user_correction_detected', 'false');
    } else if (!hadCommandErrorFlag) {
      const entriesToRecord = validEntries.filter((c) => {
        const tsMs = typeof c.at === 'number' ? c.at : Date.parse(String(c.ts || ''));
        return !contestedAttributed || (contestedAt > 0 && Number.isFinite(tsMs) && tsMs > contestedAt);
      });
      if (entriesToRecord.length > 0) {
        recordEntries(entriesToRecord, 'helped');
      }
      withSqliteBusyRetry(() => {
        localDb.exec(
          "DELETE FROM session_state WHERE key IN ('recalled_capabilities', 'contested_attributed', 'contested_at', 'user_correction_detected')"
        );
      });
    }
    // When hadCommandErrorFlag === true && !hasCorrection: defer attribution and preserve session_state
  } catch {
    // Non-fatal: Stop hook must never block or fail host IDE
  } finally {
    try {
      globalDb?.close();
    } catch {}
    try {
      localDb?.close();
    } catch {}
  }
}

function createDefaultConvState() {
  return {
    lastRemindedStep: -999,
    lastCorrectionStep: -1,
    clearedCorrectionStep: -1,
    clearedTelemetryCorrectionStep: -1,
    lastObservedUserStep: -1,
    lastDirtyEditStep: -1,
    clearedDirtyEditStep: -1,
    lastErrorRecoveryStep: -1,
    clearedErrorRecoveryStep: -1,
    lastAuditStep: -1,
    clearedAuditStep: -1,
    lastProposeStepForAt: -1,
    lastProposeAtMs: 0,
    maxMonotonicStep: -1,
    tailAnchors: [],
    syncedEpoch: '',
  };
}

function computeStepFingerprint(step) {
  const createdAt = step?.created_at ?? '';
  const type = step?.type ?? '';
  const content = normalizeTranscriptString(step?.content || '').slice(0, 120);
  return crypto
    .createHash('sha1')
    .update(`${createdAt}|${type}|${content}`)
    .digest('hex')
    .slice(0, 12);
}

function resolveSyntheticBaseOffset(steps, convState) {
  const hasSynthetic = steps.some((s) => typeof s?.step_index !== 'number');
  if (!hasSynthetic) return 0;

  const anchors = Array.isArray(convState?.tailAnchors) ? convState.tailAnchors : [];
  if (anchors.length === 0) {
    return (convState?.maxMonotonicStep ?? -1) >= 0 ? (convState.maxMonotonicStep ?? -1) + 1 : 0;
  }

  const fps = steps.map((s) => (typeof s?.step_index === 'number' ? null : computeStepFingerprint(s)));
  for (let i = 0; i < steps.length; i++) {
    const fp = fps[i];
    if (!fp) continue;
    // Prefer a 2-step anchor match when possible to disambiguate identical empty steps
    if (i + 1 < steps.length && fps[i + 1]) {
      for (let a = 0; a + 1 < anchors.length; a++) {
        if (anchors[a][0] === fp && anchors[a + 1][0] === fps[i + 1]) {
          return Math.max(0, anchors[a][1] - i);
        }
      }
    }
    for (let a = 0; a < anchors.length; a++) {
      if (anchors[a][0] === fp) {
        return Math.max(0, anchors[a][1] - i);
      }
    }
  }

  return (convState?.maxMonotonicStep ?? -1) >= 0 ? (convState.maxMonotonicStep ?? -1) + 1 : 0;
}

function analyzeTranscriptSteps(steps, convState) {
  let latestStepIndex = steps.length;
  let latestUserContent = '';
  let latestUserStepIndex = -1;
  let userInputHadPriorModelStep = false;
  let lastCorrectionInTranscriptStep = -1;
  let seenModelStep = false;
  let editCountSinceLastPropose = 0;
  let codeReadCountSinceLastPropose = 0;
  let scratchScriptCountSinceLastPropose = 0;
  let deliverableRunCountSinceLastPropose = 0;
  let hadCommandErrorSinceLastPropose = false;
  let hasUnrecoveredCmdError = false;
  let hasCommandErrorRecovery = false;
  let latestErrorRecoveryStepIndex = -1;
  let latestAuditStepIndex = -1;
  let editsAfterPropose = 0;
  let latestDirtyEditStepIndex = -1;
  let lastProposeId = '';
  let lastProposeStepIndex = -1;
  let lastProposeStepCreatedAtMs = 0;
  let seenPropose = false;
  let toolWorkStepsAfterUserCorrection = 0;

  const syntheticBaseOffset = resolveSyntheticBaseOffset(steps, convState);
  const newTailAnchors = [];
  let maxSyntheticIdx = convState?.maxMonotonicStep ?? -1;

  const initialPersistedCorrectionStep =
    (convState.lastCorrectionStep ?? -1) > (convState.clearedCorrectionStep ?? -1)
      ? (convState.lastCorrectionStep ?? -1)
      : -1;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let idx;
    if (typeof step.step_index === 'number') {
      idx = step.step_index;
    } else {
      idx = syntheticBaseOffset + i;
      newTailAnchors.push([computeStepFingerprint(step), idx]);
      if (idx > maxSyntheticIdx) maxSyntheticIdx = idx;
    }
    latestStepIndex = idx;

    if (
      step.type === 'PLANNER_RESPONSE' ||
      step.source === 'MODEL' ||
      (typeof step.step_index === 'number' && step.step_index > 1)
    ) {
      seenModelStep = true;
    }

    if (step.source === 'SYSTEM' && step.type === 'SYSTEM_MESSAGE') {
      const sysContent = normalizeTranscriptString(step.content || '');
      const isBackgroundTaskWakeup =
        /\bsender=[^\s]*\/task-/i.test(sysContent) ||
        /\bsender=(?:system|task-|cron|timer|background)\b/i.test(sysContent) ||
        /\bTask id ["'][^"']+["']\s+(?:finished|completed|failed|exited)/i.test(sysContent);
      if (
        sysContent.includes('sender=') &&
        !isBackgroundTaskWakeup &&
        (seenModelStep || !sysContent.includes('<original_task>'))
      ) {
        seenModelStep = true;
        latestAuditStepIndex = idx;
      }
    }

    if (
      (step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT') &&
      step.source !== 'SYSTEM'
    ) {
      latestUserContent = normalizeTranscriptString(step.content || '');
      latestUserStepIndex = idx;
      userInputHadPriorModelStep = seenModelStep;
      toolWorkStepsAfterUserCorrection = 0;
      if (seenModelStep && CORRECTION_REGEX.test(latestUserContent)) {
        lastCorrectionInTranscriptStep = idx;
      }
    }

    const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    if (toolCalls.length > 0) {
      seenModelStep = true;
    }

    const activeUserTurnStep =
      latestUserStepIndex >= 0 ? latestUserStepIndex : initialPersistedCorrectionStep;

    let separateOutputOffset = 0;
    for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
      const tc = toolCalls[tcIdx];
      const toolName = normalizeTranscriptString(tc.name || tc.tool_name || tc.ToolName || '');
      const args = parseTranscriptObject(tc.arguments || tc.args || tc.Arguments || {});
      const innerArgs = parseTranscriptObject(args.Arguments || args);
      const innerToolName = normalizeTranscriptString(args.ToolName || args.tool_name || '');
      const serverName = normalizeTranscriptString(args.ServerName || args.server_name || '');

      const inlineOutput = normalizeTranscriptString(tc.output || tc.result || step.output || '');
      let matchedOutputStep = null;
      if (!inlineOutput) {
        const tcCallId = normalizeTranscriptString(tc.id || tc.call_id || '');
        if (tcCallId) {
          for (let j = i + 1; j < steps.length; j++) {
            const cand = steps[j];
            const candType = String(cand?.type || '');
            const candSource = String(cand?.source || '');
            if (
              candType === 'USER_INPUT' ||
              candType === 'PLANNER_RESPONSE' ||
              candSource === 'USER_EXPLICIT' ||
              Array.isArray(cand?.tool_calls)
            ) {
              break;
            }
            const candCallId = normalizeTranscriptString(cand?.call_id || cand?.tool_call_id || '');
            if (candCallId && candCallId === tcCallId) {
              matchedOutputStep = cand;
              break;
            }
          }
        }
        if (!matchedOutputStep && i + 1 + separateOutputOffset < steps.length) {
          const cand = steps[i + 1 + separateOutputOffset];
          const candType = String(cand?.type || '');
          const candSource = String(cand?.source || '');
          if (
            candType !== 'USER_INPUT' &&
            candType !== 'PLANNER_RESPONSE' &&
            candSource !== 'USER_EXPLICIT' &&
            !Array.isArray(cand?.tool_calls)
          ) {
            matchedOutputStep = cand;
          }
        }
        separateOutputOffset++;
      }

      const isEvoPropose =
        toolName.includes('evo_propose') ||
        innerToolName === 'evo_propose' ||
        toolName.includes('evo_compact') ||
        innerToolName === 'evo_compact';

      if (isEvoPropose) {
        seenPropose = true;
        lastProposeStepIndex = idx;
        const rawCreatedAt = tc.created_at ?? step.created_at;
        if (rawCreatedAt !== undefined && rawCreatedAt !== null) {
          const parsedMs =
            typeof rawCreatedAt === 'number' ? rawCreatedAt : Date.parse(String(rawCreatedAt));
          if (Number.isFinite(parsedMs) && parsedMs > 0) {
            lastProposeStepCreatedAtMs = parsedMs;
          }
        }
        editCountSinceLastPropose = 0;
        codeReadCountSinceLastPropose = 0;
        scratchScriptCountSinceLastPropose = 0;
        deliverableRunCountSinceLastPropose = 0;
        hadCommandErrorSinceLastPropose = false;
        hasUnrecoveredCmdError = false;
        hasCommandErrorRecovery = false;
        latestErrorRecoveryStepIndex = -1;
        latestAuditStepIndex = -1;
        editsAfterPropose = 0;
        latestDirtyEditStepIndex = -1;
        toolWorkStepsAfterUserCorrection = 0;
        lastProposeId =
          normalizeTranscriptString(innerArgs?.id) || lastProposeId || 'capability';
      } else {
        if (
          activeUserTurnStep >= 0 &&
          activeUserTurnStep > lastProposeStepIndex &&
          idx > activeUserTurnStep
        ) {
          toolWorkStepsAfterUserCorrection++;
        }

        const targetToolId = normalizeTranscriptString(
          innerArgs?.tool_id || args.tool_id || ''
        );
        const isCodegraphCall =
          toolName.toLowerCase().includes('codegraph') ||
          innerToolName.toLowerCase().includes('codegraph') ||
          serverName.toLowerCase().includes('codegraph') ||
          targetToolId.toLowerCase().includes('codegraph');

        if (isCodegraphCall) {
          codeReadCountSinceLastPropose++;
        } else if (READ_TOOL_NAMES.has(toolName)) {
          const readPath = normalizePath(
            args.AbsolutePath ||
              args.Path ||
              args.path ||
              args.File ||
              args.file ||
              args.TargetFile ||
              args.target_file ||
              args.SearchPath ||
              args.search_path ||
              args.SearchDirectory ||
              args.search_directory ||
              ''
          );
          const isIgnoredMetaRead =
            /(?:^|\/)\.(?:gemini|evo|agents)(?:\/|$)/i.test(readPath);
          if (!isIgnoredMetaRead) {
            codeReadCountSinceLastPropose++;
          }
        }

        if (EDIT_TOOL_NAMES.has(toolName)) {
          const targetPath = normalizePath(
            args.Path || args.path || args.TargetFile || args.target_file || args.AbsolutePath || ''
          );
          const isIgnoredMetaEdit =
            targetPath.includes('/.gemini/antigravity/brain/') ||
            /(?:^|\/)\.evo(?:\/|$)/i.test(targetPath) ||
            targetPath.endsWith('/PROJECT_STATE.md') ||
            targetPath === 'PROJECT_STATE.md';

          const isScratchScript =
            (targetPath.includes('/.gemini/antigravity/scratch/') ||
              targetPath.includes('/scratch/')) &&
            /\.(?:py|mjs|cjs|js|ts|ps1|sh)$/i.test(targetPath);

          if (isScratchScript) {
            scratchScriptCountSinceLastPropose++;
          }

          if (!isIgnoredMetaEdit) {
            editCountSinceLastPropose++;
            if (seenPropose) {
              editsAfterPropose++;
              latestDirtyEditStepIndex = idx;
            }
          }
        } else if (toolName === 'run_command') {
          const cmdLine = normalizeTranscriptString(
            args.CommandLine || args.command_line || args.command || ''
          );
          const cmdOutput = inlineOutput
            ? inlineOutput
            : matchedOutputStep
              ? normalizeTranscriptString(
                  matchedOutputStep.content || matchedOutputStep.output || matchedOutputStep.result || ''
                )
              : '';
          const nextStepStatus = matchedOutputStep ? String(matchedOutputStep.status || '') : '';

          const exitedZero =
            /Command exited with code 0\b/i.test(cmdOutput) ||
            tc.exit_code === 0 ||
            matchedOutputStep?.exit_code === 0;
          const explicitNonZeroExit =
            (typeof tc.exit_code === 'number' && tc.exit_code !== 0) ||
            (typeof matchedOutputStep?.exit_code === 'number' && matchedOutputStep.exit_code !== 0) ||
            /Command exited with code [1-9]\d*\b/i.test(cmdOutput);

          let isCmdError =
            tc.status === 'ERROR' ||
            nextStepStatus === 'ERROR' ||
            explicitNonZeroExit ||
            (!exitedZero && CMD_ERROR_OUTPUT_REGEX.test(cmdOutput));

          if (isCmdError) {
            const isSearchOrDiff =
              /^\s*(?:rg|grep|git\s+diff)\b/i.test(cmdLine) || /\|\s*(?:rg|grep)\b/i.test(cmdLine);
            const isExitCode1 =
              tc.exit_code === 1 ||
              matchedOutputStep?.exit_code === 1 ||
              /Command exited with code 1\b/i.test(cmdOutput) ||
              (tc.exit_code === undefined &&
                matchedOutputStep?.exit_code === undefined &&
                !/Command exited with code (?:[2-9]|\d{2,})\b/i.test(cmdOutput));
            if (isSearchOrDiff && isExitCode1 && !CMD_FATAL_SEARCH_ERROR_REGEX.test(cmdOutput)) {
              isCmdError = false;
            }
          }

          const isCmdSuccess =
            !isCmdError &&
            (tc.status === 'COMPLETED' ||
              nextStepStatus === 'DONE' ||
              nextStepStatus === 'COMPLETED' ||
              exitedZero ||
              cmdOutput.length > 0);

          if (isCmdError) {
            hadCommandErrorSinceLastPropose = true;
            hasUnrecoveredCmdError = true;
          } else if (isCmdSuccess) {
            hasUnrecoveredCmdError = false;
            if (hadCommandErrorSinceLastPropose) {
              hasCommandErrorRecovery = true;
              latestErrorRecoveryStepIndex = idx;
            }
          }

          if (DELIVERABLE_CMD_REGEX.test(cmdLine)) {
            deliverableRunCountSinceLastPropose++;
          }
        }
      }
    }
  }

  return {
    latestStepIndex,
    latestUserContent,
    latestUserStepIndex,
    userInputHadPriorModelStep,
    lastCorrectionInTranscriptStep,
    editCountSinceLastPropose,
    codeReadCountSinceLastPropose,
    scratchScriptCountSinceLastPropose,
    deliverableRunCountSinceLastPropose,
    hadCommandErrorSinceLastPropose,
    hasUnrecoveredCmdError,
    hasCommandErrorRecovery,
    latestErrorRecoveryStepIndex,
    latestAuditStepIndex,
    editsAfterPropose,
    latestDirtyEditStepIndex,
    lastProposeId,
    lastProposeStepIndex,
    lastProposeStepCreatedAtMs,
    seenPropose,
    toolWorkStepsAfterUserCorrection,
    newTailAnchors: newTailAnchors.slice(-64),
    maxSyntheticIdx,
  };
}

function applyObservedUserTurnReplacement(convState, analysis) {
  let dirty = false;
  let clearedInterruptedCorrection = false;
  if (
    analysis.latestUserStepIndex >= 0 &&
    analysis.latestUserStepIndex > (convState.lastObservedUserStep ?? -1)
  ) {
    const prevObservedStep = convState.lastObservedUserStep ?? -1;
    convState.lastObservedUserStep = analysis.latestUserStepIndex;
    dirty = true;
    if (!CORRECTION_REGEX.test(analysis.latestUserContent)) {
      const maxCorr = Math.max(
        convState.lastCorrectionStep ?? -1,
        analysis.lastCorrectionInTranscriptStep
      );
      if (maxCorr > (convState.clearedCorrectionStep ?? -1)) {
        convState.clearedCorrectionStep = maxCorr;
      }
      if (maxCorr > (convState.clearedTelemetryCorrectionStep ?? -1)) {
        convState.clearedTelemetryCorrectionStep = maxCorr;
        clearedInterruptedCorrection = true;
      } else if (prevObservedStep >= 0 && maxCorr >= 0) {
        clearedInterruptedCorrection = true;
      }
    }
  }
  return { dirty, clearedInterruptedCorrection };
}

function applyAnchorState(convState, analysis) {
  let dirty = false;
  if (analysis.newTailAnchors.length > 0) {
    const prevJson = JSON.stringify(convState.tailAnchors || []);
    const nextJson = JSON.stringify(analysis.newTailAnchors);
    if (prevJson !== nextJson) {
      convState.tailAnchors = analysis.newTailAnchors;
      dirty = true;
    }
  }
  if (analysis.maxSyntheticIdx > (convState.maxMonotonicStep ?? -1)) {
    convState.maxMonotonicStep = analysis.maxSyntheticIdx;
    dirty = true;
  }
  return dirty;
}

function applyProposeTimestampState(convState, analysis) {
  let dirty = false;
  if (
    analysis.lastProposeStepIndex >= 0 &&
    analysis.lastProposeStepIndex > (convState.lastProposeStepForAt ?? -1)
  ) {
    convState.lastProposeStepForAt = analysis.lastProposeStepIndex;
    convState.lastProposeAtMs =
      analysis.lastProposeStepCreatedAtMs > 0 ? analysis.lastProposeStepCreatedAtMs : Date.now();
    dirty = true;
  }
  return dirty;
}

async function main() {
  if (
    process.argv.includes('--help') ||
    process.argv.includes('-h') ||
    process.argv[2] === 'help' ||
    process.argv[2] === '--help' ||
    process.argv[2] === '-h'
  ) {
    process.stdout.write(`Usage: node scripts/antigravity_hook.mjs [PreInvocation|Stop] [options]

Antigravity native hook handler for EvoKernel evolution reminder injection and session stop handling.

Options:
  -h, --help  Show this help message
`);
    return;
  }
  const event = process.argv[2] || 'PreInvocation';
  const input = await readStdinJson();
  const explicitConversationId = String(input.conversationId || input.conversation_id || '').trim();
  const conversationId = explicitConversationId || 'default';
  const userHash =
    typeof process.getuid === 'function'
      ? String(process.getuid())
      : crypto.createHash('sha1').update(os.homedir()).digest('hex').slice(0, 8);
  const convHash = crypto.createHash('sha1').update(conversationId).digest('hex').slice(0, 8);
  const statePath = process.env.EVO_AGY_HOOK_STATE_PATH
    ? path.resolve(process.env.EVO_AGY_HOOK_STATE_PATH)
    : path.join(os.tmpdir(), `evo-agy-hook-state-${userHash}-${convHash}.json`);

  const transcriptPath = String(input.transcriptPath || input.transcript_path || '');
  const steps = readTranscriptTailSteps(transcriptPath);

  if (event === 'Stop') {
    const allState = loadHookState(statePath);
    const hasExistingState = Boolean(allState[conversationId]);
    const cs = { ...createDefaultConvState(), ...(allState[conversationId] || {}) };
    const resolvedDbs = resolveTelemetryDbsForStop(input, steps);

    let analysis = null;
    let hadTurnCorrection = (cs.lastCorrectionStep ?? -1) > (cs.clearedTelemetryCorrectionStep ?? -1);
    let effectiveTelemetryCorrStep = cs.lastCorrectionStep ?? -1;

    if (steps.length > 0) {
      analysis = analyzeTranscriptSteps(steps, cs);
      applyAnchorState(cs, analysis);
      const turnRepl = applyObservedUserTurnReplacement(cs, analysis);
      applyProposeTimestampState(cs, analysis);

      const transcriptCorrActive =
        analysis.lastCorrectionInTranscriptStep >= 0 &&
        analysis.lastCorrectionInTranscriptStep === analysis.latestUserStepIndex;
      effectiveTelemetryCorrStep = Math.max(
        cs.lastCorrectionStep ?? -1,
        transcriptCorrActive ? analysis.lastCorrectionInTranscriptStep : -1
      );
      hadTurnCorrection = effectiveTelemetryCorrStep > (cs.clearedTelemetryCorrectionStep ?? -1);

      const hadCommandErrorValue = analysis.hasUnrecoveredCmdError
        ? 'true'
        : analysis.lastProposeStepIndex >= 0 || analysis.hasCommandErrorRecovery
          ? 'false'
          : null;
      const unproposedEditCountValue =
        analysis.editCountSinceLastPropose > 0
          ? String(analysis.editCountSinceLastPropose)
          : analysis.lastProposeStepIndex >= 0
            ? '0'
            : null;
      const needsEpochSync =
        Boolean(explicitConversationId) && cs.syncedEpoch !== explicitConversationId;

      const syncRes = syncSessionStateToTelemetryDb(resolvedDbs.localDbPath, {
        setUserCorrectionTrue: hadTurnCorrection,
        clearUserCorrection: turnRepl.clearedInterruptedCorrection && !hadTurnCorrection,
        hasProposeAfterCorrection:
          hadTurnCorrection &&
          analysis.lastProposeStepIndex >= 0 &&
          analysis.lastProposeStepIndex > effectiveTelemetryCorrStep,
        hadCommandErrorValue,
        unproposedEditCountValue,
        sessionEpoch: needsEpochSync ? explicitConversationId : undefined,
      });
      if (needsEpochSync && syncRes.synced) {
        cs.syncedEpoch = explicitConversationId;
      }
      if (syncRes.alreadySettledByPropose) {
        hadTurnCorrection = false;
      }
    }

    const isPartitionedByPropose =
      hadTurnCorrection &&
      analysis !== null &&
      analysis.lastProposeStepIndex >= 0 &&
      analysis.lastProposeStepIndex > effectiveTelemetryCorrStep;
    const proposeCutoffMs = isPartitionedByPropose
      ? analysis.lastProposeStepCreatedAtMs > 0
        ? analysis.lastProposeStepCreatedAtMs
        : cs.lastProposeAtMs > 0
          ? cs.lastProposeAtMs
          : Date.now()
      : 0;

    closeRecalledTelemetryOnStop(input, hadTurnCorrection, resolvedDbs, {
      isPartitioned: isPartitionedByPropose,
      proposeCutoffMs,
    });

    if (hasExistingState || steps.length > 0) {
      const maxCorrToClear = Math.max(
        cs.lastCorrectionStep ?? -1,
        analysis ? analysis.lastCorrectionInTranscriptStep : -1
      );
      cs.clearedCorrectionStep = Math.max(cs.clearedCorrectionStep ?? -1, maxCorrToClear);
      cs.clearedTelemetryCorrectionStep = Math.max(
        cs.clearedTelemetryCorrectionStep ?? -1,
        maxCorrToClear
      );
      cs.clearedDirtyEditStep = cs.lastDirtyEditStep ?? -1;
      cs.clearedErrorRecoveryStep = cs.lastErrorRecoveryStep ?? -1;
      cs.clearedAuditStep = cs.lastAuditStep ?? -1;
      allState[conversationId] = cs;
      saveHookState(statePath, allState, conversationId, cs);
    }

    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
    return;
  }

  if (steps.length === 0) {
    if (explicitConversationId) {
      const allState = loadHookState(statePath);
      const convState = { ...createDefaultConvState(), ...(allState[conversationId] || {}) };
      if (convState.syncedEpoch !== explicitConversationId) {
        const resolvedDbs = resolveTelemetryDbsForStop(input, []);
        if (resolvedDbs.localDbPath && fs.existsSync(resolvedDbs.localDbPath)) {
          const syncRes = syncSessionStateToTelemetryDb(resolvedDbs.localDbPath, {
            setUserCorrectionTrue: false,
            clearUserCorrection: false,
            hasProposeAfterCorrection: false,
            hadCommandErrorValue: null,
            unproposedEditCountValue: null,
            sessionEpoch: explicitConversationId,
          });
          if (syncRes.synced) {
            convState.syncedEpoch = explicitConversationId;
            allState[conversationId] = convState;
            saveHookState(statePath, allState, conversationId, convState);
          }
        }
      }
    }
    process.stdout.write('{}\n');
    return;
  }

  const allState = loadHookState(statePath);
  const convState = { ...createDefaultConvState(), ...(allState[conversationId] || {}) };
  const analysis = analyzeTranscriptSteps(steps, convState);

  let stateDirty = false;
  if (applyAnchorState(convState, analysis)) stateDirty = true;
  const preTurnRepl = applyObservedUserTurnReplacement(convState, analysis);
  if (preTurnRepl.dirty) stateDirty = true;
  if (applyProposeTimestampState(convState, analysis)) stateDirty = true;

  const {
    latestStepIndex,
    latestUserContent,
    latestUserStepIndex,
    userInputHadPriorModelStep,
    editCountSinceLastPropose,
    codeReadCountSinceLastPropose,
    scratchScriptCountSinceLastPropose,
    deliverableRunCountSinceLastPropose,
    hasUnrecoveredCmdError,
    hasCommandErrorRecovery,
    latestErrorRecoveryStepIndex,
    latestAuditStepIndex,
    editsAfterPropose,
    latestDirtyEditStepIndex,
    lastProposeId,
    lastProposeStepIndex,
    seenPropose,
    toolWorkStepsAfterUserCorrection,
  } = analysis;

  if (lastProposeStepIndex >= 0) {
    if (lastProposeStepIndex > (convState.clearedCorrectionStep ?? -1)) {
      convState.clearedCorrectionStep = lastProposeStepIndex;
      stateDirty = true;
    }
    if (lastProposeStepIndex > (convState.clearedDirtyEditStep ?? -1)) {
      convState.clearedDirtyEditStep = lastProposeStepIndex;
      stateDirty = true;
    }
    if (lastProposeStepIndex > (convState.clearedErrorRecoveryStep ?? -1)) {
      convState.clearedErrorRecoveryStep = lastProposeStepIndex;
      stateDirty = true;
    }
    if (lastProposeStepIndex > (convState.clearedAuditStep ?? -1)) {
      convState.clearedAuditStep = lastProposeStepIndex;
      stateDirty = true;
    }
  }

  const isCurrentUserCorrection =
    latestUserStepIndex >= 0 &&
    userInputHadPriorModelStep &&
    CORRECTION_REGEX.test(latestUserContent) &&
    latestUserStepIndex > (convState.clearedTelemetryCorrectionStep ?? -1);
  const needsEpochSync =
    Boolean(explicitConversationId) && convState.syncedEpoch !== explicitConversationId;
  if (
    isCurrentUserCorrection ||
    preTurnRepl.clearedInterruptedCorrection ||
    hasUnrecoveredCmdError ||
    lastProposeStepIndex >= 0 ||
    editCountSinceLastPropose > 0 ||
    needsEpochSync
  ) {
    const resolvedDbs = resolveTelemetryDbsForStop(input, steps);
    const hadCommandErrorValue = hasUnrecoveredCmdError
      ? 'true'
      : lastProposeStepIndex >= 0 || hasCommandErrorRecovery
        ? 'false'
        : null;
    const unproposedEditCountValue =
      editCountSinceLastPropose > 0
        ? String(editCountSinceLastPropose)
        : lastProposeStepIndex >= 0
          ? '0'
          : null;
    const syncRes = syncSessionStateToTelemetryDb(resolvedDbs.localDbPath, {
      setUserCorrectionTrue: isCurrentUserCorrection,
      clearUserCorrection: preTurnRepl.clearedInterruptedCorrection && !isCurrentUserCorrection,
      hasProposeAfterCorrection:
        isCurrentUserCorrection && lastProposeStepIndex > latestUserStepIndex,
      hadCommandErrorValue,
      unproposedEditCountValue,
      sessionEpoch: needsEpochSync ? explicitConversationId : undefined,
    });
    if (needsEpochSync && syncRes.synced) {
      convState.syncedEpoch = explicitConversationId;
      stateDirty = true;
    }
    if (syncRes.alreadySettledByPropose && latestUserStepIndex > (convState.clearedTelemetryCorrectionStep ?? -1)) {
      convState.clearedTelemetryCorrectionStep = latestUserStepIndex;
      stateDirty = true;
    }
  }

  const persistIfDirty = () => {
    if (stateDirty) {
      allState[conversationId] = convState;
      saveHookState(statePath, allState, conversationId, convState);
    }
  };

  if (latestStepIndex <= (convState.lastRemindedStep ?? -999)) {
    persistIfDirty();
    process.stdout.write('{}\n');
    return;
  }

  const persistedPendingCorrectionStep =
    (convState.lastCorrectionStep ?? -1) > (convState.clearedCorrectionStep ?? -1)
      ? (convState.lastCorrectionStep ?? -1)
      : -1;
  const persistedPendingAuditStep =
    (convState.lastAuditStep ?? -1) > (convState.clearedAuditStep ?? -1)
      ? (convState.lastAuditStep ?? -1)
      : -1;

  const effectiveCorrectionStep =
    latestUserStepIndex >= 0 ? latestUserStepIndex : persistedPendingCorrectionStep;
  const effectiveAuditStep =
    latestAuditStepIndex >= 0 ? latestAuditStepIndex : persistedPendingAuditStep;

  const hasUserCorrection =
    latestUserStepIndex >= 0
      ? userInputHadPriorModelStep &&
        latestUserStepIndex > lastProposeStepIndex &&
        latestUserStepIndex > (convState.clearedCorrectionStep ?? -1) &&
        CORRECTION_REGEX.test(latestUserContent)
      : persistedPendingCorrectionStep >= 0 &&
        persistedPendingCorrectionStep > lastProposeStepIndex;

  const hasHeavyUnproposeEdits =
    editCountSinceLastPropose >= 4 ||
    scratchScriptCountSinceLastPropose >= 2 ||
    (scratchScriptCountSinceLastPropose >= 1 && deliverableRunCountSinceLastPropose >= 1);
  const hasHeavyDiagnosticReads =
    editCountSinceLastPropose < 4 && codeReadCountSinceLastPropose >= 10;
  const hasDirtyPostProposeEdits = seenPropose && editsAfterPropose > 0;
  const hasSubagentAudit =
    effectiveAuditStep >= 0 &&
    effectiveAuditStep > lastProposeStepIndex &&
    effectiveAuditStep > (convState.clearedAuditStep ?? -1);

  if (
    !hasUserCorrection &&
    !hasHeavyUnproposeEdits &&
    !hasHeavyDiagnosticReads &&
    !hasDirtyPostProposeEdits &&
    !hasCommandErrorRecovery &&
    !hasSubagentAudit
  ) {
    persistIfDirty();
    process.stdout.write('{}\n');
    return;
  }

  const isNewCorrection =
    hasUserCorrection && effectiveCorrectionStep > (convState.lastCorrectionStep ?? -1);
  const isPendingCorrectionAfterWork =
    hasUserCorrection &&
    effectiveCorrectionStep === (convState.lastCorrectionStep ?? -1) &&
    toolWorkStepsAfterUserCorrection > 0;
  const isNewDirtyEdit =
    hasDirtyPostProposeEdits &&
    latestDirtyEditStepIndex > (convState.lastDirtyEditStep ?? -1);
  const isPendingDirtyEdit =
    hasDirtyPostProposeEdits &&
    latestDirtyEditStepIndex > (convState.clearedDirtyEditStep ?? -1);
  const isNewErrorRecovery =
    hasCommandErrorRecovery &&
    latestErrorRecoveryStepIndex > (convState.lastErrorRecoveryStep ?? -1);
  const isPendingErrorRecovery =
    hasCommandErrorRecovery &&
    latestErrorRecoveryStepIndex > (convState.clearedErrorRecoveryStep ?? -1);
  const isNewAudit =
    hasSubagentAudit &&
    effectiveAuditStep > (convState.lastAuditStep ?? -1);
  const isPendingAudit =
    hasSubagentAudit &&
    effectiveAuditStep > (convState.clearedAuditStep ?? -1);
  const cooldownExpired =
    latestStepIndex - (convState.lastRemindedStep ?? -999) >= COOLDOWN_STEPS;

  const hasImmediateNewTrigger =
    isNewCorrection || isNewDirtyEdit || isNewErrorRecovery || isNewAudit;
  const hasCooldownPendingTrigger =
    cooldownExpired &&
    (isPendingCorrectionAfterWork ||
      isPendingDirtyEdit ||
      isPendingErrorRecovery ||
      isPendingAudit ||
      hasHeavyUnproposeEdits ||
      hasHeavyDiagnosticReads);

  if (!hasImmediateNewTrigger && !hasCooldownPendingTrigger) {
    persistIfDirty();
    process.stdout.write('{}\n');
    return;
  }

  allState[conversationId] = {
    ...convState,
    lastRemindedStep: latestStepIndex,
    lastCorrectionStep: hasUserCorrection
      ? effectiveCorrectionStep
      : (convState.lastCorrectionStep ?? -1),
    clearedCorrectionStep:
      lastProposeStepIndex >= 0
        ? Math.max(convState.clearedCorrectionStep ?? -1, lastProposeStepIndex)
        : (convState.clearedCorrectionStep ?? -1),
    lastDirtyEditStep: hasDirtyPostProposeEdits
      ? latestDirtyEditStepIndex
      : (convState.lastDirtyEditStep ?? -1),
    clearedDirtyEditStep:
      lastProposeStepIndex >= 0
        ? Math.max(convState.clearedDirtyEditStep ?? -1, lastProposeStepIndex)
        : (convState.clearedDirtyEditStep ?? -1),
    lastErrorRecoveryStep: hasCommandErrorRecovery
      ? latestErrorRecoveryStepIndex
      : (convState.lastErrorRecoveryStep ?? -1),
    clearedErrorRecoveryStep:
      lastProposeStepIndex >= 0
        ? Math.max(convState.clearedErrorRecoveryStep ?? -1, lastProposeStepIndex)
        : (convState.clearedErrorRecoveryStep ?? -1),
    lastAuditStep: hasSubagentAudit
      ? effectiveAuditStep
      : (convState.lastAuditStep ?? -1),
    clearedAuditStep:
      lastProposeStepIndex >= 0
        ? Math.max(convState.clearedAuditStep ?? -1, lastProposeStepIndex)
        : (convState.clearedAuditStep ?? -1),
  };
  saveHookState(statePath, allState, conversationId, allState[conversationId]);

  const reasons = [];
  if (isPendingDirtyEdit) {
    reasons.push(
      `在结晶 '${lastProposeId}' 后又发生了 ${editsAfterPropose} 次源码修改（防脏规则投毒校验）`
    );
  }
  if (isNewCorrection || isPendingCorrectionAfterWork) {
    reasons.push('检测到用户纠偏/交付物反馈信号');
  }
  if (isNewAudit || isPendingAudit) {
    reasons.push('检测到子智能体（Subagent）专项核查/取证完成唤醒信号');
  }
  if (isPendingErrorRecovery) {
    reasons.push('检测到命令/脚本执行报错并恢复成功（排障经验待结晶）');
  }
  if (scratchScriptCountSinceLastPropose > 0) {
    reasons.push(`已编写 ${scratchScriptCountSinceLastPropose} 个临时分析/交付物生成脚本尚未结晶`);
  }
  if (
    editCountSinceLastPropose >= 4 &&
    (cooldownExpired || isNewCorrection || isPendingCorrectionAfterWork || isPendingDirtyEdit)
  ) {
    reasons.push(`已累计 ${editCountSinceLastPropose} 次文件修改尚未结晶`);
  }
  if (
    hasHeavyDiagnosticReads &&
    (cooldownExpired || isNewCorrection || isPendingCorrectionAfterWork || isNewAudit || isPendingAudit)
  ) {
    reasons.push(
      `已累计深度精读/图谱检索 ${codeReadCountSinceLastPropose} 次源码尚未结晶（只读根因诊断或假说证伪亦须沉淀）`
    );
  }

  const isStylePreferenceCue =
    (isNewCorrection || isPendingCorrectionAfterWork) &&
    STYLE_PREFERENCE_REGEX.test(latestUserContent);
  const preferenceCue = isStylePreferenceCue
    ? '；若涉及跨项目通用的个人表达/排版/格式偏好，请调用 evo_propose(kind: "preference", scope: "global") 沉淀至全局 Profile Card'
    : '';

  const ephemeralMessage = `[EvoKernel 自演进提醒] ${reasons.join('；')}。在完成本轮根因诊断确认（含零代码修改的只读白盒排查）、假说证伪纠偏、代码修复或交付物验证后，请调用 evo_propose（显式传入当前 workspace 绝对路径）沉淀或更新经验（方法论/交付物规范纠偏请用 supersedes_id 升级 rule/skill，多变量修改缺乏因果隔离时使用 memory 或提供 contrastive_evidence，通用脚本沉淀为 tool，单点故障使用 memory${preferenceCue}），并在回复末尾输出 🧬 EvoKernel Evolution Receipt: [<kind>] <id> (<summary>)。`;

  const stepPayload =
    process.env.EVO_HOOK_STEP_FORMAT === 'systemMessage'
      ? { systemMessage: { systemMessage: ephemeralMessage } }
      : { ephemeralMessage };

  process.stdout.write(
    JSON.stringify({
      injectSteps: [stepPayload],
    }) + '\n'
  );
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(import.meta.filename).toLowerCase();

if (isDirectRun) {
  main().catch(() => {
    process.stdout.write('{}\n');
    process.exit(0);
  });
}
