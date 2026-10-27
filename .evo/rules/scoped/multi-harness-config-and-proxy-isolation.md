---
id: multi-harness-config-and-proxy-isolation
title: "Multi-Harness Config Merging, Hook State Retention & MCP Proxy Isolation Guardrail"
l0_summary: "Enforce safe config merging, agent detection, multi-step/read-only hook triggers, L2 search directives, and proxy isolation."
scope_glob: "src/{cli,mcp}/**/*.ts"
core: false
priority: 50
tokens: 501
origin: "evolved"
supersedes_id: "multi-harness-config-and-proxy-isolation"
transfer_scenarios: ["Adding or modifying lifecycle hook scripts for IDE coding agents and subagent workflows","Implementing MCP search handlers and multi-workspace proxy managers"]
created_at: "2026-10-23T09:28:08.219Z"
updated_at: "2026-10-27T14:04:54.410Z"
---

When adding or modifying host agent harness adapters, lifecycle hooks, or MCP proxy integrations:
1. Preserve non-destructive configuration merging across JSON, TOML, YAML, and Markdown frontmatter files; track bracket depth and multi-line comments when parsing section blocks, and never overwrite self-bootstrapping plugin manifests.
2. Isolate environment auto-detection to agent-specific process markers rather than generic provider API keys or bare editor settings directories.
3. Decouple read-only file inspection from mutation debt tracking in post-tool lifecycle hooks while preserving active scoped rule recall, and support piped standard input payloads when CLI flags are omitted.
4. Isolate downstream proxy connections per workspace context with configuration-hash invalidation, preserve exact case for external tool identifiers prior to local ID sanitization, and terminate child process trees on handshake timeout.
5. In multi-step turn hooks and search handlers, retain pending user-correction, error-recovery, and subagent-wakeup flags across intermediate pre-invocation steps while enforcing step-cooldown intervals, track deep read-only diagnostic investigations alongside file edits, match rhetorical counter-questions and empirical contradictions in user feedback, resolve command outputs across adjacent transcript steps, and emit explicit L2 inspection directives when search matches active guardrails or SOPs.

## 典型反例锚点
Case Anchor: `.evo/memories/multi-harness-cascaded-detection-and-reversible-teardown.md`, `.evo/memories/issues-10-11-12-audit-hook-and-cross-lang-recall.md` (`src/cli/harness.ts`, `src/cli/hook.ts`, `scripts/antigravity_hook.mjs`, `src/mcp/handlers.ts`, `src/mcp/proxy.ts`)
