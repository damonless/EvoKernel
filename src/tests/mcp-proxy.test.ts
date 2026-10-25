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

  test('7. Issue #9 [CRITICAL-3]: Automatic lazy discovery in evo_search and evo_inspect without manual cache pre-seeding', async () => {
    const storage = new EvoStorage(ws);
    const config = storage.getConfig();
    config.externalServers = {
      mockdb: {
        command: 'node',
        args: [mockServerScript],
      },
    };
    storage.saveConfig(config);

    // Notice we do NOT call storage.saveExternalTools() manually!
    assert.equal(storage.listExternalTools().length, 0);

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      const searchRes = await dispatcher.handleToolCall('evo_search', {
        workspace: ws,
        query: 'query_db SQL database',
        kind: 'tool',
      });
      assert.equal(Boolean(searchRes.isError), false);
      assert.match(searchRes.content[0].text, /ext__mockdb__query_db/);

      // Cache is now populated and indexed in FTS5
      assert.equal(storage.listExternalTools().length, 2);

      const inspectRes = await dispatcher.handleToolCall('evo_inspect', {
        workspace: ws,
        id: 'ext__mockdb__query_db',
        tier: 'L1',
      });
      assert.equal(Boolean(inspectRes.isError), false);
      assert.match(inspectRes.content[0].text, /\[EXTERNAL TOOL L1\] ext__mockdb__query_db/);
    } finally {
      dispatcher.close();
    }
  });

  test('8. Issue #9 [CRITICAL-4]: Preserves mixed-case / camelCase downstream tool names in evo_inspect and evo_run', async () => {
    const camelServerScript = path.join(ws, 'camel_mcp_server.mjs');
    fs.writeFileSync(
      camelServerScript,
      `import * as readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const msg = JSON.parse(line.trim());
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'github', version: '1.0' } } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'createPullRequest', description: 'Create a GitHub PR with camelCase name.', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }] } }) + '\\n');
  } else if (msg.method === 'tools/call') {
    // Strictly require exact camelCase name 'createPullRequest'
    if (msg.params?.name !== 'createPullRequest') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool (case mismatch): ' + msg.params?.name } }) + '\\n');
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { isError: false, content: [{ type: 'text', text: 'PR_CREATED_OK:' + msg.params.arguments.title }] } }) + '\\n');
    }
  }
});\n`,
      'utf8'
    );

    const storage = new EvoStorage(ws);
    const config = storage.getConfig();
    config.externalServers = {
      github: { command: 'node', args: [camelServerScript] },
    };
    storage.saveConfig(config);

    const dispatcher = new EvoMcpDispatcher(ws);
    try {
      // Auto-discover via evo_inspect using exact camelCase ID
      const inspectRes = await dispatcher.handleToolCall('evo_inspect', {
        workspace: ws,
        id: 'ext__github__createPullRequest',
        tier: 'L1',
      });
      assert.equal(Boolean(inspectRes.isError), false);
      assert.match(inspectRes.content[0].text, /ext__github__createPullRequest/);

      // Execute via evo_run and verify exact camelCase tool name reaches downstream server
      const runRes = await dispatcher.handleToolCall('evo_run', {
        workspace: ws,
        tool_id: 'ext__github__createPullRequest',
        args: { title: 'Fix camelCase proxy routing' },
      });
      assert.equal(runRes.isError, false);
      assert.match(runRes.content[0].text, /PR_CREATED_OK:Fix camelCase proxy routing/);
    } finally {
      dispatcher.close();
    }
  });

  test('9. Issue #9 [HIGH-5]: Per-workspace McpProxyManager isolation prevents cross-workspace server collisions', async () => {
    const wsB = createTempWorkspace();
    try {
      const storageA = new EvoStorage(ws);
      const cfgA = storageA.getConfig();
      cfgA.externalServers = {
        db: { command: 'node', args: [mockServerScript], env: { WS_TAG: 'Alpha' } },
      };
      storageA.saveConfig(cfgA);

      const scriptB = path.join(wsB, 'mock_b.mjs');
      fs.writeFileSync(
        scriptB,
        fs.readFileSync(mockServerScript, 'utf8').replace("'ok'", "'ok_from_beta'"),
        'utf8'
      );
      const storageB = new EvoStorage(wsB);
      storageB.ensureInitialized();
      const cfgB = storageB.getConfig();
      cfgB.externalServers = {
        db: { command: 'node', args: [scriptB] },
      };
      storageB.saveConfig(cfgB);

      const dispatcher = new EvoMcpDispatcher(ws);
      try {
        const resA = await dispatcher.handleToolCall('evo_run', {
          workspace: ws,
          tool_id: 'ext__db__query_db',
          args: { sql: 'SELECT 1' },
        });
        assert.match(resA.content[0].text, /"status":\s*"ok"/);

        const resB = await dispatcher.handleToolCall('evo_run', {
          workspace: wsB,
          tool_id: 'ext__db__query_db',
          args: { sql: 'SELECT 2' },
        });
        assert.match(resB.content[0].text, /"status":\s*"ok_from_beta"/);
      } finally {
        dispatcher.close();
      }
    } finally {
      fs.rmSync(wsB, { recursive: true, force: true });
    }
  });
});
