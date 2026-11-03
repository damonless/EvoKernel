---
id: worktree-probe-score-improvement
title: "Worktree Probe Improvement On Failing Baseline"
l0_summary: "Worktree probe score evaluation when baseline probe failed"
created_commit: "284faa2"
created_branch: "feat/p1-p2-ui-and-growth"
target_symbols: ["probeCandidateInWorktree","runOptimizationCycle"]
ast_fingerprints: {"probeCandidateInWorktree":{"symbol":"probeCandidateInWorktree","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":1395,"end_line":1765,"signature":"export function probeCandidateInWorktree(","ast_hash":"d2e0b6aa82fc0a9a"},"runOptimizationCycle":{"symbol":"runOptimizationCycle","file_path":"src/core/optimize.ts","file":"src/core/optimize.ts","kind":"function","start_line":2015,"end_line":2362,"signature":"export function runOptimizationCycle(","ast_hash":"6edc0ac4d4474647"}}
tags: []
origin: "evolved"
created_at: "2026-10-31T09:47:58.578Z"
updated_at: "2026-11-03T00:42:32.753Z"
---

## Symptom
Candidates improving test pass score on a failing baseline were rejected as KEEP_BASE

## Root Cause
Candidate probe passed was tied to exit code 0 rather than checking score improvement against baseScore

## Solution
Allow candidates with score > baseScore to pass and be eligible for adoption and composition even if exitCode != 0
