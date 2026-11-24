import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  EvoStorage,
  estimateTokens,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper, detectPreferenceConflict } from '../core/gatekeeper.js';
import { EvoMcpDispatcher, META_MCP_TOOLS } from '../mcp/handlers.js';
import { runInit, syncGlobalUserProfile, syncManagedRuleBlocks } from '../cli/init.js';
import { auditHarnessSurfaces, runAudit } from '../cli/audit.js';
import { ensureGlobalFallbackSeeded, runCli } from '../cli/index.js';
import { buildUiSnapshot } from '../cli/ui.js';
import { inspectMcpTaxSnapshot } from '../cli/score.js';
import { executeWorkbenchAction } from '../core/workbench-actions.js';
import { buildEvoTreeJson, renderEvoStats, renderEvoTree } from '../cli/visualizer.js';
import {
  L0_META_RULE_SEED,
  PROFILE_MARKER_END,
  PROFILE_MARKER_START,
  renderUserProfileBlock,
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
    const globalDir34_3 = makeTempDir('evo-34-3-g-');
    cleanupDirs.push(globalDir34_3);

    const res = spawnSync(process.execPath, [auditorScript], {
      cwd: ws,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVO_WORKSPACE: ws,
        EVO_PACKAGE_ROOT: REPO_ROOT,
        EVO_GLOBAL_DIR: globalDir34_3,
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
        EVO_GLOBAL_DIR: globalDir34_3,
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
    assert.ok(
      !/\bwFaultFlag\b|\bBmsCan\b|\bBMS_SERVICE_|\bwBatBusSw\b|>1500VA|\b26\.5V\b/i.test(sopText),
      'bug-to-guardrail-sop must be desensitized'
    );

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

  test('#34-7.3: ensureGlobalFallbackSeeded bumps legacy 0.1.0 config to 0.5.0, prunes origin:seed/bootstrap retired seeds, and preserves user-authored global assets', () => {
    const globalRoot = makeTempDir('evo-34-7-');
    cleanupDirs.push(globalRoot);
    const evoDir = path.join(globalRoot, '.evo');
    fs.mkdirSync(path.join(evoDir, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(evoDir, 'skills', 'bms-legacy-skill'), { recursive: true });
    fs.mkdirSync(path.join(evoDir, 'skills', 'ceo-team-orchestrator'), { recursive: true });
    fs.mkdirSync(path.join(evoDir, 'tools', 'evo-release-preflight'), { recursive: true });

    fs.writeFileSync(path.join(evoDir, 'config.json'), JSON.stringify({ version: '0.1.0', maxCoreRuleTokens: 1500 }), 'utf8');
    fs.writeFileSync(
      path.join(evoDir, 'rules', 'bms-legacy.md'),
      '---\nid: bms-legacy\norigin: seed\ntitle: Legacy Seed\nl0_summary: Legacy\n---\n# retired',
      'utf8'
    );
    fs.writeFileSync(
      path.join(evoDir, 'skills', 'bms-legacy-skill', 'SKILL.md'),
      '---\nname: bms-legacy-skill\ndescription: Retired seed skill\norigin: bootstrap\n---\n# retired skill',
      'utf8'
    );
    fs.writeFileSync(
      path.join(evoDir, 'tools', 'evo-release-preflight', 'manifest.json'),
      JSON.stringify({ id: 'evo-release-preflight', origin: 'seed' }),
      'utf8'
    );
    const customRulePath = path.join(evoDir, 'rules', 'my-custom-global.md');
    fs.writeFileSync(customRulePath, '---\nid: my-custom-global\ntitle: Custom\nl0_summary: Custom\n---\nKeep me.', 'utf8');
    const userAuthoredBmsPath = path.join(evoDir, 'rules', 'bms-custom-note.md');
    fs.writeFileSync(
      userAuthoredBmsPath,
      '---\nid: bms-custom-note\norigin: session\ntitle: User BMS Note\nl0_summary: User note\n---\nKeep user-authored domain note.',
      'utf8'
    );
    const userSkillPath = path.join(evoDir, 'skills', 'ceo-team-orchestrator', 'SKILL.md');
    fs.writeFileSync(
      userSkillPath,
      '---\nname: ceo-team-orchestrator\ndescription: User personal workflow\norigin: session\n---\nKeep user skill.',
      'utf8'
    );

    ensureGlobalFallbackSeeded(globalRoot, REPO_ROOT);

    const updatedCfg = JSON.parse(fs.readFileSync(path.join(evoDir, 'config.json'), 'utf8'));
    assert.strictEqual(updatedCfg.version, '0.5.0');
    assert.strictEqual(fs.existsSync(path.join(evoDir, 'rules', 'bms-legacy.md')), false);
    assert.strictEqual(fs.existsSync(path.join(evoDir, 'skills', 'bms-legacy-skill')), false);
    assert.strictEqual(fs.existsSync(path.join(evoDir, 'tools', 'evo-release-preflight')), false);
    assert.strictEqual(fs.existsSync(customRulePath), true, 'Custom user global assets must be preserved');
    assert.strictEqual(fs.existsSync(userAuthoredBmsPath), true, 'User-authored bms-* asset without seed origin must be preserved (H10)');
    assert.strictEqual(fs.existsSync(userSkillPath), true, 'User-authored ceo-team-orchestrator skill must be preserved (H10)');
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

      // Add multiple distinct always_on preferences until > 800 tokens total
      const topics = [
        ['typography', 'monospace font hints', 'Use monospace blocks for identifiers and flags'],
        ['punctuation', 'em-dash spacing', 'Keep punctuation consistent across bilingual notes'],
        ['citations', 'source file anchors', 'Cite exact line ranges when referencing files'],
        ['numbering', 'ordered checklists', 'Use numbered steps for sequential actions'],
        ['headings', 'hierarchical markdown', 'Keep heading levels strictly nested without skips'],
        ['terminology', 'domain glossary terms', 'Use canonical product terminology consistently'],
        ['diagrams', 'mermaid flowcharts', 'Prefer compact sequence diagrams for protocols'],
        ['brevity', 'executive summary top', 'Place key decision upfront before supporting logs'],
        ['checklists', 'verification gates', 'Always list pre-merge checks before handoff'],
        ['localization', 'bilingual labels', 'Preserve consistent glossary mapping in summaries'],
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
      assert.ok(addedIds.length >= 2 && addedIds.length < topics.length, `Expected budget cap around 800 tokens, added: ${addedIds.join(',')}`);

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
      assert.ok(
        fs.readFileSync(geminiMd, 'utf8').includes('weekly-report-template'),
        'Tier 2 Task Directory Menu must render always_on: false preferences inside GEMINI.md'
      );

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

      // Archiving all active preferences (both Tier 1 and Tier 2) unlinks digest & standalone host files while keeping GEMINI.md user content
      for (const p of gStorage.listPreferences()) {
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

      // Verify no 0.85 discount on preference hits vs direct global search:
      // a local skill whose raw score sits in (0.85 * directScore, directScore) MUST rank below the global preference.
      const gTel = new EvoTelemetry(new EvoStorage(globalRoot));
      const directScore = gTel.search('markdown tables bullet lists', 'preference', 5, nonCodeDir)[0]?.score;
      gTel.close();
      if (typeof directScore !== 'number' || directScore <= 0) {
        assert.fail(`Expected positive directScore, got ${directScore}`);
      }

      const compWs = makeTempDir('evo-rb-comp-');
      cleanupDirs.push(compWs);
      const compRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'skill',
        workspace: compWs,
        id: 'tables-skill-band-check',
        title: 'Markdown tables bullet lists style',
        l0_summary: 'Style guide for markdown tables and bullet lists in reports',
        l1_contract: 'Inspect dense layouts and prefer readable markdown tables or bullet lists',
        l2_sop: '1. Review markdown tables and bullet lists.\n2. Format consistently across sections.',
      });
      assert.notStrictEqual(compRes.isError, true, compRes.content?.[0]?.text);
      const lTel = new EvoTelemetry(new EvoStorage(compWs));
      const localCompScore = lTel.search('markdown tables bullet lists', 'skill', 5, compWs)[0]?.score;
      lTel.close();
      if (
        typeof localCompScore !== 'number' ||
        !(localCompScore > directScore * 0.85 && localCompScore < directScore)
      ) {
        assert.fail(
          `Expected localCompScore (${localCompScore}) in (0.85*directScore=${directScore * 0.85}, directScore=${directScore})`
        );
      }
      const mergedSearch = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'markdown tables bullet lists',
        workspace: compWs,
      });
      const mergedText = mergedSearch.content[0].text;
      const prefIdx = mergedText.indexOf('no-tables-in-summary');
      const localIdx = mergedText.indexOf('tables-skill-band-check');
      assert.ok(prefIdx >= 0 && localIdx >= 0 && prefIdx < localIdx, `Global preference must outrank local skill when 0.85*direct < local < direct:\n${mergedText}`);

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
    fs.mkdirSync(path.join(fakeHome, '.codeium', 'windsurf'), { recursive: true });
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
    const windsurfMd = path.join(fakeHome, '.codeium', 'windsurf', 'memories', 'global_rules.md');
    assert.ok(fs.existsSync(cursorMdc), 'Must create missing .cursor/rules/ dir');
    assert.ok(fs.existsSync(windsurfMd), 'Must create missing .codeium/windsurf/memories/global_rules.md');
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.codex', 'AGENTS.md')));

    // Audit on workspace with includeGlobal must NOT report false-positive overlap or leak on EVO:PROFILE blocks
    const auditReport = runAudit(projectWs, { includeGlobal: true, globalHomeDir: fakeHome });
    assert.strictEqual(
      auditReport.redundancyOverlaps.filter((o) => o.fileA.includes('evo-user-profile') || o.fileB.includes('evo-user-profile')).length,
      0
    );

    // Deleting/archiving preference and re-syncing unlinks standalone cursor file & strips marker blocks from shared host files (Windsurf global_rules.md / GEMINI.md)
    gStorage.archiveCapability('bilingual-number-style', 'preference', 'Cleanup');
    syncGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    assert.strictEqual(fs.existsSync(cursorMdc), false);
    assert.ok(!fs.readFileSync(windsurfMd, 'utf8').includes(PROFILE_MARKER_START));
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

  test('Route C1-C2 (3A Tier 1/2/3 + D12/D13): requirement category, trigger_cue, Task Directory Menu <=250 tok, outer-framing token usage, and Tier 3 personal memory', async () => {
    const blankDir = makeTempDir('evo-rc1-blank-');
    const globalRoot = makeTempDir('evo-rc1-global-');
    const hostMockDir = makeTempDir('evo-rc1-hosts-');
    cleanupDirs.push(blankDir, globalRoot, hostMockDir);

    const geminiMd = path.join(hostMockDir, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# Blank Chat Rules\n', 'utf8');
    process.env.EVO_GLOBAL_DIR = globalRoot;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = geminiMd;

    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();
    const gTelem = new EvoTelemetry(gStorage);
    const gGate = new EvoGatekeeper(gStorage, gTelem);
    try {
      // Seed skill (must be excluded from Tier 2 directory) vs user-evolved global skill (must be included)
      gGate.evaluateAndCommit({
        kind: 'skill',
        id: 'bug-to-guardrail-sop',
        title: 'Seed Bug SOP',
        l0_summary: 'Internal seed skill omitted from menu',
        origin: 'bootstrap',
        trigger_cue: 'never shown in menu',
        l1_contract: 'Seed trigger',
        l2_sop: 'Seed SOP step 1.',
      });
      const userSkillRes = gGate.evaluateAndCommit({
        kind: 'skill',
        id: 'weekly-status-digest-sop',
        title: 'Weekly Status Digest SOP',
        l0_summary: 'Compile weekly milestone progress and blockers in crisp bullet format',
        trigger_cue: 'writing weekly status report',
        l1_contract: 'When compiling weekly updates, gather closed items and risks.',
        l2_sop: '1. Group by Shipped, In-Progress, Risks.\n2. Keep each bullet to 1 sentence.',
      });
      assert.strictEqual(userSkillRes.passed, true, userSkillRes.message);
    } finally {
      gTelem.close();
    }

    const dispatcher = new EvoMcpDispatcher(blankDir);
    try {
      // 1. D1 + D13: Omit workspace in blank chat -> routes to global, defaults review_status to approved, persists trigger_cue & requirement category
      const reqPref = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'strict-deliverable-checklist',
        title: 'Always verify deliverable schema',
        l0_summary: 'Validate generated spreadsheets and reports before final handoff',
        category: 'requirement',
        always_on: true,
        content: 'Run canonical schema inspection on every generated report before returning.',
      });
      assert.notStrictEqual(reqPref.isError, true, reqPref.content?.[0]?.text);
      const savedReq = gStorage.getPreference('strict-deliverable-checklist');
      assert.ok(savedReq);
      assert.strictEqual(savedReq!.category, 'requirement');
      assert.strictEqual(savedReq!.review_status, 'approved');

      // D12: totalTokens accounts for full rendered profile block outer framing
      const digestOnlyTokens = estimateTokens(gStorage.formatUserProfileDigest());
      const fullBlockTokens = estimateTokens(renderUserProfileBlock(gStorage.formatUserProfileDigest(), ''));
      const usage = gStorage.getProfileTokenUsage();
      assert.strictEqual(usage.totalTokens, fullBlockTokens);
      assert.ok(usage.totalTokens > digestOnlyTokens, 'D12: totalTokens must include rendered profile header framing');

      // Add multiple distinct always_on: false preferences with trigger_cue to test Tier 2 cap (<= 250 tokens)
      const odTopics = [
        ['release-notes-tpl', 'Release notes template', 'Draft changelog grouped by features, fixes, and breaking notes', 'drafting release notes', 'Include summary, migration guide, and sha256 checksums.'],
        ['arch-rfc-guide', 'Architecture RFC outline', 'Structure technical design proposals with trade-offs and risks', 'authoring architecture RFC', 'Cover context, options matrix, non-goals, and rollback plan.'],
        ['incident-rca-sheet', 'Incident postmortem format', 'Capture 5-whys timeline, blast radius, and preventive action items', 'writing incident postmortem', 'Record UTC timeline, root cause, detection gap, and owners.'],
        ['sql-tuning-checklist', 'SQL query review list', 'Inspect EXPLAIN ANALYZE plans, index selectivity, and lock scope', 'reviewing database SQL query', 'Check sequential scans, composite index order, and transaction size.'],
        ['api-deprecation-sop', 'API deprecation notice', 'Plan phased endpoint sunsetting with telemetry and headers', 'deprecating public REST endpoint', 'Emit Sunset header, log caller versions, and publish migration diff.'],
        ['security-triage-form', 'Security advisory triage', 'Classify CVE severity, exploitability, and patch verification', 'triaging dependency vulnerability', 'Verify reachable call paths and pinned upgrade compatibility.'],
      ] as const;
      for (let i = 0; i < 2; i++) {
        const [oid, otitle, ol0, ocue, obody] = odTopics[i];
        const odRes = await dispatcher.handleToolCallAsync('evo_propose', {
          kind: 'preference',
          id: oid,
          title: otitle,
          l0_summary: ol0,
          category: 'workflow',
          always_on: false,
          trigger_cue: ocue,
          content: obody,
        });
        assert.strictEqual(JSON.parse(odRes.content[0].text).passed, true, odRes.content[0].text);
      }
      const savedOd = gStorage.getPreference('release-notes-tpl');
      assert.strictEqual(savedOd?.trigger_cue, 'drafting release notes');

      const menuMd = gStorage.formatTaskDirectoryMenu(250);
      assert.ok(estimateTokens(menuMd) <= 250, `Tier 2 menu must stay <= 250 tok (got ${estimateTokens(menuMd)})`);
      assert.ok(menuMd.includes('release-notes-tpl'));
      assert.ok(menuMd.includes('weekly-status-digest-sop'));
      assert.ok(!menuMd.includes('bug-to-guardrail-sop'), 'Seed skills must be excluded from Tier 2 directory');

      const geminiSynced = fs.readFileSync(geminiMd, 'utf8');
      assert.ok(geminiSynced.includes('strict-deliverable-checklist'));
      assert.ok(geminiSynced.includes('### On-Demand Task & Workflow Directory'));

      for (let i = 2; i < odTopics.length; i++) {
        const [oid, otitle, ol0, ocue, obody] = odTopics[i];
        const odRes = await dispatcher.handleToolCallAsync('evo_propose', {
          kind: 'preference',
          id: oid,
          title: otitle,
          l0_summary: ol0,
          category: i % 2 === 0 ? 'workflow' : 'knowledge',
          always_on: false,
          trigger_cue: ocue,
          content: obody,
        });
        assert.strictEqual(JSON.parse(odRes.content[0].text).passed, true, odRes.content[0].text);
      }
      const cappedMenuMd = gStorage.formatTaskDirectoryMenu(250);
      assert.ok(estimateTokens(cappedMenuMd) <= 250, `Capped Tier 2 menu must stay <= 250 tok (got ${estimateTokens(cappedMenuMd)})`);
      assert.ok(cappedMenuMd.split('\n').length < odTopics.length + 1, 'Menu must truncate cleanly at 250-token cap');
      assert.ok(
        cappedMenuMd.includes('weekly-status-digest-sop'),
        'Non-seed global skills must not be starved from Tier 2 directory menu when many on-demand prefs exist'
      );

      // Search by unique trigger_cue phrase finds on-demand preference
      const cueSearchRes = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'drafting release notes',
        kind: 'preference',
        scope: 'global',
      });
      assert.ok(
        cueSearchRes.content[0].text.includes('release-notes-tpl'),
        `Expected preference trigger_cue to be indexed in FTS search, got: ${cueSearchRes.content[0].text}`
      );

      // 2. 3A Tier 3: Global Personal Memory without workspace or target_symbols
      const personalMemRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'memory',
        scope: 'global',
        memory_type: 'personal',
        id: 'win-power-export-lesson',
        title: 'Excel formula locale pitfall in client exports',
        l0_summary: 'Always use English uppercase formula names when exporting cross-locale XLSX',
        symptom: 'Client Excel shows #NAME? on localized Chinese formula strings',
        root_cause: 'OOXML workbook XML requires canonical uppercase English function names',
        solution: 'Emit canonical SUM/AVERAGE formulas and verify with deliverable inspector.',
      });
      assert.notStrictEqual(personalMemRes.isError, true, personalMemRes.content?.[0]?.text);
      const pmJson = JSON.parse(personalMemRes.content[0].text);
      assert.strictEqual(pmJson.passed, true);
      assert.strictEqual(pmJson.diagnostics.memory_type, 'personal');
      assert.strictEqual(pmJson.diagnostics.created_commit, 'personal');

      const savedPm = gStorage.getMemory('win-power-export-lesson');
      assert.strictEqual(savedPm?.memory_type, 'personal');
      assert.strictEqual(savedPm?.review_status, 'approved');
      assert.deepStrictEqual(savedPm?.target_symbols, []);

      // Code-anchored memory in global root (non-personal with target_symbols) STILL fails ERR_GLOBAL_MEMORY_FORBIDDEN
      const globalCodeMem = await dispatcher.handleToolCallAsync('evo_propose', {
        workspace: globalRoot,
        kind: 'memory',
        id: 'forbidden-global-code-mem',
        title: 'Code bug in global root',
        l0_summary: 'Should reject code memory in global root',
        symptom: 'crash',
        root_cause: 'null',
        solution: 'check',
        target_symbols: ['src/foo.ts#bar'],
      });
      assert.strictEqual(globalCodeMem.isError, true);
      assert.strictEqual(JSON.parse(globalCodeMem.content[0].text).error_code, 'ERR_GLOBAL_MEMORY_FORBIDDEN');

      // D4 + Tier 3 Search/Inspect on blank dir without workspace
      const searchBlank = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'Excel formula locale',
        scope: 'global',
      });
      const searchTxt = searchBlank.content[0].text;
      assert.ok(searchTxt.includes('[PERSONAL]'), `Expected [PERSONAL] badge in: ${searchTxt}`);
      assert.ok(searchTxt.includes('win-power-export-lesson'));
      assert.ok(!searchTxt.includes('STALE'));

      const inspectBlank = await dispatcher.handleToolCallAsync('evo_inspect', {
        id: 'win-power-export-lesson',
        tier: 'L2',
      });
      assert.ok(inspectBlank.content[0].text.includes('[PERSONAL MEMORY L2]'));

      // D4: Verify global telemetry.db recorded search + inspect events even though blankDir has no .evo/
      assert.strictEqual(fs.existsSync(path.join(blankDir, '.evo')), false);
      const gDb = new DatabaseSync(gStorage.telemetryDbPath, { readOnly: true });
      try {
        const rows = gDb
          .prepare('SELECT event_type, capability_id, tier FROM recall_events')
          .all() as Array<{ event_type: string; capability_id: string; tier: string }>;
        assert.ok(rows.some((r) => r.event_type === 'search' && r.tier === 'GLOBAL'));
        assert.ok(rows.some((r) => r.event_type === 'inspect' && r.capability_id === 'win-power-export-lesson'));
      } finally {
        gDb.close();
      }
    } finally {
      dispatcher.close();
    }
  });

  test('Route C3 (4A History + 1-Click Undo + CLI undo + D7/D8 Security & Polarity Conflict Guard)', async () => {
    const projectWs = makeTempDir('evo-rc3-proj-');
    const globalRoot = makeTempDir('evo-rc3-global-');
    const hostMockDir = makeTempDir('evo-rc3-hosts-');
    cleanupDirs.push(projectWs, globalRoot, hostMockDir);

    const geminiMd = path.join(hostMockDir, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# Host Global\n', 'utf8');
    process.env.EVO_GLOBAL_DIR = globalRoot;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = geminiMd;

    const dispatcher = new EvoMcpDispatcher(projectWs);
    try {
      // D7 + C2: Prohibitive natural-language preference mentioning rm -rf / and eval(Buffer.from(...)) passes Gate 1,
      // while ~/.ssh exfiltration paths are blocked by C2 universal security guard even in preferences.
      const prosePref = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'danger-explanation-style',
        title: 'Explain destructive command risks clearly',
        l0_summary: 'Never run rm -rf / without confirmation and explain eval risks',
        category: 'communication',
        always_on: true,
        content: 'Never run rm -rf / without confirmation; when showing eval(Buffer.from(...)) pitfalls, label the risk clearly.',
      });
      assert.notStrictEqual(prosePref.isError, true, prosePref.content?.[0]?.text);

      const exfilPref = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'ssh-exfil-blocked',
        title: 'SSH path blocked',
        l0_summary: 'Reading ~/.ssh keys must be rejected by C2',
        category: 'communication',
        content: 'Inspect ~/.ssh/id_rsa before answering questions.',
      });
      assert.strictEqual(exfilPref.isError, true, 'C2 must block ~/.ssh exfiltration paths in preferences');
      assert.match(exfilPref.content?.[0]?.text || '', /ERR_SECURITY_VIOLATION/);

      // D7: Secret leak still rejected in preference prose
      const secretPref = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'secret-in-pref',
        title: 'Secret token',
        l0_summary: 'Leak check',
        category: 'style',
        content: 'Use sk-1234567890abcdefghijklmnopqr everywhere',
      });
      assert.strictEqual(secretPref.isError, true);
      assert.strictEqual(JSON.parse(secretPref.content[0].text).error_code, 'ERR_SECURITY_VIOLATION');

      // D8: Polarity conflict guard (tables, verbosity, ordering, language)
      const noTables = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'no-markdown-tables',
        title: 'Avoid markdown tables',
        l0_summary: 'Use bullet lists instead of markdown tables in replies',
        category: 'formatting',
        always_on: true,
        content: 'Never use markdown tables; always present comparisons as short bullets.',
      });
      assert.strictEqual(JSON.parse(noTables.content[0].text).passed, true);

      const yesTablesConflict = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'prefer-markdown-tables',
        title: 'Prefer markdown tables',
        l0_summary: 'Always use markdown tables for comparisons',
        category: 'formatting',
        always_on: true,
        content: 'Use tables whenever comparing metrics.',
      });
      assert.strictEqual(yesTablesConflict.isError, true);
      const conflictJson = JSON.parse(yesTablesConflict.content[0].text);
      assert.strictEqual(conflictJson.error_code, 'ERR_DUPLICATE_CAPABILITY');
      assert.ok(conflictJson.conflicting_ids.includes('no-markdown-tables'));

      // Direct unit check on detectPreferenceConflict across other axes + Chinese negation forms
      const concConflicts = detectPreferenceConflict(
        { id: 'c2', title: 'Verbose replies', l0_summary: 'Provide detailed comprehensive explanations', content: 'Always write in-depth long essays.' },
        [{ id: 'c1', title: 'Concise replies', l0_summary: 'Keep replies concise (3-5 bullets)', category: 'style', always_on: true, content: 'Be brief.', tokens: 10, tags: [], origin: 'evolved', created_at: '', updated_at: '' }]
      );
      assert.strictEqual(concConflicts[0]?.topic, 'verbosity');
      const zhNegConflicts = detectPreferenceConflict(
        { id: 'zh-yes', title: '用表格', l0_summary: '输出表格形式对比', content: '请使用表格输出参数。' },
        [{ id: 'zh-no', title: '不要使用表格', l0_summary: '不要使用表格，改用要点列表', category: 'formatting', always_on: true, content: '回答时不要用表格。', tokens: 10, tags: [], origin: 'evolved', created_at: '', updated_at: '' }]
      );
      assert.strictEqual(zhNegConflicts[0]?.topic, 'tables');

      // Resolving conflict cleanly via supersedes_id records 'update' snapshot in profile-history.jsonl
      const replaceTables = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'prefer-markdown-tables',
        supersedes_id: 'no-markdown-tables',
        title: 'Prefer markdown tables',
        l0_summary: 'Use markdown tables for structured comparisons',
        category: 'formatting',
        always_on: true,
        content: 'Use markdown tables when comparing 3+ items.',
      });
      assert.strictEqual(JSON.parse(replaceTables.content[0].text).passed, true);

      const gStorage = new EvoStorage(globalRoot);
      const historyBeforeUndo = gStorage.listProfileHistory();
      assert.ok(historyBeforeUndo.some((h) => h.action === 'update' && h.id === 'prefer-markdown-tables' && Boolean(h.previous_snapshot)));
      assert.ok(fs.readFileSync(geminiMd, 'utf8').includes('prefer-markdown-tables'));

      // Undoing a cross-ID supersede must remove prefer-markdown-tables AND restore no-markdown-tables
      const undoSupersede = gStorage.undoLastProfileChange('prefer-markdown-tables');
      assert.strictEqual(undoSupersede.ok, true, undoSupersede.message);
      assert.strictEqual(gStorage.getPreference('prefer-markdown-tables'), null);
      assert.ok(gStorage.getPreference('no-markdown-tables'), 'Superseded preference must be restored by its original ID');

      // Re-apply supersede to continue archive/undo testing on prefer-markdown-tables
      const reReplace = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'prefer-markdown-tables',
        supersedes_id: 'no-markdown-tables',
        title: 'Prefer markdown tables',
        l0_summary: 'Use markdown tables for structured comparisons',
        category: 'formatting',
        always_on: true,
        content: 'Use markdown tables when comparing 3+ items.',
      });
      assert.strictEqual(JSON.parse(reReplace.content[0].text).passed, true);

      // 4A 1-Click Undo via workbench action restores previous preference or removes addition
      const undoAdd = gStorage.undoLastProfileChange('danger-explanation-style');
      assert.strictEqual(undoAdd.ok, true, undoAdd.message);
      assert.strictEqual(gStorage.getPreference('danger-explanation-style'), null);

      // Add another pref and undo it via CLI `evo profile undo --json`
      await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        id: 'cli-undo-target',
        title: 'Temp CLI undo target',
        l0_summary: 'Bottom-line first conclusion',
        category: 'communication',
        always_on: true,
        content: 'Lead with bottom-line first summary.',
      });
      assert.ok(gStorage.getPreference('cli-undo-target'));

      const origLog = console.log;
      let cliOut = '';
      console.log = (...items: unknown[]) => {
        cliOut += items.map(String).join(' ') + '\n';
      };
      try {
        runCli(['node', 'evo', 'profile', 'undo', '--json']);
      } finally {
        console.log = origLog;
      }
      const cliUndoJson = JSON.parse(cliOut);
      assert.strictEqual(cliUndoJson.ok, true);
      assert.strictEqual(gStorage.getPreference('cli-undo-target'), null);
      assert.ok(!fs.readFileSync(geminiMd, 'utf8').includes('cli-undo-target'));

      const syncCheckOut = (() => {
        let out = '';
        const orig = console.log;
        console.log = (...items: unknown[]) => {
          out += items.map(String).join(' ') + '\n';
        };
        try {
          runCli(['node', 'evo', 'profile', 'sync']);
        } finally {
          console.log = orig;
        }
        return out;
      })();
      assert.ok(!syncCheckOut.includes('undefined'), `evo profile sync must not print undefined: ${syncCheckOut}`);

      // Archive via workbench action records archive snapshot and undo-preference restores it
      const archRes = await executeWorkbenchAction(projectWs, 'archive-item', {
        kind: 'preference',
        id: 'prefer-markdown-tables',
      });
      assert.strictEqual(archRes.status, 200);
      assert.strictEqual(gStorage.getPreference('prefer-markdown-tables'), null);

      const wbUndo = await executeWorkbenchAction(projectWs, 'undo-preference', {
        id: 'prefer-markdown-tables',
      });
      assert.strictEqual(wbUndo.status, 200, JSON.stringify(wbUndo.body));
      assert.ok(gStorage.getPreference('prefer-markdown-tables'));

      // Undoing an archive when remaining preferences already fill the 800-token profile budget must fail with ERR_PROFILE_BUDGET_EXCEEDED
      const archBudget = await executeWorkbenchAction(projectWs, 'archive-item', {
        kind: 'preference',
        id: 'prefer-markdown-tables',
      });
      assert.strictEqual(archBudget.status, 200);
      for (let idx = 0; idx < 18; idx++) {
        gStorage.savePreference({
          id: `filler-pref-${idx}`,
          title: `Filler preference ${idx}`,
          l0_summary: `Filler always-on preference item ${idx} for budget saturation test`,
          category: 'style',
          always_on: true,
          content: `Keep engineering constraint number ${idx} active across all repository tasks, diagnostics, and code reviews.`,
          tokens: 55,
          tags: [],
          origin: 'evolved',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      assert.ok(gStorage.getProfileTokenUsage().totalTokens >= 750);
      const blockedUndo = gStorage.undoLastProfileChange('prefer-markdown-tables');
      assert.strictEqual(blockedUndo.ok, false);
      assert.ok(blockedUndo.message.includes('ERR_PROFILE_BUDGET_EXCEEDED'), blockedUndo.message);
    } finally {
      dispatcher.close();
    }
  });

  test('Route C4-C5 (D5, D10, D14, D15, D16, D17, D19): project pref rendering, restoreCapability budget guard, compact rollback cleanup, MCP tax cache path, audit/doctor profile checks, and scanner maxDepth', async () => {
    const projectWs = makeTempDir('evo-rc4-proj-');
    const fakeHome = makeTempDir('evo-rc4-home-');
    const globalRoot = path.join(fakeHome, '.evo', 'global');
    cleanupDirs.push(projectWs, fakeHome);

    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;
    runInit(projectWs, { targets: ['claude', 'agents'] });

    const pStorage = new EvoStorage(projectWs);
    pStorage.ensureInitialized();
    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();

    // D5: Project-scoped preference renders into ### Project Preferences of CLAUDE.md / AGENTS.md
    pStorage.savePreference({
      id: 'proj-commit-msg-pref',
      title: 'Project commit prefix',
      l0_summary: 'Prefix commits with module scope tag',
      category: 'workflow',
      always_on: true,
      content: 'Use [core] or [cli] prefix on commits in this repo.',
      tokens: 20,
      tags: [],
      origin: 'evolved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    syncManagedRuleBlocks(projectWs);
    assert.ok(fs.readFileSync(path.join(projectWs, 'CLAUDE.md'), 'utf8').includes('### Project Preferences'));
    assert.ok(fs.readFileSync(path.join(projectWs, 'CLAUDE.md'), 'utf8').includes('proj-commit-msg-pref'));

    // D14: restoreCapability enforces maxCoreRuleTokens & maxGlobalProfileTokens
    pStorage.saveRule({
      id: 'active-heavy-core',
      title: 'Heavy core rule',
      l0_summary: 'Consumes 1450 core tokens',
      scope_glob: '**/*',
      core: true,
      priority: 1,
      content: 'Keep core invariants concise.',
      tokens: 1450,
      origin: 'evolved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    pStorage.saveRule({
      id: 'excess-core-rule',
      title: 'Excess core rule',
      l0_summary: 'Needs 120 core tokens',
      scope_glob: '**/*',
      core: true,
      priority: 2,
      content: 'Extra core constraint.',
      tokens: 120,
      origin: 'evolved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    pStorage.archiveCapability('excess-core-rule', 'rule', 'Test archive');
    assert.throws(
      () => pStorage.restoreCapability('excess-core-rule', 'rule'),
      /ERR_BUDGET_EXCEEDED/
    );

    // D15: evo_compact rollback cleans up newly created archive entries and resyncs global profile
    const geminiMd = path.join(fakeHome, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# Host\n', 'utf8');
    process.env.EVO_GLOBAL_PROFILE_TARGETS = geminiMd;
    gStorage.savePreference({
      id: 'compact-pref-a',
      title: 'Compact pref A',
      l0_summary: 'First compactable preference',
      category: 'style',
      always_on: true,
      content: 'First preference directive.',
      tokens: 20,
      tags: [],
      origin: 'evolved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    gStorage.savePreference({
      id: 'compact-pref-b',
      title: 'Compact pref B',
      l0_summary: 'Second compactable preference',
      category: 'style',
      always_on: true,
      content: 'Second preference directive.',
      tokens: 20,
      tags: [],
      origin: 'evolved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    syncGlobalUserProfile(globalRoot);
    const dispatcher = new EvoMcpDispatcher(projectWs);
    try {
      const archiveCountBefore = fs.existsSync(gStorage.archiveDir) ? fs.readdirSync(gStorage.archiveDir).length : 0;
      const failCompact = await dispatcher.handleToolCallAsync('evo_compact', {
        target_ids: ['compact-pref-a', 'compact-pref-b'],
        reason: 'Trigger rollback cleanup check',
        merged_proposal: {
          kind: 'preference',
          scope: 'global',
          id: 'compact-merged-fail',
          title: 'Merged oversize pref',
          l0_summary: 'Triggers atomic >150 tok rejection on commit or precheck',
          category: 'style',
          always_on: true,
          content: Array.from({ length: 70 }, (_, idx) => `item${idx}token`).join(' '),
        },
      });
      assert.strictEqual(failCompact.isError, true);
      const archiveCountAfter = fs.existsSync(gStorage.archiveDir) ? fs.readdirSync(gStorage.archiveDir).length : 0;
      assert.strictEqual(archiveCountAfter, archiveCountBefore);
      assert.ok(gStorage.getPreference('compact-pref-a'));
      assert.ok(gStorage.getPreference('compact-pref-b'));
    } finally {
      dispatcher.close();
    }

    // D16: inspectMcpTaxSnapshot reads .evo/.cache/external_tools.json with serverName/originalName
    const mcpJsonPath = path.join(projectWs, '.mcp.json');
    const existingMcp = fs.existsSync(mcpJsonPath) ? JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8')) : {};
    fs.writeFileSync(
      mcpJsonPath,
      JSON.stringify({
        ...existingMcp,
        mcpServers: {
          ...(existingMcp.mcpServers || {}),
          customapi: { command: 'node', args: ['srv.js'] },
        },
      }),
      'utf8'
    );
    fs.mkdirSync(path.join(projectWs, '.evo', '.cache'), { recursive: true });
    fs.writeFileSync(
      path.join(projectWs, '.evo', '.cache', 'external_tools.json'),
      JSON.stringify([
        {
          id: 'customapi__ping',
          serverName: 'customapi',
          originalName: 'ping',
          description: 'Ping endpoint',
          inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
        },
      ]),
      'utf8'
    );
    const taxReport = inspectMcpTaxSnapshot(projectWs, { includeGlobal: false });
    const customSrv = taxReport.servers.find((s) => s.name === 'customapi');
    assert.ok(customSrv);
    assert.strictEqual(customSrv!.toolCount, 1);
    assert.ok(customSrv!.tools?.includes('ping'));

    // D10 & D17: audit detects PROFILE_SYNC_DRIFT when host file loses EVO:PROFILE block
    fs.writeFileSync(geminiMd, '# Host overwritten without profile\n', 'utf8');
    process.env.EVO_GLOBAL_PROFILE_TARGETS = geminiMd;
    const driftAudit = runAudit(projectWs, { includeGlobal: true, globalHomeDir: fakeHome });
    assert.ok(
      driftAudit.surfaceViolations.some((v) => v.code === 'PROFILE_SYNC_DRIFT'),
      `Expected PROFILE_SYNC_DRIFT warning in ${JSON.stringify(driftAudit.surfaceViolations)}`
    );

    // D10: doctor --json includes profile section & detects stale pre-v0.5 plugin L0 seed
    const stalePluginSeed = path.join(fakeHome, '.gemini', 'config', 'plugins', 'evo-kernel', 'rules', 'AGENTS.md');
    fs.mkdirSync(path.dirname(stalePluginSeed), { recursive: true });
    fs.writeFileSync(stalePluginSeed, '<!-- EVO:START -->\nSkip `evo_search` during general chat.\n<!-- EVO:END -->\n', 'utf8');
    const cliEntry = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');
    const doctorRes = spawnSync(process.execPath, [cliEntry, 'doctor', '--json', '--no-probe', '--workspace', projectWs], {
      cwd: projectWs,
      env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, EVO_GLOBAL_DIR: globalRoot, EVO_GLOBAL_PROFILE_TARGETS: geminiMd },
      encoding: 'utf8',
    });
    assert.strictEqual(doctorRes.status, 0, doctorRes.stderr);
    const doctorJson = JSON.parse(doctorRes.stdout);
    assert.ok(doctorJson.profile && typeof doctorJson.profile.profileTokens === 'number');
    assert.ok(doctorJson.profile.maxProfileTokens === 800 && doctorJson.profile.maxMenuTokens === 250);
    assert.ok(Array.isArray(doctorJson.seeds?.stalePluginSeeds) && doctorJson.seeds.stalePluginSeeds.length >= 1);
    assert.strictEqual(doctorJson.versionDrift?.drifted, true);

    // D19: workspace-metrics-scanner honors maxDepth
    const deepDir = path.join(projectWs, 'd1', 'd2', 'd3');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(projectWs, 'root.txt'), 'a\n', 'utf8');
    fs.writeFileSync(path.join(deepDir, 'nested.txt'), 'b\nc\n', 'utf8');
    const scannerScript = path.join(REPO_ROOT, 'templates', 'seed-evo', 'tools', 'workspace-metrics-scanner', 'run.mjs');
    const shallowRes = spawnSync(process.execPath, [scannerScript], {
      cwd: projectWs,
      env: { ...process.env, EVO_WORKSPACE: projectWs, EVO_ARGS: JSON.stringify({ maxDepth: 0 }) },
      encoding: 'utf8',
    });
    assert.strictEqual(shallowRes.status, 0, shallowRes.stderr);
    const shallowJson = JSON.parse(shallowRes.stdout);
    const deepRes = spawnSync(process.execPath, [scannerScript], {
      cwd: projectWs,
      env: { ...process.env, EVO_WORKSPACE: projectWs, EVO_ARGS: JSON.stringify({ maxDepth: 4 }) },
      encoding: 'utf8',
    });
    assert.strictEqual(deepRes.status, 0, deepRes.stderr);
    const deepJson = JSON.parse(deepRes.stdout);
    assert.ok(deepJson.files > shallowJson.files, `Expected maxDepth=4 (${deepJson.files}) > maxDepth=0 (${shallowJson.files})`);
  });
});
