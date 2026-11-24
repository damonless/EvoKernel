import * as crypto from 'node:crypto';
import type { PreferenceCategory } from './types.js';
import { PREFERENCE_CATEGORIES, sanitizeId } from './storage.js';

export interface ParsedPreferenceCandidate {
  id: string;
  category: PreferenceCategory;
  title: string;
  l0_summary: string;
  content: string;
  always_on: boolean;
  trigger_cue?: string;
}

export type OnboardingPresetName =
  | 'concise-ceo'
  | 'rigorous-engineer'
  | 'technical-writer';

export interface OnboardingPresetDefinition {
  id: OnboardingPresetName;
  name: string;
  description: string;
  candidates: ParsedPreferenceCandidate[];
}

const CATEGORY_KEYWORD_PATTERNS: Array<{
  category: PreferenceCategory;
  pattern: RegExp;
}> = [
  {
    category: 'formatting',
    pattern:
      /\b(?:format(?:ting)?|layout|markdown|tables?|indent(?:ation)?|lint(?:ing)?|prettier|eslint|headings?|bullets?|json|yaml|csv|xlsx|docx|whitespace|newline|line[- ]?wrap)\b|排版|格式|表格|缩进|列表|换行/i,
  },
  {
    category: 'communication',
    pattern:
      /\b(?:comm(?:unication)?|repl(?:y|ies)|respond|response|answer|tone|language|english|chinese|bilingual|concise|brief(?:ly)?|tl;?dr|bottom[- ]?line|confidence|flattery|sycophancy|prose|verbosity|plain[- ]?spoken)\b|沟通|回复|回答|语气|语言|中文|英文|简洁|结论先行|置信度|大白话/i,
  },
  {
    category: 'requirement',
    pattern:
      /\b(?:requirements?|mandatory|compliance|security|secrets?|credential|forbid(?:den)?|prohibit(?:ed)?|guardrail|invariant|constraints?|acceptance|must[- ]?not)\b|禁止|严禁|必须|底线|要求|约束|合规|安全|验收/i,
  },
  {
    category: 'workflow',
    pattern:
      /\b(?:workflow|process|sop|git|commit|branch|tests?|testing|build|deploy|review|tdd|debug|verify|verification|pr|pull[- ]?request|ci|cd|refactor|patch|diff)\b|工作流|流程|提交|测试|构建|部署|审查|验证|调试/i,
  },
  {
    category: 'knowledge',
    pattern:
      /\b(?:knowledge|domain|glossary|terms?|terminology|architecture|schema|stack|conventions?|context|reference|docs|documentation|links?)\b|知识|术语|领域|架构|规范|约定|文档/i,
  },
  {
    category: 'style',
    pattern:
      /\b(?:style|preferences?|habits?|naming|comments?|docstrings?|clean|minimal|idiomatic|readable)\b|风格|习惯|偏好|命名|注释/i,
  },
];

function matchCategoryFromText(text: string): PreferenceCategory | null {
  if (!text) return null;
  for (const { category, pattern } of CATEGORY_KEYWORD_PATTERNS) {
    if (pattern.test(text)) {
      return category;
    }
  }
  return null;
}

export function inferPreferenceCategory(
  directiveText: string,
  heading: string,
  explicitCategory?: string,
  sourceLabel?: string
): PreferenceCategory {
  if (explicitCategory) {
    const norm = explicitCategory.trim().toLowerCase() as PreferenceCategory;
    if (PREFERENCE_CATEGORIES.includes(norm)) {
      return norm;
    }
  }
  return (
    matchCategoryFromText(directiveText) ||
    matchCategoryFromText(heading) ||
    matchCategoryFromText(sourceLabel || '') ||
    'style'
  );
}

function stripFencedCodeBlocks(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inFence) {
      const openMatch = trimmed.match(/^(`{3,}|~{3,})/);
      if (openMatch) {
        inFence = true;
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        continue;
      }
      kept.push(line);
    } else {
      const closeMatch = trimmed.match(/^(`{3,}|~{3,})\s*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
    }
  }
  return kept.join('\n');
}

export function cleanMarkdownInline(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferSituationalOnDemand(text: string): {
  alwaysOn: boolean;
  triggerCue?: string;
} {
  const raw = String(text || '').trim();
  if (!raw) return { alwaysOn: true };

  let hasOnDemandMarker = /\[on-demand\]/i.test(raw);
  const triggerAttrMatch = raw.match(/\(trigger:\s*([^)]+)\)/i);
  if (triggerAttrMatch && triggerAttrMatch[1]?.trim()) {
    return {
      alwaysOn: false,
      triggerCue: triggerAttrMatch[1].trim().slice(0, 120),
    };
  }

  const stripped = raw.replace(/\[on-demand\]/gi, '').trim();

  // Chinese situational triggers: e.g., 写周报时..., 写代码评审时..., 当...时, 在...时
  const zhActionMatch = stripped.match(
    /(?:^|[\s，,。；;])(?:当|在|每次|如果)?((?:写|做|进行|处理|生成|总结|分析|调试|排查|评审|审查|回复|沟通|部署|重构)[^，,。；;：:\n]{1,30}?时)/
  );
  if (zhActionMatch && zhActionMatch[1]?.trim()) {
    return {
      alwaysOn: false,
      triggerCue: zhActionMatch[1].trim().slice(0, 120),
    };
  }

  const zhGenericMatch = stripped.match(
    /(?:^|[\s，,。；;])((?:当|在)[^，,。；;：:\n]{2,30}?时)/
  );
  if (zhGenericMatch && zhGenericMatch[1]?.trim()) {
    return {
      alwaysOn: false,
      triggerCue: zhGenericMatch[1].trim().slice(0, 120),
    };
  }

  // English situational triggers: e.g., when writing ..., when reviewing ..., during code review
  const enWhenMatch = stripped.match(
    /\b((?:when|whenever|while)\s+(?:writing|reviewing|summarizing|debugging|generating|drafting|creating|editing|analyzing|deploying|refactoring)\b[^,.;:\n]{0,60})/i
  );
  if (enWhenMatch && enWhenMatch[1]?.trim()) {
    return {
      alwaysOn: false,
      triggerCue: enWhenMatch[1].trim().slice(0, 120),
    };
  }

  const enDuringMatch = stripped.match(
    /\b(during\s+(?:code\s+reviews?|reviews?|weekly\s+reports?|debugging|incidents?|planning|standups?))\b/i
  );
  if (enDuringMatch && enDuringMatch[1]?.trim()) {
    return {
      alwaysOn: false,
      triggerCue: enDuringMatch[1].trim().slice(0, 120),
    };
  }

  if (hasOnDemandMarker) {
    return {
      alwaysOn: false,
      triggerCue: cleanMarkdownInline(stripped).slice(0, 120) || 'on-demand',
    };
  }

  return { alwaysOn: true };
}

export function buildDeterministicId(
  seedSource: string,
  rawText: string,
  seenIds: Set<string>,
  isExplicitId: boolean = false
): string {
  const asciiSeed = seedSource
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9\s_-]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-');

  let baseId = sanitizeId(asciiSeed);
  if (!isExplicitId && baseId && !/[a-z]/i.test(baseId)) {
    baseId = '';
  }
  if (!isExplicitId && /^(?:\d+[a-z0-9]*|proj-[a-z0-9]+|project-[a-z0-9]+)-/i.test(baseId)) {
    baseId = `pref-${baseId}`;
  }
  if (baseId.length > 48) {
    const sliced = baseId.slice(0, 48);
    const lastDash = sliced.lastIndexOf('-');
    baseId = (lastDash >= 12 ? sliced.slice(0, lastDash) : sliced).replace(/-+$/, '');
  }

  if (!baseId || baseId.length < 3) {
    const shortHash = crypto.createHash('sha256').update(rawText).digest('hex').slice(0, 8);
    baseId = `pref-${shortHash}`;
  }

  let finalId = baseId;
  let suffix = 2;
  while (seenIds.has(finalId)) {
    const suffixStr = `-${suffix++}`;
    const maxPrefixLen = Math.max(3, 48 - suffixStr.length);
    const trimmedPrefix = baseId.slice(0, maxPrefixLen).replace(/-+$/, '');
    finalId = `${trimmedPrefix}${suffixStr}`;
  }
  seenIds.add(finalId);
  return finalId;
}

export function parseMarkdownToPreferenceCandidates(
  markdownText: string,
  sourceLabel?: string
): ParsedPreferenceCandidate[] {
  // 1. Strip UTF-8 BOM, EvoKernel managed rule/profile blocks, YAML frontmatter, and fenced code blocks FIRST,
  //    then strip remaining HTML comments so comments inside fenced code blocks cannot swallow later sections.
  const withoutEvoBlocks = String(markdownText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/<!--\s*EVO:START\s*-->[\s\S]*?<!--\s*EVO:END\s*-->/gi, '\n')
    .replace(/<!--\s*EVO:PROFILE:START\s*-->[\s\S]*?<!--\s*EVO:PROFILE:END\s*-->/gi, '\n')
    .trimStart()
    .replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');

  const withoutCodeBlocks = stripFencedCodeBlocks(withoutEvoBlocks);
  const cleaned = withoutCodeBlocks.replace(/<!--[\s\S]*?-->/g, '\n');
  const lines = cleaned.split('\n');

  let currentHeading = '';
  let proseParagraph: string[] = [];

  const rawItems: Array<{
    heading: string;
    rawText: string;
  }> = [];

  const flushProseParagraph = () => {
    if (proseParagraph.length > 0) {
      const prose = proseParagraph.join(' ').replace(/\s+/g, ' ').trim();
      const isTrivialListIntro = prose.length < 90 && /[:：]$/.test(prose);
      if (
        prose.length >= 4 &&
        !isTrivialListIntro &&
        !/^[-*_]{3,}$/.test(prose) &&
        !/^\|.*\|$/.test(prose)
      ) {
        rawItems.push({
          heading: currentHeading,
          rawText: prose,
        });
      }
    }
    proseParagraph = [];
  };

  let activeBullet: { heading: string; lines: string[] } | null = null;
  const flushBullet = () => {
    if (activeBullet) {
      const joined = activeBullet.lines.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length >= 4 && !/^[-*_]{3,}$/.test(joined)) {
        rawItems.push({
          heading: activeBullet.heading,
          rawText: joined,
        });
      }
      activeBullet = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      flushBullet();
      flushProseParagraph();
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flushBullet();
      flushProseParagraph();
      currentHeading = cleanMarkdownInline(headingMatch[1]);
      continue;
    }

    const bulletMatch = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (bulletMatch) {
      flushBullet();
      flushProseParagraph();
      activeBullet = {
        heading: currentHeading,
        lines: [bulletMatch[1].trim()],
      };
      continue;
    }

    if (!trimmed) {
      flushBullet();
      flushProseParagraph();
      continue;
    }

    if (activeBullet && /^\s{2,}\S/.test(line)) {
      activeBullet.lines.push(trimmed);
      continue;
    }

    flushBullet();
    if (/^\|.*\|$/.test(trimmed)) {
      flushProseParagraph();
      continue;
    }
    proseParagraph.push(trimmed);
  }
  flushBullet();
  flushProseParagraph();

  const seenNormalizedContent = new Set<string>();
  const seenIds = new Set<string>();
  const candidates: ParsedPreferenceCandidate[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const entry = rawItems[i];
    let text = entry.rawText.trim();
    let explicitTitle = '';
    let explicitId = '';
    let explicitCategory = '';
    let alwaysOn = true;
    let triggerCue: string | undefined;

    // Parse patterns like "**[id]** (cat): summary" or "**Title**: body"
    const bracketMatch = text.match(/^\*\*\[([^\]]+)\]\*\*\s*(?:\(([^)]+)\))?\s*[:：]\s*(.+)$/);
    if (bracketMatch) {
      explicitId = bracketMatch[1].trim();
      explicitCategory = (bracketMatch[2] || '').trim();
      text = bracketMatch[3].trim();
    } else {
      const boldLeadMatch = text.match(/^\*\*([^*]+)\*\*\s*[:：-]\s*(.+)$/);
      if (boldLeadMatch) {
        explicitTitle = boldLeadMatch[1].trim();
        text = boldLeadMatch[2].trim();
      }
    }

    // Optional [on-demand] / (trigger: ...) markers
    const onDemandPrefix = text.match(/^\[on-demand\]\s*(.+)$/i);
    if (onDemandPrefix) {
      alwaysOn = false;
      text = onDemandPrefix[1].trim();
    }
    const triggerMatch = text.match(/\s*\(trigger:\s*([^)]+)\)\s*$/i);
    if (triggerMatch) {
      alwaysOn = false;
      triggerCue = triggerMatch[1].trim();
      text = text.slice(0, triggerMatch.index).trim();
    }

    const cleanBody = text.replace(/\s+/g, ' ').trim();
    if (!cleanBody || cleanBody.length < 4) continue;

    const dedupKey = cleanBody.toLowerCase();
    if (seenNormalizedContent.has(dedupKey)) {
      continue;
    }
    seenNormalizedContent.add(dedupKey);

    const cleanTitle =
      cleanMarkdownInline(explicitTitle || cleanBody).slice(0, 72) || `Preference ${candidates.length + 1}`;
    const l0Summary = cleanMarkdownInline(cleanBody).slice(0, 130) || cleanTitle;
    const category = inferPreferenceCategory(
      `${explicitTitle} ${cleanBody}`,
      entry.heading,
      explicitCategory,
      sourceLabel
    );
    const idSeed = explicitId || explicitTitle || l0Summary || entry.heading;
    const id = buildDeterministicId(idSeed, cleanBody, seenIds, Boolean(explicitId));

    candidates.push({
      id,
      category,
      title: cleanTitle,
      l0_summary: l0Summary,
      content: cleanBody,
      always_on: alwaysOn,
      ...(triggerCue ? { trigger_cue: triggerCue } : {}),
    });
  }

  return candidates;
}

export const ONBOARDING_PRESETS: Record<OnboardingPresetName, OnboardingPresetDefinition> = {
  'concise-ceo': {
    id: 'concise-ceo',
    name: 'Concise CEO',
    description:
      'Bottom-line first, 3-5 bullet plain-spoken delivery, no boilerplate/flattery, flag risks & confidence upfront.',
    candidates: [
      {
        id: 'ceo-bottom-line-first',
        category: 'communication',
        title: 'Bottom-line first delivery',
        l0_summary: 'Lead every response with the core decision, status, or answer before details.',
        content:
          'Put the bottom-line conclusion or recommendation in the opening lines before supporting evidence.',
        always_on: true,
      },
      {
        id: 'ceo-plain-bullet-delivery',
        category: 'formatting',
        title: '3-5 bullet plain-spoken summary',
        l0_summary: 'Summarize outcomes in 3-5 concise plain-spoken bullets.',
        content:
          'Deliver final summaries as 3-5 plain-spoken bullets covering what changed, files touched, and test results.',
        always_on: true,
      },
      {
        id: 'ceo-no-flattery-boilerplate',
        category: 'communication',
        title: 'Zero flattery or boilerplate',
        l0_summary: 'Omit sycophancy, emotional praise, and generic AI disclaimers.',
        content:
          'Never include filler compliments, sycophancy, or boilerplate disclaimers; keep tone direct and objective.',
        always_on: true,
      },
      {
        id: 'ceo-flag-risks-confidence',
        category: 'requirement',
        title: 'Flag risks and confidence upfront',
        l0_summary: 'Call out edge-case risks, unknowns, and explicit confidence levels early.',
        content:
          'Explicitly state confidence levels, unverified edge cases, and failure risks upfront rather than burying caveats.',
        always_on: true,
      },
    ],
  },
  'rigorous-engineer': {
    id: 'rigorous-engineer',
    name: 'Rigorous Engineer',
    description:
      'Root-cause before patch, minimal diff, always run real build & tests, preserve existing comments/docstrings.',
    candidates: [
      {
        id: 'eng-root-cause-first',
        category: 'workflow',
        title: 'Root-cause before patch',
        l0_summary: 'Confirm and explain the underlying root cause before editing code.',
        content:
          'Inspect failing paths and verify the true root cause before writing patches instead of guessing symptoms.',
        always_on: true,
      },
      {
        id: 'eng-minimal-focused-diff',
        category: 'style',
        title: 'Minimal focused diff',
        l0_summary: 'Keep changes tightly scoped to the task without unrelated refactors.',
        content:
          'Produce minimal, focused diffs matching surrounding conventions and avoid unrelated cleanups or scope creep.',
        always_on: true,
      },
      {
        id: 'eng-run-real-tests',
        category: 'workflow',
        title: 'Run real build and test suite',
        l0_summary: 'Always execute real build and test commands after edits and report exact results.',
        content:
          'Always run the real build and test suite (including edge cases) after changes rather than relying on manual inspection.',
        always_on: true,
      },
      {
        id: 'eng-preserve-comments',
        category: 'style',
        title: 'Preserve existing comments and docstrings',
        l0_summary: 'Keep existing inline comments, docstrings, and invariants intact.',
        content:
          'Preserve existing inline comments, docstrings, and design rationale unless directly invalidated by the fix.',
        always_on: true,
      },
    ],
  },
  'technical-writer': {
    id: 'technical-writer',
    name: 'Technical Writer',
    description:
      'Structured headings, consistent terminology, concrete runnable examples, verify links & formatting.',
    candidates: [
      {
        id: 'writer-structured-headings',
        category: 'formatting',
        title: 'Structured hierarchical headings',
        l0_summary: 'Organize documentation with clear, non-skipping hierarchical headings.',
        content:
          'Use clean hierarchical headings and scannable sections without skipping heading levels.',
        always_on: true,
      },
      {
        id: 'writer-consistent-terminology',
        category: 'knowledge',
        title: 'Consistent domain terminology',
        l0_summary: 'Use canonical product and technical terms consistently across sections.',
        content:
          'Keep terminology, symbol names, and glossary terms consistent throughout the document without silent synonyms.',
        always_on: true,
      },
      {
        id: 'writer-runnable-examples',
        category: 'communication',
        title: 'Concrete runnable examples',
        l0_summary: 'Provide concrete, copy-pasteable, runnable examples for commands and APIs.',
        content:
          'Back explanations with concrete, runnable examples showing exact commands, flags, and expected output.',
        always_on: true,
      },
      {
        id: 'writer-verify-links-format',
        category: 'workflow',
        title: 'Verify links and markdown formatting',
        l0_summary: 'Check all file links, anchors, code fences, and formatting before finalizing.',
        content:
          'Verify every file link, anchor, code fence language tag, and markdown structure before final delivery.',
        always_on: true,
      },
    ],
  },
};

export function getOnboardingPresetCandidates(presetName: string): ParsedPreferenceCandidate[] {
  const key = String(presetName || '').trim().toLowerCase() as OnboardingPresetName;
  const preset = ONBOARDING_PRESETS[key];
  if (!preset) {
    const validNames = Object.keys(ONBOARDING_PRESETS).join(', ');
    throw new Error(`Unknown onboarding preset '${presetName}'. Valid presets: ${validNames}`);
  }
  return preset.candidates.map((c) => ({ ...c }));
}
