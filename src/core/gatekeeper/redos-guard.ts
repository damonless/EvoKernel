const NON_ASCII_SENTINEL = 128;

function addCharWithCase(set: Set<number>, code: number): void {
  set.add(code);
  if (code >= 65 && code <= 90) {
    set.add(code + 32); // lowercase
  } else if (code >= 97 && code <= 122) {
    set.add(code - 32); // uppercase
  }
}

function parseCharClass(raw: string): Set<number> {
  const isNegated = raw.startsWith('^');
  const inner = isNegated ? raw.slice(1) : raw;
  const positive = new Set<number>();
  let hasSpecialSentinel = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      i++;
      const esc = inner[i];
      if (esc === 'd') {
        for (let c = 48; c <= 57; c++) positive.add(c);
      } else if (esc === 'D') {
        hasSpecialSentinel = true;
        for (let c = 0; c < 128; c++) if (c < 48 || c > 57) positive.add(c);
      } else if (esc === 'w') {
        for (let c = 48; c <= 57; c++) positive.add(c);
        for (let c = 65; c <= 90; c++) positive.add(c);
        for (let c = 97; c <= 122; c++) positive.add(c);
        positive.add(95); // '_'
      } else if (esc === 'W') {
        hasSpecialSentinel = true;
        for (let c = 0; c < 128; c++) {
          if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)) {
            positive.add(c);
          }
        }
      } else if (esc === 's') {
        [32, 9, 10, 13, 12, 11].forEach((c) => positive.add(c));
      } else if (esc === 'S') {
        hasSpecialSentinel = true;
        for (let c = 0; c < 128; c++) {
          if (![32, 9, 10, 13, 12, 11].includes(c)) positive.add(c);
        }
      } else {
        addCharWithCase(positive, esc.charCodeAt(0));
      }
      continue;
    }

    if (i + 2 < inner.length && inner[i + 1] === '-' && inner[i + 2] !== ']') {
      const start = ch.charCodeAt(0);
      const end = inner[i + 2].charCodeAt(0);
      i += 2;
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let c = min; c <= max; c++) {
        addCharWithCase(positive, c);
      }
      continue;
    }

    addCharWithCase(positive, ch.charCodeAt(0));
  }

  const result = new Set<number>();
  if (isNegated) {
    result.add(NON_ASCII_SENTINEL);
    for (let c = 0; c < 128; c++) {
      if (!positive.has(c)) {
        result.add(c);
      }
    }
  } else {
    for (const c of positive) result.add(c);
    if (hasSpecialSentinel) result.add(NON_ASCII_SENTINEL);
  }
  return result;
}

interface RegexAtom {
  chars: Set<number>;
  optional: boolean;
}

function splitBranches(pattern: string): string[] {
  let inClass = false;
  let parenDepth = 0;
  const branches: string[] = [];
  let currentBranch = '';

  for (let j = 0; j < pattern.length; j++) {
    const c = pattern[j];
    if (c === '\\') {
      currentBranch += c;
      if (j + 1 < pattern.length) {
        currentBranch += pattern[++j];
      }
      continue;
    }
    if (c === '[' && !inClass) {
      inClass = true;
      currentBranch += c;
      continue;
    }
    if (c === ']' && inClass) {
      inClass = false;
      currentBranch += c;
      continue;
    }
    if (inClass) {
      currentBranch += c;
      continue;
    }
    if (c === '(') {
      parenDepth++;
      currentBranch += c;
      continue;
    }
    if (c === ')') {
      if (parenDepth > 0) parenDepth--;
      currentBranch += c;
      continue;
    }
    if (c === '|' && parenDepth === 0) {
      branches.push(currentBranch);
      currentBranch = '';
      continue;
    }
    currentBranch += c;
  }
  branches.push(currentBranch);
  return branches;
}

function parseBranchAtoms(branch: string): { atoms: RegexAtom[]; nullable: boolean } {
  const atoms: RegexAtom[] = [];
  let i = 0;

  while (i < branch.length) {
    const ch = branch[i];

    // Anchors: skip zero-width
    if (ch === '^' || ch === '$') {
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < branch.length && (branch[i + 1] === 'b' || branch[i + 1] === 'B')) {
      i += 2;
      continue;
    }

    let atomChars = new Set<number>();
    let subGroupNullable = false;

    if (ch === '\\' && i + 1 < branch.length) {
      i++;
      const esc = branch[i];
      i++;
      if (esc === 'd') {
        for (let c = 48; c <= 57; c++) atomChars.add(c);
      } else if (esc === 'D') {
        atomChars.add(NON_ASCII_SENTINEL);
        for (let c = 0; c < 128; c++) if (c < 48 || c > 57) atomChars.add(c);
      } else if (esc === 'w') {
        for (let c = 48; c <= 57; c++) atomChars.add(c);
        for (let c = 65; c <= 90; c++) atomChars.add(c);
        for (let c = 97; c <= 122; c++) atomChars.add(c);
        atomChars.add(95);
      } else if (esc === 'W') {
        atomChars.add(NON_ASCII_SENTINEL);
        for (let c = 0; c < 128; c++) {
          if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)) {
            atomChars.add(c);
          }
        }
      } else if (esc === 's') {
        [32, 9, 10, 13, 12, 11].forEach((c) => atomChars.add(c));
      } else if (esc === 'S') {
        atomChars.add(NON_ASCII_SENTINEL);
        for (let c = 0; c < 128; c++) {
          if (![32, 9, 10, 13, 12, 11].includes(c)) atomChars.add(c);
        }
      } else if (esc === 'n') {
        atomChars.add(10);
      } else if (esc === 'r') {
        atomChars.add(13);
      } else if (esc === 't') {
        atomChars.add(9);
      } else {
        addCharWithCase(atomChars, esc.charCodeAt(0));
      }
    } else if (ch === '.') {
      i++;
      atomChars.add(NON_ASCII_SENTINEL);
      for (let c = 0; c < 128; c++) atomChars.add(c);
    } else if (ch === '[') {
      const start = i + 1;
      let end = start;
      let escaped = false;
      while (end < branch.length) {
        if (escaped) {
          escaped = false;
          end++;
          continue;
        }
        if (branch[end] === '\\') {
          escaped = true;
          end++;
          continue;
        }
        if (branch[end] === ']' && end > start) {
          break;
        }
        end++;
      }
      const rawClass = branch.slice(start, end);
      atomChars = parseCharClass(rawClass);
      i = end + 1;
    } else if (ch === '(') {
      let depth = 1;
      const start = i + 1;
      let end = start;
      let inSubClass = false;
      while (end < branch.length && depth > 0) {
        const sc = branch[end];
        if (sc === '\\' && end + 1 < branch.length) {
          end += 2;
          continue;
        }
        if (sc === '[' && !inSubClass) inSubClass = true;
        else if (sc === ']' && inSubClass) inSubClass = false;
        else if (!inSubClass) {
          if (sc === '(') depth++;
          else if (sc === ')') depth--;
        }
        if (depth === 0) break;
        end++;
      }
      const subInner = branch.slice(start, end).replace(/^\?(?::|<[^>]+>)/, '');
      const subBranches = splitBranches(subInner);
      for (const sb of subBranches) {
        const parsed = parseBranchAtoms(sb);
        if (parsed.nullable) {
          subGroupNullable = true;
        }
        for (const a of parsed.atoms) {
          for (const c of a.chars) {
            atomChars.add(c);
          }
          if (!a.optional) break;
        }
      }
      i = end + 1;
    } else {
      addCharWithCase(atomChars, ch.charCodeAt(0));
      i++;
    }

    let optional = subGroupNullable;
    if (i < branch.length) {
      if (branch[i] === '?') {
        optional = true;
        i++;
        if (i < branch.length && branch[i] === '?') i++;
      } else if (branch[i] === '{') {
        const qm = branch.slice(i).match(/^\{(\d+)(?:,(\d*))?\}\??/);
        if (qm) {
          if (qm[1] === '0' && (qm[2] === undefined || qm[2] === '0' || qm[2] === '1')) {
            optional = true;
          }
          i += qm[0].length;
        }
      }
    }

    atoms.push({ chars: atomChars, optional });
  }

  const nullable = atoms.length === 0 || atoms.every((a) => a.optional);
  return { atoms, nullable };
}

function hasAmbiguousOrOverlappingGroup(inner: string): boolean {
  if (/^\?(?:=|!|<=|<!)/.test(inner)) return true;

  const cleanInner = inner.replace(/^\?(?::|<[^>]+>)/, '');

  if (hasInnerRepetitionQuantifier(cleanInner)) return true;

  const branches = splitBranches(cleanInner);
  const parsedBranches: RegexAtom[][] = [];
  const branchStartSets: Set<number>[] = [];

  for (const branch of branches) {
    if (branch.trim() === '') return true;
    const { atoms, nullable } = parseBranchAtoms(branch);
    if (nullable) return true;
    parsedBranches.push(atoms);

    const startSet = new Set<number>();
    for (const a of atoms) {
      for (const c of a.chars) startSet.add(c);
      if (!a.optional) break;
    }
    branchStartSets.push(startSet);
  }

  if (branches.length >= 2) {
    for (let a = 0; a < branchStartSets.length; a++) {
      for (let b = a + 1; b < branchStartSets.length; b++) {
        for (const code of branchStartSets[a]) {
          if (branchStartSets[b].has(code)) {
            return true;
          }
        }
      }
    }
  }

  const groupStartSet = new Set<number>();
  for (const s of branchStartSets) {
    for (const c of s) groupStartSet.add(c);
  }

  for (const atoms of parsedBranches) {
    for (let idx = 0; idx < atoms.length; idx++) {
      if (!atoms[idx].optional) continue;

      const followSet = new Set<number>();
      let reachesEnd = true;

      for (let m = idx + 1; m < atoms.length; m++) {
        for (const c of atoms[m].chars) followSet.add(c);
        if (!atoms[m].optional) {
          reachesEnd = false;
          break;
        }
      }

      if (reachesEnd) {
        for (const c of groupStartSet) followSet.add(c);
      }

      for (const c of atoms[idx].chars) {
        if (followSet.has(c)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function hasUnsafeHookRegex(pattern: string): boolean {
  let inCharClass = false;
  const parenStack: number[] = [];

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[' && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (ch === ']' && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (inCharClass) {
      continue;
    }

    if (ch === '(') {
      parenStack.push(i);
    } else if (ch === ')' && parenStack.length > 0) {
      const openIdx = parenStack.pop()!;
      const rest = pattern.slice(i + 1);

      let isRepeated = false;
      const quantMatch = rest.match(/^(\+|\*|\{(\d+)(?:,(\d*))?\})\??/);
      if (quantMatch) {
        if (quantMatch[1] === '+' || quantMatch[1] === '*') {
          isRepeated = true;
        } else if (quantMatch[2] !== undefined) {
          const maxStr = quantMatch[3];
          if (maxStr === undefined) {
            const m = parseInt(quantMatch[2], 10);
            if (m > 1) isRepeated = true;
          } else if (maxStr === '') {
            isRepeated = true;
          } else {
            const n = parseInt(maxStr, 10);
            if (n > 1) isRepeated = true;
          }
        }
      }

      if (isRepeated) {
        const inner = pattern.slice(openIdx + 1, i);
        if (hasAmbiguousOrOverlappingGroup(inner)) {
          return true;
        }
      }
    }
  }

  return false;
}

function hasInnerRepetitionQuantifier(inner: string): boolean {
  let inClass = false;
  for (let j = 0; j < inner.length; j++) {
    const c = inner[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '[' && !inClass) {
      inClass = true;
      continue;
    }
    if (c === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;

    if (c === '+' || c === '*') {
      return true;
    }
    if (c === '{') {
      const qm = inner.slice(j).match(/^\{(\d+)(?:,(\d*))?\}/);
      if (qm) {
        if (qm[2] === undefined) {
          if (parseInt(qm[1], 10) > 1) return true;
        } else if (qm[2] === '') {
          return true;
        } else {
          if (parseInt(qm[2], 10) > 1) return true;
        }
      }
    }
  }
  return false;
}
