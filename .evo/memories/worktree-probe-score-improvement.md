---
id: worktree-probe-score-improvement
title: "Worktree Probe Improvement On Failing Baseline"
l0_summary: "Worktree probe score evaluation when baseline probe failed"
created_commit: "0d6f4e2"
created_branch: "main"
target_symbols: ["probeCandidateInWorktree","runOptimizationCycle"]
ast_fingerprints: {"probeCandidateInWorktree":{"symbol":"probeCandidateInWorktree","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":1398,"end_line":1823,"signature":"export function probeCandidateInWorktree(","ast_hash":"9d7307e1b9f0d157"},"runOptimizationCycle":{"symbol":"runOptimizationCycle","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":1868,"end_line":2268,"signature":"export function runOptimizationCycle(","ast_hash":"1ae98ad0d7b97e20"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T09:47:58.578Z"
updated_at: "2026-11-07T19:09:07.628Z"
---

## Symptom
Candidates improving test pass score on a failing baseline were rejected as KEEP_BASE

## Root Cause
Candidate probe passed was tied to exit code 0 rather than checking score improvement against baseScore

## Solution
Allow candidates with score > baseScore to pass and be eligible for adoption and composition even if exitCode != 0
