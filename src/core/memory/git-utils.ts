import { execFile, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function spawnGitAsync(
  cwd: string,
  args: string[],
  timeoutMs: number
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      status: 0,
      stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
      stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
    };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string };
    return {
      status: typeof e.code === 'number' ? e.code : 1,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : '',
    };
  }
}

export const PARSER_VERSION = 2;

export function isRealSubpathOf(rootDir: string, candidatePath: string): boolean {
  try {
    const resolvedRoot = fs.existsSync(rootDir) ? fs.realpathSync(rootDir) : path.resolve(rootDir);
    let targetPath = path.resolve(candidatePath);
    if (fs.existsSync(targetPath)) {
      targetPath = fs.realpathSync(targetPath);
    } else {
      let cur = path.dirname(targetPath);
      const trailing: string[] = [path.basename(targetPath)];
      while (!fs.existsSync(cur)) {
        const parent = path.dirname(cur);
        if (parent === cur) break;
        trailing.unshift(path.basename(cur));
        cur = parent;
      }
      if (fs.existsSync(cur)) {
        targetPath = path.join(fs.realpathSync(cur), ...trailing);
      }
    }
    const rel = path.relative(resolvedRoot, targetPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.kt',
  '.kts',
  '.swift',
  '.rb',
  '.php',
  '.scala',
  '.lua',
  '.zig',
  '.dart',
  '.sh',
  '.ps1',
  '.sql',
]);

export interface GitPaths {
  gitDir: string;
  commonDir: string;
  repoRoot?: string;
}

const gitPathsCache = new Map<string, GitPaths>();

export function clearGitPathsCache(): void {
  gitPathsCache.clear();
}

export function resolveGitPaths(workspaceRoot: string): GitPaths {
  const root = path.resolve(workspaceRoot);
  const cached = gitPathsCache.get(root);
  if (cached) return cached;
  let repoRoot: string | undefined;
  let gitDir = '';
  if (process.env.GIT_DIR) {
    gitDir = path.resolve(root, process.env.GIT_DIR);
    repoRoot = root;
  }

  if (!gitDir) {
    let cur = root;
    while (true) {
      const cand = path.join(cur, '.git');
      if (fs.existsSync(cand)) {
        gitDir = cand;
        repoRoot = cur;
        break;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  if (!gitDir) {
    gitDir = path.join(root, '.git');
  }

  try {
    const stat = fs.statSync(gitDir);
    if (stat.isFile()) {
      const content = fs.readFileSync(gitDir, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/i);
      if (match) {
        gitDir = path.resolve(path.dirname(gitDir), match[1].trim());
      }
    }
  } catch {
    // fallback
  }

  let commonDir = gitDir;
  const commondirFile = path.join(gitDir, 'commondir');
  try {
    if (fs.existsSync(commondirFile)) {
      const relCommon = fs.readFileSync(commondirFile, 'utf8').trim();
      if (relCommon) {
        commonDir = path.resolve(gitDir, relCommon);
      }
    }
  } catch {
    // fallback
  }

  const res = { gitDir, commonDir, repoRoot };
  gitPathsCache.set(root, res);
  return res;
}

interface PackedRefsCache {
  mtimeMs: number;
  size: number;
  refs: Map<string, string>;
}
const packedRefsCache = new Map<string, PackedRefsCache>();

export interface GitHeadSnapshot {
  commit: string;
  fullCommit: string;
  branch?: string;
}

function readGitHeadRefFromFiles(workspaceRoot: string): {
  hasHeadFile: boolean;
  branch?: string;
  fullCommit: string;
} {
  const root = path.resolve(workspaceRoot);
  const { gitDir, commonDir } = resolveGitPaths(root);
  const headFile = path.join(gitDir, 'HEAD');
  if (!fs.existsSync(headFile)) {
    return { hasHeadFile: false, fullCommit: '' };
  }

  let headContent = '';
  try {
    headContent = fs.readFileSync(headFile, 'utf8').trim();
  } catch {
    return { hasHeadFile: false, fullCommit: '' };
  }

  let branch: string | undefined;
  let fullCommit = '';

  const refPrefix = 'ref: ';
  if (headContent.startsWith(refPrefix)) {
    const refPath = headContent.slice(refPrefix.length).trim();
    if (refPath.startsWith('refs/heads/')) {
      branch = refPath.slice('refs/heads/'.length);
    } else {
      branch = refPath;
    }

    // 1. Check loose ref in commonDir / gitDir
    const looseRefCommon = path.join(commonDir, refPath);
    const looseRefGit = path.join(gitDir, refPath);
    if (fs.existsSync(looseRefCommon)) {
      try {
        fullCommit = fs.readFileSync(looseRefCommon, 'utf8').trim();
      } catch {}
    } else if (fs.existsSync(looseRefGit)) {
      try {
        fullCommit = fs.readFileSync(looseRefGit, 'utf8').trim();
      } catch {}
    }

    // 2. Check packed-refs in commonDir (cached by mtimeMs and size)
    if (!fullCommit) {
      const packedRefsPath = path.join(commonDir, 'packed-refs');
      try {
        if (fs.existsSync(packedRefsPath)) {
          const stat = fs.statSync(packedRefsPath);
          let cached = packedRefsCache.get(commonDir);
          if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
            const lines = fs.readFileSync(packedRefsPath, 'utf8').split(/\r?\n/);
            const refMap = new Map<string, string>();
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;
              const spaceIdx = trimmed.indexOf(' ');
              if (spaceIdx !== -1) {
                const sha = trimmed.slice(0, spaceIdx).trim();
                const ref = trimmed.slice(spaceIdx + 1).trim();
                refMap.set(ref, sha);
              }
            }
            cached = { mtimeMs: stat.mtimeMs, size: stat.size, refs: refMap };
            packedRefsCache.set(commonDir, cached);
          }
          fullCommit = cached.refs.get(refPath) || '';
        }
      } catch {}
    }
  } else if (/^[0-9a-f]{40,64}$/i.test(headContent)) {
    // Detached HEAD
    fullCommit = headContent;
  }

  return { hasHeadFile: true, branch, fullCommit };
}

export function readGitHeadSnapshot(workspaceRoot: string): GitHeadSnapshot {
  const { hasHeadFile, branch, fullCommit: fileCommit } = readGitHeadRefFromFiles(workspaceRoot);
  if (!hasHeadFile) {
    return { commit: 'uncommitted', fullCommit: 'uncommitted' };
  }

  let fullCommit = fileCommit;
  // 3. Fallback: if Git 2.45+ reftable exists or ref not resolved
  if (!fullCommit) {
    try {
      const res = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 1000,
      });
      if (res.status === 0 && res.stdout) {
        fullCommit = res.stdout.trim();
      }
    } catch {}
  }

  if (!fullCommit) {
    return { commit: 'uncommitted', fullCommit: 'uncommitted', branch };
  }

  return {
    commit: fullCommit.slice(0, 7),
    fullCommit,
    branch,
  };
}

export async function readGitHeadSnapshotAsync(workspaceRoot: string): Promise<GitHeadSnapshot> {
  const { hasHeadFile, branch, fullCommit: fileCommit } = readGitHeadRefFromFiles(workspaceRoot);
  if (!hasHeadFile) {
    return { commit: 'uncommitted', fullCommit: 'uncommitted' };
  }

  let fullCommit = fileCommit;
  // 3. Fallback: if Git 2.45+ reftable exists or ref not resolved
  if (!fullCommit) {
    const res = await spawnGitAsync(workspaceRoot, ['rev-parse', 'HEAD'], 1000);
    if (res.status === 0 && res.stdout) {
      fullCommit = res.stdout.trim();
    }
  }

  if (!fullCommit) {
    return { commit: 'uncommitted', fullCommit: 'uncommitted', branch };
  }

  return {
    commit: fullCommit.slice(0, 7),
    fullCommit,
    branch,
  };
}

export function resolveCurrentGitCommit(workspaceRoot: string): string {
  try {
    const snap = readGitHeadSnapshot(workspaceRoot);
    if (snap.commit && snap.commit !== 'uncommitted') {
      return snap.commit;
    }
  } catch {}
  return 'uncommitted';
}

export function resolveCurrentGitBranch(workspaceRoot: string): string | undefined {
  try {
    const snap = readGitHeadSnapshot(workspaceRoot);
    if (snap.branch && snap.branch !== 'HEAD') {
      return snap.branch;
    }
  } catch {}
  return undefined;
}

export function safeRealpathNative(targetPath: string): string {
  try {
    return typeof fs.realpathSync.native === 'function'
      ? fs.realpathSync.native(targetPath)
      : fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isValidCommitSha(commitSha: string): boolean {
  return Boolean(commitSha && commitSha !== 'uncommitted' && /^[0-9a-f]{4,40}$/i.test(commitSha.trim()));
}

export function isGitCommitPresent(workspaceRoot: string, commitSha: string): boolean {
  if (!isValidCommitSha(commitSha)) {
    return false;
  }
  try {
    const res = spawnSync('git', ['cat-file', '-e', `${commitSha.trim()}^{commit}`], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

export async function isGitCommitPresentAsync(workspaceRoot: string, commitSha: string): Promise<boolean> {
  if (!isValidCommitSha(commitSha)) {
    return false;
  }
  const res = await spawnGitAsync(workspaceRoot, ['cat-file', '-e', `${commitSha.trim()}^{commit}`], 1500);
  return res.status === 0;
}

function normalizeBranchRef(branchName?: string): string | undefined {
  const clean = (branchName || '').trim();
  if (!clean || clean === 'HEAD' || clean.includes('..') || clean.startsWith('-')) {
    return undefined;
  }
  return clean;
}

export function resolveGitBranchCommit(workspaceRoot: string, branchName?: string): string | undefined {
  const clean = normalizeBranchRef(branchName);
  if (!clean) return undefined;
  try {
    const res = spawnSync('git', ['rev-parse', '--verify', '--short=12', `${clean}^{commit}`], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    if (res.status === 0 && res.stdout && res.stdout.trim()) {
      return res.stdout.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function resolveGitBranchCommitAsync(
  workspaceRoot: string,
  branchName?: string
): Promise<string | undefined> {
  const clean = normalizeBranchRef(branchName);
  if (!clean) return undefined;
  const res = await spawnGitAsync(
    workspaceRoot,
    ['rev-parse', '--verify', '--short=12', `${clean}^{commit}`],
    1500
  );
  if (res.status === 0 && res.stdout && res.stdout.trim()) {
    return res.stdout.trim();
  }
  return undefined;
}

export function isGitAncestorOfHead(workspaceRoot: string, commitSha: string): boolean {
  try {
    const res = spawnSync('git', ['merge-base', '--is-ancestor', commitSha.trim(), 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

export async function isGitAncestorOfHeadAsync(workspaceRoot: string, commitSha: string): Promise<boolean> {
  const res = await spawnGitAsync(workspaceRoot, ['merge-base', '--is-ancestor', commitSha.trim(), 'HEAD'], 1500);
  return res.status === 0;
}

function parseBranchContainsFirstMatch(stdout: string): string | undefined {
  const branches = stdout
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith('(') && b !== 'HEAD');
  return branches.length > 0 ? branches[0] : undefined;
}

export function resolveCommitBranchLabel(
  workspaceRoot: string,
  commitSha: string,
  recordedBranch?: string
): string {
  if (recordedBranch && recordedBranch.trim() && recordedBranch.trim() !== 'HEAD') {
    return recordedBranch.trim();
  }
  try {
    const res = spawnSync(
      'git',
      ['branch', '--contains', commitSha.trim(), '--format=%(refname:short)'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 1500,
      }
    );
    if (res.status === 0 && res.stdout) {
      const first = parseBranchContainsFirstMatch(res.stdout);
      if (first) return first;
    }
  } catch {
    // ignore git branch resolution errors
  }
  return 'other-branch';
}

export async function resolveCommitBranchLabelAsync(
  workspaceRoot: string,
  commitSha: string,
  recordedBranch?: string
): Promise<string> {
  if (recordedBranch && recordedBranch.trim() && recordedBranch.trim() !== 'HEAD') {
    return recordedBranch.trim();
  }
  const res = await spawnGitAsync(
    workspaceRoot,
    ['branch', '--contains', commitSha.trim(), '--format=%(refname:short)'],
    1500
  );
  if (res.status === 0 && res.stdout) {
    const first = parseBranchContainsFirstMatch(res.stdout);
    if (first) return first;
  }
  return 'other-branch';
}

function parseDescendantBranchRefsOutput(
  stdout: string,
  baseCommit: string,
  currentCommit: string,
  limit: number
): Array<{ commit: string; branch: string }> {
  const discovered: Array<{ commit: string; branch: string }> = [];
  const seenCommits = new Set<string>();
  const cleanBase = baseCommit.trim();
  const cleanCurrent = (currentCommit || '').trim();

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (discovered.length >= limit) break;
    const line = rawLine.trim();
    if (!line) continue;
    const sepIdx = line.indexOf('|');
    if (sepIdx === -1) continue;
    const sha = line.slice(0, sepIdx).trim();
    const branch = line.slice(sepIdx + 1).trim();
    if (!sha || !branch || branch === 'HEAD' || branch.endsWith('/HEAD')) continue;
    if (
      (cleanCurrent && (sha.startsWith(cleanCurrent) || cleanCurrent.startsWith(sha))) ||
      (cleanBase && (sha.startsWith(cleanBase) || cleanBase.startsWith(sha)))
    ) {
      continue;
    }
    if (seenCommits.has(sha)) continue;
    seenCommits.add(sha);
    discovered.push({ commit: sha, branch });
  }
  return discovered;
}

export function discoverDescendantBranchRefs(
  workspaceRoot: string,
  baseCommit: string,
  currentCommit: string,
  limit = 8
): Array<{ commit: string; branch: string }> {
  if (!isGitCommitPresent(workspaceRoot, baseCommit)) return [];
  try {
    const res = spawnSync(
      'git',
      [
        'for-each-ref',
        '--contains',
        baseCommit.trim(),
        '--sort=-committerdate',
        '--format=%(objectname:short=12)|%(refname:short)',
        'refs/heads',
        'refs/remotes',
      ],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 2000,
      }
    );
    if (res.status !== 0 || !res.stdout) return [];
    return parseDescendantBranchRefsOutput(res.stdout, baseCommit, currentCommit, limit);
  } catch {
    return [];
  }
}

export async function discoverDescendantBranchRefsAsync(
  workspaceRoot: string,
  baseCommit: string,
  currentCommit: string,
  limit = 8
): Promise<Array<{ commit: string; branch: string }>> {
  if (!(await isGitCommitPresentAsync(workspaceRoot, baseCommit))) return [];
  const res = await spawnGitAsync(
    workspaceRoot,
    [
      'for-each-ref',
      '--contains',
      baseCommit.trim(),
      '--sort=-committerdate',
      '--format=%(objectname:short=12)|%(refname:short)',
      'refs/heads',
      'refs/remotes',
    ],
    2000
  );
  if (res.status !== 0 || !res.stdout) return [];
  return parseDescendantBranchRefsOutput(res.stdout, baseCommit, currentCommit, limit);
}
