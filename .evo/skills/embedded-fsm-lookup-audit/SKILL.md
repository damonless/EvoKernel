---
id: embedded-fsm-lookup-audit
title: "Embedded Power FSM & Lookup Table Evidence Audit"
l0_summary: "SOP for auditing C/C++ firmware mode lookup tables, state machine transitions, and branch macros without hallucination."
tags: ["embedded","power-electronics","bms","fsm","firmware","c"]
origin: "evolved"
created_at: "2026-10-14T16:41:40.737Z"
updated_at: "2026-10-14T16:41:40.737Z"
---

## L1 Contract
Use when answering topology behavior questions or modifying C/C++ firmware state machines, inverter/charger control loops, or BMS CAN protocols.

Inputs:
- Target mode transition or hardware condition question
- Firmware source directory (*.c, *.h)

Outputs:
- Evidence table mapping state enum -> lookup table entry -> hardware guard condition

## L2 SOP
1. **Locate Mode & State Definitions**: Search header files (`*.h`) for operating mode enums, fault bitmasks, and CAN frame macros.
2. **Trace Lookup Tables & Dispatchers**: Identify static const transition tables or `switch(state)` dispatch functions in control loop sources (`*.c`).
3. **Verify Hardware Preconditions**: Extract exact voltage/current thresholds, relay sequences, and BMS flags (such as `BMS_SERVICE_CAN_HAN_REQ_DISCHARGE_ENABLE`) governing the transition.
4. **Synthesize with Confidence Tag**: Report findings with file/line links and explicit `[???: HIGH]` only after code verification.
