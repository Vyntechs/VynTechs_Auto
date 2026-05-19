# Run 1 / 2018 F-250 6.7L PSD + P0087 — Run Report (IN PROGRESS)

**Date opened:** 2026-05-19
**Status:** Gate 1 of 5 complete; Gates 2–5 pending.

## Gate progress

| Gate | What | Status | Result |
|---|---|---|---|
| 1 | P1 subagent → vet step → P1 inserts | **DONE 2026-05-19** | 1 platform + 23 architecture_facts live on Supabase. Verification: 17 confirmed / 1 inferred / 5 gap. Rehearsed on local vyntechs_rehearsal first; counts matched live exactly. |
| 2 | P2 subagent → P2 inserts (components, observable_properties, component_connections) | pending | — |
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

## Next when Phase 2 resumes

Gate 2 — Prompt 2 (System Operation Intake). The subagent input is:
1. The Prompt 2 text from `docs/interactive-diagnostics/prompts/prompt-2-system-operation-intake.md`
2. A plain-English narration of the fuel system, synthesized from the 23 vetted architecture facts
3. JSON sidecar instructions matching the components / observable_properties / component_connections table shapes

Brandon's vet doesn't happen again at Gate 2 (the vet step is between P1 and P2 only). Gate 2 approval is the single "OK to commit these inserts to live Supabase" check after the subagent returns.

**Expected Gate 2 outcome:** ~12 components, ~25 observable_properties, ~15 component_connections inserted. Subagent may surface enum-mismatch translation cases (Phase 2 spec Section 1 table) — those become run-report additions.
