import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface WorkspaceRollbackSnapshot {
  sig: Map<string, string>;
  contents: Map<string, Buffer>;
  dirs: Set<string>;
  gitDirtyFiles: Set<string>;
  symlinks?: Map<string, string>;
}

function computeFileMutationSig(fullPath: string, stat: fs.Stats): string {
  const base = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  if (stat.size <= 64 * 1024) {
    try {
      const buf = fs.readFileSync(fullPath);
      const digest = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
      return `${base}:${digest}`;
    } catch {
      return base;
    }
  }
  return base;
}

export function captureWorkspaceMutationSignature(rootDir: string, maxFiles = 10000): Map<string, string> {
  const sigMap = new Map<string, string>();
  if (!rootDir || !fs.existsSync(rootDir)) {
    return sigMap;
  }

  const ignoredDirNames = new Set(['.git', 'node_modules', '.codegraph', 'dist', 'build']);
  let fileCount = 0;
  let hitLimit = false;

  function walk(currentDir: string, depth: number) {
    if (depth > 12 || fileCount >= maxFiles) {
      hitLimit = true;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (fileCount >= maxFiles) {
        hitLimit = true;
        break;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isSymbolicLink()) {
        if (ignoredDirNames.has(entry.name)) {
          continue;
        }
        if (relPath === '.evo/.cache' || relPath.startsWith('.evo/.cache/')) {
          continue;
        }
        try {
          const target = fs.readlinkSync(fullPath);
          sigMap.set(relPath, `SYMLINK:${target}`);
          fileCount++;
        } catch {
          // ignore inaccessible symlinks
        }
      } else if (entry.isDirectory()) {
        if (ignoredDirNames.has(entry.name)) {
          continue;
        }
        if (relPath === '.evo/.cache' || relPath.startsWith('.evo/.cache/')) {
          continue;
        }
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (relPath.startsWith('.evo/.cache/')) {
          continue;
        }
        try {
          const stat = fs.statSync(fullPath);
          sigMap.set(relPath, computeFileMutationSig(fullPath, stat));
          fileCount++;
        } catch {
          // ignore inaccessible files
        }
      }
    }
  }

  walk(path.resolve(rootDir), 0);

  if (hitLimit) {
    try {
      const gitRes = spawnSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 3000,
      });
      if (gitRes && gitRes.stdout) {
        const lines = gitRes.stdout.split(/\r?\n/);
        for (const l of lines) {
          if (!l.trim()) continue;
          const status = l.slice(0, 2).trim();
          let rel = l.slice(3).trim();
          if (rel.includes(' -> ')) rel = rel.split(' -> ').pop()!.trim();
          if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
          rel = rel.replace(/\\/g, '/');
          if (!rel) continue;
          if (rel === '.evo/.cache' || rel.startsWith('.evo/.cache/')) continue;
          const fullPath = path.join(rootDir, rel);
          try {
            const lstat = fs.lstatSync(fullPath);
            if (lstat.isSymbolicLink()) {
              sigMap.set(rel, `SYMLINK:${fs.readlinkSync(fullPath)}`);
            } else {
              sigMap.set(rel, computeFileMutationSig(fullPath, lstat));
            }
          } catch {
            sigMap.set(rel, `GIT_STATUS:${status}`);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return sigMap;
}

export function captureWorkspaceRollbackSnapshot(
  rootDir: string,
  maxFiles = 10000
): WorkspaceRollbackSnapshot {
  const sig = new Map<string, string>();
  const contents = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const gitDirtyFiles = new Set<string>();
  const gitDirtyStatuses = new Map<string, string>();
  const symlinks = new Map<string, string>();

  if (!rootDir || !fs.existsSync(rootDir)) {
    return { sig, contents, dirs, gitDirtyFiles, symlinks };
  }

  try {
    const gitRes = spawnSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 3000,
    });
    if (gitRes && gitRes.stdout) {
      const lines = gitRes.stdout.split(/\r?\n/);
      for (const l of lines) {
        if (!l.trim()) continue;
        const status = l.slice(0, 2).trim();
        let rel = l.slice(3).trim();
        if (rel.includes(' -> ')) rel = rel.split(' -> ').pop()!.trim();
        if (rel.startsWith('"') && rel.endsWith('"')) rel = rel.slice(1, -1);
        rel = rel.replace(/\\/g, '/');
        if (!rel || rel === '.evo/.cache' || rel.startsWith('.evo/.cache/')) continue;
        const fullDirtyPath = path.join(rootDir, rel);
        let dirtyExists = false;
        try {
          fs.lstatSync(fullDirtyPath);
          dirtyExists = true;
        } catch {
          dirtyExists = false;
        }
        if (dirtyExists) {
          gitDirtyFiles.add(rel);
        } else {
          sig.set(rel, `GIT_STATUS:${status}`);
        }
        gitDirtyStatuses.set(rel, status);
      }
    }
  } catch {
    // ignore
  }

  const ignoredDirNames = new Set(['.git', 'node_modules', '.codegraph', 'dist', 'build']);
  let fileCount = 0;
  let hitLimit = false;
  const MAX_FILE_SIZE_FOR_CONTENT = 2 * 1024 * 1024; // 2MB
  const TOTAL_CONTENT_BUDGET = 64 * 1024 * 1024; // 64MB
  let totalContentBytes = 0;

  function walk(currentDir: string, depth: number) {
    if (depth > 12 || fileCount >= maxFiles) {
      hitLimit = true;
      return;
    }

    const currentRel = path.relative(rootDir, currentDir).replace(/\\/g, '/');
    if (currentRel && currentRel !== '.') {
      dirs.add(currentRel);
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (fileCount >= maxFiles) {
        hitLimit = true;
        break;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isSymbolicLink()) {
        if (ignoredDirNames.has(entry.name)) {
          continue;
        }
        if (relPath === '.evo/.cache' || relPath.startsWith('.evo/.cache/')) {
          continue;
        }
        try {
          const target = fs.readlinkSync(fullPath);
          sig.set(relPath, `SYMLINK:${target}`);
          symlinks.set(relPath, target);
          fileCount++;
        } catch {
          // ignore inaccessible symlinks
        }
      } else if (entry.isDirectory()) {
        if (ignoredDirNames.has(entry.name)) {
          continue;
        }
        if (relPath === '.evo/.cache' || relPath.startsWith('.evo/.cache/')) {
          continue;
        }
        dirs.add(relPath);
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (relPath.startsWith('.evo/.cache/')) {
          continue;
        }
        try {
          const stat = fs.statSync(fullPath);
          sig.set(relPath, computeFileMutationSig(fullPath, stat));
          fileCount++;

          const isDirty = gitDirtyFiles.has(relPath);
          if (
            (isDirty && stat.size <= 32 * 1024 * 1024) ||
            (stat.size <= MAX_FILE_SIZE_FOR_CONTENT &&
              totalContentBytes + stat.size <= TOTAL_CONTENT_BUDGET)
          ) {
            const buf = fs.readFileSync(fullPath);
            contents.set(relPath, buf);
            totalContentBytes += buf.length;
          }
        } catch {
          // ignore inaccessible files
        }
      }
    }
  }

  walk(path.resolve(rootDir), 0);

  if (hitLimit) {
    for (const [rel, status] of gitDirtyStatuses.entries()) {
      if (sig.has(rel)) continue;
      let parentRel = path.dirname(rel).replace(/\\/g, '/');
      while (parentRel && parentRel !== '.' && parentRel !== '') {
        dirs.add(parentRel);
        const nextParent = path.dirname(parentRel).replace(/\\/g, '/');
        if (nextParent === parentRel) break;
        parentRel = nextParent;
      }
      const fullPath = path.join(rootDir, rel);
      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) {
          const target = fs.readlinkSync(fullPath);
          sig.set(rel, `SYMLINK:${target}`);
          symlinks.set(rel, target);
        } else if (lstat.isFile()) {
          sig.set(rel, computeFileMutationSig(fullPath, lstat));
          if (lstat.size <= 32 * 1024 * 1024) {
            const buf = fs.readFileSync(fullPath);
            contents.set(rel, buf);
            totalContentBytes += buf.length;
          }
        }
      } catch {
        sig.set(rel, `GIT_STATUS:${status}`);
      }
    }
  }

  return { sig, contents, dirs, gitDirtyFiles, symlinks };
}

function createSymlinkSafe(
  origTarget: string,
  fullMutatedPath: string,
  targetCheckBaseDir: string = path.dirname(fullMutatedPath)
): void {
  if (process.platform === 'win32') {
    const absTarget = path.resolve(targetCheckBaseDir, origTarget);
    try {
      if (fs.existsSync(absTarget) && fs.statSync(absTarget).isDirectory()) {
        fs.symlinkSync(origTarget, fullMutatedPath, 'junction');
        return;
      }
    } catch {
      // fall back to default symlinkSync
    }
  }
  fs.symlinkSync(origTarget, fullMutatedPath);
}

export function restoreWorkspaceFromSnapshot(
  rootDir: string,
  preSnapshot: WorkspaceRollbackSnapshot,
  postWorkspaceSig: Map<string, string> = captureWorkspaceMutationSignature(rootDir)
): { mutatedFiles: string[]; restoredFiles: string[] } {
  const mutatedFiles: string[] = [];
  const restoredFiles: string[] = [];

  for (const [filePath, sig] of postWorkspaceSig.entries()) {
    const beforeSig = preSnapshot.sig.get(filePath);
    if (beforeSig === undefined) {
      if (preSnapshot.gitDirtyFiles.has(filePath)) {
        continue;
      }
      mutatedFiles.push(filePath);
      const fullMutatedPath = path.join(rootDir, filePath);
      try {
        fs.lstatSync(fullMutatedPath);
        fs.unlinkSync(fullMutatedPath);
        restoredFiles.push(filePath);
      } catch {
        // best-effort cleanup
      }
      let parentRel = path.dirname(filePath).replace(/\\/g, '/');
      while (parentRel && parentRel !== '.' && parentRel !== '') {
        if (preSnapshot.dirs.has(parentRel)) {
          break;
        }
        const fullParent = path.join(rootDir, parentRel);
        try {
          if (fs.existsSync(fullParent) && fs.readdirSync(fullParent).length === 0) {
            fs.rmdirSync(fullParent);
            const nextParent = path.dirname(parentRel).replace(/\\/g, '/');
            if (nextParent === parentRel) break;
            parentRel = nextParent;
          } else {
            break;
          }
        } catch {
          break;
        }
      }
    } else if (beforeSig !== sig) {
      mutatedFiles.push(filePath);
      const fullMutatedPath = path.join(rootDir, filePath);
      if (beforeSig.startsWith('SYMLINK:') || preSnapshot.symlinks?.has(filePath)) {
        const origTarget = preSnapshot.symlinks?.get(filePath) ?? beforeSig.slice('SYMLINK:'.length);
        try {
          try {
            fs.lstatSync(fullMutatedPath);
            fs.unlinkSync(fullMutatedPath);
          } catch {}
          fs.mkdirSync(path.dirname(fullMutatedPath), { recursive: true });
          createSymlinkSafe(origTarget, fullMutatedPath);
          restoredFiles.push(filePath);
        } catch {
          // best-effort symlink restore
        }
      } else if (beforeSig.startsWith('GIT_STATUS:')) {
        try {
          fs.lstatSync(fullMutatedPath);
          fs.unlinkSync(fullMutatedPath);
          restoredFiles.push(filePath);
        } catch {}
      } else if (preSnapshot.contents.has(filePath)) {
        try {
          if (sig.startsWith('SYMLINK:')) {
            try { fs.unlinkSync(fullMutatedPath); } catch {}
          }
          fs.mkdirSync(path.dirname(fullMutatedPath), { recursive: true });
          fs.writeFileSync(fullMutatedPath, preSnapshot.contents.get(filePath)!);
          restoredFiles.push(filePath);
        } catch {}
      } else if (!preSnapshot.gitDirtyFiles.has(filePath)) {
        try {
          if (sig.startsWith('SYMLINK:')) {
            try { fs.unlinkSync(fullMutatedPath); } catch {}
          }
          const gitRes = spawnSync('git', ['checkout', '--', filePath], { cwd: rootDir });
          if (gitRes.status === 0) {
            restoredFiles.push(filePath);
          }
        } catch {}
      }
    }
  }

  for (const [filePath, beforeSig] of preSnapshot.sig.entries()) {
    if (!postWorkspaceSig.has(filePath)) {
      if (beforeSig.startsWith('GIT_STATUS:')) {
        continue;
      }
      const fullMutatedPath = path.join(rootDir, filePath);
      try {
        const lstat = fs.lstatSync(fullMutatedPath);
        if (beforeSig.startsWith('SYMLINK:')) {
          if (lstat.isSymbolicLink() && `SYMLINK:${fs.readlinkSync(fullMutatedPath)}` === beforeSig) {
            continue;
          }
        } else if (lstat.isFile() && computeFileMutationSig(fullMutatedPath, lstat) === beforeSig) {
          continue;
        }
      } catch {}
      mutatedFiles.push(filePath);
      if (beforeSig.startsWith('SYMLINK:') || preSnapshot.symlinks?.has(filePath)) {
        const origTarget = preSnapshot.symlinks?.get(filePath) ?? beforeSig.slice('SYMLINK:'.length);
        try {
          try {
            fs.lstatSync(fullMutatedPath);
            fs.unlinkSync(fullMutatedPath);
          } catch {}
          fs.mkdirSync(path.dirname(fullMutatedPath), { recursive: true });
          createSymlinkSafe(origTarget, fullMutatedPath);
          restoredFiles.push(filePath);
        } catch {}
      } else if (preSnapshot.contents.has(filePath)) {
        try {
          fs.mkdirSync(path.dirname(fullMutatedPath), { recursive: true });
          fs.writeFileSync(fullMutatedPath, preSnapshot.contents.get(filePath)!);
          restoredFiles.push(filePath);
        } catch {}
      } else if (!preSnapshot.gitDirtyFiles.has(filePath)) {
        try {
          const gitRes = spawnSync('git', ['checkout', '--', filePath], { cwd: rootDir });
          if (gitRes.status === 0) {
            restoredFiles.push(filePath);
          }
        } catch {}
      }
    }
  }

  return { mutatedFiles, restoredFiles };
}

export function prepareEphemeralSelfTestWorkspace(
  realRootDir: string,
  stageRootDir?: string
): {
  staged: boolean;
  stageDir?: string;
  preSnapshot: WorkspaceRollbackSnapshot;
  realPreSnapshot?: WorkspaceRollbackSnapshot;
} {
  if (!realRootDir || !fs.existsSync(realRootDir)) {
    return {
      staged: false,
      preSnapshot: captureWorkspaceRollbackSnapshot(realRootDir),
    };
  }

  const MAX_STAGE_FILES = 1500;
  const MAX_STAGE_BYTES = 32 * 1024 * 1024;
  const MAX_STAGE_GIT_BYTES = 8 * 1024 * 1024;
  const MAX_GIT_FILES = 2000;
  const resolvedRoot = path.resolve(realRootDir);
  const ignoredDirNames = new Set(['node_modules', 'dist', 'build', '.codegraph']);

  const files: Array<{ relPath: string; fullPath: string }> = [];
  const dirs: string[] = [];
  const symlinks: Array<{ relPath: string; target: string; origDir: string }> = [];
  const gitFiles: Array<{ relPath: string; fullPath: string }> = [];
  const gitDirs: string[] = [];
  let fileCount = 0;
  let totalBytes = 0;
  let gitBytes = 0;
  let exceeded = false;

  function walkWorkspace(currentDir: string, depth: number) {
    if (exceeded || depth > 12) {
      if (depth > 12) exceeded = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (exceeded) break;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');

      if (entry.isSymbolicLink()) {
        if (entry.name === '.git' || ignoredDirNames.has(entry.name)) continue;
        if (relPath === '.evo/.cache' || relPath.startsWith('.evo/.cache/')) continue;
        fileCount++;
        if (fileCount > MAX_STAGE_FILES) {
          exceeded = true;
          return;
        }
        try {
          const target = fs.readlinkSync(fullPath);
          symlinks.push({ relPath, target, origDir: path.dirname(fullPath) });
        } catch {
          // ignore inaccessible symlinks
        }
      } else if (entry.isDirectory()) {
        if (entry.name === '.git' || ignoredDirNames.has(entry.name)) continue;
        if (relPath === '.evo/.cache' || relPath.startsWith('.evo/.cache/')) continue;
        dirs.push(relPath);
        walkWorkspace(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (relPath.startsWith('.evo/.cache/')) continue;
        try {
          const stat = fs.statSync(fullPath);
          fileCount++;
          totalBytes += stat.size;
          if (fileCount > MAX_STAGE_FILES || totalBytes > MAX_STAGE_BYTES) {
            exceeded = true;
            return;
          }
          files.push({ relPath, fullPath });
        } catch {
          // ignore inaccessible files
        }
      }
    }
  }

  function walkGitDir(currentDir: string, depth: number) {
    if (exceeded || depth > 12) {
      if (depth > 12) exceeded = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (exceeded) break;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
      if (relPath === '.git/objects/pack' || relPath.startsWith('.git/objects/pack/')) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        continue;
      } else if (entry.isDirectory()) {
        gitDirs.push(relPath);
        walkGitDir(fullPath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          gitBytes += stat.size;
          if (gitBytes > MAX_STAGE_GIT_BYTES || gitFiles.length >= MAX_GIT_FILES) {
            exceeded = true;
            return;
          }
          gitFiles.push({ relPath, fullPath });
        } catch {
          // ignore
        }
      }
    }
  }

  walkWorkspace(resolvedRoot, 0);

  if (!exceeded) {
    const dotGitPath = path.join(resolvedRoot, '.git');
    try {
      if (fs.existsSync(dotGitPath)) {
        const gitLstat = fs.lstatSync(dotGitPath);
        if (gitLstat.isFile()) {
          if (gitLstat.size > MAX_STAGE_GIT_BYTES) {
            exceeded = true;
          } else {
            gitBytes += gitLstat.size;
            gitFiles.push({ relPath: '.git', fullPath: dotGitPath });
          }
        } else if (gitLstat.isDirectory()) {
          gitDirs.push('.git');
          walkGitDir(dotGitPath, 0);
        }
      }
    } catch {
      // ignore .git stat failure
    }
  }

  if (exceeded) {
    return {
      staged: false,
      preSnapshot: captureWorkspaceRollbackSnapshot(resolvedRoot),
    };
  }

  const stageDir = stageRootDir
    ? path.join(stageRootDir, 'ws')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'evo-stage-'));
  fs.mkdirSync(stageDir, { recursive: true });

  for (const d of dirs) {
    fs.mkdirSync(path.join(stageDir, d), { recursive: true });
  }
  for (const d of gitDirs) {
    fs.mkdirSync(path.join(stageDir, d), { recursive: true });
  }
  for (const f of files) {
    const dest = path.join(stageDir, f.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.fullPath, dest);
  }
  for (const f of gitFiles) {
    const dest = path.join(stageDir, f.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.fullPath, dest);
  }
  for (const sl of symlinks) {
    const dest = path.join(stageDir, sl.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      createSymlinkSafe(sl.target, dest, sl.origDir);
    } catch {
      // On Windows without Developer Mode, file symlinks may fail with EPERM
    }
  }

  const preSnapshot = captureWorkspaceRollbackSnapshot(stageDir);
  const realPreSnapshot = captureWorkspaceRollbackSnapshot(resolvedRoot);
  return {
    staged: true,
    stageDir,
    preSnapshot,
    realPreSnapshot,
  };
}
