---
id: multi-harness-cascaded-detection-and-reversible-teardown
title: "Multi-Agent Harness Matrix, Universal Hooks & MCP Proxy Virtualization"
l0_summary: "Multi-agent harness matrix across 10 coding agents with 3-stage detection, TOML engine, universal hooks, and MCP proxy virtualization."
created_commit: "94783eb"
target_symbols: ["src/cli/init.ts#runInit","src/cli/init.ts#runUninstall","src/cli/harness.ts#detectCascadedTargets","src/cli/hook.ts#runHook","src/mcp/proxy.ts#McpClientConnection"]
ast_fingerprints: {"src/cli/init.ts#runInit":{"symbol":"src/cli/init.ts#runInit","file_path":"src/cli/init.ts","kind":"function","start_line":306,"end_line":387,"signature":"export function runInit(","ast_hash":"f9b3208233737700"},"src/cli/init.ts#runUninstall":{"symbol":"src/cli/init.ts#runUninstall","file_path":"src/cli/init.ts","kind":"function","start_line":389,"end_line":391,"signature":"export function runUninstall(","ast_hash":"5f1545e7265e0a78"},"src/cli/harness.ts#detectCascadedTargets":{"symbol":"src/cli/harness.ts#detectCascadedTargets","file_path":"src/cli/harness.ts","kind":"function","start_line":1120,"end_line":1160,"signature":"export function detectCascadedTargets(","ast_hash":"cd97b948d8f20e4c"},"src/cli/hook.ts#runHook":{"symbol":"src/cli/hook.ts#runHook","file_path":"src/cli/hook.ts","kind":"function","start_line":398,"end_line":398,"signature":"export function runHook(rawEvent: string, options: HookOptions = {}): HookResult","ast_hash":"ce4192436ea24b8c"},"src/mcp/proxy.ts#McpClientConnection":{"symbol":"src/mcp/proxy.ts#McpClientConnection","file_path":"src/mcp/proxy.ts","kind":"class","start_line":24,"end_line":223,"signature":"export class McpClientConnection","ast_hash":"284e802fd19a8f68"}}
tags: ["harness","mcp-proxy","hooks","toml","multi-agent"]
origin: "evolved"
supersedes_id: "multi-harness-cascaded-detection-and-reversible-teardown"
created_at: "2026-10-23T07:08:41.581Z"
updated_at: "2026-10-23T09:28:35.656Z"
---

## Symptom
Missing first-class support for Windsurf, Cline, Roo Code, Copilot, Codex CLI, and OpenCode, Antigravity-coupled hooks, and leftover zombie files on uninstall.

## Root Cause
Earlier harness support was limited to 4 targets with hardcoded MCP JSON and Antigravity-only hooks; lacked TOML support, downstream MCP proxy virtualization, and EISDIR/whitespace guards.

## Solution
Implemented HarnessAdapter matrix across 10 agents in src/cli/harness.ts, universal hook router in src/cli/hook.ts, downstream MCP proxy in src/mcp/proxy.ts, and EISDIR/monorepo hardening.
