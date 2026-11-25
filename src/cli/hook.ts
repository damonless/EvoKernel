import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { EvoStorage, openSqliteReadOnly } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import {
  CORRECTION_REGEX,
  buildPreferenceEvolutionHint,
  defaultIsCapabilityRelevantToModifiedFiles,
  detectConversationEvolutionSignals,
  matchesScopeGlob,
  recordRecalledOutcomeUnified,
} from '../core/hook-engine.js';
import { executeSandboxedScript } from '../core/sandbox.js';
import { renderAuditReport, runAudit } from './audit.js';
import { ensureGitInfoExclude } from './init.js';
import { formatTerminalOutput } from './term.js';
import type { CapabilityOutcome, RecalledCapabilityEntry } from '../core/types.js';

export { CORRECTION_REGEX, matchesScopeGlob };

export function isCapabilityRelevantToModifiedFiles(
  storage: EvoStorage,
  entry: RecalledCapabilityEntry,
  modifiedFiles?: string[]
): boolean {
  return defaultIsCapabilityRelevantToModifiedFiles(storage, entry, modifiedFiles);
}

export function recordRecalledOutcomeWithTierRouting(
  localStorage: EvoStorage,
  localTelemetry: EvoTelemetry,
  entry: RecalledCapabilityEntry,
  outcome: Exclude<CapabilityOutcome, 'neutral'>,
  modifiedFiles?: string[]
): void {
  recordRecalledOutcomeUnified(
    localStorage,
    localTelemetry,
    entry,
    outcome,
    modifiedFiles,
    isCapabilityRelevantToModifiedFiles
  );
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
  harness?: string;
  color?: boolean;
  ascii?: boolean;
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

export const FILE_EDIT_TOOL_NAMES = new Set([
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
]);

export const COMMAND_TOOL_NAMES = new Set([
  'execute_command',
  'run_command',
  'bash',
  'terminal',
  'exec',
]);

export const EDIT_TOOL_NAMES = FILE_EDIT_TOOL_NAMES;

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

function stripEvoTranscriptMarkers(text: string): string {
  return String(text || '')
    .replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, ' ')
    .replace(/<SYSTEM_MESSAGE>[\s\S]*$/gi, ' ')
    .replace(/<!--\s*EVO:START\s*-->[\s\S]*?<!--\s*EVO:END\s*-->/gi, ' ')
    .replace(/<!--\s*EVO:PROFILE:START\s*-->[\s\S]*?<!--\s*EVO:PROFILE:END\s*-->/gi, ' ')
    .replace(/<!--\s*EVO:[\s\S]*?-->/gi, ' ')
    .replace(/\[EvoKernel[^\]]*\][^\n]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractUserTextFromJsonlEntry(entry: Record<string, unknown>): string | null {
  const topRole = typeof entry.role === 'string' ? entry.role.toLowerCase() : '';
  const msgObj =
    entry.message && typeof entry.message === 'object' && !Array.isArray(entry.message)
      ? (entry.message as Record<string, unknown>)
      : null;
  const msgRole = msgObj && typeof msgObj.role === 'string' ? msgObj.role.toLowerCase() : '';
  const topType = typeof entry.type === 'string' ? entry.type : '';
  const topSource = typeof entry.source === 'string' ? entry.source : '';

  if (topSource === 'SYSTEM') return null;

  const isUserRole =
    topRole === 'user' ||
    msgRole === 'user' ||
    topType === 'USER_INPUT' ||
    topSource === 'USER_EXPLICIT';
  if (!isUserRole) return null;

  const rawContent = msgObj ? msgObj.content : (entry.content ?? entry.text);
  if (typeof rawContent === 'string') {
    const cleaned = stripEvoTranscriptMarkers(rawContent);
    return cleaned || null;
  }
  if (Array.isArray(rawContent)) {
    const parts: string[] = [];
    for (const item of rawContent) {
      if (typeof item === 'string') {
        const cleaned = stripEvoTranscriptMarkers(item);
        if (cleaned) parts.push(cleaned);
      } else if (item && typeof item === 'object' && !Array.isArray(item)) {
        const block = item as Record<string, unknown>;
        if (block.type === 'tool_result') continue;
        if (typeof block.text === 'string') {
          const cleaned = stripEvoTranscriptMarkers(block.text);
          if (cleaned) parts.push(cleaned);
        } else if (typeof block.content === 'string' && block.type === 'text') {
          const cleaned = stripEvoTranscriptMarkers(block.content);
          if (cleaned) parts.push(cleaned);
        }
      }
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}

export function readTranscriptTail(transcriptPath: unknown): string {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return '';
  try {
    if (!fs.existsSync(transcriptPath)) return '';
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile() || stat.size === 0) return '';
    const fd = fs.openSync(transcriptPath, 'r');
    const readSize = Math.min(stat.size, 65536);
    const startOffset = Math.max(0, stat.size - readSize);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, startOffset);
    fs.closeSync(fd);

    const rawText = buffer.toString('utf8');
    const rawLines = rawText.split(/\r?\n/);
    if (startOffset > 0 && rawLines.length > 1) {
      rawLines.shift();
    }

    let parsedJsonlCount = 0;
    let latestTurnUserTexts: string[] = [];
    let inUserTurn = false;

    for (const line of rawLines) {
      const trimmed = line.replace(/^\uFEFF/, '').trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      parsedJsonlCount++;

      const entry = parsed as Record<string, unknown>;
      const userText = extractUserTextFromJsonlEntry(entry);
      if (userText !== null) {
        if (!inUserTurn) {
          latestTurnUserTexts = [userText];
          inUserTurn = true;
        } else {
          latestTurnUserTexts.push(userText);
        }
      } else {
        const msgObj =
          entry.message && typeof entry.message === 'object' && !Array.isArray(entry.message)
            ? (entry.message as Record<string, unknown>)
            : null;
        const role = String(entry.role || msgObj?.role || '').toLowerCase();
        const type = String(entry.type || '');
        if (role === 'assistant' || role === 'model' || type === 'assistant' || type === 'PLANNER_RESPONSE') {
          inUserTurn = false;
        }
      }
    }

    if (parsedJsonlCount > 0) {
      return latestTurnUserTexts.join('\n').trim();
    }

    // Fallback for plain non-JSONL text in unit tests
    return stripEvoTranscriptMarkers(rawText);
  } catch {
    return '';
  }
}

export function parseHookHarnessArg(args: string[]): string | undefined {
  const eqArg = args.find((a) => a.startsWith('--harness='));
  if (eqArg) return eqArg.slice('--harness='.length).trim();
  const idx = args.indexOf('--harness');
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return args[idx + 1].trim();
  }
  return undefined;
}

export function isUserCorrectionSignal(text: string): boolean {
  return detectConversationEvolutionSignals(text).hasCorrection;
}

const FORBIDDEN_STAGED_PATTERNS = [
  /\.evo\/\.cache\//,
  /\.evo\/telemetry\.db(?:-wal|-shm)?$/,
];

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
  const readFlagValue = (names: string[]): string | undefined => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      for (const name of names) {
        if (a === name && args[i + 1]) return args[i + 1];
        if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
      }
    }
    return undefined;
  };
  const toolVal = readFlagValue(['--tool', '--tool-name']);
  const fileVal = readFlagValue(['--file', '--target-file']);
  if (toolVal !== undefined || fileVal !== undefined) {
    const p: Record<string, unknown> = {};
    if (toolVal !== undefined) p.tool_name = toolVal;
    if (fileVal !== undefined) p.path = fileVal;
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
      return JSON.parse(options.payload.replace(/^\uFEFF/, '')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof options.stdinData === 'string') {
    try {
      return JSON.parse(options.stdinData.replace(/^\uFEFF/, '')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const isTestProcess = Boolean(process.argv[1]?.includes('.test.'));
  if (
    options.stdinData === undefined &&
    !process.stdin.isTTY &&
    !isTestProcess
  ) {
    try {
      const stat = fs.fstatSync(0);
      if (stat.isFile() && stat.size > 0) {
        const rawStdin = fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '').trim();
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

function recordSessionEditedFile(telemetry: EvoTelemetry, relPath: string): void {
  const clean = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  if (
    !clean ||
    clean.startsWith('..') ||
    clean.startsWith('.evo/') ||
    clean.startsWith('.agents/teamwork/') ||
    clean.startsWith('.git/')
  ) {
    return;
  }
  const raw = telemetry.getSessionFlag('session_edited_files') || '';
  const set = new Set(raw ? raw.split('\n').filter(Boolean) : []);
  set.add(clean);
  telemetry.setSessionFlag('session_edited_files', Array.from(set).slice(-100).join('\n'));
}

function getSessionModifiedFiles(workspaceRoot: string, telemetry: EvoTelemetry): string[] {
  const combined = new Set<string>();
  const rawEdited = telemetry.getSessionFlag('session_edited_files') || '';
  for (const f of rawEdited.split('\n')) {
    const clean = f.trim().replace(/\\/g, '/');
    if (
      clean &&
      !clean.startsWith('.evo/') &&
      !clean.startsWith('.agents/teamwork/') &&
      !clean.startsWith('.git/')
    ) {
      combined.add(clean);
    }
  }
  for (const f of getGitFiles(workspaceRoot, false)) {
    const clean = f.trim().replace(/\\/g, '/');
    if (
      clean &&
      !clean.startsWith('.evo/') &&
      !clean.startsWith('.agents/teamwork/') &&
      !clean.startsWith('.git/')
    ) {
      combined.add(clean);
    }
  }
  return Array.from(combined);
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
    payload.TargetFile ||
    payload.target_file ||
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

function openHookTelemetry(storage: EvoStorage, dryRun?: boolean): EvoTelemetry {
  if (!dryRun) {
    return new EvoTelemetry(storage);
  }
  const overlay = new Map<string, string>();
  let clearedRecalled = false;
  let roDb: DatabaseSync | undefined;
  if (fs.existsSync(storage.telemetryDbPath)) {
    try {
      roDb = openSqliteReadOnly(storage.telemetryDbPath);
    } catch {
      roDb = undefined;
    }
  }
  const stub = {
    getSessionFlag(key: string): string | null {
      if (overlay.has(key)) return overlay.get(key) ?? null;
      if (!roDb) return null;
      try {
        const row = roDb.prepare('SELECT value FROM session_state WHERE key = ?').get(key) as
          | { value?: string }
          | undefined;
        return row && typeof row.value === 'string' ? row.value : null;
      } catch {
        return null;
      }
    },
    setSessionFlag(key: string, value: string): void {
      overlay.set(key, value);
    },
    getRecalledCapabilities(): RecalledCapabilityEntry[] {
      if (clearedRecalled) return [];
      const raw = stub.getSessionFlag('recalled_capabilities');
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as RecalledCapabilityEntry[]) : [];
      } catch {
        return [];
      }
    },
    clearRecalledCapabilities(): void {
      clearedRecalled = true;
      overlay.delete('recalled_capabilities');
    },
    recordRecalledCapability(entry: RecalledCapabilityEntry): void {
      const current = stub.getRecalledCapabilities();
      if (!current.some((c) => c.id === entry.id)) {
        clearedRecalled = false;
        overlay.set('recalled_capabilities', JSON.stringify([...current, entry]));
      }
    },
    recordCapabilityOutcome(): void {
      // Dry-run: intentionally skip mutating capability counters on disk
    },
    close(): void {
      if (roDb) {
        try {
          roDb.close();
        } catch {}
        roDb = undefined;
      }
    },
  };
  return stub as unknown as EvoTelemetry;
}

function extractSessionEpoch(payload: Record<string, unknown>): string {
  return String(
    payload.conversationId ||
      payload.conversation_id ||
      payload.session_id ||
      payload.sessionId ||
      ''
  ).trim();
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

  const sessionEpoch = extractSessionEpoch(payload);
  const isEvoTool =
    ctx.toolName.includes('evo_') ||
    ctx.innerToolName.includes('evo_') ||
    ctx.serverName.includes('evo') ||
    ctx.isInternalMeta;
  if (isEvoTool) {
    if (sessionEpoch) {
      const telemetry = openHookTelemetry(storage, options.dryRun);
      try {
        if (telemetry.getSessionFlag('active_session_epoch') !== sessionEpoch) {
          telemetry.setSessionFlag('active_session_epoch', sessionEpoch);
        }
      } finally {
        telemetry.close();
      }
    }
    return { event: 'pre-tool', success: true, exitCode: 0, output: '' };
  }

  const relPath = ctx.rawPath
    ? (path.isAbsolute(ctx.rawPath) ? path.relative(workspaceRoot, ctx.rawPath).replace(/\\/g, '/') : ctx.normPath)
    : '';

  const telemetry = openHookTelemetry(storage, options.dryRun);
  try {
    if (sessionEpoch && telemetry.getSessionFlag('active_session_epoch') !== sessionEpoch) {
      telemetry.setSessionFlag('active_session_epoch', sessionEpoch);
    }
    const candidateTools = storage
      .listTools()
      .filter((t) => t.enabled !== false && t.hook_trigger?.event === 'pre-tool');
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

  const telemetry = openHookTelemetry(storage, options.dryRun);
  try {
    const sessionEpoch = extractSessionEpoch(payload);
    if (sessionEpoch && telemetry.getSessionFlag('active_session_epoch') !== sessionEpoch) {
      telemetry.setSessionFlag('active_session_epoch', sessionEpoch);
    }
    const currentStep = parseInt(telemetry.getSessionFlag('session_step_seq') || '0', 10) + 1;
    telemetry.setSessionFlag('session_step_seq', String(currentStep));
    telemetry.setSessionFlag('last_hook_event_at', String(Date.now()));

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
      const wasContestedAttributed = telemetry.getSessionFlag('contested_attributed') === 'true';
      const priorContestedAt = parseInt(telemetry.getSessionFlag('contested_at') || '0', 10);
      if (wasContestedAttributed) {
        telemetry.pruneRecalledCapabilitiesUpTo(priorContestedAt > 0 ? priorContestedAt : undefined);
      } else {
        const userPromptCandidate = String(
          payload.user_message ||
            payload.user_prompt ||
            payload.prompt ||
            payload.last_user_message ||
            ctx.toolInput.user_message ||
            ''
        );
        if (
          telemetry.getSessionFlag('user_correction_detected') === 'true' ||
          isUserCorrectionSignal(userPromptCandidate)
        ) {
          const recalled = telemetry.getRecalledCapabilities();
          if (!options.dryRun && recalled.length > 0) {
            const modifiedFiles = getSessionModifiedFiles(workspaceRoot, telemetry);
            for (const c of recalled) {
              recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'contested', modifiedFiles);
            }
          }
          telemetry.clearRecalledCapabilities();
        }
      }
      telemetry.setSessionFlag('last_crystallized_id', proposedId);
      telemetry.setSessionFlag('last_propose_at', String(Date.now()));
      telemetry.setSessionFlag('last_propose_step', String(currentStep));
      telemetry.setSessionFlag('pending_evolution', 'false');
      telemetry.setSessionFlag('unproposed_edit_count', '0');
      telemetry.setSessionFlag('unproposed_read_count', '0');
      telemetry.setSessionFlag('session_edited_files', '');
      telemetry.setSessionFlag('user_correction_detected', 'false');
      telemetry.setSessionFlag('contested_attributed', 'false');
      telemetry.setSessionFlag('contested_at', '0');
      telemetry.setSessionFlag('had_command_error', 'false');
      telemetry.setSessionFlag('monotonic_recovery_detected', 'false');
      telemetry.setSessionFlag('dirty_crystallized_id', '');
      telemetry.setSessionFlag('stop_strike_count', '0');
      output = `[EvoKernel Post-Tool] Capability '${proposedId}' registered. Session evolution debt cleared.`;
    } else if ((isEvoPropose || isEvoCompact) && proposalRejected) {
      output = `[EvoKernel Post-Tool] Capability proposal rejected by Gatekeeper. Session evolution debt preserved.`;
    } else {
      const isCodeGraphEvoRun =
        (ctx.toolName.includes('evo_run') || ctx.innerToolName.includes('evo_run')) &&
        String(ctx.innerArgs.tool_id || ctx.toolInput.tool_id || '').toLowerCase().includes('codegraph');

      const isCommand = ctx.toolName ? COMMAND_TOOL_NAMES.has(ctx.toolName) : false;
      const isMutation = ctx.toolName ? FILE_EDIT_TOOL_NAMES.has(ctx.toolName) : Boolean(ctx.rawPath);
      const isReadDiagnostic =
        !isMutation &&
        !isCommand &&
        Boolean(ctx.toolName || ctx.innerToolName) &&
        (READ_TOOL_NAMES.has(ctx.toolName) ||
          READ_TOOL_NAMES.has(ctx.innerToolName) ||
          ctx.toolName.includes('codegraph') ||
          ctx.innerToolName.includes('codegraph') ||
          ctx.serverName.includes('codegraph') ||
          isCodeGraphEvoRun);

      const cmdStr = String(
        ctx.toolInput.command || ctx.toolInput.CommandLine || ctx.toolInput.cmd || ''
      ).trim();
      const isSearchOrDiff =
        /^(?:rg|grep|git\s+diff)\b/i.test(cmdStr) || /\b(?:rg|grep|git\s+diff)\b/i.test(cmdStr);
      const effectiveCommandError = isCommandError && !isSearchOrDiff;

      if (isCommand) {
        if (effectiveCommandError) {
          telemetry.setSessionFlag('had_command_error', 'true');
          telemetry.setSessionFlag('last_cmd_error_step', String(currentStep));
          telemetry.setSessionFlag('last_command_failed_at', String(Date.now()));
        } else if (!isCommandError) {
          telemetry.setSessionFlag('last_cmd_ok_step', String(currentStep));
          const lastProposeStep = parseInt(telemetry.getSessionFlag('last_propose_step') || '0', 10);
          const lastCmdErrorStep = parseInt(telemetry.getSessionFlag('last_cmd_error_step') || '0', 10);
          const lastFileEditStep = parseInt(telemetry.getSessionFlag('last_file_edit_step') || '0', 10);
          if (
            lastCmdErrorStep > lastProposeStep &&
            lastFileEditStep > lastCmdErrorStep &&
            currentStep > lastFileEditStep
          ) {
            telemetry.setSessionFlag('monotonic_recovery_detected', 'true');
          }
        }
      }

      const relPath = ctx.rawPath
        ? (path.isAbsolute(ctx.rawPath) ? path.relative(workspaceRoot, ctx.rawPath).replace(/\\/g, '/') : ctx.normPath)
        : '';

      if (isMutation && !ctx.isInternalMeta) {
        telemetry.setSessionFlag('pending_evolution', 'true');
        telemetry.setSessionFlag('last_file_edit_at', String(Date.now()));
        telemetry.setSessionFlag('last_file_edit_step', String(currentStep));
        const currentCount = parseInt(telemetry.getSessionFlag('unproposed_edit_count') || '0', 10);
        telemetry.setSessionFlag('unproposed_edit_count', String(currentCount + 1));
        if (relPath) {
          recordSessionEditedFile(telemetry, relPath);
        }

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
      const transcriptPath = payload.transcript_path || payload.transcriptPath;
      const transcriptTail = readTranscriptTail(transcriptPath);
      if (
        isUserCorrectionSignal(userPromptCandidate) ||
        (Boolean(transcriptTail) && isUserCorrectionSignal(transcriptTail))
      ) {
        telemetry.setSessionFlag('user_correction_detected', 'true');
        if (telemetry.getSessionFlag('contested_attributed') !== 'true') {
          if (!options.dryRun) {
            const recalled = telemetry.getRecalledCapabilities();
            const sessionModifiedFiles = getSessionModifiedFiles(workspaceRoot, telemetry);
            for (const c of recalled) {
              recordRecalledOutcomeWithTierRouting(
                storage,
                telemetry,
                c,
                'contested',
                sessionModifiedFiles
              );
            }
          }
          telemetry.setSessionFlag('contested_attributed', 'true');
          telemetry.setSessionFlag('contested_at', String(Date.now()));
        }
      }

      if (ctx.rawPath && !ctx.isInternalMeta) {
        const rules = storage.listRules().filter((r) => r.enabled !== false);
        const injectedRaw = telemetry.getSessionFlag('injected_post_tool_rules') || '';
        const injectedSet = new Set(injectedRaw ? injectedRaw.split(',').filter(Boolean) : []);
        const newlyRecalled: string[] = [];

        for (const rule of rules) {
          if (rule.scope_glob && matchesScopeGlob(relPath, rule.scope_glob)) {
            recalledRuleIds.push(rule.id);
            if (!injectedSet.has(rule.id)) {
              newlyRecalled.push(rule.id);
              injectedSet.add(rule.id);
            }
            telemetry.recordRecalledCapability({ id: rule.id, kind: 'rule', tier: 'LOCAL' });
          }
        }

        if (newlyRecalled.length > 0) {
          telemetry.setSessionFlag('injected_post_tool_rules', Array.from(injectedSet).join(','));
          const matchedDetails = newlyRecalled
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
        const candidateTools = storage
          .listTools()
          .filter((t) => t.enabled !== false && t.hook_trigger?.event === 'post-tool');
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

      const postHarness = (options.harness || (typeof payload.harness === 'string' ? payload.harness : '')).trim().toLowerCase();
      let finalOutput = output;
      if (postHarness) {
        finalOutput = output
          ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: output } })
          : '{}';
      }

      return {
        event: 'post-tool',
        success: true,
        exitCode: 0,
        output: finalOutput,
        recalledRules: recalledRuleIds,
        triggeredHooks: triggeredHooks.length > 0 ? triggeredHooks : undefined,
      };
    }

    const postHarness = (options.harness || (typeof payload.harness === 'string' ? payload.harness : '')).trim().toLowerCase();
    let finalOutput = output;
    if (postHarness) {
      finalOutput = output
        ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: output } })
        : '{}';
    }

    return {
      event: 'post-tool',
      success: true,
      exitCode: 0,
      output: finalOutput,
      recalledRules: recalledRuleIds,
    };
  } finally {
    telemetry.close();
  }
}

export function handleStop(
  workspaceRoot: string,
  payload: Record<string, unknown>,
  options: HookOptions
): HookResult {
  const storage = new EvoStorage(workspaceRoot);
  if (!fs.existsSync(storage.evoDir)) {
    return { event: 'stop', success: true, exitCode: 0, output: '' };
  }
  const telemetry = openHookTelemetry(storage, options.dryRun);
  try {
    if (telemetry.getSessionFlag('stop_hook_running') === 'true') {
      return { event: 'stop', success: true, exitCode: 0, output: '' };
    }
    telemetry.setSessionFlag('stop_hook_running', 'true');

    const recalled = telemetry.getRecalledCapabilities();
    const hadCommandError = telemetry.getSessionFlag('had_command_error') === 'true';
    const monotonicRecovery = telemetry.getSessionFlag('monotonic_recovery_detected') === 'true';
    const contestedAttributed = telemetry.getSessionFlag('contested_attributed') === 'true';
    const contestedAt = parseInt(telemetry.getSessionFlag('contested_at') || '0', 10);

    const pending = telemetry.getSessionFlag('pending_evolution') === 'true';
    const dirtyId = telemetry.getSessionFlag('dirty_crystallized_id');
    const editCount = parseInt(telemetry.getSessionFlag('unproposed_edit_count') || '0', 10);
    const readCount = parseInt(telemetry.getSessionFlag('unproposed_read_count') || '0', 10);
    const persistedCorrection = telemetry.getSessionFlag('user_correction_detected') === 'true';
    const lastProposeAt = parseInt(telemetry.getSessionFlag('last_propose_at') || '0', 10);
    const userCorrectionFlag = telemetry.getSessionFlag('user_correction_detected');

    const inlineUserText = String(
      payload.user_message ||
      payload.user_prompt ||
      payload.prompt ||
      payload.last_user_message ||
      ''
    );
    const transcriptPath = payload.transcript_path || payload.transcriptPath;
    const shouldScanTranscriptTail =
      !inlineUserText && !(lastProposeAt > 0 && userCorrectionFlag === 'false');
    const transcriptTail = shouldScanTranscriptTail ? readTranscriptTail(transcriptPath) : '';
    const hasUserCorrection =
      persistedCorrection ||
      isUserCorrectionSignal(inlineUserText) ||
      (Boolean(transcriptTail) && isUserCorrectionSignal(transcriptTail));

    const modifiedFiles = getSessionModifiedFiles(workspaceRoot, telemetry);

    if (recalled.length > 0) {
      if (hasUserCorrection && !contestedAttributed) {
        if (!options.dryRun) {
          for (const c of recalled) {
            recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'contested', modifiedFiles);
          }
        }
        telemetry.setSessionFlag('contested_attributed', 'true');
        telemetry.setSessionFlag('contested_at', String(Date.now()));
      } else if (!hasUserCorrection && !hadCommandError) {
        const toAward = recalled.filter((c) => {
          const rawAt = (c as unknown as { at?: unknown }).at;
          const tsMs = typeof rawAt === 'number' ? rawAt : Date.parse(String(c.ts || ''));
          return !contestedAttributed || (contestedAt > 0 && Number.isFinite(tsMs) && tsMs > contestedAt);
        });
        if (!options.dryRun && toAward.length > 0) {
          for (const c of toAward) {
            recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'helped', modifiedFiles);
          }
        }
        telemetry.clearRecalledCapabilities();
        telemetry.setSessionFlag('contested_attributed', 'false');
        telemetry.setSessionFlag('contested_at', '0');
      }
    }

    if (hasUserCorrection) {
      telemetry.setSessionFlag('user_correction_detected', 'false');
    }

    const hasUncrystallizedEdits = pending || editCount > 0 || modifiedFiles.length > 0;
    const hasHeavyDiagnosticReads = editCount < 4 && readCount >= 10;

    const loopCount =
      typeof payload.loop_count === 'number'
        ? payload.loop_count
        : typeof (payload as any).loopCount === 'number'
          ? (payload as any).loopCount
          : 0;
    const isStopHookActive =
      payload.stop_hook_active === true || (payload as any).stopHookActive === true;
    const shouldForceAllow = isStopHookActive || loopCount >= 1;

    const currentStep = parseInt(telemetry.getSessionFlag('session_step_seq') || '0', 10);
    const lastStopStepRaw = telemetry.getSessionFlag('last_stop_suggested_step');
    const lastStopStep = lastStopStepRaw !== null ? parseInt(lastStopStepRaw, 10) : 0;
    const strike1Fired = lastStopStepRaw !== null && lastStopStep >= currentStep;

    const isHarness = Boolean(options.harness || payload.harness || payload.transcript_path || payload.transcriptPath);

    const evolutionSignals = detectConversationEvolutionSignals(
      [inlineUserText, transcriptTail].filter(Boolean).join('\n')
    );

    // Stop 3-Tier Strategy
    const isTier1 = Boolean(dirtyId) || hasUserCorrection || monotonicRecovery;
    const isTier2 =
      !isTier1 &&
      (editCount >= 6 ||
        modifiedFiles.length >= 6 ||
        evolutionSignals.shouldRemindGlobalMemory);
    const isTier3 = !isTier1 && !isTier2;

    const strikeCount = parseInt(telemetry.getSessionFlag('stop_strike_count') || '0', 10);
    const lastStopSuggestedAt = parseInt(telemetry.getSessionFlag('last_stop_suggested_at') || '0', 10);
    const lastFileEditAt = parseInt(telemetry.getSessionFlag('last_file_edit_at') || '0', 10);

    const now = Date.now();
    telemetry.setSessionFlag('last_hook_event_at', String(now));
    const cooldownElapsedMs = now - lastStopSuggestedAt;
    const stepsElapsed = (editCount + readCount) - lastStopStep;
    const inCooldown = cooldownElapsedMs < 15 * 60 * 1000 && stepsElapsed < 12;

    let crystallizationSuggested = false;
    let shouldBlock = false;
    const messages: string[] = [];

    if (shouldForceAllow) {
      crystallizationSuggested = false;
      shouldBlock = false;
    } else if (isHarness) {
      if (isTier1) {
        if (!strike1Fired) {
          crystallizationSuggested = true;
          shouldBlock = true;
          telemetry.setSessionFlag('stop_strike_count', String(strikeCount + 1));
          telemetry.setSessionFlag('last_stop_suggested_at', String(now));
          telemetry.setSessionFlag('last_stop_suggested_step', String(currentStep));
        }
      } else if (isTier2) {
        if (!inCooldown && !strike1Fired) {
          crystallizationSuggested = true;
          shouldBlock = false;
          telemetry.setSessionFlag('last_stop_suggested_at', String(now));
          telemetry.setSessionFlag('last_stop_suggested_step', String(currentStep));
        }
      } else {
        // Tier 3: 1~5 normal edits: 100% silent under harness
        crystallizationSuggested = false;
      }
    } else {
      crystallizationSuggested =
        hasUncrystallizedEdits ||
        hasHeavyDiagnosticReads ||
        hasUserCorrection ||
        Boolean(dirtyId) ||
        monotonicRecovery ||
        evolutionSignals.shouldRemindGlobalMemory;
    }

    if (dirtyId) {
      messages.push(
        `⚠️  [EvoKernel Anti-Poisoning Alert] Source code was modified after capability '${dirtyId}' was crystallized in this session. Verify that '${dirtyId}' still matches final code or update it via evo_propose.`
      );
    }

    if (crystallizationSuggested) {
      let reasonSummary: string;
      if (hasUserCorrection && hasHeavyDiagnosticReads) {
        reasonSummary = `(user correction / counter-question + ${readCount} read-only diagnostic steps)`;
      } else if (hasUserCorrection) {
        reasonSummary = `(user correction / counter-question detected)`;
      } else if (monotonicRecovery) {
        reasonSummary = `(command error recovered after file modification)`;
      } else if (hasUncrystallizedEdits) {
        reasonSummary =
          modifiedFiles.length > 0
            ? `(${modifiedFiles.slice(0, 3).join(', ')}${modifiedFiles.length > 3 ? ` +${modifiedFiles.length - 3} more` : ''})`
            : `(${editCount} mutation steps recorded)`;
      } else if (evolutionSignals.shouldRemindGlobalMemory) {
        reasonSummary = `(personal experience / cross-workspace memory signal detected)`;
      } else {
        reasonSummary = `(${readCount} read-only diagnostic steps with ${editCount} edits)`;
      }

      const preferenceHint = buildPreferenceEvolutionHint(evolutionSignals);
      messages.push(
        `💡 [EvoKernel Hook Reminder] Session work detected without capability crystallization ${reasonSummary}:\n` +
        `  ├─ 🧠 Bug Fix / Defect Pattern : evo_propose(kind: "memory", symptom: "...", root_cause: "...", solution: "...", target_symbols: [...])\n` +
        `  ├─ 🎨 Personal Preference      : evo_propose(kind: "preference", scope: "global", ...) [style, formatting, workflow standard]\n` +
        `  ├─ 🌐 Global Personal Memory   : evo_propose(kind: "memory", scope: "global", ...) [cross-workspace personal experience]\n` +
        `  ├─ 🛡️  Architectural Invariant  : evo_propose(kind: "rule", l0_summary: "...", scope_glob: "...") [zero magic numbers]\n` +
        `  ├─ ⚠️  Anti-Confounding Gate   : If multi-variable edits lack isolated causation, use kind: "memory" (or pass contrastive_evidence for rule/skill)\n` +
        `  └─ 🔧 Reusable Micro-Tool     : evo_propose(kind: "tool", ...) [--self-test verified]\n` +
        (preferenceHint ? `  ★ ${preferenceHint}\n` : '') +
        `  Confirm concisely using the plain human_receipt returned by evo_propose (omit raw internal IDs).`
      );
    }

    let finalOutput = messages.join('\n\n');
    const explicitHarness = (
      options.harness ||
      (typeof payload.harness === 'string' ? payload.harness : '')
    )
      .trim()
      .toLowerCase();

    if (explicitHarness) {
      if (explicitHarness === 'cursor') {
        finalOutput = shouldBlock && finalOutput ? JSON.stringify({ followup_message: finalOutput }) : '{}';
      } else if (explicitHarness === 'gemini') {
        finalOutput = shouldBlock && finalOutput ? JSON.stringify({ decision: 'deny', reason: finalOutput }) : JSON.stringify({ decision: 'allow' });
      } else if (explicitHarness === 'claude' || explicitHarness === 'codex') {
        finalOutput = shouldBlock && finalOutput ? JSON.stringify({ decision: 'block', reason: finalOutput }) : '{}';
      } else {
        finalOutput = shouldBlock && finalOutput ? JSON.stringify({ decision: 'block', reason: finalOutput }) : JSON.stringify({ decision: 'allow' });
      }
    } else if (payload.transcript_path || payload.transcriptPath) {
      finalOutput = finalOutput ? `${finalOutput}\n{"decision":"allow"}` : '{"decision":"allow"}';
    } else if (isHarness) {
      if (shouldBlock && finalOutput) {
        finalOutput = JSON.stringify({ decision: 'block', reason: finalOutput });
      } else if (finalOutput) {
        finalOutput = JSON.stringify({ decision: 'allow', reason: finalOutput });
      } else {
        finalOutput = JSON.stringify({ decision: 'allow' });
      }
    }

    return {
      event: 'stop',
      success: true,
      exitCode: 0,
      output: finalOutput,
      blocked: shouldBlock,
      crystallizationSuggested,
      dirtyRuleId: dirtyId || undefined,
    };
  } finally {
    telemetry.setSessionFlag('stop_hook_running', 'false');
    telemetry.close();
  }
}

export function handlePreCommit(
  workspaceRoot: string,
  _payload: Record<string, unknown>,
  options: HookOptions
): HookResult {
  const termOpts =
    options.color !== undefined || options.ascii !== undefined
      ? { color: options.color, ascii: options.ascii }
      : undefined;
  const fmt = (s: string) => (termOpts ? formatTerminalOutput(s, termOpts) : s);
  const storage = new EvoStorage(workspaceRoot);
  let stagedFiles = getGitFiles(workspaceRoot, true);
  const cacheStaged = stagedFiles.filter((file) =>
    /\.evo\/\.cache\//.test(file.replace(/\\/g, '/'))
  );
  if (cacheStaged.length > 0 && !options.dryRun) {
    try {
      execFileSync('git', ['reset', 'HEAD', '--', ...cacheStaged], {
        cwd: workspaceRoot,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      try {
        execFileSync('git', ['rm', '--cached', '-r', '--', ...cacheStaged], {
          cwd: workspaceRoot,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        // ignore if both git reset and git rm --cached fail
      }
    }
    ensureGitInfoExclude(workspaceRoot, ['.evo/.cache/']);
    stagedFiles = getGitFiles(workspaceRoot, true);
  }

  const forbiddenStaged = stagedFiles.filter((file) => {
    const norm = file.replace(/\\/g, '/');
    return FORBIDDEN_STAGED_PATTERNS.some((pat) => pat.test(norm));
  });

  const evoDirExists = fs.existsSync(storage.evoDir);

  if (forbiddenStaged.length > 0) {
    if (evoDirExists) {
      try {
        const telemetry = openHookTelemetry(storage, options.dryRun);
        try {
          if (!options.dryRun) {
            const recalled = telemetry.getRecalledCapabilities();
            const sessionModifiedFiles = getSessionModifiedFiles(workspaceRoot, telemetry);
            for (const c of recalled) {
              recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'hurt', sessionModifiedFiles);
            }
          }
        } finally {
          telemetry.close();
        }
      } catch {
        // Never mask forbidden-staged block message if cache DB itself is corrupt/locked
      }
    }
    const err = fmt(
      `❌ [EvoKernel Pre-Commit Hook] COMMIT BLOCKED: Forbidden internal cache or telemetry database file staged:\n` +
        forbiddenStaged.map((f) => `  - ${f}`).join('\n') +
        `\nRun \`git reset HEAD <file>\` and ensure it is excluded via \`evo init --stealth\`.`
    );
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
      try {
        const telemetry = openHookTelemetry(storage, options.dryRun);
        try {
          if (!options.dryRun) {
            const recalled = telemetry.getRecalledCapabilities();
            const sessionModifiedFiles = getSessionModifiedFiles(workspaceRoot, telemetry);
            for (const c of recalled) {
              recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'hurt', sessionModifiedFiles);
            }
          }
        } finally {
          telemetry.close();
        }
      } catch {
        // Never mask audit failure report if cache DB is corrupt/locked
      }
    }
    const rendered = renderAuditReport(report, termOpts);
    const err = fmt(
      `${rendered}\n\n` +
        `❌ [EvoKernel Pre-Commit Hook] COMMIT BLOCKED: Audit detected invariant violations.\n` +
        `Resolve rule budget violations (>1500 tokens), domain leaks, or redundancies before committing.`
    );
    return {
      event: 'pre-commit',
      success: false,
      exitCode: 1,
      output: err,
      auditPassed: false,
    };
  }

  if (evoDirExists) {
    const telemetry = openHookTelemetry(storage, options.dryRun);
    try {
      const hadCommandError = telemetry.getSessionFlag('had_command_error') === 'true';
      const userCorrection = telemetry.getSessionFlag('user_correction_detected') === 'true';
      const contestedAttributed = telemetry.getSessionFlag('contested_attributed') === 'true';
      const contestedAt = parseInt(telemetry.getSessionFlag('contested_at') || '0', 10);
      if (!hadCommandError && !userCorrection) {
        if (!options.dryRun) {
          const recalled = telemetry.getRecalledCapabilities().filter((c) => {
            const rawAt = (c as unknown as { at?: unknown }).at;
            const tsMs = typeof rawAt === 'number' ? rawAt : Date.parse(String(c.ts || ''));
            return !contestedAttributed || (contestedAt > 0 && Number.isFinite(tsMs) && tsMs > contestedAt);
          });
          const sessionModifiedFiles = getSessionModifiedFiles(workspaceRoot, telemetry);
          for (const c of recalled) {
            recordRecalledOutcomeWithTierRouting(storage, telemetry, c, 'helped', sessionModifiedFiles);
          }
        }
        telemetry.clearRecalledCapabilities();
        telemetry.setSessionFlag('contested_attributed', 'false');
        telemetry.setSessionFlag('contested_at', '0');
      }
    } finally {
      telemetry.close();
    }
  }

  return {
    event: 'pre-commit',
    success: true,
    exitCode: 0,
    output: fmt(
      `✅ [EvoKernel Pre-Commit Hook] All checks passed (healthy token budget, zero domain leaks, clean git staging). Commit allowed.`
    ),
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
          const telemetry = openHookTelemetry(storage, options.dryRun);
          try {
            telemetry.setSessionFlag('pending_evolution', 'true');
            telemetry.setSessionFlag('had_command_error', 'true');
            if (telemetry.getSessionFlag('contested_attributed') !== 'true') {
              if (!options.dryRun) {
                const recalled = telemetry.getRecalledCapabilities();
                const sessionModifiedFiles = getSessionModifiedFiles(ws, telemetry);
                for (const c of recalled) {
                  recordRecalledOutcomeWithTierRouting(
                    storage,
                    telemetry,
                    c,
                    'contested',
                    sessionModifiedFiles
                  );
                }
              }
              telemetry.setSessionFlag('contested_attributed', 'true');
              telemetry.setSessionFlag('contested_at', String(Date.now()));
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
