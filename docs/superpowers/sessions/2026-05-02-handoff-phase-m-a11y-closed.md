# Vyntechs MVP — Session Handoff (Phase M a11y closed, 2026-05-02)

**For the next session: paste this file as the first message. It supersedes `2026-05-01-handoff-phase-m-shipped.md`.**

---

## ⏵ START HERE — instructions for the next session

Phase M's only loose end (a11y verification on the wired DeclineOrDefer flow) is now closed. The branch is ready for the next phase.

**Do this in order, no detours:**

1. **`cd` into the worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`. Branch is `feature/mvp-implementation`. Working tree is clean. **Do NOT switch branches; do NOT touch `main`; do NOT discard or reset anything.**
2. **Read `AGENTS.md` first** (top-level). Load-bearing conventions doc — handler-in-`lib/` + thin route shim, queries-take-`db`, preview-mode-safe wired components, plan-vs-reality reconciliation pattern, gating model.
3. **Read `docs/superpowers/ui-design-toolkit.md`** if the chosen phase has any UI work.
4. **Verify the baseline before adding anything:** `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expected: **146/146 tests**, exit 0, build succeeds. If anything is red, **stop and report — do not start new work on a broken baseline.**
5. **Ask the user which phase to ship.** Do not pick unilaterally. Recommended priority is in the "Recommended next steps" section below (Phase G → I → N → J). If the user picks anything else, follow them.
6. **Workflow discipline (the user enforces this strictly):**
   - `superpowers:executing-plans` once per phase
   - `superpowers:test-driven-development` every TDD cycle
   - `superpowers:systematic-debugging` the moment anything breaks
   - `superpowers:verification-before-completion` before declaring any phase done
   - `frontend-design` skill if any UI work
   - End every phase: `pnpm test && pnpm exec tsc --noEmit && pnpm build`, then `chrome-devtools-mcp:a11y-debugging` if UI was touched, then write a new handoff doc that supersedes this one and update `MEMORY.md` to point at it.
7. **Plan-vs-reality:** the inline plan code blocks are reference, not drop-in. Each phase has an "Implementation corrections" callout at the bottom that is authoritative. Mirror this style for any future phase that drifts.

---

## Where we are

- **Worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
- **Branch:** `feature/mvp-implementation` (now **42 commits ahead** of `main`)
- **Plan:** `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md`
- **Spec:** `docs/superpowers/specs/2026-05-01-vyntechs-design.md`
- **Conventions:** `AGENTS.md`, `docs/superpowers/ui-design-toolkit.md`
- **Tests:** **146 passing** across 25 files (was 145; +1 from this session). Typecheck clean (`pnpm exec tsc --noEmit` exit 0). Production build clean (`pnpm build`).

## What shipped this session

### Phase M follow-up — a11y verification on DeclineOrDefer

One commit (`707daa7`).

- `chore(a11y): Phase M follow-up — verify DeclineOrDefer surfaces` — audited `/design#decline` at 390×844 with `chrome-devtools-mcp:a11y-debugging`. Tap targets all 352×88 (clear the 48×48 threshold). Focus ring solid 2px amber with 2px offset. Contrast passes WCAG AA across the whole surface (eyebrow 4.93 — tight but over the 4.5 line; headline 17.18; gap text 11.4; button title 15.63; emphasized amber title 9.24; description 10.37). One finding: the decorative `⏵` play-arrow glyph in the eyebrow was exposed as a standalone StaticText in the a11y tree. Wrapped it in `<span aria-hidden="true">⏵ </span>` so AT only announces the riskLabel ("Gating · destructive class"). Visual eyebrow preserved for sighted users. Test pins the contract (`tests/unit/decline-or-defer-screen.test.tsx` → "hides the decorative play-arrow glyph from screen readers").

### Out-of-scope finding worth flagging

Chrome's automated a11y audit reports **2 unlabeled form fields** on `/design`. The DeclineOrDefer surface is clean — these come from the OutcomeCapture (Phase F) screen. Not in scope for Phase M follow-up. Surface this when you next touch Phase F. Likely candidates: a textbox or two without an explicit `<label htmlFor>` association (the visual labels are sibling StaticText, not bound).

## Conventions reinforced this session

- **Decorative Unicode iconography in eyebrows must be `aria-hidden`.** The `⏵` arrow looks like text in the JSX but conveys no information beyond decoration — SRs would announce "U+23F5" or "black medium right-pointing triangle". Wrap any such glyph in a span with `aria-hidden="true"` and make sure the meaningful label remains a sibling text node. This is a class of bug that's easy to ship and almost impossible to catch without an actual a11y tree audit; the test added this session demonstrates the pattern for any future eyebrow.
- **A11y test pattern:** assert that the glyph element has `aria-hidden="true"` AND that the meaningful label is still queryable by `getByText`. One pin, two assertions, covers both regressions (someone removing `aria-hidden`, or someone moving the label inside the hidden span).

## Open env values still needed

Same as before — none of the in-flight code is gated, but live testing requires:

- `SUPABASE_SERVICE_ROLE_KEY`
- `[YOUR-PASSWORD]` placeholder in `DATABASE_URL` and `DATABASE_URL_DIRECT`
- `ANTHROPIC_API_KEY` for live tree generation, outcome validation, risk classifier (Haiku judge), and decline-language generation (Sonnet)

The `/design` route still works with no env — fixture-driven, preview-mode-safe.

Once `DATABASE_URL` is wired:
1. `pnpm drizzle-kit migrate` to apply migrations 0002 (calibration) + 0003 (tech-assist).
2. Run the calibration seed (file at `drizzle/seed/calibration-seed.ts`; needs a tsx-equivalent runner).

## Recommended next steps

In priority order:

1. **Phase G — Stripe Billing Skeleton (3 tasks).** Small, foundational. Spec calls for $700/mo flat SaaS pricing. First form-heavy non-trivial surface, so it's also the natural place to introduce shadcn/ui per the toolkit doc — invoke the `vercel:shadcn` skill before starting and add the init step as a plan task (don't silently introduce).
2. **Phase I — Multi-Modal Capture (10 tasks).** Wires the four `CaptureBar` buttons (Voice/Photo/Video/Scan) to actual capture flows. Largest of the remaining short phases.
3. **Phase N — Tablet layout (6 tasks).** Same design system, two-pane layout. Tokens already support all viewports.
4. **Phase J — Playwright e2e.** Now valuable: outcome flow + decline-or-defer flow + PWA install + offline behavior all need browser-level coverage. The decline-or-defer e2e in particular would have caught the `⏵` a11y issue earlier had it existed.
5. **Phase F follow-up: fix the 2 unlabeled OutcomeCapture form fields.** Quick a11y win (~15 min), can ride along with any phase that touches Phase F. Audit `/design#outcome` at 390×844 to confirm location.
6. **TreeState consolidation cleanup.** ~15 minutes — collapse the schema/tree-engine duplication noted in the prior handoff. Can ride along with any phase that touches `TreeState`.

## Recommended resumption flow

1. `/clear`.
2. Paste this file as the first message.
3. Read `AGENTS.md`; this handoff for current state; `docs/superpowers/ui-design-toolkit.md` if UI is in the chosen phase.
4. Verify baseline (`pnpm test && pnpm exec tsc --noEmit && pnpm build`).
5. Ask the user which phase to ship next.
6. Use `superpowers:executing-plans` (once per phase) and `superpowers:test-driven-development` (every cycle).
7. End of phase: run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, then `chrome-devtools-mcp:a11y-debugging` if touching UI, then write a new handoff doc and update `MEMORY.md`.

## Key files touched this session

- `components/screens/decline-or-defer.tsx` — wrapped the `⏵` glyph in `aria-hidden="true"`
- `tests/unit/decline-or-defer-screen.test.tsx` — added "hides the decorative play-arrow glyph from screen readers" test

## Plan callouts

The Phase D corrections (line 2312), Phase F corrections (after F7), Phase H corrections (after H3), and Phase M corrections (after M9) sections of the plan are the authoritative pattern. The inline plan code blocks remain as reference but are not drop-in correct. Mirror the corrections-callout style for any future phase that drifts from its plan.
