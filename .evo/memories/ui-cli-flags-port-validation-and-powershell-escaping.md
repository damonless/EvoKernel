---
id: ui-cli-flags-port-validation-and-powershell-escaping
title: "UI CLI Port Validation, PowerShell URL Escaping & Early Help Isolation"
l0_summary: "Port bounds validation [0,65535], URL-encoded UI token, and JSON-quoted PowerShell Start-Process -FilePath escaping for evo ui --open."
created_commit: "d7477e5"
created_branch: "main"
target_symbols: ["src/cli/ui.ts#startUiServer","src/cli/ui.ts#runUiCli","src/cli/index.ts#runCli"]
ast_fingerprints: {"src/cli/ui.ts#startUiServer":{"symbol":"src/cli/ui.ts#startUiServer","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":1478,"end_line":1750,"signature":"export async function startUiServer(","ast_hash":"238201e73e146312"},"src/cli/ui.ts#runUiCli":{"symbol":"src/cli/ui.ts#runUiCli","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":1801,"end_line":1900,"signature":"export async function runUiCli(workspaceRoot: string, args: string[]): Promise<void>","ast_hash":"f274760e29be0b4c"},"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":1484,"end_line":4067,"signature":"export function runCli(argv: string[]): void | Promise<void>","ast_hash":"a48b760c30bc6e6e"}}
tags: ["ui-cli","port-validation","powershell-escaping","cli-help-isolation","s1-s2-hardening"]
origin: "evolved"
created_at: "2026-11-04T20:29:08.709Z"
updated_at: "2026-11-24T18:20:46.640Z"
---

## Symptom
1) evo ui --port=abc or 99999 threw unhandled RangeError ERR_SOCKET_BAD_PORT; 2) evo ui --open on Windows failed with PowerShell AmpersandNotAllowed when URL had & query delimiters; 3) evo uninstall --help mutated workspace before early help interception.

## Root Cause
1) parseInt on invalid/out-of-bounds --port passed NaN/>65535 into net.Server.listen causing unhandled ERR_SOCKET_BAD_PORT; 2) Windows PowerShell -Command concatenates unquoted arguments, so & in URLs triggered AmpersandNotAllowed; 3) CLI subcommand --help without early interception triggered mutating handlers like runUninstall.

## Solution
1) Validate port as integer in [0, 65535] in startUiServer and runUiCli; 2) Escape instance.url with JSON.stringify inside Start-Process -FilePath for Windows --open and encodeURIComponent(token) in URL; 3) Intercept --help/-h and version early in runCli before workspace/global seeding or mutations.
