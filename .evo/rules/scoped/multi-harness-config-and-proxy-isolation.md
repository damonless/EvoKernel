---
id: multi-harness-config-and-proxy-isolation
title: "Multi-Harness Config Merging, Lossless Virtualize Restore, Decoupled Audit Budgets & MCP Proxy Isolation Guardrail"
l0_summary: "Enforce lossless config virtualization/restore, quoted TOML/YAML safety, decoupled skill budgets, hook watermarks, and proxy roots."
scope_glob: "src/{cli,mcp}/**/*.ts"
core: false
priority: 50
tokens: 738
origin: "evolved"
supersedes_id: "multi-harness-config-and-proxy-isolation"
transfer_scenarios: ["Folding and losslessly restoring third-party MCP servers across JSON and quoted-key TOML host configurations without leaving injected gateway blocks behind","Auditing decoupled rule vs on-demand skill budgets, validating GitHub Actions YAML workflows, and managing Windows batch MCP proxy handshakes"]
created_at: "2026-10-23T09:28:08.219Z"
updated_at: "2026-10-29T16:27:48.761Z"
---

When adding or modifying host agent harness adapters, lifecycle hooks, configuration auditors, or MCP proxy integrations:
1. Preserve non-destructive configuration merging and lossless round-trip restoration across JSON, TOML, YAML, and Markdown frontmatter files: track bracket depth, inline comments, and both bare and quoted section identifiers when parsing TOML tables; record whether gateway entries were newly injected during virtualization so restoration removes auto-injected blocks while preserving pre-existing entries; decouple on-demand skill token budgets from custom always-on rule budget overrides unless explicitly specified; quote any YAML scalar values containing colon-space sequences; and wire all manifests to zero-build bootstrap entrypoints.
2. Isolate environment auto-detection to agent-specific process markers rather than generic provider API keys or bare editor settings directories.
3. Decouple read-only file inspection from mutation debt tracking in post-tool lifecycle hooks while preserving active scoped rule recall, and support piped standard input payloads when CLI flags are omitted.
4. Isolate downstream proxy connections per workspace context with configuration-hash invalidation, resolve bare command shims across platform search paths on Windows before spawning child processes (avoiding in-place batch file overwrites in concurrent tests), advertise workspace root capabilities and answer server-initiated root-list or liveness requests during protocol handshake, preserve exact case for external tool identifiers prior to local ID sanitization, and terminate child process trees on handshake timeout.
5. In multi-step turn hooks and search handlers, persist cleared watermarks to disk before early-return exits so tail-window truncation never resurrects resolved triggers, retain pending user-correction, error-recovery, and subagent-wakeup flags across intermediate pre-invocation steps while enforcing step-cooldown intervals, track deep diagnostic investigations across read and search tools even when minor edits occur, match rhetorical counter-questions and empirical contradictions in user feedback, and emit explicit L2 inspection directives when search matches active guardrails, SOPs, or verified memories.

## 典型反例锚点
Case Anchor: `.evo/memories/multi-harness-cascaded-detection-and-reversible-teardown.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md` (`src/cli/virtualize.ts#runVirtualize`, `src/cli/audit.ts#runAudit`, `src/cli/harness.ts`, `src/cli/hook.ts`, `.github/workflows/publish.yml`, `src/mcp/proxy.ts#McpClientConnection`)
