export interface UiRenderOptions {
  token?: string;
  isExport?: boolean;
  anon?: boolean;
}

export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string {
  const isExport = Boolean(options.isExport);
  const token = options.token || '';
  const anon = Boolean(options.anon);

  // Inlined Snapshot JSON with safe entity escaping (\u003c for <)
  const safeSnapshotJson = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/=/g, '\\u003d');

  const clientScript = `
(function() {
  var snapshot = ${safeSnapshotJson};
  var token = ${JSON.stringify(token)};
  var isExport = ${isExport ? 'true' : 'false'};
  var isAnon = ${anon ? 'true' : 'false'};

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

  function renderHero() {
    var score = snapshot.score || {};
    var savings = score.contextSavings || { beforeTokens: 0, afterTokens: 0, savedTokens: 0, savingsPercent: 0, userStaticRuleTokens: 0, evoSeedTokens: 0 };
    var overall = score.overallScore || 0;
    
    el('hero-score-val').textContent = overall + ' / 100';
    el('hero-mode').textContent = (score.mode || 'project').toUpperCase();
    el('hero-ws').textContent = isAnon ? '<WORKSPACE>' : (score.workspaceRoot || '');
    el('hero-before-tok').textContent = (savings.beforeTokens || 0).toLocaleString();
    el('hero-after-tok').textContent = (savings.afterTokens || 0).toLocaleString();
    el('hero-saved-tok').textContent = (savings.savedTokens || 0).toLocaleString() + ' (-' + (savings.savingsPercent || 0) + '%)';
    if (el('hero-static-tok')) el('hero-static-tok').textContent = (savings.userStaticRuleTokens || 0).toLocaleString();
    if (el('hero-seed-tok')) el('hero-seed-tok').textContent = (savings.evoSeedTokens || 0).toLocaleString();
    
    // Treemap / Server bars
    var mcp = score.mcpTax || { servers: [] };
    var mcpContainer = el('mcp-treemap');
    mcpContainer.innerHTML = '';
    var uTok = savings.userStaticRuleTokens || 0;
    var sTok = savings.evoSeedTokens || 0;
    var totalTax = (mcp.totalTaxTokens || 0) + uTok + sTok || 1;
    (mcp.servers || []).forEach(function(s) {
      var bar = document.createElement('div');
      bar.className = 'mcp-bar ' + (s.status === 'pooled' ? 'status-pooled' : 'status-active');
      var pct = Math.max(6, Math.round((s.estimatedTokens / totalTax) * 100));
      bar.style.width = pct + '%';
      bar.title = s.name + ': ~' + s.estimatedTokens + ' tok (' + s.status + ')';
      bar.innerHTML = '<span class="mcp-name">' + s.name + '</span><span class="mcp-tok">~' + s.estimatedTokens + 't</span>';
      mcpContainer.appendChild(bar);
    });
    if (uTok > 0) {
      var uBar = document.createElement('div');
      uBar.className = 'mcp-bar status-user-rules';
      var uPct = Math.max(6, Math.round((uTok / totalTax) * 100));
      uBar.style.width = uPct + '%';
      uBar.title = 'User Static Rules: ~' + uTok + ' tok';
      uBar.innerHTML = '<span class="mcp-name">UserRules</span><span class="mcp-tok">~' + uTok + 't</span>';
      mcpContainer.appendChild(uBar);
    }
    if (sTok > 0) {
      var sBar = document.createElement('div');
      sBar.className = 'mcp-bar status-evo-seed';
      var sPct = Math.max(6, Math.round((sTok / totalTax) * 100));
      sBar.style.width = sPct + '%';
      sBar.title = 'Evo Seed: ~' + sTok + ' tok';
      sBar.innerHTML = '<span class="mcp-name">EvoSeed</span><span class="mcp-tok">~' + sTok + 't</span>';
      mcpContainer.appendChild(sBar);
    }

    // Hotspots table
    var hsContainer = el('hotspots-body');
    hsContainer.innerHTML = '';
    (score.gitHotspots || []).slice(0, 10).forEach(function(h) {
      var row = document.createElement('tr');
      row.className = h.unprotected ? 'row-unprotected' : 'row-protected';
      var fname = esc(isAnon ? h.filePath.replace(/^.*[\\\\/]/, '') : h.filePath);
      row.innerHTML = 
        '<td class="hs-file">' + fname + '</td>' +
        '<td>' + h.fragilityScore + ' (' + h.fixRevertCommits + ' fix)</td>' +
        '<td>' + (h.memoryCount + h.scopedRuleCount) + '</td>' +
        '<td><span class="tag ' + (h.unprotected ? 'tag-warn' : 'tag-ok') + '">' +
        (h.unprotected ? 'UNPROTECTED' : 'PROTECTED') + '</span></td>';
      hsContainer.appendChild(row);
    });
  }

  function renderCapabilities() {
    var capsContainer = el('caps-list');
    capsContainer.innerHTML = '';
    var kinds = ['rules', 'skills', 'tools', 'memories'];
    kinds.forEach(function(k) {
      var items = snapshot[k] || [];
      items.forEach(function(item) {
        var card = document.createElement('div');
        card.className = 'cap-card cap-' + k;
        var title = esc(item.title || item.name || item.id);
        var summary = esc(item.l0_summary || item.description || '');
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
            '<span class="cap-id">' + esc(item.id) + '</span>' +
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
    (snapshot.gatekeeperEvents || []).slice(0, 50).forEach(function(ev) {
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

  // Bind interactive event listeners (no inline HTML onclick to conform to strict CSP)
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
      renderCapabilities();
      renderGatekeeper();
    });
  }

  renderHero();
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
      --bg: #090d16;
      --card-bg: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --text-dim: #9ca3af;
      --accent: #38bdf8;
      --green: #34d399;
      --yellow: #fbbf24;
      --red: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace, sans-serif; background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; color: var(--accent); }
    .badge { background: #1e293b; color: var(--accent); padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-family: monospace; display: inline-block; }
    .btn { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary { background: #374151; }
    .btn-secondary:hover { background: #4b5563; }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 18px; }
    .card h2 { font-size: 16px; margin-bottom: 12px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 6px; }

    .score-banner { display: flex; align-items: baseline; gap: 16px; margin-bottom: 12px; }
    .score-val { font-size: 42px; font-weight: 800; color: var(--green); }
    .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1f293780; font-size: 14px; }
    .mcp-bar-container { display: flex; height: 36px; border-radius: 6px; overflow: hidden; background: #1f2937; margin-top: 12px; }
    .mcp-bar { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; font-size: 11px; font-family: monospace; overflow: hidden; white-space: nowrap; }
    .status-active { background: #d97706; color: #fff; }
    .status-pooled { background: #059669; color: #fff; }
    .status-user-rules { background: #4f46e5; color: #fff; }
    .status-evo-seed { background: #0284c7; color: #fff; }
    .attr-helped { background: #064e3b; color: #34d399; }
    .attr-contested { background: #78350f; color: #fbbf24; }
    .attr-hurt { background: #7f1d1d; color: #f87171; }
    .attr-unverified { background: #1f2937; color: #9ca3af; }
    .fresh-verified { background: #064e3b; color: #34d399; margin-left: 4px; }
    .fresh-other_branch { background: #1e3a8a; color: #60a5fa; margin-left: 4px; }
    .fresh-stale { background: #7f1d1d; color: #f87171; margin-left: 4px; }
    .cap-hits { font-size: 11px; color: var(--text-dim); margin-left: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; font-family: monospace; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
    th { color: var(--text-dim); }
    .tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .tag-ok { background: #064e3b; color: var(--green); }
    .tag-warn { background: #7f1d1d; color: var(--red); }
    .caps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; max-height: 380px; overflow-y: auto; padding-right: 4px; }
    .cap-card { background: #1f2937; border: 1px solid #374151; border-radius: 6px; padding: 12px; cursor: pointer; transition: transform 0.1s; }
    .cap-card:hover { transform: translateY(-2px); border-color: var(--accent); }
    .cap-header { display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px; }
    .cap-kind { font-weight: 700; color: var(--accent); }
    .cap-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cap-summary { font-size: 12px; color: var(--text-dim); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .stream-box { font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; background: #0b0f19; padding: 8px; border-radius: 6px; border: 1px solid var(--border); }
    .event-item { padding: 4px 0; border-bottom: 1px solid #1e293b; }
    .ev-pass { color: var(--green); }
    .ev-fail { color: var(--red); }
    .ev-time { color: var(--text-dim); }
    .ev-badge { font-weight: 700; }

    .drawer { position: fixed; top: 0; right: -500px; width: 480px; height: 100%; background: #111827; border-left: 1px solid var(--border); box-shadow: -4px 0 24px rgba(0,0,0,0.5); padding: 24px; transition: right 0.25s ease; z-index: 100; overflow-y: auto; }
    .drawer.open { right: 0; }
    .drawer-close { float: right; cursor: pointer; font-size: 20px; color: var(--text-dim); }
    pre { background: #030712; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 12px; margin-top: 12px; border: 1px solid var(--border); white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>🧬 EvoKernel Live Cockpit</h1>
      <span class="badge" id="hero-mode">MODE</span> &nbsp;<span id="hero-ws" style="font-size: 13px; color: var(--text-dim);"></span>
    </div>
    <div>
      <button class="btn btn-secondary" id="btn-anon-toggle" style="margin-right: 8px;">Anon: OFF</button>
      <button class="btn" id="btn-export-png">Export Card PNG</button>
    </div>
  </header>

  <div class="grid-2">
    <div class="card">
      <h2>Context & MCP Tax Virtualization</h2>
      <div class="score-banner">
        <div class="score-val" id="hero-score-val">--</div>
        <div style="font-size: 14px; color: var(--text-dim);">Health & Efficiency Index</div>
      </div>
      <div class="stat-row"><span>Before EvoKernel (Eager Tax):</span><strong id="hero-before-tok">--</strong></div>
      <div class="stat-row"><span>After EvoKernel (Virtual Load):</span><strong id="hero-after-tok">--</strong></div>
      <div class="stat-row"><span>Net Virtualized Tokens Saved:</span><strong id="hero-saved-tok" style="color: var(--green);">--</strong></div>
      <div class="stat-row"><span>Host Rules (Static / Evo Seed):</span><span style="font-size: 13px;"><strong id="hero-static-tok">--</strong> / <strong id="hero-seed-tok">--</strong> tok</span></div>
      <div style="margin-top: 14px; font-size: 12px; color: var(--text-dim);">MCP Schemas & Rules (Orange: Active, Green: Pooled, Blue: Rules):</div>
      <div class="mcp-bar-container" id="mcp-treemap"></div>
    </div>

    <div class="card">
      <h2>Fragile Hotspots & Shielding Coverage</h2>
      <table id="hotspots-table">
        <thead>
          <tr>
            <th>Hotspot File</th>
            <th>Fragility (Fixes)</th>
            <th>Anchors</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="hotspots-body"></tbody>
      </table>
    </div>
  </div>

  <div class="card" style="margin-bottom: 24px;">
    <h2>Capability Constellation (Rules, Skills, Tools, Memories)</h2>
    <div class="caps-grid" id="caps-list"></div>
  </div>

  <div class="card">
    <h2>Gatekeeper Security & Invariant Audit Stream (200-Event Buffer)</h2>
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
