import { renderI18nVarJs } from './i18n.js';
import { CAPABILITIES_CLIENT_SCRIPT } from './components-capabilities.js';
import { PROFILE_CLIENT_SCRIPT } from './components-profile.js';

export interface ClientScriptRenderOptions {
  token: string;
  isExport: boolean;
  anon: boolean;
}

export function renderClientScript(snapshot: any, options: ClientScriptRenderOptions): string {
  const { token, isExport, anon } = options;
  const safeSnapshotJson = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/=/g, '\\u003d');

  return `
(function() {
  var snapshot = ${safeSnapshotJson};
  var token = ${JSON.stringify(token).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
  var isExport = ${isExport ? 'true' : 'false'};
  var isAnon = ${anon ? 'true' : 'false'};

  // UI State
  var currentView = 'capabilities';
  var activeCapsKind = 'all';
  var activeCapsStatus = 'all';
  var capsSearchQuery = '';
  var hotspotsSearchQuery = '';
  var capsSortByTokens = false;
  var healthDiagExpanded = false;
  var activeGkFilter = 'all';
  var selectedCapability = null; // { kind: string, item: any }
  var inspectorMode = 'preview'; // 'preview' | 'edit'
  var editorDirty = false;
  var editorOriginalText = '';
  var editorPendingBgUpdate = false;
  var sseOffline = false;
  var activeEventSource = null;
  var sseReconnectAttempt = 0;
  var sseReconnectTimer = null;
  var lastFocusedBeforeModal = null;
  var lang = 'en';
  try {
    var savedLang = window.localStorage ? window.localStorage.getItem('evo_ui_lang') : null;
    if (savedLang === 'zh' || savedLang === 'en') {
      lang = savedLang;
    } else if (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().indexOf('zh') === 0) {
      lang = 'zh';
    }
  } catch (e) {}

  var platformStr = (typeof navigator !== 'undefined' && ((navigator.platform || '') + ' ' + (navigator.userAgent || ''))) || '';
  var isWinOrLinux = /Win|Linux/i.test(platformStr);
  var modShortcutLabel = isWinOrLinux ? 'Ctrl+K' : '⌘K';

  var ICONS = {
    bell: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
    trash: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>',
    pause: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>',
    play: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>',
    check: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    bulb: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 22h4"></path><path d="M12 2a7 7 0 0 0-4 12.7c.7.6 1 1.4 1 2.3h6c0-.9.3-1.7 1-2.3A7 7 0 0 0 12 2z"></path></svg>',
    refresh: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
    warn: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    eye: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    edit: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
    pulse: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
    flame: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c2.5 3 5 5.6 5 9.5a5 5 0 0 1-10 0c0-2.4 1.3-4.6 3-6.5.4 1.8 1.6 2.7 2 3 0-2.2-.2-4.1 0-6z"></path></svg>',
    box: '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>'
  };

  // Command Palette State
  var cmdPaletteOpen = false;
  var cmdItems = [];
  var cmdActiveIndex = 0;

  ${renderI18nVarJs()}

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
    var dict = i18n[lang] || i18n.en;
    var s = singularKind(k);
    if (s === 'rule') return dict.kindRule;
    if (s === 'skill') return dict.kindSkill;
    if (s === 'tool') return dict.kindTool;
    if (s === 'memory') return dict.kindMemory;
    if (s === 'preference') return dict.kindPreference;
    return s.toUpperCase();
  }

  function kindSemanticClass(k) {
    var s = singularKind(k);
    if (s === 'rule' || s === 'skill' || s === 'tool' || s === 'memory' || s === 'preference') {
      return 'badge-kind-' + s;
    }
    return '';
  }

  function kindSemanticColor(k) {
    var s = singularKind(k);
    if (s === 'rule') return 'var(--kind-rule)';
    if (s === 'skill') return 'var(--kind-skill)';
    if (s === 'tool') return 'var(--kind-tool)';
    if (s === 'memory') return 'var(--kind-memory)';
    if (s === 'preference') return 'var(--kind-preference)';
    return 'var(--status-ok)';
  }

  function formatCompactTok(n) {
    var num = Number(n || 0);
    if (!isFinite(num) || num <= 0) return '0';
    if (num >= 1000) {
      var kVal = Math.round((num / 1000) * 10) / 10;
      return kVal + 'k';
    }
    return String(Math.round(num));
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

  function matchScopeGlobUi(globPat, filePath) {
    var nlSlash = '/';
    var bSlash = String.fromCharCode(92);
    var g = String(globPat || '').trim().split(bSlash).join(nlSlash).toLowerCase();
    var p = String(filePath || '').trim().split(bSlash).join(nlSlash).toLowerCase();
    while (g.slice(0, 2) === './') g = g.slice(2);
    while (p.slice(0, 2) === './') p = p.slice(2);
    if (!g || g === '*' || g === '**/*') return true;
    var reSrc = '^';
    var gi = 0;
    while (gi < g.length) {
      if (g.slice(gi, gi + 3) === '**/') {
        reSrc += '(?:.+/)?';
        gi += 3;
      } else if (g.slice(gi, gi + 2) === '**') {
        reSrc += '.*';
        gi += 2;
      } else {
        var ch = g.charAt(gi);
        if (ch === '*') {
          reSrc += '[^/]*';
        } else if (ch === '?') {
          reSrc += '[^/]';
        } else if (('.+^' + String.fromCharCode(36) + '{}()|[]/').indexOf(ch) !== -1 || ch === bSlash) {
          reSrc += bSlash + ch;
        } else {
          reSrc += ch;
        }
        gi += 1;
      }
    }
    reSrc += '$';
    try {
      return new RegExp(reSrc).test(p);
    } catch (e) {
      return false;
    }
  }

  function rerenderAllViews() {
    var scrollTargets = [
      el('center-stage'),
      document.querySelector('#view-' + currentView + ' .table-scroll-container'),
      document.querySelector('#view-profile .profile-studio-body'),
      el('gatekeeper-timeline'),
      el('right-inspector'),
      el('inspector-detail')
    ];
    var savedScrolls = scrollTargets.map(function(node) {
      return node ? node.scrollTop : 0;
    });
    var prevActive = document.activeElement;
    var prevFocusId = (prevActive && prevActive.id) ? prevActive.id : '';
    var prevRowId = (prevActive && prevActive.getAttribute) ? (prevActive.getAttribute('data-id') || '') : '';
    var prevRowKind = (prevActive && prevActive.getAttribute) ? (prevActive.getAttribute('data-kind') || '') : '';

    renderTelemetry();
    renderCapabilitiesTable();
    renderProfileStudio();
    renderCardTopology();
    renderHotspotsTable();
    renderGatekeeperStream();
    if (selectedCapability && selectedCapability.item) {
      var selTier = selectedCapability.item.tier;
      var list = snapshot[selectedCapability.kind] || [];
      if (selectedCapability.kind === 'preferences' && snapshot.userProfile && Array.isArray(snapshot.userProfile.preferences)) {
        list = list.concat(snapshot.userProfile.preferences);
      } else if (selectedCapability.kind === 'memories' && snapshot.userProfile && Array.isArray(snapshot.userProfile.personalMemories)) {
        list = list.concat(snapshot.userProfile.personalMemories);
      }
      var foundItem = list.find(function(it) {
        return it && it.id === selectedCapability.item.id && (!selTier || !it.tier || it.tier === selTier);
      });
      if (foundItem) {
        selectedCapability.item = foundItem;
      }
      if (inspectorMode === 'edit' && editorDirty) {
        editorPendingBgUpdate = true;
        if (typeof showInspectorBgUpdateBanner === 'function') {
          showInspectorBgUpdateBanner();
        }
      } else if (inspectorMode !== 'edit') {
        renderInspector();
      }
    }

    scrollTargets.forEach(function(node, idx) {
      if (node) node.scrollTop = savedScrolls[idx];
    });
    if (inspectorMode !== 'edit' && document.activeElement === document.body) {
      var restoredFocus = null;
      if (prevFocusId) {
        restoredFocus = el(prevFocusId);
      } else if (prevRowId && prevRowKind) {
        restoredFocus = document.querySelector('tr.row-interactive[data-kind="' + prevRowKind + '"][data-id="' + prevRowId.replace(/"/g, '') + '"]');
      }
      if (restoredFocus && typeof restoredFocus.focus === 'function') {
        try { restoredFocus.focus({ preventScroll: true }); } catch (e) {}
      }
    }
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
      if (msg && msg.type === 'evoSnapshotPush' && msg.snapshot) {
        snapshot = msg.snapshot;
        rerenderAllViews();
        return;
      }
      if (msg && msg.type === 'evoActionResult' && msg.reqId && pendingActionCallbacks[msg.reqId]) {
        pendingActionCallbacks[msg.reqId](msg);
        delete pendingActionCallbacks[msg.reqId];
      }
    });
  }

  function formatActionName(action) {
    var dict = i18n[lang] || i18n.en;
    var map = {
      'run-tool-test': dict.actRunToolTest,
      'run-tool': dict.actRunToolTest,
      'approve-item': dict.actApproveItem,
      'archive-item': dict.actArchiveItem,
      'restore-item': dict.actRestoreItem,
      'toggle-enabled': dict.actToggleEnabled,
      'toggle-rule-tier': dict.actToggleRuleTier,
      'update-content': dict.actUpdateContent,
      'verify-memory': dict.actVerifyMemory,
      'refresh-memories': dict.actVerifyMemory,
      'rebind-memory-ast': dict.actRebindMemory,
      'open-editor': dict.actOpenEditor,
      'create-preference': dict.actCreatePreference,
      'create-memory': dict.actCreateMemory,
      'sync-profile': dict.actSyncProfile,
      'import-profile-markdown': dict.actImportProfile,
      'undo-preference': dict.actUndoPreference
    };
    return map[action] || action;
  }

  function formatFriendlyError(res, fallbackMsg) {
    var dict = i18n[lang] || i18n.en;
    var code = res && res.code ? String(res.code) : '';
    var rawErr = res && res.error ? String(res.error) : '';
    var details = (res && res.details) || {};
    if (code === 'ERR_PROFILE_BUDGET_EXCEEDED' || code === 'ERR_MENU_BUDGET_EXCEEDED') {
      var maxP = details.maxTokens || (snapshot.userProfile && snapshot.userProfile.maxTokens) || 800;
      return dict.errProfileBudgetFriendly.replace('{max}', String(maxP));
    }
    if (code === 'ERR_BUDGET_EXCEEDED') {
      var curC = details.currentTokens !== undefined ? details.currentTokens : computeActiveCoreTokens();
      var maxC = details.maxTokens || getMaxCoreRuleTokens();
      return dict.errCoreBudgetFriendly.replace('{cur}', String(curC)).replace('{max}', String(maxC));
    }
    if (code === 'ERR_DUPLICATE_CAPABILITY' || code === 'ERR_PREFERENCE_CONFLICT') {
      return dict.errDuplicateFriendly;
    }
    if (code === 'ERR_SECURITY_VIOLATION') {
      return dict.errSecurityFriendly;
    }
    if (
      code === 'ERR_RULE_CONTAINS_DOMAIN_NUMBERS' ||
      code === 'ERR_RULE_COUPLED_TO_IDENTIFIERS' ||
      code === 'ERR_POINT_BUG_CASE_LOG' ||
      code === 'ERR_SCOPE_TOO_NARROW' ||
      code === 'ERR_INSUFFICIENT_TRANSFER_SCENARIOS'
    ) {
      return dict.errDesymbolFriendly;
    }
    if (code === 'ERR_SYNTAX_CHECK' || code === 'ERR_SANDBOX_SELF_TEST') {
      return dict.errSelfTestFriendly;
    }
    if (code === 'ERR_SYMBOL_NOT_FOUND') {
      return dict.errAstGroundingFriendly;
    }
    if (code === 'ERR_SCOPED_BUCKET_FULL') {
      return dict.errScopedBucketFriendly;
    }
    if (code === 'ERR_CONFOUNDED_CAUSATION') {
      return dict.errConfoundedFriendly;
    }
    if (code === 'ERR_INVALID_SCHEMA') {
      return dict.errSchemaFriendly;
    }
    if (code === 'ERR_MISSING_AST_SYMBOL') {
      return dict.errMissingAstSymbolFriendly;
    }
    if (code === 'NOT_FOUND' || /^Not Found:/i.test(rawErr)) {
      return dict.errNotFoundFriendly;
    }
    return rawErr || fallbackMsg || dict.errUnknown;
  }

  function showActionError(res, fallbackMsg, recoveryCtx) {
    if (res && res.offlineExport) return;
    var dict = i18n[lang] || i18n.en;
    var msg = formatFriendlyError(res, fallbackMsg);
    if (res && res.code === 'ERR_PROFILE_BUDGET_EXCEEDED' && recoveryCtx) {
      showToast('error', msg, 8000, {
        label: dict.makeOnDemandBtn,
        run: function() {
          if (typeof recoveryCtx.makeOnDemandCb === 'function') {
            recoveryCtx.makeOnDemandCb();
            return;
          }
          if (recoveryCtx.id) {
            var it = recoveryCtx.item || {};
            callKernelAction('create-preference', {
              id: recoveryCtx.id,
              supersedes_id: recoveryCtx.id,
              tier: recoveryCtx.tier || it.tier || 'GLOBAL',
              title: it.title || recoveryCtx.id,
              l0_summary: it.l0_summary || it.title || recoveryCtx.id,
              category: it.category || 'style',
              always_on: false,
              tags: Array.isArray(it.tags) ? it.tags : [],
              content: it.content || it.l0_summary || it.title || recoveryCtx.id,
              enabled: true,
              review_status: it.review_status || 'approved'
            }).then(function(r2) {
              var d2 = i18n[lang] || i18n.en;
              if (r2 && r2.ok) {
                if (r2.snapshot) snapshot = r2.snapshot;
                rerenderAllViews();
                showToast('success', d2.profileModeUpdatedToast.replace('{id}', recoveryCtx.id));
              } else if (!r2 || !r2.offlineExport) {
                showToast('error', formatFriendlyError(r2, d2.errSaveFailed));
              }
            });
          }
        }
      });
      return;
    }
    showToast('error', msg);
  }

  function runWithButtonLock(btn, busyLabel, fn) {
    if (!btn) return fn();
    var origHtml = btn.innerHTML;
    var wasDisabled = btn.disabled;
    btn.disabled = true;
    if (busyLabel) btn.textContent = busyLabel;
    return Promise.resolve().then(fn).then(function(res) {
      btn.disabled = wasDisabled;
      if (btn.isConnected) btn.innerHTML = origHtml;
      return res;
    }, function(err) {
      btn.disabled = wasDisabled;
      if (btn.isConnected) btn.innerHTML = origHtml;
      throw err;
    });
  }

  function copyToClipboardText(text) {
    var str = String(text || '');
    if (!str) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(str).catch(function() {});
      return;
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {}
  }

  function handleOpenEditorResult(res, displayPath) {
    var dict = i18n[lang] || i18n.en;
    if (res && res.ok) {
      if (res.data && res.data.launched === false) {
        var copyPath = (res.data && res.data.opened) || displayPath;
        copyToClipboardText(copyPath);
        showToast('info', dict.openEditorCopiedToast.replace('{path}', displayPath));
      } else {
        showToast('success', dict.openedInIdeToast.replace('{path}', displayPath));
      }
    } else if (!res || !res.offlineExport) {
      showActionError(res, dict.openFileFailedToast);
    }
  }

  function callKernelAction(action, params) {
    params = params || {};
    var dict = i18n[lang] || i18n.en;
    if (isExport && !vscodeApi) {
      var readOnlyMsg = dict.offlineActionToast.replace('{action}', formatActionName(action));
      showToast('info', readOnlyMsg);
      return Promise.resolve({ ok: false, offlineExport: true, error: readOnlyMsg });
    }

    if (vscodeApi) {
      return new Promise(function(resolve) {
        var reqId = 'act_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        var timer = setTimeout(function() {
          if (pendingActionCallbacks[reqId]) {
            delete pendingActionCallbacks[reqId];
            var curDict = i18n[lang] || i18n.en;
            resolve({ ok: false, error: curDict.errExtTimeout });
          }
        }, 10000);

        pendingActionCallbacks[reqId] = function(msg) {
          clearTimeout(timer);
          if (msg.error) {
            resolve({
              ok: false,
              error: msg.error,
              code: msg.code,
              gate_failed: msg.gate_failed,
              details: msg.details,
              snapshot: msg.snapshot
            });
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
          return {
            ok: false,
            error: data.error || ('HTTP ' + res.status),
            code: data.code,
            gate_failed: data.gate_failed,
            details: data.details,
            snapshot: data.snapshot
          };
        }
        return data;
      });
    })
    .catch(function(err) {
      var curDict = i18n[lang] || i18n.en;
      return { ok: false, error: (err && err.message) || curDict.errNetworkFailed };
    });
  }

  // ==========================================
  // TOAST NOTIFICATION SYSTEM (WITH UNDO SUPPORT)
  // ==========================================
  function showToast(type, message, durationMs, actSpec) {
    var boxEl = el('toast-container');
    if (!boxEl) return;
    var toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.setAttribute('role', 'status');
    var isWarn = type === 'warn' || type === 'warning';
    var icon = type === 'success'
      ? '<span style="color:var(--status-ok);">✓</span>'
      : (type === 'error'
        ? '<span style="color:var(--status-danger);">✕</span>'
        : (isWarn
          ? '<span style="color:var(--status-warn);display:inline-flex;vertical-align:middle;">' + ICONS.warn + '</span>'
          : '<span style="color:var(--status-info);">ℹ</span>'));
    if (isWarn) {
      toast.style.borderColor = 'var(--status-warn-border)';
    }
    var msgSpan = document.createElement('span');
    msgSpan.innerHTML = icon + ' <span style="margin-left:4px;">' + esc(message) + '</span>';
    toast.appendChild(msgSpan);

    if (actSpec && actSpec.label && typeof actSpec.run === 'function') {
      var actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'toast-undo-btn';
      actBtn.textContent = actSpec.label;
      actBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
        if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        actSpec.run();
      });
      toast.appendChild(actBtn);
    }

    boxEl.appendChild(toast);
    var ttl = durationMs || (actSpec ? 8000 : 3500);
    var dismissTimer = null;
    var removeTimer = null;
    function scheduleDismiss(ms) {
      if (dismissTimer) clearTimeout(dismissTimer);
      dismissTimer = setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        removeTimer = setTimeout(function() {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 220);
      }, ms);
    }
    toast.addEventListener('mouseenter', function() {
      if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
      if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    toast.addEventListener('mouseleave', function() {
      scheduleDismiss(Math.min(ttl, 3000));
    });
    scheduleDismiss(ttl);
  }

  function archiveAndOfferUndo(kindPlural, itemId, itemTier) {
    var sKind = singularKind(kindPlural);
    var dict = i18n[lang] || i18n.en;
    var archivePayload = { kind: sKind, id: itemId };
    if (itemTier) archivePayload.tier = itemTier;
    return callKernelAction('archive-item', archivePayload).then(function(res) {
      if (res.ok) {
        if (res.snapshot) snapshot = res.snapshot;
        if (selectedCapability && selectedCapability.item && selectedCapability.item.id === itemId) {
          selectedCapability = null;
        }
        rerenderAllViews();
        if (!selectedCapability) renderInspector();
        showToast('success', (lang === 'zh' ? '已归档 ' : 'Archived ') + itemId, 8000, {
          label: dict.undoArchive,
          run: function() {
            var restorePayload = { kind: sKind, id: itemId };
            if (itemTier) restorePayload.tier = itemTier;
            callKernelAction('restore-item', restorePayload).then(function(rRes) {
              if (rRes.ok) {
                if (rRes.snapshot) snapshot = rRes.snapshot;
                rerenderAllViews();
                showToast('success', (i18n[lang] || i18n.en).restoredToast.replace('{id}', itemId));
              } else if (!rRes.offlineExport) {
                showActionError(rRes, dict.errRestoreFailed);
              }
            });
          }
        });
      } else if (!res.offlineExport) {
        showActionError(res, dict.errArchiveFailed);
      }
      return res;
    });
  }

  // ==========================================
  // VIEW SWITCHER & NAVIGATION
  // ==========================================
  function switchView(viewName) {
    if (viewName !== currentView && inspectorMode === 'edit' && editorDirty && typeof confirmDiscardDraft === 'function') {
      confirmDiscardDraft(function() {
        switchView(viewName);
      });
      return;
    }
    currentView = viewName;
    var btnList = document.querySelectorAll('.nav-item');
    var targetBtn = null;
    btnList.forEach(function(b) {
      if (b.getAttribute('data-view') === viewName) {
        b.classList.add('active');
        b.setAttribute('aria-current', 'page');
        targetBtn = b;
      } else {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
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
    } else if (viewName === 'profile') {
      renderProfileStudio();
    }
  }

${CAPABILITIES_CLIENT_SCRIPT}

${PROFILE_CLIENT_SCRIPT}

  // ==========================================
  // COMMAND PALETTE (CMD/CTRL + K)
  // ==========================================
  function openCommandPalette() {
    lastFocusedBeforeModal = document.activeElement;
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
    var restoreEl = (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function')
      ? lastFocusedBeforeModal
      : el('cmd-palette-trigger');
    lastFocusedBeforeModal = null;
    if (restoreEl && typeof restoreEl.focus === 'function') {
      try { restoreEl.focus(); } catch (e) {}
    }
  }

  function updateCommandPaletteResults(q) {
    q = (q || '').toLowerCase().trim();
    cmdItems = [];
    var dict = i18n[lang] || i18n.en;
    var listBoxEl = el('cmd-palette-list');
    if (!listBoxEl) return;
    listBoxEl.innerHTML = '';

    // Group 1: Capabilities
    var kinds = ['rules', 'skills', 'tools', 'memories', 'preferences'];
    var capMatches = [];
    kinds.forEach(function(k) {
      var arr = snapshot[k] || (k === 'preferences' && snapshot.userProfile && snapshot.userProfile.preferences) || [];
      arr.forEach(function(it) {
        var title = String(it.title || it.name || it.id || '');
        var sum = String(it.l0_summary || it.description || '');
        if (!q || title.toLowerCase().indexOf(q) !== -1 || sum.toLowerCase().indexOf(q) !== -1 || (it.id || '').toLowerCase().indexOf(q) !== -1) {
          capMatches.push({ kind: k, item: it, title: title, id: it.id });
        }
      });
    });

    if (capMatches.length > 0) {
      var grpHdr = document.createElement('div');
      grpHdr.className = 'cmd-group-title';
      grpHdr.textContent = dict.cmdGroupCaps;
      listBoxEl.appendChild(grpHdr);

      capMatches.slice(0, 8).forEach(function(c) {
        var row = document.createElement('div');
        row.className = 'cmd-item';
        row.setAttribute('role', 'option');
        var kLabel = formatKind(c.kind);
        row.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;flex:1;">' +
            '<span class="badge-kind ' + kindSemanticClass(c.kind) + '" style="flex-shrink:0;">' + esc(kLabel) + '</span>' +
            '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(c.title || c.id) + '</span>' +
          '</div>' +
          '<span class="kbd-shortcut" style="flex-shrink:0;">' + esc(c.id) + '</span>';

        var actItem = {
          execute: function() {
            selectCapability(c.kind, c.item);
            closeCommandPalette();
          }
        };
        row.addEventListener('click', actItem.execute);
        listBoxEl.appendChild(row);
        cmdItems.push({ el: row, action: actItem.execute });
      });
    }

    // Group 2: Git Hotspots
    var hsMatches = (snapshot.score && snapshot.score.gitHotspots || []).filter(function(h) {
      return !q || h.filePath.toLowerCase().indexOf(q) !== -1;
    });
    if (hsMatches.length > 0) {
      var grpHdr2 = document.createElement('div');
      grpHdr2.className = 'cmd-group-title';
      grpHdr2.textContent = dict.cmdGroupHotspots;
      listBoxEl.appendChild(grpHdr2);

      hsMatches.slice(0, 5).forEach(function(h) {
        var row = document.createElement('div');
        row.className = 'cmd-item';
        row.setAttribute('role', 'option');
        row.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;flex:1;">' +
            '<span class="badge-status" style="color:var(--status-warn);flex-shrink:0;"><span class="dot dot-warn"></span> ' + esc(dict.cmdHotspotBadge) + '</span>' +
            '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(h.filePath) + '</span>' +
          '</div>' +
          '<span class="kbd-shortcut" style="flex-shrink:0;">f:' + h.fragilityScore + '</span>';

        var actItem = {
          execute: function() {
            callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
              handleOpenEditorResult(res, h.filePath);
            });
            closeCommandPalette();
          }
        };
        row.addEventListener('click', actItem.execute);
        listBoxEl.appendChild(row);
        cmdItems.push({ el: row, action: actItem.execute });
      });
    }

    // Group 3: Global Actions (filter live-only commands out of static read-only HTML exports)
    var globalCmds = [];
    if (!isExport || vscodeApi) {
      globalCmds.push({
        title: dict.cmdVerifyTitle,
        sub: dict.cmdVerifySub,
        run: function() {
          showToast('info', dict.verifyingAst);
          callKernelAction('verify-memory', {}).then(function(res) {
            if (res.ok && res.snapshot) {
              snapshot = res.snapshot;
              rerenderAllViews();
              showToast('success', lang === 'zh' ? '已完成全部代码链接校验' : 'Verified all linked code');
            } else if (!res.offlineExport) {
              showActionError(res, dict.errVerifyFailed);
            }
          });
        }
      });
      globalCmds.push({
        title: dict.cmdExportTitle,
        sub: dict.cmdExportSub,
        run: function() {
          openExportPopover();
        }
      });
    }
    globalCmds = globalCmds.concat([
      {
        title: dict.cmdSwitchCapsTitle,
        sub: dict.cmdSwitchCapsSub,
        run: function() { switchView('capabilities'); }
      },
      {
        title: dict.cmdSwitchProfileTitle,
        sub: dict.cmdSwitchProfileSub,
        run: function() { switchView('profile'); }
      },
      {
        title: dict.cmdSwitchTopoTitle,
        sub: dict.cmdSwitchTopoSub,
        run: function() { switchView('topology'); }
      },
      {
        title: dict.cmdSwitchHsTitle,
        sub: dict.cmdSwitchHsSub,
        run: function() { switchView('hotspots'); }
      },
      {
        title: dict.cmdSwitchGkTitle,
        sub: dict.cmdSwitchGkSub,
        run: function() { switchView('gatekeeper'); }
      },
      {
        title: dict.cmdToggleLangTitle,
        sub: dict.cmdToggleLangSub,
        run: function() {
          lang = lang === 'en' ? 'zh' : 'en';
          try { window.localStorage.setItem('evo_ui_lang', lang); } catch (e) {}
          applyI18n();
        }
      }
    ]);

    var filteredCmds = globalCmds.filter(function(gc) {
      return !q || gc.title.toLowerCase().indexOf(q) !== -1 || gc.sub.toLowerCase().indexOf(q) !== -1;
    });

    if (filteredCmds.length > 0) {
      var grpHdr3 = document.createElement('div');
      grpHdr3.className = 'cmd-group-title';
      grpHdr3.textContent = dict.cmdGroupActions;
      listBoxEl.appendChild(grpHdr3);

      filteredCmds.forEach(function(gc) {
        var row = document.createElement('div');
        row.className = 'cmd-item';
        row.setAttribute('role', 'option');
        row.innerHTML =
          '<div style="min-width:0;overflow:hidden;flex:1;">' +
            '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(gc.title) + '</div>' +
            '<div style="font-size:var(--text-xs);color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(gc.sub) + '</div>' +
          '</div>' +
          '<span class="kbd-shortcut" style="flex-shrink:0;">↵</span>';

        var actItem = {
          execute: function() {
            closeCommandPalette();
            gc.run();
          }
        };
        row.addEventListener('click', actItem.execute);
        listBoxEl.appendChild(row);
        cmdItems.push({ el: row, action: actItem.execute });
      });
    }

    cmdActiveIndex = 0;
    highlightCommandPaletteItem();
  }

  function highlightCommandPaletteItem() {
    cmdItems.forEach(function(it, idx) {
      if (idx === cmdActiveIndex) {
        it.el.classList.add('selected');
        it.el.setAttribute('aria-selected', 'true');
        it.el.scrollIntoView({ block: 'nearest' });
      } else {
        it.el.classList.remove('selected');
        it.el.setAttribute('aria-selected', 'false');
      }
    });
  }

  // ==========================================
  // I18N LOCALIZATION (100% EN/ZH PARITY)
  // ==========================================
  function applyI18n() {
    var dict = i18n[lang] || i18n.en;
    if (document && document.documentElement) {
      document.documentElement.lang = (lang === 'zh' ? 'zh-CN' : 'en');
    }

    if (el('lang-label')) el('lang-label').textContent = lang.toUpperCase();
    if (el('lang-seg-zh')) el('lang-seg-zh').classList.toggle('active', lang === 'zh');
    if (el('lang-seg-en')) el('lang-seg-en').classList.toggle('active', lang === 'en');
    if (el('btn-lang-toggle')) el('btn-lang-toggle').title = dict.langSwitchTitle;

    if (el('topbar-brand-subtitle')) el('topbar-brand-subtitle').textContent = dict.brandSubtitle;
    if (el('cmd-palette-kbd')) el('cmd-palette-kbd').textContent = modShortcutLabel;
    if (el('search-placeholder-text')) {
      el('search-placeholder-text').textContent = dict.searchPlaceholder.replace('{shortcut}', modShortcutLabel);
    }
    updateServerStatusUi(sseOffline);
    if (el('btn-export-label')) el('btn-export-label').textContent = dict.exportBtn;
    if (el('btn-export-html')) el('btn-export-html').title = dict.exportBtnTitle;
    if (el('export-popover-title')) el('export-popover-title').textContent = dict.exportChoiceTitle;
    if (el('export-anon-title')) el('export-anon-title').textContent = dict.exportAnonOpt;
    if (el('export-anon-desc')) el('export-anon-desc').textContent = dict.exportAnonDesc;
    if (el('export-full-title')) el('export-full-title').textContent = dict.exportFullOpt;
    if (el('export-full-desc')) el('export-full-desc').textContent = dict.exportFullDesc;

    if (el('sse-disconnect-msg')) el('sse-disconnect-msg').textContent = dict.sseDisconnectedMsg;
    if (el('btn-sse-reconnect')) el('btn-sse-reconnect').textContent = dict.sseReconnectBtn;
    if (el('export-readonly-msg')) el('export-readonly-msg').textContent = dict.exportReadonlyBanner;
    if (el('bento-health')) el('bento-health').title = dict.bentoHealthTooltip;
    if (el('bento-budget')) el('bento-budget').title = dict.bentoBudgetTooltip;

    // Input Placeholders
    if (el('caps-search-input')) el('caps-search-input').placeholder = dict.capsSearchPlaceholder;
    if (el('mem-search')) el('mem-search').placeholder = dict.hotspotsSearchPlaceholder;
    if (el('cmd-palette-input')) el('cmd-palette-input').placeholder = dict.cmdInputPlaceholder;
    if (el('cmd-palette-modal')) el('cmd-palette-modal').setAttribute('aria-label', dict.cmdModalAriaLabel);

    // Left Rail
    if (el('rail-hdr-views')) el('rail-hdr-views').textContent = dict.viewsHeader;
    if (el('nav-label-caps')) el('nav-label-caps').textContent = dict.viewCaps;
    if (el('nav-label-profile')) el('nav-label-profile').textContent = dict.viewProfile;
    if (el('nav-label-topo')) el('nav-label-topo').textContent = dict.viewTopo;
    if (el('nav-label-hotspots')) el('nav-label-hotspots').textContent = dict.viewHotspots;
    if (el('nav-label-gk')) el('nav-label-gk').textContent = dict.viewGk;

    if (el('rail-hdr-telem')) el('rail-hdr-telem').textContent = dict.telemetryHeader;
    if (el('bento-title-health')) el('bento-title-health').textContent = dict.healthTitle;
    if (el('bento-title-tax')) el('bento-title-tax').textContent = dict.taxTitle;
    if (el('bento-title-budget')) el('bento-title-budget').textContent = dict.budgetTitle;
    if (el('bento-title-treemap')) el('bento-title-treemap').textContent = dict.treemapTitle;
    if (el('bento-title-recall')) el('bento-title-recall').textContent = dict.bentoRecallTitle;

    // Center Stage Headers & Footnotes
    if (el('caps-view-title')) el('caps-view-title').textContent = dict.capsViewTitle;
    if (el('caps-view-sub')) el('caps-view-sub').textContent = dict.capsViewSub;
    if (el('topo-view-title')) el('topo-view-title').textContent = dict.topoTitle;
    if (el('topo-view-sub')) el('topo-view-sub').textContent = dict.topoSub;
    if (el('hotspots-view-title')) el('hotspots-view-title').textContent = dict.hotspotsTitle;
    if (el('hotspots-view-sub')) el('hotspots-view-sub').textContent = dict.hotspotsSub;
    if (el('gk-view-title')) el('gk-view-title').textContent = dict.gkTitle;
    if (el('gk-view-sub')) el('gk-view-sub').textContent = dict.gkSub;
    if (el('topo-ast-footnote')) el('topo-ast-footnote').textContent = dict.astFootnote;

    // Personal Profile Studio labels
    if (el('profile-view-title')) el('profile-view-title').textContent = dict.profileViewTitle;
    if (el('profile-view-sub')) el('profile-view-sub').textContent = dict.profileViewSub;
    if (el('btn-profile-add')) el('btn-profile-add').textContent = dict.profileAddBtn;
    if (el('btn-profile-import')) el('btn-profile-import').textContent = dict.profileImportBtn;
    if (el('btn-profile-sync')) el('btn-profile-sync').textContent = dict.profileSyncBtn;
    if (el('profile-card-title')) el('profile-card-title').textContent = dict.profileCardTitle;
    if (el('profile-menu-title')) el('profile-menu-title').textContent = dict.profileMenuTitle;
    if (el('profile-hosts-title')) el('profile-hosts-title').textContent = dict.profileHostsTitle;
    if (el('profile-history-title')) el('profile-history-title').textContent = dict.profileHistoryTitle;
    if (el('profile-editor-heading')) {
      el('profile-editor-heading').textContent = editingProfilePrefId ? dict.profileFormTitleEdit : dict.profileFormTitleNew;
    }
    if (el('lbl-profile-title')) el('lbl-profile-title').textContent = dict.profileFieldTitle;
    if (el('lbl-profile-category')) el('lbl-profile-category').textContent = dict.profileFieldCategory;
    if (el('lbl-profile-l0')) el('lbl-profile-l0').textContent = dict.profileFieldL0;
    if (el('lbl-profile-mode')) el('lbl-profile-mode').textContent = dict.profileFieldMode;
    if (el('lbl-profile-tags')) el('lbl-profile-tags').textContent = dict.profileFieldTags;
    if (el('lbl-profile-content')) el('lbl-profile-content').textContent = dict.profileFieldContent;
    if (el('profile-more-options-summary')) el('profile-more-options-summary').textContent = dict.profileMoreOptions;
    if (el('profile-inp-title')) el('profile-inp-title').placeholder = lang === 'zh' ? '例如：简洁工程风格' : 'e.g. Concise Engineering Style';
    if (el('profile-inp-l0')) el('profile-inp-l0').placeholder = lang === 'zh' ? '一句话摘要，用于常驻卡片或目录菜单' : '1-line summary shown in Always-On card or Directory Menu';
    if (el('profile-inp-tags')) el('profile-inp-tags').placeholder = lang === 'zh' ? '风格, 简洁, ts' : 'style, concise, ts';
    if (el('profile-inp-content')) el('profile-inp-content').placeholder = lang === 'zh' ? '输入可跨工作区复用的个人习惯或偏好...' : 'Write the reusable cross-workspace instruction...';
    var catSel = el('profile-inp-category');
    if (catSel) {
      var catOpts = {
        style: dict.catStyle,
        formatting: dict.catFormatting,
        communication: dict.catCommunication,
        workflow: dict.catWorkflow,
        requirement: dict.catRequirement,
        knowledge: dict.catKnowledge
      };
      catSel.querySelectorAll('option').forEach(function(o) {
        if (catOpts[o.value]) o.textContent = catOpts[o.value];
      });
    }
    var inpModeSel = el('profile-inp-always-on');
    if (inpModeSel) {
      inpModeSel.querySelectorAll('option').forEach(function(o) {
        o.textContent = o.value === 'false' ? dict.profileModeOnDemand : dict.profileModeAlwaysOn;
      });
    }
    var importModeSel = el('profile-import-always-on');
    if (importModeSel) {
      importModeSel.querySelectorAll('option').forEach(function(o) {
        if (o.value === 'auto') o.textContent = dict.profileImportModeAuto;
        else if (o.value === 'on-demand' || o.value === 'false') o.textContent = dict.profileModeOnDemand;
        else o.textContent = dict.profileModeAlwaysOn;
      });
    }
    if (el('btn-profile-save')) el('btn-profile-save').textContent = dict.profileCreateSubmit;
    if (el('btn-profile-cancel')) el('btn-profile-cancel').textContent = dict.cancel;
    if (el('profile-import-title')) el('profile-import-title').textContent = dict.profileImportTitle;
    if (el('profile-import-sub')) el('profile-import-sub').textContent = dict.profileImportSub;
    if (el('lbl-profile-import-mode')) el('lbl-profile-import-mode').textContent = dict.profileFieldMode;
    if (el('profile-import-textarea')) el('profile-import-textarea').placeholder = dict.profileImportPlaceholder;
    if (el('btn-profile-import-run')) el('btn-profile-import-run').textContent = dict.profileImportSubmit;
    if (el('btn-profile-import-cancel')) el('btn-profile-import-cancel').textContent = dict.cancel;
    if (el('profile-search-input')) el('profile-search-input').placeholder = dict.profileSearchPlaceholder;
    if (el('profile-empty-state')) el('profile-empty-state').textContent = dict.profileEmptyState;
    var pPills = el('profile-filter-pills');
    if (pPills) {
      var pLabels = {
        all: dict.profileFilterAll,
        'always-on': dict.profileFilterAlwaysOn,
        'on-demand': dict.profileFilterOnDemand,
        memories: dict.profileFilterMemories,
        paused: dict.profileFilterPaused,
        archived: dict.profileFilterArchived
      };
      pPills.querySelectorAll('.filter-pill').forEach(function(p) {
        var f = p.getAttribute('data-profile-filter');
        if (f && pLabels[f]) p.textContent = pLabels[f];
      });
    }

    // Table Headers (<th>)
    if (el('th-cap-type')) el('th-cap-type').textContent = dict.thCapType;
    if (el('th-cap-title')) el('th-cap-title').textContent = dict.thCapTitle;
    if (el('th-cap-scope')) el('th-cap-scope').textContent = dict.thCapScope;
    if (el('th-cap-attr')) el('th-cap-attr').textContent = dict.thCapAttr;
    if (el('th-cap-actions')) el('th-cap-actions').textContent = dict.thCapActions;

    if (el('th-hs-path')) el('th-hs-path').textContent = dict.thHsPath;
    if (el('th-hs-frag')) el('th-hs-frag').textContent = dict.thHsFrag;
    if (el('th-hs-commits')) el('th-hs-commits').textContent = dict.thHsCommits;
    if (el('th-hs-mems')) el('th-hs-mems').textContent = dict.thHsMems;
    if (el('th-hs-status')) el('th-hs-status').textContent = dict.thHsStatus;
    if (el('th-hs-action')) el('th-hs-action').textContent = dict.thHsAction;

    // Empty States
    if (el('caps-empty-state-msg')) el('caps-empty-state-msg').textContent = dict.capsEmptyState;
    else if (el('caps-empty-state')) el('caps-empty-state').textContent = dict.capsEmptyState;
    if (el('btn-caps-clear-filters')) el('btn-caps-clear-filters').textContent = dict.clearFiltersBtn;
    if (el('hotspots-empty-state')) el('hotspots-empty-state').textContent = dict.hotspotsEmptyState;

    // Topology Legend (Semantic Kind + Freshness Status)
    var topoLeg = el('topo-legend');
    if (topoLeg) {
      topoLeg.innerHTML =
        '<span class="legend-item"><span class="kind-dot kind-dot-rule"></span> ' + esc(dict.legendRule) + '</span>' +
        '<span class="legend-item"><span class="kind-dot kind-dot-skill"></span> ' + esc(dict.legendSkill) + '</span>' +
        '<span class="legend-item"><span class="kind-dot kind-dot-tool"></span> ' + esc(dict.legendTool) + '</span>' +
        '<span class="legend-item"><span class="kind-dot kind-dot-memory"></span> ' + esc(dict.legendMemory) + '</span>' +
        '<span class="legend-sep">|</span>' +
        '<span class="legend-item"><span class="dot dot-ok"></span> ' + esc(dict.legendVerified) + '</span>' +
        '<span class="legend-item"><span class="dot dot-warn"></span> ' + esc(dict.legendContested) + '</span>' +
        '<span class="legend-item"><span class="dot dot-danger"></span> ' + esc(dict.legendStale) + '</span>' +
        '<span class="legend-hint">' + esc(dict.legendHint) + '</span>';
    }

    // Kind & Status Filter Pills
    var kp = el('caps-kind-pills');
    if (kp) {
      var kindLabels = {
        all: dict.allKinds,
        rules: dict.rules,
        skills: dict.skills,
        tools: dict.tools,
        memories: dict.memories,
        preferences: dict.preferences
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
    var gkp = el('gk-filter-pills');
    if (gkp) {
      var gkLabels = {
        all: dict.gkFilterAll,
        pass: dict.gkFilterPass,
        fail: dict.gkFilterFail
      };
      gkp.querySelectorAll('.filter-pill').forEach(function(p) {
        var gf = p.getAttribute('data-filter');
        if (gf && gkLabels[gf]) p.textContent = gkLabels[gf];
      });
    }

    renderTelemetry();
    renderCapabilitiesTable();
    renderProfileStudio();
    renderHotspotsTable();
    renderGatekeeperStream();
    if (currentView === 'topology') renderCardTopology();
    // P0.7: Preserve dirty inline editor drafts when toggling interface language
    if (selectedCapability && !(inspectorMode === 'edit' && editorDirty)) {
      renderInspector();
    }
    if (cmdPaletteOpen && el('cmd-palette-input')) {
      updateCommandPaletteResults(el('cmd-palette-input').value);
    }
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

  // 1.5 Left Rail & Top Strip Interactive KPI Cards (Health Diagnostics & Core Budget)
  function toggleHealthDiagnostics() {
    var runToggle = function() {
      healthDiagExpanded = !healthDiagExpanded;
      switchView('capabilities');
      renderHealthDiagnosticsBanner();
    };
    if (currentView !== 'capabilities' && inspectorMode === 'edit' && editorDirty && typeof confirmDiscardDraft === 'function') {
      confirmDiscardDraft(runToggle);
      return;
    }
    runToggle();
  }

  var bentoHealth = el('bento-health');
  if (bentoHealth) {
    bentoHealth.style.cursor = 'pointer';
    bentoHealth.tabIndex = 0;
    bentoHealth.setAttribute('role', 'button');
    bentoHealth.addEventListener('click', toggleHealthDiagnostics);
    bentoHealth.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleHealthDiagnostics();
      }
    });
  }

  var kpiHealthBtn = el('kpi-chip-health');
  if (kpiHealthBtn) {
    kpiHealthBtn.addEventListener('click', toggleHealthDiagnostics);
  }

  var bentoBudget = el('bento-budget');
  if (bentoBudget) {
    bentoBudget.style.cursor = 'pointer';
    bentoBudget.tabIndex = 0;
    bentoBudget.setAttribute('role', 'button');
    bentoBudget.addEventListener('click', function() {
      applyQuickFilter('rules', 'core', true);
    });
    bentoBudget.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        applyQuickFilter('rules', 'core', true);
      }
    });
  }

  var kpiBudgetBtn = el('kpi-chip-budget');
  if (kpiBudgetBtn) {
    kpiBudgetBtn.addEventListener('click', function() {
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
        } else if ((activeCapsKind === 'skills' || activeCapsKind === 'tools' || activeCapsKind === 'preferences') && (activeCapsStatus === 'core' || activeCapsStatus === 'scoped' || activeCapsStatus === 'verified' || activeCapsStatus === 'stale')) {
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

  // Hero Quick Habit Form & Clear Filters
  var heroHabitForm = el('hero-habit-form');
  if (heroHabitForm) {
    heroHabitForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var inp = el('hero-habit-input');
      var saveBtn = el('btn-hero-habit-save');
      var text = inp ? inp.value.trim() : '';
      if (!text) return;
      var dict = i18n[lang] || i18n.en;
      runWithButtonLock(saveBtn, dict.savingLabel, function() {
        return callKernelAction('create-preference', {
          tier: 'GLOBAL',
          title: text.slice(0, 60),
          l0_summary: text.slice(0, 120),
          category: 'style',
          always_on: true,
          content: text
        }).then(function(res) {
          var curDict = i18n[lang] || i18n.en;
          if (res && res.ok) {
            if (inp) inp.value = '';
            if (res.snapshot) snapshot = res.snapshot;
            rerenderAllViews();
            var createdId = (res.data && res.data.id) ? res.data.id : text.slice(0, 24);
            showToast('success', curDict.profileCreatedToast.replace('{id}', createdId));
          } else if (!res || !res.offlineExport) {
            showActionError(res, curDict.profileCreateFailedToast, {
              makeOnDemandCb: function() {
                callKernelAction('create-preference', {
                  tier: 'GLOBAL',
                  title: text.slice(0, 60),
                  l0_summary: text.slice(0, 120),
                  category: 'style',
                  always_on: false,
                  content: text
                }).then(function(r2) {
                  if (r2 && r2.ok) {
                    if (inp) inp.value = '';
                    if (r2.snapshot) snapshot = r2.snapshot;
                    rerenderAllViews();
                    var cId = (r2.data && r2.data.id) ? r2.data.id : text.slice(0, 24);
                    showToast('success', curDict.profileCreatedToast.replace('{id}', cId));
                  } else if (!r2 || !r2.offlineExport) {
                    showActionError(r2, curDict.profileCreateFailedToast);
                  }
                });
              }
            });
          }
        });
      });
    });
  }

  var btnClearFilters = el('btn-caps-clear-filters');
  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', function() {
      activeCapsKind = 'all';
      activeCapsStatus = 'all';
      capsSearchQuery = '';
      capsSortByTokens = false;
      if (el('caps-search-input')) el('caps-search-input').value = '';
      if (kindPillGroup) {
        kindPillGroup.querySelectorAll('.filter-pill').forEach(function(p) {
          p.classList.toggle('active', (p.getAttribute('data-kind') || 'all') === 'all');
        });
      }
      if (statusPillGroup) {
        statusPillGroup.querySelectorAll('.filter-pill').forEach(function(p) {
          p.classList.toggle('active', (p.getAttribute('data-status') || 'all') === 'all');
        });
      }
      renderCapabilitiesTable();
    });
  }

  // Batch Action Buttons (Approve All Pending / Pause All Stale)
  var btnBatchApprove = el('btn-batch-approve-pending');
  if (btnBatchApprove) {
    btnBatchApprove.addEventListener('click', function() {
      var confirmBar = el('batch-approve-confirm-bar');
      var bd = typeof getPendingBreakdown === 'function' ? getPendingBreakdown() : { total: countPendingCapabilities(), globalPrefCount: 0 };
      if (!bd.total) return;
      var dict = i18n[lang] || i18n.en;
      if (!confirmBar) return;
      var msg = bd.globalPrefCount > 0
        ? dict.batchApproveConfirmWithGlobal.replace('{n}', String(bd.total)).replace('{m}', String(bd.globalPrefCount))
        : dict.batchApproveConfirmAll.replace('{n}', String(bd.total));
      confirmBar.style.display = 'flex';
      confirmBar.innerHTML =
        '<span>' + esc(msg) + '</span>' +
        '<div class="inline-confirm-actions">' +
          '<button type="button" class="btn-action" id="btn-batch-approve-cancel">' + esc(dict.cancel) + '</button>' +
          '<button type="button" class="btn-action btn-primary" id="btn-batch-approve-confirm">' + esc(dict.confirmBtn) + '</button>' +
        '</div>';
      confirmBar.querySelector('#btn-batch-approve-cancel').addEventListener('click', function() {
        confirmBar.style.display = 'none';
        confirmBar.innerHTML = '';
      });
      var confirmBtn = confirmBar.querySelector('#btn-batch-approve-confirm');
      confirmBtn.addEventListener('click', function() {
        var curDict = i18n[lang] || i18n.en;
        runWithButtonLock(confirmBtn, curDict.savingLabel, function() {
          return callKernelAction('approve-item', { approveAll: true }).then(function(res) {
            if (res && res.ok) {
              confirmBar.style.display = 'none';
              confirmBar.innerHTML = '';
              if (res.snapshot) snapshot = res.snapshot;
              rerenderAllViews();
              var approvedCount = (res.data && res.data.approvedCount !== undefined) ? res.data.approvedCount : (res.approvedCount || bd.total);
              showToast('success', (lang === 'zh' ? '已批量确认 ' : 'Approved ') + approvedCount + (lang === 'zh' ? ' 项待审能力' : ' pending capabilities'));
            } else if (!res || !res.offlineExport) {
              showActionError(res, curDict.errApproveFailed);
            }
          });
        });
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
      var dict = i18n[lang] || i18n.en;
      runWithButtonLock(btnBatchPauseStale, dict.savingLabel, function() {
        return callKernelAction('toggle-enabled', { items: staleList, enabled: false }).then(function(res) {
          var d = i18n[lang] || i18n.en;
          if (res && res.ok) {
            if (res.snapshot) snapshot = res.snapshot;
            rerenderAllViews();
            var pausedItemsCopy = staleList.slice();
            showToast('success', d.batchPausedToast.replace('{n}', String(pausedItemsCopy.length)), 8000, {
              label: d.undoActionLabel,
              run: function() {
                callKernelAction('toggle-enabled', { items: pausedItemsCopy, enabled: true }).then(function(r2) {
                  if (r2 && r2.ok) {
                    if (r2.snapshot) snapshot = r2.snapshot;
                    rerenderAllViews();
                    showToast('success', (i18n[lang] || i18n.en).profileUndoneToast);
                  }
                });
              }
            });
          } else if (!res || !res.offlineExport) {
            showActionError(res, d.errToggleFailed);
          }
        });
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

  var memSearchInput = el('mem-search');
  if (memSearchInput) {
    memSearchInput.addEventListener('input', function() {
      hotspotsSearchQuery = memSearchInput.value;
      renderHotspotsTable();
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
      var expPopEsc = el('export-popover');
      if (expPopEsc && expPopEsc.style.display !== 'none') {
        e.preventDefault();
        closeExportPopover();
        return;
      }
      var approveBarEsc = el('batch-approve-confirm-bar');
      if (approveBarEsc && approveBarEsc.style.display !== 'none') {
        e.preventDefault();
        approveBarEsc.style.display = 'none';
        approveBarEsc.innerHTML = '';
        return;
      }
      var hsDrawerEsc = el('hotspot-mem-drawer');
      if (hsDrawerEsc && hsDrawerEsc.classList.contains('open')) {
        e.preventDefault();
        hsDrawerEsc.classList.remove('open');
        hsDrawerEsc.innerHTML = '';
        return;
      }
      var activeElForEsc = document.activeElement;
      if (activeElForEsc && (activeElForEsc.tagName === 'TEXTAREA' || activeElForEsc.tagName === 'INPUT' || activeElForEsc.tagName === 'SELECT')) {
        if (typeof activeElForEsc.blur === 'function') activeElForEsc.blur();
        return;
      }
      var profEdEsc = el('profile-editor-panel');
      if (profEdEsc && profEdEsc.classList.contains('open')) {
        e.preventDefault();
        profEdEsc.classList.remove('open');
        editingProfilePrefId = null;
        return;
      }
      var profImpEsc = el('profile-import-panel');
      if (profImpEsc && profImpEsc.classList.contains('open')) {
        e.preventDefault();
        profImpEsc.classList.remove('open');
        return;
      }
      if (inspectorMode === 'edit' && editorDirty && typeof confirmDiscardDraft === 'function') {
        e.preventDefault();
        confirmDiscardDraft(function() {
          inspectorMode = 'preview';
          renderInspector();
        });
        return;
      }
      if (inspectorMode === 'edit') {
        e.preventDefault();
        inspectorMode = 'preview';
        renderInspector();
        return;
      }
      var inspEl = el('right-inspector');
      if (inspEl) inspEl.classList.remove('open');
      if (selectedCapability) {
        selectedCapability = null;
        inspectorMode = 'preview';
        renderInspector();
        renderCapabilitiesTable();
      }
      return;
    }
    if (!cmdPaletteOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        var activeEl = document.activeElement;
        if (activeEl && activeEl.classList && activeEl.classList.contains('row-interactive')) {
          var parentList = activeEl.parentElement;
          if (parentList) {
            var rowsList = Array.prototype.slice.call(parentList.querySelectorAll('.row-interactive'));
            var rowIdx = rowsList.indexOf(activeEl);
            if (rowIdx !== -1) {
              e.preventDefault();
              var nextRowIdx = rowIdx + (e.key === 'ArrowDown' ? 1 : -1);
              if (nextRowIdx >= 0 && nextRowIdx < rowsList.length) {
                rowsList[nextRowIdx].focus();
              }
              return;
            }
          }
        }
      }
      return;
    }

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

  function closeExportPopover() {
    var pop = el('export-popover');
    var trigger = el('btn-export-html');
    if (pop) pop.style.display = 'none';
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function openExportPopover() {
    var dict = i18n[lang] || i18n.en;
    if (isExport && !vscodeApi) {
      showToast('info', dict.exportViewingToast);
      return;
    }
    var pop = el('export-popover');
    var trigger = el('btn-export-html');
    if (pop) {
      pop.style.display = 'flex';
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
    } else {
      triggerHtmlExport(true);
    }
  }

  function triggerHtmlExport(exportAnonFlag) {
    closeExportPopover();
    var dict = i18n[lang] || i18n.en;
    if (isExport && !vscodeApi) {
      showToast('info', dict.exportViewingToast);
      return;
    }
    if (vscodeApi) {
      callKernelAction('export-html', { anon: Boolean(exportAnonFlag) }).then(function(res) {
        if (res.ok) {
          if (res.data && res.data.cancelled) return;
          var outPathVal = (res.data && res.data.path) || (res.result && res.result.path) || '';
          showToast('success', (lang === 'zh' ? '已导出独立 HTML 快照' : 'Exported standalone HTML') + (outPathVal ? ': ' + outPathVal : ''));
        } else if (res.error && res.error !== 'Export cancelled') {
          showToast('error', res.error || dict.exportFailedToast);
        }
      });
      return;
    }
    if (token) {
      var dlUrl = '/api/export?token=' + encodeURIComponent(token) + '&anon=' + (exportAnonFlag ? '1' : '0');
      var fileName = 'evo-workbench-' + (exportAnonFlag ? 'shareable-' : 'full-') + new Date().toISOString().slice(0, 10) + '.html';
      fetch(dlUrl)
        .then(function(resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.text();
        })
        .then(function(htmlText) {
          var blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
          var blobUrl = URL.createObjectURL(blob);
          var dlLink = document.createElement('a');
          dlLink.href = blobUrl;
          dlLink.download = fileName;
          document.body.appendChild(dlLink);
          dlLink.click();
          document.body.removeChild(dlLink);
          setTimeout(function() { try { URL.revokeObjectURL(blobUrl); } catch (e) {} }, 2000);
          showToast('success', lang === 'zh' ? '已导出离线 HTML 快照' : 'Downloaded standalone HTML snapshot');
        })
        .catch(function(err) {
          var curDict = i18n[lang] || i18n.en;
          showToast('error', curDict.exportFailedToast + (err && err.message ? (': ' + err.message) : ''));
        });
      return;
    }
    showToast('info', dict.exportCliHintToast);
  }

  var btnExport = el('btn-export-html');
  if (btnExport) {
    btnExport.addEventListener('click', function(e) {
      e.stopPropagation();
      var pop = el('export-popover');
      if (pop && pop.style.display !== 'none') closeExportPopover();
      else openExportPopover();
    });
  }
  var btnExportAnon = el('btn-export-anon');
  if (btnExportAnon) {
    btnExportAnon.addEventListener('click', function() { triggerHtmlExport(true); });
  }
  var btnExportFull = el('btn-export-full');
  if (btnExportFull) {
    btnExportFull.addEventListener('click', function() { triggerHtmlExport(false); });
  }
  document.addEventListener('click', function(e) {
    var wrap = el('export-menu-wrap');
    if (wrap && !wrap.contains(e.target)) {
      closeExportPopover();
    }
  });

  // 7. Live SSE Server Updates, Auto-Reconnect & Static Snapshot Badge (S2.5)
  function refreshSnapshotFromServer() {
    if (isExport || !token) return Promise.resolve(false);
    return fetch('/api/snapshot?token=' + encodeURIComponent(token))
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        snapshot = data;
        rerenderAllViews();
        return true;
      })
      .catch(function() { return false; });
  }

  function updateServerStatusUi(offlineFlag) {
    sseOffline = Boolean(offlineFlag);
    var dict = i18n[lang] || i18n.en;
    var dot = el('status-dot');
    var label = el('server-status-text');
    var statusWrap = el('server-status-dot');
    var sseBanner = el('sse-disconnect-banner');
    if (vscodeApi) {
      if (dot) {
        dot.classList.remove('offline', 'reconnecting', 'snapshot');
      }
      if (label) label.textContent = dict.serverIdeSync;
      if (statusWrap) statusWrap.title = dict.serverIdeSyncTitle;
      if (sseBanner) sseBanner.style.display = 'none';
      return;
    }
    if (isExport) {
      if (dot) {
        dot.classList.remove('offline', 'reconnecting');
        dot.classList.add('snapshot');
      }
      if (label) label.textContent = dict.serverSnapshot;
      if (statusWrap) statusWrap.title = dict.serverSnapshotTitle;
      if (sseBanner) sseBanner.style.display = 'none';
      return;
    }
    var retriesExhausted = sseOffline && sseReconnectAttempt >= 4;
    if (dot) {
      dot.classList.remove('snapshot');
      dot.classList.toggle('reconnecting', sseOffline && !retriesExhausted);
      dot.classList.toggle('offline', retriesExhausted);
    }
    if (label) {
      label.textContent = retriesExhausted
        ? dict.serverOffline
        : (sseOffline ? dict.serverReconnecting : dict.serverLive);
    }
    if (statusWrap) {
      statusWrap.title = retriesExhausted
        ? dict.serverOffline
        : (sseOffline ? dict.serverReconnectingTitle : dict.serverLive);
    }
    if (sseBanner) sseBanner.style.display = retriesExhausted ? 'flex' : 'none';
  }

  function scheduleSseReconnect() {
    if (isExport || vscodeApi || !token) return;
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    var backoffSchedule = [1500, 3000, 6000, 15000];
    var delayMs = backoffSchedule[Math.min(sseReconnectAttempt, backoffSchedule.length - 1)];
    sseReconnectAttempt = Math.min(sseReconnectAttempt + 1, backoffSchedule.length);
    sseReconnectTimer = setTimeout(function() {
      sseReconnectTimer = null;
      startSseEventStream();
    }, delayMs);
  }

  function startSseEventStream() {
    if (isExport || !token || typeof EventSource === 'undefined') return;
    try {
      if (activeEventSource) {
        try { activeEventSource.close(); } catch (e) {}
        activeEventSource = null;
      }
      var evSrc = new EventSource('/api/events?token=' + encodeURIComponent(token));
      activeEventSource = evSrc;
      evSrc.addEventListener('message', function() {
        refreshSnapshotFromServer();
      });
      evSrc.addEventListener('error', function() {
        var wasOffline = sseOffline;
        try { evSrc.close(); } catch (e) {}
        if (activeEventSource === evSrc) activeEventSource = null;
        scheduleSseReconnect();
        updateServerStatusUi(true);
        if (!wasOffline) {
          var curDict = i18n[lang] || i18n.en;
          showToast('warn', curDict.sseDisconnectedToast);
        }
      });
      evSrc.addEventListener('open', function() {
        var wasOffline = sseOffline;
        if (sseReconnectTimer) {
          clearTimeout(sseReconnectTimer);
          sseReconnectTimer = null;
        }
        sseReconnectAttempt = 0;
        updateServerStatusUi(false);
        if (wasOffline) {
          refreshSnapshotFromServer();
        }
      });
    } catch (e) {
      updateServerStatusUi(true);
      scheduleSseReconnect();
    }
  }

  var btnSseRetry = el('btn-sse-reconnect');
  if (btnSseRetry) {
    btnSseRetry.addEventListener('click', function() {
      if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
      }
      sseReconnectAttempt = 0;
      var dict = i18n[lang] || i18n.en;
      showToast('info', dict.sseReconnectingToast);
      startSseEventStream();
    });
  }

  var inspBackdrop = el('inspector-backdrop');
  if (inspBackdrop) {
    inspBackdrop.addEventListener('click', function() {
      confirmDiscardDraft(function() {
        var inspEl = el('right-inspector');
        if (inspEl) inspEl.classList.remove('open');
        if (selectedCapability) {
          selectedCapability = null;
          inspectorMode = 'preview';
          renderInspector();
          renderCapabilitiesTable();
        }
      });
    });
  }

  // Personal Profile Studio Events
  initProfileStudioEvents();

  // Initial Render
  applyI18n();
  switchView('capabilities');
  renderHotspotsTable();
  startSseEventStream();
})();
`.trim().replace(/\r\n/g, '\n');
}
