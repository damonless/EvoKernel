import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const workspace = process.env.EVO_WORKSPACE || process.cwd();
const isSelfTest = process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test');

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svgz',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.node',
  '.sqlite', '.db', '.db-wal', '.db-shm', '.mp4', '.mp3', '.wav',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);
const MAX_LINE_SCAN_BYTES = 2 * 1024 * 1024;

function isProbablyBinaryOrOversized(filePath, ext, sizeBytes) {
  if (BINARY_EXTS.has(ext.toLowerCase()) || sizeBytes > MAX_LINE_SCAN_BYTES) {
    return true;
  }
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const sampleLen = Math.min(512, Math.max(0, sizeBytes));
      if (sampleLen === 0) return false;
      const buf = Buffer.allocUnsafe(sampleLen);
      const bytesRead = fs.readSync(fd, buf, 0, sampleLen, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) return true;
      }
      return false;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return true;
  }
}

function scanDirectory(dir, depth = 0, stats = { files: 0, lines: 0, skippedContent: 0, byExt: {} }) {
  if (depth > 4 || !fs.existsSync(dir)) return stats;
  const ignore = new Set(['node_modules', '.git', 'dist', '.evo', '.codegraph']);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return stats;
  }
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(full, depth + 1, stats);
    } else if (entry.isFile()) {
      stats.files++;
      const ext = path.extname(entry.name) || '(no-ext)';
      stats.byExt[ext] = (stats.byExt[ext] || 0) + 1;
      try {
        const st = fs.statSync(full);
        if (isProbablyBinaryOrOversized(full, ext, st.size)) {
          stats.skippedContent++;
          continue;
        }
        const content = fs.readFileSync(full, 'utf8');
        stats.lines += content.split(/\r?\n/).length;
      } catch {}
    }
  }
  return stats;
}

if (isSelfTest) {
  const tmpFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-metrics-selftest-'));
  try {
    fs.writeFileSync(path.join(tmpFixture, 'sample.txt'), 'line1\nline2\n', 'utf8');
    const selfRes = scanDirectory(tmpFixture);
    if (selfRes.files < 1) {
      throw new Error(`Expected self-test scanDirectory files >= 1, got ${selfRes.files}`);
    }
    console.log(
      JSON.stringify({
        self_test: 'passed',
        scanned_files: selfRes.files,
        scanned_lines: selfRes.lines,
      })
    );
    process.exit(0);
  } finally {
    fs.rmSync(tmpFixture, { recursive: true, force: true });
  }
}
const result = scanDirectory(workspace);
console.log(JSON.stringify({ workspace: path.basename(workspace), ...result }, null, 2));