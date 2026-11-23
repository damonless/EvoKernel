import * as fs from 'node:fs';
import * as path from 'node:path';

export const CORE_SOFTWARE_SYNONYMS: Record<string, string[]> = {
  表格: ['excel', 'xlsx', 'xls', 'spreadsheet', 'table', 'markdown'],
  工作: ['workbook', 'excel', 'xlsx', 'workflow'],
  报告: ['report', 'docx', 'word', 'sop', 'qa', 'weekly', 'summary'],
  文档: ['document', 'docx', 'word', 'report', 'sop', 'markdown'],
  提交: ['commit', 'git', 'message', 'format', 'log'],
  版本: ['version', 'commit', 'release', 'git'],
  日志: ['log', 'commit', 'git', 'trace', 'debug'],
  规范: ['format', 'convention', 'sop', 'standard', 'commit', 'style'],
  调试: ['debug', 'test', 'trace', 'log'],
  接口: ['interface', 'api', 'port', 'endpoint'],
  端口: ['port', 'endpoint', 'interface'],
  配置: ['config', 'configuration', 'settings'],
  网络: ['network', 'net', 'http', 'socket'],
  写作: ['writing', 'draft', 'prose', 'authoring', 'markdown'],
  总结: ['summary', 'recap', 'tldr', 'digest', 'conclusion'],
  周报: ['weekly', 'report', 'status', 'briefing', 'summary'],
  汇报: ['report', 'briefing', 'status', 'presentation', 'summary'],
  排版: ['formatting', 'layout', 'markdown', 'style', 'typography'],
  格式: ['format', 'formatting', 'layout', 'schema', 'template'],
  语气: ['tone', 'voice', 'style', 'attitude', 'communication'],
  风格: ['style', 'tone', 'preference', 'habit', 'voice'],
  简洁: ['concise', 'brief', 'terse', 'short', 'compact'],
  精简: ['concise', 'brief', 'compact', 'short', 'trim'],
  白话: ['plain', 'simple', 'readable', 'concise', 'direct'],
  结论: ['conclusion', 'bottom', 'takeaway', 'tldr', 'summary'],
  列表: ['bullet', 'bullets', 'list', 'checklist', 'items'],
  清单: ['checklist', 'list', 'steps', 'items', 'audit'],
  流程: ['workflow', 'process', 'sop', 'pipeline', 'steps'],
  要求: ['requirement', 'criteria', 'standard', 'constraint', 'rule'],
  审查: ['review', 'audit', 'inspect', 'check', 'critique'],
  评审: ['review', 'critique', 'feedback', 'audit', 'evaluation'],
  习惯: ['habit', 'preference', 'style', 'convention', 'practice'],
  偏好: ['preference', 'habit', 'style', 'choice', 'setting'],
  模板: ['template', 'boilerplate', 'outline', 'format', 'scaffold'],
  大纲: ['outline', 'structure', 'heading', 'skeleton', 'template'],
  邮件: ['email', 'mail', 'message', 'communication', 'letter'],
  会议: ['meeting', 'minutes', 'notes', 'sync', 'agenda'],
  纪要: ['minutes', 'notes', 'summary', 'meeting', 'recap'],
  笔记: ['note', 'notes', 'memo', 'memory', 'record'],
  备忘: ['memo', 'note', 'reminder', 'memory', 'checklist'],
  经验: ['experience', 'lesson', 'memory', 'pitfall', 'insight'],
  教训: ['lesson', 'pitfall', 'experience', 'mistake', 'postmortem'],
  翻译: ['translate', 'translation', 'bilingual', 'localization'],
  双语: ['bilingual', 'translate', 'chinese', 'english', 'localization'],
  沟通: ['communication', 'reply', 'tone', 'response', 'feedback'],
  回复: ['reply', 'response', 'answer', 'communication', 'output'],
  详尽: ['detailed', 'comprehensive', 'thorough', 'verbose', 'exhaustive'],
  详细: ['detailed', 'verbose', 'comprehensive', 'thorough', 'elaborate'],
  步骤: ['step', 'steps', 'procedure', 'workflow', 'sop'],
  标题: ['heading', 'title', 'header', 'structure', 'markdown'],
  中文: ['chinese', 'zh', 'bilingual', 'mandarin'],
  英文: ['english', 'en', 'bilingual'],
  commit: ['git', 'message', 'format', '提交', '规范'],
  git: ['commit', 'branch', 'merge', '提交', '版本'],
  log: ['日志', 'commit', 'git', 'trace'],
  version: ['版本', 'release', 'commit'],
  report: ['报告', '汇报', '周报', 'docx', 'document', 'qa'],
  document: ['文档', 'docx', 'report'],
  debug: ['调试', 'test', 'trace', 'log'],
  config: ['配置', 'settings'],
  writing: ['写作', 'draft', 'prose', 'authoring'],
  summary: ['总结', '汇报', '结论', 'recap', 'tldr', 'brief'],
  weekly: ['周报', 'report', 'status', 'summary'],
  formatting: ['排版', '格式', 'layout', 'markdown', 'style'],
  tone: ['语气', '风格', '沟通', 'voice', 'style'],
  style: ['风格', '语气', '习惯', '偏好', 'formatting'],
  concise: ['简洁', '精简', '白话', 'brief', 'short', 'terse'],
  brief: ['简洁', '精简', 'concise', 'short', 'summary'],
  conclusion: ['结论', '总结', 'takeaway', 'tldr', 'bottom'],
  bullet: ['列表', '清单', 'bullets', 'list', 'concise'],
  checklist: ['清单', '列表', '步骤', '审查', 'steps', 'audit'],
  workflow: ['流程', '工作', '步骤', 'process', 'sop'],
  requirement: ['要求', '规范', 'criteria', 'standard', 'constraint'],
  review: ['审查', '评审', 'audit', 'inspect', 'critique'],
  habit: ['习惯', '偏好', 'style', 'preference'],
  preference: ['偏好', '习惯', 'style', 'habit', 'setting'],
  template: ['模板', '格式', '大纲', 'outline', 'boilerplate'],
  outline: ['大纲', '模板', '标题', 'structure', 'heading'],
  email: ['邮件', '沟通', 'mail', 'message'],
  meeting: ['会议', '纪要', 'minutes', 'notes'],
  minutes: ['纪要', '会议', 'notes', 'summary'],
  note: ['笔记', '备忘', 'memo', 'memory'],
  memo: ['备忘', '笔记', 'note', 'reminder'],
  experience: ['经验', '教训', 'lesson', 'memory', 'pitfall'],
  lesson: ['教训', '经验', 'experience', 'pitfall'],
  translate: ['翻译', '双语', 'translation', 'bilingual'],
  bilingual: ['双语', '翻译', 'chinese', 'english'],
  communication: ['沟通', '回复', '语气', 'reply', 'tone'],
  reply: ['回复', '沟通', 'response', 'answer'],
  detailed: ['详尽', '详细', 'comprehensive', 'verbose', 'thorough'],
  table: ['表格', 'markdown', 'spreadsheet'],
  chinese: ['中文', '双语', 'zh'],
  english: ['英文', '双语', 'en'],
};

export interface PatternExpansionConfig {
  pattern: string;
  flags?: string;
  tokens: string[];
}

export interface DomainLexiconConfig {
  name?: string;
  description?: string;
  synonyms?: Record<string, string[]>;
  pattern_expansions?: PatternExpansionConfig[];
}

export interface CompiledPatternExpansion {
  regex: RegExp;
  tokens: string[];
}

export interface CompiledLexicon {
  synonyms: Record<string, string[]>;
  patternExpansions: CompiledPatternExpansion[];
  canonicalMap: Map<string, string>;
}

export const BASE_CANONICAL_MAP = new Map<string, string>([
  ['提交', 'commit'],
  ['commit', 'commit'],
  ['日志', 'log'],
  ['log', 'log'],
  ['报告', 'report'],
  ['report', 'report'],
  ['文档', 'document'],
  ['document', 'document'],
  ['docx', 'document'],
  ['word', 'document'],
  ['表格', 'spreadsheet'],
  ['spreadsheet', 'spreadsheet'],
  ['excel', 'spreadsheet'],
  ['xlsx', 'spreadsheet'],
  ['xls', 'spreadsheet'],
  ['配置', 'config'],
  ['config', 'config'],
  ['configuration', 'config'],
  ['settings', 'config'],
  ['调试', 'debug'],
  ['debug', 'debug'],
  ['版本', 'version'],
  ['version', 'version'],
  ['release', 'version'],
  ['规范', 'convention'],
  ['convention', 'convention'],
  ['format', 'convention'],
  ['standard', 'convention'],
  ['sop', 'convention'],
  ['接口', 'interface'],
  ['interface', 'interface'],
  ['api', 'interface'],
  ['端口', 'port'],
  ['port', 'port'],
  ['endpoint', 'port'],
  ['网络', 'network'],
  ['network', 'network'],
  ['net', 'network'],
  ['git', 'git'],
  ['branch', 'git'],
  ['工作', 'workbook'],
  ['workbook', 'workbook'],
  ['写作', 'writing'],
  ['writing', 'writing'],
  ['draft', 'writing'],
  ['总结', 'summary'],
  ['summary', 'summary'],
  ['tldr', 'summary'],
  ['周报', 'weekly'],
  ['weekly', 'weekly'],
  ['汇报', 'report'],
  ['排版', 'formatting'],
  ['formatting', 'formatting'],
  ['layout', 'formatting'],
  ['格式', 'convention'],
  ['语气', 'tone'],
  ['tone', 'tone'],
  ['voice', 'tone'],
  ['风格', 'style'],
  ['style', 'style'],
  ['简洁', 'concise'],
  ['精简', 'concise'],
  ['concise', 'concise'],
  ['brief', 'concise'],
  ['terse', 'concise'],
  ['白话', 'plain'],
  ['plain', 'plain'],
  ['结论', 'conclusion'],
  ['conclusion', 'conclusion'],
  ['takeaway', 'conclusion'],
  ['列表', 'bullet'],
  ['bullet', 'bullet'],
  ['bullets', 'bullet'],
  ['清单', 'checklist'],
  ['checklist', 'checklist'],
  ['流程', 'workflow'],
  ['workflow', 'workflow'],
  ['process', 'workflow'],
  ['要求', 'requirement'],
  ['requirement', 'requirement'],
  ['criteria', 'requirement'],
  ['审查', 'review'],
  ['评审', 'review'],
  ['review', 'review'],
  ['audit', 'review'],
  ['习惯', 'habit'],
  ['habit', 'habit'],
  ['偏好', 'preference'],
  ['preference', 'preference'],
  ['模板', 'template'],
  ['template', 'template'],
  ['大纲', 'outline'],
  ['outline', 'outline'],
  ['邮件', 'email'],
  ['email', 'email'],
  ['会议', 'meeting'],
  ['meeting', 'meeting'],
  ['纪要', 'minutes'],
  ['minutes', 'minutes'],
  ['笔记', 'note'],
  ['备忘', 'note'],
  ['note', 'note'],
  ['memo', 'note'],
  ['经验', 'experience'],
  ['教训', 'lesson'],
  ['experience', 'experience'],
  ['lesson', 'lesson'],
  ['翻译', 'translate'],
  ['translate', 'translate'],
  ['双语', 'bilingual'],
  ['bilingual', 'bilingual'],
  ['沟通', 'communication'],
  ['communication', 'communication'],
  ['回复', 'reply'],
  ['reply', 'reply'],
  ['详尽', 'detailed'],
  ['详细', 'detailed'],
  ['detailed', 'detailed'],
  ['步骤', 'step'],
  ['step', 'step'],
  ['标题', 'heading'],
  ['heading', 'heading'],
  ['中文', 'chinese'],
  ['chinese', 'chinese'],
  ['英文', 'english'],
  ['english', 'english'],
]);

export const CANONICAL_SYNONYM_MAP: Map<string, string> = new Map(BASE_CANONICAL_MAP);

export function compileLexiconConfig(config?: DomainLexiconConfig): CompiledLexicon {
  const mergedSynonyms: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(CORE_SOFTWARE_SYNONYMS)) {
    mergedSynonyms[k] = [...v];
  }

  if (config?.synonyms) {
    for (const [k, v] of Object.entries(config.synonyms)) {
      if (Array.isArray(v)) {
        if (mergedSynonyms[k]) {
          const combined = new Set([...mergedSynonyms[k], ...v]);
          mergedSynonyms[k] = Array.from(combined);
        } else {
          mergedSynonyms[k] = [...v];
        }
      }
    }
  }

  const canonicalMap = new Map<string, string>(BASE_CANONICAL_MAP);

  const appendToRootSynonyms = (root: string, tokens: string[]) => {
    const existing = mergedSynonyms[root] || [];
    const combined = new Set<string>(existing);
    for (const tok of tokens) {
      if (tok && tok !== root) {
        combined.add(tok);
      }
    }
    mergedSynonyms[root] = Array.from(combined);
  };

  if (config?.synonyms) {
    // Pass 1: Register standalone ASCII custom keys not yet in BASE_CANONICAL_MAP as their own roots
    // (e.g. "voltage", "current", "adc", "pcb", "pin") so associative neighbor lists do not collapse them.
    for (const key of Object.keys(config.synonyms)) {
      const lowerKey = key.toLowerCase();
      if (/^[a-z0-9_-]+$/.test(lowerKey) && !canonicalMap.has(lowerKey)) {
        canonicalMap.set(lowerKey, lowerKey);
      }
    }

    // Pass 2: Resolve canonical roots for custom keys (including keys already in BASE_CANONICAL_MAP like "网络")
    // and track candidate root claims for unmapped custom synonyms without collapsing CORE_SOFTWARE_SYNONYMS neighbors.
    const keyRootMap = new Map<string, { root: string; synList: string[]; bindSynonyms: boolean }>();
    const candidateSynRoots = new Map<string, Set<string>>();

    for (const [key, synList] of Object.entries(config.synonyms)) {
      if (!Array.isArray(synList)) continue;
      const lowerKey = key.toLowerCase();
      const normalizedSyns = synList.map((t) => String(t).toLowerCase()).filter(Boolean);
      const wasBaseCanonical = BASE_CANONICAL_MAP.has(lowerKey);
      const isNonAsciiKey = !/^[a-z0-9_-]+$/.test(lowerKey);

      let root: string;
      const primaryAscii = normalizedSyns.find((t) => /^[a-z0-9_-]+$/.test(t));
      if (canonicalMap.has(lowerKey)) {
        root = canonicalMap.get(lowerKey)!;
        if (isNonAsciiKey && primaryAscii && !canonicalMap.has(primaryAscii)) {
          canonicalMap.set(primaryAscii, root);
        }
      } else if (isNonAsciiKey) {
        root = primaryAscii ? canonicalMap.get(primaryAscii) || primaryAscii : lowerKey;
        canonicalMap.set(lowerKey, root);
        if (primaryAscii && !canonicalMap.has(primaryAscii)) {
          canonicalMap.set(primaryAscii, root);
        }
      } else {
        root = lowerKey;
        canonicalMap.set(lowerKey, root);
      }

      const bindSynonyms = wasBaseCanonical || isNonAsciiKey;
      keyRootMap.set(key, { root, synList: normalizedSyns, bindSynonyms });

      if (bindSynonyms) {
        for (const syn of normalizedSyns) {
          if (canonicalMap.has(syn)) continue;
          let roots = candidateSynRoots.get(syn);
          if (!roots) {
            roots = new Set<string>();
            candidateSynRoots.set(syn, roots);
          }
          roots.add(root);
        }
      }
    }

    // Pass 3: Append custom synonyms to their canonical root cluster and bind unambiguous unmapped synonyms
    for (const [, { root, synList, bindSynonyms }] of keyRootMap.entries()) {
      if (bindSynonyms) {
        appendToRootSynonyms(root, synList);
        for (const syn of synList) {
          if (!canonicalMap.has(syn)) {
            const roots = candidateSynRoots.get(syn);
            if (roots && roots.size === 1) {
              canonicalMap.set(syn, root);
            }
          }
        }
      }
    }
  }

  const patternExpansions: CompiledPatternExpansion[] = [];
  const nestedQuantifierRe =
    /\([^()]*(?:[+*]|\{\d+,\d*\})[^()]*\)(?:[+*]|\{[2-9]\d*,?\d*\}|\{\d{2,},?\d*\})/;
  if (Array.isArray(config?.pattern_expansions)) {
    for (const item of config.pattern_expansions) {
      if (item && typeof item.pattern === 'string' && Array.isArray(item.tokens)) {
        if (item.pattern.length > 160 || nestedQuantifierRe.test(item.pattern)) {
          // Reject overly long or ReDoS-prone nested quantifier regex patterns
          continue;
        }
        try {
          const safeFlags =
            typeof item.flags === 'string' ? item.flags.replace(/[gy]/g, '') : undefined;
          const regex = new RegExp(item.pattern, safeFlags);
          patternExpansions.push({ regex, tokens: [...item.tokens] });
        } catch {
          // safely skip invalid regex
        }
      }
    }
  }

  return {
    synonyms: mergedSynonyms,
    patternExpansions,
    canonicalMap,
  };
}

const defaultCompiledLexicon = compileLexiconConfig();

interface CacheEntry {
  filePath: string;
  mtimeMs: number;
  compiled: CompiledLexicon;
}

const lexiconCache = new Map<string, CacheEntry>();

export function clearLexiconCache(): void {
  lexiconCache.clear();
}

export function loadWorkspaceLexicon(workspaceOrEvoDir?: string): CompiledLexicon {
  if (!workspaceOrEvoDir) {
    return defaultCompiledLexicon;
  }

  const cleanDir = path.resolve(workspaceOrEvoDir);
  const isEvoDir = path.basename(cleanDir) === '.evo';
  const candidates = isEvoDir
    ? [
        path.join(cleanDir, 'lexicon.json'),
        path.join(path.dirname(cleanDir), 'lexicon.json'),
      ]
    : [
        path.join(cleanDir, '.evo', 'lexicon.json'),
        path.join(cleanDir, 'lexicon.json'),
      ];

  let targetFile: string | null = null;
  let targetMtime = 0;

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const st = fs.statSync(candidate);
        if (st.isFile()) {
          targetFile = candidate;
          targetMtime = st.mtimeMs;
          break;
        }
      }
    } catch {
      // ignore filesystem stat errors
    }
  }

  if (!targetFile) {
    return defaultCompiledLexicon;
  }

  const cached = lexiconCache.get(targetFile);
  if (cached && cached.mtimeMs === targetMtime) {
    return cached.compiled;
  }

  try {
    const raw = fs.readFileSync(targetFile, 'utf8');
    const parsed = JSON.parse(raw) as DomainLexiconConfig;
    const compiled = compileLexiconConfig(parsed);
    lexiconCache.set(targetFile, {
      filePath: targetFile,
      mtimeMs: targetMtime,
      compiled,
    });
    return compiled;
  } catch {
    return defaultCompiledLexicon;
  }
}

export function getCanonicalToken(
  token: string,
  workspaceRootOrLexicon?: string | CompiledLexicon
): string {
  if (!token) return '';
  const lower = token.toLowerCase();
  const lexicon =
    workspaceRootOrLexicon && typeof workspaceRootOrLexicon === 'object'
      ? workspaceRootOrLexicon
      : loadWorkspaceLexicon(workspaceRootOrLexicon);
  const direct = lexicon.canonicalMap.get(lower);
  if (direct) return direct;
  const stemmed = stemEnglishToken(lower);
  if (stemmed && stemmed !== lower) {
    const fromStem = lexicon.canonicalMap.get(stemmed);
    if (fromStem) return fromStem;
  }
  return lower;
}

export function splitCompoundIdentifier(token: string): string[] {
  if (!token) return [];
  const rawSegments = token.split(/[_\-./\\#:@,;()\[\]{}<>+=*&|!?'"`\s]+/);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const seg of rawSegments) {
    if (!seg) continue;
    if (/^0x[0-9a-f]+$/i.test(seg)) {
      const hex = seg.toLowerCase();
      if (hex.length >= 2 && !seen.has(hex)) {
        seen.add(hex);
        result.push(hex);
      }
      continue;
    }
    const spaced = seg
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([0-9])([A-Z][a-z])/g, '$1 $2');
    for (const part of spaced.split(' ')) {
      const lower = part.toLowerCase();
      if (lower.length >= 2 && !seen.has(lower)) {
        seen.add(lower);
        result.push(lower);
      }
    }
  }

  return result;
}

const PROTECTED_STEM_WORDS = new Set([
  'args',
  'https',
  'http',
  'tls',
  'dns',
  'cors',
  'bus',
  'gas',
  'status',
  'class',
  'pass',
  'process',
  'postgres',
  'redis',
  'axios',
  'express',
  'less',
  'css',
  'scss',
  'sass',
  'js',
  'ts',
  'mjs',
  'cjs',
  'rs',
  'cs',
  'os',
  'fs',
  'path',
  'bias',
  'alias',
  'canvas',
  'atlas',
  'nexus',
  'mutex',
  'regex',
  'linux',
  'unix',
  'nginx',
  'macos',
  'windows',
  'ios',
  'this',
  'has',
  'was',
  'is',
  'as',
  'us',
  'its',
  'yes',
  'plus',
  'minus',
  'focus',
  'radius',
  'series',
  'species',
  'success',
  'access',
  'address',
  'progress',
  'harness',
  'unless',
  'always',
  'across',
  'others',
  'aws',
  'gcs',
  'k8s',
  'fps',
  'bps',
  'qps',
  'rps',
  'tps',
  'ops',
  'sys',
  'string',
  'spring',
  'bring',
  'thing',
  'ceiling',
  'sibling',
  'nothing',
  'anything',
  'something',
  'everything',
  'morning',
  'evening',
  'during',
  'meaning',
  'embed',
  'speed',
  'need',
  'seed',
  'feed',
  'bleed',
  'exceed',
  'proceed',
  'succeed',
  'false',
  'there',
  'where',
  'these',
  'those',
  'whose',
  'while',
  'since',
  'above',
  'hence',
  'quite',
  'maybe',
  'alone',
  'issue',
  'value',
  'queue',
  'continue',
  'true',
]);

function restoreSilentTrailingE(stem: string): string {
  if (
    /(?:ch|dg|lv|rv|iz|at|ut|et|ot|gl|pl|bl|tl|dl|kl|zl|ns|rs|rc|nc|rg|gur)$/.test(stem)
  ) {
    return `${stem}e`;
  }
  return stem;
}

export function stemEnglishToken(token: string): string {
  let w = String(token || '').trim().toLowerCase();
  if (!w || w.length < 4 || !/^[a-z]+$/.test(w) || PROTECTED_STEM_WORDS.has(w)) {
    return w;
  }
  if (/(?:ss|us|is|as|os)$/.test(w)) {
    return w;
  }

  if (w.endsWith('izations') && w.length > 10) w = w.slice(0, -1);
  else if (w.endsWith('ications') && w.length > 10) w = w.slice(0, -1);
  else if (w.endsWith('ations') && w.length > 8) w = w.slice(0, -1);

  if (w.endsWith('ization') && w.length > 9) return restoreSilentTrailingE(w.slice(0, -5));
  if (w.endsWith('ication') && w.length > 9) return `${w.slice(0, -7)}y`;
  if (/(?:at|ut|et)ion$/.test(w) && w.length > 7) return restoreSilentTrailingE(w.slice(0, -3));
  if (w.endsWith('ation') && w.length > 7) return restoreSilentTrailingE(w.slice(0, -5));

  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ied') && w.length > 4) return `${w.slice(0, -3)}y`;

  if (w.endsWith('ing') && w.length >= 6) {
    let stem = w.slice(0, -3);
    let collapsed = false;
    if (/([bdgmnprt])\1$/.test(stem) && !(stem.endsWith('dd') && stem.length <= 3)) {
      stem = stem.slice(0, -1);
      collapsed = true;
    }
    if (!collapsed && stem.length === 3 && /^[bcdfghjklmnpqrstvwxz][aeiouy][bcdfglmnprstvz]$/.test(stem)) {
      return `${stem}e`;
    }
    return collapsed ? stem : restoreSilentTrailingE(stem);
  }

  if (w.endsWith('ed') && w.length >= 5 && !w.endsWith('eed')) {
    let stem = w.slice(0, -2);
    let collapsed = false;
    if (/([bdgmnprt])\1$/.test(stem) && !(stem.endsWith('dd') && stem.length <= 3)) {
      stem = stem.slice(0, -1);
      collapsed = true;
    }
    if (!collapsed && stem.length === 3 && /^[bcdfghjklmnpqrstvwxz][aeiouy][bcdfglmnprstvz]$/.test(stem)) {
      return `${stem}e`;
    }
    return collapsed ? stem : restoreSilentTrailingE(stem);
  }

  if (w.endsWith('es') && w.length >= 5) {
    const baseWithoutEs = w.slice(0, -2);
    if (PROTECTED_STEM_WORDS.has(baseWithoutEs)) {
      return baseWithoutEs;
    }
    if (/(?:ches|shes|xes|zes|sses)$/.test(w)) {
      return baseWithoutEs;
    }
    return w.slice(0, -1);
  }

  if (w.endsWith('s') && !w.endsWith('ss') && w.length >= 4) {
    return w.slice(0, -1);
  }

  return w;
}
