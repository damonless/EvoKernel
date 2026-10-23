import * as readline from 'node:readline';
import { EvoMcpDispatcher, META_MCP_TOOLS } from './handlers.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function startMcpStdioServer(workspaceRoot: string): void {
  const dispatcher = new EvoMcpDispatcher(workspaceRoot);

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

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      sendError(null, -32700, 'Parse error');
      return;
    }

    const { id, method, params } = req;

    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: 'evo-kernel',
            version: '0.1.0',
          },
        });
        break;

      case 'notifications/initialized':
      case 'initialized':
        break;

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
        const callResult = await dispatcher.handleToolCall(toolName, toolArgs);
        sendResponse(id, callResult);
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
