import * as child_process from 'node:child_process';
import * as readline from 'node:readline';
import * as path from 'node:path';
import type { ExternalMcpServerConfig, ExternalToolDefinition } from '../core/types.js';

export function formatExternalToolId(serverName: string, originalToolName: string): string {
  return `ext__${serverName}__${originalToolName}`;
}

export function parseExternalToolId(
  toolId: string
): { serverName: string; originalToolName: string } | null {
  const match = toolId.match(/^ext__([a-zA-Z0-9_-]+)__(.+)$/);
  if (!match) return null;
  return { serverName: match[1], originalToolName: match[2] };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class McpClientConnection {
  private proc: child_process.ChildProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly serverName: string;
  private readonly config: ExternalMcpServerConfig;
  private readonly workspaceRoot: string;
  private initialized = false;
  private stderrBuffer: string[] = [];

  constructor(serverName: string, config: ExternalMcpServerConfig, workspaceRoot: string) {
    this.serverName = serverName;
    this.config = config;
    this.workspaceRoot = workspaceRoot;
  }

  public async connect(): Promise<void> {
    if (this.proc && !this.proc.killed && this.initialized) {
      return;
    }
    this.close();

    const cwd = this.config.cwd
      ? path.resolve(this.workspaceRoot, this.config.cwd)
      : this.workspaceRoot;

    const env = {
      ...process.env,
      ...this.config.env,
    };

    const isWin = process.platform === 'win32';
    const cmdBase = path.basename(this.config.command).toLowerCase();
    const isBatch =
      isWin &&
      (/\.(cmd|bat)$/i.test(this.config.command) ||
        /^(?:npx|npm|pnpm|yarn|uvx|bunx)$/i.test(cmdBase));
    const rawArgs = this.config.args || [];
    const spawnArgs = isBatch
      ? rawArgs.map((a) => (/\s/.test(a) && !/^".*"$/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
      : rawArgs;
    const proc = child_process.spawn(this.config.command, spawnArgs, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isBatch,
    });

    this.proc = proc;
    this.stderrBuffer = [];

    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      this.stderrBuffer.push(text);
      if (this.stderrBuffer.length > 50) this.stderrBuffer.shift();
    });

    proc.on('error', (err) => {
      for (const [, req] of this.pending.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error(`MCP server '${this.serverName}' process error: ${err.message}`));
      }
      this.pending.clear();
      this.initialized = false;
      this.proc = null;
    });

    proc.on('exit', () => {
      this.initialized = false;
      this.proc = null;
      for (const [, req] of this.pending.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error(`MCP server '${this.serverName}' exited unexpectedly`));
      }
      this.pending.clear();
    });

    if (proc.stdout) {
      const rl = readline.createInterface({
        input: proc.stdout,
        terminal: false,
      });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const msg = JSON.parse(trimmed) as {
            jsonrpc: string;
            id?: number;
            result?: unknown;
            error?: { code: number; message: string; data?: unknown };
          };
          if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
            const req = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            clearTimeout(req.timer);
            if (msg.error) {
              req.reject(new Error(`Downstream MCP error (${msg.error.code}): ${msg.error.message}`));
            } else {
              req.resolve(msg.result);
            }
          }
        } catch {
          // ignore non-jsonrpc logging on stdout
        }
      });
    }

    // Perform handshake with cleanup on failure/timeout
    try {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'evo-kernel-proxy',
          version: '0.1.0',
        },
      });

      this.notify('notifications/initialized', {});
      this.initialized = true;
    } catch (err) {
      this.close();
      throw err;
    }
  }

  public notify(method: string, params: Record<string, unknown> = {}): void {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.proc.stdin.write(payload);
  }

  public request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
        return reject(new Error(`MCP server '${this.serverName}' is not running`));
      }
      const id = this.nextId++;
      const timeoutMs = this.config.timeoutMs || 10000;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Timeout (${timeoutMs}ms) waiting for response from external MCP server '${this.serverName}' (method: ${method})`
          )
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
      });

      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.proc.stdin.write(payload);
    });
  }

  public async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    await this.connect();
    const res = (await this.request('tools/list', {})) as {
      tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };
    return res?.tools || [];
  }

  public async callTool(
    name: string,
    toolArgs: Record<string, unknown>
  ): Promise<{ isError: boolean; content: Array<{ type: 'text'; text: string }> }> {
    await this.connect();
    const res = (await this.request('tools/call', {
      name,
      arguments: toolArgs,
    })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    const content: Array<{ type: 'text'; text: string }> = [];
    if (Array.isArray(res?.content)) {
      for (const item of res.content) {
        content.push({
          type: 'text',
          text: item.text ?? JSON.stringify(item),
        });
      }
    }
    return {
      isError: Boolean(res?.isError),
      content: content.length > 0 ? content : [{ type: 'text', text: '(empty result)' }],
    };
  }

  public close(): void {
    for (const [, req] of this.pending.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error(`MCP server '${this.serverName}' connection closed`));
    }
    this.pending.clear();
    this.initialized = false;
    if (this.proc) {
      const pid = this.proc.pid;
      try {
        this.proc.kill();
      } catch {
        // ignore
      }
      if (process.platform === 'win32' && pid) {
        try {
          child_process.spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } catch {
          // ignore
        }
      }
      this.proc = null;
    }
  }
}

export class McpProxyManager {
  private readonly connections = new Map<string, McpClientConnection>();
  private readonly connectionConfigKeys = new Map<string, string>();
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  private getConnection(serverName: string, config: ExternalMcpServerConfig): McpClientConnection {
    const configKey = JSON.stringify(config);
    const existing = this.connections.get(serverName);
    if (existing && this.connectionConfigKeys.get(serverName) === configKey) {
      return existing;
    }
    if (existing) {
      existing.close();
    }
    const conn = new McpClientConnection(serverName, config, this.workspaceRoot);
    this.connections.set(serverName, conn);
    this.connectionConfigKeys.set(serverName, configKey);
    return conn;
  }

  public async syncExternalTools(
    servers: Record<string, ExternalMcpServerConfig>
  ): Promise<ExternalToolDefinition[]> {
    const discovered: ExternalToolDefinition[] = [];
    const now = new Date().toISOString();

    for (const [serverName, config] of Object.entries(servers)) {
      if (config.disabled) continue;
      try {
        const conn = this.getConnection(serverName, config);
        const tools = await conn.listTools();
        for (const t of tools) {
          const id = formatExternalToolId(serverName, t.name);
          discovered.push({
            id,
            serverName,
            originalName: t.name,
            title: `[External: ${serverName}] ${t.name}`,
            description: t.description || `External MCP tool ${t.name} from server ${serverName}`,
            inputSchema: t.inputSchema || { type: 'object' },
            cachedAt: now,
          });
        }
      } catch (err) {
        console.error(
          `[EvoKernel Warning] Failed to discover tools from external MCP server '${serverName}': ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return discovered;
  }

  public async callTool(
    serverName: string,
    originalToolName: string,
    toolArgs: Record<string, unknown>,
    config: ExternalMcpServerConfig
  ): Promise<{ isError: boolean; content: Array<{ type: 'text'; text: string }>; durationMs: number }> {
    const startTime = Date.now();
    try {
      const conn = this.getConnection(serverName, config);
      const res = await conn.callTool(originalToolName, toolArgs);
      return {
        ...res,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        isError: true,
        durationMs: Date.now() - startTime,
        content: [
          {
            type: 'text',
            text: `Failed to execute external tool '${originalToolName}' on server '${serverName}': ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      };
    }
  }

  public close(): void {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    this.connectionConfigKeys.clear();
  }
}
