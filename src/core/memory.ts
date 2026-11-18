export {
  PARSER_VERSION,
  SOURCE_EXTENSIONS,
  isRealSubpathOf,
  readGitHeadSnapshot,
  readGitHeadSnapshotAsync,
  resolveCurrentGitBranch,
  resolveCurrentGitCommit,
  resolveGitPaths,
} from './memory/git-utils.js';
export type { GitHeadSnapshot, GitPaths } from './memory/git-utils.js';

export {
  computeAstHash,
  computeAstHashV1,
  computeStructuralSkeletonHash,
  maskSourceLexical,
  normalizeCodeStructure,
  normalizeCodeStructureV1,
  stripCStyleComments,
  trySkipGenericAngles,
} from './memory/lexical-mask.js';

export {
  buildFingerprintsForTargets,
  collectWorkspaceSourceFiles,
  extractSymbolBlockFromLines,
  extractSymbolFingerprint,
  extractSymbolFingerprintAsync,
  findAllSymbolDeclarationsInLines,
  findBraceBlockEnd,
  findBraceBlockEndV1,
  findPythonBlockEnd,
  findSymbolDeclarationInLines,
  isBodylessForwardDeclaration,
  parseSymbolTarget,
  resolveBarrelReexportTargets,
} from './memory/symbol-extractor.js';
export type { ExtractedSymbolBlock, ParsedSymbolTarget } from './memory/symbol-extractor.js';

export {
  clearMemoryVerificationCache,
  extractSymbolFingerprintAtCommitV1,
  extractSymbolsFromGitCommit,
  findSymbolCallers,
  findSymbolCallersAsync,
  getWorkspaceSourcesSig,
  refreshMemories,
  verifyMemoryFreshness,
  verifyMemoryFreshnessAsync,
} from './memory/freshness-verifier.js';
