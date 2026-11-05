# Project: EvoKernel Workbench 2.0 Overhaul (Issue #21)

## Architecture
- **Zero Runtime Dependencies**: Strict zero-npm-dependency invariant. Pure Node.js built-ins (`node:http`, `node:fs`, `node:path`, `node:child_process`, `node:crypto`, `node:url`) + ES2022.
- **Presentation Layer (`src/templates/ui-client.ts`)**: Monolithic self-contained HTML/CSS/JS generator for EvoKernel Workbench 2.0.
  - Visual system: Zinc dark tokens (`--bg-canvas: #09090b`, `--text-primary: #fafafa`, `--border-subtle: #27272a`), `cult-ui` Bento 1px inset highlights, `motion-primitives` spring transitions (`cubic-bezier(0.22, 1, 0.36, 1)`).
  - 3-column layout: Left navigation rail (220px) with telemetry Bento; Center Stage (flex 1) with 4 views (Capabilities Data Table, Orthogonal Card Topology with focus dimming, Git Hotspots, Gatekeeper Audit Stream); Right Structured Inspector (380px) with action toolbar, AST anchors, markdown preview/editor, sandbox terminal; `Cmd/Ctrl+K` Command Palette.
  - CSP compliance: Strict script SHA-256 hash, zero inline `on*=` handlers.
- **Backend & Control Layer (`src/cli/ui.ts`)**:
  - `POST /api/action` endpoint handling 6 core actions: `open-editor`, `verify-memory`, `run-tool-test`, `archive-item`, `toggle-rule-tier`, `update-content`.
  - Security boundaries: 127.0.0.1 binding, Host validation, Sec-Fetch-Site 403 block, X-Evo-UI-Token authentication, `isSubpathOf` directory traversal guard, 1500-token core rule budget limit, 5000ms sandbox timeout.
  - Native micro-window launcher: Edge/Chrome `--app` chromeless window with system browser fallback.
- **IDE Extension & Integration Layer (`src/ide/vscode-extension.ts`, `src/cli/init.ts`)**:
  - Zero-dependency VS Code / Cursor / Windsurf / Antigravity extension entry point with WebviewPanel and bidirectional messaging bridge.
  - Auto-mount during `evo init` / `evo ui --install-ide` into `~/.vscode/extensions`, `~/.cursor/extensions`, etc.
- **Quality & Verification Layer (`src/tests/score-and-ui.test.ts`, `benchmarks/context-tax-benchmark.mjs`)**:
  - Modernized Test 5 for Workbench 2.0 layout & tokens; new unit tests for all 6 action types and security perimeters; Windows ESM `pathToFileURL` fix.

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
| 10 | Center Gatekeeper Audit Stream | 4-stage gatekeeper proposal audit timeline and diagnosis inspection | M2 | Issue #21 §3.2 |
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
| 31 | Full Baseline Regression Pass | 100% pass across all 11 test suites (274+ tests) via `node ./scripts/test.mjs` | M4 | R3 & AC |

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
- `src/templates/ui-client.ts`: Monolithic Workbench 2.0 template generator. (Owned exclusively by M2)
- `src/ide/vscode-extension.ts`: VS Code extension entry point. (Owned exclusively by M3)
- `src/cli/init.ts`: CLI init command, IDE extension auto-linking. (Owned exclusively by M3)
- `src/tests/score-and-ui.test.ts`: Automated tests for UI, actions, and IDE. (Owned exclusively by M4)
