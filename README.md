<div align="center">

# 🧬 EvoKernel

### The Deterministic Self-Evolving Meta-Kernel for AI Coding Agents

**Stop writing static `.md` rules that rot. Stop adding 20 MCP servers that bust your Prompt Cache.**  
*1 Meta-Rule Seed (<80 lines) · 1 Fixed-Schema Meta-MCP Gateway · 4-Stage Deterministic Sandbox Gatekeeper · Zero External Dependencies*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B%20%7C%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(Zero%20Supply--Chain%20Risk)-brightgreen?style=flat-square)](#zero-dependency-architecture)
[![Prompt Cache](https://img.shields.io/badge/Prompt%20Cache-100%25%20Byte--Stable-ff6b6b?style=flat-square)](#why-fixed-5-tool-meta-mcp)
[![Harnesses](https://img.shields.io/badge/Claude%20Code%20%7C%20Cursor%20%7C%20Antigravity%20%7C%20Codex%20%7C%20Gemini-supported-8A2BE2?style=flat-square)](#quick-start)

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

---

## ⚡ Why Most "Self-Improving Agent" Setups Fail After 30 Sessions

Every developer using Claude Code, Cursor, Antigravity, or Codex hits three walls:

1. **The Slop-Pile Rule Rot (`CLAUDE.md` Bloat)**: Appending `"Never do X"` every time an agent makes a mistake turns your rules file into a 10,000-token contradictory junk drawer. Past ~1,500 tokens, LLM instruction-following degrades sharply (*Lost-in-the-Middle*).
2. **Worker Grading Its Own Homework**: Letting an LLM directly overwrite global skills or scripts without deterministic verification leads to broken, path-hardcoded scripts being crystallized as "permanent tools."
3. **The Dynamic MCP Prompt-Cache Collapse**: If "evolving MCP tools" means spawning new MCP servers or mutating the top-level `tools/list` schema mid-session, you **invalidate the LLM's KV Prompt Cache prefix on every mutation**—increasing token costs by 5–10x and requiring constant IDE restarts.

**EvoKernel solves all three with a deterministic local compiler & routing kernel:**

```text
[Bug Fixed / Correction / Temp Script Written]
                     │
                     ▼
        ┌─────────────────────────┐
        │   evo_propose (MCP)     │  ◄── Piggybacks on your host LLM (Zero extra API keys!)
        └────────────┬────────────┘
                     ▼
  ╔══════════════════════════════════════╗
  ║  4-Stage Deterministic Gatekeeper    ║
  ║  1. Static AST & Security Audit      ║  Blocks hardcoded user paths, secrets & rm -rf
  ║  2. Sandbox Dry-Run & AST Grounding  ║  Scripts must exit 0; Memories verify target_symbols & bind AST hash
  ║  3. FTS5 BM25 Duplicate Interception ║  Blocks redundant skills/memories unless superseding
  ║  4. 1,500-Token Hard Budget & GC     ║  Forces evo_compact merge when core rule budget is full
  ╚══════════════════╤═══════════════════╝
                     ▼
        ┌─────────────────────────┐
        │  Git-Native .evo/ Tree  │  ──► Routed via Fixed 5-Tool Meta-MCP (0 Cache Busting)
        └─────────────────────────┘
```

---

## 📊 How EvoKernel Compares to Existing Projects

| Dimension | `affaan-m/ECC` | `AMAP-ML/SkillClaw` | `lsdefine/GenericAgent` | `mksglu/context-mode` | **🧬 EvoKernel** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Integration Mode** | Preloads 311 static skills | Hijacks `/v1/chat` API proxy | Standalone TUI/Web agent | Output compression MCP | **Parasitic Meta-MCP + 80-line Seed** |
| **Extra API Key Needed?** | No | Yes (background evolver LLM) | Yes (standalone agent key) | No | **Zero (Piggybacks on Host Model)** |
| **Dynamic MCP Evolution** | Static `.mcp.json` only | `.md` skills only | Internal `code_run` only | Ephemeral sandbox only | **Temp scripts auto-promote to verified Micro-Tools** |
| **Episodic Memory & Anti-Drift** | None (static docs) | No AST verification | None | Session-only | **3-Stage Cognitive Memory (AST Hash + Topology Anchors)** |
| **Prompt Cache Impact** | High context footprint | Neutral | Separate runtime | Compresses tool stdout | **100% Byte-Stable (Fixed 5 Meta-Tools)** |
| **Anti-Bloat / Verification** | Manual `/learn-eval` | Async LLM merge | Direct file overwrite | Cleared per session | **4-Stage Gatekeeper + 1,500-Token Hard Cap GC** |
| **Cold-Start Experience** | Generic catalog | Empty until chat history grows | 9 atomic seed tools | Empty until indexed | **`evo bootstrap` mines repo & git fixes in 10s** |

---

## 🚀 Quick Start (60 Seconds)

> **Prerequisites**: Node.js `>= 22.5` or `24+` (uses native `node:sqlite` & native TypeScript stripping — **0 third-party npm dependencies**; on Windows x64, `>= 22.16` / `22.23 LTS` or `24+` enables native SQLite FTS5, while earlier `v22.5–v22.14` builds automatically use the built-in JS BM25 fallback).

```bash
# 1. Clone and build (takes <50ms, zero npm install required)
git clone https://github.com/damonless/EvoKernel.git
cd EvoKernel
node ./scripts/build.mjs

# 2. Wire L0 Meta-Rule Seed + Single Meta-MCP into your active coding agents
#    (Optional: add --stealth for .git/info/exclude and --targets agents,claude or --targets auto)
node ./dist/cli/index.js init

# 3. Cold-start mine your repository's build scripts & git fix history (Rules + Tools + Memories)
node ./dist/cli/index.js bootstrap

# 4. Inspect your evolved capability tree, AST memory freshness, ROI ledger & rule health
node ./dist/cli/index.js tree
node ./dist/cli/index.js memory verify
node ./dist/cli/index.js stats
node ./dist/cli/index.js audit --global
node ./dist/cli/index.js refactor
```

### Live Terminal Output

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ 🧬 EvoKernel — Self-Evolving Capability Tree (.evo/)                     │
╰──────────────────────────────────────────────────────────────────────────╯
📦 Workspace: /path/to/your-repo
├── 🛡️  Rules (2 active | Core Token Budget: 286/1500 tokens)
│   ├── [CORE] gatekeeper-self-test-invariant (132 tok | hits: 4) — Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically.
│   └── [CORE] esm-typescript-imports (154 tok | hits: 7) — Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript.
├── ⚡ Skills (1 verified L0/L1/L2 playbooks)
│   └── [SOP] bug-to-guardrail-sop (hits: 3 | tags: debugging,evolution,guardrail,tdd) — Standard workflow to turn a resolved root cause or recurring review comment into a verified Rule or Micro-Tool.
├── 🔧 Micro-Tools (2 sandboxed scripts | Fixed Meta-MCP Routed)
│   ├── [NODE] git-hotspot-analyzer (runs: 5 | pass: 100%) — Identifies top 10 most frequently modified files in recent git history to pinpoint fragile modules.
│   └── [NODE] workspace-metrics-scanner (runs: 9 | pass: 100%) — Scans repository file counts, LOC, and extension distribution in one sandboxed call without polluting context.
└── 🧠 Episodic Memories (1 troubleshooting experiences | 1 VERIFIED · 0 STALE)
    └── [VERIFIED] mem-git-fix-insights (confidence: HIGH | symbols: 2/2 fresh | hits: 2) — Troubleshooting record mined from 2 recent fix commits.
```

---

## 🧠 Core Architecture

### 1. Why a Fixed 5-Tool Meta-MCP Gateway?
Instead of registering 50 separate MCP tools (which bloats system prompts and invalidates KV cache whenever a tool is added), EvoKernel exposes **exactly 5 immutable meta-tools** over `stdio`:

| Meta-Tool | Tier | Purpose |
| :--- | :--- | :--- |
| `evo_search` | **L0** | FTS5 BM25 search across all evolved Rules, Skills, Micro-Tools, and Episodic Memories (`memory`). Performs live Stage-2 AST fingerprint verification and demotes `[STALE]` memories automatically. |
| `evo_inspect` | **L1 / L2** | Progressive disclosure loader. For `memory`, delivers **3-Stage Cascaded Recall**: `L1` returns the Symptom/Root-Cause/Solution triad + AST Anti-Drift Status table; `L2` adds **Topology Penetration Anchors** (live line spans, callers, and negative dead-ends). |
| `evo_run` | **Execution** | Executes any evolved `.mjs`, `.py`, `.ps1`, or `.sh` Micro-Tool inside a timeout-bounded sandbox and logs telemetry. |
| `evo_propose` | **Evolution** | Submits a candidate Rule, Skill, Micro-Tool, or Episodic Memory (`memory`) through the 4-Stage Deterministic Gatekeeper (including `target_symbols` AST grounding). |
| `evo_compact` | **GC** | Archives fragmented/low-hit rules or `[STALE]` memories into `.evo/archive/` and replaces them with a consolidated asset. |

### 2. Git-Friendly `.evo/` Storage Layout
Everything your agent learns is stored as clean, human-readable Markdown and standard scripts in `.evo/`—ready to commit and share with your team—while dynamic FTS5 indexes and hit counters live in `.evo/.cache/telemetry.db` (git-ignored and 100% rebuildable from disk):

```text
.evo/
├── config.json                 # Token budget cap (1500 tokens), similarity threshold, harnesses
├── rules/
│   ├── core-invariants.md      # Auto-synced digest injected into CLAUDE.md / GEMINI.md / .cursor
│   └── scoped/                 # Path-scoped rules loaded on demand via evo_search
├── skills/
│   └── <skill-id>/SKILL.md     # Structured with YAML frontmatter (L0), ## L1 Contract, ## L2 SOP
├── tools/
│   └── <tool-id>/
│       ├── manifest.json       # Input JSON Schema, runtime, timeout, self_test_args
│       └── run.{mjs|py|ps1|sh} # Deterministic executable script verified by Gatekeeper
├── memories/
│   └── <memory-id>.md          # Episodic memory (Symptom, Root Cause, Negative Dead-Ends, AST Fingerprints)
└── archive/                    # Historical snapshots before compaction/upgrade
```

---

## 🧪 Running the Verification Suite

```bash
node ./scripts/build.mjs
node --test ./dist/tests/evo-kernel.test.js
```

---

## 📄 License

MIT License — see [LICENSE](LICENSE).
