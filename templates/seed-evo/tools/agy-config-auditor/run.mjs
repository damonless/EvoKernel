import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

let evoArgs = {};
try {
  if (process.env.EVO_ARGS) evoArgs = JSON.parse(process.env.EVO_ARGS);
} catch {}
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('{') && arg.endsWith('}')) {
    try {
      Object.assign(evoArgs, JSON.parse(arg));
    } catch {}
  }
}

const isSelfTest =
  process.env.EVO_SELF_TEST === '1' ||
  process.argv.includes('--self-test') ||
  Boolean(evoArgs['--self-test'] || evoArgs.self_test);
const root = path.resolve(process.env.EVO_WORKSPACE || process.cwd());

function isInsideGlobalEvoDir(pkgRoot) {
  const norm = path.resolve(pkgRoot).replace(/\\/g, '/').toLowerCase();
  const globalHome = process.env.EVO_GLOBAL_DIR
    ? path.resolve(process.env.EVO_GLOBAL_DIR).replace(/\\/g, '/').toLowerCase()
    : path.join(os.homedir(), '.evo', 'global').replace(/\\/g, '/').toLowerCase();
  return (
    norm === globalHome ||
    norm.startsWith(globalHome + '/') ||
    norm.includes('/.evo/global/') ||
    norm.endsWith('/.evo/global')
  );
}

function isTrustedEvoRoot(pkgRoot, requireBin = false) {
  if (!pkgRoot || typeof pkgRoot !== 'string') return false;
  try {
    const resolved = path.resolve(pkgRoot);
    if (requireBin && isInsideGlobalEvoDir(resolved)) return false;
    const pkgPath = path.join(resolved, 'package.json');
    if (!fs.existsSync(pkgPath) || !fs.statSync(pkgPath).isFile()) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!pkg || typeof pkg !== 'object' || pkg.name !== 'evo-kernel') return false;
    if (requireBin) {
      const binPath = path.join(resolved, 'bin', 'evo.mjs');
      if (!fs.existsSync(binPath) || !fs.statSync(binPath).isFile()) return false;
    }
    const distDir = path.join(resolved, 'dist');
    return (
      fs.existsSync(path.join(distDir, 'cli', 'audit.js')) &&
      fs.existsSync(path.join(distDir, 'core', 'memory.js')) &&
      fs.existsSync(path.join(distDir, 'core', 'storage.js'))
    );
  } catch {
    return false;
  }
}

function resolveDistDir() {
  const candidates = [
    { root: process.env.EVO_PACKAGE_ROOT ? path.resolve(process.env.EVO_PACKAGE_ROOT) : '', requireBin: false },
    { root: process.env.EVO_KERNEL_ROOT ? path.resolve(process.env.EVO_KERNEL_ROOT) : '', requireBin: false },
    { root: path.resolve(import.meta.dirname, '..', '..', '..'), requireBin: true },
    { root: path.resolve(import.meta.dirname, '..', '..', '..', '..'), requireBin: true },
    {
      root: process.env.APPDATA
        ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'evo-kernel')
        : '',
      requireBin: false,
    },
    { root: path.resolve(process.execPath, '../../lib/node_modules/evo-kernel'), requireBin: false },
    { root: path.resolve(process.execPath, '../node_modules/evo-kernel'), requireBin: false },
    { root: path.join(os.homedir(), '.gemini', 'config', 'plugins', 'evo-kernel'), requireBin: false },
    { root: path.join(os.homedir(), '.gemini', 'extensions', 'evo-kernel'), requireBin: false },
  ];
  for (const cand of candidates) {
    if (cand.root && isTrustedEvoRoot(cand.root, cand.requireBin)) {
      return path.join(cand.root, 'dist');
    }
  }
  return '';
}

const distDir = resolveDistDir();
if (!distDir) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        status: 'UNHEALTHY',
        error: 'ERR_AUDITOR_ENGINE_UNAVAILABLE',
        violations: ['ERR_AUDITOR_ENGINE_UNAVAILABLE'],
      },
      null,
      2
    )
  );
  process.exit(1);
}

const { runAudit, auditHarnessSurfaces } = await import(pathToFileURL(path.join(distDir, 'cli', 'audit.js')).href);
const { verifyMemoryFreshness, parseSymbolTarget, resolveBarrelReexportTargets } = await import(pathToFileURL(path.join(distDir, 'core', 'memory.js')).href);
const { EvoStorage, parseFrontmatter } = await import(pathToFileURL(path.join(distDir, 'core', 'storage.js')).href);

function collectSplitBrainDivergences(targetRoot) {
  const globalHome = process.env.EVO_GLOBAL_DIR ? path.resolve(process.env.EVO_GLOBAL_DIR) : path.join(os.homedir(), '.evo', 'global');
  const globalEvoDir = fs.existsSync(path.join(globalHome, '.evo')) ? path.join(globalHome, '.evo') : globalHome;
  if (!fs.existsSync(globalEvoDir)) return [];

  const divergences = [];
  const norm = (s) => String(s || '').replace(/^\uFEFF/, '').replace(/\r?\n/g, '\n').trim();
  const sortEnts = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  const compareRulesDir = (locDir, globDir) => {
    if (!fs.existsSync(locDir) || !fs.existsSync(globDir) || path.resolve(locDir).toLowerCase() === path.resolve(globDir).toLowerCase()) return;
    for (const ent of sortEnts(locDir)) {
      if (!ent.isFile() || !ent.name.endsWith('.md') || ent.name === 'core-invariants.md') continue;
      const locFile = path.join(locDir, ent.name);
      const globFile = path.join(globDir, ent.name);
      if (!fs.existsSync(globFile)) continue;
      const locBody = norm(parseFrontmatter(fs.readFileSync(locFile, 'utf8')).body);
      const globBody = norm(parseFrontmatter(fs.readFileSync(globFile, 'utf8')).body);
      if (locBody !== globBody) {
        divergences.push({ capability: 'rule', id: path.basename(ent.name, '.md'), local_path: path.relative(targetRoot, locFile).replace(/\\/g, '/'), global_path: globFile, reason: 'Rule content / actionable clauses diverge between local and global trees.' });
      }
    }
  };
  compareRulesDir(path.join(targetRoot, '.evo', 'rules'), path.join(globalEvoDir, 'rules'));
  compareRulesDir(path.join(targetRoot, '.evo', 'rules', 'scoped'), path.join(globalEvoDir, 'rules', 'scoped'));

  const globalSkillsDir = path.join(globalEvoDir, 'skills');
  for (const locSkillsDir of [path.join(targetRoot, '.evo', 'skills'), path.join(targetRoot, 'config', 'skills'), path.join(targetRoot, 'skills')]) {
    if (!fs.existsSync(locSkillsDir) || !fs.existsSync(globalSkillsDir) || path.resolve(locSkillsDir).toLowerCase() === path.resolve(globalSkillsDir).toLowerCase()) continue;
    for (const ent of sortEnts(locSkillsDir)) {
      if (!ent.isDirectory()) continue;
      const locSkill = path.join(locSkillsDir, ent.name, 'SKILL.md');
      const globSkill = path.join(globalSkillsDir, ent.name, 'SKILL.md');
      if (!fs.existsSync(locSkill) || !fs.existsSync(globSkill)) continue;
      const locBody = norm(parseFrontmatter(fs.readFileSync(locSkill, 'utf8')).body);
      const globBody = norm(parseFrontmatter(fs.readFileSync(globSkill, 'utf8')).body);
      const relLoc = path.relative(targetRoot, locSkill).replace(/\\/g, '/');
      if (locBody !== globBody && !divergences.some((d) => d.capability === 'skill' && d.local_path === relLoc)) {
        divergences.push({ capability: 'skill', id: ent.name, local_path: relLoc, global_path: globSkill, reason: 'Skill SOP body diverges between local and global trees.' });
      }
    }
  }

  const locToolsDir = path.join(targetRoot, '.evo', 'tools');
  const globToolsDir = path.join(globalEvoDir, 'tools');
  if (fs.existsSync(locToolsDir) && fs.existsSync(globToolsDir) && path.resolve(locToolsDir).toLowerCase() !== path.resolve(globToolsDir).toLowerCase()) {
    for (const ent of sortEnts(locToolsDir)) {
      if (!ent.isDirectory()) continue;
      const locScript = path.join(locToolsDir, ent.name, 'run.mjs');
      const globScript = path.join(globToolsDir, ent.name, 'run.mjs');
      if (fs.existsSync(locScript) && fs.existsSync(globScript) && norm(fs.readFileSync(locScript, 'utf8')) !== norm(fs.readFileSync(globScript, 'utf8'))) {
        divergences.push({ capability: 'tool', id: ent.name, local_path: path.relative(targetRoot, locScript).replace(/\\/g, '/'), global_path: globScript, reason: 'Tool entry script diverges between local and global trees.' });
      }
      const locMan = path.join(locToolsDir, ent.name, 'manifest.json');
      const globMan = path.join(globToolsDir, ent.name, 'manifest.json');
      if (fs.existsSync(locMan) && fs.existsSync(globMan)) {
        try {
          const l = JSON.parse(fs.readFileSync(locMan, 'utf8').replace(/^\uFEFF/, ''));
          const g = JSON.parse(fs.readFileSync(globMan, 'utf8').replace(/^\uFEFF/, ''));
          const pick = (o) => ({ id: o.id, runtime: o.runtime, l0_summary: o.l0_summary, hook_trigger: o.hook_trigger });
          if (JSON.stringify(pick(l)) !== JSON.stringify(pick(g))) {
            divergences.push({ capability: 'tool-manifest', id: ent.name, local_path: path.relative(targetRoot, locMan).replace(/\\/g, '/'), global_path: globMan, reason: 'Tool manifest metadata diverges between local and global trees.' });
          }
        } catch (err) {
          divergences.push({ capability: 'tool-manifest', id: ent.name, local_path: path.relative(targetRoot, locMan).replace(/\\/g, '/'), global_path: globMan, reason: `Failed to parse tool manifest JSON: ${err.message}` });
        }
      }
    }
  }
  return divergences;
}

function runWorkspaceAudit(targetRoot, includeGlobal, selfTestMode) {
  const audit = runAudit(targetRoot, { includeGlobal });
  const surfaceViolations = audit.surfaceViolations || auditHarnessSurfaces(targetRoot, { includeGlobal });
  const ruleBudgets = audit.files
    .filter((f) => f.kind === 'rule')
    .map((f) => {
      const isDup = surfaceViolations.some((v) => v.displayPath === f.displayPath && (v.code === 'DUPLICATE_EVO_START_BLOCK_IN_FILE' || v.code === 'DUPLICATE_GLOBAL_EVO_START_BLOCK'));
      return { file: f.displayPath, bytes: f.bytes, estimated_tokens: f.tokens, budget_limit: f.budgetLimit, status: f.overBudget ? 'OVER_BUDGET' : isDup ? 'DUPLICATE_EVO_START' : 'HEALTHY' };
    });
  const budgetViolations = ruleBudgets.filter((e) => e.status !== 'HEALTHY');
  const gateViolations = audit.gateViolations.map((gv) => ({ id: gv.ruleId, file: gv.displayPath, violations: gv.violations }));

  const storage = new EvoStorage(targetRoot);
  const memories = fs.existsSync(storage.memoriesDir) ? storage.listMemories().sort((a, b) => a.id.localeCompare(b.id)) : [];
  const memoryAudit = [];
  const brokenSymbols = [];
  const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
  const normEq = (a, b) => (isCaseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);
  for (const m of memories) {
    if (m.memory_type === 'personal') {
      memoryAudit.push({
        id: m.id,
        file: `.evo/memories/${m.id}.md`,
        memory_type: 'personal',
        badge: '[PERSONAL]',
        symbols_count: 0,
        verified_count: 0,
        overall_status: 'VERIFIED',
        symbols: [],
      });
      continue;
    }
    const ver = verifyMemoryFreshness(targetRoot, m, { includeCallers: false });
    const symbols = ver.checks.map((c) => {
      let exists = c.status !== 'MISSING';
      let file = c.current?.file_path || c.recorded?.file_path || '(unlocated)';
      if (exists && c.status !== 'OTHER_BRANCH') {
        const parsed = parseSymbolTarget(c.symbol);
        const cleanHint = parsed.fileHint && !parsed.isWholeFile ? parsed.fileHint.replace(/^[/\\]+/, '').replace(/\\/g, '/') : '';
        const fullHint = cleanHint ? path.resolve(targetRoot, cleanHint) : '';
        if (fullHint && fs.existsSync(fullHint) && fs.statSync(fullHint).isFile()) {
          const normCur = String(c.current?.file_path || '').replace(/\\/g, '/');
          const inHintOrBarrel = normEq(normCur, cleanHint) || resolveBarrelReexportTargets(targetRoot, fullHint, 2).some((t) => normEq(path.relative(targetRoot, t).replace(/\\/g, '/'), normCur));
          if (!inHintOrBarrel) { exists = false; file = cleanHint; }
        }
      }
      const entry = { symbol: c.symbol, exists, file };
      if (c.status === 'OTHER_BRANCH') entry.branch_scoped = true;
      if (!exists) brokenSymbols.push({ memoryId: m.id, symbol: c.symbol, file });
      return entry;
    });
    memoryAudit.push({ id: m.id, file: `.evo/memories/${m.id}.md`, symbols_count: symbols.length, verified_count: symbols.filter((s) => s.exists).length, overall_status: ver.overall_status, symbols });
  }

  const splitBrainDivergences = collectSplitBrainDivergences(targetRoot);
  const SKILL_FM_CODES = new Set(['SKILL_FRONTMATTER_SILENT_DROP', 'SKILL_MISSING_DESCRIPTION', 'CODEX_SKILL_NAME_MISMATCH', 'EVO_SKILL_NAME_MISMATCH', 'EVO_SKILL_LEGACY_FRONTMATTER']);
  const skillFrontmatterViolations = surfaceViolations
    .filter((v) => SKILL_FM_CODES.has(v.code))
    .map((v) => ({ skill: path.basename(path.dirname(v.displayPath)), file: v.displayPath, issues: [v.message] }));
  const errorSurfaceViolations = surfaceViolations.filter((v) => v.severity === 'error' && !SKILL_FM_CODES.has(v.code));

  const totalViolations =
    budgetViolations.length +
    gateViolations.length +
    brokenSymbols.length +
    splitBrainDivergences.length +
    skillFrontmatterViolations.length +
    errorSurfaceViolations.length;
  const ok = totalViolations === 0;
  return {
    workspace: path.basename(targetRoot),
    status: ok ? 'HEALTHY' : 'UNHEALTHY',
    ok,
    ...(selfTestMode ? {
      self_test: ok ? 'agy-config-auditor passed' : 'agy-config-auditor failed',
      self_test_assertions: true,
      audits: {
        token_budgets: { checked: ruleBudgets.length, violations: budgetViolations.length },
        gate1_5_rules: { checked: audit.files.filter((f) => f.displayPath.startsWith('.evo/rules/')).length, violations: gateViolations.length },
        memory_symbols: { checked: memoryAudit.reduce((acc, m) => acc + m.symbols_count, 0), broken: brokenSymbols.length },
        split_brain: { checked: true, divergences: splitBrainDivergences.length },
        skills: { violations: skillFrontmatterViolations.length },
      },
    } : {}),
    violations: [
      ...budgetViolations.map((v) => ({ category: 'token_budget', target: v.file, status: v.status })),
      ...gateViolations.map((v) => ({ category: 'gate1_5', target: v.id || v.file, issues: v.violations })),
      ...brokenSymbols.map((v) => ({ category: 'memory_symbol', target: `${v.memoryId}:${v.symbol}`, file: v.file })),
      ...splitBrainDivergences.map((v) => ({ category: 'split_brain', target: `${v.capability}:${v.id}`, reason: v.reason })),
      ...skillFrontmatterViolations.map((v) => ({ category: 'skill_frontmatter', target: v.skill, issues: v.issues })),
      ...errorSurfaceViolations.map((v) => ({ category: 'surface_error', harness: v.harness, target: v.displayPath, code: v.code, message: v.message })),
    ],
    summary: {
      budget_violations: budgetViolations.length,
      gate1_5_violations: gateViolations.length,
      broken_memory_symbols: brokenSymbols.length,
      split_brain_conflicts: splitBrainDivergences.length,
      skill_frontmatter_violations: skillFrontmatterViolations.length,
      surface_error_violations: surfaceViolations.filter((v) => v.severity === 'error').length,
    },
    rule_budgets: ruleBudgets,
    token_budget_audit: ruleBudgets,
    gate_violations: gateViolations,
    gate1_5_audit: gateViolations,
    memory_audit: memoryAudit,
    memory_symbols_audit: memoryAudit,
    split_brain_audit: splitBrainDivergences,
    skill_frontmatter_audit: skillFrontmatterViolations,
    surface_violations: surfaceViolations,
  };
}

let report;
if (isSelfTest) {
  const prevGlobalDir = process.env.EVO_GLOBAL_DIR;
  const fixtureBase = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-auditor-selftest-'));
  const fixtureWs = path.join(fixtureBase, 'workspace');
  const fixtureGlobal = path.join(fixtureBase, 'global');
  try {
    fs.mkdirSync(path.join(fixtureWs, 'src'), { recursive: true });
    fs.mkdirSync(fixtureGlobal, { recursive: true });
    process.env.EVO_GLOBAL_DIR = fixtureGlobal;

    fs.writeFileSync(
      path.join(fixtureWs, 'src', 'sample.ts'),
      'export function selfTestSample(value: string): string {\n  return value.trim();\n}\n',
      'utf8'
    );

    const now = '2026-01-01T00:00:00.000Z';
    const fixtureStorage = new EvoStorage(fixtureWs);
    fixtureStorage.ensureInitialized();
    fixtureStorage.saveRule({
      id: 'selftest-clean-rule',
      title: 'Self-Test Clean Rule',
      l0_summary: 'Validate input boundaries cleanly across module entrypoints.',
      scope_glob: 'src/**/*.ts',
      core: false,
      priority: 50,
      content: 'Always validate input boundaries before transforming module payloads.',
      tokens: 18,
      origin: 'evolved',
      transfer_scenarios: [
        'Input boundary checks in CLI entrypoints',
        'Payload normalization in service dispatchers',
      ],
      created_at: now,
      updated_at: now,
    });
    fixtureStorage.saveMemory({
      id: 'selftest-verified-mem',
      title: 'Self-Test Verified Memory',
      l0_summary: 'Verified symbol anchor in src/sample.ts for auditor self-test.',
      symptom: 'Trimming input prevents trailing whitespace mismatch.',
      root_cause: 'Untrimmed raw strings propagate downstream.',
      solution: 'Apply trim normalization in selfTestSample.',
      target_symbols: ['src/sample.ts#selfTestSample'],
      tags: ['selftest'],
      ast_fingerprints: {},
      created_commit: 'HEAD',
      origin: 'session',
      created_at: now,
      updated_at: now,
    });

    report = runWorkspaceAudit(fixtureWs, false, true);
  } finally {
    if (prevGlobalDir === undefined) {
      delete process.env.EVO_GLOBAL_DIR;
    } else {
      process.env.EVO_GLOBAL_DIR = prevGlobalDir;
    }
    try {
      fs.rmSync(fixtureBase, { recursive: true, force: true });
    } catch {}
  }
} else {
  report = runWorkspaceAudit(root, Boolean(evoArgs.include_global), false);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
