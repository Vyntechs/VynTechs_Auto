# Run 1 / 2018 F-250 6.7L PSD + P0087 — Run Report (IN PROGRESS)

**Date opened:** 2026-05-19
**Status:** Gate 1 of 5 complete; Gates 2–5 pending.

## Gate progress

| Gate | What | Status | Result |
|---|---|---|---|
| 1 | P1 subagent → vet step → P1 inserts | **DONE 2026-05-19** | 1 platform + 23 architecture_facts live on Supabase. Verification: 17 confirmed / 1 inferred / 5 gap. Rehearsed on local vyntechs_rehearsal first; counts matched live exactly. |
| 2 | P2 subagent → P2 inserts (components, observable_properties, component_connections) | **DONE 2026-05-19** | 28 components + 49 observable_properties + 43 component_connections live on Supabase. Verification: 27 components TRAINING-CONFIRMED / 1 TRAINING-INFERRED (cluster, via LOGIC). Rehearsed on local first; counts matched live exactly. Zero validation issues across all enum constraints. |
| 3 | P3 subagent (× P0087) → P3 inserts | pending | — |
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

## Next when Phase 2 resumes

Gate 3 — Prompt 3 (Diagnostic Session Generator) for P0087 (fuel rail pressure too low). The subagent input is:
1. The Prompt 3 text from `docs/interactive-diagnostics/prompts/prompt-3-diagnostic-session.md`
2. The full structured model (components + observable_properties + component_connections JSON — retrieved from the live DB)
3. The symptom payload: P0087 fuel rail pressure too low, no prior test results
4. JSON sidecar instructions matching the symptoms / test_actions / branch_logic / symptom_test_implications table shapes
5. Schema constraint reminder: invasiveness 1-5, confidence_boost 0-100, priority 1-10 for symptom_test_implications

Brandon's vet doesn't happen at Gate 3. Gate 3 approval is the single "OK to commit" check after subagent returns.

**Expected Gate 3 outcome:** 1 symptom (P0087) + ~8 test_actions + ~6 branch_logic + ~8 symptom_test_implications inserted. Subagent must respect the rule that test_actions reference existing components by slug (not create new ones).

**Expected Gate 3 finding to watch for:** does the subagent attempt to create new components when generating a test that needs one not in the structured model? Per Prompt 3's refusal protocol, it should surface a gap and refuse rather than fabricate. Phase 2 watches for this.
