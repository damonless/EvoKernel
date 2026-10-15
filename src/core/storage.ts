import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  EvoConfig,
  EvoKind,
  EvoRule,
  EvoSkill,
  EvoTool,
  EvoToolManifest,
  ScriptRuntime,
} from './types.js';

export const DEFAULT_EVO_CONFIG: EvoConfig = {
  version: '0.1.0',
  maxCoreRuleTokens: 1500,
  maxL0SummaryChars: 140,
  duplicateBm25Threshold: 0.68,
  sandboxTimeoutMs: 5000,
  enabledHarnesses: [],
};

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

export class EvoStorage {
  public readonly rootDir: string;
  public readonly evoDir: string;
  public readonly rulesDir: string;
  public readonly skillsDir: string;
  public readonly toolsDir: string;
  public readonly archiveDir: string;
  public readonly cacheDir: string;
  public readonly configPath: string;
  public readonly coreInvariantsPath: string;

  constructor(workspaceRoot: string, customEvoDir?: string) {
    this.rootDir = path.resolve(workspaceRoot);
    this.evoDir = customEvoDir
      ? path.resolve(customEvoDir)
      : process.env.EVO_DATA_DIR
        ? path.resolve(process.env.EVO_DATA_DIR)
        : path.join(this.rootDir, '.evo');
    this.rulesDir = path.join(this.evoDir, 'rules');
    this.skillsDir = path.join(this.evoDir, 'skills');
    this.toolsDir = path.join(this.evoDir, 'tools');
    this.archiveDir = path.join(this.evoDir, 'archive');
    this.cacheDir = path.join(this.evoDir, '.cache');
    this.configPath = path.join(this.evoDir, 'config.json');
    this.coreInvariantsPath = path.join(this.rulesDir, 'core-invariants.md');
  }

  public ensureInitialized(): EvoConfig {
    for (const dir of [
      this.evoDir,
      this.rulesDir,
      path.join(this.rulesDir, 'scoped'),
      this.skillsDir,
      this.toolsDir,
      this.archiveDir,
      this.cacheDir,
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, JSON.stringify(DEFAULT_EVO_CONFIG, null, 2), 'utf8');
    }

    return this.getConfig();
  }

  public getConfig(): EvoConfig {
    if (!fs.existsSync(this.configPath)) {
      return { ...DEFAULT_EVO_CONFIG };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return { ...DEFAULT_EVO_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_EVO_CONFIG };
    }
  }

  public saveConfig(config: EvoConfig): void {
    fs.mkdirSync(this.evoDir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
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
    const results: EvoRule[] = [];
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'core-invariants.md') {
          const parsed = this.parseRuleFile(path.join(dir, entry.name));
          if (parsed) results.push(parsed);
        }
      }
    };
    scanDir(this.rulesDir);
    scanDir(path.join(this.rulesDir, 'scoped'));
    return results.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
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
        created_at: String(meta.created_at || new Date().toISOString()),
        updated_at: String(meta.updated_at || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  }

  public rebuildCoreInvariantsDigest(): string {
    const coreRules = this.listRules().filter((r) => r.core);
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
    const coreRules = this.listRules().filter((r) => r.core);
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
      `title: ${JSON.stringify(skill.title)}`,
      `l0_summary: ${JSON.stringify(skill.l0_summary)}`,
      `tags: ${JSON.stringify(skill.tags)}`,
      `origin: ${JSON.stringify(skill.origin)}`,
      ...(skill.supersedes_id ? [`supersedes_id: ${JSON.stringify(skill.supersedes_id)}`] : []),
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
      const l1Match = body.match(/## L1 Contract\s+([\s\S]*?)(?=## L2 SOP|$)/i);
      const l2Match = body.match(/## L2 SOP\s+([\s\S]*)$/i);
      return {
        id: String(meta.id || cleanId),
        title: String(meta.title || cleanId),
        l0_summary: String(meta.l0_summary || ''),
        l1_contract: l1Match ? l1Match[1].trim() : body.slice(0, 300).trim(),
        l2_sop: l2Match ? l2Match[1].trim() : body.trim(),
        tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
        origin: String(meta.origin || 'session'),
        supersedes_id: meta.supersedes_id ? String(meta.supersedes_id) : undefined,
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
    const updatedManifest: EvoToolManifest = {
      ...manifest,
      entry_script: entryScript,
    };

    const manifestPath = path.join(dir, 'manifest.json');
    const scriptPath = path.join(dir, entryScript);

    fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2), 'utf8');
    fs.writeFileSync(scriptPath, scriptCode, 'utf8');

    return {
      ...updatedManifest,
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
      return {
        ...manifest,
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

  // ==================== ARCHIVE / COMPACTION ====================

  public archiveCapability(id: string, kind: EvoKind, reason: string): boolean {
    this.ensureInitialized();
    const cleanId = sanitizeId(id);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(this.archiveDir, `${timestamp}_${kind}_${cleanId}.json`);

    if (kind === 'rule') {
      const rule = this.getRule(cleanId);
      if (!rule) return false;
      fs.writeFileSync(archiveFile, JSON.stringify({ reason, archived_at: new Date().toISOString(), item: rule }, null, 2), 'utf8');
      const corePath = path.join(this.rulesDir, `${cleanId}.md`);
      const scopedPath = path.join(this.rulesDir, 'scoped', `${cleanId}.md`);
      if (fs.existsSync(corePath)) fs.unlinkSync(corePath);
      if (fs.existsSync(scopedPath)) fs.unlinkSync(scopedPath);
      this.rebuildCoreInvariantsDigest();
      return true;
    }

    if (kind === 'skill') {
      const skill = this.getSkill(cleanId);
      if (!skill) return false;
      fs.writeFileSync(archiveFile, JSON.stringify({ reason, archived_at: new Date().toISOString(), item: skill }, null, 2), 'utf8');
      fs.rmSync(path.join(this.skillsDir, cleanId), { recursive: true, force: true });
      return true;
    }

    if (kind === 'tool') {
      const tool = this.getTool(cleanId);
      if (!tool) return false;
      fs.writeFileSync(archiveFile, JSON.stringify({ reason, archived_at: new Date().toISOString(), item: tool }, null, 2), 'utf8');
      fs.rmSync(path.join(this.toolsDir, cleanId), { recursive: true, force: true });
      return true;
    }

    return false;
  }

  public listArchivedCount(): number {
    if (!fs.existsSync(this.archiveDir)) return 0;
    return fs.readdirSync(this.archiveDir).filter((f) => f.endsWith('.json')).length;
  }
}

export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const yamlBlock = match[1];
  const body = match[2];
  const meta: Record<string, unknown> = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    try {
      meta[key] = JSON.parse(rawVal);
    } catch {
      meta[key] = rawVal;
    }
  }
  return { meta, body };
}
