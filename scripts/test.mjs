import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 1. Build
const buildRes = spawnSync(process.execPath, [path.join(__dirname, 'build.mjs')], {
  cwd: rootDir,
  stdio: 'inherit',
});
if (buildRes.status !== 0) {
  process.exit(buildRes.status ?? 1);
}

// 2. Run tests (forwarding any CLI arguments)
const testFiles = [
  path.join(rootDir, 'dist', 'tests', 'evo-kernel.test.js'),
  path.join(rootDir, 'dist', 'tests', 'multi-harness.test.js'),
  path.join(rootDir, 'dist', 'tests', 'hook.test.js'),
  path.join(rootDir, 'dist', 'tests', 'bootstrap.test.js'),
  path.join(rootDir, 'dist', 'tests', 'mcp-proxy.test.js'),
  path.join(rootDir, 'dist', 'tests', 'lifecycle-guard-hooks.test.js'),
  path.join(rootDir, 'dist', 'tests', 'deliverable-inspector.test.js'),
  path.join(rootDir, 'dist', 'tests', 'causal-telemetry-and-catalog.test.js'),
  path.join(rootDir, 'dist', 'tests', 'optimize.test.js'),
  path.join(rootDir, 'dist', 'tests', 'surface-audit-and-hardening.test.js'),
  path.join(rootDir, 'dist', 'tests', 'score-and-ui.test.js'),
].filter((f) => fs.existsSync(f));

const testArgs = [
  '--test',
  ...testFiles,
  ...process.argv.slice(2),
];

const testRes = spawnSync(process.execPath, testArgs, {
  cwd: rootDir,
  stdio: 'inherit',
});

process.exit(testRes.status ?? 1);
