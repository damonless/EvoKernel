import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  handlePostTool,
  handlePreCommit,
  handleStop,
  matchesScopeGlob,
  parseHookEvent,
  parseHookPayloadArg,
  runHook,
} from '../cli/hook.js';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { removeGitInfoExclude, runInit, runUninstall, syncManagedRuleBlocks } from '../cli/init.js';
import {
  ALL_HARNESS_ADAPTERS,
  parseHarnessTargets,
  removeCodexToml,
  upsertCodexToml,
} from '../cli/harness.js';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evo-hook-test-'));
}

describe('EvoKernel Universal Hook Router & M2 Hardening Suite', () => {
  let ws: string;

  beforeEach(() => {
    ws = createTempWorkspace();
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();
  });

  afterEach(() => {
    try {
      fs.rmSync(ws, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test('1. matchesScopeGlob accurately matches wildcards, file patterns, and directories', () => {
    assert.equal(matchesScopeGlob('src/cli/index.ts', 'src/**/*.ts'), true);
    assert.equal(matchesScopeGlob('src/core/types.ts', 'src/**/*.ts'), true);
    assert.equal(matchesScopeGlob('package.json', 'src/**/*.ts'), false);
    assert.equal(matchesScopeGlob('README.md', '**/*.md'), true);
    assert.equal(matchesScopeGlob('.evo/tools/analyzer/run.mjs', '.evo/tools/**/*'), true);
    assert.equal(matchesScopeGlob('src/foo.ts', '*'), true);
    assert.equal(matchesScopeGlob('src/foo.ts', '**/*'), true);
  });

  test('2. handlePostTool detects file edits, sets session telemetry, and recalls active scoped rules', () => {
    const storage = new EvoStorage(ws);
    storage.saveRule({
      id: 'guard-ts',
      title: 'TypeScript Guard',
      l0_summary: 'Always use explicit .js imports in TypeScript.',
      scope_glob: 'src/**/*.ts',
      core: false,
      priority: 90,
      tokens: 40,
      origin: 'test',
      content: 'Rule body',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const res = handlePostTool(
      ws,
      {
        tool_name: 'edit_file',
        tool_input: { path: 'src/cli/hook.ts' },
      },
      {}
    );

    assert.equal(res.success, true);
    assert.equal(res.exitCode, 0);
    assert.ok(res.recalledRules?.includes('guard-ts'));
    assert.match(res.output, /TypeScript Guard/);

    const telemetry = new EvoTelemetry(storage);
    assert.equal(telemetry.getSessionFlag('pending_evolution'), 'true');
    assert.equal(telemetry.getSessionFlag('unproposed_edit_count'), '1');
    telemetry.close();
  });

  test('3. handlePostTool detects dirty post-crystallization modifications', () => {
    const storage = new EvoStorage(ws);
    const telemetry = new EvoTelemetry(storage);
    telemetry.setSessionFlag('last_crystallized_id', 'my-tested-rule');
    telemetry.close();

    const res = handlePostTool(
      ws,
      {
        tool_name: 'replace_file_content',
        tool_input: { path: 'src/core/storage.ts' },
      },
      {}
    );

    assert.equal(res.success, true);
    const checkTelem = new EvoTelemetry(storage);
    assert.equal(checkTelem.getSessionFlag('dirty_crystallized_id'), 'my-tested-rule');
    checkTelem.close();
  });

  test('4. handlePostTool evo_propose resets pending evolution and clears dirty flag', () => {
    const storage = new EvoStorage(ws);
    const telemetry = new EvoTelemetry(storage);
    telemetry.setSessionFlag('pending_evolution', 'true');
    telemetry.setSessionFlag('dirty_crystallized_id', 'old-rule');
    telemetry.close();

    const res = handlePostTool(
      ws,
      {
        tool_name: 'evo_propose',
        tool_input: { id: 'new-verified-rule' },
      },
      {}
    );

    assert.equal(res.success, true);
    const checkTelem = new EvoTelemetry(storage);
    assert.equal(checkTelem.getSessionFlag('pending_evolution'), 'false');
    assert.equal(checkTelem.getSessionFlag('last_crystallized_id'), 'new-verified-rule');
    assert.equal(checkTelem.getSessionFlag('dirty_crystallized_id'), '');
    checkTelem.close();
  });

  test('5. handleStop emits crystallization suggestions and anti-poisoning alert', () => {
    const storage = new EvoStorage(ws);
    const telemetry = new EvoTelemetry(storage);
    telemetry.setSessionFlag('pending_evolution', 'true');
    telemetry.setSessionFlag('dirty_crystallized_id', 'stale-rule-id');
    telemetry.close();

    const res = handleStop(ws, {}, {});
    assert.equal(res.success, true);
    assert.equal(res.exitCode, 0);
    assert.equal(res.crystallizationSuggested, true);
    assert.match(res.output, /Anti-Poisoning Alert/);
    assert.match(res.output, /stale-rule-id/);
    assert.match(res.output, /evo_propose/);
  });

  test('6. handlePreCommit blocks commits when rules exceed token budget (>1500 tokens)', () => {
    const storage = new EvoStorage(ws);
    const bloatedBody = 'A'.repeat(8000);
    storage.saveRule({
      id: 'bloated-rule',
      title: 'Bloated Rule',
      l0_summary: 'Oversized rule violating 1500 token cap.',
      scope_glob: '**/*',
      core: false,
      priority: 50,
      tokens: 2200,
      origin: 'test',
      content: bloatedBody,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const res = handlePreCommit(ws, {}, {});
    assert.equal(res.success, false);
    assert.equal(res.exitCode, 1);
    assert.equal(res.auditPassed, false);
    assert.match(res.output, /COMMIT BLOCKED/);
  });

  test('7. runHook CLI flag and payload parsing', () => {
    assert.equal(parseHookEvent(['hook', 'post-tool']), 'post-tool');
    assert.equal(parseHookEvent(['hook', '--event', 'stop']), 'stop');
    assert.equal(parseHookEvent(['hook', '--event=pre-commit']), 'pre-commit');
    assert.equal(parseHookEvent(['hook']), 'stop');

    const parsed = parseHookPayloadArg(['hook', '--payload', '{"tool":"edit_file"}']);
    assert.deepEqual(parsed, { tool: 'edit_file' });

    const parsedFlags = parseHookPayloadArg(['hook', '--tool', 'patch', '--file', 'foo.ts']);
    assert.deepEqual(parsedFlags, { tool_name: 'patch', path: 'foo.ts' });
  });

  test('8. M2 Hardening: Monorepo subfolder uninstall preserves sibling stealth excludes', () => {
    const gitRepo = createTempWorkspace();
    try {
      fs.mkdirSync(path.join(gitRepo, '.git', 'info'), { recursive: true });
      const svc1 = path.join(gitRepo, 'services', 'svc1');
      const svc2 = path.join(gitRepo, 'services', 'svc2');
      fs.mkdirSync(svc1, { recursive: true });
      fs.mkdirSync(svc2, { recursive: true });

      runInit(svc1, { stealth: true, targets: ['claude'] });
      runInit(svc2, { stealth: true, targets: ['cursor'] });

      const excludePath = path.join(gitRepo, '.git', 'info', 'exclude');
      let excludeContent = fs.readFileSync(excludePath, 'utf8');
      assert.match(excludeContent, /\/services\/svc1\/\.evo\//);
      assert.match(excludeContent, /\/services\/svc2\/\.evo\//);

      runUninstall(svc1);

      excludeContent = fs.readFileSync(excludePath, 'utf8');
      assert.equal(excludeContent.includes('/services/svc1/.evo/'), false);
      assert.equal(excludeContent.includes('/services/svc2/.evo/'), true);
      assert.match(excludeContent, /# EvoKernel Stealth Mode/);
    } finally {
      fs.rmSync(gitRepo, { recursive: true, force: true });
    }
  });

  test('9. M2 Hardening: Codex TOML regex handles inline header comments and preserves sibling doc comments', () => {
    const tomlPath = path.join(ws, 'config.toml');
    const initialToml = [
      '[mcp_servers.evo-kernel] # managed by evo-kernel',
      'command = "node"',
      'args = ["old.js"]',
      '',
      '# Postgres Database Server',
      '[mcp_servers.database]',
      'command = "psql"',
      '',
    ].join('\n');
    fs.writeFileSync(tomlPath, initialToml, 'utf8');

    upsertCodexToml(tomlPath, 'node', ['./dist/cli/index.js', 'mcp']);

    const updated = fs.readFileSync(tomlPath, 'utf8');
    assert.match(updated, /args = \["\.\/dist\/cli\/index\.js","mcp"\]/);
    assert.match(updated, /# Postgres Database Server/);
    assert.match(updated, /\[mcp_servers\.database\]/);
    assert.equal((updated.match(/\[mcp_servers\.evo-kernel\]/g) || []).length, 1);

    removeCodexToml(tomlPath);
    const cleaned = fs.readFileSync(tomlPath, 'utf8');
    assert.equal(cleaned.includes('[mcp_servers.evo-kernel]'), false);
    assert.match(cleaned, /# Postgres Database Server/);
    assert.match(cleaned, /\[mcp_servers\.database\]/);
  });

  test('10. M2 Hardening: parseHarnessTargets warns on typos and avoids full allTargets fallback', () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const targetsWithTypo = parseHarnessTargets('claude,invalid_target', ws);
      assert.deepEqual(targetsWithTypo, ['claude']);
      assert.ok(warnings.some((w) => w.includes('invalid_target')));

      const allInvalid = parseHarnessTargets('completely_bogus', ws);
      assert.notDeepEqual(allInvalid.sort(), Object.keys(ALL_HARNESS_ADAPTERS).sort());
      assert.ok(allInvalid.length <= 2);
    } finally {
      console.warn = origWarn;
    }
  });

  test('11. M4 Hardening: getGitFiles preserves whitespace in file paths and filters internal teamwork paths', () => {
    // Initialize git repo in ws
    spawnSync('git', ['init'], { cwd: ws });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ws });
    spawnSync('git', ['config', 'user.name', 'Tester'], { cwd: ws });

    // Initial commit with baseline files
    const compDir = path.join(ws, 'src', 'my component');
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(path.join(compDir, 'App.tsx'), 'export const App = () => null;\n');

    const teamworkDir = path.join(ws, '.agents', 'teamwork');
    fs.mkdirSync(teamworkDir, { recursive: true });
    fs.writeFileSync(path.join(teamworkDir, 'keep.md'), '# Notes\n');

    spawnSync('git', ['add', '.'], { cwd: ws });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: ws });

    // 1. Modify a tracked source file with space in directory and name
    fs.writeFileSync(path.join(compDir, 'App.tsx'), 'export const App = () => 123;\n');

    // 2. Create an internal teamwork file with space
    const taskDir = path.join(teamworkDir, 'task 1');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'note.md'), '# Notes\n');

    // Run handleStop - it inspects getGitFiles(workspaceRoot, false)
    const stopRes = handleStop(ws, {}, {});
    assert.equal(stopRes.success, true);
    assert.equal(stopRes.exitCode, 0);
    // User work was detected on App.tsx, but teamwork internal file should NOT be mentioned
    assert.equal(stopRes.crystallizationSuggested, true);
    assert.match(stopRes.output, /App\.tsx/);
    assert.equal(stopRes.output.includes('task 1'), false);

    // 3. Stage the file with spaces and run handlePreCommit
    spawnSync('git', ['add', 'src/my component/App.tsx'], { cwd: ws });
    const preRes = handlePreCommit(ws, {}, {});
    // Pre-commit should pass without crashing
    assert.equal(preRes.success, true);
    assert.equal(preRes.exitCode, 0);
  });

  test('12. M4 Hardening: syncManagedRuleBlocks handles directory named after rule file without EISDIR crash', () => {
    // Create a directory sharing a candidate rule name
    const dirRule = path.join(ws, 'CLAUDE.md');
    fs.mkdirSync(dirRule, { recursive: true });

    // Create a directory sharing opencode.json
    const dirOpencode = path.join(ws, 'opencode.json');
    fs.mkdirSync(dirOpencode, { recursive: true });

    // Create a legitimate AGENTS.md rule file with marker
    const agentsPath = path.join(ws, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      '# My Project Rules\n\n<!-- EVO:START -->\nold block\n<!-- EVO:END -->\n'
    );

    // Call syncManagedRuleBlocks - should not throw EISDIR
    const updated = syncManagedRuleBlocks(ws);
    assert.ok(updated.includes('AGENTS.md'));
    assert.equal(updated.includes('CLAUDE.md'), false);
    assert.equal(updated.includes('opencode.json'), false);

    // Content of AGENTS.md was updated
    const agentsContent = fs.readFileSync(agentsPath, 'utf8');
    assert.match(agentsContent, /<!-- EVO:START -->/);
    assert.notEqual(agentsContent.includes('old block'), true);
  });

  test('13. Issue #9 [CRITICAL-1]: Read-only tools recall scoped rules without setting pending_evolution or dirty_crystallized_id', () => {
    const storage = new EvoStorage(ws);
    storage.saveRule({
      id: 'scoped-read-guard',
      title: 'Scoped Read Guardrail',
      l0_summary: 'Active scoped rule recalled even on read-only file inspection.',
      scope_glob: 'src/**/*.ts',
      core: false,
      priority: 85,
      tokens: 35,
      origin: 'test',
      content: 'Rule body',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const telemetry = new EvoTelemetry(storage);
    telemetry.setSessionFlag('last_crystallized_id', 'clean-verified-rule');
    telemetry.close();

    // Call handlePostTool with read_file and a target path
    const res = handlePostTool(
      ws,
      {
        tool_name: 'read_file',
        tool_input: { path: 'src/core/storage.ts' },
      },
      {}
    );

    assert.equal(res.success, true);
    assert.ok(res.recalledRules?.includes('scoped-read-guard'));
    assert.match(res.output, /Scoped Read Guardrail/);

    // Verify neither pending_evolution nor dirty_crystallized_id was set
    const checkTelem = new EvoTelemetry(storage);
    assert.notEqual(checkTelem.getSessionFlag('pending_evolution'), 'true');
    assert.notEqual(checkTelem.getSessionFlag('dirty_crystallized_id'), 'clean-verified-rule');
    checkTelem.close();
  });

  test('14. Issue #9 [CRITICAL-2]: CLI hook subprocess reads piped JSON payload from stdin', () => {
    const cliEntry = path.resolve(process.cwd(), 'dist', 'cli', 'index.js');
    const storage = new EvoStorage(ws);
    storage.saveRule({
      id: 'stdin-scoped-rule',
      title: 'Stdin Piped Scoped Rule',
      l0_summary: 'Recalled via piped JSON payload on fd 0.',
      scope_glob: 'src/**/*.ts',
      core: false,
      priority: 90,
      tokens: 30,
      origin: 'test',
      content: 'Rule body',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const stdinPayload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: 'src/mcp/handlers.ts' },
    });

    const proc = spawnSync(
      process.execPath,
      [cliEntry, 'hook', 'post-tool', '--workspace', ws],
      {
        input: stdinPayload,
        encoding: 'utf8',
        timeout: 5000,
      }
    );

    assert.equal(proc.status, 0);
    assert.match(proc.stdout, /Stdin Piped Scoped Rule/);

    const telemetry = new EvoTelemetry(storage);
    assert.equal(telemetry.getSessionFlag('pending_evolution'), 'true');
    telemetry.close();
  });

  test('15. Issue #9 [MEDIUM-12]: getGitFiles strips old -> new rename arrow prefix in git status --porcelain', () => {
    spawnSync('git', ['init'], { cwd: ws });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ws });
    spawnSync('git', ['config', 'user.name', 'Tester'], { cwd: ws });

    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'src', 'old_name.ts'), 'export const x = 1;\n');
    spawnSync('git', ['add', '.'], { cwd: ws });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: ws });

    // Rename file using git mv
    spawnSync('git', ['mv', 'src/old_name.ts', 'src/new_name.ts'], { cwd: ws });

    const stopRes = handleStop(ws, {}, {});
    assert.equal(stopRes.success, true);
    assert.equal(stopRes.crystallizationSuggested, true);
    assert.match(stopRes.output, /src\/new_name\.ts/);
    assert.equal(stopRes.output.includes('->'), false);
  });

  test('16. Issue #11 [AGY-HOOK-1..3]: Antigravity hook preserves pending correction across multi-step PreInvocations until Stop, unquotes double-JSON args, and detects deliverable feedback & scratch script error recovery', () => {
    const hookScript = path.resolve(process.cwd(), 'scripts', 'antigravity_hook.mjs');
    const transcriptFile = path.join(ws, 'transcript.jsonl');
    const convId = `issue11-conv-${Date.now()}`;

    const writeSteps = (steps: unknown[]) => {
      fs.writeFileSync(
        transcriptFile,
        steps.map((s) => JSON.stringify(s)).join('\n') + '\n',
        'utf8'
      );
    };

    const runAgyHook = (event: 'PreInvocation' | 'Stop') => {
      const proc = spawnSync(process.execPath, [hookScript, event], {
        cwd: ws,
        input: JSON.stringify({
          conversationId: convId,
          transcriptPath: transcriptFile,
          workspacePaths: [ws],
        }),
        encoding: 'utf8',
      });
      assert.equal(proc.status, 0);
      return JSON.parse(proc.stdout.trim());
    };

    // 1. User gives deliverable granularity/format feedback ("怎么回事", "稍微精简些", "不要冲突或者重复")
    const baseSteps: unknown[] = [
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        content: 'Initial Excel report generated.',
      },
      {
        step_index: 2,
        type: 'USER_INPUT',
        source: 'USER_EXPLICIT',
        content:
          'excel中的版本显示只有一半怎么回事？软件修改记录里面可以稍微精简些，自测报告中的 6.Test Method 与下面测试项的内容不要冲突或者重复',
      },
    ];
    writeSteps(baseSteps);

    // First PreInvocation (step 2): injects reminder
    const pre1 = runAgyHook('PreInvocation');
    assert.ok(Array.isArray(pre1.injectSteps), 'First PreInvocation should inject reminder');
    assert.match(pre1.injectSteps[0].ephemeralMessage, /检测到用户纠偏\/交付物反馈信号/);

    // 2. Agent writes a scratch script (with double-JSON-quoted Windows path) and runs a failing command then a succeeding command
    baseSteps.push(
      {
        step_index: 3,
        type: 'GENERIC',
        source: 'MODEL',
        tool_calls: [
          {
            name: '"write_to_file"',
            args: {
              TargetFile:
                '"C:\\\\Users\\\\Administrator\\\\.gemini\\\\antigravity\\\\brain\\\\conv123\\\\scratch\\\\update_xlsx.py"',
            },
          },
        ],
      },
      {
        step_index: 4,
        type: 'GENERIC',
        source: 'MODEL',
        tool_calls: [
          {
            name: '"run_command"',
            args: {
              CommandLine: '"python scratch/update_xlsx.py 软体自测报告.xlsx"',
            },
            status: 'ERROR',
            output: 'Traceback (most recent call last):\nValueError: invalid format\nCommand exited with code 1',
          },
        ],
      },
      {
        step_index: 5,
        type: 'GENERIC',
        source: 'MODEL',
        tool_calls: [
          {
            name: '"run_command"',
            args: {
              CommandLine: '"python scratch/update_xlsx.py 软体自测报告.xlsx"',
            },
            status: 'COMPLETED',
            output: 'Successfully updated workbook.\nCommand exited with code 0',
          },
        ],
      }
    );
    writeSteps(baseSteps);

    // Final PreInvocation before responding to user (step 5): MUST STILL inject reminder because Stop has not occurred and evo_propose was not called!
    const preFinal = runAgyHook('PreInvocation');
    assert.ok(
      Array.isArray(preFinal.injectSteps),
      'Final PreInvocation after multi-step tool work must still inject reminder'
    );
    assert.match(preFinal.injectSteps[0].ephemeralMessage, /检测到用户纠偏\/交付物反馈信号/);
    assert.match(preFinal.injectSteps[0].ephemeralMessage, /检测到命令\/脚本执行报错并恢复成功/);
    assert.match(preFinal.injectSteps[0].ephemeralMessage, /已编写 1 个临时分析\/交付物生成脚本尚未结晶/);

    // 3. Stop event clears the correction state for this turn
    const stopOut = runAgyHook('Stop');
    assert.equal(stopOut.decision, 'allow');

    // Next turn step without new correction or new error recovery should not re-trigger the cleared correction
    baseSteps.push({
      step_index: 6,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'Done.',
    });
    writeSteps(baseSteps);
    const afterStop = runAgyHook('PreInvocation');
    assert.deepEqual(afterStop, {});

    // 4. Double-JSON-quoted call_mcp_tool evo_propose resets all counters
    baseSteps.push({
      step_index: 7,
      type: 'GENERIC',
      source: 'MODEL',
      tool_calls: [
        {
          name: '"call_mcp_tool"',
          args: {
            ToolName: '"evo_propose"',
            Arguments: '"{\\"id\\":\\"excel-qa-report-sop\\",\\"kind\\":\\"skill\\"}"',
          },
        },
      ],
    });
    writeSteps(baseSteps);
    const afterPropose = runAgyHook('PreInvocation');
    assert.deepEqual(afterPropose, {});
  });
});

