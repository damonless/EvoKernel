---
id: issue-27-red-team-edge-cases-hardening
title: "Issue #27: Deep Worktree Sig, IDE Update-Content Parity, C++/Rust Lexical AST Edge Cases, Dangerous Patterns & Async Sandbox Tree Kill"
l0_summary: "Deep worktree sig blindspot, IDE update-content split, C++ //\\\\ & Rust char AST desync, and rm/ssh bypass -> harden all 6 edges"
created_commit: "e8e6626"
created_branch: "main"
target_symbols: ["src/mcp/handlers.ts#EvoMcpDispatcher.computeFastWorktreeStateSig","src/ide/vscode-extension.ts#handleWebviewAction","src/core/memory.ts#maskSourceLexical","src/core/memory.ts#stripCStyleComments","src/core/gatekeeper.ts#isValidContrastiveEvidence","src/core/sandbox.ts#killProcessTreeAsync"]
ast_fingerprints: {"src/mcp/handlers.ts#EvoMcpDispatcher.computeFastWorktreeStateSig":{"symbol":"src/mcp/handlers.ts#EvoMcpDispatcher.computeFastWorktreeStateSig","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":307,"end_line":387,"signature":"private computeFastWorktreeStateSig(workspaceRoot: string, gitRoot: string): string","ast_hash":"ee822e60fefbce63"},"src/ide/vscode-extension.ts#handleWebviewAction":{"symbol":"src/ide/vscode-extension.ts#handleWebviewAction","file_path":"src/ide/vscode-extension.ts","file":"src/ide/vscode-extension.ts","kind":"function","start_line":356,"end_line":1164,"signature":"export async function handleWebviewAction(","ast_hash":"1bb3edf9e171232a"},"src/core/memory.ts#maskSourceLexical":{"symbol":"src/core/memory.ts#maskSourceLexical","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":428,"end_line":835,"signature":"export function maskSourceLexical(","ast_hash":"b90334b672469355"},"src/core/memory.ts#stripCStyleComments":{"symbol":"src/core/memory.ts#stripCStyleComments","file_path":"src/core/memory.ts","file":"src/core/memory.ts","kind":"function","start_line":837,"end_line":1050,"signature":"export function stripCStyleComments(input: string, ext?: string): string","ast_hash":"19ce82c90bce3cfd"},"src/core/gatekeeper.ts#isValidContrastiveEvidence":{"symbol":"src/core/gatekeeper.ts#isValidContrastiveEvidence","file_path":"src/core/gatekeeper.ts","file":"src/core/gatekeeper.ts","kind":"function","start_line":77,"end_line":236,"signature":"export function isValidContrastiveEvidence(","ast_hash":"30bd8158a2a77b81"},"src/core/sandbox.ts#killProcessTreeAsync":{"symbol":"src/core/sandbox.ts#killProcessTreeAsync","file_path":"src/core/sandbox.ts","file":"src/core/sandbox.ts","kind":"function","start_line":246,"end_line":280,"signature":"export async function killProcessTreeAsync(pid: number | undefined): Promise<void>","ast_hash":"e9b54ad5e95eafd8"}}
tags: ["issue-27","worktree-sig","update-content-parity","lexical-ast","gatekeeper-security","async-sandbox"]
origin: "evolved"
review_status: "pending"
created_at: "2026-11-07T19:42:46.234Z"
updated_at: "2026-11-14T04:48:40.032Z"
---

## Symptom
1) Unstaged edits at depth > 4 miss dirty-tree reminder; 2) VS Code extension update-content drops frontmatter fields and overwrites Memory branch provenance; 3) C/C++ //\\ continuations, Rust lifetimes, and ['🦀','{'] corrupt AST scanner; 4) fsPromises.rm and .ssh/id_ecdsa bypass Gate 1; 5) Async sandbox timeout blocks event loop; 6) fake1.ts:for passes contrastive grounding.

## Root Cause
1) computeFastWorktreeStateSig stopped at depth 4 without tracking hasUnscannedDeepDir; 2) handleWebviewAction update-content ignored frontmatter fields and evaluateAndCommit overwrote Memory created_commit/created_branch; 3) maskSourceLexical/stripCStyleComments lacked C/C++ // backslash continuation, Rust lifetime guards, and UTF-16 surrogate pair codePointAt length checks; 4) DANGEROUS_PATTERNS missed fs.rm/fsPromises.rm/rmSync and non-whitelisted .ssh files; 5) executeSandboxedScriptAsync called sync killProcessTree; 6) isValidContrastiveEvidence fell back to 3-char substring matching on fake file:sym tokens.

## Solution
1) Track hasUnscannedDeepDir at depth >= 8 in computeFastWorktreeStateSig; 2) Align VS Code extension update-content frontmatter parsing with Web UI and preserve Memory created_commit/created_branch when target_symbols are unchanged; 3) Support C/C++ // backslash continuation, Rust lifetimes in stripCStyleComments, and codePointAt surrogate pair length in maskSourceLexical; 4) Expand DANGEROUS_PATTERNS and require existing workspace file + word-boundary >=4 char symbol in isValidContrastiveEvidence; 5) Add killProcessTreeAsync and migrate run-tool-test to executeSandboxedScriptAsync.
