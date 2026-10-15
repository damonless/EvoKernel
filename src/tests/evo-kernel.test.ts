import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvoMcpDispatcher, META_MCP_TOOLS } from '../mcp/handlers.js';
import { findGitRoot, runInit, runUninstall } from '../cli/init.js';
import { runBootstrap } from '../cli/bootstrap.js';
import { renderEvoStats, renderEvoTree } from '../cli/visualizer.js';
import {
  ensureGlobalFallbackSeeded,
  parseTargetsArg,
  resolveWorkspaceRoot,
} from '../cli/index.js';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evo-test-ws-'));
}

describe('EvoKernel Deterministic Self-Evolution Suite', () => {
  test('1. Meta-MCP exposes exactly 5 fixed tools to preserve Prompt Cache', () => {
    assert.equal(META_MCP_TOOLS.length, 5);
    const names = META_MCP_TOOLS.map((t) => t.name);
    assert.deepEqual(names, [
      'evo_search',
      'evo_inspect',
      'evo_run',
      'evo_propose',
      'evo_compact',
    ]);
  });

  test('2. Gate 1 (Security & Schema) blocks hardcoded user paths, destructive commands, and oversized L0', () => {
    const ws = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // Hardcoded Windows user path
      const badPathRes = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'hardcoded-path-rule',
        title: 'Bad Path Rule',
        l0_summary: 'Never use local paths',
        content: 'Read config from C:\\Users\\Alice\\secret.json',
      });
      assert.equal(badPathRes.isError, true);
      assert.match(badPathRes.content[0].text, /ERR_SECURITY_VIOLATION/);

      // Destructive command
      const rmRfRes = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'destructive-rule',
        title: 'Clean root',
        l0_summary: 'Clean up disk',
        content: 'Run rm -rf / to clean up',
      });
      assert.equal(rmRfRes.isError, true);
      assert.match(rmRfRes.content[0].text, /ERR_SECURITY_VIOLATION/);

      // Oversized L0 summary (>140 chars)
      const longL0Res = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'long-l0-rule',
        title: 'Long L0',
        l0_summary: 'x'.repeat(160),
        content: 'Valid content',
      });
      assert.equal(longL0Res.isError, true);
      assert.match(longL0Res.content[0].text, /ERR_INVALID_SCHEMA/);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('3. Gate 2 (Syntax & Sandbox Dry-Run) blocks broken scripts and commits verified Micro-Tools', () => {
    const ws = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // Syntax error in Node script
      const syntaxErrRes = dispatcher.handleToolCall('evo_propose', {
        kind: 'tool',
        id: 'broken-syntax-tool',
        title: 'Broken Syntax Tool',
        l0_summary: 'A tool with invalid JS syntax',
        runtime: 'node',
        script_code: 'const x = {{{ invalid syntax;',
      });
      assert.equal(syntaxErrRes.isError, true);
      assert.match(syntaxErrRes.content[0].text, /ERR_SYNTAX_CHECK/);

      // Fails --self-test dry-run (exits with 1)
      const failingTestRes = dispatcher.handleToolCall('evo_propose', {
        kind: 'tool',
        id: 'failing-self-test-tool',
        title: 'Failing Self Test Tool',
        l0_summary: 'Valid syntax but fails runtime self-test',
        runtime: 'node',
        script_code: 'console.error("Self test assertion failed"); process.exit(1);',
      });
      assert.equal(failingTestRes.isError, true);
      assert.match(failingTestRes.content[0].text, /ERR_SANDBOX_SELF_TEST/);

      // Passes syntax + --self-test and executes via evo_run
      const validScript = `
        const args = JSON.parse(process.env.EVO_ARGS || '{}');
        if (process.env.EVO_SELF_TEST === '1') {
          process.exit(0);
        }
        console.log(JSON.stringify({ sum: (args.a || 0) + (args.b || 0) }));
      `;
      const goodToolRes = dispatcher.handleToolCall('evo_propose', {
        kind: 'tool',
        id: 'math-adder-tool',
        title: 'Deterministic Math Adder Micro-Tool',
        l0_summary: 'Computes exact sum of two numbers in a sandboxed Node process.',
        runtime: 'node',
        script_code: validScript,
      });
      assert.equal(Boolean(goodToolRes.isError), false);

      // Run the newly evolved tool immediately via evo_run without restarting
      const runRes = dispatcher.handleToolCall('evo_run', {
        tool_id: 'math-adder-tool',
        args: { a: 19, b: 23 },
      });
      assert.equal(Boolean(runRes.isError), false);
      assert.match(runRes.content[0].text, /"sum":42/);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('4. Gate 3 (BM25/Jaccard Deduplication) blocks duplicate rules unless supersedes_id is provided', () => {
    const ws = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const r1 = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'codegraph-first-protocol',
        title: 'Always Check CodeGraph Index Before Grepping',
        l0_summary: 'Check .codegraph directory and run codegraph explore before grep or read_file.',
        content: 'Always verify .codegraph exists and query symbol graph first.',
      });
      assert.equal(Boolean(r1.isError), false);

      // Attempt duplicate rule with different ID
      const r2 = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'duplicate-codegraph-rule',
        title: 'Check CodeGraph Index Before Grepping Files',
        l0_summary: 'Always check .codegraph directory and run codegraph explore before grep.',
        content: 'Duplicate content here.',
      });
      assert.equal(r2.isError, true);
      assert.match(r2.content[0].text, /ERR_DUPLICATE_CAPABILITY/);

      // Upgrade with supersedes_id succeeds
      const r3 = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'codegraph-v2-protocol',
        supersedes_id: 'codegraph-first-protocol',
        title: 'Check CodeGraph Index Before Grepping Files v2',
        l0_summary: 'Always check .codegraph directory and run codegraph explore before grep.',
        content: 'Upgraded v2 protocol with automatic codegraph init -i fallback.',
      });
      assert.equal(Boolean(r3.isError), false);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('5. Gate 4 (Token Budget Cap & evo_compact GC) blocks core rule bloat and compacts cleanly', () => {
    const ws = createTempWorkspace();
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();
    const cfg = storage.getConfig();
    cfg.maxCoreRuleTokens = 120; // Set tight token cap to test budget gate
    storage.saveConfig(cfg);

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const p1 = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'database-pooling-guard',
        title: 'Database Connection Pooling Invariant',
        l0_summary: 'Always reuse singleton database pool across serverless invocations.',
        core: true,
        content: 'Do not instantiate new PrismaClient or pg.Pool inside request handlers. Reuse global singleton.',
      });
      assert.equal(Boolean(p1.isError), false);

      const p2 = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'redis-timeout-guard',
        title: 'Redis Socket Timeout Invariant',
        l0_summary: 'Always configure explicit connectTimeout and commandTimeout on Redis clients.',
        core: true,
        content: 'Never leave Redis client timeouts unbounded in production worker queues; set maxRetriesPerRequest=3.',
      });
      assert.equal(Boolean(p2.isError), false);

      // 3rd core rule exceeds the 120-token budget
      const p3 = dispatcher.handleToolCall('evo_propose', {
        kind: 'rule',
        id: 'http-retry-backoff-guard',
        title: 'Outbound HTTP Exponential Backoff Invariant',
        l0_summary: 'Wrap all external webhook calls with jittered exponential backoff and circuit breaker.',
        core: true,
        content: 'All outbound fetch requests to third-party payment gateways must enforce a 3000ms AbortSignal timeout and jittered retry.',
      });
      assert.equal(p3.isError, true);
      assert.match(p3.content[0].text, /ERR_BUDGET_EXCEEDED/);

      // Compact p1 + p2 into a single concise rule to free budget
      const compactRes = dispatcher.handleToolCall('evo_compact', {
        target_ids: ['database-pooling-guard', 'redis-timeout-guard'],
        reason: 'Consolidate data-layer connection and timeout invariants to free core budget',
        merged_proposal: {
          kind: 'rule',
          id: 'data-layer-resilience',
          title: 'Data Layer Singleton Pool & Timeout Invariant',
          l0_summary: 'Reuse singleton DB pools and enforce explicit timeouts on Redis/DB clients.',
          core: true,
          content: 'Reuse singleton DB/Prisma pools and set connectTimeout + maxRetriesPerRequest=3 on Redis.',
        },
      });
      assert.equal(Boolean(compactRes.isError), false);
      assert.equal(storage.listArchivedCount(), 2);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('6. End-to-End CLI Lifecycle: init -> bootstrap -> tree -> stats -> uninstall', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(
        path.join(ws, 'package.json'),
        JSON.stringify({ name: 'demo-app', type: 'module', devDependencies: { typescript: '^5.0.0' } }),
        'utf8'
      );

      const initRes = runInit(ws, ['claude', 'cursor', 'gemini']);
      assert.equal(initRes.updatedFiles.length, 3);
      assert.equal(fs.existsSync(path.join(ws, 'CLAUDE.md')), true);
      assert.equal(fs.existsSync(path.join(ws, '.mcp.json')), true);

      const bootRes = runBootstrap(ws);
      assert.ok(bootRes.rulesCreated.length >= 2);
      assert.ok(bootRes.skillsCreated.length >= 1);
      assert.ok(bootRes.toolsCreated.length >= 2);

      const treeOutput = renderEvoTree(ws);
      assert.match(treeOutput, /workspace-metrics-scanner/);
      assert.match(treeOutput, /bug-to-guardrail-sop/);

      const statsOutput = renderEvoStats(ws);
      assert.match(statsOutput, /100% \(Fixed 5-Tool Meta-MCP Signature\)/);

      const uninst = runUninstall(ws);
      assert.ok(uninst.cleanedFiles.includes('CLAUDE.md'));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('7. Issue #1: Global fallback isolates writes to ~/.evo/global and keeps repo .evo/ free of private rules', () => {
    const uninitializedDir = createTempWorkspace();
    const fakeGlobalDir = createTempWorkspace();
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const prevGlobalEnv = process.env.EVO_GLOBAL_DIR;
    const prevWsEnv = process.env.EVO_WORKSPACE;

    try {
      delete process.env.EVO_WORKSPACE;
      process.env.EVO_GLOBAL_DIR = fakeGlobalDir;

      const resolved = resolveWorkspaceRoot([], true, uninitializedDir);
      assert.equal(resolved, path.resolve(fakeGlobalDir));
      assert.notEqual(resolved, repoRoot);

      ensureGlobalFallbackSeeded(fakeGlobalDir, repoRoot);
      const globalStorage = new EvoStorage(fakeGlobalDir);
      assert.ok(globalStorage.getRule('gatekeeper-self-test-invariant') !== null);

      // Verify repository .evo/ does NOT contain private BMS/FSM rules
      const repoStorage = new EvoStorage(repoRoot);
      assert.equal(repoStorage.getRule('embedded-power-bms-guardrail'), null);
      assert.equal(repoStorage.getSkill('embedded-fsm-lookup-audit'), null);
    } finally {
      if (prevGlobalEnv === undefined) delete process.env.EVO_GLOBAL_DIR;
      else process.env.EVO_GLOBAL_DIR = prevGlobalEnv;
      if (prevWsEnv === undefined) delete process.env.EVO_WORKSPACE;
      else process.env.EVO_WORKSPACE = prevWsEnv;
      fs.rmSync(uninitializedDir, { recursive: true, force: true });
      fs.rmSync(fakeGlobalDir, { recursive: true, force: true });
    }
  });

  test('8. Issue #3 (1 & 2): Subdirectory --stealth parent .git discovery and --targets CLI filtering', () => {
    const repoRoot = createTempWorkspace();
    const subWorkspace = path.join(repoRoot, 'firmware', 'INV3K_5K_VMH');
    fs.mkdirSync(path.join(repoRoot, '.git', 'info'), { recursive: true });
    fs.mkdirSync(subWorkspace, { recursive: true });

    try {
      assert.equal(findGitRoot(subWorkspace), repoRoot);

      const targets = parseTargetsArg(['init', '--stealth', '--targets', 'agents'], subWorkspace);
      assert.deepEqual(targets, ['agents']);

      const res = runInit(subWorkspace, { stealth: true, targets });
      assert.deepEqual(res.updatedFiles, ['AGENTS.md']);
      assert.equal(fs.existsSync(path.join(subWorkspace, 'AGENTS.md')), true);
      assert.equal(fs.existsSync(path.join(subWorkspace, 'CLAUDE.md')), false);
      assert.equal(fs.existsSync(path.join(subWorkspace, 'GEMINI.md')), false);

      const excludePath = path.join(repoRoot, '.git', 'info', 'exclude');
      const excludeContent = fs.readFileSync(excludePath, 'utf8');
      assert.match(excludeContent, /\.evo\//);
      assert.match(excludeContent, /\/firmware\/INV3K_5K_VMH\/\.evo\//);
      assert.match(excludeContent, /\/firmware\/INV3K_5K_VMH\/AGENTS\.md/);

      // Also verify --targets auto detects existing AGENTS.md
      const autoTargets = parseTargetsArg(['init', '--targets=auto'], subWorkspace);
      assert.deepEqual(autoTargets, ['agents']);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('9. Issue #3 (3): SQLite FTS5-absent fallback mode operates with zero errors on Node v22 builds without FTS5', () => {
    const ws = createTempWorkspace();
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();
    const now = new Date().toISOString();
    storage.saveRule({
      id: 'fallback-bm25-rule',
      title: 'Fallback BM25 Search Verification Rule',
      l0_summary: 'Ensures search works when SQLite FTS5 module is absent on Windows Node v22.14.',
      scope_glob: 'src/**/*.ts',
      core: true,
      priority: 80,
      content: 'Verify capability_fts_fallback table ranks rules accurately without FTS5.',
      tokens: 45,
      origin: 'test',
      created_at: now,
      updated_at: now,
    });

    const telemetry = new EvoTelemetry(storage, { forceFts5Fallback: true });
    try {
      assert.equal(telemetry.isFts5Enabled(), false);
      const hits = telemetry.search('Fallback BM25 FTS5', 'rule', 5);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, 'fallback-bm25-rule');
      assert.ok(hits[0].score > 0);
    } finally {
      telemetry.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

