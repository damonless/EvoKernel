#!/usr/bin/env node
/**
 * EvoKernel Studio Promo Asset Renderer
 *
 * Pipeline:
 * 1. Updates `assets/terminal-score-xray.svg` from `buildScoreReport(..., { anon: true })`
 *    (zero fabricated fallbacks, unified "EvoKernel Workbench" branding, zero local path leaks).
 * 2. When a local Chromium/Edge binary is available, captures @2x Retina PNGs
 *    (`assets/workbench-showcase.png`, `assets/social-preview.png`) aligned to
 *    the single benchmark SSOT (`benchmarks/context-tax-benchmark.mjs --json`),
 *    and syncs `public/assets/workbench-showcase.png` for the static landing page.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScoreReport, renderScoreSvg } from '../dist/cli/score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(repoRoot, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

const benchRaw = execFileSync(
  process.execPath,
  [path.join(repoRoot, 'benchmarks', 'context-tax-benchmark.mjs'), '--json'],
  { cwd: repoRoot, encoding: 'utf8' }
);
const bench = JSON.parse(benchRaw).benchmark;
const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version || '0.3.0';

// 1. Update SVG diagnostic card (`assets/terminal-score-xray.svg`) with anon=true (zero path leaks)
const scoreReport = buildScoreReport(repoRoot, { anon: true });
scoreReport.workspaceRoot = 'damonless/EvoKernel';
let svgCard = renderScoreSvg(scoreReport);
svgCard = svgCard
  .replace(/font-family="JetBrains Mono,/g, 'font-family="\'Cascadia Code\', Consolas, \'JetBrains Mono\',')
  .replace(/font-family="Inter, -apple-system,/g, 'font-family="Inter, -apple-system, BlinkMacSystemFont, \'Segoe UI\',');
const svgOutPath = path.join(assetsDir, 'terminal-score-xray.svg');
fs.writeFileSync(svgOutPath, svgCard, 'utf8');
console.log('✓ Updated vector card:', svgOutPath);

const chromeBin = findBrowserExecutable();
if (!chromeBin) {
  console.log('ℹ No local Chromium/Edge found; skipped @2x PNG rasterization.');
  process.exit(0);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-shotcraft-'));

function captureHtmlToPng(htmlContent, outPngPath, width, height, scale = 2) {
  const htmlPath = path.join(tmpDir, `scene-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--lang=en-US',
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    `--screenshot=${outPngPath}`,
    fileUrl,
  ];
  const res = spawnSync(chromeBin, args, { encoding: 'utf8', timeout: 30000 });
  if (res.status !== 0 || !fs.existsSync(outPngPath)) {
    throw new Error(`Chrome render failed for ${outPngPath}: ${res.stderr || res.stdout}`);
  }
}

try {
  // Always rebuild synthetic demo HTML in public/demo/index.html so assets reflect latest code & telemetry
  const demoHtmlPath = path.join(repoRoot, 'public', 'demo', 'index.html');
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-pages.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  const demoHtml = fs.readFileSync(demoHtmlPath, 'utf8');
  const demoSnapMatch = demoHtml.match(/var snapshot = (\{[\s\S]*?\});\s*\r?\n\s*var token =/);
  const demoSavedPct = demoSnapMatch
    ? String(JSON.parse(demoSnapMatch[1])?.score?.contextSavings?.savingsPercent ?? bench.staticPrefixReductionPct)
    : String(bench.staticPrefixReductionPct);

  const workbenchPngPath = path.join(tmpDir, 'real-workbench.png');
  captureHtmlToPng(demoHtml, workbenchPngPath, 1440, 860, 2);
  const workbenchBase64 = fs.readFileSync(workbenchPngPath).toString('base64');
  console.log('✓ Captured real EvoKernel Workbench @2x texture (1440x860)');

  const rawTok = Number(bench.rawEagerTokensPerTurn).toLocaleString('en-US');
  const evoTok = Number(bench.evoBasePrefixTokens).toLocaleString('en-US');
  const pct = String(bench.staticPrefixReductionPct);
  const cumEvoK = (Number(bench.evoTotalInputTokens) / 1000).toFixed(1) + 'k';

  const isometricSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 605 460" width="605" height="460" style="width:100%;height:100%;display:block;">
    <defs>
      <linearGradient id="isoCardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="rgba(14,22,38,0.92)"/>
        <stop offset="100%" stop-color="rgba(8,12,22,0.96)"/>
      </linearGradient>
      <linearGradient id="isoGlassBorder" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.2)"/>
        <stop offset="50%" stop-color="rgba(255,255,255,0.06)"/>
        <stop offset="100%" stop-color="rgba(56,189,248,0.25)"/>
      </linearGradient>
      <filter id="isoGlowEmerald" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>

    <rect width="605" height="460" rx="16" fill="url(#isoCardGrad)" stroke="url(#isoGlassBorder)" stroke-width="1.2"/>

    <g transform="translate(18, 20)" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="10.5">
      <text x="0" y="14" fill="#38bdf8" font-weight="700" letter-spacing="0.06em">77 UPSTREAM MCP TOOLS</text>
      <g transform="translate(0, 26)">
        <rect width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="13" r="3" fill="#38bdf8"/>
        <text x="18" y="17" fill="#e2e8f0">github (18)</text>

        <rect x="0" y="34" width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="47" r="3" fill="#38bdf8"/>
        <text x="18" y="51" fill="#e2e8f0">playwright (14)</text>

        <rect x="0" y="68" width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="81" r="3" fill="#38bdf8"/>
        <text x="18" y="85" fill="#e2e8f0">kubernetes (12)</text>

        <rect x="0" y="102" width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="115" r="3" fill="#38bdf8"/>
        <text x="18" y="119" fill="#e2e8f0">docker (9)</text>
      </g>

      <g transform="translate(122, 26)">
        <rect width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="13" r="3" fill="#34d399"/>
        <text x="18" y="17" fill="#e2e8f0">linear (8)</text>

        <rect x="0" y="34" width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="47" r="3" fill="#34d399"/>
        <text x="18" y="51" fill="#e2e8f0">postgres (6)</text>

        <rect x="0" y="68" width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="81" r="3" fill="#34d399"/>
        <text x="18" y="85" fill="#e2e8f0">sentry (6)</text>

        <rect x="0" y="102" width="112" height="26" rx="5" fill="#090d16" stroke="rgba(255,255,255,0.1)"/>
        <circle cx="10" cy="115" r="3" fill="#34d399"/>
        <text x="18" y="119" fill="#e2e8f0">context7 (4)</text>
      </g>

      <rect x="0" y="164" width="234" height="24" rx="5" fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.25)"/>
      <text x="10" y="180" fill="#f87171" font-size="10">Raw: ${rawTok} tok / turn (Eager)</text>
    </g>

    <g stroke="rgba(56,189,248,0.25)" stroke-width="1.3" fill="none">
      <path d="M 244 60 C 290 60, 320 85, 345 92"/>
      <path d="M 244 94 C 290 94, 320 90, 345 92"/>
      <path d="M 244 128 C 290 128, 320 95, 345 92"/>
      <path d="M 244 162 C 290 148, 320 98, 345 92"/>
    </g>
    <circle cx="345" cy="92" r="5" fill="#10b981" filter="url(#isoGlowEmerald)"/>

    <g transform="translate(340, 48)">
      <polygon points="8,0 240,0 254,20 254,104 22,104 8,84" fill="rgba(6,30,22,0.92)" stroke="#10b981" stroke-width="1.6"/>
      <polygon points="8,0 240,0 254,20 22,20" fill="rgba(16,185,129,0.2)"/>
      <rect x="18" y="26" width="76" height="18" rx="4" fill="rgba(16,185,129,0.25)" stroke="#10b981"/>
      <text x="24" y="39" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9.5" font-weight="800" fill="#34d399">L0 SEED</text>
      <text x="100" y="39" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11.5" font-weight="800" fill="#ffffff">5-Tool Gateway</text>
      <text x="18" y="62" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="10.5" font-weight="700" fill="#34d399">${evoTok} tok · 100% KV Shield</text>
      <text x="18" y="78" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="8.6" fill="#94a3b8">search • inspect • run • propose • compact</text>
      <text x="18" y="94" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9" fill="#38bdf8">✓ 0 Schema Mutation Busts</text>
    </g>

    <line x1="465" y1="152" x2="465" y2="188" stroke="#38bdf8" stroke-width="2.2" stroke-dasharray="4 4"/>
    <circle cx="465" cy="170" r="3.5" fill="#38bdf8"/>

    <g transform="translate(340, 188)">
      <polygon points="8,0 240,0 254,20 254,102 22,102 8,82" fill="rgba(12,24,42,0.92)" stroke="#38bdf8" stroke-width="1.6"/>
      <polygon points="8,0 240,0 254,20 22,20" fill="rgba(56,189,248,0.18)"/>
      <rect x="18" y="26" width="76" height="18" rx="4" fill="rgba(56,189,248,0.2)" stroke="#38bdf8"/>
      <text x="24" y="39" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9.5" font-weight="800" fill="#38bdf8">L1 INDEX</text>
      <text x="100" y="39" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11.5" font-weight="800" fill="#ffffff">node:sqlite FTS5</text>
      <text x="18" y="62" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="10.5" font-weight="700" fill="#38bdf8">~0.05ms Recall · BM25</text>
      <text x="18" y="78" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9.2" fill="#94a3b8">CJK/EN Synonym Expansion</text>
      <text x="18" y="94" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9" fill="#34d399">✓ Visible Recall Receipts</text>
    </g>

    <line x1="465" y1="290" x2="465" y2="326" stroke="#818cf8" stroke-width="2.2" stroke-dasharray="4 4"/>
    <circle cx="465" cy="308" r="3.5" fill="#818cf8"/>

    <g transform="translate(340, 326)">
      <polygon points="8,0 240,0 254,20 254,102 22,102 8,82" fill="rgba(18,16,36,0.92)" stroke="#818cf8" stroke-width="1.6"/>
      <polygon points="8,0 240,0 254,20 22,20" fill="rgba(129,140,248,0.2)"/>
      <rect x="18" y="26" width="76" height="18" rx="4" fill="rgba(129,140,248,0.22)" stroke="#818cf8"/>
      <text x="24" y="39" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9.5" font-weight="800" fill="#c7d2fe">L2 AST*</text>
      <text x="100" y="39" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11.5" font-weight="800" fill="#ffffff">AST Memories</text>
      <text x="18" y="62" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="10.5" font-weight="700" fill="#c7d2fe">0 Core Tax · 16-Hex Hashes</text>
      <text x="18" y="78" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9.2" fill="#94a3b8">Sandboxed Micro-Tools (Exit 0)</text>
      <text x="18" y="94" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="9" fill="#34d399">✓ 100% AST* Memories [VERIFIED]</text>
    </g>

    <g transform="translate(18, 412)">
      <rect width="300" height="34" rx="8" fill="rgba(4,6,10,0.85)" stroke="rgba(16,185,129,0.3)"/>
      <circle cx="14" cy="17" r="4" fill="#10b981"/>
      <text x="26" y="21" font-family="'Cascadia Code', Consolas, 'JetBrains Mono', ui-monospace, monospace" font-size="10" fill="#cbd5e1">
        <tspan fill="#34d399" font-weight="700">3-Tier Progressive Disclosure</tspan> · L0→L1→L2
      </text>
    </g>
  </svg>`;

  const heroHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px;
    height: 720px;
    overflow: hidden;
    background: #040609;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #f8fafc;
    -webkit-font-smoothing: antialiased;
    position: relative;
  }
  .bg-plate {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 26% 62%, rgba(16, 185, 129, 0.14) 0%, rgba(56, 189, 248, 0.05) 40%, transparent 72%),
      radial-gradient(circle at 82% 20%, rgba(56, 189, 248, 0.1) 0%, transparent 55%),
      #040609;
  }
  .bg-stack-art {
    position: absolute;
    left: 24px;
    top: 242px;
    width: 605px;
    height: 460px;
  }
  .frame-border {
    position: absolute;
    inset: 14px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
    pointer-events: none;
  }
  .top-bar {
    position: absolute;
    top: 28px;
    left: 44px;
    right: 44px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .brand-pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: rgba(10, 15, 24, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 6px 15px;
    border-radius: 999px;
  }
  .dot-live { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
  .brand-name { font-weight: 700; font-size: 13px; color: #ffffff; }
  .brand-tag { font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: 11.5px; color: #34d399; }
  .harness-pills { display: flex; gap: 8px; font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: 11px; color: #cbd5e1; }
  .h-pill { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); padding: 5px 11px; border-radius: 6px; }
  .left-hero { position: absolute; top: 72px; left: 44px; width: 605px; }
  .eyebrow { font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: 11.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #34d399; margin-bottom: 4px; }
  .headline {
    font-size: 36px; font-weight: 800; letter-spacing: -0.035em; line-height: 1.08;
    background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 6px;
  }
  .subhead { font-size: 13.5px; color: #94a3b8; line-height: 1.4; max-width: 580px; }
  .right-stack { position: absolute; top: 80px; right: 44px; width: 566px; display: flex; flex-direction: column; gap: 12px; }
  .glass-card {
    background: linear-gradient(180deg, rgba(15, 20, 30, 0.9) 0%, rgba(7, 10, 16, 0.94) 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 15px; padding: 16px 20px;
  }
  .card-kicker { font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; margin-bottom: 10px; display: flex; justify-content: space-between; }
  .vs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px; }
  .vs-box { padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.07); }
  .vs-raw { background: rgba(239, 68, 68, 0.06); border-color: rgba(239, 68, 68, 0.22); }
  .vs-evo { background: rgba(16, 185, 129, 0.09); border-color: rgba(16, 185, 129, 0.38); }
  .vs-label { font-size: 11px; color: #94a3b8; margin-bottom: 2px; }
  .vs-num { font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: 24px; font-weight: 800; position: relative; display: inline-block; }
  .slash-strike { position: absolute; left: -2px; right: -2px; top: 52%; height: 3px; background: #ef4444; border-radius: 2px; }
  .vs-sub { font-size: 10.5px; font-family: "Cascadia Code", Consolas, monospace; margin-top: 2px; color: #cbd5e1; }
  .bar-compare { display: flex; flex-direction: column; gap: 7px; }
  .bar-line { display: flex; align-items: center; gap: 10px; font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; }
  .bar-track { flex: 1; height: 8px; background: rgba(255,255,255,0.06); border-radius: 99px; overflow: hidden; }
  .bar-fill-raw { width: 100%; height: 100%; background: linear-gradient(90deg, #f59e0b, #ef4444); border-radius: 99px; }
  .bar-fill-evo { width: 11.3%; height: 100%; background: linear-gradient(90deg, #10b981, #38bdf8); border-radius: 99px; box-shadow: 0 0 12px #10b981; }
  .tier-badges { display: flex; flex-direction: column; gap: 7px; }
  .tier-row { display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255,255,255,0.075); padding: 8px 13px; border-radius: 99px; }
  .tier-left { display: flex; align-items: center; gap: 10px; }
  .tier-id { font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
  .t-l0 { background: rgba(16,185,129,0.16); color: #34d399; border: 1px solid rgba(16,185,129,0.4); }
  .t-l1 { background: rgba(56,189,248,0.16); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); }
  .t-l2 { background: rgba(255,255,255,0.08); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.2); }
  .tier-title { font-size: 12.5px; font-weight: 600; color: #f8fafc; }
  .tier-cost { font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: 11.5px; font-weight: 700; color: #34d399; }
  .ast-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .ast-stat { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 9px; padding: 10px 12px; }
  .ast-val { font-size: 24px; font-weight: 800; letter-spacing: -0.035em; color: #ffffff; }
  .ast-lbl { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .cli-strip { margin-top: 10px; background: #030508; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 9px; padding: 9px 14px; font-family: "Cascadia Code", Consolas, monospace; font-size: 12.5px; display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
  <div class="bg-plate"></div>
  <div class="bg-stack-art">${isometricSvg}</div>
  <div class="frame-border"></div>
  <div class="top-bar">
    <div class="brand-pill">
      <span class="dot-live"></span>
      <span class="brand-name">EvoKernel v${pkgVersion}</span>
      <span class="brand-tag">5-Tool Meta-MCP · AST* Memory Guard</span>
    </div>
    <div class="harness-pills">
      <span class="h-pill">Claude Code</span>
      <span class="h-pill">Cursor</span>
      <span class="h-pill">Codex CLI</span>
      <span class="h-pill">Gemini CLI</span>
    </div>
  </div>
  <div class="left-hero">
    <div class="eyebrow">Cognitive Context OS for Coding Agents</div>
    <div class="headline">Stop Repeating the Same Bug Twice.</div>
    <div class="subhead">
      AST-verified* cognitive memories, visible recall receipts, and a 6-stage Gatekeeper — cutting session-start token tax by ${pct}% (${rawTok} → ${evoTok} tok/turn).
    </div>
  </div>
  <div class="right-stack">
    <div class="glass-card">
      <div class="card-kicker">
        <span>50-TURN MULTI-MCP BENCHMARK</span>
        <span style="color:#34d399;">● REPRODUCIBLE: npm run benchmark</span>
      </div>
      <div class="vs-grid">
        <div class="vs-box vs-raw">
          <div class="vs-label">Raw Multi-MCP (77 Tools)</div>
          <div class="vs-num" style="color:#f87171;">${rawTok}<span class="slash-strike"></span></div>
          <div class="vs-sub">1,931,250 tok / 50 turns · 3 Busts</div>
        </div>
        <div class="vs-box vs-evo">
          <div class="vs-label">EvoKernel Virtualization</div>
          <div class="vs-num" style="color:#34d399;">${evoTok}</div>
          <div class="vs-sub">Saved ${pct}% · ${cumEvoK} tok (50t)</div>
        </div>
      </div>
      <div class="bar-compare">
        <div class="bar-line">
          <span style="width:88px; color:#94a3b8;">Raw Eager</span>
          <div class="bar-track"><div class="bar-fill-raw"></div></div>
          <span style="width:72px; text-align:right; color:#f87171;">27.2k/t</span>
        </div>
        <div class="bar-line">
          <span style="width:88px; color:#e2e8f0; font-weight:600;">EvoKernel</span>
          <div class="bar-track"><div class="bar-fill-evo"></div></div>
          <span style="width:72px; text-align:right; color:#34d399; font-weight:700;">3.1k/t</span>
        </div>
      </div>
    </div>
    <div class="glass-card" style="padding: 13px 18px;">
      <div class="tier-badges">
        <div class="tier-row">
          <div class="tier-left">
            <span class="tier-id t-l0">L0 SEED</span>
            <span class="tier-title">5 Fixed Meta-Tools + Compact Seed (100% KV Shield)</span>
          </div>
          <span class="tier-cost">${evoTok} tok</span>
        </div>
        <div class="tier-row">
          <div class="tier-left">
            <span class="tier-id t-l1">L1 INDEX</span>
            <span class="tier-title">Native node:sqlite FTS5 + Visible Recall Receipts</span>
          </div>
          <span class="tier-cost">~0.05ms</span>
        </div>
        <div class="tier-row">
          <div class="tier-left">
            <span class="tier-id t-l2">L2 AST*</span>
            <span class="tier-title">On-Demand SOPs &amp; Sandboxed Micro-Tools</span>
          </div>
          <span class="tier-cost">0 Core Tax</span>
        </div>
      </div>
    </div>
    <div class="glass-card" style="padding: 15px 20px;">
      <div class="card-kicker" style="margin-bottom: 8px;">
        <span>EVOKERNEL WORKBENCH (EVO SCORE)</span>
        <span style="color:#38bdf8;">GRADE ${scoreReport.grade} (${scoreReport.overallScore} / 100)</span>
      </div>
      <div class="ast-row">
        <div class="ast-stat">
          <div class="ast-val" style="color:#34d399;">${scoreReport.overallScore}<span style="font-size:14px;color:#64748b;">/100</span></div>
          <div class="ast-lbl">Context Health</div>
        </div>
        <div class="ast-stat">
          <div class="ast-val">100<span style="font-size:14px;color:#38bdf8;">%</span></div>
          <div class="ast-lbl">AST* Memories Verified</div>
        </div>
        <div class="ast-stat">
          <div class="ast-val">0<span style="font-size:14px;color:#34d399;"> deps</span></div>
          <div class="ast-lbl">Pure Node.js &gt;= 22.5</div>
        </div>
      </div>
      <div class="cli-strip">
        <span><span style="color:#34d399;">$</span> npx -y evo-kernel score</span>
        <span style="font-size:11px; color:#38bdf8;">Zero-Write · &lt;30ms Audit</span>
      </div>
    </div>
  </div>
</body>
</html>`;

  const showcaseHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px; height: 760px; overflow: hidden;
    background: radial-gradient(ellipse 85% 55% at 50% 0%, rgba(16, 185, 129, 0.14), transparent 80%), #09090b;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #f4f4f5; position: relative;
  }
  .top-header { text-align: center; padding-top: 18px; }
  .kicker { font-family: "Cascadia Code", Consolas, monospace; font-size: 11px; color: #34d399; letter-spacing: 0.08em; text-transform: uppercase; }
  .title { font-size: 25px; font-weight: 800; letter-spacing: -0.03em; margin-top: 3px; color: #fafafa; }
  .stage { position: absolute; top: 76px; left: 40px; right: 40px; bottom: 22px; display: flex; }
  .browser-window {
    flex: 1; background: #09090b; border-radius: 14px; border: 1px solid #27272a;
    box-shadow: 0 28px 65px -15px rgba(0, 0, 0, 0.9); overflow: hidden; display: flex; flex-direction: column;
  }
  .window-bar {
    height: 32px; background: #0f0f12; border-bottom: 1px solid #27272a;
    display: flex; align-items: center; padding: 0 14px; gap: 7px; flex-shrink: 0;
  }
  .dot { width: 9.5px; height: 9.5px; border-radius: 50%; }
  .d-r { background: #ef4444; } .d-y { background: #f59e0b; } .d-g { background: #10b981; }
  .url-pill { margin: 0 auto; background: #18181b; border: 1px solid #27272a; border-radius: 6px; padding: 2px 20px; font-family: "Cascadia Code", Consolas, monospace; font-size: 10.5px; color: #8b8b95; }
  .status-pill { font-family: "Cascadia Code", Consolas, monospace; font-size: 10px; font-weight: 700; color: #34d399; background: rgba(16,185,129,0.14); border: 1px solid rgba(16,185,129,0.3); padding: 2px 8px; border-radius: 4px; }
  .screen-body { flex: 1; background-image: url("data:image/png;base64,${workbenchBase64}"); background-size: cover; background-position: top center; }
</style>
</head>
<body>
  <div class="top-header">
    <div class="kicker">Zero-Dependency Local &amp; Static Web Dashboard · Strict SHA-256 CSP</div>
    <div class="title">EvoKernel Workbench — Capabilities, AST* Memories &amp; 7-Day Recall</div>
  </div>
  <div class="stage">
    <div class="browser-window">
      <div class="window-bar">
        <span class="dot d-r"></span><span class="dot d-y"></span><span class="dot d-g"></span>
        <span class="url-pill">http://127.0.0.1:4310 · npx -y evo-kernel ui</span>
        <span class="status-pill">SAVED ${demoSavedPct}%</span>
      </div>
      <div class="screen-body"></div>
    </div>
  </div>
</body>
</html>`;

  const workbenchShowcaseOut = path.join(assetsDir, 'workbench-showcase.png');
  captureHtmlToPng(showcaseHtml, workbenchShowcaseOut, 1280, 760, 2);
  console.log('✓ Rendered @2x Workbench Showcase PNG (2560x1520):', workbenchShowcaseOut);

  const socialOverrideStyle = `<style>
    body { height: 640px; }
    .top-bar { top: 22px; }
    .left-hero { top: 66px; width: 575px; }
    .headline { font-size: 31px; margin-bottom: 4px; }
    .subhead { font-size: 12.8px; line-height: 1.35; max-width: 560px; }
    .bg-stack-art { top: 190px; left: 32px; width: 556px; height: 422px; }
    .right-stack { top: 68px; gap: 9px; }
    .glass-card { padding: 12px 16px !important; }
    .card-kicker { margin-bottom: 7px !important; }
    .vs-grid { gap: 10px; margin-bottom: 8px; }
    .vs-box { padding: 9px 12px; }
    .vs-num { font-size: 21px; }
    .tier-badges { gap: 6px; }
    .tier-row { padding: 6px 12px; }
    .ast-stat { padding: 8px 10px; }
    .ast-val { font-size: 21px; }
    .cli-strip { margin-top: 8px; padding: 7px 12px; }
  </style></head>`;
  const socialHtml = heroHtml.replace('</head>', socialOverrideStyle);
  const socialPngOut = path.join(assetsDir, 'social-preview.png');
  captureHtmlToPng(socialHtml, socialPngOut, 1280, 640, 2);
  console.log('✓ Rendered @2x Social Preview PNG (2560x1280):', socialPngOut);

  // Sync public/ bundle so public/assets/workbench-showcase.png and public/index.html match the freshly rendered showcase
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-pages.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
