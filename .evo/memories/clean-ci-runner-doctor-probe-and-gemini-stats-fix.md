---
id: clean-ci-runner-doctor-probe-and-gemini-stats-fix
title: "Clean CI Runner Isolation: Offline Doctor MCP Probe & Multi-Harness Project Detection"
l0_summary: "Pass EVO_KERNEL_ROOT in doctor MCP probe to avoid stale npm fallback and recognize .gemini/.windsurf/.cline in isProjectDirectoryFast."
created_commit: "d077ff6"
created_branch: "main"
target_symbols: ["src/cli/index.ts#probeMcpServerStdioSync","src/cli/score.ts#isProjectDirectoryFast","src/cli/score.ts#buildScoreReport"]
ast_fingerprints: {"src/cli/index.ts#probeMcpServerStdioSync":{"symbol":"src/cli/index.ts#probeMcpServerStdioSync","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":1168,"end_line":1219,"signature":"export function probeMcpServerStdioSync(","ast_hash":"85c50ba182b77b3b"},"src/cli/score.ts#isProjectDirectoryFast":{"symbol":"src/cli/score.ts#isProjectDirectoryFast","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":58,"end_line":108,"signature":"export function isProjectDirectoryFast(dir: string): boolean","ast_hash":"0b6628bd407a8d21"},"src/cli/score.ts#buildScoreReport":{"symbol":"src/cli/score.ts#buildScoreReport","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":662,"end_line":1007,"signature":"export function buildScoreReport(workspaceRoot: string, options?: ScoreOptions): ScoreReport","ast_hash":"5cdd70d143a15b45"}}
tags: ["ci","doctor","mcp-probe","score","gemini","isolation"]
origin: "evolved"
review_status: "pending"
created_at: "2026-11-11T08:12:29.700Z"
updated_at: "2026-11-11T08:12:29.700Z"
---

## Symptom
On clean GitHub Actions runners (ubuntu-latest and windows-latest) without ~/.gemini host plugins or global rule files, Test 67 failed with serverVersion 0.2.0 !== 0.3.0 during evo doctor live MCP stdio probe, and Test 72 failed with buildEvoStatsJson beforeTokens === 0 when only .gemini/settings.json existed.

## Root Cause
1) BOOT_MCP_STUB fell back to npx evo-kernel from npm registry in standalone temp workspaces without ~/.gemini/config/plugins/evo-kernel because probeMcpServerStdioSync did not pass EVO_KERNEL_ROOT and BOOT_MCP_STUB lacked EVO_KERNEL_ROOT lookup. 2) isProjectDirectoryFast omitted .gemini, .codex, .windsurf, .cline, .roo, .vscode, opencode.json, and mcp_config.json, misclassifying Gemini-only workspaces as global mode (which skipped workspace MCP configs while locally masking the bug via ~/.gemini/GEMINI.md).

## Solution
Pass EVO_KERNEL_ROOT from probeMcpServerStdioSync and honor EVO_KERNEL_ROOT in BOOT_MCP_STUB after workspace node_modules checks; include all 10-harness MCP/rule markers in isProjectDirectoryFast and guard global rule file measurement in buildScoreReport when includeGlobal is false.
