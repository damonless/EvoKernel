---
id: core-architecture-and-ast-invariants-guard
title: "Atomic Compaction, Code-Extension Scope Scanning, AST Comment Grounding, Subdirectory Git & Case Canonicalization Guardrail"
l0_summary: "Enforce dry-run compaction, code-only scanning, comment-stripped AST matching, ./path Git lookups, and realpath case grounding."
scope_glob: "src/core/**/*.ts"
core: false
priority: 50
tokens: 728
origin: "evolved"
supersedes_id: "core-architecture-and-ast-invariants-guard"
transfer_scenarios: ["Verifying AST fingerprints and Git tree blobs inside nested monorepo or subdirectory firmware workspaces on case-insensitive Windows/macOS filesystems","Executing atomic rule compaction and multi-language workspace scanning without comment corruption or false clause-loss rejections"]
created_at: "2026-10-26T05:50:00.000Z"
updated_at: "2026-10-29T16:27:46.033Z"
---

When modifying kernel lifecycle handlers, workspace telemetry analyzers, or AST symbol grounding pipelines:
1. Guarantee atomicity during capability compaction and archival: perform a complete dry-run validation of merged proposals through the gatekeeper before deleting or archiving any source items, verify that at least two distinct target items exist, and preserve original creation timestamps when consolidating under an existing identifier.
2. In workspace language and extension scanning, decouple code-file discovery quotas from total filesystem entry traversal, deprioritizing documentation, third-party vendor, and asset directories to prevent voluminous non-code files from starving programming language detection.
3. Prior to executing lexical pattern analysis, regular expression matching, or AST symbol declaration parsing, strip single-line comments, inline block comments, and unclosed trailing block comments so that syntax delimiters inside comments do not corrupt symbol grounding or statement classification, and fail immediately when an explicitly hinted file lacks the target symbol rather than falling back across the workspace.
4. When upgrading or compacting rules, inherit existing core status and transferability scenarios unless explicitly overridden, validate full rendered host file budgets alongside raw rule token caps, strip case-anchor sections before clause-diff comparison, and tokenize East Asian text into overlapping character bigrams so minor edits do not trigger false-positive clause-loss warnings.
5. In AST episodic memory extraction and multi-branch verification, canonicalize real filesystem casing on both the workspace root and target file so case-insensitive host filesystems never record drifted casing without breaking symlinked parent directories; prefix all working-directory-relative Git revision file queries with explicit relative dot-slash notation so subdirectory workspaces resolve inside their sub-tree rather than the repository top level, fall back to case-insensitive Git tree listings on historical case drift, and restrict descendant branch discovery strictly to legacy entries that lack an explicit recorded branch name.

## 典型反例锚点
Case Anchor: `.evo/memories/issue-8-workspace-isolation-and-atomic-compact.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md` (`src/mcp/handlers.ts#handleCompact`, `src/core/telemetry.ts#collectWorkspaceCodeExtensions`, `src/core/memory.ts#extractSymbolFingerprint`, `src/core/memory.ts#verifyMemoryFreshness`, `src/core/gatekeeper.ts#tokenizeClauseText`)
