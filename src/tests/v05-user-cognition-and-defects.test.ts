import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EvoStorage, estimateTokens } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper, detectPreferenceConflict } from '../core/gatekeeper.js';
import { executeWorkbenchAction } from '../core/workbench-actions.js';
import { recordRecalledOutcomeUnified } from '../core/hook-engine.js';
import { parseMarkdownToPreferenceCandidates } from '../core/profile-import.js';
import {
  WINDSURF_PROFILE_MAX_CHARS,
  cleanGlobalUserProfile,
  discoverGlobalProfileTargets,
  syncGlobalUserProfile,
  truncateProfileBlockForWindsurf,
} from '../core/profile-sync.js';
import { EvoMcpDispatcher, META_MCP_TOOLS } from '../mcp/handlers.js';
import { MCP_INSTRUCTIONS } from '../mcp/server.js';
import { OpenCodeAdapter } from '../cli/harness.js';
import { runHook } from '../cli/hook.js';
import { runInit, runInitGlobal, runUninstall, syncManagedRuleBlocks } from '../cli/init.js';
import { runCli } from '../cli/index.js';
import { inspectMcpTaxSnapshot } from '../cli/score.js';
import { buildUiSnapshot } from '../cli/ui.js';
import { renderEvoTree } from '../cli/visualizer.js';
import {
  L0_META_RULE_SEED,
  PROFILE_MARKER_END,
  PROFILE_MARKER_START,
  renderUserProfileBlock,
} from '../templates/meta-rule.js';
import { renderUiClientHtml } from '../templates/ui-client.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function captureConsoleLog(fn: () => void): string {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...items: unknown[]) => {
    logs.push(items.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = origLog;
  }
  return logs.join('\n');
}

describe('EvoKernel v0.5 User Cognition & Defect Regression Suite (100% Hermetic)', () => {
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

  test('1. D1: All 5 META_MCP_TOOLS omit workspace from required; propose/search/inspect succeed without workspace', async () => {
    assert.strictEqual(META_MCP_TOOLS.length, 5);
    for (const tool of META_MCP_TOOLS) {
      const req = tool.inputSchema.required as readonly string[];
      assert.strictEqual(
        req.includes('workspace'),
        false,
        `${tool.name} must omit 'workspace' from inputSchema.required`
      );
    }

    const blankDir = makeTempDir('evo-v05-d1-blank-');
    const globalRoot = makeTempDir('evo-v05-d1-global-');
    cleanupDirs.push(blankDir, globalRoot);
    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    const dispatcher = new EvoMcpDispatcher(blankDir);
    try {
      const propRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'd1-concise-lead',
        title: 'Lead with bottom-line conclusion',
        l0_summary: 'Start every answer with the final decision before details',
        category: 'communication',
        always_on: true,
        content: 'State the conclusion in the opening sentence before supporting context.',
      });
      assert.notStrictEqual(propRes.isError, true, propRes.content?.[0]?.text);
      const propJson = JSON.parse(propRes.content[0].text);
      assert.strictEqual(propJson.passed, true);
      assert.strictEqual(fs.existsSync(path.join(blankDir, '.evo')), false);

      const searchRes = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'bottom-line conclusion',
        scope: 'global',
      });
      assert.notStrictEqual(searchRes.isError, true, searchRes.content?.[0]?.text);
      assert.ok(searchRes.content[0].text.includes('d1-concise-lead'));

      const inspectRes = await dispatcher.handleToolCallAsync('evo_inspect', {
        id: 'd1-concise-lead',
        tier: 'L2',
      });
      assert.notStrictEqual(inspectRes.isError, true, inspectRes.content?.[0]?.text);
      assert.ok(inspectRes.content[0].text.includes('[PREFERENCE L2] d1-concise-lead'));
    } finally {
      dispatcher.close();
    }
  });

  test('2. D2: Unified executeWorkbenchAction preference lifecycle, buildUiSnapshot merge, and Personal Profile Studio HTML', async () => {
    const ws = makeTempDir('evo-v05-d2-ws-');
    const globalRoot = makeTempDir('evo-v05-d2-global-');
    const hostDir = makeTempDir('evo-v05-d2-host-');
    cleanupDirs.push(ws, globalRoot, hostDir);

    const geminiMd = path.join(hostDir, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# Host\n', 'utf8');
    process.env.EVO_GLOBAL_DIR = globalRoot;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = geminiMd;

    const pStorage = new EvoStorage(ws);
    pStorage.ensureInitialized();
    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();

    // Create preference via workbench action
    const createRes = await executeWorkbenchAction(ws, 'create-preference', {
      id: 'wb-pref-one',
      title: 'Prefer plain bullet delivery',
      l0_summary: 'Summarize work in 3-5 plain-spoken bullets',
      category: 'formatting',
      always_on: true,
      content: 'Use 3-5 short plain-spoken bullets for final delivery.',
      tier: 'GLOBAL',
    });
    assert.strictEqual(createRes.status, 200, JSON.stringify(createRes.body));
    assert.strictEqual(createRes.body.ok, true);
    assert.ok(gStorage.getPreference('wb-pref-one'));

    // Seed a pending preference and approve via approve-item
    gStorage.savePreference({
      id: 'wb-pref-pending',
      title: 'Pending pref',
      l0_summary: 'Pending preference waiting for approval',
      category: 'style',
      always_on: true,
      content: 'Avoid unnecessary jargon.',
      tokens: 20,
      review_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const approveRes = await executeWorkbenchAction(ws, 'approve-item', {
      kind: 'preference',
      id: 'wb-pref-pending',
      tier: 'GLOBAL',
    });
    assert.strictEqual(approveRes.status, 200, JSON.stringify(approveRes.body));
    assert.strictEqual(gStorage.getPreference('wb-pref-pending')?.review_status, 'approved');

    // Update content via workbench action
    const updateRes = await executeWorkbenchAction(ws, 'update-content', {
      kind: 'preference',
      id: 'wb-pref-one',
      tier: 'GLOBAL',
      content: 'Always summarize in 3-4 concise plain bullets without fluff.',
    });
    assert.strictEqual(updateRes.status, 200, JSON.stringify(updateRes.body));
    assert.ok(
      gStorage.getPreference('wb-pref-one')?.content.includes('3-4 concise plain bullets')
    );

    // Toggle enabled false -> true
    const disableRes = await executeWorkbenchAction(ws, 'toggle-enabled', {
      kind: 'preference',
      id: 'wb-pref-one',
      tier: 'GLOBAL',
      enabled: false,
    });
    assert.strictEqual(disableRes.status, 200);
    assert.strictEqual(gStorage.getPreference('wb-pref-one')?.enabled, false);

    const enableRes = await executeWorkbenchAction(ws, 'toggle-enabled', {
      kind: 'preference',
      id: 'wb-pref-one',
      tier: 'GLOBAL',
      enabled: true,
    });
    assert.strictEqual(enableRes.status, 200);
    assert.strictEqual(gStorage.getPreference('wb-pref-one')?.enabled, true);

    // Archive -> Restore -> Undo
    const archiveRes = await executeWorkbenchAction(ws, 'archive-item', {
      kind: 'preference',
      id: 'wb-pref-one',
      tier: 'GLOBAL',
      reason: 'Testing archive',
    });
    assert.strictEqual(archiveRes.status, 200);
    assert.strictEqual(gStorage.getPreference('wb-pref-one'), null);

    const restoreRes = await executeWorkbenchAction(ws, 'restore-item', {
      kind: 'preference',
      id: 'wb-pref-one',
      tier: 'GLOBAL',
    });
    assert.strictEqual(restoreRes.status, 200, JSON.stringify(restoreRes.body));
    assert.ok(gStorage.getPreference('wb-pref-one'));

    // Create another pref and undo it via undo-preference
    await executeWorkbenchAction(ws, 'create-preference', {
      id: 'wb-pref-temp',
      title: 'Temp pref for undo',
      l0_summary: 'Temporary preference to undo via workbench',
      category: 'workflow',
      always_on: true,
      content: 'Temporary workflow directive for undo test.',
      tier: 'GLOBAL',
    });
    assert.ok(gStorage.getPreference('wb-pref-temp'));
    const undoRes = await executeWorkbenchAction(ws, 'undo-preference', {
      id: 'wb-pref-temp',
      tier: 'GLOBAL',
    });
    assert.strictEqual(undoRes.status, 200, JSON.stringify(undoRes.body));
    assert.strictEqual(gStorage.getPreference('wb-pref-temp'), null);

    // Personal memory merged into buildUiSnapshot
    gStorage.saveMemory({
      id: 'wb-personal-mem',
      title: 'Personal XLSX check',
      l0_summary: 'Always verify cell formulas after export',
      memory_type: 'personal',
      symptom: 'Broken formula in exported workbook',
      root_cause: 'Localized formula function string',
      solution: 'Use canonical English uppercase formula names',
      target_symbols: [],
      ast_fingerprints: {},
      created_commit: 'personal',
      tags: ['personal'],
      origin: 'session',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const snapshot = buildUiSnapshot(ws);
    assert.ok(snapshot.preferences?.some((p) => p.id === 'wb-pref-one'));
    assert.ok(snapshot.userProfile);
    assert.ok(snapshot.userProfile!.preferences.some((p) => p.id === 'wb-pref-one'));
    assert.ok(snapshot.userProfile!.personalMemories.some((m) => m.id === 'wb-personal-mem'));
    assert.strictEqual(snapshot.userProfile!.maxTokens, 800);
    assert.strictEqual(snapshot.userProfile!.maxMenuTokens, 250);
    assert.ok(snapshot.userProfile!.totalTokens > 0);
    assert.ok(snapshot.userProfile!.renderedCard.includes('wb-pref-one'));
    assert.ok(Array.isArray(snapshot.userProfile!.syncedHosts));
    assert.ok(Array.isArray(snapshot.userProfile!.history) && snapshot.userProfile!.history.length > 0);

    const html = renderUiClientHtml(snapshot);
    assert.ok(html.includes('id="view-profile"'), 'UI HTML must include #view-profile');
    assert.ok(html.includes('id="nav-btn-profile"'), 'UI HTML must include #nav-btn-profile');
  });

  test('3. D3: syncGlobalUserProfile writes to all 8 hosts (with Windsurf 6,000-char guard) and NODE_TEST_CONTEXT isolates os.homedir()', () => {
    const fakeHome = makeTempDir('evo-v05-d3-home-');
    const globalRoot = path.join(fakeHome, '.evo', 'global');
    cleanupDirs.push(fakeHome);

    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();
    gStorage.savePreference({
      id: 'd3-concise-pref',
      title: 'Concise output',
      l0_summary: 'Keep technical summaries short and actionable',
      category: 'style',
      always_on: true,
      content: 'Write short direct sentences without fluff.',
      tokens: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Hermetic NODE_TEST_CONTEXT isolation: without homeDir or EVO_GLOBAL_PROFILE_TARGETS, only isolated USER_PROFILE.md is targeted
    const isolatedTargets = discoverGlobalProfileTargets(globalRoot);
    assert.strictEqual(isolatedTargets.length, 1);
    assert.strictEqual(isolatedTargets[0].host, 'isolated');
    assert.strictEqual(
      path.resolve(isolatedTargets[0].path),
      path.resolve(path.join(globalRoot, 'USER_PROFILE.md'))
    );
    const isoSync = syncGlobalUserProfile(globalRoot);
    assert.ok(isoSync.updatedTargets.every((t) => path.resolve(t).startsWith(path.resolve(fakeHome))));

    // Create all 8 host directories under fakeHome
    const hostDirs = [
      path.join(fakeHome, '.codeium', 'windsurf'),
      path.join(fakeHome, '.claude'),
      path.join(fakeHome, '.gemini'),
      path.join(fakeHome, '.codex'),
      path.join(fakeHome, '.cursor'),
      path.join(fakeHome, '.cline'),
      path.join(fakeHome, '.roo'),
      path.join(fakeHome, '.config', 'opencode'),
    ];
    for (const d of hostDirs) {
      fs.mkdirSync(d, { recursive: true });
    }

    const expectedHostFiles = [
      path.join(fakeHome, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
      path.join(fakeHome, '.claude', 'CLAUDE.md'),
      path.join(fakeHome, '.gemini', 'GEMINI.md'),
      path.join(fakeHome, '.codex', 'AGENTS.md'),
      path.join(fakeHome, '.cursor', 'rules', 'evo-user-profile.mdc'),
      path.join(fakeHome, '.cline', 'rules', 'evo-user-profile.md'),
      path.join(fakeHome, '.roo', 'rules', 'evo-user-profile.md'),
      path.join(fakeHome, '.config', 'opencode', 'AGENTS.md'),
    ];

    const syncRes = syncGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    assert.strictEqual(syncRes.targets.length, 8);
    for (const f of expectedHostFiles) {
      assert.ok(fs.existsSync(f), `Expected synced host file: ${f}`);
      const content = fs.readFileSync(f, 'utf8');
      assert.ok(content.includes(PROFILE_MARKER_START) && content.includes('d3-concise-pref'));
    }

    // Windsurf 6,000-char guard
    const longFiller = 'Keep every output verifiable and concise with exact paths. '.repeat(25);
    for (let i = 0; i < 6; i++) {
      gStorage.savePreference({
        id: `d3-long-pref-${i}`,
        title: `Long preference ${i}`,
        l0_summary: `Detailed rule ${i} for Windsurf truncation check`,
        category: 'workflow',
        always_on: true,
        content: longFiller,
        tokens: 200,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    const fullBlock = renderUserProfileBlock(gStorage.formatUserProfileDigest(), '');
    assert.ok(fullBlock.length > WINDSURF_PROFILE_MAX_CHARS, 'Fixture block must exceed 6000 chars');
    const directTruncated = truncateProfileBlockForWindsurf(fullBlock, WINDSURF_PROFILE_MAX_CHARS);
    assert.ok(directTruncated.length <= WINDSURF_PROFILE_MAX_CHARS);
    assert.ok(directTruncated.trimEnd().endsWith(PROFILE_MARKER_END));

    syncGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    const windsurfContent = fs.readFileSync(expectedHostFiles[0], 'utf8');
    const claudeContent = fs.readFileSync(expectedHostFiles[1], 'utf8');
    assert.ok(
      windsurfContent.length <= WINDSURF_PROFILE_MAX_CHARS,
      `Windsurf global_rules.md must be <= ${WINDSURF_PROFILE_MAX_CHARS} chars, got ${windsurfContent.length}`
    );
    assert.ok(claudeContent.length > WINDSURF_PROFILE_MAX_CHARS, 'Non-Windsurf host must keep full block');
  });

  test('4. D4: recordRecalledOutcomeUnified matches antigravity_hook.mjs for preference outcomes & global search records telemetry', async () => {
    const globalRoot = makeTempDir('evo-v05-d4-global-');
    const wsHook = makeTempDir('evo-v05-d4-wshook-');
    const wsAgy = makeTempDir('evo-v05-d4-wsagy-');
    const blankDir = makeTempDir('evo-v05-d4-blank-');
    cleanupDirs.push(globalRoot, wsHook, wsAgy, blankDir);

    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();
    const prefNow = new Date().toISOString();
    gStorage.savePreference({
      id: 'd4-parity-pref',
      title: 'No tables parity preference',
      l0_summary: 'Use bullets instead of markdown tables',
      category: 'formatting',
      always_on: true,
      content: 'Prefer concise bullets.',
      tokens: 20,
      created_at: prefNow,
      updated_at: prefNow,
    });
    const gTeleInit = new EvoTelemetry(gStorage);
    gTeleInit.syncFromDisk(true);
    gTeleInit.close();

    // 1. Unified hook-engine / hook.ts path (helped + contested)
    const s1 = new EvoStorage(wsHook);
    s1.ensureInitialized();
    const t1 = new EvoTelemetry(s1);
    try {
      t1.recordRecallEvent({
        eventType: 'inspect',
        capabilityId: 'd4-parity-pref',
        kind: 'preference',
        tier: 'GLOBAL',
      });
      recordRecalledOutcomeUnified(
        s1,
        t1,
        { id: 'd4-parity-pref', kind: 'preference', tier: 'GLOBAL', ts: prefNow },
        'helped',
        ['src/completely-unrelated-file.ts']
      );
      recordRecalledOutcomeUnified(
        s1,
        t1,
        { id: 'd4-parity-pref', kind: 'preference', tier: 'GLOBAL', ts: prefNow },
        'contested',
        ['src/completely-unrelated-file.ts']
      );
    } finally {
      t1.close();
    }

    const gCheck1 = new DatabaseSync(gStorage.telemetryDbPath, { readOnly: true });
    const lCheck1 = new DatabaseSync(s1.telemetryDbPath, { readOnly: true });
    let unifiedCounts: { helped_count: number; contested_count: number };
    let unifiedLocalHelped: number;
    try {
      unifiedCounts = gCheck1
        .prepare('SELECT helped_count, contested_count FROM telemetry WHERE id = ?')
        .get('d4-parity-pref') as { helped_count: number; contested_count: number };
      unifiedLocalHelped = (
        lCheck1
          .prepare("SELECT helped FROM recall_events WHERE capability_id = 'd4-parity-pref' ORDER BY id DESC LIMIT 1")
          .get() as { helped: number }
      ).helped;
    } finally {
      gCheck1.close();
      lCheck1.close();
    }
    assert.strictEqual(unifiedCounts.helped_count, 1);
    assert.strictEqual(unifiedCounts.contested_count, 1);
    assert.strictEqual(unifiedLocalHelped, 1);

    // 2. Reset global counts and run antigravity_hook.mjs Stop on wsAgy for identical parity
    const gReset = new DatabaseSync(gStorage.telemetryDbPath);
    gReset.prepare("UPDATE telemetry SET helped_count = 0, contested_count = 0 WHERE id = 'd4-parity-pref'").run();
    gReset.close();

    const s2 = new EvoStorage(wsAgy);
    s2.ensureInitialized();
    const t2 = new EvoTelemetry(s2);
    try {
      t2.recordRecallEvent({
        eventType: 'inspect',
        capabilityId: 'd4-parity-pref',
        kind: 'preference',
        tier: 'GLOBAL',
      });
      t2.setSessionFlag(
        'recalled_capabilities',
        JSON.stringify([{ id: 'd4-parity-pref', kind: 'preference', tier: 'GLOBAL', ts: prefNow }])
      );
    } finally {
      t2.close();
    }

    const agyScript = path.join(REPO_ROOT, 'scripts', 'antigravity_hook.mjs');
    const statePath = path.join(wsAgy, 'agy-state.json');
    const stopHelped = spawnSync(process.execPath, [agyScript, 'Stop'], {
      cwd: wsAgy,
      input: JSON.stringify({ conversationId: 'conv-d4-helped', workspace: wsAgy }),
      encoding: 'utf8',
      env: { ...process.env, EVO_GLOBAL_DIR: globalRoot, EVO_AGY_HOOK_STATE_PATH: statePath },
    });
    assert.strictEqual(stopHelped.status, 0, stopHelped.stderr);

    // Now contested via antigravity_hook.mjs Stop
    const t2b = new EvoTelemetry(s2);
    try {
      t2b.setSessionFlag('user_correction_detected', 'true');
      t2b.setSessionFlag(
        'recalled_capabilities',
        JSON.stringify([{ id: 'd4-parity-pref', kind: 'preference', tier: 'GLOBAL', ts: prefNow }])
      );
    } finally {
      t2b.close();
    }
    const stopContested = spawnSync(process.execPath, [agyScript, 'Stop'], {
      cwd: wsAgy,
      input: JSON.stringify({ conversationId: 'conv-d4-contested', workspace: wsAgy }),
      encoding: 'utf8',
      env: { ...process.env, EVO_GLOBAL_DIR: globalRoot, EVO_AGY_HOOK_STATE_PATH: statePath },
    });
    assert.strictEqual(stopContested.status, 0, stopContested.stderr);

    const gCheck2 = new DatabaseSync(gStorage.telemetryDbPath, { readOnly: true });
    const lCheck2 = new DatabaseSync(s2.telemetryDbPath, { readOnly: true });
    try {
      const agyCounts = gCheck2
        .prepare('SELECT helped_count, contested_count FROM telemetry WHERE id = ?')
        .get('d4-parity-pref') as { helped_count: number; contested_count: number };
      const agyLocalHelped = (
        lCheck2
          .prepare("SELECT helped FROM recall_events WHERE capability_id = 'd4-parity-pref' ORDER BY id DESC LIMIT 1")
          .get() as { helped: number }
      ).helped;
      assert.deepStrictEqual(agyCounts, unifiedCounts);
      assert.strictEqual(agyLocalHelped, unifiedLocalHelped);
    } finally {
      gCheck2.close();
      lCheck2.close();
    }

    // 3. Non-code global search records recall events in global telemetry without creating .evo/ in blankDir
    const dispatcher = new EvoMcpDispatcher(blankDir);
    try {
      const searchRes = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'markdown tables bullets',
        scope: 'global',
      });
      assert.ok(searchRes.content[0].text.includes('d4-parity-pref'));
      assert.strictEqual(fs.existsSync(path.join(blankDir, '.evo')), false);

      const gEventsDb = new DatabaseSync(gStorage.telemetryDbPath, { readOnly: true });
      try {
        const events = gEventsDb
          .prepare("SELECT event_type, capability_id, tier FROM recall_events WHERE capability_id = 'd4-parity-pref'")
          .all() as Array<{ event_type: string; capability_id: string; tier: string }>;
        assert.ok(
          events.some((e) => e.event_type === 'search' && e.tier === 'GLOBAL'),
          `Expected search recall event in global telemetry, got: ${JSON.stringify(events)}`
        );
      } finally {
        gEventsDb.close();
      }
    } finally {
      dispatcher.close();
    }
  });

  test('5. D5: Project always_on: true preferences render into project managed block via syncManagedRuleBlocks', () => {
    const ws = makeTempDir('evo-v05-d5-ws-');
    cleanupDirs.push(ws);

    runInit(ws, { targets: ['claude', 'agents'], globalHomeDir: ws });
    const storage = new EvoStorage(ws);
    storage.savePreference({
      id: 'proj-always-on-pref',
      title: 'Project changelog convention',
      l0_summary: 'Prefix PR titles with subsystem scope',
      category: 'workflow',
      always_on: true,
      content: 'Always prefix PR titles with [core] or [cli].',
      tokens: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    storage.savePreference({
      id: 'proj-on-demand-pref',
      title: 'On-demand project template',
      l0_summary: 'Should stay out of always-on Project Preferences digest',
      category: 'workflow',
      always_on: false,
      content: 'Use template when publishing.',
      tokens: 18,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    syncManagedRuleBlocks(ws);
    for (const fileName of ['CLAUDE.md', 'AGENTS.md']) {
      const txt = fs.readFileSync(path.join(ws, fileName), 'utf8');
      assert.ok(txt.includes('### Project Preferences'), `${fileName} missing Project Preferences section`);
      assert.ok(txt.includes('proj-always-on-pref'), `${fileName} missing always_on preference`);
      assert.strictEqual(txt.includes('proj-on-demand-pref'), false, `${fileName} must not inline always_on: false preference`);
    }
  });

  test('6. D6: MCP_INSTRUCTIONS, GEMINI.extension.md, L0_META_RULE_SEED, and hook.ts Stop reminders guide personal capture without banning non-code chats', () => {
    const geminiExtPath = path.join(REPO_ROOT, 'templates', 'GEMINI.extension.md');
    const geminiExt = fs.readFileSync(geminiExtPath, 'utf8');

    for (const [label, text] of [
      ['MCP_INSTRUCTIONS', MCP_INSTRUCTIONS],
      ['templates/GEMINI.extension.md', geminiExt],
      ['L0_META_RULE_SEED', L0_META_RULE_SEED],
    ] as const) {
      assert.ok(
        text.includes('scope: "global"'),
        `${label} must guide scope: "global" recall/capture`
      );
      assert.ok(
        text.includes('preference') && text.includes('personal'),
        `${label} must cover personal preferences & personal memory`
      );
      assert.strictEqual(
        /Skip\s+`?evo_search`?\s+during\s+general\s+chat/i.test(text),
        false,
        `${label} must NOT ban evo_search during general/non-code chats`
      );
    }

    const ws = makeTempDir('evo-v05-d6-hook-');
    const globalRoot = makeTempDir('evo-v05-d6-global-');
    cleanupDirs.push(ws, globalRoot);
    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();

    const stopStyleRes = runHook('stop', {
      workspaceRoot: ws,
      payload: {
        user_message: '太啰嗦了，以后都按这个流程，用大白话不要用表格',
      },
    });
    assert.strictEqual(stopStyleRes.crystallizationSuggested, true);
    assert.ok(
      stopStyleRes.output.includes('kind: "preference", scope: "global"'),
      `Stop reminder must guide global preference capture: ${stopStyleRes.output}`
    );
    assert.ok(
      stopStyleRes.output.includes('kind: "memory", scope: "global"'),
      `Stop reminder must guide global personal memory capture: ${stopStyleRes.output}`
    );

    const stopPersonalExpRes = runHook('stop', {
      workspaceRoot: ws,
      payload: {
        user_message: '记住这个经验：导出报表公式必须用英文大写函数名',
      },
    });
    assert.strictEqual(stopPersonalExpRes.crystallizationSuggested, true);
    assert.ok(
      stopPersonalExpRes.output.includes('evo_propose(kind: "memory", scope: "global")')
    );
  });

  test('7. D7: Prose preference mentioning rm -rf / passes Gatekeeper, while leaked API secrets fail ERR_SECURITY_VIOLATION', async () => {
    const globalRoot = makeTempDir('evo-v05-d7-global-');
    cleanupDirs.push(globalRoot);
    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    const dispatcher = new EvoMcpDispatcher(globalRoot);
    try {
      const proseRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'd7-safety-warning-pref',
        title: 'Confirm destructive shell examples',
        l0_summary: 'Always add a confirmation warning before destructive shell commands',
        category: 'requirement',
        always_on: true,
        content: 'Never run rm -rf / without confirmation; warn the user explicitly.',
      });
      assert.notStrictEqual(proseRes.isError, true, proseRes.content?.[0]?.text);
      assert.strictEqual(JSON.parse(proseRes.content[0].text).passed, true);

      for (const [id, secret] of [
        ['d7-leak-openai', 'Use sk-proj-1234567890abcdefghijklmnopqr in scripts'],
        ['d7-leak-aws', 'Use AKIAIOSFODNN7EXAMPLE12 for S3 uploads'],
      ] as const) {
        const leakRes = await dispatcher.handleToolCallAsync('evo_propose', {
          kind: 'preference',
          scope: 'global',
          id,
          title: `Leak ${id}`,
          l0_summary: 'Secret leak check',
          category: 'style',
          content: secret,
        });
        assert.strictEqual(leakRes.isError, true);
        assert.strictEqual(JSON.parse(leakRes.content[0].text).error_code, 'ERR_SECURITY_VIOLATION');
      }
    } finally {
      dispatcher.close();
    }
  });

  test('8. D8: Contradictory Chinese preferences trigger polarity conflict with conflicting_ids, and supersedes_id replaces cleanly', async () => {
    const globalRoot = makeTempDir('evo-v05-d8-global-');
    cleanupDirs.push(globalRoot);
    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    const dispatcher = new EvoMcpDispatcher(globalRoot);
    try {
      const noTablesRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'zh-forbid-tables',
        title: '禁用表格',
        l0_summary: '回复中不要使用表格，改用要点列表',
        category: 'formatting',
        always_on: true,
        content: '禁用表格，不要使用表格，统一用精简要点列表。',
      });
      assert.strictEqual(JSON.parse(noTablesRes.content[0].text).passed, true);

      const conflictRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'zh-require-tables',
        title: '必须使用 Markdown 表格',
        l0_summary: '结构化指标必须使用 Markdown 表格排版',
        category: 'formatting',
        always_on: true,
        content: '必须使用 Markdown 表格输出结构化信息。',
      });
      assert.strictEqual(conflictRes.isError, true);
      const conflictJson = JSON.parse(conflictRes.content[0].text);
      assert.strictEqual(conflictJson.error_code, 'ERR_DUPLICATE_CAPABILITY');
      assert.ok(
        conflictJson.message.includes('opposite-polarity'),
        `Expected polarity conflict rejection, got: ${conflictJson.message}`
      );
      assert.ok(
        Array.isArray(conflictJson.conflicting_ids) &&
          conflictJson.conflicting_ids.includes('zh-forbid-tables'),
        `Expected conflicting_ids to include zh-forbid-tables: ${conflictRes.content[0].text}`
      );

      // Direct detectPreferenceConflict assertion (including "不要使用 Markdown 表格" vs "必须使用 Markdown 表格")
      const gStorage = new EvoStorage(globalRoot);
      const directConflicts = detectPreferenceConflict(
        {
          id: 'zh-require-tables',
          title: '必须使用 Markdown 表格',
          l0_summary: '必须使用 Markdown 表格',
          content: '必须使用 Markdown 表格输出。',
        },
        gStorage.listPreferences()
      );
      assert.strictEqual(directConflicts[0]?.id, 'zh-forbid-tables');
      const mdNegConflict = detectPreferenceConflict(
        {
          id: 'zh-no-md-tables',
          title: '不要使用 Markdown 表格',
          l0_summary: '不要使用 Markdown 表格',
          content: '不要使用 Markdown 表格。',
        },
        [
          {
            id: 'zh-yes-md-tables',
            title: '必须使用 Markdown 表格',
            l0_summary: '必须使用 Markdown 表格',
            category: 'formatting',
            always_on: true,
            content: '必须使用 Markdown 表格输出。',
            tokens: 15,
            created_at: '',
            updated_at: '',
          },
        ]
      );
      assert.strictEqual(mdNegConflict[0]?.id, 'zh-yes-md-tables');

      // Replace cleanly via supersedes_id
      const supersedeRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'zh-require-tables',
        supersedes_id: 'zh-forbid-tables',
        title: '必须使用 Markdown 表格',
        l0_summary: '对比内容必须使用 Markdown 表格展示',
        category: 'formatting',
        always_on: true,
        content: '必须使用 Markdown 表格进行结构化对比。',
      });
      assert.notStrictEqual(supersedeRes.isError, true, supersedeRes.content?.[0]?.text);
      assert.strictEqual(JSON.parse(supersedeRes.content[0].text).passed, true);
      assert.strictEqual(gStorage.getPreference('zh-forbid-tables'), null);
      assert.ok(gStorage.getPreference('zh-require-tables'));
    } finally {
      dispatcher.close();
    }
  });

  test('9. D9: cleanGlobalUserProfile & runUninstall(ws, { global: true, homeDir }) strip EVO:PROFILE blocks and standalone files', () => {
    const ws = makeTempDir('evo-v05-d9-ws-');
    const fakeHome = makeTempDir('evo-v05-d9-home-');
    const globalRoot = path.join(fakeHome, '.evo', 'global');
    cleanupDirs.push(ws, fakeHome);

    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    runInit(ws, { targets: ['claude'], globalHomeDir: fakeHome });

    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();
    gStorage.savePreference({
      id: 'd9-cleanup-pref',
      title: 'Cleanup pref',
      l0_summary: 'Keep user rules intact when cleaning',
      category: 'style',
      always_on: true,
      content: 'Concise output.',
      tokens: 15,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const claudeGlobal = path.join(fakeHome, '.claude', 'CLAUDE.md');
    const geminiGlobal = path.join(fakeHome, '.gemini', 'GEMINI.md');
    const windsurfGlobal = path.join(fakeHome, '.codeium', 'windsurf', 'memories', 'global_rules.md');
    const cursorStandalone = path.join(fakeHome, '.cursor', 'rules', 'evo-user-profile.mdc');
    const clineStandalone = path.join(fakeHome, '.cline', 'rules', 'evo-user-profile.md');
    const rooStandalone = path.join(fakeHome, '.roo', 'rules', 'evo-user-profile.md');

    fs.mkdirSync(path.dirname(claudeGlobal), { recursive: true });
    fs.mkdirSync(path.dirname(geminiGlobal), { recursive: true });
    fs.mkdirSync(path.dirname(windsurfGlobal), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.cline'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.roo'), { recursive: true });
    fs.writeFileSync(claudeGlobal, '# Custom Claude Global\nKeep me.\n', 'utf8');
    fs.writeFileSync(geminiGlobal, '# Custom Gemini Global\nKeep me too.\n', 'utf8');

    syncGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    assert.ok(fs.readFileSync(claudeGlobal, 'utf8').includes(PROFILE_MARKER_START));
    assert.ok(fs.existsSync(cursorStandalone));
    assert.ok(fs.existsSync(clineStandalone));
    assert.ok(fs.existsSync(rooStandalone));

    // 1. cleanGlobalUserProfile
    const cleanRes = cleanGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    assert.ok(cleanRes.updatedTargets.length >= 5);
    assert.strictEqual(fs.readFileSync(claudeGlobal, 'utf8').includes(PROFILE_MARKER_START), false);
    assert.ok(fs.readFileSync(claudeGlobal, 'utf8').includes('Keep me.'));
    assert.strictEqual(fs.readFileSync(geminiGlobal, 'utf8').includes(PROFILE_MARKER_START), false);
    assert.ok(fs.readFileSync(geminiGlobal, 'utf8').includes('Keep me too.'));
    assert.strictEqual(fs.existsSync(cursorStandalone), false);
    assert.strictEqual(fs.existsSync(clineStandalone), false);
    assert.strictEqual(fs.existsSync(rooStandalone), false);

    // 2. Re-sync and test runUninstall(ws, { global: true, homeDir: fakeHome })
    syncGlobalUserProfile(globalRoot, { homeDir: fakeHome });
    assert.ok(fs.readFileSync(claudeGlobal, 'utf8').includes(PROFILE_MARKER_START));
    assert.ok(fs.existsSync(cursorStandalone));

    const uninstallRes = runUninstall(ws, { global: true, homeDir: fakeHome });
    assert.ok(uninstallRes.cleanedProfileTargets && uninstallRes.cleanedProfileTargets.length >= 5);
    assert.strictEqual(fs.readFileSync(claudeGlobal, 'utf8').includes(PROFILE_MARKER_START), false);
    assert.ok(fs.readFileSync(claudeGlobal, 'utf8').includes('Keep me.'));
    assert.strictEqual(fs.existsSync(cursorStandalone), false);
    assert.strictEqual(fs.existsSync(clineStandalone), false);
    assert.strictEqual(fs.existsSync(rooStandalone), false);
  });

  test('10. D10 / D17: evo doctor --json reports profile health & stale pre-v0.5 plugin L0 seed; evo tree displays global profile summary', () => {
    const ws = makeTempDir('evo-v05-d10-ws-');
    const fakeHome = makeTempDir('evo-v05-d10-home-');
    const globalRoot = path.join(fakeHome, '.evo', 'global');
    cleanupDirs.push(ws, fakeHome);

    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    runInit(ws, { targets: ['claude'], globalHomeDir: fakeHome });
    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();
    gStorage.savePreference({
      id: 'd10-global-pref',
      title: 'D10 Global Pref',
      l0_summary: 'Global summary preference for doctor & tree',
      category: 'style',
      always_on: true,
      content: 'Concise bullets.',
      tokens: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    gStorage.saveMemory({
      id: 'd10-personal-mem',
      title: 'Personal note',
      l0_summary: 'Personal note in global tree',
      memory_type: 'personal',
      symptom: 'Ctx',
      root_cause: 'Insight',
      solution: 'Takeaway',
      target_symbols: [],
      ast_fingerprints: {},
      created_commit: 'personal',
      tags: ['personal'],
      origin: 'session',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const geminiMd = path.join(fakeHome, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# Host\n', 'utf8');
    syncGlobalUserProfile(globalRoot, { targetFiles: [geminiMd] });

    // Stale pre-v0.5 plugin L0 seed
    const stalePluginSeed = path.join(
      fakeHome,
      '.gemini',
      'config',
      'plugins',
      'evo-kernel',
      'rules',
      'AGENTS.md'
    );
    fs.mkdirSync(path.dirname(stalePluginSeed), { recursive: true });
    fs.writeFileSync(
      stalePluginSeed,
      '<!-- EVO:START -->\nSkip `evo_search` during general chat.\nEvoKernel 演进回执\n<!-- EVO:END -->\n',
      'utf8'
    );

    const cliEntry = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');
    const docRes = spawnSync(
      process.execPath,
      [cliEntry, 'doctor', '--json', '--no-probe', '--workspace', ws],
      {
        cwd: ws,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: fakeHome,
          USERPROFILE: fakeHome,
          EVO_GLOBAL_DIR: globalRoot,
          EVO_GLOBAL_PROFILE_TARGETS: geminiMd,
        },
      }
    );
    assert.strictEqual(docRes.status, 0, docRes.stderr);
    const doctorJson = JSON.parse(docRes.stdout);
    assert.ok(doctorJson.profile);
    assert.strictEqual(doctorJson.profile.initialized, true);
    assert.strictEqual(doctorJson.profile.maxProfileTokens, 800);
    assert.strictEqual(doctorJson.profile.maxMenuTokens, 250);
    assert.ok(doctorJson.profile.profileTokens > 0);
    assert.ok(
      Array.isArray(doctorJson.seeds?.stalePluginSeeds) &&
        doctorJson.seeds.stalePluginSeeds.length === 1
    );
    assert.strictEqual(doctorJson.versionDrift?.drifted, true);

    const treeOutput = renderEvoTree(ws, { ascii: true, full: true });
    assert.ok(
      treeOutput.includes('Global Personal Profile & Workflows'),
      `evo tree must display global profile summary, got:\n${treeOutput}`
    );
    assert.ok(treeOutput.includes('1 always-on'), treeOutput);
    assert.ok(treeOutput.includes('1 personal memories'), treeOutput);
  });

  test('11. D12: getProfileTokenUsage includes outer framing + headers within 800-tok cap; formatTaskDirectoryMenu fits <=250 tok with non-seed skills', () => {
    const globalRoot = makeTempDir('evo-v05-d12-global-');
    cleanupDirs.push(globalRoot);

    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();

    gStorage.savePreference({
      id: 'd12-always-on-1',
      title: 'Always-On Style',
      l0_summary: 'Lead with bottom-line summary',
      category: 'communication',
      always_on: true,
      content: 'Start every reply with the direct conclusion.',
      tokens: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const digestOnlyTokens = estimateTokens(gStorage.formatUserProfileDigest());
    const fullRenderedTokens = estimateTokens(
      renderUserProfileBlock(gStorage.formatUserProfileDigest(), '')
    );
    const usage = gStorage.getProfileTokenUsage();
    assert.strictEqual(usage.totalTokens, fullRenderedTokens);
    assert.ok(usage.totalTokens > digestOnlyTokens, 'Must include outer framing + category headers');
    assert.ok(usage.totalTokens <= 800);

    // Seed skill (must be excluded) vs non-seed skill (must be included)
    gStorage.saveSkill({
      id: 'bug-to-guardrail-sop',
      name: 'bug-to-guardrail-sop',
      description: 'Seed SOP',
      title: 'Seed SOP',
      l0_summary: 'Internal seed skill',
      trigger_cue: 'never shown in menu',
      l1_contract: 'Seed',
      l2_sop: 'Seed step',
      tags: ['seed'],
      origin: 'seed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    gStorage.saveSkill({
      id: 'custom-weekly-brief-sop',
      name: 'custom-weekly-brief-sop',
      description: 'Weekly executive briefing',
      title: 'Weekly Briefing SOP',
      l0_summary: 'Compile shipped milestones, blockers, and next priorities',
      trigger_cue: 'writing executive weekly brief',
      l1_contract: 'When preparing weekly executive brief',
      l2_sop: '1. Shipped\n2. Risks',
      tags: ['writing'],
      origin: 'evolved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Multiple on-demand workflow/requirement preferences
    for (let i = 0; i < 6; i++) {
      gStorage.savePreference({
        id: `d12-ondemand-wf-${i}`,
        title: `Workflow checklist ${i}`,
        l0_summary: `On-demand workflow verification checklist item ${i} with concrete steps`,
        category: i % 2 === 0 ? 'workflow' : 'requirement',
        always_on: false,
        trigger_cue: `running workflow task ${i}`,
        content: `Step-by-step workflow instruction ${i}.`,
        tokens: 25,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const menu = gStorage.formatTaskDirectoryMenu(250);
    assert.ok(menu.length > 0);
    assert.ok(estimateTokens(menu) <= 250, `Menu must stay <= 250 tok, got ${estimateTokens(menu)}`);
    assert.ok(menu.includes('d12-ondemand-wf-0'));
    assert.ok(menu.includes('custom-weekly-brief-sop'), 'Non-seed global skill must not be starved');
    assert.strictEqual(menu.includes('bug-to-guardrail-sop'), false, 'Seed skill must be excluded');
  });

  test('12. D13 / 4A: Default approved review_status, immediate host push, profile-history.jsonl, and 1-command undo (same-ID & cross-ID supersede)', async () => {
    const ws = makeTempDir('evo-v05-d13-ws-');
    const globalRoot = makeTempDir('evo-v05-d13-global-');
    const hostDir = makeTempDir('evo-v05-d13-host-');
    cleanupDirs.push(ws, globalRoot, hostDir);

    const geminiMd = path.join(hostDir, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# Host\n', 'utf8');
    process.env.EVO_GLOBAL_DIR = globalRoot;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = geminiMd;

    const dispatcher = new EvoMcpDispatcher(ws);
    const gStorage = new EvoStorage(globalRoot);
    try {
      // 1. New preference defaults to approved & pushes immediately
      const addRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'd13-pref-alpha',
        title: 'Alpha style',
        l0_summary: 'Original alpha directive for replies',
        category: 'style',
        always_on: true,
        content: 'Version 1 alpha instruction.',
      });
      assert.strictEqual(JSON.parse(addRes.content[0].text).passed, true);
      assert.strictEqual(gStorage.getPreference('d13-pref-alpha')?.review_status, 'approved');
      assert.ok(fs.readFileSync(geminiMd, 'utf8').includes('Version 1 alpha instruction.'));
      assert.ok(fs.existsSync(gStorage.profileHistoryPath));

      // 2. Same-ID update -> undo rolls back to Version 1 & re-syncs host
      const sameIdUpd = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'd13-pref-alpha',
        supersedes_id: 'd13-pref-alpha',
        title: 'Alpha style v2',
        l0_summary: 'Updated alpha directive v2',
        category: 'style',
        always_on: true,
        content: 'Version 2 alpha instruction.',
      });
      assert.strictEqual(JSON.parse(sameIdUpd.content[0].text).passed, true);
      assert.ok(fs.readFileSync(geminiMd, 'utf8').includes('Version 2 alpha instruction.'));

      const undoSameOut = captureConsoleLog(() => {
        runCli(['node', 'evo', 'profile', 'undo', '--json']);
      });
      const undoSameJson = JSON.parse(undoSameOut);
      assert.strictEqual(undoSameJson.ok, true);
      assert.ok(
        gStorage.getPreference('d13-pref-alpha')?.content.includes('Version 1 alpha instruction.')
      );
      assert.ok(fs.readFileSync(geminiMd, 'utf8').includes('Version 1 alpha instruction.'));
      assert.strictEqual(fs.readFileSync(geminiMd, 'utf8').includes('Version 2 alpha instruction.'), false);

      // 3. Cross-ID supersede -> 1-command `evo profile undo` removes beta and restores alpha
      const crossSup = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'd13-pref-beta',
        supersedes_id: 'd13-pref-alpha',
        title: 'Beta replacement',
        l0_summary: 'Replaces alpha directive with beta directive',
        category: 'style',
        always_on: true,
        content: 'Version 3 beta instruction.',
      });
      assert.strictEqual(JSON.parse(crossSup.content[0].text).passed, true);
      assert.strictEqual(gStorage.getPreference('d13-pref-alpha'), null);
      assert.ok(gStorage.getPreference('d13-pref-beta'));
      assert.ok(fs.readFileSync(geminiMd, 'utf8').includes('d13-pref-beta'));

      const undoCrossOut = captureConsoleLog(() => {
        runCli(['node', 'evo', 'profile', 'undo', '--json']);
      });
      const undoCrossJson = JSON.parse(undoCrossOut);
      assert.strictEqual(undoCrossJson.ok, true);
      assert.strictEqual(gStorage.getPreference('d13-pref-beta'), null);
      assert.ok(gStorage.getPreference('d13-pref-alpha'));
      const hostAfterCrossUndo = fs.readFileSync(geminiMd, 'utf8');
      assert.ok(hostAfterCrossUndo.includes('d13-pref-alpha'));
      assert.strictEqual(hostAfterCrossUndo.includes('d13-pref-beta'), false);
    } finally {
      dispatcher.close();
    }
  });

  test('13. D14: restoreCapability & executeWorkbenchAction(restore-item) reject restoring archived preference/core rule exceeding 800/1500-tok budget', async () => {
    const ws = makeTempDir('evo-v05-d14-ws-');
    const globalRoot = makeTempDir('evo-v05-d14-global-');
    cleanupDirs.push(ws, globalRoot);
    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    // 1. Core rule 1500-tok guard
    const pStorage = new EvoStorage(ws);
    pStorage.ensureInitialized();
    pStorage.saveRule({
      id: 'd14-heavy-core',
      title: 'Heavy core',
      l0_summary: 'Consumes 1440 core tokens',
      scope_glob: '**/*',
      core: true,
      priority: 1,
      content: 'Core invariant.',
      tokens: 1440,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    pStorage.saveRule({
      id: 'd14-overflow-core',
      title: 'Overflow core',
      l0_summary: 'Needs 100 tokens',
      scope_glob: '**/*',
      core: true,
      priority: 2,
      content: 'Extra invariant.',
      tokens: 100,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    pStorage.archiveCapability('d14-overflow-core', 'rule', 'Budget test');
    assert.throws(
      () => pStorage.restoreCapability('d14-overflow-core', 'rule'),
      /ERR_BUDGET_EXCEEDED/
    );
    const wbRuleRestore = await executeWorkbenchAction(ws, 'restore-item', {
      kind: 'rule',
      id: 'd14-overflow-core',
      tier: 'LOCAL',
    });
    assert.strictEqual(wbRuleRestore.status, 400);
    assert.strictEqual(wbRuleRestore.body.code, 'ERR_BUDGET_EXCEEDED');

    // 2. Global always_on preference 800-tok guard
    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();
    gStorage.savePreference({
      id: 'd14-overflow-pref',
      title: 'Overflow preference',
      l0_summary: 'Archived preference that would exceed 800 tokens on restore',
      category: 'style',
      always_on: true,
      content: Array.from({ length: 28 }, (_, i) => `constraint${i}`).join(' '),
      tokens: 70,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    gStorage.archiveCapability('d14-overflow-pref', 'preference', 'Budget test');

    for (let i = 0; i < 16; i++) {
      gStorage.savePreference({
        id: `d14-fill-${i}`,
        title: `Filler ${i}`,
        l0_summary: `Always-on filler preference ${i} filling 800-token profile card`,
        category: 'style',
        always_on: true,
        content: `Maintain consistent convention number ${i} across all repository tasks, diagnostics, formatting checks, and code reviews with concrete evidence.`,
        tokens: 55,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    assert.ok(gStorage.getProfileTokenUsage().totalTokens >= 750);

    assert.throws(
      () => gStorage.restoreCapability('d14-overflow-pref', 'preference'),
      /ERR_PROFILE_BUDGET_EXCEEDED/
    );
    const wbPrefRestore = await executeWorkbenchAction(ws, 'restore-item', {
      kind: 'preference',
      id: 'd14-overflow-pref',
      tier: 'GLOBAL',
    });
    assert.strictEqual(wbPrefRestore.status, 400);
    assert.strictEqual(wbPrefRestore.body.code, 'ERR_PROFILE_BUDGET_EXCEEDED');
  });

  test('14. D15: evo_compact archiving global preferences into a skill re-syncs host targets with no ghost preference left', async () => {
    const ws = makeTempDir('evo-v05-d15-ws-');
    const globalRoot = makeTempDir('evo-v05-d15-global-');
    const hostDir = makeTempDir('evo-v05-d15-host-');
    cleanupDirs.push(ws, globalRoot, hostDir);

    const geminiMd = path.join(hostDir, '.gemini', 'GEMINI.md');
    fs.mkdirSync(path.dirname(geminiMd), { recursive: true });
    fs.writeFileSync(geminiMd, '# Host\n', 'utf8');
    process.env.EVO_GLOBAL_DIR = globalRoot;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = geminiMd;

    const gStorage = new EvoStorage(globalRoot);
    gStorage.ensureInitialized();
    gStorage.savePreference({
      id: 'd15-pref-one',
      title: 'Step one pref',
      l0_summary: 'First multi-step report check',
      category: 'workflow',
      always_on: true,
      content: 'Check totals first.',
      tokens: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    gStorage.savePreference({
      id: 'd15-pref-two',
      title: 'Step two pref',
      l0_summary: 'Second multi-step report check',
      category: 'workflow',
      always_on: true,
      content: 'Check formatting second.',
      tokens: 20,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    syncGlobalUserProfile(globalRoot);
    assert.ok(fs.readFileSync(geminiMd, 'utf8').includes('d15-pref-one'));
    assert.ok(fs.readFileSync(geminiMd, 'utf8').includes('d15-pref-two'));

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const compactRes = await dispatcher.handleToolCallAsync('evo_compact', {
        target_ids: ['d15-pref-one', 'd15-pref-two'],
        reason: 'Promote multi-step workflow preferences into a global skill',
        merged_proposal: {
          kind: 'skill',
          scope: 'global',
          id: 'd15-report-audit-sop',
          title: 'Report Audit SOP',
          l0_summary: 'Verify totals and formatting before sending reports',
          trigger_cue: 'auditing weekly or quarterly report',
          l1_contract: 'When auditing a report, verify totals and formatting.',
          l2_sop: '1. Verify totals.\n2. Verify formatting.',
          tags: ['workflow'],
        },
      });
      assert.notStrictEqual(compactRes.isError, true, compactRes.content?.[0]?.text);
      const compactJson = JSON.parse(compactRes.content[0].text);
      assert.strictEqual(compactJson.result.passed, true);
      assert.strictEqual(gStorage.getPreference('d15-pref-one'), null);
      assert.strictEqual(gStorage.getPreference('d15-pref-two'), null);
      assert.ok(gStorage.getSkill('d15-report-audit-sop'));

      const syncedHost = fs.readFileSync(geminiMd, 'utf8');
      assert.strictEqual(syncedHost.includes('d15-pref-one'), false, 'Ghost pref-one must be cleared');
      assert.strictEqual(syncedHost.includes('d15-pref-two'), false, 'Ghost pref-two must be cleared');
      assert.ok(syncedHost.includes('d15-report-audit-sop'), 'Compacted skill must appear in Task Directory Menu');
    } finally {
      dispatcher.close();
    }
  });

  test('15. D16: inspectMcpTaxSnapshot reads .evo/.cache/external_tools.json and reports exact measured tool counts & tokens', () => {
    const ws = makeTempDir('evo-v05-d16-ws-');
    cleanupDirs.push(ws);

    fs.mkdirSync(path.join(ws, '.evo', '.cache'), { recursive: true });
    fs.writeFileSync(
      path.join(ws, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'custom-telemetry-srv': { command: 'node', args: ['srv.js'] },
        },
      }),
      'utf8'
    );

    const cachedTools = [
      {
        id: 'custom-telemetry-srv__query_metrics',
        serverName: 'custom-telemetry-srv',
        originalName: 'query_metrics',
        description: 'Query metrics time series from internal store',
        inputSchema: { type: 'object', properties: { metric: { type: 'string' } }, required: ['metric'] },
      },
      {
        id: 'custom-telemetry-srv__list_alerts',
        serverName: 'custom-telemetry-srv',
        originalName: 'list_alerts',
        description: 'List active alerts',
        inputSchema: { type: 'object', properties: { severity: { type: 'string' } } },
      },
    ];
    fs.writeFileSync(
      path.join(ws, '.evo', '.cache', 'external_tools.json'),
      JSON.stringify(cachedTools, null, 2),
      'utf8'
    );

    const report = inspectMcpTaxSnapshot(ws, { includeGlobal: false });
    const item = report.servers.find((s) => s.name === 'custom-telemetry-srv');
    assert.ok(item, 'Expected custom-telemetry-srv in MCP tax report');
    const expectedTokens = estimateTokens(JSON.stringify(cachedTools));
    assert.strictEqual(item!.toolCount, 2);
    assert.deepStrictEqual(item!.tools, ['query_metrics', 'list_alerts']);
    assert.strictEqual(item!.estimatedTokens, expectedTokens);
    assert.notStrictEqual(item!.estimatedTokens, 850);
  });

  test('16. D19: workspace-metrics-scanner honors maxDepth; OpenCodeAdapter.detectGlobal recognizes ~/.config/opencode', () => {
    const ws = makeTempDir('evo-v05-d19-ws-');
    const fakeHome = makeTempDir('evo-v05-d19-home-');
    cleanupDirs.push(ws, fakeHome);

    fs.writeFileSync(path.join(ws, 'root.ts'), 'export const a = 1;\n', 'utf8');
    fs.mkdirSync(path.join(ws, 'l1', 'l2', 'l3'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'l1', 'a.ts'), 'export const b = 2;\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'l1', 'l2', 'b.ts'), 'export const c = 3;\n', 'utf8');
    fs.writeFileSync(path.join(ws, 'l1', 'l2', 'l3', 'c.ts'), 'export const d = 4;\n', 'utf8');

    const scannerPath = path.join(
      REPO_ROOT,
      'templates',
      'seed-evo',
      'tools',
      'workspace-metrics-scanner',
      'run.mjs'
    );
    const runAtDepth = (maxDepth: number) => {
      const res = spawnSync(process.execPath, [scannerPath], {
        cwd: ws,
        encoding: 'utf8',
        env: { ...process.env, EVO_WORKSPACE: ws, EVO_ARGS: JSON.stringify({ maxDepth }) },
      });
      assert.strictEqual(res.status, 0, res.stderr);
      return JSON.parse(res.stdout);
    };

    assert.strictEqual(runAtDepth(0).files, 1);
    assert.strictEqual(runAtDepth(1).files, 2);
    assert.strictEqual(runAtDepth(2).files, 3);
    assert.strictEqual(runAtDepth(3).files, 4);

    const adapter = new OpenCodeAdapter();
    assert.strictEqual(adapter.detectGlobal(fakeHome), false);
    fs.mkdirSync(path.join(fakeHome, '.config', 'opencode'), { recursive: true });
    assert.strictEqual(adapter.detectGlobal(fakeHome), true);
  });

  test('17. 3A Tier 3: Global personal memory commits without ERR_GLOBAL_MEMORY_FORBIDDEN, is never [STALE], and recalls via bilingual office/writing synonyms', async () => {
    const blankDir = makeTempDir('evo-v05-t3-blank-');
    const globalRoot = makeTempDir('evo-v05-t3-global-');
    cleanupDirs.push(blankDir, globalRoot);
    process.env.EVO_GLOBAL_DIR = globalRoot;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;

    const dispatcher = new EvoMcpDispatcher(blankDir);
    try {
      const propRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'memory',
        scope: 'global',
        memory_type: 'personal',
        target_symbols: [],
        id: 'weekly-brief-outline-lesson',
        title: '周报结论先行经验',
        l0_summary: '每次写周报要先在邮件大纲顶部列出简洁结论和风险清单',
        symptom: '周报和汇报邮件过长时，管理层抓不住重点结论',
        root_cause: '未按大纲先写结论与风险，直接堆砌过程流水账',
        solution: '使用简洁大纲模板，顶部写三行结论，随后列风险与下一步计划。',
        tags: ['personal', 'writing'],
      });
      assert.notStrictEqual(propRes.isError, true, propRes.content?.[0]?.text);
      const propJson = JSON.parse(propRes.content[0].text);
      assert.strictEqual(propJson.passed, true);
      assert.strictEqual(propJson.diagnostics.memory_type, 'personal');

      const gStorage = new EvoStorage(globalRoot);
      const saved = gStorage.getMemory('weekly-brief-outline-lesson');
      assert.ok(saved);
      assert.strictEqual(saved!.memory_type, 'personal');
      assert.deepStrictEqual(saved!.target_symbols, []);
      assert.strictEqual(saved!.created_commit, 'personal');

      // Search via English expanded synonyms in blank non-code directory (stored in Chinese!)
      const synSearch = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'weekly report email outline conclusion',
        scope: 'global',
      });
      assert.notStrictEqual(synSearch.isError, true, synSearch.content?.[0]?.text);
      const txt = synSearch.content[0].text;
      assert.ok(
        txt.includes('weekly-brief-outline-lesson'),
        `Expected bilingual synonym recall for personal memory, got:\n${txt}`
      );
      assert.ok(txt.includes('[PERSONAL]'));
      assert.strictEqual(txt.includes('[STALE]'), false);

      const insRes = await dispatcher.handleToolCallAsync('evo_inspect', {
        id: 'weekly-brief-outline-lesson',
        tier: 'L2',
      });
      assert.ok(insRes.content[0].text.includes('[PERSONAL MEMORY L2]'));
      assert.strictEqual(insRes.content[0].text.includes('[STALE]'), false);
    } finally {
      dispatcher.close();
    }
  });

  test('18. 2A Onboarding, Import & init --global: parseMarkdownToPreferenceCandidates, import, onboard, add/remove/clean, and runInitGlobal', () => {
    const fakeHome = makeTempDir('evo-v05-2a-home-');
    const ws = makeTempDir('evo-v05-2a-ws-');
    cleanupDirs.push(fakeHome, ws);

    // 1. parseMarkdownToPreferenceCandidates skips EVO:START, EVO:PROFILE, tables, and fenced code blocks
    const sampleClaudeMd = [
      '<!-- EVO:START -->',
      '# Managed Seed',
      '- Should never be imported from EVO:START block',
      '<!-- EVO:END -->',
      '',
      '<!-- EVO:PROFILE:START -->',
      '- Should never be imported from EVO:PROFILE block',
      '<!-- EVO:PROFILE:END -->',
      '',
      '## Communication & Style',
      '- **Concise replies**: Lead with the bottom-line answer and 3-5 plain bullets.',
      '- Never include filler praise or boilerplate disclaimers.',
      '',
      '| Column A | Column B |',
      '| --- | --- |',
      '| Ignore table cell A | Ignore table cell B |',
      '',
      '```ts',
      '// - Ignore bullet inside code fence',
      'const ignoredCode = "sk-ignore-code";',
      '```',
      '',
      '## Workflow Standards',
      '- Always run build and full test suite before reporting completion.',
    ].join('\n');

    const candidates = parseMarkdownToPreferenceCandidates(sampleClaudeMd, 'CLAUDE.md');
    assert.strictEqual(candidates.length, 3, `Expected 3 clean bullets, got: ${JSON.stringify(candidates)}`);
    assert.ok(candidates.every((c) => !c.content.includes('EVO:START') && !c.content.includes('EVO:PROFILE')));
    assert.ok(candidates.every((c) => !c.content.includes('Ignore table cell')));
    assert.ok(candidates.every((c) => !c.content.includes('Ignore bullet inside code fence')));
    assert.strictEqual(candidates[2].category, 'workflow');

    // Setup isolated fakeHome with host configs + stale plugin seed with Section 4 & 5
    const geminiSettings = path.join(fakeHome, '.gemini', 'settings.json');
    const claudeJson = path.join(fakeHome, '.claude.json');
    const cursorDir = path.join(fakeHome, '.cursor');
    const codexToml = path.join(fakeHome, '.codex', 'config.toml');
    const pluginSeed = path.join(
      fakeHome,
      '.gemini',
      'config',
      'plugins',
      'evo-kernel',
      'rules',
      'AGENTS.md'
    );
    const geminiHostMd = path.join(fakeHome, '.gemini', 'GEMINI.md');
    const claudeHostMd = path.join(fakeHome, '.claude', 'CLAUDE.md');

    fs.mkdirSync(path.dirname(geminiSettings), { recursive: true });
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.mkdirSync(path.dirname(codexToml), { recursive: true });
    fs.mkdirSync(path.dirname(pluginSeed), { recursive: true });
    fs.mkdirSync(path.dirname(claudeHostMd), { recursive: true });
    fs.writeFileSync(geminiSettings, JSON.stringify({ theme: 'dark' }), 'utf8');
    fs.writeFileSync(claudeJson, JSON.stringify({ numStartups: 1 }), 'utf8');
    fs.writeFileSync(codexToml, 'model = "o3"\n', 'utf8');
    fs.writeFileSync(geminiHostMd, '# My Gemini Global\n', 'utf8');
    fs.writeFileSync(claudeHostMd, '# My Claude Global\n', 'utf8');
    fs.writeFileSync(
      pluginSeed,
      [
        '<!-- EVO:START -->',
        '# Old Seed',
        'Skip `evo_search` during general chat.',
        '',
        '## 4. Evolved Core Invariants (Auto-Managed by EvoKernel)',
        '- **[custom-core-keep]**: Keep evolved invariant intact.',
        '',
        '### 5. Registered Micro-Tools via `evo_run`',
        '- `[tool] custom-tool-keep`: Keep registered tool catalog.',
        '<!-- EVO:END -->',
      ].join('\n'),
      'utf8'
    );

    // 2. runInitGlobal({ homeDir }) mounts MCP, upgrades stale plugin seed (preserving Section 4/5), and syncs profile hermetically
    delete process.env.EVO_GLOBAL_DIR;
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;
    const initGlobalRes = runInitGlobal({ homeDir: fakeHome, installRoot: REPO_ROOT });
    const expectedGlobalRoot = path.join(fakeHome, '.evo', 'global');
    assert.strictEqual(path.resolve(initGlobalRes.globalRoot), path.resolve(expectedGlobalRoot));
    assert.ok(fs.existsSync(path.join(expectedGlobalRoot, '.evo', 'config.json')));
    assert.ok(initGlobalRes.mcpTargetsUpdated.some((p) => p.endsWith('settings.json')));
    assert.ok(initGlobalRes.mcpTargetsUpdated.some((p) => p.endsWith('.claude.json')));
    assert.ok(initGlobalRes.mcpTargetsUpdated.some((p) => p.endsWith('config.toml')));
    assert.ok(
      JSON.parse(fs.readFileSync(geminiSettings, 'utf8')).mcpServers?.['evo-kernel'],
      'Gemini global MCP must be mounted'
    );
    assert.ok(
      JSON.parse(fs.readFileSync(claudeJson, 'utf8')).mcpServers?.['evo-kernel'],
      'Claude global MCP must be mounted'
    );
    assert.ok(
      fs.readFileSync(codexToml, 'utf8').includes('[mcp_servers.evo-kernel]'),
      'Codex global MCP must be mounted'
    );

    const upgradedSeed = fs.readFileSync(pluginSeed, 'utf8');
    assert.ok(initGlobalRes.pluginSeedsUpdated.includes(pluginSeed));
    assert.ok(upgradedSeed.includes('scope: "global"'), 'Plugin seed must be upgraded to v0.5');
    assert.ok(upgradedSeed.includes('custom-core-keep'), 'Section 4 must be preserved');
    assert.ok(upgradedSeed.includes('custom-tool-keep'), 'Section 5 must be preserved');

    // Now bind EVO_GLOBAL_DIR + EVO_GLOBAL_PROFILE_TARGETS inside fakeHome for CLI tests
    process.env.EVO_GLOBAL_DIR = expectedGlobalRoot;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = [geminiHostMd, claudeHostMd].join(',');

    // 3. evo profile import <file> --apply --json
    const sampleImportFile = path.join(ws, 'CLAUDE.md');
    fs.writeFileSync(sampleImportFile, sampleClaudeMd, 'utf8');

    const previewOut = captureConsoleLog(() => {
      runCli(['node', 'evo', 'profile', 'import', sampleImportFile, '--json']);
    });
    const previewJson = JSON.parse(previewOut);
    assert.strictEqual(previewJson.applied, false);
    assert.strictEqual(previewJson.count, 3);

    const applyImportOut = captureConsoleLog(() => {
      runCli(['node', 'evo', 'profile', 'import', sampleImportFile, '--apply', '--json']);
    });
    const applyImportJson = JSON.parse(applyImportOut);
    assert.strictEqual(applyImportJson.applied, true);
    assert.strictEqual(applyImportJson.importedCount, 3);
    assert.ok(fs.readFileSync(geminiHostMd, 'utf8').includes(PROFILE_MARKER_START));

    // 4. evo profile onboard --preset concise-ceo --apply --json
    const onboardOut = captureConsoleLog(() => {
      runCli(['node', 'evo', 'profile', 'onboard', '--preset', 'concise-ceo', '--apply', '--json']);
    });
    const onboardJson = JSON.parse(onboardOut);
    assert.strictEqual(onboardJson.applied, true);
    assert.ok(onboardJson.importedCount >= 1);
    assert.ok(fs.readFileSync(claudeHostMd, 'utf8').includes('ceo-bottom-line-first'));

    // 5. evo profile add / remove / clean end-to-end
    const addOut = captureConsoleLog(() => {
      runCli([
        'node',
        'evo',
        'profile',
        'add',
        '--id',
        'cli-e2e-pref',
        '--category',
        'knowledge',
        '--title',
        'CLI E2E Glossary',
        '--summary',
        'Keep domain acronyms consistent',
        '--content',
        'Always expand unfamiliar acronyms on first mention.',
        '--json',
      ]);
    });
    const addJson = JSON.parse(addOut);
    assert.strictEqual(addJson.ok, true);
    assert.ok(fs.readFileSync(geminiHostMd, 'utf8').includes('cli-e2e-pref'));

    const removeOut = captureConsoleLog(() => {
      runCli(['node', 'evo', 'profile', 'remove', 'cli-e2e-pref', '--json']);
    });
    const removeJson = JSON.parse(removeOut);
    assert.strictEqual(removeJson.ok, true);
    assert.strictEqual(fs.readFileSync(geminiHostMd, 'utf8').includes('cli-e2e-pref'), false);

    const cleanOut = captureConsoleLog(() => {
      runCli(['node', 'evo', 'profile', 'clean', '--json']);
    });
    const cleanJson = JSON.parse(cleanOut);
    assert.strictEqual(cleanJson.ok, true);
    assert.strictEqual(fs.readFileSync(geminiHostMd, 'utf8').includes(PROFILE_MARKER_START), false);
    assert.ok(fs.readFileSync(geminiHostMd, 'utf8').includes('# My Gemini Global'));
    assert.strictEqual(fs.readFileSync(claudeHostMd, 'utf8').includes(PROFILE_MARKER_START), false);
  });
});
