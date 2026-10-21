---
id: gatekeeper-self-test-invariant
title: "Deterministic Micro-Tool Self-Test Invariant"
l0_summary: "Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically."
scope_glob: ".evo/tools/**/*"
core: true
priority: 90
tokens: 247
origin: "bootstrap"
created_at: "2026-10-14T16:00:40.662Z"
updated_at: "2026-10-21T15:14:00.955Z"
---

When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:
- The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.
- Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.
- Historical fix commits analyzed (3 commits): 387153f fix(mcp,cli): support per-call workspace routing and prevent plugin cwd hijacking (Closes #2, Refs #4, Refs #5) | d0d4e13 fix(cli,telemetry): isolate global fallback to ~/.evo/global, resolve parent .git in --stealth, expose --targets, and add FTS5 fallback (Closes #1, Closes #3) | a812bc7 fix(hygiene): remove private embedded BMS rule and FSM skill from open-source repo (Refs #1)
