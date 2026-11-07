# Core Invariants (Auto-Generated Digest — Do Not Edit Directly)

- **[gatekeeper-self-test-invariant]** (`.evo/tools/**/*`): Every evolved Micro-Tool script must handle --self-test or EVO_SELF_TEST=1 and exit 0 deterministically.
  When proposing a new Micro-Tool via `evo_propose(kind: "tool")`:
  - The script MUST check `process.env.EVO_SELF_TEST === "1"` or `process.argv.includes("--self-test")` and run a side-effect-free verification check exiting with code `0`.
  - Never hardcode user-specific absolute paths; read workspace root from `process.env.EVO_WORKSPACE || process.cwd()`.
