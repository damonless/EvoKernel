---
id: memory-verification-inprocess-stat-caching
title: "In-Process Memory Freshness Stat & Git Path Caching"
l0_summary: "Fast sub-millisecond in-process memory freshness verification via short TTL stat & Git path caching and fast shallow cloning."
created_commit: "09f2d69"
created_branch: "main"
target_symbols: ["src/core/memory.ts:verifyMemoryFreshness","src/core/memory.ts:clearMemoryVerificationCache"]
ast_fingerprints: {"src/core/memory.ts:verifyMemoryFreshness":{"symbol":"src/core/memory.ts:verifyMemoryFreshness","file_path":"src/core/memory/freshness-verifier.ts","file":"src/core/memory/freshness-verifier.ts","kind":"function","start_line":1181,"end_line":1800,"signature":"export function verifyMemoryFreshness(","ast_hash":"d9f6cb5403cc12d7"},"src/core/memory.ts:clearMemoryVerificationCache":{"symbol":"src/core/memory.ts:clearMemoryVerificationCache","file_path":"src/core/memory/freshness-verifier.ts","file":"src/core/memory/freshness-verifier.ts","kind":"function","start_line":682,"end_line":687,"signature":"export function clearMemoryVerificationCache(): void","ast_hash":"35a5a45e33051628"}}
tags: []
origin: "evolved"
created_at: "2026-11-02T03:50:28.090Z"
updated_at: "2026-11-24T06:56:54.031Z"
---

## Symptom
Warm verification across 11 episodic memories exceeded 15ms target.

## Root Cause
Repeated fs.statSync calls on target files and deep JSON serialization during verification loops blew the <5ms warm budget.

## Solution
Cache file stats with 500ms TTL, cache Git paths, and shallow-clone MemoryVerificationReport objects.
