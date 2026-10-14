import * as fs from 'node:fs';
import * as path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

function buildDir(currentSrc, currentDist) {
  fs.mkdirSync(currentDist, { recursive: true });
  for (const entry of fs.readdirSync(currentSrc, { withFileTypes: true })) {
    const srcPath = path.join(currentSrc, entry.name);
    if (entry.isDirectory()) {
      buildDir(srcPath, path.join(currentDist, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const tsCode = fs.readFileSync(srcPath, 'utf8');
      const jsCode = stripTypeScriptTypes(tsCode, { mode: 'strip' });
      const outName = entry.name.replace(/\.ts$/, '.js');
      const outPath = path.join(currentDist, outName);
      fs.writeFileSync(outPath, jsCode, 'utf8');
    }
  }
}

fs.rmSync(distDir, { recursive: true, force: true });
buildDir(srcDir, distDir);
console.log('Built dist/ from src/ using native node:module.stripTypeScriptTypes (0 external dependencies).');
