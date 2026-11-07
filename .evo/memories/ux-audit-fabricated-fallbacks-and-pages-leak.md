---
id: ux-audit-fabricated-fallbacks-and-pages-leak
title: "UX audit: fabricated fallback metrics, Pages snapshot leak, dead narrow-screen inspector"
l0_summary: "UX audit: invented fallback KPIs, --anon export leaking script paths/local skills, inspector drawer never opened by JS."
created_commit: "0d6f4e2"
created_branch: "main"
target_symbols: ["src/templates/ui-client.ts#renderUiClientHtml","src/cli/visualizer.ts#renderEvoStats","src/cli/ui.ts#buildUiSnapshot","src/cli/index.ts#runCli"]
ast_fingerprints: {"src/templates/ui-client.ts#renderUiClientHtml":{"symbol":"src/templates/ui-client.ts#renderUiClientHtml","file_path":"src/templates/ui-client.ts","file":"src/templates/ui-client.ts","kind":"function","start_line":7,"end_line":4157,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"8bef09b8c1e03562"},"src/cli/visualizer.ts#renderEvoStats":{"symbol":"src/cli/visualizer.ts#renderEvoStats","file_path":"src/cli/visualizer.ts","file":"src/cli/visualizer.ts","kind":"function","start_line":119,"end_line":192,"signature":"export function renderEvoStats(workspaceRoot: string): string","ast_hash":"15641d8bc139972f"},"src/cli/ui.ts#buildUiSnapshot":{"symbol":"src/cli/ui.ts#buildUiSnapshot","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":37,"end_line":132,"signature":"export function buildUiSnapshot(","ast_hash":"5420fa2467a2c52e"},"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":586,"end_line":1158,"signature":"export function runCli(argv: string[]): void","ast_hash":"131ce4fb5aa632e4"}}
tags: ["ux","workbench","trust","pages","cli","audit"]
origin: "evolved"
review_status: "pending"
created_at: "2026-11-07T18:55:36.052Z"
updated_at: "2026-11-07T18:55:36.052Z"
---

## Symptom
Workbench shows health 98 / savings -89 when data missing; evo stats prints 100% pass rate, 'Prompt Cache 100%', and four harnesses on empty dirs; docs/index.html (exported with --anon) contains 5 absolute user-profile paths and local-only skills; at <=1024px the right inspector never appears; at 1440px action columns overflow; unknown CLI commands/flags exit 0.

## Root Cause
renderTelemetry uses literal defaults; renderEvoStats hard-codes fallbacks and a formula-based token estimate; anon mode only scrubs score/workspace root while buildUiSnapshot passes tools/skills (script_path) through; CSS defines .right-inspector.open but no JS adds the class; data table has min-width 980px without fixed layout; runCli default branch prints help and exits 0.

## Solution
Plan (not yet implemented): replace fallbacks with empty markers; extend anon scrubbing in buildUiSnapshot (strip script_path, relativize paths, filter non-seed skills); switch Pages source to Actions before untracking docs/index.html; toggle .open on row select; table-layout fixed; warn-then-fail strict CLI parsing exempting hook/mcp. Full plan in conversation artifact evokernel_ux_product_audit.md.
