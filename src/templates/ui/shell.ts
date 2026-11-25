import { UI_STYLES } from './styles.js';
import { renderCapabilitiesViewsHtml } from './components-capabilities.js';
import { renderProfileSectionHtml } from './components-profile.js';
import { renderClientScript } from './client-script.js';

export interface UiRenderOptions {
  token?: string;
  isExport?: boolean;
  anon?: boolean;
}

export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string {
  const isExport = Boolean(options.isExport);
  const token = options.token || '';
  const anon = Boolean(options.anon);

  const clientScript = renderClientScript(snapshot, { token, isExport, anon });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EvoKernel Workbench</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2L4 6v6c0 5.25 3.4 10.1 8 11.4 4.6-1.3 8-6.15 8-11.4V6l-8-4z'/%3E%3Cpath d='M9 12l2 2 4-4'/%3E%3C/svg%3E">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
${UI_STYLES}
  </style>
</head>
<body>
<div class="workbench-root" id="workbench-root">
  <!-- Topbar: 44px Fixed Height -->
  <header class="topbar" id="topbar">
    <div class="topbar-left">
      <div class="brand">
        <svg class="icon-svg-brand" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2L4 6v6c0 5.25 3.4 10.1 8 11.4 4.6-1.3 8-6.15 8-11.4V6l-8-4z"></path>
          <path d="M9 12l2 2 4-4"></path>
        </svg>
        <span class="brand-name" id="topbar-brand-name">EvoKernel</span>
        <span class="version-tag" id="topbar-brand-subtitle">Workbench</span>
      </div>
      <div class="workspace-pill" id="topbar-workspace-pill" title="Active Workspace">
        <span class="ws-icon" aria-hidden="true">
          <svg class="icon-svg" viewBox="0 0 24 24">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path>
          </svg>
        </span>
        <span class="ws-path" id="topbar-ws-path">~/workspace</span>
      </div>
    </div>

    <div class="topbar-center">
      <button class="search-trigger" id="cmd-palette-trigger" type="button">
        <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="M20 20l-3.5-3.5"></path>
        </svg>
        <span class="search-placeholder" id="search-placeholder-text">Search capabilities, files, actions...</span>
        <kbd class="kbd-shortcut" id="cmd-palette-kbd">⌘K</kbd>
      </button>
    </div>

    <div class="topbar-right">
      <div class="status-indicator-live" id="server-status-dot" title="${isExport ? 'Read-only static HTML snapshot' : 'Live SSE Server'}">
        <span class="status-dot-pulse${isExport ? ' snapshot' : ''}" id="status-dot"></span>
        <span class="status-dot-label" id="server-status-text">${isExport ? 'STATIC SNAPSHOT' : 'LIVE'}</span>
      </div>
      <button class="topbar-btn lang-toggle-btn" id="btn-lang-toggle" type="button" title="Switch Language">
        <span class="lang-toggle-wrap" id="lang-toggle">
          <span class="lang-seg" id="lang-seg-zh">中</span>
          <span class="lang-sep">/</span>
          <span class="lang-seg active" id="lang-seg-en">EN</span>
        </span>
        <span id="lang-label" class="sr-only">EN</span>
      </button>
      <div class="export-menu-wrap" id="export-menu-wrap"${isExport ? ' style="display:none;"' : ''}>
        <button class="topbar-btn" id="btn-export-html" type="button" title="Export Standalone HTML" aria-haspopup="menu" aria-expanded="false"${isExport ? ' style="display:none;"' : ''}>
          <span id="btn-export-label">Export</span>
        </button>
        <div class="export-popover" id="export-popover" role="menu" style="display:none;">
          <div class="export-popover-hdr" id="export-popover-title">Export HTML Snapshot</div>
          <button type="button" class="export-opt-btn" id="btn-export-anon" role="menuitem">
            <span class="export-opt-title" id="export-anon-title">Shareable (Anonymized)</span>
            <span class="export-opt-desc" id="export-anon-desc">Hides local paths &amp; private details</span>
          </button>
          <button type="button" class="export-opt-btn" id="btn-export-full" role="menuitem">
            <span class="export-opt-title" id="export-full-title">Full Local Copy</span>
            <span class="export-opt-desc" id="export-full-desc">Includes full local paths for personal backup</span>
          </button>
        </div>
      </div>
    </div>
  </header>

  <!-- 3-Column Workbench Body -->
  <div class="workbench-body" id="workbench-body">
    <!-- Column 1: Left Navigation Rail (220px) -->
    <aside class="left-rail" id="left-rail">
      <!-- Section A: View Switcher -->
      <div class="rail-section" id="rail-nav">
        <div class="rail-section-header" id="rail-hdr-views">VIEWS</div>
        <nav class="nav-view-switcher" id="nav-view-switcher" aria-label="Workbench Views">
          <div class="nav-sliding-pill" id="nav-sliding-pill"></div>
          <button class="nav-item active" data-view="capabilities" id="nav-btn-capabilities" type="button">
            <span class="nav-icon" id="tab-capabilities" aria-hidden="true">
              <svg class="icon-svg" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
              </svg>
            </span>
            <span class="nav-label" id="nav-label-caps">Capabilities</span>
            <span class="nav-badge" id="badge-count-caps">0</span>
          </button>
          <button class="nav-item" data-view="profile" id="nav-btn-profile" type="button">
            <span class="nav-icon" id="tab-profile" aria-hidden="true">
              <svg class="icon-svg" viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="4"></circle>
                <path d="M5 20a7 7 0 0 1 14 0"></path>
              </svg>
            </span>
            <span class="nav-label" id="nav-label-profile">Personal Profile</span>
            <span class="nav-badge" id="badge-count-profile">0</span>
          </button>
          <button class="nav-item" data-view="topology" id="nav-btn-topology" type="button">
            <span class="nav-icon" id="tab-topology" aria-hidden="true">
              <svg class="icon-svg" viewBox="0 0 24 24">
                <circle cx="5" cy="6" r="2.5"></circle>
                <circle cx="5" cy="18" r="2.5"></circle>
                <circle cx="19" cy="12" r="2.5"></circle>
                <path d="M7.5 6.8L16.5 11M7.5 17.2L16.5 13"></path>
              </svg>
            </span>
            <span class="nav-label" id="nav-label-topo">Topology</span>
          </button>
          <button class="nav-item" data-view="hotspots" id="nav-btn-hotspots" type="button">
            <span class="nav-icon" aria-hidden="true">
              <svg class="icon-svg" viewBox="0 0 24 24">
                <path d="M12 3c2.5 3 5 5.6 5 9.5a5 5 0 0 1-10 0c0-2.4 1.3-4.6 3-6.5.4 1.8 1.6 2.7 2 3 0-2.2-.2-4.1 0-6z"></path>
              </svg>
            </span>
            <span class="nav-label" id="nav-label-hotspots">Git Hotspots</span>
            <span class="nav-badge" id="badge-count-hotspots">0</span>
          </button>
          <button class="nav-item" data-view="gatekeeper" id="nav-btn-gatekeeper" type="button">
            <span class="nav-icon" id="tab-gatekeeper" aria-hidden="true">
              <svg class="icon-svg" viewBox="0 0 24 24">
                <path d="M12 3l7 3.5v5.5c0 4.6-2.9 8.7-7 10-4.1-1.3-7-5.4-7-10V6.5L12 3z"></path>
                <path d="M9.5 12l1.8 1.8 3.5-3.6"></path>
              </svg>
            </span>
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
          <div class="bento-subtext" id="bento-health-sub">Zero-leak AST* shielding · Click to diagnose</div>
        </div>

        <!-- Card 2: Prompt Tax Saved -->
        <div class="bento-card" id="bento-savings">
          <div class="bento-title" id="bento-title-tax">Prompt Tax Saved</div>
          <div class="bento-metric-row">
            <span class="bento-metric-value text-emerald" id="bento-saved-pct">—</span>
          </div>
          <div class="bento-subtext" id="bento-saved-detail">—</div>
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

        <!-- Card 4: 7-Day Recall (Visible at 769px-1024px & >1024px) -->
        <div class="bento-card" id="bento-recall-7d">
          <div class="bento-title" id="bento-title-recall">7-DAY RECALL</div>
          <div class="bento-metric-row">
            <span class="bento-metric-value" id="bento-recall-val">0</span>
            <span class="bento-badge" id="bento-recall-adopted">0 adopted</span>
          </div>
          <div class="bento-subtext" id="bento-recall-sub">0 searches · 0 pitfalls avoided</div>
        </div>

        <!-- Card 5: Virtual Footprint Treemap -->
        <div class="bento-card bento-treemap-card" id="bento-treemap-card">
          <div class="bento-title" id="bento-title-treemap">Virtual Footprint</div>
          <div class="micro-treemap-container" id="micro-treemap"></div>
          <div class="micro-treemap-legend" id="micro-treemap-legend"></div>
        </div>
      </div>
    </aside>

    <!-- Column 2: Center Stage Canvas (flex: 1) -->
    <main class="center-stage" id="center-stage">
      <!-- Read-Only Static Export Banner -->
      <div class="export-readonly-banner" id="export-readonly-banner" style="display: ${isExport ? 'flex' : 'none'};" role="status">
        <span id="export-readonly-msg">Read-only snapshot · Run evo ui locally to edit</span>
      </div>

      <!-- SSE Disconnect Banner -->
      <div class="sse-disconnect-banner" id="sse-disconnect-banner" style="display: none;" role="alert">
        <span id="sse-disconnect-msg">Live update stream disconnected.</span>
        <button type="button" class="btn-action" id="btn-sse-reconnect" style="padding: 2px 9px;">Reconnect</button>
      </div>

      <!-- Top KPI Summary Strip (Responsive / Mobile Visible) -->
      <div class="stage-kpi-strip" id="stage-kpi-strip">
        <button type="button" class="kpi-strip-chip" id="kpi-chip-health">
          <span class="kpi-strip-lbl" id="kpi-strip-health-lbl">Health</span>
          <span class="kpi-strip-val" id="kpi-strip-health-val">—</span>
        </button>
        <div class="kpi-strip-chip" id="kpi-chip-saved">
          <span class="kpi-strip-lbl" id="kpi-strip-saved-lbl">Prompt Tax</span>
          <span class="kpi-strip-val text-emerald" id="kpi-strip-saved-val">—</span>
        </div>
        <button type="button" class="kpi-strip-chip" id="kpi-chip-budget">
          <span class="kpi-strip-lbl" id="kpi-strip-budget-lbl">Core Budget</span>
          <span class="kpi-strip-val" id="kpi-strip-budget-val">0 / 1500 tok</span>
        </button>
        <div class="kpi-strip-chip" id="kpi-chip-recall">
          <span class="kpi-strip-lbl" id="kpi-strip-recall-lbl">7d Recall</span>
          <span class="kpi-strip-val" id="kpi-strip-recall-val">0 hits · 0 adopted</span>
        </div>
      </div>

${renderCapabilitiesViewsHtml()}

${renderProfileSectionHtml()}
    </main>

    <!-- Column 3: Right Structured Inspector (380px) -->
    <aside class="right-inspector" id="right-inspector">
      <div class="inspector-drawer" id="inspector-drawer">
        <div class="inspector-placeholder" id="inspector-placeholder">
          <div class="placeholder-hero">
            <span class="placeholder-icon" aria-hidden="true">
              <svg class="icon-svg" viewBox="0 0 24 24">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
            </span>
            <div>
              <div style="font-size: var(--text-lg); font-weight: 600; color: var(--text-primary); margin-bottom: 2px;" id="inspector-placeholder-title">Workspace Pulse</div>
              <p class="placeholder-text" id="inspector-placeholder-sub">Select any Rule, Skill, Tool, or Memory to inspect details, or review live workspace health below.</p>
            </div>
          </div>
          <div class="inspector-pulse-cards" id="inspector-pulse-cards"></div>
        </div>
        <div class="inspector-content" id="inspector-content" style="display: none;">
          <div class="inspector-detail" id="inspector-detail"></div>
        </div>
      </div>
    </aside>
    <div class="inspector-backdrop" id="inspector-backdrop"></div>
  </div>

  <!-- Command Palette Modal (Cmd/Ctrl + K) -->
  <div class="cmd-palette-backdrop" id="cmd-palette-backdrop">
    <div class="cmd-palette-modal" id="cmd-palette-modal" role="dialog" aria-modal="true" aria-label="Command Palette">
      <div class="cmd-palette-input-wrap">
        <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="M20 20l-3.5-3.5"></path>
        </svg>
        <input class="cmd-palette-input" id="cmd-palette-input" type="text" placeholder="Type a command or search capabilities..." autocomplete="off" spellcheck="false" />
        <kbd class="kbd-shortcut">ESC</kbd>
      </div>
      <div class="cmd-palette-results" id="cmd-palette-results">
        <div class="cmd-palette-list" id="cmd-palette-list" role="listbox"></div>
      </div>
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
