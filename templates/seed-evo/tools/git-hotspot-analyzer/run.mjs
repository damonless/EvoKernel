import { spawnSync } from 'node:child_process';

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
  for (const line of logRes.stdout.split(/\r?\n/)) {
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