# PR-C/B — Resume from Task 14 (browser smoke + PR)

**Date:** 2026-05-23 (evening)
**Branch:** `feat/topology-interactive-ui`
**Working tree:** clean (only pre-existing untracked screenshots from earlier PRs — ignore)

**Brandon's one-line paste to start the resume session:**

```
Read docs/superpowers/handoffs/2026-05-23-pr-c-b-resume-from-task-14.md and continue. You should be on branch feat/topology-interactive-ui; if not, git fetch && git switch feat/topology-interactive-ui.
```

---

## Where we are

13 of 15 plan tasks done. Only Task 14 (browser smoke) and Task 15 (push + PR) remain.

| Task | Commit | Status |
|---|---|---|
| 0. Baseline (tsc + tests + seed) | — | ✅ tsc clean, 1076/1076 green on warm cache |
| 1. `--role-*` tokens | `d338f7e` | ✅ |
| 2. wire-state pure module + tests | `9f90f49` | ✅ 11/11 |
| 3. wire-state CSS animation classes | `07aa481` | ✅ |
| 4. WireEdge custom React Flow component | `74da6e1` | ✅ 4/4 |
| 5. `toFlowElements` wire edges + typed selection | `c68cf9e` | ✅ 14/14 |
| 6. Per-pin handles + selection context | `84cda17` | ✅ 9/9 |
| 7. Pin variant of detail panel + scenario reading | `ad3ca12` | ✅ 20/20 |
| 8. Compositional scenario picker | `a1984d5` | ✅ 11/11 |
| 9. POST `/api/sessions/:id/scenario` + helper | `c45d74e` | ✅ 10/10 |
| 10. Lift scenario state + persistence | `9e0b815` | ✅ 10/10 |
| 11. Captured/missing footer | `5dfd823` | ✅ 8/8 |
| 12. Mobile baseline (D14 inline) | `00b8563` | ✅ |
| Plan + handoff docs | `9488563` | ✅ |
| 13. Full tsc + test sweep | — | ✅ 1076 pass on rerun (PGlite flake on first run hit intake-submit) |
| **14. Browser smoke** | — | **pending** |
| **15. Push + PR** | — | **pending** |

### Pre-flight already done (so fresh session can skip re-verifying)

- `pnpm tsc --noEmit` — clean (only gitignored `designs/*` noise)
- `pnpm test` — 1076/1076 pass on second run (PGlite cold-cache flake on first run is documented in [[feedback_vitest_pglite_flake]] — rerun once if you see "Hook timed out in 10000ms" failures in intake-submit; the topology tests aren't affected)

### Branch state

```
14 commits ahead of origin/staging-interactive-diagnostics
working tree: clean (untracked files are pre-existing screenshots from earlier PRs)
```

---

## Task 14 — Browser smoke (needs Brandon for the authed walk)

The plan calls for walking all 8 scenarios at desktop (1280/1440 px) + mobile (375/390/414 px) on the F-350 / P0087 session `681de115-5de9-474e-9721-263f65066e08` as an authed user.

**The fresh session can't authenticate as Brandon** (no password). Realistic split:

### What the fresh session CAN do

1. **Start dev server** and confirm clean startup:
   ```bash
   pnpm dev
   # wait for "Ready in N s"
   ```
2. **Unauthed curl** of the session URL — confirm it redirects to /signin (302), not 500:
   ```bash
   curl -i http://localhost:3000/sessions/681de115-5de9-474e-9721-263f65066e08 2>&1 | head -10
   ```
3. **Page-level component test** — already covered by `tests/unit/topology-diagnostic.test.tsx` (10/10 pass)

### What Brandon validates last (per [[feedback_claude_validates_first]] + [[feedback_verification_rigor]])

Sign in to the dev server in the browser and walk:

- [ ] On load: active scenario badge shows "Idle" (or last-picked); wires animate (PWMs pulsing, 12V steady)
- [ ] Compositional picker: flip ignition Off → On, engine Off → Running, load Idle → Heavy; wires re-tune each time; live readout updates
- [ ] Pin click: wire bolds + glows, others dim; side panel shows Where to probe / Right now / Expected / If wrong / Label gap
- [ ] Scenario change while pin selected: "Right now" reading updates without losing pin selection
- [ ] Component click (not a pin): kind/title/body + pin list with role abbreviations; PCM has no pin list
- [ ] Background click: panel returns to empty (or hidden on phone)
- [ ] Captured/missing footer at bottom shows counts + closing italic note
- [ ] Reload: scenario persists (POST → 204 → reload shows same scenario)
- [ ] Mobile (375/390/414 px): single column stack, picker collapses (engine hidden when key off, load hidden when engine off), panel inline below diagram (NOT a bottom sheet), empty-state hidden on phone, footer visible below
- [ ] Regression: PR-B browse-only topology on a different cache-hit session still works

**Fresh-session recommendation:** start the dev server + run the unauthed curl smoke + take a screenshot of the sign-in redirect. Tell Brandon "ready for your live validation at http://localhost:3000/sessions/681de115-..." and proceed to Task 15. Brandon's validation can happen async; if he flags any bug, write a failing test first per [[feedback_test_driven_bug_capture]].

---

## Task 15 — Push + open PR

### Push

```bash
git push -u origin feat/topology-interactive-ui
```

### Open PR (base = `staging-interactive-diagnostics`, NOT main)

```bash
gh pr create --base staging-interactive-diagnostics --title "PR-C/B: Interactive electrical topology UI — baseline" --body "$(cat <<'EOF'
## Summary
- Turns the shipped browse-only topology page into a live electrical instrument: compositional scenario picker (ignition + engine + load + 2 fault buttons) drives 13-state wire animations across 6 role colors
- Pin-click isolates a circuit path (selected wire glows + thickens; others dim to 25%); side panel shows scenario-scoped "Right now" reading + overall expected + diagnostic-if-wrong + label gap
- Hybrid captured/missing footer (hand-written wrapper from dataStatus + bullet rows derived from topology data)
- Scenario persists per session via fire-and-forget POST to /api/sessions/[id]/scenario; defaults to Idle (D17) on first load
- Mobile baseline (D14): inline panel below diagram, empty-state suppressed on phone, controls collapse naturally
- No schema changes (PR-C/A handled all of that); no AI in any user-facing copy (D8); no outcome recording (D7)

Spec: docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md
Plan: docs/superpowers/plans/2026-05-23-electrical-topology-interactive-ui.md

## Test plan
- [x] pnpm tsc --noEmit — clean (only gitignored designs/* noise)
- [x] pnpm test — 1076/1076 pass (rerun once if PGlite cold-cache flake hits intake-submit)
- [ ] Walk all 8 scenarios on the F-350 / P0087 session at desktop (1280 + 1440 px) — wire animations track correctly
- [ ] Click every pin — panel content matches seed; "Right now" updates when scenario changes
- [ ] Mobile (375 + 390 + 414 px) — picker collapses, pin tap targets ≥ 32 px, panel inline below diagram
- [ ] Scenario persists across reload (POST → 200 → reload shows persisted slug)
- [ ] PR-B browse-only topology still works (no regression)
EOF
)"
```

**Brandon merges via GitHub UI** after the PR validation checklist passes. Do NOT merge from CLI.

---

## Standing rules — still apply

- **Never push to main or staging-interactive-diagnostics.** Push to the feature branch only. Brandon merges via GitHub UI.
- **No "AI" word in any user-facing copy** (D8 — already enforced; spot-check the eyebrow + readout copy if rewriting).
- **TDD via failing test first** if any bug surfaces during Brandon's validation ([[feedback_test_driven_bug_capture]]).
- **Apply migrations to live DB** — N/A here (no schema changes; PR-C/A handled).
- **Validate with real inputs** — for live validation, exercise the actual F-350 / P0087 session, not a mock fixture.
- **PGlite cold-cache flake** — rerun once before treating intake-submit failures as a regression.

---

## What was deferred (kept out of this PR per spec)

- **Outcome recording** (D7) — no `tech_outcomes` writes
- **Claude Design polish layer** (D18) — bottom sheet, motion choreography, real rotary key-dial. Handoff doc at `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md` (DEFERRED until baseline ships)
- **Systems other than fuel + platforms other than 6.7L Power Stroke** — code is platform/system-agnostic; new content is seed-data work

---

## Files this PR touches

**New (6):**
- `components/topology/wire-state.ts`
- `components/topology/wire-edge.tsx`
- `components/topology/scenario-bar.tsx`
- `components/topology/captured-missing-footer.tsx`
- `components/topology/topology-selection-context.tsx`
- `app/api/sessions/[id]/scenario/route.ts`

**Modified (8):**
- `app/globals.css` — 6 `--role-*` tokens
- `app/(app)/sessions/[id]/page.tsx` — pass `sessionId` to loader
- `components/screens/topology-diagnostic.tsx` — scenario state + ScenarioBar + readout + footer + POST
- `components/topology/topology-diagram.tsx` — `edgeTypes` + typed selection prop + selection context provider
- `components/topology/topology-flow.ts` — wire-type edges + pin handles + typed selection
- `components/topology/topology-node.tsx` — per-pin handles + clickable buttons
- `components/topology/topology-detail-panel.tsx` — pin variant + withBoldOnly + component pin list
- `components/topology/topology.css` — wire animations + pin styles + scenario bar + readout + footer + new mobile baseline
- `lib/sessions.ts` — `setLastScenarioForSession` helper

**Tests new/modified (6):**
- `tests/unit/wire-state.test.ts` (new, 11 cases)
- `tests/unit/wire-edge.test.tsx` (new, 4)
- `tests/unit/scenario-bar.test.tsx` (new, 11)
- `tests/unit/captured-missing-footer.test.tsx` (new, 8)
- `tests/unit/set-last-scenario.test.ts` (new, 5)
- `tests/unit/scenario-route.test.ts` (new, 5)
- `tests/unit/topology-flow.test.ts` (extended, +9 cases)
- `tests/unit/topology-diagram.test.tsx` (extended, +4)
- `tests/unit/topology-diagnostic.test.tsx` (extended, +8)
- `tests/unit/topology-detail-panel.test.tsx` (extended, +13)

---

## Related

- Plan: `docs/superpowers/plans/2026-05-23-electrical-topology-interactive-ui.md`
- Spec: `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`
- Original kickoff: `docs/superpowers/handoffs/2026-05-23-pr-c-b-kickoff.md`
- Prototype reference: `mockups/topology-guidance/round-3-opus/topology.html`
- PR-C/A (predecessor, merged): https://github.com/Vyntechs/auto/pull/90
