---
id: issues-31-32-33-hook-mcp-and-anchor-hardening
title: "Issues #31/#32/#33 Bucket A Residuals & B1-B9 Modular Architecture Hardening"
l0_summary: "Fix 8 Bucket A hook/DB residuals & land B1-B9 waterfall, session epoch, async RequestContext, 3-ring sandbox, anon & barrel splits."
created_commit: "09f2d69"
created_branch: "main"
target_symbols: ["src/core/memory/symbol-extractor.ts#resolveBarrelReexportTargets","src/core/gatekeeper/evaluator.ts#EvoGatekeeper.evaluateAndCommitAsync","src/core/gatekeeper/security-patterns.ts#isValidContrastiveEvidence","src/core/gatekeeper/workspace-snapshot.ts#prepareEphemeralSelfTestWorkspace","src/mcp/handlers.ts#EvoMcpDispatcher.handleToolCallAsync"]
ast_fingerprints: {"src/core/memory/symbol-extractor.ts#resolveBarrelReexportTargets":{"symbol":"src/core/memory/symbol-extractor.ts#resolveBarrelReexportTargets","file_path":"src/core/memory/symbol-extractor.ts","file":"src/core/memory/symbol-extractor.ts","kind":"function","start_line":1791,"end_line":1844,"signature":"export function resolveBarrelReexportTargets(","ast_hash":"d9c59cfc9b633591"},"src/core/gatekeeper/evaluator.ts#EvoGatekeeper.evaluateAndCommitAsync":{"symbol":"src/core/gatekeeper/evaluator.ts#EvoGatekeeper.evaluateAndCommitAsync","file_path":"src/core/gatekeeper/evaluator.ts","file":"src/core/gatekeeper/evaluator.ts","kind":"method","start_line":281,"end_line":288,"signature":"public async evaluateAndCommitAsync(","ast_hash":"da9b52999be39265"},"src/core/gatekeeper/security-patterns.ts#isValidContrastiveEvidence":{"symbol":"src/core/gatekeeper/security-patterns.ts#isValidContrastiveEvidence","file_path":"src/core/gatekeeper/security-patterns.ts","file":"src/core/gatekeeper/security-patterns.ts","kind":"function","start_line":377,"end_line":554,"signature":"export function isValidContrastiveEvidence(","ast_hash":"b22983c655c74173"},"src/core/gatekeeper/workspace-snapshot.ts#prepareEphemeralSelfTestWorkspace":{"symbol":"src/core/gatekeeper/workspace-snapshot.ts#prepareEphemeralSelfTestWorkspace","file_path":"src/core/gatekeeper/workspace-snapshot.ts","file":"src/core/gatekeeper/workspace-snapshot.ts","kind":"function","start_line":523,"end_line":718,"signature":"export function prepareEphemeralSelfTestWorkspace(","ast_hash":"c5a6fc855f04b172"},"src/mcp/handlers.ts#EvoMcpDispatcher.handleToolCallAsync":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher.handleToolCallAsync","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":1247,"end_line":1252,"signature":"public async handleToolCallAsync(","ast_hash":"7cdcb5653c61020c"}}
tags: []
origin: "evolved"
created_at: "2026-11-18T05:55:44.742Z"
updated_at: "2026-11-24T06:56:53.992Z"
---

## Symptom
Issues #31/#32/#33 Bucket A residuals & B1-B9 gaps: premature invoke_subagent wakeup, cross-DB recall_events double-count, umbrella dir blindness, cross-chat session_state bleed, sync MCP event-loop blocking, OTHER_BRANCH metadata edit anchor loss, contrastive boilerplate bypass, live-tree self-test risk, private ID lists in ui.ts, and 2,000+ line God-files breaking barrel AST anchors.

## Root Cause
1) antigravity_hook.mjs lacked 3-stage umbrella resolution and session epoch watermarks while updating global recall_events alongside local DB; 2) handlers.ts mutated shared dispatcher fields and ran sync git/sandbox spawns; 3) gatekeeper evaluated comment-unstripped scripts, ran self-tests directly on live trees, and allowed low-information contrastive strings; 4) splitting memory.ts/gatekeeper.ts into submodules breaks facade-pinned AST fingerprints unless symbol extractors follow relative ESM barrel re-exports.

## Solution
Implemented B1 3-stage umbrella waterfall, B2 active_session_epoch isolation, B3 immutable RequestContext + write mutex, B4 preserveAnchorOnMetadataEdit + Git baseline MID/HIGH confidence, B5 substantive contrastive grounding, B6 comment-stripped security/network gates + adaptive tmpdir self-test staging, B7 end-to-end async pipeline, B8 dynamic templates/seed-evo discovery + anon pseudonymization, and B9 compound/stemmer/fuzzy lexicon + depth-2 barrel re-export symbol following.
