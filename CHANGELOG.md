# Changelog

All notable changes to **EvoKernel (`evo-kernel`)** will be documented in this file.

## [0.5.0] - 2026-11-24

### Added
- **3-Tier Personal User Cognition Engine (`~/.evo/global/`)**:
  - **Tier 1 (`always_on: true` preferences)**: 800-token Profile Card synced cleanly into host global instruction files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, Windsurf, Cursor, OpenCode, etc.) via unified `profile-sync` markers, with `evo profile add/list/remove/undo/export/import` and Workbench 1-Click Undo.
  - **Tier 2 (`always_on: false` preferences & global non-seed skills)**: 250-token On-Demand Task Directory Menu with `trigger_cue` discovery (`evo_search(query, scope: "global")` + `evo_inspect(id, "L2")`).
  - **Tier 3 (`memory_type: "personal"`, `scope: "global"`)**: Cross-workspace personal lessons at 0 startup tokens, treated as `VERIFIED` across `doctor`, `tree --json`, `memory --json`, and `agy-config-auditor`.
- **Semantic Polarity Conflict Guard**: Bilingual polarity conflict detection across verbosity, ordering, confirmation, and comment preferences before pushing into the global Profile Card.
- **`npm run typecheck`**: Added `"typecheck": "tsc --noEmit"` to `package.json`.

### Changed
- **Structural Consolidation**: Extracted `src/core/profile-sync.ts`, `src/core/workbench-actions.ts`, `src/core/hook-engine.ts`, `src/templates/ui/`, and `src/tools/deliverable.ts` (with `isDirectExecution()` guard) to eliminate duplicated host sync, hook attribution, UI template, and deliverable inspector paths.
- **Retired `evo optimize`**: Replaced legacy git-worktree evolution commands with an explicit deprecation notice (`evo optimize help` exits 0; execution commands exit 1).
- **Benchmark & Version Parity**: Bumped all manifests, IDE extension template, docs, and static pages to `0.5.0`, synced live 5-tool MCP schema token footprint (`1,953` tokens; `3,103` base prefix = `88.6%` reduction vs `27,150`), and updated suite metrics to all 15 verified test suites.

### Security & Regression Hardening (Issue #35)
- **Workspace Execution Isolation (C1)**: `antigravity_hook.mjs` and `agy-config-auditor` verify package identity before loading workspace `dist/` code, preventing untrusted repository `dist/` hijacking.
- **Preference Marker & Exfil Guard (C2 + fail-closed `profile-sync`)**: Blocks affirmative destructive commands, exfiltration targets (e.g., `~/.ssh`), prompt injection/secrets in `trigger_cue`, and `<!-- EVO:... -->` marker injection in proposals while allowing prohibitive safety guidance; orphaned `START` markers fail closed without deleting host user prose.
- **Workbench UI Auth & RCE Hardening (C3 & C4)**: Enforces session token auth (`401` without `?token=`), strict CSP (`sha256` + `frame-ancestors 'none'`), `X-Frame-Options: DENY`, escaping `</script>` in embedded tokens, and command-metacharacter / PowerShell interpolation hardening in `launchEditorAtLocation`.
- **Fail-Closed Lifecycle & Path Containment (H2–H13, M2–M6, L4–L7)**: Enforces `pending` preference isolation, cross-supersede budget checks and dead-entry reconciliation on Undo, CLI free-text value flags (`-h`/`-v`), `agy-config-auditor --self-test` isolated fixture, `ext__*` & blank-chat Stop telemetry parity, `LOCAL`->`GLOBAL` archive isolation, `--anon` snapshot scrubbing, `.evo/tools/<id>/` `entry_script` traversal guard, `origin: seed`/`bootstrap` pruning preserving user-authored capabilities, `templates/GEMINI.extension.md` & Antigravity `mcp_config.json` checks, `opencode.json` traversal & corrupt-config fail-closed checks, unbound `target_symbols` freshness warnings, Windsurf zero-drift, `dryRun` zero-write, BOM-tolerant hook stdin, and `profile import --apply` exit code 1 when all items are rejected.

## [0.4.0] - 2026-11-15

### Added
- **EvoKernel Workbench 2.0/2.1/2.2 Overhaul & Native Window Launcher (`evo ui`)**: Overhauled industrial-grade dark-mode Workbench with interactive SVG Memory & Symbol Topology Constellation, 2D Proportional Context Budget Treemap, `/api/action` Control API for in-browser capability mutation and re-audit, and `--desktop`/`--app` native micro-window launcher with automatic platform app wrapper detection and browser fallback.
- **Zero-Dependency Deliverable Verification CLI (`evo check`)**: Standalone deliverable conformance CLI verifying `.xlsx`, `.docx`, `.pptx`, CSV, JSON/JSONL, and Markdown files against strict canonical standards without external office, python, or heavy npm dependencies.
- **S0–S3 Golden Onboarding Path & Live 5-Tool MCP Doctor Handshake (`evo doctor`, `evo init`)**: Deterministic diagnostic pipeline executing live stdio JSON-RPC handshake against the 5 fixed meta-tools (`evo_search`, `evo_inspect`, `evo_run`, `evo_propose`, `evo_compact`), validating version parity, detecting stale/ephemeral `_npx` cache paths, and providing structured next steps.
- **Observable Recall Provenance & Telemetry Ledger (`evo stats`)**: Granular `recall_events` attribution tracking incremental `search`, `inspect`, and `run` invocations across sessions with visible 1-line recall receipts (`🛡️ EvoKernel Recall`), eliminating ghost hits and unverified backfills.
- **VS Code Cockpit Extension (`damonless.evo-kernel-cockpit`)**: Official companion extension featuring parent/umbrella and `git:` diff workspace resolution, quick-pick action bar, live AST status indicators, and reversible `--unmount-ide` harness isolation.
- **Expanded AST Episodic Memories**: Added verified memories for multi-harness edge cases, ghost workspace SQLite locks, and lexical AST parser resilience, bringing repository memory coverage to 41/41 AST-verified fault cases (`41/41 VERIFIED · 0 STALE`).

### Changed
- **`evo_propose` Gatekeeper Hardening & Anti-Poisoning**: Enforced schema inheritance verification, AST anti-poisoning guards, `skeleton_hash` validation, and a `low_overlap` filter to prevent low-signal rule fragmentation while maintaining the strict 1,500-token core rule budget.
- **10-Harness Matrix Isolation**: Hardened lossless integration across Claude Code, Cursor, Windsurf, Cline, Roo, Copilot, Codex, OpenCode, Gemini, and Antigravity, preventing cross-harness config contamination and silent registration failures.
- **Comprehensive Verification Suite**: Expanded zero-dependency test suite to 336 tests across 11 test suites passing deterministically with 0 failures (`336 passed | 11 suites`).
- **Context Health Score**: Attained perfect 100/100 (A+) context health grade with ~1.2ms live AST memory verification latency.

### Fixed
- **Windows `cmd.exe` Caret Escaping & Version-Pinned MCP Launcher (`boot-mcp.mjs`)**: Escaped Windows `%VAR%` variables and cmd.exe carets during MCP process invocation; pinned exact `evo-kernel` package version in boot scripts to prevent version mismatch drift.
- **Multi-Language Lexical AST Parser & Non-ASCII Rollback**: Hardened lexical skeleton fingerprinting across polyglot C/C++, TypeScript, Rust, and Python codebases; guaranteed clean unlinking and rollback of untracked non-ASCII files upon test/sandbox failures.
- **Cross-Platform CI & Positive Tarball Allowlists**: Enforced strict positive allowlists in `package.json` `files` and GitHub Actions CI workflows, preventing dev scripts, test fixtures, and internal benchmarks from leaking into the published npm tarball.

## [0.3.0] - 2026-11-04

### Added
- **Interactive SVG Memory & Symbol Topology Constellation (`evo ui`)**: Live node-link constellation mapping `.evo/` Episodic Memories, AST Structural Fingerprints, Source Files, and Evolved Rules with instant click-to-inspect drawer, search/filter bar, and bilingual (`EN / 中文`) UI toggle.
- **2D Proportional Context Budget Treemap (`evo ui`)**: Visualizes Active MCP Tax vs. Pooled MCPs, Virtualized L1/L2 Rules & Skills, 0-Core-Cost AST Memories, and Always-On L0 Seed.
- **Vector Dual X-Ray Diagnostic Card Exporter (`evo score --svg <path>`)**: Generates self-contained, dark-mode SVG diagnostic cards and badges directly from repository health metrics.
- **Reproducible 50-Turn Benchmark Suite (`npm run benchmark`)**: Quantifies MCP Tool Schema Tax reduction (`-94.4%`, `27,150 -> 1,530 tok/turn`), 8-Server Full Static Prefix reduction (`-88.7%`, `27,150 -> 3,066 tok/turn`), Prompt-Cache prefix stability (`100% KV cache hit / 0 schema invalidations`), API cost savings (`-70.4%`), and live AST memory verification (`~0.32ms/memory`, `<11ms` across 34 memories). Supported by a verified test suite of **306+ passed | 11 suites**.
- **Composite GitHub Action (`action.yml`)**: Run `uses: damonless/EvoKernel@main` in CI to audit Context Health & Fragility Hotspots and publish X-Ray summaries to GitHub Actions Job Summaries.
- **Node.js `>=22.5.0` Pre-Flight Runtime Guard & `evo --version`**: Friendly diagnostic guidance for developers on older Node versions.

### Fixed
- **Per-Host Seed Token Accounting (`evo score`)**: Prevents multiplying `evoSeedTokens` across multiple host adapter files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/evo-kernel.mdc`) and includes virtualized L1/L2 skills, micro-tools, and memories in baseline savings calculation.
- **Hotspot Precision (`computeGitBugHotspots`)**: Excludes test harnesses (`*.test.ts`), static docs, and seed template mirrors from production code fragility penalties, and supports brace-expanded `scope_glob` matching (`src/{cli,mcp}/**/*.ts`).
- **npm Tarball README Resolution**: Excludes `README.zh-CN.md` from npm tarball packing so npmjs.com always renders the primary English `README.md`.

## [0.2.0] - 2026-11-01

### Added
- **Offline Git Worktree Optimization Engine (`evo optimize`)**: Autonomous dual-dimension (`inv` & `dom`) capability evolution inside isolated Git worktrees with trajectory replay, canary guards, and Pareto regression rollbacks.
- **Zero-Dependency Deliverable Canonical Inspector (`deliverable-canonical-inspector`)**: Built-in IEEE 802.3 CRC32 + ZIP reader and validator for `.xlsx`, `.docx`, `.pptx`, CSV, JSON/JSONL, and Markdown deliverables.
- **Diagnostic Scoring (`evo score`), Live Cockpit (`evo ui`), Cold-Start Warmup & Slash Commands**: Instant repository X-Ray, strict SHA-256 CSP offline HTML export, and multi-marketplace manifests (`server.json`, `.claude-plugin`, `.cursor-plugin`, `gemini-extension.json`).

## [0.1.0] - 2026-10-29

### Added
- Initial release of EvoKernel: 4-Stage Deterministic Gatekeeper, 5-Tool Meta-MCP Gateway (`evo_search`, `evo_inspect`, `evo_run`, `evo_propose`, `evo_compact`), Zero-Dependency Lexical-Structural AST Memory Fingerprinting, Downstream MCP Virtualization (`evo virtualize`), and 10-Harness Adapter Matrix.
