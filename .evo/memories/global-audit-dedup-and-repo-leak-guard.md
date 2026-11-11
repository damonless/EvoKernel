---
id: global-audit-dedup-and-repo-leak-guard
title: "Global Audit Deduplication, Repo-Anchored Scope Guard & Duplicate EVO:START Detection"
l0_summary: "Fix global audit double-reporting, ERR_GLOBAL_RULE_REPO_LEAK, duplicate EVO:START detection, and atomic hook state persistence."
created_commit: "540dc0f"
created_branch: "main"
target_symbols: ["src/cli/audit.ts#discoverAuditableFiles","src/cli/audit.ts#auditHarnessSurfaces","src/cli/audit.ts#runAudit"]
ast_fingerprints: {"src/cli/audit.ts#discoverAuditableFiles":{"symbol":"src/cli/audit.ts#discoverAuditableFiles","file_path":"src/cli/audit.ts","file":"src/cli/audit.ts","kind":"function","start_line":211,"end_line":345,"signature":"function discoverAuditableFiles(","ast_hash":"dff7b9a396746432"},"src/cli/audit.ts#auditHarnessSurfaces":{"symbol":"src/cli/audit.ts#auditHarnessSurfaces","file_path":"src/cli/audit.ts","file":"src/cli/audit.ts","kind":"function","start_line":372,"end_line":816,"signature":"export function auditHarnessSurfaces(","ast_hash":"8a2d44b4b64e1d39"},"src/cli/audit.ts#runAudit":{"symbol":"src/cli/audit.ts#runAudit","file_path":"src/cli/audit.ts","file":"src/cli/audit.ts","kind":"function","start_line":821,"end_line":1177,"signature":"export function runAudit(workspaceRoot: string, options: AuditOptions = {}): AuditReport","ast_hash":"256f1c8e2c7542c2"}}
tags: ["audit","global-rules","agy-config-auditor","hook-concurrency"]
origin: "evolved"
review_status: "pending"
created_at: "2026-11-08T16:58:49.823Z"
updated_at: "2026-11-11T08:48:09.749Z"
---

## Symptom
Global audit double-counted violations on ~/.evo/global, missed repo-anchored global scope_glob and duplicate EVO:START blocks, and concurrent hook runs raced on state file.

## Root Cause
Missing isWorkspaceSameAsGlobal guard in runAudit, missing global-only repo-anchored scope_glob and duplicate EVO:START checks, and non-atomic state writes in antigravity_hook.mjs.

## Solution
Deduplicate global audit paths, enforce global-only ERR_GLOBAL_RULE_REPO_LEAK and duplicate EVO:START checks in audit.ts and agy-config-auditor, and use atomic temp-file rename in saveHookState.
