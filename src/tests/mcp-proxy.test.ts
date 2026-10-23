import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  McpProxyManager,
  formatExternalToolId,
  parseExternalToolId,
} from '../mcp/proxy.js';
import { EvoMcpDispatcher, META_MCP_TOOLS } from '../mcp/handlers.js';
import { EvoStorage } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evo-mcp-proxy-test-'));
}

describe('EvoKernel Downstream MCP Proxy Virtualization Suite (Milestone 3)', () => {
  let ws: string;
  let mockServerScript: string;

  beforeEach(() => {
    ws = createTempWorkspace();
    const storage = new EvoStorage(ws);
    storage.ensureInitialized();

    // Create a zero-dependency mock MCP stdio server
    mockServerScript = path.join(ws, 'mock_mcp_server.mjs');
    const mockServerCode = `import * as readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    const { id, method, params } = msg;

    if (method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mock-database-server', version: '1.0.0' },
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (method === 'notifications/initialized' || method === 'initialized') {
      // no response needed
    } else if (method === 'tools/list') {
      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'query_db',
              description: 'Execute read-only SQL query on mock database.',
              inputSchema: {
                type: 'object',
                properties: { sql: { type: 'string', description: 'SQL query' } },
                required: ['sql'],
              },
            },
            {
              name: 'execute_migration',
              description: 'Execute DDL migration script.',
              inputSchema: {
                type: 'object',
                properties: { script: { type: 'string' } },
              },
            },
          ],
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: 'ok', tool: toolName, receivedArgs: toolArgs }),
            },
          ],
        },
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    } else if (id !== undefined) {
      const resp = {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'Method not found' },
      };
      process.stdout.write(JSON.stringify(resp) + '\\n');
    }
  } catch (err) {
    // ignore parse error
  }
});
`;
    fs.writeFileSync(mockServerScript, mockServerCode, 'utf8');
  });

  afterEach(() => {
    try {
      fs.rmSync(ws, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('1. Tool ID formatting and parsing validates namespacing invariants', () => {
    const id = formatExternalToolId('postgres', 'run_query');
    assert.equal(id, 'ext__postgres__run_query');

    const parsed = parseExternalToolId('ext__postgres__run_query');
    assert.deepEqual(parsed, { serverName: 'postgres', originalToolName: 'run_query' });

    const hyphenParsed = parseExternalToolId('ext__my-server__custom_tool-1');
    assert.deepEqual(hyphenParsed, { serverName: 'my-server', originalToolName: 'custom_tool-1' });

    assert.equal(parseExternalToolId('run_query'), null);
    assert.equal(parseExternalToolId('ext_invalid'), null);
    assert.equal(parseExternalToolId('local-micro-tool'), null);
  });

  test('2. Downstream Mock Server Handshake & Tool Discovery saves tools to cache', async () => {
    const proxyManager = new McpProxyManager(ws);
    try {
      const discovered = await proxyManager.syncExternalTools({
        mockdb: {
          command: 'node',
          args: [mockServerScript],
        },
      });

      assert.equal(discovered.length, 2);
      assert.equal(discovered[0].id, 'ext__mockdb__query_db');
      assert.equal(discovered[0].serverName, 'mockdb');
      assert.equal(discovered[0].originalName, 'query_db');
      assert.match(discovered[0].description, /read-only SQL query/i);

      assert.equal(discovered[1].id, 'ext__mockdb__execute_migration');

      // Save to storage cache
      const storage = new EvoStorage(ws);
      storage.saveExternalTools(discovered);

      const cached = storage.listExternalTools();
      assert.equal(cached.length, 2);
      assert.equal(storage.getExternalTool('ext__mockdb__query_db')?.serverName, 'mockdb');
    } finally {
      proxyManager.close();
    }
  });

  test('3. FTS5 / BM25 Search Discovery recalls virtualized external tools without prompt bloat', () => {
    const storage = new EvoStorage(ws);
    storage.saveExternalTools([
      {
        id: 'ext__mockdb__query_db',
        serverName: 'mockdb',
        originalName: 'query_db',
        title: '[External: mockdb] query_db',
        description: 'Execute read-only SQL query on mock database.',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
        cachedAt: new Date().toISOString(),
      },
    ]);

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const searchRes = dispatcher.handleToolCall('evo_search', {
        workspace: ws,
        query: 'query_db sql database',
        kind: 'tool',
      });

      assert.equal(Boolean(searchRes.isError), false);
      const text = searchRes.content[0].text;
      assert.match(text, /ext__mockdb__query_db/);
      assert.match(text, /Execute read-only SQL query/);
    } finally {
      dispatcher.close();
    }
  });

  test('4. Progressive Inspection (L1 and L2) returns schema and routing directives', () => {
    const storage = new EvoStorage(ws);
    storage.saveExternalTools([
      {
        id: 'ext__mockdb__query_db',
        serverName: 'mockdb',
        originalName: 'query_db',
        title: '[External: mockdb] query_db',
        description: 'Execute read-only SQL query on mock database.',
        inputSchema: {
          type: 'object',
          properties: { sql: { type: 'string' } },
          required: ['sql'],
        },
        cachedAt: new Date().toISOString(),
      },
    ]);

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // L1 Inspect
      const l1Res = dispatcher.handleToolCall('evo_inspect', {
        workspace: ws,
        id: 'ext__mockdb__query_db',
        tier: 'L1',
      });
      assert.equal(Boolean(l1Res.isError), false);
      assert.match(l1Res.content[0].text, /\[EXTERNAL TOOL L1\] ext__mockdb__query_db/);
      assert.match(l1Res.content[0].text, /Input Schema:/);

      // L2 Inspect
      const l2Res = dispatcher.handleToolCall('evo_inspect', {
        workspace: ws,
        id: 'ext__mockdb__query_db',
        tier: 'L2',
      });
      assert.equal(Boolean(l2Res.isError), false);
      assert.match(l2Res.content[0].text, /\[EXTERNAL TOOL L2\] ext__mockdb__query_db/);
      assert.match(l2Res.content[0].text, /Routed via downstream MCP server 'mockdb'/);
      assert.match(l2Res.content[0].text, /evo_run\("ext__mockdb__query_db", args\)/);
    } finally {
      dispatcher.close();
    }
  });

  test('5. Proxy Execution via evo_run executes downstream MCP tool via stdio JSON-RPC', async () => {
    const storage = new EvoStorage(ws);
    const config = storage.getConfig();
    config.externalServers = {
      mockdb: {
        command: 'node',
        args: [mockServerScript],
      },
    };
    storage.saveConfig(config);

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const runRes = await dispatcher.handleToolCall('evo_run', {
        workspace: ws,
        tool_id: 'ext__mockdb__query_db',
        args: { sql: 'SELECT * FROM users;' },
      });

      assert.equal(runRes.isError, false);
      const text = runRes.content[0].text;
      assert.match(text, /\[evo_run: ext__mockdb__query_db \(proxy: mockdb\/query_db\) \| exit=0/);
      assert.match(text, /"status":\s*"ok"/);
      assert.match(text, /"tool":\s*"query_db"/);
      assert.match(text, /SELECT \* FROM users;/);
    } finally {
      dispatcher.close();
    }
  });

  test('6. Fixed 5-Tool Prompt Cache Invariant is strictly preserved', () => {
    assert.equal(META_MCP_TOOLS.length, 5);
    const toolNames = META_MCP_TOOLS.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      'evo_compact',
      'evo_inspect',
      'evo_propose',
      'evo_run',
      'evo_search',
    ]);
  });
});
