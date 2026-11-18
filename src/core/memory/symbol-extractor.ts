import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SymbolFingerprint, SymbolKind } from '../types.js';
import { SOURCE_EXTENSIONS, isRealSubpathOf, safeRealpathNative } from './git-utils.js';
import {
  computeAstHash,
  computeStructuralSkeletonHash,
  maskSourceLexical,
  stripCStyleComments,
  trySkipGenericAngles,
} from './lexical-mask.js';

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
  '.agents',
  '.claude',
  '.cursor',
  '.windsurf',
  '.roo',
  '.gemini',
  '.codex',
]);

export interface ParsedSymbolTarget {
  raw: string;
  fileHint?: string;
  classHint?: string;
  symbolName: string;
  isWholeFile: boolean;
}

function splitQualifiedSymbolName(symPart: string): {
  classHint?: string;
  symbolName: string;
} {
  const clean = symPart.trim();
  const scopeIdx = clean.lastIndexOf('::');
  if (scopeIdx !== -1) {
    const scopePrefix = clean.slice(0, scopeIdx).trim();
    const symbolName = clean.slice(scopeIdx + 2).trim();
    const lastScope = scopePrefix.split('::').filter(Boolean).pop();
    return lastScope ? { classHint: lastScope, symbolName } : { symbolName };
  }
  const dotIdx = clean.indexOf('.');
  if (dotIdx !== -1) {
    return {
      classHint: clean.slice(0, dotIdx).trim(),
      symbolName: clean.slice(dotIdx + 1).trim(),
    };
  }
  return { symbolName: clean };
}

function findSingleSeparatorColon(spec: string): number {
  for (let i = spec.length - 1; i > 1; i--) {
    if (spec[i] === ':' && spec[i - 1] !== ':' && spec[i + 1] !== ':') {
      return i;
    }
  }
  return -1;
}

export function parseSymbolTarget(rawSpec: string): ParsedSymbolTarget {
  const trimmed = rawSpec.trim();
  const normalizedSlashes = trimmed.replace(/\\/g, '/');

  // Format 1: path/to/file.ext#Class.method or path/to/file.ext#ns::symbol
  const hashIdx = normalizedSlashes.indexOf('#');
  if (hashIdx !== -1) {
    const filePart = normalizedSlashes.slice(0, hashIdx).trim();
    const symPart = normalizedSlashes.slice(hashIdx + 1).trim();
    const qualified = splitQualifiedSymbolName(symPart);
    return {
      raw: trimmed,
      fileHint: filePart,
      ...(qualified.classHint ? { classHint: qualified.classHint } : {}),
      symbolName: qualified.symbolName,
      isWholeFile: false,
    };
  }

  // Format 2: path/to/file.ext:symbol (avoid matching C++/Rust "::" or Windows drive letter "C:/")
  const colonIdx = findSingleSeparatorColon(normalizedSlashes);
  if (colonIdx > 1) {
    const filePart = normalizedSlashes.slice(0, colonIdx).trim();
    const symPart = normalizedSlashes.slice(colonIdx + 1).trim();
    if (symPart && !/^\d+$/.test(symPart)) {
      const qualified = splitQualifiedSymbolName(symPart);
      return {
        raw: trimmed,
        fileHint: filePart,
        ...(qualified.classHint ? { classHint: qualified.classHint } : {}),
        symbolName: qualified.symbolName,
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

  // Format 4: ClassName::methodName or ClassName.methodName
  if (normalizedSlashes.includes('::') || normalizedSlashes.includes('.')) {
    const qualified = splitQualifiedSymbolName(normalizedSlashes);
    return {
      raw: trimmed,
      ...(qualified.classHint ? { classHint: qualified.classHint } : {}),
      symbolName: qualified.symbolName,
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

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface DeclarationMatch {
  kind: SymbolKind;
  lineIndex: number; // 0-indexed
  signature: string;
}

export const CONTROL_KEYWORDS = new Set([
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

export function isBodylessForwardDeclaration(
  lines: string[],
  declLineIdx: number,
  ext: string,
  kind?: SymbolKind
): boolean {
  if (ext === '.py') return false;

  const startLine = lines[declLineIdx] ?? '';
  if (/^\s*#\s*define\b/.test(startLine)) {
    return false;
  }
  if (/^\s*(?:export\s+)?type\b/.test(startLine)) {
    return false;
  }

  if (kind === 'variable') {
    if (!/\bextern\b/.test(startLine) || /^\s*extern\s+"[^"]+"/.test(startLine)) {
      return false;
    }
    const maxLine = Math.min(lines.length, declLineIdx + 10);
    let parenDepth = 0;
    let bracketDepth = 0;
    for (let i = declLineIdx; i < maxLine; i++) {
      const cleanLine = stripCStyleComments(lines[i] ?? '');
      for (let c = 0; c < cleanLine.length; c++) {
        const ch = cleanLine[c];
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (parenDepth === 0 && bracketDepth === 0) {
          if (ch === '=' || ch === '{') return false;
          if (ch === ';') return true;
        }
      }
    }
    return false;
  }

  if (
    (kind === 'struct' || kind === 'class') &&
    /^\.(?:c|h|cpp|hpp|cc|cxx|m|mm)$/i.test(ext)
  ) {
    const maxLine = Math.min(lines.length, declLineIdx + 10);
    let parenDepth = 0;
    let bracketDepth = 0;
    for (let i = declLineIdx; i < maxLine; i++) {
      const cleanLine = stripCStyleComments(lines[i] ?? '');
      for (let c = 0; c < cleanLine.length; c++) {
        const ch = cleanLine[c];
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (parenDepth === 0 && bracketDepth === 0) {
          if (ch === '{' || ch === '=') return false;
          if (ch === ';') return true;
        }
      }
    }
    return false;
  }

  if (kind && kind !== 'function' && kind !== 'method') return false;

  if (/^\s*(?:export\s+)?(?:interface|class|struct|enum|union)\b/.test(startLine)) {
    return false;
  }
  if (/^\s*(?:export\s+)?(?:const|let|var)\b/.test(startLine)) {
    return false;
  }

  const maxLine = Math.min(lines.length, declLineIdx + 25);
  let parenDepth = 0;
  let angleDepth = 0;
  let hasSeenParen = false;

  for (let i = declLineIdx; i < maxLine; i++) {
    const rawLine = lines[i] ?? '';
    const cleanLine = stripCStyleComments(rawLine);

    for (let c = 0; c < cleanLine.length; c++) {
      const ch = cleanLine[c];
      const next = c + 1 < cleanLine.length ? cleanLine[c + 1] : '';

      if (ch === '(') {
        parenDepth++;
        hasSeenParen = true;
        continue;
      }
      if (ch === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (ch === '<' && !hasSeenParen) {
        angleDepth++;
        continue;
      }
      if (ch === '>' && !hasSeenParen && angleDepth > 0) {
        angleDepth--;
        continue;
      }

      if (hasSeenParen && parenDepth === 0) {
        if (ch === '=' && next === '>') {
          return false;
        }
        if (ch === '{') {
          return false;
        }
        if (ch === ';') {
          return true;
        }
      }
    }
  }
  return false;
}

interface ContainerRange {
  name: string;
  start: number;
  end: number;
  kind?: 'class' | 'struct' | 'interface';
}

function collectContainerRangesInLines(lines: string[], ext = '.ts'): ContainerRange[] {
  const containers: ContainerRange[] = [];
  const isPy = ext === '.py';
  const isRust = ext === '.rs';
  const isGo = ext === '.go';
  const mLines = isPy ? undefined : maskSourceLexical(lines.join('\n'), ext).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] || '';
    const cleanLine = mLines ? (mLines[i] ?? rawLine) : rawLine.replace(/#.*$/, '');
    if (!cleanLine.trim()) continue;

    if (isPy) {
      const pyMatch = cleanLine.match(/^\s*class\s+([A-Za-z_]\w*)\b/);
      if (pyMatch) {
        const end = findPythonBlockEnd(lines, i);
        containers.push({ name: pyMatch[1], start: i, end, kind: 'class' });
      }
      continue;
    }

    if (isRust) {
      const implMatch = cleanLine.match(
        /^\s*(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:[^{]+?\bfor\s+)?([A-Za-z_]\w*)\b/
      );
      if (implMatch) {
        const end = findBraceBlockEnd(lines, i, ext, mLines);
        containers.push({ name: implMatch[1], start: i, end, kind: 'class' });
        continue;
      }
      const typeMatch = cleanLine.match(
        /^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|union)\s+([A-Za-z_]\w*)\b/
      );
      if (typeMatch && !/;\s*$/.test(cleanLine.trim())) {
        const end = findBraceBlockEnd(lines, i, ext, mLines);
        containers.push({
          name: typeMatch[2],
          start: i,
          end,
          kind: typeMatch[1] === 'trait' ? 'interface' : 'struct',
        });
      }
      continue;
    }

    if (isGo) {
      const goTypeMatch = cleanLine.match(/^\s*type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/);
      if (goTypeMatch) {
        const end = findBraceBlockEnd(lines, i, ext, mLines);
        containers.push({
          name: goTypeMatch[1],
          start: i,
          end,
          kind: goTypeMatch[2] === 'interface' ? 'interface' : 'struct',
        });
      }
      continue;
    }

    const classMatch = cleanLine.match(
      /^\s*(?:template\s*<[^>]*>\s*)?(?:export\s+)?(?:default\s+)?(?:(?:abstract|public|private|protected|internal|final|sealed|static|typedef)\s+)*(class|struct|interface)\s+([A-Za-z_]\w*)\b/
    );
    if (classMatch) {
      const trimmed = cleanLine.trim();
      if (trimmed.endsWith(';') && !trimmed.includes('{')) {
        continue;
      }
      const end = findBraceBlockEnd(lines, i, ext, mLines);
      containers.push({
        name: classMatch[2],
        start: i,
        end,
        kind: classMatch[1] === 'interface' ? 'interface' : classMatch[1] === 'struct' ? 'struct' : 'class',
      });
    }
  }

  return containers;
}

const TYPED_VAR_KEYWORD_DENYLIST = new Set([
  'return',
  'using',
  'throw',
  'case',
  'delete',
  'new',
  'typedef',
  'typename',
  'import',
  'package',
  'namespace',
  'goto',
  'else',
  'do',
  'sizeof',
  'co_return',
  'co_yield',
  'co_await',
  'if',
  'for',
  'while',
  'switch',
]);

const AGGREGATE_TAG_KEYWORDS = new Set(['class', 'struct', 'interface', 'enum', 'union']);

function isValidTypedVarPrefix(prefix: string): boolean {
  let angleDepth = 0;
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (ch === '<') angleDepth++;
    else if (ch === '>') {
      angleDepth--;
      if (angleDepth < 0) return false;
    } else if (ch === ',' && angleDepth === 0) {
      return false;
    }
  }
  if (angleDepth !== 0) return false;

  const idents = prefix.match(/[A-Za-z_][A-Za-z0-9_]*/g);
  if (!idents || idents.length === 0) return false;
  const firstToken = idents[0];
  const lastToken = idents[idents.length - 1];
  if (TYPED_VAR_KEYWORD_DENYLIST.has(firstToken) || TYPED_VAR_KEYWORD_DENYLIST.has(lastToken)) {
    return false;
  }
  if (idents.length === 1 && AGGREGATE_TAG_KEYWORDS.has(firstToken)) {
    return false;
  }
  return true;
}

function computeDeclarationScopeByLine(lines: string[], ext: string): boolean[] {
  const mLines = maskSourceLexical(lines.join('\n'), ext).split(/\r?\n/);
  const result = new Array<boolean>(lines.length).fill(true);
  const scopeStack: boolean[] = [];
  let pendingHeader = '';

  for (let i = 0; i < mLines.length; i++) {
    const line = mLines[i] ?? '';
    result[i] = scopeStack.every(Boolean);
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '{') {
        const header = pendingHeader.trim();
        const isContainer =
          /\b(?:namespace|class|struct|enum|union|interface)\b/.test(header) ||
          /\bextern\s+"[^"]+"/.test(header);
        scopeStack.push(isContainer && !header.includes('='));
        pendingHeader = '';
      } else if (ch === '}') {
        if (scopeStack.length > 0) scopeStack.pop();
        pendingHeader = '';
      } else if (ch === ';') {
        pendingHeader = '';
      } else {
        pendingHeader += ch;
        if (pendingHeader.length > 400) {
          pendingHeader = pendingHeader.slice(-300);
        }
      }
    }
    pendingHeader += ' ';
  }
  return result;
}

export function findAllSymbolDeclarationsInLines(
  lines: string[],
  symbolName: string,
  classHint?: string,
  ext = '.ts'
): DeclarationMatch[] {
  const esc = escapeRegExp(symbolName);

  if (classHint) {
    const classEsc = escapeRegExp(classHint);
    // Go receiver method check: func (s *Server) Close()
    const goReceiverRe = new RegExp(
      `^\\s*func\\s*\\(\\s*(?:[A-Za-z_]\\w*\\s+)?\\*?${classEsc}\\b[^)]*\\)\\s*${esc}\\b`
    );
    const goMatches: DeclarationMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (goReceiverRe.test(line)) {
        const clean = line.replace(/\/\/.*$/, '').trim();
        goMatches.push({
          kind: 'method',
          lineIndex: i,
          signature: clean.replace(/\s*\{$/, '').trim(),
        });
        continue;
      }
      // Multiline Go receiver declaration check:
      // func ( on line i, receiver on line i or i+1, and ) SymbolName( on line i+1 or i+2
      if (/^\s*func\s*\(/.test(line)) {
        for (let span = 2; span <= 3; span++) {
          if (i + span <= lines.length) {
            const slice = lines.slice(i, i + span).map((l) => l.replace(/\/\/.*$/, '').trim());
            const joined = slice.join(' ');
            if (goReceiverRe.test(joined)) {
              goMatches.push({
                kind: 'method',
                lineIndex: i,
                signature: joined.replace(/\s*\{$/, '').trim(),
              });
              break;
            }
          }
        }
      }
    }
    if (goMatches.length > 0) {
      const bodyful = goMatches.filter(
        (m) => !isBodylessForwardDeclaration(lines, m.lineIndex, ext, m.kind)
      );
      return bodyful.length > 0 ? bodyful : goMatches;
    }
  }

  const needInterfaces =
    Boolean(classHint) || ext === '.go' || /\b(?:interface|trait)\b/.test(lines.join('\n'));
  const allContainers = needInterfaces ? collectContainerRangesInLines(lines, ext) : [];
  const interfaceRanges = allContainers.filter((c) => c.kind === 'interface');
  const targetClassRanges = classHint
    ? allContainers.filter((c) => c.name === classHint)
    : [];
  const otherClassRanges = classHint
    ? allContainers.filter((c) => c.name !== classHint)
    : [];
  const isTypedVarLang = /^\.(?:c|h|cpp|hpp|cc|cxx|cs|java)$/i.test(ext);
  const typedVarRe = isTypedVarLang
    ? new RegExp(
        `^\\s*(?:extern\\s+"[^"]+"\\s+)?([A-Za-z_][A-Za-z0-9_:<>*&\\[\\],\\s]*?(?:\\s+|[*&]\\s*))${esc}(?:\\s*\\[[^\\]]*\\])*\\s*(?:=|;|,\\s*[A-Za-z_*&]|\\{)`
      )
    : null;
  const declScopeFlags = isTypedVarLang ? computeDeclarationScopeByLine(lines, ext) : null;

  if (classHint && ext === '.go' && targetClassRanges.length === 0) {
    return [];
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
      regex: classHint
        ? new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:const\\s+)?(?:fn|func)\\s+${esc}\\b`)
        : new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?(?:const\\s+)?(?:fn|func)\\s+(?:\\([^)]*\\)\\s*)?${esc}\\b`),
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

  const cppQualifiedRe = classHint
    ? new RegExp(
        `\\b${escapeRegExp(classHint)}\\s*::\\s*${esc}\\s*\\([^;{]*(?:\\{.*)?$`
      )
    : null;
  const interfaceMethodRe = new RegExp(
    `^\\s*(?:(?:public|private|protected|static|readonly|async|override|virtual|inline|\\*)\\s+)*${esc}\\s*(?:<[^>]*>)?\\s*\\([^;{]*;?\\s*$`
  );

  const isInsideOtherClass = (lineIdx: number): boolean => {
    if (!classHint || otherClassRanges.length === 0) return false;
    for (const oc of otherClassRanges) {
      if (lineIdx >= oc.start && lineIdx <= oc.end) {
        const surroundedByTarget = targetClassRanges.some(
          (tc) => tc.start <= oc.start && oc.end <= tc.end && (oc.start > tc.start || oc.end < tc.end)
        );
        if (surroundedByTarget) return true;
        const insideTarget = targetClassRanges.some(
          (tc) => lineIdx >= tc.start && lineIdx <= tc.end && tc.start >= oc.start && tc.end <= oc.end
        );
        if (!insideTarget) return true;
      }
    }
    return false;
  };

  const collectInRange = (start: number, end: number, respectOtherClasses = true): DeclarationMatch[] => {
    const matches: DeclarationMatch[] = [];
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

      if (cppQualifiedRe && cppQualifiedRe.test(cleanLine)) {
        matches.push({
          kind: 'method',
          lineIndex: i,
          signature: trimmed.replace(/\s*\{$/, '').trim(),
        });
        continue;
      }

      if (classHint) {
        const anyQualifiedMatch = cleanLine.match(
          new RegExp(`\\b([A-Za-z_]\\w*)\\s*::\\s*${esc}\\b`)
        );
        if (anyQualifiedMatch && anyQualifiedMatch[1] !== classHint) {
          continue;
        }
      }

      if (respectOtherClasses && isInsideOtherClass(i)) {
        continue;
      }

      const insideInterface = interfaceRanges.some((ir) => i > ir.start && i < ir.end);
      for (const pat of patterns) {
        const matchedPat =
          pat.regex.test(cleanLine) ||
          (insideInterface && pat.kind === 'method' && interfaceMethodRe.test(cleanLine));
        if (matchedPat) {
          if (
            (pat.kind === 'method' || pat.kind === 'function') &&
            CONTROL_KEYWORDS.has(symbolName)
          ) {
            continue;
          }
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
                        insideInterface &&
                        ext === '.go' &&
                        !rest.startsWith('.') &&
                        !rest.startsWith('=') &&
                        !rest.startsWith(':=')
                      ) {
                        isDecl = true;
                      } else if (
                        rest &&
                        (rest.startsWith('{') ||
                          rest.startsWith(':') ||
                          (insideInterface && rest.startsWith(';')) ||
                          rest.startsWith('->') ||
                          rest.startsWith('=>') ||
                          /^(?:where|throws|noexcept|const|volatile)\b/.test(rest))
                      ) {
                        isDecl = true;
                      } else if (!rest) {
                        let nextNonEmptyStartsWithCallChainOrAssign = false;
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
                          } else if (
                            trimmedNext.startsWith('.') ||
                            trimmedNext.startsWith('=')
                          ) {
                            nextNonEmptyStartsWithCallChainOrAssign = true;
                          }
                          break;
                        }
                        if (insideInterface && !nextNonEmptyStartsWithCallChainOrAssign) {
                          isDecl = true;
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

          matches.push({
            kind: pat.kind,
            lineIndex: i,
            signature: trimmed.replace(/\s*\{$/, '').trim(),
          });
          break;
        }
      }

      if (typedVarRe && (matches.length === 0 || matches[matches.length - 1].lineIndex !== i)) {
        const varMatch = cleanLine.match(typedVarRe);
        if (varMatch && isValidTypedVarPrefix(varMatch[1])) {
          matches.push({
            kind: 'variable',
            lineIndex: i,
            signature: trimmed.replace(/\s*\{$/, '').trim(),
          });
        }
      }
    }
    return matches;
  };

  let rawMatches: DeclarationMatch[] = [];
  if (classHint) {
    const seenLine = new Set<number>();
    for (const tc of targetClassRanges) {
      for (const m of collectInRange(tc.start, tc.end, true)) {
        if (!seenLine.has(m.lineIndex)) {
          seenLine.add(m.lineIndex);
          rawMatches.push(m);
        }
      }
    }
    if (cppQualifiedRe) {
      for (let i = 0; i < lines.length; i++) {
        if (seenLine.has(i)) continue;
        const cleanLine = lines[i]
          .replace(/\/\/.*$/, '')
          .replace(/\/\*.*?\*\//g, '')
          .replace(/\/\*.*$/, '');
        if (cppQualifiedRe.test(cleanLine)) {
          seenLine.add(i);
          rawMatches.push({
            kind: 'method',
            lineIndex: i,
            signature: cleanLine.trim().replace(/\s*\{$/, '').trim(),
          });
        }
      }
    }
    if (
      rawMatches.length === 0 &&
      targetClassRanges.length === 0 &&
      new RegExp(`\\b${escapeRegExp(classHint)}\\b`).test(lines.join('\n'))
    ) {
      rawMatches = collectInRange(0, lines.length - 1, true);
    }
  } else {
    rawMatches = collectInRange(0, lines.length - 1, false);
  }

  if (declScopeFlags && rawMatches.length > 1) {
    const inDeclScope = rawMatches.filter(
      (m) => m.kind !== 'variable' || declScopeFlags[m.lineIndex] !== false
    );
    if (inDeclScope.length > 0) {
      rawMatches = inDeclScope;
    }
  }

  const bodyful = rawMatches.filter(
    (m) => !isBodylessForwardDeclaration(lines, m.lineIndex, ext, m.kind)
  );
  if (bodyful.length > 0) {
    return bodyful;
  }
  return rawMatches;
}

export function findSymbolDeclarationInLines(
  lines: string[],
  symbolName: string,
  classHint?: string,
  ext = '.ts'
): DeclarationMatch | null {
  const matches = findAllSymbolDeclarationsInLines(lines, symbolName, classHint, ext);
  return matches.length > 0 ? matches[0] : null;
}

export interface ExtractedSymbolBlock {
  kind: SymbolKind;
  start_line: number;
  end_line: number;
  signature: string;
  blockCode: string;
  skeleton_hash?: string;
}

export function extractSymbolBlockFromLines(
  lines: string[],
  symbolName: string,
  classHint?: string,
  ext = '.ts'
): ExtractedSymbolBlock | null {
  const decls = findAllSymbolDeclarationsInLines(lines, symbolName, classHint, ext);
  if (!decls || decls.length === 0) return null;

  const blocks: Array<{
    decl: DeclarationMatch;
    startIdx: number;
    endIdx: number;
    code: string;
  }> = [];

  for (const decl of decls) {
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

    const code = lines.slice(startIdx, endIdx + 1).join('\n');
    blocks.push({
      decl,
      startIdx,
      endIdx,
      code,
    });
  }

  blocks.sort((a, b) => a.startIdx - b.startIdx);

  if (blocks.length === 1) {
    return {
      kind: blocks[0].decl.kind,
      start_line: blocks[0].startIdx + 1,
      end_line: blocks[0].endIdx + 1,
      signature: blocks[0].decl.signature,
      blockCode: blocks[0].code,
      skeleton_hash: computeStructuralSkeletonHash(blocks[0].code, ext),
    };
  }

  // Only perform Same-File Overload Aggregation for function/method declarations when ext is overload-capable or classHint is provided
  const primaryKind = blocks[0].decl.kind;
  const isOverloadCapable =
    (primaryKind === 'function' || primaryKind === 'method') &&
    (Boolean(classHint) ||
      /^\.(?:ts|tsx|js|jsx|mjs|cjs|cpp|hpp|cc|cxx|c|h|java|cs)$/i.test(ext));

  if (!isOverloadCapable) {
    return {
      kind: blocks[0].decl.kind,
      start_line: blocks[0].startIdx + 1,
      end_line: blocks[0].endIdx + 1,
      signature: blocks[0].decl.signature,
      blockCode: blocks[0].code,
      skeleton_hash: computeStructuralSkeletonHash(blocks[0].code, ext),
    };
  }

  let sameScopeBlocks = blocks;
  if (!classHint) {
    const containers = collectContainerRangesInLines(lines, ext);
    const getContainerKey = (lineIdx: number): string => {
      let best: ContainerRange | null = null;
      for (const c of containers) {
        if (lineIdx > c.start && lineIdx <= c.end) {
          if (!best || c.end - c.start < best.end - best.start) {
            best = c;
          }
        }
      }
      return best ? `${best.name}@${best.start}` : 'top-level';
    };
    const firstScopeKey = getContainerKey(blocks[0].decl.lineIndex);
    sameScopeBlocks = blocks.filter((b) => getContainerKey(b.decl.lineIndex) === firstScopeKey);
  }

  if (sameScopeBlocks.length === 1) {
    return {
      kind: sameScopeBlocks[0].decl.kind,
      start_line: sameScopeBlocks[0].startIdx + 1,
      end_line: sameScopeBlocks[0].endIdx + 1,
      signature: sameScopeBlocks[0].decl.signature,
      blockCode: sameScopeBlocks[0].code,
      skeleton_hash: computeStructuralSkeletonHash(sameScopeBlocks[0].code, ext),
    };
  }

  // Same-File Overload Aggregation (within identical class/container or top-level scope)
  const combinedBlockCode = sameScopeBlocks.map((b) => b.code).join('\n');
  const overloadSkeletonHash = sameScopeBlocks
    .map((b) => computeStructuralSkeletonHash(b.code, ext))
    .join('|');
  return {
    kind: sameScopeBlocks[0].decl.kind,
    start_line: sameScopeBlocks[0].startIdx + 1,
    end_line: sameScopeBlocks[sameScopeBlocks.length - 1].endIdx + 1,
    signature: sameScopeBlocks[0].decl.signature,
    blockCode: combinedBlockCode,
    skeleton_hash: overloadSkeletonHash,
  };
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
  const isJsTs = /^\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(ext);
  const isVarDecl = isJsTs && /^\s*(?:export\s+)?(?:const|let|var)\b/.test(startLine);
  const isCpp = /^\.(?:cpp|hpp|cc|cxx|c|h)$/i.test(ext);
  const isGo = ext === '.go';
  const hasCPreprocessor = /^\.(?:c|h|cpp|hpp|cc|cxx|cs|m|mm)$/i.test(ext);

  let seenTopLevelEquals = false;
  let seenArrow = false;
  let seenOpenParen = false;
  let inCppInitList = false;
  let unclosedIfdefBraceDelta = 0;

  const ppStack: Array<{
    entryBraceDepth: number;
    entryTypeBraceDepth: number;
    entryFoundBodyOpen: boolean;
    branchBraceDepths: number[];
    branchTypeBraceDepths: number[];
    anyFoundBodyOpen: boolean;
    hasElse: boolean;
    inDeadBranch: boolean;
    parentDead: boolean;
  }> = [];

  for (let i = startIndex; i < lines.length; i++) {
    const rawLine = lines[i] || '';
    const cleanLine = mLines[i] ?? rawLine;
    const ppMatch = hasCPreprocessor
      ? cleanLine.match(/^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/)
      : null;

    if (ppMatch) {
      const dir = ppMatch[1];
      if (dir === 'if' || dir === 'ifdef' || dir === 'ifndef') {
        const isIfZero = dir === 'if' && /^#\s*if\s+0\b/.test(cleanLine.trim());
        const parentDead = ppStack.length > 0 && ppStack[ppStack.length - 1].inDeadBranch;
        ppStack.push({
          entryBraceDepth: braceDepth,
          entryTypeBraceDepth: typeBraceDepth,
          entryFoundBodyOpen: foundBodyOpen,
          branchBraceDepths: [],
          branchTypeBraceDepths: [],
          anyFoundBodyOpen: foundBodyOpen,
          hasElse: false,
          inDeadBranch: parentDead || isIfZero,
          parentDead,
        });
      } else if (dir === 'elif' || dir === 'else') {
        if (ppStack.length > 0) {
          const top = ppStack[ppStack.length - 1];
          if (!top.inDeadBranch) {
            top.branchBraceDepths.push(braceDepth);
            top.branchTypeBraceDepths.push(typeBraceDepth);
            top.anyFoundBodyOpen = top.anyFoundBodyOpen || foundBodyOpen;
          }
          if (dir === 'else') {
            top.hasElse = true;
            top.inDeadBranch = top.parentDead;
          } else if (dir === 'elif') {
            const isElifZero = /^#\s*elif\s+0\b/.test(cleanLine.trim());
            top.inDeadBranch = top.parentDead || isElifZero;
          }
          braceDepth = top.entryBraceDepth;
          typeBraceDepth = top.entryTypeBraceDepth;
          foundBodyOpen = top.entryFoundBodyOpen;
        }
      } else if (dir === 'endif') {
        if (ppStack.length > 0) {
          const top = ppStack.pop()!;
          if (!top.inDeadBranch) {
            top.branchBraceDepths.push(braceDepth);
            top.branchTypeBraceDepths.push(typeBraceDepth);
            top.anyFoundBodyOpen = top.anyFoundBodyOpen || foundBodyOpen;
          }
          if (top.branchBraceDepths.length > 0) {
            if (top.hasElse) {
              braceDepth = Math.max(...top.branchBraceDepths);
              typeBraceDepth = Math.max(...top.branchTypeBraceDepths);
              foundBodyOpen = top.anyFoundBodyOpen;
            } else {
              const maxBranchBrace = Math.max(...top.branchBraceDepths);
              const minBranchBrace = Math.min(...top.branchBraceDepths);
              if (maxBranchBrace > top.entryBraceDepth) {
                unclosedIfdefBraceDelta += maxBranchBrace - top.entryBraceDepth;
                braceDepth = maxBranchBrace;
              } else if (minBranchBrace < top.entryBraceDepth && unclosedIfdefBraceDelta > 0) {
                const closed = Math.min(
                  unclosedIfdefBraceDelta,
                  top.entryBraceDepth - minBranchBrace
                );
                unclosedIfdefBraceDelta -= closed;
                braceDepth = top.entryBraceDepth - closed;
              } else {
                braceDepth = Math.max(top.entryBraceDepth, maxBranchBrace);
              }
              typeBraceDepth = Math.max(top.entryTypeBraceDepth, ...top.branchTypeBraceDepths);
              foundBodyOpen = top.entryFoundBodyOpen || top.anyFoundBodyOpen;
            }
          } else {
            braceDepth = top.entryBraceDepth;
            typeBraceDepth = top.entryTypeBraceDepth;
            foundBodyOpen = top.entryFoundBodyOpen;
          }
          if (ppStack.length === 0 && foundBodyOpen && braceDepth <= 0) {
            return i;
          }
        }
      }
      continue;
    }

    if (ppStack.length > 0 && ppStack[ppStack.length - 1].inDeadBranch) {
      continue;
    }

    let line = mLines[i] ?? '';

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const next = c + 1 < line.length ? line[c + 1] : '';

      if (ch === ' ' || ch === '\t') continue;

      if (ch === '(') {
        parenDepth++;
        seenOpenParen = true;
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
            if (ppStack.length === 0) {
              return i;
            }
            braceDepth = Math.max(0, braceDepth);
          }
          continue;
        }

        if (!foundBodyOpen && ppStack.length === 0) {
          return line.slice(0, c).trim() ? i : Math.max(startIndex, i - 1);
        }
      }
    }

    if (
      isGo &&
      !foundBodyOpen &&
      seenOpenParen &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      typeBraceDepth === 0
    ) {
      const trimmedClean = line.trim();
      if (trimmedClean && !trimmedClean.endsWith(',') && !trimmedClean.endsWith('{')) {
        let nextStartsBrace = false;
        for (let k = i + 1; k < Math.min(mLines.length, i + 5); k++) {
          const nextClean = (mLines[k] ?? '').trim();
          if (!nextClean) continue;
          nextStartsBrace = nextClean.startsWith('{');
          break;
        }
        if (!nextStartsBrace) {
          return i;
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

function resolveCanonicalRelativePath(root: string, targetFile: string): string {
  const realRoot = safeRealpathNative(root);
  const realTarget = safeRealpathNative(targetFile);
  const relReal = path.relative(realRoot, realTarget).replace(/\\/g, '/');
  if (relReal && !relReal.startsWith('..') && !path.isAbsolute(relReal)) {
    return relReal;
  }
  return path.relative(root, targetFile).replace(/\\/g, '/');
}

function resolveCandidateFilesForSymbol(
  root: string,
  parsed: ReturnType<typeof parseSymbolTarget>
): string[] {
  const candidateFiles: string[] = [];
  if (!parsed.fileHint) return candidateFiles;

  const cleanHint = parsed.fileHint.replace(/^[/\\]+/, '');
  const directHint = path.resolve(root, cleanHint);
  const absHint = path.resolve(parsed.fileHint);
  const fullHint =
    isRealSubpathOf(root, directHint) &&
    fs.existsSync(directHint) &&
    fs.statSync(directHint).isFile()
      ? directHint
      : isRealSubpathOf(root, absHint) &&
          fs.existsSync(absHint) &&
          fs.statSync(absHint).isFile()
        ? absHint
        : null;

  if (fullHint) {
    candidateFiles.push(fullHint);
  } else if (!path.isAbsolute(parsed.fileHint) && !cleanHint.includes('..')) {
    // Try matching by suffix inside workspace only (never escape workspace root)
    const allFiles = collectWorkspaceSourceFiles(root);
    const normHint = cleanHint.replace(/\\/g, '/').toLowerCase();
    for (const f of allFiles) {
      if (!isRealSubpathOf(root, f)) continue;
      const rel = path.relative(root, f).replace(/\\/g, '/').toLowerCase();
      if (rel === normHint || rel.endsWith(`/${normHint}`)) {
        candidateFiles.push(f);
      }
    }
  }
  return candidateFiles;
}

function buildWholeFileFingerprintFromContent(
  root: string,
  targetFile: string,
  rawContent: string,
  parsed: ReturnType<typeof parseSymbolTarget>
): SymbolFingerprint {
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

function extractSymbolFingerprintFromFileContent(
  root: string,
  filePath: string,
  rawContent: string,
  parsed: ReturnType<typeof parseSymbolTarget>
): SymbolFingerprint | null {
  if (!rawContent.includes(parsed.symbolName)) return null;

  const lines = rawContent.split(/\r?\n/);
  const ext = path.extname(filePath).toLowerCase();
  const extracted = extractSymbolBlockFromLines(lines, parsed.symbolName, parsed.classHint, ext);
  if (!extracted) return null;

  const relPath = resolveCanonicalRelativePath(root, filePath);
  return {
    symbol: parsed.raw,
    file_path: relPath,
    file: relPath,
    kind: extracted.kind,
    start_line: extracted.start_line,
    end_line: extracted.end_line,
    signature: extracted.signature,
    ast_hash: computeAstHash(extracted.blockCode, ext),
  } as unknown as SymbolFingerprint;
}

export const BARREL_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
] as const;
export const BARREL_JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);
export const BARREL_INDEX_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'] as const;

export function extractRelativeBarrelSpecifiers(rawContent: string, ext = '.ts'): string[] {
  if (!rawContent || !rawContent.includes('from')) return [];
  const stripped = stripCStyleComments(rawContent, ext);
  const re =
    /(?:^|[\n\r;])\s*export\s+(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g;
  const specifiers: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const spec = m[1]?.trim();
    if (spec && !seen.has(spec)) {
      seen.add(spec);
      specifiers.push(spec);
    }
  }
  return specifiers;
}

function resolveRelativeBarrelFile(
  root: string,
  fromDir: string,
  specifier: string
): string | null {
  const rawTarget = path.resolve(fromDir, specifier);
  const specExt = path.extname(specifier).toLowerCase();
  const candidates: string[] = [];

  if (BARREL_JS_EXTENSIONS.has(specExt)) {
    const stem = rawTarget.slice(0, -specExt.length);
    for (const ext of BARREL_EXTENSIONS) {
      candidates.push(stem + ext);
    }
  } else if (!specExt) {
    for (const ext of BARREL_EXTENSIONS) {
      candidates.push(rawTarget + ext);
    }
    for (const idxExt of BARREL_INDEX_EXTENSIONS) {
      candidates.push(path.join(rawTarget, `index${idxExt}`));
    }
  } else {
    candidates.push(rawTarget);
  }

  for (const cand of candidates) {
    if (isRealSubpathOf(root, cand) && fs.existsSync(cand)) {
      try {
        if (fs.statSync(cand).isFile()) {
          return cand;
        }
      } catch {
        // ignore stat errors
      }
    }
  }
  return null;
}

export function resolveBarrelReexportTargets(
  root: string,
  filePath: string,
  maxDepth = 2
): string[] {
  if (maxDepth <= 0) return [];
  const resolvedRoot = path.resolve(root);
  const startFile = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolvedRoot, filePath);

  if (!isRealSubpathOf(resolvedRoot, startFile) || !fs.existsSync(startFile)) {
    return [];
  }
  try {
    if (!fs.statSync(startFile).isFile()) return [];
  } catch {
    return [];
  }

  const visited = new Set<string>([safeRealpathNative(startFile)]);
  const results: string[] = [];
  const queue: Array<{ file: string; depth: number }> = [{ file: startFile, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    let rawContent: string;
    try {
      rawContent = fs.readFileSync(current.file, 'utf8');
    } catch {
      continue;
    }

    const ext = path.extname(current.file).toLowerCase();
    const specifiers = extractRelativeBarrelSpecifiers(rawContent, ext);
    const fromDir = path.dirname(current.file);

    for (const spec of specifiers) {
      const target = resolveRelativeBarrelFile(resolvedRoot, fromDir, spec);
      if (!target) continue;
      const canonical = safeRealpathNative(target);
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      results.push(target);
      if (current.depth + 1 < maxDepth) {
        queue.push({ file: target, depth: current.depth + 1 });
      }
    }
  }

  return results;
}

export function extractSymbolFingerprint(
  workspaceRoot: string,
  rawSpec: string
): SymbolFingerprint | null {
  const root = path.resolve(workspaceRoot);
  const parsed = parseSymbolTarget(rawSpec);
  const candidateFiles = resolveCandidateFilesForSymbol(root, parsed);

  if (parsed.isWholeFile) {
    if (candidateFiles.length === 0) return null;
    const targetFile = candidateFiles[0];
    if (!isRealSubpathOf(root, targetFile)) return null;
    const rawContent = fs.readFileSync(targetFile, 'utf8');
    return buildWholeFileFingerprintFromContent(root, targetFile, rawContent, parsed);
  }

  // Case 2: Search symbol in candidateFiles first, then fallback to barrel re-exports / workspace files
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
      const fp = extractSymbolFingerprintFromFileContent(root, filePath, rawContent, parsed);
      if (fp) return fp;
    }
    return null;
  };

  const primaryHit = tryExtractFromPool(searchPool);
  if (primaryHit) return primaryHit;

  // Follow barrel re-exports (depth <= 2) before falling back to workspace-wide scan
  if (candidateFiles.length > 0) {
    const barrelTargets: string[] = [];
    const seenTargets = new Set<string>();
    for (const hintFile of candidateFiles) {
      for (const target of resolveBarrelReexportTargets(root, hintFile, 2)) {
        if (!seenTargets.has(target)) {
          seenTargets.add(target);
          barrelTargets.push(target);
        }
      }
    }
    if (barrelTargets.length > 0) {
      const barrelHit = tryExtractFromPool(barrelTargets);
      if (barrelHit) return barrelHit;
    }
    const allFiles = collectWorkspaceSourceFiles(root);
    return tryExtractFromPool(allFiles);
  }

  return null;
}

export async function extractSymbolFingerprintAsync(
  workspaceRoot: string,
  rawSpec: string
): Promise<SymbolFingerprint | null> {
  const root = path.resolve(workspaceRoot);
  const parsed = parseSymbolTarget(rawSpec);
  const candidateFiles = resolveCandidateFilesForSymbol(root, parsed);

  if (parsed.isWholeFile) {
    if (candidateFiles.length === 0) return null;
    const targetFile = candidateFiles[0];
    if (!isRealSubpathOf(root, targetFile)) return null;
    const rawContent = await fs.promises.readFile(targetFile, 'utf8');
    return buildWholeFileFingerprintFromContent(root, targetFile, rawContent, parsed);
  }

  const searchPool =
    candidateFiles.length > 0 ? candidateFiles : collectWorkspaceSourceFiles(root);

  const tryExtractFromPoolAsync = async (pool: string[]): Promise<SymbolFingerprint | null> => {
    for (const filePath of pool) {
      let rawContent: string;
      try {
        rawContent = await fs.promises.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      const fp = extractSymbolFingerprintFromFileContent(root, filePath, rawContent, parsed);
      if (fp) return fp;
    }
    return null;
  };

  const primaryHit = await tryExtractFromPoolAsync(searchPool);
  if (primaryHit) return primaryHit;

  if (candidateFiles.length > 0) {
    const barrelTargets: string[] = [];
    const seenTargets = new Set<string>();
    for (const hintFile of candidateFiles) {
      for (const target of resolveBarrelReexportTargets(root, hintFile, 2)) {
        if (!seenTargets.has(target)) {
          seenTargets.add(target);
          barrelTargets.push(target);
        }
      }
    }
    if (barrelTargets.length > 0) {
      const barrelHit = await tryExtractFromPoolAsync(barrelTargets);
      if (barrelHit) return barrelHit;
    }
    const allFiles = collectWorkspaceSourceFiles(root);
    return await tryExtractFromPoolAsync(allFiles);
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
