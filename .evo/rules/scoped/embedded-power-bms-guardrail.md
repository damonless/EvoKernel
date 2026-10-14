---
id: embedded-power-bms-guardrail
title: "Embedded Power Electronics Topology & BMS Macro Guardrail"
l0_summary: "Require lookup-table/FSM code evidence for power topology claims and branch pre-checks before using BMS/CAN macros."
scope_glob: "**/*.{c,h,cpp,hpp,s,asm}"
core: false
priority: 50
tokens: 244
origin: "evolved"
created_at: "2026-10-14T16:41:40.672Z"
updated_at: "2026-10-14T16:41:40.672Z"
---

1. **Eliminate Topology Bias & Subjective Guessing**: When analyzing power electronics topologies or operating mode transitions (e.g., battery-less load capability, grid/inverter/battery switchover conditions), never rely on generic external hardware assumptions. Locate and cite the exact mode Lookup Tables, decision finite-state machines (FSMs), and hardware ADC/GPIO protection branches first.
2. **Branch Macro & Symbol Pre-Check**: Before introducing any macro, enum enumerator, struct field, or CAN signal identifier in C/C++ firmware, verify its exact existence in the current branch header files. If absent, prefer native branch macros (e.g., `BMS_SERVICE_CAN_HAN_REQ_DISCHARGE_ENABLE`) or explicitly define it in the corresponding header with user confirmation.
