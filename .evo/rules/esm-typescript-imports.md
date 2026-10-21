---
id: esm-typescript-imports
title: "NodeNext ESM TypeScript Import Invariant"
l0_summary: "Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript."
scope_glob: "src/**/*.ts"
core: true
priority: 85
tokens: 154
origin: "bootstrap"
created_at: "2026-10-14T16:00:40.634Z"
updated_at: "2026-10-21T15:14:00.816Z"
---

1. Use explicit `.js` file extensions in relative module imports (e.g., `import { EvoStorage } from "./storage.js"`).
2. Always use `import type { ... }` when importing TypeScript interfaces or type aliases so native Node type-stripping (`node:module.stripTypeScriptTypes`) never fails at runtime.
3. Prefer built-in Node.js modules (`node:fs`, `node:path`, `node:sqlite`, `node:test`) over third-party npm packages to preserve zero-dependency security.
