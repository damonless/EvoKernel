import { spawnSync } from 'node:child_process';

const workspace = process.env.EVO_WORKSPACE || process.cwd();
const isSelfTest = process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test');

const FIX_REGEX = /(?:fix|bug|revert|patch|resolve|regression|hotfix|issue|crash|fatal)/i;

export function isExcludedHotspotPath(filePath) {
  const normFile = String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .trim();
  if (!normFile) return true;
  return (
    normFile.startsWith('.git/') ||
    normFile.startsWith('.evo/') ||
    normFile.startsWith('templates/seed-evo/') ||
    normFile.startsWith('.github/') ||
    normFile.startsWith('dist/') ||
    normFile.startsWith('node_modules/') ||
    normFile.startsWith('assets/') ||
    normFile.startsWith('benchmarks/') ||
    /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[a-z0-9]+$/i.test(normFile) ||
    /\.(?:md|txt|svg|png|gif|webp|tape)$/i.test(normFile) ||
    /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|server\.json|plugin\.json|marketplace\.json|gemini-extension\.json|hooks\.json|mcp_config\.json|\.mcp\.json)$/i.test(
      normFile
    )
  );
}

if (isSelfTest) {
  const mustExclude = [
    '.evo/rules/scoped/example.md',
    'templates/seed-evo/tools/git-hotspot-analyzer/run.mjs',
    'dist/cli/index.js',
    'README.md',
    'src/tests/evo-kernel.test.ts',
    'package-lock.json',
  ];
  const mustInclude = ['src/core/memory.ts', 'src/mcp/handlers.ts', 'src/cli/score.ts'];
  for (const p of mustExclude) {
    if (!isExcludedHotspotPath(p)) {
      console.error(`Self-test failed: expected excluded path '${p}' to be filtered out`);
      process.exit(1);
    }
  }
  for (const p of mustInclude) {
    if (isExcludedHotspotPath(p)) {
      console.error(`Self-test failed: expected source path '${p}' to be included`);
      process.exit(1);
    }
  }
  console.log(
    JSON.stringify({
      self_test: 'passed',
      tool: 'git-hotspot-analyzer',
      verified_exclusions: mustExclude.length,
    })
  );
  process.exit(0);
}

const logRes = spawnSync(
  'git',
  ['log', '-n', '100', '--name-only', '--pretty=format:__COMMIT__|%h|%s', '--', './'],
  {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 3000,
  }
);

const fileStats = new Map();
if (logRes.status === 0 && logRes.stdout) {
  let isFix = false;
  for (const rawLine of logRes.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('__COMMIT__|')) {
      const parts = line.split('|');
      const subject = parts.slice(2).join('|');
      isFix = FIX_REGEX.test(subject);
      continue;
    }
    const normFile = line.replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (isExcludedHotspotPath(normFile)) continue;
    const cur = fileStats.get(normFile) || { commits: 0, fixRevertCommits: 0 };
    cur.commits++;
    if (isFix) cur.fixRevertCommits++;
    fileStats.set(normFile, cur);
  }
}

const topFiles = Array.from(fileStats.entries())
  .map(([file, st]) => ({
    file,
    commits: st.commits,
    fix_revert_commits: st.fixRevertCommits,
    fragility_score: st.commits + st.fixRevertCommits * 2,
  }))
  .sort((a, b) => b.fragility_score - a.fragility_score || b.commits - a.commits)
  .slice(0, 10);

console.log(JSON.stringify({ recent_hotspots: topFiles }, null, 2));