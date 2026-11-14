---
id: action-update-content-path-traversal-403
title: "Eager sanitizeId masks update-content path traversal as 404 instead of 403"
l0_summary: "Eager sanitizeId in update-content masks path traversal attempts as 404 instead of returning 403 Forbidden."
created_commit: "7293568"
created_branch: "main"
target_symbols: ["src/cli/ui.ts#startUiServer","src/core/storage.ts#sanitizeId"]
ast_fingerprints: {"src/cli/ui.ts#startUiServer":{"symbol":"src/cli/ui.ts#startUiServer","file_path":"src/cli/ui.ts","file":"src/cli/ui.ts","kind":"function","start_line":856,"end_line":1904,"signature":"export async function startUiServer(","ast_hash":"a07809d52b2def9e"},"src/core/storage.ts#sanitizeId":{"symbol":"src/core/storage.ts#sanitizeId","file_path":"src/core/storage.ts","file":"src/core/storage.ts","kind":"function","start_line":231,"end_line":237,"signature":"export function sanitizeId(rawId: string): string","ast_hash":"1c9ec53cbe02e6e4"}}
tags: ["ui","api","security","path-traversal"]
origin: "evolved"
created_at: "2026-11-05T08:52:30.589Z"
updated_at: "2026-11-14T03:52:05.536Z"
---

## Symptom
POST /api/action with update-content action returns HTTP 404 Not Found instead of HTTP 403 Forbidden on path traversal attempts like ../../secret.txt.

## Root Cause
In src/cli/ui.ts line 766, cleanId = sanitizeId(rawId) strips ../ characters before isSubpathOf or path traversal validation is performed, causing non-existent sanitized filenames to return 404 rather than 403.

## Solution
Validate rawId for directory traversal ('..' or slashes) or check isSubpathOf before running sanitizeId in case 'update-content' of src/cli/ui.ts.
