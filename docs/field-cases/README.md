# Field cases — Brandon's real-shop diagnostic log

**What this is:** a growing, structured library of real trucks Brandon diagnoses in his own bay, captured as he works them. Brandon is the sensor; he brain-dumps each case messy and mid-stream, and each one gets structured into the schema below.

**Why it exists:** every real case is fuel. Accumulated, these cases are how the tool gets *ahead* of the work — learn the patterns in what's actually rolling in, then **predict and pre-fill** the likely concern + codes + first eliminations for a given truck profile. "Out of coverage" is not a dead end — it's the ranked map of what to seed next, prioritized by what Brandon is actually seeing. This is additive to the Ford 6.7 PSD beachhead, not a replacement.

(Standing rule: field data is fuel to build from, not a fork to decide. Capture every case; never gate it behind a "should we cover this" question.)

## The capture schema (one file per case)

Each case file fills these. Blanks are fine when a job is mid-stream — capture what's known, update as it resolves.

| Field | What it is | Feeds (in the eventual guided tool) |
|---|---|---|
| **Truck profile** | year / make / model / engine / transmission + modifiers (e.g. "recently un-deleted", "hot-shot heavy hauler") | platform resolution + context |
| **Complaint (as received)** | the customer's actual words | the intake / symptom |
| **Codes** | every DTC + plain meaning + **keeper vs noise** | symptom + how the tree branches |
| **Duplication** | how the concern was reproduced (load, conditions) | the test conditions of a check |
| **Findings** | what Brandon observed, in order | the eliminations |
| **Root cause** | confirmed cause, or current best hypothesis if mid-job | the verdict |
| **Elimination path** | the ordered steps complaint → root cause | the guided flow itself (the gold) |
| **Prior work / red herrings** | what a previous shop already tried & ruled out (e.g. "converter replaced, didn't fix") | eliminations the tool can skip / warn about |
| **Coverage status** | in / out of the tool today + why | the seeding priority signal |

## The on-ramp: case → live coverage

_Grounded in a read-only recon of how the seeded Ford 6.7 P0087 flow is actually built (DB-backed, not seed files). Source of truth: `lib/db/schema.ts`, `lib/diagnostics/cached-lookup.ts`, `lib/diagnostics/load-system-topology.ts`, `lib/diagnostics/resolve-platform.ts`._

**The tool's "knowledge" of a truck = a set of database rows.** A truck+concern is considered *covered* when it has an active chain `symptoms → symptom_test_implications → test_actions → components` (`cached-lookup.ts`). To turn one captured field case into live, guided coverage, these get authored:

| Row type (table) | What it is, in plain terms | Per |
|---|---|---|
| `platforms` | the truck (make / model family / generation / year-range) | platform |
| **resolver code** (`resolve-platform.ts`) | the small code change so the tool *recognizes* the truck and emits its platform slug. **Today it only recognizes Ford 6.7/6.0 PSD** — any Ram returns null, so this step is mandatory for a new make. | make/engine |
| `symptoms` | the concern (e.g. TCC-no-lock, reductant-low), with its DTC display | per symptom |
| `components` + `component_connections` + `component_pins` | the parts and the wiring = the circuit/topology drawn on screen | per system |
| `test_actions` | **one check / one elimination step**: a part to check, *under what condition* (`scenario_required`: key-off / idle / **heavy-load** / hot-soak…), *how* (`observation_method`: scan PID / pressure gauge / electrical-at-pin / waveform / visual / audible / touch / smell), the expected value+unit+tolerance or expected observation, how invasive it is | per check |
| `branch_logic` | the routing: `condition → verdict (ok/warn/fail/impossible) → next_action`, optionally jumping straight to the next check (`routes_to_test_action_id`). **This is the elimination tree.** | per branch |
| `symptom_test_implications` | links a symptom to its checks — the chain the coverage gate counts | per link |
| `system_scenarios` / `scenario_wire_states` / `pin_scenario_readings` | the live readings shown on the wires under each scenario (optional polish) | per system |
| `platform_equivalents` | **the reuse shortcut** — flags two trucks' system as equivalent (`FULLY`/`PARTIALLY`/`NOT`), *per system* (fuel, transmission, aftertreatment…). FULLY → reuse the whole flow, author nothing. | per platform-pair-system |

**Every authored row is stamped `source_provenance`: `FIELD-VERIFIED` > `TRAINING-CONFIRMED` > `TRAINING-INFERRED` > `GAP`.** Field-verified is the HIGHEST tier and wins ties (`dedupBranchesByVerdict`, `load-system-topology.ts`). **Brandon's real-shop cases are field-verified — the top grade of input the system accepts.** They don't just add coverage; they outrank and correct anything the AI guessed.

### ON-RAMP IN PLAIN ENGLISH
- The tool "knows" a truck as database rows: the truck, the concern, the parts + wiring, the **checks** (each says *do this, under this condition — e.g. under heavy load — and here's the expected reading*), and the **branches** (if the reading is X the cause is Y; if not, go check Z).
- Lighting up a new truck like the Rams takes two kinds of work: (1) a **tiny code change** so the tool recognizes the truck (today it only recognizes Ford 6.7/6.0 diesel), and (2) **authoring the checks + branches** for the concern. The authoring is the real labor — and **Brandon's elimination path IS most of it**; he effectively dictates it.
- A **reuse shortcut** exists: if one truck's system matches one already covered, flag them equivalent and reuse the whole flow — no re-authoring. It's per-system, so a Ram likely reuses nothing from Ford, but a **2011–16 Ford 6.7 could reuse most of the 2017–22 6.7 fuel flow** (that's exactly a `platform_equivalents` row, system=`fuel`).
- **Prefill, concretely:** these rows existing for a truck *before it rolls in* = the tool already shows the likely concern, codes, and first checks. **Predict** = the pattern that emerges across accumulated field-verified cases.

### GAPS / UNCERTAIN
- Did not trace the exact curator/research authoring UI that WRITES these rows (the back-office path that takes a case → rows). Known to exist (`lib/curator/*`, `lib/research/*`); the row schema above is confirmed, the authoring tooling is not yet mapped.
- A prior background recon agent died on a transient API error mid-run; this on-ramp was reconstructed directly from the schema + diagnostics code (all claims grounded in files cited above).

## Cases captured

| Date | Truck | Concern | Coverage | File |
|---|---|---|---|---|
| 2026-06-22 | 2024 Ram 3500 6.7 Cummins (un-deleted) | DEF supply line broken | RECOGNIZED, no content (`ram-heavy-duty-5th-gen-67-cummins`) | [ram-3500-67-undeleted-def-line](./2026-06-22-ram-3500-67-undeleted-def-line.md) |
| 2026-06-22 | ~2011/12 Ram 3500 6.7 Cummins (68RFE) | TCC won't lock → trans over-temp | RECOGNIZED, no content (`ram-heavy-duty-4th-gen-67-cummins`) | [ram-3500-67-68rfe-tcc-overtemp](./2026-06-22-ram-3500-67-68rfe-tcc-overtemp.md) |
| 2026-06-22 | 2019 Cadillac Escalade 6.2 gas | intermittent ABS warning + stored network/ADAS codes | OUT (resolver null — not Ford/Ram diesel) | [cadillac-escalade-2019-network](./2026-06-22-cadillac-escalade-2019-network.md) |

**Recognition layer:** `lib/diagnostics/resolve-platform.ts` now resolves Ram HD 2500/3500/4500/5500 6.7 Cummins (2010–2018 → 4th-gen slug; 2019–2025 → 5th-gen slug), covered by 15 tests in `tests/unit/resolve-platform.test.ts`. Branch-only, NOT merged — must not ship until content is seeded behind the slugs (else a real Ram session resolves to an empty flow).
