---
id: git-fix-387153f
title: "Historical Fix Case (387153f): fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking"
l0_summary: "Historical fix (387153f): fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5)"
created_commit: "6eca6ef"
target_symbols: ["src/cli/index.ts#copyDirNonOverwriting","src/core/storage.ts#isPluginOrExtensionInstallDir","src/mcp/handlers.ts#EvoMcpDispatcher"]
ast_fingerprints: {"src/cli/index.ts#copyDirNonOverwriting":{"symbol":"src/cli/index.ts#copyDirNonOverwriting","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":45,"end_line":58,"signature":"function copyDirNonOverwriting(srcDir: string, destDir: string): void","ast_hash":"e7a81af76891793d"},"src/core/storage.ts#isPluginOrExtensionInstallDir":{"symbol":"src/core/storage.ts#isPluginOrExtensionInstallDir","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":59,"end_line":70,"signature":"export function isPluginOrExtensionInstallDir(dirPath: string): boolean","ast_hash":"7a35351be54a8e1a"},"src/mcp/handlers.ts#EvoMcpDispatcher":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"class","start_line":225,"end_line":1058,"signature":"export class EvoMcpDispatcher","ast_hash":"3661f90d43f4c9d0"}}
tags: ["git-history","fix","bootstrap"]
origin: "evolved"
supersedes_id: "git-fix-387153f"
created_at: "2026-10-21T15:16:26.722Z"
updated_at: "2026-10-23T04:44:22.330Z"
---

## Symptom
Regression or issue addressed in commit 387153f: "fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5)"

## Root Cause
Historical bug/fix pattern affecting symbols: src/cli/index.ts#copyDirNonOverwriting, src/core/storage.ts#isPluginOrExtensionInstallDir, src/mcp/handlers.ts#EvoMcpDispatcher.

## Solution
Resolved in commit 387153f (fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5)). Inspect the anchored source files and symbols below for current implementation guards.
