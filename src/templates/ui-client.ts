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
  var hotspotsSearchQuery = '';
  var capsSortByTokens = false;
  var healthDiagExpanded = false;
  var activeGkFilter = 'all';
  var selectedCapability = null; // { kind: string, item: any }
  var inspectorMode = 'preview'; // 'preview' | 'edit'
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

  var i18n = {
    en: {
      brandName: 'EvoKernel',
      brandSubtitle: 'Workbench',
      activeWorkspace: 'Active Workspace',
      searchPlaceholder: 'Search capabilities, files, actions ({shortcut})...',
      serverLive: 'LIVE',
      serverOffline: 'OFFLINE',
      serverSnapshot: 'STATIC SNAPSHOT',
      serverSnapshotTitle: 'Read-only static HTML snapshot',
      exportBtn: 'Export',
      exportBtnTitle: 'Export Standalone HTML',
      langSwitchTitle: 'Switch Language (EN / 中文)',
      sseDisconnectedMsg: 'Live stream disconnected — snapshot paused.',
      sseDisconnectedToast: 'Live stream disconnected — retrying automatically...',
      sseReconnectBtn: 'Reconnect',
      sseReconnectingToast: 'Reconnecting to EvoKernel live stream...',
      exportViewingToast: 'Currently viewing standalone HTML snapshot',
      exportCliHintToast: 'Export standalone HTML: npx -y evo-kernel ui --export workbench.html',
      offlineActionToast: 'Read-only static snapshot: "{action}" requires live server (npx -y evo-kernel ui).',
      viewsHeader: 'VIEWS',
      viewCaps: 'Capabilities',
      viewTopo: 'Topology',
      viewHotspots: 'Git Hotspots',
      viewGk: 'Gatekeeper',
      telemetryHeader: 'TELEMETRY',
      healthTitle: 'Health Score',
      healthSub: 'AST-verified · Click to inspect deductions',
      gradePrefix: 'Grade ',
      taxTitle: 'Session Token Savings',
      savedPctPrefix: 'Saved ',
      budgetTitle: 'Core Rule Budget',
      budgetStatusOk: 'Within safe limit (click to filter)',
      budgetStatusWarn: 'Nearing 1500-token cap (click to filter)',
      budgetStatusExceeded: 'Budget exceeded! Click to inspect',
      treemapTitle: 'Virtual Footprint',
      bentoRecallTitle: '7-DAY RECALL',
      recall7dLabel: '7d Recall',
      kpiHealth: 'Health',
      kpiSaved: 'Token Tax',
      kpiBudget: 'Core Budget',
      kpiRecall7d: '7d Recall',
      kpiSearchesShort: 'searches',
      kpiAdoptedShort: 'adopted',
      pitfallsShort: 'pitfalls avoided',
      needsAttentionTitle: 'Needs Attention',
      needsAttentionSub: 'Pending approvals, drifted AST anchors, or over-budget core rules',
      attentionReasonPending: 'Pending Review',
      attentionReasonStale: 'AST Drifted (STALE)',
      attentionReasonOrphaned: 'Orphaned Symbol',
      attentionReasonBudget: 'Core Budget Exceeded',
      capsViewTitle: 'Capabilities Matrix',
      capsViewSub: 'High-density inspection of rules, skills, tools, and episodic memories',
      allKinds: 'All',
      rules: 'Rules',
      skills: 'Skills',
      tools: 'Tools',
      memories: 'Memories',
      kindRule: 'RULE',
      kindSkill: 'SKILL',
      kindTool: 'TOOL',
      kindMemory: 'MEMORY',
      allStatus: 'All Status',
      statusPending: 'Pending',
      statusActive: 'Active',
      statusPaused: 'Paused',
      statusVerified: 'Verified',
      statusStale: 'Stale',
      statusCore: 'Core',
      statusScoped: 'Scoped',
      statusArchived: 'Archived',
      batchApprovePending: 'Approve All Pending',
      batchPauseStale: 'Pause Stale Items',
      capsSearchPlaceholder: 'Filter capabilities (id, title, symbol, file)...',
      itemsCountSuffix: 'items',
      thCapType: 'Type',
      thCapTitle: 'ID & Title',
      thCapScope: 'Scope / Status',
      thCapAttr: 'Attribution',
      thCapActions: 'Actions',
      capsEmptyState: 'No capabilities match the current filter.',
      tierCore: 'CORE',
      tierScoped: 'SCOPED',
      tierSandbox: 'SANDBOX',
      tierSkillSop: 'SKILL SOP',
      badgePending: 'Pending Review',
      badgeEnabled: 'Enabled',
      badgePaused: 'Paused',
      badgeArchived: 'Archived',
      hitSingularSuffix: 'hit',
      hitsSuffix: 'hits',
      topoTitle: 'Orthogonal Capability & AST Topology',
      topoSub: 'Rules & Skills → Cognitive Memories → AST Source Files & Callers',
      legendRule: 'Rule',
      legendSkill: 'Skill',
      legendTool: 'Tool',
      legendMemory: 'Memory',
      legendVerified: 'Verified',
      legendContested: 'Branch / Contested',
      legendStale: 'Stale / Drift',
      legendHint: 'Hover or click node for focus dimming',
      hotspotsTitle: 'Fragile Git Hotspots & AST Shielding Matrix',
      hotspotsSub: 'High-churn files tracked by bug-fix commits and shielded by AST memories',
      hotspotsSearchPlaceholder: 'Filter hotspots or memory ID...',
      hotspotsKpiSuffix: 'Protected',
      thHsPath: 'Source File Path',
      thHsFrag: 'Fragility Score',
      thHsCommits: 'Fix Commits',
      thHsMems: 'Bound AST Shielding Memories',
      thHsStatus: 'Status',
      thHsAction: 'Action',
      hotspotsEmptyState: 'No git commit hotspots detected. Repository history is clean.',
      hotspotProtected: 'PROTECTED',
      hotspotUnprotected: 'UNPROTECTED',
      noneBound: '(None)',
      commitsTotalSuffix: 'total',
      openShort: 'Open ↗',
      gkTitle: 'Deterministic Gatekeeper Audit Stream',
      gkSub: 'Proposal audit timeline: Static Security, Sandbox --self-test, AST Grounding, Quotas',
      gkFilterAll: 'All Events',
      gkFilterPass: 'Passed',
      gkFilterFail: 'Rejected',
      gkBadgePass: 'PASS',
      gkBadgeReject: 'REJECT',
      gkPassAll: 'All evolved capabilities passed Deterministic Gatekeeper.',
      noSelectionTitle: 'Workspace Pulse',
      noSelectionSub: 'Select any Rule, Skill, Tool, or Memory from the table or topology graph to inspect.',
      pulseCardTitle: 'Workspace Pulse',
      pulseActiveCaps: 'Active Capabilities',
      pulseVerifiedMems: 'AST Verified Memories',
      recallCardTitle: '7-Day Recall Telemetry',
      recallSearches: 'Searches',
      recallInspected: 'L1/L2 Inspected',
      recallToolsRun: 'Sandbox Runs',
      recallAdopted: 'Adopted (Helped)',
      recallPitfalls: 'Pitfalls Avoided',
      shortcutsCardTitle: 'Keyboard Shortcuts',
      shortcutPalette: 'Command Palette',
      shortcutNavRows: 'Focus Table Rows',
      shortcutInspect: 'Inspect Selected Row',
      shortcutClose: 'Close Modal / Drawer',
      astFootnote: '* AST = zero-dep lexical-structural skeleton & call-anchor fingerprinting',
      closeInspectorTitle: 'Close Inspector',
      tldrLabel: 'One-Sentence Takeaway (TL;DR)',
      openInIde: '↗ Open in IDE',
      verifyAst: '✓ Verify AST',
      verifyingAst: 'Verifying...',
      rebindAst: 'Re-bind Current Code (AST)',
      rebindingAst: 'Re-binding...',
      staleBannerText: 'Target code changed or switched branches since this memory was recorded. Choose how to handle it:',
      promoteCore: '↑ Promote to Core',
      demoteScoped: '↓ Demote to Scoped',
      runSelfTest: '▶ Run Self-Test',
      edit: 'Edit',
      preview: 'Preview',
      archive: 'Archive',
      restore: '↩ Restore',
      approve: '✓ Approve',
      pauseItem: 'Pause',
      resumeItem: '▶ Enable',
      undoArchive: '↩ Undo',
      astAnchors: 'AST Code Anchors',
      callersSuffix: 'callers',
      inlineEditorTitle: 'Inline Source Editor',
      tokensEstSuffix: 'tokens',
      saveChanges: 'Save Changes',
      cancel: 'Cancel',
      symptomLabel: 'Symptom',
      rootCauseLabel: 'Root Cause',
      solutionLabel: 'Solution',
      l1ContractLabel: 'L1 Contract',
      l2SopLabel: 'L2 SOP',
      bodyLabel: 'Content',
      sandboxConsole: 'Sandbox Terminal Console',
      idleBadge: 'IDLE',
      runningBadge: 'RUNNING...',
      errorBadge: 'ERROR',
      sandboxClickHint: 'Click "Run Self-Test" to execute.',
      termPassBadge: 'EXIT 0 · PASS ({ms}ms)',
      termFailBadge: 'EXIT {code} · FAIL',
      termTimeoutLine: '[TIMEOUT] Execution exceeded 5000ms sandbox limit',
      termSummaryLine: 'Exit Code: {code} · Duration: {ms}ms',
      termExecFailedPrefix: 'Execution failed: ',
      errRestoreFailed: 'Restore failed',
      errArchiveFailed: 'Archive failed',
      errApproveFailed: 'Approve failed',
      errToggleFailed: 'Failed to toggle status',
      errToggleTierFailed: 'Failed to toggle tier',
      errVerifyFailed: 'Verification failed',
      errRebindFailed: 'Re-bind failed',
      errSaveFailed: 'Save failed',
      errUnknown: 'unknown error',
      cmdInputPlaceholder: 'Type a command or search capabilities...',
      cmdGroupCaps: 'Capabilities',
      cmdGroupHotspots: 'Fragile Git Hotspots',
      cmdGroupActions: 'Global Commands',
      cmdHotspotBadge: 'HOTSPOT',
      cmdVerifyTitle: 'Verify All AST Memories',
      cmdVerifySub: 'Recompute AST freshness for all cognitive memories',
      cmdSwitchCapsTitle: 'Switch View: Capabilities Matrix',
      cmdSwitchCapsSub: 'High-density table with status & kind filters',
      cmdSwitchTopoTitle: 'Switch View: Orthogonal Card Topology',
      cmdSwitchTopoSub: '3-tier orthogonal round-rect layout with focus dimming',
      cmdSwitchHsTitle: 'Switch View: Git Hotspots Matrix',
      cmdSwitchHsSub: 'Fragile churn files and shielding AST memories',
      cmdSwitchGkTitle: 'Switch View: Gatekeeper Audit Stream',
      cmdSwitchGkSub: 'Deterministic proposal audit timeline',
      cmdToggleLangTitle: 'Toggle Language (EN / 中文)',
      cmdToggleLangSub: 'Switch interface localization dictionary',
      diagTitle: 'Health Score Diagnostics & Quick Fixes',
      diagStaleMsg: '{n} AST memories drifted (STALE)',
      diagFilterCta: 'Filter →',
      diagHotspotMsg: '{n} fragile git hotspots unprotected',
      diagInspectCta: 'Inspect →',
      diagCoreMsg: 'Core rules using {cur}/1500 tok',
      diagSortCta: 'Sort by size →',
      diagPendingMsg: '{n} newly evolved items pending review',
      diagReviewCta: 'Review →',
      diagAllHealthy: 'All workspace health metrics are optimal',
      helpedBadgeShort: '✓ Helped',
      openedInIdeToast: 'Opened in IDE: {path}',
      openFileFailedToast: 'Failed to open file',
      ruleMovedCoreToast: 'Rule promoted to Core ({tok}/1500 tok)',
      ruleMovedScopedToast: 'Rule moved to Scoped',
      sandboxExecutingMsg: 'Executing in sandbox (5000ms timeout)...',
      selfTestPassedToast: 'Self-test passed ({ms}ms)',
      selfTestFailedToast: 'Self-test failed ({ms}ms)',
      errExtTimeout: 'Timeout waiting for extension host response',
      errNetworkFailed: 'Network request failed',
      cmdModalAriaLabel: 'Command Palette'
    },
    zh: {
      brandName: 'EvoKernel',
      brandSubtitle: '工作台',
      activeWorkspace: '当前工作区',
      searchPlaceholder: '全局搜索能力、文件与指令 ({shortcut})...',
      serverLive: '实时在线',
      serverOffline: '连接断开',
      serverSnapshot: '静态快照',
      serverSnapshotTitle: '只读静态 HTML 快照',
      exportBtn: '导出快照',
      exportBtnTitle: '导出独立离线 HTML',
      langSwitchTitle: '切换语言 (中 / EN)',
      sseDisconnectedMsg: '实时推送已断开，当前快照暂停自动刷新。',
      sseDisconnectedToast: '实时推送已断开，正在自动重连...',
      sseReconnectBtn: '重新连接',
      sseReconnectingToast: '正在重新连接 EvoKernel 实时服务...',
      exportViewingToast: '当前正在浏览独立离线 HTML 报告',
      exportCliHintToast: '导出独立离线快照请运行：npx -y evo-kernel ui --export workbench.html',
      offlineActionToast: '只读静态快照：操作“{action}”需要连接本地实时服务 (npx -y evo-kernel ui)。',
      viewsHeader: '视图导航',
      viewCaps: '能力矩阵',
      viewTopo: '拓扑星图',
      viewHotspots: 'Git 热点',
      viewGk: '门禁审计',
      telemetryHeader: '实时遥测',
      healthTitle: '健康评分',
      healthSub: 'AST 实时校验 · 点击查看扣分项',
      gradePrefix: '评级 ',
      taxTitle: '会话 Token 节省',
      savedPctPrefix: '已节省 ',
      budgetTitle: '核心规则预算',
      budgetStatusOk: '安全预算内（点击筛选核心规则）',
      budgetStatusWarn: '接近 1500 上限（点击筛选降级）',
      budgetStatusExceeded: '超出核心预算！（点击排查大规则）',
      treemapTitle: '虚拟化资产分布',
      bentoRecallTitle: '7天召回',
      recall7dLabel: '近7日召回',
      kpiHealth: '健康度',
      kpiSaved: 'Token 节省',
      kpiBudget: '核心预算',
      kpiRecall7d: '近7日召回',
      kpiSearchesShort: '次检索',
      kpiAdoptedShort: '次采纳',
      pitfallsShort: '次避坑',
      needsAttentionTitle: '待处理异常',
      needsAttentionSub: '待审核提案、AST 漂移记忆或核心规则预算超限项',
      attentionReasonPending: '待人工确认',
      attentionReasonStale: '源码漂移 (STALE)',
      attentionReasonOrphaned: '锚点丢失',
      attentionReasonBudget: '核心预算超标',
      capsViewTitle: '自演化能力矩阵',
      capsViewSub: '高密度透视规则、技能、沙盒微工具与认知记忆',
      allKinds: '全部类型',
      rules: '规则',
      skills: '技能',
      tools: '微工具',
      memories: '认知记忆',
      kindRule: '规则',
      kindSkill: '技能',
      kindTool: '工具',
      kindMemory: '记忆',
      allStatus: '全部状态',
      statusPending: '待审核',
      statusActive: '已启用',
      statusPaused: '已搁置',
      statusVerified: '已验证',
      statusStale: '已失效',
      statusCore: '核心',
      statusScoped: '局部',
      statusArchived: '回收站',
      batchApprovePending: '全部确认待审',
      batchPauseStale: '批量搁置失效项',
      capsSearchPlaceholder: '筛选能力（标识、标题、AST 符号、文件路径）...',
      itemsCountSuffix: '项',
      thCapType: '类型',
      thCapTitle: '标识与标题',
      thCapScope: '作用域 / 状态',
      thCapAttr: '状态与命中',
      thCapActions: '操作',
      capsEmptyState: '当前筛选条件下没有匹配的能力项。',
      tierCore: '核心',
      tierScoped: '局部',
      tierSandbox: '沙盒',
      tierSkillSop: '技能 SOP',
      badgePending: '待审核',
      badgeEnabled: '已启用',
      badgePaused: '已搁置',
      badgeArchived: '已归档',
      hitSingularSuffix: '次命中',
      hitsSuffix: '次命中',
      topoTitle: '正交能力与 AST 调用拓扑图',
      topoSub: '规则与技能 → 认知记忆 → 源码 AST 文件与调用链',
      legendRule: '规则',
      legendSkill: '技能',
      legendTool: '工具',
      legendMemory: '记忆',
      legendVerified: '已验证',
      legendContested: '多分支 / 争议',
      legendStale: '失效漂移',
      legendHint: '悬停或点击节点聚焦高亮关联链路',
      hotspotsTitle: 'Git 脆弱代码热点与 AST 护栏矩阵',
      hotspotsSub: '按修复提交频次统计的高频脆弱文件及其绑定的 AST 记忆护栏',
      hotspotsSearchPlaceholder: '筛选热点文件或记忆 ID...',
      hotspotsKpiSuffix: '已防护',
      thHsPath: '源码文件路径',
      thHsFrag: '脆弱度评分',
      thHsCommits: '修复提交数',
      thHsMems: '绑定的 AST 记忆护栏',
      thHsStatus: '防护状态',
      thHsAction: '操作',
      hotspotsEmptyState: '未检测到脆弱代码热点，仓库提交历史干净。',
      hotspotProtected: '已防护',
      hotspotUnprotected: '缺少护栏',
      noneBound: '（暂无绑定）',
      commitsTotalSuffix: '总提交',
      openShort: '打开 ↗',
      gkTitle: '确定性 Gatekeeper 门禁审计流',
      gkSub: '提案审计流水线：静态安全检查、沙盒 --self-test、AST 锚定与预算配额',
      gkFilterAll: '全部记录',
      gkFilterPass: '已通过',
      gkFilterFail: '已拦截',
      gkBadgePass: '通过',
      gkBadgeReject: '拦截',
      gkPassAll: '所有演进能力均已严格通过确定性门禁校验。',
      noSelectionTitle: '工作区实时脉搏',
      noSelectionSub: '点击左侧列表或拓扑图中的任意规则、技能、微工具或记忆查看完整详情。',
      pulseCardTitle: '工作区脉搏',
      pulseActiveCaps: '活跃演进资产',
      pulseVerifiedMems: 'AST 已验证记忆',
      recallCardTitle: '近 7 日召回实效',
      recallSearches: '检索次数',
      recallInspected: '深度展开 (L1/L2)',
      recallToolsRun: '沙盒工具执行',
      recallAdopted: '有效采纳',
      recallPitfalls: '避坑命中',
      shortcutsCardTitle: '键盘快捷键',
      shortcutPalette: '全局指令面板',
      shortcutNavRows: '切换表格焦点行',
      shortcutInspect: '展开选中项详情',
      shortcutClose: '关闭弹窗 / 抽屉',
      astFootnote: '* AST = 零依赖词法-结构骨架与调用锚点指纹',
      closeInspectorTitle: '关闭详情抽屉',
      tldrLabel: '一句话核心结论 (TL;DR)',
      openInIde: '↗ 在 IDE 中打开',
      verifyAst: '✓ 验证 AST 状态',
      verifyingAst: '验证计算中...',
      rebindAst: '重新锚定当前代码 (AST)',
      rebindingAst: '重新锚定中...',
      staleBannerText: '该记忆绑定的源码已发生修改或分支切换。您可以一键重新锚定当前代码、暂时搁置或归档：',
      promoteCore: '↑ 提升为核心规则',
      demoteScoped: '↓ 降级为局部规则',
      runSelfTest: '▶ 执行沙盒自测',
      edit: '在线编辑',
      preview: '结构化预览',
      archive: '归档',
      restore: '↩ 恢复',
      approve: '✓ 确认',
      pauseItem: '搁置',
      resumeItem: '▶ 启用',
      undoArchive: '↩ 撤销',
      astAnchors: 'AST 源码锚点',
      callersSuffix: '处调用',
      inlineEditorTitle: '源码在线编辑器',
      tokensEstSuffix: 'Token',
      saveChanges: '保存变更',
      cancel: '取消',
      symptomLabel: '故障症状',
      rootCauseLabel: '根因剖析',
      solutionLabel: '修复与防坑方案',
      l1ContractLabel: 'L1 触发契约',
      l2SopLabel: 'L2 标准作业程序 (SOP)',
      bodyLabel: '规则正文',
      sandboxConsole: '沙盒终端控制台',
      idleBadge: '就绪',
      runningBadge: '运行中...',
      errorBadge: '异常',
      sandboxClickHint: '点击“执行沙盒自测”在隔离沙盒中运行校验。',
      termPassBadge: '退出码 0 · 通过 ({ms}ms)',
      termFailBadge: '退出码 {code} · 失败',
      termTimeoutLine: '[超时] 执行超过 5000ms 沙盒限制',
      termSummaryLine: '退出码: {code} · 耗时: {ms}ms',
      termExecFailedPrefix: '执行失败：',
      errRestoreFailed: '恢复失败',
      errArchiveFailed: '归档失败',
      errApproveFailed: '确认失败',
      errToggleFailed: '切换状态失败',
      errToggleTierFailed: '切换规则层级失败',
      errVerifyFailed: 'AST 校验失败',
      errRebindFailed: '重新锚定失败',
      errSaveFailed: '保存失败',
      errUnknown: '未知错误',
      cmdInputPlaceholder: '输入指令或搜索规则、技能、工具与记忆...',
      cmdGroupCaps: '演进能力资产',
      cmdGroupHotspots: 'Git 脆弱代码热点',
      cmdGroupActions: '全局快捷指令',
      cmdHotspotBadge: '热点',
      cmdVerifyTitle: '校验全部 AST 认知记忆',
      cmdVerifySub: '重新计算工作区所有记忆锚点的源码新鲜度',
      cmdSwitchCapsTitle: '切换视图：自演化能力矩阵',
      cmdSwitchCapsSub: '带多维状态与类型筛选的高密度表格',
      cmdSwitchTopoTitle: '切换视图：正交拓扑星图',
      cmdSwitchTopoSub: '规则 → 记忆 → 源码符号三栏链路聚焦视图',
      cmdSwitchHsTitle: '切换视图：Git 脆弱代码热点',
      cmdSwitchHsSub: '高频修复文件与 AST 记忆护栏覆盖矩阵',
      cmdSwitchGkTitle: '切换视图：Gatekeeper 门禁审计流',
      cmdSwitchGkSub: '确定性提案校验与拦截时间线',
      cmdToggleLangTitle: '切换界面语言 (中 / EN)',
      cmdToggleLangSub: '在中英文双语词典之间即时切换',
      diagTitle: '健康度诊断与一键修复向导',
      diagStaleMsg: '{n} 条记忆因代码变更已失效 (STALE)',
      diagFilterCta: '筛选修复 →',
      diagHotspotMsg: '{n} 个高频故障文件缺少 AST 记忆护栏',
      diagInspectCta: '查看热点 →',
      diagCoreMsg: '核心规则占用 {cur}/1500 tok',
      diagSortCta: '按体积排查 →',
      diagPendingMsg: '{n} 项新演化能力待您审核确认',
      diagReviewCta: '立即审核 →',
      diagAllHealthy: '工作区全部指标健康，无失效记忆或预算超标',
      helpedBadgeShort: '✓ 已避坑',
      openedInIdeToast: '已在 IDE 中打开：{path}',
      openFileFailedToast: '打开文件失败',
      ruleMovedCoreToast: '已提升为核心规则 ({tok}/1500 tok)',
      ruleMovedScopedToast: '已降级为局部规则',
      sandboxExecutingMsg: '正在隔离沙盒中执行校验（5000ms 超时保护）...',
      selfTestPassedToast: '沙盒自测通过 ({ms}ms)',
      selfTestFailedToast: '沙盒自测失败 ({ms}ms)',
      errExtTimeout: '等待扩展宿主响应超时',
      errNetworkFailed: '网络请求失败',
      cmdModalAriaLabel: '全局指令面板'
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
    var dict = i18n[lang] || i18n.en;
    var s = singularKind(k);
    if (s === 'rule') return dict.kindRule;
    if (s === 'skill') return dict.kindSkill;
    if (s === 'tool') return dict.kindTool;
    if (s === 'memory') return dict.kindMemory;
    return s.toUpperCase();
  }

  function kindSemanticClass(k) {
    var s = singularKind(k);
    if (s === 'rule' || s === 'skill' || s === 'tool' || s === 'memory') {
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
    renderTelemetry();
    renderCapabilitiesTable();
    renderCardTopology();
    renderHotspotsTable();
    renderGatekeeperStream();
    if (selectedCapability && selectedCapability.item) {
      var list = snapshot[selectedCapability.kind] || [];
      var foundItem = list.find(function(it) { return it.id === selectedCapability.item.id; });
      if (foundItem) {
        selectedCapability.item = foundItem;
      }
      renderInspector();
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

  function callKernelAction(action, params) {
    params = params || {};
    var dict = i18n[lang] || i18n.en;
    if (isExport && !vscodeApi) {
      var readOnlyMsg = dict.offlineActionToast.replace('{action}', action);
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
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        actSpec.run();
      });
      toast.appendChild(actBtn);
    }

    boxEl.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, durationMs || (actSpec ? 5500 : 3500));
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
        rerenderAllViews();
        if (!selectedCapability) renderInspector();
        showToast('success', (lang === 'zh' ? '已归档 ' : 'Archived ') + itemId, 5500, {
          label: dict.undoArchive,
          run: function() {
            callKernelAction('restore-item', { kind: sKind, id: itemId }).then(function(rRes) {
              if (rRes.ok) {
                if (rRes.snapshot) snapshot = rRes.snapshot;
                rerenderAllViews();
                showToast('success', (lang === 'zh' ? '已恢复 ' : 'Restored ') + itemId);
              } else if (!rRes.offlineExport) {
                showToast('error', rRes.error || dict.errRestoreFailed);
              }
            });
          }
        });
      } else if (!res.offlineExport) {
        showToast('error', res.error || dict.errArchiveFailed);
      }
    });
  }

  // ==========================================
  // VIEW SWITCHER & NAVIGATION
  // ==========================================
  function switchView(viewName) {
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
    }
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

  // ==========================================
  // TELEMETRY, TOP KPI STRIP & WORKSPACE PULSE
  // ==========================================
  function renderTelemetry() {
    var dict = i18n[lang] || i18n.en;
    var score = snapshot.score || {};
    var savings = score.contextSavings || { beforeTokens: 0, afterTokens: 0, savedTokens: 0, savingsPercent: 0, userStaticRuleTokens: 0, evoSeedTokens: 0 };
    var hasScore = score && typeof score.overallScore === 'number';
    var overall = hasScore ? score.overallScore : null;
    var grade = hasScore ? (score.grade || (overall >= 95 ? 'A+' : (overall >= 85 ? 'A' : (overall >= 70 ? 'B' : (overall >= 55 ? 'C' : (overall >= 40 ? 'D' : 'F')))))) : null;

    // 1. Health Score
    if (el('bento-health-val')) el('bento-health-val').textContent = hasScore ? String(overall) : '—';
    if (el('bento-health-grade')) el('bento-health-grade').textContent = hasScore ? (dict.gradePrefix + grade) : '—';
    if (el('bento-health-sub')) el('bento-health-sub').textContent = dict.healthSub;

    // 2. Positive Token Savings Framing (S2.2 / [SCORE-1])
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
        savedHeadline = lang === 'zh' ? '固定 L0 网关' : 'Fixed L0 Gateway';
        savedTransition = afterCompact + ' tok (KV-shielded)';
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

    // 3. Core Rule Budget
    var coreTokens = computeActiveCoreTokens();
    if (el('bento-budget-cur')) el('bento-budget-cur').textContent = String(coreTokens);
    var budgetPct = Math.min(100, Math.round((coreTokens / 1500) * 100));
    var budgetBar = el('bento-budget-bar');
    var budgetStatus = el('bento-budget-status');

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

    // 4. Micro Treemap Footprint + Semantic Kind Legend (S3.6)
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

    // 5. Left-Rail 7-Day Recall Card & Responsive Center-Stage Top KPI Summary Strip (S2.1)
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
    if (el('kpi-strip-budget-val')) el('kpi-strip-budget-val').textContent = coreTokens + ' / 1500 tok';
    if (el('kpi-strip-recall-lbl')) el('kpi-strip-recall-lbl').textContent = dict.kpiRecall7d;
    if (el('kpi-strip-recall-val')) {
      el('kpi-strip-recall-val').textContent = w7.searches + ' ' + dict.kpiSearchesShort + ' · ' + w7.helped + ' ' + dict.kpiAdoptedShort;
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
      el('topbar-workspace-pill').title = dict.activeWorkspace + ': ' + wsRoot;
    }

    renderWorkspacePulsePlaceholder(ruleCount, skillCount, toolCount, memoryCount, hasScore ? overall : null, grade, w7);
    renderHealthDiagnosticsBanner(coreTokens);
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

    var healthStr = overall !== null ? (overall + ' / 100 (' + dict.gradePrefix + grade + ')') : '—';
    var memRatioStr = verifiedMems + ' / ' + activeMems.length;

    pulseBody.innerHTML =
      '<div class="pulse-card" id="pulse-card">' +
        '<div class="pulse-card-hdr">' + esc(dict.pulseCardTitle) + '</div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.healthTitle) + '</span><strong class="mono-val">' + esc(healthStr) + '</strong></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.pulseActiveCaps) + '</span><strong class="mono-val">' + activeTotal + ' (' + ruleCount + 'R · ' + skillCount + 'S · ' + toolCount + 'T · ' + memoryCount + 'M)</strong></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.pulseVerifiedMems) + '</span><strong class="mono-val text-emerald">' + esc(memRatioStr) + '</strong></div>' +
      '</div>' +
      '<div class="pulse-card" id="recall-7d-card">' +
        '<div class="pulse-card-hdr">' + esc(dict.recallCardTitle) + '</div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.recallSearches) + '</span><strong class="mono-val">' + w7.searches + '</strong></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.recallInspected) + '</span><strong class="mono-val">' + w7.inspected + '</strong></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.recallToolsRun) + '</span><strong class="mono-val">' + w7.toolsExecuted + '</strong></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.recallAdopted) + '</span><strong class="mono-val text-emerald">' + w7.helped + '</strong></div>' +
        '<div class="pulse-stat-row"><span>' + esc(dict.recallPitfalls) + '</span><strong class="mono-val">' + w7.pitfallsAvoided + '</strong></div>' +
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
    if (coreTokens >= 1200) {
      itemsHtml.push(
        '<button type="button" class="diag-chip diag-chip-warn" data-diag-action="filter-core">' +
          ICONS.box + '<span>' + esc(dict.diagCoreMsg.replace('{cur}', String(coreTokens))) + '</span>' +
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
        } else if (k === 'rules' && it.core && coreTokens > 1500) {
          reason = dict.attentionReasonBudget + ' (' + coreTokens + '/1500)';
          tone = 'danger';
        }
        var key = k + ':' + it.id;
        if (reason && !seenIds[key]) {
          seenIds[key] = true;
          attentionItems.push({ kind: k, item: it, reason: reason, tone: tone });
        }
      });
    });

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
  function formatMemoryStatusLabel(st) {
    var dict = i18n[lang] || i18n.en;
    if (lang !== 'zh') return st;
    if (st === 'VERIFIED') return dict.statusVerified;
    if (st === 'STALE') return dict.statusStale;
    if (st === 'ORPHANED') return dict.attentionReasonOrphaned;
    if (st === 'OTHER_BRANCH') return dict.legendContested;
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
    var archivedCount = (snapshot.archived || []).length;
    var staleList = [];
    (snapshot.memories || []).forEach(function(m) {
      if (m.enabled !== false && m.freshness && m.freshness.overall_status === 'STALE') {
        staleList.push({ kind: 'memory', id: m.id });
      }
    });

    var pillPending = el('pill-status-pending');
    if (pillPending) {
      pillPending.innerHTML = ICONS.bell + ' <span>' + esc(dict.statusPending + (pendingCount > 0 ? ' (' + pendingCount + ')' : '')) + '</span>';
    }
    var pillArchived = el('pill-status-archived');
    if (pillArchived) {
      pillArchived.innerHTML = ICONS.trash + ' <span>' + esc(dict.statusArchived + (archivedCount > 0 ? ' (' + archivedCount + ')' : '')) + '</span>';
    }

    var btnApproveAll = el('btn-batch-approve-pending');
    if (btnApproveAll) {
      btnApproveAll.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
      btnApproveAll.innerHTML = ICONS.check + ' <span>' + esc(dict.batchApprovePending + ' (' + pendingCount + ')') + '</span>';
    }
    var btnPauseStale = el('btn-batch-pause-stale');
    if (btnPauseStale) {
      btnPauseStale.style.display = staleList.length > 0 ? 'inline-flex' : 'none';
      btnPauseStale.innerHTML = ICONS.pause + ' <span>' + esc(dict.batchPauseStale + ' (' + staleList.length + ')') + '</span>';
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

    if (countLabel) countLabel.textContent = rows.length + ' ' + dict.itemsCountSuffix;

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
      if (isArchived) {
        actionCol = '<div class="row-actions-wrap">' +
          '<button type="button" class="btn-action row-restore-btn" data-kind="' + k + '" data-id="' + esc(it.id) + '">' + esc(dict.restore) + '</button>' +
        '</div>';
      } else {
        actionCol = '<div class="row-actions-wrap">' +
          (isPending ? '<button type="button" class="btn-action row-approve-btn" style="border-color:var(--status-ok-border);color:var(--status-ok);" title="' + esc(dict.approve) + '">' + esc(dict.approve) + '</button>' : '') +
          '<button type="button" class="btn-action row-toggle-btn" title="' + esc(isEnabled ? dict.pauseItem : dict.resumeItem) + '">' + (isEnabled ? (ICONS.pause + '<span>' + esc(dict.pauseItem) + '</span>') : esc(dict.resumeItem)) + '</button>' +
          '<button type="button" class="btn-action btn-danger row-archive-btn" title="' + esc(dict.archive) + '" aria-label="' + esc(dict.archive) + '">' + ICONS.trash + '</button>' +
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
          callKernelAction('approve-item', { kind: singularKind(k), id: it.id }).then(function(res) {
            var curDict = i18n[lang] || i18n.en;
            if (res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              else it.review_status = 'approved';
              rerenderAllViews();
              showToast('success', (lang === 'zh' ? '已确认 ' : 'Approved ') + it.id);
            } else if (!res.offlineExport) {
              showToast('error', res.error || curDict.errApproveFailed);
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
            var curDict = i18n[lang] || i18n.en;
            if (res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              else it.enabled = nextEnabled;
              rerenderAllViews();
              showToast('success', (nextEnabled ? (lang === 'zh' ? '已启用 ' : 'Enabled ') : (lang === 'zh' ? '已搁置 ' : 'Paused ')) + it.id);
            } else if (!res.offlineExport) {
              showToast('error', res.error || curDict.errToggleFailed);
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
            var curDict = i18n[lang] || i18n.en;
            if (res.ok) {
              if (res.snapshot) snapshot = res.snapshot;
              rerenderAllViews();
              showToast('success', (lang === 'zh' ? '已从回收站恢复 ' : 'Restored ') + it.id);
            } else if (!res.offlineExport) {
              showToast('error', res.error || curDict.errRestoreFailed);
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
    var tools = (snapshot.tools || []).filter(function(t) { return t.enabled !== false; });
    var memories = (snapshot.memories || []).filter(function(m) { return m.enabled !== false; });

    var leftNodes = [];
    rules.forEach(function(r) {
      leftNodes.push({ id: 'rule:' + r.id, raw: r, kind: 'rules', label: r.title || r.id, sub: r.id, core: r.core });
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
        if (matched || (ln.raw.core && midNodes.indexOf(mn) < 3)) {
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
      path.setAttribute('stroke', 'var(--border-active)');
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

      // Semantic kind accent bar on capability & memory cards (S3.6)
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
            if (res.ok) showToast('success', dict.openedInIdeToast.replace('{path}', locRef));
            else if (!res.offlineExport) showToast('error', res.error || dict.openFileFailedToast);
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

  // ==========================================
  // VIEW 3: GIT FRAGILE HOTSPOTS VIEW
  // ==========================================
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
      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn-action';
      openBtn.textContent = dict.openShort;
      openBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
          if (res.ok) showToast('success', dict.openedInIdeToast.replace('{path}', h.filePath));
          else if (!res.offlineExport) showToast('error', res.error || dict.openFileFailedToast);
        });
      });
      tdAction.appendChild(openBtn);

      tr.appendChild(tdPath);
      tr.appendChild(tdFrag);
      tr.appendChild(tdCommits);
      tr.appendChild(tdMems);
      tr.appendChild(tdStatus);
      tr.appendChild(tdAction);

      function openHotspotFile() {
        var curDict = i18n[lang] || i18n.en;
        callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
          if (res.ok) showToast('success', curDict.openedInIdeToast.replace('{path}', h.filePath));
          else if (!res.offlineExport) showToast('error', res.error || curDict.openFileFailedToast);
        });
      }

      tr.addEventListener('click', openHotspotFile);
      tr.addEventListener('keydown', function(e) {
        if (e.target !== tr && e.target.closest('button')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openHotspotFile();
        }
      });

      tbody.appendChild(tr);
    });
  }

  // ==========================================
  // VIEW 4: GATEKEEPER AUDIT STREAM
  // ==========================================
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
      card.className = 'gk-event-card';

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
      boxEl.appendChild(card);
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

    // 1. Header
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
    bodyEl.appendChild(header);

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
            rerenderAllViews();
            if (!selectedCapability) renderInspector();
            showToast('success', (lang === 'zh' ? '已从回收站恢复 ' : 'Restored ') + item.id);
          } else if (!res.offlineExport) {
            showToast('error', res.error || dict.errRestoreFailed);
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
              rerenderAllViews();
              showToast('success', (lang === 'zh' ? '已确认 ' : 'Approved ') + item.id);
            } else if (!res.offlineExport) {
              showToast('error', res.error || dict.errApproveFailed);
            }
          });
        });
        toolbar.appendChild(btnApprove);
      }

      // Button: Pause / Enable
      var btnPause = document.createElement('button');
      btnPause.type = 'button';
      btnPause.className = 'btn-action';
      btnPause.innerHTML = isPaused ? esc(dict.resumeItem) : (ICONS.pause + '<span>' + esc(dict.pauseItem) + '</span>');
      btnPause.addEventListener('click', function() {
        var nextEnabled = isPaused ? true : false;
        callKernelAction('toggle-enabled', { kind: singularKind(kind), id: item.id, enabled: nextEnabled }).then(function(res) {
          if (res.ok) {
            item.enabled = nextEnabled;
            if (res.snapshot) snapshot = res.snapshot;
            rerenderAllViews();
            showToast('success', (nextEnabled ? (lang === 'zh' ? '已启用 ' : 'Enabled ') : (lang === 'zh' ? '已搁置 ' : 'Paused ')) + item.id);
          } else if (!res.offlineExport) {
            showToast('error', res.error || dict.errToggleFailed);
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
            filePath = '.evo/memories/' + item.id + '.md';
          }
        } else if (kind === 'rules') {
          filePath = item.core ? ('.evo/rules/' + item.id + '.md') : ('.evo/rules/scoped/' + item.id + '.md');
        } else if (kind === 'skills') {
          filePath = '.evo/skills/' + item.id + '/SKILL.md';
        } else if (kind === 'tools') {
          filePath = item.script_path || ('.evo/tools/' + item.id + '/' + (item.entry_script || 'run.mjs'));
        }
        if (filePath) {
          var targetRef = filePath + (line > 1 ? ':' + line : '');
          callKernelAction('open-editor', { filePath: filePath, line: line }).then(function(res) {
            if (res.ok) showToast('success', dict.openedInIdeToast.replace('{path}', targetRef));
            else if (!res.offlineExport) showToast('error', res.error || dict.openFileFailedToast);
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
              rerenderAllViews();
              showToast('success', lang === 'zh' ? 'AST 源码锚点校验完成' : 'AST verification complete');
            } else if (!res.offlineExport) {
              showToast('error', res.error || dict.errVerifyFailed);
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
              } else {
                item.core = !item.core;
              }
              rerenderAllViews();
              var tokNow = (res.data && res.data.tokenUsage !== undefined) ? res.data.tokenUsage : (res.tokenUsage || 0);
              showToast(
                'success',
                selectedCapability.item.core
                  ? dict.ruleMovedCoreToast.replace('{tok}', String(tokNow))
                  : dict.ruleMovedScopedToast
              );
            } else if (!res.offlineExport) {
              showToast('error', res.error || dict.errToggleTierFailed);
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
      btnEdit.innerHTML = inspectorMode === 'edit' ? (ICONS.eye + '<span>' + esc(dict.preview) + '</span>') : (ICONS.edit + '<span>' + esc(dict.edit) + '</span>');
      btnEdit.addEventListener('click', function() {
        inspectorMode = inspectorMode === 'edit' ? 'preview' : 'edit';
        renderInspector();
      });
      toolbar.appendChild(btnEdit);

      // Button: Archive (Uses Undo Toast for Webview compatibility)
      var btnArchive = document.createElement('button');
      btnArchive.type = 'button';
      btnArchive.className = 'btn-action btn-danger';
      btnArchive.innerHTML = ICONS.trash + '<span>' + esc(dict.archive) + '</span>';
      btnArchive.addEventListener('click', function() {
        archiveAndOfferUndo(kind, item.id);
      });
      toolbar.appendChild(btnArchive);
    }

    bodyEl.appendChild(toolbar);

    // 2.5 One-Sentence Core Takeaway (TL;DR Card) for all capability types
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

    // 2.8 STALE / OTHER_BRANCH Action Banner (Memories)
    if (!isArchived && kind === 'memories' && (fresh === 'STALE' || fresh === 'OTHER_BRANCH')) {
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
          btnRebind.textContent = dict.rebindingAst;
          callKernelAction('rebind-memory-ast', { id: item.id }).then(function(res) {
            btnRebind.innerHTML = ICONS.refresh + '<span>' + esc(dict.rebindAst) + '</span>';
            if (res.ok && res.snapshot) {
              snapshot = res.snapshot;
              rerenderAllViews();
              showToast('success', lang === 'zh' ? '已重新锚定当前分支源码' : 'AST re-bound to current branch');
            } else if (!res.offlineExport) {
              showToast('error', res.error || dict.errRebindFailed);
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
          var curDict = i18n[lang] || i18n.en;
          var anchorRef = anchor.file_path + ':' + startLine;
          callKernelAction('open-editor', { filePath: anchor.file_path, line: startLine }).then(function(res) {
            if (res.ok) showToast('success', curDict.openedInIdeToast.replace('{path}', anchorRef));
            else if (!res.offlineExport) showToast('error', res.error || curDict.openFileFailedToast);
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

    // 4. Body Section: Preview vs Editor
    var bodySection = document.createElement('div');
    bodySection.className = 'inspector-section';

    if (inspectorMode === 'edit') {
      bodySection.innerHTML =
        '<div class="inspector-section-title"><span>' + esc(dict.inlineEditorTitle) + '</span></div>' +
        '<textarea class="editor-textarea" id="inspector-editor-input"></textarea>' +
        '<div class="editor-footer">' +
          '<span id="editor-token-est">~0 ' + esc(dict.tokensEstSuffix) + '</span>' +
          '<div style="display:flex;gap:6px;">' +
            '<button type="button" class="btn-action" id="btn-editor-cancel">' + esc(dict.cancel) + '</button>' +
            '<button type="button" class="btn-action" id="btn-editor-save" style="background:var(--status-ok);color:#022c22;font-weight:700;">' + esc(dict.saveChanges) + '</button>' +
          '</div>' +
        '</div>';
      bodyEl.appendChild(bodySection);

      var txtInput = bodySection.querySelector('#inspector-editor-input');
      var rawText = kind === 'tools'
        ? (item.script_code || '')
        : (item.content ||
          (item.l1_contract ? ('## L1 Contract\\n' + item.l1_contract + '\\n\\n## L2 SOP\\n' + item.l2_sop) :
          (item.symptom ? ('## Symptom\\n' + item.symptom + '\\n\\n## Root Cause\\n' + item.root_cause + '\\n\\n## Solution\\n' + item.solution) :
          '')));
      txtInput.value = rawText;

      var tokenEstEl = bodySection.querySelector('#editor-token-est');
      function updateTokenEstimate() {
        if (tokenEstEl) tokenEstEl.textContent = '~' + Math.ceil(txtInput.value.length / 4) + ' ' + dict.tokensEstSuffix;
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

      bodySection.querySelector('#btn-editor-cancel').addEventListener('click', function() {
        inspectorMode = 'preview';
        renderInspector();
      });

      bodySection.querySelector('#btn-editor-save').addEventListener('click', function() {
        var nextBody = txtInput.value;
        callKernelAction('update-content', { kind: singularKind(kind), id: item.id, content: nextBody }).then(function(res) {
          if (res.ok) {
            showToast('success', (lang === 'zh' ? '已保存变更：' : 'Changes saved to ') + item.id);
            if (res.snapshot) {
              snapshot = res.snapshot;
            } else {
              if (kind === 'tools') item.script_code = nextBody;
              else item.content = nextBody;
            }
            inspectorMode = 'preview';
            rerenderAllViews();
          } else {
            if (res.snapshot) {
              snapshot = res.snapshot;
              rerenderAllViews();
            }
            if (!res.offlineExport) {
              showToast('error', res.error || dict.errSaveFailed);
            }
          }
        });
      });
    } else {
      // Structured Bento Preview with formatted inline code
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

    // 5. Tool Sandbox Terminal Section
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

    callKernelAction('run-tool-test', { id: toolId }).then(function(res) {
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
            var curDict = i18n[lang] || i18n.en;
            callKernelAction('open-editor', { filePath: h.filePath, line: 1 }).then(function(res) {
              if (res.ok) showToast('success', curDict.openedInIdeToast.replace('{path}', h.filePath));
              else if (!res.offlineExport) showToast('error', res.error || curDict.openFileFailedToast);
            });
            closeCommandPalette();
          }
        };
        row.addEventListener('click', actItem.execute);
        listBoxEl.appendChild(row);
        cmdItems.push({ el: row, action: actItem.execute });
      });
    }

    // Group 3: Global Actions
    var globalCmds = [
      {
        title: dict.cmdVerifyTitle,
        sub: dict.cmdVerifySub,
        run: function() {
          showToast('info', dict.verifyingAst);
          callKernelAction('verify-memory', {}).then(function(res) {
            if (res.ok && res.snapshot) {
              snapshot = res.snapshot;
              rerenderAllViews();
              showToast('success', lang === 'zh' ? '已完成全部 AST 记忆校验' : 'Verified AST memories');
            } else if (!res.offlineExport) {
              showToast('error', res.error || dict.errVerifyFailed);
            }
          });
        }
      },
      {
        title: dict.cmdSwitchCapsTitle,
        sub: dict.cmdSwitchCapsSub,
        run: function() { switchView('capabilities'); }
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
    ];

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

    if (el('sse-disconnect-msg')) el('sse-disconnect-msg').textContent = dict.sseDisconnectedMsg;
    if (el('btn-sse-reconnect')) el('btn-sse-reconnect').textContent = dict.sseReconnectBtn;

    // Input Placeholders
    if (el('caps-search-input')) el('caps-search-input').placeholder = dict.capsSearchPlaceholder;
    if (el('mem-search')) el('mem-search').placeholder = dict.hotspotsSearchPlaceholder;
    if (el('cmd-palette-input')) el('cmd-palette-input').placeholder = dict.cmdInputPlaceholder;
    if (el('cmd-palette-modal')) el('cmd-palette-modal').setAttribute('aria-label', dict.cmdModalAriaLabel);

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
    if (el('caps-empty-state')) el('caps-empty-state').textContent = dict.capsEmptyState;
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
    renderHotspotsTable();
    renderGatekeeperStream();
    if (currentView === 'topology') renderCardTopology();
    if (selectedCapability) renderInspector();
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
    healthDiagExpanded = !healthDiagExpanded;
    switchView('capabilities');
    renderHealthDiagnosticsBanner();
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
          rerenderAllViews();
          var approvedCount = (res.data && res.data.approvedCount !== undefined) ? res.data.approvedCount : (res.approvedCount || 0);
          showToast('success', (lang === 'zh' ? '已批量确认 ' : 'Approved ') + approvedCount + (lang === 'zh' ? ' 项待审能力' : ' pending capabilities'));
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
          rerenderAllViews();
          showToast('success', (lang === 'zh' ? '已搁置 ' : 'Paused ') + staleList.length + (lang === 'zh' ? ' 条失效记忆' : ' stale memories'));
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

  var btnExport = el('btn-export-html');
  if (btnExport) {
    btnExport.addEventListener('click', function() {
      var dict = i18n[lang] || i18n.en;
      if (isExport && !vscodeApi) {
        showToast('info', dict.exportViewingToast);
      } else if (vscodeApi) {
        callKernelAction('export-html', {}).then(function(res) {
          if (res.ok) {
            var outPathVal = (res.data && res.data.path) || (res.result && res.result.path) || '';
            showToast('success', (lang === 'zh' ? '已导出独立 HTML 报告' : 'Exported standalone HTML') + (outPathVal ? ': ' + outPathVal : ''));
          } else if (res.error && res.error !== 'Export cancelled') {
            showToast('error', res.error);
          }
        });
      } else if (token) {
        var dlUrl = '/api/export?token=' + encodeURIComponent(token);
        var dlLink = document.createElement('a');
        dlLink.href = dlUrl;
        dlLink.download = 'evokernel-cockpit-snapshot.html';
        document.body.appendChild(dlLink);
        dlLink.click();
        document.body.removeChild(dlLink);
        showToast('success', lang === 'zh' ? '正在导出独立 HTML 报告...' : 'Downloading standalone HTML report...');
      } else {
        showToast('info', dict.exportCliHintToast);
      }
    });
  }

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
    if (isExport && !vscodeApi) {
      if (dot) {
        dot.classList.remove('offline');
        dot.classList.add('snapshot');
      }
      if (label) label.textContent = dict.serverSnapshot;
      if (statusWrap) statusWrap.title = dict.serverSnapshotTitle;
      if (sseBanner) sseBanner.style.display = 'none';
      return;
    }
    if (dot) {
      dot.classList.remove('snapshot');
      dot.classList.toggle('offline', sseOffline);
    }
    if (label) label.textContent = sseOffline ? dict.serverOffline : dict.serverLive;
    if (statusWrap) statusWrap.title = sseOffline ? dict.serverOffline : dict.serverLive;
    if (sseBanner) sseBanner.style.display = sseOffline ? 'flex' : 'none';
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
        updateServerStatusUi(true);
        if (!wasOffline) {
          var curDict = i18n[lang] || i18n.en;
          showToast('warn', curDict.sseDisconnectedToast);
        }
        scheduleSseReconnect();
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
      var inspEl = el('right-inspector');
      if (inspEl) inspEl.classList.remove('open');
    });
  }

  // Initial Render
  applyI18n();
  switchView('capabilities');
  renderHotspotsTable();
  startSseEventStream();
})();
`.trim().replace(/\r\n/g, '\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EvoKernel Workbench</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2L4 6v6c0 5.25 3.4 10.1 8 11.4 4.6-1.3 8-6.15 8-11.4V6l-8-4z'/%3E%3Cpath d='M9 12l2 2 4-4'/%3E%3C/svg%3E">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
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
    .bento-card:hover {
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

    /* Responsive Top KPI Summary Strip (S2.1 — surfaces rail KPIs when rail collapses <=768px) */
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

    /* Needs Attention Pinned Group (S2.1) */
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
    .attention-item-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .filter-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      min-width: 0;
    }
    /* Horizontal Scrollable Filter Pills (S2.5) */
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
        width: 100px;
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

    /* Reduced Motion Accessibility (S2.4) */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
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
      <button class="topbar-btn" id="btn-export-html" type="button" title="Export Standalone HTML">
        <span id="btn-export-label">Export</span>
      </button>
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

      <!-- View 1: Capabilities Data Table -->
      <section class="view-panel active" id="view-capabilities">
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
            No capabilities match the current filter.
          </div>
        </div>
      </section>

      <!-- View 2: Orthogonal Round-Rect Card Topology -->
      <section class="view-panel" id="view-topology">
        <div class="view-header" id="topo-view-header">
          <div class="topo-header-row">
            <div>
              <h2 class="view-title" id="topo-view-title">Orthogonal Capability &amp; AST* Topology</h2>
              <p class="view-subtitle" id="topo-view-sub">Rules &amp; Skills &rarr; Cognitive Memories &rarr; Source Files &amp; Callers</p>
            </div>
            <div class="topo-legend" id="topo-legend">
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
        <div class="ast-footnote" id="topo-ast-footnote">* AST refers to EvoKernel's zero-dependency lexical-structural symbol &amp; body-hash fingerprint.</div>
      </section>

      <!-- View 3: Git Fragile Hotspots View -->
      <section class="view-panel" id="view-hotspots">
        <div class="view-header" id="hotspots-view-header">
          <div class="hotspots-header-row">
            <div>
              <h2 class="view-title" id="hotspots-view-title">Fragile Git Hotspots &amp; AST* Shielding Matrix</h2>
              <p class="view-subtitle" id="hotspots-view-sub">High-churn files tracked by bug-fix commits and shielded by cognitive memories</p>
            </div>
            <div class="hotspots-header-controls">
              <input type="text" id="mem-search" class="search-input" placeholder="Filter hotspots or bound memories..." autocomplete="off" />
              <div class="hotspots-kpi-badge" id="hotspots-summary-kpi">0 / 0 Protected</div>
            </div>
          </div>
        </div>
        <div class="table-scroll-container">
          <table class="data-table" id="hotspots-table">
            <thead>
              <tr>
                <th id="th-hs-path">Source File Path</th>
                <th id="th-hs-frag">Fragility Score</th>
                <th id="th-hs-commits">Fix Commits</th>
                <th id="th-hs-mems">Bound AST* Shielding Memories</th>
                <th id="th-hs-status">Status</th>
                <th id="th-hs-action">Action</th>
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
              <h2 class="view-title" id="gk-view-title">Deterministic Gatekeeper Audit Stream</h2>
              <p class="view-subtitle" id="gk-view-sub">Proposal audit timeline: Static Security, Sandbox --self-test exit(0), AST* Grounding, BM25/Budget Quota</p>
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
