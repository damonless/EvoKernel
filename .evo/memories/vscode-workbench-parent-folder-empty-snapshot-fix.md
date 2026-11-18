---
id: vscode-workbench-parent-folder-empty-snapshot-fix
title: "VS Code Workbench Empty Snapshot When Parent Umbrella Folder Is Opened"
l0_summary: "Empty Workbench in umbrella folder -> resolveActiveWorkspaceRoot returned parent -> walk doc URI & scan child .evo."
created_commit: "18dae2b"
created_branch: "main"
target_symbols: ["src/ide/vscode-extension.ts#resolveActiveWorkspaceRoot","src/ide/vscode-extension.ts#activate"]
ast_fingerprints: {"src/ide/vscode-extension.ts#resolveActiveWorkspaceRoot":{"symbol":"src/ide/vscode-extension.ts#resolveActiveWorkspaceRoot","file_path":"src/ide/vscode-extension.ts","file":"src/ide/vscode-extension.ts","kind":"function","start_line":280,"end_line":338,"signature":"export function resolveActiveWorkspaceRoot(vscode: any, fallbackCwd: string = process.cwd()): string","ast_hash":"5fb76e40cce4dd44"},"src/ide/vscode-extension.ts#activate":{"symbol":"src/ide/vscode-extension.ts#activate","file_path":"src/ide/vscode-extension.ts","file":"src/ide/vscode-extension.ts","kind":"function","start_line":1215,"end_line":1375,"signature":"export async function activate(","ast_hash":"3afbeb230dbce868"}}
tags: ["vscode","workbench","workspace","umbrella","git-diff"]
origin: "evolved"
created_at: "2026-11-14T04:48:17.319Z"
updated_at: "2026-11-18T17:14:26.676Z"
---

## Symptom
Opening parent folder (e.g. Documents/antigravity) in VS Code while viewing a child repo file or git working-tree diff tab shows 0 capabilities and baseline score 59 in EvoKernel Workbench.

## Root Cause
resolveActiveWorkspaceRoot did not run findNearestEvoWorkspace on activeTextEditor document path/git-query path, and returned getWorkspaceFolder(activeDocUri) (the uninitialized parent folder) at line 177 before reaching child .evo directory scanning; activate also lacked activeTextEditor/workspaceFolders change listeners.

## Solution
Extract file/git-diff fsPath from activeTextEditor to walk upward via findNearestEvoWorkspace first, scan depth 1-2 child directories with hasValidEvoStructure before falling back to raw folderPath, and subscribe to onDidChangeActiveTextEditor and onDidChangeWorkspaceFolders in activate.
