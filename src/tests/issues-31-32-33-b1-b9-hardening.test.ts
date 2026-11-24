import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { EvoStorage, openSqliteReadOnly } from '../core/storage.js';
import { EvoTelemetry, readMergedRecallWindowStatsFromDbs } from '../core/telemetry.js';
import { splitCompoundIdentifier, stemEnglishToken } from '../core/lexicon.js';
import {
  verifyMemoryFreshness,
  verifyMemoryFreshnessAsync,
  extractSymbolFingerprint,
  extractSymbolFingerprintAsync,
  resolveBarrelReexportTargets,
  resolveCurrentGitCommit,
  clearMemoryVerificationCache,
} from '../core/memory.js';
import { clearGitPathsCache } from '../core/memory/git-utils.js';
import {
  EvoGatekeeper,
  isValidContrastiveEvidence,
} from '../core/gatekeeper.js';
import { checkScriptSyntaxAsync } from '../core/sandbox.js';
import { EvoMcpDispatcher } from '../mcp/handlers.js';
import { buildUiSnapshot } from '../cli/ui.js';
import { recordRecalledOutcomeWithTierRouting } from '../cli/hook.js';

const AGY_HOOK_SCRIPT = path.resolve(process.cwd(), 'scripts', 'antigravity_hook.mjs');
const AUDITOR_SCRIPT = path.resolve(process.cwd(), '.evo', 'tools', 'agy-config-auditor', 'run.mjs');

function createTempDir(prefix = 'evo-b1b9-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function safeCleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 });
  } catch {}
}

function initGitRepo(ws: string, branch = 'main'): void {
  execSync(`git init -b ${branch}`, { cwd: ws, stdio: 'pipe' });
  execSync('git config user.email "ci@example.com"', { cwd: ws, stdio: 'pipe' });
  execSync('git config user.name "Evo CI"', { cwd: ws, stdio: 'pipe' });
}

function commitAll(ws: string, message = 'commit'): string {
  execSync('git add .', { cwd: ws, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: ws, stdio: 'pipe' });
  return execSync('git rev-parse --short HEAD', { cwd: ws, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function runAgyHook(
  event: 'PreInvocation' | 'Stop',
  payload: Record<string, unknown>,
  options: { cwd?: string; env: Record<string, string | undefined>; statePath: string }
): { status: number | null; stdout: string; stderr: string; parsed: any } {
  const res = spawnSync(process.execPath, [AGY_HOOK_SCRIPT, event], {
    cwd: options.cwd,
    encoding: 'utf8',
    input: JSON.stringify(payload),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...options.env,
      EVO_AGY_HOOK_STATE_PATH: options.statePath,
    },
  });
  const stdout = String(res.stdout || '').trim();
  let parsed: any = {};
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = { raw: stdout };
    }
  }
  return { status: res.status, stdout, stderr: String(res.stderr || ''), parsed };
}

function makeIsolatedEnv(homeDir: string, globalDir?: string): Record<string, string> {
  const effectiveGlobal = globalDir ?? path.join(homeDir, '.evo', 'global');
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
    EVO_GLOBAL_DIR: effectiveGlobal,
  };
}

describe('Issues #31/#32/#33 Bucket A Residuals & B1-B9 Hardening Suite', () => {
  test('1. [Bucket A Residuals] invoke_subagent no premature wakeup, GLOBAL cross-DB no double-count, openSqliteReadOnly query_only fallback & LOCAL inspect tier', async () => {
    const tmp = createTempDir('evo-res-a-');
    try {
      const fakeHome = path.join(tmp, 'home');
      const globalDir = path.join(tmp, 'global-store');
      const ws = path.join(tmp, 'workspace');
      fs.mkdirSync(fakeHome, { recursive: true });
      fs.mkdirSync(ws, { recursive: true });

      const localStorage = new EvoStorage(ws);
      localStorage.ensureInitialized();
      const globalStorage = new EvoStorage(globalDir);
      globalStorage.ensureInitialized();

      // (a) No premature subagent wakeup when assistant merely calls invoke_subagent without completion result
      const transcriptPath = path.join(tmp, 'transcript-subagent.jsonl');
      const steps = [
        {
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER_EXPLICIT',
          content: 'Check module behavior',
        },
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          tool_calls: [{ name: 'invoke_subagent', arguments: { Role: 'Codebase Researcher' } }],
        },
      ];
      fs.writeFileSync(transcriptPath, steps.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
      const hookState = path.join(tmp, 'hook-state.json');
      const preRes = runAgyHook(
        'PreInvocation',
        { conversationId: 'conv-sub-1', transcriptPath, cwd: ws, workspace: ws },
        { cwd: ws, env: makeIsolatedEnv(fakeHome, globalDir), statePath: hookState }
      );
      assert.equal(preRes.status, 0);
      assert.equal(preRes.stdout, '{}', 'Pending invoke_subagent tool_call must NOT emit premature subagent wakeup');

      // (b) Cross-DB recall_events parity without double-counting helpedCount (#31-1 / #32-10)
      const prevGlobal = process.env.EVO_GLOBAL_DIR;
      process.env.EVO_GLOBAL_DIR = globalDir;
      try {
        const globalTel = new EvoTelemetry(globalStorage);
        const localTel = new EvoTelemetry(localStorage);
        try {
          globalStorage.saveRule({
            id: 'global-helper-guard',
            title: 'Global Helper Guard',
            l0_summary: 'Global guard for parity test',
            scope_glob: '**/*.ts',
            core: false,
            priority: 50,
            content: 'Always verify isolated DB handles before computing statistics.',
            origin: 'evolved',
          });
          globalTel.syncFromDisk();

          localTel.recordRecallEvent({
            eventType: 'inspect',
            capabilityId: 'global-helper-guard',
            kind: 'rule',
            tier: 'GLOBAL',
          });
          globalTel.recordRecallEvent({
            eventType: 'inspect',
            capabilityId: 'global-helper-guard',
            kind: 'rule',
            tier: 'LOCAL',
          });

          recordRecalledOutcomeWithTierRouting(
            localStorage,
            localTel,
            { id: 'global-helper-guard', kind: 'rule', tier: 'GLOBAL', ts: new Date().toISOString() },
            'helped'
          );

          const localDb = openSqliteReadOnly(localStorage.telemetryDbPath);
          const globalDb = openSqliteReadOnly(globalStorage.telemetryDbPath);
          try {
            const merged = readMergedRecallWindowStatsFromDbs([localDb, globalDb], 7);
            assert.equal(merged.helpedCount, 1, 'Merged cross-DB recall_events must count helped exactly once');
            const gRow = globalDb
              .prepare('SELECT helped_count FROM telemetry WHERE id = ?')
              .get('global-helper-guard') as { helped_count: number };
            assert.equal(gRow.helped_count, 1, 'Global capability telemetry helped_count should increment');
          } finally {
            localDb.close();
            globalDb.close();
          }
        } finally {
          localTel.close();
          globalTel.close();
        }

        // (c) openSqliteReadOnly Node 22.5-22.11 fallback runs PRAGMA query_only = ON & busy_timeout = 3000
        const execPragmas: string[] = [];
        let ctorCalls = 0;
        class LegacySqliteMock {
          constructor(_file: string, options?: Record<string, unknown>) {
            ctorCalls++;
            if (options && 'readOnly' in options) {
              const err = new TypeError('The "options" argument is invalid on this version');
              throw err;
            }
          }
          exec(sql: string): void {
            execPragmas.push(sql);
          }
        }
        const roMock = openSqliteReadOnly(localStorage.telemetryDbPath, LegacySqliteMock as any);
        assert.ok(roMock);
        assert.equal(ctorCalls, 2);
        assert.ok(execPragmas.some((q) => /PRAGMA\s+query_only\s*=\s*ON/i.test(q)));
        assert.ok(execPragmas.some((q) => /PRAGMA\s+busy_timeout\s*=\s*3000/i.test(q)));

        // (d) Dispatcher evo_inspect on local capability preserves tier === 'LOCAL'
        localStorage.saveRule({
          id: 'local-only-guard',
          title: 'Local Only Guard',
          l0_summary: 'Local workspace invariant',
          scope_glob: '**/*.ts',
          core: false,
          priority: 50,
          content: 'Preserve local handle tier classification across telemetry refreshes.',
          origin: 'evolved',
        });
        const dispatcher = new EvoMcpDispatcher(ws);
        try {
          const inspectRes = await dispatcher.handleToolCallAsync('evo_inspect', {
            id: 'local-only-guard',
            tier: 'L2',
            workspace: ws,
          });
          assert.ok(!inspectRes.isError);
          const telCheck = new EvoTelemetry(localStorage);
          try {
            const recalled = telCheck.getRecalledCapabilities();
            const hit = recalled.find((r) => r.id === 'local-only-guard');
            assert.ok(hit, 'local-only-guard should be recorded in recalled_capabilities');
            assert.equal(hit!.tier, 'LOCAL', 'Local capability must retain tier === LOCAL');
          } finally {
            telCheck.close();
          }
        } finally {
          dispatcher.close();
        }
      } finally {
        if (prevGlobal === undefined) delete process.env.EVO_GLOBAL_DIR;
        else process.env.EVO_GLOBAL_DIR = prevGlobal;
      }
    } finally {
      safeCleanup(tmp);
    }
  });

  test('2. [B1 #32-3] 3-stage umbrella waterfall resolves Stage 2 transcript path & Stage 3 single-active adopt vs multi-active fail-closed', () => {
    const tmp = createTempDir('evo-b1-');
    try {
      const fakeHome = path.join(tmp, 'home');
      const globalDir = path.join(tmp, 'global');
      fs.mkdirSync(fakeHome, { recursive: true });

      const umbrella = path.join(tmp, 'umbrella');
      const alpha = path.join(umbrella, 'repo-alpha');
      const beta = path.join(umbrella, 'repo-beta');
      fs.mkdirSync(path.join(alpha, 'src'), { recursive: true });
      fs.mkdirSync(path.join(beta, 'src'), { recursive: true });
      fs.writeFileSync(path.join(alpha, 'src', 'app.ts'), 'export const a = 1;\n', 'utf8');
      fs.writeFileSync(path.join(beta, 'src', 'app.ts'), 'export const b = 2;\n', 'utf8');

      const stAlpha = new EvoStorage(alpha);
      stAlpha.ensureInitialized();
      const stBeta = new EvoStorage(beta);
      stBeta.ensureInitialized();

      // Seed active telemetry DBs
      new EvoTelemetry(stAlpha).close();
      new EvoTelemetry(stBeta).close();

      // Stage 2: transcript edit_file path pointing into repo-alpha -> resolves alpha ONLY
      const trStage2 = path.join(tmp, 'tr-stage2.jsonl');
      const stage2Steps = [
        { step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Fix app.ts' },
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          tool_calls: [{ name: 'edit_file', arguments: { Path: path.join(alpha, 'src', 'app.ts') } }],
        },
      ];
      fs.writeFileSync(trStage2, stage2Steps.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
      const resStage2 = runAgyHook(
        'Stop',
        { conversationId: 'b1-stage2', transcriptPath: trStage2, cwd: umbrella, workspace: umbrella },
        { cwd: umbrella, env: makeIsolatedEnv(fakeHome, globalDir), statePath: path.join(tmp, 'st2.json') }
      );
      assert.equal(resStage2.status, 0);

      const alphaTel = new EvoTelemetry(stAlpha);
      const betaTel = new EvoTelemetry(stBeta);
      try {
        assert.equal(
          alphaTel.getSessionFlag('active_session_epoch'),
          'b1-stage2',
          'Stage 2 transcript path should resolve repo-alpha and sync active_session_epoch'
        );
        assert.equal(
          betaTel.getSessionFlag('active_session_epoch'),
          null,
          'Stage 2 must NOT touch sibling repo-beta'
        );
      } finally {
        alphaTel.close();
        betaTel.close();
      }

      // Stage 3a: No transcript paths, ONLY svc-a has <30m recalled_capabilities -> adopt svc-a
      const umbrella3 = path.join(tmp, 'umbrella3');
      const svcA = path.join(umbrella3, 'svc-a');
      const svcB = path.join(umbrella3, 'svc-b');
      fs.mkdirSync(svcA, { recursive: true });
      fs.mkdirSync(svcB, { recursive: true });
      const stSvcA = new EvoStorage(svcA);
      stSvcA.ensureInitialized();
      const stSvcB = new EvoStorage(svcB);
      stSvcB.ensureInitialized();

      const telSvcA = new EvoTelemetry(stSvcA);
      telSvcA.recordRecalledCapability({ id: 'cap-a', kind: 'rule', tier: 'LOCAL' });
      telSvcA.close();
      new EvoTelemetry(stSvcB).close();

      const trEmpty = path.join(tmp, 'tr-empty.jsonl');
      fs.writeFileSync(
        trEmpty,
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Review logs' }) + '\n',
        'utf8'
      );
      const res3a = runAgyHook(
        'Stop',
        { conversationId: 'b1-stage3-single', transcriptPath: trEmpty, cwd: umbrella3, workspace: umbrella3 },
        { cwd: umbrella3, env: makeIsolatedEnv(fakeHome, globalDir), statePath: path.join(tmp, 'st3a.json') }
      );
      assert.equal(res3a.status, 0);

      const chkA1 = new EvoTelemetry(stSvcA);
      const chkB1 = new EvoTelemetry(stSvcB);
      try {
        assert.equal(chkA1.getSessionFlag('active_session_epoch'), 'b1-stage3-single');
        assert.equal(chkB1.getSessionFlag('active_session_epoch'), null);
      } finally {
        chkA1.close();
        chkB1.close();
      }

      // Stage 3b: Both svc-a and svc-b have <30m recalled_capabilities -> FAIL CLOSED (touch neither)
      // (Re-arm svc-a since res3a legitimately consumed svc-a's recalled_capabilities on Stop)
      const telSvcARearm = new EvoTelemetry(stSvcA);
      telSvcARearm.recordRecalledCapability({ id: 'cap-a', kind: 'rule', tier: 'LOCAL' });
      telSvcARearm.close();
      const telSvcB = new EvoTelemetry(stSvcB);
      telSvcB.recordRecalledCapability({ id: 'cap-b', kind: 'rule', tier: 'LOCAL' });
      telSvcB.close();

      const res3b = runAgyHook(
        'Stop',
        { conversationId: 'b1-stage3-ambiguous', transcriptPath: trEmpty, cwd: umbrella3, workspace: umbrella3 },
        { cwd: umbrella3, env: makeIsolatedEnv(fakeHome, globalDir), statePath: path.join(tmp, 'st3b.json') }
      );
      assert.equal(res3b.status, 0);

      const chkA2 = new EvoTelemetry(stSvcA);
      const chkB2 = new EvoTelemetry(stSvcB);
      try {
        assert.equal(
          chkA2.getSessionFlag('active_session_epoch'),
          'b1-stage3-single',
          'Ambiguous 2-active-child umbrella must fail closed without overwriting svc-a epoch'
        );
        assert.equal(
          chkB2.getSessionFlag('active_session_epoch'),
          null,
          'Ambiguous 2-active-child umbrella must fail closed without writing svc-b epoch'
        );
      } finally {
        chkA2.close();
        chkB2.close();
      }
    } finally {
      safeCleanup(tmp);
    }
  });

  test('3. [B2 #31-3] Cross-chat session isolation via active_session_epoch isolates Anti-Poisoning Guard', async () => {
    const tmp = createTempDir('evo-b2-');
    const prevGlobal = process.env.EVO_GLOBAL_DIR;
    try {
      const fakeHome = path.join(tmp, 'home');
      const globalDir = path.join(tmp, 'global');
      const ws = path.join(tmp, 'ws');
      fs.mkdirSync(fakeHome, { recursive: true });
      fs.mkdirSync(ws, { recursive: true });
      process.env.EVO_GLOBAL_DIR = globalDir;

      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      new EvoTelemetry(storage).close();

      // Transcript in epoch-A triggers Stop -> sets active_session_epoch = 'epoch-A'
      const trA = path.join(tmp, 'tr-a.jsonl');
      fs.writeFileSync(
        trA,
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Analyze caching' }) + '\n',
        'utf8'
      );
      runAgyHook(
        'Stop',
        { conversationId: 'epoch-A', transcriptPath: trA, cwd: ws, workspace: ws },
        { cwd: ws, env: makeIsolatedEnv(fakeHome, globalDir), statePath: path.join(tmp, 'state-a.json') }
      );

      const dispatcher = new EvoMcpDispatcher(ws);
      try {
        const propRes = await dispatcher.handleToolCallAsync('evo_propose', {
          kind: 'rule',
          id: 'session-epoch-rule',
          title: 'Session Epoch Validation Rule',
          l0_summary: 'Validate session epoch boundary isolation across agent chats.',
          scope_glob: '**/*.ts',
          core: false,
          content: 'Always isolate active session state per conversation epoch identifier to prevent cross-chat contamination.',
          transfer_scenarios: [
            'Isolating MCP anti-poisoning guards across concurrent IDE chat sessions.',
            'Separating CLI hook reminders when switching workspaces between turns.',
          ],
          contrastive_evidence:
            'Before epoch isolation, prior chat reminders bled into new conversations; after scoping by active_session_epoch, switching chats isolates guard state cleanly.',
          workspace: ws,
        });
        assert.ok(!propRes.isError, `session-epoch-rule failed: ${propRes.content?.[0]?.text}`);

        // Same epoch-A search shows Anti-Poisoning Guard
        const searchSame = await dispatcher.handleToolCallAsync('evo_search', {
          query: 'session epoch',
          workspace: ws,
        });
        const textSame = String(searchSame.content?.[0]?.text || '');
        assert.match(textSame, /Anti-Poisoning Guard/, 'Same epoch should surface Anti-Poisoning Guard');
        assert.match(textSame, /session-epoch-rule/);

        // Switch conversation -> hook updates active_session_epoch to 'epoch-B'
        runAgyHook(
          'Stop',
          { conversationId: 'epoch-B', transcriptPath: trA, cwd: ws, workspace: ws },
          { cwd: ws, env: makeIsolatedEnv(fakeHome, globalDir), statePath: path.join(tmp, 'state-b.json') }
        );

        const searchOther = await dispatcher.handleToolCallAsync('evo_search', {
          query: 'session epoch',
          workspace: ws,
        });
        const textOther = String(searchOther.content?.[0]?.text || '');
        assert.doesNotMatch(
          textOther,
          /Anti-Poisoning Guard/,
          'New conversation epoch-B must NOT inherit epoch-A Anti-Poisoning Guard'
        );
      } finally {
        dispatcher.close();
      }
    } finally {
      if (prevGlobal === undefined) delete process.env.EVO_GLOBAL_DIR;
      else process.env.EVO_GLOBAL_DIR = prevGlobal;
      safeCleanup(tmp);
    }
  });

  test('4. [B3 #32-7] Concurrent non-blocking evo_run + multi-workspace evo_search isolation + serialized evo_propose write lock', async () => {
    const tmp = createTempDir('evo-b3-');
    const prevGlobal = process.env.EVO_GLOBAL_DIR;
    try {
      const globalDir = path.join(tmp, 'global');
      const ws1 = path.join(tmp, 'ws1');
      const ws2 = path.join(tmp, 'ws2');
      fs.mkdirSync(ws1, { recursive: true });
      fs.mkdirSync(ws2, { recursive: true });
      process.env.EVO_GLOBAL_DIR = globalDir;

      const s1 = new EvoStorage(ws1);
      s1.ensureInitialized();
      const s2 = new EvoStorage(ws2);
      s2.ensureInitialized();

      s1.saveRule({
        id: 'alpha-ws1-token',
        title: 'Alpha Workspace One Only',
        l0_summary: 'Workspace one exclusive concurrency capability alphaonlykey.',
        scope_glob: '**/*.ts',
        core: false,
        priority: 50,
        content: 'Keep alphaonlykey strictly isolated inside workspace one telemetry.',
        origin: 'evolved',
      });
      s2.saveRule({
        id: 'beta-ws2-token',
        title: 'Beta Workspace Two Only',
        l0_summary: 'Workspace two exclusive concurrency capability betaonlykey.',
        scope_glob: '**/*.ts',
        core: false,
        priority: 50,
        content: 'Keep betaonlykey strictly isolated inside workspace two telemetry.',
        origin: 'evolved',
      });

      const slowScript = [
        "if (process.argv.includes('--self-test') || process.env.EVO_SELF_TEST === '1') { process.exit(0); }",
        'setTimeout(() => { console.log(JSON.stringify({ ok: true })); process.exit(0); }, 250);',
      ].join('\n');
      const g1 = new EvoGatekeeper(s1, new EvoTelemetry(s1));
      const toolProp = await g1.evaluateAndCommitAsync({
        kind: 'tool',
        id: 'slow-concurrent-tool',
        title: 'Slow Concurrent Tool',
        l0_summary: 'Delays briefly to test concurrent non-blocking dispatch',
        runtime: 'node',
        script_code: slowScript,
        self_test_args: ['--self-test'],
      });
      assert.equal(toolProp.passed, true);

      const dispatcher = new EvoMcpDispatcher(ws1);
      try {
        const [runRes, search1, search2] = await Promise.all([
          dispatcher.handleToolCallAsync('evo_run', {
            tool_id: 'slow-concurrent-tool',
            args: {},
            workspace: ws1,
          }),
          dispatcher.handleToolCallAsync('evo_search', {
            query: 'alphaonlykey',
            workspace: ws1,
          }),
          dispatcher.handleToolCallAsync('evo_search', {
            query: 'alphaonlykey',
            workspace: ws2,
          }),
        ]);

        assert.ok(!runRes.isError, `Slow concurrent evo_run failed: ${runRes.content?.[0]?.text}`);
        assert.match(String(search1.content?.[0]?.text || ''), /alpha-ws1-token/);
        assert.doesNotMatch(
          String(search2.content?.[0]?.text || ''),
          /alpha-ws1-token/,
          'ws2 must NOT see ws1 capability across concurrent calls'
        );

        // Concurrent evo_propose writes on same workspace serialize via withWorkspaceWriteLock
        const [pA, pB] = await Promise.all([
          dispatcher.handleToolCallAsync('evo_propose', {
            kind: 'rule',
            id: 'concurrent-write-rule-a',
            title: 'Concurrent Write Serialization Alpha',
            l0_summary: 'First serialized rule write check.',
            scope_glob: '**/*.ts',
            core: false,
            content: 'Always serialize metadata mutations per workspace using FIFO promise mutex chains.',
            transfer_scenarios: [
              'Serializing parallel MCP proposal writes targeting the same local SQLite telemetry DB.',
              'Preventing lost disk index updates when multiple workers propose rules concurrently.',
            ],
            workspace: ws1,
          }),
          dispatcher.handleToolCallAsync('evo_propose', {
            kind: 'rule',
            id: 'concurrent-write-rule-b',
            title: 'Concurrent Write Serialization Beta',
            l0_summary: 'Second serialized rule write check.',
            scope_glob: '**/*.ts',
            core: false,
            content: 'Verify concurrent schema persistence completes without SQLITE_BUSY or dropped index rows.',
            transfer_scenarios: [
              'Serializing concurrent compaction and proposal commits inside shared dispatchers.',
              'Maintaining deterministic disk and SQLite parity under high-frequency agent tool bursts.',
            ],
            workspace: ws1,
          }),
        ]);
        assert.ok(!pA.isError, `pA failed: ${pA.content?.[0]?.text}`);
        assert.ok(!pB.isError, `pB failed: ${pB.content?.[0]?.text}`);
        assert.ok(s1.getRule('concurrent-write-rule-a'));
        assert.ok(s1.getRule('concurrent-write-rule-b'));
      } finally {
        dispatcher.close();
      }
    } finally {
      if (prevGlobal === undefined) delete process.env.EVO_GLOBAL_DIR;
      else process.env.EVO_GLOBAL_DIR = prevGlobal;
      safeCleanup(tmp);
    }
  });

  test('4.5/5. [B4 #32-4a/#32-5] Metadata edit preserves anchor on OTHER_BRANCH; empty ast_fingerprints verifies Git baseline & MID confidence', () => {
    const tmp = createTempDir('evo-b4-');
    try {
      const ws = path.join(tmp, 'repo');
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      initGitRepo(ws, 'main');
      fs.writeFileSync(
        path.join(ws, 'src', 'target.ts'),
        'export function computeRate(a: number, b: number): number {\n  if (b === 0) return 0;\n  return a / b;\n}\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(ws, 'src', 'mod.ts'),
        'export const INITIAL_LIMIT = 42;\n',
        'utf8'
      );
      fs.writeFileSync(path.join(ws, '.gitignore'), '.evo/\n', 'utf8');
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      const baseCommit = commitAll(ws, 'initial commit');

      // Create feature branch with computeRate fixed, commit, then propose memory anchored there
      execSync('git checkout -b feature/orig', { cwd: ws, stdio: 'pipe' });
      fs.writeFileSync(path.join(ws, 'src', 'feature-note.ts'), 'export const featureFlag = true;\n', 'utf8');
      commitAll(ws, 'feature commit');
      const tel = new EvoTelemetry(storage);
      const gk = new EvoGatekeeper(storage, tel);
      try {
        const memRes = gk.evaluateAndCommit({
          kind: 'memory',
          id: 'rate-div-zero-case',
          title: 'Division guard memory',
          l0_summary: 'Original l0 summary.',
          target_symbols: ['src/target.ts#computeRate'],
          symptom: 'Divide by zero returns Infinity in computeRate.',
          root_cause: 'Missing divisor zero check in src/target.ts#computeRate.',
          solution: 'Return 0 when b === 0 in src/target.ts#computeRate.',
        });
        assert.equal(memRes.passed, true);
        const origMem = storage.getMemory('rate-div-zero-case')!;
        assert.equal(origMem.created_branch, 'feature/orig');

        // Switch to main and diverge src/target.ts so feature/orig memory is OTHER_BRANCH
        execSync('git checkout main', { cwd: ws, stdio: 'pipe' });
        fs.writeFileSync(
          path.join(ws, 'src', 'target.ts'),
          'export function computeRate(a: number, b: number): number {\n  throw new Error("reverted on main");\n}\n',
          'utf8'
        );
        commitAll(ws, 'main diverged');
        clearGitPathsCache();
        clearMemoryVerificationCache();

        const preVer = verifyMemoryFreshness(ws, origMem);
        assert.equal(preVer.overall_status, 'OTHER_BRANCH');

        const editRes = gk.evaluateAndCommit(
          {
            kind: 'memory',
            id: 'rate-div-zero-case',
            title: 'Division guard memory (clarified)',
            l0_summary: 'Clarified metadata summary while staying on main.',
            target_symbols: ['src/target.ts#computeRate'],
            symptom: origMem.symptom,
            root_cause: origMem.root_cause,
            solution: origMem.solution,
            supersedes_id: 'rate-div-zero-case',
          },
          { preserveAnchorOnMetadataEdit: true }
        );
        assert.equal(editRes.passed, true, `Metadata edit failed: ${editRes.message}`);
        const afterMem = storage.getMemory('rate-div-zero-case')!;
        assert.equal(afterMem.created_commit, origMem.created_commit);
        assert.equal(
          afterMem.ast_fingerprints['src/target.ts#computeRate'].ast_hash,
          origMem.ast_fingerprints['src/target.ts#computeRate'].ast_hash
        );

        // B4 part 2: Empty ast_fingerprints Git baseline check + MID confidence when uncommitted
        const emptyAnchorMem = {
          ...origMem,
          id: 'empty-fp-mem',
          target_symbols: ['src/mod.ts'],
          ast_fingerprints: {},
          created_commit: baseCommit,
          created_branch: 'main',
        };
        storage.saveMemory(emptyAnchorMem);
        clearMemoryVerificationCache();
        const matchGitVer = verifyMemoryFreshness(ws, emptyAnchorMem);
        assert.equal(matchGitVer.overall_status, 'VERIFIED');
        assert.equal(matchGitVer.confidence_tag, '[置信度: HIGH (≥80%)]');

        // Modify src/mod.ts -> empty ast_fingerprints must detect Git baseline drift -> STALE
        fs.writeFileSync(path.join(ws, 'src', 'mod.ts'), 'export const INITIAL_LIMIT = 99;\n', 'utf8');
        clearMemoryVerificationCache();
        const driftedVer = verifyMemoryFreshness(ws, emptyAnchorMem);
        assert.equal(driftedVer.overall_status, 'STALE');

        // Uncommitted empty-anchor memory gets MID confidence instead of overclaiming HIGH
        const uncommittedMem = {
          ...emptyAnchorMem,
          id: 'uncommitted-empty-fp',
          created_commit: 'uncommitted',
        };
        storage.saveMemory(uncommittedMem);
        clearMemoryVerificationCache();
        const midVer = verifyMemoryFreshness(ws, uncommittedMem);
        assert.equal(midVer.overall_status, 'VERIFIED');
        assert.equal(midVer.confidence_tag, '[置信度: MID (50–80%)]');
      } finally {
        tel.close();
      }
    } finally {
      safeCleanup(tmp);
    }
  });

  test('6. [B5 #33-2a] isValidContrastiveEvidence blocks boilerplate, bare paths & hallucinated files while permitting grounded evidence', () => {
    const tmp = createTempDir('evo-b5-');
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'src', 'rateLimiter.ts'),
        'export function throttleRequests(maxPerMinute: number): boolean { return maxPerMinute > 0; }\n',
        'utf8'
      );

      // Rejected cases
      assert.equal(
        isValidContrastiveEvidence('Before fix it failed; after fix it passed tests', tmp),
        false,
        'Stopword-heavy generic boilerplate must fail'
      );
      assert.equal(
        isValidContrastiveEvidence('before src/a.ts after src/a.ts', tmp),
        false,
        'Bare file path without causal tokens must fail'
      );
      assert.equal(
        isValidContrastiveEvidence(
          'Before ghost/nonexistentModule.ts threw TypeError -> after ghost/nonexistentModule.ts returned true',
          tmp
        ),
        false,
        'Hallucinated code path absent from workspace must fail'
      );

      // Accepted case grounded in workspace file/symbol
      assert.equal(
        isValidContrastiveEvidence(
          'Before guarding throttleRequests in src/rateLimiter.ts, zero maxPerMinute failed validation; after clamping > 0, throttleRequests returns boolean safely.',
          tmp
        ),
        true
      );
    } finally {
      safeCleanup(tmp);
    }
  });

  test('7. [B6 #33-1] 3-Ring Security Defense blocks obfuscated fs.rmSync & default outbound fetch(), and ephemeral os.tmpdir() self-test isolates live workspace', async () => {
    const tmp = createTempDir('evo-b6-');
    try {
      const ws = path.join(tmp, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      const canaryPath = path.join(ws, 'canary.txt');
      fs.writeFileSync(canaryPath, 'DO_NOT_TOUCH', 'utf8');

      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      const tel = new EvoTelemetry(storage);
      const gk = new EvoGatekeeper(storage, tel);

      try {
        // Ring 1a: Comment-split fs/* bypass */['r'+'m'] & root rmSync obfuscation
        const obfRes = await gk.evaluateAndCommitAsync({
          kind: 'tool',
          id: 'obfuscated-rm',
          title: 'Obfuscated Removal',
          l0_summary: 'Attempts comment bypass',
          runtime: 'node',
          script_code:
            "import fs from 'node:fs';\nif (process.argv.includes('--self-test')) process.exit(0);\nfs/* bypass */['r' + 'mSync']('/', { recursive: true });",
        });
        assert.equal(obfRes.passed, false);
        assert.equal(obfRes.error_code, 'ERR_SECURITY_VIOLATION');

        // Ring 1b: String.fromCharCode evasion
        const charCodeRes = await gk.evaluateAndCommitAsync({
          kind: 'tool',
          id: 'charcode-tool',
          title: 'CharCode Evasion',
          l0_summary: 'Uses String.fromCharCode bypass',
          runtime: 'node',
          script_code:
            "if (process.argv.includes('--self-test')) process.exit(0);\nconst s = String.fromCharCode(114, 109, 32, 45, 114, 102);\nconsole.log(s);",
        });
        assert.equal(charCodeRes.passed, false);
        assert.equal(charCodeRes.error_code, 'ERR_SECURITY_VIOLATION');

        // Ring 2: fetch() blocked by default, permitted when allowNetworkTools: true
        const fetchToolPayload = {
          kind: 'tool' as const,
          id: 'net-health-probe',
          title: 'Network Health Probe',
          l0_summary: 'Probes configured health URL when opted in',
          runtime: 'node' as const,
          script_code: [
            "if (process.argv.includes('--self-test') || process.env.EVO_SELF_TEST === '1') { console.log('ok'); process.exit(0); }",
            "const targetUrl = 'https://example.com';",
            'fetch(targetUrl).catch(() => {});',
          ].join('\n'),
          self_test_args: ['--self-test'],
        };
        const blockedNet = await gk.evaluateAndCommitAsync(fetchToolPayload);
        assert.equal(blockedNet.passed, false);
        assert.equal(blockedNet.error_code, 'ERR_SECURITY_VIOLATION');

        const cfg = storage.getConfig();
        storage.saveConfig({ ...cfg, allowNetworkTools: true });
        const allowedNet = await gk.evaluateAndCommitAsync(fetchToolPayload);
        assert.equal(allowedNet.passed, true, `Expected allowNetworkTools:true to permit fetch(): ${allowedNet.message}`);

        // Ring 3: Ephemeral os.tmpdir() self-test catches canary mutation while keeping REAL workspace untouched
        const mutatingScript = [
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          "const root = process.env.EVO_WORKSPACE || process.cwd();",
          "fs.writeFileSync(path.join(root, 'canary.txt'), 'CORRUPTED_BY_SELFTEST', 'utf8');",
          'process.exit(0);',
        ].join('\n');
        const mutateRes = await gk.evaluateAndCommitAsync({
          kind: 'tool',
          id: 'mutating-selftest-tool',
          title: 'Mutating Self-Test Tool',
          l0_summary: 'Writes into workspace during self-test',
          runtime: 'node',
          script_code: mutatingScript,
          self_test_args: ['--self-test'],
        });
        assert.equal(mutateRes.passed, false);
        assert.equal(mutateRes.error_code, 'ERR_SANDBOX_SELF_TEST');
        assert.equal(
          fs.readFileSync(canaryPath, 'utf8'),
          'DO_NOT_TOUCH',
          'Real workspace file must remain completely untouched via ephemeral tmpdir staging'
        );
      } finally {
        tel.close();
      }
    } finally {
      safeCleanup(tmp);
    }
  });

  test('8. [B7 #33-3] End-to-end async pipeline (checkScriptSyntaxAsync, evaluateAndCommitAsync, verifyMemoryFreshnessAsync, handleToolCallAsync)', async () => {
    const tmp = createTempDir('evo-b7-');
    const prevGlobal = process.env.EVO_GLOBAL_DIR;
    try {
      const ws = path.join(tmp, 'ws');
      const globalDir = path.join(tmp, 'global');
      process.env.EVO_GLOBAL_DIR = globalDir;
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      initGitRepo(ws, 'main');
      fs.writeFileSync(
        path.join(ws, 'src', 'asyncMod.ts'),
        'export async function fetchItem(id: string): Promise<string> { return id.trim(); }\n',
        'utf8'
      );
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      commitAll(ws, 'init async mod');

      const okSyntax = await checkScriptSyntaxAsync('node', 'const x = 1 + 2; console.log(x);');
      const badSyntax = await checkScriptSyntaxAsync('node', 'const x = ((((;');
      assert.equal(okSyntax.valid, true);
      assert.equal(badSyntax.valid, false);

      const tel = new EvoTelemetry(storage);
      const gk = new EvoGatekeeper(storage, tel);
      try {
        const propRes = await gk.evaluateAndCommitAsync({
          kind: 'memory',
          id: 'async-pipeline-mem',
          title: 'Async Mod Trim Guard',
          l0_summary: 'Verifies async verification pipeline parity',
          target_symbols: ['src/asyncMod.ts#fetchItem'],
          symptom: 'Untrimmed ID caused lookup miss.',
          root_cause: 'fetchItem lacked trim normalization.',
          solution: 'Trim string id inside fetchItem.',
        });
        assert.equal(propRes.passed, true);
        const mem = storage.getMemory('async-pipeline-mem')!;
        const verAsync = await verifyMemoryFreshnessAsync(ws, mem);
        const verSync = verifyMemoryFreshness(ws, mem);
        assert.equal(verAsync.overall_status, verSync.overall_status);
        assert.equal(verAsync.overall_status, 'VERIFIED');
      } finally {
        tel.close();
      }

      const dispatcher = new EvoMcpDispatcher(ws);
      try {
        const res = await dispatcher.handleToolCallAsync('evo_search', {
          query: 'fetchItem async',
          workspace: ws,
        });
        assert.ok(!res.isError);
        assert.match(String(res.content?.[0]?.text || ''), /async-pipeline-mem/);
      } finally {
        dispatcher.close();
      }
    } finally {
      if (prevGlobal === undefined) delete process.env.EVO_GLOBAL_DIR;
      else process.env.EVO_GLOBAL_DIR = prevGlobal;
      safeCleanup(tmp);
    }
  });

  test('9. [B8 #33-5b] Zero private skill IDs in ui.ts, dynamic seed discovery, visibility:local filtering & --anon event pseudonymization', () => {
    const uiSrc = fs.readFileSync(path.resolve(process.cwd(), 'src', 'cli', 'ui.ts'), 'utf8');
    for (const forbidden of [
      'ceo-team-orchestrator',
      'dual-agent-team',
      'embedded-power-bms-guardrail',
      'localOnlyIds',
      'seedAllowedIds',
    ]) {
      assert.equal(uiSrc.includes(forbidden), false, `src/cli/ui.ts must not contain ${forbidden}`);
    }

    const tmp = createTempDir('evo-b8-');
    try {
      const ws = path.join(tmp, 'self-evo-fixture');
      fs.mkdirSync(path.join(ws, 'templates', 'seed-evo', 'tools', 'dynamic-seed-checker'), {
        recursive: true,
      });
      fs.mkdirSync(path.join(ws, 'src', 'core'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'src', 'core', 'gatekeeper.ts'), 'export {};\n', 'utf8');
      fs.writeFileSync(
        path.join(ws, 'templates', 'seed-evo', 'tools', 'dynamic-seed-checker', 'SKILL.md'),
        '---\nid: dynamic-seed-checker\ntitle: "Dynamic Seed Checker"\n---\n',
        'utf8'
      );

      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      const cfg = storage.getConfig();
      storage.saveConfig({ ...cfg, anonExcludeIds: ['excluded-by-cfg'] });

      storage.saveTool(
        {
          id: 'dynamic-seed-checker',
          title: 'Dynamic Seed Checker',
          l0_summary: 'Discovered dynamically from templates/seed-evo.',
          runtime: 'node',
          entry_script: 'run.mjs',
          self_test_args: ['--self-test'],
          origin: 'evolved',
        },
        'process.exit(0);'
      );
      storage.saveRule({
        id: 'private-local-rule',
        title: 'Private Local Workflow',
        l0_summary: 'Should be filtered by visibility local',
        scope_glob: '**/*.ts',
        core: false,
        priority: 50,
        content: 'Do not leak internal rule during anon export.',
        visibility: 'local',
        origin: 'evolved',
      });
      storage.saveRule({
        id: 'excluded-by-cfg',
        title: 'Excluded By Config Rule',
        l0_summary: 'Should be filtered by anonExcludeIds',
        scope_glob: '**/*.ts',
        core: false,
        priority: 50,
        content: 'Do not leak configured exclusion rule.',
        origin: 'evolved',
      });

      const tel = new EvoTelemetry(storage);
      try {
        tel.recordGatekeeperEvent(
          {
            kind: 'rule',
            targetId: 'private-local-rule',
            targetName: 'Private Local Workflow',
            passed: false,
            stageFailed: 'SCHEMA_SECURITY',
            diagnostics: 'Denied private rule',
          },
          ws
        );
        tel.recordGatekeeperEvent(
          {
            kind: 'rule',
            targetId: 'unlisted-secret-cap',
            targetName: 'Unlisted Secret Cap',
            passed: false,
            stageFailed: 'ABSTRACTION_GATE',
            diagnostics: 'Rejected secret rule',
          },
          ws
        );
      } finally {
        tel.close();
      }

      const snap = buildUiSnapshot(ws, { anon: true });
      const ruleIds = new Set(snap.rules.map((r: any) => r.id));
      const toolIds = new Set(snap.tools.map((t: any) => t.id));
      assert.equal(toolIds.has('dynamic-seed-checker'), true, 'Dynamic seed discovered from templates/seed-evo must be included');
      assert.equal(ruleIds.has('private-local-rule'), false, 'visibility: local rule must be hidden in anon snapshot');
      assert.equal(ruleIds.has('excluded-by-cfg'), false, 'anonExcludeIds rule must be hidden in anon snapshot');

      const eventIds = snap.gatekeeperEvents.map((e: any) => String(e.target_id || ''));
      assert.equal(eventIds.includes('private-local-rule'), false, 'Hidden local rule event must be stripped');
      assert.equal(eventIds.includes('unlisted-secret-cap'), false, 'Non-seed event target_id must be pseudonymized');
      assert.ok(
        eventIds.some((id) => /^sanitized-rule-\d+$/.test(id)),
        'Non-seed event target_id must be pseudonymized to sanitized-rule-<N>'
      );
    } finally {
      safeCleanup(tmp);
    }
  });

  test('10. [B9 #33-2b/#33-5c] Identifier splitting, English stemming, lazy fuzzy recall, <150-line facades & barrel re-export symbol following', async () => {
    // Lexicon tokenization & stemming
    const splitParts = splitCompoundIdentifier('evo_config_auditorV2/gate1_5');
    assert.ok(splitParts.includes('evo'));
    assert.ok(splitParts.includes('config'));
    assert.ok(splitParts.includes('auditor'));

    assert.equal(stemEnglishToken('caching'), 'cache');
    assert.equal(stemEnglishToken('modifications'), 'modify');
    assert.equal(stemEnglishToken('args'), 'args');

    // <150-line facades
    const memoryFacadeLines = fs
      .readFileSync(path.resolve(process.cwd(), 'src', 'core', 'memory.ts'), 'utf8')
      .split(/\r?\n/).length;
    const gatekeeperFacadeLines = fs
      .readFileSync(path.resolve(process.cwd(), 'src', 'core', 'gatekeeper.ts'), 'utf8')
      .split(/\r?\n/).length;
    assert.ok(memoryFacadeLines < 150, `src/core/memory.ts should be < 150 lines, got ${memoryFacadeLines}`);
    assert.ok(gatekeeperFacadeLines < 150, `src/core/gatekeeper.ts should be < 150 lines, got ${gatekeeperFacadeLines}`);

    const tmp = createTempDir('evo-b9-');
    try {
      const ws = path.join(tmp, 'ws');
      fs.mkdirSync(path.join(ws, 'src', 'sub', 'deep'), { recursive: true });
      fs.writeFileSync(
        path.join(ws, 'src', 'barrel.ts'),
        "export * from './sub/impl.js';\nexport { hiddenLeafHelper } from './sub/index.js';\n",
        'utf8'
      );
      fs.writeFileSync(
        path.join(ws, 'src', 'sub', 'index.ts'),
        "export { hiddenLeafHelper } from './deep/leaf.js';\n",
        'utf8'
      );
      fs.writeFileSync(
        path.join(ws, 'src', 'sub', 'impl.ts'),
        'export function barrelTargetFn(x: number): number { return x * 2; }\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(ws, 'src', 'sub', 'deep', 'leaf.ts'),
        'export function hiddenLeafHelper(v: string): string { return v.toUpperCase(); }\n',
        'utf8'
      );

      // Barrel re-export symbol resolution (depth 1 and depth 2)
      const targets = resolveBarrelReexportTargets(ws, 'src/barrel.ts', 2);
      assert.ok(targets.some((t) => t.endsWith(path.join('sub', 'impl.ts'))));
      assert.ok(targets.some((t) => t.endsWith(path.join('deep', 'leaf.ts'))));

      const fp1 = extractSymbolFingerprint(ws, 'src/barrel.ts#barrelTargetFn');
      const fp2 = await extractSymbolFingerprintAsync(ws, 'src/barrel.ts#hiddenLeafHelper');
      assert.ok(fp1 && fp1.ast_hash, 'Depth-1 barrel re-export symbol must resolve');
      assert.ok(fp2 && fp2.ast_hash, 'Depth-2 barrel re-export symbol must resolve');

      // Lazy fuzzy recall on typo query ("gatekeper")
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      storage.saveRule({
        id: 'gatekeeper-policy-guard',
        title: 'Gatekeeper Policy Guard',
        l0_summary: 'Validates security and abstraction gates.',
        scope_glob: '**/*.ts',
        core: false,
        priority: 50,
        content: 'Run gatekeeper validation before writing capabilities.',
        origin: 'evolved',
      });
      const tel = new EvoTelemetry(storage);
      try {
        const typoHits = tel.search('gatekeper', 'all', 5, ws);
        assert.ok(
          typoHits.some((h) => h.id === 'gatekeeper-policy-guard'),
          '1-edit typo "gatekeper" should trigger lazy fuzzy fallback and match gatekeeper-policy-guard'
        );
        const junkHits = tel.search('zzzzqqqqxxxx', 'all', 5, ws);
        assert.equal(junkHits.length, 0, 'Unrelated junk query should still return 0 hits');
      } finally {
        tel.close();
      }
    } finally {
      safeCleanup(tmp);
    }

    // Live agy-config-auditor verifies 0 broken memory symbols across split facades
    const audTmp = createTempDir('evo-b9-aud-');
    try {
      const aud = spawnSync(process.execPath, [AUDITOR_SCRIPT], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          EVO_WORKSPACE: process.cwd(),
          EVO_GLOBAL_DIR: path.join(audTmp, 'global'),
        },
      });
      assert.equal(aud.status, 0, `agy-config-auditor failed: ${aud.stderr}\n${aud.stdout}`);
      const parsed = JSON.parse(aud.stdout);
      assert.equal(parsed.status, 'HEALTHY');
      assert.equal(parsed.summary.broken_memory_symbols, 0);

      // H6: --self-test mode passes independently via its isolated temp fixture
      const selfTestAud = spawnSync(process.execPath, [AUDITOR_SCRIPT, '--self-test'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          EVO_WORKSPACE: process.cwd(),
          EVO_SELF_TEST: '1',
          EVO_GLOBAL_DIR: path.join(audTmp, 'global'),
        },
      });
      assert.equal(selfTestAud.status, 0, `agy-config-auditor --self-test failed: ${selfTestAud.stderr}\n${selfTestAud.stdout}`);
      const selfTestParsed = JSON.parse(selfTestAud.stdout);
      assert.equal(selfTestParsed.status, 'HEALTHY');
      assert.equal(selfTestParsed.self_test_assertions, true);
    } finally {
      safeCleanup(audTmp);
    }
  });
});
