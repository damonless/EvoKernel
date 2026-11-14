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

EvoKernel folds the 77 tools + monolithic knowledge base behind **5 fixed meta-tools** (`1,916` live schema tokens) + a compact **L0 Meta-Rule Seed** (`1,150` tokens) = **`3,066` session-start tokens/turn** (`-88.7%` session-start prefix reduction), recalling L1/L2 details only on turns that need them.

| Metric | Raw MCP + Monolithic `CLAUDE.md` | EvoKernel 5-Tool Meta-Gateway | Delta |
| :--- | :---: | :---: | :---: |
| **Exposed Tool Schemas** | 77 tools | **5 fixed meta-tools** | **-93.5%** |
| **Session-Start Static Prefix / Turn** | 27,150 tokens | **3,066 tokens** | **-88.7% session-start tax** |
| **Mid-Session Cache Invalidations** | 3 full prefix busts | **0 (100% cache hit)** | **100% cache shield** |
| **50-Turn Cumulative Prompt Tokens** | 1,931,250 tokens | **738,570 tokens** | **-61.8% total tokens** |
| **50-Turn Cost (Claude Sonnet 4.5)** | $1.15 | **$0.34** | **-70.4% API cost** |
| **50-Turn Cost (Claude Opus 4.5)** | $5.76 | **$1.70** | **-70.4% API cost** |
| **AST Memory Verification Latency¹** | N/A (Unverified text) | **~1.2 ms / memory** | **~49 ms batch across 41 memories** |
| **Full Repo X-Ray Score Calculation** | N/A | **~369 ms** | **Score: 100/100 (A+)** |

> ¹ *AST Terminology Note:* "AST" refers to EvoKernel's zero-dependency lexical-structural skeleton & call-anchor fingerprinting (`src/core/memory.ts`), immune to comments, formatting, and line-number drift without external compiler packages.
