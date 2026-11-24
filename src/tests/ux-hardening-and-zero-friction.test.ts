import { describe, test, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { runInit, runUninstall, runInitGlobal } from '../cli/init.js';
import { runRefactor } from '../cli/audit.js';
import { toAsciiOutput } from '../cli/term.js';
import { readTranscriptTail, isUserCorrectionSignal, handlePreCommit } from '../cli/hook.js';
import { EvoMcpDispatcher } from '../mcp/handlers.js';
import { EvoStorage } from '../core/storage.js';
import { buildExportHtmlContent } from '../cli/ui.js';

const REPO_ROOT: string = path.resolve(process.cwd());
const CLI_ENTRY: string = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');
const AGY_HOOK_SCRIPT: string = path.join(REPO_ROOT, 'scripts', 'antigravity_hook.mjs');

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function makeIsolatedEnv(homeDir: string, globalDir?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  env.EVO_GLOBAL_DIR = globalDir ?? path.join(homeDir, '.evo', 'global');
  env.EVO_PROFILE_ISOLATED = '1';
  env.NO_COLOR = '1';
  return env;
}

function runCli(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('UX Hardening & Zero-Friction Suite (AC-01..AC-13)', () => {
  test('AC-01: evo uninstall --dry-run, .evo/ preservation, mcp-pool auto-restore, global cleanup, and --purge', () => {
    const ws = makeTempDir('evo-ac01-ws-');
    const homeDir = makeTempDir('evo-ac01-home-');
    const env = makeIsolatedEnv(homeDir);

    // Prepare project + fake global MCP target
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    const claudeJsonPath = path.join(homeDir, '.claude.json');
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({ mcpServers: { 'evo-kernel': { command: 'npx', args: ['-y', 'evo-kernel'] } } }, null, 2),
      'utf8'
    );

    runInit(ws, ['claude']);
    // Simulate .evo/mcp-pool.json and .mcp.json so uninstall can restore
    const poolPath = path.join(ws, '.evo', 'mcp-pool.json');
    fs.writeFileSync(
      poolPath,
      JSON.stringify(
        {
          mcpServers: {
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
          },
        },
        null,
        2
      ),
      'utf8'
    );
    fs.writeFileSync(
      path.join(ws, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'evo-kernel': { command: 'node', args: ['dist/mcp/server.js'] } } }, null, 2),
      'utf8'
    );

    // 1. CLI `evo uninstall --dry-run` exits 0 without touching files & never emits `Did you mean '--dry-run'`
    const dryRes = runCli(['uninstall', '--dry-run', '--workspace', ws], ws, env);
    assert.equal(dryRes.status, 0, dryRes.stderr);
    assert.ok(!dryRes.stderr.includes("Did you mean '--dry-run'"), dryRes.stderr);
    assert.ok(!dryRes.stdout.includes("Did you mean '--dry-run'"), dryRes.stdout);
    assert.equal(fs.existsSync(path.join(ws, '.evo')), true, '.evo/ must remain after --dry-run');
    assert.equal(fs.existsSync(path.join(ws, 'CLAUDE.md')), true, 'CLAUDE.md must remain after --dry-run');

    // 2. `runUninstall` preserves `.evo/` by default and auto-restores `.evo/mcp-pool.json`
    const resDefault = runUninstall(ws, { homeDir });
    assert.equal(fs.existsSync(path.join(ws, '.evo')), true, '.evo/ must be preserved by default');
    assert.ok((resDefault.restoredMcpCount ?? 0) >= 1, 'Expected mcp-pool.json to be auto-restored');
    const restoredMcp = JSON.parse(fs.readFileSync(path.join(ws, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    assert.ok(restoredMcp.mcpServers?.github, 'github MCP server must be restored from mcp-pool.json');

    // Global MCP entry still intact without `global: true`
    const claudeBeforeGlobal = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    assert.ok(claudeBeforeGlobal.mcpServers?.['evo-kernel'], 'global MCP entry must remain without global: true');

    // 3. `runUninstall` with `global: true` removes global MCP entries
    runUninstall(ws, { global: true, homeDir });
    const claudeAfterGlobal = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    assert.equal(
      claudeAfterGlobal.mcpServers?.['evo-kernel'],
      undefined,
      'global: true must remove evo-kernel from ~/.claude.json'
    );

    // 4. `runUninstall` with `purge: true` removes `.evo/`
    const resPurge = runUninstall(ws, { purge: true, homeDir });
    assert.equal(fs.existsSync(path.join(ws, '.evo')), false, 'purge: true must delete .evo/');
    assert.ok(Array.isArray(resPurge.purgedPaths) && resPurge.purgedPaths.length > 0);
  });

  test('AC-02: evo refactor --apply defaults to workspace-only, creates backup snapshot, and emits English-only stage headings', () => {
    const ws = makeTempDir('evo-ac02-ws-');
    const homeDir = makeTempDir('evo-ac02-home-');
    const env = makeIsolatedEnv(homeDir);

    runInit(ws, ['claude']);
    // Append a workspace domain-leaking section to ws/CLAUDE.md so refactor --apply creates a backup snapshot
    const wsClaudeMd = path.join(ws, 'CLAUDE.md');
    const existingWsClaude = fs.readFileSync(wsClaudeMd, 'utf8');
    const wsLeakSection =
      '\n\n## CAN Bus Firmware Register Rules\n' +
      Array.from({ length: 60 }, (_, i) => `- Check CAN_REG_${i} before enabling PWM_DRV_${i}.`).join('\n');
    fs.writeFileSync(wsClaudeMd, existingWsClaude + wsLeakSection, 'utf8');

    const globalClaudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(globalClaudeDir, { recursive: true });
    const globalClaudeMd = path.join(globalClaudeDir, 'CLAUDE.md');
    const bloatedGlobalContent =
      '# Global\n' + Array.from({ length: 120 }, (_, i) => `- Always check CAN bus frame ${i} for CRC error.`).join('\n');
    fs.writeFileSync(globalClaudeMd, bloatedGlobalContent, 'utf8');

    const refRes = runRefactor(ws, {
      apply: true,
      globalHomeDir: homeDir,
      includeGlobal: true,
    });

    // Global file must NOT be modified when applyGlobal is not set
    assert.equal(
      fs.readFileSync(globalClaudeMd, 'utf8'),
      bloatedGlobalContent,
      'Global CLAUDE.md must remain untouched without --global'
    );

    // Backup snapshot under .evo/.cache/refactor-backups/
    const backupsDir = path.join(ws, '.evo', '.cache', 'refactor-backups');
    assert.equal(fs.existsSync(backupsDir), true, 'refactor-backups directory must exist after --apply');
    const backupEntries = fs.readdirSync(backupsDir);
    assert.ok(backupEntries.length >= 1, 'Expected at least 1 backup snapshot under .evo/.cache/refactor-backups/');

    // CLI output emits English-only stage headings
    const cliRef = runCli(['refactor', '--workspace', ws], ws, env);
    assert.equal(cliRef.status, 0, cliRef.stderr);
    assert.ok(cliRef.stdout.includes('Stage 1'), 'Expected English Stage 1 heading');
    assert.ok(cliRef.stdout.includes('Stage 2'), 'Expected English Stage 2 heading');
    assert.ok(cliRef.stdout.includes('Stage 3'), 'Expected English Stage 3 heading');
    assert.ok(!/阶段|第一阶段|第二阶段|第三阶段/.test(cliRef.stdout), 'Stage headings must be English-only');
    assert.ok(refRes.appliedChanges.length > 0 && Boolean(refRes.backupDir));
  });

  test('AC-03: evo profile add warns on 0 AI hosts; score/doctor show honest +N tok/turn when afterTokens > beforeTokens', () => {
    const ws = makeTempDir('evo-ac03-ws-');
    const emptyHome = makeTempDir('evo-ac03-home-');
    const env = makeIsolatedEnv(emptyHome);

    // 1. `evo profile add` with 0 AI host dirs warns explicitly instead of claiming '(already up-to-date)'
    const profRes = runCli(['profile', 'add', 'Always give concise bullet points'], ws, env);
    assert.equal(profRes.status, 0, profRes.stderr);
    assert.ok(
      profRes.stdout.includes('0 AI hosts detected'),
      `Expected explicit 0-host warning in isolated empty HOME, got:\n${profRes.stdout}`
    );
    assert.ok(
      !/\(already up-to-date\)/.test(profRes.stdout),
      `Must not print '(already up-to-date)' when 0 external AI hosts exist:\n${profRes.stdout}`
    );

    // 2. Small repo where afterTokens > beforeTokens -> honest `+N tok/turn` instead of `Saved 0%`
    runInit(ws, ['claude']);
    const scoreRes = runCli(['score', '--workspace', ws, '--ascii'], ws, env);
    assert.equal(scoreRes.status, 0, scoreRes.stderr);
    assert.match(scoreRes.stdout, /\+\d[\d,]* tok\/turn/, `Expected honest +N tok/turn in score:\n${scoreRes.stdout}`);
    assert.ok(!scoreRes.stdout.includes('Saved 0%'), 'score must not print Saved 0% when overhead > 0');

    const docRes = runCli(['doctor', '--no-probe', '--workspace', ws, '--ascii'], ws, env);
    assert.match(docRes.stdout, /\+\d[\d,]* tok\/turn/, `Expected honest +N tok/turn in doctor:\n${docRes.stdout}`);
    assert.ok(!docRes.stdout.includes('Saved 0%'), 'doctor must not print Saved 0% when overhead > 0');
  });

  test('AC-04: doctor --strict exits non-zero when unhealthy, --no-probe uses [-], --fix refreshes stale memories & drifted seeds with zero &&', () => {
    const ws = makeTempDir('evo-ac04-ws-');
    const homeDir = makeTempDir('evo-ac04-home-');
    const env = makeIsolatedEnv(homeDir);

    runInit(ws, ['claude']);

    // Create a missing/stripped seed in CLAUDE.md and a stale memory
    const claudeMdPath = path.join(ws, 'CLAUDE.md');
    fs.writeFileSync(
      claudeMdPath,
      '# Manual CLAUDE.md without EvoKernel seed\n',
      'utf8'
    );

    const srcFile = path.join(ws, 'src', 'sample.ts');
    fs.mkdirSync(path.dirname(srcFile), { recursive: true });
    fs.writeFileSync(srcFile, 'export function calcLimit(x: number): number {\n  return x + 1;\n}\n', 'utf8');

    const storage = new EvoStorage(ws);
    storage.saveMemory({
      id: 'stale-sample-mem',
      title: 'Stale sample memory',
      l0_summary: 'Fix calcLimit offset.',
      symptom: 'off by one',
      root_cause: 'wrong offset',
      solution: 'use x + 2',
      target_symbols: ['src/sample.ts#calcLimit'],
      ast_fingerprints: {
        'src/sample.ts#calcLimit': {
          file_path: 'src/sample.ts',
          symbol: 'calcLimit',
          kind: 'function',
          start_line: 1,
          end_line: 3,
          signature: 'export function calcLimit(x: number): number',
          ast_hash: 'deadbeef00000000',
        },
      },
      created_commit: 'HEAD',
      tags: ['test'],
      origin: 'session',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 1. `doctor --no-probe` uses `[-]` icon
    const noProbeRes = runCli(['doctor', '--no-probe', '--workspace', ws, '--ascii'], ws, env);
    assert.ok(noProbeRes.stdout.includes('[-]'), `Expected [-] icon with --no-probe:\n${noProbeRes.stdout}`);
    assert.ok(!noProbeRes.stdout.includes('&&'), `doctor output must not contain '&&':\n${noProbeRes.stdout}`);

    // 2. `doctor --strict` exits non-zero when unhealthy (stale memory / drifted seed)
    const strictRes = runCli(['doctor', '--strict', '--no-probe', '--workspace', ws, '--ascii'], ws, env);
    assert.notEqual(strictRes.status, 0, 'doctor --strict must exit non-zero when unhealthy');
    assert.ok(!strictRes.stdout.includes('&&'), `doctor --strict output must not contain '&&'`);

    // 3. `doctor --fix` refreshes stale memories & syncs drifted seeds with ZERO `&&`
    const fixRes = runCli(['doctor', '--fix', '--no-probe', '--workspace', ws, '--ascii'], ws, env);
    assert.equal(fixRes.status, 0, fixRes.stderr);
    assert.ok(!fixRes.stdout.includes('&&'), `doctor --fix output must not contain '&&':\n${fixRes.stdout}`);
    const updatedClaudeMd = fs.readFileSync(claudeMdPath, 'utf8');
    assert.ok(updatedClaudeMd.includes('<!-- EVO:START -->'), 'doctor --fix must restore missing CLAUDE.md seed');
    const refreshedMem = new EvoStorage(ws).getMemory('stale-sample-mem');
    assert.ok(
      refreshedMem && refreshedMem.ast_fingerprints?.['src/sample.ts#calcLimit']?.ast_hash !== 'deadbeef00000000',
      'doctor --fix must refresh drifted live AST hash'
    );

    // 4. Drifted older-schema L0 seed triggers strict non-zero exit and is repaired by `doctor --fix`
    fs.writeFileSync(
      claudeMdPath,
      '<!-- EVO:START -->\n# Legacy Seed\nCall evo_inspect(id, tier: "L2") here.\n<!-- EVO:END -->\n',
      'utf8'
    );
    const driftedStrict = runCli(['doctor', '--strict', '--no-probe', '--workspace', ws, '--ascii'], ws, env);
    assert.notEqual(driftedStrict.status, 0, 'doctor --strict must fail on drifted older-schema seed');
    const fixDrifted = runCli(['doctor', '--fix', '--no-probe', '--workspace', ws, '--ascii'], ws, env);
    assert.equal(fixDrifted.status, 0, fixDrifted.stderr);
    const postFixStrict = runCli(['doctor', '--strict', '--no-probe', '--workspace', ws, '--ascii'], ws, env);
    assert.equal(postFixStrict.status, 0, `doctor --strict should pass after --fix:\n${postFixStrict.stdout}`);
  });

  test('AC-05: idempotent runInit, positional profile add, toAsciiOutput preserves CJK, profile clean --dry-run says Would clean', () => {
    const ws = makeTempDir('evo-ac05-ws-');
    const homeDir = makeTempDir('evo-ac05-home-');
    const env = makeIsolatedEnv(homeDir);

    // 1. `runInit` twice produces identical harnesses
    runInit(ws, ['claude']);
    const firstClaude = fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8');
    runInit(ws, ['claude']);
    const secondClaude = fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8');
    assert.equal(secondClaude, firstClaude, 'Repeated runInit must produce identical CLAUDE.md');

    // 2. `evo profile add "写周报时先给总结"` accepts positional arg, infers on-demand + category, prints `Undo:`
    const addRes = runCli(['profile', 'add', '写周报时先给总结'], ws, env);
    assert.equal(addRes.status, 0, addRes.stderr);
    assert.match(addRes.stdout, /Undo\s*:/, `Expected 'Undo:' in profile add output:\n${addRes.stdout}`);
    assert.match(addRes.stdout, /Menu:\s*[1-9]\d*\/250 tok/, `Expected on-demand menu allocation:\n${addRes.stdout}`);

    // 3. `toAsciiOutput` preserves CJK text
    const cjkConverted = toAsciiOutput('🔍 检查中文规则：≥ 80%');
    assert.ok(cjkConverted.includes('检查中文规则'), 'toAsciiOutput must preserve CJK characters');
    assert.ok(cjkConverted.includes('[SCAN]'), 'toAsciiOutput must map emoji to ASCII tag');

    // 4. `profile clean --dry-run` says `Would clean`
    runInitGlobal({ homeDir });
    const cleanDryRes = runCli(['profile', 'clean', '--dry-run'], ws, env);
    assert.equal(cleanDryRes.status, 0, cleanDryRes.stderr);
    assert.ok(
      cleanDryRes.stdout.includes('Would clean'),
      `Expected 'Would clean' in profile clean --dry-run:\n${cleanDryRes.stdout}`
    );
  });

  test('AC-06: evo --help shows 4 Core Commands (init, doctor, profile, ui) and omits hook/mcp/stats', () => {
    const ws = makeTempDir('evo-ac06-ws-');
    const homeDir = makeTempDir('evo-ac06-home-');
    const env = makeIsolatedEnv(homeDir);

    const helpRes = runCli(['--help'], ws, env);
    assert.equal(helpRes.status, 0, helpRes.stderr);
    const out = helpRes.stdout;
    assert.ok(out.includes('Core Commands:'), 'evo --help must have Core Commands section');
    for (const cmd of ['init', 'doctor', 'profile', 'ui']) {
      assert.match(out, new RegExp(`\\b${cmd}\\b`), `Core Commands must include ${cmd}`);
    }
    assert.ok(!/^\s+(?:hook|mcp|stats)\b/m.test(out), `evo --help must omit hook/mcp/stats:\n${out}`);
  });

  test('AC-07: antigravity_hook.mjs suppresses subagent & >=10 read-only reads, enforces user-turn cooldown, and keeps reminder <=120 tokens', () => {
    const ws = makeTempDir('evo-ac07-ws-');
    const statePath = path.join(ws, 'agy-state.json');

    const runHook = (transcriptPath: string, convId: string): Record<string, unknown> => {
      const proc = spawnSync(process.execPath, [AGY_HOOK_SCRIPT, 'PreInvocation'], {
        cwd: ws,
        env: { ...process.env, EVO_AGY_HOOK_STATE_PATH: statePath },
        input: JSON.stringify({
          conversationId: convId,
          transcriptPath,
          workspacePaths: [ws],
        }),
        encoding: 'utf8',
      });
      assert.equal(proc.status, 0, proc.stderr);
      return JSON.parse(proc.stdout.trim()) as Record<string, unknown>;
    };

    // 1. Subagent transcript (`sender=` + 0 `USER_INPUT`) -> suppressed `{}`
    const subTranscript = path.join(ws, 'subagent.jsonl');
    fs.writeFileSync(
      subTranscript,
      [
        JSON.stringify({
          step_index: 0,
          type: 'SYSTEM_MESSAGE',
          source: 'SYSTEM',
          content: '[Message] sender=subagent-123 priority=HIGH content=Investigate bug.',
        }),
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          tool_calls: [{ name: '"replace_file_content"', args: { TargetFile: '"a.ts"' } }],
        }),
      ].join('\n') + '\n',
      'utf8'
    );
    assert.deepEqual(runHook(subTranscript, 'sub-conv'), {}, 'Subagent transcript must suppress reminders');

    // 2. >=10 read-only reads -> suppressed `{}`
    const readTranscript = path.join(ws, 'reads.jsonl');
    const readSteps: unknown[] = [
      { step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: 'Inspect the codebase.' },
    ];
    for (let i = 1; i <= 12; i++) {
      readSteps.push({
        step_index: i,
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        tool_calls: [{ name: '"view_file"', args: { AbsolutePath: `"src/f${i}.ts"` } }],
      });
    }
    fs.writeFileSync(readTranscript, readSteps.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
    assert.deepEqual(runHook(readTranscript, 'read-conv'), {}, '>=10 read-only reads must suppress reminders');

    // 3. User-turn cooldown & <=120 tokens reminder
    const corrTranscript = path.join(ws, 'corr.jsonl');
    const corrSteps: unknown[] = [
      { step_index: 0, type: 'PLANNER_RESPONSE', source: 'MODEL', content: 'Initial draft.' },
      { step_index: 1, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '不对，这里漏了边界检查，还是有乱码问题！' },
    ];
    fs.writeFileSync(corrTranscript, corrSteps.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
    const firstOut = runHook(corrTranscript, 'corr-conv') as {
      injectSteps?: Array<{ ephemeralMessage: string }>;
    };
    if (!firstOut.injectSteps || firstOut.injectSteps.length === 0) {
      assert.fail('First correction turn must inject reminder');
    }
    const msg: string = firstOut.injectSteps[0].ephemeralMessage;
    const approxTokens = Math.ceil(msg.length / 3.8);
    assert.ok(approxTokens <= 120, `Reminder must be <= 120 tokens, got ~${approxTokens} (${msg.length} chars)`);

    // Same user turn -> `{}`
    corrSteps.push({
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      tool_calls: [{ name: '"view_file"', args: { AbsolutePath: '"src/a.ts"' } }],
    });
    fs.writeFileSync(corrTranscript, corrSteps.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
    assert.deepEqual(runHook(corrTranscript, 'corr-conv'), {}, 'Same user turn must enforce cooldown');
  });

  test('AC-08: readTranscriptTail extracts only latest role:user turn; tightened isUserCorrectionSignal; handlePreCommit auto-unstages .evo/.cache/', () => {
    const ws = makeTempDir('evo-ac08-ws-');

    // 1. `readTranscriptTail` ignores assistant/tool/EvoKernel text and extracts only latest `role: user` turn
    const transcriptFile = path.join(ws, 'claude-transcript.jsonl');
    fs.writeFileSync(
      transcriptFile,
      [
        JSON.stringify({ role: 'user', content: 'First question about formatting.' }),
        JSON.stringify({
          role: 'assistant',
          content: '[EvoKernel 提醒] 不对，错了，检测到用户纠偏！',
        }),
        JSON.stringify({
          role: 'tool',
          content: 'Command exited with code 1: still broken, formatting error',
        }),
        JSON.stringify({ role: 'user', content: 'Please check the build output.' }),
      ].join('\n') + '\n',
      'utf8'
    );
    const tail = readTranscriptTail(transcriptFile);
    assert.equal(tail.trim(), 'Please check the build output.');

    // 2. Tightened `isUserCorrectionSignal` ignores `formatting`/`tone`/`workflow`/`weekly report`/`actually` in normal prose
    assert.equal(
      isUserCorrectionSignal('Can you explain how the formatting pipeline works in this module?'),
      false
    );
    assert.equal(
      isUserCorrectionSignal('I need to prepare a weekly report about our workflow and tone settings.'),
      false
    );
    assert.equal(
      isUserCorrectionSignal('Actually, this library supports ESM imports out of the box.'),
      false
    );
    assert.equal(isUserCorrectionSignal('不对，你改错了，还是有这个问题'), true);

    // 3. `handlePreCommit` auto-unstages `.evo/.cache/`
    execFileSync('git', ['init'], { cwd: ws, stdio: 'ignore' });
    fs.mkdirSync(path.join(ws, '.evo', '.cache'), { recursive: true });
    fs.writeFileSync(path.join(ws, '.evo', '.cache', 'test-cache.db'), 'dummy', 'utf8');
    execFileSync('git', ['add', '-f', '.evo/.cache/test-cache.db'], { cwd: ws, stdio: 'ignore' });
    const preRes = handlePreCommit(ws, {}, { ascii: true });
    assert.equal(preRes.success, true, preRes.output);
    assert.equal(preRes.exitCode, 0);
    const statusOut = execFileSync('git', ['status', '--porcelain'], { cwd: ws, encoding: 'utf8' });
    assert.ok(!statusOut.includes('A  .evo/.cache/test-cache.db'), `Expected unstaged cache, got:\n${statusOut}`);
    const excludeContent = fs.readFileSync(path.join(ws, '.git', 'info', 'exclude'), 'utf8');
    assert.ok(excludeContent.includes('.evo/.cache/'));
  });

  test('AC-09: evo_propose zero-friction preference, undo, auto_resolve, and single clientRoots default', async () => {
    const ws = makeTempDir('evo-ac09-ws-');
    const homeDir = makeTempDir('evo-ac09-home-');
    const globalDir = path.join(homeDir, '.evo', 'global');
    const prevGlobal = process.env.EVO_GLOBAL_DIR;
    const prevIso = process.env.EVO_PROFILE_ISOLATED;
    process.env.EVO_GLOBAL_DIR = globalDir;
    process.env.EVO_PROFILE_ISOLATED = '1';

    try {
      runInit(ws, ['claude']);
      const dispatcher = new EvoMcpDispatcher(ws);
      dispatcher.setClientRoots([ws]);

      try {
        // 1. `evo_propose({ kind: 'preference', content: '以后回答先给结论' })` succeeds with ONLY `kind` + `content` & returns `human_receipt`
        const prefRes = await dispatcher.handleToolCall('evo_propose', {
          kind: 'preference',
          content: '以后回答先给结论',
        });
        assert.equal(prefRes.isError, undefined, prefRes.content[0]?.text);
        const prefJson = JSON.parse(prefRes.content[0].text) as {
          passed?: boolean;
          gate_reached?: number;
          human_receipt?: string;
        };
        assert.equal(prefJson.passed, true, `Preference proposal must pass Gatekeeper: ${prefRes.content[0].text}`);
        assert.ok(prefJson.human_receipt && prefJson.human_receipt.length > 0, 'Must return human_receipt');

        // 2. `evo_propose({ undo: true })` reverts cleanly
        const undoRes = await dispatcher.handleToolCall('evo_propose', { undo: true });
        assert.equal(undoRes.isError, undefined, undoRes.content[0]?.text);
        const undoJson = JSON.parse(undoRes.content[0].text) as {
          undone?: boolean;
          human_receipt?: string;
        };
        assert.equal(undoJson.undone, true, 'undo: true must revert the last proposal');
        assert.ok(undoJson.human_receipt, 'undo must return human_receipt');

        // 3. `auto_resolve: true` handles duplicate preference cleanly
        const pref1 = await dispatcher.handleToolCall('evo_propose', {
          kind: 'preference',
          content: 'Always use TypeScript strict mode in examples',
        });
        assert.equal(pref1.isError, undefined, pref1.content[0]?.text);
        const prefDup = await dispatcher.handleToolCall('evo_propose', {
          kind: 'preference',
          id: 'strict-ts-examples-v2',
          content: 'Always use TypeScript strict mode in examples',
          auto_resolve: true,
        });
        assert.equal(prefDup.isError, undefined, `auto_resolve: true should resolve duplicate: ${prefDup.content[0]?.text}`);

        // 4. Single `clientRoots` default works when `workspace` is omitted
        const ruleRes = await dispatcher.handleToolCall('evo_propose', {
          kind: 'rule',
          id: 'ac09-client-root-rule',
          title: 'AC09 Client Root Guard Rule',
          l0_summary: 'Always validate input boundaries before parsing buffers.',
          scope_glob: '**/*.ts',
          core: false,
          transfer_scenarios: ['Buffer parsing boundary check', 'Protocol header validation'],
          content: '1. Check buffer byteLength before reading header fields.\n2. Return early on truncated frames.',
        });
        assert.equal(ruleRes.isError, undefined, ruleRes.content[0]?.text);
      } finally {
        dispatcher.close();
      }
    } finally {
      if (prevGlobal === undefined) delete process.env.EVO_GLOBAL_DIR;
      else process.env.EVO_GLOBAL_DIR = prevGlobal;
      if (prevIso === undefined) delete process.env.EVO_PROFILE_ISOLATED;
      else process.env.EVO_PROFILE_ISOLATED = prevIso;
    }
  });

  test('AC-11..AC-13: Static UI export anonymization, read-only banner, JS syntax, i18n parity, and evo ui --export', () => {
    const ws = makeTempDir('evo-ac11-ws-');
    const homeDir = makeTempDir('evo-ac11-home-');
    const env = makeIsolatedEnv(homeDir);

    runInit(ws, ['claude']);

    // 1. `buildExportHtmlContent` with `anon: true` default
    const html = buildExportHtmlContent(ws, { anon: true });
    assert.ok(html.includes('var isExport = true;'), 'Export HTML must set isExport = true');
    assert.ok(
      html.includes('id="export-readonly-banner"') && html.includes('style="display: flex;"'),
      'Must include visible read-only banner'
    );
    assert.ok(
      /id="btn-export-html"[^>]*style="display:none;"/.test(html),
      'Export HTML must hide export button in static snapshot'
    );
    assert.ok(
      html.includes("el('btn-profile-add').style.display = isExport ? 'none'") &&
        html.includes("el('btn-profile-import').style.display = isExport ? 'none'") &&
        html.includes("habitForm.style.display = isExport ? 'none'"),
      'Export HTML must hide mutating controls when isExport is true'
    );
    assert.ok(html.includes('maxCoreRuleTokens'), 'Must include maxCoreRuleTokens');
    assert.ok(!html.includes('midNodes.indexOf(mn) < 3'), 'Must not contain fake midNodes.indexOf(mn) < 3 edges');

    // Verify 0 `editorDirty` overwrite bugs: background refresh defers renderInspector via editorPendingBgUpdate
    assert.ok(
      /if\s*\(\s*inspectorMode\s*===\s*'edit'\s*&&\s*editorDirty\s*\)\s*\{\s*editorPendingBgUpdate\s*=\s*true;/.test(html),
      'Must guard active editorDirty draft with editorPendingBgUpdate instead of overwriting'
    );

    // Verify JS syntax via `new Function`
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      assert.fail('Export HTML must contain <script>');
    }
    assert.doesNotThrow(() => {
      // eslint-disable-next-line no-new-func
      new Function(scriptMatch[1]);
    }, 'Inline <script> in export HTML must pass JS syntax check');

    // Verify `en` === `zh` i18n parity in rendered Workbench HTML
    const i18nStart = html.indexOf('var i18n = {');
    const dictEnd = html.indexOf('function el(id)', i18nStart);
    assert.ok(i18nStart > 0 && dictEnd > i18nStart, 'Must locate var i18n block in rendered Workbench HTML');
    const i18nObj = new Function(`${html.slice(i18nStart, dictEnd)}\nreturn i18n;`)() as {
      en: Record<string, string>;
      zh: Record<string, string>;
    };
    assert.deepEqual(Object.keys(i18nObj.en).sort(), Object.keys(i18nObj.zh).sort(), 'en and zh i18n keys must match 100%');
    const uiSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'cli', 'ui.ts'), 'utf8');
    assert.ok(uiSrc.includes('evo-workbench-'), 'Export filename must use evo-workbench- prefix');

    // 2. `evo ui --export` anonymizes username by default
    const exportPath = path.join(ws, 'exported-workbench.html');
    const uiExportRes = runCli(['ui', '--export', exportPath, '--workspace', ws], ws, env);
    assert.equal(uiExportRes.status, 0, uiExportRes.stderr);
    assert.equal(fs.existsSync(exportPath), true, 'evo ui --export must write HTML file');
    const exportedHtml = fs.readFileSync(exportPath, 'utf8');
    const username = os.userInfo().username;
    if (username && username.length >= 3 && !['root', 'user', 'admin'].includes(username.toLowerCase())) {
      assert.ok(
        !exportedHtml.includes(username),
        `evo ui --export must anonymize OS username (${username}) by default`
      );
    }
  });
});
