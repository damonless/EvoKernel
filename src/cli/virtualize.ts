import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EvoStorage } from '../core/storage.js';
import type { ExternalMcpServerConfig } from '../core/types.js';
import { resolveEvoMcpLaunchConfig } from './harness.js';

export interface VirtualizeOptions {
  dryRun?: boolean;
  restore?: boolean;
  includeGlobal?: boolean;
}

export interface VirtualizedServerOrigin {
  configPath: string;
  relPath: string;
  format: 'mcpServers' | 'vscodeServers' | 'opencodeMcp' | 'codexToml';
  rawEntry?: unknown;
  injectedEvoKernel?: boolean;
}

export interface VirtualizedServerEntry {
  name: string;
  config: ExternalMcpServerConfig;
  origins: VirtualizedServerOrigin[];
  estimatedSchemaTokens: number;
}

export interface VirtualizeResult {
  mode: 'virtualize' | 'dry-run' | 'restore';
  workspaceRoot: string;
  poolPath: string;
  servers: VirtualizedServerEntry[];
  modifiedConfigFiles: string[];
  estimatedTokensSavedPerTurn: number;
}

interface McpPoolFileSchema {
  version: string;
  updatedAt: string;
  mcpServers: Record<string, ExternalMcpServerConfig>;
  origins: Record<string, VirtualizedServerOrigin[]>;
}

const ESTIMATED_TOKENS_PER_EXTERNAL_SERVER = 850;

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function normalizeServerConfig(raw: Record<string, unknown>, format: VirtualizedServerOrigin['format']): ExternalMcpServerConfig | null {
  if (format === 'opencodeMcp' && Array.isArray(raw.command)) {
    const cmdArr = raw.command.map(String);
    if (cmdArr.length === 0 || !cmdArr[0]) return null;
    const rawEnv =
      raw.environment && typeof raw.environment === 'object' && !Array.isArray(raw.environment)
        ? raw.environment
        : raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
          ? raw.env
          : undefined;
    const envObj = rawEnv
      ? Object.fromEntries(Object.entries(rawEnv as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined;
    return {
      command: cmdArr[0],
      args: cmdArr.slice(1),
      ...(envObj && Object.keys(envObj).length > 0 ? { env: envObj } : {}),
      ...(typeof raw.cwd === 'string' && raw.cwd.trim() ? { cwd: raw.cwd.trim() } : {}),
    };
  }

  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) return null;
  const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
  const rawEnv =
    raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? raw.env
      : raw.environment && typeof raw.environment === 'object' && !Array.isArray(raw.environment)
        ? raw.environment
        : undefined;
  const envObj = rawEnv
    ? Object.fromEntries(Object.entries(rawEnv as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    : undefined;

  return {
    command,
    args,
    ...(envObj && Object.keys(envObj).length > 0 ? { env: envObj } : {}),
    ...(typeof raw.cwd === 'string' && raw.cwd.trim() ? { cwd: raw.cwd.trim() } : {}),
  };
}

function stripTomlInlineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && inDouble) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function countTomlOpenDelta(line: string): number {
  const clean = stripTomlInlineComment(line);
  let delta = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '\\' && inDouble) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') delta++;
      else if (ch === ']' || ch === '}') delta--;
    }
  }
  return delta;
}

function parseTomlQuotedString(raw: string): string | undefined {
  const m = raw.trim().match(/^(?:"((?:[^"\\]|\\.)*)"|'([^']*)')$/);
  if (!m) return undefined;
  if (m[1] !== undefined) {
    return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return m[2];
}

function parseCodexMcpHeader(header: string): { name: string; isEnv: boolean } | null {
  const trimmed = header.trim();
  const bareMatch = trimmed.match(/^mcp_servers\.([a-zA-Z0-9_-]+)(\.env)?$/);
  if (bareMatch) {
    return { name: bareMatch[1], isEnv: Boolean(bareMatch[2]) };
  }
  const dblMatch = trimmed.match(/^mcp_servers\."((?:[^"\\]|\\.)+)"(\.env)?$/);
  if (dblMatch) {
    const unescaped = dblMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return { name: unescaped, isEnv: Boolean(dblMatch[2]) };
  }
  const sglMatch = trimmed.match(/^mcp_servers\.'([^']+)'(\.env)?$/);
  if (sglMatch) {
    return { name: sglMatch[1], isEnv: Boolean(sglMatch[2]) };
  }
  return null;
}

function formatCodexTomlKey(name: string): string {
  return /^[a-zA-Z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
}

function hasEvoKernelInCodexToml(content: string): boolean {
  const lines = content.split(/\r?\n/);
  let bracketDepth = 0;
  for (const line of lines) {
    const clean = stripTomlInlineComment(line).trim();
    if (bracketDepth === 0) {
      const hdrMatch = clean.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
      if (hdrMatch) {
        const parsed = parseCodexMcpHeader(hdrMatch[1]);
        if (parsed && parsed.name === 'evo-kernel' && !parsed.isEnv) {
          return true;
        }
        continue;
      }
    }
    bracketDepth = Math.max(0, bracketDepth + countTomlOpenDelta(line));
  }
  return false;
}

function stripEvoKernelFromCodexToml(content: string): string {
  const lines = content.split(/\r?\n/);
  interface TomlSection {
    header: string;
    startLine: number;
    endLine: number;
  }
  const sections: TomlSection[] = [];
  let bracketDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const clean = stripTomlInlineComment(lines[i]).trim();
    if (bracketDepth === 0) {
      const hdrMatch = clean.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
      if (hdrMatch) {
        if (sections.length > 0) {
          let prevEnd = i;
          while (
            prevEnd > sections[sections.length - 1].startLine + 1 &&
            lines[prevEnd - 1].trim().startsWith('#')
          ) {
            prevEnd--;
          }
          sections[sections.length - 1].endLine = prevEnd;
        }
        sections.push({ header: hdrMatch[1].trim(), startLine: i, endLine: lines.length });
        continue;
      }
    }
    bracketDepth = Math.max(0, bracketDepth + countTomlOpenDelta(lines[i]));
  }

  const removedIndices = new Set<number>();
  for (const sec of sections) {
    const parsed = parseCodexMcpHeader(sec.header);
    if (parsed && parsed.name === 'evo-kernel') {
      for (let idx = sec.startLine; idx < sec.endLine; idx++) {
        removedIndices.add(idx);
      }
    }
  }
  if (removedIndices.size === 0) return content;
  return lines.filter((_, idx) => !removedIndices.has(idx)).join('\n');
}

function parseCodexTomlMcpServers(content: string): Array<{
  name: string;
  config: ExternalMcpServerConfig;
  rawBlock: string;
  lineRanges: Array<[number, number]>;
}> {
  const lines = content.split(/\r?\n/);
  interface TomlSection {
    header: string;
    startLine: number;
    endLine: number;
  }
  const sections: TomlSection[] = [];
  let bracketDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const clean = stripTomlInlineComment(lines[i]).trim();
    if (bracketDepth === 0) {
      const hdrMatch = clean.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
      if (hdrMatch) {
        if (sections.length > 0) {
          let prevEnd = i;
          while (prevEnd > sections[sections.length - 1].startLine + 1 && lines[prevEnd - 1].trim().startsWith('#')) {
            prevEnd--;
          }
          sections[sections.length - 1].endLine = prevEnd;
        }
        sections.push({
          header: hdrMatch[1].trim(),
          startLine: i,
          endLine: lines.length,
        });
        continue;
      }
    }
    bracketDepth = Math.max(0, bracketDepth + countTomlOpenDelta(lines[i]));
  }

  const grouped = new Map<
    string,
    {
      mainSection?: TomlSection;
      envSection?: TomlSection;
    }
  >();

  for (const sec of sections) {
    const parsedHdr = parseCodexMcpHeader(sec.header);
    if (!parsedHdr) continue;
    const { name, isEnv } = parsedHdr;
    if (!name || name === 'evo-kernel') continue;
    const cur = grouped.get(name) || {};
    if (isEnv) {
      cur.envSection = sec;
    } else {
      cur.mainSection = sec;
    }
    grouped.set(name, cur);
  }

  const results: Array<{
    name: string;
    config: ExternalMcpServerConfig;
    rawBlock: string;
    lineRanges: Array<[number, number]>;
  }> = [];

  for (const [name, entry] of grouped.entries()) {
    if (!entry.mainSection) continue;
    const mainRawLines = lines.slice(entry.mainSection.startLine, entry.mainSection.endLine);
    const bodyClean = mainRawLines
      .slice(1)
      .map((l) => stripTomlInlineComment(l))
      .join('\n');

    const cmdMatch = bodyClean.match(/^\s*command\s*=\s*("[^"]*"|'[^']*')/m);
    if (!cmdMatch) continue;
    const command = parseTomlQuotedString(cmdMatch[1]) || '';
    if (!command) continue;

    let args: string[] = [];
    const argsMatch = bodyClean.match(/^\s*args\s*=\s*\[([\s\S]*?)\]/m);
    if (argsMatch) {
      const tokens = argsMatch[1].match(/"(?:[^"\\]|\\.)*"|'[^']*'/g) || [];
      args = tokens
        .map((t) => parseTomlQuotedString(t))
        .filter((v): v is string => v !== undefined);
    }

    let cwd: string | undefined;
    const cwdMatch = bodyClean.match(/^\s*cwd\s*=\s*("[^"]*"|'[^']*')/m);
    if (cwdMatch) {
      cwd = parseTomlQuotedString(cwdMatch[1]);
    }

    const env: Record<string, string> = {};
    const inlineEnvMatch = bodyClean.match(/^\s*env\s*=\s*\{([\s\S]*?)\}/m);
    if (inlineEnvMatch) {
      const kvRegex = /([A-Za-z0-9_.-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/g;
      let kv: RegExpExecArray | null;
      while ((kv = kvRegex.exec(inlineEnvMatch[1])) !== null) {
        const val = parseTomlQuotedString(kv[2]);
        if (val !== undefined) env[kv[1]] = val;
      }
    }

    const lineRanges: Array<[number, number]> = [
      [entry.mainSection.startLine, entry.mainSection.endLine],
    ];
    const rawParts = [mainRawLines.join('\n').trim()];

    if (entry.envSection) {
      const envRawLines = lines.slice(entry.envSection.startLine, entry.envSection.endLine);
      rawParts.push(envRawLines.join('\n').trim());
      lineRanges.push([entry.envSection.startLine, entry.envSection.endLine]);
      for (const rawLine of envRawLines.slice(1)) {
        const cleanLine = stripTomlInlineComment(rawLine).trim();
        if (!cleanLine) continue;
        const eqIdx = cleanLine.indexOf('=');
        if (eqIdx === -1) continue;
        const k = cleanLine.slice(0, eqIdx).trim();
        const vRaw = cleanLine.slice(eqIdx + 1).trim();
        const val = parseTomlQuotedString(vRaw) ?? vRaw;
        if (k) env[k] = val;
      }
    }

    results.push({
      name,
      config: {
        command,
        args,
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(cwd ? { cwd } : {}),
      },
      rawBlock: rawParts.join('\n\n') + '\n',
      lineRanges,
    });
  }

  return results;
}

export function runVirtualize(
  workspaceRoot: string,
  options: VirtualizeOptions = {}
): VirtualizeResult {
  const ws = path.resolve(workspaceRoot);
  const storage = new EvoStorage(ws);
  const poolPath = path.join(storage.evoDir, 'mcp-pool.json');

  if (options.restore) {
    return runRestoreVirtualized(ws, storage, poolPath, Boolean(options.dryRun));
  }

  const candidateTargets: Array<{
    configPath: string;
    relPath: string;
    format: VirtualizedServerOrigin['format'];
  }> = [
    { configPath: path.join(ws, '.mcp.json'), relPath: '.mcp.json', format: 'mcpServers' },
    { configPath: path.join(ws, '.cursor', 'mcp.json'), relPath: '.cursor/mcp.json', format: 'mcpServers' },
    { configPath: path.join(ws, '.windsurf', 'mcp.json'), relPath: '.windsurf/mcp.json', format: 'mcpServers' },
    { configPath: path.join(ws, '.cline', 'mcp.json'), relPath: '.cline/mcp.json', format: 'mcpServers' },
    { configPath: path.join(ws, '.roo', 'mcp.json'), relPath: '.roo/mcp.json', format: 'mcpServers' },
    { configPath: path.join(ws, '.gemini', 'settings.json'), relPath: '.gemini/settings.json', format: 'mcpServers' },
    { configPath: path.join(ws, '.vscode', 'mcp.json'), relPath: '.vscode/mcp.json', format: 'vscodeServers' },
    { configPath: path.join(ws, 'opencode.json'), relPath: 'opencode.json', format: 'opencodeMcp' },
    { configPath: path.join(ws, '.codex', 'config.toml'), relPath: '.codex/config.toml', format: 'codexToml' },
  ];

  if (options.includeGlobal) {
    const home = os.homedir();
    candidateTargets.push(
      { configPath: path.join(home, '.cursor', 'mcp.json'), relPath: '~/.cursor/mcp.json', format: 'mcpServers' },
      { configPath: path.join(home, '.gemini', 'settings.json'), relPath: '~/.gemini/settings.json', format: 'mcpServers' }
    );
  }

  const discoveredMap = new Map<string, VirtualizedServerEntry>();
  const modifiedConfigFiles: string[] = [];
  const evoLaunch = resolveEvoMcpLaunchConfig(ws);

  for (const target of candidateTargets) {
    if (!fs.existsSync(target.configPath)) continue;

    if (target.format === 'codexToml') {
      const content = fs.readFileSync(target.configPath, 'utf8');
      const parsedBlocks = parseCodexTomlMcpServers(content);
      if (parsedBlocks.length === 0) continue;
      const hadEvoKernel = hasEvoKernelInCodexToml(content);

      for (const blk of parsedBlocks) {
        const existing = discoveredMap.get(blk.name);
        const origin: VirtualizedServerOrigin = {
          configPath: target.configPath,
          relPath: target.relPath,
          format: 'codexToml',
          rawEntry: blk.rawBlock,
          injectedEvoKernel: !hadEvoKernel,
        };
        if (existing) {
          existing.origins.push(origin);
        } else {
          discoveredMap.set(blk.name, {
            name: blk.name,
            config: blk.config,
            origins: [origin],
            estimatedSchemaTokens: ESTIMATED_TOKENS_PER_EXTERNAL_SERVER,
          });
        }
      }

      if (!options.dryRun) {
        const lines = content.split(/\r?\n/);
        const removedIndices = new Set<number>();
        for (const blk of parsedBlocks) {
          for (const [sLine, eLine] of blk.lineRanges) {
            for (let idx = sLine; idx < eLine; idx++) {
              removedIndices.add(idx);
            }
          }
        }
        let updated = lines.filter((_, idx) => !removedIndices.has(idx)).join('\n');
        if (!hasEvoKernelInCodexToml(updated)) {
          const argsToml = JSON.stringify(evoLaunch.args);
          const evoBlock = `[mcp_servers.evo-kernel]\ncommand = "${evoLaunch.command.replace(/\\/g, '/')}"\nargs = ${argsToml}\n`;
          updated = updated.trim() ? `${updated.trim()}\n\n${evoBlock}` : evoBlock;
        }
        fs.writeFileSync(target.configPath, updated.trim() + '\n', 'utf8');
      }
      modifiedConfigFiles.push(target.relPath);
      continue;
    }

    const doc = readJsonSafe(target.configPath);
    if (!doc) continue;

    let containerKey =
      target.format === 'vscodeServers'
        ? 'servers'
        : target.format === 'opencodeMcp'
          ? 'mcp'
          : 'mcpServers';

    let effectiveFormat = target.format;
    let serversObj = doc[containerKey];
    if (
      (!serversObj || typeof serversObj !== 'object' || Array.isArray(serversObj)) &&
      containerKey !== 'mcpServers' &&
      doc.mcpServers &&
      typeof doc.mcpServers === 'object' &&
      !Array.isArray(doc.mcpServers)
    ) {
      containerKey = 'mcpServers';
      effectiveFormat = 'mcpServers';
      serversObj = doc.mcpServers;
    }
    if (!serversObj || typeof serversObj !== 'object' || Array.isArray(serversObj)) {
      continue;
    }

    const record = { ...(serversObj as Record<string, unknown>) };
    const hadEvoKernel = Boolean(record['evo-kernel']);
    let fileTouched = false;

    for (const [serverName, rawDef] of Object.entries(record)) {
      if (serverName === 'evo-kernel') continue;
      if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) continue;

      const normalized = normalizeServerConfig(rawDef as Record<string, unknown>, target.format);
      if (!normalized) continue;

      const origin: VirtualizedServerOrigin = {
        configPath: target.configPath,
        relPath: target.relPath,
        format: effectiveFormat,
        rawEntry: rawDef,
        injectedEvoKernel: !hadEvoKernel,
      };

      const existing = discoveredMap.get(serverName);
      if (existing) {
        existing.origins.push(origin);
      } else {
        discoveredMap.set(serverName, {
          name: serverName,
          config: normalized,
          origins: [origin],
          estimatedSchemaTokens: ESTIMATED_TOKENS_PER_EXTERNAL_SERVER,
        });
      }

      delete record[serverName];
      fileTouched = true;
    }

    if (fileTouched) {
      if (!options.dryRun) {
        if (!record['evo-kernel']) {
          if (effectiveFormat === 'vscodeServers') {
            record['evo-kernel'] = {
              type: 'stdio',
              command: evoLaunch.command,
              args: evoLaunch.args,
            };
          } else if (effectiveFormat === 'opencodeMcp') {
            record['evo-kernel'] = {
              type: 'local',
              command: [evoLaunch.command, ...evoLaunch.args],
              enabled: true,
            };
          } else {
            record['evo-kernel'] = {
              command: evoLaunch.command,
              args: evoLaunch.args,
            };
          }
        }
        doc[containerKey] = record;
        writeJsonAtomic(target.configPath, doc);
      }
      modifiedConfigFiles.push(target.relPath);
    }
  }

  const servers = Array.from(discoveredMap.values());
  const estimatedTokensSavedPerTurn = servers.reduce((acc, s) => acc + s.estimatedSchemaTokens, 0);

  if (!options.dryRun && servers.length > 0) {
    storage.ensureInitialized();

    let existingPool: McpPoolFileSchema = {
      version: '0.1.0',
      updatedAt: new Date().toISOString(),
      mcpServers: {},
      origins: {},
    };
    const rawPool = readJsonSafe(poolPath);
    if (rawPool) {
      existingPool = {
        version: '0.1.0',
        updatedAt: new Date().toISOString(),
        mcpServers:
          rawPool.mcpServers && typeof rawPool.mcpServers === 'object'
            ? (rawPool.mcpServers as Record<string, ExternalMcpServerConfig>)
            : {},
        origins:
          rawPool.origins && typeof rawPool.origins === 'object'
            ? (rawPool.origins as Record<string, VirtualizedServerOrigin[]>)
            : {},
      };
    }

    const evoConfig = storage.getConfig();
    const externalServers: Record<string, ExternalMcpServerConfig> = {
      ...(evoConfig.externalServers || {}),
    };

    for (const srv of servers) {
      existingPool.mcpServers[srv.name] = srv.config;
      const prevOrigins = existingPool.origins[srv.name] || [];
      const mergedOrigins = [...prevOrigins];
      for (const o of srv.origins) {
        if (!mergedOrigins.some((p) => p.configPath === o.configPath)) {
          mergedOrigins.push(o);
        }
      }
      existingPool.origins[srv.name] = mergedOrigins;
      externalServers[srv.name] = srv.config;
    }

    existingPool.updatedAt = new Date().toISOString();
    writeJsonAtomic(poolPath, existingPool);

    evoConfig.externalServers = externalServers;
    storage.saveConfig(evoConfig);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'virtualize',
    workspaceRoot: ws,
    poolPath,
    servers,
    modifiedConfigFiles,
    estimatedTokensSavedPerTurn,
  };
}

function runRestoreVirtualized(
  ws: string,
  storage: EvoStorage,
  poolPath: string,
  dryRun: boolean
): VirtualizeResult {
  const rawPool = readJsonSafe(poolPath);
  const poolServers =
    rawPool?.mcpServers && typeof rawPool.mcpServers === 'object'
      ? (rawPool.mcpServers as Record<string, ExternalMcpServerConfig>)
      : {};
  const poolOrigins =
    rawPool?.origins && typeof rawPool.origins === 'object'
      ? (rawPool.origins as Record<string, VirtualizedServerOrigin[]>)
      : {};

  const evoConfig = storage.getConfig();
  const poolKeys = Object.keys(poolServers);
  const allServerNames =
    poolKeys.length > 0
      ? poolKeys
      : Object.keys(evoConfig.externalServers || {});

  const restoredEntries: VirtualizedServerEntry[] = [];
  const modifiedSet = new Set<string>();
  const injectedEvoByFile = new Map<string, VirtualizedServerOrigin['format']>();

  for (const name of allServerNames) {
    const cfg = poolServers[name] || evoConfig.externalServers?.[name];
    if (!cfg) continue;
    const origins: VirtualizedServerOrigin[] =
      poolOrigins[name] && poolOrigins[name].length > 0
        ? poolOrigins[name]
        : [
            {
              configPath: path.join(ws, '.mcp.json'),
              relPath: '.mcp.json',
              format: 'mcpServers',
              rawEntry: cfg,
            },
          ];

    restoredEntries.push({
      name,
      config: cfg,
      origins,
      estimatedSchemaTokens: ESTIMATED_TOKENS_PER_EXTERNAL_SERVER,
    });

    for (const origin of origins) {
      modifiedSet.add(origin.relPath);
      if (origin.injectedEvoKernel) {
        injectedEvoByFile.set(origin.configPath, origin.format);
      }
      if (dryRun) continue;

      if (origin.format === 'codexToml') {
        const existingToml = fs.existsSync(origin.configPath)
          ? fs.readFileSync(origin.configPath, 'utf8')
          : '';
        const alreadyPresent = parseCodexTomlMcpServers(existingToml).some((s) => s.name === name);
        if (!alreadyPresent) {
          const block =
            typeof origin.rawEntry === 'string' && origin.rawEntry.trim()
              ? origin.rawEntry.trim()
              : `[mcp_servers.${formatCodexTomlKey(name)}]\ncommand = "${cfg.command}"\nargs = ${JSON.stringify(cfg.args || [])}`;
          const nextToml = existingToml.trim() ? `${existingToml.trim()}\n\n${block}\n` : `${block}\n`;
          fs.mkdirSync(path.dirname(origin.configPath), { recursive: true });
          fs.writeFileSync(origin.configPath, nextToml, 'utf8');
        }
        continue;
      }

      const doc = readJsonSafe(origin.configPath) || {};
      const containerKey =
        origin.format === 'vscodeServers'
          ? 'servers'
          : origin.format === 'opencodeMcp'
            ? 'mcp'
            : 'mcpServers';
      const record =
        doc[containerKey] && typeof doc[containerKey] === 'object' && !Array.isArray(doc[containerKey])
          ? { ...(doc[containerKey] as Record<string, unknown>) }
          : {};

      if (origin.rawEntry && typeof origin.rawEntry === 'object') {
        record[name] = origin.rawEntry;
      } else if (origin.format === 'vscodeServers') {
        record[name] = { type: 'stdio', ...cfg };
      } else if (origin.format === 'opencodeMcp') {
        record[name] = {
          type: 'local',
          command: [cfg.command, ...(cfg.args || [])],
          enabled: true,
        };
      } else {
        record[name] = cfg;
      }

      doc[containerKey] = record;
      writeJsonAtomic(origin.configPath, doc);
    }
  }

  if (!dryRun) {
    for (const [configPath, format] of injectedEvoByFile.entries()) {
      if (!fs.existsSync(configPath)) continue;
      if (format === 'codexToml') {
        const rawToml = fs.readFileSync(configPath, 'utf8');
        const cleanedToml = stripEvoKernelFromCodexToml(rawToml);
        if (cleanedToml !== rawToml) {
          fs.writeFileSync(configPath, cleanedToml.trim() ? `${cleanedToml.trim()}\n` : '', 'utf8');
        }
      } else {
        const doc = readJsonSafe(configPath);
        if (!doc) continue;
        const containerKey =
          format === 'vscodeServers'
            ? 'servers'
            : format === 'opencodeMcp'
              ? 'mcp'
              : 'mcpServers';
        const container = doc[containerKey];
        if (
          container &&
          typeof container === 'object' &&
          !Array.isArray(container) &&
          'evo-kernel' in (container as Record<string, unknown>)
        ) {
          const nextContainer = { ...(container as Record<string, unknown>) };
          delete nextContainer['evo-kernel'];
          doc[containerKey] = nextContainer;
          writeJsonAtomic(configPath, doc);
        }
      }
    }

    if (fs.existsSync(poolPath)) {
      fs.unlinkSync(poolPath);
    }
    if (evoConfig.externalServers) {
      for (const name of allServerNames) {
        delete evoConfig.externalServers[name];
      }
      if (Object.keys(evoConfig.externalServers).length === 0) {
        delete evoConfig.externalServers;
      }
      storage.saveConfig(evoConfig);
    }
  }

  return {
    mode: 'restore',
    workspaceRoot: ws,
    poolPath,
    servers: restoredEntries,
    modifiedConfigFiles: Array.from(modifiedSet),
    estimatedTokensSavedPerTurn: restoredEntries.reduce((acc, s) => acc + s.estimatedSchemaTokens, 0),
  };
}

export function renderVirtualizeReport(result: VirtualizeResult): string {
  const lines: string[] = [];
  lines.push('╔══════════════════════════════════════════════════════════════════════╗');
  lines.push('║  🌀 EvoKernel Zero-Schema-Bloat MCP Virtualizer (`evo virtualize`)   ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════╝');
  lines.push(`Workspace : ${result.workspaceRoot}`);
  lines.push(`Mode      : ${result.mode.toUpperCase()}`);
  lines.push('');

  if (result.servers.length === 0) {
    if (result.mode === 'restore') {
      lines.push('ℹ️  No virtualized MCP servers found in .evo/mcp-pool.json or .evo/config.json.');
    } else {
      lines.push('ℹ️  No third-party stdio MCP servers detected in workspace host configs.');
      lines.push('   Your host tool list is already clean (only `evo-kernel` 5-tool meta-protocol active).');
    }
    return lines.join('\n');
  }

  if (result.mode === 'restore') {
    lines.push(`🔄 Restored ${result.servers.length} virtualized MCP server(s) back to host configs:`);
    for (const srv of result.servers) {
      const originList = srv.origins.map((o) => o.relPath).join(', ');
      lines.push(`  ├─ 🔌 ${srv.name} (${srv.config.command} ${(srv.config.args || []).join(' ')}) -> [${originList}]`);
    }
    return lines.join('\n');
  }

  const actionVerb = result.mode === 'dry-run' ? 'Would fold' : 'Folded';
  lines.push(`📦 ${actionVerb} ${result.servers.length} third-party stdio MCP server(s) into EvoKernel Dynamic Proxy:`);
  for (const srv of result.servers) {
    const originList = srv.origins.map((o) => o.relPath).join(', ');
    lines.push(
      `  ├─ ⚡ [${srv.name}] (${srv.config.command}) from [${originList}] (~${srv.estimatedSchemaTokens} schema tokens/turn)`
    );
  }
  lines.push('');
  lines.push('📊 Context Window & Prompt Cache Impact:');
  lines.push(`  ├─ Before Virtualization : ~+${result.estimatedTokensSavedPerTurn} Always-On tool schema tokens / turn`);
  lines.push(`  ├─ After Virtualization  : +0 extra host tool definitions (folded into .evo/mcp-pool.json)`);
  lines.push(`  ├─ Prompt Cache Prefix   : 🔒 100% Static (5 fixed EvoKernel meta-tools: search/inspect/run/propose/compact)`);
  lines.push(
    `  └─ On-Demand Invocation  : evo_search("<query>") -> evo_inspect("ext__<server>__<tool>", "L2") -> evo_run("ext__<server>__<tool>", args)`
  );

  if (result.mode === 'dry-run') {
    lines.push('');
    lines.push('💡 Run `evo virtualize` (without `--dry-run`) to apply this optimization, or `evo virtualize --restore` to undo at any time.');
  }

  return lines.join('\n');
}
