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
      title: '🧬 EvoKernel Live X-Ray Cockpit',
      ctxTitle: '1. Context & 2D Token Budget Treemap',
      hsTitle: '2. Fragile Git Hotspots & AST Shielding',
      constTitle: '3. Interactive AST Memory & Symbol Topology Constellation',
      capsTitle: '4. Evolved Capability Matrix (Rules, Skills, Tools, Memories)',
      gkTitle: '5. Deterministic 4-Stage Gatekeeper Audit Stream',
      beforeTok: 'Before EvoKernel (Eager Load):',
      afterTok: 'After EvoKernel (Virtual Load):',
      savedTok: 'Net Prompt Tax Saved:',
      hostRules: 'Host Rules (Static / L0 Seed):',
      treemapHint: '2D Context Budget Treemap (Green: Virtualized/Pooled, Blue: L0 Seed, Orange: Active Tax):',
      constHint: 'Click any Memory, Rule, or AST File node to inspect live symbol fingerprints & callers:'
    },
    zh: {
      title: '🧬 EvoKernel 实时 X-Ray 认知驾驶舱',
      ctxTitle: '1. 上下文虚拟化与 2D 预算矩阵树图 (Treemap)',
      hsTitle: '2. Git 脆弱代码热点与 AST 记忆护栏覆盖',
      constTitle: '3. 交互式 AST 认知记忆与符号拓扑星图 (Constellation)',
      capsTitle: '4. 自演化能力矩阵 (规则 Rules / 技能 Skills / 微工具 Tools / 记忆 Memories)',
      gkTitle: '5. 确定性四阶 Gatekeeper 门禁审计流',
      beforeTok: '接入前全量加载 (Eager Tax):',
      afterTok: '接入后按需虚拟化 (Virtual Load):',
      savedTok: '单轮净省 Prompt 税:',
      hostRules: '宿主规则 (静态 / L0 种子):',
      treemapHint: '2D 预算面积图 (绿色: 已虚拟化折叠/0常驻成本, 蓝色: L0 种子, 橙色: 活跃未折叠税):',
      constHint: '点击星图中的记忆胶囊、规则或源码符号节点，即可透视 AST 哈希指纹与调用链:'
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
    var overall = score.overallScore || 0;
    var grade = score.grade || (overall >= 95 ? 'A+' : overall >= 85 ? 'A' : 'B');
    
    el('hero-score-val').textContent = overall + ' / 100';
    if (el('hero-grade-pill')) el('hero-grade-pill').textContent = 'GRADE ' + grade;
    el('hero-mode').textContent = (score.mode || 'project').toUpperCase();
    el('hero-ws').textContent = isAnon ? '<WORKSPACE>' : (score.workspaceRoot || '');
    el('hero-before-tok').textContent = (savings.beforeTokens || 0).toLocaleString() + ' tok';
    el('hero-after-tok').textContent = (savings.afterTokens || 0).toLocaleString() + ' tok';
    el('hero-saved-tok').textContent = (savings.savedTokens || 0).toLocaleString() + ' tok (-' + (savings.savingsPercent || 0) + '%)';
    if (el('hero-static-tok')) el('hero-static-tok').textContent = (savings.userStaticRuleTokens || 0).toLocaleString();
    if (el('hero-seed-tok')) el('hero-seed-tok').textContent = (savings.evoSeedTokens || 0).toLocaleString();
    if (el('sub-cache-score')) el('sub-cache-score').textContent = (score.cacheShieldingScore !== undefined ? score.cacheShieldingScore : 100) + '%';
    if (el('sub-fragile-score')) el('sub-fragile-score').textContent = (score.fragileCodeScore !== undefined ? score.fragileCodeScore : 100) + '%';
    
    // 2D Treemap Tiles
    var mcp = score.mcpTax || { servers: [] };
    var mcpContainer = el('mcp-treemap');
    mcpContainer.innerHTML = '';
    var uTok = savings.userStaticRuleTokens || 0;
    var sTok = savings.evoSeedTokens || 0;
    var caps = score.capabilities || {};
    var virtRuleTok = Math.max(0, (caps.totalRuleTokens || 0) + (caps.skillsCount || 0) * 650 + (caps.toolsCount || 0) * 450);
    var virtMemTok = Math.max(0, (caps.memoriesCount || 0) * 400);

    var blocks = [];
    (mcp.servers || []).forEach(function(s) {
      blocks.push({
        label: s.name,
        tokens: s.estimatedTokens || 850,
        cls: s.status === 'pooled' ? 'status-pooled' : 'status-active',
        tag: s.status === 'pooled' ? 'POOLED MCP' : 'ACTIVE MCP'
      });
    });
    if (virtRuleTok > 0) {
      blocks.push({
        label: 'Virtualized L1/L2 Rules & Skills',
        tokens: virtRuleTok,
        cls: 'status-pooled',
        tag: 'ON-DEMAND (0 EAGER TAX)'
      });
    }
    if (virtMemTok > 0) {
      blocks.push({
        label: 'AST Episodic Memories (' + (caps.memoriesCount || 0) + ')',
        tokens: virtMemTok,
        cls: 'status-memory-zero',
        tag: '0 CORE TOKEN COST'
      });
    }
    if (sTok > 0) {
      blocks.push({
        label: 'L0 Meta-Rule Seed',
        tokens: sTok,
        cls: 'status-evo-seed',
        tag: 'ALWAYS-ON SEED'
      });
    }
    if (uTok > 0) {
      blocks.push({
        label: 'User Static Rules',
        tokens: uTok,
        cls: 'status-user-rules',
        tag: 'STATIC'
      });
    }

    var totalWeight = 0;
    blocks.forEach(function(b) { totalWeight += b.tokens; });
    totalWeight = totalWeight || 1;

    blocks.forEach(function(b) {
      var tile = document.createElement('div');
      tile.className = 'treemap-tile ' + b.cls;
      var pct = Math.max(12, Math.round((b.tokens / totalWeight) * 100));
      tile.style.flex = String(pct) + ' 1 ' + Math.max(110, pct * 2) + 'px';
      tile.title = b.label + ': ~' + b.tokens + ' tok (' + b.tag + ')';
      tile.innerHTML =
        '<div class="tm-top"><span class="mcp-name">' + esc(b.label) + '</span><span class="tm-tag">' + esc(b.tag) + '</span></div>' +
        '<div class="mcp-tok">~' + b.tokens.toLocaleString() + ' tok (' + Math.round((b.tokens / totalWeight) * 100) + '%)</div>';
      mcpContainer.appendChild(tile);
    });

    // Hotspots table
    var hsContainer = el('hotspots-body');
    hsContainer.innerHTML = '';
    (score.gitHotspots || []).slice(0, 10).forEach(function(h) {
      var row = document.createElement('tr');
      row.className = h.unprotected ? 'row-unprotected' : 'row-protected';
      var fname = esc(isAnon ? h.filePath.replace(/^.*[\\\\/]/, '') : h.filePath);
      row.innerHTML = 
        '<td class="hs-file">' + fname + '</td>' +
        '<td>' + h.fragilityScore + ' <span style="color:var(--text-dim);">(' + h.fixRevertCommits + ' fixes)</span></td>' +
        '<td>' + h.memoryCount + ' mem / ' + h.scopedRuleCount + ' rule</td>' +
        '<td><span class="tag ' + (h.unprotected ? 'tag-warn' : 'tag-ok') + '">' +
        (h.unprotected ? 'UNPROTECTED' : 'PROTECTED') + '</span></td>';
      hsContainer.appendChild(row);
    });
  }

  function renderConstellation() {
    var svg = el('constellation-svg');
    if (!svg) return;
    svg.innerHTML = '';
    var ns = 'http://www.w3.org/2000/svg';
    var width = 920;
    var height = 340;
    var cx = 460;
    var cy = 170;

    var memories = (snapshot.memories || []).slice(0, 14);
    var rules = (snapshot.rules || []).slice(0, 8);
    var fileMap = {};
    var fileNodes = [];

    memories.forEach(function(m, idx) {
      var angle = (idx / Math.max(1, memories.length)) * Math.PI * 2 - Math.PI / 2;
      m._x = cx + Math.cos(angle) * 122;
      m._y = cy + Math.sin(angle) * 96;

      var fps = m.ast_fingerprints || {};
      Object.keys(fps).forEach(function(k) {
        var fp = fps[k] || {};
        var fpath = fp.file_path || fp.file || '';
        if (fpath) {
          var shortF = isAnon ? fpath.replace(/^.*[\\\\/]/, '') : fpath;
          if (!fileMap[shortF] && fileNodes.length < 14) {
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
      fn._x = cx + Math.cos(angle) * 295;
      fn._y = cy + Math.sin(angle) * 138;
    });

    rules.forEach(function(r, idx) {
      var angle = (idx / Math.max(1, rules.length)) * Math.PI * 2;
      r._x = cx + Math.cos(angle) * 208;
      r._y = cy + Math.sin(angle) * 120;
    });

    // Orbital rings
    [98, 195, 290].forEach(function(rx, i) {
      var ell = document.createElementNS(ns, 'ellipse');
      ell.setAttribute('cx', String(cx));
      ell.setAttribute('cy', String(cy));
      ell.setAttribute('rx', String(rx));
      ell.setAttribute('ry', String(90 + i * 24));
      ell.setAttribute('fill', 'none');
      ell.setAttribute('stroke', '#1e293b');
      ell.setAttribute('stroke-dasharray', '4 4');
      svg.appendChild(ell);
    });

    // Edges: Core -> Memories & Memories -> AST Files
    memories.forEach(function(m) {
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(cx));
      line.setAttribute('y1', String(cy));
      line.setAttribute('x2', String(m._x));
      line.setAttribute('y2', String(m._y));
      line.setAttribute('stroke', '#065f46');
      line.setAttribute('stroke-width', '1.2');
      svg.appendChild(line);
    });

    fileNodes.forEach(function(fn) {
      fn.mems.forEach(function(m) {
        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(m._x));
        line.setAttribute('y1', String(m._y));
        line.setAttribute('x2', String(fn._x));
        line.setAttribute('y2', String(fn._y));
        line.setAttribute('stroke', '#0284c7');
        line.setAttribute('stroke-width', '1.1');
        line.setAttribute('stroke-opacity', '0.65');
        svg.appendChild(line);
      });
    });

    // Center Hub Node
    var hubG = document.createElementNS(ns, 'g');
    var hubCircle = document.createElementNS(ns, 'circle');
    hubCircle.setAttribute('cx', String(cx));
    hubCircle.setAttribute('cy', String(cy));
    hubCircle.setAttribute('r', '26');
    hubCircle.setAttribute('fill', '#0f172a');
    hubCircle.setAttribute('stroke', '#38bdf8');
    hubCircle.setAttribute('stroke-width', '2.5');
    hubG.appendChild(hubCircle);
    var hubTxt = document.createElementNS(ns, 'text');
    hubTxt.setAttribute('x', String(cx));
    hubTxt.setAttribute('y', String(cy + 4));
    hubTxt.setAttribute('text-anchor', 'middle');
    hubTxt.setAttribute('fill', '#38bdf8');
    hubTxt.setAttribute('font-size', '10');
    hubTxt.setAttribute('font-weight', '700');
    hubTxt.textContent = '.evo HUB';
    hubG.appendChild(hubTxt);
    svg.appendChild(hubG);

    // Memory Nodes
    memories.forEach(function(m) {
      var g = document.createElementNS(ns, 'g');
      g.style.cursor = 'pointer';
      var status = (m.freshness && m.freshness.overall_status) || 'VERIFIED';
      var color = status === 'VERIFIED' ? '#34d399' : (status === 'STALE' ? '#f87171' : '#60a5fa');
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(m._x));
      c.setAttribute('cy', String(m._y));
      c.setAttribute('r', '9');
      c.setAttribute('fill', '#064e3b');
      c.setAttribute('stroke', color);
      c.setAttribute('stroke-width', '2');
      g.appendChild(c);

      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(m._x));
      t.setAttribute('y', String(m._y - 13));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#d1fae5');
      t.setAttribute('font-size', '9.5');
      t.textContent = String(m.id || '').slice(0, 18);
      g.appendChild(t);
      g.addEventListener('click', function() { openDrawer('memories', m); });
      svg.appendChild(g);
    });

    // Rule Nodes
    rules.forEach(function(r) {
      var g = document.createElementNS(ns, 'g');
      g.style.cursor = 'pointer';
      var rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(r._x - 7));
      rect.setAttribute('y', String(r._y - 7));
      rect.setAttribute('width', '14');
      rect.setAttribute('height', '14');
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', '#312e81');
      rect.setAttribute('stroke', '#818cf8');
      rect.setAttribute('stroke-width', '1.8');
      g.appendChild(rect);

      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(r._x));
      t.setAttribute('y', String(r._y + 18));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#c7d2fe');
      t.setAttribute('font-size', '9');
      t.textContent = String(r.id || '').slice(0, 16);
      g.appendChild(t);
      g.addEventListener('click', function() { openDrawer('rules', r); });
      svg.appendChild(g);
    });

    // AST File Nodes
    fileNodes.forEach(function(fn) {
      var g = document.createElementNS(ns, 'g');
      g.style.cursor = 'pointer';
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(fn._x));
      c.setAttribute('cy', String(fn._y));
      c.setAttribute('r', '7');
      c.setAttribute('fill', '#0c4a6e');
      c.setAttribute('stroke', '#38bdf8');
      c.setAttribute('stroke-width', '1.6');
      g.appendChild(c);

      var t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(fn._x));
      t.setAttribute('y', String(fn._y - 10));
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
        var freshBadge = fresh ? '<span class="badge fresh-' + esc(fresh.toLowerCase()) + '">' + esc(fresh) + '</span>' : '';
        var kindLabel = formatKind(k);
        card.innerHTML = 
          '<div class="cap-header">' +
            '<div><span class="cap-kind">' + kindLabel + '</span> ' +
            '<span class="badge attr-' + attr + '">' + attr + '</span> ' +
            (hits > 0 ? '<span class="cap-hits">(' + hits + ' hits)</span> ' : '') +
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
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, 1200, 630);
    
    // Header
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 36px monospace';
    ctx.fillText('EvoKernel Dual X-Ray Card', 60, 80);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '22px sans-serif';
    var wsTitle = isAnon ? '<WORKSPACE>' : ((snapshot.score && snapshot.score.workspaceRoot) || '');
    ctx.fillText('Context Virtualization & Guardrail' + (wsTitle ? ' (' + wsTitle + ')' : ''), 60, 120);

    // Score Box
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(60, 170, 480, 400);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 64px monospace';
    var scoreVal = (snapshot.score && snapshot.score.overallScore !== undefined) ? snapshot.score.overallScore : 0;
    ctx.fillText(scoreVal + '/100', 90, 260);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '24px sans-serif';
    ctx.fillText('Efficiency & Shielding Score', 90, 310);
    var sav = (snapshot.score && snapshot.score.contextSavings) || {};
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('Tokens Saved: -' + (sav.savingsPercent || 0) + '%', 90, 370);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '20px monospace';
    ctx.fillText('(' + (sav.savedTokens || 0).toLocaleString() + ' tok/turn)', 90, 410);

    // Hotspots Box
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(580, 170, 560, 400);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('Fragile Hotspot Coverage', 610, 230);
    var hs = (snapshot.score && snapshot.score.gitHotspots) || [];
    var unprot = (snapshot.score && snapshot.score.unprotectedHotspots) || 0;
    ctx.font = '22px sans-serif';
    ctx.fillStyle = unprot === 0 ? '#4ade80' : '#f87171';
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

  // Bind interactive event listeners (no inline HTML event attributes to conform to strict CSP)
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
  <title>EvoKernel Live X-Ray Cockpit</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: #070b14;
      --card-bg: #0f172a;
      --border: #1e293b;
      --text: #f3f4f6;
      --text-dim: #94a3b8;
      --accent: #38bdf8;
      --green: #34d399;
      --yellow: #fbbf24;
      --red: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace, sans-serif; background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; max-width: 1440px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    h1 { font-size: 24px; font-weight: 800; color: var(--accent); letter-spacing: -0.02em; }
    .badge { background: #1e293b; color: var(--accent); padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-family: monospace; display: inline-block; }
    .grade-pill { background: #064e3b; color: var(--green); border: 1px solid var(--green); padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 700; font-family: monospace; margin-left: 8px; }
    .btn { background: #2563eb; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; transition: background 0.15s; }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary { background: #1e293b; border: 1px solid #334155; }
    .btn-secondary:hover { background: #334155; }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    @media (max-width: 960px) { .grid-2 { grid-template-columns: 1fr; } }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
    .card h2 { font-size: 15px; margin-bottom: 12px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 8px; font-weight: 700; }

    .score-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; background: #090d16; padding: 12px 16px; border-radius: 8px; border: 1px solid #1e293b; }
    .score-val { font-size: 40px; font-weight: 800; color: var(--green); font-family: monospace; }
    .sub-gauges { display: flex; gap: 16px; font-size: 12px; font-family: monospace; color: var(--text-dim); }
    .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1e293b80; font-size: 13.5px; }
    .mcp-bar-container { display: flex; flex-wrap: wrap; gap: 6px; min-height: 76px; border-radius: 8px; padding: 8px; background: #090d16; border: 1px solid var(--border); margin-top: 10px; }
    .treemap-tile { display: flex; flex-direction: column; justify-content: space-between; padding: 8px 10px; border-radius: 6px; font-family: monospace; min-height: 58px; overflow: hidden; }
    .tm-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; }
    .tm-tag { font-size: 9.5px; opacity: 0.85; padding: 1px 5px; border-radius: 3px; background: rgba(0,0,0,0.25); }
    .mcp-tok { font-size: 11px; opacity: 0.92; margin-top: 4px; }
    .status-active { background: linear-gradient(135deg, #b45309, #d97706); color: #fff; }
    .status-pooled { background: linear-gradient(135deg, #065f46, #059669); color: #fff; }
    .status-memory-zero { background: linear-gradient(135deg, #0f766e, #14b8a6); color: #fff; }
    .status-user-rules { background: linear-gradient(135deg, #3730a3, #4f46e5); color: #fff; }
    .status-evo-seed { background: linear-gradient(135deg, #0369a1, #0284c7); color: #fff; }
    .attr-helped { background: #064e3b; color: #34d399; }
    .attr-contested { background: #78350f; color: #fbbf24; }
    .attr-hurt { background: #7f1d1d; color: #f87171; }
    .attr-unverified { background: #1f2937; color: #9ca3af; }
    .fresh-verified { background: #064e3b; color: #34d399; margin-left: 4px; }
    .fresh-other_branch { background: #1e3a8a; color: #60a5fa; margin-left: 4px; }
    .fresh-stale { background: #7f1d1d; color: #f87171; margin-left: 4px; }
    .cap-hits { font-size: 11px; color: var(--text-dim); margin-left: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-family: monospace; }
    th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); }
    th { color: var(--text-dim); }
    .tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10.5px; font-weight: 700; }
    .tag-ok { background: #064e3b; color: var(--green); }
    .tag-warn { background: #7f1d1d; color: var(--red); }

    .constellation-wrap { background: #090d16; border: 1px solid var(--border); border-radius: 8px; padding: 8px; overflow-x: auto; }
    .const-legend { display: flex; gap: 16px; font-size: 11.5px; font-family: monospace; color: var(--text-dim); margin-bottom: 8px; flex-wrap: wrap; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }

    .caps-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .filter-tab { background: #1e293b; color: var(--text-dim); border: 1px solid #334155; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: monospace; }
    .filter-tab.active { background: var(--accent); color: #090d16; border-color: var(--accent); font-weight: 700; }
    .search-input { background: #090d16; color: var(--text); border: 1px solid #334155; padding: 5px 10px; border-radius: 6px; font-size: 12.5px; min-width: 220px; font-family: monospace; }

    .caps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; max-height: 400px; overflow-y: auto; padding-right: 4px; }
    .cap-card { background: #162032; border: 1px solid #283548; border-radius: 8px; padding: 12px; cursor: pointer; transition: transform 0.1s, border-color 0.1s; }
    .cap-card:hover { transform: translateY(-2px); border-color: var(--accent); }
    .cap-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px; }
    .cap-kind { font-weight: 700; color: var(--accent); }
    .cap-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cap-summary { font-size: 12px; color: var(--text-dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .stream-box { font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; background: #090d16; padding: 10px; border-radius: 6px; border: 1px solid var(--border); }
    .event-item { padding: 4px 0; border-bottom: 1px solid #1e293b; }
    .ev-pass { color: var(--green); }
    .ev-fail { color: var(--red); }
    .ev-time { color: var(--text-dim); }
    .ev-badge { font-weight: 700; }

    .drawer { position: fixed; top: 0; right: -520px; width: 500px; max-width: 92vw; height: 100%; background: #0f172a; border-left: 1px solid var(--accent); box-shadow: -4px 0 28px rgba(0,0,0,0.65); padding: 24px; transition: right 0.25s ease; z-index: 100; overflow-y: auto; }
    .drawer.open { right: 0; }
    .drawer-close { float: right; cursor: pointer; font-size: 22px; color: var(--text-dim); }
    pre { background: #030712; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 12px; margin-top: 12px; border: 1px solid var(--border); white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1 id="ui-main-title">🧬 EvoKernel Live X-Ray Cockpit</h1>
      <div style="margin-top: 4px;">
        <span class="badge" id="hero-mode">MODE</span>
        <span class="grade-pill" id="hero-grade-pill">GRADE A+</span>
        &nbsp;<span id="hero-ws" style="font-size: 13px; color: var(--text-dim); font-family: monospace;"></span>
      </div>
    </div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <button class="btn btn-secondary" id="btn-copy-cmd">Copy Fix CLI</button>
      <button class="btn btn-secondary" id="btn-lang-toggle">Lang: EN/中文</button>
      <button class="btn btn-secondary" id="btn-anon-toggle">Anon: OFF</button>
      <button class="btn" id="btn-export-png">Export X-Ray PNG</button>
    </div>
  </header>

  <div class="grid-2">
    <div class="card">
      <h2 id="hdr-ctx">1. Context &amp; 2D Token Budget Treemap</h2>
      <div class="score-banner">
        <div>
          <div class="score-val" id="hero-score-val">--</div>
          <div style="font-size: 12px; color: var(--text-dim);">Context Health &amp; Shielding Index</div>
        </div>
        <div class="sub-gauges">
          <div>Cache Shield: <strong id="sub-cache-score" style="color: var(--accent);">100%</strong></div>
          <div>Hotspot Guard: <strong id="sub-fragile-score" style="color: var(--green);">100%</strong></div>
        </div>
      </div>
      <div class="stat-row"><span id="lbl-before">Before EvoKernel (Eager Load):</span><strong id="hero-before-tok" style="color: var(--yellow);">--</strong></div>
      <div class="stat-row"><span id="lbl-after">After EvoKernel (Virtual Load):</span><strong id="hero-after-tok" style="color: var(--green);">--</strong></div>
      <div class="stat-row"><span id="lbl-saved">Net Prompt Tax Saved:</span><strong id="hero-saved-tok" style="color: var(--green);">--</strong></div>
      <div class="stat-row"><span id="lbl-rules">Host Rules (Static / L0 Seed):</span><span style="font-size: 13px;"><strong id="hero-static-tok">--</strong> / <strong id="hero-seed-tok">--</strong> tok</span></div>
      <div id="lbl-treemap" style="margin-top: 12px; font-size: 11.5px; color: var(--text-dim);">2D Context Budget Treemap (Green: Virtualized/Pooled, Blue: L0 Seed, Orange: Active Tax):</div>
      <div class="mcp-bar-container" id="mcp-treemap"></div>
    </div>

    <div class="card">
      <h2 id="hdr-hs">2. Fragile Git Hotspots &amp; AST Shielding</h2>
      <table id="hotspots-table">
        <thead>
          <tr>
            <th>Hotspot File</th>
            <th>Fragility (Fixes)</th>
            <th>AST Anchors</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="hotspots-body"></tbody>
      </table>
    </div>
  </div>

  <div class="card" style="margin-bottom: 20px;">
    <h2 id="hdr-const">3. Interactive AST Memory &amp; Symbol Topology Constellation</h2>
    <div class="const-legend">
      <span><i class="dot" style="background:#34d399;"></i>VERIFIED AST Memory (0 Core Token Cost)</span>
      <span><i class="dot" style="background:#818cf8;"></i>Evolved Architectural Rule</span>
      <span><i class="dot" style="background:#38bdf8;"></i>Anchored Source File / Symbol</span>
      <span id="lbl-const-hint" style="margin-left: auto;">Click any Memory, Rule, or AST File node to inspect live symbol fingerprints &amp; callers:</span>
    </div>
    <div class="constellation-wrap">
      <svg id="constellation-svg" viewBox="0 0 920 340" width="100%" height="320"></svg>
    </div>
  </div>

  <div class="card" style="margin-bottom: 20px;">
    <h2 id="hdr-caps">4. Evolved Capability Matrix (Rules, Skills, Tools, Memories)</h2>
    <div class="caps-toolbar">
      <div class="filter-tabs">
        <button class="filter-tab active" data-kind="all">ALL</button>
        <button class="filter-tab" data-kind="memories">MEMORIES</button>
        <button class="filter-tab" data-kind="rules">RULES</button>
        <button class="filter-tab" data-kind="skills">SKILLS</button>
        <button class="filter-tab" data-kind="tools">MICRO-TOOLS</button>
      </div>
      <input type="text" class="search-input" id="cap-search-input" placeholder="Search capabilities, symbols, or tags..." />
    </div>
    <div class="caps-grid" id="caps-list"></div>
  </div>

  <div class="card">
    <h2 id="hdr-gk">5. Deterministic 4-Stage Gatekeeper Audit Stream</h2>
    <div class="stream-box" id="gatekeeper-stream"></div>
  </div>

  <div class="drawer" id="drawer">
    <span class="drawer-close" id="drawer-close-btn">&times;</span>
    <h3 id="drawer-title" style="color: var(--accent); margin-bottom: 12px; font-size: 18px;"></h3>
    <pre id="drawer-content"></pre>
  </div>

  <script>${clientScript}</script>
</body>
</html>`;
}
