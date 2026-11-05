import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvoStorage, estimateTokens } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { resolveGitPaths } from '../core/memory.js';
import {
  META_RULE_MARKER_END,
  META_RULE_MARKER_START,
  renderManagedBlock,
} from '../templates/meta-rule.js';
import {
  ALL_HARNESS_ADAPTERS,
  HARNESS_RULE_TARGETS,
  SLASH_COMMAND_DEFINITIONS,
  detectCascadedTargets,
  parseHarnessTargets,
  pruneEmptyDirs,
  removeMarkerBlock,
  syncDeclaredPreToolHooks,
  upsertMarkerBlock,
} from './harness.js';

export {
  HARNESS_RULE_TARGETS,
  removeMarkerBlock,
  upsertMarkerBlock,
} from './harness.js';
import { buildScoreReport } from './score.js';
import { runBootstrap } from './bootstrap.js';

export interface IdeProfile {
  id: string;
  name: string;
  relExtensionsDir: string[];
  relRootDirs: string[][];
}

export interface IdeMountDetail {
  ide: string;
  name: string;
  extensionDir: string;
  targetPath: string;
  method: 'junction' | 'symlink' | 'copy' | 'already-mounted';
  status: 'installed' | 'updated' | 'skipped' | 'failed';
  error?: string;
}

export type MountIdeResult = IdeMountDetail[] & {
  mounts: IdeMountDetail[];
  totalMounted: number;
};

export interface InitResult {
  initializedHarnesses: string[];
  updatedFiles: string[];
  mcpConfigFiles: string[];
  commandFiles?: string[];
  stealthExcluded?: string[];
  linkedSharedEvoDir?: string;
  warmupReport?: any;
  ideMounts?: IdeMountDetail[];
}

export interface InitOptions {
  targets?: string[];
  stealth?: boolean;
  linkEvoFrom?: string;
  warmup?: boolean;
  installIde?: boolean;
  noIde?: boolean;
  ide?: string[];
  forceCopy?: boolean;
}

export const MAX_TOOLS_CATALOG_TOKENS = 350;
const MAX_WORKFLOW_TOKENS = 130;

export function formatToolsCatalogMarkdown(
  storage: EvoStorage,
  _coreDigest: string = '',
  options?: { includeGlobal?: boolean }
): string {
  const tools = storage.listTools();
  const universalScopedRules = storage
    .listRules()
    .filter(
      (r) => !r.core && (!r.scope_glob || r.scope_glob.trim() === '**/*' || r.scope_glob.trim() === '*')
    );
  const skills = storage.listSkills();

  // Merge ~/.evo/global tools and skills if requested
  const globalDir = process.env.EVO_GLOBAL_DIR
    ? path.resolve(process.env.EVO_GLOBAL_DIR)
    : path.join(os.homedir(), '.evo', 'global');
  let allTools = [...tools];
  let allSkills = [...skills];
  if (
    options?.includeGlobal &&
    fs.existsSync(globalDir) &&
    path.resolve(storage.rootDir) !== path.resolve(globalDir)
  ) {
    try {
      const globalStorage = new EvoStorage(globalDir);
      const globalTools = globalStorage.listTools();
      const globalSkills = globalStorage.listSkills();
      const toolIds = new Set(allTools.map((t) => t.id));
      for (const gt of globalTools) {
        if (!toolIds.has(gt.id)) {
          toolIds.add(gt.id);
          allTools.push(gt);
        }
      }
      const skillIds = new Set(allSkills.map((s) => s.id));
      for (const gs of globalSkills) {
        if (!skillIds.has(gs.id)) {
          skillIds.add(gs.id);
          allSkills.push(gs);
        }
      }
    } catch {
      // ignore
    }
  }

  if (allTools.length === 0 && universalScopedRules.length === 0 && allSkills.length === 0) return '';

  const cuedSkills = allSkills.filter((s) => s.trigger_cue && s.trigger_cue.trim().length > 0);
  const uncuedSkills = allSkills.filter((s) => !s.trigger_cue || !s.trigger_cue.trim().length);

  function buildCompactLine(items: string[], maxBudget: number): string | null {
    if (items.length === 0) return null;
    const visible = [...items];
    while (visible.length > 0) {
      const suffix =
        visible.length < items.length
          ? ` (+${items.length - visible.length} more via evo_search)`
          : '';
      const line = `- On-demand rules/skills (inspect via \`evo_inspect\`): ${visible.join(', ')}${suffix}`;
      if (estimateTokens(line) <= maxBudget) {
        return line;
      }
      visible.pop();
    }
    const minimalSuffix = `- On-demand rules/skills (inspect via \`evo_inspect\`): (+${items.length} more via evo_search)`;
    if (estimateTokens(minimalSuffix) <= maxBudget) {
      return minimalSuffix;
    }
    return null;
  }

  let bestWorkflowLines: string[] = [];

  for (let k = cuedSkills.length; k >= 0; k--) {
    const candidateCued = cuedSkills.slice(0, k);
    const overflowCued = cuedSkills.slice(k);

    const cuedLines = candidateCued.map((s) => {
      const cue = s.trigger_cue!.trim().replace(/^when\s+/i, '').replace(/\.+$/, '');
      return `- When ${cue} -> \`evo_inspect("${s.id}", "L2")\``;
    });

    const compactItems: string[] = [
      ...universalScopedRules.map((r) => `\`[rule] ${r.id}\``),
      ...uncuedSkills.map((s) => `\`[skill] ${s.id}\``),
      ...overflowCued.map((s) => `\`[skill] ${s.id}\``),
    ];

    if (compactItems.length === 0) {
      const totalTokens = cuedLines.length > 0 ? estimateTokens(cuedLines.join('\n')) : 0;
      if (totalTokens <= MAX_WORKFLOW_TOKENS) {
        bestWorkflowLines = cuedLines;
        break;
      }
    } else {
      const cuedTokens = cuedLines.length > 0 ? estimateTokens(cuedLines.join('\n')) : 0;
      const remainingForCompact = MAX_WORKFLOW_TOKENS - cuedTokens;
      if (remainingForCompact >= 10) {
        const compactLine = buildCompactLine(compactItems, remainingForCompact);
        if (compactLine) {
          const candidateLines = [...cuedLines, compactLine];
          if (estimateTokens(candidateLines.join('\n')) <= MAX_WORKFLOW_TOKENS) {
            bestWorkflowLines = candidateLines;
            break;
          }
        }
      }
    }
  }

  const workflowLines = bestWorkflowLines;
  const actualWorkflowTokens =
    workflowLines.length > 0 ? estimateTokens(workflowLines.join('\n')) : 0;
  const toolBudgetCap =
    MAX_TOOLS_CATALOG_TOKENS - Math.min(MAX_WORKFLOW_TOKENS, actualWorkflowTokens);

  const detailedToolLines: string[] = [];
  const remainingToolIds: string[] = [];

  for (let i = 0; i < allTools.length; i++) {
    const t = allTools[i];
    const line = `- \`[tool] ${t.id}\`: ${t.l0_summary}`;
    const candidateLines = [
      ...detailedToolLines,
      line,
      ...(i < allTools.length - 1
        ? [
            `- Additional tools via \`evo_run\`: ${allTools
              .slice(i + 1)
              .map((x) => `\`${x.id}\``)
              .join(', ')}`,
          ]
        : []),
    ];
    if (
      detailedToolLines.length < 6 &&
      estimateTokens(candidateLines.join('\n')) <= toolBudgetCap
    ) {
      detailedToolLines.push(line);
    } else {
      remainingToolIds.push(...allTools.slice(i).map((x) => x.id));
      break;
    }
  }

  if (remainingToolIds.length > 0) {
    const overflowIds = [...remainingToolIds];
    while (overflowIds.length > 0) {
      const suffix =
        overflowIds.length < remainingToolIds.length
          ? ` (+${remainingToolIds.length - overflowIds.length} more via evo_search)`
          : '';
      const overflowLine = `- Additional tools via \`evo_run\`: ${overflowIds
        .map((id) => `\`${id}\``)
        .join(', ')}${suffix}`;
      const candidateCatalog = [...detailedToolLines, overflowLine].join('\n');
      if (estimateTokens(candidateCatalog) <= toolBudgetCap) {
        detailedToolLines.push(overflowLine);
        break;
      }
      overflowIds.pop();
    }
  }

  const finalLines = [...detailedToolLines, ...workflowLines];
  while (finalLines.length > 0 && estimateTokens(finalLines.join('\n')) > MAX_TOOLS_CATALOG_TOKENS) {
    finalLines.pop();
  }

  return finalLines.join('\n');
}

export function syncManagedRuleBlocks(workspaceRoot: string): string[] {
  const storage = new EvoStorage(workspaceRoot);
  const digest = storage.rebuildCoreInvariantsDigest();
  const toolsCatalog = formatToolsCatalogMarkdown(storage, digest, { includeGlobal: true });
  const block = renderManagedBlock(digest, toolsCatalog);
  const updated: string[] = [];

  const candidateRuleFiles = [
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    'rules/AGENTS.md',
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
        if (Array.isArray(parsed.instructions)) {
          for (const item of parsed.instructions) {
            if (typeof item === 'string' && item.trim()) {
              const relCustom = item.trim();
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

  try {
    syncDeclaredPreToolHooks(workspaceRoot);
  } catch {
    // Ignore hook sync errors during rule block sync
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
  const gitPaths = resolveGitPaths(workspaceRoot);
  const gitRoot = gitPaths ? gitPaths.repoRoot : findGitRoot(workspaceRoot);
  if (!gitRoot) {
    return [];
  }
  const gitDir = gitPaths ? gitPaths.commonDir : resolveGitDir(gitRoot);
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
  const gitPaths = resolveGitPaths(workspaceRoot);
  const gitRoot = gitPaths ? gitPaths.repoRoot : findGitRoot(workspaceRoot);
  if (!gitRoot) return [];
  const gitDir = gitPaths ? gitPaths.commonDir : resolveGitDir(gitRoot);
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

export const BOOT_MCP_STUB = `#!/usr/bin/env node
/**
 * Zero-Config Team MCP/Hook Bootstrapper for EvoKernel.
 * Runs installed evo-kernel CLI via local node_modules or dist fallbacks,
 * keeping stdio clean and eliminating Windows spawn ENOENT / npx latency.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';
import { spawnSync } from 'node:child_process';

const rawVersion = String(process.env.EVO_SIMULATE_NODE_VERSION || process.versions.node || '0.0.0').replace(/^v/i, '');
const [nodeMaj = 0, nodeMin = 0] = rawVersion.split('.').map((n) => Number.parseInt(n, 10));
if (nodeMaj < 22 || (nodeMaj === 22 && nodeMin < 5)) {
  console.error(
    \`[EvoKernel] Node.js >= 22.5.0 is required (detected v\${rawVersion}).\\n\` +
      \`  EvoKernel uses zero-dependency native node:sqlite and node:module.stripTypeScriptTypes.\\n\` +
      \`  Instant 1-liner (no global Node change): npx -y -p node@22 evo-kernel <command>\\n\` +
      \`  Quick fix: run "nvm install 22 && nvm use 22", "fnm use 22", or "volta install node@22".\`
  );
  process.exit(1);
}

const evoDir = path.resolve(import.meta.dirname);
const wsRoot = path.resolve(evoDir, '..');
const homeDir = os.homedir ? os.homedir() : (process.env.HOME || process.env.USERPROFILE || '');
const candidates = [
  path.join(wsRoot, 'dist', 'cli', 'index.js'),
  path.join(wsRoot, 'node_modules', 'evo-kernel', 'dist', 'cli', 'index.js'),
  path.join(evoDir, 'dist', 'cli', 'index.js'),
];

// Walk up ancestor node_modules/evo-kernel/dist/cli/index.js
let curr = wsRoot;
while (true) {
  const ancestorCandidate = path.join(curr, 'node_modules', 'evo-kernel', 'dist', 'cli', 'index.js');
  if (!candidates.includes(ancestorCandidate)) {
    candidates.push(ancestorCandidate);
  }
  const parent = path.dirname(curr);
  if (!parent || parent === curr) break;
  curr = parent;
}

// Global npm modules & host plugin paths
if (process.env.APPDATA) {
  candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'evo-kernel', 'dist', 'cli', 'index.js'));
}
candidates.push(path.resolve(process.execPath, '../../lib/node_modules/evo-kernel/dist/cli/index.js'));
candidates.push(path.resolve(process.execPath, '../node_modules/evo-kernel/dist/cli/index.js'));
if (homeDir) {
  candidates.push(path.join(homeDir, '.gemini', 'config', 'plugins', 'evo-kernel', 'dist', 'cli', 'index.js'));
  candidates.push(path.join(homeDir, '.gemini', 'extensions', 'evo-kernel', 'dist', 'cli', 'index.js'));
}

let entry = candidates.find((c) => fs.existsSync(c));
if (!entry) {
  const buildScript = path.join(wsRoot, 'scripts', 'build.mjs');
  if (fs.existsSync(buildScript)) {
    spawnSync(process.execPath, [buildScript], { cwd: wsRoot, stdio: 'ignore' });
    if (fs.existsSync(candidates[0])) entry = candidates[0];
  }
}
if (!entry) {
  console.error('[EvoKernel] Error: evo-kernel not found in workspace node_modules or dist.');
  console.error('Please run: npm install --save-dev evo-kernel (or npm install -g evo-kernel)');
  process.exit(1);
}
const rawArgs = process.argv.slice(2);
const firstArg = (rawArgs[0] || '').toLowerCase();
const forwardedArgs =
  firstArg && firstArg !== 'mcp' && !firstArg.startsWith('-')
    ? rawArgs
    : ['mcp', ...rawArgs.filter((arg) => arg !== 'mcp')];
process.argv = [process.argv[0], entry, ...forwardedArgs];
await import(url.pathToFileURL(entry).href);
`;

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
  if (!stealth) {
    const evoBootPath = path.join(workspaceRoot, '.evo', 'boot-mcp.mjs');
    if (!fs.existsSync(evoBootPath)) {
      try {
        fs.writeFileSync(evoBootPath, BOOT_MCP_STUB, 'utf8');
      } catch {
        // Ignore read-only errors
      }
    }
  }
  const telemetry = new EvoTelemetry(storage);
  telemetry.syncFromDisk();
  telemetry.close();

  const digest = storage.rebuildCoreInvariantsDigest();
  const toolsCatalog = formatToolsCatalogMarkdown(storage, digest, { includeGlobal: true });
  const managedBlock = renderManagedBlock(digest, toolsCatalog);

  const updatedFilesList: string[] = [];
  const mcpConfigFilesList: string[] = [];
  const commandFilesList: string[] = [];
  const activeDirs: string[] = [];

  for (const target of targets) {
    const adapter = ALL_HARNESS_ADAPTERS[target];
    if (!adapter) continue;
    const res = adapter.install(workspaceRoot, managedBlock);
    updatedFilesList.push(...res.updatedFiles);
    mcpConfigFilesList.push(...res.mcpConfigFiles);
    if (res.commandFiles) {
      commandFilesList.push(...res.commandFiles);
    }
    activeDirs.push(...adapter.dirs);
  }

  const pluginRulesAgents = path.join(workspaceRoot, 'rules', 'AGENTS.md');
  if (fs.existsSync(pluginRulesAgents)) {
    try {
      if (fs.statSync(pluginRulesAgents).isFile()) {
        const current = fs.readFileSync(pluginRulesAgents, 'utf8');
        if (current.includes(META_RULE_MARKER_START)) {
          fs.writeFileSync(pluginRulesAgents, upsertMarkerBlock(current, managedBlock), 'utf8');
          updatedFilesList.push('rules/AGENTS.md');
        }
      }
    } catch {
      // Ignore read-only errors
    }
  }

  const updatedFiles = Array.from(new Set(updatedFilesList));
  const mcpConfigFiles = Array.from(new Set(mcpConfigFilesList));

  config.enabledHarnesses = Array.from(new Set([...config.enabledHarnesses, ...targets]));
  storage.saveConfig(config);

  const excludeDirs = activeDirs.map((d) => (d.endsWith('/') ? d : `${d}/`));
  const excludeCandidates = stealth
    ? ['.evo/', ...mcpConfigFiles, ...updatedFiles, ...commandFilesList, ...excludeDirs]
    : linkedSharedEvoDir
      ? ['.evo/', '.evo/.cache/']
      : ['.evo/.cache/'];

  const stealthExcluded = ensureGitInfoExclude(workspaceRoot, excludeCandidates);

  let warmupReport: any = undefined;
  if (opts.warmup) {
    try {
      const bootSummary = runBootstrap(workspaceRoot, { maxCommits: 25 });
      const scoreReport = buildScoreReport(workspaceRoot);
      warmupReport = {
        ...scoreReport,
        bootSummary,
        scoreReport,
      };
    } catch {}
  }

  const shouldMountIde = opts.installIde ?? (!opts.noIde);
  let ideMounts: IdeMountDetail[] | undefined;
  if (shouldMountIde && !opts.noIde) {
    try {
      const mountRes = mountIdeExtensions(workspaceRoot, {
        installIde: opts.installIde,
        noIde: opts.noIde,
        ide: opts.ide,
        forceCopy: opts.forceCopy,
      });
      ideMounts = mountRes.mounts;
    } catch {}
  }

  return {
    initializedHarnesses: targets,
    updatedFiles,
    mcpConfigFiles,
    commandFiles: Array.from(new Set(commandFilesList)),
    stealthExcluded,
    linkedSharedEvoDir,
    warmupReport,
    ideMounts,
  };
}

export const KNOWN_IDE_PROFILES: IdeProfile[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    relExtensionsDir: ['.vscode', 'extensions'],
    relRootDirs: [['.vscode']],
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    relExtensionsDir: ['.vscode-insiders', 'extensions'],
    relRootDirs: [['.vscode-insiders']],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    relExtensionsDir: ['.cursor', 'extensions'],
    relRootDirs: [['.cursor']],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    relExtensionsDir: ['.windsurf', 'extensions'],
    relRootDirs: [['.windsurf'], ['.codeium', 'windsurf']],
  },
  {
    id: 'windsurf-codeium',
    name: 'Windsurf (Codeium)',
    relExtensionsDir: ['.codeium', 'windsurf', 'extensions'],
    relRootDirs: [['.codeium', 'windsurf']],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    relExtensionsDir: ['.antigravity', 'extensions'],
    relRootDirs: [['.antigravity'], ['.gemini', 'antigravity']],
  },
  {
    id: 'trae',
    name: 'Trae',
    relExtensionsDir: ['.trae', 'extensions'],
    relRootDirs: [['.trae']],
  },
  {
    id: 'vscode-server',
    name: 'VS Code Server',
    relExtensionsDir: ['.vscode-server', 'extensions'],
    relRootDirs: [['.vscode-server']],
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    relExtensionsDir: ['.vscode-oss', 'extensions'],
    relRootDirs: [['.vscode-oss']],
  },
];

export function resolveExtensionSourceDir(workspaceRoot?: string): string {
  const candidates = [
    workspaceRoot ? path.resolve(workspaceRoot, 'templates', 'ide-extension') : '',
    path.resolve(import.meta.dirname, '..', '..', 'templates', 'ide-extension'),
    path.resolve(import.meta.dirname, '..', 'templates', 'ide-extension'),
    path.resolve(process.cwd(), 'templates', 'ide-extension'),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || candidates[0];
}

export function detectInstalledIdeExtensionsDirs(
  homeDir: string = os.homedir(),
  targetFilter?: string[]
): { profile: IdeProfile; extensionsDir: string }[] {
  if (process.env.EVO_IDE_EXTENSIONS_DIR) {
    const customDirs = process.env.EVO_IDE_EXTENSIONS_DIR.split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    return customDirs.map((d, idx) => ({
      profile: {
        id: `custom-${idx}`,
        name: `Custom IDE (${path.basename(path.dirname(d)) || idx})`,
        relExtensionsDir: [],
        relRootDirs: [],
      },
      extensionsDir: path.resolve(d),
    }));
  }

  const results: { profile: IdeProfile; extensionsDir: string }[] = [];
  const normalizedFilters = targetFilter?.map((t) => t.trim().toLowerCase());
  const selectAll =
    !normalizedFilters ||
    normalizedFilters.length === 0 ||
    normalizedFilters.includes('all') ||
    normalizedFilters.includes('auto');

  for (const profile of KNOWN_IDE_PROFILES) {
    const isExplicitlyRequested = normalizedFilters?.includes(profile.id);
    if (!selectAll && !isExplicitlyRequested) continue;

    const extDir = path.join(homeDir, ...profile.relExtensionsDir);
    const hasExtDir = fs.existsSync(extDir);

    let hasRootDir = false;
    for (const relRoot of profile.relRootDirs) {
      if (fs.existsSync(path.join(homeDir, ...relRoot))) {
        hasRootDir = true;
        break;
      }
    }

    if (hasExtDir || hasRootDir || isExplicitlyRequested) {
      results.push({ profile, extensionsDir: extDir });
    }
  }

  return results;
}

export function mountIdeExtensionIntoDir(
  extensionsDir: string,
  bundleSourceDir: string,
  options?: { forceCopy?: boolean }
): { method: 'junction' | 'symlink' | 'copy' | 'already-mounted'; status: 'installed' | 'updated' | 'skipped' } {
  fs.mkdirSync(extensionsDir, { recursive: true });
  const targetPath = path.join(extensionsDir, 'damonless.evo-kernel-cockpit');

  const safeReal = (p: string) => {
    try {
      return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };

  const expectedReal = safeReal(bundleSourceDir);

  let isLink = false;
  let exists = false;
  try {
    const stat = fs.lstatSync(targetPath);
    exists = true;
    isLink = stat.isSymbolicLink();
  } catch {}

  if (isLink) {
    try {
      const currentReal = safeReal(targetPath);
      if (!options?.forceCopy && currentReal.toLowerCase() === expectedReal.toLowerCase()) {
        return { method: 'already-mounted', status: 'skipped' };
      }
      fs.unlinkSync(targetPath);
    } catch {}
  } else if (exists) {
    try {
      if (!options?.forceCopy) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
    } catch {}
  }

  if (!options?.forceCopy) {
    try {
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(bundleSourceDir, targetPath, linkType);
      return { method: linkType, status: exists ? 'updated' : 'installed' };
    } catch {
      // Junction/symlink failed (cross-drive EXDEV or permission), fallback to copy
    }
  }

  fs.cpSync(bundleSourceDir, targetPath, { recursive: true, force: true });
  return { method: 'copy', status: exists ? 'updated' : 'installed' };
}

export function mountIdeExtensions(
  workspaceRootOrOptions?: string | { installIde?: boolean; noIde?: boolean; ide?: string[]; forceCopy?: boolean },
  maybeOptions?: { installIde?: boolean; noIde?: boolean; ide?: string[]; forceCopy?: boolean }
): MountIdeResult {
  let ws: string;
  let opts: { installIde?: boolean; noIde?: boolean; ide?: string[]; forceCopy?: boolean } | undefined;

  if (typeof workspaceRootOrOptions === 'string') {
    ws = workspaceRootOrOptions;
    opts = maybeOptions;
  } else {
    ws = process.cwd();
    opts = workspaceRootOrOptions;
  }

  if (opts?.noIde) {
    const empty: IdeMountDetail[] = [];
    return Object.assign([], { mounts: empty, totalMounted: 0 }) as MountIdeResult;
  }

  const sourceDir = resolveExtensionSourceDir(ws);
  const detected = detectInstalledIdeExtensionsDirs(os.homedir(), opts?.ide);
  const details: IdeMountDetail[] = [];

  for (const item of detected) {
    const extensionDir = item.extensionsDir;
    const profile = item.profile;
    const targetPath = path.join(extensionDir, 'damonless.evo-kernel-cockpit');
    try {
      const res = mountIdeExtensionIntoDir(extensionDir, sourceDir, { forceCopy: opts?.forceCopy });
      details.push({
        ide: profile.id,
        name: profile.name,
        extensionDir,
        targetPath,
        method: res.method,
        status: res.status,
      });
    } catch (err: any) {
      details.push({
        ide: profile.id,
        name: profile.name,
        extensionDir,
        targetPath,
        method: 'copy',
        status: 'failed',
        error: err?.message || String(err),
      });
    }
  }

  const totalMounted = details.filter((m) => m.status === 'installed' || m.status === 'updated').length;
  return Object.assign([...details], { mounts: details, totalMounted }) as MountIdeResult;
}

export function unmountIdeExtensions(): { cleanedTargets: string[]; errors: string[] } {
  const detected = detectInstalledIdeExtensionsDirs();
  const cleanedTargets: string[] = [];
  const errors: string[] = [];

  for (const item of detected) {
    const extensionDir = item.extensionsDir;
    const targetPath = path.join(extensionDir, 'damonless.evo-kernel-cockpit');
    try {
      let isLink = false;
      let exists = false;
      try {
        const stat = fs.lstatSync(targetPath);
        exists = true;
        isLink = stat.isSymbolicLink();
      } catch {}

      if (exists) {
        if (isLink) {
          fs.unlinkSync(targetPath);
        } else {
          fs.rmSync(targetPath, { recursive: true, force: true });
        }
        cleanedTargets.push(targetPath);
      }
    } catch (err: any) {
      errors.push(`${targetPath}: ${err?.message || String(err)}`);
    }
  }

  return { cleanedTargets, errors };
}

export function runUninstall(
  workspaceRoot: string,
  options?: { patterns?: string[] }
): { cleanedFiles: string[] } {
  const cleanedFilesList: string[] = [];
  const dirsToPrune: string[] = [
    '.claude/commands',
    '.cursor/commands',
    '.gemini/commands',
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

  unmountIdeExtensions();

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
        ...Object.keys(SLASH_COMMAND_DEFINITIONS).flatMap((file) => [
          `.claude/commands/${file}`,
          `.cursor/commands/${file}`,
          `.gemini/commands/${file}`,
        ]),
      ];
  removeGitInfoExclude(workspaceRoot, patternsToRemove);

  return { cleanedFiles: Array.from(new Set(cleanedFilesList)) };
}
