---
id: bug-to-guardrail-sop
title: "Closed-Loop Bug to Deterministic Guardrail & Cognitive Memory SOP"
l0_summary: "Standard workflow to turn a resolved root cause or recurring review comment into a verified Memory, Rule, or Micro-Tool."
tags: ["debugging","evolution","guardrail","memory","tdd"]
origin: "bootstrap"
created_at: "2026-10-14T16:00:40.696Z"
updated_at: "2026-10-19T17:24:35.831Z"
---

## L1 Contract
- **Trigger**: Immediately after fixing a non-trivial bug, build failure, or user architectural correction.
- **Inputs**: Symptom signature, root cause summary, affected symbols/files, and verification command.
- **Outputs**: A committed `.evo/memories/` case, `.evo/rules/` invariant, or `.evo/tools/` diagnostic script via `evo_propose`.

## L2 SOP
1. **Search Existing Capabilities**: Run `evo_search` with the error keyword or symbol name to check if an existing memory/rule/tool already covers this area.
2. **Decide Modality**:
   - If the fix resolved a specific fault symptom tied to concrete functions/structs, crystallize an Episodic Memory (`kind: "memory"`, `symptom`, `root_cause`, `solution`, `target_symbols`) for AST-anchored recall.
   - If the failure can be caught programmatically (e.g., missing imports, config drift, dead symbols), write a Node/Python Micro-Tool (`kind: "tool"`) with a `--self-test` check.
   - If the failure is an architectural or reasoning pitfall, distill a concise Rule (`kind: "rule"`) with an exact `scope_glob`.
3. **Submit via Gatekeeper**: Call `evo_propose`. If `ERR_DUPLICATE_CAPABILITY` is returned, pass `supersedes_id` to upgrade the older entry.
