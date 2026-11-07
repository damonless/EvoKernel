---
id: no-fabricated-display-fallbacks
title: "User-facing metrics must never show invented fallback numbers"
l0_summary: "Dashboards/CLI reports -> missing data replaced by flattering constants -> render an explicit empty marker and label estimates as estimates."
scope_glob: "src/**/*.ts"
core: false
priority: 50
tokens: 360
origin: "evolved"
confidence: "high"
transfer_scenarios: ["Workbench HTML dashboard KPI cards rendering health/savings when snapshot fields are absent","Terminal stats/doctor/score renderers printing pass rates, cache stability, or enabled hosts on empty workspaces","README badges and promo SVGs quoting benchmark numbers that drift from the generated benchmark JSON"]
review_status: "pending"
created_at: "2026-11-07T18:55:21.249Z"
updated_at: "2026-11-07T18:55:21.249Z"
---

## Guardrail
1. Any user-visible score, percentage, savings, pass rate, or 'enabled' list must be derived from measured state. When the source is missing, render an explicit empty marker (e.g. an em-dash or 'unknown') — never a hard-coded optimistic default.
2. Formula-based estimates must be labeled 'estimated' in the UI/CLI text and kept out of headline KPIs.
3. Static marketing slogans must not be embedded inside report renderers (SVG cards, terminal boxes); reports describe only the inspected workspace.
4. Empty-state lists (harnesses, hosts) must reflect detected configuration, not a fallback roster.
5. Status glyphs must differ between pass / warn / fail, and every diagnostic report ends with an overall verdict line.

## Review checklist
- grep renderers for `!== undefined ? x : <literal>` and `|| '<literal list>'` patterns on displayed metrics.
- Cross-check every number that appears in README, promo assets, and UI against a single generated source.

Case Anchor: Workbench telemetry fallbacks in the UI client template, the stats ledger renderer, the score SVG card, and the init summary fallback grade (see memory `ux-audit-fabricated-fallbacks-and-pages-leak`).
