#!/usr/bin/env node
/**
 * Zero-Config Team MCP/Hook Bootstrapper for EvoKernel.
 * Runs installed evo-kernel CLI via local node_modules or dist fallbacks,
 * keeping stdio clean and eliminating Windows spawn ENOENT / npx latency.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
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

const evoDir = path.resolve(import.meta.dirname);
const wsRoot = path.resolve(evoDir, '..');
const homeDir = os.homedir ? os.homedir() : (process.env.HOME || process.env.USERPROFILE || '');
const candidates = [
  path.join(wsRoot, 'dist', 'cli', 'index.js'),
  path.join(wsRoot, 'node_modules', 'evo-kernel', 'dist', 'cli', 'index.js'),
  path.join(evoDir, 'dist', 'cli', 'index.js'),
];

// Walk up ancestor node_modules/evo-kernel/dist/cli/index.js
let curr = wsRoot;
while (true) {
  const ancestorCandidate = path.join(curr, 'node_modules', 'evo-kernel', 'dist', 'cli', 'index.js');
  if (!candidates.includes(ancestorCandidate)) {
    candidates.push(ancestorCandidate);
  }
  const parent = path.dirname(curr);
  if (!parent || parent === curr) break;
  curr = parent;
}

// Global npm modules & host plugin paths
if (process.env.APPDATA) {
  candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'evo-kernel', 'dist', 'cli', 'index.js'));
}
candidates.push(path.resolve(process.execPath, '../../lib/node_modules/evo-kernel/dist/cli/index.js'));
candidates.push(path.resolve(process.execPath, '../node_modules/evo-kernel/dist/cli/index.js'));
if (homeDir) {
  candidates.push(path.join(homeDir, '.gemini', 'config', 'plugins', 'evo-kernel', 'dist', 'cli', 'index.js'));
  candidates.push(path.join(homeDir, '.gemini', 'extensions', 'evo-kernel', 'dist', 'cli', 'index.js'));
}

let entry = candidates.find((c) => fs.existsSync(c));
if (!entry) {
  const buildScript = path.join(wsRoot, 'scripts', 'build.mjs');
  if (fs.existsSync(buildScript)) {
    spawnSync(process.execPath, [buildScript], { cwd: wsRoot, stdio: 'ignore' });
    if (fs.existsSync(candidates[0])) entry = candidates[0];
  }
}
if (!entry) {
  console.error('[EvoKernel] Error: evo-kernel not found in workspace node_modules or dist.');
  console.error('Please run: npm install --save-dev evo-kernel (or npm install -g evo-kernel)');
  process.exit(1);
}
const rawArgs = process.argv.slice(2);
const firstArg = (rawArgs[0] || '').toLowerCase();
const forwardedArgs =
  firstArg && firstArg !== 'mcp' && !firstArg.startsWith('-')
    ? rawArgs
    : ['mcp', ...rawArgs.filter((arg) => arg !== 'mcp')];
process.argv = [process.argv[0], entry, ...forwardedArgs];
await import(url.pathToFileURL(entry).href);
