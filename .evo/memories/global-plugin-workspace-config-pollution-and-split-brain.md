---
id: global-plugin-workspace-config-pollution-and-split-brain
title: "Global Plugin & Host Config Isolation, Seed Rule Scoping, and Global Surface Audit Fix"
l0_summary: "Diagnosed and fixed 4 EvoKernel global plugin/init/audit defects causing context bloat, workspace routing leaks, and split-brain."
created_commit: "afda80b"
created_branch: "main"
target_symbols: ["src/core/storage.ts#isHostGlobalConfigDir","src/core/storage.ts#isPluginOrExtensionInstallDir","src/mcp/handlers.ts#EvoMcpDispatcher.bindActiveContext","src/cli/harness.ts#detectCascadedTargets","src/cli/audit.ts#auditHarnessSurfaces"]
ast_fingerprints: {"src/core/storage.ts#isHostGlobalConfigDir":{"symbol":"src/core/storage.ts#isHostGlobalConfigDir","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":74,"end_line":87,"signature":"export function isHostGlobalConfigDir(dirPath: string, customHome?: string): boolean","ast_hash":"084b2f96d995dbfb"},"src/core/storage.ts#isPluginOrExtensionInstallDir":{"symbol":"src/core/storage.ts#isPluginOrExtensionInstallDir","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":89,"end_line":103,"signature":"export function isPluginOrExtensionInstallDir(dirPath: string): boolean","ast_hash":"5e125cb80d8c7a11"},"src/mcp/handlers.ts#EvoMcpDispatcher.bindActiveContext":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher.bindActiveContext","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":615,"end_line":742,"signature":"private bindActiveContext(toolName: string, args: Record<string, unknown>): WorkspaceContext","ast_hash":"037ee734cbc67f0d"},"src/cli/harness.ts#detectCascadedTargets":{"symbol":"src/cli/harness.ts#detectCascadedTargets","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":2103,"end_line":2151,"signature":"export function detectCascadedTargets(","ast_hash":"2bfd62da0343775b"},"src/cli/audit.ts#auditHarnessSurfaces":{"symbol":"src/cli/audit.ts#auditHarnessSurfaces","file_path":"src/cli/audit.ts","file":"src/cli/audit.ts","kind":"function","start_line":370,"end_line":785,"signature":"export function auditHarnessSurfaces(","ast_hash":"6230125b08a869d8"}}
tags: ["global-config","plugin","split-brain","token-budget","multi-harness","audit"]
origin: "evolved"
supersedes_id: "global-plugin-workspace-config-pollution-and-split-brain"
review_status: "pending"
created_at: "2026-11-07T19:44:28.033Z"
updated_at: "2026-11-10T17:54:30.196Z"
---

## Symptom
After installing EvoKernel globally or running evo init, agents receive duplicate EVO:START blocks, TypeScript rules in non-TS projects, accidental .evo/ creation in ~/.gemini, and undetected global skill frontmatter / split-brain drift.

## Root Cause
1. templates/seed-evo/rules/esm-typescript-imports.md was seeded with core: true, injecting TypeScript rules into all workspaces' Section 4. 2. detectCascadedTargets Stage 1 returned both dedicated harness adapters and generic 'agents' when AGENTS.md coexisted. 3. isPluginOrExtensionInstallDir and bindActiveContext did not classify host global config directories (~/.gemini, ~/.claude) as global fallback targets. 4. auditHarnessSurfaces, runRefactor, and agy-config-auditor omitted host global config/rules and config/skills directories.

## Solution
1. Demoted esm-typescript-imports.md to core: false (scope_glob: '**/*.{ts,tsx,mts,cts}') with Gate 1.5 transfer_scenarios and Case Anchor. 2. Updated detectCascadedTargets Stage 1 to omit generic 'agents' when dedicated workspace harnesses match. 3. Added isHostGlobalConfigDir in storage.ts and routed host global config workspaces to ~/.evo/global in bindActiveContext and resolveWorkspaceRoot. 4. Extended auditHarnessSurfaces, runRefactor --apply, and agy-config-auditor to cover global config/rules and config/skills.
