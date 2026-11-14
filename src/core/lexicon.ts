import * as fs from 'node:fs';
import * as path from 'node:path';

export const CORE_SOFTWARE_SYNONYMS: Record<string, string[]> = {
  表格: ['excel', 'xlsx', 'xls', 'spreadsheet'],
  工作: ['workbook', 'excel', 'xlsx'],
  报告: ['report', 'docx', 'word', 'sop', 'qa'],
  文档: ['document', 'docx', 'word', 'report', 'sop'],
  提交: ['commit', 'git', 'message', 'format', 'log'],
  版本: ['version', 'commit', 'release', 'git'],
  日志: ['log', 'commit', 'git', 'trace', 'debug'],
  规范: ['format', 'convention', 'sop', 'standard', 'commit'],
  调试: ['debug', 'test', 'trace', 'log'],
  接口: ['interface', 'api', 'port', 'endpoint'],
  端口: ['port', 'endpoint', 'interface'],
  配置: ['config', 'configuration', 'settings'],
  网络: ['network', 'net', 'http', 'socket'],
  commit: ['git', 'message', 'format', '提交', '规范'],
  git: ['commit', 'branch', 'merge', '提交', '版本'],
  log: ['日志', 'commit', 'git', 'trace'],
  version: ['版本', 'release', 'commit'],
  report: ['报告', 'docx', 'document', 'qa'],
  document: ['文档', 'docx', 'report'],
  debug: ['调试', 'test', 'trace', 'log'],
  config: ['配置', 'settings'],
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
  return lexicon.canonicalMap.get(lower) || lower;
}
