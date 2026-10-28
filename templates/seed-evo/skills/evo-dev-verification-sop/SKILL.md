---
id: evo-dev-verification-sop
title: "EvoKernel Development, Blast-Radius & Preflight Verification SOP"
l0_summary: "4-stage TDD, CodeGraph blast-radius pre-check, multi-consumer parity, and preflight verification SOP for EvoKernel."
tags: []
origin: "evolved"
created_at: "2026-10-28T05:43:42.489Z"
updated_at: "2026-10-28T05:43:42.489Z"
---

## L1 Contract
- **Trigger**: When implementing features, fixing bugs, refactoring cross-module logic, or preparing commits in EvoKernel or multi-module repositories.
- **Inputs**: Target task/issue description, `evo_search` capability recall hits, and `.codegraph/` AST index.
- **Outputs**: Blast-radius verified implementation, Red-Green-Refactor regression tests, preflight-audited manifests/capabilities, and refreshed AST cognitive memories.

## L2 SOP
1. **Stage 1 — Cascaded Recall & CodeGraph Blast-Radius Pre-Check**:
   - Call `evo_search(query, workspace)` and `evo_inspect(id, "L2", workspace)` on matched rules, skills, and `[VERIFIED]` memories.
   - Before editing any shared function, constant, or schema, call `codegraph_explore` or `codegraph_callers` (with `projectPath: workspace`) to enumerate every caller and consumer across CLI (`src/cli/`), MCP (`src/mcp/`), Core (`src/core/`), Hooks (`scripts/`), and Micro-Tools (`.evo/tools/`).
2. **Stage 2 — 5-Class Regression Checklist (Issues #1–#15 Post-Mortem)**:
   - **Multi-Consumer Parity**: If modifying token budgets, managed rule targets, or MCP bootstrap args, update all sibling consumers (`gatekeeper.ts`, `init.ts`, `audit.ts`, `agy-config-auditor`, `.mcp.json`, `.cursor/mcp.json`, `.claude-plugin/plugin.json`, `gemini-extension.json`, `mcp_config.json`, `rules/AGENTS.md`) in the same change.
   - **Host Process CWD & Handshake Isolation**: Never assume an MCP server or hook starts in the user project `cwd`; always support explicit `workspace` / `projectPath` / `--path` and bidirectional `roots/list` + `rootUri`.
   - **Sliding-Window State Watermarks**: Persist cleared state watermarks to disk before early-return paths so transcript tail truncation (`>128KB`) never resurrects resolved triggers.
   - **Lexical State & Boundary Guards**: Strip comments/strings/regex literals before AST or identifier matching; enforce case/word boundaries on token expansion regexes and bidirectional keys on bilingual synonym maps.
   - **Windows Subprocess & Path Safety**: Resolve `.cmd`/`.bat` shims on Windows `PATH`, strip UTF-8 BOM (`\uFEFF`) before frontmatter regexes, and strip leading slashes before `path.resolve(root, relPath)`.
3. **Stage 3 — Red-Green-Refactor TDD Loop (`obra/superpowers` Discipline)**:
   - Write or extend a deterministic test in `src/tests/*.test.ts` covering the exact failure mode and boundary cases first.
   - Build (`node ./scripts/build.mjs`) and run the test suite (`node ./scripts/test.mjs`) to verify all suites pass with `0` failures.
4. **Stage 4 — Verification-Before-Completion & Experience Crystallization**:
   - Run `evo_run("evo-release-preflight")` and `evo_run("agy-config-auditor")` to verify manifest parity, seed-evo sync, rule budgets, and AST symbol integrity.
   - Run `codegraph sync` and `evo doctor` / `evo memory verify` to ensure `.codegraph/` and `.evo/memories/` are `100% [VERIFIED]`, then crystallize new lessons via `evo_propose`.
