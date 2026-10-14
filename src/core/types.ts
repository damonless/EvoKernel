export type EvoKind = 'rule' | 'skill' | 'tool';

export type ScriptRuntime = 'node' | 'python' | 'powershell' | 'bash';

export interface EvoConfig {
  version: string;
  maxCoreRuleTokens: number;
  maxL0SummaryChars: number;
  duplicateBm25Threshold: number;
  sandboxTimeoutMs: number;
  enabledHarnesses: string[];
}

export interface EvoRule {
  id: string;
  title: string;
  l0_summary: string;
  scope_glob: string;
  core: boolean;
  priority: number;
  content: string;
  tokens: number;
  origin: string;
  supersedes_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EvoSkill {
  id: string;
  title: string;
  l0_summary: string;
  l1_contract: string;
  l2_sop: string;
  tags: string[];
  origin: string;
  supersedes_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EvoToolManifest {
  id: string;
  title: string;
  l0_summary: string;
  runtime: ScriptRuntime;
  entry_script: string;
  input_schema: Record<string, unknown>;
  self_test_args: Record<string, unknown>;
  timeout_ms: number;
  origin: string;
  supersedes_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EvoTool extends EvoToolManifest {
  script_code: string;
  script_path: string;
}

export interface ProposalPayload {
  kind: EvoKind;
  id: string;
  title: string;
  l0_summary: string;
  origin?: string;
  supersedes_id?: string;
  // For rules:
  scope_glob?: string;
  core?: boolean;
  priority?: number;
  content?: string;
  // For skills:
  l1_contract?: string;
  l2_sop?: string;
  tags?: string[];
  // For tools:
  runtime?: ScriptRuntime;
  script_code?: string;
  input_schema?: Record<string, unknown>;
  self_test_args?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface TelemetryRecord {
  id: string;
  kind: EvoKind;
  l0_summary: string;
  scope_glob: string;
  hit_count: number;
  success_count: number;
  fail_count: number;
  tokens_saved: number;
  last_used_at: string;
  created_at: string;
}

export interface SearchHit {
  id: string;
  kind: EvoKind;
  title: string;
  l0_summary: string;
  scope_glob: string;
  hit_count: number;
  success_rate: string;
  score: number;
}

export interface GatekeeperResult {
  passed: boolean;
  gate_failed?: 'SCHEMA_SECURITY' | 'SYNTAX_SANDBOX' | 'DUPLICATE_CHECK' | 'TOKEN_BUDGET';
  error_code?:
    | 'ERR_INVALID_SCHEMA'
    | 'ERR_SECURITY_VIOLATION'
    | 'ERR_SYNTAX_CHECK'
    | 'ERR_SANDBOX_SELF_TEST'
    | 'ERR_DUPLICATE_CAPABILITY'
    | 'ERR_BUDGET_EXCEEDED';
  message: string;
  conflicting_ids?: string[];
  low_value_candidates?: Array<{
    id: string;
    l0_summary: string;
    tokens: number;
    hit_count: number;
  }>;
  diagnostics?: Record<string, unknown>;
}
