---
id: issue-8-workspace-isolation-and-atomic-compact
title: "Issue #8: Workspace Write-Through Isolation, Atomic Compact, Code-Only Scope Scan & C Comment Grounding"
l0_summary: "Fixes workspace write-through pollution, non-atomic evo_compact data loss, CJK 2-gram recall, and C semicolon comments."
created_commit: "6eca6ef"
target_symbols: ["src/mcp/handlers.ts#bindActiveContext","src/mcp/handlers.ts#handleCompact","src/core/gatekeeper.ts#evaluateAndCommit","src/core/telemetry.ts#collectWorkspaceCodeExtensions","src/core/memory.ts#findSymbolDeclarationInLines"]
ast_fingerprints: {"src/mcp/handlers.ts#bindActiveContext":{"symbol":"src/mcp/handlers.ts#bindActiveContext","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":350,"end_line":396,"signature":"private bindActiveContext(toolName: string, args: Record<string, unknown>): WorkspaceContext","ast_hash":"15f49a7214dcf613"},"src/mcp/handlers.ts#handleCompact":{"symbol":"src/mcp/handlers.ts#handleCompact","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":886,"end_line":1036,"signature":"private handleCompact(args: Record<string, unknown>)","ast_hash":"4b01a12f6def92c3"},"src/core/gatekeeper.ts#evaluateAndCommit":{"symbol":"src/core/gatekeeper.ts#evaluateAndCommit","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"method","start_line":207,"end_line":881,"signature":"public evaluateAndCommit(","ast_hash":"bc7b8a12e766eef5"},"src/core/telemetry.ts#collectWorkspaceCodeExtensions":{"symbol":"src/core/telemetry.ts#collectWorkspaceCodeExtensions","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"function","start_line":115,"end_line":163,"signature":"export function collectWorkspaceCodeExtensions(workspaceRoot: string): Set<string>","ast_hash":"0b494b26cfaa7dd6"},"src/core/memory.ts#findSymbolDeclarationInLines":{"symbol":"src/core/memory.ts#findSymbolDeclarationInLines","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":392,"end_line":472,"signature":"function findSymbolDeclarationInLines(","ast_hash":"846ea4117efeb6ac"}}
tags: ["workspace-isolation","evo-compact","cjk-search","ast-grounding","issue-8"]
origin: "evolved"
supersedes_id: "issue-8-workspace-isolation-and-atomic-compact"
created_at: "2026-10-22T16:37:31.003Z"
updated_at: "2026-10-23T04:44:06.732Z"
---

## Symptom
In multi-workspace IDE sessions, evo_propose wrote private rules into global fallback or leaked defaultRoot across projects, failed evo_compact deleted target_ids, doc-heavy C repos filtered out **/*.{c,h} rules, and C functions with /* ... ; comments failed symbol grounding.

## Root Cause
1) Read/write fallback to defaultRoot polluted global or cross-project .evo; 2) handleCompact deleted targets before Gatekeeper validation and allowed duplicate/ghost target_ids; 3) Scope extension scan stopped at 200 doc files; 4) findSymbolDeclarationInLines missed unclosed /* multi-line comments with semicolons.

## Solution
1) Enforce non-blank workspace on write tools and restrict getGlobalFallbackContexts to ~/.evo/global; 2) Deduplicate/verify >=2 existing targetIds and precheck merged_proposal before archiving; 3) Count only code files (maxCodeFiles=300) and deprioritize doc/vendor dirs; 4) Strip trailing /*.*$ on C declaration lines.
