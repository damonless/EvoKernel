---
id: multi-harness-config-and-proxy-isolation
title: "Multi-Harness Config Merging & MCP Proxy Schema Isolation Guardrail"
l0_summary: "Enforce non-destructive config merging, isolated env detection, EISDIR guards, and fixed-schema MCP proxy routing across agent harnesses."
scope_glob: "src/{cli,mcp}/**/*.ts"
core: false
priority: 50
tokens: 301
origin: "evolved"
created_at: "2026-10-23T09:28:08.219Z"
updated_at: "2026-10-23T09:28:08.219Z"
---

When adding or modifying host agent harness adapters, lifecycle hooks, or MCP proxy integrations:
1. Preserve non-destructive configuration merging across JSON, JSONC, TOML, YAML, and Markdown frontmatter files so existing user settings and comments are never clobbered.
2. Isolate environment auto-detection to explicit workspace paths and injectable home directory parameters rather than leaking ambient host process environment variables during automated tests.
3. Route external downstream tools through local search and execution indirection without mutating top-level MCP tool schemas, preserving prompt cache stability.
4. Guard file system probes against directory-name collisions (`isFile()` checks before `readFileSync`) and preserve whitespace in git status path parsing.

## 典型反例锚点
Case Anchor: `.evo/memories/multi-harness-cascaded-detection-and-reversible-teardown.md` (`src/cli/harness.ts`, `src/cli/hook.ts`, `src/mcp/proxy.ts`)
