---
id: core-architecture-and-ast-invariants-guard
title: "Atomic Compaction, Code-Extension Scope Scanning & AST Comment Grounding Guardrail"
l0_summary: "Enforce dry-run validation before capability deletion, scan code files independently of docs, and strip comments before AST matching."
scope_glob: "src/core/**/*.ts"
core: false
priority: 70
tokens: 380
origin: "evolved"
transfer_scenarios: ["Transactional capability compaction and atomic rollback across storage entities","Polyglot workspace language detection and comment-resilient AST symbol parsing"]
created_at: "2026-10-26T05:50:00.000Z"
updated_at: "2026-10-26T05:50:00.000Z"
---

When modifying kernel lifecycle handlers, workspace telemetry analyzers, or AST symbol grounding pipelines:
1. Guarantee atomicity during capability compaction and archival: perform a complete dry-run validation of merged proposals through the gatekeeper before deleting or archiving any source items, verify that at least two distinct target items exist, and preserve original creation timestamps when consolidating under an existing identifier.
2. In workspace language and extension scanning, decouple code-file discovery quotas from total filesystem entry traversal, deprioritizing documentation, third-party vendor, and asset directories to prevent voluminous non-code files from starving programming language detection.
3. Prior to executing lexical pattern analysis, regular expression matching, or AST symbol declaration parsing, strip single-line comments, inline block comments, and unclosed trailing block comments so that syntax delimiters inside comments do not corrupt symbol grounding or statement classification.

## 典型反例锚点
Case Anchor: `.evo/memories/issue-8-workspace-isolation-and-atomic-compact.md` (`src/mcp/handlers.ts#handleCompact`, `src/core/telemetry.ts#collectWorkspaceCodeExtensions`, `src/core/memory.ts#findSymbolDeclarationInLines`)
