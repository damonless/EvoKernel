export const META_RULE_MARKER_START = '<!-- EVO:START -->';
export const META_RULE_MARKER_END = '<!-- EVO:END -->';

export const L0_META_RULE_SEED = `<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution & Cognitive Memory Protocol)

You are connected to **EvoKernel** (\`evo-kernel\` MCP + \`.evo/\` capability & memory tree). Follow these 3 invariants strictly:

## 1. Two-Stage Cascaded Recall (\`evo_search\` -> \`evo_inspect\`)
- Before debugging recurring build/test failures, analyzing error logs/packets, or modifying unfamiliar modules, call \`evo_search\` with error symptoms, keywords, or symbol names.
- \`evo_search\` searches **Rules, Skills, Micro-Tools, and Episodic Memories (\`memory\`)** with live **AST Anti-Drift verification** (\`[VERIFIED]\` vs \`[STALE]\`). Call \`evo_inspect(id, "L1" | "L2")\` on relevant hits to load SOPs or Stage 3 **Topology Penetration Anchors** (live \`file:line\`, signatures, and callers).

## 2. Think in Code via Micro-Tools (\`evo_run\`)
- When inspecting >5 files, validating schemas, or running project diagnostics, prefer executing a verified Micro-Tool via \`evo_run(tool_id, args)\` instead of dumping raw file contents into the context window.

## 3. Mandatory Experience Crystallization (\`evo_propose\` & \`evo_compact\`)
Whenever ANY of the following occurs in this session, you MUST call \`evo_propose\` before finishing your final response:
- **Episodic Troubleshooting Case (\`memory\`)**: You diagnosed a non-trivial bug symptom to concrete code symbols — crystallize the case (\`symptom\`, \`root_cause\`, \`solution\`, and \`target_symbols\`) so EvoKernel binds AST structural fingerprints for instant future recall.
- **Bug Recovery Invariant (\`rule\`)**: You discovered an architectural pitfall or branch macro constraint — distill the prevention rule (\`l0_summary\`, \`scope_glob\`, and actionable guardrails).
- **User Correction (\`rule\` / \`skill\`)**: The user corrected an assumption, architectural bias, or workflow step — codify it immediately so the mistake is never repeated.
- **Reusable Script (\`tool\`)**: You wrote a temporary script (>15 lines) to analyze, transform, or verify code — register it as a parameterized Micro-Tool (\`run.{mjs|py|sh|ps1}\`) with a deterministic \`--self-test\` verification path.

> **Gatekeeper Notice**: \`evo_propose\` enforces Static Security, Sandbox \`--self-test\` / Live AST Symbol Grounding, BM25 Deduplication, and a strict **1,500-token core rule budget** (Episodic \`memory\` entries consume 0 core budget tokens). If \`ERR_BUDGET_EXCEEDED\` or \`ERR_DUPLICATE\` is returned, use \`evo_compact\` to merge or archive stale entries first.
<!-- EVO:END -->`;

export function renderManagedBlock(coreRulesMarkdown: string): string {
  const inner = L0_META_RULE_SEED
    .replace(META_RULE_MARKER_START, '')
    .replace(META_RULE_MARKER_END, '')
    .trim();

  if (!coreRulesMarkdown.trim()) {
    return `${META_RULE_MARKER_START}\n${inner}\n${META_RULE_MARKER_END}\n`;
  }

  return `${META_RULE_MARKER_START}\n${inner}\n\n## 4. Evolved Core Invariants (Auto-Managed by EvoKernel)\n${coreRulesMarkdown.trim()}\n${META_RULE_MARKER_END}\n`;
}

