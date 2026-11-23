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
- \`evo_search\` ranks **Rules, Skills, Tools, Memories, and Preferences** with **AST Anti-Drift** (\`[VERIFIED]\`/\`[STALE]\`/\`[PERSONAL]\`). Never rely on \`<30-token\` L0 titles alone — whenever \`evo_search\` hits a relevant \`RULE\`, \`SKILL\`, or \`[VERIFIED]\` \`MEMORY\`, you MUST call \`evo_inspect(id, tier: "L2", workspace)\` to load checklists, SOPs, or Topology Anchors (omit \`workspace\` for global \`PREFERENCE\`/\`[PERSONAL]\`).
- **Recall Receipt**: When a recalled asset shapes output, emit: \`🛡️ EvoKernel Recall: [<kind>] <id> — <1-line impact>\`.
- **Non-Code / Blank Chats**: Even without a repo \`workspace\`, call \`evo_search(query, scope: "global")\` (omitting \`workspace\`) to recall personal \`preference\`, \`skill\`, and \`memory\` (\`personal\`) assets; skip only trivial small-talk or slash wizards (\`/automation\`, \`/schedule\`).

## 2. Think in Code (\`evo_run\`)
- For >5 files, schema checks, or diagnostics, prefer \`evo_run(tool_id, args, workspace)\` over raw file dumps.

## 3. Experience Crystallization (\`evo_propose\` & \`evo_compact\`)
Call \`evo_propose(...)\` after a root-cause diagnosis is confirmed (including read-only white-box troubleshooting or log-forensic sessions without code edits), after an initial hypothesis is overturned/corrected, or after verifying a fix/deliverable (write-disabled subagent sandboxes: return findings for parent to propose):
- **Repo Episodic Memory (\`memory\`)**: Concrete code bug/symbol/threshold -> \`kind: "memory"\` (\`symptom\`, \`root_cause\`, \`solution\`, \`target_symbols\`, \`workspace\`) at **0 core token cost**. Never crystallize unverified guesses prematurely; if later turns or user feedback overturn/refine an earlier session proposal, immediately update it via \`supersedes_id\`.
- **1-Level-Up Rule (\`rule\`)**: Cross-module invariant -> \`kind: "rule"\` (\`l0_summary\`, wildcard \`scope_glob\`, \`core: false\`, \`transfer_scenarios\`). **SSOT**: NEVER copy magic numbers or >=3 identifiers into rule bodies (use \`memory\` or \`Case Anchor:\`).
- **User Correction (\`rule\`/\`skill\`)**: User corrects assumptions, workflow, or deliverables -> upgrade via \`supersedes_id\` (NEVER stop at \`memory\` for general methodologies).
- **3-Tier Personal Layer (omit \`workspace\` or pass \`scope: "global"\`)**:
  - *Tier 1 Always-On Habits*: \`kind: "preference"\`, \`always_on: true\`, \`category: style|formatting|communication|workflow|requirement|knowledge\` -> 800-tok Profile Card synced to host global rules.
  - *Tier 2 Task Directory*: \`kind: "preference"\`, \`always_on: false\` (+ non-seed global \`skill\`) with \`trigger_cue\` -> 250-tok on-demand menu; inspect via \`evo_inspect(id, "L2")\`.
  - *Tier 3 Personal Memory*: \`kind: "memory"\`, \`memory_type: "personal"\`, \`scope: "global"\` -> cross-workspace lessons at 0 startup tokens.
- **Reusable Script (\`tool\`)**: Temp script >15 lines (incl. \`/scratch/\`) -> Micro-Tool (\`run.{mjs|py|sh|ps1}\`) with \`--self-test\`.
- **Evolution Receipt & Undo**: After \`evo_propose\`/\`evo_compact\`, emit: \`🧬 EvoKernel Evolution Receipt: [<kind>] <id> (<summary>)\`. Users can revert any global profile change anytime via \`evo profile undo\` or Workbench 1-Click Undo.

> **Gatekeeper**: Enforces Security, De-Symbolization, \`--self-test\`/AST Grounding, BM25 & Polarity Conflict Dedup, Scoped Quotas (3/bucket), **1,500-tok core rule**, **800-tok profile**, and **250-tok menu** budgets. On \`ERR_BUDGET_EXCEEDED\`, \`ERR_PROFILE_BUDGET_EXCEEDED\`, \`ERR_SCOPED_BUCKET_FULL\`, or \`ERR_DUPLICATE_CAPABILITY\`, pass \`supersedes_id\` or call \`evo_compact\`.
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
  toolsCatalogMarkdown: string = '',
  projectPreferencesMarkdown: string = ''
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

  if (projectPreferencesMarkdown.trim()) {
    sections.push(`### Project Preferences\n${projectPreferencesMarkdown.trim()}`);
  }

  return `${META_RULE_MARKER_START}\n${sections.join('\n\n')}\n${META_RULE_MARKER_END}\n`;
}

export function renderUserProfileBlock(
  profileDigestMarkdown: string,
  directoryMenuMarkdown: string = ''
): string {
  const trimmedDigest = String(profileDigestMarkdown || '').trim();
  const trimmedMenu = String(directoryMenuMarkdown || '').trim();
  if (!trimmedDigest && !trimmedMenu) {
    return '';
  }
  const parts: string[] = [
    '## Personal Style & Cross-Workspace Preferences (Auto-Managed by EvoKernel)',
  ];
  if (trimmedDigest) {
    parts.push(trimmedDigest);
  }
  if (trimmedMenu) {
    parts.push(
      `### On-Demand Task & Workflow Directory (Call \`evo_inspect\` before starting)\n${trimmedMenu}`
    );
  }
  return `${PROFILE_MARKER_START}\n${parts.join('\n\n')}\n${PROFILE_MARKER_END}\n`;
}
