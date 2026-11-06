---
id: workbench2-test5-excised-promotional-elements
title: "Test 5 failure from excised promotional elements in Workbench 2.0"
l0_summary: "Test 5 fails asserting #btn-watch-film because Cockpit 1.0 promotional gadgets were excised in Workbench 2.0 overhaul."
created_commit: "1c798cc"
created_branch: "main"
target_symbols: ["exportUiHtml","renderUiClientHtml"]
ast_fingerprints: {"exportUiHtml":{"symbol":"exportUiHtml","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":1492,"end_line":1517,"signature":"export function exportUiHtml(","ast_hash":"df2d2c6c10366863"},"renderUiClientHtml":{"symbol":"renderUiClientHtml","file_path":"src/templates/ui-client.ts","file":"src/templates/ui-client.ts","kind":"function","start_line":7,"end_line":4157,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"8bef09b8c1e03562"}}
tags: ["testing","workbench2","ui-export","modernization"]
origin: "evolved"
created_at: "2026-11-05T08:50:08.610Z"
updated_at: "2026-11-06T17:04:58.699Z"
---

## Symptom
AssertionError: Exported HTML must contain #btn-watch-film action button at score-and-ui.test.ts:232

## Root Cause
Milestone 2 overhauled src/templates/ui-client.ts to Workbench 2.0 with 3-column layout and Zinc dark tokens, excising legacy Cockpit 1.0 promotional elements. Test 5 in score-and-ui.test.ts retained obsolete assertions.

## Solution
Modernize Test 5 to assert 9 Workbench 2.0 DOM IDs (#topbar, #left-rail, etc.) and Zinc dark design tokens while preserving CRLF and CSP checks.
