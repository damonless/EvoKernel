---
id: multi-harness-config-and-proxy-isolation
title: "Multi-Harness Config Merging, Lossless Virtualize Restore, Decoupled Audit Budgets & MCP Proxy Isolation Guardrail"
l0_summary: "Enforce lossless config merge/restore, fail-closed on unparseable user configs, precise hook ownership matching, and proxy roots."
scope_glob: "src/{cli,mcp}/**/*.ts"
core: false
priority: 50
tokens: 906
origin: "evolved"
supersedes_id: "multi-harness-config-and-proxy-isolation"
confidence: "high"
contrastive_evidence: "Before: corrupt host hook/settings JSON fell back to an empty object and was overwritten or unlinked; after: parse failure aborts the write and the file stays byte-identical (regression tests added)."
transfer_scenarios: ["Host agent settings/hooks JSON merging during init, hook sync and uninstall","Read-only MCP gateway calls against uninitialized workspaces that must not create state directories","Any CLI that rewrites user-owned TOML/YAML/JSON config files"]
created_at: "2026-10-23T09:28:08.219Z"
updated_at: "2026-10-31T18:37:25.128Z"
---

When adding or modifying host agent harness adapters, lifecycle hooks, configuration auditors, or MCP proxy integrations:
1. Preserve non-destructive configuration merging and lossless round-trip restoration across JSON, TOML, YAML, and Markdown frontmatter files: track bracket depth, inline comments, and both bare and quoted section identifiers when parsing TOML tables; record whether gateway entries were newly injected during virtualization so restoration removes auto-injected blocks while preserving pre-existing entries; decouple on-demand skill token budgets from custom always-on rule budget overrides unless explicitly specified; quote any YAML scalar values containing colon-space sequences; and wire all manifests to zero-build bootstrap entrypoints.
2. Isolate environment auto-detection to agent-specific process markers rather than generic provider API keys or bare editor settings directories.
3. Decouple read-only file inspection from mutation debt tracking in post-tool lifecycle hooks while preserving active scoped rule recall, and support piped standard input payloads when CLI flags are omitted.
4. Isolate downstream proxy connections per workspace context with configuration-hash invalidation, resolve bare command shims across platform search paths on Windows before spawning child processes, advertise workspace root capabilities and answer server-initiated root-list or liveness requests during protocol handshake, preserve exact case for external tool identifiers prior to local ID sanitization, and terminate child process trees on handshake timeout.
5. In multi-step turn hooks and search handlers, persist cleared watermarks to disk before early-return exits, retain pending user-correction, error-recovery, and subagent-wakeup flags across intermediate pre-invocation steps while enforcing step-cooldown intervals, track deep diagnostic investigations across read and search tools, and emit explicit L2 inspection directives when search matches active guardrails, SOPs, or verified memories.
6. Fail closed on user-owned config files: when an existing file fails to parse or its root is not an object, skip the write entirely (never fall back to an empty object and then overwrite or unlink); only rewrite or delete a file when an owned entry was actually removed; when filtering nested hook lists, keep an entry unchanged if filtering removed nothing and drop it only if something was removed and the remainder is empty.
7. Decide hook ownership by the actual executable entrypoint plus the expected event, anchored on path separators or command start, and resolve package ownership from the innermost dependency-folder segment; never substring-match raw file text or arbitrary command tails.
8. Read-only gateway calls must not create state directories: construct telemetry and gatekeeper lazily, and validate write-tool payloads before binding or initializing a workspace.

## 典型反例锚点
Case Anchor: `.evo/memories/multi-harness-cascaded-detection-and-reversible-teardown.md`, `.evo/memories/codex-hooks-corrupt-file-unlink.md`, `.evo/memories/harness-hook-filter-preserve-untouched-entries.md` (`src/cli/harness.ts`, `src/cli/hook.ts`, `src/mcp/handlers.ts#EvoMcpDispatcher`, `src/mcp/proxy.ts#McpClientConnection`)
