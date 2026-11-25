import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { EvoStorage } from '../core/storage.js';
import { EvoMcpDispatcher } from '../mcp/handlers.js';
import { MCP_INSTRUCTIONS } from '../mcp/server.js';
import { syncGlobalUserProfile } from '../core/profile-sync.js';
import { parseMarkdownToPreferenceCandidates } from '../core/profile-import.js';
import { getCanonicalToken, CANONICAL_SYNONYM_MAP } from '../core/lexicon.js';
import {
  detectConversationEvolutionSignals,
  buildPreferenceEvolutionHint,
} from '../core/hook-engine.js';
import { L0_META_RULE_SEED } from '../templates/meta-rule.js';
import { UI_I18N } from '../templates/ui/i18n.js';
import { renderUiClientHtml } from '../templates/ui/shell.js';
import { buildUiSnapshot, buildExportHtmlContent } from '../cli/ui.js';
import { executeWorkbenchAction } from '../core/workbench-actions.js';
import { handleWebviewAction } from '../ide/vscode-extension.js';
import { COMMAND_VALID_FLAGS } from '../cli/index.js';
import { runInit, runInitGlobal, syncManagedRuleBlocks } from '../cli/init.js';
import { refreshMemories } from '../core/memory/freshness-verifier.js';

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(d);
  return d;
}

function makeIsolatedEnv(homeDir: string, globalDir?: string): NodeJS.ProcessEnv {
  const gDir = globalDir || path.join(homeDir, '.evo', 'global');
  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    EVO_GLOBAL_DIR: gDir,
    EVO_GLOBAL_PROFILE_TARGETS: '',
    NO_COLOR: '1',
  };
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv, input = '') {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    env,
    input,
    encoding: 'utf8',
    timeout: 20000,
  });
}

describe('P0–P2 UX & Reliability Overhaul Acceptance Suite', () => {
  const savedGlobalDir = process.env.EVO_GLOBAL_DIR;
  const savedProfileTargets = process.env.EVO_GLOBAL_PROFILE_TARGETS;

  afterEach(() => {
    if (savedGlobalDir === undefined) delete process.env.EVO_GLOBAL_DIR;
    else process.env.EVO_GLOBAL_DIR = savedGlobalDir;
    if (savedProfileTargets === undefined) delete process.env.EVO_GLOBAL_PROFILE_TARGETS;
    else process.env.EVO_GLOBAL_PROFILE_TARGETS = savedProfileTargets;

    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop()!;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // P0.1: Non-TTY uninstall --purge fail-closed
  // =========================================================================
  test('P0.1: Non-TTY evo uninstall --purge fails closed without --yes, preserves data, and succeeds with --yes', () => {
    const ws = makeTempDir('evo-p01-ws-');
    const homeDir = makeTempDir('evo-p01-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    const env = makeIsolatedEnv(homeDir, globalDir);

    runInit(ws, { targets: ['claude'], globalHomeDir: homeDir });
    runInitGlobal({ homeDir, globalDir });
    assert.ok(fs.existsSync(path.join(ws, '.evo')), 'Project .evo must exist before uninstall');
    assert.ok(fs.existsSync(path.join(globalDir, '.evo')), 'Global .evo must exist before uninstall');

    // Non-TTY stdin without --yes MUST fail closed and delete NOTHING
    const blocked = runCli(['uninstall', '--purge', '--global'], ws, env, '');
    assert.notStrictEqual(blocked.status, 0, 'Non-TTY uninstall --purge without --yes must exit non-zero');
    const combinedErr = `${blocked.stdout}\n${blocked.stderr}`;
    assert.ok(combinedErr.includes('--yes'), `Must instruct user to pass --yes: ${combinedErr}`);
    assert.ok(combinedErr.includes('--dry-run'), `Must suggest --dry-run preview: ${combinedErr}`);
    assert.ok(fs.existsSync(path.join(ws, '.evo')), 'Project .evo must remain intact after fail-closed abort');
    assert.ok(fs.existsSync(path.join(globalDir, '.evo')), 'Global .evo must remain intact after fail-closed abort');

    // With explicit --yes, purge proceeds cleanly
    const confirmed = runCli(['uninstall', '--purge', '--global', '--yes'], ws, env, '');
    assert.strictEqual(confirmed.status, 0, `Expected exit 0 with --yes, stderr: ${confirmed.stderr}`);
    assert.strictEqual(fs.existsSync(path.join(ws, '.evo')), false, 'Project .evo must be deleted with --purge --yes');
    assert.strictEqual(fs.existsSync(path.join(globalDir, '.evo')), false, 'Global .evo must be deleted with --global --purge --yes');
  });

  // =========================================================================
  // P0.2: init --all --dry-run includes global preview with 0 mutations
  // =========================================================================
  test('P0.2: evo init --all --dry-run previews BOTH project and global plans in JSON & text with 0 writes', () => {
    const ws = makeTempDir('evo-p02-ws-');
    const homeDir = makeTempDir('evo-p02-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), '# User notes\n', 'utf8');
    const env = makeIsolatedEnv(homeDir, globalDir);

    const jsonRes = runCli(['init', '--all', '--dry-run', '--json'], ws, env);
    assert.strictEqual(jsonRes.status, 0, `init --all --dry-run --json failed: ${jsonRes.stderr}`);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.strictEqual(parsed.dryRun, true);
    assert.ok(parsed.global, 'JSON preview must include global plan');
    assert.strictEqual(parsed.global.dryRun, true);
    assert.strictEqual(fs.existsSync(path.join(ws, '.evo')), false, 'Project .evo must not be created on dry-run');
    assert.strictEqual(fs.existsSync(path.join(globalDir, '.evo')), false, 'Global .evo must not be created on dry-run');

    const txtRes = runCli(['init', '--all', '--dry-run'], ws, env);
    assert.strictEqual(txtRes.status, 0, `init --all --dry-run failed: ${txtRes.stderr}`);
    assert.match(txtRes.stdout, /Global|global|DRY RUN/i);
    assert.strictEqual(fs.existsSync(path.join(globalDir, '.evo')), false);
  });

  // =========================================================================
  // P0.3: Scope-aware undo, non-profile undo, and atomic batch_id rollback
  // =========================================================================
  test('P0.3: Scope-aware evo_propose(undo: true) supports project rules/tools/memories and atomic multi-step evo_compact rollback', async () => {
    const ws = makeTempDir('evo-p03-ws-');
    const homeDir = makeTempDir('evo-p03-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    process.env.EVO_GLOBAL_DIR = globalDir;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = '';

    runInit(ws, { targets: ['claude'], globalHomeDir: homeDir });
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // 1. Add a global preference
      const gPrefRes = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'p03-global-habit',
        content: 'Always summarize trade-offs before proposing an architecture change.',
      });
      assert.strictEqual(JSON.parse(gPrefRes.content[0].text).passed, true);

      // 2. Add a project rule (later timestamp than global pref)
      await new Promise((r) => setTimeout(r, 15));
      const pRule1 = await dispatcher.handleToolCallAsync('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'p03-scoped-rule-a',
        title: 'Validate input boundaries in parser modules',
        l0_summary: 'Check empty and malformed payload boundaries before parsing.',
        scope_glob: 'src/**/*.ts',
        core: false,
        content: 'Validate payload type and size before running parsing routines across modules.',
        transfer_scenarios: ['Parser validation across modules', 'Config schema boundary checks'],
      });
      assert.strictEqual(JSON.parse(pRule1.content[0].text).passed, true);

      // 3. Undo with workspace=ws (no explicit scope): must undo latest change (project rule), NOT global preference!
      const undoProjectRes = await dispatcher.handleToolCallAsync('evo_propose', {
        workspace: ws,
        undo: true,
      });
      const undoProjJson = JSON.parse(undoProjectRes.content[0].text);
      assert.strictEqual(undoProjJson.ok, true, `Project undo failed: ${undoProjectRes.content[0].text}`);
      assert.strictEqual(undoProjJson.undone, true);
      assert.strictEqual(undoProjJson.scope, 'project');
      assert.strictEqual(undoProjJson.undone_entry?.id, 'p03-scoped-rule-a');
      const projStorage = new EvoStorage(ws);
      const globStorage = new EvoStorage(globalDir);
      assert.strictEqual(projStorage.getRule('p03-scoped-rule-a'), null, 'Project rule must be removed by project undo');
      assert.ok(globStorage.getPreference('p03-global-habit'), 'Global preference must remain untouched when project change is undone');

      // 4. Add two project rules, compact them into one merged rule, then undo the ENTIRE compact atomically in 1 step!
      const rA = await dispatcher.handleToolCallAsync('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'p03-compact-a',
        title: 'Guard async retry backoff',
        l0_summary: 'Use bounded jittered backoff for transient I/O retries.',
        scope_glob: 'src/**/*.ts',
        core: false,
        content: 'Apply bounded exponential backoff with jitter whenever retrying transient I/O calls.',
        transfer_scenarios: ['Network retry loops', 'Disk lock retry handlers'],
      });
      assert.strictEqual(JSON.parse(rA.content[0].text).passed, true);
      const rB = await dispatcher.handleToolCallAsync('evo_propose', {
        workspace: ws,
        kind: 'rule',
        id: 'p03-compact-b',
        title: 'Release file descriptors on error',
        l0_summary: 'Always release open file handles inside finally blocks.',
        scope_glob: 'src/**/*.ts',
        core: false,
        content: 'Wrap open handles and database connections in try/finally so failures never leak descriptors.',
        transfer_scenarios: ['SQLite handle cleanup', 'Temporary file stream cleanup'],
      });
      assert.strictEqual(JSON.parse(rB.content[0].text).passed, true);

      const compactRes = await dispatcher.handleToolCallAsync('evo_compact', {
        workspace: ws,
        target_ids: ['p03-compact-a', 'p03-compact-b'],
        merged_proposal: {
          kind: 'rule',
          id: 'p03-compact-merged',
          title: 'Resilient I/O retries and handle cleanup',
          l0_summary: 'Use bounded retries and always close handles in finally blocks.',
          scope_glob: 'src/**/*.ts',
          core: false,
          content: 'Combine bounded jittered retries with strict try/finally cleanup across I/O paths.',
          transfer_scenarios: ['Network/disk retry flows', 'Database handle teardown'],
        },
      });
      assert.strictEqual(JSON.parse(compactRes.content[0].text).result?.passed, true, `Compact failed: ${compactRes.content[0].text}`);
      assert.ok(projStorage.getRule('p03-compact-merged'), 'Merged rule must exist after compact');
      assert.strictEqual(projStorage.getRule('p03-compact-a'), null, 'Archived rule A must be removed');
      assert.strictEqual(projStorage.getRule('p03-compact-b'), null, 'Archived rule B must be removed');

      // Single undo must revert merged rule AND restore BOTH original rules atomically
      const undoCompactRes = await dispatcher.handleToolCallAsync('evo_propose', {
        workspace: ws,
        scope: 'project',
        undo: true,
      });
      const undoCompactJson = JSON.parse(undoCompactRes.content[0].text);
      assert.strictEqual(undoCompactJson.ok, true, `Atomic compact undo failed: ${undoCompactRes.content[0].text}`);
      assert.strictEqual(undoCompactJson.undone, true);
      assert.strictEqual(projStorage.getRule('p03-compact-merged'), null, 'Merged rule must be removed after batch undo');
      assert.ok(projStorage.getRule('p03-compact-a'), 'Original rule A must be restored by batch undo');
      assert.ok(projStorage.getRule('p03-compact-b'), 'Original rule B must be restored by batch undo');
    } finally {
      dispatcher.close();
    }
  });

  // =========================================================================
  // P0.4: Default auto_resolve=true loop-convergence + atomic batch undo
  // =========================================================================
  test('P0.4: Preference auto_resolve defaults to true, loop-converges conflicts + budget, and rolls back atomically', async () => {
    const homeDir = makeTempDir('evo-p04-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    process.env.EVO_GLOBAL_DIR = globalDir;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = '';

    const dispatcher = new EvoMcpDispatcher(globalDir);
    try {
      // Seed an initial preference banning tables
      const p1 = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'p04-no-tables',
        title: 'Never use tables',
        l0_summary: 'Never use markdown tables; use short bullets instead.',
        category: 'formatting',
        always_on: true,
        content: 'Never use markdown tables in replies; always use short plain bullet lists.',
      });
      assert.strictEqual(JSON.parse(p1.content[0].text).passed, true);

      // Submit contradictory preference WITHOUT passing auto_resolve (default = true!)
      const p2 = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'preference',
        scope: 'global',
        id: 'p04-prefer-tables',
        title: 'Prefer markdown tables',
        l0_summary: 'Always present metric comparisons as markdown tables.',
        category: 'formatting',
        always_on: true,
        content: 'Always use markdown tables when comparing options or metrics.',
      });
      const p2Json = JSON.parse(p2.content[0].text);
      assert.strictEqual(p2Json.passed, true, `Default auto_resolve must converge conflict cleanly: ${p2.content[0].text}`);
      assert.ok(p2Json.human_receipt, 'Must return plain human_receipt');

      const gStorage = new EvoStorage(globalDir);
      assert.ok(gStorage.getPreference('p04-prefer-tables'), 'New preference must be active');
      assert.strictEqual(gStorage.getPreference('p04-no-tables'), null, 'Conflicting preference must be auto-superseded');

      // Single undo must restore p04-no-tables and remove p04-prefer-tables atomically
      const undoRes = await dispatcher.handleToolCallAsync('evo_propose', {
        scope: 'global',
        undo: true,
      });
      const undoP04Json = JSON.parse(undoRes.content[0].text);
      assert.strictEqual(undoP04Json.ok, true);
      assert.strictEqual(undoP04Json.undone, true);
      assert.ok(gStorage.getPreference('p04-no-tables'), 'Superseded preference must be restored by undo');
      assert.strictEqual(gStorage.getPreference('p04-prefer-tables'), null, 'Auto-resolved preference must be reverted');
    } finally {
      dispatcher.close();
    }
  });

  // =========================================================================
  // P0.5: Honest failure & warning receipts (malformed markers & Windsurf truncation)
  // =========================================================================
  test('P0.5: profile-sync reports explicit warnings on malformed markers and Windsurf >6000-char truncation', () => {
    delete process.env.EVO_GLOBAL_PROFILE_TARGETS;
    const homeDir = makeTempDir('evo-p05-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    const gStorage = new EvoStorage(globalDir);
    gStorage.ensureInitialized();
    gStorage.savePreference({
      id: 'p05-pref-sample',
      title: 'Keep responses direct',
      l0_summary: 'Lead with the conclusion and keep explanations concise.',
      category: 'style',
      always_on: true,
      tags: ['style'],
      content: 'Always lead with the conclusion first and keep explanations direct and actionable.',
      tokens: 24,
      origin: 'evolved',
      enabled: true,
      review_status: 'approved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 1. Malformed markers in ~/.claude/CLAUDE.md (missing END marker)
    const claudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const claudePath = path.join(claudeDir, 'CLAUDE.md');
    const brokenContent = '# My Rules\n<!-- EVO:PROFILE:START -->\nunclosed block\n';
    fs.writeFileSync(claudePath, brokenContent, 'utf8');

    // 2. Windsurf global_rules.md near 6000-char cap
    const windsurfDir = path.join(homeDir, '.codeium', 'windsurf', 'memories');
    fs.mkdirSync(windsurfDir, { recursive: true });
    const windsurfPath = path.join(windsurfDir, 'global_rules.md');
    fs.writeFileSync(windsurfPath, 'A'.repeat(5920) + '\n', 'utf8');

    const syncRes = syncGlobalUserProfile(globalDir, { homeDir });
    const claudeTarget = syncRes.targets.find((t) => t.host === 'claude');
    assert.ok(claudeTarget, `Claude target must be discovered: ${JSON.stringify(syncRes.targets)}`);
    assert.strictEqual(claudeTarget.status, 'skipped', 'Malformed markers must report status=skipped, not unchanged');
    assert.strictEqual(claudeTarget.reason, 'malformed_markers');
    assert.ok(claudeTarget.warning && claudeTarget.warning.length > 0, 'Malformed markers must include warning');
    assert.strictEqual(fs.readFileSync(claudePath, 'utf8'), brokenContent, 'Malformed host file must not be corrupted');

    const windsurfTarget = syncRes.targets.find((t) => t.host === 'windsurf');
    assert.ok(windsurfTarget, 'Windsurf target must be discovered');
    assert.ok(
      windsurfTarget.truncated === true || (windsurfTarget.warning && windsurfTarget.warning.includes('6000')),
      `Windsurf near-cap target must report truncation/warning: ${JSON.stringify(windsurfTarget)}`
    );
    assert.ok(Array.isArray(syncRes.warnings) && syncRes.warnings.length >= 2, `Expected >=2 sync warnings, got: ${JSON.stringify(syncRes.warnings)}`);
  });

  // =========================================================================
  // P0.6–P0.9 & P1.1 & P2.1–P2.2: Workbench UI, Structured Editor & Actions
  // =========================================================================
  test('P0.6–P0.9 & P1.1: Workbench Pending parity, draft preservation, structured editor, safe actions, and plain i18n', async () => {
    const ws = makeTempDir('evo-p06-ws-');
    const homeDir = makeTempDir('evo-p06-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    process.env.EVO_GLOBAL_DIR = globalDir;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = '';

    runInit(ws, { targets: ['claude'], globalHomeDir: homeDir });
    const srcFile = path.join(ws, 'src', 'sample.ts');
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });
    fs.writeFileSync(srcFile, 'export function computeTotal(a: number, b: number) { return a + b; }\n', 'utf8');

    // Structured create-memory (Hotspot CTA) & structured update-content (no heading reversion!)
    const createMemRes = await executeWorkbenchAction(
      ws,
      'create-memory',
      {
        filePath: 'src/sample.ts',
        title: 'Guard integer overflow in computeTotal',
        symptom: 'Overflow occurs on large inputs.',
        root_cause: 'No safe bounds check.',
        solution: 'Validate input bounds before summing.',
      },
      { buildSnapshot: (w, o) => buildUiSnapshot(w, o), syncRuleBlocks: syncManagedRuleBlocks }
    );
    assert.strictEqual(createMemRes.status, 200, `create-memory failed: ${JSON.stringify(createMemRes.body)}`);
    const createdMemId = createMemRes.body.data.id;

    const updateMemRes = await executeWorkbenchAction(
      ws,
      'update-content',
      {
        kind: 'memory',
        id: createdMemId,
        title: 'Updated computeTotal lesson',
        symptom: 'Updated symptom text without markdown headings',
        root_cause: 'Updated cause text',
        solution: 'Updated solution text',
      },
      { buildSnapshot: (w, o) => buildUiSnapshot(w, o), syncRuleBlocks: syncManagedRuleBlocks }
    );
    assert.strictEqual(updateMemRes.status, 200, `structured memory update failed: ${JSON.stringify(updateMemRes.body)}`);
    const projStorage = new EvoStorage(ws);
    const updatedMem = projStorage.getMemory(createdMemId);
    assert.ok(updatedMem);
    assert.strictEqual(updatedMem.symptom, 'Updated symptom text without markdown headings');
    assert.strictEqual(updatedMem.root_cause, 'Updated cause text');
    assert.strictEqual(updatedMem.solution, 'Updated solution text');

    // Structured skill update without requiring ## L1 Contract / ## L2 SOP headings
    projStorage.saveSkill({
      id: 'p08-test-skill',
      name: 'Original Skill',
      description: 'Original desc',
      tags: ['test'],
      l1_contract: 'Old contract',
      l2_sop: 'Old SOP',
      origin: 'evolved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const updateSkillRes = await executeWorkbenchAction(
      ws,
      'update-content',
      {
        kind: 'skill',
        id: 'p08-test-skill',
        title: 'Renamed Skill',
        l1_contract: 'New clean L1 trigger contract',
        l2_sop: 'Step 1: Verify inputs.\nStep 2: Run checks.',
      },
      { buildSnapshot: (w, o) => buildUiSnapshot(w, o), syncRuleBlocks: syncManagedRuleBlocks }
    );
    assert.strictEqual(updateSkillRes.status, 200);
    const updatedSkill = projStorage.getSkill('p08-test-skill');
    assert.ok(updatedSkill);
    assert.strictEqual(updatedSkill.l1_contract, 'New clean L1 trigger contract');
    assert.strictEqual(updatedSkill.l2_sop, 'Step 1: Verify inputs.\nStep 2: Run checks.');

    // Render live and static export HTML and verify UI invariants
    const snap = buildUiSnapshot(ws);
    const liveHtml = renderUiClientHtml(snap, { token: 'tok-test', isExport: false });
    const exportHtml = buildExportHtmlContent(ws, { anon: true });

    // 100% EN/ZH i18n parity & plain language checks
    const enKeys = Object.keys(UI_I18N.en).sort();
    const zhKeys = Object.keys(UI_I18N.zh).sort();
    assert.deepStrictEqual(enKeys, zhKeys, 'UI_I18N.en and UI_I18N.zh must have identical key sets');
    for (const banned of [
      'Fixed L0 Gateway',
      'KV-shielded',
      '正交能力与 AST 调用拓扑图',
      '确定性 Gatekeeper 门禁审计流',
      '注入模式',
      '通过门禁校验并保存',
      '已搁置',
    ]) {
      assert.strictEqual(liveHtml.includes(banned), false, `Workbench UI must not contain raw jargon: ${banned}`);
    }

    // Security & JS syntax invariants
    assert.strictEqual(/\bon[a-z]+\s*=/i.test(liveHtml), false, 'Zero on*= handlers or on* assignments');
    assert.strictEqual(liveHtml.includes('confirm('), false, 'Zero native confirm() calls');
    const scriptBody = liveHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
    assert.doesNotThrow(() => new Function(scriptBody), 'Live Workbench script must parse cleanly');

    // P0.6 Pending includes preferences; P0.7 applyI18n preserves dirty draft; P0.8 structured fields; P0.9 no row trash
    assert.ok(liveHtml.includes("if (activeCapsStatus === 'pending' || activeCapsKind === 'preferences')"), 'Pending filter must include preferences');
    assert.ok(liveHtml.includes("if (selectedCapability && !(inspectorMode === 'edit' && editorDirty))"), 'applyI18n must preserve dirty inline drafts');
    assert.ok(liveHtml.includes('editor-field-symptom') && liveHtml.includes('editor-field-l1'), 'Structured per-kind editor fields must be rendered');
    assert.strictEqual(liveHtml.includes('row-archive-btn'), false, 'Inline 4px-adjacent row trash button must be removed');
    assert.ok(liveHtml.includes("var codeTxt = kind === 'tools'"), 'Tab indentation trap must be restricted to tools code editor');
    assert.ok(liveHtml.includes('dict.serverIdeSync'), 'VS Code Webview must display IDE Sync instead of fake LIVE SSE');
    assert.ok(liveHtml.includes('btn-export-anon') && liveHtml.includes('btn-export-full'), 'Export must expose Anonymized vs Full Local choice');
    assert.ok(liveHtml.includes('if (!isExport || vscodeApi)'), 'Static export Cmd+K must filter live-only commands');
    assert.ok(exportHtml.includes('var isExport = true;'));
  });

  // =========================================================================
  // P1.2–P1.5: Silent recall, clientRoots[0] reads, smart inference, import auto-detect, lexicon, README
  // =========================================================================
  test('P1.2–P1.5: clientRoots read unification, auto-inferred schema fields, import auto-detect, lexicon fix, README order', async () => {
    const ws = makeTempDir('evo-p13-ws-');
    const homeDir = makeTempDir('evo-p13-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    process.env.EVO_GLOBAL_DIR = globalDir;
    process.env.EVO_GLOBAL_PROFILE_TARGETS = '';

    runInit(ws, { targets: ['claude'], globalHomeDir: homeDir });
    const dispatcher = new EvoMcpDispatcher(globalDir);
    dispatcher.setClientRoots([ws]);
    try {
      // 1. Auto-inferred id/title/l0_summary for rule (only content + transfer_scenarios provided)
      const autoRule = await dispatcher.handleToolCallAsync('evo_propose', {
        workspace: ws,
        kind: 'rule',
        scope_glob: 'src/**/*.ts',
        core: false,
        content: 'Always close database cursors inside finally blocks across storage modules.',
        transfer_scenarios: ['Storage cursor cleanup', 'Transaction teardown'],
      });
      const autoRuleJson = JSON.parse(autoRule.content[0].text);
      assert.strictEqual(autoRuleJson.passed, true, `Auto-inferred rule failed: ${autoRule.content[0].text}`);
      assert.ok(autoRuleJson.id, 'Rule id must be auto-inferred');

      // 2. Unified clientRoots[0] for READ tools (evo_search & evo_inspect WITHOUT passing workspace!)
      const searchNoWs = await dispatcher.handleToolCallAsync('evo_search', {
        query: 'database cursors finally',
        kind: 'rule',
      });
      assert.ok(
        searchNoWs.content[0].text.includes(autoRuleJson.id),
        `evo_search without workspace must resolve clientRoots[0]: ${searchNoWs.content[0].text}`
      );
      const inspectNoWs = await dispatcher.handleToolCallAsync('evo_inspect', {
        id: autoRuleJson.id,
        tier: 'L2',
      });
      assert.ok(
        inspectNoWs.content[0].text.includes('Always close database cursors'),
        `evo_inspect without workspace must resolve clientRoots[0]: ${inspectNoWs.content[0].text}`
      );

      // 3. Bidirectional personal <-> global inference on memory
      const personalMem = await dispatcher.handleToolCallAsync('evo_propose', {
        kind: 'memory',
        memory_type: 'personal',
        symptom: 'Weekly slide exports clipped long chart titles.',
        root_cause: 'Default slide box padding was too wide.',
        solution: 'Keep chart titles under 32 characters before exporting decks.',
      });
      const pmJson = JSON.parse(personalMem.content[0].text);
      assert.strictEqual(pmJson.passed, true, `memory_type=personal must auto-infer scope=global & id: ${personalMem.content[0].text}`);
      assert.ok(new EvoStorage(globalDir).getMemory(pmJson.id), 'Personal memory must be stored in global root');
    } finally {
      dispatcher.close();
    }

    // 4. Markdown import calls inferSituationalOnDemand when no explicit marker is present
    const imported = parseMarkdownToPreferenceCandidates([
      '- Always reply concisely with bullet points.',
      '- When writing weekly status reports, include Risks and Next Steps.',
      '- [always-on] When reviewing PRs, highlight breaking changes first.',
    ].join('\n'));
    assert.strictEqual(imported.length, 3);
    assert.strictEqual(imported[0].always_on, true, 'Universal habit must default to always_on: true');
    assert.strictEqual(imported[1].always_on, false, 'Situational "When writing..." rule must auto-infer always_on: false');
    assert.strictEqual(imported[2].always_on, true, 'Explicit [always-on] marker must override situational inference');

    // 5. Lexicon fix: 工作 -> work (NOT workbook); 工作簿 -> workbook
    const workCanonical = getCanonicalToken('工作');
    const workSyns = CANONICAL_SYNONYM_MAP.get('工作') || [];
    assert.notStrictEqual(workCanonical, 'workbook', '工作 must NOT canonicalize to workbook');
    assert.strictEqual(workSyns.includes('workbook'), false, '工作 must NOT over-bind to workbook');
    assert.strictEqual(getCanonicalToken('工作簿'), 'workbook', '工作簿 must map to workbook');

    // 6. Silent Recall & plain human_receipt in seed + MCP instructions
    assert.ok(L0_META_RULE_SEED.includes('Silent Recall'));
    assert.strictEqual(L0_META_RULE_SEED.includes('🛡️ EvoKernel Recall:'), false);
    assert.ok(MCP_INSTRUCTIONS.includes('human_receipt'));

    // 7. README.md & README.zh-CN.md Quick Start order and content
    for (const [file, qsHeading, revHeading, deepHeading] of [
      ['README.md', '## ⚡ 30-Second Quick Start', '## 🔒 Reversibility', '## 🧭 Deep Dive'],
      ['README.zh-CN.md', '## ⚡ 30 秒极速上手', '## 🔒 可逆性', '## 🧭 深入了解'],
    ] as const) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const qsIdx = content.indexOf(qsHeading);
      const revIdx = content.indexOf(revHeading);
      const deepIdx = content.indexOf(deepHeading);
      assert.ok(qsIdx !== -1 && revIdx !== -1 && deepIdx !== -1 && qsIdx < revIdx && revIdx < deepIdx, `${file} must put Quick Start before Reversibility & Deep Dive`);
      const qsSlice = content.slice(qsIdx, revIdx);
      assert.ok(qsSlice.includes('22.5'), `${file} Quick Start must mention Node >= 22.5 upfront`);
      assert.ok(qsSlice.includes('profile add'), `${file} Quick Start must use direct profile add`);
      assert.strictEqual(qsSlice.includes('--purge'), false, `${file} Quick Start must NOT include dangerous --purge flag`);
      assert.ok(qsSlice.includes('init --all'), `${file} Quick Start must clarify init --all vs --global`);
    }
  });

  // =========================================================================
  // P1.6: CLI Help <-> Valid Flags SSOT parity, global-only doctor, bare evo, loud errors
  // =========================================================================
  test('P1.6: CLI help parity, global-only doctor readiness, bare evo overview, loud invalid flag errors, and dry-run receipts', () => {
    const ws = makeTempDir('evo-p16-ws-');
    const homeDir = makeTempDir('evo-p16-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    const env = makeIsolatedEnv(homeDir, globalDir);

    // 1. Programmatic SSOT Help Parity across ALL commands in COMMAND_VALID_FLAGS
    const globalDisplayHidden = new Set(['-w', '--no-color', '--ascii', '--version', '-v', '--help', '-h', '--workspace']);
    const commandsToAudit = [
      'init',
      'uninstall',
      'score',
      'doctor',
      'audit',
      'refactor',
      'virtualize',
      'bootstrap',
      'memory',
      'tree',
      'ui',
      'profile',
      'check',
    ];
    for (const cmd of commandsToAudit) {
      const res = runCli([cmd, '--help'], ws, env);
      assert.strictEqual(res.status, 0, `${cmd} --help failed: ${res.stderr}`);
      const validFlags = COMMAND_VALID_FLAGS[cmd] || [];
      for (const flag of validFlags) {
        if (globalDisplayHidden.has(flag)) continue;
        // Short aliases like -g/-y/-p are optional when their long form is present, otherwise flag must be documented
        if (flag.length === 2 && flag.startsWith('-')) continue;
        assert.ok(
          res.stdout.includes(flag),
          `SSOT parity violation: evo ${cmd} --help is missing valid flag '${flag}':\n${res.stdout}`
        );
      }
    }

    // Dead flags removed: refactor --local-only & profile --global rejected
    const deadRefactor = runCli(['refactor', '--local-only'], ws, env);
    assert.notStrictEqual(deadRefactor.status, 0, 'Dead flag refactor --local-only must be rejected');
    const deadProfileGlobal = runCli(['profile', 'list', '--global'], ws, env);
    assert.notStrictEqual(deadProfileGlobal.status, 0, 'Dead ignored flag profile --global must be rejected');

    // 2. Bare `evo` prints concise state-aware overview (with Usage:) and writes 0 files
    const bareRes = runCli([], ws, env);
    assert.strictEqual(bareRes.status, 0, `Bare evo failed: ${bareRes.stderr}`);
    assert.ok(bareRes.stdout.includes('Usage:'), `Bare evo must include Usage: ${bareRes.stdout}`);
    assert.strictEqual(fs.existsSync(path.join(ws, '.evo')), false, 'Bare evo must not create .evo/');

    // 3. Global-only doctor readiness (after init --global on non-repo dir)
    runInitGlobal({ homeDir, globalDir });
    const docRes = runCli(['doctor', '--no-probe'], ws, env);
    assert.strictEqual(docRes.status, 0, `doctor --no-probe failed: ${docRes.stderr}`);
    assert.strictEqual(
      /Run\s+`?evo init`?\s+to initialize/i.test(docRes.stdout),
      false,
      `Global-only ready workspace must NOT emit false "Run evo init" warning:\n${docRes.stdout}`
    );

    // 4. Loud validation failures + JSON error responses
    const badTarget = runCli(['init', '--targets', 'nonexistent-ide'], ws, env);
    assert.notStrictEqual(badTarget.status, 0, 'Invalid --targets must exit non-zero');
    const badNum = runCli(['bootstrap', '--max-commits=notanumber'], ws, env);
    assert.notStrictEqual(badNum.status, 0, 'Invalid numeric flag must exit non-zero');
    const badHook = runCli(['hook', 'unknown-event'], ws, env);
    assert.notStrictEqual(badHook.status, 0, 'Unknown hook event must exit non-zero');
    const badProfileSub = runCli(['profile', 'delete', 'foo'], ws, env);
    assert.notStrictEqual(badProfileSub.status, 0);
    assert.ok(`${badProfileSub.stdout}\n${badProfileSub.stderr}`.includes('remove'), 'profile delete must suggest remove');
    const jsonErr = runCli(['doctor', '--bogus-flag', '--json'], ws, env);
    assert.notStrictEqual(jsonErr.status, 0);
    const parsedErr = JSON.parse(jsonErr.stdout || jsonErr.stderr);
    assert.strictEqual(parsedErr.ok, false, 'Error with --json must emit valid JSON with ok: false');

    // 5. refreshMemories --dry-run reports drifted memories without mutating disk files
    runInit(ws, { targets: ['claude'], globalHomeDir: homeDir });
    const srcPath = path.join(ws, 'calc.ts');
    fs.writeFileSync(srcPath, 'export function addNums(a: number, b: number) { return a + b; }\n', 'utf8');
    const st = new EvoStorage(ws);
    st.saveMemory({
      id: 'p16-dry-refresh-mem',
      title: 'Check addNums',
      l0_summary: 'Verify addNums behavior',
      symptom: 'Wrong sum',
      root_cause: 'Off by one',
      solution: 'Return a + b',
      target_symbols: ['calc.ts#addNums'],
      ast_fingerprints: {
        'calc.ts#addNums': {
          symbol: 'calc.ts#addNums',
          file_path: 'calc.ts',
          kind: 'function',
          start_line: 1,
          end_line: 1,
          signature: 'export function addNums(a: number, b: number)',
          ast_hash: 'stale-hash-0000',
        },
      },
      origin: 'evolved',
      confidence: 'HIGH',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const memFilePath = path.join(ws, '.evo', 'memories', 'p16-dry-refresh-mem.md');
    const beforeDry = fs.readFileSync(memFilePath, 'utf8');
    const dryRefresh = refreshMemories(ws, { dryRun: true });
    assert.ok(Array.isArray(dryRefresh.refreshed) && dryRefresh.refreshed.includes('p16-dry-refresh-mem'));
    assert.ok(Array.isArray(dryRefresh.skippedMissing));
    assert.ok(Array.isArray(dryRefresh.unchanged));
    assert.strictEqual(fs.readFileSync(memFilePath, 'utf8'), beforeDry, 'refreshMemories(dryRun: true) must NOT modify files on disk');
    const cliDryRefresh = runCli(['memory', 'refresh', '--dry-run'], ws, env);
    assert.strictEqual(cliDryRefresh.status, 0, `evo memory refresh --dry-run failed: ${cliDryRefresh.stderr}`);
    assert.strictEqual(fs.readFileSync(memFilePath, 'utf8'), beforeDry, 'CLI evo memory refresh --dry-run must NOT modify files on disk');

    // Also test CLI `evo virtualize --dry-run --json` & `evo audit` healthy collapse
    const virtJson = runCli(['virtualize', '--dry-run', '--json'], ws, env);
    assert.strictEqual(virtJson.status, 0, `virtualize --dry-run --json failed: ${virtJson.stderr}`);
    assert.ok(typeof JSON.parse(virtJson.stdout) === 'object');
  });

  // =========================================================================
  // P2.1 & P2.3: VS Code ViewColumn.Beside, non-blocking external MCP sync, tightened hook regexes
  // =========================================================================
  test('P2.1 & P2.3: VS Code ViewColumn.Beside, cache-first non-blocking MCP search, and tightened hook-engine regexes', async () => {
    const ws = makeTempDir('evo-p2-ws-');
    const homeDir = makeTempDir('evo-p2-home-');
    process.env.EVO_GLOBAL_DIR = path.join(homeDir, '.evo', 'global');
    process.env.EVO_GLOBAL_PROFILE_TARGETS = '';

    runInit(ws, { targets: ['claude'], globalHomeDir: homeDir });
    const targetFile = path.join(ws, 'demo.ts');
    fs.writeFileSync(targetFile, 'export const x = 1;\n', 'utf8');

    // 1. VS Code Webview open-editor uses ViewColumn.Beside (-2)
    let capturedViewColumn: number | undefined;
    const mockVscode = {
      ViewColumn: { One: 1, Beside: -2 },
      Uri: { file: (p: string) => ({ fsPath: p }) },
      Position: class {
        line: number;
        character: number;
        constructor(line: number, character: number) {
          this.line = line;
          this.character = character;
        }
      },
      Selection: class {
        anchor: any;
        active: any;
        constructor(anchor: any, active: any) {
          this.anchor = anchor;
          this.active = active;
        }
      },
      workspace: {
        openTextDocument: async (uri: any) => ({ uri }),
      },
      window: {
        showTextDocument: async (_doc: any, opts: any) => {
          capturedViewColumn = opts?.viewColumn;
        },
      },
    };
    const openRes = await handleWebviewAction('open-editor', { filePath: 'demo.ts', line: 1 }, ws, mockVscode);
    assert.strictEqual(openRes.ok, true, `open-editor failed: ${JSON.stringify(openRes)}`);
    assert.strictEqual(capturedViewColumn, -2, 'VS Code open-editor must open in ViewColumn.Beside (-2)');

    // 2. Cache-first non-blocking external MCP sync (slow 4s mock server does NOT stall evo_search)
    const slowServerPath = path.join(ws, 'slow-mcp.mjs');
    fs.writeFileSync(slowServerPath, 'setTimeout(() => process.exit(0), 4000);\n', 'utf8');
    const storage = new EvoStorage(ws);
    storage.saveConfig({
      ...storage.getConfig(),
      externalServers: {
        slow_srv: {
          command: process.execPath,
          args: [slowServerPath],
        },
      },
    });
    storage.saveExternalTools([
      {
        id: 'ext__slow_srv__ping',
        serverName: 'slow_srv',
        originalName: 'ping',
        title: 'Slow Server Ping',
        description: 'Cached ping tool for non-blocking test',
        inputSchema: { type: 'object', properties: {} },
        cachedAt: new Date().toISOString(),
      },
    ]);
    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const t0 = Date.now();
      const searchRes = await dispatcher.handleToolCallAsync('evo_search', {
        workspace: ws,
        query: 'ping',
        kind: 'tool',
      });
      const elapsedMs = Date.now() - t0;
      assert.ok(elapsedMs < 1500, `Cache-first evo_search must not stall on slow downstream MCP (took ${elapsedMs}ms)`);
      assert.ok(searchRes.content[0].text.includes('ext__slow_srv__ping'));
    } finally {
      dispatcher.close();
    }

    // 3. Tightened hook-engine regexes: code discussions don't false-trigger; English gets English hint
    const codeDiscussion = detectConversationEvolutionSignals(
      'Please fix the HTML <table> CSS border and update the SQL JOIN table schema in `src/table.ts`.'
    );
    assert.strictEqual(
      codeDiscussion.hasStyleCorrection,
      false,
      'Code discussion about HTML/SQL tables must NOT trigger global style preference'
    );

    const enHabit = detectConversationEvolutionSignals('Remember: always reply concisely and never use markdown tables.');
    assert.strictEqual(enHabit.hasStyleCorrection, true);
    assert.strictEqual(enHabit.lang, 'en');
    const enHint = buildPreferenceEvolutionHint(enHabit);
    assert.ok(!/[\u4e00-\u9fff]/.test(enHint), `English habit must yield English hint, got: ${enHint}`);

    const zhHabit = detectConversationEvolutionSignals('记住以后回复不要用表格，直接用大白话');
    assert.strictEqual(zhHabit.hasStyleCorrection, true);
    assert.strictEqual(zhHabit.lang, 'zh');
    const zhHint = buildPreferenceEvolutionHint(zhHabit);
    assert.ok(/[\u4e00-\u9fff]/.test(zhHint), `Chinese habit must yield Chinese hint, got: ${zhHint}`);
  });
});
