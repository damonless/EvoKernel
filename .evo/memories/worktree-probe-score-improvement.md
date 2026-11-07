---
id: worktree-probe-score-improvement
title: "Worktree Probe Improvement On Failing Baseline"
l0_summary: "Worktree probe score evaluation when baseline probe failed"
created_commit: "02e7257"
created_branch: "main"
target_symbols: ["probeCandidateInWorktree","runOptimizationCycle"]
ast_fingerprints: {"probeCandidateInWorktree":{"symbol":"probeCandidateInWorktree","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":1394,"end_line":1810,"signature":"export function probeCandidateInWorktree(","ast_hash":"3eade7e7b62641c1"},"runOptimizationCycle":{"symbol":"runOptimizationCycle","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":1855,"end_line":2204,"signature":"export function runOptimizationCycle(","ast_hash":"6e46aaf9866ffdab"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T09:47:58.578Z"
updated_at: "2026-11-07T06:43:38.239Z"
---

## Symptom
Candidates improving test pass score on a failing baseline were rejected as KEEP_BASE

## Root Cause
Candidate probe passed was tied to exit code 0 rather than checking score improvement against baseScore

## Solution
Allow candidates with score > baseScore to pass and be eligible for adoption and composition even if exitCode != 0
