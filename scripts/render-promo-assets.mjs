#!/usr/bin/env node
/**
 * EvoKernel Studio Promo Asset Renderer (inspired by Vincentwei1021/video-shotcraft & mg-styles-15)
 *
 * Pipeline:
 * 1. Exports the real Live Cockpit HTML (`evo ui --export`) and captures a 2x Retina texture
 *    using Headless Chromium (`--device-scale-factor=2`), adhering to video-shotcraft Rule Q1 & Q2.
 * 2. Renders studio-grade 2x Retina promotional visuals (`assets/hero-architecture.png`,
 *    `assets/cockpit-showcase.png`, `assets/terminal-score-xray.png`, `assets/social-preview.png`)
 *    with Linear/Raycast Obsidian Glass aesthetics, 3D perspective depth (Rule Q7), and
 *    high-contrast legible typography (Rule Q11) with zero text-on-object overlap.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportUiHtml } from '../dist/cli/ui.js';
import { buildScoreReport, renderScoreSvg } from '../dist/cli/score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(repoRoot, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('No Chromium/Chrome executable found for headless @2x rendering.');
}

const chromeBin = findBrowserExecutable();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-shotcraft-'));

function captureHtmlToPng(htmlContent, outPngPath, width, height, scale = 2) {
  const htmlPath = path.join(tmpDir, `scene-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  const fileUrl = `file://${htmlPath}`;
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-device-scale-factor=' + String(scale),
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
  // 1. Update SVG diagnostic card first
  const scoreReport = buildScoreReport(repoRoot);
  const svgCard = renderScoreSvg(scoreReport);
  const svgOutPath = path.join(assetsDir, 'terminal-score-xray.svg');
  fs.writeFileSync(svgOutPath, svgCard, 'utf8');
  console.log('✓ Updated vector card:', svgOutPath);

  // 2. Capture Real Live Cockpit (`evo ui --export`) at @2x Retina (Rule Q1 & Q2)
  // Keep <script> 100% unmodified so strict CSP script-src 'sha256-...' executes in Headless Chrome!
  const rawCockpitHtmlPath = path.join(tmpDir, 'real-cockpit.html');
  exportUiHtml(repoRoot, rawCockpitHtmlPath, { anon: false });
  const rawCockpitHtml = fs.readFileSync(rawCockpitHtmlPath, 'utf8');
  const rawCockpitPngPath = path.join(tmpDir, 'real-cockpit-raw.png');
  captureHtmlToPng(rawCockpitHtml, rawCockpitPngPath, 1440, 1020, 2);
  const cockpitBase64 = fs.readFileSync(rawCockpitPngPath).toString('base64');
  console.log('✓ Captured real Live Cockpit @2x texture (2880x2040)');

  // Capture a dedicated @2x cutout of the Constellation section by hiding other cards via CSS only (preserving <script> SHA-256)
  const constCutoutHtml = rawCockpitHtml.replace(
    '</style>',
    'header, .kpi-strip, .grid-2, body > .card:nth-of-type(4), body > .card:nth-of-type(5) { display: none !important; } body { padding: 0 !important; background: #050608 !important; } body > .card:nth-of-type(3) { margin: 0 !important; border: none !important; border-radius: 0 !important; }</style>'
  );
  const constCutoutPngPath = path.join(tmpDir, 'const-cutout.png');
  captureHtmlToPng(constCutoutHtml, constCutoutPngPath, 940, 420, 2);
  const constCutoutBase64 = fs.readFileSync(constCutoutPngPath).toString('base64');
  console.log('✓ Captured @2x AST Constellation cutout (1880x840)');

  // 3D optical glass background plate
  const glassConceptPath = path.join(assetsDir, 'glass-stack-plate.jpg');
  const hasGlassPlate = fs.existsSync(glassConceptPath);
  const glassPlateBase64 = hasGlassPlate ? fs.readFileSync(glassConceptPath).toString('base64') : '';

  // 3. Render `assets/hero-architecture.png` (1280x720 @2x = 2560x1440 Retina)
  // Zero overlap between top-left headline and bottom-left 3D isometric glass stack!
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
  ${
    hasGlassPlate
      ? `.bg-glass-art {
    position: absolute;
    left: 24px;
    top: 238px;
    width: 625px;
    height: 452px;
    border-radius: 16px;
    background-image: url("data:image/jpeg;base64,${glassPlateBase64}");
    background-size: 118% auto;
    background-position: 52% 52%;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 28px 60px -15px rgba(0, 0, 0, 0.85);
    overflow: hidden;
  }
  .glass-caption {
    position: absolute;
    left: 16px;
    bottom: 14px;
    background: rgba(4, 6, 9, 0.82);
    border: 1px solid rgba(16, 185, 129, 0.35);
    backdrop-filter: blur(10px);
    padding: 6px 12px;
    border-radius: 8px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: #cbd5e1;
  }`
      : ''
  }
  .frame-border {
    position: absolute;
    inset: 14px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
    pointer-events: none;
  }

  /* Top Brand Bar */
  .top-bar {
    position: absolute;
    top: 32px;
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
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
    padding: 6px 15px;
    border-radius: 999px;
  }
  .dot-live {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 12px #10b981;
  }
  .brand-name {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: -0.01em;
    color: #ffffff;
  }
  .brand-tag {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    color: #34d399;
  }
  .harness-pills {
    display: flex;
    gap: 8px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    color: #cbd5e1;
  }
  .h-pill {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.09);
    padding: 5px 11px;
    border-radius: 6px;
  }

  /* Left Top Unobstructed Headline */
  .left-hero {
    position: absolute;
    top: 84px;
    left: 44px;
    width: 605px;
  }
  .eyebrow {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #34d399;
    margin-bottom: 6px;
  }
  .headline {
    font-size: 40px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1.08;
    background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 8px;
  }
  .subhead {
    font-size: 14px;
    color: #94a3b8;
    line-height: 1.45;
    max-width: 580px;
  }

  /* Right Spotlight Card Stack (video-shotcraft spotlight-hero-card) */
  .right-stack {
    position: absolute;
    top: 84px;
    right: 44px;
    width: 566px;
    display: flex;
    flex-direction: column;
    gap: 13px;
  }
  .glass-card {
    background: linear-gradient(180deg, rgba(15, 20, 30, 0.9) 0%, rgba(7, 10, 16, 0.94) 100%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 24px 50px -15px rgba(0, 0, 0, 0.85);
    border-radius: 15px;
    padding: 18px 20px;
  }
  .card-kicker {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #94a3b8;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
  }
  .vs-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .vs-box {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.07);
  }
  .vs-raw {
    background: rgba(239, 68, 68, 0.06);
    border-color: rgba(239, 68, 68, 0.22);
  }
  .vs-evo {
    background: rgba(16, 185, 129, 0.09);
    border-color: rgba(16, 185, 129, 0.38);
  }
  .vs-label { font-size: 11px; color: #94a3b8; margin-bottom: 2px; }
  .vs-num {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.03em;
  }
  .vs-sub { font-size: 10.5px; font-family: "JetBrains Mono", monospace; margin-top: 2px; color: #cbd5e1; }

  .bar-compare { display: flex; flex-direction: column; gap: 7px; }
  .bar-line { display: flex; align-items: center; gap: 10px; font-family: "JetBrains Mono", monospace; font-size: 11px; }
  .bar-track { flex: 1; height: 8px; background: rgba(255,255,255,0.06); border-radius: 99px; overflow: hidden; }
  .bar-fill-raw { width: 92%; height: 100%; background: linear-gradient(90deg, #f59e0b, #ef4444); border-radius: 99px; }
  .bar-fill-evo { width: 10%; height: 100%; background: linear-gradient(90deg, #10b981, #38bdf8); border-radius: 99px; box-shadow: 0 0 12px #10b981; }

  /* 3-Tier Compact Spec Rows */
  .tier-badges {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .tier-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255,255,255,0.075);
    padding: 8px 13px;
    border-radius: 9px;
  }
  .tier-left { display: flex; align-items: center; gap: 10px; }
  .tier-id {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
  }
  .t-l0 { background: rgba(16,185,129,0.16); color: #34d399; border: 1px solid rgba(16,185,129,0.4); }
  .t-l1 { background: rgba(56,189,248,0.16); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); }
  .t-l2 { background: rgba(255,255,255,0.08); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.2); }
  .tier-title { font-size: 12.5px; font-weight: 600; color: #f8fafc; }
  .tier-cost {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11.5px;
    font-weight: 700;
    color: #34d399;
  }

  /* AST Anchor Verification Mini-Card */
  .ast-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .ast-stat {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 9px;
    padding: 10px 12px;
  }
  .ast-val {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.035em;
    color: #ffffff;
  }
  .ast-lbl { font-size: 11px; color: #94a3b8; margin-top: 2px; }

  .cli-strip {
    margin-top: 10px;
    background: #030508;
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 9px;
    padding: 9px 14px;
    font-family: "JetBrains Mono", monospace;
    font-size: 12.5px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
</style>
</head>
<body>
  <div class="bg-plate"></div>
  <div class="bg-glass-art">
    <div class="glass-caption"><span style="color:#34d399; font-weight:700;">3-Tier Progressive Disclosure</span> · L0 Seed → L1 FTS5 Index → L2 AST Sandbox</div>
  </div>
  <div class="frame-border"></div>

  <div class="top-bar">
    <div class="brand-pill">
      <span class="dot-live"></span>
      <span class="brand-name">EvoKernel v0.3.0</span>
      <span class="brand-tag">5-Tool Meta-MCP · AST Memory Guard</span>
    </div>
    <div class="harness-pills">
      <span class="h-pill">Claude Code</span>
      <span class="h-pill">Cursor</span>
      <span class="h-pill">Codex CLI</span>
      <span class="h-pill">Gemini CLI</span>
    </div>
  </div>

  <div class="left-hero">
    <div class="eyebrow">Context OS for Coding Agents</div>
    <div class="headline">Reclaim 89% of Your Context Window.</div>
    <div class="subhead">
      Virtualize 40+ bloated MCP schemas behind a 5-tool gateway and anchor episodic bug-fix memories to 16-hex TypeScript AST fingerprints.
    </div>
  </div>

  <div class="right-stack">
    <div class="glass-card">
      <div class="card-kicker">
        <span>50-TURN SESSION BENCHMARK</span>
        <span style="color:#34d399;">● REPRODUCIBLE: npm run benchmark</span>
      </div>
      <div class="vs-grid">
        <div class="vs-box vs-raw">
          <div class="vs-label">Raw Eager MCP + Rules</div>
          <div class="vs-num" style="color:#f87171;">2,200,000</div>
          <div class="vs-sub">44,000 tok/turn · Cache Thrash</div>
        </div>
        <div class="vs-box vs-evo">
          <div class="vs-label">EvoKernel L0/L1/L2 Routing</div>
          <div class="vs-num" style="color:#34d399;">235,000</div>
          <div class="vs-sub">-89.3% Prompt Tax Saved</div>
        </div>
      </div>
      <div class="bar-compare">
        <div class="bar-line">
          <span style="width:88px; color:#94a3b8;">Eager Load</span>
          <div class="bar-track"><div class="bar-fill-raw"></div></div>
          <span style="width:62px; text-align:right; color:#f87171;">44.0k/t</span>
        </div>
        <div class="bar-line">
          <span style="width:88px; color:#e2e8f0; font-weight:600;">EvoKernel</span>
          <div class="bar-track"><div class="bar-fill-evo"></div></div>
          <span style="width:62px; text-align:right; color:#34d399; font-weight:700;">4.7k/t</span>
        </div>
      </div>
    </div>

    <div class="glass-card" style="padding: 14px 18px;">
      <div class="tier-badges">
        <div class="tier-row">
          <div class="tier-left">
            <span class="tier-id t-l0">L0 SEED</span>
            <span class="tier-title">Always-On Routing Seed &amp; Prompt-Cache Shield</span>
          </div>
          <span class="tier-cost">~180 tok (0.09%)</span>
        </div>
        <div class="tier-row">
          <div class="tier-left">
            <span class="tier-id t-l1">L1 INDEX</span>
            <span class="tier-title">Native node:sqlite FTS5 + BM25 Hybrid Search</span>
          </div>
          <span class="tier-cost">~80 tok / match</span>
        </div>
        <div class="tier-row">
          <div class="tier-left">
            <span class="tier-id t-l2">L2 AST</span>
            <span class="tier-title">On-Demand SOPs &amp; 30s Sandboxed Micro-Tools</span>
          </div>
          <span class="tier-cost">0 Idle Token Tax</span>
        </div>
      </div>
    </div>

    <div class="glass-card" style="padding: 16px 20px;">
      <div class="card-kicker" style="margin-bottom: 8px;">
        <span>DOGFOODING TELEMETRY (EVO SCORE)</span>
        <span style="color:#38bdf8;">GRADE A+ (96 / 100)</span>
      </div>
      <div class="ast-row">
        <div class="ast-stat">
          <div class="ast-val" style="color:#34d399;">96<span style="font-size:14px;color:#64748b;">/100</span></div>
          <div class="ast-lbl">Context Health</div>
        </div>
        <div class="ast-stat">
          <div class="ast-val">15<span style="font-size:14px;color:#38bdf8;">/15</span></div>
          <div class="ast-lbl">AST Memories Verified</div>
        </div>
        <div class="ast-stat">
          <div class="ast-val">10<span style="font-size:14px;color:#34d399;">/10</span></div>
          <div class="ast-lbl">Hotspots Guarded</div>
        </div>
      </div>
      <div class="cli-strip">
        <span><span style="color:#34d399;">$</span> npx -y evo-kernel score</span>
        <span style="font-size:11px; color:#38bdf8;">Zero-Write · &lt;25ms Audit</span>
      </div>
    </div>
  </div>
</body>
</html>`;

  const heroOutPath = path.join(assetsDir, 'hero-architecture.png');
  captureHtmlToPng(heroHtml, heroOutPath, 1280, 720, 2);
  console.log('✓ Rendered @2x Hero Architecture promo (2560x1440):', heroOutPath);

  // 4. Render `assets/cockpit-showcase.png` (1280x760 @2x = 2560x1520 Retina)
  // Real 2x Cockpit capture staged in 3D perspective + floating @2x AST Constellation Cutout card!
  const cockpitShowcaseHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px;
    height: 760px;
    overflow: hidden;
    background:
      radial-gradient(ellipse 85% 55% at 50% 0%, rgba(16, 185, 129, 0.16), rgba(56, 189, 248, 0.06) 50%, transparent 80%),
      #040609;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #f8fafc;
    -webkit-font-smoothing: antialiased;
    position: relative;
  }
  .top-header {
    text-align: center;
    padding-top: 22px;
  }
  .kicker {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: #34d399;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .title {
    font-size: 27px;
    font-weight: 800;
    letter-spacing: -0.035em;
    margin-top: 3px;
    background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .stage {
    position: absolute;
    top: 86px;
    left: 44px;
    right: 44px;
    bottom: 24px;
    perspective: 1800px;
  }
  .browser-window {
    width: 86%;
    height: 92%;
    background: #050608;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      0 35px 80px -15px rgba(0, 0, 0, 0.9),
      0 0 50px rgba(16, 185, 129, 0.08);
    overflow: hidden;
    transform: rotateY(4deg) rotateX(2deg);
    transform-origin: left center;
    display: flex;
    flex-direction: column;
  }
  .window-bar {
    height: 32px;
    background: #0a0d14;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 7px;
    flex-shrink: 0;
  }
  .dot { width: 9.5px; height: 9.5px; border-radius: 50%; }
  .d-r { background: #ef4444; opacity: 0.85; }
  .d-y { background: #f59e0b; opacity: 0.85; }
  .d-g { background: #10b981; opacity: 0.85; }
  .url-pill {
    margin: 0 auto;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    padding: 2px 24px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    color: #94a3b8;
  }
  .screen-body {
    flex: 1;
    background-image: url("data:image/png;base64,${cockpitBase64}");
    background-size: cover;
    background-position: top center;
  }
  /* Floating 2x Cutout Card of the Interactive AST Constellation (Rule Q1 + Q7) */
  .constellation-cutout-card {
    position: absolute;
    right: 0;
    bottom: 6px;
    width: 560px;
    height: 268px;
    background: #06090f;
    border-radius: 14px;
    border: 1px solid rgba(56, 189, 248, 0.42);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.2),
      0 28px 70px rgba(0, 0, 0, 0.92),
      0 0 36px rgba(16, 185, 129, 0.18);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .cutout-bar {
    height: 28px;
    background: rgba(16, 185, 129, 0.12);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    color: #34d399;
    font-weight: 700;
  }
  .cutout-img {
    flex: 1;
    background-image: url("data:image/png;base64,${constCutoutBase64}");
    background-size: cover;
    background-position: center;
  }
</style>
</head>
<body>
  <div class="top-header">
    <div class="kicker">Zero-Write Local &amp; Static Web Telemetry · Strict SHA-256 CSP</div>
    <div class="title">Obsidian Live Cockpit &amp; Interactive AST Memory Constellation</div>
  </div>
  <div class="stage">
    <div class="browser-window">
      <div class="window-bar">
        <span class="dot d-r"></span>
        <span class="dot d-y"></span>
        <span class="dot d-g"></span>
        <span class="url-pill">https://damonless.github.io/EvoKernel/ · npx evo-kernel ui</span>
      </div>
      <div class="screen-body"></div>
    </div>
    <div class="constellation-cutout-card">
      <div class="cutout-bar">
        <span>● AST MEMORY &amp; SYMBOL TOPOLOGY CONSTELLATION</span>
        <span style="color:#38bdf8;">15/15 VERIFIED</span>
      </div>
      <div class="cutout-img"></div>
    </div>
  </div>
</body>
</html>`;

  const cockpitShowcaseOut = path.join(assetsDir, 'cockpit-showcase.png');
  captureHtmlToPng(cockpitShowcaseHtml, cockpitShowcaseOut, 1280, 760, 2);
  console.log('✓ Rendered @2x Cockpit Showcase (2560x1520):', cockpitShowcaseOut);

  // 5. Render `assets/terminal-score-xray.png` (940x430 @2x = 1880x860 Retina)
  const xrayHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 940px; height: 430px; background: transparent; overflow: hidden; }
</style>
</head>
<body>${svgCard}</body>
</html>`;
  const xrayPngOut = path.join(assetsDir, 'terminal-score-xray.png');
  captureHtmlToPng(xrayHtml, xrayPngOut, 940, 430, 2);
  console.log('✓ Rendered @2x Terminal Score X-Ray PNG (1880x860):', xrayPngOut);

  // 6. Render `assets/social-preview.png` (1280x640 @2x = 2560x1280 Retina)
  const socialHtml = heroHtml
    .replace('height: 720px;', 'height: 640px;')
    .replace('font-size: 40px;', 'font-size: 35px;')
    .replace('top: 238px;', 'top: 222px;')
    .replace('height: 452px;', 'height: 390px;')
    .replace('top: 84px;', 'top: 72px;')
    .replace('gap: 13px;', 'gap: 9px;');
  const socialPngOut = path.join(assetsDir, 'social-preview.png');
  captureHtmlToPng(socialHtml, socialPngOut, 1280, 640, 2);
  console.log('✓ Rendered @2x Social Preview PNG (2560x1280):', socialPngOut);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
