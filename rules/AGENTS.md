<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution & Cognitive Memory Protocol)

You are connected to **EvoKernel** (`evo-kernel` MCP + `.evo/` capability & memory tree). Follow these 3 invariants strictly:

## 1. Two-Stage Cascaded Recall (`evo_search` -> `evo_inspect`)
- Always pass the active project's absolute root path in the required `workspace` parameter on every `evo_*` tool call so EvoKernel routes to the active repository instead of the MCP server process `cwd`.
- Before debugging recurring build/test failures, analyzing error logs/packets, or modifying unfamiliar modules, call `evo_search` with error symptoms, keywords, or symbol names.
- `evo_search` searches **Rules, Skills, Micro-Tools, and Episodic Memories (`memory`)** across both the local workspace `.evo/` and global `~/.evo/global/` with live **AST Anti-Drift verification** (`[VERIFIED]` vs `[STALE]`). Call `evo_inspect(id, "L1" | "L2")` on relevant hits to load SOPs or Stage 3 **Topology Penetration Anchors** (live `file:line`, signatures, and callers).
- Skip `evo_search` during non-project general chat or built-in host slash-command wizards (e.g., `/automation`, `/schedule`) when no code workspace is involved.

## 2. Think in Code via Micro-Tools (`evo_run`)
- When inspecting >5 files, validating schemas, or running project diagnostics, prefer executing a verified Micro-Tool via `evo_run(tool_id, args, workspace)` instead of dumping raw file contents into the context window.

## 3. Mandatory Experience Crystallization (`evo_propose` & `evo_compact`)
Whenever ANY of the following occurs in this session, you MUST call `evo_propose` before finishing your final response (wait until the fix is verified and passes tests/checks; if code changes again after `evo_propose`, you MUST update the capability so no stale/poisoned rule remains):
- **Episodic Troubleshooting Case (`memory`)**: You diagnosed a specific bug symptom, concrete code symbol, or threshold defect — crystallize it as `kind: "memory"` (`symptom`, `root_cause`, `solution`, and `target_symbols`) so EvoKernel binds AST structural fingerprints at **0 core token cost**.
- **1-Level-Up Architectural Guardrail (`rule`)**: You discovered a cross-module methodology or class-of-bug prevention invariant — distill it as `kind: "rule"` (`l0_summary`, wildcard `scope_glob`, `core: false` by default, and actionable guardrails).
- **User Correction (`rule` / `skill`)**: The user corrected an assumption, architectural bias, or workflow step — codify it immediately so the mistake is never repeated.
- **Reusable Script (`tool`)**: You wrote a temporary script (>15 lines) to analyze, transform, or verify code — register it as a parameterized Micro-Tool (`run.{mjs|py|sh|ps1}`) with a deterministic `--self-test` verification path.
<!-- EVO:END -->
