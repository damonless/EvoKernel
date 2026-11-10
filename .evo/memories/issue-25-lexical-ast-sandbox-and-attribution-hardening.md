---
id: issue-25-lexical-ast-sandbox-and-attribution-hardening
title: "Issue #25 Lexical AST, Sandbox Process Tree, Async MCP & Scoped Attribution Hardening"
l0_summary: "Harden lexical AST raw strings/line continuations/Python blocks, sandbox tree kill, async evo_run, and grounded attribution."
created_commit: "765dd5e"
created_branch: "main"
target_symbols: ["src/core/sandbox.ts#executeSandboxedScriptAsync","src/core/memory.ts#findPythonBlockEnd","src/core/gatekeeper.ts#isValidContrastiveEvidence","src/cli/hook.ts#isCapabilityRelevantToModifiedFiles","src/cli/score.ts#isExcludedGitHotspotPath"]
ast_fingerprints: {"src/core/sandbox.ts#executeSandboxedScriptAsync":{"symbol":"src/core/sandbox.ts#executeSandboxedScriptAsync","file_path":"src/core/sandbox.ts","file":"src/core/sandbox.ts","kind":"function","start_line":420,"end_line":500,"signature":"export function executeSandboxedScriptAsync(","ast_hash":"13c270ca64304c39"},"src/core/memory.ts#findPythonBlockEnd":{"symbol":"src/core/memory.ts#findPythonBlockEnd","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":2336,"end_line":2483,"signature":"export function findPythonBlockEnd(","ast_hash":"4c4c33b385d3213f"},"src/core/gatekeeper.ts#isValidContrastiveEvidence":{"symbol":"src/core/gatekeeper.ts#isValidContrastiveEvidence","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"function","start_line":77,"end_line":236,"signature":"export function isValidContrastiveEvidence(","ast_hash":"30bd8158a2a77b81"},"src/cli/hook.ts#isCapabilityRelevantToModifiedFiles":{"symbol":"src/cli/hook.ts#isCapabilityRelevantToModifiedFiles","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":12,"end_line":73,"signature":"export function isCapabilityRelevantToModifiedFiles(","ast_hash":"23b98859fa388c7a"},"src/cli/score.ts#isExcludedGitHotspotPath":{"symbol":"src/cli/score.ts#isExcludedGitHotspotPath","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":382,"end_line":400,"signature":"export function isExcludedGitHotspotPath(filePath: string): boolean","ast_hash":"bf855f764a1ef66b"}}
tags: ["issue-25","sandbox","ast-parser","mcp","attribution","optimize"]
origin: "evolved"
review_status: "pending"
created_at: "2026-11-07T06:19:27.206Z"
updated_at: "2026-11-10T17:22:54.961Z"
---

## Symptom
Issue #25 reported 6 defects across sandbox grandchild process leaks, lexical AST parser blindspots (Rust/C++ raw strings, C++14 digit separators, backslash line continuations, Python unmasked/colonLine blocks), blocking evo_run execution, Regime 1 core rule demotion in probeCandidateInWorktree, session-wide confounded outcome attribution, and git-hotspot-analyzer path filter drift.

## Root Cause
1) Sandbox timeout only killed immediate child PID (and sync spawnSync lacked POSIX detached process group) and DANGEROUS_PATTERNS missed Python/ESM recursive FS & credential patterns; 2) maskSourceLexical/stripCStyleComments lacked Rust/C++ raw strings, C++14 digit separators, and dropped newlines on backslash line continuations, while findPythonBlockEnd missed colonLine trailing docstrings; 3) handleRun used blocking spawnSync and computeFastWorktreeStateSig cached :none on gitdir worktree files; 4) probeCandidateInWorktree Regime 1 unconditionally adopted coreTokenDelta < 0 even when demoting active uncontested core rules; 5) session attribution ignored file:symbol target_symbols and isValidContrastiveEvidence accepted ungrounded tokens; 6) git-hotspot-analyzer lacked computeGitBugHotspots path exclusions.

## Solution
Added killProcessTree and executeSandboxedScriptAsync (plus POSIX detached group on sync spawnSync) in sandbox.ts, expanded DANGEROUS_PATTERNS and workspace-grounded isValidContrastiveEvidence in gatekeeper.ts, implemented matchRustRawString/matchCppRawString/isNumericDigitSeparator/backslash-newline preservation and colonLine-aware findPythonBlockEnd in memory.ts, wired async handleRun and gitdir-aware computeFastWorktreeStateSig in handlers.ts, guarded Regime 1 in optimize.ts, used parseSymbolTarget in hook.ts, and unified hotspot path exclusions in score.ts and git-hotspot-analyzer.
