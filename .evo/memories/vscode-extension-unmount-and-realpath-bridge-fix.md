---
id: vscode-extension-unmount-and-realpath-bridge-fix
title: "VS Code IDE Extension Ghost Removal and Symlink Bridge Entry Resolution"
l0_summary: "VS Code extension package.json ENOENT -> runUninstall unmounted global IDE junction -> restrict unmount to opts.unmountIde & use realpath."
created_commit: "7a00f1d"
created_branch: "main"
target_symbols: ["src/cli/init.ts#mountIdeExtensions","src/cli/init.ts#runUninstall","src/cli/init.ts#unmountIdeExtensions"]
ast_fingerprints: {"src/cli/init.ts#mountIdeExtensions":{"symbol":"src/cli/init.ts#mountIdeExtensions","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":2023,"end_line":2080,"signature":"export function mountIdeExtensions(","ast_hash":"1b01a7f67947a0b3"},"src/cli/init.ts#runUninstall":{"symbol":"src/cli/init.ts#runUninstall","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":2174,"end_line":2382,"signature":"export function runUninstall(","ast_hash":"4ccc396b0b236e67"},"src/cli/init.ts#unmountIdeExtensions":{"symbol":"src/cli/init.ts#unmountIdeExtensions","file_path":"src/cli/init.ts","file":"src/cli/init.ts","kind":"function","start_line":2082,"end_line":2122,"signature":"export function unmountIdeExtensions(","ast_hash":"2e2bdb8c2708fea0"}}
tags: ["vscode","extension","junction","ide","uninstall"]
origin: "evolved"
created_at: "2026-11-11T17:58:30.471Z"
updated_at: "2026-11-24T18:25:45.112Z"
---

## Symptom
VS Code shows error: 无法读取文件 package.json (无法解析不存在的文件 damonless.evo-kernel-cockpit) and 无可用的自述文件.

## Root Cause
runUninstall unconditionally called unmountIdeExtensions, removing ~/.vscode/extensions/damonless.evo-kernel-cockpit on host while VS Code extensions.json / .obsolete retained stale state; ide-extension/index.js also lacked realpathSync.native(__dirname) and bundled runtime/dist fallback for ephemeral npx cache installs, and package.json used onStartupFinished.

## Solution
Added extensions.json sync/prune and .obsolete cleanup in init.ts, restricted runUninstall IDE unmounting behind --unmount-ide, wrapped realpathSync.native + bundled runtime/dist fallback in ide-extension/index.js, removed onStartupFinished, added README.md, re-mounted IDE extensions, and instructed window reload.
