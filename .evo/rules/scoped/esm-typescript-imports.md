---
id: esm-typescript-imports
title: "NodeNext ESM TypeScript Import Invariant"
l0_summary: "Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript."
scope_glob: "**/*.{ts,tsx,mts,cts}"
core: false
priority: 85
tokens: 154
origin: "bootstrap"
transfer_scenarios:
  - "Node.js ESM backend services and CLI applications"
  - "TypeScript packages using native Node type-stripping"
created_at: "2026-10-14T16:00:40.634Z"
updated_at: "2026-10-21T15:16:26.473Z"
---

1. Use explicit `.js` file extensions in relative module imports.
2. Always use `import type { ... }` when importing TypeScript interfaces or type aliases so native Node type-stripping never fails at runtime.
3. Prefer built-in Node.js modules over third-party npm packages to preserve zero-dependency security.

Case Anchor: `import { EvoStorage } from "./storage.js"`, `node:module.stripTypeScriptTypes`, `node:fs`, `node:path`, `node:sqlite`, `node:test`.
