# Field case — 2024 Ram 3500 6.7 Cummins, broken DEF line

**Captured:** 2026-06-22 · **Source:** Brandon, his bay · **Coverage status:** RECOGNIZED (resolver now emits platform slug `ram-heavy-duty-5th-gen-67-cummins`, branch-only/not merged) — but NO content seeded behind it yet, so not yet live. Authoring the reductant/DEF flow is the next step.

## Truck profile
- **Year/Make/Model:** 2024 Ram 3500
- **Engine:** 6.7L Cummins
- **Modifier:** **recently un-deleted** (factory emissions hardware reinstalled + tune reverted to stock) — important: un-deleted trucks are a distinct, failure-prone population; the reinstalled DEF/SCR plumbing is exactly what fails here.

## Complaint (as received)
Emissions/SCR fault lights after the un-delete work.

## Codes (Topdon scan, read from photo — confirm exact)
| Code | Module | Plain meaning | Keeper / noise |
|---|---|---|---|
| P203F | PCM | Reductant (DEF) level too low / supply | **keeper** |
| P206B / P2068 | PCM | Reductant quality / concentration performance | **keeper** |
| P1400 | PCM | (Cummins-specific; confirm) | TBD |
| U0140 ×2 | HVAC, ABS | Lost communication with BCM | likely **noise** (incidental to un-delete work) |
| U0422 | HVAC | Invalid data received from BCM | likely **noise** |

## Findings
- Reductant/SCR codes pointed at the DEF delivery side.
- **Root cause:** the DEF (reductant) supply line was **physically broken and separated at the end.** No DEF reaching the injector → reductant performance/quality faults.

## Root cause
Physically broken/separated DEF supply line.

## Elimination path
1. Reductant codes present → suspect DEF delivery (level → pump → line → injector).
2. Inspect the DEF supply line → found physically broken & separated at the end.

## Open calibration question (asked Brandon)
Did the **U0140 / U0422** comm codes clear once the line was fixed (confirming they were incidental to the un-delete work), or were they a separate fault? Answer determines whether the tool should bundle them with the reductant root cause or branch them separately.

## Pattern note
Real trucks arrive with a **cluster of codes across modules** that collapses to ONE physical root cause + some separate/noise codes — the exact "many codes → one elimination at a time" thesis the tool is built on.
