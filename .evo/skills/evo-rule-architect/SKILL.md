---
id: evo-rule-architect
title: "Legacy Rule & Skill Decoupling Architect (4-Stage Refactoring SOP)"
l0_summary: "Audits bloated CLAUDE.md/GEMINI.md/AGENTS.md and coupled skills, decoupling them into L0 seeds and L1/L2 scoped assets."
tags: ["architecture","refactoring","rules","skills","context-hygiene","audit"]
origin: "bootstrap"
created_at: "2026-10-15T17:23:29.100Z"
updated_at: "2026-10-19T17:34:35.876Z"
---

## L1 Contract
- **Trigger**: When onboarding an existing user/project with bloated global/local rule files (`>1,500 tokens`), domain leaks in global configs (`~/.gemini/`, `~/.claude/`, `~/.cursor/`), or high duplication between `AGENTS.md` and `SKILL.md`.
- **Inputs**: Diagnostic output from `evo audit --global` or `evo refactor`.
- **Outputs**: Purified global rules, desensitized global skills, scoped `.evo/rules/scoped/*.md` rules, and STE-Lite local skills wired to `evo_search` + `evo_propose`.

## L2 SOP
1. **Stage 1 — Global Rule Purification (全局提纯)**:
   - Strip all language-specific rules (`*.c`, `*.ts`, `*.py`), tool-specific routing (`CodeGraph`, `AOCI`), and business domain constraints from global files (`~/.gemini/GEMINI.md`, `~/.claude/CLAUDE.md`).
   - Retain only: (a) EvoKernel L0 Meta-Rule Seed, (b) universal epistemic & anti-sycophancy protocol, and (c) concise communication style.
2. **Stage 2 — Global Skill Desensitization (全局技能脱敏)**:
   - Scan global `SKILL.md` files for project-specific macro names, repo paths, or domain terms and replace them with domain-neutral placeholders.
3. **Stage 3 — Local Demotion & Scoped Splitting (局部下沉与 Scoped 拆分)**:
   - Move code workflow rules (e.g., `CodeGraph` threshold policy) into the project-local `AGENTS.md`.
   - Convert domain/language-specific guardrails into on-demand scoped rules via `evo_propose(kind: "rule", core: false, scope_glob: "...")`.
4. **Stage 4 — Local Skill STE-Lite Conversion (局部技能 STE-Lite 化)**:
   - Remove paragraphs in local `.agents/skills/*/SKILL.md` that duplicate `AGENTS.md` invariants.
   - Add a Pre-Task Recall step (`evo_search` -> `evo_inspect`) and a Post-Task Crystallization step (`evo_propose`) to each local workflow skill.
