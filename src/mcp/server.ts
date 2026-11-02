import * as readline from 'node:readline';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvoMcpDispatcher, META_MCP_TOOLS } from './handlers.js';

export const MCP_INSTRUCTIONS =
  'EvoKernel Meta-Rules:\n' +
  '1. Search before act: Call evo_search(query, workspace) before reading/editing unfamiliar files or debugging errors.\n' +
  '2. Progressive inspect: On rule/skill/memory hit, call evo_inspect(id, "L2", workspace) to load full SOP/anchors before proceeding.\n' +
  '3. Mandatory crystallization: After verifying a bug fix or receiving user correction, call evo_propose(kind, ...) to crystallize lessons into .evo/.\n' +
  '4. Think in code: Use evo_run(tool_id, args, workspace) for multi-file checks instead of dumping raw file content.';

function parseUriToPath(uriStr: string): string | null {
  try {
    if (uriStr.startsWith('file://')) {
      return path.resolve(fileURLToPath(uriStr));
    }
    return path.resolve(uriStr);
  } catch {
    return null;
  }
}

export function startMcpStdioServer(workspaceRoot: string): void {
  const dispatcher = new EvoMcpDispatcher(workspaceRoot);
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

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  const sendResponse = (id: string | number | null | undefined, result: unknown) => {
    if (id === undefined) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
    process.stdout.write(`${payload}\n`);
  };

  const sendError = (id: string | number | null | undefined, code: number, message: string) => {
    if (id === undefined) return;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
    process.stdout.write(`${payload}\n`);
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
      process.stdout.write(`${payload}\n`);
    });
  };

  rl.on('line', async (line) => {
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
            const p = parseUriToPath(params.rootUri);
            if (p && !clientRoots.includes(p)) clientRoots.push(p);
          }
          if (typeof params.rootPath === 'string') {
            const p = path.resolve(params.rootPath);
            if (!clientRoots.includes(p)) clientRoots.push(p);
          }
          if (Array.isArray(params.workspaceFolders)) {
            for (const folder of params.workspaceFolders) {
              if (folder && typeof folder.uri === 'string') {
                const p = parseUriToPath(folder.uri);
                if (p && !clientRoots.includes(p)) clientRoots.push(p);
              }
            }
          }
        }

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
            version: '0.2.0',
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
                    const p = parseUriToPath(r.uri);
                    if (p && !clientRoots.includes(p)) clientRoots.push(p);
                  }
                }
              }
            })
            .catch(() => {})
            .finally(() => {
              rootsReadyResolve();
            });
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
          const callResult = await dispatcher.handleToolCall(toolName, toolArgs);
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
  });

  process.on('SIGINT', () => {
    dispatcher.close();
    process.exit(0);
  });
}
