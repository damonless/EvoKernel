import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvoStorage, estimateTokens, sanitizeId } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper, auditRuleGate1_5 } from '../core/gatekeeper.js';
import type { Gate1_5Violation } from '../core/gatekeeper.js';
import { runInit } from './init.js';
import type { EvoRule, EvoSkill, ProposalPayload } from '../core/types.js';

export interface AuditOptions {
  includeGlobal?: boolean;
  globalHomeDir?: string;
  tokenBudgetLimit?: number;
  overlapThreshold?: number;
}

export interface AuditedFileMetric {
  scope: 'workspace' | 'global';
  kind: 'rule' | 'skill';
  displayPath: string;
  fullPath: string;
  bytes: number;
  tokens: number;
  overBudget: boolean;
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

export interface AuditReport {
  workspaceRoot: string;
  includeGlobal: boolean;
  tokenBudgetLimit: number;
  files: AuditedFileMetric[];
  budgetViolations: AuditedFileMetric[];
  domainLeaks: DomainLeakWarning[];
  redundancyOverlaps: RedundancyOverlap[];
  gateViolations: GateViolationWarning[];
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
  title: 'Legacy Rule & Skill Decoupling Architect (4-Stage Refactoring SOP)',
  l0_summary: 'Audits bloated CLAUDE.md/GEMINI.md/AGENTS.md and coupled skills, decoupling them into L0 seeds and L1/L2 scoped assets.',
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
  globalHomeDir: string
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
    '.cursorrules',
    '.windsurfrules',
    '.clinerules',
    '.roorules',
  ]) {
    addFile('workspace', 'rule', path.join(workspaceRoot, rootRule), workspaceRoot);
  }
  for (const ruleDir of [
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
    path.join(workspaceRoot, '.claude', 'skills'),
    path.join(workspaceRoot, '.cursor', 'skills'),
    path.join(workspaceRoot, '.windsurf', 'skills'),
    path.join(workspaceRoot, '.roo', 'skills'),
    path.join(workspaceRoot, '.evo', 'skills'),
  ]) {
    for (const f of collectMarkdownFiles(skillDir, 2)) {
      addFile('workspace', 'skill', f, workspaceRoot);
    }
  }

  // 3. Global rule & skill files
  if (includeGlobal && fs.existsSync(globalHomeDir)) {
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

export function runAudit(workspaceRoot: string, options: AuditOptions = {}): AuditReport {
  const root = path.resolve(workspaceRoot);
  const includeGlobal = Boolean(options.includeGlobal);
  const globalHomeDir = path.resolve(options.globalHomeDir || os.homedir());
  const localStorage = new EvoStorage(root);
  const tokenBudgetLimit =
    options.tokenBudgetLimit ?? (localStorage.getConfig().maxCoreRuleTokens || 1500);
  const overlapThreshold = options.overlapThreshold ?? 0.25;

  const entries = discoverAuditableFiles(root, includeGlobal, globalHomeDir);
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
    const tokens = estimateTokens(raw);
    const overBudget = tokens > tokenBudgetLimit;
    const metric: AuditedFileMetric = {
      scope: entry.scope,
      kind: entry.kind,
      displayPath: entry.displayPath,
      fullPath: entry.fullPath,
      bytes: Buffer.byteLength(raw, 'utf8'),
      tokens,
      overBudget,
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
          scope: 'workspace',
          ruleId: rule.id,
          displayPath: rel,
          violations,
        });
      }
    }
  }

  if (includeGlobal) {
    const globalRoot = process.env.EVO_GLOBAL_DIR
      ? path.resolve(process.env.EVO_GLOBAL_DIR)
      : path.join(globalHomeDir, '.evo', 'global');
    const globalStorage = new EvoStorage(globalRoot);
    if (fs.existsSync(globalStorage.rulesDir)) {
      const globalRules = globalStorage.listRules();
      for (const rule of globalRules) {
        const violations = auditRuleGate1_5(rule);
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

  const healthy =
    budgetViolations.length === 0 &&
    domainLeaks.length === 0 &&
    redundancyOverlaps.length === 0 &&
    gateViolations.length === 0;

  return {
    workspaceRoot: root,
    includeGlobal,
    tokenBudgetLimit,
    files,
    budgetViolations,
    domainLeaks,
    redundancyOverlaps,
    gateViolations,
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
  lines.push(`🛡️  Budget Cap: ${report.tokenBudgetLimit} tokens per always-on rule file`);
  lines.push('');

  lines.push(`├── 📄 Scanned Rule & Skill Assets (${report.files.length} files)`);
  if (report.files.length === 0) {
    lines.push('│   └── (no rule or skill files found)');
  } else {
    for (const f of report.files) {
      const badge = f.overBudget ? '⚠️ OVER_BUDGET' : '✅ HEALTHY';
      lines.push(
        `│   ├── [${f.scope.toUpperCase()}:${f.kind.toUpperCase()}] ${f.displayPath} — ${f.tokens} tokens (${badge})`
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

  lines.push(`└── 🔄 Rule/Skill Redundancy Overlaps (${report.redundancyOverlaps.length} detected)`);
  if (report.redundancyOverlaps.length === 0) {
    lines.push('    └── None — Low Jaccard overlap across rules and skills.');
  } else {
    for (const ov of report.redundancyOverlaps) {
      lines.push(
        `    ├── [OVERLAP ${(ov.similarity * 100).toFixed(0)}%] ${ov.fileA} <-> ${ov.fileB} (shared: ${ov.sharedTerms.join(', ')})`
      );
      lines.push(`    │      └─ Action: ${ov.recommendation}`);
    }
  }

  lines.push('');
  if (report.healthy) {
    lines.push('✨ Audit Status: HEALTHY (Zero budget bloat, zero domain leaks, zero redundant coupling, zero Gate 1.5 violations).');
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
  ];

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
      targets: uniqueLocalTargets,
      actions:
        stage3Actions.length > 0
          ? Array.from(new Set(stage3Actions))
          : ['Local rules are within the 1,500-token budget and properly scoped.'],
    },
    {
      stage: 4,
      title: '局部技能 STE-Lite 化 (Local Skill STE-Lite Conversion)',
      targets: audit.redundancyOverlaps.map((o) => `${o.fileA} <-> ${o.fileB}`),
      actions:
        audit.redundancyOverlaps.length > 0
          ? audit.redundancyOverlaps.map((o) => o.recommendation)
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
