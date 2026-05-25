# Vyntechs Diagnostic Coverage Tracker
## What's shippable, what's almost there, what's a gap

**Last updated:** 2026-05-19 (engine mechanical + electrical systems added)

**Live database totals:** 1 platform / 141 architecture facts / 123 components / 187 observable properties / 188 component connections / 3 symptoms / 28 test actions / 83 branch logic rows / 44 symptom-test priorities
**Purpose:** Living log of which symptoms/DTCs have fully-wired end-to-end diagnostics, across which vehicle applications. Update this every time a new diagnostic ships or a new platform is added.

---

## TIER 1 — Production-ready diagnostics (fully wired end-to-end)

These have a complete diagnostic path: tests defined, branch logic for each "if you see X, do Y," priority ordering, and (where applicable) at least one simulated walk-through proving the path crosses the confidence gate without single-test guessing.

| Symptom | Type | Test count | Branch count | Tech-outcomes recorded | Application range |
|---|---|---|---|---|---|
| **P0087** — Fuel Rail Pressure Too Low | DTC | 13 | ~52 | 12 (simulated) | 2017-2022 Ford Super Duty 4th-gen with 6.7L PSD (F-250, F-350, F-450, F-550 cab/chassis — all share architecture, but only F-250 specifically wired so far; cross-vehicle inheritance not yet activated) |
| **P0088** — Fuel Rail Pressure Too High | DTC | 12 | ~38 | 0 (not yet run on a real or sim vehicle) | Same as P0087 |
| **No-start, cranks normally** (customer drivability complaint, no DTC) | Drivability | 19 | ~61 | 0 (not yet run on a real or sim vehicle) | Same as P0087 |

**What "application range" means right now:** Each diagnostic is **bound to one platform** in the database (`ford-super-duty-4th-gen-67-psd`). For a 2019 F-350 with the same engine to inherit this diagnostic, we need to create a `platform_equivalents` row linking the two — which is the original Phase 2 Run 4 task that's still pending. **As of right now, the diagnostics technically only resolve for vehicles whose `vehicle.platform_id` points at the F-250's platform row.** The architecture is identical across the 4th-gen Super Duty line, but the database doesn't know that yet.

---

## TIER 2 — Architecture and topology built, but no diagnostics wired yet

The vehicle's knowledge base for these systems is complete — components, sensors, observables, how everything connects — but no specific complaint/DTC has been turned into a diagnostic path yet. Adding one is roughly a single P3 subagent run (~30-60 min including SQL apply).

| System | Components | Observables | Connections | Candidate symptoms to wire next |
|---|---|---|---|---|
| **Cooling** | 17 | 28 | 21 | P0128 (coolant temp below thermostat regulating temp), P0217 (engine overheat), P0118 (ECT circuit high), "white smoke from tailpipe" (EGR cooler failure pattern), "unexplained coolant loss" (EGR cooler internal leak — known platform trap) |
| **Engine air + turbo + EGR + aftertreatment** | 29 | 45 | 49 | P0299 (turbo underboost — the headline 6.7 PSD code), P2263 (boost system performance), P0401 (insufficient EGR flow), P0402 (excessive EGR flow), P244A/P244B (DPF differential pressure too low/high), P20EE / P2BAD (SCR efficiency), P0299 with active regen interrupted, "black smoke under load," "ammonia smell from tailpipe" |
| **Engine mechanical + oil + glow plugs** | 33 (incl. 8 CPSGP glow plugs + GPCM) | 36 | 49 | P0520/P0521 (oil pressure sensor/circuit), P0671-P0678 (per-cylinder glow plug failures — one DTC per cylinder), P0335 (CKP circuit), P0340 (CMP circuit), "no-start with no RPM signal" (closes the Run 3 OBSERVABILITY HALT — cam/crank sensor circuit), "blue smoke at startup" (turbo oil drain restriction / CCV / valve seals), "milky oil" (head gasket vs oil cooler differential), low oil pressure diagnostics |
| **Electrical / charging / starting** | 17 (dual batteries, BMS, alternator, BJB, BCM, ground points) | 29 | 29 | P0562/P0563 (system voltage low/high), "no-crank with good battery voltage" (closes the Run 3 no-start path on the electrical side), "dead battery after overnight sit" (parasitic draw), "alternator not charging at idle," "battery warning lamp on," "single battery causing dual-battery bank degradation" |

Wiring a diagnostic for any of these is now CHEAP — the architecture investment is already paid. The library compounds.

---

## TIER 3 — Not yet started on this platform

Systems present on the 2018 F-250 but no architecture captured yet. These would each take a P1+P2 run (~30-60 min) to add the architecture/topology, then individual P3 runs per symptom on top.

| System | Why it matters |
|---|---|
| **Transmission (6R140 TorqShift 6-speed)** | The other expensive failure point on this truck. Solenoid pack, TCM, torque converter clutch, line pressure. P0700-series and many specific transmission codes. High customer-facing diagnostic value. |
| **HVAC** | Common comeback complaint (no AC, no heat, blower issues). Different topology — refrigerant loop, blower motor, HVAC control module. |
| **4WD / transfer case** | Electronic-shift transfer case on this trim, transfer case fluid, encoder motor. "4WD won't engage" is a common complaint. |
| **Brake / hydroboost / trailer brake controller** | Hydroboost is specific to diesel platforms (uses power steering pressure for assist). Trailer brake controller integrated. |
| **Power steering** | Variant: hydraulic vs EPAS depending on build year/trim. |
| **Body control / lighting / doors / wipers** | Less commonly diagnosed but maps customer-experience complaints. Mostly BCM-driven. |
| **Infotainment / Sync / cluster electronics** | Rarely DIY-diagnosable; usually module replacement. Lower priority. |

---

## TIER 4 — Application coverage (cross-platform inheritance)

**Platforms currently in the database:** 1 — `ford-super-duty-4th-gen-67-psd` (2017-2022).

**Platform equivalences linked:** 0.

This is the gap that lets a 2019 F-350 with the same engine inherit the 2018 F-250's diagnostics without re-running the AI for each one. The schema supports it (the `platform_equivalents` table is in place). Activating it requires running the P4A subagent (Prompt 4A — Platform Equivalence Generator) for each candidate cross-vehicle pairing.

**Candidate inheritance targets** (vehicles that very likely share the same fuel/cooling/air/etc systems as the F-250):
- 2017-2022 Ford F-250 6.7L PSD (other model years on same platform — already same row, but other VINs)
- 2017-2022 Ford F-350 6.7L PSD (gas variant would differ; diesel inherits everything)
- 2017-2022 Ford F-450 6.7L PSD (cab/chassis — same engine + drivetrain)
- 2017-2022 Ford F-550 6.7L PSD (heavier chassis — same engine + drivetrain)
- 2017-2022 Ford F-650 / F-750 medium-duty (some share the 6.7L PSD; verify per build)
- 2017-2022 Ford E-Series cutaway with 6.7L PSD (commercial chassis cab — verify body distinction)

**Different platforms that share many systems** (would still need their own P1 run but most components reuse):
- 2011-2016 Ford Super Duty 3rd-gen with 6.7L PSD (2nd-gen Lion V8 — most systems shared, some differences in turbo and aftertreatment)
- 2008-2010 Ford Super Duty with 6.4L PSD (different engine — twin sequential turbos, different fuel system; minimal inheritance)

---

## What's needed to get to a "pro-demand" coverage level

In rough order of customer-facing impact:

1. **Cross-vehicle inheritance for the 4th-gen Super Duty family** — one P4A subagent run links F-350/F-450/F-550 to the F-250's diagnostics. Multiplies coverage roughly 4-5x with one operation.
2. **Wire the headline 6.7L PSD DTCs** that the architecture is already ready for:
   - P0299 (turbo underboost) — by far the most-Googled 6.7 PSD code
   - P244A/B (DPF differential pressure)
   - P0401 (insufficient EGR flow)
   - P0671-P0678 (glow plug failures)
   - P0128 (thermostat — known frequent failure on this platform)
3. **Build transmission (6R140) architecture and a few common codes** — P0700, P0717, P0741, P0750-series. High dollar repairs, high diagnostic value.
4. **Backfill no-DTC drivability complaints** for the systems we have:
   - "Smoke from tailpipe" (color-based diagnostic tree using existing aftertreatment components)
   - "Loss of power under load" (uses turbo + fuel + air components)
   - "Hard start when warm" (uses fuel + glow + electrical components)
   - "Engine running hot at idle" (cooling system, already wired)
5. **Second platform** — a non-Ford-Super-Duty platform to validate the architecture works beyond one truck family. Likely candidate: 2020-2024 Ram 2500/3500 6.7L Cummins (different engine architecture, different fuel system — high-value market overlap with the customer base).

---

## How to read this tracker

- **TIER 1 = shippable today.** A tech in the shop can pull up the diagnostic, follow the steps, get a verdict backed by the refusal protocol.
- **TIER 2 = one P3 run away from shippable.** The investment (architecture + topology) is done; we just haven't tied a specific complaint to a specific test sequence yet.
- **TIER 3 = needs a full P1+P2 run for the new system before any diagnostics can be wired.**
- **TIER 4 = the cross-vehicle multiplier.** Every platform_equivalent row is leverage — multiplies existing diagnostic value across more applications.

**The whole point of this tracker:** as the platform grows, scan TIER 1 to see what's locked in, TIER 2 to see "what could ship tomorrow with minimal work," and TIER 3 + TIER 4 to plan where the next investment goes.
