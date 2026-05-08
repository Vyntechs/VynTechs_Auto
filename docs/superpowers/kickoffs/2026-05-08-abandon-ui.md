# Kickoff — Abandon Affordance for Stuck or Orphan Sessions

**For:** A future Claude Code session that picks up shop-management follow-up work.
**From:** The 2026-05-08 session validating PR 1. Brandon found this while looking at his Work Orders list with two leftover sessions he had no way to close.
**Status:** Deferred from PR 1. Awaits Brandon's explicit pointer.

---

## What's broken (the symptom)

On the Work Orders / My Jobs list, the OPEN section can show sessions that:

1. **Are stuck** in `tree-generating` state (treeState.nodes is empty — happens when the AI didn't run, e.g. for sessions created before a fix lands, or if generateInitialTree silently produces an empty tree). When clicked, the page renders `<TreeGenerating />` forever — a screen with **zero buttons**.
2. **Belong to other techs** but show in the owner's list (see the sibling kickoff `2026-05-08-permission-alignment.md` for the underlying permission bug). Even after that's fixed, owners may want to abandon a tech's stale session ("Angel's been gone 2.75 days, this Dodge isn't getting finished").
3. **Were started by mistake / for testing / abandoned by the customer** — and the user just wants them gone from the list.

In every one of these cases the user hits a wall: the list shows the row but offers no action; clicking the row leads to a screen that also offers no action. The only way out today is direct DB manipulation, which is not a real-product answer.

Brandon's reaction: *"I have no way to close the cases from they are from previous versions and testing."*

## Root cause

There's a back-end primitive but no front-end affordance.

- **Back-end exists:** `abandonSessionForUser` in `lib/sessions.ts:531`, exposed via `POST /api/sessions/[id]/abandon` (`app/api/sessions/[id]/abandon/route.ts`). Already accepts an optional reason + note. Already terminal-statuses the session as `'deferred'`.
- **Front-end is silent:** No UI surface anywhere calls it. Not on the list cards, not on the detail page, not on TreeGenerating.

## What needs to happen

Add a "Mark incomplete" (or whatever Brandon decides to call it — see decision 1 below) action in at least these two places:

1. **Work Orders / My Jobs list cards** — small button on each OPEN card, probably tucked behind a kebab/ellipsis or revealed on hover so it doesn't dominate the card visual.
2. **TreeGenerating screen** — the only escape hatch when the AI never produced a tree. A subtle "This is taking too long — mark incomplete" button should appear after some elapsed time (or always; decision below).

Optionally also on the diagnostic / repair pages, but those have an existing flow (Decline-or-Defer for AI-gated cases) so probably skip there to avoid confusion.

## Decisions Brandon needs to make BEFORE coding

1. **Label.** "Mark incomplete," "Abandon," "Cancel," "Discard," "Close without diagnosis," something else? Apply the **10-year-old test** — what would a non-technical tech grok at a glance? Brandon's memory rule prefers self-explanatory wording over shop slang.

2. **Confirmation flow.** One-click? Two-click confirm? Modal with required reason? An accidental click on this in a busy shop is bad — the session is gone from the active list — so probably two-click with a reason picker (`mistake`, `test`, `wrong_vehicle`, `customer_left`, `other`). The back-end already supports those reasons.

3. **TreeGenerating-screen visibility timing.** Show the abandon button:
   - Always (simple, but might tempt impatient users to abandon a real-but-slow generation)
   - After 30 seconds of "Building..." (matches the form's "Usually 5–15 seconds" hint, gives some buffer)
   - After 60 seconds (more conservative)

4. **Should the list also offer "Resume" / "View" → "Abandon" via the detail page**, OR should "Abandon" be available directly from the list? Probably both, but the priority order matters for the design.

5. **Does the same affordance need to exist on closed-summary / decline / outcome pages?** Probably not — those are already terminal. But there might be edge cases.

## Files to touch (incomplete — discover the rest during implementation)

- `components/screens/today-home.tsx` (or whichever file renders the list cards — find via `grep -r "Work Orders" components/`)
- `components/screens/tree-generating.tsx` (add the optional escape-hatch button)
- Whatever modal/confirm component pattern the rest of the app uses (don't invent a new one)
- Tests: `tests/unit/today-home.test.tsx` already exists, extend it; route test for abandon already exists (assumed; verify), keep that solid
- Maybe a small "abandon-action.tsx" component if the same UI is reused in two spots

## Tests to add / update

- List card → abandon button → confirm → row moves to closed
- TreeGenerating screen → abandon button visible after threshold → click → row moves to closed
- Confirmation flow rejects accidental clicks (single-click does NOT abandon)
- Abandon reason picker submits the right enum to the back-end

## NOT in scope

- Hard delete of session rows (we keep them as `deferred` for the curator's incomplete bucket — already the system's pattern)
- Bulk-abandon ("close all of these") — not needed for MVP
- Timed auto-abandon ("if open and untouched for 7 days, auto-defer") — separate decision
- Owner overriding a tech's session — that's the sibling permission-alignment kickoff's territory; this kickoff assumes the user already has permission to abandon

## Sequencing note

This kickoff and the **permission-alignment** kickoff (`2026-05-08-permission-alignment.md`) are siblings. The recommended order:

1. **Permission alignment first.** Without it, the abandon button on the list will 403/404 when an owner tries to abandon another tech's session.
2. **Abandon UI second.** Builds on the permission-aligned back-end.

OR, ship them in parallel from two sessions if Brandon wants the marathon-pace; just be aware they touch overlapping code (`getSessionForUser`, list query) and a merge will need conflict resolution.

## Suggested first session actions

1. Read this doc fully
2. Find the list-rendering component (`grep -r "Work Orders" components/`)
3. Read `app/api/sessions/[id]/abandon/route.ts` and `lib/sessions.ts:531` to confirm the back-end accepts what you'll send
4. **Brainstorm with Brandon** — present the 5 decisions above, get answers
5. Write a spec doc at `docs/superpowers/specs/2026-05-XX-abandon-affordance.md`
6. Plan, then implement. Aim for a small focused PR.

## Quick context links

- 2026-05-08 PR 1 handoff: `docs/superpowers/sessions/2026-05-08-handoff-pr1-validation-pending.md`
- Sibling kickoff (permissions): `docs/superpowers/kickoffs/2026-05-08-permission-alignment.md`
- Back-end primitive: `lib/sessions.ts:531` (`abandonSessionForUser`)
- Stuck-screen component: `components/screens/tree-generating.tsx`
- Brandon's auto-memory: `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/MEMORY.md`
