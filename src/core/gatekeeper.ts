import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  EvoRule,
  EvoSkill,
  EvoToolManifest,
  GatekeeperResult,
  ProposalPayload,
} from './types.js';
import {
  EvoStorage,
  estimateTokens,
  getExtensionForRuntime,
  sanitizeId,
} from './storage.js';
import { EvoTelemetry } from './telemetry.js';
import { checkScriptSyntax, executeSandboxedScript } from './sandbox.js';

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+(\/|~|\$HOME|c:\\)/i, reason: 'Destructive root/home directory deletion detected' },
  { pattern: /\b(Format-Volume|Clear-Disk|mkfs\.|dd\s+if=)/i, reason: 'Disk formatting command detected' },
  { pattern: /\b(curl|wget|Invoke-WebRequest|iwr)\b.*\|\s*(sh|bash|pwsh|powershell|iex|Invoke-Expression)/i, reason: 'Remote code pipe execution detected' },
  { pattern: /(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/, reason: 'Hardcoded plaintext API secret/token detected' },
  { pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\/i, reason: 'Hardcoded user-specific Windows absolute path detected; use relative paths or process.env.EVO_WORKSPACE' },
  { pattern: /\/Users\/[A-Za-z0-9_.-]+\/|\/home\/[A-Za-z0-9_.-]+\//, reason: 'Hardcoded user-specific Unix absolute path detected; use relative paths or process.env.EVO_WORKSPACE' },
];

export class EvoGatekeeper {
  private readonly storage: EvoStorage;
  private readonly telemetry: EvoTelemetry;

  constructor(storage: EvoStorage, telemetry: EvoTelemetry) {
    this.storage = storage;
    this.telemetry = telemetry;
  }

  public evaluateAndCommit(rawProposal: ProposalPayload): GatekeeperResult {
    const config = this.storage.getConfig();
    const cleanId = sanitizeId(rawProposal.id || '');

    // =========================================================================
    // GATE 1: SCHEMA & STATIC SECURITY AUDIT
    // =========================================================================
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
      rawProposal.content || '',
      rawProposal.l1_contract || '',
      rawProposal.l2_sop || '',
      rawProposal.script_code || '',
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
    // GATE 2: SYNTAX & SANDBOX DRY-RUN SELF-TEST (FOR MICRO-TOOLS)
    // =========================================================================
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
    const similar = this.telemetry
      .findSimilarCapabilities(
        rawProposal.title,
        rawProposal.l0_summary,
        rawProposal.kind,
        rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : cleanId
      )
      .filter((s) => s.similarity >= config.duplicateBm25Threshold);

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
    // GATE 4: TOKEN BUDGET CAP & GARBAGE COLLECTION ENFORCEMENT
    // =========================================================================
    const now = new Date().toISOString();

    if (rawProposal.kind === 'rule') {
      const content = (rawProposal.content || '').trim();
      if (!content) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Rule proposal requires non-empty content.',
        };
      }

      const isCore = Boolean(rawProposal.core ?? true);
      const newRuleTokens = estimateTokens(`- **[${cleanId}]**: ${rawProposal.l0_summary}\n${content}`);

      if (isCore) {
        const { rules: existingCoreRules } = this.storage.getCoreRulesTokenUsage();
        const supersededId = rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : null;
        const filteredRules = existingCoreRules.filter(
          (r) => r.id !== cleanId && r.id !== supersededId
        );
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
      }

      if (rawProposal.supersedes_id) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'rule',
          `Superseded by ${cleanId}`
        );
      }

      const existing = this.storage.getRule(cleanId);
      const ruleObj: EvoRule = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        scope_glob: rawProposal.scope_glob || '**/*',
        core: isCore,
        priority: rawProposal.priority ?? 50,
        content,
        tokens: newRuleTokens,
        origin: rawProposal.origin || 'evolved',
        supersedes_id: rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : undefined,
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      this.storage.saveRule(ruleObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');

      return {
        passed: true,
        message: `Rule '${cleanId}' passed all 4 Gatekeeper checks and is now active (${newRuleTokens} tokens).`,
        diagnostics: { id: cleanId, kind: 'rule', tokens: newRuleTokens, core: isCore },
      };
    }

    if (rawProposal.kind === 'skill') {
      const l1 = (rawProposal.l1_contract || '').trim();
      const l2 = (rawProposal.l2_sop || rawProposal.content || '').trim();
      if (!l1 || !l2) {
        return {
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Skill proposal requires both l1_contract (inputs/triggers) and l2_sop (step-by-step procedure).',
        };
      }

      if (rawProposal.supersedes_id) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'skill',
          `Superseded by ${cleanId}`
        );
      }

      const existing = this.storage.getSkill(cleanId);
      const skillObj: EvoSkill = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        l1_contract: l1,
        l2_sop: l2,
        tags: rawProposal.tags || [],
        origin: rawProposal.origin || 'evolved',
        supersedes_id: rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : undefined,
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      this.storage.saveSkill(skillObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');

      return {
        passed: true,
        message: `Skill '${cleanId}' passed all Gatekeeper checks and is crystallized at .evo/skills/${cleanId}/SKILL.md.`,
        diagnostics: { id: cleanId, kind: 'skill' },
      };
    }

    if (rawProposal.kind === 'tool') {
      const runtime = rawProposal.runtime || 'node';
      const scriptCode = (rawProposal.script_code || '').trim();

      if (rawProposal.supersedes_id) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'tool',
          `Superseded by ${cleanId}`
        );
      }

      const existing = this.storage.getTool(cleanId);
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
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      this.storage.saveTool(manifest, scriptCode);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');

      return {
        passed: true,
        message: `Micro-Tool '${cleanId}' (${runtime}) passed syntax & sandbox self-test and is live via evo_run('${cleanId}').`,
        diagnostics: { id: cleanId, kind: 'tool', runtime },
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
