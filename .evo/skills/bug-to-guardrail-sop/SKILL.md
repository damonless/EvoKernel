---
id: bug-to-guardrail-sop
title: "Closed-Loop Bug to Deterministic Guardrail SOP"
l0_summary: "Standard workflow to turn a resolved root cause or recurring review comment into a verified Rule or Micro-Tool."
tags: ["debugging","evolution","guardrail","tdd"]
origin: "bootstrap"
created_at: "2026-10-14T16:00:40.696Z"
updated_at: "2026-10-14T16:00:40.696Z"
---

## L1 Contract
- **Trigger**: Immediately after fixing a non-trivial bug, build failure, or user architectural correction.
- **Inputs**: Root cause summary, affected file glob, and verification command.
- **Outputs**: A committed `.evo/rules/` invariant or `.evo/tools/` diagnostic script via `evo_propose`.

## L2 SOP
1. **Search Existing Capabilities**: Run `evo_search` with the error keyword or module name to check if an existing rule/tool already covers this area.
2. **Decide Modality**:
   - If the failure can be caught programmatically (e.g., missing imports, config drift, dead symbols), write a Node/Python Micro-Tool (`kind: "tool"`) with a `--self-test` check.
   - If the failure is an architectural or reasoning pitfall, distill a concise Rule (`kind: "rule"`) with an exact `scope_glob`.
3. **Submit via Gatekeeper**: Call `evo_propose`. If `ERR_DUPLICATE_CAPABILITY` is returned, pass `supersedes_id` to upgrade the older entry.
