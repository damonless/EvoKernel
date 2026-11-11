import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseJsonc } from './harness.js';
import {
  EvoStorage,
  META_MCP_5_TOOLS_TOKENS,
  estimateTokens,
  hasValidEvoStructure,
  openSqliteReadOnly,
} from '../core/storage.js';
import { formatTerminalOutput, isAsciiMode, isColorEnabled } from './term.js';

export { META_MCP_5_TOOLS_TOKENS } from '../core/storage.js';
import {
  type RecallWindowStats,
  emptyRecallWindowStats,
  readRecallWindowStatsFromDb,
  redactSensitiveDiagnostics,
} from '../core/telemetry.js';
import { verifyMemoryFreshness } from '../core/memory.js';

function formatCompactTok(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '0';
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(tokens));
}

function scrubAnonString(raw: string, ws?: string): string {
  let out = redactSensitiveDiagnostics(raw || '', ws);
  out = out.replace(/(?<![A-Za-z0-9_])[A-Za-z]:[\\/]+[^\s"'<>|]*/g, '<PATH>');
  out = out.replace(/\/(?:Users|home)\/[^\s"'<>|]*/g, '<HOME>');
  return out;
}

export function isProjectDirectoryFast(dir: string): boolean {
  try {
    const resolved = path.resolve(dir);
    const home = path.resolve(os.homedir());
    const root = path.parse(resolved).root;
    if (
      resolved.toLowerCase() === home.toLowerCase() ||
      resolved.toLowerCase() === root.toLowerCase() ||
      (path.dirname(resolved).toLowerCase() === home.toLowerCase() &&
        /^\.(?:claude|gemini|cursor|codex|windsurf|cline|roo|codeium)$/i.test(path.basename(resolved)))
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
      '.gemini',
      '.codex',
      '.windsurf',
      '.cline',
      '.roo',
      '.vscode',
      'opencode.json',
      'mcp_config.json',
      '.cursorrules',
      '.windsurfrules',
      '.clinerules',
      '.roorules',
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
    inspectConfigFile(path.join(ws, '.gemini', 'settings.json'), 'workspace:.gemini/settings.json');
    inspectConfigFile(path.join(ws, '.windsurf', 'mcp.json'), 'workspace:.windsurf/mcp.json');
    inspectConfigFile(path.join(ws, '.windsurf', 'mcp_config.json'), 'workspace:.windsurf/mcp_config.json');
    inspectConfigFile(path.join(ws, '.cline', 'mcp.json'), 'workspace:.cline/mcp.json');
    inspectConfigFile(path.join(ws, '.roo', 'mcp.json'), 'workspace:.roo/mcp.json');
    inspectConfigFile(path.join(ws, 'mcp_config.json'), 'workspace:mcp_config.json');
    inspectConfigFile(path.join(ws, 'opencode.json'), 'workspace:opencode.json');
    inspectConfigFile(path.join(ws, '.codex', 'config.toml'), 'workspace:.codex/config.toml');
  }

  // 2. Inspect Global host configs
  if (includeGlobal) {
    const home = os.homedir();
    inspectConfigFile(path.join(home, '.claude.json'), 'global:~/.claude.json');
    inspectConfigFile(path.join(home, '.cursor', 'mcp.json'), 'global:~/.cursor/mcp.json');
    inspectConfigFile(path.join(home, '.gemini', 'settings.json'), 'global:~/.gemini/settings.json');
    inspectConfigFile(
      path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
      'global:~/.gemini/antigravity/mcp_config.json'
    );
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

export function isExcludedGitHotspotPath(filePath: string): boolean {
  const normFile = filePath.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  if (!normFile) return true;
  return (
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
    /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|server\.json|plugin\.json|marketplace\.json|gemini-extension\.json|hooks\.json|mcp_config\.json|\.mcp\.json)$/i.test(
      normFile
    )
  );
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
    if (isExcludedGitHotspotPath(normFile)) {
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
      const mems = storage.listMemories().filter((m) => m.enabled !== false);
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
              if (/^\s*enabled:\s*(?:false|"false"|'false')\s*$/m.test(raw)) {
                continue;
              }
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
  hasEvo?: boolean;
  deductions?: string[];
  recallTelemetry?: { totalHits: number; helpedCount: number; measuredTokensSaved: number };
  window7d?: RecallWindowStats;
}

export function buildScoreReport(workspaceRoot: string, options?: ScoreOptions): ScoreReport {
  const ws = path.resolve(workspaceRoot);
  const isProj = !options?.globalOnly && isProjectDirectoryFast(ws);
  const mode = isProj ? 'project' : 'global';

  const mcpTax = inspectMcpTaxSnapshot(ws, {
    includeGlobal: options?.anon ? false : (options?.includeGlobal ?? true),
    globalOnly: mode === 'global',
  });
  if (options?.anon && Array.isArray(mcpTax.servers)) {
    mcpTax.servers = mcpTax.servers.map((srv, idx) => {
      const norm = String(srv.name || srv.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const isEvoSelf = norm === 'evo-kernel' || norm === 'evo' || norm === 'evokernel';
      const isExactPublicProfile = Object.keys(KNOWN_HEAVY_MCP_PROFILES).some((k) => norm === k);
      const keepName = isEvoSelf || isExactPublicProfile;
      const safeName = keepName ? scrubAnonString(srv.name || '', ws) : `custom-mcp-${idx + 1}`;
      const safeId = keepName ? scrubAnonString(srv.id || '', ws) : `custom-mcp-${idx + 1}`;
      return {
        ...srv,
        id: safeId,
        name: safeName,
        source: scrubAnonString(srv.source || '', ws),
        tools: Array.isArray(srv.tools)
          ? srv.tools.map((t, tIdx) => (keepName ? scrubAnonString(String(t), ws) : `tool_${tIdx + 1}`))
          : srv.tools,
      };
    });
  }

  const rawHotspots = mode === 'project' ? computeGitBugHotspots(ws, 10) : [];
  const gitHotspots = options?.anon
    ? rawHotspots.map((h, idx) => ({
        ...h,
        filePath: `src/module-${idx + 1}${path.extname(h.filePath) || '.ts'}`,
      }))
    : rawHotspots;
  const unprotectedHotspots = gitHotspots.filter((h) => h.unprotected).length;

  let rulesCount = 0;
  let scopedRulesCount = 0;
  let skillsCount = 0;
  let toolsCount = 0;
  let memoriesCount = 0;
  let verifiedMemoriesCount = 0;
  let totalRuleTokens = 0;
  let totalSkillTokens = 0;
  let totalToolTokens = 0;
  let totalMemoryTokens = 0;

  const measureFileTokensSafe = (filePath: string): number => {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return estimateTokens(fs.readFileSync(filePath, 'utf8'));
      }
    } catch {}
    return 0;
  };

  const measureDirMarkdownTokensSafe = (dirPath: string): number => {
    let sum = 0;
    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return 0;
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          sum += measureDirMarkdownTokensSafe(full);
        } else if (entry.isFile() && /\.(?:md|json|ya?ml|txt)$/i.test(entry.name)) {
          sum += measureFileTokensSafe(full);
        }
      }
    } catch {}
    return sum;
  };

  const evoDir = path.join(ws, '.evo');
  const hasEvo = mode === 'project' && hasValidEvoStructure(evoDir);
  if (hasEvo) {
    try {
      const storage = new EvoStorage(ws);
      const activeRules = storage.listRules().filter((r) => r.enabled !== false);
      rulesCount = activeRules.length;
      scopedRulesCount = activeRules.filter((r) => !r.core).length;
      for (const r of activeRules) {
        const corePath = path.join(storage.rulesDir, `${r.id}.md`);
        const scopedPath = path.join(storage.rulesDir, 'scoped', `${r.id}.md`);
        const diskTok = measureFileTokensSafe(r.core ? corePath : scopedPath) || measureFileTokensSafe(corePath) || measureFileTokensSafe(scopedPath);
        totalRuleTokens += diskTok > 0 ? diskTok : (r.tokens || estimateTokens(r.content));
      }

      const activeSkills = storage.listSkills().filter((s) => s.enabled !== false);
      skillsCount = activeSkills.length;
      for (const s of activeSkills) {
        const skillDir = path.join(storage.skillsDir, s.id);
        const diskTok = measureDirMarkdownTokensSafe(skillDir);
        totalSkillTokens +=
          diskTok > 0
            ? diskTok
            : estimateTokens(`${s.l0_summary || ''}\n${s.l1_contract || ''}\n${s.l2_sop || ''}`);
      }

      const activeTools = storage.listTools().filter((t) => t.enabled !== false);
      toolsCount = activeTools.length;
      for (const t of activeTools) {
        const manifestPath = path.join(storage.toolsDir, t.id, 'manifest.json');
        const manifestTok = measureFileTokensSafe(manifestPath);
        const fallbackTok = t.script_path ? measureFileTokensSafe(t.script_path) : 0;
        totalToolTokens +=
          manifestTok > 0
            ? manifestTok
            : fallbackTok > 0
              ? fallbackTok
              : estimateTokens(`${t.title || ''}\n${t.l0_summary || ''}\n${JSON.stringify(t.input_schema || {})}`);
      }

      const activeMemories = storage.listMemories().filter((m) => m.enabled !== false);
      memoriesCount = activeMemories.length;
      for (const m of activeMemories) {
        const memPath = path.join(storage.memoriesDir, `${m.id}.md`);
        const diskTok = measureFileTokensSafe(memPath);
        totalMemoryTokens +=
          diskTok > 0
            ? diskTok
            : estimateTokens(`${m.symptom || ''}\n${m.root_cause || ''}\n${m.solution || ''}`);
        try {
          const v = verifyMemoryFreshness(ws, m, { includeCallers: false, cacheDb: options?.cacheDb });
          if (v.overall_status === 'VERIFIED') verifiedMemoriesCount++;
        } catch {}
      }
    } catch {}
  }

  let recallTelemetry: { totalHits: number; helpedCount: number; measuredTokensSaved: number } | undefined;
  let window7d: RecallWindowStats | undefined = hasEvo ? emptyRecallWindowStats(7) : undefined;
  const telemetryDbPath = path.join(evoDir, '.cache', 'telemetry.db');
  if (hasEvo && (options?.cacheDb || fs.existsSync(telemetryDbPath))) {
    let db: DatabaseSync | undefined = options?.cacheDb;
    let openedLocal = false;
    try {
      if (!db) {
        db = openSqliteReadOnly(telemetryDbPath);
        openedLocal = true;
      }
      window7d = readRecallWindowStatsFromDb(db, 7);
      try {
        const row = db.prepare('SELECT SUM(hit_count) AS hits, SUM(helped_count) AS helped, SUM(tokens_saved) AS saved FROM telemetry').get() as any;
        if (row && (row.hits !== null || row.helped !== null || row.saved !== null)) {
          recallTelemetry = {
            totalHits: Number(row.hits || 0),
            helpedCount: Number(row.helped || 0),
            measuredTokensSaved: Number(row.saved || 0),
          };
        }
      } catch {
        try {
          const rowFallback = db.prepare('SELECT SUM(hit_count) AS hits, SUM(helped_count) AS helped FROM telemetry').get() as any;
          if (rowFallback && (rowFallback.hits !== null || rowFallback.helped !== null)) {
            recallTelemetry = {
              totalHits: Number(rowFallback.hits || 0),
              helpedCount: Number(rowFallback.helped || 0),
              measuredTokensSaved: 0,
            };
          }
        } catch {}
      }
    } catch {} finally {
      if (openedLocal && db) {
        try { db.close(); } catch {}
      }
    }
  }

  // Measure host rule files (splitting user static vs evo managed seed)
  let userStaticRuleTokens = 0;
  let evoSeedTokens = 0;
  const home = os.homedir();
  const effectiveIncludeGlobal = options?.anon ? false : (options?.includeGlobal ?? true);
  const ruleFilesToMeasure =
    mode === 'project'
      ? [
          path.join(ws, 'CLAUDE.md'),
          path.join(ws, 'AGENTS.md'),
          path.join(ws, 'GEMINI.md'),
          path.join(ws, '.cursorrules'),
          path.join(ws, '.windsurfrules'),
          path.join(ws, '.clinerules'),
          path.join(ws, '.roorules'),
          path.join(ws, '.github', 'copilot-instructions.md'),
          path.join(ws, '.cursor', 'rules', 'evo-kernel.mdc'),
        ]
      : effectiveIncludeGlobal || Boolean(options?.globalOnly)
        ? [
            path.join(home, '.claude', 'CLAUDE.md'),
            path.join(home, '.gemini', 'GEMINI.md'),
            path.join(home, '.codex', 'AGENTS.md'),
          ]
        : [];

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

  // Token savings computation (measured from actual on-disk .evo/ capability files + unified 5-tool Meta-MCP constant)
  const virtualizedCapabilityTokens =
    totalRuleTokens + totalSkillTokens + totalToolTokens + totalMemoryTokens;
  const beforeTokens =
    mcpTax.totalTaxTokens +
    userStaticRuleTokens +
    Math.max(virtualizedCapabilityTokens, evoSeedTokens);
  const hasMetaMcpGateway =
    mcpTax.totalServers > 0 || (hasEvo && virtualizedCapabilityTokens > META_MCP_5_TOOLS_TOKENS);
  const afterMcpTax =
    mcpTax.activeTaxTokens > 0
      ? mcpTax.activeTaxTokens + META_MCP_5_TOOLS_TOKENS
      : (hasMetaMcpGateway ? META_MCP_5_TOOLS_TOKENS : 0);
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

  const activeMcpWaste =
    hasEvo || mcpTax.pooledServers > 0
      ? mcpTax.activeTaxTokens
      : mcpTax.activeTaxTokens > META_MCP_5_TOOLS_TOKENS
        ? mcpTax.activeTaxTokens - META_MCP_5_TOOLS_TOKENS
        : mcpTax.activeTaxTokens > 0
          ? mcpTax.activeTaxTokens
          : 0;
  const ruleWaste = userStaticRuleTokens > 1500 ? userStaticRuleTokens - 1500 : 0;
  const wasteTokensPerTurn = activeMcpWaste + ruleWaste;
  const wastedTokens100 = wasteTokensPerTurn * 100;
  const waste100TurnsUsd = {
    sonnetUsd: Number(((wastedTokens100 / 1_000_000) * 3).toFixed(2)),
    opusUsd: Number(((wastedTokens100 / 1_000_000) * 15).toFixed(2)),
  };

  const deductions: string[] = [];
  if (overallScore < 100) {
    if (mcpTax.activeServers > 0) {
      deductions.push(
        `Unvirtualized MCP schemas (${mcpTax.activeServers} active server(s), ~${mcpTax.activeTaxTokens} tok/turn)`
      );
    }
    if (unprotectedHotspots > 0) {
      deductions.push(
        `Unshielded fragile git hotspots (${unprotectedHotspots}/${gitHotspots.length} unprotected)`
      );
    }
    if (!hasEvo) {
      deductions.push('EvoKernel not initialized in workspace (0 AST memories / rules)');
    }
    if (memoriesCount > verifiedMemoriesCount) {
      deductions.push(
        `${memoriesCount - verifiedMemoriesCount} stale/unverified episodic memory(s)`
      );
    }
  }

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
    hasEvo,
    deductions: deductions.length > 0 ? deductions : undefined,
    recallTelemetry,
    window7d,
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
  const scoreColor = report.overallScore >= 90 ? '#10b981' : report.overallScore >= 75 ? '#38bdf8' : '#f59e0b';
  const circumference = 226.19;
  const dashOffset = (circumference - (Math.min(100, Math.max(0, report.overallScore)) / 100) * circumference).toFixed(1);
  const barWidth = Math.max(14, Math.round(364 * (report.contextSavings.savingsPercent / 100)));
  const hotspotPctLabel =
    report.totalHotspots > 0
      ? `Hotspots Protected (${report.fragileCodeScore}% Shielded)`
      : 'No Fragile Hotspots Detected';
  const staleMemoriesCount = Math.max(
    0,
    report.capabilities.memoriesCount - report.capabilities.verifiedMemoriesCount
  );
  const memSubLabel =
    report.capabilities.memoriesCount > 0
      ? `16-Hex AST Fingerprints (${report.capabilities.verifiedMemoriesCount}/${report.capabilities.memoriesCount} Verified · ${staleMemoriesCount === 0 ? 'Zero Stale Drift' : staleMemoriesCount + ' Stale'})`
      : '0 Episodic Memories Yet · Run evo bootstrap to initialize';

  const hotspotRows = report.gitHotspots
    .slice(0, 5)
    .map((h, i) => {
      const y = 248 + i * 31;
      const badgeFill = h.unprotected ? 'rgba(248,113,113,0.14)' : 'rgba(16,185,129,0.14)';
      const badgeStroke = h.unprotected ? 'rgba(248,113,113,0.4)' : 'rgba(16,185,129,0.4)';
      const badgeTextColor = h.unprotected ? '#f87171' : '#34d399';
      const badgeText = h.unprotected ? 'UNPROTECTED' : `● PROTECTED (${h.memoryCount}m/${h.scopedRuleCount}r)`;
      const shortPath = escSvg(h.filePath.length > 32 ? '…' + h.filePath.slice(-31) : h.filePath);
      return `
    <g transform="translate(462, ${y})">
      <rect x="0" y="-17" width="444" height="26" rx="6" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.06)"/>
      <text x="12" y="0" fill="#e2e8f0" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11.5">${shortPath}</text>
      <rect x="292" y="-13" width="142" height="18" rx="9" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="0.9"/>
      <text x="363" y="-1" text-anchor="middle" fill="${badgeTextColor}" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9.5" font-weight="600">${badgeText}</text>
    </g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 430" width="940" height="430">
  <defs>
    <style>
      @keyframes needleSweep {
        from { stroke-dashoffset: ${circumference}; }
        to { stroke-dashoffset: ${dashOffset}; }
      }
      @keyframes barGrow {
        from { width: 0; }
        to { width: ${barWidth}px; }
      }
      .score-gauge-ring {
        animation: needleSweep 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .savings-bar-fill {
        animation: barGrow 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
    </style>
    <radialGradient id="ambientGlow" cx="50%" cy="0%" r="70%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.16"/>
      <stop offset="45%" stop-color="#38bdf8" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#050608" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cardSurface" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.045)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.012)"/>
    </linearGradient>
    <linearGradient id="barGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>

  <!-- Obsidian Base & Ambient Rim Light -->
  <rect width="940" height="430" rx="16" fill="#050608" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
  <rect width="940" height="430" rx="16" fill="url(#ambientGlow)"/>

  <!-- Window Top Bar -->
  <circle cx="28" cy="28" r="5.5" fill="#ef4444" fill-opacity="0.8"/>
  <circle cx="46" cy="28" r="5.5" fill="#f59e0b" fill-opacity="0.8"/>
  <circle cx="64" cy="28" r="5.5" fill="#10b981" fill-opacity="0.8"/>
  <text x="86" y="33" fill="#f8fafc" font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="16" font-weight="700" letter-spacing="-0.02em">EvoKernel Workbench X-Ray</text>
  <text x="304" y="33" fill="#64748b" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">workspace: ${wsName}  ·  npx evo-kernel score</text>
  <rect x="786" y="15" width="124" height="26" rx="13" fill="rgba(16,185,129,0.12)" stroke="rgba(16,185,129,0.4)" stroke-width="1"/>
  <text x="848" y="32" text-anchor="middle" fill="#34d399" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11.5" font-weight="700">GRADE ${escSvg(report.grade)}</text>
  <line x1="0" y1="54" x2="940" y2="54" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

  <!-- Left Card: Context Health & Savings -->
  <rect x="24" y="72" width="408" height="334" rx="12" fill="url(#cardSurface)" stroke="rgba(255,255,255,0.08)"/>
  <text x="46" y="102" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="600" letter-spacing="0.05em">CONTEXT HEALTH &amp; PROMPT TAX SHIELDING</text>

  <!-- Circular Score Gauge -->
  <g transform="translate(92, 162)">
    <circle cx="0" cy="0" r="36" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="6.5"/>
    <circle class="score-gauge-ring" cx="0" cy="0" r="36" fill="none" stroke="${scoreColor}" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" transform="rotate(-90)"/>
    <text x="0" y="4" text-anchor="middle" fill="#ffffff" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" font-weight="800">${report.overallScore}/100</text>
  </g>

  <text x="152" y="148" fill="#34d399" font-family="Inter, -apple-system, sans-serif" font-size="30" font-weight="800" letter-spacing="-0.03em">Saved ${report.contextSavings.savingsPercent}%</text>
  <text x="152" y="170" fill="#e2e8f0" font-family="Inter, -apple-system, sans-serif" font-size="13" font-weight="600">${formatCompactTok(report.contextSavings.beforeTokens)} &#8594; ${formatCompactTok(report.contextSavings.afterTokens)} tok/turn</text>
  <text x="152" y="190" fill="#8b9bb4" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11.5">${report.contextSavings.savedTokens.toLocaleString()} tok/turn reclaimed</text>

  <line x1="46" y1="216" x2="410" y2="216" stroke="rgba(255,255,255,0.06)"/>
  <text x="46" y="242" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, monospace" font-size="12">Before (Eager Load): <tspan fill="#f59e0b" font-weight="700">${report.contextSavings.beforeTokens.toLocaleString()} tok/turn</tspan></text>
  <text x="46" y="266" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, monospace" font-size="12">After (Virtual L0) : <tspan fill="#34d399" font-weight="700">${report.contextSavings.afterTokens.toLocaleString()} tok/turn</tspan></text>

  <!-- Progress Bar -->
  <rect x="46" y="284" width="364" height="10" rx="5" fill="rgba(255,255,255,0.06)"/>
  <rect class="savings-bar-fill" x="46" y="284" width="${barWidth}" height="10" rx="5" fill="url(#barGrad)"/>

  <text x="46" y="320" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11.5">Cache Shield: <tspan fill="#38bdf8" font-weight="700">${report.cacheShieldingScore}%</tspan>   ·   Hotspot Guard: <tspan fill="#34d399" font-weight="700">${report.fragileCodeScore}%</tspan></text>
  <text x="46" y="343" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11.5">AST* Memories: <tspan fill="#f8fafc" font-weight="600">${report.capabilities.verifiedMemoriesCount}/${report.capabilities.memoriesCount} VERIFIED</tspan> · <tspan fill="#f8fafc">${report.capabilities.skillsCount} skills, ${report.capabilities.toolsCount} tools</tspan></text>
  <text x="46" y="368" fill="#64748b" font-family="JetBrains Mono, ui-monospace, monospace" font-size="8.2">* AST = zero-dep lexical-structural skeleton &amp; call-anchor fingerprinting</text>
  <text x="46" y="390" fill="#38bdf8" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11">github.com/damonless/EvoKernel · 0 Idle Core Token Cost</text>

  <!-- Right Card: Fragile Hotspots & AST Memory Coverage -->
  <rect x="446" y="72" width="470" height="334" rx="12" fill="url(#cardSurface)" stroke="rgba(255,255,255,0.08)"/>
  <text x="464" y="102" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="600" letter-spacing="0.05em">GIT FRAGILITY HOTSPOTS &amp; AST SYMBOL ANCHORS</text>
  <text x="464" y="136" fill="#ffffff" font-family="Inter, -apple-system, sans-serif" font-size="28" font-weight="800" letter-spacing="-0.03em">${report.totalHotspots - report.unprotectedHotspots} / ${report.totalHotspots} <tspan font-size="14" font-weight="600" fill="#34d399">${escSvg(hotspotPctLabel)}</tspan></text>
  <text x="464" y="160" fill="#8b9bb4" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11">${escSvg(memSubLabel)}</text>
  <line x1="464" y1="178" x2="900" y2="178" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
  <text x="474" y="202" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, monospace" font-size="10.5" font-weight="600" letter-spacing="0.04em">PRODUCTION HOTSPOT FILE</text>
  <text x="825" y="202" text-anchor="middle" fill="#94a3b8" font-family="JetBrains Mono, ui-monospace, monospace" font-size="10.5" font-weight="600" letter-spacing="0.04em">AST SHIELD STATUS</text>
  ${hotspotRows}
</svg>\n`;
}

export function renderScoreAnsi(
  report: ScoreReport,
  options?: { color?: boolean; ascii?: boolean; args?: string[] }
): string {
  const isAscii = options?.ascii ?? isAsciiMode(options?.args);
  const colorEnabled = !isAscii && (options?.color ?? isColorEnabled(options?.args));
  const noColor = !colorEnabled;
  const c = {
    reset: noColor ? '' : '\x1b[0m',
    bold: noColor ? '' : '\x1b[1m',
    dim: noColor ? '' : '\x1b[2m',
    green: noColor ? '' : '\x1b[32m',
    yellow: noColor ? '' : '\x1b[33m',
    blue: noColor ? '' : '\x1b[34m',
    magenta: noColor ? '' : '\x1b[35m',
    cyan: noColor ? '' : '\x1b[36m',
    red: noColor ? '' : '\x1b[31m',
  };

  const isAsciiBox = isAscii;
  const titleLine = isAsciiBox
    ? '║   EvoKernel Workbench -- Context Health & Fragility Score          ║'
    : '║   🧬  EvoKernel Workbench — Context Health & Fragility Score       ║';

  const lines: string[] = [];
  lines.push('');
  lines.push(
    `${c.bold}${c.cyan}╔════════════════════════════════════════════════════════════════════╗${c.reset}`
  );
  lines.push(
    `${c.bold}${c.cyan}${titleLine}${c.reset}`
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
  if (report.deductions && report.deductions.length > 0) {
    lines.push(
      `  Score Deductions   : ${c.yellow}${report.deductions.join(' · ')}${c.reset}`
    );
  }
  lines.push('');
  lines.push(`${c.bold}📊 Context & MCP Tax Virtualization${c.reset}`);
  lines.push(
    `  ├─ Eager Schema Tax: ${c.yellow}${report.contextSavings.beforeTokens.toLocaleString()} tokens${c.reset} (before EvoKernel)`
  );
  lines.push(
    `  ├─ Virtualized Load: ${c.green}${report.contextSavings.afterTokens.toLocaleString()} tokens${c.reset} (after EvoKernel)`
  );
  const arrowGlyph = isAscii ? '->' : '→';
  lines.push(
    `  ├─ Virtualized Gain: ${c.bold}${c.green}Saved ${report.contextSavings.savingsPercent}% · ${formatCompactTok(report.contextSavings.beforeTokens)} ${arrowGlyph} ${formatCompactTok(report.contextSavings.afterTokens)} tok${c.reset} (${report.contextSavings.savedTokens.toLocaleString()} tokens saved)`
  );
  lines.push(
    `  ├─ 100-Turn Waste  : ${c.yellow}\$${report.waste100TurnsUsd.sonnetUsd.toFixed(2)}${c.reset} (Sonnet) / ${c.red}\$${report.waste100TurnsUsd.opusUsd.toFixed(2)}${c.reset} (Opus)`
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
    const has7d = Boolean(report.window7d);
    const hasRecall = Boolean(report.recallTelemetry && report.recallTelemetry.totalHits > 0);
    lines.push(
      `  ${has7d || hasRecall ? '├─' : '└─'} Capabilities    : ${report.capabilities.rulesCount} rules (${report.capabilities.scopedRulesCount} scoped), ${report.capabilities.memoriesCount} memories (${report.capabilities.verifiedMemoriesCount} verified AST*)`
    );
    if (report.window7d) {
      const w = report.window7d;
      lines.push(
        `  ${hasRecall ? '├─' : '└─'} 7-Day Recall    : ${w.searchEvents} searches · ${w.adoptedCount} adopted · ${w.helpedCount} pitfalls avoided`
      );
    }
    if (report.recallTelemetry && report.recallTelemetry.totalHits > 0) {
      lines.push(
        `  └─ Recall Impact   : ${report.recallTelemetry.totalHits} recalls · ${report.recallTelemetry.helpedCount} verified pitfalls avoided (~${report.recallTelemetry.measuredTokensSaved.toLocaleString()} tok saved)`
      );
    }

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

  const cliCmd =
    process.argv[1] && /_npx|npx/i.test(process.argv[1])
      ? 'npx evo-kernel'
      : 'evo';

  let actionCmd = '';
  if (!report.hasEvo) {
    actionCmd = `${cliCmd} init --stealth && ${cliCmd} virtualize --dry-run`;
  } else if (report.mcpTax.activeServers > 0) {
    actionCmd = `${cliCmd} virtualize --dry-run`;
  } else if (report.capabilities.memoriesCount > report.capabilities.verifiedMemoriesCount) {
    actionCmd = `${cliCmd} memory verify`;
  } else if (report.unprotectedHotspots > 0 || report.capabilities.memoriesCount === 0) {
    actionCmd = `${cliCmd} bootstrap`;
  } else {
    actionCmd = `Context OS is healthy and shielded — run \`${cliCmd} doctor\` or \`${cliCmd} ui\` to inspect.`;
  }

  lines.push('');
  lines.push(
    `  ${c.bold}Action:${c.reset} ${c.cyan}${actionCmd}${c.reset}`
  );
  lines.push(
    `${c.dim}Run \`${cliCmd} ui\` to launch EvoKernel Workbench (X-Ray treemap & capability constellation).${c.reset}`
  );
  lines.push(
    `${c.dim}* AST = zero-dep lexical-structural skeleton & call-anchor fingerprinting${c.reset}`
  );
  lines.push('');
  return formatTerminalOutput(lines.join('\n'), { color: colorEnabled, ascii: isAscii });
}

export async function runScoreCli(workspaceRoot: string, args: string[]): Promise<void> {
  const isJson = args.includes('--json');
  const isBadge = args.includes('--badge');
  const isAnon = args.includes('--anon');
  const globalOnly = args.includes('--global') || args.includes('-g');
  const ascii = isAsciiMode(args);
  const color = isColorEnabled(args);

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

  const svgEqArg = args.find((a) => a.startsWith('--svg='));
  const svgIdx = args.indexOf('--svg');
  if (svgEqArg || svgIdx !== -1) {
    const svgContent = renderScoreSvg(report);
    const eqVal = svgEqArg ? svgEqArg.slice('--svg='.length).trim() : '';
    const nextArg = eqVal || (svgIdx !== -1 ? args[svgIdx + 1] : undefined);
    if (nextArg && !nextArg.startsWith('-')) {
      const outSvg = path.resolve(nextArg);
      fs.mkdirSync(path.dirname(outSvg), { recursive: true });
      fs.writeFileSync(outSvg, svgContent, 'utf8');
      console.log(
        formatTerminalOutput(`✅ Score SVG X-Ray card exported to: ${outSvg}`, { color, ascii })
      );
    } else {
      process.stdout.write(svgContent);
    }
    return;
  }

  const htmlEqArg = args.find((a) => a.startsWith('--html='));
  const htmlIdx = args.indexOf('--html');
  if (htmlEqArg || htmlIdx !== -1) {
    const eqVal = htmlEqArg ? htmlEqArg.slice('--html='.length).trim() : '';
    const candidatePath = eqVal || (htmlIdx !== -1 && args[htmlIdx + 1] && !args[htmlIdx + 1].startsWith('-') ? args[htmlIdx + 1] : undefined);
    const outPath = candidatePath
      ? path.resolve(candidatePath)
      : path.join(path.resolve(workspaceRoot), 'evo-score.html');
    const { exportUiHtml } = await import('./ui.js');
    exportUiHtml(workspaceRoot, outPath, { anon: isAnon });
    console.log(
      formatTerminalOutput(`✅ Score HTML report exported to: ${outPath}`, { color, ascii })
    );
    return;
  }

  console.log(renderScoreAnsi(report, { color, ascii, args }));
}
