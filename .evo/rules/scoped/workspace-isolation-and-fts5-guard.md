---
id: workspace-isolation-and-fts5-guard
title: "Workspace Isolation, Stealth Git Exclusion, Cross-Language Recall & FTS5 Search Guard"
l0_summary: "Isolate ~/.evo/global fallback, resolve parent git, guard zero-hit queries, and expand cross-language FTS5 search."
scope_glob: "src/**/*.ts"
core: false
priority: 50
tokens: 506
origin: "evolved"
supersedes_id: "workspace-isolation-and-fts5-guard"
transfer_scenarios: ["Cross-platform filesystem path normalization and parent boundary discovery","Search engine zero-match semantics and optional native database module degradation"]
created_at: "2026-10-15T17:25:28.446Z"
updated_at: "2026-10-26T14:01:55.312Z"
---

When managing workspace boundaries, stealth exclusions, telemetry indexing, or search retrieval:
1. Fall back to the designated user global directory (or environment override) when no local capability folder exists or when navigating inside host plugin directories; treat the distribution repository strictly as an immutable seed source.
2. In stealth git configuration, traverse parent directories to identify the true repository root (supporting worktrees and subpackages), registering both root-relative and subpath patterns into the local exclude file.
3. On Windows platforms, resolve filesystem paths through native realpath resolution before evaluating containment against user profile or temporary directories, preventing short-name alias bypasses.
4. When executing text search, limit full-index fallback dumping exclusively to empty query tokens; any non-empty query returning zero index matches must return an empty result list without polluting agent context.
5. Provide automatic degradation when SQLite full-text search extensions are absent in the host runtime, maintaining shadow fallback indexes with equivalent scoring parity.
6. Expand cross-language technical synonyms and hardware designator patterns during query tokenization, index capability identifier sub-tokens and schema property descriptions, and deduplicate capabilities across core and scoped directories using upsert semantics.

## 典型反例锚点
Case Anchor: `.evo/memories/git-fix-d0d4e13.md`, `.evo/memories/git-fix-387153f.md`, `.evo/memories/issue-8-workspace-isolation-and-atomic-compact.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md` (`src/cli/index.ts`, `src/cli/init.ts`, `src/core/telemetry.ts`, `src/core/storage.ts`, `src/mcp/handlers.ts`)
