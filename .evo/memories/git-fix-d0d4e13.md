---
id: git-fix-d0d4e13
title: "Historical Fix Case (d0d4e13): fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve"
l0_summary: "Historical fix (d0d4e13): fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targ"
created_commit: "1185983"
target_symbols: ["src/cli/index.ts#copyDirNonOverwriting","src/cli/init.ts#syncManagedRuleBlocks","src/core/telemetry.ts#EvoTelemetry"]
ast_fingerprints: {"src/cli/index.ts#copyDirNonOverwriting":{"symbol":"src/cli/index.ts#copyDirNonOverwriting","file_path":"src/cli/index.ts","kind":"function","start_line":38,"end_line":51,"signature":"function copyDirNonOverwriting(srcDir: string, destDir: string): void","ast_hash":"621952288fb6ec96"},"src/cli/init.ts#syncManagedRuleBlocks":{"symbol":"src/cli/init.ts#syncManagedRuleBlocks","file_path":"src/cli/init.ts","kind":"function","start_line":59,"end_line":77,"signature":"export function syncManagedRuleBlocks(workspaceRoot: string): string[]","ast_hash":"642085d4ddd1a646"},"src/core/telemetry.ts#EvoTelemetry":{"symbol":"src/core/telemetry.ts#EvoTelemetry","file_path":"src/core/telemetry.ts","kind":"class","start_line":11,"end_line":485,"signature":"export class EvoTelemetry","ast_hash":"3fcd27a0029725c6"}}
tags: ["git-history","fix","bootstrap"]
origin: "bootstrap"
created_at: "2026-10-17T11:02:31.307Z"
updated_at: "2026-10-17T11:04:36.125Z"
---

## Symptom
Regression or issue addressed in commit d0d4e13: "fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets, and add FTS5 fallback (Closes #1, Closes #3)"

## Root Cause
Historical bug/fix pattern affecting symbols: src/cli/index.ts#copyDirNonOverwriting, src/cli/init.ts#syncManagedRuleBlocks, src/core/telemetry.ts#EvoTelemetry.

## Solution
Resolved in commit d0d4e13 (fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets, and add FTS5 fallback (Closes #1, Closes #3)). Inspect the anchored source files and symbols below for current implementation guards.
