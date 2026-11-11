/**
 * Terminal capabilities, ANSI stripping, visual width measurement,
 * line truncation, CLI invocation prefix formatting, and token suggestions.
 *
 * NOTE: Strictly isolated to CLI human-readable rendering.
 * Never imported by src/mcp/* or used to patch process.stdout / console.
 */

export function isColorEnabled(
  args?: string[],
  env: Record<string, string | undefined> = process.env,
  isTTY: boolean = Boolean(process.stdout?.isTTY)
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false;
  }
  if (args && args.includes('--no-color')) {
    return false;
  }
  const forceVal = env.FORCE_COLOR?.trim().toLowerCase();
  if (forceVal === '0' || forceVal === 'false') {
    return false;
  }
  const hasForceColor = forceVal !== undefined && forceVal !== '';
  if (!isTTY && !hasForceColor) {
    return false;
  }
  return true;
}

export function isAsciiMode(
  args?: string[],
  env: Record<string, string | undefined> = process.env
): boolean {
  const envVal = env.EVO_ASCII?.trim().toLowerCase();
  if (envVal === '1' || envVal === 'true') {
    return true;
  }
  if (args && args.includes('--ascii')) {
    return true;
  }
  return false;
}

export function stripAnsi(str: string): string {
  if (!str) return '';
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function toAsciiOutput(str: string): string {
  if (!str) return '';
  let out = stripAnsi(str);
  out = out
    .replace(/置信度/g, 'Confidence')
    .replace(/\[✓\]/g, '[OK]')
    .replace(/\[✗\]/g, '[FAIL]')
    .replace(/✅\s?/g, '[OK] ')
    .replace(/❌\s?/g, '[ERROR] ')
    .replace(/⚠️?\s?/g, '[WARN] ')
    .replace(/🔍\uFE0F?[ ]?/g, '[SCAN] ')
    .replace(/🚀\uFE0F?[ ]?/g, '[NEXT] ')
    .replace(/🧹\uFE0F?[ ]?/g, '[CLEAN] ')
    .replace(/🔌\uFE0F?[ ]?/g, '[IDE] ')
    .replace(/✓/g, 'OK')
    .replace(/✗/g, 'X')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/≠/g, '!=')
    .replace(/↔/g, '<->')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[╭╮╰╯╔╗╚╝┌┐└┘├┤┬┴┼╠╣╦╩╬]/g, '+')
    .replace(/[─═━]/g, '-')
    .replace(/[│║┃]/g, '|')
    .replace(/█/g, '#')
    .replace(/░/g, '.')
    .replace(/[—–]/g, '--')
    .replace(/×/g, 'x')
    .replace(/[•·]/g, '*')
    .replace(/…/g, '...')
    .replace(/[\uFE0E\uFE0F]/g, '');

  // Strip remaining non-ASCII glyphs (e.g. emojis/CJK headers) cleanly without leaving double spaces
  out = out.replace(/[^\x00-\x7F]+[ ]{1,2}/g, '').replace(/[^\x00-\x7F]+/g, '');

  // Keep framed ASCII header boxes (+---+ / | ... | / +---+) flush-right aligned after glyph width changes
  if (out.includes('+---')) {
    const lines = out.split('\n');
    const borderRe = /^\+-{10,}\+$/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('| ') || !line.endsWith(' |')) continue;
      const adjBorder =
        (i > 0 && borderRe.test(lines[i - 1]) ? lines[i - 1] : '') ||
        (i + 1 < lines.length && borderRe.test(lines[i + 1]) ? lines[i + 1] : '');
      if (!adjBorder) continue;
      const targetLen = adjBorder.length;
      if (line.length < targetLen) {
        lines[i] = line.slice(0, -1) + ' '.repeat(targetLen - line.length) + '|';
      } else if (line.length > targetLen) {
        const excess = line.length - targetLen;
        const m = line.match(/^(.*?)( +)\|$/);
        if (m && m[2].length > excess) {
          lines[i] = m[1] + ' '.repeat(m[2].length - excess) + '|';
        }
      }
    }
    out = lines.join('\n');
  }

  return out;
}

export function formatTerminalOutput(
  str: string,
  options?: { color?: boolean; ascii?: boolean }
): string {
  if (!str) return '';
  if (options?.ascii) {
    return toAsciiOutput(str);
  }
  if (options?.color === false) {
    return stripAnsi(str);
  }
  return str;
}

export function visualWidth(str: string): number {
  if (!str) return 0;
  const clean = stripAnsi(str);
  let width = 0;
  for (const ch of clean) {
    const cp = ch.codePointAt(0) || 0;
    if (
      (cp >= 0x2e80 && cp <= 0x9fff) ||
      (cp >= 0xff00 && cp <= 0xffef) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x20000 && cp <= 0x3ffff)
    ) {
      width += 2;
    } else if (cp >= 0xfe00 && cp <= 0xfe0f) {
      // Variation selector takes 0 terminal columns
      continue;
    } else {
      width += 1;
    }
  }
  return width;
}

export function truncateTerminalLine(
  line: string,
  maxCols?: number,
  full?: boolean
): string {
  if (full) {
    return line;
  }
  const limit =
    maxCols ||
    (process.stdout?.columns && process.stdout.columns > 40
      ? Math.min(process.stdout.columns, 120)
      : 100);

  if (visualWidth(line) <= limit) {
    return line;
  }

  const targetWidth = Math.max(0, limit - 3);
  let currentWidth = 0;
  let result = '';
  let hasAnsi = false;

  // Tokenize ANSI escapes vs text chunks
  const ansiRegex = /(\x1b\[[0-9;]*[a-zA-Z])/g;
  const tokens = line.split(ansiRegex);

  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith('\x1b[')) {
      hasAnsi = true;
      result += token;
      continue;
    }
    for (const ch of token) {
      const cp = ch.codePointAt(0) || 0;
      let w = 1;
      if (
        (cp >= 0x2e80 && cp <= 0x9fff) ||
        (cp >= 0xff00 && cp <= 0xffef) ||
        (cp >= 0x1f300 && cp <= 0x1faff) ||
        (cp >= 0x2600 && cp <= 0x27bf) ||
        (cp >= 0x20000 && cp <= 0x3ffff)
      ) {
        w = 2;
      } else if (cp >= 0xfe00 && cp <= 0xfe0f) {
        w = 0;
      }
      if (currentWidth + w > targetWidth) {
        return result + '...' + (hasAnsi ? '\x1b[0m' : '');
      }
      currentWidth += w;
      result += ch;
    }
  }
  return result + '...' + (hasAnsi ? '\x1b[0m' : '');
}

export function formatCliInvocationPrefix(argv: string[] = process.argv): string {
  const entry = argv && argv[1] ? argv[1] : '';
  if (entry.includes('_npx') || entry.includes('npx')) {
    return 'npx evo-kernel';
  }
  return 'evo';
}

function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const row: number[] = [];
  for (let j = 0; j <= bn; j++) {
    row[j] = j;
  }
  for (let i = 1; i <= an; i++) {
    let prevDiag = row[0];
    row[0] = i;
    for (let j = 1; j <= bn; j++) {
      const temp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j] + 1, // deletion
        row[j - 1] + 1, // insertion
        prevDiag + cost // substitution
      );
      prevDiag = temp;
    }
  }
  return row[bn];
}

export function suggestClosestToken(
  input: string,
  candidates: string[],
  maxDist = 3
): string | null {
  const norm = input.trim().toLowerCase();
  if (!norm) return null;
  let bestCandidate: string | null = null;
  let bestDist = maxDist + 1;

  for (const cand of candidates) {
    const candNorm = cand.trim().toLowerCase();
    if (candNorm === norm) {
      return cand;
    }
    if (candNorm.startsWith(norm) && candNorm.length - norm.length <= maxDist) {
      const dist = candNorm.length - norm.length;
      if (dist < bestDist) {
        bestDist = dist;
        bestCandidate = cand;
      }
      continue;
    }
    const d = levenshtein(norm, candNorm);
    if (d < bestDist) {
      bestDist = d;
      bestCandidate = cand;
    }
  }
  return bestDist <= maxDist ? bestCandidate : null;
}
