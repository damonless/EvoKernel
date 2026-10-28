---
id: git-fix-387153f
title: "Historical Fix Case (387153f): Multi-Workspace MCP Context Routing & Plugin CWD Hijacking Isolation"
l0_summary: "Fixes plugin install directory CWD hijacking, single-dispatcher cross-project contamination, and missing workspace parameters."
created_commit: "bc9afe2"
target_symbols: ["src/core/storage.ts#isPluginOrExtensionInstallDir","src/mcp/handlers.ts#EvoMcpDispatcher","src/cli/index.ts#resolveWorkspaceRoot"]
ast_fingerprints: {"src/core/storage.ts#isPluginOrExtensionInstallDir":{"symbol":"src/core/storage.ts#isPluginOrExtensionInstallDir","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":59,"end_line":70,"signature":"export function isPluginOrExtensionInstallDir(dirPath: string): boolean","ast_hash":"7a35351be54a8e1a"},"src/mcp/handlers.ts#EvoMcpDispatcher":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"class","start_line":225,"end_line":1133,"signature":"export class EvoMcpDispatcher","ast_hash":"f32107c293090f70"},"src/cli/index.ts#resolveWorkspaceRoot":{"symbol":"src/cli/index.ts#resolveWorkspaceRoot","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":117,"end_line":146,"signature":"export function resolveWorkspaceRoot(","ast_hash":"34533e958d0f3295"}}
tags: ["git-history","fix","mcp","workspace-routing","plugin-isolation"]
origin: "evolved"
supersedes_id: "git-fix-387153f"
created_at: "2026-10-21T15:16:26.722Z"
updated_at: "2026-10-28T17:52:12.549Z"
---

## Symptom
1) When launched by IDE plugins (Antigravity/Cursor), the MCP process CWD pointed to the plugin install directory, hijacking workspace discovery and creating .evo/ in the plugin directory. 2) In multi-workspace IDE windows, a single MCP dispatcher instance reused one EvoStorage instance, cross-contaminating capabilities between unrelated projects.

## Root Cause
1) process.cwd() was assumed to be the user project workspace; plugin install directories were not recognized or isolated. 2) MCP tool schemas lacked an explicit workspace parameter, making per-call workspace context switching impossible.

## Solution
1) Expose workspace parameter schema (WORKSPACE_PARAM_SCHEMA) across all 5 Meta-MCP tools. 2) Add isPluginOrExtensionInstallDir in src/core/storage.ts to detect plugin paths and redirect fallback to ~/.evo/global. 3) Cache per-workspace contexts (this.contexts = new Map<string, WorkspaceContext>()) in EvoMcpDispatcher and dynamically bind on each call via bindActiveContext(args).
