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
  var capsSortByTokens = false;
  var healthDiagExpanded = false;
  var activeGkFilter = 'all';
  var selectedCapability = null; // { kind: string, item: any }
  var inspectorMode = 'preview'; // 'preview' | 'edit'
  var lang = 'en';
  try {
    var savedLang = window.localStorage ? window.localStorage.getItem('evo_ui_lang') : null;
    if (savedLang === 'zh' || savedLang === 'en') {
      lang = savedLang;
    } else if (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().indexOf('zh') === 0) {
      lang = 'zh';
    }
  } catch (e) {}

  // Command Palette State
  var cmdPaletteOpen = false;
  var cmdItems = [];
  var cmdActiveIndex = 0;

  var i18n = {
    en: {
      brandName: 'EvoKernel',
      brandSubtitle: 'Workbench 2.1',
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
      healthSub: 'Click to inspect score deductions',
      taxTitle: 'Prompt Tax Saved',
      budgetTitle: 'Core Rule Budget',
      budgetStatusOk: 'Within safe limit (click to filter)',
      budgetStatusWarn: 'Nearing 1500-token cap (click to filter)',
      budgetStatusExceeded: 'Budget exceeded! Click to inspect',
      treemapTitle: 'Virtual Footprint',
      capsViewTitle: 'Capabilities Matrix',
      capsViewSub: 'High-density inspection of rules, skills, tools, and episodic memories',
      allKinds: 'All',
      rules: 'Rules',
      skills: 'Skills',
      tools: 'Tools',
      memories: 'Memories',
      allStatus: 'All Status',
      statusPending: '🔔 Pending',
      statusActive: 'Active',
      statusPaused: 'Paused',
      statusVerified: 'Verified',
      statusStale: 'Stale',
      statusCore: 'Core',
      statusScoped: 'Scoped',
      statusArchived: '🗑️ Archived',
      batchApprovePending: '✓ Approve All Pending',
      batchPauseStale: '🧹 Pause Stale Items',
      badgePending: '🔔 Pending Review',
      badgeEnabled: '🟢 Enabled',
      badgePaused: '⏸ Paused',
      badgeArchived: '🗑️ Archived',
      hitsSuffix: 'hits',
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
      tldrLabel: '💡 One-Sentence Takeaway (TL;DR)',
      openInIde: '↗ Open in IDE',
      verifyAst: '✓ Verify AST',
      verifyingAst: 'Verifying...',
      rebindAst: '🔄 Re-bind Current Code (AST)',
      rebindingAst: 'Re-binding...',
      staleBannerText: '⚠️ Target code changed or switched branches since this memory was recorded. Choose how to handle it:',
      promoteCore: '↑ Promote to Core',
      demoteScoped: '↓ Demote to Scoped',
      runSelfTest: '▶ Run Self-Test',
      edit: '✎ Edit',
      preview: '👁 Preview',
      archive: '⌫ Archive',
      restore: '↩ Restore',
      approve: '✓ Approve',
      pauseItem: '⏸ Pause',
      resumeItem: '▶ Enable',
      undoArchive: '↩ Undo',
      astAnchors: 'AST Code Anchors',
      saveChanges: 'Save Changes',
      cancel: 'Cancel',
      sandboxConsole: 'Sandbox Terminal Console'
    },
    zh: {
      brandName: 'EvoKernel',
      brandSubtitle: '工作台 2.1',
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
      healthSub: '点击查看扣分项与一键修复',
      taxTitle: 'Prompt 净省税率',
      budgetTitle: '核心规则预算',
      budgetStatusOk: '安全预算内（点击筛选核心规则）',
      budgetStatusWarn: '接近 1500 上限（点击筛选降级）',
      budgetStatusExceeded: '超出核心预算！（点击排查大规则）',
      treemapTitle: '虚拟化内存占用',
      capsViewTitle: '自演化能力矩阵',
      capsViewSub: '高密度透视规则、技能、沙盒微工具与认知记忆',
      allKinds: '全部类型',
      rules: '规则',
      skills: '技能',
      tools: '微工具',
      memories: '认知记忆',
      allStatus: '全状态',
      statusPending: '🔔 待审核',
      statusActive: '已启用',
      statusPaused: '已搁置',
      statusVerified: '已验证',
      statusStale: '已失效',
      statusCore: '核心',
      statusScoped: '局部',
      statusArchived: '🗑️ 回收站',
      batchApprovePending: '✓ 全部确认待审',
      batchPauseStale: '🧹 批量搁置失效项',
      badgePending: '🔔 待审核',
      badgeEnabled: '🟢 已启用',
      badgePaused: '⏸ 已搁置',
      badgeArchived: '🗑️ 已归档',
      hitsSuffix: '次命中',
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
      tldrLabel: '💡 一句话核心结论 (TL;DR)',
      openInIde: '↗ 在 IDE 中打开',
      verifyAst: '✓ 验证 AST 状态',
      verifyingAst: '验证计算中...',
      rebindAst: '🔄 更新绑定当前代码 (Re-bind AST)',
      rebindingAst: '重新锚定中...',
      staleBannerText: '⚠️ 该记忆绑定的源码已发生修改或分支切换。您可以一键重新锚定当前代码、暂时搁置或归档：',
      promoteCore: '↑ 提升为核心规则',
      demoteScoped: '↓ 降级为局部规则',
      runSelfTest: '▶ 执行沙盒自测',
      edit: '✎ 在线编辑',
      preview: '👁 结构化预览',
      archive: '⌫ 归档',
      restore: '↩ 恢复',
      approve: '✓ 确认',
      pauseItem: '⏸ 搁置',
      resumeItem: '▶ 启用',
      undoArchive: '↩ 撤销 (Undo)',
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

  function formatRichText(s) {
    var safe = esc(s);
    return safe.replace(/\`([^\`]+)\`/g, '<code class="inline-code-pill">$1</code>');
  }

  function formatKind(k) {
    if (!k) return '';
    if (k === 'memories' || k === 'memory') return 'MEMORY';
    return String(k).replace(/s$/, '').toUpperCase();
  }

  function singularKind(k) {
    if (!k) return 'rule';
    if (k === 'memories' || k === 'memory') return 'memory';
    return String(k).replace(/s$/, '');
  }

  function formatWorkspaceDisplayPath(rawPath) {
    var p = String(rawPath || '~/workspace');
    if (p.length <= 36) return p;
    var sep = p.indexOf('\\\\') !== -1 ? '\\\\' : '/';
    var parts = p.split(/[\\\\/]/).filter(Boolean);
    if (parts.length <= 2) return p;
    var tail = parts.slice(-2).join(sep);
    var head = parts[0];
    if ((head + sep + '…' + sep + tail).length <= 42) {
      return head + sep + '…' + sep + tail;
    }
    return '…' + sep + parts[parts.length - 1];
  }

  function charVisualCols(code) {
    return code > 0x2E7F ? 2 : 1;
  }

  function truncateVisual(str, maxCols) {
    var s = String(str || '');
    var cols = 0;
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var w = charVisualCols(s.charCodeAt(i));
      if (cols + w > maxCols) {
        return out + '…';
      }
      out += s.charAt(i);
      cols += w;
    }
    return s;
  }

  function truncateVisualTail(str, maxCols) {
    var s = String(str || '');
    var totalCols = 0;
    for (var j = 0; j < s.length; j++) {
      totalCols += charVisualCols(s.charCodeAt(j));
    }
    if (totalCols <= maxCols) return s;
    var cols = 0;
    var out = '';
    for (var i = s.length - 1; i >= 0; i--) {
      var w = charVisualCols(s.charCodeAt(i));
      if (cols + w > maxCols - 1) {
        return '…' + out;
      }
      out = s.charAt(i) + out;
      cols += w;
    }
    return s;
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
            resolve({ ok: true, data: msg.data, result: msg.result, snapshot: msg.snapshot, tokenUsage: msg.tokenUsage, action: action });
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
  // TOAST NOTIFICATION SYSTEM (WITH UNDO SUPPORT)
  // ==========================================
  function showToast(type, message, durationMs, actionSpec) {
    var container = el('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast-item';
    var icon = type === 'success'
      ? '<span style="color:var(--status-ok);">✓</span>'
      : (type === 'error' ? '<span style="color:var(--status-danger);">✕</span>' : '<span style="color:var(--status-info);">ℹ</span>');
    var msgSpan = document.createElement('span');
    msgSpan.innerHTML = icon + ' <span style="margin-left:4px;">' + esc(message) + '</span>';
    toast.appendChild(msgSpan);

    if (actionSpec && actionSpec.label && typeof actionSpec.run === 'function') {
      var actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'toast-undo-btn';
      actBtn.textContent = actionSpec.label;
      actBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        actionSpec.run();
      });
      toast.appendChild(actBtn);
    }

    container.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, durationMs || (actionSpec ? 5500 : 3500));
  }

  function archiveAndOfferUndo(kindPlural, itemId) {
    var sKind = singularKind(kindPlural);
    var dict = i18n[lang] || i18n.en;
    callKernelAction('archive-item', { kind: sKind, id: itemId }).then(function(res) {
      if (res.ok) {
        if (res.snapshot) snapshot = res.snapshot;
        if (selectedCapability && selectedCapability.item && selectedCapability.item.id === itemId) {
          selectedCapability = null;
        }
        renderTelemetry();
        renderCapabilitiesTable();
        renderInspector();
        showToast('success', (lang === 'zh' ? '已归档 ' : 'Archived ') + itemId, 5500, {
          label: dict.undoArchive,
          run: function() {
            callKernelAction('restore-item', { kind: sKind, id: itemId }).then(function(rRes) {
              if (rRes.ok) {
                if (rRes.snapshot) snapshot = rRes.snapshot;
                renderTelemetry();
                renderCapabilitiesTable();
                renderInspector();
                showToast('success', (lang === 'zh' ? '已恢复 ' : 'Restored ') + itemId);
              } else {
                showToast('error', rRes.error || 'Restore failed');
              }
            });
          }
        });
      } else {
        showToast('error', res.error || 'Archive failed');
      }
    });
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
    var hasScore = score && typeof score.overallScore === 'number';
    var overall = hasScore ? score.overallScore : null;
    var grade = hasScore ? (score.grade || (overall >= 95 ? 'A+' : (overall >= 85 ? 'A' : (overall >= 70 ? 'B' : (overall >= 55 ? 'C' : (overall >= 40 ? 'D' : 'F')))))) : null;

    // 1. Health Score
    if (el('bento-health-val')) el('bento-health-val').textContent = hasScore ? String(overall) : '—';
    if (el('bento-health-grade')) el('bento-health-grade').textContent = hasScore ? ('Grade ' + grade) : '—';

    // 2. Prompt Tax Saved
    var hasSavings = savings && typeof savings.savingsPercent === 'number' && (savings.beforeTokens > 0 || savings.afterTokens > 0 || savings.savingsPercent !== 0);
    if (el('bento-saved-pct')) {
      if (hasSavings) {
        var pct = Math.abs(savings.savingsPercent);
        var pctText = pct > 0 ? ('-' + pct + '%') : '0%';
        el('bento-saved-pct').textContent = pctText;
      } else {
        el('bento-saved-pct').textContent = '—';
      }
    }
    if (el('bento-saved-detail')) {
      if (hasSavings) {
        el('bento-saved-detail').textContent = (savings.afterTokens || 0).toLocaleString() + ' tok vs ' + (savings.beforeTokens || 0).toLocaleString() + ' tok';
      } else {
        el('bento-saved-detail').textContent = '—';
      }
    }

    // 3. Core Rule Budget (1500 tokens limit — dynamically summed from active core rules)
    var coreTokens = savings.evoSeedTokens || 0;
    if (Array.isArray(snapshot.rules)) {
      coreTokens = snapshot.rules
        .filter(function(r) { return r.core && r.enabled !== false; })
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
      var toolCount = (snapshot.tools || []).filter(function(x) { return x.enabled !== false; }).length;
      var skillCount = (snapshot.skills || []).filter(function(x) { return x.enabled !== false; }).length;
      var memoryCount = (snapshot.memories || []).filter(function(x) { return x.enabled !== false; }).length;
      var ruleCount = (snapshot.rules || []).filter(function(x) { return x.enabled !== false; }).length;

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

    // Topbar workspace with smart middle truncation preserving folder name
    var wsRoot = score.workspaceRoot || '~/workspace';
    if (isAnon) wsRoot = '~/workspace';
    if (el('topbar-ws-path')) {
      el('topbar-ws-path').textContent = formatWorkspaceDisplayPath(wsRoot);
      el('topbar-ws-path').title = wsRoot;
    }
    if (el('topbar-workspace-pill')) {
      el('topbar-workspace-pill').title = wsRoot;
    }

    renderHealthDiagnosticsBanner(coreTokens);
  }

  function renderHealthDiagnosticsBanner(coreTokens) {
    var banner = el('health-diagnostics-banner');
    if (!banner) return;
    if (!healthDiagExpanded) {
      banner.style.display = 'none';
      return;
    }
    if (typeof coreTokens !== 'number') {
      var sBudget = (snapshot.score && snapshot.score.coreBudget) || {};
      coreTokens = sBudget.usedTokens || 0;
      if (coreTokens === 0 && Array.isArray(snapshot.rules)) {
        snapshot.rules.forEach(function(r) {
          if (r.core && r.enabled !== false) coreTokens += (r.tokens || r.token_count || 0);
        });
      }
    }
    banner.style.display = 'flex';
    var staleMems = (snapshot.memories || []).filter(function(m) {
      return m.enabled !== false && m.freshness && m.freshness.overall_status === 'STALE';
    });
    var unprotHotspots = ((snapshot.score && snapshot.score.gitHotspots) || []).filter(function(h) {
      return h.unprotected;
    });
    var pendingCount = countPendingCapabilities();
    var itemsHtml = [];

    if (staleMems.length > 0) {
      itemsHtml.push(
        '<div class="diag-chip diag-chip-danger" data-diag-action="filter-stale">' +
          '<span>⚠️ ' + (lang === 'zh' ? (staleMems.length + ' 条记忆因代码变更已失效 (STALE)') : (staleMems.length + ' AST memories drifted (STALE)')) + '</span>' +
          '<span class="diag-chip-cta">' + (lang === 'zh' ? '筛选修复 →' : 'Filter →') + '</span>' +
        '</div>'
      );
    }
    if (unprotHotspots.length > 0) {
      itemsHtml.push(
        '<div class="diag-chip diag-chip-warn" data-diag-action="goto-hotspots">' +
          '<span>🔥 ' + (lang === 'zh' ? (unprotHotspots.length + ' 个高频故障文件缺少 AST 记忆护栏') : (unprotHotspots.length + ' fragile git hotspots unprotected')) + '</span>' +
          '<span class="diag-chip-cta">' + (lang === 'zh' ? '查看热点 →' : 'Inspect →') + '</span>' +
        '</div>'
      );
    }
    if (coreTokens >= 1200) {
      itemsHtml.push(
        '<div class="diag-chip diag-chip-warn" data-diag-action="filter-core">' +
          '<span>📦 ' + (lang === 'zh' ? ('核心规则占用 ' + coreTokens + '/1500 tok') : ('Core rules using ' + coreTokens + '/1500 tok')) + '</span>' +
          '<span class="diag-chip-cta">' + (lang === 'zh' ? '按体积排查 →' : 'Sort by size →') + '</span>' +
        '</div>'
      );
    }
    if (pendingCount > 0) {
      itemsHtml.push(
        '<div class="diag-chip diag-chip-info" data-diag-action="filter-pending">' +
          '<span>🔔 ' + (lang === 'zh' ? (pendingCount + ' 项新演化能力待您审核确认') : (pendingCount + ' newly evolved items pending review')) + '</span>' +
          '<span class="diag-chip-cta">' + (lang === 'zh' ? '立即审核 →' : 'Review →') + '</span>' +
        '</div>'
      );
    }
    if (itemsHtml.length === 0) {
      itemsHtml.push(
        '<div class="diag-chip diag-chip-ok">' +
          '<span>✅ ' + (lang === 'zh' ? '工作区全部指标健康，无失效记忆或预算超标' : 'All workspace health metrics are optimal') + '</span>' +
        '</div>'
      );
    }

    banner.innerHTML =
      '<div class="diag-banner-hdr">' +
        '<strong>' + (lang === 'zh' ? '🩺 健康度诊断与一键修复向导' : '🩺 Health Score Diagnostics & Quick Fixes') + '</strong>' +
        '<button type="button" class="btn-action" id="btn-close-diag-banner" style="padding:1px 7px;font-size:11px;">✕</button>' +
      '</div>' +
      '<div class="diag-chips-row">' + itemsHtml.join('') + '</div>';

    var closeBtn = banner.querySelector('#btn-close-diag-banner');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        healthDiagExpanded = false;
        banner.style.display = 'none';
      });
    }
    banner.querySelectorAll('[data-diag-action]').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var act = chip.getAttribute('data-diag-action');
        if (act === 'filter-stale') {
          applyQuickFilter('memories', 'stale', false);
        } else if (act === 'goto-hotspots') {
          switchView('hotspots');
        } else if (act === 'filter-core') {
          applyQuickFilter('rules', 'core', true);
        } else if (act === 'filter-pending') {
          applyQuickFilter('all', 'pending', false);
        }
      });
    });
  }

  function countPendingCapabilities() {
    var total = 0;
    ['rules', 'skills', 'tools', 'memories'].forEach(function(k) {
      (snapshot[k] || []).forEach(function(it) {
        if (it.review_status === 'pending') total++;
      });
    });
    return total;
  }

  function applyQuickFilter(kindVal, statusVal, sortByTokens) {
    switchView('capabilities');
    activeCapsKind = kindVal || 'all';
    activeCapsStatus = statusVal || 'all';
    capsSortByTokens = Boolean(sortByTokens);
    var kp = el('caps-kind-pills');
    if (kp) {
      kp.querySelectorAll('.filter-pill').forEach(function(p) {
        p.classList.toggle('active', (p.getAttribute('data-kind') || 'all') === activeCapsKind);
      });
    }
    var sp = el('caps-status-pills');
    if (sp) {
      sp.querySelectorAll('.filter-pill').forEach(function(p) {
        p.classList.toggle('active', (p.getAttribute('data-status') || 'all') === activeCapsStatus);
      });
    }
    renderCapabilitiesTable();
  }

  // ==========================================
  // VIEW 1: HIGH-DENSITY CAPABILITIES TABLE
  // ==========================================
  function renderCapabilitiesTable() {
    var tbody = el('capabilities-table-body');
    var emptyState = el('caps-empty-state');
    var countLabel = el('caps-count-label');
    var dict = i18n[lang] || i18n.en;
    if (!tbody) return;
    tbody.innerHTML = '';

    var pendingCount = countPendingCapabilities();
    var archivedCount = (snapshot.archived || []).length;
    var staleList = [];
    (snapshot.memories || []).forEach(function(m) {
      if (m.enabled !== false && m.freshness && m.freshness.overall_status === 'STALE') {
        staleList.push({ kind: 'memory', id: m.id });
      }
    });

    var pillPending = el('pill-status-pending');
    if (pillPending) {
      pillPending.textContent = dict.statusPending + (pendingCount > 0 ? ' (' + pendingCount + ')' : '');
    }
    var pillArchived = el('pill-status-archived');
    if (pillArchived) {
      pillArchived.textContent = dict.statusArchived + (archivedCount > 0 ? ' (' + archivedCount + ')' : '');
    }

    var btnApproveAll = el('btn-batch-approve-pending');
    if (btnApproveAll) {
      btnApproveAll.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
      btnApproveAll.textContent = dict.batchApprovePending + ' (' + pendingCount + ')';
    }
    var btnPauseStale = el('btn-batch-pause-stale');
    if (btnPauseStale) {
      btnPauseStale.style.display = staleList.length > 0 ? 'inline-flex' : 'none';
      btnPauseStale.textContent = dict.batchPauseStale + ' (' + staleList.length + ')';
    }

    var q = (capsSearchQuery || '').toLowerCase().trim();
    var rows = [];

    if (activeCapsStatus === 'archived') {
      (snapshot.archived || []).forEach(function(arc) {
        var kPlural = arc.kind === 'memory' ? 'memories' : (arc.kind + 's');
        if (activeCapsKind !== 'all' && activeCapsKind !== kPlural) return;
        if (q) {
          var sArc = [arc.id || '', arc.title || '', arc.l0_summary || ''].join(' ').toLowerCase();
          if (sArc.indexOf(q) === -1) return;
        }
        rows.push({ kind: kPlural, item: arc, isArchived: true });
      });
    } else {
      var kinds = ['rules', 'skills', 'tools', 'memories'];
      kinds.forEach(function(k) {
        if (activeCapsKind !== 'all' && activeCapsKind !== k) return;
        var list = snapshot[k] || [];
        list.forEach(function(item) {
          var isCore = (k === 'rules') ? Boolean(item.core) : false;
          var isEnabled = item.enabled !== false;
          var isPending = item.review_status === 'pending';
          var memStatus = item.freshness ? item.freshness.overall_status : (k === 'memories' ? 'VERIFIED' : '');

          if (activeCapsStatus === 'pending' && !isPending) return;
          if (activeCapsStatus === 'active' && !isEnabled) return;
          if (activeCapsStatus === 'paused' && isEnabled) return;
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

          rows.push({ kind: k, item: item, isArchived: false });
        });
      });
    }

    if (capsSortByTokens) {
      rows.sort(function(a, b) {
        var ta = a.item.tokens || a.item.token_count || 0;
        var tb = b.item.tokens || b.item.token_count || 0;
        return tb - ta;
      });
    }

    if (countLabel) countLabel.textContent = rows.length + ' items';

    if (rows.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    rows.forEach(function(row) {
      var k = row.kind;
      var it = row.item;
      var isArchived = Boolean(row.isArchived);
      var isEnabled = it.enabled !== false;
      var isPending = it.review_status === 'pending';
      var tr = document.createElement('tr');
      tr.className = 'row-interactive' + (!isEnabled && !isArchived ? ' row-paused' : '');
      tr.setAttribute('data-kind', k);
      tr.setAttribute('data-id', it.id);
      if (selectedCapability && selectedCapability.item && selectedCapability.item.id === it.id) {
        tr.classList.add('row-selected');
      }

      var kindBadge = '<span class="badge-kind">' + formatKind(k) + '</span>';
      var titleText = esc(it.title || it.name || it.id || '');
      var idText = esc(it.id || '');
      var summaryRaw = String(it.l0_summary || it.description || '').trim();
      var summaryHtml = summaryRaw && summaryRaw !== (it.title || it.name || '')
        ? '<div class="item-sub-summary" title="' + esc(summaryRaw) + '">' + esc(summaryRaw) + '</div>'
        : '';
      var titleCol = '<div class="item-title-wrap">' +
        '<div class="item-title-line">' +
          '<span class="item-main-title" title="' + titleText + '">' + titleText + '</span>' +
          '<span class="item-sub-id" title="' + idText + '">' + idText + '</span>' +
        '</div>' +
        summaryHtml +
        '</div>';

      var statusCol = '';
      if (k === 'rules') {
        var globVal = it.scope_glob || '*';
        var tokBadge = it.tokens ? ' <span style="color:#71717a;">· ' + it.tokens + 't</span>' : '';
        statusCol = it.core
          ? '<span class="badge-status"><span class="dot dot-ok"></span> CORE' + tokBadge + '</span>'
          : '<span class="badge-status badge-scoped" title="' + esc(globVal) + '">SCOPED <span class="scoped-glob-text">(' + esc(globVal) + ')</span></span>';
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
      var attrHtml = '';
      if (isArchived) {
        attrHtml = '<span class="badge-status">' + esc(dict.badgeArchived) + '</span>';
      } else if (!isEnabled) {
        attrHtml = '<span class="badge-status" style="color:var(--text-muted);">' + esc(dict.badgePaused) + '</span>';
      } else if (isPending) {
        attrHtml = '<span class="badge-status" style="border-color:var(--status-warn-border);color:var(--status-warn);">' + esc(dict.badgePending) + '</span>';
      } else {
        attrHtml = '<span class="badge-status">' + esc(dict.badgeEnabled) + ' · ' + hits + ' ' + esc(dict.hitsSuffix) + '</span>';
      }

      var actionCol = '';
      if (isArchived) {
        actionCol = '<div class="row-actions-wrap">' +
          '<button type="button" class="btn-action row-restore-btn" data-kind="' + k + '" data-id="' + esc(it.id) + '">' + esc(dict.restore) + '</button>' +
        '</div>';
      } else {
        actionCol = '<div class="row-actions-wrap">' +
          (isPending ? '<button type="button" class="btn-action row-approve-btn" style="border-color:var(--status-ok-border);color:var(--status-ok);" title="Approve">' + esc(dict.approve) + '</button>' : '') +
          '<button type="button" class="btn-action row-toggle-btn" title="' + esc(isEnabled ? dict.pauseItem : dict.resumeItem) + '">' + esc(isEnabled ? dict.pauseItem : dict.resumeItem) + '</button>' +
          '<button type="button" class="btn-action btn-danger row-archive-btn" title="' + esc(dict.archive) + '">⌫</button>' +
        '</div>';
      }

      tr.innerHTML = '<td>' + kindBadge + '</td>' +
        '<td>' + titleCol + '</td>' +
        '<td>' + statusCol + '</td>' +
        '<td>' + attrHtml + '</td>' +
        '<td>' + actionCol + '</td>';

      tr.addEventListener('click', function(e) {
        if (e.target.closest('.row-actions-wrap')) {
          return;
        }
        selectCapability(k, it);
      });

      var approveBtn = tr.querySelector('.row-approve-btn');
      if (approveBtn) {
        approveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          callKernelAction('approve-item', { kind: singularKind(k), id: it.id }).then(function(res) {
            if (res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              else it.review_status = 'approved';
              renderTelemetry();
              renderCapabilitiesTable();
              if (selectedCapability && selectedCapability.item && selectedCapability.item.id === it.id) {
                selectedCapability.item.review_status = 'approved';
                renderInspector();
              }
              showToast('success', (lang === 'zh' ? '已确认 ' : 'Approved ') + it.id);
            } else {
              showToast('error', res.error || 'Approve failed');
            }
          });
        });
      }

      var toggleBtn = tr.querySelector('.row-toggle-btn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var nextEnabled = it.enabled === false;
          callKernelAction('toggle-enabled', { kind: singularKind(k), id: it.id, enabled: nextEnabled }).then(function(res) {
            if (res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              else it.enabled = nextEnabled;
              renderTelemetry();
              renderCapabilitiesTable();
              if (selectedCapability && selectedCapability.item && selectedCapability.item.id === it.id) {
                selectedCapability.item.enabled = nextEnabled;
                renderInspector();
              }
              showToast('success', (nextEnabled ? (lang === 'zh' ? '已启用 ' : 'Enabled ') : (lang === 'zh' ? '已搁置 ' : 'Paused ')) + it.id);
            } else {
              showToast('error', res.error || 'Toggle failed');
            }
          });
        });
      }

      var archiveBtn = tr.querySelector('.row-archive-btn');
      if (archiveBtn) {
        archiveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          archiveAndOfferUndo(k, it.id);
        });
      }

      var restoreBtn = tr.querySelector('.row-restore-btn');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          callKernelAction('restore-item', { kind: singularKind(k), id: it.id }).then(function(res) {
            if (res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              renderTelemetry();
              renderCapabilitiesTable();
              showToast('success', (lang === 'zh' ? '已从回收站恢复 ' : 'Restored ') + it.id);
            } else {
              showToast('error', res.error || 'Restore failed');
            }
          });
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

    var rules = (snapshot.rules || []).filter(function(r) { return r.enabled !== false; });
    var skills = (snapshot.skills || []).filter(function(s) { return s.enabled !== false; });
    var memories = (snapshot.memories || []).filter(function(m) { return m.enabled !== false; });

    var leftNodes = [];
    rules.forEach(function(r) {
      leftNodes.push({ id: 'rule:' + r.id, raw: r, kind: 'rules', label: r.title || r.id, sub: r.id, core: r.core });
    });
    skills.forEach(function(s) {
      leftNodes.push({ id: 'skill:' + s.id, raw: s, kind: 'skills', label: s.name || s.id, sub: s.id });
    });

    var midNodes = [];
    var rightMap = {};
    var rightFileSet = {};
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
        var normSym = String(sym || '').replace(/\\\\/g, '/');
        var fpEntry = fps[sym] || fps[normSym] || {};
        var fpPath = String(fpEntry.file_path || fpEntry.file || '').replace(/\\\\/g, '/');
        var fileOnly = normSym.indexOf('#') !== -1
          ? normSym.split('#')[0]
          : (normSym.indexOf('/') !== -1 || /\\.[a-z0-9]+$/i.test(normSym) ? normSym : (fpPath || normSym));
        var symTail = normSym.indexOf('#') !== -1
          ? normSym.split('#').slice(1).join('#')
          : (normSym !== fileOnly ? normSym : '');
        var canonicalSym = (fileOnly && symTail) ? (fileOnly + '#' + symTail) : (fileOnly || normSym);
        if (fileOnly) rightFileSet[fileOnly] = canonicalSym;
        if (!rightMap[canonicalSym] && !rightMap[normSym]) {
          var hashStr = fpEntry.ast_hash || fpEntry.structural_hash || '';
          var fileBase = (fileOnly || normSym).replace(/^.*[\\\\/]/, '');
          var nodeEntry = {
            id: 'ast:' + canonicalSym,
            label: symTail && symTail !== fileBase ? (fileBase + '#' + symTail) : fileBase,
            sub: hashStr ? ((fileOnly || normSym) + ' · ' + hashStr.slice(0, 8)) : (fileOnly || normSym),
            fullSymbol: canonicalSym,
            rawSymbol: normSym,
            fileOnly: fileOnly || normSym.split('#')[0],
            startLine: Number(fpEntry.start_line || 1) || 1,
            callers: (m.freshness && m.freshness.callers) || []
          };
          rightMap[canonicalSym] = nodeEntry;
          rightMap[normSym] = nodeEntry;
          rightNodes.push(nodeEntry);
        }
      });
      Object.keys(fps).forEach(function(k) {
        var fp = fps[k] || {};
        var fpath = String(fp.file_path || fp.file || '').replace(/\\\\/g, '/');
        var normKey = String(k || '').replace(/\\\\/g, '/');
        if (!fpath || rightMap[normKey] || rightMap[fpath] || rightFileSet[fpath]) {
          return;
        }
        var hashVal = fp.ast_hash || fp.structural_hash || '';
        rightFileSet[fpath] = fpath;
        rightMap[fpath] = {
          id: 'ast:' + fpath,
          label: fpath.replace(/^.*[\\\\/]/, ''),
          sub: hashVal ? (fpath + ' · ' + hashVal.slice(0, 8)) : fpath,
          fullSymbol: fpath,
          rawSymbol: normKey,
          fileOnly: fpath,
          startLine: Number(fp.start_line || 1) || 1,
          callers: []
        };
        rightNodes.push(rightMap[fpath]);
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

    var defs = document.createElementNS(ns, 'defs');
    var clipPath = document.createElementNS(ns, 'clipPath');
    clipPath.setAttribute('id', 'topo-card-clip');
    var clipRect = document.createElementNS(ns, 'rect');
    clipRect.setAttribute('x', '0');
    clipRect.setAttribute('y', '0');
    clipRect.setAttribute('width', String(cardW - 8));
    clipRect.setAttribute('height', String(cardH));
    clipRect.setAttribute('rx', '6');
    clipPath.appendChild(clipRect);
    defs.appendChild(clipPath);
    svg.appendChild(defs);

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
        var syms = (mn.raw.target_symbols || []).map(function(s) { return String(s || '').replace(/\\\\/g, '/'); });
        var fps = mn.raw.ast_fingerprints || {};
        var hasSym = syms.indexOf(rn.fullSymbol) !== -1 || (rn.rawSymbol && syms.indexOf(rn.rawSymbol) !== -1);
        var hasFp = Object.keys(fps).some(function(k) {
          var fpFile = String((fps[k] && (fps[k].file_path || fps[k].file)) || '').replace(/\\\\/g, '/');
          return fpFile === rn.fullSymbol || fpFile === rn.fileOnly;
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

      var svgTitle = document.createElementNS(ns, 'title');
      svgTitle.textContent = n.label + (n.sub ? ' (' + n.sub + ')' : '');
      g.appendChild(svgTitle);

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

      var textClipGroup = document.createElementNS(ns, 'g');
      textClipGroup.setAttribute('clip-path', 'url(#topo-card-clip)');

      var title = document.createElementNS(ns, 'text');
      title.setAttribute('x', '26');
      title.setAttribute('y', '19');
      title.setAttribute('fill', '#fafafa');
      title.setAttribute('font-size', '11.5');
      title.setAttribute('font-weight', '500');
      title.setAttribute('class', 'topo-node-title');
      title.textContent = truncateVisual(n.label, 24);
      textClipGroup.appendChild(title);

      var sub = document.createElementNS(ns, 'text');
      sub.setAttribute('x', '26');
      sub.setAttribute('y', '33');
      sub.setAttribute('fill', '#71717a');
      sub.setAttribute('font-size', '9.5');
      sub.setAttribute('class', 'topo-node-sub');
      sub.textContent = truncateVisualTail(n.sub, 28);
      textClipGroup.appendChild(sub);

      g.appendChild(textClipGroup);

      g.addEventListener('mouseenter', function() { applyFocusDimming(n.id); });
      g.addEventListener('mouseleave', function() { resetFocusDimming(); });
      g.addEventListener('click', function() {
        if (n.raw && n.kind) {
          selectCapability(n.kind, n.raw);
        } else if (n.fileOnly || n.fullSymbol) {
          var targetPath = n.fileOnly || n.fullSymbol.split('#')[0];
          var targetLine = n.startLine || 1;
          callKernelAction('open-editor', { filePath: targetPath, line: targetLine }).then(function(res) {
            if (res.ok) showToast('success', 'Opened ' + targetPath + (targetLine > 1 ? ':' + targetLine : ''));
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
    function addMemToFile(filePath, memItem) {
      if (!filePath) return;
      if (!fileToMem[filePath]) fileToMem[filePath] = [];
      var exists = fileToMem[filePath].some(function(x) { return x.id === memItem.id; });
      if (!exists) fileToMem[filePath].push(memItem);
    }
    (snapshot.memories || []).forEach(function(m) {
      if (m.enabled === false) return;
      var fps = m.ast_fingerprints || {};
      var syms = m.target_symbols || [];
      syms.forEach(function(s) {
        var f = s.split('#')[0].replace(/\\\\/g, '/');
        if (f.indexOf('/') !== -1 || /\\.[a-z0-9]+$/i.test(f)) {
          addMemToFile(f, m);
        }
      });
      Object.keys(fps).forEach(function(k) {
        var f = (fps[k].file_path || fps[k].file || '').replace(/\\\\/g, '/');
        addMemToFile(f, m);
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
        '<div style="display:flex; align-items:center; gap:8px; min-width:0; overflow:hidden; flex:1;">' +
        '<span class="badge-kind" style="flex-shrink:0;">' + formatKind(ev.kind) + '</span>' +
        '<strong style="color:var(--text-primary); font-family:var(--font-mono); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + esc(ev.target_id || '') + '">' + esc(ev.target_id || '') + '</strong>' +
        (ev.stage_failed ? '<span style="color:var(--status-danger); font-size:11px; flex-shrink:0;">[' + esc(ev.stage_failed) + ']</span>' : '') +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
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
    var inspEl = el('right-inspector');
    if (inspEl) inspEl.classList.add('open');
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
    var isArchived = Boolean(item.archived_at);
    var isPaused = item.enabled === false;
    var isPending = item.review_status === 'pending' && !isArchived;

    // 1. Header
    var header = document.createElement('div');
    header.className = 'inspector-header';
    var fresh = !isArchived ? ((item.freshness && item.freshness.overall_status) || (kind === 'memories' ? 'VERIFIED' : '')) : '';
    var statusBadge = '';
    if (isArchived) {
      statusBadge = '<span class="badge-status"><span class="dot"></span> ' + esc(dict.badgeArchived) + '</span>';
    } else if (isPaused) {
      statusBadge = '<span class="badge-status" style="color:var(--text-muted);"><span class="dot"></span> ' + esc(dict.badgePaused) + '</span>';
    } else if (fresh) {
      var sDot = fresh === 'VERIFIED' ? 'dot-ok' : (fresh === 'STALE' ? 'dot-danger' : 'dot-warn');
      statusBadge = '<span class="badge-status"><span class="dot ' + sDot + '"></span> ' + esc(fresh) + '</span>';
    } else if (kind === 'rules') {
      statusBadge = item.core
        ? '<span class="badge-status"><span class="dot dot-ok"></span> CORE</span>'
        : '<span class="badge-status badge-scoped">SCOPED</span>';
    } else if (kind === 'tools') {
      statusBadge = '<span class="badge-status">SANDBOX</span>';
    }
    var pendingBadge = isPending
      ? ' <span class="badge-status" style="color:var(--status-warn); border-color:var(--status-warn-border); background:var(--status-warn-bg);">' + esc(dict.badgePending) + '</span>'
      : '';

    var topRow = document.createElement('div');
    topRow.className = 'inspector-top-row';
    topRow.innerHTML = '<div class="inspector-badges"><span class="badge-kind">' + formatKind(kind) + '</span>' + statusBadge + pendingBadge + '</div>' +
      '<button class="btn-action" id="btn-close-inspector" type="button" style="padding:2px 8px;" title="Close">✕</button>';

    var btnClose = topRow.querySelector('#btn-close-inspector');
    if (btnClose) {
      btnClose.addEventListener('click', function() {
        var inspEl = el('right-inspector');
        if (inspEl) inspEl.classList.remove('open');
        selectedCapability = null;
        renderInspector();
        renderCapabilitiesTable();
      });
    }

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

    if (isArchived) {
      var btnRestore = document.createElement('button');
      btnRestore.type = 'button';
      btnRestore.className = 'btn-action';
      btnRestore.style.color = 'var(--status-ok)';
      btnRestore.style.borderColor = 'var(--status-ok-border)';
      btnRestore.textContent = dict.restore;
      btnRestore.addEventListener('click', function() {
        callKernelAction('restore-item', { kind: singularKind(kind), id: item.id }).then(function(res) {
          if (res.ok) {
            if (res.snapshot) snapshot = res.snapshot;
            var restored = (snapshot[kind] || []).find(function(x) { return x.id === item.id; });
            if (restored) {
              selectedCapability = { kind: kind, item: restored };
            } else {
              selectedCapability = null;
            }
            renderTelemetry();
            renderCapabilitiesTable();
            renderInspector();
            showToast('success', (lang === 'zh' ? '已从回收站恢复 ' : 'Restored ') + item.id);
          } else {
            showToast('error', res.error || 'Restore failed');
          }
        });
      });
      toolbar.appendChild(btnRestore);
    } else {
      // Button: Approve (if pending)
      if (isPending) {
        var btnApprove = document.createElement('button');
        btnApprove.type = 'button';
        btnApprove.className = 'btn-action';
        btnApprove.style.color = 'var(--status-ok)';
        btnApprove.style.borderColor = 'var(--status-ok-border)';
        btnApprove.textContent = dict.approve;
        btnApprove.addEventListener('click', function() {
          callKernelAction('approve-item', { kind: singularKind(kind), id: item.id }).then(function(res) {
            if (res.ok) {
              item.review_status = 'approved';
              if (res.snapshot) snapshot = res.snapshot;
              renderTelemetry();
              renderCapabilitiesTable();
              renderInspector();
              showToast('success', (lang === 'zh' ? '已确认 ' : 'Approved ') + item.id);
            } else {
              showToast('error', res.error || 'Approve failed');
            }
          });
        });
        toolbar.appendChild(btnApprove);
      }

      // Button: Pause / Enable
      var btnPause = document.createElement('button');
      btnPause.type = 'button';
      btnPause.className = 'btn-action';
      btnPause.textContent = isPaused ? dict.resumeItem : dict.pauseItem;
      btnPause.addEventListener('click', function() {
        var nextEnabled = isPaused ? true : false;
        callKernelAction('toggle-enabled', { kind: singularKind(kind), id: item.id, enabled: nextEnabled }).then(function(res) {
          if (res.ok) {
            item.enabled = nextEnabled;
            if (res.snapshot) snapshot = res.snapshot;
            renderTelemetry();
            renderCapabilitiesTable();
            renderInspector();
            showToast('success', (nextEnabled ? (lang === 'zh' ? '已启用 ' : 'Enabled ') : (lang === 'zh' ? '已搁置 ' : 'Paused ')) + item.id);
          } else {
            showToast('error', res.error || 'Failed to toggle status');
          }
        });
      });
      toolbar.appendChild(btnPause);

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
              if (res.snapshot) {
                snapshot = res.snapshot;
                var updatedRule = (snapshot.rules || []).find(function(r) { return r.id === item.id; });
                if (updatedRule) selectedCapability.item = updatedRule;
              } else {
                item.core = !item.core;
              }
              renderInspector();
              renderCapabilitiesTable();
              renderTelemetry();
              var tokNow = (res.data && res.data.tokenUsage !== undefined) ? res.data.tokenUsage : (res.tokenUsage || 0);
              showToast('success', 'Rule moved to ' + (selectedCapability.item.core ? 'Core (' + tokNow + '/1500 tok)' : 'Scoped'));
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

      // Button: Archive (No window.confirm — uses Undo Toast for Webview compatibility)
      var btnArchive = document.createElement('button');
      btnArchive.type = 'button';
      btnArchive.className = 'btn-action btn-danger';
      btnArchive.textContent = dict.archive;
      btnArchive.addEventListener('click', function() {
        archiveAndOfferUndo(kind, item.id);
      });
      toolbar.appendChild(btnArchive);
    }

    content.appendChild(toolbar);

    // 2.5 One-Sentence Core Takeaway (TL;DR Card) for all capability types
    var tldrText = item.l0_summary || item.description || item.title || '';
    if (tldrText && inspectorMode !== 'edit') {
      var tldrSection = document.createElement('div');
      tldrSection.className = 'inspector-section';
      tldrSection.innerHTML =
        '<div class="tldr-card">' +
          '<div class="tldr-card-label">' + esc(dict.tldrLabel) + '</div>' +
          '<div class="tldr-card-body">' + formatRichText(tldrText) + '</div>' +
        '</div>';
      content.appendChild(tldrSection);
    }

    // 2.8 STALE / OTHER_BRANCH Action Banner (Memories)
    if (!isArchived && kind === 'memories' && (fresh === 'STALE' || fresh === 'OTHER_BRANCH')) {
      var staleBanner = document.createElement('div');
      staleBanner.className = 'inspector-section';
      staleBanner.innerHTML =
        '<div class="stale-action-banner">' +
          '<div class="stale-action-text">' + esc(dict.staleBannerText) + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' +
            '<button type="button" class="btn-action" id="btn-rebind-ast" style="color:var(--status-ok);border-color:var(--status-ok-border);">' + esc(dict.rebindAst) + '</button>' +
            '<button type="button" class="btn-action" id="btn-stale-pause">' + esc(isPaused ? dict.resumeItem : dict.pauseItem) + '</button>' +
            '<button type="button" class="btn-action btn-danger" id="btn-stale-archive">' + esc(dict.archive) + '</button>' +
          '</div>' +
        '</div>';
      content.appendChild(staleBanner);

      var btnRebind = staleBanner.querySelector('#btn-rebind-ast');
      if (btnRebind) {
        btnRebind.addEventListener('click', function() {
          btnRebind.textContent = dict.rebindingAst;
          callKernelAction('rebind-memory-ast', { id: item.id }).then(function(res) {
            btnRebind.textContent = dict.rebindAst;
            if (res.ok && res.snapshot) {
              snapshot = res.snapshot;
              var updated = (snapshot.memories || []).find(function(m) { return m.id === item.id; });
              if (updated) selectedCapability.item = updated;
              renderTelemetry();
              renderCapabilitiesTable();
              renderInspector();
              showToast('success', 'AST re-bound to current branch');
            } else {
              showToast('error', res.error || 'Re-bind failed');
            }
          });
        });
      }
      var btnStalePause = staleBanner.querySelector('#btn-stale-pause');
      if (btnStalePause) {
        btnStalePause.addEventListener('click', function() {
          btnPause.click();
        });
      }
      var btnStaleArchive = staleBanner.querySelector('#btn-stale-archive');
      if (btnStaleArchive) {
        btnStaleArchive.addEventListener('click', function() {
          archiveAndOfferUndo(kind, item.id);
        });
      }
    }

    // 3. AST Anchors Section (Memories) — Deduplicated symbol & overflow protected
    if (!isArchived && kind === 'memories') {
      var anchors = (item.freshness && item.freshness.topology_anchors) || [];
      var astSection = document.createElement('div');
      astSection.className = 'inspector-section';
      astSection.innerHTML = '<div class="inspector-section-title"><span>' + esc(dict.astAnchors) + ' (' + anchors.length + ')</span>' + statusBadge + '</div>';

      anchors.forEach(function(anchor) {
        var row = document.createElement('div');
        row.className = 'ast-anchor-card';
        var startLine = parseInt(String(anchor.lines || '1').split('-')[0].replace(/[^0-9]/g, ''), 10) || 1;
        var rawSym = String(anchor.symbol || '');
        var symName = rawSym.indexOf('#') !== -1
          ? rawSym.split('#').slice(1).join('#')
          : (rawSym !== anchor.file_path ? rawSym : '');
        var fullRef = symName ? (anchor.file_path + '#' + symName) : anchor.file_path;

        row.innerHTML =
          '<div class="ast-anchor-path" title="' + esc(fullRef) + '">' +
            '<span class="ast-anchor-file">' + esc(anchor.file_path) + '</span>' +
            (symName ? '<span class="ast-anchor-symbol">#' + esc(symName) + '</span>' : '') +
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
        callKernelAction('update-content', { kind: singularKind(kind), id: item.id, content: newContent }).then(function(res) {
          if (res.ok) {
            showToast('success', 'Changes saved to ' + item.id);
            if (res.snapshot) {
              snapshot = res.snapshot;
              var updatedItem = (snapshot[kind] || []).find(function(x) { return x.id === item.id; });
              if (updatedItem) selectedCapability.item = updatedItem;
              else item.content = newContent;
            } else {
              item.content = newContent;
            }
            inspectorMode = 'preview';
            renderTelemetry();
            renderCapabilitiesTable();
            renderInspector();
          } else {
            showToast('error', res.error || 'Save failed');
          }
        });
      });
    } else {
      // Structured Bento Preview with formatted inline code
      if (kind === 'memories' && (item.symptom || item.root_cause || item.solution)) {
        contentSection.innerHTML =
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-danger);">' +
            '<div class="bento-card-label" style="color:var(--status-danger);">Symptom</div>' +
            '<div class="bento-card-content">' + formatRichText(item.symptom) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-warn);">' +
            '<div class="bento-card-label" style="color:var(--status-warn);">Root Cause</div>' +
            '<div class="bento-card-content">' + formatRichText(item.root_cause) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-ok);">' +
            '<div class="bento-card-label" style="color:var(--status-ok);">Solution</div>' +
            '<div class="bento-card-content">' + formatRichText(item.solution) + '</div>' +
          '</div>';
      } else if (kind === 'skills' && (item.l1_contract || item.l2_sop)) {
        contentSection.innerHTML =
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label" style="color:var(--status-info);">L1 Contract</div>' +
            '<div class="bento-card-content">' + formatRichText(item.l1_contract) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label" style="color:var(--status-ok);">L2 SOP</div>' +
            '<div class="bento-card-content">' + formatRichText(item.l2_sop) + '</div>' +
          '</div>';
      } else {
        contentSection.innerHTML =
          (item.content ? '<div class="bento-card-preview"><div class="bento-card-label">Content</div><div class="bento-card-content">' + formatRichText(item.content) + '</div></div>' : '');
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
          '<div style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;flex:1;">' +
            '<span class="badge-kind" style="flex-shrink:0;">' + esc(kLabel) + '</span>' +
            '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(c.title || c.id) + '</span>' +
          '</div>' +
          '<span class="kbd-shortcut" style="flex-shrink:0;">' + esc(c.id) + '</span>';

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
          '<div style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;flex:1;">' +
            '<span class="badge-status" style="color:var(--status-warn);flex-shrink:0;"><span class="dot dot-warn"></span> HOTSPOT</span>' +
            '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(h.filePath) + '</span>' +
          '</div>' +
          '<span class="kbd-shortcut" style="flex-shrink:0;">f:' + h.fragilityScore + '</span>';

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
          try { window.localStorage.setItem('evo_ui_lang', lang); } catch (e) {}
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
          '<div style="min-width:0;overflow:hidden;flex:1;">' +
            '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(gc.title) + '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(gc.sub) + '</div>' +
          '</div>' +
          '<span class="kbd-shortcut" style="flex-shrink:0;">↵</span>';

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

    // Kind & Status Filter Pills
    var kp = el('caps-kind-pills');
    if (kp) {
      var kindLabels = {
        all: dict.allKinds,
        rules: dict.rules,
        skills: dict.skills,
        tools: dict.tools,
        memories: dict.memories
      };
      kp.querySelectorAll('.filter-pill').forEach(function(p) {
        var k = p.getAttribute('data-kind');
        if (k && kindLabels[k]) p.textContent = kindLabels[k];
      });
    }
    var sp = el('caps-status-pills');
    if (sp) {
      var statusLabels = {
        all: dict.allStatus,
        pending: dict.statusPending,
        active: dict.statusActive,
        paused: dict.statusPaused,
        verified: dict.statusVerified,
        stale: dict.statusStale,
        core: dict.statusCore,
        scoped: dict.statusScoped,
        archived: dict.statusArchived
      };
      sp.querySelectorAll('.filter-pill').forEach(function(p) {
        var st = p.getAttribute('data-status');
        if (st && statusLabels[st]) p.textContent = statusLabels[st];
      });
    }

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

  // 1.5 Left Rail Interactive Bento Cards (Health Diagnostics & Core Budget)
  var bentoHealth = el('bento-health');
  if (bentoHealth) {
    bentoHealth.style.cursor = 'pointer';
    bentoHealth.addEventListener('click', function() {
      healthDiagExpanded = !healthDiagExpanded;
      switchView('capabilities');
      renderHealthDiagnosticsBanner();
    });
  }

  var bentoBudget = el('bento-budget');
  if (bentoBudget) {
    bentoBudget.style.cursor = 'pointer';
    bentoBudget.addEventListener('click', function() {
      applyQuickFilter('rules', 'core', true);
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
      capsSortByTokens = false;
      kindPillGroup.querySelectorAll('.filter-pill').forEach(function(p) { p.classList.remove('active'); });
      pill.classList.add('active');

      // Auto-cooperative: reset incompatible status filters (keep pending/paused/archived across all kinds)
      if (statusPillGroup) {
        if (activeCapsKind === 'memories' && (activeCapsStatus === 'core' || activeCapsStatus === 'scoped')) {
          activeCapsStatus = 'all';
        } else if (activeCapsKind === 'rules' && (activeCapsStatus === 'verified' || activeCapsStatus === 'stale')) {
          activeCapsStatus = 'all';
        } else if ((activeCapsKind === 'skills' || activeCapsKind === 'tools') && (activeCapsStatus === 'core' || activeCapsStatus === 'scoped' || activeCapsStatus === 'verified' || activeCapsStatus === 'stale')) {
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
      capsSortByTokens = false;
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

  // Batch Action Buttons (Approve All Pending / Pause All Stale)
  var btnBatchApprove = el('btn-batch-approve-pending');
  if (btnBatchApprove) {
    btnBatchApprove.addEventListener('click', function() {
      callKernelAction('approve-item', { approveAll: true }).then(function(res) {
        if (res.ok) {
          if (res.snapshot) snapshot = res.snapshot;
          renderTelemetry();
          renderCapabilitiesTable();
          if (selectedCapability) renderInspector();
          var approvedCount = (res.data && res.data.approvedCount !== undefined) ? res.data.approvedCount : (res.approvedCount || 0);
          showToast('success', 'Approved ' + approvedCount + ' pending capabilities');
        }
      });
    });
  }

  var btnBatchPauseStale = el('btn-batch-pause-stale');
  if (btnBatchPauseStale) {
    btnBatchPauseStale.addEventListener('click', function() {
      var staleList = (snapshot.memories || []).filter(function(m) {
        var st = (m.freshness && m.freshness.overall_status) || 'VERIFIED';
        return st === 'STALE' && m.enabled !== false;
      }).map(function(m) {
        return { kind: 'memory', id: m.id };
      });
      if (staleList.length === 0) return;
      callKernelAction('toggle-enabled', { items: staleList, enabled: false }).then(function(res) {
        if (res.ok) {
          if (res.snapshot) snapshot = res.snapshot;
          renderTelemetry();
          renderCapabilitiesTable();
          if (selectedCapability) renderInspector();
          showToast('success', 'Paused ' + staleList.length + ' stale memories');
        }
      });
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
    if (e.key === 'Escape') {
      if (cmdPaletteOpen) {
        e.preventDefault();
        closeCommandPalette();
        return;
      }
      var inspEl = el('right-inspector');
      if (inspEl) inspEl.classList.remove('open');
      return;
    }
    if (!cmdPaletteOpen) return;

    if (e.key === 'ArrowDown') {
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
      try { window.localStorage.setItem('evo_ui_lang', lang); } catch (e) {}
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
  var platformStr = (typeof navigator !== 'undefined' && ((navigator.platform || '') + (navigator.userAgent || ''))) || '';
  if (/Win|Linux/i.test(platformStr)) {
    var kbd = el('cmd-palette-kbd');
    if (kbd) kbd.textContent = 'Ctrl K';
  }

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

      /* --- Modern Font Stack & Geometry --- */
      --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif;
      --font-mono: "Cascadia Code", "Cascadia Mono", "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace;

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
      letter-spacing: -0.011em;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: "cv02", "cv03", "cv04", "cv11";
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
      white-space: nowrap;
      flex-shrink: 0;
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
      min-width: 0;
      overflow: hidden;
    }
    .workspace-pill .ws-icon {
      font-size: 11px;
      flex-shrink: 0;
    }
    .workspace-pill .ws-path {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
      transition: border-color var(--duration-micro) ease;
    }
    .bento-card:hover {
      border-color: var(--border-focus);
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

    .health-diagnostics-banner {
      padding: 10px 20px;
      background: rgba(16, 185, 129, 0.04);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }
    .diag-banner-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11.5px;
      color: var(--text-primary);
    }
    .diag-chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .diag-chip {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      font-size: 11.5px;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all var(--duration-micro) ease;
    }
    .diag-chip:hover {
      background: var(--bg-elevated);
      border-color: var(--border-focus);
      color: var(--text-primary);
    }
    .diag-chip-danger {
      border-color: var(--status-danger-border);
      background: var(--status-danger-bg);
      color: var(--text-primary);
    }
    .diag-chip-warn {
      border-color: var(--status-warn-border);
      background: var(--status-warn-bg);
      color: var(--text-primary);
    }
    .diag-chip-info {
      border-color: rgba(56, 189, 248, 0.35);
      background: rgba(56, 189, 248, 0.08);
      color: var(--text-primary);
    }
    .diag-chip-ok {
      border-color: var(--status-ok-border);
      background: var(--status-ok-bg);
      color: var(--status-ok);
      cursor: default;
    }
    .diag-chip-cta {
      font-family: var(--font-mono);
      font-size: 10.5px;
      font-weight: 600;
      color: var(--status-ok);
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
      flex-wrap: wrap;
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
      white-space: nowrap;
      flex-shrink: 0;
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
      table-layout: fixed;
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
    #capabilities-table th:nth-child(1),
    #capabilities-table td:nth-child(1) {
      width: 78px;
    }
    #capabilities-table th:nth-child(2),
    #capabilities-table td:nth-child(2) {
      width: auto;
      max-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #capabilities-table th:nth-child(3),
    #capabilities-table td:nth-child(3) {
      width: 155px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #capabilities-table th:nth-child(4),
    #capabilities-table td:nth-child(4) {
      width: 105px;
    }
    #capabilities-table th:nth-child(5),
    #capabilities-table td:nth-child(5) {
      width: 136px;
      text-align: right;
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
    .data-table tr.row-paused {
      opacity: 0.55;
    }
    .row-actions-wrap {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
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
    .badge-status.badge-scoped {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .scoped-glob-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot-ok { background: var(--status-ok); }
    .dot-warn { background: var(--status-warn); }
    .dot-danger { background: var(--status-danger); }

    .item-title-wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .item-title-line {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }
    .item-main-title,
    .item-sub-desc {
      color: var(--text-primary);
      font-weight: 500;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .item-sub-id {
      color: var(--text-muted);
      font-size: 10.5px;
      font-family: var(--font-mono);
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-sub-summary {
      color: var(--text-secondary);
      font-size: 11.5px;
      max-width: 440px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    .topo-node-title {
      font-family: var(--font-sans);
      font-size: 11.5px;
      font-weight: 500;
      letter-spacing: -0.01em;
    }
    .topo-node-sub {
      font-family: var(--font-mono);
      font-size: 9.5px;
      letter-spacing: -0.01em;
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
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: -0.01em;
      padding: 5px 11px;
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
      overflow: hidden;
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
      gap: 6px;
      min-width: 0;
      overflow: hidden;
    }
    .ast-anchor-file {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .ast-anchor-symbol {
      color: var(--status-info);
      font-weight: 600;
      max-width: 55%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 0;
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

    .tldr-card {
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid var(--status-ok-border);
      border-left: 3px solid var(--status-ok);
      border-radius: var(--radius-lg);
      padding: 10px 14px;
      box-shadow: var(--surface-highlight);
    }
    .tldr-card-label {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--status-ok);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .tldr-card-body {
      font-size: 12.5px;
      color: var(--text-primary);
      line-height: 1.5;
      word-break: break-word;
    }

    .stale-action-banner {
      background: var(--status-warn-bg);
      border: 1px solid var(--status-warn-border);
      border-left: 3px solid var(--status-warn);
      border-radius: var(--radius-lg);
      padding: 10px 14px;
    }
    .stale-action-text {
      font-size: 12px;
      color: var(--text-primary);
      line-height: 1.45;
    }

    .inline-code-pill {
      font-family: var(--font-mono);
      font-size: 11px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border-subtle);
      padding: 1px 5px;
      border-radius: 4px;
      color: var(--text-primary);
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
      font-family: var(--font-sans);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
      text-transform: uppercase;
      color: var(--text-secondary);
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
      font-family: var(--font-sans);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 6px 12px 4px;
      text-transform: uppercase;
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
    .toast-undo-btn {
      background: var(--bg-elevated);
      border: 1px solid var(--border-focus);
      color: var(--status-ok);
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      margin-left: 4px;
    }
    .toast-undo-btn:hover {
      background: var(--status-ok-bg);
    }
    @keyframes toastSlideIn {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Responsive Design */
    @media (max-width: 1360px) {
      :root {
        --right-inspector-width: 320px;
      }
    }
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
      #capabilities-table th:nth-child(3),
      #capabilities-table td:nth-child(3),
      #capabilities-table th:nth-child(4),
      #capabilities-table td:nth-child(4) {
        display: none;
      }
      #capabilities-table th:nth-child(1),
      #capabilities-table td:nth-child(1) {
        width: 58px;
        padding: 8px 6px;
      }
      #capabilities-table th:nth-child(5),
      #capabilities-table td:nth-child(5) {
        width: 88px;
        padding: 8px 6px;
      }
      .search-placeholder {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .workspace-pill {
        display: none;
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
        <kbd class="kbd-shortcut" id="cmd-palette-kbd">⌘K</kbd>
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
        <div class="bento-card" id="bento-health" title="Click to toggle Health Diagnostics">
          <div class="bento-title" id="bento-title-health">Health Score</div>
          <div class="bento-metric-row">
            <span class="bento-metric-value" id="bento-health-val">--</span>
            <span class="bento-badge" id="bento-health-grade">Grade --</span>
          </div>
          <div class="bento-subtext">Zero-leak AST shielding · Click to diagnose</div>
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
        <div class="bento-card" id="bento-budget" title="Click to filter & sort Core Rules by token footprint">
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
              <button type="button" class="filter-pill" data-status="pending" id="pill-status-pending">Pending</button>
              <button type="button" class="filter-pill" data-status="active">Active</button>
              <button type="button" class="filter-pill" data-status="verified">Verified</button>
              <button type="button" class="filter-pill" data-status="stale">Stale</button>
              <button type="button" class="filter-pill" data-status="core">Core</button>
              <button type="button" class="filter-pill" data-status="scoped">Scoped</button>
              <button type="button" class="filter-pill" data-status="paused">Paused</button>
              <button type="button" class="filter-pill" data-status="archived" id="pill-status-archived">Archived</button>
            </div>
            <button type="button" class="btn-action" id="btn-batch-approve-pending" style="display:none;color:var(--status-ok);border-color:var(--status-ok-border);padding:3px 9px;font-size:11.5px;">✓ Approve All</button>
            <button type="button" class="btn-action" id="btn-batch-pause-stale" style="display:none;color:var(--status-warn);border-color:var(--status-warn-border);padding:3px 9px;font-size:11.5px;">⏸ Pause All Stale</button>
            <div class="search-box">
              <input type="text" id="caps-search-input" class="search-input" placeholder="Filter capabilities (id, title, symbol, file)..." autocomplete="off" />
            </div>
            <div class="view-count-badge" id="caps-count-label">0 items</div>
          </div>
        </div>
        <div class="health-diagnostics-banner" id="health-diagnostics-banner" style="display:none;"></div>
        <div class="table-scroll-container">
          <table class="data-table" id="capabilities-table">
            <thead>
              <tr>
                <th style="width: 84px;">Type</th>
                <th>ID &amp; Title</th>
                <th style="width: 150px;">Scope / Status</th>
                <th style="width: 130px;">Attribution</th>
                <th style="width: 140px; text-align: right;">Actions</th>
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
