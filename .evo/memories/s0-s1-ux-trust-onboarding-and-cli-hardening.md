---
id: s0-s1-ux-trust-onboarding-and-cli-hardening
title: "S0-S1 UX/DX Overhaul: Zero Fabricated Fallbacks, Responsive Workbench, MCP Startup & CLI Hardening"
l0_summary: "S0-S1 UX & DX overhaul: removed fabricated fallbacks, fixed 1440/mobile UI, skipped _npx cache, hardened CLI & recall receipts."
created_commit: "09f2d69"
created_branch: "main"
target_symbols: ["src/templates/ui-client.ts#renderUiClientHtml","src/cli/visualizer.ts#renderEvoStats","src/cli/score.ts#renderScoreAnsi","src/cli/index.ts#runCli","src/cli/harness.ts#resolveInstalledEvoKernelRoot"]
ast_fingerprints: {"src/templates/ui-client.ts#renderUiClientHtml":{"symbol":"src/templates/ui-client.ts#renderUiClientHtml","file_path":"src/templates/ui/shell.ts","file":"src/templates/ui/shell.ts","kind":"function","start_line":12,"end_line":283,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"5fab41e65bcbf556"},"src/cli/visualizer.ts#renderEvoStats":{"symbol":"src/cli/visualizer.ts#renderEvoStats","file_path":"src/cli/visualizer.ts","file":"src/cli/visualizer.ts","kind":"function","start_line":491,"end_line":589,"signature":"export function renderEvoStats(","ast_hash":"1bca1ed6ca06abe9"},"src/cli/score.ts#renderScoreAnsi":{"symbol":"src/cli/score.ts#renderScoreAnsi","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":1145,"end_line":1289,"signature":"export function renderScoreAnsi(","ast_hash":"d708ec7da55418b8"},"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":1437,"end_line":3741,"signature":"export function runCli(argv: string[]): void | Promise<void>","ast_hash":"67b1d63dabd224cc"},"src/cli/harness.ts#resolveInstalledEvoKernelRoot":{"symbol":"src/cli/harness.ts#resolveInstalledEvoKernelRoot","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":258,"end_line":284,"signature":"export function resolveInstalledEvoKernelRoot(): string | null","ast_hash":"a01aec8f34b9a763"}}
tags: ["ux","workbench","trust","cli","onboarding","mcp"]
origin: "evolved"
supersedes_id: "ux-audit-fabricated-fallbacks-and-pages-leak"
created_at: "2026-11-07T18:55:36.052Z"
updated_at: "2026-11-24T06:56:54.287Z"
---

## Symptom
Workbench and CLI displayed invented fallback KPIs (98, -89%, 100% pass rate, 4 harnesses on empty dirs); 1440px table clipped actions and <=1024px inspector never opened; npx init wrote ephemeral _npx paths or failed in boot-mcp.mjs; unknown CLI commands/flags/extensions exited 0; leading --workspace before subcommand broke hook routing.

## Root Cause
renderTelemetry, renderEvoStats, and renderScoreSvg used hardcoded optimistic defaults; .data-table had min-width 980px without fixed layout and selectItem never toggled .open on #right-inspector; resolveInstalledEvoKernelRoot accepted ephemeral _npx paths and BOOT_MCP_STUB lacked npx fallback; runCli ignored leading flags and exited 0 on unknown commands/workspace/extensions.

## Solution
Replaced fabricated fallbacks with explicit empty markers ('—') and separated measured vs estimated tokens; set table-layout: fixed with responsive column widths and wired .open + #btn-close-inspector on #right-inspector; added isEphemeralNpxCachePath, hasStaleNpxMcpEntry, and BOOT_MCP_STUB npx fallback; added normalizeLeadingFlags, term.ts truncation, multi-host doctor glyphs/verdict, check extension validation, state-aware score actions, and observable recall provenance. Verified by Tests 51-56 (312/312 pass).
