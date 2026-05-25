# Run 3 / 2018 F-250 6.7L PSD + No-Start (Cranks Normally) — Run Report

**Date opened:** 2026-05-19
**Date closed:** 2026-05-19
**Status:** DONE. Single P3 dispatch on a drivability complaint (NO DTC), not a fault code.

## What landed

- 1 symptom row (`no-start-cranks-normally-fuel-system-suspect`, category `no-start`)
- 7 NEW test_actions (DTC scan initial, fuel-quality smell test, RPM PID during cranking, FRP PID during cranking, IMV duty cycle during cranking, injector duty cycle during cranking, injector PWM waveform during cranking)
- 31 branch_logic rows (8 of which were collision-renamed with `-nostart` suffix because the natural slug already existed in Run 1 with different next-action routing for the under-pressure case)
- 19 symptom_test_implications (7 link to new test_actions; 12 link to existing Run 1 test_actions — the highest reuse ratio of any run so far)

## Gate progress

Single gate. Rehearsal on `vyntechs_rehearsal` initially failed with 5 VALUES-column-count errors (missing `meter_mode` NULL position in the 5 rows that had numeric expected_value); fixed by edit and re-rehearsed clean → 1/7/31/19. Live Supabase → 1/7/31/19. Counts match.

## Findings logged

### Finding 24 (Run 3): Diagnostic symptoms work, not just DTCs

This is the first run that uses a customer-complaint (drivability) symptom rather than a numeric DTC. The category `no-start` was added in the symptoms enum at Phase 1 schema design; Run 3 is its first real population. The diagnostic walk works the same way structurally — same test_actions, same branch_logic, same symptom_test_implications, same refusal protocol — but the entry point is a sentence ("cranks normally but won't start") instead of a code. Phase 3 implication: the skill's user-facing UI should accept either a DTC or a free-text drivability complaint, and the underlying retrieval logic should be symptom-agnostic about which kind it's looking up.

### Finding 25 (Run 3): Cranking scenario is its own beast

Run 1 (P0087 at idle) and Run 2 (P0088 under load) both had observable engine states. Run 3 (no-start) cannot reach idle, so existing idle-scenario tests like `test-frp-pid-idle` and `test-imv-duty-cycle-pid` were NOT reused — Run 3 emitted new `*-cranking` variants instead. This validates the `scenario_required` enum doing real work: scenario IS part of test identity, not just metadata. A test "read FRP PID" at idle is fundamentally a different test from "read FRP PID" during cranking. The structured model's scenario list captured both; the subagent correctly picked the cranking variants for this symptom.

### Finding 26 (Run 3): Outside-model gaps surfaced honestly

The no-start symptom hits two boundary conditions the current structured model doesn't cover:
1. **Crank/cam sensor circuit** — referred to indirectly via the `test-rpm-pid-cranking` test (which observes RPM via PCM on HS-CAN, a proxy), but the actual cam/crank sensor circuit is NOT a component in the model. A `branch-rpm-zero-during-crank` returns an OBSERVABILITY HALT instead of a diagnostic step, telling the technician to escalate to the wiring diagram for sensors outside the structured model boundary.
2. **Compression/injector mechanical** — at the end of the diagnostic walk if all fuel-system tests pass but engine still won't start, `branch-injector-pwm-present` returns "fuel system exonerated; suspect compression or injector mechanical (outside model)". This is the refusal protocol's THIN-INPUT HALT working correctly: rather than guess, the system surfaces the model boundary as content.

This is exactly the behavior the design intended — Phase 3 should preserve these honest "outside-model" terminations rather than papering them over.

### Finding 27 (Run 3): Highest reuse ratio so far

12 reused (from Run 1) / 7 new = 63% reuse. Compare:
- Run 1: 0 reused / 14 new (cold-start case — no prior platform data)
- Run 2: 5 reused / 7 new = 42% reuse (closely-related DTC)
- Run 3: 12 reused / 7 new = 63% reuse (broad supply-side symptom)

The reuse ratio scales with symptom breadth — a broad symptom (no-start can be anywhere in fuel supply) draws on more existing tests than a narrow symptom (P0088 only implicates the over-pressure regulation loop). This is a Phase 3 design hint: the skill's first action for a new symptom should be a broad scan of existing test_actions before deciding what to add.

### Finding 28 (Run 3): SQL VALUES column-count error caught at rehearsal

5 test_action rows had only 14 VALUES fields where 15 were needed (omitted the `meter_mode` NULL slot in rows that jumped straight to a numeric `expected_value`). Caught at the local rehearsal stage with a clean "VALUES lists must all be the same length" error message; fixed and re-rehearsed clean before live application. The rehearse-then-live pattern absorbed this mistake without affecting prod. Local rehearsal continues to earn its keep.
