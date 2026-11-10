---
id: node-strip-types-parameter-property
title: "TypeScript parameter property not supported in Node strip-only mode"
l0_summary: "Avoid parameter properties in TypeScript constructors when compiling with node:module.stripTypeScriptTypes"
created_commit: "afda80b"
created_branch: "main"
target_symbols: ["scripts/build.mjs","src/tests/score-and-ui.test.ts"]
ast_fingerprints: {"scripts/build.mjs":{"symbol":"scripts/build.mjs","file_path":"scripts/build.mjs","file":"scripts/build.mjs","kind":"file","start_line":1,"end_line":226,"signature":"file scripts/build.mjs (226 lines)","ast_hash":"40a1d0fd344aaa35"},"src/tests/score-and-ui.test.ts":{"symbol":"src/tests/score-and-ui.test.ts","file_path":"src/tests/score-and-ui.test.ts","file":"src/tests/score-and-ui.test.ts","kind":"file","start_line":1,"end_line":2113,"signature":"file src/tests/score-and-ui.test.ts (2113 lines)","ast_hash":"396fd20cc5194cbf"}}
tags: []
origin: "evolved"
created_at: "2026-11-05T09:01:04.321Z"
updated_at: "2026-11-10T17:54:30.658Z"
---

## Symptom
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode at parseTypeScript

## Root Cause
Native Node.js type-stripping (node:module.stripTypeScriptTypes) only strips type annotations; constructor parameter properties require code emission (this.prop = prop) which strip-only mode rejects.

## Solution
Explicitly declare class properties and assign them inside the constructor body instead of using public/private parameter properties.
