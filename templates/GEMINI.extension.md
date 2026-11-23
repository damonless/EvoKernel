<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution & Cognitive Memory Protocol)

You are connected to **EvoKernel** (`evo-kernel` MCP + `.evo/` capability & memory tree). Follow these 3 invariants strictly:

## 1. Two-Stage Cascaded Recall (`evo_search` -> `evo_inspect`)
- Before debugging build/test failures, analyzing logs/schematics, modifying unfamiliar modules, executing `git commit` / `git commit --amend`, or generating/editing engineering deliverables (`.xlsx`, `.xls`, `.docx`, QA reports), call `evo_search(query, workspace)` (or `evo_inspect(id, tier, workspace)` when listed in Section 5) with your active `workspace` root path.
- `evo_search` ranks **Rules, Skills, Micro-Tools, Preferences, and Memories (`memory`)** with live **AST Anti-Drift verification** (`[VERIFIED]` vs `[STALE]` vs `[PERSONAL]`). Never rely on `<30-token` L0 titles alone — whenever `evo_search` hits a relevant `RULE`, `SKILL`, `PREFERENCE`, or `MEMORY`, you MUST call `evo_inspect(id, tier: "L2")` to load its checklist, SOP, or Stage 3 **Topology Penetration Anchors** (`file:line`, signatures, callers).
- **Visible Recall Receipt**: When a recalled capability shapes your diagnosis, fix, or deliverable, emit a 1-line receipt: `🛡️ EvoKernel Recall: [<kind>] <id> — <1-line impact>`.
- **Non-Code / Blank Chats**: Even without a repo `workspace`, call `evo_search(query, scope: "global")` (omitting `workspace`) to recall personal `preference`, `skill`, and `memory` (`personal`) assets; skip only trivial small-talk or slash-command wizards (`/automation`, `/schedule`).

## 2. Think in Code via Micro-Tools (`evo_run`)
- When inspecting >5 files, validating schemas, or running diagnostics, prefer executing a verified Micro-Tool via `evo_run(tool_id, args, workspace)` over dumping raw files into context.

## 3. Mandatory Experience Crystallization (`evo_propose` & `evo_compact`)
Call `evo_propose(...)` after a root-cause diagnosis is confirmed (including read-only white-box troubleshooting or log-forensic sessions without code edits), after an initial hypothesis is overturned/corrected, or after verifying a fix/deliverable (write-disabled subagent sandboxes: return findings for the parent session to propose):
- **Episodic Troubleshooting Case (`memory`)**: Diagnosed a concrete bug symptom, symbol, or threshold defect (even read-only) — crystallize as `kind: "memory"` (`symptom`, `root_cause`, `solution`, `target_symbols`, `workspace`) with AST fingerprints at **0 core token cost**. Never crystallize unverified guesses prematurely; if later turns or user feedback overturn/refine an earlier session proposal, immediately update it via `supersedes_id`.
- **1-Level-Up Architectural Guardrail (`rule`)**: Discovered a cross-module methodology or class-of-bug invariant — distill as `kind: "rule"` (`l0_summary`, wildcard `scope_glob`, `core: false` by default, `transfer_scenarios`). **SSOT Exclusion Principle**: Source code is the Single Source of Truth; NEVER copy magic numbers or >=3 concrete identifiers into a rule body (use `kind: "memory"` or `Case Anchor:`).
- **User Correction / Deliverable Feedback (`rule` / `skill`)**: When the user corrects an assumption, workflow step, or deliverable/toolchain rule (`.xls`/`.xlsx`/`.docx`, QA reports), codify immediately as a `rule` or `skill` (`supersedes_id` when upgrading; NEVER stop at `kind: "memory"` for general methodologies).
- **3-Tier Personal Layer (omit `workspace` or pass `scope: "global"`)**:
  - *Tier 1 Always-On Habits*: `kind: "preference"`, `always_on: true`, `category: style|formatting|communication|workflow|requirement|knowledge` -> 800-tok Profile Card synced to host global rules.
  - *Tier 2 Task Directory*: `kind: "preference"`, `always_on: false` (+ non-seed global `skill`) with `trigger_cue` -> 250-tok on-demand menu; inspect via `evo_inspect(id, "L2")`.
  - *Tier 3 Personal Memory*: `kind: "memory"`, `memory_type: "personal"`, `scope: "global"` -> cross-workspace experience at 0 startup tokens.
- **Reusable Script (`tool`)**: Wrote a temporary script (>15 lines, including `/scratch/`) to analyze, verify, or inspect deliverables — register as a Micro-Tool (`run.{mjs|py|sh|ps1}`) with a deterministic `--self-test` path.
- **Visible Evolution Receipt & Undo**: After calling `evo_propose` or `evo_compact`, append: `🧬 EvoKernel Evolution Receipt: [<kind>] <id> (<summary>)`. Users can revert any global profile change anytime via `evo profile undo` or Workbench 1-Click Undo.

> **Gatekeeper Notice**: `evo_propose` enforces Static Security, Lexical De-Symbolization, Sandbox `--self-test` / AST Grounding, BM25 & Polarity Conflict Deduplication, Scoped Quotas (max 3/bucket), **1,500-token core rule**, **800-token profile**, and **250-token directory menu** budgets. On `ERR_BUDGET_EXCEEDED`, `ERR_PROFILE_BUDGET_EXCEEDED`, `ERR_SCOPED_BUCKET_FULL`, or `ERR_DUPLICATE_CAPABILITY`, pass `supersedes_id` or call `evo_compact` first.
<!-- EVO:END -->
