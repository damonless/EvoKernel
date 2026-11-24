---
id: antigravity-hook-subagent-and-stop-transcript-false-positives
title: "Antigravity subagent reminder spam and Stop transcript false-positive fix"
l0_summary: "Subagent SYSTEM_MESSAGE with sender= caused hook spam and raw Stop transcript scanning caused false blocks."
created_commit: "27816aa"
created_branch: "main"
target_symbols: ["scripts/antigravity_hook.mjs#analyzeTranscriptSteps","src/cli/hook.ts#readTranscriptTail"]
ast_fingerprints: {"scripts/antigravity_hook.mjs#analyzeTranscriptSteps":{"symbol":"scripts/antigravity_hook.mjs#analyzeTranscriptSteps","file_path":"scripts/antigravity_hook.mjs","file":"scripts/antigravity_hook.mjs","kind":"function","start_line":1370,"end_line":1711,"signature":"function analyzeTranscriptSteps(steps, convState)","ast_hash":"78f1a8e52b929245"},"src/cli/hook.ts#readTranscriptTail":{"symbol":"src/cli/hook.ts#readTranscriptTail","file_path":"src/cli/hook.ts","file":"src/cli/hook.ts","kind":"function","start_line":179,"end_line":245,"signature":"export function readTranscriptTail(transcriptPath: unknown): string","ast_hash":"e5a85a09917e20ff"}}
tags: []
origin: "evolved"
review_status: "pending"
created_at: "2026-11-24T18:20:22.779Z"
updated_at: "2026-11-24T18:20:22.779Z"
---

## Symptom
Antigravity hook injected evolution reminders on every subagent step and Claude/Codex Stop hook falsely blocked normal completions.

## Root Cause
analyzeTranscriptSteps treated subagent initial SYSTEM_MESSAGE containing sender= as latestAuditStepIndex and readTranscriptTail scanned raw JSONL including assistant/EvoKernel text with broad regex words.

## Solution
Suppress reminders in subagent transcripts (0 USER_INPUT), switch cooldown to user-turn count, and extract only latest role:user text in readTranscriptTail while tightening USER_CORRECTION_PATTERNS.
