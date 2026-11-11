---
id: cli-init-default-ide-mount-and-circular-fix
title: "Fix CLI evo init default IDE mounting and circular self-reference in mountIdeExtensions"
l0_summary: "Fixes CLI evo init default IDE mounting and eliminates circular reference in mountIdeExtensions."
created_commit: "d077ff6"
created_branch: "main"
target_symbols: ["src/cli/index.ts#runCli","src/cli/init.ts#mountIdeExtensions","src/cli/init.ts#runInit"]
ast_fingerprints: {"src/cli/index.ts#runCli":{"symbol":"src/cli/index.ts#runCli","file_path":"src/cli/index.ts","file":"src/cli/index.ts","kind":"function","start_line":1315,"end_line":2362,"signature":"export function runCli(argv: string[]): void","ast_hash":"2f942e80ff6648ae"},"src/cli/init.ts#mountIdeExtensions":{"symbol":"src/cli/init.ts#mountIdeExtensions","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":1291,"end_line":1348,"signature":"export function mountIdeExtensions(","ast_hash":"1b01a7f67947a0b3"},"src/cli/init.ts#runInit":{"symbol":"src/cli/init.ts#runInit","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":933,"end_line":1116,"signature":"export function runInit(","ast_hash":"c3dd895d8e12c109"}}
tags: []
origin: "evolved"
supersedes_id: "cli-init-default-ide-mount-and-circular-fix"
created_at: "2026-11-05T08:24:47.225Z"
updated_at: "2026-11-11T08:12:03.226Z"
---

## Symptom
Running 'evo init' from CLI skipped IDE extension auto-mounting contrary to PROJECT.md contract, and mountIdeExtensions({ noIde: true }) returned circular self-reference (res.mounts === res).

## Root Cause
In src/cli/index.ts:730, args.includes('--install-ide') evaluated to false when omitted instead of undefined, silencing opts.installIde ?? (!opts.noIde) in src/cli/init.ts:779. In src/cli/init.ts:995, Object.assign(empty, { mounts: empty, totalMounted: 0 }) mutated empty in-place, creating a circular self-reference.

## Solution
Changed src/cli/index.ts:730 to args.includes('--install-ide') ? true : undefined. Changed src/cli/init.ts:995 to Object.assign([], { mounts: empty, totalMounted: 0 }).
