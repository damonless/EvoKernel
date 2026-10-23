import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  META_RULE_MARKER_END,
  META_RULE_MARKER_START,
} from '../templates/meta-rule.js';

export interface HarnessInstallResult {
  updatedFiles: string[];
  mcpConfigFiles: string[];
}

export interface HarnessAdapter {
  id: string;
  name: string;
  ruleFiles: string[];
  mcpFiles: string[];
  dirs: string[];
  detectWorkspace(workspaceRoot: string): boolean;
  detectEnv(env: Record<string, string | undefined>): boolean;
  detectGlobal(homeDir: string): boolean;
  install(workspaceRoot: string, managedBlock: string): HarnessInstallResult;
  uninstall(workspaceRoot: string): string[];
}

// ============================================================================
// Markdown & MDC Utilities
// ============================================================================

export function upsertMarkerBlock(existingContent: string, managedBlock: string): string {
  const startIdx = existingContent.indexOf(META_RULE_MARKER_START);
  const endIdx = existingContent.indexOf(META_RULE_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existingContent.slice(0, startIdx).trimEnd();
    const after = existingContent.slice(endIdx + META_RULE_MARKER_END.length).trimStart();
    return [before, managedBlock.trim(), after].filter(Boolean).join('\n\n') + '\n';
  }

  if (!existingContent.trim()) {
    return managedBlock.trim() + '\n';
  }

  return existingContent.trimEnd() + '\n\n' + managedBlock.trim() + '\n';
}

export function removeMarkerBlock(existingContent: string): string {
  const startIdx = existingContent.indexOf(META_RULE_MARKER_START);
  const endIdx = existingContent.indexOf(META_RULE_MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return existingContent;
  }
  const before = existingContent.slice(0, startIdx).trimEnd();
  const after = existingContent.slice(endIdx + META_RULE_MARKER_END.length).trimStart();
  const combined = [before, after].filter(Boolean).join('\n\n');
  return combined ? combined + '\n' : '';
}

export function upsertMdcFile(
  filePath: string,
  managedBlock: string,
  defaultFrontmatter: string = [
    '---',
    'description: EvoKernel Deterministic Self-Evolution Protocol & Core Invariants',
    'globs: **/*',
    'alwaysApply: true',
    '---',
  ].join('\n')
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing = '';
  if (fs.existsSync(filePath)) {
    try {
      existing = fs.readFileSync(filePath, 'utf8');
    } catch {
      existing = '';
    }
  }

  if (!existing.trim()) {
    const full = defaultFrontmatter + '\n\n' + managedBlock.trim() + '\n';
    fs.writeFileSync(filePath, full, 'utf8');
    return;
  }

  const frontmatterMatch = existing.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[0].trimEnd();
    const body = existing.slice(frontmatterMatch[0].length);
    const updatedBody = upsertMarkerBlock(body, managedBlock);
    fs.writeFileSync(filePath, `${fm}\n\n${updatedBody.trimStart()}`, 'utf8');
  } else {
    const updated = upsertMarkerBlock(existing, managedBlock);
    fs.writeFileSync(filePath, updated, 'utf8');
  }
}

// ============================================================================
// JSON MCP Config Utilities
// ============================================================================

export function upsertMcpJson(filePath: string, workspaceRoot: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let current: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }

  const mcpServers =
    current.mcpServers && typeof current.mcpServers === 'object'
      ? (current.mcpServers as Record<string, unknown>)
      : {};

  const localDistEntry = path.join(workspaceRoot, 'dist', 'cli', 'index.js');
  const useLocalDist = fs.existsSync(localDistEntry);

  mcpServers['evo-kernel'] = useLocalDist
    ? {
        command: 'node',
        args: ['./dist/cli/index.js', 'mcp'],
      }
    : {
        command: 'npx',
        args: ['-y', 'evo-kernel', 'mcp'],
      };

  current.mcpServers = mcpServers;
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2) + '\n', 'utf8');
}

export function removeMcpJson(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      const servers = parsed.mcpServers as Record<string, unknown>;
      if ('evo-kernel' in servers) {
        delete servers['evo-kernel'];
        modified = true;
      }
      if (Object.keys(servers).length === 0) {
        delete parsed.mcpServers;
      }
    }
    if (parsed.mcp && typeof parsed.mcp === 'object') {
      const mcp = parsed.mcp as Record<string, unknown>;
      if ('evo-kernel' in mcp) {
        delete mcp['evo-kernel'];
        modified = true;
      }
      if (Object.keys(mcp).length === 0) {
        delete parsed.mcp;
      }
    }

    if (!modified) return false;

    if (Object.keys(parsed).length === 0) {
      fs.unlinkSync(filePath);
      return true;
    }

    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Zero-Dependency TOML Config Utilities (.codex/config.toml)
// ============================================================================

export function upsertCodexToml(filePath: string, workspaceRoot: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const localDistEntry = path.join(workspaceRoot, 'dist', 'cli', 'index.js');
  const useLocalDist = fs.existsSync(localDistEntry);
  const command = useLocalDist ? 'node' : 'npx';
  const args = useLocalDist
    ? ['./dist/cli/index.js', 'mcp']
    : ['-y', 'evo-kernel', 'mcp'];

  let existing = '';
  if (fs.existsSync(filePath)) {
    try {
      existing = fs.readFileSync(filePath, 'utf8');
    } catch {
      existing = '';
    }
  }

  const sectionHeader = '[mcp_servers.evo-kernel]';
  const sectionBody = `${sectionHeader}\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`;

  const sectionRegex = /^[ \t]*\[mcp_servers\.evo-kernel\][ \t]*(?:\r?\n(?!^[ \t]*\[)[^\r\n]*)*(?:\r?\n)?/m;

  let updated = '';
  if (sectionRegex.test(existing)) {
    updated = existing.replace(sectionRegex, sectionBody + '\n').trimEnd() + '\n';
  } else if (!existing.trim()) {
    updated = sectionBody;
  } else {
    updated = existing.trimEnd() + '\n\n' + sectionBody;
  }

  fs.writeFileSync(filePath, updated, 'utf8');
}

export function removeCodexToml(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const existing = fs.readFileSync(filePath, 'utf8');
    const sectionRegex = /^[ \t]*\[mcp_servers\.evo-kernel\][ \t]*(?:\r?\n(?!^[ \t]*\[)[^\r\n]*)*(?:\r?\n)?/m;
    if (!sectionRegex.test(existing)) return false;

    const cleaned = existing.replace(sectionRegex, '').trim();
    if (!cleaned) {
      fs.unlinkSync(filePath);
      return true;
    }
    fs.writeFileSync(filePath, cleaned + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Claude Code Settings Hooks Utilities (.claude/settings.json)
// ============================================================================

export function upsertClaudeSettings(filePath: string, workspaceRoot: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      settings = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  const localDistEntry = path.join(workspaceRoot, 'dist', 'cli', 'index.js');
  const useLocalDist = fs.existsSync(localDistEntry);
  const postToolCmd = useLocalDist
    ? 'node ./dist/cli/index.js hook post-tool'
    : 'npx -y evo-kernel hook post-tool';
  const stopCmd = useLocalDist
    ? 'node ./dist/cli/index.js hook stop'
    : 'npx -y evo-kernel hook stop';

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown>;

  if (!Array.isArray(hooks['post-tool'])) {
    hooks['post-tool'] = [];
  }
  const postList = hooks['post-tool'] as Array<Record<string, unknown>>;
  const hasPost = postList.some((entry) => typeof entry?.command === 'string' && entry.command.includes('hook post-tool'));
  if (!hasPost) {
    postList.push({ command: postToolCmd });
  }

  if (!Array.isArray(hooks['stop'])) {
    hooks['stop'] = [];
  }
  const stopList = hooks['stop'] as Array<Record<string, unknown>>;
  const hasStop = stopList.some((entry) => typeof entry?.command === 'string' && entry.command.includes('hook stop'));
  if (!hasStop) {
    stopList.push({ command: stopCmd });
  }

  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

export function removeClaudeSettings(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

    if (settings.hooks && typeof settings.hooks === 'object') {
      const hooks = settings.hooks as Record<string, unknown>;
      if (Array.isArray(hooks['post-tool'])) {
        const origLen = hooks['post-tool'].length;
        hooks['post-tool'] = (hooks['post-tool'] as Array<Record<string, unknown>>).filter(
          (entry) => !(typeof entry?.command === 'string' && entry.command.includes('hook post-tool'))
        );
        if (hooks['post-tool'].length !== origLen) modified = true;
        if (hooks['post-tool'].length === 0) delete hooks['post-tool'];
      }
      if (Array.isArray(hooks['stop'])) {
        const origLen = hooks['stop'].length;
        hooks['stop'] = (hooks['stop'] as Array<Record<string, unknown>>).filter(
          (entry) => !(typeof entry?.command === 'string' && entry.command.includes('hook stop'))
        );
        if (hooks['stop'].length !== origLen) modified = true;
        if (hooks['stop'].length === 0) delete hooks['stop'];
      }
      if (Object.keys(hooks).length === 0) {
        delete settings.hooks;
        modified = true;
      }
    }

    if (!modified) return false;

    if (Object.keys(settings).length === 0) {
      fs.unlinkSync(filePath);
      return true;
    }

    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// OpenCode Utilities (opencode.json)
// ============================================================================

export function upsertOpenCode(
  filePath: string,
  workspaceRoot: string,
  managedBlock: string
): HarnessInstallResult {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let current: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }

  const localDistEntry = path.join(workspaceRoot, 'dist', 'cli', 'index.js');
  const useLocalDist = fs.existsSync(localDistEntry);
  const mcpEntry = useLocalDist
    ? { command: 'node', args: ['./dist/cli/index.js', 'mcp'] }
    : { command: 'npx', args: ['-y', 'evo-kernel', 'mcp'] };

  if (current.mcp && typeof current.mcp === 'object') {
    (current.mcp as Record<string, unknown>)['evo-kernel'] = mcpEntry;
  } else if (current.mcpServers && typeof current.mcpServers === 'object') {
    (current.mcpServers as Record<string, unknown>)['evo-kernel'] = mcpEntry;
  } else {
    current.mcp = { 'evo-kernel': mcpEntry };
  }

  const updatedFiles: string[] = [];

  if (typeof current.instructions === 'string') {
    current.instructions = upsertMarkerBlock(current.instructions, managedBlock);
    updatedFiles.push('opencode.json');
  } else {
    if (!current.instructionsFile) {
      current.instructionsFile = 'AGENTS.md';
    }
    const agentsPath = path.join(workspaceRoot, String(current.instructionsFile));
    fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
    let existingAgents = '';
    if (fs.existsSync(agentsPath)) {
      try {
        existingAgents = fs.readFileSync(agentsPath, 'utf8');
      } catch {
        existingAgents = '';
      }
    }
    const updatedAgents = upsertMarkerBlock(existingAgents, managedBlock);
    fs.writeFileSync(agentsPath, updatedAgents, 'utf8');
    updatedFiles.push(String(current.instructionsFile));
  }

  fs.writeFileSync(filePath, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return { updatedFiles, mcpConfigFiles: ['opencode.json'] };
}

export function removeOpenCode(filePath: string, workspaceRoot: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const cleaned: string[] = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

    if (parsed.mcp && typeof parsed.mcp === 'object') {
      const mcp = parsed.mcp as Record<string, unknown>;
      if ('evo-kernel' in mcp) {
        delete mcp['evo-kernel'];
        modified = true;
      }
      if (Object.keys(mcp).length === 0) {
        delete parsed.mcp;
      }
    }
    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      const s = parsed.mcpServers as Record<string, unknown>;
      if ('evo-kernel' in s) {
        delete s['evo-kernel'];
        modified = true;
      }
      if (Object.keys(s).length === 0) {
        delete parsed.mcpServers;
      }
    }
    if (typeof parsed.instructions === 'string' && parsed.instructions.includes(META_RULE_MARKER_START)) {
      parsed.instructions = removeMarkerBlock(parsed.instructions);
      modified = true;
      if (!parsed.instructions.trim()) {
        delete parsed.instructions;
      }
    }

    if (parsed.instructionsFile) {
      const targetPath = path.join(workspaceRoot, String(parsed.instructionsFile));
      if (fs.existsSync(targetPath)) {
        const c = fs.readFileSync(targetPath, 'utf8');
        if (c.includes(META_RULE_MARKER_START)) {
          const next = removeMarkerBlock(c);
          if (!next.trim()) {
            fs.unlinkSync(targetPath);
          } else {
            fs.writeFileSync(targetPath, next, 'utf8');
          }
          cleaned.push(String(parsed.instructionsFile));
        }
      }
    }

    if (Object.keys(parsed).length === 1 && parsed.instructionsFile === 'AGENTS.md') {
      delete parsed.instructionsFile;
      modified = true;
    }

    if (Object.keys(parsed).length === 0) {
      fs.unlinkSync(filePath);
      cleaned.push('opencode.json');
      return cleaned;
    }

    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      cleaned.push('opencode.json');
    }
  } catch {
    // Ignore JSON errors
  }
  return cleaned;
}

// ============================================================================
// Directory & Exclusion Utilities
// ============================================================================

export function pruneEmptyDirs(workspaceRoot: string, dirs: string[]): string[] {
  const pruned: string[] = [];
  const sorted = [...dirs].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    const full = path.isAbsolute(d) ? d : path.join(workspaceRoot, d);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        const entries = fs.readdirSync(full);
        if (entries.length === 0) {
          fs.rmdirSync(full);
          pruned.push(d);
        }
      }
    } catch {
      // Ignore directory removal failure if not empty
    }
  }
  return pruned;
}

export function cleanRuleFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(META_RULE_MARKER_START)) return false;
    const cleaned = removeMarkerBlock(content);
    if (!cleaned.trim()) {
      fs.unlinkSync(filePath);
      return true;
    }
    fs.writeFileSync(filePath, cleaned, 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Target Harness Adapters
// ============================================================================

export class ClaudeAdapter implements HarnessAdapter {
  id = 'claude';
  name = 'Claude Code';
  ruleFiles = ['CLAUDE.md'];
  mcpFiles = ['.mcp.json'];
  dirs = ['.claude'];

  detectWorkspace(ws: string): boolean {
    return fs.existsSync(path.join(ws, 'CLAUDE.md')) || fs.existsSync(path.join(ws, '.claude'));
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.CLAUDE_CONFIG_DIR || env.CLAUDE_CODE_ENTRY || env.CLAUDE_PROJECT_DIR);
  }

  detectGlobal(home: string): boolean {
    return fs.existsSync(path.join(home, '.claude')) || fs.existsSync(path.join(home, '.claude.json'));
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, 'CLAUDE.md');
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, '.mcp.json');
    upsertMcpJson(mcpPath, ws);

    const settingsPath = path.join(ws, '.claude', 'settings.json');
    upsertClaudeSettings(settingsPath, ws);

    return {
      updatedFiles: ['CLAUDE.md'],
      mcpConfigFiles: ['.mcp.json', '.claude/settings.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'CLAUDE.md'))) cleaned.push('CLAUDE.md');
    if (removeMcpJson(path.join(ws, '.mcp.json'))) cleaned.push('.mcp.json');
    if (removeClaudeSettings(path.join(ws, '.claude', 'settings.json'))) cleaned.push('.claude/settings.json');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class CursorAdapter implements HarnessAdapter {
  id = 'cursor';
  name = 'Cursor';
  ruleFiles = ['.cursor/rules/evo-kernel.mdc'];
  mcpFiles = ['.cursor/mcp.json'];
  dirs = ['.cursor/rules', '.cursor'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, '.cursor', 'rules', 'evo-kernel.mdc')) ||
      fs.existsSync(path.join(ws, '.cursor')) ||
      fs.existsSync(path.join(ws, '.cursorrules'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.CURSOR_AGENT || env.CURSOR_VERSION);
  }

  detectGlobal(home: string): boolean {
    if (fs.existsSync(path.join(home, '.cursor'))) return true;
    if (fs.existsSync(path.join(home, 'AppData', 'Roaming', 'Cursor'))) return true;
    return false;
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, '.cursor', 'rules', 'evo-kernel.mdc');
    upsertMdcFile(rulePath, managedBlock);

    const mcpPath = path.join(ws, '.cursor', 'mcp.json');
    upsertMcpJson(mcpPath, ws);

    return {
      updatedFiles: ['.cursor/rules/evo-kernel.mdc'],
      mcpConfigFiles: ['.cursor/mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    const rulePath = path.join(ws, '.cursor', 'rules', 'evo-kernel.mdc');
    if (fs.existsSync(rulePath)) {
      const content = fs.readFileSync(rulePath, 'utf8');
      const withoutBlock = removeMarkerBlock(content);
      const withoutFm = withoutBlock.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
      if (!withoutFm) {
        fs.unlinkSync(rulePath);
      } else {
        fs.writeFileSync(rulePath, withoutBlock, 'utf8');
      }
      cleaned.push('.cursor/rules/evo-kernel.mdc');
    }

    if (removeMcpJson(path.join(ws, '.cursor', 'mcp.json'))) cleaned.push('.cursor/mcp.json');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class WindsurfAdapter implements HarnessAdapter {
  id = 'windsurf';
  name = 'Windsurf';
  ruleFiles = ['.windsurfrules', '.windsurf/rules/evo-kernel.md'];
  mcpFiles = ['.windsurf/mcp.json'];
  dirs = ['.windsurf/rules', '.windsurf'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, '.windsurfrules')) ||
      fs.existsSync(path.join(ws, '.windsurf'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.WINDSURF_VERSION || env.CODEIUM_API_KEY);
  }

  detectGlobal(home: string): boolean {
    if (fs.existsSync(path.join(home, '.windsurf'))) return true;
    if (fs.existsSync(path.join(home, '.codeium', 'windsurf'))) return true;
    if (fs.existsSync(path.join(home, 'AppData', 'Roaming', 'Windsurf'))) return true;
    return false;
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, '.windsurfrules');
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, '.windsurf', 'mcp.json');
    upsertMcpJson(mcpPath, ws);

    return {
      updatedFiles: ['.windsurfrules'],
      mcpConfigFiles: ['.windsurf/mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, '.windsurfrules'))) cleaned.push('.windsurfrules');
    if (cleanRuleFile(path.join(ws, '.windsurf', 'rules', 'evo-kernel.md'))) {
      cleaned.push('.windsurf/rules/evo-kernel.md');
    }
    if (removeMcpJson(path.join(ws, '.windsurf', 'mcp.json'))) cleaned.push('.windsurf/mcp.json');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class ClineAdapter implements HarnessAdapter {
  id = 'cline';
  name = 'Cline';
  ruleFiles = ['.clinerules'];
  mcpFiles = ['.cline/mcp.json'];
  dirs = ['.cline'];

  detectWorkspace(ws: string): boolean {
    return fs.existsSync(path.join(ws, '.clinerules')) || fs.existsSync(path.join(ws, '.cline'));
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.CLINE_DIR);
  }

  detectGlobal(home: string): boolean {
    return fs.existsSync(path.join(home, '.cline'));
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, '.clinerules');
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, '.cline', 'mcp.json');
    upsertMcpJson(mcpPath, ws);

    return {
      updatedFiles: ['.clinerules'],
      mcpConfigFiles: ['.cline/mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, '.clinerules'))) cleaned.push('.clinerules');
    if (removeMcpJson(path.join(ws, '.cline', 'mcp.json'))) cleaned.push('.cline/mcp.json');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class RooAdapter implements HarnessAdapter {
  id = 'roo';
  name = 'Roo Code';
  ruleFiles = ['.roo/rules/evo-kernel.md', '.roorules'];
  mcpFiles = ['.roo/mcp.json'];
  dirs = ['.roo/rules', '.roo'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, '.roo', 'rules')) ||
      fs.existsSync(path.join(ws, '.roo')) ||
      fs.existsSync(path.join(ws, '.roorules'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.ROO_DIR);
  }

  detectGlobal(home: string): boolean {
    return fs.existsSync(path.join(home, '.roo'));
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, '.roo', 'rules', 'evo-kernel.md');
    fs.mkdirSync(path.dirname(rulePath), { recursive: true });
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, '.roo', 'mcp.json');
    upsertMcpJson(mcpPath, ws);

    return {
      updatedFiles: ['.roo/rules/evo-kernel.md'],
      mcpConfigFiles: ['.roo/mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, '.roo', 'rules', 'evo-kernel.md'))) {
      cleaned.push('.roo/rules/evo-kernel.md');
    }
    if (cleanRuleFile(path.join(ws, '.roorules'))) {
      cleaned.push('.roorules');
    }
    if (removeMcpJson(path.join(ws, '.roo', 'mcp.json'))) cleaned.push('.roo/mcp.json');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class CopilotAdapter implements HarnessAdapter {
  id = 'copilot';
  name = 'GitHub Copilot / VS Code';
  ruleFiles = ['.github/copilot-instructions.md'];
  mcpFiles = ['.vscode/mcp.json'];
  dirs = ['.github', '.vscode'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, '.github', 'copilot-instructions.md')) ||
      fs.existsSync(path.join(ws, '.vscode'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.VSCODE_PID || env.VSCODE_CWD || env.GITHUB_COPILOT_TOKEN);
  }

  detectGlobal(home: string): boolean {
    if (fs.existsSync(path.join(home, '.vscode'))) return true;
    if (fs.existsSync(path.join(home, 'AppData', 'Roaming', 'Code'))) return true;
    return false;
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, '.github', 'copilot-instructions.md');
    fs.mkdirSync(path.dirname(rulePath), { recursive: true });
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, '.vscode', 'mcp.json');
    upsertMcpJson(mcpPath, ws);

    return {
      updatedFiles: ['.github/copilot-instructions.md'],
      mcpConfigFiles: ['.vscode/mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, '.github', 'copilot-instructions.md'))) {
      cleaned.push('.github/copilot-instructions.md');
    }
    if (removeMcpJson(path.join(ws, '.vscode', 'mcp.json'))) cleaned.push('.vscode/mcp.json');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class CodexAdapter implements HarnessAdapter {
  id = 'codex';
  name = 'OpenAI Codex CLI';
  ruleFiles = ['AGENTS.md'];
  mcpFiles = ['.codex/config.toml'];
  dirs = ['.codex'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, '.codex')) ||
      fs.existsSync(path.join(ws, '.codex', 'config.toml'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.CODEX_CLI || env.OPENAI_API_KEY);
  }

  detectGlobal(home: string): boolean {
    return fs.existsSync(path.join(home, '.codex'));
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, 'AGENTS.md');
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const tomlPath = path.join(ws, '.codex', 'config.toml');
    upsertCodexToml(tomlPath, ws);

    return {
      updatedFiles: ['AGENTS.md'],
      mcpConfigFiles: ['.codex/config.toml'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'AGENTS.md'))) cleaned.push('AGENTS.md');
    if (removeCodexToml(path.join(ws, '.codex', 'config.toml'))) cleaned.push('.codex/config.toml');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class OpenCodeAdapter implements HarnessAdapter {
  id = 'opencode';
  name = 'OpenCode';
  ruleFiles = ['opencode.json', 'AGENTS.md'];
  mcpFiles = ['opencode.json'];
  dirs = ['.opencode'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, 'opencode.json')) ||
      fs.existsSync(path.join(ws, '.opencode'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.OPENCODE_PORT || env.OPENCODE_SERVER);
  }

  detectGlobal(home: string): boolean {
    return fs.existsSync(path.join(home, '.opencode'));
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const configPath = path.join(ws, 'opencode.json');
    return upsertOpenCode(configPath, ws, managedBlock);
  }

  uninstall(ws: string): string[] {
    const configPath = path.join(ws, 'opencode.json');
    const cleaned = removeOpenCode(configPath, ws);
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class GeminiAdapter implements HarnessAdapter {
  id = 'gemini';
  name = 'Gemini CLI';
  ruleFiles = ['GEMINI.md'];
  mcpFiles = ['.gemini/settings.json'];
  dirs = ['.gemini'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, 'GEMINI.md')) ||
      fs.existsSync(path.join(ws, '.gemini'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.GEMINI_CLI_HOME || env.GEMINI_API_KEY);
  }

  detectGlobal(home: string): boolean {
    return fs.existsSync(path.join(home, '.gemini'));
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, 'GEMINI.md');
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, '.gemini', 'settings.json');
    upsertMcpJson(mcpPath, ws);

    return {
      updatedFiles: ['GEMINI.md'],
      mcpConfigFiles: ['.gemini/settings.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'GEMINI.md'))) cleaned.push('GEMINI.md');
    if (removeMcpJson(path.join(ws, '.gemini', 'settings.json'))) cleaned.push('.gemini/settings.json');
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class AntigravityAdapter implements HarnessAdapter {
  id = 'antigravity';
  name = 'Antigravity';
  ruleFiles = ['GEMINI.md'];
  mcpFiles = ['mcp_config.json', '.mcp.json'];
  dirs: string[] = [];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, 'mcp_config.json')) ||
      fs.existsSync(path.join(ws, 'hooks.json'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.ANTIGRAVITY_APP_DATA || env.ANTIGRAVITY_AGENT);
  }

  detectGlobal(home: string): boolean {
    return fs.existsSync(path.join(home, '.gemini', 'antigravity'));
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, 'GEMINI.md');
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, 'mcp_config.json');
    upsertMcpJson(mcpPath, ws);

    const rootMcp = path.join(ws, '.mcp.json');
    upsertMcpJson(rootMcp, ws);

    return {
      updatedFiles: ['GEMINI.md'],
      mcpConfigFiles: ['mcp_config.json', '.mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'GEMINI.md'))) cleaned.push('GEMINI.md');
    if (removeMcpJson(path.join(ws, 'mcp_config.json'))) cleaned.push('mcp_config.json');
    if (removeMcpJson(path.join(ws, '.mcp.json'))) cleaned.push('.mcp.json');
    return cleaned;
  }
}

export class AgentsAdapter implements HarnessAdapter {
  id = 'agents';
  name = 'Agnostic Agents';
  ruleFiles = ['AGENTS.md'];
  mcpFiles = ['.mcp.json'];
  dirs: string[] = [];

  detectWorkspace(ws: string): boolean {
    return fs.existsSync(path.join(ws, 'AGENTS.md'));
  }

  detectEnv(_env: Record<string, string | undefined>): boolean {
    return false;
  }

  detectGlobal(_home: string): boolean {
    return false;
  }

  install(ws: string, managedBlock: string): HarnessInstallResult {
    const rulePath = path.join(ws, 'AGENTS.md');
    let existing = '';
    if (fs.existsSync(rulePath)) {
      existing = fs.readFileSync(rulePath, 'utf8');
    }
    fs.writeFileSync(rulePath, upsertMarkerBlock(existing, managedBlock), 'utf8');

    const mcpPath = path.join(ws, '.mcp.json');
    upsertMcpJson(mcpPath, ws);

    return {
      updatedFiles: ['AGENTS.md'],
      mcpConfigFiles: ['.mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'AGENTS.md'))) cleaned.push('AGENTS.md');
    if (removeMcpJson(path.join(ws, '.mcp.json'))) cleaned.push('.mcp.json');
    return cleaned;
  }
}

// ============================================================================
// Harness Registry & 3-Stage Cascaded Detection
// ============================================================================

export const ALL_HARNESS_ADAPTERS: Record<string, HarnessAdapter> = {
  claude: new ClaudeAdapter(),
  cursor: new CursorAdapter(),
  windsurf: new WindsurfAdapter(),
  cline: new ClineAdapter(),
  roo: new RooAdapter(),
  copilot: new CopilotAdapter(),
  codex: new CodexAdapter(),
  opencode: new OpenCodeAdapter(),
  gemini: new GeminiAdapter(),
  antigravity: new AntigravityAdapter(),
  agents: new AgentsAdapter(),
};

export const HARNESS_ALIASES: Record<string, string> = {
  claudecode: 'claude',
  cursorrules: 'cursor',
  mdc: 'cursor',
  codeium: 'windsurf',
  roorules: 'roo',
  roocode: 'roo',
  vscode: 'copilot',
  'github-copilot': 'copilot',
  openai: 'codex',
  agy: 'antigravity',
  agent: 'agents',
};

export const HARNESS_RULE_TARGETS: Record<string, string> = {
  claude: 'CLAUDE.md',
  cursor: '.cursor/rules/evo-kernel.mdc',
  windsurf: '.windsurfrules',
  cline: '.clinerules',
  roo: '.roo/rules/evo-kernel.md',
  copilot: '.github/copilot-instructions.md',
  codex: 'AGENTS.md',
  opencode: 'opencode.json',
  gemini: 'GEMINI.md',
  antigravity: 'GEMINI.md',
  agents: 'AGENTS.md',
};

export function normalizeTargetToken(token: string): string | null {
  const clean = token.trim().toLowerCase().replace(/\.(md|mdc|json|toml)$/i, '');
  if (ALL_HARNESS_ADAPTERS[clean]) {
    return clean;
  }
  if (HARNESS_ALIASES[clean]) {
    return HARNESS_ALIASES[clean];
  }
  return null;
}

export function detectCascadedTargets(
  workspaceRoot: string,
  env: Record<string, string | undefined> = process.env,
  homeDir: string = os.homedir()
): string[] {
  // Stage 1: Workspace Project Artifacts (Highest confidence)
  const stage1: string[] = [];
  for (const adapter of Object.values(ALL_HARNESS_ADAPTERS)) {
    if (adapter.detectWorkspace(workspaceRoot)) {
      stage1.push(adapter.id);
    }
  }
  if (stage1.length > 0) {
    return Array.from(new Set(stage1));
  }

  // Stage 2: Host Environment Variables & Process Indicators
  const stage2: string[] = [];
  for (const adapter of Object.values(ALL_HARNESS_ADAPTERS)) {
    if (adapter.detectEnv(env)) {
      stage2.push(adapter.id);
    }
  }
  if (stage2.length > 0) {
    return Array.from(new Set(stage2));
  }

  // Stage 3: User Home Global installations (~/.agent)
  const stage3: string[] = [];
  for (const adapter of Object.values(ALL_HARNESS_ADAPTERS)) {
    if (adapter.detectGlobal(homeDir)) {
      stage3.push(adapter.id);
    }
  }
  if (stage3.length > 0) {
    return Array.from(new Set(stage3));
  }

  // Fallback: ['agents'] (AGENTS.md)
  return ['agents'];
}

export function parseHarnessTargets(
  rawTargets: string | string[] | undefined,
  workspaceRoot: string,
  env: Record<string, string | undefined> = process.env,
  homeDir: string = os.homedir()
): string[] {
  const allTargets = Object.keys(ALL_HARNESS_ADAPTERS);
  if (!rawTargets) {
    return allTargets;
  }

  const tokens = (Array.isArray(rawTargets) ? rawTargets.join(',') : rawTargets)
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0 || tokens.includes('all')) {
    return allTargets;
  }

  if (tokens.includes('auto')) {
    return detectCascadedTargets(workspaceRoot, env, homeDir);
  }

  const normalized = new Set<string>();
  for (const token of tokens) {
    const mapped = normalizeTargetToken(token);
    if (mapped) {
      normalized.add(mapped);
    }
  }

  return normalized.size > 0 ? Array.from(normalized) : allTargets;
}
