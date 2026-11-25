import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  EvoKind,
  EvoMemory,
  EvoPreference,
  EvoRule,
  EvoSkill,
  EvoToolManifest,
  GatekeeperResult,
  PreferenceCategory,
  ProposalPayload,
  SymbolFingerprint,
} from '../types.js';
import {
  EvoStorage,
  PREFERENCE_CATEGORIES,
  estimateTokens,
  formatUserProfileDigestForPreferences,
  getExtensionForRuntime,
  getScopeBucketKey,
  parseSkillSectionsFromMarkdown,
  sanitizeId,
} from '../storage.js';
import { EvoTelemetry } from '../telemetry.js';
import {
  checkScriptSyntax,
  checkScriptSyntaxAsync,
  executeSandboxedScript,
  executeSandboxedScriptAsync,
} from '../sandbox.js';
import {
  buildFingerprintsForTargets,
  extractSymbolFingerprintAsync,
  readGitHeadSnapshotAsync,
  resolveCurrentGitBranch,
  resolveCurrentGitCommit,
} from '../memory.js';
import { spawnGitAsync } from '../memory/git-utils.js';
import {
  DESTRUCTIVE_SHELL_PATTERNS,
  PROGRAMMATIC_DESTRUCTIVE_PATTERNS,
  REMOTE_EXEC_AND_EXFIL_PATTERNS,
  SCRIPT_EXECUTION_PATTERNS,
  TOOL_NETWORK_PATTERNS,
  UNIVERSAL_SECURITY_PATTERNS,
  findUnnegatedDestructiveShellPattern,
  isValidContrastiveEvidence,
  scanDangerousPatterns as scanDangerousTextPatterns,
  stripScriptComments,
} from './security-patterns.js';
import { renderUserProfileBlock } from '../../templates/meta-rule.js';
import { hasUnsafeHookRegex } from './redos-guard.js';
import {
  compareRuleClauses,
  detectCoupledIdentifiersInRule,
  detectDomainNumbersInRule,
  extractActionableClauses,
  isGlobalFallbackRoot,
  scrubLocalUserPaths,
  stripCaseAnchorLines,
  validateCapabilityReferences,
} from './abstraction-gates.js';
import type { WorkspaceRollbackSnapshot } from './workspace-snapshot.js';
import {
  captureWorkspaceMutationSignature,
  captureWorkspaceMutationSignatureAsync,
  prepareEphemeralSelfTestWorkspace,
  prepareEphemeralSelfTestWorkspaceAsync,
  restoreWorkspaceFromSnapshot,
  restoreWorkspaceFromSnapshotAsync,
} from './workspace-snapshot.js';

export interface EvaluateOptions {
  dryRun?: boolean;
  excludeIdsFromBudgetAndSim?: string[];
  preservedCreatedAt?: string;
  inheritedTransferScenarios?: string[];
  supersededRules?: EvoRule[];
  extraKnownIds?: Iterable<string>;
  bypassConfoundedCheck?: boolean;
  preserveAnchorOnMetadataEdit?: boolean;
}

export type GatekeeperEvaluateOptions = EvaluateOptions;

interface PreparedProposalContext {
  config: ReturnType<EvoStorage['getConfig']>;
  cleanSupersedesId: string;
  cleanId: string;
  rawProposal: ProposalPayload;
  resolvedRuleContent: string;
  resolvedSkillL1: string;
  resolvedSkillL2: string;
  resolvedPrefContent: string;
  resolvedPrefCategory?: PreferenceCategory;
  resolvedPrefAlwaysOn?: boolean;
  resolvedTitle: string;
  resolvedL0Summary: string;
  resolvedSymptom: string;
  resolvedRootCause: string;
  resolvedSolution: string;
  normalizedTargetSymbols: string[];
  toolRuntime?: NonNullable<ProposalPayload['runtime']>;
  toolSelfTestArgs?: Record<string, unknown>;
  toolTimeoutMs?: number;
  toolScriptCode?: string;
  memoryBaseMem?: EvoMemory;
  memoryExisting?: EvoMemory;
  memoryHasEmptyBaseFingerprints?: boolean;
  memoryPreserveHistoricalAnchor?: boolean;
  memoryLiveHeadCommit?: string;
  memoryLiveHeadBranch?: string;
  isPersonalMemory?: boolean;
  extractedMemoryFingerprints: Record<string, SymbolFingerprint>;
}

interface ToolDryRunStaging {
  tmpDir: string;
  tmpScript: string;
  stageTmpDir: string;
  staged: boolean;
  stageDir?: string;
  preSnapshot: WorkspaceRollbackSnapshot;
  realPreSnapshot?: WorkspaceRollbackSnapshot;
  runCwd: string;
}

const EVO_BLOCK_MARKER_REGEX = /<!--\s*EVO:(?:PROFILE:)?(?:START|END)\s*-->/i;

function hasEvoBlockMarkerInValue(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    return EVO_BLOCK_MARKER_REGEX.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasEvoBlockMarkerInValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) =>
      hasEvoBlockMarkerInValue(v, depth + 1)
    );
  }
  return false;
}

const PREFERENCE_POLARITY_AXES: Array<{
  topic: string;
  sideA: RegExp;
  sideB: RegExp;
  sideAIsNegation?: boolean;
}> = [
  {
    topic: 'tables',
    sideAIsNegation: true,
    sideA:
      /(?:禁用|不要|不用|别用|禁止|避免|切勿|勿用)[^。\n.,;!?，；！？]{0,16}表格|\bno\s+(?:markdown\s+)?tables?\b|\bavoid\s+(?:markdown\s+)?tables?\b|\bnever\s+use\s+(?:markdown\s+)?tables?\b|\bdo\s+not\s+use\s+(?:markdown\s+)?tables?\b|\bdon't\s+use\s+(?:markdown\s+)?tables?\b|\b(?:instead\s+of|rather\s+than)\s+(?:markdown\s+)?tables?\b/i,
    sideB:
      /(?:使?用|输出|采用|改用)\s*(?:markdown\s*)?表格|表格形式|表格展示|\bprefer\s+(?:markdown\s+)?tables?\b|\buse\s+(?:markdown\s+)?tables?\b|\bmarkdown\s+tables?\b|\btabular\s+format\b/i,
  },
  {
    topic: 'verbosity',
    sideA:
      /简洁|简短|3\s*[-–~]\s*5\s*条|大白话|言简意赅|精简|点到为止|\bconcise\b|\bbrief(?:ly)?\b|\bshort\s+(?:answers?|replies?|bullet)|\bkeep\s+it\s+short\b|\bterse\b/i,
    sideB:
      /详尽|长篇|详细展开|越详细越好|深入展开|展开说明|\bdetailed\b|\bcomprehensive\b|\bverbose\b|\bthorough\s+explanation\b|\bin[- ]depth\b/i,
  },
  {
    topic: 'ordering',
    sideA:
      /结论先行|先说结论|先给结论|直奔主题|\bbottom[- ]line\s+first\b|\bconclusion\s+first\b|\btl;?dr\s+first\b|\blead\s+with\s+(?:the\s+)?conclusion\b/i,
    sideB:
      /先讲背景|先说背景|先解释背景|先铺垫|\bbackground\s+first\b|\bcontext\s+first\b|\bexplain\s+background\s+before\b/i,
  },
  {
    topic: 'language',
    sideA:
      /(?:只用|只使用|全部用|全部使用|仅用|仅使用|一律用|一律使用|请用|默认用|统一用|优先用)中文|中文回复|中文回答|\bchinese\s+only\b|\breply\s+in\s+chinese\b|\brespond\s+in\s+chinese\b|\balways\s+(?:use\s+)?chinese\b/i,
    sideB:
      /(?:只用|只使用|全部用|全部使用|仅用|仅使用|一律用|一律使用|请用|默认用|统一用|优先用)英文|英文回复|英文回答|\benglish\s+only\b|\breply\s+in\s+english\b|\brespond\s+in\s+english\b|\balways\s+(?:use\s+)?english\b/i,
  },
];

function classifyPolaritySides(text: string): Map<string, 'A' | 'B'> {
  const result = new Map<string, 'A' | 'B'>();
  const affirmativeText = text.replace(
    /(?:instead\s+of\s+|rather\s+than\s+|avoid\s+|never\s+(?:use\s+)?|do\s+not\s+(?:use\s+)?|don't\s+(?:use\s+)?|\bno\s+|不要|禁用|禁止|不用|别用|避免|切勿|勿用)[^.,;!\n。；！，]*/gi,
    ' '
  );
  for (const axis of PREFERENCE_POLARITY_AXES) {
    const hasA = axis.sideA.test(axis.sideAIsNegation ? text : affirmativeText);
    const hasB = !hasA && axis.sideB.test(affirmativeText);
    if (hasA) result.set(axis.topic, 'A');
    else if (hasB) result.set(axis.topic, 'B');
  }
  return result;
}

export function detectPreferenceConflict(
  candidate: {
    id?: string;
    title?: string;
    l0_summary?: string;
    content?: string;
    always_on?: boolean;
  },
  existingPrefs: EvoPreference[]
): Array<{ id: string; topic: string; title: string; always_on_mismatch?: boolean }> {
  const candText = [candidate.title || '', candidate.l0_summary || '', candidate.content || ''].join('\n');
  const candSides = classifyPolaritySides(candText);
  if (candSides.size === 0) return [];
  const conflicts: Array<{ id: string; topic: string; title: string; always_on_mismatch?: boolean }> = [];
  for (const pref of existingPrefs) {
    if (pref.enabled === false) continue;
    const prefText = [pref.title || '', pref.l0_summary || '', pref.content || ''].join('\n');
    const prefSides = classifyPolaritySides(prefText);
    for (const [topic, side] of candSides.entries()) {
      const existingSide = prefSides.get(topic);
      if (existingSide && existingSide !== side) {
        const alwaysOnMismatch =
          candidate.always_on !== undefined && candidate.always_on !== (pref.always_on !== false);
        conflicts.push({
          id: pref.id,
          topic,
          title: pref.title || pref.id,
          ...(alwaysOnMismatch ? { always_on_mismatch: true } : {}),
        });
        break;
      }
    }
  }
  return conflicts;
}

export class EvoGatekeeper {
  private readonly storage: EvoStorage;
  private readonly telemetry: EvoTelemetry;

  constructor(storage: EvoStorage, telemetry: EvoTelemetry) {
    this.storage = storage;
    this.telemetry = telemetry;
  }

  public scanDangerousPatterns(text: string): string | null {
    return scanDangerousTextPatterns(text);
  }

  private recordGatekeeperTelemetry(
    rawProposal: ProposalPayload,
    res: GatekeeperResult,
    options?: EvaluateOptions
  ): void {
    if (!options?.dryRun) {
      try {
        this.telemetry.recordGatekeeperEvent(
          {
            kind: rawProposal.kind,
            targetId: (res as any).id || sanitizeId(rawProposal.id || ''),
            targetName: rawProposal.title || rawProposal.id,
            passed: res.passed,
            stageFailed: res.passed ? undefined : (res.gate_failed || res.error_code || 'GATEKEEPER'),
            diagnostics: res.message || JSON.stringify(res),
          },
          this.storage.rootDir
        );
      } catch {}
    }
  }

  public evaluateAndCommit(
    rawProposal: ProposalPayload,
    options?: EvaluateOptions
  ): GatekeeperResult {
    const res = this.evaluateAndCommitInternal(rawProposal, options);
    this.recordGatekeeperTelemetry(rawProposal, res, options);
    return res;
  }

  public async evaluateAndCommitAsync(
    rawProposal: ProposalPayload,
    options?: EvaluateOptions
  ): Promise<GatekeeperResult> {
    const res = await this.evaluateAndCommitInternalAsync(rawProposal, options);
    this.recordGatekeeperTelemetry(rawProposal, res, options);
    return res;
  }

  private evaluateAndCommitInternal(
    rawProposal: ProposalPayload,
    options?: EvaluateOptions
  ): GatekeeperResult {
    const prep = this.prepareProposalValidation(rawProposal, options);
    if (!prep.ok) return prep.result;
    const ctx = prep.context;

    if (ctx.rawProposal.kind === 'memory') {
      const memErr = this.runMemoryGroundingGate2(ctx);
      if (memErr) return memErr;
    } else if (ctx.rawProposal.kind === 'tool') {
      const toolErr = this.runToolSandboxGate2Sync(ctx);
      if (toolErr) return toolErr;
    }

    return this.finalizeAndCommitProposal(ctx, options);
  }

  private async evaluateAndCommitInternalAsync(
    rawProposal: ProposalPayload,
    options?: EvaluateOptions
  ): Promise<GatekeeperResult> {
    const prep = this.prepareProposalValidation(rawProposal, options, true);
    if (!prep.ok) return prep.result;
    const ctx = prep.context;

    if (ctx.rawProposal.kind === 'memory') {
      const memErr = await this.runMemoryGroundingGate2Async(ctx);
      if (memErr) return memErr;
    } else if (ctx.rawProposal.kind === 'tool') {
      const toolErr = await this.runToolSandboxGate2Async(ctx);
      if (toolErr) return toolErr;
    }

    return await this.finalizeAndCommitProposalAsync(ctx, options);
  }

  private findExistingCapability(kind: ProposalPayload['kind'], targetId: string) {
    if (!targetId) return null;
    if (kind === 'rule') return this.storage.getRule(targetId);
    if (kind === 'skill') return this.storage.getSkill(targetId);
    if (kind === 'tool') return this.storage.getTool(targetId);
    if (kind === 'memory') return this.storage.getMemory(targetId);
    if (kind === 'preference') return this.storage.getPreference(targetId);
    return null;
  }

  private findOtherKindForId(
    kind: ProposalPayload['kind'],
    targetId: string
  ): EvoKind | null {
    if (!targetId) return null;
    if (kind !== 'rule' && this.storage.getRule(targetId)) return 'rule';
    if (kind !== 'skill' && this.storage.getSkill(targetId)) return 'skill';
    if (kind !== 'tool' && this.storage.getTool(targetId)) return 'tool';
    if (kind !== 'memory' && this.storage.getMemory(targetId)) return 'memory';
    if (kind !== 'preference' && this.storage.getPreference(targetId)) return 'preference';
    return null;
  }

  private normalizeWorkspaceTargetPath(spec: string): string {
    const trimmedSpec = spec.trim();
    if (!trimmedSpec) return trimmedSpec;
    let filePart = trimmedSpec;
    let suffixPart = '';
    const hashIdx = trimmedSpec.indexOf('#');
    if (hashIdx !== -1) {
      filePart = trimmedSpec.slice(0, hashIdx).trim();
      suffixPart = trimmedSpec.slice(hashIdx);
    } else {
      for (let i = trimmedSpec.length - 1; i > 1; i--) {
        if (trimmedSpec[i] === ':' && trimmedSpec[i - 1] !== ':' && trimmedSpec[i + 1] !== ':') {
          const candSuffix = trimmedSpec.slice(i + 1).trim();
          if (candSuffix && !/^\d+$/.test(candSuffix)) {
            filePart = trimmedSpec.slice(0, i).trim();
            suffixPart = trimmedSpec.slice(i);
          }
          break;
        }
      }
    }
    const normalizedSlashes = filePart.replace(/\\/g, '/');
    if (path.isAbsolute(normalizedSlashes) || /^[A-Za-z]:\//.test(normalizedSlashes)) {
      const wsRootResolved = path.resolve(this.storage.rootDir);
      const fileResolved = path.resolve(filePart);
      const rel = path.relative(wsRootResolved, fileResolved);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return `${rel.replace(/\\/g, '/').replace(/^\.\/+/, '')}${suffixPart}`;
      }
    }
    return trimmedSpec;
  }

  private normalizeTargetSymbol(s: unknown): string {
    if (typeof s === 'string') return this.normalizeWorkspaceTargetPath(s);
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      const obj = s as Record<string, unknown>;
      const filePart = String(obj.file_path ?? obj.file ?? obj.path ?? '').trim();
      const symPart = String(obj.symbol_name ?? obj.symbol ?? obj.name ?? '').trim();
      if (filePart && symPart) return this.normalizeWorkspaceTargetPath(`${filePart}#${symPart}`);
      return this.normalizeWorkspaceTargetPath(symPart || filePart);
    }
    return this.normalizeWorkspaceTargetPath(String(s ?? ''));
  }

  private prepareProposalValidation(
    rawProposal: ProposalPayload,
    options?: EvaluateOptions,
    isAsync = false
  ): { ok: true; context: PreparedProposalContext } | { ok: false; result: GatekeeperResult } {
    const config = this.storage.getConfig();
    const cleanSupersedesId = rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : '';
    const cleanId = sanitizeId(rawProposal.id || '') || cleanSupersedesId;
    const rawDict = rawProposal as unknown as Record<string, unknown>;

    const existingCapForDefaults =
      this.findExistingCapability(rawProposal.kind, cleanId) ||
      this.findExistingCapability(rawProposal.kind, cleanSupersedesId);

    const rawTitleInput = String(rawProposal.title ?? rawProposal.name ?? '').trim();
    const rawL0Input = String(rawProposal.l0_summary ?? '').trim();
    const inheritedTitle = String(existingCapForDefaults?.title ?? '').trim();
    const inheritedL0 = String(existingCapForDefaults?.l0_summary ?? '').trim();
    const effectiveL0Summary = rawL0Input || inheritedL0;
    const effectiveTitle = rawTitleInput || inheritedTitle || effectiveL0Summary;
    const inheritedScopeGlob = String(
      (existingCapForDefaults as { scope_glob?: string } | null)?.scope_glob ?? ''
    ).trim();
    const effectiveScopeGlob =
      String(rawProposal.scope_glob ?? '').trim() || inheritedScopeGlob || rawProposal.scope_glob;

    const existingMemoryForDefaults =
      rawProposal.kind === 'memory'
        ? this.storage.getMemory(cleanId) ||
          (cleanSupersedesId ? this.storage.getMemory(cleanSupersedesId) : null)
        : null;

    const isGlobalRoot = isGlobalFallbackRoot(this.storage.rootDir);
    const rawTargetSymbolsSource =
      rawProposal.target_symbols !== undefined
        ? rawProposal.target_symbols
        : existingMemoryForDefaults?.target_symbols;
    const rawNormalizedTargetSymbols = Array.isArray(rawTargetSymbolsSource)
      ? rawTargetSymbolsSource.map((s) => this.normalizeTargetSymbol(s)).filter(Boolean)
      : [];
    const isPersonalMemory =
      rawProposal.kind === 'memory' &&
      (rawProposal.memory_type === 'personal' ||
        existingMemoryForDefaults?.memory_type === 'personal' ||
        (isGlobalRoot && rawNormalizedTargetSymbols.length === 0));
    const normalizedTargetSymbols = isPersonalMemory ? [] : rawNormalizedTargetSymbols;

    rawProposal = {
      ...rawProposal,
      title: effectiveTitle,
      l0_summary: effectiveL0Summary,
      ...(effectiveScopeGlob ? { scope_glob: effectiveScopeGlob } : {}),
      ...(normalizedTargetSymbols.length > 0 || Array.isArray(rawProposal.target_symbols)
        ? { target_symbols: normalizedTargetSymbols }
        : {}),
    };

    // Normalize polymorphic aliases (Module 5)
    const existingRuleForDefaults =
      rawProposal.kind === 'rule'
        ? this.storage.getRule(cleanId) ||
          (cleanSupersedesId ? this.storage.getRule(cleanSupersedesId) : null)
        : null;
    const resolvedRuleContent = String(
      rawProposal.content ??
        rawDict.body ??
        rawDict.l2_body ??
        rawDict.markdown ??
        rawProposal.l2_sop ??
        existingRuleForDefaults?.content ??
        ''
    ).trim();

    const existingSkillForDefaults =
      rawProposal.kind === 'skill'
        ? this.storage.getSkill(cleanId) ||
          (cleanSupersedesId ? this.storage.getSkill(cleanSupersedesId) : null)
        : null;
    const rawSkillBodySource = String(
      rawProposal.content ?? rawDict.body ?? rawDict.markdown ?? rawProposal.l2_sop ?? ''
    ).trim();
    const parsedSkillSections = parseSkillSectionsFromMarkdown(rawSkillBodySource);
    const parsedSkillL1 = parsedSkillSections.l1;
    const parsedSkillL2 = parsedSkillSections.l2;
    const explicitSkillL1 = String(
      rawProposal.l1_contract ?? rawDict.l1_overview ?? rawDict.contract ?? ''
    )
      .replace(/^#{1,3}\s*L1(?:\s+Contract|\s+Overview)?\b[^\r\n]*\r?\n?/i, '')
      .trim();
    const explicitSkillL2 = String(rawProposal.l2_sop ?? rawDict.l2_body ?? '')
      .replace(/^#{1,3}\s*L2(?:\s+SOP|\s+Procedure|\s+Body)?\b[^\r\n]*\r?\n?/i, '')
      .trim();
    const unstructuredSkillBodyAsL2 =
      !parsedSkillSections.hasL1Header && !parsedSkillSections.hasL2Header
        ? String(rawDict.body ?? rawDict.markdown ?? rawProposal.content ?? '')
            .trim()
            .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
            .trim()
        : '';
    const resolvedSkillL1 =
      explicitSkillL1 ||
      parsedSkillL1 ||
      (rawProposal.kind === 'skill' ? String(existingSkillForDefaults?.l1_contract ?? '').trim() : '');
    const explicitL2Sections = parseSkillSectionsFromMarkdown(
      String(rawProposal.l2_sop ?? rawDict.l2_body ?? '')
    );
    const explicitL2HasL1Header = explicitL2Sections.hasL1Header;
    const resolvedSkillL2 =
      (!explicitL2HasL1Header && explicitSkillL2) ||
      parsedSkillL2 ||
      explicitSkillL2 ||
      unstructuredSkillBodyAsL2 ||
      (rawProposal.kind === 'skill' ? String(existingSkillForDefaults?.l2_sop ?? '').trim() : '');

    const existingPrefForDefaults =
      rawProposal.kind === 'preference'
        ? this.storage.getPreference(cleanId) ||
          (cleanSupersedesId ? this.storage.getPreference(cleanSupersedesId) : null)
        : null;
    const resolvedPrefContent =
      rawProposal.kind === 'preference'
        ? String(
            rawProposal.content ??
              rawDict.body ??
              rawDict.l2_body ??
              rawDict.markdown ??
              existingPrefForDefaults?.content ??
              ''
          ).trim()
        : '';

    // Auto-scrub user paths in memory fields before security scan (Module 6.3)
    const rawSymptomSource = String(
      rawProposal.symptom || rawProposal.l1_contract || existingMemoryForDefaults?.symptom || ''
    ).trim();
    const rawRootCauseSource = String(
      rawProposal.root_cause || existingMemoryForDefaults?.root_cause || ''
    ).trim();
    const rawSolutionSource = String(
      rawProposal.solution ||
        rawProposal.content ||
        rawProposal.l2_sop ||
        existingMemoryForDefaults?.solution ||
        ''
    ).trim();
    const resolvedTitle =
      rawProposal.kind === 'memory'
        ? scrubLocalUserPaths(String(rawProposal.title || '').trim())
        : String(rawProposal.title || '').trim();
    const resolvedL0Summary =
      rawProposal.kind === 'memory'
        ? scrubLocalUserPaths(String(rawProposal.l0_summary || '').trim())
        : String(rawProposal.l0_summary || '').trim();
    const resolvedSymptom =
      rawProposal.kind === 'memory'
        ? scrubLocalUserPaths(rawSymptomSource)
        : String(rawProposal.symptom || '').trim();
    const resolvedRootCause =
      rawProposal.kind === 'memory'
        ? scrubLocalUserPaths(rawRootCauseSource)
        : String(rawProposal.root_cause || '').trim();
    const resolvedSolution =
      rawProposal.kind === 'memory'
        ? scrubLocalUserPaths(rawSolutionSource)
        : String(rawProposal.solution || '').trim();

    const fail = (result: GatekeeperResult): { ok: false; result: GatekeeperResult } => ({
      ok: false,
      result,
    });

    // =========================================================================
    // GATE 1: SCHEMA & STATIC SECURITY AUDIT
    // =========================================================================
    if (rawProposal.kind === 'memory' && isGlobalRoot && !isPersonalMemory) {
      return fail({
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_GLOBAL_MEMORY_FORBIDDEN',
        message:
          'Code-anchored episodic memories require repo-specific Git commits and AST symbols and cannot be stored in the global fallback tree. Use memory_type: "personal" (with no target_symbols) for global personal experience.',
      });
    }

    if (
      isGlobalRoot &&
      /^(?:\d+[a-z0-9]*|proj-[a-z0-9]+|project-[a-z0-9]+)-/i.test(cleanId)
    ) {
      return fail({
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: `Project-prefixed capability ID "${cleanId}" cannot be stored in the global fallback tree (~/.evo/global). Use a cross-project domain-neutral ID or propose into the active project workspace.`,
      });
    }

    if (!cleanId || cleanId.length < 3) {
      return fail({
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: 'Proposal id must be at least 3 alphanumeric/hyphen characters.',
      });
    }

    const collidingKind = this.findOtherKindForId(rawProposal.kind, cleanId);
    if (collidingKind) {
      return fail({
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: `Capability ID '${cleanId}' already belongs to kind '${collidingKind}' and cannot be overwritten as '${rawProposal.kind}'.`,
      });
    }

    if (!resolvedTitle || !rawProposal.l0_summary) {
      return fail({
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: 'Both title and l0_summary are required.',
      });
    }

    if (rawProposal.l0_summary.length > config.maxL0SummaryChars) {
      return fail({
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_INVALID_SCHEMA',
        message: `l0_summary exceeds maximum length of ${config.maxL0SummaryChars} chars (got ${rawProposal.l0_summary.length}). Keep L0 ultra-compact.`,
      });
    }

    const triggerCueText =
      typeof rawProposal.trigger_cue === 'string'
        ? rawProposal.trigger_cue
        : rawProposal.trigger_cue !== undefined && rawProposal.trigger_cue !== null
          ? String(rawProposal.trigger_cue)
          : '';

    const fullPayloadText = [
      resolvedTitle,
      resolvedL0Summary,
      resolvedRuleContent,
      resolvedSkillL1,
      resolvedSkillL2,
      resolvedPrefContent,
      triggerCueText,
      rawProposal.script_code || '',
      resolvedSymptom,
      resolvedRootCause,
      resolvedSolution,
      ...normalizedTargetSymbols,
    ].join('\n');

    if (hasEvoBlockMarkerInValue(rawProposal) || EVO_BLOCK_MARKER_REGEX.test(fullPayloadText)) {
      return fail({
        passed: false,
        gate_failed: 'SCHEMA_SECURITY',
        error_code: 'ERR_SECURITY_VIOLATION',
        message:
          'Security gate blocked proposal: EvoKernel managed block markers (<!-- EVO:START/END --> or <!-- EVO:PROFILE:START/END -->) are forbidden in proposal fields.',
      });
    }

    for (const rule of UNIVERSAL_SECURITY_PATTERNS) {
      if (rule.pattern.test(fullPayloadText)) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_SECURITY_VIOLATION',
          message: `Security gate blocked proposal: ${rule.reason}`,
        });
      }
    }

    for (const rule of REMOTE_EXEC_AND_EXFIL_PATTERNS) {
      if (rule.pattern.test(fullPayloadText)) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_SECURITY_VIOLATION',
          message: `Security gate blocked proposal: ${rule.reason}`,
        });
      }
    }

    if (rawProposal.kind !== 'tool') {
      const fencedRegex = /```[^\n`]*\n([\s\S]*?)```|```([\s\S]*?)```/g;
      const fencedBlocks = [...fullPayloadText.matchAll(fencedRegex)]
        .map((m) => m[1] ?? m[2] ?? '')
        .join('\n');
      if (fencedBlocks) {
        for (const rule of SCRIPT_EXECUTION_PATTERNS) {
          if (rule.pattern.test(fencedBlocks)) {
            return fail({
              passed: false,
              gate_failed: 'SCHEMA_SECURITY',
              error_code: 'ERR_SECURITY_VIOLATION',
              message: `Security gate blocked proposal: ${rule.reason}`,
            });
          }
        }
      }

      if (rawProposal.kind === 'rule' || rawProposal.kind === 'skill') {
        for (const rule of [...DESTRUCTIVE_SHELL_PATTERNS, ...PROGRAMMATIC_DESTRUCTIVE_PATTERNS]) {
          if (rule.pattern.test(fullPayloadText)) {
            return fail({
              passed: false,
              gate_failed: 'SCHEMA_SECURITY',
              error_code: 'ERR_SECURITY_VIOLATION',
              message: `Security gate blocked proposal: ${rule.reason}`,
            });
          }
        }
      } else if (rawProposal.kind === 'preference' || isPersonalMemory) {
        const proseWithoutFences = fullPayloadText.replace(fencedRegex, ' ');
        const unnegatedReason = findUnnegatedDestructiveShellPattern(proseWithoutFences);
        if (unnegatedReason) {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_SECURITY_VIOLATION',
            message: `Security gate blocked proposal: ${unnegatedReason}`,
          });
        }
      }
    }

    // Ring 1 Tool Security: comment-stripped dangerous pattern & outbound network audit
    let toolRuntime: NonNullable<ProposalPayload['runtime']> | undefined;
    let toolSelfTestArgs: Record<string, unknown> | undefined;
    let toolTimeoutMs: number | undefined;
    let toolScriptCode: string | undefined;
    if (rawProposal.kind === 'tool') {
      const existingTool = this.storage.getTool(cleanId);
      const supersededTool = rawProposal.supersedes_id
        ? this.storage.getTool(sanitizeId(rawProposal.supersedes_id))
        : null;
      const baseTool = existingTool ?? supersededTool ?? undefined;
      toolRuntime = rawProposal.runtime ?? baseTool?.runtime ?? 'node';
      toolSelfTestArgs = rawProposal.self_test_args ?? baseTool?.self_test_args ?? {};
      toolTimeoutMs = rawProposal.timeout_ms ?? baseTool?.timeout_ms ?? config.sandboxTimeoutMs;
      toolScriptCode = (rawProposal.script_code || '').trim();
      if (!toolScriptCode || toolScriptCode.length < 20) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Tool proposal must include valid script_code (>= 20 chars).',
        });
      }

      const scriptExt = getExtensionForRuntime(toolRuntime);
      const strippedScript = stripScriptComments(toolScriptCode, scriptExt);
      const strippedCompact = strippedScript.replace(/[ \t]{2,}/g, ' ');
      for (const rule of [...UNIVERSAL_SECURITY_PATTERNS, ...SCRIPT_EXECUTION_PATTERNS]) {
        if (
          rule.pattern.test(fullPayloadText) ||
          rule.pattern.test(strippedScript) ||
          rule.pattern.test(strippedCompact)
        ) {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_SECURITY_VIOLATION',
            message: `Security gate blocked proposal: ${rule.reason}`,
          });
        }
      }

      const allowNetworkTools =
        (config as unknown as { allowNetworkTools?: boolean }).allowNetworkTools === true;
      if (!allowNetworkTools) {
        for (const netRule of TOOL_NETWORK_PATTERNS) {
          if (
            netRule.pattern.test(toolScriptCode) ||
            netRule.pattern.test(strippedScript) ||
            netRule.pattern.test(strippedCompact)
          ) {
            return fail({
              passed: false,
              gate_failed: 'SCHEMA_SECURITY',
              error_code: 'ERR_SECURITY_VIOLATION',
              message: `Security gate blocked tool proposal: ${netRule.reason}`,
            });
          }
        }
      }
    }

    // Prompt-Injection / Directive Tripwire (Gate 1 for rule/skill/preference/personal memory + trigger_cue on all kinds)
    if (
      rawProposal.kind === 'rule' ||
      rawProposal.kind === 'skill' ||
      rawProposal.kind === 'preference' ||
      isPersonalMemory ||
      triggerCueText
    ) {
      const textToAudit =
        rawProposal.kind === 'rule'
          ? `${rawProposal.title}\n${rawProposal.l0_summary}\n${triggerCueText}\n${resolvedRuleContent}`
          : rawProposal.kind === 'preference'
            ? `${rawProposal.title}\n${rawProposal.l0_summary}\n${triggerCueText}\n${resolvedPrefContent}`
            : isPersonalMemory
              ? `${rawProposal.title}\n${rawProposal.l0_summary}\n${triggerCueText}\n${resolvedSymptom}\n${resolvedRootCause}\n${resolvedSolution}`
              : rawProposal.kind === 'skill'
                ? `${rawProposal.title}\n${rawProposal.l0_summary}\n${triggerCueText}\n${resolvedSkillL1}\n${resolvedSkillL2}`
                : triggerCueText;
      const strippedAuditText = stripCaseAnchorLines(textToAudit)
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '');
      const PROMPT_INJECTION_REGEX =
        /\b(?:ignore\s+(?:all\s+)?previous\s+instructions|disregard\s+(?:all\s+)?system\s+prompts?|dangerously-skip-permissions|bypass\s+safety\s+guardrails?)\b/i;
      if (
        PROMPT_INJECTION_REGEX.test(strippedAuditText) ||
        (triggerCueText && PROMPT_INJECTION_REGEX.test(triggerCueText))
      ) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_SECURITY_VIOLATION',
          message:
            'Security gate blocked proposal: detected prompt-injection override or directive tripwire pattern.',
        });
      }
    }

    // Preference schema validation (Gate 1)
    let resolvedPrefCategory: PreferenceCategory | undefined;
    let resolvedPrefAlwaysOn: boolean | undefined;
    if (rawProposal.kind === 'preference') {
      if (!resolvedPrefContent) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Preference proposal requires non-empty content.',
        });
      }
      if (rawProposal.category !== undefined) {
        const rawCat = String(rawProposal.category).trim().toLowerCase() as PreferenceCategory;
        if (!PREFERENCE_CATEGORIES.includes(rawCat)) {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_INVALID_SCHEMA',
            message: `Invalid preference category '${String(rawProposal.category)}'. Must be one of: ${PREFERENCE_CATEGORIES.join(', ')}.`,
          });
        }
        resolvedPrefCategory = rawCat;
      } else {
        resolvedPrefCategory = existingPrefForDefaults?.category ?? 'style';
      }

      if (rawProposal.always_on !== undefined && typeof rawProposal.always_on !== 'boolean') {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Preference always_on must be a boolean.',
        });
      }
      resolvedPrefAlwaysOn =
        rawProposal.always_on !== undefined
          ? rawProposal.always_on
          : (existingPrefForDefaults?.always_on ?? true);
    }

    // trigger_cue validation (Gate 1)
    if (rawProposal.trigger_cue !== undefined) {
      if (
        typeof rawProposal.trigger_cue !== 'string' ||
        rawProposal.trigger_cue.includes('\n') ||
        rawProposal.trigger_cue.includes('\r') ||
        rawProposal.trigger_cue.trim().length === 0 ||
        rawProposal.trigger_cue.length > 120
      ) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'trigger_cue must be a non-empty single-line string <= 120 characters.',
        });
      }
    }

    // hook_trigger validation (Gate 1)
    if (rawProposal.hook_trigger !== undefined) {
      if (rawProposal.kind !== 'tool') {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'hook_trigger is only valid on tool proposals.',
        });
      }
      const ht = rawProposal.hook_trigger;
      if (!ht || typeof ht !== 'object') {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'hook_trigger must be an object.',
        });
      }
      if (ht.event !== 'pre-tool' && ht.event !== 'post-tool') {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: "hook_trigger event must be 'pre-tool' or 'post-tool'.",
        });
      }
      if (ht.tools !== undefined) {
        if (
          !Array.isArray(ht.tools) ||
          ht.tools.length === 0 ||
          ht.tools.some((t) => typeof t !== 'string' || !t.trim())
        ) {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_INVALID_SCHEMA',
            message: 'hook_trigger tools must be a non-empty array of non-empty strings.',
          });
        }
      }
      if (ht.file_glob !== undefined) {
        if (typeof ht.file_glob !== 'string' || !ht.file_glob.trim() || ht.file_glob.length > 120) {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_INVALID_SCHEMA',
            message: 'hook_trigger file_glob must be a non-empty string <= 120 characters.',
          });
        }
      }
      if (ht.block_on_failure !== undefined && typeof ht.block_on_failure !== 'boolean') {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'hook_trigger block_on_failure must be a boolean.',
        });
      }
      if (ht.error_signature !== undefined) {
        if (typeof ht.error_signature !== 'string' || ht.error_signature.length > 160) {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_INVALID_SCHEMA',
            message: 'hook_trigger error_signature must be a string <= 160 characters.',
          });
        }
        if (hasUnsafeHookRegex(ht.error_signature)) {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_INVALID_SCHEMA',
            message: 'hook_trigger error_signature contains a potential ReDoS nested-quantifier or ambiguous alternation pattern.',
          });
        }
        try {
          new RegExp(ht.error_signature);
        } catch {
          return fail({
            passed: false,
            gate_failed: 'SCHEMA_SECURITY',
            error_code: 'ERR_INVALID_SCHEMA',
            message: 'hook_trigger error_signature is not a valid regular expression.',
          });
        }
      }
    }

    // confidence & contrastive_evidence schema validation (Gate 1)
    if (rawProposal.confidence !== undefined) {
      if (!['high', 'medium', 'low', 'confounded'].includes(rawProposal.confidence)) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: "confidence must be one of 'high', 'medium', 'low', 'confounded'.",
        });
      }
    }

    if (rawProposal.contrastive_evidence !== undefined) {
      if (
        typeof rawProposal.contrastive_evidence !== 'string' ||
        rawProposal.contrastive_evidence.trim().length < 12
      ) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'contrastive_evidence must be a string of at least 12 characters.',
        });
      }
    }

    // Cross-Capability Reference Integrity Gate (Gate 1)
    if (rawProposal.kind === 'rule' || rawProposal.kind === 'skill') {
      const proposalTextForRefs =
        rawProposal.kind === 'rule'
          ? `${rawProposal.title}\n${rawProposal.l0_summary}\n${resolvedRuleContent}`
          : `${rawProposal.title}\n${rawProposal.l0_summary}\n${rawProposal.trigger_cue || ''}\n${resolvedSkillL1}\n${resolvedSkillL2}`;
      const extraKnown = new Set<string>();
      if (options?.extraKnownIds) {
        for (const id of options.extraKnownIds) {
          extraKnown.add(id);
          extraKnown.add(sanitizeId(id));
        }
      }
      extraKnown.add(cleanId);
      if (rawProposal.supersedes_id) {
        extraKnown.add(sanitizeId(rawProposal.supersedes_id));
      }
      const brokenRefs = validateCapabilityReferences(
        proposalTextForRefs,
        this.storage,
        extraKnown
      );
      if (brokenRefs.length > 0) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_BROKEN_CAPABILITY_REF',
          message: `Broken capability reference integrity: proposal references missing capability ID(s) [${brokenRefs.join(', ')}] not found in workspace .evo, global fallback, or seed-evo library.`,
        });
      }
    }

    // =========================================================================
    // GATE 1.5: CAUSAL ATTRIBUTION & ABSTRACTION GATE
    // =========================================================================
    if (rawProposal.kind === 'rule' || rawProposal.kind === 'skill') {
      if (rawProposal.confidence === 'confounded' && rawProposal.origin !== 'compacted') {
        return fail({
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_CONFOUNDED_CAUSATION',
          message:
            "Causal attribution gate blocked proposal: confidence is 'confounded'. When multiple causal factors or unisolated variables are present, crystallize as kind: 'memory' instead of elevating to a rule or skill, or omit crystallization until causation is isolated.",
        });
      }

      const hadCommandError =
        (rawProposal as unknown as Record<string, unknown>).had_command_error === 'true' ||
        (rawProposal as unknown as Record<string, unknown>).had_command_error === true ||
        this.telemetry.getSessionFlag('had_command_error') === 'true';
      const unproposedEditCount = Math.max(
        parseInt(String((rawProposal as unknown as Record<string, unknown>).unproposed_edit_count || '0'), 10),
        parseInt(this.telemetry.getSessionFlag('unproposed_edit_count') || '0', 10)
      );

      const bypassImplicitConfounded =
        options?.bypassConfoundedCheck === true ||
        rawProposal.origin === 'compacted';

      if (
        !bypassImplicitConfounded &&
        ((hadCommandError &&
          unproposedEditCount >= 4 &&
          !isValidContrastiveEvidence(rawProposal.contrastive_evidence, this.storage.rootDir)) ||
          (rawProposal.contrastive_evidence !== undefined &&
            !isValidContrastiveEvidence(rawProposal.contrastive_evidence, this.storage.rootDir)))
      ) {
        return fail({
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_CONFOUNDED_CAUSATION',
          message:
            "Causal attribution gate blocked proposal: the session encountered command errors alongside multiple unproposed edits (>=4 edits) or provided superficial 'contrastive_evidence' lacking causal structure. Provide grounded 'contrastive_evidence' (>= 12 characters with explicit before-vs-after causal markers and >= 3 substantive non-stopword tokens) or downgrade this proposal to kind: 'memory'.",
        });
      }
    }

    // =========================================================================
    // GATE 1.5: RULE ABSTRACTION & LEXICAL DE-SYMBOLIZATION GATE (FOR RULES)
    // =========================================================================
    if (rawProposal.kind === 'rule') {
      const scopeGlob = (rawProposal.scope_glob || '**/*').trim();
      const existingRuleForTransfer = this.storage.getRule(cleanId);
      const supersededRuleForTransfer = rawProposal.supersedes_id
        ? this.storage.getRule(sanitizeId(rawProposal.supersedes_id))
        : null;
      const isCoreRule =
        rawProposal.core !== undefined
          ? Boolean(rawProposal.core)
          : Boolean(
              existingRuleForTransfer?.core ||
                supersededRuleForTransfer?.core ||
                options?.supersededRules?.some((r) => r.core) ||
                false
            );
      const bodyForLexicalAudit = stripCaseAnchorLines(
        `${rawProposal.l0_summary}\n${resolvedRuleContent}`
      );

      // 1. Reject single-file literal scope_glob without wildcards (Issue #4 Problem 1)
      if (scopeGlob !== '**/*' && !/[*?[\]{}]/.test(scopeGlob)) {
        return fail({
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_SCOPE_TOO_NARROW',
          message: `Scope '${scopeGlob}' targets a single literal file without glob wildcards (*, ?, {}). Single-file bug fixes belong in Episodic Memory (kind: 'memory' with target_symbols) or must be abstracted 1-level-up to a subsystem pattern (e.g., 'Source/**/*.c' or 'src/**/*.ts').`,
        });
      }

      // 2. Reject point-bug case logs disguised as rules (Issue #4 Problem 1 & Issue #6)
      if (
        /-(?:bug|defect|hotfix|crash)$/i.test(cleanId) ||
        /\b(?:fixed in commit|root cause in commit|regression in commit)\s+[0-9a-f]{7,40}\b/i.test(
          bodyForLexicalAudit
        ) ||
        /\b(?:historical fix commits analyzed|fix commits analyzed|\d+\s+commits analyzed)\b/i.test(
          bodyForLexicalAudit
        ) ||
        /\b[0-9a-f]{7,40}\s+(?:fix|feat|chore|refactor|docs|test|hotfix|revert)\b/i.test(
          bodyForLexicalAudit
        )
      ) {
        return fail({
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_POINT_BUG_CASE_LOG',
          message: `Rule proposal '${cleanId}' reads like a point-bug postmortem or commit log rather than a reusable architectural guardrail. Use kind: 'memory' (with symptom, root_cause, solution, target_symbols) to record specific bug cases at 0 core token cost, or abstract the rule 1-level-up into a general class invariant.`,
        });
      }

      // 3. Reject hardcoded domain/physical parameter thresholds in rule body (Issue #6 Layer 1)
      const domainNumbers = detectDomainNumbersInRule(bodyForLexicalAudit);
      if (domainNumbers.length >= 2) {
        return fail({
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_RULE_CONTAINS_DOMAIN_NUMBERS',
          message: `Lexical De-Symbolization Gate blocked rule '${cleanId}': detected hardcoded domain/physical parameter thresholds (${domainNumbers.slice(0, 4).join(', ')}). Code is the Single Source of Truth (SSOT) for concrete thresholds and magic numbers; rules must express the verification methodology or move concrete case parameters into kind: 'memory' / a single 'Case Anchor:' line.`,
          diagnostics: { matched_domain_numbers: domainNumbers },
        });
      }

      // 4. Reject rules coupled to >= 3 concrete project identifiers/macros (Issue #6 Layer 1 & Module 7.1)
      const coupledIdentifiers = detectCoupledIdentifiersInRule(bodyForLexicalAudit);
      if (coupledIdentifiers.length >= 3) {
        return fail({
          passed: false,
          gate_failed: 'ABSTRACTION_GATE',
          error_code: 'ERR_RULE_COUPLED_TO_IDENTIFIERS',
          message: `Lexical De-Symbolization Gate blocked rule '${cleanId}': main body is tightly coupled to concrete project identifiers (${coupledIdentifiers.slice(0, 5).join(', ')}). Replace specific variable/macro names with architectural domain concepts in the rule body, and either use kind: 'memory' (with target_symbols) or isolate concrete symbols inside a 'Case Anchor:' line / '## 典型反例锚点' section.`,
          diagnostics: { coupled_identifiers: coupledIdentifiers },
        });
      }

      // 5. Require transfer_scenarios for non-core/scoped rules or when explicitly provided (Issue #6 Layer 2 & Module 7.2)
      const inheritedTransferScenarios =
        existingRuleForTransfer?.transfer_scenarios ||
        supersededRuleForTransfer?.transfer_scenarios ||
        options?.inheritedTransferScenarios;
      const effectiveTransferScenarios =
        rawProposal.transfer_scenarios !== undefined
          ? rawProposal.transfer_scenarios
          : inheritedTransferScenarios;
      const requireTransferScenarios =
        !isCoreRule ||
        (Array.isArray(rawProposal.transfer_scenarios) && rawProposal.transfer_scenarios.length > 0);
      if (requireTransferScenarios) {
        const validScenarios = Array.isArray(effectiveTransferScenarios)
          ? Array.from(
              new Set(
                effectiveTransferScenarios
                  .map((s) => String(s).trim())
                  .filter((s) => s.length >= 8)
              )
            )
          : [];
        if (validScenarios.length < 2) {
          return fail({
            passed: false,
            gate_failed: 'ABSTRACTION_GATE',
            error_code: 'ERR_INSUFFICIENT_TRANSFER_SCENARIOS',
            message: `Transferability Gate blocked rule '${cleanId}': 'transfer_scenarios' is required for new non-core/scoped rules and must provide at least 2 distinct cross-module/cross-scenario applications (>= 8 chars each) proving the rule is not overfitted to a single bug location.`,
          });
        }
      }
    }

    // Hoist Memory Schema Check & Historical Anchor Preservation (B4) above Gate 2
    let memoryExisting: EvoMemory | undefined;
    let memoryBaseMem: EvoMemory | undefined;
    let memoryHasEmptyBaseFingerprints = false;
    let memoryPreserveHistoricalAnchor = false;
    let memoryLiveHeadCommit = '';

    if (rawProposal.kind === 'memory') {
      if (!resolvedSymptom || !resolvedRootCause || !resolvedSolution) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message:
            'Episodic memory proposal requires non-empty symptom, root_cause, and solution.',
        });
      }

      if (!isPersonalMemory && normalizedTargetSymbols.length === 0) {
        return fail({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message:
            'Episodic memory proposal requires at least one symbol or file in target_symbols (e.g., ["src/core/telemetry.ts#search"]). For personal non-code experience, set memory_type: "personal" (in global scope).',
        });
      }

      memoryExisting = this.storage.getMemory(cleanId) ?? undefined;
      const supersededMem = rawProposal.supersedes_id
        ? this.storage.getMemory(sanitizeId(rawProposal.supersedes_id)) ?? undefined
        : undefined;
      memoryBaseMem = memoryExisting ?? supersededMem;
      if (isPersonalMemory) {
        memoryHasEmptyBaseFingerprints = true;
        memoryPreserveHistoricalAnchor = false;
        memoryLiveHeadCommit = 'personal';
      } else {
        const normalizeTargetForCompare = (spec: string): string => {
          const norm = this.normalizeWorkspaceTargetPath(spec);
          const hashIdx = norm.indexOf('#');
          if (hashIdx !== -1) {
            const filePart = norm.slice(0, hashIdx).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
            return `${filePart}${norm.slice(hashIdx)}`;
          }
          return norm.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
        };
        const baseRawSymbols = (memoryBaseMem?.target_symbols || [])
          .map((s) => this.normalizeTargetSymbol(s))
          .filter(Boolean);
        const baseSymbols = baseRawSymbols.map(normalizeTargetForCompare);
        const targetCompareSymbols = normalizedTargetSymbols.map(normalizeTargetForCompare);
        const sameTargetSymbols =
          Boolean(memoryBaseMem) &&
          baseSymbols.length === targetCompareSymbols.length &&
          baseSymbols.every((s, idx) => s === targetCompareSymbols[idx]);
        const hasCompleteBaseFingerprints =
          sameTargetSymbols &&
          Boolean(memoryBaseMem?.ast_fingerprints) &&
          normalizedTargetSymbols.length > 0 &&
          normalizedTargetSymbols.every((s, idx) =>
            Boolean(
              memoryBaseMem!.ast_fingerprints[s] ||
                (memoryBaseMem!.target_symbols[idx] &&
                  memoryBaseMem!.ast_fingerprints[memoryBaseMem!.target_symbols[idx]])
            )
          );
        memoryHasEmptyBaseFingerprints =
          sameTargetSymbols &&
          (!memoryBaseMem?.ast_fingerprints ||
            Object.keys(memoryBaseMem.ast_fingerprints).length === 0);

        const explicitCommit =
          typeof rawProposal.created_commit === 'string' && rawProposal.created_commit.trim()
            ? rawProposal.created_commit.trim()
            : '';
        // Preserve historical anchor when explicitly requested (matching created_commit or
        // preserveAnchorOnMetadataEdit without a conflicting explicit created_commit).
        memoryPreserveHistoricalAnchor =
          sameTargetSymbols &&
          (hasCompleteBaseFingerprints || memoryHasEmptyBaseFingerprints) &&
          Boolean(memoryBaseMem?.created_commit) &&
          memoryBaseMem!.created_commit !== 'uncommitted' &&
          (explicitCommit === memoryBaseMem!.created_commit ||
            (options?.preserveAnchorOnMetadataEdit === true && !explicitCommit));
        memoryLiveHeadCommit =
          memoryPreserveHistoricalAnchor || isAsync
            ? ''
            : resolveCurrentGitCommit(this.storage.rootDir);
      }
    }

    return {
      ok: true,
      context: {
        config,
        cleanSupersedesId,
        cleanId,
        rawProposal,
        resolvedRuleContent,
        resolvedSkillL1,
        resolvedSkillL2,
        resolvedPrefContent,
        resolvedPrefCategory,
        resolvedPrefAlwaysOn,
        resolvedTitle,
        resolvedL0Summary,
        resolvedSymptom,
        resolvedRootCause,
        resolvedSolution,
        normalizedTargetSymbols,
        toolRuntime,
        toolSelfTestArgs,
        toolTimeoutMs,
        toolScriptCode,
        memoryBaseMem,
        memoryExisting,
        memoryHasEmptyBaseFingerprints,
        memoryPreserveHistoricalAnchor,
        memoryLiveHeadCommit,
        isPersonalMemory,
        extractedMemoryFingerprints: {},
      },
    };
  }

  // ===========================================================================
  // GATE 2: AST GROUNDING (FOR MEMORY) / SYNTAX & SANDBOX DRY-RUN (FOR TOOLS)
  // ===========================================================================
  private runMemoryGroundingGate2(ctx: PreparedProposalContext): GatekeeperResult | null {
    if (ctx.isPersonalMemory || ctx.memoryPreserveHistoricalAnchor) {
      return null;
    }
    const grounding = buildFingerprintsForTargets(
      this.storage.rootDir,
      ctx.normalizedTargetSymbols
    );
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
    ctx.extractedMemoryFingerprints = grounding.fingerprints;
    return null;
  }

  private async runMemoryGroundingGate2Async(
    ctx: PreparedProposalContext
  ): Promise<GatekeeperResult | null> {
    if (ctx.isPersonalMemory) {
      ctx.memoryLiveHeadCommit = 'personal';
      return null;
    }
    const headSnap = await readGitHeadSnapshotAsync(this.storage.rootDir);
    if (!ctx.memoryPreserveHistoricalAnchor) {
      ctx.memoryLiveHeadCommit =
        headSnap.commit && headSnap.commit !== 'uncommitted' ? headSnap.commit : 'uncommitted';
    }
    ctx.memoryLiveHeadBranch =
      headSnap.branch && headSnap.branch !== 'HEAD' ? headSnap.branch : '';

    if (ctx.memoryPreserveHistoricalAnchor) {
      return null;
    }

    const fingerprints: Record<string, SymbolFingerprint> = {};
    const resolvedSymbols: string[] = [];
    const missingSymbols: string[] = [];
    for (const rawSym of ctx.normalizedTargetSymbols) {
      const clean = rawSym.trim();
      if (!clean) continue;
      const fp = await extractSymbolFingerprintAsync(this.storage.rootDir, clean);
      if (fp) {
        fingerprints[clean] = fp;
        resolvedSymbols.push(clean);
      } else {
        missingSymbols.push(clean);
      }
    }

    if (missingSymbols.length > 0) {
      return {
        passed: false,
        gate_failed: 'SYMBOL_GROUNDING',
        error_code: 'ERR_SYMBOL_NOT_FOUND',
        message: `AST Symbol Grounding Gate blocked memory proposal: target symbol(s) [${missingSymbols.join(', ')}] could not be resolved in workspace '${this.storage.rootDir}'. Verify real symbol/file names before crystallizing episodic memory.`,
        diagnostics: {
          resolved_symbols: resolvedSymbols,
          missing_symbols: missingSymbols,
        },
      };
    }
    ctx.extractedMemoryFingerprints = fingerprints;
    return null;
  }

  private setupToolDryRunStaging(
    runtime: NonNullable<ProposalPayload['runtime']>,
    scriptCode: string,
    tmpDir: string
  ): ToolDryRunStaging {
    const tmpScript = path.join(tmpDir, `run${getExtensionForRuntime(runtime)}`);
    const stageTmpDir = path.join(tmpDir, 'tmp');
    fs.mkdirSync(stageTmpDir, { recursive: true });
    fs.writeFileSync(tmpScript, scriptCode, 'utf8');
    const staging = prepareEphemeralSelfTestWorkspace(this.storage.rootDir, tmpDir);
    const runCwd = staging.staged && staging.stageDir ? staging.stageDir : this.storage.rootDir;
    return {
      tmpDir,
      tmpScript,
      stageTmpDir,
      staged: staging.staged,
      stageDir: staging.stageDir,
      preSnapshot: staging.preSnapshot,
      realPreSnapshot: staging.realPreSnapshot,
      runCwd,
    };
  }

  private async setupToolDryRunStagingAsync(
    runtime: NonNullable<ProposalPayload['runtime']>,
    scriptCode: string,
    tmpDir: string
  ): Promise<ToolDryRunStaging> {
    const tmpScript = path.join(tmpDir, `run${getExtensionForRuntime(runtime)}`);
    const stageTmpDir = path.join(tmpDir, 'tmp');
    await fs.promises.mkdir(stageTmpDir, { recursive: true });
    await fs.promises.writeFile(tmpScript, scriptCode, 'utf8');
    const staging = await prepareEphemeralSelfTestWorkspaceAsync(this.storage.rootDir, tmpDir);
    const runCwd = staging.staged && staging.stageDir ? staging.stageDir : this.storage.rootDir;
    return {
      tmpDir,
      tmpScript,
      stageTmpDir,
      staged: staging.staged,
      stageDir: staging.stageDir,
      preSnapshot: staging.preSnapshot,
      realPreSnapshot: staging.realPreSnapshot,
      runCwd,
    };
  }

  private formatToolDryRunOutcome(
    dryRun: { exitCode: number; stdout: string; stderr: string; durationMs: number },
    mutatedFiles: string[],
    restoredFiles: string[]
  ): GatekeeperResult | null {
    if (mutatedFiles.length > 0) {
      return {
        passed: false,
        gate_failed: 'SYNTAX_SANDBOX',
        error_code: 'ERR_SANDBOX_SELF_TEST',
        message: `Sandbox dry-run (--self-test) violated the side-effect-free invariant by mutating workspace file(s): [${mutatedFiles.slice(0, 5).join(', ')}]. Restored workspace file(s): [${restoredFiles.slice(0, 5).join(', ')}]. ERR_SANDBOX_FAILED: Micro-Tool --self-test must not create, modify, or delete workspace files.`,
        diagnostics: {
          error: 'ERR_SANDBOX_FAILED',
          mutatedFiles,
          restoredFiles,
        },
      };
    }

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

    return null;
  }

  private verifyToolDryRunOutcome(
    dryRun: { exitCode: number; stdout: string; stderr: string; durationMs: number },
    staging: ToolDryRunStaging
  ): GatekeeperResult | null {
    let mutatedFiles: string[];
    let restoredFiles: string[];

    if (staging.staged && staging.stageDir && staging.realPreSnapshot) {
      const postStageSig = captureWorkspaceMutationSignature(staging.stageDir);
      const stageRollback = restoreWorkspaceFromSnapshot(
        staging.stageDir,
        staging.preSnapshot,
        postStageSig
      );
      const postRealSig = captureWorkspaceMutationSignature(this.storage.rootDir);
      const realRollback = restoreWorkspaceFromSnapshot(
        this.storage.rootDir,
        staging.realPreSnapshot,
        postRealSig
      );
      mutatedFiles = Array.from(
        new Set([...stageRollback.mutatedFiles, ...realRollback.mutatedFiles])
      );
      restoredFiles = Array.from(
        new Set([...stageRollback.restoredFiles, ...realRollback.restoredFiles])
      );
    } else {
      const postWorkspaceSig = captureWorkspaceMutationSignature(this.storage.rootDir);
      const rollback = restoreWorkspaceFromSnapshot(
        this.storage.rootDir,
        staging.preSnapshot,
        postWorkspaceSig
      );
      mutatedFiles = rollback.mutatedFiles;
      restoredFiles = rollback.restoredFiles;
    }

    return this.formatToolDryRunOutcome(dryRun, mutatedFiles, restoredFiles);
  }

  private async verifyToolDryRunOutcomeAsync(
    dryRun: { exitCode: number; stdout: string; stderr: string; durationMs: number },
    staging: ToolDryRunStaging
  ): Promise<GatekeeperResult | null> {
    let mutatedFiles: string[];
    let restoredFiles: string[];

    if (staging.staged && staging.stageDir && staging.realPreSnapshot) {
      const postStageSig = await captureWorkspaceMutationSignatureAsync(staging.stageDir);
      const stageRollback = await restoreWorkspaceFromSnapshotAsync(
        staging.stageDir,
        staging.preSnapshot,
        postStageSig
      );
      const postRealSig = await captureWorkspaceMutationSignatureAsync(this.storage.rootDir);
      const realRollback = await restoreWorkspaceFromSnapshotAsync(
        this.storage.rootDir,
        staging.realPreSnapshot,
        postRealSig
      );
      mutatedFiles = Array.from(
        new Set([...stageRollback.mutatedFiles, ...realRollback.mutatedFiles])
      );
      restoredFiles = Array.from(
        new Set([...stageRollback.restoredFiles, ...realRollback.restoredFiles])
      );
    } else {
      const postWorkspaceSig = await captureWorkspaceMutationSignatureAsync(this.storage.rootDir);
      const rollback = await restoreWorkspaceFromSnapshotAsync(
        this.storage.rootDir,
        staging.preSnapshot,
        postWorkspaceSig
      );
      mutatedFiles = rollback.mutatedFiles;
      restoredFiles = rollback.restoredFiles;
    }

    return this.formatToolDryRunOutcome(dryRun, mutatedFiles, restoredFiles);
  }

  private runToolSandboxGate2Sync(ctx: PreparedProposalContext): GatekeeperResult | null {
    const runtime = ctx.toolRuntime!;
    const scriptCode = ctx.toolScriptCode!;
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
    try {
      const staging = this.setupToolDryRunStaging(runtime, scriptCode, tmpDir);
      const dryRun = executeSandboxedScript(
        runtime,
        staging.tmpScript,
        ctx.toolSelfTestArgs ?? {},
        {
          cwd: staging.runCwd,
          workspaceRoot: staging.runCwd,
          tmpDir: staging.stageTmpDir,
          timeoutMs: ctx.toolTimeoutMs,
          selfTest: true,
        }
      );
      return this.verifyToolDryRunOutcome(dryRun, staging);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private async runToolSandboxGate2Async(
    ctx: PreparedProposalContext
  ): Promise<GatekeeperResult | null> {
    const runtime = ctx.toolRuntime!;
    const scriptCode = ctx.toolScriptCode!;
    const syntaxCheck = await checkScriptSyntaxAsync(runtime, scriptCode);
    if (!syntaxCheck.valid) {
      return {
        passed: false,
        gate_failed: 'SYNTAX_SANDBOX',
        error_code: 'ERR_SYNTAX_CHECK',
        message: `Static syntax check failed for runtime '${runtime}': ${syntaxCheck.error}`,
      };
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'evo-dryrun-'));
    try {
      const staging = await this.setupToolDryRunStagingAsync(runtime, scriptCode, tmpDir);
      const dryRun = await executeSandboxedScriptAsync(
        runtime,
        staging.tmpScript,
        ctx.toolSelfTestArgs ?? {},
        {
          cwd: staging.runCwd,
          workspaceRoot: staging.runCwd,
          tmpDir: staging.stageTmpDir,
          timeoutMs: ctx.toolTimeoutMs,
          selfTest: true,
        }
      );
      return await this.verifyToolDryRunOutcomeAsync(dryRun, staging);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private finalizeAndCommitProposal(
    ctx: PreparedProposalContext,
    options?: EvaluateOptions
  ): GatekeeperResult {
    const core = this.finalizeProposalCore(ctx, options);
    if (core.done) return core.result;

    let dirtyWorktreeFiles: string[] = [];
    let dirtyTargetFiles: string[] = [];
    if (!core.preserveHistoricalAnchor) {
      try {
        const statusRes = spawnSync('git', ['status', '--porcelain', '--', './'], {
          cwd: this.storage.rootDir,
          encoding: 'utf8',
          timeout: 1500,
        });
        if (statusRes.status === 0 && statusRes.stdout) {
          let rootPrefixLower = '';
          try {
            const topRes = spawnSync('git', ['rev-parse', '--show-toplevel'], {
              cwd: this.storage.rootDir,
              encoding: 'utf8',
              timeout: 1000,
            });
            if (topRes.status === 0 && topRes.stdout.trim()) {
              const topReal = fs.realpathSync(topRes.stdout.trim());
              const rootReal = fs.realpathSync(this.storage.rootDir);
              const relRoot = path.relative(topReal, rootReal).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
              if (relRoot && !relRoot.startsWith('..')) {
                rootPrefixLower = `${relRoot.toLowerCase()}/`;
              }
            }
          } catch {
            // ignore git toplevel resolution failure
          }
          const parsed = this.parseDirtyWorktreeOutput(
            statusRes.stdout,
            rootPrefixLower,
            core.finalMemoryFingerprints
          );
          dirtyWorktreeFiles = parsed.dirtyWorktreeFiles;
          dirtyTargetFiles = parsed.dirtyTargetFiles;
        }
      } catch {
        // ignore git status check errors
      }
    }

    return this.buildMemoryCommitResult(core, dirtyWorktreeFiles, dirtyTargetFiles);
  }

  private async finalizeAndCommitProposalAsync(
    ctx: PreparedProposalContext,
    options?: EvaluateOptions
  ): Promise<GatekeeperResult> {
    const core = this.finalizeProposalCore(ctx, options);
    if (core.done) return core.result;

    let dirtyWorktreeFiles: string[] = [];
    let dirtyTargetFiles: string[] = [];
    if (!core.preserveHistoricalAnchor) {
      try {
        const statusRes = await spawnGitAsync(
          this.storage.rootDir,
          ['status', '--porcelain', '--', './'],
          1500
        );
        if (statusRes.status === 0 && statusRes.stdout) {
          let rootPrefixLower = '';
          try {
            const topRes = await spawnGitAsync(
              this.storage.rootDir,
              ['rev-parse', '--show-toplevel'],
              1000
            );
            if (topRes.status === 0 && topRes.stdout.trim()) {
              const topReal = await fs.promises.realpath(topRes.stdout.trim());
              const rootReal = await fs.promises.realpath(this.storage.rootDir);
              const relRoot = path.relative(topReal, rootReal).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
              if (relRoot && !relRoot.startsWith('..')) {
                rootPrefixLower = `${relRoot.toLowerCase()}/`;
              }
            }
          } catch {
            // ignore git toplevel resolution failure
          }
          const parsed = this.parseDirtyWorktreeOutput(
            statusRes.stdout,
            rootPrefixLower,
            core.finalMemoryFingerprints
          );
          dirtyWorktreeFiles = parsed.dirtyWorktreeFiles;
          dirtyTargetFiles = parsed.dirtyTargetFiles;
        }
      } catch {
        // ignore git status check errors
      }
    }

    return this.buildMemoryCommitResult(core, dirtyWorktreeFiles, dirtyTargetFiles);
  }

  private parseDirtyWorktreeOutput(
    stdout: string,
    rootPrefixLower: string,
    finalMemoryFingerprints: Record<string, SymbolFingerprint>
  ): { dirtyWorktreeFiles: string[]; dirtyTargetFiles: string[] } {
    const dirtyWorktreeFiles = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 2)
      .map((line) => {
        const rawPath = line.replace(/^\S+\s+/, '').trim().replace(/^"+|"+$/g, '');
        const arrowIdx = rawPath.indexOf(' -> ');
        let rel = (arrowIdx !== -1 ? rawPath.slice(arrowIdx + 4) : rawPath).replace(/\\/g, '/');
        if (rootPrefixLower && rel.toLowerCase().startsWith(rootPrefixLower)) {
          rel = rel.slice(rootPrefixLower.length);
        }
        return rel;
      })
      .filter(
        (relPath) =>
          relPath.length > 0 &&
          !/(?:^|\/)\.(?:evo|git|codegraph)(?:\/|$)/.test(relPath)
      );
    const targetRelPaths = new Set(
      Object.values(finalMemoryFingerprints)
        .map((fp) => (fp.file_path || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase())
        .filter(Boolean)
    );
    const dirtyTargetFiles = dirtyWorktreeFiles.filter((df) => {
      const normDf = df.replace(/^\.\//, '').toLowerCase();
      for (const tf of targetRelPaths) {
        if (normDf === tf || (normDf.endsWith('/') && tf.startsWith(normDf))) {
          return true;
        }
      }
      return false;
    });
    return { dirtyWorktreeFiles, dirtyTargetFiles };
  }

  private buildMemoryCommitResult(
    core: {
      cleanId: string;
      currentCommit: string;
      currentBranch: string | undefined;
      targetSymbols: string[];
      finalMemoryFingerprints: Record<string, SymbolFingerprint>;
    },
    dirtyWorktreeFiles: string[],
    dirtyTargetFiles: string[]
  ): GatekeeperResult {
    const { cleanId, currentCommit, currentBranch, targetSymbols, finalMemoryFingerprints } = core;
    const upgradeCandidates = [
      ...this.storage
        .listRules()
        .filter((r) => !r.core)
        .map((r) => ({
          id: r.id,
          kind: 'rule' as const,
          scope_glob: r.scope_glob,
          l0_summary: r.l0_summary,
        })),
      ...this.storage.listSkills().map((s) => ({
        id: s.id,
        kind: 'skill' as const,
        l0_summary: s.l0_summary,
      })),
    ].slice(0, 6);

    const dirtyCommitWarning =
      dirtyWorktreeFiles.length > 0
        ? `⚠️ [PRE-COMMIT ANCHOR WARNING] Working tree has uncommitted changes (${dirtyTargetFiles.length > 0 ? `target file(s): ${dirtyTargetFiles.join(', ')}` : `${dirtyWorktreeFiles.length} modified file(s)`}) while 'created_commit' is anchored to pre-fix HEAD (${currentCommit}). After running 'git commit', call evo_propose(kind: 'memory', id: '${cleanId}', supersedes_id: '${cleanId}', workspace) to re-anchor 'created_commit' to the actual fix commit.`
        : '';

    const methodologyWarning =
      upgradeCandidates.length > 0
        ? `METHODOLOGY AUDIT: If this session also involved a user correction or reusable cross-module methodology improvement, do NOT stop at kind: 'memory'. Upgrade the relevant rule/skill (${upgradeCandidates.map((c) => `${c.id} [${c.kind}]`).join(', ')}) via evo_propose with supersedes_id.`
        : `METHODOLOGY AUDIT: If this session also involved a user correction or reusable cross-module methodology improvement, do NOT stop at kind: 'memory' — also crystallize or upgrade a scoped rule/skill.`;

    const combinedWarning = [dirtyCommitWarning, methodologyWarning].filter(Boolean).join('\n\n');
    const baseMemMessage = `Episodic Memory '${cleanId}' passed AST Symbol Grounding (${targetSymbols.length} symbol(s) fingerprinted @ commit ${currentCommit}) and is crystallized at .evo/memories/${cleanId}.md (0 core budget tokens used).`;

    return {
      passed: true,
      message: dirtyCommitWarning ? `${baseMemMessage} ${dirtyCommitWarning}` : baseMemMessage,
      warning: combinedWarning,
      diagnostics: {
        id: cleanId,
        kind: 'memory',
        created_commit: currentCommit,
        created_branch: currentBranch,
        target_symbols: targetSymbols,
        ast_fingerprints: finalMemoryFingerprints,
        uncommitted_worktree: dirtyWorktreeFiles.length > 0,
        ...(dirtyTargetFiles.length > 0 ? { dirty_target_files: dirtyTargetFiles } : {}),
        scoped_rule_upgrade_candidates: upgradeCandidates,
      },
    };
  }

  private finalizeProposalCore(
    ctx: PreparedProposalContext,
    options?: EvaluateOptions
  ):
    | { done: true; result: GatekeeperResult }
    | {
        done: false;
        cleanId: string;
        currentCommit: string;
        currentBranch: string | undefined;
        targetSymbols: string[];
        finalMemoryFingerprints: Record<string, SymbolFingerprint>;
        preserveHistoricalAnchor: boolean;
      } {
    const done = (result: GatekeeperResult): { done: true; result: GatekeeperResult } => ({
      done: true,
      result,
    });
    const {
      config,
      cleanSupersedesId,
      cleanId,
      rawProposal,
      resolvedRuleContent,
      resolvedSkillL1,
      resolvedSkillL2,
      resolvedPrefContent,
      resolvedPrefCategory,
      resolvedPrefAlwaysOn,
      resolvedTitle,
      resolvedL0Summary,
      resolvedSymptom,
      resolvedRootCause,
      resolvedSolution,
      normalizedTargetSymbols,
      extractedMemoryFingerprints,
    } = ctx;

    // =========================================================================
    // GATE 3: BM25 / JACCARD DUPLICATE & CONFLICT DETECTION
    // =========================================================================
    const extraSimText =
      rawProposal.kind === 'memory'
        ? `${resolvedSymptom} ${(rawProposal.target_symbols || []).join(' ')}`
        : '';

    let candidateBodyForSim = '';
    if (rawProposal.kind === 'rule') {
      candidateBodyForSim = stripCaseAnchorLines(resolvedRuleContent);
    } else if (rawProposal.kind === 'skill') {
      candidateBodyForSim = `${resolvedSkillL1}\n${resolvedSkillL2}`;
    } else if (rawProposal.kind === 'tool') {
      candidateBodyForSim = rawProposal.script_code || '';
    } else if (rawProposal.kind === 'memory') {
      candidateBodyForSim = `${resolvedSymptom}\n${resolvedRootCause}\n${resolvedSolution}`;
    } else if (rawProposal.kind === 'preference') {
      candidateBodyForSim = resolvedPrefContent;
    }

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
        extraSimText,
        candidateBodyForSim
      )
      .filter((s) => !excludeSet.has(s.id) && s.similarity >= config.duplicateBm25Threshold);

    const hasValidSameKindSupersedes = Boolean(
      cleanSupersedesId && this.findExistingCapability(rawProposal.kind, cleanSupersedesId)
    );
    if (similar.length > 0 && !hasValidSameKindSupersedes) {
      return done({
        passed: false,
        gate_failed: 'DUPLICATE_CHECK',
        error_code: 'ERR_DUPLICATE_CAPABILITY',
        message: `Similar ${rawProposal.kind} already exists (${similar.map((s) => `${s.id} [${(s.similarity * 100).toFixed(0)}%]`).join(', ')}). Specify a valid same-kind 'supersedes_id' to upgrade the existing entry or call 'evo_compact' to merge.`,
        conflicting_ids: similar.map((s) => s.id),
      });
    }

    // D8: Deterministic Preference Polarity Conflict Guard
    let preferencePolarityWarning: string | undefined;
    if (rawProposal.kind === 'preference') {
      const candidatePool = this.storage
        .listPreferences()
        .filter((p) => !excludeSet.has(p.id));
      const polarityConflicts = detectPreferenceConflict(
        {
          id: cleanId,
          title: resolvedTitle,
          l0_summary: resolvedL0Summary,
          content: resolvedPrefContent,
          always_on: resolvedPrefAlwaysOn !== false,
        },
        candidatePool
      );
      const blockingPolarityConflicts = polarityConflicts.filter((c) => !c.always_on_mismatch);
      const mismatchedAlwaysOnConflicts = polarityConflicts.filter((c) => c.always_on_mismatch);
      if (blockingPolarityConflicts.length > 0) {
        const conflictIds = blockingPolarityConflicts.map((c) => c.id);
        return done({
          passed: false,
          gate_failed: 'DUPLICATE_CHECK',
          error_code: 'ERR_DUPLICATE_CAPABILITY',
          message: `Preference '${cleanId}' conflicts with existing opposite-polarity preference(s): ${blockingPolarityConflicts.map((c) => `${c.id} [${c.topic}]`).join(', ')}. Pass supersedes_id: "${conflictIds[0]}" to cleanly replace the conflicting habit.`,
          conflicting_ids: conflictIds,
        });
      }
      if (mismatchedAlwaysOnConflicts.length > 0) {
        preferencePolarityWarning = `Preference '${cleanId}' (always_on=${resolvedPrefAlwaysOn !== false}) has opposite polarity to existing preference(s) with different always_on scope: ${mismatchedAlwaysOnConflicts.map((c) => `${c.id} [${c.topic}]`).join(', ')}. Allowed as context-specific override.`;
      }
    }

    // =========================================================================
    // GATE 4: TOKEN BUDGET CAP & SCOPED BUCKET QUOTA ENFORCEMENT
    // =========================================================================
    const now = new Date().toISOString();

    if (rawProposal.kind === 'rule') {
      const content = resolvedRuleContent;
      if (!content) {
        return done({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Rule proposal requires non-empty content.',
        });
      }

      const existing = this.storage.getRule(cleanId);
      const supersededTargetId = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : (existing ? cleanId : undefined);
      const supersededRuleFromStorage = supersededTargetId
        ? this.storage.getRule(supersededTargetId)
        : undefined;

      const isCore =
        rawProposal.core !== undefined
          ? Boolean(rawProposal.core)
          : Boolean(
              existing?.core ||
                supersededRuleFromStorage?.core ||
                options?.supersededRules?.some((r) => r.core) ||
                false
            );
      const scopeGlob = (rawProposal.scope_glob || '**/*').trim();
      const newRuleTokens = estimateTokens(`- **[${cleanId}]**: ${rawProposal.l0_summary}\n${content}`);

      if (isCore) {
        const { rules: existingCoreRules } = this.storage.getCoreRulesTokenUsage();
        const filteredRules = existingCoreRules.filter((r) => !excludeSet.has(r.id));
        const currentTokens = filteredRules.reduce((acc, r) => acc + r.tokens, 0);
        const effectiveCandidateTokens = currentTokens + newRuleTokens;

        if (effectiveCandidateTokens > config.maxCoreRuleTokens) {
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

          return done({
            passed: false,
            gate_failed: 'TOKEN_BUDGET',
            error_code: 'ERR_BUDGET_EXCEEDED',
            message: `Core rule token budget exceeded (${effectiveCandidateTokens} / ${config.maxCoreRuleTokens} tokens). Call 'evo_compact' to merge or demote low-hit rules first, or set 'core: false' for scoped loading.`,
            low_value_candidates: lowValueCandidates,
          });
        }
      } else {
        const targetBucket = getScopeBucketKey(scopeGlob);
        const existingScopedRules = this.storage
          .listRules()
          .filter((r) => !r.core && r.enabled !== false && !excludeSet.has(r.id));
        const sameBucketRules = existingScopedRules.filter(
          (r) => getScopeBucketKey(r.scope_glob) === targetBucket
        );
        const maxPerBucket = config.maxScopedRulesPerBucket ?? 3;
        const maxTotalScoped = config.maxTotalScopedRules ?? 12;

        if (
          sameBucketRules.length >= maxPerBucket ||
          existingScopedRules.length >= maxTotalScoped
        ) {
          return done({
            passed: false,
            gate_failed: 'TOKEN_BUDGET',
            error_code: 'ERR_SCOPED_BUCKET_FULL',
            message: `Scoped rule bucket '${targetBucket}' is full (${sameBucketRules.length}/${maxPerBucket} in bucket, ${existingScopedRules.length}/${maxTotalScoped} total scoped rules: [${sameBucketRules.map((r) => r.id).join(', ')}]). Specify 'supersedes_id' to upgrade an existing scoped rule, or call 'evo_compact' to merge overlapping rules in '${targetBucket}' into a single subsystem checklist.`,
            conflicting_ids: sameBucketRules.map((r) => r.id),
          });
        }
      }

      let supersededComparison: {
        superseded_id: string;
        clause_count_before: number;
        clause_count_after: number;
        removed_clauses: string[];
        preserved_clauses: string[];
        added_clauses: string[];
      } | undefined;
      let clauseWarning: string | undefined;

      if (options?.supersededRules && options.supersededRules.length > 0) {
        const oldClauses: string[] = [];
        for (const r of options.supersededRules) {
          oldClauses.push(...extractActionableClauses(r.content));
        }
        const newClauses = extractActionableClauses(content);
        const { removed, preserved, added } = compareRuleClauses(oldClauses, newClauses);
        const combinedId = options.supersededRules.map((r) => r.id).join(', ');
        supersededComparison = {
          superseded_id: combinedId,
          clause_count_before: oldClauses.length,
          clause_count_after: newClauses.length,
          removed_clauses: removed,
          preserved_clauses: preserved,
          added_clauses: added,
        };
        if (removed.length > 0) {
          clauseWarning = `⚠️ [ORTHOGONAL CLAUSE WARNING] Upgrading '${combinedId}' discarded ${removed.length} clause(s) from the superseded rule(s):\n${removed.map((c, i) => `  ${i + 1}. ${c.slice(0, 100)}${c.length > 100 ? '...' : ''}`).join('\n')}\nEnsure orthogonal invariants are not inadvertently discarded.`;
        }
      } else if (supersededTargetId && supersededRuleFromStorage) {
        const oldClauses = extractActionableClauses(supersededRuleFromStorage.content);
        const newClauses = extractActionableClauses(content);
        const { removed, preserved, added } = compareRuleClauses(oldClauses, newClauses);
        supersededComparison = {
          superseded_id: supersededTargetId,
          clause_count_before: oldClauses.length,
          clause_count_after: newClauses.length,
          removed_clauses: removed,
          preserved_clauses: preserved,
          added_clauses: added,
        };
        if (removed.length > 0) {
          clauseWarning = `⚠️ [ORTHOGONAL CLAUSE WARNING] Upgrading '${supersededTargetId}' discarded ${removed.length} clause(s) from the superseded rule:\n${removed.map((c, i) => `  ${i + 1}. ${c.slice(0, 100)}${c.length > 100 ? '...' : ''}`).join('\n')}\nEnsure orthogonal invariants are not inadvertently discarded.`;
        }
      }

      if (options?.dryRun) {
        const dryRunDiagnostics: Record<string, unknown> = {
          id: cleanId,
          kind: 'rule',
          tokens: newRuleTokens,
          core: isCore,
        };
        if (supersededComparison) {
          dryRunDiagnostics.superseded_comparison = supersededComparison;
        }
        let dryRunMsg = `Dry-run: Rule '${cleanId}' passed all Gatekeeper checks (${newRuleTokens} tokens).`;
        if (supersededComparison && supersededComparison.removed_clauses.length > 0) {
          dryRunMsg += ` (Warning: ${supersededComparison.removed_clauses.length} orthogonal clause(s) discarded from superseded rule '${supersededComparison.superseded_id}')`;
        }
        return done({
          passed: true,
          message: dryRunMsg,
          warning: clauseWarning,
          diagnostics: dryRunDiagnostics,
        });
      }

      const preservedCreatedAt = existing?.created_at || supersededRuleFromStorage?.created_at || options?.preservedCreatedAt || now;
      const inheritedTransferScenarios =
        rawProposal.transfer_scenarios !== undefined
          ? rawProposal.transfer_scenarios.map((s) => String(s).trim()).filter(Boolean)
          : (existing?.transfer_scenarios ||
             supersededRuleFromStorage?.transfer_scenarios ||
             options?.inheritedTransferScenarios);

      const correctionMetadata =
        this.telemetry.getSessionFlag('user_correction_detected') === 'true' ||
        this.telemetry.getSessionFlag('had_command_error') === 'true'
          ? { superseded_after_correction: true }
          : undefined;

      const prevSelfRuleSnap = existing
        ? this.storage.snapshotCapabilityForHistory(cleanId, 'rule')
        : null;
      const sanitizedSupersedesRuleForSnap = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const prevSupRuleSnap =
        sanitizedSupersedesRuleForSnap && sanitizedSupersedesRuleForSnap !== cleanId
          ? this.storage.snapshotCapabilityForHistory(sanitizedSupersedesRuleForSnap, 'rule')
          : null;

      if (existing) {
        this.storage.archiveCapability(
          cleanId,
          'rule',
          'Updated by same-ID proposal',
          correctionMetadata
        );
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'rule',
          `Superseded by ${cleanId}`,
          correctionMetadata
        );
      }

      const baseRule = existing ?? supersededRuleFromStorage;
      const sanitizedSupersedesRule = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const resolvedSupersedesId =
        sanitizedSupersedesRule && sanitizedSupersedesRule !== cleanId
          ? sanitizedSupersedesRule
          : undefined;
      const ruleObj: EvoRule = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        scope_glob: scopeGlob,
        core: isCore,
        priority: rawProposal.priority ?? baseRule?.priority ?? 50,
        content,
        tokens: newRuleTokens,
        origin: rawProposal.origin || baseRule?.origin || 'evolved',
        supersedes_id: resolvedSupersedesId,
        transfer_scenarios: inheritedTransferScenarios && inheritedTransferScenarios.length > 0
          ? inheritedTransferScenarios
          : undefined,
        confidence:
          rawProposal.confidence || existing?.confidence || supersededRuleFromStorage?.confidence,
        contrastive_evidence:
          rawProposal.contrastive_evidence ||
          existing?.contrastive_evidence ||
          supersededRuleFromStorage?.contrastive_evidence,
        enabled:
          rawProposal.enabled !== undefined
            ? rawProposal.enabled === false
              ? false
              : true
            : baseRule?.enabled !== false,
        review_status:
          rawProposal.review_status === 'approved' || rawProposal.review_status === 'pending'
            ? rawProposal.review_status
            : (baseRule?.review_status || 'pending'),
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveRule(ruleObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');
      const prevRuleSnapText = prevSelfRuleSnap?.snapshot || prevSupRuleSnap?.snapshot;
      this.storage.appendProfileHistory({
        ts: now,
        action: existing || resolvedSupersedesId ? 'update' : 'add',
        id: cleanId,
        kind: 'rule',
        title: ruleObj.title,
        ...(rawProposal.batch_id ? { batch_id: rawProposal.batch_id } : {}),
        ...(prevRuleSnapText ? { previous_snapshot: prevRuleSnapText } : {}),
        ...(prevSelfRuleSnap?.wasCore !== undefined ? { was_core: prevSelfRuleSnap.wasCore } : {}),
        ...(resolvedSupersedesId ? { superseded_id: resolvedSupersedesId, superseded_kind: 'rule' as const } : {}),
        ...(prevSupRuleSnap?.snapshot ? { superseded_snapshot: prevSupRuleSnap.snapshot } : {}),
        ...(prevSupRuleSnap?.wasCore !== undefined ? { superseded_was_core: prevSupRuleSnap.wasCore } : {}),
        ...(prevSelfRuleSnap?.snapshot && resolvedSupersedesId
          ? { self_previous_snapshot: prevSelfRuleSnap.snapshot }
          : {}),
        reason: resolvedSupersedesId
          ? `Superseded ${resolvedSupersedesId}`
          : existing
            ? 'Updated rule'
            : 'Added rule',
      });

      const commitDiagnostics: Record<string, unknown> = {
        id: cleanId,
        kind: 'rule',
        tokens: newRuleTokens,
        core: isCore,
      };
      if (supersededComparison) {
        commitDiagnostics.superseded_comparison = supersededComparison;
      }
      let commitMsg = `Rule '${cleanId}' passed all Gatekeeper checks and is now active (${newRuleTokens} tokens).`;
      if (supersededComparison && supersededComparison.removed_clauses.length > 0) {
        commitMsg += ` (Warning: ${supersededComparison.removed_clauses.length} orthogonal clause(s) discarded from superseded rule '${supersededComparison.superseded_id}')`;
      }

      return done({
        passed: true,
        message: commitMsg,
        warning: clauseWarning,
        diagnostics: commitDiagnostics,
      });
    }

    if (rawProposal.kind === 'skill') {
      const l1 = resolvedSkillL1;
      const l2 = resolvedSkillL2;
      if (!l1 || !l2) {
        return done({
          passed: false,
          gate_failed: 'SCHEMA_SECURITY',
          error_code: 'ERR_INVALID_SCHEMA',
          message: 'Skill proposal requires both l1_contract (inputs/triggers) and l2_sop (step-by-step procedure).',
        });
      }

      if (options?.dryRun) {
        return done({
          passed: true,
          message: `Dry-run: Skill '${cleanId}' passed all Gatekeeper checks.`,
          diagnostics: { id: cleanId, kind: 'skill' },
        });
      }

      const existing = this.storage.getSkill(cleanId);
      const supersededSkill = rawProposal.supersedes_id
        ? this.storage.getSkill(sanitizeId(rawProposal.supersedes_id))
        : null;
      const preservedCreatedAt = existing?.created_at || supersededSkill?.created_at || options?.preservedCreatedAt || now;
      const correctionMetadata =
        this.telemetry.getSessionFlag('user_correction_detected') === 'true' ||
        this.telemetry.getSessionFlag('had_command_error') === 'true'
          ? { superseded_after_correction: true }
          : undefined;

      const prevSelfSkillSnap = existing
        ? this.storage.snapshotCapabilityForHistory(cleanId, 'skill')
        : null;
      const sanitizedSupSkillSnap = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const prevSupSkillSnap =
        sanitizedSupSkillSnap && sanitizedSupSkillSnap !== cleanId
          ? this.storage.snapshotCapabilityForHistory(sanitizedSupSkillSnap, 'skill')
          : null;

      if (existing) {
        this.storage.archiveCapability(
          cleanId,
          'skill',
          'Updated by same-ID proposal',
          correctionMetadata
        );
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'skill',
          `Superseded by ${cleanId}`,
          correctionMetadata
        );
      }

      const baseSkill = existing ?? supersededSkill;
      const sanitizedSupersedesSkill = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const resolvedSupersedesId =
        sanitizedSupersedesSkill && sanitizedSupersedesSkill !== cleanId
          ? sanitizedSupersedesSkill
          : undefined;
      const skillObj: EvoSkill = {
        id: cleanId,
        title: rawProposal.title.trim(),
        name: rawProposal.name || baseSkill?.name || cleanId,
        description: rawProposal.description || rawProposal.l0_summary.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        l1_contract: l1,
        l2_sop: l2,
        tags: Array.isArray(rawProposal.tags)
          ? rawProposal.tags
          : (existing?.tags ?? supersededSkill?.tags ?? []),
        origin: rawProposal.origin || baseSkill?.origin || 'evolved',
        supersedes_id: resolvedSupersedesId,
        trigger_cue:
          rawProposal.trigger_cue !== undefined
            ? rawProposal.trigger_cue.trim()
            : (existing?.trigger_cue || supersededSkill?.trigger_cue),
        confidence:
          rawProposal.confidence || existing?.confidence || supersededSkill?.confidence,
        contrastive_evidence:
          rawProposal.contrastive_evidence !== undefined
            ? rawProposal.contrastive_evidence.trim()
            : (existing?.contrastive_evidence || supersededSkill?.contrastive_evidence),
        enabled:
          rawProposal.enabled !== undefined
            ? rawProposal.enabled === false
              ? false
              : true
            : baseSkill?.enabled !== false,
        review_status:
          rawProposal.review_status === 'approved' || rawProposal.review_status === 'pending'
            ? rawProposal.review_status
            : (baseSkill?.review_status || 'pending'),
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveSkill(skillObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');
      this.storage.appendProfileHistory({
        ts: now,
        action: existing || resolvedSupersedesId ? 'update' : 'add',
        id: cleanId,
        kind: 'skill',
        title: skillObj.title,
        ...(rawProposal.batch_id ? { batch_id: rawProposal.batch_id } : {}),
        ...(prevSelfSkillSnap?.files
          ? { previous_files: prevSelfSkillSnap.files }
          : prevSupSkillSnap?.files
            ? { previous_files: prevSupSkillSnap.files }
            : {}),
        ...(resolvedSupersedesId ? { superseded_id: resolvedSupersedesId, superseded_kind: 'skill' as const } : {}),
        ...(prevSupSkillSnap?.files ? { superseded_files: prevSupSkillSnap.files } : {}),
        ...(prevSelfSkillSnap?.files && resolvedSupersedesId
          ? { self_previous_files: prevSelfSkillSnap.files }
          : {}),
        reason: resolvedSupersedesId
          ? `Superseded ${resolvedSupersedesId}`
          : existing
            ? 'Updated skill'
            : 'Added skill',
      });

      return done({
        passed: true,
        message: `Skill '${cleanId}' passed all Gatekeeper checks and is crystallized at .evo/skills/${cleanId}/SKILL.md.`,
        diagnostics: { id: cleanId, kind: 'skill' },
      });
    }

    if (rawProposal.kind === 'tool') {
      const existing = this.storage.getTool(cleanId);
      const supersededTool = rawProposal.supersedes_id
        ? this.storage.getTool(sanitizeId(rawProposal.supersedes_id))
        : undefined;
      const baseTool = existing ?? supersededTool;
      const runtime = rawProposal.runtime ?? baseTool?.runtime ?? 'node';
      const scriptCode = (rawProposal.script_code || '').trim();

      if (options?.dryRun) {
        return done({
          passed: true,
          message: `Dry-run: Micro-Tool '${cleanId}' (${runtime}) passed syntax & sandbox self-test.`,
          diagnostics: { id: cleanId, kind: 'tool', runtime },
        });
      }

      const preservedCreatedAt = baseTool?.created_at || options?.preservedCreatedAt || now;
      const toolTags = Array.isArray(rawProposal.tags)
        ? rawProposal.tags.map((t) => String(t).trim()).filter(Boolean)
        : (baseTool?.tags || []);
      const correctionMetadata =
        this.telemetry.getSessionFlag('user_correction_detected') === 'true' ||
        this.telemetry.getSessionFlag('had_command_error') === 'true'
          ? { superseded_after_correction: true }
          : undefined;

      const prevSelfToolSnap = existing
        ? this.storage.snapshotCapabilityForHistory(cleanId, 'tool')
        : null;
      const sanitizedSupToolSnap = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const prevSupToolSnap =
        sanitizedSupToolSnap && sanitizedSupToolSnap !== cleanId
          ? this.storage.snapshotCapabilityForHistory(sanitizedSupToolSnap, 'tool')
          : null;

      if (existing) {
        this.storage.archiveCapability(
          cleanId,
          'tool',
          'Updated by same-ID proposal',
          correctionMetadata
        );
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'tool',
          `Superseded by ${cleanId}`,
          correctionMetadata
        );
      }

      const sanitizedSupersedesTool = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const resolvedSupersedesId =
        sanitizedSupersedesTool && sanitizedSupersedesTool !== cleanId
          ? sanitizedSupersedesTool
          : undefined;
      const manifest: EvoToolManifest = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        runtime,
        entry_script: `run${getExtensionForRuntime(runtime)}`,
        input_schema: rawProposal.input_schema ?? baseTool?.input_schema ?? { type: 'object', properties: {} },
        self_test_args: rawProposal.self_test_args ?? baseTool?.self_test_args ?? {},
        timeout_ms: rawProposal.timeout_ms ?? baseTool?.timeout_ms ?? config.sandboxTimeoutMs,
        tags: toolTags.length > 0 ? toolTags : undefined,
        origin: rawProposal.origin || baseTool?.origin || 'evolved',
        supersedes_id: resolvedSupersedesId,
        hook_trigger: rawProposal.hook_trigger ?? baseTool?.hook_trigger,
        enabled:
          rawProposal.enabled !== undefined
            ? rawProposal.enabled === false
              ? false
              : true
            : baseTool?.enabled !== false,
        review_status:
          rawProposal.review_status === 'approved' || rawProposal.review_status === 'pending'
            ? rawProposal.review_status
            : (baseTool?.review_status || 'pending'),
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveTool(manifest, scriptCode);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');
      this.storage.appendProfileHistory({
        ts: now,
        action: existing || resolvedSupersedesId ? 'update' : 'add',
        id: cleanId,
        kind: 'tool',
        title: manifest.title,
        ...(rawProposal.batch_id ? { batch_id: rawProposal.batch_id } : {}),
        ...(prevSelfToolSnap?.files
          ? { previous_files: prevSelfToolSnap.files }
          : prevSupToolSnap?.files
            ? { previous_files: prevSupToolSnap.files }
            : {}),
        ...(resolvedSupersedesId ? { superseded_id: resolvedSupersedesId, superseded_kind: 'tool' as const } : {}),
        ...(prevSupToolSnap?.files ? { superseded_files: prevSupToolSnap.files } : {}),
        ...(prevSelfToolSnap?.files && resolvedSupersedesId
          ? { self_previous_files: prevSelfToolSnap.files }
          : {}),
        reason: resolvedSupersedesId
          ? `Superseded ${resolvedSupersedesId}`
          : existing
            ? 'Updated tool'
            : 'Added tool',
      });

      return done({
        passed: true,
        message: `Micro-Tool '${cleanId}' (${runtime}) passed syntax & sandbox self-test and is live via evo_run('${cleanId}').`,
        diagnostics: { id: cleanId, kind: 'tool', runtime },
      });
    }

    if (rawProposal.kind === 'memory') {
      const isPersonal = Boolean(ctx.isPersonalMemory);
      const symptom = resolvedSymptom;
      const rootCause = resolvedRootCause;
      const solution = resolvedSolution;
      const targetSymbols = isPersonal ? [] : normalizedTargetSymbols;
      const existing = ctx.memoryExisting;
      const baseMem = ctx.memoryBaseMem;
      const hasEmptyBaseFingerprints = Boolean(ctx.memoryHasEmptyBaseFingerprints);
      const preserveHistoricalAnchor = Boolean(ctx.memoryPreserveHistoricalAnchor);
      const liveHeadCommit = isPersonal ? 'personal' : (ctx.memoryLiveHeadCommit || '');

      const liveBranch = isPersonal
        ? undefined
        : ctx.memoryLiveHeadBranch !== undefined
          ? (ctx.memoryLiveHeadBranch || undefined)
          : resolveCurrentGitBranch(this.storage.rootDir);
      const currentCommit = isPersonal
        ? 'personal'
        : preserveHistoricalAnchor
          ? baseMem!.created_commit
          : liveHeadCommit;
      const explicitBranch =
        typeof rawProposal.created_branch === 'string' ? rawProposal.created_branch.trim() : '';
      const currentBranch = isPersonal
        ? undefined
        : preserveHistoricalAnchor
          ? explicitBranch || baseMem?.created_branch || liveBranch
          : explicitBranch || liveBranch;
      const finalMemoryFingerprints = isPersonal
        ? {}
        : preserveHistoricalAnchor
          ? hasEmptyBaseFingerprints
            ? {}
            : targetSymbols.every((s) => Boolean(baseMem!.ast_fingerprints[s]))
              ? baseMem!.ast_fingerprints
              : Object.fromEntries(
                  targetSymbols.map((s, idx) => [
                    s,
                    baseMem!.ast_fingerprints[s] ||
                      baseMem!.ast_fingerprints[baseMem!.target_symbols[idx]],
                  ])
                )
          : extractedMemoryFingerprints;

      if (options?.dryRun) {
        return done({
          passed: true,
          message: isPersonal
            ? `Dry-run: Personal Experience Memory '${cleanId}' passed Gatekeeper checks.`
            : `Dry-run: Episodic Memory '${cleanId}' passed AST Symbol Grounding.`,
          diagnostics: {
            id: cleanId,
            kind: 'memory',
            memory_type: isPersonal ? 'personal' : 'code',
            created_commit: currentCommit,
            created_branch: currentBranch,
            target_symbols: targetSymbols,
            ast_fingerprints: finalMemoryFingerprints,
          },
        });
      }

      let prevSelfMemSnapshot: string | undefined;
      let supersededMemSnapshot: string | undefined;
      const sanitizedSupMemId = rawProposal.supersedes_id ? sanitizeId(rawProposal.supersedes_id) : '';
      const crossSupMemId =
        sanitizedSupMemId && sanitizedSupMemId !== cleanId ? sanitizedSupMemId : '';
      if (existing) {
        const prevSelfPath = path.join(this.storage.memoriesDir, `${cleanId}.md`);
        if (fs.existsSync(prevSelfPath)) {
          try {
            prevSelfMemSnapshot = fs.readFileSync(prevSelfPath, 'utf8');
          } catch {}
        }
      }
      if (crossSupMemId) {
        const prevSupPath = path.join(this.storage.memoriesDir, `${crossSupMemId}.md`);
        if (fs.existsSync(prevSupPath)) {
          try {
            supersededMemSnapshot = fs.readFileSync(prevSupPath, 'utf8');
          } catch {}
        }
      }

      const preservedCreatedAt = baseMem?.created_at || options?.preservedCreatedAt || now;
      const correctionMetadata =
        this.telemetry.getSessionFlag('user_correction_detected') === 'true' ||
        this.telemetry.getSessionFlag('had_command_error') === 'true'
          ? { superseded_after_correction: true }
          : undefined;

      if (existing) {
        this.storage.archiveCapability(
          cleanId,
          'memory',
          'Updated by same-ID proposal',
          correctionMetadata
        );
      }
      if (rawProposal.supersedes_id && sanitizeId(rawProposal.supersedes_id) !== cleanId) {
        this.storage.archiveCapability(
          rawProposal.supersedes_id,
          'memory',
          `Superseded by ${cleanId}`,
          correctionMetadata
        );
      }

      const sanitizedSupersedesMemory = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const resolvedSupersedesId =
        sanitizedSupersedesMemory && sanitizedSupersedesMemory !== cleanId
          ? sanitizedSupersedesMemory
          : undefined;
      const memoryObj: EvoMemory = {
        id: cleanId,
        title: resolvedTitle.trim(),
        l0_summary: resolvedL0Summary.trim(),
        memory_type: isPersonal ? 'personal' : 'code',
        symptom,
        root_cause: rootCause,
        solution,
        target_symbols: targetSymbols,
        ast_fingerprints: finalMemoryFingerprints,
        created_commit: currentCommit,
        created_branch: currentBranch,
        tags: Array.isArray(rawProposal.tags) ? rawProposal.tags : (baseMem?.tags || []),
        origin: rawProposal.origin || baseMem?.origin || 'evolved',
        supersedes_id: resolvedSupersedesId,
        enabled:
          rawProposal.enabled !== undefined
            ? rawProposal.enabled === false
              ? false
              : true
            : baseMem?.enabled !== false,
        review_status:
          rawProposal.review_status === 'approved' || rawProposal.review_status === 'pending'
            ? rawProposal.review_status
            : (baseMem?.review_status || (isPersonal ? 'approved' : 'pending')),
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.saveMemory(memoryObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');

      const prevMemSnapshot = prevSelfMemSnapshot || supersededMemSnapshot;
      this.storage.appendProfileHistory({
        ts: now,
        action: existing || resolvedSupersedesId ? 'update' : 'add',
        id: cleanId,
        kind: 'memory',
        title: memoryObj.title,
        ...(rawProposal.batch_id ? { batch_id: rawProposal.batch_id } : {}),
        ...(prevMemSnapshot ? { previous_snapshot: prevMemSnapshot } : {}),
        ...(resolvedSupersedesId ? { superseded_id: resolvedSupersedesId } : {}),
        ...(supersededMemSnapshot ? { superseded_snapshot: supersededMemSnapshot } : {}),
        ...(prevSelfMemSnapshot && resolvedSupersedesId
          ? { self_previous_snapshot: prevSelfMemSnapshot }
          : {}),
        reason: resolvedSupersedesId
          ? `Superseded ${resolvedSupersedesId}`
          : existing
            ? (isPersonal ? 'Updated personal memory' : 'Updated memory')
            : (isPersonal ? 'Added personal memory' : 'Added memory'),
      });

      if (isPersonal) {
        return done({
          passed: true,
          message: `Personal Experience Memory '${cleanId}' passed Gatekeeper checks and is crystallized at .evo/memories/${cleanId}.md (0 core budget tokens used).`,
          diagnostics: {
            id: cleanId,
            kind: 'memory',
            memory_type: 'personal',
            created_commit: 'personal',
            target_symbols: [],
            ast_fingerprints: {},
          },
        });
      }

      return {
        done: false,
        cleanId,
        currentCommit,
        currentBranch,
        targetSymbols,
        finalMemoryFingerprints,
        preserveHistoricalAnchor,
      };
    }

    if (rawProposal.kind === 'preference') {
      const content = resolvedPrefContent;
      const category: PreferenceCategory = resolvedPrefCategory || 'style';
      const alwaysOn = resolvedPrefAlwaysOn !== false;
      const existing = this.storage.getPreference(cleanId);
      const supersededPref = rawProposal.supersedes_id
        ? this.storage.getPreference(sanitizeId(rawProposal.supersedes_id))
        : null;
      const basePref = existing ?? supersededPref;

      const newPrefTokens = estimateTokens(
        `- **[${cleanId}]** (${category}): ${rawProposal.l0_summary.trim()}\n  ${content.replace(/\n/g, '\n  ')}`
      );
      const candidateEnabled =
        rawProposal.enabled !== undefined
          ? rawProposal.enabled !== false
          : basePref?.enabled !== false;
      const prefTags = Array.isArray(rawProposal.tags)
        ? rawProposal.tags.map((t) => String(t).trim()).filter(Boolean)
        : (basePref?.tags || []);
      const prefOrigin = rawProposal.origin || basePref?.origin || 'evolved';

      if (alwaysOn) {
        const MAX_ATOMIC_PREF_TOKENS = 150;
        if (newPrefTokens > MAX_ATOMIC_PREF_TOKENS) {
          return done({
            passed: false,
            gate_failed: 'TOKEN_BUDGET',
            error_code: 'ERR_PROFILE_BUDGET_EXCEEDED',
            message: `Preference '${cleanId}' exceeds per-item atomic cap (${newPrefTokens} / ${MAX_ATOMIC_PREF_TOKENS} tokens). Condense the preference, pass 'supersedes_id', or set 'always_on: false' for on-demand notes/templates.`,
          });
        }

        const maxProfileTokens = config.maxGlobalProfileTokens ?? 800;
        const { preferences: existingPrefs } = this.storage.getProfileTokenUsage();
        const filteredPrefs = existingPrefs.filter((p) => !excludeSet.has(p.id));
        const candidatePrefForBudget: EvoPreference = {
          id: cleanId,
          title: rawProposal.title.trim(),
          l0_summary: rawProposal.l0_summary.trim(),
          category,
          always_on: true,
          content,
          tokens: newPrefTokens,
          tags: prefTags,
          origin: prefOrigin,
          enabled: candidateEnabled,
          created_at: now,
          updated_at: now,
        };
        const simulatedPrefs = candidateEnabled
          ? [...filteredPrefs, candidatePrefForBudget]
          : filteredPrefs;
        const simulatedDigest = formatUserProfileDigestForPreferences(simulatedPrefs);
        const effectiveCandidateTokens = simulatedDigest
          ? estimateTokens(renderUserProfileBlock(simulatedDigest, ''))
          : 0;

        if (effectiveCandidateTokens > maxProfileTokens) {
          const telemetryMap = this.telemetry.getTelemetryMap();
          const lowValueCandidates = filteredPrefs
            .map((p) => ({
              id: p.id,
              l0_summary: p.l0_summary,
              tokens: p.tokens,
              hit_count: telemetryMap.get(p.id)?.hit_count ?? 0,
            }))
            .sort((a, b) => a.hit_count - b.hit_count || b.tokens - a.tokens)
            .slice(0, 5);

          return done({
            passed: false,
            gate_failed: 'TOKEN_BUDGET',
            error_code: 'ERR_PROFILE_BUDGET_EXCEEDED',
            message: `Global profile token budget exceeded (${effectiveCandidateTokens} / ${maxProfileTokens} tokens). Pass 'supersedes_id' to replace an existing preference, call 'evo_compact' to merge preferences, or set 'always_on: false' for on-demand recall.`,
            low_value_candidates: lowValueCandidates,
          });
        }
      }

      if (options?.dryRun) {
        return done({
          passed: true,
          message: `Dry-run: Preference '${cleanId}' (${category}) passed all Gatekeeper checks (${newPrefTokens} tokens).`,
          ...(preferencePolarityWarning ? { warning: preferencePolarityWarning } : {}),
          diagnostics: {
            id: cleanId,
            kind: 'preference',
            category,
            always_on: alwaysOn,
            tokens: newPrefTokens,
          },
        });
      }

      let prevSelfPrefSnapshot: string | undefined;
      let supersededPrefSnapshot: string | undefined;
      const sanitizedSupersedesPref = rawProposal.supersedes_id
        ? sanitizeId(rawProposal.supersedes_id)
        : '';
      const crossSupPrefId =
        sanitizedSupersedesPref && sanitizedSupersedesPref !== cleanId
          ? sanitizedSupersedesPref
          : '';
      if (existing) {
        const prevSelfPath = path.join(this.storage.preferencesDir, `${cleanId}.md`);
        if (fs.existsSync(prevSelfPath)) {
          try {
            prevSelfPrefSnapshot = fs.readFileSync(prevSelfPath, 'utf8');
          } catch {}
        }
      }
      if (crossSupPrefId) {
        const prevSupPath = path.join(this.storage.preferencesDir, `${crossSupPrefId}.md`);
        if (fs.existsSync(prevSupPath)) {
          try {
            supersededPrefSnapshot = fs.readFileSync(prevSupPath, 'utf8');
          } catch {}
        }
      }

      const preservedCreatedAt = basePref?.created_at || options?.preservedCreatedAt || now;
      const correctionMetadata =
        this.telemetry.getSessionFlag('user_correction_detected') === 'true' ||
        this.telemetry.getSessionFlag('had_command_error') === 'true'
          ? { superseded_after_correction: true }
          : undefined;

      if (existing) {
        this.storage.archiveCapability(
          cleanId,
          'preference',
          'Updated by same-ID proposal',
          correctionMetadata
        );
      }
      if (sanitizedSupersedesPref && sanitizedSupersedesPref !== cleanId) {
        this.storage.archiveCapability(
          sanitizedSupersedesPref,
          'preference',
          `Superseded by ${cleanId}`,
          correctionMetadata
        );
      }
      const resolvedSupersedesId =
        sanitizedSupersedesPref && sanitizedSupersedesPref !== cleanId
          ? sanitizedSupersedesPref
          : undefined;

      const resolvedTriggerCue =
        typeof rawProposal.trigger_cue === 'string' && rawProposal.trigger_cue.trim()
          ? rawProposal.trigger_cue.trim()
          : basePref?.trigger_cue;

      const prefObj: EvoPreference = {
        id: cleanId,
        title: rawProposal.title.trim(),
        l0_summary: rawProposal.l0_summary.trim(),
        category,
        always_on: alwaysOn,
        ...(resolvedTriggerCue ? { trigger_cue: resolvedTriggerCue } : {}),
        content,
        tokens: newPrefTokens,
        tags: prefTags,
        origin: prefOrigin,
        supersedes_id: resolvedSupersedesId,
        enabled: candidateEnabled,
        review_status:
          rawProposal.review_status === 'approved' || rawProposal.review_status === 'pending'
            ? rawProposal.review_status
            : (basePref?.review_status || 'approved'),
        created_at: preservedCreatedAt,
        updated_at: now,
      };

      this.storage.savePreference(prefObj);
      this.telemetry.syncFromDisk();
      this.telemetry.setSessionFlag('pending_evolution', 'false');
      this.telemetry.setSessionFlag('last_crystallized_id', cleanId);
      this.telemetry.setSessionFlag('dirty_crystallized_id', '');
      const prevPrefSnapshot = prevSelfPrefSnapshot || supersededPrefSnapshot;
      this.storage.appendProfileHistory({
        ts: now,
        action: existing || resolvedSupersedesId ? 'update' : 'add',
        id: cleanId,
        kind: 'preference',
        title: prefObj.title,
        ...(rawProposal.batch_id ? { batch_id: rawProposal.batch_id } : {}),
        ...(prevPrefSnapshot ? { previous_snapshot: prevPrefSnapshot } : {}),
        ...(resolvedSupersedesId ? { superseded_id: resolvedSupersedesId } : {}),
        ...(supersededPrefSnapshot ? { superseded_snapshot: supersededPrefSnapshot } : {}),
        ...(prevSelfPrefSnapshot && resolvedSupersedesId
          ? { self_previous_snapshot: prevSelfPrefSnapshot }
          : {}),
        reason: resolvedSupersedesId
          ? `Superseded ${resolvedSupersedesId}`
          : existing
            ? 'Updated preference'
            : 'Added preference',
      });

      return done({
        passed: true,
        message: `Preference '${cleanId}' (${category}, always_on=${alwaysOn}) passed all Gatekeeper checks and is active (${newPrefTokens} tokens).`,
        ...(preferencePolarityWarning ? { warning: preferencePolarityWarning } : {}),
        diagnostics: {
          id: cleanId,
          kind: 'preference',
          category,
          always_on: alwaysOn,
          tokens: newPrefTokens,
        },
      });
    }

    return done({
      passed: false,
      gate_failed: 'SCHEMA_SECURITY',
      error_code: 'ERR_INVALID_SCHEMA',
      message: `Unsupported proposal kind: ${String(rawProposal.kind)}`,
    });
  }
}
