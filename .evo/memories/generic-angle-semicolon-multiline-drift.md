---
id: generic-angle-semicolon-multiline-drift
title: "Generic Angle Type Literal Semicolon and Multiline Drift"
l0_summary: "Fix generic angle skipping on semicolons in type literals and multiline defaults"
created_commit: "18dae2b"
created_branch: "main"
target_symbols: ["trySkipGenericAngles","findBraceBlockEnd"]
ast_fingerprints: {"trySkipGenericAngles":{"symbol":"trySkipGenericAngles","file_path":"src/core/memory/lexical-mask.ts","file":"src/core/memory/lexical-mask.ts","kind":"function","start_line":14,"end_line":56,"signature":"export function trySkipGenericAngles(masked: string, pos: number): number","ast_hash":"1d46309b635963b2"},"findBraceBlockEnd":{"symbol":"findBraceBlockEnd","file_path":"src/core/memory/symbol-extractor.ts","file":"src/core/memory/symbol-extractor.ts","kind":"function","start_line":1114,"end_line":1475,"signature":"export function findBraceBlockEnd(","ast_hash":"83d1602e01ec0e9b"}}
tags: []
origin: "evolved"
created_at: "2026-11-02T03:04:44.814Z"
updated_at: "2026-11-18T17:14:24.993Z"
---

## Symptom
Functions with generic type defaults like <T = { a: number; b: string }> truncated to line 0

## Root Cause
trySkipGenericAngles aborted on semicolon even when braceDepth > 0, and multiline generic angle jumping did not re-bind mLines[i] line reference

## Solution
Check braceDepth === 0 on semicolon, scan joined lookahead for multiline generic parameter lists, and rebind line and column offsets
