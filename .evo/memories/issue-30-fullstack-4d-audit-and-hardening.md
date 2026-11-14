---
id: issue-30-fullstack-4d-audit-and-hardening
title: "Issue #30 & 4D Full-Stack Audit Hardening Across AST, Sandbox, Telemetry, MCP & Harnesses"
l0_summary: "Polyglot AST forward decls, head+tail sandbox, causal attribution, proxy/hook safety & fail-closed restore -> harden 45 audited edges."
created_commit: "6c7266d"
created_branch: "main"
target_symbols: ["src/core/memory.ts#isBodylessForwardDeclaration","src/core/telemetry.ts#EvoTelemetry.recordCapabilityOutcome","src/core/sandbox.ts#executeSandboxedScriptAsync","src/cli/virtualize.ts#runVirtualize","src/cli/hook.ts#handleStop"]
ast_fingerprints: {"src/core/memory.ts#isBodylessForwardDeclaration":{"symbol":"src/core/memory.ts#isBodylessForwardDeclaration","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":1406,"end_line":1524,"signature":"export function isBodylessForwardDeclaration(","ast_hash":"f329d3c23c1f67b3"},"src/core/telemetry.ts#EvoTelemetry.recordCapabilityOutcome":{"symbol":"src/core/telemetry.ts#EvoTelemetry.recordCapabilityOutcome","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"method","start_line":1782,"end_line":1844,"signature":"public recordCapabilityOutcome(id: string, outcome: CapabilityOutcome): void","ast_hash":"81e1a00de5af9db6"},"src/core/sandbox.ts#executeSandboxedScriptAsync":{"symbol":"src/core/sandbox.ts#executeSandboxedScriptAsync","file_path":"src/core/sandbox.ts","file":"src/core/sandbox.ts","kind":"function","start_line":449,"end_line":560,"signature":"export function executeSandboxedScriptAsync(","ast_hash":"13e62d006068305d"},"src/cli/virtualize.ts#runVirtualize":{"symbol":"src/cli/virtualize.ts#runVirtualize","file_path":"src/cli/virtualize.ts","file":"src/cli/virtualize.ts","kind":"function","start_line":399,"end_line":643,"signature":"export function runVirtualize(","ast_hash":"c9bc8f3a313e2545"},"src/cli/hook.ts#handleStop":{"symbol":"src/cli/hook.ts#handleStop","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":1058,"end_line":1275,"signature":"export function handleStop(","ast_hash":"3ce3efb4b1f32aad"}}
tags: ["issue-30","ast","gatekeeper","telemetry","mcp-proxy","hardening"]
origin: "evolved"
review_status: "pending"
created_at: "2026-11-14T20:18:17.048Z"
updated_at: "2026-11-14T20:18:17.048Z"
---

## Symptom
Full-stack 4D audit plus Issue #30 surfaced 45 verified bugs across C/C++/Go/Java/TS AST extraction, sandbox head-only truncation, telemetry attribution leakage, MCP Windows multi-root/proxy handling, Antigravity Stop hook closure, and foreign-cwd build safety.

## Root Cause
Lexical AST block scanner mishandled Go/TS interface signatures, C/C++ typed arrays and forward struct tags, and C++/Rust :: scopes; Gatekeeper lacked absolute workspace path relativization and stdlib dotted exemptions; telemetry recalled_capabilities lacked 24h TTL and Stop/contested attribution barriers; proxy/virtualize lacked Windows relative command resolution, drive-case dedup, and fail-closed restore; build.mjs resolved repo root from process.cwd() and wrote unconditionally to global home dirs.

## Solution
Hardened all 45 accepted defects across AST memory extraction, 6-stage Gatekeeper, telemetry TTL and contested_at barrier, sandbox head+tail capture, deliverable single-quote XML and CSV unclosed quotes, MCP proxy/virtualize fail-closed restore, harness/hook isolation, and build.mjs import.meta root + EVO_SYNC_GLOBAL=1 opt-in.
