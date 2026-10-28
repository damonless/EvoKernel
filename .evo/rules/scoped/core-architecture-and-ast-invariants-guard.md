---
id: core-architecture-and-ast-invariants-guard
title: "Atomic Compaction, Code-Extension Scope Scanning, AST Comment Grounding, Clause Diff & Multi-Branch Memory Guardrail"
l0_summary: "Enforce dry-run compaction, code-only scope scanning, comment-stripped AST matching, CJK clause diffing, and multi-branch AST verification."
scope_glob: "src/core/**/*.ts"
core: false
priority: 50
tokens: 640
origin: "evolved"
supersedes_id: "core-architecture-and-ast-invariants-guard"
transfer_scenarios: ["Transactional capability compaction and atomic rollback across storage entities","Polyglot workspace language detection and comment-resilient AST symbol parsing","Git-topology-aware multi-branch AST memory verification distinguishing parallel branches from stale drift"]
created_at: "2026-10-26T05:50:00.000Z"
updated_at: "2026-10-28T17:29:47.444Z"
---

When modifying kernel lifecycle handlers, workspace telemetry analyzers, or AST symbol grounding pipelines:
1. Guarantee atomicity during capability compaction and archival: perform a complete dry-run validation of merged proposals through the gatekeeper before deleting or archiving any source items, verify that at least two distinct target items exist, and preserve original creation timestamps when consolidating under an existing identifier.
2. In workspace language and extension scanning, decouple code-file discovery quotas from total filesystem entry traversal, deprioritizing documentation, third-party vendor, and asset directories to prevent voluminous non-code files from starving programming language detection.
3. Prior to executing lexical pattern analysis, regular expression matching, or AST symbol declaration parsing, strip single-line comments, inline block comments, and unclosed trailing block comments so that syntax delimiters inside comments do not corrupt symbol grounding or statement classification, and fail immediately when an explicitly hinted file lacks the target symbol rather than falling back across the workspace.
4. When upgrading or compacting rules, inherit existing core status and transferability scenarios unless explicitly overridden, validate full rendered host file budgets alongside raw rule token caps, strip case-anchor sections before clause-diff comparison, and tokenize East Asian text into overlapping character bigrams so minor edits do not trigger false-positive clause-loss warnings.
5. In AST episodic memory verification across multi-branch repositories, evaluate symbols against the live working tree first; when a symbol is absent in current HEAD, check Git ancestry of the recorded commit before declaring drift so parallel-branch memories verified at their recorded commit are classified as branch-scoped rather than stale.

## 典型反例锚点
Case Anchor: `.evo/memories/issue-8-workspace-isolation-and-atomic-compact.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md` (`src/mcp/handlers.ts#handleCompact`, `src/core/telemetry.ts#collectWorkspaceCodeExtensions`, `src/core/memory.ts#verifyMemoryFreshness`, `src/core/gatekeeper.ts#tokenizeClauseText`)
