---
id: audit-broken-refs-and-hook-param-fix
title: "Skill Ref Audit & Hook Param Resolution Fix"
l0_summary: "Fix skill capability ref extraction, supersedes_id exclusion, and runHook argument discrimination."
created_commit: "6c7266d"
created_branch: "main"
target_symbols: ["validateCapabilityReferences","runHook"]
ast_fingerprints: {"validateCapabilityReferences":{"symbol":"validateCapabilityReferences","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"function","start_line":561,"end_line":606,"signature":"export function validateCapabilityReferences(","ast_hash":"da76821b4f274c68"},"runHook":{"symbol":"runHook","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":1403,"end_line":1495,"signature":"export function runHook(","ast_hash":"9e0ce2c9ef4df2e6"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T09:02:45.683Z"
updated_at: "2026-11-14T20:17:33.453Z"
---

## Symptom
Audit fails to detect broken capability references in skills and falsely reports supersedes_id references as missing; mark-recovery hook fails to execute when workspace path is passed as first argument to runHook.

## Root Cause
Broken capability reference audit in src/cli/audit.ts checked non-existent skill.instruction instead of l1_contract/l2_sop and omitted supersedes_id self-references; runHook in tests passed workspace directory as 1st argument, causing event resolution to silently default to stop on process.cwd() instead of mark-recovery.

## Solution
Validate skill capability references using (skill.l1_contract + l2_sop) and include supersedes_id in extraKnownIds; make runHook argument handling flexible so paths or option objects as first argument correctly set workspaceRoot and preserve event.
