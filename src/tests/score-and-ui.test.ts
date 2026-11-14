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
import {
  exportUiHtml,
  startUiServer,
  buildUiSnapshot,
  detectChromiumBrowser,
  launchDefaultBrowser,
  launchNativeDesktopWindow,
  isValidLocalHttpUrl,
  isTestEnvironment,
} from '../cli/ui.js';
import { renderUiClientHtml } from '../templates/ui-client.js';
import { runInit, runUninstall, mountIdeExtensions, unmountIdeExtensions, syncManagedRuleBlocks } from '../cli/init.js';
import {
  activate,
  deactivate,
  handleWebviewAction,
  resolveActiveWorkspaceRoot,
} from '../ide/vscode-extension.js';
import { resolveCurrentGitCommit, resolveCurrentGitBranch } from '../core/memory.js';
import { redactSensitiveDiagnostics, EvoTelemetry } from '../core/telemetry.js';
import { EVO_KERNEL_VERSION, EvoStorage } from '../core/storage.js';

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

  test('3. Non-project directory Global Host Audit Mode completes in <150ms (with warm-up)', () => {
    const nonProj = createTempDir('nonproj');
    try {
      // Warm up OS filesystem cache before timing assertion (Issue #22)
      buildScoreReport(nonProj);

      const t0 = performance.now();
      const report = buildScoreReport(nonProj);
      const elapsed = performance.now() - t0;

      assert.equal(report.mode, 'global');
      assert.ok(elapsed < 150, `Global Host Audit took ${elapsed.toFixed(2)}ms, expected < 150ms`);
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

      // Verify Workbench 2.0 3-column skeleton layout and DOM elements exist
      assert.ok(html.includes('id="workbench-root"'), 'Exported HTML must contain #workbench-root container');
      assert.ok(html.includes('id="topbar"'), 'Exported HTML must contain #topbar header');
      assert.ok(html.includes('id="topbar-brand-name"'), 'Exported HTML must contain #topbar-brand-name');
      assert.ok(html.includes('id="cmd-palette-trigger"'), 'Exported HTML must contain #cmd-palette-trigger');
      assert.ok(html.includes('id="left-rail"'), 'Exported HTML must contain Column 1 #left-rail');
      assert.ok(html.includes('id="nav-view-switcher"'), 'Exported HTML must contain #nav-view-switcher');
      assert.ok(html.includes('id="nav-btn-capabilities"'), 'Exported HTML must contain #nav-btn-capabilities');
      assert.ok(html.includes('id="nav-btn-topology"'), 'Exported HTML must contain #nav-btn-topology');
      assert.ok(html.includes('id="nav-btn-hotspots"'), 'Exported HTML must contain #nav-btn-hotspots');
      assert.ok(html.includes('id="nav-btn-gatekeeper"'), 'Exported HTML must contain #nav-btn-gatekeeper');
      assert.ok(html.includes('id="bento-health"'), 'Exported HTML must contain #bento-health Bento card');
      assert.ok(html.includes('id="bento-savings"'), 'Exported HTML must contain #bento-savings Bento card');
      assert.ok(html.includes('id="bento-budget"'), 'Exported HTML must contain #bento-budget Bento card');
      assert.ok(html.includes('id="center-stage"'), 'Exported HTML must contain Column 2 #center-stage');
      assert.ok(html.includes('id="view-capabilities"'), 'Exported HTML must contain #view-capabilities section');
      assert.ok(html.includes('id="capabilities-table"'), 'Exported HTML must contain #capabilities-table');
      assert.ok(html.includes('id="view-topology"'), 'Exported HTML must contain #view-topology section');
      assert.ok(html.includes('id="topology-svg"'), 'Exported HTML must contain #topology-svg SVG canvas');
      assert.ok(html.includes('id="view-hotspots"'), 'Exported HTML must contain #view-hotspots section');
      assert.ok(html.includes('id="hotspots-table"'), 'Exported HTML must contain #hotspots-table');
      assert.ok(html.includes('id="view-gatekeeper"'), 'Exported HTML must contain #view-gatekeeper section');
      assert.ok(html.includes('id="gatekeeper-timeline"'), 'Exported HTML must contain #gatekeeper-timeline');
      assert.ok(html.includes('id="right-inspector"'), 'Exported HTML must contain Column 3 #right-inspector');
      assert.ok(html.includes('id="inspector-placeholder"'), 'Exported HTML must contain #inspector-placeholder');
      assert.ok(html.includes('id="cmd-palette-backdrop"'), 'Exported HTML must contain #cmd-palette-backdrop');
      assert.ok(html.includes('id="toast-container"'), 'Exported HTML must contain #toast-container');
      assert.ok(html.includes('--bg-canvas'), 'Exported HTML must contain Zinc dark tokens (--bg-canvas)');
      assert.ok(
        html.includes('--bg-canvas: #09090b'),
        'Exported HTML must declare Zinc dark canvas token (--bg-canvas: #09090b)'
      );
      assert.ok(
        html.includes('--text-primary: #fafafa'),
        'Exported HTML must declare Zinc light primary text token (--text-primary: #fafafa)'
      );
      assert.ok(
        html.includes('--border-subtle: #27272a'),
        'Exported HTML must declare Zinc subtle border token (--border-subtle: #27272a)'
      );
      assert.ok(
        html.includes('inset 0 1px 0 0 rgba(255, 255, 255, 0.05)'),
        'Exported HTML must contain Cult-UI micro-inset highlight token'
      );
      assert.ok(
        html.includes('cubic-bezier(0.22, 1, 0.36, 1)'),
        'Exported HTML must contain Motion-Primitives spring transition timing function'
      );

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

    // 5. Manifest version parity & local-only asset isolation
    for (const relManifest of [
      'plugin.json',
      '.claude-plugin/plugin.json',
      'gemini-extension.json',
      '.cursor-plugin/plugin.json',
    ]) {
      const manifestPath = path.join(root, relManifest);
      assert.ok(fs.existsSync(manifestPath), `${relManifest} must exist`);
      const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifestJson.version, pkg.version, `${relManifest} version must match package.json`);
    }

    const localOnlyAssets = [
      'ceo-team-orchestrator',
      'evo-dev-verification-sop',
      'evo-release-preflight',
      'embedded-fsm-lookup-audit',
    ];
    for (const asset of localOnlyAssets) {
      for (const relCheck of [
        path.join('templates', 'seed-evo', 'skills', asset),
        path.join('templates', 'seed-evo', 'tools', asset),
        path.join('templates', 'seed-evo', 'rules', `${asset}.md`),
        path.join('templates', 'seed-evo', 'rules', 'scoped', `${asset}.md`),
        path.join('skills', asset),
        path.join('.evo', 'skills', asset),
        path.join('.evo', 'tools', asset),
        path.join('.evo', 'rules', `${asset}.md`),
        path.join('.evo', 'rules', 'scoped', `${asset}.md`),
      ]) {
        assert.equal(
          fs.existsSync(path.join(root, relCheck)),
          false,
          `Local-only asset "${asset}" must NOT exist at ${relCheck}`
        );
      }
    }
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
          version: EVO_KERNEL_VERSION,
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
      assert.ok(verProc.stdout.includes(EVO_KERNEL_VERSION), `evo version must print ${EVO_KERNEL_VERSION}`);
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
      assert.ok(res.stdout.includes('Workbench 2.0 exported to:') || res.stdout.includes('exported to:'));

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

  test('20. POST /api/action: 6 core actions, traversal guards, token auth, 1MB limit, and 405 Method Not Allowed', async () => {
    const ws = createTempDir('api-action-test');
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();

    // Prepare fixtures: rule, skill, tool, memory
    const rulesDir = storage.rulesDir;
    const skillsDir = storage.skillsDir;
    const toolsDir = storage.toolsDir;
    const memDir = storage.memoriesDir;

    // 1. Fixture: rule
    fs.writeFileSync(
      path.join(rulesDir, 'test-rule.md'),
      `---\nid: test-rule\ntitle: Test Rule\nl0_summary: Test L0 Summary\nscope_glob: "*"\ncore: false\npriority: 10\ntags: []\norigin: session\ncreated_at: "2026-11-01T00:00:00.000Z"\nupdated_at: "2026-11-01T00:00:00.000Z"\n---\n## Rule Body\nInitial rule body.\n`,
      'utf8'
    );

    // 2. Fixture: skill
    const skillSub = path.join(skillsDir, 'test-skill');
    fs.mkdirSync(skillSub, { recursive: true });
    fs.writeFileSync(
      path.join(skillSub, 'SKILL.md'),
      `---\nname: test-skill\ndescription: Test Skill\n---\n# Skill SOP\nInitial skill content.\n`,
      'utf8'
    );

    // 3. Fixture: tool
    const toolSub = path.join(toolsDir, 'test-tool');
    fs.mkdirSync(toolSub, { recursive: true });
    fs.writeFileSync(
      path.join(toolSub, 'manifest.json'),
      JSON.stringify({ id: 'test-tool', description: 'Test tool', runtime: 'node', entrypoint: 'run.mjs', entry_script: 'run.mjs' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(toolSub, 'run.mjs'),
      `if (process.argv.includes('--self-test')) { console.log('OK'); process.exit(0); }\nconsole.log('Running');\n`,
      'utf8'
    );

    // 4. Fixture: memory
    const srcDir = path.join(ws, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const targetSrc = path.join(srcDir, 'target.ts');
    fs.writeFileSync(targetSrc, 'export function targetFunction() { return 1; }\n', 'utf8');

    fs.writeFileSync(
      path.join(memDir, 'test-mem.md'),
      `---\nid: test-mem\ntitle: Test Memory\nl0_summary: Memory summary\ncreated_commit: head\ntarget_symbols: ["targetFunction"]\nast_fingerprints: {"targetFunction":{"symbol":"targetFunction","file_path":"src/target.ts","signature":"export function targetFunction()","ast_hash":"abc"}}\ntags: []\norigin: session\ncreated_at: "2026-11-01T00:00:00.000Z"\nupdated_at: "2026-11-01T00:00:00.000Z"\n---\n## Symptom\nSym\n## Root Cause\nRC\n## Solution\nSol\n`,
      'utf8'
    );

    const instance = await startUiServer(ws, { port: 0 });

    const postAction = (payload: any, options: { token?: string; contentType?: string; method?: string } = {}) => {
      const targetToken = options.token !== undefined ? options.token : instance.token;
      return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const req = http.request(
          `http://127.0.0.1:${instance.port}/api/action`,
          {
            method: options.method || 'POST',
            headers: {
              ...(targetToken ? { 'X-Evo-UI-Token': targetToken } : {}),
              'Content-Type': options.contentType !== undefined ? options.contentType : 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
          },
          (res) => {
            let resBody = '';
            res.on('data', (c) => (resBody += c));
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode || 0, body: JSON.parse(resBody) });
              } catch {
                resolve({ status: res.statusCode || 0, body: resBody });
              }
            });
          }
        );
        req.on('error', reject);
        req.write(data);
        req.end();
      });
    };

    try {
      // A. Security Perimeter: Method Not Allowed
      const getRes = await postAction({}, { method: 'GET' });
      assert.equal(getRes.status, 405);
      assert.equal(getRes.body.ok, false);

      // B. Security Perimeter: Unauthorized (missing token)
      const noTokenRes = await postAction({ action: 'verify-memory' }, { token: '' });
      assert.equal(noTokenRes.status, 401);

      // C. Security Perimeter: Bad Content-Type
      const badCtRes = await postAction({ action: 'verify-memory' }, { contentType: 'text/plain' });
      assert.equal(badCtRes.status, 400);

      // D. Security Perimeter: Path Traversal Guard (open-editor)
      const traversalRes = await postAction({ action: 'open-editor', params: { filePath: '../../etc/passwd' } });
      assert.equal(traversalRes.status, 403);
      assert.ok(traversalRes.body.error.includes('Path traversal'));

      // E. Security Perimeter: Missing filePath (open-editor)
      const missingPathRes = await postAction({ action: 'open-editor', params: {} });
      assert.equal(missingPathRes.status, 400);

      // F. Action 1: open-editor on existing workspace file
      const openRes = await postAction({ action: 'open-editor', params: { filePath: 'src/target.ts', line: 1 } });
      assert.equal(openRes.status, 200);
      assert.equal(openRes.body.ok, true);
      assert.equal(openRes.body.action, 'open-editor');
      assert.ok(openRes.body.data.opened.endsWith('target.ts'));

      // G. Action 2: verify-memory
      const verifyRes = await postAction({ action: 'verify-memory', params: { id: 'test-mem' } });
      assert.equal(verifyRes.status, 200);
      assert.equal(verifyRes.body.ok, true);
      assert.equal(verifyRes.body.action, 'verify-memory');
      assert.equal(verifyRes.body.data.verifiedCount, 1);

      // H. Action 3: run-tool-test (sandboxed --self-test)
      const toolRes = await postAction({ action: 'run-tool-test', params: { id: 'test-tool' } });
      assert.equal(toolRes.status, 200);
      assert.equal(toolRes.body.ok, true);
      assert.equal(toolRes.body.result.exitCode, 0);
      assert.ok(toolRes.body.result.stdout.includes('OK'));

      // I. Action 4: toggle-rule-tier (promote to core)
      const toggleRes = await postAction({ action: 'toggle-rule-tier', params: { id: 'test-rule', core: true } });
      assert.equal(toggleRes.status, 200);
      assert.equal(toggleRes.body.ok, true);
      assert.equal(toggleRes.body.data.core, true);
      assert.ok(typeof toggleRes.body.tokenUsage === 'number');

      // J. Action 5: update-content (edit rule markdown)
      const updatedMarkdown = `---\nid: test-rule\ntitle: Test Rule Updated\nl0_summary: Updated summary\nscope_glob: "*"\ncore: true\npriority: 10\ntags: []\norigin: session\ncreated_at: "2026-11-01T00:00:00.000Z"\nupdated_at: "2026-11-01T00:00:00.000Z"\n---\n## Rule Body\nUpdated rule body content.\n`;
      const updateRes = await postAction({
        action: 'update-content',
        params: { kind: 'rule', id: 'test-rule', content: updatedMarkdown },
      });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.ok, true);
      assert.equal(updateRes.body.data.updated, true);

      // K. Action 6: archive-item
      const archiveRes = await postAction({
        action: 'archive-item',
        params: { kind: 'rule', id: 'test-rule', reason: 'Test retirement' },
      });
      assert.equal(archiveRes.status, 200);
      assert.equal(archiveRes.body.ok, true);
      assert.equal(archiveRes.body.data.archived.id, 'test-rule');

      // L. Unknown action -> 400
      const unknownRes = await postAction({ action: 'nonexistent-action' });
      assert.equal(unknownRes.status, 400);
      assert.ok(unknownRes.body.error.includes('Unknown action'));
    } finally {
      await instance.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('21. Micro-Window launcher flags (--app, --desktop), URL security validation, and cross-platform browser resolution', () => {
    const ws = createTempDir('micro-window-test');
    const binEntry = path.resolve(process.cwd(), 'bin', 'evo.mjs');

    try {
      // 1. URL security guard: launchDefaultBrowser rejects non-local and userinfo-spoofed URLs
      assert.equal(launchDefaultBrowser('https://malicious.evil.com'), false);
      assert.equal(launchDefaultBrowser('ftp://localhost'), false);
      assert.equal(launchDefaultBrowser('javascript:alert(1)'), false);
      assert.equal(launchDefaultBrowser('http://127.0.0.1:secret@evil.com'), false);
      assert.equal(launchDefaultBrowser('http://127.0.0.1:secret@evil.com/'), false);
      assert.equal(launchDefaultBrowser('http://localhost:80@evil.com/'), false);
      assert.equal(launchDefaultBrowser('http://user:pass@127.0.0.1:4310/'), false);
      assert.equal(launchDefaultBrowser('http://127.0.0.1'), false);

      // 2. URL security guard: launchNativeDesktopWindow rejects non-local and userinfo-spoofed URLs
      assert.equal(launchNativeDesktopWindow('https://evil.com'), false);
      assert.equal(launchNativeDesktopWindow('file:///C:/Windows/system32/cmd.exe'), false);
      assert.equal(launchNativeDesktopWindow('http://127.0.0.1:secret@evil.com'), false);
      assert.equal(launchNativeDesktopWindow('http://localhost:80@evil.com/'), false);
      assert.equal(launchNativeDesktopWindow('http://user:pass@127.0.0.1:4310/'), false);
      assert.equal(launchNativeDesktopWindow('http://127.0.0.1'), false);

      // 2b. Strict local URL validator unit assertions
      assert.equal(isValidLocalHttpUrl('http://127.0.0.1:4310/'), true);
      assert.equal(isValidLocalHttpUrl('http://localhost:4310/'), true);
      assert.equal(isValidLocalHttpUrl('http://127.0.0.1:4310/?token=abc123xyz'), true);
      assert.equal(isValidLocalHttpUrl('http://127.0.0.1:secret@evil.com'), false);
      assert.equal(isValidLocalHttpUrl('http://localhost:80@evil.com/'), false);
      assert.equal(isValidLocalHttpUrl('http://user:pass@127.0.0.1:4310/'), false);
      assert.equal(isValidLocalHttpUrl('http://127.0.0.1:99999/'), false);
      assert.equal(isValidLocalHttpUrl('http://127.0.0.1'), false);

      // 3. detectChromiumBrowser returns a string or null on current host
      const hostBrowser = detectChromiumBrowser();
      if (hostBrowser) {
        assert.ok(typeof hostBrowser === 'string');
        assert.ok(hostBrowser.length > 0);
      }

      // 4. Test platform-specific candidate paths logic
      const originalPlatform = process.platform;
      try {
        // Test darwin candidate structure
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        const macBrowser = detectChromiumBrowser();
        // Returns string if on macOS or null if candidates don't exist
        assert.ok(macBrowser === null || typeof macBrowser === 'string');

        // Test linux candidate structure
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        const linuxBrowser = detectChromiumBrowser();
        assert.ok(linuxBrowser === null || typeof linuxBrowser === 'string');

        // Test win32 candidate structure
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        const winBrowser = detectChromiumBrowser();
        assert.ok(winBrowser === null || typeof winBrowser === 'string');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }

      // 5. CLI help documents --app and --desktop flags
      const uiHelp = spawnSync(process.execPath, [binEntry, 'ui', '--help'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(uiHelp.status, 0);
      assert.ok(uiHelp.stdout.includes('--app, --desktop'), 'Help output must document --app, --desktop flags');
      assert.ok(uiHelp.stdout.includes('native chromeless desktop window'), 'Help output must describe chromeless window mode');

      // 6. General help documents ui --app, --desktop
      const genHelp = spawnSync(process.execPath, [binEntry, '--help'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(genHelp.status, 0);
      assert.ok(genHelp.stdout.includes('[--app] [--desktop]'), 'General help must document [--app] [--desktop]');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('22. IDE extension entrypoint (activate, deactivate, handleWebviewAction), mountIdeExtensions, and non-circular MountIdeResult', async () => {
    const ws = createTempDir('ide-extension-test');
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();

    // Prepare fixture memory & tool
    const memDir = storage.memoriesDir;
    const toolsDir = storage.toolsDir;
    const srcDir = path.join(ws, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const targetFile = path.join(srcDir, 'index.ts');
    fs.writeFileSync(targetFile, 'export const val = 42;\n', 'utf8');

    fs.writeFileSync(
      path.join(memDir, 'ide-mem.md'),
      `---\nid: ide-mem\ntitle: IDE Memory\nl0_summary: IDE L0\ncreated_commit: head\ntarget_symbols: ["val"]\nast_fingerprints: {"val":{"symbol":"val","file_path":"src/index.ts","signature":"export const val = 42;","ast_hash":"val1"}}\ntags: []\norigin: session\ncreated_at: "2026-11-01T00:00:00.000Z"\nupdated_at: "2026-11-01T00:00:00.000Z"\n---\n## Symptom\nS\n## Root Cause\nRC\n## Solution\nSol\n`,
      'utf8'
    );

    const toolSub = path.join(toolsDir, 'ide-tool');
    fs.mkdirSync(toolSub, { recursive: true });
    fs.writeFileSync(
      path.join(toolSub, 'manifest.json'),
      JSON.stringify({ id: 'ide-tool', description: 'Tool', runtime: 'node', entrypoint: 'run.mjs', entry_script: 'run.mjs' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(toolSub, 'run.mjs'),
      `if (process.argv.includes('--self-test')) { console.log('PASS'); process.exit(0); }\n`,
      'utf8'
    );

    // 1. Dynamic import of compiled IDE extension module
    const extModulePath = path.resolve(process.cwd(), 'dist', 'ide', 'vscode-extension.js');
    assert.ok(fs.existsSync(extModulePath), 'dist/ide/vscode-extension.js must exist');
    const ext = await import(`file://${extModulePath.replace(/\\/g, '/')}`);

    // Assert entrypoint exports
    assert.equal(typeof ext.activate, 'function');
    assert.equal(typeof ext.deactivate, 'function');
    assert.equal(typeof ext.handleWebviewAction, 'function');
    assert.equal(typeof ext.getActivePanel, 'function');
    assert.equal(typeof ext.renderWorkbenchHtml, 'function');
    assert.equal(typeof ext.buildSecuredWebviewHtml, 'function');
    assert.equal(typeof ext.resolveActiveWorkspaceRoot, 'function');

    // 2. Mock VS Code environment
    const registeredCommands = new Map<string, Function>();
    let createdPanel: any = null;
    let openedDocUri: any = null;
    let showedDoc: any = null;

    const mockVsCode = {
      window: {
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          createdPanel = {
            viewType,
            title,
            webview: {
              html: '',
              options,
              postMessage: (msg: any) => {},
              onDidReceiveMessage: (listener: Function) => ({ dispose() {} }),
            },
            reveal: () => {},
            dispose: () => { createdPanel = null; },
            onDidDispose: (cb: Function) => ({ dispose() {} }),
          };
          return createdPanel;
        },
        showWarningMessage: () => {},
        showTextDocument: async (doc: any, opts: any) => {
          showedDoc = { doc, opts };
          return {};
        },
        activeTextEditor: undefined,
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: ws }, name: 'test', index: 0 }],
        openTextDocument: async (uri: any) => {
          openedDocUri = uri;
          return { uri, fileName: typeof uri === 'string' ? uri : uri.fsPath, lineCount: 10, getText: () => '' };
        },
        getWorkspaceFolder: () => ({ uri: { fsPath: ws }, name: 'test', index: 0 }),
      },
      commands: {
        registerCommand: (name: string, callback: Function) => {
          registeredCommands.set(name, callback);
          return { dispose: () => { registeredCommands.delete(name); } };
        },
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, scheme: 'file', path: p, toString: () => p }),
      },
      Position: class {
        line: number;
        character: number;
        constructor(line: number, character: number) {
          this.line = line;
          this.character = character;
        }
      },
      Selection: class {
        start: any;
        end: any;
        anchor: any;
        active: any;
        constructor(anchor: any, active: any) {
          this.anchor = anchor;
          this.active = active;
          this.start = anchor;
          this.end = active;
        }
      },
      ViewColumn: { One: 1 },
    };

    const mockContext = { subscriptions: [] };

    // 3. Test activate & command registration
    await ext.activate(mockContext, mockVsCode);
    assert.ok(registeredCommands.has('evo.openWorkbench'));
    assert.ok(registeredCommands.has('evo.viewCockpit'));
    assert.ok(mockContext.subscriptions.length >= 2);

    // 4. Test opening workbench panel via registered command
    const openWorkbenchFn = registeredCommands.get('evo.openWorkbench');
    assert.ok(openWorkbenchFn);
    await openWorkbenchFn!();
    assert.ok(createdPanel, 'WebviewPanel must be created');
    assert.equal(createdPanel.title, 'EvoKernel Workbench');
    assert.ok(createdPanel.webview.html.includes('id="workbench-root"'));
    assert.equal(ext.getActivePanel(), createdPanel);

    // 5. Test deactivate
    ext.deactivate();
    assert.equal(ext.getActivePanel(), undefined);

    // 6. Test in-process handleWebviewAction
    // Action 1: open-editor
    const openRes = await ext.handleWebviewAction('open-editor', { filePath: 'src/index.ts', line: 1 }, ws, mockVsCode);
    assert.equal(openRes.ok, true);
    assert.ok(showedDoc);

    // Traversal rejection
    const travRes = await ext.handleWebviewAction('open-editor', { filePath: '../../secret.txt' }, ws, mockVsCode);
    assert.equal(travRes.ok, false);
    assert.ok(travRes.error.includes('Forbidden'));

    // Action 2: verify-memory
    const memRes = await ext.handleWebviewAction('verify-memory', { id: 'ide-mem' }, ws, mockVsCode);
    assert.equal(memRes.ok, true);
    assert.equal(memRes.data.verifiedCount, 1);

    // Action 3: run-tool-test
    const toolRes = await ext.handleWebviewAction('run-tool-test', { id: 'ide-tool' }, ws, mockVsCode);
    assert.equal(toolRes.ok, true);
    assert.equal(toolRes.result.exitCode, 0);

    // Action 3b: update-content routes through Gatekeeper and rejects failing tool --self-test
    const badToolUpdate = await ext.handleWebviewAction(
      'update-content',
      {
        kind: 'tool',
        id: 'ide-tool',
        content: 'if (process.argv.includes("--self-test")) { console.error("FAIL"); process.exit(1); }\n',
      },
      ws,
      mockVsCode
    );
    assert.equal(badToolUpdate.ok, false);
    assert.equal(badToolUpdate.code, 'ERR_SANDBOX_SELF_TEST');

    // Action 4: unknown action
    const unknownRes = await ext.handleWebviewAction('invalid', {}, ws, mockVsCode);
    assert.equal(unknownRes.ok, false);

    // 7. Test mountIdeExtensions & opt-in mounting on runInit
    const fakeIdeDir = createTempDir('fake-ide-ext');
    const oldIdeEnv = process.env.EVO_IDE_EXTENSIONS_DIR;
    process.env.EVO_IDE_EXTENSIONS_DIR = fakeIdeDir;

    try {
      // Test mountIdeExtensions directly
      const mountRes = mountIdeExtensions(ws);
      assert.ok(Array.isArray(mountRes), 'MountIdeResult must be an array');
      assert.ok(Array.isArray(mountRes.mounts), 'MountIdeResult.mounts must be an array');
      assert.ok(typeof mountRes.totalMounted === 'number');
      assert.equal(mountRes.length, 1);
      assert.equal(mountRes[0].status, 'installed');

      // Test non-circularity: JSON.stringify must succeed without throwing circular structure error
      assert.doesNotThrow(() => {
        const json = JSON.stringify(mountRes);
        assert.ok(json.startsWith('['));
      }, 'MountIdeResult must be non-circular and JSON-serializable');

      // Test idempotency: re-mounting returns already-mounted / skipped
      const remountRes = mountIdeExtensions(ws);
      assert.equal(remountRes[0].status, 'skipped');

      // Test forceCopy overrides existing junction/symlink and replaces with file copy
      const forceCopyRes = mountIdeExtensions(ws, { forceCopy: true });
      assert.equal(forceCopyRes[0].method, 'copy');
      assert.equal(forceCopyRes[0].status, 'updated');

      // Test opt-in IDE mounting in runInit (Issue #26: default does NOT mount IDE extensions)
      const initWs = createTempDir('init-auto-ide');
      try {
        const initRes = runInit(initWs, ['claude']);
        assert.equal(initRes.ideMounts, undefined, 'Default runInit must NOT mount IDE extensions');

        const optInRes = runInit(initWs, { installIde: true, targets: ['claude'] });
        assert.ok(optInRes.ideMounts && optInRes.ideMounts.length >= 1, 'Explicit installIde: true must mount IDE extensions');

        // Test skipping via noIde: true
        const noIdeRes = runInit(initWs, { installIde: true, noIde: true, targets: ['claude'] });
        assert.equal(noIdeRes.ideMounts, undefined);
      } finally {
        fs.rmSync(initWs, { recursive: true, force: true });
      }
    } finally {
      if (oldIdeEnv !== undefined) process.env.EVO_IDE_EXTENSIONS_DIR = oldIdeEnv;
      else delete process.env.EVO_IDE_EXTENSIONS_DIR;
      fs.rmSync(fakeIdeDir, { recursive: true, force: true });
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('23. Issue #22 Regression: Test environment GUI/home isolation & CI npm publish idempotency guard', () => {
    // 1. isTestEnvironment() returns true under node:test
    assert.equal(isTestEnvironment(), true, 'isTestEnvironment must detect node:test context');

    // 2. launchDefaultBrowser & launchNativeDesktopWindow return true without spawning external processes in test mode
    assert.equal(launchDefaultBrowser('http://127.0.0.1:4310/'), true);
    assert.equal(launchNativeDesktopWindow('http://127.0.0.1:4310/'), true);

    // 3. mountIdeExtensions without EVO_IDE_EXTENSIONS_DIR does not pollute ~/.vscode/extensions or ~/.cursor/extensions
    const ws = createTempDir('issue22-home-guard');
    const savedEnv = process.env.EVO_IDE_EXTENSIONS_DIR;
    delete process.env.EVO_IDE_EXTENSIONS_DIR;
    try {
      const res = mountIdeExtensions(ws);
      assert.equal(res.length, 0, 'mountIdeExtensions must not touch real home IDE dirs during node:test');
      assert.equal(res.totalMounted, 0);
    } finally {
      if (savedEnv !== undefined) process.env.EVO_IDE_EXTENSIONS_DIR = savedEnv;
      fs.rmSync(ws, { recursive: true, force: true });
    }

    // 4. .github/workflows/publish.yml has concurrency group, stdout-verified npm view idempotency check, and tag-guarded GitHub Release automation
    const publishYmlPath = path.resolve(process.cwd(), '.github', 'workflows', 'publish.yml');
    const publishYml = fs.readFileSync(publishYmlPath, 'utf8');
    assert.ok(publishYml.includes('concurrency:'), 'publish.yml must define concurrency group');
    assert.ok(publishYml.includes('group: npm-publish'), 'publish.yml must use npm-publish concurrency group');
    assert.ok(publishYml.includes('npm view "evo-kernel@$PKG_VERSION" version'), 'publish.yml must check npm registry before publishing');
    assert.ok(!publishYml.includes('if npm view "evo-kernel@$PKG_VERSION" version >/dev/null'), 'publish.yml must not rely on bare npm view exit code (npm exits 0 with empty stdout for missing versions)');
    assert.ok(publishYml.includes('PUBLISHED_VER=') && publishYml.includes('"$PUBLISHED_VER" = "$PKG_VERSION"'), 'publish.yml must compare trimmed npm view stdout against PKG_VERSION');
    assert.ok(publishYml.includes('contents: write'), 'publish.yml must request contents: write to publish GitHub Releases');
    assert.ok(publishYml.includes('gh release create "$TAG_NAME"') && publishYml.includes('if gh release view "$TAG_NAME"'), 'publish.yml must create GitHub Releases idempotently for v* tag pushes');
  });

  test('24. Issue #23 Regression: Flexbox text overflow protection, AST symbol deduplication, and CJK visual truncation', () => {
    const ws = createTempDir('issue23-layout');
    try {
      const snap = buildUiSnapshot(ws, false);
      const html = renderUiClientHtml(snap, { token: 'tok', isExport: false });

      // 1. Topbar workspace path flex child truncation & middle-truncation helper
      assert.ok(html.includes('.workspace-pill .ws-path'), 'Must define .workspace-pill .ws-path CSS rule');
      assert.ok(html.includes('formatWorkspaceDisplayPath'), 'Must include middle-truncation helper for workspace path');

      // 2. Inspector AST Anchor card symbol deduplication & flex child truncation
      assert.ok(html.includes('.ast-anchor-file'), 'Must define .ast-anchor-file CSS rule');
      assert.ok(html.includes('.ast-anchor-symbol'), 'Must define .ast-anchor-symbol CSS rule');
      assert.ok(html.includes("rawSym.split('#').slice(1).join('#')"), 'Must strip duplicate file_path prefix from anchor.symbol');

      // 3. Topology right-column deduplication, bare symbol file_path resolution, SVG clipPath, ast_hash fallback, and CJK visual width truncation
      assert.ok(html.includes('if (fileOnly) rightFileSet[fileOnly] = canonicalSym;'), 'Must deduplicate topology source nodes by fileOnly & canonicalSym');
      assert.ok(html.includes('topo-card-clip'), 'Must define SVG clipPath #topo-card-clip to prevent card text overflow');
      assert.ok(html.includes('fpEntry.ast_hash || fpEntry.structural_hash'), 'Must fall back to ast_hash when topology anchors are empty');
      assert.ok(html.includes('function truncateVisual('), 'Must define CJK-aware truncateVisual helper');
      assert.ok(html.includes('function truncateVisualTail('), 'Must define CJK-aware truncateVisualTail helper');

      // 4. Capabilities table, inline action buttons, & Diagnostics banner CSS guards
      assert.ok(!html.includes('max-width: 360px;'), '.item-main-title must not hardcode 360px cap');
      assert.ok(html.includes('.badge-status.badge-scoped'), 'Must cap .badge-scoped width with ellipsis');
      assert.ok(html.includes('.scoped-glob-text'), 'Must define .scoped-glob-text truncation CSS rule');
      assert.ok(html.includes('.item-title-line'), 'Must define .item-title-line flex layout CSS rule');
      assert.ok(html.includes('.row-actions-wrap'), 'Must define .row-actions-wrap horizontal flex layout CSS rule');
      assert.ok(html.includes('.diag-chip {'), 'Must define .diag-chip CSS rule matching rendered Health Diagnostics chips');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('25. Issue #24 Regression: 3-state capability lifecycle (active/paused/archived), review approval, AST re-binding, and Webview non-blocking Undo Toast', async () => {
    const ws = createTempDir('issue24-governance');
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();

    // Create a core rule with review_status: 'pending'
    storage.saveRule({
      id: 'gov-core-rule',
      title: 'When editing UI templates -> Avoid window.confirm -> Use non-blocking Undo Toast',
      l0_summary: 'Avoid window.confirm in IDE Webviews; use inline Undo Toast instead.',
      scope_glob: 'src/templates/**/*.ts',
      content: 'Always use non-blocking Undo Toast in IDE Webviews.',
      core: true,
      enabled: true,
      review_status: 'pending',
      priority: 10,
      tokens: 28,
      origin: 'session',
      created_at: '2026-11-06T00:00:00.000Z',
      updated_at: '2026-11-06T00:00:00.000Z',
    });

    // Create a memory targeting a source file that we will modify (causing STALE drift)
    const srcDir = path.join(ws, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const srcFile = path.join(srcDir, 'calc.ts');
    fs.writeFileSync(srcFile, 'export function computeTax(x: number) { return x * 0.1; }\n', 'utf8');

    storage.saveMemory({
      id: 'gov-stale-mem',
      title: 'Tax rounding drift in computeTax',
      l0_summary: 'When calculating tax -> float precision drift -> round to 2 decimals',
      symptom: 'Float drift',
      root_cause: 'Unrounded multiplication',
      solution: 'Use Math.round',
      created_commit: 'oldcommit',
      target_symbols: ['src/calc.ts#computeTax'],
      ast_fingerprints: {
        'src/calc.ts#computeTax': {
          symbol: 'src/calc.ts#computeTax',
          file_path: 'src/calc.ts',
          signature: 'export function computeTax(x: number)',
          ast_hash: 'stale_old_hash_000',
        },
      },
      enabled: true,
      review_status: 'pending',
      tags: ['tax'],
      origin: 'session',
      created_at: '2026-11-06T00:00:00.000Z',
      updated_at: '2026-11-06T00:00:00.000Z',
    });

    const instance = await startUiServer(ws, { port: 0 });
    const telemetry = new EvoTelemetry(storage);
    const postAction = (payload: any) =>
      new Promise<{ status: number; body: any }>((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = http.request(
          `http://127.0.0.1:${instance.port}/api/action`,
          {
            method: 'POST',
            headers: {
              'X-Evo-UI-Token': instance.token,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            },
          },
          (res) => {
            let resBody = '';
            res.on('data', (c) => (resBody += c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: JSON.parse(resBody) }));
          }
        );
        req.on('error', reject);
        req.write(data);
        req.end();
      });

    try {
      // 1. Verify zero window.confirm( and zero undefined i18n keys / 'memorie' typo in rendered UI client HTML
      const snap0 = buildUiSnapshot(ws, false);
      const html = renderUiClientHtml(snap0, { token: instance.token, isExport: false });
      assert.equal(html.includes('confirm('), false, 'UI client must never use blocking window.confirm()');
      assert.ok(html.includes('archiveAndOfferUndo'), 'UI client must use archiveAndOfferUndo with Undo Toast');
      assert.ok(html.includes('tldr-card'), 'UI client must render plain-spoken TL;DR takeaway card');
      for (const badKey of ['dict.pausedBadge', 'dict.pendingBadge', 'dict.approveBtn', 'dict.enableBtn', 'dict.pauseBtn', 'dict.rebindAstBtn']) {
        assert.equal(html.includes(badKey), false, `UI client must not reference undefined i18n key ${badKey}`);
      }
      assert.ok(html.includes('staleBannerText:'), 'i18n dictionary must define staleBannerText');
      assert.equal(html.includes("kind: kind.replace(/s$/, '')"), false, 'Inspector actions must use singularKind(kind) so memories do not become "memorie"');

      // 2. Verify active core rule contributes to token budget & search
      const activeTokens = storage.getCoreRulesTokenUsage().totalTokens;
      assert.ok(activeTokens > 0, 'Active core rule must count toward token budget');
      const searchBefore = telemetry.search('window.confirm');
      assert.ok(searchBefore.some((r) => r.id === 'gov-core-rule'), 'Active rule must appear in search');

      // 3. Pause the core rule via toggle-enabled -> token budget drops to 0 and excluded from search
      const pauseRes = await postAction({
        action: 'toggle-enabled',
        params: { kind: 'rule', id: 'gov-core-rule', enabled: false },
      });
      assert.equal(pauseRes.status, 200);
      assert.equal(pauseRes.body.ok, true);
      assert.equal(storage.getCoreRulesTokenUsage().totalTokens, 0, 'Paused core rule must not consume Core Rule Token Budget');
      const searchPaused = telemetry.search('window.confirm');
      assert.equal(searchPaused.some((r) => r.id === 'gov-core-rule'), false, 'Paused rule must be excluded from evo_search');

      // Re-enable the core rule
      const enableRes = await postAction({
        action: 'toggle-enabled',
        params: { kind: 'rule', id: 'gov-core-rule', enabled: true },
      });
      assert.equal(enableRes.status, 200);
      assert.equal(storage.getCoreRulesTokenUsage().totalTokens, activeTokens);

      // 4. Approve all pending items via approve-item { approveAll: true }
      const approveRes = await postAction({
        action: 'approve-item',
        params: { approveAll: true },
      });
      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.body.ok, true);
      assert.equal(approveRes.body.data.approvedCount, 2);
      assert.equal(storage.getRule('gov-core-rule')?.review_status, 'approved');
      assert.equal(storage.getMemory('gov-stale-mem')?.review_status, 'approved');

      // 5. Re-bind STALE memory AST fingerprint to current code via rebind-memory-ast
      const rebindRes = await postAction({
        action: 'rebind-memory-ast',
        params: { id: 'gov-stale-mem' },
      });
      assert.equal(rebindRes.status, 200);
      assert.equal(rebindRes.body.ok, true);
      const reboundMem = rebindRes.body.snapshot.memories.find((m: any) => m.id === 'gov-stale-mem');
      assert.equal(reboundMem.freshness.overall_status, 'VERIFIED', 'Memory must become VERIFIED after re-binding AST');

      // 5b. If target symbol is deleted from source code, rebind-memory-ast must return 400 ERR_MISSING_AST_SYMBOL
      fs.writeFileSync(srcFile, 'export function otherFn(x: number) { return x; }\n', 'utf8');
      const missingSymRebind = await postAction({
        action: 'rebind-memory-ast',
        params: { id: 'gov-stale-mem' },
      });
      assert.equal(missingSymRebind.status, 400);
      assert.equal(missingSymRebind.body.code, 'ERR_MISSING_AST_SYMBOL');

      // 5c. Body-only update-content from Right Inspector inline editor preserves YAML frontmatter metadata
      const editBodyRes = await postAction({
        action: 'update-content',
        params: {
          kind: 'rule',
          id: 'gov-core-rule',
          content: 'Updated body from inline editor without frontmatter.',
        },
      });
      assert.equal(editBodyRes.status, 200);
      const updatedRule = storage.getRule('gov-core-rule');
      assert.equal(updatedRule?.content, 'Updated body from inline editor without frontmatter.');
      assert.equal(updatedRule?.title, 'When editing UI templates -> Avoid window.confirm -> Use non-blocking Undo Toast');
      assert.equal(updatedRule?.l0_summary, 'Avoid window.confirm in IDE Webviews; use inline Undo Toast instead.');
      assert.equal(updatedRule?.scope_glob, 'src/templates/**/*.ts');

      // 6. Archive and then restore via restore-item (Undo Toast flow), including multi-file skill directory with pending status
      storage.saveSkill({
        id: 'multi-file-skill',
        name: 'Multi File Skill',
        description: 'Skill with sibling scripts directory',
        trigger_phrases: ['multi file'],
        l1_contract: 'Contract',
        l2_sop: 'SOP',
        enabled: false,
        review_status: 'pending',
        origin: 'session',
        created_at: '2026-11-06T00:00:00.000Z',
        updated_at: '2026-11-06T00:00:00.000Z',
      });
      const skillHelperDir = path.join(ws, '.evo', 'skills', 'multi-file-skill', 'scripts');
      fs.mkdirSync(skillHelperDir, { recursive: true });
      fs.writeFileSync(path.join(skillHelperDir, 'helper.mjs'), 'export const HELPER = 42;\n', 'utf8');

      const archSkillRes = await postAction({
        action: 'archive-item',
        params: { kind: 'skill', id: 'multi-file-skill' },
      });
      assert.equal(archSkillRes.status, 200);
      assert.equal(storage.getSkill('multi-file-skill'), null);
      assert.equal(fs.existsSync(path.join(ws, '.evo', 'skills', 'multi-file-skill')), false);

      const restoreSkillRes = await postAction({
        action: 'restore-item',
        params: { kind: 'skill', id: 'multi-file-skill' },
      });
      assert.equal(restoreSkillRes.status, 200);
      const restoredSkill = storage.getSkill('multi-file-skill');
      assert.ok(restoredSkill, 'Multi-file skill must be restored');
      assert.equal(restoredSkill?.enabled, false, 'Restored skill must preserve enabled: false state');
      assert.equal(restoredSkill?.review_status, 'pending', 'Restored skill must preserve review_status: pending');
      assert.equal(
        fs.readFileSync(path.join(skillHelperDir, 'helper.mjs'), 'utf8'),
        'export const HELPER = 42;\n',
        'Restored skill must preserve sibling files in subdirectories'
      );
    } finally {
      telemetry.close();
      await instance.close();
      try {
        fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Ignore transient Windows fs.watch handle release delay
      }
    }
  });

  test('26. [Defect #1 Regression] buildUiSnapshot extracts contested_count and telemetry attribution for rules, tools, and memories', () => {
    const ws = createTempDir('ui-attribution-test');
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // 1. Create rule, tool, memory
      storage.saveRule({
        id: 'helped-rule',
        title: 'Helped Invariant Rule',
        l0_summary: 'Ensure invariant stability',
        scope_glob: 'src/**/*.ts',
        core: false,
        priority: 10,
        tags: ['test'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        content: 'Helped rule content body.',
      });

      storage.saveTool(
        {
          id: 'hurt-tool',
          title: 'Hurt Diagnostic Tool',
          l0_summary: 'Diagnose workspace metrics',
          runtime: 'node',
          description: 'Hurt tool desc',
          parameters: { type: 'object', properties: {} },
        },
        'process.exit(0);\n'
      );

      storage.saveMemory({
        id: 'contested-mem',
        title: 'Contested Bug Resolution',
        l0_summary: 'Resolve race condition',
        symptom: 'Deadlock on worker thread',
        root_cause: 'Missing mutex release',
        solution: 'Use scoped lock guard',
        target_symbols: [],
        ast_fingerprints: {},
        tags: ['test'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // 2. Initialize real telemetry instance to create actual schema & record usage/outcomes
      const telemetry = new EvoTelemetry(storage);
      try {
        telemetry.syncFromDisk(true);

        // Record usage and outcomes
        telemetry.recordUsage('helped-rule', true);
        telemetry.recordUsage('helped-rule', true);
        telemetry.recordCapabilityOutcome('helped-rule', 'helped');

        telemetry.recordUsage('hurt-tool', false);
        telemetry.recordCapabilityOutcome('hurt-tool', 'hurt');

        telemetry.recordUsage('contested-mem', true);
        telemetry.recordCapabilityOutcome('contested-mem', 'contested');
      } finally {
        telemetry.close();
      }

      // 3. buildUiSnapshot must extract exact hit_count and attribution without falling back to 0 or unverified
      const snapshot = buildUiSnapshot(ws);

      const ruleItem = snapshot.rules.find((r: any) => r.id === 'helped-rule');
      assert.ok(ruleItem, 'helped-rule must exist in snapshot');
      assert.equal(ruleItem.hit_count, 2, 'helped-rule must have hit_count === 2');
      assert.equal(ruleItem.attribution, 'helped', 'helped-rule attribution must be helped');

      const toolItem = snapshot.tools.find((t: any) => t.id === 'hurt-tool');
      assert.ok(toolItem, 'hurt-tool must exist in snapshot');
      assert.equal(toolItem.hit_count, 1, 'hurt-tool must have hit_count === 1');
      assert.equal(toolItem.attribution, 'hurt', 'hurt-tool attribution must be hurt');

      const memItem = snapshot.memories.find((m: any) => m.id === 'contested-mem');
      assert.ok(memItem, 'contested-mem must exist in snapshot');
      assert.equal(memItem.hit_count, 1, 'contested-mem must have hit_count === 1');
      assert.equal(memItem.attribution, 'contested', 'contested-mem attribution must be contested');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('27. [Defect #5 Regression] syncManagedRuleBlocks byte-idempotent write guard avoids updating mtimeMs on unchanged files', () => {
    const ws = createTempDir('sync-idempotent-test');
    try {
      const claudeMdPath = path.join(ws, 'CLAUDE.md');
      const agentsMdPath = path.join(ws, 'AGENTS.md');
      const opencodeJsonPath = path.join(ws, 'opencode.json');

      fs.writeFileSync(
        claudeMdPath,
        '# Claude Rules\n<!-- EVO:START -->\n<!-- EVO:END -->\n',
        'utf8'
      );
      fs.writeFileSync(
        agentsMdPath,
        '# Agents Rules\n<!-- EVO:START -->\n<!-- EVO:END -->\n',
        'utf8'
      );
      fs.writeFileSync(
        opencodeJsonPath,
        JSON.stringify(
          { instructions: '# OpenCode\n<!-- EVO:START -->\n<!-- EVO:END -->\n' },
          null,
          2
        ) + '\n',
        'utf8'
      );

      // First sync to establish steady state
      syncManagedRuleBlocks(ws);

      // Set mtimeMs to 60 seconds in the past
      const pastDate = new Date(Date.now() - 60000);
      fs.utimesSync(claudeMdPath, pastDate, pastDate);
      fs.utimesSync(agentsMdPath, pastDate, pastDate);
      fs.utimesSync(opencodeJsonPath, pastDate, pastDate);

      const claudeStatBefore = fs.statSync(claudeMdPath);
      const agentsStatBefore = fs.statSync(agentsMdPath);
      const opencodeStatBefore = fs.statSync(opencodeJsonPath);

      // Second sync with no rule/tool/skill changes
      const syncedAgain = syncManagedRuleBlocks(ws);
      assert.ok(Array.isArray(syncedAgain));

      const claudeStatAfter = fs.statSync(claudeMdPath);
      const agentsStatAfter = fs.statSync(agentsMdPath);
      const opencodeStatAfter = fs.statSync(opencodeJsonPath);

      assert.equal(
        claudeStatAfter.mtimeMs,
        claudeStatBefore.mtimeMs,
        'CLAUDE.md mtimeMs must not change on idempotent sync'
      );
      assert.equal(
        agentsStatAfter.mtimeMs,
        agentsStatBefore.mtimeMs,
        'AGENTS.md mtimeMs must not change on idempotent sync'
      );
      assert.equal(
        opencodeStatAfter.mtimeMs,
        opencodeStatBefore.mtimeMs,
        'opencode.json mtimeMs must not change on idempotent sync'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('28. [Issue #27 Item 2] handleWebviewAction update-content frontmatter parity and memory created_commit/created_branch preservation', async () => {
    const ws = createTempDir('vscode-update-parity');
    try {
      // 1. Initialize git repo and create a source file
      spawnSync('git', ['init'], { cwd: ws });
      spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: ws });
      spawnSync('git', ['config', 'user.name', 'Tester'], { cwd: ws });

      const srcDir = path.join(ws, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'calc.ts'),
        'export function calc(x: number) { return x * 2; }\n',
        'utf8'
      );
      spawnSync('git', ['add', '.'], { cwd: ws });
      spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: ws });

      const storage = new EvoStorage(ws);
      storage.ensureInitialized();

      // 2. Create memory with explicit created_commit & created_branch
      const oldCommit = 'abc1234567890abcdef1234567890abcdef1234';
      const oldBranch = 'feature/legacy-anchor';
      storage.saveMemory({
        id: 'parity-mem',
        title: 'Initial Memory Title',
        l0_summary: 'Initial L0 summary for memory',
        symptom: 'Calculation overflow on large input',
        root_cause: 'Missing boundary check in calc',
        solution: 'Clamp input values before multiplying',
        target_symbols: ['calc'],
        ast_fingerprints: {},
        tags: ['math', 'overflow'],
        created_commit: oldCommit,
        created_branch: oldBranch,
        enabled: true,
        review_status: 'pending',
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // 3. Create skill with initial metadata
      storage.saveSkill({
        id: 'parity-skill',
        name: 'Parity Skill',
        title: 'Parity Skill',
        description: 'Initial skill description',
        l0_summary: 'Initial skill L0',
        trigger_phrases: ['run parity'],
        trigger_cue: 'Initial trigger cue',
        confidence: 'low',
        contrastive_evidence: 'src/calc.ts:calc evidence',
        l1_contract: 'Initial L1 contract details',
        l2_sop: 'Initial L2 SOP details',
        enabled: true,
        review_status: 'pending',
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // 4. Create second git commit so HEAD advances
      fs.writeFileSync(path.join(ws, 'second.txt'), 'advance commit\n', 'utf8');
      spawnSync('git', ['add', '.'], { cwd: ws });
      spawnSync('git', ['commit', '-m', 'Second commit'], { cwd: ws });
      const secondCommit = resolveCurrentGitCommit(ws);
      assert.notEqual(secondCommit, oldCommit);

      // 5. Update Memory via handleWebviewAction with frontmatter edits and solution update
      const memUpdateContent = [
        '---',
        'enabled: false',
        'review_status: approved',
        'tags: ["math", "clamping", "hardened"]',
        'target_symbols: ["calc"]',
        '---',
        '## Symptom',
        'Calculation overflow on large input',
        '## Root Cause',
        'Missing boundary check in calc',
        '## Solution',
        'Use Math.min and Math.max to clamp input values securely.',
      ].join('\n');

      const memUpdateRes = await handleWebviewAction(
        'update-content',
        {
          kind: 'memory',
          id: 'parity-mem',
          content: memUpdateContent,
        },
        ws
      );
      assert.equal(memUpdateRes.ok, true, memUpdateRes.error);

      const updatedMem = storage.getMemory('parity-mem');
      assert.ok(updatedMem, 'Memory must exist after update');
      assert.equal(updatedMem.enabled, false, 'Frontmatter enabled: false must be preserved');
      assert.equal(updatedMem.review_status, 'approved', 'Frontmatter review_status: approved must be preserved');
      assert.deepEqual(updatedMem.tags, ['math', 'clamping', 'hardened'], 'Frontmatter tags array must be preserved');
      assert.deepEqual(updatedMem.target_symbols, ['calc'], 'Target symbols must be preserved');
      assert.equal(
        updatedMem.solution,
        'Use Math.min and Math.max to clamp input values securely.',
        'Solution text must be updated'
      );
      assert.equal(
        updatedMem.created_commit,
        oldCommit,
        'created_commit must be preserved when target_symbols are unchanged'
      );
      assert.equal(
        updatedMem.created_branch,
        oldBranch,
        'created_branch must be preserved when target_symbols are unchanged'
      );

      // 6. Update Skill via handleWebviewAction with frontmatter edits
      const skillUpdateContent = [
        '---',
        'enabled: false',
        'review_status: approved',
        'trigger_cue: Execute hardened arithmetic verification workflow',
        'confidence: high',
        'contrastive_evidence: src/calc.ts:calc hardened boundary pattern',
        '---',
        '## L1 Contract',
        'Hardened contract for numeric calculation.',
        '## L2 SOP',
        '1. Verify inputs.\n2. Execute bounded calculation.',
      ].join('\n');

      const skillUpdateRes = await handleWebviewAction(
        'update-content',
        {
          kind: 'skill',
          id: 'parity-skill',
          content: skillUpdateContent,
        },
        ws
      );
      assert.equal(skillUpdateRes.ok, true, skillUpdateRes.error);

      const updatedSkill = storage.getSkill('parity-skill');
      assert.ok(updatedSkill, 'Skill must exist after update');
      assert.equal(updatedSkill.enabled, false, 'Skill enabled: false must be preserved');
      assert.equal(updatedSkill.review_status, 'approved', 'Skill review_status: approved must be preserved');
      assert.equal(
        updatedSkill.trigger_cue,
        'Execute hardened arithmetic verification workflow',
        'Skill trigger_cue must be preserved'
      );
      assert.equal(updatedSkill.confidence, 'high', 'Skill confidence must be preserved');
      assert.equal(
        updatedSkill.contrastive_evidence,
        'src/calc.ts:calc hardened boundary pattern',
        'Skill contrastive_evidence must be preserved'
      );
      assert.equal(
        updatedSkill.l1_contract,
        'Hardened contract for numeric calculation.',
        'Skill L1 contract must be updated'
      );
      assert.equal(
        updatedSkill.l2_sop,
        '1. Verify inputs.\n2. Execute bounded calculation.',
        'Skill L2 SOP must be updated'
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('31. IDE extension manifest parity, extensions.json/.obsolete sync, --unmount-ide isolation, and Webview export/reject snapshot', async () => {
    const extPkgPath = path.resolve(process.cwd(), 'templates', 'ide-extension', 'package.json');
    const extPkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
    assert.equal(extPkg.version, EVO_KERNEL_VERSION, 'IDE extension version must match EVO_KERNEL_VERSION');
    assert.ok(Array.isArray(extPkg.activationEvents));
    assert.equal(
      extPkg.activationEvents.includes('onStartupFinished'),
      false,
      'IDE extension must not register heavy onStartupFinished activation'
    );

    const ws = createTempDir('ide-registry-sync');
    const fakeExtDir = createTempDir('fake-vscode-extensions');
    const oldIdeEnv = process.env.EVO_IDE_EXTENSIONS_DIR;

    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      storage.saveRule({
        id: 'ui-reject-rule',
        title: 'Clean UI Rule',
        l0_summary: 'Validate boundary invariants cleanly.',
        scope_glob: '**/*.ts',
        core: false,
        priority: 10,
        tokens: 15,
        content: '- Always validate boundary invariants cleanly across services.\n',
        tags: ['ui'],
        origin: 'session',
        enabled: true,
        review_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Seed stale extensions.json & .obsolete BEFORE mountIdeExtensions
      fs.writeFileSync(path.join(fakeExtDir, 'extensions.json'), '[]\n', 'utf8');
      fs.writeFileSync(
        path.join(fakeExtDir, '.obsolete'),
        JSON.stringify({ 'damonless.evo-kernel-cockpit': true }, null, 2),
        'utf8'
      );
      process.env.EVO_IDE_EXTENSIONS_DIR = fakeExtDir;

      const mountRes = mountIdeExtensions(ws);
      assert.equal(mountRes.length, 1);

      const mountedFolder = path.join(fakeExtDir, 'damonless.evo-kernel-cockpit');
      assert.ok(fs.existsSync(path.join(mountedFolder, 'package.json')), 'Mounted package.json must exist');
      assert.ok(fs.existsSync(path.join(mountedFolder, 'README.md')), 'Mounted README.md must exist');

      const regAfterMount = JSON.parse(fs.readFileSync(path.join(fakeExtDir, 'extensions.json'), 'utf8'));
      assert.ok(
        Array.isArray(regAfterMount) &&
          regAfterMount.some((e: any) => e?.identifier?.id === 'damonless.evo-kernel-cockpit'),
        'extensions.json must register damonless.evo-kernel-cockpit'
      );

      const obsoleteAfterMount = JSON.parse(fs.readFileSync(path.join(fakeExtDir, '.obsolete'), 'utf8'));
      assert.equal(
        'damonless.evo-kernel-cockpit' in obsoleteAfterMount,
        false,
        '.obsolete tombstone for damonless.evo-kernel-cockpit must be cleared'
      );

      // Default runUninstall (without unmountIde: true) must preserve IDE extension
      runUninstall(ws);
      assert.ok(fs.existsSync(mountedFolder), 'Default runUninstall must not unmount IDE extension');

      // Explicit runUninstall({ unmountIde: true }) or unmountIdeExtensions must remove & prune registry
      runUninstall(ws, { unmountIde: true });
      assert.equal(fs.existsSync(mountedFolder), false, 'unmountIde: true must remove mounted extension');
      const regAfterUnmount = JSON.parse(fs.readFileSync(path.join(fakeExtDir, 'extensions.json'), 'utf8'));
      assert.equal(
        regAfterUnmount.some((e: any) => e?.identifier?.id === 'damonless.evo-kernel-cockpit'),
        false,
        'extensions.json must prune damonless.evo-kernel-cockpit after unmount'
      );

      // Direct unmountIdeExtensions no-op safety check when already cleaned
      const secondUnmount = unmountIdeExtensions();
      assert.equal(secondUnmount.errors.length, 0);

      // Webview export-html action + traversal rejection
      const travExport = await handleWebviewAction('export-html', { outPath: '../outside.html' }, ws, {});
      assert.equal(travExport.ok, false);
      assert.match(travExport.error || '', /Forbidden/i);

      const okExport = await handleWebviewAction(
        'export-html',
        { outPath: 'exports/report.html', anon: true },
        ws,
        {}
      );
      assert.equal(okExport.ok, true, okExport.error);
      assert.ok(fs.existsSync(path.join(ws, 'exports', 'report.html')), 'Exported HTML must exist on disk');

      // Webview Gatekeeper rejection must include latest snapshot so UI refreshes cleanly
      const rejectedUpdate = await handleWebviewAction(
        'update-content',
        {
          kind: 'rule',
          id: 'ui-reject-rule',
          content:
            'Enforce dwTimeoutLimit = 4200mV and `wCellMaxVolt`, `s_chgCurrLimit`, `st_battFlag` across `MAX_CHG_RETRY_LIMIT`.',
        },
        ws,
        {}
      );
      assert.equal(rejectedUpdate.ok, false, 'Gatekeeper must reject domain-numeric rule edit');
      assert.ok(rejectedUpdate.snapshot, 'Rejected Webview update-content must still return latest snapshot');
    } finally {
      if (oldIdeEnv === undefined) {
        delete process.env.EVO_IDE_EXTENSIONS_DIR;
      } else {
        process.env.EVO_IDE_EXTENSIONS_DIR = oldIdeEnv;
      }
      fs.rmSync(ws, { recursive: true, force: true });
      fs.rmSync(fakeExtDir, { recursive: true, force: true });
    }
  });

  test('32. [Regression] VS Code resolveActiveWorkspaceRoot & activate resolve child .evo workspace when parent umbrella folder or git diff tab is open', async () => {
    const umbrellaDir = createTempDir('vscode-umbrella');
    const umbrellaDir2 = createTempDir('vscode-umbrella-d2');
    const externalDir = createTempDir('vscode-external');

    try {
      // Hollow .evo folder in parent directory must NOT fool hasValidEvoStructure
      fs.mkdirSync(path.join(umbrellaDir, '.evo'), { recursive: true });
      fs.writeFileSync(path.join(umbrellaDir, 'notes.md'), '# umbrella notes\n', 'utf8');

      const evoChild = path.join(umbrellaDir, 'EvoKernel');
      fs.mkdirSync(path.join(evoChild, 'src'), { recursive: true });
      fs.writeFileSync(path.join(evoChild, 'src', 'main.ts'), 'export const a = 1;\n', 'utf8');
      const s1 = new EvoStorage(evoChild);
      s1.ensureInitialized();
      s1.saveRule({
        id: 'umbrella-rule-a',
        title: 'Umbrella Rule A',
        l0_summary: 'First child rule',
        scope_glob: 'src/**/*.ts',
        core: false,
        priority: 10,
        tags: ['test'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        content: 'Enforce structured boundary checks across child modules.',
      });

      const secondChild = path.join(umbrellaDir, 'SecondRepo');
      fs.mkdirSync(path.join(secondChild, 'src'), { recursive: true });
      fs.writeFileSync(path.join(secondChild, 'src', 'index.ts'), 'export const b = 2;\n', 'utf8');
      const s2 = new EvoStorage(secondChild);
      s2.ensureInitialized();
      s2.saveRule({
        id: 'umbrella-rule-b',
        title: 'Umbrella Rule B',
        l0_summary: 'Second child rule',
        scope_glob: 'src/**/*.ts',
        core: false,
        priority: 10,
        tags: ['test'],
        origin: 'session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        content: 'Enforce isolated telemetry updates on workspace switch.',
      });

      // Depth-2 child workspace under umbrellaDir2/group/SubRepo
      const depth2Child = path.join(umbrellaDir2, 'group', 'SubRepo');
      fs.mkdirSync(depth2Child, { recursive: true });
      const s3 = new EvoStorage(depth2Child);
      s3.ensureInitialized();

      // 1. Git working-tree diff URI inside EvoKernel while parent umbrellaDir is open
      const gitDiffUri = {
        scheme: 'git',
        fsPath: '',
        query: JSON.stringify({
          path: path.join(evoChild, '.evo', 'memories', 'case.md'),
          ref: '~',
        }),
      };
      const resolvedGitDiff = resolveActiveWorkspaceRoot({
        window: { activeTextEditor: { document: { uri: gitDiffUri } } },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: umbrellaDir } }],
          getWorkspaceFolder: () => ({ uri: { fsPath: umbrellaDir } }),
        },
      });
      assert.equal(
        resolvedGitDiff,
        evoChild,
        'git: diff tab inside child repo must resolve to child EvoKernel instead of parent umbrella folder'
      );

      // 2. Unrelated loose file directly inside parent umbrellaDir must still descend to valid child EvoKernel
      const looseFileUri = {
        scheme: 'file',
        fsPath: path.join(umbrellaDir, 'notes.md'),
      };
      const resolvedLooseFile = resolveActiveWorkspaceRoot({
        window: { activeTextEditor: { document: { uri: looseFileUri } } },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: umbrellaDir } }],
          getWorkspaceFolder: () => ({ uri: { fsPath: umbrellaDir } }),
        },
      });
      assert.equal(
        resolvedLooseFile,
        evoChild,
        'Loose file in uninitialized parent umbrella folder must descend into valid child .evo instead of short-circuiting to hollow parent'
      );

      // 3. Depth-2 umbrella directory without active editor resolves to group/SubRepo
      const resolvedDepth2 = resolveActiveWorkspaceRoot({
        window: { activeTextEditor: undefined },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: umbrellaDir2 } }],
        },
      });
      assert.equal(resolvedDepth2, depth2Child, 'Depth-2 child .evo workspace must be discovered inside umbrella root');

      // 4. activate live switching: initial open -> external non-evo ignore -> switch to SecondRepo -> focus Webview (undefined editor)
      const extFile = path.join(externalDir, 'scratch.ts');
      fs.writeFileSync(extFile, 'export const z = 0;\n', 'utf8');

      const commands = new Map<string, () => Promise<void> | void>();
      const postedMessages: any[] = [];
      let activeEditorCb: ((e: any) => void) | undefined;
      let viewStateCb: ((e: any) => void) | undefined;
      let createdPanel: any;

      const mockVscode: any = {
        ViewColumn: { One: 1 },
        commands: {
          registerCommand(id: string, cb: () => Promise<void> | void) {
            commands.set(id, cb);
            return { dispose: () => {} };
          },
        },
        window: {
          activeTextEditor: {
            document: { uri: { scheme: 'file', fsPath: path.join(evoChild, 'src', 'main.ts') } },
          },
          onDidChangeActiveTextEditor(cb: (e: any) => void) {
            activeEditorCb = cb;
            return { dispose: () => {} };
          },
          createWebviewPanel(_viewType: string, _title: string, _col: number, _opts: any) {
            createdPanel = {
              visible: true,
              reveal() {},
              dispose() {},
              onDidDispose() {
                return { dispose: () => {} };
              },
              onDidChangeViewState(cb: (e: any) => void) {
                viewStateCb = cb;
                return { dispose: () => {} };
              },
              webview: {
                html: '',
                onDidReceiveMessage() {
                  return { dispose: () => {} };
                },
                async postMessage(msg: any) {
                  postedMessages.push(msg);
                  return true;
                },
              },
            };
            return createdPanel;
          },
        },
        workspace: {
          workspaceFolders: [{ uri: { fsPath: umbrellaDir } }],
          getWorkspaceFolder(uri: any) {
            const p = uri?.fsPath || '';
            if (p.startsWith(umbrellaDir)) return { uri: { fsPath: umbrellaDir } };
            return undefined;
          },
          onDidChangeWorkspaceFolders() {
            return { dispose: () => {} };
          },
        },
      };

      const context = { subscriptions: [] as any[] };
      await activate(context, mockVscode);

      const openHandler = commands.get('evo.openWorkbench');
      assert.ok(openHandler, 'evo.openWorkbench must be registered');
      await openHandler!();
      assert.ok(createdPanel, 'Webview panel must be created');
      assert.ok(
        String(createdPanel.webview.html).includes('umbrella-rule-a'),
        'Initial Workbench HTML must bind to child EvoKernel and include umbrella-rule-a'
      );

      // Switching to external non-Evo file must NOT clobber valid currentWs
      postedMessages.length = 0;
      mockVscode.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: extFile } } };
      mockVscode.workspace.workspaceFolders = [];
      activeEditorCb?.(mockVscode.window.activeTextEditor);
      assert.equal(
        postedMessages.length,
        0,
        'Switching to uninitialized external file must not overwrite valid active Evo workspace'
      );

      // Switching to SecondRepo file updates currentWs and pushes snapshot for SecondRepo
      mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: umbrellaDir } }];
      mockVscode.window.activeTextEditor = {
        document: { uri: { scheme: 'file', fsPath: path.join(secondChild, 'src', 'index.ts') } },
      };
      activeEditorCb?.(mockVscode.window.activeTextEditor);
      assert.equal(postedMessages.length, 1, 'Switching to SecondRepo editor must push snapshot');
      assert.equal(postedMessages[0].type, 'evoSnapshotPush');
      assert.ok(
        postedMessages[0].snapshot.rules.some((c: any) => c.id === 'umbrella-rule-b'),
        'Snapshot after editor switch must contain SecondRepo umbrella-rule-b'
      );

      // Focusing the Workbench Webview itself leaves activeTextEditor undefined; panel must keep SecondRepo
      postedMessages.length = 0;
      mockVscode.window.activeTextEditor = undefined;
      activeEditorCb?.(undefined);
      viewStateCb?.({ webviewPanel: { visible: true } });
      assert.equal(postedMessages.length, 1, 'ViewState refresh pushes snapshot');
      assert.ok(
        postedMessages[0].snapshot.rules.some((c: any) => c.id === 'umbrella-rule-b'),
        'Focusing Workbench Webview (undefined activeTextEditor) must preserve SecondRepo instead of flipping alphabetically to EvoKernel'
      );
    } finally {
      deactivate();
      try {
        fs.rmSync(umbrellaDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        fs.rmSync(umbrellaDir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        fs.rmSync(externalDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {}
    }
  });
});
