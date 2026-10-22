---
id: issue-8-workspace-isolation-and-atomic-compact
title: "Issue #8 Workspace Isolation, Atomic Compact & C/CJK Grounding Fix"
l0_summary: "Fixes workspace write-through pollution, non-atomic evo_compact data loss, CJK 2-gram recall, and C semicolon comments."
created_commit: "3e5269b"
target_symbols: ["src/mcp/handlers.ts#bindActiveContext","src/mcp/handlers.ts#handleCompact","src/core/gatekeeper.ts#evaluateAndCommit","src/core/telemetry.ts#extractQueryTokens","src/core/memory.ts#findSymbolDeclarationInLines"]
ast_fingerprints: {"src/mcp/handlers.ts#bindActiveContext":{"symbol":"src/mcp/handlers.ts#bindActiveContext","file_path":"src/mcp/handlers.ts","kind":"method","start_line":275,"end_line":320,"signature":"private bindActiveContext(toolName: string, args: Record<string, unknown>): WorkspaceContext","ast_hash":"3c9c7828d0ecfc22"},"src/mcp/handlers.ts#handleCompact":{"symbol":"src/mcp/handlers.ts#handleCompact","file_path":"src/mcp/handlers.ts","kind":"method","start_line":666,"end_line":757,"signature":"private handleCompact(args: Record<string, unknown>)","ast_hash":"27db0b7d381ffd27"},"src/core/gatekeeper.ts#evaluateAndCommit":{"symbol":"src/core/gatekeeper.ts#evaluateAndCommit","file_path":"src/core/gatekeeper.ts","kind":"method","start_line":63,"end_line":595,"signature":"public evaluateAndCommit(","ast_hash":"da7c14170216add7"},"src/core/telemetry.ts#extractQueryTokens":{"symbol":"src/core/telemetry.ts#extractQueryTokens","file_path":"src/core/telemetry.ts","kind":"function","start_line":23,"end_line":35,"signature":"export function extractQueryTokens(query: string): string[]","ast_hash":"a41edd548370d818"},"src/core/memory.ts#findSymbolDeclarationInLines":{"symbol":"src/core/memory.ts#findSymbolDeclarationInLines","file_path":"src/core/memory.ts","kind":"function","start_line":339,"end_line":419,"signature":"function findSymbolDeclarationInLines(","ast_hash":"712ba0b78f79bccb"}}
tags: ["mcp","gatekeeper","telemetry","memory","issue-8"]
origin: "evolved"
created_at: "2026-10-22T16:37:31.003Z"
updated_at: "2026-10-22T16:37:31.003Z"
---

## Symptom
Calling evo_propose in an uninitialized git clone leaked private rules into ~/.evo/global; failed evo_compact permanently deleted target_ids; C functions with semicolons in trailing comments failed AST symbol grounding.

## Root Cause
bindActiveContext fell back to defaultRoot (~/.evo/global) when workspace lacked .evo; handleCompact archived targets before validating merged_proposal; findSymbolDeclarationInLines matched [^;]*$ before stripping inline comments.

## Solution
Auto-initialize Stealth .evo in local Git root on write calls, add dryRun + excludeIdsFromBudgetAndSim precheck to evaluateAndCommit before archiving in handleCompact, add 2-gram CJK tokenizer in telemetry.ts, and strip inline comments before declaration regex in memory.ts.
