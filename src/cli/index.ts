#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseInitTargets, runInit, runUninstall } from './init.js';
import { runBootstrap } from './bootstrap.js';
import { renderAuditReport, renderRefactorReport, runAudit, runRefactor } from './audit.js';
import { renderEvoStats, renderEvoTree, renderMemoryVerifyReport } from './visualizer.js';
import { startMcpStdioServer } from '../mcp/server.js';
import {
  EvoStorage,
  findNearestEvoWorkspace,
  isPluginOrExtensionInstallDir,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { verifyMemoryFreshness } from '../core/memory.js';

function printHelp(): void {
  console.log(`
🧬 EvoKernel v0.1.0 — Deterministic Self-Evolving Meta-Kernel & Cognitive Memory for AI Agents

Usage:
  evo <command> [options]

Commands:
  init [--stealth] [--targets <list|auto>]
                      Detect and wire L0 Meta-Rule Seed + Single Meta-MCP
                      (--stealth uses .git/info/exclude; --targets filters claude,agents,gemini,cursor or auto)
  bootstrap           Cold-start 10s repo gene mining: extract verified initial Rules, Skills, Micro-Tools, and Episodic Memories
  memory [verify]     Audit AST structural fingerprints and live topology anchors across all Episodic Memories (.evo/memories/)
  audit [--global]    Scan workspace & global (~/.gemini, ~/.claude, ~/.cursor) rules/skills for domain leaks, overlap, and budget bloat
  refactor [--apply]  Launch 4-stage Rule & Skill decoupling workflow via built-in evo-rule-architect meta-skill
  tree                Render the ASCII Self-Evolving Capability & Cognitive Memory Tree (.evo/)
  stats               Display the ROI Telemetry Ledger, Token Budget bar, Memory Freshness, and Prompt-Cache savings
  mcp                 Start the stdio JSON-RPC 2.0 Single Meta-MCP Server (Fixed 5 Meta-Tools)
  hook <event>        Lifecycle hook handler (post-tool | stop) for anti-forgetting evolution enforcement
  doctor              Verify Node runtime, SQLite FTS5 BM25 engine, AST Memory Anti-Drift, and sandbox self-tests
  uninstall           Cleanly remove EvoKernel marker blocks and MCP entries from host configs
`);
}

function copyDirNonOverwriting(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.cache' || entry.name === 'archive' || entry.name === 'scoped') continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirNonOverwriting(srcPath, destPath);
    } else if (entry.isFile() && !fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
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
  const seedEvoDir = fs.existsSync(templateSeedDir)
    ? templateSeedDir
    : path.join(installRoot, '.evo');

  if (fs.existsSync(seedEvoDir) && path.resolve(seedEvoDir) !== path.resolve(storage.evoDir)) {
    for (const sub of ['rules', 'skills', 'tools']) {
      copyDirNonOverwriting(path.join(seedEvoDir, sub), path.join(storage.evoDir, sub));
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

export function runCli(argv: string[]): void {
  const args = argv.slice(2);
  const cmd = (args[0] || 'help').toLowerCase();
  const isLocalMutationCmd = ['init', 'bootstrap', 'audit', 'refactor', 'uninstall'].includes(cmd);
  const workspaceRoot = resolveWorkspaceRoot(args, !isLocalMutationCmd);

  switch (cmd) {
    case 'mcp': {
      startMcpStdioServer(workspaceRoot);
      break;
    }

    case 'init': {
      const stealth = args.includes('--stealth');
      const targets = parseTargetsArg(args, workspaceRoot);
      const res = runInit(workspaceRoot, { stealth, targets });
      console.log('🧬 EvoKernel initialized successfully!');
      console.log(`  ├─ Harnesses wired : ${res.initializedHarnesses.join(', ')}`);
      console.log(`  ├─ Rule seeds      : ${res.updatedFiles.join(', ')}`);
      console.log(`  ├─ MCP gateways    : ${res.mcpConfigFiles.join(', ')}`);
      console.log(
        `  └─ Git Exclude     : ${
          stealth
            ? `Stealth mode active (.git/info/exclude -> ${res.stealthExcluded?.join(', ') || 'already excluded'})`
            : 'Standard mode (.evo/.cache/ excluded locally)'
        }`
      );
      break;
    }

    case 'bootstrap': {
      console.log('🔍 Scanning repository structure, build configs, and git fix history...');
      const summary = runBootstrap(workspaceRoot);
      console.log('✅ Cold-start gene extraction complete (all capabilities passed 4-stage Gatekeeper):');
      console.log(`  ├─ 🛡️  Rules evolved       : ${summary.rulesCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ ⚡ Skills evolved      : ${summary.skillsCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ 🔧 Micro-Tools evolved : ${summary.toolsCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ 🧠 Memories evolved    : ${summary.memoriesCreated.join(', ') || '(none)'}`);
      if (summary.skippedOrDuplicate.length > 0) {
        console.log(`  └─ ⏭️  Skipped existing    : ${summary.skippedOrDuplicate.join(', ')}`);
      }
      break;
    }

    case 'memory':
    case 'memories': {
      console.log(renderMemoryVerifyReport(workspaceRoot));
      break;
    }

    case 'audit': {
      const includeGlobal = args.includes('--global') || args.includes('-g');
      const report = runAudit(workspaceRoot, { includeGlobal });
      console.log(renderAuditReport(report));
      break;
    }

    case 'refactor': {
      const includeGlobal = !args.includes('--local-only');
      const apply = args.includes('--apply');
      const result = runRefactor(workspaceRoot, { includeGlobal, apply });
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
      const event = (args[1] || 'stop').toLowerCase();
      const storage = new EvoStorage(workspaceRoot);
      const telemetry = new EvoTelemetry(storage);
      if (event === 'mark-recovery' || event === 'post-tool') {
        telemetry.setSessionFlag('pending_evolution', 'true');
      } else if (event === 'stop') {
        const pending = telemetry.getSessionFlag('pending_evolution');
        if (pending === 'true') {
          console.log(
            '[EvoKernel Hook Reminder] Detected bug recovery or temporary script creation in this session without capability crystallization. Consider calling `evo_propose` to distill a reusable Memory, Rule, Skill, or Micro-Tool.'
          );
        }
      }
      telemetry.close();
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
      const verifiedMems = memories.filter(
        (m) => verifyMemoryFreshness(storage.rootDir, m, { includeCallers: false }).overall_status === 'VERIFIED'
      ).length;
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
        `  ├─ [x] Cognitive Memory AST  : ${verifiedMems}/${memories.length} VERIFIED (${memories.length - verifiedMems} STALE)`
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

if (!process.env.NODE_TEST_CONTEXT && !process.argv[1]?.endsWith('.test.js')) {
  runCli(process.argv);
}
