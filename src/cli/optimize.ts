import * as path from 'node:path';
import type {
  OptimizationCycleOptions,
  OptimizationResult,
} from '../core/optimize.js';
import { runOptimizationCycle } from '../core/optimize.js';
import { formatTerminalOutput, isAsciiMode, isColorEnabled } from './term.js';

export function parseStringFlag(args: string[], flag: string): string | undefined {
  const eqArg = args.find((a) => a.startsWith(`${flag}=`));
  if (eqArg) {
    return eqArg.slice(flag.length + 1).trim() || undefined;
  }
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
    return args[idx + 1].trim();
  }
  return undefined;
}

export function parseMultiStringFlag(args: string[], flag: string): string[] {
  const collected: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith(`${flag}=`)) {
      const val = a.slice(flag.length + 1).trim();
      if (val) {
        for (const part of val.split(',')) {
          if (part.trim()) collected.push(part.trim());
        }
      }
    } else if (a === flag && args[i + 1] && !args[i + 1].startsWith('-')) {
      for (const part of args[i + 1].split(',')) {
        if (part.trim()) collected.push(part.trim());
      }
      i++;
    }
  }
  return collected;
}

export function parseOptimizeFlags(
  args: string[],
  workspaceRoot: string
): OptimizationCycleOptions & { json?: boolean } {
  const taskText = parseStringFlag(args, '--task');
  const taskFile = parseStringFlag(args, '--task-file');
  const trajectories = Array.from(
    new Set([
      ...parseMultiStringFlag(args, '--trajectory'),
      ...parseMultiStringFlag(args, '--trajectories'),
    ])
  );
  const deliverables = Array.from(
    new Set([
      ...parseMultiStringFlag(args, '--deliverable'),
      ...parseMultiStringFlag(args, '--deliverables'),
    ])
  );
  const rawDim = parseStringFlag(args, '--dim');
  const dim = rawDim === 'inv' || rawDim === 'dom' || rawDim === 'both' ? rawDim : 'both';

  let k = 3;
  const kStr = parseStringFlag(args, '-k') || parseStringFlag(args, '--k');
  if (kStr) {
    const parsedK = Number.parseInt(kStr, 10);
    if (Number.isFinite(parsedK) && parsedK > 0) {
      k = parsedK;
    }
  }

  const roundsStr = parseStringFlag(args, '--rounds');
  const rounds = roundsStr ? Number.parseInt(roundsStr, 10) : undefined;
  const auto = args.includes('--auto');
  const prepare = args.includes('--prepare');
  const worktreeSetupCmd = parseStringFlag(args, '--worktree-setup-cmd');
  const proposerCmd = parseStringFlag(args, '--proposer-cmd');
  const probeCmd = parseStringFlag(args, '--probe-cmd');
  const leakGlobs = parseMultiStringFlag(args, '--leak-glob');
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');
  const requireProbeImprovement = args.includes('--no-require-probe-improvement')
    ? false
    : args.includes('--require-probe-improvement')
      ? true
      : undefined;

  return {
    workspaceRoot,
    taskText,
    taskFile: taskFile ? path.resolve(workspaceRoot, taskFile) : undefined,
    trajectories: trajectories.map((t) => path.resolve(workspaceRoot, t)),
    deliverables: deliverables.map((d) => path.resolve(workspaceRoot, d)),
    dim,
    k,
    rounds,
    auto,
    prepare,
    worktreeSetupCmd,
    proposerCmd,
    probeCmd,
    leakGlobs,
    apply,
    dryRun,
    requireProbeImprovement,
    json,
  };
}

export function renderOptimizeReport(
  result: OptimizationResult,
  options?: { color?: boolean; ascii?: boolean }
): string {
  const lines: string[] = [
    '🧬 EvoKernel Optimize — Offline Evolution Cycle',
    `  ├─ Run ID             : ${result.runId}`,
    `  ├─ Workspace          : ${result.workspaceRoot}`,
    `  ├─ Dimension Mode     : ${result.dim}`,
    `  ├─ Execution Mode     : ${result.mode}`,
    `  ├─ Trajectories       : ${result.trajectoriesAnalyzed} analyzed`,
    `  ├─ Deliverables       : ${result.deliverablesInspected} inspected`,
  ];

  if (result.baseScore !== undefined) {
    lines.push(`  ├─ Baseline Probe     : score=${result.baseScore} (passed=${result.basePassed})`);
  }

  if (result.candidates.length > 0) {
    lines.push(`  ├─ Candidates Tested  : ${result.candidates.length}`);
    for (const c of result.candidates) {
      const status = c.passed ? 'PASSED' : 'REJECTED';
      const scoreStr = result.baseScore !== undefined ? `, score=${c.score}` : '';
      const tokenDeltaStr = c.coreTokenDelta !== 0 ? `, coreDelta=${c.coreTokenDelta > 0 ? '+' : ''}${c.coreTokenDelta}t` : '';
      const attribStr = c.attribution ? `, attr=${c.attribution}` : '';
      const notesStr = c.notes ? ` (${c.notes})` : '';
      lines.push(`  │   - [${c.candidateId}] [${c.dim}] ${status}${scoreStr}${tokenDeltaStr}${attribStr}${notesStr}`);
      if (c.gatekeeperError) {
        lines.push(`  │     Gatekeeper Error: ${c.gatekeeperError}`);
      }
      if (c.auditError) {
        lines.push(`  │     Audit Error     : ${c.auditError}`);
      }
    }
  }

  lines.push(`  ├─ Final Decision     : ${result.decision}`);

  if (result.winningCandidate) {
    const win = result.winningCandidate;
    lines.push(`  ├─ Winning Candidate  : ${win.candidateId}`);
    lines.push(`  ├─ Proposals Applied  : ${win.proposals.length} proposal(s), ${win.deletedIds.length} deletion(s)`);
    lines.push(`  └─ Live Commit Status : ${result.applied ? 'APPLIED to workspace' : 'DRY-RUN / STAGED (use --apply to commit)'}`);
  } else {
    if (result.notes) {
      lines.push(`  ├─ Notes              : ${result.notes}`);
    }
    lines.push(
      `  └─ Resolution         : ${
        result.decision === 'PREPARED'
          ? `Prepared OPTIMIZE_SPEC.md (${result.missionFile}) for external proposer.`
          : 'Base capabilities preserved unchanged.'
      }`
    );
  }

  return formatTerminalOutput(lines.join('\n'), options);
}

export function renderOptimizeHelp(): string {
  return `
Usage:
  evo optimize [options]

Offline Git worktree optimization cycle — prepare OPTIMIZE_SPEC.md or evaluate --proposer-cmd candidates in isolated Git worktrees.

Options:
  --dim <inv|dom|both>              Target dimension: invariant, domain, or both (default: both)
  -k, --k <N>                       Candidates evaluated per round (default: 3)
  --rounds <N>                      Number of optimization rounds (default: 1; total = k * rounds)
  --prepare                         Prepare OPTIMIZE_SPEC.md and evidence context without running candidates
  --auto                            Run endogenous maintenance / autonomous optimization pass
  --task <text>                     Inline task or failure prompt for optimization context
  --task-file <file>                Path to file containing task or failure description
  --trajectory, --trajectories <f>  Session transcript or trajectory JSONL file(s) (comma-separated)
  --deliverable, --deliverables <f> Target deliverable file(s) for canonical defect inspection
  --proposer-cmd <cmd>              External proposer command to generate candidate modifications
  --probe-cmd <cmd>                 Verification probe command to validate candidate worktrees
  --worktree-setup-cmd <cmd>        Setup command executed inside each isolated candidate worktree
  --leak-glob <glob>                Forbidden path glob(s) guarded against grader/answer leakage
  --require-probe-improvement       Require candidate probe score to strictly improve over baseline
  --no-require-probe-improvement    Allow non-regressing probe score when Gatekeeper passes
  --apply                           Commit winning --proposer-cmd candidates to workspace
  --dry-run                         Simulate optimization cycle without modifying workspace capabilities
  --json                            Output optimization summary in JSON format
  -w, --workspace <path>            Target workspace directory (default: current directory)
  --ascii                           Render pure 7-bit ASCII output without Unicode glyphs
  --no-color                        Disable ANSI color escape sequences
  -v, --version                     Print EvoKernel CLI version
  -h, --help                        Show this help message
`.trim();
}

export function runOptimizeCli(
  args: string[],
  workspaceRoot: string
): OptimizationResult {
  const termOpts = { color: isColorEnabled(args), ascii: isAsciiMode(args) };
  if (
    args.includes('--help') ||
    args.includes('-h') ||
    args[0] === 'help' ||
    args[0] === '--help' ||
    args[0] === '-h'
  ) {
    console.log(formatTerminalOutput(renderOptimizeHelp(), termOpts));
    return {
      runId: 'help',
      success: true,
      cyclesExecuted: 0,
      adoptedCandidates: 0,
      applied: false,
      invariant: { score: 0, passed: true, details: 'help' },
      domain: { score: 0, passed: true, details: 'help' },
    } as unknown as OptimizationResult;
  }

  const flags = parseOptimizeFlags(args, workspaceRoot);
  const result = runOptimizationCycle(flags);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderOptimizeReport(result, termOpts));
  }

  return result;
}
