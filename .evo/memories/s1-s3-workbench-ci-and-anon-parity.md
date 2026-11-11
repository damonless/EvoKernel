---
id: s1-s3-workbench-ci-and-anon-parity
title: "S1-S3 Hardening: Gemini Init Dedup, Real .evo/ Token Measurement, CLI ASCII/No-Color & Static Snapshot Parity"
l0_summary: "Fix Gemini settings skip bug, real .evo/ token measurement (1,916 Meta-MCP), CLI --ascii/--no-color, and static UI parity."
created_commit: "d077ff6"
created_branch: "main"
target_symbols: ["src/cli/harness.ts#hasStaleNpxMcpEntry","src/cli/init.ts#runInit","src/cli/score.ts#buildScoreReport","src/cli/term.ts#formatTerminalOutput","src/templates/ui-client.ts#renderUiClientHtml"]
ast_fingerprints: {"src/cli/harness.ts#hasStaleNpxMcpEntry":{"symbol":"src/cli/harness.ts#hasStaleNpxMcpEntry","file_path":"src/cli/harness.ts","file":"src/cli/harness.ts","kind":"function","start_line":169,"end_line":255,"signature":"export function hasStaleNpxMcpEntry(entry: unknown, workspaceRoot?: string): boolean","ast_hash":"db5b78663e57c126"},"src/cli/ui.ts#scrubAnonTextValue":{"symbol":"src/cli/ui.ts#scrubAnonTextValue","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":50,"end_line":69,"signature":"function scrubAnonTextValue(val: string, ws: string, relativePathReplacements?: Array<[RegExp, string]>): string","ast_hash":"1ae873b626e5cd01"},"src/core/lexicon.ts#compileLexiconConfig":{"symbol":"src/core/lexicon.ts#compileLexiconConfig","file_path":"src/core/lexicon.ts","file":"src/core/lexicon.ts","kind":"function","start_line":99,"end_line":222,"signature":"export function compileLexiconConfig(config?: DomainLexiconConfig): CompiledLexicon","ast_hash":"d2ca91ec12001903"},"src/templates/ui-client.ts#renderUiClientHtml":{"symbol":"src/templates/ui-client.ts#renderUiClientHtml","file_path":"src/templates/ui-client.ts","file":"src/templates/ui-client.ts","kind":"function","start_line":7,"end_line":5769,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"f5a92b27b9f5d033"}}
tags: ["ci","anon","lexicon","telemetry","workbench"]
origin: "evolved"
created_at: "2026-11-11T02:18:54.048Z"
updated_at: "2026-11-11T08:12:04.185Z"
---

## Symptom
1. Filtering `'gemini'` out of `targets` in `runInit` when `AGENTS.md` is present skips `GeminiAdapter.install` completely, leaving `.gemini/settings.json` unregistered; global stale `_npx` entries remain unhealed.
2. `buildScoreReport` uses hardcoded capability multipliers (`650/450/400/350`) while `visualizer.ts` (`~1,084`) and `context-tax-benchmark.mjs` (`1,916`) diverge on the 5-Tool Meta-MCP constant.
3. `isColorEnabled` and `isAsciiMode` have zero callers, leaking `\x1b[` on `--no-color`/non-TTY pipes and Unicode/emojis on `--ascii`.
4. Static Workbench exports display green `LIVE` instead of `STATIC SNAPSHOT`, and `375px` mobile filter toolbars squish pill groups without `flex-shrink: 0`.

## Root Cause
1. `runInit` mutated `targets` before the adapter loop instead of letting `GeminiAdapter.install(..., { skipGeminiMd: true })` skip only `GEMINI.md`, and `healStaleWorkspaceMcpConfigs` only scanned workspace-local MCP files.
2. `score.ts`, `visualizer.ts`, and `context-tax-benchmark.mjs` lacked a shared `META_MCP_5_TOOLS_TOKENS` SSOT constant (`1916`), and `score.ts` multiplied capability counts instead of measuring on-disk `.evo/` files.
3. CLI output formatters printed raw ANSI/Unicode strings directly instead of routing through `formatTerminalOutput(str, { color, ascii })`.
4. `renderUiClientHtml` hardcoded `LIVE` on `#server-status-text` even when `isExport === true`, and `.filter-toolbar` lacked `> * { flex-shrink: 0; }` under `@media (max-width: 768px)`.

## Solution
1. Keep `'gemini'` in `targets` so `GeminiAdapter.install` writes `.gemini/settings.json` + `.gemini/commands/*` while skipping `GEMINI.md`; heal stale `_npx` entries across all 6 global host configs (`~/.claude.json`, `~/.cursor/mcp.json`, `~/.gemini/settings.json`, `~/.gemini/antigravity/mcp_config.json`, `~/.codex/config.toml`, `~/.codeium/windsurf/mcp_config.json`); scope duplicate root seed warnings specifically to `AGENTS.md` + `GEMINI.md`.
2. Export `META_MCP_5_TOOLS_TOKENS = 1916` from `storage.ts`, measure real on-disk `.evo/` capability file tokens in `buildScoreReport`, and align `/demo/` with `/` and `README` (`~88.7%` / `89%`).
3. Wire `isColorEnabled`, `isAsciiMode`, and `formatTerminalOutput` across `score`, `doctor` (including verdict lines and `--roi`), `tree`, `stats`, `audit`, `refactor`, and `memory`.
4. Render amber non-pulsing `STATIC SNAPSHOT` / `静态快照` + read-only toast on `isExport === true`, exponential SSE backoff (`1.5s -> 15s`) in live mode, `#bento-recall-7d` in `.left-rail`, `ArrowUp`/`ArrowDown`/`Escape` keyboard handlers, inline stroke SVGs, and `flex-shrink: 0` mobile filter children.
