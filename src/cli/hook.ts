import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { renderAuditReport, runAudit } from './audit.js';

export type HookEvent = 'post-tool' | 'stop' | 'pre-commit' | 'mark-recovery';

export interface HookOptions {
  workspaceRoot?: string;
  event?: HookEvent | string;
  payload?: Record<string, unknown> | string;
  stdinData?: string;
  toolName?: string;
  targetFile?: string;
  dryRun?: boolean;
}

export interface HookResult {
  event: HookEvent;
  success: boolean;
  exitCode: number;
  output: string;
  recalledRules?: string[];
  crystallizationSuggested?: boolean;
  dirtyRuleId?: string;
  auditPassed?: boolean;
  errors?: string[];
}

const EDIT_TOOL_NAMES = new Set([
  'edit',
  'multiedit',
  'write',
  'notebookedit',
  'edit_file',
  'write_file',
  'write_to_file',
  'create_file',
  'replace_file_content',
  'multi_replace_file_content',
  'str_replace_editor',
  'apply_patch',
  'patch',
  'execute_command',
  'run_command',
  'bash',
]);

export const READ_TOOL_NAMES = new Set([
  'read',
  'read_file',
  'view_file',
  'view_file_outline',
  'view_code_item',
  'grep',
  'grep_search',
  'glob',
  'find_by_name',
  'codegraph_explore',
  'codegraph_node',
  'codegraph_callers',
  'codegraph_callees',
  'codegraph_impact',
]);

export const CORRECTION_REGEX =
  /(?:不对|错了|还是有|乱码|漏了|为什么(?:把|会|没|要|不|是)|怎么会|难道不是|不就是|不是吗|这么理解对吗|@\[Quote\]|已经确认|实测.*(?:发现|却是|不对|不行)|实际.*(?:显示|追不上|掉|不对|不行|却是)|但(?:实验室|实际|现场)|(?:分析|前面的)?推断是否合理|重新核实|怎么回事|我不是说了|不一致|重新检查|没改对|不生效|回退|不要把|只有一半|显示不全|稍微精简|精简一些|太详细|太啰嗦|吃力|费劲|不美观|不要冲突|不要重复|重写|重新整理|调整一下|换一种|格式不对|格式有误|you broke|still broken|that's wrong|incorrect|regression|why would|isn't it|shouldn't it|confirmed that|actually[\s,]|in fact[\s,])/i;

export function isUserCorrectionSignal(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return CORRECTION_REGEX.test(text);
}

const FORBIDDEN_STAGED_PATTERNS = [
  /\.evo\/\.cache\//,
  /\.evo\/telemetry\.db(?:-wal|-shm)?$/,
];

export function matchesScopeGlob(filePath: string, scopeGlob: string): boolean {
  if (!scopeGlob || scopeGlob === '*' || scopeGlob === '**/*') return true;
  const normalizedFile = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const normalizedGlob = scopeGlob.replace(/\\/g, '/').replace(/^\/+/, '');

  let pattern = normalizedGlob.replace(/\{([^}]+)\}/g, (_match, group) => {
    const parts = group.split(',').map((p: string) => p.trim());
    return `__BRACE_OPEN__${parts.join('__BRACE_OR__')}__BRACE_CLOSE__`;
  });

  let regexStr = pattern
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '__GLOBSTAR_SLASH__')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '__STAR__')
    .replace(/\?/g, '__QUESTION__');

  regexStr = regexStr
    .replace(/__GLOBSTAR_SLASH__/g, '(?:.*\\/)?')
    .replace(/__GLOBSTAR__/g, '.*')
    .replace(/__STAR__/g, '[^\\/]*')
    .replace(/__QUESTION__/g, '[^\\/]')
    .replace(/__BRACE_OPEN__/g, '(?:')
    .replace(/__BRACE_OR__/g, '|')
    .replace(/__BRACE_CLOSE__/g, ')');

  const regex = new RegExp(`^${regexStr}$`, 'i');
  return regex.test(normalizedFile);
}

export function parseHookEvent(args: string[]): HookEvent {
  const eqArg = args.find((a) => a.startsWith('--event='));
  if (eqArg) {
    return normalizeHookEvent(eqArg.slice('--event='.length));
  }
  const idx = args.indexOf('--event');
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return normalizeHookEvent(args[idx + 1]);
  }
  if (args[1] && !args[1].startsWith('-')) {
    return normalizeHookEvent(args[1]);
  }
  return 'stop';
}

export function normalizeHookEvent(raw: string): HookEvent {
  const clean = (raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (clean === 'post-tool' || clean === 'posttool') return 'post-tool';
  if (clean === 'stop') return 'stop';
  if (clean === 'pre-commit' || clean === 'precommit') return 'pre-commit';
  if (clean === 'mark-recovery' || clean === 'recovery') return 'mark-recovery';
  return 'stop';
}

export function parseHookPayloadArg(args: string[]): Record<string, unknown> | undefined {
  const eqArg = args.find((a) => a.startsWith('--payload='));
  if (eqArg) {
    try {
      return JSON.parse(eqArg.slice('--payload='.length)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  const idx = args.indexOf('--payload');
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    try {
      return JSON.parse(args[idx + 1]) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  const toolIdx = args.indexOf('--tool');
  const fileIdx = args.indexOf('--file');
  if (toolIdx !== -1 || fileIdx !== -1) {
    const p: Record<string, unknown> = {};
    if (toolIdx !== -1 && args[toolIdx + 1]) p.tool_name = args[toolIdx + 1];
    if (fileIdx !== -1 && args[fileIdx + 1]) p.path = args[fileIdx + 1];
    return p;
  }
  return undefined;
}

function resolvePayload(options: HookOptions): Record<string, unknown> {
  if (options.payload && typeof options.payload === 'object') {
    return options.payload;
  }
  if (typeof options.payload === 'string') {
    try {
      return JSON.parse(options.payload) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof options.stdinData === 'string') {
    try {
      return JSON.parse(options.stdinData) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (
    options.stdinData === undefined &&
    !process.stdin.isTTY &&
    !process.argv[1]?.endsWith('.test.js')
  ) {
    try {
      const rawStdin = fs.readFileSync(0, 'utf8').trim();
      if (rawStdin) {
        return JSON.parse(rawStdin) as Record<string, unknown>;
      }
    } catch {
      // Ignore empty/unavailable stdin or invalid JSON
    }
  }
  return {};
}

function getGitFiles(workspaceRoot: string, stagedOnly: boolean): string[] {
  try {
    const cmd = stagedOnly ? 'git diff --cached --name-only' : 'git status --porcelain';
    const out = execSync(cmd, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    if (stagedOnly) {
      return out
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
    }
    const files: string[] = [];
    for (const line of out.split(/\r?\n/)) {
      if (line.length <= 3) continue;
      let filePath = line.slice(3).trim();
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ').pop()!.trim();
      }
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }
      if (filePath) files.push(filePath);
    }
    return files;
  } catch {
    return [];
  }
}

export function handlePostTool(
  workspaceRoot: string,
  payload: Record<string, unknown>,
  options: HookOptions
): HookResult {
  const toolName = String(
    payload.tool_name ||
    payload.tool ||
    payload.name ||
    payload.ToolName ||
    options.toolName ||
    ''
  ).toLowerCase();

  const toolInput = (payload.tool_input || payload.input || payload.Arguments || payload.args || {}) as Record<string, unknown>;
  const innerArgs = (toolInput.Arguments || toolInput.args || toolInput) as Record<string, unknown>;
  const innerToolName = String(
    toolInput.ToolName ||
    toolInput.tool_name ||
    payload.inner_tool_name ||
    ''
  ).toLowerCase();
  const serverName = String(
    toolInput.ServerName ||
    toolInput.server_name ||
    payload.server_name ||
    ''
  ).toLowerCase();

  const rawPath = String(
    toolInput.path ||
    toolInput.Path ||
    toolInput.AbsolutePath ||
    toolInput.absolute_path ||
    toolInput.file ||
    toolInput.File ||
    toolInput.filePath ||
    toolInput.file_path ||
    toolInput.TargetFile ||
    toolInput.target_file ||
    toolInput.SearchPath ||
    toolInput.search_path ||
    toolInput.SearchDirectory ||
    toolInput.search_directory ||
    innerArgs.path ||
    innerArgs.Path ||
    innerArgs.AbsolutePath ||
    innerArgs.file_path ||
    innerArgs.SearchPath ||
    innerArgs.SearchDirectory ||
    payload.path ||
    payload.AbsolutePath ||
    payload.file ||
    payload.filePath ||
    payload.file_path ||
    options.targetFile ||
    ''
  );

  const storage = new EvoStorage(workspaceRoot);
  const telemetry = new EvoTelemetry(storage);

  let output = '';
  const recalledRuleIds: string[] = [];

  const isEvoPropose =
    toolName.includes('evo_propose') ||
    innerToolName.includes('evo_propose') ||
    toolName.includes('evo_compact') ||
    innerToolName.includes('evo_compact');

  if (isEvoPropose) {
    const proposedId = String(innerArgs.id || 'capability');
    telemetry.setSessionFlag('last_crystallized_id', proposedId);
    telemetry.setSessionFlag('pending_evolution', 'false');
    telemetry.setSessionFlag('unproposed_edit_count', '0');
    telemetry.setSessionFlag('unproposed_read_count', '0');
    telemetry.setSessionFlag('user_correction_detected', 'false');
    telemetry.setSessionFlag('dirty_crystallized_id', '');
    output = `[EvoKernel Post-Tool] Capability '${proposedId}' registered. Session evolution debt cleared.`;
  } else {
    const normPath = rawPath.replace(/\\/g, '/');
    const isInternalMeta =
      Boolean(rawPath) &&
      (/(?:^|\/)\.(?:evo|agents|gemini)(?:\/|$)/i.test(normPath) ||
        normPath.includes('/.evo/') ||
        normPath.includes('/.agents/teamwork/') ||
        normPath.includes('/.gemini/antigravity/'));

    const isCodeGraphEvoRun =
      (toolName.includes('evo_run') || innerToolName.includes('evo_run')) &&
      String(innerArgs.tool_id || toolInput.tool_id || '').toLowerCase().includes('codegraph');

    const isMutation = toolName ? EDIT_TOOL_NAMES.has(toolName) : Boolean(rawPath);
    const isReadDiagnostic =
      !isMutation &&
      Boolean(toolName || innerToolName) &&
      (READ_TOOL_NAMES.has(toolName) ||
        READ_TOOL_NAMES.has(innerToolName) ||
        toolName.includes('codegraph') ||
        innerToolName.includes('codegraph') ||
        serverName.includes('codegraph') ||
        isCodeGraphEvoRun);

    if (isMutation && !isInternalMeta) {
      telemetry.setSessionFlag('pending_evolution', 'true');
      const currentCount = parseInt(telemetry.getSessionFlag('unproposed_edit_count') || '0', 10);
      telemetry.setSessionFlag('unproposed_edit_count', String(currentCount + 1));

      const lastCrystallized = telemetry.getSessionFlag('last_crystallized_id');
      if (lastCrystallized) {
        telemetry.setSessionFlag('dirty_crystallized_id', lastCrystallized);
      }
    } else if (isReadDiagnostic && !isInternalMeta) {
      const currentReadCount = parseInt(telemetry.getSessionFlag('unproposed_read_count') || '0', 10);
      telemetry.setSessionFlag('unproposed_read_count', String(currentReadCount + 1));
    }

    const userPromptCandidate = String(
      payload.user_message ||
      payload.user_prompt ||
      payload.prompt ||
      toolInput.user_message ||
      ''
    );
    if (isUserCorrectionSignal(userPromptCandidate)) {
      telemetry.setSessionFlag('user_correction_detected', 'true');
    }

    if (rawPath && !isInternalMeta) {
      const relPath = path.isAbsolute(rawPath)
        ? path.relative(workspaceRoot, rawPath).replace(/\\/g, '/')
        : normPath;

      const rules = storage.listRules();
      for (const rule of rules) {
        if (rule.scope_glob && matchesScopeGlob(relPath, rule.scope_glob)) {
          recalledRuleIds.push(rule.id);
        }
      }

      if (recalledRuleIds.length > 0) {
        const matchedDetails = recalledRuleIds
          .map((id) => {
            const r = storage.getRule(id);
            return r
              ? `  ├─ 🛡️  [${r.id}] ${r.title ? `${r.title} — ` : ''}${r.l0_summary}`
              : `  ├─ 🛡️  [${id}]`;
          })
          .join('\n');
        output = `[EvoKernel Post-Tool Active Rule Guardrail] Target '${relPath}' matched active invariant(s):\n${matchedDetails}`;
      }
    }
  }

  telemetry.close();

  return {
    event: 'post-tool',
    success: true,
    exitCode: 0,
    output,
    recalledRules: recalledRuleIds,
  };
}

export function handleStop(
  workspaceRoot: string,
  payload: Record<string, unknown>,
  _options: HookOptions
): HookResult {
  const storage = new EvoStorage(workspaceRoot);
  const telemetry = new EvoTelemetry(storage);

  const pending = telemetry.getSessionFlag('pending_evolution') === 'true';
  const dirtyId = telemetry.getSessionFlag('dirty_crystallized_id');
  const editCount = parseInt(telemetry.getSessionFlag('unproposed_edit_count') || '0', 10);
  const readCount = parseInt(telemetry.getSessionFlag('unproposed_read_count') || '0', 10);
  const persistedCorrection = telemetry.getSessionFlag('user_correction_detected') === 'true';

  const inlineUserText = String(
    payload.user_message ||
    payload.user_prompt ||
    payload.prompt ||
    payload.last_user_message ||
    ''
  );
  const hasUserCorrection = persistedCorrection || isUserCorrectionSignal(inlineUserText);
  if (hasUserCorrection) {
    telemetry.setSessionFlag('user_correction_detected', 'false');
  }

  const modifiedFiles = getGitFiles(workspaceRoot, false).filter((f) => {
    const norm = f.replace(/\\/g, '/');
    return (
      !norm.startsWith('.evo/') &&
      !norm.startsWith('.agents/teamwork/') &&
      !norm.startsWith('.git/')
    );
  });

  const hasUncrystallizedEdits = pending || editCount > 0 || modifiedFiles.length > 0;
  const hasHeavyDiagnosticReads = editCount < 4 && readCount >= 10;
  const crystallizationSuggested = hasUncrystallizedEdits || hasHeavyDiagnosticReads || hasUserCorrection;
  const messages: string[] = [];

  if (dirtyId) {
    messages.push(
      `⚠️  [EvoKernel Anti-Poisoning Alert] Source code was modified after capability '${dirtyId}' was crystallized in this session. Verify that '${dirtyId}' still matches final code or update it via evo_propose.`
    );
  }

  if (crystallizationSuggested) {
    let reasonSummary: string;
    if (hasUncrystallizedEdits) {
      reasonSummary = modifiedFiles.length > 0
        ? `(${modifiedFiles.slice(0, 3).join(', ')}${modifiedFiles.length > 3 ? ` +${modifiedFiles.length - 3} more` : ''})`
        : `(${editCount} mutation steps recorded)`;
    } else if (hasUserCorrection && hasHeavyDiagnosticReads) {
      reasonSummary = `(user correction / counter-question + ${readCount} read-only diagnostic steps)`;
    } else if (hasUserCorrection) {
      reasonSummary = `(user correction / counter-question detected)`;
    } else {
      reasonSummary = `(${readCount} read-only diagnostic steps with ${editCount} edits)`;
    }

    messages.push(
      `💡 [EvoKernel Hook Reminder] Session work detected without capability crystallization ${reasonSummary}:\n` +
      `  ├─ 🧠 Bug Fix / Defect Pattern : evo_propose(kind: "memory", symptom: "...", root_cause: "...", solution: "...", target_symbols: [...])\n` +
      `  ├─ 🛡️  Architectural Invariant  : evo_propose(kind: "rule", l0_summary: "...", scope_glob: "...") [zero magic numbers]\n` +
      `  └─ 🔧 Reusable Micro-Tool     : evo_propose(kind: "tool", ...) [--self-test verified]\n` +
      `  Output receipt in response: 🧬 EvoKernel 演进回执：[<kind>] <id>（<新增/更新摘要>）`
    );
  }

  telemetry.close();

  let finalOutput = messages.join('\n\n');
  if (payload.transcriptPath || payload.transcript_path) {
    const allowPayload = JSON.stringify({ decision: 'allow' });
    finalOutput = finalOutput ? `${finalOutput}\n${allowPayload}` : allowPayload;
  }

  return {
    event: 'stop',
    success: true,
    exitCode: 0,
    output: finalOutput,
    crystallizationSuggested,
    dirtyRuleId: dirtyId || undefined,
  };
}

export function handlePreCommit(
  workspaceRoot: string,
  _payload: Record<string, unknown>,
  _options: HookOptions
): HookResult {
  const stagedFiles = getGitFiles(workspaceRoot, true);
  const forbiddenStaged = stagedFiles.filter((file) => {
    const norm = file.replace(/\\/g, '/');
    return FORBIDDEN_STAGED_PATTERNS.some((pat) => pat.test(norm));
  });

  if (forbiddenStaged.length > 0) {
    const err =
      `❌ [EvoKernel Pre-Commit Hook] COMMIT BLOCKED: Forbidden internal cache or telemetry database file staged:\n` +
      forbiddenStaged.map((f) => `  - ${f}`).join('\n') +
      `\nRun \`git reset HEAD <file>\` and ensure it is excluded via \`evo init --stealth\`.`;
    return {
      event: 'pre-commit',
      success: false,
      exitCode: 1,
      output: err,
      errors: forbiddenStaged,
    };
  }

  const report = runAudit(workspaceRoot, { includeGlobal: false });
  if (!report.healthy) {
    const rendered = renderAuditReport(report);
    const err =
      `${rendered}\n\n` +
      `❌ [EvoKernel Pre-Commit Hook] COMMIT BLOCKED: Audit detected invariant violations.\n` +
      `Resolve rule budget violations (>1500 tokens), domain leaks, or redundancies before committing.`;
    return {
      event: 'pre-commit',
      success: false,
      exitCode: 1,
      output: err,
      auditPassed: false,
    };
  }

  return {
    event: 'pre-commit',
    success: true,
    exitCode: 0,
    output: `✅ [EvoKernel Pre-Commit Hook] All checks passed (healthy token budget, zero domain leaks, clean git staging). Commit allowed.`,
    auditPassed: true,
  };
}

export function runHook(rawEvent: string, options: HookOptions = {}): HookResult {
  const ws = path.resolve(options.workspaceRoot || process.cwd());
  const event = normalizeHookEvent(rawEvent || options.event || 'stop');
  const payload = event === 'post-tool' || event === 'stop' ? resolvePayload(options) : {};

  try {
    switch (event) {
      case 'post-tool':
        return handlePostTool(ws, payload, options);
      case 'stop':
        return handleStop(ws, payload, options);
      case 'pre-commit':
        return handlePreCommit(ws, payload, options);
      case 'mark-recovery': {
        const storage = new EvoStorage(ws);
        const telemetry = new EvoTelemetry(storage);
        telemetry.setSessionFlag('pending_evolution', 'true');
        telemetry.close();
        return {
          event: 'mark-recovery',
          success: true,
          exitCode: 0,
          output: '[EvoKernel Hook] Recovery marked.',
        };
      }
      default:
        return handleStop(ws, payload, options);
    }
  } catch (error) {
    if (event === 'pre-commit') {
      return {
        event,
        success: false,
        exitCode: 1,
        output: `[EvoKernel Hook Error] ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return {
      event,
      success: true,
      exitCode: 0,
      output: '',
    };
  }
}
