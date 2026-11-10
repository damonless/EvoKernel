---
id: cli-help-zero-side-effect-isolation
title: "CLI Help Early Interception and Transient DB Protection"
l0_summary: "CLI --help/-h must intercept before fallback seeding and mutating handlers"
created_commit: "765dd5e"
created_branch: "main"
target_symbols: ["src/cli/index.ts#runCli","src/cli/ui.ts#buildUiSnapshot"]
ast_fingerprints: {"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":887,"end_line":1627,"signature":"export function runCli(argv: string[]): void","ast_hash":"eb44b65d6b2a44da"},"src/cli/ui.ts#buildUiSnapshot":{"symbol":"src/cli/ui.ts#buildUiSnapshot","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":42,"end_line":212,"signature":"export function buildUiSnapshot(","ast_hash":"2b9e10c598bd8454"}}
tags: []
origin: "evolved"
created_at: "2026-11-04T16:48:58.119Z"
updated_at: "2026-11-10T17:22:54.558Z"
---

## Symptom
Running evo <command> --help or -h modifies files, seeds global directory, or accidentally executes mutating actions like uninstalling or initializing.

## Root Cause
CLI entrypoint executed ensureGlobalFallbackSeeded and dispatched mutating subcommands before evaluating --help/-h flags, causing commands like evo uninstall --help or evo init --help to mutate the global directory or execute file deletion.

## Solution
Intercept --help and -h flags at the top of runCli before resolving workspace or seeding fallbacks, routing immediately to dedicated zero-side-effect help printers and exiting cleanly with code 0. Wrap transient SQLite handles in try-finally.
