---
id: multi-harness-cascaded-detection-and-reversible-teardown
title: "Issue #9 Red-Team Audit Hardening Across Multi-Harness, Hook Router, MCP Proxy & Bootstrap"
l0_summary: "Multi-agent harness matrix, universal hooks, and MCP proxy virtualization hardened against all 12 Issue #9 Red-Team blockers."
created_commit: "cbe3505"
target_symbols: ["src/cli/init.ts#runInit","src/cli/init.ts#runUninstall","src/cli/harness.ts#detectCascadedTargets","src/cli/hook.ts#runHook","src/mcp/proxy.ts#McpClientConnection","src/mcp/handlers.ts#EvoMcpDispatcher","src/cli/bootstrap.ts#detectProjectStacks"]
ast_fingerprints: {"src/cli/init.ts#runInit":{"symbol":"src/cli/init.ts#runInit","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":320,"end_line":401,"signature":"export function runInit(","ast_hash":"f9b3208233737700"},"src/cli/init.ts#runUninstall":{"symbol":"src/cli/init.ts#runUninstall","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":403,"end_line":405,"signature":"export function runUninstall(","ast_hash":"5f1545e7265e0a78"},"src/cli/harness.ts#detectCascadedTargets":{"symbol":"src/cli/harness.ts#detectCascadedTargets","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":1201,"end_line":1241,"signature":"export function detectCascadedTargets(","ast_hash":"cd97b948d8f20e4c"},"src/cli/hook.ts#runHook":{"symbol":"src/cli/hook.ts#runHook","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":416,"end_line":416,"signature":"export function runHook(rawEvent: string, options: HookOptions = {}): HookResult","ast_hash":"ce4192436ea24b8c"},"src/mcp/proxy.ts#McpClientConnection":{"symbol":"src/mcp/proxy.ts#McpClientConnection","file_path":"src/mcp/proxy.ts","file":"src/mcp/proxy.ts","kind":"class","start_line":24,"end_line":244,"signature":"export class McpClientConnection","ast_hash":"fc054e212f9928a5"},"src/mcp/handlers.ts#EvoMcpDispatcher":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"class","start_line":224,"end_line":1030,"signature":"export class EvoMcpDispatcher","ast_hash":"82e6c2262638812a"},"src/cli/bootstrap.ts#detectProjectStacks":{"symbol":"src/cli/bootstrap.ts#detectProjectStacks","file_path":"src/cli/bootstrap.ts","file":"src/cli/bootstrap.ts","kind":"function","start_line":66,"end_line":259,"signature":"export function detectProjectStacks(workspaceRoot: string): DetectedStack[]","ast_hash":"748c88e21e7d9f9e"}}
tags: []
origin: "evolved"
supersedes_id: "multi-harness-cascaded-detection-and-reversible-teardown"
created_at: "2026-10-23T07:08:41.581Z"
updated_at: "2026-10-25T16:05:43.233Z"
---

## Symptom
Issue #9 Red-Team Audit identified 12 blockers across hook.ts, handlers.ts, proxy.ts, harness.ts, init.ts, storage.ts, and bootstrap.ts.

## Root Cause
1) Read-only hook tools triggered mutation flags and stdin JSON payloads were ignored. 2) Downstream MCP proxy lacked auto-discovery, lowercased camelCase tool names, shared connections across workspaces, and leaked timed-out handshake processes. 3) Harness adapters false-triggered on bare .vscode or generic API keys and clobbered plugin mcp_config.json. 4) TOML regex failed on multi-line bracketed args and multi-line comments. 5) Bootstrap Makefile detection lacked C/C++ source verification and polyglot seed rules bloated core tokens.

## Solution
1) Decoupled isMutation from Scoped Rule Recall and added fd 0 stdin fallback in resolvePayload. 2) Added lazy external tool discovery in handleToolCall, preserved raw camelCase tool IDs before sanitizeId, moved McpProxyManager per WorkspaceContext with config-hash invalidation, and cleaned up failed handshakes via close()/taskkill. 3) Guarded plugin mcp_config.json (-e bootstrap), tightened Copilot/Env detection, and replaced TOML regex with a bracket-depth/comment-backtracking parser. 4) Required C/C++ sources for Makefile detection, made seed globs directory-agnostic, and set core: idx === 0.
