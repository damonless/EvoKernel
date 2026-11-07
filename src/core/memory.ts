import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  EvoMemory,
  MemoryVerificationReport,
  SymbolDriftCheck,
  SymbolFingerprint,
  SymbolKind,
  TopologyAnchor,
} from './types.js';
import { EvoStorage } from './storage.js';
import { EvoTelemetry } from './telemetry.js';

export const PARSER_VERSION = 2;

export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.kt',
  '.kts',
  '.swift',
  '.rb',
  '.php',
  '.scala',
  '.lua',
  '.zig',
  '.dart',
  '.sh',
  '.ps1',
  '.sql',
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.evo',
  '.codegraph',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
]);

export interface GitPaths {
  gitDir: string;
  commonDir: string;
  repoRoot?: string;
}

const gitPathsCache = new Map<string, GitPaths>();

export function resolveGitPaths(workspaceRoot: string): GitPaths {
  const root = path.resolve(workspaceRoot);
  const cached = gitPathsCache.get(root);
  if (cached) return cached;
  let repoRoot: string | undefined;
  let gitDir = '';
  if (process.env.GIT_DIR) {
    gitDir = path.resolve(root, process.env.GIT_DIR);
    repoRoot = root;
  }

  if (!gitDir) {
    let cur = root;
    while (true) {
      const cand = path.join(cur, '.git');
      if (fs.existsSync(cand)) {
        gitDir = cand;
        repoRoot = cur;
        break;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  if (!gitDir) {
    gitDir = path.join(root, '.git');
  }

  try {
    const stat = fs.statSync(gitDir);
    if (stat.isFile()) {
      const content = fs.readFileSync(gitDir, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/i);
      if (match) {
        gitDir = path.resolve(path.dirname(gitDir), match[1].trim());
      }
    }
  } catch {
    // fallback
  }

  let commonDir = gitDir;
  const commondirFile = path.join(gitDir, 'commondir');
  try {
    if (fs.existsSync(commondirFile)) {
      const relCommon = fs.readFileSync(commondirFile, 'utf8').trim();
      if (relCommon) {
        commonDir = path.resolve(gitDir, relCommon);
      }
    }
  } catch {
    // fallback
  }

  const res = { gitDir, commonDir, repoRoot };
  gitPathsCache.set(root, res);
  return res;
}

interface PackedRefsCache {
  mtimeMs: number;
  size: number;
  refs: Map<string, string>;
}
const packedRefsCache = new Map<string, PackedRefsCache>();

export interface GitHeadSnapshot {
  commit: string;
  fullCommit: string;
  branch?: string;
}

export function readGitHeadSnapshot(workspaceRoot: string): GitHeadSnapshot {
  const root = path.resolve(workspaceRoot);
  const { gitDir, commonDir } = resolveGitPaths(root);
  const headFile = path.join(gitDir, 'HEAD');
  if (!fs.existsSync(headFile)) {
    return { commit: 'uncommitted', fullCommit: 'uncommitted' };
  }

  let headContent = '';
  try {
    headContent = fs.readFileSync(headFile, 'utf8').trim();
  } catch {
    return { commit: 'uncommitted', fullCommit: 'uncommitted' };
  }

  let branch: string | undefined;
  let fullCommit = '';

  const refPrefix = 'ref: ';
  if (headContent.startsWith(refPrefix)) {
    const refPath = headContent.slice(refPrefix.length).trim();
    if (refPath.startsWith('refs/heads/')) {
      branch = refPath.slice('refs/heads/'.length);
    } else {
      branch = refPath;
    }

    // 1. Check loose ref in commonDir / gitDir
    const looseRefCommon = path.join(commonDir, refPath);
    const looseRefGit = path.join(gitDir, refPath);
    if (fs.existsSync(looseRefCommon)) {
      try {
        fullCommit = fs.readFileSync(looseRefCommon, 'utf8').trim();
      } catch {}
    } else if (fs.existsSync(looseRefGit)) {
      try {
        fullCommit = fs.readFileSync(looseRefGit, 'utf8').trim();
      } catch {}
    }

    // 2. Check packed-refs in commonDir (cached by mtimeMs and size)
    if (!fullCommit) {
      const packedRefsPath = path.join(commonDir, 'packed-refs');
      try {
        if (fs.existsSync(packedRefsPath)) {
          const stat = fs.statSync(packedRefsPath);
          let cached = packedRefsCache.get(commonDir);
          if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
            const lines = fs.readFileSync(packedRefsPath, 'utf8').split(/\r?\n/);
            const refMap = new Map<string, string>();
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;
              const spaceIdx = trimmed.indexOf(' ');
              if (spaceIdx !== -1) {
                const sha = trimmed.slice(0, spaceIdx).trim();
                const ref = trimmed.slice(spaceIdx + 1).trim();
                refMap.set(ref, sha);
              }
            }
            cached = { mtimeMs: stat.mtimeMs, size: stat.size, refs: refMap };
            packedRefsCache.set(commonDir, cached);
          }
          fullCommit = cached.refs.get(refPath) || '';
        }
      } catch {}
    }
  } else if (/^[0-9a-f]{40,64}$/i.test(headContent)) {
    // Detached HEAD
    fullCommit = headContent;
  }

  // 3. Fallback: if Git 2.45+ reftable exists or ref not resolved
  if (!fullCommit) {
    try {
      const res = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 1000,
      });
      if (res.status === 0 && res.stdout) {
        fullCommit = res.stdout.trim();
      }
    } catch {}
  }

  if (!fullCommit) {
    return { commit: 'uncommitted', fullCommit: 'uncommitted', branch };
  }

  return {
    commit: fullCommit.slice(0, 7),
    fullCommit,
    branch,
  };
}

export function resolveCurrentGitCommit(workspaceRoot: string): string {
  try {
    const snap = readGitHeadSnapshot(workspaceRoot);
    if (snap.commit && snap.commit !== 'uncommitted') {
      return snap.commit;
    }
  } catch {}
  return 'uncommitted';
}

export function resolveCurrentGitBranch(workspaceRoot: string): string | undefined {
  try {
    const snap = readGitHeadSnapshot(workspaceRoot);
    if (snap.branch && snap.branch !== 'HEAD') {
      return snap.branch;
    }
  } catch {}
  return undefined;
}

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

export function maskSourceLexical(rawSrc: string, ext = '.ts'): string {
  if (!rawSrc) return '';
  const len = rawSrc.length;
  const isPy = ext === '.py';
  const isJsTs = /^\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(ext);
  const isGo = ext === '.go';
  const isRust = ext === '.rs';
  const isCpp = /^\.(?:cpp|hpp|cc|cxx|c|h)$/i.test(ext);

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
          if (charBeforeBreak !== '\\') {
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
      if (ch === '\\' && i + 1 < len && next !== '\r' && next !== '\n') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '"' && next === '"' && next2 === '"') {
        out += '   ';
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
        out += '   ';
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
        out += ' ';
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
        out += ' ';
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

export function stripCStyleComments(input: string): string {
  if (!input) return '';
  let out = '';
  let i = 0;
  const len = input.length;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

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
      i += 2;
      while (i < len) {
        if (input[i] === '\n') {
          const charBeforeBreak =
            i > 0 && input[i - 1] === '\r'
              ? (i > 1 ? input[i - 2] : '')
              : (i > 0 ? input[i - 1] : '');
          if (charBeforeBreak === '\\') {
            i++;
            continue;
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
      if (i + 1 < len && /[a-zA-Z_]/.test(input[i + 1])) {
        if (!(i + 2 < len && input[i + 2] === "'")) {
          out += ch;
          i++;
          continue;
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
    stripped = stripCStyleComments(stripped);
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
    stripped = stripCStyleComments(stripped);
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

  // 1. Strip comments (stripCStyleComments or Python/shell/script comments/docstrings)
  let stripped = code;
  if (ext === '.py') {
    stripped = stripped
      .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, ' ')
      .replace(/(?:^|[ \t])#[^\r\n]*/g, ' ');
  } else if (ext === '.sh' || ext === '.ps1' || ext === '.rb') {
    stripped = stripped.replace(/(?:^|[ \t])#[^\r\n]*/g, ' ');
  } else if (ext === '.sql' || ext === '.lua') {
    stripped = stripped.replace(/--[^\r\n]*/g, ' ');
  } else {
    stripped = stripCStyleComments(stripped);
  }

  // 2. Replace string literals ('... ', "... ", `...`) with canonical placeholder ""
  stripped = stripped.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/gs, '""');

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

export interface ParsedSymbolTarget {
  raw: string;
  fileHint?: string;
  classHint?: string;
  symbolName: string;
  isWholeFile: boolean;
}

export function parseSymbolTarget(rawSpec: string): ParsedSymbolTarget {
  const trimmed = rawSpec.trim();
  const normalizedSlashes = trimmed.replace(/\\/g, '/');

  // Format 1: path/to/file.ext#Class.method or path/to/file.ext#symbol
  const hashIdx = normalizedSlashes.indexOf('#');
  if (hashIdx !== -1) {
    const filePart = normalizedSlashes.slice(0, hashIdx).trim();
    const symPart = normalizedSlashes.slice(hashIdx + 1).trim();
    const dotIdx = symPart.indexOf('.');
    if (dotIdx !== -1) {
      return {
        raw: trimmed,
        fileHint: filePart,
        classHint: symPart.slice(0, dotIdx).trim(),
        symbolName: symPart.slice(dotIdx + 1).trim(),
        isWholeFile: false,
      };
    }
    return {
      raw: trimmed,
      fileHint: filePart,
      symbolName: symPart,
      isWholeFile: false,
    };
  }

  // Format 2: path/to/file.ext:symbol (avoid matching Windows drive letter C:/)
  const colonIdx = normalizedSlashes.lastIndexOf(':');
  if (colonIdx > 1) {
    const filePart = normalizedSlashes.slice(0, colonIdx).trim();
    const symPart = normalizedSlashes.slice(colonIdx + 1).trim();
    if (symPart && !/^\d+$/.test(symPart)) {
      const dotIdx = symPart.indexOf('.');
      if (dotIdx !== -1) {
        return {
          raw: trimmed,
          fileHint: filePart,
          classHint: symPart.slice(0, dotIdx).trim(),
          symbolName: symPart.slice(dotIdx + 1).trim(),
          isWholeFile: false,
        };
      }
      return {
        raw: trimmed,
        fileHint: filePart,
        symbolName: symPart,
        isWholeFile: false,
      };
    }
  }

  // Format 3: Pure file path (e.g., "src/core/telemetry.ts")
  const ext = path.extname(normalizedSlashes).toLowerCase();
  if (SOURCE_EXTENSIONS.has(ext) || normalizedSlashes.includes('/')) {
    return {
      raw: trimmed,
      fileHint: normalizedSlashes,
      symbolName: path.basename(normalizedSlashes),
      isWholeFile: true,
    };
  }

  // Format 4: ClassName.methodName
  const dotIdx = normalizedSlashes.indexOf('.');
  if (dotIdx !== -1) {
    return {
      raw: trimmed,
      classHint: normalizedSlashes.slice(0, dotIdx).trim(),
      symbolName: normalizedSlashes.slice(dotIdx + 1).trim(),
      isWholeFile: false,
    };
  }

  // Format 5: Bare symbol name (e.g. "BmsCanRxHandler", "EvoTelemetry", "runInit")
  return {
    raw: trimmed,
    symbolName: normalizedSlashes,
    isWholeFile: false,
  };
}

const VENDOR_DIRS = new Set([
  'drivers',
  'middlewares',
  'cmsis',
  'third_party',
  'third-party',
  'vendor',
  'external',
  'lib',
]);

export function collectWorkspaceSourceFiles(
  workspaceRoot: string,
  maxFiles = 2500
): string[] {
  const root = path.resolve(workspaceRoot);
  const results: string[] = [];

  const walk = (dir: string, depth: number) => {
    if (depth > 6 || results.length >= maxFiles || !fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      const aVendor = a.isDirectory() && VENDOR_DIRS.has(a.name.toLowerCase()) ? 1 : 0;
      const bVendor = b.isDirectory() && VENDOR_DIRS.has(b.name.toLowerCase()) ? 1 : 0;
      if (aVendor !== bVendor) return aVendor - bVendor;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  };

  walk(root, 0);
  return results;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface DeclarationMatch {
  kind: SymbolKind;
  lineIndex: number; // 0-indexed
  signature: string;
}

const CONTROL_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'else',
  'do',
  'case',
  'sizeof',
  'typeof',
  'delete',
  'throw',
  'new',
]);

function findSymbolDeclarationInLines(
  lines: string[],
  symbolName: string,
  classHint?: string
): DeclarationMatch | null {
  const esc = escapeRegExp(symbolName);

  // Determine optional search window if classHint is provided
  let searchStart = 0;
  let searchEnd = lines.length - 1;

  if (classHint) {
    const classEsc = escapeRegExp(classHint);
    const classRe = new RegExp(
      `^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?(?:class|struct|interface)\\s+${classEsc}\\b`
    );
    for (let i = 0; i < lines.length; i++) {
      if (classRe.test(lines[i])) {
        searchStart = i;
        const endLine = findBraceBlockEnd(lines, i);
        searchEnd = endLine;
        break;
      }
    }
  }

  const patterns: Array<{ kind: SymbolKind; regex: RegExp }> = [
    // TypeScript / JS class, interface, type
    {
      kind: 'class',
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${esc}\\b`),
    },
    {
      kind: 'interface',
      regex: new RegExp(`^\\s*(?:export\\s+)?interface\\s+${esc}\\b`),
    },
    {
      kind: 'type',
      regex: new RegExp(`^\\s*(?:export\\s+)?type\\s+${esc}\\b`),
    },
    // TS / JS function
    {
      kind: 'function',
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s+${esc}\\b`),
    },
    // Python def / class
    {
      kind: 'function',
      regex: new RegExp(`^\\s*(?:async\\s+)?def\\s+${esc}\\s*\\(`),
    },
    // Go / Rust fn / func / struct
    {
      kind: 'function',
      regex: new RegExp(`^\\s*(?:pub\\s+)?(?:async\\s+)?(?:fn|func)\\s+(?:\\([^)]*\\)\\s*)?${esc}\\b`),
    },
    // C / C++ struct or typedef struct or enum
    {
      kind: 'struct',
      regex: new RegExp(`^\\s*(?:typedef\\s+)?(?:struct|enum|union)\\s+${esc}\\b`),
    },
    // C / C++ #define macro
    {
      kind: 'macro',
      regex: new RegExp(`^\\s*#\\s*define\\s+${esc}\\b`),
    },
    // TS / JS const / let / var exported or arrow function / object
    {
      kind: 'variable',
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${esc}\\b`),
    },
    // Class method in TS/JS/Java/C# (e.g., "public async search(" or "private initSchema(")
    {
      kind: 'method',
      regex: new RegExp(
        `^\\s*(?:(?:public|private|protected|static|readonly|async|override|virtual|inline|\\*)\\s+)*${esc}\\s*(?:<[^>]*>)?\\s*\\([^;{]*(?:\\{.*)?$`
      ),
    },
    // C / C++ function definition: ReturnType SymbolName(args...)
    {
      kind: 'function',
      regex: new RegExp(
        `^\\s*(?:(?:static|inline|extern|const|unsigned|signed|volatile|struct|enum)\\s+)*[A-Za-z_][A-Za-z0-9_:*&<>\\s]*\\b${esc}\\s*\\([^;{]*(?:\\{.*)?$`
      ),
    },
  ];

  const scanRange = (start: number, end: number): DeclarationMatch | null => {
    for (let i = start; i <= end && i < lines.length; i++) {
      const line = lines[i];
      const cleanLine = line
        .replace(/\/\/.*$/, '')
        .replace(/\/\*.*?\*\//g, '')
        .replace(/\/\*.*$/, '');
      const trimmed = cleanLine.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        continue;
      }

      for (const pat of patterns) {
        if (pat.regex.test(cleanLine)) {
          if (
            (pat.kind === 'method' || pat.kind === 'function') &&
            CONTROL_KEYWORDS.has(symbolName)
          ) {
            continue;
          }
          // Avoid matching plain function calls like `  foo(bar)` as method definitions
          // unless preceded by modifiers, return type, or inside a class method header with `{`
          if (pat.kind === 'method' || pat.kind === 'function') {
            const hasModifierOrKeyword =
              /\b(?:public|private|protected|static|async|function|def|fn|func|void|int|char|bool|float|double|uint\d+_t|int\d+_t|size_t|long|short)\b/.test(
                cleanLine
              );
            if (!hasModifierOrKeyword) {
              let pDepth = 0;
              let foundParen = false;
              let isDecl = false;
              const maxL = Math.min(lines.length, i + 30);
              for (let lineIdx = i; lineIdx < maxL; lineIdx++) {
                const l = lines[lineIdx].replace(/\/\/.*$/, '');
                for (let ci = 0; ci < l.length; ci++) {
                  const ch = l[ci];
                  if (ch === '(') {
                    pDepth++;
                    foundParen = true;
                  } else if (ch === ')') {
                    pDepth = Math.max(0, pDepth - 1);
                    if (foundParen && pDepth === 0) {
                      const rest = l.slice(ci + 1).trim();
                      if (
                        rest &&
                        (rest.startsWith('{') ||
                          rest.startsWith(':') ||
                          rest.startsWith('->') ||
                          rest.startsWith('=>') ||
                          /^(?:where|throws|noexcept|const|volatile)\b/.test(rest))
                      ) {
                        isDecl = true;
                      } else if (!rest) {
                        for (let nextL = lineIdx + 1; nextL < Math.min(lines.length, lineIdx + 5); nextL++) {
                          const trimmedNext = lines[nextL].trim();
                          if (!trimmedNext || trimmedNext.startsWith('//')) continue;
                          if (
                            trimmedNext.startsWith('{') ||
                            trimmedNext.startsWith(':') ||
                            trimmedNext.startsWith('->') ||
                            trimmedNext.startsWith('=>') ||
                            /^(?:where|throws|noexcept|const|volatile)\b/.test(trimmedNext)
                          ) {
                            isDecl = true;
                          }
                          break;
                        }
                      }
                      break;
                    }
                  } else if (ch === ';' && !foundParen) {
                    break;
                  }
                }
                if (foundParen && pDepth === 0) break;
              }
              if (!isDecl) {
                continue;
              }
            }
          }

          return {
            kind: pat.kind,
            lineIndex: i,
            signature: trimmed.replace(/\s*\{$/, '').trim(),
          };
        }
      }
    }
    return null;
  };

  const inWindow = scanRange(searchStart, searchEnd);
  if (inWindow) return inWindow;
  if (searchStart > 0 || searchEnd < lines.length - 1) {
    return scanRange(0, lines.length - 1);
  }
  return null;
}

export function findBraceBlockEndV1(lines: string[], startIndex: number): number {
  let depth = 0;
  let foundOpenBrace = false;
  let parenDepth = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const cleanLine = stripCStyleComments(lines[i]);
    for (let c = 0; c < cleanLine.length; c++) {
      const ch = cleanLine[c];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === '{') {
        depth++;
        foundOpenBrace = true;
      } else if (ch === '}') {
        depth--;
        if (foundOpenBrace && depth <= 0) {
          return i;
        }
      } else if (!foundOpenBrace && parenDepth === 0 && ch === ';') {
        return i;
      }
    }

    // Handle C preprocessor macro line continuations `\`
    if (i === startIndex && /^\s*#\s*define\b/.test(lines[startIndex])) {
      let m = startIndex;
      while (m < lines.length && lines[m].trimEnd().endsWith('\\')) {
        m++;
      }
      return m;
    }

    // Safety cap: if no opening brace appeared within 12 lines after start, stop at semicolon or startIndex
    if (!foundOpenBrace && i - startIndex >= 12) {
      return i;
    }
  }

  return Math.min(lines.length - 1, startIndex + 80);
}

const TYPE_OPERATORS = new Set([
  ':',
  '|',
  '&',
  '?',
  '<',
  ',',
  '=>',
  'extends',
  'infer',
  'keyof',
  'is',
  'readonly',
  'typeof',
  'in',
  'struct',
  'interface',
]);

function getPrecedingToken(
  mLines: string[],
  lineIdx: number,
  charIdx: number,
  startLineIdx: number
): string {
  let l = lineIdx;
  let c = charIdx - 1;

  while (l >= startLineIdx) {
    const line = mLines[l] ?? '';
    while (c >= 0) {
      const ch = line[c];
      if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') {
        if (ch === '>' && c > 0 && line[c - 1] === '=') {
          return '=>';
        }
        if (/^[:|&?=\],;()<>{}]/.test(ch)) {
          return ch;
        }
        let idStart = c;
        while (idStart >= 0 && /[A-Za-z0-9_$]/.test(line[idStart])) {
          idStart--;
        }
        return line.slice(idStart + 1, c + 1);
      }
      c--;
    }
    l--;
    if (l >= startLineIdx) {
      c = (mLines[l] ?? '').length - 1;
    }
  }
  return '';
}

export function findBraceBlockEnd(
  lines: string[],
  startIndex: number,
  ext = '.ts',
  maskedLines?: string[]
): number {
  if (startIndex < 0 || startIndex >= lines.length) return startIndex;

  // 1. C preprocessor macro line continuations `\`
  if (/^\s*#\s*define\b/.test(lines[startIndex])) {
    let m = startIndex;
    while (m < lines.length && lines[m].trimEnd().endsWith('\\')) {
      m++;
    }
    return m;
  }

  const mLines =
    maskedLines && maskedLines.length === lines.length
      ? maskedLines
      : maskSourceLexical(lines.join('\n'), ext).split(/\r?\n/);

  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let typeBraceDepth = 0;
  let foundBodyOpen = false;

  const startLine = lines[startIndex] || '';
  const isTypeDecl = /^\s*(?:export\s+)?type\b/.test(startLine);
  const isVarDecl = /^\s*(?:export\s+)?(?:const|let|var)\b/.test(startLine);
  const isCpp = /^\.(?:cpp|hpp|cc|c|h)$/i.test(ext);

  let seenTopLevelEquals = false;
  let seenArrow = false;
  let inCppInitList = false;

  for (let i = startIndex; i < lines.length; i++) {
    let line = mLines[i] ?? '';

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const next = c + 1 < line.length ? line[c + 1] : '';

      if (ch === ' ' || ch === '\t') continue;

      if (ch === '(') {
        parenDepth++;
        continue;
      }
      if (ch === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (ch === '[') {
        bracketDepth++;
        continue;
      }
      if (ch === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        continue;
      }

      if (ch === '<' && !seenArrow && (parenDepth === 0 || bracketDepth === 0)) {
        const prevToken = getPrecedingToken(mLines, i, c, startIndex);
        if (
          prevToken &&
          (/^[A-Za-z_$]/.test(prevToken) ||
            prevToken === ':' ||
            prevToken === '->' ||
            prevToken === '=' ||
            prevToken === ',')
        ) {
          const nextPos = trySkipGenericAngles(line, c);
          if (nextPos > c) {
            c = nextPos - 1;
            continue;
          }
          // Multiline generic support (up to 30 lines forward)
          const lookaheadMax = Math.min(mLines.length, i + 80);
          if (lookaheadMax > i + 1) {
            const joined = mLines.slice(i, lookaheadMax).join('\n');
            const multiNextPos = trySkipGenericAngles(joined, c);
            if (multiNextPos > c) {
              const consumed = joined.slice(0, multiNextPos);
              const parts = consumed.split('\n');
              const lineOffset = parts.length - 1;
              const colOffset = parts[parts.length - 1].length;
              i += lineOffset;
              line = mLines[i] ?? '';
              c = colOffset - 1;
              continue;
            }
          }
        }
      }

      if (isCpp && ch === ':' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && typeBraceDepth === 0) {
        inCppInitList = true;
      }

      if (isVarDecl && !seenTopLevelEquals && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && typeBraceDepth === 0) {
        if (ch === '=') {
          seenTopLevelEquals = true;
          continue;
        }
        if (ch === ';') {
          return i;
        }
      }

      if (ch === '=' && next === '>') {
        if (isVarDecl && seenTopLevelEquals && parenDepth === 0 && bracketDepth === 0 && typeBraceDepth === 0) {
          seenArrow = true;
        }
        c++;
        continue;
      }

      if (ch === ';' && parenDepth === 0 && bracketDepth === 0 && typeBraceDepth === 0) {
        if (!foundBodyOpen) {
          return i;
        }
      }

      if (ch === '{') {
        if (parenDepth > 0 || bracketDepth > 0) {
          continue;
        }

        if (foundBodyOpen) {
          braceDepth++;
          continue;
        }

        if (typeBraceDepth > 0) {
          typeBraceDepth++;
          continue;
        }

        if (isTypeDecl) {
          foundBodyOpen = true;
          braceDepth = 1;
          continue;
        }

        if (isVarDecl) {
          if (!seenTopLevelEquals) {
            typeBraceDepth = 1;
            continue;
          }
          if (seenArrow) {
            foundBodyOpen = true;
            braceDepth = 1;
            continue;
          }
          const prevToken = getPrecedingToken(mLines, i, c, startIndex);
          if (prevToken && TYPE_OPERATORS.has(prevToken)) {
            typeBraceDepth = 1;
            continue;
          }
          foundBodyOpen = true;
          braceDepth = 1;
          continue;
        }

        if (isCpp && inCppInitList) {
          const prevToken = getPrecedingToken(mLines, i, c, startIndex);
          if (prevToken && /^[A-Za-z_][A-Za-z0-9_]*$/.test(prevToken) && prevToken !== 'try') {
            typeBraceDepth = 1;
            continue;
          }
          inCppInitList = false;
          foundBodyOpen = true;
          braceDepth = 1;
          continue;
        }

        // For function / method / constructor / class / interface / struct:
        const prevToken = getPrecedingToken(mLines, i, c, startIndex);
        if (prevToken && TYPE_OPERATORS.has(prevToken)) {
          typeBraceDepth = 1;
          continue;
        }

        foundBodyOpen = true;
        braceDepth = 1;
        continue;
      }

      if (ch === '}') {
        if (parenDepth > 0 || bracketDepth > 0) {
          continue;
        }

        if (typeBraceDepth > 0) {
          typeBraceDepth--;
          continue;
        }

        if (foundBodyOpen) {
          braceDepth--;
          if (braceDepth <= 0) {
            return i;
          }
          continue;
        }
      }
    }

    if (seenArrow && !foundBodyOpen && parenDepth === 0 && bracketDepth === 0 && typeBraceDepth === 0) {
      const restOfLine = line.trim();
      if (restOfLine && !restOfLine.startsWith('{') && restOfLine.includes(';')) {
        return i;
      }
    }

    if (!foundBodyOpen && i - startIndex >= 120) {
      return i;
    }
  }

  return Math.min(lines.length - 1, startIndex + 500);
}

export function findPythonBlockEnd(
  lines: string[],
  declLineIndex: number,
  maskedLines?: string[]
): number {
  if (declLineIndex < 0 || declLineIndex >= lines.length) return declLineIndex;

  const mLines =
    maskedLines && maskedLines.length === lines.length
      ? maskedLines
      : maskSourceLexical(lines.join('\n'), '.py').split(/\r?\n/);

  let parenDepth = 0;
  let colonLine = declLineIndex;
  let colonCol = -1;
  let foundColon = false;

  for (let i = declLineIndex; i < lines.length; i++) {
    const line = mLines[i] ?? '';
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '(' || ch === '[' || ch === '{') parenDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === ':' && parenDepth === 0) {
        colonLine = i;
        colonCol = c;
        foundColon = true;
        break;
      }
    }
    if (foundColon) break;
  }

  const baseIndent = lines[declLineIndex].match(/^\s*/)?.[0].length ?? 0;
  let lastContentLine = colonLine;
  let inTripleQuote: '"""' | "'''" | null = null;
  let inSingleLineQuote: '"' | "'" | null = null;
  let lineContinued = false;
  let bodyParenDepth = 0;

  const advancePythonLine = (rawLine: string) => {
    lineContinued = false;
    let c = 0;
    const len = rawLine.length;
    while (c < len) {
      if (inTripleQuote) {
        if (rawLine[c] === '\\' && c + 1 < len) {
          c += 2;
          continue;
        }
        if (rawLine.startsWith(inTripleQuote, c)) {
          inTripleQuote = null;
          c += 3;
          continue;
        }
        c++;
        continue;
      }
      if (inSingleLineQuote) {
        if (rawLine[c] === '\\') {
          if (c + 1 === len) {
            lineContinued = true;
            break;
          }
          c += 2;
          continue;
        }
        if (rawLine[c] === inSingleLineQuote) {
          inSingleLineQuote = null;
        }
        c++;
        continue;
      }
      const ch = rawLine[c];
      if (ch === '#') break;
      if (ch === '\\' && rawLine.slice(c + 1).trim() === '') {
        lineContinued = true;
        break;
      }
      if (rawLine.startsWith('"""', c) || rawLine.startsWith("'''", c)) {
        const delim = rawLine.slice(c, c + 3) as '"""' | "'''";
        inTripleQuote = delim;
        c += 3;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        c++;
        let closed = false;
        while (c < len) {
          if (rawLine[c] === '\\') {
            if (c + 1 === len) {
              inSingleLineQuote = quote;
              lineContinued = true;
              c++;
              break;
            }
            c += 2;
            continue;
          }
          if (rawLine[c] === quote) {
            c++;
            closed = true;
            break;
          }
          c++;
        }
        if (!closed && !lineContinued) {
          inSingleLineQuote = null;
        }
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') bodyParenDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        bodyParenDepth = Math.max(0, bodyParenDepth - 1);
      }
      c++;
    }
  };

  if (foundColon && colonCol >= 0) {
    const trailingOnColonLine = (lines[colonLine] ?? '').slice(colonCol + 1);
    if (trailingOnColonLine.trim()) {
      advancePythonLine(trailingOnColonLine);
    }
  }

  for (let i = colonLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inTripleQuote || inSingleLineQuote || lineContinued || bodyParenDepth > 0) {
      if (trimmed) {
        lastContentLine = i;
      }
      advancePythonLine(line);
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent) {
      break;
    }
    lastContentLine = i;
    advancePythonLine(line);
  }

  return lastContentLine;
}

function safeRealpathNative(targetPath: string): string {
  try {
    return typeof fs.realpathSync.native === 'function'
      ? fs.realpathSync.native(targetPath)
      : fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function resolveCanonicalRelativePath(root: string, targetFile: string): string {
  const realRoot = safeRealpathNative(root);
  const realTarget = safeRealpathNative(targetFile);
  const relReal = path.relative(realRoot, realTarget).replace(/\\/g, '/');
  if (relReal && !relReal.startsWith('..') && !path.isAbsolute(relReal)) {
    return relReal;
  }
  return path.relative(root, targetFile).replace(/\\/g, '/');
}

export function extractSymbolFingerprint(
  workspaceRoot: string,
  rawSpec: string
): SymbolFingerprint | null {
  const root = path.resolve(workspaceRoot);
  const parsed = parseSymbolTarget(rawSpec);

  // Case 1: Specific file hint provided
  const candidateFiles: string[] = [];
  if (parsed.fileHint) {
    const cleanHint = parsed.fileHint.replace(/^[/\\]+/, '');
    const directHint = path.resolve(root, cleanHint);
    const fullHint =
      fs.existsSync(directHint) && fs.statSync(directHint).isFile()
        ? directHint
        : fs.existsSync(parsed.fileHint) && fs.statSync(parsed.fileHint).isFile()
          ? path.resolve(parsed.fileHint)
          : directHint;

    if (fs.existsSync(fullHint) && fs.statSync(fullHint).isFile()) {
      candidateFiles.push(fullHint);
    } else {
      // Try matching by suffix in workspace
      const allFiles = collectWorkspaceSourceFiles(root);
      const normHint = cleanHint.replace(/\\/g, '/').toLowerCase();
      for (const f of allFiles) {
        const rel = path.relative(root, f).replace(/\\/g, '/').toLowerCase();
        if (rel === normHint || rel.endsWith(`/${normHint}`)) {
          candidateFiles.push(f);
        }
      }
    }
  }

  // Short connection: if no direct file match and .codegraph/codegraph.db exists, query candidate files
  if (candidateFiles.length === 0 && !parsed.isWholeFile) {
    const cgDbPath = path.join(root, '.codegraph', 'codegraph.db');
    if (fs.existsSync(cgDbPath)) {
      try {
        const db = new DatabaseSync(cgDbPath, { readOnly: true });
        try {
          const stmt = db.prepare(
            `SELECT file_path FROM nodes WHERE name = ? OR qualified_name LIKE ? LIMIT 5`
          );
          const rows = stmt.all(parsed.symbolName, `%${parsed.symbolName}%`) as Array<{ file_path: string }>;
          for (const row of rows) {
            if (row.file_path) {
              const full = path.resolve(root, row.file_path);
              if (fs.existsSync(full) && !candidateFiles.includes(full)) {
                candidateFiles.push(full);
              }
            }
          }
        } finally {
          try { db.close(); } catch {}
        }
      } catch {}
    }
  }

  if (parsed.isWholeFile) {
    if (candidateFiles.length === 0) return null;
    const targetFile = candidateFiles[0];
    const rawContent = fs.readFileSync(targetFile, 'utf8');
    const lines = rawContent.split(/\r?\n/);
    const relPath = resolveCanonicalRelativePath(root, targetFile);
    const ext = path.extname(targetFile).toLowerCase();
    return {
      symbol: parsed.raw,
      file_path: relPath,
      file: relPath,
      kind: 'file',
      start_line: 1,
      end_line: lines.length,
      signature: `file ${relPath} (${lines.length} lines)`,
      ast_hash: computeAstHash(rawContent, ext),
    } as unknown as SymbolFingerprint;
  }

  // Case 2: Search symbol in candidateFiles first, then fallback to workspace files if not found
  const searchPool =
    candidateFiles.length > 0 ? candidateFiles : collectWorkspaceSourceFiles(root);

  const tryExtractFromPool = (pool: string[]): SymbolFingerprint | null => {
    for (const filePath of pool) {
      let rawContent: string;
      try {
        rawContent = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      if (!rawContent.includes(parsed.symbolName)) continue;

      const lines = rawContent.split(/\r?\n/);
      const decl = findSymbolDeclarationInLines(lines, parsed.symbolName, parsed.classHint);
      if (!decl) continue;

      const ext = path.extname(filePath).toLowerCase();
      let startIdx = decl.lineIndex;
      if (ext === '.py') {
        let s = decl.lineIndex - 1;
        while (s >= 0 && /^\s*@/.test(lines[s])) {
          startIdx = s;
          s--;
        }
      }
      const endIdx =
        ext === '.py'
          ? findPythonBlockEnd(lines, decl.lineIndex)
          : findBraceBlockEnd(lines, decl.lineIndex, ext);

      const blockCode = lines.slice(startIdx, endIdx + 1).join('\n');
      const relPath = resolveCanonicalRelativePath(root, filePath);

      return {
        symbol: parsed.raw,
        file_path: relPath,
        file: relPath,
        kind: decl.kind,
        start_line: startIdx + 1,
        end_line: endIdx + 1,
        signature: decl.signature,
        ast_hash: computeAstHash(blockCode, ext),
      } as unknown as SymbolFingerprint;
    }
    return null;
  };

  const primaryHit = tryExtractFromPool(searchPool);
  if (primaryHit) return primaryHit;

  // If fileHint was given but the symbol moved to another file in the workspace, search all files
  if (candidateFiles.length > 0) {
    const allFiles = collectWorkspaceSourceFiles(root);
    return tryExtractFromPool(allFiles);
  }

  return null;
}

export function buildFingerprintsForTargets(
  workspaceRoot: string,
  targetSymbols: string[]
): {
  fingerprints: Record<string, SymbolFingerprint>;
  resolvedSymbols: string[];
  missingSymbols: string[];
} {
  const fingerprints: Record<string, SymbolFingerprint> = {};
  const resolvedSymbols: string[] = [];
  const missingSymbols: string[] = [];

  for (const rawSym of targetSymbols) {
    const clean = rawSym.trim();
    if (!clean) continue;
    const fp = extractSymbolFingerprint(workspaceRoot, clean);
    if (fp) {
      fingerprints[clean] = fp;
      resolvedSymbols.push(clean);
    } else {
      missingSymbols.push(clean);
    }
  }

  return { fingerprints, resolvedSymbols, missingSymbols };
}

export function findSymbolCallers(
  workspaceRoot: string,
  rawSpec: string,
  defFilePath: string,
  defStartLine: number,
  defEndLine: number,
  maxCallers = 5
): string[] {
  const root = path.resolve(workspaceRoot);
  const parsed = parseSymbolTarget(rawSpec);
  if (parsed.isWholeFile || !parsed.symbolName || parsed.symbolName.length < 2) {
    return [];
  }

  const esc = escapeRegExp(parsed.symbolName);
  const refRegex = new RegExp(`\\b${esc}\\b`);
  const callers: string[] = [];

  // Short connection: CodeGraph caller edges query if .codegraph/codegraph.db exists
  const cgDbPath = path.join(root, '.codegraph', 'codegraph.db');
  if (fs.existsSync(cgDbPath)) {
    try {
      const db = new DatabaseSync(cgDbPath, { readOnly: true });
      try {
        const stmt = db.prepare(`
          SELECT DISTINCT n_src.file_path, e.line
          FROM edges e
          JOIN nodes n_tgt ON e.target = n_tgt.id
          JOIN nodes n_src ON e.source = n_src.id
          WHERE (n_tgt.name = ? OR n_tgt.qualified_name LIKE ?) AND e.kind = 'call' AND e.line IS NOT NULL
          LIMIT ?
        `);
        const rows = stmt.all(parsed.symbolName, `%${parsed.symbolName}%`, maxCallers) as Array<{
          file_path: string;
          line: number;
        }>;
        for (const r of rows) {
          if (r.file_path && r.line) {
            const rel = r.file_path.replace(/\\/g, '/');
            if (rel === defFilePath && r.line >= defStartLine && r.line <= defEndLine) {
              continue;
            }
            const callerEntry = `${rel}:${r.line}`;
            if (!callers.includes(callerEntry)) {
              callers.push(callerEntry);
            }
          }
        }
      } finally {
        try { db.close(); } catch {}
      }
    } catch {}
  }

  if (callers.length >= maxCallers) {
    return callers;
  }

  const files = collectWorkspaceSourceFiles(root, 300);
  for (const filePath of files) {
    if (callers.length >= maxCallers) break;
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    if (!raw.includes(parsed.symbolName)) continue;

    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    const lines = raw.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (callers.length >= maxCallers) break;
      const lineNo = i + 1;
      if (rel === defFilePath && lineNo >= defStartLine && lineNo <= defEndLine) {
        continue;
      }
      const trimmed = lines[i].trim();
      if (
        !trimmed ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('#') ||
        /^import\s+/.test(trimmed) ||
        /^export\s+.*from\s+/.test(trimmed) ||
        /^extern\s+.*;$/.test(trimmed)
      ) {
        continue;
      }
      if (refRegex.test(trimmed)) {
        const callerEntry = `${rel}:${lineNo}`;
        if (!callers.includes(callerEntry)) {
          callers.push(callerEntry);
        }
      }
    }
  }

  return callers;
}

function isGitCommitPresent(workspaceRoot: string, commitSha: string): boolean {
  if (!commitSha || commitSha === 'uncommitted' || !/^[0-9a-f]{4,40}$/i.test(commitSha.trim())) {
    return false;
  }
  try {
    const res = spawnSync('git', ['cat-file', '-e', `${commitSha.trim()}^{commit}`], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

function resolveGitBranchCommit(workspaceRoot: string, branchName?: string): string | undefined {
  const clean = (branchName || '').trim();
  if (!clean || clean === 'HEAD' || clean.includes('..') || clean.startsWith('-')) {
    return undefined;
  }
  try {
    const res = spawnSync('git', ['rev-parse', '--verify', '--short=12', `${clean}^{commit}`], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    if (res.status === 0 && res.stdout && res.stdout.trim()) {
      return res.stdout.trim();
    }
  } catch {
    // ignore
  }
  return undefined;
}

function isGitAncestorOfHead(workspaceRoot: string, commitSha: string): boolean {
  try {
    const res = spawnSync('git', ['merge-base', '--is-ancestor', commitSha.trim(), 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

function resolveCommitBranchLabel(
  workspaceRoot: string,
  commitSha: string,
  recordedBranch?: string
): string {
  if (recordedBranch && recordedBranch.trim() && recordedBranch.trim() !== 'HEAD') {
    return recordedBranch.trim();
  }
  try {
    const res = spawnSync(
      'git',
      ['branch', '--contains', commitSha.trim(), '--format=%(refname:short)'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 1500,
      }
    );
    if (res.status === 0 && res.stdout) {
      const branches = res.stdout
        .split(/\r?\n/)
        .map((b) => b.trim())
        .filter((b) => b && !b.startsWith('(') && b !== 'HEAD');
      if (branches.length > 0) {
        return branches[0];
      }
    }
  } catch {
    // ignore git branch resolution errors
  }
  return 'other-branch';
}

function discoverDescendantBranchRefs(
  workspaceRoot: string,
  baseCommit: string,
  currentCommit: string,
  limit = 8
): Array<{ commit: string; branch: string }> {
  if (!isGitCommitPresent(workspaceRoot, baseCommit)) return [];
  try {
    const res = spawnSync(
      'git',
      [
        'for-each-ref',
        '--contains',
        baseCommit.trim(),
        '--sort=-committerdate',
        '--format=%(objectname:short=12)|%(refname:short)',
        'refs/heads',
        'refs/remotes',
      ],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 2000,
      }
    );
    if (res.status !== 0 || !res.stdout) return [];

    const discovered: Array<{ commit: string; branch: string }> = [];
    const seenCommits = new Set<string>();
    const cleanBase = baseCommit.trim();
    const cleanCurrent = (currentCommit || '').trim();

    for (const rawLine of res.stdout.split(/\r?\n/)) {
      if (discovered.length >= limit) break;
      const line = rawLine.trim();
      if (!line) continue;
      const sepIdx = line.indexOf('|');
      if (sepIdx === -1) continue;
      const sha = line.slice(0, sepIdx).trim();
      const branch = line.slice(sepIdx + 1).trim();
      if (!sha || !branch || branch === 'HEAD' || branch.endsWith('/HEAD')) continue;
      if (
        (cleanCurrent && (sha.startsWith(cleanCurrent) || cleanCurrent.startsWith(sha))) ||
        (cleanBase && (sha.startsWith(cleanBase) || cleanBase.startsWith(sha)))
      ) {
        continue;
      }
      if (seenCommits.has(sha)) continue;
      seenCommits.add(sha);
      discovered.push({ commit: sha, branch });
    }
    return discovered;
  } catch {
    return [];
  }
}

function extractSymbolFingerprintAtCommit(
  workspaceRoot: string,
  commitSha: string,
  rawSpec: string,
  recordedFp?: SymbolFingerprint
): SymbolFingerprint | null {
  const parsed = parseSymbolTarget(rawSpec);
  const candidateRelFiles: string[] = [];
  const seenFiles = new Set<string>();

  const addCandidate = (rel?: string) => {
    if (!rel || rel === '(unrecorded)') return;
    const clean = rel.replace(/^[/\\]+/, '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
    if (clean && !seenFiles.has(clean)) {
      seenFiles.add(clean);
      candidateRelFiles.push(clean);
    }
  };

  addCandidate(parsed.fileHint);
  addCandidate(recordedFp?.file_path);

  const tryExtractFromGitFiles = (relFiles: string[]): SymbolFingerprint | null => {
    for (const relFile of relFiles) {
      const cleanRel = relFile.replace(/\\/g, '/').replace(/^\.\/+/, '');
      let rawContent = '';
      try {
        const res = spawnSync('git', ['show', `${commitSha.trim()}:./${cleanRel}`], {
          cwd: workspaceRoot,
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 4 * 1024 * 1024,
        });
        if (res.status !== 0 || typeof res.stdout !== 'string') continue;
        rawContent = res.stdout;
      } catch {
        continue;
      }

      const ext = path.extname(cleanRel).toLowerCase();
      if (parsed.isWholeFile) {
        const lines = rawContent.split(/\r?\n/);
        return {
          symbol: rawSpec,
          file_path: cleanRel,
          kind: 'file',
          start_line: 1,
          end_line: lines.length,
          signature: `file ${cleanRel} (${lines.length} lines)`,
          ast_hash: computeAstHash(rawContent, ext),
        };
      }

      if (!rawContent.includes(parsed.symbolName)) continue;
      const lines = rawContent.split(/\r?\n/);
      const decl = findSymbolDeclarationInLines(lines, parsed.symbolName, parsed.classHint);
      if (!decl) continue;

      let startIdx = decl.lineIndex;
      if (ext === '.py') {
        let s = decl.lineIndex - 1;
        while (s >= 0 && /^\s*@/.test(lines[s])) {
          startIdx = s;
          s--;
        }
      }
      const endIdx =
        ext === '.py'
          ? findPythonBlockEnd(lines, decl.lineIndex)
          : findBraceBlockEnd(lines, decl.lineIndex, ext);
      const blockCode = lines.slice(startIdx, endIdx + 1).join('\n');

      return {
        symbol: rawSpec,
        file_path: cleanRel,
        kind: decl.kind,
        start_line: startIdx + 1,
        end_line: endIdx + 1,
        signature: decl.signature,
        ast_hash: computeAstHash(blockCode, ext),
      };
    }
    return null;
  };

  if (candidateRelFiles.length > 0) {
    const directHit = tryExtractFromGitFiles(candidateRelFiles);
    if (directHit) return directHit;
  }

  // Fallback: list files in commitSha tree (relative to cwd) to recover from NTFS/APFS case drift, suffix hints, or relocations
  try {
    const treeRes = spawnSync('git', ['ls-tree', '-r', '--name-only', commitSha.trim(), './'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 2000,
    });
    if (treeRes.status === 0 && treeRes.stdout) {
      const normHints = [parsed.fileHint, recordedFp?.file_path]
        .filter((h): h is string => Boolean(h && h !== '(unrecorded)'))
        .map((h) => h.replace(/^[/\\]+/, '').replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase());

      const allSourceTreeFiles = treeRes.stdout
        .split(/\r?\n/)
        .map((f) => f.trim().replace(/\\/g, '/').replace(/^\.\/+/, ''))
        .filter((f) => {
          if (!f || seenFiles.has(f)) return false;
          const ext = path.extname(f).toLowerCase();
          return SOURCE_EXTENSIONS.has(ext);
        });

      if (normHints.length > 0) {
        const hintMatchedFiles = allSourceTreeFiles.filter((f) => {
          const lower = f.toLowerCase();
          return normHints.some((nh) => lower === nh || lower.endsWith(`/${nh}`));
        });
        if (hintMatchedFiles.length > 0) {
          const caseRecoveredHit = tryExtractFromGitFiles(hintMatchedFiles);
          if (caseRecoveredHit) return caseRecoveredHit;
        }
      }

      if (!parsed.isWholeFile) {
        return tryExtractFromGitFiles(allSourceTreeFiles.slice(0, 60));
      }
    }
  } catch {
    // ignore ls-tree fallback errors
  }

  return null;
}

export function extractSymbolFingerprintAtCommitV1(
  workspaceRoot: string,
  commitSha: string,
  rawSpec: string,
  recordedFp?: SymbolFingerprint
): SymbolFingerprint | null {
  const parsed = parseSymbolTarget(rawSpec);
  const candidateRelFiles: string[] = [];
  const seenFiles = new Set<string>();

  const addCandidate = (rel?: string) => {
    if (!rel || rel === '(unrecorded)') return;
    const clean = rel.replace(/^[/\\]+/, '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
    if (clean && !seenFiles.has(clean)) {
      seenFiles.add(clean);
      candidateRelFiles.push(clean);
    }
  };

  addCandidate(parsed.fileHint);
  addCandidate(recordedFp?.file_path);

  const tryExtractFromGitFiles = (relFiles: string[]): SymbolFingerprint | null => {
    for (const relFile of relFiles) {
      const cleanRel = relFile.replace(/\\/g, '/').replace(/^\.\/+/, '');
      let rawContent = '';
      try {
        const res = spawnSync('git', ['show', `${commitSha.trim()}:./${cleanRel}`], {
          cwd: workspaceRoot,
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 4 * 1024 * 1024,
        });
        if (res.status !== 0 || typeof res.stdout !== 'string') continue;
        rawContent = res.stdout;
      } catch {
        continue;
      }

      const ext = path.extname(cleanRel).toLowerCase();
      if (parsed.isWholeFile) {
        const lines = rawContent.split(/\r?\n/);
        return {
          symbol: rawSpec,
          file_path: cleanRel,
          kind: 'file',
          start_line: 1,
          end_line: lines.length,
          signature: `file ${cleanRel} (${lines.length} lines)`,
          ast_hash: computeAstHashV1(rawContent, ext),
        };
      }

      if (!rawContent.includes(parsed.symbolName)) continue;
      const lines = rawContent.split(/\r?\n/);
      const decl = findSymbolDeclarationInLines(lines, parsed.symbolName, parsed.classHint);
      if (!decl) continue;

      const endIdx =
        ext === '.py'
          ? findPythonBlockEnd(lines, decl.lineIndex)
          : findBraceBlockEndV1(lines, decl.lineIndex);
      const blockCode = lines.slice(decl.lineIndex, endIdx + 1).join('\n');

      return {
        symbol: rawSpec,
        file_path: cleanRel,
        kind: decl.kind,
        start_line: decl.lineIndex + 1,
        end_line: endIdx + 1,
        signature: decl.signature,
        ast_hash: computeAstHashV1(blockCode, ext),
      };
    }
    return null;
  };

  if (candidateRelFiles.length > 0) {
    const directHit = tryExtractFromGitFiles(candidateRelFiles);
    if (directHit) return directHit;
  }

  return null;
}

const workspaceSigCache = new Map<string, { sig: string; expiresAt: number }>();

export function getWorkspaceSourcesSig(workspaceRoot: string): string {
  const root = path.resolve(workspaceRoot);
  const now = Date.now();
  const cached = workspaceSigCache.get(root);
  if (cached && cached.expiresAt > now) {
    return cached.sig;
  }
  const files = collectWorkspaceSourceFiles(root, 300);
  const parts: string[] = [];
  for (const f of files) {
    try {
      const s = fs.statSync(f);
      parts.push(`${path.relative(root, f)}:${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push(`${path.relative(root, f)}:missing`);
    }
  }
  const sig = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  workspaceSigCache.set(root, { sig, expiresAt: now + 500 });
  return sig;
}

interface InProcessVerificationCacheEntry {
  parser_version: number;
  memory_file_sig: string;
  target_files_sig: string;
  workspace_sources_sig: string;
  overall_status: string;
  has_callers: boolean;
  report: MemoryVerificationReport;
}

const memoryVerificationProcessCache = new Map<string, InProcessVerificationCacheEntry>();
const fileSigCache = new Map<string, { sig: string; expiresAt: number }>();

function getFileSigFast(filePath: string): string {
  const now = Date.now();
  const cached = fileSigCache.get(filePath);
  if (cached && cached.expiresAt > now) {
    return cached.sig;
  }
  try {
    const s = fs.statSync(filePath);
    const sig = `${s.mtimeMs}:${s.size}`;
    fileSigCache.set(filePath, { sig, expiresAt: now + 500 });
    return sig;
  } catch {
    const sig = 'missing';
    fileSigCache.set(filePath, { sig, expiresAt: now + 500 });
    return sig;
  }
}

export function clearMemoryVerificationCache(): void {
  memoryVerificationProcessCache.clear();
  workspaceSigCache.clear();
  gitPathsCache.clear();
  fileSigCache.clear();
}

function cloneVerificationReport(
  rep: MemoryVerificationReport,
  currentCommit: string,
  currentBranch: string | undefined,
  createdCommit: string
): MemoryVerificationReport {
  return {
    ...rep,
    current_commit: currentCommit,
    current_branch: currentBranch,
    commit_match: createdCommit === currentCommit,
    checks: rep.checks.map((c) => ({ ...c })),
    topology_anchors: rep.topology_anchors.map((a) => ({
      ...a,
      callers: [...a.callers],
    })),
  };
}

export function verifyMemoryFreshness(
  workspaceRoot: string,
  memory: EvoMemory,
  options?: { includeCallers?: boolean; cacheDb?: DatabaseSync }
): MemoryVerificationReport {
  const root = path.resolve(workspaceRoot);
  const includeCallers = options?.includeCallers ?? true;
  const headSnap = readGitHeadSnapshot(root);
  const currentCommit = headSnap.commit;
  const currentBranch = headSnap.branch !== 'HEAD' ? headSnap.branch : undefined;
  const hasCodeGraph = fs.existsSync(path.join(root, '.codegraph'));

  const targetKeys =
    Object.keys(memory.ast_fingerprints).length > 0
      ? Object.keys(memory.ast_fingerprints)
      : memory.target_symbols;

  // Level 1 Cache Check
  const cacheDbPath = path.join(root, '.evo', '.cache', 'telemetry.db');
  let cacheDb: DatabaseSync | null = options?.cacheDb ?? null;
  const shouldCloseDb = !options?.cacheDb;
  let canUseCache = false;
  let memFileSig = '';
  let targetFilesSig = '';
  const procKey = `${root}:${memory.id}`;

  try {
    try {
      const memFilePath = path.join(root, '.evo', 'memories', `${memory.id}.md`);
    const mSig = getFileSigFast(memFilePath);
    if (mSig !== 'missing') {
      memFileSig = mSig;
      const targetSigs: string[] = [];
      for (const symKey of targetKeys) {
        const fp = memory.ast_fingerprints[symKey];
        if (fp && fp.file_path && fp.file_path !== '(unrecorded)') {
          const p = path.resolve(root, fp.file_path);
          targetSigs.push(`${fp.file_path}:${getFileSigFast(p)}`);
        }
      }
      targetFilesSig = targetSigs.join('|');
      canUseCache = true;
    }

    if (canUseCache) {
      // 1. Process-level Map Cache
      const proc = memoryVerificationProcessCache.get(procKey);
      if (
        proc &&
        proc.parser_version === PARSER_VERSION &&
        proc.memory_file_sig === memFileSig &&
        proc.target_files_sig === targetFilesSig
      ) {
        if (!includeCallers && proc.overall_status === 'VERIFIED') {
          if (shouldCloseDb && cacheDb) {
            try { cacheDb.close(); } catch {}
            cacheDb = null;
          }
          return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
        }

        const wsSig = getWorkspaceSourcesSig(root);
        if (wsSig === proc.workspace_sources_sig) {
          if (proc.has_callers || !includeCallers) {
            if (shouldCloseDb && cacheDb) {
              try { cacheDb.close(); } catch {}
              cacheDb = null;
            }
            return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
          } else {
            for (const anchor of proc.report.topology_anchors) {
              if (!anchor.callers || anchor.callers.length === 0) {
                const m = anchor.lines.match(/L(\d+)-L(\d+)/);
                const sLine = m ? parseInt(m[1], 10) : 0;
                const eLine = m ? parseInt(m[2], 10) : 0;
                anchor.callers = findSymbolCallers(root, anchor.symbol, anchor.file_path, sLine, eLine, 5);
              }
            }
            proc.has_callers = true;
            let openedDbForProc = false;
            let dbToUpdate = cacheDb;
            if (!dbToUpdate && fs.existsSync(cacheDbPath)) {
              try {
                dbToUpdate = new DatabaseSync(cacheDbPath);
                openedDbForProc = true;
              } catch {}
            }
            if (dbToUpdate) {
              try {
                dbToUpdate.prepare(`
                  UPDATE memory_verification_cache
                  SET report_json = ?, workspace_sources_sig = ?, has_callers = 1, cached_at = ?
                  WHERE memory_id = ?
                `).run(JSON.stringify(proc.report), wsSig, new Date().toISOString(), memory.id);
              } catch {} finally {
                if (openedDbForProc) {
                  try { dbToUpdate.close(); } catch {}
                }
              }
            }
            if (shouldCloseDb && cacheDb) {
              try { cacheDb.close(); } catch {}
              cacheDb = null;
            }
            return cloneVerificationReport(proc.report, currentCommit, currentBranch, memory.created_commit);
          }
        }
      }

      // 2. SQLite Database Cache
      if (!cacheDb && fs.existsSync(cacheDbPath)) {
        cacheDb = new DatabaseSync(cacheDbPath);
      }
      if (cacheDb) {
        try {
          cacheDb.exec(`
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
          cacheDb.exec('ALTER TABLE memory_verification_cache ADD COLUMN has_callers INTEGER NOT NULL DEFAULT 0');
        } catch {}

        const stmt = cacheDb.prepare(`
          SELECT parser_version, memory_file_sig, target_files_sig, workspace_sources_sig, overall_status, report_json, has_callers
          FROM memory_verification_cache
          WHERE memory_id = ?
        `);
        const row = stmt.get(memory.id) as {
          parser_version: number;
          memory_file_sig: string;
          target_files_sig: string;
          workspace_sources_sig: string | null;
          overall_status: string;
          report_json: string;
          has_callers: number;
        } | undefined;

        if (
          row &&
          row.parser_version === PARSER_VERSION &&
          row.memory_file_sig === memFileSig &&
          row.target_files_sig === targetFilesSig
        ) {
          if (!includeCallers && row.overall_status === 'VERIFIED') {
            const cachedReport = JSON.parse(row.report_json) as MemoryVerificationReport;
            memoryVerificationProcessCache.set(procKey, {
              parser_version: row.parser_version,
              memory_file_sig: row.memory_file_sig,
              target_files_sig: row.target_files_sig,
              workspace_sources_sig: row.workspace_sources_sig || '',
              overall_status: row.overall_status,
              has_callers: Boolean(row.has_callers),
              report: JSON.parse(row.report_json),
            });
            if (shouldCloseDb && cacheDb) {
              try { cacheDb.close(); } catch {}
              cacheDb = null;
            }
            cachedReport.current_commit = currentCommit;
            cachedReport.current_branch = currentBranch;
            cachedReport.commit_match = memory.created_commit === currentCommit;
            return cachedReport;
          }

          const wsSig = getWorkspaceSourcesSig(root);
          if (wsSig === (row.workspace_sources_sig || '')) {
            const cachedReport = JSON.parse(row.report_json) as MemoryVerificationReport;
            if (Boolean(row.has_callers) || !includeCallers) {
              memoryVerificationProcessCache.set(procKey, {
                parser_version: row.parser_version,
                memory_file_sig: row.memory_file_sig,
                target_files_sig: row.target_files_sig,
                workspace_sources_sig: row.workspace_sources_sig || '',
                overall_status: row.overall_status,
                has_callers: Boolean(row.has_callers),
                report: JSON.parse(row.report_json),
              });
              if (shouldCloseDb && cacheDb) {
                try { cacheDb.close(); } catch {}
                cacheDb = null;
              }
              cachedReport.current_commit = currentCommit;
              cachedReport.current_branch = currentBranch;
              cachedReport.commit_match = memory.created_commit === currentCommit;
              return cachedReport;
            } else {
              for (const anchor of cachedReport.topology_anchors) {
                if (!anchor.callers || anchor.callers.length === 0) {
                  const m = anchor.lines.match(/L(\d+)-L(\d+)/);
                  const sLine = m ? parseInt(m[1], 10) : 0;
                  const eLine = m ? parseInt(m[2], 10) : 0;
                  anchor.callers = findSymbolCallers(root, anchor.symbol, anchor.file_path, sLine, eLine, 5);
                }
              }
              try {
                cacheDb.prepare(`
                  UPDATE memory_verification_cache
                  SET report_json = ?, workspace_sources_sig = ?, has_callers = 1, cached_at = ?
                  WHERE memory_id = ?
                `).run(JSON.stringify(cachedReport), wsSig, new Date().toISOString(), memory.id);
              } catch {}
              memoryVerificationProcessCache.set(procKey, {
                parser_version: row.parser_version,
                memory_file_sig: row.memory_file_sig,
                target_files_sig: row.target_files_sig,
                workspace_sources_sig: wsSig,
                overall_status: row.overall_status,
                has_callers: true,
                report: JSON.parse(JSON.stringify(cachedReport)),
              });
              if (shouldCloseDb && cacheDb) {
                try { cacheDb.close(); } catch {}
                cacheDb = null;
              }
              cachedReport.current_commit = currentCommit;
              cachedReport.current_branch = currentBranch;
              cachedReport.commit_match = memory.created_commit === currentCommit;
              return cachedReport;
            }
          }
        }
      }
    }
  } catch {
    if (shouldCloseDb && cacheDb) {
      try { cacheDb.close(); } catch {}
      cacheDb = null;
    }
  }

  const checks: SymbolDriftCheck[] = [];
  const topologyAnchors: TopologyAnchor[] = [];
  let verifiedCount = 0;

  for (const symKey of targetKeys) {
    const recorded: SymbolFingerprint = memory.ast_fingerprints[symKey] || {
      symbol: symKey,
      file_path: '(unrecorded)',
      kind: 'function',
      start_line: 0,
      end_line: 0,
      signature: symKey,
      ast_hash: '',
    };

    const parsed = parseSymbolTarget(symKey);
    const fastQuery =
      !parsed.fileHint &&
      !parsed.isWholeFile &&
      recorded.file_path &&
      recorded.file_path !== '(unrecorded)'
        ? `${recorded.file_path}#${symKey}`
        : symKey;

    const liveRaw = extractSymbolFingerprint(root, fastQuery);
    const live = liveRaw ? { ...liveRaw, symbol: symKey } : null;

    if (!live) {
      checks.push({
        symbol: symKey,
        status: 'MISSING',
        recorded,
        detail: `Symbol '${symKey}' (recorded at ${recorded.file_path}:L${recorded.start_line}-L${recorded.end_line}, hash ${recorded.ast_hash}) was deleted or renamed in current workspace.`,
      });
      topologyAnchors.push({
        symbol: symKey,
        file_path: recorded.file_path,
        lines: `L${recorded.start_line}-L${recorded.end_line} (MISSING)`,
        signature: recorded.signature,
        status: 'MISSING',
        callers: [],
      });
      continue;
    }

    if (!recorded.ast_hash || live.ast_hash === recorded.ast_hash) {
      verifiedCount++;
      const lineShiftNote =
        recorded.start_line > 0 &&
        (live.start_line !== recorded.start_line || live.file_path !== recorded.file_path)
          ? ` (relocated from ${recorded.file_path}:L${recorded.start_line}-L${recorded.end_line} -> ${live.file_path}:L${live.start_line}-L${live.end_line}, AST hash intact)`
          : '';

      checks.push({
        symbol: symKey,
        status: 'VERIFIED',
        recorded,
        current: live,
        detail: `AST fingerprint verified (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote}.`,
      });

      const callers = includeCallers
        ? findSymbolCallers(
            root,
            symKey,
            live.file_path,
            live.start_line,
            live.end_line,
            5
          )
        : [];

      topologyAnchors.push({
        symbol: symKey,
        file_path: live.file_path,
        lines: `L${live.start_line}-L${live.end_line}`,
        signature: live.signature,
        status: 'VERIFIED',
        callers,
        codegraph_hint: hasCodeGraph
          ? `codegraph explore "${parsed.symbolName}"`
          : `view_file ${live.file_path} (lines ${live.start_line}-${live.end_line})`,
      });
    } else {
      // Check dual V1/V2 verification for truncated memories
      let dualVerified = false;
      const recordedSpan = recorded.end_line - recorded.start_line + 1;
      const liveSpan = live.end_line - live.start_line + 1;
      const createdCommit = (memory.created_commit || '').trim();

      if (
        recordedSpan <= 12 &&
        recordedSpan < liveSpan &&
        createdCommit &&
        createdCommit !== 'uncommitted' &&
        isGitCommitPresent(root, createdCommit)
      ) {
        const fpAtCreatedV1 = extractSymbolFingerprintAtCommitV1(root, createdCommit, symKey, recorded);
        const fpAtCreatedV2 = extractSymbolFingerprintAtCommit(root, createdCommit, symKey, recorded);
        if (
          fpAtCreatedV1 &&
          fpAtCreatedV2 &&
          fpAtCreatedV1.ast_hash === recorded.ast_hash &&
          fpAtCreatedV2.ast_hash === live.ast_hash
        ) {
          dualVerified = true;
        }
      }

      let skeletonVerified = false;
      if (
        !dualVerified &&
        createdCommit &&
        createdCommit !== 'uncommitted' &&
        isGitCommitPresent(root, createdCommit)
      ) {
        try {
          const histFp = extractSymbolFingerprintAtCommit(root, createdCommit, symKey, recorded);
          if (histFp && (histFp.kind === live.kind || !live.kind)) {
            const histCleanRel = histFp.file_path.replace(/\\/g, '/').replace(/^\.\/+/,'');
            const histShowRes = spawnSync('git', ['show', `${createdCommit}:./${histCleanRel}`], {
              cwd: root,
              encoding: 'utf8',
              timeout: 2000,
              maxBuffer: 4 * 1024 * 1024,
            });
            if (histShowRes.status === 0 && typeof histShowRes.stdout === 'string') {
              const histLines = histShowRes.stdout.split(/\r?\n/);
              const histBlockCode = histLines.slice(histFp.start_line - 1, histFp.end_line).join('\n');
              const liveFullPath = path.resolve(root, live.file_path);
              if (fs.existsSync(liveFullPath)) {
                const liveFullText = fs.readFileSync(liveFullPath, 'utf8');
                const liveLines = liveFullText.split(/\r?\n/);
                const liveBlockCode = liveLines.slice(live.start_line - 1, live.end_line).join('\n');
                const ext = path.extname(live.file_path).toLowerCase();
                const histSkel = computeStructuralSkeletonHash(histBlockCode, ext);
                const liveSkel = computeStructuralSkeletonHash(liveBlockCode, ext);
                if (histSkel && liveSkel && histSkel === liveSkel) {
                  skeletonVerified = true;
                }
              }
            }
          }
        } catch {
          // ignore git / fs error
        }
      }

      if (dualVerified || skeletonVerified) {
        verifiedCount++;
        const lineShiftNote =
          recorded.start_line > 0 &&
          (live.start_line !== recorded.start_line || live.file_path !== recorded.file_path)
            ? ` (relocated from ${recorded.file_path}:L${recorded.start_line}-L${recorded.end_line} -> ${live.file_path}:L${live.start_line}-L${live.end_line}, AST hash intact)`
            : '';

        const detailNote = skeletonVerified
          ? `AST fingerprint verified via structural skeleton (${live.ast_hash}, control-flow skeleton intact after non-structural edit) at ${live.file_path}:L${live.start_line}-L${live.end_line}.`
          : `AST fingerprint verified (${live.ast_hash}) at ${live.file_path}:L${live.start_line}-L${live.end_line}${lineShiftNote} (upgraded from truncated v1 hash ${recorded.ast_hash}).`;

        checks.push({
          symbol: symKey,
          status: 'VERIFIED',
          recorded,
          current: live,
          detail: detailNote,
        });

        const callers = includeCallers
          ? findSymbolCallers(
              root,
              symKey,
              live.file_path,
              live.start_line,
              live.end_line,
              5
            )
          : [];

        topologyAnchors.push({
          symbol: symKey,
          file_path: live.file_path,
          lines: `L${live.start_line}-L${live.end_line}`,
          signature: live.signature,
          status: 'VERIFIED',
          callers,
          codegraph_hint: hasCodeGraph
            ? `codegraph explore "${parsed.symbolName}"`
            : `view_file ${live.file_path} (lines ${live.start_line}-${live.end_line})`,
        });
      } else {
        const callers = includeCallers
          ? findSymbolCallers(
              root,
              symKey,
              live.file_path,
              live.start_line,
              live.end_line,
              5
            )
          : [];

        checks.push({
          symbol: symKey,
          status: 'MISMATCH',
          recorded,
          current: live,
          detail: `AST structural drift detected for '${symKey}': recorded hash ${recorded.ast_hash} != live hash ${live.ast_hash} at ${live.file_path}:L${live.start_line}-L${live.end_line}.`,
        });

        topologyAnchors.push({
          symbol: symKey,
          file_path: live.file_path,
          lines: `L${live.start_line}-L${live.end_line} (MUTATED)`,
          signature: live.signature,
          status: 'MISMATCH',
          callers,
          codegraph_hint: hasCodeGraph
            ? `codegraph explore "${parsed.symbolName}"`
            : `view_file ${live.file_path} (lines ${live.start_line}-${live.end_line})`,
        });
      }
    }
  }

  const totalSymbols = targetKeys.length;

  const buildResult = (
    overallStatus: 'VERIFIED' | 'OTHER_BRANCH' | 'STALE',
    confidenceTag: string,
    commitMatch: boolean,
    recCommit: string,
    recBranch: string | undefined,
    branchVerifiedCount: number
  ): MemoryVerificationReport => {
    const report: MemoryVerificationReport = {
      memory_id: memory.id,
      overall_status: overallStatus,
      confidence_tag: confidenceTag,
      commit_match: commitMatch,
      recorded_commit: recCommit,
      current_commit: currentCommit,
      recorded_branch: recBranch,
      current_branch: currentBranch,
      branch_verified_count: branchVerifiedCount,
      verified_count: verifiedCount,
      total_symbols: totalSymbols,
      checks,
      topology_anchors: topologyAnchors,
    };

    const wsSig = getWorkspaceSourcesSig(root);
    if (canUseCache) {
      let localDb = cacheDb;
      let openedLocal = false;
      if (!localDb && fs.existsSync(cacheDbPath)) {
        try {
          localDb = new DatabaseSync(cacheDbPath);
          openedLocal = true;
        } catch {}
      }
      if (localDb) {
        try {
          const insStmt = localDb.prepare(`
            INSERT OR REPLACE INTO memory_verification_cache
            (memory_id, parser_version, memory_file_sig, target_files_sig, workspace_sources_sig, overall_status, report_json, cached_at, has_callers)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          insStmt.run(
            memory.id,
            PARSER_VERSION,
            memFileSig,
            targetFilesSig,
            wsSig,
            overallStatus,
            JSON.stringify(report),
            new Date().toISOString(),
            includeCallers ? 1 : 0
          );
        } catch {} finally {
          if (openedLocal) {
            try { localDb.close(); } catch {}
          } else if (shouldCloseDb && cacheDb) {
            try { cacheDb.close(); } catch {}
            cacheDb = null;
          }
        }
      }
    }

    if (canUseCache) {
      memoryVerificationProcessCache.set(procKey, {
        parser_version: PARSER_VERSION,
        memory_file_sig: memFileSig,
        target_files_sig: targetFilesSig,
        workspace_sources_sig: wsSig,
        overall_status: overallStatus,
        has_callers: includeCallers,
        report: JSON.parse(JSON.stringify(report)),
      });
    }

    return report;
  };

  // Tier 1: All symbols verified in live working tree
  if (totalSymbols > 0 && verifiedCount === totalSymbols) {
    return buildResult(
      'VERIFIED',
      '[置信度: HIGH (≥80%)]',
      memory.created_commit === currentCommit,
      memory.created_commit,
      memory.created_branch,
      0
    );
  }

  // Tier 2: Git-Topology-Aware Fallback (OTHER_BRANCH vs STALE)
  const candidateGitRefs: Array<{ commit: string; branchHint?: string }> = [];
  const pushCandidateRef = (commit?: string, branchHint?: string) => {
    const c = (commit || '').trim();
    if (!c) return;
    if (candidateGitRefs.some((x) => x.commit === c)) return;
    candidateGitRefs.push({ commit: c, branchHint });
  };

  const cleanRecordedBranch = (memory.created_branch || '').trim();
  const hasExplicitBranch = Boolean(cleanRecordedBranch && cleanRecordedBranch !== 'HEAD');

  if (
    isGitCommitPresent(root, memory.created_commit) &&
    !isGitAncestorOfHead(root, memory.created_commit)
  ) {
    pushCandidateRef(memory.created_commit.trim(), memory.created_branch);
  }
  if (hasExplicitBranch && cleanRecordedBranch !== currentBranch) {
    const branchTip =
      resolveGitBranchCommit(root, cleanRecordedBranch) ||
      resolveGitBranchCommit(root, `origin/${cleanRecordedBranch}`);
    if (branchTip) {
      pushCandidateRef(branchTip, cleanRecordedBranch);
    }
  }
  if (!hasExplicitBranch && isGitCommitPresent(root, memory.created_commit)) {
    for (const desc of discoverDescendantBranchRefs(root, memory.created_commit, currentCommit, 8)) {
      pushCandidateRef(desc.commit, desc.branch);
    }
  }

  if (totalSymbols > 0 && verifiedCount < totalSymbols && candidateGitRefs.length > 0) {
    let branchVerifiedCount = 0;
    let resolvedBranchLabel = memory.created_branch || '';
    let resolvedCommitRef =
      memory.created_commit && memory.created_commit !== 'uncommitted'
        ? memory.created_commit
        : candidateGitRefs[0].commit;

    for (let i = 0; i < checks.length; i++) {
      if (checks[i].status === 'VERIFIED') continue;
      const symKey = checks[i].symbol;
      const recorded = checks[i].recorded;
      let matchedFp: SymbolFingerprint | null = null;
      let matchedRef: { commit: string; branchHint?: string } | null = null;

      for (const cand of candidateGitRefs) {
        const fp = extractSymbolFingerprintAtCommit(root, cand.commit, symKey, recorded);
        if (fp && (!recorded.ast_hash || fp.ast_hash === recorded.ast_hash)) {
          matchedFp = fp;
          matchedRef = cand;
          break;
        }
      }

      if (matchedFp && matchedRef) {
        branchVerifiedCount++;
        const branchLabel = resolveCommitBranchLabel(
          root,
          matchedRef.commit,
          matchedRef.branchHint || memory.created_branch
        );
        resolvedBranchLabel = branchLabel;
        resolvedCommitRef = matchedRef.commit;
        const cleanFpPath = matchedFp.file_path.replace(/^\.\/+/, '');
        checks[i] = {
          symbol: symKey,
          status: 'OTHER_BRANCH',
          recorded,
          current: matchedFp,
          detail: `AST fingerprint verified (${matchedFp.ast_hash}) on branch '${branchLabel}' (@ commit ${matchedRef.commit}) at ${cleanFpPath}:L${matchedFp.start_line}-L${matchedFp.end_line} (not yet merged into ${currentBranch || 'HEAD'}@${currentCommit}).`,
        };
        topologyAnchors[i] = {
          symbol: symKey,
          file_path: cleanFpPath,
          lines: `L${matchedFp.start_line}-L${matchedFp.end_line} (@ ${branchLabel}:${matchedRef.commit})`,
          signature: matchedFp.signature,
          status: 'OTHER_BRANCH',
          callers: [],
          codegraph_hint: `git show ${matchedRef.commit}:./${cleanFpPath}`,
        };
      }
    }

    if (verifiedCount + branchVerifiedCount === totalSymbols) {
      return buildResult(
        'OTHER_BRANCH',
        '[置信度: MID (50–80%) · OTHER_BRANCH]',
        false,
        resolvedCommitRef,
        resolvedBranchLabel || 'other-branch',
        branchVerifiedCount
      );
    }
  }

    // Tier 3: True code drift (STALE)
    return buildResult(
      'STALE',
      '[置信度: LOW (20–50%) · STALE]',
      memory.created_commit === currentCommit,
      memory.created_commit,
      memory.created_branch,
      0
    );
  } finally {
    if (shouldCloseDb && cacheDb) {
      try {
        cacheDb.close();
      } catch {}
      cacheDb = null;
    }
  }
}

export function extractSymbolsFromGitCommit(
  workspaceRoot: string,
  commitSha: string,
  touchedFiles: string[]
): string[] {
  const root = path.resolve(workspaceRoot);
  const targets: string[] = [];

  for (const relFile of touchedFiles) {
    const fullPath = path.join(root, relFile);
    if (!fs.existsSync(fullPath)) continue;

    let raw = '';
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    // Check git diff hunk headers or modified lines for this file in commitSha
    let diffText = '';
    try {
      const diffRes = spawnSync('git', ['show', '--unified=0', commitSha, '--', relFile], {
        cwd: root,
        encoding: 'utf8',
        timeout: 1500,
      });
      if (diffRes.status === 0 && diffRes.stdout) {
        diffText = diffRes.stdout;
      }
    } catch {
      // ignore git diff error
    }

    // Collect top-level functions/classes declared in the current file
    const declRegex =
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|def|fn|func|void|int|uint\d+_t|int\d+_t|bool|char)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm;
    const declaredInFile: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = declRegex.exec(raw)) !== null) {
      const name = match[1];
      if (!CONTROL_KEYWORDS.has(name) && !declaredInFile.includes(name)) {
        declaredInFile.push(name);
      }
    }

    // Prefer a symbol mentioned in the diff, otherwise the first declared symbol in the file
    let chosenSymbol: string | null = null;
    for (const sym of declaredInFile) {
      if (diffText && diffText.includes(sym)) {
        chosenSymbol = sym;
        break;
      }
    }
    if (!chosenSymbol && declaredInFile.length > 0) {
      chosenSymbol = declaredInFile[0];
    }

    if (chosenSymbol) {
      const spec = `${relFile}#${chosenSymbol}`;
      if (extractSymbolFingerprint(root, spec)) {
        targets.push(spec);
        continue;
      }
    }

    targets.push(relFile);
  }

  return targets;
}

export function refreshMemories(
  workspaceRoot: string,
  targetIds?: string[]
): {
  refreshed: string[];
  skippedMissing: Array<{ id: string; missingSymbols: string[] }>;
  unchanged: string[];
} {
  const root = path.resolve(workspaceRoot);
  const storage = new EvoStorage(root);
  storage.ensureInitialized();
  const currentCommit = resolveCurrentGitCommit(root);
  const currentBranch = resolveCurrentGitBranch(root);

  let memories = storage.listMemories();
  if (targetIds && targetIds.length > 0) {
    const filterSet = new Set(targetIds);
    memories = memories.filter((m) => filterSet.has(m.id));
  }

  const refreshed: string[] = [];
  const skippedMissing: Array<{ id: string; missingSymbols: string[] }> = [];
  const unchanged: string[] = [];

  let telemetry: EvoTelemetry | null = null;
  try {
    for (const memory of memories) {
      const targetKeys =
        Object.keys(memory.ast_fingerprints).length > 0
          ? Object.keys(memory.ast_fingerprints)
          : memory.target_symbols;

      const missingSymbols: string[] = [];
      const newFingerprints: Record<string, SymbolFingerprint> = {};

      for (const symKey of targetKeys) {
        const recorded: SymbolFingerprint = memory.ast_fingerprints[symKey] || {
          symbol: symKey,
          file_path: '(unrecorded)',
          kind: 'function',
          start_line: 0,
          end_line: 0,
          signature: symKey,
          ast_hash: '',
        };

        const parsed = parseSymbolTarget(symKey);
        const fastQuery =
          !parsed.fileHint &&
          !parsed.isWholeFile &&
          recorded.file_path &&
          recorded.file_path !== '(unrecorded)'
            ? `${recorded.file_path}#${symKey}`
            : symKey;

        const liveRaw = extractSymbolFingerprint(root, fastQuery);
        if (!liveRaw) {
          missingSymbols.push(symKey);
        } else {
          newFingerprints[symKey] = {
            ...liveRaw,
            symbol: symKey,
          };
        }
      }

      // Safety Guard: If ANY symbol in the memory returns null (truly deleted/missing in the current workspace),
      // do NOT overwrite that memory — push { id: memory.id, missingSymbols } into skippedMissing so genuine
      // symbol deletions are never masked!
      if (missingSymbols.length > 0) {
        skippedMissing.push({ id: memory.id, missingSymbols });
        continue;
      }

      let differs = false;
      if (memory.created_commit !== currentCommit) differs = true;
      if (memory.created_branch !== currentBranch) differs = true;

      const existingKeys = Object.keys(memory.ast_fingerprints);
      if (existingKeys.length !== targetKeys.length) {
        differs = true;
      } else {
        for (const symKey of targetKeys) {
          const oldFp = memory.ast_fingerprints[symKey];
          const liveFp = newFingerprints[symKey];
          if (
            !oldFp ||
            oldFp.ast_hash !== liveFp.ast_hash ||
            oldFp.start_line !== liveFp.start_line ||
            oldFp.end_line !== liveFp.end_line ||
            oldFp.file_path !== liveFp.file_path ||
            oldFp.signature !== liveFp.signature ||
            oldFp.kind !== liveFp.kind
          ) {
            differs = true;
            break;
          }
        }
      }

      if (differs) {
        memory.ast_fingerprints = newFingerprints;
        memory.created_commit = currentCommit;
        memory.created_branch = currentBranch;
        memory.updated_at = new Date().toISOString();
        storage.saveMemory(memory);
        refreshed.push(memory.id);
      } else {
        unchanged.push(memory.id);
      }
    }

    if (refreshed.length > 0) {
      clearMemoryVerificationCache();
      telemetry = new EvoTelemetry(storage);
      telemetry.syncFromDisk();
    }
  } finally {
    if (telemetry) {
      try {
        telemetry.close();
      } catch {}
    }
  }

  return { refreshed, skippedMissing, unchanged };
}

