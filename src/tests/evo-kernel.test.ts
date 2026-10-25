import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvoMcpDispatcher, META_MCP_TOOLS } from '../mcp/handlers.js';
import { findGitRoot, runInit, runUninstall } from '../cli/init.js';
import { runBootstrap } from '../cli/bootstrap.js';
import { renderAuditReport, renderRefactorReport, runAudit, runRefactor } from '../cli/audit.js';
import { renderEvoStats, renderEvoTree, renderMemoryVerifyReport } from '../cli/visualizer.js';
import {
  ensureGlobalFallbackSeeded,
  parseTargetsArg,
  resolveWorkspaceRoot,
  runCli,
} from '../cli/index.js';
import { EvoStorage, isPluginOrExtensionInstallDir, parseFrontmatter } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { executeSandboxedScript, sanitizeSandboxEnv } from '../core/sandbox.js';
import { extractSymbolFingerprint, stripCStyleComments, normalizeCodeStructure } from '../core/memory.js';
import { detectDomainNumbersInRule } from '../core/gatekeeper.js';

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
        workspace: ws,
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
        workspace: ws,
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
        workspace: ws,
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
        workspace: ws,
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
        workspace: ws,
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
        workspace: ws,
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
        workspace: ws,
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
        workspace: ws,
        kind: 'rule',
        id: 'codegraph-first-protocol',
        title: 'Always Check CodeGraph Index Before Grepping',
        l0_summary: 'Check .codegraph directory and run codegraph explore before grep or read_file.',
        core: true,
        content: 'Always verify .codegraph exists and query symbol graph first.',
      });
      assert.equal(Boolean(r1.isError), false);

      // Attempt duplicate rule with different ID
      const r2 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'duplicate-codegraph-rule',
        title: 'Check CodeGraph Index Before Grepping Files',
        l0_summary: 'Always check .codegraph directory and run codegraph explore before grep.',
        core: true,
        content: 'Duplicate content here.',
      });
      assert.equal(r2.isError, true);
      assert.match(r2.content[0].text, /ERR_DUPLICATE_CAPABILITY/);

      // Upgrade with supersedes_id succeeds
      const r3 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'codegraph-v2-protocol',
        supersedes_id: 'codegraph-first-protocol',
        title: 'Check CodeGraph Index Before Grepping Files v2',
        l0_summary: 'Always check .codegraph directory and run codegraph explore before grep.',
        core: true,
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
        workspace: ws,
        kind: 'rule',
        id: 'database-pooling-guard',
        title: 'Database Connection Pooling Invariant',
        l0_summary: 'Always reuse singleton database pool across serverless invocations.',
        core: true,
        content: 'Do not instantiate new PrismaClient or pg.Pool inside request handlers. Reuse global singleton.',
      });
      assert.equal(Boolean(p1.isError), false);

      const p2 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
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
        workspace: ws,
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
        workspace: ws,
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

  test('10. Issue #2: evo audit [--global] and evo refactor [--apply] detect domain leaks, overlap, and decouple rules', () => {
    const ws = createTempWorkspace();
    const fakeHome = createTempWorkspace();

    try {
      // 1. Seed a polluted global ~/.gemini/GEMINI.md with C/C++ extensions, CodeGraph, and BMS macros
      const globalGeminiDir = path.join(fakeHome, '.gemini');
      fs.mkdirSync(globalGeminiDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalGeminiDir, 'GEMINI.md'),
        [
          '# Global Rules',
          'When editing *.c and *.h firmware files, always run codegraph_explore first.',
          'Check BMS_SERVICE_CAN_HAN_REQ_DISCHARGE_ENABLE and ADC/GPIO inverter protection.',
        ].join('\n'),
        'utf8'
      );

      // 2. Seed a workspace AGENTS.md and a local skill with high Jaccard overlap & hardware macros
      const sharedArchitectureParagraph =
        'Inverter firmware state machine transitions require lookup table verification, BMS_SERVICE_CAN_HAN_REQ_DISCHARGE_ENABLE pre-checks, and ADC relay protection guards before switching operating modes.';
      fs.writeFileSync(path.join(ws, 'AGENTS.md'), `# Workspace Agents\n\n${sharedArchitectureParagraph}\n`, 'utf8');

      const localSkillDir = path.join(ws, '.agents', 'skills', 'firmware-review');
      fs.mkdirSync(localSkillDir, { recursive: true });
      fs.writeFileSync(
        path.join(localSkillDir, 'SKILL.md'),
        `# Firmware Review Skill\n\n${sharedArchitectureParagraph}\n`,
        'utf8'
      );

      // 3. Run evo audit --global
      const report = runAudit(ws, {
        includeGlobal: true,
        globalHomeDir: fakeHome,
        tokenBudgetLimit: 20,
        overlapThreshold: 0.25,
      });

      assert.equal(report.healthy, false);
      assert.ok(report.domainLeaks.some((l) => l.scope === 'global' && l.displayPath.includes('GEMINI.md')));
      assert.ok(report.domainLeaks.some((l) => l.scope === 'workspace' && l.displayPath === 'AGENTS.md'));
      assert.ok(report.budgetViolations.length >= 1);
      assert.ok(report.redundancyOverlaps.length >= 1);

      const renderedAudit = renderAuditReport(report);
      assert.match(renderedAudit, /Domain Leak Warnings/);
      assert.match(renderedAudit, /evo refactor/);

      // 4. Run evo refactor --apply
      const refactorRes = runRefactor(ws, {
        includeGlobal: true,
        globalHomeDir: fakeHome,
        apply: true,
      });

      assert.equal(refactorRes.stages.length, 4);
      assert.ok(refactorRes.appliedChanges.length >= 1);
      assert.equal(
        fs.existsSync(path.join(ws, '.evo', 'skills', 'evo-rule-architect', 'SKILL.md')),
        true
      );
      assert.equal(
        fs.existsSync(path.join(ws, '.evo', 'rules', 'scoped', 'scoped-agents-domain-guard.md')),
        true
      );

      const renderedRefactor = renderRefactorReport(refactorRes);
      assert.match(renderedRefactor, /evo-rule-architect/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test('11. CognitiveMemory Gate 2 (Symbol Grounding) blocks hallucinated symbols and fingerprints polyglot C/TS symbols', () => {
    const ws = createTempWorkspace();
    const srcDir = path.join(ws, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create a C firmware file and a TypeScript gateway file
    fs.writeFileSync(
      path.join(srcDir, 'bms_can.c'),
      [
        '#include <stdint.h>',
        'static uint16_t g_u16CanRxTimer = 0;',
        '',
        'void BmsCanRxHandler(uint32_t frameId, const uint8_t* data) {',
        '  if (frameId == 0x18FF50E5) {',
        '    g_u16CanRxTimer = 0;',
        '  }',
        '}',
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      path.join(srcDir, 'gateway.ts'),
      [
        'export class CanGateway {',
        '  public dispatchFrame(id: number): boolean {',
        '    return id === 0x18ff50e5;',
        '  }',
        '}',
      ].join('\n'),
      'utf8'
    );

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // 1. Hallucinated symbol is rejected by AST Symbol Grounding Gate
      const badSymRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'memory',
        id: 'hallucinated-symbol-case',
        title: 'Hallucinated Symbol Case',
        l0_summary: 'Tests that non-existent symbols are blocked at Gate 2.',
        symptom: 'CAN bus timeout error 0x99',
        root_cause: 'Missing reset in PhantomNonExistentHandler',
        solution: 'Clear timer in PhantomNonExistentHandler',
        target_symbols: ['PhantomNonExistentHandler'],
      });
      assert.equal(badSymRes.isError, true);
      assert.match(badSymRes.content[0].text, /ERR_SYMBOL_NOT_FOUND/);

      // 2. Real C + TS symbols pass Gatekeeper and bind AST fingerprints with 0 core budget impact
      const validMemRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'memory',
        id: 'bms-can-rx-timeout-glitch',
        title: 'BMS CAN 0x18FF50E5 Timeout Relay Drop',
        l0_summary: 'CAN 0x18FF50E5 frame timeout causes relay drop when BmsCanRxHandler skips timer reset.',
        symptom: 'Main relay drops after 5s of 0x18FF50E5 traffic burst.',
        root_cause: 'BmsCanRxHandler and CanGateway.dispatchFrame frame ID mask mismatch.',
        solution: 'Match full 29-bit extended CAN ID 0x18FF50E5 and reset g_u16CanRxTimer.',
        target_symbols: ['BmsCanRxHandler', 'CanGateway.dispatchFrame'],
        tags: ['bms', 'can', 'relay'],
      });
      assert.equal(Boolean(validMemRes.isError), false);
      const parsedDiag = JSON.parse(validMemRes.content[0].text);
      assert.equal(parsedDiag.passed, true);
      assert.ok(parsedDiag.diagnostics.ast_fingerprints['BmsCanRxHandler'].ast_hash.length === 16);
      assert.ok(
        parsedDiag.diagnostics.ast_fingerprints['CanGateway.dispatchFrame'].ast_hash.length === 16
      );

      // Core rule budget remains 0 tokens
      const storage = new EvoStorage(ws);
      assert.equal(storage.getCoreRulesTokenUsage().totalTokens, 0);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('12. CognitiveMemory AST Fingerprint Immunity to comments/line-shifts + Stage 3 Topology Penetration', () => {
    const ws = createTempWorkspace();
    const srcDir = path.join(ws, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const bmsFile = path.join(srcDir, 'bms_can.c');
    fs.writeFileSync(
      bmsFile,
      [
        '#include <stdint.h>',
        'void BmsCanRxHandler(uint32_t frameId) {',
        '  if (frameId == 0x18FF50E5) {',
        '    resetWatchdog();',
        '  }',
        '}',
      ].join('\n'),
      'utf8'
    );

    // Caller file for Stage 3 Topology Penetration
    fs.writeFileSync(
      path.join(srcDir, 'isr_router.c'),
      [
        'extern void BmsCanRxHandler(uint32_t frameId);',
        'void CAN1_RX0_IRQHandler(void) {',
        '  BmsCanRxHandler(0x18FF50E5);',
        '}',
      ].join('\n'),
      'utf8'
    );

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const propRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'memory',
        id: 'can-isr-watchdog-case',
        title: 'CAN ISR Watchdog Reset Case',
        l0_summary: 'Watchdog resets during CAN1 RX burst due to BmsCanRxHandler.',
        symptom: 'MCU resets with IWDG flag during heavy CAN traffic.',
        root_cause: 'BmsCanRxHandler only resets watchdog on 0x18FF50E5.',
        solution: 'Ensure 0x18FF50E5 is not filtered out by hardware mask.',
        target_symbols: ['BmsCanRxHandler'],
      });
      assert.equal(Boolean(propRes.isError), false);

      // Now add 15 lines of comments, blank lines, and an unrelated helper function ABOVE BmsCanRxHandler,
      // plus comments and whitespace changes INSIDE BmsCanRxHandler!
      fs.writeFileSync(
        bmsFile,
        [
          '/* ==========================================================',
          ' * Header comment block added during refactoring',
          ' * ========================================================== */',
          '#include <stdint.h>',
          '',
          'void UnrelatedHelper(void) {',
          '  int x = 1;',
          '}',
          '',
          '// Shift BmsCanRxHandler down by many lines',
          'void   BmsCanRxHandler ( uint32_t frameId ) {',
          '  /* Internal comment that should not alter AST hash */',
          '  if ( frameId == 0x18FF50E5 ) {',
          '    // Another comment inside block',
          '    resetWatchdog( );',
          '  }',
          '}',
        ].join('\n'),
        'utf8'
      );

      // Stage 1 + 2: evo_search should still report VERIFIED!
      const searchRes = dispatcher.handleToolCall('evo_search', {
        workspace: ws,
        query: 'IWDG watchdog BmsCanRxHandler',
        kind: 'memory',
      });
      assert.match(searchRes.content[0].text, /\[MEMORY\] ✅ \[VERIFIED 1\/1 symbols/);

      // Stage 3: evo_inspect L2 should report VERIFIED, updated line numbers (L11-L17), and caller isr_router.c:3
      const inspectRes = dispatcher.handleToolCall('evo_inspect', {
        workspace: ws,
        id: 'can-isr-watchdog-case',
        tier: 'L2',
      });
      assert.match(inspectRes.content[0].text, /Status: VERIFIED \[置信度: HIGH \(≥80%\)\]/);
      assert.match(inspectRes.content[0].text, /relocated from src\/bms_can\.c:L2-L6 -> src\/bms_can\.c:L11-L17/);
      assert.match(inspectRes.content[0].text, /Callers: src\/isr_router\.c:3/);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('13. Anti-Drift Guardrail (防刻舟求剑): detects mutated/deleted code symbols, marks [STALE], and demotes search rank', () => {
    const ws = createTempWorkspace();
    const srcDir = path.join(ws, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const fsmFile = path.join(srcDir, 'inverter_fsm.c');
    fs.writeFileSync(
      fsmFile,
      [
        'int CheckGridVoltage(int v) {',
        '  if (v < 180 || v > 260) {',
        '    return -1;',
        '  }',
        '  return 0;',
        '}',
      ].join('\n'),
      'utf8'
    );

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // Propose an Episodic Memory anchored to CheckGridVoltage
      dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'memory',
        id: 'grid-voltage-trip-case',
        title: 'Grid Voltage False Trip at 255V',
        l0_summary: 'Grid voltage false trip when CheckGridVoltage threshold is 260V.',
        symptom: 'Inverter trips with ERR_GRID_OVERVOLT at 255V RMS.',
        root_cause: 'CheckGridVoltage upper bound 260V triggered by ADC spike.',
        solution: 'Inspect CheckGridVoltage hysteresis.',
        target_symbols: ['CheckGridVoltage'],
      });

      // Also propose an active Rule on the same topic
      dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'grid-voltage-adc-rule',
        title: 'Grid Voltage ADC Filtering Rule',
        l0_summary: 'Always filter grid voltage ADC samples before threshold comparison.',
        core: true,
        content: 'Apply 4-sample moving average before calling CheckGridVoltage.',
      });

      // Mutate the logic inside CheckGridVoltage (upper threshold changed from 260 to 285)
      fs.writeFileSync(
        fsmFile,
        [
          'int CheckGridVoltage(int v) {',
          '  if (v < 170 || v > 285) {',
          '    return -2;',
          '  }',
          '  return 0;',
          '}',
        ].join('\n'),
        'utf8'
      );

      // Search across all capabilities: active Rule must rank above STALE Memory!
      const searchRes = dispatcher.handleToolCall('evo_search', {
        query: 'Grid Voltage CheckGridVoltage',
        kind: 'all',
      });
      const searchText = searchRes.content[0].text;
      assert.match(searchText, /⚠️ \[STALE: CheckGridVoltage:MISMATCH\] grid-voltage-trip-case/);

      const ruleIdx = searchText.indexOf('grid-voltage-adc-rule');
      const staleMemIdx = searchText.indexOf('grid-voltage-trip-case');
      assert.ok(
        ruleIdx < staleMemIdx,
        'Active rule must rank above demoted [STALE] episodic memory'
      );

      // Inspecting the STALE memory emits the prominent ANTI-DRIFT GUARDRAIL ALERT
      const inspectStale = dispatcher.handleToolCall('evo_inspect', {
        id: 'grid-voltage-trip-case',
        tier: 'L2',
      });
      assert.match(inspectStale.content[0].text, /ANTI-DRIFT GUARDRAIL ALERT/);
      assert.match(inspectStale.content[0].text, /\[置信度: LOW \(20–50%\) · STALE\]/);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('14. Cold-Start Git Fix Mining: evo bootstrap extracts git fix commits into verified Episodic Memories', () => {
    const ws = createTempWorkspace();
    try {
      const srcDir = path.join(ws, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'can_driver.c'),
        'void CanBusReset(void) { int status = 0; }\n',
        'utf8'
      );

      // Initialize git repo and create a fix commit touching src/can_driver.c
      spawnSync('git', ['init'], { cwd: ws });
      spawnSync('git', ['config', 'user.email', 'test@evokernel.dev'], { cwd: ws });
      spawnSync('git', ['config', 'user.name', 'Evo Test'], { cwd: ws });
      spawnSync('git', ['add', 'src/can_driver.c'], { cwd: ws });
      spawnSync('git', ['commit', '-m', 'fix(can): prevent bus-off lockup in CanBusReset'], {
        cwd: ws,
      });

      const bootSummary = runBootstrap(ws);
      assert.ok(bootSummary.memoriesCreated.length >= 1);
      assert.ok(bootSummary.memoriesCreated[0].startsWith('git-fix-'));

      const verifyReport = renderMemoryVerifyReport(ws);
      assert.match(verifyReport, /\[✅ VERIFIED\] git-fix-/);
      assert.match(verifyReport, /src\/can_driver\.c/);

      const treeReport = renderEvoTree(ws);
      assert.match(treeReport, /Episodic Memories \(1 fault cases \| 1 VERIFIED · 0 STALE\)/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('15. Multi-Workspace MCP Routing & Plugin CWD Isolation (Refs #4, #5)', () => {
    const defaultWs = createTempWorkspace();
    const projectA = createTempWorkspace();
    const projectB = createTempWorkspace();
    const fakePluginDir = path.join(defaultWs, '.gemini', 'config', 'plugins', 'evo-kernel');
    fs.mkdirSync(path.join(fakePluginDir, '.evo', 'rules'), { recursive: true });
    const dispatcher = new EvoMcpDispatcher(defaultWs);
    try {
      // 1. Plugin directory CWD must never hijack user workspace routing
      assert.equal(
        resolveWorkspaceRoot([], true, fakePluginDir),
        path.resolve(os.homedir(), '.evo', 'global')
      );

      // 2. Subdirectory inside projectA with .evo must walk up to projectA root
      fs.mkdirSync(path.join(projectA, '.evo'), { recursive: true });
      fs.mkdirSync(path.join(projectB, '.evo'), { recursive: true });
      const subDirA = path.join(projectA, 'packages', 'firmware', 'src');
      fs.mkdirSync(subDirA, { recursive: true });
      assert.equal(resolveWorkspaceRoot([], true, subDirA), path.resolve(projectA));

      // 3. Per-call workspace parameter routes evo_propose and evo_search to isolated project roots
      const propA = dispatcher.handleToolCall('evo_propose', {
        workspace: projectA,
        kind: 'rule',
        id: 'proj-a-can-guard',
        title: 'Project A CAN Bus Guard',
        l0_summary: 'Validate CAN DLC bounds before frame unpacking in Project A.',
        core: true,
        content: 'Always verify DLC <= 8 before reading payload bytes.',
      });
      assert.equal(propA.isError, undefined, propA.content[0]?.text);

      const propB = dispatcher.handleToolCall('evo_propose', {
        workspace: projectB,
        kind: 'rule',
        id: 'proj-b-spi-guard',
        title: 'Project B SPI DMA Guard',
        l0_summary: 'Ensure SPI DMA buffer alignment in Project B.',
        core: true,
        content: 'Align DMA buffers to 32-byte cache lines before transfer.',
      });
      assert.equal(propB.isError, undefined, propB.content[0]?.text);

      // Search in Project A only finds Project A rule
      const searchA = dispatcher.handleToolCall('evo_search', {
        workspace: projectA,
        query: 'guard',
      });
      assert.match(searchA.content[0].text, /proj-a-can-guard/);
      assert.doesNotMatch(searchA.content[0].text, /proj-b-spi-guard/);

      // Search in Project B only finds Project B rule
      const searchB = dispatcher.handleToolCall('evo_search', {
        workspace: projectB,
        query: 'guard',
      });
      assert.match(searchB.content[0].text, /proj-b-spi-guard/);
      assert.doesNotMatch(searchB.content[0].text, /proj-a-can-guard/);
    } finally {
      dispatcher.close();
      fs.rmSync(defaultWs, { recursive: true, force: true });
      fs.rmSync(projectA, { recursive: true, force: true });
      fs.rmSync(projectB, { recursive: true, force: true });
    }
  });

  test('16. Issue #5 & #8 (Module 7.4 & Module 8): Multi-Host Native Plugin Manifests, Antigravity hooks.json & antigravity_hook.mjs', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const fakeGlobalDir = createTempWorkspace();
    const fakePluginInstallRoot = createTempWorkspace();
    try {
      // 1. Verify Antigravity plugin.json contains ONLY allowed schema keys (Module 7.4)
      const agyPlugin = JSON.parse(fs.readFileSync(path.join(repoRoot, 'plugin.json'), 'utf8'));
      assert.equal(agyPlugin.name, 'evo-kernel');
      assert.equal(agyPlugin.displayName, 'EvoKernel');
      assert.equal(agyPlugin.mcpServers, undefined, 'plugin.json must not contain non-standard mcpServers key');
      assert.equal(agyPlugin.rules, undefined, 'plugin.json must not contain non-standard rules key');
      assert.equal(agyPlugin.skills, undefined, 'plugin.json must not contain non-standard skills key');

      const agyMcp = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp_config.json'), 'utf8'));
      assert.ok(agyMcp.mcpServers['evo-kernel']);
      assert.ok(fs.existsSync(path.join(repoRoot, 'rules', 'AGENTS.md')));
      assert.ok(fs.existsSync(path.join(repoRoot, 'skills', 'bug-to-guardrail-sop', 'SKILL.md')));

      // 1b. Verify Antigravity hooks.json & scripts/antigravity_hook.mjs (Module 8)
      const agyHooks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks.json'), 'utf8'));
      assert.ok(Array.isArray(agyHooks['evo-evolution-reminder'].PreInvocation));
      assert.equal(agyHooks['evo-evolution-reminder'].PreInvocation[0].type, 'command');
      assert.ok(Array.isArray(agyHooks['evo-evolution-reminder'].Stop));

      const mockTranscript = path.join(fakeGlobalDir, 'transcript.jsonl');
      fs.writeFileSync(
        mockTranscript,
        [
          JSON.stringify({
            step_index: 0,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            content: '我已经完成了初始修改。',
          }),
          JSON.stringify({
            step_index: 1,
            type: 'USER_INPUT',
            source: 'USER_EXPLICIT',
            content: '不对，这里漏了边界检查，还是有乱码问题！',
          }),
        ].join('\n') + '\n',
        'utf8'
      );

      const convId = `test-conv-${Date.now()}`;
      const hookRun = spawnSync(
        process.execPath,
        [path.join(repoRoot, 'scripts', 'antigravity_hook.mjs'), 'PreInvocation'],
        {
          cwd: repoRoot,
          input: JSON.stringify({
            conversationId: convId,
            transcriptPath: mockTranscript,
            workspacePaths: [repoRoot],
          }),
          encoding: 'utf8',
        }
      );
      assert.equal(hookRun.status, 0);
      const hookOut = JSON.parse(hookRun.stdout.trim());
      assert.ok(Array.isArray(hookOut.injectSteps));
      assert.match(hookOut.injectSteps[0].ephemeralMessage, /\[EvoKernel 自演进提醒\]/);

      // Cooldown test: immediate re-run without new dirty edits must respect cooldown ('{}')
      const cooldownRun = spawnSync(
        process.execPath,
        [path.join(repoRoot, 'scripts', 'antigravity_hook.mjs'), 'PreInvocation'],
        {
          cwd: repoRoot,
          input: JSON.stringify({
            conversationId: convId,
            transcriptPath: mockTranscript,
            workspacePaths: [repoRoot],
          }),
          encoding: 'utf8',
        }
      );
      assert.equal(cooldownRun.status, 0);
      assert.equal(cooldownRun.stdout.trim(), '{}');

      // Non-existent transcript must exit 0 with '{}'
      const safeHookRun = spawnSync(
        process.execPath,
        [path.join(repoRoot, 'scripts', 'antigravity_hook.mjs'), 'PreInvocation'],
        {
          cwd: repoRoot,
          input: JSON.stringify({
            conversationId: 'missing-conv',
            transcriptPath: path.join(fakeGlobalDir, 'nonexistent.jsonl'),
          }),
          encoding: 'utf8',
        }
      );
      assert.equal(safeHookRun.status, 0);
      assert.equal(safeHookRun.stdout.trim(), '{}');

      // 2. Verify Claude Code .claude-plugin/plugin.json
      const claudePlugin = JSON.parse(
        fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8')
      );
      assert.equal(claudePlugin.name, 'evo-kernel');
      assert.match(
        claudePlugin.mcpServers['evo-kernel'].args[0],
        /\$\{CLAUDE_PLUGIN_ROOT\}\/dist\/cli\/index\.js/
      );

      // 3. Verify Gemini CLI gemini-extension.json
      const geminiExt = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'gemini-extension.json'), 'utf8')
      );
      assert.equal(geminiExt.name, 'evo-kernel');
      assert.equal(geminiExt.contextFileName, 'GEMINI.md');
      assert.match(
        geminiExt.mcpServers['evo-kernel'].args[0],
        /\$\{extensionPath\}\/dist\/cli\/index\.js/
      );

      // 4. Verify templates/seed-evo seeds global fallback even when plugin .evo is absent
      fs.cpSync(
        path.join(repoRoot, 'templates', 'seed-evo'),
        path.join(fakePluginInstallRoot, 'templates', 'seed-evo'),
        { recursive: true }
      );
      ensureGlobalFallbackSeeded(fakeGlobalDir, fakePluginInstallRoot);
      const seededStorage = new EvoStorage(fakeGlobalDir);
      assert.ok(seededStorage.getRule('gatekeeper-self-test-invariant') !== null);
      assert.ok(seededStorage.getRule('esm-typescript-imports') !== null);
      assert.ok(seededStorage.getSkill('bug-to-guardrail-sop') !== null);
      assert.ok(seededStorage.getTool('workspace-metrics-scanner') !== null);
      assert.equal(seededStorage.listMemories().length, 0);
    } finally {
      fs.rmSync(fakeGlobalDir, { recursive: true, force: true });
      fs.rmSync(fakePluginInstallRoot, { recursive: true, force: true });
    }
  });

  test('17. Issue #4, #6 & #8 (Module 7.1–7.3): Rule Abstraction, Backtick Identifier Detection, Chinese Case Anchor Section Exemption, Mandatory Transferability, and Scoped Bucket Cap', () => {
    const ws = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // 1. Reject single-file literal scope_glob without wildcards
      const narrowScopeRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'energy-meter-scaling',
        title: 'Energy Meter Scaling Guard',
        l0_summary: 'Verify integer scaling units across metering boundaries.',
        scope_glob: 'Source/EnergyMeter.c',
        core: false,
        content: 'Always verify unit scaling before accumulating energy counters.',
      });
      assert.equal(narrowScopeRes.isError, true);
      assert.match(narrowScopeRes.content[0].text, /ERR_SCOPE_TOO_NARROW/);

      // 2. Reject point-bug case log disguised as a rule
      const pointBugRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'can-charge-timeout-zero-drop-defect',
        title: 'CAN Charge Timeout Zero Drop Defect',
        l0_summary: 'Prevent CAN charge timeout zero drop defect during frame loss.',
        scope_glob: 'Source/**/*.c',
        core: false,
        content: 'Do not drop charge current to zero on single frame timeout.',
      });
      assert.equal(pointBugRes.isError, true);
      assert.match(pointBugRes.content[0].text, /ERR_POINT_BUG_CASE_LOG/);

      // 3. Reject hardcoded domain/physical parameter thresholds in rule body
      const domainNumRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'bus-voltage-regulation-guard',
        title: 'Bus Voltage Regulation Guard',
        l0_summary: 'Maintain bus voltage regulation stability under high load.',
        scope_glob: 'Source/**/*.c',
        core: false,
        content:
          'When apparent power exceeds 1500VA, clamp reference at 26.5V within hysteresis [-10V, -5V) and set wBusWeight=32.',
      });
      assert.equal(domainNumRes.isError, true);
      assert.match(domainNumRes.content[0].text, /ERR_RULE_CONTAINS_DOMAIN_NUMBERS/);

      // 4. Reject rules coupled to >= 3 concrete project identifiers/macros (Hungarian C & Backticked C# PascalCase/camelCase)
      const coupledIdRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'bus-reference-arbitration-guard',
        title: 'Bus Reference Arbitration Guard',
        l0_summary: 'Verify multi-source arbitration priority before updating bus reference.',
        scope_glob: 'Source/**/*.c',
        core: false,
        content:
          'Always arbitrate wBatBusSw, wPvKeepBusRef, and wBusWeight when cbCHG_MODE_LION is active.',
      });
      assert.equal(coupledIdRes.isError, true);
      assert.match(coupledIdRes.content[0].text, /ERR_RULE_COUPLED_TO_IDENTIFIERS/);

      const backtickCsRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'wpf-ui-dispatch-throttling',
        title: 'WPF UI Thread Dispatch Throttling',
        l0_summary: 'Prevent UI thread starvation during high-frequency packet reception.',
        scope_glob: 'Views/**/*.cs',
        core: false,
        content:
          'In high-frequency callbacks, batch collection updates via `RemoveRange` and `BeginInvoke` instead of updating `CanCharge` and `CanDischarge` properties per frame.',
      });
      assert.equal(backtickCsRes.isError, true);
      assert.match(backtickCsRes.content[0].text, /ERR_RULE_COUPLED_TO_IDENTIFIERS/);

      // 5. Reject missing or insufficient transfer_scenarios (< 2 scenarios) on new non-core/scoped rules
      const missingTransferRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'multi-source-setpoint-arbitration',
        title: 'Multi-Source Setpoint Arbitration Invariant',
        l0_summary: 'Verify priority arbitration and hysteresis deadband across all setpoint loops.',
        scope_glob: 'Source/**/*.c',
        core: false,
        content:
          'Verify priority arbitration across competing control sources before writing target setpoints.\nCase Anchor: wBatBusSw / wPvKeepBusRef @ 1500VA in BusControl.c',
      });
      assert.equal(missingTransferRes.isError, true);
      assert.match(missingTransferRes.content[0].text, /ERR_INSUFFICIENT_TRANSFER_SCENARIOS/);

      const weakTransferRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'multi-source-setpoint-arbitration',
        title: 'Multi-Source Setpoint Arbitration Invariant',
        l0_summary: 'Verify priority arbitration and hysteresis deadband across all setpoint loops.',
        scope_glob: 'Source/**/*.c',
        core: false,
        transfer_scenarios: ['Only applies to bus voltage loop'],
        content:
          'Verify priority arbitration across competing control sources before writing target setpoints.\nCase Anchor: wBatBusSw / wPvKeepBusRef @ 1500VA in BusControl.c',
      });
      assert.equal(weakTransferRes.isError, true);
      assert.match(weakTransferRes.content[0].text, /ERR_INSUFFICIENT_TRANSFER_SCENARIOS/);

      // 6. Accept 1-level-up abstracted rule with Chinese '## 典型反例锚点' section exemption and >= 2 transfer_scenarios (Scoped #1)
      const validScoped1 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'multi-source-setpoint-arbitration',
        title: 'Multi-Source Setpoint Arbitration Invariant',
        l0_summary: 'Verify priority arbitration and hysteresis deadband across all setpoint loops.',
        scope_glob: 'Source/**/*.c',
        core: false,
        transfer_scenarios: [
          'DC bus voltage reference arbitration between PV MPPT and battery loops',
          'AC grid charge current limit arbitration between BMS CAN and thermal derating',
        ],
        content: [
          'Verify priority arbitration and hysteresis deadband across competing control sources before writing target setpoints.',
          '',
          '## 典型反例锚点 (Case Anchors)',
          '- 固件案例：`wBatBusSw`、`wPvKeepBusRef` 与 `wBusWeight` 在 1500VA / 26.5V 阈值下发生竞争',
          '- 上位机案例：`RemoveRange`、`BeginInvoke`、`CanCharge` 与 `CanDischarge` 高频刷新',
        ].join('\n'),
      });
      assert.equal(validScoped1.isError, undefined, validScoped1.content[0]?.text);

      // Add Scoped #2 and Scoped #3 in the same 'source' bucket
      const validScoped2 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'communication-timeout-hold-guard',
        title: 'Communication Timeout State Hold Guard',
        l0_summary: 'Hold last valid control command during transient communication frame loss.',
        scope_glob: 'Source/**/*.c',
        core: false,
        transfer_scenarios: [
          'CAN bus BMS current limit hold during transient frame loss',
          'RS485 meter power feedback hold during packet CRC retry',
        ],
        content:
          'Never zero out actuator limits on a single dropped frame; apply a bounded hold timer before failsafe fallback.',
      });
      assert.equal(validScoped2.isError, undefined, validScoped2.content[0]?.text);

      const validScoped3 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'adc-isr-pipeline-budget-guard',
        title: 'High-Frequency ISR Execution Budget Guard',
        l0_summary: 'Defer non-critical telemetry formatting outside high-frequency control ISRs.',
        scope_glob: 'Source/**/*.c',
        core: false,
        transfer_scenarios: [
          'High-frequency ADC PWM current control loop ISR',
          'High-speed grid PLL zero-crossing capture ISR',
        ],
        content:
          'Keep high-frequency interrupt handlers strictly bounded to sampling and protection checks; move string/frame formatting to background tasks.',
      });
      assert.equal(validScoped3.isError, undefined, validScoped3.content[0]?.text);

      // 7. 4th scoped rule in 'source' bucket without supersedes_id triggers ERR_SCOPED_BUCKET_FULL
      const overflowScoped4 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'eeprom-wear-leveling-write-guard',
        title: 'Non-Volatile Memory Write Debounce Guard',
        l0_summary: 'Debounce and dirty-check configuration parameters before non-volatile writes.',
        scope_glob: 'Source/**/*.c',
        core: false,
        transfer_scenarios: [
          'EEPROM calibration parameter write coalescing',
          'Flash fault log ring-buffer wear leveling',
        ],
        content:
          'Always compare new parameter values against cached shadow state and enforce write coalescing before committing to non-volatile storage.',
      });
      assert.equal(overflowScoped4.isError, true);
      assert.match(overflowScoped4.content[0].text, /ERR_SCOPED_BUCKET_FULL/);

      // 8. Passing supersedes_id allows upgrading within the full bucket
      const upgradeScoped = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'communication-and-nvm-debounce-guard',
        supersedes_id: 'communication-timeout-hold-guard',
        title: 'Boundary I/O Timeout Hold & Write Debounce Guard',
        l0_summary: 'Apply bounded hold timers on comm loss and dirty-check debounce on NVM writes.',
        scope_glob: 'Source/**/*.c',
        core: false,
        content:
          'Enforce bounded hold timers on transient communication loss and dirty-check coalescing before non-volatile storage writes.',
      });
      assert.equal(upgradeScoped.isError, undefined, upgradeScoped.content[0]?.text);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('18. Issue #7: evo_search returns empty on zero-match queries and never creates .evo/ in uninitialized folders', () => {
    const defaultWs = createTempWorkspace();
    const uninitializedDir = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(defaultWs);
    try {
      // Seed a domain rule into defaultWs
      const seeded = dispatcher.handleToolCall('evo_propose', {
        workspace: defaultWs,
        kind: 'rule',
        id: 'pv-charge-cap-feedback-invariant',
        title: 'PV Charge Cap Feedback Invariant',
        l0_summary: 'Verify off-grid PV charge current feedback loop stability.',
        core: true,
        content: 'Always clamp PV charge current reference before updating PWM duty cycle.',
      });
      assert.equal(seeded.isError, undefined, seeded.content[0]?.text);

      // 1. Unrelated query must return zero-match message, NOT dump existing unrelated rules
      const zeroHitRes = dispatcher.handleToolCall('evo_search', {
        workspace: defaultWs,
        query: 'automation schedule',
      });
      assert.match(
        zeroHitRes.content[0].text,
        /No evolved capabilities matched query "automation schedule"\./
      );
      assert.doesNotMatch(zeroHitRes.content[0].text, /pv-charge-cap-feedback-invariant/);

      // 2. Empty query ("") still returns the Top capability overview
      const emptyQueryRes = dispatcher.handleToolCall('evo_search', {
        workspace: defaultWs,
        query: '',
      });
      assert.match(emptyQueryRes.content[0].text, /pv-charge-cap-feedback-invariant/);

      // 3. Passing an uninitialized folder in `workspace` must NOT create `.evo/` inside it
      const uninitSearchRes = dispatcher.handleToolCall('evo_search', {
        workspace: uninitializedDir,
        query: 'automation schedule',
      });
      assert.equal(
        fs.existsSync(path.join(uninitializedDir, '.evo')),
        false,
        'evo_search must never silently create .evo/ inside an uninitialized directory'
      );
      assert.match(
        uninitSearchRes.content[0].text,
        /No evolved capabilities matched query "automation schedule"\./
      );
    } finally {
      dispatcher.close();
      fs.rmSync(defaultWs, { recursive: true, force: true });
      fs.rmSync(uninitializedDir, { recursive: true, force: true });
    }
  });

  test('19. Issue #8 (Modules 1 & 2): Mandatory workspace schema, Anti-Write-Through Isolation, Two-Tier Lookup & scope_glob Language Filter', () => {
    const globalWs = createTempWorkspace();
    const uninitClone = createTempWorkspace();
    const cFirmwareWs = createTempWorkspace();
    const prevGlobalEnv = process.env.EVO_GLOBAL_DIR;
    process.env.EVO_GLOBAL_DIR = globalWs;

    const dispatcher = new EvoMcpDispatcher(globalWs);
    try {
      // 1. All 5 tools require 'workspace' in inputSchema.required
      for (const tool of META_MCP_TOOLS) {
        assert.ok(
          (tool.inputSchema.required as readonly string[]).includes('workspace'),
          `${tool.name} must require 'workspace'`
        );
      }

      // 2. Seed a global tool, global skill, and a C# rule into globalWs
      const globalToolRes = dispatcher.handleToolCall('evo_propose', {
        workspace: globalWs,
        kind: 'tool',
        id: 'cwd-echo-tool',
        title: 'Workspace CWD Echo Tool',
        l0_summary: 'Outputs process.cwd() to verify active workspace execution directory.',
        runtime: 'node',
        script_code:
          'if (process.env.EVO_SELF_TEST === "1") process.exit(0); console.log(JSON.stringify({ cwd: process.cwd() }));',
      });
      assert.equal(Boolean(globalToolRes.isError), false);

      const csRuleRes = dispatcher.handleToolCall('evo_propose', {
        workspace: globalWs,
        kind: 'rule',
        id: 'csharp-bms-framer-rule',
        title: 'C# BMS Frame Timeout Guard',
        l0_summary: 'Verify C# BMS protocol frame timeout and buffer isolation.',
        scope_glob: '**/*.cs',
        transfer_scenarios: [
          'C# serial port frame parser timeout handling',
          'WPF background telemetry stream buffer reuse',
        ],
        content: 'Do not clear shared buffer on single parser CRC mismatch.',
      });
      assert.equal(Boolean(csRuleRes.isError), false);

      // 3. Block global memory proposals (ERR_GLOBAL_MEMORY_FORBIDDEN)
      const globalMemRes = dispatcher.handleToolCall('evo_propose', {
        workspace: globalWs,
        kind: 'memory',
        id: 'illegal-global-memory',
        title: 'Illegal Global Memory',
        l0_summary: 'Should be rejected in global fallback tree.',
        symptom: 'Error',
        root_cause: 'Cause',
        solution: 'Fix',
        target_symbols: ['foo'],
      });
      assert.equal(globalMemRes.isError, true);
      assert.match(globalMemRes.content[0].text, /ERR_GLOBAL_MEMORY_FORBIDDEN/);

      // 4. Write operation in uninitialized git clone NEVER writes to globalWs; creates Stealth .evo locally
      fs.mkdirSync(path.join(uninitClone, '.git', 'info'), { recursive: true });
      const cloneRuleRes = dispatcher.handleToolCall('evo_propose', {
        workspace: uninitClone,
        kind: 'rule',
        id: 'clone-local-rule',
        title: 'Clone Local Private Rule',
        l0_summary: 'Private rule for uninitialized clone must stay in clone.',
        transfer_scenarios: [
          'Local clone configuration validation before build',
          'Submodule path resolution across developer worktrees',
        ],
        content: 'Keep private rule inside uninitClone/.evo.',
      });
      assert.equal(Boolean(cloneRuleRes.isError), false);
      assert.equal(fs.existsSync(path.join(uninitClone, '.evo')), true);
      const globalStorage = new EvoStorage(globalWs);
      assert.equal(globalStorage.getRule('clone-local-rule'), null);
      const excludeText = fs.readFileSync(path.join(uninitClone, '.git', 'info', 'exclude'), 'utf8');
      assert.match(excludeText, /\.evo\//);

      // 5. Pure C firmware workspace filters out '**/*.cs' rule, but can inspect & run global tool with cwd = cFirmwareWs
      fs.mkdirSync(path.join(cFirmwareWs, '.evo'), { recursive: true });
      fs.writeFileSync(path.join(cFirmwareWs, 'main.c'), 'int main(void) { return 0; }\n', 'utf8');

      const cRuleRes = dispatcher.handleToolCall('evo_propose', {
        workspace: cFirmwareWs,
        kind: 'rule',
        id: 'c-bms-timeout-rule',
        title: 'C Firmware BMS Frame Timeout Guard',
        l0_summary: 'Verify C firmware BMS protocol frame timeout counter.',
        scope_glob: '**/*.{c,h}',
        transfer_scenarios: [
          'CAN RX interrupt frame timeout counter handling',
          'UART Modbus RTU slave response watchdog',
        ],
        content: 'Check frame timeout counter in C ISR.',
      });
      assert.equal(Boolean(cRuleRes.isError), false);

      const searchC = dispatcher.handleToolCall('evo_search', {
        workspace: cFirmwareWs,
        query: 'BMS frame timeout',
      });
      assert.match(searchC.content[0].text, /c-bms-timeout-rule/);
      assert.doesNotMatch(
        searchC.content[0].text,
        /csharp-bms-framer-rule/,
        'C# rule (**/*.cs) must be filtered out in pure C workspace'
      );

      // Two-tier evo_run executes global tool with cwd = cFirmwareWs
      const runGlobalInLocal = dispatcher.handleToolCall('evo_run', {
        workspace: cFirmwareWs,
        tool_id: 'cwd-echo-tool',
      });
      assert.equal(Boolean(runGlobalInLocal.isError), false);
      assert.ok(
        runGlobalInLocal.content[0].text
          .toLowerCase()
          .includes(path.resolve(cFirmwareWs).replace(/\\/g, '\\\\').toLowerCase())
      );
    } finally {
      dispatcher.close();
      if (prevGlobalEnv === undefined) delete process.env.EVO_GLOBAL_DIR;
      else process.env.EVO_GLOBAL_DIR = prevGlobalEnv;
      fs.rmSync(globalWs, { recursive: true, force: true });
      fs.rmSync(uninitClone, { recursive: true, force: true });
      fs.rmSync(cFirmwareWs, { recursive: true, force: true });
    }
  });

  test('20. Issue #8 (Modules 3, 4, 5, 6): Atomic evo_compact, Default core:false, Anti-Poisoning Hook, Alias Normalization & CJK 2-gram / C Comment Grounding', () => {
    const ws = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // Module 4 & 5: Default core is false, and 'body' alias works for rule 'content'
      const r1 = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'bus-ripple-deadzone-guard',
        title: '母线纹波与死区偏置控制护栏',
        l0_summary: '离网母线大纹波工况下必须确保维持死区偏置在目标点下方防止积分泄漏。',
        transfer_scenarios: [
          '离网逆变器大负载下直流母线稳压环死区偏置设计',
          '储能变流器并离网切换期间电流环抗积分饱和死区设置',
        ],
        body: '当慢速积分器将系统拉向稳态目标点时，维持死区必须置于目标点单侧。',
      } as unknown as Record<string, unknown>);
      assert.equal(Boolean(r1.isError), false);
      const storage = new EvoStorage(ws);
      const savedR1 = storage.getRule('bus-ripple-deadzone-guard');
      assert.ok(savedR1);
      assert.equal(savedR1.core, false, 'Rule must default to core: false when omitted');
      const originalCreatedAt = savedR1.created_at;

      // Module 5: 'level: "L1"' alias works in evo_inspect
      const inspectL1 = dispatcher.handleToolCall('evo_inspect', {
        workspace: ws,
        id: 'bus-ripple-deadzone-guard',
        level: 'L1',
      });
      assert.match(inspectL1.content[0].text, /\[RULE L1\]/);

      // Module 6.1: Unspaced CJK compound query matches via 2-gram tokenization
      const cjkSearch = dispatcher.handleToolCall('evo_search', {
        workspace: ws,
        query: '母线纹波死区',
      });
      assert.match(cjkSearch.content[0].text, /bus-ripple-deadzone-guard/);

      // Module 3.2: Same-ID update archives prior version and preserves created_at
      const r1Update = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'bus-ripple-deadzone-guard',
        title: '母线纹波与死区偏置控制护栏 v2',
        l0_summary: '离网母线大纹波工况下必须确保维持死区偏置在目标点下方防止积分泄漏。',
        content: '更新后的规则正文：包含多环路极值工况正交校核。',
      });
      assert.equal(Boolean(r1Update.isError), false);
      assert.equal(storage.getRule('bus-ripple-deadzone-guard')?.created_at, originalCreatedAt);
      assert.ok(storage.listArchivedCount() >= 1);

      // Add second rule to test atomic evo_compact
      dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'second-rule-for-compact',
        title: 'Second Rule For Atomic Compact Test',
        l0_summary: 'Second rule to verify atomic rollback on invalid compact.',
        transfer_scenarios: [
          'Scenario A for atomic compact verification',
          'Scenario B for atomic compact verification',
        ],
        content: 'Second rule body.',
      });

      // Module 3.1: Atomic evo_compact — invalid merged_proposal (oversized l0_summary) must NOT delete target_ids!
      const failedCompact = dispatcher.handleToolCall('evo_compact', {
        workspace: ws,
        target_ids: ['bus-ripple-deadzone-guard', 'second-rule-for-compact'],
        reason: 'Test atomic failure',
        merged_proposal: {
          kind: 'rule',
          id: 'merged-invalid-rule',
          title: 'Invalid Merged Rule',
          l0_summary: 'x'.repeat(180), // > 140 limit -> fails Gate 1
          content: 'Merged content',
        },
      });
      assert.equal(failedCompact.isError, true);
      assert.ok(
        storage.getRule('bus-ripple-deadzone-guard') !== null,
        'Original rule 1 must remain intact when evo_compact precheck fails'
      );
      assert.ok(
        storage.getRule('second-rule-for-compact') !== null,
        'Original rule 2 must remain intact when evo_compact precheck fails'
      );

      // Module 6.2 & 6.3: C function with ';' in end-of-line comment + Windows user path in memory.symptom
      const cFile = path.join(ws, 'mode_switch.c');
      fs.writeFileSync(
        cFile,
        [
          'void sTaskModeSwitch(void) // handles mode switch; called every 10ms',
          '{',
          '  int mode = 1;',
          '}',
        ].join('\n'),
        'utf8'
      );

      const memRes = dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'memory',
        id: 'mode-switch-semicolon-comment-case',
        title: 'Mode Switch Semicolon Comment Case',
        l0_summary: 'Verifies C declaration with semicolon in comment and path redaction.',
        symptom: 'Crash in C:\\Users\\Administrator\\Project\\mode_switch.c at line 2',
        root_cause: 'sTaskModeSwitch transition race condition',
        solution: 'Guard mode transition in sTaskModeSwitch',
        target_symbols: ['mode_switch.c#sTaskModeSwitch'],
      });
      assert.equal(Boolean(memRes.isError), false, memRes.content[0]?.text);
      const savedMem = storage.getMemory('mode-switch-semicolon-comment-case');
      assert.ok(savedMem);
      assert.match(savedMem.symptom, /<WORKSPACE>\/Project\\mode_switch\.c/);

      // Module 4.2: Mid-session code mutation after crystallization triggers Anti-Poisoning Alert in hook
      runCli(['node', 'evo', 'hook', 'post-tool', '--tool', 'edit_file', '--workspace', ws]);
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));
      try {
        runCli(['node', 'evo', 'hook', 'stop', '--workspace', ws]);
      } finally {
        console.log = origLog;
      }
      assert.match(logs.join('\n'), /\[EvoKernel Anti-Poisoning Alert\].*mode-switch-semicolon-comment-case/);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('21. Issue #8 (Modules 9 & 10): Anti-Lazy-Memory Upgrade Candidates, Evolution Receipt Seed & Shared .evo Across Sibling Clones (--link)', () => {
    const masterClone = createTempWorkspace();
    const siblingClone = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(masterClone);

    try {
      // 1. Initialize masterClone and link siblingClone to masterClone/.evo via runInit({ linkEvoFrom })
      fs.mkdirSync(path.join(masterClone, '.git', 'info'), { recursive: true });
      fs.mkdirSync(path.join(siblingClone, '.git', 'info'), { recursive: true });

      runInit(masterClone, { stealth: true, targets: ['agents'] });
      const linkRes = runInit(siblingClone, {
        stealth: true,
        targets: ['agents'],
        linkEvoFrom: masterClone,
      });

      assert.equal(linkRes.linkedSharedEvoDir, path.join(masterClone, '.evo'));
      const agentsText = fs.readFileSync(path.join(siblingClone, 'AGENTS.md'), 'utf8');
      assert.match(agentsText, /🧬 EvoKernel 演进回执/);

      const siblingStorage = new EvoStorage(siblingClone);
      assert.equal(siblingStorage.rootDir, path.resolve(siblingClone));
      assert.equal(siblingStorage.evoDir, path.join(masterClone, '.evo'));

      // 2. Propose a scoped rule in masterClone; verify it is immediately visible when searching from siblingClone
      const scopedRuleRes = dispatcher.handleToolCall('evo_propose', {
        workspace: masterClone,
        kind: 'rule',
        id: 'shared-clone-loop-guard',
        title: 'Shared Clone Control Loop Guard',
        l0_summary: 'Verify multi-loop priority arbitration across sibling worktrees.',
        scope_glob: '**/*.c',
        core: false,
        transfer_scenarios: [
          'Multi-loop DC bus voltage priority arbitration across inverter worktrees',
          'Grid-tied current ramp arbitration across parallel firmware clones',
        ],
        content: 'Check loop priority before updating setpoint.',
      });
      assert.equal(Boolean(scopedRuleRes.isError), false, scopedRuleRes.content[0]?.text);

      const searchFromSibling = dispatcher.handleToolCall('evo_search', {
        workspace: siblingClone,
        query: 'multi-loop priority arbitration',
      });
      assert.match(searchFromSibling.content[0].text, /shared-clone-loop-guard/);

      // 3. Create a C source file ONLY in siblingClone and propose an Episodic Memory from siblingClone:
      //    - AST symbol grounding verifies against siblingClone.rootDir
      //    - Memory is stored in masterClone/.evo/memories/
      //    - Response includes METHODOLOGY AUDIT warning and scoped_rule_upgrade_candidates (Module 9)
      fs.writeFileSync(
        path.join(siblingClone, 'ctrl_loop.c'),
        'void vCtrlLoopStep(int err) { if (err > 0) return; }\n',
        'utf8'
      );

      const memFromSibling = dispatcher.handleToolCall('evo_propose', {
        workspace: siblingClone,
        kind: 'memory',
        id: 'sibling-ctrl-loop-case',
        title: 'Sibling Clone Control Loop Case',
        l0_summary: 'Verifies AST grounding against sibling rootDir and shared .evo storage.',
        symptom: 'Control loop saturation in sibling worktree.',
        root_cause: 'vCtrlLoopStep early return on positive error.',
        solution: 'Clamp error before early return.',
        target_symbols: ['ctrl_loop.c#vCtrlLoopStep'],
      });
      assert.equal(Boolean(memFromSibling.isError), false, memFromSibling.content[0]?.text);

      const parsedMemRes = JSON.parse(memFromSibling.content[0].text);
      assert.match(parsedMemRes.warning, /METHODOLOGY AUDIT/);
      assert.ok(
        Array.isArray(parsedMemRes.diagnostics.scoped_rule_upgrade_candidates) &&
          parsedMemRes.diagnostics.scoped_rule_upgrade_candidates.some(
            (c: { id: string }) => c.id === 'shared-clone-loop-guard'
          ),
        'memory proposal response must surface existing scoped rules as upgrade candidates'
      );
      assert.equal(
        fs.existsSync(path.join(masterClone, '.evo', 'memories', 'sibling-ctrl-loop-case.md')),
        true,
        'Memory proposed in linked sibling clone must be saved into master shared .evo/memories/'
      );
    } finally {
      dispatcher.close();
      fs.rmSync(masterClone, { recursive: true, force: true });
      fs.rmSync(siblingClone, { recursive: true, force: true });
    }
  });

  test('22. Issue #8 Round 2 Audit Fixes: Blank Workspace Rejection, Cross-Project Leak Prevention, Duplicate/Ghost Compact Guard, Code-Only Scope Scan & Unclosed Multi-Line C Comment', () => {
    const projectA = createTempWorkspace();
    const projectB = createTempWorkspace();
    const isolatedGlobal = createTempWorkspace();
    const prevGlobalEnv = process.env.EVO_GLOBAL_DIR;
    process.env.EVO_GLOBAL_DIR = isolatedGlobal;

    const dispatcher = new EvoMcpDispatcher(projectA);
    try {
      // 1. Blank/whitespace workspace on evo_propose or evo_compact must be rejected with ERR_INVALID_SCHEMA
      const blankWsRes = dispatcher.handleToolCall('evo_propose', {
        workspace: '   ',
        kind: 'rule',
        id: 'blank-ws-rule',
        title: 'Blank Workspace Rule',
        l0_summary: 'Must fail when workspace is whitespace.',
        core: true,
        content: 'Should not be saved.',
      });
      assert.equal(blankWsRes.isError, true);
      assert.match(blankWsRes.content[0].text, /ERR_INVALID_SCHEMA/);

      // 2. Non-global defaultRoot (projectA) must NEVER leak into projectB as [GLOBAL]
      const projARule = dispatcher.handleToolCall('evo_propose', {
        workspace: projectA,
        kind: 'rule',
        id: 'project-a-private-invariant',
        title: 'Project A Private Invariant',
        l0_summary: 'Private invariant inside Project A must never leak into Project B.',
        core: true,
        content: 'Strictly isolated to Project A.',
      });
      assert.equal(Boolean(projARule.isError), false, projARule.content[0]?.text);

      fs.mkdirSync(path.join(projectB, '.evo'), { recursive: true });
      const searchInB = dispatcher.handleToolCall('evo_search', {
        workspace: projectB,
        query: 'Project A Private Invariant',
      });
      assert.doesNotMatch(
        searchInB.content[0].text,
        /project-a-private-invariant/,
        'Non-global defaultRoot (projectA) must never leak into projectB as [GLOBAL]'
      );

      // 3. evo_compact rejects duplicate/ghost target_ids and preserves created_at on same-ID compaction
      const rA = dispatcher.handleToolCall('evo_propose', {
        workspace: projectA,
        kind: 'rule',
        id: 'compact-preserve-a',
        title: 'Serial Framing Buffer Alignment Guard',
        l0_summary: 'Ensure UART DMA receive buffer alignment before packet decoding.',
        core: true,
        content: 'Align DMA ring buffer pointers on cache line boundaries.',
      });
      assert.equal(Boolean(rA.isError), false, rA.content[0]?.text);
      const storageA = new EvoStorage(projectA);
      const createdAtA = storageA.getRule('compact-preserve-a')!.created_at;

      const rB = dispatcher.handleToolCall('evo_propose', {
        workspace: projectA,
        kind: 'rule',
        id: 'compact-preserve-b',
        title: 'Watchdog Timer Kick Interval Invariant',
        l0_summary: 'Refresh hardware watchdog only after all critical control tasks complete.',
        core: true,
        content: 'Never kick hardware watchdog inside unconditional timer interrupts.',
      });
      assert.equal(Boolean(rB.isError), false, rB.content[0]?.text);

      // Duplicate IDs ['compact-preserve-a', 'compact-preserve-a'] -> < 2 unique IDs -> ERR_INVALID_SCHEMA
      const dupCompact = dispatcher.handleToolCall('evo_compact', {
        workspace: projectA,
        target_ids: ['compact-preserve-a', 'compact-preserve-a'],
        reason: 'Duplicate target_ids test',
        merged_proposal: {
          kind: 'rule',
          id: 'compact-preserve-a',
          title: 'Merged Rule',
          l0_summary: 'Merged summary.',
          core: true,
          content: 'Merged content.',
        },
      });
      assert.equal(dupCompact.isError, true);
      assert.match(dupCompact.content[0].text, /ERR_INVALID_SCHEMA/);

      // Ghost IDs ['ghost-1', 'ghost-2'] -> < 2 existing entries -> ERR_INVALID_SCHEMA
      const ghostCompact = dispatcher.handleToolCall('evo_compact', {
        workspace: projectA,
        target_ids: ['ghost-1', 'ghost-2'],
        reason: 'Ghost target_ids test',
        merged_proposal: {
          kind: 'rule',
          id: 'ghost-merged-rule',
          title: 'Ghost Merged Rule',
          l0_summary: 'Should not bypass evo_propose via ghost compact.',
          core: true,
          content: 'Should fail.',
        },
      });
      assert.equal(ghostCompact.isError, true);
      assert.match(ghostCompact.content[0].text, /ERR_INVALID_SCHEMA/);

      // Valid same-ID compact preserves created_at of 'compact-preserve-a'
      const validSameIdCompact = dispatcher.handleToolCall('evo_compact', {
        workspace: projectA,
        target_ids: ['compact-preserve-a', 'compact-preserve-b'],
        reason: 'Consolidate A and B into A',
        merged_proposal: {
          kind: 'rule',
          id: 'compact-preserve-a',
          title: 'Consolidated Rule A',
          l0_summary: 'Consolidated rule preserving original created_at timestamp.',
          core: true,
          content: 'Consolidated rule content.',
        },
      });
      assert.equal(Boolean(validSameIdCompact.isError), false, validSameIdCompact.content[0]?.text);
      assert.equal(storageA.getRule('compact-preserve-a')?.created_at, createdAtA);

      // 4. Scope scan with 210 .md files in docs/ + 1 .py script + 1 .c file in Source/ still matches **/*.{c,h}
      const docsDir = path.join(projectB, 'docs');
      const srcDir = path.join(projectB, 'Source');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });
      for (let i = 0; i < 210; i++) {
        fs.writeFileSync(path.join(docsDir, `doc_${i}.md`), `# Doc ${i}\n`, 'utf8');
      }
      fs.writeFileSync(path.join(projectB, 'helper.py'), 'print("ok")\n', 'utf8');
      fs.writeFileSync(
        path.join(srcDir, 'inverter.c'),
        [
          'void vMultiCommentInit(void) /* multi-line comment start; with semicolon',
          '   continued comment */',
          '{',
          '  int x = 0;',
          '}',
        ].join('\n'),
        'utf8'
      );

      const globalCRule = dispatcher.handleToolCall('evo_propose', {
        workspace: isolatedGlobal,
        kind: 'rule',
        id: 'global-c-firmware-guard',
        title: 'Global C Firmware Guard',
        l0_summary: 'Verify C firmware protection logic even in doc-heavy repositories.',
        scope_glob: '**/*.{c,h}',
        transfer_scenarios: [
          'Mixed C firmware and Python tooling repository',
          'Doc-heavy embedded repository with 200+ markdown files',
        ],
        content: 'Verify C protection logic.',
      });
      assert.equal(Boolean(globalCRule.isError), false, globalCRule.content[0]?.text);

      const searchDocHeavy = dispatcher.handleToolCall('evo_search', {
        workspace: projectB,
        query: 'Global C Firmware Guard',
      });
      assert.match(
        searchDocHeavy.content[0].text,
        /global-c-firmware-guard/,
        '**/*.{c,h} rule must NOT be filtered out when repo has 210 .md files + 1 .py + 1 .c file'
      );

      // 5. C function with unclosed multi-line comment on declaration line passes AST symbol grounding
      const multiCommentMem = dispatcher.handleToolCall('evo_propose', {
        workspace: projectB,
        kind: 'memory',
        id: 'multi-line-comment-decl-case',
        title: 'Multi-Line Comment C Declaration Case',
        l0_summary: 'Verifies C declaration with unclosed /* comment and semicolon on header line.',
        symptom: 'False semicolon rejection on /* ... ; multi-line comment',
        root_cause: 'Single-line block comment regex missed unclosed /* at end of declaration line',
        solution: 'Strip trailing /*.*$ after single-line comment removal',
        target_symbols: ['Source/inverter.c#vMultiCommentInit'],
      });
      assert.equal(Boolean(multiCommentMem.isError), false, multiCommentMem.content[0]?.text);
    } finally {
      dispatcher.close();
      if (prevGlobalEnv === undefined) delete process.env.EVO_GLOBAL_DIR;
      else process.env.EVO_GLOBAL_DIR = prevGlobalEnv;
      fs.rmSync(projectA, { recursive: true, force: true });
      fs.rmSync(projectB, { recursive: true, force: true });
      fs.rmSync(isolatedGlobal, { recursive: true, force: true });
    }
  });

  test('23. Regression SEC-1: Sandbox environment sanitization blocks secrets and credential leakage', () => {
    const ws = createTempWorkspace();
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // 1. Verify sanitizeSandboxEnv unit logic
      const rawMockEnv = {
        OPENAI_API_KEY: 'sk-proj-test1234',
        ANTHROPIC_API_KEY: 'sk-ant-test5678',
        GITHUB_TOKEN: 'ghp_secret999',
        AWS_SECRET_ACCESS_KEY: 'aws_secret',
        DATABASE_PASSWORD: 'super_password',
        SSH_AUTH_SOCK: '/tmp/ssh.sock',
        NODE_AUTH_TOKEN: 'npm_token',
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        USERPROFILE: process.env.USERPROFILE,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        SYSTEMROOT: process.env.SYSTEMROOT,
        EVO_TEST_ALLOWED: 'allowed_value',
      };
      const sanitized = sanitizeSandboxEnv(rawMockEnv);
      assert.equal(sanitized.OPENAI_API_KEY, undefined);
      assert.equal(sanitized.ANTHROPIC_API_KEY, undefined);
      assert.equal(sanitized.GITHUB_TOKEN, undefined);
      assert.equal(sanitized.AWS_SECRET_ACCESS_KEY, undefined);
      assert.equal(sanitized.DATABASE_PASSWORD, undefined);
      assert.equal(sanitized.SSH_AUTH_SOCK, undefined);
      assert.equal(sanitized.NODE_AUTH_TOKEN, undefined);
      assert.equal(sanitized.NODE_ENV, 'test');
      assert.equal(sanitized.EVO_TEST_ALLOWED, 'allowed_value');

      // 2. Verify subprocess execution isolation
      const toolScript = path.join(ws, 'leak_test.mjs');
      fs.writeFileSync(
        toolScript,
        `
        const isSelfTest = process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test');
        if (isSelfTest) process.exit(0);
        console.log(JSON.stringify({
          anthropic: process.env.ANTHROPIC_API_KEY,
          github: process.env.GITHUB_TOKEN,
          evoArgs: process.env.EVO_ARGS ? JSON.parse(process.env.EVO_ARGS) : null,
          nodeEnv: process.env.NODE_ENV,
          hasPath: Boolean(process.env.PATH || process.env.Path),
          hasEvoWorkspace: Boolean(process.env.EVO_WORKSPACE)
        }));
        `,
        'utf8'
      );

      const res = executeSandboxedScript(
        'node',
        toolScript,
        { ping: 'pong' },
        {
          cwd: ws,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: 'sk-ant-real-secret',
            GITHUB_TOKEN: 'ghp_super_secret',
            NODE_ENV: 'sandbox_test',
          },
        }
      );

      assert.equal(res.exitCode, 0, res.stderr);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.anthropic, undefined);
      assert.equal(parsed.github, undefined);
      assert.equal(parsed.evoArgs.ping, 'pong');
      assert.equal(parsed.nodeEnv, 'sandbox_test');
      assert.equal(parsed.hasPath, true);
      assert.equal(parsed.hasEvoWorkspace, true);
    } finally {
      dispatcher.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('24. Regression LOGIC-1: syncFromDisk wraps FTS clear and capability re-indexing in an atomic transaction', () => {
    const ws = createTempWorkspace();
    const storage = new EvoStorage(ws);
    const telemetry = new EvoTelemetry(storage);
    try {
      storage.saveRule({
        id: 'tx-test-rule',
        title: 'Transaction Test Rule',
        l0_summary: 'Rule for verifying atomic transaction indexing.',
        core: false,
        priority: 10,
        scope_glob: '**/*.ts',
        content: 'Transaction test rule content.',
        tokens: 30,
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      telemetry.syncFromDisk();
      const hitsBefore = telemetry.search('Transaction Test Rule', 'rule');
      assert.ok(hitsBefore.some((h) => h.id === 'tx-test-rule'));

      telemetry.syncFromDisk();
      const hitsAfter = telemetry.search('Transaction Test Rule', 'rule');
      assert.ok(hitsAfter.some((h) => h.id === 'tx-test-rule'));
    } finally {
      telemetry.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('25. Regression LOGIC-2: syncFromDisk purges deleted and archived capabilities from telemetry and episodic_memories', () => {
    const ws = createTempWorkspace();
    const storage = new EvoStorage(ws);
    const telemetry = new EvoTelemetry(storage);
    try {
      // 1. Propose and save a rule and a memory
      storage.saveRule({
        id: 'zombie-candidate-rule',
        title: 'Zombie Candidate Rule',
        l0_summary: 'Rule that will be archived to test zombie record purging.',
        core: false,
        priority: 10,
        scope_glob: '**/*.ts',
        content: 'Rule to be archived.',
        tokens: 30,
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      storage.saveMemory({
        id: 'zombie-candidate-memory',
        title: 'Zombie Candidate Memory',
        l0_summary: 'Memory that will be deleted to test zombie purging.',
        created_commit: 'abcdef1',
        symptom: 'Memory to be deleted',
        root_cause: 'Root cause',
        solution: 'Solution',
        target_symbols: ['test.ts#foo'],
        ast_fingerprints: {},
        tags: ['test'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      telemetry.syncFromDisk();

      const telMapBefore = telemetry.getTelemetryMap();
      assert.ok(telMapBefore.has('zombie-candidate-rule'));
      assert.ok(telMapBefore.has('zombie-candidate-memory'));
      const zeroTokenBefore = telemetry.search('', 'all');
      assert.ok(zeroTokenBefore.some((h) => h.id === 'zombie-candidate-rule'));
      assert.ok(zeroTokenBefore.some((h) => h.id === 'zombie-candidate-memory'));

      // 2. Archive rule and memory (removes active files from disk)
      storage.archiveCapability('zombie-candidate-rule', 'rule', 'Archival test');
      storage.archiveCapability('zombie-candidate-memory', 'memory', 'Archival test');

      // 3. Trigger syncFromDisk()
      telemetry.syncFromDisk();

      // 4. Verify zombie capabilities are completely purged from telemetry table
      const telMapAfter = telemetry.getTelemetryMap();
      assert.equal(telMapAfter.has('zombie-candidate-rule'), false, 'Archived rule must be purged from telemetry table');
      assert.equal(telMapAfter.has('zombie-candidate-memory'), false, 'Archived memory must be purged from telemetry table');

      // 5. Zero-token search must NOT return archived/deleted capabilities
      const zeroTokenAfter = telemetry.search('', 'all');
      assert.equal(zeroTokenAfter.some((h) => h.id === 'zombie-candidate-rule'), false);
      assert.equal(zeroTokenAfter.some((h) => h.id === 'zombie-candidate-memory'), false);

      // 6. Punctuation-only search must return 0 hits
      const punctHits = telemetry.search('???', 'all');
      assert.equal(punctHits.length, 0, 'Punctuation-only search must return 0 hits');

      // 7. findSimilarCapabilities must not match purged capabilities
      const simHits = telemetry.findSimilarCapabilities('Zombie Candidate Rule', 'Rule that will be archived', 'rule');
      assert.equal(simHits.some((h) => h.id === 'zombie-candidate-rule'), false);
    } finally {
      telemetry.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('26. Regression PATH-1: isPluginOrExtensionInstallDir does not trigger on ordinary project directories named plugins or extensions', () => {
    const projectPaths = [
      'C:\\Users\\Developer\\projects\\my-monorepo\\packages\\plugins\\auth',
      'C:\\Users\\Developer\\projects\\frontend\\src\\plugins\\i18n',
      '/home/user/workspace/app/extensions/renderer',
      '/home/user/repo/plugins/payment-gateway',
      'D:\\Source\\project\\extensions\\theme',
    ];

    for (const p of projectPaths) {
      assert.equal(
        isPluginOrExtensionInstallDir(p),
        false,
        `Project path "${p}" must NOT be classified as an IDE plugin installation dir`
      );
    }

    const idePaths = [
      'C:\\Users\\Administrator\\.gemini\\config\\plugins\\evo-kernel',
      'C:\\Users\\Administrator\\.gemini\\extensions\\evo-kernel',
      'C:\\Users\\Administrator\\.gemini\\antigravity\\mcp\\evo-kernel',
      'C:\\Users\\User\\.vscode\\extensions\\my-extension-0.1.0',
      'C:\\Users\\User\\.cursor\\extensions\\my-extension-0.1.0',
      '/home/user/.evo/global',
      'C:\\Users\\User\\.claude-plugin\\evo-kernel',
    ];

    for (const p of idePaths) {
      assert.equal(
        isPluginOrExtensionInstallDir(p),
        true,
        `IDE installation path "${p}" MUST be classified as an IDE plugin/extension install dir`
      );
    }
  });

  test('27. Regression PATH-2: extractSymbolFingerprint strips leading slashes in fileHint on Windows', () => {
    const ws = createTempWorkspace();
    try {
      const srcDir = path.join(ws, 'src', 'core');
      fs.mkdirSync(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'calc.ts');
      fs.writeFileSync(
        targetFile,
        'export function addValues(a: number, b: number): number { return a + b; }\n',
        'utf8'
      );

      // 1. Test with leading forward slash: /src/core/calc.ts#addValues
      const fpForward = extractSymbolFingerprint(ws, '/src/core/calc.ts#addValues');
      assert.ok(fpForward, 'Should resolve symbol target with leading forward slash');
      assert.equal(fpForward.file_path, 'src/core/calc.ts');
      assert.match(fpForward.symbol, /addValues/);

      // 2. Test with leading backslash: \src\core\calc.ts#addValues
      const fpBackslash = extractSymbolFingerprint(ws, '\\src\\core\\calc.ts#addValues');
      assert.ok(fpBackslash, 'Should resolve symbol target with leading backslash');
      assert.equal(fpBackslash.file_path, 'src/core/calc.ts');
      assert.match(fpBackslash.symbol, /addValues/);

      // 3. Test relative path without leading slash
      const fpRelative = extractSymbolFingerprint(ws, 'src/core/calc.ts#addValues');
      assert.ok(fpRelative, 'Relative path should resolve correctly');
      assert.equal(fpForward.ast_hash, fpRelative.ast_hash);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('28. Regression LOGIC-3: parseFrontmatter handles UTF-8 BOM without losing metadata', () => {
    const rawWithBom = '\uFEFF---\nid: "bom-rule-test"\ntitle: "BOM Rule Test"\nl0_summary: "Verifies UTF-8 BOM handling."\ncore: true\n---\nRule body text after frontmatter.';
    const parsed = parseFrontmatter(rawWithBom);

    assert.equal(parsed.meta.id, 'bom-rule-test');
    assert.equal(parsed.meta.title, 'BOM Rule Test');
    assert.equal(parsed.meta.l0_summary, 'Verifies UTF-8 BOM handling.');
    assert.equal(parsed.meta.core, true);
    assert.equal(parsed.body.trim(), 'Rule body text after frontmatter.');

    const rawWithBomCrlf = '\uFEFF---\r\nid: "bom-crlf-test"\r\ntitle: "CRLF BOM Test"\r\n---\r\nBody text.\r\n';
    const parsedCrlf = parseFrontmatter(rawWithBomCrlf);
    assert.equal(parsedCrlf.meta.id, 'bom-crlf-test');
    assert.equal(parsedCrlf.body.trim(), 'Body text.');
  });

  test('29. Regression LOGIC-4: stripCStyleComments preserves regex literals containing slashes without corrupting code', () => {
    // 1. Direct stripCStyleComments verification
    const codeWithRegex = 'const url = /https?:\\/\\/[a-z0-9]/g; // keep this\nconst div = a / b; /* comment */';
    const strippedCode = stripCStyleComments(codeWithRegex);
    assert.strictEqual(
      strippedCode,
      'const url = /https?:\\/\\/[a-z0-9]/g;  \nconst div = a / b;  '
    );
    assert.strictEqual(
      normalizeCodeStructure('const re = /\\/\\*/; // comment\nreturn re;'),
      'const re=/\\/\\*/;return re;'
    );

    // 2. Integration with extractSymbolFingerprint
    const ws = createTempWorkspace();
    try {
      const srcDir = path.join(ws, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const codeFile = path.join(srcDir, 'regex_test.ts');
      fs.writeFileSync(
        codeFile,
        [
          'export function parseUrl(raw: string): string {',
          '  const urlRegex = /https?:\\/\\/[a-z0-9_.-]+\\//i; // trailing comment',
          '  const match = raw.match(urlRegex);',
          '  const commentPattern = /\\/\\*[\\s\\S]*?\\*\\//g;',
          '  return match ? match[0] : "";',
          '}',
        ].join('\n'),
        'utf8'
      );

      const fp = extractSymbolFingerprint(ws, 'src/regex_test.ts#parseUrl');
      assert.ok(fp, 'AST fingerprint extraction must succeed for function containing regex literals');
      assert.match(fp.symbol, /parseUrl/);
      assert.ok(fp.ast_hash.length > 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('30. Regression LOGIC-5: detectDomainNumbersInRule does not false-match English letter A in numbered lists', () => {
    const safeTexts = [
      'Rule 1 A: verify input format. Rule 2 A: check schema validation.',
      'Option 1 A vs Option 2 A architecture trade-offs.',
      'Step 1 A: initialize storage. Step 2 A: sync telemetry tables.',
      'Section 1 A discusses requirements; Section 2 A discusses implementation.',
      'Step 1 A and Step 2 A and Option 1 A are valid.',
    ];

    for (const text of safeTexts) {
      const matches = detectDomainNumbersInRule(text);
      assert.deepEqual(
        matches,
        [],
        `English text "${text}" must NOT trigger domain number detection`
      );
    }

    const domainTexts = [
      'Maintain bus voltage below 800V and current under 35 A with 50Hz ripple.',
      'Phase current limit: 12.5mA continuous, 25A peak.',
      'When current exceeds 10A, clamp voltage to 24V.',
      'When current exceeds 10 Amps or 500mA.',
    ];

    for (const text of domainTexts) {
      const matches = detectDomainNumbersInRule(text);
      assert.ok(
        matches.length > 0,
        `Real domain text "${text}" MUST trigger domain number detection`
      );
    }
    assert.deepEqual(detectDomainNumbersInRule('When current exceeds 10A, clamp voltage to 24V.'), ['10A', '24V']);
    assert.deepEqual(detectDomainNumbersInRule('When current exceeds 10 Amps or 500mA.'), ['10 Amps', '500mA']);
  });

  test('31. Regression PARITY-1: JS fallback search implements weighted BM25 with term frequency, multi-term ranking & CJK support', () => {
    const ws = createTempWorkspace();
    const storage = new EvoStorage(ws);
    const telemetry = new EvoTelemetry(storage, { forceFts5Fallback: true });
    try {
      storage.saveRule({
        id: 'low-tf-rule',
        title: 'UART DMA Ring Buffer Invariant',
        l0_summary: 'Configure DMA buffer on UART channel once.',
        core: false,
        priority: 10,
        scope_glob: '**/*.c',
        content: 'Brief content mentioning buffer.',
        tokens: 30,
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      storage.saveRule({
        id: 'high-tf-rule',
        title: 'DMA Buffer Optimization Guide',
        l0_summary: 'Advanced DMA buffer memory layout and buffer alignment.',
        core: false,
        priority: 10,
        scope_glob: '**/*.c',
        content: 'Buffer DMA buffer buffer buffer buffer alignment buffer management buffer.',
        tokens: 30,
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      storage.saveRule({
        id: 'multi-term-rule',
        title: 'UART DMA Ring Buffer Alignment and Cache Invalidation',
        l0_summary: 'Comprehensive guide covering UART DMA ring buffer cache flush.',
        core: false,
        priority: 10,
        scope_glob: '**/*.c',
        content: 'UART DMA ring buffer operations with cache maintenance.',
        tokens: 30,
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      storage.saveRule({
        id: 'cjk-firmware-rule',
        title: '逆变器固件状态机守卫',
        l0_summary: '固件状态机异常状态转移防死锁规约。',
        core: false,
        priority: 10,
        scope_glob: '**/*.c',
        content: '逆变器控制环路固件状态机在异常时安全停机。',
        tokens: 30,
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      telemetry.syncFromDisk();

      // Verification 1: Term frequency ranking (high-tf-rule should score higher than low-tf-rule for query "buffer")
      const tfHits = telemetry.search('buffer', 'rule');
      const highTfHit = tfHits.find((h) => h.id === 'high-tf-rule');
      const lowTfHit = tfHits.find((h) => h.id === 'low-tf-rule');
      assert.ok(highTfHit && lowTfHit);
      assert.ok(
        highTfHit.score > lowTfHit.score,
        `High TF hit score (${highTfHit.score}) must exceed Low TF hit score (${lowTfHit.score})`
      );

      // Verification 2: Multi-term query matching title and summary
      const multiHits = telemetry.search('UART DMA ring buffer', 'rule');
      assert.ok(multiHits.length > 0);
      assert.equal(multiHits[0].id, 'multi-term-rule', 'Multi-term match must rank top');

      // Verification 3: CJK Bigram and single-character query
      const cjkBigramHits = telemetry.search('逆变器', 'rule');
      assert.ok(cjkBigramHits.some((h) => h.id === 'cjk-firmware-rule'), 'CJK bigram query must find capability');

      const cjkSingleHits = telemetry.search('逆', 'rule');
      assert.ok(cjkSingleHits.some((h) => h.id === 'cjk-firmware-rule'), 'CJK single character query must find capability');

      // Verification 4: Fallback score scale alignment (score must be positive, rank must be negative)
      for (const hit of tfHits) {
        assert.ok(hit.score > 0, `Search hit score (${hit.score}) must be positive`);
      }
    } finally {
      telemetry.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('32. Regression LOGIC-6: mcp_config.json startup script exits cleanly with code 1 when dist/ is unbuilt', () => {
    const emptyWs = createTempWorkspace();
    const mcpConfigPath = path.resolve(process.cwd(), 'mcp_config.json');
    const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    const nodeArgs = mcpConfig.mcpServers['evo-kernel'].args;

    try {
      const res = spawnSync(process.execPath, nodeArgs, {
        cwd: emptyWs,
        encoding: 'utf8',
        timeout: 5000,
      });

      assert.equal(res.status, 1, `Process should exit with code 1, got status ${res.status}`);
      assert.doesNotMatch(
        res.stderr,
        /TypeError: The "path" argument must be of type string/,
        'Startup script must NOT throw uncaught TypeError'
      );
      assert.match(
        res.stderr,
        /\[EvoKernel MCP\] Error: dist\/cli\/index\.js not found/,
        'Startup script must log friendly error message to stderr'
      );
    } finally {
      fs.rmSync(emptyWs, { recursive: true, force: true });
    }
  });

  test('33. Issue #9 [HIGH-8]: --link (sharedEvoDir) mode isolates subordinate enabledHarnesses and sharedEvoDir from Master .evo/config.json', () => {
    const masterWs = createTempWorkspace();
    const subWs = createTempWorkspace();
    try {
      runInit(masterWs, { targets: ['claude'] });
      runInit(subWs, { targets: ['cursor'], linkEvoFrom: masterWs });

      const masterConfigRaw = JSON.parse(
        fs.readFileSync(path.join(masterWs, '.evo', 'config.json'), 'utf8')
      );
      const subLocalConfigRaw = JSON.parse(
        fs.readFileSync(path.join(subWs, '.evo', 'config.json'), 'utf8')
      );

      assert.deepEqual(masterConfigRaw.enabledHarnesses, ['claude']);
      assert.equal(masterConfigRaw.sharedEvoDir, undefined);
      assert.deepEqual(subLocalConfigRaw.enabledHarnesses, ['cursor']);
      assert.equal(
        path.resolve(subLocalConfigRaw.sharedEvoDir).toLowerCase(),
        path.resolve(masterWs, '.evo').toLowerCase()
      );
    } finally {
      fs.rmSync(masterWs, { recursive: true, force: true });
      fs.rmSync(subWs, { recursive: true, force: true });
    }
  });
});






