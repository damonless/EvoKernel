import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';
import { extractSymbolsFromGitCommit } from '../core/memory.js';
import { syncManagedRuleBlocks } from './init.js';
import { EVO_RULE_ARCHITECT_PROPOSAL } from './audit.js';
import type { ProposalPayload } from '../core/types.js';

export interface BootstrapOptions {
  maxCommits?: number;
}

export type SupportedStack =
  | 'rust'
  | 'go'
  | 'python'
  | 'java_kotlin'
  | 'typescript_javascript'
  | 'c_cpp';

export interface DetectedStack {
  stack: SupportedStack;
  name: string;
  indicatorFiles: string[];
  details?: {
    isEsm?: boolean;
    hasTs?: boolean;
    hasKotlin?: boolean;
    [key: string]: unknown;
  };
}

export interface BootstrapSummary {
  rulesCreated: string[];
  skillsCreated: string[];
  toolsCreated: string[];
  memoriesCreated: string[];
  skippedOrDuplicate: string[];
  detectedStacks: string[];
}

export function parseMaxCommitsArg(args: string[]): number {
  const eqArg = args.find((a) => a.startsWith('--max-commits='));
  if (eqArg) {
    const val = parseInt(eqArg.slice('--max-commits='.length), 10);
    if (!Number.isNaN(val)) {
      return Math.min(Math.max(val, 1), 500);
    }
  }
  const idx = args.indexOf('--max-commits');
  if (idx !== -1 && args[idx + 1]) {
    const nextArg = args[idx + 1];
    if (!nextArg.startsWith('-') || /^-\d+$/.test(nextArg)) {
      const val = parseInt(nextArg, 10);
      if (!Number.isNaN(val)) {
        return Math.min(Math.max(val, 1), 500);
      }
    }
  }
  return 50;
}

export function detectProjectStacks(workspaceRoot: string): DetectedStack[] {
  const detected: DetectedStack[] = [];

  const ignoreDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    '.evo',
    '.codegraph',
    '.cache',
    'target',
    'build',
    'tmp',
  ]);

  function findIndicators(candidates: string[]): string[] {
    const found: string[] = [];
    for (const f of candidates) {
      const full = path.join(workspaceRoot, f);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          found.push(f);
        }
      } catch {
        // ignore
      }
    }
    if (found.length > 0) return found;

    function searchDir(currentDir: string, currentDepth: number) {
      if (currentDepth > 3) return;
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !ignoreDirs.has(entry.name)) {
            const subDir = path.join(currentDir, entry.name);
            for (const f of candidates) {
              const candidatePath = path.join(subDir, f);
              try {
                if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
                  const rel = path.relative(workspaceRoot, candidatePath).replace(/\\/g, '/');
                  if (!found.includes(rel)) {
                    found.push(rel);
                  }
                }
              } catch {
                // ignore
              }
            }
            searchDir(subDir, currentDepth + 1);
          }
        }
      } catch {
        // ignore directory access errors
      }
    }

    searchDir(workspaceRoot, 1);
    return found;
  }

  function hasFileWithExtensions(extensions: string[]): boolean {
    function scan(currentDir: string, currentDepth: number): boolean {
      if (currentDepth > 3) return false;
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const lower = entry.name.toLowerCase();
            if (extensions.some((ext) => lower.endsWith(ext))) {
              return true;
            }
          } else if (entry.isDirectory() && !ignoreDirs.has(entry.name)) {
            if (scan(path.join(currentDir, entry.name), currentDepth + 1)) {
              return true;
            }
          }
        }
      } catch {
        // ignore
      }
      return false;
    }
    return scan(workspaceRoot, 0);
  }

  // 1. Rust: Cargo.toml
  const rustFiles = findIndicators(['Cargo.toml']);
  if (rustFiles.length > 0) {
    detected.push({
      stack: 'rust',
      name: 'Rust',
      indicatorFiles: rustFiles,
    });
  }

  // 2. Go: go.mod
  const goFiles = findIndicators(['go.mod']);
  if (goFiles.length > 0) {
    detected.push({
      stack: 'go',
      name: 'Go',
      indicatorFiles: goFiles,
    });
  }

  // 3. Python: pyproject.toml, requirements.txt, Pipfile
  const pyFiles = findIndicators(['pyproject.toml', 'requirements.txt', 'Pipfile']);
  if (pyFiles.length > 0) {
    detected.push({
      stack: 'python',
      name: 'Python',
      indicatorFiles: pyFiles,
    });
  }

  // 4. Java / Kotlin: pom.xml, build.gradle, build.gradle.kts
  const jvmFiles = findIndicators(['pom.xml', 'build.gradle', 'build.gradle.kts']);
  if (jvmFiles.length > 0) {
    const hasKotlin = jvmFiles.some((f) => f.endsWith('.kts'));
    detected.push({
      stack: 'java_kotlin',
      name: hasKotlin ? 'Kotlin/Java' : 'Java',
      indicatorFiles: jvmFiles,
      details: { hasKotlin },
    });
  }

  // 5. TypeScript / JavaScript: package.json
  const tsJsFiles = findIndicators(['package.json']);
  if (tsJsFiles.length > 0) {
    let isEsm = false;
    let hasTs = fs.existsSync(path.join(workspaceRoot, 'tsconfig.json'));
    if (!hasTs) {
      for (const f of tsJsFiles) {
        const dir = path.dirname(path.join(workspaceRoot, f));
        const candidateTs = path.join(dir, 'tsconfig.json');
        try {
          if (fs.existsSync(candidateTs) && fs.statSync(candidateTs).isFile()) {
            hasTs = true;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
    if (!hasTs) {
      const tsIndicators = findIndicators(['tsconfig.json']);
      if (tsIndicators.length > 0) {
        hasTs = true;
      }
    }
    for (const f of tsJsFiles) {
      try {
        const primaryPkgPath = path.join(workspaceRoot, f);
        if (fs.existsSync(primaryPkgPath) && fs.statSync(primaryPkgPath).isFile()) {
          const pkg = JSON.parse(fs.readFileSync(primaryPkgPath, 'utf8')) as Record<string, unknown>;
          const deps = {
            ...((pkg.dependencies as Record<string, string>) || {}),
            ...((pkg.devDependencies as Record<string, string>) || {}),
          };
          if (pkg.type === 'module') isEsm = true;
          if (deps.typescript) hasTs = true;
        }
      } catch {
        // ignore parse error
      }
    }
    detected.push({
      stack: 'typescript_javascript',
      name: hasTs ? (isEsm ? 'TypeScript (NodeNext ESM)' : 'TypeScript') : 'JavaScript',
      indicatorFiles: tsJsFiles,
      details: { isEsm, hasTs },
    });
  }

  // 6. C / C++: CMakeLists.txt, or Makefile accompanied by C/C++ source/header files
  const cmakeFiles = findIndicators(['CMakeLists.txt']);
  const makeFiles = findIndicators(['Makefile']);
  const hasCCppSources =
    cmakeFiles.length > 0 ||
    (makeFiles.length > 0 && hasFileWithExtensions(['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx']));
  if (hasCCppSources) {
    const cCppFiles = [...cmakeFiles, ...makeFiles.filter((f) => !cmakeFiles.includes(f))];
    detected.push({
      stack: 'c_cpp',
      name: 'C/C++',
      indicatorFiles: cCppFiles,
    });
  }

  return detected;
}

export function generateStackSeedRules(stacks: DetectedStack[]): ProposalPayload[] {
  const proposals: ProposalPayload[] = [];

  for (let idx = 0; idx < stacks.length; idx++) {
    const item = stacks[idx];
    const isPrimaryCore = idx === 0;
    switch (item.stack) {
      case 'rust': {
        proposals.push({
          kind: 'rule',
          id: 'rust-borrow-memory-safety',
          title: 'Rust Ownership, Borrow Checker & Unsafe Invariants',
          l0_summary: 'Enforce borrow checker ownership, avoid unsafe blocks unless audited, and prevent lifetime ambiguities in Rust modules.',
          scope_glob: '**/*.rs',
          core: isPrimaryCore,
          priority: 85,
          origin: 'bootstrap',
          transfer_scenarios: [
            'Systems programming modules with concurrent data access',
            'Foreign function interface boundary layers and unsafe wrappers',
          ],
          content: [
            '1. Respect ownership and borrowing: prefer borrowing (&T or &mut T) over cloning data unless ownership transfer is strictly required.',
            '2. Avoid unsafe code blocks whenever possible; if unsafe is strictly necessary, encapsulate it inside a safe abstraction and document safety invariants.',
            '3. Handle errors idiomatically using Result and the ? operator; never call unwrap or expect directly in production library code.',
            '4. Ensure deterministic resource cleanup using the Drop trait and maintain explicit lifetimes where reference ambiguity may occur.',
          ].join('\n'),
        });
        break;
      }

      case 'go': {
        proposals.push({
          kind: 'rule',
          id: 'go-goroutine-leak-prevention',
          title: 'Go Goroutine Leak & Concurrency Invariants',
          l0_summary: 'Prevent goroutine and context leaks, enforce explicit channel closure, and ensure proper error wrapping across Go packages.',
          scope_glob: '**/*.go',
          core: isPrimaryCore,
          priority: 85,
          origin: 'bootstrap',
          transfer_scenarios: [
            'Concurrent microservices processing stream pipelines',
            'Background workers and worker pools with cancellation contexts',
          ],
          content: [
            '1. Always bind goroutine lifecycles to a parent context to guarantee termination on shutdown or cancellation.',
            '2. Ensure channels have a single dedicated owner responsible for closing them; never write to a closed channel.',
            '3. Avoid goroutine leaks by ensuring all channel reads and select statements have non-blocking timeout or cancellation branches.',
            '4. Wrap errors with contextual information using fmt.Errorf with %w for error chain inspection.',
          ].join('\n'),
        });
        break;
      }

      case 'python': {
        proposals.push({
          kind: 'rule',
          id: 'python-type-hints-async-invariants',
          title: 'Python Type Hints & Async Resource Invariants',
          l0_summary: 'Enforce type hints and runtime validation, prevent unhandled async cancellation, and ensure deterministic resource cleanup.',
          scope_glob: '**/*.py',
          core: isPrimaryCore,
          priority: 85,
          origin: 'bootstrap',
          transfer_scenarios: [
            'AsyncIO web frameworks and background task runners',
            'Data processing pipelines and microservice API clients',
          ],
          content: [
            '1. Annotate all public function signatures and class methods with explicit type hints using typing or collections.abc.',
            '2. Manage asynchronous task lifecycles explicitly; avoid unawaited coroutines and guard against CancelledError in cleanup paths.',
            '3. Always utilize context managers (with or async with) for file I/O, database sessions, and network connections to guarantee resource release.',
            '4. Catch specific exceptions rather than bare except clauses; preserve exception chains with raise ... from err.',
          ].join('\n'),
        });
        break;
      }

      case 'typescript_javascript': {
        const isEsm = item.details?.isEsm;
        const hasTs = item.details?.hasTs;

        if (isEsm && hasTs) {
          proposals.push({
            kind: 'rule',
            id: 'esm-typescript-imports',
            title: 'NodeNext ESM TypeScript Import Invariant',
            l0_summary: 'Always use explicit .js extensions on relative imports and import type for types in ESM TypeScript.',
            scope_glob: '**/*.ts',
            core: isPrimaryCore,
            priority: 85,
            origin: 'bootstrap',
            transfer_scenarios: [
              'Node.js ESM backend microservices and CLI tools',
              'Monorepo workspace packages consuming TypeScript libraries',
            ],
            content: [
              '1. Use explicit `.js` file extensions in relative module imports (e.g., `import { EvoStorage } from "./storage.js"`).',
              '2. Always use `import type { ... }` when importing TypeScript interfaces or type aliases so native Node type-stripping (`node:module.stripTypeScriptTypes`) never fails at runtime.',
              '3. Prefer built-in Node.js modules (`node:fs`, `node:path`, `node:sqlite`, `node:test`) over third-party npm packages to preserve zero-dependency security.',
            ].join('\n'),
          });
        } else {
          proposals.push({
            kind: 'rule',
            id: 'js-ts-clean-invariants',
            title: 'JavaScript & TypeScript Clean Architecture Invariants',
            l0_summary: 'Enforce strict type safety, avoid any types, and ensure deterministic resource cleanup across JavaScript and TypeScript modules.',
            scope_glob: '**/*.{ts,js,mjs}',
            core: isPrimaryCore,
            priority: 85,
            origin: 'bootstrap',
            transfer_scenarios: [
              'JavaScript and TypeScript frontend application components',
              'Backend service utility libraries and shared modules',
            ],
            content: [
              '1. Enforce strict typing and validation: avoid any types in favor of unknown with type guards or strong interfaces.',
              '2. Prefer const over let, enforce strict equality (===), and keep functions pure where state mutation is unnecessary.',
              '3. Manage asynchronous flows with async and await; handle promise rejections deterministically with typed error handling.',
              '4. Prefer built-in platform APIs and standard runtime utilities over heavy third-party dependencies.',
            ].join('\n'),
          });
        }
        break;
      }

      case 'java_kotlin': {
        proposals.push({
          kind: 'rule',
          id: 'java-resource-null-safety',
          title: 'Java & Kotlin Resource Lifecycle and Null Safety Invariants',
          l0_summary: 'Enforce try-with-resources lifecycle management, prevent NullPointerExceptions via nullability annotations, and avoid raw types.',
          scope_glob: '**/*.{java,kt}',
          core: isPrimaryCore,
          priority: 85,
          origin: 'bootstrap',
          transfer_scenarios: [
            'Backend enterprise service request handling pipelines',
            'Database access layers and external resource streaming',
          ],
          content: [
            '1. Always use try-with-resources for any AutoCloseable or Closeable instances to prevent connection and descriptor leaks.',
            '2. Enforce explicit nullability contracts: use nullability annotations in Java, and leverage Kotlin null-safe operators.',
            '3. Avoid raw generic types; always provide explicit type parameters for collections and generic classes.',
            '4. Prefer immutable collections and data objects where state mutation is not strictly required.',
          ].join('\n'),
        });
        break;
      }

      case 'c_cpp': {
        proposals.push({
          kind: 'rule',
          id: 'cpp-raii-memory-safety',
          title: 'C & C++ RAII Resource Management and Pointer Safety Invariants',
          l0_summary: 'Enforce RAII resource management, prefer smart pointers over raw owning pointers, and validate pointer bounds and arithmetic.',
          scope_glob: '**/*.{c,h,cpp,hpp}',
          core: isPrimaryCore,
          priority: 85,
          origin: 'bootstrap',
          transfer_scenarios: [
            'Low-level device drivers and systems libraries',
            'High-performance native engines and computational modules',
          ],
          content: [
            '1. Enforce RAII: tie resource allocation (memory, file handles, mutexes) strictly to object lifetimes via smart pointers and lock guards.',
            '2. Avoid owning raw pointers; use raw pointers or references solely as non-owning observers.',
            '3. Prevent buffer overflows and out-of-bounds access by validating indices and using sized container abstractions.',
            '4. Initialize all primitive variables and pointers at declaration; never leave dangling or uninitialized pointers.',
          ].join('\n'),
        });
        break;
      }
    }
  }

  return proposals;
}

export function runBootstrap(
  workspaceRoot: string,
  options?: BootstrapOptions
): BootstrapSummary {
  const storage = new EvoStorage(workspaceRoot);
  storage.ensureInitialized();
  const telemetry = new EvoTelemetry(storage);
  const gatekeeper = new EvoGatekeeper(storage, telemetry);

  const summary: BootstrapSummary = {
    rulesCreated: [],
    skillsCreated: [],
    toolsCreated: [],
    memoriesCreated: [],
    skippedOrDuplicate: [],
    detectedStacks: [],
  };

  const proposals: ProposalPayload[] = [];
  const maxCommits = options?.maxCommits ?? 50;

  // 1. Detect multi-language stacks and synthesize stack-specific seed rules
  const detectedStacks = detectProjectStacks(workspaceRoot);
  summary.detectedStacks = detectedStacks.map((s) => s.name);
  const stackRules = generateStackSeedRules(detectedStacks);
  proposals.push(...stackRules);

  // 2. Mine recent git fix/revert history if git repo has commits
  const gitRes = spawnSync(
    'git',
    ['log', '-n', String(maxCommits), '--grep=fix\\|bug\\|revert\\|hotfix', '-i', '--oneline'],
    { cwd: workspaceRoot, encoding: 'utf8', timeout: 5000 }
  );
  const fixCommits =
    gitRes.status === 0 && gitRes.stdout
      ? gitRes.stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
      : [];

  proposals.push({
    kind: 'rule',
    id: 'gatekeeper-self-test-invariant',
    title: 'Deterministic Micro-Tool Self-Test Invariant',
    l0_summary: 'Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically.',
    scope_glob: '.evo/tools/**/*',
    core: true,
    priority: 90,
    origin: 'bootstrap',
    transfer_scenarios: [
      'Micro-Tool sandbox verification and safe execution pipelines',
      'Dynamic script registration and gatekeeper validation gates',
    ],
    content: [
      'When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:',
      '- The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.',
      '- Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.',
    ].join('\n'),
  });

  // 2b. Mine top git fix commits into AST-anchored Episodic Memories (.evo/memories/)
  const memoryCommitLimit = Math.min(
    fixCommits.length,
    Math.max(2, Math.min(10, Math.floor(maxCommits / 10)))
  );
  for (const commitLine of fixCommits.slice(0, memoryCommitLimit)) {
    const spaceIdx = commitLine.indexOf(' ');
    if (spaceIdx === -1) continue;
    const sha = commitLine.slice(0, spaceIdx).trim();
    const subject = commitLine.slice(spaceIdx + 1).trim();
    if (!sha || !subject) continue;

    const showRes = spawnSync('git', ['show', '--name-only', '--pretty=format:', sha], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      timeout: 2000,
    });
    if (showRes.status !== 0 || !showRes.stdout) continue;

    const touchedSourceFiles = showRes.stdout
      .split(/\r?\n/)
      .map((f) => f.trim().replace(/\\/g, '/'))
      .filter((f) => {
        if (!f || f.startsWith('.evo/')) return false;
        const ext = path.extname(f).toLowerCase();
        return (
          ['.ts', '.js', '.mjs', '.c', '.h', '.cpp', '.py', '.go', '.rs', '.java', '.kt'].includes(ext) &&
          fs.existsSync(path.join(workspaceRoot, f))
        );
      })
      .slice(0, 3);

    if (touchedSourceFiles.length > 0) {
      const symbolTargets = extractSymbolsFromGitCommit(
        workspaceRoot,
        sha,
        touchedSourceFiles
      );
      const compactSummary = `Historical fix (${sha}): ${subject}`.slice(0, 135);
      proposals.push({
        kind: 'memory',
        id: `git-fix-${sha}`,
        title: `Historical Fix Case (${sha}): ${subject.slice(0, 70)}`,
        l0_summary: compactSummary,
        symptom: `Regression or issue addressed in commit ${sha}: "${subject}"`,
        root_cause: `Historical bug/fix pattern affecting symbols: ${symbolTargets.join(', ')}.`,
        solution: `Resolved in commit ${sha} (${subject}). Inspect the anchored source files and symbols below for current implementation guards.`,
        target_symbols: symbolTargets,
        tags: ['git-history', 'fix', 'bootstrap'],
        origin: 'bootstrap',
      });
    }
  }

  // 3. Crystallize baseline Skill #1: Failure-to-Capability Evolution SOP
  proposals.push({
    kind: 'skill',
    id: 'bug-to-guardrail-sop',
    title: 'Closed-Loop Bug to 1-Level-Up Guardrail & Cognitive Memory SOP',
    l0_summary:
      'Route concrete bugs to Episodic Memory and abstract reusable methodologies 1-level-up into SSOT-decoupled Rules or Tools.',
    tags: [
      'debugging',
      'evolution',
      'guardrail',
      'memory',
      'abstraction',
      'ssot',
      'clause-preservation',
    ],
    origin: 'bootstrap',
    l1_contract: [
      '- **Trigger**: Immediately after fixing a non-trivial bug, build failure, or user architectural correction.',
      '- **Inputs**: Symptom signature, root cause summary, affected symbols/files, verification command, and cross-scenario transferability analysis.',
      '- **Outputs**: A committed `.evo/memories/` case (for concrete bug symbols/thresholds), `.evo/rules/` 1-level-up invariant, or `.evo/tools/` diagnostic script via `evo_propose`.',
    ].join('\n'),
    l2_sop: [
      '1. **Search Existing Capabilities**: Run `evo_search` with the error keyword, subsystem, or symbol name to inspect existing memories, rules, and tools.',
      '2. **Pre-Upgrade Inspection Requirement**:',
      '   - If an existing rule already addresses the target subsystem and should be upgraded, **ALWAYS** call `evo_inspect(supersedes_id, "L2")` first to retrieve all existing actionable clauses before authoring the new proposal.',
      '3. **Enforce SSOT & Decide Modality (`memory` vs `rule` vs `tool`)**:',
      '   - **Concrete Bug Case (`kind: "memory"`)**: If the fix involves specific variable/macro names, state-machine branches, or physical thresholds (e.g., `wBatBusSw`, `>1500VA`, `26.5V`), crystallize an **Episodic Memory** (`symptom`, `root_cause`, `solution`, `target_symbols`) at **0 core token cost** with live AST grounding.',
      '   - **Programmatic Check (`kind: "tool"`)**: If the failure can be caught deterministically by a script, register a Micro-Tool with `--self-test` verification.',
      '   - **1-Level-Up Methodology (`kind: "rule"`)**: Propose a Rule only when the root cause generalizes across >=2 modules/scenarios (`transfer_scenarios`). Follow Gate 1.5 decoupling:',
      '     - Use a wildcard `scope_glob` (never a single literal file).',
      '     - Source code is the SSOT: strip concrete variable names, macros, and magic numbers from the main rule body.',
      '     - Isolate concrete bug examples inside a `## 典型反例锚点` / `Case Anchor:` section.',
      '     - Provide at least 2 distinct `transfer_scenarios` (>=8 characters each).',
      '4. **Orthogonal Clause Preservation Mandate**:',
      '   - When upgrading an existing rule via `supersedes_id`, **NEVER** drop existing, still-valid engineering invariants.',
      '   - Consolidate previous orthogonal clauses with new findings into a unified checklist.',
      '5. **Submit & Compact**: Call `evo_propose`. If `ERR_DUPLICATE_CAPABILITY`, `ERR_SCOPED_BUCKET_FULL`, or `ERR_BUDGET_EXCEEDED` is returned, pass `supersedes_id` or call `evo_compact` to consolidate existing rules.',
    ].join('\n'),
  });

  // 3b. Crystallize baseline Skill #2: Legacy Rule & Skill Decoupling Architect (evo-rule-architect)
  proposals.push(EVO_RULE_ARCHITECT_PROPOSAL);

  // 4. Crystallize verified Micro-Tool #1: Workspace & Codebase Diagnostics Scanner
  const repoScannerScript = `import * as fs from 'node:fs';
import * as path from 'node:path';

const workspace = process.env.EVO_WORKSPACE || process.cwd();
const isSelfTest = process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test');

function scanDirectory(dir, depth = 0, stats = { files: 0, lines: 0, byExt: {} }) {
  if (depth > 4 || !fs.existsSync(dir)) return stats;
  const ignore = new Set(['node_modules', '.git', 'dist', '.evo', '.codegraph']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(full, depth + 1, stats);
    } else if (entry.isFile()) {
      stats.files++;
      const ext = path.extname(entry.name) || '(no-ext)';
      stats.byExt[ext] = (stats.byExt[ext] || 0) + 1;
      try {
        const content = fs.readFileSync(full, 'utf8');
        stats.lines += content.split(/\\r?\\n/).length;
      } catch {}
    }
  }
  return stats;
}

const result = scanDirectory(workspace);
if (isSelfTest) {
  if (typeof result.files !== 'number') process.exit(1);
  console.log(JSON.stringify({ self_test: 'passed', scanned_files: result.files }));
  process.exit(0);
}
console.log(JSON.stringify({ workspace: path.basename(workspace), ...result }, null, 2));
`;

  proposals.push({
    kind: 'tool',
    id: 'workspace-metrics-scanner',
    title: 'Fast Workspace Metrics & Extension Breakdown Scanner',
    l0_summary: 'Scans repository file counts, LOC, and extension distribution in one sandboxed call without polluting context.',
    runtime: 'node',
    script_code: repoScannerScript,
    input_schema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: 'Maximum directory recursion depth (default: 4)' },
      },
    },
    self_test_args: { maxDepth: 2 },
    origin: 'bootstrap',
  });

  // 5. Crystallize verified Micro-Tool #2: Git Churn & Hotspot Analyzer
  const gitHotspotScript = `import { spawnSync } from 'node:child_process';

const workspace = process.env.EVO_WORKSPACE || process.cwd();
const isSelfTest = process.env.EVO_SELF_TEST === '1' || process.argv.includes('--self-test');

if (isSelfTest) {
  console.log(JSON.stringify({ self_test: 'passed', tool: 'git-hotspot-analyzer' }));
  process.exit(0);
}

const logRes = spawnSync('git', ['log', '-n', '25', '--name-only', '--pretty=format:'], {
  cwd: workspace,
  encoding: 'utf8',
  timeout: 3000,
});

const counts = {};
if (logRes.status === 0 && logRes.stdout) {
  for (const line of logRes.stdout.split(/\\r?\\n/)) {
    const file = line.trim();
    if (!file) continue;
    counts[file] = (counts[file] || 0) + 1;
  }
}

const topFiles = Object.entries(counts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([file, commits]) => ({ file, commits }));

console.log(JSON.stringify({ recent_hotspots: topFiles }, null, 2));
`;

  proposals.push({
    kind: 'tool',
    id: 'git-hotspot-analyzer',
    title: 'Git Commit Churn & Bug Hotspot Analyzer',
    l0_summary: 'Identifies top 10 most frequently modified files in recent git history to pinpoint fragile modules.',
    runtime: 'node',
    script_code: gitHotspotScript,
    input_schema: {
      type: 'object',
      properties: {},
    },
    self_test_args: {},
    origin: 'bootstrap',
  });

  for (const prop of proposals) {
    const alreadyExists =
      (prop.kind === 'rule' && Boolean(storage.getRule(prop.id))) ||
      (prop.kind === 'skill' && Boolean(storage.getSkill(prop.id))) ||
      (prop.kind === 'tool' && Boolean(storage.getTool(prop.id))) ||
      (prop.kind === 'memory' && Boolean(storage.getMemory(prop.id)));

    if (alreadyExists) {
      summary.skippedOrDuplicate.push(`${prop.id} (already_exists)`);
      continue;
    }

    const res = gatekeeper.evaluateAndCommit(prop);
    if (res.passed) {
      if (prop.kind === 'rule') summary.rulesCreated.push(prop.id);
      if (prop.kind === 'skill') summary.skillsCreated.push(prop.id);
      if (prop.kind === 'tool') summary.toolsCreated.push(prop.id);
      if (prop.kind === 'memory') summary.memoriesCreated.push(prop.id);
    } else {
      summary.skippedOrDuplicate.push(`${prop.id} (${res.error_code || 'skipped'})`);
    }
  }

  telemetry.close();
  syncManagedRuleBlocks(workspaceRoot);

  return summary;
}
