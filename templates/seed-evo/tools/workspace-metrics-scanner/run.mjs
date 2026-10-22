import * as fs from 'node:fs';
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
        stats.lines += content.split(/\r?\n/).length;
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