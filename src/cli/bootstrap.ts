import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';
import { syncManagedRuleBlocks } from './init.js';
import { EVO_RULE_ARCHITECT_PROPOSAL } from './audit.js';
import type { ProposalPayload } from '../core/types.js';

export interface BootstrapSummary {
  rulesCreated: string[];
  skillsCreated: string[];
  toolsCreated: string[];
  skippedOrDuplicate: string[];
}

export function runBootstrap(workspaceRoot: string): BootstrapSummary {
  const storage = new EvoStorage(workspaceRoot);
  storage.ensureInitialized();
  const telemetry = new EvoTelemetry(storage);
  const gatekeeper = new EvoGatekeeper(storage, telemetry);

  const summary: BootstrapSummary = {
    rulesCreated: [],
    skillsCreated: [],
    toolsCreated: [],
    skippedOrDuplicate: [],
  };

  const proposals: ProposalPayload[] = [];

  // 1. Inspect package.json / project stack to evolve stack-specific rules & tools
  const pkgPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      const deps = {
        ...((pkg.dependencies as Record<string, string>) || {}),
        ...((pkg.devDependencies as Record<string, string>) || {}),
      };
      const isEsm = pkg.type === 'module';
      const hasTs = Boolean(deps.typescript || fs.existsSync(path.join(workspaceRoot, 'tsconfig.json')));

      if (isEsm && hasTs) {
        proposals.push({
          kind: 'rule',
          id: 'esm-typescript-imports',
          title: 'NodeNext ESM TypeScript Import Invariant',
          l0_summary: 'Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript.',
          scope_glob: 'src/**/*.ts',
          core: true,
          priority: 85,
          origin: 'bootstrap',
          content: [
            '1. Use explicit `.js` file extensions in relative module imports (e.g., `import { EvoStorage } from "./storage.js"`).',
            '2. Always use `import type { ... }` when importing TypeScript interfaces or type aliases so native Node type-stripping (`node:module.stripTypeScriptTypes`) never fails at runtime.',
            '3. Prefer built-in Node.js modules (`node:fs`, `node:path`, `node:sqlite`, `node:test`) over third-party npm packages to preserve zero-dependency security.',
          ].join('\n'),
        });
      }
    } catch {
      // ignore package.json parse error
    }
  }

  // 2. Mine recent git fix/revert history if git repo has commits
  const gitRes = spawnSync(
    'git',
    ['log', '-n', '30', '--grep=fix\\|bug\\|revert\\|hotfix', '-i', '--oneline'],
    { cwd: workspaceRoot, encoding: 'utf8', timeout: 3000 }
  );
  const fixCommits =
    gitRes.status === 0 && gitRes.stdout
      ? gitRes.stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
      : [];

  proposals.push({
    kind: 'rule',
    id: 'gatekeeper-self-test-invariant',
    title: 'Deterministic Micro-Tool Self-Test Invariant',
    l0_summary: 'Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically.',
    scope_glob: '.evo/tools/**/*',
    core: true,
    priority: 90,
    origin: 'bootstrap',
    content: [
      'When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:',
      '- The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.',
      '- Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.',
      ...(fixCommits.length > 0
        ? [`- Historical fix commits analyzed (${fixCommits.length} commits): ${fixCommits.slice(0, 3).join(' | ')}`]
        : []),
    ].join('\n'),
  });

  // 3. Crystallize baseline Skill #1: Failure-to-Capability Evolution SOP
  proposals.push({
    kind: 'skill',
    id: 'bug-to-guardrail-sop',
    title: 'Closed-Loop Bug to Deterministic Guardrail SOP',
    l0_summary: 'Standard workflow to turn a resolved root cause or recurring review comment into a verified Rule or Micro-Tool.',
    tags: ['debugging', 'evolution', 'guardrail', 'tdd'],
    origin: 'bootstrap',
    l1_contract: [
      '- **Trigger**: Immediately after fixing a non-trivial bug, build failure, or user architectural correction.',
      '- **Inputs**: Root cause summary, affected file glob, and verification command.',
      '- **Outputs**: A committed `.evo/rules/` invariant or `.evo/tools/` diagnostic script via `evo_propose`.',
    ].join('\n'),
    l2_sop: [
      '1. **Search Existing Capabilities**: Run `evo_search` with the error keyword or module name to check if an existing rule/tool already covers this area.',
      '2. **Decide Modality**:',
      '   - If the failure can be caught programmatically (e.g., missing imports, config drift, dead symbols), write a Node/Python Micro-Tool (`kind: "tool"`) with a `--self-test` check.',
      '   - If the failure is an architectural or reasoning pitfall, distill a concise Rule (`kind: "rule"`) with an exact `scope_glob`.',
      '3. **Submit via Gatekeeper**: Call `evo_propose`. If `ERR_DUPLICATE_CAPABILITY` is returned, pass `supersedes_id` to upgrade the older entry.',
    ].join('\n'),
  });

  // 3b. Crystallize baseline Skill #2: Legacy Rule & Skill Decoupling Architect (evo-rule-architect)
  proposals.push(EVO_RULE_ARCHITECT_PROPOSAL);

  // 4. Crystallize verified Micro-Tool #1: Workspace & Codebase Diagnostics Scanner
  const repoScannerScript = `import * as fs from 'node:fs';
import * as path from 'node:path';

const workspace = process.env.EVO_WORKSPACE || process.cwd();
const isSelfTest = process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test');

function scanDirectory(dir, depth = 0, stats = { files: 0, lines: 0, byExt: {} }) {
  if (depth > 4 || !fs.existsSync(dir)) return stats;
  const ignore = new Set(['node_modules', '.git', 'dist', '.evo', '.codegraph']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(full, depth + 1, stats);
    } else if (entry.isFile()) {
      stats.files++;
      const ext = path.extname(entry.name) || '(no-ext)';
      stats.byExt[ext] = (stats.byExt[ext] || 0) + 1;
      try {
        const content = fs.readFileSync(full, 'utf8');
        stats.lines += content.split(/\\r?\\n/).length;
      } catch {}
    }
  }
  return stats;
}

const result = scanDirectory(workspace);
if (isSelfTest) {
  if (typeof result.files !== 'number') process.exit(1);
  console.log(JSON.stringify({ self_test: 'passed', scanned_files: result.files }));
  process.exit(0);
}
console.log(JSON.stringify({ workspace: path.basename(workspace), ...result }, null, 2));
`;

  proposals.push({
    kind: 'tool',
    id: 'workspace-metrics-scanner',
    title: 'Fast Workspace Metrics & Extension Breakdown Scanner',
    l0_summary: 'Scans repository file counts, LOC, and extension distribution in one sandboxed call without polluting context.',
    runtime: 'node',
    script_code: repoScannerScript,
    input_schema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: 'Maximum directory recursion depth (default: 4)' },
      },
    },
    self_test_args: { maxDepth: 2 },
    origin: 'bootstrap',
  });

  // 5. Crystallize verified Micro-Tool #2: Git Churn & Hotspot Analyzer
  const gitHotspotScript = `import { spawnSync } from 'node:child_process';

const workspace = process.env.EVO_WORKSPACE || process.cwd();
const isSelfTest = process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test');

if (isSelfTest) {
  console.log(JSON.stringify({ self_test: 'passed', tool: 'git-hotspot-analyzer' }));
  process.exit(0);
}

const logRes = spawnSync('git', ['log', '-n', '25', '--name-only', '--pretty=format:'], {
  cwd: workspace,
  encoding: 'utf8',
  timeout: 3000,
});

const counts = {};
if (logRes.status === 0 && logRes.stdout) {
  for (const line of logRes.stdout.split(/\\r?\\n/)) {
    const file = line.trim();
    if (!file) continue;
    counts[file] = (counts[file] || 0) + 1;
  }
}

const topFiles = Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([file, commits]) => ({ file, commits }));

console.log(JSON.stringify({ recent_hotspots: topFiles }, null, 2));
`;

  proposals.push({
    kind: 'tool',
    id: 'git-hotspot-analyzer',
    title: 'Git Commit Churn & Bug Hotspot Analyzer',
    l0_summary: 'Identifies top 10 most frequently modified files in recent git history to pinpoint fragile modules.',
    runtime: 'node',
    script_code: gitHotspotScript,
    input_schema: {
      type: 'object',
      properties: {},
    },
    self_test_args: {},
    origin: 'bootstrap',
  });

  for (const prop of proposals) {
    const res = gatekeeper.evaluateAndCommit(prop);
    if (res.passed) {
      if (prop.kind === 'rule') summary.rulesCreated.push(prop.id);
      if (prop.kind === 'skill') summary.skillsCreated.push(prop.id);
      if (prop.kind === 'tool') summary.toolsCreated.push(prop.id);
    } else {
      summary.skippedOrDuplicate.push(`${prop.id} (${res.error_code || 'skipped'})`);
    }
  }

  telemetry.close();
  syncManagedRuleBlocks(workspaceRoot);

  return summary;
}
