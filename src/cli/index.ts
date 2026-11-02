#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseInitTargets, runInit, runUninstall } from './init.js';
import { parseMaxCommitsArg, runBootstrap } from './bootstrap.js';
import { renderAuditReport, renderRefactorReport, runAudit, runRefactor } from './audit.js';
import { renderEvoStats, renderEvoTree, renderMemoryVerifyReport } from './visualizer.js';
import { parseHookEvent, parseHookHarnessArg, parseHookPayloadArg, runHook } from './hook.js';
import { renderVirtualizeReport, runVirtualize } from './virtualize.js';
import { runOptimizeCli } from './optimize.js';
import { startMcpStdioServer } from '../mcp/server.js';
import {
  EvoStorage,
  findNearestEvoWorkspace,
  isPluginOrExtensionInstallDir,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { refreshMemories, verifyMemoryFreshness } from '../core/memory.js';

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

function printHelp(): void {
  console.log(`
🧬 EvoKernel v0.2.0 — Deterministic Self-Evolving Meta-Kernel & Cognitive Memory for AI Agents

Usage:
  evo <command> [options]

Commands:
  init [--stealth] [--targets <list|auto>]
                      Detect and wire L0 Meta-Rule Seed + Single Meta-MCP
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
  doctor              Verify Node runtime, SQLite FTS5 BM25 engine, AST Memory Anti-Drift, and sandbox self-tests
  uninstall           Cleanly remove EvoKernel marker blocks and MCP entries from host configs
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
  const wsFlagIdx = args.indexOf('--workspace');
  if (wsFlagIdx !== -1 && args[wsFlagIdx + 1]) {
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
  const cmd = (args[0] || 'help').toLowerCase();
  const globalDir = resolveGlobalFallbackDir();
  if (fs.existsSync(path.join(globalDir, '.evo'))) {
    ensureGlobalFallbackSeeded(globalDir);
  }
  const isLocalMutationCmd =
    ['init', 'bootstrap', 'virtualize', 'audit', 'refactor', 'optimize', 'hook', 'uninstall'].includes(cmd) ||
    ((cmd === 'memory' || cmd === 'memories') && (args.includes('refresh') || args.includes('--refresh')));
  const workspaceRoot = resolveWorkspaceRoot(args, !isLocalMutationCmd);

  switch (cmd) {
    case 'mcp': {
      startMcpStdioServer(workspaceRoot);
      break;
    }

    case 'init': {
      const stealth = args.includes('--stealth');
      const targets = parseTargetsArg(args, workspaceRoot);
      const linkEvoFrom = parseLinkArg(args);
      const res = runInit(workspaceRoot, { stealth, targets, linkEvoFrom });
      console.log('🧬 EvoKernel initialized successfully!');
      console.log(`  ├─ Harnesses wired : ${res.initializedHarnesses.join(', ')}`);
      console.log(`  ├─ Rule seeds      : ${res.updatedFiles.join(', ')}`);
      console.log(`  ├─ MCP gateways    : ${res.mcpConfigFiles.join(', ')}`);
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
      storage.ensureInitialized();
      const telemetry = new EvoTelemetry(storage);
      telemetry.syncFromDisk();
      const ftsEnabled = telemetry.isFts5Enabled();
      telemetry.close();
      const memories = storage.listMemories();
      let verifiedMems = 0;
      let otherBranchMems = 0;
      let staleMems = 0;
      const docCacheDbPath = path.join(storage.rootDir, '.evo', '.cache', 'telemetry.db');
      let docCacheDb: any = undefined;
      if (fs.existsSync(docCacheDbPath)) {
        try {
          docCacheDb = new DatabaseSync(docCacheDbPath);
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
        `  ├─ [x] Cognitive Memory AST  : ${verifiedMems}/${memories.length} VERIFIED (${otherBranchMems} OTHER_BRANCH, ${staleMems} STALE)`
      );
      console.log(`  ├─ [x] .evo/ Storage Tree    : ${storage.evoDir}`);
      console.log(`  └─ [x] Meta-MCP Config       : ${fs.existsSync(path.join(workspaceRoot, '.mcp.json')) ? 'Registered (.mcp.json)' : 'Run `evo init` to register'}`);
      break;
    }

    case 'uninstall': {
      const res = runUninstall(workspaceRoot);
      console.log(`🧹 Cleaned EvoKernel markers from: ${res.cleanedFiles.join(', ') || '(no files modified)'}`);
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
    /(?:^|[\\/])(?:evo|evokernel|evo-kernel)(?:\.js|\.cmd)?$/i.test(process.argv[1]));

if (isDirectRun) {
  runCli(process.argv);
}
