import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { executeSandboxedScript } from '../core/sandbox.js';
import { renderAuditReport, runAudit } from './audit.js';
import type { CapabilityOutcome, RecalledCapabilityEntry } from '../core/types.js';

export function recordRecalledOutcomeWithTierRouting(
  localStorage: EvoStorage,
  localTelemetry: EvoTelemetry,
  entry: RecalledCapabilityEntry,
  outcome: Exclude<CapabilityOutcome, 'neutral'>
): void {
  const existsLocally =
    Boolean(localStorage.getRule(entry.id)) ||
    Boolean(localStorage.getSkill(entry.id)) ||
    Boolean(localStorage.getTool(entry.id)) ||
    Boolean(localStorage.getMemory(entry.id));

  if (existsLocally && entry.tier !== 'GLOBAL') {
    localTelemetry.recordCapabilityOutcome(entry.id, outcome);
    return;
  }

  const globalRoot = process.env.EVO_GLOBAL_DIR
    ? path.resolve(process.env.EVO_GLOBAL_DIR)
    : path.join(os.homedir(), '.evo', 'global');

  if (fs.existsSync(path.join(globalRoot, '.evo'))) {
    const globalStorage = new EvoStorage(globalRoot);
    const existsGlobally =
      Boolean(globalStorage.getRule(entry.id)) ||
      Boolean(globalStorage.getSkill(entry.id)) ||
      Boolean(globalStorage.getTool(entry.id)) ||
      Boolean(globalStorage.getMemory(entry.id));

    if (existsGlobally) {
      const globalTelemetry = new EvoTelemetry(globalStorage);
      try {
        globalTelemetry.recordCapabilityOutcome(entry.id, outcome);
      } finally {
        globalTelemetry.close();
      }
      return;
    }
  }

  if (existsLocally) {
    localTelemetry.recordCapabilityOutcome(entry.id, outcome);
  }
}

export type HookEvent = 'pre-tool' | 'post-tool' | 'stop' | 'pre-commit' | 'mark-recovery';

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
  blocked?: boolean;
  triggeredHooks?: string[];
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

export function isKnownHookEvent(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim().toLowerCase().replace(/_/g, '-');
  return (
    clean === 'pre-tool' ||
    clean === 'pretool' ||
    clean === 'pretooluse' ||
    clean === 'pre-tool-use' ||
    clean === 'post-tool' ||
    clean === 'posttool' ||
    clean === 'posttooluse' ||
    clean === 'post-tool-use' ||
    clean === 'stop' ||
    clean === 'pre-commit' ||
    clean === 'precommit' ||
    clean === 'mark-recovery' ||
    clean === 'recovery'
  );
}

export function normalizeHookEvent(raw: string): HookEvent {
  const clean = (raw || '').trim().toLowerCase().replace(/_/g, '-');
  if (
    clean === 'pre-tool' ||
    clean === 'pretool' ||
    clean === 'pretooluse' ||
    clean === 'pre-tool-use'
  ) {
    return 'pre-tool';
  }
  if (
    clean === 'post-tool' ||
    clean === 'posttool' ||
    clean === 'posttooluse' ||
    clean === 'post-tool-use'
  ) {
    return 'post-tool';
  }
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
      const stat = fs.fstatSync(0);
      if (stat.isFile() && stat.size > 0) {
        const rawStdin = fs.readFileSync(0, 'utf8').trim();
        if (rawStdin) {
          return JSON.parse(rawStdin) as Record<string, unknown>;
        }
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

function extractToolContext(payload: Record<string, unknown>, options: HookOptions) {
  const rawToolName = String(
    payload.tool_name ||
    payload.tool ||
    payload.name ||
    payload.ToolName ||
    options.toolName ||
    ''
  );
  const toolName = rawToolName.toLowerCase();

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

  const normPath = rawPath.replace(/\\/g, '/');
  const isInternalMeta =
    Boolean(rawPath) &&
    (/(?:^|\/)\.(?:evo|agents|gemini)(?:\/|$)/i.test(normPath) ||
      normPath.includes('/.evo/') ||
      normPath.includes('/.agents/teamwork/') ||
      normPath.includes('/.gemini/antigravity/'));

  return {
    rawToolName,
    toolName,
    toolInput,
    innerArgs,
    innerToolName,
    serverName,
    rawPath,
    normPath,
    isInternalMeta,
  };
}

function toolMatchesTrigger(
  triggerTools: string[] | undefined,
  rawName: string,
  innerName: string
): boolean {
  if (!triggerTools || triggerTools.length === 0) return true;
  const rLower = rawName.toLowerCase();
  const iLower = innerName.toLowerCase();
  return triggerTools.some((pat) => {
    if (pat === '*') return true;
    const parts = pat.split('|').map((p) => p.trim().toLowerCase());
    return parts.some((p) => p === rLower || (iLower && p === iLower));
  });
}

export function handlePreTool(
  workspaceRoot: string,
  payload: Record<string, unknown>,
  options: HookOptions
): HookResult {
  const ctx = extractToolContext(payload, options);
  const storage = new EvoStorage(workspaceRoot);
  if (!fs.existsSync(storage.evoDir)) {
    return { event: 'pre-tool', success: true, exitCode: 0, output: '' };
  }

  const isEvoTool =
    ctx.toolName.includes('evo_') ||
    ctx.innerToolName.includes('evo_') ||
    ctx.serverName.includes('evo') ||
    ctx.isInternalMeta;
  if (isEvoTool) {
    return { event: 'pre-tool', success: true, exitCode: 0, output: '' };
  }

  const relPath = ctx.rawPath
    ? (path.isAbsolute(ctx.rawPath) ? path.relative(workspaceRoot, ctx.rawPath).replace(/\\/g, '/') : ctx.normPath)
    : '';

  const telemetry = new EvoTelemetry(storage);
  try {
    const candidateTools = storage.listTools().filter((t) => t.hook_trigger?.event === 'pre-tool');
    const triggeredHooks: string[] = [];

    for (const tool of candidateTools) {
      const trigger = tool.hook_trigger!;
      if (!toolMatchesTrigger(trigger.tools, ctx.rawToolName, ctx.innerToolName)) continue;
      if (trigger.file_glob && (!ctx.rawPath || !matchesScopeGlob(relPath, trigger.file_glob))) continue;

      triggeredHooks.push(tool.id);
      const hookArgs = {
        hook_event: 'pre-tool',
        tool_name: ctx.rawToolName || ctx.toolName,
        file_path: relPath || ctx.rawPath,
        tool_input: ctx.toolInput,
        tool_response: '',
      };
      const res = executeSandboxedScript(tool.runtime, tool.script_path, hookArgs, {
        cwd: workspaceRoot,
        timeoutMs: Math.min(tool.timeout_ms || 3000, 2500),
      });

      let blocked = false;
      let blockReason = '';
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(res.stdout.trim());
      } catch {
        // not JSON
      }
      if (parsedJson && typeof parsedJson === 'object' && parsedJson.decision === 'block') {
        blocked = true;
        blockReason = parsedJson.reason || 'Blocked by guard hook';
      } else if (res.exitCode !== 0 && trigger.block_on_failure !== false) {
        blocked = true;
        blockReason =
          res.stderr.trim() || res.stdout.trim() || `Tool execution failed with exit code ${res.exitCode}`;
      }

      if (blocked) {
        return {
          event: 'pre-tool',
          success: true,
          exitCode: 0,
          blocked: true,
          triggeredHooks,
          output: JSON.stringify({ decision: 'block', reason: blockReason }),
        };
      }
    }

    return {
      event: 'pre-tool',
      success: true,
      exitCode: 0,
      blocked: false,
      triggeredHooks: triggeredHooks.length > 0 ? triggeredHooks : undefined,
      output: '',
    };
  } finally {
    telemetry.close();
  }
}

export function handlePostTool(
  workspaceRoot: string,
  payload: Record<string, unknown>,
  options: HookOptions
): HookResult {
  const ctx = extractToolContext(payload, options);

  const rawResponse =
    payload.tool_response ??
    payload.tool_output ??
    payload.output ??
    payload.response ??
    payload.result ??
    payload.stderr ??
    payload.error ??
    '';
  const responseText =
    typeof rawResponse === 'object' && rawResponse !== null
      ? JSON.stringify(rawResponse)
      : String(rawResponse);

  const hasExitError =
    (typeof payload.exit_code === 'number' && payload.exit_code !== 0) ||
    (typeof payload.exitCode === 'number' && payload.exitCode !== 0) ||
    (typeof (payload.tool_response as any)?.exit_code === 'number' &&
      (payload.tool_response as any).exit_code !== 0);
  const isCommandError = payload.is_error === true || hasExitError || Boolean(payload.error);

  const storage = new EvoStorage(workspaceRoot);
  if (!fs.existsSync(storage.evoDir)) {
    return { event: 'post-tool', success: true, exitCode: 0, output: '' };
  }

  const telemetry = new EvoTelemetry(storage);
  try {
    if (isCommandError) {
      telemetry.setSessionFlag('had_command_error', 'true');
    }

    let output = '';
    const recalledRuleIds: string[] = [];

    const isEvoPropose =
      ctx.toolName.includes('evo_propose') ||
      ctx.innerToolName.includes('evo_propose');
    const isEvoCompact =
      ctx.toolName.includes('evo_compact') ||
      ctx.innerToolName.includes('evo_compact');

    const proposalRejected =
      isCommandError ||
      /"passed"\s*:\s*false\b/.test(responseText) ||
      /\bProposal REJECTED\b/i.test(responseText) ||
      /\bCompaction REJECTED\b/i.test(responseText);

    if ((isEvoPropose || isEvoCompact) && !proposalRejected) {
      const proposedId = String(ctx.innerArgs.id || 'capability');
      telemetry.setSessionFlag('last_crystallized_id', proposedId);
      telemetry.setSessionFlag('pending_evolution', 'false');
      telemetry.setSessionFlag('unproposed_edit_count', '0');
      telemetry.setSessionFlag('unproposed_read_count', '0');
      telemetry.setSessionFlag('user_correction_detected', 'false');
      telemetry.setSessionFlag('contested_attributed', 'false');
      telemetry.setSessionFlag('had_command_error', 'false');
      telemetry.setSessionFlag('dirty_crystallized_id', '');
      output = `[EvoKernel Post-Tool] Capability '${proposedId}' registered. Session evolution debt cleared.`;
    } else if ((isEvoPropose || isEvoCompact) && proposalRejected) {
      output = `[EvoKernel Post-Tool] Capability proposal rejected by Gatekeeper. Session evolution debt preserved.`;
    } else {
      const isCodeGraphEvoRun =
        (ctx.toolName.includes('evo_run') || ctx.innerToolName.includes('evo_run')) &&
        String(ctx.innerArgs.tool_id || ctx.toolInput.tool_id || '').toLowerCase().includes('codegraph');

      const isMutation = ctx.toolName ? EDIT_TOOL_NAMES.has(ctx.toolName) : Boolean(ctx.rawPath);
      const isReadDiagnostic =
        !isMutation &&
        Boolean(ctx.toolName || ctx.innerToolName) &&
        (READ_TOOL_NAMES.has(ctx.toolName) ||
          READ_TOOL_NAMES.has(ctx.innerToolName) ||
          ctx.toolName.includes('codegraph') ||
          ctx.innerToolName.includes('codegraph') ||
          ctx.serverName.includes('codegraph') ||
          isCodeGraphEvoRun);

      if (isMutation && !ctx.isInternalMeta) {
        telemetry.setSessionFlag('pending_evolution', 'true');
        const currentCount = parseInt(telemetry.getSessionFlag('unproposed_edit_count') || '0', 10);
        telemetry.setSessionFlag('unproposed_edit_count', String(currentCount + 1));

        const lastCrystallized = telemetry.getSessionFlag('last_crystallized_id');
        if (lastCrystallized) {
          telemetry.setSessionFlag('dirty_crystallized_id', lastCrystallized);
        }
      } else if (isReadDiagnostic && !ctx.isInternalMeta) {
        const currentReadCount = parseInt(telemetry.getSessionFlag('unproposed_read_count') || '0', 10);
        telemetry.setSessionFlag('unproposed_read_count', String(currentReadCount + 1));
      }

      const userPromptCandidate = String(
        payload.user_message ||
        payload.user_prompt ||
        payload.prompt ||
        payload.last_user_message ||
        ctx.toolInput.user_message ||
        ''
      );
      if (isUserCorrectionSignal(userPromptCandidate)) {
        telemetry.setSessionFlag('user_correction_detected', 'true');
        if (telemetry.getSessionFlag('contested_attributed') !== 'true') {
          const recalled = telemetry.getRecalledCapabilities();
          for (const c of recalled) {
            recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'contested');
          }
          telemetry.setSessionFlag('contested_attributed', 'true');
        }
      }

      const relPath = ctx.rawPath
        ? (path.isAbsolute(ctx.rawPath) ? path.relative(workspaceRoot, ctx.rawPath).replace(/\\/g, '/') : ctx.normPath)
        : '';

      if (ctx.rawPath && !ctx.isInternalMeta) {
        const rules = storage.listRules();
        for (const rule of rules) {
          if (rule.scope_glob && matchesScopeGlob(relPath, rule.scope_glob)) {
            recalledRuleIds.push(rule.id);
            telemetry.recordRecalledCapability({ id: rule.id, kind: 'rule', tier: 'LOCAL' });
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

      // Declarative hook_trigger execution for post-tool
      const isEvoTool =
        ctx.toolName.includes('evo_') ||
        ctx.innerToolName.includes('evo_') ||
        ctx.serverName.includes('evo') ||
        ctx.isInternalMeta;
      const triggeredHooks: string[] = [];
      if (!isEvoTool) {
        const candidateTools = storage.listTools().filter((t) => t.hook_trigger?.event === 'post-tool');
        for (const tool of candidateTools) {
          const trigger = tool.hook_trigger!;
          if (!toolMatchesTrigger(trigger.tools, ctx.rawToolName, ctx.innerToolName)) continue;
          if (trigger.file_glob && (!ctx.rawPath || !matchesScopeGlob(relPath, trigger.file_glob))) continue;
          if (trigger.error_signature) {
            try {
              if (!new RegExp(trigger.error_signature, 'i').test(responseText)) continue;
            } catch {
              continue;
            }
          }

          triggeredHooks.push(tool.id);
          const hookArgs = {
            hook_event: 'post-tool',
            tool_name: ctx.rawToolName || ctx.toolName,
            file_path: relPath || ctx.rawPath,
            tool_input: ctx.toolInput,
            tool_response: responseText.slice(0, 4000),
          };
          const res = executeSandboxedScript(tool.runtime, tool.script_path, hookArgs, {
            cwd: workspaceRoot,
            timeoutMs: Math.min(tool.timeout_ms || 3000, 4000),
          });

          let blocked = false;
          let blockReason = '';
          let parsedJson: any = null;
          try {
            parsedJson = JSON.parse(res.stdout.trim());
          } catch {
            // not JSON
          }
          if (parsedJson && typeof parsedJson === 'object' && parsedJson.decision === 'block') {
            blocked = true;
            blockReason = parsedJson.reason || 'Blocked by guard hook';
          } else if (res.exitCode !== 0 && trigger.block_on_failure !== false) {
            blocked = true;
            blockReason =
              res.stderr.trim() || res.stdout.trim() || `Tool execution failed with exit code ${res.exitCode}`;
          }

          if (blocked) {
            return {
              event: 'post-tool',
              success: true,
              exitCode: 0,
              blocked: true,
              triggeredHooks,
              output: JSON.stringify({ decision: 'block', reason: blockReason }),
            };
          }

          const isAllowJson =
            parsedJson && typeof parsedJson === 'object' && parsedJson.decision === 'allow';
          if (res.exitCode === 0 && res.stdout.trim() && !isAllowJson) {
            output = output
              ? `${output}\n[EvoKernel Guard Hook: ${tool.id}] ${res.stdout.trim()}`
              : `[EvoKernel Guard Hook: ${tool.id}] ${res.stdout.trim()}`;
          }
        }
      }

      return {
        event: 'post-tool',
        success: true,
        exitCode: 0,
        output,
        recalledRules: recalledRuleIds,
        triggeredHooks: triggeredHooks.length > 0 ? triggeredHooks : undefined,
      };
    }

    return {
      event: 'post-tool',
      success: true,
      exitCode: 0,
      output,
      recalledRules: recalledRuleIds,
    };
  } finally {
    telemetry.close();
  }
}

export function handleStop(
  workspaceRoot: string,
  payload: Record<string, unknown>,
  _options: HookOptions
): HookResult {
  const storage = new EvoStorage(workspaceRoot);
  if (!fs.existsSync(storage.evoDir)) {
    return { event: 'stop', success: true, exitCode: 0, output: '' };
  }
  const telemetry = new EvoTelemetry(storage);
  try {
    const recalled = telemetry.getRecalledCapabilities();
    const hadCommandError = telemetry.getSessionFlag('had_command_error') === 'true';
    const contestedAttributed = telemetry.getSessionFlag('contested_attributed') === 'true';

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

    if (recalled.length > 0) {
      if (hasUserCorrection && !contestedAttributed) {
        for (const c of recalled) {
          recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'contested');
        }
        telemetry.setSessionFlag('contested_attributed', 'true');
      } else if (!hasUserCorrection && !hadCommandError) {
        for (const c of recalled) {
          recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'helped');
        }
        telemetry.clearRecalledCapabilities();
      }
    }

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
    const crystallizationSuggested =
      hasUncrystallizedEdits || hasHeavyDiagnosticReads || hasUserCorrection;
    const messages: string[] = [];

    if (dirtyId) {
      messages.push(
        `⚠️  [EvoKernel Anti-Poisoning Alert] Source code was modified after capability '${dirtyId}' was crystallized in this session. Verify that '${dirtyId}' still matches final code or update it via evo_propose.`
      );
    }

    if (crystallizationSuggested) {
      let reasonSummary: string;
      if (hasUncrystallizedEdits) {
        reasonSummary =
          modifiedFiles.length > 0
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
        `  ├─ ⚠️  Anti-Confounding Gate   : If multi-variable edits lack isolated causation, use kind: "memory" (or pass contrastive_evidence for rule/skill)\n` +
        `  └─ 🔧 Reusable Micro-Tool     : evo_propose(kind: "tool", ...) [--self-test verified]\n` +
        `  Output receipt in response: 🧬 EvoKernel 演进回执：[<kind>] <id>（<新增/更新摘要>）`
      );
    }

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
  } finally {
    telemetry.close();
  }
}

export function handlePreCommit(
  workspaceRoot: string,
  _payload: Record<string, unknown>,
  _options: HookOptions
): HookResult {
  const storage = new EvoStorage(workspaceRoot);
  const stagedFiles = getGitFiles(workspaceRoot, true);
  const forbiddenStaged = stagedFiles.filter((file) => {
    const norm = file.replace(/\\/g, '/');
    return FORBIDDEN_STAGED_PATTERNS.some((pat) => pat.test(norm));
  });

  const evoDirExists = fs.existsSync(storage.evoDir);

  if (forbiddenStaged.length > 0) {
    if (evoDirExists) {
      const telemetry = new EvoTelemetry(storage);
      try {
        const recalled = telemetry.getRecalledCapabilities();
        for (const c of recalled) {
          recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'hurt');
        }
      } finally {
        telemetry.close();
      }
    }
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
    if (evoDirExists) {
      const telemetry = new EvoTelemetry(storage);
      try {
        const recalled = telemetry.getRecalledCapabilities();
        for (const c of recalled) {
          recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'hurt');
        }
      } finally {
        telemetry.close();
      }
    }
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

  if (evoDirExists) {
    const telemetry = new EvoTelemetry(storage);
    try {
      const hadCommandError = telemetry.getSessionFlag('had_command_error') === 'true';
      const userCorrection = telemetry.getSessionFlag('user_correction_detected') === 'true';
      if (!hadCommandError && !userCorrection) {
        const recalled = telemetry.getRecalledCapabilities();
        for (const c of recalled) {
          recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'helped');
        }
        telemetry.clearRecalledCapabilities();
      }
    } finally {
      telemetry.close();
    }
  }

  return {
    event: 'pre-commit',
    success: true,
    exitCode: 0,
    output: `✅ [EvoKernel Pre-Commit Hook] All checks passed (healthy token budget, zero domain leaks, clean git staging). Commit allowed.`,
    auditPassed: true,
  };
}

export function runHook(
  rawEventOrOptions?: string | HookOptions,
  maybeOptions?: HookOptions
): HookResult {
  let rawEvent = typeof rawEventOrOptions === 'string' ? rawEventOrOptions : '';
  let options: HookOptions =
    typeof rawEventOrOptions === 'object' && rawEventOrOptions !== null
      ? rawEventOrOptions
      : (maybeOptions || {});

  if (
    rawEvent &&
    !isKnownHookEvent(rawEvent) &&
    (path.isAbsolute(rawEvent) || rawEvent.includes('/') || rawEvent.includes('\\') || fs.existsSync(rawEvent))
  ) {
    if (!options.workspaceRoot) {
      options = { ...options, workspaceRoot: rawEvent };
    }
    rawEvent = '';
  }

  const ws = path.resolve(options.workspaceRoot || process.cwd());
  const event = normalizeHookEvent(rawEvent || options.event || 'stop');
  const payload =
    event === 'pre-tool' || event === 'post-tool' || event === 'stop'
      ? resolvePayload(options)
      : {};

  try {
    switch (event) {
      case 'pre-tool':
        return handlePreTool(ws, payload, options);
      case 'post-tool':
        return handlePostTool(ws, payload, options);
      case 'stop':
        return handleStop(ws, payload, options);
      case 'pre-commit':
        return handlePreCommit(ws, payload, options);
      case 'mark-recovery': {
        const storage = new EvoStorage(ws);
        if (fs.existsSync(storage.evoDir)) {
          const telemetry = new EvoTelemetry(storage);
          try {
            telemetry.setSessionFlag('pending_evolution', 'true');
            telemetry.setSessionFlag('had_command_error', 'true');
            if (telemetry.getSessionFlag('contested_attributed') !== 'true') {
              const recalled = telemetry.getRecalledCapabilities();
              for (const c of recalled) {
                recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'contested');
              }
              telemetry.setSessionFlag('contested_attributed', 'true');
            }
          } finally {
            telemetry.close();
          }
        }
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
