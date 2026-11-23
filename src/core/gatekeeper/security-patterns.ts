import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectWorkspaceSourceFiles, stripCStyleComments } from '../memory.js';

export const UNIVERSAL_SECURITY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
    reason: 'Hardcoded private key block detected',
  },
  {
    pattern: /(\bsk-(?:proj-|ant-|svcacct-)?[a-zA-Z0-9_-]{20,}|\bgh[pousr]_[a-zA-Z0-9_]{20,}|\bAKIA[0-9A-Z]{16})/,
    reason: 'Hardcoded plaintext API secret/token detected',
  },
  {
    pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+\\/i,
    reason:
      'Hardcoded user-specific Windows absolute path detected; use relative paths or process.env.EVO_WORKSPACE',
  },
  {
    pattern: /\/Users\/[A-Za-z0-9_.-]+\/|\/home\/[A-Za-z0-9_.-]+\//,
    reason:
      'Hardcoded user-specific Unix absolute path detected; use relative paths or process.env.EVO_WORKSPACE',
  },
];

export const SCRIPT_EXECUTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+-rf\s+(\/|~|\$HOME|\$EVO_WORKSPACE|\.\.(?:\/|\\|\s|$)|[A-Za-z]:\\)/i,
    reason: 'Destructive root/home/parent directory deletion detected',
  },
  {
    pattern:
      /\b(?:(?:fs(?:\.promises)?|fsPromises)\.(?:rmSync|rmdirSync|rm|rmdir)|rmSync|rmdirSync|rm|rmdir|shutil\.rmtree)\s*\(\s*(?:['"`](?:\/|~|\$HOME|\.\.(?:[/\\][^'"`]*)?|[A-Za-z]:\\)['"`]|os\.homedir\s*\(\)|os\.getcwd\s*\(\)|os\.path\.expanduser\s*\(\s*['"`]~[^'"`]*['"`]\s*\)|Path\.(?:home|cwd)\s*\(\)|process\.cwd\s*\(\)|process\.env(?:\.(?:HOME|USERPROFILE|EVO_WORKSPACE)\b|\[\s*['"`](?:HOME|USERPROFILE|EVO_WORKSPACE)['"`]\s*\])|os\.(?:environ(?:\.get)?|getenv)\s*[\[(]\s*['"`](?:HOME|USERPROFILE|EVO_WORKSPACE)['"`]|workspace(?:Root)?\b)/i,
    reason: 'Destructive programmatic root/home/parent/workspace directory deletion detected',
  },
  {
    pattern:
      /(?:~|\$HOME|%USERPROFILE%|os\.homedir\s*\(\)|Path\.home\s*\(\)|process\.env(?:\.(?:HOME|USERPROFILE)|\[\s*['"`](?:HOME|USERPROFILE)['"`]\s*\])|os\.(?:environ(?:\.get)?|getenv)\s*[\[(]\s*['"`](?:HOME|USERPROFILE)['"`])[\s\S]{0,80}[\/\\'"`]\.(?:ssh|aws|gnupg|kube|env)\b|(?:~|\$HOME|%USERPROFILE%)[\/\\]\.(?:ssh|aws|gnupg|kube|env)\b|[\/\\]\.(?:ssh|aws|gnupg|kube)(?:[\/\\][A-Za-z0-9_.-]+|[\/\\]?['"`])|(?:\.kube[\/\\]config\b|['"`]\.kube['"`]\s*,\s*['"`]config['"`]|['"`]\.kube\/?['"`]\s*\+\s*['"`]\/?config['"`])/i,
    reason: 'Sensitive home credential directory access (~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, ~/.env) detected',
  },
  { pattern: /\b(Format-Volume|Clear-Disk|mkfs\.|dd\s+if=)/i, reason: 'Disk formatting command detected' },
  { pattern: /\b(curl|wget|Invoke-WebRequest|iwr)\b.*\|\s*(sh|bash|pwsh|powershell|iex|Invoke-Expression)/i, reason: 'Remote code pipe execution detected' },
  {
    pattern:
      /\b(?:eval|new\s+Function|vm\.(?:runInNewContext|runInThisContext))\s*\([\s\S]{0,120}\b(?:Buffer\.from|atob|base64|process|fs|child_process)\b/i,
    reason: 'Dynamic eval/Function execution with privileged or decoded payload detected',
  },
  {
    pattern:
      /\b(?:(?:fs|fsPromises|child_process|process|globalThis|global)\s*\[\s*(?:['"`][a-zA-Z0-9_]+['"`]\s*\+\s*['"`][a-zA-Z0-9_]+['"`]|\(?\[[^\]]+\]\)?\.join\s*\([^)]*\))\s*\]|Reflect\.get\s*\(\s*(?:fs|fsPromises|child_process|process|globalThis|global)\b)/,
    reason: 'Obfuscated bracket-concatenation property access on privileged module detected',
  },
  {
    pattern:
      /\bgetattr\s*\(\s*(?:__import__\s*\(\s*['"`](?:os|shutil|subprocess|pty)['"`]\s*\)|sys\.modules\s*\[\s*['"`](?:os|shutil|subprocess|pty)['"`]\s*\]|\(?\b(?:os|shutil|subprocess|pty)\b\)?)\s*,/i,
    reason: 'Obfuscated Python getattr/__import__ execution on privileged module detected',
  },
  {
    pattern:
      /Buffer\.from\s*\([^)]*,\s*['"`]base64['"`]\s*\)[\s\S]{0,120}\b(?:exec|execSync|spawn|spawnSync|eval|Function|rmSync)\b/,
    reason: 'Obfuscated base64 payload execution detected',
  },
  {
    pattern: /\bString\.(?:fromCharCode|fromCodePoint)\s*\(/,
    reason: 'Obfuscated character-code string construction (String.fromCharCode/fromCodePoint) detected',
  },
  {
    pattern: /\bprocess\.(?:binding|dlopen)\s*\(/,
    reason: 'Low-level Node.js process.binding/process.dlopen native bypass detected',
  },
  {
    pattern: /\bmodule\.createRequire\s*\(/,
    reason: 'Dynamic module.createRequire bypass detected',
  },
  {
    pattern: /(?:^|\s)-EncodedCommand\b|\bFromBase64String\s*\(/i,
    reason: 'PowerShell encoded/base64 payload obfuscation detected',
  },
];

export const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  ...UNIVERSAL_SECURITY_PATTERNS,
  ...SCRIPT_EXECUTION_PATTERNS,
];

export const TOOL_NETWORK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bfetch\s*\(/,
    reason: 'Outbound network primitive fetch() blocked by sandbox policy (set allowNetworkTools: true in config to permit)',
  },
  {
    pattern: /['"`](?:node:)?(?:http|https|net|tls|dgram|dns)['"`]/,
    reason: 'Outbound network module import/require (http/https/net/tls/dgram/dns) blocked by sandbox policy',
  },
  {
    pattern: /['"`]undici['"`]/,
    reason: 'Outbound network module import/require (undici) blocked by sandbox policy',
  },
  {
    pattern: /\bnew\s+WebSocket\s*\(/,
    reason: 'Outbound WebSocket connection blocked by sandbox policy',
  },
  {
    pattern: /\b(?:urllib\.request|http\.client|requests\.(?:get|post|put|delete|request)|socket\.socket)\b/,
    reason: 'Outbound Python network primitive blocked by sandbox policy',
  },
  {
    pattern: /\b(?:Invoke-RestMethod|Invoke-WebRequest|iwr|curl|wget)\s+https?:\/\//i,
    reason: 'Outbound Shell/PowerShell HTTP request blocked by sandbox policy',
  },
];

export function scanDangerousPatterns(text: string): string | null {
  for (const rule of DANGEROUS_PATTERNS) {
    if (rule.pattern.test(text)) {
      return rule.reason;
    }
  }
  return null;
}

function stripHashComments(code: string, isPowerShell: boolean): string {
  let out = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTripleSingle = false;
  let inTripleDouble = false;

  while (i < code.length) {
    const ch = code[i];

    if (inTripleSingle) {
      if (code.startsWith("'''", i)) {
        out += "'''";
        i += 3;
        inTripleSingle = false;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (inTripleDouble) {
      if (code.startsWith('"""', i)) {
        out += '"""';
        i += 3;
        inTripleDouble = false;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (inSingle) {
      if (!isPowerShell && ch === '\\' && i + 1 < code.length) {
        out += ch + code[i + 1];
        i += 2;
        continue;
      }
      if (isPowerShell && ch === "'" && code[i + 1] === "'") {
        out += "''";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      out += ch;
      i++;
      continue;
    }

    if (inDouble) {
      const escChar = isPowerShell ? '`' : '\\';
      if (ch === escChar && i + 1 < code.length) {
        out += ch + code[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      out += ch;
      i++;
      continue;
    }

    if (isPowerShell && code.startsWith('<#', i)) {
      const endIdx = code.indexOf('#>', i + 2);
      const stop = endIdx === -1 ? code.length : endIdx + 2;
      for (let k = i; k < stop; k++) {
        out += code[k] === '\n' ? '\n' : ' ';
      }
      i = stop;
      continue;
    }

    if (!isPowerShell && code.startsWith("'''", i)) {
      out += "'''";
      i += 3;
      inTripleSingle = true;
      continue;
    }

    if (!isPowerShell && code.startsWith('"""', i)) {
      out += '"""';
      i += 3;
      inTripleDouble = true;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === '#') {
      while (i < code.length && code[i] !== '\n' && code[i] !== '\r') {
        out += ' ';
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export function stripScriptComments(code: string, ext: string): string {
  const lowerExt = ext.toLowerCase();
  if (
    lowerExt === '.js' ||
    lowerExt === '.mjs' ||
    lowerExt === '.cjs' ||
    lowerExt === '.ts' ||
    lowerExt === '.mts' ||
    lowerExt === '.cts' ||
    lowerExt === '.jsx' ||
    lowerExt === '.tsx'
  ) {
    return stripCStyleComments(code, lowerExt);
  }
  return stripHashComments(code, lowerExt === '.ps1');
}

export const CONTRASTIVE_STOPWORDS = new Set([
  'before',
  'after',
  'fix',
  'fixed',
  'fixes',
  'test',
  'tests',
  'tested',
  'pass',
  'passed',
  'passes',
  'fail',
  'failed',
  'fails',
  'failure',
  'error',
  'errors',
  'prior',
  'instead',
  'vs',
  'versus',
  'with',
  'without',
  'the',
  'and',
  'for',
  'from',
  'that',
  'this',
  'when',
  'code',
  'command',
  'commands',
  'run',
  'runs',
  'ran',
  'issue',
  'issues',
  'bug',
  'bugs',
  'change',
  'changes',
  'changed',
  'edit',
  'edited',
  'edits',
  'only',
  '修改前',
  '修改后',
  '修复前',
  '修复后',
  '对比',
  '之前',
  '之后',
  '通过',
  '失败',
  '报错',
  '测试',
]);

export function isValidContrastiveEvidence(
  rawEvidence: string | undefined,
  workspaceRoot?: string
): boolean {
  if (typeof rawEvidence !== 'string') return false;
  const trimmed = rawEvidence.trim();
  if (trimmed.length < 12) return false;

  const rawTokens = trimmed.match(/[A-Za-z0-9_.\u4e00-\u9fa5/#:-]{2,}/g) || [];
  const substantiveTokens = new Set<string>();
  for (const tok of rawTokens) {
    if (/^[->=→:]+$/.test(tok)) continue;
    const normalized = tok.replace(/^[:.,;()[\]{}]+|[:.,;()[\]{}]+$/g, '').toLowerCase();
    if (normalized.length < 2) continue;
    if (/^[->=→:]+$/.test(normalized)) continue;
    if (CONTRASTIVE_STOPWORDS.has(normalized)) continue;
    substantiveTokens.add(normalized);
  }
  if (substantiveTokens.size < 3) return false;

  const hasContrastiveMarkers =
    /\b(?:before\b[\s\S]*\bafter|before\s*:|after\s*:|vs\.?|versus|prior\s+to|previously|instead\s+of|without\s+\S+[\s\S]*\b(?:with|fail|pass|error|crash|block)|with\s+\S+[\s\S]*\bwithout\b|when\s+.+\s+(?:failed|passed|skipped|blocked|crashed|succeeded)|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?\d+|pass(?:ed|es)?\b[\s\S]*\bfail(?:ed|s|ure)?|fail(?:ed|s|ure)?\b[\s\S]*\bpass(?:ed|es)?|regress(?:ion|ed|es)?|isolat(?:ed|ion)|reproduc(?:ed|ible)|root\s+cause|baseline|unchanged|constant|holding|reverting|reverted)\b|(?:->|=>|→)|(?:修复前|修复后|修改前|修改后|对比|之前|之后)/i.test(
      trimmed
    );

  let wsFiles: string[] = [];
  let wsRelFilesLower: string[] = [];
  let wsContentJoined = '';
  if (workspaceRoot && fs.existsSync(workspaceRoot)) {
    try {
      wsFiles = collectWorkspaceSourceFiles(workspaceRoot, 200);
      wsRelFilesLower = wsFiles.map((f) =>
        path.relative(workspaceRoot, f).replace(/\\/g, '/').toLowerCase()
      );
      if (wsFiles.length > 0) {
        const chunks: string[] = [];
        for (const f of wsFiles.slice(0, 80)) {
          try {
            chunks.push(fs.readFileSync(f, 'utf8'));
          } catch {
            // ignore
          }
        }
        wsContentJoined = chunks.join('\n');
      }
    } catch {
      wsFiles = [];
    }
  }

  const hasWorkspaceSources = wsFiles.length > 0;
  let groundingMatches = 0;
  let verifiedSymbolAnchorCount = 0;
  const seenGrounding = new Set<string>();
  for (const tok of rawTokens) {
    const cleanTok = tok.replace(/^[./\\]+|[.,:;()[\]{}]+$/g, '');
    if (cleanTok.length < 3) continue;
    const lower = cleanTok.toLowerCase();
    if (seenGrounding.has(lower)) continue;

    const looksLikeFileOrSymbol =
      /[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,6}$/.test(cleanTok) ||
      cleanTok.includes('/') ||
      cleanTok.includes('#') ||
      /[a-z][A-Z]/.test(cleanTok) ||
      cleanTok.includes('_');

    if (workspaceRoot && hasWorkspaceSources) {
      let matchedInWorkspace = false;
      let matchedExplicitAnchor = false;
      try {
        const hasExplicitFileSep = cleanTok.includes('#') || cleanTok.includes(':');
        const filePart = cleanTok.includes('#')
          ? cleanTok.split('#')[0]
          : cleanTok.includes(':')
            ? cleanTok.split(':')[0]
            : cleanTok;
        const symPart = cleanTok.includes('#')
          ? cleanTok.split('#')[1]
          : cleanTok.includes(':')
            ? cleanTok.split(':')[1]
            : cleanTok;
        const filePartLower = filePart.replace(/\\/g, '/').toLowerCase();
        let matchedFilePath: string | null = null;
        if (filePartLower) {
          const directCandidate = path.resolve(workspaceRoot, filePart);
          if (fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
            matchedFilePath = directCandidate;
          } else {
            const matchedIdx = wsRelFilesLower.findIndex(
              (r) =>
                r === filePartLower ||
                r.endsWith(`/${filePartLower}`) ||
                path.basename(r) === filePartLower
            );
            if (matchedIdx !== -1) {
              matchedFilePath = wsFiles[matchedIdx];
            }
          }
        }

        if (matchedFilePath) {
          if (!hasExplicitFileSep || !symPart) {
            matchedInWorkspace = true;
          } else {
            let targetFileContent = '';
            try {
              targetFileContent = fs.readFileSync(matchedFilePath, 'utf8');
            } catch {
              targetFileContent = wsContentJoined;
            }
            if (/^L?\d+(?:-L?\d+)?$/i.test(symPart)) {
              const lineNums = (symPart.match(/\d+/g) || []).map((n) => Number.parseInt(n, 10));
              const totalLines = targetFileContent ? targetFileContent.split(/\r?\n/).length : 0;
              if (
                lineNums.length > 0 &&
                totalLines > 0 &&
                lineNums.every((n) => n >= 1 && n <= totalLines)
              ) {
                matchedInWorkspace = true;
                matchedExplicitAnchor = true;
              }
            } else {
              const symLeaf = symPart.includes('.') ? symPart.split('.').pop()! : symPart;
              if (symLeaf.length >= 2 && targetFileContent) {
                const escapedSym = symLeaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                if (new RegExp(`\\b${escapedSym}\\b`).test(targetFileContent)) {
                  matchedInWorkspace = true;
                  matchedExplicitAnchor = true;
                }
              }
            }
          }
        } else if (!hasExplicitFileSep && looksLikeFileOrSymbol && symPart && symPart.length >= 4 && wsContentJoined) {
          const escapedSym = symPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${escapedSym}\\b`).test(wsContentJoined)) {
            matchedInWorkspace = true;
          }
        }
      } catch {
        // ignore
      }
      if (matchedInWorkspace) {
        seenGrounding.add(lower);
        groundingMatches++;
        if (matchedExplicitAnchor) {
          verifiedSymbolAnchorCount++;
        }
      }
      continue;
    }

    if (workspaceRoot) {
      try {
        const candidatePath = path.resolve(workspaceRoot, cleanTok);
        if (fs.existsSync(candidatePath)) {
          seenGrounding.add(lower);
          groundingMatches++;
        }
      } catch {
        // ignore
      }
    }
  }

  const citesCodeFile =
    /(?:^|[\\/\s(['"`])[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|c|cpp|cc|cxx|h|hpp|java|cs|rb|php|swift|kt)(?:#|:|\b)/i.test(
      trimmed
    );
  if (hasWorkspaceSources && citesCodeFile && groundingMatches < 1) {
    return false;
  }

  if (hasContrastiveMarkers) {
    return true;
  }
  return hasWorkspaceSources && verifiedSymbolAnchorCount >= 1 && groundingMatches >= 2;
}
