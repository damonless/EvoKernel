<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution & Cognitive Memory Protocol)

You are connected to **EvoKernel** (`evo-kernel` MCP + `.evo/` capability & memory tree). Follow these 3 invariants strictly:

## 1. Two-Stage Cascaded Recall (`evo_search` -> `evo_inspect`)
- Before debugging build/test failures, analyzing logs/packets/schematics, modifying unfamiliar modules, executing `git commit` / `git commit --amend`, or generating/editing engineering deliverables (`.xlsx`, `.xls`, `.docx`, QA/whitebox reports), call `evo_search(query, workspace)` (or `evo_inspect(id, tier, workspace)` when listed in Section 5) with relevant keywords and your active `workspace` root path.
- `evo_search` searches **Rules, Skills, Micro-Tools, and Episodic Memories (`memory`)** with live **AST Anti-Drift verification** (`[VERIFIED]` vs `[STALE]`). Never rely on `<30-token` L0 titles alone — whenever `evo_search` hits a relevant `RULE`, `SKILL`, or `[VERIFIED]` `MEMORY`, you MUST call `evo_inspect(id, tier: "L2", workspace)` to load its full verification checklist, SOP, or Stage 3 **Topology Penetration Anchors** (live `file:line`, signatures, callers) before concluding.
- Skip `evo_search` during general chat or host slash-command wizards (`/automation`, `/schedule`) when no code workspace is involved.

## 2. Think in Code via Micro-Tools (`evo_run`)
- When inspecting >5 files, validating schemas, or running project diagnostics, prefer executing a verified Micro-Tool via `evo_run(tool_id, args, workspace)` instead of dumping raw file contents into context.

## 3. Mandatory Experience Crystallization (`evo_propose` & `evo_compact`)
Whenever ANY of the following occurs in this session, you MUST call `evo_propose(..., workspace)` (explicitly passing `workspace`) after a root-cause diagnosis is confirmed (including read-only white-box troubleshooting or log-forensic sessions without code edits), after an initial hypothesis is overturned/corrected, or after a code fix/deliverable is verified — before finishing your final response:
- **Episodic Troubleshooting Case (`memory`)**: Diagnosed a specific bug symptom, code symbol, or threshold defect (even in a read-only diagnostic session with zero file edits) — crystallize as `kind: "memory"` (`symptom`, `root_cause`, `solution`, `target_symbols`) with AST fingerprints at **0 core token cost**.
- **1-Level-Up Architectural Guardrail (`rule`)**: Discovered a cross-module methodology, class-of-bug invariant, or overturned a code-reading misconception (even when zero files were modified) — distill as `kind: "rule"` (`l0_summary`, wildcard `scope_glob`, `core: false` by default, `transfer_scenarios`). **SSOT Exclusion Principle**: Source code is the Single Source of Truth for concrete variable names, macros, and physical thresholds; NEVER copy magic numbers or >=3 concrete identifiers into a rule body (place concrete examples in `kind: "memory"` or a `Case Anchor:` / `## 典型反例锚点` section).
- **User Correction / Deliverable Feedback (`rule` / `skill`)**: The user corrected an assumption, architectural bias, workflow step, or engineering deliverable format/granularity (e.g., `.xls`/`.xlsx`/`.docx` modification records, QA reports, or toolchain quirks like `openpyxl`/`docx`/COM/encoding) — codify immediately as a `rule` or `skill` (use `supersedes_id` to upgrade existing entries; NEVER stop at `kind: "memory"` when a general methodology or deliverable SOP was corrected).
- **Reusable Script (`tool`)**: Wrote a temporary script (>15 lines, including `/scratch/` scripts) to analyze, transform, verify code, or generate/inspect engineering deliverables (`.xls`/`.xlsx`/`.docx`/reports) — register as a Micro-Tool (`run.{mjs|py|sh|ps1}`) with a deterministic `--self-test` path.
- **Visible Evolution Receipt**: Whenever you call `evo_propose` or `evo_compact`, append at the end of your response: `🧬 EvoKernel 演进回执：[<kind>] <id>（<新增/更新摘要>）`.

> **Gatekeeper Notice**: `evo_propose` enforces Static Security, Lexical De-Symbolization, Sandbox `--self-test` / AST Grounding, BM25 Deduplication, Scoped Bucket Quotas (max 3/bucket), and a **1,500-token core rule budget**. On `ERR_BUDGET_EXCEEDED`, `ERR_SCOPED_BUCKET_FULL`, or `ERR_DUPLICATE`, call `evo_compact` first.
<!-- EVO:END -->

