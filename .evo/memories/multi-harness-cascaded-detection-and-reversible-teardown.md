---
id: multi-harness-cascaded-detection-and-reversible-teardown
title: "Issue #9 Complete Red-Team Hardening Across Multi-Harness, Hook Router, MCP Proxy & Bootstrap"
l0_summary: "Multi-agent harness matrix, universal hooks, and MCP proxy virtualization hardened against all Issue #9 Round 3 & Round 4 blockers."
created_commit: "65bb194"
target_symbols: ["src/cli/init.ts#runInit","src/cli/init.ts#runUninstall","src/cli/harness.ts#detectCascadedTargets","src/cli/hook.ts#runHook","src/mcp/proxy.ts#McpClientConnection","src/mcp/handlers.ts#EvoMcpDispatcher","src/cli/bootstrap.ts#detectProjectStacks"]
ast_fingerprints: {"src/cli/init.ts#runInit":{"symbol":"src/cli/init.ts#runInit","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":320,"end_line":401,"signature":"export function runInit(","ast_hash":"f9b3208233737700"},"src/cli/init.ts#runUninstall":{"symbol":"src/cli/init.ts#runUninstall","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":403,"end_line":405,"signature":"export function runUninstall(","ast_hash":"5f1545e7265e0a78"},"src/cli/harness.ts#detectCascadedTargets":{"symbol":"src/cli/harness.ts#detectCascadedTargets","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":1201,"end_line":1241,"signature":"export function detectCascadedTargets(","ast_hash":"cd97b948d8f20e4c"},"src/cli/hook.ts#runHook":{"symbol":"src/cli/hook.ts#runHook","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":423,"end_line":423,"signature":"export function runHook(rawEvent: string, options: HookOptions = {}): HookResult","ast_hash":"ce4192436ea24b8c"},"src/mcp/proxy.ts#McpClientConnection":{"symbol":"src/mcp/proxy.ts#McpClientConnection","file_path":"src/mcp/proxy.ts","file":"src/mcp/proxy.ts","kind":"class","start_line":24,"end_line":248,"signature":"export class McpClientConnection","ast_hash":"0356164f58779932"},"src/mcp/handlers.ts#EvoMcpDispatcher":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"class","start_line":225,"end_line":1058,"signature":"export class EvoMcpDispatcher","ast_hash":"3661f90d43f4c9d0"},"src/cli/bootstrap.ts#detectProjectStacks":{"symbol":"src/cli/bootstrap.ts#detectProjectStacks","file_path":"src/cli/bootstrap.ts","file":"src/cli/bootstrap.ts","kind":"function","start_line":66,"end_line":259,"signature":"export function detectProjectStacks(workspaceRoot: string): DetectedStack[]","ast_hash":"748c88e21e7d9f9e"}}
tags: []
origin: "evolved"
supersedes_id: "multi-harness-cascaded-detection-and-reversible-teardown"
created_at: "2026-10-23T07:08:41.581Z"
updated_at: "2026-10-25T16:34:36.566Z"
---

## Symptom
Issue #9 Red-Team Audit (12 initial blockers + 4 Round 4 pre-merge boundary items) across hook.ts, handlers.ts, proxy.ts, harness.ts, init.ts, storage.ts, and bootstrap.ts.

## Root Cause
Round 3 (12 blockers) + Round 4 (4 pre-merge items): [MEDIUM-A] handleRun resolved cachedExtTool before awaiting ensureExternalToolsSynced; [MEDIUM-B] EDIT_TOOL_NAMES omitted Claude Code Edit/Write/MultiEdit and runHook read fd 0 on pre-commit; [LOW-C] transient external server failure overwrote cached tools and suppressed retry; [LOW-D] unquoted args with spaces on Windows shell:true.

## Solution
1) Moved cachedExtTool lookup inside executeCall() after await ensureExternalToolsSynced(targetCtx). 2) Added edit/multiedit/write/notebookedit/create_file/str_replace_editor/apply_patch to EDIT_TOOL_NAMES and restricted resolvePayload(options) to post-tool/stop events. 3) Added syncPromise deduplication and preserved cached tools on transient discovery failure. 4) Quoted args containing whitespace when isBatch shell:true is enabled on Windows.
