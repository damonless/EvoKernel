import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  META_RULE_MARKER_END,
  META_RULE_MARKER_START,
} from '../templates/meta-rule.js';
import { EvoStorage } from '../core/storage.js';

export interface HarnessInstallResult {
  updatedFiles: string[];
  mcpConfigFiles: string[];
  commandFiles?: string[];
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

export const SLASH_COMMAND_DEFINITIONS: Record<string, string> = {
  'evo-status.md': `<!-- EVO:COMMAND -->
# /evo-status
Check EvoKernel capability statistics, memory verification freshness, and MCP tax score report.
Run \`node .evo/boot-mcp.mjs score\` or \`npx evo-kernel score\`.
`,
  'evo-learn.md': `<!-- EVO:COMMAND -->
# /evo-learn
Crystallize diagnosed bug root causes, user corrections, or architectural guardrails into EvoKernel via \`evo_propose\`.
`,
  'evo-doctor.md': `<!-- EVO:COMMAND -->
# /evo-doctor
Run EvoKernel zero-modification physical health check and rule token budget audit via \`npx evo-kernel doctor\`.
`,
};

export function upsertSlashCommands(commandsDir: string): string[] {
  const created: string[] = [];
  try {
    fs.mkdirSync(commandsDir, { recursive: true });
    for (const [filename, content] of Object.entries(SLASH_COMMAND_DEFINITIONS)) {
      const fullPath = path.join(commandsDir, filename);
      fs.writeFileSync(fullPath, content, 'utf8');
      created.push(fullPath);
    }
  } catch {}
  return created;
}

export function cleanSlashCommands(commandsDir: string): string[] {
  const cleaned: string[] = [];
  if (!fs.existsSync(commandsDir)) return cleaned;
  try {
    for (const file of fs.readdirSync(commandsDir)) {
      const fullPath = path.join(commandsDir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        if (raw.includes('<!-- EVO:COMMAND -->')) {
          fs.unlinkSync(fullPath);
          cleaned.push(fullPath);
        }
      } catch {}
    }
  } catch {}
  return cleaned;
}

// ============================================================================
// JSON MCP Config Utilities
// ============================================================================

function isPluginBootstrapEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const args = (entry as Record<string, unknown>).args;
  return Array.isArray(args) && args[0] === '-e';
}

export function resolveInstalledEvoKernelRoot(): string | null {
  if (process.env.EVO_FORCE_NPX === '1') {
    return null;
  }
  const candidates = [
    process.env.EVO_KERNEL_ROOT ? path.resolve(process.env.EVO_KERNEL_ROOT) : '',
    path.resolve(import.meta.dirname, '..', '..'),
    path.join(os.homedir(), '.gemini', 'config', 'plugins', 'evo-kernel'),
    path.join(os.homedir(), '.gemini', 'extensions', 'evo-kernel'),
  ].filter(Boolean);

  for (const cand of candidates) {
    if (
      fs.existsSync(path.join(cand, 'scripts', 'boot-mcp.mjs')) ||
      fs.existsSync(path.join(cand, 'dist', 'cli', 'index.js'))
    ) {
      return cand;
    }
  }
  return null;
}

export function resolveEvoMcpLaunchConfig(workspaceRoot: string): {
  command: string;
  args: string[];
} {
  const localBootEntry = path.join(workspaceRoot, 'scripts', 'boot-mcp.mjs');
  const localDistEntry = path.join(workspaceRoot, 'dist', 'cli', 'index.js');
  const localEvoBootEntry = path.join(workspaceRoot, '.evo', 'boot-mcp.mjs');
  if (fs.existsSync(localBootEntry)) {
    return { command: 'node', args: ['./scripts/boot-mcp.mjs', 'mcp'] };
  }
  if (fs.existsSync(localDistEntry)) {
    return { command: 'node', args: ['./dist/cli/index.js', 'mcp'] };
  }
  if (fs.existsSync(localEvoBootEntry)) {
    return { command: 'node', args: ['./.evo/boot-mcp.mjs', 'mcp'] };
  }

  const installedRoot = resolveInstalledEvoKernelRoot();
  if (installedRoot) {
    const extBoot = path.join(installedRoot, 'scripts', 'boot-mcp.mjs');
    if (fs.existsSync(extBoot)) {
      return { command: 'node', args: [extBoot.replace(/\\/g, '/'), 'mcp'] };
    }
    const extDist = path.join(installedRoot, 'dist', 'cli', 'index.js');
    if (fs.existsSync(extDist)) {
      return { command: 'node', args: [extDist.replace(/\\/g, '/'), 'mcp'] };
    }
  }

  return { command: 'npx', args: ['-y', 'evo-kernel', 'mcp'] };
}

export function resolveEvoHookCommand(
  workspaceRoot: string,
  hookEvent: 'pre-tool' | 'post-tool' | 'stop'
): string {
  const localDistEntry = path.join(workspaceRoot, 'dist', 'cli', 'index.js');
  if (fs.existsSync(localDistEntry)) {
    return `node ./dist/cli/index.js hook ${hookEvent}`;
  }
  const localBootEntry = path.join(workspaceRoot, 'scripts', 'boot-mcp.mjs');
  if (fs.existsSync(localBootEntry)) {
    return `node ./scripts/boot-mcp.mjs hook ${hookEvent}`;
  }
  const localEvoBootEntry = path.join(workspaceRoot, '.evo', 'boot-mcp.mjs');
  if (fs.existsSync(localEvoBootEntry)) {
    return `node ./.evo/boot-mcp.mjs hook ${hookEvent}`;
  }

  const installedRoot = resolveInstalledEvoKernelRoot();
  if (installedRoot) {
    const extDist = path.join(installedRoot, 'dist', 'cli', 'index.js');
    const extBoot = path.join(installedRoot, 'scripts', 'boot-mcp.mjs');
    const targetScript = fs.existsSync(extDist) ? extDist : extBoot;
    if (fs.existsSync(targetScript)) {
      const norm = targetScript.replace(/\\/g, '/');
      const quoted = norm.includes(' ') ? `"${norm}"` : norm;
      return `node ${quoted} hook ${hookEvent}`;
    }
  }

  return `npx -y evo-kernel hook ${hookEvent}`;
}

function isTrailingComma(text: string, commaPos: number): boolean {
  let j = commaPos + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      j++;
      continue;
    }
    if (c === '/' && text[j + 1] === '/') {
      j += 2;
      while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++;
      continue;
    }
    if (c === '/' && text[j + 1] === '*') {
      j += 2;
      while (j < text.length - 1 && !(text[j] === '*' && text[j + 1] === '/')) j++;
      j += 2;
      continue;
    }
    return c === '}' || c === ']';
  }
  return false;
}

export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      if (i < text.length) {
        out += text[i];
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i++;
      continue;
    }

    if (ch === ',') {
      if (isTrailingComma(text, i)) {
        continue;
      }
    }

    out += ch;
  }

  return out;
}

export function parseJsonc(text: string, filePath?: string): any {
  const stripped = stripJsonComments(text);
  try {
    return JSON.parse(stripped);
  } catch (err: any) {
    const loc = filePath ? ` in ${filePath}` : '';
    throw new Error(`Failed to parse JSON/JSONC${loc}: ${err?.message || String(err)}`);
  }
}

export function upsertMcpJson(filePath: string, workspaceRoot: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let current: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) {
      current = parseJsonc(raw, filePath) as Record<string, unknown>;
    }
  }

  const isVsCode =
    filePath.replace(/\\/g, '/').endsWith('.vscode/mcp.json') ||
    (current.servers && typeof current.servers === 'object');

  if (isVsCode) {
    const servers =
      current.servers && typeof current.servers === 'object'
        ? (current.servers as Record<string, unknown>)
        : {};
    const launch = resolveEvoMcpLaunchConfig(workspaceRoot);
    servers['evo-kernel'] = {
      type: 'stdio',
      ...launch,
    };
    current.servers = servers;
  } else {
    const mcpServers =
      current.mcpServers && typeof current.mcpServers === 'object'
        ? (current.mcpServers as Record<string, unknown>)
        : {};

    // Guard against clobbering the self-bootstrapping plugin manifest in mcp_config.json
    if (
      path.basename(filePath) === 'mcp_config.json' &&
      isPluginBootstrapEntry(mcpServers['evo-kernel'])
    ) {
      return;
    }

    mcpServers['evo-kernel'] = resolveEvoMcpLaunchConfig(workspaceRoot);
    current.mcpServers = mcpServers;
  }

  fs.writeFileSync(filePath, JSON.stringify(current, null, 2) + '\n', 'utf8');
}

export function removeMcpJson(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return false;
    const parsed = parseJsonc(raw, filePath) as Record<string, unknown>;
    let modified = false;

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
      const servers = parsed.mcpServers as Record<string, unknown>;
      if ('evo-kernel' in servers) {
        if (
          path.basename(filePath) === 'mcp_config.json' &&
          isPluginBootstrapEntry(servers['evo-kernel'])
        ) {
          return false;
        }
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
    if (parsed.servers && typeof parsed.servers === 'object') {
      const vscServers = parsed.servers as Record<string, unknown>;
      if ('evo-kernel' in vscServers) {
        delete vscServers['evo-kernel'];
        modified = true;
      }
      if (Object.keys(vscServers).length === 0) {
        delete parsed.servers;
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

function countTomlBracketDelta(line: string): number {
  let delta = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && inDouble) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '#') break;
      if (ch === '[') delta++;
      else if (ch === ']') delta--;
    }
  }
  return delta;
}

function locateCodexEvoSection(
  content: string
): { startLine: number; endLine: number; lines: string[] } | null {
  const lines = content.split(/\r?\n/);
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*\[mcp_servers\.evo-kernel\][ \t]*(?:#.*)?$/.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;

  let bracketDepth = 0;
  let endLine = lines.length;

  for (let i = startLine + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (bracketDepth === 0 && trimmed.startsWith('[')) {
      endLine = i;
      // Backtrack to preserve all contiguous comment lines immediately preceding the next [section]
      while (endLine > startLine + 1 && lines[endLine - 1].trim().startsWith('#')) {
        endLine--;
      }
      break;
    }
    bracketDepth = Math.max(0, bracketDepth + countTomlBracketDelta(lines[i]));
  }

  return { startLine, endLine, lines };
}

export function upsertCodexToml(
  filePath: string,
  workspaceRootOrCommand: string,
  customArgs?: string[]
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let command: string;
  let args: string[];

  if (Array.isArray(customArgs)) {
    command = workspaceRootOrCommand;
    args = customArgs;
  } else {
    const resolved = resolveEvoMcpLaunchConfig(workspaceRootOrCommand);
    command = resolved.command;
    args = resolved.args;
  }

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

  const loc = locateCodexEvoSection(existing);
  let updated = '';
  if (loc) {
    const before = loc.lines.slice(0, loc.startLine).join('\n').trimEnd();
    const after = loc.lines.slice(loc.endLine).join('\n').trimStart();
    updated = [before, sectionBody.trimEnd(), after].filter(Boolean).join('\n\n') + '\n';
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
    const loc = locateCodexEvoSection(existing);
    if (!loc) return false;

    const before = loc.lines.slice(0, loc.startLine).join('\n').trimEnd();
    const after = loc.lines.slice(loc.endLine).join('\n').trimStart();
    const cleaned = [before, after].filter(Boolean).join('\n\n').trim();
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

export function isEvoHookCommand(cmd: string, needle?: string): boolean {
  if (typeof cmd !== 'string') return false;
  const expectedEv = needle ? needle.replace(/^hook\s+/i, '').trim().toLowerCase() : '';

  if (/(?:^|[\s"'/\\])antigravity_hook\.mjs(?=["'\s]|$)/i.test(cmd)) {
    if (!expectedEv) return true;
    const agyRegex = new RegExp(`['"]?${expectedEv}['"]?|\\b${expectedEv}\\b`, 'i');
    if (agyRegex.test(cmd)) return true;
    if (expectedEv === 'pre-tool' && /\bPreInvocation\b/i.test(cmd)) return true;
    if (expectedEv === 'stop' && /\bStop\b/i.test(cmd)) return true;
    return false;
  }

  const evoRegex =
    /(?:npx\s+(?:--yes\s+|-y\s+)?evo-kernel|(?:^|[\s"'/\\])evo(?:-kernel)?(?:\.cmd|\.ps1|\.exe)?(?=["'\s]|$)|(?:dist|src)[/\\]cli[/\\]index\.(?:js|mjs|ts)|boot-mcp\.mjs)(?:["']|\b)[^|;&\r\n]*?\bhook\s+(pre-tool|post-tool|stop|pre-commit|mark-recovery)\b/i;
  for (const match of cmd.matchAll(new RegExp(evoRegex.source, 'gi'))) {
    // A generic `dist/cli/index.js` inside node_modules belongs to whatever package
    // hosts it (innermost node_modules/<pkg>/ segment of the path); only the
    // evo-kernel package itself counts as an Evo hook.
    if (/^(?:dist|src)[/\\]/i.test(match[0])) {
      const prefix = cmd.slice(0, match.index ?? 0);
      const nm = prefix.match(
        /node_modules[/\\](?:@[^/\\\s"']+[/\\])?([^/\\\s"']+)[/\\](?:(?!node_modules[/\\])[^\s"'])*$/i
      );
      if (nm && nm[1].toLowerCase() !== 'evo-kernel') continue;
    }
    if (!expectedEv || match[1].toLowerCase() === expectedEv) return true;
  }
  return false;
}

function matchesClaudeHookEntry(entry: Record<string, unknown>, needle: string): boolean {
  if (typeof entry?.command === 'string' && isEvoHookCommand(entry.command, needle)) {
    return true;
  }
  if (Array.isArray(entry?.hooks)) {
    return (entry.hooks as Array<Record<string, unknown>>).some(
      (h) => typeof h?.command === 'string' && isEvoHookCommand(h.command, needle)
    );
  }
  return false;
}

export function upsertClaudeSettings(filePath: string, workspaceRoot: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      const parsedSettings: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsedSettings || typeof parsedSettings !== 'object' || Array.isArray(parsedSettings)) {
        throw new Error('settings root is not a JSON object');
      }
      settings = parsedSettings as Record<string, unknown>;
    } catch {
      // Data-loss guard: never overwrite a user's unparseable / non-object settings file.
      console.warn(
        `[EvoKernel Warning] Skipped Claude hook wiring: ${filePath} is not a valid JSON object; fix it and re-run evo init.`
      );
      return;
    }
  }

  const postToolCmd = resolveEvoHookCommand(workspaceRoot, 'post-tool');
  const stopCmd = resolveEvoHookCommand(workspaceRoot, 'stop');

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown>;

  // Official Claude Code PascalCase nested hook format (PostToolUse / Stop)
  if (!Array.isArray(hooks.PostToolUse)) {
    hooks.PostToolUse = [];
  }
  const postToolUseList = hooks.PostToolUse as Array<Record<string, unknown>>;
  if (!postToolUseList.some((entry) => matchesClaudeHookEntry(entry, 'hook post-tool'))) {
    postToolUseList.push({
      matcher: '*',
      hooks: [{ type: 'command', command: postToolCmd }],
    });
  }

  if (!Array.isArray(hooks.Stop)) {
    hooks.Stop = [];
  }
  const officialStopList = hooks.Stop as Array<Record<string, unknown>>;
  if (!officialStopList.some((entry) => matchesClaudeHookEntry(entry, 'hook stop'))) {
    officialStopList.push({
      hooks: [{ type: 'command', command: stopCmd }],
    });
  }

  // Backward-compatible flat keys (post-tool / stop)
  if (!Array.isArray(hooks['post-tool'])) {
    hooks['post-tool'] = [];
  }
  const postList = hooks['post-tool'] as Array<Record<string, unknown>>;
  const hasPost = postList.some((entry) => matchesClaudeHookEntry(entry, 'hook post-tool'));
  if (!hasPost) {
    postList.push({ command: postToolCmd });
  }

  if (!Array.isArray(hooks['stop'])) {
    hooks['stop'] = [];
  }
  const stopList = hooks['stop'] as Array<Record<string, unknown>>;
  const hasStop = stopList.some((entry) => matchesClaudeHookEntry(entry, 'hook stop'));
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
      for (const [key, needle] of [
        ['PreToolUse', 'hook pre-tool'],
        ['pre-tool', 'hook pre-tool'],
        ['PostToolUse', 'hook post-tool'],
        ['post-tool', 'hook post-tool'],
        ['Stop', 'hook stop'],
        ['stop', 'hook stop'],
      ] as const) {
        if (Array.isArray(hooks[key])) {
          const nextEntries: Array<Record<string, unknown>> = [];
          for (const entry of hooks[key] as Array<Record<string, unknown>>) {
            if (Array.isArray(entry?.hooks)) {
              const origInner = entry.hooks as Array<Record<string, unknown>>;
              const filteredInner = origInner.filter(
                (h) => !(typeof h?.command === 'string' && isEvoHookCommand(h.command, needle))
              );
              if (filteredInner.length === origInner.length) {
                nextEntries.push(entry);
              } else {
                modified = true;
                if (filteredInner.length > 0) {
                  nextEntries.push({ ...entry, hooks: filteredInner });
                }
              }
            } else if (matchesClaudeHookEntry(entry, needle)) {
              modified = true;
            } else {
              nextEntries.push(entry);
            }
          }
          hooks[key] = nextEntries;
          if (nextEntries.length === 0) {
            delete hooks[key];
          }
        }
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

export function syncDeclaredPreToolHooks(workspaceRoot: string): void {
  const storage = new EvoStorage(workspaceRoot);
  const evoExists = fs.existsSync(storage.evoDir);
  const preToolTools = evoExists
    ? storage.listTools().filter((t) => t.hook_trigger?.event === 'pre-tool')
    : [];

  let matcher = '*';
  if (preToolTools.length > 0) {
    const hasWildcardOrEmpty = preToolTools.some(
      (t) =>
        !t.hook_trigger?.tools ||
        t.hook_trigger.tools.length === 0 ||
        t.hook_trigger.tools.includes('*')
    );
    if (!hasWildcardOrEmpty) {
      const toolNames = new Set<string>();
      for (const t of preToolTools) {
        for (const name of t.hook_trigger?.tools || []) {
          for (const part of name.split('|')) {
            const trimmed = part.trim();
            if (trimmed) toolNames.add(trimmed);
          }
        }
      }
      matcher = Array.from(toolNames).join('|') || '*';
    }
  }

  const preToolCmd = resolveEvoHookCommand(workspaceRoot, 'pre-tool');

  // 1. Claude Code (.claude/settings.json & .claude/settings.local.json)
  const syncClaudeSettingsFile = (targetSettingsPath: string) => {
    try {
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(targetSettingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(targetSettingsPath, 'utf8')) as Record<string, unknown>;
        } catch {
          // Corrupt/unparseable user settings: never overwrite (data-loss guard).
          return;
        }
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
          return;
        }
      }

      if (settings.hooks && typeof settings.hooks === 'object') {
        const hooks = settings.hooks as Record<string, unknown>;

        if (Array.isArray(hooks.PreToolUse)) {
          const nextList: Array<Record<string, unknown>> = [];
          for (const entry of hooks.PreToolUse as Array<Record<string, unknown>>) {
            if (Array.isArray(entry?.hooks)) {
              const origInner = entry.hooks as Array<Record<string, unknown>>;
              const filteredInner = origInner.filter(
                (h) => !(typeof h?.command === 'string' && isEvoHookCommand(h.command, 'hook pre-tool'))
              );
              if (filteredInner.length === origInner.length) {
                nextList.push(entry);
              } else if (filteredInner.length > 0) {
                nextList.push({ ...entry, hooks: filteredInner });
              }
            } else if (!matchesClaudeHookEntry(entry, 'hook pre-tool')) {
              nextList.push(entry);
            }
          }
          hooks.PreToolUse = nextList;
        }

        if (Array.isArray(hooks['pre-tool'])) {
          const nextFlat: Array<Record<string, unknown>> = [];
          for (const entry of hooks['pre-tool'] as Array<Record<string, unknown>>) {
            if (Array.isArray(entry?.hooks)) {
              const origInner = entry.hooks as Array<Record<string, unknown>>;
              const filteredInner = origInner.filter(
                (h) => !(typeof h?.command === 'string' && isEvoHookCommand(h.command, 'hook pre-tool'))
              );
              if (filteredInner.length === origInner.length) {
                nextFlat.push(entry);
              } else if (filteredInner.length > 0) {
                nextFlat.push({ ...entry, hooks: filteredInner });
              }
            } else if (!matchesClaudeHookEntry(entry, 'hook pre-tool')) {
              nextFlat.push(entry);
            }
          }
          hooks['pre-tool'] = nextFlat;
        }

        if (preToolTools.length > 0) {
          if (!Array.isArray(hooks.PreToolUse)) hooks.PreToolUse = [];
          (hooks.PreToolUse as Array<Record<string, unknown>>).push({
            matcher,
            hooks: [{ type: 'command', command: preToolCmd }],
          });

          if (!Array.isArray(hooks['pre-tool'])) hooks['pre-tool'] = [];
          (hooks['pre-tool'] as Array<Record<string, unknown>>).push({
            command: preToolCmd,
          });
        } else {
          if (Array.isArray(hooks.PreToolUse) && hooks.PreToolUse.length === 0) {
            delete hooks.PreToolUse;
          }
          if (Array.isArray(hooks['pre-tool']) && hooks['pre-tool'].length === 0) {
            delete hooks['pre-tool'];
          }
          if (Object.keys(hooks).length === 0) {
            delete settings.hooks;
          }
        }

        fs.writeFileSync(targetSettingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      } else if (preToolTools.length > 0) {
        settings.hooks = {
          PreToolUse: [
            {
              matcher,
              hooks: [{ type: 'command', command: preToolCmd }],
            },
          ],
          'pre-tool': [
            {
              command: preToolCmd,
            },
          ],
        };
        fs.writeFileSync(targetSettingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      }
    } catch {
      // ignore errors
    }
  };

  const claudeSettingsPath = path.join(workspaceRoot, '.claude', 'settings.json');
  const claudeLocalSettingsPath = path.join(workspaceRoot, '.claude', 'settings.local.json');

  if (fs.existsSync(claudeSettingsPath)) {
    syncClaudeSettingsFile(claudeSettingsPath);
  }

  if (fs.existsSync(claudeLocalSettingsPath)) {
    const shouldSyncLocal =
      !fs.existsSync(claudeSettingsPath) ||
      (() => {
        try {
          const raw = fs.readFileSync(claudeLocalSettingsPath, 'utf8');
          const parsedLocal = JSON.parse(raw) as Record<string, unknown>;
          if (
            parsedLocal &&
            typeof parsedLocal === 'object' &&
            parsedLocal.hooks &&
            typeof parsedLocal.hooks === 'object'
          ) {
            const hooks = parsedLocal.hooks as Record<string, unknown>;
            for (const key of Object.keys(hooks)) {
              if (Array.isArray(hooks[key])) {
                for (const entry of hooks[key] as Array<Record<string, unknown>>) {
                  if (matchesClaudeHookEntry(entry, '')) {
                    return true;
                  }
                }
              }
            }
          }
          return false;
        } catch {
          return false;
        }
      })();

    if (shouldSyncLocal) {
      syncClaudeSettingsFile(claudeLocalSettingsPath);
    }
  }

  // 2. Codex (.codex/hooks.json) - ONLY if .codex directory exists
  const codexDir = path.join(workspaceRoot, '.codex');
  if (fs.existsSync(codexDir)) {
    const codexHooksPath = path.join(codexDir, 'hooks.json');
    try {
      if (preToolTools.length > 0) {
        let parsed: Record<string, unknown> = { hooks: {} };
        if (fs.existsSync(codexHooksPath)) {
          // Corrupt/unparseable or non-object user file: never overwrite (data-loss guard).
          // JSON.parse errors propagate to the outer catch, aborting the Codex sync.
          parsed = JSON.parse(fs.readFileSync(codexHooksPath, 'utf8'));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('codex hooks.json is not a JSON object');
          }
        }
        if (!parsed.hooks || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) {
          parsed.hooks = {};
        }
        const hooks = parsed.hooks as Record<string, unknown>;

        const existingList = Array.isArray(hooks.PreToolUse)
          ? (hooks.PreToolUse as Array<Record<string, unknown>>)
          : [];
        const nextList: Array<Record<string, unknown>> = [];
        for (const entry of existingList) {
          if (Array.isArray(entry?.hooks)) {
            const origInner = entry.hooks as Array<Record<string, unknown>>;
            const inner = origInner.filter(
              (h) => !(typeof h?.command === 'string' && isEvoHookCommand(h.command, 'hook pre-tool'))
            );
            if (inner.length === origInner.length) {
              nextList.push(entry);
            } else if (inner.length > 0) {
              nextList.push({ ...entry, hooks: inner });
            }
          } else if (!(typeof entry?.command === 'string' && isEvoHookCommand(entry.command, 'hook pre-tool'))) {
            nextList.push(entry);
          }
        }
        nextList.push({
          matcher,
          hooks: [{ type: 'command', command: preToolCmd }],
        });
        hooks.PreToolUse = nextList;

        fs.writeFileSync(codexHooksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      } else if (fs.existsSync(codexHooksPath)) {
        // Unparseable user file: JSON.parse throws to the outer catch so the file is
        // neither rewritten nor unlinked (data-loss guard).
        const parsed = JSON.parse(fs.readFileSync(codexHooksPath, 'utf8')) as Record<string, unknown>;
        let modified = false;
        if (
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          parsed.hooks &&
          typeof parsed.hooks === 'object'
        ) {
          const hooks = parsed.hooks as Record<string, unknown>;
          if (Array.isArray(hooks.PreToolUse)) {
            const nextList: Array<Record<string, unknown>> = [];
            for (const entry of hooks.PreToolUse as Array<Record<string, unknown>>) {
              if (Array.isArray(entry?.hooks)) {
                const origInner = entry.hooks as Array<Record<string, unknown>>;
                const inner = origInner.filter(
                  (h) => !(typeof h?.command === 'string' && isEvoHookCommand(h.command, 'hook pre-tool'))
                );
                if (inner.length === origInner.length) {
                  nextList.push(entry);
                } else {
                  modified = true;
                  if (inner.length > 0) nextList.push({ ...entry, hooks: inner });
                }
              } else if (!(typeof entry?.command === 'string' && isEvoHookCommand(entry.command, 'hook pre-tool'))) {
                nextList.push(entry);
              } else {
                modified = true;
              }
            }
            if (modified) {
              if (nextList.length > 0) {
                hooks.PreToolUse = nextList;
              } else {
                delete hooks.PreToolUse;
              }
              if (Object.keys(hooks).length === 0) {
                delete parsed.hooks;
              }
            }
          }
        }
        if (modified) {
          if (Object.keys(parsed).length === 0) {
            fs.unlinkSync(codexHooksPath);
          } else {
            fs.writeFileSync(codexHooksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          }
        }
      }
    } catch {
      // ignore
    }
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
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) {
      current = parseJsonc(raw, filePath) as Record<string, unknown>;
    }
  }

  const launch = resolveEvoMcpLaunchConfig(workspaceRoot);
  const openCodeMcpEntry = {
    type: 'local',
    command: [launch.command, ...launch.args],
    enabled: true,
  };

  const mcp =
    current.mcp && typeof current.mcp === 'object'
      ? (current.mcp as Record<string, unknown>)
      : {};
  mcp['evo-kernel'] = openCodeMcpEntry;
  current.mcp = mcp;

  const updatedFiles: string[] = [];

  if (typeof current.instructions === 'string') {
    current.instructions = upsertMarkerBlock(current.instructions, managedBlock);
    updatedFiles.push('opencode.json');
  } else {
    let targetFiles: string[] = [];
    if (typeof current.instructionsFile === 'string' && current.instructionsFile.trim()) {
      targetFiles.push(current.instructionsFile.trim());
      delete current.instructionsFile;
    }
    if (Array.isArray(current.instructions)) {
      for (const item of current.instructions) {
        if (typeof item === 'string' && item.trim() && !targetFiles.includes(item.trim())) {
          targetFiles.push(item.trim());
        }
      }
    }
    if (targetFiles.length === 0) {
      targetFiles = ['AGENTS.md'];
    }
    current.instructions = targetFiles;

    for (const relFile of targetFiles) {
      const fullPath = path.join(workspaceRoot, relFile);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      let existingContent = '';
      if (fs.existsSync(fullPath)) {
        try {
          existingContent = fs.readFileSync(fullPath, 'utf8');
        } catch {
          existingContent = '';
        }
      }
      const updated = upsertMarkerBlock(existingContent, managedBlock);
      fs.writeFileSync(fullPath, updated, 'utf8');
      updatedFiles.push(relFile);
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(current, null, 2) + '\n', 'utf8');
  return { updatedFiles, mcpConfigFiles: ['opencode.json'] };
}

export function removeOpenCode(filePath: string, workspaceRoot: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const cleaned: string[] = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return [];
    const parsed = parseJsonc(raw, filePath) as Record<string, unknown>;
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
      const cleanedInstructions = removeMarkerBlock(parsed.instructions);
      modified = true;
      if (!cleanedInstructions.trim()) {
        delete parsed.instructions;
      } else {
        parsed.instructions = cleanedInstructions;
      }
    }

    if (Array.isArray(parsed.instructions)) {
      const remaining: string[] = [];
      for (const relFile of parsed.instructions) {
        if (typeof relFile !== 'string' || !relFile.trim()) continue;
        const targetPath = path.join(workspaceRoot, relFile);
        if (fs.existsSync(targetPath)) {
          const c = fs.readFileSync(targetPath, 'utf8');
          if (c.includes(META_RULE_MARKER_START)) {
            const next = removeMarkerBlock(c);
            if (!next.trim()) {
              try {
                fs.unlinkSync(targetPath);
              } catch {}
              modified = true;
            } else {
              fs.writeFileSync(targetPath, next, 'utf8');
              remaining.push(relFile);
            }
            cleaned.push(relFile);
          } else {
            remaining.push(relFile);
          }
        } else {
          modified = true;
        }
      }
      if (remaining.length === 0) {
        delete parsed.instructions;
        modified = true;
      } else if (remaining.length !== parsed.instructions.length) {
        parsed.instructions = remaining;
        modified = true;
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
            delete parsed.instructionsFile;
            modified = true;
          } else {
            fs.writeFileSync(targetPath, next, 'utf8');
          }
          cleaned.push(String(parsed.instructionsFile));
        }
      } else {
        delete parsed.instructionsFile;
        modified = true;
      }
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
  mcpFiles = ['.mcp.json', '.claude/settings.json'];
  dirs = ['.claude/commands', '.claude'];

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

    const commandFiles = upsertSlashCommands(path.join(ws, '.claude', 'commands'));

    return {
      updatedFiles: ['CLAUDE.md'],
      mcpConfigFiles: ['.mcp.json', '.claude/settings.json'],
      commandFiles: commandFiles.map((f) => path.relative(ws, f).replace(/\\/g, '/')),
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'CLAUDE.md'))) cleaned.push('CLAUDE.md');
    if (removeMcpJson(path.join(ws, '.mcp.json'))) cleaned.push('.mcp.json');
    if (removeClaudeSettings(path.join(ws, '.claude', 'settings.json'))) cleaned.push('.claude/settings.json');
    if (removeClaudeSettings(path.join(ws, '.claude', 'settings.local.json'))) cleaned.push('.claude/settings.local.json');
    cleanSlashCommands(path.join(ws, '.claude', 'commands'));
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export class CursorAdapter implements HarnessAdapter {
  id = 'cursor';
  name = 'Cursor';
  ruleFiles = ['.cursor/rules/evo-kernel.mdc'];
  mcpFiles = ['.cursor/mcp.json'];
  dirs = ['.cursor/commands', '.cursor/rules', '.cursor'];

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

    const commandFiles = upsertSlashCommands(path.join(ws, '.cursor', 'commands'));

    return {
      updatedFiles: ['.cursor/rules/evo-kernel.mdc'],
      mcpConfigFiles: ['.cursor/mcp.json'],
      commandFiles: commandFiles.map((f) => path.relative(ws, f).replace(/\\/g, '/')),
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
    cleanSlashCommands(path.join(ws, '.cursor', 'commands'));
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
    return Boolean(env.WINDSURF_PID || env.WINDSURF_VERSION);
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
      fs.existsSync(path.join(ws, '.vscode', 'mcp.json'))
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
    return Boolean(env.CODEX_CLI || env.CODEX_HOME);
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

    try {
      syncDeclaredPreToolHooks(ws);
    } catch {
      // ignore hook sync errors during install
    }

    return {
      updatedFiles: ['AGENTS.md'],
      mcpConfigFiles: ['.codex/config.toml'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'AGENTS.md'))) cleaned.push('AGENTS.md');
    if (removeCodexToml(path.join(ws, '.codex', 'config.toml'))) cleaned.push('.codex/config.toml');

    const codexHooksPath = path.join(ws, '.codex', 'hooks.json');
    if (fs.existsSync(codexHooksPath)) {
      try {
        const raw = fs.readFileSync(codexHooksPath, 'utf8');
        const parsed = JSON.parse(raw);
        let modified = false;
        if (parsed && typeof parsed === 'object' && parsed.hooks && typeof parsed.hooks === 'object') {
          const hooks = parsed.hooks as Record<string, unknown>;
          for (const ev of Object.keys(hooks)) {
            if (Array.isArray(hooks[ev])) {
              const origList = hooks[ev] as Array<Record<string, unknown>>;
              const nextList: Array<Record<string, unknown>> = [];
              for (const entry of origList) {
                if (Array.isArray(entry?.hooks)) {
                  const origInner = entry.hooks as Array<Record<string, unknown>>;
                  const inner = origInner.filter(
                    (h) => !(typeof h?.command === 'string' && isEvoHookCommand(h.command))
                  );
                  if (inner.length === origInner.length) {
                    nextList.push(entry);
                  } else {
                    modified = true;
                    if (inner.length > 0) {
                      nextList.push({ ...entry, hooks: inner });
                    }
                  }
                } else if (!(typeof entry?.command === 'string' && isEvoHookCommand(entry.command))) {
                  nextList.push(entry);
                } else {
                  modified = true;
                }
              }
              hooks[ev] = nextList;
              if (nextList.length === 0) {
                delete hooks[ev];
              }
            }
          }
          if (Object.keys(hooks).length === 0) {
            delete parsed.hooks;
            modified = true;
          }
        }
        if (Object.keys(parsed).length === 0) {
          modified = true;
        }
        if (modified) {
          if (Object.keys(parsed).length === 0) {
            fs.unlinkSync(codexHooksPath);
            cleaned.push('.codex/hooks.json');
          } else {
            fs.writeFileSync(codexHooksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
            cleaned.push('.codex/hooks.json');
          }
        }
      } catch {
        // ignore
      }
    }

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
  dirs = ['.gemini/commands', '.gemini'];

  detectWorkspace(ws: string): boolean {
    return (
      fs.existsSync(path.join(ws, 'GEMINI.md')) ||
      fs.existsSync(path.join(ws, '.gemini'))
    );
  }

  detectEnv(env: Record<string, string | undefined>): boolean {
    return Boolean(env.GEMINI_CLI || env.GEMINI_CLI_HOME);
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

    const commandFiles = upsertSlashCommands(path.join(ws, '.gemini', 'commands'));

    return {
      updatedFiles: ['GEMINI.md'],
      mcpConfigFiles: ['.gemini/settings.json'],
      commandFiles: commandFiles.map((f) => path.relative(ws, f).replace(/\\/g, '/')),
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'GEMINI.md'))) cleaned.push('GEMINI.md');
    if (removeMcpJson(path.join(ws, '.gemini', 'settings.json'))) cleaned.push('.gemini/settings.json');
    cleanSlashCommands(path.join(ws, '.gemini', 'commands'));
    pruneEmptyDirs(ws, this.dirs);
    return cleaned;
  }
}

export function upsertAntigravityHooks(ws: string): string[] {
  const updated: string[] = [];
  const srcScript = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'antigravity_hook.mjs');
  const destScriptDir = path.join(ws, '.agents', 'scripts');
  const destScript = path.join(destScriptDir, 'antigravity_hook.mjs');
  fs.mkdirSync(destScriptDir, { recursive: true });
  if (fs.existsSync(srcScript)) {
    fs.copyFileSync(srcScript, destScript);
    updated.push('.agents/scripts/antigravity_hook.mjs');
  }

  const hooksPath = path.join(ws, '.agents', 'hooks.json');
  let hooksObj: Record<string, unknown> = {};
  if (fs.existsSync(hooksPath)) {
    try {
      const raw = fs.readFileSync(hooksPath, 'utf8');
      const parsed: unknown = parseJsonc(raw, hooksPath);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('hooks root is not a JSON object');
      }
      hooksObj = parsed as Record<string, unknown>;
    } catch {
      // Data-loss guard: never overwrite a user's unparseable / non-object hooks file.
      console.warn(
        `[EvoKernel Warning] Skipped Antigravity hook wiring: ${hooksPath} is not a valid JSON object; fix it and re-run evo init.`
      );
      return updated;
    }
  }

  const makeHookCmd = (event: 'PreInvocation' | 'Stop') =>
    `node -e "const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),url=require('node:url'),p=[path.resolve('scripts/antigravity_hook.mjs'),path.resolve('.agents/scripts/antigravity_hook.mjs'),path.join(os.homedir(),'.gemini','config','plugins','evo-kernel','scripts','antigravity_hook.mjs'),path.join(os.homedir(),'.gemini','extensions','evo-kernel','scripts','antigravity_hook.mjs')].find(f=>fs.existsSync(f));if(p){process.argv=[process.argv[0],p,'${event}'];import(url.pathToFileURL(p).href);}else{process.stdout.write('{}\\n');}"`;

  hooksObj['evo-evolution-reminder'] = {
    PreInvocation: [
      {
        type: 'command',
        command: makeHookCmd('PreInvocation'),
        timeout: 5,
      },
    ],
    Stop: [
      {
        type: 'command',
        command: makeHookCmd('Stop'),
        timeout: 5,
      },
    ],
  };

  fs.writeFileSync(hooksPath, JSON.stringify(hooksObj, null, 2) + '\n', 'utf8');
  updated.push('.agents/hooks.json');
  return updated;
}

export function removeAntigravityHooks(ws: string): string[] {
  const cleaned: string[] = [];
  const destScript = path.join(ws, '.agents', 'scripts', 'antigravity_hook.mjs');
  if (fs.existsSync(destScript)) {
    try {
      fs.unlinkSync(destScript);
      cleaned.push('.agents/scripts/antigravity_hook.mjs');
    } catch {
      // Ignore unlink error
    }
  }

  const hooksPath = path.join(ws, '.agents', 'hooks.json');
  if (fs.existsSync(hooksPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'evo-evolution-reminder' in parsed) {
        delete (parsed as Record<string, unknown>)['evo-evolution-reminder'];
        if (Object.keys(parsed).length === 0) {
          fs.unlinkSync(hooksPath);
        } else {
          fs.writeFileSync(hooksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
        }
        cleaned.push('.agents/hooks.json');
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return cleaned;
}

export class AntigravityAdapter implements HarnessAdapter {
  id = 'antigravity';
  name = 'Antigravity';
  ruleFiles = ['GEMINI.md', '.agents/hooks.json', '.agents/scripts/antigravity_hook.mjs'];
  mcpFiles = ['.mcp.json'];
  dirs: string[] = ['.agents/scripts', '.agents'];

  detectWorkspace(ws: string): boolean {
    return fs.existsSync(path.join(ws, '.agents'));
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

    const rootMcp = path.join(ws, '.mcp.json');
    upsertMcpJson(rootMcp, ws);

    const hookFiles = upsertAntigravityHooks(ws);

    return {
      updatedFiles: ['GEMINI.md', ...hookFiles],
      mcpConfigFiles: ['.mcp.json'],
    };
  }

  uninstall(ws: string): string[] {
    const cleaned: string[] = [];
    if (cleanRuleFile(path.join(ws, 'GEMINI.md'))) cleaned.push('GEMINI.md');
    if (removeMcpJson(path.join(ws, '.mcp.json'))) cleaned.push('.mcp.json');
    cleaned.push(...removeAntigravityHooks(ws));
    pruneEmptyDirs(ws, this.dirs);
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
  const unknownTokens: string[] = [];
  for (const token of tokens) {
    const mapped = normalizeTargetToken(token);
    if (mapped) {
      normalized.add(mapped);
    } else {
      unknownTokens.push(token);
    }
  }

  if (unknownTokens.length > 0) {
    console.warn(
      `[EvoKernel Warning] Unknown harness target(s) ignored: ${unknownTokens.join(', ')}. Valid targets are: ${allTargets.join(', ')}`
    );
  }

  if (normalized.size > 0) {
    return Array.from(normalized);
  }

  return detectCascadedTargets(workspaceRoot, env, homeDir);
}
