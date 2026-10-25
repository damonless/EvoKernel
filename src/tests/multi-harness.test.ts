import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findGitRoot,
  resolveGitDir,
  ensureGitInfoExclude,
  removeGitInfoExclude,
  parseInitTargets,
  runInit,
  runUninstall,
  syncManagedRuleBlocks,
} from '../cli/init.js';
import {
  ALL_HARNESS_ADAPTERS,
  detectCascadedTargets,
  parseHarnessTargets,
  removeCodexToml,
  removeClaudeSettings,
  removeMcpJson,
  removeOpenCode,
  upsertCodexToml,
  upsertClaudeSettings,
  upsertMdcFile,
  upsertMcpJson,
  upsertOpenCode,
} from '../cli/harness.js';
import { runAudit } from '../cli/audit.js';
import { EvoStorage } from '../core/storage.js';
import { META_RULE_MARKER_END, META_RULE_MARKER_START } from '../templates/meta-rule.js';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evo-multi-harness-ws-'));
}

describe('EvoKernel Multi-Agent Harness Matrix Suite (Milestone 2)', () => {
  test('1. Full Target Matrix Initialization across all 10 agent harnesses + agents with valid syntax', () => {
    const ws = createTempWorkspace();
    try {
      const allTargets = [
        'claude',
        'cursor',
        'windsurf',
        'cline',
        'roo',
        'copilot',
        'codex',
        'opencode',
        'gemini',
        'antigravity',
        'agents',
      ];
      const res = runInit(ws, allTargets);

      assert.deepEqual(res.initializedHarnesses.sort(), allTargets.sort());

      // 1. Verify Rule Files Exist
      const expectedRuleFiles = [
        'CLAUDE.md',
        '.cursor/rules/evo-kernel.mdc',
        '.windsurfrules',
        '.clinerules',
        '.roo/rules/evo-kernel.md',
        '.github/copilot-instructions.md',
        'AGENTS.md',
        'GEMINI.md',
        'opencode.json',
      ];
      for (const rf of expectedRuleFiles) {
        const full = path.join(ws, rf);
        assert.ok(fs.existsSync(full), `Expected rule file ${rf} to exist`);
      }

      // 2. Verify MCP Config Files Exist
      const expectedMcpFiles = [
        '.mcp.json',
        '.claude/settings.json',
        '.cursor/mcp.json',
        '.windsurf/mcp.json',
        '.cline/mcp.json',
        '.roo/mcp.json',
        '.vscode/mcp.json',
        '.codex/config.toml',
        'opencode.json',
        '.gemini/settings.json',
      ];
      for (const mf of expectedMcpFiles) {
        const full = path.join(ws, mf);
        assert.ok(fs.existsSync(full), `Expected MCP config file ${mf} to exist`);
      }

      // 3. Verify JSON Validity of All JSON MCP Configs
      const jsonConfigs = [
        '.mcp.json',
        '.cursor/mcp.json',
        '.windsurf/mcp.json',
        '.cline/mcp.json',
        '.roo/mcp.json',
        '.vscode/mcp.json',
        '.gemini/settings.json',
      ];
      for (const jf of jsonConfigs) {
        const full = path.join(ws, jf);
        const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
        assert.ok(parsed.mcpServers, `Expected mcpServers in ${jf}`);
        assert.ok(parsed.mcpServers['evo-kernel'], `Expected mcpServers['evo-kernel'] in ${jf}`);
        assert.equal(typeof parsed.mcpServers['evo-kernel'].command, 'string');
        assert.ok(Array.isArray(parsed.mcpServers['evo-kernel'].args));
      }

      // 4. Verify Claude Code settings.json Lifecycle Hooks
      const claudeSettings = JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'settings.json'), 'utf8'));
      assert.ok(claudeSettings.hooks, 'Expected hooks in .claude/settings.json');
      assert.ok(Array.isArray(claudeSettings.hooks['post-tool']));
      assert.ok(Array.isArray(claudeSettings.hooks['stop']));
      assert.ok(
        claudeSettings.hooks['post-tool'].some((h: { command: string }) => h.command.includes('hook post-tool')),
        'Expected hook post-tool command'
      );
      assert.ok(
        claudeSettings.hooks['stop'].some((h: { command: string }) => h.command.includes('hook stop')),
        'Expected hook stop command'
      );

      // 5. Verify OpenCode opencode.json Structure
      const opencode = JSON.parse(fs.readFileSync(path.join(ws, 'opencode.json'), 'utf8'));
      assert.equal(opencode.instructionsFile, 'AGENTS.md');
      assert.ok(opencode.mcp && opencode.mcp['evo-kernel']);
      assert.equal(typeof opencode.mcp['evo-kernel'].command, 'string');

      // 6. Verify Cursor MDC YAML Frontmatter
      const mdcContent = fs.readFileSync(path.join(ws, '.cursor', 'rules', 'evo-kernel.mdc'), 'utf8');
      assert.match(mdcContent, /^---\r?\n/);
      assert.match(mdcContent, /description:\s*EvoKernel/);
      assert.match(mdcContent, /globs:\s*\*\*\/\*/);
      assert.match(mdcContent, /alwaysApply:\s*true/);
      assert.match(mdcContent, /---\r?\n/);
      assert.match(mdcContent, /<!-- EVO:START -->/);
      assert.match(mdcContent, /<!-- EVO:END -->/);

      // 7. Verify Codex TOML Syntax
      const tomlContent = fs.readFileSync(path.join(ws, '.codex', 'config.toml'), 'utf8');
      assert.match(tomlContent, /\[mcp_servers\.evo-kernel\]/);
      assert.match(tomlContent, /command\s*=\s*"(node|npx)"/);
      assert.match(tomlContent, /args\s*=\s*\[/);

      // 8. Verify Markdown Delimiters in Rule Files
      const standardMarkdownRules = [
        'CLAUDE.md',
        '.windsurfrules',
        '.clinerules',
        '.roo/rules/evo-kernel.md',
        '.github/copilot-instructions.md',
        'AGENTS.md',
        'GEMINI.md',
      ];
      for (const smr of standardMarkdownRules) {
        const content = fs.readFileSync(path.join(ws, smr), 'utf8');
        assert.ok(content.includes(META_RULE_MARKER_START), `Expected start marker in ${smr}`);
        assert.ok(content.includes(META_RULE_MARKER_END), `Expected end marker in ${smr}`);
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('2. Non-Destructive Merging across Markdown, MDC, JSON, and TOML', () => {
    const ws = createTempWorkspace();
    try {
      // 1. Pre-seed Markdown with user content
      const claudePath = path.join(ws, 'CLAUDE.md');
      fs.writeFileSync(claudePath, '# My Custom Architecture Rules\nAlways prefer TypeScript over JavaScript.\n\n', 'utf8');

      // 2. Pre-seed Cursor MDC with custom frontmatter and notes
      const mdcPath = path.join(ws, '.cursor', 'rules', 'evo-kernel.mdc');
      fs.mkdirSync(path.dirname(mdcPath), { recursive: true });
      fs.writeFileSync(
        mdcPath,
        ['---', 'description: My Special MDC Rule', 'customTag: high-priority', 'globs: src/**/*.ts', '---', '', '# Developer Notes', 'Do not modify without review.', ''].join('\n'),
        'utf8'
      );

      // 3. Pre-seed JSON MCP with sibling servers and custom fields
      const mcpPath = path.join(ws, '.mcp.json');
      fs.writeFileSync(
        mcpPath,
        JSON.stringify(
          {
            mcpServers: {
              postgres: { command: 'docker', args: ['run', 'postgres'] },
            },
            theme: 'dark',
            customFlag: 42,
          },
          null,
          2
        ) + '\n',
        'utf8'
      );

      // 4. Pre-seed Codex TOML with other tables and comments
      const tomlPath = path.join(ws, '.codex', 'config.toml');
      fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
      fs.writeFileSync(
        tomlPath,
        [
          '# Top-level codex config comment',
          '[model]',
          'name = "o1-mini"',
          '',
          '[mcp_servers.sqlite]',
          'command = "sqlite3"',
          'args = ["db.sqlite"]',
          '',
        ].join('\n'),
        'utf8'
      );

      // 5. Pre-seed Claude settings.json with existing custom hooks
      const claudeSettingsPath = path.join(ws, '.claude', 'settings.json');
      fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
      fs.writeFileSync(
        claudeSettingsPath,
        JSON.stringify(
          {
            theme: 'light',
            hooks: {
              'post-tool': [{ command: 'echo user-post-tool-hook' }],
            },
          },
          null,
          2
        ) + '\n',
        'utf8'
      );

      // 6. Pre-seed OpenCode with existing custom instructions and theme
      const opencodePath = path.join(ws, 'opencode.json');
      fs.writeFileSync(
        opencodePath,
        JSON.stringify(
          {
            theme: 'nord',
            instructions: 'Always respond in valid JSON format.',
            mcp: {
              fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
            },
          },
          null,
          2
        ) + '\n',
        'utf8'
      );

      // Run runInit targeting these harnesses
      runInit(ws, ['claude', 'cursor', 'codex', 'opencode']);

      // Verification 1: Claude.md preserved custom header
      const claudeAfter = fs.readFileSync(claudePath, 'utf8');
      assert.match(claudeAfter, /# My Custom Architecture Rules/);
      assert.match(claudeAfter, /Always prefer TypeScript over JavaScript/);
      assert.match(claudeAfter, /<!-- EVO:START -->/);

      // Verification 2: Cursor MDC preserved custom frontmatter and notes
      const mdcAfter = fs.readFileSync(mdcPath, 'utf8');
      assert.match(mdcAfter, /description: My Special MDC Rule/);
      assert.match(mdcAfter, /customTag: high-priority/);
      assert.match(mdcAfter, /# Developer Notes/);
      assert.match(mdcAfter, /<!-- EVO:START -->/);

      // Verification 3: .mcp.json preserved sibling server and custom keys
      const mcpAfter = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      assert.equal(mcpAfter.theme, 'dark');
      assert.equal(mcpAfter.customFlag, 42);
      assert.ok(mcpAfter.mcpServers.postgres);
      assert.ok(mcpAfter.mcpServers['evo-kernel']);

      // Verification 4: Codex config.toml preserved comment, [model], and [mcp_servers.sqlite]
      const tomlAfter = fs.readFileSync(tomlPath, 'utf8');
      assert.match(tomlAfter, /# Top-level codex config comment/);
      assert.match(tomlAfter, /\[model\]/);
      assert.match(tomlAfter, /name = "o1-mini"/);
      assert.match(tomlAfter, /\[mcp_servers\.sqlite\]/);
      assert.match(tomlAfter, /\[mcp_servers\.evo-kernel\]/);

      // Verification 5: Claude settings preserved light theme and existing user hook
      const claudeSettingsAfter = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
      assert.equal(claudeSettingsAfter.theme, 'light');
      assert.ok(
        claudeSettingsAfter.hooks['post-tool'].some((h: { command: string }) => h.command === 'echo user-post-tool-hook')
      );
      assert.ok(
        claudeSettingsAfter.hooks['post-tool'].some((h: { command: string }) => h.command.includes('hook post-tool'))
      );

      // Verification 6: OpenCode preserved theme, sibling mcp fetch, and merged instructions
      const opencodeAfter = JSON.parse(fs.readFileSync(opencodePath, 'utf8'));
      assert.equal(opencodeAfter.theme, 'nord');
      assert.ok(opencodeAfter.mcp.fetch);
      assert.ok(opencodeAfter.mcp['evo-kernel']);
      assert.match(opencodeAfter.instructions, /Always respond in valid JSON format/);
      assert.match(opencodeAfter.instructions, /<!-- EVO:START -->/);

      // Idempotency: Running runInit again does not duplicate blocks
      runInit(ws, ['claude', 'cursor', 'codex', 'opencode']);
      const claudeSecond = fs.readFileSync(claudePath, 'utf8');
      const startCount = (claudeSecond.match(/<!-- EVO:START -->/g) || []).length;
      assert.equal(startCount, 1, 'Marker block must not be duplicated on repeated inits');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('3. 3-Stage Cascaded Auto-Detection (--targets auto)', () => {
    // Stage 1: Workspace Artifacts
    const wsStage1 = createTempWorkspace();
    try {
      fs.mkdirSync(path.join(wsStage1, '.windsurf'), { recursive: true });
      fs.writeFileSync(path.join(wsStage1, '.clinerules'), '# cline rules\n', 'utf8');
      const detected1 = detectCascadedTargets(wsStage1, {}, '/nonexistent/home');
      assert.ok(detected1.includes('windsurf'));
      assert.ok(detected1.includes('cline'));
      assert.equal(detected1.includes('codex'), false);

      // Also check parseInitTargets with 'auto'
      const parsedAuto = parseInitTargets('auto', wsStage1);
      assert.ok(parsedAuto.includes('windsurf'));
      assert.ok(parsedAuto.includes('cline'));
    } finally {
      fs.rmSync(wsStage1, { recursive: true, force: true });
    }

    // Stage 2: Host Environment & Process Indicators
    const wsStage2 = createTempWorkspace();
    try {
      const mockEnv = {
        WINDSURF_VERSION: '2.0.0',
        CODEX_CLI: '1',
      };
      const detected2 = detectCascadedTargets(wsStage2, mockEnv, '/nonexistent/home');
      assert.ok(detected2.includes('windsurf'));
      assert.ok(detected2.includes('codex'));
      assert.equal(detected2.includes('claude'), false);
    } finally {
      fs.rmSync(wsStage2, { recursive: true, force: true });
    }

    // Stage 3: User Home Global Installations
    const wsStage3 = createTempWorkspace();
    const fakeHome = createTempWorkspace();
    try {
      fs.mkdirSync(path.join(fakeHome, '.cursor'), { recursive: true });
      fs.mkdirSync(path.join(fakeHome, '.opencode'), { recursive: true });
      const detected3 = detectCascadedTargets(wsStage3, {}, fakeHome);
      assert.ok(detected3.includes('cursor'));
      assert.ok(detected3.includes('opencode'));
      assert.equal(detected3.includes('claude'), false);
    } finally {
      fs.rmSync(wsStage3, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }

    // Fallback: Clean workspace with zero indicators returns ['agents']
    const wsFallback = createTempWorkspace();
    const emptyHome = createTempWorkspace();
    try {
      const detectedFallback = detectCascadedTargets(wsFallback, {}, emptyHome);
      assert.deepEqual(detectedFallback, ['agents']);
    } finally {
      fs.rmSync(wsFallback, { recursive: true, force: true });
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  test('4. Multi-Target Stealth Mode (.git/info/exclude)', () => {
    const gitRepo = createTempWorkspace();
    try {
      fs.mkdirSync(path.join(gitRepo, '.git', 'info'), { recursive: true });
      const subWs = path.join(gitRepo, 'services', 'core-api');
      fs.mkdirSync(subWs, { recursive: true });

      // Run init with --stealth targeting multiple harnesses
      const res = runInit(subWs, {
        stealth: true,
        targets: ['claude', 'cursor', 'codex', 'windsurf', 'copilot', 'cline', 'roo'],
      });

      // Verify .gitignore does NOT exist in workspace or repo root
      assert.equal(fs.existsSync(path.join(gitRepo, '.gitignore')), false);
      assert.equal(fs.existsSync(path.join(subWs, '.gitignore')), false);

      // Verify .git/info/exclude contents
      const excludePath = path.join(gitRepo, '.git', 'info', 'exclude');
      assert.ok(fs.existsSync(excludePath));
      const excludeContent = fs.readFileSync(excludePath, 'utf8');

      // Monorepo subdirectory prefixes
      assert.match(excludeContent, /# EvoKernel Stealth Mode/);
      assert.match(excludeContent, /\/services\/core-api\/\.evo\//);
      assert.match(excludeContent, /\/services\/core-api\/CLAUDE\.md/);
      assert.match(excludeContent, /\/services\/core-api\/\.cursor\//);
      assert.match(excludeContent, /\/services\/core-api\/\.codex\//);
      assert.match(excludeContent, /\/services\/core-api\/\.windsurf\//);
      assert.match(excludeContent, /\/services\/core-api\/\.roo\//);
      assert.match(excludeContent, /\/services\/core-api\/\.cline\//);
      assert.match(excludeContent, /\/services\/core-api\/\.vscode\/mcp\.json/);

      // Worktree gitdir pointer resolution verification
      const worktreeDir = createTempWorkspace();
      try {
        const wtGitFile = path.join(worktreeDir, '.git');
        fs.writeFileSync(wtGitFile, `gitdir: ${path.join(gitRepo, '.git')}\n`, 'utf8');
        assert.equal(resolveGitDir(worktreeDir), path.resolve(gitRepo, '.git'));
      } finally {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(gitRepo, { recursive: true, force: true });
    }
  });

  test('5. Reversible Clean Uninstall with Zero Leftover Zombie Files or Directories', () => {
    const ws = createTempWorkspace();
    const gitRepo = createTempWorkspace();
    try {
      fs.mkdirSync(path.join(gitRepo, '.git', 'info'), { recursive: true });
      const wsInsideGit = path.join(gitRepo, 'project');
      fs.mkdirSync(wsInsideGit, { recursive: true });

      // 1. Initialize all harnesses with stealth
      runInit(wsInsideGit, {
        stealth: true,
        targets: [
          'claude',
          'cursor',
          'windsurf',
          'cline',
          'roo',
          'copilot',
          'codex',
          'opencode',
          'gemini',
          'antigravity',
        ],
      });

      // Verify files and directories were created
      assert.ok(fs.existsSync(path.join(wsInsideGit, 'CLAUDE.md')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.cursor', 'rules', 'evo-kernel.mdc')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.windsurfrules')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.clinerules')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.roo', 'rules', 'evo-kernel.md')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.github', 'copilot-instructions.md')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.codex', 'config.toml')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, 'opencode.json')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, 'GEMINI.md')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.claude', 'settings.json')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.cursor', 'mcp.json')));
      assert.ok(fs.existsSync(path.join(wsInsideGit, '.vscode', 'mcp.json')));

      // 2. Run runUninstall
      const uninstRes = runUninstall(wsInsideGit);
      assert.ok(uninstRes.cleanedFiles.length >= 8);

      // 3. Confirm all created rule files deleted
      assert.equal(fs.existsSync(path.join(wsInsideGit, 'CLAUDE.md')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.cursor', 'rules', 'evo-kernel.mdc')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.windsurfrules')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.clinerules')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.roo', 'rules', 'evo-kernel.md')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.github', 'copilot-instructions.md')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, 'AGENTS.md')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, 'GEMINI.md')), false);

      // 4. Confirm all MCP configs deleted (no zombie { "mcpServers": {} })
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.mcp.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.cursor', 'mcp.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.windsurf', 'mcp.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.cline', 'mcp.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.roo', 'mcp.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.vscode', 'mcp.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.codex', 'config.toml')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, 'opencode.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.claude', 'settings.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.gemini', 'settings.json')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, 'mcp_config.json')), false);

      // 5. Confirm directories are pruned
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.cursor')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.windsurf')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.roo')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.cline')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.vscode')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.codex')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.claude')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.github')), false);
      assert.equal(fs.existsSync(path.join(wsInsideGit, '.gemini')), false);

      // 6. Confirm stealth mode entries cleaned from .git/info/exclude
      const excludeContent = fs.readFileSync(path.join(gitRepo, '.git', 'info', 'exclude'), 'utf8');
      assert.equal(excludeContent.includes('# EvoKernel Stealth Mode'), false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
      fs.rmSync(gitRepo, { recursive: true, force: true });
    }
  });

  test('6. Partial Uninstall: Preserves User Rules and Sibling MCP Servers', () => {
    const ws = createTempWorkspace();
    try {
      // User creates CLAUDE.md with custom content
      fs.writeFileSync(path.join(ws, 'CLAUDE.md'), '# Permanent User Rules\nDo not delete me!\n\n', 'utf8');
      // User creates .mcp.json with custom server
      fs.writeFileSync(
        path.join(ws, '.mcp.json'),
        JSON.stringify({ mcpServers: { myServer: { command: 'node', args: ['server.js'] } } }) + '\n',
        'utf8'
      );

      // Init claude harness
      runInit(ws, ['claude']);

      // Uninstall claude harness
      runUninstall(ws);

      // CLAUDE.md must STILL exist with user rules
      assert.ok(fs.existsSync(path.join(ws, 'CLAUDE.md')));
      const claudeContent = fs.readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8');
      assert.match(claudeContent, /# Permanent User Rules/);
      assert.match(claudeContent, /Do not delete me!/);
      assert.equal(claudeContent.includes(META_RULE_MARKER_START), false);

      // .mcp.json must STILL exist with myServer
      assert.ok(fs.existsSync(path.join(ws, '.mcp.json')));
      const mcpContent = JSON.parse(fs.readFileSync(path.join(ws, '.mcp.json'), 'utf8'));
      assert.ok(mcpContent.mcpServers.myServer);
      assert.equal(mcpContent.mcpServers['evo-kernel'], undefined);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('7. Continuous Invariant Sync & Audit across All 10 Harnesses', () => {
    const ws = createTempWorkspace();
    try {
      // Init multiple harnesses
      runInit(ws, ['claude', 'windsurf', 'cline', 'roo', 'copilot', 'codex', 'gemini']);

      const storage = new EvoStorage(ws);
      storage.saveRule({
        id: 'new-universal-guardrail',
        title: 'Universal Multi-Harness Invariant Rule',
        l0_summary: 'Invariants must sync across all 10 agent harnesses deterministically.',
        scope_glob: 'src/**/*.ts',
        core: true,
        content: 'Ensure all agent harness configs stay in sync.',
      });

      // Run syncManagedRuleBlocks
      const syncedFiles = syncManagedRuleBlocks(ws);
      assert.ok(syncedFiles.length >= 6);
      assert.ok(syncedFiles.includes('CLAUDE.md'));
      assert.ok(syncedFiles.includes('.windsurfrules'));
      assert.ok(syncedFiles.includes('.clinerules'));
      assert.ok(syncedFiles.includes('.roo/rules/evo-kernel.md'));
      assert.ok(syncedFiles.includes('.github/copilot-instructions.md'));
      assert.ok(syncedFiles.includes('AGENTS.md'));
      assert.ok(syncedFiles.includes('GEMINI.md'));

      // Check content in each file contains new invariant
      for (const sf of ['.windsurfrules', '.clinerules', '.roo/rules/evo-kernel.md', '.github/copilot-instructions.md']) {
        const c = fs.readFileSync(path.join(ws, sf), 'utf8');
        assert.match(c, /new-universal-guardrail/);
      }

      // Run audit to verify discoverability
      const auditReport = runAudit(ws);
      const displayPaths = auditReport.files.map((f) => f.displayPath);
      assert.ok(displayPaths.includes('CLAUDE.md'));
      assert.ok(displayPaths.includes('.windsurfrules'));
      assert.ok(displayPaths.includes('.clinerules'));
      assert.ok(displayPaths.includes('.github/copilot-instructions.md'));
      assert.equal(auditReport.budgetViolations.length, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('8. Issue #9 [HIGH-7]: Protects plugin mcp_config.json, avoids bare .vscode false positive, and ignores generic LLM API keys in detectEnv', () => {
    const ws = createTempWorkspace();
    const fakeHome = createTempWorkspace();
    try {
      // 1. Pre-seed self-bootstrapping plugin mcp_config.json
      const pluginMcpPath = path.join(ws, 'mcp_config.json');
      const pluginManifest = {
        mcpServers: {
          'evo-kernel': {
            command: 'node',
            args: ['-e', '/* self-bootstrapping plugin script */'],
          },
        },
      };
      fs.writeFileSync(pluginMcpPath, JSON.stringify(pluginManifest, null, 2) + '\n', 'utf8');

      // upsertMcpJson and removeMcpJson must not clobber or delete the plugin bootstrap manifest
      upsertMcpJson(pluginMcpPath, ws);
      const afterUpsert = JSON.parse(fs.readFileSync(pluginMcpPath, 'utf8'));
      assert.equal(afterUpsert.mcpServers['evo-kernel'].args[0], '-e');

      assert.equal(removeMcpJson(pluginMcpPath), false);
      assert.ok(fs.existsSync(pluginMcpPath));

      // Antigravity install/uninstall must use .mcp.json and never clobber mcp_config.json
      runInit(ws, ['antigravity']);
      assert.ok(fs.existsSync(path.join(ws, '.mcp.json')));
      assert.equal(
        JSON.parse(fs.readFileSync(pluginMcpPath, 'utf8')).mcpServers['evo-kernel'].args[0],
        '-e'
      );
      runUninstall(ws);
      assert.ok(fs.existsSync(pluginMcpPath));

      // 2. Bare .vscode directory (e.g. settings.json) must not false-trigger copilot detection
      fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.vscode', 'settings.json'), '{}', 'utf8');
      const detectedBareVscode = detectCascadedTargets(ws, {}, fakeHome);
      assert.equal(detectedBareVscode.includes('copilot'), false);

      // 3. Generic API keys (OPENAI_API_KEY, GEMINI_API_KEY, CODEIUM_API_KEY) must not false-trigger Stage 2 env detection
      const detectedGenericKeys = detectCascadedTargets(
        ws,
        {
          OPENAI_API_KEY: 'sk-123',
          GEMINI_API_KEY: 'AIza-123',
          CODEIUM_API_KEY: 'cdm-123',
        },
        fakeHome
      );
      assert.deepEqual(detectedGenericKeys, ['agents']);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test('9. Issue #9 [MEDIUM-9]: Codex TOML parser handles multi-line bracketed args and preserves multi-line comments before next section', () => {
    const ws = createTempWorkspace();
    try {
      const tomlPath = path.join(ws, '.codex', 'config.toml');
      fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
      const initialToml = [
        '[model]',
        'name = "o3"',
        '',
        '[mcp_servers.evo-kernel]',
        'command = "npx"',
        'args = [',
        '  "-y",',
        '  "[scoped]/evo-kernel",',
        '  "mcp"',
        ']',
        '',
        '# Important comment line 1 for postgres',
        '# Important comment line 2 for postgres',
        '[mcp_servers.postgres]',
        'command = "psql"',
        '',
      ].join('\n');
      fs.writeFileSync(tomlPath, initialToml, 'utf8');

      upsertCodexToml(tomlPath, 'node', ['./dist/cli/index.js', 'mcp']);
      const afterUpsert = fs.readFileSync(tomlPath, 'utf8');

      assert.equal(afterUpsert.includes('"[scoped]/evo-kernel"'), false);
      assert.match(afterUpsert, /# Important comment line 1 for postgres/);
      assert.match(afterUpsert, /# Important comment line 2 for postgres/);
      assert.match(afterUpsert, /\[mcp_servers\.postgres\]/);

      removeCodexToml(tomlPath);
      const afterRemove = fs.readFileSync(tomlPath, 'utf8');
      assert.equal(afterRemove.includes('[mcp_servers.evo-kernel]'), false);
      assert.match(afterRemove, /# Important comment line 1 for postgres/);
      assert.match(afterRemove, /# Important comment line 2 for postgres/);
      assert.match(afterRemove, /\[mcp_servers\.postgres\]/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('10. Issue #9 [MEDIUM-12]: OpenCode preserves instructionsFile when user AGENTS.md remains and syncs custom instructionsFile', () => {
    const ws = createTempWorkspace();
    try {
      // 1. Pre-existing AGENTS.md with user content
      fs.writeFileSync(path.join(ws, 'AGENTS.md'), '# User Custom Agent Instructions\nKeep this!\n', 'utf8');
      runInit(ws, ['opencode']);
      runUninstall(ws);

      // AGENTS.md still exists with user content, so opencode.json should retain instructionsFile: 'AGENTS.md'
      assert.ok(fs.existsSync(path.join(ws, 'AGENTS.md')));
      assert.ok(fs.existsSync(path.join(ws, 'opencode.json')));
      const parsedOpenCode = JSON.parse(fs.readFileSync(path.join(ws, 'opencode.json'), 'utf8'));
      assert.equal(parsedOpenCode.instructionsFile, 'AGENTS.md');

      // 2. Custom instructionsFile in opencode.json is synced by syncManagedRuleBlocks
      fs.writeFileSync(
        path.join(ws, 'opencode.json'),
        JSON.stringify({ instructionsFile: 'docs/CUSTOM_AGENT.md' }, null, 2) + '\n',
        'utf8'
      );
      runInit(ws, ['opencode']);
      assert.ok(fs.existsSync(path.join(ws, 'docs', 'CUSTOM_AGENT.md')));

      const storage = new EvoStorage(ws);
      storage.saveRule({
        id: 'custom-opencode-sync-rule',
        title: 'Custom OpenCode Sync Rule',
        l0_summary: 'Sync custom instructionsFile in opencode.json.',
        scope_glob: '**/*',
        core: true,
        content: 'Rule body',
      });

      const synced = syncManagedRuleBlocks(ws);
      assert.ok(synced.includes('docs/CUSTOM_AGENT.md'));
      const customContent = fs.readFileSync(path.join(ws, 'docs', 'CUSTOM_AGENT.md'), 'utf8');
      assert.match(customContent, /custom-opencode-sync-rule/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
