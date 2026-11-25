---
id: issue-26-gatekeeper-bypass-and-seed-isolation
title: "Issue #26: Workbench Gatekeeper Enforcement, Local/Seed Asset Isolation, Opt-In Init & Deliverable SSOT"
l0_summary: "Resolves Issue #26: UI/IDE update-content Gatekeeper enforcement, seed/local skill isolation, opt-in init, and SSOT deliverable build."
created_commit: "a703e18"
created_branch: "main"
target_symbols: ["src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommit","src/cli/ui.ts#startUiServer","src/ide/vscode-extension.ts#handleWebviewAction","src/cli/init.ts#runInit","src/cli/init.ts#syncManagedRuleBlocks","src/core/deliverable.ts#inspectDeliverable"]
ast_fingerprints: {"src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommit":{"symbol":"src/core/gatekeeper.ts#EvoGatekeeper.evaluateAndCommit","file_path":"src/core/gatekeeper/evaluator.ts","file":"src/core/gatekeeper/evaluator.ts","kind":"method","start_line":272,"end_line":279,"signature":"public evaluateAndCommit(","ast_hash":"06220bb73ced1819"},"src/cli/ui.ts#startUiServer":{"symbol":"src/cli/ui.ts#startUiServer","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":1478,"end_line":1763,"signature":"export async function startUiServer(","ast_hash":"f4d2675f06d4b3e9"},"src/ide/vscode-extension.ts#handleWebviewAction":{"symbol":"src/ide/vscode-extension.ts#handleWebviewAction","file_path":"src/ide/vscode-extension.ts","file":"src/ide/vscode-extension.ts","kind":"function","start_line":332,"end_line":421,"signature":"export async function handleWebviewAction(","ast_hash":"4c0583d281add806"},"src/cli/init.ts#runInit":{"symbol":"src/cli/init.ts#runInit","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":1472,"end_line":1706,"signature":"export function runInit(","ast_hash":"bd0e17ffe4952e9a"},"src/cli/init.ts#syncManagedRuleBlocks":{"symbol":"src/cli/init.ts#syncManagedRuleBlocks","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":310,"end_line":451,"signature":"export function syncManagedRuleBlocks(workspaceRoot: string): string[]","ast_hash":"2ab25eea90f60e6b"},"src/core/deliverable.ts#inspectDeliverable":{"symbol":"src/core/deliverable.ts#inspectDeliverable","file_path":"src/tools/deliverable.ts","file":"src/tools/deliverable.ts","kind":"function","start_line":1795,"end_line":1882,"signature":"export function inspectDeliverable(","ast_hash":"0008413815a2ffe6"}}
tags: ["issue-26","gatekeeper-bypass","seed-isolation","deliverable-ssot","opt-in-init"]
origin: "evolved"
created_at: "2026-11-06T17:07:07.984Z"
updated_at: "2026-11-25T07:25:07.056Z"
---

## Symptom
Issue #26 audit findings: 1) Workbench and IDE extension update-content bypassed Gatekeeper security/self-test/budget checks and passed proposals were absent from gatekeeper_events; 2) Local maintenance assets and ~/.evo/global skills leaked into tracked repo files and templates/seed-evo; 3) runBuiltinOfflineProposer generated synthetic low-signal memories; 4) evo init mounted IDE extensions and ran git warmup without opt-in; 5) deliverable.ts and deliverable-canonical-inspector duplicated ~2k lines.

## Root Cause
1) ui.ts and vscode-extension.ts wrote update-content directly via fs.writeFileSync/storage.save* without EvoGatekeeper.evaluateAndCommit, and evaluateAndCommit skipped recordGatekeeperEvent on passed=true; 2) syncManagedRuleBlocks and runInit passed includeGlobal: true to formatToolsCatalogMarkdown, leaking ~/.evo/global skills into tracked repo markdown; 3) runBuiltinOfflineProposer fabricated heuristic memories without proposerCmd; 4) runInit defaulted installIde and CLI warmup to true.

## Solution
1) Route update-content in src/cli/ui.ts and src/ide/vscode-extension.ts through EvoGatekeeper.evaluateAndCommit with supersedes_id and record passed=true events; 2) Pass includeGlobal: false in syncManagedRuleBlocks/runInit, isolate local maintenance assets out of repo/seed-evo, and auto-sync SEED_RULES/SEED_SKILLS/SEED_TOOLS plus dist/core/deliverable.js in scripts/build.mjs; 3) Remove runBuiltinOfflineProposer from src/core/optimize.ts; 4) Make --install-ide and --warmup opt-in on evo init.
