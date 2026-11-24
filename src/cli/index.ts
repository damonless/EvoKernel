#!/usr/bin/env node
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  cleanGlobalUserProfile,
  detectAutoInitTargets,
  discoverGlobalProfileTargets,
  ensureGlobalFallbackSeeded,
  findGitRoot,
  hasNonEvoGeminiMd,
  parseInitTargets,
  runInit,
  runInitGlobal,
  runUninstall,
  syncGlobalUserProfile,
  syncManagedRuleBlocks,
} from './init.js';
import {
  ALL_HARNESS_ADAPTERS,
  detectCascadedTargets,
  extractCodexTomlEvoEntry,
  hasStaleNpxMcpEntry,
  parseJsonc,
} from './harness.js';
import { computeEffectiveProfileBlockForTarget } from '../core/profile-sync.js';
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
import { buildScoreReport, runScoreCli } from './score.js';
import { runUiCli } from './ui.js';
import { startMcpStdioServer } from '../mcp/server.js';
import {
  DEFAULT_EVO_CONFIG,
  EVO_KERNEL_VERSION,
  EvoStorage,
  PREFERENCE_CATEGORIES,
  estimateTokens,
  findNearestEvoWorkspace,
  hasValidEvoStructure,
  isHostGlobalConfigDir,
  isPluginOrExtensionInstallDir,
  openSqliteReadOnly,
  resolveGlobalFallbackDir,
  sanitizeId,
} from '../core/storage.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';
import {
  ONBOARDING_PRESETS,
  getOnboardingPresetCandidates,
  inferPreferenceCategory,
  inferSituationalOnDemand,
  parseMarkdownToPreferenceCandidates,
  type OnboardingPresetName,
  type ParsedPreferenceCandidate,
} from '../core/profile-import.js';
import type { PreferenceCategory, ProposalPayload } from '../core/types.js';
import {
  PROFILE_MARKER_END,
  PROFILE_MARKER_START,
  renderUserProfileBlock,
} from '../templates/meta-rule.js';
export { ensureGlobalFallbackSeeded, resolveGlobalFallbackDir };
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
  --payload <json>      Hook event payload as JSON string
  --tool <name>         Tool name (alias: --tool-name)
  --file <path>         Target file path (alias: --target-file)
  --workspace <path>    Target workspace directory (default: current directory)
  --dry-run             Simulate hook execution without modifying telemetry or git state
  -h, --help            Show this help message
`,
    args
  );
}

const RETIRED_OPTIMIZE_NOTICE =
  'Notice: `evo optimize` (offline Git worktree optimization) has been retired to keep EvoKernel lean and deterministic.\n' +
  'Use `evo memory verify`, `evo audit`, or `evo profile` instead.';

export function printOptimizeHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo optimize (retired)

${RETIRED_OPTIMIZE_NOTICE}
`,
    args
  );
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
  --ide <targets>      Comma-separated list of target IDEs (vscode, cursor, windsurf, trae, antigravity, all)
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
  --global, -g         Initialize ~/.evo/global, wire global host MCPs, refresh plugin L0 seed & sync profile
  --dry-run            Preview global initialization without modifying files (with --global)
  --json               Output structured JSON
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
  --global, -g         Also strip EVO:PROFILE blocks from detected global host files
  --unmount-ide        Also uninstall mounted IDE extension bundles & registry entries
  --ide <targets>      Comma-separated target IDEs when --unmount-ide is set
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
  --skill-budget <N>   Override per-skill token budget limit (default: 3000)
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
  --global, -g         Include user-level global rules/skills (default: workspace only)
  --yes, -y            Skip interactive confirmation when applying changes
  --token-budget <N>   Override per-file token budget limit (default: 1500)
  --skill-budget <N>   Override per-skill token budget limit (default: 3000)
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
  --global, -g         Include global capability store (~/.evo/global) statistics
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

export function printProfileHelp(args?: string[]): void {
  logHelp(
    `
Usage:
  evo profile <subcommand> [options]

Manage, import, onboard, synchronize, or undo User-Global Personal Preferences (~/.evo/global/.evo/preferences/).

Subcommands:
  show                 Show the rendered auto-managed User Profile Digest (default)
  list                 List all global personal preferences & token budget usage
  add                  Add a personal preference via Gatekeeper and sync host profiles
  remove <id>          Archive a preference by ID, record undo history & resync hosts
  sync                 Rebuild profile-digest.md and sync host global rule files
  undo [id]            Undo the latest (or specific ID) profile/personal-memory change & resync hosts
  import <filePath>    Parse markdown preferences (preview by default; pass --apply to commit)
  onboard              List or apply onboarding presets (interactive 3-prompt interview in TTY)
  clean                Strip EVO:PROFILE blocks from detected global host rule files
  path                 Print paths to global profile digest and preferences directory

Options:
  --category <cat>     style|formatting|communication|workflow|requirement|knowledge (add)
  --title <text>       Preference title (add)
  --summary <text>     Concise L0 summary <=140 chars (add)
  --content <text>     Directive body text (add)
  --id <slug>          Optional deterministic kebab-case ID (add)
  --on-demand          Register as Tier 2 on-demand preference instead of always-on (add)
  --trigger <cue>      Trigger cue for Tier 2 Task Directory Menu (add)
  --project            Scope add/remove to current workspace instead of ~/.evo/global
  --preset <name>      concise-ceo | rigorous-engineer | technical-writer (onboard)
  --apply              Commit parsed/preset preferences through Gatekeeper (import, onboard)
  --dry-run            Preview changes without modifying files (sync, clean, import, onboard)
  --json               Output structured JSON
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
        return resolve(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trim());
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
        resolve(res.replace(/^\uFEFF/, '').trim());
      }
    }

    timer = setTimeout(() => {
      finish(data);
    }, initialTimeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
      const cleaned = data.replace(/^\uFEFF/, '').trim();
      try {
        JSON.parse(cleaned);
        finish(cleaned);
      } catch {
        // Chunk arrived but JSON incomplete: data is actively streaming.
        // Reset timer so slow/large multi-chunk streams are not prematurely cut off.
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
🧬 EvoKernel v${EVO_KERNEL_VERSION} — AST-Verified Cognitive Memory & Context OS for AI Agents

Usage:
  evo <command> [options]

Core Commands:
  init [--all] [--global] [--stealth] [--targets <list|auto>] [--dry-run]
                      Set up EvoKernel rules and MCP gateway in this workspace (--global for desktop hosts)
  doctor [--fix] [--strict] [--roi] [--no-probe] [--json]
                      Check setup health, MCP connection, memories, and fix common issues (--fix)
  profile [list|show|add|remove|sync|undo|import|onboard|clean|path]
                      Save and sync personal preferences across AI hosts (~/.evo/global)
  ui [-p <N>] [--open] [--app] [--desktop] [--export [path]] [--anon]
                      Open the local EvoKernel Workbench dashboard

More Commands:
  score [--json] [--badge] [--svg <path>] [--html <path>] [--anon]
                      Score session-start token overhead and git fragility hotspots
  memory [verify|refresh]
                      Verify or refresh AST* fingerprints across episodic memories
  audit [--global] [--json] [--token-budget <N>] [--skill-budget <N>]
                      Audit rules and skills for domain leaks, duplicates, and token bloat
  refactor [--apply] [--global] [--yes] [--token-budget <N>] [--skill-budget <N>]
                      Decouple bloated rules/skills into scoped rules (backups saved on --apply)
  bootstrap [--max-commits <N>]
                      Extract initial rules, skills, and memories from git history
  virtualize [--dry-run] [--restore] [--global]
                      Fold third-party stdio MCPs into .evo/mcp-pool.json
  tree [--full] [--json]
                      Show .evo/ capability and memory tree
  check <file> [--json]
                      Inspect deliverables (.xlsx, .docx, .pptx, .csv, .json, .md) for defects
  uninstall [--global] [--purge] [--dry-run] [--yes]
                      Remove EvoKernel markers and MCP entries from host configs
  version, --version  Print EvoKernel CLI version
`,
    args
  );
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
  'profile',
  'tree',
  'stats',
  'mcp',
  'hook',
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
    '--ide',
  ],
  init: [
    ...GLOBAL_COMMON_FLAGS,
    '--global',
    '-g',
    '--all',
    '--dry-run',
    '--json',
    '--stealth',
    '--targets',
    '--link',
    '--warmup',
    '--no-warmup',
    '--install-ide',
    '--no-ide',
    '--ide',
  ],
  uninstall: [
    ...GLOBAL_COMMON_FLAGS,
    '--global',
    '-g',
    '--unmount-ide',
    '--ide',
    '--dry-run',
    '--yes',
    '-y',
    '--purge',
  ],
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
    '--yes',
    '-y',
    '--token-budget',
    '--skill-budget',
    '--json',
  ],
  profile: [
    ...GLOBAL_COMMON_FLAGS,
    '--json',
    '--dry-run',
    '--global',
    '-g',
    '--yes',
    '-y',
    '--category',
    '--title',
    '--summary',
    '--content',
    '--id',
    '--on-demand',
    '--trigger',
    '--project',
    '--apply',
    '--preset',
  ],
  tree: [...GLOBAL_COMMON_FLAGS, '--json', '--full'],
  stats: [...GLOBAL_COMMON_FLAGS, '--json', '--global', '-g'],
  hook: [...GLOBAL_COMMON_FLAGS, '--payload', '--harness', '--dry-run', '--tool', '--file', '--tool-name', '--target-file'],
  doctor: [...GLOBAL_COMMON_FLAGS, '--json', '--roi', '--probe', '--no-probe', '--fix', '--strict'],
  check: [...GLOBAL_COMMON_FLAGS, '--json'],
  inspect: [...GLOBAL_COMMON_FLAGS, '--json'],
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
  env?: Record<string, string>;
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
  let env: Record<string, string> | undefined;
  const rawEnv =
    entry.env && typeof entry.env === 'object' && !Array.isArray(entry.env)
      ? entry.env
      : entry.environment && typeof entry.environment === 'object' && !Array.isArray(entry.environment)
        ? entry.environment
        : undefined;
  if (rawEnv) {
    env = {};
    for (const [k, v] of Object.entries(rawEnv)) {
      if (v !== undefined && v !== null) env[k] = String(v);
    }
  }
  if (typeof entry.command === 'string' && entry.command.trim()) {
    return {
      source,
      command: entry.command.trim(),
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      ...(env ? { env } : {}),
      isWorkspace,
    };
  }
  if (Array.isArray(entry.command) && entry.command.length > 0 && typeof entry.command[0] === 'string') {
    return {
      source,
      command: entry.command[0].trim(),
      args: entry.command.slice(1).map(String),
      ...(env ? { env } : {}),
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
const path = require('node:path');
const cfg = JSON.parse(process.env.EVO_MCP_PROBE_CFG || '{}');
const t0 = Date.now();
const isWin = process.platform === 'win32';
let cmd = cfg.command || '';
let cArgs = Array.isArray(cfg.args) ? cfg.args : [];
if (/^node(?:\\.exe)?$/i.test(cmd)) {
  cmd = process.execPath;
}
const childEnv = {
  ...process.env,
  ...(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
  EVO_WORKSPACE: cfg.cwd,
};
let child;
try {
  if (isWin && (/\\.(?:cmd|bat)$/i.test(cmd) || /^(?:npx|npm|pnpm|yarn)$/i.test(cmd))) {
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
    const rawWinCmd = /\\.(?:cmd|bat)$/i.test(cmd) ? cmd : cmd + '.cmd';
    const resolvedWinCmd = /[\\\\/]/.test(rawWinCmd)
      ? path.resolve(cfg.cwd || process.cwd(), rawWinCmd)
      : rawWinCmd;
    const quotedCmd = /^"/.test(q(resolvedWinCmd)) ? q(resolvedWinCmd) : '"' + resolvedWinCmd + '"';
    const full = [quotedCmd, ...cArgs.map(q)].join(' ');
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + full + '"'], {
      cwd: cfg.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: true,
      env: childEnv,
    });
  } else {
    child = spawn(cmd, cArgs, {
      cwd: cfg.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
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
    const errLines = errBuf
      .trim()
      .split(/\\r?\\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const snippet = errLines.slice(0, 2).join(' ') || ('Process exited with code ' + code);
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
  const selfEvoRoot = path.resolve(import.meta.dirname, '..', '..');
  try {
    const res = spawnSync(process.execPath, ['-e', MCP_STDIO_PROBE_SCRIPT], {
      cwd: ws,
      encoding: 'utf8',
      timeout: timeoutMs + 500,
      env: {
        ...process.env,
        EVO_KERNEL_ROOT: process.env.EVO_KERNEL_ROOT || selfEvoRoot,
        EVO_MCP_PROBE_CFG: JSON.stringify({
          command: target.command,
          args: target.args,
          env: target.env,
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
  '--payload',
  '--harness',
  '--event',
  '--tool',
  '--file',
  '--tool-name',
  '--target-file',
  '--max-commits',
  '--token-budget',
  '--skill-budget',
  '--category',
  '--title',
  '--summary',
  '--content',
  '--id',
  '--trigger',
  '--preset',
]);

const PROFILE_VALUE_FLAGS = VALUE_TAKING_FLAGS;

const FREE_TEXT_PROFILE_FLAGS = new Set([
  '--title',
  '--summary',
  '--content',
  '--trigger',
]);

function isFlagNextValue(flag: string, nextArg: string | undefined): boolean {
  if (nextArg === undefined) return false;
  if (!nextArg.startsWith('-')) return true;
  if (FREE_TEXT_PROFILE_FLAGS.has(flag.toLowerCase())) {
    const nextLower = nextArg.toLowerCase();
    if (nextLower === '-h' || nextLower === '-v') {
      return true;
    }
    const nextFlag = nextLower.split('=')[0];
    if (!KNOWN_FLAGS.includes(nextFlag) && !/^--[a-z0-9-]+$/i.test(nextArg)) {
      return true;
    }
  }
  return false;
}

function parseCliFlagValue(args: string[], flag: string): string | undefined {
  const lowerFlag = flag.toLowerCase();
  const eqPrefix = `${lowerFlag}=`;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const aLower = a.toLowerCase();
    if (aLower.startsWith(eqPrefix)) {
      return a.slice(eqPrefix.length);
    }
    if (aLower === lowerFlag) {
      if (i + 1 < args.length && isFlagNextValue(lowerFlag, args[i + 1])) {
        return args[i + 1];
      }
      return undefined;
    }
    if (
      a.startsWith('-') &&
      a !== '-' &&
      !a.includes('=') &&
      VALUE_TAKING_FLAGS.has(aLower) &&
      i + 1 < args.length &&
      isFlagNextValue(aLower, args[i + 1])
    ) {
      i++;
    }
  }
  return undefined;
}

function extractCliPositionalArgs(args: string[], startIndex: number = 1): string[] {
  const positional: string[] = [];
  for (let i = startIndex; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-') && a !== '-') {
      const flag = a.split('=')[0].toLowerCase();
      if (!a.includes('=') && PROFILE_VALUE_FLAGS.has(flag) && i + 1 < args.length) {
        const next = args[i + 1];
        if (isFlagNextValue(flag, next)) {
          i++;
        }
      }
      continue;
    }
    positional.push(a);
  }
  return positional;
}

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
    const flagLower = flag.toLowerCase();
    leadingFlags.push(flag);
    if (
      !flag.includes('=') &&
      VALUE_TAKING_FLAGS.has(flagLower) &&
      i + 1 < rawArgs.length &&
      isFlagNextValue(flagLower, rawArgs[i + 1])
    ) {
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

const DEPRECATED_COMMANDS = new Set(['stats', 'memories', 'inspect', 'optimize']);

function suggestFlag(flag: string, allowedFlags: string[]): string | null {
  const norm = flag.trim().toLowerCase();
  const candidates = allowedFlags.filter((c) => c.trim().toLowerCase() !== norm);
  return suggestClosestToken(norm, candidates);
}

function suggestCommand(cmd: string): string | null {
  const norm = cmd.trim().toLowerCase();
  const candidates = VALID_COMMANDS.filter(
    (c) => !DEPRECATED_COMMANDS.has(c) && c.trim().toLowerCase() !== norm
  );
  return suggestClosestToken(norm, candidates);
}

async function confirmInteractiveAction(promptText: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return true;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(`${promptText} [y/N] `)).trim().toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

export function runCli(argv: string[]): void | Promise<void> {
  const args = normalizeLeadingFlags(argv.slice(2));
  const cliTermOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
  const cliPrefix = formatCliInvocationPrefix(argv);
  let cmd = (args[0] || '').toLowerCase();
  if (!cmd && process.stdout.isTTY && !process.env.CI) {
    cmd = 'score';
  } else if (!cmd) {
    cmd = 'help';
  }

  // Early version & help interception: ZERO side-effects (no file reads/writes, no global seed, exit code 0)
  let hasStandaloneVersionFlag = false;
  let hasStandaloneHelpFlag = false;
  if (cmd !== 'hook' && cmd !== 'mcp') {
    for (let idx = 0; idx < args.length; idx++) {
      const a = args[idx];
      const lower = a.toLowerCase();
      if (lower === '--version' || lower === '-v') {
        hasStandaloneVersionFlag = true;
      } else if (lower === '--help' || lower === '-h') {
        hasStandaloneHelpFlag = true;
      } else if (
        a.startsWith('-') &&
        a !== '-' &&
        !a.includes('=') &&
        VALUE_TAKING_FLAGS.has(lower) &&
        idx + 1 < args.length &&
        isFlagNextValue(lower, args[idx + 1])
      ) {
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
    hasStandaloneHelpFlag ||
    cmd === 'help' ||
    cmd === '--help' ||
    cmd === '-h' ||
    (cmd === 'optimize' && (extractCliPositionalArgs(args, 1)[0] || '').toLowerCase() === 'help');

  if (isHelpRequested) {
    let targetSubcmd = cmd;
    if (cmd === 'help' || cmd === '--help' || cmd === '-h' || cmd.startsWith('-')) {
      let sub = '';
      for (let idx = 0; idx < args.length; idx++) {
        const a = args[idx];
        if (a.startsWith('-') && a !== '-') {
          const lowerFlag = a.toLowerCase();
          if (
            !a.includes('=') &&
            VALUE_TAKING_FLAGS.has(lowerFlag) &&
            idx + 1 < args.length &&
            isFlagNextValue(lowerFlag, args[idx + 1])
          ) {
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
      case 'profile':
        printProfileHelp(args);
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

  if (cmd === 'optimize') {
    console.error(formatTerminalOutput(RETIRED_OPTIMIZE_NOTICE, cliTermOpts));
    handleExit(1);
    return;
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
      const flag = arg.split('=')[0].toLowerCase();
      if (!allowedFlags.includes(flag)) {
        const suggestion = suggestFlag(flag, allowedFlags);
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
      if (
        (VALUE_TAKING_FLAGS.has(flag) || PROFILE_VALUE_FLAGS.has(flag)) &&
        !arg.includes('=') &&
        idx + 1 < args.length &&
        isFlagNextValue(flag, args[idx + 1])
      ) {
        idx++;
      }
    }
  }

  if (cmd === 'help') {
    printHelp(args);
    return;
  }

  const wsVal = parseCliFlagValue(args, '--workspace') ?? parseCliFlagValue(args, '-w');

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
  const profileSubcmd =
    cmd === 'profile'
      ? (extractCliPositionalArgs(args, 1)[0] || 'show').toLowerCase()
      : '';
  const isInitGlobal = cmd === 'init' && (args.includes('--global') || args.includes('-g'));
  const isDryRun = args.includes('--dry-run');
  const isProjectProfile = cmd === 'profile' && args.includes('--project');
  const isReadOnlyDiagnostic =
    ['score', 'ui', 'doctor', 'audit', 'check', 'inspect', 'tree', 'stats', 'version', '--version', '-v'].includes(cmd) ||
    (cmd === 'init' && isDryRun) ||
    (cmd === 'profile' &&
      (['list', 'show', 'path'].includes(profileSubcmd) ||
        isDryRun ||
        ((profileSubcmd === 'import' || profileSubcmd === 'onboard') && !args.includes('--apply'))));
  const isIsolatedWithoutGlobalOverride =
    (Boolean(process.env.NODE_TEST_CONTEXT) || process.env.EVO_PROFILE_ISOLATED === '1') &&
    !process.env.EVO_GLOBAL_DIR;
  if (
    !isReadOnlyDiagnostic &&
    !isInitGlobal &&
    !isIsolatedWithoutGlobalOverride &&
    fs.existsSync(path.join(globalDir, '.evo'))
  ) {
    ensureGlobalFallbackSeeded(globalDir);
  }

  const isLocalMutationCmd =
    ['init', 'bootstrap', 'virtualize', 'refactor', 'hook', 'uninstall'].includes(cmd) ||
    ((cmd === 'memory' || cmd === 'memories') && (args.includes('refresh') || args.includes('--refresh')));

  let workspaceRoot: string;
  if ((isReadOnlyDiagnostic && cmd !== 'init') || isProjectProfile) {
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
      const logInit = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
      if (isInitGlobal) {
        const dryRun = args.includes('--dry-run');
        const isJson = args.includes('--json');
        const res = runInitGlobal({ dryRun });
        if (isJson) {
          console.log(JSON.stringify({ ok: true, dryRun, ...res }, null, 2));
        } else {
          logInit(`🧬 EvoKernel global setup ${dryRun ? '(Dry Run) ' : ''}complete!`);
          logInit(`  ├─ Global Root     : ${res.globalRoot}`);
          logInit(
            `  ├─ Global MCPs     : ${res.mcpTargetsUpdated.length > 0 ? res.mcpTargetsUpdated.join(', ') : '(already configured or none detected)'}`
          );
          logInit(
            `  ├─ Plugin L0 Seeds : ${res.pluginSeedsUpdated.length > 0 ? res.pluginSeedsUpdated.join(', ') : '(up-to-date or none detected)'}`
          );
          logInit(
            `  └─ Profile Sync    : ${res.profileSync.totalTokens}/${res.profileSync.maxTokens} tok (${res.profileSync.updatedTargets.length > 0 ? res.profileSync.updatedTargets.join(', ') : 'targets up-to-date'})`
          );
        }
        break;
      }

      const dryRun = args.includes('--dry-run');
      const isInitAll = args.includes('--all');
      const stealth = args.includes('--stealth');
      const targets = parseTargetsArg(args, workspaceRoot);
      const linkEvoFrom = parseLinkArg(args);
      const warmup = args.includes('--warmup') && !args.includes('--no-warmup');
      const noIde = args.includes('--no-ide');
      const ide = parseIdeTargetsArg(args);
      const installIde = args.includes('--install-ide') || (Boolean(ide?.length) && !noIde) ? true : undefined;

      if (dryRun) {
        const plannedTargets = targets ?? detectAutoInitTargets(workspaceRoot);
        const preHadGeminiMd = hasNonEvoGeminiMd(workspaceRoot);
        const preHadAgentsMd = fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'));
        const targetsAgentsMd =
          preHadAgentsMd ||
          plannedTargets.some((t) => t === 'agents' || t === 'codex' || t === 'opencode');
        const skipRedundantGeminiMd = targets === undefined && targetsAgentsMd && !preHadGeminiMd;
        const plannedRuleFiles = Array.from(
          new Set(
            plannedTargets.flatMap((t) => {
              const adapter = ALL_HARNESS_ADAPTERS[t];
              if (!adapter) return [];
              return adapter.ruleFiles.filter((f) => !(skipRedundantGeminiMd && f === 'GEMINI.md'));
            })
          )
        );
        const plannedMcpFiles = Array.from(
          new Set(plannedTargets.flatMap((t) => ALL_HARNESS_ADAPTERS[t]?.mcpFiles || []))
        );
        const linkedPreview =
          linkEvoFrom && linkEvoFrom.trim()
            ? path.basename(path.resolve(workspaceRoot, linkEvoFrom.trim())) === '.evo'
              ? path.resolve(workspaceRoot, linkEvoFrom.trim())
              : path.join(path.resolve(workspaceRoot, linkEvoFrom.trim()), '.evo')
            : undefined;
        if (args.includes('--json')) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                dryRun: true,
                workspaceRoot,
                initializedHarnesses: plannedTargets,
                updatedFiles: plannedRuleFiles,
                mcpConfigFiles: plannedMcpFiles,
                stealth,
                warmup,
                ...(linkedPreview ? { linkedSharedEvoDir: linkedPreview } : {}),
              },
              null,
              2
            )
          );
          break;
        }
        logInit('🧬 EvoKernel initialization preview (Dry Run — no files modified):');
        logInit(`  ├─ Workspace       : ${workspaceRoot}`);
        logInit(`  ├─ Harnesses       : ${plannedTargets.join(', ') || '(none)'}`);
        logInit(`  ├─ Planned rules   : ${plannedRuleFiles.join(', ') || '(none)'}`);
        logInit(`  ├─ Planned MCPs    : ${plannedMcpFiles.join(', ') || '(none)'}`);
        if (linkedPreview) {
          logInit(`  ├─ Shared .evo     : ${linkedPreview}`);
        }
        logInit(`  └─ Mode            : ${stealth ? 'Stealth (.git/info/exclude)' : 'Standard'}`);
        break;
      }

      let res: ReturnType<typeof runInit>;
      try {
        res = runInit(workspaceRoot, {
          stealth,
          targets,
          linkEvoFrom,
          warmup,
          installIde,
          noIde,
          ide,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (args.includes('--json')) {
          console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
        } else {
          console.error(formatTerminalOutput(`❌ Error: ${msg}`, cliTermOpts));
        }
        handleExit(1);
        return;
      }
      const globalRes = isInitAll ? runInitGlobal({ dryRun: false }) : undefined;
      if (args.includes('--json')) {
        console.log(JSON.stringify({ ok: true, ...res, ...(globalRes ? { global: globalRes } : {}) }, null, 2));
        break;
      }
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
      if (globalRes) {
        logInit(`  ├─ Global Root     : ${globalRes.globalRoot}`);
        logInit(
          `  ├─ Global MCPs     : ${globalRes.mcpTargetsUpdated.length > 0 ? globalRes.mcpTargetsUpdated.join(', ') : '(already configured or none detected)'}`
        );
        logInit(
          `  ├─ Plugin L0 Seeds : ${globalRes.pluginSeedsUpdated.length > 0 ? globalRes.pluginSeedsUpdated.join(', ') : '(up-to-date or none detected)'}`
        );
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
              stale: verifications.filter((v) => v.overall_status === 'STALE').length,
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
        return handleExit(1);
      }
      break;
    }

    case 'refactor': {
      const includeGlobal = args.includes('--global') || args.includes('-g');
      const apply = args.includes('--apply');
      const skipConfirm = args.includes('--yes') || args.includes('-y');
      const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      const executeRefactor = () => {
        const result = runRefactor(workspaceRoot, {
          includeGlobal,
          apply,
          tokenBudgetLimit: parsePositiveIntFlag(args, '--token-budget'),
          skillBudgetLimit: parsePositiveIntFlag(args, '--skill-budget'),
        });
        if (args.includes('--json')) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(renderRefactorReport(result, termOpts));
          if (result.backupDir) {
            console.log(formatTerminalOutput(`💾 Backup saved to: ${result.backupDir}`, termOpts));
          }
        }
      };
      if (apply && !skipConfirm && process.stdin.isTTY && process.stdout.isTTY) {
        return (async () => {
          const confirmed = await confirmInteractiveAction(
            `Apply automated refactoring to ${includeGlobal ? 'workspace + global' : 'workspace'} rules/skills? (Backups will be saved to .evo/.cache/refactor-backups/)`
          );
          if (!confirmed) {
            console.log(formatTerminalOutput('Cancelled (no files modified).', termOpts));
            return;
          }
          executeRefactor();
        })();
      }
      executeRefactor();
      break;
    }

    case 'profile': {
      const positionalArgs = extractCliPositionalArgs(args, 1);
      const action = (positionalArgs[0] || 'show').toLowerCase();
      const validProfileActions = [
        'list',
        'show',
        'add',
        'remove',
        'sync',
        'undo',
        'import',
        'onboard',
        'clean',
        'path',
      ];
      if (!validProfileActions.includes(action)) {
        console.error(
          formatTerminalOutput(
            `❌ Error: Unknown profile subcommand '${action}'. Usage: evo profile [${validProfileActions.join('|')}]`,
            cliTermOpts
          )
        );
        handleExit(1);
        return;
      }

      const isJson = args.includes('--json');
      const dryRun = args.includes('--dry-run');
      const apply = args.includes('--apply');
      const isProject = args.includes('--project');
      const activeScope: 'global' | 'project' = isProject ? 'project' : 'global';
      const activeRoot = isProject ? workspaceRoot : globalDir;
      const profileStorage = new EvoStorage(globalDir);
      const activeStorage = isProject ? new EvoStorage(workspaceRoot) : profileStorage;
      const hasActiveEvo = hasValidEvoStructure(activeStorage.evoDir);
      const cfg = hasActiveEvo ? activeStorage.getConfig() : { ...DEFAULT_EVO_CONFIG };
      const maxTokens = cfg.maxGlobalProfileTokens ?? 800;
      const maxMenuTokens = cfg.maxDirectoryMenuTokens ?? 250;

      const commitCandidates = (
        candidates: ParsedPreferenceCandidate[],
        targetStorage: EvoStorage,
        scope: 'global' | 'project',
        origin: string
      ) => {
        targetStorage.ensureInitialized();
        const imported: Array<{ id: string; title: string; category: PreferenceCategory }> = [];
        const rejected: Array<{ id: string; title: string; error_code?: string; message: string }> = [];
        const telem = new EvoTelemetry(targetStorage);
        try {
          const gatekeeper = new EvoGatekeeper(targetStorage, telem);
          for (const cand of candidates) {
            const payload: ProposalPayload = {
              kind: 'preference',
              id: cand.id,
              title: cand.title,
              l0_summary: cand.l0_summary,
              category: cand.category,
              always_on: cand.always_on,
              ...(cand.trigger_cue ? { trigger_cue: cand.trigger_cue } : {}),
              scope,
              content: cand.content,
              origin,
              enabled: true,
              review_status: 'approved',
            };
            const gateRes = gatekeeper.evaluateAndCommit(payload, { bypassConfoundedCheck: true });
            if (gateRes.passed) {
              imported.push({ id: cand.id, title: cand.title, category: cand.category });
            } else {
              rejected.push({
                id: cand.id,
                title: cand.title,
                error_code: gateRes.error_code,
                message: gateRes.message,
              });
            }
          }
          if (imported.length > 0) {
            telem.syncFromDisk(true);
          }
        } finally {
          telem.close();
        }
        const syncRes =
          imported.length > 0 && scope === 'global'
            ? syncGlobalUserProfile(targetStorage.rootDir)
            : undefined;
        if (imported.length > 0 && scope === 'project') {
          syncManagedRuleBlocks(targetStorage.rootDir);
        }
        return { imported, rejected, syncRes };
      };

      if (action === 'add') {
        const explicitCategory = parseCliFlagValue(args, '--category');
        const rawTitle = (parseCliFlagValue(args, '--title') || '').trim();
        const rawSummary = (parseCliFlagValue(args, '--summary') || '').trim();
        const rawContent = (parseCliFlagValue(args, '--content') || '').trim();
        const rawId = (parseCliFlagValue(args, '--id') || '').trim();
        const explicitTrigger = parseCliFlagValue(args, '--trigger');
        const explicitOnDemand = args.includes('--on-demand');

        const positionalText = positionalArgs.slice(1).join(' ').trim();
        const content = rawContent || positionalText || rawSummary || rawTitle;
        if (!content) {
          const msg =
            'Missing preference content. Usage: evo profile add "<text>" [--category <cat>] [--on-demand]';
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ Error: ${msg}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }
        const rawCategory = (
          explicitCategory !== undefined
            ? explicitCategory
            : inferPreferenceCategory(content, rawTitle)
        )
          .trim()
          .toLowerCase();
        const inferredSituational =
          !explicitOnDemand && explicitTrigger === undefined
            ? inferSituationalOnDemand(content)
            : undefined;
        const alwaysOn = explicitOnDemand
          ? false
          : explicitTrigger !== undefined
            ? false
            : inferredSituational
              ? inferredSituational.alwaysOn
              : true;
        const triggerCue = (
          explicitTrigger !== undefined
            ? explicitTrigger
            : inferredSituational?.triggerCue || ''
        ).trim();
        if (!PREFERENCE_CATEGORIES.includes(rawCategory as PreferenceCategory)) {
          const msg = `Invalid category '${rawCategory}'. Must be one of: ${PREFERENCE_CATEGORIES.join(', ')}`;
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error_code: 'ERR_INVALID_SCHEMA', error: msg }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ Error: ${msg}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }

        const title = rawTitle || rawSummary || content.split(/\r?\n/)[0].slice(0, 72);
        const l0Summary =
          rawSummary || rawTitle || content.replace(/\s+/g, ' ').trim().slice(0, 130);
        const sanitizedRawId = rawId ? sanitizeId(rawId) : '';
        let autoTitleId = sanitizeId(title);
        if (!isProject && autoTitleId && !/[a-z]/i.test(autoTitleId)) {
          autoTitleId = '';
        }
        if (
          !isProject &&
          /^(?:\d+[a-z0-9]*|proj-[a-z0-9]+|project-[a-z0-9]+)-/i.test(autoTitleId)
        ) {
          autoTitleId = `pref-${autoTitleId}`;
        }
        const cleanId =
          sanitizedRawId ||
          (autoTitleId.length >= 3
            ? autoTitleId.slice(0, 48).replace(/-+$/, '')
            : `pref-${crypto.createHash('sha256').update(`${title}\0${content}`).digest('hex').slice(0, 8)}`);

        const targetRoot = activeRoot;
        const targetStorage = activeStorage;

        if (dryRun) {
          const receipt = `🧬 EvoKernel Evolution Receipt: [preference] ${cleanId} (${l0Summary})`;
          const plannedHosts = isProject
            ? []
            : discoverGlobalProfileTargets(globalDir).map((t) => t.path);
          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  dryRun: true,
                  id: cleanId,
                  scope: activeScope,
                  category: rawCategory,
                  title,
                  l0_summary: l0Summary,
                  always_on: alwaysOn,
                  ...(triggerCue ? { trigger_cue: triggerCue } : {}),
                  receipt,
                  plannedHostTargets: plannedHosts,
                  syncedTargets: [],
                },
                null,
                2
              )
            );
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile(`🧪 Dry Run — Would add preference '${cleanId}' (${activeScope}, ${rawCategory}): ${l0Summary}`);
            if (!isProject) {
              logProfile(
                `  └─ Host Targets  : ${plannedHosts.length > 0 ? plannedHosts.join(', ') : '(none detected)'}`
              );
            } else {
              logProfile(`  └─ Project Scope : ${workspaceRoot}`);
            }
          }
          break;
        }

        targetStorage.ensureInitialized();

        const payload: ProposalPayload = {
          kind: 'preference',
          id: cleanId,
          title,
          l0_summary: l0Summary,
          category: rawCategory as PreferenceCategory,
          always_on: alwaysOn,
          ...(triggerCue ? { trigger_cue: triggerCue } : {}),
          scope: isProject ? 'project' : 'global',
          content,
          origin: 'cli',
          enabled: true,
          review_status: 'approved',
        };

        const telem = new EvoTelemetry(targetStorage);
        let gateRes;
        try {
          const gatekeeper = new EvoGatekeeper(targetStorage, telem);
          gateRes = gatekeeper.evaluateAndCommit(payload, { bypassConfoundedCheck: true });
          if (gateRes.passed) {
            telem.syncFromDisk(true);
          }
        } finally {
          telem.close();
        }

        if (!gateRes.passed) {
          if (isJson) {
            console.log(JSON.stringify({ ok: false, ...gateRes }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ ${gateRes.message}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }

        const syncRes = isProject ? undefined : syncGlobalUserProfile(globalDir);
        if (isProject) {
          syncManagedRuleBlocks(workspaceRoot);
        }
        const receipt = `🧬 EvoKernel Evolution Receipt: [preference] ${cleanId} (${l0Summary})`;
        if (isJson) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                id: cleanId,
                scope: isProject ? 'project' : 'global',
                category: rawCategory,
                always_on: alwaysOn,
                ...(triggerCue ? { trigger_cue: triggerCue } : {}),
                receipt,
                syncedTargets: syncRes?.updatedTargets || [],
                ...(syncRes
                  ? { totalTokens: syncRes.totalTokens, maxTokens: syncRes.maxTokens }
                  : {}),
              },
              null,
              2
            )
          );
        } else {
          const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
          logProfile(receipt);
          if (syncRes) {
            logProfile(
              `  ├─ Token Budget  : ${syncRes.totalTokens}/${syncRes.maxTokens} tok (Menu: ${syncRes.menuTokens}/${syncRes.maxMenuTokens} tok)`
            );
            const externalAiTargets = syncRes.targets.filter(
              (t) => t.host !== 'isolated' && !/USER_PROFILE\.md$/i.test(String(t.path || ''))
            );
            const externalUpdated = syncRes.updatedTargets.filter(
              (p) => !/USER_PROFILE\.md$/i.test(String(p))
            );
            const localProfileTargets = syncRes.targets
              .filter(
                (t) => t.host === 'isolated' || /USER_PROFILE\.md$/i.test(String(t.path || ''))
              )
              .map((t) => t.path);
            if (externalUpdated.length > 0) {
              logProfile(`  ├─ Host Targets  : ${externalUpdated.join(', ')}`);
            } else if (externalAiTargets.length === 0) {
              if (localProfileTargets.length > 0) {
                logProfile(`  ├─ Local Profile : ${localProfileTargets.join(', ')}`);
              }
              logProfile(
                `  ├─ Host Targets  : ⚠️ Preference saved locally, but 0 AI hosts detected. Run \`${cliPrefix} init --global\` to connect.`
              );
            } else {
              logProfile(`  ├─ Host Targets  : (already up-to-date)`);
            }
          } else {
            logProfile(`  ├─ Project Scope : ${workspaceRoot}`);
          }
          logProfile(`  └─ Undo          : ${cliPrefix} profile undo${isProject ? ' --project' : ''}`);
        }
        break;
      }

      if (action === 'remove') {
        const rawTargetId = positionalArgs[1] ? positionalArgs[1].trim() : '';
        if (!rawTargetId) {
          const msg = 'Missing preference ID. Usage: evo profile remove <id> [--project] [--json]';
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ Error: ${msg}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }

        const cleanId = sanitizeId(rawTargetId);
        const targetStorage = activeStorage;
        const existingPref = hasActiveEvo
          ? targetStorage.getPreference(cleanId)
          : null;
        if (!existingPref) {
          const msg = `Preference '${cleanId}' not found in ${activeRoot}`;
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ ${msg}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }

        if (dryRun) {
          const plannedHosts = isProject
            ? []
            : discoverGlobalProfileTargets(globalDir).map((t) => t.path);
          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  dryRun: true,
                  removed: cleanId,
                  scope: activeScope,
                  plannedHostTargets: plannedHosts,
                  syncedTargets: [],
                },
                null,
                2
              )
            );
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile(`🧪 Dry Run — Would archive preference '${cleanId}' (${activeScope})`);
          }
          break;
        }

        let prevSnapshot: string | undefined;
        const prefFilePath = path.join(targetStorage.preferencesDir, `${cleanId}.md`);
        if (fs.existsSync(prefFilePath)) {
          try {
            prevSnapshot = fs.readFileSync(prefFilePath, 'utf8');
          } catch {}
        }

        const reason = 'Removed via evo profile remove CLI';
        const archived = targetStorage.archiveCapability(cleanId, 'preference', reason);
        if (!archived) {
          const msg = `Failed to archive preference '${cleanId}'`;
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ ${msg}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }

        targetStorage.appendProfileHistory({
          ts: new Date().toISOString(),
          action: 'archive',
          id: cleanId,
          kind: 'preference',
          title: existingPref.title || cleanId,
          ...(prevSnapshot ? { previous_snapshot: prevSnapshot } : {}),
          reason,
        });

        const telem = new EvoTelemetry(targetStorage);
        try {
          telem.syncFromDisk(true);
        } finally {
          telem.close();
        }

        const syncRes = isProject ? undefined : syncGlobalUserProfile(globalDir);
        if (isProject) {
          syncManagedRuleBlocks(workspaceRoot);
        }

        if (isJson) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                removed: cleanId,
                scope: isProject ? 'project' : 'global',
                syncedTargets: syncRes?.updatedTargets || [],
                ...(syncRes
                  ? { totalTokens: syncRes.totalTokens, maxTokens: syncRes.maxTokens }
                  : {}),
              },
              null,
              2
            )
          );
        } else {
          const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
          logProfile(`🗑️  Archived preference '${cleanId}' (${isProject ? 'project' : 'global'})`);
          if (syncRes) {
            logProfile(
              `  ├─ Host Targets  : ${syncRes.updatedTargets.length > 0 ? syncRes.updatedTargets.join(', ') : syncRes.targets.length === 0 ? `(0 AI hosts detected — run \`${cliPrefix} init --global\` to connect)` : '(already up-to-date)'}`
            );
          }
          logProfile(`  └─ Undo          : ${cliPrefix} profile undo${isProject ? ' --project' : ''}`);
        }
        break;
      }

      if (action === 'import') {
        const fileArg = positionalArgs[1] ? positionalArgs[1].trim() : '';
        if (!fileArg) {
          const msg = 'Missing markdown file path. Usage: evo profile import <filePath> [--apply] [--json]';
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ Error: ${msg}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }
        const cwdTarget = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);
        const wsTarget = path.isAbsolute(fileArg) ? fileArg : path.resolve(workspaceRoot, fileArg);
        const resolvedFile = fs.existsSync(cwdTarget) ? cwdTarget : wsTarget;
        if (!fs.existsSync(resolvedFile) || fs.statSync(resolvedFile).isDirectory()) {
          const msg = `Markdown file not found: ${resolvedFile}`;
          if (isJson) {
            console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          } else {
            console.error(formatTerminalOutput(`❌ Error: ${msg}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }

        const rawMd = fs.readFileSync(resolvedFile, 'utf8').replace(/^\uFEFF/, '');
        const candidates = parseMarkdownToPreferenceCandidates(rawMd, path.basename(resolvedFile));

        if (!apply || dryRun) {
          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  dryRun: true,
                  applied: false,
                  scope: activeScope,
                  filePath: resolvedFile,
                  count: candidates.length,
                  candidates,
                },
                null,
                2
              )
            );
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile(`📄 Profile Import Preview (${candidates.length} candidate(s) from ${path.basename(resolvedFile)}):`);
            if (candidates.length === 0) {
              logProfile('  (no importable preference directives found)');
            } else {
              for (const c of candidates) {
                logProfile(`  ├─ [${c.category}] ${c.id} — ${c.l0_summary}`);
              }
              logProfile('  └─ Re-run with `--apply` to validate via Gatekeeper and sync host profiles.');
            }
          }
          break;
        }

        const { imported, rejected, syncRes } = commitCandidates(
          candidates,
          activeStorage,
          activeScope,
          'imported'
        );
        const allRejected = imported.length === 0 && rejected.length > 0;
        if (isJson) {
          console.log(
            JSON.stringify(
              {
                ok: !allRejected,
                dryRun: false,
                applied: true,
                scope: activeScope,
                filePath: resolvedFile,
                importedCount: imported.length,
                rejectedCount: rejected.length,
                imported,
                rejected,
                syncedTargets: syncRes?.updatedTargets || [],
              },
              null,
              2
            )
          );
        } else {
          const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
          logProfile(`🧬 Profile Import Complete: ${imported.length} imported, ${rejected.length} rejected`);
          for (const item of imported) {
            logProfile(`  ├─ [+] ${item.id} (${item.category})`);
          }
          for (const err of rejected) {
            logProfile(`  ├─ [!] ${err.id}: ${err.error_code || 'REJECTED'} — ${err.message}`);
          }
          if (syncRes) {
            logProfile(
              `  └─ Host Targets : ${syncRes.updatedTargets.length > 0 ? syncRes.updatedTargets.join(', ') : '(already up-to-date)'}`
            );
          }
        }
        if (allRejected) {
          handleExit(1);
          return;
        }
        break;
      }

      if (action === 'onboard') {
        const presetFlag = parseCliFlagValue(args, '--preset');
        const presetNames = Object.keys(ONBOARDING_PRESETS) as OnboardingPresetName[];

        if (presetFlag) {
          const normalizedPreset = presetFlag.trim().toLowerCase() as OnboardingPresetName;
          if (!Object.prototype.hasOwnProperty.call(ONBOARDING_PRESETS, normalizedPreset)) {
            const msg = `Unknown preset '${presetFlag}'. Available presets: ${presetNames.join(', ')}`;
            if (isJson) {
              console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
            } else {
              console.error(formatTerminalOutput(`❌ Error: ${msg}`, cliTermOpts));
            }
            handleExit(1);
            return;
          }

          const candidates = getOnboardingPresetCandidates(normalizedPreset);
          if (!apply || dryRun) {
            if (isJson) {
              console.log(
                JSON.stringify(
                  {
                    ok: true,
                    dryRun: true,
                    applied: false,
                    scope: activeScope,
                    preset: normalizedPreset,
                    candidates,
                  },
                  null,
                  2
                )
              );
            } else {
              const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
              logProfile(`🧭 Onboarding Preset Preview: ${normalizedPreset} (${candidates.length} preferences)`);
              for (const c of candidates) {
                logProfile(`  ├─ [${c.category}] ${c.id} — ${c.l0_summary}`);
              }
              logProfile('  └─ Re-run with `--apply` to commit and sync across detected hosts.');
            }
            break;
          }

          const { imported, rejected, syncRes } = commitCandidates(
            candidates,
            activeStorage,
            activeScope,
            'onboarding'
          );
          const allRejected = imported.length === 0 && rejected.length > 0;
          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  ok: !allRejected,
                  dryRun: false,
                  applied: true,
                  scope: activeScope,
                  preset: normalizedPreset,
                  importedCount: imported.length,
                  rejectedCount: rejected.length,
                  imported,
                  rejected,
                  syncedTargets: syncRes?.updatedTargets || [],
                },
                null,
                2
              )
            );
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile(`🧬 Onboarding Applied (${normalizedPreset}): ${imported.length} active, ${rejected.length} skipped`);
            if (syncRes) {
              logProfile(
                `  └─ Host Targets : ${syncRes.updatedTargets.length > 0 ? syncRes.updatedTargets.join(', ') : '(already up-to-date)'}`
              );
            }
          }
          if (allRejected) {
            handleExit(1);
            return;
          }
          break;
        }

        const isInteractiveTty =
          Boolean(process.stdin.isTTY) &&
          Boolean(process.stdout.isTTY) &&
          !isJson &&
          !Boolean(process.argv[1]?.includes('.test.'));

        if (!isInteractiveTty) {
          const presetSummaries = presetNames.map((name) => ({
            id: name,
            name: ONBOARDING_PRESETS[name].name,
            description: ONBOARDING_PRESETS[name].description,
            count: ONBOARDING_PRESETS[name].candidates.length,
          }));
          if (isJson) {
            console.log(JSON.stringify({ ok: true, presets: presetSummaries }, null, 2));
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile('🧭 Available Onboarding Presets:');
            for (const p of presetSummaries) {
              logProfile(`  ├─ ${p.id} (${p.count} prefs) — ${p.description}`);
            }
            logProfile('  └─ Preview with: `evo profile onboard --preset <name>` (add `--apply` to save)');
          }
          break;
        }

        return (async () => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          try {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile('🧭 EvoKernel Personal Profile Onboarding (3 quick prompts):');
            logProfile('  1) concise-ceo        — Bottom-line first, 3-5 bullets, flag risks upfront');
            logProfile('  2) rigorous-engineer  — Root-cause first, minimal diff, real build/tests');
            logProfile('  3) technical-writer   — Structured headings, consistent terms, runnable examples');
            const ansPreset = (
              await rl.question('\n[1/3] Select preset [1-3 or name, default: rigorous-engineer]: ')
            ).trim().toLowerCase();
            const chosenPreset: OnboardingPresetName =
              ansPreset === '1' || ansPreset === 'concise-ceo'
                ? 'concise-ceo'
                : ansPreset === '3' || ansPreset === 'technical-writer'
                  ? 'technical-writer'
                  : 'rigorous-engineer';

            const extraRule = (
              await rl.question('[2/3] Optional custom communication/formatting rule (Enter to skip): ')
            ).trim();
            const confirm = (
              await rl.question(`[3/3] Apply '${chosenPreset}' to ${isProject ? 'project' : 'global'} profile? [Y/n]: `)
            ).trim().toLowerCase();

            if (confirm === 'n' || confirm === 'no') {
              logProfile('Cancelled — no changes written.');
              return;
            }

            const candidates = getOnboardingPresetCandidates(chosenPreset);
            if (extraRule) {
              const normalizedExtra = extraRule.replace(/^(?:[-*+]|\d+[.)])\s+/, '').trim();
              if (normalizedExtra) {
                const extraCands = parseMarkdownToPreferenceCandidates(`- ${normalizedExtra}`, 'onboarding');
                const existingIds = new Set(candidates.map((c) => c.id));
                for (const ec of extraCands) {
                  let cid = ec.id;
                  let n = 2;
                  while (existingIds.has(cid)) {
                    cid = `${ec.id.slice(0, 44)}-${n++}`;
                  }
                  existingIds.add(cid);
                  candidates.push({ ...ec, id: cid });
                }
              }
            }
            const { imported, rejected, syncRes } = commitCandidates(
              candidates,
              activeStorage,
              activeScope,
              'onboarding'
            );
            logProfile(`🧬 Applied ${imported.length} preference(s) (${rejected.length} skipped).`);
            if (syncRes) {
              logProfile(
                `  └─ Host Targets : ${syncRes.updatedTargets.length > 0 ? syncRes.updatedTargets.join(', ') : '(already up-to-date)'}`
              );
            }
            if (imported.length === 0 && rejected.length > 0) {
              handleExit(1);
            }
          } finally {
            rl.close();
          }
        })().catch((err) => {
          console.error(err);
          handleExit(1);
        });
      }

      if (action === 'clean') {
        const skipConfirm = args.includes('--yes') || args.includes('-y');
        const executeClean = () => {
          const cleanRes = cleanGlobalUserProfile(globalDir, { dryRun });
          if (isJson) {
            console.log(JSON.stringify({ ok: true, globalRoot: globalDir, dryRun, ...cleanRes }, null, 2));
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile(
              dryRun
                ? '🧪 Dry Run — Would clean User-Global Profile blocks from host targets:'
                : '🧹 User-Global Profile Cleaned:'
            );
            logProfile(
              `  ├─ Host Targets  : ${cleanRes.updatedTargets.length > 0 ? cleanRes.updatedTargets.join(', ') : '(no EVO:PROFILE blocks found)'}`
            );
            logProfile(`  └─ Restore anytime: ${cliPrefix} profile sync`);
          }
        };
        if (!dryRun && !skipConfirm && process.stdin.isTTY && process.stdout.isTTY) {
          return (async () => {
            const confirmed = await confirmInteractiveAction(
              'Remove EvoKernel profile blocks from detected global AI host configs?'
            );
            if (!confirmed) {
              console.log(formatTerminalOutput('Cancelled (no files modified).', cliTermOpts));
              return;
            }
            executeClean();
          })();
        }
        executeClean();
        break;
      }

      if (action === 'undo') {
        const targetId = positionalArgs[1] ? positionalArgs[1].trim() : undefined;
        if (dryRun) {
          if (targetId !== undefined && targetId !== '' && !sanitizeId(targetId)) {
            const msg = 'Invalid target ID';
            if (isJson) {
              console.log(JSON.stringify({ ok: false, dryRun: true, scope: activeScope, ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }), message: msg }, null, 2));
            } else {
              console.error(formatTerminalOutput(`❌ ${msg}`, cliTermOpts));
            }
            handleExit(1);
            return;
          }
          let dryCandidate: ReturnType<EvoStorage['listProfileHistory']>[number] | undefined;
          if (hasActiveEvo) {
            const historyChronological = [...activeStorage.listProfileHistory(500)].reverse();
            const cleanTargetId = targetId ? sanitizeId(targetId) : undefined;
            const undoBalance = new Map<string, number>();
            for (let i = historyChronological.length - 1; i >= 0; i--) {
              const entry = historyChronological[i];
              const entryCleanId = sanitizeId(entry.id) || entry.id;
              const key = `${entry.kind}:${sanitizeId(entry.id)}`;
              if (entry.action === 'undo') {
                undoBalance.set(key, (undoBalance.get(key) || 0) + 1);
                continue;
              }
              if (cleanTargetId && sanitizeId(entry.id) !== cleanTargetId) {
                continue;
              }
              const pendingUndos = undoBalance.get(key) || 0;
              if (pendingUndos > 0) {
                undoBalance.set(key, pendingUndos - 1);
                continue;
              }
              if (entry.action === 'add' && !cleanTargetId) {
                const isActiveOnDisk =
                  entry.kind === 'preference'
                    ? Boolean(activeStorage.getPreference(entryCleanId))
                    : Boolean(activeStorage.getMemory(entryCleanId));
                if (!isActiveOnDisk) {
                  continue;
                }
              }
              if (entry.action === 'add' || entry.action === 'update' || entry.action === 'archive') {
                dryCandidate = entry;
                break;
              }
            }
          }
          if (!hasActiveEvo || !dryCandidate) {
            const msg = !hasActiveEvo
              ? `${isProject ? 'Project' : 'Global'} profile storage is not initialized at ${activeRoot}`
              : targetId
                ? `No reversible profile change found for '${sanitizeId(targetId)}'.`
                : 'No reversible profile change found to undo.';
            if (isJson) {
              console.log(
                JSON.stringify(
                  {
                    ok: false,
                    dryRun: true,
                    scope: activeScope,
                    ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }),
                    message: msg,
                  },
                  null,
                  2
                )
              );
            } else {
              console.error(formatTerminalOutput(`❌ ${msg}`, cliTermOpts));
            }
            handleExit(1);
            return;
          }
          const previewMsg = `Would undo ${dryCandidate.action} of ${dryCandidate.kind} '${dryCandidate.id}'.`;
          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  dryRun: true,
                  scope: activeScope,
                  ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }),
                  undone: dryCandidate,
                  message: previewMsg,
                  syncedTargets: [],
                },
                null,
                2
              )
            );
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile(`🧪 Dry Run — ${previewMsg}`);
          }
          break;
        }

        const undoRes = hasActiveEvo
          ? activeStorage.undoLastProfileChange(targetId)
          : { ok: false, message: `${isProject ? 'Project' : 'Global'} profile storage is not initialized at ${activeRoot}` };
        if (!undoRes.ok) {
          if (isJson) {
            console.log(
              JSON.stringify(
                {
                  scope: activeScope,
                  ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }),
                  ...undoRes,
                },
                null,
                2
              )
            );
          } else {
            console.error(formatTerminalOutput(`❌ ${undoRes.message}`, cliTermOpts));
          }
          handleExit(1);
          return;
        }
        const syncRes = isProject ? undefined : syncGlobalUserProfile(globalDir);
        const projectSynced = isProject ? syncManagedRuleBlocks(workspaceRoot) : undefined;
        const gTele = new EvoTelemetry(activeStorage);
        try {
          gTele.syncFromDisk(true);
        } finally {
          gTele.close();
        }
        if (isJson) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                scope: activeScope,
                ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }),
                undone: undoRes.undone,
                message: undoRes.message,
                syncedTargets: syncRes ? syncRes.updatedTargets : projectSynced || [],
                ...(syncRes
                  ? {
                      totalTokens: syncRes.totalTokens,
                      maxTokens: syncRes.maxTokens,
                      menuTokens: syncRes.menuTokens,
                    }
                  : {}),
              },
              null,
              2
            )
          );
        } else {
          const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
          logProfile(`↩️  ${undoRes.message}`);
          if (syncRes) {
            logProfile(
              `  ├─ Token Budget  : ${syncRes.totalTokens}/${syncRes.maxTokens} tok (Menu: ${syncRes.menuTokens}/${syncRes.maxMenuTokens} tok)`
            );
            logProfile(
              `  └─ Host Targets  : ${syncRes.updatedTargets.length > 0 ? syncRes.updatedTargets.join(', ') : '(already up-to-date)'}`
            );
          } else {
            logProfile(`  └─ Project Files : ${projectSynced && projectSynced.length > 0 ? projectSynced.join(', ') : '(already up-to-date)'}`);
          }
        }
        break;
      }

      if (action === 'path') {
        const payload = {
          scope: activeScope,
          ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }),
          evoDir: activeStorage.evoDir,
          preferencesDir: activeStorage.preferencesDir,
          profileDigestPath: activeStorage.profileDigestPath,
          profileHistoryPath: activeStorage.profileHistoryPath,
        };
        if (isJson) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(formatTerminalOutput(`${isProject ? 'Workspace Root   ' : 'Global Root      '}: ${activeRoot}`, cliTermOpts));
          console.log(formatTerminalOutput(`Preferences Dir  : ${payload.preferencesDir}`, cliTermOpts));
          console.log(formatTerminalOutput(`Profile Digest   : ${payload.profileDigestPath}`, cliTermOpts));
          console.log(formatTerminalOutput(`Profile History  : ${payload.profileHistoryPath}`, cliTermOpts));
        }
        break;
      }

      if (action === 'sync') {
        if (isProject) {
          const updatedTargets = dryRun ? [] : syncManagedRuleBlocks(workspaceRoot);
          if (isJson) {
            console.log(JSON.stringify({ scope: 'project', workspaceRoot, dryRun, updatedTargets }, null, 2));
          } else {
            const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
            logProfile(`🧬 Project Profile ${dryRun ? '(Dry Run) ' : ''}Synced:`);
            logProfile(`  ├─ Workspace Root: ${workspaceRoot}`);
            logProfile(
              `  └─ Project Files : ${updatedTargets.length > 0 ? updatedTargets.join(', ') : '(already up-to-date)'}`
            );
          }
          break;
        }
        const syncRes = syncGlobalUserProfile(globalDir, { dryRun });
        if (isJson) {
          console.log(JSON.stringify({ globalRoot: globalDir, dryRun, ...syncRes }, null, 2));
        } else {
          const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
          logProfile(`🧬 User-Global Profile ${dryRun ? '(Dry Run) ' : ''}Synced:`);
          logProfile(`  ├─ Global Root   : ${globalDir}`);
          logProfile(`  ├─ Profile Digest: ${syncRes.digestPath}`);
          logProfile(
            `  ├─ Token Budget  : ${syncRes.totalTokens}/${syncRes.maxTokens} tokens (Menu: ${syncRes.menuTokens}/${syncRes.maxMenuTokens} tok)`
          );
          logProfile(
            `  └─ Host Targets  : ${syncRes.updatedTargets.length > 0 ? syncRes.updatedTargets.join(', ') : '(already up-to-date)'}`
          );
        }
        break;
      }

      const prefs = hasActiveEvo ? activeStorage.listPreferences() : [];
      const activeAlwaysOn = prefs.filter((p) => p.always_on !== false && p.enabled !== false);
      const { totalTokens } = hasActiveEvo
        ? activeStorage.getProfileTokenUsage()
        : { totalTokens: 0 };
      const directoryMenu = hasActiveEvo
        ? activeStorage.formatTaskDirectoryMenu(maxMenuTokens)
        : '';
      const menuTokens = estimateTokens(directoryMenu);

      if (action === 'list') {
        if (isJson) {
          console.log(
            JSON.stringify(
              {
                scope: activeScope,
                ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }),
                totalTokens,
                maxTokens,
                menuTokens,
                maxMenuTokens,
                preferences: prefs,
              },
              null,
              2
            )
          );
        } else {
          const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
          logProfile(`👤 ${isProject ? 'Project' : 'User-Global'} Personal Preferences (${prefs.length} total | Always-On Budget: ${totalTokens}/${maxTokens} tokens)`);
          if (prefs.length === 0) {
            logProfile(
              `  └── (empty — run \`${cliPrefix} profile add "<text>"${isProject ? ' --project' : ''}\` or \`${cliPrefix} profile onboard\` to add preferences)`
            );
          } else {
            prefs.forEach((p, idx) => {
              const branch = idx === prefs.length - 1 ? '└──' : '├──';
              const modeBadge = p.always_on !== false ? '[ALWAYS-ON]' : '[ON-DEMAND]';
              const stateBadge = p.enabled === false ? ' [PAUSED]' : '';
              logProfile(
                `  ${branch} ${modeBadge}${stateBadge} ${p.id} (${p.category} | ${p.tokens} tok) — ${p.l0_summary}`
              );
            });
          }
        }
        break;
      }

      // action === 'show' (read-only)
      let digest = '';
      if (fs.existsSync(activeStorage.profileDigestPath)) {
        digest = fs.readFileSync(activeStorage.profileDigestPath, 'utf8').trim();
      } else if (activeAlwaysOn.length > 0) {
        digest = activeStorage.formatUserProfileDigest();
      }

      if (isJson) {
        console.log(
          JSON.stringify(
            {
              scope: activeScope,
              ...(isProject ? { workspaceRoot: activeRoot } : { globalRoot: globalDir }),
              profileDigestPath: activeStorage.profileDigestPath,
              totalTokens,
              maxTokens,
              menuTokens,
              maxMenuTokens,
              digest,
              directoryMenu,
              preferences: activeAlwaysOn,
            },
            null,
            2
          )
        );
      } else {
        const logProfile = (line: string) => console.log(formatTerminalOutput(line, cliTermOpts));
        logProfile(`👤 ${isProject ? 'Project' : 'User-Global'} Profile Digest (${totalTokens}/${maxTokens} tokens | ${activeRoot})`);
        if (!digest) {
          logProfile('  (no active always-on preferences yet)');
        } else {
          console.log('');
          console.log(digest);
        }
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
      const includeGlobal = args.includes('--global') || args.includes('-g');
      console.error(
        formatTerminalOutput(
          "ℹ️ Note: 'evo stats' is deprecated; use 'evo doctor --roi' for ROI & session-start tax diagnostics.",
          termOpts
        )
      );
      if (args.includes('--json')) {
        console.log(JSON.stringify(buildEvoStatsJson(workspaceRoot, { includeGlobal }), null, 2));
      } else {
        console.log(renderEvoStats(workspaceRoot, { ...termOpts, includeGlobal }));
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
      const dryRun = args.includes('--dry-run');

      const isTestProcess = Boolean(process.argv[1]?.includes('.test.'));

      const isHumanCliHook = event === 'pre-commit' || event === 'mark-recovery';

      if (!process.stdin.isTTY && !isTestProcess && !payload) {
        return readStdinTextWithTimeout().then((stdinData) => {
          const result = runHook(event, {
            workspaceRoot,
            payload,
            harness,
            dryRun,
            stdinData: stdinData || undefined,
            ...(isHumanCliHook ? cliTermOpts : {}),
          });
          if (result.output) {
            console.log(
              isHumanCliHook ? formatTerminalOutput(result.output, cliTermOpts) : result.output
            );
          }
          if (result.exitCode !== 0) {
            return handleExit(result.exitCode);
          }
        }).catch((err) => {
          console.error(err);
          return handleExit(1);
        });
      }

      const result = runHook(event, {
        workspaceRoot,
        payload,
        harness,
        dryRun,
        ...(isHumanCliHook ? cliTermOpts : {}),
      });
      if (result.output) {
        console.log(
          isHumanCliHook ? formatTerminalOutput(result.output, cliTermOpts) : result.output
        );
      }
      if (result.exitCode !== 0) {
        return handleExit(result.exitCode);
      }
      break;
    }

    case 'doctor': {
      const storage = new EvoStorage(workspaceRoot);
      const fixMode = args.includes('--fix');
      const strictMode = args.includes('--strict');
      const fixSummary: string[] = [];
      if (fixMode) {
        const preHasEvo = hasValidEvoStructure(storage.evoDir);
        const preSeedInfo = checkSeedIntegrity(workspaceRoot);
        const preMcpInfo = checkMcpGatewayConfigs(workspaceRoot);
        if (preHasEvo) {
          try {
            const refreshRes = refreshMemories(workspaceRoot);
            if (refreshRes.refreshed.length > 0) {
              fixSummary.push(`Refreshed ${refreshRes.refreshed.length} stale/drifted memory(s)`);
            }
          } catch {}
        }
        const seedDriftCandidates = Array.from(
          new Set([...preSeedInfo.valid, '.cursor/rules/evo-kernel.mdc'])
        );
        let hasPreSeedDrift = false;
        for (const vf of seedDriftCandidates) {
          const seedAbs = path.join(workspaceRoot, vf);
          if (!fs.existsSync(seedAbs)) continue;
          try {
            const rawSeed = fs.readFileSync(seedAbs, 'utf8');
            if (vf === '.cursor/rules/evo-kernel.mdc' && !rawSeed.includes('<!-- EVO:START -->')) {
              continue;
            }
            if (
              rawSeed.includes('EvoKernel 演进回执') ||
              !rawSeed.includes('EvoKernel Recall:') ||
              rawSeed.includes('evo_inspect(id, tier: "L2")')
            ) {
              hasPreSeedDrift = true;
              break;
            }
          } catch {}
        }
        if (
          !preHasEvo ||
          !preMcpInfo.registered ||
          preMcpInfo.staleNpxPath ||
          preSeedInfo.valid.length === 0 ||
          preSeedInfo.duplicateBlocks > 0 ||
          hasPreSeedDrift
        ) {
          try {
            const initRes = runInit(workspaceRoot, { targets: ['auto'] });
            fixSummary.push(
              `Synced workspace seeds & MCP config (${initRes.updatedFiles.join(', ') || 'up-to-date'})`
            );
          } catch {}
        }
        try {
          const globalRes = runInitGlobal({ dryRun: false });
          if (globalRes.pluginSeedsUpdated.length > 0 || globalRes.mcpTargetsUpdated.length > 0) {
            fixSummary.push(
              `Synced global hosts/plugin seeds (${[...globalRes.mcpTargetsUpdated, ...globalRes.pluginSeedsUpdated].length} updated)`
            );
          }
          if (globalRes.profileSync.updatedTargets.length > 0) {
            fixSummary.push(
              `Re-synced global profile targets (${globalRes.profileSync.updatedTargets.join(', ')})`
            );
          }
        } catch {}
        if (!args.includes('--json')) {
          const docFixTermOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
          console.log(
            formatTerminalOutput(
              fixSummary.length > 0
                ? `🔧 Doctor --fix applied:\n${fixSummary.map((s) => `  • ${s}`).join('\n')}\n`
                : '🔧 Doctor --fix: everything is already synced.\n',
              docFixTermOpts
            )
          );
        }
      }
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
      const runtimeSeedDriftCandidates = Array.from(
        new Set([...seedInfo.valid, '.cursor/rules/evo-kernel.mdc'])
      );
      for (const vf of runtimeSeedDriftCandidates) {
        const seedAbs = path.join(workspaceRoot, vf);
        if (!fs.existsSync(seedAbs)) continue;
        try {
          const rawSeed = fs.readFileSync(seedAbs, 'utf8');
          if (vf === '.cursor/rules/evo-kernel.mdc' && !rawSeed.includes('<!-- EVO:START -->')) {
            continue;
          }
          if (
            rawSeed.includes('EvoKernel 演进回执') ||
            !rawSeed.includes('EvoKernel Recall:') ||
            rawSeed.includes('evo_inspect(id, tier: "L2")')
          ) {
            versionDriftReasons.push(`${vf} L0 seed block is from an older schema`);
            break;
          }
        } catch {}
      }

      // D10 & D17: Profile health & installed plugin L0 seed drift checks
      const globalProfileStorage = new EvoStorage(globalDir);
      const hasGlobalProfileEvo = hasValidEvoStructure(globalProfileStorage.evoDir);
      const globalProfileCfg = hasGlobalProfileEvo
        ? globalProfileStorage.getConfig()
        : { ...DEFAULT_EVO_CONFIG };
      const maxProfileTokens = globalProfileCfg.maxGlobalProfileTokens ?? 800;
      const maxMenuTokens = globalProfileCfg.maxDirectoryMenuTokens ?? 250;
      const { totalTokens: profileTokens } = hasGlobalProfileEvo
        ? globalProfileStorage.getProfileTokenUsage()
        : { totalTokens: 0 };
      const profileDirectoryMenu = hasGlobalProfileEvo
        ? globalProfileStorage.formatTaskDirectoryMenu(maxMenuTokens)
        : '';
      const menuTokens = estimateTokens(profileDirectoryMenu);
      const profileDigest = hasGlobalProfileEvo
        ? globalProfileStorage.formatUserProfileDigest()
        : '';
      const rawExpectedProfileBlock = renderUserProfileBlock(profileDigest, profileDirectoryMenu);
      const profileHostTargets = discoverGlobalProfileTargets(globalDir);
      const syncedProfileTargets: string[] = [];
      const driftedProfileTargets: string[] = [];
      if (rawExpectedProfileBlock.trim()) {
        const normProfile = (s: string) => s.replace(/\r\n/g, '\n').trim();
        for (const tDesc of profileHostTargets) {
          const tPath = tDesc.path;
          let rawT = '';
          let existingBlock = '';
          if (fs.existsSync(tPath)) {
            try {
              rawT = fs.readFileSync(tPath, 'utf8');
              const sIdx = rawT.indexOf(PROFILE_MARKER_START);
              const eIdx = rawT.indexOf(PROFILE_MARKER_END);
              if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx) {
                existingBlock = rawT.slice(sIdx, eIdx + PROFILE_MARKER_END.length);
              }
            } catch {}
          }
          const effectiveExpected = computeEffectiveProfileBlockForTarget(
            tDesc,
            rawExpectedProfileBlock,
            rawT
          );
          if (!effectiveExpected) continue;
          if (normProfile(existingBlock) === normProfile(effectiveExpected)) {
            syncedProfileTargets.push(tPath);
          } else {
            driftedProfileTargets.push(tPath);
          }
        }
      }

      const stalePluginSeeds: string[] = [];
      const currentHome = os.homedir();
      const pluginSeedCandidates = [
        path.join(currentHome, '.gemini', 'config', 'plugins', 'evo-kernel', 'rules', 'AGENTS.md'),
        path.join(currentHome, '.claude', 'plugins', 'evo-kernel', 'rules', 'AGENTS.md'),
        path.join(currentHome, '.gemini', 'extensions', 'evo-kernel', 'templates', 'GEMINI.extension.md'),
        path.join(currentHome, '.gemini', 'extensions', 'evo-kernel', 'GEMINI.md'),
      ];
      for (const pSeed of pluginSeedCandidates) {
        if (!fs.existsSync(pSeed)) continue;
        try {
          const content = fs.readFileSync(pSeed, 'utf8');
          const isStale =
            content.includes('EvoKernel 演进回执') ||
            !content.includes('EvoKernel Recall:') ||
            !content.includes('scope: "global"') ||
            content.includes('evo_inspect(id, tier: "L2")');
          if (isStale) {
            stalePluginSeeds.push(pSeed);
            const relSeed = path.relative(currentHome, pSeed).replace(/\\/g, '/');
            versionDriftReasons.push(`Installed plugin L0 seed is stale (< v0.5): ~/${relSeed}`);
          }
        } catch {}
      }

      const hasVersionDrift = versionDriftReasons.length > 0;
      const versionDriftFixCommand =
        stalePluginSeeds.length > 0
          ? versionDriftReasons.length > stalePluginSeeds.length
            ? `${cliPrefix} init --all`
            : `${cliPrefix} init --global`
          : `${cliPrefix} init`;
      const duplicateRootSeeds =
        seedInfo.valid.includes('AGENTS.md') && seedInfo.valid.includes('GEMINI.md');
      const cursorRulePath = path.join(workspaceRoot, '.cursor', 'rules', 'evo-kernel.mdc');
      const hasValidCursorSeed =
        fs.existsSync(cursorRulePath) &&
        fs.readFileSync(cursorRulePath, 'utf8').includes('<!-- EVO:START -->');
      const isDoctorHealthy =
        hasEvo &&
        mcpRegistered &&
        !staleNpxPath &&
        staleMems === 0 &&
        (!probeResult.attempted || probeResult.reachable) &&
        !hasVersionDrift &&
        (seedInfo.valid.length > 0 || hasValidCursorSeed) &&
        seedInfo.duplicateBlocks === 0 &&
        !duplicateRootSeeds;

      if (args.includes('--json')) {
        const doctorJson: Record<string, unknown> = {
          ok: strictMode ? isDoctorHealthy : true,
          healthy: isDoctorHealthy,
          ...(fixMode ? { fixSummary } : {}),
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
            stalePluginSeeds,
          },
          profile: {
            globalRoot: globalDir,
            initialized: hasGlobalProfileEvo,
            profileTokens,
            maxProfileTokens,
            menuTokens,
            maxMenuTokens,
            overBudget: profileTokens > maxProfileTokens || menuTokens > maxMenuTokens,
            syncedTargets: syncedProfileTargets,
            driftedTargets: driftedProfileTargets,
          },
          versionDrift: {
            drifted: hasVersionDrift,
            reasons: versionDriftReasons,
            fixCommand: versionDriftFixCommand,
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
        if (strictMode && !isDoctorHealthy) {
          handleExit(1);
          return;
        }
        break;
      }

      const doctorTermOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
      const logDoctor = (line: string) => console.log(formatTerminalOutput(line, doctorTermOpts));

      const hasWorkspaceSeedIssue =
        seedInfo.duplicateBlocks > 0 ||
        duplicateRootSeeds ||
        versionDriftReasons.some((r) => r.includes('L0 seed block is from an older schema'));

      const nodeIcon = '[✓]';
      const sqliteIcon = ftsEnabled ? '[✓]' : '[!]';
      const memoryIcon = !hasEvo ? '[!]' : staleMems > 0 ? '[!]' : '[✓]';
      const telemetryIcon = hasEvo ? '[✓]' : '[!]';
      const storageIcon = hasEvo ? '[✓]' : '[!]';
      const seedIcon =
        seedInfo.valid.length === 0
          ? '[!]'
          : hasWorkspaceSeedIssue
            ? '[!]'
            : '[✓]';
      const mcpIcon = staleNpxPath ? '[✗]' : mcpRegistered ? '[✓]' : '[!]';
      const probeIcon = !probeResult.attempted
        ? (noProbe ? '[-]' : '[!]')
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
      const doctorTaxDisplay =
        sessionStartSavings.afterTokens > sessionStartSavings.beforeTokens
          ? `+${(sessionStartSavings.afterTokens - sessionStartSavings.beforeTokens).toLocaleString()} tok/turn (small repo baseline; drops as knowledge accumulates)`
          : `Saved ${sessionStartSavings.savingsPercent}% (${sessionStartSavings.beforeTokens.toLocaleString()} → ${sessionStartSavings.afterTokens.toLocaleString()} tok/turn)`;
      logDoctor(
        `  ├─ ${telemetryIcon} Session Tax & 7d ROI  : ${
          hasEvo
            ? `${doctorTaxDisplay} · 7d: ${window7d.searchEvents} searches, ${window7d.adoptedCount} adopted, ${window7d.helpedCount} helped · ${totalHits} all-time hits (${totalTokensSaved.toLocaleString()} tok reclaimed | Core: ${coreRuleTokens}/${maxCoreRuleTokens} tok)`
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
          `  ├─ [!] Version Sync          : Drift detected (${versionDriftReasons.join('; ')}) — fix: \`${versionDriftFixCommand}\``
        );
      }

      const mcpConfigDesc = staleNpxPath
        ? `Stale _npx path detected in ${mcpInfo.foundConfigs.join(', ') || 'MCP config'} — run \`npx -y evo-kernel init\` to repair`
        : mcpRegistered
          ? `Registered (${mcpInfo.foundConfigs.join(', ')})`
          : 'Not configured — run `npx -y evo-kernel init` to register';
      logDoctor(`  ├─ ${mcpIcon} Meta-MCP Config       : ${mcpConfigDesc}`);
      const profileIcon =
        profileTokens > maxProfileTokens || menuTokens > maxMenuTokens || driftedProfileTargets.length > 0
          ? '[!]'
          : '[✓]';
      logDoctor(
        `  ├─ ${profileIcon} Personal Profile      : Always-On ${profileTokens}/${maxProfileTokens} tok · Directory Menu ${menuTokens}/${maxMenuTokens} tok · Hosts ${syncedProfileTargets.length}/${profileHostTargets.length} synced`
      );

      const probeNeedsLocalInstall =
        Boolean(probeResult.error) && /npm install --save-dev evo-kernel/i.test(probeResult.error || '');
      let probeDesc = noProbe
        ? 'Skipped (--no-probe)'
        : !mcpRegistered
          ? 'Skipped (no MCP gateway configured)'
          : 'Skipped (uninitialized workspace — pass --probe to test global gateway)';
      if (probeResult.attempted) {
        probeDesc = probeResult.reachable
          ? `Reachable in ${probeResult.latencyMs ?? 0}ms (v${probeResult.serverVersion || 'unknown'} · ${probeResult.toolCount}/5 meta-tools verified via ${probeResult.source})`
          : probeNeedsLocalInstall
            ? `Handshake failed via ${probeResult.source} (${probeResult.error})`
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
      if (isDoctorHealthy) {
        logDoctor('  ✅ Verdict: Context OS is healthy and ready.');
      } else if (!hasEvo || !mcpRegistered) {
        logDoctor(`  ⚠️  Verdict: Run \`${cliPrefix} init\` to wire local workspace`);
      } else if (staleNpxPath) {
        logDoctor(`  ⚠️  Verdict: Stale _npx path detected in MCP config — run \`${cliPrefix} init\` to repair`);
      } else if (probeResult.attempted && !probeResult.reachable) {
        logDoctor(
          probeNeedsLocalInstall
            ? '  ⚠️  Verdict: MCP stdio handshake failed — run `npm install --save-dev evo-kernel` (or `npm install -g evo-kernel`) and reload your IDE'
            : `  ⚠️  Verdict: MCP stdio handshake failed — run \`${cliPrefix} init\` and reload your IDE`
        );
      } else if (hasVersionDrift) {
        logDoctor(`  ⚠️  Verdict: Workspace version/seed drift detected — run \`${versionDriftFixCommand}\` to sync`);
      } else if (staleMems > 0) {
        logDoctor(`  ⚠️  Verdict: ${staleMems} stale memory(s) detected — run \`${cliPrefix} memory refresh\` or \`${cliPrefix} doctor --fix\``);
      } else {
        logDoctor(`  ⚠️  Verdict: Run \`${cliPrefix} doctor --fix\` or \`${cliPrefix} init\` to verify setup`);
      }
      if (strictMode && !isDoctorHealthy) {
        handleExit(1);
        return;
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
            canonicalText: '',
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
      const unmountIde = args.includes('--unmount-ide');
      const ide = parseIdeTargetsArg(args);
      const isGlobal = args.includes('--global') || args.includes('-g');
      const dryRun = args.includes('--dry-run');
      const purge = args.includes('--purge');
      const skipConfirm = args.includes('--yes') || args.includes('-y');

      const executeUninstall = () => {
        const res = runUninstall(workspaceRoot, {
          unmountIde,
          ide,
          dryRun,
          purge,
          ...(isGlobal ? { global: true } : {}),
        });
        if (dryRun) {
          console.log(
            formatTerminalOutput(
              `🧪 Dry Run — Would clean EvoKernel markers/configs from: ${res.cleanedFiles.join(', ') || '(no files modified)'}`,
              cliTermOpts
            )
          );
          if (res.wouldPurge) {
            console.log(
              formatTerminalOutput(
                `  └─ Would purge: .evo/${isGlobal ? ' and ~/.evo/global/' : ''}`,
                cliTermOpts
              )
            );
          }
          return;
        }
        console.log(
          formatTerminalOutput(
            `🧹 Cleaned EvoKernel markers from: ${res.cleanedFiles.join(', ') || '(no files modified)'}`,
            cliTermOpts
          )
        );
        if (res.restoredMcpCount && res.restoredMcpCount > 0) {
          console.log(
            formatTerminalOutput(
              `  ├─ Restored ${res.restoredMcpCount} virtualized MCP server(s) from .evo/mcp-pool.json`,
              cliTermOpts
            )
          );
        }
        console.log(
          formatTerminalOutput(
            `  ├─ Storage: ${purge ? 'Purged (.evo/ removed)' : 'Preserved (.evo/ kept; pass --purge to delete)'}`,
            cliTermOpts
          )
        );
        console.log(
          formatTerminalOutput(
            `  └─ Re-enable anytime: ${cliPrefix} init${isGlobal ? ' --global' : ''}`,
            cliTermOpts
          )
        );
      };

      if (!dryRun && !skipConfirm && process.stdin.isTTY && process.stdout.isTTY) {
        return (async () => {
          const targetDesc = isGlobal ? 'workspace and global AI host configs' : 'workspace host configs';
          const purgeDesc = purge ? ' AND permanently delete .evo/ storage' : ' (.evo/ data will be preserved)';
          const confirmed = await confirmInteractiveAction(
            `Uninstall EvoKernel markers/MCP entries from ${targetDesc}${purgeDesc}?`
          );
          if (!confirmed) {
            console.log(formatTerminalOutput('Cancelled (no files modified).', cliTermOpts));
            return;
          }
          executeUninstall();
        })();
      }
      executeUninstall();
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
        const suggestion = suggestCommand(cmd);
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
