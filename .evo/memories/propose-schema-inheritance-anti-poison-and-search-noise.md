---
id: propose-schema-inheritance-anti-poison-and-search-noise
title: "Gatekeeper Supersede Inheritance, UI/IDE Update Parity, Skeleton Hash Guard & Search Noise Filtering"
l0_summary: "Fix supersede field/tag/review inheritance, UI/IDE skill L1/L2 & memory anchor parity, skeleton_hash guard & low_overlap filter"
created_commit: "f332d8d"
created_branch: "fix/propose-schema-anti-poison-and-search-noise"
target_symbols: ["src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommitInternal","src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch","src/core/telemetry.ts#EvoTelemetry.search","src/core/memory.ts#verifyMemoryFreshness"]
ast_fingerprints: {"src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommitInternal":{"symbol":"src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommitInternal","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"method","start_line":1656,"end_line":3032,"signature":"private evaluateAndCommitInternal(","ast_hash":"6d25ada80a649546"},"src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":943,"end_line":1085,"signature":"private handleSearch(args: Record<string, unknown>, activeCtx?: WorkspaceContext)","ast_hash":"99214551dfad796e"},"src/core/telemetry.ts#EvoTelemetry.search":{"symbol":"src/core/telemetry.ts#EvoTelemetry.search","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"method","start_line":1073,"end_line":1304,"signature":"public search(","ast_hash":"df4b3528ed4f6871"},"src/core/memory.ts#verifyMemoryFreshness":{"symbol":"src/core/memory.ts#verifyMemoryFreshness","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":2903,"end_line":3585,"signature":"export function verifyMemoryFreshness(","ast_hash":"500f3ccb1e1a785f"}}
tags: ["gatekeeper","memory-poisoning","schema-coercion","search-noise","ui-parity"]
origin: "evolved"
supersedes_id: "3ku-session-propose-schema-and-poisoned-memory-gaps"
review_status: "pending"
created_at: "2026-11-10T09:24:27.691Z"
updated_at: "2026-11-10T16:21:17.524Z"
---

## Symptom
1) Supersede proposals lost tags/review_status/created_at or failed when id/title/fields were omitted, and UI/IDE update-content corrupted skill l2_sop or CLI UI memory created_commit; 2) Dirty-worktree memory anchor falsely verified pre-fix commit via skeleton_hash; 3) telemetry.search dropped 1-hit partial-overlap results and external tool schema params; 4) Anti-poisoning reminder dropped memory IDs on kind-filtered searches.

## Root Cause
1) evaluateAndCommitInternal did not inherit omitted title/l0_summary/scope_glob/content/memory tags/review_status or fallback id to supersedes_id, and UI/IDE update-content overwrote skill l2_sop on L1-only edits or reset memory created_commit in CLI UI; 2) verifyMemoryFreshness checked skeleton_hash at created_commit without verifying histFp.ast_hash === recorded.ast_hash, and git status --porcelain lacked subdirectory-safe ./.evo filtering; 3) telemetry.search stripped partial-overlap hits when highRelevanceHits.length === 1 and did not index external tool inputSchema.properties into FTS keywords; 4) getSessionAntiPoisonReminder omitted memory IDs on kind-filtered evo_search calls.

## Solution
1) Inherit omitted capability metadata/tags/review_status/created_at across same-ID and cross-ID supersedes, fallback id to supersedes_id, strip YAML frontmatter in skill content, prioritize explicit l2_sop, and align UI/IDE update-content skill/memory handlers; 2) Require (!recorded.ast_hash || histFp.ast_hash === recorded.ast_hash) before skeleton_hash fallback in verifyMemoryFreshness and scope git status --porcelain to './'; 3) Align telemetry.search 3-tier low_overlap filtering with handleSearch and index external tool inputSchema.properties in syncFromDisk; 4) Always include session memory IDs (capped to 5) in getSessionAntiPoisonReminder.
