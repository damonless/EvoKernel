# Changelog

All notable changes to **EvoKernel (`evo-kernel`)** will be documented in this file.

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
