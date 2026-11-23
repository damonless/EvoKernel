---
id: issue-34-fixes-and-route-b-profile-push
title: "Issue #34 Hardening, Auditor SSOT & Route B Global Preference Push"
l0_summary: "Fix Issue #34 (quote-free hooks, BOM, async MCP, SSOT auditor) and add Route B global preference push layer."
created_commit: "105df52"
created_branch: "main"
target_symbols: ["src/cli/init.ts#syncGlobalUserProfile","src/cli/harness.ts#upsertAntigravityHooks","src/mcp/handlers.ts#EvoMcpDispatcher"]
ast_fingerprints: {"src/cli/init.ts#syncGlobalUserProfile":{"symbol":"src/cli/init.ts#syncGlobalUserProfile","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":435,"end_line":557,"signature":"export function syncGlobalUserProfile(","ast_hash":"e906952f07949351"},"src/cli/harness.ts#upsertAntigravityHooks":{"symbol":"src/cli/harness.ts#upsertAntigravityHooks","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":2029,"end_line":2082,"signature":"export function upsertAntigravityHooks(ws: string): string[]","ast_hash":"029d8e307b8dffc3"},"src/mcp/handlers.ts#EvoMcpDispatcher":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"class","start_line":336,"end_line":2874,"signature":"export class EvoMcpDispatcher","ast_hash":"d82ff46780422b55"}}
tags: []
origin: "evolved"
review_status: "pending"
created_at: "2026-11-23T16:57:10.412Z"
updated_at: "2026-11-23T16:57:10.412Z"
---

## Symptom
Antigravity hooks failed under Windows cmd /c quotes and UTF-8 BOM, evo audit emitted false-positive leaks/overlaps, async MCP blocked on sync git/AST calls, and EvoKernel lacked cross-workspace personal preference push.

## Root Cause
Issue #34 stemmed from cmd /c quote escaping, missing BOM stripping, duplicated 875-line AST extractor in agy-config-auditor, sync git/AST calls on async MCP paths, and missing global version/seed cleanup; Route B required a dedicated preference kind isolated from repo memory and pushed via EVO:PROFILE markers.

## Solution
Replaced node -e hooks with quote-free relative scripts, added parseJsonStripBom, refactored agy-config-auditor into a thin dist/ wrapper, wired async MCP search/propose paths, retired evo optimize, and added 500-tok User-Global preference push via syncGlobalUserProfile and evo profile CLI.
