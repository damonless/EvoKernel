---
id: workbench-typography-and-github-showcase-sync
title: "workbench-typography-and-github-showcase-sync"
l0_summary: "Modernize Workbench UI typography stack, fix button fonts, and sync GitHub Pages/README showcase."
created_commit: "540dc0f"
created_branch: "main"
target_symbols: ["renderUiClientHtml","exportUiHtml"]
ast_fingerprints: {"renderUiClientHtml":{"symbol":"renderUiClientHtml","file_path":"src/templates/ui-client.ts","file":"src/templates/ui-client.ts","kind":"function","start_line":7,"end_line":5770,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"88b58f2f81597d22"},"exportUiHtml":{"symbol":"exportUiHtml","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":1885,"end_line":1910,"signature":"export function exportUiHtml(","ast_hash":"df2d2c6c10366863"}}
tags: []
origin: "evolved"
created_at: "2026-11-05T17:18:41.042Z"
updated_at: "2026-11-11T08:48:10.746Z"
---

## Symptom
Workbench UI fonts looked uneven and ugly on Windows/SVG nodes, and GitHub repository retained old promotional assets and 404 Pages link without Workbench 2.0 sync.

## Root Cause
UI client template previously used legacy Consolas/monospace fallback which defaulted to Courier New on Windows SVG nodes and applied monospace font to Chinese action buttons, causing visual deformation; meanwhile GitHub Pages lacked static docs/ export and README retained obsolete v0.3.0 Live Cockpit showcase assets.

## Solution
Upgraded UI font stack to modern Inter/Segoe UI Variable/Cascadia Code/JetBrains Mono with PingFang/YaHei CJK fallback; restored sans-serif typography for interactive buttons and labels; exported clean offline Workbench 2.0 to docs/index.html and updated README showcase to assets/workbench-showcase.svg.
