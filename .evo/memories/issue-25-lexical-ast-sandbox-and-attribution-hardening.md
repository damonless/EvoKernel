---
id: issue-25-lexical-ast-sandbox-and-attribution-hardening
title: "Issue #25 Lexical AST, Sandbox Process Tree, Async MCP & Scoped Attribution Hardening"
l0_summary: "Harden lexical AST raw strings/digit separators/Python blocks, sandbox tree kill, async evo_run, Regime 1 guard, and scoped attribution."
created_commit: "8553669"
created_branch: "main"
target_symbols: ["src/core/sandbox.ts#executeSandboxedScriptAsync","src/core/memory.ts#findPythonBlockEnd","src/core/gatekeeper.ts#isValidContrastiveEvidence","src/cli/hook.ts#isCapabilityRelevantToModifiedFiles","src/cli/score.ts#isExcludedGitHotspotPath"]
ast_fingerprints: {"src/core/sandbox.ts#executeSandboxedScriptAsync":{"symbol":"src/core/sandbox.ts#executeSandboxedScriptAsync","file_path":"src/core/sandbox.ts","file":"src/core/sandbox.ts","kind":"function","start_line":345,"end_line":424,"signature":"export function executeSandboxedScriptAsync(","ast_hash":"3d6d30f19f3a2b22"},"src/core/memory.ts#findPythonBlockEnd":{"symbol":"src/core/memory.ts#findPythonBlockEnd","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":1596,"end_line":1701,"signature":"export function findPythonBlockEnd(","ast_hash":"6d996e0b3192a073"},"src/core/gatekeeper.ts#isValidContrastiveEvidence":{"symbol":"src/core/gatekeeper.ts#isValidContrastiveEvidence","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"function","start_line":54,"end_line":106,"signature":"export function isValidContrastiveEvidence(","ast_hash":"b661c405cab2c7cc"},"src/cli/hook.ts#isCapabilityRelevantToModifiedFiles":{"symbol":"src/cli/hook.ts#isCapabilityRelevantToModifiedFiles","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":11,"end_line":63,"signature":"export function isCapabilityRelevantToModifiedFiles(","ast_hash":"d1e02a44e7e7903b"},"src/cli/score.ts#isExcludedGitHotspotPath":{"symbol":"src/cli/score.ts#isExcludedGitHotspotPath","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":382,"end_line":400,"signature":"export function isExcludedGitHotspotPath(filePath: string): boolean","ast_hash":"bf855f764a1ef66b"}}
tags: ["issue-25","sandbox","ast-parser","mcp","attribution","optimize"]
origin: "evolved"
review_status: "pending"
created_at: "2026-11-07T06:19:27.206Z"
updated_at: "2026-11-07T06:19:27.206Z"
---

## Symptom
Issue #25 reported 6 defects across sandbox grandchild process leaks, lexical AST parser blindspots (Rust/C++ raw strings, C++14 digit separators, Python unmasked blocks), blocking evo_run execution, Regime 1 core rule demotion in probeCandidateInWorktree, session-wide confounded outcome attribution, and git-hotspot-analyzer path filter drift.

## Root Cause
1) Sandbox timeout only killed the immediate child PID and lacked recursive FS/credential patterns; 2) maskSourceLexical/stripCStyleComments lacked Rust/C++ raw string and C++14 digit separator support and findPythonBlockEnd scanned unmasked lines; 3) handleRun used blocking spawnSync; 4) probeCandidateInWorktree Regime 1 unconditionally adopted coreTokenDelta < 0 even when demoting active uncontested core rules; 5) session attribution penalized/rewarded all recalled capabilities regardless of modified file scope and Gate 1.5 accepted 12-char filler contrastive_evidence; 6) git-hotspot-analyzer lacked computeGitBugHotspots path exclusions.

## Solution
Added killProcessTree and executeSandboxedScriptAsync in sandbox.ts, expanded DANGEROUS_PATTERNS and added isValidContrastiveEvidence in gatekeeper.ts, implemented matchRustRawString/matchCppRawString/isNumericDigitSeparator and masked/multiline-aware findPythonBlockEnd in memory.ts, wired async handleRun and fast worktree signature gating in handlers.ts, guarded Regime 1 against active uncontested core rule drops in optimize.ts, filtered session outcomes by modified files in hook.ts, and unified hotspot path exclusions in score.ts and git-hotspot-analyzer.
