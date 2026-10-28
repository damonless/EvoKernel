---
id: multi-harness-config-and-proxy-isolation
title: "Multi-Harness Config Merging, Hook State Retention & MCP Proxy Isolation Guardrail"
l0_summary: "Enforce safe config merging, agent detection, multi-step/read-only hook watermarks, L2 search directives, and Windows/roots proxy handshake."
scope_glob: "src/{cli,mcp}/**/*.ts"
core: false
priority: 50
tokens: 742
origin: "evolved"
supersedes_id: "multi-harness-config-and-proxy-isolation"
transfer_scenarios: ["Implementing or updating multi-agent configuration adapters and uninstallers in src/cli/harness.ts and src/cli/init.ts","Hardening PreInvocation/PostTool/Stop lifecycle hooks and MCP proxy dispatchers in src/cli/hook.ts, scripts/antigravity_hook.mjs, src/mcp/handlers.ts, and src/mcp/proxy.ts"]
created_at: "2026-10-23T09:28:08.219Z"
updated_at: "2026-10-28T05:45:32.086Z"
---

When adding or modifying host agent harness adapters, lifecycle hooks, or MCP proxy integrations:
1. Preserve non-destructive configuration merging across JSON, TOML, YAML, and Markdown frontmatter files; track bracket depth and multi-line comments when parsing section blocks, sync and audit plugin-level rule files alongside root rule files across rule/tool/skill proposals (reading the latest on-disk seed template so long-running MCP servers never regress managed blocks), and wire all plugin and workspace MCP manifests to zero-build bootstrap entrypoints that auto-compile missing build outputs cleanly without polluting standard output.
2. Isolate environment auto-detection to agent-specific process markers rather than generic provider API keys or bare editor settings directories.
3. Decouple read-only file inspection from mutation debt tracking in post-tool lifecycle hooks while preserving active scoped rule recall, and support piped standard input payloads when CLI flags are omitted.
4. Isolate downstream proxy connections per workspace context with configuration-hash invalidation, resolve bare command shims across platform search paths on Windows before spawning child processes, advertise workspace root capabilities and answer server-initiated root-list or liveness requests during protocol handshake, preserve exact case for external tool identifiers prior to local ID sanitization, and terminate child process trees on handshake timeout.
5. In multi-step turn hooks and search handlers, persist cleared watermarks to disk before early-return exits so tail-window truncation never resurrects resolved triggers, retain pending user-correction, error-recovery, and subagent-wakeup flags across intermediate pre-invocation steps while enforcing step-cooldown intervals, track deep diagnostic investigations across read and search tools even when minor edits (< 4) occur (including virtualized codegraph calls while excluding relative and absolute internal meta directories), match rhetorical counter-questions and empirical contradictions in user feedback, resolve command outputs across adjacent transcript steps, and emit explicit L2 inspection directives when search matches active guardrails, SOPs, or verified memories.

## 典型反例锚点
Case Anchor: `.evo/memories/multi-harness-cascaded-detection-and-reversible-teardown.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md` (`src/cli/harness.ts`, `src/cli/init.ts`, `src/cli/hook.ts`, `scripts/antigravity_hook.mjs`, `src/mcp/handlers.ts`, `src/mcp/proxy.ts#resolveWindowsSpawnCommand`, `src/mcp/proxy.ts#McpClientConnection`)
