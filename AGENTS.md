<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution Protocol)

You are connected to **EvoKernel** (`evo-kernel` MCP + `.evo/` capability tree). Follow these 3 invariants strictly:

## 1. Search Before Reinventing (`evo_search` -> `evo_inspect`)
- Before debugging recurring build/test failures, writing repetitive analysis scripts, or modifying unfamiliar modules, call `evo_search` with keywords or file paths.
- `evo_search` returns ultra-compact **L0 summaries (<30 tokens each)**. Only call `evo_inspect(id, "L1" | "L2")` when an item is directly relevant.

## 2. Think in Code via Micro-Tools (`evo_run`)
- When inspecting >5 files, validating schemas, or running project diagnostics, prefer executing a verified Micro-Tool via `evo_run(tool_id, args)` instead of dumping raw file contents into the context window.

## 3. Mandatory Experience Crystallization (`evo_propose` & `evo_compact`)
Whenever ANY of the following occurs in this session, you MUST call `evo_propose` before finishing your final response:
- **Bug Recovery (`rule`)**: You hit a non-trivial error, root-caused it, and verified the fix — distill the prevention rule (`l0_summary`, `scope_glob`, and actionable guardrails).
- **User Correction (`rule` / `skill`)**: The user corrected an assumption, architectural bias, or workflow step — codify it immediately so the mistake is never repeated.
- **Reusable Script (`tool`)**: You wrote a temporary script (>15 lines) to analyze, transform, or verify code — register it as a parameterized Micro-Tool (`run.{mjs|py|sh|ps1}`) with a deterministic `--self-test` verification path.

> **Gatekeeper Notice**: `evo_propose` enforces AST/syntax checks, sandboxed `--self-test` dry-runs (exit code `0`), BM25 duplicate detection, and a strict **1,500-token core rule budget**. If `ERR_BUDGET_EXCEEDED` or `ERR_DUPLICATE` is returned, use `evo_compact` to merge and deduplicate existing entries first.

## 4. Evolved Core Invariants (Auto-Managed by EvoKernel)
- **[gatekeeper-self-test-invariant]** (`.evo/tools/**/*`): Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically.
  When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:
  - The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.
  - Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.
- **[esm-typescript-imports]** (`src/**/*.ts`): Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript.
  1. Use explicit `.js` file extensions in relative module imports (e.g., `import { EvoStorage } from "./storage.js"`).
  2. Always use `import type { ... }` when importing TypeScript interfaces or type aliases so native Node type-stripping (`node:module.stripTypeScriptTypes`) never fails at runtime.
  3. Prefer built-in Node.js modules (`node:fs`, `node:path`, `node:sqlite`, `node:test`) over third-party npm packages to preserve zero-dependency security.
<!-- EVO:END -->
