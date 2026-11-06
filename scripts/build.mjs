import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

export const SEED_RULES = [
  'esm-typescript-imports.md',
  'gatekeeper-self-test-invariant.md',
];

export const SEED_SKILLS = [
  'bug-to-guardrail-sop',
  'evo-rule-architect',
];

export const SEED_TOOLS = [
  'agy-config-auditor',
  'deliverable-canonical-inspector',
  'git-hotspot-analyzer',
  'workspace-metrics-scanner',
];

function buildDir(currentSrc, currentDist) {
  fs.mkdirSync(currentDist, { recursive: true });
  for (const entry of fs.readdirSync(currentSrc, { withFileTypes: true })) {
    const srcPath = path.join(currentSrc, entry.name);
    if (entry.isDirectory()) {
      buildDir(srcPath, path.join(currentDist, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const tsCode = fs.readFileSync(srcPath, 'utf8');
      const jsCode = stripTypeScriptTypes(tsCode, { mode: 'strip' });
      const outName = entry.name.replace(/\.ts$/, '.js');
      const outPath = path.join(currentDist, outName);
      fs.writeFileSync(outPath, jsCode, 'utf8');
    }
  }
}

function syncCanonicalSeeds() {
  const evoDir = path.join(rootDir, '.evo');
  const seedEvoDir = path.join(rootDir, 'templates', 'seed-evo');
  const rootSkillsDir = path.join(rootDir, 'skills');

  // 1. Sync dist/core/deliverable.js -> .evo/tools/deliverable-canonical-inspector/run.mjs (SSOT)
  const compiledDeliverable = path.join(distDir, 'core', 'deliverable.js');
  const localDeliverableToolRun = path.join(
    evoDir,
    'tools',
    'deliverable-canonical-inspector',
    'run.mjs'
  );
  if (fs.existsSync(compiledDeliverable) && fs.existsSync(path.dirname(localDeliverableToolRun))) {
    fs.copyFileSync(compiledDeliverable, localDeliverableToolRun);
  }

  // Also sync ~/.evo/global/.evo/tools/deliverable-canonical-inspector/run.mjs if present
  try {
    const globalDeliverableDir = path.join(
      os.homedir(),
      '.evo',
      'global',
      '.evo',
      'tools',
      'deliverable-canonical-inspector'
    );
    if (fs.existsSync(compiledDeliverable) && fs.existsSync(globalDeliverableDir)) {
      fs.copyFileSync(compiledDeliverable, path.join(globalDeliverableDir, 'run.mjs'));
    }
  } catch {
    // ignore read-only / home permission issues in restricted CI
  }

  // 2. Sync SEED_RULES: .evo/rules/<file> -> templates/seed-evo/rules/<file>
  const localRulesDir = path.join(evoDir, 'rules');
  const seedRulesDir = path.join(seedEvoDir, 'rules');
  if (fs.existsSync(localRulesDir)) {
    fs.mkdirSync(seedRulesDir, { recursive: true });
    for (const ruleFile of SEED_RULES) {
      const srcRule = path.join(localRulesDir, ruleFile);
      const destRule = path.join(seedRulesDir, ruleFile);
      if (fs.existsSync(srcRule)) {
        fs.copyFileSync(srcRule, destRule);
      }
    }
    for (const entry of fs.readdirSync(seedRulesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md') && !SEED_RULES.includes(entry.name)) {
        fs.rmSync(path.join(seedRulesDir, entry.name), { force: true });
      }
    }
  }

  // 3. Sync SEED_SKILLS: .evo/skills/<id> -> templates/seed-evo/skills/<id> & skills/<id>
  const localSkillsDir = path.join(evoDir, 'skills');
  const seedSkillsDir = path.join(seedEvoDir, 'skills');
  if (fs.existsSync(localSkillsDir)) {
    fs.mkdirSync(seedSkillsDir, { recursive: true });
    fs.mkdirSync(rootSkillsDir, { recursive: true });
    for (const skillId of SEED_SKILLS) {
      const srcSkillFile = path.join(localSkillsDir, skillId, 'SKILL.md');
      if (fs.existsSync(srcSkillFile)) {
        const destSeedSkillDir = path.join(seedSkillsDir, skillId);
        const destRootSkillDir = path.join(rootSkillsDir, skillId);
        fs.mkdirSync(destSeedSkillDir, { recursive: true });
        fs.mkdirSync(destRootSkillDir, { recursive: true });
        fs.copyFileSync(srcSkillFile, path.join(destSeedSkillDir, 'SKILL.md'));
        fs.copyFileSync(srcSkillFile, path.join(destRootSkillDir, 'SKILL.md'));
      }
    }
    for (const entry of fs.readdirSync(seedSkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SEED_SKILLS.includes(entry.name)) {
        fs.rmSync(path.join(seedSkillsDir, entry.name), { recursive: true, force: true });
      }
    }
    for (const entry of fs.readdirSync(rootSkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SEED_SKILLS.includes(entry.name)) {
        fs.rmSync(path.join(rootSkillsDir, entry.name), { recursive: true, force: true });
      }
    }
  }

  // 4. Sync SEED_TOOLS: .evo/tools/<id> -> templates/seed-evo/tools/<id>
  const localToolsDir = path.join(evoDir, 'tools');
  const seedToolsDir = path.join(seedEvoDir, 'tools');
  if (fs.existsSync(localToolsDir)) {
    fs.mkdirSync(seedToolsDir, { recursive: true });
    for (const toolId of SEED_TOOLS) {
      const srcToolDir = path.join(localToolsDir, toolId);
      const destToolDir = path.join(seedToolsDir, toolId);
      if (fs.existsSync(srcToolDir)) {
        fs.mkdirSync(destToolDir, { recursive: true });
        for (const f of ['run.mjs', 'manifest.json']) {
          const srcFile = path.join(srcToolDir, f);
          if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, path.join(destToolDir, f));
          }
        }
      }
    }
    for (const entry of fs.readdirSync(seedToolsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SEED_TOOLS.includes(entry.name)) {
        fs.rmSync(path.join(seedToolsDir, entry.name), { recursive: true, force: true });
      }
    }
  }
}

fs.rmSync(distDir, { recursive: true, force: true });
buildDir(srcDir, distDir);
syncCanonicalSeeds();
console.log('Built dist/ from src/ using native node:module.stripTypeScriptTypes (0 external dependencies).');
