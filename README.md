<div align="center">

# 🧬 EvoKernel (evo-kernel)

### Cut MCP & Rule Prompt Tax by 94.4%. Keep 100% KV Cache Hit. Evolve AST-Verified Memories & Sandboxed Tools in Isolated Git Worktrees — with Zero External Dependencies.

**The Deterministic Self-Evolving Meta-Kernel & Cognitive Context OS for AI Coding Agents**  
*Claude Code · Cursor · Codex · Windsurf · Cline · Roo · GitHub Copilot · OpenCode · Gemini · Antigravity*

[![CI & Gatekeeper Audit](https://github.com/damonless/EvoKernel/actions/workflows/ci.yml/badge.svg)](https://github.com/damonless/EvoKernel/actions/workflows/ci.yml)
[![Live Cockpit Demo](https://img.shields.io/badge/Live_Cockpit-Interactive_Demo-38bdf8?style=flat-square&logo=github)](https://damonless.github.io/EvoKernel/)
[![EvoKernel Score](https://img.shields.io/badge/EvoKernel_Score-96%2F100_(A%2B)-34d399?style=flat-square)](#-30-second-quick-start)
[![Version](https://img.shields.io/badge/npm-v0.3.0-blue?style=flat-square&logo=npm)](https://www.npmjs.com/package/evo-kernel)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.5%2B%20%7C%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0%20(Zero%20Supply--Chain%20Risk)-brightgreen?style=flat-square)](#-zero-dependency-architecture)
[![Prompt Cache](https://img.shields.io/badge/Prompt%20Cache-100%25%20Byte--Stable-ff6b6b?style=flat-square)](#-core-architecture-5-fixed-meta-tools)
[![Tests](https://img.shields.io/badge/tests-274%2B%20passed%20%7C%2011%20suites-brightgreen?style=flat-square)](#-comprehensive-verification-suite)

**[English](README.md) · [简体中文](README.zh-CN.md) · [🌐 Live Interactive Cockpit](https://damonless.github.io/EvoKernel/) · [📊 Benchmarks](benchmarks/README.md)**

<br/>

<a href="https://damonless.github.io/EvoKernel/"><img src="./assets/hero-shotcraft.svg" alt="EvoKernel 3-Tier Context OS & Benchmark Telemetry" width="100%" /></a>

</div>

> [!NOTE]
> **Disambiguation Note:** EvoKernel (`evo-kernel`) is an agent architecture and context engineering framework for AI coding assistants (Claude Code, Cursor, Windsurf, Codex, Gemini, etc.). It is not affiliated with academic ICML papers/benchmarks of similar naming or Linux kernel projects.

---

## ⚡ 30-Second Quick Start

Get started in 3 commands — zero installation required:

```bash
# 1. Instant Zero-Write X-Ray (<25ms) — scan host rules, git hotspots & memory coverage
npx -y evo-kernel score

# 2. One-Click Auto-Wiring & Virtualization — wire 10 IDEs + fold third-party MCPs
npx -y evo-kernel init --stealth && npx -y evo-kernel virtualize

# 3. Live Obsidian Cockpit with 30s Film & Deliverable Inspection
npx -y evo-kernel ui --open
npx -y evo-kernel check ./report.xlsx
```

> 💡 **Node.js 18 / 20 Instant 1-Liner (No Global Node Upgrade Needed):**  
> `npx -y -p node@22 evo-kernel score`  
> *Why Node.js >= 22.5.0?* EvoKernel runs purely on native `node:sqlite`, `node:module`, and `node:test` — providing **0 external npm dependencies and 0 supply-chain vulnerability risk**.

<div align="center">
  <img src="./assets/quickstart-shotcraft.svg" alt="EvoKernel 30-Second Quick Start Pipeline" width="100%" />
</div>

<br/>

<table>
<tr>
<td align="center" width="52%">
  <b>Obsidian Live Cockpit (<code>npx evo-kernel ui --open</code>)</b><br/>
  <a href="https://damonless.github.io/EvoKernel/"><img src="./assets/cockpit-showcase.png" width="100%" alt="EvoKernel Obsidian Live Cockpit and AST Constellation" /></a>
</td>
<td align="center" width="48%">
  <b>Instant Terminal X-Ray (<code>npx evo-kernel score</code>)</b><br/>
  <img src="./assets/terminal-score-xray.svg" width="100%" alt="EvoKernel Terminal Score X-Ray Card" />
</td>
</tr>
</table>

<details>
<summary><b>🛠️ Clone from Source & Advanced CLI Workflows (Click to expand)</b></summary>

```bash
# Clone and build from source (takes <50ms, zero npm install required)
git clone https://github.com/damonless/EvoKernel.git
cd EvoKernel
node ./scripts/build.mjs

# Wire L0 Meta-Rule Seed + Single Meta-MCP into your active coding agents
node ./dist/cli/index.js init --targets auto --stealth

# Cold-start mine your repository structure, project stacks & Git fix history
node ./dist/cli/index.js bootstrap --max-commits=50

# Run offline worktree optimization cycle
node ./dist/cli/index.js optimize --dim both -k 3

# Inspect capability tree, multi-branch AST memory freshness & ROI ledger
node ./dist/cli/index.js tree
node ./dist/cli/index.js memory verify
node ./dist/cli/index.js stats
node ./dist/cli/index.js audit --global
node ./dist/cli/index.js doctor
```

</details>

---

## 📈 Reproducible 50-Turn Engineering Benchmark (`npm run benchmark`)

Simulated across **8 standard MCP servers** (`github`, `playwright`, `kubernetes`, `docker`, `linear`, `postgres`, `sentry`, `context7` — **77 tools** total) + a mature repo knowledge base (10 rules, 4 skills, 5 micro-tools, 15 debugging memories) over a **50-turn coding session** with 3 mid-session capability evolutions (reproduce locally via `npm run benchmark`):

| Metric | Raw Multi-MCP + Monolithic `CLAUDE.md` | **🧬 EvoKernel 5-Tool Meta-Gateway** | Verified Improvement |
| :--- | :---: | :---: | :---: |
| **Exposed Tool Schemas** | 77 tools | **5 fixed meta-tools** | **-93.5% schema footprint** |
| **Eager Static Prefix / Turn** | 27,150 tokens | **1,530 tokens** | **-94.4% prompt tax** |
| **Mid-Session Cache Invalidations** | 3 full prefix busts | **0 (100% cache hit)** | **100% KV Cache Shield** |
| **50-Turn Cumulative Prompt Tokens** | 1,931,250 tokens | **661,770 tokens** | **-65.7% total token load** |
| **50-Turn Cost (Claude Sonnet 4.5)** | \$1.15 | **\$0.31** | **-72.9% API cost** |
| **50-Turn Cost (Claude Opus 4.5)** | \$5.76 | **\$1.56** | **-72.9% API cost** |
| **AST Anti-Drift Memory Check** | Unverified text (drifts silently) | **0.048 ms / memory** | **Deterministic AST Grounding** |

---

## ⚡ Why Most "Self-Improving Agent" Setups Fail After 30 Sessions

Every developer using Claude Code, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, or Antigravity hits five engineering walls:

1. **The Slop-Pile Rule Rot (`CLAUDE.md` Bloat)**: Appending `"Never do X"` every time an agent makes a mistake turns your rules file into a 10,000-token contradictory junk drawer. Past ~1,500 tokens, LLM instruction-following degrades sharply (*Lost-in-the-Middle*).
2. **Worker Grading Its Own Homework**: Letting an LLM directly overwrite global skills or scripts without deterministic verification leads to broken, path-hardcoded scripts being crystallized as "permanent tools."
3. **The Dynamic MCP Prompt-Cache Collapse**: If "evolving MCP tools" means spawning new MCP servers or mutating the top-level `tools/list` schema mid-session, you **invalidate the LLM's KV Prompt Cache prefix on every mutation**—increasing token costs by 5–10x and requiring constant IDE restarts.
4. **Third-Party MCP Sprawl**: Adding 10 downstream MCP servers directly to your agent configuration dumps 50–100 tool definitions into every prompt header, diluting tool-calling accuracy and inflating baseline context costs.
5. **Confounded Causation & Hallucinatory Evolution**: Agents mutate rules based on spurious correlation during complex multi-step sessions without isolating whether a rule actually *helped*, *hurt*, or was *contested* by confounding variables.

**EvoKernel solves all five with a deterministic local compiler, worktree evolution engine & routing kernel:**

<div align="center">
  <img src="./assets/gatekeeper-shotcraft.svg" alt="EvoKernel 4-Stage Deterministic Gatekeeper" width="100%" />
</div>

---

## 📊 Comprehensive Competitive Benchmark Matrix

| Dimension | `MemGPT / Letta` | `Aider` | Direct MCP Proxies | `affaan-m/ECC` | `AMAP-ML/SkillClaw` | **🧬 EvoKernel v0.3.0 (Ours)** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Primary Focus** | Stateful conversational agent DB | Git-centric terminal pair programmer | Pass-through MCP aggregation | Static engineering prompt library | Background LLM evolutionary agent | **Deterministic self-evolving meta-kernel for coding agents** |
| **Integration Architecture** | Heavy external service / Postgres / Python daemon | Standalone Python CLI replacing developer IDE | Raw JSON-RPC bridge passing all child tools | Preloaded Markdown templates | Hijacks `/v1/chat` reverse proxy | **Parasitic Meta-MCP + <80-line Seed injected into existing IDEs** |
| **Runtime Dependencies** | Heavy (Postgres, Python, vector DBs) | Python pip packages | Node / Python packages | Zero (plain markdown) | Python FastAPI daemon | **0 Dependencies (Pure Node.js `>= 22.5` built-ins: `node:sqlite`, `node:module`, `node:test`)** |
| **Prompt Cache Stability** | Cache-unfriendly (frequent context shifts) | Varies per edit | **Destructive** (exposing all child tools busts KV prefix on every change) | High context footprint | Neutral | **100% Byte-Stable: Exactly 5 immutable meta-tools exposed to host** |
| **Downstream MCP Virtualization** | None | None | Dumb pass-through (50+ tools in prompt) | None | None | **Zero-cache-invalidation FTS5 index + on-demand stdio JSON-RPC proxy** |
| **Verification & Gatekeeper** | Model self-reflection | Git commit diffs & tests | None | Manual `/learn-eval` | Async LLM reviewer | **4-Stage Deterministic Gatekeeper (Static AST, Sandbox Exit 0, BM25, 1500-tok Cap, Anti-Confounding)** |
| **Offline Worktree Optimization** | None | None | None | None | Cloud LLM evaluations | **`evo optimize`: Isolated Git worktrees, dual `inv`/`dom` cycles, automated probe evaluation & regression rollbacks** |
| **Deliverable Inspection** | None | None | None | None | None | **Zero-dependency canonical parser for `.xlsx`, `.docx`, `.pptx`, CSV, JSON/JSONL, and Markdown** |
| **Episodic Memory & Anti-Drift** | Semantic vector embeddings (hallucination prone) | Repo map only | None | None (static docs) | No AST verification | **Zero-Dep Lexical-Structural Symbol Fingerprinting (Fast regex/lexical AST hash, [STALE] demotion, Topology Penetration Anchors)** |
| **Cockpit & Diagnostic Scoring** | Web UI with Postgres | None | None | None | Web UI | **`evo score` (<40ms zero-cost scan) & `evo ui` (0-dep dark cockpit, SSE live-reload, strict CSP, exportable single-file HTML)** |
| **Causal Telemetry** | None | Git diff size | None | None | Win/loss counter | **Causal outcomes (`helped`, `hurt`, `contested`) with `ERR_CONFOUNDED_CAUSATION` protection** |
| **Multi-Agent Harness Support** | Standalone only | Standalone only | Generic MCP clients | Claude Code / Cursor only | Generic proxy | **10 Native Harnesses (Claude, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, Antigravity)** |
| **Cold-Start Gene Extraction** | Empty until chat sessions accumulate | Git repo scan | Empty | Static catalog | Empty until chat history grows | **`evo bootstrap` mines project stacks + git fixes in <10s** |

---

## 🚀 Offline Git Worktree Optimization Engine (`evo optimize`)

EvoKernel v0.3.0 introduces an autonomous offline capability optimizer. It runs iterative evolution experiments inside **isolated, transient Git worktrees** without risking uncommitted changes in your main workspace:

```bash
# Run offline optimization across both Invariant and Domain dimensions
evo optimize --dim both -k 3

# Run targeted optimization using a session trajectory and deliverable inspector
evo optimize --trajectory session.jsonl --deliverable report.xlsx --apply
```

### Key Engineering Features:
- **Zero Dirty-State Pollution**: Worktrees are allocated under `.evo/.cache/optimize/worktrees/opt-...` and completely cleaned up after each round.
- **Orthogonal Dual-Dimension Evolution**:
  - **Invariant (`inv`)**: Evolves cross-module architectural rules and anti-confounding guards.
  - **Domain (`dom`)**: Evolves domain-specific episodic troubleshooting memories and SOP playbooks.
- **Multi-Harness Trajectory Parsing**:
  - Replays session steps from **Antigravity** (`transcript.jsonl` with double-JSON unquoting), **Codex CLI** (`thread-item`), **OpenCode** (event stream), and **Claude Code** (`stream-json`).
- **Automated Proposer & Isolated Probe Verification**:
  - Runs candidate proposer scripts in the worktree.
  - Executes isolated probe commands to evaluate scores against baseline.
  - Strictly enforces `KEEP_BASE` rollbacks if candidate verification regresses or violates the 4-Stage Gatekeeper.

---

## 📑 Zero-Dependency Deliverable Canonical Consumer-Reader (`deliverable-canonical-inspector`)

<a id="-zero-dependency-architecture"></a>
AI agents frequently generate corrupted deliverables (`.xlsx`, `.docx`, `.pptx`, CSV, JSON, Markdown) that look convincing on the surface but fail downstream consumption. EvoKernel includes a built-in, zero-dependency canonical deliverable validator:

```bash
# Validate any deliverable file directly via top-level CLI:
npx evo-kernel check report.xlsx

# Structured JSON output for CI pipelines:
npx evo-kernel check report.xlsx --json

# Top-level CLI alias:
npx evo-kernel inspect report.xlsx
```

<details>
<summary><b>📋 Supported Deliverable Formats & Validation Rules (Click to expand)</b></summary>

### Comprehensive Format Support:
- **XLSX (.xlsx)**:
  - Custom IEEE 802.3 CRC32 + ZIP central directory decompressor.
  - Normalizes openpyxl leading slashes (`/xl/worksheets/sheet1.xml`).
  - Strips phonetic `<rPh>` runs before extracting cell text.
  - Correctly preserves sibling cells after self-closing XML nodes (`<c .../>`).
  - Detects shared formula follower nodes and flags formula errors (`#REF!`, `#DIV/0!`, `#VALUE!`, `t="e"`).
  - Detects empty sheets and verifies expected table header shape.
- **DOCX (.docx)**:
  - Canonical extraction of paragraphs, headings with spaces (`Heading 1`, `Heading 2`, `Title`), and table cell matrices.
  - Flags `EMPTY_DOCUMENT` defects.
- **PPTX (.pptx)**:
  - Numerically sorts slide decks and formats text into canonical `## Slide N` blocks.
  - Emits warnings on empty individual slides and flags `EMPTY_PRESENTATION`.
- **CSV & JSON / JSONL**:
  - RFC-4180 compliant CSV parser handling escaped quotes and multi-line fields.
  - Validates `requiredKeys`, `strictKeys` per line, and flags `RAGGED_COLUMNS`.
- **Markdown (.md)**:
  - Detects `UNCLOSED_CODE_FENCE` syntax errors.
  - Flags unresolved template placeholder leaks outside code fences:
    ```markdown
    {{VARIABLE}}
    ```
    while safely ignoring valid variables inside fenced code blocks.

</details>

---

## 🛡️ Causal Outcome Attribution & Anti-Confounding Gatekeeper

Most agent frameworks suffer from superstitious learning: an agent adds a rule after a successful run, even though an unrelated file edit was the actual cause of the fix.

EvoKernel solves this with **Deterministic Causal Outcome Attribution**:
- **Outcome Ledger**: Capabilities recalled during a session are classified in SQLite telemetry:
  - `helped`: Directly contributed to successful test passage and zero regressions.
  - `hurt`: Recalled during a failed attempt or reverted commit.
  - `contested`: Recalled during multi-step error recovery loops where multiple variables changed simultaneously.
- **Anti-Confounding Gatekeeper (`ERR_CONFOUNDED_CAUSATION`)**:
  - When multiple capabilities are recalled simultaneously during a bug-fix cycle, EvoKernel blocks single-variable credit assignment.
  - Proposers must supply contrastive evidence or Stage-3 **Topology Penetration Anchors** (concrete file line ranges, caller chains, and negative dead-ends) to prove causation.

---

## 🎯 10-Agent Harness Matrix & Silent-Failure Surface Audit

EvoKernel connects cleanly to 10 major AI coding agent environments with non-destructive marker updates and stealth Git isolation:

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

### Silent-Failure Surface Defenses:
- **BOM Corruption Prevention**: Strips and guards against UTF-8 Byte Order Marks (`0xFEFF`) across all JSON and Markdown parsers.
- **Comment-Preserving Merging**: Losslessly merges TOML (`.codex/config.toml`) and JSON configs without stripping user comments or sibling server definitions.
- **Zero-Build Compilation Fallback**: Routes harnesses through `scripts/boot-mcp.mjs` using native TypeScript stripping, ensuring immediate execution even if `dist/` is unbuilt.
- **Idle Pipe Stdin Resilience**: Safe asynchronous stdin stream handling with 50ms timeout ensures hooks never hang when spawned with open idle stdin pipes in non-TTY environments.

---

## 🪝 Universal Hook Router & Single-Line JSON Guard Hooks

EvoKernel provides a CLI hook router (`evo hook <event>`) for agent lifecycle integration (Claude Code `PostToolUse` / `Stop` hooks, Cursor automation, Antigravity native hooks, and Git pre-commit guards):

```bash
# 1. Post-Tool Hook: Tracks mutations, read-only diagnostics (>=10 reads), & recalls scoped rules
evo hook post-tool --tool Edit --file src/core/storage.ts

# 2. Stop Hook: Emits crystallization reminders (edits, diagnostics, user corrections) & anti-poisoning dirty alerts
evo hook stop

# 3. Pre-Commit Guard: Blocks commits if internal caches are staged or token budget >1500
evo hook pre-commit

# 4. Error Recovery Marker: Records recovery telemetry after command failures
evo hook mark-recovery
```

- **Single-Line JSON Output**: Emits structured hook directives (`hook_trigger`) compatible with all major agent frameworks.
- **Read-Only Diagnostic & Counter-Question Detection**: Prompts experience crystallization on read-only troubleshooting sessions (`>= 10` diagnostic reads with `< 4` edits) or when a user correction / rhetorical counter-question is detected.
- **Anti-Poisoning Alert**: Alerts if source files are modified *after* capability crystallization without re-verification.

---

## 🔌 Downstream MCP Proxy Virtualization

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

```bash
# Preview token savings without modifying files
evo virtualize --dry-run

# Fold all third-party stdio MCPs into EvoKernel's dynamic proxy
evo virtualize

# Losslessly restore virtualized MCP servers back to their original host configs
evo virtualize --restore
```

---

## 🧠 Core Architecture: 5 Fixed Meta-Tools

EvoKernel exposes **exactly 5 immutable meta-tools** over `stdio` to ensure 100% Prompt-Cache retention:

| Meta-Tool | Tier | Purpose |
| :--- | :--- | :--- |
| `evo_search` | **L0** | FTS5 BM25 search across Rules, Skills, Micro-Tools, Virtualized External Tools, and Memories. Performs live Stage-2 AST fingerprint verification and demotes `[STALE]` memories automatically. |
| `evo_inspect` | **L1 / L2** | Progressive disclosure loader. Delivers Symptom/Root-Cause/Solution triads, JSON Schemas for virtualized external tools, and **Topology Penetration Anchors** (live line spans, callers, and negative dead-ends). |
| `evo_run` | **Execution** | Executes local sandboxed Micro-Tools (`.mjs`, `.py`, `.ps1`, `.sh`) or proxies calls to downstream MCP servers via `McpProxyManager`. |
| `evo_propose` | **Evolution** | Submits a candidate Rule, Skill, Micro-Tool, or Memory through the 4-Stage Deterministic Gatekeeper (Static AST, Sandbox Dry-Run, BM25 Deduplication, Token Budget Cap, Anti-Confounding). |
| `evo_compact` | **GC** | Atomically merges fragmented rules or archives `[STALE]` memories into `.evo/archive/` to keep core token consumption under the 1,500-token limit. |

<details>
<summary><b>🌳 View ASCII Self-Evolving Capability Tree (.evo/) Output (Click to expand)</b></summary>

```text
╭──────────────────────────────────────────────────────────────────────────╮
│ 🧬 EvoKernel — Self-Evolving Capability Tree (.evo/)                     │
╰──────────────────────────────────────────────────────────────────────────╯
📦 Workspace: /path/to/your-repo
├── 🛡️  Rules (5 active | Core Token Budget: 286/1500 tokens)
│   ├── [CORE] gatekeeper-self-test-invariant (132 tok | hits: 4) — Every evolved Micro-Tool script must handle --self-test and exit 0.
│   ├── [CORE] esm-typescript-imports (154 tok | hits: 7) — Always use explicit .js extensions on relative imports in ESM TypeScript.
│   ├── [SCOPED] core-architecture-and-ast-invariants-guard (728 tok) — Dry-run compaction, comment-stripped AST matching & Git lookups.
│   ├── [SCOPED] multi-harness-config-and-proxy-isolation (906 tok) — Lossless config merge/restore, fail-closed user configs & proxy roots.
│   └── [SCOPED] workspace-isolation-and-fts5-guard (537 tok) — Isolate uninitialized fallback, parent Git detection & FTS5 search.
├── ⚡ Skills (3 verified L0/L1/L2 playbooks)
│   ├── [SOP] bug-to-guardrail-sop (hits: 3 | tags: debugging,evolution) — Standard workflow to turn a resolved root cause into a Rule.
│   ├── [SOP] evo-dev-verification-sop (hits: 22 | tags: dev,release) — 4-stage TDD, blast-radius check & preflight verification SOP.
│   └── [SOP] evo-rule-architect (hits: 2 | tags: refactor,rules) — 4-stage rule decoupling and budget refactoring workflow.
├── 🔧 Micro-Tools (5 sandboxed scripts | Fixed Meta-MCP Routed)
│   ├── [NODE] agy-config-auditor (runs: 55 | pass: 100%) — Audits host rule budgets and memory AST symbols.
│   ├── [NODE] deliverable-canonical-inspector (runs: 18 | pass: 100%) — Zero-dep validator for .xlsx, .docx, .pptx, CSV, JSON, MD.
│   ├── [NODE] evo-release-preflight (runs: 30 | pass: 100%) — Audits multi-manifest parity and build freshness.
│   ├── [NODE] git-hotspot-analyzer (runs: 5 | pass: 100%) — Identifies top 10 frequently modified files in recent git history.
│   └── [NODE] workspace-metrics-scanner (runs: 13 | pass: 100%) — Scans file counts, LOC, and extension distribution.
└── 🧠 Episodic Memories (18 fault cases | 18 VERIFIED · 0 STALE)
    ├── [VERIFIED] audit-broken-refs-and-hook-param-fix (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] cli-help-zero-side-effect-isolation (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] codex-hooks-corrupt-file-unlink (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] generic-angle-semicolon-multiline-drift (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] ghost-workspace-resurrection-and-sqlite-handle-lock (confidence: HIGH | symbols: 5/5 fresh)
    ├── [VERIFIED] git-fix-387153f (confidence: HIGH | symbols: 3/3 fresh)
    ├── [VERIFIED] git-fix-d0d4e13 (confidence: HIGH | symbols: 3/3 fresh)
    ├── [VERIFIED] harness-hook-filter-preserve-untouched-entries (confidence: HIGH | symbols: 3/3 fresh)
    ├── [VERIFIED] issue-20-global-isolation-and-concept-overlap-fix (confidence: HIGH | symbols: 4/4 fresh)
    ├── [VERIFIED] issue-8-workspace-isolation-and-atomic-compact (confidence: HIGH | symbols: 5/5 fresh)
    ├── [VERIFIED] issues-10-11-12-audit-hook-and-cross-lang-recall (confidence: HIGH | symbols: 7/7 fresh)
    ├── [VERIFIED] memory-verification-inprocess-stat-caching (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] multi-harness-cascaded-detection-and-reversible-teardown (confidence: HIGH | symbols: 8/8 fresh)
    ├── [VERIFIED] open-idle-pipe-stdin-hang-fix (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] score-and-ui-zero-write-csp-and-pool-dedup (confidence: HIGH | symbols: 6/6 fresh)
    ├── [VERIFIED] ui-cli-flags-port-validation-and-powershell-escaping (confidence: HIGH | symbols: 2/2 fresh)
    ├── [VERIFIED] ui-shotcraft-modal-csp-invariant (confidence: HIGH | symbols: 3/3 fresh)
    └── [VERIFIED] worktree-probe-score-improvement (confidence: HIGH | symbols: 2/2 fresh)
```

</details>

---

## 🧪 Comprehensive Verification Suite

EvoKernel features a zero-dependency test suite executed via native Node test runner (`node:test`):

```bash
node ./scripts/test.mjs
```

**274+ tests across 11 test suites pass in ~17 seconds with 0 failures:**

<details>
<summary><b>🔍 View All 11 Verified Test Suites (Click to expand)</b></summary>

| # | Suite File | Coverage Domain | Tests |
| :---: | :--- | :--- | :---: |
| 1 | `dist/tests/bootstrap.test.js` | Bootstrap Cold-Start Expansion & Multi-Stack Gene Mining | 22 tests |
| 2 | `dist/tests/causal-telemetry-and-catalog.test.js` | Causal Telemetry, Outcome Attribution & Dynamic Catalog | 18 tests |
| 3 | `dist/tests/deliverable-inspector.test.js` | Zero-Dep Deliverable Canonical Consumer-Reader Suite | 33 tests |
| 4 | `dist/tests/evo-kernel.test.js` | Core Gatekeeper, Sandbox, AST Cognitive Memory & Invariants | 49 tests |
| 5 | `dist/tests/hook.test.js` | Universal Hook Router & Open-Pipe Stdin Non-Blocking Resilience | 31 tests |
| 6 | `dist/tests/lifecycle-guard-hooks.test.js` | Lifecycle Guard Hooks, Trigger Cues & Reference Integrity | 27 tests |
| 7 | `dist/tests/mcp-proxy.test.js` | Downstream MCP Proxy Virtualization Suite | 10 tests |
| 8 | `dist/tests/multi-harness.test.js` | Multi-Agent Harness Matrix & Cascaded Detection Suite | 14 tests |
| 9 | `dist/tests/optimize.test.js` | Offline Git Worktree Optimization Engine Suite | 19 tests |
| 10 | `dist/tests/score-and-ui.test.js` | Score, Live Cockpit UI, Warmup & Slash Commands Suite | 19 tests |
| 11 | `dist/tests/surface-audit-and-hardening.test.js` | Multi-Harness Silent-Failure Audit Matrix & Hardening Suite | 32 tests |

</details>

---

## 🙏 Acknowledgments & Architecture References

EvoKernel is an independent, from-scratch open-source engineering runtime built in zero-dependency TypeScript on Node.js 22 native modules (`node:sqlite`, `node:test`, `stripTypeScriptTypes`). Its design synthesizes foundational ideas from the agentic systems and software engineering community:

- **Progressive Disclosure & Context Engineering**: The 5 fixed meta-tools (`evo_search`, `evo_inspect`, `evo_run`, `evo_propose`, `evo_compact`) and the L0/L1/L2 tiered loading architecture draw inspiration from Anthropic's engineering guidelines on context window economics, prompt-cache preservation, and progressive skill disclosure.
- **Offline Worktree Rollout & Orthogonal Capability Optimization**: The `evo optimize` offline Git worktree evaluation loop, invariant (`inv`) vs. domain (`dom`) orthogonal exploration, and canonical deliverable verification are informed by recent research on agent harness evaluation, trajectory replay, and automated capability refinement.
- **Original EvoKernel Contributions**: The 4-Stage Deterministic Gatekeeper (Static AST Security, Sandbox `--self-test` Dry-Run, BM25 Deduplication, 1,500-Token Hard Cap, and Causal Anti-Confounding), the 3-Stage AST-Anchored Cognitive Memory with git-topology drift detection (`VERIFIED` / `OTHER_BRANCH` / `STALE`), and the 10-host lossless adapter matrix are original to EvoKernel.

---

## 📄 License

MIT License — see [LICENSE](LICENSE).
