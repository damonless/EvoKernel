import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  CapabilityKind,
  CapabilityOutcome,
  EvoKind,
  RecalledCapabilityEntry,
  SearchHit,
  TelemetryRecord,
} from './types.js';
import { EvoStorage } from './storage.js';
import { verifyMemoryFreshness } from './memory.js';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactSensitiveDiagnostics(text: string, workspaceRoot?: string): string {
  if (!text) return '';
  let out = text;

  // 1. Path redactions (<WORKSPACE> and <HOME>) - case and slash/backslash/json-escaped insensitive
  if (workspaceRoot) {
    const trimmedWs = workspaceRoot.trim();
    const cleanWs =
      /^[A-Za-z]:[\\/]/.test(trimmedWs) || trimmedWs.startsWith('/')
        ? trimmedWs.replace(/[\\/]+$/, '')
        : path.resolve(trimmedWs);
    const segs = cleanWs.split(/[\\/]+/).filter(Boolean).map(escapeRegExp);
    if (segs.length > 0) {
      const reWs = new RegExp(segs.join('[\\\\/]+'), 'gi');
      out = out.replace(reWs, '<WORKSPACE>');
    }
  }

  const home = path.resolve(os.homedir());
  if (home) {
    const segs = home.split(/[\\/]+/).filter(Boolean).map(escapeRegExp);
    if (segs.length > 0) {
      const reHome = new RegExp(segs.join('[\\\\/]+'), 'gi');
      out = out.replace(reHome, '<HOME>');
    }
  }

  // Generic user profile pattern: C:\Users\<user>, /Users/<user>, /home/<user>
  out = out.replace(
    /(?:[A-Za-z]:[\\/]+Users|[\\/](?:Users|home))[\\/]+[^\\/\r\n"':<>|]+/gi,
    '<HOME>'
  );

  // 2. 18 Categories of sensitive credentials/tokens
  // Specific credential and URI patterns first to prevent premature generic truncation

  // (1) Private keys (RSA, EC, OPENSSH, PGP, DSA, etc.)
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );

  // (2) Database connection strings with credentials (postgres://..., mysql://..., mongodb://..., redis://...)
  out = out.replace(
    /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s]+:[^@\s]+@[A-Za-z0-9.-]+/gi,
    (_m, scheme) => `${scheme}://[REDACTED_USER]:[REDACTED_PW]@[HOST]`
  );

  // (3) Basic auth credentials in URLs
  out = out.replace(/(https?:\/\/)[^:\s\/]+:[^@\s\/]+@/gi, '$1[REDACTED_CREDENTIALS]@');

  // (4) JWT tokens (eyJ...)
  out = out.replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_-])/g, '[REDACTED_JWT]');

  // (5) Anthropic API key (sk-ant-...) - MUST match before OpenAI sk-
  out = out.replace(/\bsk-ant-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g, '[REDACTED_ANTHROPIC_KEY]');

  // (6) OpenAI / AI service keys (sk-..., sk-proj-...)
  out = out.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g, '[REDACTED_API_KEY]');

  // (7) GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)
  out = out.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{82,})(?![A-Za-z0-9_])/g,
    '[REDACTED_GITHUB_TOKEN]'
  );

  // (8) GitLab tokens (glpat-)
  out = out.replace(/\bglpat-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g, '[REDACTED_GITLAB_TOKEN]');

  // (9) Slack tokens (xoxb-, xoxp-, xoxa-, xoxr-)
  out = out.replace(/\bxox[bpar]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9-])/g, '[REDACTED_SLACK_TOKEN]');

  // (10) AWS Access Key ID
  out = out.replace(/\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY_ID]');

  // (11) AWS Secret Access Key
  out = out.replace(
    /\b(aws_secret_access_key|awsSecretAccessKey|secret_key|secretKey)(\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}(["']?)/gi,
    (_m, p1, p2, p3) => `${p1}${p2}[REDACTED_AWS_SECRET]${p3 || ''}`
  );

  // (12) Stripe keys (sk_live_, pk_live_, rk_live_, sk_test_, pk_test_, rk_test_)
  out = out.replace(/\b(?:[rs]k|pk)_(?:live|test)_[A-Za-z0-9]{24,}(?![A-Za-z0-9])/g, '[REDACTED_STRIPE_KEY]');

  // (13) Google Cloud API key (AIza...)
  out = out.replace(/\bAIza[0-9A-Za-z_-]{35,}(?![A-Za-z0-9_-])/g, '[REDACTED_GOOGLE_API_KEY]');

  // (14) Hugging Face token (hf_...)
  out = out.replace(/\bhf_[A-Za-z0-9]{34,}(?![A-Za-z0-9])/g, '[REDACTED_HF_TOKEN]');

  // (15) PyPI API token (pypi-...)
  out = out.replace(/\bpypi-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g, '[REDACTED_PYPI_TOKEN]');

  // (16) NPM auth tokens (npm_...)
  out = out.replace(/\bnpm_[A-Za-z0-9]{32,}(?![A-Za-z0-9])/g, '[REDACTED_NPM_TOKEN]');

  // (17) Bearer tokens
  out = out.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED_TOKEN]');

  // (18) Generic API keys in key-value pairs (api_key, apiKey, access_token, etc.)
  out = out.replace(
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?token)(\s*[:=]\s*["']?)[A-Za-z0-9_\-]{16,}(["']?)/gi,
    (_m, p1, p2, p3) => `${p1}${p2}[REDACTED_SECRET]${p3 || ''}`
  );

  // (19) Password in assignments
  out = out.replace(
    /\b(password|passwd|pwd)(\s*[:=]\s*["']?)[^"' \r\n]{6,}(["']?)/gi,
    (_m, p1, p2, p3) => `${p1}${p2}[REDACTED_PASSWORD]${p3 || ''}`
  );

  return out;
}

export function computeDiskSyncDigest(evoDir: string): string {
  const subdirs = ['rules', 'skills', 'tools', 'memories'];
  const parts: string[] = [];
  for (const sub of subdirs) {
    const dir = path.join(evoDir, sub);
    if (!fs.existsSync(dir)) continue;
    const walk = (d: string) => {
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            walk(full);
          } else if (e.isFile()) {
            const st = fs.statSync(full);
            const rel = path.relative(evoDir, full).replace(/\\/g, '/');
            parts.push(`${rel}:${st.mtimeMs}:${st.size}`);
          }
        }
      } catch {}
    };
    walk(dir);
  }
  const extTools = path.join(evoDir, 'external-tools.json');
  if (fs.existsSync(extTools)) {
    try {
      const st = fs.statSync(extTools);
      parts.push(`external-tools.json:${st.mtimeMs}:${st.size}`);
    } catch {}
  }
  parts.sort();
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);
}

export function extractCjkBigrams(text: string): string[] {
  const bigrams = new Set<string>();
  const matches = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seq of matches) {
    if (seq.length === 1) {
      bigrams.add(seq);
    } else {
      for (let i = 0; i <= seq.length - 2; i++) {
        bigrams.add(seq.slice(i, i + 2));
      }
    }
  }
  return Array.from(bigrams);
}

const BILINGUAL_TECH_SYNONYMS: Record<string, string[]> = {
  硬件: ['hardware', 'hw', 'pcb', 'schematic', 'component', 'bom'],
  原理: ['schematic', 'net', 'pin', 'component', 'pcb', 'hw'],
  理图: ['schematic', 'net', 'pin', 'component', 'pcb'],
  器件: ['component', 'bom', 'part', 'pcb', 'hw'],
  元件: ['component', 'bom', 'part', 'pcb'],
  物料: ['bom', 'component', 'part', 'spec'],
  端口: ['port', 'connector', 'pin', 'header', 'net', 'hw'],
  接口: ['port', 'connector', 'pin', 'interface', 'net', 'hw'],
  接插: ['connector', 'header', 'pin', 'port', 'pcb', 'hw'],
  插件: ['connector', 'header', 'pin', 'pcb'],
  试口: ['connector', 'pin', 'header', 'net', 'port', 'hw'],
  插座: ['connector', 'socket', 'header', 'pin', 'net'],
  端子: ['terminal', 'connector', 'pin', 'net', 'hw'],
  电压: ['voltage', 'analog', 'adc', 'net', 'power', 'scaling'],
  电流: ['current', 'analog', 'adc', 'shunt', 'scaling'],
  电源: ['power', 'supply', 'rail', 'voltage', 'net', 'hw'],
  供电: ['power', 'supply', 'rail', 'voltage', 'net'],
  调试: ['debug', 'test', 'hw', 'port', 'pin'],
  引脚: ['pin', 'mcu', 'gpio', 'net', 'mapping', 'hw'],
  管脚: ['pin', 'mcu', 'gpio', 'net', 'mapping', 'hw'],
  网络: ['net', 'pcb', 'schematic', 'pin'],
  走线: ['pcb', 'trace', 'net', 'layout'],
  采样: ['analog', 'adc', 'sampling', 'scaling', 'channel', 'calc'],
  分压: ['divider', 'analog', 'adc', 'scaling', 'voltage', 'calc'],
  运放: ['opamp', 'analog', 'adc', 'scaling', 'calc'],
  换算: ['scaling', 'calc', 'ratio', 'analog', 'adc', 'unit'],
  比例: ['ratio', 'scaling', 'calc', 'analog'],
  寄存: ['register', 'firmware', 'mcu'],
  固件: ['firmware', 'mcu', 'register'],
  表格: ['excel', 'xlsx', 'xls', 'spreadsheet', 'bom'],
  工作: ['workbook', 'excel', 'xlsx'],
  报告: ['report', 'docx', 'word', 'sop', 'qa'],
  文档: ['document', 'docx', 'word', 'report', 'sop'],
  提交: ['commit', 'git', 'message', 'format', 'log'],
  版本: ['version', 'commit', 'release', 'git'],
  日志: ['log', 'commit', 'git', 'trace', 'debug'],
  规范: ['format', 'convention', 'sop', 'standard', 'commit'],
  commit: ['git', 'message', 'format', '提交', '规范'],
  git: ['commit', 'branch', 'merge', '提交', '版本'],
  log: ['日志', 'commit', 'git'],
  version: ['版本', 'release', 'commit'],
  hardware: ['hw', 'pcb', 'schematic', 'component', '硬件', '原理', '器件', '引脚'],
  hw: ['hardware', 'pcb', 'schematic', 'component', 'pin', 'net', '硬件', '器件'],
  schematic: ['pcb', 'net', 'pin', 'component', 'hardware', '原理', '理图', '网络'],
  pcb: ['hardware', 'schematic', 'component', 'net', 'pin', '硬件', '走线'],
  component: ['bom', 'part', 'pcb', 'schematic', '器件', '元件', '物料'],
  bom: ['component', 'part', 'spec', '物料', '器件'],
  pin: ['mcu', 'gpio', 'net', 'connector', '引脚', '管脚', '端口'],
  connector: ['pin', 'header', 'port', 'net', '接插', '端口', '试口', '插座'],
  voltage: ['analog', 'adc', 'power', 'net', '电压', '电源', '采样', '分压'],
  current: ['analog', 'adc', 'shunt', '电流', '采样'],
  analog: ['adc', 'scaling', 'calc', 'voltage', 'current', '采样', '分压', '运放', '换算'],
  adc: ['analog', 'scaling', 'calc', 'mcu', '采样', '换算', '电压'],
  power: ['voltage', 'supply', 'rail', 'net', '电源', '供电', '电压'],
};

const HW_DESIGNATOR_REGEX =
  /\b(?:(?:CN|JP|TP|RY|RLY|ZD|LED|SW|CT|XTAL|IC|UA)[1-9]\d*[A-Z0-9]*|[RCLUQDJPFKT]\d{2,}[A-Z0-9]*|[UQDJ][1-9]\b)/;

const VOLTAGE_UNIT_REGEX = /(?:^|[\s([:=-])[+-]?\d+(?:\.\d+)?(?:V|mV)\b/;
const CURRENT_UNIT_REGEX = /(?:^|[\s([:=-])[+-]?\d+(?:\.\d+)?(?:A|mA)\b/;
const RESISTANCE_UNIT_REGEX = /(?:^|[\s([:=-])[+-]?\d+(?:\.\d+)?\s*(?:kohm|mohm|ohm)\b/i;
const CAPACITANCE_UNIT_REGEX = /(?:^|[\s([:=-])[+-]?\d+(?:\.\d+)?\s*(?:uF|nF|pF)\b/;
const FREQUENCY_UNIT_REGEX = /(?:^|[\s([:=-])[+-]?\d+(?:\.\d+)?\s*(?:kHz|MHz|GHz|Hz)\b/i;

export function extractQueryTokens(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const asciiMatches = trimmed.match(/[A-Za-z0-9_-]{2,}/g) || [];
  const allCjkBigrams = extractCjkBigrams(trimmed);

  const allLiterals = new Set<string>([...asciiMatches, ...allCjkBigrams]);
  const techCjkBigrams: string[] = [];
  const otherCjkBigrams: string[] = [];
  for (const bg of allCjkBigrams) {
    if (BILINGUAL_TECH_SYNONYMS[bg]) {
      techCjkBigrams.push(bg);
    } else {
      otherCjkBigrams.push(bg);
    }
  }

  const expansionTokens = new Set<string>();

  if (HW_DESIGNATOR_REGEX.test(trimmed)) {
    for (const exp of [
      'hardware',
      'component',
      'designator',
      'schematic',
      'pcb',
      'pin',
      'net',
      'bom',
      'hw',
      '硬件',
      '原理',
      '理图',
      '器件',
      '引脚',
    ]) {
      expansionTokens.add(exp);
    }
  }

  if (VOLTAGE_UNIT_REGEX.test(trimmed)) {
    for (const exp of [
      'voltage',
      'power',
      'net',
      'analog',
      'rail',
      'hw',
      '电压',
      '电源',
      '网络',
      '采样',
    ]) {
      expansionTokens.add(exp);
    }
  }

  if (CURRENT_UNIT_REGEX.test(trimmed)) {
    for (const exp of [
      'current',
      'power',
      'analog',
      'shunt',
      'hw',
      '电流',
      '采样',
      '电源',
    ]) {
      expansionTokens.add(exp);
    }
  }

  if (RESISTANCE_UNIT_REGEX.test(trimmed)) {
    for (const exp of [
      'resistor',
      'analog',
      'divider',
      'component',
      'hw',
      '电阻',
      '分压',
      '采样',
      '器件',
    ]) {
      expansionTokens.add(exp);
    }
  }

  if (CAPACITANCE_UNIT_REGEX.test(trimmed)) {
    for (const exp of [
      'capacitor',
      'filter',
      'component',
      'hw',
      '电容',
      '滤波',
      '器件',
    ]) {
      expansionTokens.add(exp);
    }
  }

  if (FREQUENCY_UNIT_REGEX.test(trimmed)) {
    for (const exp of [
      'frequency',
      'clock',
      'pwm',
      'signal',
      '频率',
      '时钟',
      '信号',
    ]) {
      expansionTokens.add(exp);
    }
  }

  for (const lit of allLiterals) {
    const syns = BILINGUAL_TECH_SYNONYMS[lit] || BILINGUAL_TECH_SYNONYMS[lit.toLowerCase()];
    if (syns) {
      for (const s of syns) {
        expansionTokens.add(s);
      }
    }
  }

  const finalTokens = new Set<string>();
  for (const t of asciiMatches.slice(0, 16)) {
    finalTokens.add(t);
  }
  for (const bg of techCjkBigrams) {
    finalTokens.add(bg);
  }
  const literalBudget = expansionTokens.size > 0 ? 20 : 48;
  for (const bg of otherCjkBigrams) {
    if (finalTokens.size >= literalBudget) break;
    finalTokens.add(bg);
  }
  for (const exp of expansionTokens) {
    if (finalTokens.size >= 48) break;
    finalTokens.add(exp);
  }
  for (const bg of otherCjkBigrams) {
    if (finalTokens.size >= 48) break;
    finalTokens.add(bg);
  }

  return Array.from(finalTokens);
}

const GENERIC_QUERY_CONCEPT_TOKENS = new Set([
  'power',
  'delay',
  'shutdown',
  'off',
  'on',
  'mode',
  'state',
  'check',
  'rule',
  'skill',
  'tool',
  'report',
  'doc',
  'file',
  'code',
  'bug',
  'fix',
  'error',
  'test',
  'system',
  'control',
  'config',
  'data',
  'status',
  'value',
  'time',
  'init',
  'run',
  'build',
  '电压',
  '电源',
  '延时',
  '延迟',
  '关闭',
  '关断',
  '状态',
  '模式',
  '检查',
  '报告',
  '文档',
  '系统',
  '配置',
]);

interface QueryConceptGroup {
  literal: string;
  isGeneric: boolean;
  terms: string[];
}

function buildQueryConceptGroups(query: string): QueryConceptGroup[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const asciiLiterals = (trimmed.match(/[A-Za-z0-9_-]{2,}/g) || []).map((t) => t.toLowerCase());
  const cjkBigrams = extractCjkBigrams(trimmed);
  const seen = new Set<string>();
  const groups: QueryConceptGroup[] = [];

  for (const lit of [...asciiLiterals, ...cjkBigrams]) {
    if (seen.has(lit)) continue;
    seen.add(lit);
    const syns = BILINGUAL_TECH_SYNONYMS[lit] || BILINGUAL_TECH_SYNONYMS[lit.toLowerCase()] || [];
    const terms = Array.from(new Set([lit, ...syns.map((s) => s.toLowerCase())]));
    groups.push({
      literal: lit,
      isGeneric: GENERIC_QUERY_CONCEPT_TOKENS.has(lit),
      terms,
    });
  }
  return groups;
}

function evaluateConceptOverlap(
  conceptGroups: QueryConceptGroup[],
  row: Record<string, unknown>
): { matchedConcepts: number; matchedSpecific: number; lowOverlap: boolean } {
  if (conceptGroups.length < 2) {
    return { matchedConcepts: conceptGroups.length, matchedSpecific: conceptGroups.length, lowOverlap: false };
  }
  const searchable = [
    String(row.id || ''),
    String(row.title || ''),
    String(row.l0_summary || ''),
    String(row.keywords || ''),
    String(row.body || ''),
  ]
    .join(' ')
    .toLowerCase();

  let matchedConcepts = 0;
  let matchedSpecific = 0;
  let totalSpecific = 0;

  for (const g of conceptGroups) {
    if (!g.isGeneric) totalSpecific++;
    const hit = g.terms.some((term) => term.length >= 2 && searchable.includes(term));
    if (hit) {
      matchedConcepts++;
      if (!g.isGeneric) matchedSpecific++;
    }
  }

  // A hit is low-overlap when:
  // 1. The query has >= 2 distinct concepts with at least 1 specific technical anchor (e.g. "EPO", "emergency"),
  //    and the candidate matches 0 specific anchors (only matching generic domain words like "power", "delay").
  // 2. Or the query has >= 3 distinct concepts (all generic) and the candidate only matches <= 1 concept.
  const lowOverlap =
    (conceptGroups.length >= 2 && totalSpecific >= 1 && matchedSpecific === 0) ||
    (conceptGroups.length >= 3 && matchedConcepts <= 1);

  return { matchedConcepts, matchedSpecific, lowOverlap };
}

const CODE_EXTENSIONS_FOR_SCOPE = new Set([
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cs',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
]);

const SCOPE_SCAN_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.evo',
  '.codegraph',
  '.cursor',
  '.claude-plugin',
  '.gemini',
  '__pycache__',
  '.venv',
  'venv',
]);

export function extractExtensionsFromGlob(scopeGlob: string): string[] {
  if (!scopeGlob || scopeGlob === '**/*' || scopeGlob === '*') return [];
  const exts = new Set<string>();
  const braceMatches = scopeGlob.match(/\.?\{([a-zA-Z0-9_.,\s]+)\}/g);
  if (braceMatches) {
    for (const bm of braceMatches) {
      const inner = bm.replace(/^[.{]+|\}+$/g, '');
      for (const part of inner.split(',')) {
        const clean = part.trim().replace(/^\./, '').toLowerCase();
        if (clean && CODE_EXTENSIONS_FOR_SCOPE.has(`.${clean}`)) {
          exts.add(`.${clean}`);
        }
      }
    }
  }
  const stripped = scopeGlob.replace(/\{[^}]*\}/g, '');
  for (const m of stripped.matchAll(/\.([a-zA-Z0-9_]{1,10})\b/g)) {
    const ext = `.${m[1].toLowerCase()}`;
    if (CODE_EXTENSIONS_FOR_SCOPE.has(ext)) {
      exts.add(ext);
    }
  }
  return Array.from(exts);
}

const DEPRIORITIZED_SCAN_DIRS = new Set([
  'docs',
  'doc',
  'assets',
  'images',
  'drivers',
  'middlewares',
  'cmsis',
  'vendor',
  'third_party',
  'external',
  'lib',
]);

export function collectWorkspaceCodeExtensions(workspaceRoot: string): Set<string> {
  const foundCodeExts = new Set<string>();
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return foundCodeExts;

  let scannedCodeFiles = 0;
  let scannedTotalEntries = 0;
  const maxCodeFiles = 300;
  const maxTotalEntries = 2000;

  const walk = (dir: string, depth: number) => {
    if (depth > 4 || scannedCodeFiles >= maxCodeFiles || scannedTotalEntries >= maxTotalEntries) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && b.isDirectory()) {
        const aDep = DEPRIORITIZED_SCAN_DIRS.has(a.name.toLowerCase()) ? 1 : 0;
        const bDep = DEPRIORITIZED_SCAN_DIRS.has(b.name.toLowerCase()) ? 1 : 0;
        if (aDep !== bDep) return aDep - bDep;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (scannedCodeFiles >= maxCodeFiles || scannedTotalEntries >= maxTotalEntries) break;
      if (SCOPE_SCAN_IGNORED_DIRS.has(entry.name)) continue;
      scannedTotalEntries++;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS_FOR_SCOPE.has(ext)) {
          scannedCodeFiles++;
          foundCodeExts.add(ext);
        }
      }
    }
  };

  walk(path.resolve(workspaceRoot), 0);
  return foundCodeExts;
}

export function isScopeCompatibleWithWorkspace(
  scopeGlob: string,
  workspaceRoot: string,
  precomputedExts?: Set<string>
): boolean {
  const requiredExts = extractExtensionsFromGlob(scopeGlob);
  if (requiredExts.length === 0) return true;
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return true;

  const foundCodeExts = precomputedExts ?? collectWorkspaceCodeExtensions(workspaceRoot);
  if (foundCodeExts.size === 0) return true;
  return requiredExts.some((ext) => foundCodeExts.has(ext));
}

export interface TelemetryOptions {
  forceFts5Fallback?: boolean;
}

export class EvoTelemetry {
  private readonly dbPath: string;
  private readonly storage: EvoStorage;
  private readonly forceFallback: boolean;
  private fts5Enabled = false;
  private closed = false;
  private db: DatabaseSync;

  constructor(storage: EvoStorage, options?: TelemetryOptions) {
    this.storage = storage;
    this.storage.ensureInitialized();
    this.forceFallback = Boolean(
      options?.forceFts5Fallback || process.env.EVO_FORCE_FTS5_FALLBACK === '1'
    );
    this.dbPath = path.join(this.storage.cacheDir, 'telemetry.db');
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  public isFts5Enabled(): boolean {
    return this.fts5Enabled;
  }

  private initSchema(): void {
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
    } catch {
      // ignore pragma errors
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        l0_summary TEXT NOT NULL,
        scope_glob TEXT NOT NULL DEFAULT '**/*',
        hit_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        helped_count INTEGER NOT NULL DEFAULT 0,
        hurt_count INTEGER NOT NULL DEFAULT 0,
        contested_count INTEGER NOT NULL DEFAULT 0,
        tokens_saved INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        l0_summary TEXT NOT NULL,
        created_commit TEXT NOT NULL,
        symptom_text TEXT NOT NULL,
        root_cause TEXT NOT NULL,
        solution_summary TEXT NOT NULL,
        target_symbols TEXT NOT NULL,
        ast_fingerprints TEXT NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capability_fts_fallback (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        l0_summary TEXT NOT NULL,
        keywords TEXT NOT NULL,
        body TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gatekeeper_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_id TEXT,
        target_name TEXT,
        passed INTEGER NOT NULL,
        stage_failed TEXT,
        diagnostics TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_verification_cache (
        memory_id TEXT PRIMARY KEY,
        parser_version INTEGER NOT NULL,
        memory_file_sig TEXT NOT NULL,
        target_files_sig TEXT NOT NULL,
        workspace_sources_sig TEXT,
        overall_status TEXT NOT NULL,
        report_json TEXT NOT NULL,
        cached_at TEXT NOT NULL,
        has_callers INTEGER NOT NULL DEFAULT 0
      );
    `);

    try {
      this.db.exec('ALTER TABLE memory_verification_cache ADD COLUMN has_callers INTEGER NOT NULL DEFAULT 0');
    } catch {
      // column already exists
    }

    try {
      this.db.exec('ALTER TABLE telemetry ADD COLUMN helped_count INTEGER NOT NULL DEFAULT 0');
    } catch {
      // column already exists
    }
    try {
      this.db.exec('ALTER TABLE telemetry ADD COLUMN hurt_count INTEGER NOT NULL DEFAULT 0');
    } catch {
      // column already exists
    }
    try {
      this.db.exec('ALTER TABLE telemetry ADD COLUMN contested_count INTEGER NOT NULL DEFAULT 0');
    } catch {
      // column already exists
    }

    if (this.forceFallback) {
      this.fts5Enabled = false;
      return;
    }

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS capability_fts USING fts5(
          id UNINDEXED,
          kind UNINDEXED,
          title,
          l0_summary,
          keywords,
          body
        );
      `);
      this.db.prepare('SELECT count(*) FROM capability_fts').get();
      this.fts5Enabled = true;
    } catch {
      // Node.js v22.5 ~ v22.14 on Windows compiled node:sqlite without SQLITE_ENABLE_FTS5
      this.fts5Enabled = false;
    }
  }

  private lastSyncDigest?: string;

  public syncFromDisk(force = false): void {
    const diskDigest = computeDiskSyncDigest(this.storage.evoDir);
    if (!force) {
      if (this.lastSyncDigest && this.lastSyncDigest === diskDigest) {
        return;
      }
      try {
        const stmt = this.db.prepare('SELECT value FROM session_state WHERE key = ?');
        const row = stmt.get('disk_sync_digest') as { value: string } | undefined;
        if (row && row.value === diskDigest) {
          this.lastSyncDigest = diskDigest;
          return;
        }
      } catch {}
    }

    const rules = this.storage.listRules();
    const skills = this.storage.listSkills();
    const tools = this.storage.listTools();
    const memories = this.storage.listMemories();

    const activeIds = new Set<string>();
    for (const r of rules) activeIds.add(r.id);
    for (const s of skills) activeIds.add(s.id);
    for (const t of tools) activeIds.add(t.id);
    for (const m of memories) activeIds.add(m.id);

    const activeMemoryIds = new Set<string>(memories.map((m) => m.id));

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.exec('DELETE FROM capability_fts_fallback;');
      const insertFallback = this.db.prepare(
        'INSERT OR REPLACE INTO capability_fts_fallback (id, kind, title, l0_summary, keywords, body) VALUES (?, ?, ?, ?, ?, ?)'
      );

      let insertFts: ReturnType<DatabaseSync['prepare']> | null = null;
      let deleteFtsById: ReturnType<DatabaseSync['prepare']> | null = null;
      if (this.fts5Enabled) {
        try {
          this.db.exec('DELETE FROM capability_fts;');
          insertFts = this.db.prepare(
            'INSERT INTO capability_fts (id, kind, title, l0_summary, keywords, body) VALUES (?, ?, ?, ?, ?, ?)'
          );
          deleteFtsById = this.db.prepare('DELETE FROM capability_fts WHERE id = ?');
        } catch {
          this.fts5Enabled = false;
          insertFts = null;
          deleteFtsById = null;
        }
      }
      const seenFtsIds = new Set<string>();
      const upsertFtsRow = (
        id: string,
        kind: string,
        title: string,
        l0Summary: string,
        kw: string,
        body: string
      ) => {
        insertFallback.run(id, kind, title, l0Summary, kw, body);
        if (insertFts) {
          if (seenFtsIds.has(id)) {
            deleteFtsById?.run(id);
          }
          seenFtsIds.add(id);
          insertFts.run(id, kind, title, l0Summary, kw, body);
        }
      };

      // Purge zombie/archived records from telemetry table
      const existingTelemetry = this.db.prepare('SELECT id FROM telemetry').all() as Array<{ id: string }>;
      const deleteTelemetry = this.db.prepare('DELETE FROM telemetry WHERE id = ?');
      for (const row of existingTelemetry) {
        if (!activeIds.has(row.id)) {
          deleteTelemetry.run(row.id);
        }
      }

      // Purge zombie/archived records from episodic_memories table
      const existingEpisodic = this.db.prepare('SELECT id FROM episodic_memories').all() as Array<{ id: string }>;
      const deleteEpisodic = this.db.prepare('DELETE FROM episodic_memories WHERE id = ?');
      for (const row of existingEpisodic) {
        if (!activeMemoryIds.has(row.id)) {
          deleteEpisodic.run(row.id);
        }
      }

      const upsertTelemetry = this.db.prepare(`
        INSERT INTO telemetry (id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, tokens_saved, last_used_at, created_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          title = excluded.title,
          l0_summary = excluded.l0_summary,
          scope_glob = excluded.scope_glob
      `);

      const upsertEpisodic = this.db.prepare(`
        INSERT INTO episodic_memories (
          id, title, l0_summary, created_commit, symptom_text, root_cause, solution_summary,
          target_symbols, ast_fingerprints, hit_count, is_active, last_verified_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          l0_summary = excluded.l0_summary,
          created_commit = excluded.created_commit,
          symptom_text = excluded.symptom_text,
          root_cause = excluded.root_cause,
          solution_summary = excluded.solution_summary,
          target_symbols = excluded.target_symbols,
          ast_fingerprints = excluded.ast_fingerprints
      `);

      const now = new Date().toISOString();

      for (const r of rules) {
        const idTokens = r.id.replace(/[-_]+/g, ' ');
        const cjkKw = extractCjkBigrams(`${r.title} ${r.l0_summary} ${r.content}`).join(' ');
        const kw = `${idTokens} ${r.scope_glob} ${cjkKw}`.trim();
        upsertFtsRow(r.id, 'rule', r.title, r.l0_summary, kw, r.content);
        upsertTelemetry.run(r.id, 'rule', r.title, r.l0_summary, r.scope_glob, now, r.created_at || now);
      }

      for (const s of skills) {
        const idTokens = s.id.replace(/[-_]+/g, ' ');
        const triggerCue = s.trigger_cue || '';
        const bodyText = `${s.l1_contract}\n${s.l2_sop}\n${triggerCue}`.trim();
        const cjkKw = extractCjkBigrams(`${s.title} ${s.l0_summary} ${s.l1_contract} ${s.l2_sop} ${triggerCue}`).join(' ');
        const kw = `${idTokens} ${s.tags.join(' ')} ${triggerCue} ${cjkKw}`.trim();
        upsertFtsRow(s.id, 'skill', s.title, s.l0_summary, kw, bodyText);
        upsertTelemetry.run(s.id, 'skill', s.title, s.l0_summary, '**/*', now, s.created_at || now);
      }

      for (const t of tools) {
        const idTokens = t.id.replace(/[-_]+/g, ' ');
        const tagsText = Array.isArray(t.tags) ? t.tags.join(' ') : '';
        const propsObj =
          t.input_schema &&
          typeof t.input_schema === 'object' &&
          t.input_schema.properties &&
          typeof t.input_schema.properties === 'object'
            ? (t.input_schema.properties as Record<string, Record<string, unknown>>)
            : {};
        const schemaPropsText = Object.entries(propsObj)
          .map(
            ([k, v]) =>
              `${k} ${k.replace(/[-_]+/g, ' ')} ${typeof v?.description === 'string' ? v.description : ''}`
          )
          .join(' ');
        const schemaText = JSON.stringify(t.input_schema ?? (t as any).args_schema ?? {}) || '{}';
        const toolTitle = t.title || t.id;
        const toolSummary = t.l0_summary || toolTitle;
        const cjkKw = extractCjkBigrams(
          `${toolTitle} ${toolSummary} ${tagsText} ${schemaPropsText}`
        ).join(' ');
        const kw = `${idTokens} ${t.runtime} ${tagsText} ${schemaPropsText} ${cjkKw}`.trim();
        upsertFtsRow(t.id, 'tool', toolTitle, toolSummary, kw, schemaText);
        upsertTelemetry.run(t.id, 'tool', toolTitle, toolSummary, '**/*', now, t.created_at || now);
      }

      // Index external tools into telemetry and FTS
      const externalTools = this.storage.listExternalTools();
      for (const et of externalTools) {
        activeIds.add(et.id);
        const idTokens = et.id.replace(/[-_]+/g, ' ');
        const schemaText = JSON.stringify(et.inputSchema);
        const cjkKw = extractCjkBigrams(`${et.title} ${et.description}`).join(' ');
        const kw = `${idTokens} external proxy mcp ${et.serverName} ${et.originalName} ${cjkKw}`.trim();
        const l0 = (et.description || `External MCP tool from ${et.serverName}`).slice(0, 140);
        upsertFtsRow(et.id, 'tool', et.title, l0, kw, schemaText);
        upsertTelemetry.run(et.id, 'tool', et.title, l0, '**/*', now, et.cachedAt || now);
      }

      for (const m of memories) {
        const idTokens = m.id.replace(/[-_]+/g, ' ');
        const cjkKw = extractCjkBigrams(
          `${m.title} ${m.l0_summary} ${m.symptom} ${m.root_cause} ${m.solution}`
        ).join(' ');
        const keywords = [
          idTokens,
          ...m.target_symbols,
          ...m.tags,
          m.created_commit,
          m.created_branch,
          cjkKw,
        ]
          .filter(Boolean)
          .join(' ');
        const bodyText = `${m.symptom}\n${m.root_cause}\n${m.solution}`;
        const scopeDisplay = m.target_symbols.slice(0, 3).join(', ') || '**/*';
        upsertFtsRow(m.id, 'memory', m.title, m.l0_summary, keywords, bodyText);
        upsertTelemetry.run(m.id, 'memory', m.title, m.l0_summary, scopeDisplay, now, m.created_at || now);
        upsertEpisodic.run(
          m.id,
          m.title,
          m.l0_summary,
          m.created_commit || '',
          m.symptom,
          m.root_cause,
          m.solution,
          JSON.stringify(m.target_symbols),
          JSON.stringify(m.ast_fingerprints),
          now,
          m.created_at || now
        );
      }

      this.db.exec('COMMIT;');
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO session_state (key, value, updated_at)
          VALUES ('disk_sync_digest', ?, ?)
        `);
        stmt.run(diskDigest, now);
        this.lastSyncDigest = diskDigest;
      } catch {}
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore rollback errors if already aborted
      }
      throw err;
    }
  }

  public recordGatekeeperEvent(
    event: {
      kind: string;
      targetId?: string;
      targetName?: string;
      passed: boolean;
      stageFailed?: string;
      diagnostics: string;
    },
    workspaceRoot?: string
  ): void {
    try {
      const redactedDiag = redactSensitiveDiagnostics(
        event.diagnostics,
        workspaceRoot || this.storage.workspaceRoot
      );
      const stmt = this.db.prepare(`
        INSERT INTO gatekeeper_events (timestamp, kind, target_id, target_name, passed, stage_failed, diagnostics)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        new Date().toISOString(),
        event.kind,
        event.targetId || null,
        event.targetName || null,
        event.passed ? 1 : 0,
        event.stageFailed || null,
        redactedDiag
      );
      // Cap ring buffer to 200 items
      this.db.exec(`
        DELETE FROM gatekeeper_events
        WHERE id NOT IN (
          SELECT id FROM gatekeeper_events ORDER BY id DESC LIMIT 200
        );
      `);
    } catch {}
  }

  public getGatekeeperEvents(limit = 200): Array<{
    id: number;
    timestamp: string;
    kind: string;
    target_id?: string;
    target_name?: string;
    passed: boolean;
    stage_failed?: string;
    diagnostics: string;
  }> {
    try {
      const stmt = this.db.prepare(`
        SELECT id, timestamp, kind, target_id, target_name, passed, stage_failed, diagnostics
        FROM gatekeeper_events
        ORDER BY id DESC
        LIMIT ?
      `);
      const rows = stmt.all(limit) as Array<{
        id: number;
        timestamp: string;
        kind: string;
        target_id: string | null;
        target_name: string | null;
        passed: number;
        stage_failed: string | null;
        diagnostics: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        kind: r.kind,
        target_id: r.target_id || undefined,
        target_name: r.target_name || undefined,
        passed: r.passed === 1,
        stage_failed: r.stage_failed || undefined,
        diagnostics: r.diagnostics,
      }));
    } catch {
      return [];
    }
  }

  public search(
    query: string,
    kind: EvoKind | 'all' = 'all',
    limit = 10,
    activeWorkspaceRoot?: string
  ): SearchHit[] {
    this.syncFromDisk();
    const tokens = extractQueryTokens(query);
    const conceptGroups = buildQueryConceptGroups(query);

    const fetchLimit = Math.max(limit * 3, 24);
    let rows: Array<Record<string, unknown>> = [];

    if (tokens.length > 0) {
      if (this.fts5Enabled) {
        const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
        const sql =
          kind === 'all'
            ? `
              SELECT f.id, f.kind, f.keywords, f.body, t.title, t.l0_summary, t.scope_glob, t.hit_count, t.success_count, t.fail_count,
                     t.helped_count, t.hurt_count, t.contested_count, bm25(capability_fts) as rank
              FROM capability_fts f
              JOIN telemetry t ON f.id = t.id
              WHERE capability_fts MATCH ?
              ORDER BY rank ASC, t.hit_count DESC
              LIMIT ?
            `
            : `
              SELECT f.id, f.kind, f.keywords, f.body, t.title, t.l0_summary, t.scope_glob, t.hit_count, t.success_count, t.fail_count,
                     t.helped_count, t.hurt_count, t.contested_count, bm25(capability_fts) as rank
              FROM capability_fts f
              JOIN telemetry t ON f.id = t.id
              WHERE capability_fts MATCH ? AND f.kind = ?
              ORDER BY rank ASC, t.hit_count DESC
              LIMIT ?
            `;

        try {
          const stmt = this.db.prepare(sql);
          rows = (kind === 'all' ? stmt.all(ftsQuery, fetchLimit) : stmt.all(ftsQuery, kind, fetchLimit)) as Array<
            Record<string, unknown>
          >;
        } catch {
          this.fts5Enabled = false;
          rows = [];
        }
      }

      if (!this.fts5Enabled) {
        rows = this.searchFallbackBm25(tokens, kind, fetchLimit);
      }
    }

    if (tokens.length === 0) {
      if (!query.trim()) {
        const fallbackSql =
          kind === 'all'
            ? `SELECT id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, helped_count, hurt_count, contested_count, 0.0 as rank FROM telemetry ORDER BY hit_count DESC, created_at DESC LIMIT ?`
            : `SELECT id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, helped_count, hurt_count, contested_count, 0.0 as rank FROM telemetry WHERE kind = ? ORDER BY hit_count DESC, created_at DESC LIMIT ?`;
        const stmt = this.db.prepare(fallbackSql);
        rows = (kind === 'all' ? stmt.all(fetchLimit) : stmt.all(kind, fetchLimit)) as Array<Record<string, unknown>>;
      } else {
        rows = [];
      }
    }

    const wsForScope = activeWorkspaceRoot || this.storage.rootDir;
    const workspaceCodeExts = wsForScope ? collectWorkspaceCodeExtensions(wsForScope) : undefined;
    const filteredRows = rows.filter((r) => {
      if (String(r.kind) === 'rule') {
        return isScopeCompatibleWithWorkspace(
          String(r.scope_glob || '**/*'),
          wsForScope,
          workspaceCodeExts
        );
      }
      return true;
    });

    const updateActiveStmt = this.db.prepare(
      'UPDATE episodic_memories SET is_active = ?, last_verified_at = ? WHERE id = ?'
    );
    const now = new Date().toISOString();

    const hits: SearchHit[] = filteredRows.map((r) => {
      const id = String(r.id);
      const itemKind = String(r.kind) as EvoKind;
      const succ = Number(r.success_count || 0);
      const fail = Number(r.fail_count || 0);
      const total = succ + fail;
      const rate = total > 0 ? `${((succ / total) * 100).toFixed(0)}%` : '100% (verified)';
      let rawScore = Math.abs(Number(r.rank || 0));
      if (rawScore === 0) rawScore = 1.0;
      if (r._score === undefined) {
        const helped = Number(r.helped_count || 0);
        const hurt = Number(r.hurt_count || 0);
        const contested = Number(r.contested_count || 0);
        const outcomes = helped + hurt + contested;
        if (outcomes >= 2 && (hurt + contested) > helped) {
          rawScore *= 0.65;
        } else if (helped >= 3 && hurt === 0 && contested === 0) {
          rawScore *= 1.10;
        }
      }

      const overlap = evaluateConceptOverlap(conceptGroups, r);
      if (overlap.lowOverlap) {
        rawScore *= 0.25;
      } else if (conceptGroups.length >= 2 && overlap.matchedConcepts >= 2) {
        rawScore *= 1 + Math.min(overlap.matchedConcepts - 1, 3) * 0.15;
      }

      if (itemKind === 'memory') {
        const mem = this.storage.getMemory(id);
        if (mem) {
          const ver = verifyMemoryFreshness(this.storage.rootDir, mem, {
            includeCallers: false,
            cacheDb: this.db,
          });
          const isActive = ver.overall_status !== 'STALE' ? 1 : 0;
          const memRow = this.db
            .prepare('SELECT is_active FROM episodic_memories WHERE id = ?')
            .get(id) as { is_active: number } | undefined;
          if (memRow && memRow.is_active !== isActive) {
            updateActiveStmt.run(isActive, now, id);
          }

          if (ver.overall_status === 'VERIFIED') {
            return {
              id,
              kind: itemKind,
              title: String(r.title),
              l0_summary: String(r.l0_summary),
              scope_glob: String(r.scope_glob || '**/*'),
              hit_count: Number(r.hit_count || 0),
              success_rate: rate,
              score: rawScore,
              low_overlap: overlap.lowOverlap || undefined,
              matched_concepts: overlap.matchedConcepts,
              memory_status: 'VERIFIED',
              memory_badge: `[VERIFIED ${ver.verified_count}/${ver.total_symbols} symbols @ ${ver.current_commit}]`,
            };
          } else if (ver.overall_status === 'OTHER_BRANCH') {
            const branchLabel = ver.recorded_branch || mem.created_branch || 'other-branch';
            return {
              id,
              kind: itemKind,
              title: String(r.title),
              l0_summary: String(r.l0_summary),
              scope_glob: String(r.scope_glob || '**/*'),
              hit_count: Number(r.hit_count || 0),
              success_rate: `BRANCH:${branchLabel}`,
              score: rawScore * 0.9,
              low_overlap: overlap.lowOverlap || undefined,
              matched_concepts: overlap.matchedConcepts,
              memory_status: 'OTHER_BRANCH',
              memory_badge: `[BRANCH: ${branchLabel}@${ver.recorded_commit} (${ver.verified_count}/${ver.total_symbols} in HEAD)]`,
            };
          } else {
            const drifted = ver.checks
              .filter((c) => c.status !== 'VERIFIED')
              .map((c) => `${c.symbol}:${c.status}`)
              .join(', ');
            return {
              id,
              kind: itemKind,
              title: String(r.title),
              l0_summary: String(r.l0_summary),
              scope_glob: String(r.scope_glob || '**/*'),
              hit_count: Number(r.hit_count || 0),
              success_rate: 'STALE (needs re-verification)',
              score: rawScore * 0.25, // Demote stale memories in ranking
              low_overlap: overlap.lowOverlap || undefined,
              matched_concepts: overlap.matchedConcepts,
              memory_status: 'STALE',
              memory_badge: `[STALE: ${drifted || 'symbols drifted'}]`,
            };
          }
        }
      }

      return {
        id,
        kind: itemKind,
        title: String(r.title),
        l0_summary: String(r.l0_summary),
        scope_glob: String(r.scope_glob || '**/*'),
        hit_count: Number(r.hit_count || 0),
        success_rate: rate,
        score: rawScore,
        low_overlap: overlap.lowOverlap || undefined,
        matched_concepts: overlap.matchedConcepts,
      };
    });

    // Sort VERIFIED / active capabilities first, OTHER_BRANCH second, and STALE memories last
    const statusTier = (s?: 'VERIFIED' | 'OTHER_BRANCH' | 'STALE') =>
      s === 'STALE' ? 2 : s === 'OTHER_BRANCH' ? 1 : 0;

    return hits
      .sort((a, b) => {
        const tierDiff = statusTier(a.memory_status) - statusTier(b.memory_status);
        if (tierDiff !== 0) return tierDiff;
        return b.score - a.score || b.hit_count - a.hit_count;
      })
      .slice(0, limit);
  }

  private searchFallbackBm25(
    tokens: string[],
    kind: EvoKind | 'all',
    limit: number
  ): Array<Record<string, unknown>> {
    const sql =
      kind === 'all'
        ? `
          SELECT f.id, f.kind, f.title, f.l0_summary, f.keywords, f.body,
                 t.scope_glob, t.hit_count, t.success_count, t.fail_count,
                 t.helped_count, t.hurt_count, t.contested_count
          FROM capability_fts_fallback f
          JOIN telemetry t ON f.id = t.id
        `
        : `
          SELECT f.id, f.kind, f.title, f.l0_summary, f.keywords, f.body,
                 t.scope_glob, t.hit_count, t.success_count, t.fail_count,
                 t.helped_count, t.hurt_count, t.contested_count
          FROM capability_fts_fallback f
          JOIN telemetry t ON f.id = t.id
          WHERE f.kind = ?
        `;
    const candidates = (
      kind === 'all' ? this.db.prepare(sql).all() : this.db.prepare(sql).all(kind)
    ) as Array<Record<string, unknown>>;

    if (candidates.length === 0 || tokens.length === 0) {
      return [];
    }

    const lowerTokens = Array.from(new Set(tokens.map((t) => t.toLowerCase())));
    const N = candidates.length;

    // 1. Calculate Document Frequency (DF) for each token to compute IDF
    const dfMap = new Map<string, number>();
    for (const tok of lowerTokens) {
      let df = 0;
      for (const row of candidates) {
        const idStr = String(row.id || '').toLowerCase();
        const titleStr = String(row.title || '').toLowerCase();
        const l0Str = String(row.l0_summary || '').toLowerCase();
        const kwStr = String(row.keywords || '').toLowerCase();
        const bodyStr = String(row.body || '').toLowerCase();

        if (
          idStr.includes(tok) ||
          titleStr.includes(tok) ||
          l0Str.includes(tok) ||
          kwStr.includes(tok) ||
          bodyStr.includes(tok)
        ) {
          df++;
        }
      }
      dfMap.set(tok, df);
    }

    // 2. Compute document lengths for Okapi BM25 length normalization
    const k1 = 1.2;
    const b = 0.75;
    const fieldWeights = {
      id: 3.0,
      title: 3.0,
      keywords: 2.5,
      l0_summary: 2.0,
      body: 1.0,
    };

    let totalDocLen = 0;
    const docLengths = new Map<unknown, number>();
    for (const row of candidates) {
      const len =
        String(row.id || '').length * 0.5 +
        String(row.title || '').length +
        String(row.l0_summary || '').length +
        String(row.keywords || '').length +
        String(row.body || '').length * 0.2;
      docLengths.set(row, len);
      totalDocLen += len;
    }
    const avgDocLen = Math.max(1, totalDocLen / N);

    const countOccurrences = (text: string, term: string): number => {
      if (!text || !term) return 0;
      let count = 0;
      let pos = 0;
      while ((pos = text.indexOf(term, pos)) !== -1) {
        count++;
        pos += term.length;
      }
      return count;
    };

    const scored: Array<Record<string, unknown> & { _score: number }> = [];

    for (const row of candidates) {
      const idStr = String(row.id || '').toLowerCase();
      const titleStr = String(row.title || '').toLowerCase();
      const l0Str = String(row.l0_summary || '').toLowerCase();
      const kwStr = String(row.keywords || '').toLowerCase();
      const bodyStr = String(row.body || '').toLowerCase();

      const docLen = docLengths.get(row) || avgDocLen;
      const lenNorm = 1 - b + b * (docLen / avgDocLen);

      let totalScore = 0;

      for (const tok of lowerTokens) {
        const df = dfMap.get(tok) || 0;
        if (df === 0) continue;

        // Smoothed Okapi BM25 IDF: ln(1 + (N - df + 0.5) / (df + 0.5)) + 0.5
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)) + 0.5;

        // Weighted Term Frequency across fields
        const tfId = countOccurrences(idStr, tok);
        const tfTitle = countOccurrences(titleStr, tok);
        const tfKw = countOccurrences(kwStr, tok);
        const tfL0 = countOccurrences(l0Str, tok);
        const tfBody = countOccurrences(bodyStr, tok);

        const weightedTf =
          fieldWeights.id * tfId +
          fieldWeights.title * tfTitle +
          fieldWeights.keywords * tfKw +
          fieldWeights.l0_summary * tfL0 +
          fieldWeights.body * tfBody;

        if (weightedTf > 0) {
          // BM25 TF saturation formula
          const tfScore = (weightedTf * (k1 + 1)) / (weightedTf + k1 * lenNorm);
          totalScore += idf * tfScore;
        }
      }

      if (totalScore > 0) {
        const helped = Number(row.helped_count || 0);
        const hurt = Number(row.hurt_count || 0);
        const contested = Number(row.contested_count || 0);
        const outcomes = helped + hurt + contested;
        let outcomeMultiplier = 1.0;
        if (outcomes >= 2 && (hurt + contested) > helped) {
          outcomeMultiplier = 0.65;
        } else if (helped >= 3 && hurt === 0 && contested === 0) {
          outcomeMultiplier = 1.10;
        }
        const adjustedScore = totalScore * outcomeMultiplier;
        scored.push({
          ...row,
          rank: -adjustedScore,
          _score: adjustedScore,
        });
      }
    }

    return scored
      .sort((a, b) => b._score - a._score || Number(b.hit_count || 0) - Number(a.hit_count || 0))
      .slice(0, limit);
  }

  public findSimilarCapabilities(
    title: string,
    l0Summary: string,
    kind: EvoKind,
    excludeId?: string,
    extraText = ''
  ): Array<{ id: string; similarity: number; l0_summary: string }> {
    this.syncFromDisk();
    const existing = this.db
      .prepare(
        `SELECT t.id, t.title, t.l0_summary, f.keywords
         FROM telemetry t
         LEFT JOIN capability_fts_fallback f ON t.id = f.id
         WHERE t.kind = ?`
      )
      .all(kind) as Array<{ id: string; title: string; l0_summary: string; keywords?: string }>;

    const targetTokens = tokenizeForSimilarity(`${title} ${l0Summary} ${extraText}`);
    if (targetTokens.size === 0) return [];

    const matches: Array<{ id: string; similarity: number; l0_summary: string }> = [];
    for (const item of existing) {
      if (excludeId && item.id === excludeId) continue;
      const candText =
        kind === 'memory' && extraText
          ? `${item.title} ${item.l0_summary} ${item.keywords || ''}`
          : `${item.title} ${item.l0_summary}`;
      const candTokens = tokenizeForSimilarity(candText);
      const sim = jaccardSimilarity(targetTokens, candTokens);
      if (sim > 0) {
        matches.push({ id: item.id, similarity: sim, l0_summary: item.l0_summary });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  public recordUsage(id: string, success: boolean, tokensSavedEstimate = 450): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE telemetry
      SET hit_count = hit_count + 1,
          success_count = success_count + ?,
          fail_count = fail_count + ?,
          tokens_saved = tokens_saved + ?,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(success ? 1 : 0, success ? 0 : 1, tokensSavedEstimate, now, id);
    this.db.prepare('UPDATE episodic_memories SET hit_count = hit_count + 1 WHERE id = ?').run(id);
  }

  public getTelemetryMap(): Map<string, TelemetryRecord> {
    this.syncFromDisk();
    const rows = this.db.prepare('SELECT * FROM telemetry').all() as Array<Record<string, unknown>>;
    const map = new Map<string, TelemetryRecord>();
    for (const r of rows) {
      map.set(String(r.id), {
        id: String(r.id),
        kind: String(r.kind) as EvoKind,
        title: String(r.title || r.id),
        l0_summary: String(r.l0_summary || ''),
        scope_glob: String(r.scope_glob || '**/*'),
        hit_count: Number(r.hit_count || 0),
        success_count: Number(r.success_count || 0),
        fail_count: Number(r.fail_count || 0),
        helped_count: Number(r.helped_count || 0),
        hurt_count: Number(r.hurt_count || 0),
        contested_count: Number(r.contested_count || 0),
        tokens_saved: Number(r.tokens_saved || 0),
        last_used_at: String(r.last_used_at),
        created_at: String(r.created_at),
      });
    }
    return map;
  }

  public recordRecalledCapability(entry: {
    id: string;
    kind: CapabilityKind;
    tier: 'LOCAL' | 'GLOBAL';
  }): void {
    const list = this.getRecalledCapabilities();
    const targetId = entry.id.trim();
    const existingIndex = list.findIndex((item) => item.id === targetId);
    const newEntry: RecalledCapabilityEntry = {
      id: targetId,
      kind: entry.kind,
      tier: entry.tier,
      ts: new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
    }
    list.push(newEntry);
    const capped = list.slice(-50);
    this.setSessionFlag('recalled_capabilities', JSON.stringify(capped));
  }

  public getRecalledCapabilities(): RecalledCapabilityEntry[] {
    const raw = this.getSessionFlag('recalled_capabilities');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as RecalledCapabilityEntry[];
      }
    } catch {
      // ignore malformed session flag
    }
    return [];
  }

  public clearRecalledCapabilities(): void {
    this.db.prepare("DELETE FROM session_state WHERE key = 'recalled_capabilities'").run();
  }

  public recordCapabilityOutcome(id: string, outcome: CapabilityOutcome): void {
    if (outcome === 'neutral') return;
    const col =
      outcome === 'helped'
        ? 'helped_count'
        : outcome === 'hurt'
          ? 'hurt_count'
          : outcome === 'contested'
            ? 'contested_count'
            : null;
    if (!col) return;
    const rawId = id.trim();
    const cleanId = rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const stmt = this.db.prepare(
      `UPDATE telemetry SET ${col} = ${col} + 1 WHERE id = ? OR id = ?`
    );
    const res = stmt.run(rawId, cleanId);
    if (res.changes === 0) {
      const rule = this.storage.getRule(cleanId);
      const skill = this.storage.getSkill(cleanId);
      const tool = this.storage.getTool(cleanId);
      const memory = this.storage.getMemory(cleanId);
      const cap = rule || skill || tool || memory;
      const kind = rule ? 'rule' : skill ? 'skill' : tool ? 'tool' : memory ? 'memory' : 'rule';
      const title = cap?.title || cleanId;
      const l0_summary = cap?.l0_summary || '';
      const scope_glob = rule?.scope_glob || '';
      const now = new Date().toISOString();
      try {
        const insertStmt = this.db.prepare(`
          INSERT INTO telemetry (id, kind, title, l0_summary, scope_glob, hit_count, success_count, fail_count, tokens_saved, last_used_at, created_at, ${col})
          VALUES (?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET ${col} = ${col} + 1
        `);
        insertStmt.run(cleanId, kind, title, l0_summary, scope_glob, now, now);
      } catch {
        // Ignore fallback insert collision
      }
    }
  }

  public setSessionFlag(key: string, value: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO session_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now);
  }

  public getSessionFlag(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM session_state WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  public isClosed(): boolean {
    return this.closed;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      // Ignore already-closed errors
    }
  }
}

function tokenizeForSimilarity(text: string): Set<string> {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{1,2}/g) || [];
  const stopWords = new Set(['the', 'and', 'for', 'with', 'when', 'use', 'rule', 'skill', 'tool', 'from', 'that', 'this']);
  return new Set(words.filter((w) => !stopWords.has(w)));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
