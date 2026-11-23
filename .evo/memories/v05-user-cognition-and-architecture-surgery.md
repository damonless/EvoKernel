---
id: v05-user-cognition-and-architecture-surgery
title: "v0.5 Architecture Surgery & 3-Tier Offline User Cognition Engine"
l0_summary: "Unify profile-sync, workbench-actions, hook-engine, split UI, fix D1-D19, and add 3-tier offline user cognition with 1-click undo."
created_commit: "2fdf9f6"
created_branch: "main"
target_symbols: ["src/core/profile-sync.ts#syncGlobalUserProfile","src/core/workbench-actions.ts#executeWorkbenchAction","src/core/hook-engine.ts#recordRecalledOutcomeUnified"]
ast_fingerprints: {"src/core/profile-sync.ts#syncGlobalUserProfile":{"symbol":"src/core/profile-sync.ts#syncGlobalUserProfile","file_path":"src/core/profile-sync.ts","file":"src/core/profile-sync.ts","kind":"function","start_line":265,"end_line":387,"signature":"export function syncGlobalUserProfile(","ast_hash":"acc02721010397e3"},"src/core/workbench-actions.ts#executeWorkbenchAction":{"symbol":"src/core/workbench-actions.ts#executeWorkbenchAction","file_path":"src/core/workbench-actions.ts","file":"src/core/workbench-actions.ts","kind":"function","start_line":429,"end_line":2095,"signature":"export async function executeWorkbenchAction(","ast_hash":"0a79a99ad6815a91"},"src/core/hook-engine.ts#recordRecalledOutcomeUnified":{"symbol":"src/core/hook-engine.ts#recordRecalledOutcomeUnified","file_path":"src/core/hook-engine.ts","file":"src/core/hook-engine.ts","kind":"function","start_line":220,"end_line":279,"signature":"export function recordRecalledOutcomeUnified(","ast_hash":"5acdac688931c74f"}}
tags: []
origin: "evolved"
review_status: "pending"
created_at: "2026-11-23T20:22:23.852Z"
updated_at: "2026-11-23T20:22:23.852Z"
---

## Symptom
EvoKernel could not capture/recall non-code habits or workflows across blank chats and desktop hosts reliably, and duplicated action/hook code caused cross-host regressions.

## Root Cause
Prior Route B left 19 defects (required workspace, Windsurf/OpenCode path drift, pending-but-pushed prefs, dual hook/action split-brain, 5,987-line UI monolith) and lacked non-code personal memory, workflow directory menu, conflict guard, and onboarding.

## Solution
Extracted profile-sync.ts, workbench-actions.ts, hook-engine.ts, profile-import.ts, moved deliverable.ts to src/tools/, split ui-client.ts into src/templates/ui/, implemented 800-tok Profile Card + 250-tok Task Directory Menu + global personal memories + polarity conflict guard + 1-click undo + evo init --global.
