import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ArchivedCapabilityEntry,
  ConfidenceLevel,
  EvoConfig,
  EvoHookTrigger,
  EvoKind,
  EvoMemory,
  EvoPreference,
  EvoRule,
  EvoSkill,
  EvoTool,
  EvoToolManifest,
  ExternalToolDefinition,
  PreferenceCategory,
  ProfileHistoryEntry,
  ScriptRuntime,
  SymbolFingerprint,
} from './types.js';
import { renderUserProfileBlock } from '../templates/meta-rule.js';

export const EVO_KERNEL_VERSION = '0.4.0';

/**
 * Measured token footprint of the immutable 5-tool Meta-MCP JSON Schema
 * (`Math.ceil(JSON.stringify(META_MCP_TOOLS).length / 3.8)` = 1,953 tokens).
 */
export const META_MCP_5_TOOLS_TOKENS = 1953;

/**
 * Opens an existing SQLite database in read-only mode when supported (Node >=22.12),
 * falling back safely to `new DatabaseSync(dbPath)` on Node 22.5–22.11 without creating new files.
 */
export function openSqliteReadOnly(
  dbPath: string,
  DbCtor: new (location: string, options?: Record<string, unknown>) => DatabaseSync = DatabaseSync as any
): DatabaseSync {
  if (!fs.existsSync(dbPath)) {
    const missingErr: NodeJS.ErrnoException = new Error(`SQLite database does not exist: ${dbPath}`);
    missingErr.code = 'ENOENT';
    throw missingErr;
  }
  let db: DatabaseSync;
  let usedFallbackReadWrite = false;
  try {
    db = new DbCtor(dbPath, { readOnly: true });
  } catch (err: any) {
    const code = String(err?.code || '');
    const isUnsupportedOption =
      err instanceof TypeError ||
      code.startsWith('ERR_INVALID_ARG') ||
      (!code.startsWith('ERR_SQLITE') && /readonly|options|unknown|invalid/i.test(String(err?.message || '')));
    if (!isUnsupportedOption) {
      throw err;
    }
    db = new DbCtor(dbPath);
    usedFallbackReadWrite = true;
  }
  if (db && typeof (db as any).exec === 'function') {
    if (usedFallbackReadWrite) {
      try { (db as any).exec('PRAGMA query_only = ON;'); } catch {}
    }
    try { (db as any).exec('PRAGMA busy_timeout = 3000;'); } catch {}
  }
  return db;
}

export const DEFAULT_EVO_CONFIG: EvoConfig = {
  version: EVO_KERNEL_VERSION,
  maxCoreRuleTokens: 1500,
  maxGlobalProfileTokens: 800,
  maxDirectoryMenuTokens: 250,
  maxScopedRulesPerBucket: 3,
  maxTotalScopedRules: 12,
  maxL0SummaryChars: 140,
  duplicateBm25Threshold: 0.68,
  sandboxTimeoutMs: 5000,
  enabledHarnesses: [],
};

export const PREFERENCE_CATEGORIES: readonly PreferenceCategory[] = [
  'style',
  'formatting',
  'communication',
  'workflow',
  'requirement',
  'knowledge',
] as const;

export const PREFERENCE_CATEGORY_LABELS: Record<PreferenceCategory, string> = {
  style: 'Style',
  formatting: 'Formatting',
  communication: 'Communication',
  workflow: 'Workflow',
  requirement: 'Requirement',
  knowledge: 'Knowledge',
};

export function resolveGlobalFallbackDir(customGlobalDir?: string): string {
  if (customGlobalDir) {
    return path.resolve(customGlobalDir);
  }
  if (process.env.EVO_GLOBAL_DIR) {
    return path.resolve(process.env.EVO_GLOBAL_DIR);
  }
  return path.join(os.homedir(), '.evo', 'global');
}

export function getScopeBucketKey(scopeGlob: string): string {
  const norm = (scopeGlob || '**/*')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '');
  if (!norm || norm === '**/*' || norm === '*') {
    return 'global';
  }
  const segments = norm.split('/').filter(Boolean);
  const first = segments[0] || '';
  if (!/[*?[\]{}]/.test(first)) {
    const second = segments[1] || '';
    if (
      segments.length >= 2 &&
      !/[*?[\]{}]/.test(second) &&
      ['src', 'source', 'app', 'packages', 'lib'].includes(first.toLowerCase())
    ) {
      return `${first.toLowerCase()}/${second.toLowerCase()}`;
    }
    return first.toLowerCase();
  }
  const extMatch = norm.match(/\*(\.(?:[a-zA-Z0-9_]+|\{[a-zA-Z0-9_,]+\}))$/);
  if (extMatch) {
    return `ext:${extMatch[1].toLowerCase()}`;
  }
  return 'global';
}

const IDE_PLUGIN_DIR_REGEX =
  /\/(?:\.(?:gemini|claude|cursor|vscode|vscode-server|windsurf|antigravity|roo|cline|codex|opencode)\/(?:[^/]+\/)*(?:plugins|extensions|mcp)|\.claude-plugin|\.evo\/global|(?:appdata\/(?:roaming|local)|library\/application\s+support|\.config|\.local\/share)\/(?:[^/]+\/)*(?:plugins|extensions))(?:\/|$)/i;

const HOST_GLOBAL_CONFIG_DIRS = new Set([
  '.gemini',
  '.claude',
  '.cursor',
  '.windsurf',
  '.codex',
  '.roo',
  '.cline',
  '.opencode',
  '.antigravity',
]);

export function isHostGlobalConfigDir(dirPath: string, customHome?: string): boolean {
  try {
    const home = path.resolve(customHome || os.homedir()).replace(/\\/g, '/').toLowerCase();
    const norm = path.resolve(dirPath).replace(/\\/g, '/').toLowerCase();
    if (!norm.startsWith(home + '/')) {
      return false;
    }
    const rel = norm.slice(home.length + 1);
    const firstSeg = rel.split('/')[0] || '';
    return HOST_GLOBAL_CONFIG_DIRS.has(firstSeg);
  } catch {
    return false;
  }
}

export function isPluginOrExtensionInstallDir(dirPath: string): boolean {
  const norm = path.resolve(dirPath).replace(/\\/g, '/').toLowerCase();
  if (
    norm.endsWith('/.evo/global') ||
    (process.env.EVO_GLOBAL_DIR &&
      (norm === path.resolve(process.env.EVO_GLOBAL_DIR).replace(/\\/g, '/').toLowerCase() ||
        norm.startsWith(path.resolve(process.env.EVO_GLOBAL_DIR).replace(/\\/g, '/').toLowerCase() + '/')))
  ) {
    return true;
  }
  if (isHostGlobalConfigDir(dirPath)) {
    return true;
  }
  return IDE_PLUGIN_DIR_REGEX.test(norm);
}

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

export function hasValidEvoStructure(candidateEvo: string): boolean {
  try {
    if (!fs.existsSync(candidateEvo) || !fs.statSync(candidateEvo).isDirectory()) {
      return false;
    }
    if (fs.existsSync(path.join(candidateEvo, 'global'))) {
      return false;
    }
    return (
      fs.existsSync(path.join(candidateEvo, 'config.json')) ||
      fs.existsSync(path.join(candidateEvo, 'rules')) ||
      fs.existsSync(path.join(candidateEvo, 'skills')) ||
      fs.existsSync(path.join(candidateEvo, 'tools')) ||
      fs.existsSync(path.join(candidateEvo, 'memories')) ||
      fs.existsSync(path.join(candidateEvo, 'preferences'))
    );
  } catch {
    return false;
  }
}

export function isHollowEvoZombieDir(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return false;
    }
    const evoDir = path.join(dirPath, '.evo');
    if (!fs.existsSync(evoDir) || !fs.statSync(evoDir).isDirectory()) {
      return false;
    }
    if (hasValidEvoStructure(evoDir)) {
      return false;
    }
    const rootEntries = fs.readdirSync(dirPath);
    const nonEvoEntries = rootEntries.filter((name) => name !== '.evo');
    if (nonEvoEntries.length === 0) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function findNearestEvoWorkspace(startDir: string): string | null {
  let current = path.resolve(startDir);
  const homeReal = safeRealpath(os.homedir()).toLowerCase();
  const tmpReal = safeRealpath(os.tmpdir()).toLowerCase();
  while (true) {
    if (isPluginOrExtensionInstallDir(current)) {
      return null;
    }
    const currentReal = safeRealpath(current).toLowerCase();
    if (currentReal === homeReal || currentReal === tmpReal) {
      break;
    }
    const candidateEvo = path.join(current, '.evo');
    if (hasValidEvoStructure(candidateEvo)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export function formatUserProfileDigestForPreferences(prefs: EvoPreference[]): string {
  const activeAlwaysOn = prefs.filter((p) => p.always_on !== false && p.enabled !== false);
  if (activeAlwaysOn.length === 0) {
    return '';
  }
  const sections: string[] = [];
  for (const cat of PREFERENCE_CATEGORIES) {
    const items = activeAlwaysOn.filter((p) => p.category === cat);
    if (items.length === 0) continue;
    const lines = items.map(
      (p) => `- **[${p.id}]** (${p.category}): ${p.l0_summary}\n  ${p.content.replace(/\n/g, '\n  ')}`
    );
    sections.push(`### ${PREFERENCE_CATEGORY_LABELS[cat]}\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjkCount++;
    }
  }
  const nonCjkLength = Math.max(0, text.length - cjkCount);
  return Math.ceil(cjkCount * 0.7 + nonCjkLength / 3.8);
}

export function sanitizeId(rawId: string): string {
  return rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseVisibility(val: unknown): 'local' | 'public' | undefined {
  return val === 'local' || val === 'public' ? val : undefined;
}

export function getExtensionForRuntime(runtime: ScriptRuntime): string {
  switch (runtime) {
    case 'node':
      return '.mjs';
    case 'python':
      return '.py';
    case 'powershell':
      return '.ps1';
    case 'bash':
      return '.sh';
  }
}

export function parseSkillSectionsFromMarkdown(markdown: string): {
  l1: string;
  l2: string;
  hasL1Header: boolean;
  hasL2Header: boolean;
} {
  const stripped = String(markdown || '')
    .trim()
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .trim();
  if (!stripped) {
    return { l1: '', l2: '', hasL1Header: false, hasL2Header: false };
  }

  const lines = stripped.split(/\r?\n/);
  const headers: Array<{ kind: 'l1' | 'l2'; lineIdx: number }> = [];
  let fenceChar: '`' | '~' | '' = '';
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const ch = marker[0] as '`' | '~';
      if (!fenceChar) {
        fenceChar = ch;
        fenceLen = marker.length;
        continue;
      }
      if (ch === fenceChar && marker.length >= fenceLen && fenceMatch[2].trim() === '') {
        fenceChar = '';
        fenceLen = 0;
        continue;
      }
    }
    if (fenceChar) continue;

    if (/^#{1,3}\s*L1(?:\s+Contract|\s+Overview)?\b/i.test(line)) {
      headers.push({ kind: 'l1', lineIdx: i });
    } else if (/^#{1,3}\s*L2(?:\s+SOP|\s+Procedure|\s+Body)?\b/i.test(line)) {
      headers.push({ kind: 'l2', lineIdx: i });
    }
  }

  const hasL1Header = headers.some((h) => h.kind === 'l1');
  const hasL2Header = headers.some((h) => h.kind === 'l2');

  let l1 = '';
  let l2 = '';
  for (let idx = 0; idx < headers.length; idx++) {
    const h = headers[idx];
    const startLine = h.lineIdx + 1;
    const endLine = idx + 1 < headers.length ? headers[idx + 1].lineIdx : lines.length;
    const sectionText = lines.slice(startLine, endLine).join('\n').trim();
    if (h.kind === 'l1' && !l1 && sectionText) {
      l1 = sectionText;
    } else if (h.kind === 'l2' && !l2 && sectionText) {
      l2 = sectionText;
    }
  }

  return { l1, l2, hasL1Header, hasL2Header };
}

export class EvoStorage {
  public readonly rootDir: string;

  public get workspaceRoot(): string {
    return this.rootDir;
  }
  public readonly localEvoDir: string;
  public readonly localConfigPath: string;
  public readonly isLinkedShared: boolean;
  public readonly evoDir: string;
  public readonly rulesDir: string;
  public readonly skillsDir: string;
  public readonly toolsDir: string;
  public readonly memoriesDir: string;
  public readonly preferencesDir: string;
  public readonly archiveDir: string;
  public readonly cacheDir: string;
  public readonly configPath: string;
  public readonly coreInvariantsPath: string;
  public readonly profileDigestPath: string;
  public readonly profileHistoryPath: string;

  public static resolveEffectiveEvoDir(rootDir: string, localEvoDir: string): string {
    const localConfigPath = path.join(localEvoDir, 'config.json');
    if (fs.existsSync(localConfigPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
        if (raw && typeof raw.sharedEvoDir === 'string' && raw.sharedEvoDir.trim()) {
          const candidate = path.resolve(rootDir, raw.sharedEvoDir.trim());
          const targetEvo =
            path.basename(candidate) === '.evo' ? candidate : path.join(candidate, '.evo');
          if (fs.existsSync(targetEvo)) {
            return targetEvo;
          }
        }
      } catch {
        // Ignore malformed local config and fall back to localEvoDir
      }
    }
    return localEvoDir;
  }

  constructor(workspaceRoot: string, customEvoDir?: string) {
    this.rootDir = path.resolve(workspaceRoot);
    const defaultLocalEvo = path.join(this.rootDir, '.evo');
    this.localEvoDir = defaultLocalEvo;
    this.localConfigPath = path.join(defaultLocalEvo, 'config.json');
    this.evoDir = customEvoDir
      ? path.resolve(customEvoDir)
      : process.env.EVO_DATA_DIR
        ? path.resolve(process.env.EVO_DATA_DIR)
        : EvoStorage.resolveEffectiveEvoDir(this.rootDir, defaultLocalEvo);
    this.isLinkedShared =
      !customEvoDir &&
      !process.env.EVO_DATA_DIR &&
      path.resolve(this.evoDir).toLowerCase() !== path.resolve(defaultLocalEvo).toLowerCase();
    this.rulesDir = path.join(this.evoDir, 'rules');
    this.skillsDir = path.join(this.evoDir, 'skills');
    this.toolsDir = path.join(this.evoDir, 'tools');
    this.memoriesDir = path.join(this.evoDir, 'memories');
    this.preferencesDir = path.join(this.evoDir, 'preferences');
    this.archiveDir = path.join(this.evoDir, 'archive');
    this.cacheDir = path.join(this.evoDir, '.cache');
    this.configPath = path.join(this.evoDir, 'config.json');
    this.coreInvariantsPath = path.join(this.rulesDir, 'core-invariants.md');
    this.profileDigestPath = path.join(this.evoDir, 'profile-digest.md');
    this.profileHistoryPath = path.join(this.evoDir, 'profile-history.jsonl');
  }

  public get telemetryDbPath(): string {
    return path.join(this.cacheDir, 'telemetry.db');
  }

  public ensureInitialized(): EvoConfig {
    for (const dir of [
      this.evoDir,
      this.rulesDir,
      path.join(this.rulesDir, 'scoped'),
      this.skillsDir,
      this.toolsDir,
      this.memoriesDir,
      this.preferencesDir,
      this.archiveDir,
      this.cacheDir,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, JSON.stringify(DEFAULT_EVO_CONFIG, null, 2), 'utf8');
    } else {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.maxCoreRuleTokens === 2400) {
          parsed.maxCoreRuleTokens = DEFAULT_EVO_CONFIG.maxCoreRuleTokens;
          fs.writeFileSync(this.configPath, JSON.stringify(parsed, null, 2), 'utf8');
        }
      } catch {
        // ignore malformed config during initialization
      }
    }

    const evoGitignore = path.join(this.evoDir, '.gitignore');
    if (!fs.existsSync(evoGitignore)) {
      fs.writeFileSync(evoGitignore, '/.cache/\n/archive/\n', 'utf8');
    }

    const legacyTopLevelTsRule = path.join(this.rulesDir, 'esm-typescript-imports.md');
    const canonicalScopedTsRule = path.join(this.rulesDir, 'scoped', 'esm-typescript-imports.md');
    if (fs.existsSync(legacyTopLevelTsRule)) {
      try {
        if (fs.existsSync(canonicalScopedTsRule)) {
          fs.unlinkSync(legacyTopLevelTsRule);
        } else {
          const raw = fs.readFileSync(legacyTopLevelTsRule, 'utf8');
          if (/^core:\s*false\b/m.test(raw)) {
            fs.renameSync(legacyTopLevelTsRule, canonicalScopedTsRule);
          }
        }
      } catch {}
    }

    return this.getConfig();
  }

  public getConfig(): EvoConfig {
    let base: EvoConfig = { ...DEFAULT_EVO_CONFIG };
    if (fs.existsSync(this.configPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        base = { ...base, ...parsed };
        if (parsed && parsed.maxCoreRuleTokens === 2400) {
          base.maxCoreRuleTokens = DEFAULT_EVO_CONFIG.maxCoreRuleTokens;
        }
      } catch {
        // ignore malformed shared/master config
      }
    }
    if (this.isLinkedShared) {
      base.enabledHarnesses = [];
      if (fs.existsSync(this.localConfigPath)) {
        try {
          const localParsed = JSON.parse(fs.readFileSync(this.localConfigPath, 'utf8'));
          if (typeof localParsed.sharedEvoDir === 'string') {
            base.sharedEvoDir = localParsed.sharedEvoDir;
          }
          if (Array.isArray(localParsed.enabledHarnesses)) {
            base.enabledHarnesses = localParsed.enabledHarnesses;
          }
        } catch {
          // ignore malformed local config
        }
      }
    }
    const mcpPoolPath = path.join(this.evoDir, 'mcp-pool.json');
    if (fs.existsSync(mcpPoolPath)) {
      try {
        const poolRaw = JSON.parse(fs.readFileSync(mcpPoolPath, 'utf8'));
        const poolServers = (poolRaw?.mcpServers || poolRaw?.externalServers) as
          | Record<string, { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }>
          | undefined;
        if (poolServers && typeof poolServers === 'object') {
          base.externalServers = {
            ...poolServers,
            ...(base.externalServers || {}),
          };
        }
      } catch {
        // ignore malformed mcp-pool.json
      }
    }
    return base;
  }

  public saveConfig(config: EvoConfig): void {
    fs.mkdirSync(this.evoDir, { recursive: true });
    if (this.isLinkedShared) {
      fs.mkdirSync(this.localEvoDir, { recursive: true });
      let localCfg: Record<string, unknown> = {};
      if (fs.existsSync(this.localConfigPath)) {
        try {
          localCfg = JSON.parse(fs.readFileSync(this.localConfigPath, 'utf8'));
        } catch {
          localCfg = {};
        }
      }
      if (config.sharedEvoDir) {
        localCfg.sharedEvoDir = config.sharedEvoDir;
      }
      if (Array.isArray(config.enabledHarnesses)) {
        localCfg.enabledHarnesses = config.enabledHarnesses;
      }
      fs.writeFileSync(this.localConfigPath, JSON.stringify(localCfg, null, 2) + '\n', 'utf8');

      let masterEnabledHarnesses = DEFAULT_EVO_CONFIG.enabledHarnesses;
      if (fs.existsSync(this.configPath)) {
        try {
          const masterRaw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
          if (Array.isArray(masterRaw.enabledHarnesses)) {
            masterEnabledHarnesses = masterRaw.enabledHarnesses;
          }
        } catch {
          // ignore
        }
      }
      const { sharedEvoDir: _omitShared, ...masterSafeConfig } = config;
      masterSafeConfig.enabledHarnesses = masterEnabledHarnesses;
      fs.writeFileSync(this.configPath, JSON.stringify(masterSafeConfig, null, 2), 'utf8');
      return;
    }

    const { sharedEvoDir, ...rest } = config;
    const toWrite: EvoConfig =
      sharedEvoDir &&
      path.resolve(this.rootDir, sharedEvoDir).toLowerCase() !==
        path.resolve(this.evoDir).toLowerCase()
        ? { ...rest, sharedEvoDir }
        : rest;
    fs.writeFileSync(this.configPath, JSON.stringify(toWrite, null, 2), 'utf8');
  }

  // ==================== RULES ====================

  public saveRule(rule: EvoRule): void {
    this.ensureInitialized();
    const targetDir = rule.core ? this.rulesDir : path.join(this.rulesDir, 'scoped');
    const filePath = path.join(targetDir, `${rule.id}.md`);
    const otherDir = rule.core ? path.join(this.rulesDir, 'scoped') : this.rulesDir;
    const otherPath = path.join(otherDir, `${rule.id}.md`);
    if (fs.existsSync(otherPath)) {
      fs.unlinkSync(otherPath);
    }

    const frontmatter = [
      '---',
      `id: ${rule.id}`,
      `title: ${JSON.stringify(rule.title)}`,
      `l0_summary: ${JSON.stringify(rule.l0_summary)}`,
      `scope_glob: ${JSON.stringify(rule.scope_glob)}`,
      `core: ${rule.core}`,
      `priority: ${rule.priority}`,
      `tokens: ${rule.tokens}`,
      `origin: ${JSON.stringify(rule.origin)}`,
      ...(rule.supersedes_id ? [`supersedes_id: ${JSON.stringify(rule.supersedes_id)}`] : []),
      ...(rule.confidence ? [`confidence: ${JSON.stringify(rule.confidence)}`] : []),
      ...(rule.contrastive_evidence ? [`contrastive_evidence: ${JSON.stringify(rule.contrastive_evidence)}`] : []),
      ...(rule.transfer_scenarios && rule.transfer_scenarios.length > 0
        ? [`transfer_scenarios: ${JSON.stringify(rule.transfer_scenarios)}`]
        : []),
      ...(rule.enabled === false ? ['enabled: false'] : []),
      ...(rule.review_status === 'pending' ? ['review_status: "pending"'] : []),
      ...(rule.visibility === 'local' || rule.visibility === 'public'
        ? [`visibility: ${JSON.stringify(rule.visibility)}`]
        : []),
      `created_at: ${JSON.stringify(rule.created_at)}`,
      `updated_at: ${JSON.stringify(rule.updated_at)}`,
      '---',
      '',
      rule.content.trim(),
      '',
    ].join('\n');

    fs.writeFileSync(filePath, frontmatter, 'utf8');
    this.rebuildCoreInvariantsDigest();
  }

  public getRule(id: string): EvoRule | null {
    const cleanId = sanitizeId(id);
    const corePath = path.join(this.rulesDir, `${cleanId}.md`);
    const scopedPath = path.join(this.rulesDir, 'scoped', `${cleanId}.md`);
    const target = fs.existsSync(corePath)
      ? corePath
      : fs.existsSync(scopedPath)
        ? scopedPath
        : null;
    if (!target) return null;
    return this.parseRuleFile(target);
  }

  public listRules(): EvoRule[] {
    if (!fs.existsSync(this.rulesDir)) return [];
    const byId = new Map<string, EvoRule>();
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'core-invariants.md') {
          const parsed = this.parseRuleFile(path.join(dir, entry.name));
          if (!parsed) continue;
          const existing = byId.get(parsed.id);
          if (!existing) {
            byId.set(parsed.id, parsed);
          } else {
            const existingTime = Date.parse(existing.updated_at) || 0;
            const parsedTime = Date.parse(parsed.updated_at) || 0;
            if (parsedTime >= existingTime) {
              byId.set(parsed.id, parsed);
            }
          }
        }
      }
    };
    scanDir(this.rulesDir);
    scanDir(path.join(this.rulesDir, 'scoped'));
    return Array.from(byId.values()).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  private parseRuleFile(filePath: string): EvoRule | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const id = String(meta.id || path.basename(filePath, '.md'));
      const content = body.trim();
      const l0_summary = String(meta.l0_summary || content.split('\n')[0] || id);
      return {
        id,
        title: String(meta.title || id),
        l0_summary,
        scope_glob: String(meta.scope_glob || '**/*'),
        core: Boolean(meta.core === true || meta.core === 'true'),
        priority: Number(meta.priority ?? 50),
        content,
        tokens: Number(meta.tokens || estimateTokens(`${l0_summary}\n${content}`)),
        origin: String(meta.origin || 'session'),
        supersedes_id: meta.supersedes_id ? String(meta.supersedes_id) : undefined,
        transfer_scenarios: Array.isArray(meta.transfer_scenarios)
          ? meta.transfer_scenarios.map(String)
          : undefined,
        confidence:
          meta.confidence && ['high', 'medium', 'low', 'confounded'].includes(String(meta.confidence))
            ? (String(meta.confidence) as ConfidenceLevel)
            : undefined,
        contrastive_evidence: meta.contrastive_evidence ? String(meta.contrastive_evidence) : undefined,
        enabled: meta.enabled === false || meta.enabled === 'false' ? false : true,
        review_status: meta.review_status === 'pending' ? 'pending' : 'approved',
        ...(parseVisibility(meta.visibility) ? { visibility: parseVisibility(meta.visibility) } : {}),
        created_at: String(meta.created_at || new Date().toISOString()),
        updated_at: String(meta.updated_at || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }

  public rebuildCoreInvariantsDigest(): string {
    const coreRules = this.listRules().filter((r) => r.core && r.enabled !== false);
    if (coreRules.length === 0) {
      if (fs.existsSync(this.coreInvariantsPath)) {
        fs.unlinkSync(this.coreInvariantsPath);
      }
      return '';
    }
    const lines = coreRules.map(
      (r) => `- **[${r.id}]** (\`${r.scope_glob}\`): ${r.l0_summary}\n  ${r.content.replace(/\n/g, '\n  ')}`
    );
    const digest = lines.join('\n');
    fs.writeFileSync(
      this.coreInvariantsPath,
      `# Core Invariants (Auto-Generated Digest — Do Not Edit Directly)\n\n${digest}\n`,
      'utf8'
    );
    return digest;
  }

  public getCoreRulesTokenUsage(): { totalTokens: number; rules: EvoRule[] } {
    const coreRules = this.listRules().filter((r) => r.core && r.enabled !== false);
    const totalTokens = coreRules.reduce((acc, r) => acc + r.tokens, 0);
    return { totalTokens, rules: coreRules };
  }

  // ==================== SKILLS ====================

  public saveSkill(skill: EvoSkill): void {
    this.ensureInitialized();
    const dir = path.join(this.skillsDir, skill.id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'SKILL.md');

    const content = [
      '---',
      `id: ${skill.id}`,
      `name: ${skill.name || skill.id}`,
      `description: ${JSON.stringify(skill.description || skill.l0_summary)}`,
      `title: ${JSON.stringify(skill.title)}`,
      `l0_summary: ${JSON.stringify(skill.l0_summary)}`,
      ...(skill.trigger_cue ? [`trigger_cue: ${JSON.stringify(skill.trigger_cue)}`] : []),
      ...(skill.confidence ? [`confidence: ${JSON.stringify(skill.confidence)}`] : []),
      ...(skill.contrastive_evidence ? [`contrastive_evidence: ${JSON.stringify(skill.contrastive_evidence)}`] : []),
      `tags: ${JSON.stringify(skill.tags)}`,
      `origin: ${JSON.stringify(skill.origin)}`,
      ...(skill.supersedes_id ? [`supersedes_id: ${JSON.stringify(skill.supersedes_id)}`] : []),
      ...(skill.enabled === false ? ['enabled: false'] : []),
      ...(skill.review_status === 'pending' ? ['review_status: "pending"'] : []),
      ...(skill.visibility === 'local' || skill.visibility === 'public'
        ? [`visibility: ${JSON.stringify(skill.visibility)}`]
        : []),
      `created_at: ${JSON.stringify(skill.created_at)}`,
      `updated_at: ${JSON.stringify(skill.updated_at)}`,
      '---',
      '',
      '## L1 Contract',
      skill.l1_contract.trim(),
      '',
      '## L2 SOP',
      skill.l2_sop.trim(),
      '',
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf8');
  }

  public getSkill(id: string): EvoSkill | null {
    const cleanId = sanitizeId(id);
    const filePath = path.join(this.skillsDir, cleanId, 'SKILL.md');
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const parsedSections = parseSkillSectionsFromMarkdown(body);
      const l1_contract = parsedSections.hasL1Header
        ? parsedSections.l1
        : body.slice(0, 300).trim();
      const l2_sop = parsedSections.hasL2Header
        ? parsedSections.l2
        : body.trim();
      const skillId = String(meta.id || cleanId);
      const l0_summary = String(meta.l0_summary || meta.description || '');
      const name = meta.name ? String(meta.name) : skillId;
      const description = meta.description ? String(meta.description) : l0_summary;

      let trigger_cue =
        meta.trigger_cue && String(meta.trigger_cue).trim()
          ? String(meta.trigger_cue).trim()
          : undefined;
      if (!trigger_cue && l1_contract) {
        const triggerMatch = l1_contract.match(/-\s*\*\*Trigger\*\*:\s*([^\r\n]+)/i);
        if (triggerMatch && triggerMatch[1].trim()) {
          trigger_cue = triggerMatch[1].trim().slice(0, 120);
        }
      }

      return {
        id: skillId,
        name,
        description,
        title: String(meta.title || cleanId),
        l0_summary,
        trigger_cue,
        confidence:
          meta.confidence && ['high', 'medium', 'low', 'confounded'].includes(String(meta.confidence))
            ? (String(meta.confidence) as ConfidenceLevel)
            : undefined,
        contrastive_evidence: meta.contrastive_evidence ? String(meta.contrastive_evidence) : undefined,
        l1_contract,
        l2_sop,
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
        origin: String(meta.origin || 'session'),
        supersedes_id: meta.supersedes_id ? String(meta.supersedes_id) : undefined,
        enabled: meta.enabled === false || meta.enabled === 'false' ? false : true,
        review_status: meta.review_status === 'pending' ? 'pending' : 'approved',
        ...(parseVisibility(meta.visibility) ? { visibility: parseVisibility(meta.visibility) } : {}),
        created_at: String(meta.created_at || new Date().toISOString()),
        updated_at: String(meta.updated_at || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }

  public listSkills(): EvoSkill[] {
    if (!fs.existsSync(this.skillsDir)) return [];
    const skills: EvoSkill[] = [];
    for (const entry of fs.readdirSync(this.skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const s = this.getSkill(entry.name);
        if (s) skills.push(s);
      }
    }
    return skills.sort((a, b) => a.id.localeCompare(b.id));
  }

  // ==================== MICRO-TOOLS ====================

  public saveTool(manifest: EvoToolManifest, scriptCode: string): EvoTool {
    this.ensureInitialized();
    const dir = path.join(this.toolsDir, manifest.id);
    fs.mkdirSync(dir, { recursive: true });

    const ext = getExtensionForRuntime(manifest.runtime);
    const entryScript = `run${ext}`;
    const {
      enabled: rawEnabled,
      review_status: rawReviewStatus,
      visibility: rawVisibility,
      ...restManifest
    } = manifest;
    const visibility = parseVisibility(rawVisibility);
    const updatedManifest: EvoToolManifest = {
      ...restManifest,
      entry_script: entryScript,
      ...(visibility ? { visibility } : {}),
      ...(rawEnabled === false ? { enabled: false } : {}),
      ...(rawReviewStatus === 'pending' ? { review_status: 'pending' as const } : {}),
    };

    const manifestPath = path.join(dir, 'manifest.json');
    const scriptPath = path.join(dir, entryScript);

    fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2), 'utf8');
    fs.writeFileSync(scriptPath, scriptCode, 'utf8');

    return {
      ...updatedManifest,
      enabled: rawEnabled === false ? false : true,
      review_status: rawReviewStatus === 'pending' ? 'pending' : 'approved',
      script_code: scriptCode,
      script_path: scriptPath,
    };
  }

  public getTool(id: string): EvoTool | null {
    const cleanId = sanitizeId(id);
    const dir = path.join(this.toolsDir, cleanId);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as EvoToolManifest;
      const scriptPath = path.join(dir, manifest.entry_script);
      const scriptCode = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
      const { visibility: rawVisibility, ...restManifest } = manifest;
      const visibility = parseVisibility(rawVisibility);
      return {
        ...restManifest,
        ...(visibility ? { visibility } : {}),
        enabled: manifest.enabled === false ? false : true,
        review_status: manifest.review_status === 'pending' ? 'pending' : 'approved',
        script_code: scriptCode,
        script_path: scriptPath,
      };
    } catch {
      return null;
    }
  }

  public listTools(): EvoTool[] {
    if (!fs.existsSync(this.toolsDir)) return [];
    const tools: EvoTool[] = [];
    for (const entry of fs.readdirSync(this.toolsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const t = this.getTool(entry.name);
        if (t) tools.push(t);
      }
    }
    return tools.sort((a, b) => a.id.localeCompare(b.id));
  }

  // ==================== EXTERNAL MCP TOOLS ====================

  public getExternalToolsCachePath(): string {
    return path.join(this.cacheDir, 'external_tools.json');
  }

  public listExternalTools(): ExternalToolDefinition[] {
    const cacheFile = this.getExternalToolsCachePath();
    if (!fs.existsSync(cacheFile)) return [];
    try {
      const content = fs.readFileSync(cacheFile, 'utf8');
      return JSON.parse(content) as ExternalToolDefinition[];
    } catch {
      return [];
    }
  }

  public saveExternalTools(tools: ExternalToolDefinition[]): void {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(this.getExternalToolsCachePath(), JSON.stringify(tools, null, 2), 'utf8');
  }

  public getExternalTool(id: string): ExternalToolDefinition | null {
    const all = this.listExternalTools();
    return (
      all.find((t) => t.id === id) ||
      all.find((t) => t.id.toLowerCase() === id.toLowerCase()) ||
      null
    );
  }

  // ==================== EPISODIC MEMORIES ====================

  public saveMemory(memory: EvoMemory): void {
    this.ensureInitialized();
    const filePath = path.join(this.memoriesDir, `${memory.id}.md`);

    const content = [
      '---',
      `id: ${memory.id}`,
      `title: ${JSON.stringify(memory.title)}`,
      `l0_summary: ${JSON.stringify(memory.l0_summary)}`,
      `created_commit: ${JSON.stringify(memory.created_commit)}`,
      ...(memory.created_branch ? [`created_branch: ${JSON.stringify(memory.created_branch)}`] : []),
      `target_symbols: ${JSON.stringify(memory.target_symbols)}`,
      `ast_fingerprints: ${JSON.stringify(memory.ast_fingerprints)}`,
      ...(memory.memory_type === 'personal' || memory.memory_type === 'code'
        ? [`memory_type: ${JSON.stringify(memory.memory_type)}`]
        : []),
      `tags: ${JSON.stringify(memory.tags)}`,
      `origin: ${JSON.stringify(memory.origin)}`,
      ...(memory.supersedes_id ? [`supersedes_id: ${JSON.stringify(memory.supersedes_id)}`] : []),
      ...(memory.enabled === false ? ['enabled: false'] : []),
      ...(memory.review_status === 'pending' ? ['review_status: "pending"'] : []),
      ...(memory.visibility === 'local' || memory.visibility === 'public'
        ? [`visibility: ${JSON.stringify(memory.visibility)}`]
        : []),
      `created_at: ${JSON.stringify(memory.created_at)}`,
      `updated_at: ${JSON.stringify(memory.updated_at)}`,
      '---',
      '',
      '## Symptom',
      memory.symptom.trim(),
      '',
      '## Root Cause',
      memory.root_cause.trim(),
      '',
      '## Solution',
      memory.solution.trim(),
      '',
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf8');
  }

  public getMemory(id: string): EvoMemory | null {
    const cleanId = sanitizeId(id);
    const filePath = path.join(this.memoriesDir, `${cleanId}.md`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const symptomMatch = body.match(/## Symptom\s+([\s\S]*?)(?=## Root Cause|$)/i);
      const rootCauseMatch = body.match(/## Root Cause\s+([\s\S]*?)(?=## Solution|$)/i);
      const solutionMatch = body.match(/## Solution\s+([\s\S]*)$/i);

      const rawFingerprints =
        meta.ast_fingerprints && typeof meta.ast_fingerprints === 'object'
          ? (meta.ast_fingerprints as Record<string, SymbolFingerprint>)
          : {};

      return {
        id: String(meta.id || cleanId),
        title: String(meta.title || cleanId),
        l0_summary: String(meta.l0_summary || ''),
        symptom: symptomMatch ? symptomMatch[1].trim() : body.trim(),
        root_cause: rootCauseMatch ? rootCauseMatch[1].trim() : '',
        solution: solutionMatch ? solutionMatch[1].trim() : '',
        target_symbols: Array.isArray(meta.target_symbols) ? meta.target_symbols.map(String) : [],
        ast_fingerprints: rawFingerprints,
        ...(meta.memory_type === 'personal' || meta.memory_type === 'code'
          ? { memory_type: meta.memory_type }
          : {}),
        created_commit: String(meta.created_commit || 'uncommitted'),
        created_branch: meta.created_branch ? String(meta.created_branch) : undefined,
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
        origin: String(meta.origin || 'session'),
        supersedes_id: meta.supersedes_id ? String(meta.supersedes_id) : undefined,
        enabled: meta.enabled === false || meta.enabled === 'false' ? false : true,
        review_status: meta.review_status === 'pending' ? 'pending' : 'approved',
        ...(parseVisibility(meta.visibility) ? { visibility: parseVisibility(meta.visibility) } : {}),
        created_at: String(meta.created_at || new Date().toISOString()),
        updated_at: String(meta.updated_at || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }

  public listMemories(): EvoMemory[] {
    if (!fs.existsSync(this.memoriesDir)) return [];
    const memories: EvoMemory[] = [];
    for (const entry of fs.readdirSync(this.memoriesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const m = this.getMemory(path.basename(entry.name, '.md'));
        if (m) memories.push(m);
      }
    }
    return memories.sort((a, b) => a.id.localeCompare(b.id));
  }

  // ==================== PERSONAL PREFERENCES ====================

  public savePreference(pref: EvoPreference): void {
    this.ensureInitialized();
    const filePath = path.join(this.preferencesDir, `${pref.id}.md`);

    const frontmatter = [
      '---',
      `id: ${pref.id}`,
      `title: ${JSON.stringify(pref.title)}`,
      `l0_summary: ${JSON.stringify(pref.l0_summary)}`,
      `category: ${JSON.stringify(pref.category)}`,
      `always_on: ${pref.always_on !== false}`,
      ...(pref.trigger_cue ? [`trigger_cue: ${JSON.stringify(pref.trigger_cue)}`] : []),
      `tokens: ${pref.tokens}`,
      `tags: ${JSON.stringify(pref.tags || [])}`,
      `origin: ${JSON.stringify(pref.origin)}`,
      ...(pref.supersedes_id ? [`supersedes_id: ${JSON.stringify(pref.supersedes_id)}`] : []),
      ...(pref.enabled === false ? ['enabled: false'] : []),
      ...(pref.review_status === 'pending' ? ['review_status: "pending"'] : []),
      ...(pref.visibility === 'local' || pref.visibility === 'public'
        ? [`visibility: ${JSON.stringify(pref.visibility)}`]
        : []),
      `created_at: ${JSON.stringify(pref.created_at)}`,
      `updated_at: ${JSON.stringify(pref.updated_at)}`,
      '---',
      '',
      pref.content.trim(),
      '',
    ].join('\n');

    fs.writeFileSync(filePath, frontmatter, 'utf8');
    this.rebuildUserProfileDigest();
  }

  public getPreference(id: string): EvoPreference | null {
    const cleanId = sanitizeId(id);
    const filePath = path.join(this.preferencesDir, `${cleanId}.md`);
    if (!fs.existsSync(filePath)) return null;
    return this.parsePreferenceFile(filePath);
  }

  public listPreferences(): EvoPreference[] {
    if (!fs.existsSync(this.preferencesDir)) return [];
    const byId = new Map<string, EvoPreference>();
    for (const entry of fs.readdirSync(this.preferencesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const parsed = this.parsePreferenceFile(path.join(this.preferencesDir, entry.name));
        if (!parsed) continue;
        const existing = byId.get(parsed.id);
        if (!existing || (Date.parse(parsed.updated_at) || 0) >= (Date.parse(existing.updated_at) || 0)) {
          byId.set(parsed.id, parsed);
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  private parsePreferenceFile(filePath: string): EvoPreference | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const id = sanitizeId(String(meta.id || path.basename(filePath, '.md')));
      const content = body.trim();
      const l0_summary = String(meta.l0_summary || content.split('\n')[0] || id);
      const rawCategory = String(meta.category || 'style').trim().toLowerCase() as PreferenceCategory;
      const category: PreferenceCategory = PREFERENCE_CATEGORIES.includes(rawCategory)
        ? rawCategory
        : 'style';
      const always_on = meta.always_on === false || meta.always_on === 'false' ? false : true;
      const trigger_cue =
        meta.trigger_cue && String(meta.trigger_cue).trim()
          ? String(meta.trigger_cue).trim()
          : undefined;
      return {
        id,
        title: String(meta.title || id),
        l0_summary,
        category,
        always_on,
        ...(trigger_cue ? { trigger_cue } : {}),
        content,
        tokens: Number(meta.tokens || estimateTokens(`- **[${id}]** (${category}): ${l0_summary}\n  ${content}`)),
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
        origin: String(meta.origin || 'session'),
        supersedes_id: meta.supersedes_id ? String(meta.supersedes_id) : undefined,
        enabled: meta.enabled === false || meta.enabled === 'false' ? false : true,
        review_status: meta.review_status === 'pending' ? 'pending' : 'approved',
        ...(parseVisibility(meta.visibility) ? { visibility: parseVisibility(meta.visibility) } : {}),
        created_at: String(meta.created_at || new Date().toISOString()),
        updated_at: String(meta.updated_at || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }

  public formatUserProfileDigestForPreferences(prefs: EvoPreference[]): string {
    return formatUserProfileDigestForPreferences(prefs);
  }

  public getProfileTokenUsage(): { totalTokens: number; preferences: EvoPreference[] } {
    const activeAlwaysOn = this.listPreferences().filter(
      (p) => p.always_on !== false && p.enabled !== false
    );
    if (activeAlwaysOn.length === 0) {
      return { totalTokens: 0, preferences: [] };
    }
    const digest = this.formatUserProfileDigestForPreferences(activeAlwaysOn);
    const totalTokens = estimateTokens(renderUserProfileBlock(digest, ''));
    return { totalTokens, preferences: activeAlwaysOn };
  }

  public formatUserProfileDigest(): string {
    return this.formatUserProfileDigestForPreferences(this.listPreferences());
  }

  public formatTaskDirectoryMenu(maxTokens?: number): string {
    const cfg = this.getConfig();
    const cap = maxTokens ?? cfg.maxDirectoryMenuTokens ?? 250;
    if (cap <= 0) return '';

    const seedSkillIds = new Set(['bug-to-guardrail-sop', 'evo-rule-architect']);
    const catPriority: Record<PreferenceCategory, number> = {
      workflow: 0,
      requirement: 1,
      knowledge: 2,
      formatting: 3,
      communication: 4,
      style: 5,
    };

    const onDemandPrefs = this.listPreferences()
      .filter((p) => p.always_on === false && p.enabled !== false)
      .sort(
        (a, b) =>
          (catPriority[a.category] ?? 9) - (catPriority[b.category] ?? 9) ||
          a.id.localeCompare(b.id)
      );

    const nonSeedSkills = this.listSkills()
      .filter(
        (s) =>
          s.enabled !== false &&
          s.origin !== 'bootstrap' &&
          s.origin !== 'seed' &&
          !seedSkillIds.has(s.id)
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    const prefLines = onDemandPrefs.map((p) => {
      const cue = (p.trigger_cue || p.category).trim().replace(/\s+/g, ' ');
      const summary = (p.l0_summary || p.title || p.id).trim().replace(/\s+/g, ' ');
      return `- **[${p.id}]** (${cue}): ${summary} → \`evo_inspect("${p.id}", "L2")\``;
    });
    const skillLines = nonSeedSkills.map((s) => {
      const cue = (s.trigger_cue || 'skill').trim().replace(/\s+/g, ' ');
      const summary = (s.l0_summary || s.description || s.title || s.id)
        .trim()
        .replace(/\s+/g, ' ');
      return `- **[${s.id}]** (${cue}): ${summary} → \`evo_inspect("${s.id}", "L2")\``;
    });

    if (prefLines.length === 0 && skillLines.length === 0) return '';

    const keptPrefs: string[] = [];
    const keptSkills: string[] = [];

    // Reserve a fair sub-quota for non-seed global skills when both on-demand preferences
    // and skills exist so skills are not starved by many preferences.
    const skillReserveCap =
      prefLines.length > 0 && skillLines.length > 0
        ? Math.max(Math.min(cap, estimateTokens(skillLines[0])), Math.floor(cap * 0.35))
        : 0;
    const prefCap = skillReserveCap > 0 ? Math.max(0, cap - skillReserveCap) : cap;

    for (const line of prefLines) {
      const candidate = [...keptPrefs, line].join('\n');
      if (estimateTokens(candidate) <= prefCap) {
        keptPrefs.push(line);
      }
    }

    for (const line of skillLines) {
      const candidate = [...keptPrefs, ...keptSkills, line].join('\n');
      if (estimateTokens(candidate) <= cap) {
        keptSkills.push(line);
      }
    }

    // Backfill any unused skill reserve with remaining on-demand preferences
    for (const line of prefLines) {
      if (keptPrefs.includes(line)) continue;
      const candidate = [...keptPrefs, line, ...keptSkills].join('\n');
      if (estimateTokens(candidate) <= cap) {
        keptPrefs.push(line);
      }
    }

    return [...keptPrefs, ...keptSkills].join('\n');
  }

  public appendProfileHistory(entry: ProfileHistoryEntry): void {
    this.ensureInitialized();
    const normalized: ProfileHistoryEntry = {
      ...entry,
      ts: entry.ts || new Date().toISOString(),
      id: sanitizeId(entry.id) || entry.id,
    };
    fs.appendFileSync(this.profileHistoryPath, JSON.stringify(normalized) + '\n', 'utf8');
  }

  private readAllProfileHistoryChronological(): ProfileHistoryEntry[] {
    if (!fs.existsSync(this.profileHistoryPath)) return [];
    try {
      const raw = fs.readFileSync(this.profileHistoryPath, 'utf8');
      const entries: ProfileHistoryEntry[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as ProfileHistoryEntry;
          if (parsed && typeof parsed.id === 'string' && typeof parsed.action === 'string') {
            entries.push(parsed);
          }
        } catch {
          // ignore malformed JSONL line
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  public listProfileHistory(limit = 20): ProfileHistoryEntry[] {
    const entries = this.readAllProfileHistoryChronological();
    const safeLimit = Math.max(0, Math.floor(limit));
    return entries.reverse().slice(0, safeLimit);
  }

  public undoLastProfileChange(
    targetId?: string
  ): { ok: boolean; undone?: ProfileHistoryEntry; message: string } {
    const entries = this.readAllProfileHistoryChronological();
    if (entries.length === 0) {
      return { ok: false, message: 'No profile history entries found to undo.' };
    }

    const cleanTargetId = targetId ? sanitizeId(targetId) : undefined;
    const undoBalance = new Map<string, number>();
    let candidate: ProfileHistoryEntry | undefined;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const key = `${entry.kind}:${sanitizeId(entry.id)}`;
      if (entry.action === 'undo') {
        undoBalance.set(key, (undoBalance.get(key) || 0) + 1);
        continue;
      }
      if (cleanTargetId && sanitizeId(entry.id) !== cleanTargetId) {
        continue;
      }
      const pendingUndos = undoBalance.get(key) || 0;
      if (pendingUndos > 0) {
        undoBalance.set(key, pendingUndos - 1);
        continue;
      }
      if (entry.action === 'add' || entry.action === 'update' || entry.action === 'archive') {
        candidate = entry;
        break;
      }
    }

    if (!candidate) {
      return {
        ok: false,
        message: cleanTargetId
          ? `No reversible profile change found for '${cleanTargetId}'.`
          : 'No reversible profile change found to undo.',
      };
    }

    const cleanId = sanitizeId(candidate.id) || candidate.id;
    const now = new Date().toISOString();

    const checkPreferenceSnapshotBudget = (
      snapshotRaw: string,
      targetPrefId: string,
      excludeIds: string[] = []
    ): string | null => {
      const { meta, body } = parseFrontmatter(snapshotRaw);
      const rawCat = String(meta.category || 'style').trim().toLowerCase() as PreferenceCategory;
      const category: PreferenceCategory = PREFERENCE_CATEGORIES.includes(rawCat) ? rawCat : 'style';
      const alwaysOn = meta.always_on === false || meta.always_on === 'false' ? false : true;
      const enabled = meta.enabled === false || meta.enabled === 'false' ? false : true;
      if (!alwaysOn || !enabled) return null;

      const content = body.trim();
      const l0 = String(meta.l0_summary || content.split('\n')[0] || targetPrefId);
      const candPref: EvoPreference = {
        id: targetPrefId,
        title: String(meta.title || targetPrefId),
        l0_summary: l0,
        category,
        always_on: true,
        content,
        tokens: Number(meta.tokens || estimateTokens(`- **[${targetPrefId}]** (${category}): ${l0}\n  ${content}`)),
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
        origin: String(meta.origin || 'restored'),
        enabled: true,
        created_at: String(meta.created_at || now),
        updated_at: now,
      };
      const cfg = this.getConfig();
      const maxProfileBudget = cfg.maxGlobalProfileTokens ?? 800;
      const { preferences: existingPrefs } = this.getProfileTokenUsage();
      const excluded = new Set([targetPrefId, ...excludeIds.map((x) => sanitizeId(x) || x)]);
      const projectedDigest = formatUserProfileDigestForPreferences([
        ...existingPrefs.filter((p) => !excluded.has(p.id)),
        candPref,
      ]);
      const projectedTokens = estimateTokens(renderUserProfileBlock(projectedDigest, ''));
      if (projectedTokens > maxProfileBudget) {
        return `ERR_PROFILE_BUDGET_EXCEEDED: Undoing ${candidate.action} for preference "${targetPrefId}" (${projectedTokens}/${maxProfileBudget} tokens) would exceed maxGlobalProfileTokens.`;
      }
      return null;
    };

    if (candidate.action === 'add') {
      const removed = this.archiveCapability(
        cleanId,
        candidate.kind,
        `Undid add via profile history (${candidate.ts})`
      );
      if (!removed) {
        if (candidate.kind === 'preference') {
          this.rebuildUserProfileDigest();
        }
        return {
          ok: false,
          message: `Could not undo add for '${cleanId}': capability is no longer active.`,
        };
      }
      this.appendProfileHistory({
        ts: now,
        action: 'undo',
        id: cleanId,
        kind: candidate.kind,
        title: candidate.title,
        reason: `Undid add of ${cleanId}`,
      });
      return {
        ok: true,
        undone: candidate,
        message: `Undid addition of ${candidate.kind} '${cleanId}'.`,
      };
    }

    if (
      (candidate.action === 'update' || candidate.action === 'archive') &&
      typeof candidate.previous_snapshot === 'string' &&
      candidate.previous_snapshot.trim().length > 0
    ) {
      this.ensureInitialized();
      const targetDir = candidate.kind === 'preference' ? this.preferencesDir : this.memoriesDir;
      const cleanSupersededId = candidate.superseded_id ? sanitizeId(candidate.superseded_id) : '';
      const hasCrossSupersede = Boolean(cleanSupersededId && cleanSupersededId !== cleanId);

      if (hasCrossSupersede) {
        const supersededSnapshot =
          typeof candidate.superseded_snapshot === 'string' && candidate.superseded_snapshot.trim()
            ? candidate.superseded_snapshot
            : candidate.previous_snapshot;
        if (candidate.kind === 'preference') {
          const budgetErr = checkPreferenceSnapshotBudget(supersededSnapshot, cleanSupersededId, [cleanId]);
          if (budgetErr) {
            return { ok: false, message: budgetErr };
          }
        }
        if (candidate.self_previous_snapshot && candidate.self_previous_snapshot.trim()) {
          if (candidate.kind === 'preference') {
            const selfBudgetErr = checkPreferenceSnapshotBudget(
              candidate.self_previous_snapshot,
              cleanId,
              [cleanId]
            );
            if (selfBudgetErr) {
              return { ok: false, message: selfBudgetErr };
            }
          }
          fs.writeFileSync(path.join(targetDir, `${cleanId}.md`), candidate.self_previous_snapshot, 'utf8');
        } else {
          this.archiveCapability(
            cleanId,
            candidate.kind,
            `Undid supersede of '${cleanSupersededId}' via profile history (${candidate.ts})`
          );
        }
        fs.writeFileSync(path.join(targetDir, `${cleanSupersededId}.md`), supersededSnapshot, 'utf8');
        if (candidate.kind === 'preference') {
          this.rebuildUserProfileDigest();
        }
        this.appendProfileHistory({
          ts: now,
          action: 'undo',
          id: cleanId,
          kind: candidate.kind,
          title: candidate.title,
          reason: `Undid ${candidate.action} of ${cleanId} and restored ${cleanSupersededId}`,
        });
        return {
          ok: true,
          undone: candidate,
          message: `Restored superseded ${candidate.kind} '${cleanSupersededId}' and reverted '${cleanId}'.`,
        };
      }

      if (candidate.kind === 'preference') {
        const budgetErr = checkPreferenceSnapshotBudget(candidate.previous_snapshot, cleanId);
        if (budgetErr) {
          return { ok: false, message: budgetErr };
        }
      }

      const targetPath = path.join(targetDir, `${cleanId}.md`);
      fs.writeFileSync(targetPath, candidate.previous_snapshot, 'utf8');
      if (candidate.kind === 'preference') {
        this.rebuildUserProfileDigest();
      }
      this.appendProfileHistory({
        ts: now,
        action: 'undo',
        id: cleanId,
        kind: candidate.kind,
        title: candidate.title,
        reason: `Undid ${candidate.action} of ${cleanId}`,
      });
      return {
        ok: true,
        undone: candidate,
        message: `Restored previous snapshot of ${candidate.kind} '${cleanId}' (undid ${candidate.action}).`,
      };
    }

    if (candidate.action === 'archive') {
      try {
        const restored = this.restoreCapability(cleanId, candidate.kind);
        if (restored) {
          this.appendProfileHistory({
            ts: now,
            action: 'undo',
            id: cleanId,
            kind: candidate.kind,
            title: candidate.title,
            reason: `Undid archive of ${cleanId}`,
          });
          return {
            ok: true,
            undone: candidate,
            message: `Restored archived ${candidate.kind} '${cleanId}'.`,
          };
        }
      } catch (err: any) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return {
      ok: false,
      message: `Cannot undo ${candidate.action} for '${cleanId}': missing previous snapshot.`,
    };
  }

  public rebuildUserProfileDigest(): string {
    const digest = this.formatUserProfileDigest();
    if (!digest) {
      if (fs.existsSync(this.profileDigestPath)) {
        fs.unlinkSync(this.profileDigestPath);
      }
      return '';
    }
    fs.mkdirSync(this.evoDir, { recursive: true });
    fs.writeFileSync(
      this.profileDigestPath,
      `# User Profile Digest (Auto-Managed by EvoKernel — Do Not Edit Directly)\n\n${digest}\n`,
      'utf8'
    );
    return digest;
  }

  // ==================== ARCHIVE / COMPACTION ====================

  public archiveCapability(
    id: string,
    kind: EvoKind,
    reason: string,
    extraMeta?: Record<string, unknown>
  ): boolean {
    this.ensureInitialized();
    const cleanId = sanitizeId(id);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(this.archiveDir, `${timestamp}_${kind}_${cleanId}.json`);

    if (kind === 'rule') {
      const rule = this.getRule(cleanId);
      if (!rule) return false;
      fs.writeFileSync(
        archiveFile,
        JSON.stringify(
          { reason, archived_at: new Date().toISOString(), ...(extraMeta || {}), item: rule },
          null,
          2
        ),
        'utf8'
      );
      const corePath = path.join(this.rulesDir, `${cleanId}.md`);
      const scopedPath = path.join(this.rulesDir, 'scoped', `${cleanId}.md`);
      if (fs.existsSync(corePath)) fs.unlinkSync(corePath);
      if (fs.existsSync(scopedPath)) fs.unlinkSync(scopedPath);
      this.rebuildCoreInvariantsDigest();
      return true;
    }

    const collectExtraDirFiles = (baseDir: string, excludeNames: Set<string>): Record<string, string> => {
      const extra: Record<string, string> = {};
      if (!fs.existsSync(baseDir)) return extra;
      const walk = (currDir: string) => {
        for (const ent of fs.readdirSync(currDir, { withFileTypes: true })) {
          const full = path.join(currDir, ent.name);
          const rel = path.relative(baseDir, full).replace(/\\/g, '/');
          if (ent.isDirectory()) {
            walk(full);
          } else if (ent.isFile() && !excludeNames.has(rel)) {
            try {
              extra[rel] = fs.readFileSync(full).toString('base64');
            } catch {}
          }
        }
      };
      walk(baseDir);
      return extra;
    };

    if (kind === 'skill') {
      const skill = this.getSkill(cleanId);
      if (!skill) return false;
      const skillDir = path.join(this.skillsDir, cleanId);
      const extra_files = collectExtraDirFiles(skillDir, new Set(['SKILL.md']));
      fs.writeFileSync(
        archiveFile,
        JSON.stringify(
          {
            reason,
            archived_at: new Date().toISOString(),
            ...(extraMeta || {}),
            ...(Object.keys(extra_files).length > 0 ? { extra_files } : {}),
            item: skill,
          },
          null,
          2
        ),
        'utf8'
      );
      fs.rmSync(skillDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
      return true;
    }

    if (kind === 'tool') {
      const tool = this.getTool(cleanId);
      if (!tool) return false;
      const toolDir = path.join(this.toolsDir, cleanId);
      const extra_files = collectExtraDirFiles(toolDir, new Set(['manifest.json', tool.entry_script]));
      fs.writeFileSync(
        archiveFile,
        JSON.stringify(
          {
            reason,
            archived_at: new Date().toISOString(),
            ...(extraMeta || {}),
            ...(Object.keys(extra_files).length > 0 ? { extra_files } : {}),
            item: tool,
          },
          null,
          2
        ),
        'utf8'
      );
      fs.rmSync(toolDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
      return true;
    }

    if (kind === 'memory') {
      const memory = this.getMemory(cleanId);
      if (!memory) return false;
      fs.writeFileSync(
        archiveFile,
        JSON.stringify(
          { reason, archived_at: new Date().toISOString(), ...(extraMeta || {}), item: memory },
          null,
          2
        ),
        'utf8'
      );
      const memPath = path.join(this.memoriesDir, `${cleanId}.md`);
      if (fs.existsSync(memPath)) fs.unlinkSync(memPath);
      return true;
    }

    if (kind === 'preference') {
      const pref = this.getPreference(cleanId);
      if (!pref) return false;
      fs.writeFileSync(
        archiveFile,
        JSON.stringify(
          { reason, archived_at: new Date().toISOString(), ...(extraMeta || {}), item: pref },
          null,
          2
        ),
        'utf8'
      );
      const prefPath = path.join(this.preferencesDir, `${cleanId}.md`);
      if (fs.existsSync(prefPath)) fs.unlinkSync(prefPath);
      this.rebuildUserProfileDigest();
      return true;
    }

    return false;
  }

  public deleteCapability(id: string, kind: EvoKind): boolean {
    const cleanId = sanitizeId(id);
    if (!cleanId) return false;
    if (kind === 'rule') {
      const corePath = path.join(this.rulesDir, `${cleanId}.md`);
      const scopedPath = path.join(this.rulesDir, 'scoped', `${cleanId}.md`);
      let removed = false;
      if (fs.existsSync(corePath)) {
        fs.unlinkSync(corePath);
        removed = true;
      }
      if (fs.existsSync(scopedPath)) {
        fs.unlinkSync(scopedPath);
        removed = true;
      }
      if (removed) this.rebuildCoreInvariantsDigest();
      return removed;
    }
    if (kind === 'skill') {
      const skillDir = path.join(this.skillsDir, cleanId);
      if (!fs.existsSync(skillDir)) return false;
      fs.rmSync(skillDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
      return true;
    }
    if (kind === 'tool') {
      const toolDir = path.join(this.toolsDir, cleanId);
      if (!fs.existsSync(toolDir)) return false;
      fs.rmSync(toolDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
      return true;
    }
    if (kind === 'memory') {
      const memPath = path.join(this.memoriesDir, `${cleanId}.md`);
      if (!fs.existsSync(memPath)) return false;
      fs.unlinkSync(memPath);
      return true;
    }
    if (kind === 'preference') {
      const prefPath = path.join(this.preferencesDir, `${cleanId}.md`);
      if (!fs.existsSync(prefPath)) return false;
      fs.unlinkSync(prefPath);
      this.rebuildUserProfileDigest();
      return true;
    }
    return false;
  }

  public listArchivedCount(): number {
    if (!fs.existsSync(this.archiveDir)) return 0;
    return fs.readdirSync(this.archiveDir).filter((f) => f.endsWith('.json')).length;
  }

  public listArchivedCapabilities(): ArchivedCapabilityEntry[] {
    if (!fs.existsSync(this.archiveDir)) return [];
    const activeRuleIds = new Set(this.listRules().map((r) => r.id));
    const activeSkillIds = new Set(this.listSkills().map((s) => s.id));
    const activeToolIds = new Set(this.listTools().map((t) => t.id));
    const activeMemoryIds = new Set(this.listMemories().map((m) => m.id));
    const activePreferenceIds = new Set(this.listPreferences().map((p) => p.id));
    const isActive = (k: EvoKind, id: string): boolean => {
      if (k === 'rule') return activeRuleIds.has(id);
      if (k === 'skill') return activeSkillIds.has(id);
      if (k === 'tool') return activeToolIds.has(id);
      if (k === 'memory') return activeMemoryIds.has(id);
      if (k === 'preference') return activePreferenceIds.has(id);
      return false;
    };

    const byKey = new Map<string, ArchivedCapabilityEntry>();
    const entries = fs.readdirSync(this.archiveDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const fullPath = path.join(this.archiveDir, entry.name);
        const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
        const item = (raw.item && typeof raw.item === 'object' ? raw.item : raw) as Record<string, unknown>;
        let kind: EvoKind | null = null;
        const nameMatch = entry.name.match(/_(rule|skill|tool|memory|preference)_([^.]+)\.json$/);
        if (nameMatch) {
          kind = nameMatch[1] as EvoKind;
        } else if (typeof raw.kind === 'string' && ['rule', 'skill', 'tool', 'memory', 'preference'].includes(raw.kind)) {
          kind = raw.kind as EvoKind;
        } else if (typeof item.kind === 'string' && ['rule', 'skill', 'tool', 'memory', 'preference'].includes(item.kind)) {
          kind = item.kind as EvoKind;
        } else if ('category' in item && 'always_on' in item) {
          kind = 'preference';
        } else if ('scope_glob' in item || 'core' in item) {
          kind = 'rule';
        } else if ('l2_sop' in item) {
          kind = 'skill';
        } else if ('runtime' in item || 'entry_script' in item) {
          kind = 'tool';
        } else if ('symptom' in item || 'target_symbols' in item) {
          kind = 'memory';
        }
        if (!kind) continue;

        const id = sanitizeId(String(item.id || (nameMatch ? nameMatch[2] : path.basename(entry.name, '.json'))));
        if (!id || isActive(kind, id)) continue;

        const archived_at = String(
          raw.archived_at || item.updated_at || item.created_at || new Date(fs.statSync(fullPath).mtimeMs).toISOString()
        );
        const candidate: ArchivedCapabilityEntry = {
          id,
          kind,
          title: String(item.title || id),
          l0_summary: String(item.l0_summary || item.description || id),
          archived_at,
          archive_file: entry.name,
          scope_glob: typeof item.scope_glob === 'string' ? item.scope_glob : undefined,
          core: typeof item.core === 'boolean' ? item.core : undefined,
          tokens: typeof item.tokens === 'number' ? item.tokens : undefined,
          content:
            typeof item.content === 'string'
              ? item.content
              : typeof item.l2_sop === 'string'
                ? item.l2_sop
                : typeof item.script_code === 'string'
                  ? item.script_code
                  : typeof item.solution === 'string'
                    ? `## Symptom\n${item.symptom || ''}\n\n## Root Cause\n${item.root_cause || ''}\n\n## Solution\n${item.solution || ''}`
                    : undefined,
        };

        const key = `${kind}:${id}`;
        const prev = byKey.get(key);
        if (!prev || (Date.parse(candidate.archived_at) || 0) >= (Date.parse(prev.archived_at) || 0)) {
          byKey.set(key, candidate);
        }
      } catch {
        // Ignore malformed archive files
      }
    }
    return Array.from(byKey.values()).sort(
      (a, b) => (Date.parse(b.archived_at) || 0) - (Date.parse(a.archived_at) || 0)
    );
  }

  public restoreCapability(id: string, kind: EvoKind): boolean {
    if (!fs.existsSync(this.archiveDir)) return false;
    const cleanId = sanitizeId(id);
    const matchingFiles: Array<{
      fullPath: string;
      mtime: number;
      raw: Record<string, unknown>;
      item: Record<string, unknown>;
    }> = [];
    for (const fileName of fs.readdirSync(this.archiveDir)) {
      if (!fileName.endsWith('.json')) continue;
      const fullPath = path.join(this.archiveDir, fileName);
      try {
        const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
        const item = (raw.item && typeof raw.item === 'object' ? raw.item : raw) as Record<string, unknown>;
        const nameMatch = fileName.match(/_(rule|skill|tool|memory|preference)_([^.]+)\.json$/);
        const fileKind = nameMatch ? (nameMatch[1] as EvoKind) : (raw.kind as EvoKind | undefined);
        const itemId = sanitizeId(String(item.id || (nameMatch ? nameMatch[2] : '')));
        if (itemId === cleanId && (!fileKind || fileKind === kind)) {
          const mtime = Date.parse(String(raw.archived_at || '')) || fs.statSync(fullPath).mtimeMs;
          matchingFiles.push({ fullPath, mtime, raw, item });
        }
      } catch {
        // Ignore malformed archive files
      }
    }

    if (matchingFiles.length === 0) return false;
    matchingFiles.sort((a, b) => b.mtime - a.mtime);
    const latest = matchingFiles[0].item;
    const latestRaw = matchingFiles[0].raw;
    const now = new Date().toISOString();
    const preservedEnabled = latest.enabled === false || latest.enabled === 'false' ? false : true;
    const preservedReviewStatus: 'pending' | 'approved' =
      latest.review_status === 'pending' ? 'pending' : 'approved';
    const preservedVisibility = parseVisibility(latest.visibility);

    const restoreExtraDirFiles = (targetBaseDir: string, extraObj: unknown) => {
      if (!extraObj || typeof extraObj !== 'object') return;
      const resolvedBase = path.resolve(targetBaseDir);
      for (const [relPath, b64] of Object.entries(extraObj as Record<string, unknown>)) {
        if (typeof b64 !== 'string' || !relPath) continue;
        const cleanRel = relPath.replace(/^[/\\]+/, '');
        const destPath = path.resolve(resolvedBase, cleanRel);
        if (!destPath.startsWith(resolvedBase + path.sep)) continue;
        try {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.writeFileSync(destPath, Buffer.from(b64, 'base64'));
        } catch {}
      }
    };

    if (kind === 'rule') {
      const isCore = Boolean(latest.core);
      const ruleSummary = String(latest.l0_summary || cleanId);
      const ruleContent = String(latest.content || latest.l0_summary || '');
      const ruleTokens = Number(
        latest.tokens || estimateTokens(`- **[${cleanId}]**: ${ruleSummary}\n${ruleContent}`) || 40
      );
      if (isCore && preservedEnabled) {
        const cfg = this.getConfig();
        const maxCoreBudget = cfg.maxCoreRuleTokens ?? 1500;
        const { rules: existingCoreRules } = this.getCoreRulesTokenUsage();
        const currentTokens = existingCoreRules
          .filter((r) => r.id !== cleanId)
          .reduce((acc, r) => acc + r.tokens, 0);
        if (currentTokens + ruleTokens > maxCoreBudget) {
          throw new Error(
            `ERR_BUDGET_EXCEEDED: Restoring core rule "${cleanId}" (${currentTokens + ruleTokens}/${maxCoreBudget} tokens) would exceed maxCoreRuleTokens.`
          );
        }
      }
      this.saveRule({
        id: cleanId,
        title: String(latest.title || cleanId),
        l0_summary: ruleSummary,
        scope_glob: String(latest.scope_glob || '**/*'),
        core: isCore,
        priority: Number(latest.priority ?? 50),
        content: ruleContent,
        tokens: ruleTokens,
        origin: String(latest.origin || 'restored'),
        supersedes_id: latest.supersedes_id ? String(latest.supersedes_id) : undefined,
        transfer_scenarios: Array.isArray(latest.transfer_scenarios)
          ? latest.transfer_scenarios.map(String)
          : undefined,
        confidence: latest.confidence as ConfidenceLevel | undefined,
        contrastive_evidence: latest.contrastive_evidence ? String(latest.contrastive_evidence) : undefined,
        enabled: preservedEnabled,
        review_status: preservedReviewStatus,
        ...(preservedVisibility ? { visibility: preservedVisibility } : {}),
        created_at: String(latest.created_at || now),
        updated_at: now,
      });
    } else if (kind === 'skill') {
      this.saveSkill({
        id: cleanId,
        name: String(latest.name || cleanId),
        description: String(latest.description || latest.l0_summary || cleanId),
        title: String(latest.title || cleanId),
        l0_summary: String(latest.l0_summary || cleanId),
        l1_contract: String(latest.l1_contract || ''),
        l2_sop: String(latest.l2_sop || ''),
        tags: Array.isArray(latest.tags) ? latest.tags.map(String) : [],
        origin: String(latest.origin || 'restored'),
        supersedes_id: latest.supersedes_id ? String(latest.supersedes_id) : undefined,
        trigger_cue: latest.trigger_cue ? String(latest.trigger_cue) : undefined,
        confidence: latest.confidence as ConfidenceLevel | undefined,
        contrastive_evidence: latest.contrastive_evidence ? String(latest.contrastive_evidence) : undefined,
        enabled: preservedEnabled,
        review_status: preservedReviewStatus,
        ...(preservedVisibility ? { visibility: preservedVisibility } : {}),
        created_at: String(latest.created_at || now),
        updated_at: now,
      });
      restoreExtraDirFiles(path.join(this.skillsDir, cleanId), latestRaw.extra_files);
    } else if (kind === 'tool') {
      const scriptCode = String(latest.script_code || '');
      const manifest: EvoToolManifest = {
        id: cleanId,
        title: String(latest.title || cleanId),
        l0_summary: String(latest.l0_summary || cleanId),
        runtime: (latest.runtime as ScriptRuntime) || 'node',
        entry_script: String(latest.entry_script || 'run.mjs'),
        input_schema: (latest.input_schema as Record<string, unknown>) || {},
        self_test_args: (latest.self_test_args as Record<string, unknown>) || {},
        timeout_ms: Number(latest.timeout_ms || 5000),
        tags: Array.isArray(latest.tags) ? latest.tags.map(String) : undefined,
        origin: String(latest.origin || 'restored'),
        supersedes_id: latest.supersedes_id ? String(latest.supersedes_id) : undefined,
        hook_trigger: latest.hook_trigger as EvoHookTrigger | undefined,
        enabled: preservedEnabled,
        review_status: preservedReviewStatus,
        ...(preservedVisibility ? { visibility: preservedVisibility } : {}),
        created_at: String(latest.created_at || now),
        updated_at: now,
      };
      this.saveTool(manifest, scriptCode);
      restoreExtraDirFiles(path.join(this.toolsDir, cleanId), latestRaw.extra_files);
    } else if (kind === 'memory') {
      this.saveMemory({
        id: cleanId,
        title: String(latest.title || cleanId),
        l0_summary: String(latest.l0_summary || cleanId),
        symptom: String(latest.symptom || ''),
        root_cause: String(latest.root_cause || ''),
        solution: String(latest.solution || ''),
        target_symbols: Array.isArray(latest.target_symbols) ? latest.target_symbols.map(String) : [],
        ast_fingerprints:
          latest.ast_fingerprints && typeof latest.ast_fingerprints === 'object'
            ? (latest.ast_fingerprints as Record<string, SymbolFingerprint>)
            : {},
        ...(latest.memory_type === 'personal' || latest.memory_type === 'code'
          ? { memory_type: latest.memory_type }
          : {}),
        created_commit: String(latest.created_commit || 'uncommitted'),
        created_branch: latest.created_branch ? String(latest.created_branch) : undefined,
        tags: Array.isArray(latest.tags) ? latest.tags.map(String) : [],
        origin: String(latest.origin || 'restored'),
        supersedes_id: latest.supersedes_id ? String(latest.supersedes_id) : undefined,
        enabled: preservedEnabled,
        review_status: preservedReviewStatus,
        ...(preservedVisibility ? { visibility: preservedVisibility } : {}),
        created_at: String(latest.created_at || now),
        updated_at: now,
      });
    } else if (kind === 'preference') {
      const rawCat = String(latest.category || 'style').trim().toLowerCase() as PreferenceCategory;
      const category: PreferenceCategory = PREFERENCE_CATEGORIES.includes(rawCat) ? rawCat : 'style';
      const alwaysOn = latest.always_on === false || latest.always_on === 'false' ? false : true;
      const prefL0 = String(latest.l0_summary || cleanId);
      const prefContent = String(latest.content || latest.l0_summary || '');
      const prefTokens = Number(
        latest.tokens ||
          estimateTokens(`- **[${cleanId}]** (${category}): ${prefL0}\n  ${prefContent}`) ||
          30
      );
      const candidatePref: EvoPreference = {
        id: cleanId,
        title: String(latest.title || cleanId),
        l0_summary: prefL0,
        category,
        always_on: alwaysOn,
        ...(latest.trigger_cue && String(latest.trigger_cue).trim()
          ? { trigger_cue: String(latest.trigger_cue).trim() }
          : {}),
        content: prefContent,
        tokens: prefTokens,
        tags: Array.isArray(latest.tags) ? latest.tags.map(String) : [],
        origin: String(latest.origin || 'restored'),
        supersedes_id: latest.supersedes_id ? String(latest.supersedes_id) : undefined,
        enabled: preservedEnabled,
        review_status: preservedReviewStatus,
        ...(preservedVisibility ? { visibility: preservedVisibility } : {}),
        created_at: String(latest.created_at || now),
        updated_at: now,
      };
      if (alwaysOn && preservedEnabled) {
        const cfg = this.getConfig();
        const maxProfileBudget = cfg.maxGlobalProfileTokens ?? 800;
        const { preferences: existingPrefs } = this.getProfileTokenUsage();
        const projectedDigest = this.formatUserProfileDigestForPreferences([
          ...existingPrefs.filter((p) => p.id !== cleanId),
          candidatePref,
        ]);
        const projectedTokens = estimateTokens(renderUserProfileBlock(projectedDigest, ''));
        if (projectedTokens > maxProfileBudget) {
          throw new Error(
            `ERR_PROFILE_BUDGET_EXCEEDED: Restoring always_on preference "${cleanId}" (${projectedTokens}/${maxProfileBudget} tokens) would exceed maxGlobalProfileTokens.`
          );
        }
      }
      this.savePreference(candidatePref);
    } else {
      return false;
    }

    for (const match of matchingFiles) {
      try {
        if (fs.existsSync(match.fullPath)) fs.unlinkSync(match.fullPath);
      } catch {
        // Ignore unlink errors
      }
    }
    return true;
  }
}

export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const sanitized = raw.replace(/^\uFEFF/, '');
  const match = sanitized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: sanitized };
  }
  const yamlBlock = match[1];
  const body = match[2];
  const meta: Record<string, unknown> = {};

  const lines = yamlBlock.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!currentList) {
        currentList = [];
        meta[currentKey] = currentList;
      }
      let val = listMatch[1].trim();
      if (val.length >= 2 && val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1).replace(/''/g, "'");
      } else if (val.startsWith('"') && val.endsWith('"')) {
        try {
          val = JSON.parse(val);
        } catch {
          val = val.slice(1, -1);
        }
      }
      currentList.push(val);
      continue;
    }

    currentKey = null;
    currentList = null;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    currentKey = key;

    // Check for YAML block scalars (>, >-, |, |+, |-) or empty rawVal followed by indented lines
    const isBlockScalar =
      rawVal === '>' || rawVal === '>-' || rawVal === '|' || rawVal === '|+' || rawVal === '|-';
    const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
    const nextIsIndentedText =
      rawVal === '' &&
      /^([ \t]{2,}|\t)[^\s-]/.test(nextLine);

    if (isBlockScalar || nextIsIndentedText) {
      const indentedLines: string[] = [];
      let minIndent: number | null = null;
      let j = i + 1;
      while (j < lines.length) {
        const candidate = lines[j];
        if (candidate.trim() === '') {
          indentedLines.push('');
          j++;
          continue;
        }
        const indentMatch = candidate.match(/^([ \t]+)(.*)$/);
        if (!indentMatch || indentMatch[1].length < 2) {
          break;
        }
        const indentLen = indentMatch[1].length;
        if (minIndent === null || indentLen < minIndent) {
          minIndent = indentLen;
        }
        indentedLines.push(candidate);
        j++;
      }

      if (indentedLines.length > 0) {
        i = j - 1;
        const stripIndent = minIndent || 2;
        const stripped = indentedLines.map((l) =>
          l.length >= stripIndent ? l.slice(stripIndent) : l.trimStart()
        );
        const isFolded = rawVal.startsWith('>');
        const isLiteral = rawVal.startsWith('|');
        if (isFolded) {
          meta[key] = stripped.join(' ').trim();
        } else if (isLiteral) {
          meta[key] = stripped.join('\n').trim();
        } else {
          meta[key] = stripped.join(' ').trim();
        }
        continue;
      }
    }

    if (rawVal === '') {
      continue;
    }

    if (rawVal.length >= 2 && rawVal.startsWith("'") && rawVal.endsWith("'")) {
      meta[key] = rawVal.slice(1, -1).replace(/''/g, "'");
      continue;
    }

    try {
      meta[key] = JSON.parse(rawVal);
    } catch {
      if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        const inner = rawVal.slice(1, -1).trim();
        if (!inner) {
          meta[key] = [];
        } else {
          const items =
            inner.match(/\s*(?:'(?:''|\\.|[^'])*'|"(?:\\.|[^"])*"|[^,]+)\s*/g) || [];
          meta[key] = items
            .map((item) => {
              const t = item.trim();
              if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
                return t
                  .slice(1, -1)
                  .replace(/''/g, "'")
                  .replace(/\\'/g, "'");
              }
              if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
                try {
                  return JSON.parse(t);
                } catch {
                  return t.slice(1, -1);
                }
              }
              return t;
            })
            .filter((s) => s.length > 0);
        }
      } else {
        meta[key] = rawVal;
      }
    }
  }
  return { meta, body };
}
