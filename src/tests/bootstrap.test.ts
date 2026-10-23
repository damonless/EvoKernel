import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseMaxCommitsArg,
  detectProjectStacks,
  generateStackSeedRules,
  runBootstrap,
} from '../cli/bootstrap.js';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evo-bootstrap-test-ws-'));
}

describe('EvoKernel Bootstrap Cold-Start Expansion Suite (Milestone 3)', () => {
  // =========================================================================
  // 1. CLI ARGUMENT & FLAG PARSING TESTS
  // =========================================================================
  test('1. parseMaxCommitsArg: defaults to 50 when flag is absent', () => {
    assert.equal(parseMaxCommitsArg([]), 50);
    assert.equal(parseMaxCommitsArg(['bootstrap']), 50);
    assert.equal(parseMaxCommitsArg(['--workspace', '/tmp']), 50);
  });

  test('2. parseMaxCommitsArg: parses --max-commits <N> space-separated', () => {
    assert.equal(parseMaxCommitsArg(['--max-commits', '120']), 120);
    assert.equal(parseMaxCommitsArg(['bootstrap', '--max-commits', '75']), 75);
  });

  test('3. parseMaxCommitsArg: parses --max-commits=<N> equal-separated', () => {
    assert.equal(parseMaxCommitsArg(['--max-commits=250']), 250);
    assert.equal(parseMaxCommitsArg(['bootstrap', '--max-commits=15']), 15);
  });

  test('4. parseMaxCommitsArg: clamps bounds to [1, 500]', () => {
    assert.equal(parseMaxCommitsArg(['--max-commits', '0']), 1);
    assert.equal(parseMaxCommitsArg(['--max-commits', '-10']), 1);
    assert.equal(parseMaxCommitsArg(['--max-commits', '1000']), 500);
    assert.equal(parseMaxCommitsArg(['--max-commits=9999']), 500);
  });

  test('5. parseMaxCommitsArg: handles non-numeric/malformed values gracefully', () => {
    assert.equal(parseMaxCommitsArg(['--max-commits', 'invalid']), 50);
    assert.equal(parseMaxCommitsArg(['--max-commits=abc']), 50);
    assert.equal(parseMaxCommitsArg(['--max-commits']), 50);
  });

  // =========================================================================
  // 2. MULTI-LANGUAGE STACK DETECTION TESTS
  // =========================================================================
  test('6. detectProjectStacks: detects Rust when Cargo.toml exists', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'Cargo.toml'), '[package]\nname = "test_crate"\n');
      const stacks = detectProjectStacks(ws);
      assert.equal(stacks.length, 1);
      assert.equal(stacks[0].stack, 'rust');
      assert.equal(stacks[0].name, 'Rust');
      assert.deepEqual(stacks[0].indicatorFiles, ['Cargo.toml']);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('7. detectProjectStacks: detects Go when go.mod exists', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'go.mod'), 'module example.com/test\n\ngo 1.22\n');
      const stacks = detectProjectStacks(ws);
      assert.equal(stacks.length, 1);
      assert.equal(stacks[0].stack, 'go');
      assert.equal(stacks[0].name, 'Go');
      assert.deepEqual(stacks[0].indicatorFiles, ['go.mod']);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('8. detectProjectStacks: detects Python across pyproject.toml, requirements.txt, Pipfile', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'requirements.txt'), 'fastapi>=0.100\n');
      fs.writeFileSync(path.join(ws, 'pyproject.toml'), '[project]\nname = "py_test"\n');
      const stacks = detectProjectStacks(ws);
      assert.equal(stacks.length, 1);
      assert.equal(stacks[0].stack, 'python');
      assert.equal(stacks[0].name, 'Python');
      assert.ok(stacks[0].indicatorFiles.includes('requirements.txt'));
      assert.ok(stacks[0].indicatorFiles.includes('pyproject.toml'));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('9. detectProjectStacks: detects Java/Kotlin across pom.xml, build.gradle, build.gradle.kts', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
      const stacks = detectProjectStacks(ws);
      assert.equal(stacks.length, 1);
      assert.equal(stacks[0].stack, 'java_kotlin');
      assert.equal(stacks[0].name, 'Kotlin/Java');
      assert.deepEqual(stacks[0].indicatorFiles, ['build.gradle.kts']);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('10. detectProjectStacks: detects TypeScript/JavaScript with ESM and TS differentiation', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(
        path.join(ws, 'package.json'),
        JSON.stringify({ name: 'esm-ts-pkg', type: 'module', devDependencies: { typescript: '^5.0' } })
      );
      const stacks = detectProjectStacks(ws);
      assert.equal(stacks.length, 1);
      assert.equal(stacks[0].stack, 'typescript_javascript');
      assert.equal(stacks[0].name, 'TypeScript (NodeNext ESM)');
      assert.equal(stacks[0].details?.isEsm, true);
      assert.equal(stacks[0].details?.hasTs, true);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('11. detectProjectStacks: detects C/C++ via CMakeLists.txt and Makefile', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.20)\n');
      const stacks = detectProjectStacks(ws);
      assert.equal(stacks.length, 1);
      assert.equal(stacks[0].stack, 'c_cpp');
      assert.equal(stacks[0].name, 'C/C++');
      assert.deepEqual(stacks[0].indicatorFiles, ['CMakeLists.txt']);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('12. detectProjectStacks: detects polyglot multi-stack workspaces simultaneously', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'go.mod'), 'module app\n');
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'frontend' }));
      fs.writeFileSync(path.join(ws, 'Cargo.toml'), '[package]\nname = "native_core"\n');

      const stacks = detectProjectStacks(ws);
      const stackKeys = stacks.map((s) => s.stack);
      assert.ok(stackKeys.includes('go'));
      assert.ok(stackKeys.includes('typescript_javascript'));
      assert.ok(stackKeys.includes('rust'));
      assert.equal(stacks.length, 3);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('13. detectProjectStacks: returns empty array on empty workspace', () => {
    const ws = createTempWorkspace();
    try {
      const stacks = detectProjectStacks(ws);
      assert.deepEqual(stacks, []);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 3. TECHNOLOGY SEED RULES & GATEKEEPER COMPLIANCE
  // =========================================================================
  test('14. generateStackSeedRules: passes Gatekeeper 4-stage validation for all 6 stacks', () => {
    const ws = createTempWorkspace();
    try {
      const storage = new EvoStorage(ws);
      storage.ensureInitialized();
      const telemetry = new EvoTelemetry(storage);
      const gatekeeper = new EvoGatekeeper(storage, telemetry);

      const allStacks = [
        { stack: 'rust' as const, name: 'Rust', indicatorFiles: ['Cargo.toml'] },
        { stack: 'go' as const, name: 'Go', indicatorFiles: ['go.mod'] },
        { stack: 'python' as const, name: 'Python', indicatorFiles: ['pyproject.toml'] },
        { stack: 'java_kotlin' as const, name: 'Java', indicatorFiles: ['pom.xml'] },
        {
          stack: 'typescript_javascript' as const,
          name: 'TypeScript',
          indicatorFiles: ['package.json'],
          details: { isEsm: true, hasTs: true },
        },
        { stack: 'c_cpp' as const, name: 'C/C++', indicatorFiles: ['CMakeLists.txt'] },
      ];

      const proposals = generateStackSeedRules(allStacks);
      assert.equal(proposals.length, 6);

      for (const prop of proposals) {
        assert.ok(prop.l0_summary.length <= 140, `l0_summary exceeds 140 chars in ${prop.id}`);
        assert.ok(prop.transfer_scenarios && prop.transfer_scenarios.length >= 2);

        const res = gatekeeper.evaluateAndCommit(prop);
        assert.equal(
          res.passed,
          true,
          `Rule '${prop.id}' failed Gatekeeper: ${res.error_code} — ${res.message}`
        );
      }

      telemetry.close();
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 4. END-TO-END COLD-START BOOTSTRAP SUITE
  // =========================================================================
  test('15. runBootstrap: respects maxCommits and creates stack rules in Rust workspace', () => {
    const ws = createTempWorkspace();
    try {
      // Setup mock git repository
      spawnSync('git', ['init'], { cwd: ws });
      spawnSync('git', ['config', 'user.email', 'test@evokernel.dev'], { cwd: ws });
      spawnSync('git', ['config', 'user.name', 'Evo Tester'], { cwd: ws });

      // Create Rust workspace indicator and source
      fs.writeFileSync(path.join(ws, 'Cargo.toml'), '[package]\nname = "rust_core"\n');
      fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(ws, 'src', 'main.rs'),
        'fn main() {\n    println!("Hello EvoKernel");\n}\n'
      );

      spawnSync('git', ['add', '.'], { cwd: ws });
      spawnSync('git', ['commit', '-m', 'fix(core): prevent buffer overflow in parser'], { cwd: ws });

      const summary = runBootstrap(ws, { maxCommits: 100 });

      assert.ok(summary.detectedStacks.includes('Rust'));
      assert.ok(summary.rulesCreated.includes('rust-borrow-memory-safety'));
      assert.ok(summary.rulesCreated.includes('gatekeeper-self-test-invariant'));
      assert.ok(summary.toolsCreated.includes('workspace-metrics-scanner'));
      assert.ok(summary.skillsCreated.includes('bug-to-guardrail-sop'));

      // Check storage persistence
      const storage = new EvoStorage(ws);
      const rustRule = storage.getRule('rust-borrow-memory-safety');
      assert.ok(rustRule);
      assert.equal(rustRule.core, true);
      assert.equal(rustRule.origin, 'bootstrap');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('16. runBootstrap: operates safely in non-git workspace without error', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'go.mod'), 'module example.com/non-git\n');
      fs.mkdirSync(path.join(ws, 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'pkg', 'main.go'), 'package main\n\nfunc main() {}\n');

      const summary = runBootstrap(ws);

      assert.ok(summary.detectedStacks.includes('Go'));
      assert.ok(summary.rulesCreated.includes('go-goroutine-leak-prevention'));
      assert.equal(summary.memoriesCreated.length, 0); // No git history
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test('17. runBootstrap: is fully idempotent on repeated invocations', () => {
    const ws = createTempWorkspace();
    try {
      fs.writeFileSync(path.join(ws, 'pyproject.toml'), '[project]\nname = "test_py"\n');
      fs.writeFileSync(path.join(ws, 'main.py'), 'print("hello")\n');

      const firstSummary = runBootstrap(ws, { maxCommits: 20 });
      assert.ok(firstSummary.rulesCreated.includes('python-type-hints-async-invariants'));

      // Second bootstrap should report duplicates/skips cleanly without throwing
      const secondSummary = runBootstrap(ws, { maxCommits: 20 });
      assert.ok(secondSummary.skippedOrDuplicate.length > 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
