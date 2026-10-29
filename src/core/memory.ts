import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  EvoMemory,
  MemoryVerificationReport,
  SymbolDriftCheck,
  SymbolFingerprint,
  SymbolKind,
  TopologyAnchor,
} from './types.js';

const SOURCE_EXTENSIONS = new Set([
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

export function resolveCurrentGitCommit(workspaceRoot: string): string {
  try {
    const res = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    if (res.status === 0 && res.stdout) {
      const sha = res.stdout.trim();
      if (sha) return sha;
    }
  } catch {
    // ignore git spawn errors
  }
  return 'uncommitted';
}

export function resolveCurrentGitBranch(workspaceRoot: string): string | undefined {
  try {
    const res = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 1500,
    });
    if (res.status === 0 && res.stdout) {
      const branch = res.stdout.trim();
      if (branch && branch !== 'HEAD') {
        return branch;
      }
    }
  } catch {
    // ignore git spawn errors
  }
  return undefined;
}

/**
 * Strips comments and normalizes whitespace/punctuation so that pure formatting,
 * indentation, line shifts, or comment edits do NOT alter the structural AST hash,
 * whereas any modification to signature, statements, conditions, or identifiers DOES.
 */
export function normalizeCodeStructure(code: string, ext = '.ts'): string {
  if (!code) return '';
  let stripped = code;

  if (ext === '.py') {
    // Strip Python triple-quoted docstrings and # line comments outside strings
    stripped = stripped
      .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, ' ')
      .replace(/(^|\s)#[^\r\n]*/g, ' ');
  } else {
    // Strip C/TS/JS block comments /* ... */ and line comments // ...
    stripped = stripCStyleComments(stripped);
  }

  return stripped
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\];,:<>+=*/&|!?-])\s*/g, '$1')
    .trim();
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

export function stripCStyleComments(input: string): string {
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
      out += ch;
      if (ch === '\\' && i + 1 < len) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      out += ch;
      if (ch === '\\' && i + 1 < len) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (inTemplate) {
      out += ch;
      if (ch === '\\' && i + 1 < len) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') inTemplate = false;
      i++;
      continue;
    }

    // Check comment starts
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && input[i] !== '\n') i++;
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

    // Check JavaScript/TypeScript regular expression literal
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

    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '`') inTemplate = true;

    out += ch;
    i++;
  }

  return out;
}

export function computeAstHash(code: string, ext = '.ts'): string {
  const canonical = normalizeCodeStructure(code, ext);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
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
      regex: new RegExp(`^\\s*(?:export\\s+)?type\\s+${esc}\\s*(?:<[^>]*>)?\\s*=`),
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
      regex: new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${esc}\\s*(?::[^=]+)?=`),
    },
    // Class method in TS/JS/Java/C# (e.g., "public async search(" or "private initSchema(")
    {
      kind: 'method',
      regex: new RegExp(
        `^\\s*(?:(?:public|private|protected|static|readonly|async|override|virtual|inline)\\s+)*${esc}\\s*(?:<[^>]*>)?\\s*\\([^;{]*(?:\\{.*)?$`
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
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
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
            const opensBraceSoon =
              cleanLine.includes('{') ||
              (i + 1 < lines.length && lines[i + 1].includes('{')) ||
              (i + 2 < lines.length && lines[i + 2].includes('{')) ||
              (i + 3 < lines.length && lines[i + 3].includes('{'));
            if (!hasModifierOrKeyword && !opensBraceSoon) {
              continue;
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

function findBraceBlockEnd(lines: string[], startIndex: number): number {
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

function findPythonBlockEnd(lines: string[], startIndex: number): number {
  const startLine = lines[startIndex];
  const baseIndent = startLine.match(/^\s*/)?.[0].length ?? 0;
  let lastContentLine = startIndex;

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent) {
      break;
    }
    lastContentLine = i;
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
      const endIdx =
        ext === '.py'
          ? findPythonBlockEnd(lines, decl.lineIndex)
          : findBraceBlockEnd(lines, decl.lineIndex);

      const blockCode = lines.slice(decl.lineIndex, endIdx + 1).join('\n');
      const relPath = resolveCanonicalRelativePath(root, filePath);

      return {
        symbol: parsed.raw,
        file_path: relPath,
        file: relPath,
        kind: decl.kind,
        start_line: decl.lineIndex + 1,
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
  const files = collectWorkspaceSourceFiles(root, 300);
  const callers: string[] = [];

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
        callers.push(`${rel}:${lineNo}`);
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

      const endIdx =
        ext === '.py'
          ? findPythonBlockEnd(lines, decl.lineIndex)
          : findBraceBlockEnd(lines, decl.lineIndex);
      const blockCode = lines.slice(decl.lineIndex, endIdx + 1).join('\n');

      return {
        symbol: rawSpec,
        file_path: cleanRel,
        kind: decl.kind,
        start_line: decl.lineIndex + 1,
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

export function verifyMemoryFreshness(
  workspaceRoot: string,
  memory: EvoMemory,
  options?: { includeCallers?: boolean }
): MemoryVerificationReport {
  const root = path.resolve(workspaceRoot);
  const includeCallers = options?.includeCallers ?? true;
  const currentCommit = resolveCurrentGitCommit(root);
  const currentBranch = resolveCurrentGitBranch(root);
  const hasCodeGraph = fs.existsSync(path.join(root, '.codegraph'));

  const checks: SymbolDriftCheck[] = [];
  const topologyAnchors: TopologyAnchor[] = [];

  const targetKeys =
    Object.keys(memory.ast_fingerprints).length > 0
      ? Object.keys(memory.ast_fingerprints)
      : memory.target_symbols;

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

  const totalSymbols = targetKeys.length;

  // Tier 1: All symbols verified in live working tree (shared code across branches or current branch)
  if (totalSymbols > 0 && verifiedCount === totalSymbols) {
    return {
      memory_id: memory.id,
      overall_status: 'VERIFIED',
      confidence_tag: '[置信度: HIGH (≥80%)]',
      commit_match: memory.created_commit === currentCommit,
      recorded_commit: memory.created_commit,
      current_commit: currentCommit,
      recorded_branch: memory.created_branch,
      current_branch: currentBranch,
      branch_verified_count: 0,
      verified_count: verifiedCount,
      total_symbols: totalSymbols,
      checks,
      topology_anchors: topologyAnchors,
    };
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
      return {
        memory_id: memory.id,
        overall_status: 'OTHER_BRANCH',
        confidence_tag: '[置信度: MID (50–80%) · OTHER_BRANCH]',
        commit_match: false,
        recorded_commit: resolvedCommitRef,
        current_commit: currentCommit,
        recorded_branch: resolvedBranchLabel || 'other-branch',
        current_branch: currentBranch,
        branch_verified_count: branchVerifiedCount,
        verified_count: verifiedCount,
        total_symbols: totalSymbols,
        checks,
        topology_anchors: topologyAnchors,
      };
    }
  }

  // Tier 3: True code drift (STALE)
  return {
    memory_id: memory.id,
    overall_status: 'STALE',
    confidence_tag: '[置信度: LOW (20–50%) · STALE]',
    commit_match: memory.created_commit === currentCommit,
    recorded_commit: memory.created_commit,
    current_commit: currentCommit,
    recorded_branch: memory.created_branch,
    current_branch: currentBranch,
    branch_verified_count: 0,
    verified_count: verifiedCount,
    total_symbols: totalSymbols,
    checks,
    topology_anchors: topologyAnchors,
  };
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

