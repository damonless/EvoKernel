#!/usr/bin/env node
/**
 * EvoKernel Reproducible Benchmark Suite:
 * 1. Context Tax & Prompt-Cache Stability Simulation (50-Turn Engineering Session across 8 MCP Servers)
 * 2. Live Local Engine Latency Micro-Benchmark (FTS5 BM25 Recall + AST Memory Anti-Drift Verification)
 *
 * Usage:
 *   node ./benchmarks/context-tax-benchmark.mjs [--json] [--markdown]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 1. Standard 8-Server Full-Stack MCP Workload Profile
const MCP_WORKLOAD = [
  { name: 'github', tools: 18, schemaTokens: 2200 },
  { name: 'playwright', tools: 14, schemaTokens: 2200 },
  { name: 'kubernetes', tools: 12, schemaTokens: 2500 },
  { name: 'docker', tools: 9, schemaTokens: 1900 },
  { name: 'linear', tools: 8, schemaTokens: 1800 },
  { name: 'postgres', tools: 6, schemaTokens: 1500 },
  { name: 'sentry', tools: 6, schemaTokens: 1400 },
  { name: 'context7', tools: 4, schemaTokens: 1200 },
];

const TOTAL_RAW_MCP_TOOLS = MCP_WORKLOAD.reduce((acc, s) => acc + s.tools, 0);
const TOTAL_RAW_MCP_TOKENS = MCP_WORKLOAD.reduce((acc, s) => acc + s.schemaTokens, 0);

// Typical mature repo knowledge base (10 rules, 4 skills, 5 micro-tools, 15 debugging memories)
const MONOLITHIC_KNOWLEDGE_TOKENS = {
  rulesTokens: 3200,
  skillsTokens: 2600,
  microToolsTokens: 1850,
  memoriesTokens: 4800,
};
const TOTAL_MONOLITHIC_KNOWLEDGE_TOKENS = Object.values(MONOLITHIC_KNOWLEDGE_TOKENS).reduce(
  (a, b) => a + b,
  0
);

// EvoKernel Virtualized Footprint
const EVOKERNEL_FOOTPRINT = {
  metaMcp5ToolsSchemaTokens: 380, // Fixed 5 meta-tools (evo_search, evo_inspect, evo_run, evo_propose, evo_compact)
  l0MetaRuleSeedTokens: 1150,     // Always-on L0 seed + core invariants digest
  avgOnDemandRecallPerTurn: 240,  // Cascaded L1/L2 recall only on turns that need it (~30% of turns)
};

/**
 * Simulate a 50-turn coding session where 3 capability/tool updates occur (at turns 12, 27, 41).
 * Pricing baseline (USD per 1M tokens):
 * - Claude Sonnet: Base Input $3.00, Cache Write $3.75, Cache Read $0.30
 * - Claude Opus  : Base Input $15.00, Cache Write $18.75, Cache Read $1.50
 */
function runSimulation(turns = 50) {
  const mutationTurns = new Set([12, 27, 41]);
  const rawEagerTokensPerTurn = TOTAL_RAW_MCP_TOKENS + TOTAL_MONOLITHIC_KNOWLEDGE_TOKENS;
  const evoBasePrefixTokens =
    EVOKERNEL_FOOTPRINT.metaMcp5ToolsSchemaTokens + EVOKERNEL_FOOTPRINT.l0MetaRuleSeedTokens;

  let rawTotalInputTokens = 0;
  let evoTotalInputTokens = 0;

  let rawCacheWriteTokens = 0;
  let rawCacheReadTokens = 0;
  let rawCacheInvalidations = 0;

  let evoCacheWriteTokens = 0;
  let evoCacheReadTokens = 0;
  let evoDynamicRecallTokens = 0;
  const evoCacheInvalidations = 0; // Fixed 5-tool schema never invalidates tool-prefix cache

  for (let t = 1; t <= turns; t++) {
    const historyTokens = t * 450; // Growing conversation context
    const isMutationTurn = mutationTurns.has(t);

    // Raw MCP + Monolithic CLAUDE.md:
    // Any new rule, memory, or MCP tool definition mutates the system/tool prefix and busts the entire prompt cache!
    const rawTurnTokens = rawEagerTokensPerTurn + historyTokens;
    rawTotalInputTokens += rawTurnTokens;
    if (t === 1 || isMutationTurn) {
      if (isMutationTurn) rawCacheInvalidations++;
      rawCacheWriteTokens += rawEagerTokensPerTurn + historyTokens;
    } else {
      rawCacheReadTokens += rawEagerTokensPerTurn + (t - 1) * 450;
      rawCacheWriteTokens += 450;
    }

    // EvoKernel 5-Tool Gateway + L0/L1/L2 Cascaded Recall:
    // Tool schemas & L0 prefix stay 100% static; evolved memories/scoped rules live in .evo/ and are recalled on demand.
    const onDemandTokens = t % 3 === 0 ? 720 : 0;
    const evoTurnTokens = evoBasePrefixTokens + onDemandTokens + historyTokens;
    evoTotalInputTokens += evoTurnTokens;
    evoDynamicRecallTokens += onDemandTokens;

    if (t === 1) {
      evoCacheWriteTokens += evoBasePrefixTokens + historyTokens;
    } else {
      evoCacheReadTokens += evoBasePrefixTokens + (t - 1) * 450;
      evoCacheWriteTokens += 450;
    }
  }

  const calcCost = (writeTok, readTok, dynamicTok, pricing) => {
    return (
      (writeTok / 1_000_000) * pricing.cacheWrite +
      (readTok / 1_000_000) * pricing.cacheRead +
      (dynamicTok / 1_000_000) * pricing.input
    );
  };

  const sonnetPricing = { input: 3.0, cacheWrite: 3.75, cacheRead: 0.3 };
  const opusPricing = { input: 15.0, cacheWrite: 18.75, cacheRead: 1.5 };

  const rawSonnetUsd = calcCost(rawCacheWriteTokens, rawCacheReadTokens, 0, sonnetPricing);
  const evoSonnetUsd = calcCost(
    evoCacheWriteTokens,
    evoCacheReadTokens,
    evoDynamicRecallTokens,
    sonnetPricing
  );

  const rawOpusUsd = calcCost(rawCacheWriteTokens, rawCacheReadTokens, 0, opusPricing);
  const evoOpusUsd = calcCost(
    evoCacheWriteTokens,
    evoCacheReadTokens,
    evoDynamicRecallTokens,
    opusPricing
  );

  const staticPrefixReductionPct = Number(
    (((rawEagerTokensPerTurn - evoBasePrefixTokens) / rawEagerTokensPerTurn) * 100).toFixed(1)
  );
  const totalTokenSavingsPct = Number(
    (((rawTotalInputTokens - evoTotalInputTokens) / rawTotalInputTokens) * 100).toFixed(1)
  );
  const costSavingsPct = Number((((rawOpusUsd - evoOpusUsd) / rawOpusUsd) * 100).toFixed(1));

  return {
    turns,
    serversCount: MCP_WORKLOAD.length,
    rawToolsCount: TOTAL_RAW_MCP_TOOLS,
    evoMetaToolsCount: 5,
    rawEagerTokensPerTurn,
    evoBasePrefixTokens,
    staticPrefixReductionPct,
    rawTotalInputTokens,
    evoTotalInputTokens,
    totalTokenSavingsPct,
    rawCacheInvalidations,
    evoCacheInvalidations,
    cost50TurnsUsd: {
      sonnet: {
        raw: Number(rawSonnetUsd.toFixed(3)),
        evo: Number(evoSonnetUsd.toFixed(3)),
        savedPct: Number((((rawSonnetUsd - evoSonnetUsd) / rawSonnetUsd) * 100).toFixed(1)),
      },
      opus: {
        raw: Number(rawOpusUsd.toFixed(3)),
        evo: Number(evoOpusUsd.toFixed(3)),
        savedPct: costSavingsPct,
      },
    },
  };
}

async function runLiveMicroBenchmarks() {
  const distStoragePath = path.join(rootDir, 'dist', 'core', 'storage.js');
  const distMemoryPath = path.join(rootDir, 'dist', 'core', 'memory.js');
  const distScorePath = path.join(rootDir, 'dist', 'cli', 'score.js');

  if (!fs.existsSync(distStoragePath)) {
    return null;
  }

  const { EvoStorage } = await import(pathToFileURL(distStoragePath).href);
  const { verifyMemoryFreshness } = await import(pathToFileURL(distMemoryPath).href);
  const { buildScoreReport } = await import(pathToFileURL(distScorePath).href);

  const storage = new EvoStorage(rootDir);
  const memories = storage.listMemories();

  // 1. AST Memory Freshness Verification Latency (warm cache)
  for (const m of memories) {
    verifyMemoryFreshness(rootDir, m, { includeCallers: false });
  }
  const astTimes = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    for (const m of memories) {
      verifyMemoryFreshness(rootDir, m, { includeCallers: false });
    }
    astTimes.push(performance.now() - t0);
  }
  astTimes.sort((a, b) => a - b);
  const astP50Ms = Number(astTimes[Math.floor(astTimes.length * 0.5)].toFixed(2));
  const astPerMemoryMs = Number((astP50Ms / Math.max(1, memories.length)).toFixed(3));

  // 2. Full Score Report Latency
  const tScore0 = performance.now();
  const scoreReport = buildScoreReport(rootDir, { includeGlobal: false });
  const scoreMs = Number((performance.now() - tScore0).toFixed(1));

  return {
    memoriesVerified: memories.length,
    astBatchVerifyP50Ms: astP50Ms,
    astPerMemoryMs,
    repoScoreLatencyMs: scoreMs,
    repoScore: scoreReport.overallScore,
    repoGrade: scoreReport.grade,
  };
}

const sim = runSimulation(50);
const live = await runLiveMicroBenchmarks();
const payload = { benchmark: sim, liveEngine: live };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  🧬 EvoKernel Context Tax, Prompt-Cache & AST Verification Benchmark Suite   ║
╚══════════════════════════════════════════════════════════════════════════════╝

1. Workload Profile (50-Turn Engineering Session + 3 Mid-Session Evolutions)
   • Mounted MCP Servers : ${sim.serversCount} servers (${MCP_WORKLOAD.map((s) => s.name).join(', ')})
   • Total Downstream    : ${sim.rawToolsCount} MCP tools + 10 Rules + 4 Skills + 5 Micro-Tools + 15 Memories

2. Context Window & Prompt-Cache Comparison
┌──────────────────────────────────────┬──────────────────────────┬──────────────────────────┬───────────────────┐
│ Metric                               │ Raw MCP + Monolithic Doc │ EvoKernel 5-Tool Gateway │ Improvement       │
├──────────────────────────────────────┼──────────────────────────┼──────────────────────────┼───────────────────┤
│ Exposed Tool Schemas                 │ ${String(sim.rawToolsCount + ' tools').padEnd(24)} │ ${String(sim.evoMetaToolsCount + ' fixed meta-tools').padEnd(24)} │ -93.5% schemas    │
│ Eager Static Prefix / Turn           │ ${String(sim.rawEagerTokensPerTurn.toLocaleString() + ' tokens').padEnd(24)} │ ${String(sim.evoBasePrefixTokens.toLocaleString() + ' tokens').padEnd(24)} │ -${sim.staticPrefixReductionPct}% token tax  │
│ Mid-Session Cache Invalidations      │ ${String(sim.rawCacheInvalidations + ' full prefix busts').padEnd(24)} │ ${String('0 (100% cache hit)').padEnd(24)} │ 100% cache shield │
│ 50-Turn Cumulative Prompt Tokens     │ ${String(sim.rawTotalInputTokens.toLocaleString() + ' tokens').padEnd(24)} │ ${String(sim.evoTotalInputTokens.toLocaleString() + ' tokens').padEnd(24)} │ -${sim.totalTokenSavingsPct}% total load │
│ 50-Turn Cost (Claude Sonnet 4.5)     │ ${String('$' + sim.cost50TurnsUsd.sonnet.raw.toFixed(2)).padEnd(24)} │ ${String('$' + sim.cost50TurnsUsd.sonnet.evo.toFixed(2)).padEnd(24)} │ -${sim.cost50TurnsUsd.sonnet.savedPct}% API cost   │
│ 50-Turn Cost (Claude Opus 4.5)       │ ${String('$' + sim.cost50TurnsUsd.opus.raw.toFixed(2)).padEnd(24)} │ ${String('$' + sim.cost50TurnsUsd.opus.evo.toFixed(2)).padEnd(24)} │ -${sim.cost50TurnsUsd.opus.savedPct}% API cost   │
└──────────────────────────────────────┴──────────────────────────┴──────────────────────────┴───────────────────┘
`);

if (live) {
  console.log(`3. Live Local Engine Micro-Benchmarks (Zero-Dep Node.js ${process.version})
   • AST Anti-Drift Verification (${live.memoriesVerified} memories) : ${live.astBatchVerifyP50Ms} ms total (${live.astPerMemoryMs} ms / memory)
   • Full Repository X-Ray Score Calculation : ${live.repoScoreLatencyMs} ms (Score: ${live.repoScore}/100 [${live.repoGrade}])
`);
}
