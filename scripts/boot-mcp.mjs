#!/usr/bin/env node
/**
 * Zero-Build MCP Bootstrapper for EvoKernel.
 * Automatically compiles `dist/` from `src/` via `scripts/build.mjs` if `dist/cli/index.js`
 * is missing (e.g., when cloned directly as a GitHub plugin without a manual build step),
 * keeping stdout 100% clean for stdio JSON-RPC communication.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const distEntry = path.join(rootDir, 'dist', 'cli', 'index.js');
const buildScript = path.join(rootDir, 'scripts', 'build.mjs');
const srcEntry = path.join(rootDir, 'src', 'cli', 'index.ts');

if (!fs.existsSync(distEntry) && fs.existsSync(buildScript) && fs.existsSync(srcEntry)) {
  spawnSync(process.execPath, [buildScript], { cwd: rootDir, stdio: 'ignore' });
}

if (!fs.existsSync(distEntry)) {
  console.error(
    '[EvoKernel MCP] Error: dist/cli/index.js not found. Please build the project first (node ./scripts/build.mjs).'
  );
  process.exit(1);
}

const extraArgs = process.argv.slice(2).filter((arg) => arg !== 'mcp');
process.argv = [process.argv[0], distEntry, 'mcp', ...extraArgs];
await import(url.pathToFileURL(distEntry).href);
