export const META_RULE_MARKER_START = '<!-- EVO:START -->';
export const META_RULE_MARKER_END = '<!-- EVO:END -->';

export const L0_META_RULE_SEED = `<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution Protocol)

You are connected to **EvoKernel** (\`evo-kernel\` MCP + \`.evo/\` capability tree). Follow these 3 invariants strictly:

## 1. Search Before Reinventing (\`evo_search\` -> \`evo_inspect\`)
- Before debugging recurring build/test failures, writing repetitive analysis scripts, or modifying unfamiliar modules, call \`evo_search\` with keywords or file paths.
- \`evo_search\` returns ultra-compact **L0 summaries (<30 tokens each)**. Only call \`evo_inspect(id, "L1" | "L2")\` when an item is directly relevant.

## 2. Think in Code via Micro-Tools (\`evo_run\`)
- When inspecting >5 files, validating schemas, or running project diagnostics, prefer executing a verified Micro-Tool via \`evo_run(tool_id, args)\` instead of dumping raw file contents into the context window.

## 3. Mandatory Experience Crystallization (\`evo_propose\` & \`evo_compact\`)
Whenever ANY of the following occurs in this session, you MUST call \`evo_propose\` before finishing your final response:
- **Bug Recovery (\`rule\`)**: You hit a non-trivial error, root-caused it, and verified the fix — distill the prevention rule (\`l0_summary\`, \`scope_glob\`, and actionable guardrails).
- **User Correction (\`rule\` / \`skill\`)**: The user corrected an assumption, architectural bias, or workflow step — codify it immediately so the mistake is never repeated.
- **Reusable Script (\`tool\`)**: You wrote a temporary script (>15 lines) to analyze, transform, or verify code — register it as a parameterized Micro-Tool (\`run.{mjs|py|sh|ps1}\`) with a deterministic \`--self-test\` verification path.

> **Gatekeeper Notice**: \`evo_propose\` enforces AST/syntax checks, sandboxed \`--self-test\` dry-runs (exit code \`0\`), BM25 duplicate detection, and a strict **1,500-token core rule budget**. If \`ERR_BUDGET_EXCEEDED\` or \`ERR_DUPLICATE\` is returned, use \`evo_compact\` to merge and deduplicate existing entries first.
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
