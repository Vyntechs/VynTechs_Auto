# PR-C/A · Resume from Task 15 — Push + Open PR

**Date:** 2026-05-23 (afternoon, third handoff)
**Branch:** `feat/topology-guided-walk`
**Last commit:** `0fae080` (`docs(handoff): resume kickoff for PR-C/A Tasks 14-15`)
**Working tree:** clean (no modified/staged files from prior session)

**Brandon's one-line paste to start the resume session:**

```
Read docs/superpowers/handoffs/2026-05-23-pr-c-a-resume-from-task-15.md and continue executing PR-C/A. You should be on branch feat/topology-guided-walk; if not, git fetch && git switch feat/topology-guided-walk.
```

---

## Where we are

Tasks 1–14 ✅. **Only Task 15 (push + PR) remains.**

| Task | Status |
|---|---|
| 1–13 | ✅ from handoff `2026-05-23-pr-c-a-resume-from-task-14.md` |
| 14. End-to-end loader smoke-test | ✅ Verified live data shape — all checks pass |
| 15. **Push branch + open PR** | pending |

### Task 14 evidence (so fresh session can skip re-verifying)

Smoke-test run against session `681de115-5de9-474e-9721-263f65066e08` (F-350 / P0087) via a throwaway `scripts/smoke-loader.ts` (deleted after run). All expected checks passed:

| Check | Expected | Actual |
|---|---|---|
| Components in system | 7–9 with prose | 25 total, 9+ with prose (PCM/IMV/FRP-reg 5/5; lift-pump/FRP-sensor/CP4/hp-rail-b/shared-5v/shared-lref 4/5) |
| Pins | 9 distributed | lift-pump 2 + IMV 2 + FRP-sensor 3 + FRP-reg 2 |
| Scenarios | 8, each with pinStates + pinReadings | 8, all 9/9 |
| dataStatus | populated | all 3 fields present |
| lastScenarioSlug | null | null |
| Mechanical-linkage frp-reg → hp-rail-bank-a | present | present, description matches `7c05197` fix |

---

## Task 15 — Push + open PR (only remaining task)

### Pre-push validation (do FIRST in the fresh session)

```bash
pnpm tsc --noEmit
pnpm test
```

**Expected:**
- `pnpm tsc --noEmit` errors **only** under `designs/design_handoff_vehicle_knowledge/reference/*.tsx`. Those files are local-only (gitignored via `design_handoff_*/` at `.gitignore:36`) — not part of this PR, not in any commit. Tsc scans them because tsconfig doesn't exclude `designs/`. Treat as pre-existing noise.
- `pnpm test` may flake on cold cache with up to ~7 "Hook timed out in 10000ms" failures in `beforeEach` calls to `createTestDb()` — classic [[feedback_vitest_pglite_flake]]. Rerun once. Second run should be clean.

### Push

```bash
git push -u origin feat/topology-guided-walk
```

Branch is **20 commits ahead** of `origin/staging-interactive-diagnostics`.

### Open PR

**Base:** `staging-interactive-diagnostics` (NOT main)

```bash
gh pr create --base staging-interactive-diagnostics --title "PR-C/A: Interactive electrical topology — schema + seed + loader" --body "$(cat <<'EOF'
## Summary
- Adds 5 new tables (component_pins, system_scenarios, scenario_wire_states, pin_scenario_readings, system_data_status), 6 prose columns on components, 3 columns on component_connections (electrical role + pin endpoints), and last_scenario_slug on sessions
- Seeds fuel-system data for the 6.7L Power Stroke from Brandon's prototype (7 components, ~9 pins, 8 scenarios, ~72 wire-state rows, ~72 pin readings, 1 status row)
- Extends loadSystemTopology to return the richer assembled graph (pins, scenarios with pin-state + reading maps, dataStatus, lastScenarioSlug)
- No UI changes — the existing topology page renders unchanged. PR-C/B follows with the new UI.

Spec: docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md
Plan: docs/superpowers/plans/2026-05-23-electrical-topology-schema-loader.md

## Test plan
- [ ] pnpm test — all loader tests pass, including new pins/scenarios/dataStatus/lastScenarioSlug coverage
- [ ] pnpm tsc --noEmit — clean
- [ ] Verify the live DB has all 5 new tables + 9 column additions
- [ ] Verify the loader, run against the F-350 / P0087 session, returns 7 components with body prose, 8 scenarios, ~9 pins, dataStatus populated
- [ ] Existing topology page (PR-B's browse mode) still renders correctly — no regression
EOF
)"
```

**Brandon merges** via GitHub UI after reviewing. Do not merge from CLI.

---

## Brandon's standing rules — still apply

- **Never push to main / staging.** Push to feature branch only; Brandon merges via GitHub UI.
- **No DB writes to production without explicit per-op approval** — Task 15 is push + PR only, so this won't come up.
- **Plain-English summaries to Brandon.**

---

## Related

- Previous handoff: `docs/superpowers/handoffs/2026-05-23-pr-c-a-resume-from-task-14.md` (Tasks 11.5–14 narrative)
- Plan: `docs/superpowers/plans/2026-05-23-electrical-topology-schema-loader.md` (Task 15 section has the PR body — duplicated above so you don't need to open the plan)
- Spec: `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`
- Seed file (now live): `drizzle/data/2026-05-23-electrical-topology-fuel-seed.sql`
