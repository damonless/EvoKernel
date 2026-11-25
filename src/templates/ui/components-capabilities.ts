export function renderCapabilitiesViewsHtml(): string {
  return `
      <!-- View 1: Capabilities Data Table -->
      <section class="view-panel active" id="view-capabilities">
        <div class="hero-learned-strip" id="hero-learned-strip">
          <div class="hero-learned-hdr">
            <span class="hero-learned-title" id="hero-learned-title">What EvoKernel Has Learned</span>
            <div class="hero-helped-badge" id="hero-card-recently-helped">
              <span class="hero-helped-badge-lbl" id="hero-recently-helped-lbl">Recently Helped</span>
              <span class="hero-helped-badge-val" id="hero-recently-helped-list"></span>
            </div>
          </div>
          <div class="hero-learned-grid">
            <div class="hero-learned-card" id="hero-card-about-you">
              <div class="hero-card-label" id="hero-about-you-lbl">About You</div>
              <div class="hero-card-list" id="hero-about-you-list"></div>
              <form class="hero-habit-form" id="hero-habit-form">
                <input type="text" id="hero-habit-input" class="hero-habit-input" placeholder="Tell it a habit..." autocomplete="off" />
                <button type="submit" id="btn-hero-habit-save" class="btn-action" style="padding:3px 8px;font-size:var(--text-xs);">Save</button>
              </form>
            </div>
            <div class="hero-learned-card" id="hero-card-this-project">
              <div class="hero-card-label" id="hero-this-project-lbl">This Project</div>
              <div class="hero-card-list" id="hero-this-project-list"></div>
            </div>
          </div>
        </div>
        <div class="view-header" id="caps-view-header">
          <div class="filter-toolbar">
            <div class="pill-group" id="caps-kind-pills">
              <button type="button" class="filter-pill active" data-kind="all" id="tab-overview">All</button>
              <button type="button" class="filter-pill" data-kind="rules">Rules</button>
              <button type="button" class="filter-pill" data-kind="skills">Skills</button>
              <button type="button" class="filter-pill" data-kind="tools">Tools</button>
              <button type="button" class="filter-pill" data-kind="memories" id="tab-memories">Memories</button>
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
            <button type="button" class="btn-action" id="btn-batch-approve-pending" style="display:none;color:var(--status-ok);border-color:var(--status-ok-border);padding:3px 9px;font-size:var(--text-sm);">Approve All</button>
            <button type="button" class="btn-action" id="btn-batch-pause-stale" style="display:none;color:var(--status-warn);border-color:var(--status-warn-border);padding:3px 9px;font-size:var(--text-sm);">Pause All Stale</button>
            <div class="search-box" id="cap-search">
              <input type="text" id="caps-search-input" class="search-input" placeholder="Filter capabilities (id, title, symbol, file)..." autocomplete="off" />
            </div>
            <div class="view-count-badge" id="caps-count-label">0 items</div>
          </div>
          <div id="batch-approve-confirm-bar" class="inline-confirm-bar" style="display:none;"></div>
        </div>
        <div class="health-diagnostics-banner" id="health-diagnostics-banner" style="display:none;"></div>
        <div class="needs-attention-panel" id="needs-attention-panel" style="display:none;"></div>
        <div class="table-scroll-container">
          <table class="data-table" id="capabilities-table">
            <thead>
              <tr>
                <th id="th-cap-type">Type</th>
                <th id="th-cap-title">ID &amp; Title</th>
                <th id="th-cap-scope">Scope / Status</th>
                <th id="th-cap-attr">Attribution</th>
                <th id="th-cap-actions">Actions</th>
              </tr>
            </thead>
            <tbody id="capabilities-table-body"></tbody>
          </table>
          <div id="caps-empty-state" class="empty-state" style="display: none;">
            <span id="caps-empty-state-msg">No capabilities match the current filter.</span>
            <button type="button" class="btn-action" id="btn-caps-clear-filters" style="display:none;margin-left:8px;">Clear filters</button>
          </div>
        </div>
      </section>

      <!-- View 2: Capability & Code Map -->
      <section class="view-panel" id="view-topology">
        <div class="view-header" id="topo-view-header">
          <div class="topo-header-row">
            <div>
              <h2 class="view-title" id="topo-view-title">Capability &amp; Code Map</h2>
              <p class="view-subtitle" id="topo-view-sub">Rules &amp; Workflows &rarr; Project Lessons &rarr; Linked Source Files</p>
            </div>
            <div class="topo-legend" id="topo-legend">
              <span class="legend-item"><span class="dot dot-ok"></span> Verified</span>
              <span class="legend-item"><span class="dot dot-warn"></span> Other Branch</span>
              <span class="legend-item"><span class="dot dot-danger"></span> Outdated</span>
              <span class="legend-hint">Hover or click a card to focus related links</span>
            </div>
          </div>
        </div>
        <div class="topo-scroll-container" id="topo-container">
          <svg id="topology-svg" class="topology-svg" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
        <div class="ast-footnote" id="topo-ast-footnote">* Code links automatically check whether the referenced functions have changed.</div>
      </section>

      <!-- View 3: Git Fragile Hotspots View -->
      <section class="view-panel" id="view-hotspots">
        <div class="view-header" id="hotspots-view-header">
          <div class="hotspots-header-row">
            <div>
              <h2 class="view-title" id="hotspots-view-title">Fragile Files &amp; Lesson Coverage</h2>
              <p class="view-subtitle" id="hotspots-view-sub">Frequently fixed files and whether they have saved project lessons</p>
            </div>
            <div class="hotspots-header-controls">
              <input type="text" id="mem-search" class="search-input" placeholder="Filter hotspots or bound memories..." autocomplete="off" />
              <div class="hotspots-kpi-badge" id="hotspots-summary-kpi">0 / 0 Protected</div>
            </div>
          </div>
        </div>
        <div id="hotspot-mem-drawer" class="hotspot-mem-drawer"></div>
        <div class="table-scroll-container">
          <table class="data-table" id="hotspots-table">
            <thead>
              <tr>
                <th id="th-hs-path">Source File Path</th>
                <th id="th-hs-frag">Fragility Score</th>
                <th id="th-hs-commits">Fix Commits</th>
                <th id="th-hs-mems">Linked Project Lessons</th>
                <th id="th-hs-status">Status</th>
                <th id="th-hs-action">Action</th>
              </tr>
            </thead>
            <tbody id="hotspots-table-body"></tbody>
          </table>
          <div id="hotspots-empty-state" class="empty-state" style="display: none;">
            No fragile hotspots detected. Repository history looks steady.
          </div>
        </div>
      </section>

      <!-- View 4: Safety Check Log -->
      <section class="view-panel" id="view-gatekeeper">
        <div class="view-header" id="gk-view-header">
          <div class="gk-header-row">
            <div>
              <h2 class="view-title" id="gk-view-title">Safety Check Log</h2>
              <p class="view-subtitle" id="gk-view-sub">History of saved and blocked changes (security, self-test, code links, and token limits)</p>
            </div>
            <div class="pill-group" id="gk-filter-pills">
              <button type="button" class="filter-pill active" data-filter="all">All Events</button>
              <button type="button" class="filter-pill" data-filter="pass">Passed</button>
              <button type="button" class="filter-pill" data-filter="fail">Blocked</button>
            </div>
          </div>
        </div>
        <div class="timeline-scroll-container" id="gatekeeper-timeline"></div>
      </section>
  `;
}

export const CAPABILITIES_CLIENT_SCRIPT = `
  function getMaxCoreRuleTokens() {
    var m = snapshot && (snapshot.maxCoreRuleTokens || (snapshot.score && snapshot.score.maxCoreRuleTokens));
    var n = Number(m || 1500);
    return (isFinite(n) && n > 0) ? n : 1500;
  }

  function computeActiveCoreTokens() {
    var score = snapshot.score || {};
    var savings = score.contextSavings || {};
    var coreTokens = savings.evoSeedTokens || 0;
    if (Array.isArray(snapshot.rules)) {
      coreTokens = snapshot.rules
        .filter(function(r) { return r.core && r.enabled !== false; })
        .reduce(function(acc, r) {
          return acc + (r.token_count || r.tokens || Math.ceil((r.l0_summary || '').length / 4));
        }, 0);
    }
    return coreTokens;
  }

  function getWindow7dStats() {
    var w = snapshot.window7d || (snapshot.score && snapshot.score.window7d) || {};
    return {
      searches: Number(w.searchEvents !== undefined ? w.searchEvents : (w.searches || 0)),
      inspected: Number(w.inspectEvents !== undefined ? w.inspectEvents : (w.inspected || 0)),
      toolsExecuted: Number(w.runEvents !== undefined ? w.runEvents : (w.toolsExecuted || 0)),
      helped: Number(w.adoptedCount !== undefined ? w.adoptedCount : (w.helpedCount || w.helped || 0)),
      pitfallsAvoided: Number(w.helpedCount !== undefined ? w.helpedCount : (w.pitfallsAvoided || 0))
    };
  }

  function renderTelemetry() {
    var dict = i18n[lang] || i18n.en;
    var score = snapshot.score || {};
    var savings = score.contextSavings || { beforeTokens: 0, afterTokens: 0, savedTokens: 0, savingsPercent: 0, userStaticRuleTokens: 0, evoSeedTokens: 0 };
    var hasScore = score && typeof score.overallScore === 'number';
    var overall = hasScore ? score.overallScore : null;
    var grade = hasScore ? (score.grade || (overall >= 95 ? 'A+' : (overall >= 85 ? 'A' : (overall >= 70 ? 'B' : (overall >= 55 ? 'C' : (overall >= 40 ? 'D' : 'F')))))) : null;

    if (el('bento-health-val')) el('bento-health-val').textContent = hasScore ? String(overall) : '—';
    if (el('bento-health-grade')) el('bento-health-grade').textContent = hasScore ? (dict.gradePrefix + grade) : '—';
    if (el('bento-health-sub')) el('bento-health-sub').textContent = dict.healthSub;

    var hasSavings = savings && typeof savings.savingsPercent === 'number' && (savings.beforeTokens > 0 || savings.afterTokens > 0 || savings.savingsPercent !== 0);
    var isFixedGateway = Boolean(
      savings &&
      ((savings.afterTokens || 0) > (savings.beforeTokens || 0) || savings.savingsPercent < 0)
    );
    var savedHeadline = '—';
    var savedTransition = '—';
    var savedCombined = '—';
    if (hasSavings || isFixedGateway) {
      var beforeCompact = formatCompactTok(savings.beforeTokens || 0);
      var afterCompact = formatCompactTok(savings.afterTokens || 0);
      if (isFixedGateway) {
        savedHeadline = dict.compactAlwaysOnHeadline;
        savedTransition = dict.compactAlwaysOnDetail.replace('{tok}', afterCompact);
        savedCombined = savedHeadline + ' · ' + afterCompact + ' tok';
      } else {
        var pct = Math.max(0, savings.savingsPercent || 0);
        savedHeadline = pct > 0 ? (dict.savedPctPrefix + pct + '%') : '0%';
        savedTransition = beforeCompact + ' → ' + afterCompact + ' tok';
        savedCombined = savedHeadline + ' · ' + savedTransition;
      }
    }
    if (el('bento-saved-pct')) el('bento-saved-pct').textContent = savedHeadline;
    if (el('bento-saved-detail')) el('bento-saved-detail').textContent = savedTransition;

    var coreTokens = computeActiveCoreTokens();
    var maxCore = getMaxCoreRuleTokens();
    var warnCore = Math.round(maxCore * 0.8);
    if (el('bento-budget-counter')) {
      el('bento-budget-counter').innerHTML = '<span id="bento-budget-cur">' + coreTokens + '</span> / ' + maxCore + ' tok';
    } else if (el('bento-budget-cur')) {
      el('bento-budget-cur').textContent = String(coreTokens);
    }
    var budgetPct = Math.min(100, Math.round((coreTokens / maxCore) * 100));
    var budgetBar = el('bento-budget-bar');
    var budgetStatus = el('bento-budget-status');

    if (budgetBar) {
      budgetBar.style.width = budgetPct + '%';
      budgetBar.classList.remove('bar-warn', 'bar-danger');
      if (coreTokens > maxCore) {
        budgetBar.classList.add('bar-danger');
        if (budgetStatus) budgetStatus.textContent = dict.budgetStatusExceeded;
      } else if (coreTokens >= warnCore) {
        budgetBar.classList.add('bar-warn');
        if (budgetStatus) budgetStatus.textContent = dict.budgetStatusWarn.replace('{max}', String(maxCore));
      } else {
        if (budgetStatus) budgetStatus.textContent = dict.budgetStatusOk;
      }
    }

    var toolCount = (snapshot.tools || []).filter(function(x) { return x.enabled !== false; }).length;
    var skillCount = (snapshot.skills || []).filter(function(x) { return x.enabled !== false; }).length;
    var memoryCount = (snapshot.memories || []).filter(function(x) { return x.enabled !== false; }).length;
    var ruleCount = (snapshot.rules || []).filter(function(x) { return x.enabled !== false; }).length;

    var treemap = el('micro-treemap');
    if (treemap) {
      treemap.innerHTML = '';
      var segs = [
        { name: dict.rules, count: ruleCount, color: 'var(--kind-rule)' },
        { name: dict.skills, count: skillCount, color: 'var(--kind-skill)' },
        { name: dict.tools, count: toolCount, color: 'var(--kind-tool)' },
        { name: dict.memories, count: memoryCount, color: 'var(--kind-memory)' }
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

    var treemapLegend = el('micro-treemap-legend');
    if (treemapLegend) {
      treemapLegend.innerHTML =
        '<span class="treemap-leg-item"><span class="kind-dot kind-dot-rule"></span>' + esc(dict.rules) + ' ' + ruleCount + '</span>' +
        '<span class="treemap-leg-item"><span class="kind-dot kind-dot-skill"></span>' + esc(dict.skills) + ' ' + skillCount + '</span>' +
        '<span class="treemap-leg-item"><span class="kind-dot kind-dot-tool"></span>' + esc(dict.tools) + ' ' + toolCount + '</span>' +
        '<span class="treemap-leg-item"><span class="kind-dot kind-dot-memory"></span>' + esc(dict.memories) + ' ' + memoryCount + '</span>';
    }

    var w7 = getWindow7dStats();
    if (el('bento-recall-val')) el('bento-recall-val').textContent = String(w7.searches);
    if (el('bento-recall-adopted')) el('bento-recall-adopted').textContent = w7.helped + ' ' + dict.kpiAdoptedShort;
    if (el('bento-recall-sub')) {
      el('bento-recall-sub').textContent = w7.searches + ' ' + dict.kpiSearchesShort + ' · ' + w7.pitfallsAvoided + ' ' + dict.pitfallsShort;
    }
    if (el('kpi-strip-health-lbl')) el('kpi-strip-health-lbl').textContent = dict.kpiHealth;
    if (el('kpi-strip-health-val')) el('kpi-strip-health-val').textContent = hasScore ? (overall + ' (' + grade + ')') : '—';
    if (el('kpi-strip-saved-lbl')) el('kpi-strip-saved-lbl').textContent = dict.kpiSaved;
    if (el('kpi-strip-saved-val')) el('kpi-strip-saved-val').textContent = savedCombined;
    if (el('kpi-strip-budget-lbl')) el('kpi-strip-budget-lbl').textContent = dict.kpiBudget;
    if (el('kpi-strip-budget-val')) el('kpi-strip-budget-val').textContent = coreTokens + ' / ' + maxCore + ' tok';
    if (el('kpi-strip-recall-lbl')) el('kpi-strip-recall-lbl').textContent = dict.kpiRecall7d;
    if (el('kpi-strip-recall-val')) {
      el('kpi-strip-recall-val').textContent = w7.searches + ' ' + dict.kpiSearchesShort + ' · ' + w7.helped + ' ' + dict.kpiAdoptedShort;
    }

    var capsTotal = (snapshot.rules || []).length + (snapshot.skills || []).length + (snapshot.tools || []).length + (snapshot.memories || []).length;
    if (el('badge-count-caps')) el('badge-count-caps').textContent = String(capsTotal);
    var upPrefsCount = (snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences) ? snapshot.userProfile.preferences.length : (snapshot.preferences || []).length);
    if (el('badge-count-profile')) el('badge-count-profile').textContent = String(upPrefsCount);
    var hotspotsCount = (snapshot.score && snapshot.score.gitHotspots ? snapshot.score.gitHotspots.length : 0);
    if (el('badge-count-hotspots')) el('badge-count-hotspots').textContent = String(hotspotsCount);
    var gkCount = (snapshot.gatekeeperEvents ? snapshot.gatekeeperEvents.length : 0);
    if (el('badge-count-gk')) el('badge-count-gk').textContent = String(gkCount);

    var wsRoot = score.workspaceRoot || '~/workspace';
    if (isAnon) wsRoot = '~/workspace';
    if (el('topbar-ws-path')) {
      el('topbar-ws-path').textContent = formatWorkspaceDisplayPath(wsRoot);
      el('topbar-ws-path').title = wsRoot;
    }
    if (el('topbar-workspace-pill')) {
      el('topbar-workspace-pill').title = dict.activeWorkspace + ': ' + wsRoot;
    }

    renderWorkspacePulsePlaceholder(ruleCount, skillCount, toolCount, memoryCount, hasScore ? overall : null, grade, w7);
    renderHealthDiagnosticsBanner(coreTokens);
    renderHeroLearnedStrip();
  }

  function renderHeroLearnedStrip() {
    var strip = el('hero-learned-strip');
    if (!strip) return;
    var dict = i18n[lang] || i18n.en;
    if (el('hero-learned-title')) el('hero-learned-title').textContent = dict.heroLearnedTitle;
    if (el('hero-about-you-lbl')) el('hero-about-you-lbl').textContent = dict.heroAboutYouTitle;
    if (el('hero-this-project-lbl')) el('hero-this-project-lbl').textContent = dict.heroThisProjectTitle;
    if (el('hero-recently-helped-lbl')) el('hero-recently-helped-lbl').textContent = dict.heroRecentlyHelpedTitle;
    if (el('hero-habit-input')) el('hero-habit-input').placeholder = dict.heroHabitPlaceholder;
    if (el('btn-hero-habit-save')) el('btn-hero-habit-save').textContent = dict.heroHabitSaveBtn;
    var habitForm = el('hero-habit-form');
    if (habitForm) habitForm.style.display = isExport ? 'none' : 'flex';

    // 1. About You: newest 3 active global preferences + "+N more · View all"
    var aboutList = el('hero-about-you-list');
    if (aboutList) {
      aboutList.innerHTML = '';
      var upPrefs = (snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences))
        ? snapshot.userProfile.preferences
        : (snapshot.preferences || []);
      var activeHabits = upPrefs
        .filter(function(p) { return p && p.enabled !== false; })
        .slice()
        .sort(function(a, b) {
          var tb = Date.parse(b.updated_at || b.created_at || '') || 0;
          var ta = Date.parse(a.updated_at || a.created_at || '') || 0;
          return tb - ta;
        });
      if (activeHabits.length === 0) {
        var emptyH = document.createElement('div');
        emptyH.className = 'hero-card-item';
        emptyH.style.color = 'var(--text-muted)';
        emptyH.textContent = dict.heroNoHabitsYet;
        aboutList.appendChild(emptyH);
      } else {
        activeHabits.slice(0, 3).forEach(function(p) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'hero-card-item-btn';
          btn.textContent = '• ' + (p.l0_summary || p.title || p.id);
          btn.title = p.l0_summary || p.title || p.id;
          btn.addEventListener('click', function() { selectCapability('preferences', p); });
          aboutList.appendChild(btn);
        });
        if (activeHabits.length > 3) {
          var moreBtn = document.createElement('button');
          moreBtn.type = 'button';
          moreBtn.className = 'hero-more-btn';
          moreBtn.textContent = dict.heroViewAllMore.replace('{n}', String(activeHabits.length - 3));
          moreBtn.addEventListener('click', function() {
            switchView('profile');
          });
          aboutList.appendChild(moreBtn);
        }
      }
    }

    // 2. This Project: latest 3 lessons (rules, skills, memories)
    var projList = el('hero-this-project-list');
    if (projList) {
      projList.innerHTML = '';
      var lessons = [];
      ['memories', 'rules', 'skills'].forEach(function(k) {
        (snapshot[k] || []).forEach(function(it) {
          if (it && it.enabled !== false) {
            var ts = Date.parse(it.updated_at || it.created_at || '') || 0;
            lessons.push({ kind: k, item: it, ts: ts });
          }
        });
      });
      lessons.sort(function(a, b) { return b.ts - a.ts; });
      var topLessons = lessons.slice(0, 3);
      if (topLessons.length === 0) {
        var emptyL = document.createElement('div');
        emptyL.className = 'hero-card-item';
        emptyL.style.color = 'var(--text-muted)';
        emptyL.textContent = dict.heroNoLessonsYet;
        projList.appendChild(emptyL);
      } else {
        topLessons.forEach(function(entry) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'hero-card-item-btn';
          var txt = entry.item.title || entry.item.l0_summary || entry.item.id;
          btn.textContent = '• ' + txt;
          btn.title = txt;
          btn.addEventListener('click', function() { selectCapability(entry.kind, entry.item); });
          projList.appendChild(btn);
        });
      }
    }

    // 3. Recently Helped: compact inline 7-day badge in .hero-learned-hdr
    var helpedList = el('hero-recently-helped-list');
    if (helpedList) {
      var w7 = getWindow7dStats();
      helpedList.textContent = dict.heroHelpedSummary
        .replace('{pitfalls}', String(w7.pitfallsAvoided))
        .replace('{adopted}', String(w7.helped))
        .replace('{searches}', String(w7.searches));
    }
  }

  function renderWorkspacePulsePlaceholder(ruleCount, skillCount, toolCount, memoryCount, overall, grade, w7) {
    var dict = i18n[lang] || i18n.en;
    var activeTotal = ruleCount + skillCount + toolCount + memoryCount;
    var activeMems = (snapshot.memories || []).filter(function(m) { return m.enabled !== false; });
    var verifiedMems = activeMems.filter(function(m) {
      var st = (m.freshness && m.freshness.overall_status) || 'VERIFIED';
      return st === 'VERIFIED';
    }).length;

    if (el('inspector-placeholder-title')) el('inspector-placeholder-title').textContent = dict.noSelectionTitle;
    if (el('inspector-placeholder-sub')) el('inspector-placeholder-sub').textContent = dict.noSelectionSub;

    var pulseBody = el('inspector-pulse-cards');
    if (!pulseBody) return;

    var memRatioStr = verifiedMems + ' / ' + activeMems.length;

    pulseBody.innerHTML =
      '<div class="pulse-card" id="pulse-card">' +
        '<div class="pulse-card-hdr">' + esc(dict.pulseCardTitle) + '</div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.pulseActiveCaps) + '</span><strong class="mono-val">' + activeTotal + ' (' + ruleCount + 'R · ' + skillCount + 'S · ' + toolCount + 'T · ' + memoryCount + 'M)</strong></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.pulseVerifiedMems) + '</span><strong class="mono-val text-emerald">' + esc(memRatioStr) + '</strong></div>' +
      '</div>' +
      '<div class="pulse-card" id="shortcuts-card">' +
        '<div class="pulse-card-hdr">' + esc(dict.shortcutsCardTitle) + '</div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.shortcutPalette) + '</span><kbd class="kbd-shortcut">' + esc(modShortcutLabel) + '</kbd></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.shortcutNavRows) + '</span><kbd class="kbd-shortcut">Tab / ↑↓</kbd></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.shortcutInspect) + '</span><kbd class="kbd-shortcut">Enter / Space</kbd></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.shortcutClose) + '</span><kbd class="kbd-shortcut">Esc</kbd></div>' +
      '</div>' +
      '<div class="ast-footnote" id="inspector-ast-footnote">' + esc(dict.astFootnote) + '</div>';
  }

  function renderHealthDiagnosticsBanner(coreTokens) {
    var banner = el('health-diagnostics-banner');
    if (!banner) return;
    var dict = i18n[lang] || i18n.en;
    if (!healthDiagExpanded) {
      banner.style.display = 'none';
      return;
    }
    if (typeof coreTokens !== 'number') {
      coreTokens = computeActiveCoreTokens();
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
        '<button type="button" class="diag-chip diag-chip-danger" data-diag-action="filter-stale">' +
          ICONS.warn + '<span>' + esc(dict.diagStaleMsg.replace('{n}', String(staleMems.length))) + '</span>' +
          '<span class="diag-chip-cta">' + esc(dict.diagFilterCta) + '</span>' +
        '</button>'
      );
    }
    if (unprotHotspots.length > 0) {
      itemsHtml.push(
        '<button type="button" class="diag-chip diag-chip-warn" data-diag-action="goto-hotspots">' +
          ICONS.flame + '<span>' + esc(dict.diagHotspotMsg.replace('{n}', String(unprotHotspots.length))) + '</span>' +
          '<span class="diag-chip-cta">' + esc(dict.diagInspectCta) + '</span>' +
        '</button>'
      );
    }
    var maxCore = getMaxCoreRuleTokens();
    if (coreTokens >= Math.round(maxCore * 0.8)) {
      itemsHtml.push(
        '<button type="button" class="diag-chip diag-chip-warn" data-diag-action="filter-core">' +
          ICONS.box + '<span>' + esc(dict.diagCoreMsg.replace('{cur}', String(coreTokens)).replace('{max}', String(maxCore))) + '</span>' +
          '<span class="diag-chip-cta">' + esc(dict.diagSortCta) + '</span>' +
        '</button>'
      );
    }
    if (pendingCount > 0) {
      itemsHtml.push(
        '<button type="button" class="diag-chip diag-chip-info" data-diag-action="filter-pending">' +
          ICONS.bell + '<span>' + esc(dict.diagPendingMsg.replace('{n}', String(pendingCount))) + '</span>' +
          '<span class="diag-chip-cta">' + esc(dict.diagReviewCta) + '</span>' +
        '</button>'
      );
    }
    var scoreObj = snapshot.score || {};
    var scoreOverall = typeof scoreObj.overallScore === 'number' ? scoreObj.overallScore : 100;
    var scoreDeductions = Array.isArray(scoreObj.deductions) ? scoreObj.deductions : [];
    if (scoreOverall < 90 && scoreDeductions.length > 0) {
      scoreDeductions.forEach(function(dedText) {
        var low = String(dedText || '').toLowerCase();
        var coveredHotspot = unprotHotspots.length > 0 && low.indexOf('hotspot') !== -1;
        var coveredStale = staleMems.length > 0 && low.indexOf('stale') !== -1;
        if (!coveredHotspot && !coveredStale) {
          itemsHtml.push(
            '<div class="diag-chip diag-chip-warn">' +
              ICONS.warn + '<span>' + esc(dedText) + '</span>' +
            '</div>'
          );
        }
      });
      if (itemsHtml.length === 0) {
        itemsHtml.push(
          '<div class="diag-chip diag-chip-warn">' +
            ICONS.warn + '<span>' + esc(scoreDeductions[0]) + '</span>' +
          '</div>'
        );
      }
    }
    if (itemsHtml.length === 0) {
      itemsHtml.push(
        '<div class="diag-chip diag-chip-ok">' +
          ICONS.check + '<span>' + esc(dict.diagAllHealthy) + '</span>' +
        '</div>'
      );
    }

    banner.innerHTML =
      '<div class="diag-banner-hdr">' +
        '<strong style="display:inline-flex;align-items:center;gap:6px;">' + ICONS.pulse + esc(dict.diagTitle) + '</strong>' +
        '<button type="button" class="btn-action" id="btn-close-diag-banner" style="padding:1px 7px;font-size:var(--text-xs);">✕</button>' +
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

  function renderNeedsAttentionPanel() {
    var panel = el('needs-attention-panel');
    if (!panel) return;
    var dict = i18n[lang] || i18n.en;

    var attentionItems = [];
    var seenIds = {};
    var coreTokens = computeActiveCoreTokens();

    ['rules', 'skills', 'tools', 'memories'].forEach(function(k) {
      (snapshot[k] || []).forEach(function(it) {
        if (it.enabled === false) return;
        var memSt = k === 'memories' ? ((it.freshness && it.freshness.overall_status) || 'VERIFIED') : '';
        var reason = '';
        var tone = 'warn';
        if (memSt === 'STALE') {
          reason = dict.attentionReasonStale;
          tone = 'danger';
        } else if (memSt === 'ORPHANED') {
          reason = dict.attentionReasonOrphaned;
          tone = 'danger';
        } else if (it.review_status === 'pending') {
          reason = dict.attentionReasonPending;
          tone = 'warn';
        } else if (k === 'rules' && it.core && coreTokens > getMaxCoreRuleTokens()) {
          reason = dict.attentionReasonBudget + ' (' + coreTokens + '/' + getMaxCoreRuleTokens() + ')';
          tone = 'danger';
        }
        var key = k + ':' + it.id;
        if (reason && !seenIds[key]) {
          seenIds[key] = true;
          attentionItems.push({ kind: k, item: it, reason: reason, tone: tone });
        }
      });
    });
    // Also surface pending preferences & personal memories so Needs Attention stays 100% consistent with Pending (N)
    var seenPendingPref = {};
    var addPendingPref = function(p, defaultTier) {
      if (!p || !p.id || p.enabled === false || p.review_status !== 'pending') return;
      var t = p.tier || defaultTier;
      var pk = 'preferences:' + t + ':' + p.id;
      if (seenPendingPref[pk]) return;
      seenPendingPref[pk] = true;
      attentionItems.push({ kind: 'preferences', item: p, reason: dict.attentionReasonPending, tone: 'warn' });
    };
    (snapshot.preferences || []).forEach(function(p) { addPendingPref(p, 'LOCAL'); });
    if (snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences)) {
      snapshot.userProfile.preferences.forEach(function(p) { addPendingPref(p, 'GLOBAL'); });
    }
    if (snapshot.userProfile && Array.isArray(snapshot.userProfile.personalMemories)) {
      snapshot.userProfile.personalMemories.forEach(function(pm) {
        if (!pm || !pm.id || pm.enabled === false || pm.review_status !== 'pending') return;
        var mk = 'memories:' + pm.id;
        if (!seenIds[mk]) {
          seenIds[mk] = true;
          attentionItems.push({ kind: 'memories', item: pm, reason: dict.attentionReasonPending, tone: 'warn' });
        }
      });
    }

    if (attentionItems.length === 0) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }

    panel.style.display = 'flex';
    panel.innerHTML =
      '<div class="attention-hdr">' +
        '<div class="attention-hdr-left">' +
          '<span class="dot dot-warn"></span>' +
          '<strong>' + esc(dict.needsAttentionTitle) + ' (' + attentionItems.length + ')</strong>' +
          '<span class="attention-sub">' + esc(dict.needsAttentionSub) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="attention-list" id="needs-attention-list"></div>';

    var listEl = panel.querySelector('#needs-attention-list');
    if (!listEl) return;

    attentionItems.slice(0, 8).forEach(function(entry) {
      var chip = document.createElement('div');
      chip.className = 'attention-item row-interactive attention-tone-' + entry.tone;
      chip.tabIndex = 0;
      chip.setAttribute('role', 'button');
      var titleStr = entry.item.title || entry.item.name || entry.item.id;
      chip.innerHTML =
        '<span class="badge-kind ' + kindSemanticClass(entry.kind) + '">' + esc(formatKind(entry.kind)) + '</span>' +
        '<span class="attention-item-title" title="' + esc(titleStr) + '">' + esc(titleStr) + '</span>' +
        '<span class="attention-item-reason">' + esc(entry.reason) + '</span>';

      chip.addEventListener('click', function() {
        selectCapability(entry.kind, entry.item);
      });
      chip.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectCapability(entry.kind, entry.item);
        }
      });
      listEl.appendChild(chip);
    });
  }

  function getPendingBreakdown() {
    var localCount = 0;
    var globalPrefCount = 0;
    ['rules', 'skills', 'tools', 'memories'].forEach(function(k) {
      (snapshot[k] || []).forEach(function(it) {
        if (it && it.review_status === 'pending') localCount++;
      });
    });
    var seenPrefs = {};
    var collectPref = function(p, defaultTier) {
      if (!p || !p.id || p.review_status !== 'pending') return;
      var t = p.tier || defaultTier;
      var key = t + ':' + p.id;
      if (seenPrefs[key]) return;
      seenPrefs[key] = true;
      if (t === 'GLOBAL') globalPrefCount++;
      else localCount++;
    };
    (snapshot.preferences || []).forEach(function(p) { collectPref(p, 'LOCAL'); });
    if (snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences)) {
      snapshot.userProfile.preferences.forEach(function(p) { collectPref(p, 'GLOBAL'); });
    }
    if (snapshot.userProfile && Array.isArray(snapshot.userProfile.personalMemories)) {
      var seenLocalMemIds = {};
      (snapshot.memories || []).forEach(function(m) { if (m && m.id) seenLocalMemIds[m.id] = true; });
      snapshot.userProfile.personalMemories.forEach(function(pm) {
        if (pm && pm.id && pm.review_status === 'pending' && !seenLocalMemIds[pm.id]) {
          localCount++;
        }
      });
    }
    return {
      total: localCount + globalPrefCount,
      localCount: localCount,
      globalPrefCount: globalPrefCount
    };
  }

  function countPendingCapabilities() {
    return getPendingBreakdown().total;
  }

  function applyQuickFilter(kindVal, statusVal, sortByTokens) {
    var runFilter = function() {
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
    };
    if (inspectorMode === 'edit' && editorDirty && typeof confirmDiscardDraft === 'function') {
      confirmDiscardDraft(runFilter);
      return;
    }
    runFilter();
  }

  function formatMemoryStatusLabel(st) {
    var dict = i18n[lang] || i18n.en;
    if (st === 'VERIFIED') return dict.statusVerified;
    if (st === 'STALE') return dict.statusStale;
    if (st === 'ORPHANED') return dict.statusOrphaned || dict.attentionReasonOrphaned;
    if (st === 'OTHER_BRANCH') return dict.statusOtherBranch || dict.legendContested;
    return st;
  }

  function renderCapabilitiesTable() {
    renderNeedsAttentionPanel();
    var tbody = el('capabilities-table-body');
    var emptyState = el('caps-empty-state');
    var countLabel = el('caps-count-label');
    var dict = i18n[lang] || i18n.en;
    if (!tbody) return;
    tbody.innerHTML = '';

    var pendingCount = countPendingCapabilities();
    var allArchived = (snapshot.archived || []).slice();
    if (snapshot.userProfile && Array.isArray(snapshot.userProfile.archivedPreferences)) {
      snapshot.userProfile.archivedPreferences.forEach(function(ap) {
        if (!ap || !ap.id) return;
        var dup = allArchived.some(function(x) { return x && x.id === ap.id && (x.kind === 'preference' || x.kind === 'preferences'); });
        if (!dup) allArchived.push(Object.assign({ kind: 'preference', tier: ap.tier || 'GLOBAL' }, ap));
      });
    }
    var archivedCount = allArchived.length;
    var staleList = [];
    (snapshot.memories || []).forEach(function(m) {
      if (m.enabled !== false && m.freshness && m.freshness.overall_status === 'STALE') {
        staleList.push({ kind: 'memory', id: m.id });
      }
    });

    var pillPending = el('pill-status-pending');
    if (pillPending) {
      pillPending.style.display = (pendingCount > 0 || activeCapsStatus === 'pending') ? '' : 'none';
      pillPending.innerHTML = ICONS.bell + ' <span>' + esc(dict.statusPending + (pendingCount > 0 ? ' (' + pendingCount + ')' : '')) + '</span>';
    }
    var pillArchived = el('pill-status-archived');
    if (pillArchived) {
      pillArchived.style.display = (archivedCount > 0 || activeCapsStatus === 'archived') ? '' : 'none';
      pillArchived.innerHTML = ICONS.trash + ' <span>' + esc(dict.statusArchived + (archivedCount > 0 ? ' (' + archivedCount + ')' : '')) + '</span>';
    }
    var spWrap = el('caps-status-pills');
    if (spWrap) {
      spWrap.querySelectorAll('.filter-pill').forEach(function(pill) {
        var stAttr = pill.getAttribute('data-status') || 'all';
        if (stAttr === 'core' || stAttr === 'scoped') {
          pill.style.display = (activeCapsKind === 'all' || activeCapsKind === 'rules') ? '' : 'none';
        } else if (stAttr === 'verified' || stAttr === 'stale') {
          pill.style.display = (activeCapsKind === 'all' || activeCapsKind === 'memories') ? '' : 'none';
        }
      });
    }

    var btnApproveAll = el('btn-batch-approve-pending');
    if (btnApproveAll) {
      btnApproveAll.style.display = (!isExport && pendingCount > 0) ? 'inline-flex' : 'none';
      btnApproveAll.innerHTML = ICONS.check + ' <span>' + esc(dict.batchApprovePending + ' (' + pendingCount + ')') + '</span>';
    }
    var approveConfirmBar = el('batch-approve-confirm-bar');
    if (approveConfirmBar && (isExport || pendingCount === 0)) {
      approveConfirmBar.style.display = 'none';
      approveConfirmBar.innerHTML = '';
    }
    var btnPauseStale = el('btn-batch-pause-stale');
    if (btnPauseStale) {
      btnPauseStale.style.display = (!isExport && staleList.length > 0) ? 'inline-flex' : 'none';
      btnPauseStale.innerHTML = ICONS.pause + ' <span>' + esc(dict.batchPauseStale + ' (' + staleList.length + ')') + '</span>';
    }

    var q = (capsSearchQuery || '').toLowerCase().trim();
    var rows = [];

    if (activeCapsStatus === 'archived') {
      allArchived.forEach(function(arc) {
        var kPlural = arc.kind === 'memory' ? 'memories' : (arc.kind === 'preference' || arc.kind === 'preferences' ? 'preferences' : (arc.kind + 's'));
        if (activeCapsKind !== 'all' && activeCapsKind !== kPlural) return;
        if (q) {
          var sArc = [arc.id || '', arc.title || '', arc.l0_summary || ''].join(' ').toLowerCase();
          if (sArc.indexOf(q) === -1) return;
        }
        rows.push({ kind: kPlural, item: arc, isArchived: true });
      });
    } else {
      var kinds = ['rules', 'skills', 'tools', 'memories'];
      if (activeCapsStatus === 'pending' || activeCapsKind === 'preferences') {
        kinds.push('preferences');
      }
      kinds.forEach(function(k) {
        if (activeCapsKind !== 'all' && activeCapsKind !== k) return;
        var list = [];
        if (k === 'preferences') {
          var seenP = {};
          (snapshot.preferences || []).forEach(function(p) {
            if (!p || !p.id) return;
            var pt = p.tier || 'LOCAL';
            var pk = pt + ':' + p.id;
            if (!seenP[pk]) {
              seenP[pk] = true;
              list.push(Object.assign({ tier: pt }, p));
            }
          });
          if (snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences)) {
            snapshot.userProfile.preferences.forEach(function(p) {
              if (!p || !p.id) return;
              var pt = p.tier || 'GLOBAL';
              var pk = pt + ':' + p.id;
              if (!seenP[pk]) {
                seenP[pk] = true;
                list.push(Object.assign({ tier: pt }, p));
              }
            });
          }
        } else if (k === 'memories') {
          var seenM = {};
          (snapshot.memories || []).forEach(function(m) {
            if (!m || !m.id) return;
            seenM[m.id] = true;
            list.push(m);
          });
          if (snapshot.userProfile && Array.isArray(snapshot.userProfile.personalMemories)) {
            snapshot.userProfile.personalMemories.forEach(function(pm) {
              if (!pm || !pm.id || seenM[pm.id]) return;
              seenM[pm.id] = true;
              list.push(Object.assign({ tier: pm.tier || 'GLOBAL' }, pm));
            });
          }
        } else {
          list = snapshot[k] || [];
        }
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

    if (countLabel) countLabel.textContent = rows.length + ' ' + dict.itemsCountSuffix;

    if (rows.length === 0) {
      if (emptyState) {
        emptyState.style.display = 'block';
        var clearBtn = el('btn-caps-clear-filters');
        if (clearBtn) {
          var hasFilters = activeCapsKind !== 'all' || activeCapsStatus !== 'all' || Boolean((capsSearchQuery || '').trim());
          clearBtn.style.display = hasFilters ? 'inline-flex' : 'none';
          clearBtn.textContent = dict.clearFiltersBtn;
        }
      }
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
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('data-kind', k);
      tr.setAttribute('data-id', it.id);
      if (selectedCapability && selectedCapability.item && selectedCapability.item.id === it.id) {
        tr.classList.add('row-selected');
      }

      var kindBadge = '<span class="badge-kind ' + kindSemanticClass(k) + '">' + esc(formatKind(k)) + '</span>';
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
        var tokBadge = it.tokens ? ' <span style="color:var(--text-muted);">· ' + it.tokens + 't</span>' : '';
        statusCol = it.core
          ? '<span class="badge-status"><span class="dot dot-ok"></span> ' + esc(dict.tierCore) + tokBadge + '</span>'
          : '<span class="badge-status badge-scoped" title="' + esc(globVal) + '">' + esc(dict.tierScoped) + ' <span class="scoped-glob-text">(' + esc(globVal) + ')</span></span>';
      } else if (k === 'memories') {
        var st = (it.freshness && it.freshness.overall_status) || 'VERIFIED';
        var dotCls = st === 'VERIFIED' ? 'dot-ok' : (st === 'STALE' || st === 'ORPHANED' ? 'dot-danger' : 'dot-warn');
        statusCol = '<span class="badge-status"><span class="dot ' + dotCls + '"></span> ' + esc(formatMemoryStatusLabel(st)) + '</span>';
      } else if (k === 'tools') {
        statusCol = '<span class="badge-status">' + esc(dict.tierSandbox) + ' (' + esc(it.runtime || 'node') + ')</span>';
      } else if (k === 'preferences') {
        var prefModeLbl = it.always_on !== false ? dict.profileModeAlwaysOn : dict.profileModeOnDemand;
        var prefTierLbl = it.tier === 'LOCAL' ? dict.tierLocal : dict.tierGlobal;
        statusCol = '<span class="badge-status">' + esc(prefModeLbl) + ' · ' + esc(prefTierLbl) + '</span>';
      } else {
        statusCol = '<span class="badge-status">' + esc(dict.tierSkillSop) + '</span>';
      }

      var hits = it.hit_count || 0;
      var attrHtml = '';
      if (isArchived) {
        attrHtml = '<span class="badge-status">' + ICONS.trash + ' ' + esc(dict.badgeArchived) + '</span>';
      } else if (!isEnabled) {
        attrHtml = '<span class="badge-status" style="color:var(--text-muted);">' + ICONS.pause + ' ' + esc(dict.badgePaused) + '</span>';
      } else if (isPending) {
        attrHtml = '<span class="badge-status" style="border-color:var(--status-warn-border);color:var(--status-warn);">' + ICONS.bell + ' ' + esc(dict.badgePending) + '</span>';
      } else {
        var hitsText = hits + ' ' + esc(hits === 1 ? dict.hitSingularSuffix : dict.hitsSuffix);
        var helpedTag = it.attribution === 'helped'
          ? ' <span class="helped-pill">· ' + esc(dict.helpedBadgeShort) + '</span>'
          : '';
        attrHtml = '<span class="badge-status badge-attr"><span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;"><span class="dot dot-ok"></span>' + esc(dict.badgeEnabled) + ' · ' + hitsText + '</span>' + helpedTag + '</span>';
      }

      var actionCol = '';
      if (isExport) {
        actionCol = '';
      } else if (isArchived) {
        actionCol = '<div class="row-actions-wrap">' +
          '<button type="button" class="btn-action row-restore-btn" data-kind="' + k + '" data-id="' + esc(it.id) + '">' + esc(dict.restore) + '</button>' +
        '</div>';
      } else {
        actionCol = '<div class="row-actions-wrap">' +
          (isPending ? '<button type="button" class="btn-action row-approve-btn" style="border-color:var(--status-ok-border);color:var(--status-ok);" title="' + esc(dict.approve) + '">' + esc(dict.approve) + '</button>' : '') +
          '<button type="button" class="btn-action row-toggle-btn" title="' + esc(isEnabled ? dict.pauseItem : dict.resumeItem) + '">' + (isEnabled ? (ICONS.pause + '<span>' + esc(dict.pauseItem) + '</span>') : esc(dict.resumeItem)) + '</button>' +
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

      tr.addEventListener('keydown', function(e) {
        if (e.target !== tr && e.target.closest('button')) {
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectCapability(k, it);
        }
      });

      var approveBtn = tr.querySelector('.row-approve-btn');
      if (approveBtn) {
        approveBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(approveBtn, curDict.savingLabel, function() {
            return callKernelAction('approve-item', { kind: singularKind(k), id: it.id, tier: it.tier }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok) {
                if (res.snapshot) snapshot = res.snapshot;
                else it.review_status = 'approved';
                rerenderAllViews();
                showToast('success', (lang === 'zh' ? '已确认 ' : 'Approved ') + it.id);
              } else if (!res.offlineExport) {
                showActionError(res, d.errApproveFailed);
              }
            });
          });
        });
      }

      var toggleBtn = tr.querySelector('.row-toggle-btn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var nextEnabled = it.enabled === false;
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(toggleBtn, curDict.savingLabel, function() {
            return callKernelAction('toggle-enabled', { kind: singularKind(k), id: it.id, enabled: nextEnabled, tier: it.tier }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok) {
                if (res.snapshot) snapshot = res.snapshot;
                else it.enabled = nextEnabled;
                rerenderAllViews();
                var toggleMsg = (nextEnabled ? d.resumedToast : d.pausedToast).replace('{id}', it.id);
                if (!nextEnabled) {
                  showToast('success', toggleMsg, 8000, {
                    label: d.undoActionLabel,
                    run: function() {
                      callKernelAction('toggle-enabled', { kind: singularKind(k), id: it.id, enabled: true, tier: it.tier }).then(function(r2) {
                        if (r2 && r2.ok) {
                          if (r2.snapshot) snapshot = r2.snapshot;
                          rerenderAllViews();
                          showToast('success', (i18n[lang] || i18n.en).resumedToast.replace('{id}', it.id));
                        }
                      });
                    }
                  });
                } else {
                  showToast('success', toggleMsg);
                }
              } else if (!res.offlineExport) {
                showActionError(res, d.errToggleFailed, { kind: singularKind(k), id: it.id, tier: it.tier, item: it });
              }
            });
          });
        });
      }

      var restoreBtn = tr.querySelector('.row-restore-btn');
      if (restoreBtn) {
        restoreBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(restoreBtn, curDict.savingLabel, function() {
            return callKernelAction('restore-item', { kind: singularKind(k), id: it.id, tier: it.tier }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok) {
                if (res.snapshot) snapshot = res.snapshot;
                rerenderAllViews();
                showToast('success', d.restoredToast.replace('{id}', it.id));
              } else if (!res.offlineExport) {
                showActionError(res, d.errRestoreFailed);
              }
            });
          });
        });
      }

      tbody.appendChild(tr);
    });
  }

  function renderCardTopology() {
    var svg = el('topology-svg');
    if (!svg) return;
    svg.innerHTML = '';
    var ns = 'http://www.w3.org/2000/svg';

    var rules = (snapshot.rules || []).filter(function(r) { return r.enabled !== false; });
    var skills = (snapshot.skills || []).filter(function(s) { return s.enabled !== false; });
    var tools = (snapshot.tools || []).filter(function(t) { return t.enabled !== false; });
    var memories = (snapshot.memories || []).filter(function(m) { return m.enabled !== false; });

    var dict = i18n[lang] || i18n.en;
    var leftNodes = [];
    rules.forEach(function(r) {
      leftNodes.push({
        id: 'rule:' + r.id,
        raw: r,
        kind: 'rules',
        label: r.title || r.id,
        sub: r.core ? (r.id + ' · ' + dict.appliesEverywhere) : r.id,
        core: r.core
      });
    });
    skills.forEach(function(s) {
      leftNodes.push({ id: 'skill:' + s.id, raw: s, kind: 'skills', label: s.name || s.id, sub: s.id });
    });
    tools.forEach(function(t) {
      leftNodes.push({ id: 'tool:' + t.id, raw: t, kind: 'tools', label: t.title || t.id, sub: t.id });
    });

    var midNodes = [];
    var rightMap = {};
    var rightFileSet = {};
    var rightNodes = [];

    memories.forEach(function(m) {
      var rawStatus = (m.freshness && m.freshness.overall_status) || 'VERIFIED';
      var mNode = {
        id: 'mem:' + m.id,
        raw: m,
        kind: 'memories',
        label: m.title || m.id,
        sub: formatMemoryStatusLabel(rawStatus),
        status: rawStatus,
        symbolNodeIds: []
      };
      midNodes.push(mNode);

      function addMemSymId(nodeId) {
        if (mNode.symbolNodeIds.indexOf(nodeId) === -1) {
          mNode.symbolNodeIds.push(nodeId);
        }
      }

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
        var existingSymNode = rightMap[canonicalSym] || rightMap[normSym];
        if (existingSymNode) {
          addMemSymId(existingSymNode.id);
        } else {
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
          addMemSymId(nodeEntry.id);
        }
      });
      Object.keys(fps).forEach(function(k) {
        var fp = fps[k] || {};
        var fpath = String(fp.file_path || fp.file || '').replace(/\\\\/g, '/');
        var normKey = String(k || '').replace(/\\\\/g, '/');
        if (!fpath) return;
        var existingFpNode = rightMap[normKey] || rightMap[fpath] || (rightFileSet[fpath] && rightMap[rightFileSet[fpath]]);
        if (existingFpNode) {
          addMemSymId(existingFpNode.id);
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
        addMemSymId(rightMap[fpath].id);
      });
    });

    if (leftNodes.length === 0 && midNodes.length === 0 && rightNodes.length === 0) {
      svg.setAttribute('width', '980');
      svg.setAttribute('height', '220');
      svg.setAttribute('viewBox', '0 0 980 220');
      var emptyTxt = document.createElementNS(ns, 'text');
      emptyTxt.setAttribute('x', '490');
      emptyTxt.setAttribute('y', '110');
      emptyTxt.setAttribute('text-anchor', 'middle');
      emptyTxt.setAttribute('fill', 'var(--text-muted)');
      emptyTxt.setAttribute('font-size', '13');
      emptyTxt.textContent = lang === 'zh' ? '暂无可展示的活跃规则、记忆或 AST 拓扑节点。' : 'No active Rules, Memories, or AST topology nodes to display yet.';
      svg.appendChild(emptyTxt);
      return;
    }

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
        if (ln.kind === 'rules' && ln.raw.scope_glob && ln.raw.scope_glob !== '*' && ln.raw.scope_glob !== '**/*') {
          var fps = mn.raw.ast_fingerprints || {};
          Object.keys(fps).forEach(function(k) {
            var f = (fps[k] && (fps[k].file_path || fps[k].file)) || '';
            if (f && matchScopeGlobUi(ln.raw.scope_glob, f)) matched = true;
          });
          if (!matched) {
            (mn.raw.target_symbols || []).forEach(function(sym) {
              var symFile = String(sym || '').split('#')[0];
              if (symFile && matchScopeGlobUi(ln.raw.scope_glob, symFile)) matched = true;
            });
          }
        }
        if (matched) {
          addEdge(ln.id, mn.id, ln, mn);
        }
      });
    });

    midNodes.forEach(function(mn) {
      rightNodes.forEach(function(rn) {
        if (mn.symbolNodeIds && mn.symbolNodeIds.indexOf(rn.id) !== -1) {
          addEdge(mn.id, rn.id, mn, rn);
        }
      });
    });

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
      path.setAttribute('stroke', 'var(--border-active)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('class', 'topo-edge');
      path.setAttribute('data-from', e.fromId);
      path.setAttribute('data-to', e.toId);
      e.el = path;
      edgeGroup.appendChild(path);
    });
    svg.appendChild(edgeGroup);

    var allNodes = [].concat(leftNodes, midNodes, rightNodes);
    var nodeGroup = document.createElementNS(ns, 'g');
    nodeGroup.setAttribute('id', 'topo-node-layer');

    allNodes.forEach(function(n) {
      var g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'topo-node');
      g.setAttribute('data-id', n.id);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
      n.el = g;

      var svgTitle = document.createElementNS(ns, 'title');
      svgTitle.textContent = n.label + (n.sub ? ' (' + n.sub + ')' : '');
      g.appendChild(svgTitle);

      var rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('class', 'topo-card-bg');
      rect.setAttribute('width', String(cardW));
      rect.setAttribute('height', String(cardH));
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', 'var(--bg-surface)');
      rect.setAttribute('stroke', 'var(--border-subtle)');
      rect.setAttribute('stroke-width', '1');
      g.appendChild(rect);

      if (n.kind) {
        var accent = document.createElementNS(ns, 'rect');
        accent.setAttribute('x', '0');
        accent.setAttribute('y', '6');
        accent.setAttribute('width', '3');
        accent.setAttribute('height', String(cardH - 12));
        accent.setAttribute('rx', '1.5');
        accent.setAttribute('fill', kindSemanticColor(n.kind));
        g.appendChild(accent);
      }

      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', '14');
      dot.setAttribute('cy', '23');
      dot.setAttribute('r', '3.5');
      var dotColor = n.kind ? kindSemanticColor(n.kind) : 'var(--status-ok)';
      if (n.status === 'STALE' || n.status === 'ORPHANED') dotColor = 'var(--status-danger)';
      else if (n.status === 'OTHER_BRANCH') dotColor = 'var(--status-warn)';
      else if (n.kind === 'memories') dotColor = 'var(--status-ok)';
      dot.setAttribute('fill', dotColor);
      g.appendChild(dot);

      var textClipGroup = document.createElementNS(ns, 'g');
      textClipGroup.setAttribute('clip-path', 'url(#topo-card-clip)');

      var title = document.createElementNS(ns, 'text');
      title.setAttribute('x', '26');
      title.setAttribute('y', '19');
      title.setAttribute('fill', 'var(--text-primary)');
      title.setAttribute('font-weight', '500');
      title.setAttribute('class', 'topo-node-title');
      title.textContent = truncateVisual(n.label, 24);
      textClipGroup.appendChild(title);

      var sub = document.createElementNS(ns, 'text');
      sub.setAttribute('x', '26');
      sub.setAttribute('y', '33');
      sub.setAttribute('fill', 'var(--text-muted)');
      sub.setAttribute('class', 'topo-node-sub');
      sub.textContent = truncateVisualTail(n.sub, 28);
      textClipGroup.appendChild(sub);

      g.appendChild(textClipGroup);

      function activateNode() {
        var dict = i18n[lang] || i18n.en;
        if (n.raw && n.kind) {
          selectCapability(n.kind, n.raw);
        } else if (n.fileOnly || n.fullSymbol) {
          var targetPath = n.fileOnly || n.fullSymbol.split('#')[0];
          var targetLine = n.startLine || 1;
          var locRef = targetPath + (targetLine > 1 ? ':' + targetLine : '');
          callKernelAction('open-editor', { filePath: targetPath, line: targetLine }).then(function(res) {
            handleOpenEditorResult(res, locRef);
          });
        }
      }

      g.addEventListener('mouseenter', function() { applyFocusDimming(n.id); });
      g.addEventListener('mouseleave', function() { resetFocusDimming(); });
      g.addEventListener('focus', function() { applyFocusDimming(n.id); });
      g.addEventListener('blur', function() { resetFocusDimming(); });
      g.addEventListener('click', activateNode);
      g.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateNode();
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
        var bgRect = n.el.querySelector('.topo-card-bg') || n.el.querySelector('rect');
        if (activeSet.has(n.id)) {
          n.el.style.opacity = '1.0';
          bgRect.setAttribute('stroke', n.id === targetId ? 'var(--border-focus)' : 'var(--border-active)');
          bgRect.setAttribute('stroke-width', n.id === targetId ? '1.5' : '1');
        } else {
          n.el.style.opacity = '0.2';
          bgRect.setAttribute('stroke', 'var(--border-subtle)');
          bgRect.setAttribute('stroke-width', '1');
        }
      });

      edges.forEach(function(e) {
        if (activeSet.has(e.fromId) && activeSet.has(e.toId)) {
          e.el.style.opacity = '1.0';
          e.el.setAttribute('stroke', 'var(--status-ok)');
          e.el.setAttribute('stroke-width', '2');
        } else {
          e.el.style.opacity = '0.08';
          e.el.setAttribute('stroke', 'var(--border-subtle)');
          e.el.setAttribute('stroke-width', '1');
        }
      });
    }

    function resetFocusDimming() {
      allNodes.forEach(function(n) {
        var bgRect = n.el.querySelector('.topo-card-bg') || n.el.querySelector('rect');
        n.el.style.opacity = '1.0';
        bgRect.setAttribute('stroke', 'var(--border-subtle)');
        bgRect.setAttribute('stroke-width', '1');
      });
      edges.forEach(function(e) {
        e.el.style.opacity = '1.0';
        e.el.setAttribute('stroke', 'var(--border-active)');
        e.el.setAttribute('stroke-width', '1.5');
      });
    }
  }

  function renderHotspotsTable() {
    var tbody = el('hotspots-table-body');
    var kpiBadge = el('hotspots-summary-kpi');
    var emptyState = el('hotspots-empty-state');
    var dict = i18n[lang] || i18n.en;
    if (!tbody) return;
    tbody.innerHTML = '';

    var hotspots = (snapshot.score && snapshot.score.gitHotspots) || [];
    var total = hotspots.length;
    var unprot = (snapshot.score && snapshot.score.unprotectedHotspots) || 0;
    var prot = Math.max(0, total - unprot);

    if (kpiBadge) {
      kpiBadge.textContent = prot + ' / ' + total + ' ' + dict.hotspotsKpiSuffix;
    }

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

    var activeScopedRules = (snapshot.rules || []).filter(function(r) {
      return r.enabled !== false && r.scope_glob && r.scope_glob !== '*' && r.scope_glob !== '**/*';
    });
    function getBoundRulesForHotspot(filePath) {
      return activeScopedRules.filter(function(r) {
        return matchScopeGlobUi(r.scope_glob, filePath);
      });
    }

    var hq = (hotspotsSearchQuery || '').toLowerCase().trim();
    var filteredHotspots = hotspots.filter(function(h) {
      if (!hq) return true;
      var normH = h.filePath.replace(/\\\\/g, '/');
      var bound = fileToMem[normH] || [];
      var boundR = getBoundRulesForHotspot(normH);
      var memIds = bound.map(function(b) { return b.id; }).join(' ').toLowerCase();
      var ruleIds = boundR.map(function(r) { return r.id; }).join(' ').toLowerCase();
      return h.filePath.toLowerCase().indexOf(hq) !== -1 || memIds.indexOf(hq) !== -1 || ruleIds.indexOf(hq) !== -1;
    });

    if (filteredHotspots.length === 0) {
      if (emptyState) {
        emptyState.textContent = (hotspots.length > 0 && hq)
          ? (lang === 'zh' ? '没有匹配搜索条件的热点文件。' : 'No hotspots match the current filter.')
          : dict.hotspotsEmptyState;
        emptyState.style.display = 'block';
      }
      return;
    }
    if (emptyState) emptyState.style.display = 'none';

    filteredHotspots.forEach(function(h) {
      var tr = document.createElement('tr');
      tr.className = 'row-interactive';
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('data-path', h.filePath);

      var normHPath = h.filePath.replace(/\\\\/g, '/');
      var boundMems = fileToMem[normHPath] || [];
      var boundRules = getBoundRulesForHotspot(normHPath);
      var statusHtml = h.unprotected
        ? '<span class="badge-status"><span class="dot dot-danger"></span> ' + esc(dict.hotspotUnprotected) + '</span>'
        : '<span class="badge-status"><span class="dot dot-ok"></span> ' + esc(dict.hotspotProtected) + '</span>';

      var memChipsWrap = document.createElement('div');
      memChipsWrap.className = 'mem-chips-wrap';
      if (boundMems.length > 0 || boundRules.length > 0) {
        boundMems.forEach(function(bm) {
          var chip = document.createElement('span');
          chip.className = 'chip-memory';
          chip.textContent = '#' + bm.id;
          chip.setAttribute('data-mem-id', bm.id);
          chip.addEventListener('click', function(e) {
            e.stopPropagation();
            selectCapability('memories', bm);
          });
          memChipsWrap.appendChild(chip);
        });
        boundRules.forEach(function(br) {
          var rChip = document.createElement('span');
          rChip.className = 'chip-rule';
          rChip.textContent = '@' + br.id;
          rChip.setAttribute('data-rule-id', br.id);
          rChip.title = (br.scope_glob || '') + ' — ' + (br.l0_summary || '');
          rChip.addEventListener('click', function(e) {
            e.stopPropagation();
            selectCapability('rules', br);
          });
          memChipsWrap.appendChild(rChip);
        });
      } else {
        memChipsWrap.innerHTML = '<span style="color:var(--text-muted); font-size:var(--text-xs);">' + esc(dict.noneBound) + '</span>';
      }

      var tdPath = document.createElement('td');
      tdPath.innerHTML = '<code style="color:var(--text-primary);">' + esc(h.filePath) + '</code>';

      var tdFrag = document.createElement('td');
      tdFrag.innerHTML = '<strong style="color:var(--text-primary);">' + h.fragilityScore + '</strong>';

      var tdCommits = document.createElement('td');
      tdCommits.innerHTML = h.fixRevertCommits + ' <span style="color:var(--text-muted);">(' + h.commits + ' ' + esc(dict.commitsTotalSuffix) + ')</span>';

      var tdMems = document.createElement('td');
      tdMems.appendChild(memChipsWrap);

      var tdStatus = document.createElement('td');
      tdStatus.innerHTML = statusHtml;

      var tdAction = document.createElement('td');
      tdAction.style.textAlign = 'right';
      if (!isExport) {
        var hsActWrap = document.createElement('div');
        hsActWrap.className = 'row-actions-wrap';
        var addMemBtn = document.createElement('button');
        addMemBtn.type = 'button';
        addMemBtn.className = 'btn-action';
        if (h.unprotected) {
          addMemBtn.style.color = 'var(--status-ok)';
          addMemBtn.style.borderColor = 'var(--status-ok-border)';
        }
        addMemBtn.textContent = dict.hotspotAddMemory;
        addMemBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openHotspotMemoryDrawer(h.filePath);
        });
        hsActWrap.appendChild(addMemBtn);

        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn-action';
        openBtn.textContent = dict.openShort;
        openBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
            handleOpenEditorResult(res, h.filePath);
          });
        });
        hsActWrap.appendChild(openBtn);
        tdAction.appendChild(hsActWrap);
      }

      tr.appendChild(tdPath);
      tr.appendChild(tdFrag);
      tr.appendChild(tdCommits);
      tr.appendChild(tdMems);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAction);

      function selectHotspotTarget() {
        if (boundMems.length > 0) {
          selectCapability('memories', boundMems[0]);
        } else if (boundRules.length > 0) {
          selectCapability('rules', boundRules[0]);
        }
      }

      tr.addEventListener('click', selectHotspotTarget);
      tr.addEventListener('keydown', function(e) {
        if (e.target !== tr && e.target.closest('button')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectHotspotTarget();
        }
      });

      tbody.appendChild(tr);
    });
  }

  function openHotspotMemoryDrawer(filePath) {
    var drawer = el('hotspot-mem-drawer');
    if (!drawer || isExport) return;
    var dict = i18n[lang] || i18n.en;
    drawer.innerHTML =
      '<div class="profile-card-hdr">' +
        '<span>' + esc(dict.hotspotMemDrawerTitle.replace('{path}', filePath)) + '</span>' +
        '<button type="button" class="btn-action" id="btn-hs-mem-close" style="padding:1px 7px;font-size:var(--text-xs);">✕</button>' +
      '</div>' +
      '<div class="editor-fields-stack">' +
        '<div class="editor-field-group">' +
          '<label class="editor-field-label" for="hs-mem-title">' + esc(dict.fieldTitleLabel) + '</label>' +
          '<input type="text" id="hs-mem-title" class="editor-input" placeholder="' + esc(dict.hotspotMemTitlePlaceholder) + '" />' +
        '</div>' +
        '<div class="editor-field-group">' +
          '<label class="editor-field-label" for="hs-mem-symptom">' + esc(dict.symptomLabel) + '</label>' +
          '<textarea id="hs-mem-symptom" class="editor-textarea-sm" placeholder="' + esc(dict.hotspotMemSymptomPlaceholder) + '"></textarea>' +
        '</div>' +
        '<div class="editor-field-group">' +
          '<label class="editor-field-label" for="hs-mem-cause">' + esc(dict.rootCauseLabel) + '</label>' +
          '<textarea id="hs-mem-cause" class="editor-textarea-sm" placeholder="' + esc(dict.hotspotMemRootCausePlaceholder) + '"></textarea>' +
        '</div>' +
        '<div class="editor-field-group">' +
          '<label class="editor-field-label" for="hs-mem-solution">' + esc(dict.solutionLabel) + '</label>' +
          '<textarea id="hs-mem-solution" class="editor-textarea-sm" placeholder="' + esc(dict.hotspotMemSolutionPlaceholder) + '"></textarea>' +
        '</div>' +
      '</div>' +
      '<div class="profile-header-actions">' +
        '<button type="button" class="btn-action btn-primary" id="btn-hs-mem-save">' + esc(dict.saveChanges) + '</button>' +
        '<button type="button" class="btn-action" id="btn-hs-mem-cancel">' + esc(dict.cancel) + '</button>' +
      '</div>';
    drawer.classList.add('open');
    if (typeof drawer.scrollIntoView === 'function') {
      try { drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
    }
    var closeDrawer = function() {
      drawer.classList.remove('open');
      drawer.innerHTML = '';
    };
    var btnX = drawer.querySelector('#btn-hs-mem-close');
    var btnCancel = drawer.querySelector('#btn-hs-mem-cancel');
    if (btnX) btnX.addEventListener('click', closeDrawer);
    if (btnCancel) btnCancel.addEventListener('click', closeDrawer);

    var btnSave = drawer.querySelector('#btn-hs-mem-save');
    if (btnSave) {
      btnSave.addEventListener('click', function() {
        var curDict = i18n[lang] || i18n.en;
        var titleVal = (drawer.querySelector('#hs-mem-title') || {}).value || '';
        var symptomVal = (drawer.querySelector('#hs-mem-symptom') || {}).value || '';
        var causeVal = (drawer.querySelector('#hs-mem-cause') || {}).value || '';
        var solutionVal = (drawer.querySelector('#hs-mem-solution') || {}).value || '';
        runWithButtonLock(btnSave, curDict.savingLabel, function() {
          return callKernelAction('create-memory', {
            filePath: filePath,
            title: titleVal.trim(),
            symptom: symptomVal.trim(),
            root_cause: causeVal.trim(),
            solution: solutionVal.trim()
          }).then(function(res) {
            if (res && res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              closeDrawer();
              rerenderAllViews();
              showToast('success', curDict.hotspotMemCreatedToast.replace('{path}', filePath));
            } else if (!res || !res.offlineExport) {
              showActionError(res, curDict.hotspotMemFailedToast);
            }
          });
        });
      });
    }
  }

  function findCapabilityForEvent(kindRaw, targetId) {
    if (!targetId) return null;
    var sKind = singularKind(kindRaw || '');
    var kPlural = sKind === 'memory' ? 'memories' : (sKind + 's');
    var searchList = function(k) {
      var list = (snapshot[k] || []).slice();
      if (k === 'preferences' && snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences)) {
        list = list.concat(snapshot.userProfile.preferences);
      } else if (k === 'memories' && snapshot.userProfile && Array.isArray(snapshot.userProfile.personalMemories)) {
        list = list.concat(snapshot.userProfile.personalMemories);
      }
      var hit = list.find(function(x) { return x && x.id === targetId; });
      return hit ? { kind: k, item: hit } : null;
    };
    var direct = searchList(kPlural);
    if (direct) return direct;
    var allKinds = ['rules', 'skills', 'tools', 'memories', 'preferences'];
    for (var i = 0; i < allKinds.length; i++) {
      var found = searchList(allKinds[i]);
      if (found) return found;
    }
    return null;
  }

  function renderGatekeeperStream() {
    var boxEl = el('gatekeeper-timeline');
    if (!boxEl) return;
    boxEl.innerHTML = '';
    var dict = i18n[lang] || i18n.en;

    var events = snapshot.gatekeeperEvents || [];
    if (events.length === 0) {
      var cleanBox = document.createElement('div');
      cleanBox.className = 'gk-event-card';
      cleanBox.innerHTML = '<div style="color:var(--status-ok); font-weight:600;"><span class="dot dot-ok"></span> ' + esc(dict.gkPassAll) + '</div>' +
        '<div style="color:var(--text-muted); font-size:var(--text-sm); margin-top:4px;">' + esc(dict.gkSub) + '</div>';
      boxEl.appendChild(cleanBox);
      return;
    }

    var filteredEvents = events.filter(function(ev) {
      if (activeGkFilter === 'pass' && !ev.passed) return false;
      if (activeGkFilter === 'fail' && ev.passed) return false;
      return true;
    });

    if (filteredEvents.length === 0) {
      var emptyCard = document.createElement('div');
      emptyCard.className = 'gk-event-card';
      var emptyMsg = activeGkFilter === 'fail'
        ? (lang === 'zh' ? '当前记录中无被拒绝的提案。' : 'No rejected proposals in Gatekeeper history.')
        : (lang === 'zh' ? '当前记录中无已通过的提案。' : 'No passed proposals in Gatekeeper history.');
      emptyCard.innerHTML = '<div style="color:var(--text-muted); font-size:var(--text-sm);">' + esc(emptyMsg) + '</div>';
      boxEl.appendChild(emptyCard);
      return;
    }

    filteredEvents.forEach(function(ev) {
      var card = document.createElement('div');
      var linkedCap = findCapabilityForEvent(ev.kind, ev.target_id);
      card.className = 'gk-event-card' + (linkedCap ? ' clickable' : '');
      if (linkedCap) {
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
      }

      var dotCls = ev.passed ? 'dot-ok' : 'dot-danger';
      var timeStr = esc((ev.timestamp || '').replace('T', ' ').slice(0, 19));

      var topHtml = '<div class="gk-event-hdr">' +
        '<div style="display:flex; align-items:center; gap:8px; min-width:0; overflow:hidden; flex:1;">' +
        '<span class="badge-kind ' + kindSemanticClass(ev.kind) + '" style="flex-shrink:0;">' + esc(formatKind(ev.kind)) + '</span>' +
        '<strong style="color:var(--text-primary); font-family:var(--font-mono); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + esc(ev.target_id || '') + '">' + esc(ev.target_id || '') + '</strong>' +
        (ev.stage_failed ? '<span style="color:var(--status-danger); font-size:var(--text-xs); flex-shrink:0;">[' + esc(ev.stage_failed) + ']</span>' : '') +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">' +
        '<span class="badge-status"><span class="dot ' + dotCls + '"></span> ' + esc(ev.passed ? dict.gkBadgePass : dict.gkBadgeReject) + '</span>' +
        '<span style="color:var(--text-muted); font-size:var(--text-xs);">' + timeStr + '</span>' +
        '</div>' +
        '</div>';

      var diagHtml = '';
      if (ev.diagnostics) {
        diagHtml = '<pre class="gk-diag-pre">' + esc(ev.diagnostics) + '</pre>';
      }

      card.innerHTML = topHtml + diagHtml;
      if (linkedCap) {
        card.addEventListener('click', function() {
          selectCapability(linkedCap.kind, linkedCap.item);
        });
        card.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectCapability(linkedCap.kind, linkedCap.item);
          }
        });
      }
      boxEl.appendChild(card);
    });
  }

  function showInspectorBgUpdateBanner() {
    var existing = el('editor-bg-update-banner');
    var dict = i18n[lang] || i18n.en;
    if (existing) {
      existing.style.display = 'flex';
      return;
    }
    var detail = el('inspector-detail');
    var anchor = el('inspector-editor-fields') || el('inspector-editor-input');
    if (!detail || !anchor) return;
    var bar = document.createElement('div');
    bar.id = 'editor-bg-update-banner';
    bar.className = 'inline-info-bar';
    bar.innerHTML =
      '<span>' + esc(dict.editorBgUpdateMsg) + '</span>' +
      '<div class="inline-confirm-actions">' +
        '<button type="button" class="btn-action" id="btn-bg-keep-edits">' + esc(dict.editorKeepMyEdits) + '</button>' +
        '<button type="button" class="btn-action btn-primary" id="btn-bg-load-latest">' + esc(dict.editorLoadLatest) + '</button>' +
      '</div>';
    anchor.parentNode.insertBefore(bar, anchor);
    bar.querySelector('#btn-bg-keep-edits').addEventListener('click', function() {
      editorPendingBgUpdate = false;
      bar.style.display = 'none';
    });
    bar.querySelector('#btn-bg-load-latest').addEventListener('click', function() {
      editorDirty = false;
      editorPendingBgUpdate = false;
      renderInspector();
    });
  }

  function confirmDiscardDraft(discardCb) {
    if (!(inspectorMode === 'edit' && editorDirty)) {
      if (typeof discardCb === 'function') discardCb();
      return;
    }
    var dict = i18n[lang] || i18n.en;
    var bar = el('editor-discard-confirm-bar');
    if (!bar) {
      var detail = el('inspector-detail');
      var anchor = el('inspector-editor-fields') || el('inspector-editor-input');
      if (!detail || !anchor) {
        editorDirty = false;
        editorPendingBgUpdate = false;
        if (typeof discardCb === 'function') discardCb();
        return;
      }
      bar = document.createElement('div');
      bar.id = 'editor-discard-confirm-bar';
      bar.className = 'inline-confirm-bar';
      anchor.parentNode.insertBefore(bar, anchor);
    }
    bar.style.display = 'flex';
    bar.innerHTML =
      '<span>' + esc(dict.editorDiscardConfirmMsg) + '</span>' +
      '<div class="inline-confirm-actions">' +
        '<button type="button" class="btn-action" id="btn-draft-keep">' + esc(dict.editorKeepEditing) + '</button>' +
        '<button type="button" class="btn-action btn-danger" id="btn-draft-discard">' + esc(dict.editorDiscardBtn) + '</button>' +
      '</div>';
    bar.querySelector('#btn-draft-keep').addEventListener('click', function() {
      bar.style.display = 'none';
      var ti = el('inspector-editor-input') || el('editor-field-symptom') || el('editor-field-l1') || el('editor-field-title');
      if (ti && typeof ti.focus === 'function') ti.focus();
    });
    bar.querySelector('#btn-draft-discard').addEventListener('click', function() {
      editorDirty = false;
      editorOriginalText = '';
      editorPendingBgUpdate = false;
      inspectorMode = 'preview';
      bar.style.display = 'none';
      if (typeof discardCb === 'function') discardCb();
    });
  }

  function selectCapability(kind, item) {
    if (inspectorMode === 'edit' && editorDirty) {
      var curId = selectedCapability && selectedCapability.item && selectedCapability.item.id;
      if (item && item.id === curId && kind === (selectedCapability && selectedCapability.kind)) {
        return;
      }
      confirmDiscardDraft(function() {
        selectCapability(kind, item);
      });
      return;
    }
    editorDirty = false;
    editorOriginalText = '';
    editorPendingBgUpdate = false;
    selectedCapability = { kind: kind, item: item };
    inspectorMode = 'preview';
    var inspEl = el('right-inspector');
    if (inspEl) inspEl.classList.add('open');
    renderInspector();
    renderCapabilitiesTable();
    if (typeof renderProfileStudio === 'function') renderProfileStudio();
  }

  function renderInspector() {
    var placeholder = el('inspector-placeholder');
    var detailWrap = el('inspector-content');
    var bodyEl = el('inspector-detail') || detailWrap;
    if (!detailWrap || !bodyEl) return;
    bodyEl.innerHTML = '';

    if (!selectedCapability) {
      if (placeholder) placeholder.style.display = 'flex';
      detailWrap.style.display = 'none';
      return;
    }

    if (placeholder) placeholder.style.display = 'none';
    detailWrap.style.display = 'flex';

    var kind = selectedCapability.kind;
    var item = selectedCapability.item;
    var dict = i18n[lang] || i18n.en;
    var isArchived = Boolean(item.archived_at);
    var isPaused = item.enabled === false;
    var isPending = item.review_status === 'pending' && !isArchived;
    var isGlobalPersonalMem = kind === 'memories' && (item.tier === 'GLOBAL' || (!item.tier && item.memory_type === 'personal'));
    var itemTier = item.tier || (kind === 'preferences' || isGlobalPersonalMem ? 'GLOBAL' : undefined);

    var header = document.createElement('div');
    header.className = 'inspector-header';
    var fresh = !isArchived ? ((item.freshness && item.freshness.overall_status) || (kind === 'memories' ? 'VERIFIED' : '')) : '';
    var statusBadge = '';
    if (isArchived) {
      statusBadge = '<span class="badge-status">' + ICONS.trash + ' ' + esc(dict.badgeArchived) + '</span>';
    } else if (isPaused) {
      statusBadge = '<span class="badge-status" style="color:var(--text-muted);">' + ICONS.pause + ' ' + esc(dict.badgePaused) + '</span>';
    } else if (fresh) {
      var sDot = fresh === 'VERIFIED' ? 'dot-ok' : (fresh === 'STALE' || fresh === 'ORPHANED' ? 'dot-danger' : 'dot-warn');
      statusBadge = '<span class="badge-status"><span class="dot ' + sDot + '"></span> ' + esc(formatMemoryStatusLabel(fresh)) + '</span>';
    } else if (kind === 'rules') {
      statusBadge = item.core
        ? '<span class="badge-status"><span class="dot dot-ok"></span> ' + esc(dict.tierCore) + '</span>'
        : '<span class="badge-status badge-scoped">' + esc(dict.tierScoped) + '</span>';
    } else if (kind === 'tools') {
      statusBadge = '<span class="badge-status">' + esc(dict.tierSandbox) + '</span>';
    } else if (kind === 'preferences') {
      statusBadge = '<span class="badge-status">' + esc(item.always_on !== false ? dict.profileModeAlwaysOn : dict.profileModeOnDemand) + '</span>';
    }
    var pendingBadge = isPending
      ? ' <span class="badge-status" style="color:var(--status-warn); border-color:var(--status-warn-border); background:var(--status-warn-bg);">' + ICONS.bell + ' ' + esc(dict.badgePending) + '</span>'
      : '';

    var topRow = document.createElement('div');
    topRow.className = 'inspector-top-row';
    topRow.innerHTML = '<div class="inspector-badges"><span class="badge-kind ' + kindSemanticClass(kind) + '">' + esc(formatKind(kind)) + '</span>' + statusBadge + pendingBadge + '</div>' +
      '<button class="btn-action" id="btn-close-inspector" type="button" style="padding:2px 8px;" title="' + esc(dict.closeInspectorTitle) + '">✕</button>';

    var btnClose = topRow.querySelector('#btn-close-inspector');
    if (btnClose) {
      btnClose.addEventListener('click', function() {
        confirmDiscardDraft(function() {
          var inspEl = el('right-inspector');
          if (inspEl) inspEl.classList.remove('open');
          selectedCapability = null;
          inspectorMode = 'preview';
          renderInspector();
          renderCapabilitiesTable();
        });
      });
    }

    var titleEl = document.createElement('div');
    titleEl.className = 'inspector-title';
    titleEl.textContent = item.title || item.name || item.id;

    var idEl = document.createElement('div');
    idEl.className = 'inspector-id';
    idEl.textContent = item.id + (itemTier ? (' · ' + itemTier) : '');

    header.appendChild(topRow);
    header.appendChild(titleEl);
    header.appendChild(idEl);
    bodyEl.appendChild(header);

    var toolbar = document.createElement('div');
    toolbar.className = 'inspector-toolbar';

    if (isExport) {
      // Static export is strictly read-only: hide all mutating toolbar actions
    } else if (isArchived) {
      var btnRestore = document.createElement('button');
      btnRestore.type = 'button';
      btnRestore.className = 'btn-action';
      btnRestore.style.color = 'var(--status-ok)';
      btnRestore.style.borderColor = 'var(--status-ok-border)';
      btnRestore.textContent = dict.restore;
      btnRestore.addEventListener('click', function() {
        var curDict = i18n[lang] || i18n.en;
        runWithButtonLock(btnRestore, curDict.savingLabel, function() {
          return callKernelAction('restore-item', { kind: singularKind(kind), id: item.id, tier: itemTier }).then(function(res) {
            var d = i18n[lang] || i18n.en;
            if (res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              var listPool = (snapshot[kind] || []).slice();
              if (kind === 'preferences' && snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences)) {
                listPool = listPool.concat(snapshot.userProfile.preferences);
              }
              var restored = listPool.find(function(x) { return x && x.id === item.id; });
              if (restored) {
                selectedCapability = { kind: kind, item: restored };
              } else {
                selectedCapability = null;
              }
              rerenderAllViews();
              if (!selectedCapability) renderInspector();
              showToast('success', d.restoredToast.replace('{id}', item.id));
            } else if (!res.offlineExport) {
              showActionError(res, d.errRestoreFailed);
            }
          });
        });
      });
      toolbar.appendChild(btnRestore);
    } else {
      if (isPending) {
        var btnApprove = document.createElement('button');
        btnApprove.type = 'button';
        btnApprove.className = 'btn-action';
        btnApprove.style.color = 'var(--status-ok)';
        btnApprove.style.borderColor = 'var(--status-ok-border)';
        btnApprove.textContent = dict.approve;
        btnApprove.addEventListener('click', function() {
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(btnApprove, curDict.savingLabel, function() {
            return callKernelAction('approve-item', { kind: singularKind(kind), id: item.id, tier: itemTier }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok) {
                item.review_status = 'approved';
                if (res.snapshot) snapshot = res.snapshot;
                rerenderAllViews();
                showToast('success', (lang === 'zh' ? '已确认 ' : 'Approved ') + item.id);
              } else if (!res.offlineExport) {
                showActionError(res, d.errApproveFailed);
              }
            });
          });
        });
        toolbar.appendChild(btnApprove);
      }

      var btnPause = document.createElement('button');
      btnPause.type = 'button';
      btnPause.className = 'btn-action';
      btnPause.innerHTML = isPaused ? esc(dict.resumeItem) : (ICONS.pause + '<span>' + esc(dict.pauseItem) + '</span>');
      btnPause.addEventListener('click', function() {
        var nextEnabled = isPaused ? true : false;
        var curDict = i18n[lang] || i18n.en;
        runWithButtonLock(btnPause, curDict.savingLabel, function() {
          return callKernelAction('toggle-enabled', { kind: singularKind(kind), id: item.id, enabled: nextEnabled, tier: itemTier }).then(function(res) {
            var d = i18n[lang] || i18n.en;
            if (res.ok) {
              item.enabled = nextEnabled;
              if (res.snapshot) snapshot = res.snapshot;
              rerenderAllViews();
              var pMsg = (nextEnabled ? d.resumedToast : d.pausedToast).replace('{id}', item.id);
              if (!nextEnabled) {
                showToast('success', pMsg, 8000, {
                  label: d.undoActionLabel,
                  run: function() {
                    callKernelAction('toggle-enabled', { kind: singularKind(kind), id: item.id, enabled: true, tier: itemTier }).then(function(r2) {
                      if (r2 && r2.ok) {
                        if (r2.snapshot) snapshot = r2.snapshot;
                        rerenderAllViews();
                        showToast('success', (i18n[lang] || i18n.en).resumedToast.replace('{id}', item.id));
                      }
                    });
                  }
                });
              } else {
                showToast('success', pMsg);
              }
            } else if (!res.offlineExport) {
              showActionError(res, d.errToggleFailed, { kind: singularKind(kind), id: item.id, tier: itemTier, item: item });
            }
          });
        });
      });
      toolbar.appendChild(btnPause);

      var btnOpen = document.createElement('button');
      btnOpen.type = 'button';
      btnOpen.className = 'btn-action';
      btnOpen.textContent = dict.openInIde;
      btnOpen.addEventListener('click', function() {
        var filePath = '';
        var line = 1;
        if (kind === 'memories') {
          var anchors = (item.freshness && item.freshness.topology_anchors) || [];
          if (anchors[0] && anchors[0].file_path && anchors[0].file_path !== '(unrecorded)') {
            filePath = anchors[0].file_path;
            line = parseInt(String(anchors[0].lines || '1').split('-')[0].replace(/[^0-9]/g, ''), 10) || 1;
          }
          if (!filePath && item.ast_fingerprints) {
            var fpKeys = Object.keys(item.ast_fingerprints);
            for (var fi = 0; fi < fpKeys.length; fi++) {
              var fpHit = item.ast_fingerprints[fpKeys[fi]] || {};
              var fpCandidate = String(fpHit.file_path || fpHit.file || '');
              if (fpCandidate && fpCandidate !== '(unrecorded)') {
                filePath = fpCandidate;
                line = Number(fpHit.start_line || 1) || 1;
                break;
              }
            }
          }
          if (!filePath && item.target_symbols && item.target_symbols[0]) {
            var symCandidate = String(item.target_symbols[0]).split('#')[0];
            if (symCandidate && (symCandidate.indexOf('/') !== -1 || symCandidate.indexOf(String.fromCharCode(92)) !== -1 || /\\.[a-z0-9]{1,8}$/i.test(symCandidate))) {
              filePath = symCandidate;
            }
          }
          if (!filePath) {
            var gRoot = (itemTier === 'GLOBAL' && snapshot && snapshot.userProfile && snapshot.userProfile.globalRoot && !isAnon)
              ? String(snapshot.userProfile.globalRoot).replace(/[\\\\/]+$/, '')
              : '';
            if (gRoot && (gRoot.charAt(0) === '/' || /^[A-Za-z]:/.test(gRoot))) {
              filePath = gRoot + '/.evo/memories/' + item.id + '.md';
            } else {
              filePath = '.evo/memories/' + item.id + '.md';
            }
          }
        } else if (kind === 'rules') {
          filePath = item.core ? ('.evo/rules/' + item.id + '.md') : ('.evo/rules/scoped/' + item.id + '.md');
        } else if (kind === 'skills') {
          filePath = '.evo/skills/' + item.id + '/SKILL.md';
        } else if (kind === 'tools') {
          filePath = item.script_path || ('.evo/tools/' + item.id + '/' + (item.entry_script || 'run.mjs'));
        } else if (kind === 'preferences') {
          filePath = '.evo/preferences/' + item.id + '.md';
        }
        if (filePath) {
          var targetRef = filePath + (line > 1 ? ':' + line : '');
          callKernelAction('open-editor', { filePath: filePath, line: line, tier: itemTier }).then(function(res) {
            handleOpenEditorResult(res, targetRef);
          });
        }
      });
      toolbar.appendChild(btnOpen);

      if (kind === 'memories') {
        var btnVerify = document.createElement('button');
        btnVerify.type = 'button';
        btnVerify.className = 'btn-action';
        btnVerify.textContent = dict.verifyAst;
        btnVerify.addEventListener('click', function() {
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(btnVerify, curDict.verifyingAst, function() {
            return callKernelAction('verify-memory', { id: item.id, tier: itemTier }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok && res.snapshot) {
                snapshot = res.snapshot;
                rerenderAllViews();
                showToast('success', lang === 'zh' ? '代码链接校验完成' : 'Code link verification complete');
              } else if (!res.offlineExport) {
                showActionError(res, d.errVerifyFailed);
              }
            });
          });
        });
        toolbar.appendChild(btnVerify);
      }

      if (kind === 'rules') {
        var btnToggleCore = document.createElement('button');
        btnToggleCore.type = 'button';
        btnToggleCore.className = 'btn-action';
        btnToggleCore.textContent = item.core ? dict.demoteScoped : dict.promoteCore;
        btnToggleCore.addEventListener('click', function() {
          var prevCore = Boolean(item.core);
          var nextCore = !prevCore;
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(btnToggleCore, curDict.savingLabel, function() {
            return callKernelAction('toggle-rule-tier', { id: item.id, core: nextCore, tier: itemTier }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok) {
                if (res.snapshot) {
                  snapshot = res.snapshot;
                } else {
                  item.core = nextCore;
                }
                rerenderAllViews();
                var tokNow = (res.data && res.data.tokenUsage !== undefined) ? res.data.tokenUsage : (res.tokenUsage || 0);
                var movedMsg = nextCore
                  ? d.ruleMovedCoreToast.replace('{tok}', String(tokNow)).replace('{max}', String(getMaxCoreRuleTokens()))
                  : d.ruleMovedScopedToast;
                showToast('success', movedMsg, 8000, {
                  label: d.undoActionLabel,
                  run: function() {
                    callKernelAction('toggle-rule-tier', { id: item.id, core: prevCore, tier: itemTier }).then(function(r2) {
                      if (r2 && r2.ok) {
                        if (r2.snapshot) snapshot = r2.snapshot;
                        rerenderAllViews();
                        showToast('success', (i18n[lang] || i18n.en).profileUndoneToast);
                      }
                    });
                  }
                });
              } else if (!res.offlineExport) {
                showActionError(res, d.errToggleTierFailed);
              }
            });
          });
        });
        toolbar.appendChild(btnToggleCore);
      }

      if (kind === 'preferences') {
        var btnToggleMode = document.createElement('button');
        btnToggleMode.type = 'button';
        btnToggleMode.className = 'btn-action';
        btnToggleMode.textContent = item.always_on !== false ? dict.profileToggleToOnDemand : dict.profileToggleToAlwaysOn;
        btnToggleMode.addEventListener('click', function() {
          var nextAlwaysOn = item.always_on === false;
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(btnToggleMode, curDict.savingLabel, function() {
            return callKernelAction('create-preference', {
              id: item.id,
              supersedes_id: item.id,
              tier: itemTier || 'GLOBAL',
              title: item.title || item.id,
              l0_summary: item.l0_summary || item.title || item.id,
              category: item.category || 'style',
              always_on: nextAlwaysOn,
              trigger_cue: item.trigger_cue || undefined,
              tags: Array.isArray(item.tags) ? item.tags : [],
              content: item.content || item.l0_summary || item.title || item.id,
              enabled: item.enabled !== false,
              review_status: item.review_status || 'approved'
            }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok) {
                if (res.snapshot) snapshot = res.snapshot;
                rerenderAllViews();
                showToast('success', d.profileModeUpdatedToast.replace('{id}', item.id), 8000, {
                  label: d.undoActionLabel,
                  run: function() {
                    callKernelAction('undo-preference', { id: item.id, tier: itemTier || 'GLOBAL' }).then(function(r2) {
                      if (r2 && r2.ok) {
                        if (r2.snapshot) snapshot = r2.snapshot;
                        rerenderAllViews();
                        showToast('success', (i18n[lang] || i18n.en).profileUndoneToast);
                      }
                    });
                  }
                });
                if (res.data && Array.isArray(res.data.warnings) && res.data.warnings.length > 0) {
                  showToast('warn', res.data.warnings[0], 6000);
                }
              } else if (!res.offlineExport) {
                showActionError(res, d.errSaveFailed, { id: item.id, tier: itemTier || 'GLOBAL', item: item });
              }
            });
          });
        });
        toolbar.appendChild(btnToggleMode);
      }

      if (kind === 'tools') {
        var btnRunTest = document.createElement('button');
        btnRunTest.type = 'button';
        btnRunTest.className = 'btn-action';
        btnRunTest.textContent = dict.runSelfTest;
        btnRunTest.addEventListener('click', function() {
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(btnRunTest, curDict.runningBadge, function() {
            return runToolSelfTest(item.id);
          });
        });
        toolbar.appendChild(btnRunTest);
      }

      var btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-action';
      btnEdit.innerHTML = inspectorMode === 'edit' ? (ICONS.eye + '<span>' + esc(dict.preview) + '</span>') : (ICONS.edit + '<span>' + esc(dict.edit) + '</span>');
      btnEdit.addEventListener('click', function() {
        if (inspectorMode === 'edit') {
          confirmDiscardDraft(function() {
            inspectorMode = 'preview';
            renderInspector();
          });
        } else {
          inspectorMode = 'edit';
          renderInspector();
        }
      });
      toolbar.appendChild(btnEdit);

      var btnArchive = document.createElement('button');
      btnArchive.type = 'button';
      btnArchive.className = 'btn-action btn-danger inspector-toolbar-danger-sep';
      btnArchive.innerHTML = ICONS.trash + '<span>' + esc(dict.archive) + '</span>';
      btnArchive.addEventListener('click', function() {
        var curDict = i18n[lang] || i18n.en;
        runWithButtonLock(btnArchive, curDict.savingLabel, function() {
          return archiveAndOfferUndo(kind, item.id, itemTier);
        });
      });
      toolbar.appendChild(btnArchive);
    }

    bodyEl.appendChild(toolbar);

    var tldrText = item.l0_summary || item.description || item.title || '';
    if (tldrText && inspectorMode !== 'edit') {
      var tldrSection = document.createElement('div');
      tldrSection.className = 'inspector-section';
      tldrSection.innerHTML =
        '<div class="tldr-card">' +
          '<div class="tldr-card-label" style="display:flex;align-items:center;gap:5px;">' + ICONS.bulb + '<span>' + esc(dict.tldrLabel) + '</span></div>' +
          '<div class="tldr-card-body">' + formatRichText(tldrText) + '</div>' +
        '</div>';
      bodyEl.appendChild(tldrSection);
    }

    if (!isExport && !isArchived && kind === 'memories' && (fresh === 'STALE' || fresh === 'OTHER_BRANCH')) {
      var staleBanner = document.createElement('div');
      staleBanner.className = 'inspector-section';
      staleBanner.innerHTML =
        '<div class="stale-action-banner">' +
          '<div class="stale-action-text" style="display:flex;align-items:flex-start;gap:6px;">' + ICONS.warn + '<span>' + esc(dict.staleBannerText) + '</span></div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' +
            '<button type="button" class="btn-action" id="btn-rebind-ast" style="color:var(--status-ok);border-color:var(--status-ok-border);">' + ICONS.refresh + '<span>' + esc(dict.rebindAst) + '</span></button>' +
            '<button type="button" class="btn-action" id="btn-stale-pause">' + (isPaused ? esc(dict.resumeItem) : (ICONS.pause + '<span>' + esc(dict.pauseItem) + '</span>')) + '</button>' +
            '<button type="button" class="btn-action btn-danger" id="btn-stale-archive">' + ICONS.trash + '<span>' + esc(dict.archive) + '</span></button>' +
          '</div>' +
        '</div>';
      bodyEl.appendChild(staleBanner);

      var btnRebind = staleBanner.querySelector('#btn-rebind-ast');
      if (btnRebind) {
        btnRebind.addEventListener('click', function() {
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(btnRebind, curDict.rebindingAst, function() {
            return callKernelAction('rebind-memory-ast', { id: item.id, tier: itemTier }).then(function(res) {
              var d = i18n[lang] || i18n.en;
              if (res.ok && res.snapshot) {
                snapshot = res.snapshot;
                rerenderAllViews();
                showToast('success', lang === 'zh' ? '已更新为当前代码链接' : 'Code links updated to current branch');
              } else if (!res.offlineExport) {
                showActionError(res, d.errRebindFailed);
              }
            });
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
          var curDict = i18n[lang] || i18n.en;
          runWithButtonLock(btnStaleArchive, curDict.savingLabel, function() {
            return archiveAndOfferUndo(kind, item.id, itemTier);
          });
        });
      }
    }

    if (!isArchived && kind === 'memories') {
      var anchors = (item.freshness && item.freshness.topology_anchors) || [];
      var astSection = document.createElement('div');
      astSection.className = 'inspector-section';
      astSection.innerHTML = '<div class="inspector-section-title"><span>' + esc(dict.astAnchors) + ' (' + anchors.length + ')</span>' + statusBadge + '</div>';

      anchors.forEach(function(anchor) {
        var row = document.createElement('div');
        row.className = 'ast-anchor-card';
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
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
            '<span>' + ((anchor.callers || []).length) + ' ' + esc(dict.callersSuffix) + '</span>' +
            '<span style="margin-left:auto;">' + esc(formatMemoryStatusLabel(anchor.status)) + '</span>' +
          '</div>';

        function jumpToAnchor() {
          var anchorRef = anchor.file_path + ':' + startLine;
          callKernelAction('open-editor', { filePath: anchor.file_path, line: startLine }).then(function(res) {
            handleOpenEditorResult(res, anchorRef);
          });
        }

        row.addEventListener('click', jumpToAnchor);
        row.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            jumpToAnchor();
          }
        });
        astSection.appendChild(row);
      });
      bodyEl.appendChild(astSection);
    }

    var bodySection = document.createElement('div');
    bodySection.className = 'inspector-section';

    if (!isExport && inspectorMode === 'edit') {
      var fieldsHtml = '';
      if (kind === 'memories') {
        fieldsHtml =
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-title">' + esc(dict.fieldTitleLabel) + '</label>' +
            '<input type="text" class="editor-input" id="editor-field-title" />' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-symptom">' + esc(dict.symptomLabel) + '</label>' +
            '<textarea class="editor-textarea-sm" id="editor-field-symptom"></textarea>' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-root-cause">' + esc(dict.rootCauseLabel) + '</label>' +
            '<textarea class="editor-textarea-sm" id="editor-field-root-cause"></textarea>' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-solution">' + esc(dict.solutionLabel) + '</label>' +
            '<textarea class="editor-textarea-sm" id="editor-field-solution"></textarea>' +
          '</div>';
      } else if (kind === 'skills') {
        fieldsHtml =
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-title">' + esc(dict.fieldTitleLabel) + '</label>' +
            '<input type="text" class="editor-input" id="editor-field-title" />' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-l1">' + esc(dict.l1ContractLabel) + '</label>' +
            '<textarea class="editor-textarea-sm" id="editor-field-l1"></textarea>' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-l2">' + esc(dict.l2SopLabel) + '</label>' +
            '<textarea class="editor-textarea" id="editor-field-l2" style="height:220px;"></textarea>' +
          '</div>';
      } else if (kind === 'preferences') {
        fieldsHtml =
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-title">' + esc(dict.fieldTitleLabel) + '</label>' +
            '<input type="text" class="editor-input" id="editor-field-title" />' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-l0">' + esc(dict.fieldSummaryLabel) + '</label>' +
            '<input type="text" class="editor-input" id="editor-field-l0" />' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-category">' + esc(dict.fieldCategoryLabel) + '</label>' +
            '<select class="editor-select" id="editor-field-category">' +
              '<option value="style">' + esc(dict.catStyle) + '</option>' +
              '<option value="formatting">' + esc(dict.catFormatting) + '</option>' +
              '<option value="communication">' + esc(dict.catCommunication) + '</option>' +
              '<option value="workflow">' + esc(dict.catWorkflow) + '</option>' +
              '<option value="requirement">' + esc(dict.catRequirement) + '</option>' +
              '<option value="knowledge">' + esc(dict.catKnowledge) + '</option>' +
            '</select>' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-always-on">' + esc(dict.fieldWhenAppliesLabel) + '</label>' +
            '<select class="editor-select" id="editor-field-always-on">' +
              '<option value="true">' + esc(dict.profileModeAlwaysOn) + '</option>' +
              '<option value="false">' + esc(dict.profileModeOnDemand) + '</option>' +
            '</select>' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-trigger">' + esc(dict.fieldTriggerCueLabel) + '</label>' +
            '<input type="text" class="editor-input" id="editor-field-trigger" />' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="inspector-editor-input">' + esc(dict.bodyLabel) + '</label>' +
            '<textarea class="editor-textarea-sm" id="inspector-editor-input"></textarea>' +
          '</div>';
      } else if (kind === 'rules') {
        fieldsHtml =
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-title">' + esc(dict.fieldTitleLabel) + '</label>' +
            '<input type="text" class="editor-input" id="editor-field-title" />' +
          '</div>' +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="editor-field-l0">' + esc(dict.fieldSummaryLabel) + '</label>' +
            '<input type="text" class="editor-input" id="editor-field-l0" />' +
          '</div>' +
          (!item.core
            ? ('<div class="editor-field-group">' +
                '<label class="editor-field-label" for="editor-field-scope">' + esc(dict.fieldScopeGlobLabel) + '</label>' +
                '<input type="text" class="editor-input" id="editor-field-scope" />' +
              '</div>')
            : '') +
          '<div class="editor-field-group">' +
            '<label class="editor-field-label" for="inspector-editor-input">' + esc(dict.bodyLabel) + '</label>' +
            '<textarea class="editor-textarea" id="inspector-editor-input" style="height:220px;"></textarea>' +
          '</div>';
      } else {
        fieldsHtml = '<textarea class="editor-textarea" id="inspector-editor-input"></textarea>';
      }

      bodySection.innerHTML =
        '<div class="inspector-section-title"><span>' + esc(dict.inlineEditorTitle) + '</span></div>' +
        '<div id="editor-bg-update-banner" class="inline-info-bar" style="display:none;"></div>' +
        '<div id="editor-discard-confirm-bar" class="inline-confirm-bar" style="display:none;"></div>' +
        '<div class="editor-fields-stack" id="inspector-editor-fields">' + fieldsHtml + '</div>' +
        '<div class="editor-footer">' +
          '<span id="editor-token-est">~0 ' + esc(dict.tokensEstSuffix) + '</span>' +
          '<div style="display:flex;gap:6px;">' +
            '<button type="button" class="btn-action" id="btn-editor-cancel">' + esc(dict.cancel) + '</button>' +
            '<button type="button" class="btn-action btn-primary" id="btn-editor-save">' + esc(dict.saveChanges) + '</button>' +
          '</div>' +
        '</div>';
      bodyEl.appendChild(bodySection);

      var qField = function(sel) { return bodySection.querySelector(sel); };
      if (kind === 'memories') {
        if (qField('#editor-field-title')) qField('#editor-field-title').value = item.title || '';
        if (qField('#editor-field-symptom')) qField('#editor-field-symptom').value = item.symptom || '';
        if (qField('#editor-field-root-cause')) qField('#editor-field-root-cause').value = item.root_cause || '';
        if (qField('#editor-field-solution')) qField('#editor-field-solution').value = item.solution || '';
      } else if (kind === 'skills') {
        if (qField('#editor-field-title')) qField('#editor-field-title').value = item.name || item.title || '';
        if (qField('#editor-field-l1')) qField('#editor-field-l1').value = item.l1_contract || '';
        if (qField('#editor-field-l2')) qField('#editor-field-l2').value = item.l2_sop || '';
      } else if (kind === 'preferences') {
        if (qField('#editor-field-title')) qField('#editor-field-title').value = item.title || '';
        if (qField('#editor-field-l0')) qField('#editor-field-l0').value = item.l0_summary || '';
        if (qField('#editor-field-category')) qField('#editor-field-category').value = item.category || 'style';
        if (qField('#editor-field-always-on')) qField('#editor-field-always-on').value = item.always_on === false ? 'false' : 'true';
        if (qField('#editor-field-trigger')) qField('#editor-field-trigger').value = item.trigger_cue || '';
        if (qField('#inspector-editor-input')) qField('#inspector-editor-input').value = item.content || '';
      } else if (kind === 'rules') {
        if (qField('#editor-field-title')) qField('#editor-field-title').value = item.title || '';
        if (qField('#editor-field-l0')) qField('#editor-field-l0').value = item.l0_summary || '';
        if (qField('#editor-field-scope')) qField('#editor-field-scope').value = item.scope_glob || '*';
        if (qField('#inspector-editor-input')) qField('#inspector-editor-input').value = item.content || '';
      } else {
        if (qField('#inspector-editor-input')) qField('#inspector-editor-input').value = item.script_code || '';
      }

      function readDraftSnapshot() {
        if (kind === 'memories') {
          return {
            title: (qField('#editor-field-title') || {}).value || '',
            symptom: (qField('#editor-field-symptom') || {}).value || '',
            root_cause: (qField('#editor-field-root-cause') || {}).value || '',
            solution: (qField('#editor-field-solution') || {}).value || ''
          };
        }
        if (kind === 'skills') {
          return {
            title: (qField('#editor-field-title') || {}).value || '',
            l1_contract: (qField('#editor-field-l1') || {}).value || '',
            l2_sop: (qField('#editor-field-l2') || {}).value || ''
          };
        }
        if (kind === 'preferences') {
          return {
            title: (qField('#editor-field-title') || {}).value || '',
            l0_summary: (qField('#editor-field-l0') || {}).value || '',
            category: (qField('#editor-field-category') || {}).value || 'style',
            always_on: ((qField('#editor-field-always-on') || {}).value || 'true') !== 'false',
            trigger_cue: (qField('#editor-field-trigger') || {}).value || '',
            content: (qField('#inspector-editor-input') || {}).value || ''
          };
        }
        if (kind === 'rules') {
          return {
            title: (qField('#editor-field-title') || {}).value || '',
            l0_summary: (qField('#editor-field-l0') || {}).value || '',
            scope_glob: qField('#editor-field-scope') ? qField('#editor-field-scope').value : (item.scope_glob || '*'),
            content: (qField('#inspector-editor-input') || {}).value || ''
          };
        }
        return {
          script_code: (qField('#inspector-editor-input') || {}).value || ''
        };
      }

      editorOriginalText = JSON.stringify(readDraftSnapshot());
      editorDirty = false;
      editorPendingBgUpdate = false;

      var tokenEstEl = bodySection.querySelector('#editor-token-est');
      function updateTokenEstimate() {
        var draftObj = readDraftSnapshot();
        var totalChars = Object.keys(draftObj).reduce(function(sum, kName) {
          return sum + String(draftObj[kName] === undefined ? '' : draftObj[kName]).length;
        }, 0);
        if (tokenEstEl) tokenEstEl.textContent = '~' + Math.ceil(totalChars / 4) + ' ' + dict.tokensEstSuffix;
      }
      updateTokenEstimate();

      bodySection.querySelectorAll('#inspector-editor-fields input, #inspector-editor-fields textarea, #inspector-editor-fields select').forEach(function(fld) {
        var markDirty = function() {
          editorDirty = (JSON.stringify(readDraftSnapshot()) !== editorOriginalText);
          updateTokenEstimate();
        };
        fld.addEventListener('input', markDirty);
        fld.addEventListener('change', markDirty);
      });

      // Only intercept Tab for 2-space indentation inside code editors (tools), keeping standard Tab focus navigation on prose fields
      var codeTxt = kind === 'tools' ? qField('#inspector-editor-input') : null;
      if (codeTxt) {
        codeTxt.addEventListener('keydown', function(e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            var start = this.selectionStart;
            var end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 2;
            editorDirty = (JSON.stringify(readDraftSnapshot()) !== editorOriginalText);
            updateTokenEstimate();
          }
        });
      }

      bodySection.querySelector('#btn-editor-cancel').addEventListener('click', function() {
        confirmDiscardDraft(function() {
          inspectorMode = 'preview';
          renderInspector();
        });
      });

      var btnSave = bodySection.querySelector('#btn-editor-save');
      btnSave.addEventListener('click', function() {
        var draft = readDraftSnapshot();
        var curDict = i18n[lang] || i18n.en;
        runWithButtonLock(btnSave, curDict.savingLabel, function() {
          var savePromise;
          if (kind === 'preferences') {
            savePromise = callKernelAction('create-preference', {
              id: item.id,
              supersedes_id: item.id,
              tier: itemTier || 'GLOBAL',
              title: draft.title.trim() || item.title || item.id,
              l0_summary: draft.l0_summary.trim() || draft.content.trim().slice(0, 120) || item.l0_summary || item.title || item.id,
              category: draft.category || 'style',
              always_on: draft.always_on,
              trigger_cue: draft.trigger_cue.trim() || undefined,
              tags: Array.isArray(item.tags) ? item.tags : [],
              content: draft.content,
              enabled: item.enabled !== false,
              review_status: item.review_status || 'approved'
            });
          } else {
            var updatePayload = Object.assign({ kind: singularKind(kind), id: item.id, tier: itemTier }, draft);
            if (kind === 'tools') {
              updatePayload.content = draft.script_code;
            }
            savePromise = callKernelAction('update-content', updatePayload);
          }
          return savePromise.then(function(res) {
            if (res.ok) {
              editorDirty = false;
              editorOriginalText = '';
              editorPendingBgUpdate = false;
              showToast('success', (lang === 'zh' ? '已保存变更：' : 'Changes saved to ') + item.id);
              if (res.data && Array.isArray(res.data.warnings) && res.data.warnings.length > 0) {
                showToast('warn', res.data.warnings[0], 6000);
              }
              if (res.snapshot) {
                snapshot = res.snapshot;
              }
              inspectorMode = 'preview';
              rerenderAllViews();
            } else {
              if (res.snapshot) {
                snapshot = res.snapshot;
                rerenderAllViews();
              }
              if (!res.offlineExport) {
                showActionError(res, curDict.errSaveFailed, { kind: singularKind(kind), id: item.id, tier: itemTier, item: item });
              }
            }
          });
        });
      });
    } else {
      if (kind === 'memories' && (item.symptom || item.root_cause || item.solution)) {
        bodySection.innerHTML =
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-danger);">' +
            '<div class="bento-card-label" style="color:var(--status-danger);">' + esc(dict.symptomLabel) + '</div>' +
            '<div class="bento-card-content">' + formatRichText(item.symptom) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-warn);">' +
            '<div class="bento-card-label" style="color:var(--status-warn);">' + esc(dict.rootCauseLabel) + '</div>' +
            '<div class="bento-card-content">' + formatRichText(item.root_cause) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview" style="border-left:3px solid var(--status-ok);">' +
            '<div class="bento-card-label" style="color:var(--status-ok);">' + esc(dict.solutionLabel) + '</div>' +
            '<div class="bento-card-content">' + formatRichText(item.solution) + '</div>' +
          '</div>';
      } else if (kind === 'skills' && (item.l1_contract || item.l2_sop)) {
        bodySection.innerHTML =
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label" style="color:var(--status-info);">' + esc(dict.l1ContractLabel) + '</div>' +
            '<div class="bento-card-content">' + formatRichText(item.l1_contract) + '</div>' +
          '</div>' +
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label" style="color:var(--status-ok);">' + esc(dict.l2SopLabel) + '</div>' +
            '<div class="bento-card-content">' + formatRichText(item.l2_sop) + '</div>' +
          '</div>';
      } else if (kind === 'tools') {
        var toolCode = item.script_code || '';
        bodySection.innerHTML =
          '<div class="bento-card-preview">' +
            '<div class="bento-card-label">' + esc(item.entry_script || 'run.mjs') + '</div>' +
            (toolCode
              ? '<pre class="code-block">' + esc(toolCode) + '</pre>'
              : '<div class="bento-card-content" style="color:var(--text-muted);">' + esc(item.l0_summary || '') + '</div>') +
          '</div>';
      } else {
        bodySection.innerHTML =
          (item.content ? '<div class="bento-card-preview"><div class="bento-card-label">' + esc(dict.bodyLabel) + '</div><div class="bento-card-content">' + formatRichText(item.content) + '</div></div>' : '');
      }
      bodyEl.appendChild(bodySection);
    }

    if (kind === 'tools') {
      var termSection = document.createElement('div');
      termSection.className = 'inspector-section';
      termSection.id = 'inspector-tool-terminal';
      termSection.innerHTML =
        '<div class="inspector-section-title">' +
          '<span>' + esc(dict.sandboxConsole) + '</span>' +
          '<span id="term-status-badge" class="badge-status">' + esc(dict.idleBadge) + '</span>' +
        '</div>' +
        '<div class="terminal-screen" id="term-screen">$ evo run ' + esc(item.id) + ' --self-test\\n' + esc(dict.sandboxClickHint) + '</div>';
      bodyEl.appendChild(termSection);
    }
  }

  function runToolSelfTest(toolId) {
    var dict = i18n[lang] || i18n.en;
    var termBadge = el('term-status-badge');
    var termScreen = el('term-screen');
    if (termBadge) termBadge.textContent = dict.runningBadge;
    if (termScreen) termScreen.textContent = '$ evo run ' + toolId + ' --self-test\\n' + dict.sandboxExecutingMsg;

    return callKernelAction('run-tool-test', { id: toolId }).then(function(res) {
      var curDict = i18n[lang] || i18n.en;
      if (!termScreen || !termBadge) return;
      if (res.ok && res.result) {
        var r = res.result;
        var pass = r.exitCode === 0 && !r.timedOut;
        termBadge.textContent = pass
          ? curDict.termPassBadge.replace('{ms}', String(r.durationMs))
          : curDict.termFailBadge.replace('{code}', String(r.exitCode));
        termBadge.style.color = pass ? 'var(--status-ok)' : 'var(--status-danger)';
        var out = '$ evo run ' + toolId + ' --self-test\\n' +
          (r.stdout ? (r.stdout + '\\n') : '') +
          (r.stderr ? ('[STDERR]\\n' + r.stderr + '\\n') : '') +
          (r.timedOut ? (curDict.termTimeoutLine + '\\n') : '') +
          '----------------------------------------\\n' +
          curDict.termSummaryLine.replace('{code}', String(r.exitCode)).replace('{ms}', String(r.durationMs));
        termScreen.textContent = out;
        showToast(
          pass ? 'success' : 'error',
          (pass ? curDict.selfTestPassedToast : curDict.selfTestFailedToast).replace('{ms}', String(r.durationMs))
        );
      } else if (res.offlineExport) {
        termBadge.textContent = curDict.serverSnapshot;
        termBadge.style.color = 'var(--status-warn)';
        termScreen.textContent = '$ evo run ' + toolId + ' --self-test\\n' + (res.error || curDict.offlineActionToast.replace('{action}', 'run-tool-test'));
      } else {
        termBadge.textContent = curDict.errorBadge;
        termBadge.style.color = 'var(--status-danger)';
        termScreen.textContent = curDict.termExecFailedPrefix + (res.error || curDict.errUnknown);
        showToast('error', res.error || curDict.errorBadge);
      }
    });
  }
`;
