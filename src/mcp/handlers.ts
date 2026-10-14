import type { EvoKind, ProposalPayload } from '../core/types.js';
import { EvoStorage, sanitizeId } from '../core/storage.js';
import { EvoTelemetry } from '../core/telemetry.js';
import { EvoGatekeeper } from '../core/gatekeeper.js';
import { executeSandboxedScript } from '../core/sandbox.js';

export const META_MCP_TOOLS = [
  {
    name: 'evo_search',
    description:
      'Search evolved project Rules, Skills, and executable Micro-Tools using FTS5 BM25. Returns ultra-compact L0 summaries (<30 tokens per item) and hit/success metrics. Always call before debugging recurring issues or writing repetitive scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords, file paths, error codes, or domain concepts to search for.',
        },
        kind: {
          type: 'string',
          enum: ['all', 'rule', 'skill', 'tool'],
          description: 'Filter by capability kind (default: "all").',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 8).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'evo_inspect',
    description:
      'Progressive disclosure loader. Fetch L1 (input schema / contract) or L2 (full SOP or script source) for a specific Rule, Skill, or Micro-Tool discovered via evo_search.',
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
          description: 'Disclosure level: L1 for compact contract/schema, L2 for full SOP/code (default: L2).',
        },
      },
      required: ['id'],
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
      },
      required: ['tool_id'],
    },
  },
  {
    name: 'evo_propose',
    description:
      'Crystallize a newly discovered bug-prevention Rule, reusable multi-step Skill (SOP), or parameterized Micro-Tool script into .evo/. Enforces 4 deterministic Gatekeeper checks: Static Security, Sandbox --self-test Dry-Run, BM25 Deduplication, and 1,500-token Core Rule Budget.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['rule', 'skill', 'tool'],
          description: 'Capability type to evolve.',
        },
        id: {
          type: 'string',
          description: 'Kebab-case identifier (e.g., "validate-i18n-keys", "prisma-migration-guard").',
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
          description: '[For skill] Searchable domain tags.',
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
      },
      required: ['kind', 'id', 'title', 'l0_summary'],
    },
  },
  {
    name: 'evo_compact',
    description:
      'Garbage-collect and merge multiple fragmented or low-hit capabilities into a single high-density entry, archiving the old versions to .evo/archive/ to free up the 1,500-token core budget.',
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
      },
      required: ['target_ids', 'merged_proposal', 'reason'],
    },
  },
] as const;

export class EvoMcpDispatcher {
  private readonly storage: EvoStorage;
  private readonly telemetry: EvoTelemetry;
  private readonly gatekeeper: EvoGatekeeper;
  private readonly onCoreRulesChanged?: () => void;

  constructor(workspaceRoot: string, onCoreRulesChanged?: () => void) {
    this.storage = new EvoStorage(workspaceRoot);
    this.telemetry = new EvoTelemetry(this.storage);
    this.gatekeeper = new EvoGatekeeper(this.storage, this.telemetry);
    this.onCoreRulesChanged = onCoreRulesChanged;
  }

  public handleToolCall(
    name: string,
    args: Record<string, unknown> = {}
  ): { isError?: boolean; content: Array<{ type: 'text'; text: string }> } {
    try {
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

    const hits = this.telemetry.search(query, kind, limit);
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

    const lines = hits.map(
      (h) =>
        `• [${h.kind.toUpperCase()}] ${h.id} — ${h.l0_summary} (scope: ${h.scope_glob} | hits: ${h.hit_count} | pass: ${h.success_rate})`
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Found ${hits.length} capability(s) [Core Budget: ${totalTokens}/${maxTokens} tokens]:`,
            ...lines,
            '',
            'Tip: Call evo_inspect(id, "L1"|"L2") for details or evo_run(tool_id, args) to execute a TOOL.',
          ].join('\n'),
        },
      ],
    };
  }

  private handleInspect(args: Record<string, unknown>) {
    const id = sanitizeId(String(args.id || ''));
    const tier = String(args.tier || 'L2').toUpperCase();

    const rule = this.storage.getRule(id);
    if (rule) {
      this.telemetry.recordUsage(id, true, 250);
      const body =
        tier === 'L1'
          ? `[RULE L1] ${rule.id} (${rule.scope_glob})\nL0: ${rule.l0_summary}\nTokens: ${rule.tokens}`
          : `[RULE L2] ${rule.id} — ${rule.title}\nScope: ${rule.scope_glob} | Core: ${rule.core}\nL0: ${rule.l0_summary}\n\n${rule.content}`;
      return { content: [{ type: 'text' as const, text: body }] };
    }

    const skill = this.storage.getSkill(id);
    if (skill) {
      this.telemetry.recordUsage(id, true, 400);
      const body =
        tier === 'L1'
          ? `[SKILL L1] ${skill.id} — ${skill.title}\nL0: ${skill.l0_summary}\nTags: ${skill.tags.join(', ')}\n\n## L1 Contract\n${skill.l1_contract}`
          : `[SKILL L2] ${skill.id} — ${skill.title}\nL0: ${skill.l0_summary}\n\n## L1 Contract\n${skill.l1_contract}\n\n## L2 SOP\n${skill.l2_sop}`;
      return { content: [{ type: 'text' as const, text: body }] };
    }

    const tool = this.storage.getTool(id);
    if (tool) {
      this.telemetry.recordUsage(id, true, 300);
      const body =
        tier === 'L1'
          ? `[TOOL L1] ${tool.id} (${tool.runtime})\nL0: ${tool.l0_summary}\nInput Schema:\n${JSON.stringify(tool.input_schema, null, 2)}`
          : `[TOOL L2] ${tool.id} (${tool.runtime})\nL0: ${tool.l0_summary}\nInput Schema:\n${JSON.stringify(tool.input_schema, null, 2)}\n\nScript (${tool.entry_script}):\n\`\`\`${tool.runtime}\n${tool.script_code}\n\`\`\``;
      return { content: [{ type: 'text' as const, text: body }] };
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

    const tool = this.storage.getTool(toolId);
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

    const res = executeSandboxedScript(tool.runtime, tool.script_path, toolArgs, {
      cwd: this.storage.rootDir,
      timeoutMs: tool.timeout_ms,
      selfTest: false,
    });

    const success = res.exitCode === 0;
    this.telemetry.recordUsage(toolId, success, success ? 850 : 0);

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

    if (proposal.kind === 'rule' && this.onCoreRulesChanged) {
      this.onCoreRulesChanged();
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

    const archived: string[] = [];
    for (const id of targetIds) {
      if (
        this.storage.archiveCapability(id, mergedProposal.kind, reason) ||
        this.storage.archiveCapability(id, 'rule', reason) ||
        this.storage.archiveCapability(id, 'skill', reason) ||
        this.storage.archiveCapability(id, 'tool', reason)
      ) {
        archived.push(id);
      }
    }

    this.telemetry.syncFromDisk();

    const commitRes = this.gatekeeper.evaluateAndCommit({
      ...mergedProposal,
      origin: 'compacted',
    });

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
    this.telemetry.close();
  }
}
