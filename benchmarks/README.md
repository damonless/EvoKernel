# EvoKernel Benchmarks: Context Tax, Prompt-Cache Shielding & AST Verification

Reproduce all numbers locally from the single benchmark source of truth (`benchmarks/context-tax-benchmark.mjs`) with zero external dependencies:

```bash
npm run benchmark
# Machine-readable JSON SSOT:
node ./benchmarks/context-tax-benchmark.mjs --json
# Markdown table output:
node ./benchmarks/context-tax-benchmark.mjs --markdown
```

## Methodology

The benchmark models a realistic full-stack AI coding session over **50 turns** with **8 standard MCP servers** (`github`, `playwright`, `kubernetes`, `docker`, `linear`, `postgres`, `sentry`, `context7` — **77 tools**, `14,700` schema tokens) alongside a mature repository knowledge base (10 architectural rules, 4 workflow skills, 5 diagnostic micro-tools, and 15 episodic debugging memories — `12,450` tokens; `27,150` eager tokens/turn total), with **3 mid-session capability evolutions** at turns 12, 27, and 41.

EvoKernel folds the 77 tools + monolithic knowledge base behind **5 fixed meta-tools** (`1,953` live schema tokens) + a compact **L0 Meta-Rule Seed** (`1,150` tokens) = **`3,103` session-start tokens/turn** (`-88.6%` session-start prefix reduction), recalling L1/L2 details only on turns that need them.

| Metric | Raw MCP + Monolithic `CLAUDE.md` | EvoKernel 5-Tool Meta-Gateway | Delta |
| :--- | :---: | :---: | :---: |
| **Exposed Tool Schemas** | 77 tools | **5 fixed meta-tools** | **-93.5%** |
| **Session-Start Static Prefix / Turn** | 27,150 tokens | **3,103 tokens** | **-88.6% session-start tax** |
| **Mid-Session Cache Invalidations** | 3 full prefix busts | **0 (100% cache hit)** | **100% cache shield** |
| **50-Turn Cumulative Prompt Tokens** | 1,931,250 tokens | **740,420 tokens** | **-61.7% total tokens** |
| **50-Turn Cost (Claude Sonnet 4.5)** | $1.15 | **$0.34** | **-70.3% API cost** |
| **50-Turn Cost (Claude Opus 4.5)** | $5.76 | **$1.71** | **-70.3% API cost** |
| **AST Memory Verification Latency¹** | N/A (Unverified text) | **~11.4 ms / memory** | **~500 ms batch across 44 memories** |
| **Full Repo X-Ray Score Calculation** | N/A | **~864 ms** | **Score: 100/100 (A+)** |

> ¹ *AST Terminology Note:* "AST" refers to EvoKernel's zero-dependency lexical-structural skeleton & call-anchor fingerprinting (`src/core/memory.ts`), immune to comments, formatting, and line-number drift without external compiler packages.
