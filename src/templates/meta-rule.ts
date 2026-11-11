import * as fs from 'node:fs';
import * as path from 'node:path';

export const META_RULE_MARKER_START = '<!-- EVO:START -->';
export const META_RULE_MARKER_END = '<!-- EVO:END -->';

export const L0_META_RULE_SEED = `<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Deterministic Self-Evolution & Cognitive Memory Protocol)

You are connected to **EvoKernel** (\`evo-kernel\` MCP + \`.evo/\` capability & memory tree). Follow these 3 invariants strictly:

## 1. Two-Stage Cascaded Recall (\`evo_search\` -> \`evo_inspect\`)
- Before debugging build/test failures, analyzing logs/schematics, modifying unfamiliar modules, executing \`git commit\` / \`git commit --amend\`, or generating/editing engineering deliverables (\`.xlsx\`, \`.xls\`, \`.docx\`, QA reports), call \`evo_search(query, workspace)\` (or \`evo_inspect(id, tier, workspace)\` when listed in Section 5) with your active \`workspace\` root path.
- \`evo_search\` ranks **Rules, Skills, Micro-Tools, and Memories (\`memory\`)** with live **AST Anti-Drift verification** (\`[VERIFIED]\` vs \`[STALE]\`). Never rely on \`<30-token\` L0 titles alone — whenever \`evo_search\` hits a relevant \`RULE\`, \`SKILL\`, or \`[VERIFIED]\` \`MEMORY\`, you MUST call \`evo_inspect(id, tier: "L2", workspace)\` to load its checklist, SOP, or Stage 3 **Topology Penetration Anchors** (\`file:line\`, signatures, callers).
- **Visible Recall Receipt**: When a recalled capability shapes your diagnosis, fix, or deliverable, emit a 1-line receipt: \`🛡️ EvoKernel Recall: [<kind>] <id> — <1-line impact>\`.
- Skip \`evo_search\` during general chat or slash-command wizards (\`/automation\`, \`/schedule\`) without a code workspace.

## 2. Think in Code via Micro-Tools (\`evo_run\`)
- When inspecting >5 files, validating schemas, or running diagnostics, prefer executing a verified Micro-Tool via \`evo_run(tool_id, args, workspace)\` over dumping raw files into context.

## 3. Mandatory Experience Crystallization (\`evo_propose\` & \`evo_compact\`)
Call \`evo_propose(..., workspace)\` after a root-cause diagnosis is confirmed (including read-only white-box troubleshooting or log-forensic sessions without code edits), after an initial hypothesis is overturned/corrected, or after verifying a fix/deliverable — before your final response:
- **Episodic Troubleshooting Case (\`memory\`)**: Diagnosed a concrete bug symptom, symbol, or threshold defect (even read-only) — crystallize as \`kind: "memory"\` (\`symptom\`, \`root_cause\`, \`solution\`, \`target_symbols\`) with AST fingerprints at **0 core token cost**.
- **1-Level-Up Architectural Guardrail (\`rule\`)**: Discovered a cross-module methodology or class-of-bug invariant — distill as \`kind: "rule"\` (\`l0_summary\`, wildcard \`scope_glob\`, \`core: false\` by default, \`transfer_scenarios\`). **SSOT Exclusion Principle**: Source code is the Single Source of Truth; NEVER copy magic numbers or >=3 concrete identifiers into a rule body (use \`kind: "memory"\` or \`Case Anchor:\`).
- **User Correction / Deliverable Feedback (\`rule\` / \`skill\`)**: When the user corrects an assumption, workflow step, or deliverable/toolchain rule (\`.xls\`/\`.xlsx\`/\`.docx\`, QA reports), codify immediately as a \`rule\` or \`skill\` (\`supersedes_id\` when upgrading; NEVER stop at \`kind: "memory"\` for general methodologies).
- **Reusable Script (\`tool\`)**: Wrote a temporary script (>15 lines, including \`/scratch/\`) to analyze, verify, or inspect deliverables — register as a Micro-Tool (\`run.{mjs|py|sh|ps1}\`) with a deterministic \`--self-test\` path.
- **Visible Evolution Receipt**: After calling \`evo_propose\` or \`evo_compact\`, append: \`🧬 EvoKernel Evolution Receipt: [<kind>] <id> (<summary>)\`.

> **Gatekeeper Notice**: \`evo_propose\` enforces Static Security, Lexical De-Symbolization, Sandbox \`--self-test\` / AST Grounding, BM25 Deduplication, Scoped Quotas (max 3/bucket), and a **1,500-token core rule budget**. On \`ERR_BUDGET_EXCEEDED\`, \`ERR_SCOPED_BUCKET_FULL\`, or \`ERR_DUPLICATE\`, call \`evo_compact\` first.
<!-- EVO:END -->`;

export function resolveLatestMetaRuleSeed(): string {
  try {
    const candidates = [
      path.resolve(import.meta.dirname, '..', '..', 'src', 'templates', 'meta-rule.ts'),
      path.join(import.meta.dirname, 'meta-rule.js'),
    ].filter((p) => fs.existsSync(p));
    candidates.sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });
    for (const filePath of candidates) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const m = raw.match(
        /L0_META_RULE_SEED\s*=\s*`(<!-- EVO:START -->[\s\S]*?<!-- EVO:END -->)`;/
      );
      if (m) {
        return m[1]
          .replace(/\\`/g, '`')
          .replace(/\\\$/g, '$')
          .replace(/\r?\n/g, '\n');
      }
    }
  } catch {
    // Fall back to in-memory constant
  }
  return L0_META_RULE_SEED;
}

export function renderManagedBlock(
  coreRulesMarkdown: string,
  toolsCatalogMarkdown: string = ''
): string {
  const seed = resolveLatestMetaRuleSeed();
  const inner = seed
    .replace(META_RULE_MARKER_START, '')
    .replace(META_RULE_MARKER_END, '')
    .trim();

  const sections: string[] = [inner];

  if (coreRulesMarkdown.trim()) {
    sections.push(
      `## 4. Evolved Core Invariants (Auto-Managed by EvoKernel)\n${coreRulesMarkdown.trim()}`
    );
  }

  if (toolsCatalogMarkdown.trim()) {
    sections.push(
      `### 5. Registered Micro-Tools via \`evo_run\`\n${toolsCatalogMarkdown.trim()}`
    );
  }

  return `${META_RULE_MARKER_START}\n${sections.join('\n\n')}\n${META_RULE_MARKER_END}\n`;
}
