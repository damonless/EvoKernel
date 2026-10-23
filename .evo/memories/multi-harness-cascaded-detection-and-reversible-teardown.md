---
id: multi-harness-cascaded-detection-and-reversible-teardown
title: "Multi-Agent Harness Matrix and Reversible Lifecycle Memory"
l0_summary: "Multi-agent harness matrix across 10 agent harnesses with 3-stage cascaded detection, TOML engine, and zero-leftover teardown."
created_commit: "2f6a099"
target_symbols: ["src/cli/init.ts#runInit","src/cli/init.ts#runUninstall","src/cli/harness.ts#detectCascadedTargets"]
ast_fingerprints: {"src/cli/init.ts#runInit":{"symbol":"src/cli/init.ts#runInit","file_path":"src/cli/init.ts","kind":"function","start_line":266,"end_line":347,"signature":"export function runInit(","ast_hash":"f9b3208233737700"},"src/cli/init.ts#runUninstall":{"symbol":"src/cli/init.ts#runUninstall","file_path":"src/cli/init.ts","kind":"function","start_line":349,"end_line":349,"signature":"export function runUninstall(workspaceRoot: string): { cleanedFiles: string[] }","ast_hash":"d4556393b15e7748"},"src/cli/harness.ts#detectCascadedTargets":{"symbol":"src/cli/harness.ts#detectCascadedTargets","file_path":"src/cli/harness.ts","kind":"function","start_line":1108,"end_line":1148,"signature":"export function detectCascadedTargets(","ast_hash":"cd97b948d8f20e4c"}}
tags: []
origin: "evolved"
created_at: "2026-10-23T07:08:41.581Z"
updated_at: "2026-10-23T07:08:41.581Z"
---

## Symptom
Missing first-class support for Windsurf, Cline, Roo Code, Copilot, Codex CLI, and OpenCode, with leftover zombie files on uninstall and host environment leakage in auto-detection.

## Root Cause
Earlier harness support was limited to 4 targets with hardcoded MCP JSON and no TOML support; detection leaked host APPDATA into test environments instead of checking target home directory.

## Solution
Implemented HarnessAdapter interface across 10 agent targets with zero-dependency TOML upsert/remove, MDC frontmatter preservation, home-scoped 3-stage cascaded detection, and empty directory garbage collection.
