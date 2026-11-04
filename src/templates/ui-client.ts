export interface UiRenderOptions {
  token?: string;
  isExport?: boolean;
  anon?: boolean;
}

export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string {
  const isExport = Boolean(options.isExport);
  const token = options.token || '';
  const anon = Boolean(options.anon);

  // Inlined Snapshot JSON with safe entity escaping (\u003c for < and \u003d for =)
  const safeSnapshotJson = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/=/g, '\\u003d');

  const clientScript = `
(function() {
  var snapshot = ${safeSnapshotJson};
  var token = ${JSON.stringify(token)};
  var isExport = ${isExport ? 'true' : 'false'};
  var isAnon = ${anon ? 'true' : 'false'};
  var activeKindFilter = 'all';
  var searchQuery = '';
  var lang = 'en';

  var i18n = {
    en: {
      title: 'EvoKernel Cockpit',
      subtitle: 'Context Virtualization & AST-Anchored Cognitive Memory Telemetry',
      ctxTitle: 'Context Virtualization & 2D Token Budget Treemap',
      hsTitle: 'Fragile Git Hotspots & AST Shielding',
      constTitle: 'Interactive AST Memory & Symbol Topology Constellation',
      capsTitle: 'Evolved Capability Matrix (Rules, Skills, Tools, Memories)',
      gkTitle: 'Deterministic 4-Stage Gatekeeper Audit Stream',
      beforeTok: 'Before EvoKernel (Eager Load):',
      afterTok: 'After EvoKernel (Virtual Load):',
      savedTok: 'Net Prompt Tax Saved:',
      hostRules: 'Host Rules (Static / L0 Seed):',
      treemapHint: '2D Proportional Context Budget Treemap (Emerald: Virtualized 0 Idle Tax · Cyan: L0 Seed):',
      constHint: 'Click any node to inspect 16-hex AST symbol fingerprints & live topology callers'
    },
    zh: {
      title: 'EvoKernel 认知驾驶舱',
      subtitle: '上下文虚拟化与 AST 锚定认知记忆实时遥测',
      ctxTitle: '上下文虚拟化与 2D 预算矩阵树图 (Treemap)',
      hsTitle: 'Git 脆弱代码热点与 AST 记忆护栏覆盖',
      constTitle: '交互式 AST 认知记忆与符号拓扑星图 (Constellation)',
      capsTitle: '自演化能力矩阵 (规则 Rules / 技能 Skills / 微工具 Tools / 记忆 Memories)',
      gkTitle: '确定性四阶 Gatekeeper 门禁审计流',
      beforeTok: '接入前全量加载 (Eager Tax):',
      afterTok: '接入后按需虚拟化 (Virtual Load):',
      savedTok: '单轮净省 Prompt 税:',
      hostRules: '宿主规则 (静态 / L0 种子):',
      treemapHint: '2D 预算面积图 (翡翠绿: 已虚拟化折叠 0 常驻成本 · 冰川青: L0 种子):',
      constHint: '点击星图中的记忆或源码符号节点，即可透视 16 位 AST 哈希指纹与调用链'
    }
  };

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatKind(k) {
    if (!k) return '';
    if (k === 'memories' || k === 'memory') return 'MEMORY';
    return String(k).replace(/s$/, '').toUpperCase();
  }

  function applyI18n() {
    var dict = i18n[lang] || i18n.en;
    if (el('ui-main-title')) el('ui-main-title').textContent = dict.title;
    if (el('ui-sub-title')) el('ui-sub-title').textContent = dict.subtitle;
    if (el('hdr-ctx')) el('hdr-ctx').textContent = dict.ctxTitle;
    if (el('hdr-hs')) el('hdr-hs').textContent = dict.hsTitle;
    if (el('hdr-const')) el('hdr-const').textContent = dict.constTitle;
    if (el('hdr-caps')) el('hdr-caps').textContent = dict.capsTitle;
    if (el('hdr-gk')) el('hdr-gk').textContent = dict.gkTitle;
    if (el('lbl-before')) el('lbl-before').textContent = dict.beforeTok;
    if (el('lbl-after')) el('lbl-after').textContent = dict.afterTok;
    if (el('lbl-saved')) el('lbl-saved').textContent = dict.savedTok;
    if (el('lbl-rules')) el('lbl-rules').textContent = dict.hostRules;
    if (el('lbl-treemap')) el('lbl-treemap').textContent = dict.treemapHint;
    if (el('lbl-const-hint')) el('lbl-const-hint').textContent = dict.constHint;
  }

  function renderHero() {
    var score = snapshot.score || {};
    var savings = score.contextSavings || { beforeTokens: 0, afterTokens: 0, savedTokens: 0, savingsPercent: 0, userStaticRuleTokens: 0, evoSeedTokens: 0 };
    var caps = score.capabilities || {};
    var overall = score.overallScore || 0;
    var grade = score.grade || (overall >= 95 ? 'A+' : overall >= 85 ? 'A' : 'B');
    
    el('hero-score-val').textContent = overall + ' / 100';
    if (el('hero-grade-pill')) el('hero-grade-pill').textContent = 'GRADE ' + grade;
    if (el('kpi-grade-sub')) el('kpi-grade-sub').textContent = 'Grade ' + grade;
    el('hero-mode').textContent = (score.mode || 'project').toUpperCase();
    el('hero-ws').textContent = isAnon ? '<WORKSPACE>' : (score.workspaceRoot || '');
    el('hero-before-tok').textContent = (savings.beforeTokens || 0).toLocaleString() + ' tok';
    el('hero-after-tok').textContent = (savings.afterTokens || 0).toLocaleString() + ' tok';
    el('hero-saved-tok').textContent = (savings.savedTokens || 0).toLocaleString() + ' tok (-' + (savings.savingsPercent || 0) + '%)';
    if (el('kpi-saved-pct')) el('kpi-saved-pct').textContent = '-' + (savings.savingsPercent || 0) + '%';
    if (el('kpi-saved-detail')) el('kpi-saved-detail').textContent = (savings.afterTokens || 0).toLocaleString() + ' tok L0 vs ' + (savings.beforeTokens || 0).toLocaleString() + ' tok Eager';
    if (el('hero-static-tok')) el('hero-static-tok').textContent = (savings.userStaticRuleTokens || 0).toLocaleString();
    if (el('hero-seed-tok')) el('hero-seed-tok').textContent = (savings.evoSeedTokens || 0).toLocaleString();
    if (el('sub-cache-score')) el('sub-cache-score').textContent = (score.cacheShieldingScore !== undefined ? score.cacheShieldingScore : 100) + '%';
    if (el('sub-fragile-score')) el('sub-fragile-score').textContent = (score.fragileCodeScore !== undefined ? score.fragileCodeScore : 100) + '%';

    var verMem = caps.verifiedMemoriesCount !== undefined ? caps.verifiedMemoriesCount : ((snapshot.memories || []).length);
    var totMem = caps.memoriesCount !== undefined ? caps.memoriesCount : ((snapshot.memories || []).length);
    if (el('kpi-mem-val')) el('kpi-mem-val').textContent = verMem + ' / ' + totMem;

    var totHs = score.totalHotspots !== undefined ? score.totalHotspots : ((score.gitHotspots || []).length);
    var unprotHs = score.unprotectedHotspots !== undefined ? score.unprotectedHotspots : 0;
    var protHs = Math.max(0, totHs - unprotHs);
    if (el('kpi-hs-val')) el('kpi-hs-val').textContent = protHs + ' / ' + totHs;

    var gaugeArc = el('hero-gauge-arc');
    if (gaugeArc) {
      var circumference = 238.76;
      var offset = circumference - (Math.min(100, Math.max(0, overall)) / 100) * circumference;
      gaugeArc.setAttribute('stroke-dashoffset', String(offset.toFixed(1)));
    }
    
    // 2D Treemap Tiles
    var mcp = score.mcpTax || { servers: [] };
    var mcpContainer = el('mcp-treemap');
    mcpContainer.innerHTML = '';
    var uTok = savings.userStaticRuleTokens || 0;
    var sTok = savings.evoSeedTokens || 0;
    var virtRuleTok = Math.max(0, (caps.totalRuleTokens || 0) + (caps.skillsCount || 0) * 650 + (caps.toolsCount || 0) * 450);
    var virtMemTok = Math.max(0, (caps.memoriesCount || 0) * 400);

    var blocks = [];
    if (virtRuleTok > 0) {
      blocks.push({
        label: 'Virtualized L1/L2 Skills & Tools',
        tokens: virtRuleTok,
        cls: 'status-pooled',
        tag: 'VIRTUALIZED · 0 IDLE TAX'
      });
    }
    if (virtMemTok > 0) {
      blocks.push({
        label: 'AST Episodic Memories (' + (caps.memoriesCount || 0) + ')',
        tokens: virtMemTok,
        cls: 'status-memory-zero',
        tag: 'AST ANCHORED · 0 CORE TOK'
      });
    }
    (mcp.servers || []).forEach(function(s) {
      blocks.push({
        label: 'MCP: ' + s.name,
        tokens: s.estimatedTokens || 850,
        cls: s.status === 'pooled' ? 'status-pooled' : 'status-active',
        tag: s.status === 'pooled' ? 'POOLED MCP' : 'ACTIVE SCHEMA'
      });
    });
    if (sTok > 0) {
      blocks.push({
        label: 'L0 Meta-Rule Seed',
        tokens: sTok,
        cls: 'status-evo-seed',
        tag: 'L0 ALWAYS-ON SEED'
      });
    }
    if (uTok > 0) {
      blocks.push({
        label: 'User Static Rules',
        tokens: uTok,
        cls: 'status-user-rules',
        tag: 'HOST STATIC'
      });
    }

    var totalWeight = 0;
    blocks.forEach(function(b) { totalWeight += b.tokens; });
    totalWeight = totalWeight || 1;

    blocks.forEach(function(b) {
      var tile = document.createElement('div');
      tile.className = 'treemap-tile ' + b.cls;
      var pct = Math.max(14, Math.round((b.tokens / totalWeight) * 100));
      tile.style.flex = String(pct) + ' 1 ' + Math.max(130, pct * 2) + 'px';
      tile.title = b.label + ': ~' + b.tokens + ' tok (' + b.tag + ')';
      tile.innerHTML =
        '<div class="tm-top"><span class="mcp-name">' + esc(b.label) + '</span><span class="tm-tag">' + esc(b.tag) + '</span></div>' +
        '<div class="mcp-tok">~' + b.tokens.toLocaleString() + ' tok <span class="tm-pct">' + Math.round((b.tokens / totalWeight) * 100) + '%</span></div>';
      mcpContainer.appendChild(tile);
    });

    // Hotspots table
    var hsContainer = el('hotspots-body');
    hsContainer.innerHTML = '';
    (score.gitHotspots || []).slice(0, 8).forEach(function(h) {
      var row = document.createElement('tr');
      row.className = h.unprotected ? 'row-unprotected' : 'row-protected';
      var fname = esc(isAnon ? h.filePath.replace(/^.*[\\\\/]/, '') : h.filePath);
      row.innerHTML = 
        '<td class="hs-file">' + fname + '</td>' +
        '<td><span class="hs-score">' + h.fragilityScore + '</span> <span class="hs-dim">(' + h.fixRevertCommits + ' fixes)</span></td>' +
        '<td><span class="hs-anchor-pill">' + h.memoryCount + ' mem · ' + h.scopedRuleCount + ' rule</span></td>' +
        '<td><span class="tag ' + (h.unprotected ? 'tag-warn' : 'tag-ok') + '">' +
        (h.unprotected ? 'UNPROTECTED' : '● PROTECTED') + '</span></td>';
      hsContainer.appendChild(row);
    });
  }

  function renderConstellation() {
    var svg = el('constellation-svg');
    if (!svg) return;
    svg.innerHTML = '';
    var ns = 'http://www.w3.org/2000/svg';
    var cx = 460;
    var cy = 175;

    var defs = document.createElementNS(ns, 'defs');
    defs.innerHTML =
      '<radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#10b981" stop-opacity="0.28"/>' +
        '<stop offset="60%" stop-color="#38bdf8" stop-opacity="0.06"/>' +
        '<stop offset="100%" stop-color="#050608" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<filter id="nodeGlow" x="-40%" y="-40%" width="180%" height="180%">' +
        '<feGaussianBlur stdDeviation="3.5" result="blur"/>' +
        '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter>';
    svg.appendChild(defs);

    var bgGlow = document.createElementNS(ns, 'ellipse');
    bgGlow.setAttribute('cx', String(cx));
    bgGlow.setAttribute('cy', String(cy));
    bgGlow.setAttribute('rx', '340');
    bgGlow.setAttribute('ry', '155');
    bgGlow.setAttribute('fill', 'url(#hubGlow)');
    svg.appendChild(bgGlow);

    var memories = (snapshot.memories || []).slice(0, 12);
    var rules = (snapshot.rules || []).slice(0, 6);
    var fileMap = {};
    var fileNodes = [];

    memories.forEach(function(m, idx) {
      var angle = (idx / Math.max(1, memories.length)) * Math.PI * 2 - Math.PI / 2;
      m._x = cx + Math.cos(angle) * 145;
      m._y = cy + Math.sin(angle) * 94;

      var fps = m.ast_fingerprints || {};
      Object.keys(fps).forEach(function(k) {
        var fp = fps[k] || {};
        var fpath = fp.file_path || fp.file || '';
        if (fpath) {
          var shortF = isAnon ? fpath.replace(/^.*[\\\\/]/, '') : fpath;
          if (!fileMap[shortF] && fileNodes.length < 12) {
            fileMap[shortF] = { label: shortF, fullPath: fpath, mems: [] };
            fileNodes.push(fileMap[shortF]);
          }
          if (fileMap[shortF]) {
            fileMap[shortF].mems.push(m);
          }
        }
      });
    });

    fileNodes.forEach(function(fn, idx) {
      var angle = (idx / Math.max(1, fileNodes.length)) * Math.PI * 2 - Math.PI / 3;
      fn._x = cx + Math.cos(angle) * 335;
      fn._y = cy + Math.sin(angle) * 136;
    });

    rules.forEach(function(r, idx) {
      var angle = (idx / Math.max(1, rules.length)) * Math.PI * 2 + 0.25;
      r._x = cx + Math.cos(angle) * 235;
      r._y = cy + Math.sin(angle) * 116;
    });

    // Subtle orbital rings
    [145, 235, 335].forEach(function(rx, i) {
      var ry = i === 0 ? 94 : (i === 1 ? 116 : 136);
      var ell = document.createElementNS(ns, 'ellipse');
      ell.setAttribute('cx', String(cx));
      ell.setAttribute('cy', String(cy));
      ell.setAttribute('rx', String(rx));
      ell.setAttribute('ry', String(ry));
      ell.setAttribute('fill', 'none');
      ell.setAttribute('stroke', 'rgba(255,255,255,0.055)');
      ell.setAttribute('stroke-dasharray', '3 6');
      svg.appendChild(ell);
    });

    // Curved Bézier Edges: Core -> Memories
    memories.forEach(function(m) {
      var path = document.createElementNS(ns, 'path');
      var mx = (cx + m._x) / 2;
      var my = (cy + m._y) / 2 - 12;
      path.setAttribute('d', 'M ' + cx + ' ' + cy + ' Q ' + mx + ' ' + my + ' ' + m._x + ' ' + m._y);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(16, 185, 129, 0.32)');
      path.setAttribute('stroke-width', '1.25');
      svg.appendChild(path);
    });

    // Curved Bézier Edges: Memories -> AST Files
    fileNodes.forEach(function(fn) {
      fn.mems.forEach(function(m) {
        var path = document.createElementNS(ns, 'path');
        var qx = (m._x + fn._x) / 2;
        var qy = (m._y + fn._y) / 2 + 10;
        path.setAttribute('d', 'M ' + m._x + ' ' + m._y + ' Q ' + qx + ' ' + qy + ' ' + fn._x + ' ' + fn._y);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'rgba(56, 189, 248, 0.35)');
        path.setAttribute('stroke-width', '1.1');
        svg.appendChild(path);
      });
    });

    // Center Hub Node
    var hubG = document.createElementNS(ns, 'g');
    var hubCircle = document.createElementNS(ns, 'circle');
    hubCircle.setAttribute('cx', String(cx));
    hubCircle.setAttribute('cy', String(cy));
    hubCircle.setAttribute('r', '28');
    hubCircle.setAttribute('fill', '#071118');
    hubCircle.setAttribute('stroke', '#10b981');
    hubCircle.setAttribute('stroke-width', '2');
    hubCircle.setAttribute('filter', 'url(#nodeGlow)');
    hubG.appendChild(hubCircle);
    var hubTxt = document.createElementNS(ns, 'text');
    hubTxt.setAttribute('x', String(cx));
    hubTxt.setAttribute('y', String(cy + 3.5));
    hubTxt.setAttribute('text-anchor', 'middle');
    hubTxt.setAttribute('fill', '#ecfdf5');
    hubTxt.setAttribute('font-size', '9.5');
    hubTxt.setAttribute('font-weight', '700');
    hubTxt.setAttribute('letter-spacing', '0.04em');
    hubTxt.textContent = 'EVO KERNEL';
    hubG.appendChild(hubTxt);
    svg.appendChild(hubG);

    // Memory Nodes (Emerald)
    memories.forEach(function(m) {
      var g = document.createElementNS(ns, 'g');
      g.style.cursor = 'pointer';
      var status = (m.freshness && m.freshness.overall_status) || 'VERIFIED';
      var color = status === 'VERIFIED' ? '#10b981' : (status === 'STALE' ? '#f87171' : '#38bdf8');
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(m._x));
      c.setAttribute('cy', String(m._y));
      c.setAttribute('r', '7.5');
      c.setAttribute('fill', '#062c22');
      c.setAttribute('stroke', color);
      c.setAttribute('stroke-width', '2');
      c.setAttribute('filter', 'url(#nodeGlow)');
      g.appendChild(c);

      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(m._x));
      t.setAttribute('y', String(m._y - 12));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#d1fae5');
      t.setAttribute('font-size', '9.5');
      t.setAttribute('font-weight', '500');
      t.textContent = String(m.id || '').slice(0, 18);
      g.appendChild(t);
      g.addEventListener('click', function() { openDrawer('memories', m); });
      svg.appendChild(g);
    });

    // Rule Nodes (Silver-Cyan Diamond/Pill)
    rules.forEach(function(r) {
      var g = document.createElementNS(ns, 'g');
      g.style.cursor = 'pointer';
      var rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(r._x - 6));
      rect.setAttribute('y', String(r._y - 6));
      rect.setAttribute('width', '12');
      rect.setAttribute('height', '12');
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', '#0f172a');
      rect.setAttribute('stroke', '#94a3b8');
      rect.setAttribute('stroke-width', '1.6');
      g.appendChild(rect);

      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(r._x));
      t.setAttribute('y', String(r._y + 17));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#94a3b8');
      t.setAttribute('font-size', '9');
      t.textContent = String(r.id || '').slice(0, 15);
      g.appendChild(t);
      g.addEventListener('click', function() { openDrawer('rules', r); });
      svg.appendChild(g);
    });

    // AST File Nodes (Glacier Cyan)
    fileNodes.forEach(function(fn) {
      var g = document.createElementNS(ns, 'g');
      g.style.cursor = 'pointer';
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(fn._x));
      c.setAttribute('cy', String(fn._y));
      c.setAttribute('r', '6.5');
      c.setAttribute('fill', '#082f49');
      c.setAttribute('stroke', '#38bdf8');
      c.setAttribute('stroke-width', '1.8');
      c.setAttribute('filter', 'url(#nodeGlow)');
      g.appendChild(c);

      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(fn._x));
      t.setAttribute('y', String(fn._y - 11));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#bae6fd');
      t.setAttribute('font-size', '9.5');
      t.textContent = fn.label.length > 22 ? '…' + fn.label.slice(-21) : fn.label;
      g.appendChild(t);
      g.addEventListener('click', function() {
        if (fn.mems && fn.mems[0]) openDrawer('memories', fn.mems[0]);
      });
      svg.appendChild(g);
    });
  }

  function renderCapabilities() {
    var capsContainer = el('caps-list');
    capsContainer.innerHTML = '';
    var kinds = ['rules', 'skills', 'tools', 'memories'];
    var q = (searchQuery || '').toLowerCase().trim();
    kinds.forEach(function(k) {
      if (activeKindFilter !== 'all' && activeKindFilter !== k) return;
      var items = snapshot[k] || [];
      items.forEach(function(item) {
        var rawTitle = String(item.title || item.name || item.id || '');
        var rawSummary = String(item.l0_summary || item.description || '');
        var rawId = String(item.id || '');
        if (q && rawTitle.toLowerCase().indexOf(q) === -1 && rawSummary.toLowerCase().indexOf(q) === -1 && rawId.toLowerCase().indexOf(q) === -1) {
          return;
        }
        var card = document.createElement('div');
        card.className = 'cap-card cap-' + k;
        var title = esc(rawTitle);
        var summary = esc(rawSummary);
        var attr = esc(item.attribution || 'unverified');
        var hits = item.hit_count || 0;
        var fresh = (item.freshness && item.freshness.overall_status) || (k === 'memories' ? 'VERIFIED' : '');
        var freshBadge = fresh ? '<span class="badge fresh-' + esc(fresh.toLowerCase()) + '">● ' + esc(fresh) + '</span>' : '';
        var kindLabel = formatKind(k);
        card.innerHTML = 
          '<div class="cap-header">' +
            '<div class="cap-badges"><span class="cap-kind">' + kindLabel + '</span> ' +
            '<span class="badge attr-' + attr + '">' + attr + '</span> ' +
            (hits > 0 ? '<span class="cap-hits">' + hits + ' hits</span> ' : '') +
            freshBadge + '</div>' +
            '<span class="cap-id">' + esc(rawId) + '</span>' +
          '</div>' +
          '<div class="cap-title">' + title + '</div>' +
          '<div class="cap-summary">' + summary + '</div>';
        card.addEventListener('click', function() { openDrawer(k, item); });
        capsContainer.appendChild(card);
      });
    });
  }

  function openDrawer(kind, item) {
    el('drawer-title').textContent = '[' + formatKind(kind) + '] ' + item.id;
    var sections = [];
    sections.push('=== L0 Summary ===\\n' + (item.l0_summary || item.description || '(none)'));
    if (item.attribution || item.hit_count !== undefined) {
      sections.push('\\n=== Attribution & Telemetry ===\\nAttribution: ' + (item.attribution || 'unverified') + '\\nHit Count: ' + (item.hit_count || 0));
    }
    if (item.freshness) {
      var callers = (item.freshness.callers || []).join(', ') || 'none';
      sections.push('\\n=== Memory Freshness ===\\nStatus: ' + item.freshness.overall_status + '\\nLive Callers (' + ((item.freshness.callers || []).length) + '): ' + callers);
    }
    var detail = '';
    if (item.l1_contract || item.l2_sop) {
      detail = '=== L1 Contract ===\\n' + (item.l1_contract || '') + '\\n\\n=== L2 SOP ===\\n' + (item.l2_sop || '');
    } else if (item.symptom || item.solution) {
      detail = '=== Symptom ===\\n' + (item.symptom || '') + '\\n\\n=== Root Cause ===\\n' + (item.root_cause || '') + '\\n\\n=== Solution ===\\n' + (item.solution || '');
    } else if (item.content) {
      detail = '=== Content ===\\n' + item.content;
    } else if (item.script_code || item.entry_script) {
      detail = '=== Tool Entry ===\\nRuntime: ' + (item.runtime || 'node') + '\\nScript: ' + (item.entry_script || '') + (item.script_code ? '\\n\\n' + item.script_code : '');
    } else {
      detail = '=== Raw JSON ===\\n' + JSON.stringify(item, null, 2);
    }
    sections.push('\\n' + detail);
    el('drawer-content').textContent = sections.join('\\n');
    el('drawer').classList.add('open');
  }

  function closeDrawer() {
    el('drawer').classList.remove('open');
  }

  function renderGatekeeper() {
    var stream = el('gatekeeper-stream');
    stream.innerHTML = '';
    var events = snapshot.gatekeeperEvents || [];
    if (events.length === 0) {
      var emptyMsg = document.createElement('div');
      emptyMsg.className = 'event-item ev-pass';
      emptyMsg.textContent = '✓ All evolved capabilities passed 4-Stage Deterministic Gatekeeper (Security, De-Symbolization, AST Grounding, BM25 Dedup).';
      stream.appendChild(emptyMsg);
      return;
    }
    events.slice(0, 50).forEach(function(ev) {
      var item = document.createElement('div');
      item.className = 'event-item ' + (ev.passed ? 'ev-pass' : 'ev-fail');
      item.innerHTML = 
        '<span class="ev-time">' + esc((ev.timestamp || '').slice(11, 19)) + '</span> ' +
        '<span class="ev-badge">' + (ev.passed ? 'PASS' : 'FAIL') + '</span> ' +
        '<strong>' + esc(formatKind(ev.kind || 'rule')) + '</strong> ' + esc(ev.target_id || '') + ' ' +
        '<span class="ev-diag">' + esc(ev.diagnostics || '') + '</span>';
      stream.appendChild(item);
    });
  }

  function exportCardPng() {
    var canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, 1200, 630);
    
    // Header
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 36px monospace';
    ctx.fillText('EvoKernel Cockpit X-Ray', 60, 80);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '22px sans-serif';
    var wsTitle = isAnon ? '<WORKSPACE>' : ((snapshot.score && snapshot.score.workspaceRoot) || '');
    ctx.fillText('Context Virtualization & AST Guardrail' + (wsTitle ? ' (' + wsTitle + ')' : ''), 60, 120);

    // Score Box
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(60, 170, 480, 400);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 64px monospace';
    var scoreVal = (snapshot.score && snapshot.score.overallScore !== undefined) ? snapshot.score.overallScore : 0;
    ctx.fillText(scoreVal + '/100', 90, 260);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '24px sans-serif';
    ctx.fillText('Efficiency & Shielding Score', 90, 310);
    var sav = (snapshot.score && snapshot.score.contextSavings) || {};
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('Tokens Saved: -' + (sav.savingsPercent || 0) + '%', 90, 370);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '20px monospace';
    ctx.fillText('(' + (sav.savedTokens || 0).toLocaleString() + ' tok/turn)', 90, 410);

    // Hotspots Box
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(580, 170, 560, 400);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('Fragile Hotspot Coverage', 610, 230);
    var hs = (snapshot.score && snapshot.score.gitHotspots) || [];
    var unprot = (snapshot.score && snapshot.score.unprotectedHotspots) || 0;
    ctx.font = '22px sans-serif';
    ctx.fillStyle = unprot === 0 ? '#10b981' : '#f87171';
    ctx.fillText('Status: ' + (unprot === 0 ? 'All Hotspots Protected' : unprot + ' Unprotected'), 610, 280);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px monospace';
    hs.slice(0, 5).forEach(function(h, idx) {
      var mark = h.unprotected ? '[!] ' : '[ok] ';
      var fname = isAnon ? h.filePath.replace(/^.*[\\\\/]/, '') : h.filePath;
      ctx.fillText(mark + fname.slice(0, 36) + ' (f:' + h.fragilityScore + ')', 610, 330 + idx * 35);
    });

    var a = document.createElement('a');
    a.download = 'evokernel-xray-card.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  // Bind interactive event listeners (zero inline HTML event attributes)
  var btnExport = el('btn-export-png');
  if (btnExport) btnExport.addEventListener('click', exportCardPng);
  var btnDrawer = el('drawer-close-btn');
  if (btnDrawer) btnDrawer.addEventListener('click', closeDrawer);
  var btnAnon = el('btn-anon-toggle');
  if (btnAnon) {
    btnAnon.textContent = isAnon ? 'Anon: ON' : 'Anon: OFF';
    btnAnon.addEventListener('click', function() {
      isAnon = !isAnon;
      btnAnon.textContent = isAnon ? 'Anon: ON' : 'Anon: OFF';
      renderHero();
      renderConstellation();
      renderCapabilities();
      renderGatekeeper();
    });
  }
  var btnLang = el('btn-lang-toggle');
  if (btnLang) {
    btnLang.addEventListener('click', function() {
      lang = lang === 'en' ? 'zh' : 'en';
      btnLang.textContent = lang === 'en' ? 'Lang: EN/中文' : '语言: 中文/EN';
      applyI18n();
    });
  }
  var btnCopyCmd = el('btn-copy-cmd');
  if (btnCopyCmd) {
    btnCopyCmd.addEventListener('click', function() {
      var cmd = 'npx evo-kernel init --stealth && npx evo-kernel virtualize';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd);
      }
      btnCopyCmd.textContent = '✓ Copied CLI!';
      setTimeout(function() { btnCopyCmd.textContent = 'Copy Fix CLI'; }, 1500);
    });
  }

  var searchInput = el('cap-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      searchQuery = e.target.value || '';
      renderCapabilities();
    });
  }

  var filterBtns = document.querySelectorAll('.filter-tab');
  Array.prototype.forEach.call(filterBtns, function(btn) {
    btn.addEventListener('click', function() {
      activeKindFilter = btn.getAttribute('data-kind') || 'all';
      Array.prototype.forEach.call(filterBtns, function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderCapabilities();
    });
  });

  applyI18n();
  renderHero();
  renderConstellation();
  renderCapabilities();
  renderGatekeeper();

  if (!isExport && token) {
    try {
      var evSrc = new EventSource('/api/events?token=' + encodeURIComponent(token));
      evSrc.addEventListener('message', function() {
        fetch('/api/snapshot?token=' + encodeURIComponent(token))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            snapshot = data;
            renderHero();
            renderConstellation();
            renderCapabilities();
            renderGatekeeper();
          });
      });
    } catch(e) {}
  }
})();
`.trim().replace(/\r\n/g, '\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EvoKernel Cockpit — Context &amp; AST Memory Telemetry</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #050608;
      --card-bg: rgba(13, 17, 24, 0.78);
      --border: rgba(255, 255, 255, 0.075);
      --border-strong: rgba(255, 255, 255, 0.14);
      --text: #f8fafc;
      --text-dim: #8b9bb4;
      --accent: #38bdf8;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #f87171;
      --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--sans);
      background:
        radial-gradient(ellipse 80% 42% at 50% -12%, rgba(16, 185, 129, 0.12), rgba(56, 189, 248, 0.05) 48%, transparent 80%),
        #050608;
      color: var(--text);
      padding: 28px 32px;
      line-height: 1.5;
      max-width: 1460px;
      margin: 0 auto;
      -webkit-font-smoothing: antialiased;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 22px;
      flex-wrap: wrap;
      gap: 14px;
    }
    .brand-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.035em;
      background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .sub-caption { font-size: 13px; color: var(--text-dim); margin-top: 2px; }
    .badge {
      background: rgba(255, 255, 255, 0.05);
      color: #cbd5e1;
      border: 1px solid rgba(255, 255, 255, 0.09);
      padding: 2px 9px;
      border-radius: 9999px;
      font-size: 10.5px;
      font-family: var(--mono);
      display: inline-block;
    }
    .grade-pill {
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      font-family: var(--mono);
    }
    .btn {
      background: linear-gradient(180deg, #10b981 0%, #059669 100%);
      color: #03150e;
      border: 1px solid rgba(255,255,255,0.2);
      padding: 8px 15px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 700;
      transition: all 0.15s ease;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.25);
    }
    .btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.04);
      color: #e2e8f0;
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      font-weight: 500;
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.08); border-color: var(--border-strong); }

    /* Top 4-Card Obsidian KPI Strip */
    .kpi-strip {
      display: grid;
      grid-template-columns: 1.35fr 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }
    @media (max-width: 1080px) { .kpi-strip { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 640px) { .kpi-strip { grid-template-columns: 1fr; } }
    .kpi-card {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.042) 0%, rgba(255, 255, 255, 0.012) 100%);
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09), 0 18px 40px -15px rgba(0, 0, 0, 0.75);
      border-radius: 14px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }
    .kpi-card-gauge {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .kpi-big {
      font-size: 38px;
      font-weight: 700;
      letter-spacing: -0.04em;
      font-family: var(--sans);
      line-height: 1.08;
    }
    .kpi-emerald { color: #34d399; text-shadow: 0 0 28px rgba(16, 185, 129, 0.35); }
    .kpi-white {
      background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .kpi-label { font-size: 13px; font-weight: 500; color: #e2e8f0; margin-top: 6px; }
    .kpi-sub { font-size: 11.5px; color: var(--text-dim); font-family: var(--mono); margin-top: 2px; }
    .gauge-wrap { position: relative; width: 92px; height: 92px; flex-shrink: 0; }
    .gauge-center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .score-val { font-size: 17px; font-weight: 800; color: #ffffff; font-family: var(--mono); letter-spacing: -0.03em; }
    .gauge-grade { font-size: 10.5px; color: #34d399; font-family: var(--mono); font-weight: 600; }

    .grid-2 { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 18px; margin-bottom: 18px; }
    @media (max-width: 980px) { .grid-2 { grid-template-columns: 1fr; } }
    .card {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.035) 0%, rgba(255, 255, 255, 0.01) 100%);
      border: 1px solid var(--border);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 20px 48px -18px rgba(0, 0, 0, 0.8);
      border-radius: 14px;
      padding: 20px 22px;
    }
    .card h2 {
      font-size: 14px;
      margin-bottom: 14px;
      color: #e2e8f0;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .score-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
      background: rgba(0, 0, 0, 0.35);
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid var(--border);
    }
    .sub-gauges { display: flex; gap: 16px; font-size: 12px; font-family: var(--mono); color: var(--text-dim); }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.045);
      font-size: 13px;
      color: #cbd5e1;
    }
    .mcp-bar-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 92px;
      border-radius: 10px;
      padding: 10px;
      background: rgba(3, 5, 8, 0.7);
      border: 1px solid var(--border);
      margin-top: 10px;
    }
    .treemap-tile {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 10px 12px;
      border-radius: 8px;
      font-family: var(--mono);
      min-height: 66px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
    }
    .tm-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: #f8fafc; }
    .tm-tag {
      font-size: 9.5px;
      padding: 1.5px 6px;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.38);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
    }
    .mcp-tok { font-size: 12px; color: #94a3b8; margin-top: 6px; display: flex; justify-content: space-between; }
    .tm-pct { color: #f8fafc; font-weight: 700; }
    .status-pooled {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(6, 78, 59, 0.32) 100%);
      border-color: rgba(16, 185, 129, 0.42);
    }
    .status-memory-zero {
      background: linear-gradient(135deg, rgba(20, 184, 166, 0.18) 0%, rgba(15, 118, 110, 0.25) 100%);
      border-color: rgba(45, 212, 191, 0.35);
    }
    .status-evo-seed {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.18) 0%, rgba(3, 105, 161, 0.25) 100%);
      border-color: rgba(56, 189, 248, 0.38);
    }
    .status-user-rules {
      background: linear-gradient(135deg, rgba(148, 163, 184, 0.12) 0%, rgba(30, 41, 59, 0.28) 100%);
      border-color: rgba(148, 163, 184, 0.24);
    }
    .status-active {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(120, 53, 15, 0.3) 100%);
      border-color: rgba(245, 158, 11, 0.4);
    }

    .attr-helped { background: rgba(16, 185, 129, 0.14); color: #34d399; border-color: rgba(16, 185, 129, 0.3); }
    .attr-contested { background: rgba(245, 158, 11, 0.14); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3); }
    .attr-hurt { background: rgba(248, 113, 113, 0.14); color: #f87171; border-color: rgba(248, 113, 113, 0.3); }
    .attr-unverified { background: rgba(255, 255, 255, 0.05); color: #94a3b8; }
    .fresh-verified { background: rgba(16, 185, 129, 0.12); color: #34d399; border-color: rgba(16, 185, 129, 0.3); }
    .fresh-other_branch { background: rgba(56, 189, 248, 0.12); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3); }
    .fresh-stale { background: rgba(248, 113, 113, 0.12); color: #f87171; border-color: rgba(248, 113, 113, 0.3); }
    .cap-hits { font-size: 11px; color: var(--text-dim); font-family: var(--mono); }

    table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-family: var(--mono); }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
    th { color: var(--text-dim); font-weight: 500; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; }
    .hs-file { color: #f1f5f9; font-weight: 500; }
    .hs-score { color: #e2e8f0; font-weight: 700; }
    .hs-dim { color: var(--text-dim); font-size: 11.5px; }
    .hs-anchor-pill {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      color: #cbd5e1;
    }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10.5px; font-weight: 600; }
    .tag-ok { background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .tag-warn { background: rgba(248, 113, 113, 0.14); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.35); }

    .constellation-wrap {
      background: radial-gradient(circle at 50% 50%, rgba(13, 22, 34, 0.7) 0%, rgba(4, 6, 10, 0.92) 100%);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px;
      overflow-x: auto;
    }
    .const-legend {
      display: flex;
      gap: 18px;
      font-size: 12px;
      color: var(--text-dim);
      margin-bottom: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }

    .caps-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .filter-tab {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-dim);
      border: 1px solid var(--border);
      padding: 5px 12px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 11.5px;
      font-family: var(--mono);
      transition: all 0.15s;
    }
    .filter-tab.active {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.45);
      font-weight: 600;
    }
    .search-input {
      background: rgba(0, 0, 0, 0.45);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      min-width: 240px;
      font-family: var(--mono);
    }

    .caps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; max-height: 390px; overflow-y: auto; padding-right: 4px; }
    .cap-card {
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 13px 14px;
      cursor: pointer;
      transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease;
    }
    .cap-card:hover {
      transform: translateY(-2px);
      border-color: rgba(56, 189, 248, 0.45);
      background: rgba(255, 255, 255, 0.042);
    }
    .cap-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 6px; gap: 6px; }
    .cap-badges { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .cap-kind { font-weight: 700; color: var(--accent); font-family: var(--mono); font-size: 10.5px; }
    .cap-id { color: var(--text-dim); font-family: var(--mono); font-size: 10.5px; }
    .cap-title { font-weight: 600; font-size: 13.5px; color: #f8fafc; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cap-summary { font-size: 12px; color: var(--text-dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .stream-box {
      font-family: var(--mono);
      font-size: 12px;
      max-height: 180px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.45);
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .event-item { padding: 5px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    .ev-pass { color: #34d399; }
    .ev-fail { color: var(--red); }
    .ev-time { color: var(--text-dim); }
    .ev-badge { font-weight: 700; }

    .drawer {
      position: fixed;
      top: 0;
      right: -540px;
      width: 520px;
      max-width: 92vw;
      height: 100%;
      background: #080b11;
      border-left: 1px solid var(--border-strong);
      box-shadow: -12px 0 40px rgba(0, 0, 0, 0.8);
      padding: 26px;
      transition: right 0.25s ease;
      z-index: 100;
      overflow-y: auto;
    }
    .drawer.open { right: 0; }
    .drawer-close { float: right; cursor: pointer; font-size: 22px; color: var(--text-dim); }
    pre {
      background: #040609;
      padding: 14px;
      border-radius: 8px;
      overflow-x: auto;
      font-family: var(--mono);
      font-size: 12px;
      margin-top: 12px;
      border: 1px solid var(--border);
      white-space: pre-wrap;
      word-break: break-all;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="brand-row">
        <h1 id="ui-main-title">EvoKernel Cockpit</h1>
        <span class="badge">v0.3.0</span>
        <span class="badge" id="hero-mode">PROJECT</span>
        <span class="grade-pill" id="hero-grade-pill">GRADE A+</span>
      </div>
      <div class="sub-caption">
        <span id="ui-sub-title">Context Virtualization &amp; AST-Anchored Cognitive Memory Telemetry</span>
        &nbsp;·&nbsp;<span id="hero-ws" style="font-family: var(--mono); color: #cbd5e1;"></span>
      </div>
    </div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <button class="btn btn-secondary" id="btn-copy-cmd">Copy Fix CLI</button>
      <button class="btn btn-secondary" id="btn-lang-toggle">Lang: EN/中文</button>
      <button class="btn btn-secondary" id="btn-anon-toggle">Anon: OFF</button>
      <button class="btn" id="btn-export-png">Export X-Ray PNG</button>
    </div>
  </header>

  <!-- Executive 4-Card Obsidian KPI Strip -->
  <div class="kpi-strip">
    <div class="kpi-card kpi-card-gauge">
      <div>
        <div style="font-size: 11.5px; font-family: var(--mono); color: #34d399; letter-spacing: 0.05em; text-transform: uppercase;">Context Health Index</div>
        <div class="kpi-label" style="font-size: 16px; font-weight: 600; margin-top: 4px;">Zero-Leak AST &amp; Prompt Guard</div>
        <div class="kpi-sub">Cache Shield: <strong id="sub-cache-score" style="color: #38bdf8;">100%</strong> · Hotspot Shield: <strong id="sub-fragile-score" style="color: #34d399;">100%</strong></div>
      </div>
      <div class="gauge-wrap">
        <svg viewBox="0 0 92 92" width="92" height="92">
          <circle cx="46" cy="46" r="38" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
          <circle id="hero-gauge-arc" cx="46" cy="46" r="38" fill="none" stroke="#10b981" stroke-width="7" stroke-linecap="round" stroke-dasharray="238.76" stroke-dashoffset="9.5" transform="rotate(-90 46 46)"/>
        </svg>
        <div class="gauge-center">
          <div class="score-val" id="hero-score-val">96 / 100</div>
          <div class="gauge-grade" id="kpi-grade-sub">Grade A+</div>
        </div>
      </div>
    </div>

    <div class="kpi-card">
      <div class="kpi-big kpi-emerald" id="kpi-saved-pct">-79.3%</div>
      <div class="kpi-label">Context Tax Saved</div>
      <div class="kpi-sub" id="kpi-saved-detail">180 tok L0 vs 23,550 tok Eager</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-big kpi-white" id="kpi-mem-val">15 / 15</div>
      <div class="kpi-label">AST Memories Verified</div>
      <div class="kpi-sub">16-Hex Symbol Anchors · 0 Idle Tax</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-big kpi-white" id="kpi-hs-val">10 / 10</div>
      <div class="kpi-label">Bug Hotspots Protected</div>
      <div class="kpi-sub">100% Git Fix-Hotspot Coverage</div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <h2 id="hdr-ctx">Context Virtualization &amp; 2D Token Budget Treemap</h2>
      <div class="stat-row"><span id="lbl-before">Before EvoKernel (Eager Load):</span><strong id="hero-before-tok" style="color: var(--yellow); font-family: var(--mono);">--</strong></div>
      <div class="stat-row"><span id="lbl-after">After EvoKernel (Virtual Load):</span><strong id="hero-after-tok" style="color: var(--green); font-family: var(--mono);">--</strong></div>
      <div class="stat-row"><span id="lbl-saved">Net Prompt Tax Saved:</span><strong id="hero-saved-tok" style="color: var(--green); font-family: var(--mono);">--</strong></div>
      <div class="stat-row"><span id="lbl-rules">Host Rules (Static / L0 Seed):</span><span style="font-size: 12.5px; font-family: var(--mono);"><strong id="hero-static-tok">--</strong> / <strong id="hero-seed-tok">--</strong> tok</span></div>
      <div id="lbl-treemap" style="margin-top: 12px; font-size: 11.5px; color: var(--text-dim);">2D Proportional Context Budget Treemap (Emerald: Virtualized 0 Idle Tax · Cyan: L0 Seed):</div>
      <div class="mcp-bar-container" id="mcp-treemap"></div>
    </div>

    <div class="card">
      <h2 id="hdr-hs">Fragile Git Hotspots &amp; AST Shielding</h2>
      <table id="hotspots-table">
        <thead>
          <tr>
            <th>Hotspot File</th>
            <th>Fragility</th>
            <th>AST Anchors</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="hotspots-body"></tbody>
      </table>
    </div>
  </div>

  <div class="card" style="margin-bottom: 18px;">
    <h2 id="hdr-const">Interactive AST Memory &amp; Symbol Topology Constellation</h2>
    <div class="const-legend">
      <span><i class="dot" style="background:#10b981; box-shadow: 0 0 8px #10b981;"></i>Verified Episodic Memory (<code>.evo/memories/</code>)</span>
      <span><i class="dot" style="background:#38bdf8; box-shadow: 0 0 8px #38bdf8;"></i>AST Code Symbol Anchor (<code>filePath#symbolName</code>)</span>
      <span><i class="dot" style="background:#94a3b8;"></i>Scoped Architectural Rule</span>
      <span id="lbl-const-hint" style="margin-left: auto; font-family: var(--mono); font-size: 11px;">Click any node to inspect 16-hex AST symbol fingerprints &amp; live topology callers</span>
    </div>
    <div class="constellation-wrap">
      <svg id="constellation-svg" viewBox="0 0 920 350" width="100%" height="330"></svg>
    </div>
  </div>

  <div class="card" style="margin-bottom: 18px;">
    <h2 id="hdr-caps">Evolved Capability Matrix (Rules, Skills, Tools, Memories)</h2>
    <div class="caps-toolbar">
      <div class="filter-tabs">
        <button class="filter-tab active" data-kind="all">ALL</button>
        <button class="filter-tab" data-kind="memories">MEMORIES</button>
        <button class="filter-tab" data-kind="rules">RULES</button>
        <button class="filter-tab" data-kind="skills">SKILLS</button>
        <button class="filter-tab" data-kind="tools">MICRO-TOOLS</button>
      </div>
      <input type="text" class="search-input" id="cap-search-input" placeholder="Filter capabilities, symbols, or tags..." />
    </div>
    <div class="caps-grid" id="caps-list"></div>
  </div>

  <div class="card">
    <h2 id="hdr-gk">Deterministic 4-Stage Gatekeeper Audit Stream</h2>
    <div class="stream-box" id="gatekeeper-stream"></div>
  </div>

  <div class="drawer" id="drawer">
    <span class="drawer-close" id="drawer-close-btn">&times;</span>
    <h3 id="drawer-title" style="color: var(--accent); margin-bottom: 12px; font-size: 17px; font-family: var(--mono);"></h3>
    <pre id="drawer-content"></pre>
  </div>

  <script>${clientScript}</script>
</body>
</html>`;
}
