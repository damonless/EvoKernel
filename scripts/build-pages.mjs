#!/usr/bin/env node
/**
 * Builds the static GitHub Pages bundle in ./public/:
 *   - public/index.html      : Zero-dep Zinc Dark Product Landing Page (EN / ZH)
 *   - public/demo/index.html : Sanitized interactive EvoKernel Workbench Demo (--anon)
 *
 * Enforces strict leak-prevention & CSP invariants before exiting 0.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');
const demoDir = path.join(publicDir, 'demo');

const LEAK_REGEX = /(?:\/Users\/|\/home\/|(?<![A-Za-z])[A-Za-z]:[/\\]|ghp_|sk-ant-|AKIA)/;
const PERSONAL_ID_REGEX = /\b(?:ceo-team-orchestrator|dual-agent-team|evo-dev-verification-sop|evo-release-preflight)\b/;
const INLINE_HANDLER_REGEX = /\bon[a-z]+\s*=/i;

function ensureBuilt() {
  const distUi = path.join(repoRoot, 'dist', 'cli', 'ui.js');
  if (!fs.existsSync(distUi)) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'build.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }
}

function loadBenchmarkSsot() {
  const raw = execFileSync(
    process.execPath,
    [path.join(repoRoot, 'benchmarks', 'context-tax-benchmark.mjs'), '--json'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  return JSON.parse(raw);
}

function renderLandingHtml(benchPayload, showcaseImgSrc = './assets/workbench-showcase.png') {
  const sim = benchPayload.benchmark;
  const rawPrefix = Number(sim.rawEagerTokensPerTurn).toLocaleString('en-US');
  const evoPrefix = Number(sim.evoBasePrefixTokens).toLocaleString('en-US');
  const pct = String(sim.staticPrefixReductionPct);
  const rawTotal = Number(sim.rawTotalInputTokens).toLocaleString('en-US');
  const evoTotal = Number(sim.evoTotalInputTokens).toLocaleString('en-US');
  const totalPct = String(sim.totalTokenSavingsPct);
  const sonnetRaw = Number(sim.cost50TurnsUsd.sonnet.raw).toFixed(2);
  const sonnetEvo = Number(sim.cost50TurnsUsd.sonnet.evo).toFixed(2);
  const opusRaw = Number(sim.cost50TurnsUsd.opus.raw).toFixed(2);
  const opusEvo = Number(sim.cost50TurnsUsd.opus.evo).toFixed(2);
  const costPct = String(sim.cost50TurnsUsd.opus.savedPct);

  const clientScript = `(function () {
  var dict = {
    en: {
      eyebrow: 'Zero-Dependency Cognitive Context OS · Node.js >= 22.5',
      heroTitle: 'Stop Repeating the Same Bug Across Coding Sessions.',
      heroSub: 'AST-verified* cognitive memory, visible 1-line recall receipts, and a 6-stage deterministic Gatekeeper for 10 AI coding agents — cutting session-start token tax by ${pct}% (${rawPrefix} → ${evoPrefix} tok/turn) with 100% KV cache retention.',
      navFeatures: 'Capabilities',
      navBenchmark: 'Benchmark',
      navTrust: 'Reversibility',
      navGithub: 'GitHub',
      ctaDemo: 'Interactive Workbench Demo →',
      ctaGithub: 'View on GitHub',
      installLabel: 'Safe 30-Second Trial (Zero Git Pollution)',
      copyBtn: 'Copy',
      copiedBtn: 'Copied',
      kpi1Val: 'Saved ${pct}%',
      kpi1Sub: '${rawPrefix} → ${evoPrefix} tok/turn session-start prefix',
      kpi2Val: '100%',
      kpi2Sub: 'Byte-stable KV prompt cache (5 fixed meta-tools)',
      kpi3Val: '6 Gates',
      kpi3Sub: 'Static security, sandbox dry-run, BM25 & anti-confounding',
      kpi4Val: '0 Deps',
      kpi4Sub: 'Pure Node.js built-ins · 100% local SQLite',
      showcaseLabel: 'EvoKernel Workbench — Click to explore interactive sanitized snapshot (./demo/)',
      showcaseCta: 'Launch Interactive Demo →',
      secPillars: 'Three Deterministic Pillars',
      p1Tag: 'MEMORY · ANTI-DRIFT',
      p1Title: 'AST-Verified* Cognitive Memory & Recall Receipts',
      p1Desc: 'Root-cause fixes bind to live code symbols via lexical-structural skeleton hashes. Stale memories auto-demote when code changes, and active recalls emit a visible 1-line receipt (🛡️ EvoKernel Recall).',
      p2Tag: 'GATEKEEPER · WORKTREE',
      p2Title: '6-Stage Deterministic Gatekeeper & Worktree Evolution',
      p2Desc: 'Every candidate rule, skill, micro-tool, or memory must pass static security, lexical de-symbolization, isolated --self-test rollback, hybrid BM25 deduplication, a 1,500-token core budget, and causal attribution.',
      p3Tag: 'VIRTUALIZATION · 10 HOSTS',
      p3Title: 'Fixed 5-Tool Meta-MCP Across 10 Coding Harnesses',
      p3Desc: 'Folds sprawling third-party MCP schemas and monolithic CLAUDE.md files behind evo_search, evo_inspect, evo_run, evo_propose, and evo_compact across Claude Code, Cursor, Codex, Windsurf, Cline, Roo, Copilot, OpenCode, Gemini, and Antigravity.',
      secBench: 'Reproducible 50-Turn Session Benchmark (npm run benchmark)',
      thMetric: 'Metric',
      thRaw: 'Raw Multi-MCP + Monolithic CLAUDE.md',
      thEvo: 'EvoKernel 5-Tool Meta-Gateway',
      thDelta: 'Measured Delta',
      rowSchemas: 'Exposed Tool Schemas',
      rowPrefix: 'Session-Start Static Prefix / Turn',
      rowCache: 'Mid-Session Cache Invalidations',
      rowTotal: '50-Turn Cumulative Prompt Tokens',
      rowSonnet: '50-Turn API Cost (Claude Sonnet 4.5)',
      rowOpus: '50-Turn API Cost (Claude Opus 4.5)',
      astNote: '* AST Terminology Note: "AST" denotes EvoKernel\\'s zero-dependency lexical-structural skeleton & call-anchor fingerprinting, immune to comments, formatting, and line-number drift without external compiler packages.',
      secTrust: 'Reversible by Design · Zero Outbound Telemetry',
      t1Title: 'Stealth or Team-Shared',
      t1Desc: 'Use --stealth to isolate trial files in .git/info/exclude with zero working-tree noise, or commit .evo/ so every teammate shares verified root-cause memories.',
      t2Title: '1-Command Lossless Teardown',
      t2Desc: 'Run npx -y evo-kernel virtualize --restore && npx -y evo-kernel uninstall at any time to strip <!-- EVO:START --> markers and restore host configs byte-cleanly.',
      t3Title: '100% Local SQLite Storage',
      t3Desc: 'Zero cloud accounts, zero external API keys, and zero outbound network telemetry. Inspect everything locally via npx -y evo-kernel ui or doctor.',
      footerText: 'MIT License · Zero External Dependencies · Built on Native Node.js >= 22.5'
    },
    zh: {
      eyebrow: '零外部依赖认知上下文操作系统 · Node.js >= 22.5',
      heroTitle: '让 AI 编程助手告别跨会话重复踩坑。',
      heroSub: '面向 10 款主流 AI 编程环境的 AST 级防漂移*认知记忆、单行可见召回回执与 6 道确定性沙盒门禁 —— 削减 ${pct}% 会话启动 Token 税（${rawPrefix} → ${evoPrefix} tok/轮），保持 100% KV 缓存字节级命中。',
      navFeatures: '核心能力',
      navBenchmark: '基准实测',
      navTrust: '可逆与隐私',
      navGithub: 'GitHub',
      ctaDemo: '打开交互式工作台演示 →',
      ctaGithub: '访问 GitHub 仓库',
      installLabel: '30 秒无痕安全试用（零 Git 脏文件污染）',
      copyBtn: '复制',
      copiedBtn: '已复制',
      kpi1Val: '已节省 ${pct}%',
      kpi1Sub: '${rawPrefix} → ${evoPrefix} tok/轮 会话启动静态前缀',
      kpi2Val: '100%',
      kpi2Sub: 'KV 缓存字节级稳定（恒定暴露 5 个元工具）',
      kpi3Val: '6 道门禁',
      kpi3Sub: '静态安全、沙盒自测回滚、BM25 查重与防因果混淆',
      kpi4Val: '0 外部依赖',
      kpi4Sub: '纯 Node.js 原生内置模块 · 100% 本地 SQLite',
      showcaseLabel: 'EvoKernel Workbench 工作台实景预览 —— 点击体验脱敏交互演示 (./demo/)',
      showcaseCta: '打开在线交互演示 →',
      secPillars: '三大确定性工程支柱',
      p1Tag: '认知记忆 · 防漂移',
      p1Title: 'AST 级防漂移*认知记忆与单行可见召回回执',
      p1Desc: '每次排障根因通过词法-结构骨架哈希锚定真实代码符号；源码重构导致漂移时自动降级为 STALE，命中召回时在对话中输出单行可见回执（🛡️ EvoKernel Recall）。',
      p2Tag: '确定性门禁 · 隔离工作树',
      p2Title: '6 道确定性沙盒门禁与离线 Worktree 演进',
      p2Desc: '所有候选规则、技能、微工具与排障记忆均须通过静态安全审查、去符号化泛化、沙盒 --self-test 零污染回滚、混合 BM25 去重、1,500-tok 核心预算硬顶与因果归因校验。',
      p3Tag: '网关虚拟化 · 10 大宿主',
      p3Title: '恒定 5 元工具网关无缝适配 10 款编码环境',
      p3Desc: '将臃肿的下游 MCP 工具与巨石规则折叠至 evo_search、evo_inspect、evo_run、evo_propose、evo_compact 背后，原生支持 Claude Code、Cursor、Codex、Windsurf、Cline、Roo、Copilot、OpenCode、Gemini 与 Antigravity。',
      secBench: '可复现 50 轮工程会话基准实测 (npm run benchmark)',
      thMetric: '核心指标',
      thRaw: '直连多 MCP + 巨石 CLAUDE.md',
      thEvo: 'EvoKernel 5-Tool 元网关',
      thDelta: '实测收益',
      rowSchemas: '暴露给宿主的顶层工具 Schema',
      rowPrefix: '会话启动静态前缀税 / 轮',
      rowCache: '中途演进引发的缓存击穿',
      rowTotal: '50 轮累计输入 Tokens',
      rowSonnet: '50 轮账单成本 (Claude Sonnet 4.5)',
      rowOpus: '50 轮账单成本 (Claude Opus 4.5)',
      astNote: '* AST 术语说明：“AST”指零外部依赖词法-结构骨架与调用链锚点指纹（Lexical-Structural Skeleton Fingerprinting），无需重型外部编译器即可对注释修改、格式化与行号偏移天然免疫。',
      secTrust: '原生可逆设计 · 100% 本地零外发隐私保障',
      t1Title: '个人无痕试用或团队协同共享',
      t1Desc: '使用 --stealth 将试用配置隔离写入 .git/info/exclude 实现零 Git 干扰；或提交 .evo/ 目录让团队全员共享根因记忆。',
      t2Title: '一条命令无损卸载还原',
      t2Desc: '随时运行 npx -y evo-kernel virtualize --restore && npx -y evo-kernel uninstall 即可剥离受控标记块并完整恢复宿主配置。',
      t3Title: '100% 本地 SQLite 零外发遥测',
      t3Desc: '无需注册云端账号、无需外部 API Key、零网络外发请求。通过 npx -y evo-kernel ui 或 doctor 随时在本地透明审查全部数据。',
      footerText: 'MIT 开源协议 · 零第三方依赖 · 基于 Node.js >= 22.5 原生构建'
    }
  };

  var currentLang = 'en';
  try {
    var saved = window.localStorage.getItem('evo_pages_lang');
    if (saved === 'zh' || saved === 'en') currentLang = saved;
    else if ((navigator.language || '').toLowerCase().indexOf('zh') === 0) currentLang = 'zh';
  } catch (e) {}

  function applyLang(lang) {
    currentLang = lang === 'zh' ? 'zh' : 'en';
    document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
    var d = dict[currentLang];
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (key && d[key]) nodes[i].textContent = d[key];
    }
    var zhSpan = document.getElementById('lang-opt-zh');
    var enSpan = document.getElementById('lang-opt-en');
    if (zhSpan && enSpan) {
      zhSpan.className = currentLang === 'zh' ? 'lang-seg active' : 'lang-seg';
      enSpan.className = currentLang === 'en' ? 'lang-seg active' : 'lang-seg';
    }
    try { window.localStorage.setItem('evo_pages_lang', currentLang); } catch (e) {}
  }

  var langBtn = document.getElementById('landing-lang-toggle');
  if (langBtn) {
    langBtn.addEventListener('click', function () {
      applyLang(currentLang === 'en' ? 'zh' : 'en');
    });
  }

  var copyBtn = document.getElementById('btn-copy-install');
  var cmdEl = document.getElementById('install-cmd-text');
  if (copyBtn && cmdEl) {
    copyBtn.addEventListener('click', function () {
      var text = cmdEl.textContent || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          copyBtn.textContent = dict[currentLang].copiedBtn;
          setTimeout(function () {
            copyBtn.textContent = dict[currentLang].copyBtn;
          }, 1600);
        }).catch(function () {});
      }
    });
  }

  applyLang(currentLang);
})();`;

  const scriptHash = crypto.createHash('sha256').update(clientScript, 'utf8').digest('base64');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'sha256-${scriptHash}'; connect-src 'none'; base-uri 'self';" />
  <title>EvoKernel — Deterministic Cognitive Memory &amp; Meta-Kernel for AI Coding Agents</title>
  <meta name="description" content="AST-verified cognitive memory, visible recall receipts, and 6-stage deterministic Gatekeeper for AI coding agents — with 88.7% lower session-start token tax and 0 dependencies." />
  <style>
    :root {
      --bg-app: #09090b;
      --bg-panel: #0f0f12;
      --bg-elevated: #18181b;
      --border-subtle: #27272a;
      --text-primary: #f4f4f5;
      --text-secondary: #d4d4d8;
      --text-muted: #8b8b95;
      --accent: #10b981;
      --accent-soft: rgba(16, 185, 129, 0.14);
      --kind-rule: #38bdf8;
      --kind-skill: #a78bfa;
      --kind-tool: #f59e0b;
      --kind-memory: #34d399;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { background: var(--bg-app); color: var(--text-primary); font-family: var(--font-sans); line-height: 1.55; }
    body { min-height: 100vh; background: radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.09), transparent 52%), var(--bg-app); }
    a { color: inherit; text-decoration: none; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .container { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
    .topbar {
      position: sticky; top: 0; z-index: 20;
      background: rgba(9, 9, 11, 0.88);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border-subtle);
    }
    .topbar-inner {
      display: flex; align-items: center; justify-content: space-between;
      height: 60px; gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
    .brand-badge {
      font-family: var(--font-mono); font-size: 11px; color: var(--accent);
      background: var(--accent-soft); border: 1px solid rgba(16, 185, 129, 0.32);
      padding: 2px 7px; border-radius: 999px;
    }
    .nav-links { display: flex; align-items: center; gap: 18px; font-size: 13px; color: var(--text-muted); }
    .nav-links a:hover { color: var(--text-primary); }
    .topbar-actions { display: flex; align-items: center; gap: 10px; }
    .lang-btn {
      display: inline-flex; align-items: center; gap: 2px;
      background: var(--bg-panel); border: 1px solid var(--border-subtle);
      color: var(--text-muted); border-radius: 7px; padding: 3px; cursor: pointer; font-size: 12px;
    }
    .lang-seg { padding: 3px 7px; border-radius: 5px; font-weight: 600; }
    .lang-seg.active { background: var(--bg-elevated); color: var(--text-primary); }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 9px 16px; border-radius: 8px; font-size: 13.5px; font-weight: 600;
      border: 1px solid var(--border-subtle); cursor: pointer; transition: border-color 0.15s, background 0.15s;
    }
    .btn-primary {
      background: var(--accent); color: #052e16; border-color: #34d399;
    }
    .btn-primary:hover { background: #34d399; }
    .btn-secondary {
      background: var(--bg-panel); color: var(--text-primary);
    }
    .btn-secondary:hover { border-color: #52525b; background: var(--bg-elevated); }
    .hero { padding: 68px 0 48px; }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: var(--font-mono); font-size: 12px; color: var(--accent);
      background: var(--accent-soft); border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 5px 12px; border-radius: 999px; margin-bottom: 20px;
    }
    h1 {
      font-size: clamp(30px, 4.6vw, 50px); line-height: 1.12; letter-spacing: -0.03em;
      font-weight: 800; max-width: 880px; margin-bottom: 18px;
    }
    .hero-sub {
      font-size: 16.5px; color: var(--text-secondary); max-width: 820px; margin-bottom: 28px;
    }
    .install-card {
      background: var(--bg-panel); border: 1px solid var(--border-subtle);
      border-radius: 12px; padding: 14px 16px; max-width: 760px; margin-bottom: 24px;
    }
    .install-header {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 12px; color: var(--text-muted); margin-bottom: 8px;
    }
    .install-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: #070709; border: 1px solid #1f1f23; border-radius: 8px; padding: 10px 12px;
    }
    .install-cmd {
      font-family: var(--font-mono); font-size: 13px; color: #34d399;
      overflow-x: auto; white-space: nowrap;
    }
    .copy-btn {
      background: var(--bg-elevated); color: var(--text-primary);
      border: 1px solid var(--border-subtle); border-radius: 6px;
      padding: 5px 11px; font-size: 12px; font-weight: 600; cursor: pointer; flex-shrink: 0;
    }
    .copy-btn:hover { border-color: var(--accent); }
    .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 40px; }
    .kpi-grid {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px;
    }
    .kpi-card {
      background: var(--bg-panel); border: 1px solid var(--border-subtle);
      border-radius: 10px; padding: 16px;
    }
    .kpi-val {
      font-family: var(--font-mono); font-size: 22px; font-weight: 800; color: var(--accent);
      margin-bottom: 4px;
    }
    .kpi-sub { font-size: 12.5px; color: var(--text-muted); }
    .showcase-card {
      margin-top: 28px;
      background: var(--bg-panel);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    }
    .showcase-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 16px; background: #0c0c10; border-bottom: 1px solid var(--border-subtle);
      font-size: 12.5px; color: var(--text-muted);
    }
    .showcase-bar-cta {
      font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--accent);
      white-space: nowrap;
    }
    .showcase-link { display: block; line-height: 0; }
    .showcase-link:hover .showcase-img { opacity: 0.96; }
    .showcase-img { display: block; width: 100%; height: auto; transition: opacity 0.15s; }
    section { padding: 44px 0; border-top: 1px solid #18181b; }
    h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 20px; }
    .pillar-grid, .trust-grid {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;
    }
    .card {
      background: var(--bg-panel); border: 1px solid var(--border-subtle);
      border-radius: 12px; padding: 20px;
    }
    .tag {
      display: inline-block; font-family: var(--font-mono); font-size: 11px; font-weight: 700;
      padding: 2px 8px; border-radius: 999px; margin-bottom: 10px;
    }
    .tag-mem { color: var(--kind-memory); background: rgba(52, 211, 153, 0.12); }
    .tag-gk { color: var(--kind-tool); background: rgba(245, 158, 11, 0.12); }
    .tag-mcp { color: var(--kind-rule); background: rgba(56, 189, 248, 0.12); }
    .card h3 { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
    .card p { font-size: 13.5px; color: var(--text-muted); }
    .table-wrap {
      overflow-x: auto; background: var(--bg-panel);
      border: 1px solid var(--border-subtle); border-radius: 12px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #1c1c21; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); background: #0c0c0f; }
    tr:last-child td { border-bottom: none; }
    .mono { font-family: var(--font-mono); }
    .good { color: var(--accent); font-weight: 700; }
    .footnote { margin-top: 12px; font-size: 12px; color: var(--text-muted); }
    footer {
      padding: 28px 0 44px; border-top: 1px solid var(--border-subtle);
      font-size: 12.5px; color: var(--text-muted);
      display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;
    }
    @media (max-width: 900px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pillar-grid, .trust-grid { grid-template-columns: 1fr; }
      .nav-links { display: none; }
    }
    @media (max-width: 520px) {
      .kpi-grid { grid-template-columns: 1fr; }
      .install-row { flex-direction: column; align-items: stretch; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; animation: none !important; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="container topbar-inner">
      <div class="brand">
        <span>🧬 EvoKernel</span>
        <span class="brand-badge">v0.3.0</span>
      </div>
      <nav class="nav-links">
        <a href="#pillars" data-i18n="navFeatures">Capabilities</a>
        <a href="#benchmark" data-i18n="navBenchmark">Benchmark</a>
        <a href="#trust" data-i18n="navTrust">Reversibility</a>
        <a href="https://github.com/damonless/EvoKernel" data-i18n="navGithub">GitHub</a>
      </nav>
      <div class="topbar-actions">
        <button type="button" id="landing-lang-toggle" class="lang-btn" aria-label="Switch language">
          <span id="lang-opt-zh" class="lang-seg">中</span>
          <span id="lang-opt-en" class="lang-seg active">EN</span>
        </button>
        <a class="btn btn-primary" href="./demo/" data-i18n="ctaDemo">Interactive Workbench Demo →</a>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="hero">
      <div class="eyebrow" data-i18n="eyebrow">Zero-Dependency Cognitive Context OS · Node.js &gt;= 22.5</div>
      <h1 data-i18n="heroTitle">Stop Repeating the Same Bug Across Coding Sessions.</h1>
      <p class="hero-sub" data-i18n="heroSub">AST-verified* cognitive memory, visible 1-line recall receipts, and a 6-stage deterministic Gatekeeper for 10 AI coding agents — cutting session-start token tax by ${pct}% (${rawPrefix} → ${evoPrefix} tok/turn) with 100% KV cache retention.</p>

      <div class="install-card">
        <div class="install-header">
          <span data-i18n="installLabel">Safe 30-Second Trial (Zero Git Pollution)</span>
          <span class="mono">npx evo-kernel ui · score</span>
        </div>
        <div class="install-row">
          <code id="install-cmd-text" class="install-cmd">npx -y evo-kernel init --stealth &amp;&amp; npx -y evo-kernel doctor</code>
          <button type="button" id="btn-copy-install" class="copy-btn" data-i18n="copyBtn">Copy</button>
        </div>
      </div>

      <div class="cta-row">
        <a class="btn btn-primary" href="./demo/" data-i18n="ctaDemo">Interactive Workbench Demo →</a>
        <a class="btn btn-secondary" href="https://github.com/damonless/EvoKernel" data-i18n="ctaGithub">View on GitHub</a>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-val" data-i18n="kpi1Val">Saved ${pct}%</div>
          <div class="kpi-sub" data-i18n="kpi1Sub">${rawPrefix} → ${evoPrefix} tok/turn session-start prefix</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val" data-i18n="kpi2Val">100%</div>
          <div class="kpi-sub" data-i18n="kpi2Sub">Byte-stable KV prompt cache (5 fixed meta-tools)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val" data-i18n="kpi3Val">6 Gates</div>
          <div class="kpi-sub" data-i18n="kpi3Sub">Static security, sandbox dry-run, BM25 &amp; anti-confounding</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-val" data-i18n="kpi4Val">0 Deps</div>
          <div class="kpi-sub" data-i18n="kpi4Sub">Pure Node.js built-ins · 100% local SQLite</div>
        </div>
      </div>

      <div class="showcase-card">
        <div class="showcase-bar">
          <span data-i18n="showcaseLabel">EvoKernel Workbench — Click to explore interactive sanitized snapshot (./demo/)</span>
          <a href="./demo/" class="showcase-bar-cta" data-i18n="showcaseCta">Launch Interactive Demo →</a>
        </div>
        <a href="./demo/" class="showcase-link" aria-label="Open Interactive EvoKernel Workbench Demo">
          <img class="showcase-img" src="${showcaseImgSrc}" alt="EvoKernel Workbench — Capabilities, AST Memories &amp; 7-Day Recall" width="1280" height="760" loading="eager" />
        </a>
      </div>
    </div>

    <section id="pillars">
      <h2 data-i18n="secPillars">Three Deterministic Pillars</h2>
      <div class="pillar-grid">
        <article class="card">
          <span class="tag tag-mem" data-i18n="p1Tag">MEMORY · ANTI-DRIFT</span>
          <h3 data-i18n="p1Title">AST-Verified* Cognitive Memory &amp; Recall Receipts</h3>
          <p data-i18n="p1Desc">Root-cause fixes bind to live code symbols via lexical-structural skeleton hashes. Stale memories auto-demote when code changes, and active recalls emit a visible 1-line receipt (🛡️ EvoKernel Recall).</p>
        </article>
        <article class="card">
          <span class="tag tag-gk" data-i18n="p2Tag">GATEKEEPER · WORKTREE</span>
          <h3 data-i18n="p2Title">6-Stage Deterministic Gatekeeper &amp; Worktree Evolution</h3>
          <p data-i18n="p2Desc">Every candidate rule, skill, micro-tool, or memory must pass static security, lexical de-symbolization, isolated --self-test rollback, hybrid BM25 deduplication, a 1,500-token core budget, and causal attribution.</p>
        </article>
        <article class="card">
          <span class="tag tag-mcp" data-i18n="p3Tag">VIRTUALIZATION · 10 HOSTS</span>
          <h3 data-i18n="p3Title">Fixed 5-Tool Meta-MCP Across 10 Coding Harnesses</h3>
          <p data-i18n="p3Desc">Folds sprawling third-party MCP schemas and monolithic CLAUDE.md files behind evo_search, evo_inspect, evo_run, evo_propose, and evo_compact across Claude Code, Cursor, Codex, Windsurf, Cline, Roo, Copilot, OpenCode, Gemini, and Antigravity.</p>
        </article>
      </div>
    </section>

    <section id="benchmark">
      <h2 data-i18n="secBench">Reproducible 50-Turn Session Benchmark (npm run benchmark)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th data-i18n="thMetric">Metric</th>
              <th data-i18n="thRaw">Raw Multi-MCP + Monolithic CLAUDE.md</th>
              <th data-i18n="thEvo">EvoKernel 5-Tool Meta-Gateway</th>
              <th data-i18n="thDelta">Measured Delta</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-i18n="rowSchemas">Exposed Tool Schemas</td>
              <td class="mono">${sim.rawToolsCount} tools</td>
              <td class="mono good">${sim.evoMetaToolsCount} fixed meta-tools</td>
              <td class="mono good">-93.5%</td>
            </tr>
            <tr>
              <td data-i18n="rowPrefix">Session-Start Static Prefix / Turn</td>
              <td class="mono">${rawPrefix} tokens</td>
              <td class="mono good">${evoPrefix} tokens</td>
              <td class="mono good">-${pct}%</td>
            </tr>
            <tr>
              <td data-i18n="rowCache">Mid-Session Cache Invalidations</td>
              <td class="mono">${sim.rawCacheInvalidations} full prefix busts</td>
              <td class="mono good">0 (100% cache hit)</td>
              <td class="mono good">100% shield</td>
            </tr>
            <tr>
              <td data-i18n="rowTotal">50-Turn Cumulative Prompt Tokens</td>
              <td class="mono">${rawTotal} tokens</td>
              <td class="mono good">${evoTotal} tokens</td>
              <td class="mono good">-${totalPct}%</td>
            </tr>
            <tr>
              <td data-i18n="rowSonnet">50-Turn API Cost (Claude Sonnet 4.5)</td>
              <td class="mono">$${sonnetRaw}</td>
              <td class="mono good">$${sonnetEvo}</td>
              <td class="mono good">-${costPct}%</td>
            </tr>
            <tr>
              <td data-i18n="rowOpus">50-Turn API Cost (Claude Opus 4.5)</td>
              <td class="mono">$${opusRaw}</td>
              <td class="mono good">$${opusEvo}</td>
              <td class="mono good">-${costPct}%</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="footnote" data-i18n="astNote">* AST Terminology Note: "AST" denotes EvoKernel's zero-dependency lexical-structural skeleton &amp; call-anchor fingerprinting, immune to comments, formatting, and line-number drift without external compiler packages.</p>
    </section>

    <section id="trust">
      <h2 data-i18n="secTrust">Reversible by Design · Zero Outbound Telemetry</h2>
      <div class="trust-grid">
        <article class="card">
          <h3 data-i18n="t1Title">Stealth or Team-Shared</h3>
          <p data-i18n="t1Desc">Use --stealth to isolate trial files in .git/info/exclude with zero working-tree noise, or commit .evo/ so every teammate shares verified root-cause memories.</p>
        </article>
        <article class="card">
          <h3 data-i18n="t2Title">1-Command Lossless Teardown</h3>
          <p data-i18n="t2Desc">Run npx -y evo-kernel virtualize --restore &amp;&amp; npx -y evo-kernel uninstall at any time to strip &lt;!-- EVO:START --&gt; markers and restore host configs byte-cleanly.</p>
        </article>
        <article class="card">
          <h3 data-i18n="t3Title">100% Local SQLite Storage</h3>
          <p data-i18n="t3Desc">Zero cloud accounts, zero external API keys, and zero outbound network telemetry. Inspect everything locally via npx -y evo-kernel ui or doctor.</p>
        </article>
      </div>
    </section>

    <footer>
      <span data-i18n="footerText">MIT License · Zero External Dependencies · Built on Native Node.js &gt;= 22.5</span>
      <span class="mono"><a href="./demo/">./demo/</a> · <a href="https://github.com/damonless/EvoKernel">github.com/damonless/EvoKernel</a></span>
    </footer>
  </main>

  <script>${clientScript}</script>
</body>
</html>
`;
}

async function buildSyntheticDemoHtml(destHtmlPath) {
  const { runInit } = await import(pathToFileURL(path.join(repoRoot, 'dist', 'cli', 'init.js')).href);
  const { exportUiHtml } = await import(pathToFileURL(path.join(repoRoot, 'dist', 'cli', 'ui.js')).href);
  const { EvoStorage, estimateTokens } = await import(
    pathToFileURL(path.join(repoRoot, 'dist', 'core', 'storage.js')).href
  );
  const { EvoTelemetry } = await import(
    pathToFileURL(path.join(repoRoot, 'dist', 'core', 'telemetry.js')).href
  );
  const { buildFingerprintsForTargets, resolveCurrentGitBranch, resolveCurrentGitCommit } = await import(
    pathToFileURL(path.join(repoRoot, 'dist', 'core', 'memory.js')).href
  );

  const demoWs = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-pages-demo-'));
  try {
    fs.mkdirSync(path.join(demoWs, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(demoWs, 'package.json'),
      JSON.stringify({ name: 'acme-api-gateway', version: '1.4.0', type: 'module' }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      path.join(demoWs, 'src', 'router.ts'),
      `export function normalizeRoutePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed === '/') return '/';
  return '/' + trimmed.replace(/^\\/+|\\/+$/g, '');
}

export function dispatchRequest(method: string, rawPath: string): string {
  const route = normalizeRoutePath(rawPath);
  return \`\${method.toUpperCase()} \${route}\`;
}
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(demoWs, 'src', 'cache.ts'),
      `const inflight = new Map<string, Promise<string>>();

export async function getOrLoadCached(key: string, loader: () => Promise<string>): Promise<string> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = loader().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(demoWs, 'src', 'validator.ts'),
      `export function parseJsonConfig(rawInput: string): Record<string, unknown> {
  const clean = rawInput.charCodeAt(0) === 0xfeff ? rawInput.slice(1) : rawInput;
  const parsed = JSON.parse(clean);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected top-level JSON object');
  }
  return parsed as Record<string, unknown>;
}
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(demoWs, 'src', 'auth.ts'),
      `import { timingSafeEqual } from 'node:crypto';

export function verifyWebhookSignature(expectedHex: string, receivedHex: string): boolean {
  const cleanExpected = expectedHex.trim().toLowerCase();
  const cleanReceived = receivedHex.trim().toLowerCase();
  if (cleanExpected.length === 0 || cleanExpected.length !== cleanReceived.length || cleanExpected.length % 2 !== 0) {
    return false;
  }
  const bufA = Buffer.from(cleanExpected, 'hex');
  const bufB = Buffer.from(cleanReceived, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(demoWs, 'src', 'ratelimit.ts'),
      `export function consumeTokenBucket(
  bucket: { tokens: number; lastRefillMs: number },
  nowMs: number,
  ratePerSec: number,
  burstCapacity: number
): boolean {
  const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
  bucket.tokens = Math.min(burstCapacity, bucket.tokens + elapsedSec * ratePerSec);
  bucket.lastRefillMs = Math.max(bucket.lastRefillMs, nowMs);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
`,
      'utf8'
    );

    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Evo Demo',
      GIT_AUTHOR_EMAIL: 'demo@evokernel.local',
      GIT_COMMITTER_NAME: 'Evo Demo',
      GIT_COMMITTER_EMAIL: 'demo@evokernel.local',
    };
    spawnSync('git', ['init', '-b', 'main'], { cwd: demoWs, env: gitEnv, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Evo Demo'], { cwd: demoWs, env: gitEnv, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'demo@evokernel.local'], { cwd: demoWs, env: gitEnv, stdio: 'ignore' });
    spawnSync('git', ['add', '.'], { cwd: demoWs, env: gitEnv, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'feat: initial gateway modules'], { cwd: demoWs, env: gitEnv, stdio: 'ignore' });

    // Record realistic bug-fix commits so Git Hotspots showcases protected fragile files
    const commitTouch = (relPath, bannerComment, message) => {
      const target = path.join(demoWs, relPath);
      const prev = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(target, `// ${bannerComment}\n${prev}`, 'utf8');
      spawnSync('git', ['add', relPath], { cwd: demoWs, env: gitEnv, stdio: 'ignore' });
      spawnSync('git', ['commit', '-m', message], { cwd: demoWs, env: gitEnv, stdio: 'ignore' });
    };
    commitTouch('src/router.ts', 'Guard root "/" route before stripping slashes', 'fix(router): prevent infinite 308 redirect loop on root path');
    commitTouch('src/router.ts', 'Normalize uppercase HTTP verb in dispatcher', 'fix(router): canonicalize method casing before route dispatch');
    commitTouch('src/cache.ts', 'Evict rejected promises in finally() handler', 'fix(cache): clear poisoned in-flight promise on upstream timeout');
    commitTouch('src/validator.ts', 'Strip leading UTF-8 BOM (0xFEFF) before JSON.parse', 'fix(config): handle Windows UTF-8 BOM and non-object JSON roots');
    commitTouch('src/auth.ts', 'Guard unequal buffer byte lengths before timingSafeEqual', 'fix(auth): prevent RangeError crash on truncated HMAC signatures');
    commitTouch('src/ratelimit.ts', 'Clamp negative NTP clock skew in token bucket refill', 'fix(ratelimit): prevent negative elapsed time from draining burst tokens');

    // Seed official starter rules, skills, and micro-tools from templates/seed-evo
    const seedEvoDir = path.join(repoRoot, 'templates', 'seed-evo');
    if (fs.existsSync(seedEvoDir)) {
      fs.cpSync(seedEvoDir, path.join(demoWs, '.evo'), { recursive: true });
    }

    runInit(demoWs, ['claude', 'cursor']);

    // Add virtualized 8-server MCP pool config (.evo/mcp-pool.json) matching benchmarks/context-tax-benchmark.mjs (14,700 tok)
    fs.writeFileSync(
      path.join(demoWs, '.evo', 'mcp-pool.json'),
      JSON.stringify(
        {
          mcpServers: {
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
            playwright: { command: 'npx', args: ['-y', '@playwright/mcp'] },
            kubernetes: { command: 'npx', args: ['-y', 'mcp-server-kubernetes'] },
            docker: { command: 'npx', args: ['-y', 'mcp-server-docker'] },
            linear: { command: 'npx', args: ['-y', '@linear/mcp-server'] },
            postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
            sentry: { command: 'npx', args: ['-y', '@sentry/mcp-server'] },
            context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const storage = new EvoStorage(demoWs);
    const now = '2026-10-15T12:00:00.000Z';

    const scopedRules = [
      {
        id: 'singleflight-cache-stampede-guard',
        title: 'Coalesce concurrent cache misses with an in-flight promise map',
        l0_summary: 'Async cache loaders -> concurrent miss stampede -> deduplicate in-flight promises and clear in finally().',
        scope_glob: 'src/**/*.ts',
        core: false,
        priority: 60,
        content: [
          'When implementing async read-through caches, JWKS key fetchers, or upstream metadata loaders:',
          '1. Deduplicate concurrent cache misses per canonical key inside an in-flight `Map<string, Promise<T>>` before invoking the upstream I/O loader so N parallel requests trigger exactly 1 upstream round-trip.',
          '2. Always attach `.finally(() => inflight.delete(key))` before storing the promise so transient upstream timeouts, DNS failures, or 5xx rejections never stay wedged in memory and poison subsequent retries.',
          '3. Bound maximum in-flight map cardinality and enforce an explicit AbortSignal deadline on upstream calls to prevent slowloris socket exhaustion under traffic spikes.',
          '4. Separate negative-cache TTLs (short, jittered) from positive-cache TTLs so upstream outages recover immediately once health checks pass.',
        ].join('\n'),
        transfer_scenarios: [
          'Read-through cache loaders backing HTTP or RPC handlers',
          'Lazy OAuth/JWKS token and session refreshers shared across concurrent requests',
        ],
      },
      {
        id: 'config-bom-and-root-shape-guard',
        title: 'Strip UTF-8 BOM and validate root object shape on user config files',
        l0_summary: 'User-edited JSON/TOML/YAML -> UTF-8 BOM or array root crash -> strip 0xFEFF and fail closed on non-objects.',
        scope_glob: 'src/**/*.ts',
        core: false,
        priority: 55,
        content: [
          'Before parsing user-editable JSON, TOML, or YAML configuration files across platforms:',
          '1. Strip leading UTF-8 Byte Order Mark (`0xFEFF`) inserted by Windows editors and PowerShell `Set-Content -Encoding UTF8` before passing text to `JSON.parse` or line-oriented frontmatter scanners.',
          '2. Verify the parsed root value is a non-null plain object (`typeof val === "object" && val !== null && !Array.isArray(val)`) and fail closed with a structured diagnostic rather than silently overwriting user files.',
          '3. Preserve unknown sibling keys and user comments during lossless configuration merges so multi-tool workspaces never lose unrelated host settings.',
        ].join('\n'),
        transfer_scenarios: [
          'CLI configuration loaders reading workspace JSON/YAML/TOML files',
          'Webhook payload and schema manifest validators accepting external JSON documents',
        ],
      },
      {
        id: 'canonical-route-slash-normalization',
        title: 'Guard root "/" path before stripping leading or trailing slashes',
        l0_summary: 'URL path canonicalizer -> root "/" collapsed to "" -> 308 redirect loop -> return "/" early before regex trim.',
        scope_glob: 'src/router.ts',
        core: false,
        priority: 58,
        content: [
          'When normalizing HTTP request paths, reverse-proxy prefixes, or REST route tables:',
          '1. Explicitly guard the root path (`trimmed === "" || trimmed === "/"`) and return `"/"` prior to running leading/trailing slash-trimming regular expressions.',
          '2. Canonicalize HTTP method verbs to uppercase ASCII before route-table lookup while preserving original query-string byte ordering for HMAC signature verification.',
          '3. Assert idempotency (`normalize(normalize(p)) === normalize(p)`) across `"/"`, `"///"`, `"/v1/health/"`, and empty inputs in unit tests to prevent infinite 301/308 redirect loops.',
        ].join('\n'),
        transfer_scenarios: [
          'API gateway route dispatchers and canonical redirect middleware',
          'Static asset path resolvers and mount-prefix strippers',
        ],
      },
    ];

    for (const r of scopedRules) {
      storage.saveRule({
        ...r,
        tokens: estimateTokens(r.content),
        origin: 'demo',
        confidence: 'high',
        enabled: true,
        review_status: 'approved',
        created_at: now,
        updated_at: now,
      });
    }

    const demoSkills = [
      {
        id: 'gateway-incident-triage-sop',
        name: 'gateway-incident-triage-sop',
        title: 'API Gateway Latency, Redirect Loop & Cache Stampede Triage SOP',
        l0_summary: 'Deterministic 4-step triage playbook for 308 redirect loops, singleflight cache poisoning, and p99 spikes.',
        trigger_cue: 'When diagnosing 308 redirect loops, 502 bursts after upstream timeouts, or p99 gateway latency spikes',
        tags: ['gateway', 'triage', 'cache', 'routing'],
        l1_contract: [
          '- **Trigger**: Elevated 308 redirect counts on `/`, sustained 502 responses after a transient upstream blip, or sudden p99 latency spikes.',
          '- **Inputs**: Gateway access logs, route normalization unit tests, in-flight cache metrics, and upstream timeout counters.',
          '- **Outputs**: Root-cause isolation across router canonicalization, promise deduplication cleanup, and config loader resilience, plus regression tests.',
        ].join('\n'),
        l2_sop: [
          '1. **Stage 1 — Route Canonicalization & Redirect Loop Check**:',
          '   - Inspect `src/router.ts#normalizeRoutePath` and `src/router.ts#dispatchRequest` for root `"/"` handling before regex slash stripping.',
          '   - Verify `normalizeRoutePath("/") === "/"` and `normalizeRoutePath("///") === "/"` without emitting self-referential `Location: /` 308 headers.',
          '   - Confirm uppercase method normalization runs before route-key composition so lowercase HTTP/2 pseudo-method adapters never miss route entries.',
          '2. **Stage 2 — In-Flight Cache Promise Lifecycle Audit**:',
          '   - Inspect `src/cache.ts#getOrLoadCached` to verify `.finally(() => inflight.delete(key))` is attached prior to storing the promise in the deduplication `Map`.',
          '   - Simulate a rejected upstream loader promise followed by a healthy retry and assert the second call invokes the loader cleanly rather than replaying the cached rejection.',
          '   - Check connection-pool concurrency limits and upstream `AbortSignal.timeout(...)` propagation across all read-through loaders.',
          '3. **Stage 3 — Cross-Platform Config & Payload Sanitation**:',
          '   - Inspect `src/validator.ts#parseJsonConfig` for leading UTF-8 BOM (`0xFEFF`) stripping and strict non-array plain-object root validation.',
          '   - Test malformed inputs (`""`, `"[]"`, `"null"`, `"\\uFEFF{\\"port\\":8080}"`) to guarantee deterministic fail-closed error messages.',
          '4. **Stage 4 — Post-Fix AST Memory Crystallization**:',
          '   - Run full regression suite, verify 0 unhandled rejections, and record symbol-anchored troubleshooting memories so future sessions recall live `file:line` guards automatically.',
        ].join('\n'),
      },
      {
        id: 'zero-downtime-config-rollout-sop',
        name: 'zero-downtime-config-rollout-sop',
        title: 'Zero-Downtime Gateway Config Validation & Canary Rollout Playbook',
        l0_summary: 'Pre-flight BOM/schema validation, atomic reload swap, and canary rollback checklist for gateway configs.',
        trigger_cue: 'When modifying gateway configuration schemas, hot-reload parsers, or deployment rollout scripts',
        tags: ['config', 'deployment', 'validation', 'canary'],
        l1_contract: [
          '- **Trigger**: Modifying configuration parsers, environment overrides, or hot-reload state transitions.',
          '- **Inputs**: Candidate JSON/TOML config artifacts, schema invariants, and canary error-budget thresholds.',
          '- **Outputs**: Validated atomic config swap with lossless fallback to last-known-good snapshot on parse or schema failure.',
        ].join('\n'),
        l2_sop: [
          '1. **Pre-Flight Encoding & Structural Verification**:',
          '   - Strip leading `0xFEFF` UTF-8 BOM bytes produced by Windows editors before invoking strict parsers.',
          '   - Reject primitive, `null`, or top-level array roots (`Array.isArray(parsed)`) before mutating active runtime state.',
          '   - Validate port ranges (`1..65535`), positive timeout budgets, and upstream URL schemes (`https:` / internal `http:`).',
          '2. **Atomic Snapshot Swap & Hot-Reload Isolation**:',
          '   - Construct and freeze the complete next-generation configuration graph off-thread before swapping the active pointer.',
          '   - Never partially mutate live routing tables or active middleware arrays in place; if any validator throws, retain the previous snapshot untouched.',
          '3. **Canary Telemetry & Deterministic Rollback**:',
          '   - Monitor 5xx rate, 308 redirect ratio, and in-flight cache map size for 60 seconds post-reload.',
          '   - Automatically revert to the pinned last-known-good snapshot and emit a structured diagnostic event if error thresholds trip.',
        ].join('\n'),
      },
    ];

    for (const sk of demoSkills) {
      storage.saveSkill({
        ...sk,
        origin: 'demo',
        confidence: 'high',
        enabled: true,
        review_status: 'approved',
        created_at: now,
        updated_at: now,
      });
    }

    const headCommit = resolveCurrentGitCommit(demoWs);
    const headBranch = resolveCurrentGitBranch(demoWs) || 'main';

    const demoMemories = [
      {
        id: 'router-trailing-slash-redirect-loop',
        title: 'Trailing slash normalization infinite redirect on root "/" route',
        l0_summary: 'Root "/" route stripped to empty string -> 308 redirect loop -> guard "/" before trimming slashes.',
        symptom:
          'GET / entered an infinite 308 Permanent Redirect loop in production health checks whenever trailing-slash canonicalization middleware executed before route table dispatch.',
        root_cause:
          'Unconditional `rawPath.replace(/^\\/+|\\/+$/g, "")` stripped `"/"` down to `""`, causing canonicalization middleware to see a mismatch (`"" !== "/"`) and re-emit `Location: /` on every request.',
        solution:
          'Guard empty and root paths (`if (!trimmed || trimmed === "/") return "/";`) before stripping leading/trailing slashes in `normalizeRoutePath`, then prefix a single `"/"` and assert idempotency in unit tests.',
        target_symbols: ['src/router.ts#normalizeRoutePath', 'src/router.ts#dispatchRequest'],
        tags: ['routing', 'http', 'redirect'],
      },
      {
        id: 'cache-rejected-promise-poisoning',
        title: 'Transient upstream failure permanently poisoned in-flight cache map',
        l0_summary: 'Rejected loader promise stayed in inflight Map -> permanent 502s -> delete key in .finally().',
        symptom:
          'Following a single 2-second upstream database blip, every subsequent request for the affected tenant key failed in 0ms with the stale timeout error until process restart.',
        root_cause:
          '`inflight.delete(key)` ran only inside `.then(...)` on the happy path; when `loader()` rejected, the rejected Promise remained permanently cached inside `inflight` Map.',
        solution:
          'Attach `.finally(() => inflight.delete(key))` to the loader promise before inserting into `inflight` so both resolved and rejected executions evict deterministically.',
        target_symbols: ['src/cache.ts#getOrLoadCached'],
        tags: ['cache', 'concurrency', 'resilience'],
      },
      {
        id: 'windows-bom-json-parse-crash',
        title: 'JSON.parse SyntaxError on UTF-8 BOM configuration files',
        l0_summary: 'Notepad/PowerShell UTF-8 BOM (0xFEFF) -> Unexpected token at position 0 -> strip leading 0xFEFF first.',
        symptom:
          'Valid gateway JSON configuration files saved via Windows editors or PowerShell 5.1 crashed startup with `SyntaxError: Unexpected token \\uFEFF in JSON at position 0`.',
        root_cause:
          'ECMA-404 / V8 `JSON.parse` does not treat a leading UTF-8 Byte Order Mark (`0xFEFF`) as whitespace, and array roots (`[]`) bypassed `typeof parsed === "object"` checks.',
        solution:
          'Check `rawInput.charCodeAt(0) === 0xfeff ? rawInput.slice(1) : rawInput` before `JSON.parse`, and reject null or `Array.isArray(parsed)` roots with a clear error.',
        target_symbols: ['src/validator.ts#parseJsonConfig'],
        tags: ['json', 'bom', 'cross-platform'],
      },
      {
        id: 'dispatcher-lowercase-http2-method-miss',
        title: 'Lowercase HTTP verb from adapter missed uppercase route table entries',
        l0_summary: 'Lowercase "get"/"post" verb -> 404 route miss -> canonicalize method.toUpperCase() in dispatchRequest.',
        symptom:
          'Requests forwarded from internal HTTP/2 test harnesses passed lowercase `"get"` verbs and received spurious 404 misses despite matching path routes.',
        root_cause:
          '`dispatchRequest` concatenated `method` verbatim with the normalized route path while route keys were registered in uppercase (`GET /v1/items`).',
        solution:
          'Canonicalize `method.toUpperCase()` inside `dispatchRequest` alongside `normalizeRoutePath(rawPath)` so route lookup keys are case-invariant.',
        target_symbols: ['src/router.ts#dispatchRequest'],
        tags: ['routing', 'http2', 'normalization'],
      },
      {
        id: 'hmac-timingsafeequal-buffer-length-crash',
        title: 'crypto.timingSafeEqual RangeError on truncated or odd-length hex webhook signatures',
        l0_summary: 'Truncated/malformed X-Signature hex -> Buffer byte length mismatch -> RangeError 500 -> pre-check hex & byte lengths.',
        symptom:
          'Malformed external webhook requests carrying truncated or non-hex `X-Hub-Signature-256` headers threw uncaught `RangeError: Input buffers must have the same byte length` (HTTP 500 instead of 401).',
        root_cause:
          '`Buffer.from(input, "hex")` silently truncates at the first non-hex character, producing shorter byte buffers than the 32-byte SHA-256 digest expected by `crypto.timingSafeEqual(a, b)`.',
        solution:
          'Verify non-empty even hex string length equality first and assert `bufA.length > 0 && bufA.length === bufB.length` immediately before invoking `timingSafeEqual(bufA, bufB)`.',
        target_symbols: ['src/auth.ts#verifyWebhookSignature'],
        tags: ['security', 'crypto', 'webhook', 'hmac'],
      },
      {
        id: 'ntp-clock-step-negative-token-bucket-drain',
        title: 'Backward NTP clock adjustment drained rate-limiter token buckets into negative balance',
        l0_summary: 'Backward wall-clock step -> negative elapsedMs -> tokens subtracted on refill -> clamp Math.max(0, delta) and monotonic timestamp.',
        symptom:
          'During a 450ms backward NTP step on edge worker nodes, active tenants were abruptly throttled with HTTP 429 despite low request volume.',
        root_cause:
          '`(nowMs - bucket.lastRefillMs) / 1000` evaluated negative when `Date.now()` stepped backward, subtracting tokens from `bucket.tokens` and resetting `lastRefillMs` backward.',
        solution:
          'Clamp `elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000)` and advance `bucket.lastRefillMs = Math.max(bucket.lastRefillMs, nowMs)` monotonically.',
        target_symbols: ['src/ratelimit.ts#consumeTokenBucket'],
        tags: ['ratelimit', 'clock-skew', 'resilience'],
      },
      {
        id: 'router-double-slash-prefix-collapse-mismatch',
        title: 'Consecutive internal path slashes bypassed ACL prefix matchers on gateway routes',
        l0_summary: 'Repeated slashes "/admin//users" -> ACL prefix mismatch vs downstream collapse -> normalize internal segments consistently.',
        symptom:
          'Requests formatted as `GET //v1/admin///audit` bypassed prefix-based edge middleware checks that inspected unnormalized paths while downstream handlers collapsed repeated slashes.',
        root_cause:
          'Edge middleware evaluated raw URL prefixes prior to `normalizeRoutePath`, creating a path-interpretation discrepancy between gateway policy checks and upstream route dispatch.',
        solution:
          'Execute `normalizeRoutePath(rawPath)` once at the ingress boundary inside `dispatchRequest` and pass only the canonicalized route token to both policy verifiers and upstream dispatchers. Verify `"///"`, `" /v1/items/ "`, and `""` all canonicalize deterministically before ACL evaluation.',
        target_symbols: ['src/router.ts#normalizeRoutePath', 'src/router.ts#dispatchRequest'],
        tags: ['security', 'routing', 'canonicalization', 'acl'],
      },
      {
        id: 'cache-synchronous-loader-throw-unhandled',
        title: 'Synchronous exception inside cache loader bypassed Promise.finally cleanup',
        l0_summary: 'Sync throw before async boundary in loader() -> uncaught throw before inflight.set -> wrap with Promise.try / async IIFE.',
        symptom:
          'When a serialization helper inside `loader()` threw synchronously on invalid tenant metadata, callers observed inconsistent stack traces and telemetry counters missed the failed load.',
        root_cause:
          'Invoking `loader().finally(...)` directly assumes `loader` always returns a Promise; a synchronous throw escapes before `.finally()` attaches if the callback is not `async`.',
        solution:
          'Ensure upstream loaders passed into `getOrLoadCached` are `async` functions or wrapped via `Promise.resolve().then(loader)` so synchronous throws convert cleanly into rejected Promises handled uniformly by `.finally(() => inflight.delete(key))`.',
        target_symbols: ['src/cache.ts#getOrLoadCached'],
        tags: ['cache', 'promises', 'error-handling'],
      },
      {
        id: 'validator-json-array-and-primitive-root-bypass',
        title: 'Top-level JSON array and null payloads passed naive typeof object config check',
        l0_summary: 'JSON.parse("[]") or "null" -> typeof === "object" true -> downstream key lookup bug -> guard !parsed || Array.isArray(parsed).',
        symptom:
          'Submitting `[]` or `null` as a gateway override file passed initial `typeof parsed === "object"` validation and silently disabled all route rules instead of failing closed.',
        root_cause:
          'In JavaScript, both `typeof null === "object"` and `typeof [] === "object"` evaluate to `true`, allowing non-dictionary roots through naive type guards.',
        solution:
          'Enforce `!parsed || typeof parsed !== "object" || Array.isArray(parsed)` immediately after `JSON.parse(clean)` in `parseJsonConfig`, throwing a deterministic `Expected top-level JSON object` error before touching active runtime state.',
        target_symbols: ['src/validator.ts#parseJsonConfig'],
        tags: ['validation', 'json', 'typescript', 'fail-closed'],
      },
      {
        id: 'auth-non-hex-silent-truncation-zero-buffer',
        title: 'Non-hex signature header decoded to empty 0-byte Buffer in Node Buffer.from("hex")',
        l0_summary: 'Buffer.from("zzzz...", "hex") -> returns 0-byte Buffer silently -> guard bufA.length > 0 && bufA.length === bufB.length.',
        symptom:
          'Fuzz testing `verifyWebhookSignature` with 64-character non-hex strings (`"g".repeat(64)`) produced 0-byte buffers despite passing string-length equality checks.',
        root_cause:
          'Node.js `Buffer.from(str, "hex")` stops decoding at the first invalid hex character without throwing an exception; if character 0 is non-hex, it returns `Buffer.alloc(0)`.',
        solution:
          'Check both even string-length equality AND post-decode `bufA.length === 0 || bufA.length !== bufB.length` (or `/^[0-9a-f]+$/`) in `verifyWebhookSignature` prior to `timingSafeEqual(bufA, bufB)` so corrupt hex inputs always return `false` safely.',
        target_symbols: ['src/auth.ts#verifyWebhookSignature'],
        tags: ['security', 'crypto', 'buffer', 'fuzzing'],
      },
      {
        id: 'ratelimit-burst-overflow-after-idle-window',
        title: 'Idle tenant accumulated unbounded token credits exceeding configured burst capacity',
        l0_summary: 'Long idle elapsedSec * ratePerSec -> unbounded token accumulation -> traffic spike bypass -> clamp Math.min(burstCapacity, ...).',
        symptom:
          'Tenants idle for 2 hours were able to send 72,000 instantaneous requests in 1 second, overwhelming downstream PostgreSQL connection pools despite a 100-request burst cap.',
        root_cause:
          'Refill math added `elapsedSec * ratePerSec` directly to `bucket.tokens` without clamping the resulting balance to `burstCapacity`.',
        solution:
          'Clamp refilled balance via `bucket.tokens = Math.min(burstCapacity, bucket.tokens + elapsedSec * ratePerSec)` inside `consumeTokenBucket` before checking `bucket.tokens < 1` and decrementing.',
        target_symbols: ['src/ratelimit.ts#consumeTokenBucket'],
        tags: ['ratelimit', 'postgres', 'burst-control', 'stability'],
      },
      {
        id: 'auth-whitespace-padded-header-false-401',
        title: 'Proxied X-Signature headers with trailing OWS whitespace failed hex length verification',
        l0_summary: 'Reverse proxy appended trailing space to signature header -> length mismatch 401 -> trim() and toLowerCase() before compare.',
        symptom:
          'Valid partner webhooks routed through legacy HTTP/1.1 edge proxies intermittently failed signature verification with HTTP 401 despite valid HMAC digests.',
        root_cause:
          'RFC 9110 optional whitespace (OWS) preserved at the end of custom header values caused `expectedHex.length !== receivedHex.length` to reject before hex decoding.',
        solution:
          'Normalize both `expectedHex.trim().toLowerCase()` and `receivedHex.trim().toLowerCase()` at entry to `verifyWebhookSignature` prior to length and `Buffer.from(..., "hex")` checks.',
        target_symbols: ['src/auth.ts#verifyWebhookSignature'],
        tags: ['http', 'headers', 'auth', 'interoperability'],
      },
    ];

    // Also include external-tools schema cache for the 8 pooled MCP servers matching benchmark 14,700 tok + rich gateway SOPs
    const extraRunbooks = [
      {
        id: 'webhook-crypto-and-auth-audit-sop',
        name: 'webhook-crypto-and-auth-audit-sop',
        title: 'Webhook HMAC Verification, Key Rotation & Constant-Time Auth Audit Playbook',
        l0_summary: 'Security verification SOP for constant-time HMAC comparison, dual-key rotation windows, and replay protection.',
        trigger_cue: 'When touching webhook signature verifiers, API key middleware, or OAuth/JWKS token validators',
        tags: ['security', 'auth', 'hmac', 'audit'],
        l1_contract: [
          '- **Trigger**: Auditing or modifying `src/auth.ts`, signature headers, secret rotation windows, or replay-timestamp guards.',
          '- **Inputs**: Raw HTTP payload bytes (pre-JSON re-serialization), signature header strings, and active/previous signing secrets.',
          '- **Outputs**: Constant-time signature verification free of `RangeError` crashes, hex-truncation bypasses, and body-reformatting mismatches.',
        ].join('\n'),
        l2_sop: [
          '1. **Raw Byte Payload Preservation**:',
          '   - Compute HMAC-SHA256 digests strictly over the exact raw request `Buffer` received off the socket, never over `JSON.stringify(req.body)` which alters whitespace, key order, and unicode escapes.',
          '   - Enforce an explicit maximum body byte limit prior to buffering to prevent memory exhaustion on unauthenticated endpoints.',
          '2. **Buffer Length & Encoding Pre-Validation (`verifyWebhookSignature`)**:',
          '   - Normalize case and strip algorithm prefixes (`sha256=`) deterministically before length comparison.',
          '   - Reject empty strings, odd character counts, and unequal string lengths before `Buffer.from(..., "hex")`.',
          '   - Re-verify `bufA.length > 0 && bufA.length === bufB.length` because Node.js `Buffer.from("zz", "hex")` returns a 0-byte buffer without throwing, which would otherwise crash `timingSafeEqual` or trivially match two empty buffers!',
          '3. **Dual-Secret Zero-Downtime Key Rotation**:',
          '   - Evaluate both `[primarySecret, retiringSecret]` using constant-time accumulator logic without short-circuiting timing side channels during secret rotation windows.',
          '   - Pair signature checks with a bounded timestamp tolerance window (`±300s`) and short-TTL nonce deduplication cache to block replay attacks.',
          '4. **Negative-Path Fuzz & Regression Matrix**:',
          '   - Explicitly test `""`, `"sha256="`, odd-length hex, non-hex ASCII (`"zzzz..."` matching expected string length), all-zero digests, and single-bit flipped signatures, asserting clean `false` returns (HTTP 401) and zero uncaught `RangeError` exceptions.',
        ].join('\n'),
      },
      {
        id: 'distributed-rate-limit-and-backpressure-sop',
        name: 'distributed-rate-limit-and-backpressure-sop',
        title: 'Token-Bucket Rate Limiting, Monotonic Clock Safety & Load-Shedding SOP',
        l0_summary: 'Engineering checklist for monotonic token-bucket math, retry-after headers, and multi-tier load shedding.',
        trigger_cue: 'When implementing rate limiters, concurrency semaphores, retry budgets, or load-shedding middleware',
        tags: ['ratelimit', 'backpressure', 'reliability', 'performance'],
        l1_contract: [
          '- **Trigger**: Modifying `src/ratelimit.ts`, tenant quota enforcement, upstream retry budgets, or overload shedding.',
          '- **Inputs**: Tenant burst/sustained rate configs, monotonic/wall-clock timestamps, and downstream queue depth.',
          '- **Outputs**: Clock-skew-immune token-bucket accounting, RFC-compliant `Retry-After` headers, and bounded tail latency under overload.',
        ].join('\n'),
        l2_sop: [
          '1. **Monotonic Elapsed-Time Accounting (`consumeTokenBucket`)**:',
          '   - Prefer `performance.now()` monotonic deltas in single-process limiters, and always clamp `Math.max(0, nowMs - bucket.lastRefillMs)` when consuming externally supplied or persisted epoch timestamps.',
          '   - Guard against `NaN`, `Infinity`, and zero/negative `ratePerSec` or `burstCapacity` values before updating bucket state so a single bad config entry never corrupts tenant state.',
          '   - Advance `lastRefillMs = Math.max(bucket.lastRefillMs, nowMs)` so backward NTP steps neither drain tokens nor double-grant refill credits after clock recovery.',
          '2. **Memory Bounds & Idle Bucket Eviction**:',
          '   - Bound per-worker tenant map cardinality with LRU/TTL eviction for buckets that have refilled to full `burstCapacity` to prevent unbounded heap growth under spoofed IP/API-key scans.',
          '3. **Retry-Storm Prevention & Load Shedding**:',
          '   - Emit deterministic `Retry-After` and `X-RateLimit-Reset` headers with jitter guidance so well-behaved SDKs back off without synchronized thundering herds.',
          '   - Shed non-critical background/batch traffic before interactive user traffic when upstream in-flight concurrency crosses 80% saturation.',
        ].join('\n'),
      },
      {
        id: 'upstream-resilience-and-circuit-breaking-sop',
        name: 'upstream-resilience-and-circuit-breaking-sop',
        title: 'Upstream Timeout Budgets, Singleflight Coalescing & Half-Open Circuit Recovery SOP',
        l0_summary: 'Playbook for per-hop deadline propagation, singleflight error eviction, and half-open circuit breaker probes.',
        trigger_cue: 'When debugging cascading 502/504 timeouts, connection pool starvation, or upstream retry amplification',
        tags: ['resilience', 'circuit-breaker', 'cache', 'timeouts'],
        l1_contract: [
          '- **Trigger**: Designing or troubleshooting upstream HTTP/database clients, read-through caches (`src/cache.ts`), or retry policies.',
          '- **Inputs**: End-to-end SLA budget, per-hop p99 latency distributions, connection pool sizing, and idempotency classifications.',
          '- **Outputs**: Bounded retry amplification, poison-free in-flight promise coalescing, and deterministic half-open recovery.',
        ].join('\n'),
        l2_sop: [
          '1. **Per-Hop Deadline Budgets & Cancellation**:',
          '   - Propagate remaining request deadline (`deadlineMs - Date.now()`) via `AbortSignal` to every downstream socket read; never issue an upstream call whose timeout exceeds the caller SLA.',
          '   - Restrict automatic retries strictly to idempotent verbs (`GET`, `HEAD`, `OPTIONS`, or requests with an explicit `Idempotency-Key`) with capped exponential backoff + full jitter.',
          '2. **Singleflight Coalescing Hygiene (`getOrLoadCached`)**:',
          '   - Register `.finally(() => inflight.delete(key))` unconditionally before inserting into the in-flight map so rejected promises never wedge subsequent callers.',
          '   - Clone mutable response payloads or freeze cached objects so one consumer mutating a parsed object cannot corrupt concurrent readers sharing the coalesced promise.',
          '3. **Circuit Breaker State Machine**:',
          '   - Trip from `CLOSED` to `OPEN` only after minimum sample volume (`>= 20` requests in rolling 10s window) exceeds failure threshold, avoiding false trips on low-QPS routes.',
          '   - In `HALF_OPEN`, admit exactly 1 probe request at a time before restoring full traffic.',
        ].join('\n'),
      },
      {
        id: 'database-pool-and-migration-safety-sop',
        name: 'database-pool-and-migration-safety-sop',
        title: 'PostgreSQL Connection Pool Sizing, Statement Timeouts & Expand-Contract Migration SOP',
        l0_summary: 'Zero-lock DDL checklist, statement_timeout guards, and transaction pooler prepared-statement hygiene.',
        trigger_cue: 'When writing SQL migrations, configuring PostgreSQL connection pools, or diagnosing lock-queue stalls',
        tags: ['postgres', 'database', 'migrations', 'reliability'],
        l1_contract: [
          '- **Trigger**: Adding schema migrations, tuning pool sizes, or investigating elevated query wait times on gateway backing stores.',
          '- **Inputs**: Target table cardinality, PgBouncer transaction-pooling mode, lock-timeout budgets, and rollback compatibility.',
          '- **Outputs**: Online lock-safe schema evolution and bounded connection utilization without prepared-statement collisions.',
        ].join('\n'),
        l2_sop: [
          '1. **Online Zero-Lock DDL Execution**:',
          '   - Always set a short `SET LOCAL lock_timeout = \'2s\'` and `SET LOCAL statement_timeout = \'30s\'` on migration sessions so a blocked `ALTER TABLE` fails fast instead of queuing every incoming read/write behind an `AccessExclusiveLock`.',
          '   - Build new indexes with `CREATE INDEX CONCURRENTLY` outside explicit transaction blocks and validate `indisvalid = true` post-creation.',
          '   - Enforce two-phase `CHECK (... ) NOT VALID` followed by `VALIDATE CONSTRAINT` when adding constraints to multi-million-row tables.',
          '2. **Expand-Contract Multi-Release Compatibility**:',
          '   - Phase 1 (Expand): Add nullable columns or dual-write triggers while current application pods still run the old query projection (`SELECT col_a, col_b`, never `SELECT *`).',
          '   - Phase 2 (Backfill): Batch-update historical rows in bounded keyset chunks (`WHERE id > $1 ORDER BY id LIMIT 1000`) with inter-batch throttling.',
          '   - Phase 3 (Contract): Drop deprecated columns only after 100% of active application workers have rolled forward past the dual-read release.',
          '3. **Connection Pool & PgBouncer Transaction Mode**:',
          '   - Disable unnamed protocol-level prepared statements or enable PgBouncer >= 1.21 `max_prepared_statements` when running in transaction pooling mode to avoid `prepared statement does not exist` errors.',
          '   - Always release pooled clients inside `try { ... } finally { client.release(); }` and enforce idle-in-transaction timeouts (`idle_in_transaction_session_timeout = 10000`).',
        ].join('\n'),
      },
      {
        id: 'observability-trace-context-and-pii-redaction-sop',
        name: 'observability-trace-context-and-pii-redaction-sop',
        title: 'W3C Trace-Context Propagation, Structured Log Redaction & High-Cardinality Metric Guard SOP',
        l0_summary: 'Standardizes W3C traceparent forwarding, structured PII/secret scrubbing, and bounded metric label cardinality.',
        trigger_cue: 'When instrumenting HTTP handlers, structured loggers, OpenTelemetry spans, or Prometheus counters',
        tags: ['observability', 'security', 'logging', 'tracing'],
        l1_contract: [
          '- **Trigger**: Adding request logging, error serialization, distributed trace headers, or Prometheus/OTel metrics.',
          '- **Inputs**: Incoming `traceparent`/`tracestate` headers, canonical route templates, and redaction allowlists.',
          '- **Outputs**: Correlated end-to-end traces, zero credential/PII log leaks, and constant-cardinality metric series.',
        ].join('\n'),
        l2_sop: [
          '1. **Bounded Metric Label Cardinality**:',
          '   - Label HTTP metrics strictly by normalized route template (`/v1/tenants/:id/items`), HTTP verb, and status class (`2xx`/`4xx`/`5xx`) — NEVER by raw `req.url`, tenant ID, user email, or dynamic UUIDs.',
          '   - Cap unknown 404 path labels to a single constant `route="UNMATCHED"` bucket so internet path scanners cannot explode TSDB memory.',
          '2. **Deterministic Secret & PII Redaction**:',
          '   - Scrub `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `X-Hub-Signature-256`, and bearer/PAT substrings (`ghp_`, `sk-`, `AKIA`) at the serializer layer prior to formatting JSON log lines.',
          '   - Serialize `Error` instances with explicit `{ name, message, code, status }` projections rather than dumping raw axios/fetch request config objects that embed upstream credentials.',
          '3. **W3C Trace Context Continuity**:',
          '   - Validate incoming `traceparent` version/trace-id/parent-id hex format before propagation; generate a fresh root span ID when malformed while recording a `malformed_traceparent` counter.',
          '   - Propagate correlation IDs across async timer/queue boundaries and include `trace_id` in structured 4xx/5xx error envelopes returned to callers.',
        ].join('\n'),
      },
      {
        id: 'http-header-smuggling-and-ssrf-egress-sop',
        name: 'http-header-smuggling-and-ssrf-egress-sop',
        title: 'HTTP Hop-by-Hop Header Stripping, CRLF Injection Defense & SSRF Egress Guard SOP',
        l0_summary: 'Edge security checklist for stripping hop-by-hop headers, blocking CRLF smuggling, and pinning DNS on webhooks.',
        trigger_cue: 'When implementing reverse-proxy header forwarding, webhook delivery workers, or dynamic upstream URLs',
        tags: ['security', 'http', 'proxy', 'ssrf'],
        l1_contract: [
          '- **Trigger**: Forwarding client headers to upstream services or dispatching outbound webhook callbacks to user-configured URLs.',
          '- **Inputs**: Inbound header maps, `Connection` header token lists, and outbound target URLs / resolved DNS records.',
          '- **Outputs**: Desync-resistant proxy framing and SSRF-safe egress sockets blocked from RFC1918/link-local metadata IPs.',
        ].join('\n'),
        l2_sop: [
          '1. **Hop-by-Hop & `Connection` Token Stripping**:',
          '   - Strip standard hop-by-hop headers (`Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`) AND dynamically strip any custom header name listed inside the inbound `Connection` header value.',
          '   - Overwrite `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Real-IP` from trusted socket peer metadata rather than trusting client-supplied spoofing headers.',
          '2. **Outbound Webhook SSRF & DNS-Rebinding Defense**:',
          '   - Parse outbound callback URLs strictly via WHATWG `new URL(target)` and allow only `https:` in production.',
          '   - Resolve DNS inside a custom socket `lookup` hook and reject loopback (`127.0.0.0/8`, `::1`), RFC1918 private ranges, CGNAT (`100.64.0.0/10`), and cloud metadata link-local addresses (`169.254.0.0/16`, `fe80::/10`) at connect time to defeat TOCTOU DNS rebinding.',
          '   - Disable automatic HTTP 301/302 redirect following on outbound webhook deliveries so an external endpoint cannot redirect into internal VPC addresses.',
        ].join('\n'),
      },
      {
        id: 'graceful-shutdown-inflight-drain-and-keepalive-sop',
        name: 'graceful-shutdown-inflight-drain-and-keepalive-sop',
        title: 'Zero-Downtime SIGTERM Drain, HTTP Keep-Alive Alignment & Worker Queue Lease Recovery SOP',
        l0_summary: 'Prevents 502 Bad Gateway race conditions during rolling Kubernetes/ECS deploys and drains in-flight requests cleanly.',
        trigger_cue: 'When configuring HTTP server timeouts, SIGTERM/SIGINT handlers, readiness probes, or background job consumers',
        tags: ['kubernetes', 'http', 'reliability', 'deploy'],
        l1_contract: [
          '- **Trigger**: Modifying Node/Go HTTP server lifecycle hooks, Kubernetes `preStop` / readiness probes, or queue consumer shutdown.',
          '- **Inputs**: Upstream ALB/Ingress idle timeout, pod `terminationGracePeriodSeconds`, and active socket/job registries.',
          '- **Outputs**: Zero 502 connection-reset errors during rolling deploys and clean lease release for unfinished background jobs.',
        ].join('\n'),
        l2_sop: [
          '1. **Keep-Alive Timeout Hierarchy (Defeating ALB/Envoy 502 Races)**:',
          '   - Always set application `server.keepAliveTimeout` strictly GREATER than the upstream load balancer / ingress `idle_timeout` (e.g., `65_000ms` behind a `60s` ALB/Envoy upstream), and set `server.headersTimeout = server.keepAliveTimeout + 5_000`.',
          '   - Never close idle keep-alive sockets simultaneously with an upstream proxy reusing the TCP connection.',
          '2. **Ordered `SIGTERM` Readiness & Drain Sequence**:',
          '   - Immediately flip `/readyz` to `503` on `SIGTERM` (plus a `3s–5s` grace delay before `server.close()` so kube-proxy / Envoy endpoint removal propagates across all nodes before refusing new TCP handshakes).',
          '   - Stop polling new queue messages, await in-flight HTTP requests and active worker promises up to `graceDeadline - 3_000ms`, then release visibility leases (`nack` / `changeMessageVisibility(0)`) for any job still incomplete.',
        ].join('\n'),
      },
      {
        id: 'transactional-outbox-and-dlq-replay-sop',
        name: 'transactional-outbox-and-dlq-replay-sop',
        title: 'Transactional Outbox Relay, At-Least-Once Consumer Idempotency & Safe DLQ Replay SOP',
        l0_summary: 'Eliminates dual-write split-brain between SQL commits and event brokers while keeping DLQ replays idempotent.',
        trigger_cue: 'When publishing domain events alongside SQL mutations, writing Kafka/SQS consumers, or building DLQ replay tools',
        tags: ['events', 'database', 'queue', 'idempotency'],
        l1_contract: [
          '- **Trigger**: Emitting async events/webhooks after database writes or handling retries and Dead-Letter Queue replays.',
          '- **Inputs**: Primary SQL transaction handle, deterministic `event_id` / `aggregate_version`, and consumer deduplication table.',
          '- **Outputs**: Atomic commit of state + outbox row, monotonic aggregate ordering, and side-effect-safe DLQ replay.',
        ].join('\n'),
        l2_sop: [
          '1. **Zero Dual-Write Outbox Commit**:',
          '   - Never call an external broker (`kafka.send`, `sqs.sendMessage`, `fetch`) inside or immediately after a DB commit without a durable outbox record; insert `(event_id, aggregate_id, sequence_no, payload, created_at)` in the exact same SQL transaction.',
          '   - Relay workers poll unpublished rows with `FOR UPDATE SKIP LOCKED LIMIT 100`, publish with deterministic partition key `aggregate_id`, and stamp `published_at` atomically.',
          '2. **Consumer Idempotency & Stale-Sequence Guard**:',
          '   - Consumers MUST insert `event_id` into `processed_events(event_id, processed_at)` (`ON CONFLICT DO NOTHING`) inside the target transaction and ignore out-of-order replays where `event.sequence_no <= entity.last_applied_seq`.',
          '   - DLQ replay scripts must preserve original `event_id` and `occurred_at` headers while incrementing `x-replay-count` rather than minting new event IDs that bypass consumer deduplication.',
        ].join('\n'),
      },
    ];

    for (const sk of extraRunbooks) {
      storage.saveSkill({
        ...sk,
        origin: 'demo',
        confidence: 'high',
        enabled: true,
        review_status: 'approved',
        created_at: now,
        updated_at: now,
      });
    }

    for (const m of demoMemories) {
      const { fingerprints } = buildFingerprintsForTargets(demoWs, m.target_symbols);
      storage.saveMemory({
        ...m,
        ast_fingerprints: fingerprints,
        created_commit: headCommit,
        created_branch: headBranch,
        origin: 'demo',
        confidence: 'high',
        enabled: true,
        review_status: 'approved',
        created_at: now,
        updated_at: now,
      });
    }

    const telemetry = new EvoTelemetry(storage);
    try {
      telemetry.syncFromDisk();

      for (const searchCap of [
        { id: 'router-trailing-slash-redirect-loop', kind: 'memory' },
        { id: 'cache-rejected-promise-poisoning', kind: 'memory' },
        { id: 'singleflight-cache-stampede-guard', kind: 'rule' },
        { id: 'config-bom-and-root-shape-guard', kind: 'rule' },
        { id: 'agy-config-auditor', kind: 'tool' },
        { id: 'deliverable-canonical-inspector', kind: 'tool' },
      ]) {
        telemetry.recordRecallEvent({
          eventType: 'search',
          capabilityId: searchCap.id,
          kind: searchCap.kind,
        });
      }
      telemetry.recordRecallEvent({
        eventType: 'inspect',
        capabilityId: 'router-trailing-slash-redirect-loop',
        kind: 'memory',
        tier: 'L2',
      });
      telemetry.recordRecallEvent({
        eventType: 'inspect',
        capabilityId: 'cache-rejected-promise-poisoning',
        kind: 'memory',
        tier: 'L2',
      });
      telemetry.recordRecallEvent({
        eventType: 'inspect',
        capabilityId: 'singleflight-cache-stampede-guard',
        kind: 'rule',
        tier: 'L2',
      });
      telemetry.recordRecallEvent({
        eventType: 'run',
        capabilityId: 'agy-config-auditor',
        kind: 'tool',
      });
      telemetry.recordRecallEvent({
        eventType: 'run',
        capabilityId: 'deliverable-canonical-inspector',
        kind: 'tool',
      });

      telemetry.recordUsage('router-trailing-slash-redirect-loop', true, 620);
      telemetry.recordUsage('router-trailing-slash-redirect-loop', true, 620);
      telemetry.recordUsage('cache-rejected-promise-poisoning', true, 480);
      telemetry.recordUsage('singleflight-cache-stampede-guard', true, 540);
      telemetry.recordUsage('agy-config-auditor', true, 1200);
      telemetry.recordUsage('deliverable-canonical-inspector', true, 950);

      telemetry.recordCapabilityOutcome('router-trailing-slash-redirect-loop', 'helped');
      telemetry.recordCapabilityOutcome('cache-rejected-promise-poisoning', 'helped');
      telemetry.recordCapabilityOutcome('singleflight-cache-stampede-guard', 'helped');
      telemetry.recordCapabilityOutcome('agy-config-auditor', 'helped');

      telemetry.recordGatekeeperEvent({
        kind: 'memory',
        targetId: 'router-trailing-slash-redirect-loop',
        targetName: 'Trailing slash normalization infinite redirect on root "/" route',
        passed: true,
        diagnostics: 'All 6 Gatekeeper stages passed (AST symbols 2/2 VERIFIED).',
      });
      telemetry.recordGatekeeperEvent({
        kind: 'rule',
        targetId: 'singleflight-cache-stampede-guard',
        targetName: 'Coalesce concurrent cache misses with an in-flight promise map',
        passed: true,
        diagnostics: 'Passed static security, lexical generalization, BM25 dedup, and 1,500-tok budget.',
      });
      telemetry.recordGatekeeperEvent({
        kind: 'tool',
        targetId: 'unsafe-hardcoded-script',
        targetName: 'Draft log parser with hardcoded developer path',
        passed: false,
        stageFailed: 'Gate 1: Static Security & Path Portability',
        diagnostics: 'ERR_HARDCODED_PATH: Detected non-portable user home path; read workspace from EVO_WORKSPACE.',
      });
    } finally {
      telemetry.close();
    }

    fs.mkdirSync(path.dirname(destHtmlPath), { recursive: true });
    exportUiHtml(demoWs, destHtmlPath, { anon: true });
  } finally {
    try {
      fs.rmSync(demoWs, { recursive: true, force: true });
    } catch {}
  }
}

function verifyArtifact(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const leakMatch = html.match(LEAK_REGEX);
  if (leakMatch) {
    throw new Error(`Security/Leak check failed in ${filePath}: matched "${leakMatch[0]}"`);
  }
  const personalMatch = html.match(PERSONAL_ID_REGEX);
  if (personalMatch) {
    throw new Error(`Local skill isolation check failed in ${filePath}: matched "${personalMatch[0]}"`);
  }
  const handlerMatch = html.match(INLINE_HANDLER_REGEX);
  if (handlerMatch) {
    throw new Error(`CSP inline-handler invariant failed in ${filePath}: matched "${handlerMatch[0]}"`);
  }
}

ensureBuilt();
const benchPayload = loadBenchmarkSsot();

fs.rmSync(publicDir, { recursive: true, force: true });
const publicAssetsDir = path.join(publicDir, 'assets');
fs.mkdirSync(demoDir, { recursive: true });
fs.mkdirSync(publicAssetsDir, { recursive: true });

const srcShowcasePng = path.join(repoRoot, 'assets', 'workbench-showcase.png');
const srcShowcaseSvg = path.join(repoRoot, 'assets', 'workbench-showcase.svg');
if (fs.existsSync(srcShowcasePng)) {
  fs.copyFileSync(srcShowcasePng, path.join(publicAssetsDir, 'workbench-showcase.png'));
}
if (fs.existsSync(srcShowcaseSvg)) {
  fs.copyFileSync(srcShowcaseSvg, path.join(publicAssetsDir, 'workbench-showcase.svg'));
}
const showcaseImgSrc = fs.existsSync(srcShowcasePng)
  ? './assets/workbench-showcase.png'
  : './assets/workbench-showcase.svg';

const landingPath = path.join(publicDir, 'index.html');
const demoPath = path.join(demoDir, 'index.html');

fs.writeFileSync(landingPath, renderLandingHtml(benchPayload, showcaseImgSrc), 'utf8');
await buildSyntheticDemoHtml(demoPath);

verifyArtifact(landingPath);
verifyArtifact(demoPath);
const publicShowcaseSvg = path.join(publicAssetsDir, 'workbench-showcase.svg');
if (fs.existsSync(publicShowcaseSvg)) {
  verifyArtifact(publicShowcaseSvg);
}

console.log(`Pages bundle built & verified:
  - Landing : ${path.relative(repoRoot, landingPath)} (showcase: ${showcaseImgSrc})
  - Demo    : ${path.relative(repoRoot, demoPath)}`);
