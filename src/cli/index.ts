#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findGitRoot, parseInitTargets, runInit, runUninstall } from './init.js';
import { parseMaxCommitsArg, runBootstrap } from './bootstrap.js';
import { renderAuditReport, renderRefactorReport, runAudit, runRefactor } from './audit.js';
import { renderEvoStats, renderEvoTree, renderMemoryVerifyReport } from './visualizer.js';
import { parseHookEvent, parseHookHarnessArg, parseHookPayloadArg, runHook } from './hook.js';
import { renderVirtualizeReport, runVirtualize } from './virtualize.js';
import { runOptimizeCli } from './optimize.js';
import { runScoreCli } from './score.js';
import { runUiCli } from './ui.js';
import { startMcpStdioServer } from '../mcp/server.js';
import {
  EvoStorage,
  findNearestEvoWorkspace,
  hasValidEvoStructure,
  isPluginOrExtensionInstallDir,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { refreshMemories, verifyMemoryFreshness } from '../core/memory.js';
import { inspectDeliverableFile } from '../core/deliverable.js';

export function printHookHelp(): void {
  console.log(`
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
`);
}

export function printOptimizeHelp(): void {
  console.log(`
Usage:
  evo optimize [options]

Offline Git worktree optimization cycle for autonomous capability evolution.

Options:
  --dim <inv|dom|both>      Target dimension: invariant, domain, or both (default: both)
  -k, --rounds <N>          Maximum optimization rounds (default: 3)
  --proposer-cmd <cmd>      Command to propose candidate rule/memory modifications
  --probe-cmd <cmd>         Verification probe command to validate candidate worktrees
  --trajectory <file>       Path to session transcript or trajectory JSONL file
  --deliverable <file>      Target deliverable file for canonical defect inspection
  --apply                   Automatically commit winning candidates to workspace
  --json                    Output optimization summary in JSON format
  --workspace <path>        Target workspace directory (default: current directory)
  -h, --help                Show this help message
`);
}

export function printScoreHelp(): void {
  console.log(`
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
`);
}

export function printUiHelp(): void {
  console.log(`
Usage:
  evo ui [options]

Zero-dependency local cockpit UI for telemetry X-ray, budget treemap, and memory constellation.

Options:
  --port <N>           Port to bind local cockpit UI server (default: 4310)
  --open               Automatically open browser after startup
  --token <str>        Pre-shared security token for UI authentication
  --export <path>      Export complete static HTML snapshot without starting server
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printInitHelp(): void {
  console.log(`
Usage:
  evo init [options]

Detect and wire L0 Meta-Rule Seed + Single Meta-MCP + Slash Commands into project and agent harnesses.

Options:
  --stealth            Add .evo/ and config files to .git/info/exclude (clean git status)
  --targets <list>     Harness targets: claude, agents, gemini, cursor, or auto (default: auto)
  --link <path>        Link .evo capability tree from another repository or central storage
  --no-warmup          Skip background capability warmup and AST pre-indexing
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printUninstallHelp(): void {
  console.log(`
Usage:
  evo uninstall [options]

Cleanly remove EvoKernel marker blocks, rules, and MCP registrations from host configs.

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printBootstrapHelp(): void {
  console.log(`
Usage:
  evo bootstrap [options]

Cold-start repo gene mining: extract verified initial Rules, Skills, Micro-Tools, and Episodic Memories.

Options:
  --max-commits <N>    Maximum recent commits to inspect (default: 50, clamp: 1-500)
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printVirtualizeHelp(): void {
  console.log(`
Usage:
  evo virtualize [options]

One-click fold third-party stdio MCPs from host configs into .evo/mcp-pool.json (0 schema bloat).

Options:
  --dry-run            Simulate virtualization without writing files
  --restore            Restore folded MCP servers back to host configs
  --global             Scan and virtualize global host configs (~/.claude, ~/.gemini, etc.)
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printMemoryHelp(): void {
  console.log(`
Usage:
  evo memory [verify|refresh] [options]

Audit AST structural fingerprints and live topology anchors across all Episodic Memories (.evo/memories/).

Subcommands:
  verify               Verify memory freshness against working tree AST (default)
  refresh              Re-anchor drifted AST fingerprints to current commit/branch

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printAuditHelp(): void {
  console.log(`
Usage:
  evo audit [options]

Scan workspace and global rules/skills for domain leaks, overlap, and token budget bloat.

Options:
  --global, -g         Include user-level global rules (~/.gemini, ~/.claude, ~/.cursor)
  --token-budget <N>   Override per-file token budget limit (default: 1500)
  --skill-budget <N>   Override per-skill token budget limit (default: 1000)
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printRefactorHelp(): void {
  console.log(`
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
`);
}

export function printCheckHelp(): void {
  console.log(`
Usage:
  evo check <file> [options]
  evo inspect <file> [options]

Canonical defect inspection and format verification for deliverable artifacts (.xlsx, .docx, .pptx, .csv, .json, .md).

Options:
  --json               Output inspection results as structured JSON
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printTreeHelp(): void {
  console.log(`
Usage:
  evo tree [options]

Render the ASCII Self-Evolving Capability & Cognitive Memory Tree (.evo/).

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printStatsHelp(): void {
  console.log(`
Usage:
  evo stats [options]

Display the ROI Telemetry Ledger, Token Budget bar, Memory Freshness, and Prompt-Cache savings.

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printDoctorHelp(): void {
  console.log(`
Usage:
  evo doctor [options]

Verify Node runtime, SQLite FTS5 BM25 engine, AST Memory Anti-Drift, and sandbox self-tests.

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
}

export function printMcpHelp(): void {
  console.log(`
Usage:
  evo mcp [options]

Start the stdio JSON-RPC 2.0 Single Meta-MCP Server (Fixed 5 Meta-Tools).

Options:
  --workspace <path>   Target workspace directory (default: current directory)
  -h, --help           Show this help message
`);
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

export const EVO_KERNEL_VERSION = '0.3.0';

export function checkNodeRuntimeVersion(versionStr: string = process.versions.node || '0.0.0'): {
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
  return {
    ok: false,
    major,
    minor,
    message:
      `❌ EvoKernel requires Node.js >= 22.5.0 (detected v${versionStr}).\n` +
      `   Why: EvoKernel runs with 0 external dependencies using native node:sqlite and node:module.\n` +
      `   Instant 1-liner (no global Node change): npx -y -p node@22 evo-kernel <command>\n` +
      `   Fix: switch Node runtime via:\n` +
      `     • nvm install 22 && nvm use 22\n` +
      `     • fnm use 22\n` +
      `     • volta install node@22`,
  };
}

function printHelp(): void {
  console.log(`
🧬 EvoKernel v${EVO_KERNEL_VERSION} — Deterministic Self-Evolving Meta-Kernel & Cognitive Memory for AI Agents

Usage:
  evo <command> [options]

Commands:
  score [--json] [--badge] [--svg <path>] [--html <path>] [--workspace <path>]
                      Instant 0-overhead diagnostic scoring for agent host tax, git bug hotspots, and memory coverage
  ui [--port <N>] [--open] [--token <str>] [--export <path>] [--workspace <path>]
                      Zero-dependency local cockpit UI for telemetry X-ray, budget treemap, and memory constellation
  init [--stealth] [--targets <list|auto>] [--no-warmup]
                      Detect and wire L0 Meta-Rule Seed + Single Meta-MCP + Slash Commands
                      (--stealth uses .git/info/exclude; --targets filters claude,agents,gemini,cursor or auto)
  bootstrap [--max-commits <N>]
                      Cold-start repo gene mining: extract verified initial Rules, Skills, Micro-Tools, and Episodic Memories (default: 50, up to 500)
  virtualize [--dry-run] [--restore] [--global]
                      One-click fold third-party stdio MCPs from host configs into .evo/mcp-pool.json (0 schema bloat)
  memory [verify|refresh] Audit AST structural fingerprints and live topology anchors across all Episodic Memories (.evo/memories/)
  audit [--global] [--token-budget <N>] [--skill-budget <N>]    Scan workspace & global (~/.gemini, ~/.claude, ~/.cursor) rules/skills for domain leaks, overlap, and budget bloat
  refactor [--apply] [--token-budget <N>] [--skill-budget <N>]  Launch 4-stage Rule & Skill decoupling workflow via built-in evo-rule-architect meta-skill
  tree                Render the ASCII Self-Evolving Capability & Cognitive Memory Tree (.evo/)
  stats               Display the ROI Telemetry Ledger, Token Budget bar, Memory Freshness, and Prompt-Cache savings
  mcp                 Start the stdio JSON-RPC 2.0 Single Meta-MCP Server (Fixed 5 Meta-Tools)
  hook <event> [--event <name>]
                      Universal lifecycle hook router (pre-tool | post-tool | stop | pre-commit) for anti-forgetting evolution enforcement and git pre-commit audit
  optimize [--dim inv|dom|both] [-k <N>] [--proposer-cmd <cmd>] [--probe-cmd <cmd>] [--apply]
                      Offline Git worktree optimization cycle (trajectories & deliverables -> proposals -> isolated probe)
  check <file> [--json] [--workspace <path>]
                      Canonical defect inspection & format verification for deliverables (.xlsx, .docx, .pptx, .csv, .json, .md) (alias: inspect)
  doctor              Verify Node runtime, SQLite FTS5 BM25 engine, AST Memory Anti-Drift, and sandbox self-tests
  uninstall           Cleanly remove EvoKernel marker blocks and MCP entries from host configs
  version, --version  Print EvoKernel CLI version
`);
}

function copyDirNonOverwriting(
  srcDir: string,
  destDir: string,
  syncUpdatedSeeds: boolean = false
): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (
      entry.name === '.cache' ||
      entry.name === 'archive' ||
      entry.name === 'scoped' ||
      entry.name === 'core-invariants.md'
    ) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirNonOverwriting(srcPath, destPath, syncUpdatedSeeds);
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
        hasTemplateSeed
      );
    }
    storage.rebuildCoreInvariantsDigest();
  }

  return globalRoot;
}

export function resolveWorkspaceRoot(
  args: string[],
  allowGlobalFallback: boolean,
  cwdOverride?: string
): string {
  const wsEq = args.find((a) => a.startsWith('--workspace='));
  if (wsEq) {
    const explicit = path.resolve(wsEq.slice('--workspace='.length));
    return findNearestEvoWorkspace(explicit) || explicit;
  }
  const wsFlagIdx = args.indexOf('--workspace') !== -1 ? args.indexOf('--workspace') : args.indexOf('-w');
  if (wsFlagIdx !== -1 && args[wsFlagIdx + 1] && !args[wsFlagIdx + 1].startsWith('-')) {
    const explicit = path.resolve(args[wsFlagIdx + 1]);
    return findNearestEvoWorkspace(explicit) || explicit;
  }
  if (process.env.EVO_WORKSPACE) {
    const envWs = path.resolve(process.env.EVO_WORKSPACE);
    return findNearestEvoWorkspace(envWs) || envWs;
  }
  const cwd = path.resolve(cwdOverride || process.cwd());
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

export function runCli(argv: string[]): void {
  const args = argv.slice(2);
  let cmd = (args[0] || '').toLowerCase();
  if (!cmd && process.stdout.isTTY && !process.env.CI) {
    cmd = 'score';
  } else if (!cmd) {
    cmd = 'help';
  }

  // Early version interception: ZERO side-effects (no file reads/writes, no global seed, exit code 0)
  if (
    cmd === 'version' ||
    cmd === '--version' ||
    cmd === '-v' ||
    args.includes('--version') ||
    (args.length === 1 && args[0] === '-v')
  ) {
    console.log(EVO_KERNEL_VERSION);
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
    if (cmd === 'help') {
      targetSubcmd = (args[1] || '').toLowerCase();
    } else if (cmd === '--help' || cmd === '-h') {
      targetSubcmd = '';
    }

    switch (targetSubcmd) {
      case 'hook':
        printHookHelp();
        return;
      case 'optimize':
        printOptimizeHelp();
        return;
      case 'score':
        printScoreHelp();
        return;
      case 'ui':
        printUiHelp();
        return;
      case 'init':
        printInitHelp();
        return;
      case 'uninstall':
        printUninstallHelp();
        return;
      case 'bootstrap':
        printBootstrapHelp();
        return;
      case 'virtualize':
        printVirtualizeHelp();
        return;
      case 'memory':
      case 'memories':
        printMemoryHelp();
        return;
      case 'audit':
        printAuditHelp();
        return;
      case 'refactor':
        printRefactorHelp();
        return;
      case 'check':
      case 'inspect':
        printCheckHelp();
        return;
      case 'tree':
        printTreeHelp();
        return;
      case 'stats':
        printStatsHelp();
        return;
      case 'doctor':
        printDoctorHelp();
        return;
      case 'mcp':
        printMcpHelp();
        return;
      default:
        printHelp();
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
    const target = wsVal
      ? path.resolve(wsVal)
      : process.env.EVO_WORKSPACE
      ? path.resolve(process.env.EVO_WORKSPACE)
      : path.resolve(process.cwd());
    workspaceRoot = findNearestEvoWorkspace(target) || findGitRoot(target) || target;
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
      const noWarmup = args.includes('--no-warmup');
      const res = runInit(workspaceRoot, { stealth, targets, linkEvoFrom, warmup: !noWarmup });
      console.log('🧬 EvoKernel initialized successfully!');
      console.log(`  ├─ Harnesses wired : ${res.initializedHarnesses.join(', ')}`);
      console.log(`  ├─ Rule seeds      : ${res.updatedFiles.join(', ')}`);
      console.log(`  ├─ MCP gateways    : ${res.mcpConfigFiles.join(', ')}`);
      if (res.commandFiles && res.commandFiles.length > 0) {
        console.log(`  ├─ Slash commands  : ${res.commandFiles.join(', ')}`);
      }
      if (res.linkedSharedEvoDir) {
        console.log(`  ├─ Shared .evo     : ${res.linkedSharedEvoDir}`);
      }
      console.log(
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
        console.log('⚡ Warmup & Cold-Start Gene Extraction:');
        if (boot?.detectedStacks && boot.detectedStacks.length > 0) {
          console.log(`  ├─ Detected Stacks : ${boot.detectedStacks.join(', ')}`);
        }
        const totalEvolved =
          (boot?.rulesCreated?.length || 0) +
          (boot?.skillsCreated?.length || 0) +
          (boot?.toolsCreated?.length || 0) +
          (boot?.memoriesCreated?.length || 0);
        console.log(
          `  ├─ Capabilities    : ${totalEvolved} evolved (${boot?.rulesCreated?.length || 0} rules, ${boot?.memoriesCreated?.length || 0} memories)`
        );
        if (score?.mcpTax?.activeServers > 0) {
          console.log(
            `  └─ MCP Tax         : ${score.mcpTax.activeServers} active server(s) (~${score.mcpTax.activeTaxTokens} tok) ready for \`evo virtualize\``
          );
        } else {
          console.log(`  └─ Context Health  : Grade ${score?.grade || 'A'} (${score?.overallScore || 100}/100)`);
        }
      }
      break;
    }

    case 'bootstrap': {
      const maxCommits = parseMaxCommitsArg(args);
      console.log(`🔍 Scanning repository structure, build configs, and git fix history (maxCommits: ${maxCommits})...`);
      const summary = runBootstrap(workspaceRoot, { maxCommits });
      console.log('✅ Cold-start gene extraction complete (all capabilities passed 4-stage Gatekeeper):');
      if (summary.detectedStacks && summary.detectedStacks.length > 0) {
        console.log(`  ├─ 📦 Detected Stacks     : ${summary.detectedStacks.join(', ')}`);
      }
      console.log(`  ├─ 🛡️  Rules evolved       : ${summary.rulesCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ ⚡ Skills evolved      : ${summary.skillsCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ 🔧 Micro-Tools evolved : ${summary.toolsCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ 🧠 Memories evolved    : ${summary.memoriesCreated.join(', ') || '(none)'}`);
      if (summary.skippedOrDuplicate.length > 0) {
        console.log(`  └─ ⏭️  Skipped existing    : ${summary.skippedOrDuplicate.join(', ')}`);
      }
      break;
    }

    case 'virtualize': {
      const dryRun = args.includes('--dry-run');
      const restore = args.includes('--restore');
      const includeGlobal = args.includes('--global') || args.includes('-g');
      const result = runVirtualize(workspaceRoot, { dryRun, restore, includeGlobal });
      console.log(renderVirtualizeReport(result));
      break;
    }

    case 'memory':
    case 'memories': {
      if (args[1] === 'refresh' || args.includes('--refresh')) {
        const targetIds = args.slice(1).filter((a) => !a.startsWith('-') && a !== 'refresh');
        refreshMemories(workspaceRoot, targetIds.length > 0 ? targetIds : undefined);
      }
      console.log(renderMemoryVerifyReport(workspaceRoot));
      break;
    }

    case 'audit': {
      const includeGlobal = args.includes('--global') || args.includes('-g');
      const report = runAudit(workspaceRoot, { includeGlobal, tokenBudgetLimit: parsePositiveIntFlag(args, '--token-budget'), skillBudgetLimit: parsePositiveIntFlag(args, '--skill-budget') });
      console.log(renderAuditReport(report));
      if (!report.healthy) {
        process.exit(1);
      }
      break;
    }

    case 'refactor': {
      const includeGlobal = !args.includes('--local-only');
      const apply = args.includes('--apply');
      const result = runRefactor(workspaceRoot, { includeGlobal, apply, tokenBudgetLimit: parsePositiveIntFlag(args, '--token-budget'), skillBudgetLimit: parsePositiveIntFlag(args, '--skill-budget') });
      console.log(renderRefactorReport(result));
      break;
    }

    case 'tree': {
      console.log(renderEvoTree(workspaceRoot));
      break;
    }

    case 'stats': {
      console.log(renderEvoStats(workspaceRoot));
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
        printHookHelp();
        break;
      }
      const event = parseHookEvent(args);
      const payload = parseHookPayloadArg(args);
      const harness = parseHookHarnessArg(args);

      const isTestProcess = Boolean(process.argv[1]?.includes('.test.'));

      if (!process.stdin.isTTY && !isTestProcess && !payload) {
        return readStdinTextWithTimeout().then((stdinData) => {
          const result = runHook(event, {
            workspaceRoot,
            payload,
            harness,
            stdinData: stdinData || undefined,
          });
          if (result.output) {
            console.log(result.output);
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
      });
      if (result.output) {
        console.log(result.output);
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
        printOptimizeHelp();
        break;
      }
      runOptimizeCli(args, workspaceRoot);
      break;
    }

    case 'doctor': {
      const storage = new EvoStorage(workspaceRoot);
      const hasEvo = hasValidEvoStructure(storage.evoDir);
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

      if (hasEvo) {
        const memories = storage.listMemories();
        totalMemories = memories.length;
        let docCacheDb: DatabaseSync | undefined = undefined;
        if (fs.existsSync(storage.telemetryDbPath)) {
          try {
            docCacheDb = new DatabaseSync(storage.telemetryDbPath, { readOnly: true });
          } catch {}
        }
        try {
          for (const m of memories) {
            const status = verifyMemoryFreshness(storage.rootDir, m, { includeCallers: false, cacheDb: docCacheDb }).overall_status;
            if (status === 'VERIFIED') verifiedMems++;
            else if (status === 'OTHER_BRANCH') otherBranchMems++;
            else staleMems++;
          }
        } finally {
          if (docCacheDb) {
            try { docCacheDb.close(); } catch {}
          }
        }
      }

      console.log('🩺 EvoKernel Doctor — Diagnostics Check');
      console.log(`  ├─ [x] Node.js Runtime       : ${process.version} (${process.execPath})`);
      console.log(
        `  ├─ [x] Native node:sqlite    : ${
          ftsEnabled
            ? 'Operational (FTS5 BM25 enabled)'
            : 'Operational (JS BM25 Fallback active — upgrade to Node >=22.16 / 22.23+ or 24+ for native FTS5)'
        }`
      );
      console.log(
        `  ├─ [x] Cognitive Memory AST  : ${
          hasEvo
            ? `${verifiedMems}/${totalMemories} VERIFIED (${otherBranchMems} OTHER_BRANCH, ${staleMems} STALE)`
            : 'Not initialized (run `evo init` to activate)'
        }`
      );
      console.log(`  ├─ [x] .evo/ Storage Tree    : ${hasEvo ? storage.evoDir : 'Not present'}`);
      console.log(`  └─ [x] Meta-MCP Config       : ${fs.existsSync(path.join(workspaceRoot, '.mcp.json')) ? 'Registered (.mcp.json)' : 'Run `evo init` to register'}`);
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
        console.error('❌ Error: Missing target deliverable file path.\n   Usage: evo check <file> [--json]');
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

      const result = inspectDeliverableFile(targetPath);
      const passed = result.ok && result.defects.filter((d) => d.severity === 'error').length === 0;

      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const relTarget = path.relative(workspaceRoot, targetPath).replace(/\\/g, '/') || fileArg;
        console.log(`🔍 Deliverable Canonical Inspection: ${relTarget}`);
        console.log(`  ├─ Format  : ${result.format.toUpperCase()}`);
        console.log(`  ├─ Status  : ${passed ? '✅ PASSED' : '❌ FAILED'}`);
        const statEntries = Object.entries(result.stats || {});
        if (statEntries.length > 0) {
          const statsStr = statEntries.map(([k, v]) => `${k}=${v}`).join(', ');
          console.log(`  ├─ Metrics : ${statsStr}`);
        }
        if (result.defects.length === 0) {
          console.log(`  └─ Defects : None (0)`);
        } else {
          console.log(`  └─ Defects (${result.defects.length}) :`);
          for (let i = 0; i < result.defects.length; i++) {
            const d = result.defects[i];
            const isLast = i === result.defects.length - 1;
            const branch = isLast ? '     └─' : '     ├─';
            const sevBadge = d.severity === 'error' ? '[ERROR]' : '[WARN]';
            console.log(`${branch} ${sevBadge} ${d.code} @ ${d.location}: ${d.message}`);
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
      console.log(`🧹 Cleaned EvoKernel markers from: ${res.cleanedFiles.join(', ') || '(no files modified)'}`);
      break;
    }

    case 'version':
    case '--version':
    case '-v': {
      console.log(EVO_KERNEL_VERSION);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
      break;
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
