---
id: url-userinfo-spoofing-and-powershell-subexpression-guard
title: "URL Userinfo Spoofing & PowerShell Subexpression Execution Remediation"
l0_summary: "Loopback URL validation rejects WHATWG userinfo (@) spoofing and PowerShell single-quoted escaping blocks $() subexpression execution."
created_commit: "ae1725a"
created_branch: "main"
target_symbols: ["src/cli/ui.ts#isValidLocalHttpUrl","src/cli/ui.ts#launchDefaultBrowser"]
ast_fingerprints: {"src/cli/ui.ts#isValidLocalHttpUrl":{"symbol":"src/cli/ui.ts#isValidLocalHttpUrl","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":400,"end_line":411,"signature":"export function isValidLocalHttpUrl(rawUrl: string): boolean","ast_hash":"e3418e60fd7541dd"},"src/cli/ui.ts#launchDefaultBrowser":{"symbol":"src/cli/ui.ts#launchDefaultBrowser","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":413,"end_line":437,"signature":"export function launchDefaultBrowser(url: string): boolean","ast_hash":"da6a32e738aa8511"}}
tags: ["security","url-validation","powershell","cli-ui"]
origin: "evolved"
created_at: "2026-11-05T09:37:27.809Z"
updated_at: "2026-11-06T05:58:04.684Z"
---

## Symptom
launchDefaultBrowser and launchNativeDesktopWindow accept userinfo spoofed URLs like http://127.0.0.1:secret@evil.com/, and URLs with $(...) query parameters trigger arbitrary command execution in PowerShell.

## Root Cause
Prefix-based loopback checks (.startsWith('http://127.0.0.1:')) do not validate the parsed URL hostname when userinfo is present (e.g. http://127.0.0.1:secret@evil.com/). On Windows, embedding URLs into PowerShell double quotes causes $() subexpressions in query parameters to execute arbitrary commands.

## Solution
Use WHATWG new URL() in isValidLocalHttpUrl to verify protocol ('http:'), hostname ('127.0.0.1' or 'localhost'), absence of username/password, and finite numeric port. For Windows PowerShell launchers, escape single quotes via url.replace(/'/g, \"''\") and enclose within single quotes ('...').
