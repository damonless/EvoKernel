import * as crypto from 'node:crypto';

function canPrecedeRegexLiteral(out: string): boolean {
  const trimmed = out.trimEnd();
  if (!trimmed) return true;
  if (trimmed.endsWith('++') || trimmed.endsWith('--')) return false;
  const lastChar = trimmed[trimmed.length - 1];
  if ('=(:[{,;!&|?^~<>+-*%'.includes(lastChar)) return true;
  return /(?:^|[^\w$])(return|case|throw|yield|await|typeof|delete|void|default|do|else|in|instanceof|of)$/.test(
    trimmed
  );
}

export function trySkipGenericAngles(masked: string, pos: number): number {
  if (pos >= masked.length || masked[pos] !== '<') return pos;
  if (pos + 1 < masked.length && (masked[pos + 1] === '=' || masked[pos + 1] === '<')) return pos;
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  const maxScan = Math.min(masked.length, pos + 2000);

  for (let i = pos; i < maxScan; i++) {
    const ch = masked[i];
    if (
      (ch === ';' && braceDepth === 0) ||
      (angleDepth === 0 && (ch === '{' || ch === '}' || ch === ')' || ch === ']'))
    ) {
      return pos;
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') {
      if (parenDepth === 0) return pos;
      parenDepth--;
    } else if (ch === '[') bracketDepth++;
    else if (ch === ']') {
      if (bracketDepth === 0) return pos;
      bracketDepth--;
    } else if (ch === '{') braceDepth++;
    else if (ch === '}') {
      if (braceDepth === 0) return pos;
      braceDepth--;
    } else if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      if (ch === '<') {
        angleDepth++;
      } else if (ch === '>' && (i === 0 || (masked[i - 1] !== '=' && masked[i - 1] !== '-'))) {
        angleDepth--;
        if (angleDepth === 0) {
          return i + 1;
        }
      }
    }
  }
  return pos;
}

function isNumericDigitSeparator(src: string, idx: number): boolean {
  if (idx <= 0 || idx + 1 >= src.length) return false;
  if (!/[0-9a-fA-F]/.test(src[idx - 1]) || !/[0-9a-fA-F]/.test(src[idx + 1])) {
    return false;
  }
  let p = idx - 1;
  while (p >= 0 && /[0-9a-fA-F'xXbB.]/.test(src[p])) {
    p--;
  }
  const tokenStart = src[p + 1];
  if (!/[0-9]/.test(tokenStart)) return false;
  if (p >= 0 && /[A-Za-z_$]/.test(src[p])) return false;
  return true;
}

function matchRustRawString(src: string, idx: number): { endIdx: number; prefixLen: number } | null {
  if (src[idx] !== 'r') return null;
  let prefixLen = 0;
  if (idx > 0 && /[A-Za-z0-9_]/.test(src[idx - 1])) {
    const prev = src[idx - 1];
    if ((prev !== 'b' && prev !== 'c') || (idx >= 2 && /[A-Za-z0-9_]/.test(src[idx - 2]))) {
      return null;
    }
    prefixLen = 1;
  }
  let k = idx + 1;
  while (k < src.length && src[k] === '#') {
    k++;
  }
  if (k >= src.length || src[k] !== '"') return null;
  const hashCount = k - (idx + 1);
  const closeSeq = '"' + '#'.repeat(hashCount);
  const closePos = src.indexOf(closeSeq, k + 1);
  if (closePos === -1) {
    return { endIdx: src.length, prefixLen };
  }
  return { endIdx: closePos + closeSeq.length, prefixLen };
}

function matchCppRawString(src: string, idx: number): { endIdx: number; prefixLen: number } | null {
  if (src[idx] !== 'R' || idx + 1 >= src.length || src[idx + 1] !== '"') return null;
  let prefixLen = 0;
  if (idx > 0 && /[A-Za-z0-9_]/.test(src[idx - 1])) {
    const prefix1 = src[idx - 1];
    const prefix2 = idx >= 2 ? src.slice(idx - 2, idx) : '';
    if (prefix2 === 'u8') {
      if (idx >= 3 && /[A-Za-z0-9_]/.test(src[idx - 3])) return null;
      prefixLen = 2;
    } else if (prefix1 === 'u' || prefix1 === 'U' || prefix1 === 'L') {
      if (idx >= 2 && /[A-Za-z0-9_]/.test(src[idx - 2])) return null;
      prefixLen = 1;
    } else {
      return null;
    }
  }
  let openParen = idx + 2;
  while (
    openParen < src.length &&
    openParen - (idx + 2) <= 16 &&
    src[openParen] !== '(' &&
    !/[)\\ \t\r\n"]/.test(src[openParen])
  ) {
    openParen++;
  }
  if (openParen >= src.length || src[openParen] !== '(') return null;
  const delim = src.slice(idx + 2, openParen);
  const closeSeq = ')' + delim + '"';
  const closePos = src.indexOf(closeSeq, openParen + 1);
  if (closePos === -1) {
    return { endIdx: src.length, prefixLen };
  }
  return { endIdx: closePos + closeSeq.length, prefixLen };
}

function maskSpanPreserveNewlines(src: string, startIdx: number, endIdx: number): string {
  let chunk = '';
  for (let j = startIdx; j < endIdx; j++) {
    const c = src[j];
    chunk += c === '\r' || c === '\n' ? c : ' ';
  }
  return chunk;
}

export function maskSourceLexical(
  rawSrc: string,
  ext = '.ts',
  options?: { keepStringPlaceholder?: boolean }
): string {
  if (!rawSrc) return '';
  const len = rawSrc.length;
  const isPy = ext === '.py';
  const allowTripleDouble = /^\.(?:py|pyw|java|kt|kts|cs|swift|groovy|scala|dart)$/i.test(ext);
  const tripleDoubleSupportsEscape = /^\.(?:py|pyw|java|swift|dart|groovy|scala)$/i.test(ext);
  const isJsTs = /^\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(ext);
  const isGo = ext === '.go';
  const isRust = ext === '.rs';
  const isCpp = /^\.(?:cpp|hpp|cc|cxx|c|h)$/i.test(ext);
  const keepStr = Boolean(options?.keepStringPlaceholder);

  let out = '';
  let i = 0;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inPyTripleSingle = false;
  let inPyTripleDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  let inRegexCharClass = false;

  const tplBraceStack: number[] = [];
  let templateDepth = 0;
  let braceDepth = 0;

  while (i < len) {
    const ch = rawSrc[i];
    const next = i + 1 < len ? rawSrc[i + 1] : '';
    const next2 = i + 2 < len ? rawSrc[i + 2] : '';

    if (ch === '\r' || ch === '\n') {
      out += ch;
      if (inLineComment) {
        if (isCpp) {
          const charBeforeBreak =
            ch === '\n' && i > 0 && rawSrc[i - 1] === '\r'
              ? (i > 1 ? rawSrc[i - 2] : '')
              : (i > 0 ? rawSrc[i - 1] : '');
          const lineTail = rawSrc.slice(Math.max(0, i - 120), i).replace(/\r$/, '');
          const isWinPathTail = /[A-Za-z]:\\[^\r\n]*\\$/.test(lineTail);
          if (charBeforeBreak !== '\\' || isWinPathTail) {
            inLineComment = false;
          }
        } else {
          inLineComment = false;
        }
      }
      if (inRegex) {
        inRegex = false;
        inRegexCharClass = false;
      }
      if (inSingleQuote) {
        inSingleQuote = false;
      }
      if (inDoubleQuote && !isRust) {
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    if (inLineComment) {
      out += ' ';
      i++;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 2;
        inBlockComment = false;
      } else {
        out += ' ';
        i++;
      }
      continue;
    }

    if (inPyTripleDouble) {
      if (tripleDoubleSupportsEscape && ch === '\\' && i + 1 < len && next !== '\r' && next !== '\n') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '"' && next === '"' && next2 === '"') {
        out += keepStr ? '"" ' : '   ';
        i += 3;
        inPyTripleDouble = false;
      } else {
        out += ' ';
        i++;
      }
      continue;
    }
    if (inPyTripleSingle) {
      if (ch === '\\' && i + 1 < len && next !== '\r' && next !== '\n') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'" && next === "'" && next2 === "'") {
        out += keepStr ? '"" ' : '   ';
        i += 3;
        inPyTripleSingle = false;
      } else {
        out += ' ';
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (ch === '\\' && i + 1 < len) {
        if (next === '\r' && next2 === '\n') {
          out += ' \r\n';
          i += 3;
          continue;
        }
        if (next === '\n' || next === '\r') {
          out += ' ' + next;
          i += 2;
          continue;
        }
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === "'") {
        out += keepStr ? '""' : ' ';
        inSingleQuote = false;
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '\\' && i + 1 < len) {
        if (next === '\r' && next2 === '\n') {
          out += ' \r\n';
          i += 3;
          continue;
        }
        if (next === '\n' || next === '\r') {
          out += ' ' + next;
          i += 2;
          continue;
        }
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '"') {
        out += keepStr ? '""' : ' ';
        inDoubleQuote = false;
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (inRegex) {
      if (ch === '\\' && i + 1 < len && next !== '\r' && next !== '\n') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '[') {
        inRegexCharClass = true;
        out += ' ';
        i++;
        continue;
      }
      if (ch === ']' && inRegexCharClass) {
        inRegexCharClass = false;
        out += ' ';
        i++;
        continue;
      }
      if (ch === '/' && !inRegexCharClass) {
        out += ' ';
        i++;
        while (i < len && /[a-z]/i.test(rawSrc[i])) {
          out += ' ';
          i++;
        }
        inRegex = false;
        continue;
      }
      out += ' ';
      i++;
      continue;
    }

    const inTemplateStatic = isJsTs && templateDepth > 0 && tplBraceStack.length < templateDepth;

    if (inTemplateStatic) {
      if (ch === '\\' && i + 1 < len) {
        if (next === '\r' && next2 === '\n') {
          out += ' \r\n';
          i += 3;
          continue;
        }
        if (next === '\n' || next === '\r') {
          out += ' ' + next;
          i += 2;
          continue;
        }
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '`') {
        out += ' ';
        templateDepth--;
        i++;
        continue;
      }
      if (ch === '$' && next === '{') {
        out += ' {';
        braceDepth++;
        tplBraceStack.push(braceDepth);
        i += 2;
        continue;
      }
      out += ' ';
      i++;
      continue;
    }

    if (ch === '{') {
      braceDepth++;
      out += ch;
      i++;
      continue;
    }
    if (ch === '}') {
      if (tplBraceStack.length > 0 && braceDepth === tplBraceStack[tplBraceStack.length - 1]) {
        braceDepth--;
        tplBraceStack.pop();
        out += '}';
        i++;
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      out += ch;
      i++;
      continue;
    }

    if (isPy) {
      if (ch === '#') {
        inLineComment = true;
        out += ' ';
        i++;
        continue;
      }
      if (ch === '"') {
        if (next === '"' && next2 === '"') {
          inPyTripleDouble = true;
          out += '   ';
          i += 3;
          continue;
        }
        inDoubleQuote = true;
        out += ' ';
        i++;
        continue;
      }
      if (ch === "'") {
        if (next === "'" && next2 === "'") {
          inPyTripleSingle = true;
          out += '   ';
          i += 3;
          continue;
        }
        inSingleQuote = true;
        out += ' ';
        i++;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      out += '  ';
      i += 2;
      continue;
    }

    if (isJsTs && ch === '/' && canPrecedeRegexLiteral(out)) {
      inRegex = true;
      inRegexCharClass = false;
      out += ' ';
      i++;
      continue;
    }

    if (isJsTs && ch === '`') {
      templateDepth++;
      out += ' ';
      i++;
      continue;
    }

    if (isGo && ch === '`') {
      out += ' ';
      i++;
      while (i < len && rawSrc[i] !== '`') {
        if (rawSrc[i] === '\r' || rawSrc[i] === '\n') {
          out += rawSrc[i];
        } else {
          out += ' ';
        }
        i++;
      }
      if (i < len && rawSrc[i] === '`') {
        out += ' ';
        i++;
      }
      continue;
    }

    if (isRust && ch === 'r') {
      const rustRaw = matchRustRawString(rawSrc, i);
      if (rustRaw) {
        if (rustRaw.prefixLen > 0) {
          out = out.slice(0, out.length - rustRaw.prefixLen) + ' '.repeat(rustRaw.prefixLen);
        }
        out += maskSpanPreserveNewlines(rawSrc, i, rustRaw.endIdx);
        i = rustRaw.endIdx;
        continue;
      }
    }

    if (isCpp && ch === 'R' && next === '"') {
      const cppRaw = matchCppRawString(rawSrc, i);
      if (cppRaw) {
        if (cppRaw.prefixLen > 0) {
          out = out.slice(0, out.length - cppRaw.prefixLen) + ' '.repeat(cppRaw.prefixLen);
        }
        out += maskSpanPreserveNewlines(rawSrc, i, cppRaw.endIdx);
        i = cppRaw.endIdx;
        continue;
      }
    }

    if (ch === '"') {
      if (allowTripleDouble && next === '"' && next2 === '"') {
        inPyTripleDouble = true;
        out += '   ';
        i += 3;
        continue;
      }
      inDoubleQuote = true;
      out += ' ';
      i++;
      continue;
    }
    if (ch === "'") {
      if (isNumericDigitSeparator(rawSrc, i)) {
        out += ' ';
        i++;
        continue;
      }
      if (isRust) {
        let isChar = false;
        if (rawSrc[i + 1] === '\\') {
          const end = rawSrc.indexOf("'", i + 2);
          if (end !== -1 && end - i <= 10 && !rawSrc.slice(i, end).includes('\n')) {
            isChar = true;
          }
        } else if (i + 1 < len && rawSrc[i + 1] !== "'" && rawSrc[i + 1] !== '\r' && rawSrc[i + 1] !== '\n') {
          const cp = rawSrc.codePointAt(i + 1);
          const charLen = cp !== undefined && cp > 0xffff ? 2 : 1;
          if (i + 1 + charLen < len && rawSrc[i + 1 + charLen] === "'") {
            isChar = true;
          }
        }
        if (!isChar) {
          out += ch;
          i++;
          continue;
        }
      }
      inSingleQuote = true;
      out += ' ';
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function stripCStyleComments(input: string, ext?: string): string {
  if (!input) return '';
  let out = '';
  let i = 0;
  const len = input.length;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  const isRustExt = ext ? ext.toLowerCase() === '.rs' : false;
  const allowLineCommentContinuation = ext
    ? /^\.(?:c|h|cpp|hpp|cc|cxx)$/i.test(ext)
    : !/\b(?:export|import|function|let|var|interface|async|await|fn|pub|impl|func|package)\b/.test(
        input
      );

  while (i < len) {
    const ch = input[i];
    const next = i + 1 < len ? input[i + 1] : '';

    if (inSingle) {
      if (ch === '\\' && i + 1 < len) {
        if (next === '\r' && i + 2 < len && input[i + 2] === '\n') {
          out += ch + '\r\n';
          i += 3;
          continue;
        }
        out += ch + input[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '\r' || ch === '\n') inSingle = false;
      out += ch;
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && i + 1 < len) {
        if (next === '\r' && i + 2 < len && input[i + 2] === '\n') {
          out += ch + '\r\n';
          i += 3;
          continue;
        }
        out += ch + input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      out += ch;
      i++;
      continue;
    }

    if (inTemplate) {
      if (ch === '\\' && i + 1 < len) {
        out += ch + input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') inTemplate = false;
      out += ch;
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      const commentStart = i + 2;
      i += 2;
      while (i < len) {
        if (input[i] === '\n') {
          const charBeforeBreak =
            i > 0 && input[i - 1] === '\r'
              ? (i > 1 ? input[i - 2] : '')
              : (i > 0 ? input[i - 1] : '');
          if (allowLineCommentContinuation && charBeforeBreak === '\\') {
            const commentSegment = input.slice(commentStart, i).replace(/\r$/, '');
            const isWindowsPathTail = /[A-Za-z]:\\[^\r\n]*\\$/.test(commentSegment);
            if (!isWindowsPathTail) {
              i++;
              continue;
            }
          }
          break;
        }
        i++;
      }
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
        if (rCh === '\n') {
          break;
        }
        out += rCh;
        i++;
      }
      continue;
    }

    if (ch === 'r') {
      const rustRaw = matchRustRawString(input, i);
      if (rustRaw) {
        out += input.slice(i, rustRaw.endIdx);
        i = rustRaw.endIdx;
        continue;
      }
    }

    if (ch === 'R' && next === '"') {
      const cppRaw = matchCppRawString(input, i);
      if (cppRaw) {
        out += input.slice(i, cppRaw.endIdx);
        i = cppRaw.endIdx;
        continue;
      }
    }

    if (ch === "'") {
      if (isNumericDigitSeparator(input, i)) {
        out += ch;
        i++;
        continue;
      }
      if (isRustExt) {
        let isChar = false;
        if (input[i + 1] === '\\') {
          const end = input.indexOf("'", i + 2);
          if (end !== -1 && end - i <= 10 && !input.slice(i, end).includes('\n')) {
            isChar = true;
          }
        } else if (i + 1 < len && input[i + 1] !== "'" && input[i + 1] !== '\r' && input[i + 1] !== '\n') {
          const cp = input.codePointAt(i + 1);
          const charLen = cp !== undefined && cp > 0xffff ? 2 : 1;
          if (i + 1 + charLen < len && input[i + 1 + charLen] === "'") {
            isChar = true;
          }
        }
        if (!isChar) {
          out += ch;
          i++;
          continue;
        }
      } else if (!ext && i + 1 < len && /[a-zA-Z_]/.test(input[i + 1])) {
        let identEnd = i + 2;
        while (identEnd < len && /[a-zA-Z0-9_]/.test(input[identEnd])) {
          identEnd++;
        }
        const isClosedAfterIdent = identEnd < len && input[identEnd] === "'";
        const isUrlScheme = input.slice(identEnd, identEnd + 3) === '://';
        if (!isClosedAfterIdent && !isUrlScheme) {
          const prevNonSpace = out.trimEnd().slice(-1);
          const looksLikeRustLifetime =
            prevNonSpace === '&' ||
            prevNonSpace === '<' ||
            ((prevNonSpace === '+' || prevNonSpace === ':' || prevNonSpace === ',') &&
              /\b(?:fn|impl|pub|trait)\b/.test(input) &&
              /^(?:\s*[,+>)\]:;{]|$)/.test(input.slice(identEnd)));
          if (looksLikeRustLifetime) {
            out += ch;
            i++;
            continue;
          }
        }
      }
      inSingle = true;
    } else if (ch === '"') inDouble = true;
    else if (ch === '`') inTemplate = true;

    out += ch;
    i++;
  }

  return out;
}

export function normalizeCodeStructureV1(code: string, ext = '.ts'): string {
  if (!code) return '';
  let stripped = code;
  if (ext === '.py') {
    stripped = stripped
      .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, ' ')
      .replace(/(^|\s)#[^\r\n]*/g, ' ');
  } else {
    stripped = stripCStyleComments(stripped, ext);
  }
  return stripped
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\];,:<>+=*/&|!?-])\s*/g, '$1')
    .trim();
}

export function computeAstHashV1(code: string, ext = '.ts'): string {
  const canonical = normalizeCodeStructureV1(code, ext);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

export function normalizeCodeStructure(code: string, ext = '.ts'): string {
  if (!code) return '';
  let stripped = code;

  if (ext === '.py') {
    stripped = stripped
      .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, ' ')
      .replace(/(^|\s)#[^\r\n]*/g, ' ');
  } else {
    stripped = stripCStyleComments(stripped, ext);
  }

  return stripped
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\];,:<>+=*/&|!?-])\s*/g, '$1')
    .trim();
}

export function computeAstHash(code: string, ext = '.ts'): string {
  const canonical = normalizeCodeStructure(code, ext);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

export function computeStructuralSkeletonHash(code: string, ext = '.ts'): string {
  if (!code || !code.trim()) return '';

  // 1. Lexically mask comments and string/character literals while preserving Rust lifetimes and JS/TS template ${...} expressions
  let stripped = code;
  if (ext === '.sh' || ext === '.ps1' || ext === '.rb') {
    stripped = maskSourceLexical(stripped.replace(/(?:^|[ \t])#[^\r\n]*/gm, ' '), ext, {
      keepStringPlaceholder: true,
    });
  } else if (ext === '.sql' || ext === '.lua') {
    stripped = maskSourceLexical(stripped.replace(/--[^\r\n]*/g, ' '), ext, {
      keepStringPlaceholder: true,
    });
  } else {
    stripped = maskSourceLexical(stripped, ext, { keepStringPlaceholder: true });
  }

  // 3. Strip common diagnostic/logging lines (console.(log|debug|info|warn|error)(...), printf(...), printk(...), logging.(debug|info|warning)(...))
  const logStartPattern = /\b(?:console\.(?:log|debug|info|warn|error)|printf|printk|logging\.(?:debug|info|warning|error))\s*\(/g;
  let noLog = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = logStartPattern.exec(stripped)) !== null) {
    noLog += stripped.slice(lastIdx, match.index);
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < stripped.length && depth > 0) {
      const ch = stripped[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    while (i < stripped.length && (stripped[i] === ' ' || stripped[i] === '\t')) {
      i++;
    }
    if (i < stripped.length && stripped[i] === ';') {
      i++;
    }
    lastIdx = i;
    logStartPattern.lastIndex = i;
  }
  noLog += stripped.slice(lastIdx);

  // 4. Extract declaration signature header and structural token sequence
  let header = '';
  let body = '';
  if (ext === '.py') {
    let parenDepth = 0;
    let colonIdx = -1;
    for (let i = 0; i < noLog.length; i++) {
      const ch = noLog[i];
      if (ch === '(' || ch === '[' || ch === '{') parenDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === ':' && parenDepth === 0) {
        colonIdx = i;
        break;
      }
    }
    if (colonIdx !== -1) {
      header = noLog.slice(0, colonIdx).trim();
      body = noLog.slice(colonIdx + 1);
    } else {
      const lines = noLog.split(/\r?\n/);
      header = lines[0]?.trim() || '';
      body = lines.slice(1).join('\n');
    }
  } else {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceIdx = -1;
    for (let i = 0; i < noLog.length; i++) {
      const ch = noLog[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (parenDepth === 0 && bracketDepth === 0 && ch === '{') {
        braceIdx = i;
        break;
      }
    }
    if (braceIdx !== -1) {
      header = noLog.slice(0, braceIdx).trim();
      body = noLog.slice(braceIdx);
    } else {
      const lines = noLog.split(/\r?\n/);
      header = lines[0]?.trim() || '';
      body = lines.slice(1).join('\n');
    }
  }

  const normHeader = header
    .replace(/\s+/g, ' ')
    .replace(/\s*([()[],:;{}])\s*/g, '$1')
    .trim();

  // Extract structural tokens:
  // Control-flow keywords, operators, brackets, call/member structure (.methodName( or funcName(), literals and identifiers
  const tokenRegex = /""|(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(|===|!==|==|!=|<=|>=|=>|->|&&|\|\||\?\?|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=|<<|>>|\b(?:if|else|for|while|do|switch|case|default|break|continue|return|throw|try|catch|finally|await|async|yield|new|typeof|delete|void|instanceof|in|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_$][a-zA-Z0-9_$]*\b|[{}[\]();,?:+\-*\/%&|^~<>=!]/g;

  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(body)) !== null) {
    tokens.push(m[0].replace(/\s+/g, ''));
  }

  const skeleton = normHeader + ' ' + tokens.join(' ');
  return crypto.createHash('sha256').update(skeleton, 'utf8').digest('hex').slice(0, 16);
}
