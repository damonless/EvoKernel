import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ScriptRuntime } from './types.js';
import { getExtensionForRuntime } from './storage.js';

export interface SandboxExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

const MAX_OUTPUT_CHARS = 12000;

export function checkScriptSyntax(
  runtime: ScriptRuntime,
  scriptCode: string
): { valid: boolean; error?: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-syntax-'));
  const scriptPath = path.join(tmpDir, `check${getExtensionForRuntime(runtime)}`);
  try {
    fs.writeFileSync(scriptPath, scriptCode, 'utf8');

    if (runtime === 'node') {
      const res = spawnSync(process.execPath, ['--check', scriptPath], {
        encoding: 'utf8',
        timeout: 4000,
      });
      if (res.status !== 0) {
        return { valid: false, error: (res.stderr || res.stdout || 'Node syntax check failed').trim() };
      }
      return { valid: true };
    }

    if (runtime === 'python') {
      const res = spawnSync('python', ['-m', 'py_compile', scriptPath], {
        encoding: 'utf8',
        timeout: 4000,
      });
      if (res.error) {
        return { valid: false, error: `Python runtime error: ${res.error.message}` };
      }
      if (res.status !== 0) {
        return { valid: false, error: (res.stderr || res.stdout || 'Python syntax check failed').trim() };
      }
      return { valid: true };
    }

    if (runtime === 'powershell') {
      const psCmd = `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}', [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.ToString() }; exit 1 }`;
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
      const res = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        encoding: 'utf8',
        timeout: 4000,
      });
      if (res.status !== 0) {
        return { valid: false, error: (res.stderr || res.stdout || 'PowerShell AST check failed').trim() };
      }
      return { valid: true };
    }

    if (runtime === 'bash') {
      const res = spawnSync('bash', ['-n', scriptPath], {
        encoding: 'utf8',
        timeout: 4000,
      });
      if (res.error) {
        return { valid: false, error: `Bash runtime error: ${res.error.message}` };
      }
      if (res.status !== 0) {
        return { valid: false, error: (res.stderr || res.stdout || 'Bash syntax check failed').trim() };
      }
      return { valid: true };
    }

    return { valid: true };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function executeSandboxedScript(
  runtime: ScriptRuntime,
  scriptPath: string,
  args: Record<string, unknown> = {},
  options: {
    cwd?: string;
    timeoutMs?: number;
    selfTest?: boolean;
  } = {}
): SandboxExecutionResult {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  const cwd = options.cwd ?? process.cwd();
  const serializedArgs = JSON.stringify(args);

  const cliArgs: string[] = [];
  if (options.selfTest) {
    cliArgs.push('--self-test');
  }
  cliArgs.push(serializedArgs);

  let cmd = process.execPath;
  let cmdArgs: string[] = [];

  switch (runtime) {
    case 'node':
      cmd = process.execPath;
      cmdArgs = [scriptPath, ...cliArgs];
      break;
    case 'python':
      cmd = 'python';
      cmdArgs = [scriptPath, ...cliArgs];
      break;
    case 'powershell':
      cmd = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
      cmdArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...cliArgs];
      break;
    case 'bash':
      cmd = 'bash';
      cmdArgs = [scriptPath, ...cliArgs];
      break;
  }

  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      EVO_ARGS: serializedArgs,
      EVO_SELF_TEST: options.selfTest ? '1' : '0',
      EVO_WORKSPACE: cwd,
    },
  });

  const durationMs = Date.now() - start;
  const timedOut = Boolean(res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');

  let stdout = res.stdout || '';
  let stderr = res.stderr || (res.error ? res.error.message : '');
  let truncated = false;

  if (stdout.length > MAX_OUTPUT_CHARS) {
    stdout =
      stdout.slice(0, MAX_OUTPUT_CHARS) +
      `\n...[EVO SANDBOX TRUNCATED ${stdout.length - MAX_OUTPUT_CHARS} CHARS TO PROTECT CONTEXT WINDOW]...`;
    truncated = true;
  }
  if (stderr.length > MAX_OUTPUT_CHARS) {
    stderr = stderr.slice(0, MAX_OUTPUT_CHARS) + '\n...[EVO SANDBOX TRUNCATED STDERR]...';
    truncated = true;
  }

  return {
    exitCode: res.status ?? (timedOut ? 124 : 1),
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    durationMs,
    timedOut,
    truncated,
  };
}
