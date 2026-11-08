import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  EvoStorage,
  estimateTokens,
  parseFrontmatter,
  sanitizeId,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import {
  EvoGatekeeper,
  auditRuleGate1_5,
  validateCapabilityReferences,
} from '../core/gatekeeper.js';
import type { Gate1_5Violation } from '../core/gatekeeper.js';
import { renderManagedBlock } from '../templates/meta-rule.js';
import { MAX_TOOLS_CATALOG_TOKENS, runInit, syncManagedRuleBlocks } from './init.js';
import type { EvoRule, EvoSkill, ProposalPayload } from '../core/types.js';

export interface AuditOptions {
  includeGlobal?: boolean;
  globalHomeDir?: string;
  tokenBudgetLimit?: number;
  skillBudgetLimit?: number;
  overlapThreshold?: number;
}

export interface AuditedFileMetric {
  scope: 'workspace' | 'global';
  kind: 'rule' | 'skill';
  displayPath: string;
  fullPath: string;
  bytes: number;
  tokens: number;
  budgetLimit: number;
  overBudget: boolean;
  totalTokens?: number;
  userStaticTokens?: number;
  evoSeedTokens?: number;
}

export interface DomainLeakWarning {
  scope: 'workspace' | 'global';
  kind: 'rule' | 'skill';
  displayPath: string;
  matchedIndicators: string[];
  suggestedScopeGlob: string;
  recommendation: string;
}

export interface RedundancyOverlap {
  fileA: string;
  fileB: string;
  similarity: number;
  sharedTerms: string[];
  recommendation: string;
}

export interface GateViolationWarning {
  scope: 'workspace' | 'global';
  ruleId: string;
  displayPath: string;
  violations: Gate1_5Violation[];
}

export interface SurfaceViolation {
  harness: string;
  displayPath: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface BrokenCapabilityRef {
  scope: 'workspace' | 'global';
  displayPath: string;
  missingIds: string[];
}

export interface ContestedCapability {
  id: string;
  kind: string;
  helped_count: number;
  hurt_count: number;
  contested_count: number;
}

export interface AuditReport {
  workspaceRoot: string;
  includeGlobal: boolean;
  tokenBudgetLimit: number;
  skillBudgetLimit: number;
  files: AuditedFileMetric[];
  budgetViolations: AuditedFileMetric[];
  domainLeaks: DomainLeakWarning[];
  redundancyOverlaps: RedundancyOverlap[];
  gateViolations: GateViolationWarning[];
  brokenCapabilityRefs: Array<{ scope: 'workspace' | 'global'; displayPath: string; missingIds: string[] }>;
  surfaceViolations: Array<{ harness: string; displayPath: string; severity: 'error' | 'warning'; code: string; message: string }>;
  contestedCapabilities: Array<{ id: string; kind: string; helped_count: number; hurt_count: number; contested_count: number }>;
  healthy: boolean;
}

export interface RefactorOptions extends AuditOptions {
  apply?: boolean;
}

export interface RefactorStageAction {
  stage: 1 | 2 | 3 | 4;
  title: string;
  targets: string[];
  actions: string[];
}

export interface RefactorResult {
  audit: AuditReport;
  skillInstalled: string;
  stages: RefactorStageAction[];
  appliedChanges: string[];
}

const DOMAIN_LEAK_PATTERNS: Array<{
  label: string;
  regex: RegExp;
  suggestedGlob: string;
}> = [
  {
    label: 'C/C++ Firmware Extensions (*.c/*.h/*.cpp)',
    regex: /\*\.(?:c|h|cpp|hpp|s|asm)\b|\b(?:uint8_t|uint16_t|uint32_t|int32_t)\b/i,
    suggestedGlob: '**/*.{c,h,cpp,hpp}',
  },
  {
    label: 'Embedded Hardware / BMS / Inverter Macros',
    regex: /\b(?:BMS_SERVICE_[A-Z0-9_]+|CAN_[A-Z0-9_]+|ADC|GPIO|PWM|INV3K|MPPT|MOSFET|IGBT)\b/,
    suggestedGlob: '**/*.{c,h,cpp,hpp}',
  },
  {
    label: 'CodeGraph / AST Indexer Workflow Coupling',
    regex: /\b(?:codegraph_explore|codegraph_node|codegraph\s+init|\.codegraph)\b/i,
    suggestedGlob: 'src/**/*',
  },
  {
    label: 'TypeScript / Frontend Stack Specifics (*.ts/*.tsx)',
    regex: /\*\.(?:ts|tsx|jsx)\b|\b(?:tsconfig\.json|stripTypeScriptTypes|Next\.js|React)\b/i,
    suggestedGlob: 'src/**/*.{ts,tsx}',
  },
  {
    label: 'Python Stack Specifics (*.py / pytest)',
    regex: /\*\.py\b|\b(?:pytest|pyproject\.toml|virtualenv|pip\s+install)\b/i,
    suggestedGlob: '**/*.py',
  },
  {
    label: 'Hardcoded User / Project Directory Path',
    regex: /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\|\/Users\/[A-Za-z0-9_.-]+\/|\/home\/[A-Za-z0-9_.-]+\//,
    suggestedGlob: '**/*',
  },
];

export const EVO_RULE_ARCHITECT_PROPOSAL: ProposalPayload = {
  kind: 'skill',
  id: 'evo-rule-architect',
  name: 'evo-rule-architect',
  description:
    'Audits bloated CLAUDE.md/GEMINI.md/AGENTS.md and coupled skills, decoupling them into L0 seeds and L1/L2 scoped assets.',
  trigger_cue:
    'When auditing bloated rule files (>1,500 tokens), global domain leaks, or duplicated skills',
  title: 'Legacy Rule & Skill Decoupling Architect (4-Stage Refactoring SOP)',
  l0_summary:
    'Audits bloated CLAUDE.md/GEMINI.md/AGENTS.md and coupled skills, decoupling them into L0 seeds and L1/L2 scoped assets.',
  tags: ['architecture', 'refactoring', 'rules', 'skills', 'context-hygiene', 'audit'],
  origin: 'bootstrap',
  l1_contract: [
    '- **Trigger**: When onboarding an existing user/project with bloated global/local rule files (`>1,500 tokens`), domain leaks in global configs (`~/.gemini/`, `~/.claude/`, `~/.cursor/`), or high duplication between `AGENTS.md` and `SKILL.md`.',
    '- **Inputs**: Diagnostic output from `evo audit --global` or `evo refactor`.',
    '- **Outputs**: Purified global rules, desensitized global skills, scoped `.evo/rules/scoped/*.md` rules, and STE-Lite local skills wired to `evo_search` + `evo_propose`.',
  ].join('\n'),
  l2_sop: [
    '1. **Stage 1 — Global Rule Purification (全局提纯)**:',
    '   - Strip all language-specific rules (`*.c`, `*.ts`, `*.py`), tool-specific routing (`CodeGraph`, `AOCI`), and business domain constraints from global files (`~/.gemini/GEMINI.md`, `~/.claude/CLAUDE.md`).',
    '   - Retain only: (a) EvoKernel L0 Meta-Rule Seed, (b) universal epistemic & anti-sycophancy protocol, and (c) concise communication style.',
    '2. **Stage 2 — Global Skill Desensitization (全局技能脱敏)**:',
    '   - Scan global `SKILL.md` files for project-specific macro names, repo paths, or domain terms and replace them with domain-neutral placeholders.',
    '3. **Stage 3 — Local Demotion & Scoped Splitting (局部下沉与 Scoped 拆分)**:',
    '   - Move code workflow rules (e.g., `CodeGraph` threshold policy) into the project-local `AGENTS.md`.',
    '   - Convert domain/language-specific guardrails into on-demand scoped rules via `evo_propose(kind: "rule", core: false, scope_glob: "...")`.',
    '4. **Stage 4 — Local Skill STE-Lite Conversion (局部技能 STE-Lite 化)**:',
    '   - Remove paragraphs in local `.agents/skills/*/SKILL.md` that duplicate `AGENTS.md` invariants.',
    '   - Add a Pre-Task Recall step (`evo_search` -> `evo_inspect`) and a Post-Task Crystallization step (`evo_propose`) to each local workflow skill.',
  ].join('\n'),
};

function collectMarkdownFiles(dir: string, maxDepth = 3, currentDepth = 0): string[] {
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full, maxDepth, currentDepth + 1));
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) {
      results.push(full);
    }
  }
  return results;
}

function discoverAuditableFiles(
  workspaceRoot: string,
  includeGlobal: boolean,
  globalHomeDir: string,
  globalEvoRootOverride?: string
): Array<{ scope: 'workspace' | 'global'; kind: 'rule' | 'skill'; displayPath: string; fullPath: string }> {
  const discovered: Array<{
    scope: 'workspace' | 'global';
    kind: 'rule' | 'skill';
    displayPath: string;
    fullPath: string;
  }> = [];
  const seen = new Set<string>();

  const addFile = (scope: 'workspace' | 'global', kind: 'rule' | 'skill', fullPath: string, baseDir: string) => {
    const resolved = path.resolve(fullPath);
    if (seen.has(resolved) || !fs.existsSync(resolved)) return;
    try {
      if (!fs.statSync(resolved).isFile()) return;
    } catch {
      return;
    }
    seen.add(resolved);
    const rel = path.relative(baseDir, resolved).replace(/\\/g, '/');
    const prefix = scope === 'global' ? '~/' : '';
    discovered.push({
      scope,
      kind,
      displayPath: `${prefix}${rel}`,
      fullPath: resolved,
    });
  };

  // 1. Workspace rule files
  for (const rootRule of [
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    'rules/AGENTS.md',
    '.cursorrules',
    '.windsurfrules',
    '.clinerules',
    '.roorules',
  ]) {
    addFile('workspace', 'rule', path.join(workspaceRoot, rootRule), workspaceRoot);
  }
  for (const ruleDir of [
    path.join(workspaceRoot, 'config', 'rules'),
    path.join(workspaceRoot, '.cursor', 'rules'),
    path.join(workspaceRoot, '.windsurf', 'rules'),
    path.join(workspaceRoot, '.roo', 'rules'),
    path.join(workspaceRoot, '.github'),
    path.join(workspaceRoot, '.evo', 'rules'),
  ]) {
    for (const f of collectMarkdownFiles(ruleDir, 2)) {
      if (path.basename(f) === 'core-invariants.md') continue;
      addFile('workspace', 'rule', f, workspaceRoot);
    }
  }

  // 2. Workspace skill files
  for (const skillDir of [
    path.join(workspaceRoot, '.agents', 'skills'),
    path.join(workspaceRoot, '.codex', 'skills'),
    path.join(workspaceRoot, '.gemini', 'skills'),
    path.join(workspaceRoot, 'config', 'skills'),
    path.join(workspaceRoot, '.claude', 'skills'),
    path.join(workspaceRoot, '.cursor', 'skills'),
    path.join(workspaceRoot, '.windsurf', 'skills'),
    path.join(workspaceRoot, '.roo', 'skills'),
    path.join(workspaceRoot, '.evo', 'skills'),
    path.join(workspaceRoot, 'skills'),
    path.join(workspaceRoot, '.opencode', 'skills'),
  ]) {
    for (const f of collectMarkdownFiles(skillDir, 2)) {
      addFile('workspace', 'skill', f, workspaceRoot);
    }
  }

  // 3. Global rule & skill files
  if (includeGlobal && fs.existsSync(globalHomeDir)) {
    const globalEvoRoot =
      globalEvoRootOverride || path.join(globalHomeDir, '.evo', 'global');
    const globalEvoBase = globalEvoRoot.toLowerCase().startsWith(globalHomeDir.toLowerCase())
      ? globalHomeDir
      : globalEvoRoot;

    const globalRuleCandidates = [
      path.join(globalHomeDir, '.gemini', 'GEMINI.md'),
      path.join(globalHomeDir, '.claude', 'CLAUDE.md'),
      path.join(globalHomeDir, '.cursorrules'),
      path.join(globalHomeDir, '.windsurfrules'),
      path.join(globalHomeDir, '.clinerules'),
      path.join(globalHomeDir, '.roorules'),
    ];
    for (const cand of globalRuleCandidates) {
      addFile('global', 'rule', cand, globalHomeDir);
    }

    for (const globalRuleDir of [
      path.join(globalHomeDir, '.gemini', 'config', 'rules'),
      path.join(globalHomeDir, '.claude', 'rules'),
      path.join(globalHomeDir, '.cursor', 'rules'),
      path.join(globalHomeDir, '.windsurf', 'rules'),
      path.join(globalHomeDir, '.roo', 'rules'),
    ]) {
      for (const f of collectMarkdownFiles(globalRuleDir, 2)) {
        addFile('global', 'rule', f, globalHomeDir);
      }
    }

    for (const f of collectMarkdownFiles(path.join(globalEvoRoot, '.evo', 'rules'), 2)) {
      if (path.basename(f) === 'core-invariants.md') continue;
      addFile('global', 'rule', f, globalEvoBase);
    }

    for (const globalSkillDir of [
      path.join(globalHomeDir, '.gemini', 'config', 'skills'),
      path.join(globalHomeDir, '.claude', 'skills'),
      path.join(globalHomeDir, '.cursor', 'skills'),
      path.join(globalHomeDir, '.windsurf', 'skills'),
      path.join(globalHomeDir, '.agents', 'skills'),
    ]) {
      for (const f of collectMarkdownFiles(globalSkillDir, 2)) {
        addFile('global', 'skill', f, globalHomeDir);
      }
    }

    for (const f of collectMarkdownFiles(path.join(globalEvoRoot, '.evo', 'skills'), 2)) {
      addFile('global', 'skill', f, globalEvoBase);
    }
  }

  return discovered;
}

function tokenizeContentForOverlap(text: string): Set<string> {
  const withoutManaged = text.replace(/<!-- EVO:START -->[\s\S]*?<!-- EVO:END -->/g, '');
  const matches = withoutManaged.toLowerCase().match(/[a-z0-9_-]{3,}|[\u4e00-\u9fa5]{2,4}/g) || [];
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'when',
    'from',
    'that',
    'this',
    'must',
    'always',
    'never',
    'use',
    'file',
    'code',
    'rule',
    'skill',
    'tool',
  ]);
  return new Set(matches.filter((w) => !stopWords.has(w)));
}

export function auditHarnessSurfaces(
  workspaceRoot: string,
  options: { includeGlobal?: boolean; globalHomeDir?: string } = {}
): SurfaceViolation[] {
  const violations: SurfaceViolation[] = [];
  const root = path.resolve(workspaceRoot);

  // 1. Codex AGENTS.md length check
  const agentsPath = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    try {
      const raw = fs.readFileSync(agentsPath, 'utf8');
      const byteLen = Buffer.byteLength(raw, 'utf8');
      if (byteLen > 32768) {
        violations.push({
          harness: 'codex',
          displayPath: 'AGENTS.md',
          severity: 'error',
          code: 'CODEX_AGENTS_32KB_TRUNCATION',
          message: `AGENTS.md is ${byteLen} bytes (> 32,768 bytes) and will be silently truncated by OpenAI Codex CLI.`,
        });
      } else if (fs.existsSync(path.join(root, '.codex')) && raw.length > 8000) {
        violations.push({
          harness: 'codex',
          displayPath: 'AGENTS.md',
          severity: 'warning',
          code: 'CODEX_AGENTS_8K_ADVISORY',
          message: `AGENTS.md is ${raw.length} characters (> 8,000 characters advisory limit on Codex).`,
        });
      }
    } catch {
      // ignore
    }
  }

  // 2. Codex .codex/hooks.json schema check
  const codexHooksPath = path.join(root, '.codex', 'hooks.json');
  if (fs.existsSync(codexHooksPath)) {
    try {
      const raw = fs.readFileSync(codexHooksPath, 'utf8');
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        violations.push({
          harness: 'codex',
          displayPath: '.codex/hooks.json',
          severity: 'error',
          code: 'CODEX_HOOKS_SCHEMA_INVALID',
          message: '.codex/hooks.json contains invalid JSON.',
        });
        parsed = null;
      }
      if (parsed) {
        const VALID_CODEX_HOOK_EVENTS = new Set([
          'PreToolUse',
          'PostToolUse',
          'PermissionRequest',
          'PreCompact',
          'PostCompact',
          'SessionStart',
          'SubagentStart',
          'SubagentStop',
          'UserPromptSubmit',
          'Stop',
        ]);
        let invalid = false;
        let reason = '';
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          !parsed.hooks ||
          typeof parsed.hooks !== 'object' ||
          Array.isArray(parsed.hooks) ||
          Object.keys(parsed.hooks).length === 0
        ) {
          invalid = true;
          reason = 'Top-level "hooks" must be a non-empty object.';
        } else {
          for (const ev of Object.keys(parsed.hooks)) {
            if (!VALID_CODEX_HOOK_EVENTS.has(ev)) {
              invalid = true;
              reason = `Hook event "${ev}" is not a recognized PascalCase event.`;
              break;
            }
            const list = parsed.hooks[ev];
            if (!Array.isArray(list)) {
              invalid = true;
              reason = `Hook event "${ev}" must map to an array of matcher entries.`;
              break;
            }
            for (const entry of list) {
              if (
                !entry ||
                typeof entry !== 'object' ||
                !Array.isArray(entry.hooks) ||
                entry.hooks.length === 0
              ) {
                invalid = true;
                reason = `Each entry in "${ev}" must contain a non-empty "hooks" array.`;
                break;
              }
              for (const h of entry.hooks) {
                if (h?.type !== 'command' || typeof h?.command !== 'string' || !h.command.trim()) {
                  invalid = true;
                  reason = `Hook entry must have type: "command" and non-empty string "command" (found type: "${h?.type}").`;
                  break;
                }
              }
              if (invalid) break;
            }
            if (invalid) break;
          }
        }
        if (invalid) {
          violations.push({
            harness: 'codex',
            displayPath: '.codex/hooks.json',
            severity: 'error',
            code: 'CODEX_HOOKS_SCHEMA_INVALID',
            message: reason,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Host Skill Frontmatter Silent-Drop Checks
  const skillDirs: Array<{
    harness: string;
    dir: string;
    type: 'codex' | 'host' | 'evo';
    baseDir: string;
    prefix: string;
  }> = [
    { harness: 'codex', dir: path.join(root, '.agents', 'skills'), type: 'codex', baseDir: root, prefix: '' },
    { harness: 'codex', dir: path.join(root, '.codex', 'skills'), type: 'codex', baseDir: root, prefix: '' },
    { harness: 'gemini', dir: path.join(root, '.gemini', 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'gemini', dir: path.join(root, 'config', 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'opencode', dir: path.join(root, '.opencode', 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'claude', dir: path.join(root, '.claude', 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'cursor', dir: path.join(root, '.cursor', 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'windsurf', dir: path.join(root, '.windsurf', 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'roo', dir: path.join(root, '.roo', 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'root', dir: path.join(root, 'skills'), type: 'host', baseDir: root, prefix: '' },
    { harness: 'evo', dir: path.join(root, '.evo', 'skills'), type: 'evo', baseDir: root, prefix: '' },
  ];

  if (options.includeGlobal) {
    const globalHome = path.resolve(options.globalHomeDir || os.homedir());
    const globalEvoRoot =
      !options.globalHomeDir && process.env.EVO_GLOBAL_DIR
        ? path.resolve(process.env.EVO_GLOBAL_DIR)
        : path.join(globalHome, '.evo', 'global');
    skillDirs.push(
      { harness: 'gemini', dir: path.join(globalHome, '.gemini', 'config', 'skills'), type: 'host', baseDir: globalHome, prefix: '~/' },
      { harness: 'claude', dir: path.join(globalHome, '.claude', 'skills'), type: 'host', baseDir: globalHome, prefix: '~/' },
      { harness: 'cursor', dir: path.join(globalHome, '.cursor', 'skills'), type: 'host', baseDir: globalHome, prefix: '~/' },
      { harness: 'windsurf', dir: path.join(globalHome, '.windsurf', 'skills'), type: 'host', baseDir: globalHome, prefix: '~/' },
      { harness: 'codex', dir: path.join(globalHome, '.agents', 'skills'), type: 'codex', baseDir: globalHome, prefix: '~/' },
      {
        harness: 'evo',
        dir: path.join(globalEvoRoot, '.evo', 'skills'),
        type: 'evo',
        baseDir: globalEvoRoot.toLowerCase().startsWith(globalHome.toLowerCase()) ? globalHome : globalEvoRoot,
        prefix: '~/'.concat(globalEvoRoot.toLowerCase().startsWith(globalHome.toLowerCase()) ? '' : '.evo/global/'),
      }
    );
  }

  const seenSkillFiles = new Set<string>();
  for (const { harness, dir, type, baseDir, prefix } of skillDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of collectMarkdownFiles(dir, 2)) {
      if (path.basename(f) !== 'SKILL.md') continue;
      const resolvedF = path.resolve(f);
      if (seenSkillFiles.has(resolvedF)) continue;
      seenSkillFiles.add(resolvedF);
      const dirName = path.basename(path.dirname(f));
      const relPath = `${prefix}${path.relative(baseDir, f).replace(/\\/g, '/')}`;
      try {
        const raw = fs.readFileSync(f, 'utf8');
        const { meta } = parseFrontmatter(raw);
        const name = meta.name !== undefined && meta.name !== null ? String(meta.name).trim() : undefined;
        const desc = meta.description !== undefined && meta.description !== null ? String(meta.description).trim() : '';

        if (type === 'codex') {
          if (!desc) {
            violations.push({
              harness,
              displayPath: relPath,
              severity: 'error',
              code: 'SKILL_MISSING_DESCRIPTION',
              message: `Codex skill ${relPath} is missing non-empty "description" frontmatter.`,
            });
          }
          if (name !== undefined && name !== dirName) {
            violations.push({
              harness,
              displayPath: relPath,
              severity: 'error',
              code: 'CODEX_SKILL_NAME_MISMATCH',
              message: `Codex skill frontmatter name "${name}" does not match directory name "${dirName}".`,
            });
          }
        } else if (type === 'host') {
          if (!desc || name !== dirName) {
            violations.push({
              harness,
              displayPath: relPath,
              severity: 'error',
              code: 'SKILL_FRONTMATTER_SILENT_DROP',
              message: `Host skill ${relPath} requires both non-empty "description" and "name: ${dirName}" (found name: "${name || ''}", desc: "${desc}"). Missing fields will cause the host to silently drop the skill.`,
            });
          }
        } else if (type === 'evo') {
          if (name !== undefined && name !== dirName) {
            violations.push({
              harness,
              displayPath: relPath,
              severity: 'error',
              code: 'EVO_SKILL_NAME_MISMATCH',
              message: `Internal EvoKernel skill frontmatter name "${name}" does not match directory "${dirName}".`,
            });
          }
          if (!name || !desc) {
            violations.push({
              harness,
              displayPath: relPath,
              severity: 'warning',
              code: 'EVO_SKILL_LEGACY_FRONTMATTER',
              message: `Internal EvoKernel skill ${relPath} uses legacy frontmatter without name/description (will be auto-backfilled by evo refactor --apply).`,
            });
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // 4. Jinja Template Brace Hazard Check
  function scanJinjaFiles(currentDir: string, depth = 0): string[] {
    if (depth > 3 || !fs.existsSync(currentDir)) return [];
    const results: string[] = [];
    try {
      for (const ent of fs.readdirSync(currentDir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
        const full = path.join(currentDir, ent.name);
        if (ent.isDirectory()) {
          results.push(...scanJinjaFiles(full, depth + 1));
        } else if (ent.isFile()) {
          const lower = ent.name.toLowerCase();
          if (lower.endsWith('.j2') || lower.endsWith('.jinja') || lower.endsWith('.jinja2')) {
            results.push(full);
          }
        }
      }
    } catch {
      return results;
    }
    return results;
  }

  for (const jf of scanJinjaFiles(root)) {
    try {
      const raw = fs.readFileSync(jf, 'utf8');
      const relPath = path.relative(root, jf).replace(/\\/g, '/');
      const cleaned = raw.replace(/\s*\{\{\s*instruction\s*\}\}\s*$/, '');
      if (/(?<!\$)\{\{|\{%|\{#/.test(cleaned)) {
        violations.push({
          harness: 'template',
          displayPath: relPath,
          severity: 'error',
          code: 'JINJA_UNESCAPED_BRACE',
          message: `Jinja template ${relPath} contains unescaped {{, {%, or {# tags. Use \${{ to escape GitHub Actions or tool expressions.`,
        });
      }
    } catch {
      // ignore
    }
  }

  // 5. OpenCode markdown/prompt files check
  const opencodeDir = path.join(root, '.opencode');
  if (fs.existsSync(opencodeDir)) {
    for (const f of collectMarkdownFiles(opencodeDir, 3)) {
      try {
        const raw = fs.readFileSync(f, 'utf8');
        const relPath = path.relative(root, f).replace(/\\/g, '/');
        const strippedFences = raw.replace(/```[\s\S]*?```/g, '');
        if (/(?:\{%|\{#)/.test(strippedFences)) {
          violations.push({
            harness: 'opencode',
            displayPath: relPath,
            severity: 'warning',
            code: 'OPENCODE_TEMPLATE_TAG_ADVISORY',
            message: `OpenCode prompt file ${relPath} contains Jinja tag {% or {# outside fenced code blocks.`,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  // 6. Single-file duplicate EVO:START block & Host Global duplicate EVO:START injection checks
  const evoStartCandidates: Array<{ harness: string; fullPath: string; displayPath: string }> = [
    { harness: 'claude', fullPath: path.join(root, 'CLAUDE.md'), displayPath: 'CLAUDE.md' },
    { harness: 'codex', fullPath: path.join(root, 'AGENTS.md'), displayPath: 'AGENTS.md' },
    { harness: 'gemini', fullPath: path.join(root, 'GEMINI.md'), displayPath: 'GEMINI.md' },
    { harness: 'gemini', fullPath: path.join(root, 'rules', 'AGENTS.md'), displayPath: 'rules/AGENTS.md' },
    { harness: 'cursor', fullPath: path.join(root, '.cursor', 'rules', 'evo-kernel.mdc'), displayPath: '.cursor/rules/evo-kernel.mdc' },
  ];
  for (const f of collectMarkdownFiles(path.join(root, 'config', 'rules'), 2)) {
    evoStartCandidates.push({
      harness: 'gemini',
      fullPath: f,
      displayPath: path.relative(root, f).replace(/\\/g, '/'),
    });
  }
  if (options.includeGlobal) {
    const globalHome = path.resolve(options.globalHomeDir || os.homedir());
    evoStartCandidates.push(
      { harness: 'gemini', fullPath: path.join(globalHome, '.gemini', 'GEMINI.md'), displayPath: '~/.gemini/GEMINI.md' },
      { harness: 'claude', fullPath: path.join(globalHome, '.claude', 'CLAUDE.md'), displayPath: '~/.claude/CLAUDE.md' }
    );
    for (const f of collectMarkdownFiles(path.join(globalHome, '.gemini', 'config', 'rules'), 2)) {
      evoStartCandidates.push({
        harness: 'gemini',
        fullPath: f,
        displayPath: `~/${path.relative(globalHome, f).replace(/\\/g, '/')}`,
      });
    }
  }
  const seenEvoStartFiles = new Set<string>();
  for (const cand of evoStartCandidates) {
    const resolved = path.resolve(cand.fullPath);
    if (seenEvoStartFiles.has(resolved) || !fs.existsSync(resolved)) continue;
    seenEvoStartFiles.add(resolved);
    try {
      if (!fs.statSync(resolved).isFile()) continue;
      const raw = fs.readFileSync(resolved, 'utf8');
      const count = (raw.match(/<!-- EVO:START -->/g) || []).length;
      if (count > 1) {
        violations.push({
          harness: cand.harness,
          displayPath: cand.displayPath,
          severity: 'error',
          code: 'DUPLICATE_EVO_START_BLOCK_IN_FILE',
          message: `Rule file ${cand.displayPath} contains ${count} <!-- EVO:START --> blocks; only 1 managed block is allowed per file.`,
        });
      }
    } catch {
      // ignore
    }
  }

  // Check if host global ~/.gemini has duplicate EVO:START across GEMINI.md, config/rules/*.md, and installed plugin rules/AGENTS.md
  const geminiGlobalDirs: Array<{ dir: string; prefix: string }> = [];
  if (path.basename(root).toLowerCase() === '.gemini' || fs.existsSync(path.join(root, 'config', 'plugins'))) {
    geminiGlobalDirs.push({ dir: root, prefix: '' });
  }
  if (options.includeGlobal) {
    const globalHome = path.resolve(options.globalHomeDir || os.homedir());
    const globalGemini = path.join(globalHome, '.gemini');
    if (
      fs.existsSync(globalGemini) &&
      !geminiGlobalDirs.some((d) => path.resolve(d.dir).toLowerCase() === path.resolve(globalGemini).toLowerCase())
    ) {
      geminiGlobalDirs.push({ dir: globalGemini, prefix: '~/.gemini/' });
    }
  }
  for (const { dir: gemDir, prefix } of geminiGlobalDirs) {
    const pluginRulePath = path.join(gemDir, 'config', 'plugins', 'evo-kernel', 'rules', 'AGENTS.md');
    const hasPluginEvoStart =
      fs.existsSync(pluginRulePath) &&
      fs.readFileSync(pluginRulePath, 'utf8').includes('<!-- EVO:START -->');
    const rootGeminiPath = path.join(gemDir, 'GEMINI.md');
    const hasRootEvoStart =
      fs.existsSync(rootGeminiPath) &&
      fs.readFileSync(rootGeminiPath, 'utf8').includes('<!-- EVO:START -->');

    if (hasPluginEvoStart && hasRootEvoStart) {
      violations.push({
        harness: 'gemini',
        displayPath: `${prefix}GEMINI.md`,
        severity: 'warning',
        code: 'DUPLICATE_GLOBAL_EVO_START_BLOCK',
        message: `${prefix}GEMINI.md contains <!-- EVO:START --> which duplicates the enabled plugin rule (${prefix}config/plugins/evo-kernel/rules/AGENTS.md).`,
      });
    }
    for (const f of collectMarkdownFiles(path.join(gemDir, 'config', 'rules'), 2)) {
      try {
        const raw = fs.readFileSync(f, 'utf8');
        if (raw.includes('<!-- EVO:START -->') && (hasPluginEvoStart || hasRootEvoStart)) {
          const rel = `${prefix}${path.relative(gemDir, f).replace(/\\/g, '/')}`;
          violations.push({
            harness: 'gemini',
            displayPath: rel,
            severity: 'warning',
            code: 'DUPLICATE_GLOBAL_EVO_START_BLOCK',
            message: `${rel} contains a redundant <!-- EVO:START --> block alongside ${hasPluginEvoStart ? `${prefix}config/plugins/evo-kernel/rules/AGENTS.md` : `${prefix}GEMINI.md`}.`,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  return violations;
}

const REPO_ANCHORED_GLOBAL_GLOB_REGEX =
  /^(?:\.\/)?(?:src|lib|app|packages|components|core|server|client|internal|cmd|pkg)\//i;

export function runAudit(workspaceRoot: string, options: AuditOptions = {}): AuditReport {
  const root = path.resolve(workspaceRoot);
  const includeGlobal = Boolean(options.includeGlobal);
  const globalHomeDir = path.resolve(options.globalHomeDir || os.homedir());
  const globalRoot =
    !options.globalHomeDir && process.env.EVO_GLOBAL_DIR
      ? path.resolve(process.env.EVO_GLOBAL_DIR)
      : path.join(globalHomeDir, '.evo', 'global');
  const localStorage = new EvoStorage(root);
  const globalStorage = new EvoStorage(globalRoot);
  const isWorkspaceSameAsGlobal =
    path.resolve(localStorage.evoDir).toLowerCase() ===
    path.resolve(globalStorage.evoDir).toLowerCase();

  const tokenBudgetLimit =
    options.tokenBudgetLimit ?? (localStorage.getConfig().maxCoreRuleTokens || 1500);
  const baseSeedTokens = estimateTokens(renderManagedBlock('', ''));
  const managedBlockBudgetLimit =
    options.tokenBudgetLimit !== undefined
      ? options.tokenBudgetLimit
      : tokenBudgetLimit + baseSeedTokens + MAX_TOOLS_CATALOG_TOKENS;
  const skillBudgetLimit =
    options.skillBudgetLimit ?? Math.max(tokenBudgetLimit * 2, 3000);
  const overlapThreshold = options.overlapThreshold ?? 0.25;

  const entries = discoverAuditableFiles(root, includeGlobal, globalHomeDir, globalRoot);
  const files: AuditedFileMetric[] = [];
  const budgetViolations: AuditedFileMetric[] = [];
  const domainLeaks: DomainLeakWarning[] = [];
  const fileContents = new Map<string, { meta: AuditedFileMetric; raw: string; tokens: Set<string> }>();

  for (const entry of entries) {
    try {
      if (!fs.statSync(entry.fullPath).isFile()) continue;
    } catch {
      continue;
    }
    const raw = fs.readFileSync(entry.fullPath, 'utf8');
    const markerMatch = raw.match(/<!-- EVO:START -->[\s\S]*?<!-- EVO:END -->/);
    const textToMeasure = markerMatch ? markerMatch[0] : raw;
    const tokens = estimateTokens(textToMeasure);
    const effectiveLimit = markerMatch
      ? managedBlockBudgetLimit
      : entry.kind === 'skill'
        ? skillBudgetLimit
        : tokenBudgetLimit;
    const overBudget = tokens > effectiveLimit;
    const totalTokens = estimateTokens(raw);
    const evoSeedTokens = markerMatch ? tokens : 0;
    const userStaticTokens = markerMatch ? estimateTokens(raw.replace(markerMatch[0], '')) : tokens;
    const metric: AuditedFileMetric = {
      scope: entry.scope,
      kind: entry.kind,
      displayPath: entry.displayPath,
      fullPath: entry.fullPath,
      bytes: Buffer.byteLength(raw, 'utf8'),
      tokens,
      budgetLimit: effectiveLimit,
      overBudget,
      totalTokens,
      userStaticTokens,
      evoSeedTokens,
    };
    files.push(metric);
    if (overBudget) {
      budgetViolations.push(metric);
    }

    const strippedManaged = raw.replace(/<!-- EVO:START -->[\s\S]*?<!-- EVO:END -->/g, '');
    fileContents.set(entry.displayPath, {
      meta: metric,
      raw: strippedManaged,
      tokens: tokenizeContentForOverlap(strippedManaged),
    });

    // Check domain leaks in global files OR top-level unscoped workspace rules containing private macros/paths
    const isScopedRule = entry.displayPath.includes('.evo/rules/scoped/');
    if (!isScopedRule && (entry.scope === 'global' || entry.kind === 'rule')) {
      const matched: string[] = [];
      let suggestedGlob = '**/*';
      for (const pat of DOMAIN_LEAK_PATTERNS) {
        // For workspace-local rules, only flag hardcoded user paths or embedded hardware macros if not in scoped/
        if (
          entry.scope === 'workspace' &&
          !pat.label.includes('Embedded Hardware') &&
          !pat.label.includes('Hardcoded User')
        ) {
          continue;
        }
        if (pat.regex.test(strippedManaged)) {
          matched.push(pat.label);
          if (suggestedGlob === '**/*' && pat.suggestedGlob !== '**/*') {
            suggestedGlob = pat.suggestedGlob;
          }
        }
      }

      if (matched.length > 0) {
        domainLeaks.push({
          scope: entry.scope,
          kind: entry.kind,
          displayPath: entry.displayPath,
          matchedIndicators: matched,
          suggestedScopeGlob: suggestedGlob,
          recommendation:
            entry.scope === 'global'
              ? `Demote domain-specific constraints from global ${entry.displayPath} to project-local AGENTS.md or .evo/rules/scoped/ (scope: "${suggestedGlob}").`
              : `Move domain-coupled guardrails from top-level ${entry.displayPath} into .evo/rules/scoped/ (scope: "${suggestedGlob}") for on-demand L0->L2 recall.`,
        });
      }
    }
  }

  // Redundancy overlap analysis between rule files and skill files (or across duplicate rule files)
  const redundancyOverlaps: RedundancyOverlap[] = [];
  const items = Array.from(fileContents.values());

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      // Compare rule <-> skill or global <-> workspace rule
      const isRuleSkillPair = a.meta.kind !== b.meta.kind;
      const isGlobalLocalPair = a.meta.scope !== b.meta.scope;
      if (!isRuleSkillPair && !isGlobalLocalPair) continue;
      if (a.tokens.size < 8 || b.tokens.size < 8) continue;

      const shared: string[] = [];
      for (const tok of a.tokens) {
        if (b.tokens.has(tok)) shared.push(tok);
      }
      const union = a.tokens.size + b.tokens.size - shared.length;
      const sim = union === 0 ? 0 : shared.length / union;

      if (sim >= overlapThreshold) {
        redundancyOverlaps.push({
          fileA: a.meta.displayPath,
          fileB: b.meta.displayPath,
          similarity: Number(sim.toFixed(2)),
          sharedTerms: shared.slice(0, 8),
          recommendation: isRuleSkillPair
            ? `Deduplicate overlapping architecture rules between ${a.meta.displayPath} and ${b.meta.displayPath}; convert the skill to STE-Lite SOP calling evo_search/evo_propose.`
            : `Eliminate global/local rule duplication between ${a.meta.displayPath} and ${b.meta.displayPath}.`,
        });
      }
    }
  }

  // Retroactive Gate 1.5 rule compliance checks
  const gateViolations: GateViolationWarning[] = [];
  if (fs.existsSync(localStorage.rulesDir)) {
    const localRules = localStorage.listRules();
    for (const rule of localRules) {
      const violations = auditRuleGate1_5(rule);
      if (isWorkspaceSameAsGlobal && REPO_ANCHORED_GLOBAL_GLOB_REGEX.test(rule.scope_glob.trim())) {
        violations.push({
          code: 'ERR_GLOBAL_RULE_REPO_LEAK',
          detail: `Global rule '${rule.id}' has repo-anchored scope_glob '${rule.scope_glob}'; global rules must use repo-agnostic globs (e.g., '**/*.ts' or '**/*').`,
        });
      }
      if (violations.length > 0) {
        const coreCandidate = path.join(localStorage.rulesDir, `${rule.id}.md`);
        const scopedCandidate = path.join(localStorage.rulesDir, 'scoped', `${rule.id}.md`);
        const actualPath = fs.existsSync(scopedCandidate)
          ? scopedCandidate
          : fs.existsSync(coreCandidate)
            ? coreCandidate
            : (rule.core ? coreCandidate : scopedCandidate);
        const rel = path.relative(root, actualPath).replace(/\\/g, '/');
        gateViolations.push({
          scope: isWorkspaceSameAsGlobal ? 'global' : 'workspace',
          ruleId: rule.id,
          displayPath: rel,
          violations,
        });
      }
    }
  }

  if (includeGlobal && !isWorkspaceSameAsGlobal) {
    if (fs.existsSync(globalStorage.rulesDir)) {
      const globalRules = globalStorage.listRules();
      for (const rule of globalRules) {
        const violations = auditRuleGate1_5(rule);
        if (REPO_ANCHORED_GLOBAL_GLOB_REGEX.test(rule.scope_glob.trim())) {
          violations.push({
            code: 'ERR_GLOBAL_RULE_REPO_LEAK',
            detail: `Global rule '${rule.id}' has repo-anchored scope_glob '${rule.scope_glob}'; global rules must use repo-agnostic globs (e.g., '**/*.ts' or '**/*').`,
          });
        }
        if (violations.length > 0) {
          const coreCandidate = path.join(globalStorage.rulesDir, `${rule.id}.md`);
          const scopedCandidate = path.join(globalStorage.rulesDir, 'scoped', `${rule.id}.md`);
          const actualPath = fs.existsSync(scopedCandidate)
            ? scopedCandidate
            : fs.existsSync(coreCandidate)
              ? coreCandidate
              : (rule.core ? coreCandidate : scopedCandidate);
          const rel = path.relative(globalHomeDir, actualPath).replace(/\\/g, '/');
          gateViolations.push({
            scope: 'global',
            ruleId: rule.id,
            displayPath: `~/${rel}`,
            violations,
          });
        }
      }
    }
  }

  const brokenCapabilityRefs: BrokenCapabilityRef[] = [];
  if (fs.existsSync(localStorage.rulesDir)) {
    const localRules = localStorage.listRules();
    for (const rule of localRules) {
      const extraKnown = new Set([rule.id, ...(rule.supersedes_id ? [rule.supersedes_id] : [])]);
      const missing = validateCapabilityReferences(rule.content || '', localStorage, extraKnown);
      if (missing.length > 0) {
        const coreCandidate = path.join(localStorage.rulesDir, `${rule.id}.md`);
        const scopedCandidate = path.join(localStorage.rulesDir, 'scoped', `${rule.id}.md`);
        const actualPath = fs.existsSync(scopedCandidate)
          ? scopedCandidate
          : fs.existsSync(coreCandidate)
            ? coreCandidate
            : (rule.core ? coreCandidate : scopedCandidate);
        const rel = path.relative(root, actualPath).replace(/\\/g, '/');
        brokenCapabilityRefs.push({
          scope: isWorkspaceSameAsGlobal ? 'global' : 'workspace',
          displayPath: rel,
          missingIds: missing,
        });
      }
    }
  }
  if (fs.existsSync(localStorage.skillsDir)) {
    const localSkills = localStorage.listSkills();
    for (const skill of localSkills) {
      const extraKnown = new Set([skill.id, ...(skill.supersedes_id ? [skill.supersedes_id] : [])]);
      const skillContent = [skill.l1_contract, skill.l2_sop].filter(Boolean).join('\n');
      const missing = validateCapabilityReferences(skillContent, localStorage, extraKnown);
      if (missing.length > 0) {
        const skillPath = path.join(localStorage.skillsDir, skill.id, 'SKILL.md');
        const rel = path.relative(root, skillPath).replace(/\\/g, '/');
        brokenCapabilityRefs.push({
          scope: isWorkspaceSameAsGlobal ? 'global' : 'workspace',
          displayPath: rel,
          missingIds: missing,
        });
      }
    }
  }

  if (includeGlobal && !isWorkspaceSameAsGlobal) {
    if (fs.existsSync(globalStorage.rulesDir)) {
      const globalRules = globalStorage.listRules();
      for (const rule of globalRules) {
        const extraKnown = new Set([rule.id, ...(rule.supersedes_id ? [rule.supersedes_id] : [])]);
        const missing = validateCapabilityReferences(rule.content || '', globalStorage, extraKnown);
        if (missing.length > 0) {
          const coreCandidate = path.join(globalStorage.rulesDir, `${rule.id}.md`);
          const scopedCandidate = path.join(globalStorage.rulesDir, 'scoped', `${rule.id}.md`);
          const actualPath = fs.existsSync(scopedCandidate)
            ? scopedCandidate
            : fs.existsSync(coreCandidate)
              ? coreCandidate
              : (rule.core ? coreCandidate : scopedCandidate);
          const rel = path.relative(globalHomeDir, actualPath).replace(/\\/g, '/');
          brokenCapabilityRefs.push({
            scope: 'global',
            displayPath: `~/${rel}`,
            missingIds: missing,
          });
        }
      }
    }
    if (fs.existsSync(globalStorage.skillsDir)) {
      const globalSkills = globalStorage.listSkills();
      for (const skill of globalSkills) {
        const extraKnown = new Set([skill.id, ...(skill.supersedes_id ? [skill.supersedes_id] : [])]);
        const skillContent = [skill.l1_contract, skill.l2_sop].filter(Boolean).join('\n');
        const missing = validateCapabilityReferences(skillContent, globalStorage, extraKnown);
        if (missing.length > 0) {
          const skillPath = path.join(globalStorage.skillsDir, skill.id, 'SKILL.md');
          const rel = path.relative(globalHomeDir, skillPath).replace(/\\/g, '/');
          brokenCapabilityRefs.push({
            scope: 'global',
            displayPath: `~/${rel}`,
            missingIds: missing,
          });
        }
      }
    }
  }

  const surfaceViolations = auditHarnessSurfaces(root, { includeGlobal, globalHomeDir });

  const contestedCapabilities: ContestedCapability[] = [];
  const dbPath = localStorage.telemetryDbPath;
  if (fs.existsSync(dbPath)) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const stmt = db.prepare(`
        SELECT id, kind, helped_count, hurt_count, contested_count
        FROM telemetry
      `);
      const rows = stmt.all() as Array<{
        id: string;
        kind: 'rule' | 'skill' | 'tool' | 'memory';
        helped_count: number;
        hurt_count: number;
        contested_count: number;
      }>;
      for (const record of rows) {
        const totalOutcomes = (record.helped_count || 0) + (record.hurt_count || 0) + (record.contested_count || 0);
        if (totalOutcomes >= 2 && ((record.hurt_count || 0) + (record.contested_count || 0)) > (record.helped_count || 0)) {
          contestedCapabilities.push({
            id: record.id,
            kind: record.kind,
            helped_count: record.helped_count || 0,
            hurt_count: record.hurt_count || 0,
            contested_count: record.contested_count || 0,
          });
        }
      }
    } catch {
      // Ignore read-only DB errors
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  const healthy =
    budgetViolations.length === 0 &&
    domainLeaks.length === 0 &&
    redundancyOverlaps.length === 0 &&
    gateViolations.length === 0 &&
    brokenCapabilityRefs.length === 0 &&
    !surfaceViolations.some((v) => v.severity === 'error');

  return {
    workspaceRoot: root,
    includeGlobal,
    tokenBudgetLimit,
    skillBudgetLimit,
    files,
    budgetViolations,
    domainLeaks,
    redundancyOverlaps,
    gateViolations,
    brokenCapabilityRefs,
    surfaceViolations,
    contestedCapabilities,
    healthy,
  };
}

export function renderAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push('╭──────────────────────────────────────────────────────────────────────────╮');
  lines.push('│ 🩺 EvoKernel Rule & Skill Architecture Audit (`evo audit`)               │');
  lines.push('╰──────────────────────────────────────────────────────────────────────────╯');
  lines.push(`📦 Workspace : ${report.workspaceRoot}`);
  lines.push(`🌐 Scope     : ${report.includeGlobal ? 'Workspace + Global (~/.gemini, ~/.claude, ~/.cursor)' : 'Workspace Only (pass --global to include user-level configs)'}`);
  lines.push(`🛡️  Budget Cap: ${report.tokenBudgetLimit} tokens per always-on rule file (${report.skillBudgetLimit} tokens per on-demand SKILL.md)`);
  lines.push('');

  lines.push(`├── 📄 Scanned Rule & Skill Assets (${report.files.length} files)`);
  if (report.files.length === 0) {
    lines.push('│   └── (no rule or skill files found)');
  } else {
    for (const f of report.files) {
      const badge = f.overBudget ? '⚠️ OVER_BUDGET' : '✅ HEALTHY';
      lines.push(
        `│   ├── [${f.scope.toUpperCase()}:${f.kind.toUpperCase()}] ${f.displayPath} — ${f.tokens}/${f.budgetLimit} tokens (${badge})`
      );
    }
  }

  lines.push(`├── 🚨 Domain Leak Warnings (${report.domainLeaks.length} detected)`);
  if (report.domainLeaks.length === 0) {
    lines.push('│   └── None — Global and root rules are domain-clean.');
  } else {
    for (const leak of report.domainLeaks) {
      lines.push(
        `│   ├── [LEAK] ${leak.displayPath}: ${leak.matchedIndicators.join(', ')}`
      );
      lines.push(`│   │      └─ Action: ${leak.recommendation}`);
    }
  }

  lines.push(`├── 🛡️  Gate 1.5 Rule Compliance Violations (${report.gateViolations.length} detected)`);
  if (report.gateViolations.length === 0) {
    lines.push('│   └── None — All rules in .evo/rules/ comply with Gate 1.5 abstraction guardrails.');
  } else {
    for (const gv of report.gateViolations) {
      lines.push(`│   ├── [${gv.scope.toUpperCase()}:RULE] ${gv.displayPath} (${gv.ruleId})`);
      for (const v of gv.violations) {
        lines.push(`│   │      └─ [${v.code}] ${v.message}`);
      }
    }
  }

  lines.push(`├── 🔄 Rule/Skill Redundancy Overlaps (${report.redundancyOverlaps.length} detected)`);
  if (report.redundancyOverlaps.length === 0) {
    lines.push('│   └── None — Low Jaccard overlap across rules and skills.');
  } else {
    for (const ov of report.redundancyOverlaps) {
      lines.push(
        `│   ├── [OVERLAP ${(ov.similarity * 100).toFixed(0)}%] ${ov.fileA} <-> ${ov.fileB} (shared: ${ov.sharedTerms.join(', ')})`
      );
      lines.push(`│   │      └─ Action: ${ov.recommendation}`);
    }
  }

  lines.push(`├── 🔗 Broken Capability References (${report.brokenCapabilityRefs.length} detected)`);
  if (report.brokenCapabilityRefs.length === 0) {
    lines.push('│   └── None — All referenced rules, skills, tools, and memories exist.');
  } else {
    for (const bcr of report.brokenCapabilityRefs) {
      lines.push(
        `│   ├── [${bcr.scope.toUpperCase()}] ${bcr.displayPath} -> missing: ${bcr.missingIds.join(', ')}`
      );
    }
  }

  lines.push(`├── 🌐 Multi-Harness Surface Violations (${report.surfaceViolations.length} detected)`);
  if (report.surfaceViolations.length === 0) {
    lines.push('│   └── None — All harness surface configurations and skills are valid.');
  } else {
    for (const sv of report.surfaceViolations) {
      const badge = sv.severity === 'error' ? '❌ ERROR' : '⚠️ WARN';
      lines.push(
        `│   ├── [${sv.harness.toUpperCase()}:${badge}] ${sv.displayPath}: [${sv.code}] ${sv.message}`
      );
    }
  }

  lines.push(`└── ⚔️  Contested Capabilities (${report.contestedCapabilities.length} detected)`);
  if (report.contestedCapabilities.length === 0) {
    lines.push('    └── None — No capabilities have contested/hurt exceeding helped.');
  } else {
    for (const cc of report.contestedCapabilities) {
      lines.push(
        `    ├── [CONTESTED:${cc.kind.toUpperCase()}] ${cc.id} (${cc.hurt_count + cc.contested_count} hurt/contested vs ${cc.helped_count} helped)`
      );
    }
  }

  lines.push('');
  if (report.healthy) {
    lines.push('✨ Audit Status: HEALTHY (Zero budget bloat, zero domain leaks, zero redundant coupling, zero Gate 1.5 violations, zero broken capability refs, zero surface errors).');
  } else {
    lines.push(
      '💡 Next Step: Run `evo refactor` (or `evo refactor --apply`) to execute the 4-stage decoupling workflow via `evo-rule-architect`.'
    );
  }

  return lines.join('\n');
}

export function ensureRuleArchitectSkill(workspaceRoot: string): EvoSkill {
  const storage = new EvoStorage(workspaceRoot);
  storage.ensureInitialized();
  const existing = storage.getSkill('evo-rule-architect');
  if (existing) {
    return existing;
  }

  const telemetry = new EvoTelemetry(storage);
  const gatekeeper = new EvoGatekeeper(storage, telemetry);
  try {
    gatekeeper.evaluateAndCommit(EVO_RULE_ARCHITECT_PROPOSAL);
  } finally {
    telemetry.close();
  }

  return storage.getSkill('evo-rule-architect')!;
}

export function runRefactor(workspaceRoot: string, options: RefactorOptions = {}): RefactorResult {
  const root = path.resolve(workspaceRoot);
  const skill = ensureRuleArchitectSkill(root);
  const audit = runAudit(root, {
    includeGlobal: options.includeGlobal ?? true,
    globalHomeDir: options.globalHomeDir,
    tokenBudgetLimit: options.tokenBudgetLimit,
    skillBudgetLimit: options.skillBudgetLimit,
    overlapThreshold: options.overlapThreshold,
  });

  const globalRuleLeaks = audit.domainLeaks.filter((l) => l.scope === 'global' && l.kind === 'rule');
  const globalSkillLeaks = audit.domainLeaks.filter((l) => l.scope === 'global' && l.kind === 'skill');
  const globalGateViolations = audit.gateViolations.filter((g) => g.scope === 'global');
  const localGateViolations = audit.gateViolations.filter((g) => g.scope === 'workspace');
  const localLeaksAndBloat = [
    ...audit.domainLeaks.filter((l) => l.scope === 'workspace').map((l) => l.displayPath),
    ...audit.budgetViolations.filter((b) => b.scope === 'workspace').map((b) => b.displayPath),
    ...localGateViolations.map((g) => g.displayPath),
  ];
  const uniqueLocalTargets = Array.from(new Set(localLeaksAndBloat));

  const stage1Targets = Array.from(
    new Set([
      ...globalRuleLeaks.map((l) => l.displayPath),
      ...globalGateViolations.map((g) => g.displayPath),
    ])
  );
  const stage1Actions = [
    ...globalRuleLeaks.map(
      (l) =>
        `Strip [${l.matchedIndicators.join(', ')}] from ${l.displayPath}; retain only EvoKernel L0 Seed + Epistemic Protocol + Concise Style.`
    ),
    ...globalGateViolations.map(
      (g) =>
        `Remediate Gate 1.5 violation(s) [${g.violations.map((v) => v.code).join(', ')}] in ${g.displayPath} (rule: ${g.ruleId}).`
    ),
  ];

  const localStorage = new EvoStorage(root);
  const contestedCoreRules = audit.contestedCapabilities.filter((c) => {
    if (c.kind !== 'rule') return false;
    const rule = localStorage.getRule(c.id);
    return rule && rule.core;
  });

  const stage3Actions = [
    ...audit.domainLeaks
      .filter((l) => l.scope === 'workspace')
      .map(
        (l) =>
          `Extract domain-specific sections from ${l.displayPath} into .evo/rules/scoped/ (core: false) and wire L0 routing seed.`
      ),
    ...audit.budgetViolations
      .filter((b) => b.scope === 'workspace')
      .map(
        (b) =>
          `Split or compact ${b.displayPath} (${b.tokens}/${b.budgetLimit} tokens) into .evo/rules/scoped/ (core: false).`
      ),
    ...localGateViolations.map(
      (g) =>
        `Remediate Gate 1.5 violation(s) [${g.violations.map((v) => v.code).join(', ')}] in ${g.displayPath} (rule: ${g.ruleId}).`
    ),
    ...contestedCoreRules.map(
      (c) =>
        `Demote contested core rule '${c.id}' (${c.hurt_count + c.contested_count} hurt/contested vs ${c.helped_count} helped) to .evo/rules/scoped/ (core: false).`
    ),
  ];

  const skillFrontmatterViolations = audit.surfaceViolations.filter(
    (v) =>
      v.code === 'SKILL_FRONTMATTER_SILENT_DROP' ||
      v.code === 'SKILL_MISSING_DESCRIPTION' ||
      v.code === 'CODEX_SKILL_NAME_MISMATCH' ||
      v.code === 'EVO_SKILL_NAME_MISMATCH' ||
      v.code === 'EVO_SKILL_LEGACY_FRONTMATTER'
  );

  const stage4Actions = [
    ...audit.redundancyOverlaps.map((o) => o.recommendation),
    ...skillFrontmatterViolations.map(
      (v) => `Auto-backfill missing frontmatter (name/description) on ${v.displayPath}`
    ),
  ];

  const stage4Targets = Array.from(
    new Set([
      ...audit.redundancyOverlaps.map((o) => `${o.fileA} <-> ${o.fileB}`),
      ...skillFrontmatterViolations.map((v) => v.displayPath),
    ])
  );

  const stages: RefactorStageAction[] = [
    {
      stage: 1,
      title: '全局提纯 (Global Rule Purification)',
      targets: stage1Targets,
      actions:
        stage1Actions.length > 0
          ? stage1Actions
          : ['Global rules are already domain-clean (no action needed).'],
    },
    {
      stage: 2,
      title: '全局技能脱敏 (Global Skill Desensitization)',
      targets: globalSkillLeaks.map((l) => l.displayPath),
      actions:
        globalSkillLeaks.length > 0
          ? globalSkillLeaks.map(
              (l) =>
                `Replace hardcoded domain terms [${l.matchedIndicators.join(', ')}] in ${l.displayPath} with generic placeholders.`
            )
          : ['Global skills have no hardcoded project/domain leaks.'],
    },
    {
      stage: 3,
      title: '局部下沉与 Scoped 拆分 (Local Demotion & Scoped Splitting)',
      targets: Array.from(
        new Set([...uniqueLocalTargets, ...contestedCoreRules.map((c) => `.evo/rules/${c.id}.md`)])
      ),
      actions:
        stage3Actions.length > 0
          ? Array.from(new Set(stage3Actions))
          : ['Local rules are within the 1,500-token budget and properly scoped.'],
    },
    {
      stage: 4,
      title: '局部技能 STE-Lite 化 (Local Skill STE-Lite Conversion)',
      targets: stage4Targets,
      actions:
        stage4Actions.length > 0
          ? Array.from(new Set(stage4Actions))
          : ['Local skills have no redundant overlap with AGENTS.md.'],
    },
  ];

  const appliedChanges: string[] = [];

  if (options.apply) {
    const storage = new EvoStorage(root);
    storage.ensureInitialized();
    const now = new Date().toISOString();

    for (const leak of audit.domainLeaks.filter((l) => l.scope === 'workspace' && l.kind === 'rule')) {
      const targetMetric = audit.files.find((f) => f.displayPath === leak.displayPath);
      if (!targetMetric || !fs.existsSync(targetMetric.fullPath)) continue;

      const raw = fs.readFileSync(targetMetric.fullPath, 'utf8');
      const stripped = raw.replace(/<!-- EVO:START -->[\s\S]*?<!-- EVO:END -->/g, '').trim();
      if (!stripped) continue;

      const baseSlug = sanitizeId(path.basename(targetMetric.fullPath, path.extname(targetMetric.fullPath)));
      const scopedId = `scoped-${baseSlug}-domain-guard`;
      const summaryLine = `Domain guardrails extracted from ${leak.displayPath} (${leak.matchedIndicators[0]}).`.slice(
        0,
        135
      );

      storage.saveRule({
        id: scopedId,
        title: `Scoped Domain Guardrails (${leak.displayPath})`,
        l0_summary: summaryLine,
        scope_glob: leak.suggestedScopeGlob,
        core: false,
        priority: 60,
        content: stripped,
        tokens: estimateTokens(stripped),
        origin: 'refactor',
        transfer_scenarios: [
          `Cross-module verification for files matching ${leak.suggestedScopeGlob}`,
          `Architectural boundary and state transition checks across ${baseSlug} workflows`,
        ],
        created_at: now,
        updated_at: now,
      });

      const pointerHeader = [
        `# Project Rules (${path.basename(targetMetric.fullPath)})`,
        '',
        `> Domain-specific constraints were decoupled into \`.evo/rules/scoped/${scopedId}.md\` (scope: \`${leak.suggestedScopeGlob}\`).`,
        `> Call \`evo_search\` or \`evo_inspect(id: "${scopedId}", tier: "L2")\` when working on matching files.`,
        '',
      ].join('\n');

      fs.writeFileSync(targetMetric.fullPath, pointerHeader, 'utf8');
      runInit(root, { targets: ['auto'] });
      appliedChanges.push(
        `Extracted ${leak.displayPath} -> .evo/rules/scoped/${scopedId}.md (scope: ${leak.suggestedScopeGlob})`
      );
    }

    const remediateRuleGateViolations = (
      targetStorage: EvoStorage,
      violationsList: GateViolationWarning[]
    ) => {
      for (const gv of violationsList) {
        const existingRule = targetStorage.getRule(gv.ruleId);
        if (!existingRule) continue;
        let modified = false;
        const updatedRule = { ...existingRule };

        if (gv.violations.some((v) => v.code === 'ERR_SCOPE_TOO_NARROW')) {
          const ext = path.posix.extname(updatedRule.scope_glob.replace(/\\/g, '/'));
          const dir = path.posix.dirname(updatedRule.scope_glob.replace(/\\/g, '/'));
          updatedRule.scope_glob =
            dir && dir !== '.' ? `${dir}/**/*${ext || ''}` : `**/*${ext || ''}`;
          modified = true;
        }

        if (gv.violations.some((v) => v.code === 'ERR_GLOBAL_RULE_REPO_LEAK')) {
          const tail = path.posix.basename(updatedRule.scope_glob.trim().replace(/\\/g, '/'));
          updatedRule.scope_glob = tail && tail !== '**' ? `**/${tail}` : '**/*';
          modified = true;
        }

        if (gv.violations.some((v) => v.code === 'ERR_INSUFFICIENT_TRANSFER_SCENARIOS')) {
          const existingScenarios = Array.isArray(updatedRule.transfer_scenarios)
            ? updatedRule.transfer_scenarios.filter((s) => String(s).trim().length >= 8)
            : [];
          const defaults = [
            `Cross-module verification for files matching ${updatedRule.scope_glob}`,
            `Subsystem boundary and regression checks for ${updatedRule.id}`,
          ];
          updatedRule.transfer_scenarios = Array.from(
            new Set([...existingScenarios, ...defaults])
          ).slice(0, Math.max(2, existingScenarios.length));
          modified = true;
        }

        if (modified) {
          updatedRule.updated_at = now;
          targetStorage.saveRule(updatedRule);
          appliedChanges.push(
            `Remediated Gate 1.5 metadata on rule '${updatedRule.id}' (${gv.displayPath})`
          );
        }
      }
    };

    remediateRuleGateViolations(storage, localGateViolations);

    if ((options.includeGlobal ?? true) && globalGateViolations.length > 0) {
      const globalHomeDir = options.globalHomeDir ?? os.homedir();
      const globalRoot = process.env.EVO_GLOBAL_DIR
        ? path.resolve(process.env.EVO_GLOBAL_DIR)
        : path.join(globalHomeDir, '.evo', 'global');
      const globalStorage = new EvoStorage(globalRoot);
      if (fs.existsSync(globalStorage.rulesDir)) {
        remediateRuleGateViolations(globalStorage, globalGateViolations);
      }
    }

    // 3. Auto-backfill missing skill frontmatter
    const skillDirs: Array<{ dir: string; baseDir: string; prefix: string }> = [
      { dir: path.join(root, '.agents', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.codex', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.gemini', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, 'config', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.opencode', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.claude', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.cursor', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.windsurf', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.roo', 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, 'skills'), baseDir: root, prefix: '' },
      { dir: path.join(root, '.evo', 'skills'), baseDir: root, prefix: '' },
    ];
    if (options.includeGlobal ?? true) {
      const globalHome = path.resolve(options.globalHomeDir ?? os.homedir());
      const globalEvoRoot =
        !options.globalHomeDir && process.env.EVO_GLOBAL_DIR
          ? path.resolve(process.env.EVO_GLOBAL_DIR)
          : path.join(globalHome, '.evo', 'global');
      skillDirs.push(
        { dir: path.join(globalHome, '.gemini', 'config', 'skills'), baseDir: globalHome, prefix: '~/' },
        { dir: path.join(globalHome, '.claude', 'skills'), baseDir: globalHome, prefix: '~/' },
        { dir: path.join(globalHome, '.cursor', 'skills'), baseDir: globalHome, prefix: '~/' },
        { dir: path.join(globalHome, '.windsurf', 'skills'), baseDir: globalHome, prefix: '~/' },
        { dir: path.join(globalHome, '.agents', 'skills'), baseDir: globalHome, prefix: '~/' },
        {
          dir: path.join(globalEvoRoot, '.evo', 'skills'),
          baseDir: globalEvoRoot.toLowerCase().startsWith(globalHome.toLowerCase()) ? globalHome : globalEvoRoot,
          prefix: '~/'.concat(globalEvoRoot.toLowerCase().startsWith(globalHome.toLowerCase()) ? '' : '.evo/global/'),
        }
      );
    }
    const seenBackfillSkills = new Set<string>();
    for (const { dir: sDir, baseDir, prefix } of skillDirs) {
      if (!fs.existsSync(sDir)) continue;
      for (const f of collectMarkdownFiles(sDir, 2)) {
        if (path.basename(f) !== 'SKILL.md') continue;
        const resolvedF = path.resolve(f);
        if (seenBackfillSkills.has(resolvedF)) continue;
        seenBackfillSkills.add(resolvedF);
        const dirName = path.basename(path.dirname(f));
        try {
          const raw = fs.readFileSync(f, 'utf8');
          const { meta, body } = parseFrontmatter(raw);
          let changed = false;
          const currentName = meta.name !== undefined && meta.name !== null ? String(meta.name).trim() : '';
          const currentDesc = meta.description !== undefined && meta.description !== null ? String(meta.description).trim() : '';
          if (!currentName || currentName !== dirName) {
            meta.name = dirName;
            changed = true;
          }
          if (!currentDesc) {
            const fallback =
              typeof meta.title === 'string' && meta.title.trim()
                ? meta.title.trim()
                : typeof meta.l0_summary === 'string' && meta.l0_summary.trim()
                  ? meta.l0_summary.trim()
                  : `${dirName} skill instructions.`;
            meta.description = fallback;
            changed = true;
          }
          if (changed) {
            const lines: string[] = ['---'];
            for (const [k, v] of Object.entries(meta)) {
              lines.push(`${k}: ${JSON.stringify(v)}`);
            }
            lines.push('---');
            lines.push(body.startsWith('\n') ? body.slice(1) : body);
            fs.writeFileSync(f, lines.join('\n'), 'utf8');
            const rel = `${prefix}${path.relative(baseDir, f).replace(/\\/g, '/')}`;
            appliedChanges.push(`Auto-backfilled skill frontmatter on ${rel}`);
          }
        } catch {
          // ignore
        }
      }
    }

    // 4. Demote contested core rules to scoped
    for (const c of contestedCoreRules) {
      const rule = storage.getRule(c.id);
      if (rule && rule.core) {
        rule.core = false;
        rule.updated_at = now;
        storage.saveRule(rule);
        appliedChanges.push(`Demoted contested core rule '${rule.id}' to scoped (core: false)`);
      }
    }
    if (contestedCoreRules.length > 0) {
      syncManagedRuleBlocks(root);
    }
  }

  return {
    audit,
    skillInstalled: `.evo/skills/${skill.id}/SKILL.md`,
    stages,
    appliedChanges,
  };
}

export function renderRefactorReport(result: RefactorResult): string {
  const lines: string[] = [];
  lines.push('╭──────────────────────────────────────────────────────────────────────────╮');
  lines.push('│ 🔧 EvoKernel 4-Stage Rule & Skill Decoupling Engine (`evo refactor`)     │');
  lines.push('╰──────────────────────────────────────────────────────────────────────────╯');
  lines.push(`⚡ Meta-Skill Ready : ${result.skillInstalled} (evo-rule-architect)`);
  lines.push('');

  for (const s of result.stages) {
    lines.push(`Stage ${s.stage}: ${s.title}`);
    if (s.targets.length > 0) {
      lines.push(`  ├─ Targets : ${s.targets.join(', ')}`);
    }
    for (const act of s.actions) {
      lines.push(`  └─ Plan    : ${act}`);
    }
    lines.push('');
  }

  if (result.appliedChanges.length > 0) {
    lines.push('✅ Applied Automated Refactoring:');
    for (const change of result.appliedChanges) {
      lines.push(`  • ${change}`);
    }
  } else {
    lines.push(
      '💡 Tip: Pass `evo refactor --apply` to automatically extract local domain-coupled rules into `.evo/rules/scoped/`, or ask your agent to run `evo_inspect(id: "evo-rule-architect", tier: "L2")`.'
    );
  }

  return lines.join('\n');
}
