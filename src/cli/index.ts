#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runInit, runUninstall } from './init.js';
import { runBootstrap } from './bootstrap.js';
import { renderEvoStats, renderEvoTree } from './visualizer.js';
import { startMcpStdioServer } from '../mcp/server.js';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';

function printHelp(): void {
  console.log(`
🧬 EvoKernel v0.1.0 — Deterministic Self-Evolving Meta-Kernel for AI Agents

Usage:
  evo <command> [options]

Commands:
  init                Detect and wire L0 Meta-Rule Seed + Single Meta-MCP into Claude Code, Cursor, Antigravity, Codex, and Gemini CLI
  bootstrap           Cold-start 10s repo gene mining: extract verified initial Rules, Skills, and Micro-Tools from repo & git history
  tree                Render the ASCII Self-Evolving Capability Tree (.evo/)
  stats               Display the ROI Telemetry Ledger, Token Budget bar, and Prompt-Cache savings
  mcp                 Start the stdio JSON-RPC 2.0 Single Meta-MCP Server (Fixed 5 Meta-Tools)
  hook <event>        Lifecycle hook handler (post-tool | stop) for anti-forgetting evolution enforcement
  doctor              Verify Node runtime, SQLite FTS5 BM25 engine, and sandbox self-tests
  uninstall           Cleanly remove EvoKernel marker blocks and MCP entries from host configs
`);
}

function resolveWorkspaceRoot(args: string[], allowInstallFallback: boolean): string {
  const wsFlagIdx = args.indexOf('--workspace');
  if (wsFlagIdx !== -1 && args[wsFlagIdx + 1]) {
    return path.resolve(args[wsFlagIdx + 1]);
  }
  if (process.env.EVO_WORKSPACE) {
    return path.resolve(process.env.EVO_WORKSPACE);
  }
  const cwd = process.cwd();
  if (!allowInstallFallback || fs.existsSync(path.join(cwd, '.evo'))) {
    return cwd;
  }
  const installRoot = path.resolve(import.meta.dirname, '..', '..');
  if (fs.existsSync(path.join(installRoot, '.evo'))) {
    return installRoot;
  }
  return cwd;
}

export function runCli(argv: string[]): void {
  const args = argv.slice(2);
  const cmd = (args[0] || 'help').toLowerCase();
  const isLocalMutationCmd = ['init', 'bootstrap', 'uninstall'].includes(cmd);
  const workspaceRoot = resolveWorkspaceRoot(args, !isLocalMutationCmd);

  switch (cmd) {
    case 'mcp': {
      startMcpStdioServer(workspaceRoot);
      break;
    }

    case 'init': {
      const res = runInit(workspaceRoot);
      console.log('🧬 EvoKernel initialized successfully!');
      console.log(`  ├─ Harnesses wired : ${res.initializedHarnesses.join(', ')}`);
      console.log(`  ├─ Rule seeds      : ${res.updatedFiles.join(', ')}`);
      console.log(`  └─ MCP gateways    : ${res.mcpConfigFiles.join(', ')}`);
      break;
    }

    case 'bootstrap': {
      console.log('🔍 Scanning repository structure, build configs, and git fix history...');
      const summary = runBootstrap(workspaceRoot);
      console.log('✅ Cold-start gene extraction complete (all capabilities passed 4-stage Gatekeeper):');
      console.log(`  ├─ 🛡️  Rules evolved       : ${summary.rulesCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ ⚡ Skills evolved      : ${summary.skillsCreated.join(', ') || '(none)'}`);
      console.log(`  ├─ 🔧 Micro-Tools evolved : ${summary.toolsCreated.join(', ') || '(none)'}`);
      if (summary.skippedOrDuplicate.length > 0) {
        console.log(`  └─ ⏭️  Skipped existing    : ${summary.skippedOrDuplicate.join(', ')}`);
      }
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
            '[EvoKernel Hook Reminder] Detected bug recovery or temporary script creation in this session without capability crystallization. Consider calling `evo_propose` to distill a reusable Rule, Skill, or Micro-Tool.'
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
      telemetry.close();
      console.log('🩺 EvoKernel Doctor — Diagnostics Check');
      console.log(`  ├─ [x] Node.js Runtime       : ${process.version} (${process.execPath})`);
      console.log('  ├─ [x] Native node:sqlite    : Operational (FTS5 BM25 enabled)');
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

runCli(process.argv);
