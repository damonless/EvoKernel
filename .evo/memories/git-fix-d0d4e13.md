---
id: git-fix-d0d4e13
title: "Historical Fix Case (d0d4e13): Global Fallback Isolation, Parent Git Stealth & SQLite FTS5 Resilience"
l0_summary: "Fixes uninitialized repo pollution, parent .git discovery in subdirectories, and SQLite FTS5 missing module crash on Node v22."
created_commit: "6739065"
target_symbols: ["src/cli/index.ts#resolveWorkspaceRoot","src/cli/init.ts#findGitRoot","src/core/telemetry.ts#EvoTelemetry"]
ast_fingerprints: {"src/cli/index.ts#resolveWorkspaceRoot":{"symbol":"src/cli/index.ts#resolveWorkspaceRoot","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":117,"end_line":146,"signature":"export function resolveWorkspaceRoot(","ast_hash":"34533e958d0f3295"},"src/cli/init.ts#findGitRoot":{"symbol":"src/cli/init.ts#findGitRoot","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":230,"end_line":248,"signature":"export function findGitRoot(startDir: string): string | null","ast_hash":"b87e527b2dd7c006"},"src/core/telemetry.ts#EvoTelemetry":{"symbol":"src/core/telemetry.ts#EvoTelemetry","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"class","start_line":385,"end_line":1097,"signature":"export class EvoTelemetry","ast_hash":"11d6e694dadfdc28"}}
tags: ["git-history","fix","workspace-isolation","fts5","stealth"]
origin: "evolved"
supersedes_id: "git-fix-d0d4e13"
created_at: "2026-10-21T15:16:26.906Z"
updated_at: "2026-10-28T17:31:36.294Z"
---

## Symptom
1) In uninitialized project folders, EvoKernel fell back to the nearest .evo/ or repo .evo/, leaking private rules and session state into the repository. 2) In monorepos or subdirectories, evo init --stealth failed to update .git/info/exclude because .git was in a parent directory. 3) On Windows Node v22 builds where SQLite FTS5 was omitted, evo_search crashed with virtual table initialization errors.

## Root Cause
1) resolveWorkspaceRoot lacked dedicated isolation for global fallback and defaulted to project directory. 2) runInit assumed .git was always a direct child of workspaceRoot. 3) EvoTelemetry relied unconditionally on SQLite FTS5 without detecting module absence or offering a software fallback.

## Solution
1) Enforce strict global fallback isolation to ~/.evo/global via resolveWorkspaceRoot and seed cleanly via ensureGlobalFallbackSeeded. 2) Implement findGitRoot() to climb parent directories and register exclusions in <parentGit>/.git/info/exclude, with --targets filtering. 3) Wrap FTS5 virtual table initialization in try/catch and maintain capability_fts_fallback with pure TypeScript searchFallbackBm25 scoring.
