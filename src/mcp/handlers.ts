import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  EvoKind,
  EvoMemory,
  EvoRule,
  MemoryVerificationReport,
  ProposalPayload,
  SearchHit,
} from '../core/types.js';
import {
  EvoStorage,
  findNearestEvoWorkspace,
  hasValidEvoStructure,
  isHollowEvoZombieDir,
  isHostGlobalConfigDir,
  isPluginOrExtensionInstallDir,
  resolveGlobalFallbackDir,
  sanitizeId,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper, isGlobalFallbackRoot } from '../core/gatekeeper.js';
import { executeSandboxedScriptAsync } from '../core/sandbox.js';
import { verifyMemoryFreshness, verifyMemoryFreshnessAsync } from '../core/memory.js';
import { spawnGitAsync } from '../core/memory/git-utils.js';
import {
  ensureGitInfoExclude,
  findGitRoot,
  syncGlobalUserProfile,
  syncManagedRuleBlocks,
} from '../cli/init.js';
import { McpProxyManager, parseExternalToolId, type ExternalToolRecord } from './proxy.js';

const WORKSPACE_PARAM_SCHEMA = {
  type: 'string',
  description:
    'Optional absolute path to the active project workspace. Routes EvoKernel to the nearest .evo/ directory at or above this path instead of the MCP server process cwd.',
} as const;

export const META_MCP_TOOLS = [
  {
    name: 'evo_search',
    description:
      'Search Rules, Skills, Micro-Tools, Episodic Memories, and Personal Preferences via FTS5 BM25 + live AST Anti-Drift verification. Returns compact L0 summaries (<30 tokens), hit metrics, and freshness badges.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords, error symptoms, packet hex, file paths, or symbol names to search for.',
        },
        kind: {
          type: 'string',
          enum: ['all', 'rule', 'skill', 'tool', 'memory', 'preference'],
          description: 'Filter by capability kind (default: "all").',
        },
        scope: {
          type: 'string',
          enum: ['all', 'project', 'global'],
          description: 'Search scope: project, global, or all (default: "all").',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 8).',
        },
        workspace: WORKSPACE_PARAM_SCHEMA,
      },
      required: ['query', 'workspace'],
    },
  },
  {
    name: 'evo_inspect',
    description:
      'Progressive disclosure loader. Fetch L1 (contract / schema / symbol freshness) or L2 (full SOP / script source / Episodic Memory with AST Anti-Drift report & CodeGraph Topology Penetration anchors) for a specific Rule, Skill, Micro-Tool, Memory, or Preference.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The capability ID returned by evo_search.',
        },
        tier: {
          type: 'string',
          enum: ['L1', 'L2'],
          description: 'Disclosure level: L1 for compact contract/schema, L2 for full SOP/code/memory topology (default: L2).',
        },
        workspace: WORKSPACE_PARAM_SCHEMA,
      },
      required: ['id', 'workspace'],
    },
  },
  {
    name: 'evo_run',
    description:
      'Execute a verified local Micro-Tool script (.mjs, .py, .ps1, .sh) inside a bounded sandbox and return stdout/stderr, saving 90%+ context tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_id: {
          type: 'string',
          description: 'The ID of the evolved Micro-Tool to execute.',
        },
        args: {
          type: 'object',
          description: 'JSON arguments passed to the Micro-Tool via EVO_ARGS and CLI.',
        },
        workspace: WORKSPACE_PARAM_SCHEMA,
      },
      required: ['tool_id', 'workspace'],
    },
  },
  {
    name: 'evo_propose',
    description:
      'Crystallize a newly discovered Rule, Skill (SOP), Micro-Tool script, AST-anchored Episodic Memory, or global Preference into .evo/. Enforces deterministic Gatekeeper checks: Static Security, Sandbox/AST Grounding, BM25 Dedup, and Token Budgets.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['rule', 'skill', 'tool', 'memory', 'preference'],
          description: 'Capability type to evolve.',
        },
        scope: {
          type: 'string',
          enum: ['project', 'global'],
          description: 'Target store: "global" or "project".',
        },
        category: {
          type: 'string',
          enum: ['style', 'formatting', 'communication', 'workflow', 'knowledge'],
          description: '[preference] Category (default: "style").',
        },
        always_on: {
          type: 'boolean',
          description: '[preference] Push to host global profile card (default: true).',
        },
        id: {
          type: 'string',
          description: 'Kebab-case identifier (e.g., "validate-i18n-keys").',
        },
        title: {
          type: 'string',
          description: 'Short, plain-spoken human title stating the scenario or fix.',
        },
        l0_summary: {
          type: 'string',
          description: 'Plain-spoken 1-sentence takeaway (<= 140 chars) for fast scanning.',
        },
        supersedes_id: {
          type: 'string',
          description: 'Optional ID of an older capability upgraded by this proposal.',
        },
        scope_glob: {
          type: 'string',
          description: '[For rule] File glob scope (e.g., "src/api/**/*.ts" or "**/*").',
        },
        core: {
          type: 'boolean',
          description: '[For rule] Belongs in the always-on 1,500-token core invariants digest.',
        },
        content: {
          type: 'string',
          description: '[For rule/preference] Actionable markdown guardrails or personal preference.',
        },
        transfer_scenarios: {
          type: 'array',
          items: { type: 'string' },
          description: '[For rule] At least 2 distinct cross-module/cross-scenario applications.',
        },
        l1_contract: {
          type: 'string',
          description: '[For skill] Trigger conditions, required inputs, and expected outputs.',
        },
        l2_sop: {
          type: 'string',
          description: '[For skill] Step-by-step deterministic execution playbook.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '[For skill / tool / memory / preference] Searchable domain tags.',
        },
        runtime: {
          type: 'string',
          enum: ['node', 'python', 'powershell', 'bash'],
          description: '[For tool] Script execution runtime.',
        },
        script_code: {
          type: 'string',
          description: '[For tool] Script source code. Must exit 0 with --self-test or EVO_SELF_TEST=1.',
        },
        input_schema: {
          type: 'object',
          description: '[For tool] JSON Schema describing accepted arguments.',
        },
        self_test_args: {
          type: 'object',
          description: '[For tool] Sample arguments passed during Gatekeeper sandbox dry-run.',
        },
        symptom: {
          type: 'string',
          description: '[For memory] Observed error message, fault symptom, or log signature.',
        },
        root_cause: {
          type: 'string',
          description: '[For memory] Underlying root cause explaining why the symptom occurred.',
        },
        solution: {
          type: 'string',
          description: '[For memory] Verified fix summary and verification steps.',
        },
        target_symbols: {
          type: 'array',
          items: { type: 'string' },
          description: '[For memory] Code symbols or file#symbol targets for AST structural fingerprinting.',
        },
        trigger_cue: {
          type: 'string',
          description: 'Optional situation trigger cue (<=120 chars) for skills.',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low', 'confounded'],
          description: 'Causal attribution confidence; confounded blocks rule/skill elevation.',
        },
        contrastive_evidence: {
          type: 'string',
          description: 'Before-vs-after execution contrast proving causal isolation.',
        },
        hook_trigger: {
          type: 'object',
          description: 'Optional declarative pre-tool/post-tool guard trigger for micro-tools.',
        },
        workspace: WORKSPACE_PARAM_SCHEMA,
      },
      required: ['kind', 'id', 'title', 'l0_summary', 'workspace'],
    },
  },
  {
    name: 'evo_compact',
    description:
      'Garbage-collect and merge multiple fragmented, stale, or low-hit capabilities into a single high-density entry, archiving the old versions to .evo/archive/ to free up the core token budget.',
    inputSchema: {
      type: 'object',
      properties: {
        target_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of existing capability IDs (minimum 2) to archive and merge.',
        },
        merged_proposal: {
          type: 'object',
          description: 'The consolidated ProposalPayload (same schema as evo_propose) replacing target_ids.',
        },
        reason: {
          type: 'string',
          description: 'Brief explanation for compaction.',
        },
        workspace: WORKSPACE_PARAM_SCHEMA,
      },
      required: ['target_ids', 'merged_proposal', 'reason', 'workspace'],
    },
  },
] as const;

export function isSubpathOf(parent: string, child: string): boolean {
  const resolveWithRealAncestor = (p: string): string => {
    const abs = path.resolve(p);
    try {
      if (fs.existsSync(abs)) return fs.realpathSync(abs);
      let cur = path.dirname(abs);
      const trailing: string[] = [path.basename(abs)];
      while (!fs.existsSync(cur)) {
        const up = path.dirname(cur);
        if (up === cur) break;
        trailing.unshift(path.basename(cur));
        cur = up;
      }
      if (fs.existsSync(cur)) {
        return path.join(fs.realpathSync(cur), ...trailing);
      }
    } catch {
      // fall back to lexical resolution
    }
    return abs;
  };
  const normParent = resolveWithRealAncestor(parent);
  const normChild = resolveWithRealAncestor(child);
  const rel = path.relative(normParent, normChild);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const SESSION_PROPOSED_IDLE_TTL_MS = 45 * 60_000;
const SESSION_PROPOSED_MAX_AGE_MS = 4 * 60 * 60_000;
const EPOCH_ADOPT_GRACE_MS = 60_000;

interface SessionProposalEntry {
  kind: EvoKind;
  epoch?: string;
  createdAtMs: number;
  touchedAtMs: number;
}

interface WorkspaceContext {
  rootDir: string;
  storage: EvoStorage;
  telemetry?: EvoTelemetry;
  gatekeeper?: EvoGatekeeper;
  proxyManager: McpProxyManager;
  lastExternalServersSignature?: string;
  syncPromise?: Promise<void>;
  callsSinceLastPropose: number;
  lastDirtyCheckAt: number;
  lastDirtySig: string;
  watermarkDirtySig: string;
  lastWorktreeStateSig: string;
  activeRefs: number;
  evicted?: boolean;
  writeChain?: Promise<void>;
}

interface RequestContext {
  wsCtx: WorkspaceContext;
  wsKey: string;
  requestWorkspaceDir: string;
  hasLocalEvo: boolean;
  storage: EvoStorage;
  telemetry?: EvoTelemetry;
  gatekeeper?: EvoGatekeeper;
  proxyManager: McpProxyManager;
}

export class EvoMcpDispatcher {
  private readonly defaultRoot: string;
  private readonly contexts = new Map<string, WorkspaceContext>();
  private clientRoots: string[] = [];
  private rootsReadyPromise?: Promise<void>;
  private activeWorkspaceDir: string;
  private storage: EvoStorage;
  private telemetry?: EvoTelemetry;
  private gatekeeper?: EvoGatekeeper;
  private proxyManager: McpProxyManager;
  private readonly onCoreRulesChanged?: () => void;
  private sessionStartTime = Date.now();
  private activeCallCount = 0;
  private readonly sessionProposedIds = new Map<string, Map<string, SessionProposalEntry>>();
  private readonly sessionWorkspaceLastActivity = new Map<string, number>();

  constructor(workspaceRoot: string, onCoreRulesChanged?: () => void) {
    this.defaultRoot = path.resolve(workspaceRoot);
    this.activeWorkspaceDir = this.defaultRoot;
    this.onCoreRulesChanged = onCoreRulesChanged;
    const initialCtx = this.getOrCreateContext(this.defaultRoot, false, false);
    this.storage = initialCtx.storage;
    this.telemetry = initialCtx.telemetry;
    this.gatekeeper = initialCtx.gatekeeper;
    this.proxyManager = initialCtx.proxyManager;
  }

  private computeFastWorktreeStateSig(workspaceRoot: string, gitRoot: string): string {
    try {
      const parts: string[] = [path.resolve(workspaceRoot)];
      let gitDir = path.join(gitRoot, '.git');
      try {
        const gitSt = fs.statSync(gitDir);
        if (gitSt.isFile()) {
          const ptr = fs.readFileSync(gitDir, 'utf8').trim();
          const m = ptr.match(/^gitdir:\s*(.+)$/i);
          if (m && m[1]) {
            gitDir = path.resolve(gitRoot, m[1].trim());
          } else {
            return '';
          }
        }
      } catch {
        return '';
      }

      for (const rel of ['index', 'HEAD']) {
        const p = path.join(gitDir, rel);
        try {
          const st = fs.statSync(p);
          parts.push(`${rel}:${st.mtimeMs}:${st.size}`);
        } catch {
          parts.push(`${rel}:none`);
        }
      }
      let maxMtime = 0;
      let entryCount = 0;
      let hasUnscannedDeepDir = false;
      const maxEntries = 400;
      const scanDir = (dir: string, depth: number) => {
        if (depth > 8 || entryCount > maxEntries) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (entryCount > maxEntries) break;
          if (
            e.name === '.git' ||
            e.name === '.evo' ||
            e.name === '.codegraph' ||
            e.name === 'node_modules' ||
            e.name === 'dist' ||
            e.name === 'build' ||
            e.name === 'target' ||
            e.name === 'vendor'
          ) {
            continue;
          }
          entryCount++;
          const full = path.join(dir, e.name);
          try {
            const st = fs.statSync(full);
            if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
            if (e.isDirectory()) {
              if (depth < 8) {
                scanDir(full, depth + 1);
              } else {
                hasUnscannedDeepDir = true;
              }
            }
          } catch {
            // ignore
          }
        }
      };
      scanDir(workspaceRoot, 0);
      if (entryCount > maxEntries || hasUnscannedDeepDir) {
        return '';
      }
      parts.push(`tree:${entryCount}:${maxMtime}`);
      return parts.join('|');
    } catch {
      return '';
    }
  }

  private checkDirtyTreeReminder(
    workspaceRoot: string,
    activeTelemetry?: EvoTelemetry | null,
    wsCtx?: WorkspaceContext
  ): string {
    const tracker: {
      callsSinceLastPropose: number;
      lastDirtyCheckAt: number;
      lastDirtySig: string;
      watermarkDirtySig: string;
      lastWorktreeStateSig: string;
    } = wsCtx || (this as any);
    const lastHookAt =
      activeTelemetry && !activeTelemetry.isClosed()
        ? parseInt(activeTelemetry.getSessionFlag('last_hook_event_at') || '0', 10)
        : 0;
    const hasActiveHook = Boolean(
      process.env.ANTIGRAVITY_AGENT || (lastHookAt > 0 && lastHookAt >= this.sessionStartTime)
    );
    if (hasActiveHook) return '';

    tracker.callsSinceLastPropose++;
    if (tracker.callsSinceLastPropose < 3) return '';

    const now = Date.now();
    if (now - tracker.lastDirtyCheckAt >= 15000) {
      tracker.lastDirtyCheckAt = now;
      const gitRoot = findGitRoot(workspaceRoot);
      if (!gitRoot) {
        tracker.lastDirtySig = '';
        return '';
      }
      const stateSig = this.computeFastWorktreeStateSig(workspaceRoot, gitRoot);
      if (!stateSig || stateSig !== tracker.lastWorktreeStateSig) {
        tracker.lastWorktreeStateSig = stateSig;
        try {
          const res = child_process.spawnSync('git', ['status', '--porcelain'], {
            cwd: workspaceRoot,
            encoding: 'utf8',
            timeout: 1500,
          });
          if (res.status === 0 && res.stdout) {
            const dirtyLines = res.stdout
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l && !l.includes('.evo/') && !l.includes('.git/'));
            tracker.lastDirtySig = dirtyLines.join('\n');
          } else {
            tracker.lastDirtySig = '';
          }
        } catch {
          tracker.lastDirtySig = '';
        }
      }
    }

    if (tracker.lastDirtySig && tracker.lastDirtySig !== tracker.watermarkDirtySig) {
      tracker.watermarkDirtySig = tracker.lastDirtySig;
      return '\n💡 Uncommitted edits detected — call evo_propose(workspace) once root cause/fix is verified.';
    }
    return '';
  }

  private async checkDirtyTreeReminderAsync(
    workspaceRoot: string,
    activeTelemetry?: EvoTelemetry | null,
    wsCtx?: WorkspaceContext
  ): Promise<string> {
    const tracker: {
      callsSinceLastPropose: number;
      lastDirtyCheckAt: number;
      lastDirtySig: string;
      watermarkDirtySig: string;
      lastWorktreeStateSig: string;
    } = wsCtx || (this as any);
    const lastHookAt =
      activeTelemetry && !activeTelemetry.isClosed()
        ? parseInt(activeTelemetry.getSessionFlag('last_hook_event_at') || '0', 10)
        : 0;
    const hasActiveHook = Boolean(
      process.env.ANTIGRAVITY_AGENT || (lastHookAt > 0 && lastHookAt >= this.sessionStartTime)
    );
    if (hasActiveHook) return '';

    tracker.callsSinceLastPropose++;
    if (tracker.callsSinceLastPropose < 3) return '';

    const now = Date.now();
    if (now - tracker.lastDirtyCheckAt >= 15000) {
      tracker.lastDirtyCheckAt = now;
      const gitRoot = findGitRoot(workspaceRoot);
      if (!gitRoot) {
        tracker.lastDirtySig = '';
        return '';
      }
      const stateSig = this.computeFastWorktreeStateSig(workspaceRoot, gitRoot);
      if (!stateSig || stateSig !== tracker.lastWorktreeStateSig) {
        tracker.lastWorktreeStateSig = stateSig;
        try {
          const res = await spawnGitAsync(workspaceRoot, ['status', '--porcelain'], 1500);
          if (res.status === 0 && res.stdout) {
            const dirtyLines = res.stdout
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l && !l.includes('.evo/') && !l.includes('.git/'));
            tracker.lastDirtySig = dirtyLines.join('\n');
          } else {
            tracker.lastDirtySig = '';
          }
        } catch {
          tracker.lastDirtySig = '';
        }
      }
    }

    if (tracker.lastDirtySig && tracker.lastDirtySig !== tracker.watermarkDirtySig) {
      tracker.watermarkDirtySig = tracker.lastDirtySig;
      return '\n💡 Uncommitted edits detected — call evo_propose(workspace) once root cause/fix is verified.';
    }
    return '';
  }

  private normalizeWorkspaceKey(wsRoot: string): string {
    const resolved = path.resolve(wsRoot).replace(/^[a-z]:/, (m) => m.toUpperCase());
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private isSessionCapabilityActive(
    capId: string,
    capKind: EvoKind,
    localStorage?: EvoStorage,
    fallbackGlobalCtxs?: WorkspaceContext[]
  ): boolean {
    const readFrom = (s: EvoStorage) => {
      switch (capKind) {
        case 'rule':
          return s.getRule(capId);
        case 'skill':
          return s.getSkill(capId);
        case 'tool':
          return s.getTool(capId);
        case 'memory':
          return s.getMemory(capId);
        case 'preference':
          return s.getPreference(capId);
      }
    };
    if (localStorage) {
      const localItem = readFrom(localStorage);
      if (localItem) {
        return localItem.enabled !== false;
      }
    }
    if (capKind !== 'memory') {
      const globals =
        fallbackGlobalCtxs ?? this.getGlobalFallbackContexts(localStorage?.evoDir, true);
      for (const gCtx of globals) {
        const gItem = readFrom(gCtx.storage);
        if (gItem) {
          return gItem.enabled !== false;
        }
      }
    }
    return localStorage === undefined;
  }

  private recordSessionProposal(
    workspaceRoot: string,
    id: string,
    kind: EvoKind,
    supersedesIds?: string[],
    enabled = true,
    activeEpoch?: string
  ): void {
    const wsKey = this.normalizeWorkspaceKey(workspaceRoot);
    const cleanId = sanitizeId(id);
    const now = Date.now();
    this.sessionWorkspaceLastActivity.set(wsKey, now);
    let wsMap = this.sessionProposedIds.get(wsKey);
    if (!wsMap) {
      wsMap = new Map<string, SessionProposalEntry>();
      this.sessionProposedIds.set(wsKey, wsMap);
    }
    if (supersedesIds) {
      for (const oldId of supersedesIds) {
        const cleanOld = sanitizeId(oldId);
        if (cleanOld && cleanOld !== cleanId) {
          wsMap.delete(cleanOld);
        }
      }
    }
    if (enabled === false) {
      if (cleanId) {
        wsMap.delete(cleanId);
      }
    } else if (cleanId) {
      wsMap.set(cleanId, {
        kind,
        epoch: activeEpoch || undefined,
        createdAtMs: now,
        touchedAtMs: now,
      });
    }
    if (wsMap.size === 0) {
      this.sessionProposedIds.delete(wsKey);
    }
  }

  private getSessionAntiPoisonReminder(
    workspaceDir: string,
    storage?: EvoStorage,
    telemetry?: EvoTelemetry,
    filterKind: EvoKind | 'all' = 'all',
    hasLocalEvo = true
  ): string {
    const wsKey = this.normalizeWorkspaceKey(workspaceDir);
    const now = Date.now();
    const currentEpoch =
      telemetry && !telemetry.isClosed()
        ? telemetry.getSessionFlag('active_session_epoch') || undefined
        : undefined;

    if (!currentEpoch) {
      const lastActivity = this.sessionWorkspaceLastActivity.get(wsKey);
      if (lastActivity !== undefined && now - lastActivity > SESSION_PROPOSED_IDLE_TTL_MS) {
        this.sessionProposedIds.delete(wsKey);
        this.sessionWorkspaceLastActivity.set(wsKey, now);
        return '';
      }
    }
    this.sessionWorkspaceLastActivity.set(wsKey, now);

    const wsMap = this.sessionProposedIds.get(wsKey);
    if (!wsMap || wsMap.size === 0) return '';
    const resolvedStorage = storage ?? this.contexts.get(wsKey)?.storage;
    const fallbackGlobals = this.getGlobalFallbackContexts(resolvedStorage?.evoDir, hasLocalEvo);
    const ids: string[] = [];
    for (const [id, entry] of Array.from(wsMap.entries())) {
      if (
        now - entry.createdAtMs > SESSION_PROPOSED_MAX_AGE_MS ||
        !this.isSessionCapabilityActive(id, entry.kind, resolvedStorage, fallbackGlobals)
      ) {
        wsMap.delete(id);
        continue;
      }

      if (currentEpoch) {
        if (entry.epoch === currentEpoch) {
          // matches current epoch
        } else if (!entry.epoch && now - entry.createdAtMs <= EPOCH_ADOPT_GRACE_MS) {
          entry.epoch = currentEpoch;
        } else {
          if (now - entry.touchedAtMs > 2 * 60 * 60_000) {
            wsMap.delete(id);
          }
          continue;
        }
      }

      if (filterKind === 'all' || entry.kind === filterKind) {
        entry.touchedAtMs = now;
        ids.push(id);
      }
    }
    if (wsMap.size === 0) {
      this.sessionProposedIds.delete(wsKey);
    }
    if (ids.length === 0) return '';
    const recentIds = ids.slice(-5);
    return `\n🔄 Anti-Poisoning Guard: Earlier in this session you crystallized [${recentIds.join(', ')}]. If new findings or user feedback refine or overturn that diagnosis, call evo_propose(id, supersedes_id: id, workspace) to update it.`;
  }

  public setClientRoots(roots: string[], readyPromise?: Promise<void>): void {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const r of roots) {
      if (!r || !r.trim()) continue;
      const resolved = path.resolve(r).replace(/^[a-z]:/, (m) => m.toUpperCase());
      const key = this.normalizeWorkspaceKey(resolved);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(resolved);
      }
    }
    this.clientRoots = deduped;
    if (readyPromise) {
      this.rootsReadyPromise = readyPromise;
    }
  }

  public getClientRoots(): string[] {
    return [...this.clientRoots];
  }

  public getProxyManager(): McpProxyManager {
    return this.proxyManager;
  }

  private getOrCreateContext(
    targetRoot: string,
    ensureInit = false,
    openTelemetry = true
  ): WorkspaceContext {
    const resolved = path.resolve(targetRoot).replace(/^[a-z]:/, (m) => m.toUpperCase());
    const wsKey = this.normalizeWorkspaceKey(targetRoot);
    let ctx = this.contexts.get(wsKey);
    if (!ctx) {
      const storage = new EvoStorage(resolved);
      const proxyManager = new McpProxyManager(resolved);
      const config = storage.getConfig();
      ctx = {
        rootDir: resolved,
        storage,
        proxyManager,
        lastExternalServersSignature: !config.externalServers ? JSON.stringify({}) : undefined,
        callsSinceLastPropose: 0,
        lastDirtyCheckAt: 0,
        lastDirtySig: '',
        watermarkDirtySig: '',
        lastWorktreeStateSig: '',
        activeRefs: 0,
      };
      this.contexts.set(wsKey, ctx);
    }
    if (
      openTelemetry &&
      (!ctx.telemetry || ctx.telemetry.isClosed()) &&
      (ensureInit || hasValidEvoStructure(ctx.storage.evoDir))
    ) {
      const telemetry = new EvoTelemetry(ctx.storage);
      const gatekeeper = new EvoGatekeeper(ctx.storage, telemetry);
      ctx.telemetry = telemetry;
      ctx.gatekeeper = gatekeeper;
    }
    return ctx;
  }

  private releaseContextRef(wsCtx: WorkspaceContext): void {
    wsCtx.activeRefs = Math.max(0, wsCtx.activeRefs - 1);
    if (wsCtx.activeRefs === 0 && wsCtx.evicted && !wsCtx.syncPromise) {
      try {
        wsCtx.telemetry?.close();
      } catch {
        // ignore
      }
      wsCtx.telemetry = undefined;
      wsCtx.gatekeeper = undefined;
      try {
        wsCtx.proxyManager.close();
      } catch {
        // ignore
      }
    }
  }

  private ensureActiveTelemetry(
    reqCtx: RequestContext,
    current?: EvoTelemetry
  ): EvoTelemetry | undefined {
    if (current && !current.isClosed()) return current;
    if (reqCtx.wsCtx.telemetry && !reqCtx.wsCtx.telemetry.isClosed()) {
      return reqCtx.wsCtx.telemetry;
    }
    const refreshed = this.getOrCreateContext(reqCtx.storage.rootDir);
    reqCtx.wsCtx.telemetry = refreshed.telemetry;
    reqCtx.wsCtx.gatekeeper = refreshed.gatekeeper;
    return refreshed.telemetry;
  }

  private withWorkspaceWriteLock<T>(wsCtx: WorkspaceContext, fn: () => T): T | Promise<T> {
    if (!wsCtx.writeChain) {
      const res = fn();
      if (res && typeof (res as any).then === 'function') {
        const tail = Promise.resolve(res).then(
          () => undefined,
          () => undefined
        );
        wsCtx.writeChain = tail;
        tail.finally(() => {
          if (wsCtx.writeChain === tail) {
            wsCtx.writeChain = undefined;
          }
        });
      }
      return res;
    }
    const next = wsCtx.writeChain.then(() => fn());
    const tail = next.then(
      () => undefined,
      () => undefined
    );
    wsCtx.writeChain = tail;
    tail.finally(() => {
      if (wsCtx.writeChain === tail) {
        wsCtx.writeChain = undefined;
      }
    });
    return next;
  }

  private evictWorkspaceContext(candidatePath: string): void {
    const resolvedCand = this.normalizeWorkspaceKey(candidatePath);
    this.sessionProposedIds.delete(resolvedCand);
    this.sessionWorkspaceLastActivity.delete(resolvedCand);
    for (const [rootKey, ctx] of this.contexts.entries()) {
      const normRoot = this.normalizeWorkspaceKey(rootKey);
      const isMatchOrParent =
        normRoot === resolvedCand ||
        resolvedCand.startsWith(normRoot + path.sep) ||
        normRoot.startsWith(resolvedCand + path.sep);
      const rootMissingOrZombie =
        !fs.existsSync(ctx.rootDir) || isHollowEvoZombieDir(ctx.rootDir);
      if (isMatchOrParent || rootMissingOrZombie) {
        const isBusy = ctx.activeRefs > 0 || Boolean(ctx.syncPromise);
        if (!isBusy) {
          try {
            ctx.telemetry?.close();
          } catch {
            // ignore
          }
          ctx.telemetry = undefined;
          ctx.gatekeeper = undefined;
        }
        if (normRoot === resolvedCand || rootMissingOrZombie) {
          this.contexts.delete(rootKey);
          this.sessionProposedIds.delete(normRoot);
          this.sessionWorkspaceLastActivity.delete(normRoot);
          if (isBusy) {
            ctx.evicted = true;
          } else {
            try {
              ctx.proxyManager.close();
            } catch {
              // ignore
            }
          }
        }
      }
    }
  }

  private releaseInactiveTelemetryHandles(keepRoot?: string): void {
    const normKeep = keepRoot ? this.normalizeWorkspaceKey(keepRoot) : null;
    for (const [rootKey, ctx] of this.contexts.entries()) {
      if (normKeep && this.normalizeWorkspaceKey(rootKey) === normKeep) continue;
      if (ctx.activeRefs > 0 || Boolean(ctx.syncPromise)) continue;
      try {
        ctx.telemetry?.close();
      } catch {
        // ignore
      }
      ctx.telemetry = undefined;
      ctx.gatekeeper = undefined;
    }
    if (!normKeep && this.activeCallCount === 0) {
      this.telemetry = undefined;
      this.gatekeeper = undefined;
    }
  }

  private needsExternalToolsSync(ctx: WorkspaceContext): boolean {
    const config = ctx.storage.getConfig();
    const servers = config.externalServers;
    const sig = JSON.stringify(servers || {});
    if (!servers || typeof servers !== 'object') {
      return ctx.storage.listExternalTools().length > 0 && ctx.lastExternalServersSignature !== sig;
    }
    const activeEntries = Object.entries(servers).filter(([, cfg]) => cfg && !cfg.disabled);
    if (activeEntries.length === 0) {
      return ctx.storage.listExternalTools().length > 0 && ctx.lastExternalServersSignature !== sig;
    }
    return ctx.lastExternalServersSignature !== sig;
  }

  private async syncContextExternalTools(c: WorkspaceContext): Promise<void> {
    if (!this.needsExternalToolsSync(c)) return;
    if (c.syncPromise) {
      await c.syncPromise;
      return;
    }
    const servers = c.storage.getConfig().externalServers || {};
    const sig = JSON.stringify(servers);
    c.syncPromise = (async () => {
      try {
        const { tools: discovered, failedServers } =
          await c.proxyManager.discoverAllDownstreamToolsWithStatus(servers);
        let finalTools = discovered;
        if (failedServers.length > 0) {
          const cachedTools = c.storage.listExternalTools();
          const preservedTools = cachedTools.filter(
            (t) =>
              failedServers.includes(t.serverName) &&
              Boolean(servers[t.serverName] && !servers[t.serverName].disabled)
          );
          finalTools = [...discovered, ...preservedTools];
        }
        if (failedServers.length === 0) {
          c.lastExternalServersSignature = sig;
        }
        if (hasValidEvoStructure(c.storage.evoDir)) {
          c.storage.saveExternalTools(finalTools);
          if (!c.telemetry || c.telemetry.isClosed()) {
            const refreshed = this.getOrCreateContext(c.storage.rootDir);
            c.telemetry = refreshed.telemetry;
            c.gatekeeper = refreshed.gatekeeper;
          }
          c.telemetry?.syncFromDisk();
        }
      } catch {
        // Ignore discovery failure and proceed with cached tools; leave signature unset for retry
      } finally {
        c.syncPromise = undefined;
        if (c.evicted && c.activeRefs === 0) {
          try {
            c.telemetry?.close();
          } catch {
            // ignore
          }
          c.telemetry = undefined;
          c.gatekeeper = undefined;
          try {
            c.proxyManager.close();
          } catch {
            // ignore
          }
        }
      }
    })();
    await c.syncPromise;
  }

  private async ensureExternalToolsSynced(reqCtxOrWs: RequestContext | WorkspaceContext): Promise<void> {
    const checks =
      'wsCtx' in reqCtxOrWs
        ? [reqCtxOrWs.wsCtx, ...this.getGlobalFallbackContexts(reqCtxOrWs)]
        : [
            reqCtxOrWs,
            ...this.getGlobalFallbackContexts(reqCtxOrWs.storage.evoDir, true),
          ];
    for (const c of checks) {
      await this.syncContextExternalTools(c);
    }
  }

  private getGlobalFallbackContexts(
    activeEvoDirOrReq?: string | RequestContext,
    hasLocalEvo = true
  ): WorkspaceContext[] {
    const fallbacks: WorkspaceContext[] = [];
    const activeEvoDir =
      typeof activeEvoDirOrReq === 'string'
        ? path.resolve(activeEvoDirOrReq)
        : activeEvoDirOrReq
          ? path.resolve(activeEvoDirOrReq.storage.evoDir)
          : path.resolve(this.storage.evoDir);
    const includeActiveEvoDir =
      typeof activeEvoDirOrReq === 'object' && activeEvoDirOrReq !== null
        ? !activeEvoDirOrReq.hasLocalEvo
        : !hasLocalEvo;
    const candidates: string[] = [];

    const defaultNorm = this.defaultRoot.replace(/\\/g, '/').toLowerCase();
    if (
      defaultNorm.endsWith('/.evo/global') ||
      (process.env.EVO_GLOBAL_DIR &&
        path.resolve(process.env.EVO_GLOBAL_DIR).toLowerCase() === this.defaultRoot.toLowerCase())
    ) {
      candidates.push(this.defaultRoot);
    }

    const envGlobal = process.env.EVO_GLOBAL_DIR
      ? path.resolve(process.env.EVO_GLOBAL_DIR)
      : !process.env.NODE_TEST_CONTEXT
        ? path.join(os.homedir(), '.evo', 'global')
        : null;
    if (envGlobal) {
      candidates.push(envGlobal);
    }

    const seenEvoDirs = new Set<string>(includeActiveEvoDir ? [] : [activeEvoDir]);
    for (const cand of candidates) {
      if (!hasValidEvoStructure(path.join(cand, '.evo'))) continue;
      const ctx = this.getOrCreateContext(cand);
      const candEvoDir = path.resolve(ctx.storage.evoDir);
      if (seenEvoDirs.has(candEvoDir)) continue;
      seenEvoDirs.add(candEvoDir);
      fallbacks.push(ctx);
    }

    return fallbacks;
  }

  private isGlobalWriteRoute(toolName: string, args: Record<string, unknown>): boolean {
    if (toolName !== 'evo_propose' && toolName !== 'evo_compact') return false;
    const topScope = typeof args.scope === 'string' ? args.scope.trim().toLowerCase() : '';
    if (topScope === 'global') return true;
    if (toolName === 'evo_propose') {
      const kind = typeof args.kind === 'string' ? args.kind.trim().toLowerCase() : '';
      return kind === 'preference' && topScope !== 'project';
    }
    const merged = args.merged_proposal as Record<string, unknown> | undefined;
    if (merged && typeof merged === 'object') {
      const mergedScope = typeof merged.scope === 'string' ? merged.scope.trim().toLowerCase() : '';
      if (mergedScope === 'global' && topScope !== 'project') return true;
      const mergedKind = typeof merged.kind === 'string' ? merged.kind.trim().toLowerCase() : '';
      if (mergedKind === 'preference' && mergedScope !== 'project' && topScope !== 'project') {
        return true;
      }
    }
    return false;
  }

  private bindActiveContext(toolName: string, args: Record<string, unknown>): RequestContext {
    const rawWs = args.workspace ?? args.workspace_path;
    let targetRoot = this.defaultRoot;
    let candidate = this.defaultRoot;
    let hasLocalEvo = true;

    if (this.isGlobalWriteRoute(toolName, args)) {
      if (typeof rawWs === 'string' && rawWs.trim()) {
        const trimmed = rawWs.trim();
        candidate = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(this.defaultRoot, trimmed);
      }
      targetRoot = resolveGlobalFallbackDir();
      hasLocalEvo = true;
      this.activeWorkspaceDir = candidate;
      if (this.activeCallCount <= 1) {
        this.releaseInactiveTelemetryHandles(targetRoot);
      }
      const wsCtx = this.getOrCreateContext(targetRoot, true);
      wsCtx.activeRefs++;
      this.storage = wsCtx.storage;
      this.telemetry = wsCtx.telemetry;
      this.gatekeeper = wsCtx.gatekeeper;
      this.proxyManager = wsCtx.proxyManager;
      return {
        wsCtx,
        wsKey: this.normalizeWorkspaceKey(targetRoot),
        requestWorkspaceDir: candidate,
        hasLocalEvo,
        storage: wsCtx.storage,
        telemetry: wsCtx.telemetry,
        gatekeeper: wsCtx.gatekeeper,
        proxyManager: wsCtx.proxyManager,
      };
    }

    if (typeof rawWs === 'string' && rawWs.trim()) {
      const trimmed = rawWs.trim();
      const isRel = !path.isAbsolute(trimmed);

      if (isRel) {
        if (this.clientRoots.length === 1) {
          candidate = path.resolve(this.clientRoots[0], trimmed);
        } else if (this.clientRoots.length > 1) {
          if (toolName === 'evo_propose' || toolName === 'evo_compact') {
            throw new Error(
              'ERR_INVALID_SCHEMA: Write operations (evo_propose/evo_compact) cannot target ambiguous multi-root workspace.'
            );
          }
          const rootWithEvo = this.clientRoots.find((r) => hasValidEvoStructure(path.join(r, '.evo')));
          candidate = path.resolve(rootWithEvo || this.clientRoots[0], trimmed);
        } else {
          candidate = path.resolve(this.defaultRoot, trimmed);
        }
      } else {
        candidate = path.resolve(trimmed);
      }

      const isHomeOrFsRoot =
        candidate.toLowerCase() === path.resolve(os.homedir()).toLowerCase() ||
        path.resolve(candidate).toLowerCase() === path.parse(candidate).root.toLowerCase();
      if (isHomeOrFsRoot && (toolName === 'evo_propose' || toolName === 'evo_compact')) {
        throw new Error(
          'ERR_INVALID_SCHEMA: Write operations (evo_propose/evo_compact) cannot target home directory or filesystem root.'
        );
      }

      const norm = candidate.replace(/\\/g, '/').toLowerCase();
      const isGlobalFallbackTarget =
        norm.endsWith('/.evo/global') ||
        Boolean(
          process.env.EVO_GLOBAL_DIR &&
            path.resolve(process.env.EVO_GLOBAL_DIR).toLowerCase() === candidate.toLowerCase()
        );
      if (!isGlobalFallbackTarget && !isPluginOrExtensionInstallDir(candidate)) {
        let existsAsDir = false;
        try {
          existsAsDir = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
        } catch {
          existsAsDir = false;
        }
        if (!existsAsDir || isHollowEvoZombieDir(candidate)) {
          this.evictWorkspaceContext(candidate);
          const notFoundErr = new Error(
            `ERR_WORKSPACE_NOT_FOUND: Workspace directory "${candidate}" does not exist on disk or is an orphaned .evo/.cache shell after a folder move/rename. Please verify the current moved/renamed workspace directory and pass the valid path.`
          );
          (notFoundErr as any).candidate = candidate;
          throw notFoundErr;
        }
      }

      if (isPluginOrExtensionInstallDir(candidate)) {
        // Explicit global fallback dir, host global config dir (~/.gemini), or plugin install dir binds to ~/.evo/global
        if (
          norm.endsWith('/.evo/global') ||
          (process.env.EVO_GLOBAL_DIR &&
            path.resolve(process.env.EVO_GLOBAL_DIR).toLowerCase() === candidate.toLowerCase())
        ) {
          targetRoot = candidate;
        } else if (isHostGlobalConfigDir(candidate)) {
          targetRoot = process.env.EVO_GLOBAL_DIR
            ? path.resolve(process.env.EVO_GLOBAL_DIR)
            : path.join(os.homedir(), '.evo', 'global');
        } else {
          targetRoot = process.env.EVO_GLOBAL_DIR
            ? path.resolve(process.env.EVO_GLOBAL_DIR)
            : path.join(os.homedir(), '.evo', 'global');
        }
      } else {
        const nearestEvo = findNearestEvoWorkspace(candidate);
        if (nearestEvo) {
          targetRoot = nearestEvo;
        } else if (toolName === 'evo_propose' || toolName === 'evo_compact') {
          // Module 1.2: Never fall back to ~/.evo/global on write operations!
          // If candidate is within this.defaultRoot and defaultRoot still exists on disk, bind to this.defaultRoot;
          // otherwise resolve nearest Git root (or candidate) and auto-initialize local Stealth .evo/
          const defaultExists =
            fs.existsSync(this.defaultRoot) && !isHollowEvoZombieDir(this.defaultRoot);
          const localRoot =
            defaultExists && isSubpathOf(this.defaultRoot, candidate)
              ? this.defaultRoot
              : findGitRoot(candidate) || candidate;
          fs.mkdirSync(localRoot, { recursive: true });
          const localStorage = new EvoStorage(localRoot);
          localStorage.ensureInitialized();
          ensureGitInfoExclude(localRoot, ['.evo/']);
          targetRoot = localRoot;
        } else {
          // Read/exec operations (evo_search, evo_inspect, evo_run): do not create .evo/ in uninitialized folders,
          // and do not hijack explicit uninitialized workspace to clientRoots or defaultRoot.
          targetRoot = candidate;
          hasLocalEvo = isGlobalFallbackTarget
            ? hasValidEvoStructure(path.join(candidate, '.evo'))
            : false;
        }
      }
    }

    this.activeWorkspaceDir = candidate;
    if (this.activeCallCount <= 1) {
      this.releaseInactiveTelemetryHandles(targetRoot);
    }
    const isWriteTool = toolName === 'evo_propose' || toolName === 'evo_compact';
    const wsCtx = this.getOrCreateContext(targetRoot, isWriteTool);
    wsCtx.activeRefs++;
    this.storage = wsCtx.storage;
    this.telemetry = wsCtx.telemetry;
    this.gatekeeper = wsCtx.gatekeeper;
    this.proxyManager = wsCtx.proxyManager;
    return {
      wsCtx,
      wsKey: this.normalizeWorkspaceKey(targetRoot),
      requestWorkspaceDir: candidate,
      hasLocalEvo,
      storage: wsCtx.storage,
      telemetry: wsCtx.telemetry,
      gatekeeper: wsCtx.gatekeeper,
      proxyManager: wsCtx.proxyManager,
    };
  }

  public handleToolCall(
    name: string,
    args: Record<string, unknown> = {}
  ): any {
    return this.dispatchToolCall(name, args, false);
  }

  public async handleToolCallAsync(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<any> {
    return await this.dispatchToolCall(name, args, true);
  }

  private dispatchToolCall(
    name: string,
    args: Record<string, unknown>,
    asyncMode: boolean
  ): any {
    const rawWs = args.workspace ?? args.workspace_path;
    if (
      (name === 'evo_propose' || name === 'evo_compact') &&
      (typeof rawWs !== 'string' || !rawWs.trim())
    ) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                passed: false,
                gate_failed: 'SCHEMA_SECURITY',
                error_code: 'ERR_INVALID_SCHEMA',
                message:
                  'Non-empty workspace path is required for evo_propose and evo_compact.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === 'evo_compact') {
      const schemaError = this.compactSchemaError(args);
      if (schemaError) return schemaError;
    }

    this.activeCallCount++;
    let isAsyncResult = false;
    let boundCtx: RequestContext | undefined;
    try {
      const reqCtx = this.bindActiveContext(name, args);
      boundCtx = reqCtx;
      const needsSync =
        (name === 'evo_search' || name === 'evo_inspect') &&
        (this.needsExternalToolsSync(reqCtx.wsCtx) ||
          this.getGlobalFallbackContexts(reqCtx).some((g) => this.needsExternalToolsSync(g)));

      let result: any;
      switch (name) {
        case 'evo_search':
          if (needsSync) {
            result = this.ensureExternalToolsSynced(reqCtx).then(() => {
              const freshCtx = this.bindActiveContext(name, args);
              if (boundCtx) {
                this.releaseContextRef(boundCtx.wsCtx);
              }
              boundCtx = freshCtx;
              return asyncMode
                ? this.handleSearchAsync(args, freshCtx)
                : this.handleSearch(args, freshCtx);
            });
          } else {
            result = asyncMode
              ? this.handleSearchAsync(args, reqCtx)
              : this.handleSearch(args, reqCtx);
          }
          break;
        case 'evo_inspect':
          if (needsSync) {
            result = this.ensureExternalToolsSynced(reqCtx).then(() => {
              const freshCtx = this.bindActiveContext(name, args);
              if (boundCtx) {
                this.releaseContextRef(boundCtx.wsCtx);
              }
              boundCtx = freshCtx;
              return asyncMode
                ? this.handleInspectAsync(args, freshCtx)
                : this.handleInspect(args, freshCtx);
            });
          } else {
            result = asyncMode
              ? this.handleInspectAsync(args, reqCtx)
              : this.handleInspect(args, reqCtx);
          }
          break;
        case 'evo_run':
          result = this.handleRun(args, reqCtx);
          break;
        case 'evo_propose':
          result = this.withWorkspaceWriteLock(reqCtx.wsCtx, () =>
            asyncMode
              ? this.handleProposeAsync(args as unknown as ProposalPayload, reqCtx)
              : this.handlePropose(args as unknown as ProposalPayload, reqCtx)
          );
          break;
        case 'evo_compact':
          result = this.withWorkspaceWriteLock(reqCtx.wsCtx, () =>
            asyncMode
              ? this.handleCompactAsync(args, reqCtx)
              : this.handleCompact(args, reqCtx)
          );
          break;
        default:
          result = {
            isError: true,
            content: [{ type: 'text', text: `Unknown Meta-MCP tool: ${name}` }],
          };
          break;
      }

      if (result && typeof result.then === 'function') {
        isAsyncResult = true;
        return result.finally(() => {
          if (boundCtx) {
            this.releaseContextRef(boundCtx.wsCtx);
          }
          this.activeCallCount = Math.max(0, this.activeCallCount - 1);
          if (this.activeCallCount === 0) {
            this.releaseInactiveTelemetryHandles();
          }
        });
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ERR_INVALID_SCHEMA')) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  passed: false,
                  gate_failed: 'SCHEMA_SECURITY',
                  error_code: 'ERR_INVALID_SCHEMA',
                  message: msg.replace(/^Error:\s*/, '').replace(/^ERR_INVALID_SCHEMA:\s*/, ''),
                },
                null,
                2
              ),
            },
          ],
        };
      }
      if (msg.includes('ERR_WORKSPACE_NOT_FOUND')) {
        const cand =
          (err as any).candidate ||
          (msg.match(/"([^"]+)"/) ? msg.match(/"([^"]+)"/)![1] : '');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  passed: false,
                  gate_failed: 'WORKSPACE_VALIDATION',
                  error_code: 'ERR_WORKSPACE_NOT_FOUND',
                  message: `Workspace directory "${cand}" does not exist on disk or is an orphaned .evo/.cache shell after a folder move/rename. Please verify the current moved/renamed workspace directory and pass the valid path.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      return {
        isError: true,
        content: [{ type: 'text', text: `EvoKernel internal error in ${name}: ${msg}` }],
      };
    } finally {
      if (!isAsyncResult) {
        if (boundCtx) {
          this.releaseContextRef(boundCtx.wsCtx);
        }
        this.activeCallCount = Math.max(0, this.activeCallCount - 1);
        if (this.activeCallCount === 0) {
          this.releaseInactiveTelemetryHandles();
        }
      }
    }
  }

  private prepareSearchContext(args: Record<string, unknown>, reqCtx: RequestContext) {
    const query = String(args.query || '');
    const kind = (args.kind ? String(args.kind) : 'all') as EvoKind | 'all';
    const rawScope = typeof args.scope === 'string' ? args.scope.trim().toLowerCase() : 'all';
    const scope = (['all', 'project', 'global'].includes(rawScope) ? rawScope : 'all') as
      | 'all'
      | 'project'
      | 'global';
    const limit = Number(args.limit || 8);
    const reqWorkspaceDir = reqCtx.requestWorkspaceDir;
    const targetCtx = reqCtx.wsCtx;
    const hasLocalEvo = reqCtx.hasLocalEvo;
    const isTargetGlobalRoot = hasLocalEvo && isGlobalFallbackRoot(reqCtx.storage.rootDir);
    const searchScopeDir = reqWorkspaceDir || reqCtx.storage.rootDir;
    const localTelemetry =
      hasLocalEvo && reqCtx.telemetry && !reqCtx.telemetry.isClosed()
        ? reqCtx.telemetry
        : hasLocalEvo && hasValidEvoStructure(reqCtx.storage.evoDir)
          ? this.ensureActiveTelemetry(reqCtx, reqCtx.telemetry)
          : undefined;
    return {
      query,
      kind,
      scope,
      limit,
      targetCtx,
      hasLocalEvo,
      isTargetGlobalRoot,
      searchScopeDir,
      localTelemetry,
    };
  }

  private finalizeSearchResponse(
    query: string,
    kind: EvoKind | 'all',
    limit: number,
    reqCtx: RequestContext,
    targetCtx: WorkspaceContext,
    hasLocalEvo: boolean,
    localTelemetry: EvoTelemetry | undefined,
    mergedHits: SearchHit[]
  ) {
    const highRelevanceHits = mergedHits.filter((h) => !h.low_overlap);
    const effectiveMergedHits =
      highRelevanceHits.length >= 2
        ? highRelevanceHits
        : highRelevanceHits.length === 1
          ? mergedHits.filter((h) => !h.low_overlap || (h.matched_concepts ?? 0) > 0)
          : mergedHits;

    const statusTier = (s?: 'VERIFIED' | 'OTHER_BRANCH' | 'STALE') =>
      s === 'STALE' ? 2 : s === 'OTHER_BRANCH' ? 1 : 0;

    const hits = effectiveMergedHits
      .sort((a, b) => {
        const tierDiff = statusTier(a.memory_status) - statusTier(b.memory_status);
        if (tierDiff !== 0) return tierDiff;
        return b.score - a.score || b.hit_count - a.hit_count;
      })
      .slice(0, limit);

    const totalTokens = hasLocalEvo ? reqCtx.storage.getCoreRulesTokenUsage().totalTokens : 0;
    const maxTokens = reqCtx.storage.getConfig().maxCoreRuleTokens;
    const wsTools =
      hasLocalEvo && (kind === 'all' || kind === 'tool')
        ? reqCtx.storage.listTools().filter((t) => t.enabled !== false)
        : [];
    const hasToolHit = hits.some((h) => h.kind === 'tool');
    const toolFooter =
      wsTools.length > 0 && !hasToolHit
        ? `\n💡 Available workspace tools (call via evo_run): ${wsTools.map((t) => t.id).join(', ')}`
        : '';

    if (hits.length === 0) {
      if (hasLocalEvo && localTelemetry) {
        localTelemetry.recordRecallEvent({
          eventType: 'search',
          capabilityId: '__zero_hit__',
          kind: kind === 'all' ? 'rule' : kind,
          tier: 'LOCAL',
        });
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `No evolved capabilities matched query "${query}". Core Rule Budget: ${totalTokens}/${maxTokens} tokens.${toolFooter}`,
          },
        ],
      };
    }

    if (hasLocalEvo && localTelemetry) {
      const topNonStale = hits.find((h) => h.memory_status !== 'STALE') || hits[0];
      localTelemetry.recordRecallEvent({
        eventType: 'search',
        capabilityId: topNonStale ? topNonStale.id : '__zero_hit__',
        kind: topNonStale ? topNonStale.kind : (kind === 'all' ? 'rule' : kind),
        tier: topNonStale?.tier || 'LOCAL',
      });
    }

    const teleMap = localTelemetry ? localTelemetry.getTelemetryMap() : new Map();

    const getHitStat = (h: SearchHit) => {
      if (h.tier === 'GLOBAL') {
        for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
          const gStat = gCtx.telemetry?.getTelemetryMap().get(h.id);
          if (gStat) return gStat;
        }
      }
      return teleMap.get(h.id);
    };

    const lines = hits.map((h) => {
      const stat = getHitStat(h);
      const helpedCount = stat ? (stat.helped_count || 0) : 0;
      const tokensSaved = stat ? (stat.tokens_saved || 0) : 0;
      const helpedMetric = helpedCount > 0 || tokensSaved > 0 ? ` | helped: ${helpedCount}` : '';

      if (h.kind === 'memory' && h.memory_badge) {
        const icon =
          h.memory_status === 'VERIFIED'
            ? '✅'
            : h.memory_status === 'OTHER_BRANCH'
              ? '🌿'
              : '⚠️';
        return `• [MEMORY] ${icon} ${h.memory_badge} ${h.id} — ${h.l0_summary} (anchors: ${h.scope_glob} | hits: ${h.hit_count}${helpedMetric})`;
      }
      const tierBadge = h.tier === 'GLOBAL' ? ' [GLOBAL]' : '';
      return `• [${h.kind.toUpperCase()}]${tierBadge} ${h.id} — ${h.l0_summary} (scope: ${h.scope_glob} | hits: ${h.hit_count} | pass: ${h.success_rate}${helpedMetric})`;
    });

    const topGuardrailIds = hits
      .filter(
        (h) =>
          !h.low_overlap &&
          (h.kind === 'rule' ||
            h.kind === 'skill' ||
            h.kind === 'preference' ||
            (h.kind === 'memory' &&
              (h.memory_status === 'VERIFIED' || h.memory_status === 'OTHER_BRANCH')))
      )
      .slice(0, 3)
      .map((h) => h.id);
    const antiPoisonReminder = this.getSessionAntiPoisonReminder(
      targetCtx.storage.rootDir,
      targetCtx.storage,
      localTelemetry,
      kind,
      hasLocalEvo
    );
    const footerDirective =
      topGuardrailIds.length > 0
        ? `Action Required: Call evo_inspect(id, "L2", workspace) on matched guardrails/SOPs [${topGuardrailIds.join(', ')}] to load full checklists (never rely on L0 summaries alone), or evo_run(tool_id, args) to execute a TOOL; if this session confirms a root cause (even read-only) or corrects a hypothesis, call evo_propose before finishing.${toolFooter}${antiPoisonReminder}`
        : `Tip: Call evo_inspect(id, "L1"|"L2", workspace) for details/topology anchors or evo_run(tool_id, args) to execute a TOOL; if this session confirms a root cause (even read-only) or corrects a hypothesis, call evo_propose before finishing.${toolFooter}${antiPoisonReminder}`;

    const provenanceLine =
      '🛡️ Recall Provenance: Local observable chain active (search -> inspect/run -> verified outcome tracked in .evo/.cache/telemetry.db; 0 outbound telemetry).';

    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Found ${hits.length} capability(s) [Core Budget: ${totalTokens}/${maxTokens} tokens]:`,
            ...lines,
            '',
            footerDirective,
            provenanceLine,
          ].join('\n'),
        },
      ],
    };
  }

  private handleSearch(args: Record<string, unknown>, reqCtx: RequestContext) {
    const {
      query,
      kind,
      scope,
      limit,
      targetCtx,
      hasLocalEvo,
      isTargetGlobalRoot,
      searchScopeDir,
      localTelemetry,
    } = this.prepareSearchContext(args, reqCtx);

    const includeLocal =
      hasLocalEvo &&
      Boolean(localTelemetry) &&
      ((scope === 'all') ||
        (scope === 'project' && !isTargetGlobalRoot) ||
        (scope === 'global' && isTargetGlobalRoot));
    const localHits =
      includeLocal && localTelemetry
        ? localTelemetry
            .search(query, kind, limit, searchScopeDir)
            .map((h) => ({ ...h, tier: (isTargetGlobalRoot ? 'GLOBAL' : 'LOCAL') as 'LOCAL' | 'GLOBAL' }))
        : [];

    const mergedHits: SearchHit[] = [...localHits];
    const seenIds = new Set<string>(localHits.map((h) => h.id));

    if (scope !== 'project' && kind !== 'memory') {
      for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
        const globalKind = kind === 'all' ? 'all' : kind;
        const gHits = gCtx.telemetry
          ? gCtx.telemetry.search(query, globalKind, limit, searchScopeDir)
          : [];
        for (const gh of gHits) {
          if (gh.kind === 'memory' || seenIds.has(gh.id)) continue;
          seenIds.add(gh.id);
          const applyDiscount =
            hasLocalEvo && !isTargetGlobalRoot && scope !== 'global' && gh.kind !== 'preference';
          mergedHits.push({
            ...gh,
            score: applyDiscount ? gh.score * 0.85 : gh.score,
            tier: 'GLOBAL',
          });
        }
      }
    }

    return this.finalizeSearchResponse(
      query,
      kind,
      limit,
      reqCtx,
      targetCtx,
      hasLocalEvo,
      localTelemetry,
      mergedHits
    );
  }

  private async handleSearchAsync(args: Record<string, unknown>, reqCtx: RequestContext) {
    const {
      query,
      kind,
      scope,
      limit,
      targetCtx,
      hasLocalEvo,
      isTargetGlobalRoot,
      searchScopeDir,
      localTelemetry,
    } = this.prepareSearchContext(args, reqCtx);

    const includeLocal =
      hasLocalEvo &&
      Boolean(localTelemetry) &&
      ((scope === 'all') ||
        (scope === 'project' && !isTargetGlobalRoot) ||
        (scope === 'global' && isTargetGlobalRoot));
    const localHits =
      includeLocal && localTelemetry
        ? (await localTelemetry.searchAsync(query, kind, limit, searchScopeDir)).map((h) => ({
            ...h,
            tier: (isTargetGlobalRoot ? 'GLOBAL' : 'LOCAL') as 'LOCAL' | 'GLOBAL',
          }))
        : [];

    const mergedHits: SearchHit[] = [...localHits];
    const seenIds = new Set<string>(localHits.map((h) => h.id));

    if (scope !== 'project' && kind !== 'memory') {
      const globalCtxs = this.getGlobalFallbackContexts(reqCtx);
      const globalKind = kind === 'all' ? 'all' : kind;
      const globalResults = await Promise.all(
        globalCtxs.map((gCtx) =>
          gCtx.telemetry
            ? gCtx.telemetry.searchAsync(query, globalKind, limit, searchScopeDir)
            : Promise.resolve([])
        )
      );
      for (const gHits of globalResults) {
        for (const gh of gHits) {
          if (gh.kind === 'memory' || seenIds.has(gh.id)) continue;
          seenIds.add(gh.id);
          const applyDiscount =
            hasLocalEvo && !isTargetGlobalRoot && scope !== 'global' && gh.kind !== 'preference';
          mergedHits.push({
            ...gh,
            score: applyDiscount ? gh.score * 0.85 : gh.score,
            tier: 'GLOBAL',
          });
        }
      }
    }

    return this.finalizeSearchResponse(
      query,
      kind,
      limit,
      reqCtx,
      targetCtx,
      hasLocalEvo,
      localTelemetry,
      mergedHits
    );
  }

  private handleInspect(args: Record<string, unknown>, reqCtx: RequestContext) {
    return this.executeInspect(args, reqCtx, false);
  }

  private async handleInspectAsync(args: Record<string, unknown>, reqCtx: RequestContext) {
    return await this.executeInspect(args, reqCtx, true);
  }

  private executeInspect(args: Record<string, unknown>, reqCtx: RequestContext, asyncMode: boolean): any {
    const rawId = String(args.id || '').trim();
    const id = sanitizeId(rawId);
    const tier = String(args.tier ?? args.level ?? args.depth ?? 'L2').toUpperCase();
    const storage = reqCtx.storage;
    let telemetry = reqCtx.telemetry;
    const hasLocal = reqCtx.hasLocalEvo;

    const getTelemetryStat = (capId: string, customTele?: EvoTelemetry | null) => {
      try {
        const tele = customTele || telemetry;
        if (tele && !tele.isClosed()) {
          const rec = tele.getTelemetryMap().get(capId);
          if (rec) {
            return {
              hit_count: Math.max(1, Number(rec.hit_count || 0)),
              helped_count: Number(rec.helped_count || 0),
              tokens_saved: Number(rec.tokens_saved || 0),
            };
          }
        }
      } catch {}
      return { hit_count: 1, helped_count: 0, tokens_saved: 0 };
    };

    const formatInspectResult = (bodyText: string, isPaused = false): any => {
      const pausedBanner = isPaused
        ? '> [!WARNING] **[PAUSED — enabled: false]**: This capability is currently paused in EvoKernel Workbench. Inspect only; do not rely on it as active policy.\n\n'
        : '';
      const antiPoisonReminder = this.getSessionAntiPoisonReminder(
        storage.rootDir,
        storage,
        telemetry,
        'all',
        hasLocal
      );
      if (asyncMode) {
        return this.checkDirtyTreeReminderAsync(storage.rootDir, telemetry, reqCtx.wsCtx).then(
          (reminder) => ({
            content: [{ type: 'text' as const, text: pausedBanner + bodyText + reminder + antiPoisonReminder }],
          })
        );
      }
      const reminder = this.checkDirtyTreeReminder(storage.rootDir, telemetry, reqCtx.wsCtx);
      return { content: [{ type: 'text' as const, text: pausedBanner + bodyText + reminder + antiPoisonReminder }] };
    };

    const parsedExt = parseExternalToolId(rawId);
    if (parsedExt) {
      let extTool = hasLocal ? storage.getExternalTool(rawId) : null;
      let extTelemetry = hasLocal ? telemetry : undefined;
      let isGlobalHit = false;
      if (!extTool) {
        for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
          const gExt = gCtx.storage.getExternalTool(rawId);
          if (gExt) {
            extTool = gExt;
            extTelemetry = gCtx.telemetry;
            isGlobalHit = true;
            break;
          }
        }
      }
      if (extTool) {
        extTelemetry?.recordUsage(extTool.id, true, 300);
        if (hasLocal && hasValidEvoStructure(storage.evoDir)) {
          telemetry = this.ensureActiveTelemetry(reqCtx, telemetry);
          if (!isGlobalHit) {
            extTelemetry = telemetry;
          }
          telemetry?.recordRecallEvent({
            eventType: 'inspect',
            capabilityId: extTool.id,
            kind: 'tool',
            tier: tier,
          });
          if (tier !== 'L1') {
            telemetry?.recordRecalledCapability({
              id: extTool.id,
              kind: 'tool',
              tier: isGlobalHit ? 'GLOBAL' : 'LOCAL',
            });
          }
        }
        const stat = getTelemetryStat(extTool.id, extTelemetry);
        const body =
          tier === 'L1'
            ? `[EXTERNAL TOOL L1] ${extTool.id} (server: ${extTool.serverName})\nL0: ${extTool.description}\nInput Schema:\n${JSON.stringify(extTool.inputSchema, null, 2)}`
            : `[EXTERNAL TOOL L2] ${extTool.id} (server: ${extTool.serverName}, tool: ${extTool.originalName})\nTelemetry: ${stat.hit_count} hits · ${stat.helped_count || 0} verified helped · ~${stat.tokens_saved || 0} tok saved\nL0: ${extTool.description}\nInput Schema:\n${JSON.stringify(extTool.inputSchema, null, 2)}\n\nExecution:\nRouted via downstream MCP server '${extTool.serverName}' using stdio JSON-RPC.\nCall via: evo_run("${extTool.id}", args)`;
        return formatInspectResult(body);
      }
    }

    let rule = hasLocal ? storage.getRule(id) : null;
    let activeTelemetry = hasLocal ? telemetry : undefined;
    let isRuleGlobalHit = false;
    if (!rule) {
      for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
        const gRule = gCtx.storage.getRule(id);
        if (gRule) {
          rule = gRule;
          activeTelemetry = gCtx.telemetry;
          isRuleGlobalHit = true;
          break;
        }
      }
    }
    if (rule) {
      activeTelemetry?.recordUsage(id, true, 250);
      if (hasLocal && hasValidEvoStructure(storage.evoDir)) {
        telemetry = this.ensureActiveTelemetry(reqCtx, telemetry);
        if (!isRuleGlobalHit) {
          activeTelemetry = telemetry;
        }
        telemetry?.recordRecallEvent({
          eventType: 'inspect',
          capabilityId: rule.id,
          kind: 'rule',
          tier,
        });
        if (tier !== 'L1') {
          telemetry?.recordRecalledCapability({
            id: rule.id,
            kind: 'rule',
            tier: isRuleGlobalHit ? 'GLOBAL' : 'LOCAL',
          });
        }
      }
      const stat = getTelemetryStat(rule.id, activeTelemetry);
      const body =
        tier === 'L1'
          ? `[RULE L1] ${rule.id} (${rule.scope_glob})\nL0: ${rule.l0_summary}\nTokens: ${rule.tokens}`
          : `[RULE L2] ${rule.id} — ${rule.title}\nScope: ${rule.scope_glob} | Core: ${rule.core}\nTelemetry: ${stat.hit_count} hits · ${stat.helped_count || 0} verified helped · ~${stat.tokens_saved || 0} tok saved\nL0: ${rule.l0_summary}\n\n${rule.content}`;
      return formatInspectResult(body, rule.enabled === false);
    }

    let skill = hasLocal ? storage.getSkill(id) : null;
    activeTelemetry = hasLocal ? telemetry : undefined;
    let isSkillGlobalHit = false;
    if (!skill) {
      for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
        const gSkill = gCtx.storage.getSkill(id);
        if (gSkill) {
          skill = gSkill;
          activeTelemetry = gCtx.telemetry;
          isSkillGlobalHit = true;
          break;
        }
      }
    }
    if (skill) {
      activeTelemetry?.recordUsage(id, true, 400);
      if (hasLocal && hasValidEvoStructure(storage.evoDir)) {
        telemetry = this.ensureActiveTelemetry(reqCtx, telemetry);
        if (!isSkillGlobalHit) {
          activeTelemetry = telemetry;
        }
        telemetry?.recordRecallEvent({
          eventType: 'inspect',
          capabilityId: skill.id,
          kind: 'skill',
          tier,
        });
        if (tier !== 'L1') {
          telemetry?.recordRecalledCapability({
            id: skill.id,
            kind: 'skill',
            tier: isSkillGlobalHit ? 'GLOBAL' : 'LOCAL',
          });
        }
      }
      const stat = getTelemetryStat(skill.id, activeTelemetry);
      const body =
        tier === 'L1'
          ? `[SKILL L1] ${skill.id} — ${skill.title}\nL0: ${skill.l0_summary}\nTags: ${skill.tags.join(', ')}\n\n## L1 Contract\n${skill.l1_contract}`
          : `[SKILL L2] ${skill.id} — ${skill.title}\nTelemetry: ${stat.hit_count} hits · ${stat.helped_count || 0} verified helped · ~${stat.tokens_saved || 0} tok saved\nL0: ${skill.l0_summary}\n\n## L1 Contract\n${skill.l1_contract}\n\n## L2 SOP\n${skill.l2_sop}`;
      return formatInspectResult(body, skill.enabled === false);
    }

    let tool = hasLocal ? storage.getTool(id) : null;
    activeTelemetry = hasLocal ? telemetry : undefined;
    let isToolGlobalHit = false;
    if (!tool) {
      for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
        const gTool = gCtx.storage.getTool(id);
        if (gTool) {
          tool = gTool;
          activeTelemetry = gCtx.telemetry;
          isToolGlobalHit = true;
          break;
        }
      }
    }
    if (tool) {
      activeTelemetry?.recordUsage(id, true, 300);
      if (hasLocal && hasValidEvoStructure(storage.evoDir)) {
        telemetry = this.ensureActiveTelemetry(reqCtx, telemetry);
        if (!isToolGlobalHit) {
          activeTelemetry = telemetry;
        }
        telemetry?.recordRecallEvent({
          eventType: 'inspect',
          capabilityId: tool.id,
          kind: 'tool',
          tier,
        });
        if (tier !== 'L1') {
          telemetry?.recordRecalledCapability({
            id: tool.id,
            kind: 'tool',
            tier: isToolGlobalHit ? 'GLOBAL' : 'LOCAL',
          });
        }
      }
      const stat = getTelemetryStat(tool.id, activeTelemetry);
      const body =
        tier === 'L1'
          ? `[TOOL L1] ${tool.id} (${tool.runtime})\nL0: ${tool.l0_summary}\nInput Schema:\n${JSON.stringify(tool.input_schema, null, 2)}`
          : `[TOOL L2] ${tool.id} (${tool.runtime})\nTelemetry: ${stat.hit_count} hits · ${stat.helped_count || 0} verified helped · ~${stat.tokens_saved || 0} tok saved\nL0: ${tool.l0_summary}\nInput Schema:\n${JSON.stringify(tool.input_schema, null, 2)}\n\nScript (${tool.entry_script}):\n\`\`\`${tool.runtime}\n${tool.script_code}\n\`\`\``;
      return formatInspectResult(body, tool.enabled === false);
    }

    let pref = hasLocal ? storage.getPreference(id) : null;
    activeTelemetry = hasLocal ? telemetry : undefined;
    let isPrefGlobalHit = false;
    if (!pref) {
      for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
        const gPref = gCtx.storage.getPreference(id);
        if (gPref) {
          pref = gPref;
          activeTelemetry = gCtx.telemetry;
          isPrefGlobalHit = true;
          break;
        }
      }
    }
    if (pref) {
      activeTelemetry?.recordUsage(id, true, 150);
      if (hasLocal && hasValidEvoStructure(storage.evoDir)) {
        telemetry = this.ensureActiveTelemetry(reqCtx, telemetry);
        if (!isPrefGlobalHit) {
          activeTelemetry = telemetry;
        }
        telemetry?.recordRecallEvent({
          eventType: 'inspect',
          capabilityId: pref.id,
          kind: 'preference',
          tier,
        });
        if (tier !== 'L1') {
          telemetry?.recordRecalledCapability({
            id: pref.id,
            kind: 'preference',
            tier: isPrefGlobalHit ? 'GLOBAL' : 'LOCAL',
          });
        }
      }
      const stat = getTelemetryStat(pref.id, activeTelemetry);
      const body =
        tier === 'L1'
          ? `[PREFERENCE L1] ${pref.id} (${pref.category} | always_on: ${pref.always_on})\nL0: ${pref.l0_summary}\nTokens: ${pref.tokens}\nTags: ${pref.tags.join(', ') || 'none'}`
          : `[PREFERENCE L2] ${pref.id} — ${pref.title}\nCategory: ${pref.category} | Always-On: ${pref.always_on} | Tokens: ${pref.tokens}\nTelemetry: ${stat.hit_count} hits · ${stat.helped_count || 0} verified helped · ~${stat.tokens_saved || 0} tok saved\nTags: ${pref.tags.join(', ') || 'none'}\nL0: ${pref.l0_summary}\n\n${pref.content}`;
      return formatInspectResult(body, pref.enabled === false);
    }

    const memory = hasLocal ? storage.getMemory(id) : null;
    if (memory) {
      const memoryTargetDir = reqCtx.requestWorkspaceDir || reqCtx.wsCtx.rootDir || storage.rootDir;
      const finishMemoryInspect = (report: MemoryVerificationReport) => {
        if (hasLocal && hasValidEvoStructure(storage.evoDir)) {
          telemetry = this.ensureActiveTelemetry(reqCtx, telemetry);
        }
        telemetry?.recordUsage(id, report.overall_status !== 'STALE', 650);
        if (hasLocal && hasValidEvoStructure(storage.evoDir)) {
          if (report.overall_status !== 'STALE') {
            telemetry?.recordRecallEvent({
              eventType: 'inspect',
              capabilityId: memory.id,
              kind: 'memory',
              tier,
            });
          }
          if (tier !== 'L1') {
            telemetry?.recordRecalledCapability({
              id: memory.id,
              kind: 'memory',
              tier: 'LOCAL',
            });
          }
        }

        const driftLines = report.checks.map((c) => {
          const badge =
            c.status === 'VERIFIED'
              ? '✅ [VERIFIED]'
              : c.status === 'OTHER_BRANCH'
                ? '🌿 [OTHER_BRANCH]'
                : `⚠️ [${c.status}]`;
          return `- ${badge} \`${c.symbol}\`: ${c.detail}`;
        });

        const anchorLines = report.topology_anchors.map((a) => {
          const callerText =
            a.callers.length > 0 ? ` | Callers: ${a.callers.join(', ')}` : ' | Callers: (none detected)';
          const hintText = a.codegraph_hint ? `\n    ↳ Next-Step Anchor: \`${a.codegraph_hint}\`` : '';
          return `- \`${a.symbol}\` -> \`${a.file_path}:${a.lines}\` [${a.status}]\n    Signature: \`${a.signature}\`${callerText}${hintText}`;
        });

        const branchLabel = report.recorded_branch || memory.created_branch || 'other-branch';
        const currentBranchLabel = report.current_branch || 'HEAD';
        const branchOnlyCount =
          report.branch_verified_count ?? Math.max(0, report.total_symbols - report.verified_count);
        const sampleBranchFile =
          report.checks.find((c) => c.status === 'OTHER_BRANCH')?.current?.file_path ||
          report.checks.find((c) => c.status === 'OTHER_BRANCH')?.recorded.file_path ||
          report.checks[0]?.recorded.file_path ||
          '<file_path>';

        const statusBanner =
          report.overall_status === 'STALE'
            ? [
                '',
                '> [!WARNING]',
                `> **ANTI-DRIFT GUARDRAIL ALERT (防刻舟求剑警告)**: This episodic memory is marked **[STALE]** ${report.confidence_tag}.`,
                `> Code symbols anchored at commit \`${report.recorded_commit}\` have mutated or disappeared in current commit \`${report.current_commit}\`.`,
                '> Treat this case strictly as historical reference — DO NOT blindly apply without re-verifying the mutated code!',
                '',
              ].join('\n')
            : report.overall_status === 'OTHER_BRANCH'
              ? [
                  '',
                  `> [!NOTE] **MULTI-BRANCH MEMORY**: Recorded on branch \`${branchLabel}\` (@ commit \`${report.recorded_commit}\`). ${branchOnlyCount}/${report.total_symbols} symbol(s) are specific to that branch and not yet merged into current HEAD (\`${currentBranchLabel}@${report.current_commit}\`; ${report.verified_count}/${report.total_symbols} verified in HEAD). Use \`git show ${report.recorded_commit}:./${sampleBranchFile.replace(/^\.\/+/, '')}\` to inspect the source branch implementation.`,
                  '',
                ].join('\n')
              : '';

        if (tier === 'L1') {
          const l1Body = [
            `[MEMORY L1] ${memory.id} — ${memory.title}`,
            `Status: ${report.overall_status} ${report.confidence_tag} (${report.verified_count}/${report.total_symbols} AST symbols verified | commit ${report.recorded_commit} -> ${report.current_commit})`,
            `L0: ${memory.l0_summary}`,
            statusBanner,
            '## Symptom',
            memory.symptom,
            '',
            '## Stage 2: AST Anti-Drift Check',
            ...driftLines,
          ]
            .filter(Boolean)
            .join('\n');
          return formatInspectResult(l1Body, memory.enabled === false);
        }

        const stat = getTelemetryStat(memory.id, telemetry);
        const l2Body = [
          `[MEMORY L2] ${memory.id} — ${memory.title}`,
          `Status: ${report.overall_status} ${report.confidence_tag} (${report.verified_count}/${report.total_symbols} AST symbols verified | commit ${report.recorded_commit} -> ${report.current_commit})`,
          `Telemetry: ${stat.hit_count} hits · ${stat.helped_count || 0} verified helped · ~${stat.tokens_saved || 0} tok saved`,
          `Tags: ${memory.tags.join(', ') || 'troubleshooting'}`,
          `L0: ${memory.l0_summary}`,
          statusBanner,
          '## 1. Symptom (现象指纹)',
          memory.symptom,
          '',
          '## 2. Root Cause (根本原因)',
          memory.root_cause,
          '',
          '## 3. Solution (修复解法)',
          memory.solution,
          '',
          '## 4. Stage 2: AST Anti-Drift Verification (防刻舟求剑核验)',
          ...driftLines,
          '',
          '## 5. Stage 3: Topology Penetration Anchors (L3 拓扑穿透直达锚点)',
          ...anchorLines,
        ]
          .filter(Boolean)
          .join('\n');
        return formatInspectResult(l2Body, memory.enabled === false);
      };

      if (asyncMode) {
        return verifyMemoryFreshnessAsync(memoryTargetDir, memory, {
          includeCallers: tier !== 'L1',
        }).then(finishMemoryInspect);
      }
      return finishMemoryInspect(
        verifyMemoryFreshness(memoryTargetDir, memory, {
          includeCallers: tier !== 'L1',
        })
      );
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Capability '${rawId || id}' not found in .evo/.` }],
    };
  }

  private validateRequiredToolArgs(
    toolId: string,
    schema: Record<string, unknown> | undefined,
    toolArgs: Record<string, unknown>
  ): string | null {
    if (Boolean(toolArgs['--self-test'] || toolArgs.self_test)) {
      return null;
    }
    if (!schema || !Array.isArray(schema.required) || schema.required.length === 0) {
      return null;
    }
    const props = schema.properties as Record<string, { type?: string } | undefined> | undefined;
    const missing: string[] = [];
    for (const rawReqKey of schema.required) {
      const reqKey = String(rawReqKey);
      const val = toolArgs[reqKey];
      const isMissing =
        !(reqKey in toolArgs) ||
        val === undefined ||
        val === null ||
        (props?.[reqKey]?.type === 'string' && val === '');
      if (isMissing) {
        missing.push(reqKey);
      }
    }
    if (missing.length > 0) {
      return `ERR_MISSING_REQUIRED_ARGS: Missing required parameter(s) [${missing.join(', ')}] for tool '${toolId}'.\nInput Schema:\n${JSON.stringify(schema, null, 2)}`;
    }
    return null;
  }

  private formatInputSchemaHint(schema: Record<string, unknown> | undefined): string {
    const props = schema?.properties;
    if (
      props &&
      typeof props === 'object' &&
      !Array.isArray(props) &&
      Object.keys(props as Record<string, unknown>).length > 0
    ) {
      return `\n\nInput Schema Hint:\n${JSON.stringify(schema, null, 2)}`;
    }
    return '';
  }

  private handleRun(args: Record<string, unknown>, reqCtx: RequestContext) {
    const rawToolId = String(args.tool_id || '').trim();
    const toolId = sanitizeId(rawToolId);
    if (
      args.args !== undefined &&
      (typeof args.args !== 'object' || args.args === null || Array.isArray(args.args))
    ) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: 'ERR_INVALID_SCHEMA: evo_run "args" must be a plain JSON object (received array or primitive).',
          },
        ],
      };
    }
    const toolArgs = (args.args ?? {}) as Record<string, unknown>;

    const parsedExt = parseExternalToolId(rawToolId);
    if (parsedExt) {
      const initialCtx = reqCtx.wsCtx;
      const hasLocal = reqCtx.hasLocalEvo;
      let targetCtx: WorkspaceContext = initialCtx;
      let serverConfig = hasLocal
        ? targetCtx.storage.getConfig().externalServers?.[parsedExt.serverName]
        : undefined;

      if (!serverConfig || serverConfig.disabled) {
        for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
          const gCfg = gCtx.storage.getConfig().externalServers?.[parsedExt.serverName];
          if (gCfg && !gCfg.disabled) {
            targetCtx = gCtx;
            serverConfig = gCfg;
            break;
          }
        }
      }

      if (!serverConfig || serverConfig.disabled) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Downstream MCP server '${parsedExt.serverName}' is not configured or is disabled in .evo/config.json.`,
            },
          ],
        };
      }

      const boundTelemetry = targetCtx.telemetry;
      const boundProxy = targetCtx.proxyManager;
      const boundServerConfig = serverConfig;
      const retainedTarget = targetCtx !== initialCtx;
      if (retainedTarget) {
        targetCtx.activeRefs++;
      }

      const executeCall = async () => {
        try {
          if (this.needsExternalToolsSync(targetCtx)) {
            await this.ensureExternalToolsSynced(targetCtx);
          }
          let cachedExtTool =
            targetCtx !== initialCtx || hasLocal
              ? targetCtx.storage.getExternalTool(rawToolId)
              : null;
          if (!cachedExtTool && targetCtx === initialCtx) {
            for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
              if (this.needsExternalToolsSync(gCtx)) {
                await this.ensureExternalToolsSynced(gCtx);
              }
              const gCached = gCtx.storage.getExternalTool(rawToolId);
              if (gCached) {
                cachedExtTool = gCached;
                break;
              }
            }
          }
          const resolvedToolName = cachedExtTool?.originalName || parsedExt.originalToolName;
          const canonicalExtId = cachedExtTool?.id || rawToolId;
          const reqErr = this.validateRequiredToolArgs(
            canonicalExtId,
            cachedExtTool?.inputSchema,
            toolArgs
          );
          if (reqErr) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: reqErr }],
            };
          }
          const res = await boundProxy.callTool(
            parsedExt.serverName,
            resolvedToolName,
            toolArgs,
            boundServerConfig
          );
          let localTelemetry = reqCtx.wsCtx.telemetry || reqCtx.telemetry;
          try {
            if (
              (targetCtx !== initialCtx || hasLocal) &&
              hasValidEvoStructure(targetCtx.storage.evoDir)
            ) {
              if (!targetCtx.telemetry || targetCtx.telemetry.isClosed()) {
                const refreshedTarget = this.getOrCreateContext(targetCtx.storage.rootDir);
                targetCtx.telemetry = refreshedTarget.telemetry;
                targetCtx.gatekeeper = refreshedTarget.gatekeeper;
              }
              targetCtx.telemetry?.recordUsage(canonicalExtId, !res.isError, res.isError ? 0 : 850);
            } else {
              boundTelemetry?.recordUsage(canonicalExtId, !res.isError, res.isError ? 0 : 850);
            }
            if (hasLocal && hasValidEvoStructure(initialCtx.storage.evoDir)) {
              localTelemetry = this.ensureActiveTelemetry(reqCtx, localTelemetry);
              localTelemetry?.recordRecalledCapability({
                id: canonicalExtId,
                kind: 'tool',
                tier: targetCtx !== initialCtx ? 'GLOBAL' : 'LOCAL',
              });
              if (!res.isError) {
                localTelemetry?.recordRecallEvent({
                  eventType: 'run',
                  capabilityId: canonicalExtId,
                  kind: 'tool',
                  tier: targetCtx !== initialCtx ? 'GLOBAL' : 'LOCAL',
                });
              }
            }
          } catch {
            // Ignore telemetry error if DB was closed concurrently
          }
          const header = `[evo_run: ${canonicalExtId} (proxy: ${parsedExt.serverName}/${resolvedToolName}) | exit=${res.isError ? 1 : 0} | ${res.durationMs}ms]`;
          const formattedText = res.content.map((c) => c.text).join('\n\n');
          const schemaHint = res.isError
            ? this.formatInputSchemaHint(cachedExtTool?.inputSchema)
            : '';
          const reminder = await this.checkDirtyTreeReminderAsync(
            reqCtx.requestWorkspaceDir || initialCtx.storage.rootDir,
            localTelemetry,
            reqCtx.wsCtx
          );
          const antiPoisonReminder = this.getSessionAntiPoisonReminder(
            initialCtx.storage.rootDir,
            initialCtx.storage,
            localTelemetry,
            'all',
            hasLocal
          );
          return {
            isError: res.isError,
            content: [
              {
                type: 'text' as const,
                text: `${header}\n\n${formattedText}${schemaHint}${reminder}${antiPoisonReminder}`,
              },
            ],
          };
        } finally {
          if (retainedTarget) {
            this.releaseContextRef(targetCtx);
          }
        }
      };

      return executeCall();
    }

    const initialStorage = reqCtx.storage;
    const hasLocal = reqCtx.hasLocalEvo;
    const localTool = hasLocal ? initialStorage.getTool(toolId) : null;
    let tool = localTool;
    let activeTelemetry = hasLocal ? reqCtx.telemetry : undefined;
    let isGlobalHit = false;
    if (!tool) {
      for (const gCtx of this.getGlobalFallbackContexts(reqCtx)) {
        const gTool = gCtx.storage.getTool(toolId);
        if (gTool) {
          tool = gTool;
          activeTelemetry = gCtx.telemetry;
          isGlobalHit = true;
          break;
        }
      }
    }
    if (tool && tool.enabled === false) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `ERR_CAPABILITY_PAUSED: Micro-Tool '${toolId}' is currently paused (enabled: false) and cannot be executed.`,
          },
        ],
      };
    }
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Micro-Tool '${toolId}' not found. Call evo_search(query, "tool") to list available tools.`,
          },
        ],
      };
    }

    const reqErr = this.validateRequiredToolArgs(tool.id, tool.input_schema, toolArgs);
    if (reqErr) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: reqErr }],
      };
    }

    const preferredCwd = reqCtx.requestWorkspaceDir;
    const fallbackCwd = reqCtx.storage.rootDir;
    const execCwd =
      preferredCwd && fs.existsSync(preferredCwd) ? preferredCwd : fallbackCwd;

    const boundStorage = reqCtx.storage;
    const boundTelemetry = activeTelemetry;
    const initialTelemetry = hasLocal ? reqCtx.telemetry : undefined;
    const targetTool = tool;

    const executeLocalTool = async () => {
      const res = await executeSandboxedScriptAsync(
        targetTool.runtime,
        targetTool.script_path,
        toolArgs,
        {
          cwd: execCwd,
          timeoutMs: targetTool.timeout_ms,
          selfTest: false,
        }
      );

      const success = res.exitCode === 0;
      let localTel = reqCtx.wsCtx.telemetry || initialTelemetry;
      try {
        boundTelemetry?.recordUsage(toolId, success, success ? 850 : 0);
        if (hasLocal && hasValidEvoStructure(boundStorage.evoDir)) {
          localTel = this.ensureActiveTelemetry(reqCtx, localTel);
          localTel?.recordRecalledCapability({
            id: targetTool.id,
            kind: 'tool',
            tier: isGlobalHit ? 'GLOBAL' : 'LOCAL',
          });
          if (success) {
            localTel?.recordRecallEvent({
              eventType: 'run',
              capabilityId: targetTool.id,
              kind: 'tool',
              tier: isGlobalHit ? 'GLOBAL' : 'LOCAL',
            });
          }
        }
      } catch {
        // Ignore telemetry error if DB was closed concurrently
      }

      const reminder = await this.checkDirtyTreeReminderAsync(execCwd, localTel, reqCtx.wsCtx);
      const antiPoisonReminder = this.getSessionAntiPoisonReminder(
        boundStorage.rootDir,
        boundStorage,
        localTel,
        'all',
        hasLocal
      );
      const schemaHint = !success ? this.formatInputSchemaHint(targetTool.input_schema) : '';
      const output = [
        `[evo_run: ${targetTool.id} (${targetTool.runtime}) | exit=${res.exitCode} | ${res.durationMs}ms]`,
        res.stdout ? `STDOUT:\n${res.stdout}` : '',
        res.stderr ? `STDERR:\n${res.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      return {
        isError: !success,
        content: [{ type: 'text' as const, text: output + schemaHint + reminder + antiPoisonReminder }],
      };
    };

    return executeLocalTool();
  }

  private handlePropose(proposal: ProposalPayload, reqCtx: RequestContext) {
    return this.executePropose(proposal, reqCtx, false);
  }

  private async handleProposeAsync(proposal: ProposalPayload, reqCtx: RequestContext) {
    return await this.executePropose(proposal, reqCtx, true);
  }

  private executePropose(proposal: ProposalPayload, reqCtx: RequestContext, asyncMode: boolean): any {
    reqCtx.wsCtx.callsSinceLastPropose = 0;
    reqCtx.wsCtx.watermarkDirtySig = reqCtx.wsCtx.lastDirtySig;
    const payload: ProposalPayload = {
      ...proposal,
      trigger_cue:
        proposal.trigger_cue !== undefined ? String(proposal.trigger_cue) : undefined,
      confidence: proposal.confidence,
      contrastive_evidence:
        proposal.contrastive_evidence !== undefined
          ? String(proposal.contrastive_evidence)
          : undefined,
      hook_trigger: proposal.hook_trigger,
    };
    const gatekeeper = reqCtx.wsCtx.gatekeeper || reqCtx.gatekeeper!;
    const storage = reqCtx.storage;
    const telemetry = reqCtx.wsCtx.telemetry || reqCtx.telemetry;
    const activeEpoch =
      telemetry && !telemetry.isClosed()
        ? telemetry.getSessionFlag('active_session_epoch') || undefined
        : undefined;

    const finishPropose = (result: ReturnType<EvoGatekeeper['evaluateAndCommit']>) => {
      if (!result.passed) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      const committedId = String(
        (result.diagnostics as Record<string, unknown> | undefined)?.id || sanitizeId(payload.id || '')
      );
      this.recordSessionProposal(
        storage.rootDir,
        committedId,
        payload.kind,
        payload.supersedes_id ? [payload.supersedes_id] : undefined,
        payload.enabled !== false,
        activeEpoch
      );

      if (payload.kind === 'rule' || payload.kind === 'tool' || payload.kind === 'skill') {
        syncManagedRuleBlocks(storage.rootDir);
        if (payload.kind === 'rule' && Boolean(payload.core) && this.onCoreRulesChanged) {
          this.onCoreRulesChanged();
        }
      } else if (payload.kind === 'preference' && isGlobalFallbackRoot(storage.rootDir)) {
        const syncRes = syncGlobalUserProfile(storage.rootDir);
        result.diagnostics = {
          ...(result.diagnostics || {}),
          synced_profile_targets: syncRes.updatedTargets,
          profile_tokens: syncRes.totalTokens,
          max_profile_tokens: syncRes.maxTokens,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    };

    if (asyncMode) {
      return gatekeeper.evaluateAndCommitAsync(payload).then(finishPropose);
    }
    return finishPropose(gatekeeper.evaluateAndCommit(payload));
  }

  private compactSchemaError(args: Record<string, unknown>) {
    const rawTargetIds = Array.isArray(args.target_ids)
      ? args.target_ids.map((id) => sanitizeId(String(id))).filter(Boolean)
      : [];
    const distinctCount = new Set(rawTargetIds).size;
    const merged = args.merged_proposal;
    const mergedIsObject = !!merged && typeof merged === 'object' && !Array.isArray(merged);
    if (distinctCount >= 2 && mergedIsObject) return null;
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              passed: false,
              gate_failed: 'SCHEMA_SECURITY',
              error_code: 'ERR_INVALID_SCHEMA',
              message:
                'evo_compact requires at least 2 distinct target_ids and a valid merged_proposal object.',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private handleCompact(args: Record<string, unknown>, reqCtx: RequestContext) {
    return this.executeCompact(args, reqCtx, false);
  }

  private async handleCompactAsync(args: Record<string, unknown>, reqCtx: RequestContext) {
    return await this.executeCompact(args, reqCtx, true);
  }

  private executeCompact(args: Record<string, unknown>, reqCtx: RequestContext, asyncMode: boolean): any {
    const rawTargetIds = Array.isArray(args.target_ids)
      ? args.target_ids.map((id) => sanitizeId(String(id))).filter(Boolean)
      : [];
    const targetIds = Array.from(new Set(rawTargetIds));
    const mergedProposal = args.merged_proposal as ProposalPayload;
    const reason = String(args.reason || 'Compacted via evo_compact');

    const schemaError = this.compactSchemaError(args);
    if (schemaError) return schemaError;

    const storage = reqCtx.storage;
    const telemetry = reqCtx.wsCtx.telemetry || reqCtx.telemetry;
    const gatekeeper = reqCtx.wsCtx.gatekeeper || reqCtx.gatekeeper!;
    const activeEpoch =
      telemetry && !telemetry.isClosed()
        ? telemetry.getSessionFlag('active_session_epoch') || undefined
        : undefined;

    const existingTargets = targetIds
      .map((id) => ({
        id,
        item:
          storage.getRule(id) ||
          storage.getSkill(id) ||
          storage.getTool(id) ||
          storage.getMemory(id) ||
          storage.getPreference(id),
      }))
      .filter((entry) => entry.item !== null);

    if (existingTargets.length < 2) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                passed: false,
                gate_failed: 'SCHEMA_SECURITY',
                error_code: 'ERR_INVALID_SCHEMA',
                message: `evo_compact requires at least 2 existing capabilities in target_ids (found ${existingTargets.length} existing out of [${targetIds.join(', ')}]).`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const mergedCleanId = sanitizeId(mergedProposal.id || '');
    const existingMergedTarget =
      storage.getRule(mergedCleanId) ||
      storage.getSkill(mergedCleanId) ||
      storage.getTool(mergedCleanId) ||
      storage.getMemory(mergedCleanId) ||
      storage.getPreference(mergedCleanId);
    const preservedCreatedAt = existingMergedTarget?.created_at;

    const existingRuleTargets: EvoRule[] = targetIds
      .map((id) => storage.getRule(id))
      .filter((r): r is EvoRule => r !== null);
    const inheritedCore =
      mergedProposal.core !== undefined
        ? Boolean(mergedProposal.core)
        : existingRuleTargets.some((r) => r.core);
    const effectiveMergedProposal =
      mergedProposal.kind === 'rule'
        ? { ...mergedProposal, core: inheritedCore }
        : mergedProposal;
    const inheritedTransferScenarios = Array.from(
      new Set(
        existingRuleTargets
          .flatMap((r) => r.transfer_scenarios || [])
          .map((s) => String(s).trim())
          .filter(Boolean)
      )
    );

    const compactedProposalPayload = {
      ...effectiveMergedProposal,
      origin: 'compacted',
    };
    const sharedCompactOpts = {
      preservedCreatedAt,
      inheritedTransferScenarios:
        inheritedTransferScenarios.length > 0 ? inheritedTransferScenarios : undefined,
      supersededRules: existingRuleTargets.length > 0 ? existingRuleTargets : undefined,
    };

    const runArchiveAndCommit = (
      precheck: ReturnType<EvoGatekeeper['evaluateAndCommit']>,
      commitFn: () => any
    ) => {
      if (!precheck.passed) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  compacted_ids: [],
                  reason,
                  result: precheck,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Snapshot target files before archiving for true transactional rollback
      const fileSnapshots: Array<{ path: string; data: Buffer }> = [];
      for (const id of targetIds) {
        const cleanId = sanitizeId(id);
        const candidatePaths = [
          path.join(storage.rulesDir, `${cleanId}.md`),
          path.join(storage.rulesDir, 'scoped', `${cleanId}.md`),
          path.join(storage.memoriesDir, `${cleanId}.md`),
          path.join(storage.preferencesDir, `${cleanId}.md`),
          path.join(storage.skillsDir, cleanId),
          path.join(storage.toolsDir, cleanId),
        ];
        for (const p of candidatePaths) {
          if (!fs.existsSync(p)) continue;
          const stat = fs.statSync(p);
          if (stat.isDirectory()) {
            const walkDir = (dir: string) => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  walkDir(fullPath);
                } else if (entry.isFile()) {
                  fileSnapshots.push({ path: fullPath, data: fs.readFileSync(fullPath) });
                }
              }
            };
            walkDir(p);
          } else if (stat.isFile()) {
            fileSnapshots.push({ path: p, data: fs.readFileSync(p) });
          }
        }
      }

      const archived: string[] = [];
      for (const id of targetIds) {
        if (
          storage.archiveCapability(id, mergedProposal.kind, reason) ||
          storage.archiveCapability(id, 'rule', reason) ||
          storage.archiveCapability(id, 'skill', reason) ||
          storage.archiveCapability(id, 'tool', reason) ||
          storage.archiveCapability(id, 'memory', reason) ||
          storage.archiveCapability(id, 'preference', reason)
        ) {
          archived.push(id);
        }
      }

      telemetry?.syncFromDisk();

      const finishCompact = (commitRes: ReturnType<EvoGatekeeper['evaluateAndCommit']>) => {
        if (!commitRes.passed) {
          for (const snap of fileSnapshots) {
            fs.mkdirSync(path.dirname(snap.path), { recursive: true });
            fs.writeFileSync(snap.path, snap.data);
          }
          telemetry?.syncFromDisk();
        } else {
          this.recordSessionProposal(
            storage.rootDir,
            mergedCleanId,
            effectiveMergedProposal.kind,
            targetIds,
            effectiveMergedProposal.enabled !== false,
            activeEpoch
          );
        }

        if (effectiveMergedProposal.kind === 'preference' && isGlobalFallbackRoot(storage.rootDir)) {
          const syncRes = syncGlobalUserProfile(storage.rootDir);
          if (commitRes.passed) {
            commitRes.diagnostics = {
              ...(commitRes.diagnostics || {}),
              synced_profile_targets: syncRes.updatedTargets,
              profile_tokens: syncRes.totalTokens,
              max_profile_tokens: syncRes.maxTokens,
            };
          }
        } else {
          syncManagedRuleBlocks(storage.rootDir);
        }
        if (this.onCoreRulesChanged) {
          this.onCoreRulesChanged();
        }

        return {
          isError: !commitRes.passed,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  compacted_ids: !commitRes.passed ? [] : archived,
                  reason,
                  result: commitRes,
                },
                null,
                2
              ),
            },
          ],
        };
      };

      const commitMaybeAsync = commitFn();
      if (commitMaybeAsync && typeof commitMaybeAsync.then === 'function') {
        return commitMaybeAsync.then(finishCompact);
      }
      return finishCompact(commitMaybeAsync);
    };

    // Module 3.1: Atomic pre-check before archiving or deleting any target_ids
    if (asyncMode) {
      return gatekeeper
        .evaluateAndCommitAsync(compactedProposalPayload, {
          dryRun: true,
          excludeIdsFromBudgetAndSim: targetIds,
          ...sharedCompactOpts,
        })
        .then((precheck) =>
          runArchiveAndCommit(precheck, () =>
            gatekeeper.evaluateAndCommitAsync(compactedProposalPayload, sharedCompactOpts)
          )
        );
    }

    const precheck = gatekeeper.evaluateAndCommit(compactedProposalPayload, {
      dryRun: true,
      excludeIdsFromBudgetAndSim: targetIds,
      ...sharedCompactOpts,
    });
    return runArchiveAndCommit(precheck, () =>
      gatekeeper.evaluateAndCommit(compactedProposalPayload, sharedCompactOpts)
    );
  }

  public async discoverAllDownstreamToolsWithStatus(): Promise<{
    tools: ExternalToolRecord[];
    failedServers: string[];
  }> {
    const servers = this.storage.getConfig().externalServers || {};
    return this.proxyManager.discoverAllDownstreamToolsWithStatus(servers);
  }

  public get lastExternalServersSignature(): string | undefined {
    return this.contexts.get(this.normalizeWorkspaceKey(this.activeWorkspaceDir))
      ?.lastExternalServersSignature;
  }

  public set lastExternalServersSignature(sig: string | undefined) {
    const ctx = this.contexts.get(this.normalizeWorkspaceKey(this.activeWorkspaceDir));
    if (ctx) ctx.lastExternalServersSignature = sig;
  }

  public close(): void {
    try {
      this.proxyManager.close();
    } catch {
      // ignore
    }
    for (const ctx of this.contexts.values()) {
      try {
        ctx.proxyManager.close();
      } catch {
        // ignore
      }
      try {
        ctx.telemetry?.close();
      } catch {
        // ignore double close
      }
    }
    this.contexts.clear();
  }
}
