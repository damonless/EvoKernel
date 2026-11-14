---
id: clean-ci-runner-doctor-probe-and-gemini-stats-fix
title: "Clean CI Runner & Offline Wrapper Hardening: Doctor MCP Probe, .cmd/env Forwarding & Gemini Score Isolation"
l0_summary: "Pass EVO_KERNEL_ROOT & entry.env in doctor probe, resolve ./ .cmd wrappers & npm install guidance, and drop stale ~/.gemini cache."
created_commit: "7293568"
created_branch: "main"
target_symbols: ["src/cli/index.ts#extractLaunchTargetFromEntry","src/cli/index.ts#probeMcpServerStdioSync","src/cli/score.ts#isProjectDirectoryFast","src/cli/score.ts#buildScoreReport"]
ast_fingerprints: {"src/cli/index.ts#extractLaunchTargetFromEntry":{"symbol":"src/cli/index.ts#extractLaunchTargetFromEntry","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":882,"end_line":920,"signature":"function extractLaunchTargetFromEntry(","ast_hash":"ce39f03e759fd0b9"},"src/cli/index.ts#probeMcpServerStdioSync":{"symbol":"src/cli/index.ts#probeMcpServerStdioSync","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":1212,"end_line":1264,"signature":"export function probeMcpServerStdioSync(","ast_hash":"624b4b586c589f0d"},"src/cli/score.ts#isProjectDirectoryFast":{"symbol":"src/cli/score.ts#isProjectDirectoryFast","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":40,"end_line":92,"signature":"export function isProjectDirectoryFast(dir: string): boolean","ast_hash":"60d800360af76241"},"src/cli/score.ts#buildScoreReport":{"symbol":"src/cli/score.ts#buildScoreReport","file_path":"src/cli/score.ts","file":"src/cli/score.ts","kind":"function","start_line":645,"end_line":1002,"signature":"export function buildScoreReport(workspaceRoot: string, options?: ScoreOptions): ScoreReport","ast_hash":"cef66ef545c7f637"}}
tags: ["ci","doctor","mcp-probe","windows-cmd","score","gemini","favicon"]
origin: "evolved"
supersedes_id: "clean-ci-runner-doctor-probe-and-gemini-stats-fix"
review_status: "pending"
created_at: "2026-11-11T08:12:29.700Z"
updated_at: "2026-11-14T03:52:05.686Z"
---

## Symptom
1) Clean CI runners failed Test 67 (0.2.0 !== 0.3.0) & Test 72 (beforeTokens === 0 on .gemini-only workspace). 2) Offline .mcp.json with entry.env or ./wrapper.cmd threw EINVAL / "." error in cmd.exe and truncated npm install guidance. 3) score.js cached empty ~/.gemini for 30s at import time and misclassified ~/.gemini as project.

## Root Cause
1) probeMcpServerStdioSync omitted EVO_KERNEL_ROOT & entry.env, split stderr at line 0, and passed unquoted ./ .cmd paths to cmd.exe; BOOT_MCP_STUB only skipped EVO_KERNEL_ROOT on EVO_FORCE_NPX=1. 2) score.ts ran getHomeGeminiEntries at import time (30s cache) and omitted .gemini/.windsurf/.cline markers plus top-level host config dir exclusions.

## Solution
Forward EVO_KERNEL_ROOT & entry.env in probeMcpServerStdioSync, resolve/quote .cmd/.bat paths via cmd.exe, preserve 2-line stderr & npm install verdict, skip all local candidates on EVO_FORCE_NPX=1, replace _geminiCache with direct fs.existsSync, exclude ~/.{claude,gemini,...} in isProjectDirectoryFast, and add data-URI SVG favicons.
