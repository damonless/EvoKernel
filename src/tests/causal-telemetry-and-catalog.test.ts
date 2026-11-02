import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvoStorage, estimateTokens } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { formatToolsCatalogMarkdown, MAX_TOOLS_CATALOG_TOKENS, runInit } from '../cli/init.js';
import { handlePreTool, handlePostTool, handleStop, handlePreCommit, runHook } from '../cli/hook.js';
import { syncDeclaredPreToolHooks, CodexAdapter, parseJsonc } from '../cli/harness.js';
import { runAudit, auditHarnessSurfaces, runRefactor } from '../cli/audit.js';
import {
  refreshMemories,
  verifyMemoryFreshness,
  findBraceBlockEnd,
  extractSymbolFingerprint,
  maskSourceLexical,
  trySkipGenericAngles,
} from '../core/memory.js';
import { redactSensitiveDiagnostics } from '../core/telemetry.js';
import { runOptimizationCycle } from '../core/optimize.js';
import type { EvoMemory, EvoRule, EvoSkill, EvoToolManifest } from '../core/types.js';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evo-causal-telemetry-'));
}

describe('Causal Telemetry, Outcome Attribution & Dynamic Section 5 Catalog Suite', () => {
  // =========================================================================
  // GROUP 1: DYNAMIC SECTION 5 TOOLS CATALOG & TOKEN BUDGETING
  // =========================================================================

  test('1. formatToolsCatalogMarkdown renders trigger cues when available, and falls back to compact on-demand list when cues absent', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Tool
      storage.saveTool(
        {
          id: 'workspace-metrics-scanner',
          title: 'workspace-metrics-scanner',
          l0_summary: 'Scans repository file counts and LOC',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.log("scanner");'
      );

      // Skill with trigger cue
      const skillWithCue: EvoSkill = {
        id: 'bug-to-guardrail-sop',
        name: 'bug-to-guardrail-sop',
        title: 'Closed-Loop Bug to Guardrail SOP',
        description: 'Route bugs to Episodic Memory and abstract reusable guardrails.',
        l0_summary: 'Route bugs to Episodic Memory and abstract reusable guardrails.',
        trigger_cue: 'When distilling a diagnosed bug into an episodic memory or SSOT guardrail',
        l1_contract: 'Trigger on non-trivial bug diagnosis.',
        l2_sop: '1. evo_search\n2. evo_inspect',
        origin: 'bootstrap',
        tags: ['sop'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveSkill(skillWithCue);

      // Skill without trigger cue
      const skillWithoutCue: EvoSkill = {
        id: 'general-review-sop',
        name: 'general-review-sop',
        title: 'General Code Review SOP',
        description: 'Standard code review checklist.',
        l0_summary: 'Standard code review checklist.',
        l1_contract: 'Trigger on PR review.',
        l2_sop: '1. Check types\n2. Check tests',
        origin: 'bootstrap',
        tags: ['review'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveSkill(skillWithoutCue);

      const catalog = formatToolsCatalogMarkdown(storage);

      // Verify trigger cue line format
      assert.ok(
        catalog.includes(
          '- When distilling a diagnosed bug into an episodic memory or SSOT guardrail -> `evo_inspect("bug-to-guardrail-sop", "L2")`'
        ),
        'Expected cued skill to be rendered with When <cue> -> evo_inspect format'
      );

      // Verify uncued skill falls back to compact line
      assert.ok(
        catalog.includes('- On-demand rules/skills (inspect via `evo_inspect`): `[skill] general-review-sop`'),
        'Expected uncued skill to appear in compact line'
      );

      // Verify tool catalog entry
      assert.ok(
        catalog.includes('`[tool] workspace-metrics-scanner`: Scans repository file counts and LOC'),
        'Tool summary should be rendered in catalog'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('2. formatToolsCatalogMarkdown displays all registered micro-tools', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      const toolNames = [
        'agy-config-auditor',
        'deliverable-inspector',
        'evo-release-preflight',
        'git-hotspot-analyzer',
        'workspace-metrics-scanner',
        'custom-test-tool',
      ];

      for (const name of toolNames) {
        storage.saveTool(
          {
            id: name,
            title: name,
            l0_summary: `Description for ${name}`,
            runtime: 'node',
            entry_script: 'run.mjs',
            input_schema: { type: 'object', properties: {} },
            self_test_args: {},
            timeout_ms: 3000,
            origin: 'bootstrap',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          'console.log("tool");'
        );
      }

      const catalog = formatToolsCatalogMarkdown(storage);
      for (const name of toolNames) {
        assert.ok(
          catalog.includes(`\`[tool] ${name}\`: Description for ${name}`),
          `Expected tool '${name}' to appear in Section 5 catalog`
        );
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('3. formatToolsCatalogMarkdown enforces MAX_WORKFLOW_TOKENS (130) sub-cap and dynamic budget cap <= 350 tokens under heavy load', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Register 15 tools with lengthy descriptions
      for (let i = 1; i <= 15; i++) {
        storage.saveTool(
          {
            id: `heavy-tool-${i}`,
            title: `heavy-tool-${i}`,
            l0_summary: `Comprehensive diagnostic utility for subsystem ${i} performing deep telemetry and state audits`,
            runtime: 'node',
            entry_script: 'run.mjs',
            input_schema: { type: 'object', properties: {} },
            self_test_args: {},
            timeout_ms: 3000,
            origin: 'bootstrap',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          'console.log("heavy");'
        );
      }

      // Register 20 skills with verbose trigger cues
      for (let i = 1; i <= 20; i++) {
        storage.saveSkill({
          id: `verbose-cued-skill-${i}`,
          name: `verbose-cued-skill-${i}`,
          title: `Verbose Workflow SOP ${i}`,
          description: `Detailed operating procedure for complex distributed transaction ${i}`,
          l0_summary: `Detailed operating procedure for complex distributed transaction ${i}`,
          trigger_cue: `When validating distributed consensus protocol for high-throughput cluster node partition ${i}`,
          l1_contract: `Contract ${i}`,
          l2_sop: `SOP ${i}`,
          origin: 'bootstrap',
          tags: ['test'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      const catalog = formatToolsCatalogMarkdown(storage);
      const totalTokens = estimateTokens(catalog);

      assert.ok(
        totalTokens <= MAX_TOOLS_CATALOG_TOKENS,
        `Expected total catalog tokens (${totalTokens}) to be <= MAX_TOOLS_CATALOG_TOKENS (${MAX_TOOLS_CATALOG_TOKENS})`
      );

      assert.ok(catalog.includes('[tool] heavy-tool-1'));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // GROUP 2: PRE-TOOL & POST-TOOL DECLARATIVE HOOK TRIGGERS & WIRING
  // =========================================================================

  test('4. handlePreTool emits pure single-line JSON { decision: "block", reason } when script blocks', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      const blockScriptCode = [
        'const args = JSON.parse(process.argv[2] || "{}");',
        'if (args.tool_name === "Bash" || args.tool_name === "run_command") {',
        '  process.stdout.write(JSON.stringify({ decision: "block", reason: "Forbidden destructive command" }));',
        '  process.exit(0);',
        '}',
        'process.exit(0);',
      ].join('\n');

      storage.saveTool(
        {
          id: 'block-guard',
          title: 'block-guard',
          l0_summary: 'Guard tool that blocks Bash executions',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          hook_trigger: {
            event: 'pre-tool',
            tools: ['Bash', 'run_command'],
            block_on_failure: true,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        blockScriptCode
      );

      const res = handlePreTool(
        ws,
        {
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf /' },
        },
        {}
      );

      assert.equal(res.blocked, true, 'Tool should be marked as blocked');
      assert.equal(res.exitCode, 0, 'Exit code should be 0 for Claude/Codex block output');

      // Ensure output is pure valid JSON without preamble
      const parsed = JSON.parse(res.output);
      assert.equal(parsed.decision, 'block');
      assert.equal(parsed.reason, 'Forbidden destructive command');

      // Also verify when tool exits non-zero, block_on_failure converts it to block JSON
      storage.saveTool(
        {
          id: 'block-guard',
          title: 'block-guard',
          l0_summary: 'Guard tool that fails',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          hook_trigger: {
            event: 'pre-tool',
            tools: ['Bash', 'run_command'],
            block_on_failure: true,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.error("Critical safety gate failure"); process.exit(1);'
      );

      const failRes = handlePreTool(
        ws,
        {
          tool_name: 'Bash',
          tool_input: { command: 'drop database' },
        },
        {}
      );

      assert.equal(failRes.blocked, true);
      const parsedFail = JSON.parse(failRes.output);
      assert.equal(parsedFail.decision, 'block');
      assert.ok(parsedFail.reason.includes('Critical safety gate failure'));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('5. handlePreTool skips execution on evo_* internal tools (anti-recursion guard)', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Register a wildcard blocker that would block EVERYTHING if invoked
      storage.saveTool(
        {
          id: 'wildcard-blocker',
          title: 'wildcard-blocker',
          l0_summary: 'Blocks all tools',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          hook_trigger: {
            event: 'pre-tool',
            tools: ['*'],
            block_on_failure: true,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'process.stdout.write(JSON.stringify({ decision: "block", reason: "Blocked" })); process.exit(0);'
      );

      // evo_run call
      const resEvoRun = handlePreTool(ws, { tool_name: 'evo_run', tool_input: {} }, {});
      assert.equal(resEvoRun.blocked, undefined, 'evo_run must bypass pre-tool hook');

      // call_mcp_tool evo_inspect call
      const resMcpInspect = handlePreTool(
        ws,
        {
          tool_name: 'call_mcp_tool',
          tool_input: { ToolName: 'evo_inspect', ServerName: 'evo-kernel' },
        },
        {}
      );
      assert.equal(resMcpInspect.blocked, undefined, 'evo_inspect inside MCP dispatcher must bypass pre-tool hook');

      // Internal .evo metadata path call
      const resInternal = handlePreTool(
        ws,
        {
          tool_name: 'write_to_file',
          tool_input: { TargetFile: path.join(ws, '.evo', 'rules', 'test.md') },
        },
        {}
      );
      assert.equal(resInternal.blocked, undefined, 'Internal .evo writes must bypass pre-tool hook');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('6. handlePostTool executes post-tool hooks matching error_signature and tool names without file_glob', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      storage.saveTool(
        {
          id: 'syntax-recovery-tool',
          title: 'syntax-recovery-tool',
          l0_summary: 'Recovers from SyntaxError',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          hook_trigger: {
            event: 'post-tool',
            tools: ['Bash', 'run_command'],
            error_signature: 'SyntaxError|FATAL_COMPILE',
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.log("[Recovery] Attempting syntax repair"); process.exit(0);'
      );

      // 1. Tool execution with SyntaxError in response -> hook triggers
      const res1 = handlePostTool(
        ws,
        {
          tool_name: 'Bash',
          response: 'SyntaxError: Unexpected token "{" in line 14',
          exit_code: 1,
        },
        {}
      );
      assert.ok(
        res1.triggeredHooks?.includes('syntax-recovery-tool'),
        'Expected hook to trigger on matching SyntaxError signature'
      );

      // 2. Tool execution with successful test run -> hook does NOT trigger
      const res2 = handlePostTool(
        ws,
        {
          tool_name: 'Bash',
          response: 'All 42 tests passed without error',
          exit_code: 0,
        },
        {}
      );
      assert.ok(
        !res2.triggeredHooks?.includes('syntax-recovery-tool'),
        'Hook should NOT trigger on successful output'
      );

      // 3. Tool execution with non-matching error -> hook does NOT trigger
      const res3 = handlePostTool(
        ws,
        {
          tool_name: 'Bash',
          response: 'FileNotFoundError: config.json does not exist',
          exit_code: 1,
        },
        {}
      );
      assert.ok(
        !res3.triggeredHooks?.includes('syntax-recovery-tool'),
        'Hook should NOT trigger on non-matching error signature'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('7. syncDeclaredPreToolHooks wires and unwires Claude Code and Codex hook surfaces', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Create .claude and .codex mock directories
      const claudeDir = path.join(ws, '.claude');
      const codexDir = path.join(ws, '.codex');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.mkdirSync(codexDir, { recursive: true });

      const claudeSettingsFile = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(claudeSettingsFile, JSON.stringify({ theme: 'dark' }, null, 2), 'utf8');

      // 1. Initially no pre-tool tools -> syncDeclaredPreToolHooks does nothing
      syncDeclaredPreToolHooks(ws);
      let claudeParsed = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
      assert.equal(claudeParsed.hooks, undefined);
      assert.equal(fs.existsSync(path.join(codexDir, 'hooks.json')), false);

      // 2. Add a tool declaring pre-tool hook trigger
      storage.saveTool(
        {
          id: 'pre-tool-guard',
          title: 'pre-tool-guard',
          l0_summary: 'Guard tool',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          hook_trigger: {
            event: 'pre-tool',
            tools: ['Bash', 'run_command'],
            block_on_failure: true,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.log("guard");'
      );

      syncDeclaredPreToolHooks(ws);

      // Verify Claude settings.json
      claudeParsed = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
      assert.ok(claudeParsed.hooks?.PreToolUse, 'Claude settings should have PreToolUse array');
      const claudeHookEntry = claudeParsed.hooks.PreToolUse[0];
      assert.equal(claudeHookEntry.matcher, 'Bash|run_command');
      assert.ok(claudeHookEntry.hooks[0].command.includes('hook pre-tool'));

      // Verify Codex hooks.json
      const codexHooksFile = path.join(codexDir, 'hooks.json');
      assert.ok(fs.existsSync(codexHooksFile), 'Codex hooks.json must be created');
      const codexParsed = JSON.parse(fs.readFileSync(codexHooksFile, 'utf8'));
      assert.ok(codexParsed.hooks?.PreToolUse, 'Codex hooks should have PreToolUse array');
      assert.equal(codexParsed.hooks.PreToolUse[0].matcher, 'Bash|run_command');

      // 3. Remove pre-tool trigger from tool -> syncDeclaredPreToolHooks unwires
      storage.saveTool(
        {
          id: 'pre-tool-guard',
          title: 'pre-tool-guard',
          l0_summary: 'Guard tool without hook',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.log("unwired");'
      );

      syncDeclaredPreToolHooks(ws);

      claudeParsed = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
      assert.equal(claudeParsed.hooks, undefined, 'Claude hooks should be pruned cleanly');

      // When hooks became empty, .codex/hooks.json was cleanly deleted
      assert.equal(fs.existsSync(codexHooksFile), false, 'Codex hooks.json should be removed when hooks become empty');

      // 4. Codex clean uninstall removes .codex/hooks.json if present
      fs.writeFileSync(codexHooksFile, JSON.stringify({ hooks: { PreToolUse: [] } }));
      const codexAdapter = new CodexAdapter();
      codexAdapter.uninstall(ws);
      assert.equal(fs.existsSync(codexHooksFile), false, '.codex/hooks.json must be removed on Codex uninstall');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // GROUP 3: SESSION OUTCOME ATTRIBUTION LIFECYCLE & CONTESTED DEMOTION
  // =========================================================================

  test('8. Attribution lifecycle: had_command_error, mark-recovery, user correction, pre-commit, and stop note', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Create a test rule
      const rule: EvoRule = {
        id: 'test-ts-imports',
        title: 'Explicit TS Imports',
        l0_summary: 'Always use .js in relative imports',
        scope_glob: 'src/**/*.ts',
        core: false,
        priority: 70,
        content: 'Use .js extension in relative ESM imports.',
        tokens: 30,
        origin: 'bootstrap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveRule(rule);

      const initTel = new EvoTelemetry(storage);
      initTel.syncFromDisk();
      initTel.close();

      // Recall rule via post-tool
      handlePostTool(ws, { tool_name: 'view_file', path: 'src/core/utils.ts' }, {});

      // Simulate command error with is_error: true
      handlePostTool(
        ws,
        {
          tool_name: 'run_command',
          response: 'Error: Cannot find module ./utils without .js extension',
          is_error: true,
          exit_code: 1,
        },
        {}
      );

      const telemetry = new EvoTelemetry(storage);
      try {
        assert.equal(
          telemetry.getSessionFlag('had_command_error'),
          'true',
          'had_command_error session flag should be set'
        );
      } finally {
        telemetry.close();
      }

      // Mark recovery
      const markRes = runHook(ws, { event: 'mark-recovery' });
      assert.equal(markRes.success, true);
      assert.equal(markRes.event, 'mark-recovery');

      // User correction signal
      handlePostTool(
        ws,
        {
          user_message: '不对，你的推导有漏洞，缺少了边界判断',
        },
        {}
      );

      // Stop hook reminder verification
      const stopRes = handleStop(ws, {}, {});
      assert.ok(
        stopRes.output.includes('Anti-Confounding Gate'),
        'Stop reminder must include Anti-Confounding Gate reminder note'
      );

      // Telemetry verification
      const tel2 = new EvoTelemetry(storage);
      try {
        const telMap = tel2.getTelemetryMap();
        const rec = telMap.get('test-ts-imports');
        assert.ok(rec, 'Telemetry record should exist for recalled rule');
        assert.ok(
          rec.contested_count >= 1,
          `Expected contested_count >= 1 due to user correction (actual: ${rec.contested_count})`
        );
      } finally {
        tel2.close();
      }

      // Pre-commit failure attributes hurt
      // Create over-budget file to make pre-commit fail
      const bigContent = 'x'.repeat(12000);
      fs.writeFileSync(path.join(storage.rulesDir, 'scoped', 'huge-rule.md'), `---\nid: huge-rule\nl0_summary: huge\n---\n${bigContent}`);
      const preCommitFail = handlePreCommit(ws, {}, {});
      assert.equal(preCommitFail.exitCode, 1, 'Pre-commit should fail when rules exceed budget');

      const tel3 = new EvoTelemetry(storage);
      try {
        const rec = tel3.getTelemetryMap().get('test-ts-imports');
        assert.ok(rec!.hurt_count >= 1, 'Pre-commit failure should record hurt outcome on recalled rules');
      } finally {
        tel3.close();
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('9. runRefactor({ apply: true }) demotes contested core rules to scoped and rebuilds core digest', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Create a stable core rule to ensure core-invariants.md remains populated
      storage.saveRule({
        id: 'stable-core-rule',
        title: 'Stable Core Rule',
        l0_summary: 'Rule that remains core',
        scope_glob: '**/*.ts',
        core: true,
        priority: 100,
        content: 'Stable invariant constraint.',
        tokens: 30,
        origin: 'bootstrap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create a contested core rule
      const contestedRule: EvoRule = {
        id: 'contested-core-invariant',
        title: 'Contested Core Invariant',
        l0_summary: 'Fragile rule that frequently causes issues',
        scope_glob: '**/*.ts',
        core: true,
        priority: 90,
        content: 'Fragile constraint that was repeatedly contested.',
        tokens: 45,
        origin: 'bootstrap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveRule(contestedRule);

      // Record contested outcomes in telemetry: total >= 2, hurt+contested > helped
      const telemetry = new EvoTelemetry(storage);
      try {
        telemetry.syncFromDisk();
        telemetry.recordCapabilityOutcome('contested-core-invariant', 'contested');
        telemetry.recordCapabilityOutcome('contested-core-invariant', 'hurt');
        telemetry.recordCapabilityOutcome('contested-core-invariant', 'helped');
      } finally {
        telemetry.close();
      }

      // 1. Audit detects contested capability
      const audit = runAudit(ws);
      assert.ok(
        audit.contestedCapabilities.some((c) => c.id === 'contested-core-invariant'),
        'runAudit must detect contested capability'
      );

      // 2. Refactor preview displays demotion in Stage 3
      const refactorPreview = runRefactor(ws, { apply: false });
      const stage3 = refactorPreview.stages.find((s) => s.stage === 3);
      assert.ok(stage3, 'Stage 3 must exist');
      assert.ok(
        stage3.actions.some((a) => a.includes("Demote contested core rule 'contested-core-invariant'")),
        'Stage 3 actions must include demotion plan for contested core rule'
      );

      // 3. Apply refactor
      const refactorResult = runRefactor(ws, { apply: true });
      assert.ok(
        refactorResult.appliedChanges.some((c) =>
          c.includes("Demoted contested core rule 'contested-core-invariant' to scoped (core: false)")
        ),
        'appliedChanges must include demotion action'
      );

      // 4. Verify filesystem and storage state
      const coreFile = path.join(storage.rulesDir, 'contested-core-invariant.md');
      const scopedFile = path.join(storage.rulesDir, 'scoped', 'contested-core-invariant.md');

      assert.equal(fs.existsSync(coreFile), false, 'Core rule file should be removed from root rulesDir');
      assert.equal(fs.existsSync(scopedFile), true, 'Rule file should be moved to scopedDir');

      const reloadedRule = storage.getRule('contested-core-invariant');
      assert.ok(reloadedRule);
      assert.equal(reloadedRule.core, false, 'Rule core property should now be false');

      // Verify core-invariants digest was rebuilt without the demoted rule, but retaining stable rule
      const digest = fs.readFileSync(storage.coreInvariantsPath, 'utf8');
      assert.ok(
        !digest.includes('[contested-core-invariant]'),
        'rebuilt core-invariants.md digest must not contain demoted rule'
      );
      assert.ok(
        digest.includes('[stable-core-rule]'),
        'rebuilt core-invariants.md digest must retain stable core rule'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // GROUP 4: MULTI-HARNESS SURFACE AUDIT & BROKEN CAPABILITY REFS
  // =========================================================================

  test('10. auditHarnessSurfaces flags Codex 32KB AGENTS.md truncation hazard', () => {
    const ws = createTempWorkspace();
    try {
      const agentsPath = path.join(ws, 'AGENTS.md');

      // Over 32KB
      fs.writeFileSync(agentsPath, 'A'.repeat(33000), 'utf8');
      let violations = auditHarnessSurfaces(ws);
      assert.ok(
        violations.some(
          (v) => v.code === 'CODEX_AGENTS_32KB_TRUNCATION' && v.severity === 'error' && v.harness === 'codex'
        ),
        'Expected CODEX_AGENTS_32KB_TRUNCATION error when AGENTS.md > 32KB'
      );

      // Under 32KB
      fs.writeFileSync(agentsPath, 'A'.repeat(1000), 'utf8');
      violations = auditHarnessSurfaces(ws);
      assert.ok(
        !violations.some((v) => v.code === 'CODEX_AGENTS_32KB_TRUNCATION'),
        'Should not flag truncation hazard when AGENTS.md <= 32KB'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('11. auditHarnessSurfaces allows optional name in Codex skills, but rejects name mismatch', () => {
    const ws = createTempWorkspace();
    try {
      const codexSkillDir = path.join(ws, '.agents', 'skills', 'deploy-sop');
      fs.mkdirSync(codexSkillDir, { recursive: true });
      const skillFile = path.join(codexSkillDir, 'SKILL.md');

      // 1. Codex skill with description and NO name frontmatter -> VALID (Codex allows optional name)
      fs.writeFileSync(
        skillFile,
        '---\ndescription: "Deploy service to cluster"\n---\n## Instructions\nDeploy cleanly.\n',
        'utf8'
      );
      let violations = auditHarnessSurfaces(ws);
      assert.ok(
        !violations.some((v) => v.harness === 'codex'),
        'Codex skill without name frontmatter should be accepted'
      );

      // 2. Codex skill with name mismatch -> ERROR
      fs.writeFileSync(
        skillFile,
        '---\nname: "wrong-name"\ndescription: "Deploy service to cluster"\n---\n## Instructions\nDeploy.\n',
        'utf8'
      );
      violations = auditHarnessSurfaces(ws);
      assert.ok(
        violations.some((v) => v.code === 'CODEX_SKILL_NAME_MISMATCH' && v.severity === 'error'),
        'Codex skill name mismatch must be flagged with CODEX_SKILL_NAME_MISMATCH error'
      );

      // 3. Codex skill missing description -> ERROR
      fs.writeFileSync(
        skillFile,
        '---\nname: "deploy-sop"\n---\n## Instructions\nDeploy.\n',
        'utf8'
      );
      violations = auditHarnessSurfaces(ws);
      assert.ok(
        violations.some((v) => v.code === 'SKILL_MISSING_DESCRIPTION' && v.severity === 'error'),
        'Codex skill missing description must be flagged with SKILL_MISSING_DESCRIPTION error'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('12. auditHarnessSurfaces validates .codex/hooks.json schema', () => {
    const ws = createTempWorkspace();
    try {
      const codexDir = path.join(ws, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      const hooksFile = path.join(codexDir, 'hooks.json');

      // 1. Non-PascalCase event
      fs.writeFileSync(
        hooksFile,
        JSON.stringify({
          hooks: {
            'pre-tool': [
              {
                hooks: [{ type: 'command', command: 'node test.js' }],
              },
            ],
          },
        }),
        'utf8'
      );
      let violations = auditHarnessSurfaces(ws);
      assert.ok(
        violations.some((v) => v.code === 'CODEX_HOOKS_SCHEMA_INVALID' && v.severity === 'error'),
        'Non-PascalCase event should fail schema validation'
      );

      // 2. Malformed hook object missing command
      fs.writeFileSync(
        hooksFile,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                hooks: [{ type: 'command' }],
              },
            ],
          },
        }),
        'utf8'
      );
      violations = auditHarnessSurfaces(ws);
      assert.ok(
        violations.some((v) => v.code === 'CODEX_HOOKS_SCHEMA_INVALID' && v.severity === 'error'),
        'Hook entry missing command should fail schema validation'
      );

      // 3. Valid schema
      fs.writeFileSync(
        hooksFile,
        JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: '*',
                  hooks: [{ type: 'command', command: 'node ./dist/cli/index.js hook pre-tool' }],
                },
              ],
              Stop: [
                {
                  hooks: [{ type: 'command', command: 'node ./dist/cli/index.js hook stop' }],
                },
              ],
            },
          },
          null,
          2
        ),
        'utf8'
      );
      violations = auditHarnessSurfaces(ws);
      assert.ok(
        !violations.some((v) => v.code === 'CODEX_HOOKS_SCHEMA_INVALID'),
        'Valid schema should produce zero schema violations'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('13. auditHarnessSurfaces detects host SKILL_FRONTMATTER_SILENT_DROP and runRefactor auto-backfills', () => {
    const ws = createTempWorkspace();
    try {
      const hostSkillDir = path.join(ws, 'skills', 'pr-review');
      fs.mkdirSync(hostSkillDir, { recursive: true });
      const skillFile = path.join(hostSkillDir, 'SKILL.md');

      // Host skill missing frontmatter entirely
      fs.writeFileSync(
        skillFile,
        '# PR Review Instructions\nReview pull requests with care.\n',
        'utf8'
      );

      // 1. Audit detects silent-drop hazard
      let violations = auditHarnessSurfaces(ws);
      assert.ok(
        violations.some(
          (v) => v.code === 'SKILL_FRONTMATTER_SILENT_DROP' && v.severity === 'error' && v.harness === 'root'
        ),
        'Host skill missing name and description must be flagged with SKILL_FRONTMATTER_SILENT_DROP error'
      );

      // Healthy must be false
      const initialAudit = runAudit(ws);
      assert.equal(initialAudit.healthy, false, 'Audit must not be healthy when silent-drop hazard exists');

      // 2. runRefactor auto-backfills name and description
      const refactorRes = runRefactor(ws, { apply: true });
      assert.ok(
        refactorRes.appliedChanges.some((c) => c.includes('Auto-backfilled skill frontmatter on skills/pr-review/SKILL.md')),
        'appliedChanges must include backfilled frontmatter'
      );

      // Verify file content has valid frontmatter
      const backfilledContent = fs.readFileSync(skillFile, 'utf8');
      assert.ok(backfilledContent.includes('name: "pr-review"'));
      assert.ok(backfilledContent.includes('description: '));

      // 3. Re-audit is clean
      violations = auditHarnessSurfaces(ws);
      assert.ok(
        !violations.some((v) => v.code === 'SKILL_FRONTMATTER_SILENT_DROP'),
        'Silent-drop violation must be resolved after refactor --apply'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('14. Jinja template unescaped brace check flags .j2 templates but ignores ${{ github.sha }} and {{ instruction }} in AGENTS.md', () => {
    const ws = createTempWorkspace();
    try {
      // 1. Jinja file with unescaped brace
      const tmplDir = path.join(ws, 'templates');
      fs.mkdirSync(tmplDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmplDir, 'render.j2'),
        'Hello {{ user_name }}, welcome!\n',
        'utf8'
      );

      let violations = auditHarnessSurfaces(ws);
      assert.ok(
        violations.some((v) => v.code === 'JINJA_UNESCAPED_BRACE' && v.severity === 'error'),
        '.j2 template with unescaped {{ user_name }} must be flagged'
      );

      // Fix Jinja file
      fs.unlinkSync(path.join(tmplDir, 'render.j2'));

      // 2. AGENTS.md containing GitHub Actions syntax and trailing instruction
      const agentsPath = path.join(ws, 'AGENTS.md');
      fs.writeFileSync(
        agentsPath,
        [
          '# Agent Rules',
          '',
          'Run action with commit ${{ github.sha }} and actor ${{ github.actor }}.',
          '',
          '{{ instruction }}',
        ].join('\n'),
        'utf8'
      );

      violations = auditHarnessSurfaces(ws);
      assert.ok(
        !violations.some((v) => v.code === 'JINJA_UNESCAPED_BRACE'),
        'AGENTS.md with ${{ github.sha }} and {{ instruction }} must NOT produce false positives'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('15. runAudit detects broken capability references and reflects in healthy flag', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Rule referencing non-existent rule and non-existent skill
      const ruleWithBrokenRef: EvoRule = {
        id: 'rule-with-phantom-refs',
        title: 'Rule With Phantom Refs',
        l0_summary: 'References missing capabilities',
        scope_glob: '**/*.ts',
        core: false,
        priority: 50,
        content: [
          'Follow the procedure defined in .evo/rules/phantom-rule-xyz.md and inspect via evo_inspect("phantom-skill-abc", "L2").',
          'Also run evo_run("another-missing-tool", {}).',
        ].join('\n'),
        tokens: 35,
        origin: 'bootstrap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveRule(ruleWithBrokenRef);

      const audit = runAudit(ws);
      assert.ok(audit.brokenCapabilityRefs.length > 0, 'Broken capability references must be detected');

      const broken = audit.brokenCapabilityRefs.find((b) => b.displayPath.includes('rule-with-phantom-refs'));
      assert.ok(broken, 'Should find broken refs in rule-with-phantom-refs');
      assert.ok(broken.missingIds.includes('phantom-rule-xyz'));
      assert.ok(broken.missingIds.includes('phantom-skill-abc'));
      assert.ok(broken.missingIds.includes('another-missing-tool'));

      // Healthy must be false due to broken capability refs
      assert.equal(audit.healthy, false, 'Audit healthy flag must be false when broken capability refs exist');

      // Now create the missing capabilities
      storage.saveRule({
        id: 'phantom-rule-xyz',
        title: 'Phantom Rule XYZ',
        l0_summary: 'Now exists',
        scope_glob: '**/*',
        core: false,
        priority: 50,
        content: 'Content',
        tokens: 10,
        origin: 'bootstrap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      storage.saveSkill({
        id: 'phantom-skill-abc',
        name: 'phantom-skill-abc',
        title: 'Phantom Skill ABC',
        description: 'Now exists',
        l0_summary: 'Now exists',
        l1_contract: 'Contract',
        l2_sop: 'SOP',
        origin: 'bootstrap',
        tags: ['test'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      storage.saveTool(
        {
          id: 'another-missing-tool',
          title: 'another-missing-tool',
          l0_summary: 'Now exists',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.log("ok");'
      );

      // Skill referencing non-existent tool in L2 SOP
      storage.saveSkill({
        id: 'skill-with-phantom-ref',
        name: 'skill-with-phantom-ref',
        title: 'Skill With Phantom Ref',
        description: 'Calls missing tool',
        l0_summary: 'Calls missing tool',
        l1_contract: 'Trigger on audit.',
        l2_sop: '1. Execute evo_run("missing-specialist-tool", {}).',
        origin: 'bootstrap',
        tags: ['test'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Rule referencing its own supersedes_id (should NOT be flagged as missing)
      storage.saveRule({
        id: 'modern-refactored-rule',
        title: 'Modern Refactored Rule',
        l0_summary: 'Supersedes legacy rule',
        scope_glob: '**/*',
        core: false,
        priority: 50,
        supersedes_id: 'legacy-deprecated-rule',
        content: 'This rule explicitly supersedes .evo/rules/legacy-deprecated-rule.md and modernizes invariants.',
        tokens: 20,
        origin: 'bootstrap',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const auditSkillCheck = runAudit(ws);
      const brokenSkill = auditSkillCheck.brokenCapabilityRefs.find((b) =>
        b.displayPath.includes('skill-with-phantom-ref')
      );
      assert.ok(brokenSkill, 'Should find broken refs in skill-with-phantom-ref');
      assert.ok(
        brokenSkill.missingIds.includes('missing-specialist-tool'),
        'Skill missingIds should include missing-specialist-tool'
      );

      // Verify supersedes_id is NOT in brokenCapabilityRefs
      assert.ok(
        !auditSkillCheck.brokenCapabilityRefs.some((b) =>
          b.missingIds.includes('legacy-deprecated-rule')
        ),
        'supersedes_id must not be flagged as a broken capability reference'
      );

      // Create the missing specialist tool
      storage.saveTool(
        {
          id: 'missing-specialist-tool',
          title: 'missing-specialist-tool',
          l0_summary: 'Now exists',
          runtime: 'node',
          entry_script: 'run.mjs',
          input_schema: { type: 'object', properties: {} },
          self_test_args: {},
          timeout_ms: 3000,
          origin: 'bootstrap',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'console.log("ok");'
      );

      const auditAfter = runAudit(ws);
      assert.equal(
        auditAfter.brokenCapabilityRefs.length,
        0,
        'Broken capability refs must be zero after capabilities exist'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('34. refreshMemories updates drifted live AST hashes to VERIFIED while refusing to mask genuinely deleted (MISSING) symbols', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Create a source file in ws
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      const srcFile = path.join(ws, 'src', 'calculator.ts');
      fs.writeFileSync(
        srcFile,
        'export function calculateSum(a: number, b: number): number {\n  return a + b;\n}\n',
        'utf8'
      );

      // 1. Create a memory with a drifted AST hash and stale commit/branch
      const memDrifted: EvoMemory = {
        id: 'drifted-sum-memory',
        title: 'Sum function calculation issue',
        l0_summary: 'Calculation memory with drifted AST hash',
        symptom: 'Incorrect sum',
        root_cause: 'Old implementation had bug',
        solution: 'Updated return a + b',
        target_symbols: ['src/calculator.ts#calculateSum'],
        ast_fingerprints: {
          'src/calculator.ts#calculateSum': {
            symbol: 'src/calculator.ts#calculateSum',
            file_path: 'src/calculator.ts',
            kind: 'function',
            start_line: 1,
            end_line: 3,
            signature: 'export function calculateSum(a: number, b: number): number',
            ast_hash: 'driftedhash0000000',
          },
        },
        created_commit: 'old-stale-sha',
        created_branch: 'old-stale-branch',
        tags: ['math'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveMemory(memDrifted);

      // 2. Create a memory pointing to a genuinely deleted/missing symbol
      const memMissing: EvoMemory = {
        id: 'missing-symbol-memory',
        title: 'Non-existent symbol memory',
        l0_summary: 'Points to deleted symbol',
        symptom: 'Missing symbol symptom',
        root_cause: 'Function was removed',
        solution: 'No-op',
        target_symbols: ['src/calculator.ts#deletedHelperFn'],
        ast_fingerprints: {
          'src/calculator.ts#deletedHelperFn': {
            symbol: 'src/calculator.ts#deletedHelperFn',
            file_path: 'src/calculator.ts',
            kind: 'function',
            start_line: 10,
            end_line: 12,
            signature: 'function deletedHelperFn()',
            ast_hash: 'somehash11111111',
          },
        },
        created_commit: 'old-stale-sha',
        created_branch: 'old-stale-branch',
        tags: ['deleted'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveMemory(memMissing);

      // Verify initial state:
      const reportDrifted = verifyMemoryFreshness(ws, memDrifted, { includeCallers: false });
      assert.notEqual(reportDrifted.overall_status, 'VERIFIED');
      const reportMissing = verifyMemoryFreshness(ws, memMissing, { includeCallers: false });
      assert.equal(reportMissing.checks[0].status, 'MISSING');

      // 3. Execute refreshMemories
      const refreshResult = refreshMemories(ws);

      // Refreshed list should contain drifted-sum-memory
      assert.ok(
        refreshResult.refreshed.includes('drifted-sum-memory'),
        'drifted-sum-memory must be in refreshed list'
      );

      // Skipped missing list should contain missing-symbol-memory
      const skippedItem = refreshResult.skippedMissing.find((s) => s.id === 'missing-symbol-memory');
      assert.ok(skippedItem, 'missing-symbol-memory must be in skippedMissing list');
      assert.ok(
        skippedItem.missingSymbols.includes('src/calculator.ts#deletedHelperFn'),
        'skippedItem must identify missing symbol'
      );
      assert.ok(
        !refreshResult.refreshed.includes('missing-symbol-memory'),
        'missing-symbol-memory must NEVER be in refreshed list'
      );

      // 4. Verify refreshed memory now passes verifyMemoryFreshness as VERIFIED
      const updatedMemDrifted = storage.getMemory('drifted-sum-memory');
      assert.ok(updatedMemDrifted);
      assert.notEqual(
        updatedMemDrifted.ast_fingerprints['src/calculator.ts#calculateSum'].ast_hash,
        'driftedhash0000000'
      );
      const postReport = verifyMemoryFreshness(ws, updatedMemDrifted, { includeCallers: false });
      assert.equal(postReport.overall_status, 'VERIFIED');

      // 5. Verify missing memory was NOT modified or masked
      const untouchedMemMissing = storage.getMemory('missing-symbol-memory');
      assert.ok(untouchedMemMissing);
      assert.equal(untouchedMemMissing.created_commit, 'old-stale-sha');
      assert.equal(
        untouchedMemMissing.ast_fingerprints['src/calculator.ts#deletedHelperFn'].ast_hash,
        'somehash11111111'
      );

      // 6. Second invocation: already refreshed memory should be reported as unchanged
      const secondRefresh = refreshMemories(ws);
      assert.ok(
        secondRefresh.unchanged.includes('drifted-sum-memory'),
        'drifted-sum-memory should now be in unchanged list'
      );
      assert.equal(secondRefresh.refreshed.length, 0);
      assert.ok(
        secondRefresh.skippedMissing.some((s) => s.id === 'missing-symbol-memory'),
        'missing-symbol-memory still skipped'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('35. refreshMemories handles targetIds filter, git commit/branch re-anchoring, symbol relocation, and multi-symbol safety guards', () => {
    const ws = createTempWorkspace();
    try {
      // 1. Initialize real git repository
      spawnSync('git', ['init', '-b', 'main'], { cwd: ws });
      spawnSync('git', ['config', 'user.name', 'EvoTester'], { cwd: ws });
      spawnSync('git', ['config', 'user.email', 'tester@evo.local'], { cwd: ws });

      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      const calcPath = path.join(ws, 'src', 'calculator.ts');
      fs.writeFileSync(
        calcPath,
        'export function addNumbers(a: number, b: number): number {\n  return a + b;\n}\nexport function multiplyNumbers(a: number, b: number): number {\n  return a * b;\n}\n',
        'utf8'
      );
      spawnSync('git', ['add', '.'], { cwd: ws });
      spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: ws });

      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // Memory 1: addNumbers (will be refreshed)
      const mem1: EvoMemory = {
        id: 'mem-add-func',
        title: 'Add Numbers Memory',
        l0_summary: 'Add numbers summary',
        symptom: 'Symptom add',
        root_cause: 'Root cause add',
        solution: 'Solution add',
        target_symbols: ['addNumbers'],
        ast_fingerprints: {},
        created_commit: 'old-commit-sha',
        created_branch: 'old-branch',
        tags: ['math'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveMemory(mem1);

      // Memory 2: multiplyNumbers (will be excluded by targetIds filter)
      const mem2: EvoMemory = {
        id: 'mem-multiply-func',
        title: 'Multiply Numbers Memory',
        l0_summary: 'Multiply numbers summary',
        symptom: 'Symptom multiply',
        root_cause: 'Root cause multiply',
        solution: 'Solution multiply',
        target_symbols: ['multiplyNumbers'],
        ast_fingerprints: {},
        created_commit: 'old-commit-sha',
        created_branch: 'old-branch',
        tags: ['math'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveMemory(mem2);

      // Memory 3: Multi-symbol memory where one symbol relocated to src/math.ts and one deleted
      const mem3: EvoMemory = {
        id: 'mem-multi-guard',
        title: 'Multi symbol guard memory',
        l0_summary: 'Multi symbol guard summary',
        symptom: 'Symptom multi',
        root_cause: 'Root cause multi',
        solution: 'Solution multi',
        target_symbols: ['addNumbers', 'deletedLegacyFn'],
        ast_fingerprints: {},
        created_commit: 'old-commit-sha',
        created_branch: 'old-branch',
        tags: ['guard'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      storage.saveMemory(mem3);

      // Test selective refresh with targetIds = ['mem-add-func']
      const selectiveRes = refreshMemories(ws, ['mem-add-func']);
      assert.deepEqual(selectiveRes.refreshed, ['mem-add-func']);
      assert.equal(selectiveRes.unchanged.length, 0);
      assert.equal(selectiveRes.skippedMissing.length, 0);

      // Verify mem-add-func has live git commit and branch re-anchored
      const refreshedMem1 = storage.getMemory('mem-add-func');
      assert.ok(refreshedMem1);
      assert.notEqual(refreshedMem1.created_commit, 'old-commit-sha');
      assert.ok(refreshedMem1.created_branch === 'main' || refreshedMem1.created_branch === 'master');
      assert.ok(refreshedMem1.ast_fingerprints['addNumbers']);
      assert.equal(refreshedMem1.ast_fingerprints['addNumbers'].file_path, 'src/calculator.ts');

      // Verify mem-multiply-func was untouched because it was excluded by targetIds
      const untouchedMem2 = storage.getMemory('mem-multiply-func');
      assert.ok(untouchedMem2);
      assert.equal(untouchedMem2.created_commit, 'old-commit-sha');

      // Now relocate addNumbers to src/math.ts
      const mathPath = path.join(ws, 'src', 'math.ts');
      fs.writeFileSync(
        mathPath,
        'export function addNumbers(a: number, b: number): number {\n  return a + b;\n}\n',
        'utf8'
      );
      fs.writeFileSync(
        calcPath,
        'export function multiplyNumbers(a: number, b: number): number {\n  return a * b;\n}\n',
        'utf8'
      );
      spawnSync('git', ['add', '.'], { cwd: ws });
      spawnSync('git', ['commit', '-m', 'Relocate addNumbers to math.ts'], { cwd: ws });

      // Refresh all
      const fullRes = refreshMemories(ws);
      assert.ok(fullRes.refreshed.includes('mem-add-func'));
      assert.ok(fullRes.refreshed.includes('mem-multiply-func'));
      assert.ok(fullRes.skippedMissing.some((s) => s.id === 'mem-multi-guard'));

      // Check relocated addNumbers file_path is updated to src/math.ts
      const relocatedMem1 = storage.getMemory('mem-add-func');
      assert.ok(relocatedMem1);
      assert.equal(relocatedMem1.ast_fingerprints['addNumbers'].file_path, 'src/math.ts');
      const verifyRelocated = verifyMemoryFreshness(ws, relocatedMem1, { includeCallers: false });
      assert.equal(verifyRelocated.overall_status, 'VERIFIED');

      // Check mem-multi-guard was NOT overwritten or partially corrupted
      const untouchedMem3 = storage.getMemory('mem-multi-guard');
      assert.ok(untouchedMem3);
      assert.equal(untouchedMem3.created_commit, 'old-commit-sha');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('18. P0 Hardening & Edge Cases: C++ constructor init list, TS arrow return, typed arrow variable, Rust lifetimes, Python decorators, JSONC commas, and telemetry redaction', () => {
    // 1. C++ constructor initializer list with braces
    const cppCode = [
      'MyClass::MyClass(int val) : m_member{val}, m_other(10) {',
      '    doSomething();',
      '}',
    ];
    assert.equal(findBraceBlockEnd(cppCode, 0, '.cpp'), 2);

    // 2. TypeScript function returning an arrow function type with object return type
    const tsArrowRet = [
      'function makeHandler(): () => { id: string } {',
      '    return () => ({ id: "ok" });',
      '}',
    ];
    assert.equal(findBraceBlockEnd(tsArrowRet, 0, '.ts'), 2);

    // 3. TypeScript typed arrow variable with return type annotation
    const tsVarArrow = [
      'const makeObj = (): { id: string } => {',
      '    return { id: "ok" };',
      '};',
    ];
    assert.equal(findBraceBlockEnd(tsVarArrow, 0, '.ts'), 2);

    // 4. TypeScript function with generic default object literal
    const tsGeneric = [
      'function parseGeneric<T = { a: number }>() {',
      '    return 123;',
      '}',
    ];
    assert.equal(findBraceBlockEnd(tsGeneric, 0, '.ts'), 2);

    // 5. Rust lifetimes in signature must not swallow subsequent functions
    const rsCode = [
      "fn parse<'a>(s: &'a str) -> &'a str {",
      '    s',
      '}',
      'fn other_func() {',
      '    println!("hello");',
      '}',
    ];
    assert.equal(findBraceBlockEnd(rsCode, 0, '.rs'), 2);

    // 6. Python decorated function with multi-line signature
    const ws = createTempWorkspace();
    try {
      const pyFilePath = path.join(ws, 'service.py');
      fs.writeFileSync(
        pyFilePath,
        [
          '@dataclass',
          '@decorator(param="val")',
          'def compute_metric(',
          '    alpha: float,',
          '    beta: float = 1.0',
          ') -> float:',
          '    result = alpha * beta',
          '    return result',
        ].join('\n') + '\n',
        'utf8'
      );
      const fp = extractSymbolFingerprint(ws, 'service.py#compute_metric');
      assert.ok(fp);
      assert.equal(fp.start_line, 1);
      assert.equal(fp.end_line, 8);
      assert.equal(fp.signature, 'def compute_metric(');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }

    // 7. parseJsonc must preserve commas inside string literals while stripping trailing commas
    const jsonWithCommaInString = JSON.stringify({
      query: 'SELECT a, b, } FROM table',
      nested: { tag: 'foo, ]' },
    });
    const parsed = parseJsonc(jsonWithCommaInString);
    assert.equal(parsed.query, 'SELECT a, b, } FROM table');
    assert.equal(parsed.nested.tag, 'foo, ]');

    const jsoncWithTrailingCommas = '{\n  "a": 1,\n  "b": [2, 3, ],\n}\n';
    const parsedTrailing = parseJsonc(jsoncWithTrailingCommas);
    assert.equal(parsedTrailing.a, 1);
    assert.deepEqual(parsedTrailing.b, [2, 3]);

    // 8. redactSensitiveDiagnostics must properly redact generic API keys and DB strings without leaking secret in $1
    const secretToRedact = 'supersecretkey1234567890';
    const diag = `Error at api_key: ${secretToRedact}\npwd = topsecretpwd\nConnected to postgres://alice:secret@localhost:5432/db\nRedis cache: redis://authuser:mypassword@cache.internal:6379`;
    const redacted = redactSensitiveDiagnostics(diag);
    assert.ok(!redacted.includes(secretToRedact), 'Secret key must not appear anywhere in redacted output');
    assert.ok(redacted.includes('api_key: [REDACTED_SECRET]'));
    assert.ok(redacted.includes('pwd = [REDACTED_PASSWORD]'));
    assert.ok(redacted.includes('postgres://[REDACTED_USER]:[REDACTED_PW]@[HOST]'));
    assert.ok(redacted.includes('redis://[REDACTED_USER]:[REDACTED_PW]@[HOST]'));
    assert.ok(!redacted.includes('$1'), 'Literal $1 must not appear in redacted output');

    // 9. Generic type literals with semicolons and multiline generic defaults
    const tsGenericWithSemicolons = [
      'function handle<T = { foo: string; bar: number }>() {',
      '    const x = 1;',
      '    return x;',
      '}',
      'function next() {}',
    ];
    assert.equal(findBraceBlockEnd(tsGenericWithSemicolons, 0, '.ts'), 3);

    const tsGenericMultiline = [
      'function handle<',
      '    T = {',
      '        a: number;',
      '    }',
      '>() {',
      '    return 42;',
      '}',
    ];
    assert.equal(findBraceBlockEnd(tsGenericMultiline, 0, '.ts'), 6);

    const tsVarArrowMultiline = [
      'const fn = <',
      '    T = {',
      '        a: number;',
      '    }',
      '>(): void => {',
      '    return;',
      '};',
    ];
    assert.equal(findBraceBlockEnd(tsVarArrowMultiline, 0, '.ts'), 6);
  });
});
