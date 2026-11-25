export const UI_STYLES = `
    :root {
      /* --- Zinc Neutral Dark Palette --- */
      --bg-app: #09090b;          /* Zinc 950 Alias */
      --bg-canvas: #09090b;       /* Zinc 950 */
      --bg-panel: #0f0f12;        /* Zinc 925 */
      --bg-surface: #141417;      /* Zinc 900 */
      --bg-elevated: #1c1c21;     /* Zinc 850 */
      --bg-input: #121215;

      /* --- Crisp 1px Subtle Borders --- */
      --border-subtle: #27272a;   /* Zinc 800 */
      --border-focus: #52525b;    /* Zinc 600 */
      --border-active: #3f3f46;   /* Zinc 700 */

      /* --- Text Typography (WCAG AA >= 4.5:1) --- */
      --text-primary: #fafafa;    /* Zinc 50 */
      --text-secondary: #a1a1aa;  /* Zinc 400 */
      --text-muted: #8b8b95;      /* WCAG AA Muted Neutral */

      /* --- 6-Tier Typography Scale (S3.6) --- */
      --text-xs: 10.5px;
      --text-sm: 12px;
      --text-base: 13px;
      --text-lg: 15px;
      --text-xl: 18px;
      --text-2xl: 22px;

      /* --- Semantic Capability Kind Colors (S3.6) --- */
      --kind-rule: #f59e0b;       /* Amber 500 */
      --kind-rule-bg: rgba(245, 158, 11, 0.12);
      --kind-rule-border: rgba(245, 158, 11, 0.30);
      --kind-skill: #38bdf8;      /* Sky 400 */
      --kind-skill-bg: rgba(56, 189, 248, 0.12);
      --kind-skill-border: rgba(56, 189, 248, 0.30);
      --kind-tool: #10b981;       /* Emerald 500 */
      --kind-tool-bg: rgba(16, 185, 129, 0.12);
      --kind-tool-border: rgba(16, 185, 129, 0.30);
      --kind-memory: #a855f7;     /* Purple 500 */
      --kind-memory-bg: rgba(168, 85, 247, 0.12);
      --kind-memory-border: rgba(168, 85, 247, 0.30);
      --kind-preference: #ec4899; /* Pink 500 */
      --kind-preference-bg: rgba(236, 72, 153, 0.12);
      --kind-preference-border: rgba(236, 72, 153, 0.30);

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
      background-color: var(--bg-app);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: var(--text-base);
      line-height: 1.5;
      letter-spacing: -0.011em;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: "cv02", "cv03", "cv04", "cv11";
    }

    /* Keyboard Focus Ring Baseline (S2.4) */
    :focus-visible {
      outline: 2px solid var(--status-ok);
      outline-offset: 2px;
    }
    .data-table tr.row-interactive:focus-visible {
      outline: 2px solid var(--status-ok);
      outline-offset: -2px;
      background: rgba(16, 185, 129, 0.06);
    }
    .topo-node:focus-visible rect {
      stroke: var(--status-ok);
      stroke-width: 2px;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
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

    /* Inline SVG Stroke Icons (S3.6) */
    .icon-svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
      flex-shrink: 0;
    }
    .icon-svg-brand {
      width: 16px;
      height: 16px;
      stroke: var(--status-ok);
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
      flex-shrink: 0;
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
      min-width: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .brand-name {
      font-size: var(--text-lg);
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .version-tag {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
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
      font-size: var(--text-xs);
      color: var(--text-secondary);
      max-width: 300px;
      min-width: 0;
      overflow: hidden;
    }
    .workspace-pill .ws-icon {
      display: inline-flex;
      align-items: center;
      color: var(--text-muted);
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
      margin: 0 20px;
      min-width: 0;
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
      font-size: var(--text-sm);
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
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kbd-shortcut {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--text-muted);
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      padding: 1px 5px;
      border-radius: var(--radius-sm);
      flex-shrink: 0;
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .status-indicator-live {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
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
    .status-dot-pulse.snapshot {
      background-color: var(--status-warn);
      box-shadow: none;
    }

    .topbar-btn {
      height: 28px;
      padding: 0 10px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-size: var(--text-sm);
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

    /* Segmented Language Toggle (S2.3) */
    .lang-toggle-btn {
      padding: 0 4px;
    }
    .lang-toggle-wrap {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
    }
    .lang-seg {
      padding: 2px 5px;
      border-radius: 3px;
      color: var(--text-muted);
      transition: background var(--duration-micro) ease, color var(--duration-micro) ease;
    }
    .lang-seg.active {
      background: var(--bg-elevated);
      color: var(--text-primary);
      font-weight: 600;
    }
    .lang-sep {
      color: var(--border-focus);
      font-size: var(--text-xs);
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
      font-size: var(--text-xs);
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
      font-size: var(--text-sm);
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
    .nav-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }
    .nav-item.active .nav-icon {
      color: var(--status-ok);
    }
    .nav-badge {
      margin-left: auto;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
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
      gap: 5px;
    }
    .bento-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      box-shadow: var(--surface-highlight), var(--card-shadow);
      padding: 7px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: border-color var(--duration-micro) ease;
    }
    .bento-card[role="button"],
    .bento-card.clickable {
      cursor: pointer;
    }
    .bento-card[role="button"]:hover,
    .bento-card.clickable:hover {
      border-color: var(--border-focus);
    }
    .bento-title {
      font-size: var(--text-xs);
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
      font-size: var(--text-xl);
      font-weight: 700;
      color: var(--text-primary);
      font-family: var(--font-mono);
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .bento-badge {
      font-size: var(--text-xs);
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
      font-size: var(--text-xs);
      color: var(--text-secondary);
    }
    .bento-subtext {
      font-size: var(--text-xs);
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
      height: 14px;
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
    .micro-treemap-legend {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3px 8px;
      margin-top: 5px;
      font-size: var(--text-xs);
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .treemap-leg-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kind-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .kind-dot-rule { background: var(--kind-rule); }
    .kind-dot-skill { background: var(--kind-skill); }
    .kind-dot-tool { background: var(--kind-tool); }
    .kind-dot-memory { background: var(--kind-memory); }
    .kind-dot-preference { background: var(--kind-preference); }

    /* --- Column 2: Center Stage Canvas (flex: 1) --- */
    .center-stage {
      flex: 1;
      height: 100%;
      background-color: var(--bg-canvas);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
      min-width: 0;
    }

    /* SSE Disconnect Banner (S2.5) */
    .sse-disconnect-banner {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 16px;
      background: var(--status-danger-bg);
      border-bottom: 1px solid var(--status-danger-border);
      font-size: var(--text-sm);
      color: var(--text-primary);
      flex-shrink: 0;
    }

    /* Responsive Top KPI Summary Strip */
    .stage-kpi-strip {
      display: none;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      padding: 8px 20px;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }
    .kpi-strip-chip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 10px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-size: var(--text-xs);
      text-align: left;
      min-width: 0;
    }
    button.kpi-strip-chip {
      cursor: pointer;
      transition: border-color var(--duration-micro) ease, background var(--duration-micro) ease;
    }
    button.kpi-strip-chip:hover {
      border-color: var(--border-focus);
      background: var(--bg-elevated);
    }
    .kpi-strip-lbl {
      color: var(--text-muted);
      font-weight: 500;
      white-space: nowrap;
    }
    .kpi-strip-val {
      font-family: var(--font-mono);
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
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
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-panel);
      flex-shrink: 0;
      box-shadow: var(--surface-highlight);
    }
    .view-title {
      font-size: var(--text-lg);
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .view-subtitle {
      font-size: var(--text-sm);
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
      font-size: var(--text-sm);
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
      font-size: var(--text-sm);
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
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--status-ok);
    }

    /* Needs Attention Pinned Group */
    .needs-attention-panel {
      display: none;
      flex-direction: column;
      gap: 8px;
      padding: 10px 20px;
      background: rgba(245, 158, 11, 0.05);
      border-bottom: 1px solid var(--status-warn-border);
      flex-shrink: 0;
    }
    .attention-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .attention-hdr-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--text-sm);
      color: var(--text-primary);
    }
    .attention-sub {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .attention-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .attention-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 10px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: border-color var(--duration-micro) ease, background var(--duration-micro) ease;
    }
    .attention-item:hover {
      background: var(--bg-elevated);
      border-color: var(--border-focus);
    }
    .attention-item-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }
    .attention-item-title {
      color: var(--text-primary);
      font-size: var(--text-sm);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .attention-item-reason {
      font-size: var(--text-xs);
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .filter-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      min-width: 0;
    }
    /* Horizontal Scrollable Filter Pills */
    .pill-group {
      display: flex;
      gap: 4px;
      background: rgba(0, 0, 0, 0.4);
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      flex-wrap: nowrap;
      overflow-x: auto;
      max-width: 100%;
      scrollbar-width: none;
    }
    .pill-group::-webkit-scrollbar {
      display: none;
    }
    .filter-pill {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: var(--text-sm);
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
      min-width: 180px;
    }
    .search-input {
      width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: var(--text-sm);
      padding: 6px 12px;
      outline: none;
      font-family: var(--font-mono);
      transition: border-color var(--duration-micro) ease;
    }
    .search-input:focus {
      border-color: var(--border-focus);
    }
    .view-count-badge {
      font-size: var(--text-xs);
      color: var(--text-muted);
      font-family: var(--font-mono);
      flex-shrink: 0;
    }

    /* Tables */
    .table-scroll-container {
      flex: 1;
      overflow: auto;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-base);
      table-layout: fixed;
    }
    .data-table th {
      position: sticky;
      top: 0;
      background: var(--bg-panel);
      color: var(--text-muted);
      font-weight: 500;
      font-size: var(--text-xs);
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
    #capabilities-table th:nth-child(2),
    #capabilities-table td:nth-child(2),
    #hotspots-table th:nth-child(1),
    #hotspots-table td:nth-child(1) {
      width: auto;
      max-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #th-cap-actions,
    #capabilities-table td:nth-child(5),
    #th-hs-action,
    #hotspots-table td:nth-child(6) {
      text-align: right;
    }
    @media (min-width: 769px) {
      #capabilities-table th:nth-child(1),
      #capabilities-table td:nth-child(1) {
        width: 80px;
      }
      #capabilities-table th:nth-child(3),
      #capabilities-table td:nth-child(3) {
        width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #capabilities-table th:nth-child(4),
      #capabilities-table td:nth-child(4) {
        width: 156px;
      }
      #capabilities-table th:nth-child(5),
      #capabilities-table td:nth-child(5) {
        width: 144px;
      }
      #hotspots-table th:nth-child(2),
      #hotspots-table td:nth-child(2) {
        width: 120px;
      }
      #hotspots-table th:nth-child(3),
      #hotspots-table td:nth-child(3) {
        width: 115px;
      }
      #hotspots-table th:nth-child(5),
      #hotspots-table td:nth-child(5) {
        width: 130px;
      }
      #hotspots-table th:nth-child(6),
      #hotspots-table td:nth-child(6) {
        width: 190px;
      }
      #mem-search {
        width: 240px;
      }
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
    .action-group {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--text-xs);
      font-weight: 600;
      font-family: var(--font-mono);
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-elevated);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .badge-tier-core {
      color: var(--status-ok);
      background: var(--status-ok-bg);
      border-color: var(--status-ok-border);
    }
    .badge-tier-scoped {
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--border-subtle);
    }
    .badge-pending {
      color: var(--status-warn);
      background: var(--status-warn-bg);
      border-color: var(--status-warn-border);
    }
    .badge-paused {
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.03);
      border-color: var(--border-subtle);
    }
    .badge-kind {
      display: inline-block;
      font-size: var(--text-xs);
      font-weight: 600;
      font-family: var(--font-mono);
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-elevated);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
    }
    .badge-kind-rule {
      color: var(--kind-rule);
      background: var(--kind-rule-bg);
      border-color: var(--kind-rule-border);
    }
    .badge-kind-skill {
      color: var(--kind-skill);
      background: var(--kind-skill-bg);
      border-color: var(--kind-skill-border);
    }
    .badge-kind-tool {
      color: var(--kind-tool);
      background: var(--kind-tool-bg);
      border-color: var(--kind-tool-border);
    }
    .badge-kind-memory {
      color: var(--kind-memory);
      background: var(--kind-memory-bg);
      border-color: var(--kind-memory-border);
    }
    .badge-kind-preference {
      color: var(--kind-preference);
      background: var(--kind-preference-bg);
      border-color: var(--kind-preference-border);
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: var(--text-xs);
      font-family: var(--font-mono);
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }
    .badge-status.badge-attr {
      flex-wrap: wrap;
      row-gap: 2px;
    }
    .helped-pill {
      color: var(--status-ok);
      white-space: nowrap;
      display: inline-block;
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
      font-size: var(--text-xs);
      font-family: var(--font-mono);
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item-sub-summary {
      color: var(--text-secondary);
      font-size: var(--text-sm);
      max-width: 440px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty-state {
      padding: 48px 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: var(--text-sm);
    }

    /* Personal Profile & Workflows Studio */
    .profile-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .profile-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .profile-studio-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .profile-bento-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 1120px) {
      .profile-bento-grid {
        grid-template-columns: 1fr;
      }
    }
    .profile-bento-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      box-shadow: var(--surface-highlight), var(--card-shadow);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .profile-card-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .profile-preview-pre {
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 8px 10px;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 120px;
      overflow-y: auto;
      margin-top: 4px;
    }
    .profile-host-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }
    .host-sync-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-secondary);
    }
    .profile-history-bar {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .profile-history-items {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .profile-history-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: var(--radius-md);
      background: var(--bg-panel);
      border: 1px solid var(--border-subtle);
      font-size: var(--text-xs);
      color: var(--text-secondary);
    }
    .profile-panel-drawer {
      background: var(--bg-surface);
      border: 1px solid var(--border-focus);
      border-radius: var(--radius-lg);
      padding: 14px 16px;
      display: none;
      flex-direction: column;
      gap: 10px;
      box-shadow: var(--surface-highlight);
    }
    .profile-panel-drawer.open {
      display: flex;
    }
    .profile-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    @media (max-width: 768px) {
      .profile-form-grid {
        grid-template-columns: 1fr;
      }
    }
    .profile-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .profile-field-label {
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--text-secondary);
    }
    .profile-input,
    .profile-select,
    .profile-textarea {
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: var(--text-sm);
      padding: 6px 10px;
      outline: none;
      font-family: var(--font-sans);
    }
    .profile-textarea {
      font-family: var(--font-mono);
      min-height: 96px;
      resize: vertical;
    }
    .profile-input:focus,
    .profile-select:focus,
    .profile-textarea:focus {
      border-color: var(--border-focus);
    }
    .profile-list-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .profile-list-toolbar {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-panel);
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .profile-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: background 120ms ease;
    }
    .profile-item-row:last-child {
      border-bottom: none;
    }
    .profile-item-row:hover {
      background: rgba(255, 255, 255, 0.025);
    }
    .profile-item-row.row-paused {
      opacity: 0.55;
    }
    .profile-item-main {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .profile-item-top {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .profile-item-title {
      font-size: var(--text-base);
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .profile-item-sub {
      font-size: var(--text-sm);
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
      flex-wrap: wrap;
      gap: 10px;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .legend-sep {
      color: var(--border-focus);
      font-size: var(--text-xs);
    }
    .legend-hint {
      color: var(--text-muted);
      font-size: var(--text-xs);
      border-left: 1px solid var(--border-subtle);
      padding-left: 10px;
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
      font-size: var(--text-sm);
      font-weight: 500;
      letter-spacing: -0.01em;
    }
    .topo-node-sub {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      letter-spacing: -0.01em;
    }
    .topo-edge {
      transition: opacity 200ms var(--ease-spring), stroke 150ms ease, stroke-width 150ms ease;
    }
    .ast-footnote {
      padding: 8px 20px;
      font-size: var(--text-xs);
      color: var(--text-muted);
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-panel);
      flex-shrink: 0;
    }

    /* Hotspots */
    .hotspots-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .hotspots-header-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .hotspots-kpi-badge {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: 600;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      background: var(--status-ok-bg);
      color: var(--status-ok);
      border: 1px solid var(--status-ok-border);
      flex-shrink: 0;
    }
    .chip-memory {
      display: inline-block;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--kind-memory);
      font-size: var(--text-xs);
      font-family: var(--font-mono);
      padding: 1px 6px;
      border-radius: 4px;
      margin: 2px;
      cursor: pointer;
      transition: border-color 120ms ease;
    }
    .chip-memory:hover {
      border-color: var(--kind-memory);
    }
    .chip-rule {
      display: inline-block;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--kind-rule);
      font-size: var(--text-xs);
      font-family: var(--font-mono);
      padding: 1px 6px;
      border-radius: 4px;
      margin: 2px;
      cursor: pointer;
      transition: border-color 120ms ease;
    }
    .chip-rule:hover {
      border-color: var(--kind-rule);
    }
    .code-block {
      background: #09090b;
      border: 1px solid var(--border-subtle);
      padding: 10px 12px;
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: var(--text-xs);
      font-family: var(--font-mono);
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
      max-height: 420px;
      margin: 0;
    }

    /* Gatekeeper Stream */
    .gk-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
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
      transition: border-color var(--duration-micro) ease, background var(--duration-micro) ease;
    }
    .gk-event-card.clickable {
      cursor: pointer;
    }
    .gk-event-card.clickable:hover {
      border-color: var(--border-focus);
      background: var(--bg-elevated);
    }
    .gk-event-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      gap: 8px;
    }
    .gk-diag-pre {
      background: #09090b;
      border: 1px solid var(--border-subtle);
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: var(--text-xs);
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
    .inspector-backdrop {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(9, 9, 11, 0.65);
      z-index: 25;
    }
    .inspector-drawer {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 100%;
    }
    .inspector-placeholder {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      padding: 20px 18px;
      color: var(--text-muted);
      gap: 12px;
    }
    .placeholder-hero {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .placeholder-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      color: var(--status-ok);
      flex-shrink: 0;
    }
    .placeholder-text {
      font-size: var(--text-sm);
      line-height: 1.45;
      color: var(--text-muted);
    }
    .inspector-pulse-cards {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pulse-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: var(--surface-highlight);
    }
    .pulse-card-hdr {
      font-size: var(--text-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
      margin-bottom: 2px;
    }
    .pulse-stat-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .mono-val {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-primary);
    }
    .mono-dim {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .inspector-placeholder .ast-footnote {
      padding: 8px 10px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: rgba(255, 255, 255, 0.02);
      line-height: 1.45;
    }

    .inspector-content {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
    .inspector-detail {
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
      flex-wrap: wrap;
      gap: 6px;
    }
    .inspector-title {
      font-size: var(--text-lg);
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
      line-height: 1.3;
      word-break: break-word;
    }
    .inspector-id {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
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
      font-size: var(--text-sm);
      font-weight: 500;
      letter-spacing: -0.01em;
      padding: 5px 11px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      flex-shrink: 0;
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
    .btn-action.btn-primary {
      background: var(--status-ok);
      border-color: var(--status-ok);
      color: #022c22;
      font-weight: 700;
    }
    .btn-action.btn-primary:hover {
      filter: brightness(1.06);
    }

    .inspector-section {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .inspector-section-title {
      font-size: var(--text-xs);
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
      font-size: var(--text-sm);
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
      font-size: var(--text-xs);
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
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--status-ok);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .tldr-card-body {
      font-size: var(--text-base);
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
      font-size: var(--text-sm);
      color: var(--text-primary);
      line-height: 1.45;
    }

    .inline-code-pill {
      font-family: var(--font-mono);
      font-size: var(--text-xs);
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
      font-size: var(--text-xs);
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
      text-transform: uppercase;
      color: var(--text-secondary);
    }
    .bento-card-content {
      font-size: var(--text-base);
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
      font-size: var(--text-sm);
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
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .terminal-screen {
      background: #050507;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 10px 12px;
      font-family: var(--font-mono);
      font-size: var(--text-xs);
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
      padding: 14vh 16px 16px;
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
      font-size: var(--text-lg);
      outline: none;
      font-family: var(--font-sans);
    }
    .cmd-palette-results {
      display: flex;
      flex-direction: column;
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
      font-size: var(--text-xs);
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
      font-size: var(--text-base);
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
      font-size: var(--text-base);
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
      font-size: var(--text-sm);
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
        --right-inspector-width: 330px;
      }
    }
    @media (max-width: 1024px) {
      .right-inspector {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: min(380px, 92vw);
        min-width: min(380px, 92vw);
        max-width: min(380px, 92vw);
        z-index: 30;
        transform: translateX(100%);
        transition: transform var(--duration-normal) var(--ease-spring);
        box-shadow: -8px 0 24px rgba(0, 0, 0, 0.6);
      }
      .right-inspector.open {
        transform: translateX(0);
      }
      .right-inspector.open + .inspector-backdrop {
        display: block;
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
      .stage-kpi-strip {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 8px 12px;
      }
      .filter-toolbar {
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .filter-toolbar > * {
        flex-shrink: 0;
      }
      .filter-toolbar::-webkit-scrollbar {
        display: none;
      }
      #capabilities-table th:nth-child(3),
      #capabilities-table td:nth-child(3),
      #capabilities-table th:nth-child(4),
      #capabilities-table td:nth-child(4),
      #hotspots-table th:nth-child(3),
      #hotspots-table td:nth-child(3),
      #hotspots-table th:nth-child(4),
      #hotspots-table td:nth-child(4) {
        display: none;
      }
      #capabilities-table th:nth-child(1),
      #capabilities-table td:nth-child(1) {
        width: 58px;
        padding: 8px 6px;
      }
      #capabilities-table th:nth-child(5),
      #capabilities-table td:nth-child(5) {
        width: 106px;
        padding: 8px 6px;
      }
      #hotspots-table th:nth-child(2),
      #hotspots-table td:nth-child(2) {
        width: 68px;
        padding: 8px 6px;
      }
      #hotspots-table th:nth-child(5),
      #hotspots-table td:nth-child(5) {
        width: 96px;
        padding: 8px 6px;
      }
      #hotspots-table th:nth-child(6),
      #hotspots-table td:nth-child(6) {
        width: 74px;
        padding: 8px 6px;
      }
      .workspace-pill {
        display: none;
      }
      .topbar-center {
        margin: 0 8px;
      }
      .topbar {
        padding: 0 10px;
      }
      .brand-name {
        font-size: var(--text-base);
      }
      .version-tag,
      #btn-export-html {
        display: none;
      }
      .export-popover {
        position: fixed;
        top: 54px;
        right: 12px;
      }
      .status-indicator-live {
        display: inline-flex;
        padding: 2px 6px;
      }
    }
    @media (max-width: 520px) {
      .kbd-shortcut {
        display: none;
      }
      .topbar-center {
        margin: 0 4px;
        min-width: 0;
        flex: 1;
      }
      .search-trigger {
        min-width: 0;
        width: 100%;
        padding: 4px 8px;
      }
      .status-indicator-live {
        padding: 2px 4px;
        gap: 4px;
        white-space: nowrap;
      }
    }

    /* Disabled Button State & In-Flight Lock */
    .btn-action:disabled,
    .btn-action[disabled],
    .btn-primary:disabled,
    .btn-danger:disabled,
    .filter-pill:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      pointer-events: none;
    }

    /* Calm Reconnecting Status Dot */
    .status-dot-pulse.reconnecting {
      background: var(--status-warn);
      box-shadow: 0 0 6px var(--status-warn);
    }

    /* Read-Only Static Export Banner */
    .export-readonly-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 20px;
      background: rgba(56, 189, 248, 0.08);
      border-bottom: 1px solid rgba(56, 189, 248, 0.25);
      color: var(--text-primary);
      font-size: var(--text-sm);
      flex-shrink: 0;
    }

    /* Hero Learned Summary Strip */
    .hero-learned-strip {
      padding: 12px 20px;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }
    .hero-learned-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    .hero-learned-title {
      font-size: var(--text-md);
      font-weight: 600;
      color: var(--text-primary);
    }
    .hero-helped-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      font-size: var(--text-xs);
      color: var(--text-secondary);
      max-width: 100%;
    }
    .hero-helped-badge-lbl {
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .hero-helped-badge-val {
      color: var(--text-secondary);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hero-learned-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .hero-learned-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .hero-card-label {
      font-size: var(--text-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }
    .hero-card-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .hero-card-item {
      font-size: var(--text-sm);
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hero-card-item-btn {
      background: transparent;
      border: none;
      padding: 2px 4px;
      margin: -2px -4px;
      border-radius: 4px;
      text-align: left;
      cursor: pointer;
      color: var(--text-secondary);
      font-size: var(--text-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: background var(--duration-micro) ease, color var(--duration-micro) ease;
    }
    .hero-card-item-btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
    .hero-habit-form {
      display: flex;
      gap: 6px;
      margin-top: auto;
      padding-top: 4px;
    }
    .hero-habit-input {
      flex: 1;
      min-width: 0;
      background: var(--bg-base);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: var(--text-xs);
      padding: 4px 8px;
    }
    .hero-habit-input:focus {
      outline: none;
      border-color: var(--border-focus);
    }
    @media (max-width: 900px) {
      .hero-learned-grid {
        grid-template-columns: 1fr;
      }
    }

    /* Inline Confirmation & Background Update Bars */
    .inline-confirm-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 8px 12px;
      margin-top: 8px;
      background: var(--status-warn-bg);
      border: 1px solid var(--status-warn-border);
      border-radius: var(--radius-md);
      font-size: var(--text-sm);
      color: var(--text-primary);
    }
    .inline-confirm-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .inline-info-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 8px 10px;
      margin-bottom: 8px;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: var(--radius-md);
      font-size: var(--text-xs);
      color: var(--text-primary);
    }

    /* Collapsible Profile More Options */
    .profile-more-options {
      margin: 6px 0 8px 0;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 6px 10px;
      background: rgba(0, 0, 0, 0.15);
    }
    .profile-more-options > summary {
      cursor: pointer;
      font-size: var(--text-sm);
      color: var(--text-secondary);
      font-weight: 500;
      user-select: none;
    }
    .profile-more-options[open] > summary {
      margin-bottom: 8px;
      color: var(--text-primary);
    }

    /* Export Popover Menu */
    .export-menu-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
    }
    .export-popover {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: 248px;
      background: var(--bg-panel);
      border: 1px solid var(--border-focus);
      border-radius: var(--radius-lg);
      box-shadow: var(--modal-shadow);
      padding: 6px;
      z-index: 60;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .export-popover-hdr {
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 4px 8px;
    }
    .export-opt-btn {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      padding: 7px 9px;
      border-radius: var(--radius-md);
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      text-align: left;
      transition: background var(--duration-micro) ease, border-color var(--duration-micro) ease;
    }
    .export-opt-btn:hover {
      background: var(--bg-elevated);
      border-color: var(--border-subtle);
    }
    .export-opt-title {
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--text-primary);
    }
    .export-opt-desc {
      font-size: var(--text-xs);
      color: var(--text-muted);
      line-height: 1.35;
    }

    /* Structured Inline Editor Fields */
    .editor-fields-stack {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .editor-field-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .editor-field-label {
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--text-secondary);
    }
    .editor-input,
    .editor-select {
      width: 100%;
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      padding: 6px 10px;
      outline: none;
    }
    .editor-input:focus,
    .editor-select:focus {
      border-color: var(--border-focus);
    }
    .editor-textarea-sm {
      width: 100%;
      min-height: 92px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      line-height: 1.5;
      padding: 8px 10px;
      resize: vertical;
      outline: none;
    }
    .editor-textarea-sm:focus {
      border-color: var(--border-focus);
    }
    .inspector-toolbar-danger-sep {
      margin-left: auto;
    }
    .hero-more-btn {
      align-self: flex-start;
      background: transparent;
      border: none;
      color: var(--status-ok);
      font-size: var(--text-xs);
      font-weight: 600;
      cursor: pointer;
      padding: 2px 0;
      margin-top: 2px;
    }
    .hero-more-btn:hover {
      text-decoration: underline;
    }
    .hotspot-mem-drawer {
      margin: 10px 20px 0 20px;
      padding: 12px 14px;
      background: var(--bg-surface);
      border: 1px solid var(--border-focus);
      border-radius: var(--radius-lg);
      display: none;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }
    .hotspot-mem-drawer.open {
      display: flex;
    }

    /* Reduced Motion Accessibility (S2.4) */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }
`;
