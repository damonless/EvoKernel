export { parseSkillSectionsFromMarkdown } from './storage.js';
export {
  DANGEROUS_PATTERNS,
  UNIVERSAL_SECURITY_PATTERNS,
  SCRIPT_EXECUTION_PATTERNS,
  TOOL_NETWORK_PATTERNS,
  stripScriptComments,
  CONTRASTIVE_STOPWORDS,
  isValidContrastiveEvidence,
  scanDangerousPatterns,
} from './gatekeeper/security-patterns.js';
export { hasUnsafeHookRegex } from './gatekeeper/redos-guard.js';
export {
  stripCaseAnchorLines,
  detectDomainNumbersInRule,
  detectCoupledIdentifiersInRule,
  scanCapabilityReferences,
  validateCapabilityReferences,
  scrubLocalUserPaths,
  isGlobalFallbackRoot,
  auditRuleGate1_5,
  extractActionableClauses,
  CLAUSE_STOP_WORDS,
  normalizeClauseText,
  tokenizeClauseText,
  calculateClauseSimilarity,
  compareRuleClauses,
} from './gatekeeper/abstraction-gates.js';
export type { Gate1_5Violation } from './gatekeeper/abstraction-gates.js';
export {
  captureWorkspaceMutationSignature,
  captureWorkspaceRollbackSnapshot,
  restoreWorkspaceFromSnapshot,
  prepareEphemeralSelfTestWorkspace,
} from './gatekeeper/workspace-snapshot.js';
export type { WorkspaceRollbackSnapshot } from './gatekeeper/workspace-snapshot.js';
export { EvoGatekeeper, detectPreferenceConflict } from './gatekeeper/evaluator.js';
export type { EvaluateOptions, GatekeeperEvaluateOptions } from './gatekeeper/evaluator.js';
