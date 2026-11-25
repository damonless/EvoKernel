---
id: stage-gate-pages-grep-pack-and-cli-ascii
title: "Stage-Gate Hardening: pages.yml -rnIE, Positive npm pack Gate, Full CLI/Hook --ascii, -v Interception & boot-mcp Workspace Safety"
l0_summary: "Fix pages.yml PNG grep (-rnIE), positive pkg.files + bounded CI pack JSON, CLI/pre-commit --ascii, -v routing, and boot-mcp --workspace mcp."
created_commit: "a703e18"
created_branch: "main"
target_symbols: ["src/cli/term.ts#toAsciiOutput","src/cli/hook.ts#handlePreCommit","src/cli/index.ts#runCli","src/cli/ui.ts#runUiCli"]
ast_fingerprints: {"src/cli/term.ts#toAsciiOutput":{"symbol":"src/cli/term.ts#toAsciiOutput","file_path":"src/cli/term.ts","file":"src/cli/term.ts","kind":"function","start_line":50,"end_line":115,"signature":"export function toAsciiOutput(str: string): string","ast_hash":"f53f1c5fd79248a4"},"src/cli/hook.ts#handlePreCommit":{"symbol":"src/cli/hook.ts#handlePreCommit","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":1347,"end_line":1494,"signature":"export function handlePreCommit(","ast_hash":"3bb4c70167f0f043"},"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":1615,"end_line":4433,"signature":"export function runCli(argv: string[]): void | Promise<void>","ast_hash":"6ade6e572c576f6f"},"src/cli/ui.ts#runUiCli":{"symbol":"src/cli/ui.ts#runUiCli","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":1814,"end_line":1913,"signature":"export async function runUiCli(workspaceRoot: string, args: string[]): Promise<void>","ast_hash":"f274760e29be0b4c"}}
tags: ["ci","packaging","cli","ascii","pages","hooks","mcp-bootstrap"]
origin: "evolved"
created_at: "2026-11-11T07:11:12.338Z"
updated_at: "2026-11-25T07:25:08.159Z"
---

## Symptom
1) pages.yml grep -rnE matched PNG deflate bytes in public/assets/workbench-showcase.png. 2) package.json#files used unsupported !-negations and ci.yml JSON.parse lacked upper ] bound. 3) Six CLI surfaces and evo hook pre-commit bypassed formatTerminalOutput on --ascii, toAsciiOutput mangled [置信度: HIGH (≥80%)] into [: HIGH (80%)] and shifted box right borders, evo --ascii -v / evo optimize -v missed version interception, evo ui --host 0.0.0.0 ignored non-loopback hosts, and boot-mcp.mjs stripped mcp from --workspace mcp.

## Root Cause
GNU grep -rnE scans binary streams without -I; npm-packlist ignores !-negations inside package.json#files; CLI/pre-commit handlers logged raw Unicode strings and toAsciiOutput lacked Confidence/>=/<=/!= mappings and box-width re-padding; runCli only checked args.includes(--version) or single-arg -v; runUiCli skipped loopback check on --host; and boot-mcp filtered all mcp tokens instead of firstPositionalIdx.

## Solution
Use grep -rnIE in pages.yml; replace package.json#files with positive allowlists and bounded [jsonStart, jsonEnd+1] ci.yml validator in RUNNER_TEMP; route all CLI surfaces + pre-commit/mark-recovery hooks through formatTerminalOutput with [SCAN]/[NEXT]/[CLEAN]/[IDE]/Confidence/>=/<= mappings and box border alignment; scan standalone -v/--version flags in runCli; enforce loopback --host in runUiCli; strip only firstPositionalIdx mcp in boot-mcp.mjs/BOOT_MCP_STUB; and run strict post-edit refresh -> render-promo-assets -> build-pages -> test -> codegraph sync.
