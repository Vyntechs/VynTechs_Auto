# Run 1 / Prompt 1 — Vet Notes

**Date:** 2026-05-19
**Vetting authority:** Brandon Nichols (founder / domain expert / 2018 F-250 6.7L PSD owner)
**Subagent output:** `subagent-output-p1.md`

## Vet result

**Outcome:** all 23 architecture facts accepted as-emitted by the subagent. No corrections, no additions, no deletions.

**Tag distribution preserved:**
- TRAINING-CONFIRMED: 17 facts
- TRAINING-INFERRED: 1 fact (sd4-67psd-fuel-heater-option)
- GAP: 5 facts (WIF sensor signal details, CP4.2 max rail pressure exact value, rail pressure relief valve cracking pressure, lift pump relay cavity, OEM fuel filter part number)

**Zero rows promoted to FIELD-VERIFIED.** Brandon endorsed the architecture as-drawn; his expert judgment was "this is true; the unsure stuff is correctly marked unsure; I can fill in the gaps later."

## Rule reinforced by Brandon during vet

> "I don't want guesstimates put in it. Only the logical facts."

This maps cleanly to the existing prompt design:
- TRAINING-CONFIRMED + FIELD-VERIFIED = the logical facts (use freely)
- TRAINING-INFERRED = derived from related platforms, NOT confirmed for this one (use with caution, or escalate to GAP if Brandon catches it)
- GAP = honest "we don't know yet" (never substitute a guess)
- Prompt 1's refusal protocol on wire colors / pin assignments / exact voltages / mid-year part supersessions / PCM cal versions held perfectly on this run

**Carries forward to Prompts 2, 3, 4A:** subagent instructions for those prompts should explicitly reinforce the no-guesstimate rule. If a prompt is tempted to fill a gap with conventional defaults (typical voltages, typical pin assignments), that's a refusal-protocol failure — same as Prompt 1.

## Phase 2 finding logged from vet step

**Failure-patterns destination decision:** Brandon picked option A — failure patterns get their own table in a follow-up migration. Phase 2 documents the 7 patterns from this P1 run in prose; they're not inserted as rows yet. The `failure_patterns` table lands as part of migration 0018 (along with the FK indexes from the Phase 1 review).

Implication for Phase 3: when Prompt 3 builds a diagnostic, it reads `failure_patterns` for the relevant platform to weight test ordering. Without this table, Prompt 3 has no priors — it would build the diagnostic from architecture topology alone, missing the "CP4.2 catastrophic failure is the most common cause" weighting.

## Translation from JSON to DB rows

The vetted JSON drives both:

1. **The SQL INSERT batch** — file at `inserts-p1.sql` in this directory. One platform row + 23 architecture_facts rows. No translation needed; JSON fields map 1:1 to schema columns.
2. **The narration that flows into Prompt 2** — a plain-English description of the fuel system, generated from the vetted facts. This becomes the user message to the Prompt 2 subagent when Phase 2 proceeds.
