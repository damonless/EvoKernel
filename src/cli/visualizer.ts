import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_EVO_CONFIG, EvoStorage, hasValidEvoStructure } from '../core/storage.js';
import { verifyMemoryFreshness } from '../core/memory.js';
import { truncateTerminalLine } from './term.js';

interface ReadOnlyTelemetryStat {
  id: string;
  hit_count: number;
  success_count: number;
  fail_count: number;
  tokens_saved: number;
  helped_count: number;
  hurt_count: number;
  contested_count: number;
}

function loadReadOnlyTelemetryMap(telemetryDbPath: string): Map<string, ReadOnlyTelemetryStat> {
  const map = new Map<string, ReadOnlyTelemetryStat>();
  if (!fs.existsSync(telemetryDbPath)) return map;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(telemetryDbPath, { readOnly: true });
    const rows = db
      .prepare(
        'SELECT id, hit_count, success_count, fail_count, tokens_saved, helped_count, hurt_count, contested_count FROM telemetry'
      )
      .all() as Array<Record<string, unknown>>;
    for (const r of rows) {
      map.set(String(r.id), {
        id: String(r.id),
        hit_count: Number(r.hit_count || 0),
        success_count: Number(r.success_count || 0),
        fail_count: Number(r.fail_count || 0),
        tokens_saved: Number(r.tokens_saved || 0),
        helped_count: Number(r.helped_count || 0),
        hurt_count: Number(r.hurt_count || 0),
        contested_count: Number(r.contested_count || 0),
      });
    }
  } catch {
    // Ignore read errors from uninitialized or locked telemetry DB
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
  return map;
}

function probeWorkspaceHarnesses(workspaceRoot: string): string[] {
  const detected: string[] = [];
  if (
    fs.existsSync(path.join(workspaceRoot, 'CLAUDE.md')) ||
    fs.existsSync(path.join(workspaceRoot, '.mcp.json'))
  ) {
    detected.push('claude');
  }
  if (fs.existsSync(path.join(workspaceRoot, 'AGENTS.md'))) {
    detected.push('agents');
  }
  if (fs.existsSync(path.join(workspaceRoot, 'GEMINI.md'))) {
    detected.push('gemini');
  }
  if (
    fs.existsSync(path.join(workspaceRoot, '.cursor', 'rules', 'evo-kernel.mdc')) ||
    fs.existsSync(path.join(workspaceRoot, '.cursor', 'mcp.json'))
  ) {
    detected.push('cursor');
  }
  if (fs.existsSync(path.join(workspaceRoot, '.codex', 'config.toml'))) {
    detected.push('codex');
  }
  if (fs.existsSync(path.join(workspaceRoot, '.windsurfrules'))) {
    detected.push('windsurf');
  }
  if (fs.existsSync(path.join(workspaceRoot, '.clinerules'))) {
    detected.push('cline');
  }
  if (fs.existsSync(path.join(workspaceRoot, '.roo', 'rules', 'evo-kernel.md'))) {
    detected.push('roo');
  }
  if (fs.existsSync(path.join(workspaceRoot, '.github', 'copilot-instructions.md'))) {
    detected.push('copilot');
  }
  if (fs.existsSync(path.join(workspaceRoot, 'opencode.json'))) {
    detected.push('opencode');
  }
  return detected;
}

export function renderEvoTree(
  workspaceRoot: string,
  options?: { full?: boolean; maxCols?: number }
): string {
  const storage = new EvoStorage(workspaceRoot);
  const hasEvo = hasValidEvoStructure(storage.evoDir);
  const tMap = hasEvo ? loadReadOnlyTelemetryMap(storage.telemetryDbPath) : new Map();

  const rules = hasEvo ? storage.listRules() : [];
  const skills = hasEvo ? storage.listSkills() : [];
  const tools = hasEvo ? storage.listTools() : [];
  const memories = hasEvo ? storage.listMemories() : [];
  const config = hasEvo ? storage.getConfig() : { ...DEFAULT_EVO_CONFIG };
  const { totalTokens } = hasEvo ? storage.getCoreRulesTokenUsage() : { totalTokens: 0 };

  const lines: string[] = [
    '╭──────────────────────────────────────────────────────────────────────────╮',
    '│ 🧬 EvoKernel — Self-Evolving Capability & Cognitive Memory Tree (.evo/)  │',
    '╰──────────────────────────────────────────────────────────────────────────╯',
    `📦 Workspace: ${storage.rootDir}`,
    `├── 🛡️  Rules (${rules.length} active | Core Token Budget: ${totalTokens}/${config.maxCoreRuleTokens} tokens)`,
  ];

  if (rules.length === 0) {
    lines.push('│   └── (empty — run `evo bootstrap` or let your agent call `evo_propose`)');
  } else {
    rules.forEach((r, idx) => {
      const isLast = idx === rules.length - 1;
      const branch = isLast ? '└──' : '├──';
      const stat = tMap.get(r.id);
      const badge = r.core ? '[CORE]' : '[SCOPED]';
      lines.push(
        `│   ${branch} ${badge} ${r.id} (${r.tokens} tok | hits: ${stat?.hit_count ?? 0}) — ${r.l0_summary}`
      );
    });
  }

  lines.push(`├── ⚡ Skills (${skills.length} verified L0/L1/L2 playbooks)`);
  if (skills.length === 0) {
    lines.push('│   └── (empty)');
  } else {
    skills.forEach((s, idx) => {
      const isLast = idx === skills.length - 1;
      const branch = isLast ? '└──' : '├──';
      const stat = tMap.get(s.id);
      lines.push(
        `│   ${branch} [SOP] ${s.id} (hits: ${stat?.hit_count ?? 0} | tags: ${s.tags.join(',') || 'general'}) — ${s.l0_summary}`
      );
    });
  }

  lines.push(`├── 🔧 Micro-Tools (${tools.length} sandboxed scripts | Fixed Meta-MCP Routed)`);
  if (tools.length === 0) {
    lines.push('│   └── (empty)');
  } else {
    tools.forEach((t, idx) => {
      const isLast = idx === tools.length - 1;
      const branch = isLast ? '└──' : '├──';
      const stat = tMap.get(t.id);
      const runs = (stat?.success_count ?? 0) + (stat?.fail_count ?? 0);
      const passRate =
        runs > 0
          ? `${(((stat?.success_count ?? 0) / runs) * 100).toFixed(0)}%`
          : '— (self-tested)';
      lines.push(
        `│   ${branch} [${t.runtime.toUpperCase()}] ${t.id} (runs: ${runs} | pass: ${passRate}) — ${t.l0_summary}`
      );
    });
  }

  const cacheDbPath = path.join(storage.rootDir, '.evo', '.cache', 'telemetry.db');
  let treeCacheDb: DatabaseSync | undefined;
  if (hasEvo && fs.existsSync(cacheDbPath)) {
    try {
      treeCacheDb = new DatabaseSync(cacheDbPath, { readOnly: true });
    } catch {}
  }
  let verifications: Array<{ memory: any; report: any }> = [];
  try {
    verifications = memories.map((m) => ({
      memory: m,
      report: verifyMemoryFreshness(storage.rootDir, m, {
        includeCallers: false,
        cacheDb: treeCacheDb,
      }),
    }));
  } finally {
    if (treeCacheDb) {
      try {
        treeCacheDb.close();
      } catch {}
    }
  }
  const verifiedCount = verifications.filter((v) => v.report.overall_status === 'VERIFIED').length;
  const branchCount = verifications.filter((v) => v.report.overall_status === 'OTHER_BRANCH').length;
  const staleCount = verifications.length - verifiedCount - branchCount;

  lines.push(
    `└── 🧠 Episodic Memories (${memories.length} fault cases | ${verifiedCount} VERIFIED · ${branchCount > 0 ? `${branchCount} OTHER_BRANCH · ` : ''}${staleCount} STALE)`
  );
  if (memories.length === 0) {
    lines.push('    └── (empty — propose with `kind: "memory"` or run `evo bootstrap`)');
  } else {
    verifications.forEach(({ memory: m, report }, idx) => {
      const isLast = idx === verifications.length - 1;
      const branch = isLast ? '└──' : '├──';
      const stat = tMap.get(m.id);
      const badge =
        report.overall_status === 'VERIFIED'
          ? `✅ [VERIFIED ${report.verified_count}/${report.total_symbols} sym @ ${m.created_commit}]`
          : report.overall_status === 'OTHER_BRANCH'
            ? `🌿 [BRANCH:${report.recorded_branch || m.created_branch || 'other'}@${m.created_commit} (${report.verified_count}/${report.total_symbols} in HEAD)]`
            : `⚠️ [STALE ${report.verified_count}/${report.total_symbols} sym]`;
      lines.push(
        `    ${branch} ${badge} ${m.id} (hits: ${stat?.hit_count ?? 0}) — ${m.l0_summary}`
      );
    });
  }

  return lines
    .map((line) => truncateTerminalLine(line, options?.maxCols, options?.full))
    .join('\n');
}

export function renderEvoStats(workspaceRoot: string): string {
  const storage = new EvoStorage(workspaceRoot);
  const hasEvo = hasValidEvoStructure(storage.evoDir);
  const tMap = hasEvo ? loadReadOnlyTelemetryMap(storage.telemetryDbPath) : new Map();

  const rules = hasEvo ? storage.listRules() : [];
  const skills = hasEvo ? storage.listSkills() : [];
  const tools = hasEvo ? storage.listTools() : [];
  const memories = hasEvo ? storage.listMemories() : [];
  const archivedCount = hasEvo ? storage.listArchivedCount() : 0;
  const config = hasEvo ? storage.getConfig() : { ...DEFAULT_EVO_CONFIG };
  const { totalTokens } = hasEvo ? storage.getCoreRulesTokenUsage() : { totalTokens: 0 };

  let verifiedMemories = 0;
  let branchMemories = 0;
  const statsCacheDbPath = path.join(storage.rootDir, '.evo', '.cache', 'telemetry.db');
  let statsCacheDb: DatabaseSync | undefined;
  if (hasEvo && fs.existsSync(statsCacheDbPath)) {
    try {
      statsCacheDb = new DatabaseSync(statsCacheDbPath, { readOnly: true });
    } catch {}
  }
  try {
    for (const m of memories) {
      const rep = verifyMemoryFreshness(storage.rootDir, m, {
        includeCallers: false,
        cacheDb: statsCacheDb,
      });
      if (rep.overall_status === 'VERIFIED') verifiedMemories++;
      else if (rep.overall_status === 'OTHER_BRANCH') branchMemories++;
    }
  } finally {
    if (statsCacheDb) {
      try {
        statsCacheDb.close();
      } catch {}
    }
  }
  const staleMemories = memories.length - verifiedMemories - branchMemories;

  let totalHits = 0;
  let totalSuccess = 0;
  let totalFail = 0;
  let totalTokensSaved = 0;
  let totalHelped = 0;

  for (const rec of tMap.values()) {
    totalHits += rec.hit_count;
    totalSuccess += rec.success_count;
    totalFail += rec.fail_count;
    totalTokensSaved += rec.tokens_saved;
    totalHelped += rec.helped_count;
  }

  // Prompt cache preservation savings estimate:
  // Exposing N dynamic tools directly would bust prompt cache on every tool change (~4,500 tokens per turn).
  const cacheProtectedTokens = tools.length * 1200 + memories.length * 650 + totalTokensSaved;
  const pctBudget = Math.min(100, Math.round((totalTokens / config.maxCoreRuleTokens) * 100));
  const filledBars = Math.round((pctBudget / 100) * 20);
  const progressBar = '█'.repeat(filledBars) + '░'.repeat(Math.max(0, 20 - filledBars));

  const passRate =
    totalSuccess + totalFail > 0
      ? `${((totalSuccess / (totalSuccess + totalFail)) * 100).toFixed(1)}%`
      : '— (0 runs)';

  const hasMcpConfig =
    fs.existsSync(path.join(workspaceRoot, '.mcp.json')) ||
    fs.existsSync(path.join(workspaceRoot, '.cursor', 'mcp.json')) ||
    fs.existsSync(path.join(workspaceRoot, '.vscode', 'mcp.json'));

  const promptCacheStability =
    hasEvo || hasMcpConfig
      ? '100% (Fixed 5-Tool Meta-MCP Signature)'
      : '— (not initialized)';

  let enabledHarnessesStr = 'none (run evo init)';
  if (config.enabledHarnesses && config.enabledHarnesses.length > 0) {
    enabledHarnessesStr = config.enabledHarnesses.join(', ');
  } else {
    const probed = probeWorkspaceHarnesses(workspaceRoot);
    if (probed.length > 0) {
      enabledHarnessesStr = probed.join(', ');
    }
  }

  return [
    '╭──────────────────────────────────────────────────────────────────────────╮',
    '│ 📊 EvoKernel ROI, Cognitive Memory & Telemetry Ledger                    │',
    '├──────────────────────────────────────────────────────────────────────────┤',
    `│ 🛡️  Core Rule Token Budget : [${progressBar}] ${totalTokens}/${config.maxCoreRuleTokens} (${pctBudget}%)`,
    `│ 📦 Active Capabilities    : ${rules.length} Rules · ${skills.length} Skills · ${tools.length} Micro-Tools · ${memories.length} Memories`,
    `│ 🧠 Memory AST Anti-Drift  : ${verifiedMemories}/${memories.length} VERIFIED${branchMemories > 0 ? ` · ${branchMemories} OTHER_BRANCH` : ''} (${staleMemories} STALE) | 0 Core Budget Tokens`,
    `│ 🗄️  GC Archived Versions   : ${archivedCount} historical snapshots in .evo/archive/`,
    `│ 🎯 Total Capability Hits  : ${totalHits} recalls (${passRate} verification/sandbox pass rate)`,
    `│ 🛡️  Observable Recall Value: ${totalHits} recalls -> ${totalHelped} verified pitfall(s) avoided (local telemetry)`,
    `│ ⚡ Prompt Cache Stability : ${promptCacheStability}`,
    `│ 💰 Estimated Tokens Saved : ~${cacheProtectedTokens.toLocaleString()} tokens (measured recalls: ${totalTokensSaved.toLocaleString()} tok · est. schema shield: ${(tools.length * 1200 + memories.length * 650).toLocaleString()} tok)`,
    `│ 🔌 Enabled Harnesses      : ${enabledHarnessesStr}`,
    '╰──────────────────────────────────────────────────────────────────────────╯',
  ].join('\n');
}

export function renderMemoryVerifyReport(workspaceRoot: string): string {
  const storage = new EvoStorage(workspaceRoot);
  const hasEvo = hasValidEvoStructure(storage.evoDir);
  const memories = hasEvo ? storage.listMemories() : [];

  const lines: string[] = [
    '╭──────────────────────────────────────────────────────────────────────────╮',
    '│ 🧠 EvoKernel Cognitive Memory — AST Anti-Drift & Topology Audit          │',
    '╰──────────────────────────────────────────────────────────────────────────╯',
    `📦 Workspace: ${storage.rootDir}`,
    `🔍 Total Episodic Memories: ${memories.length}`,
    '',
  ];

  if (memories.length === 0) {
    lines.push(
      '  (No episodic memories found in .evo/memories/. Run `evo bootstrap` or call `evo_propose(kind: "memory")`.)'
    );
    return lines.join('\n');
  }

  const reportCacheDbPath = path.join(storage.rootDir, '.evo', '.cache', 'telemetry.db');
  let reportCacheDb: DatabaseSync | undefined;
  if (hasEvo && fs.existsSync(reportCacheDbPath)) {
    try {
      reportCacheDb = new DatabaseSync(reportCacheDbPath, { readOnly: true });
    } catch {}
  }
  try {
    for (const m of memories) {
      const rep = verifyMemoryFreshness(storage.rootDir, m, {
        includeCallers: true,
        cacheDb: reportCacheDb,
      });
      const badge =
        rep.overall_status === 'VERIFIED'
          ? '✅ VERIFIED'
          : rep.overall_status === 'OTHER_BRANCH'
            ? `🌿 OTHER_BRANCH (${rep.recorded_branch || m.created_branch || 'other'})`
            : '⚠️ STALE';
      lines.push(`├── [${badge}] ${m.id} — ${m.title} ${rep.confidence_tag}`);
      lines.push(
        `│   ├─ Commit Anchor : recorded @ ${rep.recorded_commit} -> current @ ${rep.current_commit}`
      );
      lines.push(`│   ├─ L0 Summary    : ${m.l0_summary}`);
      for (const c of rep.checks) {
        const symBadge = c.status === 'VERIFIED' ? '✓' : c.status === 'OTHER_BRANCH' ? '🌿' : '✗';
        lines.push(`│   ├─ [${symBadge} ${c.status}] ${c.detail}`);
      }
      for (const a of rep.topology_anchors) {
        if (a.callers.length > 0) {
          lines.push(`│   └─ 🔗 Topology Callers (${a.symbol}): ${a.callers.join(', ')}`);
        }
      }
      lines.push('');
    }
  } finally {
    if (reportCacheDb) {
      try {
        reportCacheDb.close();
      } catch {}
    }
  }

  return lines.join('\n');
}

export function buildEvoTreeJson(workspaceRoot: string): object {
  const storage = new EvoStorage(workspaceRoot);
  const hasEvo = hasValidEvoStructure(storage.evoDir);
  const tMap = hasEvo ? loadReadOnlyTelemetryMap(storage.telemetryDbPath) : new Map();

  const rules = hasEvo ? storage.listRules() : [];
  const skills = hasEvo ? storage.listSkills() : [];
  const tools = hasEvo ? storage.listTools() : [];
  const memories = hasEvo ? storage.listMemories() : [];
  const config = hasEvo ? storage.getConfig() : { ...DEFAULT_EVO_CONFIG };
  const { totalTokens } = hasEvo ? storage.getCoreRulesTokenUsage() : { totalTokens: 0 };

  const cacheDbPath = path.join(storage.rootDir, '.evo', '.cache', 'telemetry.db');
  let treeCacheDb: DatabaseSync | undefined;
  if (hasEvo && fs.existsSync(cacheDbPath)) {
    try {
      treeCacheDb = new DatabaseSync(cacheDbPath, { readOnly: true });
    } catch {}
  }

  let verifications: Array<{ memory: any; report: any }> = [];
  try {
    verifications = memories.map((m) => ({
      memory: m,
      report: verifyMemoryFreshness(storage.rootDir, m, {
        includeCallers: false,
        cacheDb: treeCacheDb,
      }),
    }));
  } finally {
    if (treeCacheDb) {
      try {
        treeCacheDb.close();
      } catch {}
    }
  }

  const verifiedCount = verifications.filter((v) => v.report.overall_status === 'VERIFIED').length;
  const branchCount = verifications.filter((v) => v.report.overall_status === 'OTHER_BRANCH').length;
  const staleCount = verifications.length - verifiedCount - branchCount;

  return {
    workspace: storage.rootDir,
    hasEvo,
    rules: rules.map((r) => {
      const stat = tMap.get(r.id);
      return {
        id: r.id,
        core: r.core,
        tokens: r.tokens,
        hits: stat?.hit_count ?? 0,
        l0_summary: r.l0_summary,
      };
    }),
    skills: skills.map((s) => {
      const stat = tMap.get(s.id);
      return {
        id: s.id,
        hits: stat?.hit_count ?? 0,
        tags: s.tags,
        l0_summary: s.l0_summary,
      };
    }),
    tools: tools.map((t) => {
      const stat = tMap.get(t.id);
      const runs = (stat?.success_count ?? 0) + (stat?.fail_count ?? 0);
      return {
        id: t.id,
        runtime: t.runtime,
        runs,
        successCount: stat?.success_count ?? 0,
        failCount: stat?.fail_count ?? 0,
        passRate: runs > 0 ? ((stat?.success_count ?? 0) / runs) * 100 : null,
        l0_summary: t.l0_summary,
      };
    }),
    memories: verifications.map(({ memory: m, report }) => {
      const stat = tMap.get(m.id);
      return {
        id: m.id,
        status: report.overall_status,
        verifiedCount: report.verified_count,
        totalSymbols: report.total_symbols,
        createdCommit: m.created_commit,
        createdBranch: m.created_branch,
        hits: stat?.hit_count ?? 0,
        l0_summary: m.l0_summary,
      };
    }),
    summary: {
      rulesCount: rules.length,
      skillsCount: skills.length,
      toolsCount: tools.length,
      memoriesCount: memories.length,
      verifiedMemories: verifiedCount,
      otherBranchMemories: branchCount,
      staleMemories: staleCount,
      coreRuleTokens: totalTokens,
      maxCoreRuleTokens: config.maxCoreRuleTokens,
    },
  };
}

export function buildEvoStatsJson(workspaceRoot: string): object {
  const storage = new EvoStorage(workspaceRoot);
  const hasEvo = hasValidEvoStructure(storage.evoDir);
  const tMap = hasEvo ? loadReadOnlyTelemetryMap(storage.telemetryDbPath) : new Map();

  const rules = hasEvo ? storage.listRules() : [];
  const skills = hasEvo ? storage.listSkills() : [];
  const tools = hasEvo ? storage.listTools() : [];
  const memories = hasEvo ? storage.listMemories() : [];
  const archivedCount = hasEvo ? storage.listArchivedCount() : 0;
  const config = hasEvo ? storage.getConfig() : { ...DEFAULT_EVO_CONFIG };
  const { totalTokens } = hasEvo ? storage.getCoreRulesTokenUsage() : { totalTokens: 0 };

  let verifiedMemories = 0;
  let branchMemories = 0;
  const statsCacheDbPath = path.join(storage.rootDir, '.evo', '.cache', 'telemetry.db');
  let statsCacheDb: DatabaseSync | undefined;
  if (hasEvo && fs.existsSync(statsCacheDbPath)) {
    try {
      statsCacheDb = new DatabaseSync(statsCacheDbPath, { readOnly: true });
    } catch {}
  }
  try {
    for (const m of memories) {
      const rep = verifyMemoryFreshness(storage.rootDir, m, {
        includeCallers: false,
        cacheDb: statsCacheDb,
      });
      if (rep.overall_status === 'VERIFIED') verifiedMemories++;
      else if (rep.overall_status === 'OTHER_BRANCH') branchMemories++;
    }
  } finally {
    if (statsCacheDb) {
      try {
        statsCacheDb.close();
      } catch {}
    }
  }
  const staleMemories = memories.length - verifiedMemories - branchMemories;

  let totalHits = 0;
  let totalSuccess = 0;
  let totalFail = 0;
  let totalTokensSaved = 0;
  let totalHelped = 0;

  for (const rec of tMap.values()) {
    totalHits += rec.hit_count;
    totalSuccess += rec.success_count;
    totalFail += rec.fail_count;
    totalTokensSaved += rec.tokens_saved;
    totalHelped += rec.helped_count;
  }

  const cacheProtectedTokens = tools.length * 1200 + memories.length * 650 + totalTokensSaved;
  const pctBudget = Math.min(100, Math.round((totalTokens / config.maxCoreRuleTokens) * 100));

  const hasMcpConfig =
    fs.existsSync(path.join(workspaceRoot, '.mcp.json')) ||
    fs.existsSync(path.join(workspaceRoot, '.cursor', 'mcp.json')) ||
    fs.existsSync(path.join(workspaceRoot, '.vscode', 'mcp.json'));

  let enabledHarnessesStr = 'none (run evo init)';
  if (config.enabledHarnesses && config.enabledHarnesses.length > 0) {
    enabledHarnessesStr = config.enabledHarnesses.join(', ');
  } else {
    const probed = probeWorkspaceHarnesses(workspaceRoot);
    if (probed.length > 0) {
      enabledHarnessesStr = probed.join(', ');
    }
  }

  return {
    workspace: storage.rootDir,
    hasEvo,
    budget: {
      coreRuleTokens: totalTokens,
      maxCoreRuleTokens: config.maxCoreRuleTokens,
      pctBudget,
    },
    capabilities: {
      rules: rules.length,
      skills: skills.length,
      tools: tools.length,
      memories: memories.length,
      archivedSnapshots: archivedCount,
    },
    memoryFreshness: {
      total: memories.length,
      verified: verifiedMemories,
      otherBranch: branchMemories,
      stale: staleMemories,
    },
    telemetry: {
      totalHits,
      totalSuccess,
      totalFail,
      passRate: totalSuccess + totalFail > 0 ? (totalSuccess / (totalSuccess + totalFail)) * 100 : null,
      helpedCount: totalHelped,
      recordedTokensSaved: totalTokensSaved,
      estimatedTokensSaved: cacheProtectedTokens,
    },
    harnesses: {
      enabled: enabledHarnessesStr,
      mcpConfigured: hasMcpConfig,
    },
  };
}
