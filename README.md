<div align="center">

# 🧬 EvoKernel

### The Deterministic Self-Evolving Meta-Kernel for AI Coding Agents

**Stop writing static `.md` rules that rot. Stop adding 20 MCP servers that bust your Prompt Cache.**  
*1 Meta-Rule Seed (<80 lines) · 1 Fixed-Schema Meta-MCP Gateway · 4-Stage Deterministic Sandbox Gatekeeper · Zero External Dependencies*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B%20%7C%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(Zero%20Supply--Chain%20Risk)-brightgreen?style=flat-square)](#zero-dependency-architecture)
[![Prompt Cache](https://img.shields.io/badge/Prompt%20Cache-100%25%20Byte--Stable-ff6b6b?style=flat-square)](#1-why-a-fixed-5-tool-meta-mcp-gateway)
[![Harnesses](https://img.shields.io/badge/10%20Harnesses-Claude%20%7C%20Cursor%20%7C%20Windsurf%20%7C%20Cline%20%7C%20Roo%20%7C%20Copilot%20%7C%20Codex%20%7C%20OpenCode%20%7C%20Gemini%20%7C%20Antigravity-8A2BE2?style=flat-square)](#-10-agent-harness-matrix)

**[English](README.md) · [简体中文](README.zh-CN.md)**

</div>

---

## ⚡ Why Most "Self-Improving Agent" Setups Fail After 30 Sessions

Every developer using Claude Code, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, or Antigravity hits four engineering walls:

1. **The Slop-Pile Rule Rot (`CLAUDE.md` Bloat)**: Appending `"Never do X"` every time an agent makes a mistake turns your rules file into a 10,000-token contradictory junk drawer. Past ~1,500 tokens, LLM instruction-following degrades sharply (*Lost-in-the-Middle*).
2. **Worker Grading Its Own Homework**: Letting an LLM directly overwrite global skills or scripts without deterministic verification leads to broken, path-hardcoded scripts being crystallized as "permanent tools."
3. **The Dynamic MCP Prompt-Cache Collapse**: If "evolving MCP tools" means spawning new MCP servers or mutating the top-level `tools/list` schema mid-session, you **invalidate the LLM's KV Prompt Cache prefix on every mutation**—increasing token costs by 5–10x and requiring constant IDE restarts.
4. **Third-Party MCP Sprawl**: Adding 10 downstream MCP servers directly to your agent configuration dumps 50–100 tool definitions into every prompt header, diluting tool-calling accuracy and inflating baseline context costs.

**EvoKernel solves all four with a deterministic local compiler & routing kernel:**

```text
[Bug Fixed / User Correction / Temp Script / Downstream MCP Server]
                                │
                                ▼
                   ┌─────────────────────────┐
                   │   evo_propose (MCP)     │  ◄── Piggybacks on host LLM (Zero extra API keys!)
                   └────────────┬────────────┘
                                ▼
  ╔═══════════════════════════════════════════════════════╗
  ║         4-Stage Deterministic Gatekeeper              ║
  ║  1. Static AST & Security Audit                       ║  Blocks hardcoded user paths, secrets & rm -rf
  ║  2. Sandbox Dry-Run & AST Grounding                   ║  Scripts must exit 0; Memories verify live symbols & bind AST
  ║  3. FTS5 BM25 Deduplication                           ║  Blocks redundant skills/memories unless superseding
  ║  4. 1,500-Token Hard Budget & GC                      ║  Forces evo_compact merge when core rule budget is full
  ╚═════════════════════════════╤═════════════════════════╝
                                ▼
                   ┌─────────────────────────┐
                   │  Git-Native .evo/ Tree  │
                   └────────────┬────────────┘
                                │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
┌─────────────────────────┐           ┌─────────────────────────┐
│ Fixed 5-Tool Meta-MCP   │           │ Downstream MCP Proxy    │
│ (100% Byte-Stable KV)   │           │ (Virtualizes 10+ MCPs)  │
└─────────────────────────┘           └─────────────────────────┘
```

---

## 📊 Comprehensive Competitive Benchmark Matrix

| Dimension | `MemGPT / Letta` | `Aider` | Direct MCP Proxies | `affaan-m/ECC` | `AMAP-ML/SkillClaw` | **🧬 EvoKernel (Ours)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Primary Focus** | Stateful conversational agent DB | Git-centric terminal pair programmer | Pass-through MCP aggregation | Static engineering prompt library | Background LLM evolutionary agent | **Deterministic self-evolving meta-kernel for coding agents** |
| **Integration Architecture** | Heavy external service / Postgres / Python daemon | Standalone Python CLI replacing developer IDE | Raw JSON-RPC bridge passing all child tools | Preloaded Markdown templates | Hijacks `/v1/chat` reverse proxy | **Parasitic Meta-MCP + <80-line Seed injected into existing IDEs** |
| **Runtime Dependencies** | Heavy (Postgres, Python, vector DBs) | Python pip packages | Node / Python packages | Zero (plain markdown) | Python FastAPI daemon | **0 Dependencies (Pure Node.js `>= 22.5` built-ins: `node:sqlite`, `node:module`)** |
| **Prompt Cache Stability** | Cache-unfriendly (frequent context shifts) | Varies per edit | **Destructive** (exposing all child tools busts KV prefix on every change) | High context footprint | Neutral | **100% Byte-Stable: Exactly 5 immutable meta-tools exposed to host** |
| **Downstream MCP Virtualization** | None | None | Dumb pass-through (50+ tools in prompt) | None | None | **Zero-cache-invalidation FTS5 index + on-demand stdio JSON-RPC proxy** |
| **Verification & Gatekeeper** | Model self-reflection | Git commit diffs & tests | None | Manual `/learn-eval` | Async LLM reviewer | **4-Stage Deterministic Gatekeeper (Static AST, Sandbox Exit 0, BM25, 1500-tok Cap)** |
| **Episodic Memory & Anti-Drift** | Semantic vector embeddings (subject to hallucination) | Repo map only | None | None (static docs) | No AST verification | **3-Stage AST Cognitive Memory (Fingerprint Hash, [STALE] demotion, Topology Penetration)** |
| **Multi-Agent Harness Support** | Standalone only | Standalone only | Generic MCP clients | Claude Code / Cursor only | Generic proxy | **10 Native Harnesses (Claude, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, Antigravity)** |
| **Cold-Start Gene Extraction** | Empty until chat sessions accumulate | Git repo scan | Empty | Static catalog | Empty until chat history grows | **`evo bootstrap` mines project stacks + git fixes in <10s** |

---

## 🎯 10-Agent Harness Matrix

EvoKernel injects its managed L0 Meta-Rule Seed and Single Meta-MCP gateway cleanly into 10 major AI coding agent environments with non-destructive marker updates and stealth Git isolation:

| Agent / Harness | Rule Injection Target | MCP Gateway Target | Detection Mechanisms | Stealth Mode (`.git/info/exclude`) |
| :--- | :--- | :--- | :--- | :---: |
| **Claude Code** | `CLAUDE.md` | `.mcp.json` + `.claude/settings.json` | `CLAUDE.md`, `.claude/`, `CLAUDE_CONFIG_DIR`, `~/.claude` | ✅ |
| **Cursor** | `.cursor/rules/evo-kernel.mdc` | `.cursor/mcp.json` | `.cursor/`, `.cursorrules`, `CURSOR_AGENT`, `~/.cursor` | ✅ |
| **Windsurf** | `.windsurfrules` | `.windsurf/mcp.json` | `.windsurf/`, `.windsurfrules`, `WINDSURF_DIR`, `~/.windsurf` | ✅ |
| **Cline** | `.clinerules` | `.cline/mcp.json` | `.clinerules`, `.cline/`, `CLINE_DIR`, `~/.cline` | ✅ |
| **Roo Code** | `.roo/rules/evo-kernel.md` | `.roo/mcp.json` | `.roo/`, `.roorules`, `ROO_DIR`, `~/.roo` | ✅ |
| **GitHub Copilot / VS Code** | `.github/copilot-instructions.md` | `.vscode/mcp.json` | `.github/copilot-instructions.md`, `.vscode/`, `VSCODE_PID` | ✅ |
| **Codex CLI** | `AGENTS.md` | `.codex/config.toml` | `.codex/`, `CODEX_HOME`, `~/.codex` | ✅ |
| **OpenCode** | `opencode.json` + `AGENTS.md` | `opencode.json` | `opencode.json`, `.opencode/`, `OPENCODE_CONFIG` | ✅ |
| **Gemini CLI** | `GEMINI.md` | `.gemini/settings.json` | `GEMINI.md`, `.gemini/`, `GEMINI_CLI_HOME`, `~/.gemini` | ✅ |
| **Antigravity** | `GEMINI.md` | `mcp_config.json` + `.mcp.json` | `mcp_config.json`, `ANTIGRAVITY_AGENT`, `~/.antigravity` | ✅ |

- **Cascaded Auto-Detection**: Running `evo init --targets auto` automatically activates only the harnesses currently present in your workspace, environment variables, or user home directory.
- **Stealth Git Exclude**: `evo init --stealth` registers all generated rule files, directories, and MCP configs into `.git/info/exclude` (supporting monorepo subfolder prefixes), ensuring zero dirty Git status and never modifying tracked `.gitignore` files.
- **Reversible Clean Uninstall**: `evo uninstall` cleanly removes EvoKernel marker blocks, prunes empty harness directories, and purges stealth exclude entries while preserving user rules and sibling MCP servers.

---

## 🔌 Downstream MCP Proxy Virtualization

### The Dilemma: Prompt Cache Bloat vs. Tool Access
When developers connect 10 downstream MCP servers (e.g., PostgreSQL, GitHub, AWS, Jira, Docker, Kubernetes) directly to their coding agent:
- Every prompt request must include **50–100 individual tool JSON schemas**, consuming 5,000–12,000 baseline tokens.
- Whenever an MCP server updates its schema or restarts, the host LLM's **KV Prompt Cache is completely invalidated**, driving up API costs and latency.
- LLMs suffer from tool-selection confusion when choosing among dozens of noisy top-level schemas.

### The EvoKernel Solution: Virtualized Proxy Layer
EvoKernel virtualizes downstream MCP servers behind its **Fixed 5-Tool Meta-MCP Gateway**. Your agent interacts with only 5 meta-tools, while hundreds of downstream tools become searchable, inspectable, and executable on demand:

```text
Host Coding Agent (Claude / Cursor / Copilot / etc.)
                  │
                  ▼ Fixed 5-Tool stdio Interface (100% Byte-Stable KV Cache)
         ╔════════════════════════════════════════════════════╗
         ║               EvoKernel Meta-MCP                   ║
         ║  evo_search · evo_inspect · evo_run · propose · compact
         ╚════════════════════════════════════════════════════╝
                  │                      │
       FTS5 BM25 Search          Proxy Execution (`evo_run`)
                  ▼                      ▼
       ┌────────────────────┐   ┌─────────────────────────────┐
       │ capability_fts     │   │ McpProxyManager (Pool)      │
       │ ext__postgres__... │   └──────────────┬──────────────┘
       │ ext__github__...   │                  │ stdio JSON-RPC
       └────────────────────┘                  ▼
                                ┌─────────────────────────────┐
                                │ Downstream MCP Servers      │
                                │ postgres · github · docker  │
                                └─────────────────────────────┘
```

### 1. Configuration in `.evo/config.json`
Declare external MCP servers under the `externalServers` dictionary:

```json
{
  "maxCoreRuleTokens": 1500,
  "externalServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx" }
    }
  }
}
```

### 2. Zero-Cache-Invalidation Lifecycle
1. **Discovery & Indexing**: Downstream tools are queried via `tools/list` and cached locally in `.evo/.cache/external-tools.json` and SQLite `capability_fts`. Namespaced IDs are generated automatically: `ext__<server>__<tool>` (e.g., `ext__postgres__query_db`).
2. **Search (`evo_search`)**: The agent recalls tools using natural language without prompt pollution:
   ```json
   evo_search({ "query": "query postgres customer database", "kind": "tool" })
   ```
   *Returns*: `<30 tokens` L0 summary with `id: "ext__postgres__query_db"`.
3. **Progressive Inspection (`evo_inspect`)**:
   - `L1`: Returns the exact downstream input JSON schema.
   - `L2`: Returns downstream routing directives and execution examples.
4. **Proxy Execution (`evo_run`)**:
   ```json
   evo_run({
     "tool_id": "ext__postgres__query_db",
     "args": { "sql": "SELECT id, email FROM customers LIMIT 10;" }
   })
   ```
   `McpProxyManager` routes the call to the pooled `postgres` child process over stdio JSON-RPC and returns the formatted execution result.

---

## 🪝 Universal Hook Router & Workflow Enforcement

EvoKernel provides a CLI hook router (`evo hook <event>`) for agent lifecycle integration (Claude Code post-tool hooks, Cursor automation, and Git pre-commit guards):

```bash
# 1. Post-Tool Hook: Tracks session mutations & auto-recalls path-scoped rules
evo hook post-tool --tool Edit --file src/core/storage.ts

# 2. Stop Hook: Emits crystallization reminders & anti-poisoning dirty alerts
evo hook stop

# 3. Pre-Commit Guard: Blocks commits if internal caches are staged or token budget >1500
evo hook pre-commit
```

- **Path-Scoped Rule Recall**: When a source file is touched, `post-tool` matches active rules against wildcard globs (e.g., `src/**/*.ts`, `firmware/**/*.c`) and surfaces relevant engineering invariants into the agent's active context.
- **Anti-Poisoning Alert**: If source files are modified mid-session *after* a capability has been crystallized without re-verifying, `evo hook stop` raises an alert to prevent stale or poisoned memories.
- **Pre-Commit Budget Gate**: Ensures that unverified telemetry DB files or bloated rules (>1,500 tokens) are never committed to Git.

---

## 🚀 Quick Start (60 Seconds)

> **Prerequisites**: Node.js `>= 22.5` or `24+` (uses native `node:sqlite` & native TypeScript stripping — **0 third-party npm dependencies**).

```bash
# 1. Clone and build (takes <50ms, zero npm install required)
git clone https://github.com/damonless/EvoKernel.git
cd EvoKernel
node ./scripts/build.mjs

# 2. Wire L0 Meta-Rule Seed + Single Meta-MCP into your active coding agents
#    Auto-detects active agents or targets specific harnesses with stealth exclude
node ./dist/cli/index.js init --targets auto --stealth

# 3. Cold-start mine your repository structure, project stacks & Git fix history
#    (Detects Rust, Go, Python, Java/Kotlin, TypeScript/JavaScript, and C/C++)
node ./dist/cli/index.js bootstrap --max-commits=50

# 4. Inspect your evolved capability tree, AST memory freshness & ROI ledger
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
├── 🛡️  Rules (3 active | Core Token Budget: 412/1500 tokens)
│   ├── [CORE] gatekeeper-self-test-invariant (132 tok | hits: 4) — Every evolved Micro-Tool script must handle --self-test and exit 0.
│   ├── [CORE] esm-typescript-imports (154 tok | hits: 7) — Always use explicit .js extensions on relative imports in ESM TypeScript.
│   └── [STACK] stack-rust-core-invariants (126 tok | hits: 2) — Safe concurrency: prefer channels and arc mutex over raw pointers.
├── ⚡ Skills (1 verified L0/L1/L2 playbooks)
│   └── [SOP] bug-to-guardrail-sop (hits: 3 | tags: debugging,evolution) — Standard workflow to turn a resolved root cause into a Rule.
├── 🔧 Micro-Tools (3 sandboxed scripts | Fixed Meta-MCP Routed)
│   ├── [NODE] git-hotspot-analyzer (runs: 5 | pass: 100%) — Identifies top 10 frequently modified files in recent git history.
│   ├── [NODE] workspace-metrics-scanner (runs: 9 | pass: 100%) — Scans file counts, LOC, and extension distribution.
│   └── [PROXY] ext__postgres__query_db (runs: 12 | pass: 100%) — [External: postgres] Execute read-only SQL query on PostgreSQL.
└── 🧠 Episodic Memories (1 troubleshooting experiences | 1 VERIFIED · 0 STALE)
    └── [VERIFIED] mem-git-fix-insights (confidence: HIGH | symbols: 2/2 fresh | hits: 2) — Troubleshooting record from git fix history.
```

---

## 🧠 Core Architecture: 5 Fixed Meta-Tools

EvoKernel exposes **exactly 5 immutable meta-tools** over `stdio` to ensure 100% Prompt-Cache retention:

| Meta-Tool | Tier | Purpose |
| :--- | :--- | :--- |
| `evo_search` | **L0** | FTS5 BM25 search across Rules, Skills, Micro-Tools, Virtualized External Tools, and Memories. Performs live Stage-2 AST fingerprint verification and demotes `[STALE]` memories automatically. |
| `evo_inspect` | **L1 / L2** | Progressive disclosure loader. Delivers Symptom/Root-Cause/Solution triads, JSON Schemas for virtualized external tools, and **Topology Penetration Anchors** (live line spans, callers, and negative dead-ends). |
| `evo_run` | **Execution** | Executes local sandboxed Micro-Tools (`.mjs`, `.py`, `.ps1`, `.sh`) or proxies calls to downstream MCP servers via `McpProxyManager`. |
| `evo_propose` | **Evolution** | Submits a candidate Rule, Skill, Micro-Tool, or Memory through the 4-Stage Deterministic Gatekeeper (Static AST, Sandbox Dry-Run, BM25 Deduplication, Token Budget Cap). |
| `evo_compact` | **GC** | Atomically merges fragmented rules or archives `[STALE]` memories into `.evo/archive/` to keep core token consumption under the 1,500-token limit. |

---

## 🧪 Comprehensive Verification Suite

EvoKernel features a zero-dependency test suite executed via native Node test runner (`node:test`):

```bash
node ./scripts/test.mjs
```

All 5 test suites (100+ tests) run in ~5 seconds:
1. `dist/tests/evo-kernel.test.js`: Core Gatekeeper, Sandbox, AST Cognitive Memory, and Invariants.
2. `dist/tests/multi-harness.test.js`: 10-Agent Harness Matrix, Non-Destructive Merging, and Stealth Exclude.
3. `dist/tests/hook.test.js`: Universal Hook Router, Scoped Glob Matching, and Anti-Poisoning Alerts.
4. `dist/tests/bootstrap.test.js`: Multi-Stack Detection (Rust, Go, Python, Java, TS, C/C++) and Git Fix Mining.
5. `dist/tests/mcp-proxy.test.js`: Downstream MCP Proxy Handshake, FTS5 Discovery, and Stdio JSON-RPC Execution.

---

## 📄 License

MIT License — see [LICENSE](LICENSE).
