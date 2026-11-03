---
id: codex-hooks-corrupt-file-unlink
title: "Codex hooks.json corrupt file deleted by pre-tool sync"
l0_summary: "syncDeclaredPreToolHooks treated unparseable .codex/hooks.json as {} and unlinked/overwrote it"
created_commit: "284faa2"
created_branch: "feat/p1-p2-ui-and-growth"
target_symbols: ["syncDeclaredPreToolHooks","isEvoHookCommand"]
ast_fingerprints: {"syncDeclaredPreToolHooks":{"symbol":"syncDeclaredPreToolHooks","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":755,"end_line":1035,"signature":"export function syncDeclaredPreToolHooks(workspaceRoot: string): void","ast_hash":"5439f61c9bb75d98"},"isEvoHookCommand":{"symbol":"isEvoHookCommand","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":576,"end_line":605,"signature":"export function isEvoHookCommand(cmd: string, needle?: string): boolean","ast_hash":"40d06c89798cdf3e"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T18:34:22.922Z"
updated_at: "2026-11-03T00:42:32.446Z"
---

## Symptom
With .codex present and a corrupt hooks.json, syncDeclaredPreToolHooks deleted the file (no pre-tool tools) or replaced it (with pre-tool tools); valid untouched files were reformatted.

## Root Cause
JSON.parse failure fell back to an empty object; empty object then hit the unlink branch; removal path wrote unconditionally without a modified flag.

## Solution
Let JSON.parse errors / non-object roots abort the Codex sync via the outer catch; only write or unlink when an Evo entry was actually removed. Regression: harness2-wave4-audit test 31.
