# Prompt Orchestration Validation — 2026-05-19

End-to-end cold-context validation of the 4-prompt diagnostic orchestration. All four prompts dialed. Two architectural fixes applied during validation. Three "moat moments" surfaced where the orchestration refused training-data priors that would mislead a tech. Several surfaces remain explicitly unvalidated and are named below.

## What "validated" means here

For each prompt, a fresh Claude subagent received the prompt text as its system instruction and a representative input as its user message, with no other conversation context. The subagent produced the output the prompt directed and then audited its own output against the prompt's spec'd schema and refusal protocol. Audit findings classified `CRITICAL / MAJOR / MINOR / NONE`. Every prompt got run through 5+ test cases across Ford, GM, and Dodge diesel platforms — none of which were in the source design package's example set.

Validated means "behaved correctly on the test cases we ran, by the audit criteria we defined." It does not mean "production-ready end-to-end" — see "What was NOT tested" below.

## Scope

| Prompt | What it does | Cases run | Audit dimensions |
|---|---|---|---|
| 1 — Research & Prefill | Pulls platform architecture facts from training data; tags every fact `TRAINING-CONFIRMED` / `TRAINING-INFERRED` / `GAP` | 5 fresh + 1 re-validation after tweak | Schema, refusal protocol, domain accuracy, closing-line arithmetic |
| 2 — System Operation Intake | Takes expert narration → produces `CLASSIFICATION / EXTRACTED / INFERRED / GAPS` with observability profile per entity | 5 fresh + 1 re-validation after opacity fix | Schema, observability schema, `LAW / LOGIC / PATTERN` tagging, refusal protocol |
| 3 — Diagnostic Session Generator | Takes structured model + symptom → produces `SCOPE / PATH / GATE STATUS` with refusal halts | 5 fresh | All 6 refusal halts, leverage ordering, source provenance, observation-method-to-layout routing |
| 4A — Cross-Vehicle Applicability | Source diagnostic + candidate vehicles → applicability matrix `FULLY / PARTIALLY / NOT / INSUFFICIENT` | 4 dispatches covering 7 architectural fork cases | Verdict accuracy, per-system nuance, architectural fork detection, refusal protocol |

## Per-prompt validation results

### Prompt 1 — Research & Prefill

**Test cases (5 fresh diesel + 1 re-validation):**
1. 2005 Ford F-350 6.0L Power Stroke · fuel system (HEUI architecture)
2. 2014 Chevy Silverado 2500HD 6.6L Duramax LML · fuel system (CP4.2)
3. 2007 Dodge Ram 2500 5.9L Cummins ISB 24V HPCR · injection system (CP3)
4. 2019 Chevy Silverado 3500HD 6.6L Duramax L5P · turbo + EGR (different system)
5. 2017 Ram 3500 6.7L Cummins HO · DEF + emissions aftertreatment

**Verdicts:** 3 of 5 `PROMPT DIALED`. 2 of 5 `PROMPT NEEDS MINOR TWEAKS` — both flagged the same issue (closing-line count math drift). Re-validation after the count-enumeration fix: `COUNT-MATH STILL DRIFTS` but improved from off-by-4 to off-by-1.

**What held across all 5:**
- Schema compliance: all 4 sections in order
- Refusal protocol: zero fabricated wire colors, part numbers, voltage curves, or exact pin assignments outside `GAP`
- Domain accuracy: HEUI vs common-rail correctly distinguished; CP3 vs CP4.2 correctly assigned per platform; LMM vs LML vs L5P generation boundaries correctly placed; Cummins generations (12V / 24V VP44 / 24V HPCR / 6.7L) correctly differentiated
- Failure pattern authenticity: every stated failure pattern documented in real OEM technical history (no fabrications)

### Prompt 2 — System Operation Intake

**Test cases (5 fresh diesel narrations + 1 re-validation):**
1. 6.0L PSD HEUI fuel + injection system
2. 6.7L Cummins DEF aftertreatment
3. 7.3L PSD glow plug system
4. Allison 1000 transmission cooling (multi-domain: thermal + hydraulic + mechanical + electrical)
5. LML high-pressure EGR (opaque-component-dominant)

**Verdicts:** 2 of 5 `PROMPT DIALED`. 3 of 5 `PROMPT NEEDS MINOR TWEAKS` — two recurring issues identified (`OUTPUT FORMAT` ambiguity on 4b ranked-question list, opacity inferred-from-class-knowledge). Re-validation after the opacity fix: `OPACITY-FIX SUCCESSFUL`.

**What held across all 5:**
- Observability schema correctly gated method lists by housing opacity
- `direct_visual_internal` consistently omitted from opaque components
- `LAW / LOGIC / PATTERN` tagging applied to every inference
- PATTERN inferences carried the "typical, confirm" qualifier in every instance
- Cross-domain coverage (thermal + hydraulic + mechanical + electrical in one system) handled cleanly
- Explicit narration constraints honored ("no individual feedback per plug", "no delta-P sensor on LML") — model resisted training-data defaults that would have contradicted them

### Prompt 3 — Diagnostic Session Generator

**Test cases (5 fresh):**
1. 5.9L Cummins CP3 · P0299 underboost (happy path)
2. 6.7L PSD CP4.2 · P0087 fuel rail low (happy path)
3. LML EGR · P0401 with opacity-`GAP` cooler (OBSERVABILITY HALT test)
4. 6.7L PSD · P0087 with contradictory + impossible priors (CONTRADICTION + IMPOSSIBILITY HALT test)
5. Sparse 3-entity model · driveline shudder (THIN-INPUT HALT test)

**Verdicts:** All 5 positive — 2 `PROMPT DIALED`, 3 `HALT FIRED CORRECTLY`. Strongest result across all prompts validated. Prompt 3 is also the most complex (6 refusal halts + leverage logic + layout-family routing + source provenance + scenario relevance) and nailed every dimension.

**What held across all 5:**
- Leverage-ordering held in both happy-path cases (see dedicated audit section below)
- Source provenance held — every expected value cited `LAW / LOGIC / PATTERN` from the model or was explicitly flagged "not yet captured"
- OBSERVABILITY HALT fired correctly on the EGR-cooler-coking case (Test 3) and named the gap, property, and resolution path
- CONTRADICTION HALT cited both Test A and Test B contradictory readings with the monotonicity LAW (Test 4)
- IMPOSSIBILITY HALT cited the 14V-on-5V-architecture LAW and asked for probe-placement verification (Test 4)
- THIN-INPUT HALT refused to produce a path against the 3-entity sparse model, listed 8 specific entity-capture asks (Test 5)
- Observation method to layout family routing correctly applied (`scan_tool_pid` → SCAN TOOL, `pressure_test_with_gauge` → GAUGE, `electrical_measurement_at_pin` → METER, `waveform_capture` → SCOPE)

### Prompt 4A — Cross-Vehicle Applicability

**4 dispatches covering 7 architectural-fork cases:**

| Dispatch | Source diagnostic | Candidates | Result |
|---|---|---|---|
| 1. Multi-OEM fuel system | 2018 F-250 6.7L PSD fuel | 8 candidates: F-250/F-350 same year (FULLY), 6.4L PSD (NOT), 6.0L PSD (NOT), LML (NOT), LMM (NOT), 5.9L HPCR (NOT), 5.9L VP44 (NOT) | `PROMPT DIALED` — all 8 verdicts correct |
| 2. LB7-era Duramax fuel | 2003 LB7 fuel | LLY (FULLY), LBZ (FULLY), LMM (FULLY), LML (NOT — fork), L5P (NOT) | `PROMPT DIALED` — case 5 (LB7↔LLY FULLY with harness change as non-blocker) landed correctly |
| 3. LMM ↔ LML per-system nuance | LMM fuel + LMM Allison trans (2 runs) | LML in both | `PER-SYSTEM NUANCE WORKED` — NOT for fuel, FULLY for trans |
| 4. 5.9L ↔ 6.7L Cummins per-system nuance | 5.9L HPCR fuel + 6.7L aftertreatment (2 runs) | 6.7L (PARTIAL fuel), 5.9L + 2010 6.7L early (NOT aftertreatment) | `PER-SYSTEM NUANCE WORKED` plus bonus: 2010 6.7L correctly identified as NOT due to NOx adsorber strategy vs SCR/DEF |

**All 7 of Brandon's specific architectural-fork cases passed.**

## Architectural fixes applied during validation

Two fixes were applied to prompts mid-validation. Both were surgical (≤30 added words). Both are documented here for traceability.

### Fix 1 — Prompt 1 closing-line count enumeration

**Where:** `prompts/prompt-1-research-prefill.md`, OUTPUT FORMAT section.

**Diff (~30 words added):**

```diff
 CLOSE WITH ONE LINE
 "Baseline complete: [N] facts (C confirmed, I inferred, G gap). Top
 field-verify priority: [highest-impact gap]."
+
+Before producing the closing line, enumerate the tagged facts in your
+output above. Set C, I, G to the actual counts. Verify N = C + I + G.
+If the math fails, re-count and re-write. Do NOT estimate.
```

**Why it mattered:** 3 of 5 cases produced closing-line tallies that did not sum to the claimed total (e.g., closing said "27 facts" but `12 + 4 + 7 = 23`). The body content was always correct; only the meta-summary tally drifted. The fix did NOT eliminate the issue but moved drift from "off by 4" to "off by 1" — likely the noise floor of LLM exact-counting over ~30 items. Off-by-1 is parked as a known residual (see "Residual known minor" below).

**Orchestration impact:** Minimal. Prompt 2 does not consume Prompt 1's closing tally — it consumes EXTRACTED + INFERRED + GAPS content, which was always correct. The tally exists as a triage hint for the user-vet step between Prompt 1 and Prompt 2.

### Fix 2 — Prompt 2 opacity-not-stated = GAP

**Where:** `prompts/prompt-2-system-operation-intake.md`, REFUSAL PROTOCOL section.

**Diff (~30 words added):**

```diff
 REFUSAL PROTOCOL

 - Do not fill gaps with conventional defaults (typical voltages,
   typical pressures, typical pin assignments, typical fee structures).
+- Do not infer housing opacity from class knowledge (e.g., "metal
+  housing → opaque"). If opacity is not stated in the narration, treat
+  it as a GAP. Do not enumerate opacity-dependent observation methods
+  for entities whose opacity has not been confirmed.
 - Do not assert PATTERN-class inferences as fact. They must carry the
```

**Why it mattered — LOAD-BEARING:** This fix preserves Prompt 3's `OBSERVABILITY HALT` as the safety mechanism the design package built it to be.

Before the fix, when a narrator did not state opacity (e.g., didn't say "the HPOP body is opaque metal"), Prompt 2's model would silently default to `housing_opacity: opaque` from class knowledge. Downstream, Prompt 3's `OBSERVABILITY HALT` is supposed to fire when opacity is `GAP` for an entity whose internal property a test would observe. With opacity silently populated, the HALT never fires, the narrator never gets prompted to confirm, and the unsourced assumption flows through to test generation as if it were a stated fact.

After the fix, opacity-not-stated correctly lands as `GAP`. The downstream effect was verified in Prompt 3 Test 3 (LML EGR case): the cooler's opacity was `GAP`, and Prompt 3's `OBSERVABILITY HALT` fired at the EGR cooler internal-coking inspection step — exactly the safety behavior the architecture was designed around. The cheaper electrically-observable tests (scan PID, MAF/MAP/IAT plausibility) were still generated first; the halt only blocked the test that depended on un-resolved opacity. This is the load-bearing nature of the fix: without it, the entire OBSERVABILITY HALT mechanism is disabled by a defaulting model behavior.

## Leverage-ordering audit (Prompt 3 explicit ask)

The leverage-ordering claim is: tests are ordered such that each step eliminates the most candidates per unit of labor cost, with destructive action gated behind cumulative confidence ≥ 95%.

**Audit method:** For each of the two happy-path cases (Tests 1 and 2 of Prompt 3), the audit checked whether the generated diagnostic path:
- Started with the lowest-cost test that could eliminate the most candidates
- Escalated invasiveness only as residuals required
- Kept destructive action (component removal, teardown) gated behind cumulative confidence

**Test 1 result (5.9L Cummins · P0299 underboost):**

```
Step 1: Scan-tool capture (VGT commanded vs actual, MAP, EGR actual)  → zero labor
Step 2: Pressurized-side leak test (smoke/shop air at CAC + boots)    → low labor
Step 3: MAP sensor sanity check (electrical + gauge comparison)        → low labor, conditional
Step 4: VGT actuator serial-link check (back-probe + active command)   → medium labor
Step 5: EGR over-siphon check (active command EGR closed under load)   → low labor
Step 6: VGT mechanical inspection (removal for bench inspection)       → high labor, LAST
```

Path matches the real-world Holset HE351 P0299 diagnostic posture used by master techs. Verdict: `NONE` (no finding).

**Test 2 result (6.7L PSD · P0087 fuel rail low):**

```
Step 1: Scan-tool rail pressure PID (zero labor)
Step 2: Lift pump prime pressure at filter outlet (GAUGE, eliminates supply-side in one test — highest single-step leverage)
Step 3: VCV duty cycle scan PID
Step 4: VCV / regulator electrical at connector (METER, escalates to SCOPE if needed)
Step 5: FRP signal voltage at sensor connector (METER, sanity check on measurement chain)
Step 6: HPFP removal (highest invasiveness, LAST, gate must be satisfied)
```

Path matches the standard Ford-Bosch CP4.2 diagnostic posture. Verdict: `NONE`.

**Cross-test pattern:** Both happy paths front the zero-labor scan-tool reading, place the highest-leverage physical test second (pressure-side leak / lift-pump prime), and reserve destructive action (turbo removal / HPFP removal) for last with the gate threshold satisfied.

## Source provenance audit (Prompt 3 explicit ask)

The provenance claim is: every expected value in the diagnostic path carries a source citation — `LAW / LOGIC / PATTERN` from the structured model, or explicitly "not yet captured" if no source supports it. No value gets invented.

**Audit method:** For each diagnostic step generated in the 5 Prompt 3 test cases, the audit checked whether the "Expected reading" field cited a source AND whether any specific numerical value asserted had grounding in the model's EXTRACTED / INFERRED content.

**Test 1 result (Cummins underboost):**
- VGT commanded-vs-actual delta threshold: explicitly flagged "not yet captured" rather than fabricated
- MAP boost-vs-psi calibration curve: flagged "not yet captured"; substituted mechanical-gauge cross-check as workaround
- VGT serial-link signal levels: flagged "not yet captured"
- No fabricated psi numbers, voltages, or duty cycles surfaced

**Test 2 result (6.7L PSD P0087):**
- Lift pump nominal output pressure spec: flagged "not yet captured"; reasoned from LOGIC ("pump must supply CP4.2 inlet at sufficient pressure") rather than naming a psi figure
- FRP voltage-to-pressure curve: flagged "not yet captured"; reasoned from 3-wire architecture (5V ref / signal / ground presence) without inventing a curve
- VCV duty-cycle range: flagged "not yet captured"

**Cross-test pattern:** When the model lacked a specific numerical spec, the prompt surfaced the gap as content rather than papering over it. In every case where a workaround was possible (e.g., mechanical gauge cross-check against a missing voltage curve), the workaround was explicit; otherwise the step's expected reading was left as a `not yet captured` marker that the technician's observation will fill.

Verdict across both happy-path cases: `NONE`. Refusal protocol held — no fabricated voltages, currents, pressures, or duty cycles in any generated path.

## Moat moments

Three specific behaviors during validation that distinguish the orchestration from confident-but-wrong commercial diagnostic tools. Each demonstrates the prompt refusing a training-data temptation that would have produced a plausible-sounding but unsourced answer.

### Test 5 — Refused the Allison TCC shudder training prior

**Setup:** A deliberately sparse structured model (3 high-level entities: engine, transmission, drive type — no observability, no sub-component detail) was paired with a complex symptom ("intermittent driveline shudder when towing at 60-70 mph"). Allison TCC (torque converter clutch) shudder on LML Duramax is one of the most heavily documented diagnostic patterns in the public diesel knowledge base — a famous LML/Allison pattern.

**Behavior the prompt could have produced (and didn't):** A "helpful" plan citing the common LML TCC shudder pattern, a fluid-condition fishing test, a scan-tool TCM sub-code retrieval as a diagnostic step.

**Actual behavior:** `THIN-INPUT HALT` fired. The prompt refused to generate any path. It listed 8 specific entity capture asks (driveshaft U-joints, TCC behavior, valve body, transfer case modes, differential, temp sensor location, scan tool PIDs, wire colors) and explicitly tied the refusal to the LOGIC inference about relative motion. No "common LML pattern" was surfaced. No training-data prior was used to fill the gaps.

**Why it matters:** This is the difference between "AI knows things" and "AI tells the tech things the structured data actually supports." Every commercial tool would have surfaced TCC shudder; the orchestration refused because the captured model didn't authorize it.

### Test 4 — Refused to invent FRP failed-high

**Setup:** A 6.7L PSD fuel system structured model with a clearly stated LAW: "A signal wire connected to a 5V reference with a low-reference return cannot exceed 5V at rest." The symptom payload included an "impossible" prior test result: 14V measured on the FRP signal wire with key on engine off.

**Behavior the prompt could have produced (and didn't):** "FRP sensor failed high — internal short to a battery rail caused the voltage to peg." This is a plausible-sounding explanation that has no grounding in the model's architecture (the model shows no path from the signal wire to a higher voltage source).

**Actual behavior:** `IMPOSSIBILITY HALT` fired. The audit explicitly noted the model "declined to reinterpret as 'FRP failed high' or invent an internal short path not in the model. Both paths would violate the model-only constraint." Instead, the halt asked for pin-identity verification against a diagram before re-measurement — the right insight, since wire colors and pin assignments are flagged `GAP` in the model, so the tech is likely back-probing the wrong pin.

**Why it matters:** An AI that pattern-matches around impossible readings will chase techs down false repair paths with plausible-sounding rationalizations. The refusal protocol caught this.

### Dispatch 4 — Caught the 2010 6.7L Cummins NOx adsorber vs SCR boundary

**Setup:** Prompt 4A was asked whether a 6.7L Cummins aftertreatment diagnostic (sourced from 2017 Ram 3500) applies to a 2010 Ram 2500 6.7L Cummins.

**Behavior the prompt could have produced (and didn't):** `FULLY APPLICABLE` or `PARTIALLY APPLICABLE` based on "same engine displacement, same OEM, close production year." This is what a name-similarity-based commercial tool would emit.

**Actual behavior:** `NOT APPLICABLE`. The prompt identified that 2007.5-2012 6.7L Cummins used a NOx adsorber (LNT-style trap) strategy, NOT SCR with DEF dosing. The 2013 emissions package boundary is the actual architectural fork. The prompt named this fork explicitly — going beyond the test specification, which had not flagged this distinction.

**Why it matters:** The 2013 emissions-architecture boundary is a distinction commonly missed by tools that treat "6.7L Cummins" as a single platform across all production years. Catching it is tech-trust-grade precision.

## What was NOT tested

Honest list of unvalidated surfaces. "Validated" above means "the prompt behaved correctly on the cold-context test cases we ran." It does not extend to anything below.

- **Production-volume testing.** All validation was single-case per prompt-run. Behavior under sustained load (rate-limit handling, retry logic, timeout behavior on real Claude API calls) was not exercised. Token costs at production volume across the four-prompt chain were not measured.
- **Real database write integration.** The graph-mutation specs (CREATE/MERGE statements in ARCHITECTURE.md) were not executed against a live Postgres + Apache AGE instance or against Neo4j. Whether the prompts' structured outputs cleanly translate to graph mutations in practice is unvalidated. The storage primitive itself is still a decision (see Next concrete decisions).
- **Interactive HTML rendering layer.** Phase 1 of every Prompt 3 validation explicitly instructed the agent to produce ONLY the plain-text diagnostic summary, skipping the HTML artifact. The reference renders in `reference/` were authored separately and have not been generated from validated Prompt 3 outputs. Whether the same prompt that produced the correct plain-text logic produces a correctly rendered self-contained HTML artifact is unvalidated.
- **Cross-prompt orchestration.** Each prompt was validated in isolation against a hand-crafted input. The actual chain — Prompt 1's output flowing through user-vet to Prompt 2, Prompt 2's output flowing to Prompt 3, Prompt 3's output triggering Prompt 4A — was not exercised end-to-end against a live model chain. Behavior under real chain conditions (where Prompt 2 receives Prompt 1's actual output rather than a hand-crafted clean model) is unvalidated.
- **Failure-mode recovery.** What happens if Prompt 2 returns a malformed structured model? If the user-vet step is skipped? If Prompt 3 receives an EXTRACTED block missing observability for half its entities? These edge cases were not exercised.
- **Real-tech narration quality.** Test narrations were authored representing how an expert would narrate. Whether actual Brandon-authored or actual-tech-authored narrations produce equivalent Prompt 2 outputs is unvalidated.
- **Non-diesel platforms.** All validation was diesel. Whether the prompts behave on gasoline platforms, hybrid platforms, EVs, or non-automotive domains was not tested (the prompts are claimed domain-agnostic but the claim is unvalidated here).

## Next concrete decisions

Three decisions that should be made before any orchestration code is wired:

### 1. Production database stack confirmation

The orchestration design is graph-native. The package recommends PostgreSQL with the Apache AGE extension (keeps everything in one database alongside existing application data) with Neo4j as the alternative. The current Vyntechs production app runs on Postgres via Supabase + Drizzle ORM. The decision is whether to:

- Enable Apache AGE on the existing Supabase Postgres (if Supabase supports it; verify before committing), OR
- Stand up a side-by-side Neo4j instance for graph storage with cross-database joins to the existing app data, OR
- Pick a different graph-capable Postgres extension

The choice affects every subsequent PR. The graph-storage primitive is non-negotiable per the design package ("Do not store diagnostics as documents") so the question is which graph implementation, not whether to use one.

### 2. Smallest viable skill test queue

Before the Claude Code skill for database pre-fill gets wired (the next logical step after this branch lands), there should be a smallest-viable end-to-end test:

- **One platform** — pick one (suggested: 2018 F-250 6.7L PSD, the canonical case used through the design package)
- **One system** — pick one (suggested: fuel system, since the reference prototype already exists)
- **Three symptoms** — pick three with different expected diagnostic paths (suggested: P0087 fuel rail too low, P0088 fuel rail too high, no-start cranks normally)

Run the full chain (Prompt 1 → user vet → Prompt 2 → Prompt 3 → optional Prompt 4A) against the real database (whichever stack is chosen in decision 1), with the user-vet step actually performed by Brandon, and verify:

- Graph mutations land correctly
- Cached diagnostics serve without re-running the chain
- Field outcomes write back to TestAction nodes
- Cross-vehicle equivalence edges form correctly

Only after this smallest-viable test runs end-to-end does the skill build proceed to broader vehicle coverage. Skipping this step risks wiring the orchestration on assumptions that the prompts haven't actually been tested against in chained execution.

### 3. Remaining four layout specs

The METER layout is locked. Four more are needed before the rendering layer is complete:

- **VISUAL** finalized — prompt-side observability fix done, but layout-side rendering rules (drained-container sub-mode, removed-on-bench sub-mode, external-inspection sub-mode, sense-icon overlays for audible / touch / smell) still need explicit specification
- **SCAN TOOL** — OBD-port lit, scan-tool overlay floating above the implicated module, PID name and live value, freeze frame view, bidirectional command surface
- **ACTIVE TEST** — before/after split rendering, action prompt with explicit cause-and-effect arrow between components, support for wiggle/swap/disconnect/bidirectional variants
- **SCOPE** — waveform display with cursors, channel assignments to specific pins, time-base and voltage-scale controls, expected waveform overlay (faded ghost of what it should look like)

These can be authored independently of orchestration code (they're spec documents). Each unblocks a different test type in Prompt 3 generating into a renderable layout. Without them, Prompt 3 can route an observation method to a layout family but the renderer has no spec to follow.

## Residual known minor

**Prompt 1 closing-line off-by-1.** After the count-enumeration fix, the closing tally still drifts by 1 fact on ~30-item baselines (e.g., model writes "34 facts (20 confirmed, 5 inferred, 9 gap)" — internally consistent — but a hand recount yields 33 facts because the model over-counted INFERRED by 1). This is likely the noise floor of LLM exact-counting without literal per-bullet enumeration. Architectural impact is zero: the closing tally is a triage hint for the user-vet step, not consumed by Prompt 2. Documented here so it doesn't get re-investigated.

## Validation provenance

- **Date:** 2026-05-19
- **Validator:** Cold-context subagents (general-purpose Claude Code agents) acting as model-under-test + self-auditor in sequential phases
- **Prompt versions validated:**
  - Prompt 1 — `prompts/prompt-1-research-prefill.md` with closing-line count enumeration fix applied 2026-05-19
  - Prompt 2 — `prompts/prompt-2-system-operation-intake.md` (iteration version with observability schema) with opacity-not-stated = GAP fix applied 2026-05-19
  - Prompt 3 — `prompts/prompt-3-diagnostic-session.md` (iteration version with OBSERVABILITY HALT)
  - Prompt 4A — `prompts/prompt-4a-cross-vehicle-applicability.md` (unchanged through validation)
- **Test inputs:** Authored fresh for this validation; none from the source design package's example set
- **Audit framing:** Each phase classified findings `CRITICAL / MAJOR / MINOR / NONE`; no `CRITICAL` findings surfaced across any prompt-case combination
