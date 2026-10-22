<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution & Cognitive Memory Protocol)

You are connected to **EvoKernel** (`evo-kernel` MCP + `.evo/` capability & memory tree). Follow these 3 invariants strictly:

## 1. Two-Stage Cascaded Recall (`evo_search` -> `evo_inspect`)
- Before debugging recurring build/test failures, analyzing error logs/packets, or modifying unfamiliar modules, call `evo_search(query, workspace)` with error symptoms, keywords, or symbol names and your active `workspace` root path.
- `evo_search` searches **Rules, Skills, Micro-Tools, and Episodic Memories (`memory`)** with live **AST Anti-Drift verification** (`[VERIFIED]` vs `[STALE]`). Call `evo_inspect(id, tier, workspace)` on relevant hits to load SOPs or Stage 3 **Topology Penetration Anchors** (live `file:line`, signatures, and callers).
- Skip `evo_search` during non-project general chat or built-in host slash-command wizards (e.g., `/automation`, `/schedule`) when no code workspace is involved.

## 2. Think in Code via Micro-Tools (`evo_run`)
- When inspecting >5 files, validating schemas, or running project diagnostics, prefer executing a verified Micro-Tool via `evo_run(tool_id, args, workspace)` instead of dumping raw file contents into the context window.

## 3. Mandatory Experience Crystallization (`evo_propose` & `evo_compact`)
Whenever ANY of the following occurs in this session, you MUST call `evo_propose(..., workspace)` (explicitly passing `workspace`) after the fix is verified and before finishing your final response:
- **Episodic Troubleshooting Case (`memory`)**: You diagnosed a non-trivial bug symptom to concrete code symbols — crystallize the case (`symptom`, `root_cause`, `solution`, and `target_symbols`) so EvoKernel binds AST structural fingerprints for instant future recall.
- **Bug Recovery Invariant (`rule`)**: You discovered an architectural pitfall or branch macro constraint — distill the prevention rule (`l0_summary`, `scope_glob`, `core: false` by default, and actionable guardrails).
- **User Correction (`rule` / `skill`)**: The user corrected an assumption, architectural bias, or workflow step — codify it immediately as a `rule` or `skill` (using `supersedes_id` when upgrading an existing entry; NEVER stop at `kind: "memory"` when a general engineering methodology was corrected).
- **Reusable Script (`tool`)**: You wrote a temporary script (>15 lines) to analyze, transform, or verify code — register it as a parameterized Micro-Tool (`run.{mjs|py|sh|ps1}`) with a deterministic `--self-test` verification path.
- **Visible Evolution Receipt**: Whenever you call `evo_propose` or `evo_compact`, append a single visible receipt line at the end of your response: `🧬 EvoKernel 演进回执：[<kind>] <id>（<新增/更新摘要>）`.

> **Gatekeeper Notice**: `evo_propose` enforces Static Security, Sandbox `--self-test` / Live AST Symbol Grounding, BM25 Deduplication, and a strict **1,500-token core rule budget** (Episodic `memory` entries consume 0 core budget tokens). If `ERR_BUDGET_EXCEEDED` or `ERR_DUPLICATE` is returned, use `evo_compact` to merge or archive stale entries first.

## 4. Evolved Core Invariants (Auto-Managed by EvoKernel)
- **[gatekeeper-self-test-invariant]** (`.evo/tools/**/*`): Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically.
  When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:
  - The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.
  - Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.
  - Historical fix commits analyzed (3 commits): 387153f fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5) | d0d4e13 fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets, and add FTS5 fallback (Closes #1, Closes #3) | a812bc7 fix(hygiene): remove private embedded BMS rule and FSM skill from open-source repo (Refs #1)
- **[esm-typescript-imports]** (`src/**/*.ts`): Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript.
  1. Use explicit `.js` file extensions in relative module imports (e.g., `import { EvoStorage } from "./storage.js"`).
  2. Always use `import type { ... }` when importing TypeScript interfaces or type aliases so native Node type-stripping (`node:module.stripTypeScriptTypes`) never fails at runtime.
  3. Prefer built-in Node.js modules (`node:fs`, `node:path`, `node:sqlite`, `node:test`) over third-party npm packages to preserve zero-dependency security.
<!-- EVO:END -->
