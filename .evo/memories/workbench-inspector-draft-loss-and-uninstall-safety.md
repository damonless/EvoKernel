---
id: workbench-inspector-draft-loss-and-uninstall-safety
title: "Workbench inspector draft preservation and uninstall safety guardrails"
l0_summary: "SSE/Esc wiped Workbench inspector drafts and runUninstall lacked --dry-run/--purge/MCP-restore safety."
created_commit: "a703e18"
created_branch: "main"
target_symbols: ["src/templates/ui/client-script.ts#rerenderAllViews","src/cli/init.ts#runUninstall"]
ast_fingerprints: {"src/templates/ui/client-script.ts#rerenderAllViews":{"symbol":"src/templates/ui/client-script.ts#rerenderAllViews","file_path":"src/templates/ui/client-script.ts","file":"src/templates/ui/client-script.ts","kind":"function","start_line":235,"end_line":355,"signature":"function rerenderAllViews()","ast_hash":"474ee2b7bebdef4e"},"src/cli/init.ts#runUninstall":{"symbol":"src/cli/init.ts#runUninstall","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":2191,"end_line":2399,"signature":"export function runUninstall(","ast_hash":"d5996ce1d0a46863"}}
tags: []
origin: "evolved"
created_at: "2026-11-24T18:20:24.875Z"
updated_at: "2026-11-25T07:25:08.395Z"
---

## Symptom
Editing rules in Workbench silently lost drafts on background refresh or Escape, and evo uninstall docs contradicted actual .evo/ preservation.

## Root Cause
rerenderAllViews overwrote inspector textarea value on SSE/VSCode push, global Escape cleared selectedCapability inside textareas, and runUninstall omitted mcp-pool auto-restore and --dry-run/--purge separation.

## Solution
Track editorDirty with inline background-update banner and blur-only Escape, and add --dry-run/--purge/auto-restoreVirtualizedMcps + global MCP cleanup to runUninstall.
