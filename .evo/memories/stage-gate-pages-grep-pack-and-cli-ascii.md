---
id: stage-gate-pages-grep-pack-and-cli-ascii
title: "Stage-Gate Hardening: pages.yml -rnIE, Positive npm pack Gate, Full CLI/Hook --ascii, -v Interception & boot-mcp Workspace Safety"
l0_summary: "Fix pages.yml PNG grep (-rnIE), positive pkg.files + bounded CI pack JSON, CLI/pre-commit --ascii, -v routing, and boot-mcp --workspace mcp."
created_commit: "540dc0f"
created_branch: "main"
target_symbols: ["src/cli/term.ts#toAsciiOutput","src/cli/hook.ts#handlePreCommit","src/cli/index.ts#runCli","src/cli/ui.ts#runUiCli","src/cli/optimize.ts#renderOptimizeHelp"]
ast_fingerprints: {"src/cli/term.ts#toAsciiOutput":{"symbol":"src/cli/term.ts#toAsciiOutput","file_path":"src/cli/term.ts","file":"src/cli/term.ts","kind":"function","start_line":50,"end_line":112,"signature":"export function toAsciiOutput(str: string): string","ast_hash":"dd07b0bf7ba30018"},"src/cli/hook.ts#handlePreCommit":{"symbol":"src/cli/hook.ts#handlePreCommit","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":1182,"end_line":1292,"signature":"export function handlePreCommit(","ast_hash":"53858e065d569df1"},"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":1348,"end_line":2403,"signature":"export function runCli(argv: string[]): void","ast_hash":"58647406e0773a04"},"src/cli/ui.ts#runUiCli":{"symbol":"src/cli/ui.ts#runUiCli","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":1929,"end_line":2018,"signature":"export async function runUiCli(workspaceRoot: string, args: string[]): Promise<void>","ast_hash":"5f161102282387da"},"src/cli/optimize.ts#renderOptimizeHelp":{"symbol":"src/cli/optimize.ts#renderOptimizeHelp","file_path":"src/cli/optimize.ts","file":"src/cli/optimize.ts","kind":"function","start_line":170,"end_line":202,"signature":"export function renderOptimizeHelp(): string","ast_hash":"bc13369bf1a0734e"}}
tags: ["ci","packaging","cli","ascii","pages","hooks","mcp-bootstrap"]
origin: "evolved"
supersedes_id: "stage-gate-pages-grep-pack-and-cli-ascii"
review_status: "pending"
created_at: "2026-11-11T07:11:12.338Z"
updated_at: "2026-11-11T08:48:10.550Z"
---

## Symptom
1) pages.yml grep -rnE matched PNG deflate bytes in public/assets/workbench-showcase.png. 2) package.json#files used unsupported !-negations and ci.yml JSON.parse lacked upper ] bound. 3) Six CLI surfaces and evo hook pre-commit bypassed formatTerminalOutput on --ascii, toAsciiOutput mangled [置信度: HIGH (≥80%)] into [: HIGH (80%)] and shifted box right borders, evo --ascii -v / evo optimize -v missed version interception, evo ui --host 0.0.0.0 ignored non-loopback hosts, and boot-mcp.mjs stripped mcp from --workspace mcp.

## Root Cause
GNU grep -rnE scans binary streams without -I; npm-packlist ignores !-negations inside package.json#files; CLI/pre-commit handlers logged raw Unicode strings and toAsciiOutput lacked Confidence/>=/<=/!= mappings and box-width re-padding; runCli only checked args.includes(--version) or single-arg -v; runUiCli skipped loopback check on --host; and boot-mcp filtered all mcp tokens instead of firstPositionalIdx.

## Solution
Use grep -rnIE in pages.yml; replace package.json#files with positive allowlists and bounded [jsonStart, jsonEnd+1] ci.yml validator in RUNNER_TEMP; route all CLI surfaces + pre-commit/mark-recovery hooks through formatTerminalOutput with [SCAN]/[NEXT]/[CLEAN]/[IDE]/Confidence/>=/<= mappings and box border alignment; scan standalone -v/--version flags in runCli; enforce loopback --host in runUiCli; strip only firstPositionalIdx mcp in boot-mcp.mjs/BOOT_MCP_STUB; and run strict post-edit refresh -> render-promo-assets -> build-pages -> test -> codegraph sync.
