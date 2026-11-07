import { spawn, spawnSync } from 'node:child_process';
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

export function sanitizeSandboxEnv(rawEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const sensitivePattern = /(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)/i;
  const allowedExact = new Set([
    'PATH',
    'TMP',
    'TEMP',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'HOME',
    'USERPROFILE',
  ]);
  const allowedPrefixes = ['EVO_', 'NODE_'];

  for (const [key, val] of Object.entries(rawEnv)) {
    if (val === undefined) continue;
    const upper = key.toUpperCase();
    if (sensitivePattern.test(upper)) {
      continue;
    }
    const isAllowedExact = allowedExact.has(upper);
    const isAllowedPrefix = allowedPrefixes.some((p) => upper.startsWith(p));
    if (isAllowedExact || isAllowedPrefix) {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export interface SandboxExecutionOptions {
  cwd?: string;
  workspaceRoot?: string;
  timeoutMs?: number;
  selfTest?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  if (process.platform === 'win32') {
    let treeKilled = false;
    try {
      const tk = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 3000,
      });
      treeKilled = tk.status === 0;
    } catch {
      treeKilled = false;
    }
    if (!treeKilled) {
      try {
        spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}" | ForEach-Object { taskkill /pid $_.ProcessId /T /F }`,
          ],
          {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 4000,
          }
        );
      } catch {
        // ignore
      }
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // ignore
    }
    try {
      spawnSync('pkill', ['-KILL', '-P', String(pid)], {
        stdio: 'ignore',
        timeout: 2000,
      });
    } catch {
      // ignore
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

function resolveSandboxInvocation(
  runtimeOrScriptPath: ScriptRuntime | string,
  scriptPathOrArgs?: string | Record<string, unknown> | unknown[],
  argsOrOptions?: Record<string, unknown> | unknown[] | SandboxExecutionOptions,
  maybeOptions?: SandboxExecutionOptions
): {
  cmd: string;
  cmdArgs: string[];
  cwd: string;
  timeoutMs: number;
  env: Record<string, string>;
} {
  const knownRuntimes: ScriptRuntime[] = ['node', 'python', 'powershell', 'bash'];
  let runtime: ScriptRuntime;
  let scriptPath: string;
  let args: Record<string, unknown> | unknown[];
  let options: SandboxExecutionOptions;

  if (knownRuntimes.includes(runtimeOrScriptPath as ScriptRuntime)) {
    runtime = runtimeOrScriptPath as ScriptRuntime;
    scriptPath = String(scriptPathOrArgs ?? '');
    args = (argsOrOptions as Record<string, unknown> | unknown[]) ?? {};
    options = maybeOptions ?? {};
  } else {
    scriptPath = String(runtimeOrScriptPath);
    const ext = path.extname(scriptPath).toLowerCase();
    if (ext === '.py') runtime = 'python';
    else if (ext === '.ps1') runtime = 'powershell';
    else if (ext === '.sh') runtime = 'bash';
    else runtime = 'node';

    args = (scriptPathOrArgs as Record<string, unknown> | unknown[]) ?? {};
    options = (argsOrOptions as SandboxExecutionOptions) ?? {};
  }

  const timeoutMs = options.timeoutMs ?? 5000;
  const cwd = options.cwd ?? options.workspaceRoot ?? process.cwd();
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
      cmdArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        ...cliArgs,
      ];
      break;
    case 'bash':
      cmd = 'bash';
      cmdArgs = [scriptPath, ...cliArgs];
      break;
  }

  const sanitizedEnv = sanitizeSandboxEnv(options.env ?? process.env);

  return {
    cmd,
    cmdArgs,
    cwd,
    timeoutMs,
    env: {
      ...sanitizedEnv,
      EVO_ARGS: serializedArgs,
      EVO_SELF_TEST: options.selfTest ? '1' : '0',
      EVO_WORKSPACE: cwd,
    },
  };
}

function formatSandboxResult(
  rawStdout: string,
  rawStderr: string,
  exitCode: number,
  durationMs: number,
  timedOut: boolean
): SandboxExecutionResult {
  let stdout = rawStdout || '';
  let stderr = rawStderr || '';
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
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    durationMs,
    timedOut,
    truncated,
  };
}

export function executeSandboxedScript(
  runtimeOrScriptPath: ScriptRuntime | string,
  scriptPathOrArgs?: string | Record<string, unknown> | unknown[],
  argsOrOptions?: Record<string, unknown> | unknown[] | SandboxExecutionOptions,
  maybeOptions?: SandboxExecutionOptions
): SandboxExecutionResult {
  const { cmd, cmdArgs, cwd, timeoutMs, env } = resolveSandboxInvocation(
    runtimeOrScriptPath,
    scriptPathOrArgs,
    argsOrOptions,
    maybeOptions
  );

  const start = Date.now();
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env,
  });

  const durationMs = Date.now() - start;
  const timedOut = Boolean(res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');

  if (timedOut && res.pid) {
    killProcessTree(res.pid);
  }

  return formatSandboxResult(
    res.stdout || '',
    res.stderr || (res.error ? res.error.message : ''),
    res.status ?? (timedOut ? 124 : 1),
    durationMs,
    timedOut
  );
}

export function executeSandboxedScriptAsync(
  runtimeOrScriptPath: ScriptRuntime | string,
  scriptPathOrArgs?: string | Record<string, unknown> | unknown[],
  argsOrOptions?: Record<string, unknown> | unknown[] | SandboxExecutionOptions,
  maybeOptions?: SandboxExecutionOptions
): Promise<SandboxExecutionResult> {
  const { cmd, cmdArgs, cwd, timeoutMs, env } = resolveSandboxInvocation(
    runtimeOrScriptPath,
    scriptPathOrArgs,
    argsOrOptions,
    maybeOptions
  );

  return new Promise<SandboxExecutionResult>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(cmd, cmdArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    const maxCollect = MAX_OUTPUT_CHARS * 4;

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < maxCollect) {
          stdout += chunk;
        }
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < maxCollect) {
          stderr += chunk;
        }
      });
    }

    const finalize = (code: number | null, errMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const finalStderr = stderr || errMessage || (timedOut ? `Process timed out after ${timeoutMs}ms` : '');
      const exitCode = timedOut ? 124 : (code ?? 1);
      resolve(formatSandboxResult(stdout, finalStderr, exitCode, durationMs, timedOut));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killProcessTree(child.pid);
      try {
        child.stdout?.destroy();
        child.stderr?.destroy();
      } catch {
        // ignore
      }
      finalize(124);
    }, timeoutMs);

    child.on('error', (err) => {
      finalize(1, err.message);
    });

    child.on('close', (code) => {
      finalize(code);
    });
  });
}
