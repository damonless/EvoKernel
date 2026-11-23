---
id: issue-30-fullstack-4d-audit-and-hardening
title: "Issue #30 & 4D Full-Stack Audit Hardening Across AST, Sandbox, Telemetry, MCP & Harnesses"
l0_summary: "Polyglot AST forward decls, head+tail sandbox, causal attribution, proxy/hook safety & fail-closed restore -> harden 45 audited edges."
created_commit: "2fdf9f6"
created_branch: "main"
target_symbols: ["src/core/memory.ts#isBodylessForwardDeclaration","src/core/telemetry.ts#EvoTelemetry.recordCapabilityOutcome","src/core/sandbox.ts#executeSandboxedScriptAsync","src/cli/virtualize.ts#runVirtualize","src/cli/hook.ts#handleStop"]
ast_fingerprints: {"src/core/memory.ts#isBodylessForwardDeclaration":{"symbol":"src/core/memory.ts#isBodylessForwardDeclaration","file_path":"src/core/memory/symbol-extractor.ts","file":"src/core/memory/symbol-extractor.ts","kind":"function","start_line":220,"end_line":338,"signature":"export function isBodylessForwardDeclaration(","ast_hash":"f329d3c23c1f67b3"},"src/core/telemetry.ts#EvoTelemetry.recordCapabilityOutcome":{"symbol":"src/core/telemetry.ts#EvoTelemetry.recordCapabilityOutcome","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"method","start_line":2663,"end_line":2750,"signature":"public recordCapabilityOutcome(","ast_hash":"b3259f37e6627bc0"},"src/core/sandbox.ts#executeSandboxedScriptAsync":{"symbol":"src/core/sandbox.ts#executeSandboxedScriptAsync","file_path":"src/core/sandbox.ts","file":"src/core/sandbox.ts","kind":"function","start_line":635,"end_line":753,"signature":"export async function executeSandboxedScriptAsync(","ast_hash":"ddffb76de7c64e35"},"src/cli/virtualize.ts#runVirtualize":{"symbol":"src/cli/virtualize.ts#runVirtualize","file_path":"src/cli/virtualize.ts","file":"src/cli/virtualize.ts","kind":"function","start_line":399,"end_line":643,"signature":"export function runVirtualize(","ast_hash":"c9bc8f3a313e2545"},"src/cli/hook.ts#handleStop":{"symbol":"src/cli/hook.ts#handleStop","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":994,"end_line":1235,"signature":"export function handleStop(","ast_hash":"8c375f5360a3ceb7"}}
tags: ["issue-30","ast","gatekeeper","telemetry","mcp-proxy","hardening"]
origin: "evolved"
created_at: "2026-11-14T20:18:17.048Z"
updated_at: "2026-11-23T20:22:13.835Z"
---

## Symptom
Full-stack 4D audit plus Issue #30 surfaced 45 verified bugs across C/C++/Go/Java/TS AST extraction, sandbox head-only truncation, telemetry attribution leakage, MCP Windows multi-root/proxy handling, Antigravity Stop hook closure, and foreign-cwd build safety.

## Root Cause
Lexical AST block scanner mishandled Go/TS interface signatures, C/C++ typed arrays and forward struct tags, and C++/Rust :: scopes; Gatekeeper lacked absolute workspace path relativization and stdlib dotted exemptions; telemetry recalled_capabilities lacked 24h TTL and Stop/contested attribution barriers; proxy/virtualize lacked Windows relative command resolution, drive-case dedup, and fail-closed restore; build.mjs resolved repo root from process.cwd() and wrote unconditionally to global home dirs.

## Solution
Hardened all 45 accepted defects across AST memory extraction, 6-stage Gatekeeper, telemetry TTL and contested_at barrier, sandbox head+tail capture, deliverable single-quote XML and CSV unclosed quotes, MCP proxy/virtualize fail-closed restore, harness/hook isolation, and build.mjs import.meta root + EVO_SYNC_GLOBAL=1 opt-in.
