# Core Invariants (Auto-Generated Digest — Do Not Edit Directly)

- **[gatekeeper-self-test-invariant]** (`.evo/tools/**/*`): Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically.
  When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:
  - The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.
  - Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.
  - Historical fix commits analyzed (3 commits): 387153f fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5) | d0d4e13 fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets, and add FTS5 fallback (Closes #1, Closes #3) | a812bc7 fix(hygiene): remove private embedded BMS rule and FSM skill from open-source repo (Refs #1)
- **[esm-typescript-imports]** (`src/**/*.ts`): Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript.
  1. Use explicit `.js` file extensions in relative module imports (e.g., `import { EvoStorage } from "./storage.js"`).
  2. Always use `import type { ... }` when importing TypeScript interfaces or type aliases so native Node type-stripping (`node:module.stripTypeScriptTypes`) never fails at runtime.
  3. Prefer built-in Node.js modules (`node:fs`, `node:path`, `node:sqlite`, `node:test`) over third-party npm packages to preserve zero-dependency security.
