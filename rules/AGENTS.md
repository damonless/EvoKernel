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
- **Episodic Troubleshooting Case (`memory`)**: You diagnosed a specific bug symptom, concrete code symbol, or threshold defect — crystallize it as `kind: "memory"` (`symptom`, `root_cause`, `solution`, and `target_symbols`) so EvoKernel binds AST structural fingerprints at **0 core token cost**.
- **1-Level-Up Architectural Guardrail (`rule`)**: You discovered a cross-module methodology or class-of-bug prevention invariant — distill it as `kind: "rule"` (`l0_summary`, wildcard `scope_glob`, `core: false` by default, and `transfer_scenarios`). **SSOT Exclusion Principle**: Source code is the Single Source of Truth for concrete variable names, macros, and physical thresholds; NEVER copy magic numbers or >=3 concrete identifiers into a rule body (place concrete examples in `kind: "memory"` or a `Case Anchor:` line / `## 典型反例锚点` section).
- **User Correction (`rule` / `skill`)**: The user corrected an assumption, architectural bias, or workflow step — codify it immediately as a `rule` or `skill` (using `supersedes_id` when upgrading an existing entry; NEVER stop at `kind: "memory"` when a general engineering methodology was corrected).
- **Reusable Script (`tool`)**: You wrote a temporary script (>15 lines) to analyze, transform, or verify code — register it as a parameterized Micro-Tool (`run.{mjs|py|sh|ps1}`) with a deterministic `--self-test` verification path.
- **Visible Evolution Receipt**: Whenever you call `evo_propose` or `evo_compact`, append a single visible receipt line at the end of your response: `🧬 EvoKernel 演进回执：[<kind>] <id>（<新增/更新摘要>）`.

> **Gatekeeper Notice**: `evo_propose` enforces Static Security, Lexical De-Symbolization & 1-Level-Up Abstraction, Sandbox `--self-test` / Live AST Symbol Grounding, BM25 Deduplication, Scoped Bucket Quotas (max 3/bucket), and a strict **1,500-token core rule budget**. If `ERR_BUDGET_EXCEEDED`, `ERR_SCOPED_BUCKET_FULL`, or `ERR_DUPLICATE` is returned, use `evo_compact` to merge or archive existing entries first.
<!-- EVO:END -->
