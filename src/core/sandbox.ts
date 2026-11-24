import { spawn, spawnSync } from 'node:child_process';
import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
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

let cachedPythonBinary: string | undefined;

export function resolvePythonBinary(): string {
  if (cachedPythonBinary) return cachedPythonBinary;
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const bin of candidates) {
    try {
      const probe = spawnSync(bin, ['--version'], {
        encoding: 'utf8',
        timeout: 2000,
      });
      if (!probe.error && probe.status === 0) {
        cachedPythonBinary = bin;
        return bin;
      }
    } catch {}
  }
  cachedPythonBinary = candidates[0];
  return cachedPythonBinary;
}

export async function resolvePythonBinaryAsync(): Promise<string> {
  if (cachedPythonBinary) return cachedPythonBinary;
  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const bin of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      let proc: ReturnType<typeof spawn> | null = null;
      let timer: NodeJS.Timeout | null = null;
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      try {
        proc = spawn(bin, ['--version'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        timer = setTimeout(() => {
          void killProcessTreeAsync(proc?.pid).finally(() => done(false));
        }, 2000);
        proc.on('error', () => done(false));
        proc.on('close', (code) => done(code === 0));
      } catch {
        done(false);
      }
    });
    if (ok) {
      cachedPythonBinary = bin;
      return bin;
    }
  }
  cachedPythonBinary = candidates[0];
  return cachedPythonBinary;
}

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
      const res = spawnSync(resolvePythonBinary(), ['-m', 'py_compile', scriptPath], {
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

function spawnSyntaxCheckAsync(
  cmd: string,
  args: string[],
  timeoutMs: number,
  defaultFailMsg: string,
  runtimeErrorPrefix?: string
): Promise<{ valid: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let child: ReturnType<typeof spawn> | null = null;
    let timer: NodeJS.Timeout | null = null;

    const finalize = (code: number | null, spawnErr?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (spawnErr) {
        const msg = runtimeErrorPrefix
          ? `${runtimeErrorPrefix}: ${spawnErr.message}`
          : (stderr || stdout || spawnErr.message || defaultFailMsg).trim();
        resolve({ valid: false, error: msg });
        return;
      }
      if (timedOut || code !== 0) {
        const fallback = timedOut ? `${defaultFailMsg} (timed out after ${timeoutMs}ms)` : defaultFailMsg;
        resolve({ valid: false, error: (stderr || stdout || fallback).trim() });
        return;
      }
      resolve({ valid: true });
    };

    try {
      child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });

      if (child.stdout) {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
        });
      }
      if (child.stderr) {
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });
      }

      timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        void killProcessTreeAsync(child?.pid).finally(() => {
          try {
            child?.stdout?.destroy();
            child?.stderr?.destroy();
          } catch {
            // ignore
          }
          finalize(124);
        });
      }, timeoutMs);

      child.on('error', (err) => finalize(1, err));
      child.on('close', (code) => finalize(code));
    } catch (err) {
      finalize(1, err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function checkScriptSyntaxAsync(
  runtime: ScriptRuntime,
  scriptCode: string
): Promise<{ valid: boolean; error?: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'evo-syntax-'));
  const scriptPath = path.join(tmpDir, `check${getExtensionForRuntime(runtime)}`);
  try {
    await fs.promises.writeFile(scriptPath, scriptCode, 'utf8');

    if (runtime === 'node') {
      return await spawnSyntaxCheckAsync(
        process.execPath,
        ['--check', scriptPath],
        4000,
        'Node syntax check failed'
      );
    }

    if (runtime === 'python') {
      const pythonBin = await resolvePythonBinaryAsync();
      return await spawnSyntaxCheckAsync(
        pythonBin,
        ['-m', 'py_compile', scriptPath],
        4000,
        'Python syntax check failed',
        'Python runtime error'
      );
    }

    if (runtime === 'powershell') {
      const psCmd = `$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}', [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.ToString() }; exit 1 }`;
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
      return await spawnSyntaxCheckAsync(
        shell,
        ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        4000,
        'PowerShell AST check failed'
      );
    }

    if (runtime === 'bash') {
      return await spawnSyntaxCheckAsync(
        'bash',
        ['-n', scriptPath],
        4000,
        'Bash syntax check failed',
        'Bash runtime error'
      );
    }

    return { valid: true };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

export function sanitizeSandboxEnv(rawEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const sensitivePattern =
    /((?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PRIVATE|COOKIE|SESSION|JWT|BEARER)|^(?:AWS_|GITHUB_|GH_|ANTHROPIC_|OPENAI_|GEMINI_|AZURE_|SLACK_|STRIPE_|NPM_TOKEN))/i;
  const allowedExact = new Set([
    'PATH',
    'PATHEXT',
    'COMSPEC',
    'TMP',
    'TEMP',
    'TMPDIR',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'HOME',
    'USERPROFILE',
    'LANG',
    'LC_ALL',
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
  tmpDir?: string;
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

function runKillCmdAsync(cmd: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let proc: ReturnType<typeof spawn> | null = null;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = (result: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    try {
      proc = spawn(cmd, args, {
        stdio: 'ignore',
        windowsHide: true,
      });

      timer = setTimeout(() => {
        try {
          proc?.kill('SIGKILL');
        } catch {
          // ignore
        }
        cleanup(false);
      }, timeoutMs);

      proc.on('error', () => cleanup(false));
      proc.on('close', (code) => cleanup(code === 0));
    } catch {
      cleanup(false);
    }
  });
}

export async function killProcessTreeAsync(pid: number | undefined): Promise<void> {
  if (!pid || pid <= 0) return;
  if (process.platform === 'win32') {
    const killed = await runKillCmdAsync('taskkill', ['/pid', String(pid), '/T', '/F'], 3000);
    if (!killed) {
      await runKillCmdAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}" | ForEach-Object { taskkill /pid $_.ProcessId /T /F }`,
        ],
        4000
      );
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
    await runKillCmdAsync('pkill', ['-KILL', '-P', String(pid)], 2000);
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
  maybeOptions?: SandboxExecutionOptions,
  pythonBinOverride?: string
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
      cmd = pythonBinOverride || resolvePythonBinary();
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
  const env: Record<string, string> = {
    ...sanitizedEnv,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    EVO_ARGS: serializedArgs,
    EVO_SANDBOX: '1',
    EVO_SELF_TEST: options.selfTest ? '1' : '0',
    EVO_WORKSPACE: options.workspaceRoot ?? cwd,
    EVO_PACKAGE_ROOT: path.resolve(import.meta.dirname, '..', '..'),
  };

  if (typeof options.tmpDir === 'string' && options.tmpDir.trim().length > 0) {
    for (const k of Object.keys(env)) {
      const upper = k.toUpperCase();
      if (upper === 'TMP' || upper === 'TEMP' || upper === 'TMPDIR') {
        delete env[k];
      }
    }
    env.TMP = options.tmpDir;
    env.TEMP = options.tmpDir;
    env.TMPDIR = options.tmpDir;
  }

  return {
    cmd,
    cmdArgs,
    cwd,
    timeoutMs,
    env,
  };
}

function truncateHeadTail(text: string, maxChars: number, label: string): { value: string; didTruncate: boolean } {
  if (text.length <= maxChars) {
    return { value: text, didTruncate: false };
  }
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.max(0, maxChars - headChars - 120);
  const omitted = Math.max(0, text.length - headChars - tailChars);
  const marker = `\n...[EVO SANDBOX TRUNCATED ${omitted} ${label}CHAR(S) TO PROTECT CONTEXT WINDOW (total ${text.length})]...\n`;
  return {
    value: text.slice(0, headChars) + marker + (tailChars > 0 ? text.slice(-tailChars) : ''),
    didTruncate: true,
  };
}

function formatSandboxResult(
  rawStdout: string,
  rawStderr: string,
  exitCode: number,
  durationMs: number,
  timedOut: boolean
): SandboxExecutionResult {
  const outRes = truncateHeadTail(rawStdout || '', MAX_OUTPUT_CHARS, '');
  const errRes = truncateHeadTail(rawStderr || '', MAX_OUTPUT_CHARS, 'STDERR ');

  return {
    exitCode,
    stdout: outRes.value.trim(),
    stderr: errRes.value.trim(),
    durationMs,
    timedOut,
    truncated: outRes.didTruncate || errRes.didTruncate,
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
  const spawnOpts: SpawnSyncOptionsWithStringEncoding & { detached?: boolean } = {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    detached: process.platform !== 'win32',
    env,
  };
  const res = spawnSync(cmd, cmdArgs, spawnOpts);

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

export async function executeSandboxedScriptAsync(
  runtimeOrScriptPath: ScriptRuntime | string,
  scriptPathOrArgs?: string | Record<string, unknown> | unknown[],
  argsOrOptions?: Record<string, unknown> | unknown[] | SandboxExecutionOptions,
  maybeOptions?: SandboxExecutionOptions
): Promise<SandboxExecutionResult> {
  const isPythonRuntime =
    runtimeOrScriptPath === 'python' ||
    (!(['node', 'python', 'powershell', 'bash'] as string[]).includes(String(runtimeOrScriptPath)) &&
      path.extname(String(runtimeOrScriptPath)).toLowerCase() === '.py');
  const pythonBin = isPythonRuntime ? await resolvePythonBinaryAsync() : undefined;

  const { cmd, cmdArgs, cwd, timeoutMs, env } = resolveSandboxInvocation(
    runtimeOrScriptPath,
    scriptPathOrArgs,
    argsOrOptions,
    maybeOptions,
    pythonBin
  );

  return new Promise<SandboxExecutionResult>((resolve) => {
    const start = Date.now();
    let timedOut = false;
    let settled = false;

    const maxCollect = MAX_OUTPUT_CHARS * 4;
    const headBudget = Math.floor(maxCollect * 0.65);
    const tailBudget = Math.max(4096, maxCollect - headBudget - 128);
    const createStreamCollector = () => {
      let totalChars = 0;
      let head = '';
      let tail = '';
      return {
        push(chunk: string) {
          totalChars += chunk.length;
          if (head.length < headBudget) {
            const take = headBudget - head.length;
            head += chunk.slice(0, take);
            const remainder = chunk.slice(take);
            if (remainder) {
              tail = (tail + remainder).slice(-tailBudget);
            }
          } else {
            tail = (tail + chunk).slice(-tailBudget);
          }
        },
        read(): string {
          if (totalChars <= head.length + tail.length || head.length < headBudget) {
            return head + tail;
          }
          const skipped = totalChars - head.length - tail.length;
          if (skipped <= 0) {
            return head + tail;
          }
          return `${head}\n...[truncated ${skipped} intermediate chars]...\n${tail}`;
        },
      };
    };

    const stdoutCollector = createStreamCollector();
    const stderrCollector = createStreamCollector();

    const child = spawn(cmd, cmdArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutCollector.push(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderrCollector.push(chunk);
      });
    }

    const finalize = (code: number | null, errMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const stdout = stdoutCollector.read();
      const stderr = stderrCollector.read();
      const finalStderr = stderr || errMessage || (timedOut ? `Process timed out after ${timeoutMs}ms` : '');
      const exitCode = timedOut ? 124 : (code ?? 1);
      resolve(formatSandboxResult(stdout, finalStderr, exitCode, durationMs, timedOut));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      void killProcessTreeAsync(child.pid).finally(() => {
        try {
          child.stdout?.destroy();
          child.stderr?.destroy();
        } catch {
          // ignore
        }
        finalize(124);
      });
    }, timeoutMs);

    child.on('error', (err) => {
      finalize(1, err.message);
    });

    child.on('close', (code) => {
      finalize(code);
    });
  });
}
