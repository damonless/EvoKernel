#!/usr/bin/env node
/**
 * Antigravity Native Hook Handler for EvoKernel (`PreInvocation` & `Stop`).
 *
 * Guarantees:
 * - Zero external dependencies; O(1) latency (< 30ms) by reading only the last 64 KB of transcriptPath.
 * - Wrapped in top-level try/catch: never exits non-zero or blocks the host IDE.
 * - Injects an ephemeral evolution reminder via `injectSteps` when user corrections,
 *   multi-file bug fixes (>= 4 file edits without `evo_propose`), or post-crystallization
 *   code mutations are detected in the conversation transcript.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const TAIL_BYTES = 64 * 1024;
const COOLDOWN_STEPS = 4;

const CORRECTION_REGEX =
  /(?:不对|错了|还是有|乱码|漏了|为什么把|我不是说了|不一致|重新检查|没改对|不生效|回退|不要把|you broke|still broken|that's wrong|incorrect|regression)/i;

const EDIT_TOOL_NAMES = new Set([
  'edit_file',
  'write_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

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
    // If we started mid-file, discard the potentially truncated first line
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

  if (event === 'Stop') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
    return;
  }

  const conversationId = String(input.conversationId || input.conversation_id || 'default');
  const transcriptPath = String(input.transcriptPath || input.transcript_path || '');
  const steps = readTranscriptTailSteps(transcriptPath);

  if (steps.length === 0) {
    process.stdout.write('{}\n');
    return;
  }

  let latestStepIndex = steps.length;
  let latestUserContent = '';
  let latestUserStepIndex = -1;
  let editCountSinceLastPropose = 0;
  let editsAfterPropose = 0;
  let lastProposeId = '';
  let seenPropose = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const idx = typeof step.step_index === 'number' ? step.step_index : i;
    latestStepIndex = idx;

    if (step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT') {
      latestUserContent = String(step.content || '');
      latestUserStepIndex = idx;
    }

    const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    for (const tc of toolCalls) {
      const toolName = String(tc.name || tc.tool_name || tc.ToolName || '');
      const args = tc.arguments || tc.args || tc.Arguments || {};
      const innerToolName = String(args.ToolName || args.tool_name || '');

      const isEvoPropose =
        toolName.includes('evo_propose') ||
        innerToolName === 'evo_propose' ||
        toolName.includes('evo_compact') ||
        innerToolName === 'evo_compact';

      if (isEvoPropose) {
        seenPropose = true;
        editCountSinceLastPropose = 0;
        editsAfterPropose = 0;
        const innerArgs = args.Arguments || args;
        lastProposeId = String(innerArgs?.id || lastProposeId || 'capability');
      } else if (EDIT_TOOL_NAMES.has(toolName)) {
        editCountSinceLastPropose++;
        if (seenPropose) {
          editsAfterPropose++;
        }
      }
    }
  }

  const hasUserCorrection = CORRECTION_REGEX.test(latestUserContent);
  const hasHeavyUnproposeEdits = editCountSinceLastPropose >= 4;
  const hasDirtyPostProposeEdits = seenPropose && editsAfterPropose > 0;

  if (!hasUserCorrection && !hasHeavyUnproposeEdits && !hasDirtyPostProposeEdits) {
    process.stdout.write('{}\n');
    return;
  }

  const statePath = path.join(os.tmpdir(), 'evo-agy-hook-state.json');
  const allState = loadHookState(statePath);
  const convState = allState[conversationId] || { lastRemindedStep: -999, lastCorrectionStep: -1 };

  const isNewCorrection = hasUserCorrection && latestUserStepIndex > convState.lastCorrectionStep;
  const cooldownExpired = latestStepIndex - convState.lastRemindedStep >= COOLDOWN_STEPS;

  if (!isNewCorrection && !cooldownExpired && !hasDirtyPostProposeEdits) {
    process.stdout.write('{}\n');
    return;
  }

  allState[conversationId] = {
    lastRemindedStep: latestStepIndex,
    lastCorrectionStep: hasUserCorrection ? latestUserStepIndex : convState.lastCorrectionStep,
  };
  saveHookState(statePath, allState);

  const reasons = [];
  if (hasDirtyPostProposeEdits) {
    reasons.push(`在结晶 '${lastProposeId}' 后又发生了 ${editsAfterPropose} 次代码修改（防脏规则投毒校验）`);
  }
  if (hasUserCorrection) {
    reasons.push('检测到用户纠偏/回归反馈信号');
  }
  if (hasHeavyUnproposeEdits) {
    reasons.push(`已累计 ${editCountSinceLastPropose} 次文件修改尚未结晶`);
  }

  const ephemeralMessage = `[EvoKernel 自演进提醒] ${reasons.join('；')}。在完成本轮修复并验证通过后，请调用 evo_propose（显式传入当前 workspace 绝对路径）沉淀或更新经验（方法论纠偏请用 supersedes_id 升级 rule/skill，单点故障使用 memory），并在回复末尾输出 🧬 EvoKernel 演进回执。`;

  process.stdout.write(
    JSON.stringify({
      injectSteps: [{ ephemeralMessage }],
    }) + '\n'
  );
}

try {
  main();
} catch {
  process.stdout.write('{}\n');
  process.exit(0);
}
