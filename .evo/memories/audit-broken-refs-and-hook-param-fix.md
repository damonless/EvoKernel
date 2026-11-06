---
id: audit-broken-refs-and-hook-param-fix
title: "Skill Ref Audit & Hook Param Resolution Fix"
l0_summary: "Fix skill capability ref extraction, supersedes_id exclusion, and runHook argument discrimination."
created_commit: "223bdd6"
created_branch: "main"
target_symbols: ["validateCapabilityReferences","runHook"]
ast_fingerprints: {"validateCapabilityReferences":{"symbol":"validateCapabilityReferences","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"function","start_line":321,"end_line":366,"signature":"export function validateCapabilityReferences(","ast_hash":"da76821b4f274c68"},"runHook":{"symbol":"runHook","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":1146,"end_line":1228,"signature":"export function runHook(","ast_hash":"66477da2304f60a3"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T09:02:45.683Z"
updated_at: "2026-11-06T06:25:44.428Z"
---

## Symptom
Audit fails to detect broken capability references in skills and falsely reports supersedes_id references as missing; mark-recovery hook fails to execute when workspace path is passed as first argument to runHook.

## Root Cause
Broken capability reference audit in src/cli/audit.ts checked non-existent skill.instruction instead of l1_contract/l2_sop and omitted supersedes_id self-references; runHook in tests passed workspace directory as 1st argument, causing event resolution to silently default to stop on process.cwd() instead of mark-recovery.

## Solution
Validate skill capability references using (skill.l1_contract + l2_sop) and include supersedes_id in extraKnownIds; make runHook argument handling flexible so paths or option objects as first argument correctly set workspaceRoot and preserve event.
