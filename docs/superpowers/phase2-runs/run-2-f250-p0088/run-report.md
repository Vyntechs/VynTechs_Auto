# Run 2 / 2018 F-250 6.7L PSD + P0088 — Run Report

**Date opened:** 2026-05-19
**Date closed:** 2026-05-19
**Status:** DONE. Single P3 dispatch (platform + components + observables + connections already in place from Run 1).

## What landed

- 1 symptom row (`p0088-fuel-rail-pressure-too-high`, category `dtc`)
- 7 NEW test_actions (FRP under load, FRP waveform under load, IMV PWM waveform, IMV solenoid resistance, PRV external leak visual, return back-pressure gauge, PRV internal condition)
- 23 branch_logic rows (2 of which were collision-renamed with `-p0088` suffix because the natural slug already existed in Run 1 with different next-action routing)
- 12 symptom_test_implications (7 link to the new test_actions; 5 link to Run 1's existing test_actions — the in-platform cache-hit pattern at work)

## Gate progress

Single gate. Rehearsal on `vyntechs_rehearsal` → 1/7/23/12. Live Supabase → 1/7/23/12. Counts match exactly.

## Findings logged

### Finding 21 (Run 2): branch_logic slug collisions across symptoms

Two natural branch slugs (`branch-imv-duty-normal`, `branch-frp-5v-ref-ok`) collided with Run 1's branches. The semantic content of the same-slug branches DIFFERS between symptoms because the next-action routing depends on the symptom — e.g., for P0087 (under-pressure) a "normal IMV duty cycle" routes to lift pump checks (supply-side); for P0088 (over-pressure) the same observation routes to PRV bleed-down (high-side leak). Solution applied: suffixed the colliding Run 2 branches with `-p0088` (`branch-imv-duty-normal-p0088`, `branch-frp-5v-ref-ok-p0088`). Phase 3 design question: should branch_logic carry a `symptom_id` to make this identity-correct, or should next_action be dynamically derived from `symptom_test_implications` priorities at retrieval time? Either approach removes the slug-collision hack.

### Finding 22 (Run 2): P3 reuse pattern works for in-platform multi-symptom

The subagent received the 14 existing Run 1 test_action slugs in the dispatch prompt and correctly reused 5 of them in symptom_test_implications (FRP PID idle, IMV duty cycle PID, PRV bleed-down PID, FRP 5V ref, FRP signal) rather than emitting duplicates. This is the in-platform cache-hit pattern working — Phase 3's skill will look at the existing test_action library before adding new ones. The reuse-vs-new ratio (5 reused / 7 new for a closely-related DTC) is reasonable; for more orthogonal symptoms expect more new tests (Run 3 confirms this — 12 reused / 7 new for no-start).

### Finding 23 (Run 2): Diagnostic walks to multiple terminal paths, not single root cause

Unlike Run 1's CP4.2 catastrophic path which reached a single highest-confidence verdict, the P0088 diagnostic has 4 distinct terminal paths depending on which evidence corroborates first:
1. FRP sensor false-high (sensor electrical fault — sensor replacement only)
2. IMV stuck closed / coil fault (IMV replacement — coil resistance or PWM waveform path)
3. PRV stuck closed (PRV replacement only — requires invasive internal inspection)
4. Return circuit restriction (return line repair — pressure measurement at injector return port)

The refusal protocol holds across all 4 paths: none cross gate from a single test. Each requires its corroborating evidence chain before commit recommendation. This validates the refusal architecture across symptom shapes — not just the CP4.2-catastrophic gold-standard case.
