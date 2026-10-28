import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// 1. Argument parsing & environment resolution
let evoArgs = {};
try {
  if (process.env.EVO_ARGS) {
    evoArgs = JSON.parse(process.env.EVO_ARGS);
  }
} catch {
  // ignore json parse errors
}
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('{') && arg.endsWith('}')) {
    try {
      Object.assign(evoArgs, JSON.parse(arg));
    } catch {
      // ignore
    }
  }
}

const isSelfTest =
  process.env.EVO_SELF_TEST === '1' ||
  process.argv.includes('--self-test') ||
  Boolean(evoArgs['--self-test'] || evoArgs.self_test);

const root = process.env.EVO_WORKSPACE || process.cwd();

// 2. Token estimation helper (matches EvoKernel storage estimateTokens)
function estimateTokens(text) {
  if (!text) return 0;
  let cjkCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjkCount++;
    }
  }
  const nonCjkLength = Math.max(0, text.length - cjkCount);
  return Math.ceil(cjkCount * 0.7 + nonCjkLength / 3.8);
}

// 3. Frontmatter parser helper
function parseFrontmatter(raw) {
  const sanitized = raw.replace(/^\uFEFF/, '');
  const match = sanitized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: sanitized };
  }
  const yamlBlock = match[1];
  const body = match[2];
  const meta = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    try {
      meta[key] = JSON.parse(rawVal);
    } catch {
      meta[key] = rawVal;
    }
  }
  return { meta, body };
}

// 4. Case Anchor stripper helper (for Gate 1.5 rule audit)
function stripCaseAnchorLines(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
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

function detectDomainNumbersInRule(text) {
  const found = new Set();
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

function detectCoupledIdentifiersInRule(text) {
  const found = new Set();
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
      !ALLOWED_META_IDENTIFIERS.has(token) &&
      !/^(?:EVO_|ERR_|NODE_|AST_|MCP_|CLI_|L0_|L1_|L2_|SSOT_|SOP_|BM25_|FTS5_|JSON_|UTF_|SQLITE_|HTTP_|GATE_)/.test(
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

// -------------------------------------------------------------------------
// Audit 1: Host Rule Token Budgets
// -------------------------------------------------------------------------
const ruleFiles = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'rules/AGENTS.md',
  '.cursor/rules/evo-kernel.mdc',
  '.evo/rules/core-invariants.md',
];
let configuredBudgetLimit = 1500;
const localConfigFile = path.join(root, '.evo', 'config.json');
if (fs.existsSync(localConfigFile)) {
  try {
    const parsedCfg = JSON.parse(fs.readFileSync(localConfigFile, 'utf8'));
    if (typeof parsedCfg.maxCoreRuleTokens === 'number' && parsedCfg.maxCoreRuleTokens > 0) {
      configuredBudgetLimit = parsedCfg.maxCoreRuleTokens;
    }
  } catch {}
}
const MAX_TOOLS_CATALOG_TOKENS = 350;

function resolveBaseSeedTokens(markerBlock = '') {
  const metaRulePath = path.join(root, 'src', 'templates', 'meta-rule.ts');
  if (fs.existsSync(metaRulePath)) {
    try {
      const tsSrc = fs.readFileSync(metaRulePath, 'utf8');
      const m = tsSrc.match(/L0_META_RULE_SEED\s*=\s*`([\s\S]*?)`;/);
      if (m) {
        const unescaped = m[1]
          .replace(/\\`/g, '`')
          .replace(/\\\$/g, '$')
          .replace(/\r?\n/g, '\n')
          .trim();
        return estimateTokens(`${unescaped}\n`);
      }
    } catch {}
  }
  if (markerBlock && markerBlock.includes('# EvoKernel L0 Meta-Rule Seed')) {
    const seedOnly =
      markerBlock
        .replace(/\r?\n/g, '\n')
        .replace(/\n\n## 4\. Evolved Core Invariants[\s\S]*?(?=\n\n### 5\.|\n<!-- EVO:END -->)/, '')
        .replace(/\n\n### 5\.[\s\S]*?(?=\n<!-- EVO:END -->)/, '') + '\n';
    return estimateTokens(seedOnly);
  }
  return 1137;
}

const tokenAudit = [];
const budgetViolations = [];
for (const rel of ruleFiles) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) {
    const text = fs.readFileSync(full, 'utf8');
    const markerMatch = text.match(/<!-- EVO:START -->[\s\S]*?<!-- EVO:END -->/);
    const measuredText = markerMatch ? markerMatch[0] : text;
    const tokens = estimateTokens(measuredText);
    const baseSeedTokens = resolveBaseSeedTokens(markerMatch ? markerMatch[0] : '');
    const managedBlockBudgetLimit =
      configuredBudgetLimit + baseSeedTokens + MAX_TOOLS_CATALOG_TOKENS;
    const effectiveLimit = markerMatch ? managedBlockBudgetLimit : configuredBudgetLimit;
    const healthy = tokens <= effectiveLimit;
    const entry = {
      file: rel,
      bytes: Buffer.byteLength(measuredText, 'utf8'),
      estimated_tokens: tokens,
      budget_limit: effectiveLimit,
      status: healthy ? 'HEALTHY' : 'OVER_BUDGET',
    };
    tokenAudit.push(entry);
    if (!healthy) {
      budgetViolations.push(entry);
    }
  }
}

// -------------------------------------------------------------------------
// Audit 2: Retroactive Gate 1.5 Rule Compliance Audit
// -------------------------------------------------------------------------
const gateViolations = [];
const rulesDir = path.join(root, '.evo', 'rules');

function auditRuleFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const id = String(meta.id || path.basename(filePath, '.md'));
  const isCore = Boolean(meta.core === true || meta.core === 'true');
  const scopeGlob = String(meta.scope_glob || '**/*').trim();
  const bodyForAudit = stripCaseAnchorLines(`${meta.l0_summary || ''}\n${body}`);

  const violations = [];

  // Scope check
  if (scopeGlob !== '**/*' && !/[*?[\]{}]/.test(scopeGlob)) {
    violations.push({
      code: 'ERR_SCOPE_TOO_NARROW',
      detail: `Scope '${scopeGlob}' targets a single literal file without wildcards.`,
    });
  }

  // Commit log check
  const isPointBugCaseLog =
    /-(?:bug|defect|hotfix|crash)$/i.test(id) ||
    /\b(?:fixed in commit|root cause in commit|regression in commit)\s+[0-9a-f]{7,40}\b/i.test(
      bodyForAudit
    ) ||
    /\b(?:historical fix commits analyzed|fix commits analyzed|\d+\s+commits analyzed)\b/i.test(
      bodyForAudit
    ) ||
    /\b[0-9a-f]{7,40}\s+(?:fix|feat|chore|refactor|docs|test|hotfix|revert)\b/i.test(
      bodyForAudit
    );
  if (isPointBugCaseLog) {
    violations.push({
      code: 'ERR_POINT_BUG_CASE_LOG',
      detail: `Rule proposal '${id}' reads like a point-bug postmortem or commit log.`,
    });
  }

  // Domain numbers check
  const domainNumbers = detectDomainNumbersInRule(bodyForAudit);
  if (domainNumbers.length >= 2) {
    violations.push({
      code: 'ERR_RULE_CONTAINS_DOMAIN_NUMBERS',
      detail: `Detected hardcoded parameter thresholds (${domainNumbers.slice(0, 4).join(', ')}).`,
    });
  }

  // Coupled identifiers check
  const coupled = detectCoupledIdentifiersInRule(bodyForAudit);
  if (coupled.length >= 3) {
    violations.push({
      code: 'ERR_RULE_COUPLED_TO_IDENTIFIERS',
      detail: `Coupled to concrete identifiers (${coupled.slice(0, 5).join(', ')}).`,
    });
  }

  // Transfer scenarios check on scoped rules
  if (!isCore || (meta.transfer_scenarios && meta.transfer_scenarios.length > 0)) {
    const scenarios = Array.isArray(meta.transfer_scenarios)
      ? meta.transfer_scenarios.filter((s) => String(s).trim().length >= 8)
      : [];
    if (scenarios.length < 2) {
      violations.push({
        code: 'ERR_INSUFFICIENT_TRANSFER_SCENARIOS',
        detail: `transfer_scenarios must provide >= 2 distinct items (>= 8 chars each).`,
      });
    }
  }

  return { id, file: path.relative(root, filePath).replace(/\\/g, '/'), violations };
}

const ruleAuditResults = [];
if (fs.existsSync(rulesDir)) {
  const scanRuleDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanRuleDir(full);
      } else if (ent.isFile() && ent.name.endsWith('.md') && ent.name !== 'core-invariants.md') {
        const res = auditRuleFile(full);
        ruleAuditResults.push(res);
        if (res.violations.length > 0) {
          gateViolations.push(res);
        }
      }
    }
  };
  scanRuleDir(rulesDir);
}

// -------------------------------------------------------------------------
// Audit 3: Memory AST Target Symbol Verification Audit
// -------------------------------------------------------------------------
const memoriesDir = path.join(root, '.evo', 'memories');
const memoryAuditResults = [];
const brokenSymbols = [];

function canPrecedeRegexLiteral(out) {
  const trimmed = out.trimEnd();
  if (!trimmed) return true;
  if (trimmed.endsWith('++') || trimmed.endsWith('--')) return false;
  const lastChar = trimmed[trimmed.length - 1];
  if ('=(:[{,;!&|?^~<>+-*%'.includes(lastChar)) return true;
  return /(?:^|[^\w$])(return|case|throw|yield|await|typeof|delete|void|default|do|else|in|instanceof|of)$/.test(
    trimmed
  );
}

function stripCodeComments(input) {
  if (!input) return '';
  let out = '';
  let i = 0;
  const len = input.length;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  const templateBraceStack = [];

  while (i < len) {
    const ch = input[i];
    const next = i + 1 < len ? input[i + 1] : '';

    if (inSingle) {
      if (ch === '\\' && i + 1 < len) {
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && i + 1 < len) {
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (inTemplate) {
      if (ch === '\\' && i + 1 < len) {
        i += 2;
        continue;
      }
      if (ch === '$' && next === '{') {
        inTemplate = false;
        templateBraceStack.push(0);
        out += ' ';
        i += 2;
        continue;
      }
      if (ch === '`') inTemplate = false;
      i++;
      continue;
    }

    if (templateBraceStack.length > 0) {
      if (ch === '{') {
        templateBraceStack[templateBraceStack.length - 1]++;
      } else if (ch === '}') {
        if (templateBraceStack[templateBraceStack.length - 1] === 0) {
          templateBraceStack.pop();
          inTemplate = true;
          out += ' ';
          i++;
          continue;
        }
        templateBraceStack[templateBraceStack.length - 1]--;
      }
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && input[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < len && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }

    if (ch === '/' && canPrecedeRegexLiteral(out)) {
      out += ch;
      i++;
      let inCharClass = false;
      while (i < len) {
        const rCh = input[i];
        if (rCh === '\\' && i + 1 < len) {
          out += rCh + input[i + 1];
          i += 2;
          continue;
        }
        if (rCh === '[') {
          inCharClass = true;
          out += rCh;
          i++;
          continue;
        }
        if (rCh === ']' && inCharClass) {
          inCharClass = false;
          out += rCh;
          i++;
          continue;
        }
        if (rCh === '/' && !inCharClass) {
          out += rCh;
          i++;
          while (i < len && /[a-z]/i.test(input[i])) {
            out += input[i];
            i++;
          }
          break;
        }
        if (rCh === '\n') break;
        out += rCh;
        i++;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += ' ';
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ' ';
      i++;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      out += ' ';
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function hasSymbolIdentifier(codeWithoutComments, symbolName) {
  if (!symbolName) return false;
  if (symbolName.includes('.')) {
    const parts = symbolName
      .split('.')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0 && parts.every((p) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p))) {
      return parts.every((p) => {
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`).test(codeWithoutComments);
      });
    }
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbolName)) {
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(codeWithoutComments);
  }
  return codeWithoutComments.includes(symbolName);
}

function resolveAuditorCurrentBranch() {
  try {
    const res = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 1500,
    });
    if (res.status === 0 && res.stdout) {
      const b = res.stdout.trim();
      return b && b !== 'HEAD' ? b : '';
    }
  } catch {}
  return '';
}

const auditorCurrentBranch = resolveAuditorCurrentBranch();

function checkSymbolAtParallelBranchCommit(
  commitSha,
  createdBranch,
  fileCandidate,
  symbolName,
  isWholeFile
) {
  if (!fileCandidate || fileCandidate === '(unlocated)' || fileCandidate === '(unrecorded)') {
    return false;
  }
  const cleanRel = fileCandidate.replace(/^[/\\]+/, '').replace(/\\/g, '/');

  const checkGitRef = (ref) => {
    try {
      const showRes = spawnSync('git', ['show', `${ref}:${cleanRel}`], {
        cwd: root,
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (showRes.status !== 0 || typeof showRes.stdout !== 'string') return false;
      if (isWholeFile) return true;
      const code = stripCodeComments(showRes.stdout);
      return hasSymbolIdentifier(code, symbolName);
    } catch {
      return false;
    }
  };

  if (commitSha && commitSha !== 'uncommitted' && /^[0-9a-f]{4,40}$/i.test(String(commitSha).trim())) {
    const sha = String(commitSha).trim();
    try {
      const catRes = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
        cwd: root,
        encoding: 'utf8',
        timeout: 1500,
      });
      if (catRes.status === 0) {
        const ancRes = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
          timeout: 1500,
        });
        if (ancRes.status !== 0 && checkGitRef(sha)) {
          return true;
        }
      }
    } catch {}
  }

  const branchClean = String(createdBranch || '').trim();
  if (
    branchClean &&
    branchClean !== 'HEAD' &&
    branchClean !== auditorCurrentBranch &&
    !branchClean.includes('..') &&
    !branchClean.startsWith('-')
  ) {
    try {
      const branchCat = spawnSync('git', ['cat-file', '-e', `${branchClean}^{commit}`], {
        cwd: root,
        encoding: 'utf8',
        timeout: 1500,
      });
      if (branchCat.status === 0 && checkGitRef(branchClean)) {
        return true;
      }
    } catch {}
  }

  return false;
}

function checkSymbolInWorkspace(rawSpec, createdCommit = '', recordedFilePath = '', createdBranch = '') {
  const spec = rawSpec.trim();
  const hashIdx = spec.indexOf('#');
  let fileHint = '';
  let symbolName = spec;
  let isWholeFile = false;
  if (hashIdx !== -1) {
    fileHint = spec.slice(0, hashIdx).trim().replace(/^[/\\]+/, '');
    symbolName = spec.slice(hashIdx + 1).trim();
  } else {
    const colonIdx = spec.indexOf(':', 2);
    if (colonIdx !== -1 && /\.[a-z0-9]+$/i.test(spec.slice(0, colonIdx).trim())) {
      fileHint = spec.slice(0, colonIdx).trim().replace(/^[/\\]+/, '');
      symbolName = spec.slice(colonIdx + 1).trim();
    } else {
      const cleanFileCandidate = spec.replace(/^[/\\]+/, '');
      if (/\.[a-z0-9]+$/i.test(cleanFileCandidate) && !cleanFileCandidate.includes(' ')) {
        isWholeFile = true;
        fileHint = cleanFileCandidate;
      }
      const fullCandidate = path.resolve(root, cleanFileCandidate);
      if (fs.existsSync(fullCandidate) && fs.statSync(fullCandidate).isFile()) {
        return { exists: true, file: cleanFileCandidate.replace(/\\/g, '/') };
      }
    }
  }

  if (fileHint) {
    const normalizedHint = fileHint.replace(/\\/g, '/');
    const fullHint = path.resolve(root, fileHint);
    if (fs.existsSync(fullHint) && fs.statSync(fullHint).isFile()) {
      if (isWholeFile) {
        return { exists: true, file: normalizedHint };
      }
      const content = stripCodeComments(fs.readFileSync(fullHint, 'utf8'));
      if (hasSymbolIdentifier(content, symbolName)) {
        return {
          exists: true,
          file: normalizedHint,
        };
      }
    }
    if (
      checkSymbolAtParallelBranchCommit(
        createdCommit,
        createdBranch,
        normalizedHint,
        symbolName,
        isWholeFile
      )
    ) {
      return {
        exists: true,
        branch_scoped: true,
        file: normalizedHint,
      };
    }
    return { exists: false, file: normalizedHint };
  }

  // Fallback: search non-test source files in workspace
  const srcDirs = ['src', 'lib'];
  for (const sd of srcDirs) {
    const fullSd = path.join(root, sd);
    if (!fs.existsSync(fullSd)) continue;
    const stack = [fullSd];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
        const entPath = path.join(current, ent.name);
        if (ent.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build', '.evo', 'tests', '__tests__'].includes(ent.name)) {
            stack.push(entPath);
          }
        } else if (
          ent.isFile() &&
          /\.(?:ts|js|mjs|cjs|c|h|cpp|py)$/i.test(ent.name) &&
          !/\.(?:test|spec)\.[a-z0-9]+$/i.test(ent.name)
        ) {
          try {
            const code = stripCodeComments(fs.readFileSync(entPath, 'utf8'));
            if (hasSymbolIdentifier(code, symbolName)) {
              return { exists: true, file: path.relative(root, entPath).replace(/\\/g, '/') };
            }
          } catch {}
        }
      }
    }
  }

  if (
    recordedFilePath &&
    checkSymbolAtParallelBranchCommit(createdCommit, createdBranch, recordedFilePath, symbolName, false)
  ) {
    return {
      exists: true,
      branch_scoped: true,
      file: recordedFilePath.replace(/\\/g, '/'),
    };
  }

  return { exists: false, file: fileHint || recordedFilePath || '(unlocated)' };
}

if (fs.existsSync(memoriesDir)) {
  for (const ent of fs.readdirSync(memoriesDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.md')) {
      const full = path.join(memoriesDir, ent.name);
      const raw = fs.readFileSync(full, 'utf8');
      const { meta } = parseFrontmatter(raw);
      const id = String(meta.id || path.basename(ent.name, '.md'));
      const createdCommit = String(meta.created_commit || '');
      const createdBranch = String(meta.created_branch || '');
      const fingerprints =
        meta.ast_fingerprints && typeof meta.ast_fingerprints === 'object'
          ? meta.ast_fingerprints
          : {};
      const targetSymbols = Array.isArray(meta.target_symbols) ? meta.target_symbols : [];
      const checkedSymbols = [];

      for (const sym of targetSymbols) {
        const recordedFp = fingerprints[String(sym)];
        const recordedFile = recordedFp && typeof recordedFp.file_path === 'string' ? recordedFp.file_path : '';
        const check = checkSymbolInWorkspace(String(sym), createdCommit, recordedFile, createdBranch);
        checkedSymbols.push({
          symbol: sym,
          exists: check.exists,
          ...(check.branch_scoped ? { branch_scoped: true } : {}),
          file: check.file,
        });
        if (!check.exists) {
          brokenSymbols.push({ memoryId: id, symbol: sym, file: check.file });
        }
      }

      memoryAuditResults.push({
        id,
        file: path.relative(root, full).replace(/\\/g, '/'),
        symbols_count: targetSymbols.length,
        verified_count: checkedSymbols.filter((s) => s.exists).length,
        symbols: checkedSymbols,
      });
    }
  }
}

// -------------------------------------------------------------------------
// Audit 4: Version/Content Divergence (Split-Brain) Audit
// -------------------------------------------------------------------------
const globalHome = process.env.EVO_GLOBAL_DIR
  ? path.resolve(process.env.EVO_GLOBAL_DIR)
  : path.join(os.homedir(), '.evo', 'global');
const globalEvoDir = fs.existsSync(path.join(globalHome, '.evo'))
  ? path.join(globalHome, '.evo')
  : globalHome;

const splitBrainDivergences = [];

if (fs.existsSync(globalEvoDir)) {
  // Compare rules
  const compareRuleContent = (localPath, globalPath, ruleId) => {
    if (!fs.existsSync(localPath) || !fs.existsSync(globalPath)) return;
    const localRaw = fs.readFileSync(localPath, 'utf8');
    const globalRaw = fs.readFileSync(globalPath, 'utf8');
    const localParsed = parseFrontmatter(localRaw);
    const globalParsed = parseFrontmatter(globalRaw);

    // Normalize bodies
    const localBody = localParsed.body.replace(/\r?\n/g, '\n').trim();
    const globalBody = globalParsed.body.replace(/\r?\n/g, '\n').trim();

    if (localBody !== globalBody) {
      splitBrainDivergences.push({
        capability: 'rule',
        id: ruleId,
        local_path: path.relative(root, localPath).replace(/\\/g, '/'),
        global_path: globalPath,
        reason: 'Rule content / actionable clauses diverge between local and global trees.',
      });
    }
  };

  const localRulesDir = path.join(root, '.evo', 'rules');
  const globalRulesDir = path.join(globalEvoDir, 'rules');
  if (fs.existsSync(localRulesDir) && fs.existsSync(globalRulesDir)) {
    const checkDir = (locSub, globSub) => {
      if (!fs.existsSync(locSub) || !fs.existsSync(globSub)) return;
      for (const ent of fs.readdirSync(locSub, { withFileTypes: true })) {
        if (ent.isFile() && ent.name.endsWith('.md') && ent.name !== 'core-invariants.md') {
          const locFile = path.join(locSub, ent.name);
          const globFile = path.join(globSub, ent.name);
          if (fs.existsSync(globFile)) {
            compareRuleContent(locFile, globFile, path.basename(ent.name, '.md'));
          }
        }
      }
    };
    checkDir(localRulesDir, globalRulesDir);
    checkDir(path.join(localRulesDir, 'scoped'), path.join(globalRulesDir, 'scoped'));
  }

  // Compare skills
  const localSkillsDir = path.join(root, '.evo', 'skills');
  const globalSkillsDir = path.join(globalEvoDir, 'skills');
  if (fs.existsSync(localSkillsDir) && fs.existsSync(globalSkillsDir)) {
    for (const ent of fs.readdirSync(localSkillsDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const locSkill = path.join(localSkillsDir, ent.name, 'SKILL.md');
        const globSkill = path.join(globalSkillsDir, ent.name, 'SKILL.md');
        if (fs.existsSync(locSkill) && fs.existsSync(globSkill)) {
          const locParsed = parseFrontmatter(fs.readFileSync(locSkill, 'utf8'));
          const globParsed = parseFrontmatter(fs.readFileSync(globSkill, 'utf8'));
          const locBody = locParsed.body.replace(/\r?\n/g, '\n').trim();
          const globBody = globParsed.body.replace(/\r?\n/g, '\n').trim();
          if (locBody !== globBody) {
            splitBrainDivergences.push({
              capability: 'skill',
              id: ent.name,
              local_path: path.relative(root, locSkill).replace(/\\/g, '/'),
              global_path: globSkill,
              reason: 'Skill SOP body diverges between local and global trees.',
            });
          }
        }
      }
    }
  }

  // Compare tools
  const localToolsDir = path.join(root, '.evo', 'tools');
  const globalToolsDir = path.join(globalEvoDir, 'tools');
  if (fs.existsSync(localToolsDir) && fs.existsSync(globalToolsDir)) {
    for (const ent of fs.readdirSync(localToolsDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const locScript = path.join(localToolsDir, ent.name, 'run.mjs');
        const globScript = path.join(globalToolsDir, ent.name, 'run.mjs');
        if (fs.existsSync(locScript) && fs.existsSync(globScript)) {
          const locCode = fs.readFileSync(locScript, 'utf8').replace(/\r?\n/g, '\n').trim();
          const globCode = fs.readFileSync(globScript, 'utf8').replace(/\r?\n/g, '\n').trim();
          if (locCode !== globCode) {
            splitBrainDivergences.push({
              capability: 'tool',
              id: ent.name,
              local_path: path.relative(root, locScript).replace(/\\/g, '/'),
              global_path: globScript,
              reason: 'Tool entry script diverges between local and global trees.',
            });
          }
        }
      }
    }
  }
}

// -------------------------------------------------------------------------
// Summary & Deterministic Exit
// -------------------------------------------------------------------------
const totalViolations =
  budgetViolations.length +
  gateViolations.length +
  brokenSymbols.length +
  splitBrainDivergences.length;

const overallStatus = totalViolations === 0 ? 'HEALTHY' : 'UNHEALTHY';

if (isSelfTest) {
  const coupledCheck = detectCoupledIdentifiersInRule(
    'Always update `fooBar()` and `my_var` and `obj.prop` before calling.'
  );
  const strippedCheck = stripCodeComments(
    'const r = /`([a-z]+)`/g;\nconst msg = "StringOnlySym";\n// LegacyDeadFn was removed\n/* AnotherDeadSym */\nexport function activeFn() {}\n'
  );
  const classMethodSample = stripCodeComments(
    'export class SampleCtrl {\n  handleStep() {}\n}\n'
  );
  const selfTestAssertionsPassed =
    coupledCheck.length >= 3 &&
    !hasSymbolIdentifier(strippedCheck, 'LegacyDeadFn') &&
    !hasSymbolIdentifier(strippedCheck, 'AnotherDeadSym') &&
    !hasSymbolIdentifier(strippedCheck, 'StringOnlySym') &&
    !hasSymbolIdentifier(strippedCheck, 'active') &&
    hasSymbolIdentifier(strippedCheck, 'activeFn') &&
    hasSymbolIdentifier(classMethodSample, 'SampleCtrl.handleStep') &&
    !hasSymbolIdentifier(classMethodSample, 'SampleCtrl.missingStep');
  const ok = selfTestAssertionsPassed && totalViolations === 0;
  const result = {
    ok,
    status: ok ? 'HEALTHY' : 'UNHEALTHY',
    self_test: ok ? 'agy-config-auditor passed' : 'agy-config-auditor failed',
    self_test_assertions: selfTestAssertionsPassed,
    workspace: path.basename(root),
    audits: {
      token_budgets: {
        checked: tokenAudit.length,
        violations: budgetViolations.length,
      },
      gate1_5_rules: {
        checked: ruleAuditResults.length,
        violations: gateViolations.length,
      },
      memory_symbols: {
        checked: memoryAuditResults.reduce((acc, m) => acc + m.symbols_count, 0),
        broken: brokenSymbols.length,
      },
      split_brain: {
        checked: true,
        divergences: splitBrainDivergences.length,
      },
    },
    summary: {
      budget_violations: budgetViolations.length,
      gate1_5_violations: gateViolations.length,
      broken_memory_symbols: brokenSymbols.length,
      split_brain_conflicts: splitBrainDivergences.length,
    },
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
}

const finalReport = {
  workspace: path.basename(root),
  status: overallStatus,
  ok: totalViolations === 0,
  summary: {
    budget_violations: budgetViolations.length,
    gate1_5_violations: gateViolations.length,
    broken_memory_symbols: brokenSymbols.length,
    split_brain_conflicts: splitBrainDivergences.length,
  },
  token_budget_audit: tokenAudit,
  gate1_5_audit: ruleAuditResults,
  memory_symbols_audit: memoryAuditResults,
  split_brain_audit: splitBrainDivergences,
};

console.log(JSON.stringify(finalReport, null, 2));
process.exit(totalViolations === 0 ? 0 : 1);