---
id: issues-10-11-12-audit-hook-and-cross-lang-recall
title: "Issues #10-#14: Decoupled Core vs Catalog Budgets, Antigravity GENERIC Hook Recovery & Cross-Language Recall Precision"
l0_summary: "Fixes Issues #10-#14 Gatekeeper/auditor budgets, Antigravity hook GENERIC step recovery, and cross-language query precision."
created_commit: "ac88a9d"
target_symbols: ["src/core/gatekeeper.ts#tokenizeClauseText","src/core/telemetry.ts#extractQueryTokens","src/cli/harness.ts#upsertAntigravityHooks","src/cli/init.ts#formatToolsCatalogMarkdown","src/core/storage.ts#listRules"]
ast_fingerprints: {"src/core/gatekeeper.ts#tokenizeClauseText":{"symbol":"src/core/gatekeeper.ts#tokenizeClauseText","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"function","start_line":372,"end_line":392,"signature":"export function tokenizeClauseText(clause: string): Set<string>","ast_hash":"529f1592846fa227"},"src/core/telemetry.ts#extractQueryTokens":{"symbol":"src/core/telemetry.ts#extractQueryTokens","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"function","start_line":81,"end_line":229,"signature":"export function extractQueryTokens(query: string): string[]","ast_hash":"fcaa3fc76a38e40e"},"src/cli/harness.ts#upsertAntigravityHooks":{"symbol":"src/cli/harness.ts#upsertAntigravityHooks","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":1056,"end_line":1103,"signature":"export function upsertAntigravityHooks(ws: string): string[]","ast_hash":"c4a0673de4d2e18a"},"src/cli/init.ts#formatToolsCatalogMarkdown":{"symbol":"src/cli/init.ts#formatToolsCatalogMarkdown","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":43,"end_line":95,"signature":"export function formatToolsCatalogMarkdown(storage: EvoStorage, _coreDigest: string = ''): string","ast_hash":"e6e291b75fe52d30"},"src/core/storage.ts#listRules":{"symbol":"src/core/storage.ts#listRules","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"method","start_line":349,"end_line":374,"signature":"public listRules(): EvoRule[]","ast_hash":"3c1081b6d1a9eeee"}}
tags: ["issue-10","issue-11","issue-12","issue-13","issue-14","gatekeeper","antigravity-hook","cross-language-search"]
origin: "evolved"
supersedes_id: "issues-10-11-12-audit-hook-and-cross-lang-recall"
created_at: "2026-10-26T14:01:01.159Z"
updated_at: "2026-10-27T06:06:25.068Z"
---

## Symptom
1) Production workspaces with 600+ token coreDigest had Section 5 micro-tools wiped out and failed evo audit when external user docs existed (Issue #14 B2/B4); 2) Antigravity hook missed 100% of real source='MODEL' GENERIC command error/recovery steps and stale workspace hook scripts were not updated (Issue #14 B1/B3).

## Root Cause
1) Issues #10-#14: agy-config-auditor compared core-invariants.md in Split-Brain, failed on Class.method or file:symbol targets, and measured entire host files or conflated maxCoreRuleTokens (1500) with static seed tokens; 2) antigravity_hook.mjs filtered out source='MODEL' GENERIC tool outputs and missed steps[i+1+tcIdx] multi-tool offsets; 3) syncManagedRuleBlocks did not refresh .agents/scripts/antigravity_hook.mjs.

## Solution
1) Decouple Section 4 maxCoreRuleTokens (1500) from MAX_TOOLS_CATALOG_TOKENS (350) and extract only <!-- EVO:START -->...<!-- EVO:END --> managed blocks in audit.ts and agy-config-auditor; 2) Remove nextSource !== 'MODEL' in antigravity_hook.mjs and index steps[i+1+tcIdx]; 3) Refresh workspace .agents/scripts/antigravity_hook.mjs in syncManagedRuleBlocks.
