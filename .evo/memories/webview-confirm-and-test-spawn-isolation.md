---
id: webview-confirm-and-test-spawn-isolation
title: "When building Workbench UI & lifecycle actions -> Avoid confirm(), naive plural stripping, and raw file overwrite -> Use Undo Toast, singularKind(), and frontmatter-preserving saves"
l0_summary: "Webview & Workbench actions -> confirm(), 'memorie' typo, and frontmatter wipe -> use Undo Toast, singularKind, and frontmatter merge"
created_commit: "afda80b"
created_branch: "main"
target_symbols: ["src/templates/ui-client.ts#renderUiClientHtml","src/cli/ui.ts#isTestEnvironment","src/core/storage.ts#EvoStorage"]
ast_fingerprints: {"src/templates/ui-client.ts#renderUiClientHtml":{"symbol":"src/templates/ui-client.ts#renderUiClientHtml","file_path":"src/templates/ui-client.ts","file":"src/templates/ui-client.ts","kind":"function","start_line":7,"end_line":4246,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"de9c5e8612edcdcb"},"src/cli/ui.ts#isTestEnvironment":{"symbol":"src/cli/ui.ts#isTestEnvironment","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":383,"end_line":385,"signature":"export function isTestEnvironment(): boolean","ast_hash":"5a23e9bafcc83a59"},"src/core/storage.ts#EvoStorage":{"symbol":"src/core/storage.ts#EvoStorage","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"class","start_line":215,"end_line":1211,"signature":"export class EvoStorage","ast_hash":"39872afc8afd5fe9"}}
tags: ["webview","ui","governance","test-isolation","csp","flexbox"]
origin: "evolved"
created_at: "2026-11-06T05:56:44.178Z"
updated_at: "2026-11-10T17:54:30.946Z"
---

## Symptom
Clicking Archive in VS Code Webview fails silently; Inspector Approve/Pause/Save on Memories returns HTTP 400 Invalid kind 'memorie' or renders blank button labels; inline editor Save wipes YAML frontmatter; Undo on multi-file skills loses sibling scripts; running node:test spawns external IDEs.

## Root Cause
1) Electron/VS Code Webview sandboxes block window.confirm() and silently return false. 2) Naive kind.replace(/s$/, '') turns 'memories' into 'memorie', failing backend kind validation with HTTP 400. 3) Sending body-only edits from the inline editor to update-content overwrites the raw markdown file and strips YAML frontmatter. 4) Archiving only SKILL.md or run.mjs drops sibling subdirectories/files on restore, and rebind-memory-ast without existence verification masks deleted symbols as VERIFIED. 5) Unconditional GUI spawns and home-dir extension mounts during node:test leak host side-effects.

## Solution
1) Use immediate archive + Undo Toast (restore-item) with extra_files recursive directory snapshotting and preserved review_status/enabled flags. 2) Always normalize plural kind via singularKind(kind) ('memories' -> 'memory') and verify all i18n dictionary keys against template references. 3) In update-content, merge body-only edits into existing Rule/Skill/Memory objects to preserve YAML frontmatter, and reject rebind-memory-ast with 400 ERR_MISSING_AST_SYMBOL when target symbols are missing. 4) Filter enabled !== false across recall, token budget, Gate 4 bucket quotas, pre/post hooks, and hotspot shielding, and guard GUI/home mutations with isTestEnvironment().
