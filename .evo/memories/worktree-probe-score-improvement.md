---
id: worktree-probe-score-improvement
title: "Worktree Probe Improvement On Failing Baseline"
l0_summary: "Worktree probe score evaluation when baseline probe failed"
created_commit: "765dd5e"
created_branch: "main"
target_symbols: ["probeCandidateInWorktree","runOptimizationCycle"]
ast_fingerprints: {"probeCandidateInWorktree":{"symbol":"probeCandidateInWorktree","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":1586,"end_line":2051,"signature":"export function probeCandidateInWorktree(","ast_hash":"c01d70d793518e85"},"runOptimizationCycle":{"symbol":"runOptimizationCycle","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":2096,"end_line":2532,"signature":"export function runOptimizationCycle(","ast_hash":"32cd097ec2c2a9a4"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T09:47:58.578Z"
updated_at: "2026-11-10T17:22:55.720Z"
---

## Symptom
Candidates improving test pass score on a failing baseline were rejected as KEEP_BASE

## Root Cause
Candidate probe passed was tied to exit code 0 rather than checking score improvement against baseScore

## Solution
Allow candidates with score > baseScore to pass and be eligible for adoption and composition even if exitCode != 0
