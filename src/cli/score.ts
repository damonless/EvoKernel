import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { parseJsonc } from './harness.js';
import { EvoStorage, estimateTokens, hasValidEvoStructure } from '../core/storage.js';
import { redactSensitiveDiagnostics } from '../core/telemetry.js';
import { verifyMemoryFreshness } from '../core/memory.js';

let _geminiCache: { dir: string; ts: number; entries: Set<string> } | null = null;
function getHomeGeminiEntries(homeDir: string): Set<string> {
  const dir = path.join(homeDir, '.gemini');
  const now = Date.now();
  if (_geminiCache && _geminiCache.dir === dir && now - _geminiCache.ts < 5000) {
    return _geminiCache.entries;
  }
  let entries = new Set<string>();
  try {
    entries = new Set(fs.readdirSync(dir));
  } catch {}
  _geminiCache = { dir, ts: now, entries };
  return entries;
}

export function isProjectDirectoryFast(dir: string): boolean {
  try {
    const resolved = path.resolve(dir);
    const home = path.resolve(os.homedir());
    const root = path.parse(resolved).root;
    if (
      resolved.toLowerCase() === home.toLowerCase() ||
      resolved.toLowerCase() === root.toLowerCase()
    ) {
      return false;
    }
    const markers = [
      '.git',
      '.evo',
      'package.json',
      'Cargo.toml',
      'pyproject.toml',
      'go.mod',
      'tsconfig.json',
      'pom.xml',
      'CMakeLists.txt',
      'Makefile',
      'CLAUDE.md',
      'AGENTS.md',
      'GEMINI.md',
      '.mcp.json',
      '.cursor',
      '.claude',
    ];
    for (const marker of markers) {
      if (fs.existsSync(path.join(resolved, marker))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export interface McpServerTaxItem {
  id: string;
  name: string;
  source: string;
  status: 'active' | 'pooled';
  estimatedTokens: number;
  toolCount?: number;
  tools?: string[];
}

export interface McpTaxReport {
  servers: McpServerTaxItem[];
  totalServers: number;
  activeServers: number;
  pooledServers: number;
  totalTaxTokens: number;
  activeTaxTokens: number;
  pooledTaxTokens: number;
}

const KNOWN_HEAVY_MCP_PROFILES: Record<string, number> = {
  context7: 1200,
  'brave-search': 800,
  github: 2200,
  gitlab: 1800,
  postgres: 1500,
  postgresql: 1500,
  mysql: 1400,
  sqlite: 900,
  filesystem: 1100,
  fetch: 600,
  puppeteer: 2000,
  playwright: 2200,
  slack: 1600,
  sentry: 1400,
  linear: 1800,
  docker: 1900,
  kubernetes: 2500,
  memory: 750,
  everything: 2400,
  'sequential-thinking': 500,
  git: 1300,
  'google-drive': 1600,
  gdrive: 1600,
  jira: 1700,
  notion: 1500,
  aws: 2400,
  azure: 2300,
  codegraph: 1400,
};

function estimateMcpServerTokens(
  name: string,
  cachedTools?: Record<string, unknown[]>,
  serverConfig?: any
): { tokens: number; toolCount?: number; tools?: string[] } {
  const normName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  // Tier 1: exact schema cache if available
  if (cachedTools && cachedTools[name]) {
    const tools = cachedTools[name];
    const jsonStr = JSON.stringify(tools);
    return {
      tokens: estimateTokens(jsonStr),
      toolCount: tools.length,
      tools: tools.map((t: any) => t.name || t.id).filter(Boolean),
    };
  }

  // Tier 2: ~25 well-known heavy MCP server profiles
  for (const [key, tok] of Object.entries(KNOWN_HEAVY_MCP_PROFILES)) {
    if (normName === key || normName.includes(key)) {
      return { tokens: tok };
    }
  }

  // Tier 3: standard baseline
  return { tokens: 850 };
}

export function inspectMcpTaxSnapshot(
  workspaceRoot: string,
  options?: { includeGlobal?: boolean; globalOnly?: boolean }
): McpTaxReport {
  const ws = path.resolve(workspaceRoot);
  const includeGlobal = options?.includeGlobal !== false;
  const globalOnly = Boolean(options?.globalOnly);

  const serversMap = new Map<string, McpServerTaxItem>();
  const pooledNames = new Set<string>();

  // Cached external tools
  let cachedToolsMap: Record<string, unknown[]> | undefined;
  const extToolsPath = path.join(ws, '.evo', 'external-tools.json');
  if (!globalOnly && fs.existsSync(extToolsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(extToolsPath, 'utf8'));
      if (Array.isArray(parsed)) {
        cachedToolsMap = {};
        for (const t of parsed) {
          const sName = t.server || 'default';
          if (!cachedToolsMap[sName]) cachedToolsMap[sName] = [];
          cachedToolsMap[sName].push(t);
        }
      }
    } catch {}
  }

  function registerServer(id: string, name: string, source: string, sCfg: any, forcePooled = false) {
    const lower = name.toLowerCase();
    if (lower === 'evo-kernel' || lower === 'evokernel') {
      return;
    }
    const isPooled = forcePooled || Boolean(sCfg?.disabled) || sCfg?.enabled === false || pooledNames.has(lower);
    const est = estimateMcpServerTokens(name, cachedToolsMap, sCfg);

    const existing = serversMap.get(lower);
    if (!existing) {
      serversMap.set(lower, {
        id,
        name,
        source,
        status: isPooled ? 'pooled' : 'active',
        estimatedTokens: est.tokens,
        toolCount: est.toolCount,
        tools: est.tools,
      });
    } else {
      if (isPooled && existing.status !== 'pooled') {
        existing.status = 'pooled';
      }
      if (!existing.source.includes(source)) {
        existing.source += `, ${source}`;
      }
    }
  }

  // Pooled list in workspace
  if (!globalOnly) {
    const poolPath = path.join(ws, '.evo', 'mcp-pool.json');
    if (fs.existsSync(poolPath)) {
      try {
        const poolData = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
        if (Array.isArray(poolData)) {
          for (const s of poolData) {
            const sName = String(s.name || s.id || '').trim();
            if (sName) {
              pooledNames.add(sName.toLowerCase());
              registerServer(sName, sName, 'workspace:.evo/mcp-pool.json', s, true);
            }
          }
        } else if (poolData && typeof poolData === 'object') {
          const poolServers = poolData.mcpServers || poolData;
          if (poolServers && typeof poolServers === 'object') {
            for (const [sName, sCfg] of Object.entries(poolServers as Record<string, any>)) {
              const cleanName = String(sName || '').trim();
              if (cleanName && sCfg && typeof sCfg === 'object') {
                pooledNames.add(cleanName.toLowerCase());
                registerServer(cleanName, cleanName, 'workspace:.evo/mcp-pool.json', sCfg, true);
              }
            }
          }
        }
      } catch {}
    }
    const evoCfgPath = path.join(ws, '.evo', 'config.json');
    if (fs.existsSync(evoCfgPath)) {
      try {
        const evoCfg = JSON.parse(fs.readFileSync(evoCfgPath, 'utf8'));
        if (evoCfg.externalServers && typeof evoCfg.externalServers === 'object') {
          for (const [sName, sCfg] of Object.entries(evoCfg.externalServers as Record<string, any>)) {
            if (sCfg?.disabled || sCfg?.enabled === false) {
              pooledNames.add(sName.toLowerCase());
              registerServer(sName, sName, 'workspace:.evo/config.json', sCfg, true);
            }
          }
        }
      } catch {}
    }
  }

  function inspectConfigFile(filePath: string, sourceLabel: string) {
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (filePath.endsWith('.toml')) {
        const mcpSectionRegex = /\[(?:mcp_servers|mcp)\.([^\]]+)\]/g;
        let m: RegExpExecArray | null;
        while ((m = mcpSectionRegex.exec(raw)) !== null) {
          let sName = m[1].trim();
          if (sName.endsWith('.env')) {
            sName = sName.slice(0, -4).trim();
          }
          sName = sName.replace(/^["']|["']$/g, '');
          if (sName) {
            registerServer(sName, sName, sourceLabel, {});
          }
        }
        return;
      }
      const parsed = parseJsonc(raw);
      if (parsed && typeof parsed === 'object') {
        let claudeProjServers: any;
        if (parsed.projects && typeof parsed.projects === 'object') {
          if (parsed.projects[ws]?.mcpServers) {
            claudeProjServers = parsed.projects[ws].mcpServers;
          } else {
            const normWs = ws.toLowerCase().replace(/\\/g, '/');
            for (const [pKey, pVal] of Object.entries(parsed.projects as Record<string, any>)) {
              if (pKey.toLowerCase().replace(/\\/g, '/') === normWs && pVal?.mcpServers) {
                claudeProjServers = pVal.mcpServers;
                break;
              }
            }
          }
        }

        const serverBuckets: Record<string, any>[] = [];
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') serverBuckets.push(parsed.mcpServers);
        if (parsed.mcp_servers && typeof parsed.mcp_servers === 'object') serverBuckets.push(parsed.mcp_servers);
        if (parsed.servers && typeof parsed.servers === 'object') serverBuckets.push(parsed.servers);
        if (parsed.mcp && typeof parsed.mcp === 'object') {
          if (parsed.mcp.servers && typeof parsed.mcp.servers === 'object') {
            serverBuckets.push(parsed.mcp.servers);
          } else if (!Array.isArray(parsed.mcp)) {
            serverBuckets.push(parsed.mcp);
          }
        }
        if (claudeProjServers && typeof claudeProjServers === 'object') {
          serverBuckets.push(claudeProjServers);
        }

        for (const bucket of serverBuckets) {
          for (const [sName, sCfg] of Object.entries(bucket)) {
            if (sCfg && typeof sCfg === 'object') {
              registerServer(sName, sName, sourceLabel, sCfg);
            }
          }
        }
      }
    } catch {}
  }

  // 1. Inspect Workspace configs
  if (!globalOnly) {
    inspectConfigFile(path.join(ws, '.mcp.json'), 'workspace:.mcp.json');
    inspectConfigFile(path.join(ws, '.cursor', 'mcp.json'), 'workspace:.cursor/mcp.json');
    inspectConfigFile(path.join(ws, '.vscode', 'mcp.json'), 'workspace:.vscode/mcp.json');
    inspectConfigFile(path.join(ws, 'opencode.json'), 'workspace:opencode.json');
    inspectConfigFile(path.join(ws, '.codex', 'config.toml'), 'workspace:.codex/config.toml');
  }

  // 2. Inspect Global host configs
  if (includeGlobal) {
    const home = os.homedir();
    inspectConfigFile(path.join(home, '.claude.json'), 'global:~/.claude.json');
    inspectConfigFile(path.join(home, '.cursor', 'mcp.json'), 'global:~/.cursor/mcp.json');
    const geminiEntries = getHomeGeminiEntries(home);
    if (geminiEntries.has('settings.json')) {
      inspectConfigFile(path.join(home, '.gemini', 'settings.json'), 'global:~/.gemini/settings.json');
    }
    if (geminiEntries.has('antigravity')) {
      inspectConfigFile(
        path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
        'global:~/.gemini/antigravity/mcp_config.json'
      );
    }
    inspectConfigFile(path.join(home, '.codex', 'config.toml'), 'global:~/.codex/config.toml');
    inspectConfigFile(
      path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      'global:~/.codeium/windsurf/mcp_config.json'
    );
  }

  const servers = Array.from(serversMap.values());
  let activeServers = 0;
  let pooledServers = 0;
  let totalTaxTokens = 0;
  let activeTaxTokens = 0;
  let pooledTaxTokens = 0;

  for (const s of servers) {
    totalTaxTokens += s.estimatedTokens;
    if (s.status === 'active') {
      activeServers++;
      activeTaxTokens += s.estimatedTokens;
    } else {
      pooledServers++;
      pooledTaxTokens += s.estimatedTokens;
    }
  }

  return {
    servers,
    totalServers: servers.length,
    activeServers,
    pooledServers,
    totalTaxTokens,
    activeTaxTokens,
    pooledTaxTokens,
  };
}

export interface GitBugHotspot {
  filePath: string;
  commits: number;
  fixRevertCommits: number;
  fragilityScore: number;
  memoryCount: number;
  scopedRuleCount: number;
  unprotected: boolean;
}

export function computeGitBugHotspots(workspaceRoot: string, limit = 10): GitBugHotspot[] {
  const ws = path.resolve(workspaceRoot);
  let gitOut = '';
  try {
    const res = child_process.spawnSync(
      'git',
      ['log', '-n', '100', '--name-only', '--pretty=format:__COMMIT__|%h|%s', '--', './'],
      { cwd: ws, encoding: 'utf8', timeout: 3000 }
    );
    if (res.status === 0 && res.stdout) {
      gitOut = res.stdout;
    }
  } catch {
    return [];
  }

  if (!gitOut) return [];

  const FIX_REGEX = /(?:fix|bug|revert|patch|resolve|regression|hotfix|issue|crash|fatal)/i;
  const fileCommitsMap = new Map<string, { total: number; fixes: number }>();

  const lines = gitOut.split(/\r?\n/);
  let currentSubject = '';
  let isFix = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('__COMMIT__|')) {
      const parts = line.split('|');
      currentSubject = parts.slice(2).join('|');
      isFix = FIX_REGEX.test(currentSubject);
      continue;
    }
    const normFile = line.replace(/\\/g, '/');
    if (
      normFile.startsWith('.git/') ||
      normFile.startsWith('.evo/') ||
      normFile.startsWith('templates/seed-evo/') ||
      normFile.startsWith('.github/') ||
      normFile.startsWith('dist/') ||
      normFile.startsWith('node_modules/') ||
      normFile.startsWith('assets/') ||
      normFile.startsWith('benchmarks/') ||
      /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[a-z0-9]+$/i.test(normFile) ||
      /\.(?:md|txt|svg|png|gif|webp|tape)$/i.test(normFile) ||
      /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|server\.json|plugin\.json|marketplace\.json|gemini-extension\.json|hooks\.json|mcp_config\.json|\.mcp\.json)$/i.test(normFile)
    ) {
      continue;
    }
    const cur = fileCommitsMap.get(normFile) || { total: 0, fixes: 0 };
    cur.total++;
    if (isFix) cur.fixes++;
    fileCommitsMap.set(normFile, cur);
  }

  if (fileCommitsMap.size === 0) return [];

  // Inspect .evo memories and scoped rules
  const evoDir = path.join(ws, '.evo');
  const fileMemoryCount = new Map<string, number>();
  const fileScopedRuleCount = new Map<string, number>();

  if (hasValidEvoStructure(evoDir)) {
    // Read memories with full AST fingerprint, target symbol file mapping, and body file references
    try {
      const storage = new EvoStorage(ws);
      const mems = storage.listMemories();
      for (const m of mems) {
        const matchedFilesForMem = new Set<string>();
        for (const sym of m.target_symbols || []) {
          if (sym.includes('#')) {
            const filePart = sym.split('#')[0].replace(/\\/g, '/');
            matchedFilesForMem.add(filePart);
          }
        }
        for (const fp of Object.values(m.ast_fingerprints || {})) {
          const file = (fp as any)?.file_path || (fp as any)?.file;
          if (file) {
            const norm = file.replace(/\\/g, '/');
            matchedFilesForMem.add(norm);
          }
        }
        const memText = `${m.l0_summary || ''}\n${m.symptom || ''}\n${m.root_cause || ''}\n${m.solution || ''}`;
        for (const [trackedFile] of fileCommitsMap) {
          if (matchedFilesForMem.has(trackedFile)) continue;
          const base = path.basename(trackedFile);
          if (memText.includes(trackedFile) || (base.length >= 10 && memText.includes(base))) {
            matchedFilesForMem.add(trackedFile);
          }
        }
        for (const f of matchedFilesForMem) {
          fileMemoryCount.set(f, (fileMemoryCount.get(f) || 0) + 1);
        }
      }
    } catch {}

    // Read scoped rules (including brace-expanded globs like src/{cli,mcp}/**/*.ts)
    const expandBraces = (pattern: string): string[] => {
      const m = pattern.match(/\{([^{}]+)\}/);
      if (!m) return [pattern];
      const parts = m[1].split(',').map((s) => s.trim());
      const out: string[] = [];
      for (const p of parts) {
        out.push(...expandBraces(pattern.slice(0, m.index!) + p + pattern.slice(m.index! + m[0].length)));
      }
      return out;
    };

    const rulesDir = path.join(evoDir, 'rules');
    if (fs.existsSync(rulesDir)) {
      try {
        const walk = (d: string) => {
          for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, ent.name);
            if (ent.isDirectory()) {
              walk(full);
            } else if (ent.isFile() && ent.name.endsWith('.md')) {
              const raw = fs.readFileSync(full, 'utf8');
              const match = raw.match(/scope_glob:\s*["']?([^"'\r\n]+)["']?/);
              if (match) {
                const glob = match[1].trim();
                if (glob !== '*' && glob !== '**/*') {
                  const expandedGlobs = expandBraces(glob.replace(/\\/g, '/'));
                  for (const [file] of fileCommitsMap) {
                    const normFile = file.replace(/\\/g, '/');
                    let matches = false;
                    for (const cleanGlob of expandedGlobs) {
                      const prefix = cleanGlob.replace(/\*.*$/, '');
                      if (prefix && normFile.startsWith(prefix)) {
                        matches = true;
                        break;
                      } else if (cleanGlob.startsWith('*.') && normFile.endsWith(cleanGlob.slice(1))) {
                        matches = true;
                        break;
                      } else if (cleanGlob.includes(path.basename(normFile))) {
                        matches = true;
                        break;
                      }
                    }
                    if (matches) {
                      fileScopedRuleCount.set(normFile, (fileScopedRuleCount.get(normFile) || 0) + 1);
                    }
                  }
                }
              }
            }
          }
        };
        walk(rulesDir);
      } catch {}
    }
  }

  const hotspots: GitBugHotspot[] = [];
  for (const [filePath, stats] of fileCommitsMap.entries()) {
    const fragilityScore = stats.total + 2 * stats.fixes;
    const memoryCount = fileMemoryCount.get(filePath) || 0;
    const scopedRuleCount = fileScopedRuleCount.get(filePath) || 0;
    const unprotected = memoryCount === 0 && scopedRuleCount === 0;

    hotspots.push({
      filePath,
      commits: stats.total,
      fixRevertCommits: stats.fixes,
      fragilityScore,
      memoryCount,
      scopedRuleCount,
      unprotected,
    });
  }

  hotspots.sort((a, b) => b.fragilityScore - a.fragilityScore);
  return hotspots.slice(0, limit);
}

export interface ScoreOptions {
  includeGlobal?: boolean;
  globalOnly?: boolean;
  anon?: boolean;
  cacheDb?: DatabaseSync;
}

export interface ScoreReport {
  mode: 'project' | 'global';
  workspaceRoot: string;
  timestamp: string;
  overallScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  waste100TurnsUsd: {
    sonnetUsd: number;
    opusUsd: number;
  };
  mcpTax: McpTaxReport;
  gitHotspots: GitBugHotspot[];
  unprotectedHotspots: number;
  totalHotspots: number;
  contextSavings: {
    beforeTokens: number;
    afterTokens: number;
    savedTokens: number;
    savingsPercent: number;
    userStaticRuleTokens: number;
    evoSeedTokens: number;
  };
  cacheShieldingScore: number;
  fragileCodeScore: number;
  capabilities: {
    rulesCount: number;
    scopedRulesCount: number;
    skillsCount: number;
    toolsCount: number;
    memoriesCount: number;
    verifiedMemoriesCount: number;
    totalRuleTokens: number;
  };
}

export function buildScoreReport(workspaceRoot: string, options?: ScoreOptions): ScoreReport {
  const ws = path.resolve(workspaceRoot);
  const isProj = !options?.globalOnly && isProjectDirectoryFast(ws);
  const mode = isProj ? 'project' : 'global';

  const mcpTax = inspectMcpTaxSnapshot(ws, {
    includeGlobal: options?.includeGlobal ?? true,
    globalOnly: mode === 'global',
  });

  const gitHotspots = mode === 'project' ? computeGitBugHotspots(ws, 10) : [];
  const unprotectedHotspots = gitHotspots.filter((h) => h.unprotected).length;

  let rulesCount = 0;
  let scopedRulesCount = 0;
  let skillsCount = 0;
  let toolsCount = 0;
  let memoriesCount = 0;
  let verifiedMemoriesCount = 0;
  let totalRuleTokens = 0;

  const evoDir = path.join(ws, '.evo');
  if (mode === 'project' && hasValidEvoStructure(evoDir)) {
    try {
      const rDir = path.join(evoDir, 'rules');
      if (fs.existsSync(rDir)) {
        const walk = (d: string) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile() && e.name.endsWith('.md')) {
              rulesCount++;
              if (p.includes(path.join(rDir, 'scoped'))) scopedRulesCount++;
              totalRuleTokens += estimateTokens(fs.readFileSync(p, 'utf8'));
            }
          }
        };
        walk(rDir);
      }
      const sDir = path.join(evoDir, 'skills');
      if (fs.existsSync(sDir)) {
        skillsCount = fs.readdirSync(sDir).filter((f) => !f.startsWith('.')).length;
      }
      const tDir = path.join(evoDir, 'tools');
      if (fs.existsSync(tDir)) {
        toolsCount = fs.readdirSync(tDir).filter((f) => !f.startsWith('.')).length;
      }
      try {
        const storage = new EvoStorage(ws);
        const mems = storage.listMemories();
        memoriesCount = mems.length;
        for (const m of mems) {
          try {
            const v = verifyMemoryFreshness(ws, m, { includeCallers: false, cacheDb: options?.cacheDb });
            if (v.overall_status === 'VERIFIED') verifiedMemoriesCount++;
          } catch {}
        }
      } catch {}
    } catch {}
  }

  // Measure host rule files (splitting user static vs evo managed seed)
  let userStaticRuleTokens = 0;
  let evoSeedTokens = 0;
  const home = os.homedir();
  const ruleFilesToMeasure =
    mode === 'project'
      ? [
          path.join(ws, 'CLAUDE.md'),
          path.join(ws, 'AGENTS.md'),
          path.join(ws, 'GEMINI.md'),
          path.join(ws, '.cursorrules'),
          path.join(ws, '.windsurfrules'),
          path.join(ws, '.clinerules'),
          path.join(ws, '.github', 'copilot-instructions.md'),
          path.join(ws, '.cursor', 'rules', 'evo-kernel.mdc'),
        ]
      : [
          path.join(home, '.claude', 'CLAUDE.md'),
          ...(getHomeGeminiEntries(home).has('GEMINI.md') ? [path.join(home, '.gemini', 'GEMINI.md')] : []),
          path.join(home, '.codex', 'AGENTS.md'),
        ];

  const measuredRuleFiles = new Set<string>();
  for (const rf of ruleFilesToMeasure) {
    const norm = path.resolve(rf);
    if (!measuredRuleFiles.has(norm) && fs.existsSync(norm)) {
      measuredRuleFiles.add(norm);
      try {
        const raw = fs.readFileSync(norm, 'utf8');
        const markerRegex = /<!-- EVO:START -->[\s\S]*?<!-- EVO:END -->/g;
        let insideTotal = '';
        let m: RegExpExecArray | null;
        while ((m = markerRegex.exec(raw)) !== null) {
          insideTotal += m[0] + '\n';
        }
        const outside = raw.replace(markerRegex, '').trim();
        if (outside) {
          userStaticRuleTokens += estimateTokens(outside);
        }
        if (insideTotal) {
          evoSeedTokens = Math.max(evoSeedTokens, estimateTokens(insideTotal));
        }
      } catch {}
    }
  }

  // Token savings computation (includes virtualized L1/L2 rules, skills, micro-tools, and 0-cost episodic memories)
  const virtualizedCapabilityTokens =
    totalRuleTokens + skillsCount * 650 + toolsCount * 450 + memoriesCount * 400;
  const beforeTokens =
    mcpTax.totalTaxTokens +
    userStaticRuleTokens +
    Math.max(virtualizedCapabilityTokens, evoSeedTokens);
  const afterMcpTax =
    mcpTax.activeTaxTokens > 0
      ? mcpTax.activeTaxTokens + 350
      : (mcpTax.totalServers > 0 ? 350 : 0);
  const afterTokens = afterMcpTax + userStaticRuleTokens + Math.min(evoSeedTokens, 1500);
  const savedTokens = Math.max(0, beforeTokens - afterTokens);
  const savingsPercent =
    beforeTokens > 0 ? Math.round((savedTokens / beforeTokens) * 100) : 0;

  // Cache Shielding Score (0 - 100)
  const hasVirtualizedCapabilities = rulesCount + skillsCount + toolsCount + memoriesCount > 0;
  const cacheShieldingScore =
    mcpTax.totalServers === 0
      ? (hasVirtualizedCapabilities ? 100 : 95)
      : Math.round(
          Math.min(100, Math.max(10, ((mcpTax.pooledServers + 1) / (mcpTax.totalServers + 1)) * 100))
        );

  // Fragile Code Protection Score (0 - 100)
  let fragileCodeScore = 100;
  if (gitHotspots.length > 0) {
    const protectedRatio = (gitHotspots.length - unprotectedHotspots) / gitHotspots.length;
    fragileCodeScore = Math.round(protectedRatio * 100);
  }

  // Overall Score (0 - 100)
  const contextEfficiency = savingsPercent;
  const overallScore = Math.min(
    100,
    Math.max(
      20,
      Math.round(contextEfficiency * 0.4 + cacheShieldingScore * 0.3 + fragileCodeScore * 0.3)
    )
  );

  let grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' = 'F';
  if (overallScore >= 95) grade = 'A+';
  else if (overallScore >= 85) grade = 'A';
  else if (overallScore >= 70) grade = 'B';
  else if (overallScore >= 55) grade = 'C';
  else if (overallScore >= 40) grade = 'D';

  const activeMcpWaste = mcpTax.activeTaxTokens > 350 ? mcpTax.activeTaxTokens - 350 : (mcpTax.activeTaxTokens > 0 ? mcpTax.activeTaxTokens : 0);
  const ruleWaste = userStaticRuleTokens > 1500 ? userStaticRuleTokens - 1500 : 0;
  const wasteTokensPerTurn = activeMcpWaste + ruleWaste;
  const wastedTokens100 = wasteTokensPerTurn * 100;
  const waste100TurnsUsd = {
    sonnetUsd: Number(((wastedTokens100 / 1_000_000) * 3).toFixed(2)),
    opusUsd: Number(((wastedTokens100 / 1_000_000) * 15).toFixed(2)),
  };

  return {
    mode,
    workspaceRoot: options?.anon ? '<WORKSPACE>' : ws,
    timestamp: new Date().toISOString(),
    overallScore,
    grade,
    waste100TurnsUsd,
    mcpTax,
    gitHotspots,
    unprotectedHotspots,
    totalHotspots: gitHotspots.length,
    contextSavings: {
      beforeTokens,
      afterTokens,
      savedTokens,
      savingsPercent,
      userStaticRuleTokens,
      evoSeedTokens,
    },
    cacheShieldingScore,
    fragileCodeScore,
    capabilities: {
      rulesCount,
      scopedRulesCount,
      skillsCount,
      toolsCount,
      memoriesCount,
      verifiedMemoriesCount,
      totalRuleTokens,
    },
  };
}

export function renderScoreBadge(report: ScoreReport): string {
  const score = report.overallScore;
  const color = score >= 80 ? 'brightgreen' : score >= 60 ? 'yellow' : 'red';
  return `[![EvoKernel Score](https://img.shields.io/badge/EvoKernel_Score-${score}%2F100-${color}.svg)](https://github.com/damonless/EvoKernel)`;
}

export function renderScoreSvg(report: ScoreReport): string {
  const escSvg = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const wsName = escSvg(path.basename(report.workspaceRoot || 'workspace') || 'workspace');
  const scoreColor = report.overallScore >= 90 ? '#34d399' : report.overallScore >= 75 ? '#38bdf8' : '#fbbf24';
  const hotspotRows = report.gitHotspots
    .slice(0, 5)
    .map((h, i) => {
      const y = 262 + i * 28;
      const badgeFill = h.unprotected ? '#7f1d1d' : '#064e3b';
      const badgeStroke = h.unprotected ? '#f87171' : '#34d399';
      const badgeText = h.unprotected ? 'UNPROTECTED' : `PROTECTED (${h.memoryCount}m/${h.scopedRuleCount}r)`;
      const shortPath = escSvg(h.filePath.length > 32 ? '…' + h.filePath.slice(-31) : h.filePath);
      return `
    <g transform="translate(450, ${y})">
      <rect x="0" y="-16" width="420" height="24" rx="4" fill="#111827" stroke="#1f2937"/>
      <text x="10" y="0" fill="#e5e7eb" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11.5">${shortPath}</text>
      <rect x="275" y="-13" width="136" height="18" rx="3" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="0.8"/>
      <text x="343" y="-1" text-anchor="middle" fill="${badgeStroke}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9.5" font-weight="700">${badgeText}</text>
    </g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 420" width="900" height="420">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#070b14"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#34d399"/>
    </linearGradient>
  </defs>
  <rect width="900" height="420" rx="14" fill="url(#bgGrad)" stroke="#1e293b" stroke-width="2"/>
  <rect x="0" y="0" width="900" height="4" rx="2" fill="url(#accentGrad)"/>

  <!-- Header -->
  <text x="32" y="42" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" font-weight="800">🧬 EvoKernel Dual X-Ray Diagnostic Card</text>
  <text x="32" y="64" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="12.5">Workspace: ${wsName}  •  Deterministic Gatekeeper &amp; 5-Tool Meta-MCP Gateway</text>
  <rect x="730" y="24" width="138" height="28" rx="14" fill="#064e3b" stroke="#34d399" stroke-width="1"/>
  <text x="799" y="42" text-anchor="middle" fill="#34d399" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="700">GRADE: ${escSvg(report.grade)}</text>

  <!-- Left Panel: Context & Prompt-Cache Shield -->
  <rect x="28" y="84" width="396" height="308" rx="10" fill="#0b1120" stroke="#1e293b"/>
  <text x="48" y="114" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="700">1. CONTEXT HEALTH &amp; TOKEN SHIELDING</text>
  <text x="48" y="172" fill="${scoreColor}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="54" font-weight="800">${report.overallScore}<tspan font-size="22" fill="#64748b">/100</tspan></text>

  <text x="48" y="208" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5">Eager Load (Before): <tspan fill="#fbbf24" font-weight="700">${report.contextSavings.beforeTokens.toLocaleString()} tok/turn</tspan></text>
  <text x="48" y="232" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5">Virtual Load (After): <tspan fill="#34d399" font-weight="700">${report.contextSavings.afterTokens.toLocaleString()} tok/turn</tspan></text>
  <text x="48" y="256" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12.5">Net Prompt Tax Saved: <tspan fill="#34d399" font-weight="800">-${report.contextSavings.savingsPercent}% (${report.contextSavings.savedTokens.toLocaleString()} tok)</tspan></text>

  <!-- Progress Bar -->
  <rect x="48" y="274" width="356" height="12" rx="6" fill="#1e293b"/>
  <rect x="48" y="274" width="${Math.max(12, Math.round(356 * (report.contextSavings.savingsPercent / 100)))}" height="12" rx="6" fill="url(#accentGrad)"/>

  <text x="48" y="316" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11.5">Cache Shielding: <tspan fill="#38bdf8" font-weight="700">${report.cacheShieldingScore}%</tspan>  •  Hotspot Shield: <tspan fill="#34d399" font-weight="700">${report.fragileCodeScore}%</tspan></text>
  <text x="48" y="340" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11.5">Evolved Tree: <tspan fill="#f8fafc">${report.capabilities.rulesCount} rules, ${report.capabilities.skillsCount} skills, ${report.capabilities.toolsCount} tools, ${report.capabilities.verifiedMemoriesCount}/${report.capabilities.memoriesCount} AST memories</tspan></text>
  <text x="48" y="368" fill="#38bdf8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">$ npx evo-kernel score   •   github.com/damonless/EvoKernel</text>

  <!-- Right Panel: Fragile Hotspots & AST Memory Coverage -->
  <rect x="440" y="84" width="432" height="308" rx="10" fill="#0b1120" stroke="#1e293b"/>
  <text x="456" y="114" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" font-weight="700">2. GIT FRAGILITY HOTSPOTS &amp; AST MEMORY ANCHORS</text>
  <text x="456" y="142" fill="#e2e8f0" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="13">Tracked Hotspots: <tspan font-weight="700">${report.totalHotspots}</tspan>   •   Unprotected: <tspan fill="${report.unprotectedHotspots === 0 ? '#34d399' : '#f87171'}" font-weight="700">${report.unprotectedHotspots === 0 ? '0 (100% AST Guarded)' : report.unprotectedHotspots}</tspan></text>
  <text x="456" y="166" fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">AST Fingerprints Verified: ${report.capabilities.verifiedMemoriesCount}/${report.capabilities.memoriesCount} [VERIFIED] at 0 Core Token Cost</text>
  <line x1="456" y1="182" x2="856" y2="182" stroke="#1e293b" stroke-width="1"/>
  <text x="456" y="204" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="700">TOP PRODUCTION HOTSPOTS (GIT FIX FREQUENCY)</text>
  <text x="456" y="232" fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="10.5">FILE PATH                                         PROTECTION STATUS</text>
  ${hotspotRows}
</svg>\n`;
}

export function renderScoreAnsi(report: ScoreReport): string {
  const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
  };

  const lines: string[] = [];
  lines.push('');
  lines.push(
    `${c.bold}${c.cyan}╔════════════════════════════════════════════════════════════════════╗${c.reset}`
  );
  lines.push(
    `${c.bold}${c.cyan}║   🧬  EvoKernel Context Health & Fragility Score Report             ║${c.reset}`
  );
  lines.push(
    `${c.bold}${c.cyan}╚════════════════════════════════════════════════════════════════════╝${c.reset}`
  );
  lines.push('');
  lines.push(
    `  Target Mode        : ${c.bold}${report.mode.toUpperCase()}${c.reset} (${report.workspaceRoot})`
  );
  lines.push(
    `  Overall Score      : ${c.bold}${report.overallScore >= 80 ? c.green : report.overallScore >= 60 ? c.yellow : c.red}${report.overallScore} / 100${c.reset}  ${c.dim}[Grade: ${c.bold}${report.grade}${c.dim}]${c.reset}`
  );
  lines.push('');
  lines.push(`${c.bold}📊 Context & MCP Tax Virtualization${c.reset}`);
  lines.push(
    `  ├─ Eager Schema Tax: ${c.yellow}${report.contextSavings.beforeTokens.toLocaleString()} tokens${c.reset} (before EvoKernel)`
  );
  lines.push(
    `  ├─ Virtualized Load: ${c.green}${report.contextSavings.afterTokens.toLocaleString()} tokens${c.reset} (after EvoKernel)`
  );
  lines.push(
    `  ├─ Virtualized Gain: ${c.bold}${c.green}${report.contextSavings.savedTokens.toLocaleString()} tokens saved (-${report.contextSavings.savingsPercent}% prompt tax)${c.reset}`
  );
  lines.push(
    `  ├─ 100-Turn Waste  : ${c.yellow}$${report.waste100TurnsUsd.sonnetUsd.toFixed(2)}${c.reset} (Sonnet) / ${c.red}$${report.waste100TurnsUsd.opusUsd.toFixed(2)}${c.reset} (Opus)`
  );
  lines.push(
    `  └─ MCP Servers     : ${report.mcpTax.activeServers} active, ${report.mcpTax.pooledServers} pooled (${report.mcpTax.totalServers} total)`
  );

  if (report.mcpTax.servers.length > 0) {
    lines.push('');
    lines.push(`   ${c.dim}Top MCP Tool Schemas:${c.reset}`);
    for (const s of report.mcpTax.servers.slice(0, 5)) {
      const badge = s.status === 'pooled' ? `${c.green}[POOLED]${c.reset}` : `${c.yellow}[ACTIVE]${c.reset}`;
      lines.push(`     • ${s.name.padEnd(20)} ~${s.estimatedTokens} tok  ${badge} ${c.dim}(${s.source})${c.reset}`);
    }
  }

  if (report.mode === 'project') {
    lines.push('');
    lines.push(`${c.bold}🛡️ Fragile Code & Cognitive Memory Coverage${c.reset}`);
    lines.push(
      `  ├─ Fragile Hotspots: ${report.totalHotspots} tracked, ${report.unprotectedHotspots === 0 ? c.green + '0 unprotected' : c.red + report.unprotectedHotspots + ' unprotected'}${c.reset}`
    );
    lines.push(
      `  └─ Capabilities    : ${report.capabilities.rulesCount} rules (${report.capabilities.scopedRulesCount} scoped), ${report.capabilities.memoriesCount} memories (${report.capabilities.verifiedMemoriesCount} verified AST)`
    );

    if (report.gitHotspots.length > 0) {
      lines.push('');
      lines.push(`   ${c.dim}Top Fragility Hotspots (Recent Git History):${c.reset}`);
      for (const h of report.gitHotspots.slice(0, 5)) {
        const stat = h.unprotected
          ? `${c.red}⚠️  UNPROTECTED${c.reset}`
          : `${c.green}✅ PROTECTED (${h.memoryCount} mem, ${h.scopedRuleCount} rule)${c.reset}`;
        lines.push(
          `     • ${h.filePath.padEnd(32)} ${stat} ${c.dim}(fragility: ${h.fragilityScore}, fixes: ${h.fixRevertCommits})${c.reset}`
        );
      }
    }
  }

  lines.push('');
  lines.push(
    `  ${c.bold}Action:${c.reset} ${c.cyan}npx evo-kernel init --stealth && npx evo-kernel virtualize --dry-run${c.reset}`
  );
  lines.push(
    `${c.dim}Run \`npx evo-kernel ui\` to inspect interactive X-Ray treemap & capability constellation.${c.reset}`
  );
  lines.push('');
  return lines.join('\n');
}

export async function runScoreCli(workspaceRoot: string, args: string[]): Promise<void> {
  const isJson = args.includes('--json');
  const isBadge = args.includes('--badge');
  const isAnon = args.includes('--anon');
  const globalOnly = args.includes('--global') || args.includes('-g');

  const report = buildScoreReport(workspaceRoot, {
    anon: isAnon,
    globalOnly,
  });

  if (isJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (isBadge) {
    console.log(renderScoreBadge(report));
    return;
  }

  const svgIdx = args.indexOf('--svg');
  if (svgIdx !== -1) {
    const svgContent = renderScoreSvg(report);
    const nextArg = args[svgIdx + 1];
    if (nextArg && !nextArg.startsWith('-')) {
      const outSvg = path.resolve(nextArg);
      fs.mkdirSync(path.dirname(outSvg), { recursive: true });
      fs.writeFileSync(outSvg, svgContent, 'utf8');
      console.log(`✅ Score SVG X-Ray card exported to: ${outSvg}`);
    } else {
      process.stdout.write(svgContent);
    }
    return;
  }

  const htmlIdx = args.indexOf('--html');
  if (htmlIdx !== -1) {
    const outPath = args[htmlIdx + 1] && !args[htmlIdx + 1].startsWith('-')
      ? path.resolve(args[htmlIdx + 1])
      : path.join(path.resolve(workspaceRoot), 'evo-score.html');
    const { exportUiHtml } = await import('./ui.js');
    exportUiHtml(workspaceRoot, outPath, { anon: isAnon });
    console.log(`✅ Score HTML report exported to: ${outPath}`);
    return;
  }

  console.log(renderScoreAnsi(report));
}
