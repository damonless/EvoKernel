#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

if (process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test')) {
  const sampleManifest = JSON.stringify({ name: 'evo-kernel', version: '0.1.0' });
  const parsed = JSON.parse(sampleManifest);
  if (parsed.name !== 'evo-kernel' || parsed.version !== '0.1.0') {
    process.exit(1);
  }
  console.log(JSON.stringify({ self_test: 'passed', tool: 'evo-release-preflight' }));
  process.exit(0);
}

const root = path.resolve(process.env.EVO_WORKSPACE || process.cwd());
const issues = [];
const checks = {};

function readJsonSafe(relPath) {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) {
    issues.push(`Missing manifest: ${relPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    issues.push(`Invalid JSON in ${relPath}: ${err.message}`);
    return null;
  }
}

function normalizeDoc(content) {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/^updated_at:\s*".*"$/m, 'updated_at: "<normalized>"')
    .trim();
}

// 1. Manifest & Zero-Build Bootstrap Parity
const pkg = readJsonSafe('package.json');
const pluginJson = readJsonSafe('plugin.json');
const claudePlugin = readJsonSafe('.claude-plugin/plugin.json');
const claudeMarketplace = readJsonSafe('.claude-plugin/marketplace.json');
const geminiExt = readJsonSafe('gemini-extension.json');
const mcpConfig = readJsonSafe('mcp_config.json');
const dotMcp = readJsonSafe('.mcp.json');
const cursorMcp = readJsonSafe('.cursor/mcp.json');
readJsonSafe('hooks.json');

const expectedVersion = pkg?.version || '0.1.0';
for (const [name, obj] of [
  ['plugin.json', pluginJson],
  ['.claude-plugin/plugin.json', claudePlugin],
  ['.claude-plugin/marketplace.json', claudeMarketplace],
  ['gemini-extension.json', geminiExt],
]) {
  if (obj && obj.version !== expectedVersion) {
    issues.push(`Version mismatch in ${name}: expected ${expectedVersion}, got ${obj.version}`);
  }
}

if (pkg?.dependencies && Object.keys(pkg.dependencies).length > 0) {
  issues.push(
    `Zero-dependency invariant violated: package.json has runtime dependencies: ${Object.keys(pkg.dependencies).join(', ')}`
  );
}

for (const [name, obj] of [
  ['.claude-plugin/plugin.json', claudePlugin],
  ['gemini-extension.json', geminiExt],
  ['.mcp.json', dotMcp],
  ['.cursor/mcp.json', cursorMcp],
]) {
  const args = obj?.mcpServers?.['evo-kernel']?.args;
  if (!Array.isArray(args) || !args.some((a) => String(a).includes('boot-mcp.mjs'))) {
    issues.push(`${name} does not route evo-kernel through zero-build scripts/boot-mcp.mjs`);
  }
}
if (mcpConfig) {
  const args = mcpConfig?.mcpServers?.['evo-kernel']?.args;
  if (
    !Array.isArray(args) ||
    !args.some((a) => String(a).includes('build.mjs') || String(a).includes('boot-mcp.mjs'))
  ) {
    issues.push('mcp_config.json lacks zero-build auto-compilation fallback');
  }
}
checks.manifest_parity = issues.length === 0 ? 'OK' : 'ISSUES_FOUND';

// 2. Seed & Host Asset Synchronization (Tools, Skills, Core Seed Rules & Installed Plugin)
const seedDrift = [];
const seedToolsDir = path.join(root, 'templates', 'seed-evo', 'tools');
const localToolsDir = path.join(root, '.evo', 'tools');
if (fs.existsSync(seedToolsDir) && fs.existsSync(localToolsDir)) {
  const toolNames = new Set([
    ...fs.readdirSync(seedToolsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
    ...fs.readdirSync(localToolsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
  ]);
  for (const name of toolNames) {
    const seedRun = path.join(seedToolsDir, name, 'run.mjs');
    const localRun = path.join(localToolsDir, name, 'run.mjs');
    if (!fs.existsSync(seedRun)) {
      seedDrift.push(`Missing seed tool script: templates/seed-evo/tools/${name}/run.mjs`);
    } else if (!fs.existsSync(localRun)) {
      seedDrift.push(`Missing local tool script: .evo/tools/${name}/run.mjs`);
    } else if (normalizeDoc(fs.readFileSync(seedRun, 'utf8')) !== normalizeDoc(fs.readFileSync(localRun, 'utf8'))) {
      seedDrift.push(`Tool drift between .evo/tools/${name}/run.mjs and templates/seed-evo/tools/${name}/run.mjs`);
    }
  }
}

const seedSkillsDir = path.join(root, 'templates', 'seed-evo', 'skills');
const localSkillsDir = path.join(root, '.evo', 'skills');
const pluginSkillsDir = path.join(root, 'skills');
if (fs.existsSync(seedSkillsDir) && fs.existsSync(localSkillsDir)) {
  const skillNames = new Set([
    ...fs.readdirSync(seedSkillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
    ...fs.readdirSync(localSkillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
  ]);
  for (const name of skillNames) {
    const sPath = path.join(seedSkillsDir, name, 'SKILL.md');
    const lPath = path.join(localSkillsDir, name, 'SKILL.md');
    const pPath = path.join(pluginSkillsDir, name, 'SKILL.md');
    if (!fs.existsSync(sPath) || !fs.existsSync(lPath) || !fs.existsSync(pPath)) {
      seedDrift.push(`Skill '${name}' missing across .evo/skills, templates/seed-evo/skills, or skills/`);
    } else {
      const sDoc = normalizeDoc(fs.readFileSync(sPath, 'utf8'));
      const lDoc = normalizeDoc(fs.readFileSync(lPath, 'utf8'));
      const pDoc = normalizeDoc(fs.readFileSync(pPath, 'utf8'));
      if (sDoc !== lDoc || lDoc !== pDoc) {
        seedDrift.push(`Skill drift detected for '${name}' across .evo/skills, templates/seed-evo/skills, and skills/`);
      }
    }
  }
}

const seedRulesDir = path.join(root, 'templates', 'seed-evo', 'rules');
const localRulesDir = path.join(root, '.evo', 'rules');
if (fs.existsSync(seedRulesDir) && fs.existsSync(localRulesDir)) {
  for (const entry of fs.readdirSync(seedRulesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const sPath = path.join(seedRulesDir, entry.name);
    const lPath = path.join(localRulesDir, entry.name);
    if (!fs.existsSync(lPath)) {
      seedDrift.push(`Missing local seed rule: .evo/rules/${entry.name}`);
    } else if (normalizeDoc(fs.readFileSync(sPath, 'utf8')) !== normalizeDoc(fs.readFileSync(lPath, 'utf8'))) {
      seedDrift.push(`Rule drift between .evo/rules/${entry.name} and templates/seed-evo/rules/${entry.name}`);
    }
  }
}

const installedPluginDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'evo-kernel');
if (fs.existsSync(installedPluginDir)) {
  const installedDistIndex = path.join(installedPluginDir, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(installedDistIndex)) {
    seedDrift.push('Installed Antigravity plugin (~/.gemini/config/plugins/evo-kernel) is missing dist/cli/index.js');
  }
}

for (const d of seedDrift) issues.push(d);
checks.seed_sync = seedDrift.length === 0 ? 'OK' : 'DRIFT_DETECTED';

// 3. Per-File Build & CodeGraph Freshness
function collectTsFiles(dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const tsFiles = collectTsFiles(srcDir);
let newestSrcTs = 0;
let staleBuildFiles = 0;
for (const tsFile of tsFiles) {
  const tsMtime = fs.statSync(tsFile).mtimeMs;
  newestSrcTs = Math.max(newestSrcTs, tsMtime);
  const rel = path.relative(srcDir, tsFile).replace(/\.ts$/, '.js');
  const jsFile = path.join(distDir, rel);
  if (!fs.existsSync(jsFile)) {
    staleBuildFiles++;
  } else {
    const jsMtime = fs.statSync(jsFile).mtimeMs;
    if (tsMtime > jsMtime + 2000) {
      staleBuildFiles++;
    }
  }
}
if (staleBuildFiles > 0) {
  issues.push(`${staleBuildFiles} compiled file(s) in dist/ are missing or older than src/**/*.ts — run node ./scripts/build.mjs`);
}
checks.build_freshness = staleBuildFiles === 0 ? 'FRESH' : 'STALE';

const cgDb = path.join(root, '.codegraph', 'codegraph.db');
const cgWal = path.join(root, '.codegraph', 'codegraph.db-wal');
const cgMtime = Math.max(
  fs.existsSync(cgDb) ? fs.statSync(cgDb).mtimeMs : 0,
  fs.existsSync(cgWal) ? fs.statSync(cgWal).mtimeMs : 0
);
const postCommitHook = path.join(root, '.git', 'hooks', 'post-commit');
const hasCgGitHook =
  fs.existsSync(postCommitHook) &&
  fs.readFileSync(postCommitHook, 'utf8').includes('codegraph sync');
const cgFresh = cgMtime === 0 || cgMtime >= newestSrcTs - 5000;
if (cgMtime > 0 && !cgFresh) {
  issues.push('.codegraph/codegraph.db is older than src/**/*.ts — run codegraph sync');
}
if (cgMtime > 0 && !hasCgGitHook) {
  issues.push('.git/hooks/post-commit is missing codegraph sync hook');
}
checks.codegraph_status = {
  indexed: cgMtime > 0,
  fresh: cgFresh,
  git_sync_hook_installed: hasCgGitHook,
};

const result = {
  workspace: path.basename(root),
  ok: issues.length === 0,
  status: issues.length === 0 ? 'READY' : 'PREFLIGHT_FAILED',
  checks,
  issues,
};
console.log(JSON.stringify(result, null, 2));
process.exit(issues.length === 0 ? 0 : 1);