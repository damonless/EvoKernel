---
id: ghost-workspace-resurrection-and-sqlite-handle-lock
title: "Issue #19: Ghost Workspace Resurrection Prevention & Windows SQLite Handle Release"
l0_summary: "Prevent ghost .evo/ resurrection on moved workspaces, ignore .evo/.cache zombie shells, and release Windows SQLite locks."
created_commit: "7293568"
created_branch: "main"
target_symbols: ["src/core/storage.ts#hasValidEvoStructure","src/core/storage.ts#isHollowEvoZombieDir","src/core/storage.ts#findNearestEvoWorkspace","src/mcp/handlers.ts#EvoMcpDispatcher","src/core/telemetry.ts#EvoTelemetry"]
ast_fingerprints: {"src/core/storage.ts#hasValidEvoStructure":{"symbol":"src/core/storage.ts#hasValidEvoStructure","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":150,"end_line":168,"signature":"export function hasValidEvoStructure(candidateEvo: string): boolean","ast_hash":"10fc920b46b4284b"},"src/core/storage.ts#isHollowEvoZombieDir":{"symbol":"src/core/storage.ts#isHollowEvoZombieDir","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":170,"end_line":191,"signature":"export function isHollowEvoZombieDir(dirPath: string): boolean","ast_hash":"6ada89792ae2b271"},"src/core/storage.ts#findNearestEvoWorkspace":{"symbol":"src/core/storage.ts#findNearestEvoWorkspace","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":193,"end_line":216,"signature":"export function findNearestEvoWorkspace(startDir: string): string | null","ast_hash":"a0c443e4b0e8d0b3"},"src/mcp/handlers.ts#EvoMcpDispatcher":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"class","start_line":276,"end_line":2035,"signature":"export class EvoMcpDispatcher","ast_hash":"5dafe67f4186d564"},"src/core/telemetry.ts#EvoTelemetry":{"symbol":"src/core/telemetry.ts#EvoTelemetry","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"class","start_line":621,"end_line":1885,"signature":"export class EvoTelemetry","ast_hash":"7a4e4f8a8d1ca1ee"}}
tags: ["workspace-isolation","sqlite-lock","windows-ntfs","issue-19"]
origin: "evolved"
created_at: "2026-11-02T13:45:30.573Z"
updated_at: "2026-11-14T03:52:06.123Z"
---

## Symptom
Moving or renaming an active workspace on Windows failed with SQLite file locks on .evo/.cache/telemetry.db or left a hollow .evo/.cache shell, and subsequent MCP calls with the old workspace path recreated the deleted directory tree on disk.

## Root Cause
1) EvoMcpDispatcher.bindActiveContext ran fs.mkdirSync(localRoot) on non-existent stale workspace paths; 2) findNearestEvoWorkspace matched hollow .evo/.cache-only shells; 3) EvoMcpDispatcher retained open DatabaseSync handles across idle contexts on Windows.

## Solution
Validate workspace existence and reject hollow .evo/.cache zombie dirs with ERR_WORKSPACE_NOT_FOUND in handleToolCall, require config.json or capability dirs in hasValidEvoStructure, and close DatabaseSync handles via releaseInactiveTelemetryHandles after tool execution.
