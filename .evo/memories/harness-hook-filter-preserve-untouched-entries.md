---
id: harness-hook-filter-preserve-untouched-entries
title: "Hook Config Filter Must Preserve Untouched Entries"
l0_summary: "Hook cleanup dropped user entries with empty inner hooks; corrupt settings overwritten"
created_commit: "3ad564d"
created_branch: "main"
target_symbols: ["removeClaudeSettings","syncDeclaredPreToolHooks","isEvoHookCommand"]
ast_fingerprints: {"removeClaudeSettings":{"symbol":"removeClaudeSettings","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":750,"end_line":813,"signature":"export function removeClaudeSettings(filePath: string): boolean","ast_hash":"0716b5859d2090d5"},"syncDeclaredPreToolHooks":{"symbol":"syncDeclaredPreToolHooks","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":815,"end_line":1095,"signature":"export function syncDeclaredPreToolHooks(workspaceRoot: string): void","ast_hash":"871ce010aec157b5"},"isEvoHookCommand":{"symbol":"isEvoHookCommand","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":636,"end_line":665,"signature":"export function isEvoHookCommand(cmd: string, needle?: string): boolean","ast_hash":"40d06c89798cdf3e"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T18:26:36.261Z"
updated_at: "2026-11-09T05:58:23.321Z"
---

## Symptom
Uninstall/sync of Claude/Codex hook configs deleted user entries whose inner hooks array was empty or had no Evo command, and overwrote unparseable settings files with {}.

## Root Cause
Filter-then-push-if-nonempty logic treated 'nothing removed and result empty' the same as 'everything removed'; JSON.parse failure fell back to empty object and was written back.

## Solution
Push the original entry unchanged when filtering removed nothing; only drop when filtering removed something and the result is empty. Abort write when an existing settings file fails to parse.
