---
id: multi-harness-config-and-proxy-isolation
title: "Multi-Harness Config Merging, Hook State Retention & MCP Proxy Isolation Guardrail"
l0_summary: "Enforce safe config merging, agent detection, multi-step hook state retention, and per-workspace proxy routing."
scope_glob: "src/{cli,mcp}/**/*.ts"
core: false
priority: 90
tokens: 468
origin: "evolved"
supersedes_id: "multi-harness-config-and-proxy-isolation"
transfer_scenarios: ["Multi-agent CLI harness configuration adapters and TOML/JSON mergers","Lifecycle hook routers and stdio JSON-RPC proxy multiplexers"]
created_at: "2026-10-23T09:28:08.219Z"
updated_at: "2026-10-26T16:23:28.287Z"
---

When adding or modifying host agent harness adapters, lifecycle hooks, or MCP proxy integrations:
1. Preserve non-destructive configuration merging across JSON, TOML, YAML, and Markdown frontmatter files; track bracket depth and multi-line comments when parsing section blocks, and never overwrite self-bootstrapping plugin manifests.
2. Isolate environment auto-detection to agent-specific process markers rather than generic provider API keys or bare editor settings directories.
3. Decouple read-only file inspection from mutation debt tracking in lifecycle hooks while preserving active scoped rule recall, and support piped standard input payloads when CLI flags are omitted.
4. Isolate downstream proxy connections per workspace context with configuration-hash invalidation, preserve exact case for external tool identifiers prior to local ID sanitization, and terminate child process trees on handshake timeout.
5. In multi-step turn hooks, retain pending user-correction and error-recovery flags across intermediate pre-invocation steps until turn completion or capability crystallization while enforcing step-cooldown intervals after initial edge triggers, resolve command execution outputs across adjacent transcript steps, and unquote double-serialized transcript arguments before path or tool-name matching.

## 典型反例锚点
Case Anchor: `.evo/memories/multi-harness-cascaded-detection-and-reversible-teardown.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md` (`src/cli/harness.ts`, `src/cli/hook.ts`, `scripts/antigravity_hook.mjs`, `src/mcp/handlers.ts`, `src/mcp/proxy.ts`)
