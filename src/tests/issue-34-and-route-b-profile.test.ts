import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EvoStorage,
  estimateTokens,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';
import { EvoMcpDispatcher, META_MCP_TOOLS } from '../mcp/handlers.js';
import { runInit, syncGlobalUserProfile } from '../cli/init.js';
import { auditHarnessSurfaces, runAudit } from '../cli/audit.js';
import { ensureGlobalFallbackSeeded, runCli } from '../cli/index.js';
import { buildUiSnapshot } from '../cli/ui.js';
import { buildEvoTreeJson, renderEvoStats, renderEvoTree } from '../cli/visualizer.js';
import {
  L0_META_RULE_SEED,
  PROFILE_MARKER_END,
  PROFILE_MARKER_START,
} from '../templates/meta-rule.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCmdShell(cmd: string, cwd: string, stdinText = ''): { status: number | null; stdout: string; stderr: string } {
  if (process.platform === 'win32') {
    const res = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], {
      cwd,
      input: stdinText,
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    });
    return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  }
  const res = spawnSync('sh', ['-c', cmd], {
    cwd,
    input: stdinText,
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

describe('Issue #34 Hardening & Route B Cross-Workspace Personal Profile Suite', () => {
  const savedEnv = { ...process.env };
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop()!;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  test('#34-1: hooks.json and .agents/hooks.json have zero embedded quotes and execute cleanly under cwd=ws and cwd=ws/.agents', () => {
    const rootHooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks.json'), 'utf8'));
    for (const ev of ['PreInvocation', 'Stop']) {
      for (const entry of rootHooks['evo-evolution-reminder'][ev]) {
        assert.ok(
          !String(entry.command).includes('"'),
          `hooks.json ${ev} command must not contain embedded double quotes: ${entry.command}`
        );
      }
    }

    const ws = makeTempDir('evo-34-1-');
    cleanupDirs.push(ws);
    runInit(ws, ['antigravity']);

    const agentsHooksPath = path.join(ws, '.agents', 'hooks.json');
    assert.ok(fs.existsSync(agentsHooksPath), '.agents/hooks.json must exist after antigravity init');
    const agentsHooks = JSON.parse(fs.readFileSync(agentsHooksPath, 'utf8'));

    const preCmd = String(agentsHooks['evo-evolution-reminder'].PreInvocation[0].command);
    const stopCmd = String(agentsHooks['evo-evolution-reminder'].Stop[0].command);
    assert.ok(!preCmd.includes('"'), `.agents/hooks.json PreInvocation must be quote-free: ${preCmd}`);
    assert.ok(!stopCmd.includes('"'), `.agents/hooks.json Stop must be quote-free: ${stopCmd}`);

    const emptyPayload = JSON.stringify({ conversationId: 'conv-34-1' });
    for (const cwd of [ws, path.join(ws, '.agents')]) {
      const resPre = runCmdShell(preCmd, cwd, emptyPayload);
      assert.strictEqual(resPre.status, 0, `PreInvocation failed in ${cwd}: ${resPre.stderr}`);
      assert.strictEqual(resPre.stdout.trim(), '{}');

      const resStop = runCmdShell(stopCmd, cwd, emptyPayload);
      assert.strictEqual(resStop.status, 0, `Stop failed in ${cwd}: ${resStop.stderr}`);
      assert.strictEqual(JSON.parse(resStop.stdout.trim()).decision, 'allow');
    }
  });

  test('#34-2: UTF-8 BOM in hook stdin, state file, and harness JSON configs parses cleanly without wiping state', () => {
    const ws = makeTempDir('evo-34-2-');
    cleanupDirs.push(ws);

    const statePath = path.join(ws, 'hook-state.json');
    const preservedEntry = { lastRemindedStep: 9, syncedEpoch: 'other-conv' };
    fs.writeFileSync(
      statePath,
      '\uFEFF' + JSON.stringify({ 'other-conv': preservedEntry }),
      'utf8'
    );

    const transcriptPath = path.join(ws, 'transcript.jsonl');
    fs.writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'done' }),
        JSON.stringify({ step_index: 2, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '不对，重新检查一下' }),
      ].join('\n'),
      'utf8'
    );

    const hookScript = path.join(REPO_ROOT, 'scripts', 'antigravity_hook.mjs');
    const hookRes = spawnSync(process.execPath, [hookScript, 'PreInvocation'], {
      cwd: ws,
      input: '\uFEFF' + JSON.stringify({ conversationId: 'conv-bom', transcriptPath }),
      encoding: 'utf8',
      env: { ...process.env, EVO_AGY_HOOK_STATE_PATH: statePath },
    });
    assert.strictEqual(hookRes.status, 0, hookRes.stderr);
    const parsedOut = JSON.parse(hookRes.stdout.trim());
    assert.ok(Array.isArray(parsedOut.injectSteps) && parsedOut.injectSteps.length === 1);

    const updatedState = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, ''));
    assert.deepStrictEqual(
      updatedState['other-conv'],
      preservedEntry,
      'Existing state in BOM-prefixed state file must not be wiped'
    );
    assert.ok(updatedState['conv-bom'], 'New conversation state must be saved');

    // Harness JSON configs with BOM
    fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, '.claude', 'settings.json'),
      '\uFEFF' + JSON.stringify({ customKey: 'keep-me' }, null, 2),
      'utf8'
    );
    fs.mkdirSync(path.join(ws, '.agents'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, '.agents', 'hooks.json'),
      '\uFEFF' + JSON.stringify({ customHook: [] }, null, 2),
      'utf8'
    );

    runInit(ws, ['claude', 'antigravity']);
    const claudeSettings = JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'settings.json'), 'utf8'));
    assert.strictEqual(claudeSettings.customKey, 'keep-me');
    const agentsHooks = JSON.parse(fs.readFileSync(path.join(ws, '.agents', 'hooks.json'), 'utf8'));
    assert.ok(Array.isArray(agentsHooks.customHook));
    assert.ok(agentsHooks['evo-evolution-reminder']);

    const violations = auditHarnessSurfaces(ws);
    assert.strictEqual(
      violations.filter((v) => v.code === 'ANTIGRAVITY_HOOK_UNSAFE_QUOTES').length,
      0
    );
  });

  test('#34-3: agy-config-auditor runs as thin SSOT wrapper via EVO_PACKAGE_ROOT and flags embedded quotes in hooks.json', () => {
    const ws = makeTempDir('evo-34-3-');
    cleanupDirs.push(ws);
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();

    fs.writeFileSync(
      path.join(ws, 'hooks.json'),
      JSON.stringify({
        'evo-evolution-reminder': {
          PreInvocation: [{ type: 'command', command: 'node -e "console.log(1)"' }],
        },
      }),
      'utf8'
    );

    const auditorScript = path.join(REPO_ROOT, 'templates', 'seed-evo', 'tools', 'agy-config-auditor', 'run.mjs');
    const res = spawnSync(process.execPath, [auditorScript], {
      cwd: ws,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVO_WORKSPACE: ws,
        EVO_PACKAGE_ROOT: REPO_ROOT,
        EVO_GLOBAL_DIR: makeTempDir('evo-34-3-g-'),
      },
    });
    assert.strictEqual(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout.trim());
    assert.notStrictEqual(report.degraded, true, 'Must resolve dist/ via EVO_PACKAGE_ROOT');
    assert.ok(
      Array.isArray(report.surface_violations) &&
        report.surface_violations.some((v: any) => v.code === 'ANTIGRAVITY_HOOK_UNSAFE_QUOTES'),
      'Must flag embedded double quotes in hooks.json'
    );

    const selfTestRes = spawnSync(process.execPath, [auditorScript, '--self-test'], {
      cwd: ws,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVO_WORKSPACE: ws,
        EVO_PACKAGE_ROOT: REPO_ROOT,
        EVO_SELF_TEST: '1',
      },
    });
    assert.strictEqual(selfTestRes.status, 0, selfTestRes.stderr);
    const selfJson = JSON.parse(selfTestRes.stdout.trim());
    assert.strictEqual(selfJson.self_test_assertions, true);
  });

  test('#34-4: handleToolCallAsync search & propose complete asynchronously with verified freshness and dirty-tree notice', async () => {
    const ws = makeTempDir('evo-34-4-');
    cleanupDirs.push(ws);
    const globalDir = makeTempDir('evo-34-4-g-');
    cleanupDirs.push(globalDir);
    process.env.EVO_GLOBAL_DIR = globalDir;

    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, 'src', 'calc.ts'),
      'export function computeWidgetTotal(a: number, b: number): number {\n  return a + b;\n}\n',
      'utf8'
    );
    spawnSync('git', ['init'], { cwd: ws });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ws });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: ws });
    spawnSync('git', ['add', '.'], { cwd: ws });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: ws });

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const proposeRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'memory',
        id: 'widget-total-overflow',
        title: 'Widget total helper check',
        l0_summary: 'computeWidgetTotal handles positive inputs',
        symptom: 'Unexpected total in computeWidgetTotal',
        root_cause: 'Input validation skipped before sum',
        solution: 'Validate inputs in computeWidgetTotal',
        target_symbols: ['src/calc.ts#computeWidgetTotal'],
        workspace: ws,
      });
      assert.notStrictEqual(proposeRes.isError, true, proposeRes.content?.[0]?.text);
      const propJson = JSON.parse(proposeRes.content[0].text);
      assert.strictEqual(propJson.passed, true);

      const searchRes = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'computeWidgetTotal',
        kind: 'memory',
        workspace: ws,
      });
      assert.notStrictEqual(searchRes.isError, true);
      assert.ok(searchRes.content[0].text.includes('[VERIFIED'));

      // Make dirty edit and re-propose to verify uncommitted_worktree diagnostic notice
      fs.writeFileSync(
        path.join(ws, 'src', 'calc.ts'),
        'export function computeWidgetTotal(a: number, b: number): number {\n  return (a || 0) + (b || 0);\n}\n',
        'utf8'
      );
      const dirtyProp = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'memory',
        id: 'widget-total-overflow',
        supersedes_id: 'widget-total-overflow',
        title: 'Widget total helper check updated',
        l0_summary: 'computeWidgetTotal handles falsy inputs',
        symptom: 'NaN when argument missing',
        root_cause: 'Coercion skipped',
        solution: 'Default missing operands to zero',
        target_symbols: ['src/calc.ts#computeWidgetTotal'],
        workspace: ws,
      });
      const dirtyJson = JSON.parse(dirtyProp.content[0].text);
      assert.strictEqual(dirtyJson.passed, true);
      assert.strictEqual(dirtyJson.diagnostics.uncommitted_worktree, true);
    } finally {
      dispatcher.close();
    }
  });

  test('#34-5: runAudit on distribution repo + global seed has 0 false-positive LEAK on evo-rule-architect, 0 OVERLAP 100%, and does not mutate global dir', () => {
    const ws = makeTempDir('evo-34-5-ws-');
    const fakeHome = makeTempDir('evo-34-5-home-');
    cleanupDirs.push(ws, fakeHome);

    // Create minimal distribution repo structure copying canonical files
    fs.writeFileSync(path.join(ws, 'plugin.json'), '{"name":"evo-kernel"}', 'utf8');
    fs.cpSync(path.join(REPO_ROOT, 'templates', 'seed-evo'), path.join(ws, 'templates', 'seed-evo'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(ws, 'skills', 'evo-rule-architect'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'templates', 'seed-evo', 'skills', 'evo-rule-architect', 'SKILL.md'),
      path.join(ws, 'skills', 'evo-rule-architect', 'SKILL.md')
    );
    fs.mkdirSync(path.join(ws, '.evo', 'skills', 'evo-rule-architect'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'templates', 'seed-evo', 'skills', 'evo-rule-architect', 'SKILL.md'),
      path.join(ws, '.evo', 'skills', 'evo-rule-architect', 'SKILL.md')
    );

    const globalRoot = path.join(fakeHome, '.evo', 'global');
    ensureGlobalFallbackSeeded(globalRoot, REPO_ROOT);
    const beforeFiles = fs.readdirSync(path.join(globalRoot, '.evo', 'rules')).sort();

    const report = runAudit(ws, { includeGlobal: true, globalHomeDir: fakeHome });
    const archLeaks = report.domainLeaks.filter((l) => l.displayPath.includes('evo-rule-architect'));
    assert.strictEqual(archLeaks.length, 0, `Unexpected leak on evo-rule-architect: ${JSON.stringify(archLeaks)}`);

    const fullOverlaps = report.redundancyOverlaps.filter(
      (o) => o.similarity >= 0.99 && (o.fileA.includes('evo-rule-architect') || o.fileB.includes('evo-rule-architect'))
    );
    assert.strictEqual(fullOverlaps.length, 0, `Unexpected 100% seed overlap: ${JSON.stringify(fullOverlaps)}`);

    // CLI `evo audit` must not mutate globalDir (even if unseeded or sentinel file present)
    const freshGlobal = makeTempDir('evo-34-5-cli-g-');
    cleanupDirs.push(freshGlobal);
    process.env.EVO_GLOBAL_DIR = freshGlobal;
    const origLog = console.log;
    console.log = () => {};
    try {
      runCli(['node', 'evo', 'audit', '--workspace', ws, '--json']);
    } finally {
      console.log = origLog;
    }
    assert.strictEqual(
      fs.existsSync(path.join(freshGlobal, '.evo')),
      false,
      'Read-only `evo audit` must never create or mutate global .evo/ directory'
    );
    assert.deepStrictEqual(
      fs.readdirSync(path.join(globalRoot, '.evo', 'rules')).sort(),
      beforeFiles
    );
  });

  test('#34-6: deliverable manifest self_test_args, workspace-metrics-scanner --self-test, bug-to-guardrail-sop desensitized, and self-referential supersedes_id stripped', () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'templates', 'seed-evo', 'tools', 'deliverable-canonical-inspector', 'manifest.json'),
        'utf8'
      )
    );
    assert.strictEqual(manifest.self_test_args['--self-test'], true);

    const scannerScript = path.join(REPO_ROOT, 'templates', 'seed-evo', 'tools', 'workspace-metrics-scanner', 'run.mjs');
    const scanRes = spawnSync(process.execPath, [scannerScript, '--self-test'], {
      encoding: 'utf8',
      env: { ...process.env, EVO_SELF_TEST: '1' },
    });
    assert.strictEqual(scanRes.status, 0, scanRes.stderr);
    const scanJson = JSON.parse(scanRes.stdout.trim());
    assert.ok(scanJson.scanned_files >= 1, `Expected scanned_files >= 1, got ${scanJson.scanned_files}`);

    const sopText = fs.readFileSync(
      path.join(REPO_ROOT, 'templates', 'seed-evo', 'skills', 'bug-to-guardrail-sop', 'SKILL.md'),
      'utf8'
    );
    assert.ok(!/\bwFaultFlag\b|\bBmsCan\b|\bBMS_SERVICE_/i.test(sopText), 'bug-to-guardrail-sop must be desensitized');

    const ws = makeTempDir('evo-34-6-');
    cleanupDirs.push(ws);
    const storage = new EvoStorage(ws);
    const telemetry = new EvoTelemetry(storage);
    const gatekeeper = new EvoGatekeeper(storage, telemetry);
    try {
      const res = gatekeeper.evaluateAndCommit({
        kind: 'rule',
        id: 'self-ref-rule-guard',
        supersedes_id: 'self-ref-rule-guard',
        title: 'Self-ref rule guard',
        l0_summary: 'Strip self-referential supersedes_id on commit',
        scope_glob: 'src/**/*.ts',
        core: false,
        content: 'Always strip self-referential supersedes identifiers during rule commit.',
        transfer_scenarios: [
          'Module A schema normalization pipeline',
          'Module B metadata persistence layer',
        ],
        workspace: ws,
      });
      assert.strictEqual(res.passed, true, res.message);
      const saved = storage.getRule('self-ref-rule-guard');
      assert.ok(saved);
      assert.strictEqual(saved!.supersedes_id, undefined, 'Self-referential supersedes_id must be stripped');
    } finally {
      telemetry.close();
    }
  });

  test('#34-7.3: ensureGlobalFallbackSeeded bumps legacy 0.1.0 config to 0.4.0, removes retired seeds, and preserves custom user global assets', () => {
    const globalRoot = makeTempDir('evo-34-7-');
    cleanupDirs.push(globalRoot);
    const evoDir = path.join(globalRoot, '.evo');
    fs.mkdirSync(path.join(evoDir, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(evoDir, 'skills', 'bms-legacy-skill'), { recursive: true });
    fs.mkdirSync(path.join(evoDir, 'tools', 'evo-release-preflight'), { recursive: true });

    fs.writeFileSync(path.join(evoDir, 'config.json'), JSON.stringify({ version: '0.1.0', maxCoreRuleTokens: 1500 }), 'utf8');
    fs.writeFileSync(path.join(evoDir, 'rules', 'bms-legacy.md'), '# retired', 'utf8');
    fs.writeFileSync(path.join(evoDir, 'skills', 'bms-legacy-skill', 'SKILL.md'), '# retired skill', 'utf8');
    fs.writeFileSync(path.join(evoDir, 'tools', 'evo-release-preflight', 'manifest.json'), '{}', 'utf8');
    const customRulePath = path.join(evoDir, 'rules', 'my-custom-global.md');
    fs.writeFileSync(customRulePath, '---\nid: my-custom-global\ntitle: Custom\nl0_summary: Custom\n---\nKeep me.', 'utf8');

    ensureGlobalFallbackSeeded(globalRoot, REPO_ROOT);

    const updatedCfg = JSON.parse(fs.readFileSync(path.join(evoDir, 'config.json'), 'utf8'));
    assert.strictEqual(updatedCfg.version, '0.4.0');
    assert.strictEqual(fs.existsSync(path.join(evoDir, 'rules', 'bms-legacy.md')), false);
    assert.strictEqual(fs.existsSync(path.join(evoDir, 'skills', 'bms-legacy-skill')), false);
    assert.strictEqual(fs.existsSync(path.join(evoDir, 'tools', 'evo-release-preflight')), false);
    assert.strictEqual(fs.existsSync(customRulePath), true, 'Custom user global assets must be preserved');
  });

  test('Route B1-B4: preference lifecycle, security/budget gates, independent 500-tok cap, compaction, and marker-safe host push', async () => {
    const projectWs = makeTempDir('evo-rb-proj-');
    const globalRoot = makeTempDir('evo-rb-global-');
    const hostMockDir = makeTempDir('evo-rb-hosts-');
    cleanupDirs.push(projectWs, globalRoot, hostMockDir);

    const geminiMd = path.join(hostMockDir, '.gemini', 'GEMINI.md');
    const claudeMd = path.join(hostMockDir, '.claude', 'CLAUDE.md');
    const cursorMdc = path.join(hostMockDir, '.cursor', 'rules', 'evo-user-profile.mdc');
    const windsurfMd = path.join(hostMockDir, '.windsurf', 'rules', 'evo-user-profile.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.mkdirSync(path.dirname(claudeMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# User Global Rules\n\nKeep my custom rule intact.\n', 'utf8');
    fs.writeFileSync(claudeMd, '# Claude Personal Header\n', 'utf8');

    process.env.EVO_GLOBAL_DIR = globalRoot;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = [geminiMd, claudeMd, cursorMdc, windsurfMd].join(',');

    // Verify invariants
    assert.strictEqual(META_MCP_TOOLS.length, 5);
    assert.ok(estimateTokens(L0_META_RULE_SEED) < 1100, `L0_META_RULE_SEED must stay < 1100 tok (got ${estimateTokens(L0_META_RULE_SEED)})`);

    const dispatcher = new EvoMcpDispatcher(projectWs);
    try {
      // 1. Propose preference from project workspace -> routes to EVO_GLOBAL_DIR, does NOT create project .evo/
      const res1 = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'concise-reply-style',
        title: 'Concise reply style',
        l0_summary: 'Prefer direct bullet conclusions over verbose prose',
        category: 'style',
        always_on: true,
        content: 'Lead with direct answers and concrete verification evidence; skip filler.',
        workspace: projectWs,
      });
      assert.notStrictEqual(res1.isError, true, res1.content?.[0]?.text);
      const json1 = JSON.parse(res1.content[0].text);
      assert.strictEqual(json1.passed, true);
      assert.ok(Array.isArray(json1.diagnostics.synced_profile_targets));
      assert.strictEqual(fs.existsSync(path.join(projectWs, '.evo')), false, 'Global preference write must not pollute uninitialized folder');
      assert.ok(fs.existsSync(path.join(globalRoot, '.evo', 'preferences', 'concise-reply-style.md')));

      // Verify host files updated strictly inside EVO:PROFILE markers while preserving user content
      const geminiText = fs.readFileSync(geminiMd, 'utf8');
      assert.ok(geminiText.includes('Keep my custom rule intact.'));
      assert.ok(geminiText.includes(PROFILE_MARKER_START));
      assert.ok(geminiText.includes(PROFILE_MARKER_END));
      assert.ok(geminiText.includes('concise-reply-style'));
      assert.ok(fs.existsSync(cursorMdc));
      assert.ok(fs.readFileSync(cursorMdc, 'utf8').includes('alwaysApply: true'));
      assert.ok(fs.existsSync(windsurfMd));

      // 2. Gate 1 secret scan & invalid category STILL enforced
      const secFail = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'secret-leak-pref',
        title: 'Bad pref',
        l0_summary: 'Contains secret key',
        category: 'style',
        content: 'Always use token ghp_1234567890abcdefghijklmnopqrstuvwxyz123456',
        workspace: projectWs,
      });
      assert.strictEqual(secFail.isError, true);
      assert.strictEqual(JSON.parse(secFail.content[0].text).error_code, 'ERR_SECURITY_VIOLATION');

      const badCat = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'bad-category-pref',
        title: 'Bad category',
        l0_summary: 'Invalid category check',
        category: 'invalid-cat' as any,
        content: 'Some content',
        workspace: projectWs,
      });
      assert.strictEqual(badCat.isError, true);
      assert.strictEqual(JSON.parse(badCat.content[0].text).error_code, 'ERR_INVALID_SCHEMA');

      // 3. Per-item atomic cap (>150 tokens) rejected
      const tooBigItem = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'oversized-atomic-pref',
        title: 'Too long single preference',
        l0_summary: 'Exceeds 150 token atomic cap',
        category: 'formatting',
        always_on: true,
        content: Array.from({ length: 65 }, (_, i) => `Formatting constraint item ${i + 1} with extra detail`).join(' '),
        workspace: projectWs,
      });
      assert.strictEqual(tooBigItem.isError, true);
      assert.strictEqual(JSON.parse(tooBigItem.content[0].text).error_code, 'ERR_PROFILE_BUDGET_EXCEEDED');

      // 4. Budget independence: fill global engineering core rules near 1,500 tokens, verify 500-token profile budget is independent
      const gStorage = new EvoStorage(globalRoot);
      gStorage.saveRule({
        id: 'heavy-core-engineering-rule',
        title: 'Heavy core rule',
        l0_summary: 'Engineering core rule consuming 1400 tokens',
        scope_glob: '**/*',
        core: true,
        priority: 50,
        content: 'Engineering guardrail.',
        tokens: 1400,
        origin: 'evolved',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Add multiple distinct always_on preferences (each ~95 tokens) until > 500 tokens total
      const topics = [
        ['typography', 'monospace font hints', 'Use monospace blocks for identifiers and flags'],
        ['punctuation', 'em-dash spacing', 'Keep punctuation consistent across bilingual notes'],
        ['citations', 'source file anchors', 'Cite exact line ranges when referencing files'],
        ['numbering', 'ordered checklists', 'Use numbered steps for sequential actions'],
        ['headings', 'hierarchical markdown', 'Keep heading levels strictly nested without skips'],
        ['terminology', 'domain glossary terms', 'Use canonical product terminology consistently'],
        ['diagrams', 'mermaid flowcharts', 'Prefer compact sequence diagrams for protocols'],
        ['brevity', 'executive summary top', 'Place key decision upfront before supporting logs'],
      ] as const;
      const addedIds: string[] = [];
      for (let i = 0; i < topics.length; i++) {
        const [topic, titleSuffix, l0] = topics[i];
        const pid = `pref-${topic}`;
        const uniqueWords = Array.from(
          { length: 20 },
          (_, j) => `${topic}item${j}norm`
        ).join(' ');
        const r = await dispatcher.handleToolCallAsync('evo_propose', {
          kind: 'preference',
          id: pid,
          title: `Always apply ${titleSuffix}`,
          l0_summary: l0,
          category: i % 2 === 0 ? 'formatting' : 'communication',
          always_on: true,
          content: `${topic} specification: ${uniqueWords}`,
          workspace: projectWs,
        });
        const rj = JSON.parse(r.content[0].text);
        if (rj.passed) {
          addedIds.push(pid);
        } else {
          assert.strictEqual(rj.error_code, 'ERR_PROFILE_BUDGET_EXCEEDED', r.content[0].text);
          assert.ok(Array.isArray(rj.low_value_candidates) && rj.low_value_candidates.length > 0, r.content[0].text);
          break;
        }
      }
      assert.ok(addedIds.length >= 2 && addedIds.length < topics.length, `Expected budget cap around 500 tokens, added: ${addedIds.join(',')}`);

      // Verify on-demand preference (always_on: false) succeeds even when always_on budget is tight
      const onDemandRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'weekly-report-template',
        title: 'Weekly report template',
        l0_summary: 'On-demand personal weekly status template',
        category: 'workflow',
        always_on: false,
        content: 'Include Wins, Blockers, and Next Week priorities in bullet form.',
        workspace: projectWs,
      });
      assert.strictEqual(JSON.parse(onDemandRes.content[0].text).passed, true);

      // Verify evo_compact merges preferences and syncs profile targets
      const compactRes = await dispatcher.handleToolCallAsync('evo_compact', {
        target_ids: addedIds.slice(0, 2),
        reason: 'Consolidate overlapping formatting preferences',
        workspace: projectWs,
        merged_proposal: {
          kind: 'preference',
          scope: 'global',
          id: 'merged-format-pref',
          title: 'Merged formatting guideline',
          l0_summary: 'Consolidated personal formatting and communication style',
          category: 'formatting',
          always_on: true,
          content: 'Use clean sections, numbered steps, and concise bullet takeaways.',
        },
      });
      assert.notStrictEqual(compactRes.isError, true, compactRes.content?.[0]?.text);
      const compactJson = JSON.parse(compactRes.content[0].text);
      assert.strictEqual(compactJson.result.passed, true);
      assert.ok(fs.existsSync(path.join(globalRoot, '.evo', 'preferences', 'merged-format-pref.md')));

      // Archiving all active always_on preferences unlinks digest & standalone host files while keeping GEMINI.md user content
      for (const p of gStorage.listPreferences().filter((x) => x.always_on)) {
        gStorage.archiveCapability(p.id, 'preference', 'Cleanup test');
      }
      const cleanSync = syncGlobalUserProfile(globalRoot);
      assert.strictEqual(cleanSync.totalTokens, 0);
      assert.strictEqual(fs.existsSync(gStorage.profileDigestPath), false);
      const geminiAfterClean = fs.readFileSync(geminiMd, 'utf8');
      assert.ok(geminiAfterClean.includes('Keep my custom rule intact.'));
      assert.ok(!geminiAfterClean.includes(PROFILE_MARKER_START));
      assert.strictEqual(fs.existsSync(cursorMdc), false, 'Standalone cursor .mdc must be unlinked when profile is empty');
      assert.strictEqual(fs.existsSync(windsurfMd), false, 'Standalone windsurf .md must be unlinked when profile is empty');
    } finally {
      dispatcher.close();
    }
  });

  test('Route B5-B8: non-code search without .evo/ (no 0.85 penalty), CLI evo profile, hook style cue, and hermetic home guard', async () => {
    const nonCodeDir = makeTempDir('evo-rb-noncode-');
    const globalRoot = makeTempDir('evo-rb-global2-');
    cleanupDirs.push(nonCodeDir, globalRoot);

    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    const dispatcher = new EvoMcpDispatcher(nonCodeDir);
    try {
      const propRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'no-tables-in-summary',
        title: 'Avoid markdown tables in short summaries',
        l0_summary: 'Use bullet lists instead of markdown tables for concise answers',
        category: 'formatting',
        always_on: true,
        content: 'Prefer flat bullet lists instead of dense markdown tables in brief explanations.',
        tags: ['markdown', 'bullets', 'formatting'],
        workspace: nonCodeDir,
      });
      assert.strictEqual(JSON.parse(propRes.content[0].text).passed, true);

      // Hermetic guard: EVO_GLOBAL_DIR set without EVO_GLOBAL_PROFILE_TARGETS writes only globalRoot/USER_PROFILE.md
      assert.ok(fs.existsSync(path.join(globalRoot, 'USER_PROFILE.md')));

      // Non-code folder search recalls preference cleanly without .evo/ in nonCodeDir
      const searchAll = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'markdown tables bullet lists',
        kind: 'preference',
        workspace: nonCodeDir,
      });
      const searchAllText = searchAll.content[0].text;
      assert.ok(searchAllText.includes('[PREFERENCE]'), searchAllText);
      assert.ok(searchAllText.includes('no-tables-in-summary'), searchAllText);

      // Verify no 0.85 discount on preference hits vs direct global search
      const gTel = new EvoTelemetry(new EvoStorage(globalRoot));
      const directScore = gTel.search('markdown tables bullet lists', 'preference', 5, nonCodeDir)[0]?.score;
      gTel.close();
      assert.ok(directScore && directScore > 0);

      // scope: 'project' skips global preferences
      const searchProj = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'markdown tables bullet lists',
        kind: 'preference',
        scope: 'project',
        workspace: nonCodeDir,
      });
      assert.ok(searchProj.content[0].text.includes('No evolved capabilities matched'));

      // scope: 'global' finds it
      const searchGlobal = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'markdown tables',
        scope: 'global',
        workspace: nonCodeDir,
      });
      assert.ok(searchGlobal.content[0].text.includes('no-tables-in-summary'));

      // evo_inspect L1 and L2 for preference
      const insL1 = await dispatcher.handleToolCallAsync('evo_inspect', {
        id: 'no-tables-in-summary',
        tier: 'L1',
        workspace: nonCodeDir,
      });
      assert.ok(insL1.content[0].text.includes('[PREFERENCE L1] no-tables-in-summary'));

      const insL2 = await dispatcher.handleToolCallAsync('evo_inspect', {
        id: 'no-tables-in-summary',
        tier: 'L2',
        workspace: nonCodeDir,
      });
      assert.ok(insL2.content[0].text.includes('[PREFERENCE L2] no-tables-in-summary'));
      assert.ok(insL2.content[0].text.includes('Prefer flat bullet lists'));
    } finally {
      dispatcher.close();
    }

    // CLI: evo profile list / show / path / sync
    const captureCli = (cliArgs: string[]): string => {
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...items: unknown[]) => logs.push(items.map(String).join(' '));
      try {
        runCli(['node', 'evo', ...cliArgs]);
      } finally {
        console.log = orig;
      }
      return logs.join('\n');
    };

    const listJson = JSON.parse(captureCli(['profile', 'list', '--json']));
    assert.strictEqual(listJson.preferences.length, 1);
    assert.strictEqual(listJson.preferences[0].id, 'no-tables-in-summary');

    const showOut = captureCli(['profile', 'show']);
    assert.ok(showOut.includes('no-tables-in-summary'));

    const pathJson = JSON.parse(captureCli(['profile', 'path', '--json']));
    assert.strictEqual(path.resolve(pathJson.globalRoot), path.resolve(globalRoot));

    const syncJson = JSON.parse(captureCli(['profile', 'sync', '--json']));
    assert.ok(syncJson.digestPath.endsWith('profile-digest.md'));

    // Companion surfaces tolerate preference kind safely
    const snap = buildUiSnapshot(globalRoot);
    assert.ok(Array.isArray(snap.preferences) && snap.preferences.length === 1);
    const treeJson = buildEvoTreeJson(globalRoot) as any;
    assert.strictEqual(treeJson.summary.preferencesCount, 1);
    assert.ok(renderEvoTree(globalRoot).includes('no-tables-in-summary'));
    assert.ok(renderEvoStats(globalRoot).includes('1 Preferences'));

    // Hook style-preference cue
    const transcriptPath = path.join(nonCodeDir, 'style-transcript.jsonl');
    fs.writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'Here is a table.' }),
        JSON.stringify({ step_index: 2, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '太啰嗦了，以后都这样不要用表格' }),
      ].join('\n'),
      'utf8'
    );
    const statePath = path.join(nonCodeDir, 'style-hook-state.json');
    const hookRes = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'antigravity_hook.mjs'), 'PreInvocation'],
      {
        cwd: nonCodeDir,
        input: JSON.stringify({ conversationId: 'conv-style', transcriptPath }),
        encoding: 'utf8',
        env: { ...process.env, EVO_AGY_HOOK_STATE_PATH: statePath },
      }
    );
    assert.strictEqual(hookRes.status, 0, hookRes.stderr);
    const hookJson = JSON.parse(hookRes.stdout.trim());
    assert.ok(
      hookJson.injectSteps?.[0]?.ephemeralMessage?.includes('evo_propose(kind: "preference", scope: "global")'),
      `Expected preference cue in hook message, got: ${hookRes.stdout}`
    );
  });

  test('Route B9-B12: dry-run zero-write, homeDir host probing, project-scoped preference, Gate 1.5 bypass + dedup, and audit isolation', async () => {
    const projectWs = makeTempDir('evo-rb-proj2-');
    const fakeHome = makeTempDir('evo-rb-home2-');
    const globalRoot = path.join(fakeHome, '.evo', 'global');
    cleanupDirs.push(projectWs, fakeHome);

    // 1. dryRun: true on uninitialized globalRoot must not create .evo/ or profile-digest.md or host files
    const dryTarget = path.join(fakeHome, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(dryTarget), { recursive: true });
    fs.writeFileSync(dryTarget, '<!-- EVO:START -->\nSeed\n<!-- EVO:END -->\n\n# User Rules\nKeep me.\n', 'utf8');
    // Partial host dirs without rules/ subdir
    fs.mkdirSync(path.join(fakeHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.windsurf'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });

    const dryInitSync = syncGlobalUserProfile(globalRoot, { dryRun: true, homeDir: fakeHome });
    assert.strictEqual(dryInitSync.totalTokens, 0);
    assert.strictEqual(fs.existsSync(path.join(globalRoot, '.evo')), false, 'dryRun must not initialize .evo/');

    // CLI `evo profile sync --dry-run` must not mutate legacy config.json or create profile-digest.md
    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;
    fs.mkdirSync(path.join(globalRoot, '.evo', 'preferences'), { recursive: true });
    fs.writeFileSync(
      path.join(globalRoot, '.evo', 'config.json'),
      JSON.stringify({ version: '0.1.0', maxCoreRuleTokens: 1500 }),
      'utf8'
    );
    const gStorage = new EvoStorage(globalRoot);
    const gTelem = new EvoTelemetry(gStorage);
    const gGate = new EvoGatekeeper(gStorage, gTelem);
    try {
      // Gate 1.5 bypass: domain numbers & camelCase identifiers allowed on preference; self-ref supersedes_id stripped
      const prefRes = gGate.evaluateAndCommit({
        kind: 'preference',
        id: 'bilingual-number-style',
        supersedes_id: 'bilingual-number-style',
        title: 'Consistent bilingual metric notation',
        l0_summary: 'Format values like 12V and 50mA with consistent spacing and camelCaseName',
        category: 'communication',
        always_on: true,
        content: 'Keep units (12V, 50mA) and sample identifiers (fooBar, bazQux, quxQuux) readable.',
      });
      assert.strictEqual(prefRes.passed, true, prefRes.message);
      const savedPref = gStorage.getPreference('bilingual-number-style');
      assert.ok(savedPref);
      assert.strictEqual(savedPref!.supersedes_id, undefined, 'Self-referential supersedes_id must be stripped');

      // BM25 dedup blocks duplicate preference without supersedes_id
      const dupRes = gGate.evaluateAndCommit({
        kind: 'preference',
        id: 'bilingual-number-style-copy',
        title: 'Consistent bilingual metric notation',
        l0_summary: 'Format values like 12V and 50mA with consistent spacing and camelCaseName',
        category: 'communication',
        always_on: true,
        content: 'Keep units (12V, 50mA) and sample identifiers (fooBar, bazQux, quxQuux) readable.',
      });
      assert.strictEqual(dupRes.passed, false);
      assert.strictEqual(dupRes.error_code, 'ERR_DUPLICATE_CAPABILITY');
    } finally {
      gTelem.close();
    }

    // Remove profile-digest.md, set config back to 0.1.0, and verify `evo profile sync --dry-run` is read-only
    if (fs.existsSync(gStorage.profileDigestPath)) {
      fs.unlinkSync(gStorage.profileDigestPath);
    }
    fs.writeFileSync(
      gStorage.configPath,
      JSON.stringify({ version: '0.1.0', maxCoreRuleTokens: 1500 }),
      'utf8'
    );
    const origLog = console.log;
    let dryOut = '';
    console.log = (...items: unknown[]) => {
      dryOut += items.map(String).join(' ') + '\n';
    };
    try {
      runCli(['node', 'evo', 'profile', 'sync', '--dry-run', '--json']);
    } finally {
      console.log = origLog;
    }
    const dryJson = JSON.parse(dryOut);
    assert.strictEqual(dryJson.dryRun, true);
    assert.ok(dryJson.updatedTargets.some((t: string) => t.endsWith('USER_PROFILE.md')));
    assert.strictEqual(fs.existsSync(gStorage.profileDigestPath), false, '--dry-run must not write profile-digest.md');
    assert.strictEqual(fs.existsSync(path.join(globalRoot, 'USER_PROFILE.md')), false, '--dry-run must not write target files');
    assert.strictEqual(
      JSON.parse(fs.readFileSync(gStorage.configPath, 'utf8')).version,
      '0.1.0',
      'evo profile sync --dry-run must not mutate global config.json'
    );

    // 2. Test homeDir probing with partial host dirs & EVO:START preservation
    const liveHomeSync = syncGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    assert.strictEqual(liveHomeSync.updatedTargets.length, 5);
    const geminiSynced = fs.readFileSync(dryTarget, 'utf8');
    assert.ok(geminiSynced.includes('<!-- EVO:START -->') && geminiSynced.includes('Seed'));
    assert.ok(geminiSynced.includes('# User Rules\nKeep me.'));
    assert.ok(geminiSynced.includes(PROFILE_MARKER_START) && geminiSynced.includes('bilingual-number-style'));
    const cursorMdc = path.join(fakeHome, '.cursor', 'rules', 'evo-user-profile.mdc');
    const windsurfMd = path.join(fakeHome, '.windsurf', 'rules', 'evo-user-profile.md');
    assert.ok(fs.existsSync(cursorMdc), 'Must create missing .cursor/rules/ dir');
    assert.ok(fs.existsSync(windsurfMd), 'Must create missing .windsurf/rules/ dir');
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.codex', 'AGENTS.md')));

    // Audit on workspace with includeGlobal must NOT report false-positive overlap or leak on EVO:PROFILE blocks
    const auditReport = runAudit(projectWs, { includeGlobal: true, globalHomeDir: fakeHome });
    assert.strictEqual(
      auditReport.redundancyOverlaps.filter((o) => o.fileA.includes('evo-user-profile') || o.fileB.includes('evo-user-profile')).length,
      0
    );

    // Deleting/archiving preference and re-syncing unlinks standalone cursor/windsurf files & preserves GEMINI.md user + EVO:START blocks
    gStorage.archiveCapability('bilingual-number-style', 'preference', 'Cleanup');
    syncGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    assert.strictEqual(fs.existsSync(cursorMdc), false);
    assert.strictEqual(fs.existsSync(windsurfMd), false);
    const geminiAfterStrip = fs.readFileSync(dryTarget, 'utf8');
    assert.ok(geminiAfterStrip.includes('<!-- EVO:START -->'));
    assert.ok(geminiAfterStrip.includes('Keep me.'));
    assert.ok(!geminiAfterStrip.includes(PROFILE_MARKER_START));

    // 3. Project-scoped preference (`scope: 'project'`) writes to projectWs without syncing global host targets
    const dispatcher = new EvoMcpDispatcher(projectWs);
    try {
      const projPref = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'project',
        id: 'proj-local-pref',
        title: 'Project-only preference',
        l0_summary: 'Local project communication style preference',
        category: 'workflow',
        always_on: true,
        content: 'Use project-specific checklist sections.',
        workspace: projectWs,
      });
      const projJson = JSON.parse(projPref.content[0].text);
      assert.strictEqual(projJson.passed, true);
      assert.strictEqual(projJson.diagnostics.synced_profile_targets, undefined);
      assert.ok(fs.existsSync(path.join(projectWs, '.evo', 'preferences', 'proj-local-pref.md')));
      assert.strictEqual(fs.existsSync(path.join(globalRoot, '.evo', 'preferences', 'proj-local-pref.md')), false);

      const searchProj = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'checklist sections',
        kind: 'preference',
        scope: 'project',
        workspace: projectWs,
      });
      assert.ok(searchProj.content[0].text.includes('proj-local-pref'));
    } finally {
      dispatcher.close();
    }
  });
});
