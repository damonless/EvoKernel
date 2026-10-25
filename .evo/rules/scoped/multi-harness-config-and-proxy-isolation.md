---
id: multi-harness-config-and-proxy-isolation
title: "Multi-Harness Config Merging, Hook Separation & MCP Proxy Isolation Guardrail"
l0_summary: "Enforce safe config merging, agent-specific detection, read/write hook separation, and per-workspace case-preserving proxy routing."
scope_glob: "src/{cli,mcp}/**/*.ts"
core: false
priority: 90
tokens: 341
origin: "evolved"
supersedes_id: "multi-harness-config-and-proxy-isolation"
transfer_scenarios: ["Multi-agent CLI harness configuration adapters and TOML/JSON mergers","Lifecycle hook routers and stdio JSON-RPC proxy multiplexers"]
created_at: "2026-10-23T09:28:08.219Z"
updated_at: "2026-10-25T16:06:27.562Z"
---

When adding or modifying host agent harness adapters, lifecycle hooks, or MCP proxy integrations:
1. Preserve non-destructive configuration merging across JSON, TOML, YAML, and Markdown frontmatter files; track bracket depth and multi-line comments when parsing section blocks, and never overwrite self-bootstrapping plugin manifests.
2. Isolate environment auto-detection to agent-specific process markers rather than generic provider API keys or bare editor settings directories.
3. Decouple read-only file inspection from mutation debt tracking in lifecycle hooks while preserving active scoped rule recall, and support piped standard input payloads when CLI flags are omitted.
4. Isolate downstream proxy connections per workspace context with configuration-hash invalidation, preserve exact case for external tool identifiers prior to local ID sanitization, and terminate child process trees on handshake timeout.

## 典型反例锚点
Case Anchor: `.evo/memories/multi-harness-cascaded-detection-and-reversible-teardown.md` (`src/cli/harness.ts`, `src/cli/hook.ts`, `src/mcp/handlers.ts`, `src/mcp/proxy.ts`)
