---
id: webview-confirm-and-test-spawn-isolation
title: "When building IDE Webviews or UI tests -> Avoid window.confirm and unguarded GUI spawns -> Use Undo Toast and isTestEnvironment()"
l0_summary: "IDE Webview Archive or UI tests -> confirm() fails and open-editor spawns IDEs -> use Undo Toast and isTestEnvironment() guard"
created_commit: "ae1725a"
created_branch: "main"
target_symbols: ["src/templates/ui-client.ts#renderUiClientHtml","src/cli/ui.ts#isTestEnvironment"]
ast_fingerprints: {"src/templates/ui-client.ts#renderUiClientHtml":{"symbol":"src/templates/ui-client.ts#renderUiClientHtml","file_path":"src/templates/ui-client.ts","file":"src/templates/ui-client.ts","kind":"function","start_line":7,"end_line":3975,"signature":"export function renderUiClientHtml(snapshot: any, options: UiRenderOptions = {}): string","ast_hash":"74cad27c1797065f"},"src/cli/ui.ts#isTestEnvironment":{"symbol":"src/cli/ui.ts#isTestEnvironment","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":268,"end_line":270,"signature":"export function isTestEnvironment(): boolean","ast_hash":"5a23e9bafcc83a59"}}
tags: ["webview","ui","test-isolation","csp","flexbox"]
origin: "evolved"
created_at: "2026-11-06T05:56:44.178Z"
updated_at: "2026-11-06T05:56:44.178Z"
---

## Symptom
Clicking Archive in VS Code/Cursor Webview does nothing; running npm test pops up external editor windows and mutates ~/.vscode/extensions; Test 5 CSP inline-event scanner fails when JS objects use .onClick = properties.

## Root Cause
1) Electron/VS Code Webview sandboxes block native modal dialogs (window.confirm, window.alert, window.prompt) and silently return false, breaking destructive actions like Archive. 2) Property names matching /\bon[a-z]+\s*=/i (such as actionSpec.onClick = ...) trigger strict CSP inline-event attribute scanners. 3) Unconditional child_process.spawn in launchEditorAtLocation and home-dir mounting in mountIdeExtensions leak GUI windows and ~/.vscode/extensions mutations during node:test runs.

## Solution
1) Replace window.confirm() with immediate execution plus an interactive Undo Toast (archiveAndOfferUndo + restore-item) using non-on* callback keys (actionSpec.run). 2) Guard launchEditorAtLocation, launchDefaultBrowser, launchNativeDesktopWindow, and mountIdeExtensions with NODE_TEST_CONTEXT / EVO_TEST_MODE checks. 3) Enforce min-width: 0 and text-overflow: ellipsis on inner flex children (.ws-path, .ast-anchor-file, .ast-anchor-symbol).
