import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_EVO_CONFIG,
  EvoStorage,
  estimateTokens,
  hasValidEvoStructure,
  resolveGlobalFallbackDir,
} from './storage.js';
import {
  PROFILE_MARKER_END,
  PROFILE_MARKER_START,
  renderUserProfileBlock,
} from '../templates/meta-rule.js';

export const WINDSURF_PROFILE_MAX_CHARS = 6000;

export interface ProfileTargetDescriptor {
  host: string;
  path: string;
}

export interface ProfileTargetResult {
  host: string;
  path: string;
  status: 'updated' | 'unchanged' | 'removed' | 'skipped';
}

export interface ProfileSyncOptions {
  dryRun?: boolean;
  targetFiles?: string[];
  homeDir?: string;
}

export interface ProfileSyncResult {
  digestPath: string;
  totalTokens: number;
  maxTokens: number;
  menuTokens?: number;
  maxMenuTokens?: number;
  updatedTargets: string[];
  targets: ProfileTargetResult[];
}

export interface ProfileCleanResult {
  digestPath: string;
  updatedTargets: string[];
  targets: ProfileTargetResult[];
}

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

export function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  const homeReal = safeRealpath(os.homedir()).toLowerCase();
  const tmpReal = safeRealpath(os.tmpdir()).toLowerCase();
  while (true) {
    const currentReal = safeRealpath(current).toLowerCase();
    if (currentReal === homeReal || currentReal === tmpReal) {
      return null;
    }
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

type PairedProfileMarkers =
  | { status: 'none' }
  | { status: 'malformed' }
  | { status: 'paired'; startIdx: number; endIdx: number };

function findPairedProfileMarkers(content: string): PairedProfileMarkers {
  const startIdx = content.indexOf(PROFILE_MARKER_START);
  const firstEndIdx = content.indexOf(PROFILE_MARKER_END);
  if (startIdx === -1 && firstEndIdx === -1) {
    return { status: 'none' };
  }
  if (startIdx === -1 || (firstEndIdx !== -1 && firstEndIdx < startIdx)) {
    return { status: 'malformed' };
  }
  const searchFrom = startIdx + PROFILE_MARKER_START.length;
  const closingEndIdx = content.indexOf(PROFILE_MARKER_END, searchFrom);
  if (closingEndIdx === -1) {
    return { status: 'malformed' };
  }
  const nestedStartIdx = content.indexOf(PROFILE_MARKER_START, searchFrom);
  if (nestedStartIdx !== -1 && nestedStartIdx < closingEndIdx) {
    return { status: 'malformed' };
  }
  return { status: 'paired', startIdx, endIdx: closingEndIdx };
}

export function upsertProfileBlock(existingContent: string, profileBlock: string): string {
  const markers = findPairedProfileMarkers(existingContent);
  if (markers.status === 'malformed') {
    return existingContent;
  }
  if (markers.status === 'paired') {
    const before = existingContent.slice(0, markers.startIdx).trimEnd();
    const after = existingContent.slice(markers.endIdx + PROFILE_MARKER_END.length).trimStart();
    return [before, profileBlock.trim(), after].filter(Boolean).join('\n\n') + '\n';
  }
  if (!existingContent.trim()) {
    return profileBlock.trim() + '\n';
  }
  return existingContent.trimEnd() + '\n\n' + profileBlock.trim() + '\n';
}

export function removeProfileBlock(existingContent: string): string {
  const markers = findPairedProfileMarkers(existingContent);
  if (markers.status !== 'paired') {
    return existingContent;
  }
  const before = existingContent.slice(0, markers.startIdx).trimEnd();
  const after = existingContent.slice(markers.endIdx + PROFILE_MARKER_END.length).trimStart();
  const combined = [before, after].filter(Boolean).join('\n\n');
  return combined ? combined + '\n' : '';
}

export function truncateProfileBlockForWindsurf(
  profileBlock: string,
  maxChars: number = WINDSURF_PROFILE_MAX_CHARS
): string {
  const trimmed = profileBlock.trim();
  if (!trimmed) {
    return profileBlock;
  }
  if (profileBlock.length <= maxChars) {
    return profileBlock;
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const minEmptyMarkers = `${PROFILE_MARKER_START}\n${PROFILE_MARKER_END}`;
  if (maxChars < minEmptyMarkers.length) {
    return '';
  }
  const suffix = `\n...(truncated to fit ${maxChars}-char limit)\n${PROFILE_MARKER_END}\n`;
  const available = maxChars - suffix.length;
  if (available < PROFILE_MARKER_START.length) {
    const withNewline = `${minEmptyMarkers}\n`;
    return withNewline.length <= maxChars ? withNewline : minEmptyMarkers;
  }
  let head = trimmed.slice(0, available);
  const lastNewline = head.lastIndexOf('\n');
  if (lastNewline > PROFILE_MARKER_START.length + 20) {
    head = head.slice(0, lastNewline);
  }
  return `${head.trimEnd()}${suffix}`;
}

export function computeEffectiveProfileBlockForTarget(
  target: ProfileTargetDescriptor,
  profileBlock: string,
  existingContent: string = ''
): string {
  if (!profileBlock.trim()) {
    return '';
  }
  if (!isWindsurfTarget(target.host, target.path)) {
    return profileBlock;
  }
  const markers = findPairedProfileMarkers(existingContent);
  if (markers.status === 'malformed') {
    return profileBlock;
  }
  let overhead: number;
  if (markers.status === 'paired') {
    const before = existingContent.slice(0, markers.startIdx).trimEnd();
    const after = existingContent.slice(markers.endIdx + PROFILE_MARKER_END.length).trimStart();
    overhead = (before ? before.length + 2 : 0) + (after ? after.length + 2 : 0) + 1;
  } else {
    const trimmedExisting = existingContent.trimEnd();
    overhead = trimmedExisting ? trimmedExisting.length + 3 : 1;
  }
  const available = Math.max(0, WINDSURF_PROFILE_MAX_CHARS - overhead);
  return truncateProfileBlockForWindsurf(profileBlock, available);
}

function inferHostFromTargetPath(targetPath: string): string {
  const norm = targetPath.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/.claude/')) return 'claude';
  if (norm.includes('/.gemini/')) return 'gemini';
  if (norm.includes('/.codex/')) return 'codex';
  if (norm.includes('/.codeium/windsurf/') || norm.includes('/.windsurf/')) return 'windsurf';
  if (norm.includes('/.cursor/')) return 'cursor';
  if (norm.includes('/.cline/')) return 'cline';
  if (norm.includes('/.roo/')) return 'roo';
  if (norm.includes('/opencode/')) return 'opencode';
  if (norm.endsWith('/user_profile.md')) return 'isolated';
  return 'custom';
}

function isWindsurfTarget(host: string, targetPath: string): boolean {
  if (host === 'windsurf') return true;
  const norm = targetPath.replace(/\\/g, '/').toLowerCase();
  return norm.includes('/.codeium/windsurf/') || norm.endsWith('/global_rules.md');
}

function deduplicateTargets(targets: ProfileTargetDescriptor[]): ProfileTargetDescriptor[] {
  const seen = new Set<string>();
  const out: ProfileTargetDescriptor[] = [];
  for (const t of targets) {
    const resolved = path.resolve(t.path);
    const key =
      process.platform === 'win32' || process.platform === 'darwin'
        ? resolved.toLowerCase()
        : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ host: t.host, path: resolved });
  }
  return out;
}

export function discoverGlobalProfileTargets(
  globalRoot?: string,
  options?: Pick<ProfileSyncOptions, 'targetFiles' | 'homeDir'>
): ProfileTargetDescriptor[] {
  const resolvedGlobalRoot = resolveGlobalFallbackDir(globalRoot);

  if (options?.targetFiles !== undefined) {
    return deduplicateTargets(
      options.targetFiles.map((f) => {
        const resolved = path.resolve(f);
        return { host: inferHostFromTargetPath(resolved), path: resolved };
      })
    );
  }

  if (
    process.env.EVO_GLOBAL_PROFILE_TARGETS &&
    process.env.EVO_GLOBAL_PROFILE_TARGETS.trim()
  ) {
    return deduplicateTargets(
      process.env.EVO_GLOBAL_PROFILE_TARGETS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((f) => {
          const resolved = path.resolve(f);
          return { host: inferHostFromTargetPath(resolved), path: resolved };
        })
    );
  }

  if (
    !options?.homeDir &&
    !options?.targetFiles &&
    !process.env.EVO_GLOBAL_PROFILE_TARGETS &&
    (Boolean(process.env.NODE_TEST_CONTEXT) || process.env.EVO_PROFILE_ISOLATED === '1')
  ) {
    return [
      {
        host: 'isolated',
        path: path.join(resolvedGlobalRoot, 'USER_PROFILE.md'),
      },
    ];
  }

  const homeDir = path.resolve(options?.homeDir || os.homedir());
  const discovered: ProfileTargetDescriptor[] = [];

  if (fs.existsSync(path.join(homeDir, '.claude'))) {
    discovered.push({
      host: 'claude',
      path: path.join(homeDir, '.claude', 'CLAUDE.md'),
    });
  }
  if (fs.existsSync(path.join(homeDir, '.gemini'))) {
    discovered.push({
      host: 'gemini',
      path: path.join(homeDir, '.gemini', 'GEMINI.md'),
    });
  }
  if (fs.existsSync(path.join(homeDir, '.codex'))) {
    discovered.push({
      host: 'codex',
      path: path.join(homeDir, '.codex', 'AGENTS.md'),
    });
  }
  if (fs.existsSync(path.join(homeDir, '.codeium', 'windsurf'))) {
    discovered.push({
      host: 'windsurf',
      path: path.join(homeDir, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
    });
  }
  if (fs.existsSync(path.join(homeDir, '.cursor'))) {
    discovered.push({
      host: 'cursor',
      path: path.join(homeDir, '.cursor', 'rules', 'evo-user-profile.mdc'),
    });
  }
  if (fs.existsSync(path.join(homeDir, '.cline'))) {
    discovered.push({
      host: 'cline',
      path: path.join(homeDir, '.cline', 'rules', 'evo-user-profile.md'),
    });
  }
  if (fs.existsSync(path.join(homeDir, '.roo'))) {
    discovered.push({
      host: 'roo',
      path: path.join(homeDir, '.roo', 'rules', 'evo-user-profile.md'),
    });
  }
  if (fs.existsSync(path.join(homeDir, '.config', 'opencode'))) {
    discovered.push({
      host: 'opencode',
      path: path.join(homeDir, '.config', 'opencode', 'AGENTS.md'),
    });
  }

  return deduplicateTargets(discovered);
}

export function syncGlobalUserProfile(
  globalRoot?: string,
  options?: ProfileSyncOptions
): ProfileSyncResult {
  const resolvedGlobalRoot = resolveGlobalFallbackDir(globalRoot);
  const storage = new EvoStorage(resolvedGlobalRoot);
  const dryRun = Boolean(options?.dryRun);
  if (!dryRun) {
    storage.ensureInitialized();
  }
  const cfg = hasValidEvoStructure(storage.evoDir)
    ? storage.getConfig()
    : { ...DEFAULT_EVO_CONFIG };
  const maxTokens = cfg.maxGlobalProfileTokens ?? 800;
  const maxMenuTokens = cfg.maxDirectoryMenuTokens ?? 250;
  const digest = dryRun
    ? storage.formatUserProfileDigest()
    : storage.rebuildUserProfileDigest();
  const { totalTokens } = storage.getProfileTokenUsage();
  const directoryMenu = storage.formatTaskDirectoryMenu(maxMenuTokens);
  const menuTokens = directoryMenu ? estimateTokens(directoryMenu) : 0;
  const profileBlock = renderUserProfileBlock(digest, directoryMenu);

  const discoveredTargets = discoverGlobalProfileTargets(resolvedGlobalRoot, options);
  const updatedTargets: string[] = [];
  const targets: ProfileTargetResult[] = [];

  for (const target of discoveredTargets) {
    const targetPath = target.path;
    const isStandaloneCursorMdc = /[\\/]\.cursor[\\/]rules[\\/]evo-user-profile\.mdc$/i.test(
      targetPath
    );
    const isStandalone =
      /[\\/]evo-user-profile\.(?:mdc|md)$/i.test(targetPath) || isStandaloneCursorMdc;

    const existed = fs.existsSync(targetPath);
    if (existed) {
      try {
        if (!fs.statSync(targetPath).isFile()) {
          targets.push({ host: target.host, path: targetPath, status: 'skipped' });
          continue;
        }
      } catch {
        targets.push({ host: target.host, path: targetPath, status: 'skipped' });
        continue;
      }
    }

    const existing = existed ? fs.readFileSync(targetPath, 'utf8') : '';

    if (!profileBlock) {
      if (!existed) {
        targets.push({ host: target.host, path: targetPath, status: 'skipped' });
        continue;
      }
      const stripped = removeProfileBlock(existing);
      if (isStandalone) {
        const bodyWithoutFm = stripped
          .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
          .trim();
        if (!bodyWithoutFm) {
          if (!dryRun) {
            try {
              fs.unlinkSync(targetPath);
            } catch {}
          }
          updatedTargets.push(targetPath);
          targets.push({ host: target.host, path: targetPath, status: 'removed' });
          continue;
        }
      }
      if (stripped !== existing) {
        if (!dryRun) {
          fs.writeFileSync(targetPath, stripped, 'utf8');
        }
        updatedTargets.push(targetPath);
        targets.push({ host: target.host, path: targetPath, status: 'removed' });
      } else {
        targets.push({ host: target.host, path: targetPath, status: 'unchanged' });
      }
      continue;
    }

    const effectiveBlock = computeEffectiveProfileBlockForTarget(target, profileBlock, existing);
    if (!effectiveBlock) {
      targets.push({ host: target.host, path: targetPath, status: 'skipped' });
      continue;
    }

    let next: string;
    if (isStandaloneCursorMdc && !existing.trim()) {
      const mdcHeader = [
        '---',
        'description: EvoKernel Personal Style & Cross-Workspace Preferences (Auto-Managed)',
        'globs: **/*',
        'alwaysApply: true',
        '---',
      ].join('\n');
      next = `${mdcHeader}\n\n${effectiveBlock.trim()}\n`;
    } else {
      next = upsertProfileBlock(existing, effectiveBlock);
    }

    if (!existed || next !== existing) {
      if (!dryRun) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, next, 'utf8');
      }
      updatedTargets.push(targetPath);
      targets.push({ host: target.host, path: targetPath, status: 'updated' });
    } else {
      targets.push({ host: target.host, path: targetPath, status: 'unchanged' });
    }
  }

  return {
    digestPath: storage.profileDigestPath,
    totalTokens,
    maxTokens,
    menuTokens,
    maxMenuTokens,
    updatedTargets,
    targets,
  };
}

export function cleanGlobalUserProfile(
  globalRoot?: string,
  options?: ProfileSyncOptions
): ProfileCleanResult {
  const resolvedGlobalRoot = resolveGlobalFallbackDir(globalRoot);
  const storage = new EvoStorage(resolvedGlobalRoot);
  const dryRun = Boolean(options?.dryRun);
  const discoveredTargets = discoverGlobalProfileTargets(resolvedGlobalRoot, options);
  const updatedTargets: string[] = [];
  const targets: ProfileTargetResult[] = [];

  for (const target of discoveredTargets) {
    const targetPath = target.path;
    const existed = fs.existsSync(targetPath);
    if (!existed) {
      targets.push({ host: target.host, path: targetPath, status: 'skipped' });
      continue;
    }
    try {
      if (!fs.statSync(targetPath).isFile()) {
        targets.push({ host: target.host, path: targetPath, status: 'skipped' });
        continue;
      }
    } catch {
      targets.push({ host: target.host, path: targetPath, status: 'skipped' });
      continue;
    }

    const existing = fs.readFileSync(targetPath, 'utf8');
    const stripped = removeProfileBlock(existing);
    const isStandalone = /[\\/]evo-user-profile\.(?:mdc|md)$/i.test(targetPath);

    if (isStandalone) {
      const bodyWithoutFm = stripped
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        .trim();
      if (!bodyWithoutFm) {
        if (!dryRun) {
          try {
            fs.unlinkSync(targetPath);
          } catch {}
        }
        updatedTargets.push(targetPath);
        targets.push({ host: target.host, path: targetPath, status: 'removed' });
        continue;
      }
    }

    if (stripped !== existing) {
      if (!dryRun) {
        fs.writeFileSync(targetPath, stripped, 'utf8');
      }
      updatedTargets.push(targetPath);
      targets.push({ host: target.host, path: targetPath, status: 'removed' });
    } else {
      targets.push({ host: target.host, path: targetPath, status: 'unchanged' });
    }
  }

  return {
    digestPath: storage.profileDigestPath,
    updatedTargets,
    targets,
  };
}
