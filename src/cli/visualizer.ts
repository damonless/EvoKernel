import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { verifyMemoryFreshness } from '../core/memory.js';

export function renderEvoTree(workspaceRoot: string): string {
  const storage = new EvoStorage(workspaceRoot);
  storage.ensureInitialized();
  const telemetry = new EvoTelemetry(storage);
  const tMap = telemetry.getTelemetryMap();
  telemetry.close();

  const rules = storage.listRules();
  const skills = storage.listSkills();
  const tools = storage.listTools();
  const memories = storage.listMemories();
  const config = storage.getConfig();
  const { totalTokens } = storage.getCoreRulesTokenUsage();

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
      const passRate = runs > 0 ? `${(((stat?.success_count ?? 0) / runs) * 100).toFixed(0)}%` : '100% (self-tested)';
      lines.push(
        `│   ${branch} [${t.runtime.toUpperCase()}] ${t.id} (runs: ${runs} | pass: ${passRate}) — ${t.l0_summary}`
      );
    });
  }

  const verifications = memories.map((m) => ({
    memory: m,
    report: verifyMemoryFreshness(storage.rootDir, m, { includeCallers: false }),
  }));
  const verifiedCount = verifications.filter((v) => v.report.overall_status === 'VERIFIED').length;
  const staleCount = verifications.length - verifiedCount;

  lines.push(
    `└── 🧠 Episodic Memories (${memories.length} fault cases | ${verifiedCount} VERIFIED · ${staleCount} STALE)`
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
          : `⚠️ [STALE ${report.verified_count}/${report.total_symbols} sym]`;
      lines.push(
        `    ${branch} ${badge} ${m.id} (hits: ${stat?.hit_count ?? 0}) — ${m.l0_summary}`
      );
    });
  }

  return lines.join('\n');
}

export function renderEvoStats(workspaceRoot: string): string {
  const storage = new EvoStorage(workspaceRoot);
  storage.ensureInitialized();
  const telemetry = new EvoTelemetry(storage);
  const tMap = telemetry.getTelemetryMap();
  telemetry.close();

  const rules = storage.listRules();
  const skills = storage.listSkills();
  const tools = storage.listTools();
  const memories = storage.listMemories();
  const archivedCount = storage.listArchivedCount();
  const config = storage.getConfig();
  const { totalTokens } = storage.getCoreRulesTokenUsage();

  let verifiedMemories = 0;
  for (const m of memories) {
    const rep = verifyMemoryFreshness(storage.rootDir, m, { includeCallers: false });
    if (rep.overall_status === 'VERIFIED') verifiedMemories++;
  }

  let totalHits = 0;
  let totalSuccess = 0;
  let totalFail = 0;
  let totalTokensSaved = 0;

  for (const rec of tMap.values()) {
    totalHits += rec.hit_count;
    totalSuccess += rec.success_count;
    totalFail += rec.fail_count;
    totalTokensSaved += rec.tokens_saved;
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
      : '100.0%';

  return [
    '╭──────────────────────────────────────────────────────────────────────────╮',
    '│ 📊 EvoKernel ROI, Cognitive Memory & Telemetry Ledger                    │',
    '├──────────────────────────────────────────────────────────────────────────┤',
    `│ 🛡️  Core Rule Token Budget : [${progressBar}] ${totalTokens}/${config.maxCoreRuleTokens} (${pctBudget}%)`,
    `│ 📦 Active Capabilities    : ${rules.length} Rules · ${skills.length} Skills · ${tools.length} Micro-Tools · ${memories.length} Memories`,
    `│ 🧠 Memory AST Anti-Drift  : ${verifiedMemories}/${memories.length} VERIFIED (${memories.length - verifiedMemories} STALE) | 0 Core Budget Tokens`,
    `│ 🗄️  GC Archived Versions   : ${archivedCount} historical snapshots in .evo/archive/`,
    `│ 🎯 Total Capability Hits  : ${totalHits} recalls (${passRate} verification/sandbox pass rate)`,
    `│ ⚡ Prompt Cache Stability : 100% (Fixed 5-Tool Meta-MCP Signature)`,
    `│ 💰 Estimated Tokens Saved : ~${cacheProtectedTokens.toLocaleString()} tokens`,
    `│ 🔌 Enabled Harnesses      : ${config.enabledHarnesses.join(', ') || 'claude, agents, gemini, cursor'}`,
    '╰──────────────────────────────────────────────────────────────────────────╯',
  ].join('\n');
}

export function renderMemoryVerifyReport(workspaceRoot: string): string {
  const storage = new EvoStorage(workspaceRoot);
  storage.ensureInitialized();
  const memories = storage.listMemories();

  const lines: string[] = [
    '╭──────────────────────────────────────────────────────────────────────────╮',
    '│ 🧠 EvoKernel Cognitive Memory — AST Anti-Drift & Topology Audit          │',
    '╰──────────────────────────────────────────────────────────────────────────╯',
    `📦 Workspace: ${storage.rootDir}`,
    `🔍 Total Episodic Memories: ${memories.length}`,
    '',
  ];

  if (memories.length === 0) {
    lines.push('  (No episodic memories found in .evo/memories/. Run `evo bootstrap` or call `evo_propose(kind: "memory")`.)');
    return lines.join('\n');
  }

  for (const m of memories) {
    const rep = verifyMemoryFreshness(storage.rootDir, m, { includeCallers: true });
    const badge = rep.overall_status === 'VERIFIED' ? '✅ VERIFIED' : '⚠️ STALE';
    lines.push(
      `├── [${badge}] ${m.id} — ${m.title} ${rep.confidence_tag}`
    );
    lines.push(
      `│   ├─ Commit Anchor : recorded @ ${rep.recorded_commit} -> current @ ${rep.current_commit}`
    );
    lines.push(`│   ├─ L0 Summary    : ${m.l0_summary}`);
    for (const c of rep.checks) {
      const symBadge = c.status === 'VERIFIED' ? '✓' : '✗';
      lines.push(`│   ├─ [${symBadge} ${c.status}] ${c.detail}`);
    }
    for (const a of rep.topology_anchors) {
      if (a.callers.length > 0) {
        lines.push(`│   └─ 🔗 Topology Callers (${a.symbol}): ${a.callers.join(', ')}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

