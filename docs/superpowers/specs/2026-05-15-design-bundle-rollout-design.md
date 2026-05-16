# Design-bundle rollout — what's still unshipped

**Date:** 2026-05-15
**Source bundle:** `vyntechs-design-system/` from `https://api.anthropic.com/v1/design/h/L-YNp8A_lW_7s9LPe_L37g`
**Branch convention:** every PR cut from `origin/main` HEAD. **Never merge to main** — Brandon merges via GitHub UI after Vercel-preview validation.

---

## Plain-English summary

The Anthropic design handoff bundle contains the design system snapshot for Vyntechs as of mid-May. Most of it already shipped — Counter (PR series), tech-selector (#28), customer search (#29), curator console (#57, #58), and the LogButton three-state narration (#20) are all in production.

Three pieces are unshipped:

1. **The 7 marketing PNGs** we were originally blocked on — drop-in image swap on the landing page.
2. **The phone Follow-ups list** — when the curator publishes new corpus that resolves a deferred case, the technician sees those cases in a fresh dedicated panel. The current `components/comeback/follow-up-panel.tsx` predates this design.
3. **The phone Outcome confirm screen** — after the tech resumes a follow-up case and performs the procedure, this is the one-tap close-the-loop screen. The current `components/screens/outcome-capture.tsx` predates this design.

Together those three close a curator → bay → curator calibration loop that the bundle was designed around: curator publishes corpus → tech sees follow-ups → tech performs procedure → tech taps Fixed/Partial/Couldn't verify → calibration drift dashboard gets the data point.

Out of scope this round: the standalone `marketing/` folder in the bundle, the foundation-token diff, and visual refreshes of already-merged curator hero instruments (ConfidenceTrace / DriftChart / Authoring projected-lift). Those are separate tickets.

---

## What's in scope: three PRs

### PR A — Marketing visuals swap

**Goal.** Replace the placeholder marketing screenshots with the 7 retina-resolution scenario-grounded PNGs from the bundle, and update their alt text to match.

**Branch.** `staging-marketing-visuals` (already cut from `main`, currently identical to it; the prior session created this branch and left it untouched after pre-flight halt).

**Files touched.**
- `public/marketing/screenshots/{hero,motion-01-open,motion-02-research,motion-03-propose,motion-04-confirm,motion-05-lock,laptop-hero}.png` — overwrite in place.
- `components/marketing/screenshots.config.ts` — drop-in replacement (shape unchanged; alt strings updated for the four new scenarios; comments rewritten).

**Acceptance criteria.**
1. All 7 PNGs at correct retina dimensions: 6 phone × `1170 × 2532`, 1 laptop × `2560 × 1600`. *(Already verified at extract time.)*
2. `pnpm typecheck` passes after config swap.
3. `pnpm test` passes (no test changes expected — alt-text changes shouldn't break anything unless a test asserts old alt strings).
4. `pnpm dev` → landing page renders all 7 new images on mobile (375px) and desktop (1440px).
5. PR description includes the V° lockup caveat from the bundle's `marketing-visuals/README.md` verbatim, and the scope note about §10 deferral.

**Risk.** Low. No code shape changes; alt strings only. Visual regression possible if scenario imagery clashes with surrounding copy on landing — Brandon validates on Vercel preview.

---

### PR B — Phone Follow-ups list refresh (Screen #11)

**Goal.** Refresh `components/comeback/follow-up-panel.tsx` to the new design from `Screens-Phone-Followups.jsx#FollowupsPanel` in the bundle. The new design closes the curator → bay handoff with editorial preamble, accent-backplate quote from the curator, vehicle/DTC row, risk pill, and "resume →" action per case.

**Branch.** `feat/follow-ups-panel-refresh` — cut from `origin/main`.

**Files touched.**
- `components/comeback/follow-up-panel.tsx` — visual refresh keeping the existing prop contract (cases data shape unchanged). Replace internal markup with the bundle design's module/queue-row/accent-backplate structure.
- `tests/unit/follow-up-panel.test.tsx` — update assertions to match new DOM structure; add coverage for the new "Still deferred" section (cases without corpus yet).
- `app/(app)/today/page.tsx` — verify the entry banner already surfaces follow-ups correctly. **No structural change unless** the current Today doesn't already link to follow-ups; if missing, add a one-line "N follow-ups · curator updated" banner above existing modules.

**Acceptance criteria.**
1. `tests/unit/follow-up-panel.test.tsx` updated and passing — covers: editorial preamble, "Resolvable now" rows with curator-quote backplate, "Still deferred" section, risk pills, est. time, "resume →" link target.
2. Visual parity with bundle screenshot `09-phone-followups.png` and `11-phone-followups.html` at mobile viewport (375–414 px).
3. No regression in surfaces consuming `<FollowUpPanel>` (grep callers; verify props still satisfied).
4. Mobile validation per CLAUDE.md memory: passes at 375 px.

**Risk.** Medium. Touches a live user-facing component. Existing test will likely fail on first run — that's TDD red-green; update tests to reflect the new design intent, then refactor the component, confirm green.

---

### PR C — Phone Outcome confirm refresh (Screen #12)

**Goal.** Refresh `components/screens/outcome-capture.tsx` to the new design from `Screens-Phone-Followups.jsx#OutcomeConfirm` in the bundle. The new screen presents an editorial italic-serif AI question ("Did the K-CAN splice fix it?"), a timestamped procedure-step ledger, three outcome buttons (Fixed = primary amber, Partial = ghost, Couldn't verify = ghost), and a mono caps footer of next-state effects.

**Branch.** `feat/outcome-confirm-refresh` — cut from `origin/main`.

**Files touched.**
- `components/screens/outcome-capture.tsx` — visual refresh. The bundle's design assumes three button outcomes (Fixed / Partial / Couldn't verify) routing to: POST calibration data point, defer with note, defer to curator. **Verify** current `outcome-capture.tsx` already supports this trichotomy in some form; if it has a different shape (e.g., a free-text capture with AI validation per the prior outcome-validator design), reconcile with the existing `lib/ai/outcome-validator.ts` rather than ripping it out.
- `tests/unit/outcome-capture.test.tsx` — update assertions for new structure.
- `app/(app)/sessions/[id]/outcome/page.tsx` — verify wiring; route-level changes only if the new component contract requires it.

**Acceptance criteria.**
1. `tests/unit/outcome-capture.test.tsx` updated and passing.
2. Existing outcome-validator behavior preserved (don't accidentally drop AI specificity validation; the bundle design adds calibration-loop closure on top, doesn't replace validation).
3. Visual parity with bundle screenshot `12-phone-outcome.png` at mobile viewport.
4. "Fixed" tap → fires existing outcome-confirm logic (whatever feeds the calibration drift dashboard).
5. Mobile validation passes at 375 px.

**Risk.** Medium-high. Outcome confirm is the data point that feeds the calibration drift dashboard — semantic accuracy matters more than visual fidelity here. If the bundle's three-button shape conflicts with existing validator logic (free-text + AI rejection), the spec design is **preserve validation, refresh visuals**, not the reverse.

---

## Build sequence

Strictly serial — each PR opens only after the previous is on the Vercel preview, even if Brandon hasn't merged yet. Reasons:

1. Brandon validates each on Vercel preview before merging.
2. PR B and PR C are independent functionally but share visual vocabulary (italic-serif preamble, mono caps footer, module/queue-row structure). Shipping in order ensures the second can lift any helpers extracted in the first.
3. Per memory `Marathon — small PRs`: small bites > monorepo PR.

```
PR A (marketing visuals) → push → open PR → notify Brandon
   ↓
PR B (follow-ups refresh) → branch from origin/main, not from A → push → open PR → notify Brandon
   ↓
PR C (outcome confirm refresh) → branch from origin/main, not from B → push → open PR → notify Brandon
```

Each PR description includes:
- Vercel-preview validation checklist Brandon reads BEFORE merging.
- Link to this spec.
- Link to the relevant bundle file path (e.g. `vyntechs-design-system/project/marketing-visuals/README.md`).

---

## Out of scope (this round)

- **Visual reconciliation of already-merged curator hero instruments** (ConfidenceTrace chart on case detail, DriftChart, authoring projected-lift). These screens exist on main with working visuals; touching them is high-effort regression-risk for marginal gain. Separate ticket if/when Brandon prioritizes.
- **Foundation token diff** (`vyntechs-design-system/.../foundations/colors_and_type.css` vs `app/globals.css`). Bundle handoff README recommends this as step 1 of a full design-system implementation; not needed for these three PRs because the bundle screens already reference existing `--vt-*` tokens.
- **Standalone `marketing/` folder** in the bundle (`Vyntechs Marketing.html` + `shots/` + `shots-out/`). Possibly a landing-page redesign. Haven't peeked; out of this round's scope.
- **OnLaptop scroll-pinned motion section + 5 laptop motion screens** per spec §10 of `docs/superpowers/specs/2026-05-15-marketing-visuals-redo.md`. Deferred by Brandon 2026-05-15; PR A respects that deferral.
- **Tablet refresh** of Today / Follow-ups / Outcome. The bundle's design is phone-specific for #11 and #12; tablet/desktop variants come in a later round.

---

## Source materials

| Item | Path |
| --- | --- |
| Bundle root | `/tmp/vyntechs-design-extract/vyntechs-design-system/` |
| Top-level handoff README | `vyntechs-design-system/README.md` |
| Marketing visuals handoff | `vyntechs-design-system/project/marketing-visuals/README.md` |
| Counter+Curator+Phone handoff | `vyntechs-design-system/project/claude_code_handoff/README.md` |
| Bundle screen #11 source | `vyntechs-design-system/project/claude_code_handoff/v2_designs/11-phone-followups.html` + `Screens-Phone-Followups.jsx#FollowupsPanel` |
| Bundle screen #12 source | `vyntechs-design-system/project/claude_code_handoff/v2_designs/12-phone-outcome.html` + `Screens-Phone-Followups.jsx#OutcomeConfirm` |
| Bundle screen #11 reference PNG | `vyntechs-design-system/project/claude_code_handoff/screenshots/11-phone-followups.png` |
| Bundle screen #12 reference PNG | `vyntechs-design-system/project/claude_code_handoff/screenshots/12-phone-outcome.png` |
| Original marketing-visuals spec | `docs/superpowers/specs/2026-05-15-marketing-visuals-redo.md` |

---

## Open question parked for after PR C

After the three PRs ship, do we want the standalone `marketing/` folder in the bundle? If yes, that's its own brainstorm (likely a landing-page redesign). Park decision until Brandon has validated PRs A-C on preview.
