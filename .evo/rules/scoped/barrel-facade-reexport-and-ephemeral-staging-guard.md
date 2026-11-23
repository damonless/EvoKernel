---
id: barrel-facade-reexport-and-ephemeral-staging-guard
title: "Facade Barrel Re-Export Resolution & Ephemeral Self-Test Staging Guardrail"
l0_summary: "Follow bounded barrel re-exports in AST lookups after module splits; stage small tool dry-runs in OS temp dirs."
scope_glob: "src/core/**/*.ts"
core: false
priority: 50
tokens: 377
origin: "evolved"
contrastive_evidence: "Before adding bounded relative barrel re-export traversal in src/core/memory/symbol-extractor.ts and ephemeral staging in src/core/gatekeeper/workspace-snapshot.ts, splitting facade modules broke pinned AST symbol lookups and mutating self-tests touched live workspace files before rollback; after resolving re-export chains and staging eligible workspaces in temp directories, all facade-anchored memories remain verified and live workspace files stay untouched."
transfer_scenarios: ["Splitting monolithic TypeScript modules into focused sub-files behind a barrel facade without invalidating historical AST symbol anchors","Executing sandboxed micro-tool verification dry-runs in isolated temporary staging directories before falling back to rollback snapshots"]
created_at: "2026-11-18T17:18:15.109Z"
updated_at: "2026-11-19T17:22:25.910Z"
---

When decomposing large core modules behind compatibility facades or executing sandboxed verification dry-runs:
- Whenever a target symbol is not declared directly inside a hinted facade module, traverse relative module re-export chains within a bounded hop depth in both live filesystem reads and historical version-control lookups before falling back to repository-wide scans, ensuring existing symbol anchors remain valid across internal file splits.
- Mirror identical relative barrel re-export traversal in external configuration and health auditors so repository split-refactorings never trigger false-positive broken-anchor alarms.
- Before running sandboxed dry-run verification for executable capabilities, stage eligible workspaces into an isolated temporary directory with dedicated temporary environment paths and verify zero file mutations across both the staged tree and the real workspace root, falling back to full pre-execution rollback snapshots only when workspace size exceeds staging bounds.

## 典型反例锚点
Case Anchor: `.evo/memories/issues-31-32-33-hook-mcp-and-anchor-hardening.md` (`src/core/memory/symbol-extractor.ts#resolveBarrelReexportTargets`, `src/core/gatekeeper/workspace-snapshot.ts#prepareEphemeralSelfTestWorkspace`)
