---
id: bug-to-guardrail-sop
title: "Closed-Loop Bug to 1-Level-Up Guardrail & Cognitive Memory SOP"
l0_summary: "Route concrete bugs to Episodic Memory and abstract reusable methodologies 1-level-up into SSOT-decoupled Rules or Micro-Tools with orthogonal clause preservation."
tags: ["debugging","evolution","guardrail","memory","abstraction","ssot","clause-preservation"]
origin: "evolved"
created_at: "2026-10-14T16:00:40.696Z"
updated_at: "2026-10-26T06:20:00.000Z"
---

## L1 Contract
- **Trigger**: Immediately after fixing a non-trivial bug, build failure, or user architectural correction.
- **Inputs**: Symptom signature, root cause summary, affected symbols/files, verification command, and cross-scenario transferability analysis.
- **Outputs**: A committed `.evo/memories/` case (for concrete bug symbols/thresholds), `.evo/rules/` 1-level-up invariant, or `.evo/tools/` diagnostic script via `evo_propose`.

## L2 SOP
1. **Search Existing Capabilities**: Run `evo_search` with the error keyword, subsystem, or symbol name to inspect existing memories, rules, and tools.
2. **Pre-Upgrade Inspection Requirement**:
   - If an existing rule already addresses the target subsystem and should be upgraded, **ALWAYS** call `evo_inspect(supersedes_id, "L2")` first to retrieve all existing actionable clauses before authoring the new proposal.
3. **Enforce SSOT & Decide Modality (`memory` vs `rule` vs `tool`)**:
   - **Concrete Bug Case (`kind: "memory"`)**: If the fix involves specific variable/macro names, state-machine branches, or physical thresholds (e.g., `wBatBusSw`, `>1500VA`, `26.5V`), crystallize an **Episodic Memory** (`symptom`, `root_cause`, `solution`, `target_symbols`) at **0 core token cost** with live AST grounding.
   - **Programmatic Check (`kind: "tool"`)**: If the failure can be caught deterministically by a script, register a Micro-Tool with `--self-test` verification.
   - **1-Level-Up Methodology (`kind: "rule"`)**: Propose a Rule only when the root cause generalizes across >=2 modules/scenarios (`transfer_scenarios`). Follow Gate 1.5 decoupling:
     - Use a wildcard `scope_glob` (never a single literal file).
     - Source code is the SSOT: strip concrete variable names, macros, and magic numbers from the main rule body.
     - Isolate concrete bug examples inside a `## 典型反例锚点` / `Case Anchor:` section.
     - Provide at least 2 distinct `transfer_scenarios` (>=8 characters each).
4. **Orthogonal Clause Preservation Mandate**:
   - When upgrading an existing rule via `supersedes_id`, **NEVER** drop existing, still-valid engineering invariants.
   - Consolidate previous orthogonal clauses with new findings into a unified checklist.
5. **Submit & Compact**: Call `evo_propose`. If `ERR_DUPLICATE_CAPABILITY`, `ERR_SCOPED_BUCKET_FULL`, or `ERR_BUDGET_EXCEEDED` is returned, pass `supersedes_id` or call `evo_compact` to consolidate existing rules.
