import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvoRule } from '../types.js';
import type { EvoStorage } from '../storage.js';
import { sanitizeId } from '../storage.js';

export function stripCaseAnchorLines(text: string): string {
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
    /(?<!\b(?:[Ss]tep|[Rr]ule|[Oo]ption|[Ii]tem|[Ss]ection|[Pp]art|[Pp]hase)\s*)\b\d+(?:\.\d+)?(?:A\b|\s*(?:k?V|mV|mA|kA|Amps?|Amperes?|k?W|k?VA|Hz|kHz|MHz|Ohm|degC|℃|%SOC)\b)/g,
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
  'trigger_cue',
  'confidence',
  'contrastive_evidence',
  'hook_trigger',
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

const STDLIB_ROOT_RECEIVERS = new Set([
  'Object',
  'Array',
  'Promise',
  'JSON',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Symbol',
  'BigInt',
  'Reflect',
  'Proxy',
  'RegExp',
  'Date',
  'Error',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Buffer',
  'URL',
  'URLSearchParams',
  'Intl',
  'Atomics',
  'WebAssembly',
  'console',
  'process',
  'fs',
  'path',
  'os',
  'crypto',
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
    const rootReceiver = callExpr.includes('.') ? callExpr.split('.')[0] : '';
    if (
      !/^(?:evo_|codegraph|import\.|process\.|fs\.|path\.|os\.)/i.test(callExpr) &&
      (!rootReceiver || !STDLIB_ROOT_RECEIVERS.has(rootReceiver))
    ) {
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
    if (isDottedMember && STDLIB_ROOT_RECEIVERS.has(ident.split('.')[0])) {
      continue;
    }
    if (isCamelOrPascal || isSnakeCase || isDottedMember) {
      found.add(ident);
    }
  }
  return Array.from(found);
}

function getBundledSeedEvoDir(): string | null {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    let curDir = path.dirname(currentFile);
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(curDir, 'templates', 'seed-evo');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const parent = path.dirname(curDir);
      if (parent === curDir) break;
      curDir = parent;
    }
  } catch {
    // ignore
  }
  return null;
}

function getGlobalEvoDir(): string | null {
  if (process.env.EVO_GLOBAL_DIR && fs.existsSync(process.env.EVO_GLOBAL_DIR)) {
    return path.resolve(process.env.EVO_GLOBAL_DIR);
  }
  const defaultGlobal = path.join(os.homedir(), '.evo', 'global', '.evo');
  if (fs.existsSync(defaultGlobal)) {
    return defaultGlobal;
  }
  const altGlobal = path.join(os.homedir(), '.evo', 'global');
  if (fs.existsSync(altGlobal)) {
    return altGlobal;
  }
  return null;
}

const IGNORED_REF_SET = new Set([
  'all',
  'rule',
  'rules',
  'skill',
  'skills',
  'tool',
  'tools',
  'memory',
  'memories',
  'l0',
  'l1',
  'l2',
  'scoped',
  'archive',
  'archived',
  'templates',
  'seed-evo',
  'global',
  'workspace',
  'example',
  'sample',
  'placeholder',
  'unknown',
  'temp',
]);

const PLACEHOLDER_PREFIXES = [
  'example-',
  'sample-',
  'my-',
  'foo-',
  'bar-',
  'test-',
  'dummy-',
  'old-',
  'legacy-',
  'target-',
  'your-',
  'some-',
  'new-',
];

function isIgnoredCapabilityRef(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.startsWith('ext__')) return true;
  if (IGNORED_REF_SET.has(lower)) return true;
  for (const prefix of PLACEHOLDER_PREFIXES) {
    if (lower.startsWith(prefix) || lower.startsWith(prefix.replace('-', '_'))) return true;
  }
  return false;
}

export function scanCapabilityReferences(text: string): string[] {
  if (!text) return [];
  const cleaned = stripCaseAnchorLines(text);
  const found = new Set<string>();

  const patterns = [
    /\bevo_run\(\s*\{?\s*(?:tool_id\s*:\s*)?["']([a-z0-9][a-z0-9_-]*)["']/gi,
    /\bevo_inspect\(\s*\{?\s*(?:id\s*:\s*)?["']([a-z0-9][a-z0-9_-]*)["']/gi,
    /\btool_id\s*:\s*["']([a-z0-9][a-z0-9_-]*)["']/gi,
    /\.evo[/\\](?:tools|skills|rules)(?:[/\\]scoped)?[/\\]([a-z0-9][a-z0-9_-]*?)(?:\.md(?=[^a-z0-9_-]|$)|(?=[^a-z0-9_-]|$))/gi,
  ];

  for (const regex of patterns) {
    for (const match of cleaned.matchAll(regex)) {
      const id = match[1];
      if (id && !isIgnoredCapabilityRef(id)) {
        found.add(id);
      }
    }
  }

  return Array.from(found);
}

function capabilityExistsInDirectory(dir: string, id: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const candidates = [dir];
  const dotEvo = path.join(dir, '.evo');
  if (fs.existsSync(dotEvo)) {
    candidates.push(dotEvo);
  }
  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, 'rules', `${id}.md`)) ||
      fs.existsSync(path.join(c, 'rules', 'scoped', `${id}.md`)) ||
      fs.existsSync(path.join(c, 'skills', id)) ||
      fs.existsSync(path.join(c, 'skills', id, 'SKILL.md')) ||
      fs.existsSync(path.join(c, 'tools', id)) ||
      fs.existsSync(path.join(c, 'tools', id, 'manifest.json')) ||
      fs.existsSync(path.join(c, 'memories', `${id}.md`))
    ) {
      return true;
    }
  }
  return false;
}

export function validateCapabilityReferences(
  text: string,
  storage: EvoStorage,
  extraKnownIds?: ReadonlySet<string>
): string[] {
  const referencedIds = scanCapabilityReferences(text);
  if (referencedIds.length === 0) return [];

  const missing: string[] = [];
  const seedEvoDir = getBundledSeedEvoDir();
  const globalEvoDir = getGlobalEvoDir();

  for (const rawId of referencedIds) {
    const id = sanitizeId(rawId);
    if (!id || isIgnoredCapabilityRef(id)) continue;

    // 0. Extra known IDs (e.g. self or supersedes_id)
    if (extraKnownIds && (extraKnownIds.has(id) || extraKnownIds.has(rawId))) {
      continue;
    }

    // Tier (a): Active storage
    if (
      storage.getRule(id) ||
      storage.getSkill(id) ||
      storage.getTool(id) ||
      storage.getMemory(id)
    ) {
      continue;
    }

    // Tier (b): Global fallback
    if (globalEvoDir && capabilityExistsInDirectory(globalEvoDir, id)) {
      continue;
    }

    // Tier (c): Bundled seed-evo
    if (seedEvoDir && capabilityExistsInDirectory(seedEvoDir, id)) {
      continue;
    }

    missing.push(rawId);
  }

  return missing;
}

export function scrubLocalUserPaths(text: string): string {
  if (!text) return '';
  return text
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\r\n"':<>|\s]+([\\/])?/gi, (_m, sep) => `<USER_HOME>${sep || ''}`)
    .replace(/(?<![A-Za-z0-9_:])\/(?:Users|home)\/[^\\/\r\n"':<>|\s]+(\/)?/g, (_m, sep) => `<USER_HOME>${sep || ''}`);
}

export function isGlobalFallbackRoot(rootDir: string): boolean {
  const norm = path.resolve(rootDir).replace(/\\/g, '/').toLowerCase();
  if (norm.endsWith('/.evo/global')) return true;
  if (process.env.EVO_GLOBAL_DIR) {
    const envNorm = path.resolve(process.env.EVO_GLOBAL_DIR).replace(/\\/g, '/').toLowerCase();
    if (norm === envNorm) return true;
  }
  return false;
}

export interface Gate1_5Violation {
  code:
    | 'ERR_SCOPE_TOO_NARROW'
    | 'ERR_POINT_BUG_CASE_LOG'
    | 'ERR_RULE_CONTAINS_DOMAIN_NUMBERS'
    | 'ERR_RULE_COUPLED_TO_IDENTIFIERS'
    | 'ERR_INSUFFICIENT_TRANSFER_SCENARIOS';
  message: string;
  details?: string[];
}

export function auditRuleGate1_5(rule: EvoRule): Gate1_5Violation[] {
  const violations: Gate1_5Violation[] = [];
  const cleanId = sanitizeId(rule.id);
  const scopeGlob = (rule.scope_glob || '**/*').trim();
  const isCoreRule = Boolean(rule.core ?? false);
  const bodyForLexicalAudit = stripCaseAnchorLines(
    `${rule.l0_summary}\n${rule.content}`
  );

  // 1. Reject single-file literal scope_glob without wildcards (Issue #4 Problem 1)
  if (scopeGlob !== '**/*' && !/[*?[\]{}]/.test(scopeGlob)) {
    violations.push({
      code: 'ERR_SCOPE_TOO_NARROW',
      message: `Scope '${scopeGlob}' targets a single literal file without glob wildcards (*, ?, {}). Single-file bug fixes belong in Episodic Memory or must be abstracted 1-level-up to a subsystem pattern.`,
    });
  }

  // 2. Reject point-bug case logs / commit logs disguised as rules (Issue #4 Problem 1 & Issue #6)
  const isPointBugCaseLog =
    /-(?:bug|defect|hotfix|crash)$/i.test(cleanId) ||
    /\b(?:fixed in commit|root cause in commit|regression in commit)\s+[0-9a-f]{7,40}\b/i.test(
      bodyForLexicalAudit
    ) ||
    /\b(?:historical fix commits analyzed|fix commits analyzed|\d+\s+commits analyzed)\b/i.test(
      bodyForLexicalAudit
    ) ||
    /\b[0-9a-f]{7,40}\s+(?:fix|feat|chore|refactor|docs|test|hotfix|revert)\b/i.test(
      bodyForLexicalAudit
    );

  if (isPointBugCaseLog) {
    violations.push({
      code: 'ERR_POINT_BUG_CASE_LOG',
      message: `Rule proposal '${cleanId}' reads like a point-bug postmortem or commit log rather than a reusable architectural guardrail. Use kind: 'memory' (with symptom, root_cause, solution, target_symbols) to record specific bug cases at 0 core token cost, or abstract the rule 1-level-up into a general class invariant.`,
    });
  }

  // 3. Reject hardcoded domain/physical parameter thresholds in rule body (Issue #6 Layer 1)
  const domainNumbers = detectDomainNumbersInRule(bodyForLexicalAudit);
  if (domainNumbers.length >= 2) {
    violations.push({
      code: 'ERR_RULE_CONTAINS_DOMAIN_NUMBERS',
      message: `Lexical De-Symbolization Gate blocked rule '${cleanId}': detected hardcoded domain/physical parameter thresholds (${domainNumbers.slice(0, 4).join(', ')}). Code is the Single Source of Truth (SSOT) for concrete thresholds and magic numbers; rules must express the verification methodology or move concrete case parameters into kind: 'memory' / a single 'Case Anchor:' line.`,
      details: domainNumbers,
    });
  }

  // 4. Reject rules coupled to >= 3 concrete project identifiers/macros (Issue #6 Layer 1 & Module 7.1)
  const coupledIdentifiers = detectCoupledIdentifiersInRule(bodyForLexicalAudit);
  if (coupledIdentifiers.length >= 3) {
    violations.push({
      code: 'ERR_RULE_COUPLED_TO_IDENTIFIERS',
      message: `Lexical De-Symbolization Gate blocked rule '${cleanId}': main body is tightly coupled to concrete project identifiers (${coupledIdentifiers.slice(0, 5).join(', ')}). Replace specific variable/macro names with architectural domain concepts in the rule body, and either use kind: 'memory' (with target_symbols) or isolate concrete symbols inside a 'Case Anchor:' line / '## 典型反例锚点' section.`,
      details: coupledIdentifiers,
    });
  }

  // 5. Require transfer_scenarios >= 2 on scoped rules (Issue #6 Layer 2 & Module 7.2)
  const isScopedRule = !isCoreRule;
  if (isScopedRule || (rule.transfer_scenarios && rule.transfer_scenarios.length > 0)) {
    const validScenarios = Array.isArray(rule.transfer_scenarios)
      ? Array.from(
          new Set(
            rule.transfer_scenarios
              .map((s) => String(s).trim())
              .filter((s) => s.length >= 8)
          )
        )
      : [];
    if (validScenarios.length < 2) {
      violations.push({
        code: 'ERR_INSUFFICIENT_TRANSFER_SCENARIOS',
        message: `Transferability Gate blocked rule '${cleanId}': 'transfer_scenarios' is required for new non-core/scoped rules and must provide at least 2 distinct cross-module/cross-scenario applications (>= 8 chars each) proving the rule is not overfitted to a single bug location.`,
      });
    }
  }

  return violations;
}

export function extractActionableClauses(text: string): string[] {
  if (!text) return [];
  const cleaned = stripCaseAnchorLines(text);
  const lines = cleaned.split(/\r?\n/);
  const clauses: string[] = [];
  let currentClause: string[] = [];

  const isClauseStart = (line: string): boolean => {
    return /^\s*(?:(?:\(\d+\)|\d+[.)])|[-*+]|#{1,4})\s+/.test(line);
  };

  const hasStructuredMarkers = lines.some((l) => isClauseStart(l));

  if (hasStructuredMarkers) {
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (currentClause.length > 0) {
          clauses.push(currentClause.join(' ').trim());
          currentClause = [];
        }
        continue;
      }

      if (isClauseStart(rawLine)) {
        if (currentClause.length > 0) {
          clauses.push(currentClause.join(' ').trim());
          currentClause = [];
        }
        currentClause.push(line);
      } else if (currentClause.length > 0) {
        currentClause.push(line);
      }
    }

    if (currentClause.length > 0) {
      clauses.push(currentClause.join(' ').trim());
    }
    return clauses;
  }

  // Fallback for plain paragraph rules without list/heading markers
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentClause.length > 0) {
        clauses.push(currentClause.join(' ').trim());
        currentClause = [];
      }
      continue;
    }
    currentClause.push(line);
  }
  if (currentClause.length > 0) {
    clauses.push(currentClause.join(' ').trim());
  }

  if (clauses.length === 1) {
    const splitSentences = clauses[0]
      .split(/(?<=[.!?。；;])\s+|(?<=[。；])/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 6);
    if (splitSentences.length > 1) {
      return splitSentences;
    }
  }

  return clauses;
}

export const CLAUSE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'when', 'from', 'that', 'this',
  'must', 'always', 'never', 'use', 'rule', 'code', 'should',
  'into', 'than', 'then', 'each', 'have', 'been', 'which', 'their',
  'clause', 'step', 'item', 'check', 'ensure', 'verify',
  'before', 'after', 'only', 'first', 'second', 'third',
  'inputs', 'outputs',
]);

export function normalizeClauseText(clause: string): string {
  return clause
    .replace(/^\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:\(?\d+(?:\.\d+)*[.:)]?|(?:step|clause|item)\s+\d+[.:]?)\s*/i, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/[.,:;!?]+$/, '')
    .trim()
    .toLowerCase();
}

export function tokenizeClauseText(clause: string): Set<string> {
  const stripped = normalizeClauseText(clause);
  const tokens = new Set<string>();
  const asciiWords = stripped.match(/[a-z0-9_]+/g) || [];
  for (const w of asciiWords) {
    if (!CLAUSE_STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      tokens.add(w);
    }
  }
  const cjkRuns = stripped.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.add(run);
    } else {
      for (let i = 0; i <= run.length - 2; i++) {
        tokens.add(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

export function calculateClauseSimilarity(
  tokensA: Set<string>,
  tokensB: Set<string>,
  textA: string,
  textB: string
): number {
  const normA = normalizeClauseText(textA);
  const normB = normalizeClauseText(textB);
  if (normA.length > 0 && normA === normB) {
    return 1.0;
  }
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0.0;
  }
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      shared++;
    }
  }
  if (shared === 0) return 0.0;
  const jaccard = shared / (tokensA.size + tokensB.size - shared);
  return jaccard;
}

export function compareRuleClauses(
  oldClauses: string[],
  newClauses: string[]
): {
  removed: string[];
  preserved: string[];
  added: string[];
} {
  const oldTokenSets = oldClauses.map((c) => ({
    text: c,
    tokens: tokenizeClauseText(c),
  }));
  const newTokenSets = newClauses.map((c) => ({
    text: c,
    tokens: tokenizeClauseText(c),
  }));

  interface CandidatePair {
    oldIdx: number;
    newIdx: number;
    sim: number;
  }

  const candidates: CandidatePair[] = [];
  for (let i = 0; i < oldTokenSets.length; i++) {
    for (let j = 0; j < newTokenSets.length; j++) {
      const sim = calculateClauseSimilarity(
        oldTokenSets[i].tokens,
        newTokenSets[j].tokens,
        oldTokenSets[i].text,
        newTokenSets[j].text
      );
      if (sim >= 0.40) {
        candidates.push({ oldIdx: i, newIdx: j, sim });
      }
    }
  }

  // Sort candidate pairs in descending order of similarity.
  // Greedily match pairs ensuring that each old clause is matched to at most ONE new clause,
  // and each new clause is matched to at most ONE old clause.
  candidates.sort(
    (a, b) =>
      b.sim - a.sim ||
      Math.abs(a.oldIdx - a.newIdx) - Math.abs(b.oldIdx - b.newIdx) ||
      a.oldIdx - b.oldIdx ||
      a.newIdx - b.newIdx
  );

  const matchedOldIndices = new Set<number>();
  const matchedNewIndices = new Set<number>();

  for (const pair of candidates) {
    if (matchedOldIndices.has(pair.oldIdx) || matchedNewIndices.has(pair.newIdx)) {
      continue;
    }
    matchedOldIndices.add(pair.oldIdx);
    matchedNewIndices.add(pair.newIdx);
  }

  // Strict Invariant: preserved.length <= Math.min(oldClauses.length, newClauses.length)
  if (matchedOldIndices.size > Math.min(oldClauses.length, newClauses.length)) {
    throw new Error(
      `Invariant violation in compareRuleClauses: matched count ${matchedOldIndices.size} exceeds min(${oldClauses.length}, ${newClauses.length})`
    );
  }

  const preserved: string[] = [];
  const removed: string[] = [];
  for (let i = 0; i < oldClauses.length; i++) {
    if (matchedOldIndices.has(i)) {
      preserved.push(oldClauses[i]);
    } else {
      removed.push(oldClauses[i]);
    }
  }

  const added: string[] = [];
  for (let j = 0; j < newClauses.length; j++) {
    if (!matchedNewIndices.has(j)) {
      added.push(newClauses[j]);
    }
  }

  return { removed, preserved, added };
}
