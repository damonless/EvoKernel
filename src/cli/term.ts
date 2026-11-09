/**
 * Terminal capabilities, ANSI stripping, visual width measurement,
 * line truncation, CLI invocation prefix formatting, and token suggestions.
 *
 * NOTE: Strictly isolated to CLI human-readable rendering.
 * Never imported by src/mcp/* or used to patch process.stdout / console.
 */

export function isColorEnabled(args?: string[]): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') {
    return false;
  }
  if (args && args.includes('--no-color')) {
    return false;
  }
  const hasForceColor =
    process.env.FORCE_COLOR !== undefined &&
    process.env.FORCE_COLOR !== '' &&
    process.env.FORCE_COLOR !== '0';
  if (!process.stdout?.isTTY && !hasForceColor) {
    return false;
  }
  return true;
}

export function isAsciiMode(args?: string[]): boolean {
  if (process.env.EVO_ASCII === '1') {
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
