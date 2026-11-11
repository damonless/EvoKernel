#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findGitRoot, parseInitTargets, runInit, runUninstall } from './init.js';
import { extractCodexTomlEvoEntry, hasStaleNpxMcpEntry, parseJsonc } from './harness.js';
import { parseMaxCommitsArg, runBootstrap } from './bootstrap.js';
import { renderAuditReport, renderRefactorReport, runAudit, runRefactor } from './audit.js';
import * as child_process from 'node:child_process';
import {
  buildEvoStatsJson,
  buildEvoTreeJson,
  renderEvoStats,
  renderEvoTree,
  renderMemoryVerifyReport,
} from './visualizer.js';
import {
  formatCliInvocationPrefix,
  formatTerminalOutput,
  isAsciiMode,
  isColorEnabled,
  suggestClosestToken,
} from './term.js';

const { spawnSync } = child_process;
import { parseHookEvent, parseHookHarnessArg, parseHookPayloadArg, runHook } from './hook.js';
import { renderVirtualizeReport, runVirtualize } from './virtualize.js';
import { renderOptimizeHelp, runOptimizeCli } from './optimize.js';
import { buildScoreReport, runScoreCli } from './score.js';
import { runUiCli } from './ui.js';
import { startMcpStdioServer } from '../mcp/server.js';
import {
  EVO_KERNEL_VERSION,
  EvoStorage,
  findNearestEvoWorkspace,
  hasValidEvoStructure,
  isHostGlobalConfigDir,
  isPluginOrExtensionInstallDir,
  openSqliteReadOnly,
} from '../core/storage.js';
import {
  EvoTelemetry,
  emptyRecallWindowStats,
  readRecallWindowStatsFromDb,
} from '../core/telemetry.js';
import { refreshMemories, verifyMemoryFreshness } from '../core/memory.js';
import { inspectDeliverableFile } from '../core/deliverable.js';

export { EVO_KERNEL_VERSION };

function logHelp(text: string, args?: string[]): void {
  console.log(
    formatTerminalOutput(text, { color: isColorEnabled(args), ascii: isAsciiMode(args) })
  );
}

export function printHookHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo hook <event> [options]

Universal lifecycle hook router for anti-forgetting evolution enforcement and git pre-commit audit.

Events:
  pre-tool      Pre-tool execution guard hook
  post-tool     Post-tool execution guard hook (tracks mutations & injects reminders)
  stop          Post-session stop hook (detects uncommitted fixes / corrections)
  pre-commit    Git pre-commit hook (validates tokens, cache exclusion, and rule integrity)
  mark-recovery Records error-recovery telemetry for recent capability usage

Options:
  --payload <json>   Hook event payload as JSON string
  --workspace <path> Target workspace directory (default: current directory)
  --dry-run          Simulate hook execution without modifying telemetry or git state
  -h, --help         Show this help message
`,
    args
  );
}

export function printOptimizeHelp(args?: string[]): void {
  logHelp(renderOptimizeHelp(), args);
}

export function printScoreHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo score [options]

Instant 0-overhead diagnostic scoring for agent host tax, git bug hotspots, and memory coverage.

Options:
  --json               Output score report in JSON format
  --badge              Output markdown badge string
  --svg <path>         Export score badge as SVG file
  --html <path>        Export score report as standalone HTML
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printUiHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo ui [options]

Zero-dependency local EvoKernel Workbench for telemetry X-ray, budget treemap, and memory constellation.

Options:
  -p, --port <N>       Port to bind local Workbench server (default: 4310)
  --host <addr>        Loopback address to bind (default: 127.0.0.1)
  --open               Automatically open browser after startup
  --no-open            Do not open browser automatically
  --app, --desktop     Launch as native chromeless desktop window (1440x900)
  --token <str>        Pre-shared security token for UI authentication
  --export [path]      Export complete static HTML snapshot without starting server
  --anon               Anonymize workspace paths and non-seed capabilities
  --install-ide        Mount IDE extension into detected IDEs before starting server
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printInitHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo init [options]

Detect and wire L0 Meta-Rule Seed + Single Meta-MCP + Slash Commands into project and agent harnesses.

Options:
  --stealth            Add .evo/ and config files to .git/info/exclude (clean git status)
  --targets <list>     Harness targets: claude, agents, gemini, cursor, or auto (default: auto)
  --link <path>        Link .evo capability tree from another repository or central storage
  --warmup             Run cold-start capability warmup and AST pre-indexing after init (opt-in)
  --no-warmup          Skip background capability warmup and AST pre-indexing (default)
  --install-ide        Explicitly mount IDE extension into detected IDEs (opt-in, default: false)
  --no-ide             Skip IDE extension auto-mounting
  --ide <targets>      Comma-separated list of target IDEs (vscode, cursor, windsurf, trae, antigravity, all)
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printUninstallHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo uninstall [options]

Cleanly remove EvoKernel marker blocks, rules, and MCP registrations from host configs.

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printBootstrapHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo bootstrap [options]

Cold-start repo gene mining: extract verified initial Rules, Skills, Micro-Tools, and Episodic Memories.

Options:
  --max-commits <N>    Maximum recent commits to inspect (default: 50, clamp: 1-500)
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printVirtualizeHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo virtualize [options]

One-click fold third-party stdio MCPs from host configs into .evo/mcp-pool.json (0 schema bloat).

Options:
  --dry-run            Simulate virtualization without writing files
  --restore            Restore folded MCP servers back to host configs
  --global             Scan and virtualize global host configs (~/.claude, ~/.gemini, etc.)
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printMemoryHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo memory [verify|refresh] [options]

Audit AST structural fingerprints and live topology anchors across all Episodic Memories (.evo/memories/).

Subcommands:
  verify               Verify memory freshness against working tree AST (default)
  refresh              Re-anchor drifted AST fingerprints to current commit/branch

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printAuditHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo audit [options]

Scan workspace and global rules/skills for domain leaks, overlap, and token budget bloat.

Options:
  --global, -g         Include user-level global rules (~/.gemini, ~/.claude, ~/.cursor)
  --token-budget <N>   Override per-file token budget limit (default: 1500)
  --skill-budget <N>   Override per-skill token budget limit (default: 1000)
  --json               Output audit report in JSON format
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printRefactorHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo refactor [options]

Launch 4-stage Rule & Skill decoupling workflow via built-in evo-rule-architect meta-skill.

Options:
  --apply              Apply suggested rule & skill refactoring migrations
  --local-only         Refactor project workspace rules only (exclude global)
  --token-budget <N>   Override per-file token budget limit (default: 1500)
  --skill-budget <N>   Override per-skill token budget limit (default: 1000)
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printCheckHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo check <file> [options]
  evo inspect <file> [options]

Canonical defect inspection and format verification for deliverable artifacts (.xlsx, .docx, .pptx, .csv, .json, .md).

Options:
  --json               Output inspection results as structured JSON
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printTreeHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo tree [options]

Render the ASCII Self-Evolving Capability & Cognitive Memory Tree (.evo/).

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printStatsHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo stats [options]

Deprecated alias for 'evo doctor --roi': displays ROI Telemetry Ledger, Session-Start Tax, and Memory Freshness.

Options:
  --json               Output ROI & telemetry ledger in JSON format
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printDoctorHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo doctor [options]

Verify Node runtime, SQLite FTS5 BM25 engine, live MCP stdio handshake, seed/version parity, and AST Memory health.

Options:
  --roi                Include full ROI & session-start token tax breakdown (replaces 'evo stats')
  --no-probe           Skip live 5,000ms stdio MCP handshake probe
  --json               Output diagnostics report in JSON format
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function printMcpHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo mcp [options]

Start the stdio JSON-RPC 2.0 Single Meta-MCP Server (Fixed 5 Meta-Tools).

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`,
    args
  );
}

export function readStdinTextWithTimeout(
  initialTimeoutMs: number = 200,
  chunkTimeoutMs: number = 300
): Promise<string> {
  return new Promise((resolve) => {
    try {
      if (process.stdin.isTTY) {
        return resolve('');
      }
      const stat = fs.fstatSync(0);
      if (stat.isFile()) {
        if (stat.size === 0) return resolve('');
        return resolve(fs.readFileSync(0, 'utf8').trim());
      }
    } catch {
      // fstat failed, continue to stream
    }

    let data = '';
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    function finish(res: string): void {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        try { process.stdin.pause(); } catch {}
        try { process.stdin.destroy(); } catch {}
        resolve(res);
      }
    }

    timer = setTimeout(() => {
      finish(data.trim());
    }, initialTimeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
      try {
        JSON.parse(data.trim());
        finish(data.trim());
      } catch {
        // Chunk arrived but JSON incomplete: data is actively streaming.
        // Reset timer so slow/large multi-chunk streams are not prematurely cut off.
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          finish(data.trim());
        }, chunkTimeoutMs);
      }
    });

    process.stdin.on('end', () => {
      finish(data.trim());
    });

    process.stdin.on('error', () => {
      finish('');
    });

    process.stdin.resume();
  });
}

export function checkNodeRuntimeVersion(
  versionStr: string = process.versions.node || '0.0.0',
  argsOrOpts?: string[] | { color?: boolean; ascii?: boolean }
): {
  ok: boolean;
  major: number;
  minor: number;
  message?: string;
} {
  const parts = String(versionStr).replace(/^v/i, '').split('.');
  const major = Number.parseInt(parts[0] || '0', 10);
  const minor = Number.parseInt(parts[1] || '0', 10);
  const ok = major > 22 || (major === 22 && minor >= 5);
  if (ok) {
    return { ok: true, major, minor };
  }
  const termOpts = Array.isArray(argsOrOpts)
    ? { color: isColorEnabled(argsOrOpts), ascii: isAsciiMode(argsOrOpts) }
    : argsOrOpts ?? { color: isColorEnabled(), ascii: isAsciiMode() };
  const rawMessage =
    `❌ EvoKernel requires Node.js >= 22.5.0 (detected v${versionStr}).\n` +
    `   Why: EvoKernel runs with 0 external dependencies using native node:sqlite and node:module.\n` +
    `   Instant 1-liner (no global Node change): npx -y -p node@22 evo-kernel <command>\n` +
    `   Fix: switch Node runtime via:\n` +
    `     • nvm install 22 && nvm use 22\n` +
    `     • fnm use 22\n` +
    `     • volta install node@22`;
  return {
    ok: false,
    major,
    minor,
    message: formatTerminalOutput(rawMessage, termOpts),
  };
}

function printHelp(args?: string[]): void {
  logHelp(
    `
🧬 EvoKernel v${EVO_KERNEL_VERSION} — AST-Verified Cognitive Memory & Deterministic Context OS for AI Agents

Usage:
  evo <command> [options]

Core Commands (6):
  init [--stealth] [--targets <list|auto>] [--warmup] [--install-ide]
                      Wire L0 Meta-Rule Seed + Single 5-Tool Meta-MCP + Slash Commands into agent hosts
  doctor [--roi] [--no-probe] [--json]
                      Verify runtime, live MCP stdio handshake, seed/version parity, AST* memories & ROI
  ui [-p <N>] [--open] [--app] [--desktop] [--export [path]] [--anon]
                      Launch local EvoKernel Workbench (7d recall pulse, Needs Attention triage & topology)
  score [--json] [--badge] [--svg <path>] [--html <path>] [--anon]
                      Generate shareable X-Ray report of session-start token tax & git fragility hotspots
  memory [verify|refresh]
                      Verify or re-anchor 16-hex AST* structural fingerprints across Episodic Memories
  audit [--global] [--json] [--token-budget <N>] [--skill-budget <N>]
                      Audit workspace & global rule/skill files for domain leaks, duplicates, and bloat

Advanced & Automation Commands:
  bootstrap [--max-commits <N>]
                      Cold-start repo gene mining: extract verified Rules, Skills, Micro-Tools & Memories
  virtualize [--dry-run] [--restore] [--global]
                      Fold third-party stdio MCPs into .evo/mcp-pool.json (preview first with --dry-run)
  refactor [--apply] [--local-only] [--token-budget <N>] [--skill-budget <N>]
                      Decouple bloated rules/skills via built-in evo-rule-architect workflow
  tree [--full] [--json]
                      Render ASCII capability & cognitive memory tree (.evo/)
  check <file> [--json]
                      Canonical defect inspection for deliverables (.xlsx, .docx, .pptx, .csv, .json, .md)
  optimize [--dim inv|dom|both] [-k <N>] [--proposer-cmd <cmd>] [--probe-cmd <cmd>] [--apply]
                      Offline Git worktree optimization cycle with isolated probe verification
  hook <event>        Lifecycle hook router (pre-tool | post-tool | stop | pre-commit)
  mcp                 Start stdio JSON-RPC 2.0 Single Meta-MCP Server (Fixed 5 Meta-Tools)
  uninstall           Cleanly remove EvoKernel marker blocks and MCP entries from host configs
  version, --version  Print EvoKernel CLI version
`,
    args
  );
}

function copyDirNonOverwriting(
  srcDir: string,
  destDir: string,
  syncUpdatedSeeds: boolean = false,
  allowScoped: boolean = false
): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (
      entry.name === '.cache' ||
      entry.name === 'archive' ||
      (entry.name === 'scoped' && !allowScoped) ||
      entry.name === 'core-invariants.md'
    ) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirNonOverwriting(srcPath, destPath, syncUpdatedSeeds, allowScoped);
    } else if (entry.isFile()) {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
      } else if (syncUpdatedSeeds) {
        const srcContent = fs.readFileSync(srcPath, 'utf8').replace(/\r?\n/g, '\n');
        const destContent = fs.readFileSync(destPath, 'utf8').replace(/\r?\n/g, '\n');
        if (srcContent !== destContent) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  }
}

export function resolveGlobalFallbackDir(customGlobalDir?: string): string {
  if (customGlobalDir) {
    return path.resolve(customGlobalDir);
  }
  if (process.env.EVO_GLOBAL_DIR) {
    return path.resolve(process.env.EVO_GLOBAL_DIR);
  }
  return path.join(os.homedir(), '.evo', 'global');
}

export function ensureGlobalFallbackSeeded(
  globalRoot: string = resolveGlobalFallbackDir(),
  installRoot: string = path.resolve(import.meta.dirname, '..', '..')
): string {
  const storage = new EvoStorage(globalRoot);
  storage.ensureInitialized();

  const templateSeedDir = path.join(installRoot, 'templates', 'seed-evo');
  const hasTemplateSeed = fs.existsSync(templateSeedDir);
  const seedEvoDir = hasTemplateSeed ? templateSeedDir : path.join(installRoot, '.evo');

  if (fs.existsSync(seedEvoDir) && path.resolve(seedEvoDir) !== path.resolve(storage.evoDir)) {
    for (const sub of ['rules', 'skills', 'tools']) {
      copyDirNonOverwriting(
        path.join(seedEvoDir, sub),
        path.join(storage.evoDir, sub),
        hasTemplateSeed,
        hasTemplateSeed
      );
    }
    if (!hasTemplateSeed) {
      const scopedSeedSrc = path.join(seedEvoDir, 'rules', 'scoped', 'esm-typescript-imports.md');
      const scopedSeedDest = path.join(storage.evoDir, 'rules', 'scoped', 'esm-typescript-imports.md');
      if (fs.existsSync(scopedSeedSrc) && !fs.existsSync(scopedSeedDest)) {
        fs.mkdirSync(path.dirname(scopedSeedDest), { recursive: true });
        fs.copyFileSync(scopedSeedSrc, scopedSeedDest);
      }
    }
    const legacyTopLevelTsRule = path.join(storage.evoDir, 'rules', 'esm-typescript-imports.md');
    const canonicalScopedTsRule = path.join(storage.evoDir, 'rules', 'scoped', 'esm-typescript-imports.md');
    if (fs.existsSync(legacyTopLevelTsRule) && fs.existsSync(canonicalScopedTsRule)) {
      try {
        fs.unlinkSync(legacyTopLevelTsRule);
      } catch {}
    }
    storage.rebuildCoreInvariantsDigest();
  }

  return globalRoot;
}

export function resolveWorkspaceRoot(
  args: string[],
  allowGlobalFallbackOrOpts: boolean | { allowGlobalFallback?: boolean; cwdOverride?: string },
  cwdOverride?: string
): string {
  const allowGlobalFallback =
    typeof allowGlobalFallbackOrOpts === 'object' && allowGlobalFallbackOrOpts !== null
      ? allowGlobalFallbackOrOpts.allowGlobalFallback !== false
      : Boolean(allowGlobalFallbackOrOpts);
  const resolvedCwdOverride =
    typeof allowGlobalFallbackOrOpts === 'object' && allowGlobalFallbackOrOpts !== null
      ? allowGlobalFallbackOrOpts.cwdOverride ?? cwdOverride
      : cwdOverride;
  const wsEq = args.find((a) => a.startsWith('--workspace='));
  if (wsEq) {
    const explicit = path.resolve(wsEq.slice('--workspace='.length));
    if (isHostGlobalConfigDir(explicit)) {
      return ensureGlobalFallbackSeeded(resolveGlobalFallbackDir());
    }
    return findNearestEvoWorkspace(explicit) || explicit;
  }
  const wsFlagIdx = args.indexOf('--workspace') !== -1 ? args.indexOf('--workspace') : args.indexOf('-w');
  if (wsFlagIdx !== -1 && args[wsFlagIdx + 1] && !args[wsFlagIdx + 1].startsWith('-')) {
    const explicit = path.resolve(args[wsFlagIdx + 1]);
    if (isHostGlobalConfigDir(explicit)) {
      return ensureGlobalFallbackSeeded(resolveGlobalFallbackDir());
    }
    return findNearestEvoWorkspace(explicit) || explicit;
  }
  if (process.env.EVO_WORKSPACE) {
    const envWs = path.resolve(process.env.EVO_WORKSPACE);
    if (isHostGlobalConfigDir(envWs)) {
      return ensureGlobalFallbackSeeded(resolveGlobalFallbackDir());
    }
    return findNearestEvoWorkspace(envWs) || envWs;
  }
  const cwd = path.resolve(resolvedCwdOverride || process.cwd());
  if (isHostGlobalConfigDir(cwd)) {
    return ensureGlobalFallbackSeeded(resolveGlobalFallbackDir());
  }
  if (!allowGlobalFallback) {
    return cwd;
  }
  if (isPluginOrExtensionInstallDir(cwd)) {
    return ensureGlobalFallbackSeeded(resolveGlobalFallbackDir());
  }
  const nearest = findNearestEvoWorkspace(cwd);
  if (nearest) {
    return nearest;
  }
  if (fs.existsSync(path.join(cwd, '.evo'))) {
    return cwd;
  }
  return ensureGlobalFallbackSeeded(resolveGlobalFallbackDir());
}

export function parseTargetsArg(args: string[], workspaceRoot: string): string[] | undefined {
  const eqArg = args.find((a) => a.startsWith('--targets='));
  if (eqArg) {
    return parseInitTargets(eqArg.slice('--targets='.length), workspaceRoot);
  }
  const idx = args.indexOf('--targets');
  if (idx !== -1) {
    const collected: string[] = [];
    for (let i = idx + 1; i < args.length; i++) {
      if (args[i].startsWith('-')) break;
      collected.push(args[i]);
    }
    return parseInitTargets(collected.join(','), workspaceRoot);
  }
  return undefined;
}

export function parseLinkArg(args: string[]): string | undefined {
  const eqArg = args.find((a) => a.startsWith('--link='));
  if (eqArg) {
    return eqArg.slice('--link='.length).trim() || undefined;
  }
  const idx = args.indexOf('--link');
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return args[idx + 1].trim();
  }
  return undefined;
}

export function parsePositiveIntFlag(args: string[], flag: string): number | undefined {
  const eqArg = args.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) {
    const n = Number.parseInt(eqArg.slice(flag.length + 1).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    const n = Number.parseInt(args[idx + 1].trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

export function parseIdeTargetsArg(args: string[]): string[] | undefined {
  const eqArg = args.find((a) => a.startsWith('--ide='));
  if (eqArg) {
    return eqArg
      .slice('--ide='.length)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  const idx = args.indexOf('--ide');
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return args[idx + 1]
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return undefined;
}

export const VALID_COMMANDS = [
  'score',
  'ui',
  'init',
  'bootstrap',
  'virtualize',
  'memory',
  'memories',
  'audit',
  'refactor',
  'tree',
  'stats',
  'mcp',
  'hook',
  'optimize',
  'check',
  'inspect',
  'doctor',
  'uninstall',
  'version',
  'help',
];

const GLOBAL_COMMON_FLAGS = [
  '--workspace',
  '-w',
  '--help',
  '-h',
  '--version',
  '-v',
  '--ascii',
  '--no-color',
];

export const COMMAND_VALID_FLAGS: Record<string, string[]> = {
  score: [...GLOBAL_COMMON_FLAGS, '--json', '--badge', '--svg', '--html', '--anon', '--global', '-g'],
  ui: [
    ...GLOBAL_COMMON_FLAGS,
    '--port',
    '-p',
    '--host',
    '--open',
    '--no-open',
    '--app',
    '--desktop',
    '--token',
    '--export',
    '--anon',
    '--install-ide',
  ],
  init: [
    ...GLOBAL_COMMON_FLAGS,
    '--stealth',
    '--targets',
    '--link',
    '--warmup',
    '--no-warmup',
    '--install-ide',
    '--no-ide',
    '--ide',
  ],
  uninstall: [...GLOBAL_COMMON_FLAGS],
  bootstrap: [...GLOBAL_COMMON_FLAGS, '--max-commits'],
  virtualize: [...GLOBAL_COMMON_FLAGS, '--dry-run', '--restore', '--global', '-g'],
  memory: [...GLOBAL_COMMON_FLAGS, '--refresh', '--json'],
  memories: [...GLOBAL_COMMON_FLAGS, '--refresh', '--json'],
  audit: [...GLOBAL_COMMON_FLAGS, '--global', '-g', '--token-budget', '--skill-budget', '--json'],
  refactor: [
    ...GLOBAL_COMMON_FLAGS,
    '--apply',
    '--local-only',
    '--global',
    '-g',
    '--token-budget',
    '--skill-budget',
    '--json',
  ],
  tree: [...GLOBAL_COMMON_FLAGS, '--json', '--full'],
  stats: [...GLOBAL_COMMON_FLAGS, '--json'],
  doctor: [...GLOBAL_COMMON_FLAGS, '--json', '--roi', '--probe', '--no-probe'],
  check: [...GLOBAL_COMMON_FLAGS, '--json'],
  inspect: [...GLOBAL_COMMON_FLAGS, '--json'],
  optimize: [
    ...GLOBAL_COMMON_FLAGS,
    '--dim',
    '-k',
    '--k',
    '--rounds',
    '--proposer-cmd',
    '--probe-cmd',
    '--worktree-setup-cmd',
    '--task',
    '--task-file',
    '--trajectory',
    '--trajectories',
    '--deliverable',
    '--deliverables',
    '--leak-glob',
    '--auto',
    '--prepare',
    '--apply',
    '--dry-run',
    '--json',
    '--require-probe-improvement',
    '--no-require-probe-improvement',
  ],
  version: [...GLOBAL_COMMON_FLAGS],
  help: [...GLOBAL_COMMON_FLAGS],
};

export const KNOWN_FLAGS = Array.from(
  new Set(Object.values(COMMAND_VALID_FLAGS).flat())
);

export const SUPPORTED_CHECK_EXTS = new Set([
  '.xlsx',
  '.xls',
  '.docx',
  '.pptx',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
]);

function handleExit(code: number): void {
  const isTestProcess = Boolean(process.argv[1]?.includes('.test.'));
  if (!isTestProcess) {
    process.exit(code);
  } else {
    process.exitCode = code;
  }
}

export interface McpLaunchTarget {
  source: string;
  command: string;
  args: string[];
  isWorkspace: boolean;
}

export interface McpInspection {
  registered: boolean;
  foundConfigs: string[];
  staleNpxPath: boolean;
  launchConfig?: McpLaunchTarget;
  workspaceLaunchConfig?: McpLaunchTarget;
}

export interface McpHandshakeProbeResult {
  attempted: boolean;
  skipped?: boolean;
  reachable: boolean;
  source?: string;
  serverVersion?: string;
  toolCount: number;
  latencyMs?: number;
  error?: string;
}

function extractLaunchTargetFromEntry(
  entry: any,
  source: string,
  isWorkspace: boolean
): McpLaunchTarget | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  if (typeof entry.command === 'string' && entry.command.trim()) {
    return {
      source,
      command: entry.command.trim(),
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      isWorkspace,
    };
  }
  if (Array.isArray(entry.command) && entry.command.length > 0 && typeof entry.command[0] === 'string') {
    return {
      source,
      command: entry.command[0].trim(),
      args: entry.command.slice(1).map(String),
      isWorkspace,
    };
  }
  return undefined;
}

export function checkMcpGatewayConfigs(
  workspaceRoot: string,
  globalHomeDir?: string
): McpInspection {
  const ws = path.resolve(workspaceRoot);
  const wsConfigs = [
    { name: '.mcp.json', path: path.join(ws, '.mcp.json'), isWorkspace: true },
    { name: '.cursor/mcp.json', path: path.join(ws, '.cursor', 'mcp.json'), isWorkspace: true },
    { name: '.vscode/mcp.json', path: path.join(ws, '.vscode', 'mcp.json'), isWorkspace: true },
    { name: '.codex/config.toml', path: path.join(ws, '.codex', 'config.toml'), isWorkspace: true },
    { name: 'opencode.json', path: path.join(ws, 'opencode.json'), isWorkspace: true },
    { name: '.gemini/settings.json', path: path.join(ws, '.gemini', 'settings.json'), isWorkspace: true },
    { name: '.windsurf/mcp.json', path: path.join(ws, '.windsurf', 'mcp.json'), isWorkspace: true },
    { name: '.windsurf/mcp_config.json', path: path.join(ws, '.windsurf', 'mcp_config.json'), isWorkspace: true },
    { name: '.cline/mcp.json', path: path.join(ws, '.cline', 'mcp.json'), isWorkspace: true },
    { name: '.roo/mcp.json', path: path.join(ws, '.roo', 'mcp.json'), isWorkspace: true },
    { name: 'mcp_config.json', path: path.join(ws, 'mcp_config.json'), isWorkspace: true },
  ];

  const homeDir = path.resolve(globalHomeDir || os.homedir());
  const globalConfigs = [
    {
      name: '~/.gemini/antigravity/mcp_config.json',
      path: path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json'),
      isWorkspace: false,
    },
    {
      name: '~/.gemini/settings.json',
      path: path.join(homeDir, '.gemini', 'settings.json'),
      isWorkspace: false,
    },
    { name: '~/.claude.json', path: path.join(homeDir, '.claude.json'), isWorkspace: false },
    { name: '~/.cursor/mcp.json', path: path.join(homeDir, '.cursor', 'mcp.json'), isWorkspace: false },
    { name: '~/.codex/config.toml', path: path.join(homeDir, '.codex', 'config.toml'), isWorkspace: false },
    {
      name: '~/.codeium/windsurf/mcp_config.json',
      path: path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
      isWorkspace: false,
    },
  ];

  const allConfigs = [...wsConfigs, ...globalConfigs];
  const foundConfigs: string[] = [];
  let staleNpxPath = false;
  let launchConfig: McpLaunchTarget | undefined;
  let workspaceLaunchConfig: McpLaunchTarget | undefined;

  for (const cfg of allConfigs) {
    if (!fs.existsSync(cfg.path)) continue;
    try {
      const content = fs.readFileSync(cfg.path, 'utf8');
      if (!content.includes('evo-kernel') && !content.includes('evo')) continue;

      let isConfigured = false;
      const cfgRoot = cfg.isWorkspace ? ws : path.dirname(cfg.path);

      if (cfg.path.endsWith('.toml')) {
        const tomlEntry = extractCodexTomlEvoEntry(content);
        if (tomlEntry) {
          isConfigured = true;
          if (
            hasStaleNpxMcpEntry({ command: tomlEntry.command, args: tomlEntry.args }, cfgRoot) ||
            hasStaleNpxMcpEntry(tomlEntry.rawSection, cfgRoot)
          ) {
            staleNpxPath = true;
          }
          const target = extractLaunchTargetFromEntry(
            { command: tomlEntry.command, args: tomlEntry.args },
            cfg.name,
            cfg.isWorkspace
          );
          if (target) {
            if (cfg.isWorkspace && !workspaceLaunchConfig) workspaceLaunchConfig = target;
            if (!launchConfig) launchConfig = target;
          }
        }
      } else {
        try {
          const parsed = parseJsonc(content);
          if (parsed && typeof parsed === 'object') {
            const buckets: Record<string, any>[] = [];
            if (parsed.mcpServers && typeof parsed.mcpServers === 'object') buckets.push(parsed.mcpServers);
            if (parsed.mcp_servers && typeof parsed.mcp_servers === 'object') buckets.push(parsed.mcp_servers);
            if (parsed.servers && typeof parsed.servers === 'object') buckets.push(parsed.servers);
            if (parsed.mcp && typeof parsed.mcp === 'object') {
              if (parsed.mcp.servers && typeof parsed.mcp.servers === 'object') {
                buckets.push(parsed.mcp.servers);
              } else if (!Array.isArray(parsed.mcp)) {
                buckets.push(parsed.mcp);
              }
            }
            if (parsed['evo-kernel'] && typeof parsed['evo-kernel'] === 'object') {
              buckets.push({ 'evo-kernel': parsed['evo-kernel'] });
            }
            if (parsed.projects && typeof parsed.projects === 'object') {
              const normWs = ws.toLowerCase().replace(/\\/g, '/');
              for (const [pKey, pVal] of Object.entries(parsed.projects as Record<string, any>)) {
                if (pKey.toLowerCase().replace(/\\/g, '/') === normWs && pVal?.mcpServers) {
                  buckets.push(pVal.mcpServers);
                }
              }
            }

            for (const servers of buckets) {
              const entry = servers['evo-kernel'] || servers.evo || servers.evokernel;
              if (entry && typeof entry === 'object') {
                isConfigured = true;
                if (hasStaleNpxMcpEntry(entry, cfgRoot)) {
                  staleNpxPath = true;
                }
                const target = extractLaunchTargetFromEntry(entry, cfg.name, cfg.isWorkspace);
                if (target) {
                  if (cfg.isWorkspace && !workspaceLaunchConfig) workspaceLaunchConfig = target;
                  if (!launchConfig) launchConfig = target;
                }
              }
            }
          }
        } catch {
          if (content.includes('evo-kernel')) {
            isConfigured = true;
            if (hasStaleNpxMcpEntry(content, cfgRoot)) {
              staleNpxPath = true;
            }
          }
        }
      }

      if (isConfigured && !foundConfigs.includes(cfg.name)) {
        foundConfigs.push(cfg.name);
      }
    } catch {}
  }

  return {
    registered: foundConfigs.length > 0,
    foundConfigs,
    staleNpxPath,
    launchConfig: workspaceLaunchConfig || launchConfig,
    workspaceLaunchConfig,
  };
}

const MCP_STDIO_PROBE_SCRIPT = `
const { spawn } = require('node:child_process');
const cfg = JSON.parse(process.env.EVO_MCP_PROBE_CFG || '{}');
const t0 = Date.now();
const isWin = process.platform === 'win32';
let cmd = cfg.command || '';
let cArgs = Array.isArray(cfg.args) ? cfg.args : [];
if (/^node(?:\\.exe)?$/i.test(cmd)) {
  cmd = process.execPath;
}
let child;
try {
  if (isWin && /^(?:npx|npm|pnpm|yarn)(?:\\.cmd)?$/i.test(cmd)) {
    const q = (arg) => {
      const s = String(arg);
      if (!/[\\s"&|<>^()%]/.test(s)) return s;
      const crt = '"' + s.replace(/(\\\\*)"/g, '$1$1\\\\"').replace(/(\\\\+)$/, '$1$1') + '"';
      let out = '';
      let inCmdQuote = false;
      for (let i = 0; i < crt.length; i++) {
        const ch = crt[i];
        if (ch === '"') {
          inCmdQuote = !inCmdQuote;
          out += ch;
        } else if (ch === '%') {
          out += inCmdQuote ? '"^%"' : '^%';
        } else if (!inCmdQuote && /[&|<>^()]/.test(ch)) {
          out += '^^^' + ch;
        } else {
          out += ch;
        }
      }
      return out;
    };
    const full = [q(/\\.cmd$/i.test(cmd) ? cmd : cmd + '.cmd'), ...cArgs.map(q)].join(' ');
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + full + '"'], {
      cwd: cfg.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: true,
      env: { ...process.env, EVO_WORKSPACE: cfg.cwd },
    });
  } else {
    child = spawn(cmd, cArgs, {
      cwd: cfg.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, EVO_WORKSPACE: cfg.cwd },
    });
  }
} catch (err) {
  process.stdout.write(JSON.stringify({ reachable: false, toolCount: 0, error: String(err && err.message || err) }));
  process.exit(0);
}
let settled = false;
let initRes = null;
let toolsRes = null;
let outBuf = '';
let errBuf = '';
function finish(payload) {
  if (settled) return;
  settled = true;
  try { child.kill(); } catch {}
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}
const timer = setTimeout(() => {
  finish({
    reachable: false,
    toolCount: 0,
    latencyMs: Date.now() - t0,
    error: 'Handshake timed out after ' + (cfg.timeoutMs || 5000) + 'ms',
  });
}, cfg.timeoutMs || 5000);
child.on('error', (err) => {
  clearTimeout(timer);
  finish({ reachable: false, toolCount: 0, latencyMs: Date.now() - t0, error: String(err && err.message || err) });
});
child.stderr.on('data', (d) => {
  if (errBuf.length < 1024) errBuf += d.toString('utf8');
});
child.stdout.on('data', (d) => {
  outBuf += d.toString('utf8');
  const lines = outBuf.split(/\\r?\\n/);
  outBuf = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id === 1 && msg.result) initRes = msg.result;
      if (msg.id === 2 && msg.result) toolsRes = msg.result;
    } catch {}
  }
  if (initRes && toolsRes) {
    clearTimeout(timer);
    const tools = Array.isArray(toolsRes.tools) ? toolsRes.tools : [];
    finish({
      reachable: tools.length === 5,
      serverVersion: initRes.serverInfo && initRes.serverInfo.version ? String(initRes.serverInfo.version) : undefined,
      toolCount: tools.length,
      latencyMs: Date.now() - t0,
      error: tools.length === 5 ? undefined : 'Expected 5 meta-tools, received ' + tools.length,
    });
  }
});
child.on('close', (code) => {
  clearTimeout(timer);
  if (!settled) {
    const snippet = errBuf.trim().split(/\\r?\\n/)[0] || ('Process exited with code ' + code);
    finish({ reachable: false, toolCount: 0, latencyMs: Date.now() - t0, error: snippet });
  }
});
try {
  const initFrame = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'evo-doctor-probe', version: '1.0.0' },
    },
  });
  const listFrame = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  child.stdin.write(initFrame + '\\n' + listFrame + '\\n');
  child.stdin.end();
} catch (err) {
  clearTimeout(timer);
  finish({ reachable: false, toolCount: 0, error: String(err && err.message || err) });
}
`;

export function probeMcpServerStdioSync(
  workspaceRoot: string,
  target: McpLaunchTarget,
  timeoutMs = 5000
): McpHandshakeProbeResult {
  const ws = path.resolve(workspaceRoot);
  try {
    const res = spawnSync(process.execPath, ['-e', MCP_STDIO_PROBE_SCRIPT], {
      cwd: ws,
      encoding: 'utf8',
      timeout: timeoutMs + 500,
      env: {
        ...process.env,
        EVO_MCP_PROBE_CFG: JSON.stringify({
          command: target.command,
          args: target.args,
          cwd: ws,
          timeoutMs,
        }),
      },
    });
    if (res.stdout && res.stdout.trim()) {
      const parsed = JSON.parse(res.stdout.trim());
      return {
        attempted: true,
        reachable: Boolean(parsed.reachable),
        source: target.source,
        serverVersion: parsed.serverVersion,
        toolCount: Number(parsed.toolCount || 0),
        latencyMs: Number(parsed.latencyMs || 0),
        error: parsed.error,
      };
    }
    return {
      attempted: true,
      reachable: false,
      source: target.source,
      toolCount: 0,
      error: res.error ? res.error.message : 'Handshake probe timed out or produced no output',
    };
  } catch (err: any) {
    return {
      attempted: true,
      reachable: false,
      source: target.source,
      toolCount: 0,
      error: err?.message || String(err),
    };
  }
}

export interface SeedInspection {
  present: string[];
  valid: string[];
  duplicateBlocks: number;
}

export function checkSeedIntegrity(workspaceRoot: string): SeedInspection {
  const seedFiles = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];
  const present: string[] = [];
  const valid: string[] = [];
  let duplicateBlocks = 0;

  for (const sf of seedFiles) {
    const p = path.join(workspaceRoot, sf);
    if (fs.existsSync(p)) {
      present.push(sf);
      try {
        const text = fs.readFileSync(p, 'utf8');
        const startMatches = text.match(/<!--\s*EVO:START\s*-->/g) || [];
        if (startMatches.length === 1 && text.includes('<!-- EVO:END -->')) {
          valid.push(sf);
        } else if (startMatches.length > 1) {
          duplicateBlocks += startMatches.length - 1;
        }
      } catch {}
    }
  }

  return { present, valid, duplicateBlocks };
}

export const VALUE_TAKING_FLAGS = new Set([
  '--workspace',
  '-w',
  '--port',
  '-p',
  '--host',
  '--token',
  '--export',
  '--svg',
  '--html',
  '--targets',
  '--link',
  '--ide',
  '--max-commits',
  '--token-budget',
  '--skill-budget',
  '--dim',
  '-k',
  '--k',
  '--rounds',
  '--proposer-cmd',
  '--probe-cmd',
  '--worktree-setup-cmd',
  '--task',
  '--task-file',
  '--trajectory',
  '--trajectories',
  '--deliverable',
  '--deliverables',
  '--leak-glob',
  '--payload',
  '--harness',
  '--event',
  '--tool',
  '--file',
]);

function normalizeLeadingFlags(rawArgs: string[]): string[] {
  if (rawArgs.length === 0 || !rawArgs[0].startsWith('-')) {
    return rawArgs;
  }
  const firstLower = rawArgs[0].toLowerCase();
  if (firstLower === '--version' || firstLower === '-v' || firstLower === '--help' || firstLower === '-h') {
    return rawArgs;
  }
  const leadingFlags: string[] = [];
  let i = 0;
  while (i < rawArgs.length && rawArgs[i].startsWith('-')) {
    const flag = rawArgs[i];
    leadingFlags.push(flag);
    if (VALUE_TAKING_FLAGS.has(flag.toLowerCase()) && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
      leadingFlags.push(rawArgs[i + 1]);
      i += 2;
    } else {
      i += 1;
    }
  }
  if (i < rawArgs.length) {
    return [...rawArgs.slice(i), ...leadingFlags];
  }
  return rawArgs;
}

export function runCli(argv: string[]): void {
  const args = normalizeLeadingFlags(argv.slice(2));
  const cliTermOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
  let cmd = (args[0] || '').toLowerCase();
  if (!cmd && process.stdout.isTTY && !process.env.CI) {
    cmd = 'score';
  } else if (!cmd) {
    cmd = 'help';
  }

  // Early version interception: ZERO side-effects (no file reads/writes, no global seed, exit code 0)
  let hasStandaloneVersionFlag = false;
  if (cmd !== 'hook' && cmd !== 'mcp') {
    for (let idx = 0; idx < args.length; idx++) {
      const a = args[idx];
      if (a === '--version' || a === '-v') {
        hasStandaloneVersionFlag = true;
        break;
      }
      if (a.startsWith('-') && VALUE_TAKING_FLAGS.has(a.toLowerCase()) && idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
        idx++;
      }
    }
  }
  if (
    cmd === 'version' ||
    cmd === '--version' ||
    cmd === '-v' ||
    hasStandaloneVersionFlag
  ) {
    console.log(formatTerminalOutput(EVO_KERNEL_VERSION, cliTermOpts));
    return;
  }

  // Early help interception: ZERO side-effects (no file reads/writes, no global seed, exit code 0)
  const isHelpRequested =
    args.includes('--help') ||
    args.includes('-h') ||
    cmd === 'help' ||
    cmd === '--help' ||
    cmd === '-h';

  if (isHelpRequested) {
    let targetSubcmd = cmd;
    if (cmd === 'help' || cmd === '--help' || cmd === '-h' || cmd.startsWith('-')) {
      let sub = '';
      for (let idx = 0; idx < args.length; idx++) {
        const a = args[idx];
        if (a.startsWith('-')) {
          if (VALUE_TAKING_FLAGS.has(a.toLowerCase()) && idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
            idx++;
          }
          continue;
        }
        const lower = a.toLowerCase();
        if (lower !== 'help' && VALID_COMMANDS.includes(lower)) {
          sub = lower;
          break;
        }
      }
      targetSubcmd = sub || (cmd === 'help' ? (args[1] || '').toLowerCase() : '');
    }

    switch (targetSubcmd) {
      case 'hook':
        printHookHelp(args);
        return;
      case 'optimize':
        printOptimizeHelp(args);
        return;
      case 'score':
        printScoreHelp(args);
        return;
      case 'ui':
        printUiHelp(args);
        return;
      case 'init':
        printInitHelp(args);
        return;
      case 'uninstall':
        printUninstallHelp(args);
        return;
      case 'bootstrap':
        printBootstrapHelp(args);
        return;
      case 'virtualize':
        printVirtualizeHelp(args);
        return;
      case 'memory':
      case 'memories':
        printMemoryHelp(args);
        return;
      case 'audit':
        printAuditHelp(args);
        return;
      case 'refactor':
        printRefactorHelp(args);
        return;
      case 'check':
      case 'inspect':
        printCheckHelp(args);
        return;
      case 'tree':
        printTreeHelp(args);
        return;
      case 'stats':
        printStatsHelp(args);
        return;
      case 'doctor':
        printDoctorHelp(args);
        return;
      case 'mcp':
        printMcpHelp(args);
        return;
      default:
        printHelp(args);
        return;
    }
  }

  if (cmd.startsWith('-')) {
    const scoreExplicit =
      args.includes('--json') ||
      args.includes('--badge') ||
      args.some(
        (a) =>
          a === '--svg' ||
          a.startsWith('--svg=') ||
          a === '--html' ||
          a.startsWith('--html=') ||
          a === '--anon' ||
          a === '--global' ||
          a === '-g'
      );
    const defaultCmd =
      (process.stdout.isTTY && !process.env.CI) || scoreExplicit ? 'score' : 'help';
    args.unshift(defaultCmd);
    cmd = defaultCmd;
  }

  if (cmd !== 'hook' && cmd !== 'mcp' && VALID_COMMANDS.includes(cmd)) {
    const allowedFlags = COMMAND_VALID_FLAGS[cmd] || KNOWN_FLAGS;
    for (let idx = 1; idx < args.length; idx++) {
      const arg = args[idx];
      if (!arg.startsWith('-') || arg === '-') {
        continue;
      }
      const flag = arg.split('=')[0];
      if (!allowedFlags.includes(flag)) {
        const suggestion =
          suggestClosestToken(flag, allowedFlags) || suggestClosestToken(flag, KNOWN_FLAGS);
        console.error(
          formatTerminalOutput(
            `❌ Error: Unknown option '${flag}' for '${cmd}'.${
              suggestion ? ` Did you mean '${suggestion}'?` : ''
            }`,
            cliTermOpts
          )
        );
        handleExit(1);
        return;
      }
      if (VALUE_TAKING_FLAGS.has(flag) && !arg.includes('=') && idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
        idx++;
      }
    }
  }

  if (cmd === 'help') {
    printHelp(args);
    return;
  }

  let wsVal: string | undefined;
  const wsEq = args.find((a) => a.startsWith('--workspace='));
  if (wsEq) {
    wsVal = wsEq.slice('--workspace='.length);
  } else {
    const idx = args.indexOf('--workspace') !== -1 ? args.indexOf('--workspace') : args.indexOf('-w');
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
      wsVal = args[idx + 1];
    }
  }

  if (wsVal && cmd !== 'mcp' && cmd !== 'hook') {
    const resolvedWs = path.resolve(wsVal);
    if (!fs.existsSync(resolvedWs)) {
      console.error(
        formatTerminalOutput(
          `❌ Error: Workspace directory does not exist: ${resolvedWs}`,
          cliTermOpts
        )
      );
      handleExit(1);
      return;
    }
  }

  const globalDir = resolveGlobalFallbackDir();
  const isReadOnlyDiagnostic = ['score', 'ui', 'doctor', 'check', 'inspect', 'tree', 'stats', 'version', '--version', '-v'].includes(cmd);
  if (!isReadOnlyDiagnostic && fs.existsSync(path.join(globalDir, '.evo'))) {
    ensureGlobalFallbackSeeded(globalDir);
  }

  const isLocalMutationCmd =
    ['init', 'bootstrap', 'virtualize', 'audit', 'refactor', 'optimize', 'hook', 'uninstall'].includes(cmd) ||
    ((cmd === 'memory' || cmd === 'memories') && (args.includes('refresh') || args.includes('--refresh')));

  let workspaceRoot: string;
  if (isReadOnlyDiagnostic) {
    const target = wsVal
      ? path.resolve(wsVal)
      : process.env.EVO_WORKSPACE
      ? path.resolve(process.env.EVO_WORKSPACE)
      : path.resolve(process.cwd());
    if (isHostGlobalConfigDir(target)) {
      workspaceRoot = resolveGlobalFallbackDir();
    } else {
      workspaceRoot = findNearestEvoWorkspace(target) || findGitRoot(target) || target;
    }
  } else {
    workspaceRoot = resolveWorkspaceRoot(args, !isLocalMutationCmd);
  }

  switch (cmd) {
    case 'score': {
      runScoreCli(workspaceRoot, args);
      break;
    }

    case 'ui': {
      runUiCli(workspaceRoot, args);
      break;
    }

    case 'mcp': {
      startMcpStdioServer(workspaceRoot);
      break;
    }

    case 'init': {
      const stealth = args.includes('--stealth');
      const targets = parseTargetsArg(args, workspaceRoot);
      const linkEvoFrom = parseLinkArg(args);
      const warmup = args.includes('--warmup') && !args.includes('--no-warmup');
      const installIde = args.includes('--install-ide') ? true : undefined;
      const noIde = args.includes('--no-ide');
      const ide = parseIdeTargetsArg(args);
      const logInit = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
      const res = runInit(workspaceRoot, {
        stealth,
        targets,
        linkEvoFrom,
        warmup,
        installIde,
        noIde,
        ide,
      });
      logInit('🧬 EvoKernel initialized successfully!');
      logInit(`  ├─ Harnesses wired : ${res.initializedHarnesses.join(', ')}`);
      logInit(`  ├─ Rule seeds      : ${res.updatedFiles.join(', ')}`);
      logInit(`  ├─ MCP gateways    : ${res.mcpConfigFiles.join(', ')}`);
      if (res.commandFiles && res.commandFiles.length > 0) {
        logInit(`  ├─ Slash commands  : ${res.commandFiles.join(', ')}`);
      }
      if (res.linkedSharedEvoDir) {
        logInit(`  ├─ Shared .evo     : ${res.linkedSharedEvoDir}`);
      }
      if (res.ideMounts && res.ideMounts.length > 0) {
        const mountSummary = res.ideMounts
          .map((m) => `${m.name} (${m.method}: ${m.targetPath})`)
          .join(', ');
        logInit(`  ├─ IDE Extensions  : ${mountSummary}`);
      } else if (noIde) {
        logInit('  ├─ IDE Extensions  : skipped (--no-ide)');
      }
      logInit(
        `  └─ Git Exclude     : ${
          stealth || res.linkedSharedEvoDir
            ? `Stealth mode active (.git/info/exclude -> ${res.stealthExcluded?.join(', ') || 'already excluded'})`
            : 'Standard mode (.evo/.cache/ excluded locally)'
        }`
      );
      if (res.warmupReport) {
        const boot = res.warmupReport.bootSummary;
        const score = res.warmupReport.scoreReport || res.warmupReport;
        console.log('');
        logInit('⚡ Warmup & Cold-Start Gene Extraction:');
        if (boot?.detectedStacks && boot.detectedStacks.length > 0) {
          logInit(`  ├─ Detected Stacks : ${boot.detectedStacks.join(', ')}`);
        }
        const totalEvolved =
          (boot?.rulesCreated?.length || 0) +
          (boot?.skillsCreated?.length || 0) +
          (boot?.toolsCreated?.length || 0) +
          (boot?.memoriesCreated?.length || 0);
        logInit(
          `  ├─ Capabilities    : ${totalEvolved} evolved (${boot?.rulesCreated?.length || 0} rules, ${boot?.memoriesCreated?.length || 0} memories)`
        );
        if (score?.mcpTax?.activeServers > 0) {
          logInit(
            `  └─ MCP Tax         : ${score.mcpTax.activeServers} active server(s) (~${score.mcpTax.activeTaxTokens} tok) ready for \`evo virtualize\``
          );
        } else {
          const healthDisplay =
            score?.overallScore !== undefined
              ? `Grade ${score.grade} (${score.overallScore}/100)`
              : '—';
          logInit(`  └─ Context Health  : ${healthDisplay}`);
        }
      }
      const cliPrefix = formatCliInvocationPrefix(argv);
      console.log('');
      logInit('🚀 Next Steps:');
      logInit(
        `  1. Run \`${cliPrefix} doctor\` to verify live MCP stdio handshake & AST memory health (reload your IDE if open).`
      );
      logInit(
        `  2. Run \`${cliPrefix} ui\` to launch EvoKernel Workbench and inspect your capability tree.`
      );
      logInit(
        `  3. Try a starter prompt in your IDE: "Search EvoKernel rules/memories for this repo before making edits" (tip: run \`${cliPrefix} bootstrap\` to mine git history).`
      );
      break;
    }

    case 'bootstrap': {
      const maxCommits = parseMaxCommitsArg(args);
      let hasCommits = false;
      try {
        const revCount = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
          cwd: workspaceRoot,
          encoding: 'utf8',
          timeout: 3000,
        });
        hasCommits = revCount.status === 0 && Number.parseInt(revCount.stdout?.trim(), 10) > 0;
      } catch {}

      const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      if (!hasCommits) {
        console.log(
          formatTerminalOutput(
            '🔍 Initializing stack & seed capabilities (no git commit history found yet — skipping git fix mining)...',
            termOpts
          )
        );
      } else {
        console.log(
          formatTerminalOutput(
            `🔍 Scanning repository structure, build configs, and git fix history (maxCommits: ${maxCommits})...`,
            termOpts
          )
        );
      }
      const summary = runBootstrap(workspaceRoot, { maxCommits });
      const bootLines: string[] = [
        '✅ Cold-start gene extraction complete (all capabilities passed 6-stage Gatekeeper):',
      ];
      if (summary.detectedStacks && summary.detectedStacks.length > 0) {
        bootLines.push(`  ├─ 📦 Detected Stacks     : ${summary.detectedStacks.join(', ')}`);
      }
      bootLines.push(`  ├─ 🛡️  Rules evolved       : ${summary.rulesCreated.join(', ') || '(none)'}`);
      bootLines.push(`  ├─ ⚡ Skills evolved      : ${summary.skillsCreated.join(', ') || '(none)'}`);
      bootLines.push(`  ├─ 🔧 Micro-Tools evolved : ${summary.toolsCreated.join(', ') || '(none)'}`);
      bootLines.push(`  ├─ 🧠 Memories evolved    : ${summary.memoriesCreated.join(', ') || '(none)'}`);
      if (summary.skippedOrDuplicate.length > 0) {
        bootLines.push(`  └─ ⏭️  Skipped existing    : ${summary.skippedOrDuplicate.join(', ')}`);
      }
      console.log(formatTerminalOutput(bootLines.join('\n'), termOpts));
      break;
    }

    case 'virtualize': {
      const dryRun = args.includes('--dry-run');
      const restore = args.includes('--restore');
      const includeGlobal = args.includes('--global') || args.includes('-g');
      const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      const result = runVirtualize(workspaceRoot, { dryRun, restore, includeGlobal });
      console.log(formatTerminalOutput(renderVirtualizeReport(result), termOpts));
      break;
    }

    case 'memory':
    case 'memories': {
      const positionalArgs: string[] = [];
      for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === '--workspace' || a === '-w') {
          i++;
          continue;
        }
        if (a.startsWith('-')) continue;
        positionalArgs.push(a);
      }
      const actionArg = positionalArgs[0];
      if (actionArg && actionArg !== 'verify' && actionArg !== 'refresh') {
        console.error(
          formatTerminalOutput(
            `❌ Error: Unknown memory action '${actionArg}'. Usage: evo memory [verify|refresh]`,
            cliTermOpts
          )
        );
        handleExit(1);
        return;
      }
      if (actionArg === 'refresh' || args.includes('--refresh')) {
        const targetIds = positionalArgs.filter((a) => a !== 'refresh' && a !== 'verify');
        refreshMemories(workspaceRoot, targetIds.length > 0 ? targetIds : undefined);
      }
      if (args.includes('--json')) {
        const memStorage = new EvoStorage(workspaceRoot);
        const memList = hasValidEvoStructure(memStorage.evoDir) ? memStorage.listMemories() : [];
        const verifications = memList.map((m) => ({
          id: m.id,
          title: m.title,
          ...verifyMemoryFreshness(workspaceRoot, m, { includeCallers: false }),
        }));
        console.log(
          JSON.stringify(
            {
              workspaceRoot,
              total: verifications.length,
              verified: verifications.filter((v) => v.overall_status === 'VERIFIED').length,
              otherBranch: verifications.filter((v) => v.overall_status === 'OTHER_BRANCH').length,
              stale: verifications.filter((v) => v.overall_status === 'STALE' || v.overall_status === 'ORPHANED').length,
              memories: verifications,
            },
            null,
            2
          )
        );
      } else {
        const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
        console.log(renderMemoryVerifyReport(workspaceRoot, termOpts));
      }
      break;
    }

    case 'audit': {
      const includeGlobal = args.includes('--global') || args.includes('-g');
      const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      const report = runAudit(workspaceRoot, { includeGlobal, tokenBudgetLimit: parsePositiveIntFlag(args, '--token-budget'), skillBudgetLimit: parsePositiveIntFlag(args, '--skill-budget') });
      if (args.includes('--json')) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(renderAuditReport(report, termOpts));
      }
      if (!report.healthy) {
        process.exit(1);
      }
      break;
    }

    case 'refactor': {
      const includeGlobal = !args.includes('--local-only');
      const apply = args.includes('--apply');
      const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      const result = runRefactor(workspaceRoot, { includeGlobal, apply, tokenBudgetLimit: parsePositiveIntFlag(args, '--token-budget'), skillBudgetLimit: parsePositiveIntFlag(args, '--skill-budget') });
      if (args.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderRefactorReport(result, termOpts));
      }
      break;
    }

    case 'tree': {
      if (args.includes('--json')) {
        console.log(JSON.stringify(buildEvoTreeJson(workspaceRoot), null, 2));
      } else {
        const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
        console.log(
          renderEvoTree(workspaceRoot, {
            full: args.includes('--full'),
            color: termOpts.color,
            ascii: termOpts.ascii,
          })
        );
      }
      break;
    }

    case 'stats': {
      const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      console.error(
        formatTerminalOutput(
          "ℹ️ Note: 'evo stats' is deprecated; use 'evo doctor --roi' for ROI & session-start tax diagnostics.",
          termOpts
        )
      );
      if (args.includes('--json')) {
        console.log(JSON.stringify(buildEvoStatsJson(workspaceRoot), null, 2));
      } else {
        console.log(renderEvoStats(workspaceRoot, termOpts));
      }
      break;
    }

    case 'hook': {
      if (
        args.includes('--help') ||
        args.includes('-h') ||
        args[1] === 'help' ||
        args[1] === '--help' ||
        args[1] === '-h'
      ) {
        printHookHelp(args);
        break;
      }
      const event = parseHookEvent(args);
      const payload = parseHookPayloadArg(args);
      const harness = parseHookHarnessArg(args);

      const isTestProcess = Boolean(process.argv[1]?.includes('.test.'));

      const isHumanCliHook = event === 'pre-commit' || event === 'mark-recovery';

      if (!process.stdin.isTTY && !isTestProcess && !payload) {
        return readStdinTextWithTimeout().then((stdinData) => {
          const result = runHook(event, {
            workspaceRoot,
            payload,
            harness,
            stdinData: stdinData || undefined,
            ...(isHumanCliHook ? cliTermOpts : {}),
          });
          if (result.output) {
            console.log(
              isHumanCliHook ? formatTerminalOutput(result.output, cliTermOpts) : result.output
            );
          }
          if (result.exitCode !== 0) {
            process.exit(result.exitCode);
          }
        }).catch((err) => {
          console.error(err);
          process.exit(1);
        });
      }

      const result = runHook(event, {
        workspaceRoot,
        payload,
        harness,
        ...(isHumanCliHook ? cliTermOpts : {}),
      });
      if (result.output) {
        console.log(
          isHumanCliHook ? formatTerminalOutput(result.output, cliTermOpts) : result.output
        );
      }
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
      break;
    }

    case 'optimize': {
      if (
        args.includes('--help') ||
        args.includes('-h') ||
        args[1] === 'help' ||
        args[1] === '--help' ||
        args[1] === '-h'
      ) {
        printOptimizeHelp(args);
        break;
      }
      runOptimizeCli(args, workspaceRoot);
      break;
    }

    case 'doctor': {
      const storage = new EvoStorage(workspaceRoot);
      const hasEvo = hasValidEvoStructure(storage.evoDir);
      const showRoi = args.includes('--roi');
      const noProbe = args.includes('--no-probe');
      const forceProbe = args.includes('--probe');
      let ftsEnabled = false;
      try {
        const memDb = new DatabaseSync(':memory:');
        try {
          memDb.exec('CREATE VIRTUAL TABLE _fts_probe USING fts5(content);');
          ftsEnabled = true;
        } catch {
          ftsEnabled = false;
        } finally {
          try { memDb.close(); } catch {}
        }
      } catch {
        ftsEnabled = false;
      }

      let verifiedMems = 0;
      let otherBranchMems = 0;
      let staleMems = 0;
      let totalMemories = 0;
      let totalHits = 0;
      let totalTokensSaved = 0;
      let totalHelped = 0;
      let rulesCount = 0;
      let skillsCount = 0;
      let toolsCount = 0;
      let coreRuleTokens = 0;
      let maxCoreRuleTokens = 1500;
      let evoConfigVersion: string | undefined;
      let window7d = emptyRecallWindowStats(7);

      const mcpInfo = checkMcpGatewayConfigs(workspaceRoot);
      const seedInfo = checkSeedIntegrity(workspaceRoot);
      const mcpRegistered = mcpInfo.registered;
      const staleNpxPath = mcpInfo.staleNpxPath;

      let sessionStartSavings = {
        beforeTokens: 0,
        afterTokens: 0,
        savedTokens: 0,
        savingsPercent: 0,
        userStaticRuleTokens: 0,
        evoSeedTokens: 0,
      };

      if (hasEvo) {
        const rules = storage.listRules();
        const skills = storage.listSkills();
        const tools = storage.listTools();
        const memories = storage.listMemories();
        rulesCount = rules.length;
        skillsCount = skills.length;
        toolsCount = tools.length;
        totalMemories = memories.length;
        const cfg = storage.getConfig();
        maxCoreRuleTokens = cfg.maxCoreRuleTokens || 1500;
        evoConfigVersion = cfg.version;
        coreRuleTokens = storage.getCoreRulesTokenUsage().totalTokens;
        let docCacheDb: DatabaseSync | undefined = undefined;
        if (fs.existsSync(storage.telemetryDbPath)) {
          try {
            docCacheDb = openSqliteReadOnly(storage.telemetryDbPath);
            window7d = readRecallWindowStatsFromDb(docCacheDb, 7);
            const row = docCacheDb
              .prepare(
                'SELECT SUM(hit_count) AS hits, SUM(tokens_saved) AS saved, SUM(helped_count) AS helped FROM telemetry'
              )
              .get() as { hits?: number | null; saved?: number | null; helped?: number | null } | undefined;
            totalHits = Number(row?.hits || 0);
            totalTokensSaved = Number(row?.saved || 0);
            totalHelped = Number(row?.helped || 0);
          } catch {}
        }
        try {
          for (const m of memories) {
            const status = verifyMemoryFreshness(storage.rootDir, m, {
              includeCallers: false,
              cacheDb: docCacheDb,
            }).overall_status;
            if (status === 'VERIFIED') verifiedMems++;
            else if (status === 'OTHER_BRANCH') otherBranchMems++;
            else staleMems++;
          }
          const scoreRep = buildScoreReport(workspaceRoot, {
            includeGlobal: false,
            cacheDb: docCacheDb,
          });
          sessionStartSavings = scoreRep.contextSavings;
        } finally {
          if (docCacheDb) {
            try { docCacheDb.close(); } catch {}
          }
        }
      } else if (mcpRegistered) {
        try {
          const scoreRep = buildScoreReport(workspaceRoot, { includeGlobal: false });
          sessionStartSavings = scoreRep.contextSavings;
        } catch {}
      }

      const probeTarget = mcpInfo.workspaceLaunchConfig || mcpInfo.launchConfig;
      const shouldRunHandshake =
        !noProbe &&
        Boolean(probeTarget) &&
        (Boolean(mcpInfo.workspaceLaunchConfig) || hasEvo || forceProbe);

      const probeResult: McpHandshakeProbeResult = shouldRunHandshake && probeTarget
        ? probeMcpServerStdioSync(workspaceRoot, probeTarget, 5000)
        : {
            attempted: false,
            skipped: noProbe || !probeTarget || !shouldRunHandshake,
            reachable: false,
            toolCount: 0,
          };

      const versionDriftReasons: string[] = [];
      if (hasEvo && evoConfigVersion && evoConfigVersion !== EVO_KERNEL_VERSION) {
        versionDriftReasons.push(`.evo/config.json is v${evoConfigVersion} (CLI is v${EVO_KERNEL_VERSION})`);
      }
      if (
        probeResult.attempted &&
        probeResult.reachable &&
        probeResult.serverVersion &&
        probeResult.serverVersion !== EVO_KERNEL_VERSION
      ) {
        versionDriftReasons.push(
          `MCP server reported v${probeResult.serverVersion} (CLI is v${EVO_KERNEL_VERSION})`
        );
      }
      const bootStubPath = path.join(workspaceRoot, '.evo', 'boot-mcp.mjs');
      if (hasEvo && fs.existsSync(bootStubPath)) {
        try {
          const stubTxt = fs.readFileSync(bootStubPath, 'utf8');
          if (!stubTxt.includes(`evo-kernel@${EVO_KERNEL_VERSION}`)) {
            versionDriftReasons.push(`.evo/boot-mcp.mjs fallback pin differs from v${EVO_KERNEL_VERSION}`);
          }
        } catch {}
      }
      for (const vf of seedInfo.valid) {
        try {
          const rawSeed = fs.readFileSync(path.join(workspaceRoot, vf), 'utf8');
          if (rawSeed.includes('EvoKernel 演进回执') || !rawSeed.includes('EvoKernel Recall:')) {
            versionDriftReasons.push(`${vf} L0 seed block is from an older schema`);
            break;
          }
        } catch {}
      }
      const hasVersionDrift = versionDriftReasons.length > 0;
      const duplicateRootSeeds =
        seedInfo.valid.includes('AGENTS.md') && seedInfo.valid.includes('GEMINI.md');

      if (args.includes('--json')) {
        const doctorJson: Record<string, unknown> = {
          ok: true,
          cliVersion: EVO_KERNEL_VERSION,
          workspaceRoot,
          nodeVersion: process.version,
          execPath: process.execPath,
          sqliteFts5Enabled: ftsEnabled,
          hasEvo,
          evoDir: hasEvo ? storage.evoDir : null,
          mcpRegistered,
          mcpConfigs: mcpInfo.foundConfigs,
          staleNpxPath,
          mcpProbe: probeResult,
          seeds: {
            ...seedInfo,
            duplicateRootSeeds,
          },
          versionDrift: {
            drifted: hasVersionDrift,
            reasons: versionDriftReasons,
            fixCommand: 'npx -y evo-kernel init',
          },
          capabilities: {
            rules: rulesCount,
            skills: skillsCount,
            tools: toolsCount,
            memories: totalMemories,
            coreRuleTokens,
            maxCoreRuleTokens,
          },
          memories: {
            total: totalMemories,
            verified: verifiedMems,
            otherBranch: otherBranchMems,
            stale: staleMems,
          },
          sessionStartTax: sessionStartSavings,
          window7d,
          telemetry: {
            totalHits,
            helpedCount: totalHelped,
            recordedTokensSaved: totalTokensSaved,
            sessionStartSavedTokens: sessionStartSavings.savedTokens,
          },
        };
        if (showRoi) {
          doctorJson.roi = buildEvoStatsJson(workspaceRoot);
        }
        console.log(JSON.stringify(doctorJson, null, 2));
        break;
      }

      const doctorTermOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      const logDoctor = (line: string) => console.log(formatTerminalOutput(line, doctorTermOpts));

      const nodeIcon = '[✓]';
      const sqliteIcon = ftsEnabled ? '[✓]' : '[!]';
      const memoryIcon = !hasEvo ? '[!]' : staleMems > 0 ? '[!]' : '[✓]';
      const telemetryIcon = hasEvo ? '[✓]' : '[!]';
      const storageIcon = hasEvo ? '[✓]' : '[!]';
      const seedIcon =
        seedInfo.valid.length === 0
          ? '[!]'
          : seedInfo.duplicateBlocks > 0 || duplicateRootSeeds || hasVersionDrift
            ? '[!]'
            : '[✓]';
      const mcpIcon = staleNpxPath ? '[✗]' : mcpRegistered ? '[✓]' : '[!]';
      const probeIcon = !probeResult.attempted
        ? '[!]'
        : probeResult.reachable
          ? '[✓]'
          : '[✗]';

      logDoctor(`🩺 EvoKernel Doctor v${EVO_KERNEL_VERSION} — Diagnostics Check`);
      logDoctor(`  ├─ ${nodeIcon} Node.js Runtime       : ${process.version} (${process.execPath})`);
      logDoctor(
        `  ├─ ${sqliteIcon} Native node:sqlite    : ${
          ftsEnabled
            ? 'Operational (FTS5 BM25 enabled)'
            : 'Operational (JS BM25 Fallback active — upgrade to Node >=22.16 / 22.23+ or 24+ for native FTS5)'
        }`
      );
      logDoctor(
        `  ├─ ${memoryIcon} Cognitive Memory AST* : ${
          hasEvo
            ? `${verifiedMems}/${totalMemories} VERIFIED (${otherBranchMems} OTHER_BRANCH, ${staleMems} STALE)`
            : 'Not initialized (run `evo init` to activate)'
        }`
      );
      logDoctor(
        `  ├─ ${telemetryIcon} Session Tax & 7d ROI  : ${
          hasEvo
            ? `Saved ${sessionStartSavings.savingsPercent}% (${sessionStartSavings.beforeTokens.toLocaleString()} → ${sessionStartSavings.afterTokens.toLocaleString()} tok/turn) · 7d: ${window7d.searchEvents} searches, ${window7d.adoptedCount} adopted, ${window7d.helpedCount} helped · ${totalHits} all-time hits (${totalTokensSaved.toLocaleString()} tok reclaimed | Core: ${coreRuleTokens}/${maxCoreRuleTokens} tok)`
            : 'No telemetry yet (0 recalls)'
        }`
      );
      logDoctor(`  ├─ ${storageIcon} .evo/ Storage Tree    : ${hasEvo ? storage.evoDir : 'Not present'}`);

      let seedDesc = 'No root L0 seed block detected (run `npx -y evo-kernel init`)';
      if (seedInfo.valid.length > 0) {
        seedDesc = `Synced (${seedInfo.valid.join(', ')})`;
        if (seedInfo.duplicateBlocks > 0) {
          seedDesc += ` · ⚠️ ${seedInfo.duplicateBlocks} duplicate block(s) inside file`;
        }
        if (duplicateRootSeeds) {
          seedDesc += ' · ⚠️ AGENTS.md and GEMINI.md both contain root seed blocks (run `evo audit`)';
        }
      } else if (seedInfo.present.length > 0) {
        seedDesc = `Present (${seedInfo.present.join(', ')}) without valid EVO:START/END block`;
      }
      logDoctor(`  ├─ ${seedIcon} L0 Meta-Rule Seed     : ${seedDesc}`);

      if (hasVersionDrift) {
        logDoctor(
          `  ├─ [!] Version Sync          : Drift detected (${versionDriftReasons.join('; ')}) — fix: \`npx -y evo-kernel init\``
        );
      }

      const mcpConfigDesc = staleNpxPath
        ? `Stale _npx path detected in ${mcpInfo.foundConfigs.join(', ') || 'MCP config'} — run \`npx -y evo-kernel init\` to repair`
        : mcpRegistered
          ? `Registered (${mcpInfo.foundConfigs.join(', ')})`
          : 'Not configured — run `npx -y evo-kernel init` to register';
      logDoctor(`  ├─ ${mcpIcon} Meta-MCP Config       : ${mcpConfigDesc}`);

      let probeDesc = noProbe
        ? 'Skipped (--no-probe)'
        : !mcpRegistered
          ? 'Skipped (no MCP gateway configured)'
          : 'Skipped (uninitialized workspace — pass --probe to test global gateway)';
      if (probeResult.attempted) {
        probeDesc = probeResult.reachable
          ? `Reachable in ${probeResult.latencyMs ?? 0}ms (v${probeResult.serverVersion || 'unknown'} · ${probeResult.toolCount}/5 meta-tools verified via ${probeResult.source})`
          : `Handshake failed via ${probeResult.source} (${probeResult.error || 'unreachable'}) — run \`npx -y evo-kernel init\``;
      }
      logDoctor(`  └─ ${probeIcon} MCP Live Handshake    : ${probeDesc}`);
      if (!showRoi) {
        logDoctor('  * AST = zero-dep lexical-structural skeleton & call-anchor fingerprinting');
      }

      if (showRoi) {
        console.log('');
        console.log(renderEvoStats(workspaceRoot, doctorTermOpts));
      }

      console.log('');
      if (
        hasEvo &&
        mcpRegistered &&
        !staleNpxPath &&
        staleMems === 0 &&
        (!probeResult.attempted || probeResult.reachable) &&
        !hasVersionDrift
      ) {
        logDoctor('  ✅ Verdict: Context OS is healthy and ready.');
      } else if (!hasEvo || !mcpRegistered) {
        logDoctor('  ⚠️  Verdict: Run `npx -y evo-kernel init` to wire local workspace');
      } else if (staleNpxPath) {
        logDoctor('  ⚠️  Verdict: Stale _npx path detected in MCP config — run `npx -y evo-kernel init` to repair');
      } else if (probeResult.attempted && !probeResult.reachable) {
        logDoctor('  ⚠️  Verdict: MCP stdio handshake failed — run `npx -y evo-kernel init` and reload your IDE');
      } else if (hasVersionDrift) {
        logDoctor('  ⚠️  Verdict: Workspace version/seed drift detected — run `npx -y evo-kernel init` to sync');
      } else if (staleMems > 0) {
        logDoctor(`  ⚠️  Verdict: ${staleMems} stale memory(s) detected — run \`evo memory verify\``);
      } else {
        logDoctor('  ⚠️  Verdict: Run `evo doctor` or `npx -y evo-kernel init` to verify setup');
      }
      break;
    }

    case 'check':
    case 'inspect': {
      const isJson = args.includes('--json');
      let fileArg: string | undefined;
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--workspace' || arg === '-w') {
          i++;
          continue;
        }
        if (arg.startsWith('-')) {
          continue;
        }
        fileArg = arg;
        break;
      }
      if (!fileArg) {
        console.error(
          formatTerminalOutput(
            '❌ Error: Missing target deliverable file path.\n   Usage: evo check <file> [--json]',
            cliTermOpts
          )
        );
        const isTestProcess = Boolean(process.argv[1]?.includes('.test.'));
        if (!isTestProcess) {
          process.exit(1);
        } else {
          process.exitCode = 1;
        }
        break;
      }

      const targetPath = path.isAbsolute(fileArg)
        ? fileArg
        : path.resolve(workspaceRoot, fileArg);

      let result: ReturnType<typeof inspectDeliverableFile>;
      if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isDirectory()) {
        const ext = path.extname(targetPath).toLowerCase();
        if (!SUPPORTED_CHECK_EXTS.has(ext)) {
          result = {
            ok: false,
            format: 'unsupported',
            filePath: targetPath,
            stats: {},
            defects: [
              {
                code: 'ERR_UNSUPPORTED_FORMAT',
                severity: 'error',
                location: path.basename(targetPath),
                message: `Unsupported deliverable extension '${ext || '(none)'}'. Supported formats: .xlsx, .docx, .pptx, .csv, .json, .md, .txt, .html, .xml, .yaml`,
              },
            ],
          };
        } else {
          result = inspectDeliverableFile(targetPath);
        }
      } else {
        result = inspectDeliverableFile(targetPath);
      }

      const passed = result.ok && result.defects.filter((d) => d.severity === 'error').length === 0;

      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const logCheck = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
        let displayTarget = path.relative(workspaceRoot, targetPath).replace(/\\/g, '/') || fileArg;
        if (displayTarget.startsWith('..')) {
          displayTarget =
            fs.existsSync(targetPath) && typeof fs.realpathSync?.native === 'function'
              ? fs.realpathSync.native(targetPath)
              : path.resolve(targetPath);
        }
        logCheck(`🔍 Deliverable Canonical Inspection: ${displayTarget}`);
        logCheck(`  ├─ Format  : ${result.format.toUpperCase()}`);
        logCheck(`  ├─ Status  : ${passed ? '✅ PASSED' : '❌ FAILED'}`);
        const statEntries = Object.entries(result.stats || {});
        if (statEntries.length > 0) {
          const statsStr = statEntries.map(([k, v]) => `${k}=${v}`).join(', ');
          logCheck(`  ├─ Metrics : ${statsStr}`);
        }
        if (result.defects.length === 0) {
          logCheck(`  └─ Defects : None (0)`);
        } else {
          logCheck(`  └─ Defects (${result.defects.length}) :`);
          for (let i = 0; i < result.defects.length; i++) {
            const d = result.defects[i];
            const isLast = i === result.defects.length - 1;
            const branch = isLast ? '     └─' : '     ├─';
            const sevBadge = d.severity === 'error' ? '[ERROR]' : '[WARN]';
            logCheck(`${branch} ${sevBadge} ${d.code} @ ${d.location}: ${d.message}`);
          }
        }
      }

      const isTestProcess = Boolean(process.argv[1]?.includes('.test.'));
      if (!isTestProcess) {
        process.exit(passed ? 0 : 1);
      } else {
        process.exitCode = passed ? 0 : 1;
      }
      break;
    }

    case 'uninstall': {
      const res = runUninstall(workspaceRoot);
      console.log(
        formatTerminalOutput(
          `🧹 Cleaned EvoKernel markers from: ${res.cleanedFiles.join(', ') || '(no files modified)'}`,
          cliTermOpts
        )
      );
      break;
    }

    case 'version':
    case '--version':
    case '-v': {
      console.log(formatTerminalOutput(EVO_KERNEL_VERSION, cliTermOpts));
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      printHelp(args);
      break;

    default: {
      if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') {
        const suggestion = suggestClosestToken(cmd, VALID_COMMANDS);
        console.error(
          formatTerminalOutput(
            `❌ Error: Unknown command '${args[0]}'.${
              suggestion ? ` Did you mean '${suggestion}'?` : ''
            } Run 'evo --help' for usage.`,
            cliTermOpts
          )
        );
        handleExit(1);
        return;
      }
      printHelp(args);
      break;
    }
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  !process.argv[1].includes('.test.') &&
  (path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(import.meta.filename).toLowerCase() ||
    /(?:^|[\\/])(?:evo|evokernel|evo-kernel)(?:\.m?js|\.cmd)?$/i.test(process.argv[1]));

if (isDirectRun) {
  runCli(process.argv);
}
