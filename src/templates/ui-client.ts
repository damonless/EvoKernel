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

  // UI State
  var currentView = 'capabilities';
  var activeCapsKind = 'all';
  var activeCapsStatus = 'all';
  var capsSearchQuery = '';
  var activeGkFilter = 'all';
  var selectedCapability = null; // { kind: string, item: any }
  var inspectorMode = 'preview'; // 'preview' | 'edit'
  var lang = 'en';

  // Command Palette State
  var cmdPaletteOpen = false;
  var cmdItems = [];
  var cmdActiveIndex = 0;

  var i18n = {
    en: {
      brandName: 'EvoKernel',
      brandSubtitle: 'Workbench 2.0',
      activeWorkspace: 'Active Workspace',
      searchPlaceholder: 'Search capabilities, files, actions...',
      serverLive: 'LIVE',
      serverOffline: 'OFFLINE',
      viewsHeader: 'VIEWS',
      viewCaps: 'Capabilities',
      viewTopo: 'Topology',
      viewHotspots: 'Git Hotspots',
      viewGk: 'Gatekeeper',
      telemetryHeader: 'TELEMETRY',
      healthTitle: 'Health Score',
      healthSub: 'Zero-leak AST shielding',
      taxTitle: 'Prompt Tax Saved',
      budgetTitle: 'Core Rule Budget',
      budgetStatusOk: 'Within safe limit',
      budgetStatusWarn: 'Nearing 1500-token cap',
      budgetStatusExceeded: 'Budget exceeded!',
      treemapTitle: 'Virtual Footprint',
      capsViewTitle: 'Capabilities Matrix',
      capsViewSub: 'High-density inspection of rules, skills, tools, and episodic memories',
      allKinds: 'All',
      rules: 'Rules',
      skills: 'Skills',
      tools: 'Tools',
      memories: 'Memories',
      allStatus: 'All Status',
      statusVerified: 'Verified',
      statusStale: 'Stale',
      statusCore: 'Core',
      statusScoped: 'Scoped',
      topoTitle: 'Orthogonal Capability & AST Topology',
      topoSub: 'Rules & Skills → Cognitive Memories → AST Source Files & Callers',
      legendVerified: 'Verified',
      legendContested: 'Branch / Contested',
      legendStale: 'Stale / Drift',
      legendHint: 'Hover or click node for focus dimming',
      hotspotsTitle: 'Fragile Git Hotspots & AST Shielding Matrix',
      hotspotsSub: 'High-churn files tracked by bug-fix commits and shielded by AST memories',
      gkTitle: 'Deterministic 4-Stage Gatekeeper Audit Stream',
      gkSub: 'Proposal audit timeline: Static Security, Sandbox self-test, AST Grounding, Quotas',
      gkPassAll: 'All evolved capabilities passed 4-Stage Deterministic Gatekeeper.',
      noSelectionTitle: 'No Capability Selected',
      noSelectionSub: 'Select any Rule, Skill, Tool, or Memory from the data table or topology graph to inspect.',
      openInIde: '↗ Open in IDE',
      verifyAst: '✓ Verify AST',
      verifyingAst: 'Verifying...',
      promoteCore: '↑ Promote to Core',
      demoteScoped: '↓ Demote to Scoped',
      runSelfTest: '▶ Run Self-Test',
      edit: '✎ Edit',
      preview: '👁 Preview',
      archive: '⌫ Archive',
      astAnchors: 'AST Code Anchors',
      saveChanges: 'Save Changes',
      cancel: 'Cancel',
      sandboxConsole: 'Sandbox Terminal Console'
    },
    zh: {
      brandName: 'EvoKernel',
      brandSubtitle: '工作台 2.0',
      activeWorkspace: '当前工作区',
      searchPlaceholder: '全局搜索能力、文件、指令 (⌘K)...',
      serverLive: '实时在线',
      serverOffline: '离线',
      viewsHeader: '视图导航',
      viewCaps: '能力矩阵',
      viewTopo: '拓扑星图',
      viewHotspots: 'Git 热点',
      viewGk: '门禁审计',
      telemetryHeader: '实时遥测',
      healthTitle: '健康评分',
      healthSub: '零泄漏 AST 符号护栏',
      taxTitle: 'Prompt 净省税率',
      budgetTitle: '核心规则预算',
      budgetStatusOk: '处于安全预算内',
      budgetStatusWarn: '接近 1500 token 上限',
      budgetStatusExceeded: '超出核心预算上限！',
      treemapTitle: '虚拟化内存占用',
      capsViewTitle: '自演化能力矩阵',
      capsViewSub: '高密度透视规则、技能、沙盒微工具与认知记忆',
      allKinds: '全部类型',
      rules: '规则',
      skills: '技能',
      tools: '微工具',
      memories: '认知记忆',
      allStatus: '全状态',
      statusVerified: '已验证',
      statusStale: '已失效',
      statusCore: '核心',
      statusScoped: '局部',
      topoTitle: '正交能力与 AST 调用拓扑图',
      topoSub: '规则与技能 → 认知记忆 → 源码 AST 文件与调用链',
      legendVerified: '已验证',
      legendContested: '多分支 / 争议',
      legendStale: '失效漂移',
      legendHint: '悬停或点击节点聚焦高亮关联链路',
      hotspotsTitle: 'Git 脆弱代码热点与 AST 护栏矩阵',
      hotspotsSub: '按修复提交频次统计的高频脆弱文件及其绑定的 AST 记忆护栏',
      gkTitle: '确定性四阶 Gatekeeper 门禁审计流',
      gkSub: '提案审计流水线：静态安全检查、沙盒自测、AST 锚定与预算配额',
      gkPassAll: '所有演进能力均已严格通过确定性四阶门禁。',
      noSelectionTitle: '未选中任何能力',
      noSelectionSub: '请在数据表格或拓扑图中点击任意规则、技能、工具或记忆进行深度透视。',
      openInIde: '↗ 在 IDE 中打开',
      verifyAst: '✓ 验证 AST 状态',
      verifyingAst: '验证计算中...',
      promoteCore: '↑ 提升为核心规则',
      demoteScoped: '↓ 降级为局部规则',
      runSelfTest: '▶ 执行沙盒自测',
      edit: '✎ 在线编辑',
      preview: '👁 结构化预览',
      archive: '⌫ 归档',
      astAnchors: 'AST 源码锚点',
      saveChanges: '保存变更',
      cancel: '取消',
      sandboxConsole: '沙盒终端控制台'
    }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatKind(k) {
    if (!k) return '';
    if (k === 'memories' || k === 'memory') return 'MEMORY';
    return String(k).replace(/s$/, '').toUpperCase();
  }

  // ==========================================
  // DUAL-MODE BRIDGE (VS CODE & STANDALONE HTTP)
  // ==========================================
  var vscodeApi = null;
  if (typeof acquireVsCodeApi === 'function') {
    try { vscodeApi = acquireVsCodeApi(); } catch (e) {}
  } else if (window.__vscodeApi__) {
    vscodeApi = window.__vscodeApi__;
  }

  var pendingActionCallbacks = {};
  if (vscodeApi) {
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg && msg.type === 'evoActionResult' && msg.reqId && pendingActionCallbacks[msg.reqId]) {
        pendingActionCallbacks[msg.reqId](msg);
        delete pendingActionCallbacks[msg.reqId];
      }
    });
  }

  function callKernelAction(action, params) {
    params = params || {};
    if (isExport && !vscodeApi) {
      showToast('info', 'Offline export mode: "' + action + '" requires a live server ("evo ui").');
      return Promise.resolve({ ok: false, error: 'Offline export mode' });
    }

    if (vscodeApi) {
      return new Promise(function(resolve) {
        var reqId = 'act_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        var timer = setTimeout(function() {
          if (pendingActionCallbacks[reqId]) {
            delete pendingActionCallbacks[reqId];
            resolve({ ok: false, error: 'Timeout waiting for extension host response' });
          }
        }, 10000);

        pendingActionCallbacks[reqId] = function(msg) {
          clearTimeout(timer);
          if (msg.error) {
            resolve({ ok: false, error: msg.error });
          } else {
            resolve({ ok: true, data: msg.data, result: msg.result, snapshot: msg.snapshot, action: action });
          }
        };

        vscodeApi.postMessage({ type: 'evoAction', reqId: reqId, action: action, params: params });
      });
    }

    return fetch('/api/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Evo-UI-Token': token
      },
      body: JSON.stringify({ action: action, params: params })
    })
    .then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) {
          return { ok: false, error: data.error || ('HTTP ' + res.status), code: data.code, details: data.details };
        }
        return data;
      });
    })
    .catch(function(err) {
      return { ok: false, error: err.message || 'Network request failed' };
    });
  }

  // ==========================================
  // TOAST NOTIFICATION SYSTEM
  // ==========================================
  function showToast(type, message, durationMs) {
    var container = el('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast-item';
    var icon = type === 'success'
      ? '<span style="color:var(--status-ok);">✓</span>'
      : (type === 'error' ? '<span style="color:var(--status-danger);">✕</span>' : '<span style="color:var(--status-info);">ℹ</span>');
    toast.innerHTML = icon + '<span>' + esc(message) + '</span>';
    container.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, durationMs || 3500);
  }

  // ==========================================
  // VIEW SWITCHER & NAVIGATION
  // ==========================================
  function switchView(viewName) {
    currentView = viewName;
    var buttons = document.querySelectorAll('.nav-item');
    var targetBtn = null;
    buttons.forEach(function(b) {
      if (b.getAttribute('data-view') === viewName) {
        b.classList.add('active');
        targetBtn = b;
      } else {
        b.classList.remove('active');
      }
    });

    var slidingPill = el('nav-sliding-pill');
    if (slidingPill && targetBtn) {
      slidingPill.style.transform = 'translateY(' + targetBtn.offsetTop + 'px)';
    }

    var panels = document.querySelectorAll('.view-panel');
    panels.forEach(function(p) {
      if (p.id === 'view-' + viewName) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });

    if (viewName === 'topology') {
      renderCardTopology();
    }
  }

  // ==========================================
  // TELEMETRY & LEFT RAIL BENTO
  // ==========================================
  function renderTelemetry() {
    var score = snapshot.score || {};
    var savings = score.contextSavings || { beforeTokens: 0, afterTokens: 0, savedTokens: 0, savingsPercent: 0, userStaticRuleTokens: 0, evoSeedTokens: 0 };
    var overall = score.overallScore !== undefined ? score.overallScore : 98;
    var grade = score.grade || (overall >= 95 ? 'A+' : (overall >= 85 ? 'A' : 'B'));

    // 1. Health Score
    if (el('bento-health-val')) el('bento-health-val').textContent = String(overall);
    if (el('bento-health-grade')) el('bento-health-grade').textContent = 'Grade ' + grade;

    // 2. Prompt Tax Saved
    var pct = savings.savingsPercent !== undefined ? savings.savingsPercent : -89;
    var pctText = pct > 0 ? ('-' + pct + '%') : (pct + '%');
    if (el('bento-saved-pct')) el('bento-saved-pct').textContent = pctText;
    if (el('bento-saved-detail')) {
      el('bento-saved-detail').textContent = (savings.afterTokens || 0).toLocaleString() + ' tok vs ' + (savings.beforeTokens || 0).toLocaleString() + ' tok';
    }

    // 3. Core Rule Budget (1500 tokens limit)
    var coreTokens = savings.evoSeedTokens || 0;
    if (coreTokens === 0 && snapshot.rules) {
      coreTokens = snapshot.rules
        .filter(function(r) { return r.core; })
        .reduce(function(acc, r) {
          return acc + (r.token_count || r.tokens || Math.ceil((r.l0_summary || '').length / 4));
        }, 0);
    }
    if (el('bento-budget-cur')) el('bento-budget-cur').textContent = String(coreTokens);
    var budgetPct = Math.min(100, Math.round((coreTokens / 1500) * 100));
    var budgetBar = el('bento-budget-bar');
    var budgetStatus = el('bento-budget-status');
    var dict = i18n[lang] || i18n.en;

    if (budgetBar) {
      budgetBar.style.width = budgetPct + '%';
      budgetBar.classList.remove('bar-warn', 'bar-danger');
      if (coreTokens > 1500) {
        budgetBar.classList.add('bar-danger');
        if (budgetStatus) budgetStatus.textContent = dict.budgetStatusExceeded;
      } else if (coreTokens >= 1200) {
        budgetBar.classList.add('bar-warn');
        if (budgetStatus) budgetStatus.textContent = dict.budgetStatusWarn;
      } else {
        if (budgetStatus) budgetStatus.textContent = dict.budgetStatusOk;
      }
    }

    // 4. Micro Treemap Footprint
    var treemap = el('micro-treemap');
    if (treemap) {
      treemap.innerHTML = '';
      var toolCount = (snapshot.tools || []).length;
      var skillCount = (snapshot.skills || []).length;
      var memoryCount = (snapshot.memories || []).length;
      var ruleCount = (snapshot.rules || []).length;
      var totalCaps = Math.max(1, toolCount + skillCount + memoryCount + ruleCount);

      var segs = [
        { name: 'Tools', count: toolCount, color: '#10b981' },
        { name: 'Skills', count: skillCount, color: '#38bdf8' },
        { name: 'Memories', count: memoryCount, color: '#a855f7' },
        { name: 'Rules', count: ruleCount, color: '#f59e0b' }
      ];

      segs.forEach(function(s) {
        if (s.count <= 0) return;
        var segEl = document.createElement('div');
        segEl.className = 'micro-treemap-segment';
        segEl.style.flex = String(s.count);
        segEl.style.backgroundColor = s.color;
        segEl.title = s.name + ': ' + s.count;
        treemap.appendChild(segEl);
      });
    }

    // Badges in View Switcher
    var capsTotal = (snapshot.rules || []).length + (snapshot.skills || []).length + (snapshot.tools || []).length + (snapshot.memories || []).length;
    if (el('badge-count-caps')) el('badge-count-caps').textContent = String(capsTotal);
    var hotspotsCount = (snapshot.score && snapshot.score.gitHotspots ? snapshot.score.gitHotspots.length : 0);
    if (el('badge-count-hotspots')) el('badge-count-hotspots').textContent = String(hotspotsCount);
    var gkCount = (snapshot.gatekeeperEvents ? snapshot.gatekeeperEvents.length : 0);
    if (el('badge-count-gk')) el('badge-count-gk').textContent = String(gkCount);

    // Topbar workspace
    var wsRoot = score.workspaceRoot || '~/workspace';
    if (isAnon) wsRoot = '~/workspace';
    if (el('topbar-ws-path')) {
      el('topbar-ws-path').textContent = wsRoot;
      el('topbar-ws-path').title = wsRoot;
    }
  }

  // ==========================================
  // VIEW 1: HIGH-DENSITY CAPABILITIES TABLE
  // ==========================================
  function renderCapabilitiesTable() {
    var tbody = el('capabilities-table-body');
    var emptyState = el('caps-empty-state');
    var countLabel = el('caps-count-label');
    if (!tbody) return;
    tbody.innerHTML = '';

    var kinds = ['rules', 'skills', 'tools', 'memories'];
    var q = (capsSearchQuery || '').toLowerCase().trim();
    var rows = [];

    kinds.forEach(function(k) {
      if (activeCapsKind !== 'all' && activeCapsKind !== k) return;
      var list = snapshot[k] || [];
      list.forEach(function(item) {
        var isCore = (k === 'rules') ? Boolean(item.core) : false;
        var memStatus = item.freshness ? item.freshness.overall_status : (k === 'memories' ? 'VERIFIED' : '');

        if (activeCapsStatus === 'verified' && memStatus !== 'VERIFIED') return;
        if (activeCapsStatus === 'stale' && memStatus !== 'STALE') return;
        if (activeCapsStatus === 'core' && (!isCore || k !== 'rules')) return;
        if (activeCapsStatus === 'scoped' && (isCore || k !== 'rules')) return;

        if (q) {
          var str = [
            item.id || '',
            item.title || item.name || '',
            item.l0_summary || item.description || '',
            item.symptom || '',
            item.scope_glob || '',
            (item.target_symbols || []).join(' ')
          ].join(' ').toLowerCase();
          if (str.indexOf(q) === -1) return;
        }

        rows.push({ kind: k, item: item });
      });
    });

    if (countLabel) countLabel.textContent = rows.length + ' items';

    if (rows.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    rows.forEach(function(row) {
      var k = row.kind;
      var it = row.item;
      var tr = document.createElement('tr');
      tr.className = 'row-interactive';
      tr.setAttribute('data-kind', k);
      tr.setAttribute('data-id', it.id);
      if (selectedCapability && selectedCapability.item && selectedCapability.item.id === it.id) {
        tr.classList.add('row-selected');
      }

      var kindBadge = '<span class="badge-kind">' + formatKind(k) + '</span>';
      var titleText = esc(it.title || it.name || it.id || '');
      var idText = esc(it.id || '');
      var titleCol = '<div class="item-title-wrap">' +
        '<span class="item-main-title">' + titleText + '</span>' +
        '<span class="item-sub-id">' + idText + '</span>' +
        '</div>';

      var statusCol = '';
      if (k === 'rules') {
        statusCol = it.core
          ? '<span class="badge-status"><span class="dot dot-ok"></span> CORE</span>'
          : '<span class="badge-status">SCOPED <span style="color:#71717a;">(' + esc(it.scope_glob || '*') + ')</span></span>';
      } else if (k === 'memories') {
        var st = (it.freshness && it.freshness.overall_status) || 'VERIFIED';
        var dotCls = st === 'VERIFIED' ? 'dot-ok' : (st === 'STALE' ? 'dot-danger' : 'dot-warn');
        statusCol = '<span class="badge-status"><span class="dot ' + dotCls + '"></span> ' + st + '</span>';
      } else if (k === 'tools') {
        statusCol = '<span class="badge-status">SANDBOX (' + esc(it.runtime || 'node') + ')</span>';
      } else {
        statusCol = '<span class="badge-status">SKILL SOP</span>';
      }

      var hits = it.hit_count || 0;
      var attr = it.attribution || 'unverified';
      var attrDot = attr === 'helped' ? 'dot-ok' : (attr === 'hurt' ? 'dot-danger' : (attr === 'contested' ? 'dot-warn' : ''));
      var attrHtml = '<span class="badge-status">' +
        (attrDot ? '<span class="dot ' + attrDot + '"></span> ' : '') +
        attr + ' · ' + hits + 'h</span>';

      var actionCol = '<div style="text-align: right; display: flex; gap: 6px; justify-content: flex-end;">' +
        '<button type="button" class="btn-action row-inspect-btn" data-kind="' + k + '" data-id="' + esc(it.id) + '">Inspect</button>' +
        '</div>';

      tr.innerHTML = '<td>' + kindBadge + '</td>' +
        '<td>' + titleCol + '</td>' +
        '<td>' + statusCol + '</td>' +
        '<td>' + attrHtml + '</td>' +
        '<td>' + actionCol + '</td>';

      tr.addEventListener('click', function(e) {
        if (e.target.closest('.row-inspect-btn')) {
          e.stopPropagation();
        }
        selectCapability(k, it);
      });

      var inspectBtn = tr.querySelector('.row-inspect-btn');
      if (inspectBtn) {
        inspectBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          selectCapability(k, it);
        });
      }

      tbody.appendChild(tr);
    });
  }

  // ==========================================
  // VIEW 2: ORTHOGONAL ROUND-RECT CARD TOPOLOGY
  // ==========================================
  function renderCardTopology() {
    var svg = el('topology-svg');
    if (!svg) return;
    svg.innerHTML = '';
    var ns = 'http://www.w3.org/2000/svg';

    var rules = snapshot.rules || [];
    var skills = snapshot.skills || [];
    var memories = snapshot.memories || [];

    var leftNodes = [];
    rules.forEach(function(r) {
      leftNodes.push({ id: 'rule:' + r.id, raw: r, kind: 'rules', label: r.title || r.id, sub: r.id, core: r.core });
    });
    skills.forEach(function(s) {
      leftNodes.push({ id: 'skill:' + s.id, raw: s, kind: 'skills', label: s.name || s.id, sub: s.id });
    });

    var midNodes = [];
    var rightMap = {};
    var rightNodes = [];

    memories.forEach(function(m) {
      var mNode = {
        id: 'mem:' + m.id,
        raw: m,
        kind: 'memories',
        label: m.title || m.id,
        sub: (m.freshness && m.freshness.overall_status) || 'VERIFIED',
        status: (m.freshness && m.freshness.overall_status) || 'VERIFIED'
      };
      midNodes.push(mNode);

      var fps = m.ast_fingerprints || {};
      var syms = m.target_symbols || [];
      syms.forEach(function(sym) {
        if (!rightMap[sym]) {
          rightMap[sym] = {
            id: 'ast:' + sym,
            label: sym.replace(/^.*[\\\\/]/, ''),
            sub: sym,
            fullSymbol: sym,
            callers: (m.freshness && m.freshness.callers) || []
          };
          rightNodes.push(rightMap[sym]);
        }
      });
      Object.keys(fps).forEach(function(k) {
        var fp = fps[k] || {};
        var fpath = fp.file_path || fp.file;
        if (fpath && !rightMap[fpath]) {
          rightMap[fpath] = {
            id: 'ast:' + fpath,
            label: fpath.replace(/^.*[\\\\/]/, ''),
            sub: fp.structural_hash ? fp.structural_hash.slice(0, 16) : fpath,
            fullSymbol: fpath,
            callers: []
          };
          rightNodes.push(rightMap[fpath]);
        }
      });
    });

    var col1X = 40;
    var col2X = 370;
    var col3X = 700;
    var cardW = 230;
    var cardH = 46;
    var slotH = 62;

    leftNodes.forEach(function(n, i) { n.x = col1X; n.y = 30 + i * slotH; });
    midNodes.forEach(function(n, i) { n.x = col2X; n.y = 30 + i * slotH; });
    rightNodes.forEach(function(n, i) { n.x = col3X; n.y = 30 + i * slotH; });

    var maxCount = Math.max(leftNodes.length, midNodes.length, rightNodes.length, 6);
    var totalH = maxCount * slotH + 80;
    svg.setAttribute('width', '980');
    svg.setAttribute('height', String(totalH));
    svg.setAttribute('viewBox', '0 0 980 ' + totalH);

    var edges = [];
    var outgoing = new Map();
    var incoming = new Map();

    function addEdge(fromId, toId, fromNode, toNode) {
      edges.push({ fromId: fromId, toId: toId, fromNode: fromNode, toNode: toNode });
      if (!outgoing.has(fromId)) outgoing.set(fromId, []);
      outgoing.get(fromId).push(toId);
      if (!incoming.has(toId)) incoming.set(toId, []);
      incoming.get(toId).push(fromId);
    }

    leftNodes.forEach(function(ln) {
      midNodes.forEach(function(mn) {
        var matched = false;
        if (ln.kind === 'rules' && ln.raw.scope_glob && ln.raw.scope_glob !== '*') {
          var globPrefix = ln.raw.scope_glob.replace(/\\*.*$/, '');
          var fps = mn.raw.ast_fingerprints || {};
          Object.keys(fps).forEach(function(k) {
            var f = (fps[k] && (fps[k].file_path || fps[k].file)) || '';
            if (f.indexOf(globPrefix) !== -1) matched = true;
          });
        }
        if (matched || (ln.raw.core && midNodes.indexOf(mn) < 3)) {
          addEdge(ln.id, mn.id, ln, mn);
        }
      });
    });

    midNodes.forEach(function(mn) {
      rightNodes.forEach(function(rn) {
        var syms = mn.raw.target_symbols || [];
        var fps = mn.raw.ast_fingerprints || {};
        var hasSym = syms.indexOf(rn.fullSymbol) !== -1;
        var hasFp = Object.keys(fps).some(function(k) {
          return (fps[k] && (fps[k].file_path || fps[k].file)) === rn.fullSymbol;
        });
        if (hasSym || hasFp) {
          addEdge(mn.id, rn.id, mn, rn);
        }
      });
    });

    // Connector Edges Layer (Cubic Bezier Curves)
    var edgeGroup = document.createElementNS(ns, 'g');
    edgeGroup.setAttribute('id', 'topo-edge-layer');
    edges.forEach(function(e) {
      var path = document.createElementNS(ns, 'path');
      var x1 = e.fromNode.x + cardW;
      var y1 = e.fromNode.y + cardH / 2;
      var x2 = e.toNode.x;
      var y2 = e.toNode.y + cardH / 2;
      var cp1X = x1 + 50;
      var cp2X = x2 - 50;
      var d = 'M ' + x1 + ' ' + y1 + ' C ' + cp1X + ' ' + y1 + ', ' + cp2X + ' ' + y2 + ', ' + x2 + ' ' + y2;

      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#3f3f46');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('class', 'topo-edge');
      path.setAttribute('data-from', e.fromId);
      path.setAttribute('data-to', e.toId);
      e.el = path;
      edgeGroup.appendChild(path);
    });
    svg.appendChild(edgeGroup);

    // Node Cards Layer
    var allNodes = [].concat(leftNodes, midNodes, rightNodes);
    var nodeGroup = document.createElementNS(ns, 'g');
    nodeGroup.setAttribute('id', 'topo-node-layer');

    allNodes.forEach(function(n) {
      var g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'topo-node');
      g.setAttribute('data-id', n.id);
      g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
      n.el = g;

      var rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('width', String(cardW));
      rect.setAttribute('height', String(cardH));
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', '#141417');
      rect.setAttribute('stroke', '#27272a');
      rect.setAttribute('stroke-width', '1');
      g.appendChild(rect);

      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', '14');
      dot.setAttribute('cy', '23');
      dot.setAttribute('r', '3');
      var dotColor = '#10b981';
      if (n.status === 'STALE') dotColor = '#ef4444';
      else if (n.status === 'OTHER_BRANCH') dotColor = '#f59e0b';
      dot.setAttribute('fill', dotColor);
      g.appendChild(dot);

      var title = document.createElementNS(ns, 'text');
      title.setAttribute('x', '26');
      title.setAttribute('y', '19');
      title.setAttribute('fill', '#fafafa');
      title.setAttribute('font-size', '11.5');
      title.setAttribute('font-weight', '500');
      title.textContent = n.label.length > 24 ? n.label.slice(0, 23) + '…' : n.label;
      g.appendChild(title);

      var sub = document.createElementNS(ns, 'text');
      sub.setAttribute('x', '26');
      sub.setAttribute('y', '33');
      sub.setAttribute('fill', '#71717a');
      sub.setAttribute('font-size', '9.5');
      sub.setAttribute('font-family', 'monospace');
      sub.textContent = n.sub.length > 28 ? '…' + n.sub.slice(-27) : n.sub;
      g.appendChild(sub);

      g.addEventListener('mouseenter', function() { applyFocusDimming(n.id); });
      g.addEventListener('mouseleave', function() { resetFocusDimming(); });
      g.addEventListener('click', function() {
        if (n.raw && n.kind) {
          selectCapability(n.kind, n.raw);
        } else if (n.fullSymbol) {
          var targetPath = n.fullSymbol.split('#')[0];
          callKernelAction('open-editor', { filePath: targetPath, line: 1 }).then(function(res) {
            if (res.ok) showToast('success', 'Opened ' + targetPath);
            else showToast('error', res.error || 'Failed to open file');
          });
        }
      });

      nodeGroup.appendChild(g);
    });
    svg.appendChild(nodeGroup);

    function applyFocusDimming(targetId) {
      var activeSet = new Set([targetId]);
      (outgoing.get(targetId) || []).forEach(function(id) {
        activeSet.add(id);
        (outgoing.get(id) || []).forEach(function(subId) { activeSet.add(subId); });
      });
      (incoming.get(targetId) || []).forEach(function(id) {
        activeSet.add(id);
        (incoming.get(id) || []).forEach(function(subId) { activeSet.add(subId); });
      });

      allNodes.forEach(function(n) {
        if (activeSet.has(n.id)) {
          n.el.style.opacity = '1.0';
          n.el.querySelector('rect').setAttribute('stroke', n.id === targetId ? '#52525b' : '#3f3f46');
          n.el.querySelector('rect').setAttribute('stroke-width', n.id === targetId ? '1.5' : '1');
        } else {
          n.el.style.opacity = '0.2';
          n.el.querySelector('rect').setAttribute('stroke', '#27272a');
          n.el.querySelector('rect').setAttribute('stroke-width', '1');
        }
      });

      edges.forEach(function(e) {
        if (activeSet.has(e.fromId) && activeSet.has(e.toId)) {
          e.el.style.opacity = '1.0';
          e.el.setAttribute('stroke', '#10b981');
          e.el.setAttribute('stroke-width', '2');
        } else {
          e.el.style.opacity = '0.08';
          e.el.setAttribute('stroke', '#27272a');
          e.el.setAttribute('stroke-width', '1');
        }
      });
    }

    function resetFocusDimming() {
      allNodes.forEach(function(n) {
        n.el.style.opacity = '1.0';
        n.el.querySelector('rect').setAttribute('stroke', '#27272a');
        n.el.querySelector('rect').setAttribute('stroke-width', '1');
      });
      edges.forEach(function(e) {
        e.el.style.opacity = '1.0';
        e.el.setAttribute('stroke', '#3f3f46');
        e.el.setAttribute('stroke-width', '1.5');
      });
    }
  }

  // ==========================================
  // VIEW 3: GIT FRAGILE HOTSPOTS VIEW
  // ==========================================
  function renderHotspotsTable() {
    var tbody = el('hotspots-table-body');
    var kpiBadge = el('hotspots-summary-kpi');
    var emptyState = el('hotspots-empty-state');
    if (!tbody) return;
    tbody.innerHTML = '';

    var hotspots = (snapshot.score && snapshot.score.gitHotspots) || [];
    var total = hotspots.length;
    var unprot = (snapshot.score && snapshot.score.unprotectedHotspots) || 0;
    var prot = Math.max(0, total - unprot);

    if (kpiBadge) {
      kpiBadge.textContent = prot + ' / ' + total + ' Protected';
    }

    if (hotspots.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    var fileToMem = {};
    (snapshot.memories || []).forEach(function(m) {
      var fps = m.ast_fingerprints || {};
      var syms = m.target_symbols || [];
      syms.forEach(function(s) {
        var f = s.split('#')[0].replace(/\\\\/g, '/');
        if (!fileToMem[f]) fileToMem[f] = [];
        fileToMem[f].push(m);
      });
      Object.keys(fps).forEach(function(k) {
        var f = (fps[k].file_path || fps[k].file || '').replace(/\\\\/g, '/');
        if (f) {
          if (!fileToMem[f]) fileToMem[f] = [];
          fileToMem[f].push(m);
        }
      });
    });

    hotspots.forEach(function(h) {
      var tr = document.createElement('tr');
      tr.className = 'row-interactive';
      tr.setAttribute('data-path', h.filePath);

      var boundMems = fileToMem[h.filePath.replace(/\\\\/g, '/')] || [];
      var statusHtml = h.unprotected
        ? '<span class="badge-status"><span class="dot dot-danger"></span> UNPROTECTED</span>'
        : '<span class="badge-status"><span class="dot dot-ok"></span> PROTECTED</span>';

      var memChipsContainer = document.createElement('div');
      memChipsContainer.className = 'mem-chips-wrap';
      if (boundMems.length > 0) {
        boundMems.forEach(function(bm) {
          var chip = document.createElement('span');
          chip.className = 'chip-memory';
          chip.textContent = '#' + bm.id;
          chip.setAttribute('data-mem-id', bm.id);
          chip.addEventListener('click', function(e) {
            e.stopPropagation();
            selectCapability('memories', bm);
          });
          memChipsContainer.appendChild(chip);
        });
      } else {
        memChipsContainer.innerHTML = '<span style="color:#71717a; font-size:11px;">(None)</span>';
      }

      var tdPath = document.createElement('td');
      tdPath.innerHTML = '<code style="color:#fafafa;">' + esc(h.filePath) + '</code>';

      var tdFrag = document.createElement('td');
      tdFrag.innerHTML = '<strong style="color:#fafafa;">' + h.fragilityScore + '</strong>';

      var tdCommits = document.createElement('td');
      tdCommits.innerHTML = h.fixRevertCommits + ' <span style="color:#71717a;">(' + h.commits + ' total)</span>';

      var tdMems = document.createElement('td');
      tdMems.appendChild(memChipsContainer);

      var tdStatus = document.createElement('td');
      tdStatus.innerHTML = statusHtml;

      var tdAction = document.createElement('td');
      tdAction.style.textAlign = 'right';
      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn-action';
      openBtn.textContent = 'Open ↗';
      openBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
          if (res.ok) showToast('success', 'Opened hotspot in IDE: ' + h.filePath);
          else showToast('error', res.error || 'Failed to open file');
        });
      });
      tdAction.appendChild(openBtn);

      tr.appendChild(tdPath);
      tr.appendChild(tdFrag);
      tr.appendChild(tdCommits);
      tr.appendChild(tdMems);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAction);

      tr.addEventListener('click', function() {
        callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
          if (res.ok) showToast('success', 'Opened hotspot: ' + h.filePath);
          else showToast('error', res.error || 'Failed to open file');
        });
      });

      tbody.appendChild(tr);
    });
  }

  // ==========================================
  // VIEW 4: GATEKEEPER AUDIT STREAM
  // ==========================================
  function renderGatekeeperStream() {
    var container = el('gatekeeper-timeline');
    if (!container) return;
    container.innerHTML = '';
    var dict = i18n[lang] || i18n.en;

    var events = snapshot.gatekeeperEvents || [];
    if (events.length === 0) {
      var cleanBox = document.createElement('div');
      cleanBox.className = 'gk-event-card';
      cleanBox.innerHTML = '<div style="color:var(--status-ok); font-weight:600;"><span class="dot dot-ok"></span> ' + esc(dict.gkPassAll) + '</div>' +
        '<div style="color:var(--text-muted); font-size:11.5px; margin-top:4px;">' + esc(dict.gkSub) + '</div>';
      container.appendChild(cleanBox);
      return;
    }

    events.forEach(function(ev) {
      if (activeGkFilter === 'pass' && !ev.passed) return;
      if (activeGkFilter === 'fail' && ev.passed) return;

      var card = document.createElement('div');
      card.className = 'gk-event-card';

      var dotCls = ev.passed ? 'dot-ok' : 'dot-danger';
      var timeStr = esc((ev.timestamp || '').replace('T', ' ').slice(0, 19));

      var topHtml = '<div class="gk-event-hdr">' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
        '<span class="badge-kind">' + formatKind(ev.kind) + '</span>' +
        '<strong style="color:var(--text-primary); font-family:var(--font-mono);">' + esc(ev.target_id || '') + '</strong>' +
        (ev.stage_failed ? '<span style="color:var(--status-danger); font-size:11px;">[' + esc(ev.stage_failed) + ']</span>' : '') +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
        '<span class="badge-status"><span class="dot ' + dotCls + '"></span> ' + (ev.passed ? 'PASS' : 'REJECT') + '</span>' +
        '<span style="color:var(--text-muted); font-size:11px;">' + timeStr + '</span>' +
        '</div>' +
        '</div>';

      var diagHtml = '';
      if (ev.diagnostics) {
        diagHtml = '<pre class="gk-diag-pre">' + esc(ev.diagnostics) + '</pre>';
      }

      card.innerHTML = topHtml + diagHtml;
      container.appendChild(card);
    });
  }

  // ==========================================
  // RIGHT STRUCTURED INSPECTOR
  // ==========================================
  function selectCapability(kind, item) {
    selectedCapability = { kind: kind, item: item };
    inspectorMode = 'preview';
    renderInspector();
    renderCapabilitiesTable();
  }

  function renderInspector() {
    var placeholder = el('inspector-placeholder');
    var content = el('inspector-content');
    if (!content) return;
    content.innerHTML = '';

    if (!selectedCapability) {
      if (placeholder) placeholder.style.display = 'flex';
      content.style.display = 'none';
      return;
    }

    if (placeholder) placeholder.style.display = 'none';
    content.style.display = 'flex';

    var kind = selectedCapability.kind;
    var item = selectedCapability.item;
    var dict = i18n[lang] || i18n.en;

    // 1. Header
    var header = document.createElement('div');
    header.className = 'inspector-header';
    var fresh = (item.freshness && item.freshness.overall_status) || (kind === 'memories' ? 'VERIFIED' : '');
    var statusBadge = '';
    if (fresh) {
      var sDot = fresh === 'VERIFIED' ? 'dot-ok' : (fresh === 'STALE' ? 'dot-danger' : 'dot-warn');
      statusBadge = '<span class="badge-status"><span class="dot ' + sDot + '"></span> ' + esc(fresh) + '</span>';
    } else if (kind === 'rules') {
      statusBadge = item.core
        ? '<span class="badge-status"><span class="dot dot-ok"></span> CORE</span>'
        : '<span class="badge-status">SCOPED</span>';
    } else if (kind === 'tools') {
      statusBadge = '<span class="badge-status">SANDBOX</span>';
    }

    var topRow = document.createElement('div');
    topRow.className = 'inspector-top-row';
    topRow.innerHTML = '<div class="inspector-badges"><span class="badge-kind">' + formatKind(kind) + '</span>' + statusBadge + '</div>';

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn-action';
    btnClose.style.padding = '2px 8px';
    btnClose.textContent = '✕';
    btnClose.title = 'Close Inspector';
    btnClose.addEventListener('click', function() {
      selectedCapability = null;
      renderInspector();
      renderCapabilitiesTable();
    });
    topRow.appendChild(btnClose);

    var titleEl = document.createElement('div');
    titleEl.className = 'inspector-title';
    titleEl.textContent = item.title || item.name || item.id;

    var idEl = document.createElement('div');
    idEl.className = 'inspector-id';
    idEl.textContent = item.id;

    header.appendChild(topRow);
    header.appendChild(titleEl);
    header.appendChild(idEl);
    content.appendChild(header);

    // 2. Action Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'inspector-toolbar';

    // Button: Open in IDE
    var btnOpen = document.createElement('button');
    btnOpen.type = 'button';
    btnOpen.className = 'btn-action';
    btnOpen.textContent = dict.openInIde;
    btnOpen.addEventListener('click', function() {
      var filePath = '';
      var line = 1;
      if (kind === 'memories') {
        var anchors = (item.freshness && item.freshness.topology_anchors) || [];
        if (anchors[0]) {
          filePath = anchors[0].file_path;
          line = parseInt(String(anchors[0].lines || '1').split('-')[0].replace(/[^0-9]/g, ''), 10) || 1;
        } else if (item.target_symbols && item.target_symbols[0]) {
          filePath = item.target_symbols[0].split('#')[0];
        }
      } else if (kind === 'rules') {
        filePath = item.core ? ('.evo/rules/' + item.id + '.md') : ('.evo/rules/scoped/' + item.id + '.md');
      } else if (kind === 'skills') {
        filePath = '.evo/skills/' + item.id + '/SKILL.md';
      } else if (kind === 'tools') {
        filePath = item.script_path || ('.evo/tools/' + item.id + '/' + (item.entry_script || 'run.mjs'));
      }
      if (filePath) {
        callKernelAction('open-editor', { filePath: filePath, line: line }).then(function(res) {
          if (res.ok) showToast('success', 'Opened in editor: ' + filePath + (line > 1 ? ':' + line : ''));
          else showToast('error', res.error || 'Failed to open file');
        });
      }
    });
    toolbar.appendChild(btnOpen);

    // Button: Verify AST (Memories)
    if (kind === 'memories') {
      var btnVerify = document.createElement('button');
      btnVerify.type = 'button';
      btnVerify.className = 'btn-action';
      btnVerify.textContent = dict.verifyAst;
      btnVerify.addEventListener('click', function() {
        btnVerify.textContent = dict.verifyingAst;
        callKernelAction('verify-memory', { id: item.id }).then(function(res) {
          btnVerify.textContent = dict.verifyAst;
          if (res.ok && res.snapshot) {
            snapshot = res.snapshot;
            var updated = (snapshot.memories || []).find(function(m) { return m.id === item.id; });
            if (updated) selectedCapability.item = updated;
            renderInspector();
            renderCapabilitiesTable();
            showToast('success', 'AST verification complete');
          } else {
            showToast('error', res.error || 'Verification failed');
          }
        });
      });
      toolbar.appendChild(btnVerify);
    }

    // Button: Toggle Core / Scoped (Rules)
    if (kind === 'rules') {
      var btnToggleCore = document.createElement('button');
      btnToggleCore.type = 'button';
      btnToggleCore.className = 'btn-action';
      btnToggleCore.textContent = item.core ? dict.demoteScoped : dict.promoteCore;
      btnToggleCore.addEventListener('click', function() {
        callKernelAction('toggle-rule-tier', { id: item.id, core: !item.core }).then(function(res) {
          if (res.ok) {
            item.core = !item.core;
            renderInspector();
            renderCapabilitiesTable();
            renderTelemetry();
            showToast('success', 'Rule moved to ' + (item.core ? 'Core (' + res.tokenUsage + '/1500 tok)' : 'Scoped'));
          } else {
            showToast('error', res.error || 'Failed to toggle tier');
          }
        });
      });
      toolbar.appendChild(btnToggleCore);
    }

    // Button: Run Self-Test (Tools)
    if (kind === 'tools') {
      var btnRunTest = document.createElement('button');
      btnRunTest.type = 'button';
      btnRunTest.className = 'btn-action';
      btnRunTest.textContent = dict.runSelfTest;
      btnRunTest.addEventListener('click', function() {
        runToolSelfTest(item.id);
      });
      toolbar.appendChild(btnRunTest);
    }

    // Button: Edit / Preview
    var btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'btn-action';
    btnEdit.textContent = inspectorMode === 'edit' ? dict.preview : dict.edit;
    btnEdit.addEventListener('click', function() {
      inspectorMode = inspectorMode === 'edit' ? 'preview' : 'edit';
      renderInspector();
    });
    toolbar.appendChild(btnEdit);

    // Button: Archive
    var btnArchive = document.createElement('button');
    btnArchive.type = 'button';
    btnArchive.className = 'btn-action btn-danger';
    btnArchive.textContent = dict.archive;
    btnArchive.addEventListener('click', function() {
      if (confirm('Archive capability "' + item.id + '" to .evo/archive/?')) {
        callKernelAction('archive-item', { kind: kind.replace(/s$/, ''), id: item.id }).then(function(res) {
          if (res.ok) {
            showToast('success', 'Archived ' + item.id);
            selectedCapability = null;
            renderInspector();
            renderCapabilitiesTable();
          } else {
            showToast('error', res.error || 'Archive failed');
          }
        });
      }
    });
    toolbar.appendChild(btnArchive);

    content.appendChild(toolbar);

    // 3. AST Anchors Section (Memories)
    if (kind === 'memories') {
      var anchors = (item.freshness && item.freshness.topology_anchors) || [];
      var astSection = document.createElement('div');
      astSection.className = 'inspector-section';
      astSection.innerHTML = '<div class="inspector-section-title"><span>' + esc(dict.astAnchors) + ' (' + anchors.length + ')</span>' + statusBadge + '</div>';

      anchors.forEach(function(anchor) {
        var row = document.createElement('div');
        row.className = 'ast-anchor-card';
        var startLine = parseInt(String(anchor.lines || '1').split('-')[0].replace(/[^0-9]/g, ''), 10) || 1;
        row.innerHTML =
          '<div class="ast-anchor-path">' +
            '<span>' + esc(anchor.file_path) + '</span>' +
            '<span class="ast-anchor-symbol">#' + esc(anchor.symbol) + '</span>' +
          '</div>' +
          '<div class="ast-anchor-meta">' +
            '<span>' + esc(anchor.lines || 'L1') + '</span>' +
            '<span>' + ((anchor.callers || []).length) + ' callers</span>' +
            '<span style="margin-left:auto;">' + esc(anchor.status) + '</span>' +
          '</div>';

        row.addEventListener('click', function() {
          callKernelAction('open-editor', { filePath: anchor.file_path, line: startLine }).then(function(res) {
            if (res.ok) showToast('success', 'Jumped to ' + anchor.file_path + ':' + startLine);
            else showToast('error', res.error || 'Failed to jump to anchor');
          });
        });
        astSection.appendChild(row);
      });
      content.appendChild(astSection);
    }

    // 4. Content Section: Preview vs Editor
    var contentSection = document.createElement('div');
    contentSection.className = 'inspector-section';

    if (inspectorMode === 'edit') {
      contentSection.innerHTML =
        '<div class="inspector-section-title"><span>Inline Source Editor</span></div>' +
        '<textarea class="editor-textarea" id="inspector-editor-input"></textarea>' +
        '<div class="editor-footer">' +
          '<span id="editor-token-est">~0 tokens</span>' +
          '<div style="display:flex;gap:6px;">' +
            '<button type="button" class="btn-action" id="btn-editor-cancel">' + esc(dict.cancel) + '</button>' +
            '<button type="button" class="btn-action" id="btn-editor-save" style="background:var(--status-ok);color:#022c22;font-weight:700;">' + esc(dict.saveChanges) + '</button>' +
          '</div>' +
        '</div>';
      content.appendChild(contentSection);

      var txtInput = contentSection.querySelector('#inspector-editor-input');
      var rawText = item.content || item.script_code ||
        (item.l1_contract ? ('## L1 Contract\\n' + item.l1_contract + '\\n\\n## L2 SOP\\n' + item.l2_sop) :
        (item.symptom ? ('## Symptom\\n' + item.symptom + '\\n\\n## Root Cause\\n' + item.root_cause + '\\n\\n## Solution\\n' + item.solution) :
        JSON.stringify(item, null, 2)));
      txtInput.value = rawText;

      var tokenEstEl = contentSection.querySelector('#editor-token-est');
      function updateTokenEstimate() {
        if (tokenEstEl) tokenEstEl.textContent = '~' + Math.ceil(txtInput.value.length / 4) + ' tokens';
      }
      updateTokenEstimate();
      txtInput.addEventListener('input', updateTokenEstimate);

      txtInput.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          var start = this.selectionStart;
          var end = this.selectionEnd;
          this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
          this.selectionStart = this.selectionEnd = start + 2;
          updateTokenEstimate();
        }
      });

      contentSection.querySelector('#btn-editor-cancel').addEventListener('click', function() {
        inspectorMode = 'preview';
        renderInspector();
      });

      contentSection.querySelector('#btn-editor-save').addEventListener('click', function() {
        var newContent = txtInput.value;
        callKernelAction('update-content', { kind: kind.replace(/s$/, ''), id: item.id, content: newContent }).then(function(res) {
          if (res.ok) {
            showToast('success', 'Changes saved to ' + item.id);
            item.content = newContent;
            inspectorMode = 'preview';
            renderInspector();
          } else {
            showToast('error', res.error || 'Save failed');
          }
        });
      });
    } else {
      // Structured Bento Preview
      if (kind === 'memories' && (item.symptom || item.root_cause || item.solution)) {
        contentSection.innerHTML =
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-danger);">' +
            '<div class="bento-card-label" style="color:var(--status-danger);">Symptom</div>' +
            '<div class="bento-card-content">' + esc(item.symptom) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-warn);">' +
            '<div class="bento-card-label" style="color:var(--status-warn);">Root Cause</div>' +
            '<div class="bento-card-content">' + esc(item.root_cause) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-ok);">' +
            '<div class="bento-card-label" style="color:var(--status-ok);">Solution</div>' +
            '<div class="bento-card-content">' + esc(item.solution) + '</div>' +
          '</div>';
      } else if (kind === 'skills' && (item.l1_contract || item.l2_sop)) {
        contentSection.innerHTML =
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label" style="color:var(--status-info);">L1 Contract</div>' +
            '<div class="bento-card-content">' + esc(item.l1_contract) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label" style="color:var(--status-ok);">L2 SOP</div>' +
            '<div class="bento-card-content">' + esc(item.l2_sop) + '</div>' +
          '</div>';
      } else {
        contentSection.innerHTML =
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label">Summary &amp; Description</div>' +
            '<div class="bento-card-content">' + esc(item.l0_summary || item.description || '') + '</div>' +
          '</div>' +
          (item.content ? '<div class="bento-card-preview"><div class="bento-card-label">Content</div><div class="bento-card-content">' + esc(item.content) + '</div></div>' : '');
      }
      content.appendChild(contentSection);
    }

    // 5. Tool Sandbox Terminal Section
    if (kind === 'tools') {
      var termSection = document.createElement('div');
      termSection.className = 'inspector-section';
      termSection.id = 'inspector-tool-terminal';
      termSection.innerHTML =
        '<div class="inspector-section-title">' +
          '<span>' + esc(dict.sandboxConsole) + '</span>' +
          '<span id="term-status-badge" class="badge-status">IDLE</span>' +
        '</div>' +
        '<div class="terminal-screen" id="term-screen">$ evo run ' + esc(item.id) + ' --self-test\\nClick "Run Self-Test" to execute.</div>';
      content.appendChild(termSection);
    }
  }

  function runToolSelfTest(toolId) {
    var termBadge = el('term-status-badge');
    var termScreen = el('term-screen');
    if (termBadge) termBadge.textContent = 'RUNNING...';
    if (termScreen) termScreen.textContent = '$ evo run ' + toolId + ' --self-test\\nExecuting in sandbox (5000ms timeout)...';

    callKernelAction('run-tool-test', { id: toolId }).then(function(res) {
      if (!termScreen || !termBadge) return;
      if (res.ok && res.result) {
        var r = res.result;
        var pass = r.exitCode === 0 && !r.timedOut;
        termBadge.textContent = pass ? ('EXIT 0 · PASS (' + r.durationMs + 'ms)') : ('EXIT ' + r.exitCode + ' · FAIL');
        termBadge.style.color = pass ? 'var(--status-ok)' : 'var(--status-danger)';
        var out = '$ evo run ' + toolId + ' --self-test\\n' +
          (r.stdout ? (r.stdout + '\\n') : '') +
          (r.stderr ? ('[STDERR]\\n' + r.stderr + '\\n') : '') +
          (r.timedOut ? '[TIMEOUT] Execution exceeded 5000ms sandbox limit\\n' : '') +
          '----------------------------------------\\nExit Code: ' + r.exitCode + ' · Duration: ' + r.durationMs + 'ms';
        termScreen.textContent = out;
        showToast(pass ? 'success' : 'error', 'Self-test ' + (pass ? 'passed' : 'failed') + ' (' + r.durationMs + 'ms)');
      } else {
        termBadge.textContent = 'ERROR';
        termScreen.textContent = 'Execution failed: ' + (res.error || 'unknown error');
        showToast('error', res.error || 'Tool test failed');
      }
    });
  }

  // ==========================================
  // COMMAND PALETTE (CMD/CTRL + K)
  // ==========================================
  function openCommandPalette() {
    cmdPaletteOpen = true;
    var backdrop = el('cmd-palette-backdrop');
    if (backdrop) backdrop.classList.add('open');
    var input = el('cmd-palette-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    updateCommandPaletteResults('');
  }

  function closeCommandPalette() {
    cmdPaletteOpen = false;
    var backdrop = el('cmd-palette-backdrop');
    if (backdrop) backdrop.classList.remove('open');
  }

  function updateCommandPaletteResults(q) {
    q = (q || '').toLowerCase().trim();
    cmdItems = [];
    var listContainer = el('cmd-palette-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    // Group 1: Capabilities
    var kinds = ['rules', 'skills', 'tools', 'memories'];
    var capMatches = [];
    kinds.forEach(function(k) {
      (snapshot[k] || []).forEach(function(it) {
        var title = String(it.title || it.name || it.id || '');
        var sum = String(it.l0_summary || it.description || '');
        if (!q || title.toLowerCase().indexOf(q) !== -1 || sum.toLowerCase().indexOf(q) !== -1 || it.id.toLowerCase().indexOf(q) !== -1) {
          capMatches.push({ kind: k, item: it, title: title, id: it.id });
        }
      });
    });

    if (capMatches.length > 0) {
      var grpHdr = document.createElement('div');
      grpHdr.className = 'cmd-group-title';
      grpHdr.textContent = 'Capabilities';
      listContainer.appendChild(grpHdr);

      capMatches.slice(0, 8).forEach(function(c) {
        var row = document.createElement('div');
        row.className = 'cmd-item';
        var kLabel = formatKind(c.kind);
        row.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span class="badge-kind">' + esc(kLabel) + '</span>' +
            '<span>' + esc(c.title || c.id) + '</span>' +
          '</div>' +
          '<span class="kbd-shortcut">' + esc(c.id) + '</span>';

        var actionObj = {
          execute: function() {
            selectCapability(c.kind, c.item);
            closeCommandPalette();
          }
        };
        row.addEventListener('click', actionObj.execute);
        listContainer.appendChild(row);
        cmdItems.push({ el: row, action: actionObj.execute });
      });
    }

    // Group 2: Git Hotspots
    var hsMatches = (snapshot.score && snapshot.score.gitHotspots || []).filter(function(h) {
      return !q || h.filePath.toLowerCase().indexOf(q) !== -1;
    });
    if (hsMatches.length > 0) {
      var grpHdr2 = document.createElement('div');
      grpHdr2.className = 'cmd-group-title';
      grpHdr2.textContent = 'Fragile Git Hotspots';
      listContainer.appendChild(grpHdr2);

      hsMatches.slice(0, 5).forEach(function(h) {
        var row = document.createElement('div');
        row.className = 'cmd-item';
        row.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span class="badge-status" style="color:var(--status-warn);"><span class="dot dot-warn"></span> HOTSPOT</span>' +
            '<span>' + esc(h.filePath) + '</span>' +
          '</div>' +
          '<span class="kbd-shortcut">f:' + h.fragilityScore + '</span>';

        var actionObj = {
          execute: function() {
            callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
              if (res.ok) showToast('success', 'Opened hotspot in IDE: ' + h.filePath);
              else showToast('error', res.error || 'Failed to open hotspot');
            });
            closeCommandPalette();
          }
        };
        row.addEventListener('click', actionObj.execute);
        listContainer.appendChild(row);
        cmdItems.push({ el: row, action: actionObj.execute });
      });
    }

    // Group 3: Global Actions
    var globalCmds = [
      {
        title: 'Verify All AST Memories',
        sub: 'Recompute AST freshness for all cognitive memories',
        run: function() {
          showToast('info', 'Verifying all AST memories...');
          callKernelAction('verify-memory', {}).then(function(res) {
            if (res.ok && res.snapshot) {
              snapshot = res.snapshot;
              renderTelemetry();
              renderCapabilitiesTable();
              showToast('success', 'Verified AST memories');
            } else {
              showToast('error', res.error || 'Verification failed');
            }
          });
        }
      },
      {
        title: 'Switch View: Capabilities Data Table',
        sub: 'High-density table with filters',
        run: function() { switchView('capabilities'); }
      },
      {
        title: 'Switch View: Orthogonal Card Topology',
        sub: '3-tier orthogonal round-rect layout with focus dimming',
        run: function() { switchView('topology'); }
      },
      {
        title: 'Switch View: Git Hotspots Matrix',
        sub: 'Fragile churn files and shielding memories',
        run: function() { switchView('hotspots'); }
      },
      {
        title: 'Switch View: Gatekeeper Audit Stream',
        sub: '4-stage deterministic proposal timeline',
        run: function() { switchView('gatekeeper'); }
      },
      {
        title: 'Toggle Language (EN / 中文)',
        sub: 'Switch localization dictionary',
        run: function() {
          lang = lang === 'en' ? 'zh' : 'en';
          applyI18n();
        }
      }
    ];

    var filteredCmds = globalCmds.filter(function(gc) {
      return !q || gc.title.toLowerCase().indexOf(q) !== -1 || gc.sub.toLowerCase().indexOf(q) !== -1;
    });

    if (filteredCmds.length > 0) {
      var grpHdr3 = document.createElement('div');
      grpHdr3.className = 'cmd-group-title';
      grpHdr3.textContent = 'Global Commands';
      listContainer.appendChild(grpHdr3);

      filteredCmds.forEach(function(gc) {
        var row = document.createElement('div');
        row.className = 'cmd-item';
        row.innerHTML =
          '<div>' +
            '<div>' + esc(gc.title) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);">' + esc(gc.sub) + '</div>' +
          '</div>' +
          '<span class="kbd-shortcut">↵</span>';

        var actionObj = {
          execute: function() {
            closeCommandPalette();
            gc.run();
          }
        };
        row.addEventListener('click', actionObj.execute);
        listContainer.appendChild(row);
        cmdItems.push({ el: row, action: actionObj.execute });
      });
    }

    cmdActiveIndex = 0;
    highlightCommandPaletteItem();
  }

  function highlightCommandPaletteItem() {
    cmdItems.forEach(function(it, idx) {
      if (idx === cmdActiveIndex) {
        it.el.classList.add('selected');
        it.el.scrollIntoView({ block: 'nearest' });
      } else {
        it.el.classList.remove('selected');
      }
    });
  }

  // ==========================================
  // I18N LOCALIZATION
  // ==========================================
  function applyI18n() {
    var dict = i18n[lang] || i18n.en;
    if (el('lang-label')) el('lang-label').textContent = lang.toUpperCase();
    if (el('topbar-brand-subtitle')) el('topbar-brand-subtitle').textContent = dict.brandSubtitle;
    if (el('search-placeholder-text')) el('search-placeholder-text').textContent = dict.searchPlaceholder;
    if (el('server-status-text')) el('server-status-text').textContent = dict.serverLive;

    // Left Rail
    if (el('rail-hdr-views')) el('rail-hdr-views').textContent = dict.viewsHeader;
    if (el('nav-label-caps')) el('nav-label-caps').textContent = dict.viewCaps;
    if (el('nav-label-topo')) el('nav-label-topo').textContent = dict.viewTopo;
    if (el('nav-label-hotspots')) el('nav-label-hotspots').textContent = dict.viewHotspots;
    if (el('nav-label-gk')) el('nav-label-gk').textContent = dict.viewGk;

    if (el('rail-hdr-telem')) el('rail-hdr-telem').textContent = dict.telemetryHeader;
    if (el('bento-title-health')) el('bento-title-health').textContent = dict.healthTitle;
    if (el('bento-title-tax')) el('bento-title-tax').textContent = dict.taxTitle;
    if (el('bento-title-budget')) el('bento-title-budget').textContent = dict.budgetTitle;
    if (el('bento-title-treemap')) el('bento-title-treemap').textContent = dict.treemapTitle;

    // Center Stage Headers
    if (el('caps-view-title')) el('caps-view-title').textContent = dict.capsViewTitle;
    if (el('caps-view-sub')) el('caps-view-sub').textContent = dict.capsViewSub;
    if (el('topo-view-title')) el('topo-view-title').textContent = dict.topoTitle;
    if (el('topo-view-sub')) el('topo-view-sub').textContent = dict.topoSub;
    if (el('hotspots-view-title')) el('hotspots-view-title').textContent = dict.hotspotsTitle;
    if (el('hotspots-view-sub')) el('hotspots-view-sub').textContent = dict.hotspotsSub;
    if (el('gk-view-title')) el('gk-view-title').textContent = dict.gkTitle;
    if (el('gk-view-sub')) el('gk-view-sub').textContent = dict.gkSub;

    // Inspector Placeholder
    if (el('inspector-placeholder-title')) el('inspector-placeholder-title').textContent = dict.noSelectionTitle;
    if (el('inspector-placeholder-sub')) el('inspector-placeholder-sub').textContent = dict.noSelectionSub;

    renderTelemetry();
    renderCapabilitiesTable();
    renderGatekeeperStream();
    if (selectedCapability) renderInspector();
  }

  // ==========================================
  // INITIALIZATION & EVENT ATTACHMENT
  // ==========================================
  // 1. View Switcher Navigation Buttons
  var viewSwitcher = el('nav-view-switcher');
  if (viewSwitcher) {
    viewSwitcher.addEventListener('click', function(e) {
      var btn = e.target.closest('.nav-item');
      if (!btn) return;
      var targetView = btn.getAttribute('data-view');
      if (targetView) switchView(targetView);
    });
  }

  // 2. Capabilities Kind & Status Pills
  var kindPillGroup = el('caps-kind-pills');
  var statusPillGroup = el('caps-status-pills');

  if (kindPillGroup) {
    kindPillGroup.addEventListener('click', function(e) {
      var pill = e.target.closest('.filter-pill');
      if (!pill) return;
      activeCapsKind = pill.getAttribute('data-kind') || 'all';
      kindPillGroup.querySelectorAll('.filter-pill').forEach(function(p) { p.classList.remove('active'); });
      pill.classList.add('active');

      // Auto-cooperative: reset incompatible status filters
      if (statusPillGroup) {
        if (activeCapsKind === 'memories' && (activeCapsStatus === 'core' || activeCapsStatus === 'scoped')) {
          activeCapsStatus = 'all';
        } else if (activeCapsKind === 'rules' && (activeCapsStatus === 'verified' || activeCapsStatus === 'stale')) {
          activeCapsStatus = 'all';
        } else if ((activeCapsKind === 'skills' || activeCapsKind === 'tools') && activeCapsStatus !== 'all') {
          activeCapsStatus = 'all';
        }
        statusPillGroup.querySelectorAll('.filter-pill').forEach(function(p) {
          p.classList.toggle('active', (p.getAttribute('data-status') || 'all') === activeCapsStatus);
        });
      }

      renderCapabilitiesTable();
    });
  }

  if (statusPillGroup) {
    statusPillGroup.addEventListener('click', function(e) {
      var pill = e.target.closest('.filter-pill');
      if (!pill) return;
      activeCapsStatus = pill.getAttribute('data-status') || 'all';
      statusPillGroup.querySelectorAll('.filter-pill').forEach(function(p) { p.classList.remove('active'); });
      pill.classList.add('active');

      // Auto-cooperative: adjust kind filter to match status
      if (kindPillGroup) {
        if ((activeCapsStatus === 'core' || activeCapsStatus === 'scoped') && activeCapsKind !== 'rules' && activeCapsKind !== 'all') {
          activeCapsKind = 'rules';
        } else if ((activeCapsStatus === 'verified' || activeCapsStatus === 'stale') && activeCapsKind !== 'memories' && activeCapsKind !== 'all') {
          activeCapsKind = 'memories';
        }
        kindPillGroup.querySelectorAll('.filter-pill').forEach(function(p) {
          p.classList.toggle('active', (p.getAttribute('data-kind') || 'all') === activeCapsKind);
        });
      }

      renderCapabilitiesTable();
    });
  }

  var capsSearch = el('caps-search-input');
  if (capsSearch) {
    capsSearch.addEventListener('input', function() {
      capsSearchQuery = capsSearch.value;
      renderCapabilitiesTable();
    });
  }

  // 3. Gatekeeper Filter Pills
  var gkPillGroup = el('gk-filter-pills');
  if (gkPillGroup) {
    gkPillGroup.addEventListener('click', function(e) {
      var pill = e.target.closest('.filter-pill');
      if (!pill) return;
      activeGkFilter = pill.getAttribute('data-filter') || 'all';
      gkPillGroup.querySelectorAll('.filter-pill').forEach(function(p) { p.classList.remove('active'); });
      pill.classList.add('active');
      renderGatekeeperStream();
    });
  }

  // 4. Command Palette Trigger & Backdrop
  var cmdTrigger = el('cmd-palette-trigger');
  if (cmdTrigger) {
    cmdTrigger.addEventListener('click', openCommandPalette);
  }

  var cmdBackdrop = el('cmd-palette-backdrop');
  if (cmdBackdrop) {
    cmdBackdrop.addEventListener('click', function(e) {
      if (e.target === cmdBackdrop) closeCommandPalette();
    });
  }

  var cmdInput = el('cmd-palette-input');
  if (cmdInput) {
    cmdInput.addEventListener('input', function() {
      updateCommandPaletteResults(cmdInput.value);
    });
  }

  // 5. Global Keyboard Shortcuts
  window.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (cmdPaletteOpen) closeCommandPalette();
      else openCommandPalette();
      return;
    }
    if (!cmdPaletteOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cmdItems.length > 0) {
        cmdActiveIndex = (cmdActiveIndex + 1) % cmdItems.length;
        highlightCommandPaletteItem();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdItems.length > 0) {
        cmdActiveIndex = (cmdActiveIndex - 1 + cmdItems.length) % cmdItems.length;
        highlightCommandPaletteItem();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cmdItems[cmdActiveIndex] && cmdItems[cmdActiveIndex].action) {
        cmdItems[cmdActiveIndex].action();
      }
    }
  });

  // 6. Language Toggle & Export Buttons
  var btnLang = el('btn-lang-toggle');
  if (btnLang) {
    btnLang.addEventListener('click', function() {
      lang = lang === 'en' ? 'zh' : 'en';
      applyI18n();
    });
  }

  var btnExport = el('btn-export-html');
  if (btnExport) {
    btnExport.addEventListener('click', function() {
      if (isExport) {
        showToast('info', 'Currently viewing standalone HTML report');
      } else {
        showToast('info', 'To export standalone bundle, run: evo ui --export cockpit.html');
      }
    });
  }

  // Initial Render
  applyI18n();
  switchView('capabilities');
  renderHotspotsTable();

  // 7. Live SSE Server Updates
  if (!isExport && token) {
    try {
      var evSrc = new EventSource('/api/events?token=' + encodeURIComponent(token));
      evSrc.addEventListener('message', function() {
        fetch('/api/snapshot?token=' + encodeURIComponent(token))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            snapshot = data;
            renderTelemetry();
            renderCapabilitiesTable();
            renderCardTopology();
            renderHotspotsTable();
            renderGatekeeperStream();
            if (selectedCapability) {
              var list = snapshot[selectedCapability.kind] || [];
              var found = list.find(function(it) { return it.id === selectedCapability.item.id; });
              if (found) {
                selectedCapability.item = found;
                renderInspector();
              }
            }
          })
          .catch(function() {});
      });
      evSrc.addEventListener('error', function() {
        var dot = el('status-dot');
        var label = el('server-status-text');
        if (dot) dot.classList.add('offline');
        if (label) label.textContent = 'OFFLINE';
      });
      evSrc.addEventListener('open', function() {
        var dot = el('status-dot');
        var label = el('server-status-text');
        if (dot) dot.classList.remove('offline');
        if (label) label.textContent = 'LIVE';
      });
    } catch (e) {}
  }
})();
`.trim().replace(/\r\n/g, '\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EvoKernel Workbench 2.0</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      /* --- Zinc Neutral Dark Palette --- */
      --bg-canvas: #09090b;       /* Zinc 950 */
      --bg-panel: #0f0f12;        /* Zinc 925 */
      --bg-surface: #141417;      /* Zinc 900 */
      --bg-elevated: #1c1c21;     /* Zinc 850 */
      --bg-input: #121215;

      /* --- Crisp 1px Subtle Borders --- */
      --border-subtle: #27272a;   /* Zinc 800 */
      --border-focus: #52525b;    /* Zinc 600 */
      --border-active: #3f3f46;   /* Zinc 700 */

      /* --- Text Typography --- */
      --text-primary: #fafafa;    /* Zinc 50 */
      --text-secondary: #a1a1aa;  /* Zinc 400 */
      --text-muted: #71717a;      /* Zinc 500 */

      /* --- Restrained Status Tokens --- */
      --status-ok: #10b981;       /* Emerald 500 */
      --status-ok-bg: rgba(16, 185, 129, 0.10);
      --status-ok-border: rgba(16, 185, 129, 0.25);

      --status-warn: #f59e0b;     /* Amber 500 */
      --status-warn-bg: rgba(245, 158, 11, 0.10);
      --status-warn-border: rgba(245, 158, 11, 0.25);

      --status-danger: #ef4444;   /* Red 500 */
      --status-danger-bg: rgba(239, 68, 68, 0.10);
      --status-danger-border: rgba(239, 68, 68, 0.25);

      --status-info: #3b82f6;     /* Blue 500 */
      --status-info-bg: rgba(59, 130, 246, 0.10);
      --status-info-border: rgba(59, 130, 246, 0.25);

      /* --- Cult-UI Bento Micro-Highlights --- */
      --surface-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
      --card-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.45);
      --modal-shadow: 0 20px 48px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px var(--border-subtle);

      /* --- Motion-Primitives Spring Curves --- */
      --ease-spring: cubic-bezier(0.22, 1, 0.36, 1);
      --duration-micro: 150ms;
      --duration-normal: 240ms;
      --duration-modal: 200ms;

      /* --- Fonts & Geometry --- */
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

      --topbar-height: 44px;
      --left-rail-width: 220px;
      --right-inspector-width: 380px;

      --radius-sm: 4px;
      --radius-md: 6px;
      --radius-lg: 8px;
      --radius-xl: 12px;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      height: 100vh;
      width: 100vw;
      overflow: hidden;
      background-color: var(--bg-canvas);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Minimalist Scrollbars */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--border-subtle);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--border-focus);
    }

    /* --- Global Workbench Root --- */
    .workbench-root {
      display: flex;
      flex-direction: column;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background-color: var(--bg-canvas);
    }

    /* --- Topbar: 44px Fixed --- */
    .topbar {
      height: var(--topbar-height);
      min-height: var(--topbar-height);
      background-color: var(--bg-panel);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      z-index: 20;
      box-shadow: var(--surface-highlight);
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-icon {
      font-size: 16px;
    }
    .brand-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .version-tag {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-subtle);
    }
    .workspace-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .workspace-pill .ws-icon {
      font-size: 11px;
    }

    .topbar-center {
      flex: 1;
      max-width: 440px;
      margin: 0 24px;
    }
    .search-trigger {
      width: 100%;
      height: 28px;
      background-color: var(--bg-input);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 0 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      transition: border-color var(--duration-micro) ease, background-color var(--duration-micro) ease;
    }
    .search-trigger:hover {
      border-color: var(--border-focus);
      background-color: var(--bg-elevated);
      color: var(--text-secondary);
    }
    .search-placeholder {
      flex: 1;
      text-align: left;
    }
    .kbd-shortcut {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      padding: 1px 5px;
      border-radius: var(--radius-sm);
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-indicator-live {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      padding: 3px 8px;
      border-radius: var(--radius-sm);
    }
    .status-dot-pulse {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--status-ok);
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
    }
    .status-dot-pulse.offline {
      background-color: var(--status-danger);
      box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
    }

    .topbar-btn {
      height: 28px;
      padding: 0 10px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all var(--duration-micro) ease;
    }
    .topbar-btn:hover {
      background-color: var(--bg-elevated);
      color: var(--text-primary);
      border-color: var(--border-focus);
    }

    /* --- 3-Column Body Shell --- */
    .workbench-body {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    /* --- Column 1: Left Navigation Rail (220px) --- */
    .left-rail {
      width: var(--left-rail-width);
      min-width: var(--left-rail-width);
      max-width: var(--left-rail-width);
      height: 100%;
      background-color: var(--bg-panel);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px 10px;
      gap: 16px;
    }

    .rail-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .rail-section-header {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0 8px;
      margin-bottom: 2px;
    }

    .nav-view-switcher {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nav-sliding-pill {
      position: absolute;
      left: 0;
      width: 100%;
      height: 32px;
      background-color: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      box-shadow: var(--surface-highlight);
      border-radius: var(--radius-md);
      transition: transform var(--duration-normal) var(--ease-spring), opacity var(--duration-micro) ease;
      pointer-events: none;
      z-index: 0;
    }
    .nav-item {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      padding: 0 10px;
      background: transparent;
      border: none;
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: color var(--duration-micro) ease;
    }
    .nav-item:hover {
      color: var(--text-primary);
    }
    .nav-item.active {
      color: var(--text-primary);
      font-weight: 600;
    }
    .nav-badge {
      margin-left: auto;
      font-family: var(--font-mono);
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-muted);
    }
    .nav-item.active .nav-badge {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-secondary);
    }

    /* Bento Telemetry Cards */
    .rail-telemetry {
      margin-top: auto;
      gap: 8px;
    }
    .bento-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      box-shadow: var(--surface-highlight), var(--card-shadow);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bento-title {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .bento-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .bento-metric-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .bento-metric-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
      font-family: var(--font-mono);
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    .bento-badge {
      font-size: 9.5px;
      font-weight: 600;
      font-family: var(--font-mono);
      padding: 1px 5px;
      border-radius: var(--radius-sm);
      background: var(--status-ok-bg);
      color: var(--status-ok);
      border: 1px solid var(--status-ok-border);
    }
    .bento-counter {
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--text-secondary);
    }
    .bento-subtext {
      font-size: 10.5px;
      color: var(--text-muted);
    }
    .text-emerald {
      color: var(--status-ok);
    }

    .progress-track {
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 2px;
      overflow: hidden;
      margin: 3px 0;
    }
    .progress-bar {
      height: 100%;
      background-color: var(--status-ok);
      border-radius: 2px;
      transition: width var(--duration-normal) var(--ease-spring), background-color var(--duration-micro) ease;
    }
    .progress-bar.bar-warn {
      background-color: var(--status-warn);
    }
    .progress-bar.bar-danger {
      background-color: var(--status-danger);
    }

    .micro-treemap-container {
      display: flex;
      height: 18px;
      gap: 2px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      background: rgba(0, 0, 0, 0.3);
      margin-top: 4px;
    }
    .micro-treemap-segment {
      height: 100%;
      transition: opacity var(--duration-micro) ease;
    }
    .micro-treemap-segment:hover {
      opacity: 0.85;
    }

    /* --- Column 2: Center Stage Canvas (flex: 1) --- */
    .center-stage {
      flex: 1;
      height: 100%;
      background-color: var(--bg-canvas);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .view-panel {
      display: none;
      flex: 1;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      flex-direction: column;
    }
    .view-panel.active {
      display: flex;
    }

    .view-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-panel);
      flex-shrink: 0;
      box-shadow: var(--surface-highlight);
    }
    .view-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .view-subtitle {
      font-size: 11.5px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .filter-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pill-group {
      display: flex;
      gap: 4px;
      background: rgba(0, 0, 0, 0.4);
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
    }
    .filter-pill {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 11.5px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all var(--duration-micro) var(--ease-spring);
    }
    .filter-pill:hover {
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.04);
    }
    .filter-pill.active {
      background: var(--bg-elevated);
      color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
    }

    .search-box {
      flex: 1;
      min-width: 200px;
    }
    .search-input {
      width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 12px;
      padding: 6px 12px;
      outline: none;
      font-family: var(--font-mono);
      transition: border-color var(--duration-micro) ease;
    }
    .search-input:focus {
      border-color: var(--border-focus);
    }
    .view-count-badge {
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    /* Tables */
    .table-scroll-container {
      flex: 1;
      overflow: auto;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .data-table th {
      position: sticky;
      top: 0;
      background: var(--bg-panel);
      color: var(--text-muted);
      font-weight: 500;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 8px 16px;
      border-bottom: 1px solid var(--border-subtle);
      text-align: left;
      z-index: 10;
    }
    .data-table td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      vertical-align: middle;
    }
    .data-table tr.row-interactive {
      cursor: pointer;
      transition: background 120ms ease;
    }
    .data-table tr.row-interactive:hover {
      background: rgba(255, 255, 255, 0.025);
    }
    .data-table tr.row-interactive.row-selected {
      background: rgba(255, 255, 255, 0.045);
    }

    .badge-kind {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      font-family: var(--font-mono);
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-elevated);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-family: var(--font-mono);
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }
    .dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .dot-ok { background: var(--status-ok); }
    .dot-warn { background: var(--status-warn); }
    .dot-danger { background: var(--status-danger); }

    .item-title-wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .item-main-title {
      color: var(--text-primary);
      font-weight: 500;
      max-width: 360px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-sub-id {
      color: var(--text-muted);
      font-size: 10.5px;
      font-family: var(--font-mono);
    }

    .empty-state {
      padding: 48px 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12.5px;
    }

    /* Topology */
    .topo-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .topo-legend {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 11.5px;
      color: var(--text-muted);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .legend-hint {
      color: var(--text-muted);
      font-size: 10.5px;
      border-left: 1px solid var(--border-subtle);
      padding-left: 12px;
    }
    .topo-scroll-container {
      flex: 1;
      overflow: auto;
      background: var(--bg-canvas);
      position: relative;
    }
    .topology-svg {
      display: block;
      min-width: 980px;
    }
    .topo-node {
      cursor: pointer;
      transition: opacity 200ms var(--ease-spring);
    }
    .topo-node rect {
      transition: stroke 150ms ease, stroke-width 150ms ease;
    }
    .topo-edge {
      transition: opacity 200ms var(--ease-spring), stroke 150ms ease, stroke-width 150ms ease;
    }

    /* Hotspots */
    .hotspots-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .hotspots-kpi-badge {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      background: var(--status-ok-bg);
      color: var(--status-ok);
      border: 1px solid var(--status-ok-border);
    }
    .chip-memory {
      display: inline-block;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--status-info);
      font-size: 10px;
      font-family: var(--font-mono);
      padding: 1px 6px;
      border-radius: 4px;
      margin: 2px;
      cursor: pointer;
      transition: border-color 120ms ease;
    }
    .chip-memory:hover {
      border-color: var(--status-info);
    }

    /* Gatekeeper Stream */
    .gk-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .timeline-scroll-container {
      flex: 1;
      overflow: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .gk-event-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 12px 16px;
      box-shadow: var(--surface-highlight);
    }
    .gk-event-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .gk-diag-pre {
      background: #09090b;
      border: 1px solid var(--border-subtle);
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 11px;
      font-family: var(--font-mono);
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* --- Column 3: Right Structured Inspector (380px) --- */
    .right-inspector {
      width: var(--right-inspector-width);
      min-width: var(--right-inspector-width);
      max-width: var(--right-inspector-width);
      height: 100%;
      background-color: var(--bg-panel);
      border-left: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
      box-shadow: inset 1px 0 0 0 rgba(255, 255, 255, 0.02);
    }
    .inspector-placeholder {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
      color: var(--text-muted);
      text-align: center;
    }
    .placeholder-icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.4;
    }
    .placeholder-text {
      font-size: 12px;
      line-height: 1.5;
    }

    .inspector-content {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
    .inspector-header {
      padding: 16px 20px 12px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-surface);
    }
    .inspector-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .inspector-badges {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .inspector-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
      line-height: 1.3;
      word-break: break-word;
    }
    .inspector-id {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      word-break: break-all;
    }
    .inspector-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-panel);
    }
    .btn-action {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: all var(--duration-micro) ease;
    }
    .btn-action:hover {
      background: var(--bg-elevated);
      border-color: var(--border-focus);
    }
    .btn-action.btn-danger {
      color: var(--status-danger);
      border-color: var(--status-danger-border);
    }
    .btn-action.btn-danger:hover {
      background: var(--status-danger-bg);
    }

    .inspector-section {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .inspector-section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ast-anchor-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: all var(--duration-micro) ease;
    }
    .ast-anchor-card:hover {
      background: var(--bg-elevated);
      border-color: var(--border-focus);
    }
    .ast-anchor-path {
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .ast-anchor-symbol {
      color: var(--status-info);
      font-weight: 600;
    }
    .ast-anchor-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .bento-card-preview {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 12px 14px;
      margin-bottom: 10px;
      box-shadow: var(--surface-highlight);
    }
    .bento-card-label {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
      text-transform: uppercase;
    }
    .bento-card-content {
      font-size: 12.5px;
      color: var(--text-primary);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .editor-textarea {
      width: 100%;
      height: 320px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      padding: 10px 12px;
      resize: vertical;
      outline: none;
    }
    .editor-textarea:focus {
      border-color: var(--border-focus);
    }
    .editor-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
    }

    .terminal-screen {
      background: #050507;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 10px 12px;
      font-family: var(--font-mono);
      font-size: 11px;
      line-height: 1.5;
      color: var(--text-secondary);
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* --- Command Palette Modal --- */
    .cmd-palette-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(9, 9, 11, 0.80);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 1000;
      align-items: flex-start;
      justify-content: center;
      padding-top: 14vh;
    }
    .cmd-palette-backdrop.open {
      display: flex;
    }
    .cmd-palette-modal {
      width: 100%;
      max-width: 600px;
      background-color: var(--bg-panel);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--modal-shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: modalScaleIn var(--duration-modal) var(--ease-spring);
    }
    @keyframes modalScaleIn {
      from { opacity: 0; transform: scale(0.97) translateY(-8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .cmd-palette-input-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-surface);
    }
    .cmd-palette-input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 14px;
      outline: none;
      font-family: var(--font-sans);
    }
    .cmd-palette-list {
      max-height: 340px;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .cmd-group-title {
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
      padding: 6px 12px 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .cmd-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12.5px;
      color: var(--text-secondary);
      transition: all 120ms ease;
    }
    .cmd-item.selected, .cmd-item:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    /* --- Toast Container --- */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast-item {
      pointer-events: auto;
      background: var(--bg-panel);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 10px 14px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), var(--surface-highlight);
      font-size: 12.5px;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: toastSlideIn 200ms var(--ease-spring) forwards;
      transition: opacity 220ms ease, transform 220ms var(--ease-spring);
    }
    @keyframes toastSlideIn {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
      .right-inspector {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        z-index: 30;
        transform: translateX(100%);
        transition: transform var(--duration-normal) var(--ease-spring);
        box-shadow: -8px 0 24px rgba(0, 0, 0, 0.6);
      }
      .right-inspector.open {
        transform: translateX(0);
      }
    }
    @media (max-width: 768px) {
      .left-rail {
        width: 52px;
        min-width: 52px;
        padding: 8px 4px;
      }
      .rail-section-header, .nav-label, .nav-badge, .rail-telemetry {
        display: none;
      }
      .nav-item {
        justify-content: center;
        padding: 0;
      }
    }
  </style>
</head>
<body>
<div class="workbench-root" id="workbench-root">
  <!-- Topbar: 44px Fixed Height -->
  <header class="topbar" id="topbar">
    <div class="topbar-left">
      <div class="brand">
        <span class="brand-icon">🧬</span>
        <span class="brand-name" id="topbar-brand-name">EvoKernel</span>
        <span class="version-tag" id="topbar-brand-subtitle">Workbench 2.0</span>
      </div>
      <div class="workspace-pill" id="topbar-workspace-pill" title="Active Workspace">
        <span class="ws-icon">📁</span>
        <span class="ws-path" id="topbar-ws-path">~/workspace</span>
      </div>
    </div>

    <div class="topbar-center">
      <button class="search-trigger" id="cmd-palette-trigger" type="button">
        <span class="search-icon">🔍</span>
        <span class="search-placeholder" id="search-placeholder-text">Search capabilities, files, actions...</span>
        <kbd class="kbd-shortcut">⌘K</kbd>
      </button>
    </div>

    <div class="topbar-right">
      <div class="status-indicator-live" id="server-status-dot" title="Live SSE Server Connected">
        <span class="status-dot-pulse" id="status-dot"></span>
        <span class="status-dot-label" id="server-status-text">LIVE</span>
      </div>
      <button class="topbar-btn" id="btn-lang-toggle" type="button" title="Switch Language">
        <span id="lang-label">EN</span>
      </button>
      <button class="topbar-btn" id="btn-export-html" type="button" title="Export Standalone HTML">
        <span>Export</span>
      </button>
    </div>
  </header>

  <!-- 3-Column Workbench Body -->
  <div class="workbench-body" id="workbench-body">
    <!-- Column 1: Left Navigation Rail (220px) -->
    <aside class="left-rail" id="left-rail">
      <!-- Section A: View Switcher -->
      <div class="rail-section">
        <div class="rail-section-header" id="rail-hdr-views">VIEWS</div>
        <nav class="nav-view-switcher" id="nav-view-switcher">
          <div class="nav-sliding-pill" id="nav-sliding-pill"></div>
          <button class="nav-item active" data-view="capabilities" id="nav-btn-capabilities" type="button">
            <span class="nav-icon">⚡</span>
            <span class="nav-label" id="nav-label-caps">Capabilities</span>
            <span class="nav-badge" id="badge-count-caps">0</span>
          </button>
          <button class="nav-item" data-view="topology" id="nav-btn-topology" type="button">
            <span class="nav-icon">🕸️</span>
            <span class="nav-label" id="nav-label-topo">Topology</span>
          </button>
          <button class="nav-item" data-view="hotspots" id="nav-btn-hotspots" type="button">
            <span class="nav-icon">🔥</span>
            <span class="nav-label" id="nav-label-hotspots">Git Hotspots</span>
            <span class="nav-badge" id="badge-count-hotspots">0</span>
          </button>
          <button class="nav-item" data-view="gatekeeper" id="nav-btn-gatekeeper" type="button">
            <span class="nav-icon">🛡️</span>
            <span class="nav-label" id="nav-label-gk">Gatekeeper</span>
            <span class="nav-badge" id="badge-count-gk">0</span>
          </button>
        </nav>
      </div>

      <!-- Section B: Telemetry Bento Cards -->
      <div class="rail-section rail-telemetry">
        <div class="rail-section-header" id="rail-hdr-telem">TELEMETRY</div>

        <!-- Card 1: Health Score -->
        <div class="bento-card" id="bento-health">
          <div class="bento-title" id="bento-title-health">Health Score</div>
          <div class="bento-metric-row">
            <span class="bento-metric-value" id="bento-health-val">--</span>
            <span class="bento-badge" id="bento-health-grade">Grade --</span>
          </div>
          <div class="bento-subtext">Zero-leak AST shielding</div>
        </div>

        <!-- Card 2: Prompt Tax Saved -->
        <div class="bento-card" id="bento-savings">
          <div class="bento-title" id="bento-title-tax">Prompt Tax Saved</div>
          <div class="bento-metric-row">
            <span class="bento-metric-value text-emerald" id="bento-saved-pct">-%</span>
          </div>
          <div class="bento-subtext" id="bento-saved-detail">-- tok vs -- tok</div>
        </div>

        <!-- Card 3: Core Rule Budget -->
        <div class="bento-card" id="bento-budget">
          <div class="bento-title-row">
            <span class="bento-title" id="bento-title-budget">Core Budget</span>
            <span class="bento-counter" id="bento-budget-counter"><span id="bento-budget-cur">0</span> / 1500 tok</span>
          </div>
          <div class="progress-track">
            <div class="progress-bar" id="bento-budget-bar" style="width: 0%"></div>
          </div>
          <div class="bento-subtext" id="bento-budget-status">Within safe limit</div>
        </div>

        <!-- Card 4: Virtual Footprint Treemap -->
        <div class="bento-card bento-treemap-card" id="bento-treemap-card">
          <div class="bento-title" id="bento-title-treemap">Virtual Footprint</div>
          <div class="micro-treemap-container" id="micro-treemap"></div>
        </div>
      </div>
    </aside>

    <!-- Column 2: Center Stage Canvas (flex: 1) -->
    <main class="center-stage" id="center-stage">
      <!-- View 1: Capabilities Data Table -->
      <section class="view-panel active" id="view-capabilities">
        <div class="view-header" id="caps-view-header">
          <div class="filter-toolbar">
            <div class="pill-group" id="caps-kind-pills">
              <button type="button" class="filter-pill active" data-kind="all">All</button>
              <button type="button" class="filter-pill" data-kind="rules">Rules</button>
              <button type="button" class="filter-pill" data-kind="skills">Skills</button>
              <button type="button" class="filter-pill" data-kind="tools">Tools</button>
              <button type="button" class="filter-pill" data-kind="memories">Memories</button>
            </div>
            <div class="pill-group" id="caps-status-pills">
              <button type="button" class="filter-pill active" data-status="all">All Status</button>
              <button type="button" class="filter-pill" data-status="verified">Verified</button>
              <button type="button" class="filter-pill" data-status="stale">Stale</button>
              <button type="button" class="filter-pill" data-status="core">Core</button>
              <button type="button" class="filter-pill" data-status="scoped">Scoped</button>
            </div>
            <div class="search-box">
              <input type="text" id="caps-search-input" class="search-input" placeholder="Filter capabilities (id, title, symbol, file)..." autocomplete="off" />
            </div>
            <div class="view-count-badge" id="caps-count-label">0 items</div>
          </div>
        </div>
        <div class="table-scroll-container">
          <table class="data-table" id="capabilities-table">
            <thead>
              <tr>
                <th style="width: 84px;">Type</th>
                <th>ID &amp; Title</th>
                <th style="width: 150px;">Scope / Status</th>
                <th style="width: 130px;">Attribution</th>
                <th style="width: 120px; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody id="capabilities-table-body"></tbody>
          </table>
          <div id="caps-empty-state" class="empty-state" style="display: none;">
            No capabilities match the current filter.
          </div>
        </div>
      </section>

      <!-- View 2: Orthogonal Round-Rect Card Topology -->
      <section class="view-panel" id="view-topology">
        <div class="view-header" id="topo-view-header">
          <div class="topo-header-row">
            <div>
              <h2 class="view-title" id="topo-view-title">Orthogonal Capability &amp; AST Topology</h2>
              <p class="view-subtitle" id="topo-view-sub">Rules &amp; Skills &rarr; Cognitive Memories &rarr; AST Source Files &amp; Callers</p>
            </div>
            <div class="topo-legend">
              <span class="legend-item"><span class="dot dot-ok"></span> Verified</span>
              <span class="legend-item"><span class="dot dot-warn"></span> Branch / Contested</span>
              <span class="legend-item"><span class="dot dot-danger"></span> Stale / Drift</span>
              <span class="legend-hint">Hover or click node for focus dimming</span>
            </div>
          </div>
        </div>
        <div class="topo-scroll-container" id="topo-container">
          <svg id="topology-svg" class="topology-svg" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
      </section>

      <!-- View 3: Git Fragile Hotspots View -->
      <section class="view-panel" id="view-hotspots">
        <div class="view-header" id="hotspots-view-header">
          <div class="hotspots-header-row">
            <div>
              <h2 class="view-title" id="hotspots-view-title">Fragile Git Hotspots &amp; AST Shielding Matrix</h2>
              <p class="view-subtitle" id="hotspots-view-sub">High-churn files tracked by bug-fix commits and shielded by AST memories</p>
            </div>
            <div class="hotspots-kpi-badge" id="hotspots-summary-kpi">0 / 0 Protected</div>
          </div>
        </div>
        <div class="table-scroll-container">
          <table class="data-table" id="hotspots-table">
            <thead>
              <tr>
                <th>Source File Path</th>
                <th style="width: 120px;">Fragility Score</th>
                <th style="width: 110px;">Fix Commits</th>
                <th>Bound AST Shielding Memories</th>
                <th style="width: 130px;">Status</th>
                <th style="width: 100px; text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody id="hotspots-table-body"></tbody>
          </table>
          <div id="hotspots-empty-state" class="empty-state" style="display: none;">
            No git commit hotspots detected. Repository history is clean.
          </div>
        </div>
      </section>

      <!-- View 4: Gatekeeper Audit Stream -->
      <section class="view-panel" id="view-gatekeeper">
        <div class="view-header" id="gk-view-header">
          <div class="gk-header-row">
            <div>
              <h2 class="view-title" id="gk-view-title">Deterministic 4-Stage Gatekeeper Audit Stream</h2>
              <p class="view-subtitle" id="gk-view-sub">Proposal audit timeline: Static Security, Sandbox --self-test exit(0), AST Grounding, BM25/Budget Quota</p>
            </div>
            <div class="pill-group" id="gk-filter-pills">
              <button type="button" class="filter-pill active" data-filter="all">All Events</button>
              <button type="button" class="filter-pill" data-filter="pass">Passed</button>
              <button type="button" class="filter-pill" data-filter="fail">Rejected</button>
            </div>
          </div>
        </div>
        <div class="timeline-scroll-container" id="gatekeeper-timeline"></div>
      </section>
    </main>

    <!-- Column 3: Right Structured Inspector (380px) -->
    <aside class="right-inspector" id="right-inspector">
      <div class="inspector-placeholder" id="inspector-placeholder">
        <span class="placeholder-icon">📋</span>
        <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;" id="inspector-placeholder-title">No Capability Selected</div>
        <p class="placeholder-text" id="inspector-placeholder-sub">Select any Rule, Skill, Tool, or Memory from the data table or topology graph to inspect.</p>
      </div>
      <div class="inspector-content" id="inspector-content" style="display: none;"></div>
    </aside>
  </div>

  <!-- Command Palette Modal (Cmd/Ctrl + K) -->
  <div class="cmd-palette-backdrop" id="cmd-palette-backdrop">
    <div class="cmd-palette-modal" id="cmd-palette-modal">
      <div class="cmd-palette-input-wrap">
        <span class="cmd-search-icon">🔍</span>
        <input class="cmd-palette-input" id="cmd-palette-input" type="text" placeholder="Type a command or search capabilities..." autocomplete="off" spellcheck="false" />
        <kbd class="kbd-shortcut">ESC</kbd>
      </div>
      <div class="cmd-palette-list" id="cmd-palette-list"></div>
    </div>
  </div>

  <!-- Toast Notification Container -->
  <div class="toast-container" id="toast-container"></div>
</div>

<script>${clientScript}</script>
</body>
</html>`.replace(/\r\n/g, '\n');
}

export { renderUiClientHtml as renderUiHtml };
