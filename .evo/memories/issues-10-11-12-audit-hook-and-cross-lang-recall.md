---
id: issues-10-11-12-audit-hook-and-cross-lang-recall
title: "Issues #10-#15: Decoupled Budgets, Read-Only & Subagent Hook Triggers, L2 Recall Enforcement & Pre-Commit Index"
l0_summary: "Fixes Issues #10-#15 Gatekeeper budgets, GENERIC/read-only/subagent/rhetorical hook triggers, L2 search directives, and commit recall."
created_commit: "9982fa1"
target_symbols: ["src/core/gatekeeper.ts#tokenizeClauseText","src/core/telemetry.ts#extractQueryTokens","src/cli/harness.ts#upsertAntigravityHooks","src/cli/init.ts#formatToolsCatalogMarkdown","src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch"]
ast_fingerprints: {"src/core/gatekeeper.ts#tokenizeClauseText":{"symbol":"src/core/gatekeeper.ts#tokenizeClauseText","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"function","start_line":372,"end_line":392,"signature":"export function tokenizeClauseText(clause: string): Set<string>","ast_hash":"529f1592846fa227"},"src/core/telemetry.ts#extractQueryTokens":{"symbol":"src/core/telemetry.ts#extractQueryTokens","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"function","start_line":86,"end_line":234,"signature":"export function extractQueryTokens(query: string): string[]","ast_hash":"fcaa3fc76a38e40e"},"src/cli/harness.ts#upsertAntigravityHooks":{"symbol":"src/cli/harness.ts#upsertAntigravityHooks","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":1056,"end_line":1103,"signature":"export function upsertAntigravityHooks(ws: string): string[]","ast_hash":"c4a0673de4d2e18a"},"src/cli/init.ts#formatToolsCatalogMarkdown":{"symbol":"src/cli/init.ts#formatToolsCatalogMarkdown","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":43,"end_line":126,"signature":"export function formatToolsCatalogMarkdown(storage: EvoStorage, _coreDigest: string = ''): string","ast_hash":"14b2973330291776"},"src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher.handleSearch","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":474,"end_line":562,"signature":"private handleSearch(args: Record<string, unknown>)","ast_hash":"724349317cd96a69"}}
tags: ["issue-10","issue-11","issue-12","issue-13","issue-14","issue-15","antigravity-hook","read-only-diagnosis"]
origin: "evolved"
supersedes_id: "issues-10-11-12-audit-hook-and-cross-lang-recall"
created_at: "2026-10-26T14:01:01.159Z"
updated_at: "2026-10-27T14:05:25.258Z"
---

## Symptom
1) Workspaces with 600+ token coreDigest lost Section 5 micro-tools and failed evo audit (Issue #14); 2) Antigravity hook missed source='MODEL' GENERIC outputs, 200-step read-only diagnostic investigations, subagent wakeups, and rhetorical/empirical corrections (Issues #14-#15); 3) Agents stopped at L0 summaries without calling evo_inspect(tier: 'L2') or skipped crystallization in read-only troubleshooting sessions (Issue #15).

## Root Cause
1) Issues #10-#14: agy-config-auditor compared core-invariants.md in Split-Brain, failed on Class.method or file:symbol targets, and conflated maxCoreRuleTokens (1500) with static seed tokens; 2) antigravity_hook.mjs filtered out source='MODEL' GENERIC tool outputs, ignored zero-edit read-only investigations and native subagent wakeups, and missed rhetorical/empirical corrections; 3) L0_META_RULE_SEED omitted git commit/deliverable recall triggers, conditioned evo_propose only on code fixes, and handleSearch emitted a passive L0 tip instead of requiring L2 inspection on matched rules/skills.

## Solution
1) Decouple Section 4 maxCoreRuleTokens (1500) from MAX_TOOLS_CATALOG_TOKENS (350) and extract only <!-- EVO:START -->...<!-- EVO:END --> managed blocks; 2) Remove nextSource !== 'MODEL', index steps[i+1+tcIdx], track codeReadCountSinceLastPropose >= 10 (hasHeavyDiagnosticReads), detect SYSTEM_MESSAGE subagent wakeups, and expand CORRECTION_REGEX for rhetorical counter-questions and empirical contradictions; 3) Mandate read-only diagnostic crystallization and L2 guardrail inspection in L0_META_RULE_SEED and emit Action Required L2 directives in handleSearch.
