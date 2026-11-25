import * as fs from 'node:fs';
import * as path from 'node:path';
import { EvoStorage, resolveGlobalFallbackDir } from './storage.js';
import { EvoTelemetry } from './telemetry.js';
import { parseSymbolTarget } from './memory.js';
import type { CapabilityOutcome, RecalledCapabilityEntry } from './types.js';

export { EvoStorage, EvoTelemetry };

// Strip fenced code blocks, inline code, SQL/HTML/CSS/JSON table/format mentions so code discussions
// do not false-trigger global personal style preference capture.
function stripCodeContextForStyleDetection(raw: string): string {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/\b(?:sql|mysql|postgres|sqlite|dynamodb|html|css|dom|react|vue|tailwind|prettier|eslint|json|csv|xlsx|alter|create|drop|select|join)\s+(?:tables?|format(?:ting)?|layout|concise)\b/gi, ' ')
    .replace(/\b(?:database|db|hash|lookup|routing|pivot|symbol|virtual|data)\s+tables?\b/gi, ' ')
    .replace(/\b(?:date|time|string|number|json|yaml|xml|file|log|url|iso)\s+format(?:ting)?\b/gi, ' ')
    .replace(/(?:数据库|数据|哈希|路由|查询|渲染|前端|页面|组件|SQL|HTML|CSS|Excel)[^\n。！？；;,.]{0,8}(?:表格|排版|格式)/gi, ' ');
}

export const BILINGUAL_STYLE_REGEX =
  /(?:太啰嗦|稍微精简|精简(?:一点|一些|回复|回答|输出)|大白话|不要(?:用)?表格|别用表格|不用表格|回复[^\n。]{0,10}(?:排版|格式|太详细|精简)|不美观|(?:回复|回答|输出)[^\n。]{0,6}(?:格式不对|格式有误)|语言风格|文风|太详细|读起来(?:吃力|费劲)|看(?:起来)?(?:吃力|费劲)|(?:be|more|keep(?:\s+it)?)\s+concise\b|(?:reply|answer|respond|write)\s+concisely\b|too\s+verbose\b|plain\s+language\b|(?:no|never\s+use|don't\s+use|do\s+not\s+use|avoid(?:\s+using)?)\s+(?:markdown\s+)?tables?\b|(?:use|prefer|reply\s+with)\s+bullet\s+points?\b)/i;

export const BILINGUAL_WORKFLOW_REQUIREMENT_REGEX =
  /(?:以后都按这个流程|记住我的要求|每次写周报|汇报标准|以后都这样|from now on|remember my requirement|always follow this workflow|my report format|my standard)/i;

export const BILINGUAL_PERSONAL_EXPERIENCE_REGEX =
  /(?:记住这个经验|个人经验|我的经验|个人笔记|踩过的坑|教训|以后记住|记下来|个人备忘|personal experience|remember this lesson|lesson learned|my note|personal note|note to self|keep this in mind|personal memory|remember for future)/i;

export const CORRECTION_REGEX =
  /(?:不对|错了|还是有|乱码|漏了|为什么(?:把|会|没|要|不|是)|怎么会|难道不是|不就是|不是吗|这么理解对吗|@\[Quote\]|已经确认|实测.*(?:发现|却是|不对|不行)|实际.*(?:显示|追不上|掉|不对|不行|却是)|但(?:实验室|实际|现场)|(?:分析|前面的)?推断是否合理|重新核实|怎么回事|我不是说了|不一致|重新检查|没改对|不生效|回退|不要把|只有一半|显示不全|稍微精简|精简一些|精简(?:一点|回复|回答)|大白话|太详细|太啰嗦|吃力|费劲|不美观|不要冲突|不要重复|重写|重新整理|调整一下|换一种|(?:回复|输出|文档)?格式不对|(?:回复|输出|文档)?格式有误|语言风格|文风|以后都这样|不要(?:用)?表格|别用表格|以后都按这个流程|记住我的要求|每次写周报|汇报标准|you broke|still broken|that's wrong|incorrect|regression|why would|isn't it|shouldn't it|confirmed that|in fact[\s,]|(?:be|more|keep(?:\s+it)?)\s+concise\b|(?:reply|answer|respond|write)\s+concisely\b|too\s+verbose\b|plain\s+language\b|(?:no|never\s+use|don't\s+use|do\s+not\s+use|avoid(?:\s+using)?)\s+(?:markdown\s+)?tables?\b|(?:use|prefer|reply\s+with)\s+bullet\s+points?\b|from now on|remember my requirement|always follow this workflow|my report format|my standard)/i;

export interface ConversationEvolutionSignals {
  hasCorrection: boolean;
  hasStyleCorrection: boolean;
  hasWorkflowRequirement: boolean;
  hasPersonalExperience: boolean;
  shouldRemindPreference: boolean;
  shouldRemindGlobalMemory: boolean;
  matchedTriggers: string[];
  lang?: 'zh' | 'en';
}

export function detectConversationEvolutionSignals(text: string): ConversationEvolutionSignals {
  if (!text || typeof text !== 'string') {
    return {
      hasCorrection: false,
      hasStyleCorrection: false,
      hasWorkflowRequirement: false,
      hasPersonalExperience: false,
      shouldRemindPreference: false,
      shouldRemindGlobalMemory: false,
      matchedTriggers: [],
      lang: 'en',
    };
  }

  const proseOnly = stripCodeContextForStyleDetection(text);
  const hasCjk = /[\u4e00-\u9fff]/.test(proseOnly || text);
  const hasStyleCorrection = BILINGUAL_STYLE_REGEX.test(proseOnly);
  const hasWorkflowRequirement = BILINGUAL_WORKFLOW_REQUIREMENT_REGEX.test(proseOnly);
  const hasPersonalExperience = BILINGUAL_PERSONAL_EXPERIENCE_REGEX.test(proseOnly);
  const hasCorrection =
    CORRECTION_REGEX.test(proseOnly) || hasStyleCorrection || hasWorkflowRequirement;

  const matchedTriggers: string[] = [];
  if (hasCorrection) matchedTriggers.push('correction');
  if (hasStyleCorrection) matchedTriggers.push('style');
  if (hasWorkflowRequirement) matchedTriggers.push('workflow');
  if (hasPersonalExperience) matchedTriggers.push('personal_experience');

  return {
    hasCorrection,
    hasStyleCorrection,
    hasWorkflowRequirement,
    hasPersonalExperience,
    shouldRemindPreference: hasStyleCorrection || hasWorkflowRequirement,
    shouldRemindGlobalMemory: hasPersonalExperience,
    matchedTriggers,
    lang: hasCjk ? 'zh' : 'en',
  };
}

export function buildPreferenceEvolutionHint(
  signals: ConversationEvolutionSignals | null | undefined
): string {
  if (!signals) return '';
  const isZh = signals.lang !== 'en';
  const parts: string[] = [];
  if (
    signals.hasStyleCorrection ||
    signals.hasWorkflowRequirement ||
    signals.shouldRemindPreference
  ) {
    parts.push(
      isZh
        ? '若涉及跨项目通用的个人表达、排版或工作流习惯，请调用 evo_propose(kind: "preference", scope: "global") 记住偏好'
        : 'If this reflects a reusable personal style, formatting, or workflow preference, call evo_propose(kind: "preference", scope: "global") to remember it'
    );
  }
  if (signals.hasPersonalExperience || signals.shouldRemindGlobalMemory) {
    parts.push(
      isZh
        ? '若涉及跨项目个人经验或备忘，请调用 evo_propose(kind: "memory", scope: "global") 记录'
        : 'If this is a cross-workspace personal lesson or note, call evo_propose(kind: "memory", scope: "global") to save it'
    );
  }
  return parts.join(isZh ? '；' : '; ');
}

export function matchesScopeGlob(filePath: string, scopeGlob: string): boolean {
  if (!scopeGlob || scopeGlob === '*' || scopeGlob === '**/*') return true;
  const normalizedFile = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const normalizedGlob = scopeGlob.replace(/\\/g, '/').replace(/^\/+/, '');

  const pattern = normalizedGlob.replace(/\{([^}]+)\}/g, (_match, group) => {
    const parts = group.split(',').map((p: string) => p.trim());
    return `__BRACE_OPEN__${parts.join('__BRACE_OR__')}__BRACE_CLOSE__`;
  });

  let regexStr = pattern
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '__GLOBSTAR_SLASH__')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '__STAR__')
    .replace(/\?/g, '__QUESTION__');

  regexStr = regexStr
    .replace(/__GLOBSTAR_SLASH__/g, '(?:.*\\/)?')
    .replace(/__GLOBSTAR__/g, '.*')
    .replace(/__STAR__/g, '[^\\/]*')
    .replace(/__QUESTION__/g, '[^\\/]')
    .replace(/__BRACE_OPEN__/g, '(?:')
    .replace(/__BRACE_OR__/g, '|')
    .replace(/__BRACE_CLOSE__/g, ')');

  const regex = new RegExp(`^${regexStr}$`, 'i');
  return regex.test(normalizedFile);
}

export function defaultIsCapabilityRelevantToModifiedFiles(
  storage: EvoStorage,
  entry: RecalledCapabilityEntry,
  modifiedFiles?: string[]
): boolean {
  if (!modifiedFiles || modifiedFiles.length === 0) return true;

  const checkRule = () => {
    const rule = storage.getRule(entry.id);
    if (!rule) return undefined;
    if (!rule.scope_glob || rule.scope_glob === '*' || rule.scope_glob === '**/*') {
      return true;
    }
    return modifiedFiles.some((f) => matchesScopeGlob(f, rule.scope_glob));
  };

  const checkTool = () => {
    const tool = storage.getTool(entry.id);
    if (!tool) return undefined;
    const fileGlob = tool.hook_trigger?.file_glob;
    if (!fileGlob || fileGlob === '*' || fileGlob === '**/*') {
      return true;
    }
    return modifiedFiles.some((f) => matchesScopeGlob(f, fileGlob));
  };

  const checkMemory = () => {
    const memory = storage.getMemory(entry.id);
    if (!memory) return undefined;
    const fileHints = new Set<string>();
    for (const sym of memory.target_symbols || []) {
      const parsed = parseSymbolTarget(sym);
      const rawFile = (parsed.fileHint || '').trim();
      if (rawFile) {
        fileHints.add(rawFile.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase());
      }
    }
    for (const fp of Object.values(memory.ast_fingerprints || {})) {
      const fpFile = (fp?.file_path || (fp as any)?.file || '').trim();
      if (fpFile && fpFile !== '(unrecorded)') {
        fileHints.add(fpFile.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase());
      }
    }
    if (fileHints.size === 0) return true;
    return modifiedFiles.some((mf) => {
      const normMf = mf.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();
      for (const hint of fileHints) {
        if (normMf === hint || normMf.endsWith(`/${hint}`) || hint.endsWith(`/${normMf}`)) {
          return true;
        }
      }
      return false;
    });
  };

  if (entry.kind === 'rule') return checkRule() ?? true;
  if (entry.kind === 'tool') return checkTool() ?? true;
  if (entry.kind === 'memory') return checkMemory() ?? true;
  if (entry.kind === 'skill') return true;
  if (entry.kind === 'preference') return true;

  return checkRule() ?? checkTool() ?? checkMemory() ?? true;
}

function resolveRealPathWithFallback(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(resolved)
      : fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isSameResolvedPath(a: string, b: string): boolean {
  const ra = resolveRealPathWithFallback(a);
  const rb = resolveRealPathWithFallback(b);
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return ra.toLowerCase() === rb.toLowerCase();
  }
  return ra === rb;
}

function capabilityExistsInStorage(storage: EvoStorage, id: string): boolean {
  return (
    Boolean(storage.getRule(id)) ||
    Boolean(storage.getSkill(id)) ||
    Boolean(storage.getTool(id)) ||
    Boolean(storage.getMemory(id)) ||
    Boolean(storage.getPreference(id)) ||
    storage.listExternalTools().some((t) => t.id === id)
  );
}

export type CapabilityRelevanceFn = (
  storage: EvoStorage,
  entry: RecalledCapabilityEntry,
  modifiedFiles?: string[]
) => boolean;

export function recordRecalledOutcomeUnified(
  localStorage: EvoStorage,
  localTelemetry: EvoTelemetry,
  entry: RecalledCapabilityEntry,
  outcome: Exclude<CapabilityOutcome, 'neutral'>,
  modifiedFiles?: string[],
  isRelevantFn?: CapabilityRelevanceFn
): void {
  const checkRelevant = isRelevantFn ?? defaultIsCapabilityRelevantToModifiedFiles;
  const existsLocally = capabilityExistsInStorage(localStorage, entry.id);

  if (entry.tier === 'LOCAL') {
    if (existsLocally && checkRelevant(localStorage, entry, modifiedFiles)) {
      localTelemetry.recordCapabilityOutcome(entry.id, outcome);
    }
    return;
  }

  if (existsLocally && entry.tier !== 'GLOBAL') {
    if (!checkRelevant(localStorage, entry, modifiedFiles)) {
      return;
    }
    localTelemetry.recordCapabilityOutcome(entry.id, outcome);
    return;
  }

  const globalRoot = resolveGlobalFallbackDir();

  if (fs.existsSync(path.join(globalRoot, '.evo'))) {
    const globalStorage = new EvoStorage(globalRoot);
    const existsGlobally = capabilityExistsInStorage(globalStorage, entry.id);

    if (existsGlobally) {
      if (!checkRelevant(globalStorage, entry, modifiedFiles)) {
        return;
      }
      if (isSameResolvedPath(globalRoot, localStorage.rootDir)) {
        localTelemetry.recordCapabilityOutcome(entry.id, outcome);
      } else {
        const globalTelemetry = new EvoTelemetry(globalStorage);
        try {
          globalTelemetry.recordCapabilityOutcome(entry.id, outcome, {
            skipRecallEventsUpdate: true,
          });
          if (outcome === 'helped') {
            localTelemetry.markRecallEventHelped(entry.id);
          }
        } finally {
          globalTelemetry.close();
        }
      }
      return;
    }
  }

  if (existsLocally) {
    if (!checkRelevant(localStorage, entry, modifiedFiles)) {
      return;
    }
    localTelemetry.recordCapabilityOutcome(entry.id, outcome);
    return;
  }

  if (entry.tier === 'GLOBAL' && outcome === 'helped') {
    localTelemetry.markRecallEventHelped(entry.id);
  }
}
