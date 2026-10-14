---
id: gatekeeper-self-test-invariant
title: "Deterministic Micro-Tool Self-Test Invariant"
l0_summary: "Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically."
scope_glob: ".evo/tools/**/*"
core: true
priority: 90
tokens: 132
origin: "bootstrap"
created_at: "2026-10-14T16:00:40.662Z"
updated_at: "2026-10-14T16:00:40.662Z"
---

When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:
- The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.
- Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.
