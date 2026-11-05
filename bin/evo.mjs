#!/usr/bin/env node
/**
 * CLI Entry Wrapper for EvoKernel with Node.js version pre-check.
 * Ensures friendly error messaging before attempting to load native node:sqlite.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { spawnSync } from 'node:child_process';

const rawVersion = String(process.env.EVO_SIMULATE_NODE_VERSION || process.versions.node || '0.0.0').replace(/^v/i, '');
const [nodeMaj = 0, nodeMin = 0] = rawVersion.split('.').map((n) => Number.parseInt(n, 10));
if (nodeMaj < 22 || (nodeMaj === 22 && nodeMin < 5)) {
  console.error(
    `[EvoKernel] Node.js >= 22.5.0 is required (detected v${rawVersion}).\n` +
      `  EvoKernel uses zero-dependency native node:sqlite and node:module.stripTypeScriptTypes.\n` +
      `  Instant 1-liner (no global Node change): npx -y -p node@22 evo-kernel <command>\n` +
      `  Quick fix: run "nvm install 22 && nvm use 22", "fnm use 22", or "volta install node@22".`
  );
  process.exit(1);
}

const rootDir = path.resolve(import.meta.dirname, '..');
const distEntry = path.join(rootDir, 'dist', 'cli', 'index.js');
const buildScript = path.join(rootDir, 'scripts', 'build.mjs');
const srcEntry = path.join(rootDir, 'src', 'cli', 'index.ts');

if (!fs.existsSync(distEntry) && fs.existsSync(buildScript) && fs.existsSync(srcEntry)) {
  spawnSync(process.execPath, [buildScript], { cwd: rootDir, stdio: 'inherit' });
}

if (!fs.existsSync(distEntry)) {
  console.error(
    '[EvoKernel] Error: dist/cli/index.js not found. Please build the project first (node ./scripts/build.mjs).'
  );
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
process.argv = [process.argv[0], distEntry, ...rawArgs];
await import(url.pathToFileURL(distEntry).href);
