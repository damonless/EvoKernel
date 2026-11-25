# Project: EvoKernel Workbench 2.0 Overhaul (Issue #21)

## Architecture
- **Zero Runtime Dependencies**: Strict zero-npm-dependency invariant. Pure Node.js built-ins (`node:http`, `node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:url`) + ES2022.
- **Presentation Layer (`src/templates/ui-client.ts` -> `src/templates/ui/`)**: Originally a monolithic generator for EvoKernel Workbench 2.0, now modularized behind the `src/templates/ui-client.ts` barrel facade into `src/templates/ui/{shell,styles,i18n,components-capabilities,components-profile,client-script}.ts`.
  - Visual system: Zinc dark tokens (`--bg-canvas: #09090b`, `--text-primary: #fafafa`, `--border-subtle: #27272a`), `cult-ui` Bento 1px inset highlights, `motion-primitives` spring transitions (`cubic-bezier(0.22, 1, 0.36, 1)`).
  - 3-column layout: Left navigation rail (220px) with telemetry Bento; Center Stage (flex 1) with **5 views** (Capabilities, Personal Profile, Code Map with focus dimming, Git Hotspots with inline Add Lesson drawer, Safety Check Log with clickable entries); Right Structured Inspector (380px) with locked action toolbar, code anchors, structured per-kind inline editor, sandbox terminal; `Cmd/Ctrl+K` Command Palette.
  - CSP compliance: Strict script SHA-256 hash, zero inline `on*=` handlers, zero native `confirm()`.
- **Backend & Control Layer (`src/cli/ui.ts`, `src/core/workbench-actions.ts`)**:
  - `POST /api/action` endpoint unified via `executeWorkbenchAction` handling **15 core actions**: `open-editor`, `verify-memory`, `rebind-memory-ast`, `run-tool-test`, `archive-item`, `restore-item`, `approve-item`, `toggle-enabled`, `toggle-rule-tier`, `update-content`, `create-preference`, `create-memory`, `undo-preference`, `sync-profile`, `import-profile-markdown`, plus `export-html` in IDE Webview.
  - Security boundaries: 127.0.0.1 binding, Host validation, Sec-Fetch-Site 403 block, X-Evo-UI-Token authentication, `isSubpathOf` directory traversal guard, 1500-token core rule budget limit, 800-token Always-On Profile Card & 250-token Task Directory Menu caps, 5000ms sandbox timeout.
  - Live watchers in BOTH Web (`src/cli/ui.ts`) and VS Code Webview (`src/ide/vscode-extension.ts`): project `.evo/`, global `~/.evo/global/.evo/`, `.git/HEAD`, and memory-linked source files.
  - 3-Tier Personal Cognition & Profile Studio (`src/core/profile-sync.ts`, `src/templates/ui/components-profile.ts`): Cross-workspace preferences (`style | formatting | communication | workflow | requirement | knowledge`), Tier 2 On-Demand Task Directory Menu, Tier 3 global `memory_type: "personal"` memories, and atomic `batch_id` 1-click undo (`profile-history.jsonl` / `evo profile undo` / `evo_propose(undo: true)`).
  - Native micro-window launcher: Edge/Chrome `--app` chromeless window with system browser fallback.
- **IDE Extension & Integration Layer (`src/ide/vscode-extension.ts`, `src/cli/init.ts`)**:
  - Zero-dependency VS Code / Cursor / Windsurf / Antigravity extension entry point with WebviewPanel (`IDE Sync` status, `ViewColumn.Beside` code jump, anonymize/full HTML export) and bidirectional messaging bridge.
  - Auto-mount during `evo init` / `evo ui --install-ide` into `~/.vscode/extensions`, `~/.cursor/extensions`, etc.
- **Quality & Verification Layer (`src/tests/`, `benchmarks/context-tax-benchmark.mjs`)**:
  - 17 native `node:test` suites (400+ tests) covering Gatekeeper, AST memory, Multi-Harness, MCP proxy, Profile Sync, Workbench UI/Actions/Security, and P0–P2 UX & Reliability acceptance criteria.

## v0.5 Architecture & Personal Profile Studio (Slim Dual-Core + 3-Tier Offline User Cognition)
- **Dual-Core Separation**:
  - **Layer 1 (Repo-Scoped Engineering Memory, `.evo/`)**: AST-verified memories across Git branches, strict `1,500`-token core invariants budget, path-scoped guardrails (`scope_glob`), and `--self-test` sandboxed micro-tools.
  - **Layer 2 (Cross-Workspace 3-Tier Offline User Cognition, `~/.evo/global/.evo/`)**:
    1. **Tier 1 — Always-On Profile Card (`800`-token full-rendered budget)**: `always_on: true` preferences (`style | formatting | communication | workflow | requirement | knowledge`) pushed via `<!-- EVO:PROFILE:START -->...<!-- EVO:PROFILE:END -->` to 8 desktop AI hosts (`~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, `~/.codex/AGENTS.md`, `~/.codeium/windsurf/memories/global_rules.md` with 6,000-char guard, `~/.cursor/rules/evo-user-profile.mdc`, `~/.cline/rules/evo-user-profile.md`, `~/.roo/rules/evo-user-profile.md`, `~/.config/opencode/AGENTS.md`).
    2. **Tier 2 — Live Task & Workflow Directory Menu (`250`-token cap)**: `always_on: false` preferences + non-seed global skills with `trigger_cue`, rendered alongside the Profile Card for semantic `evo_inspect(id, "L2")` recall.
    3. **Tier 3 — Global Personal Experience Memory (`memory_type: "personal"`)**: Cross-workspace lessons stored without AST symbol binding (`[PERSONAL]`), searchable via expanded bilingual office/writing/workflow lexicon in `src/core/lexicon.ts`.
- **4A Instant Activation + 1-Second Undo**: Explicit `evo_propose` / CLI / Workbench preference mutations activate immediately (`review_status: "approved"`), append snapshots to `~/.evo/global/.evo/profile-history.jsonl`, and support 1-click undo (`evo profile undo` & Workbench `undo-preference`).
- **Zero-Friction Global Install & Cold Start**: `evo init --global` (`runInitGlobal`), `evo uninstall --global` (`cleanGlobalUserProfile` + `runUninstall`), full `evo profile` CLI (`show | list | add | remove | sync | undo | import | onboard | clean | path`) powered by `src/core/profile-sync.ts` and `src/core/profile-import.ts` (`parseMarkdownToPreferenceCandidates`, `ONBOARDING_PRESETS`, `getOnboardingPresetCandidates`), and optional `workspace` across all 5 `META_MCP_TOOLS` (`evo_search`, `evo_inspect`, `evo_run`, `evo_propose`, `evo_compact`) for blank/non-code chats.
- **Personal Profile Studio (`src/templates/ui/components-profile.ts`, `src/core/workbench-actions.ts`)**: Dedicated Workbench view (`#view-profile`) with live 800-tok Profile Card & 250-tok Task Directory Menu meters, 8-host sync badges, Recent Changes 1-click undo bar, inline Create/Edit preference drawer, Markdown import preview/apply, and unified `POST /api/action` handlers (`create-preference`, `undo-preference`, `sync-profile`, `import-profile-markdown`, `restore-item`, `approve-item`, `toggle-enabled`, `rebind-memory-ast`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Zinc Dark Theme Tokens | Replace neon green with Zinc dark scale (`#09090b` to `#fafafa`) and 1px subtle borders | M2 | Issue #21 §3.1 |
| 2 | Cult-UI Surface Highlights | Micro-inset top highlight (`inset 0 1px 0 0 rgba(255,255,255,0.05)`) on Bento containers | M2 | Issue #21 §3.1 |
| 3 | Motion-Primitives Curves | Spring transitions `cubic-bezier(0.22, 1, 0.36, 1)` for pills, dialogs, and dimming | M2 | Issue #21 §3.1 |
| 4 | 3-Column Skeleton Layout | Fixed 100vh layout with 44px topbar, 220px left rail, center stage, 380px right inspector | M2 | Issue #21 §3.2 |
| 5 | Left Navigation & Bento Rail | View switcher (Capabilities, Topology, Hotspots, Gatekeeper) + Health/Tax/Budget metrics | M2 | Issue #21 §3.2 |
| 6 | Center Capabilities Data Table | High-density data table with kind/status filters, metadata tags, and quick actions | M2 | Issue #21 §3.2 |
| 7 | Center Orthogonal Card Topology | 3-column card topology (Rules -> Memories -> Files) replacing legacy radial radar | M2 | Issue #21 §3.2 |
| 8 | Topology Focus Dimming | Hover/select dims unrelated nodes to 0.2 opacity and highlights connected paths | M2 | Issue #21 §3.2 |
| 9 | Center Git Hotspots View | Fragility score table, fix commit counts, bound memory chips, jump-to-source | M2 | Issue #21 §3.2 |
| 10 | Center Gatekeeper Audit Stream | 6-stage gatekeeper proposal audit timeline and diagnosis inspection | M2 | Issue #21 §3.2 |
| 11 | Right Structured Inspector | Detailed inspector replacing `<pre>` drawer: actions, AST anchors, markdown/editor | M2 | Issue #21 §3.2 |
| 12 | AST Anchor Code Jump | Clickable `filePath#symbol` anchors invoking editor jump | M2 | Issue #21 §3.2 |
| 13 | Inspector Inline Editor | Inline textarea and save button to edit rules, memories, and skills markdown | M2 | Issue #21 §3.2 |
| 14 | Inspector Sandbox Terminal | Live `--self-test` execution output, duration, and exit code for tools | M2 | Issue #21 §3.2 |
| 15 | Cmd/Ctrl+K Command Palette | Backdrop blur modal with keyboard navigation, fuzzy search, and quick commands | M2 | Issue #21 §3.3 |
| 16 | POST /api/action Endpoint | Unified backend HTTP POST route with token authentication and JSON body parsing | M1 | Issue #21 §4 |
| 17 | Action: open-editor | Traversal-guarded editor invocation (`code --goto`, `cursor --goto`, etc.) | M1 | Issue #21 §4 |
| 18 | Action: verify-memory | Live AST freshness recomputation for single memory or all memories | M1 | Issue #21 §4 |
| 19 | Action: run-tool-test | Sandboxed `--self-test` execution with 5s timeout and env sanitization | M1 | Issue #21 §4 |
| 20 | Action: archive-item | Safe capability archival to `.evo/archive/` and FTS5 SQLite index update | M1 | Issue #21 §4 |
| 21 | Action: toggle-rule-tier | Core <-> Scoped rule promotion/demotion with 1500-token budget guard | M1 | Issue #21 §4 |
| 22 | Action: update-content | Online modification of Rule/Memory/Skill Markdown with AST fingerprinting | M1 | Issue #21 §4 |
| 23 | API Traversal Protection | `isSubpathOf` boundary checks on file paths in all API actions | M1 | Issue #21 §4 |
| 24 | Chromeless Micro-Window Launcher | `--app` flag launching Edge/Chrome in application window mode with fallback | M1 | Issue #21 §2.1 |
| 25 | Windows ESM Scheme Bug Fix | Convert absolute file paths to `pathToFileURL` in `context-tax-benchmark.mjs` | M1 | Issue #21 §5.4 |
| 26 | IDE Extension Module | Zero-dependency VS Code extension entry point `src/ide/vscode-extension.ts` | M3 | Issue #21 §2.2 |
| 27 | IDE Extension Auto-Mounting | Auto-symlink/copy extension into `~/.vscode/extensions` etc. in `src/cli/init.ts` | M3 | Issue #21 §2.2 |
| 28 | Dual-Mode Webview Bridge | Seamless message bridging between VS Code `postMessage` and HTTP API | M2 | Issue #21 §2.2 |
| 29 | Modernized Test Suite (Test 5) | Update `src/tests/score-and-ui.test.ts` to assert Workbench 2.0 DOM IDs and tokens | M4 | Issue #21 §5.5 |
| 30 | Comprehensive Action API Tests | Unit tests in `score-and-ui.test.ts` for all 6 actions and security bounds | M4 | Issue #21 §5.5 |
| 31 | Full Baseline Regression Pass | 100% pass across all 17 test suites (400 tests) via `node ./scripts/test.mjs` | M4 | R3 & AC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend Action API & CLI Launcher | `src/cli/ui.ts`, `benchmarks/context-tax-benchmark.mjs` | none | DONE |
| M2 | Frontend Workbench 2.0 Overhaul | `src/templates/ui-client.ts` | M1 (Interface Contracts) | DONE |
| M3 | IDE Extension & Auto-Mounting | `src/ide/vscode-extension.ts`, `src/cli/init.ts` | M1 | DONE |
| M4 | Comprehensive Testing & Audit | `src/tests/score-and-ui.test.ts` | M1, M2, M3 | DONE |
| M5 | Final E2E Suite Pass & Git Remote Push | Verification, Git commit, `git push origin main` | M4 | DONE |

## Interface Contracts
### Frontend UI (`src/templates/ui-client.ts`) <-> Backend Server (`src/cli/ui.ts`)
- **Protocol**: HTTP POST to `/api/action` with header `X-Evo-UI-Token: <token>` and `Content-Type: application/json`.
- **Request Format**:
  ```json
  {
    "action": "open-editor" | "verify-memory" | "run-tool-test" | "archive-item" | "toggle-rule-tier" | "update-content",
    "params": { ... }
  }
  ```
- **Response Format**:
  - Success: `200 OK` with JSON `{ "ok": true, "data": { ... } }`
  - Error: `400 Bad Request` or `403 Forbidden` or `500 Internal Error` with `{ "ok": false, "error": "<reason>" }`
- **Actions & Params**:
  1. `open-editor`: `{ "filePath": string, "line"?: number }` -> `{ "ok": true }`
  2. `verify-memory`: `{ "id"?: string }` -> `{ "ok": true, "snapshot": { ... } }`
  3. `run-tool-test`: `{ "id": string }` -> `{ "ok": true, "result": { "exitCode": number, "stdout": string, "stderr": string, "durationMs": number } }`
  4. `archive-item`: `{ "kind": "rule"|"skill"|"tool"|"memory", "id": string }` -> `{ "ok": true }`
  5. `toggle-rule-tier`: `{ "id": string, "core": boolean }` -> `{ "ok": true, "tokenUsage": number }` (enforces 1500 tokens on core=true)
  6. `update-content`: `{ "kind": string, "id": string, "content": string }` -> `{ "ok": true }`

### Webview Host (`src/ide/vscode-extension.ts`) <-> UI Client (`src/templates/ui-client.ts`)
- **Protocol**: `window.acquireVsCodeApi().postMessage(msg)` and `window.addEventListener("message", ...)`.
- **Message Format**: `{ "type": "evoAction", "action": string, "params": any }` -> response `{ "type": "evoActionResult", "action": string, "data"?: any, "error"?: string }`.

## Code Layout
- `src/cli/ui.ts`: HTTP Server, `/api/action` router, `--app` chromeless window spawner. (Owned exclusively by M1)
- `benchmarks/context-tax-benchmark.mjs`: Benchmark script, Windows ESM URL pathing. (Owned exclusively by M1)
- `src/templates/ui-client.ts` & `src/templates/ui/`: Workbench UI barrel facade and modular template generators (incl. `components-profile.ts` for Personal Profile Studio).
- `src/core/profile-sync.ts`, `src/core/profile-import.ts`, `src/core/workbench-actions.ts`: v0.5 8-host profile synchronization, Markdown import & onboarding presets, and unified Workbench action handlers. (Owned exclusively by M2)
- `src/ide/vscode-extension.ts`: VS Code extension entry point. (Owned exclusively by M3)
- `src/cli/init.ts`: CLI init command, IDE extension auto-linking. (Owned exclusively by M3)
- `src/tests/score-and-ui.test.ts`: Automated tests for UI, actions, and IDE. (Owned exclusively by M4)
