---
id: workspace-isolation-and-fts5-guard
title: "Global Fallback Isolation, Parent Git Stealth & SQLite FTS5 Resilience Guardrail"
l0_summary: "Isolate global fallback to ~/.evo/global, walk parent dirs for .git/info/exclude, and keep SQLite FTS5 fallback table synced."
scope_glob: "src/**/*.ts"
core: false
priority: 50
tokens: 258
origin: "evolved"
created_at: "2026-10-15T17:25:28.446Z"
updated_at: "2026-10-15T17:25:28.446Z"
---

1. **Global Fallback Isolation**: `resolveWorkspaceRoot` must fall back to `~/.evo/global` (or `EVO_GLOBAL_DIR`) when no local `.evo/` exists, treating the EvoKernel installation directory strictly as a read-only seed source so project-specific capabilities never pollute the open-source repository.
2. **Parent Git Root Discovery (`--stealth`)**: Always resolve `.git` via `findGitRoot(workspaceRoot)` (supporting parent `.git` directories and worktree `.git` files) and write both `<pattern>` and `/<relPrefix>/<pattern>` into `<gitRoot>/.git/info/exclude`.
3. **Node v22 SQLite FTS5 Resilience**: Wrap `CREATE VIRTUAL TABLE ... USING fts5` in `try/catch` and maintain `capability_fts_fallback` so Windows Node.js v22.5–v22.14 builds without `SQLITE_ENABLE_FTS5` degrade cleanly to in-memory BM25 scoring.
