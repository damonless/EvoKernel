import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvoStorage, estimateTokens } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import {
  META_RULE_MARKER_END,
  META_RULE_MARKER_START,
  renderManagedBlock,
} from '../templates/meta-rule.js';
import {
  ALL_HARNESS_ADAPTERS,
  HARNESS_RULE_TARGETS,
  detectCascadedTargets,
  parseHarnessTargets,
  pruneEmptyDirs,
  removeMarkerBlock,
  upsertMarkerBlock,
} from './harness.js';

export {
  HARNESS_RULE_TARGETS,
  removeMarkerBlock,
  upsertMarkerBlock,
} from './harness.js';

export interface InitResult {
  initializedHarnesses: string[];
  updatedFiles: string[];
  mcpConfigFiles: string[];
  stealthExcluded?: string[];
  linkedSharedEvoDir?: string;
}

export interface InitOptions {
  targets?: string[];
  stealth?: boolean;
  linkEvoFrom?: string;
}

export const MAX_TOOLS_CATALOG_TOKENS = 350;

export function formatToolsCatalogMarkdown(storage: EvoStorage, _coreDigest: string = ''): string {
  const tools = storage.listTools();
  if (tools.length === 0) return '';

  const detailedLines: string[] = [];
  const remainingIds: string[] = [];

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    const line = `- \`[tool] ${t.id}\`: ${t.l0_summary}`;
    const candidateLines = [
      ...detailedLines,
      line,
      ...(i < tools.length - 1
        ? [
            `- Additional tools via \`evo_run\`: ${tools
              .slice(i + 1)
              .map((x) => `\`${x.id}\``)
              .join(', ')}`,
          ]
        : []),
    ];
    if (
      detailedLines.length < 6 &&
      estimateTokens(candidateLines.join('\n')) <= MAX_TOOLS_CATALOG_TOKENS
    ) {
      detailedLines.push(line);
    } else {
      remainingIds.push(t.id);
    }
  }

  if (remainingIds.length > 0) {
    const overflowIds = [...remainingIds];
    while (overflowIds.length > 0) {
      const suffix =
        overflowIds.length < remainingIds.length
          ? ` (+${remainingIds.length - overflowIds.length} more via evo_search)`
          : '';
      const overflowLine = `- Additional tools via \`evo_run\`: ${overflowIds
        .map((id) => `\`${id}\``)
        .join(', ')}${suffix}`;
      const candidateCatalog = [...detailedLines, overflowLine].join('\n');
      if (estimateTokens(candidateCatalog) <= MAX_TOOLS_CATALOG_TOKENS) {
        detailedLines.push(overflowLine);
        break;
      }
      overflowIds.pop();
    }
  }

  return detailedLines.join('\n');
}

export function syncManagedRuleBlocks(workspaceRoot: string): string[] {
  const storage = new EvoStorage(workspaceRoot);
  const digest = storage.rebuildCoreInvariantsDigest();
  const toolsCatalog = formatToolsCatalogMarkdown(storage, digest);
  const block = renderManagedBlock(digest, toolsCatalog);
  const updated: string[] = [];

  const candidateRuleFiles = [
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    '.cursor/rules/evo-kernel.mdc',
    '.windsurfrules',
    '.windsurf/rules/evo-kernel.md',
    '.clinerules',
    '.roo/rules/evo-kernel.md',
    '.roorules',
    '.github/copilot-instructions.md',
  ];

  for (const relPath of candidateRuleFiles) {
    const fullPath = path.join(workspaceRoot, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        if (!fs.statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }
      const current = fs.readFileSync(fullPath, 'utf8');
      if (current.includes(META_RULE_MARKER_START)) {
        const next = upsertMarkerBlock(current, block);
        fs.writeFileSync(fullPath, next, 'utf8');
        updated.push(relPath);
      }
    }
  }

  const opencodePath = path.join(workspaceRoot, 'opencode.json');
  if (fs.existsSync(opencodePath)) {
    try {
      if (fs.statSync(opencodePath).isFile()) {
        const parsed = JSON.parse(fs.readFileSync(opencodePath, 'utf8'));
        if (typeof parsed.instructions === 'string' && parsed.instructions.includes(META_RULE_MARKER_START)) {
          parsed.instructions = upsertMarkerBlock(parsed.instructions, block);
          fs.writeFileSync(opencodePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          updated.push('opencode.json');
        }
        if (typeof parsed.instructionsFile === 'string' && parsed.instructionsFile.trim()) {
          const relCustom = parsed.instructionsFile.trim();
          if (!updated.includes(relCustom)) {
            const customFullPath = path.join(workspaceRoot, relCustom);
            if (fs.existsSync(customFullPath) && fs.statSync(customFullPath).isFile()) {
              const current = fs.readFileSync(customFullPath, 'utf8');
              if (current.includes(META_RULE_MARKER_START)) {
                const next = upsertMarkerBlock(current, block);
                fs.writeFileSync(customFullPath, next, 'utf8');
                updated.push(relCustom);
              }
            }
          }
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  const wsHookScript = path.join(workspaceRoot, '.agents', 'scripts', 'antigravity_hook.mjs');
  const bundledHookScript = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    'scripts',
    'antigravity_hook.mjs'
  );
  if (fs.existsSync(wsHookScript) && fs.existsSync(bundledHookScript)) {
    try {
      if (fs.statSync(wsHookScript).isFile() && fs.statSync(bundledHookScript).isFile()) {
        const wsHookContent = fs.readFileSync(wsHookScript, 'utf8');
        const bundledHookContent = fs.readFileSync(bundledHookScript, 'utf8');
        if (wsHookContent !== bundledHookContent) {
          fs.writeFileSync(wsHookScript, bundledHookContent, 'utf8');
          updated.push('.agents/scripts/antigravity_hook.mjs');
        }
      }
    } catch {
      // Ignore sync errors on read-only paths
    }
  }

  return updated;
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

export function resolveGitDir(gitRoot: string): string {
  const dotGit = path.join(gitRoot, '.git');
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isFile()) {
      const content = fs.readFileSync(dotGit, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/i);
      if (match) {
        return path.resolve(gitRoot, match[1].trim());
      }
    }
  } catch {
    // fallback to standard .git directory
  }
  return dotGit;
}

export function ensureGitInfoExclude(workspaceRoot: string, patterns: string[]): string[] {
  const gitRoot = findGitRoot(workspaceRoot);
  if (!gitRoot) {
    return [];
  }
  const gitDir = resolveGitDir(gitRoot);
  const gitInfoDir = path.join(gitDir, 'info');
  fs.mkdirSync(gitInfoDir, { recursive: true });
  const excludePath = path.join(gitInfoDir, 'exclude');
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  const existingLines = new Set(
    existing
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  );

  const relPrefix = path
    .relative(gitRoot, path.resolve(workspaceRoot))
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  const expandedPatterns: string[] = [];
  for (const pat of patterns) {
    if (relPrefix && !relPrefix.startsWith('..')) {
      const cleanPat = pat.replace(/^\/+/, '');
      const prefixed = `/${relPrefix}/${cleanPat}`;
      if (!expandedPatterns.includes(prefixed)) {
        expandedPatterns.push(prefixed);
      }
    } else {
      if (!expandedPatterns.includes(pat)) {
        expandedPatterns.push(pat);
      }
    }
  }

  const added: string[] = [];
  for (const pat of expandedPatterns) {
    if (!existingLines.has(pat)) {
      added.push(pat);
    }
  }

  if (added.length > 0) {
    const block = [
      existing.trimEnd(),
      '# EvoKernel Stealth Mode (Local-only exclude — never touches .gitignore or remote whitelist)',
      ...added,
      '',
    ]
      .filter((s, idx) => !(idx === 0 && !s))
      .join('\n');
    fs.writeFileSync(excludePath, block, 'utf8');
  }
  return added;
}

export function removeGitInfoExclude(workspaceRoot: string, patterns?: string[]): string[] {
  const gitRoot = findGitRoot(workspaceRoot);
  if (!gitRoot) return [];
  const gitDir = resolveGitDir(gitRoot);
  const excludePath = path.join(gitDir, 'info', 'exclude');
  if (!fs.existsSync(excludePath)) return [];

  const content = fs.readFileSync(excludePath, 'utf8');
  if (!content.trim()) return [];

  const lines = content.split(/\r?\n/);
  const relPrefix = path
    .relative(gitRoot, path.resolve(workspaceRoot))
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  const patternSet = new Set<string>();
  const targetPatterns = patterns && patterns.length > 0
    ? patterns
    : [
        '.evo/',
        '.evo/.cache/',
        ...Object.values(ALL_HARNESS_ADAPTERS).flatMap((a) => [
          ...a.ruleFiles,
          ...a.mcpFiles,
          ...a.dirs.map((d) => (d.endsWith('/') ? d : `${d}/`)),
        ]),
      ];

  for (const pat of targetPatterns) {
    const clean = pat.replace(/^\/+/, '');
    if (relPrefix && !relPrefix.startsWith('..')) {
      patternSet.add(`/${relPrefix}/${clean}`);
      patternSet.add(`${relPrefix}/${clean}`);
    } else {
      patternSet.add(pat);
      patternSet.add(clean);
      patternSet.add(`/${clean}`);
    }
  }

  const kept: string[] = [];
  const removed: string[] = [];
  let inEvoBlock = false;
  let currentBlockLines: string[] = [];

  const flushBlock = (blockLines: string[], out: string[]) => {
    const nonComment = blockLines.filter((l) => !l.trim().startsWith('#') && l.trim().length > 0);
    if (nonComment.length > 0) {
      out.push(...blockLines);
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# EvoKernel Stealth Mode')) {
      if (inEvoBlock) {
        flushBlock(currentBlockLines, kept);
        currentBlockLines = [];
      }
      inEvoBlock = true;
      currentBlockLines.push(line);
      continue;
    }
    if (inEvoBlock) {
      if (!trimmed) {
        continue;
      }
      if (trimmed.startsWith('#')) {
        inEvoBlock = false;
        flushBlock(currentBlockLines, kept);
        currentBlockLines = [];
        kept.push(line);
        continue;
      }
      if (patternSet.has(trimmed)) {
        removed.push(trimmed);
        continue;
      }
      currentBlockLines.push(line);
      continue;
    }

    if (patternSet.has(trimmed)) {
      removed.push(trimmed);
      continue;
    }

    kept.push(line);
  }

  if (inEvoBlock) {
    flushBlock(currentBlockLines, kept);
  }

  const newContent = kept.join('\n').trim();
  fs.writeFileSync(excludePath, newContent ? newContent + '\n' : '', 'utf8');
  return removed;
}

export function parseInitTargets(
  rawTargets: string | string[] | undefined,
  workspaceRoot: string
): string[] {
  return parseHarnessTargets(rawTargets, workspaceRoot);
}

export function runInit(
  workspaceRoot: string,
  targetsOrOptions?: string[] | InitOptions
): InitResult {
  const opts: InitOptions = Array.isArray(targetsOrOptions)
    ? { targets: targetsOrOptions, stealth: false }
    : targetsOrOptions || {};

  const targets = opts.targets !== undefined
    ? parseInitTargets(opts.targets, workspaceRoot)
    : detectCascadedTargets(workspaceRoot);
  const stealth = Boolean(opts.stealth);

  let linkedSharedEvoDir: string | undefined;
  if (opts.linkEvoFrom && opts.linkEvoFrom.trim()) {
    const candidate = path.resolve(workspaceRoot, opts.linkEvoFrom.trim());
    const targetEvo =
      path.basename(candidate) === '.evo' ? candidate : path.join(candidate, '.evo');
    const masterStorage = new EvoStorage(path.dirname(targetEvo), targetEvo);
    masterStorage.ensureInitialized();
    linkedSharedEvoDir = targetEvo;

    const localEvoDir = path.join(workspaceRoot, '.evo');
    fs.mkdirSync(localEvoDir, { recursive: true });
    const localConfigPath = path.join(localEvoDir, 'config.json');
    let localCfg: Record<string, unknown> = {};
    if (fs.existsSync(localConfigPath)) {
      try {
        localCfg = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      } catch {
        localCfg = {};
      }
    }
    localCfg.sharedEvoDir = targetEvo;
    fs.writeFileSync(localConfigPath, JSON.stringify(localCfg, null, 2) + '\n', 'utf8');
  }

  const storage = new EvoStorage(workspaceRoot);
  const config = storage.ensureInitialized();
  const telemetry = new EvoTelemetry(storage);
  telemetry.syncFromDisk();
  telemetry.close();

  const digest = storage.rebuildCoreInvariantsDigest();
  const toolsCatalog = formatToolsCatalogMarkdown(storage, digest);
  const managedBlock = renderManagedBlock(digest, toolsCatalog);

  const updatedFilesList: string[] = [];
  const mcpConfigFilesList: string[] = [];
  const activeDirs: string[] = [];

  for (const target of targets) {
    const adapter = ALL_HARNESS_ADAPTERS[target];
    if (!adapter) continue;
    const res = adapter.install(workspaceRoot, managedBlock);
    updatedFilesList.push(...res.updatedFiles);
    mcpConfigFilesList.push(...res.mcpConfigFiles);
    activeDirs.push(...adapter.dirs);
  }

  const updatedFiles = Array.from(new Set(updatedFilesList));
  const mcpConfigFiles = Array.from(new Set(mcpConfigFilesList));

  config.enabledHarnesses = Array.from(new Set([...config.enabledHarnesses, ...targets]));
  storage.saveConfig(config);

  const excludeDirs = activeDirs.map((d) => (d.endsWith('/') ? d : `${d}/`));
  const excludeCandidates = stealth
    ? ['.evo/', ...mcpConfigFiles, ...updatedFiles, ...excludeDirs]
    : linkedSharedEvoDir
      ? ['.evo/', '.evo/.cache/']
      : ['.evo/.cache/'];

  const stealthExcluded = ensureGitInfoExclude(workspaceRoot, excludeCandidates);

  return {
    initializedHarnesses: targets,
    updatedFiles,
    mcpConfigFiles,
    stealthExcluded,
    linkedSharedEvoDir,
  };
}

export function runUninstall(
  workspaceRoot: string,
  options?: { patterns?: string[] }
): { cleanedFiles: string[] } {
  const cleanedFilesList: string[] = [];
  const dirsToPrune: string[] = [
    '.cursor/rules',
    '.cursor',
    '.roo/rules',
    '.roo',
    '.windsurf/rules',
    '.windsurf',
    '.codex',
    '.claude',
    '.vscode',
    '.github',
    '.gemini',
    '.cline',
    '.opencode',
    '.agents/scripts',
    '.agents',
  ];

  for (const adapter of Object.values(ALL_HARNESS_ADAPTERS)) {
    const cleaned = adapter.uninstall(workspaceRoot);
    cleanedFilesList.push(...cleaned);
  }

  pruneEmptyDirs(workspaceRoot, dirsToPrune);

  const patternsToRemove = options?.patterns && options.patterns.length > 0
    ? options.patterns
    : [
        '.evo/',
        '.evo/.cache/',
        ...Object.values(ALL_HARNESS_ADAPTERS).flatMap((a) => [
          ...a.ruleFiles,
          ...a.mcpFiles,
          ...a.dirs.map((d) => (d.endsWith('/') ? d : `${d}/`)),
        ]),
      ];
  removeGitInfoExclude(workspaceRoot, patternsToRemove);

  return { cleanedFiles: Array.from(new Set(cleanedFilesList)) };
}
