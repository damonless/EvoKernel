import * as fs from 'node:fs';
import * as path from 'node:path';

export const META_RULE_MARKER_START = '<!-- EVO:START -->';
export const META_RULE_MARKER_END = '<!-- EVO:END -->';
export const PROFILE_MARKER_START = '<!-- EVO:PROFILE:START -->';
export const PROFILE_MARKER_END = '<!-- EVO:PROFILE:END -->';

export const L0_META_RULE_SEED = `<!-- EVO:START -->
# EvoKernel L0 Meta-Rule Seed (Self-Evolution & Cognitive Memory Protocol)

Connected to **EvoKernel** (\`evo-kernel\` MCP + \`.evo/\`). Follow these 3 invariants:

## 1. Cascaded Recall (\`evo_search\` -> \`evo_inspect\`)
- Before debugging failures, analyzing logs/schematics, modifying unfamiliar modules, executing \`git commit\` / \`git commit --amend\`, or generating/editing engineering deliverables (\`.xlsx\`, \`.xls\`, \`.docx\`, QA reports), call \`evo_search(query, workspace)\` (or \`evo_inspect(id, tier, workspace)\` from Section 5).
- \`evo_search\` ranks **Rules, Skills, Tools, Memories, and Preferences** with **AST Anti-Drift** (\`[VERIFIED]\`/\`[STALE]\`). Never rely on \`<30-token\` L0 titles alone — whenever \`evo_search\` hits a relevant \`RULE\`, \`SKILL\`, or \`[VERIFIED]\` \`MEMORY\`, you MUST call \`evo_inspect(id, tier: "L2", workspace)\` to load checklists, SOPs, or Topology Anchors.
- **Recall Receipt**: When a recalled asset shapes output, emit: \`🛡️ EvoKernel Recall: [<kind>] <id> — <1-line impact>\`.
- In non-code/writing/cross-workspace chats, call \`evo_search(query, workspace, scope: "global")\` for personal \`preference\` & \`skill\` assets (skip only small-talk or slash wizards \`/automation\`, \`/schedule\`).

## 2. Think in Code (\`evo_run\`)
- For >5 files, schema checks, or diagnostics, prefer \`evo_run(tool_id, args, workspace)\` over raw file dumps.

## 3. Experience Crystallization (\`evo_propose\` & \`evo_compact\`)
Call \`evo_propose(..., workspace)\` after a root-cause diagnosis is confirmed (including read-only white-box troubleshooting or log-forensic sessions without code edits), after an initial hypothesis is overturned/corrected, or after verifying a fix/deliverable (write-disabled subagent sandboxes: return findings for parent to propose):
- **Episodic Memory (\`memory\`)**: Concrete bug/symbol/threshold -> \`kind: "memory"\` (\`symptom\`, \`root_cause\`, \`solution\`, \`target_symbols\`) at **0 core token cost**. Never crystallize unverified guesses prematurely; if later turns or user feedback overturn/refine an earlier session proposal, immediately update it via \`supersedes_id\`.
- **1-Level-Up Rule (\`rule\`)**: Cross-module invariant -> \`kind: "rule"\` (\`l0_summary\`, wildcard \`scope_glob\`, \`core: false\`, \`transfer_scenarios\`). **SSOT**: NEVER copy magic numbers or >=3 identifiers into rule bodies (use \`memory\` or \`Case Anchor:\`).
- **User Correction (\`rule\`/\`skill\`)**: User corrects assumptions, workflow, or deliverables -> upgrade via \`supersedes_id\` (NEVER stop at \`memory\` for general methodologies).
- **Personal Preference (\`kind: "preference"\`, \`scope: "global"\`)**: User style/tone/formatting/workflow habits (\`category\`: \`style|formatting|communication|workflow|knowledge\`; \`always_on: true\` pushes to host global rules in a 500-tok Profile Card; \`always_on: false\` for on-demand notes).
- **Reusable Script (\`tool\`)**: Temp script >15 lines (incl. \`/scratch/\`) -> Micro-Tool (\`run.{mjs|py|sh|ps1}\`) with \`--self-test\`.
- **Evolution Receipt**: After \`evo_propose\`/\`evo_compact\`, emit: \`🧬 EvoKernel Evolution Receipt: [<kind>] <id> (<summary>)\`.

> **Gatekeeper**: Enforces Security, De-Symbolization, \`--self-test\`/AST Grounding, BM25 Dedup, Scoped Quotas (3/bucket), and **1,500-tok core rule budget**. On \`ERR_BUDGET_EXCEEDED\`, \`ERR_SCOPED_BUCKET_FULL\`, or \`ERR_DUPLICATE\`, call \`evo_compact\`.
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

export function renderUserProfileBlock(profileDigestMarkdown: string): string {
  const trimmed = String(profileDigestMarkdown || '').trim();
  if (!trimmed) {
    return '';
  }
  return `${PROFILE_MARKER_START}\n## Personal Style & Cross-Workspace Preferences (Auto-Managed by EvoKernel)\n\n${trimmed}\n${PROFILE_MARKER_END}\n`;
}
