import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
import { removeGitInfoExclude, runInit, runUninstall } from '../cli/init.js';
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
});
