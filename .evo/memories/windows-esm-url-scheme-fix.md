---
id: windows-esm-url-scheme-fix
title: "Windows ESM Dynamic Import pathToFileURL Resolution"
l0_summary: "Wrap dynamic imports in pathToFileURL().href on Windows to avoid ERR_UNSUPPORTED_ESM_URL_SCHEME"
created_commit: "ccc1e92"
created_branch: "main"
target_symbols: ["startUiServer","detectChromiumBrowser"]
ast_fingerprints: {"startUiServer":{"symbol":"startUiServer","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":443,"end_line":912,"signature":"export async function startUiServer(","ast_hash":"92274e47d96418d6"},"detectChromiumBrowser":{"symbol":"detectChromiumBrowser","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":301,"end_line":373,"signature":"export function detectChromiumBrowser(): string | null","ast_hash":"e184ef6d136ad27a"}}
tags: []
origin: "evolved"
created_at: "2026-11-05T06:02:25.999Z"
updated_at: "2026-11-05T06:02:25.999Z"
---

## Symptom
ERR_UNSUPPORTED_ESM_URL_SCHEME received protocol c: when dynamically importing compiled dist files on Windows.

## Root Cause
Node.js ESM dynamic import fails on Windows when passed absolute drive-letter paths because C: is parsed as an invalid URL scheme instead of a file URL.

## Solution
Import pathToFileURL from node:url and use pathToFileURL(filePath).href for dynamic imports.
