import * as readline from 'node:readline';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVO_KERNEL_VERSION } from '../core/storage.js';
import { EvoMcpDispatcher, META_MCP_TOOLS } from './handlers.js';

export const MCP_INSTRUCTIONS =
  'EvoKernel Meta-Rules (Project & Cross-Workspace Personal Cognition):\n' +
  '1. Search before act: Call evo_search(query, workspace) before reading/editing unfamiliar files or debugging errors; in non-code/blank/writing chats, call evo_search(query, scope: "global") without workspace to recall personal habits, workflows, and experiences.\n' +
  '2. Progressive inspect: On rule/skill/memory/preference hit (including Task Directory cues), call evo_inspect(id, "L2") to load full SOP/anchors before proceeding.\n' +
  '3. Mandatory crystallization: After verifying a fix, diagnosing a root cause, or receiving user style/workflow/requirement corrections, call evo_propose(kind, ...) (omit workspace with scope: "global", kind: "preference", or memory_type: "personal" in blank chats) and emit receipt: `🧬 EvoKernel Evolution Receipt: [<kind>] <id> (undo via evo profile undo)`.';

function parseUriToPath(uriStr: string): string | null {
  try {
    if (!uriStr || !uriStr.trim()) {
      return null;
    }
    if (uriStr.startsWith('file://')) {
      return path.resolve(fileURLToPath(uriStr));
    }
    return path.resolve(uriStr);
  } catch {
    return null;
  }
}

function normalizeWorkspaceRootKey(p: string): string {
  const resolved = path.resolve(p).replace(/^[a-z]:/, (m) => m.toUpperCase());
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function appendUniqueRoot(target: string[], candidate: string | null): void {
  if (!candidate) return;
  const resolved = path.resolve(candidate).replace(/^[a-z]:/, (m) => m.toUpperCase());
  const key = normalizeWorkspaceRootKey(resolved);
  if (!target.some((existing) => normalizeWorkspaceRootKey(existing) === key)) {
    target.push(resolved);
  }
}

export interface McpServerOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  dispatcher?: EvoMcpDispatcher;
}

export function startMcpStdioServer(
  workspaceRoot: string,
  options?: McpServerOptions
): { dispatcher: EvoMcpDispatcher; close: () => void } {
  const dispatcher = options?.dispatcher ?? new EvoMcpDispatcher(workspaceRoot);
  const clientRoots: string[] = [];
  let clientSupportsRoots = false;
  let rootsReadyResolve: () => void;
  const rootsReadyPromise = new Promise<void>((resolve) => {
    rootsReadyResolve = resolve;
  });
  dispatcher.setClientRoots(clientRoots, rootsReadyPromise);

  let requestIdCounter = 0;
  const pendingServerRequests = new Map<
    string | number,
    {
      resolve: (res: any) => void;
      reject: (err: any) => void;
      timer: NodeJS.Timeout;
    }
  >();

  const inStream = options?.input ?? process.stdin;
  const outStream = options?.output ?? process.stdout;

  const rl = readline.createInterface({
    input: inStream,
    terminal: false,
  });

  const sendResponse = (id: string | number | null | undefined, result: unknown) => {
    if (id === undefined) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
    outStream.write(`${payload}\n`);
  };

  const sendError = (id: string | number | null | undefined, code: number, message: string) => {
    if (id === undefined) return;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    outStream.write(`${payload}\n`);
  };

  const sendServerRequest = (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 150
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const reqId = `evo_srv_${++requestIdCounter}`;
      const timer = setTimeout(() => {
        pendingServerRequests.delete(reqId);
        reject(new Error(`Server request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pendingServerRequests.set(reqId, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params });
      outStream.write(`${payload}\n`);
    });
  };

  const inFlightTasks = new Set<Promise<void>>();

  rl.on('line', (line) => {
    const task = (async () => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let req: any;
      try {
        req = JSON.parse(trimmed);
      } catch {
        sendError(null, -32700, 'Parse error');
        return;
      }

    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      sendError(null, -32600, 'Invalid Request');
      return;
    }

    // Two-way JSON-RPC frame demuxing: resolve pending server-initiated requests
    if (req.id !== undefined && !('method' in req) && ('result' in req || 'error' in req)) {
      const pending = pendingServerRequests.get(req.id);
      if (pending) {
        pendingServerRequests.delete(req.id);
        clearTimeout(pending.timer);
        if (req.error) {
          pending.reject(req.error);
        } else {
          pending.resolve(req.result);
        }
      }
      return;
    }

    const { id, method, params } = req;

    switch (method) {
      case 'initialize': {
        if (params && typeof params === 'object') {
          if (typeof params.rootUri === 'string') {
            appendUniqueRoot(clientRoots, parseUriToPath(params.rootUri));
          }
          if (typeof params.rootPath === 'string' && params.rootPath.trim()) {
            appendUniqueRoot(clientRoots, path.resolve(params.rootPath.trim()));
          }
          if (Array.isArray(params.workspaceFolders)) {
            for (const folder of params.workspaceFolders) {
              if (folder && typeof folder.uri === 'string') {
                appendUniqueRoot(clientRoots, parseUriToPath(folder.uri));
              }
            }
          }
        }
        dispatcher.setClientRoots(clientRoots);

        const clientCapabilities = params?.capabilities as Record<string, unknown> | undefined;
        clientSupportsRoots = Boolean(clientCapabilities && clientCapabilities.roots);
        if (!clientSupportsRoots) {
          rootsReadyResolve();
        }

        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: 'evo-kernel',
            version: EVO_KERNEL_VERSION,
          },
          instructions: MCP_INSTRUCTIONS,
        });
        break;
      }

      case 'notifications/initialized':
      case 'initialized': {
        if (clientSupportsRoots) {
          sendServerRequest('roots/list', undefined, 150)
            .then((res: any) => {
              if (res && Array.isArray(res.roots)) {
                for (const r of res.roots) {
                  if (r && typeof r.uri === 'string') {
                    appendUniqueRoot(clientRoots, parseUriToPath(r.uri));
                  }
                }
                dispatcher.setClientRoots(clientRoots);
              }
            })
            .catch(() => {})
            .finally(() => {
              rootsReadyResolve();
            });
        }
        break;
      }

      case 'notifications/roots/list_changed':
      case 'roots/list_changed': {
        if (clientSupportsRoots) {
          sendServerRequest('roots/list', undefined, 150)
            .then((res: any) => {
              if (res && Array.isArray(res.roots)) {
                const newRoots: string[] = [];
                for (const r of res.roots) {
                  if (r && typeof r.uri === 'string') {
                    appendUniqueRoot(newRoots, parseUriToPath(r.uri));
                  }
                }
                clientRoots.length = 0;
                clientRoots.push(...newRoots);
                dispatcher.setClientRoots(clientRoots);
              }
            })
            .catch(() => {});
        }
        break;
      }

      case 'ping':
        sendResponse(id, {});
        break;

      case 'tools/list':
        sendResponse(id, {
          tools: META_MCP_TOOLS,
        });
        break;

      case 'tools/call': {
        const toolName = String(params?.name || '');
        const toolArgs = (params?.arguments || {}) as Record<string, unknown>;
        try {
          if (rootsReadyPromise) {
            await Promise.race([
              rootsReadyPromise,
              new Promise((r) => setTimeout(r, 150)),
            ]);
          }
          const callResult = await dispatcher.handleToolCallAsync(toolName, toolArgs);
          sendResponse(id, callResult);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendResponse(id, {
            isError: true,
            content: [{ type: 'text', text: `EvoKernel error in ${toolName}: ${msg}` }],
          });
        }
        break;
      }

      default:
        if (id !== undefined) {
          sendError(id, -32601, `Method not found: ${method}`);
        }
        break;
    }
    })();
    inFlightTasks.add(task);
    void task.finally(() => {
      inFlightTasks.delete(task);
    });
  });

  let closed = false;
  let sigintHandler: (() => void) | undefined;
  let sigtermHandler: (() => void) | undefined;

  const close = () => {
    if (closed) return;
    closed = true;
    if (sigintHandler) {
      process.off('SIGINT', sigintHandler);
      sigintHandler = undefined;
    }
    if (sigtermHandler) {
      process.off('SIGTERM', sigtermHandler);
      sigtermHandler = undefined;
    }
    try {
      rl.close();
    } catch {}
    for (const pending of pendingServerRequests.values()) {
      clearTimeout(pending.timer);
    }
    pendingServerRequests.clear();
    dispatcher.close();
  };

  rl.on('close', () => {
    if (inFlightTasks.size === 0) {
      close();
      return;
    }
    Promise.allSettled(Array.from(inFlightTasks)).finally(() => {
      close();
    });
  });

  if (!options?.input) {
    sigintHandler = () => {
      close();
      process.exit(0);
    };
    sigtermHandler = () => {
      close();
      process.exit(0);
    };
    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigtermHandler);
  }

  return { dispatcher, close };
}
