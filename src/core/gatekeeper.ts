import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  EvoMemory,
  EvoRule,
  EvoSkill,
  EvoToolManifest,
  GatekeeperResult,
  ProposalPayload,
  SymbolFingerprint,
} from './types.js';
import {
  EvoStorage,
  estimateTokens,
  getExtensionForRuntime,
  getScopeBucketKey,
  sanitizeId,
} from './storage.js';
import { EvoTelemetry } from './telemetry.js';
import { checkScriptSyntax, executeSandboxedScript } from './sandbox.js';
import { buildFingerprintsForTargets, resolveCurrentGitCommit } from './memory.js';

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+(\/|~|\$HOME|c:\\)/i, reason: 'Destructive root/home directory deletion detected' },
  { pattern: /\b(Format-Volume|Clear-Disk|mkfs\.|dd\s+if=)/i, reason: 'Disk formatting command detected' },
  { pattern: /\b(curl|wget|Invoke-WebRequest|iwr)\b.*\|\s*(sh|bash|pwsh|powershell|iex|Invoke-Expression)/i, reason: 'Remote code pipe execution detected' },
  { pattern: /(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/, reason: 'Hardcoded plaintext API secret/token detected' },
  { pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\/i, reason: 'Hardcoded user-specific Windows absolute path detected; use relative paths or process.env.EVO_WORKSPACE' },
  { pattern: /\/Users\/[A-Za-z0-9_.-]+\/|\/home\/[A-Za-z0-9_.-]+\//, reason: 'Hardcoded user-specific Unix absolute path detected; use relative paths or process.env.EVO_WORKSPACE' },
];

function stripCaseAnchorLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  let inCaseAnchorSection = false;
  let anchorHeadingLevel = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      if (/(?:Case Anchors?|反例锚点|典型反例|反例案例|Case Examples?)/i.test(title)) {
        inCaseAnchorSection = true;
        anchorHeadingLevel = level;
        continue;
      } else if (inCaseAnchorSection && level <= anchorHeadingLevel) {
        inCaseAnchorSection = false;
      }
    }

    if (inCaseAnchorSection) {
      continue;
    }

    if (
      /^\s*(?:[-*>]+\s*)?(?:\*\*)?(?:Case Anchors?|反例锚点|典型反例|反例案例|[^:：\n]{0,8}反例锚点)(?:\*\*)?\s*[:：]/i.test(
        line
      )
    ) {
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

export function detectDomainNumbersInRule(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\b\d+(?:\.\d+)?\s*(?:k?V|mV|mA|A|k?W|k?VA|Hz|kHz|MHz|Ohm|degC|℃|%SOC)\b/g,
    /\[[-+]?\d+(?:\.\d+)?\s*[A-Za-z%]*\s*,\s*[-+]?\d+(?:\.\d+)?\s*[A-Za-z%]*[)\]]/g,
    /\b(?:w|dw|u8|u16|u32|s16|s32|i16|i32|b|f|cb|st|en)[A-Z][A-Za-z0-9_]*\s*(?:==|!=|>=|<=|>|<|=)\s*[-+]?\d+(?:\.\d+)?\b/g,
  ];
  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      found.add(match[0].trim());
    }
  }
  return Array.from(found);
}

const ALLOWED_META_IDENTIFIERS = new Set([
  'evo_search',
  'evo_inspect',
  'evo_run',
  'evo_propose',
  'evo_compact',
  'codegraph',
  'codegraph_explore',
  'codegraph_node',
  'scope_glob',
  'l0_summary',
  'l1_contract',
  'l2_sop',
  'target_symbols',
  'transfer_scenarios',
  'supersedes_id',
  'script_code',
  'self_test_args',
  'input_schema',
  'root_cause',
  'merged_proposal',
  'target_ids',
  'TypeScript',
  'JavaScript',
  'PowerShell',
  'Markdown',
  'Mermaid',
  'SQLite',
  'NodeJS',
  'GitHub',
  'GitLab',
  'Antigravity',
  'ClaudeCode',
  'OpenCode',
  'EvoKernel',
]);

export function detectCoupledIdentifiersInRule(text: string): string[] {
  const found = new Set<string>();
  const hungarianRegex =
    /\b(?:w|dw|u8|u16|u32|s16|s32|i16|i32|f|cb|st|en|g_|s_)[A-Z][A-Za-z0-9_]{2,}\b/g;
  const boolHungarianRegex = /\bb[A-Z][a-z]+[A-Z][A-Za-z0-9_]*\b/g;
  const macroRegex = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){2,}\b/g;
  const backtickCallRegex = /`([A-Za-z_][A-Za-z0-9_.]*\(\))`/g;
  const backtickIdentRegex = /`([A-Za-z_][A-Za-z0-9_.]{2,})`/g;

  for (const m of text.matchAll(hungarianRegex)) {
    found.add(m[0]);
  }
  for (const m of text.matchAll(boolHungarianRegex)) {
    found.add(m[0]);
  }
  for (const m of text.matchAll(macroRegex)) {
    const token = m[0];
    if (
      !/^(?:EVO_|ERR_|NODE_|AST_|MCP_|CLI_|L0_|L1_|L2_|SSOT_|SOP_|BM25_|FTS5_|JSON_|UTF_|SQLITE_)/.test(
        token
      )
    ) {
      found.add(token);
    }
  }
  for (const m of text.matchAll(backtickCallRegex)) {
    const callExpr = m[1];
    if (!/^(?:evo_|codegraph|import\.|process\.|fs\.|path\.|os\.)/i.test(callExpr)) {
      found.add(callExpr);
    }
  }
  for (const m of text.matchAll(backtickIdentRegex)) {
    const ident = m[1];
    if (
      ALLOWED_META_IDENTIFIERS.has(ident) ||
      /^(?:evo_|codegraph|import\.|process\.|fs\.|path\.|os\.)/i.test(ident) ||
      /\.(?:c|h|cpp|hpp|cs|ts|tsx|js|jsx|mjs|cjs|py|sh|ps1|json|md|mdc|yml|yaml|toml|sql|txt|html|css)$/i.test(
        ident
      )
    ) {
      continue;
    }
    const isCamelOrPascal = /[a-z0-9][A-Z]/.test(ident);
    const isSnakeCase = /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/.test(ident);
    const isDottedMember = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*$/.test(ident);
    if (isCamelOrPascal || isSnakeCase || isDottedMember) {
      found.add(ident);
    }
  }
  return Array.from(found);
}

function redactUserPaths(text: string): string {
  if (!text) return '';
  return text
    .replace(/[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\/gi, '<WORKSPACE>/')
    .replace(/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//g, '<WORKSPACE>/');
}

function isGlobalFallbackRoot(rootDir: string): boolean {
  const norm = path.resolve(rootDir).replace(/\\/g, '/').toLowerCase();
  if (norm.endsWith('/.evo/global')) return true;
  if (process.env.EVO_GLOBAL_DIR) {
    const envNorm = path.resolve(process.env.EVO_GLOBAL_DIR).replace(/\\/g, '/').toLowerCase();
    if (norm === envNorm) return true;
  }
  return false;
}

export interface EvaluateOptions {
  dryRun?: boolean;
  excludeIdsFromBudgetAndSim?: string[];
}

export class EvoGatekeeper {
  private readonly storage: EvoStorage;
  private readonly telemetry: EvoTelemetry;

  constructor(storage: EvoStorage, telemetry: EvoTelemetry) {
    this.storage = storage;
    this.telemetry = telemetry;
  }

  public evaluateAndCommit(
    rawProposal: ProposalPayload,
    options?: EvaluateOptions
  ): GatekeeperResult {
    const config = this.storage.getConfig();
    const cleanId = sanitizeId(rawProposal.id || '');
    const rawDict = rawProposal as unknown as Record<string, unknown>;

    // Normalize polymorphic aliases (Module 5)
    const resolvedRuleContent = String(
      rawProposal.content ??
        rawDict.body ??
        rawDict.l2_body ??
        rawDict.markdown ??
        rawProposal.l2_sop ??
        ''
    ).trim();
    const resolvedSkillL1 = String(
      rawProposal.l1_contract ?? rawDict.l1_overview ?? rawDict.contract ?? ''
    ).trim();
    const resolvedSkillL2 = String(
      rawProposal.l2_sop ?? rawDict.l2_body ?? rawDict.body ?? rawProposal.content ?? ''
    ).trim();

    // Auto-redact user paths in memory fields before security scan (Module 6.3)
    const resolvedSymptom =
      rawProposal.kind === 'memory'
        ? redactUserPaths(String(rawProposal.symptom || rawProposal.l1_contract || '').trim())
        : String(rawProposal.symptom || '').trim();
    const resolvedRootCause =
      rawProposal.kind === 'memory'
        ? redactUserPaths(String(rawProposal.root_cause || '').trim())
        : String(rawProposal.root_cause || '').trim();
    const resolvedSolution =
      rawProposal.kind === 'memory'
        ? redactUserPaths(
            String(
              rawProposal.solution || rawProposal.content || rawProposal.l2_sop || ''
            ).trim()
          )
        : String(rawProposal.solution || '').trim();

    // =========================================================================
    // GATE 1: SCHEMA & STATIC SECURITY AUDIT
    // =========================================================================
    if (rawProposal.kind === 'memory' && isGlobalFallbackRoot(this.storage.rootDir)) {
      return {
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_GLOBAL_MEMORY_FORBIDDEN',
        message:
          'Episodic memories are anchored to repo-specific Git commits and AST symbols and cannot be stored in the global fallback tree.',
      };
    }

    if (!cleanId || cleanId.length < 3) {
      return {
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: 'Proposal id must be at least 3 alphanumeric/hyphen characters.',
      };
    }

    if (!rawProposal.title || !rawProposal.l0_summary) {
      return {
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: 'Both title and l0_summary are required.',
      };
    }

    if (rawProposal.l0_summary.length > config.maxL0SummaryChars) {
      return {
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: `l0_summary exceeds maximum length of ${config.maxL0SummaryChars} chars (got ${rawProposal.l0_summary.length}). Keep L0 ultra-compact.`,
      };
    }

    const fullPayloadText = [
      rawProposal.l0_summary,
      resolvedRuleContent,
      resolvedSkillL1,
      resolvedSkillL2,
      rawProposal.script_code || '',
      resolvedSymptom,
      resolvedRootCause,
      resolvedSolution,
      ...(rawProposal.target_symbols || []),
    ].join('\n');

    for (const rule of DANGEROUS_PATTERNS) {
      if (rule.pattern.test(fullPayloadText)) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_SECURITY_VIOLATION',
          message: `Security gate blocked proposal: ${rule.reason}`,
        };
      }
    }

    // =========================================================================
    // GATE 1.5: RULE ABSTRACTION & LEXICAL DE-SYMBOLIZATION GATE (FOR RULES)
    // =========================================================================
    if (
      rawProposal.kind === 'rule' &&
      rawProposal.origin !== 'bootstrap' &&
      rawProposal.origin !== 'compacted'
    ) {
      const scopeGlob = (rawProposal.scope_glob || '**/*').trim();
      const isCoreRule = Boolean(rawProposal.core ?? false);
      const bodyForLexicalAudit = stripCaseAnchorLines(
        `${rawProposal.l0_summary}\n${resolvedRuleContent}`
      );

      // 1. Reject single-file literal scope_glob without wildcards (Issue #4 Problem 1)
      if (scopeGlob !== '**/*' && !/[*?[\]{}]/.test(scopeGlob)) {
        return {
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_SCOPE_TOO_NARROW',
          message: `Scope '${scopeGlob}' targets a single literal file without glob wildcards (*, ?, {}). Single-file bug fixes belong in Episodic Memory (kind: 'memory' with target_symbols) or must be abstracted 1-level-up to a subsystem pattern (e.g., 'Source/**/*.c' or 'src/**/*.ts').`,
        };
      }

      // 2. Reject point-bug case logs disguised as rules (Issue #4 Problem 1 & Issue #6)
      if (
        /-(?:bug|defect|hotfix|crash)$/i.test(cleanId) ||
        /\b(?:fixed in commit|root cause in commit|regression in commit)\s+[0-9a-f]{7,40}\b/i.test(
          bodyForLexicalAudit
        )
      ) {
        return {
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_POINT_BUG_CASE_LOG',
          message: `Rule proposal '${cleanId}' reads like a point-bug postmortem or commit log rather than a reusable architectural guardrail. Use kind: 'memory' (with symptom, root_cause, solution, target_symbols) to record specific bug cases at 0 core token cost, or abstract the rule 1-level-up into a general class invariant.`,
        };
      }

      // 3. Reject hardcoded domain/physical parameter thresholds in rule body (Issue #6 Layer 1)
      const domainNumbers = detectDomainNumbersInRule(bodyForLexicalAudit);
      if (domainNumbers.length >= 2) {
        return {
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_RULE_CONTAINS_DOMAIN_NUMBERS',
          message: `Lexical De-Symbolization Gate blocked rule '${cleanId}': detected hardcoded domain/physical parameter thresholds (${domainNumbers.slice(0, 4).join(', ')}). Code is the Single Source of Truth (SSOT) for concrete thresholds and magic numbers; rules must express the verification methodology or move concrete case parameters into kind: 'memory' / a single 'Case Anchor:' line.`,
          diagnostics: { matched_domain_numbers: domainNumbers },
        };
      }

      // 4. Reject rules coupled to >= 3 concrete project identifiers/macros (Issue #6 Layer 1 & Module 7.1)
      const coupledIdentifiers = detectCoupledIdentifiersInRule(bodyForLexicalAudit);
      if (coupledIdentifiers.length >= 3) {
        return {
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_RULE_COUPLED_TO_IDENTIFIERS',
          message: `Lexical De-Symbolization Gate blocked rule '${cleanId}': main body is tightly coupled to concrete project identifiers (${coupledIdentifiers.slice(0, 5).join(', ')}). Replace specific variable/macro names with architectural domain concepts in the rule body, and either use kind: 'memory' (with target_symbols) or isolate concrete symbols inside a 'Case Anchor:' line / '## 典型反例锚点' section.`,
          diagnostics: { coupled_identifiers: coupledIdentifiers },
        };
      }

      // 5. Require transfer_scenarios for new non-core/scoped rules or when explicitly provided (Issue #6 Layer 2 & Module 7.2)
      const existingRuleForTransfer = this.storage.getRule(cleanId);
      const requireTransferScenarios =
        rawProposal.transfer_scenarios !== undefined ||
        ((!isCoreRule || scopeGlob !== '**/*') &&
          !rawProposal.supersedes_id &&
          !existingRuleForTransfer);
      if (requireTransferScenarios) {
        const validScenarios = Array.isArray(rawProposal.transfer_scenarios)
          ? Array.from(
              new Set(
                rawProposal.transfer_scenarios
                  .map((s) => String(s).trim())
                  .filter((s) => s.length >= 8)
              )
            )
          : [];
        if (validScenarios.length < 2) {
          return {
            passed: false,
            gate_failed: 'ABSTRACTION_GATE',
            error_code: 'ERR_INSUFFICIENT_TRANSFER_SCENARIOS',
            message: `Transferability Gate blocked rule '${cleanId}': 'transfer_scenarios' is required for new non-core/scoped rules and must provide at least 2 distinct cross-module/cross-scenario applications (>= 8 chars each) proving the rule is not overfitted to a single bug location.`,
          };
        }
      }
    }

    // =========================================================================
    // GATE 2: SYNTAX & SANDBOX DRY-RUN (FOR TOOLS) / AST GROUNDING (FOR MEMORY)
    // =========================================================================
    let extractedMemoryFingerprints: Record<string, SymbolFingerprint> = {};

    if (rawProposal.kind === 'memory') {
      const symptom = resolvedSymptom;
      const rootCause = resolvedRootCause;
      const solution = resolvedSolution;
      const targetSymbols = Array.isArray(rawProposal.target_symbols)
        ? rawProposal.target_symbols.map((s) => String(s).trim()).filter(Boolean)
        : [];

      if (!symptom || !rootCause || !solution) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message:
            'Episodic memory proposal requires non-empty symptom, root_cause, and solution.',
        };
      }

      if (targetSymbols.length === 0) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message:
            'Episodic memory proposal requires at least one symbol or file in target_symbols (e.g., ["src/core/telemetry.ts#search"]).',
        };
      }

      const grounding = buildFingerprintsForTargets(this.storage.rootDir, targetSymbols);
      if (grounding.missingSymbols.length > 0) {
        return {
          passed: false,
          gate_failed: 'SYMBOL_GROUNDING',
          error_code: 'ERR_SYMBOL_NOT_FOUND',
          message: `AST Symbol Grounding Gate blocked memory proposal: target symbol(s) [${grounding.missingSymbols.join(', ')}] could not be resolved in workspace '${this.storage.rootDir}'. Verify real symbol/file names before crystallizing episodic memory.`,
          diagnostics: {
            resolved_symbols: grounding.resolvedSymbols,
            missing_symbols: grounding.missingSymbols,
          },
        };
      }

      extractedMemoryFingerprints = grounding.fingerprints;
    }

    if (rawProposal.kind === 'tool') {
      const runtime = rawProposal.runtime || 'node';
      const scriptCode = (rawProposal.script_code || '').trim();
      if (!scriptCode || scriptCode.length < 20) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Tool proposal must include valid script_code (>= 20 chars).',
        };
      }

      const syntaxCheck = checkScriptSyntax(runtime, scriptCode);
      if (!syntaxCheck.valid) {
        return {
          passed: false,
          gate_failed: 'SYNTAX_SANDBOX',
          error_code: 'ERR_SYNTAX_CHECK',
          message: `Static syntax check failed for runtime '${runtime}': ${syntaxCheck.error}`,
        };
      }

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-dryrun-'));
      const tmpScript = path.join(tmpDir, `run${getExtensionForRuntime(runtime)}`);
      try {
        fs.writeFileSync(tmpScript, scriptCode, 'utf8');
        const dryRun = executeSandboxedScript(
          runtime,
          tmpScript,
          rawProposal.self_test_args || {},
          {
            cwd: this.storage.rootDir,
            timeoutMs: rawProposal.timeout_ms || config.sandboxTimeoutMs,
            selfTest: true,
          }
        );

        if (dryRun.exitCode !== 0) {
          return {
            passed: false,
            gate_failed: 'SYNTAX_SANDBOX',
            error_code: 'ERR_SANDBOX_SELF_TEST',
            message: `Sandbox dry-run (--self-test) failed with exit code ${dryRun.exitCode}. Stderr: ${dryRun.stderr || dryRun.stdout}`,
            diagnostics: {
              exitCode: dryRun.exitCode,
              stdout: dryRun.stdout,
              stderr: dryRun.stderr,
              durationMs: dryRun.durationMs,
            },
          };
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    // =========================================================================
    // GATE 3: BM25 / JACCARD DUPLICATE & CONFLICT DETECTION
    // =========================================================================
    const extraSimText =
      rawProposal.kind === 'memory'
        ? `${resolvedSymptom} ${(rawProposal.target_symbols || []).join(' ')}`
        : '';

    const excludeSet = new Set<string>([cleanId]);
    if (rawProposal.supersedes_id) {
      excludeSet.add(sanitizeId(rawProposal.supersedes_id));
    }
    if (options?.excludeIdsFromBudgetAndSim) {
      for (const eid of options.excludeIdsFromBudgetAndSim) {
        excludeSet.add(sanitizeId(eid));
      }
    }

    const similar = this.telemetry
      .findSimilarCapabilities(
        rawProposal.title,
        rawProposal.l0_summary,
        rawProposal.kind,
        undefined,
        extraSimText
      )
      .filter((s) => !excludeSet.has(s.id) && s.similarity >= config.duplicateBm25Threshold);

    if (similar.length > 0 && !rawProposal.supersedes_id) {
      return {
        passed: false,
        gate_failed: 'DUPLICATE_CHECK',
        error_code: 'ERR_DUPLICATE_CAPABILITY',
        message: `Similar ${rawProposal.kind} already exists (${similar.map((s) => `${s.id} [${(s.similarity * 100).toFixed(0)}%]`).join(', ')}). Specify 'supersedes_id' to upgrade the existing entry or call 'evo_compact' to merge.`,
        conflicting_ids: similar.map((s) => s.id),
      };
    }

    // =========================================================================
    // GATE 4: TOKEN BUDGET CAP & SCOPED BUCKET QUOTA ENFORCEMENT
    // =========================================================================
    const now = new Date().toISOString();

    if (rawProposal.kind === 'rule') {
      const content = resolvedRuleContent;
      if (!content) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Rule proposal requires non-empty content.',
        };
      }

      const isCore = Boolean(rawProposal.core ?? false);
      const scopeGlob = (rawProposal.scope_glob || '**/*').trim();
      const newRuleTokens = estimateTokens(`- **[${cleanId}]**: ${rawProposal.l0_summary}\n${content}`);

      if (isCore) {
        const { rules: existingCoreRules } = this.storage.getCoreRulesTokenUsage();
        const filteredRules = existingCoreRules.filter((r) => !excludeSet.has(r.id));
        const currentTokens = filteredRules.reduce((acc, r) => acc + r.tokens, 0);

        if (currentTokens + newRuleTokens > config.maxCoreRuleTokens) {
          const telemetryMap = this.telemetry.getTelemetryMap();
          const lowValueCandidates = filteredRules
            .map((r) => ({
              id: r.id,
              l0_summary: r.l0_summary,
              tokens: r.tokens,
              hit_count: telemetryMap.get(r.id)?.hit_count ?? 0,
            }))
            .sort((a, b) => a.hit_count - b.hit_count || b.tokens - a.tokens)
            .slice(0, 5);

          return {
            passed: false,
            gate_failed: 'TOKEN_BUDGET',
            error_code: 'ERR_BUDGET_EXCEEDED',
            message: `Core rule token budget exceeded (${currentTokens + newRuleTokens} / ${config.maxCoreRuleTokens} tokens). Call 'evo_compact' to merge or demote low-hit rules first, or set 'core: false' for scoped loading.`,
            low_value_candidates: lowValueCandidates,
          };
        }
      } else {
        const targetBucket = getScopeBucketKey(scopeGlob);
        const existingScopedRules = this.storage
          .listRules()
          .filter((r) => !r.core && !excludeSet.has(r.id));
        const sameBucketRules = existingScopedRules.filter(
          (r) => getScopeBucketKey(r.scope_glob) === targetBucket
        );
        const maxPerBucket = config.maxScopedRulesPerBucket ?? 3;
        const maxTotalScoped = config.maxTotalScopedRules ?? 12;

        if (
          sameBucketRules.length >= maxPerBucket ||
          existingScopedRules.length >= maxTotalScoped
        ) {
          return {
            passed: false,
            gate_failed: 'TOKEN_BUDGET',
            error_code: 'ERR_SCOPED_BUCKET_FULL',
            message: `Scoped rule bucket '${targetBucket}' is full (${sameBucketRules.length}/${maxPerBucket} in bucket, ${existingScopedRules.length}/${maxTotalScoped} total scoped rules: [${sameBucketRules.map((r) => r.id).join(', ')}]). Specify 'supersedes_id' to upgrade an existing scoped rule, or call 'evo_compact' to merge overlapping rules in '${targetBucket}' into a single subsystem checklist.`,
            conflicting_ids: sameBucketRules.map((r) => r.id),
          };
        }
      }

      if (options?.dryRun) {
        return {
          passed: true,
          message: `Dry-run: Rule '${cleanId}' passed all Gatekeeper checks (${newRuleTokens} tokens).`,
          diagnostics: { id: cleanId, kind: 'rule', tokens: newRuleTokens, core: isCore },
        };
      }

      const existing = this.storage.getRule(cleanId);
      const preservedCreatedAt = existing?.created_at || now;
      if (existing) {
        this.storage.archiveCapability(cleanId, 'rule', 'Updated by same-ID proposal');
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'rule',
          `Superseded by ${cleanId}`
        );
      }

      const ruleObj: EvoRule = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        scope_glob: scopeGlob,
        core: isCore,
        priority: rawProposal.priority ?? 50,
        content,
        tokens: newRuleTokens,
        origin: rawProposal.origin || 'evolved',
        supersedes_id: rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : undefined,
        transfer_scenarios: Array.isArray(rawProposal.transfer_scenarios)
          ? rawProposal.transfer_scenarios.map((s) => String(s).trim()).filter(Boolean)
          : undefined,
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveRule(ruleObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');

      return {
        passed: true,
        message: `Rule '${cleanId}' passed all Gatekeeper checks and is now active (${newRuleTokens} tokens).`,
        diagnostics: { id: cleanId, kind: 'rule', tokens: newRuleTokens, core: isCore },
      };
    }

    if (rawProposal.kind === 'skill') {
      const l1 = resolvedSkillL1;
      const l2 = resolvedSkillL2;
      if (!l1 || !l2) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Skill proposal requires both l1_contract (inputs/triggers) and l2_sop (step-by-step procedure).',
        };
      }

      if (options?.dryRun) {
        return {
          passed: true,
          message: `Dry-run: Skill '${cleanId}' passed all Gatekeeper checks.`,
          diagnostics: { id: cleanId, kind: 'skill' },
        };
      }

      const existing = this.storage.getSkill(cleanId);
      const preservedCreatedAt = existing?.created_at || now;
      if (existing) {
        this.storage.archiveCapability(cleanId, 'skill', 'Updated by same-ID proposal');
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'skill',
          `Superseded by ${cleanId}`
        );
      }

      const skillObj: EvoSkill = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        l1_contract: l1,
        l2_sop: l2,
        tags: rawProposal.tags || [],
        origin: rawProposal.origin || 'evolved',
        supersedes_id: rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : undefined,
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveSkill(skillObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');

      return {
        passed: true,
        message: `Skill '${cleanId}' passed all Gatekeeper checks and is crystallized at .evo/skills/${cleanId}/SKILL.md.`,
        diagnostics: { id: cleanId, kind: 'skill' },
      };
    }

    if (rawProposal.kind === 'tool') {
      const runtime = rawProposal.runtime || 'node';
      const scriptCode = (rawProposal.script_code || '').trim();

      if (options?.dryRun) {
        return {
          passed: true,
          message: `Dry-run: Micro-Tool '${cleanId}' (${runtime}) passed syntax & sandbox self-test.`,
          diagnostics: { id: cleanId, kind: 'tool', runtime },
        };
      }

      const existing = this.storage.getTool(cleanId);
      const preservedCreatedAt = existing?.created_at || now;
      if (existing) {
        this.storage.archiveCapability(cleanId, 'tool', 'Updated by same-ID proposal');
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'tool',
          `Superseded by ${cleanId}`
        );
      }

      const manifest: EvoToolManifest = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        runtime,
        entry_script: `run${getExtensionForRuntime(runtime)}`,
        input_schema: rawProposal.input_schema || { type: 'object', properties: {} },
        self_test_args: rawProposal.self_test_args || {},
        timeout_ms: rawProposal.timeout_ms || config.sandboxTimeoutMs,
        origin: rawProposal.origin || 'evolved',
        supersedes_id: rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : undefined,
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveTool(manifest, scriptCode);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');

      return {
        passed: true,
        message: `Micro-Tool '${cleanId}' (${runtime}) passed syntax & sandbox self-test and is live via evo_run('${cleanId}').`,
        diagnostics: { id: cleanId, kind: 'tool', runtime },
      };
    }

    if (rawProposal.kind === 'memory') {
      const symptom = resolvedSymptom;
      const rootCause = resolvedRootCause;
      const solution = resolvedSolution;
      const targetSymbols = (rawProposal.target_symbols || []).map((s) => String(s).trim()).filter(Boolean);
      const currentCommit = resolveCurrentGitCommit(this.storage.rootDir);

      if (options?.dryRun) {
        return {
          passed: true,
          message: `Dry-run: Episodic Memory '${cleanId}' passed AST Symbol Grounding.`,
          diagnostics: {
            id: cleanId,
            kind: 'memory',
            created_commit: currentCommit,
            target_symbols: targetSymbols,
            ast_fingerprints: extractedMemoryFingerprints,
          },
        };
      }

      const existing = this.storage.getMemory(cleanId);
      const preservedCreatedAt = existing?.created_at || now;
      if (existing) {
        this.storage.archiveCapability(cleanId, 'memory', 'Updated by same-ID proposal');
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'memory',
          `Superseded by ${cleanId}`
        );
      }

      const memoryObj: EvoMemory = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        symptom,
        root_cause: rootCause,
        solution,
        target_symbols: targetSymbols,
        ast_fingerprints: extractedMemoryFingerprints,
        created_commit: currentCommit,
        tags: rawProposal.tags || [],
        origin: rawProposal.origin || 'evolved',
        supersedes_id: rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : undefined,
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveMemory(memoryObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');

      return {
        passed: true,
        message: `Episodic Memory '${cleanId}' passed AST Symbol Grounding (${targetSymbols.length} symbol(s) fingerprinted @ commit ${currentCommit}) and is crystallized at .evo/memories/${cleanId}.md (0 core budget tokens used).`,
        diagnostics: {
          id: cleanId,
          kind: 'memory',
          created_commit: currentCommit,
          target_symbols: targetSymbols,
          ast_fingerprints: extractedMemoryFingerprints,
        },
      };
    }

    return {
      passed: false,
      gate_failed: 'SCHEMA_SECURITY',
      error_code: 'ERR_INVALID_SCHEMA',
      message: `Unsupported proposal kind: ${String(rawProposal.kind)}`,
    };
  }
}
