import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { buildScoreReport, inspectMcpTaxSnapshot, renderScoreSvg } from '../cli/score.js';
import { exportUiHtml, startUiServer, buildUiSnapshot } from '../cli/ui.js';
import { renderUiClientHtml } from '../templates/ui-client.js';
import { runInit, runUninstall } from '../cli/init.js';
import { redactSensitiveDiagnostics } from '../core/telemetry.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `evo-score-ui-${prefix}-`));
}

describe('EvoKernel P1 & P2: Score, UI Cockpit, Slash Commands & Manifest Parity Suite', () => {
  test('1. Zero file/dir creation for evo score, evo ui --export, and evo doctor in uninitialized directories', () => {
    const emptyDir = createTempDir('empty');
    const cliEntry = path.resolve(process.cwd(), 'dist', 'cli', 'index.js');
    const exportFile = path.join(os.tmpdir(), `evo-test-export-${Date.now()}.html`);

    try {
      const initialEntries = fs.readdirSync(emptyDir);
      assert.deepEqual(initialEntries, [], 'Workspace starts empty');

      // 1. evo score
      const scoreProc = spawnSync(process.execPath, [cliEntry, 'score', '--workspace', emptyDir], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(scoreProc.status, 0);
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo score created 0 files/dirs');

      // 2. evo doctor
      const doctorProc = spawnSync(process.execPath, [cliEntry, 'doctor', '--workspace', emptyDir], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(doctorProc.status, 0);
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo doctor created 0 files/dirs');

      // 3. evo ui --export
      const uiProc = spawnSync(
        process.execPath,
        [cliEntry, 'ui', '--export', exportFile, '--workspace', emptyDir],
        { encoding: 'utf8', timeout: 5000 }
      );
      assert.equal(uiProc.status, 0);
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo ui --export created 0 files/dirs in workspace');
      assert.ok(fs.existsSync(exportFile), 'Export file written to specified target');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
      if (fs.existsSync(exportFile)) fs.unlinkSync(exportFile);
    }
  });

  test('2. Subdirectory in uninitialized Git repo resolves to Git root rather than Global Host Audit Mode', () => {
    const gitRepo = createTempDir('git-repo');
    const subDeep = path.join(gitRepo, 'packages', 'app', 'src');
    fs.mkdirSync(subDeep, { recursive: true });
    const cliEntry = path.resolve(process.cwd(), 'dist', 'cli', 'index.js');

    try {
      spawnSync('git', ['init'], { cwd: gitRepo, encoding: 'utf8' });

      const proc = spawnSync(
        process.execPath,
        [cliEntry, 'score', '--json', '--workspace', subDeep],
        { encoding: 'utf8', timeout: 5000 }
      );
      assert.equal(proc.status, 0);
      const report = JSON.parse(proc.stdout.trim());
      assert.equal(path.resolve(report.workspaceRoot), path.resolve(gitRepo));
      assert.equal(report.mode, 'project');
    } finally {
      fs.rmSync(gitRepo, { recursive: true, force: true });
    }
  });

  test('3. Non-project directory Global Host Audit Mode completes in <40ms', () => {
    const nonProj = createTempDir('nonproj');
    try {
      const t0 = performance.now();
      const report = buildScoreReport(nonProj);
      const elapsed = performance.now() - t0;

      assert.equal(report.mode, 'global');
      assert.ok(elapsed < 40, `Global Host Audit took ${elapsed.toFixed(2)}ms, expected < 40ms`);
      assert.ok(report.overallScore >= 0);
    } finally {
      fs.rmSync(nonProj, { recursive: true, force: true });
    }
  });

  test('4. evo ui server 127.0.0.1 binding, Host header 403, Sec-Fetch-Site 403, token auth for /api/snapshot & /api/events', async () => {
    const ws = createTempDir('ui-server');
    const instance = await startUiServer(ws, { port: 0 });

    try {
      assert.ok(instance.url.startsWith(`http://127.0.0.1:${instance.port}/?token=`));

      // 1. Host header spoofing check
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${instance.port}/`,
          { headers: { Host: 'attacker.evil.com' } },
          (res) => {
            assert.equal(res.statusCode, 403);
            resolve();
          }
        );
        req.on('error', reject);
        req.end();
      });

      // 2. Sec-Fetch-Site cross-site block
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${instance.port}/`,
          { headers: { 'Sec-Fetch-Site': 'cross-site' } },
          (res) => {
            assert.equal(res.statusCode, 403);
            resolve();
          }
        );
        req.on('error', reject);
        req.end();
      });

      // 2b. Root GET on live instance URL returns 200 HTML with parseable inline script
      await new Promise<void>((resolve, reject) => {
        http.get(instance.url, (res) => {
          assert.equal(res.statusCode, 200);
          assert.ok(res.headers['content-type']?.includes('text/html'));
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            const match = body.match(/<script>([\s\S]*?)<\/script>/);
            assert.ok(match, 'Live HTML contains inline script');
            assert.doesNotThrow(() => {
              new vm.Script(match[1]);
            }, 'Live inline script must compile without syntax errors');
            resolve();
          });
        }).on('error', reject);
      });

      // 3. /api/snapshot without token -> 401
      await new Promise<void>((resolve, reject) => {
        http.get(`http://127.0.0.1:${instance.port}/api/snapshot`, (res) => {
          assert.equal(res.statusCode, 401);
          resolve();
        }).on('error', reject);
      });

      // 4. /api/snapshot with X-Evo-UI-Token header -> 200
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${instance.port}/api/snapshot`,
          { headers: { 'X-Evo-UI-Token': instance.token } },
          (res) => {
            assert.equal(res.statusCode, 200);
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              const snap = JSON.parse(body);
              assert.ok(snap.score);
              assert.ok(Array.isArray(snap.rules));
              resolve();
            });
          }
        );
        req.on('error', reject);
      });

      // 5. /api/events with token query param -> 200 SSE
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${instance.port}/api/events?token=${instance.token}`,
          (res) => {
            assert.equal(res.statusCode, 200);
            assert.equal(res.headers['content-type'], 'text/event-stream');
            res.destroy();
            resolve();
          }
        );
        req.on('error', reject);
      });
    } finally {
      await instance.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('5. Windows CRLF normalization and matching CSP sha256-... hash in evo ui --export', () => {
    const ws = createTempDir('export-test');
    const outFile = path.join(ws, 'cockpit.html');

    try {
      exportUiHtml(ws, outFile);
      assert.ok(fs.existsSync(outFile));
      const html = fs.readFileSync(outFile, 'utf8');

      // No CRLF in output
      assert.equal(html.includes('\r\n'), false, 'Output HTML has no Windows CRLF');

      // Extract inline script
      const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
      assert.ok(scriptMatch, 'Inline script block found');

      const scriptContent = scriptMatch[1];
      const expectedHash = crypto.createHash('sha256').update(scriptContent, 'utf8').digest('base64');
      assert.ok(
        html.includes(`script-src 'sha256-${expectedHash}'`),
        'CSP meta tag contains exact matching SHA-256 hash of inline script'
      );

      // Deterministically verify the generated inline JS has valid syntax via V8
      assert.doesNotThrow(() => {
        new vm.Script(scriptContent);
      }, 'Inline script must have valid JavaScript syntax');

      // Assert zero inline event attributes (on*=)
      assert.equal(/\bon[a-z]+\s*=/i.test(html), false, 'Exported HTML must contain zero inline event attributes (on*=)');

      // Verify #btn-watch-film and #shotcraft-modal exist in rendered UI HTML
      assert.ok(html.includes('id="btn-watch-film"'), 'Exported HTML must contain #btn-watch-film action button');
      assert.ok(html.includes('id="shotcraft-modal"'), 'Exported HTML must contain #shotcraft-modal Architecture Theater');
      assert.ok(html.includes('id="film-play-toggle"'), 'Exported HTML must contain #film-play-toggle control');
      assert.ok(html.includes('id="film-prev-btn"'), 'Exported HTML must contain #film-prev-btn control');
      assert.ok(html.includes('id="film-next-btn"'), 'Exported HTML must contain #film-next-btn control');
      assert.ok(html.includes('id="film-close-btn"'), 'Exported HTML must contain #film-close-btn control');
      for (let sIdx = 0; sIdx < 5; sIdx++) {
        assert.ok(html.includes(`id="scene-${sIdx}"`), `Exported HTML must contain #scene-${sIdx}`);
      }
      assert.ok(html.includes('id="constellation-card"'), 'Exported HTML must contain #constellation-card');
      assert.ok(html.includes('const-flyline-pulse'), 'Exported HTML must contain animated constellation pulse flow');
      assert.ok(html.includes('-89%'), 'Exported HTML KPI strip contains updated -89% prompt savings metric');
      assert.ok(html.includes('1,531 tok L0 vs 13,672 tok Eager'), 'Exported HTML KPI strip contains updated 1,531 vs 13,672 comparison');
      assert.ok(html.includes('16 / 16'), 'Exported HTML KPI strip contains updated 16 / 16 verified memories metric');

      // Verify renderScoreSvg produces needle-sweep and barGrow animation styles and classes
      const report = buildScoreReport(ws);
      const svg = renderScoreSvg(report);
      assert.ok(svg.includes('@keyframes needleSweep'), 'renderScoreSvg must include @keyframes needleSweep');
      assert.ok(svg.includes('@keyframes barGrow'), 'renderScoreSvg must include @keyframes barGrow');
      assert.ok(svg.includes('score-gauge-ring'), 'renderScoreSvg must attach score-gauge-ring animation class');
      assert.ok(svg.includes('savings-bar-fill'), 'renderScoreSvg must attach savings-bar-fill animation class');

      // Verify complex snapshot with special characters, HTML entities, and special token compiles cleanly
      const complexHtml = renderUiClientHtml(
        {
          score: {
            overallScore: 0,
            workspaceRoot: 'C:\\Projects\\<Secret> App',
            gitHotspots: [{ filePath: 'src/core/<module>.ts', fragilityScore: 5, unprotected: true }],
          },
          rules: [{ id: 'rule-angle', title: 'Generic <T> Guard', l0_summary: 'Test <T> & "quotes"', l1_contract: 'contract', l2_sop: 'sop' }],
          skills: [{ id: 'skill-1', name: 'Skill 1' }],
          tools: [{ id: 'tool-1', script_code: 'console.log("hello\\nworld");' }],
          memories: [{ id: 'mem-1', l0_summary: 'Memory L0 onclick="alert(1)" onload=bad()', freshness: { overall_status: 'VERIFIED', callers: ['src/app.ts:10'] } }],
          gatekeeperEvents: [{ timestamp: '2026-11-02T12:00:00.000Z', passed: false, kind: 'rule', target_id: 'rule-angle', diagnostics: 'Error in <WORKSPACE>/src/index.ts' }],
        },
        { token: 'tok"en\\with\'special', isExport: false, anon: true }
      );
      const complexMatch = complexHtml.match(/<script>([\s\S]*?)<\/script>/);
      assert.ok(complexMatch, 'Complex HTML contains inline script');
      assert.doesNotThrow(() => {
        new vm.Script(complexMatch[1]);
      }, 'Complex snapshot inline script must compile without syntax errors');
      assert.equal(/\bon[a-z]+\s*=/i.test(complexHtml), false, 'Complex HTML with onclick= in snapshot data must escape = so /\bon[a-z]+\s*=/i is false');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('6. redactSensitiveDiagnostics across 18 credential types and Windows paths with spaces / JSON backslashes', () => {
    const ws = 'C:\\Projects\\My Secret App';

    // 1. Path with spaces and JSON escaped backslashes
    const rawDiag = 'Error in C:\\Projects\\My Secret App\\src\\index.ts and C:\\\\Projects\\\\My Secret App\\\\src\\\\test.ts';
    const redactedDiag = redactSensitiveDiagnostics(rawDiag, ws);
    assert.equal(redactedDiag.includes('C:\\Projects\\My Secret App'), false);
    assert.ok(redactedDiag.includes('<WORKSPACE>/src/index.ts') || redactedDiag.includes('<WORKSPACE>'));

    // 2. 18+ Categories of credentials
    const credentials = [
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
      'postgres://admin:secret123@localhost:5432/mydb',
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
      'gho_1234567890abcdefghijklmnopqrstuvwxyz',
      'xoxb-1234567890-1234567890-abcdef123456',
      'sk-proj-1234567890abcdef1234567890abcdef',
      'sk-ant-api03-1234567890abcdef1234567890abcdef',
      'AIzaSyD-1234567890abcdef1234567890abcdef',
      'AIzaSyD1234567890abcdef1234567890abcde-',
      'hf_1234567890abcdefghijklmnopqrstuvwxyz',
      'glpat-1234567890abcdefghij',
      'pypi-AgEIcHlwaS5vcmcCJDEyMzQ1Njc4LTkxMjM0NTY3ODkwMTIzNDU2Nzg5MA',
      'npm_1234567890abcdefghijklmnopqrstuv',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'https://user:mypassword@example.com/api',
      'http://user:mypassword@example.com:8080/api',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz',
      'password = "super_secret_password_123"',
      'apiKey: "sk-another-secret-token-key-9999"',
      'sk_' + 'live_1234567890abcdefghijklmn',
      'pk_' + 'live_1234567890abcdefghijklmn',
      'awsSecretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
    ];

    for (const cred of credentials) {
      const sanitized = redactSensitiveDiagnostics(`Diagnostic line: ${cred}`, ws);
      assert.equal(sanitized.includes(cred), false, `Credential must be redacted: ${cred}`);
    }

    // Preserve original scheme for basic auth
    const httpSanitized = redactSensitiveDiagnostics('http://user:mypassword@example.com:8080/api', ws);
    assert.ok(httpSanitized.startsWith('http://[REDACTED_CREDENTIALS]@'));

    // Specific token inside api_key preserves specific redaction marker
    const gKeySanitized = redactSensitiveDiagnostics('api_key: "AIzaSyD-1234567890abcdef1234567890abcdef"', ws);
    assert.ok(gKeySanitized.includes('[REDACTED_GOOGLE_API_KEY]'));
  });

  test('7. Slash commands creation, updatedFiles.length preservation, and clean runUninstall', () => {
    const ws = createTempDir('slash-cmds');
    try {
      const res = runInit(ws, ['claude', 'cursor', 'gemini']);

      // Invariant: updatedFiles.length strictly preserved for backwards compatibility (length 3)
      assert.equal(res.updatedFiles.length, 3);
      assert.deepEqual(res.updatedFiles.sort(), ['CLAUDE.md', '.cursor/rules/evo-kernel.mdc', 'GEMINI.md'].sort());

      // Slash commands created in commandFiles
      assert.ok(res.commandFiles && res.commandFiles.length >= 6);
      for (const cmdFile of res.commandFiles) {
        const full = path.join(ws, cmdFile);
        assert.ok(fs.existsSync(full), `Command file ${cmdFile} must exist`);
        const content = fs.readFileSync(full, 'utf8');
        assert.ok(content.includes('<!-- EVO:COMMAND -->'), `Command file ${cmdFile} must contain EVO:COMMAND marker`);
      }

      // Uninstall cleans slash commands and prunes command directories
      const uninst = runUninstall(ws);
      assert.ok(uninst.cleanedFiles.length > 0);
      assert.equal(fs.existsSync(path.join(ws, '.claude', 'commands')), false);
      assert.equal(fs.existsSync(path.join(ws, '.cursor', 'commands')), false);
      assert.equal(fs.existsSync(path.join(ws, '.gemini', 'commands')), false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('8. server.json, .cursor-plugin/plugin.json, and .claude-plugin/plugin.json#hooks manifest parity', () => {
    const root = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    // 1. server.json
    const serverJsonPath = path.join(root, 'server.json');
    assert.ok(fs.existsSync(serverJsonPath), 'server.json must exist in root');
    const serverJson = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
    assert.equal(serverJson.$schema, 'https://static.modelcontextprotocol.io/schema/2025-10-17/server.json');
    assert.equal(serverJson.version, pkg.version);
    assert.equal(serverJson.license, pkg.license);
    assert.equal(serverJson.packages?.[0]?.version, pkg.version);

    // 2. .cursor-plugin/plugin.json
    const cursorJsonPath = path.join(root, '.cursor-plugin', 'plugin.json');
    assert.ok(fs.existsSync(cursorJsonPath), '.cursor-plugin/plugin.json must exist');
    const cursorJson = JSON.parse(fs.readFileSync(cursorJsonPath, 'utf8'));
    assert.equal(cursorJson.name, 'evo-kernel');
    assert.equal(cursorJson.version, pkg.version);

    // 3. .claude-plugin/plugin.json hooks
    const claudeJsonPath = path.join(root, '.claude-plugin', 'plugin.json');
    const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
    assert.ok(claudeJson.hooks?.PostToolUse, 'Claude plugin must have PostToolUse hook');
    assert.ok(claudeJson.hooks?.Stop, 'Claude plugin must have Stop hook');

    // 4. package.json files array
    assert.ok(pkg.files.includes('server.json'), 'package.json#files must include server.json');
    assert.ok(pkg.files.includes('.cursor-plugin'), 'package.json#files must include .cursor-plugin');

    // 5. Preflight micro-tool manifest parity & seed sync pass
    const preflight = spawnSync(
      process.execPath,
      [path.join(root, '.evo', 'tools', 'evo-release-preflight', 'run.mjs')],
      { encoding: 'utf8', timeout: 5000 }
    );
    const preflightRes = JSON.parse(preflight.stdout);
    assert.equal(preflightRes.checks.manifest_parity, 'OK', `Manifest parity failed: ${preflight.stdout}`);
    assert.equal(preflightRes.checks.seed_sync, 'OK', `Seed sync failed: ${preflight.stdout}`);
  });

  test('9. evo ui server watches memory-anchored source files and triggers change notifications over SSE', async () => {
    const ws = createTempDir('ui-watch-test');
    const srcDir = path.join(ws, 'src');
    const evoMemDir = path.join(ws, '.evo', 'memories');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(evoMemDir, { recursive: true });

    const targetSrcFile = path.join(srcDir, 'widget.ts');
    fs.writeFileSync(targetSrcFile, 'export function getWidget() { return 42; }\n', 'utf8');

    const memContent = `---
id: widget-fix-mem
title: "Widget Memory"
l0_summary: "Widget fix anchor"
created_commit: "head"
target_symbols: ["getWidget"]
ast_fingerprints: {"getWidget":{"symbol":"getWidget","file_path":"src/widget.ts","signature":"export function getWidget()","ast_hash":"abc"}}
tags: []
origin: "session"
created_at: "2026-11-01T00:00:00.000Z"
updated_at: "2026-11-01T00:00:00.000Z"
---
## Symptom
Widget issue
## Root Cause
Widget issue
## Solution
Widget issue
`;
    fs.writeFileSync(path.join(evoMemDir, 'widget-fix-mem.md'), memContent, 'utf8');

    const instance = await startUiServer(ws, { port: 0 });
    try {
      let receivedChange = false;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!receivedChange) resolve(); // don't hang if timing jitter
        }, 1500);

        const req = http.get(
          `http://127.0.0.1:${instance.port}/api/events?token=${instance.token}`,
          (res) => {
            res.on('data', (chunk) => {
              const text = chunk.toString();
              if (text.includes('"type":"change"')) {
                receivedChange = true;
                clearTimeout(timeout);
                res.destroy();
                resolve();
              }
            });
          }
        );
        req.on('error', reject);

        // Modify the memory-anchored source file after connection opens
        setTimeout(() => {
          fs.writeFileSync(targetSrcFile, 'export function getWidget() { return 100; }\n', 'utf8');
        }, 100);
      });

      assert.ok(receivedChange, 'UI server must notify SSE clients when a memory-anchored source file is modified');
    } finally {
      await instance.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('10. buildScoreReport calculates non-zero verifiedMemoriesCount and computeGitBugHotspots maps AST fingerprints', () => {
    // Current repo has 13 verified memories and git commits
    const root = process.cwd();
    const report = buildScoreReport(root);

    assert.equal(report.mode, 'project');
    assert.ok(report.capabilities.memoriesCount >= 10, 'Must have >= 10 memories');
    assert.ok(
      report.capabilities.verifiedMemoriesCount > 0,
      `verifiedMemoriesCount must be > 0 (got ${report.capabilities.verifiedMemoriesCount})`
    );

    // gitHotspots should have memories associated with files like src/core/storage.ts or src/mcp/handlers.ts
    const storageHotspot = report.gitHotspots.find((h) => h.filePath === 'src/core/storage.ts');
    if (storageHotspot) {
      assert.ok(storageHotspot.memoryCount > 0, 'src/core/storage.ts must have mapped memoryCount > 0');
    }
  });

  test('11. inspectMcpTaxSnapshot counts pooled servers from .evo/mcp-pool.json and .vscode/mcp.json ("servers"), and ScoreReport includes grade, waste100TurnsUsd, userStaticRuleTokens, and evoSeedTokens', () => {
    const ws = createTempDir('mcp-tax-test');
    try {
      // 1. Setup .vscode/mcp.json with "servers"
      const vscodeDir = path.join(ws, '.vscode');
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, 'mcp.json'),
        JSON.stringify({
          servers: {
            'custom-db': { command: 'node', args: ['db.js'] },
          },
        }),
        'utf8'
      );

      // 2. Setup .evo/mcp-pool.json in real object format (as generated by evo virtualize)
      const evoDir = path.join(ws, '.evo');
      fs.mkdirSync(evoDir, { recursive: true });
      fs.writeFileSync(
        path.join(evoDir, 'mcp-pool.json'),
        JSON.stringify({
          version: '0.3.0',
          updatedAt: '2026-11-01T00:00:00.000Z',
          mcpServers: {
            github: { command: 'npx', args: ['@modelcontextprotocol/server-github'] },
          },
          origins: {},
        }),
        'utf8'
      );

      // 3. Setup Codex TOML with env subtable to ensure .env is stripped
      const codexDir = path.join(ws, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'config.toml'),
        '[mcp_servers.sqlite]\ncommand = "uvx"\n\n[mcp_servers.sqlite.env]\nDB = "test.db"\n',
        'utf8'
      );

      // 4. Setup CLAUDE.md with user static rules and EVO seed markers
      fs.writeFileSync(
        path.join(ws, 'CLAUDE.md'),
        `# My User Static Rules\nAlways write tests.\n\n<!-- EVO:START -->\n# Evo Managed Seed\nL0 Seed Rules\n<!-- EVO:END -->\n`,
        'utf8'
      );

      // Inspect MCP tax
      const tax = inspectMcpTaxSnapshot(ws, { includeGlobal: false });
      assert.ok(tax.servers.some((s) => s.name === 'custom-db'), 'custom-db from .vscode/mcp.json ("servers") must be detected');
      assert.ok(tax.servers.some((s) => s.name === 'github' && s.status === 'pooled'), 'github from .evo/mcp-pool.json must be registered as pooled');
      assert.ok(tax.servers.some((s) => s.name === 'sqlite' && s.status === 'active'), 'sqlite from .codex/config.toml must be detected');
      assert.equal(tax.servers.filter((s) => s.name.startsWith('sqlite')).length, 1, 'sqlite.env must NOT be registered as separate server');
      assert.ok(tax.pooledServers >= 1, 'pooledServers must be >= 1');
      assert.ok(tax.pooledTaxTokens > 0, 'pooledTaxTokens must be > 0');

      // Build score report
      const report = buildScoreReport(ws, { includeGlobal: false });
      assert.ok(['A+', 'A', 'B', 'C', 'D', 'F'].includes(report.grade), `Valid grade expected, got ${report.grade}`);
      assert.ok(typeof report.waste100TurnsUsd.sonnetUsd === 'number', 'waste100TurnsUsd.sonnetUsd must be a number');
      assert.ok(typeof report.waste100TurnsUsd.opusUsd === 'number', 'waste100TurnsUsd.opusUsd must be a number');
      assert.ok(report.waste100TurnsUsd.sonnetUsd > 0, 'Unvirtualized active servers (custom-db, sqlite) must produce positive waste');
      assert.ok(report.contextSavings.userStaticRuleTokens > 0, 'userStaticRuleTokens must be > 0');
      assert.ok(report.contextSavings.evoSeedTokens > 0, 'evoSeedTokens must be > 0');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('12. buildUiSnapshot attaches telemetry attribution and aggregates live callers onto memory freshness', () => {
    const ws = createTempDir('ui-snapshot-test');
    try {
      const evoDir = path.join(ws, '.evo');
      const cacheDir = path.join(evoDir, '.cache');
      const memDir = path.join(evoDir, 'memories');
      const rulesDir = path.join(evoDir, 'rules');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.mkdirSync(memDir, { recursive: true });
      fs.mkdirSync(rulesDir, { recursive: true });

      // Create telemetry.db
      const db = new DatabaseSync(path.join(cacheDir, 'telemetry.db'));
      db.exec(`
        CREATE TABLE telemetry (
          id TEXT PRIMARY KEY,
          hit_count INTEGER DEFAULT 0,
          helped_count INTEGER DEFAULT 0,
          hurt_count INTEGER DEFAULT 0,
          contested INTEGER DEFAULT 0
        );
        INSERT INTO telemetry (id, hit_count, helped_count, hurt_count, contested)
        VALUES ('mem-widget', 5, 4, 1, 0), ('rule-test', 2, 0, 3, 0);
      `);
      db.close();

      // Create rule
      fs.writeFileSync(
        path.join(rulesDir, 'rule-test.md'),
        '---\nid: rule-test\ntitle: Test Rule\nl0_summary: L0 summary\nscope_glob: "*"\ncore: false\npriority: 10\ntags: []\norigin: session\ncreated_at: "2026-11-01T00:00:00.000Z"\nupdated_at: "2026-11-01T00:00:00.000Z"\n---\n## Rule Body\nBody\n',
        'utf8'
      );

      // Create memory
      fs.writeFileSync(
        path.join(memDir, 'mem-widget.md'),
        '---\nid: mem-widget\ntitle: Widget Fix\nl0_summary: L0 widget\ncreated_commit: head\ntarget_symbols: ["foo"]\nast_fingerprints: {}\ntags: []\norigin: session\ncreated_at: "2026-11-01T00:00:00.000Z"\nupdated_at: "2026-11-01T00:00:00.000Z"\n---\n## Symptom\nS\n## Root Cause\nRC\n## Solution\nSol\n',
        'utf8'
      );

      const snap = buildUiSnapshot(ws);
      assert.ok(snap.rules.length >= 1, 'Rules must be loaded');
      assert.ok(snap.memories.length >= 1, 'Memories must be loaded');

      const mem = snap.memories.find((m: any) => m.id === 'mem-widget');
      assert.ok(mem, 'mem-widget must be present');
      assert.equal(mem.hit_count, 5);
      assert.equal(mem.attribution, 'helped');
      assert.ok(Array.isArray(mem.freshness?.callers), 'freshness.callers must be an array');

      const rule = snap.rules.find((r: any) => r.id === 'rule-test');
      assert.ok(rule, 'rule-test must be present');
      assert.equal(rule.hit_count, 2);
      assert.equal(rule.attribution, 'hurt');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('13. GATE-1: bin/evo.mjs version pre-check wrapper intercepts unsupported Node (< 22.5.0) and prints friendly guidance', () => {
    const binEntry = path.resolve(process.cwd(), 'bin', 'evo.mjs');
    assert.ok(fs.existsSync(binEntry), 'bin/evo.mjs must exist');

    const proc = spawnSync(process.execPath, [binEntry, 'version'], {
      env: { ...process.env, EVO_SIMULATE_NODE_VERSION: '20.11.0' },
      encoding: 'utf8',
      timeout: 5000,
    });

    assert.equal(proc.status, 1, 'Process must exit with code 1 on simulated Node 20.11.0');
    assert.ok(proc.stderr.includes('Node.js >= 22.5.0 is required'), 'Stderr must state Node >= 22.5.0 requirement');
    assert.ok(proc.stderr.includes('nvm install 22'), 'Stderr must recommend nvm/fnm/volta quick fixes');
  });

  test('14. GATE-2: evo uninstall --help and evo init --help produce zero side-effects and exit 0 without mutating workspace', () => {
    const emptyDir = createTempDir('help-zero-side-effects');
    const binEntry = path.resolve(process.cwd(), 'bin', 'evo.mjs');

    try {
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'Directory starts empty');

      // 1. evo uninstall --help
      const uninstProc = spawnSync(process.execPath, [binEntry, 'uninstall', '--help'], {
        cwd: emptyDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(uninstProc.status, 0, 'evo uninstall --help must exit with 0');
      assert.ok(uninstProc.stdout.includes('evo uninstall [options]'), 'Must print uninstall help');
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo uninstall --help created 0 files or directories');

      // 2. evo init --help
      const initProc = spawnSync(process.execPath, [binEntry, 'init', '--help'], {
        cwd: emptyDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(initProc.status, 0, 'evo init --help must exit with 0');
      assert.ok(initProc.stdout.includes('evo init [options]'), 'Must print init help');
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo init --help created 0 files or directories');

      // 3. evo --help
      const generalHelp = spawnSync(process.execPath, [binEntry, '--help'], {
        cwd: emptyDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(generalHelp.status, 0, 'evo --help must exit with 0');
      assert.ok(generalHelp.stdout.includes('check <file>'), 'General help must document check command');
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo --help created 0 files or directories');

      // 4. evo version
      const verProc = spawnSync(process.execPath, [binEntry, 'version'], {
        cwd: emptyDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(verProc.status, 0, 'evo version must exit with 0');
      assert.ok(verProc.stdout.includes('0.3.0'), 'evo version must print 0.3.0');
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo version created 0 files or directories');

      // 5. evo init -h with other flags
      const initHProc = spawnSync(process.execPath, [binEntry, 'init', '-h', '--workspace', emptyDir], {
        cwd: emptyDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(initHProc.status, 0, 'evo init -h must exit with 0');
      assert.deepEqual(fs.readdirSync(emptyDir), [], 'evo init -h created 0 files or directories');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('15. GATE-4: Top-level evo check <path> inspects deliverables, outputs structured text and JSON, and sets exit codes', () => {
    const tempDir = createTempDir('check-cli-test');
    const binEntry = path.resolve(process.cwd(), 'bin', 'evo.mjs');

    try {
      const validMd = path.join(tempDir, 'valid.md');
      fs.writeFileSync(validMd, '# Title\n\nClean markdown content without unresolved placeholders.\n', 'utf8');

      // 1. Missing target path -> exit 1
      const missingArg = spawnSync(process.execPath, [binEntry, 'check'], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(missingArg.status, 1, 'Missing argument must exit with code 1');
      assert.ok(missingArg.stderr.includes('Missing target deliverable file path'), 'Must report missing file path');

      // 2. Non-existent file -> exit 1
      const missingFile = spawnSync(process.execPath, [binEntry, 'check', 'nonexistent.xlsx'], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(missingFile.status, 1, 'Non-existent file inspection must exit with code 1');

      // 3. Directory path -> exit 1 with clean ERR_IS_DIRECTORY defect (no unhandled EISDIR crash)
      const dirCheck = spawnSync(process.execPath, [binEntry, 'check', tempDir], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(dirCheck.status, 1, 'Directory inspection must exit with code 1');
      assert.ok(dirCheck.stdout.includes('ERR_IS_DIRECTORY'), 'Must report ERR_IS_DIRECTORY');

      // 4. Valid file human-readable check -> exit 0
      const validText = spawnSync(process.execPath, [binEntry, 'check', validMd], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(validText.status, 0, 'Valid deliverable check must exit with code 0');
      assert.ok(validText.stdout.includes('Deliverable Canonical Inspection'), 'Must print inspection header');
      assert.ok(validText.stdout.includes('PASSED'), 'Must indicate passed status');

      // 5. Flag order: evo check --workspace <dir> <file>
      const flagOrderCheck = spawnSync(process.execPath, [binEntry, 'check', '--workspace', tempDir, 'valid.md'], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(flagOrderCheck.status, 0, 'Flag order check must exit with code 0');
      assert.ok(flagOrderCheck.stdout.includes('PASSED'), 'Must indicate passed status');

      // 6. Valid file --json flag -> exit 0 and valid JSON output
      const validJson = spawnSync(process.execPath, [binEntry, 'check', validMd, '--json'], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(validJson.status, 0, 'Valid file with --json must exit with code 0');
      const parsed = JSON.parse(validJson.stdout);
      assert.equal(parsed.ok, true, 'JSON report ok must be true');
      assert.equal(parsed.format, 'md', 'JSON format must be md');

      // 7. Alias inspect <file> works identically
      const aliasCheck = spawnSync(process.execPath, [binEntry, 'inspect', validMd], {
        cwd: tempDir,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(aliasCheck.status, 0, 'evo inspect alias must exit with code 0');
      assert.ok(aliasCheck.stdout.includes('PASSED'), 'Must indicate passed status');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('16. All tools byte-for-byte parity between .evo/tools and templates/seed-evo/tools', () => {
    const root = process.cwd();
    const activeDir = path.join(root, '.evo', 'tools');
    const seedDir = path.join(root, 'templates', 'seed-evo', 'tools');

    for (const toolName of fs.readdirSync(activeDir)) {
      const activeManifest = fs.readFileSync(path.join(activeDir, toolName, 'manifest.json'));
      const seedManifest = fs.readFileSync(path.join(seedDir, toolName, 'manifest.json'));
      assert.equal(
        Buffer.compare(activeManifest, seedManifest),
        0,
        `${toolName}/manifest.json must be 100% byte-for-byte identical`
      );

      const activeRun = fs.readFileSync(path.join(activeDir, toolName, 'run.mjs'));
      const seedRun = fs.readFileSync(path.join(seedDir, toolName, 'run.mjs'));
      assert.equal(
        Buffer.compare(activeRun, seedRun),
        0,
        `${toolName}/run.mjs must be 100% byte-for-byte identical`
      );
    }
  });

  test('17. startUiServer respects custom pre-shared token, encodes token in instance.url, and authenticates requests', async () => {
    const ws = createTempDir('custom-token-ui');
    const customToken = 'my_secret_#token&key=42?val=yes+ok@world~1!';
    const instance = await startUiServer(ws, { port: 0, token: customToken });

    try {
      assert.equal(instance.token, customToken);
      assert.ok(instance.url.includes(`?token=${encodeURIComponent(customToken)}`));

      // 1. Snapshot with custom token header -> 200
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${instance.port}/api/snapshot`,
          { headers: { 'X-Evo-UI-Token': customToken } },
          (res) => {
            assert.equal(res.statusCode, 200);
            resolve();
          }
        );
        req.on('error', reject);
      });

      // 2. Snapshot with query token containing exotic URL characters -> 200
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${instance.port}/api/snapshot?token=${encodeURIComponent(customToken)}`,
          (res) => {
            assert.equal(res.statusCode, 200);
            resolve();
          }
        );
        req.on('error', reject);
      });

      // 3. Snapshot with wrong token -> 401
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${instance.port}/api/snapshot?token=wrong`,
          (res) => {
            assert.equal(res.statusCode, 401);
            resolve();
          }
        );
        req.on('error', reject);
      });

      // 4. Invalid port throws RangeError
      await assert.rejects(
        () => startUiServer(ws, { port: -1 }),
        (err: any) => err instanceof RangeError && err.message.includes('options.port')
      );
      await assert.rejects(
        () => startUiServer(ws, { port: Number.NaN }),
        (err: any) => err instanceof RangeError && err.message.includes('options.port')
      );
    } finally {
      await instance.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('18. evo ui CLI flag parser supports --export=<path>, --export <path>, and default help output includes default port 4310', () => {
    const ws = createTempDir('ui-export-flag');
    const binEntry = path.resolve(process.cwd(), 'bin', 'evo.mjs');
    const exportFile = path.join(ws, 'custom-export.html');
    const spaceExportFile = path.join(ws, 'space-export.html');

    try {
      // 1. --export=<path>
      const res = spawnSync(process.execPath, [binEntry, 'ui', `--export=${exportFile}`], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(res.status, 0, 'evo ui --export=<path> must exit 0');
      assert.ok(fs.existsSync(exportFile), 'Export file must be created');
      assert.ok(res.stdout.includes('EvoKernel Live Cockpit exported to:'));

      // 2. --export <path> space-separated
      const spaceRes = spawnSync(process.execPath, [binEntry, 'ui', '--export', spaceExportFile], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(spaceRes.status, 0, 'evo ui --export <path> must exit 0');
      assert.ok(fs.existsSync(spaceExportFile), 'Space export file must be created');

      // 3. --export with default fallback
      const defaultRes = spawnSync(process.execPath, [binEntry, 'ui', '--export'], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(defaultRes.status, 0, 'evo ui --export without path must exit 0');
      assert.ok(fs.existsSync(path.join(ws, 'evo-cockpit.html')), 'Default evo-cockpit.html must be created');

      // 4. Help output states default port 4310
      const helpRes = spawnSync(process.execPath, [binEntry, 'ui', '--help'], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(helpRes.status, 0);
      assert.ok(helpRes.stdout.includes('(default: 4310)'), 'Help must specify default port 4310');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('19. evo ui CLI flag parser validates --port and --token, rejecting malformed inputs with clean error exit', () => {
    const ws = createTempDir('ui-flags-validation');
    const binEntry = path.resolve(process.cwd(), 'bin', 'evo.mjs');

    try {
      // 1. Invalid port string (--port=abc)
      const badPortRes1 = spawnSync(process.execPath, [binEntry, 'ui', '--port=abc'], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(badPortRes1.status, 1, 'Must exit with code 1 on non-numeric port');
      assert.ok(badPortRes1.stderr.includes('Invalid port "abc"'));

      // 2. Out-of-bounds port (--port 99999)
      const badPortRes2 = spawnSync(process.execPath, [binEntry, 'ui', '--port', '99999'], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(badPortRes2.status, 1, 'Must exit with code 1 on out-of-bounds port');
      assert.ok(badPortRes2.stderr.includes('Invalid port "99999"'));

      // 3. Missing port value (--port followed by another flag)
      const missingPortRes = spawnSync(process.execPath, [binEntry, 'ui', '--port', '--open'], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(missingPortRes.status, 1, 'Must exit with code 1 when --port value is missing');
      assert.ok(missingPortRes.stderr.includes('Missing value for --port'));

      // 4. Missing token value (--token with no value)
      const missingTokenRes = spawnSync(process.execPath, [binEntry, 'ui', '--token'], {
        cwd: ws,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(missingTokenRes.status, 1, 'Must exit with code 1 when --token value is missing');
      assert.ok(missingTokenRes.stderr.includes('Missing value for --token'));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
