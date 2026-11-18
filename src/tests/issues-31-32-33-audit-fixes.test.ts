import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { EvoStorage, openSqliteReadOnly, estimateTokens } from '../core/storage.js';
import { EvoTelemetry, readRecallWindowStatsFromDb } from '../core/telemetry.js';
import {
  EvoGatekeeper,
  captureWorkspaceRollbackSnapshot,
  restoreWorkspaceFromSnapshot,
} from '../core/gatekeeper.js';
import { verifyMemoryFreshness, resolveCurrentGitCommit } from '../core/memory.js';
import { EvoMcpDispatcher } from '../mcp/handlers.js';
import { handlePostTool, handleStop, recordRecalledOutcomeWithTierRouting } from '../cli/hook.js';
import { buildEvoStatsJson } from '../cli/visualizer.js';
import { handleWebviewAction } from '../ide/vscode-extension.js';
import { L0_META_RULE_SEED } from '../templates/meta-rule.js';

function createTempDir(prefix = 'evo-audit-31-33-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function safeCleanup(dir: string): void {
  for (let i = 0; i < 4; i++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
}

function initGitRepo(ws: string): void {
  spawnSync('git', ['init'], { cwd: ws });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ws });
  spawnSync('git', ['config', 'user.name', 'Tester'], { cwd: ws });
}

function commitAll(ws: string, msg: string): string {
  spawnSync('git', ['add', '.'], { cwd: ws });
  spawnSync('git', ['commit', '-m', msg], { cwd: ws });
  return resolveCurrentGitCommit(ws);
}

const AGY_HOOK_SCRIPT = path.resolve(process.cwd(), 'scripts', 'antigravity_hook.mjs');

function runAgyHook(
  event: 'PreInvocation' | 'Stop',
  payload: Record<string, unknown>,
  envExtra: Record<string, string | undefined> = {}
) {
  return spawnSync(process.execPath, [AGY_HOOK_SCRIPT, event], {
    cwd: process.cwd(),
    env: { ...process.env, ...envExtra },
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

describe('Issues #31, #32, #33 Bucket A Audit Fixes Regression Suite', () => {
  test('1. [#31-1] GLOBAL recall attribution updates local recall_events.helped without inserting local telemetry orphan', () => {
    const localWs = createTempDir('evo-31-1-local-');
    const globalWs = createTempDir('evo-31-1-global-');
    const oldGlobal = process.env.EVO_GLOBAL_DIR;
    process.env.EVO_GLOBAL_DIR = globalWs;
    let localTel: EvoTelemetry | undefined;
    let globalTel: EvoTelemetry | undefined;

    try {
      const localStorage = new EvoStorage(localWs);
      localStorage.ensureInitialized();
      localTel = new EvoTelemetry(localStorage);

      const globalStorage = new EvoStorage(globalWs);
      globalStorage.ensureInitialized();
      globalStorage.saveRule({
        id: 'global-parity-rule',
        title: 'Global Parity Rule',
        l0_summary: 'Global rule summary for recall attribution',
        scope_glob: '**/*',
        core: false,
        priority: 10,
        tokens: 20,
        origin: 'test',
        content: 'Enforce strict recall attribution parity.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      globalTel = new EvoTelemetry(globalStorage);
      globalTel.syncFromDisk();

      // (a) CLI hook path
      localTel.recordRecallEvent({
        eventType: 'inspect',
        capabilityId: 'global-parity-rule',
        kind: 'rule',
        tier: 'GLOBAL',
      });
      recordRecalledOutcomeWithTierRouting(
        localStorage,
        localTel,
        { id: 'global-parity-rule', kind: 'rule', tier: 'GLOBAL', ts: new Date().toISOString() },
        'helped'
      );

      assert.equal(globalTel.getTelemetryMap().get('global-parity-rule')?.helped_count, 1);
      assert.equal(
        localTel.getTelemetryMap().get('global-parity-rule'),
        undefined,
        'Local telemetry table must NOT receive an orphan row for GLOBAL capability'
      );
      assert.equal(localTel.getWindowStats(7).helpedCount, 1);

      // (b) Antigravity hook Stop path
      localTel.recordRecallEvent({
        eventType: 'run',
        capabilityId: 'global-parity-rule',
        kind: 'rule',
        tier: 'GLOBAL',
      });
      localTel.recordRecalledCapability({
        id: 'global-parity-rule',
        kind: 'rule',
        tier: 'GLOBAL',
      });
      localTel.close();
      localTel = undefined;
      globalTel.close();
      globalTel = undefined;

      const stateFile = path.join(localWs, 'agy-state.json');
      const stopRes = runAgyHook(
        'Stop',
        {
          conversationId: 'conv-31-1',
          workspacePaths: [localWs],
        },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(stopRes.status, 0, stopRes.stderr);

      const globalTelCheck = new EvoTelemetry(globalStorage);
      const localTelCheck = new EvoTelemetry(localStorage);
      try {
        assert.equal(globalTelCheck.getTelemetryMap().get('global-parity-rule')?.helped_count, 2);
        assert.equal(localTelCheck.getTelemetryMap().get('global-parity-rule'), undefined);
        assert.equal(localTelCheck.getWindowStats(7).helpedCount, 2);
      } finally {
        globalTelCheck.close();
        localTelCheck.close();
      }
    } finally {
      localTel?.close();
      globalTel?.close();
      if (oldGlobal !== undefined) process.env.EVO_GLOBAL_DIR = oldGlobal;
      else delete process.env.EVO_GLOBAL_DIR;
      safeCleanup(localWs);
      safeCleanup(globalWs);
    }
  });

  test('2. [#31-2 & #32-3] Antigravity Stop resolves file:// URIs, subdirectories, workspacePaths[1], transcript workspace fallback, and global-dir aliasing', () => {
    const repoWs = createTempDir('evo-32-3-repo-');
    const subDir = path.join(repoWs, 'packages', 'api', 'src');
    const unrelatedDir = createTempDir('evo-32-3-unrelated-');
    const globalWs = createTempDir('evo-32-3-global-');
    fs.mkdirSync(subDir, { recursive: true });

    try {
      const storage = new EvoStorage(repoWs);
      storage.ensureInitialized();
      storage.saveRule({
        id: 'sub-walk-rule',
        title: 'Sub Walk Rule',
        l0_summary: 'Verify Stop upward walk and transcript fallback.',
        scope_glob: '**/*',
        core: false,
        priority: 10,
        tokens: 20,
        origin: 'test',
        content: 'Keep upward walk active.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const stateFile = path.join(repoWs, 'agy-state.json');

      // Case A: file:// URI to subdirectory + workspacePaths[0] unrelated
      let tel = new EvoTelemetry(storage);
      tel.syncFromDisk();
      tel.recordRecalledCapability({ id: 'sub-walk-rule', kind: 'rule', tier: 'LOCAL' });
      tel.close();

      const resA = runAgyHook(
        'Stop',
        {
          conversationId: 'conv-32-3-a',
          workspacePaths: [unrelatedDir, pathToFileURL(subDir).href],
        },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(resA.status, 0, resA.stderr);

      tel = new EvoTelemetry(storage);
      assert.equal(tel.getTelemetryMap().get('sub-walk-rule')?.helped_count, 1);

      // Case B: workspacePaths omitted -> transcript evo_search({ workspace }) fallback
      tel.recordRecalledCapability({ id: 'sub-walk-rule', kind: 'rule', tier: 'LOCAL' });
      tel.close();

      const transcriptPath = path.join(repoWs, 'transcript-fallback.jsonl');
      fs.writeFileSync(
        transcriptPath,
        [
          JSON.stringify({ step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Check rule' }),
          JSON.stringify({
            step_index: 2,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            tool_calls: [
              {
                name: 'call_mcp_tool',
                arguments: JSON.stringify({
                  ServerName: 'evo-kernel',
                  ToolName: 'evo_search',
                  Arguments: JSON.stringify({ query: 'sub-walk-rule', workspace: subDir }),
                }),
              },
            ],
          }),
        ].join('\n') + '\n',
        'utf8'
      );

      const resB = runAgyHook(
        'Stop',
        {
          conversationId: 'conv-32-3-b',
          workspacePaths: [],
          transcriptPath,
        },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(resB.status, 0, resB.stderr);

      tel = new EvoTelemetry(storage);
      assert.equal(tel.getTelemetryMap().get('sub-walk-rule')?.helped_count, 2);
      tel.close();

      // Case C: wsRoot === EVO_GLOBAL_DIR with GLOBAL tier entry must NOT double-open & double-count
      const gStorage = new EvoStorage(globalWs);
      gStorage.ensureInitialized();
      gStorage.saveRule({
        id: 'alias-global-rule',
        title: 'Alias Global Rule',
        l0_summary: 'Verify global dir aliasing safety.',
        scope_glob: '**/*',
        core: false,
        priority: 10,
        tokens: 20,
        origin: 'test',
        content: 'Avoid duplicate DB writes on global dir.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      let gTel = new EvoTelemetry(gStorage);
      gTel.syncFromDisk();
      gTel.recordRecalledCapability({ id: 'alias-global-rule', kind: 'rule', tier: 'GLOBAL' });
      gTel.close();

      const resC = runAgyHook(
        'Stop',
        {
          conversationId: 'conv-32-3-c',
          workspacePaths: [globalWs],
        },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(resC.status, 0, resC.stderr);

      gTel = new EvoTelemetry(gStorage);
      assert.equal(gTel.getTelemetryMap().get('alias-global-rule')?.helped_count, 1);
      gTel.close();
    } finally {
      safeCleanup(repoWs);
      safeCleanup(unrelatedDir);
      safeCleanup(globalWs);
    }
  });

  test('3. [#32-1 & #32-2] Compliant evo_propose after user correction preserves contested attribution, and Stop keeps deferred error flags', () => {
    const ws = createTempDir('evo-32-1-2-');
    const globalWs = createTempDir('evo-32-1-2-global-');
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      storage.saveRule({
        id: 'bad-rule',
        title: 'Bad Rule',
        l0_summary: 'Rule that led to correction',
        scope_glob: '**/*',
        core: false,
        priority: 10,
        tokens: 20,
        origin: 'test',
        content: 'Do X first.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      let tel = new EvoTelemetry(storage);
      tel.syncFromDisk();
      tel.recordRecalledCapability({ id: 'bad-rule', kind: 'rule', tier: 'LOCAL' });
      tel.close();

      // (a) Antigravity hook: correction at step 3 -> compliant evo_propose at step 4 -> PreInvocation at step 5 -> Stop
      const stateFile = path.join(ws, 'agy-state.json');
      const transcript = path.join(ws, 'turn-corr-propose.jsonl');
      fs.writeFileSync(
        transcript,
        [
          JSON.stringify({ step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Fix handler' }),
          JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'Trying X' }),
          JSON.stringify({ step_index: 3, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '错了，不要这样做，请改用 Y' }),
          JSON.stringify({
            step_index: 4,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            created_at: new Date(Date.now() + 2000).toISOString(),
            tool_calls: [{ name: 'evo_propose', arguments: JSON.stringify({ id: 'fixed-rule', workspace: ws }) }],
          }),
          JSON.stringify({
            step_index: 5,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            tool_calls: [{ name: 'run_command', arguments: JSON.stringify({ CommandLine: 'npm test' }) }],
          }),
        ].join('\n') + '\n',
        'utf8'
      );

      const pre1 = runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-32-1', transcriptPath: transcript, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(pre1.status, 0, pre1.stderr);

      // Verify updated_at-required session_state table actually received user_correction_detected = 'true'
      tel = new EvoTelemetry(storage);
      assert.equal(tel.getSessionFlag('user_correction_detected'), 'true');
      tel.close();

      const stopRes = runAgyHook(
        'Stop',
        { conversationId: 'conv-32-1', transcriptPath: transcript, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(stopRes.status, 0, stopRes.stderr);

      tel = new EvoTelemetry(storage);
      const rec = tel.getTelemetryMap().get('bad-rule');
      assert.equal(rec?.contested_count, 1, 'Pre-correction rule must be attributed as contested');
      assert.equal(rec?.helped_count, 0, 'Compliant evo_propose must NOT invert contested into helped');

      // (b) Antigravity hook: unrecovered run_command error preserves recalled_capabilities & had_command_error across Stop
      tel.recordRecalledCapability({ id: 'bad-rule', kind: 'rule', tier: 'LOCAL' });
      tel.close();

      const errTranscript = path.join(ws, 'turn-cmd-err.jsonl');
      fs.writeFileSync(
        errTranscript,
        [
          JSON.stringify({ step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Run tests' }),
          JSON.stringify({
            step_index: 2,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            tool_calls: [
              { name: 'run_command', arguments: JSON.stringify({ CommandLine: 'node missing.js' }), status: 'ERROR', output: 'Error: Cannot find module' },
            ],
          }),
        ].join('\n') + '\n',
        'utf8'
      );

      const stopErr = runAgyHook(
        'Stop',
        { conversationId: 'conv-32-2', transcriptPath: errTranscript, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(stopErr.status, 0, stopErr.stderr);

      tel = new EvoTelemetry(storage);
      assert.equal(tel.getSessionFlag('had_command_error'), 'true', 'had_command_error must be persisted and preserved');
      assert.equal(tel.getRecalledCapabilities().length, 1, 'recalled_capabilities must NOT be wiped when deferred by command error');
      assert.equal(tel.getTelemetryMap().get('bad-rule')?.helped_count, 0);

      // (c) CLI hook.ts: Turn 1 contested -> Turn 2 evo_propose -> Turn 2 Stop must NOT award helped to Turn 1's contested rule
      tel.clearRecalledCapabilities();
      tel.setSessionFlag('had_command_error', 'false');
      tel.setSessionFlag('contested_attributed', 'false');
      tel.setSessionFlag('contested_at', '0');
      tel.setSessionFlag('user_correction_detected', 'false');
      tel.recordRecalledCapability({ id: 'bad-rule', kind: 'rule', tier: 'LOCAL' });
      tel.close();

      handleStop(ws, { last_user_message: '错了，请不要直接改配置' }, { dryRun: false });
      handlePostTool(
        ws,
        {
          tool_name: 'evo_propose',
          tool_input: { id: 'cli-fix-rule', workspace: ws },
          tool_response: '{"passed":true}',
        },
        { dryRun: false }
      );
      handleStop(ws, { last_user_message: '好的继续' }, { dryRun: false });

      tel = new EvoTelemetry(storage);
      const afterCli = tel.getTelemetryMap().get('bad-rule');
      assert.equal(afterCli?.contested_count, 2);
      assert.equal(afterCli?.helped_count, 0, 'CLI Turn 2 Stop after evo_propose must NOT award helped to Turn 1 contested rule');
      tel.close();
    } finally {
      safeCleanup(ws);
      safeCleanup(globalWs);
    }
  });

  test('4. [#32-8] Antigravity hook plain-text Stop, interrupted turn reset, SYSTEM filter, step alignment/rg/exit0, and >128KB monotonic step index', () => {
    const ws = createTempDir('evo-32-8-');
    const globalWs = createTempDir('evo-32-8-global-');
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      storage.saveRule({
        id: 'plain-stop-rule',
        title: 'Plain Stop Rule',
        l0_summary: 'Test plain text Stop after user correction.',
        scope_glob: '**/*',
        core: false,
        priority: 10,
        tokens: 20,
        origin: 'test',
        content: 'Validate plain text Stop.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      const stateFile = path.join(ws, 'agy-state.json');

      // 8.1 Plain-text Stop after correction (no PreInvocation ran after correction)
      let tel = new EvoTelemetry(storage);
      tel.syncFromDisk();
      tel.recordRecalledCapability({ id: 'plain-stop-rule', kind: 'rule', tier: 'LOCAL' });
      tel.close();

      const plainTranscript = path.join(ws, 'plain-stop.jsonl');
      fs.writeFileSync(
        plainTranscript,
        [
          JSON.stringify({ step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Do task' }),
          JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'Done A' }),
          JSON.stringify({ step_index: 3, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '不对，你理解错了' }),
          JSON.stringify({ step_index: 4, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'Sorry, acknowledged in plain text.' }),
        ].join('\n') + '\n',
        'utf8'
      );
      const res81 = runAgyHook(
        'Stop',
        { conversationId: 'conv-8-1', transcriptPath: plainTranscript, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(res81.status, 0);
      tel = new EvoTelemetry(storage);
      assert.equal(tel.getTelemetryMap().get('plain-stop-rule')?.contested_count, 1);
      assert.equal(tel.getTelemetryMap().get('plain-stop-rule')?.helped_count, 0);

      // 8.2 Interrupted Turn 1 correction must NOT poison Turn 2 normal USER_INPUT
      const t82 = path.join(ws, 'interrupted.jsonl');
      fs.writeFileSync(
        t82,
        [
          JSON.stringify({ step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Start' }),
          JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'Resp' }),
          JSON.stringify({ step_index: 3, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '不对，错了！' }),
        ].join('\n') + '\n',
        'utf8'
      );
      const pre82a = runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-8-2', transcriptPath: t82, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.ok(pre82a.stdout.includes('ephemeralMessage'));

      // User starts fresh non-correction Turn 2 before Stop
      tel.recordRecalledCapability({ id: 'plain-stop-rule', kind: 'rule', tier: 'LOCAL' });
      tel.close();
      fs.appendFileSync(
        t82,
        [
          JSON.stringify({ step_index: 4, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Now add unit tests for helper' }),
          JSON.stringify({ step_index: 5, type: 'PLANNER_RESPONSE', source: 'MODEL', tool_calls: [{ name: 'view_file', arguments: '{}' }] }),
        ].join('\n') + '\n',
        'utf8'
      );
      runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-8-2', transcriptPath: t82, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      runAgyHook(
        'Stop',
        { conversationId: 'conv-8-2', transcriptPath: t82, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      tel = new EvoTelemetry(storage);
      assert.equal(tel.getTelemetryMap().get('plain-stop-rule')?.helped_count, 1);
      assert.equal(tel.getTelemetryMap().get('plain-stop-rule')?.contested_count, 1);
      tel.close();

      // 8.3 source: 'SYSTEM' USER_INPUT with correction keyword must be ignored
      const t83 = path.join(ws, 'system-user-input.jsonl');
      fs.writeFileSync(
        t83,
        [
          JSON.stringify({ step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Hello' }),
          JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'Hi' }),
          JSON.stringify({ step_index: 3, type: 'USER_INPUT', source: 'SYSTEM', content: '不对/错了 system wakeup notification' }),
        ].join('\n') + '\n',
        'utf8'
      );
      const res83 = runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-8-3', transcriptPath: t83, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.equal(res83.stdout.trim(), '{}');

      // 8.4 Mixed inline + separate tool outputs, rg exit-1 exemption, and exit-0 log containing TypeError:
      const t84 = path.join(ws, 'mixed-cmd.jsonl');
      fs.writeFileSync(
        t84,
        [
          JSON.stringify({ step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Check code' }),
          JSON.stringify({
            step_index: 2,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            tool_calls: [
              { name: 'view_file', arguments: '{}', output: 'inline file contents' },
              { name: 'run_command', arguments: JSON.stringify({ CommandLine: 'rg needle src/' }) },
              { name: 'run_command', arguments: JSON.stringify({ CommandLine: 'npm test' }) },
            ],
          }),
          JSON.stringify({ type: 'TOOL_RESULT', status: 'DONE', exit_code: 1, output: '' }),
          JSON.stringify({ type: 'TOOL_RESULT', status: 'DONE', output: 'TypeError: tested negative branch ok\nCommand exited with code 0' }),
        ].join('\n') + '\n',
        'utf8'
      );
      const res84 = runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-8-4', transcriptPath: t84, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      // Should NOT falsely trigger command error recovery!
      assert.equal(res84.stdout.trim(), '{}');

      // 8.5 >128KB transcript without step_index must remain monotonic across sliding tail
      const t85 = path.join(ws, 'large-no-step-index.jsonl');
      const padLines: string[] = [];
      const bigFiller = 'x'.repeat(2400);
      for (let k = 0; k < 60; k++) {
        padLines.push(
          JSON.stringify({
            created_at: `2026-11-18T00:00:${String(k).padStart(2, '0')}Z`,
            type: k === 0 ? 'USER_INPUT' : 'PLANNER_RESPONSE',
            source: k === 0 ? 'USER_EXPLICIT' : 'MODEL',
            content: `${k}:${bigFiller}`,
          })
        );
      }
      fs.writeFileSync(t85, padLines.join('\n') + '\n', 'utf8');
      runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-8-5', transcriptPath: t85, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      // Append more filler + a user correction so tail window shifts past 128KB
      const moreLines: string[] = [];
      for (let k = 60; k < 120; k++) {
        moreLines.push(
          JSON.stringify({
            created_at: `2026-11-18T00:01:${String(k - 60).padStart(2, '0')}Z`,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            content: `${k}:${bigFiller}`,
          })
        );
      }
      moreLines.push(
        JSON.stringify({
          created_at: '2026-11-18T00:02:00Z',
          type: 'USER_INPUT',
          source: 'USER_EXPLICIT',
          content: '错了，这里必须改一下',
        })
      );
      fs.appendFileSync(t85, moreLines.join('\n') + '\n', 'utf8');
      const res85 = runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-8-5', transcriptPath: t85, workspacePaths: [ws] },
        { EVO_GLOBAL_DIR: globalWs, EVO_AGY_HOOK_STATE_PATH: stateFile }
      );
      assert.ok(
        res85.stdout.includes('ephemeralMessage'),
        'Monotonic step tracking must fire correction reminder even after >128KB tail shift'
      );
    } finally {
      safeCleanup(ws);
      safeCleanup(globalWs);
    }
  });

  test('5. [#32-6] bindActiveContext does not hijack explicit uninitialized workspace to clientRoots', async () => {
    const repoA = createTempDir('evo-32-6-repoa-');
    const uninitB = createTempDir('evo-32-6-uninitb-');
    const globalWs = createTempDir('evo-32-6-global-');
    const oldGlobal = process.env.EVO_GLOBAL_DIR;
    process.env.EVO_GLOBAL_DIR = globalWs;

    try {
      const storageA = new EvoStorage(repoA);
      storageA.ensureInitialized();
      storageA.saveRule({
        id: 'secret-repo-a-rule',
        title: 'Repo A Secret Rule',
        l0_summary: 'Secret keyword alpha-omega-repo-a rule.',
        scope_glob: '**/*',
        core: false,
        priority: 10,
        tokens: 20,
        origin: 'test',
        content: 'Confidential Repo A rule content.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      storageA.saveTool(
        {
          id: 'secret-repo-a-tool',
          name: 'secret-repo-a-tool',
          title: 'Secret Repo A Tool',
          description: 'Only in Repo A',
          l0_summary: 'Only in Repo A',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 2000,
          origin: 'test',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.log("repo-a");'
      );
      const gStorage = new EvoStorage(globalWs);
      gStorage.ensureInitialized();

      const dispatcher = new EvoMcpDispatcher(repoA);
      dispatcher.setClientRoots([repoA]);

      const searchRes = await dispatcher.handleToolCall('evo_search', {
        query: 'alpha-omega-repo-a',
        workspace: uninitB,
      });
      const searchText = searchRes.content.map((c: any) => c.text).join('\n');
      assert.equal(searchText.includes('secret-repo-a-rule'), false, 'Repo A capability must NOT leak into uninitB search');

      const inspectRes = await dispatcher.handleToolCall('evo_inspect', {
        id: 'secret-repo-a-rule',
        tier: 'L2',
        workspace: uninitB,
      });
      assert.equal(inspectRes.isError, true);

      const runRes = await dispatcher.handleToolCall('evo_run', {
        tool_id: 'secret-repo-a-tool',
        args: {},
        workspace: uninitB,
      });
      assert.equal(runRes.isError, true);

      assert.equal(fs.existsSync(path.join(uninitB, '.evo')), false, 'Must create zero .evo files in uninitB');

      const telA = new EvoTelemetry(storageA);
      try {
        assert.equal(telA.getWindowStats(7).searchEvents, 0, 'Must write zero recall_events to Repo A');
        assert.equal(telA.getWindowStats(7).adoptedCount, 0);
      } finally {
        telA.close();
      }
      await dispatcher.close();
    } finally {
      if (oldGlobal !== undefined) process.env.EVO_GLOBAL_DIR = oldGlobal;
      else delete process.env.EVO_GLOBAL_DIR;
      safeCleanup(repoA);
      safeCleanup(uninitB);
      safeCleanup(globalWs);
    }
  });

  test('6. [#31-4, #32-7, #32-9] evo_run args/required validation, failure schema hint, GLOBAL dirty-tree check, and sessionProposedIds filter/prune', async () => {
    const ws = createTempDir('evo-31-4-32-7-');
    const globalWs = createTempDir('evo-31-4-32-7-global-');
    const oldGlobal = process.env.EVO_GLOBAL_DIR;
    process.env.EVO_GLOBAL_DIR = globalWs;

    try {
      initGitRepo(ws);
      fs.writeFileSync(path.join(ws, 'app.ts'), 'export const x = 1;\n', 'utf8');
      commitAll(ws, 'init');
      // Make worktree dirty and set fresh local hook heartbeat
      fs.writeFileSync(path.join(ws, 'app.ts'), 'export const x = 2;\n', 'utf8');

      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      const localTel = new EvoTelemetry(storage);
      localTel.setSessionFlag('last_hook_event_at', String(Date.now()));
      localTel.close();

      // Create a GLOBAL tool with required boolean/number/string args
      const gStorage = new EvoStorage(globalWs);
      gStorage.ensureInitialized();
      const gScriptContent = `if (process.argv.includes('--self-test') || process.env.EVO_SELF_TEST === '1') { console.log('ok'); process.exit(0); }
const rawArg = process.argv.slice(2).find((a) => a.startsWith('{')) || '{}';
const args = JSON.parse(rawArg);
if (args.failNow) { console.error('forced failure'); process.exit(2); }
console.log(JSON.stringify(args));`;
      gStorage.saveTool(
        {
          id: 'global-req-tool',
          name: 'global-req-tool',
          title: 'Global Required Tool',
          description: 'Tests required arg validation and global dirty check',
          l0_summary: 'Global required arg tool',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: {
            type: 'object',
            properties: {
              count: { type: 'number' },
              flag: { type: 'boolean' },
              failNow: { type: 'boolean' },
            },
            required: ['count', 'flag'],
          },
          self_test_args: { '--self-test': true },
          timeout_ms: 3000,
          origin: 'test',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        gScriptContent
      );

      const dispatcher = new EvoMcpDispatcher(ws);

      // (a) Array args rejected
      const arrRes = await dispatcher.handleToolCall('evo_run', {
        tool_id: 'global-req-tool',
        args: ['bad'],
        workspace: ws,
      });
      assert.equal(arrRes.isError, true);
      assert.ok(arrRes.content[0].text.includes('ERR_INVALID_SCHEMA'));

      // (b) Missing required arg fails fast with schema hint
      const missingRes = await dispatcher.handleToolCall('evo_run', {
        tool_id: 'global-req-tool',
        args: {},
        workspace: ws,
      });
      assert.equal(missingRes.isError, true);
      assert.ok(missingRes.content[0].text.includes('ERR_MISSING_REQUIRED_ARGS'));
      assert.ok(missingRes.content[0].text.includes('"count"'));

      // (c) Falsy 0 / false are ACCEPTED for required args, AND GLOBAL tool run does NOT emit false dirty-tree reminder when local hook is active!
      const okRes = await dispatcher.handleToolCall('evo_run', {
        tool_id: 'global-req-tool',
        args: { count: 0, flag: false },
        workspace: ws,
      });
      assert.equal(Boolean(okRes.isError), false, okRes.content[0].text);
      assert.equal(
        okRes.content[0].text.includes('Uncommitted edits detected'),
        false,
        'GLOBAL tool run must check local last_hook_event_at and avoid false dirty-tree reminder'
      );

      // (d) --self-test bypasses required arg check
      const stRes = await dispatcher.handleToolCall('evo_run', {
        tool_id: 'global-req-tool',
        args: { '--self-test': true },
        workspace: ws,
      });
      assert.equal(Boolean(stRes.isError), false, stRes.content[0].text);

      // (e) Non-zero tool exit appends Input Schema Hint
      const failRes = await dispatcher.handleToolCall('evo_run', {
        tool_id: 'global-req-tool',
        args: { count: 1, flag: true, failNow: true },
        workspace: ws,
      });
      assert.equal(failRes.isError, true);
      assert.ok(failRes.content[0].text.includes('Input Schema Hint:'));

      // (f) sessionProposedIds respects filterKind and prunes deleted memories
      const propRes = await dispatcher.handleToolCall('evo_propose', {
        workspace: ws,
        kind: 'memory',
        id: 'temp-session-mem',
        title: 'Temp Session Mem',
        l0_summary: 'Memory for filterKind and pruning test',
        symptom: 'Failure in app.ts',
        root_cause: 'Missing check in x',
        solution: 'Added check for x',
        target_symbols: ['app.ts#x'],
      });
      assert.equal(Boolean(propRes.isError), false, propRes.content[0].text);

      const searchToolRes = await dispatcher.handleToolCall('evo_search', {
        workspace: ws,
        query: 'global-req-tool',
        kind: 'tool',
      });
      assert.equal(
        searchToolRes.content[0].text.includes('temp-session-mem'),
        false,
        'kind="tool" search must not force memory Anti-Poisoning reminders'
      );

      const searchMemRes = await dispatcher.handleToolCall('evo_search', {
        workspace: ws,
        query: 'Missing check',
        kind: 'memory',
      });
      assert.ok(searchMemRes.content[0].text.includes('temp-session-mem'));

      // Delete memory from disk externally -> next search must prune it
      fs.unlinkSync(path.join(storage.memoriesDir, 'temp-session-mem.md'));
      const searchAfterDel = await dispatcher.handleToolCall('evo_search', {
        workspace: ws,
        query: 'Missing check',
        kind: 'memory',
      });
      assert.equal(searchAfterDel.content[0].text.includes('temp-session-mem'), false);

      await dispatcher.close();
    } finally {
      if (oldGlobal !== undefined) process.env.EVO_GLOBAL_DIR = oldGlobal;
      else delete process.env.EVO_GLOBAL_DIR;
      safeCleanup(ws);
      safeCleanup(globalWs);
    }
  });

  test('7. [#32-4c, #32-5, #32-10, #32-11, #31-5, #33-1b, #33-4] Anchor upgrade, empty fingerprint cache invalidation, stats --global window7d, receipt/seed parity, symlink rollback, and SQLite busy_timeout', async () => {
    const ws = createTempDir('evo-batch7-');
    const globalWs = createTempDir('evo-batch7-global-');
    const oldGlobal = process.env.EVO_GLOBAL_DIR;
    process.env.EVO_GLOBAL_DIR = globalWs;

    try {
      // (a) L0_META_RULE_SEED token budget & subagent wording (#31-5)
      assert.ok(estimateTokens(L0_META_RULE_SEED) < 1100);
      assert.ok(L0_META_RULE_SEED.includes('write-disabled subagent sandboxes'));
      assert.ok(!fs.readFileSync(path.resolve(process.cwd(), 'templates', 'GEMINI.extension.md'), 'utf8').includes('EvoKernel 演进回执'));

      // (b) 'uncommitted' upgrades to real HEAD commit after git commit + changing target_symbols re-anchors (#32-4c)
      initGitRepo(ws);
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'src', 'a.ts'), 'export function alpha() { return 1; }\nexport function beta() { return 2; }\n', 'utf8');
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      const tel = new EvoTelemetry(storage);
      const gk = new EvoGatekeeper(storage, tel);

      const uncommitRes = gk.evaluateAndCommit({
        kind: 'memory',
        id: 'uncommit-mem',
        title: 'Uncommitted Mem',
        l0_summary: 'Created before first commit',
        symptom: 'Alpha fails',
        root_cause: 'Alpha returns wrong value',
        solution: 'Fix alpha return',
        target_symbols: ['src/a.ts#alpha'],
      });
      assert.equal(uncommitRes.passed, true, uncommitRes.message);
      assert.equal(storage.getMemory('uncommit-mem')?.created_commit, 'uncommitted');

      const head1 = commitAll(ws, 'first commit');
      tel.close();

      const webRes = await handleWebviewAction(
        'update-content',
        {
          kind: 'memory',
          id: 'uncommit-mem',
          content: [
            '---',
            'target_symbols: ["./src/a.ts#alpha"]',
            '---',
            '## Symptom',
            'Alpha fails',
            '## Root Cause',
            'Alpha returns wrong value',
            '## Solution',
            'Fix alpha return cleanly after commit.',
          ].join('\n'),
        },
        ws
      );
      assert.equal(webRes.ok, true, webRes.error);
      assert.equal(storage.getMemory('uncommit-mem')?.created_commit, head1, 'uncommitted must upgrade to HEAD commit after git commit');

      // Changing target_symbols while passing stale created_commit must re-anchor to HEAD2
      fs.writeFileSync(path.join(ws, 'src', 'b.ts'), 'export const gamma = 3;\n', 'utf8');
      const head2 = commitAll(ws, 'second commit');
      const tel2 = new EvoTelemetry(storage);
      const gk2 = new EvoGatekeeper(storage, tel2);
      const changedSymRes = gk2.evaluateAndCommit({
        kind: 'memory',
        id: 'uncommit-mem',
        supersedes_id: 'uncommit-mem',
        title: 'Uncommitted Mem',
        l0_summary: 'Retargeted symbol',
        symptom: 'Alpha/Beta fails',
        root_cause: 'Beta logic issue',
        solution: 'Fix beta',
        target_symbols: ['src/a.ts#beta'],
        created_commit: head1,
      });
      assert.equal(changedSymRes.passed, true, changedSymRes.message);
      assert.equal(storage.getMemory('uncommit-mem')?.created_commit, head2);
      assert.ok(storage.getMemory('uncommit-mem')?.ast_fingerprints['src/a.ts#beta']);

      // (c) verifyMemoryFreshness with ast_fingerprints: {} invalidates cached VERIFIED when symbol deleted (#32-5)
      storage.saveMemory({
        id: 'empty-fp-mem',
        title: 'Empty FP Mem',
        l0_summary: 'Legacy empty ast_fingerprints fixture',
        symptom: 'gamma bug',
        root_cause: 'gamma value',
        solution: 'fix gamma',
        target_symbols: ['gamma'],
        ast_fingerprints: {},
        created_commit: head2,
        created_branch: 'main',
        enabled: true,
        review_status: 'approved',
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      const memObj = storage.getMemory('empty-fp-mem')!;
      const rep1 = verifyMemoryFreshness(ws, memObj, { includeCallers: false });
      assert.equal(rep1.overall_status, 'VERIFIED');
      fs.writeFileSync(path.join(ws, 'src', 'b.ts'), 'export const renamed = 3;\n', 'utf8');
      const rep2 = verifyMemoryFreshness(ws, memObj, { includeCallers: false });
      assert.notEqual(rep2.overall_status, 'VERIFIED', 'Deleting target symbol must immediately invalidate empty-fingerprint cached VERIFIED');

      // (d) evo stats --global merges global 7-day recall_events (#32-10)
      const gStorage = new EvoStorage(globalWs);
      gStorage.ensureInitialized();
      const gTel = new EvoTelemetry(gStorage);
      gTel.recordRecallEvent({ eventType: 'search', capabilityId: 'g-cap-1', kind: 'rule', tier: 'GLOBAL' });
      gTel.recordRecallEvent({ eventType: 'run', capabilityId: 'g-cap-1', kind: 'tool', tier: 'GLOBAL', helped: true });
      gTel.close();
      tel2.close();

      const statsJson = buildEvoStatsJson(ws, { includeGlobal: true }) as any;
      assert.ok(statsJson.window7d.searchEvents >= 1, 'stats --global must include global 7d searchEvents');
      assert.ok(statsJson.window7d.helpedCount >= 1, 'stats --global must include global 7d helpedCount');

      // (e) Symlink / junction rollback detection (#33-1b)
      const preSnap = captureWorkspaceRollbackSnapshot(ws);
      const linkTarget = path.join(ws, 'src');
      const linkPath = path.join(ws, 'sneaky-link');
      let linkCreated = false;
      try {
        fs.symlinkSync(linkTarget, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        linkCreated = true;
      } catch {
        linkCreated = false;
      }
      if (linkCreated) {
        const rb = restoreWorkspaceFromSnapshot(ws, preSnap);
        assert.ok(rb.mutatedFiles.includes('sneaky-link'));
        assert.equal(fs.existsSync(linkPath), false, 'Created symlink/junction must be cleaned up on rollback');
      }

      // (f) openSqliteReadOnly sets PRAGMA busy_timeout and works with Node 22.5 mock without .exec (#33-4)
      const roDb = openSqliteReadOnly(path.join(storage.cacheDir, 'telemetry.db'));
      try {
        const bt = roDb.prepare('PRAGMA busy_timeout').get() as { timeout?: number } | undefined;
        assert.equal(bt?.timeout, 3000);
      } finally {
        roDb.close();
      }
      const mockRo = openSqliteReadOnly(path.join(storage.cacheDir, 'telemetry.db'), class MockDb {
        constructor(_p: string, opts?: Record<string, unknown>) {
          if (opts && 'readOnly' in opts) {
            throw new TypeError('Unknown option');
          }
        }
      } as any);
      assert.ok(mockRo);
      // Confirm readRecallWindowStatsFromDb handles open DB
      const checkDb = new DatabaseSync(path.join(storage.cacheDir, 'telemetry.db'));
      try {
        assert.equal(typeof readRecallWindowStatsFromDb(checkDb).days, 'number');
      } finally {
        checkDb.close();
      }
    } finally {
      if (oldGlobal !== undefined) process.env.EVO_GLOBAL_DIR = oldGlobal;
      else delete process.env.EVO_GLOBAL_DIR;
      safeCleanup(ws);
      safeCleanup(globalWs);
    }
  });
});
