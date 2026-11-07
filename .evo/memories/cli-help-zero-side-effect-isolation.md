---
id: cli-help-zero-side-effect-isolation
title: "CLI Help Early Interception and Transient DB Protection"
l0_summary: "CLI --help/-h must intercept before fallback seeding and mutating handlers"
created_commit: "3d3bf4e"
created_branch: "main"
target_symbols: ["src/cli/index.ts#runCli","src/cli/ui.ts#buildUiSnapshot"]
ast_fingerprints: {"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":586,"end_line":1158,"signature":"export function runCli(argv: string[]): void","ast_hash":"131ce4fb5aa632e4"},"src/cli/ui.ts#buildUiSnapshot":{"symbol":"src/cli/ui.ts#buildUiSnapshot","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":37,"end_line":134,"signature":"export function buildUiSnapshot(","ast_hash":"2a6437d7829ab28c"}}
tags: []
origin: "evolved"
created_at: "2026-11-04T16:48:58.119Z"
updated_at: "2026-11-07T19:43:04.307Z"
---

## Symptom
Running evo <command> --help or -h modifies files, seeds global directory, or accidentally executes mutating actions like uninstalling or initializing.

## Root Cause
CLI entrypoint executed ensureGlobalFallbackSeeded and dispatched mutating subcommands before evaluating --help/-h flags, causing commands like evo uninstall --help or evo init --help to mutate the global directory or execute file deletion.

## Solution
Intercept --help and -h flags at the top of runCli before resolving workspace or seeding fallbacks, routing immediately to dedicated zero-side-effect help printers and exiting cleanly with code 0. Wrap transient SQLite handles in try-finally.
