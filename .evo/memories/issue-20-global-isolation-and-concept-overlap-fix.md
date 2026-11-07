---
id: issue-20-global-isolation-and-concept-overlap-fix
title: "Issue #20 Global Fallback Isolation, Multi-Token Relevance Gating & Cross-OS Path Redaction"
l0_summary: "Isolate uninitialized workspace GLOBAL fallback, gate Action Required on concept overlap, and normalize cross-OS path redaction."
created_commit: "02e7257"
created_branch: "main"
target_symbols: ["src/core/telemetry.ts#redactSensitiveDiagnostics","src/core/telemetry.ts#evaluateConceptOverlap","src/mcp/handlers.ts#bindActiveContext","src/mcp/handlers.ts#handleSearch"]
ast_fingerprints: {"src/core/telemetry.ts#redactSensitiveDiagnostics":{"symbol":"src/core/telemetry.ts#redactSensitiveDiagnostics","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"function","start_line":21,"end_line":133,"signature":"export function redactSensitiveDiagnostics(text: string, workspaceRoot?: string): string","ast_hash":"0acfa7bac98f461d"},"src/core/telemetry.ts#evaluateConceptOverlap":{"symbol":"src/core/telemetry.ts#evaluateConceptOverlap","file_path":"src/core/telemetry.ts","file":"src/core/telemetry.ts","kind":"function","start_line":473,"end_line":512,"signature":"function evaluateConceptOverlap(","ast_hash":"6efcc86eb018d013"},"src/mcp/handlers.ts#bindActiveContext":{"symbol":"src/mcp/handlers.ts#bindActiveContext","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":588,"end_line":711,"signature":"private bindActiveContext(toolName: string, args: Record<string, unknown>): WorkspaceContext","ast_hash":"dcd209fa7f64334e"},"src/mcp/handlers.ts#handleSearch":{"symbol":"src/mcp/handlers.ts#handleSearch","file_path":"src/mcp/handlers.ts","file":"src/mcp/handlers.ts","kind":"method","start_line":865,"end_line":977,"signature":"private handleSearch(args: Record<string, unknown>, activeCtx?: WorkspaceContext)","ast_hash":"9507f3a9fbb55d10"}}
tags: ["mcp","telemetry","global-fallback","search","ci"]
origin: "evolved"
created_at: "2026-11-03T05:26:07.726Z"
updated_at: "2026-11-07T06:43:37.888Z"
---

## Symptom
1) ubuntu-latest CI failed on redactSensitiveDiagnostics with Windows drive paths; 2) evo_search on an uninitialized workspace disguised ~/.evo/global hits as LOCAL and emitted mandatory Action Required on single-generic-word matches.

## Root Cause
1) POSIX path.resolve('C:\\...') on Linux prepended the runner CWD instead of recognizing a Windows drive path. 2) bindActiveContext fell back to defaultRoot (~/.evo/global) on read operations without setting hasLocalEvo = false, causing handleSearch to label global hits as LOCAL. 3) FTS5 OR bag-of-words queries matched single generic words ('power', 'delay') while missing specific anchors ('EPO'), unconditionally emitting Action Required.

## Solution
1) Check /^[A-Za-z]:[\\/]/ or startsWith('/') in redactSensitiveDiagnostics before calling path.resolve. 2) Track hasLocalEvo on WorkspaceContext and route uninitialized workspace searches through getGlobalFallbackContexts(true) with [GLOBAL] badge, 0.85 score multiplier, and 0 local budget/tools. 3) Compute concept overlap via buildQueryConceptGroups/evaluateConceptOverlap and gate Action Required on !h.low_overlap. 4) Reject project-prefixed IDs in ~/.evo/global and add continue-on-error to GitHub Pages configure-pages.
