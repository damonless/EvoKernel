export type EvoKind = 'rule' | 'skill' | 'tool' | 'memory';

export type ScriptRuntime = 'node' | 'python' | 'powershell' | 'bash';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'struct'
  | 'macro'
  | 'variable'
  | 'file';

export interface SymbolFingerprint {
  symbol: string;
  file_path: string;
  kind: SymbolKind;
  start_line: number;
  end_line: number;
  signature: string;
  ast_hash: string;
}

export interface EvoMemory {
  id: string;
  title: string;
  l0_summary: string;
  symptom: string;
  root_cause: string;
  solution: string;
  target_symbols: string[];
  ast_fingerprints: Record<string, SymbolFingerprint>;
  created_commit: string;
  tags: string[];
  origin: string;
  supersedes_id?: string;
  created_at: string;
  updated_at: string;
}

export interface SymbolDriftCheck {
  symbol: string;
  status: 'VERIFIED' | 'MISMATCH' | 'MISSING';
  recorded: SymbolFingerprint;
  current?: SymbolFingerprint;
  detail: string;
}

export interface TopologyAnchor {
  symbol: string;
  file_path: string;
  lines: string;
  signature: string;
  status: 'VERIFIED' | 'MISMATCH' | 'MISSING';
  callers: string[];
  codegraph_hint?: string;
}

export interface MemoryVerificationReport {
  memory_id: string;
  overall_status: 'VERIFIED' | 'STALE';
  confidence_tag: '[置信度: HIGH (≥80%)]' | '[置信度: LOW (20–50%) · STALE]';
  commit_match: boolean;
  recorded_commit: string;
  current_commit: string;
  verified_count: number;
  total_symbols: number;
  checks: SymbolDriftCheck[];
  topology_anchors: TopologyAnchor[];
}

export interface EvoConfig {
  version: string;
  maxCoreRuleTokens: number;
  maxL0SummaryChars: number;
  duplicateBm25Threshold: number;
  sandboxTimeoutMs: number;
  enabledHarnesses: string[];
  sharedEvoDir?: string;
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
  workspace?: string;
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
  // For memories (Episodic Troubleshooting Cases):
  symptom?: string;
  root_cause?: string;
  solution?: string;
  target_symbols?: string[];
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
  tier?: 'LOCAL' | 'GLOBAL';
  memory_status?: 'VERIFIED' | 'STALE';
  memory_badge?: string;
}

export interface GatekeeperResult {
  passed: boolean;
  gate_failed?:
    | 'SCHEMA_SECURITY'
    | 'SYNTAX_SANDBOX'
    | 'SYMBOL_GROUNDING'
    | 'DUPLICATE_CHECK'
    | 'TOKEN_BUDGET';
  error_code?:
    | 'ERR_INVALID_SCHEMA'
    | 'ERR_SECURITY_VIOLATION'
    | 'ERR_GLOBAL_MEMORY_FORBIDDEN'
    | 'ERR_SYNTAX_CHECK'
    | 'ERR_SANDBOX_SELF_TEST'
    | 'ERR_SYMBOL_NOT_FOUND'
    | 'ERR_DUPLICATE_CAPABILITY'
    | 'ERR_BUDGET_EXCEEDED';
  message: string;
  warning?: string;
  conflicting_ids?: string[];
  low_value_candidates?: Array<{
    id: string;
    l0_summary: string;
    tokens: number;
    hit_count: number;
  }>;
  diagnostics?: Record<string, unknown>;
}

