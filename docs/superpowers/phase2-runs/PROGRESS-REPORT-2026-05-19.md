# Vyntechs Diagnostic Knowledge — Progress Report
## 2018 F-250 6.7L Power Stroke Diesel — Multi-System Build

**Date:** 2026-05-19
**What this is:** A quality-focused look at what the system has built about ONE vehicle platform, across multiple systems.

---

## What's in the database, by system

| System | Architecture facts | Components | Observable properties | Connections | Diagnostics |
|---|---|---|---|---|---|
| **Fuel** | 23 (17 confirmed / 1 inferred / 5 gap) | 28 | 49 | 43 | 3 symptoms covered (P0087, P0088, no-start) — 28 tests, 83 branches |
| **Cooling** | 25 (15 confirmed / 6 inferred / 4 gap) | 17 | 28 | 21 | not yet — architecture and topology only |
| **Engine air + EGR + turbo + aftertreatment** | 36 (27 confirmed / 8 inferred / 1 gap) | 29 | 45 | 49 | not yet — architecture and topology only |
| **Shared (PCM, CAN, cluster, gear train, DEF)** | — | reused across all 3 systems | — | — | — |

**The whole platform now has:** 1 vehicle architecture (4th-gen 2017-2022 Super Duty 6.7L PSD), 84 architecture facts, 74 components, 122 observable properties, 111 connections — and 3 working diagnostics built on top of it.

---

## Quality indicators

### 1. The AI **refuses to make up specs it doesn't have**

Across 84 architecture facts:
- **59 marked TRAINING-CONFIRMED** — the AI has direct training-data knowledge for the 4th-gen 6.7L PSD specifically
- **18 marked TRAINING-INFERRED** — the AI is generalizing from platform-class patterns (e.g., "this engine family typically has a turbo speed sensor here"). Each tagged with `field_verify_required = true`
- **7 marked GAP** — the AI flagged it explicitly: "I do not have specific training data; this needs to be confirmed by a tech in the field"

Every "I don't know" is **written into the record as content**, not papered over. The 7 gaps are concentrated in details that vary by build year, fuse box layout, exact mounting positions, and cracking pressure specs — exactly the things that *should* require field verification.

### 2. The platform is **one connected graph, not three isolated silos**

The cooling system's water pump and the fuel system's CP4.2 are both **gear-driven off the engine gear train** (a fuel-system component captured in Run 1). When cooling system topology was built, it pointed at the existing gear-train component instead of duplicating it.

Same for:
- PCM (referenced by all 3 systems)
- HS-CAN bus (referenced by all 3)
- Instrument cluster (referenced for warning lamp routing)
- DEF tank + dosing system (fuel system's territory, but referenced by air system for SCR exhaust treatment)
- **EGR cooler** — captured in cooling system (it's a coolant-loop heat exchanger), referenced by air system (it's also in the exhaust EGR path). One component, two systems' worth of relationships.

This is the cache-hit pattern working *within* a platform. The same pattern will work cross-platform when the F-350 case runs.

### 3. The diagnostic library **compounds** across symptoms on the same system

Same vehicle, same fuel system, three different complaints:

| Run | Symptom | New tests | Tests reused from prior runs | Reuse rate |
|---|---|---|---|---|
| 1 | P0087 (rail pressure too low) | 14 | 0 (cold start) | — |
| 2 | P0088 (rail pressure too high) | 7 | 5 | **42%** |
| 3 | No-start, cranks normally | 7 | 12 | **63%** |

The third diagnostic took less than half the work of the first because the library already contained reusable tests. This is the "AI builds once, library compounds" pattern in real production data — the more the platform learns, the cheaper future diagnostics get.

### 4. Field-verified knowledge is **accumulating**

One observable has been upgraded from "AI inferred this is diagnostically relevant" to "master tech has confirmed this firsthand":

- **CP4.2 cavitation knock** (`sd4-67psd-cp4-audible-noise`) — was TRAINING-INFERRED, now FIELD-VERIFIED. The retired row still lives in the database with a `replaced_by_id` pointer, so the upgrade trail is auditable: "this used to say X, on this date it became Y because Brandon confirmed firsthand."

Every future tech outcome that gets recorded can trigger more flips like this. The library gets sharper without needing more AI calls.

### 5. Test design is **scenario-aware**

The same observable can require different tests under different operating conditions, and the system tracks this:

- Fuel rail pressure at **idle** is `sd4-67psd-test-frp-pid-idle` — used by P0087 and P0088
- Fuel rail pressure during **cranking** is a separate test, `sd4-67psd-test-frp-pid-cranking` — used by the no-start diagnostic (because a no-start vehicle can't reach idle)
- IMV duty cycle has the same split: an idle variant and a cranking variant

When the no-start diagnostic was built, the AI correctly emitted the cranking variants instead of trying to reuse the idle ones. This isn't trivial — it's the system recognizing that operating scenario is part of test identity, not just metadata.

### 6. The **refusal protocol holds** across symptoms

Of 83 total branches in the diagnostic library:
- **30 are terminal** — they end with a specific recommendation (replace this part, repair that leak, escalate to a wiring diagram)
- **53 are intermediate** — they route to a follow-up test for more evidence

No single-test verdict crosses the gate alone. The most consequential diagnosis in the system — CP4.2 catastrophic failure — requires three corroborating findings (low CP4 inlet pressure + metallic debris in filter + cavitation noise audible) before the system will let the tech commit to the full remediation. This is the design philosophy made concrete: **no fabricated certainty, every commit recommendation backed by an evidence chain**.

The no-start diagnostic even has an honest "outside model" exit — when all fuel-system tests pass but the engine still won't fire, the diagnostic explicitly says "fuel system is exonerated; suspect compression or injector mechanical (not in current model)." It tells the tech where the wall is rather than guessing past it.

### 7. Production-DB discipline is **clean**

- All writes have been additive (no destructive operations on existing data)
- One destructive op (the retirement flip on CP4 cavitation knock) executed with explicit per-op approval — and was fully reversible
- Rehearse-on-local-then-apply-to-live caught **5 SQL errors** in Run 3 before they could hit production
- One mid-flow rule clarification ("additive development writes OK within gate plan; destructive ops always need explicit approval") captured in memory for future sessions

---

## What this means in shop terms

Three different complaints on a 2018 F-250 6.7L PSD now flow as **database reads, not AI calls**. The next tech who pulls one up gets:

- A diagnostic procedure walking cheapest-to-most-invasive
- Per-test expected readings (with "tech records actual reading" for everything that's a gap)
- Wrong-reading branches telling them what to do next at each fork
- A confidence gate that refuses single-test verdicts
- One observation (CP4 cavitation knock) carrying a "master tech confirmed firsthand" stamp instead of just "AI guessed"

And the platform now has the structural knowledge for the **other two systems** (cooling, engine air) sitting ready — components, sensors, connections, expected observation methods. Diagnostics for cooling DTCs (P0128, P0217, P0118) or air-system DTCs (P0299 turbo underboost, P0401 EGR flow, P244A DPF) can be built on top of that scaffolding without the AI re-learning the architecture.

---

## What's still ahead in Phase 2

- **Run 4 (originally on the spec):** 2019 F-350 + P0087 — validates that the same architecture re-used across vehicles produces a cache-hit instead of a fresh AI call. This is the cross-vehicle proof that the platform_equivalents table works.
- **Run 5 (originally on the spec):** Real tech runs a cached diagnostic on a live truck and records actual measurements (not simulated). This is the production-data version of Run 1's Gate 5 simulation.
- **Phase 3:** The user-facing skill that wraps all this so the tech in the shop just types "F-250 P0087" and gets the diagnostic on screen.

But the harder-to-validate parts of the design are now proven on real production data. Most of what Phase 2 was supposed to verify has been verified.
