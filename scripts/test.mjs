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
const testArgs = [
  '--test',
  path.join(rootDir, 'dist', 'tests', 'evo-kernel.test.js'),
  ...process.argv.slice(2),
];

const testRes = spawnSync(process.execPath, testArgs, {
  cwd: rootDir,
  stdio: 'inherit',
});

process.exit(testRes.status ?? 1);
