---
id: propose-schema-inheritance-anti-poison-and-search-noise
title: "Gatekeeper Supersede Field Inheritance, Skill Content Parsing, Session Anti-Poisoning & Low-Overlap Search Filtering"
l0_summary: "Fix supersede field inheritance, skill L1/L2 parsing, session anti-poisoning reminder, dirty anchor warning & low_overlap filter"
created_commit: "765dd5e"
created_branch: "fix/propose-schema-anti-poison-and-search-noise"
target_symbols: ["src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommitInternal","src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch","src/core/telemetry.ts#EvoTelemetry.search","src/core/storage.ts#EvoStorage.getConfig"]
ast_fingerprints: {"src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommitInternal":{"symbol":"src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommitInternal","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"method","start_line":1656,"end_line":3018,"signature":"private evaluateAndCommitInternal(","ast_hash":"fc9076c292edc8c2"},"src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":942,"end_line":1084,"signature":"private handleSearch(args: Record<string, unknown>, activeCtx?: WorkspaceContext)","ast_hash":"99214551dfad796e"},"src/core/telemetry.ts#EvoTelemetry.search":{"symbol":"src/core/telemetry.ts#EvoTelemetry.search","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"method","start_line":1060,"end_line":1286,"signature":"public search(","ast_hash":"b137aaf7518ff5c9"},"src/core/storage.ts#EvoStorage.getConfig":{"symbol":"src/core/storage.ts#EvoStorage.getConfig","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"method","start_line":314,"end_line":361,"signature":"public getConfig(): EvoConfig","ast_hash":"74ba41d6d9e1f4df"}}
tags: ["gatekeeper","memory-poisoning","schema-coercion","search-noise"]
origin: "evolved"
supersedes_id: "3ku-session-propose-schema-and-poisoned-memory-gaps"
review_status: "pending"
created_at: "2026-11-10T09:24:27.691Z"
updated_at: "2026-11-10T15:40:18.926Z"
---

## Symptom
1) evo_propose rejected supersede updates with ERR_INVALID_SCHEMA when title or unchanged fields were omitted, or when skill updates passed markdown content with ## L1 Contract / ## L2 SOP; 2) Premature read-only memory proposals left stale/poisoned root causes when later turns overturned the initial hypothesis, or anchored created_commit to the pre-fix parent commit on a dirty worktree; 3) evo_search returned unrelated low_overlap tools/memories when total hits were below limit; 4) Legacy 0.1.0 workspaces retained maxCoreRuleTokens=2400.

## Root Cause
1) evaluateAndCommitInternal did not inherit omitted title, l0_summary, scope_glob, content, or memory fields when superseding an existing capability, and did not auto-extract ## L1 Contract / ## L2 SOP from skill content (or overwrote l2_sop when content only contained ## L1 Contract); 2) EvoMcpDispatcher lacked session-level tracking of already-proposed capabilities to remind agents to update overturned hypotheses, and Gatekeeper did not warn when proposing memories on a dirty worktree prior to git commit; 3) telemetry.search and handleSearch only down-weighted low_overlap hits by 0.25x without filtering them out when non-low_overlap matches existed; 4) storage.getConfig did not migrate legacy maxCoreRuleTokens=2400 to 1500 and sliced fallback skill trigger_cue at 90 instead of 120 chars.

## Solution
1) Inherit omitted title, l0_summary, scope_glob, content, and memory fields on supersede/update in evaluateAndCommitInternal, parse ## L1 Contract and ## L2 SOP sections cleanly without L1-only L2 contamination, and normalize object target_symbols with '#'; 2) Track sessionProposedIds in EvoMcpDispatcher to emit [ANTI-POISONING REMINDER] on subsequent tool calls and emit [PRE-COMMIT ANCHOR WARNING] on dirty-worktree memory proposals; 3) Filter out low_overlap noise hits in telemetry.search and handleSearch whenever at least one non-low_overlap hit matches; 4) Auto-migrate legacy maxCoreRuleTokens=2400 to 1500 and align fallback trigger_cue limit to 120 chars.
