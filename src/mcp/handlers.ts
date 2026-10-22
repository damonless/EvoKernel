import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EvoKind, ProposalPayload, SearchHit } from '../core/types.js';
import {
  EvoStorage,
  findNearestEvoWorkspace,
  isPluginOrExtensionInstallDir,
  sanitizeId,
} from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';
import { executeSandboxedScript } from '../core/sandbox.js';
import { verifyMemoryFreshness } from '../core/memory.js';
import { ensureGitInfoExclude, findGitRoot, syncManagedRuleBlocks } from '../cli/init.js';

const WORKSPACE_PARAM_SCHEMA = {
  type: 'string',
  description:
    'Optional absolute path to the active project workspace. Routes EvoKernel to the nearest .evo/ directory at or above this path instead of the MCP server process cwd.',
} as const;

export const META_MCP_TOOLS = [
  {
    name: 'evo_search',
    description:
      'Search evolved project Rules, Skills, Micro-Tools, and Episodic Memories (fault cases) using FTS5 BM25 + live AST Anti-Drift verification. Returns ultra-compact L0 summaries (<30 tokens per item), hit/success metrics, and symbol freshness badges.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords, error symptoms, packet hex, file paths, or symbol names to search for.',
        },
        kind: {
          type: 'string',
          enum: ['all', 'rule', 'skill', 'tool', 'memory'],
          description: 'Filter by capability kind (default: "all").',
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
      'Progressive disclosure loader. Fetch L1 (contract / schema / symbol freshness) or L2 (full SOP / script source / Episodic Memory with AST Anti-Drift report & CodeGraph Topology Penetration anchors) for a specific Rule, Skill, Micro-Tool, or Memory.',
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
      'Execute a verified local Micro-Tool script (.mjs, .py, .ps1, .sh) inside a bounded sandbox and return structured stdout/stderr. Saves 90%+ context window tokens compared to reading raw files.',
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
      'Crystallize a newly discovered bug-prevention Rule, reusable multi-step Skill (SOP), parameterized Micro-Tool script, or AST-anchored Episodic Memory (fault case) into .evo/. Enforces deterministic Gatekeeper checks: Static Security, Sandbox/AST Grounding, BM25 Deduplication, and 1,500-token Core Rule Budget.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['rule', 'skill', 'tool', 'memory'],
          description: 'Capability type to evolve.',
        },
        id: {
          type: 'string',
          description: 'Kebab-case identifier (e.g., "validate-i18n-keys", "can-rx-timeout-glitch").',
        },
        title: {
          type: 'string',
          description: 'Short human-readable title.',
        },
        l0_summary: {
          type: 'string',
          description: 'One-sentence L0 abstract (<= 140 chars) for fast relevance scanning.',
        },
        supersedes_id: {
          type: 'string',
          description: 'Optional ID of an older capability that this proposal upgrades/replaces.',
        },
        scope_glob: {
          type: 'string',
          description: '[For rule] File glob scope (e.g., "src/api/**/*.ts" or "**/*").',
        },
        core: {
          type: 'boolean',
          description: '[For rule] Whether this rule belongs in the always-on 1,500-token core invariants digest.',
        },
        content: {
          type: 'string',
          description: '[For rule] Actionable markdown guardrails and rationale.',
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
          description: '[For skill / memory] Searchable domain tags.',
        },
        runtime: {
          type: 'string',
          enum: ['node', 'python', 'powershell', 'bash'],
          description: '[For tool] Script execution runtime.',
        },
        script_code: {
          type: 'string',
          description: '[For tool] Full script source code. Must exit 0 when invoked with --self-test or EVO_SELF_TEST=1.',
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
          description: '[For memory] Observed error message, fault symptom, or anomalous packet/log signature.',
        },
        root_cause: {
          type: 'string',
          description: '[For memory] Underlying root cause analysis explaining why the symptom occurred.',
        },
        solution: {
          type: 'string',
          description: '[For memory] Verified fix summary and verification steps.',
        },
        target_symbols: {
          type: 'array',
          items: { type: 'string' },
          description: '[For memory] Core code symbols or file#symbol targets (e.g., ["src/core/telemetry.ts#search", "BmsCanRxHandler"]) for automatic AST structural fingerprinting.',
        },
        workspace: WORKSPACE_PARAM_SCHEMA,
      },
      required: ['kind', 'id', 'title', 'l0_summary', 'workspace'],
    },
  },
  {
    name: 'evo_compact',
    description:
      'Garbage-collect and merge multiple fragmented, stale, or low-hit capabilities into a single high-density entry, archiving the old versions to .evo/archive/ to free up the 1,500-token core budget.',
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
          description: 'The consolidated ProposalPayload (same schema as evo_propose) that replaces target_ids.',
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

interface WorkspaceContext {
  rootDir: string;
  storage: EvoStorage;
  telemetry: EvoTelemetry;
  gatekeeper: EvoGatekeeper;
}

export class EvoMcpDispatcher {
  private readonly defaultRoot: string;
  private readonly contexts = new Map<string, WorkspaceContext>();
  private activeWorkspaceDir: string;
  private storage: EvoStorage;
  private telemetry: EvoTelemetry;
  private gatekeeper: EvoGatekeeper;
  private readonly onCoreRulesChanged?: () => void;

  constructor(workspaceRoot: string, onCoreRulesChanged?: () => void) {
    this.defaultRoot = path.resolve(workspaceRoot);
    this.activeWorkspaceDir = this.defaultRoot;
    this.onCoreRulesChanged = onCoreRulesChanged;
    const initialCtx = this.getOrCreateContext(this.defaultRoot);
    this.storage = initialCtx.storage;
    this.telemetry = initialCtx.telemetry;
    this.gatekeeper = initialCtx.gatekeeper;
  }

  private getOrCreateContext(targetRoot: string): WorkspaceContext {
    const resolved = path.resolve(targetRoot);
    const existing = this.contexts.get(resolved);
    if (existing) {
      return existing;
    }
    const storage = new EvoStorage(resolved);
    const telemetry = new EvoTelemetry(storage);
    const gatekeeper = new EvoGatekeeper(storage, telemetry);
    const ctx: WorkspaceContext = { rootDir: resolved, storage, telemetry, gatekeeper };
    this.contexts.set(resolved, ctx);
    return ctx;
  }

  private getGlobalFallbackContexts(): WorkspaceContext[] {
    const fallbacks: WorkspaceContext[] = [];
    const activeRoot = path.resolve(this.storage.rootDir);

    if (this.defaultRoot !== activeRoot && fs.existsSync(path.join(this.defaultRoot, '.evo'))) {
      fallbacks.push(this.getOrCreateContext(this.defaultRoot));
    }

    const envGlobal = process.env.EVO_GLOBAL_DIR
      ? path.resolve(process.env.EVO_GLOBAL_DIR)
      : !process.env.NODE_TEST_CONTEXT
        ? path.join(os.homedir(), '.evo', 'global')
        : null;

    if (
      envGlobal &&
      envGlobal !== activeRoot &&
      envGlobal !== this.defaultRoot &&
      fs.existsSync(path.join(envGlobal, '.evo'))
    ) {
      fallbacks.push(this.getOrCreateContext(envGlobal));
    }

    return fallbacks;
  }

  private bindActiveContext(toolName: string, args: Record<string, unknown>): WorkspaceContext {
    const rawWs = args.workspace ?? args.workspace_path;
    let targetRoot = this.defaultRoot;
    this.activeWorkspaceDir = this.defaultRoot;

    if (typeof rawWs === 'string' && rawWs.trim()) {
      const candidate = path.resolve(rawWs.trim());
      if (isPluginOrExtensionInstallDir(candidate)) {
        // Explicit global fallback dir or plugin install dir binds to defaultRoot (or candidate if ~/.evo/global)
        const norm = candidate.replace(/\\/g, '/').toLowerCase();
        if (
          norm.endsWith('/.evo/global') ||
          (process.env.EVO_GLOBAL_DIR &&
            path.resolve(process.env.EVO_GLOBAL_DIR).toLowerCase() === candidate.toLowerCase())
        ) {
          targetRoot = candidate;
          this.activeWorkspaceDir = candidate;
        }
      } else {
        this.activeWorkspaceDir = candidate;
        const nearestEvo = findNearestEvoWorkspace(candidate);
        if (nearestEvo) {
          targetRoot = nearestEvo;
        } else if (toolName === 'evo_propose' || toolName === 'evo_compact') {
          // Module 1.2: Never fall back to ~/.evo/global on write operations!
          // Resolve nearest Git root (or candidate) and auto-initialize local Stealth .evo/
          const localRoot = findGitRoot(candidate) || candidate;
          fs.mkdirSync(localRoot, { recursive: true });
          const localStorage = new EvoStorage(localRoot);
          localStorage.ensureInitialized();
          ensureGitInfoExclude(localRoot, ['.evo/']);
          targetRoot = localRoot;
        } else {
          // Read/exec operations (evo_search, evo_inspect, evo_run): do not create .evo/ in uninitialized folders,
          // but preserve this.activeWorkspaceDir = candidate for evo_run cwd & scope_glob filtering!
          targetRoot = this.defaultRoot;
        }
      }
    }

    const ctx = this.getOrCreateContext(targetRoot);
    this.storage = ctx.storage;
    this.telemetry = ctx.telemetry;
    this.gatekeeper = ctx.gatekeeper;
    return ctx;
  }

  public handleToolCall(
    name: string,
    args: Record<string, unknown> = {}
  ): { isError?: boolean; content: Array<{ type: 'text'; text: string }> } {
    try {
      this.bindActiveContext(name, args);
      switch (name) {
        case 'evo_search':
          return this.handleSearch(args);
        case 'evo_inspect':
          return this.handleInspect(args);
        case 'evo_run':
          return this.handleRun(args);
        case 'evo_propose':
          return this.handlePropose(args as unknown as ProposalPayload);
        case 'evo_compact':
          return this.handleCompact(args);
        default:
          return {
            isError: true,
            content: [{ type: 'text', text: `Unknown Meta-MCP tool: ${name}` }],
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: `EvoKernel internal error in ${name}: ${msg}` }],
      };
    }
  }

  private handleSearch(args: Record<string, unknown>) {
    const query = String(args.query || '');
    const kind = (args.kind ? String(args.kind) : 'all') as EvoKind | 'all';
    const limit = Number(args.limit || 8);

    const localHits = this.telemetry
      .search(query, kind, limit, this.activeWorkspaceDir)
      .map((h) => ({ ...h, tier: 'LOCAL' as const }));

    const mergedHits: SearchHit[] = [...localHits];
    const seenIds = new Set<string>(localHits.map((h) => h.id));

    if (kind !== 'memory') {
      for (const gCtx of this.getGlobalFallbackContexts()) {
        const globalKind = kind === 'all' ? 'all' : kind;
        const gHits = gCtx.telemetry.search(query, globalKind, limit, this.activeWorkspaceDir);
        for (const gh of gHits) {
          if (gh.kind === 'memory' || seenIds.has(gh.id)) continue;
          seenIds.add(gh.id);
          mergedHits.push({
            ...gh,
            score: gh.score * 0.85,
            tier: 'GLOBAL',
          });
        }
      }
    }

    const hits = mergedHits
      .sort((a, b) => {
        const aStale = a.memory_status === 'STALE' ? 1 : 0;
        const bStale = b.memory_status === 'STALE' ? 1 : 0;
        if (aStale !== bStale) return aStale - bStale;
        return b.score - a.score || b.hit_count - a.hit_count;
      })
      .slice(0, limit);

    const { totalTokens } = this.storage.getCoreRulesTokenUsage();
    const maxTokens = this.storage.getConfig().maxCoreRuleTokens;

    if (hits.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No evolved capabilities matched query "${query}". Core Rule Budget: ${totalTokens}/${maxTokens} tokens.`,
          },
        ],
      };
    }

    const lines = hits.map((h) => {
      if (h.kind === 'memory' && h.memory_badge) {
        const icon = h.memory_status === 'VERIFIED' ? '✅' : '⚠️';
        return `• [MEMORY] ${icon} ${h.memory_badge} ${h.id} — ${h.l0_summary} (anchors: ${h.scope_glob} | hits: ${h.hit_count})`;
      }
      const tierBadge = h.tier === 'GLOBAL' ? ' [GLOBAL]' : '';
      return `• [${h.kind.toUpperCase()}]${tierBadge} ${h.id} — ${h.l0_summary} (scope: ${h.scope_glob} | hits: ${h.hit_count} | pass: ${h.success_rate})`;
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Found ${hits.length} capability(s) [Core Budget: ${totalTokens}/${maxTokens} tokens]:`,
            ...lines,
            '',
            'Tip: Call evo_inspect(id, "L1"|"L2") for details/topology anchors or evo_run(tool_id, args) to execute a TOOL.',
          ].join('\n'),
        },
      ],
    };
  }

  private handleInspect(args: Record<string, unknown>) {
    const id = sanitizeId(String(args.id || ''));
    const tier = String(args.tier ?? args.level ?? args.depth ?? 'L2').toUpperCase();

    let rule = this.storage.getRule(id);
    let activeTelemetry = this.telemetry;
    if (!rule) {
      for (const gCtx of this.getGlobalFallbackContexts()) {
        const gRule = gCtx.storage.getRule(id);
        if (gRule) {
          rule = gRule;
          activeTelemetry = gCtx.telemetry;
          break;
        }
      }
    }
    if (rule) {
      activeTelemetry.recordUsage(id, true, 250);
      const body =
        tier === 'L1'
          ? `[RULE L1] ${rule.id} (${rule.scope_glob})\nL0: ${rule.l0_summary}\nTokens: ${rule.tokens}`
          : `[RULE L2] ${rule.id} — ${rule.title}\nScope: ${rule.scope_glob} | Core: ${rule.core}\nL0: ${rule.l0_summary}\n\n${rule.content}`;
      return { content: [{ type: 'text' as const, text: body }] };
    }

    let skill = this.storage.getSkill(id);
    activeTelemetry = this.telemetry;
    if (!skill) {
      for (const gCtx of this.getGlobalFallbackContexts()) {
        const gSkill = gCtx.storage.getSkill(id);
        if (gSkill) {
          skill = gSkill;
          activeTelemetry = gCtx.telemetry;
          break;
        }
      }
    }
    if (skill) {
      activeTelemetry.recordUsage(id, true, 400);
      const body =
        tier === 'L1'
          ? `[SKILL L1] ${skill.id} — ${skill.title}\nL0: ${skill.l0_summary}\nTags: ${skill.tags.join(', ')}\n\n## L1 Contract\n${skill.l1_contract}`
          : `[SKILL L2] ${skill.id} — ${skill.title}\nL0: ${skill.l0_summary}\n\n## L1 Contract\n${skill.l1_contract}\n\n## L2 SOP\n${skill.l2_sop}`;
      return { content: [{ type: 'text' as const, text: body }] };
    }

    let tool = this.storage.getTool(id);
    activeTelemetry = this.telemetry;
    if (!tool) {
      for (const gCtx of this.getGlobalFallbackContexts()) {
        const gTool = gCtx.storage.getTool(id);
        if (gTool) {
          tool = gTool;
          activeTelemetry = gCtx.telemetry;
          break;
        }
      }
    }
    if (tool) {
      activeTelemetry.recordUsage(id, true, 300);
      const body =
        tier === 'L1'
          ? `[TOOL L1] ${tool.id} (${tool.runtime})\nL0: ${tool.l0_summary}\nInput Schema:\n${JSON.stringify(tool.input_schema, null, 2)}`
          : `[TOOL L2] ${tool.id} (${tool.runtime})\nL0: ${tool.l0_summary}\nInput Schema:\n${JSON.stringify(tool.input_schema, null, 2)}\n\nScript (${tool.entry_script}):\n\`\`\`${tool.runtime}\n${tool.script_code}\n\`\`\``;
      return { content: [{ type: 'text' as const, text: body }] };
    }

    const memory = this.storage.getMemory(id);
    if (memory) {
      const report = verifyMemoryFreshness(this.storage.rootDir, memory, {
        includeCallers: tier !== 'L1',
      });
      this.telemetry.recordUsage(id, report.overall_status === 'VERIFIED', 650);

      const driftLines = report.checks.map((c) => {
        const badge = c.status === 'VERIFIED' ? '✅ [VERIFIED]' : `⚠️ [${c.status}]`;
        return `- ${badge} \`${c.symbol}\`: ${c.detail}`;
      });

      const anchorLines = report.topology_anchors.map((a) => {
        const callerText =
          a.callers.length > 0 ? ` | Callers: ${a.callers.join(', ')}` : ' | Callers: (none detected)';
        const hintText = a.codegraph_hint ? `\n    ↳ Next-Step Anchor: \`${a.codegraph_hint}\`` : '';
        return `- \`${a.symbol}\` -> \`${a.file_path}:${a.lines}\` [${a.status}]\n    Signature: \`${a.signature}\`${callerText}${hintText}`;
      });

      const staleWarning =
        report.overall_status === 'STALE'
          ? [
              '',
              '> [!WARNING]',
              `> **ANTI-DRIFT GUARDRAIL ALERT (防刻舟求剑警告)**: This episodic memory is marked **[STALE]** ${report.confidence_tag}.`,
              `> Code symbols anchored at commit \`${report.recorded_commit}\` have mutated or disappeared in current commit \`${report.current_commit}\`.`,
              '> Treat this case strictly as historical reference — DO NOT blindly apply without re-verifying the mutated code!',
              '',
            ].join('\n')
          : '';

      if (tier === 'L1') {
        const l1Body = [
          `[MEMORY L1] ${memory.id} — ${memory.title}`,
          `Status: ${report.overall_status} ${report.confidence_tag} (${report.verified_count}/${report.total_symbols} AST symbols verified | commit ${report.recorded_commit} -> ${report.current_commit})`,
          `L0: ${memory.l0_summary}`,
          staleWarning,
          '## Symptom',
          memory.symptom,
          '',
          '## Stage 2: AST Anti-Drift Check',
          ...driftLines,
        ]
          .filter(Boolean)
          .join('\n');
        return { content: [{ type: 'text' as const, text: l1Body }] };
      }

      const l2Body = [
        `[MEMORY L2] ${memory.id} — ${memory.title}`,
        `Status: ${report.overall_status} ${report.confidence_tag} (${report.verified_count}/${report.total_symbols} AST symbols verified | commit ${report.recorded_commit} -> ${report.current_commit})`,
        `Tags: ${memory.tags.join(', ') || 'troubleshooting'}`,
        `L0: ${memory.l0_summary}`,
        staleWarning,
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
      return { content: [{ type: 'text' as const, text: l2Body }] };
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Capability '${id}' not found in .evo/.` }],
    };
  }

  private handleRun(args: Record<string, unknown>) {
    const toolId = sanitizeId(String(args.tool_id || ''));
    const toolArgs = (args.args && typeof args.args === 'object' ? args.args : {}) as Record<
      string,
      unknown
    >;

    let tool = this.storage.getTool(toolId);
    let activeTelemetry = this.telemetry;
    if (!tool) {
      for (const gCtx of this.getGlobalFallbackContexts()) {
        const gTool = gCtx.storage.getTool(toolId);
        if (gTool) {
          tool = gTool;
          activeTelemetry = gCtx.telemetry;
          break;
        }
      }
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

    const execCwd =
      this.activeWorkspaceDir && fs.existsSync(this.activeWorkspaceDir)
        ? this.activeWorkspaceDir
        : this.storage.rootDir;

    const res = executeSandboxedScript(tool.runtime, tool.script_path, toolArgs, {
      cwd: execCwd,
      timeoutMs: tool.timeout_ms,
      selfTest: false,
    });

    const success = res.exitCode === 0;
    activeTelemetry.recordUsage(toolId, success, success ? 850 : 0);

    const output = [
      `[evo_run: ${tool.id} (${tool.runtime}) | exit=${res.exitCode} | ${res.durationMs}ms]`,
      res.stdout ? `STDOUT:\n${res.stdout}` : '',
      res.stderr ? `STDERR:\n${res.stderr}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      isError: !success,
      content: [{ type: 'text' as const, text: output }],
    };
  }

  private handlePropose(proposal: ProposalPayload) {
    const result = this.gatekeeper.evaluateAndCommit(proposal);
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

    if (proposal.kind === 'rule') {
      syncManagedRuleBlocks(this.storage.rootDir);
      if (this.onCoreRulesChanged) {
        this.onCoreRulesChanged();
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private handleCompact(args: Record<string, unknown>) {
    const targetIds = Array.isArray(args.target_ids) ? args.target_ids.map((id) => sanitizeId(String(id))) : [];
    const mergedProposal = args.merged_proposal as ProposalPayload | undefined;
    const reason = String(args.reason || 'Compacted via evo_compact');

    if (targetIds.length < 2 || !mergedProposal) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: 'evo_compact requires at least 2 target_ids and a valid merged_proposal object.',
          },
        ],
      };
    }

    // Module 3.1: Atomic pre-check before archiving or deleting any target_ids
    const precheck = this.gatekeeper.evaluateAndCommit(
      {
        ...mergedProposal,
        origin: 'compacted',
      },
      {
        dryRun: true,
        excludeIdsFromBudgetAndSim: targetIds,
      }
    );

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

    const archived: string[] = [];
    for (const id of targetIds) {
      if (
        this.storage.archiveCapability(id, mergedProposal.kind, reason) ||
        this.storage.archiveCapability(id, 'rule', reason) ||
        this.storage.archiveCapability(id, 'skill', reason) ||
        this.storage.archiveCapability(id, 'tool', reason) ||
        this.storage.archiveCapability(id, 'memory', reason)
      ) {
        archived.push(id);
      }
    }

    this.telemetry.syncFromDisk();

    const commitRes = this.gatekeeper.evaluateAndCommit({
      ...mergedProposal,
      origin: 'compacted',
    });

    syncManagedRuleBlocks(this.storage.rootDir);
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
              compacted_ids: archived,
              reason,
              result: commitRes,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  public close(): void {
    for (const ctx of this.contexts.values()) {
      try {
        ctx.telemetry.close();
      } catch {
        // ignore double close
      }
    }
    this.contexts.clear();
  }
}
