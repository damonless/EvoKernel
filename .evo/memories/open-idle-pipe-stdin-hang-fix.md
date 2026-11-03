---
id: open-idle-pipe-stdin-hang-fix
title: "Open Idle Pipe Stdin Read Timeout & Guard Fix"
l0_summary: "Resolves synchronous fs.readFileSync(0) hang on non-TTY open idle stdin pipes via async timeout stream."
created_commit: "b1d1afe"
created_branch: "main"
target_symbols: ["src/cli/index.ts#readStdinTextWithTimeout","src/cli/hook.ts#runHook"]
ast_fingerprints: {"src/cli/index.ts#readStdinTextWithTimeout":{"symbol":"src/cli/index.ts#readStdinTextWithTimeout","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":68,"end_line":130,"signature":"export function readStdinTextWithTimeout(","ast_hash":"3979fd585f6bd7e6"},"src/cli/hook.ts#runHook":{"symbol":"src/cli/hook.ts#runHook","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":1142,"end_line":1224,"signature":"export function runHook(","ast_hash":"66477da2304f60a3"}}
tags: []
origin: "evolved"
created_at: "2026-11-01T14:35:36.959Z"
updated_at: "2026-11-03T01:28:01.426Z"
---

## Symptom
Subprocesses (evo hook stop, antigravity_hook.mjs) hang indefinitely when spawned with non-TTY open idle stdin pipe

## Root Cause
Synchronous fs.readFileSync(0, 'utf8') in resolvePayload and readStdinJson blocked indefinitely on open idle pipes with 0 bytes written

## Solution
Replaced blocking pipe read with non-blocking 50ms timeout stream and guarded sync reads to regular files only
