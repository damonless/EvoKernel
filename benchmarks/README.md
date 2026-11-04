# EvoKernel Benchmarks: Context Tax, Prompt-Cache Shielding & AST Verification

Reproduce all numbers locally with zero external dependencies:

```bash
npm run benchmark
# or output machine-readable JSON:
node ./benchmarks/context-tax-benchmark.mjs --json
```

## Methodology

The benchmark models a realistic full-stack AI coding session over **50 turns** with **8 standard MCP servers** (`github`, `playwright`, `kubernetes`, `docker`, `linear`, `postgres`, `sentry`, `context7` — **77 tools** total) alongside a mature repository knowledge base (10 architectural rules, 4 workflow skills, 5 diagnostic micro-tools, and 15 episodic debugging memories), with **3 mid-session capability evolutions** at turns 12, 27, and 41.

| Metric | Raw MCP + Monolithic `CLAUDE.md` | EvoKernel 5-Tool Meta-Gateway | Delta |
| :--- | :---: | :---: | :---: |
| **Exposed Tool Schemas** | 77 tools | **5 fixed meta-tools** | **-93.5%** |
| **Eager Static Prefix / Turn** | 27,150 tokens | **1,530 tokens** | **-94.4% prompt tax** |
| **Mid-Session Cache Invalidations** | 3 full prefix busts | **0 (100% cache hit)** | **100% cache shield** |
| **50-Turn Cumulative Prompt Tokens** | 1,931,250 tokens | **661,770 tokens** | **-65.7% total tokens** |
| **50-Turn Cost (Claude Sonnet 4.5)** | $1.15 | **$0.31** | **-72.9% API cost** |
| **50-Turn Cost (Claude Opus 4.5)** | $5.76 | **$1.56** | **-72.9% API cost** |
| **AST Memory Verification Latency** | N/A (Unverified text) | **0.048 ms / memory** | **Deterministic AST Grounding** |
| **Full Repo X-Ray Score Calculation** | N/A | **~22.5 ms** | **Zero-Overhead Local Audit** |
