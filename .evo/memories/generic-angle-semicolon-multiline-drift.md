---
id: generic-angle-semicolon-multiline-drift
title: "Generic Angle Type Literal Semicolon and Multiline Drift"
l0_summary: "Fix generic angle skipping on semicolons in type literals and multiline defaults"
created_commit: "09e84df"
created_branch: "main"
target_symbols: ["trySkipGenericAngles","findBraceBlockEnd"]
ast_fingerprints: {"trySkipGenericAngles":{"symbol":"trySkipGenericAngles","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":262,"end_line":304,"signature":"export function trySkipGenericAngles(masked: string, pos: number): number","ast_hash":"a8789308694f4709"},"findBraceBlockEnd":{"symbol":"findBraceBlockEnd","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":1234,"end_line":1457,"signature":"export function findBraceBlockEnd(","ast_hash":"3c6ee462d9fa4b08"}}
tags: []
origin: "evolved"
created_at: "2026-11-02T03:04:44.814Z"
updated_at: "2026-11-03T05:27:25.692Z"
---

## Symptom
Functions with generic type defaults like <T = { a: number; b: string }> truncated to line 0

## Root Cause
trySkipGenericAngles aborted on semicolon even when braceDepth > 0, and multiline generic angle jumping did not re-bind mLines[i] line reference

## Solution
Check braceDepth === 0 on semicolon, scan joined lookahead for multiline generic parameter lists, and rebind line and column offsets
