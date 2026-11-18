import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  EvoMemory,
  MemoryVerificationReport,
  SymbolDriftCheck,
  SymbolFingerprint,
  TopologyAnchor,
} from '../types.js';
import { EvoStorage } from '../storage.js';
import { EvoTelemetry } from '../telemetry.js';
import type { GitHeadSnapshot } from './git-utils.js';
import {
  PARSER_VERSION,
  SOURCE_EXTENSIONS,
  clearGitPathsCache,
  discoverDescendantBranchRefs,
  discoverDescendantBranchRefsAsync,
  isGitAncestorOfHead,
  isGitAncestorOfHeadAsync,
  isGitCommitPresent,
  isGitCommitPresentAsync,
  isRealSubpathOf,
  readGitHeadSnapshot,
  readGitHeadSnapshotAsync,
  resolveCommitBranchLabel,
  resolveCommitBranchLabelAsync,
  resolveCurrentGitBranch,
  resolveCurrentGitCommit,
  resolveGitBranchCommit,
  resolveGitBranchCommitAsync,
  spawnGitAsync,
} from './git-utils.js';
import {
  computeAstHash,
  computeAstHashV1,
  computeStructuralSkeletonHash,
} from './lexical-mask.js';
import {
  BARREL_EXTENSIONS,
  BARREL_INDEX_EXTENSIONS,
  BARREL_JS_EXTENSIONS,
  CONTROL_KEYWORDS,
  collectWorkspaceSourceFiles,
  escapeRegExp,
  extractRelativeBarrelSpecifiers,
  extractSymbolBlockFromLines,
  extractSymbolFingerprint,
  extractSymbolFingerprintAsync,
  findBraceBlockEndV1,
  findPythonBlockEnd,
  findSymbolDeclarationInLines,
  parseSymbolTarget,
} from './symbol-extractor.js';

function collectCallersFromContent(
  raw: string,
  rel: string,
  symbolName: string,
  refRegex: RegExp,
  defFilePath: string,
  defStartLine: number,
  defEndLine: number,
  callers: string[],
  maxCallers: number
): void {
  if (!raw.includes(symbolName)) return;
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (callers.length >= maxCallers) break;
    const lineNo = i + 1;
    if (rel === defFilePath && lineNo >= defStartLine && lineNo <= defEndLine) {
      continue;
    }
    const trimmed = lines[i].trim();
    if (
      !trimmed ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('#') ||
      /^import\s+/.test(trimmed) ||
      /^export\s+.*from\s+/.test(trimmed) ||
      /^extern\s+.*;$/.test(trimmed)
    ) {
      continue;
    }
    if (refRegex.test(trimmed)) {
      const callerEntry = `${rel}:${lineNo}`;
      if (!callers.includes(callerEntry)) {
        callers.push(callerEntry);
      }
    }
  }
}

export function findSymbolCallers(
  workspaceRoot: string,
  rawSpec: string,
  defFilePath: string,
  defStartLine: number,
  defEndLine: number,
  maxCallers = 5
): string[] {
  const root = path.resolve(workspaceRoot);
  const parsed = parseSymbolTarget(rawSpec);
  if (parsed.isWholeFile || !parsed.symbolName || parsed.symbolName.length < 2) {
    return [];
  }

  const esc = escapeRegExp(parsed.symbolName);
  const refRegex = new RegExp(`\\b${esc}\\b`);
  const callers: string[] = [];

  const files = collectWorkspaceSourceFiles(root, 2500);
  for (const filePath of files) {
    if (callers.length >= maxCallers) break;
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    collectCallersFromContent(
      raw,
      rel,
      parsed.symbolName,
      refRegex,
      defFilePath,
      defStartLine,
      defEndLine,
      callers,
      maxCallers
    );
  }

  return callers;
}

export async function findSymbolCallersAsync(
  workspaceRoot: string,
  rawSpec: string,
  defFilePath: string,
  defStartLine: number,
  defEndLine: number,
  maxCallers = 5
): Promise<string[]> {
  const root = path.resolve(workspaceRoot);
  const parsed = parseSymbolTarget(rawSpec);
  if (parsed.isWholeFile || !parsed.symbolName || parsed.symbolName.length < 2) {
    return [];
  }

  const esc = escapeRegExp(parsed.symbolName);
  const refRegex = new RegExp(`\\b${esc}\\b`);
  const callers: string[] = [];

  const files = collectWorkspaceSourceFiles(root, 2500);
  for (const filePath of files) {
    if (callers.length >= maxCallers) break;
    let raw: string;
    try {
      raw = await fs.promises.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    collectCallersFromContent(
      raw,
      rel,
      parsed.symbolName,
      refRegex,
      defFilePath,
      defStartLine,
      defEndLine,
      callers,
      maxCallers
    );
  }

  return callers;
}

function collectCommitCandidateRelFiles(
  workspaceRoot: string,
  rawSpec: string,
  recordedFp?: SymbolFingerprint
): {
  parsed: ReturnType<typeof parseSymbolTarget>;
  candidateRelFiles: string[];
  seenFiles: Set<string>;
} {
  const parsed = parseSymbolTarget(rawSpec);
  const candidateRelFiles: string[] = [];
  const seenFiles = new Set<string>();

  const addCandidate = (rel?: string) => {
    if (!rel || rel === '(unrecorded)') return;
    let normalizedInput = rel.trim();
    if (path.isAbsolute(normalizedInput) || /^[A-Za-z]:[/\\]/.test(normalizedInput)) {
      const relFromWs = path.relative(workspaceRoot, normalizedInput);
      if (!relFromWs || relFromWs.startsWith('..') || path.isAbsolute(relFromWs)) {
        return;
      }
      normalizedInput = relFromWs;
    }
    const clean = normalizedInput.replace(/^[/\\]+/, '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
    if (clean && !seenFiles.has(clean)) {
      seenFiles.add(clean);
      candidateRelFiles.push(clean);
    }
  };

  addCandidate(parsed.fileHint);
  addCandidate(recordedFp?.file_path);

  return { parsed, candidateRelFiles, seenFiles };
}

function extractFingerprintFromCommitFileContent(
  rawSpec: string,
  cleanRel: string,
  rawContent: string,
  parsed: ReturnType<typeof parseSymbolTarget>,
  isV1: boolean
): SymbolFingerprint | null {
  const ext = path.extname(cleanRel).toLowerCase();
  if (parsed.isWholeFile) {
    const lines = rawContent.split(/\r?\n/);
    return {
      symbol: rawSpec,
      file_path: cleanRel,
      kind: 'file',
      start_line: 1,
      end_line: lines.length,
      signature: `file ${cleanRel} (${lines.length} lines)`,
      ast_hash: isV1 ? computeAstHashV1(rawContent, ext) : computeAstHash(rawContent, ext),
    };
  }

  if (!rawContent.includes(parsed.symbolName)) return null;
  const lines = rawContent.split(/\r?\n/);

  if (isV1) {
    const decl = findSymbolDeclarationInLines(lines, parsed.symbolName, parsed.classHint);
    if (!decl) return null;
    const endIdx =
      ext === '.py'
        ? findPythonBlockEnd(lines, decl.lineIndex)
        : findBraceBlockEndV1(lines, decl.lineIndex);
    const blockCode = lines.slice(decl.lineIndex, endIdx + 1).join('\n');
    return {
      symbol: rawSpec,
      file_path: cleanRel,
      kind: decl.kind,
      start_line: decl.lineIndex + 1,
      end_line: endIdx + 1,
      signature: decl.signature,
      ast_hash: computeAstHashV1(blockCode, ext),
    };
  }

  const extracted = extractSymbolBlockFromLines(lines, parsed.symbolName, parsed.classHint, ext);
  if (!extracted) return null;

  return {
    symbol: rawSpec,
    file_path: cleanRel,
    kind: extracted.kind,
    start_line: extracted.start_line,
    end_line: extracted.end_line,
    signature: extracted.signature,
    ast_hash: computeAstHash(extracted.blockCode, ext),
  };
}

function selectCommitTreeFallbackGroups(
  treeStdout: string,
  seenFiles: Set<string>,
  parsed: ReturnType<typeof parseSymbolTarget>,
  recordedFp?: SymbolFingerprint
): { hintMatchedFiles: string[]; fallbackSourceFiles: string[] } {
  const normHints = [parsed.fileHint, recordedFp?.file_path]
    .filter((h): h is string => Boolean(h && h !== '(unrecorded)'))
    .map((h) => h.replace(/^[/\\]+/, '').replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase());

  const allSourceTreeFiles = treeStdout
    .split(/\r?\n/)
    .map((f) => f.trim().replace(/\\/g, '/').replace(/^\.\/+/, ''))
    .filter((f) => {
      if (!f || seenFiles.has(f)) return false;
      const ext = path.extname(f).toLowerCase();
      return SOURCE_EXTENSIONS.has(ext);
    });

  const hintMatchedFiles =
    normHints.length > 0
      ? allSourceTreeFiles.filter((f) => {
          const lower = f.toLowerCase();
          return normHints.some((nh) => lower === nh || lower.endsWith(`/${nh}`));
        })
      : [];

  return {
    hintMatchedFiles,
    fallbackSourceFiles: parsed.isWholeFile ? [] : allSourceTreeFiles.slice(0, 60),
  };
}

function buildCommitBarrelCandidateGroups(
  cleanRel: string,
  rawContent: string,
  seenFiles: Set<string>
): string[][] {
  const ext = path.extname(cleanRel).toLowerCase();
  const specs = extractRelativeBarrelSpecifiers(rawContent, ext);
  if (specs.length === 0) return [];

  const dirPosix = path.posix.dirname(cleanRel);
  const groups: string[][] = [];

  for (const spec of specs) {
    const joined = dirPosix === '.' ? spec : `${dirPosix}/${spec}`;
    const norm = path.posix.normalize(joined).replace(/^\.\/+/, '');
    if (!norm || norm === '..' || norm.startsWith('../') || norm.startsWith('/')) continue;

    const specExt = path.posix.extname(spec).toLowerCase();
    const candidates: string[] = [];
    if (BARREL_JS_EXTENSIONS.has(specExt)) {
      const stem = norm.slice(0, -specExt.length);
      for (const e of BARREL_EXTENSIONS) {
        const c = stem + e;
        if (!seenFiles.has(c)) candidates.push(c);
      }
    } else if (!specExt) {
      for (const e of BARREL_EXTENSIONS) {
        const c = norm + e;
        if (!seenFiles.has(c)) candidates.push(c);
      }
      for (const idxExt of BARREL_INDEX_EXTENSIONS) {
        const c = `${norm}/index${idxExt}`;
        if (!seenFiles.has(c)) candidates.push(c);
      }
    } else if (!seenFiles.has(norm)) {
      candidates.push(norm);
    }

    if (candidates.length > 0) {
      for (const c of candidates) seenFiles.add(c);
      groups.push(candidates);
    }
  }
  return groups;
}

export function extractSymbolFingerprintAtCommit(
  workspaceRoot: string,
  commitSha: string,
  rawSpec: string,
  recordedFp?: SymbolFingerprint
): SymbolFingerprint | null {
  const { parsed, candidateRelFiles, seenFiles } = collectCommitCandidateRelFiles(
    workspaceRoot,
    rawSpec,
    recordedFp
  );

  const missedGitFiles: Array<{ cleanRel: string; rawContent: string }> = [];
  const tryExtractFromGitFiles = (
    relFiles: string[],
    collectMissed = false
  ): SymbolFingerprint | null => {
    for (const relFile of relFiles) {
      const cleanRel = relFile.replace(/\\/g, '/').replace(/^\.\/+/, '');
      let rawContent = '';
      try {
        const res = spawnSync('git', ['show', `${commitSha.trim()}:./${cleanRel}`], {
          cwd: workspaceRoot,
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 4 * 1024 * 1024,
        });
        if (res.status !== 0 || typeof res.stdout !== 'string') continue;
        rawContent = res.stdout;
      } catch {
        continue;
      }

      const fp = extractFingerprintFromCommitFileContent(rawSpec, cleanRel, rawContent, parsed, false);
      if (fp) return fp;
      if (collectMissed && !parsed.isWholeFile) {
        missedGitFiles.push({ cleanRel, rawContent });
      }
    }
    return null;
  };

  if (candidateRelFiles.length > 0) {
    const directHit = tryExtractFromGitFiles(candidateRelFiles, true);
    if (directHit) return directHit;

    // Follow depth-1 relative barrel re-exports in commitSha before falling back to ls-tree
    for (const missed of missedGitFiles) {
      const groups = buildCommitBarrelCandidateGroups(missed.cleanRel, missed.rawContent, seenFiles);
      for (const group of groups) {
        for (const candRel of group) {
          let rawContent = '';
          try {
            const res = spawnSync('git', ['show', `${commitSha.trim()}:./${candRel}`], {
              cwd: workspaceRoot,
              encoding: 'utf8',
              timeout: 2000,
              maxBuffer: 4 * 1024 * 1024,
            });
            if (res.status !== 0 || typeof res.stdout !== 'string') continue;
            rawContent = res.stdout;
          } catch {
            continue;
          }
          const fp = extractFingerprintFromCommitFileContent(rawSpec, candRel, rawContent, parsed, false);
          if (fp) return fp;
          break;
        }
      }
    }
  }

  // Fallback: list files in commitSha tree (relative to cwd) to recover from NTFS/APFS case drift, suffix hints, or relocations
  try {
    const treeRes = spawnSync('git', ['ls-tree', '-r', '--name-only', commitSha.trim(), './'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 2000,
    });
    if (treeRes.status === 0 && treeRes.stdout) {
      const { hintMatchedFiles, fallbackSourceFiles } = selectCommitTreeFallbackGroups(
        treeRes.stdout,
        seenFiles,
        parsed,
        recordedFp
      );
      if (hintMatchedFiles.length > 0) {
        const caseRecoveredHit = tryExtractFromGitFiles(hintMatchedFiles);
        if (caseRecoveredHit) return caseRecoveredHit;
      }
      if (fallbackSourceFiles.length > 0) {
        return tryExtractFromGitFiles(fallbackSourceFiles);
      }
    }
  } catch {
    // ignore ls-tree fallback errors
  }

  return null;
}

export async function extractSymbolFingerprintAtCommitAsync(
  workspaceRoot: string,
  commitSha: string,
  rawSpec: string,
  recordedFp?: SymbolFingerprint
): Promise<SymbolFingerprint | null> {
  const { parsed, candidateRelFiles, seenFiles } = collectCommitCandidateRelFiles(
    workspaceRoot,
    rawSpec,
    recordedFp
  );

  const missedGitFiles: Array<{ cleanRel: string; rawContent: string }> = [];
  const tryExtractFromGitFilesAsync = async (
    relFiles: string[],
    collectMissed = false
  ): Promise<SymbolFingerprint | null> => {
    for (const relFile of relFiles) {
      const cleanRel = relFile.replace(/\\/g, '/').replace(/^\.\/+/, '');
      const res = await spawnGitAsync(
        workspaceRoot,
        ['show', `${commitSha.trim()}:./${cleanRel}`],
        2000
      );
      if (res.status !== 0 || typeof res.stdout !== 'string') continue;

      const fp = extractFingerprintFromCommitFileContent(rawSpec, cleanRel, res.stdout, parsed, false);
      if (fp) return fp;
      if (collectMissed && !parsed.isWholeFile) {
        missedGitFiles.push({ cleanRel, rawContent: res.stdout });
      }
    }
    return null;
  };

  if (candidateRelFiles.length > 0) {
    const directHit = await tryExtractFromGitFilesAsync(candidateRelFiles, true);
    if (directHit) return directHit;

    for (const missed of missedGitFiles) {
      const groups = buildCommitBarrelCandidateGroups(missed.cleanRel, missed.rawContent, seenFiles);
      for (const group of groups) {
        for (const candRel of group) {
          const res = await spawnGitAsync(
            workspaceRoot,
            ['show', `${commitSha.trim()}:./${candRel}`],
            2000
          );
          if (res.status !== 0 || typeof res.stdout !== 'string') continue;
          const fp = extractFingerprintFromCommitFileContent(rawSpec, candRel, res.stdout, parsed, false);
          if (fp) return fp;
          break;
        }
      }
    }
  }

  const treeRes = await spawnGitAsync(
    workspaceRoot,
    ['ls-tree', '-r', '--name-only', commitSha.trim(), './'],
    2000
  );
  if (treeRes.status === 0 && treeRes.stdout) {
    const { hintMatchedFiles, fallbackSourceFiles } = selectCommitTreeFallbackGroups(
      treeRes.stdout,
      seenFiles,
      parsed,
      recordedFp
    );
    if (hintMatchedFiles.length > 0) {
      const caseRecoveredHit = await tryExtractFromGitFilesAsync(hintMatchedFiles);
      if (caseRecoveredHit) return caseRecoveredHit;
    }
    if (fallbackSourceFiles.length > 0) {
      return await tryExtractFromGitFilesAsync(fallbackSourceFiles);
    }
  }

  return null;
}

export function extractSymbolFingerprintAtCommitV1(
  workspaceRoot: string,
  commitSha: string,
  rawSpec: string,
  recordedFp?: SymbolFingerprint
): SymbolFingerprint | null {
  const { parsed, candidateRelFiles } = collectCommitCandidateRelFiles(
    workspaceRoot,
    rawSpec,
    recordedFp
  );

  for (const relFile of candidateRelFiles) {
    const cleanRel = relFile.replace(/\\/g, '/').replace(/^\.\/+/, '');
    let rawContent = '';
    try {
      const res = spawnSync('git', ['show', `${commitSha.trim()}:./${cleanRel}`], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (res.status !== 0 || typeof res.stdout !== 'string') continue;
      rawContent = res.stdout;
    } catch {
      continue;
    }

    const fp = extractFingerprintFromCommitFileContent(rawSpec, cleanRel, rawContent, parsed, true);
    if (fp) return fp;
  }

  return null;
}

async function extractSymbolFingerprintAtCommitV1Async(
  workspaceRoot: string,
  commitSha: string,
  rawSpec: string,
  recordedFp?: SymbolFingerprint
): Promise<SymbolFingerprint | null> {
  const { parsed, candidateRelFiles } = collectCommitCandidateRelFiles(
    workspaceRoot,
    rawSpec,
    recordedFp
  );

  for (const relFile of candidateRelFiles) {
    const cleanRel = relFile.replace(/\\/g, '/').replace(/^\.\/+/, '');
    const res = await spawnGitAsync(
      workspaceRoot,
      ['show', `${commitSha.trim()}:./${cleanRel}`],
      2000
    );
    if (res.status !== 0 || typeof res.stdout !== 'string') continue;

    const fp = extractFingerprintFromCommitFileContent(rawSpec, cleanRel, res.stdout, parsed, true);
    if (fp) return fp;
  }

  return null;
}

const workspaceSigCache = new Map<string, { sig: string; expiresAt: number }>();

export function getWorkspaceSourcesSig(workspaceRoot: string): string {
  const root = path.resolve(workspaceRoot);
  const now = Date.now();
  const cached = workspaceSigCache.get(root);
  if (cached && cached.expiresAt > now) {
    return cached.sig;
  }
  const files = collectWorkspaceSourceFiles(root, 2500);
  const parts: string[] = [];
  for (const f of files) {
    try {
      const s = fs.statSync(f);
      parts.push(`${path.relative(root, f)}:${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push(`${path.relative(root, f)}:missing`);
    }
  }
  const sig = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  workspaceSigCache.set(root, { sig, expiresAt: now + 500 });
  return sig;
}

async function getWorkspaceSourcesSigAsync(workspaceRoot: string): Promise<string> {
  const root = path.resolve(workspaceRoot);
  const now = Date.now();
  const cached = workspaceSigCache.get(root);
  if (cached && cached.expiresAt > now) {
    return cached.sig;
  }
  const files = collectWorkspaceSourceFiles(root, 2500);
  const parts: string[] = [];
  for (const f of files) {
    try {
      const s = await fs.promises.stat(f);
      parts.push(`${path.relative(root, f)}:${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push(`${path.relative(root, f)}:missing`);
    }
  }
  const sig = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  workspaceSigCache.set(root, { sig, expiresAt: now + 500 });
  return sig;
}

interface InProcessVerificationCacheEntry {
  parser_version: number;
  memory_file_sig: string;
  target_files_sig: string;
  workspace_sources_sig: string;
  overall_status: string;
  has_callers: boolean;
  report: MemoryVerificationReport;
}

const memoryVerificationProcessCache = new Map<string, InProcessVerificationCacheEntry>();
const fileSigCache = new Map<string, { sig: string; expiresAt: number }>();

function getFileSigFast(filePath: string): string {
  const now = Date.now();
  const cached = fileSigCache.get(filePath);
  if (cached && cached.expiresAt > now) {
    return cached.sig;
  }
  try {
    const s = fs.statSync(filePath);
    const sig = `${s.mtimeMs}:${s.size}`;
    fileSigCache.set(filePath, { sig, expiresAt: now + 500 });
    return sig;
  } catch {
    const sig = 'missing';
    fileSigCache.set(filePath, { sig, expiresAt: now + 500 });
    return sig;
  }
}

export function clearMemoryVerificationCache(): void {
  memoryVerificationProcessCache.clear();
  workspaceSigCache.clear();
  clearGitPathsCache();
  fileSigCache.clear();
}

function cloneVerificationReport(
  rep: MemoryVerificationReport,
  currentCommit: string,
  currentBranch: string | undefined,
  createdCommit: string
): MemoryVerificationReport {
  return {
    ...rep,
    current_commit: currentCommit,
    current_branch: currentBranch,
    commit_match: createdCommit === currentCommit,
    checks: rep.checks.map((c) => ({ ...c })),
    topology_anchors: rep.topology_anchors.map((a) => ({
      ...a,
      callers: [...a.callers],
    })),
  };
}

const sqliteRetrySleepBuf = new Int32Array(new SharedArrayBuffer(4));

function isSqliteBusyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; errcode?: unknown; errstr?: unknown; message?: unknown };
  if (e.errcode === 5 || e.errcode === 6) return true;
  const errstr = typeof e.errstr === 'string' ? e.errstr.toUpperCase() : '';
  if (errstr.includes('SQLITE_BUSY') || errstr.includes('SQLITE_LOCKED')) return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return (
    msg.includes('database is locked') ||
    msg.includes('database table is locked') ||
    msg.includes('sqlite_busy') ||
    msg.includes('sqlite_locked')
  );
}

function withSqliteBusyRetry<T>(fn: () => T, maxRetries = 3): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (attempt >= maxRetries || !isSqliteBusyError(err)) {
        throw err;
      }
      Atomics.wait(sqliteRetrySleepBuf, 0, 0, 25 * (attempt + 1));
    }
  }
}

function openMemoryCacheDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 3000;');
  } catch {
    // ignore pragma errors
  }
  return db;
}

interface SqliteVerificationCacheRow {
  parser_version: number;
  memory_file_sig: string;
  target_files_sig: string;
  workspace_sources_sig: string | null;
  overall_status: string;
  report_json: string;
  has_callers: number;
}

function prepareVerificationCacheContext(
  root: string,
  memory: EvoMemory,
  targetKeys: string[],
  headSnap: GitHeadSnapshot,
  hasCodeGraph: boolean,
  createdBranchHead: string
): {
  canUseCache: boolean;
  hasRecordedTargetFiles: boolean;
  memFileSig: string;
  targetFilesSig: string;
} {
  let memFileSig = '';
  let targetFilesSig = '';
  let hasRecordedTargetFiles = false;

  const memFilePath = path.join(root, '.evo', 'memories', `${memory.id}.md`);
  const mSig = getFileSigFast(memFilePath);
  if (mSig !== 'missing') {
    memFileSig = mSig;
    const targetSigs: string[] = [];
    for (const symKey of targetKeys) {
      const fp = memory.ast_fingerprints[symKey];
      if (fp && fp.file_path && fp.file_path !== '(unrecorded)') {
        const p = path.resolve(root, fp.file_path);
        targetSigs.push(
          isRealSubpathOf(root, p)
            ? `${fp.file_path}:${getFileSigFast(p)}`
            : `${fp.file_path}:outside-workspace`
        );
      }
    }
    hasRecordedTargetFiles =
      targetSigs.length > 0 &&
      targetKeys.every((k) =>
        Boolean(
          memory.ast_fingerprints?.[k]?.file_path &&
            memory.ast_fingerprints[k].file_path !== '(unrecorded)' &&
            memory.ast_fingerprints[k].ast_hash
        )
      );
    targetFilesSig = `${targetSigs.join('|')}||git:${headSnap.branch !== 'HEAD' ? headSnap.branch || '' : ''}:${headSnap.commit}:${memory.created_commit || ''}:${memory.created_branch || ''}:${createdBranchHead}:${hasCodeGraph ? '1' : '0'}`;
  }

  return {
    canUseCache: hasRecordedTargetFiles,
    hasRecordedTargetFiles,
    memFileSig,
    targetFilesSig,
  };
}

function readVerificationCacheSqliteRow(
  cacheDb: DatabaseSync,
  shouldCloseDb: boolean,
  memoryId: string
): SqliteVerificationCacheRow | undefined {
  let hasCacheTable = false;
  if (!shouldCloseDb) {
    try {
      const tblRow = withSqliteBusyRetry(() =>
        cacheDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_verification_cache'")
          .get() as { name?: string } | undefined
      );
      hasCacheTable = Boolean(tblRow?.name);
    } catch {
      hasCacheTable = false;
    }
  }
  if (shouldCloseDb || !hasCacheTable) {
    try {
      withSqliteBusyRetry(() => {
        cacheDb.exec(`
          CREATE TABLE IF NOT EXISTS memory_verification_cache (
            memory_id TEXT PRIMARY KEY,
            parser_version INTEGER NOT NULL,
            memory_file_sig TEXT NOT NULL,
            target_files_sig TEXT NOT NULL,
            workspace_sources_sig TEXT,
            overall_status TEXT NOT NULL,
            report_json TEXT NOT NULL,
            cached_at TEXT NOT NULL,
            has_callers INTEGER NOT NULL DEFAULT 0
          );
        `);
      });
      try {
        withSqliteBusyRetry(() => {
          cacheDb.exec('ALTER TABLE memory_verification_cache ADD COLUMN has_callers INTEGER NOT NULL DEFAULT 0');
        });
      } catch {
        // Ignore existing column or read-only DB
      }
      hasCacheTable = true;
    } catch {
      // Ignore DDL errors on read-only DB
      if (!shouldCloseDb) {
        try {
          const tblRow = withSqliteBusyRetry(() =>
            cacheDb
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_verification_cache'")
              .get() as { name?: string } | undefined
          );
          hasCacheTable = Boolean(tblRow?.name);
        } catch {
          hasCacheTable = false;
        }
      } else {
        hasCacheTable = true;
      }
    }
  }

  if (!hasCacheTable) return undefined;

  return withSqliteBusyRetry(() =>
    cacheDb.prepare(`
      SELECT parser_version, memory_file_sig, target_files_sig, workspace_sources_sig, overall_status, report_json, has_callers
      FROM memory_verification_cache
      WHERE memory_id = ?
    `).get(memoryId) as SqliteVerificationCacheRow | undefined
  );
}

function updateCachedCallersInSqlite(
  db: DatabaseSync,
  memoryId: string,
  report: MemoryVerificationReport,
  wsSig: string
): void {
  try {
    withSqliteBusyRetry(() => {
      db.prepare(`
        UPDATE memory_verification_cache
        SET report_json = ?, workspace_sources_sig = ?, has_callers = 1, cached_at = ?
        WHERE memory_id = ?
      `).run(JSON.stringify(report), wsSig, new Date().toISOString(), memoryId);
    });
  } catch {
    // ignore cache update error
  }
}

function persistVerificationReportToCache(
  procKey: string,
  memoryId: string,
  canUseCache: boolean,
  memFileSig: string,
  targetFilesSig: string,
  wsSig: string,
  overallStatus: 'VERIFIED' | 'OTHER_BRANCH' | 'STALE',
  includeCallers: boolean,
  report: MemoryVerificationReport,
  cacheDb: DatabaseSync | null,
  cacheDbPath: string,
  shouldCloseDb: boolean
): DatabaseSync | null {
  if (!canUseCache) return cacheDb;

  let localDb = cacheDb;
  let openedLocal = false;
  if (!localDb && fs.existsSync(cacheDbPath)) {
    try {
      localDb = openMemoryCacheDb(cacheDbPath);
      openedLocal = true;
    } catch {}
  }
  if (localDb) {
    try {
      withSqliteBusyRetry(() => {
        const insStmt = localDb!.prepare(`
          INSERT OR REPLACE INTO memory_verification_cache
          (memory_id, parser_version, memory_file_sig, target_files_sig, workspace_sources_sig, overall_status, report_json, cached_at, has_callers)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insStmt.run(
          memoryId,
          PARSER_VERSION,
          memFileSig,
          targetFilesSig,
          wsSig,
          overallStatus,
          JSON.stringify(report),
          new Date().toISOString(),
          includeCallers ? 1 : 0
        );
      });
    } catch {} finally {
      if (openedLocal) {
        try { localDb.close(); } catch {}
      } else if (shouldCloseDb && cacheDb) {
        try { cacheDb.close(); } catch {}
        cacheDb = null;
      }
    }
  }

  memoryVerificationProcessCache.set(procKey, {
    parser_version: PARSER_VERSION,
    memory_file_sig: memFileSig,
    target_files_sig: targetFilesSig,
    workspace_sources_sig: wsSig,
    overall_status: overallStatus,
    has_callers: includeCallers,
    report: JSON.parse(JSON.stringify(report)),
  });

  return cacheDb;
}

function checkLiveVsGitShowSkeletonMatch(
  histStdout: string,
  histFp: SymbolFingerprint,
  live: SymbolFingerprint,
  parsed: ReturnType<typeof parseSymbolTarget>,
  liveFullText: string
): boolean {
  const histLines = histStdout.split(/\r?\n/);
  const ext = path.extname(live.file_path).toLowerCase();
  const histExtracted = extractSymbolBlockFromLines(histLines, parsed.symbolName, parsed.classHint, ext);
  const histBlockCode = histExtracted
    ? histExtracted.blockCode
    : histLines.slice(histFp.start_line - 1, histFp.end_line).join('\n');

  const liveLines = liveFullText.split(/\r?\n/);
  const liveExtracted = extractSymbolBlockFromLines(liveLines, parsed.symbolName, parsed.classHint, ext);
  const liveBlockCode = liveExtracted
    ? liveExtracted.blockCode
    : liveLines.slice(live.start_line - 1, live.end_line).join('\n');

  const histSkel =
    histExtracted?.skeleton_hash ?? computeStructuralSkeletonHash(histBlockCode, ext);
  const liveSkel =
    liveExtracted?.skeleton_hash ?? computeStructuralSkeletonHash(liveBlockCode, ext);
  return Boolean(histSkel && liveSkel && histSkel === liveSkel);
}

function recordMissingSymbolCheck(
  checks: SymbolDriftCheck[],
  topologyAnchors: TopologyAnchor[],
  symKey: string,
  recorded: SymbolFingerprint
): void {
  checks.push({
    symbol: symKey,
    status: 'MISSING',
    recorded,
    detail: `Symbol '${symKey}' (recorded at ${recorded.file_path}:L${recorded.start_line}-L${recorded.end_line}, hash ${recorded.ast_hash}) was deleted or renamed in current workspace.`,
  });
  topologyAnchors.push({
    symbol: symKey,
    file_path: recorded.file_path,
    lines: `L${recorded.start_line}-L${recorded.end_line} (MISSING)`,
    signature: recorded.signature,
    status: 'MISSING',
    callers: [],
  });
}

function recordVerifiedSymbolCheck(
  checks: SymbolDriftCheck[],
  topologyAnchors: TopologyAnchor[],
  symKey: string,
  recorded: SymbolFingerprint,
  live: SymbolFingerprint,
  detail: string,
  callers: string[],
  hasCodeGraph: boolean,
  parsed: ReturnType<typeof parseSymbolTarget>
): void {
  checks.push({
    symbol: symKey,
    status: 'VERIFIED',
    recorded,
    current: live,
    detail,
  });
  topologyAnchors.push({
    symbol: symKey,
    file_path: live.file_path,
    lines: `L${live.start_line}-L${live.end_line}`,
    signature: live.signature,
    status: 'VERIFIED',
    callers,
    codegraph_hint: hasCodeGraph
      ? `codegraph explore "${parsed.symbolName}"`
      : `view_file ${live.file_path} (lines ${live.start_line}-${live.end_line})`,
  });
}

function recordMismatchSymbolCheck(
  checks: SymbolDriftCheck[],
  topologyAnchors: TopologyAnchor[],
  symKey: string,
  recorded: SymbolFingerprint,
  live: SymbolFingerprint,
  detail: string,
  callers: string[],
  hasCodeGraph: boolean,
  parsed: ReturnType<typeof parseSymbolTarget>
): void {
  checks.push({
    symbol: symKey,
    status: 'MISMATCH',
    recorded,
    current: live,
    detail,
  });
  topologyAnchors.push({
    symbol: symKey,
    file_path: live.file_path,
    lines: `L${live.start_line}-L${live.end_line} (MUTATED)`,
    signature: live.signature,
    status: 'MISMATCH',
    callers,
    codegraph_hint: hasCodeGraph
      ? `codegraph explore "${parsed.symbolName}"`
      : `view_file ${live.file_path} (lines ${live.start_line}-${live.end_line})`,
  });
}

function buildLineShiftNote(baseline: SymbolFingerprint, live: SymbolFingerprint): string {
  return baseline.start_line > 0 &&
    (live.start_line !== baseline.start_line || live.file_path !== baseline.file_path)
    ? ` (relocated from ${baseline.file_path}:L${baseline.start_line}-L${baseline.end_line} -> ${live.file_path}:L${live.start_line}-L${live.end_line}, AST hash intact)`
    : '';
}

function createUnrecordedFingerprint(symKey: string): SymbolFingerprint {
  return {
    symbol: symKey,
    file_path: '(unrecorded)',
    kind: 'function',
    start_line: 0,
    end_line: 0,
    signature: symKey,
    ast_hash: '',
  };
}

function buildFastSymbolQuery(symKey: string, recorded: SymbolFingerprint): string {
  const parsed = parseSymbolTarget(symKey);
  return !parsed.fileHint &&
    !parsed.isWholeFile &&
    recorded.file_path &&
    recorded.file_path !== '(unrecorded)'
    ? `${recorded.file_path}#${symKey}`
    : symKey;
}

function parseAnchorLineRange(linesStr: string): { sLine: number; eLine: number } {
  const m = linesStr.match(/L(\d+)-L(\d+)/);
  return {
    sLine: m ? parseInt(m[1], 10) : 0,
    eLine: m ? parseInt(m[2], 10) : 0,
  };
}

function recordOtherBranchCheckAt(
  checks: SymbolDriftCheck[],
  topologyAnchors: TopologyAnchor[],
  index: number,
  symKey: string,
  recorded: SymbolFingerprint,
  matchedFp: SymbolFingerprint,
  matchedCommit: string,
  branchLabel: string,
  currentBranch: string | undefined,
  currentCommit: string
): void {
  const cleanFpPath = matchedFp.file_path.replace(/^\.\/+/, '');
  checks[index] = {
    symbol: symKey,
    status: 'OTHER_BRANCH',
    recorded,
    current: matchedFp,
    detail: `AST fingerprint verified (${matchedFp.ast_hash}) on branch '${branchLabel}' (@ commit ${matchedCommit}) at ${cleanFpPath}:L${matchedFp.start_line}-L${matchedFp.end_line} (not yet merged into ${currentBranch || 'HEAD'}@${currentCommit}).`,
  };
  topologyAnchors[index] = {
    symbol: symKey,
    file_path: cleanFpPath,
    lines: `L${matchedFp.start_line}-L${matchedFp.end_line} (@ ${branchLabel}:${matchedCommit})`,
    signature: matchedFp.signature,
    status: 'OTHER_BRANCH',
    callers: [],
    codegraph_hint: `git show ${matchedCommit}:./${cleanFpPath}`,
  };
}

function createVerificationReportObject(
  memory: EvoMemory,
  overallStatus: 'VERIFIED' | 'OTHER_BRANCH' | 'STALE',
  confidenceTag: MemoryVerificationReport['confidence_tag'],
  commitMatch: boolean,
  recCommit: string,
  recBranch: string | undefined,
  currentCommit: string,
  currentBranch: string | undefined,
  branchVerifiedCount: number,
  verifiedCount: number,
  totalSymbols: number,
  checks: SymbolDriftCheck[],
  topologyAnchors: TopologyAnchor[]
): MemoryVerificationReport {
  return {
    memory_id: memory.id,
    overall_status: overallStatus,
    confidence_tag: confidenceTag,
    commit_match: commitMatch,
    recorded_commit: recCommit,
    current_commit: currentCommit,
    recorded_branch: recBranch,
    current_branch: currentBranch,
    branch_verified_count: branchVerifiedCount,
    verified_count: verifiedCount,
    total_symbols: totalSymbols,
    checks,
    topology_anchors: topologyAnchors,
  };
}

export function verifyMemoryFreshness(
  workspaceRoot: string,
  memory: EvoMemory,
  options?: { includeCallers?: boolean; cacheDb?: DatabaseSync }
): MemoryVerificationReport {
  const root = path.resolve(workspaceRoot);
  const includeCallers = options?.includeCallers ?? true;
  const headSnap = readGitHeadSnapshot(root);
  const currentCommit = headSnap.commit;
  const currentBranch = headSnap.branch !== 'HEAD' ? headSnap.branch : undefined;
  const hasCodeGraph = fs.existsSync(path.join(root, '.codegraph'));

  const targetKeys =
    Object.keys(memory.ast_fingerprints).length > 0
      ? Object.keys(memory.ast_fingerprints)
      : memory.target_symbols;

  // Level 1 Cache Check
  const cacheDbPath = path.join(root, '.evo', '.cache', 'telemetry.db');
  let cacheDb: DatabaseSync | null = options?.cacheDb ?? null;
  const shouldCloseDb = !options?.cacheDb;
  let canUseCache = false;
  let memFileSig = '';
  let targetFilesSig = '';
  const procKey = `${root}:${memory.id}`;

  try {
    let hasRecordedTargetFiles = false;
    try {
      let createdBranchHead = '';
      if (
        memory.created_branch &&
        memory.created_branch !== 'HEAD' &&
        memory.created_branch !== currentBranch &&
        headSnap.commit !== 'uncommitted'
      ) {
        try {
          const brRes = spawnSync('git', ['rev-parse', '--short', '--verify', memory.created_branch], {
            cwd: root,
            encoding: 'utf8',
            timeout: 800,
          });
          if (brRes.status === 0 && brRes.stdout) {
            createdBranchHead = brRes.stdout.trim();
          }
        } catch {}
      }

      const cacheCtx = prepareVerificationCacheContext(
        root,
        memory,
        targetKeys,
        headSnap,
        hasCodeGraph,
        createdBranchHead
      );
      canUseCache = cacheCtx.canUseCache;
      hasRecordedTargetFiles = cacheCtx.hasRecordedTargetFiles;
      memFileSig = cacheCtx.memFileSig;
      targetFilesSig = cacheCtx.targetFilesSig;

      if (canUseCache) {
        // 1. Process-level Map Cache
        const proc = memoryVerificationProcessCache.get(procKey);
        if (
          proc &&
          proc.parser_version === PARSER_VERSION &&
          proc.memory_file_sig === memFileSig &&
          proc.target_files_sig === targetFilesSig
        ) {
          if (hasRecordedTargetFiles && !includeCallers && proc.overall_status === 'VERIFIED') {
            return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
          }

          const wsSig = getWorkspaceSourcesSig(root);
          if (wsSig === proc.workspace_sources_sig) {
            if (proc.has_callers || !includeCallers) {
              return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
            } else {
              for (const anchor of proc.report.topology_anchors) {
                if (!anchor.callers || anchor.callers.length === 0) {
                  const { sLine, eLine } = parseAnchorLineRange(anchor.lines);
                  anchor.callers = findSymbolCallers(root, anchor.symbol, anchor.file_path, sLine, eLine, 5);
                }
              }
              proc.has_callers = true;
              let openedDbForProc = false;
              let dbToUpdate = cacheDb;
              if (!dbToUpdate && fs.existsSync(cacheDbPath)) {
                try {
                  dbToUpdate = openMemoryCacheDb(cacheDbPath);
                  openedDbForProc = true;
                } catch {}
              }
              if (dbToUpdate) {
                try {
                  updateCachedCallersInSqlite(dbToUpdate, memory.id, proc.report, wsSig);
                } finally {
                  if (openedDbForProc) {
                    try { dbToUpdate.close(); } catch {}
                  }
                }
              }
              return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
            }
          }
        }

        // 2. SQLite Database Cache
        if (!cacheDb && fs.existsSync(cacheDbPath)) {
          cacheDb = openMemoryCacheDb(cacheDbPath);
        }
        if (cacheDb) {
          const row = readVerificationCacheSqliteRow(cacheDb, shouldCloseDb, memory.id);

          if (
            row &&
            row.parser_version === PARSER_VERSION &&
            row.memory_file_sig === memFileSig &&
            row.target_files_sig === targetFilesSig
          ) {
            if (hasRecordedTargetFiles && !includeCallers && row.overall_status === 'VERIFIED') {
              const cachedReport = JSON.parse(row.report_json) as MemoryVerificationReport;
              memoryVerificationProcessCache.set(procKey, {
                parser_version: row.parser_version,
                memory_file_sig: row.memory_file_sig,
                target_files_sig: row.target_files_sig,
                workspace_sources_sig: row.workspace_sources_sig || '',
                overall_status: row.overall_status,
                has_callers: Boolean(row.has_callers),
                report: JSON.parse(row.report_json),
              });
              cachedReport.current_commit = currentCommit;
              cachedReport.current_branch = currentBranch;
              cachedReport.commit_match = memory.created_commit === currentCommit;
              return cachedReport;
            }

            const wsSig = getWorkspaceSourcesSig(root);
            if (wsSig === (row.workspace_sources_sig || '')) {
              const cachedReport = JSON.parse(row.report_json) as MemoryVerificationReport;
              if (Boolean(row.has_callers) || !includeCallers) {
                memoryVerificationProcessCache.set(procKey, {
                  parser_version: row.parser_version,
                  memory_file_sig: row.memory_file_sig,
                  target_files_sig: row.target_files_sig,
                  workspace_sources_sig: row.workspace_sources_sig || '',
                  overall_status: row.overall_status,
                  has_callers: Boolean(row.has_callers),
                  report: JSON.parse(row.report_json),
                });
                if (shouldCloseDb && cacheDb) {
                  try { cacheDb.close(); } catch {}
                  cacheDb = null;
                }
                cachedReport.current_commit = currentCommit;
                cachedReport.current_branch = currentBranch;
                cachedReport.commit_match = memory.created_commit === currentCommit;
                return cachedReport;
              } else {
                for (const anchor of cachedReport.topology_anchors) {
                  if (!anchor.callers || anchor.callers.length === 0) {
                    const { sLine, eLine } = parseAnchorLineRange(anchor.lines);
                    anchor.callers = findSymbolCallers(root, anchor.symbol, anchor.file_path, sLine, eLine, 5);
                  }
                }
                updateCachedCallersInSqlite(cacheDb, memory.id, cachedReport, wsSig);
                memoryVerificationProcessCache.set(procKey, {
                  parser_version: row.parser_version,
                  memory_file_sig: row.memory_file_sig,
                  target_files_sig: row.target_files_sig,
                  workspace_sources_sig: wsSig,
                  overall_status: row.overall_status,
                  has_callers: true,
                  report: JSON.parse(JSON.stringify(cachedReport)),
                });
                if (shouldCloseDb && cacheDb) {
                  try { cacheDb.close(); } catch {}
                  cacheDb = null;
                }
                cachedReport.current_commit = currentCommit;
                cachedReport.current_branch = currentBranch;
                cachedReport.commit_match = memory.created_commit === currentCommit;
                return cachedReport;
              }
            }
          }
        }
      }
    } catch {
      if (shouldCloseDb && cacheDb) {
        try { cacheDb.close(); } catch {}
        cacheDb = null;
      }
    }

    const checks: SymbolDriftCheck[] = [];
    const topologyAnchors: TopologyAnchor[] = [];
    let verifiedCount = 0;
    let hasUnanchoredVerifiedSymbol = false;

    for (const symKey of targetKeys) {
      const recorded: SymbolFingerprint = memory.ast_fingerprints[symKey] || createUnrecordedFingerprint(symKey);
      const parsed = parseSymbolTarget(symKey);
      const fastQuery = buildFastSymbolQuery(symKey, recorded);

      const liveRaw = extractSymbolFingerprint(root, fastQuery);
      const live = liveRaw ? { ...liveRaw, symbol: symKey } : null;

      if (!live) {
        recordMissingSymbolCheck(checks, topologyAnchors, symKey, recorded);
        continue;
      }

      if (recorded.ast_hash && live.ast_hash === recorded.ast_hash) {
        verifiedCount++;
        const lineShiftNote = buildLineShiftNote(recorded, live);
        const callers = includeCallers
          ? findSymbolCallers(root, symKey, live.file_path, live.start_line, live.end_line, 5)
          : [];
        recordVerifiedSymbolCheck(
          checks,
          topologyAnchors,
          symKey,
          recorded,
          live,
          `AST fingerprint verified (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote}.`,
          callers,
          hasCodeGraph,
          parsed
        );
      } else if (!recorded.ast_hash) {
        const createdCommit = (memory.created_commit || '').trim();
        let baselineHandled = false;

        if (
          createdCommit &&
          createdCommit !== 'uncommitted' &&
          isGitCommitPresent(root, createdCommit)
        ) {
          const histFp = extractSymbolFingerprintAtCommit(root, createdCommit, symKey, recorded);
          if (histFp && histFp.ast_hash) {
            baselineHandled = true;
            let skeletonMatches = false;
            if (live.ast_hash !== histFp.ast_hash && (histFp.kind === live.kind || !live.kind)) {
              try {
                const histCleanRel = histFp.file_path.replace(/\\/g, '/').replace(/^\.\/+/, '');
                const histShowRes = spawnSync('git', ['show', `${createdCommit}:./${histCleanRel}`], {
                  cwd: root,
                  encoding: 'utf8',
                  timeout: 2000,
                  maxBuffer: 4 * 1024 * 1024,
                });
                if (histShowRes.status === 0 && typeof histShowRes.stdout === 'string') {
                  const liveFullPath = path.resolve(root, live.file_path);
                  if (isRealSubpathOf(root, liveFullPath) && fs.existsSync(liveFullPath)) {
                    const liveFullText = fs.readFileSync(liveFullPath, 'utf8');
                    skeletonMatches = checkLiveVsGitShowSkeletonMatch(
                      histShowRes.stdout,
                      histFp,
                      live,
                      parsed,
                      liveFullText
                    );
                  }
                }
              } catch {
                // ignore git / fs error
              }
            }

            if (live.ast_hash === histFp.ast_hash || skeletonMatches) {
              verifiedCount++;
              const lineShiftNote = buildLineShiftNote(histFp, live);
              const detail = skeletonMatches
                ? `AST fingerprint verified against baseline commit ${memory.created_commit} via structural skeleton (${live.ast_hash}, control-flow skeleton intact after non-structural edit) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote}.`
                : `AST fingerprint verified against baseline commit ${memory.created_commit} (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote}.`;
              const callers = includeCallers
                ? findSymbolCallers(root, symKey, live.file_path, live.start_line, live.end_line, 5)
                : [];
              recordVerifiedSymbolCheck(
                checks,
                topologyAnchors,
                symKey,
                recorded,
                live,
                detail,
                callers,
                hasCodeGraph,
                parsed
              );
            } else {
              const callers = includeCallers
                ? findSymbolCallers(root, symKey, live.file_path, live.start_line, live.end_line, 5)
                : [];
              recordMismatchSymbolCheck(
                checks,
                topologyAnchors,
                symKey,
                recorded,
                live,
                `AST structural drift detected for '${symKey}': baseline commit ${memory.created_commit} hash ${histFp.ast_hash} != live hash ${live.ast_hash} at ${live.file_path}:L${live.start_line}-L${live.end_line}.`,
                callers,
                hasCodeGraph,
                parsed
              );
            }
          }
        }

        if (!baselineHandled) {
          hasUnanchoredVerifiedSymbol = true;
          verifiedCount++;
          const callers = includeCallers
            ? findSymbolCallers(root, symKey, live.file_path, live.start_line, live.end_line, 5)
            : [];
          recordVerifiedSymbolCheck(
            checks,
            topologyAnchors,
            symKey,
            recorded,
            live,
            `Symbol presence verified at ${live.file_path}:L${live.start_line}-L${live.end_line} (unanchored: no baseline AST hash recorded).`,
            callers,
            hasCodeGraph,
            parsed
          );
        }
      } else {
        // Check dual V1/V2 verification for truncated memories
        let dualVerified = false;
        const recordedSpan = recorded.end_line - recorded.start_line + 1;
        const liveSpan = live.end_line - live.start_line + 1;
        const createdCommit = (memory.created_commit || '').trim();

        if (
          recordedSpan <= 12 &&
          recordedSpan < liveSpan &&
          createdCommit &&
          createdCommit !== 'uncommitted' &&
          isGitCommitPresent(root, createdCommit)
        ) {
          const fpAtCreatedV1 = extractSymbolFingerprintAtCommitV1(root, createdCommit, symKey, recorded);
          const fpAtCreatedV2 = extractSymbolFingerprintAtCommit(root, createdCommit, symKey, recorded);
          if (
            fpAtCreatedV1 &&
            fpAtCreatedV2 &&
            fpAtCreatedV1.ast_hash === recorded.ast_hash &&
            fpAtCreatedV2.ast_hash === live.ast_hash
          ) {
            dualVerified = true;
          }
        }

        let skeletonVerified = false;
        if (
          !dualVerified &&
          createdCommit &&
          createdCommit !== 'uncommitted' &&
          isGitCommitPresent(root, createdCommit)
        ) {
          try {
            const histFp = extractSymbolFingerprintAtCommit(root, createdCommit, symKey, recorded);
            const histMatchesRecorded =
              Boolean(histFp) &&
              Boolean(recorded.ast_hash) &&
              (histFp!.ast_hash === recorded.ast_hash ||
                extractSymbolFingerprintAtCommitV1(root, createdCommit, symKey, recorded)?.ast_hash ===
                  recorded.ast_hash);
            if (histFp && histMatchesRecorded && (histFp.kind === live.kind || !live.kind)) {
              const histCleanRel = histFp.file_path.replace(/\\/g, '/').replace(/^\.\/+/, '');
              const histShowRes = spawnSync('git', ['show', `${createdCommit}:./${histCleanRel}`], {
                cwd: root,
                encoding: 'utf8',
                timeout: 2000,
                maxBuffer: 4 * 1024 * 1024,
              });
              if (histShowRes.status === 0 && typeof histShowRes.stdout === 'string') {
                const liveFullPath = path.resolve(root, live.file_path);
                if (isRealSubpathOf(root, liveFullPath) && fs.existsSync(liveFullPath)) {
                  const liveFullText = fs.readFileSync(liveFullPath, 'utf8');
                  skeletonVerified = checkLiveVsGitShowSkeletonMatch(
                    histShowRes.stdout,
                    histFp,
                    live,
                    parsed,
                    liveFullText
                  );
                }
              }
            }
          } catch {
            // ignore git / fs error
          }
        }

        if (dualVerified || skeletonVerified) {
          verifiedCount++;
          const lineShiftNote = buildLineShiftNote(recorded, live);
          const detailNote = skeletonVerified
            ? `AST fingerprint verified via structural skeleton (${live.ast_hash}, control-flow skeleton intact after non-structural edit) at ${live.file_path}:L${live.start_line}-L${live.end_line}.`
            : `AST fingerprint verified (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote} (upgraded from truncated v1 hash ${recorded.ast_hash}).`;
          const callers = includeCallers
            ? findSymbolCallers(root, symKey, live.file_path, live.start_line, live.end_line, 5)
            : [];
          recordVerifiedSymbolCheck(
            checks,
            topologyAnchors,
            symKey,
            recorded,
            live,
            detailNote,
            callers,
            hasCodeGraph,
            parsed
          );
        } else {
          const callers = includeCallers
            ? findSymbolCallers(root, symKey, live.file_path, live.start_line, live.end_line, 5)
            : [];
          recordMismatchSymbolCheck(
            checks,
            topologyAnchors,
            symKey,
            recorded,
            live,
            `AST structural drift detected for '${symKey}': recorded hash ${recorded.ast_hash} != live hash ${live.ast_hash} at ${live.file_path}:L${live.start_line}-L${live.end_line}.`,
            callers,
            hasCodeGraph,
            parsed
          );
        }
      }
    }

    const totalSymbols = targetKeys.length;

    const buildResult = (
      overallStatus: 'VERIFIED' | 'OTHER_BRANCH' | 'STALE',
      confidenceTag: MemoryVerificationReport['confidence_tag'],
      commitMatch: boolean,
      recCommit: string,
      recBranch: string | undefined,
      branchVerifiedCount: number
    ): MemoryVerificationReport => {
      const report = createVerificationReportObject(
        memory,
        overallStatus,
        confidenceTag,
        commitMatch,
        recCommit,
        recBranch,
        currentCommit,
        currentBranch,
        branchVerifiedCount,
        verifiedCount,
        totalSymbols,
        checks,
        topologyAnchors
      );
      const wsSig = getWorkspaceSourcesSig(root);
      cacheDb = persistVerificationReportToCache(
        procKey,
        memory.id,
        canUseCache,
        memFileSig,
        targetFilesSig,
        wsSig,
        overallStatus,
        includeCallers,
        report,
        cacheDb,
        cacheDbPath,
        shouldCloseDb
      );
      return report;
    };

    // Tier 1: All symbols verified in live working tree
    if (totalSymbols > 0 && verifiedCount === totalSymbols) {
      return buildResult(
        'VERIFIED',
        hasUnanchoredVerifiedSymbol ? '[置信度: MID (50–80%)]' : '[置信度: HIGH (≥80%)]',
        memory.created_commit === currentCommit,
        memory.created_commit,
        memory.created_branch,
        0
      );
    }

    // Tier 2: Git-Topology-Aware Fallback (OTHER_BRANCH vs STALE)
    const candidateGitRefs: Array<{ commit: string; branchHint?: string }> = [];
    const pushCandidateRef = (commit?: string, branchHint?: string) => {
      const c = (commit || '').trim();
      if (!c) return;
      if (candidateGitRefs.some((x) => x.commit === c)) return;
      candidateGitRefs.push({ commit: c, branchHint });
    };

    const cleanRecordedBranch = (memory.created_branch || '').trim();
    const hasExplicitBranch = Boolean(cleanRecordedBranch && cleanRecordedBranch !== 'HEAD');

    if (
      isGitCommitPresent(root, memory.created_commit) &&
      !isGitAncestorOfHead(root, memory.created_commit)
    ) {
      pushCandidateRef(memory.created_commit.trim(), memory.created_branch);
    }
    if (hasExplicitBranch && cleanRecordedBranch !== currentBranch) {
      const branchTip =
        resolveGitBranchCommit(root, cleanRecordedBranch) ||
        resolveGitBranchCommit(root, `origin/${cleanRecordedBranch}`);
      if (branchTip) {
        pushCandidateRef(branchTip, cleanRecordedBranch);
      }
    }
    if (!hasExplicitBranch && isGitCommitPresent(root, memory.created_commit)) {
      for (const desc of discoverDescendantBranchRefs(root, memory.created_commit, currentCommit, 8)) {
        pushCandidateRef(desc.commit, desc.branch);
      }
    }

    if (totalSymbols > 0 && verifiedCount < totalSymbols && candidateGitRefs.length > 0) {
      let branchVerifiedCount = 0;
      let resolvedBranchLabel = memory.created_branch || '';
      let resolvedCommitRef =
        memory.created_commit && memory.created_commit !== 'uncommitted'
          ? memory.created_commit
          : candidateGitRefs[0].commit;

      for (let i = 0; i < checks.length; i++) {
        if (checks[i].status === 'VERIFIED') continue;
        const symKey = checks[i].symbol;
        const recorded = checks[i].recorded;
        let matchedFp: SymbolFingerprint | null = null;
        let matchedRef: { commit: string; branchHint?: string } | null = null;

        for (const cand of candidateGitRefs) {
          const fp = extractSymbolFingerprintAtCommit(root, cand.commit, symKey, recorded);
          if (fp && (!recorded.ast_hash || fp.ast_hash === recorded.ast_hash)) {
            matchedFp = fp;
            matchedRef = cand;
            break;
          }
        }

        if (matchedFp && matchedRef) {
          branchVerifiedCount++;
          const branchLabel = resolveCommitBranchLabel(
            root,
            matchedRef.commit,
            matchedRef.branchHint || memory.created_branch
          );
          resolvedBranchLabel = branchLabel;
          resolvedCommitRef = matchedRef.commit;
          recordOtherBranchCheckAt(
            checks,
            topologyAnchors,
            i,
            symKey,
            recorded,
            matchedFp,
            matchedRef.commit,
            branchLabel,
            currentBranch,
            currentCommit
          );
        }
      }

      if (verifiedCount + branchVerifiedCount === totalSymbols) {
        return buildResult(
          'OTHER_BRANCH',
          '[置信度: MID (50–80%) · OTHER_BRANCH]',
          false,
          resolvedCommitRef,
          resolvedBranchLabel || 'other-branch',
          branchVerifiedCount
        );
      }
    }

    // Tier 3: True code drift (STALE)
    return buildResult(
      'STALE',
      '[置信度: LOW (20–50%) · STALE]',
      memory.created_commit === currentCommit,
      memory.created_commit,
      memory.created_branch,
      0
    );
  } finally {
    if (shouldCloseDb && cacheDb) {
      try {
        cacheDb.close();
      } catch {}
      cacheDb = null;
    }
  }
}

export async function verifyMemoryFreshnessAsync(
  workspaceRoot: string,
  memory: EvoMemory,
  options?: { includeCallers?: boolean; cacheDb?: DatabaseSync }
): Promise<MemoryVerificationReport> {
  const root = path.resolve(workspaceRoot);
  const includeCallers = options?.includeCallers ?? true;
  const headSnap = await readGitHeadSnapshotAsync(root);
  const currentCommit = headSnap.commit;
  const currentBranch = headSnap.branch !== 'HEAD' ? headSnap.branch : undefined;
  const hasCodeGraph = fs.existsSync(path.join(root, '.codegraph'));

  const targetKeys =
    Object.keys(memory.ast_fingerprints).length > 0
      ? Object.keys(memory.ast_fingerprints)
      : memory.target_symbols;

  // Level 1 Cache Check
  const cacheDbPath = path.join(root, '.evo', '.cache', 'telemetry.db');
  let cacheDb: DatabaseSync | null = options?.cacheDb ?? null;
  const shouldCloseDb = !options?.cacheDb;
  let canUseCache = false;
  let memFileSig = '';
  let targetFilesSig = '';
  const procKey = `${root}:${memory.id}`;

  try {
    let hasRecordedTargetFiles = false;
    try {
      let createdBranchHead = '';
      if (
        memory.created_branch &&
        memory.created_branch !== 'HEAD' &&
        memory.created_branch !== currentBranch &&
        headSnap.commit !== 'uncommitted'
      ) {
        const brRes = await spawnGitAsync(
          root,
          ['rev-parse', '--short', '--verify', memory.created_branch],
          800
        );
        if (brRes.status === 0 && brRes.stdout) {
          createdBranchHead = brRes.stdout.trim();
        }
      }

      const cacheCtx = prepareVerificationCacheContext(
        root,
        memory,
        targetKeys,
        headSnap,
        hasCodeGraph,
        createdBranchHead
      );
      canUseCache = cacheCtx.canUseCache;
      hasRecordedTargetFiles = cacheCtx.hasRecordedTargetFiles;
      memFileSig = cacheCtx.memFileSig;
      targetFilesSig = cacheCtx.targetFilesSig;

      if (canUseCache) {
        // 1. Process-level Map Cache
        const proc = memoryVerificationProcessCache.get(procKey);
        if (
          proc &&
          proc.parser_version === PARSER_VERSION &&
          proc.memory_file_sig === memFileSig &&
          proc.target_files_sig === targetFilesSig
        ) {
          if (hasRecordedTargetFiles && !includeCallers && proc.overall_status === 'VERIFIED') {
            return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
          }

          const wsSig = await getWorkspaceSourcesSigAsync(root);
          if (wsSig === proc.workspace_sources_sig) {
            if (proc.has_callers || !includeCallers) {
              return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
            } else {
              for (const anchor of proc.report.topology_anchors) {
                if (!anchor.callers || anchor.callers.length === 0) {
                  const { sLine, eLine } = parseAnchorLineRange(anchor.lines);
                  anchor.callers = await findSymbolCallersAsync(
                    root,
                    anchor.symbol,
                    anchor.file_path,
                    sLine,
                    eLine,
                    5
                  );
                }
              }
              proc.has_callers = true;
              let openedDbForProc = false;
              let dbToUpdate = cacheDb;
              if (!dbToUpdate && fs.existsSync(cacheDbPath)) {
                try {
                  dbToUpdate = openMemoryCacheDb(cacheDbPath);
                  openedDbForProc = true;
                } catch {}
              }
              if (dbToUpdate) {
                try {
                  updateCachedCallersInSqlite(dbToUpdate, memory.id, proc.report, wsSig);
                } finally {
                  if (openedDbForProc) {
                    try { dbToUpdate.close(); } catch {}
                  }
                }
              }
              return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
            }
          }
        }

        // 2. SQLite Database Cache
        if (!cacheDb && fs.existsSync(cacheDbPath)) {
          cacheDb = openMemoryCacheDb(cacheDbPath);
        }
        if (cacheDb) {
          const row = readVerificationCacheSqliteRow(cacheDb, shouldCloseDb, memory.id);

          if (
            row &&
            row.parser_version === PARSER_VERSION &&
            row.memory_file_sig === memFileSig &&
            row.target_files_sig === targetFilesSig
          ) {
            if (hasRecordedTargetFiles && !includeCallers && row.overall_status === 'VERIFIED') {
              const cachedReport = JSON.parse(row.report_json) as MemoryVerificationReport;
              memoryVerificationProcessCache.set(procKey, {
                parser_version: row.parser_version,
                memory_file_sig: row.memory_file_sig,
                target_files_sig: row.target_files_sig,
                workspace_sources_sig: row.workspace_sources_sig || '',
                overall_status: row.overall_status,
                has_callers: Boolean(row.has_callers),
                report: JSON.parse(row.report_json),
              });
              cachedReport.current_commit = currentCommit;
              cachedReport.current_branch = currentBranch;
              cachedReport.commit_match = memory.created_commit === currentCommit;
              return cachedReport;
            }

            const wsSig = await getWorkspaceSourcesSigAsync(root);
            if (wsSig === (row.workspace_sources_sig || '')) {
              const cachedReport = JSON.parse(row.report_json) as MemoryVerificationReport;
              if (Boolean(row.has_callers) || !includeCallers) {
                memoryVerificationProcessCache.set(procKey, {
                  parser_version: row.parser_version,
                  memory_file_sig: row.memory_file_sig,
                  target_files_sig: row.target_files_sig,
                  workspace_sources_sig: row.workspace_sources_sig || '',
                  overall_status: row.overall_status,
                  has_callers: Boolean(row.has_callers),
                  report: JSON.parse(row.report_json),
                });
                if (shouldCloseDb && cacheDb) {
                  try { cacheDb.close(); } catch {}
                  cacheDb = null;
                }
                cachedReport.current_commit = currentCommit;
                cachedReport.current_branch = currentBranch;
                cachedReport.commit_match = memory.created_commit === currentCommit;
                return cachedReport;
              } else {
                for (const anchor of cachedReport.topology_anchors) {
                  if (!anchor.callers || anchor.callers.length === 0) {
                    const { sLine, eLine } = parseAnchorLineRange(anchor.lines);
                    anchor.callers = await findSymbolCallersAsync(
                      root,
                      anchor.symbol,
                      anchor.file_path,
                      sLine,
                      eLine,
                      5
                    );
                  }
                }
                updateCachedCallersInSqlite(cacheDb, memory.id, cachedReport, wsSig);
                memoryVerificationProcessCache.set(procKey, {
                  parser_version: row.parser_version,
                  memory_file_sig: row.memory_file_sig,
                  target_files_sig: row.target_files_sig,
                  workspace_sources_sig: wsSig,
                  overall_status: row.overall_status,
                  has_callers: true,
                  report: JSON.parse(JSON.stringify(cachedReport)),
                });
                if (shouldCloseDb && cacheDb) {
                  try { cacheDb.close(); } catch {}
                  cacheDb = null;
                }
                cachedReport.current_commit = currentCommit;
                cachedReport.current_branch = currentBranch;
                cachedReport.commit_match = memory.created_commit === currentCommit;
                return cachedReport;
              }
            }
          }
        }
      }
    } catch {
      if (shouldCloseDb && cacheDb) {
        try { cacheDb.close(); } catch {}
        cacheDb = null;
      }
    }

    const checks: SymbolDriftCheck[] = [];
    const topologyAnchors: TopologyAnchor[] = [];
    let verifiedCount = 0;
    let hasUnanchoredVerifiedSymbol = false;

    for (const symKey of targetKeys) {
      const recorded: SymbolFingerprint = memory.ast_fingerprints[symKey] || createUnrecordedFingerprint(symKey);
      const parsed = parseSymbolTarget(symKey);
      const fastQuery = buildFastSymbolQuery(symKey, recorded);

      const liveRaw = await extractSymbolFingerprintAsync(root, fastQuery);
      const live = liveRaw ? { ...liveRaw, symbol: symKey } : null;

      if (!live) {
        recordMissingSymbolCheck(checks, topologyAnchors, symKey, recorded);
        continue;
      }

      if (recorded.ast_hash && live.ast_hash === recorded.ast_hash) {
        verifiedCount++;
        const lineShiftNote = buildLineShiftNote(recorded, live);
        const callers = includeCallers
          ? await findSymbolCallersAsync(root, symKey, live.file_path, live.start_line, live.end_line, 5)
          : [];
        recordVerifiedSymbolCheck(
          checks,
          topologyAnchors,
          symKey,
          recorded,
          live,
          `AST fingerprint verified (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote}.`,
          callers,
          hasCodeGraph,
          parsed
        );
      } else if (!recorded.ast_hash) {
        const createdCommit = (memory.created_commit || '').trim();
        let baselineHandled = false;

        if (
          createdCommit &&
          createdCommit !== 'uncommitted' &&
          (await isGitCommitPresentAsync(root, createdCommit))
        ) {
          const histFp = await extractSymbolFingerprintAtCommitAsync(root, createdCommit, symKey, recorded);
          if (histFp && histFp.ast_hash) {
            baselineHandled = true;
            let skeletonMatches = false;
            if (live.ast_hash !== histFp.ast_hash && (histFp.kind === live.kind || !live.kind)) {
              try {
                const histCleanRel = histFp.file_path.replace(/\\/g, '/').replace(/^\.\/+/, '');
                const histShowRes = await spawnGitAsync(
                  root,
                  ['show', `${createdCommit}:./${histCleanRel}`],
                  2000
                );
                if (histShowRes.status === 0 && typeof histShowRes.stdout === 'string') {
                  const liveFullPath = path.resolve(root, live.file_path);
                  if (isRealSubpathOf(root, liveFullPath) && fs.existsSync(liveFullPath)) {
                    const liveFullText = await fs.promises.readFile(liveFullPath, 'utf8');
                    skeletonMatches = checkLiveVsGitShowSkeletonMatch(
                      histShowRes.stdout,
                      histFp,
                      live,
                      parsed,
                      liveFullText
                    );
                  }
                }
              } catch {
                // ignore git / fs error
              }
            }

            if (live.ast_hash === histFp.ast_hash || skeletonMatches) {
              verifiedCount++;
              const lineShiftNote = buildLineShiftNote(histFp, live);
              const detail = skeletonMatches
                ? `AST fingerprint verified against baseline commit ${memory.created_commit} via structural skeleton (${live.ast_hash}, control-flow skeleton intact after non-structural edit) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote}.`
                : `AST fingerprint verified against baseline commit ${memory.created_commit} (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote}.`;
              const callers = includeCallers
                ? await findSymbolCallersAsync(root, symKey, live.file_path, live.start_line, live.end_line, 5)
                : [];
              recordVerifiedSymbolCheck(
                checks,
                topologyAnchors,
                symKey,
                recorded,
                live,
                detail,
                callers,
                hasCodeGraph,
                parsed
              );
            } else {
              const callers = includeCallers
                ? await findSymbolCallersAsync(root, symKey, live.file_path, live.start_line, live.end_line, 5)
                : [];
              recordMismatchSymbolCheck(
                checks,
                topologyAnchors,
                symKey,
                recorded,
                live,
                `AST structural drift detected for '${symKey}': baseline commit ${memory.created_commit} hash ${histFp.ast_hash} != live hash ${live.ast_hash} at ${live.file_path}:L${live.start_line}-L${live.end_line}.`,
                callers,
                hasCodeGraph,
                parsed
              );
            }
          }
        }

        if (!baselineHandled) {
          hasUnanchoredVerifiedSymbol = true;
          verifiedCount++;
          const callers = includeCallers
            ? await findSymbolCallersAsync(root, symKey, live.file_path, live.start_line, live.end_line, 5)
            : [];
          recordVerifiedSymbolCheck(
            checks,
            topologyAnchors,
            symKey,
            recorded,
            live,
            `Symbol presence verified at ${live.file_path}:L${live.start_line}-L${live.end_line} (unanchored: no baseline AST hash recorded).`,
            callers,
            hasCodeGraph,
            parsed
          );
        }
      } else {
        // Check dual V1/V2 verification for truncated memories
        let dualVerified = false;
        const recordedSpan = recorded.end_line - recorded.start_line + 1;
        const liveSpan = live.end_line - live.start_line + 1;
        const createdCommit = (memory.created_commit || '').trim();

        if (
          recordedSpan <= 12 &&
          recordedSpan < liveSpan &&
          createdCommit &&
          createdCommit !== 'uncommitted' &&
          (await isGitCommitPresentAsync(root, createdCommit))
        ) {
          const fpAtCreatedV1 = await extractSymbolFingerprintAtCommitV1Async(
            root,
            createdCommit,
            symKey,
            recorded
          );
          const fpAtCreatedV2 = await extractSymbolFingerprintAtCommitAsync(
            root,
            createdCommit,
            symKey,
            recorded
          );
          if (
            fpAtCreatedV1 &&
            fpAtCreatedV2 &&
            fpAtCreatedV1.ast_hash === recorded.ast_hash &&
            fpAtCreatedV2.ast_hash === live.ast_hash
          ) {
            dualVerified = true;
          }
        }

        let skeletonVerified = false;
        if (
          !dualVerified &&
          createdCommit &&
          createdCommit !== 'uncommitted' &&
          (await isGitCommitPresentAsync(root, createdCommit))
        ) {
          try {
            const histFp = await extractSymbolFingerprintAtCommitAsync(
              root,
              createdCommit,
              symKey,
              recorded
            );
            const histMatchesRecorded =
              Boolean(histFp) &&
              Boolean(recorded.ast_hash) &&
              (histFp!.ast_hash === recorded.ast_hash ||
                (
                  await extractSymbolFingerprintAtCommitV1Async(
                    root,
                    createdCommit,
                    symKey,
                    recorded
                  )
                )?.ast_hash === recorded.ast_hash);
            if (histFp && histMatchesRecorded && (histFp.kind === live.kind || !live.kind)) {
              const histCleanRel = histFp.file_path.replace(/\\/g, '/').replace(/^\.\/+/, '');
              const histShowRes = await spawnGitAsync(
                root,
                ['show', `${createdCommit}:./${histCleanRel}`],
                2000
              );
              if (histShowRes.status === 0 && typeof histShowRes.stdout === 'string') {
                const liveFullPath = path.resolve(root, live.file_path);
                if (isRealSubpathOf(root, liveFullPath) && fs.existsSync(liveFullPath)) {
                  const liveFullText = await fs.promises.readFile(liveFullPath, 'utf8');
                  skeletonVerified = checkLiveVsGitShowSkeletonMatch(
                    histShowRes.stdout,
                    histFp,
                    live,
                    parsed,
                    liveFullText
                  );
                }
              }
            }
          } catch {
            // ignore git / fs error
          }
        }

        if (dualVerified || skeletonVerified) {
          verifiedCount++;
          const lineShiftNote = buildLineShiftNote(recorded, live);
          const detailNote = skeletonVerified
            ? `AST fingerprint verified via structural skeleton (${live.ast_hash}, control-flow skeleton intact after non-structural edit) at ${live.file_path}:L${live.start_line}-L${live.end_line}.`
            : `AST fingerprint verified (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote} (upgraded from truncated v1 hash ${recorded.ast_hash}).`;
          const callers = includeCallers
            ? await findSymbolCallersAsync(root, symKey, live.file_path, live.start_line, live.end_line, 5)
            : [];
          recordVerifiedSymbolCheck(
            checks,
            topologyAnchors,
            symKey,
            recorded,
            live,
            detailNote,
            callers,
            hasCodeGraph,
            parsed
          );
        } else {
          const callers = includeCallers
            ? await findSymbolCallersAsync(root, symKey, live.file_path, live.start_line, live.end_line, 5)
            : [];
          recordMismatchSymbolCheck(
            checks,
            topologyAnchors,
            symKey,
            recorded,
            live,
            `AST structural drift detected for '${symKey}': recorded hash ${recorded.ast_hash} != live hash ${live.ast_hash} at ${live.file_path}:L${live.start_line}-L${live.end_line}.`,
            callers,
            hasCodeGraph,
            parsed
          );
        }
      }
    }

    const totalSymbols = targetKeys.length;

    const buildResultAsync = async (
      overallStatus: 'VERIFIED' | 'OTHER_BRANCH' | 'STALE',
      confidenceTag: MemoryVerificationReport['confidence_tag'],
      commitMatch: boolean,
      recCommit: string,
      recBranch: string | undefined,
      branchVerifiedCount: number
    ): Promise<MemoryVerificationReport> => {
      const report = createVerificationReportObject(
        memory,
        overallStatus,
        confidenceTag,
        commitMatch,
        recCommit,
        recBranch,
        currentCommit,
        currentBranch,
        branchVerifiedCount,
        verifiedCount,
        totalSymbols,
        checks,
        topologyAnchors
      );
      const wsSig = await getWorkspaceSourcesSigAsync(root);
      cacheDb = persistVerificationReportToCache(
        procKey,
        memory.id,
        canUseCache,
        memFileSig,
        targetFilesSig,
        wsSig,
        overallStatus,
        includeCallers,
        report,
        cacheDb,
        cacheDbPath,
        shouldCloseDb
      );
      return report;
    };

    // Tier 1: All symbols verified in live working tree
    if (totalSymbols > 0 && verifiedCount === totalSymbols) {
      return await buildResultAsync(
        'VERIFIED',
        hasUnanchoredVerifiedSymbol ? '[置信度: MID (50–80%)]' : '[置信度: HIGH (≥80%)]',
        memory.created_commit === currentCommit,
        memory.created_commit,
        memory.created_branch,
        0
      );
    }

    // Tier 2: Git-Topology-Aware Fallback (OTHER_BRANCH vs STALE)
    const candidateGitRefs: Array<{ commit: string; branchHint?: string }> = [];
    const pushCandidateRef = (commit?: string, branchHint?: string) => {
      const c = (commit || '').trim();
      if (!c) return;
      if (candidateGitRefs.some((x) => x.commit === c)) return;
      candidateGitRefs.push({ commit: c, branchHint });
    };

    const cleanRecordedBranch = (memory.created_branch || '').trim();
    const hasExplicitBranch = Boolean(cleanRecordedBranch && cleanRecordedBranch !== 'HEAD');

    if (
      (await isGitCommitPresentAsync(root, memory.created_commit)) &&
      !(await isGitAncestorOfHeadAsync(root, memory.created_commit))
    ) {
      pushCandidateRef(memory.created_commit.trim(), memory.created_branch);
    }
    if (hasExplicitBranch && cleanRecordedBranch !== currentBranch) {
      const branchTip =
        (await resolveGitBranchCommitAsync(root, cleanRecordedBranch)) ||
        (await resolveGitBranchCommitAsync(root, `origin/${cleanRecordedBranch}`));
      if (branchTip) {
        pushCandidateRef(branchTip, cleanRecordedBranch);
      }
    }
    if (!hasExplicitBranch && (await isGitCommitPresentAsync(root, memory.created_commit))) {
      for (const desc of await discoverDescendantBranchRefsAsync(
        root,
        memory.created_commit,
        currentCommit,
        8
      )) {
        pushCandidateRef(desc.commit, desc.branch);
      }
    }

    if (totalSymbols > 0 && verifiedCount < totalSymbols && candidateGitRefs.length > 0) {
      let branchVerifiedCount = 0;
      let resolvedBranchLabel = memory.created_branch || '';
      let resolvedCommitRef =
        memory.created_commit && memory.created_commit !== 'uncommitted'
          ? memory.created_commit
          : candidateGitRefs[0].commit;

      for (let i = 0; i < checks.length; i++) {
        if (checks[i].status === 'VERIFIED') continue;
        const symKey = checks[i].symbol;
        const recorded = checks[i].recorded;
        let matchedFp: SymbolFingerprint | null = null;
        let matchedRef: { commit: string; branchHint?: string } | null = null;

        for (const cand of candidateGitRefs) {
          const fp = await extractSymbolFingerprintAtCommitAsync(root, cand.commit, symKey, recorded);
          if (fp && (!recorded.ast_hash || fp.ast_hash === recorded.ast_hash)) {
            matchedFp = fp;
            matchedRef = cand;
            break;
          }
        }

        if (matchedFp && matchedRef) {
          branchVerifiedCount++;
          const branchLabel = await resolveCommitBranchLabelAsync(
            root,
            matchedRef.commit,
            matchedRef.branchHint || memory.created_branch
          );
          resolvedBranchLabel = branchLabel;
          resolvedCommitRef = matchedRef.commit;
          recordOtherBranchCheckAt(
            checks,
            topologyAnchors,
            i,
            symKey,
            recorded,
            matchedFp,
            matchedRef.commit,
            branchLabel,
            currentBranch,
            currentCommit
          );
        }
      }

      if (verifiedCount + branchVerifiedCount === totalSymbols) {
        return await buildResultAsync(
          'OTHER_BRANCH',
          '[置信度: MID (50–80%) · OTHER_BRANCH]',
          false,
          resolvedCommitRef,
          resolvedBranchLabel || 'other-branch',
          branchVerifiedCount
        );
      }
    }

    // Tier 3: True code drift (STALE)
    return await buildResultAsync(
      'STALE',
      '[置信度: LOW (20–50%) · STALE]',
      memory.created_commit === currentCommit,
      memory.created_commit,
      memory.created_branch,
      0
    );
  } finally {
    if (shouldCloseDb && cacheDb) {
      try {
        cacheDb.close();
      } catch {}
      cacheDb = null;
    }
  }
}

export function extractSymbolsFromGitCommit(
  workspaceRoot: string,
  commitSha: string,
  touchedFiles: string[]
): string[] {
  const root = path.resolve(workspaceRoot);
  const targets: string[] = [];

  for (const relFile of touchedFiles) {
    const fullPath = path.join(root, relFile);
    if (!fs.existsSync(fullPath)) continue;

    let raw = '';
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    // Check git diff hunk headers or modified lines for this file in commitSha
    let diffText = '';
    try {
      const diffRes = spawnSync('git', ['show', '--unified=0', commitSha, '--', relFile], {
        cwd: root,
        encoding: 'utf8',
        timeout: 1500,
      });
      if (diffRes.status === 0 && diffRes.stdout) {
        diffText = diffRes.stdout;
      }
    } catch {
      // ignore git diff error
    }

    // Collect top-level functions/classes declared in the current file
    const declRegex =
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|def|fn|func|void|int|uint\d+_t|int\d+_t|bool|char)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm;
    const declaredInFile: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = declRegex.exec(raw)) !== null) {
      const name = match[1];
      if (!CONTROL_KEYWORDS.has(name) && !declaredInFile.includes(name)) {
        declaredInFile.push(name);
      }
    }

    // Prefer a symbol mentioned in the diff, otherwise the first declared symbol in the file
    let chosenSymbol: string | null = null;
    for (const sym of declaredInFile) {
      if (diffText && diffText.includes(sym)) {
        chosenSymbol = sym;
        break;
      }
    }
    if (!chosenSymbol && declaredInFile.length > 0) {
      chosenSymbol = declaredInFile[0];
    }

    if (chosenSymbol) {
      const spec = `${relFile}#${chosenSymbol}`;
      if (extractSymbolFingerprint(root, spec)) {
        targets.push(spec);
        continue;
      }
    }

    targets.push(relFile);
  }

  return targets;
}

export function refreshMemories(
  workspaceRoot: string,
  targetIds?: string[]
): {
  refreshed: string[];
  skippedMissing: Array<{ id: string; missingSymbols: string[] }>;
  unchanged: string[];
} {
  const root = path.resolve(workspaceRoot);
  const storage = new EvoStorage(root);
  storage.ensureInitialized();
  const currentCommit = resolveCurrentGitCommit(root);
  const currentBranch = resolveCurrentGitBranch(root);

  let memories = storage.listMemories();
  if (targetIds && targetIds.length > 0) {
    const filterSet = new Set(targetIds);
    memories = memories.filter((m) => filterSet.has(m.id));
  }

  const refreshed: string[] = [];
  const skippedMissing: Array<{ id: string; missingSymbols: string[] }> = [];
  const unchanged: string[] = [];

  let telemetry: EvoTelemetry | null = null;
  try {
    for (const memory of memories) {
      const targetKeys =
        Object.keys(memory.ast_fingerprints).length > 0
          ? Object.keys(memory.ast_fingerprints)
          : memory.target_symbols;

      const missingSymbols: string[] = [];
      const newFingerprints: Record<string, SymbolFingerprint> = {};

      for (const symKey of targetKeys) {
        const recorded: SymbolFingerprint = memory.ast_fingerprints[symKey] || {
          symbol: symKey,
          file_path: '(unrecorded)',
          kind: 'function',
          start_line: 0,
          end_line: 0,
          signature: symKey,
          ast_hash: '',
        };

        const parsed = parseSymbolTarget(symKey);
        const fastQuery =
          !parsed.fileHint &&
          !parsed.isWholeFile &&
          recorded.file_path &&
          recorded.file_path !== '(unrecorded)'
            ? `${recorded.file_path}#${symKey}`
            : symKey;

        const liveRaw = extractSymbolFingerprint(root, fastQuery);
        if (!liveRaw) {
          missingSymbols.push(symKey);
        } else {
          newFingerprints[symKey] = {
            ...liveRaw,
            symbol: symKey,
          };
        }
      }

      // Safety Guard: If ANY symbol in the memory returns null (truly deleted/missing in the current workspace),
      // do NOT overwrite that memory — push { id: memory.id, missingSymbols } into skippedMissing so genuine
      // symbol deletions are never masked!
      if (missingSymbols.length > 0) {
        skippedMissing.push({ id: memory.id, missingSymbols });
        continue;
      }

      // Only rewrite unchanged-branch memories when created_commit is missing or AST fingerprints drifted/incomplete;
      // advancing HEAD alone must not churn untouched memory files.
      let differs = false;
      if (
        (!memory.created_commit || memory.created_commit === 'uncommitted') &&
        currentCommit &&
        currentCommit !== 'uncommitted'
      ) {
        differs = true;
      }
      if (currentBranch && (memory.created_branch || '') !== currentBranch) differs = true;

      const existingKeys = Object.keys(memory.ast_fingerprints);
      if (existingKeys.length !== targetKeys.length) {
        differs = true;
      } else {
        for (const symKey of targetKeys) {
          const oldFp = memory.ast_fingerprints[symKey];
          const liveFp = newFingerprints[symKey];
          if (
            !oldFp ||
            oldFp.ast_hash !== liveFp.ast_hash ||
            oldFp.start_line !== liveFp.start_line ||
            oldFp.end_line !== liveFp.end_line ||
            oldFp.file_path !== liveFp.file_path ||
            oldFp.signature !== liveFp.signature ||
            oldFp.kind !== liveFp.kind
          ) {
            differs = true;
            break;
          }
        }
      }

      if (differs) {
        memory.ast_fingerprints = newFingerprints;
        memory.created_commit = currentCommit;
        if (currentBranch) {
          memory.created_branch = currentBranch;
        }
        memory.updated_at = new Date().toISOString();
        storage.saveMemory(memory);
        refreshed.push(memory.id);
      } else {
        unchanged.push(memory.id);
      }
    }

    if (refreshed.length > 0) {
      clearMemoryVerificationCache();
      telemetry = new EvoTelemetry(storage);
      telemetry.syncFromDisk();
    }
  } finally {
    if (telemetry) {
      try {
        telemetry.close();
      } catch {}
    }
  }

  return { refreshed, skippedMissing, unchanged };
}

