---
id: git-fix-d0d4e13
title: "Historical Fix Case (d0d4e13): fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth"
l0_summary: "Historical fix (d0d4e13): fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets"
created_commit: "6eca6ef"
target_symbols: ["src/cli/index.ts#copyDirNonOverwriting","src/cli/init.ts#syncManagedRuleBlocks","src/core/telemetry.ts#EvoTelemetry"]
ast_fingerprints: {"src/cli/index.ts#copyDirNonOverwriting":{"symbol":"src/cli/index.ts#copyDirNonOverwriting","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":45,"end_line":58,"signature":"function copyDirNonOverwriting(srcDir: string, destDir: string): void","ast_hash":"e7a81af76891793d"},"src/cli/init.ts#syncManagedRuleBlocks":{"symbol":"src/cli/init.ts#syncManagedRuleBlocks","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":41,"end_line":108,"signature":"export function syncManagedRuleBlocks(workspaceRoot: string): string[]","ast_hash":"248960ae0bcec147"},"src/core/telemetry.ts#EvoTelemetry":{"symbol":"src/core/telemetry.ts#EvoTelemetry","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"class","start_line":183,"end_line":833,"signature":"export class EvoTelemetry","ast_hash":"ddb9e8aecc36216c"}}
tags: ["git-history","fix","bootstrap"]
origin: "evolved"
supersedes_id: "git-fix-d0d4e13"
created_at: "2026-10-21T15:16:26.906Z"
updated_at: "2026-10-23T04:44:24.599Z"
---

## Symptom
Regression or issue addressed in commit d0d4e13: "fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets, and add FTS5 fallback (Closes #1, Closes #3)"

## Root Cause
Historical bug/fix pattern affecting symbols: src/cli/index.ts#copyDirNonOverwriting, src/cli/init.ts#syncManagedRuleBlocks, src/core/telemetry.ts#EvoTelemetry.

## Solution
Resolved in commit d0d4e13 (fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets, and add FTS5 fallback (Closes #1, Closes #3)). Inspect the anchored source files and symbols below for current implementation guards.
