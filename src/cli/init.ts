import * as fs from 'node:fs';
import * as path from 'node:path';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import {
  META_RULE_MARKER_END,
  META_RULE_MARKER_START,
  renderManagedBlock,
} from '../templates/meta-rule.js';

export interface InitResult {
  initializedHarnesses: string[];
  updatedFiles: string[];
  mcpConfigFiles: string[];
  stealthExcluded?: string[];
}

export interface InitOptions {
  targets?: string[];
  stealth?: boolean;
}

const HARNESS_RULE_TARGETS: Record<string, string> = {
  claude: 'CLAUDE.md',
  agents: 'AGENTS.md',
  gemini: 'GEMINI.md',
  cursor: '.cursor/rules/evo-kernel.mdc',
};

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

export function syncManagedRuleBlocks(workspaceRoot: string): string[] {
  const storage = new EvoStorage(workspaceRoot);
  const digest = storage.rebuildCoreInvariantsDigest();
  const block = renderManagedBlock(digest);
  const updated: string[] = [];

  for (const relPath of Object.values(HARNESS_RULE_TARGETS)) {
    const fullPath = path.join(workspaceRoot, relPath);
    if (fs.existsSync(fullPath)) {
      const current = fs.readFileSync(fullPath, 'utf8');
      if (current.includes(META_RULE_MARKER_START)) {
        const next = upsertMarkerBlock(current, block);
        fs.writeFileSync(fullPath, next, 'utf8');
        updated.push(relPath);
      }
    }
  }
  return updated;
}

export function ensureGitInfoExclude(workspaceRoot: string, patterns: string[]): string[] {
  const gitInfoDir = path.join(workspaceRoot, '.git', 'info');
  if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
    return [];
  }
  fs.mkdirSync(gitInfoDir, { recursive: true });
  const excludePath = path.join(gitInfoDir, 'exclude');
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  const existingLines = new Set(
    existing
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  );

  const added: string[] = [];
  for (const pat of patterns) {
    if (!existingLines.has(pat)) {
      added.push(pat);
    }
  }

  if (added.length > 0) {
    const block = [
      existing.trimEnd(),
      '# EvoKernel Stealth Mode (Local-only exclude — never touches .gitignore or remote whitelist)',
      ...added,
      '',
    ]
      .filter((s, idx) => !(idx === 0 && !s))
      .join('\n');
    fs.writeFileSync(excludePath, block, 'utf8');
  }
  return added;
}

export function runInit(
  workspaceRoot: string,
  targetsOrOptions: string[] | InitOptions = ['claude', 'agents', 'gemini', 'cursor']
): InitResult {
  const opts: InitOptions = Array.isArray(targetsOrOptions)
    ? { targets: targetsOrOptions, stealth: false }
    : targetsOrOptions;
  const targets = opts.targets ?? ['claude', 'agents', 'gemini', 'cursor'];
  const stealth = Boolean(opts.stealth);

  const storage = new EvoStorage(workspaceRoot);
  const config = storage.ensureInitialized();
  const telemetry = new EvoTelemetry(storage);
  telemetry.syncFromDisk();
  telemetry.close();

  const digest = storage.rebuildCoreInvariantsDigest();
  const managedBlock = renderManagedBlock(digest);
  const updatedFiles: string[] = [];

  for (const target of targets) {
    const relPath = HARNESS_RULE_TARGETS[target];
    if (!relPath) continue;
    const fullPath = path.join(workspaceRoot, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    let existing = '';
    if (fs.existsSync(fullPath)) {
      existing = fs.readFileSync(fullPath, 'utf8');
    } else if (target === 'cursor') {
      existing = [
        '---',
        'description: EvoKernel Deterministic Self-Evolution Protocol & Core Invariants',
        'globs: **/*',
        'alwaysApply: true',
        '---',
      ].join('\n');
    }

    const updated = upsertMarkerBlock(existing, managedBlock);
    fs.writeFileSync(fullPath, updated, 'utf8');
    updatedFiles.push(relPath);
  }

  config.enabledHarnesses = Array.from(new Set([...config.enabledHarnesses, ...targets]));
  storage.saveConfig(config);

  const mcpConfigFiles: string[] = [];
  const mcpPath = path.join(workspaceRoot, '.mcp.json');
  upsertMcpJson(mcpPath, workspaceRoot);
  mcpConfigFiles.push('.mcp.json');

  if (targets.includes('cursor')) {
    const cursorMcpPath = path.join(workspaceRoot, '.cursor', 'mcp.json');
    upsertMcpJson(cursorMcpPath, workspaceRoot);
    mcpConfigFiles.push('.cursor/mcp.json');
  }

  // Always exclude .evo/.cache/ in .git/info/exclude if .git exists; in --stealth mode, exclude all EvoKernel artifacts locally
  const excludeCandidates = stealth
    ? ['.evo/', '.mcp.json', '.cursor/', ...updatedFiles]
    : ['.evo/.cache/'];
  const stealthExcluded = ensureGitInfoExclude(workspaceRoot, excludeCandidates);

  return {
    initializedHarnesses: targets,
    updatedFiles,
    mcpConfigFiles,
    stealthExcluded,
  };
}

function upsertMcpJson(filePath: string, workspaceRoot: string): void {
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

export function runUninstall(workspaceRoot: string): { cleanedFiles: string[] } {
  const cleanedFiles: string[] = [];
  for (const relPath of Object.values(HARNESS_RULE_TARGETS)) {
    const fullPath = path.join(workspaceRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.includes(META_RULE_MARKER_START)) {
      const next = removeMarkerBlock(content);
      if (!next.trim() || relPath.endsWith('evo-kernel.mdc')) {
        fs.unlinkSync(fullPath);
      } else {
        fs.writeFileSync(fullPath, next, 'utf8');
      }
      cleanedFiles.push(relPath);
    }
  }

  for (const mcpRel of ['.mcp.json', '.cursor/mcp.json']) {
    const mcpFull = path.join(workspaceRoot, mcpRel);
    if (!fs.existsSync(mcpFull)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpFull, 'utf8')) as Record<string, unknown>;
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        delete (parsed.mcpServers as Record<string, unknown>)['evo-kernel'];
        fs.writeFileSync(mcpFull, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
        cleanedFiles.push(mcpRel);
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return { cleanedFiles };
}
