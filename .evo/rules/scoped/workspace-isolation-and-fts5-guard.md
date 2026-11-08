---
id: workspace-isolation-and-fts5-guard
title: "Workspace Isolation, Host Config Routing, Harness Deduplication & FTS5 Search Guard"
l0_summary: "Isolate ~/.evo/global and host config dirs, deduplicate global audits & auto-detected harnesses, and guard FTS5 search."
scope_glob: "src/**/*.ts"
core: false
priority: 50
tokens: 770
origin: "evolved"
supersedes_id: "workspace-isolation-and-fts5-guard"
confidence: "high"
contrastive_evidence: "src/core/storage.ts:isHostGlobalConfigDir and src/mcp/handlers.ts:isHostGlobalConfigDir route host global config workspaces to ~/.evo/global instead of creating local .evo/ directories."
transfer_scenarios: ["Auditing global vs workspace capability roots without double-counting violations or misflagging multi-harness distribution files","Preventing repo-anchored scope globs and duplicate managed blocks in user-global rule directories"]
review_status: "pending"
created_at: "2026-10-15T17:25:28.446Z"
updated_at: "2026-11-08T16:59:19.507Z"
---

When managing workspace boundaries, stealth exclusions, telemetry indexing, or search retrieval:
1. Fall back to the designated user global directory (or environment override) when no local capability folder exists or when navigating inside host plugin or user-home global configuration directories; treat the distribution repository strictly as an immutable seed source and never initialize a local capability tree inside host config roots.
2. In stealth git configuration, traverse parent directories to identify the true repository root (supporting worktrees and subpackages), registering both root-relative and subpath patterns into the local exclude file.
3. On Windows platforms, resolve filesystem paths through native realpath resolution before evaluating containment against user profile or temporary directories, preventing short-name alias bypasses.
4. When executing text search, limit full-index fallback dumping exclusively to empty query tokens; any non-empty query returning zero index matches must return an empty result list without polluting agent context.
5. Provide automatic degradation when SQLite full-text search extensions are absent in the host runtime, maintaining shadow fallback indexes with equivalent scoring parity.
6. Expand cross-language technical synonyms and hardware designator patterns during query tokenization using strict case and word-boundary guards to avoid false positives on generic software tokens or hexadecimal digests, index capability identifier sub-tokens and schema property descriptions, and deduplicate capabilities across core and scoped directories using upsert semantics.
7. During workspace harness auto-detection, omit the generic fallback rule surface when dedicated workspace harness artifacts are present so multi-harness hosts do not ingest duplicate managed blocks.
8. When auditing capabilities with global inclusion enabled, skip redundant global passes whenever the target workspace resolves to the global capability root itself, and restrict repo-anchored scope-prefix and cross-file duplicate managed-block checks strictly to user-global storage and host configuration roots without flagging intentional multi-harness distribution surfaces inside a repository.

## 典型反例锚点
Case Anchor: `.evo/memories/git-fix-d0d4e13.md`, `.evo/memories/git-fix-387153f.md`, `.evo/memories/issue-8-workspace-isolation-and-atomic-compact.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md`, `.evo/memories/global-plugin-workspace-config-pollution-and-split-brain.md`, `.evo/memories/global-audit-dedup-and-repo-leak-guard.md` (`src/cli/index.ts`, `src/cli/init.ts`, `src/cli/harness.ts`, `src/cli/audit.ts`, `src/core/telemetry.ts`, `src/core/storage.ts`, `src/mcp/handlers.ts`)
