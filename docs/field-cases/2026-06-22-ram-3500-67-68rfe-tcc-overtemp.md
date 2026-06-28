# Field case — ~2011/12 Ram 3500 6.7 Cummins (68RFE), TCC won't lock → over-temp

**Captured:** 2026-06-22 · **Source:** Brandon, his bay (mid-job) · **Coverage status:** RECOGNIZED (resolver now emits platform slug `ram-heavy-duty-4th-gen-67-cummins`, branch-only/not merged) — but NO transmission content seeded behind it yet, so not yet live. Flow completes once Brandon pins the apply-side root cause.

## Truck profile
- **Year/Make/Model:** ~2011 or 2012 Ram 3500 (confirm exact year)
- **Engine:** 6.7L Cummins
- **Transmission:** 68RFE (6-speed auto) — likely
- **Modifier:** **hot-shot heavy hauler** — hauls trailers stacked on trailers; high sustained load.

## Complaint (as received)
"Running hot; transmission shifts hot." Customer says previous shops "dicked them around" — a torque converter was **already replaced** and the concern persists.

## Codes
| Code | Plain meaning | Keeper / noise |
|---|---|---|
| P0740 | TCC (torque converter clutch) circuit / out of range — clutch not engaging | **keeper** |
| P0871 | Overdrive pressure switch rationality | **keeper** (points at pressure / valve-body side) |
| P0218 | Transmission over-temperature operation active — *the customer's "hot"* | **keeper** (the symptom/heat) |
| P0533 | A/C refrigerant pressure sensor circuit high | likely **separate / noise** (A/C side, not trans) |

## Duplication
Loaded a skid steer on a heavy-duty trailer, hooked it to the truck, drove to reproduce the concern under real load.

## Findings
- Under load, the **torque converter did NOT lock.**
- An unlocked converter slipping under that load is a heat factory → over-temp (P0218). The complaint and P0218 are downstream of the no-lock.

## Root cause (best path; mid-job)
TCC **apply path** failure — and specifically **NOT the converter** (a previous shop already replaced it and it still won't lock). Suspect: TCC solenoid, valve body / pressure control (P0871 supports this), wiring/connector, or the control (PCM/TCM) command side.

## Elimination path
1. Over-temp + "shifts hot" + P0218 → suspect TCC not coupling (heat source under load).
2. Duplicate under real load → confirm TCC does not lock.
3. Converter already replaced & still no lock → rule OUT the converter; fault is in the apply path.
4. Branch the apply path: solenoid → valve-body/pressure (P0871) → wiring → control command. _(Brandon to confirm where it lands.)_

## Prior work / red herrings
- Torque converter **already replaced** by a prior shop — did not fix. Tool should *skip* re-recommending a converter and warn it's been done.
- P0533 (A/C) likely unrelated to the trans concern — confirm.

## Pattern note
Same shape as the un-deleted Ram: a 4-code cluster across subsystems collapsing to one keeper root-cause path + a noise code. Prior-shop work is itself an elimination already done — capturing it saves repeating it.
