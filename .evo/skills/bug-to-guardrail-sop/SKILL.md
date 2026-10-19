---
id: bug-to-guardrail-sop
title: "Closed-Loop Bug to 1-Level-Up Guardrail & Cognitive Memory SOP"
l0_summary: "Route concrete bugs to Episodic Memory and abstract reusable methodologies 1-level-up into SSOT-decoupled Rules or Micro-Tools."
tags: ["debugging","evolution","guardrail","memory","abstraction","ssot"]
origin: "bootstrap"
created_at: "2026-10-19T17:34:35.710Z"
updated_at: "2026-10-19T17:34:35.710Z"
---

## L1 Contract
- **Trigger**: Immediately after fixing a non-trivial bug, build failure, or user architectural correction.
- **Inputs**: Symptom signature, root cause summary, affected symbols/files, and cross-scenario transferability analysis.
- **Outputs**: A committed `.evo/memories/` case (for concrete bug symbols/thresholds), `.evo/rules/` 1-level-up invariant, or `.evo/tools/` diagnostic script via `evo_propose`.

## L2 SOP
1. **Search Existing Capabilities**: Run `evo_search` with the error keyword, subsystem, or symbol name to inspect existing memories, rules, and tools.
2. **Enforce SSOT & Decide Modality (`memory` vs `rule` vs `tool`)**:
   - **Concrete Bug Case (`kind: "memory"`)**: If the fix involves specific variable/macro names, state-machine branches, or physical thresholds (e.g., `wBatBusSw`, `>1500VA`, `26.5V`), crystallize an **Episodic Memory** (`symptom`, `root_cause`, `solution`, `target_symbols`) at **0 core token cost**.
   - **Programmatic Check (`kind: "tool"`)**: If the failure can be caught deterministically by a script, register a Micro-Tool with `--self-test`.
   - **1-Level-Up Methodology (`kind: "rule"`)**: Only propose a Rule when the root cause generalizes across >=2 modules/scenarios (`transfer_scenarios`). Strip concrete variable names and magic numbers from the main rule body (source code is the SSOT for concrete state; optionally place 1 short example in a `Case Anchor:` line) and use a wildcard `scope_glob` (never a single literal file).
3. **Submit & Compact**: Call `evo_propose`. If `ERR_DUPLICATE_CAPABILITY`, `ERR_SCOPED_BUCKET_FULL`, or `ERR_BUDGET_EXCEEDED` is returned, pass `supersedes_id` or call `evo_compact` to consolidate existing rules.
