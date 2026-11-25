export function renderProfileSectionHtml(): string {
  return `      <section id="view-profile" class="view-panel">
        <div class="view-header">
          <div class="profile-header-row">
            <div>
              <h1 id="profile-view-title" class="view-title">Personal Profile</h1>
              <p id="profile-view-sub" class="view-subtitle">Your habits and workflows synced across projects and AI tools</p>
            </div>
            <div class="profile-header-actions">
              <button type="button" id="btn-profile-add" class="btn-action" style="border-color:var(--border-focus);color:var(--text-primary);">+ Add Habit</button>
              <button type="button" id="btn-profile-import" class="btn-action">Import Markdown</button>
              <button type="button" id="btn-profile-sync" class="btn-action" style="color:var(--status-ok);border-color:var(--status-ok-border);">Sync AI Tools</button>
            </div>
          </div>
        </div>

        <div class="profile-studio-body">
          <!-- 3-Column Bento: Always-On Profile Card, On-Demand Directory, Connected AI Tools -->
          <div class="profile-bento-grid">
            <div class="profile-bento-card">
              <div class="profile-card-hdr">
                <span id="profile-card-title">Always-On Profile Card</span>
                <span id="profile-card-tokens" class="mono-dim">0 / 800 tok</span>
              </div>
              <div class="progress-track">
                <div id="profile-card-bar" class="progress-bar" style="width: 0%;"></div>
              </div>
              <pre id="profile-card-preview" class="profile-preview-pre">No active Always-On habits yet.</pre>
            </div>

            <div class="profile-bento-card">
              <div class="profile-card-hdr">
                <span id="profile-menu-title">On-Demand Directory</span>
                <span id="profile-menu-tokens" class="mono-dim">0 / 250 tok</span>
              </div>
              <div class="progress-track">
                <div id="profile-menu-bar" class="progress-bar" style="width: 0%;"></div>
              </div>
              <pre id="profile-menu-preview" class="profile-preview-pre">No active On-Demand workflows or personal skills yet.</pre>
            </div>

            <div class="profile-bento-card">
              <div class="profile-card-hdr">
                <span id="profile-hosts-title">Connected AI Tools</span>
                <span id="profile-hosts-count" class="mono-dim">0</span>
              </div>
              <div id="profile-host-badges" class="profile-host-badges"></div>
            </div>
          </div>

          <!-- Recent Changes + 1-Click Undo -->
          <div id="profile-history-bar" class="profile-history-bar">
            <div class="profile-card-hdr">
              <span id="profile-history-title">Recent Changes</span>
            </div>
            <div id="profile-history-list" class="profile-history-items"></div>
          </div>

          <!-- Inline Create / Edit Preference Drawer -->
          <div id="profile-editor-panel" class="profile-panel-drawer">
            <div class="profile-card-hdr">
              <span id="profile-editor-heading">Add Personal Habit</span>
            </div>
            <div class="profile-field">
              <label id="lbl-profile-content" for="profile-inp-content" class="profile-field-label">Habit or Instruction</label>
              <textarea id="profile-inp-content" class="profile-textarea" placeholder="Write the reusable cross-workspace instruction..."></textarea>
            </div>
            <details id="profile-more-options" class="profile-more-options">
              <summary id="profile-more-options-summary">More options</summary>
              <div class="profile-form-grid">
                <div class="profile-field">
                  <label id="lbl-profile-title" for="profile-inp-title" class="profile-field-label">Title</label>
                  <input id="profile-inp-title" type="text" class="profile-input" placeholder="e.g. Concise Engineering Style" />
                </div>
                <div class="profile-field">
                  <label id="lbl-profile-category" for="profile-inp-category" class="profile-field-label">Category</label>
                  <select id="profile-inp-category" class="profile-select">
                    <option value="style">Style</option>
                    <option value="formatting">Formatting</option>
                    <option value="communication">Communication</option>
                    <option value="workflow">Workflow</option>
                    <option value="requirement">Requirement</option>
                    <option value="knowledge">Knowledge</option>
                  </select>
                </div>
                <div class="profile-field">
                  <label id="lbl-profile-l0" for="profile-inp-l0" class="profile-field-label">One-Line Summary (&lt;=140 chars)</label>
                  <input id="profile-inp-l0" type="text" class="profile-input" placeholder="1-line summary shown in Always-On card or Directory Menu" />
                </div>
                <div class="profile-field">
                  <label id="lbl-profile-mode" for="profile-inp-always-on" class="profile-field-label">When It Applies</label>
                  <select id="profile-inp-always-on" class="profile-select">
                    <option value="true">Always-On</option>
                    <option value="false">On-Demand</option>
                  </select>
                </div>
                <div class="profile-field">
                  <label id="lbl-profile-tags" for="profile-inp-tags" class="profile-field-label">Tags (comma-separated)</label>
                  <input id="profile-inp-tags" type="text" class="profile-input" placeholder="style, concise, ts" />
                </div>
              </div>
            </details>
            <div class="profile-header-actions">
              <button type="button" id="btn-profile-save" class="btn-action" style="color:var(--status-ok);border-color:var(--status-ok-border);">Save</button>
              <button type="button" id="btn-profile-cancel" class="btn-action">Cancel</button>
            </div>
          </div>

          <!-- Markdown Importer Drawer -->
          <div id="profile-import-panel" class="profile-panel-drawer">
            <div class="profile-card-hdr">
              <span id="profile-import-title">Import Markdown Rules (CLAUDE.md / GEMINI.md)</span>
            </div>
            <p id="profile-import-sub" class="view-subtitle">Extracts bullet rules and sections (skipping EvoKernel managed blocks) automatically.</p>
            <div class="profile-form-grid">
              <div class="profile-field">
                <label id="lbl-profile-import-mode" for="profile-import-always-on" class="profile-field-label">When It Applies</label>
                <select id="profile-import-always-on" class="profile-select">
                  <option value="auto" selected>Auto-detect per rule</option>
                  <option value="always-on">Always-On</option>
                  <option value="on-demand">On-Demand</option>
                </select>
              </div>
            </div>
            <textarea id="profile-import-textarea" class="profile-textarea" placeholder="Paste markdown bullets or sections from CLAUDE.md / GEMINI.md..."></textarea>
            <div id="profile-import-result" class="mono-dim" style="display: none;"></div>
            <div class="profile-header-actions">
              <button type="button" id="btn-profile-import-run" class="btn-action" style="color:var(--status-ok);border-color:var(--status-ok-border);">Import &amp; Sync</button>
              <button type="button" id="btn-profile-import-cancel" class="btn-action">Cancel</button>
            </div>
          </div>

          <!-- Preferences & Personal Workflows Matrix -->
          <div class="profile-list-card">
            <div class="profile-list-toolbar">
              <div id="profile-filter-pills" class="pill-group">
                <button type="button" class="filter-pill active" data-profile-filter="all">All</button>
                <button type="button" class="filter-pill" data-profile-filter="always-on">Always-On</button>
                <button type="button" class="filter-pill" data-profile-filter="on-demand">On-Demand</button>
                <button type="button" class="filter-pill" data-profile-filter="memories">Personal Lessons</button>
                <button type="button" class="filter-pill" data-profile-filter="paused">Paused</button>
                <button type="button" class="filter-pill" data-profile-filter="archived">Archived</button>
              </div>
              <input id="profile-search-input" type="text" class="search-input" style="max-width: 260px;" placeholder="Filter habits or workflows..." autocomplete="off" />
              <span id="profile-count-label" class="view-count-badge">0 items</span>
            </div>
            <div id="profile-items-list"></div>
            <div id="profile-empty-state" class="empty-state" style="display: none;">No personal habits or workflows match this filter yet.</div>
          </div>
        </div>
      </section>`;
}

export const PROFILE_CLIENT_SCRIPT = `
  var profileFilterState = {
    tab: 'all',
    search: ''
  };
  var editingProfilePrefId = null;
  var editingProfilePrefTier = 'GLOBAL';
  var editingProfilePrefEnabled = true;
  var editingProfilePrefReviewStatus = 'approved';

  function getUserProfileData() {
    if (snapshot && snapshot.userProfile) return snapshot.userProfile;
    return {
      globalRoot: '',
      preferences: Array.isArray(snapshot && snapshot.preferences) ? snapshot.preferences : [],
      personalMemories: [],
      archivedPreferences: [],
      totalTokens: 0,
      maxTokens: 800,
      menuTokens: 0,
      maxMenuTokens: 250,
      renderedCard: '',
      renderedDirectoryMenu: '',
      syncedHosts: [],
      history: []
    };
  }

  function formatProfileCategory(cat) {
    var dict = i18n[lang] || i18n.en;
    var c = String(cat || '').toLowerCase();
    if (c === 'style') return dict.catStyle;
    if (c === 'formatting') return dict.catFormatting;
    if (c === 'communication') return dict.catCommunication;
    if (c === 'workflow') return dict.catWorkflow;
    if (c === 'requirement') return dict.catRequirement;
    if (c === 'knowledge') return dict.catKnowledge;
    return String(cat || '').toUpperCase();
  }

  function formatProfileHistoryAction(act) {
    var dict = i18n[lang] || i18n.en;
    var a = String(act || '').toLowerCase();
    if (a === 'add') return dict.profileHistAdd;
    if (a === 'update') return dict.profileHistUpdate;
    if (a === 'archive' || a === 'archived') return dict.profileHistArchive;
    if (a === 'undo') return dict.profileHistUndo;
    if (a === 'paused') return dict.profileHistPaused;
    if (a === 'saved') return dict.profileHistSaved;
    return act || '';
  }

  function renderProfileStudio() {
    var dict = i18n[lang] || i18n.en;
    var up = getUserProfileData();
    var allPrefs = Array.isArray(up.preferences) ? up.preferences.slice() : [];
    if (Array.isArray(snapshot && snapshot.preferences)) {
      snapshot.preferences.forEach(function(p) {
        if (!p || !p.id) return;
        var pTier = p.tier || 'LOCAL';
        var exists = allPrefs.some(function(x) {
          return x && x.id === p.id && (x.tier || 'GLOBAL') === pTier;
        });
        if (!exists) allPrefs.push(p);
      });
    }
    var personalMems = Array.isArray(up.personalMemories) ? up.personalMemories : [];
    var archivedPrefs = [];
    if (Array.isArray(up.archivedPreferences)) {
      archivedPrefs = archivedPrefs.concat(up.archivedPreferences);
    }
    if (Array.isArray(snapshot && snapshot.archived)) {
      snapshot.archived.forEach(function(a) {
        if (a && (a.kind === 'preference' || a.kind === 'preferences')) {
          var dup = archivedPrefs.some(function(x) { return x && x.id === a.id; });
          if (!dup) archivedPrefs.push(a);
        }
      });
    }

    var badgeCountProfile = el('badge-count-profile');
    if (badgeCountProfile) {
      badgeCountProfile.textContent = String(allPrefs.length + personalMems.length);
    }

    // 1. Always-On Card gauge + preview
    var totalTok = Number(up.totalTokens || 0);
    var maxTok = Number(up.maxTokens || 800) || 800;
    var cardPct = Math.min(100, Math.round((totalTok / maxTok) * 100));
    var cardTokEl = el('profile-card-tokens');
    var cardBarEl = el('profile-card-bar');
    var cardPreEl = el('profile-card-preview');
    if (cardTokEl) cardTokEl.textContent = totalTok + ' / ' + maxTok + ' tok';
    if (cardBarEl) {
      cardBarEl.style.width = cardPct + '%';
      cardBarEl.classList.remove('bar-warn', 'bar-danger');
      if (totalTok > maxTok) cardBarEl.classList.add('bar-danger');
      else if (cardPct >= 80) cardBarEl.classList.add('bar-warn');
    }
    if (cardPreEl) {
      cardPreEl.textContent = (up.renderedCard && up.renderedCard.trim()) ? up.renderedCard : dict.profileNoCardPreview;
    }

    // 2. Task Directory Menu gauge + preview
    var menuTok = Number(up.menuTokens || 0);
    var maxMenuTok = Number(up.maxMenuTokens || 250) || 250;
    var menuPct = Math.min(100, Math.round((menuTok / maxMenuTok) * 100));
    var menuTokEl = el('profile-menu-tokens');
    var menuBarEl = el('profile-menu-bar');
    var menuPreEl = el('profile-menu-preview');
    if (menuTokEl) menuTokEl.textContent = menuTok + ' / ' + maxMenuTok + ' tok';
    if (menuBarEl) {
      menuBarEl.style.width = menuPct + '%';
      menuBarEl.classList.remove('bar-warn', 'bar-danger');
      if (menuTok > maxMenuTok) menuBarEl.classList.add('bar-danger');
      else if (menuPct >= 80) menuBarEl.classList.add('bar-warn');
    }
    if (menuPreEl) {
      menuPreEl.textContent = (up.renderedDirectoryMenu && up.renderedDirectoryMenu.trim()) ? up.renderedDirectoryMenu : dict.profileNoMenuPreview;
    }

    // 3. Desktop Host Sync badges
    var hosts = Array.isArray(up.syncedHosts) ? up.syncedHosts : [];
    var hasDriftedHost = hosts.some(function(h) { return h && !h.synced; });
    if (el('btn-profile-add')) el('btn-profile-add').style.display = isExport ? 'none' : '';
    if (el('btn-profile-import')) el('btn-profile-import').style.display = isExport ? 'none' : '';
    if (el('btn-profile-sync')) el('btn-profile-sync').style.display = (!isExport && hasDriftedHost) ? '' : 'none';
    var hostCountEl = el('profile-hosts-count');
    var hostBadgesEl = el('profile-host-badges');
    if (hostCountEl) {
      var syncedCnt = hosts.filter(function(h) { return h && h.synced; }).length;
      hostCountEl.textContent = syncedCnt + ' / ' + hosts.length;
    }
    if (hostBadgesEl) {
      hostBadgesEl.innerHTML = '';
      if (hosts.length === 0) {
        var emptyHost = document.createElement('span');
        emptyHost.className = 'mono-dim';
        emptyHost.textContent = dict.profileNoHosts;
        hostBadgesEl.appendChild(emptyHost);
      } else {
        hosts.forEach(function(h) {
          var badge = document.createElement('span');
          badge.className = 'host-sync-badge';
          badge.title = h.path || h.name || '';
          var dot = document.createElement('span');
          dot.className = 'dot ' + (h.synced ? 'dot-ok' : 'dot-warn');
          var lbl = document.createElement('span');
          lbl.textContent = (h.name || h.id || 'Host') + ' · ' + (h.synced ? dict.profileHostSynced : dict.profileHostPending);
          badge.appendChild(dot);
          badge.appendChild(lbl);
          hostBadgesEl.appendChild(badge);
        });
      }
    }

    // 4. Recent Changes + 1-Click Undo (hide when empty)
    var historyList = Array.isArray(up.history) ? up.history : [];
    var historyBar = el('profile-history-bar');
    if (historyBar) {
      historyBar.style.display = historyList.length > 0 ? 'flex' : 'none';
    }
    var historyEl = el('profile-history-list');
    if (historyEl) {
      historyEl.innerHTML = '';
      if (historyList.length > 0) {
        historyList.slice(0, 8).forEach(function(entry) {
          var undoId = entry.id || entry.preference_id || entry.target_id || '';
          var chip = document.createElement('div');
          chip.className = 'profile-history-chip';
          var label = document.createElement('span');
          var actLbl = formatProfileHistoryAction(entry.action);
          label.textContent = (actLbl ? actLbl + ' · ' : '') + (entry.title || undoId);
          chip.appendChild(label);
          if (entry.undoable === true && !isExport) {
            var undoBtn = document.createElement('button');
            undoBtn.type = 'button';
            undoBtn.className = 'btn-action';
            undoBtn.textContent = dict.profileUndoBtn;
            undoBtn.setAttribute('data-undo-id', undoId);
            undoBtn.addEventListener('click', function() {
              handleUndoProfileChange(undoId, undoBtn);
            });
            chip.appendChild(undoBtn);
          }
          historyEl.appendChild(chip);
        });
      }
    }

    // 5. Filtered list of Preferences & Personal Memories
    var listEl = el('profile-items-list');
    var emptyEl = el('profile-empty-state');
    var countEl = el('profile-count-label');
    if (!listEl) return;

    var tab = profileFilterState.tab;
    var q = (profileFilterState.search || '').trim().toLowerCase();

    var rows = [];
    if (tab === 'archived') {
      archivedPrefs.forEach(function(item) {
        rows.push({ kind: 'preferences', rawKind: 'preference', item: item, archived: true });
      });
    } else if (tab === 'memories') {
      personalMems.forEach(function(item) {
        rows.push({ kind: 'memories', rawKind: 'memory', item: item, archived: false });
      });
    } else {
      allPrefs.forEach(function(item) {
        rows.push({ kind: 'preferences', rawKind: 'preference', item: item, archived: false });
      });
      if (tab === 'all') {
        personalMems.forEach(function(item) {
          rows.push({ kind: 'memories', rawKind: 'memory', item: item, archived: false });
        });
      }
    }

    var filtered = rows.filter(function(r) {
      var it = r.item || {};
      if (!r.archived && r.rawKind === 'preference') {
        if (tab === 'always-on' && it.always_on === false) return false;
        if (tab === 'on-demand' && it.always_on !== false) return false;
        if (tab === 'paused' && it.enabled !== false) return false;
      } else if (!r.archived && r.rawKind === 'memory') {
        if (tab === 'paused' && it.enabled !== false) return false;
      }
      if (q) {
        var hay = ((it.id || '') + ' ' + (it.title || '') + ' ' + (it.l0_summary || '') + ' ' + (it.category || '') + ' ' + (Array.isArray(it.tags) ? it.tags.join(' ') : '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (countEl) {
      countEl.textContent = filtered.length + ' ' + dict.itemsCountSuffix;
    }

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    filtered.forEach(function(r) {
      var it = r.item || {};
      var row = document.createElement('div');
      row.className = 'profile-item-row row-interactive' + (it.enabled === false ? ' row-paused' : '');
      row.tabIndex = 0;

      var main = document.createElement('div');
      main.className = 'profile-item-main';

      var top = document.createElement('div');
      top.className = 'profile-item-top';

      var kindBadge = document.createElement('span');
      kindBadge.className = 'badge badge-kind-' + r.rawKind;
      kindBadge.textContent = formatKind(r.rawKind);
      top.appendChild(kindBadge);

      if (r.rawKind === 'preference' && !r.archived) {
        var modeBadge = document.createElement('span');
        modeBadge.className = 'badge ' + (it.always_on !== false ? 'badge-tier-core' : 'badge-tier-scoped');
        modeBadge.textContent = it.always_on !== false ? dict.profileModeAlwaysOn : dict.profileModeOnDemand;
        top.appendChild(modeBadge);
      }
      if (it.tier) {
        var tierBadge = document.createElement('span');
        tierBadge.className = 'badge badge-tier-scoped';
        tierBadge.textContent = it.tier === 'LOCAL' ? dict.tierLocal : dict.tierGlobal;
        top.appendChild(tierBadge);
      }
      if (it.category) {
        var catBadge = document.createElement('span');
        catBadge.className = 'badge badge-tier-scoped';
        catBadge.textContent = formatProfileCategory(it.category);
        top.appendChild(catBadge);
      }
      if (it.review_status === 'pending') {
        var pendBadge = document.createElement('span');
        pendBadge.className = 'badge badge-pending';
        pendBadge.textContent = dict.badgePending;
        top.appendChild(pendBadge);
      }
      if (it.enabled === false && !r.archived) {
        var pauseBadge = document.createElement('span');
        pauseBadge.className = 'badge badge-paused';
        pauseBadge.textContent = dict.badgePaused;
        top.appendChild(pauseBadge);
      }

      var titleSpan = document.createElement('span');
      titleSpan.className = 'profile-item-title';
      titleSpan.textContent = it.title || it.id || '';
      top.appendChild(titleSpan);

      var idSpan = document.createElement('span');
      idSpan.className = 'mono-dim';
      idSpan.textContent = (it.id || '') + ' · ' + formatCompactTok(it.tokens || 0);
      top.appendChild(idSpan);

      var sub = document.createElement('div');
      sub.className = 'profile-item-sub';
      sub.textContent = it.l0_summary || it.symptom || '';

      main.appendChild(top);
      main.appendChild(sub);
      row.appendChild(main);

      if (!isExport) {
        var actions = document.createElement('div');
        actions.className = 'action-group';
        var itemTier = it.tier || 'GLOBAL';

        if (r.archived) {
          var restBtn = document.createElement('button');
          restBtn.type = 'button';
          restBtn.className = 'btn-action';
          restBtn.textContent = dict.restore;
          restBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            runWithButtonLock(restBtn, dict.savingLabel, function() {
              return callKernelAction('restore-item', { kind: r.rawKind, id: it.id, tier: itemTier }).then(function(res) {
                if (res && res.ok) {
                  if (res.snapshot) snapshot = res.snapshot;
                  rerenderAllViews();
                } else if (!res || !res.offlineExport) {
                  showActionError(res, dict.errRestoreFailed);
                }
              });
            });
          });
          actions.appendChild(restBtn);
        } else {
          if (it.review_status === 'pending') {
            var appBtn = document.createElement('button');
            appBtn.type = 'button';
            appBtn.className = 'btn-action';
            appBtn.style.color = 'var(--status-ok)';
            appBtn.style.borderColor = 'var(--status-ok-border)';
            appBtn.textContent = dict.approve;
            appBtn.addEventListener('click', function(ev) {
              ev.stopPropagation();
              runWithButtonLock(appBtn, dict.savingLabel, function() {
                return callKernelAction('approve-item', { kind: r.rawKind, id: it.id, tier: itemTier }).then(function(res) {
                  if (res && res.ok) {
                    if (res.snapshot) snapshot = res.snapshot;
                    rerenderAllViews();
                  } else if (!res || !res.offlineExport) {
                    showActionError(res, dict.errApproveFailed);
                  }
                });
              });
            });
            actions.appendChild(appBtn);
          }

          if (r.rawKind === 'preference') {
            var modeBtn = document.createElement('button');
            modeBtn.type = 'button';
            modeBtn.className = 'btn-action';
            modeBtn.textContent = it.always_on !== false ? dict.profileToggleToOnDemand : dict.profileToggleToAlwaysOn;
            modeBtn.addEventListener('click', function(ev) {
              ev.stopPropagation();
              var nextAlwaysOn = it.always_on === false;
              runWithButtonLock(modeBtn, dict.savingLabel, function() {
                return callKernelAction('create-preference', {
                  id: it.id,
                  supersedes_id: it.id,
                  tier: itemTier,
                  title: it.title || it.id,
                  l0_summary: it.l0_summary || it.title || it.id,
                  category: it.category || 'style',
                  always_on: nextAlwaysOn,
                  trigger_cue: it.trigger_cue || undefined,
                  tags: Array.isArray(it.tags) ? it.tags : [],
                  content: it.content || it.l0_summary || it.title || it.id,
                  enabled: it.enabled !== false,
                  review_status: it.review_status || 'approved'
                }).then(function(res) {
                  var d = i18n[lang] || i18n.en;
                  if (res && res.ok) {
                    if (res.snapshot) snapshot = res.snapshot;
                    rerenderAllViews();
                    showToast('success', d.profileModeUpdatedToast.replace('{id}', it.id), 8000, {
                      label: d.undoActionLabel,
                      run: function() {
                        handleUndoProfileChange(it.id, null, itemTier);
                      }
                    });
                    if (res.data && Array.isArray(res.data.warnings) && res.data.warnings.length > 0) {
                      showToast('warn', res.data.warnings[0], 6000);
                    }
                  } else if (!res || !res.offlineExport) {
                    showActionError(res, d.profileCreateFailedToast, { id: it.id, tier: itemTier, item: it });
                  }
                });
              });
            });
            actions.appendChild(modeBtn);

            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn-action';
            editBtn.textContent = dict.edit;
            editBtn.addEventListener('click', function(ev) {
              ev.stopPropagation();
              openProfileEditorForItem(it);
            });
            actions.appendChild(editBtn);
          }

          var pauseBtn = document.createElement('button');
          pauseBtn.type = 'button';
          pauseBtn.className = 'btn-action';
          pauseBtn.textContent = it.enabled === false ? dict.resumeItem : dict.pauseItem;
          pauseBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var nextEnabled = it.enabled === false;
            runWithButtonLock(pauseBtn, dict.savingLabel, function() {
              return callKernelAction('toggle-enabled', {
                kind: r.rawKind,
                id: it.id,
                tier: itemTier,
                enabled: nextEnabled
              }).then(function(res) {
                var d = i18n[lang] || i18n.en;
                if (res && res.ok) {
                  if (res.snapshot) snapshot = res.snapshot;
                  rerenderAllViews();
                  var pMsg = (nextEnabled ? d.resumedToast : d.pausedToast).replace('{id}', it.id);
                  if (!nextEnabled) {
                    showToast('success', pMsg, 8000, {
                      label: d.undoActionLabel,
                      run: function() {
                        callKernelAction('toggle-enabled', { kind: r.rawKind, id: it.id, tier: itemTier, enabled: true }).then(function(r2) {
                          if (r2 && r2.ok) {
                            if (r2.snapshot) snapshot = r2.snapshot;
                            rerenderAllViews();
                            showToast('success', (i18n[lang] || i18n.en).resumedToast.replace('{id}', it.id));
                          }
                        });
                      }
                    });
                  } else {
                    showToast('success', pMsg);
                  }
                } else if (!res || !res.offlineExport) {
                  showActionError(res, d.errToggleFailed, { id: it.id, tier: itemTier, item: it });
                }
              });
            });
          });
          actions.appendChild(pauseBtn);
        }
        row.appendChild(actions);
      }

      row.addEventListener('click', function() {
        if (!r.archived && typeof selectCapability === 'function') {
          selectCapability(r.kind, it);
        }
      });

      listEl.appendChild(row);
    });
  }

  function openProfileEditorForItem(item) {
    var dict = i18n[lang] || i18n.en;
    var panel = el('profile-editor-panel');
    var importPanel = el('profile-import-panel');
    if (importPanel) importPanel.classList.remove('open');
    if (!panel) return;

    editingProfilePrefId = item && item.id ? item.id : null;
    editingProfilePrefTier = (item && item.tier) ? item.tier : 'GLOBAL';
    editingProfilePrefEnabled = (item && item.enabled === false) ? false : true;
    editingProfilePrefReviewStatus = (item && item.review_status === 'pending') ? 'pending' : 'approved';
    var heading = el('profile-editor-heading');
    if (heading) heading.textContent = editingProfilePrefId ? dict.profileFormTitleEdit : dict.profileFormTitleNew;

    if (el('profile-inp-title')) el('profile-inp-title').value = item ? (item.title || '') : '';
    if (el('profile-inp-l0')) el('profile-inp-l0').value = item ? (item.l0_summary || '') : '';
    if (el('profile-inp-category')) el('profile-inp-category').value = item && item.category ? item.category : 'style';
    if (el('profile-inp-always-on')) el('profile-inp-always-on').value = item && item.always_on === false ? 'false' : 'true';
    if (el('profile-inp-tags')) el('profile-inp-tags').value = item && Array.isArray(item.tags) ? item.tags.join(', ') : '';
    if (el('profile-inp-content')) el('profile-inp-content').value = item ? (item.content || '') : '';
    var moreDetails = el('profile-more-options');
    if (moreDetails) moreDetails.open = Boolean(item);
    panel.classList.add('open');
    if (typeof panel.scrollIntoView === 'function') {
      try { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
    }
    var inpContent = el('profile-inp-content');
    if (inpContent && typeof inpContent.focus === 'function') {
      try { inpContent.focus(); } catch (e) {}
    }
  }

  function handleUndoProfileChange(targetId, btnEl, itemTier) {
    var dict = i18n[lang] || i18n.en;
    runWithButtonLock(btnEl, dict.savingLabel, function() {
      return callKernelAction('undo-preference', { id: targetId || undefined, tier: itemTier || 'GLOBAL' }).then(function(res) {
        if (res && res.ok) {
          if (res.snapshot) snapshot = res.snapshot;
          rerenderAllViews();
          showToast('success', dict.profileUndoneToast);
          if (res.data && Array.isArray(res.data.warnings) && res.data.warnings.length > 0) {
            showToast('warn', res.data.warnings[0], 6000);
          }
        } else if (!res || !res.offlineExport) {
          showActionError(res, dict.profileUndoFailedToast);
        }
      });
    });
  }

  function initProfileStudioEvents() {
    var addBtn = el('btn-profile-add');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        openProfileEditorForItem(null);
      });
    }

    var cancelBtn = el('btn-profile-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        editingProfilePrefId = null;
        editingProfilePrefTier = 'GLOBAL';
        editingProfilePrefEnabled = true;
        editingProfilePrefReviewStatus = 'approved';
        if (el('profile-editor-panel')) el('profile-editor-panel').classList.remove('open');
      });
    }

    var saveBtn = el('btn-profile-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        var dict = i18n[lang] || i18n.en;
        var content = el('profile-inp-content') ? el('profile-inp-content').value.trim() : '';
        var rawTitle = el('profile-inp-title') ? el('profile-inp-title').value.trim() : '';
        var rawL0 = el('profile-inp-l0') ? el('profile-inp-l0').value.trim() : '';
        var firstLine = content.split(/\\r?\\n/)[0].trim();
        var title = rawTitle || firstLine.slice(0, 60);
        var l0 = rawL0 || firstLine.slice(0, 120);
        var category = el('profile-inp-category') ? el('profile-inp-category').value : 'style';
        var alwaysOn = el('profile-inp-always-on') ? el('profile-inp-always-on').value !== 'false' : true;
        var tagsRaw = el('profile-inp-tags') ? el('profile-inp-tags').value : '';
        var tags = tagsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

        var payload = {
          tier: editingProfilePrefId ? editingProfilePrefTier : 'GLOBAL',
          title: title,
          l0_summary: l0,
          category: category,
          always_on: alwaysOn,
          tags: tags,
          content: content
        };
        if (editingProfilePrefId) {
          payload.id = editingProfilePrefId;
          payload.supersedes_id = editingProfilePrefId;
          payload.enabled = editingProfilePrefEnabled;
          payload.review_status = editingProfilePrefReviewStatus;
        }
        runWithButtonLock(saveBtn, dict.savingLabel, function() {
          return callKernelAction('create-preference', payload).then(function(res) {
            if (res && res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              editingProfilePrefId = null;
              editingProfilePrefTier = 'GLOBAL';
              editingProfilePrefEnabled = true;
              editingProfilePrefReviewStatus = 'approved';
              if (el('profile-editor-panel')) el('profile-editor-panel').classList.remove('open');
              rerenderAllViews();
              var createdId = (res.data && res.data.id) ? res.data.id : (title || 'preference');
              showToast('success', dict.profileCreatedToast.replace('{id}', createdId));
              if (res.data && Array.isArray(res.data.warnings) && res.data.warnings.length > 0) {
                showToast('warn', res.data.warnings[0], 6000);
              }
            } else if (!res || !res.offlineExport) {
              showActionError(res, dict.profileCreateFailedToast, {
                id: editingProfilePrefId || undefined,
                tier: payload.tier,
                makeOnDemandCb: function() {
                  if (el('profile-inp-always-on')) el('profile-inp-always-on').value = 'false';
                  saveBtn.click();
                }
              });
            }
          });
        });
      });
    }

    var importToggleBtn = el('btn-profile-import');
    if (importToggleBtn) {
      importToggleBtn.addEventListener('click', function() {
        if (el('profile-editor-panel')) el('profile-editor-panel').classList.remove('open');
        if (el('profile-import-panel')) el('profile-import-panel').classList.toggle('open');
      });
    }

    var importCancelBtn = el('btn-profile-import-cancel');
    if (importCancelBtn) {
      importCancelBtn.addEventListener('click', function() {
        if (el('profile-import-panel')) el('profile-import-panel').classList.remove('open');
      });
    }

    var importRunBtn = el('btn-profile-import-run');
    if (importRunBtn) {
      importRunBtn.addEventListener('click', function() {
        var dict = i18n[lang] || i18n.en;
        var md = el('profile-import-textarea') ? el('profile-import-textarea').value : '';
        var modeSelVal = el('profile-import-always-on') ? el('profile-import-always-on').value : 'auto';
        var importPayload = {
          markdown: md,
          mode: modeSelVal,
          tier: 'GLOBAL'
        };
        if (modeSelVal === 'always-on') importPayload.always_on = true;
        else if (modeSelVal === 'on-demand') importPayload.always_on = false;
        runWithButtonLock(importRunBtn, dict.savingLabel, function() {
          return callKernelAction('import-profile-markdown', importPayload).then(function(res) {
            if (res && res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              var d = res.data || {};
              var msg = dict.profileImportedToast
                .replace('{ok}', String(d.importedCount || 0))
                .replace('{skip}', String(d.rejectedCount || 0));
              var detailSuffix = (Array.isArray(d.rejected) && d.rejected.length > 0 && d.rejected[0].message)
                ? (' — ' + d.rejected[0].message)
                : '';
              var resEl = el('profile-import-result');
              if (resEl) {
                resEl.style.display = 'block';
                resEl.textContent = msg + detailSuffix;
              }
              rerenderAllViews();
              showToast('success', msg);
              if (Array.isArray(d.warnings) && d.warnings.length > 0) {
                showToast('warn', d.warnings[0], 6000);
              }
            } else if (!res || !res.offlineExport) {
              showActionError(res, dict.profileImportFailedToast);
            }
          });
        });
      });
    }

    var syncBtn = el('btn-profile-sync');
    if (syncBtn) {
      syncBtn.addEventListener('click', function() {
        var dict = i18n[lang] || i18n.en;
        runWithButtonLock(syncBtn, dict.savingLabel, function() {
          return callKernelAction('sync-profile', {}).then(function(res) {
            if (res && res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              rerenderAllViews();
              var targets = (res.data && Array.isArray(res.data.updatedTargets)) ? res.data.updatedTargets.length : 0;
              showToast('success', dict.profileSyncedToast.replace('{n}', String(targets)));
              if (res.data && Array.isArray(res.data.warnings) && res.data.warnings.length > 0) {
                showToast('warn', res.data.warnings[0], 6000);
              }
            } else if (!res || !res.offlineExport) {
              showActionError(res, dict.profileSyncFailedToast);
            }
          });
        });
      });
    }

    var pillsWrap = el('profile-filter-pills');
    if (pillsWrap) {
      pillsWrap.querySelectorAll('.filter-pill').forEach(function(btn) {
        btn.addEventListener('click', function() {
          pillsWrap.querySelectorAll('.filter-pill').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          profileFilterState.tab = btn.getAttribute('data-profile-filter') || 'all';
          renderProfileStudio();
        });
      });
    }

    var searchInp = el('profile-search-input');
    if (searchInp) {
      searchInp.addEventListener('input', function() {
        profileFilterState.search = searchInp.value || '';
        renderProfileStudio();
      });
    }
  }
`;
