<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Self-Evolution & Cognitive Memory Protocol)

Connected to **EvoKernel** (`evo-kernel` MCP + `.evo/`). Follow these 3 invariants:

## 1. Cascaded Recall (`evo_search` -> `evo_inspect`)
- Before debugging failures, analyzing logs/schematics, modifying unfamiliar modules, executing `git commit` / `git commit --amend`, or generating/editing engineering deliverables (`.xlsx`, `.xls`, `.docx`, QA reports), call `evo_search(query, workspace)` (or `evo_inspect(id, tier, workspace)` from Section 5).
- `evo_search` ranks **Rules, Skills, Tools, Memories, and Preferences** with **AST Anti-Drift** (`[VERIFIED]`/`[STALE]`/`[PERSONAL]`). Never rely on `<30-token` L0 titles alone — whenever `evo_search` hits a relevant `RULE`, `SKILL`, or `[VERIFIED]` `MEMORY`, you MUST call `evo_inspect(id, tier: "L2", workspace)` to load checklists, SOPs, or Topology Anchors (omit `workspace` for global `PREFERENCE`/`[PERSONAL]`).
- **Recall Receipt**: When a recalled asset shapes output, emit: `🛡️ EvoKernel Recall: [<kind>] <id> — <1-line impact>`.
- **Non-Code / Blank Chats**: Even without a repo `workspace`, call `evo_search(query, scope: "global")` (omitting `workspace`) to recall personal `preference`, `skill`, and `memory` (`personal`) assets; skip only trivial small-talk or slash wizards (`/automation`, `/schedule`).

## 2. Think in Code (`evo_run`)
- For >5 files, schema checks, or diagnostics, prefer `evo_run(tool_id, args, workspace)` over raw file dumps.

## 3. Experience Crystallization (`evo_propose` & `evo_compact`)
Call `evo_propose(...)` after a root-cause diagnosis is confirmed (including read-only white-box troubleshooting or log-forensic sessions without code edits), after an initial hypothesis is overturned/corrected, or after verifying a fix/deliverable (write-disabled subagent sandboxes: return findings for parent to propose):
- **Repo Episodic Memory (`memory`)**: Concrete code bug/symbol/threshold -> `kind: "memory"` (`symptom`, `root_cause`, `solution`, `target_symbols`, `workspace`) at **0 core token cost**. Never crystallize unverified guesses prematurely; if later turns or user feedback overturn/refine an earlier session proposal, immediately update it via `supersedes_id`.
- **1-Level-Up Rule (`rule`)**: Cross-module invariant -> `kind: "rule"` (`l0_summary`, wildcard `scope_glob`, `core: false`, `transfer_scenarios`). **SSOT**: NEVER copy magic numbers or >=3 identifiers into rule bodies (use `memory` or `Case Anchor:`).
- **User Correction (`rule`/`skill`)**: User corrects assumptions, workflow, or deliverables -> upgrade via `supersedes_id` (NEVER stop at `memory` for general methodologies).
- **3-Tier Personal Layer (omit `workspace` or pass `scope: "global"`)**:
  - *Tier 1 & 2 Habits/Workflows*: `evo_propose(kind: "preference", content: "...")` auto-infers `id`/`title`/`category`/`always_on`/`trigger_cue` and returns `human_receipt` (800-tok Profile Card + 250-tok Task Directory; inspect via `evo_inspect(id, "L2")`).
  - *Tier 3 Personal Memory*: `kind: "memory"`, `memory_type: "personal"`, `scope: "global"` -> cross-workspace lessons at 0 startup tokens.
- **Reusable Script (`tool`)**: Temp script >15 lines (incl. `/scratch/`) -> Micro-Tool (`run.{mjs|py|sh|ps1}`) with `--self-test`.
- **Evolution Receipt & Undo**: After `evo_propose`/`evo_compact`, emit: `🧬 EvoKernel Evolution Receipt: [<kind>] <id> (<summary>)`. Revert in chat anytime via `evo_propose(undo: true)` (or `evo profile undo` / Workbench).

> **Gatekeeper**: Enforces Security, De-Symbolization, `--self-test`/AST Grounding, BM25 & Polarity Conflict Dedup, Scoped Quotas (3/bucket), **1,500-tok core rule**, **800-tok profile**, and **250-tok menu** budgets. On `ERR_BUDGET_EXCEEDED`, `ERR_PROFILE_BUDGET_EXCEEDED`, `ERR_SCOPED_BUCKET_FULL`, or `ERR_DUPLICATE_CAPABILITY`, pass `supersedes_id` or call `evo_compact`.
<!-- EVO:END -->
