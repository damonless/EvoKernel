---
id: global-plugin-workspace-config-pollution-and-split-brain
title: "Global Plugin & Host Config Isolation, Seed Rule Scoping, and Global Surface Audit Fix"
l0_summary: "Diagnosed and fixed 4 EvoKernel global plugin/init/audit defects causing context bloat, workspace routing leaks, and split-brain."
created_commit: "37b86db"
created_branch: "main"
target_symbols: ["src/core/storage.ts#isHostGlobalConfigDir","src/core/storage.ts#isPluginOrExtensionInstallDir","src/mcp/handlers.ts#EvoMcpDispatcher.bindActiveContext","src/cli/harness.ts#detectCascadedTargets","src/cli/audit.ts#auditHarnessSurfaces"]
ast_fingerprints: {"src/core/storage.ts#isHostGlobalConfigDir":{"symbol":"src/core/storage.ts#isHostGlobalConfigDir","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":156,"end_line":169,"signature":"export function isHostGlobalConfigDir(dirPath: string, customHome?: string): boolean","ast_hash":"084b2f96d995dbfb"},"src/core/storage.ts#isPluginOrExtensionInstallDir":{"symbol":"src/core/storage.ts#isPluginOrExtensionInstallDir","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":171,"end_line":185,"signature":"export function isPluginOrExtensionInstallDir(dirPath: string): boolean","ast_hash":"5e125cb80d8c7a11"},"src/mcp/handlers.ts#EvoMcpDispatcher.bindActiveContext":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher.bindActiveContext","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":1068,"end_line":1238,"signature":"private bindActiveContext(toolName: string, args: Record<string, unknown>): RequestContext","ast_hash":"64dc5a621e96aaa1"},"src/cli/harness.ts#detectCascadedTargets":{"symbol":"src/cli/harness.ts#detectCascadedTargets","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":2290,"end_line":2338,"signature":"export function detectCascadedTargets(","ast_hash":"2bfd62da0343775b"},"src/cli/audit.ts#auditHarnessSurfaces":{"symbol":"src/cli/audit.ts#auditHarnessSurfaces","file_path":"src/cli/audit.ts","file":"src/cli/audit.ts","kind":"function","start_line":395,"end_line":897,"signature":"export function auditHarnessSurfaces(","ast_hash":"83eaaa24d175256e"}}
tags: ["global-config","plugin","split-brain","token-budget","multi-harness","audit"]
origin: "evolved"
created_at: "2026-11-07T19:44:28.033Z"
updated_at: "2026-11-24T07:28:35.511Z"
---

## Symptom
After installing EvoKernel globally or running evo init, agents receive duplicate EVO:START blocks, TypeScript rules in non-TS projects, accidental .evo/ creation in ~/.gemini, and undetected global skill frontmatter / split-brain drift.

## Root Cause
1. templates/seed-evo/rules/esm-typescript-imports.md was seeded with core: true, injecting TypeScript rules into all workspaces' Section 4. 2. detectCascadedTargets Stage 1 returned both dedicated harness adapters and generic 'agents' when AGENTS.md coexisted. 3. isPluginOrExtensionInstallDir and bindActiveContext did not classify host global config directories (~/.gemini, ~/.claude) as global fallback targets. 4. auditHarnessSurfaces, runRefactor, and agy-config-auditor omitted host global config/rules and config/skills directories.

## Solution
1. Demoted esm-typescript-imports.md to core: false (scope_glob: '**/*.{ts,tsx,mts,cts}') with Gate 1.5 transfer_scenarios and Case Anchor. 2. Updated detectCascadedTargets Stage 1 to omit generic 'agents' when dedicated workspace harnesses match. 3. Added isHostGlobalConfigDir in storage.ts and routed host global config workspaces to ~/.evo/global in bindActiveContext and resolveWorkspaceRoot. 4. Extended auditHarnessSurfaces, runRefactor --apply, and agy-config-auditor to cover global config/rules and config/skills.
