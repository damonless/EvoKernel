---
id: git-fix-387153f
title: "Historical Fix Case (387153f): fix(mcp,cli): support per-call workspace routing and prevent plugin cw"
l0_summary: "Historical fix (387153f): fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #"
created_commit: "387153f"
target_symbols: ["src/cli/index.ts#copyDirNonOverwriting","src/core/storage.ts#isPluginOrExtensionInstallDir","src/mcp/handlers.ts#EvoMcpDispatcher"]
ast_fingerprints: {"src/cli/index.ts#copyDirNonOverwriting":{"symbol":"src/cli/index.ts#copyDirNonOverwriting","file_path":"src/cli/index.ts","kind":"function","start_line":42,"end_line":55,"signature":"function copyDirNonOverwriting(srcDir: string, destDir: string): void","ast_hash":"e7a81af76891793d"},"src/core/storage.ts#isPluginOrExtensionInstallDir":{"symbol":"src/core/storage.ts#isPluginOrExtensionInstallDir","file_path":"src/core/storage.ts","kind":"function","start_line":25,"end_line":34,"signature":"export function isPluginOrExtensionInstallDir(dirPath: string): boolean","ast_hash":"12610322dbcbae51"},"src/mcp/handlers.ts#EvoMcpDispatcher":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher","file_path":"src/mcp/handlers.ts","kind":"class","start_line":209,"end_line":589,"signature":"export class EvoMcpDispatcher","ast_hash":"311558e67865ff67"}}
tags: ["git-history","fix","bootstrap"]
origin: "bootstrap"
created_at: "2026-10-21T15:14:01.082Z"
updated_at: "2026-10-21T15:14:01.082Z"
---

## Symptom
Regression or issue addressed in commit 387153f: "fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5)"

## Root Cause
Historical bug/fix pattern affecting symbols: src/cli/index.ts#copyDirNonOverwriting, src/core/storage.ts#isPluginOrExtensionInstallDir, src/mcp/handlers.ts#EvoMcpDispatcher.

## Solution
Resolved in commit 387153f (fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5)). Inspect the anchored source files and symbols below for current implementation guards.
