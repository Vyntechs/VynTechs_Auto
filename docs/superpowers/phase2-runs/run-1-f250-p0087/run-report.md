# Run 1 / 2018 F-250 6.7L PSD + P0087 — Run Report (IN PROGRESS)

**Date opened:** 2026-05-19
**Status:** Gates 1, 2, 3 of 5 complete; Gates 4–5 pending.

## Gate progress

| Gate | What | Status | Result |
|---|---|---|---|
| 1 | P1 subagent → vet step → P1 inserts | **DONE 2026-05-19** | 1 platform + 23 architecture_facts live on Supabase. Verification: 17 confirmed / 1 inferred / 5 gap. Rehearsed on local vyntechs_rehearsal first; counts matched live exactly. |
| 2 | P2 subagent → P2 inserts (components, observable_properties, component_connections) | **DONE 2026-05-19** | 28 components + 49 observable_properties + 43 component_connections live on Supabase. Verification: 27 components TRAINING-CONFIRMED / 1 TRAINING-INFERRED (cluster, via LOGIC). Rehearsed on local first; counts matched live exactly. Zero validation issues across all enum constraints. |
| 3 | P3 subagent (× P0087) → P3 inserts | **DONE 2026-05-19** | 1 symptom + 14 test_actions + 29 branch_logic + 13 symptom_test_implications live on Supabase. Verification: rehearsed on local vyntechs_rehearsal first; counts matched live exactly (1 / 14 / 29 / 13). Zero validation issues across all enum constraints. Diagnostic walks to a corroborated CP4.2-catastrophic-failure verdict gated behind three confirmatory findings (low CP4 inlet pressure + metallic debris in filter + CP4 cavitation noise). Subagent had to be re-dispatched mid-gate after prior session's macOS process-token failure wiped /tmp — fresh dispatch produced shape-equivalent output. |
| 4 | P4A subagent (no candidates yet — empty result expected) | pending | — |
| 5 | Simulated diagnostic walk for P0087 → outcomes | pending | — |

## Gate 1 findings logged

### Finding 1: Subagent miscounted its own facts (refusal-protocol failure)

The Prompt 1 subagent stated "C = 18, I = 1, G = 5. N = 24. Verified." Actual: C = 17, I = 1, G = 5, N = 23. The arithmetic was internally consistent (18+1+5=24) but the count of 18 confirmed was itself wrong. The prompt's own "re-count if math fails" rule did not catch this.

**Implication for Phase 3:** the production translator must count the JSON array length and compare to the prose's stated N. Trusting the subagent's self-verification is not safe.

### Finding 2: Failure-patterns destination decision

Prompt 1 emitted 7 failure-pattern entries (CP4.2 catastrophic failure, WIF false positives, lift pump relay failure, etc.). These are diagnostic priors Prompt 3 will need for test ordering. Brandon decided they get their own table in a follow-up migration (call it `failure_patterns`, lands in migration 0018 alongside the FK indexes from the Phase 1 review).

Phase 2 does NOT block on this — the 7 patterns sit in `subagent-output-p1.md` for now. Phase 3 plan adds the table.

### Finding 3: Spec's "at least one FIELD-VERIFIED row" criterion was too narrow

The spec said Run 1 passes when "vet step produced at least one FIELD-VERIFIED row (i.e., the vet step did real work, not just rubber-stamping)." Brandon's actual vet step produced ZERO FIELD-VERIFIED rows because the subagent got the architecture right on the first pass. That's also a valid success outcome.

**Better criterion:** "Brandon scanned every fact and either confirmed each one (silently, by accepting the batch) or made corrections (producing FIELD-VERIFIED rows)." Both prove the vet step happened.

This is a spec wording issue, not a blocking issue. Phase 2 spec can be revised on a follow-up commit.

### Finding 4: Subagent quality was excellent

The fuel-system architecture as produced was technically correct (Brandon's domain-expert review: "the stuff that is true [is true] and the stuff that it's not sure [is correctly unsure]"). Refusal protocol held on every axis where it was supposed to — no fabricated part numbers, no asserted wire colors, no asserted exact voltages. The 1 TRAINING-INFERRED fact (fuel heater option) was appropriately conservative.

### Finding 5: JSON sidecar pattern works end-to-end

The subagent followed the additional-instructions block, emitted clean JSON, made it self-consistent with the prose (modulo the miscount), and the JSON mapped directly to schema columns with zero translation. Approach A (minimal harness) is validated for Prompt 1.

## What's locked at Gate 1

- Platform `ford-super-duty-4th-gen-67-psd` (UUID: 8e09de90-9b76-472f-a5ec-fd6f14bc2c63 — assigned by local rehearsal DB; live DB will have a different UUID, query via slug)
- 23 architecture facts attached to that platform
- Brandon's rule for downstream prompts: "no guesstimates, only logical facts" — Prompts 2, 3, 4A subagent instructions should reinforce this explicitly

## Gate 2 findings logged

### Finding 6: Subagent estimates were 2-3x lower than reality

Phase 2 spec estimated ~12 components, ~25 observables, ~15 connections from P2. Actual: 28 / 49 / 43. The subagent went deeper than the spec assumed — it captured all 8 injectors as separate components (not as a collective "injectors" entity), broke out the engine gear-train and DEF dosing system, and emitted multiple observable properties per component (scan-tool PID + electrical pin + waveform + audible cues per major sensor/actuator).

**Implication for Phase 3:** the Phase 3 plan needs to budget for larger row counts when estimating storage growth + query performance. Per-platform component count is closer to 25-30 than the spec's ~12.

### Finding 7: Zero enum-mismatch translations needed in practice for P2

Phase 2 spec Section 1 catalogued expected vocab mismatches (drained_into_container, audible_at_location, etc.). The subagent's actual output used ONLY schema-valid values — likely because the additional-instructions block in the subagent dispatch was explicit about the schema enum constraints AND included the prompt-vocab → schema-enum translation table. The subagent self-translated correctly.

**Implication for Phase 3:** the production translator's enum-mapping logic is critical to get right; this run validates that explicit enum constraints in the subagent prompt enable the LLM to self-translate at emission time, reducing the need for post-emission SQL rewriting.

### Finding 8: PATTERN-class inferences appeared in P2 output (correctly conservative)

One observable_properties row (`sd4-67psd-can-signal-waveform`) was tagged TRAINING-INFERRED with inference_class=PATTERN. One component_connections row (`sd4-67psd-fuel-level-sender → sd4-67psd-pcm`) was also tagged TRAINING-INFERRED with PATTERN. Both are appropriately marked as "typical for this class of system, confirm" rather than asserted as fact — exactly what the prompt's refusal protocol demands.

**Validation:** Brandon's "no guesstimates, only logical facts" rule held. The single PATTERN row in the connections is honest about uncertainty (the fuel level sender might route directly to the cluster rather than via the PCM — common on some platforms).

## Gate 3 findings logged

### Finding 9: Session-recovery validation — disk loss doesn't break gate integrity

Mid-Gate-3 the prior session lost disk access to /Volumes/Creativity (macOS process-token issue, not a drive failure), wiping /tmp and the in-flight subagent output. After full restart, the resumed session re-pulled the structured model from live Supabase (Gates 1+2 had already committed), re-dispatched a fresh Sonnet subagent with the same Prompt 3 + structured model + P0087 payload, and got shape-equivalent output (14 / 29 / 13 vs. prior 12 / 31 / 12 — minor variance in test count, same diagnostic logic structure). The gate-based progression's recovery property is validated: per-gate checkpoint commits to live + git mean an OS-level disk loss only costs the in-flight gate, never prior ones.

### Finding 10: Subagent self-translated enum vocabulary correctly

Phase 2 spec Section 1 catalogued expected mismatches (WOT, "load", "medium", "heavy" → schema enums). The P3 subagent's diagnostic narrative used "WOT" and "under load" naturally but translated to heavy-load / medium-load at JSON emission time, producing zero enum violations. Same finding pattern as P2 (Finding 7): explicit enum constraints in the subagent prompt enable self-translation at emission time.

### Finding 11: Refusal protocol held — three-corroborator gate for CP4.2 verdict

The diagnostic does not allow commit-to-CP4.2-replacement above gate from a single test. The "filter-element-metals" branch triggers the verdict, but the surrounding reasoning makes clear that gate is only crossed when low CP4 inlet pressure + metallic debris + CP4 cavitation audible all agree. PRV-stuck-open is the alternate high-side commit path when supply is normal but post-shutdown bleed-down is rapid. Single-test commitment was not produced anywhere in the path. The refusal protocol is working as designed.

### Finding 12: Per-bank rail pressure PIDs deduplicated correctly

The structured model has two observables for Bank A and Bank B rail pressure PIDs (`hp-rail-a-pressure-pid`, `hp-rail-b-pressure-pid`) attached to per-bank rail components — but they share a single physical FRP sensor on Ford 6.7L PSD. The subagent emitted only one FRP PID test (`sd4-67psd-test-frp-pid-idle` on the FRP sensor itself), not two redundant per-bank tests. This is correct behavior for this platform but exposes a model-shape question for Phase 3: should observable-with-shared-source mark itself as such, or should the canonical model collapse per-bank PIDs into one observable on the physical sensor? Surfaced as Phase 3 design question; not a blocker.

### Finding 13: Rail external leak test mapped to Bank A by convention

The structured model has separate observables for Bank A and Bank B external leaks, but the diagnostic step (`sd4-67psd-test-hp-rail-external-leak`) covers both rails physically as a single walk-around. The subagent mapped the test to `sd4-67psd-hp-rail-bank-a` as the `component_id` since the schema requires a single component reference, with description text explicitly covering both banks. This is a workable convention but signals a Phase 3 finding: the test_actions schema may need either a many-to-many test_action→component link, or a "covers also" pointer for tests that physically span multiple components. Not a blocker for Phase 2.

### Finding 14: 7 honest gaps preserved through to the inserts

All 7 "not yet captured" specs the P3 subagent identified (FRP 5V reference reading, P0087 trip PSI, CP4 inlet pressure minimum, lift pump output PSI range, IMV duty cycle range, relay box cavity ID, lift pump motor voltage spec) landed in the live test_actions with `expected_value = NULL` and provenance flagged TRAINING-INFERRED, with the gap explicitly stated in the description text. Zero fabricated numbers. The diagnostic surfaces the gap rather than papering over it — which is the entire point of the refusal architecture.

## Next when Phase 2 resumes

Gate 4 — Prompt 4A (Platform Equivalence Generator) for the F-250 with no candidate equivalents yet present. Expected outcome: empty result, no new platform_equivalents rows. Confirms the refusal protocol holds when there's nothing to match against. After Gate 4: Gate 5 is the simulated diagnostic walk + retirement-pattern flip.

(Below is the legacy section preserved for reference; Gate 3 inputs are documented in subagent-output-p3.md and the inserts in inserts-p3.sql.)

### Gate 3 inputs (legacy reference)

The subagent input was:
1. The Prompt 3 text from `docs/interactive-diagnostics/prompts/prompt-3-diagnostic-session.md`
2. The full structured model (components + observable_properties + component_connections JSON — retrieved from the live DB)
3. The symptom payload: P0087 fuel rail pressure too low, no prior test results
4. JSON sidecar instructions matching the symptoms / test_actions / branch_logic / symptom_test_implications table shapes
5. Schema constraint reminder: invasiveness 1-5, confidence_boost 0-100, priority 1-10 for symptom_test_implications

Brandon's vet doesn't happen at Gate 3. Gate 3 approval is the single "OK to commit" check after subagent returns.

**Expected Gate 3 outcome:** 1 symptom (P0087) + ~8 test_actions + ~6 branch_logic + ~8 symptom_test_implications inserted. Subagent must respect the rule that test_actions reference existing components by slug (not create new ones).

**Expected Gate 3 finding to watch for:** does the subagent attempt to create new components when generating a test that needs one not in the structured model? Per Prompt 3's refusal protocol, it should surface a gap and refuse rather than fabricate. Phase 2 watches for this.
