#!/usr/bin/env node
/**
 * Antigravity Native Hook Handler for EvoKernel (`PreInvocation` & `Stop`).
 *
 * Guarantees:
 * - Zero external dependencies; O(1) latency (< 30ms) by reading only the last 128 KB of transcriptPath.
 * - Wrapped in top-level try/catch: never exits non-zero or blocks the host IDE.
 * - Unquotes double-JSON-serialized Antigravity transcript arguments (`args.Path`, `args.ToolName`, `args.CommandLine`).
 * - Injects an ephemeral evolution reminder via `injectSteps` when user corrections,
 *   multi-file bug fixes, scratch script iterations, command error-recovery loops, or
 *   post-crystallization source code mutations are detected in the conversation transcript.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TAIL_BYTES = 128 * 1024;
const COOLDOWN_STEPS = 4;

const CORRECTION_REGEX =
  /(?:不对|错了|还是有|乱码|漏了|为什么把|为什么会|为什么没|怎么回事|我不是说了|不一致|重新检查|没改对|不生效|回退|不要把|只有一半|显示不全|稍微精简|精简一些|太详细|太啰嗦|吃力|费劲|不美观|不要冲突|不要重复|重写|重新整理|调整一下|换一种|格式不对|格式有误|you broke|still broken|that's wrong|incorrect|regression)/i;

const CMD_ERROR_OUTPUT_REGEX =
  /(?:Traceback \(most recent call last\)|SyntaxError:|TypeError:|ValueError:|AttributeError:|KeyError:|ModuleNotFoundError:|ImportError:|PermissionError:|FileNotFoundError:|Command exited with code [1-9]|Exception calling|At line:\d+ char:\d+)/i;

const DELIVERABLE_CMD_REGEX =
  /(?:\.(?:xlsx?|docx?|pptx?|pdf|csv)\b|openpyxl|xlsxwriter|pandas|python-docx|win32com|New-Object\s+-ComObject\s+Excel)/i;

const EDIT_TOOL_NAMES = new Set([
  'edit_file',
  'write_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

export function normalizeTranscriptString(val) {
  if (val === undefined || val === null) return '';
  let s = String(val).trim();
  for (let depth = 0; depth < 2; depth++) {
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string') {
          s = parsed.trim();
          continue;
        }
      } catch {
        s = s.slice(1, -1).trim();
      }
    }
    break;
  }
  return s;
}

export function parseTranscriptObject(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    let cur = val.trim();
    for (let depth = 0; depth < 2; depth++) {
      try {
        const parsed = JSON.parse(cur);
        if (typeof parsed === 'string') {
          cur = parsed.trim();
          continue;
        }
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        break;
      }
    }
  }
  return {};
}

export function normalizePath(val) {
  return normalizeTranscriptString(val).replace(/[\\/]+/g, '/');
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readTranscriptTailSteps(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string' || !fs.existsSync(transcriptPath)) {
    return [];
  }
  const stat = fs.statSync(transcriptPath);
  if (!stat.isFile() || stat.size === 0) return [];

  const readSize = Math.min(stat.size, TAIL_BYTES);
  const startOffset = Math.max(0, stat.size - readSize);
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, startOffset);
    const text = buf.toString('utf8');
    const rawLines = text.split(/\r?\n/);
    if (startOffset > 0 && rawLines.length > 1) {
      rawLines.shift();
    }
    const steps = [];
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        steps.push(JSON.parse(trimmed));
      } catch {
        // Ignore malformed/truncated JSONL lines
      }
    }
    return steps;
  } finally {
    fs.closeSync(fd);
  }
}

function loadHookState(statePath) {
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch {
    // Ignore corrupted state
  }
  return {};
}

function saveHookState(statePath, state) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
  } catch {
    // Ignore write errors
  }
}

function main() {
  const event = process.argv[2] || 'PreInvocation';
  const input = readStdinJson();
  const conversationId = String(input.conversationId || input.conversation_id || 'default');
  const statePath = path.join(os.tmpdir(), 'evo-agy-hook-state.json');

  if (event === 'Stop') {
    const allState = loadHookState(statePath);
    if (allState[conversationId]) {
      const cs = allState[conversationId];
      cs.clearedCorrectionStep = cs.lastCorrectionStep ?? -1;
      cs.clearedDirtyEditStep = cs.lastDirtyEditStep ?? -1;
      cs.clearedErrorRecoveryStep = cs.lastErrorRecoveryStep ?? -1;
      saveHookState(statePath, allState);
    }
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
    return;
  }

  const transcriptPath = String(input.transcriptPath || input.transcript_path || '');
  const steps = readTranscriptTailSteps(transcriptPath);

  if (steps.length === 0) {
    process.stdout.write('{}\n');
    return;
  }

  const allState = loadHookState(statePath);
  const convState = allState[conversationId] || {
    lastRemindedStep: -999,
    lastCorrectionStep: -1,
    clearedCorrectionStep: -1,
    lastDirtyEditStep: -1,
    clearedDirtyEditStep: -1,
    lastErrorRecoveryStep: -1,
    clearedErrorRecoveryStep: -1,
  };

  let latestStepIndex = steps.length;
  let latestUserContent = '';
  let latestUserStepIndex = -1;
  let seenModelStep = false;
  let userInputHadPriorModelStep = false;
  let editCountSinceLastPropose = 0;
  let scratchScriptCountSinceLastPropose = 0;
  let deliverableRunCountSinceLastPropose = 0;
  let hadCommandErrorSinceLastPropose = false;
  let hasCommandErrorRecovery = false;
  let latestErrorRecoveryStepIndex = -1;
  let editsAfterPropose = 0;
  let latestDirtyEditStepIndex = -1;
  let lastProposeId = '';
  let lastProposeStepIndex = -1;
  let seenPropose = false;
  let toolWorkStepsAfterUserCorrection = 0;

  const persistedPendingCorrectionStep =
    (convState.lastCorrectionStep ?? -1) > (convState.clearedCorrectionStep ?? -1)
      ? (convState.lastCorrectionStep ?? -1)
      : -1;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const idx = typeof step.step_index === 'number' ? step.step_index : i;
    latestStepIndex = idx;

    if (step.type === 'PLANNER_RESPONSE' || step.source === 'MODEL') {
      seenModelStep = true;
    }

    if (step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT') {
      latestUserContent = normalizeTranscriptString(step.content || '');
      latestUserStepIndex = idx;
      userInputHadPriorModelStep = seenModelStep;
      toolWorkStepsAfterUserCorrection = 0;
    }

    const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    if (toolCalls.length > 0) {
      seenModelStep = true;
    }

    const activeUserTurnStep =
      latestUserStepIndex >= 0 ? latestUserStepIndex : persistedPendingCorrectionStep;

    for (const tc of toolCalls) {
      const toolName = normalizeTranscriptString(tc.name || tc.tool_name || tc.ToolName || '');
      const args = parseTranscriptObject(tc.arguments || tc.args || tc.Arguments || {});
      const innerToolName = normalizeTranscriptString(args.ToolName || args.tool_name || '');

      const isEvoPropose =
        toolName.includes('evo_propose') ||
        innerToolName === 'evo_propose' ||
        toolName.includes('evo_compact') ||
        innerToolName === 'evo_compact';

      if (isEvoPropose) {
        seenPropose = true;
        lastProposeStepIndex = idx;
        editCountSinceLastPropose = 0;
        scratchScriptCountSinceLastPropose = 0;
        deliverableRunCountSinceLastPropose = 0;
        hadCommandErrorSinceLastPropose = false;
        hasCommandErrorRecovery = false;
        latestErrorRecoveryStepIndex = -1;
        editsAfterPropose = 0;
        latestDirtyEditStepIndex = -1;
        toolWorkStepsAfterUserCorrection = 0;
        const innerArgs = parseTranscriptObject(args.Arguments || args);
        lastProposeId =
          normalizeTranscriptString(innerArgs?.id) || lastProposeId || 'capability';
      } else {
        if (activeUserTurnStep >= 0 && idx > activeUserTurnStep) {
          toolWorkStepsAfterUserCorrection++;
        }

        if (EDIT_TOOL_NAMES.has(toolName)) {
          const targetPath = normalizePath(
            args.Path || args.path || args.TargetFile || args.target_file || args.AbsolutePath || ''
          );
          const isIgnoredMetaEdit =
            targetPath.includes('/.gemini/antigravity/brain/') ||
            targetPath.includes('/.evo/') ||
            targetPath.endsWith('/PROJECT_STATE.md');

          const isScratchScript =
            (targetPath.includes('/.gemini/antigravity/scratch/') ||
              targetPath.includes('/scratch/')) &&
            /\.(?:py|mjs|cjs|js|ts|ps1|sh)$/i.test(targetPath);

          if (isScratchScript) {
            scratchScriptCountSinceLastPropose++;
          }

          if (!isIgnoredMetaEdit) {
            editCountSinceLastPropose++;
            if (seenPropose) {
              editsAfterPropose++;
              latestDirtyEditStepIndex = idx;
            }
          }
        } else if (toolName === 'run_command') {
          const cmdLine = normalizeTranscriptString(
            args.CommandLine || args.command_line || args.command || ''
          );
          const cmdOutput = normalizeTranscriptString(
            tc.output || tc.result || step.output || ''
          );
          const isCmdError =
            tc.status === 'ERROR' || CMD_ERROR_OUTPUT_REGEX.test(cmdOutput);
          const isCmdSuccess =
            !isCmdError &&
            (tc.status === 'COMPLETED' ||
              cmdOutput.includes('Command exited with code 0') ||
              cmdOutput.length > 0);

          if (isCmdError) {
            hadCommandErrorSinceLastPropose = true;
          } else if (hadCommandErrorSinceLastPropose && isCmdSuccess) {
            hasCommandErrorRecovery = true;
            latestErrorRecoveryStepIndex = idx;
          }

          if (DELIVERABLE_CMD_REGEX.test(cmdLine)) {
            deliverableRunCountSinceLastPropose++;
          }
        }
      }
    }
  }

  if (latestStepIndex <= (convState.lastRemindedStep ?? -999)) {
    process.stdout.write('{}\n');
    return;
  }

  const effectiveCorrectionStep =
    latestUserStepIndex >= 0 ? latestUserStepIndex : persistedPendingCorrectionStep;

  const hasUserCorrection =
    latestUserStepIndex >= 0
      ? userInputHadPriorModelStep &&
        latestUserStepIndex > lastProposeStepIndex &&
        latestUserStepIndex > (convState.clearedCorrectionStep ?? -1) &&
        CORRECTION_REGEX.test(latestUserContent)
      : persistedPendingCorrectionStep >= 0 &&
        persistedPendingCorrectionStep > lastProposeStepIndex;

  const hasHeavyUnproposeEdits =
    editCountSinceLastPropose >= 4 ||
    scratchScriptCountSinceLastPropose >= 2 ||
    (scratchScriptCountSinceLastPropose >= 1 && deliverableRunCountSinceLastPropose >= 1);
  const hasDirtyPostProposeEdits = seenPropose && editsAfterPropose > 0;

  if (
    !hasUserCorrection &&
    !hasHeavyUnproposeEdits &&
    !hasDirtyPostProposeEdits &&
    !hasCommandErrorRecovery
  ) {
    process.stdout.write('{}\n');
    return;
  }

  const isNewCorrection =
    hasUserCorrection && effectiveCorrectionStep > (convState.lastCorrectionStep ?? -1);
  const isPendingCorrectionAfterWork =
    hasUserCorrection &&
    effectiveCorrectionStep === (convState.lastCorrectionStep ?? -1) &&
    toolWorkStepsAfterUserCorrection > 0;
  const isPendingDirtyEdit =
    hasDirtyPostProposeEdits &&
    latestDirtyEditStepIndex > (convState.clearedDirtyEditStep ?? -1);
  const isPendingErrorRecovery =
    hasCommandErrorRecovery &&
    latestErrorRecoveryStepIndex > (convState.clearedErrorRecoveryStep ?? -1);
  const cooldownExpired =
    latestStepIndex - (convState.lastRemindedStep ?? -999) >= COOLDOWN_STEPS;

  if (
    !isNewCorrection &&
    !isPendingCorrectionAfterWork &&
    !isPendingDirtyEdit &&
    !isPendingErrorRecovery &&
    !(hasHeavyUnproposeEdits && cooldownExpired)
  ) {
    process.stdout.write('{}\n');
    return;
  }

  allState[conversationId] = {
    lastRemindedStep: latestStepIndex,
    lastCorrectionStep: hasUserCorrection
      ? effectiveCorrectionStep
      : (convState.lastCorrectionStep ?? -1),
    clearedCorrectionStep:
      lastProposeStepIndex >= 0
        ? Math.max(convState.clearedCorrectionStep ?? -1, lastProposeStepIndex)
        : (convState.clearedCorrectionStep ?? -1),
    lastDirtyEditStep: hasDirtyPostProposeEdits
      ? latestDirtyEditStepIndex
      : (convState.lastDirtyEditStep ?? -1),
    clearedDirtyEditStep: convState.clearedDirtyEditStep ?? -1,
    lastErrorRecoveryStep: hasCommandErrorRecovery
      ? latestErrorRecoveryStepIndex
      : (convState.lastErrorRecoveryStep ?? -1),
    clearedErrorRecoveryStep: convState.clearedErrorRecoveryStep ?? -1,
  };
  saveHookState(statePath, allState);

  const reasons = [];
  if (isPendingDirtyEdit) {
    reasons.push(
      `在结晶 '${lastProposeId}' 后又发生了 ${editsAfterPropose} 次源码修改（防脏规则投毒校验）`
    );
  }
  if (isNewCorrection || isPendingCorrectionAfterWork) {
    reasons.push('检测到用户纠偏/交付物反馈信号');
  }
  if (isPendingErrorRecovery) {
    reasons.push('检测到命令/脚本执行报错并恢复成功（排障经验待结晶）');
  }
  if (scratchScriptCountSinceLastPropose > 0) {
    reasons.push(`已编写 ${scratchScriptCountSinceLastPropose} 个临时分析/交付物生成脚本尚未结晶`);
  }
  if (
    editCountSinceLastPropose >= 4 &&
    (cooldownExpired || isNewCorrection || isPendingCorrectionAfterWork || isPendingDirtyEdit)
  ) {
    reasons.push(`已累计 ${editCountSinceLastPropose} 次文件修改尚未结晶`);
  }

  const ephemeralMessage = `[EvoKernel 自演进提醒] ${reasons.join('；')}。在完成本轮修复或交付物生成并验证通过后，请调用 evo_propose（显式传入当前 workspace 绝对路径）沉淀或更新经验（方法论/交付物规范纠偏请用 supersedes_id 升级 rule/skill，通用脚本沉淀为 tool，单点故障使用 memory），并在回复末尾输出 🧬 EvoKernel 演进回执。`;

  process.stdout.write(
    JSON.stringify({
      injectSteps: [{ ephemeralMessage }],
    }) + '\n'
  );
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(import.meta.filename).toLowerCase();

if (isDirectRun) {
  try {
    main();
  } catch {
    process.stdout.write('{}\n');
    process.exit(0);
  }
}
