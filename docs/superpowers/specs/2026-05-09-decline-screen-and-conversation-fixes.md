# Decline screen — escape hatches that work, less ambiguity, fewer options

**Branch:** `claude/location-ambient-temp-jJL3M` (off `staging/camera-vision`)
**Date:** 2026-05-09
**Status:** spec — pending Brandon review

## Problem

User validation on the staging preview surfaced four issues with the Decline
screen and one with the curator timeline. All have the same shape: features
that look like they exit the screen don't actually exit it, or features that
shouldn't exist still do.

1. **Gather more low-risk data is a dead end.** The button calls
   `router.push('/sessions/:id')`, the session-routing layer sees
   `gateDecision.allow === false` and immediately redirects back to
   `/sessions/:id/decline`. No mechanism clears or relaxes the gate. The
   tech is trapped on the screen they're trying to leave.

2. **Yes / No on the hero card feels broken.** The buttons fire and POST to
   `/advance` correctly, but the AI's next tree-update almost always emits
   another low-confidence `proposedAction`, which re-gates immediately, and
   the redirect loop in #1 sends the tech back to a visually-identical
   Decline screen. No loading affordance is shown during the AI call, so the
   tap reads as a no-op.

3. **The hero card has no information architecture.** Bare "Yes" / "No"
   buttons under a question, no eyebrow identifying the card as the fastest
   path forward, no body copy explaining what answering accomplishes, no
   echo of the affirmative/negative state on the buttons themselves. The
   "Three ways forward" header below treats the hero as ignorable. The
   lowest-friction successful path looks visually equivalent to the
   bail-out paths.

4. **"Decline this job" is on the screen.** Refusing customer work isn't
   an outcome we want to surface. It exists at the type, schema, prompt,
   route, UI, and test layers; soft-removing the spoke alone leaves a
   stale option in `gateProposedAction`'s default array and an accepting
   handler.

5. **Curator conversation timeline is lossy.** `session_events.aiResponse`
   only stores routing metadata (`nextNodeId`, `treeUpdate` placeholder).
   The AI's per-turn `message` text lives in `treeState.message` and is
   overwritten on every update. Reconstructing what the AI said at each
   step is impossible from the curator view today.

## Behavior change

### Decline screen — exits work, hero card explains itself

**Hero card** gets framing that makes its purpose unambiguous:

- Eyebrow above the card: **`FASTEST PATH FORWARD`**
- One-line italic descriptor under the question: *"Answering this lets
  the AI commit to the next step. ~10 sec."*
- Buttons echo the affirmative/negative state: **`Yes — I have 12V`** /
  **`No — no voltage`** (driven by optional `yesLabel`/`noLabel` on the
  AI's `whatWouldClose`, with fallback to plain `Yes`/`No`).
- During the AI round-trip the buttons read **`Working…`** instead of
  silently disabling.

**Spokes section** rename: `THREE WAYS FORWARD` → `OR, IF YOU CAN'T
ANSWER YET`. With "Decline this job" removed, two spokes remain.

**All exits clear the stale gate before navigating.** A new endpoint
`POST /api/sessions/[id]/release-gate` clears `treeState.gateDecision`
and is called from:

- Yes / No on the hero confirm card (after the `/advance` returns)
- Snap-it on the hero photo card (after the `/capture` returns)
- The Gather more low-risk data spoke

The tech lands on the active-session view, sees the AI's updated step
inline, and decides the next move. The next observation re-runs gating
naturally — the gate isn't bypassed, just released for the current
displayed action. The Defer spoke is unchanged.

### Decline option deletion

Removed from every layer:

- `lib/gating/gap-handler.ts` — `GateOption` type narrows to
  `'gather_more_low_risk' | 'defer'`; default options array updated.
- `lib/gating/decline-language.ts` — `reason` narrows to `'defer'`; the
  prompt user-message no longer branches on reason.
- `lib/sessions.ts` — `declineOrDeferSchema.reason` becomes
  `z.literal('defer')`; result type narrows to `'deferred'`; stale
  clients sending `reason: 'decline'` get a 400 from zod.
- `components/screens/decline-or-defer-live.tsx` — `OPTIONS_BY_REASON`
  drops the decline entry; option-key prop type narrows.
- The `/api/sessions/[id]/decline-or-defer` route URL stays for
  back-compat (existing closed-as-declined sessions still display);
  new requests with `reason: 'decline'` reject.
- The `sessions.status` enum keeps `'declined'` (existing rows in the
  DB use it; removing it would require a migration we don't need).

### Curator conversation persistence

`session_events.aiResponse` gains an optional `messageText` field
recording the AI's `message` for that turn. The curator case page renders
`messageText` (when present) inline with the tech's observation, so the
back-and-forth is reconstructable. Existing rows without the field render
the old summary as today.

## Scope

**In:** Decline-screen UX (copy, button labels, busy states), release-gate
endpoint and wire-up across all four exits, Decline option deletion across
type/schema/handler/UI/tests, AI prompt change to emit
`yesLabel`/`noLabel`, curator conversation `messageText` persistence.

**Out (deferred):** rendering the gate dial inline on the active-session
view (the larger refactor that would eliminate the separate Decline screen
entirely), multi-turn AI message history (only the latest turn's text is
captured per event row; historical turns remain as session_event rows but
without text reconstruction beyond what's already stored), curator UI
beyond the simple text render.

## Implementation outline

### 1. AI prompt — `lib/ai/prompts.ts`

`TREE_ENGINE_SYSTEM`'s `WhatWouldClose` type extended:

```ts
type WhatWouldClose =
  | { kind: "confirm"; prompt: string; yesLabel?: string; noLabel?: string }
  | { kind: "photo"; prompt: string; extractFor: string }
```

New instruction: when emitting `confirm`, include `yesLabel` / `noLabel`
echoing the answer state in 3-5 words ("I have 12V" / "no voltage"). Both
optional; UI falls back to plain `Yes`/`No`.

`DECLINE_LANGUAGE_SYSTEM` stays — the prompt body already describes both
declined and deferred. The user message just stops sending `reason='decline'`.

### 2. Type changes

- `lib/ai/tree-engine.ts` — `WhatWouldClose.confirm` gains `yesLabel?` /
  `noLabel?`; `parseTreeJson` validates them as optional strings.
- `lib/gating/gap-handler.ts` — `GateOption` narrows; default options
  drop `'decline'`.
- `lib/gating/decline-language.ts` — `DeclineLanguageInput.reason` becomes
  `'defer'`.
- `lib/db/schema.ts` — `session_events.aiResponse` jsonb shape gains
  optional `messageText: string`.

### 3. New endpoint — `POST /api/sessions/[id]/release-gate`

Handler in `lib/sessions.ts`: `releaseGateForUser({ db, userId, sessionId })`.

- Auth + ownership checks (same as advance).
- Loads session; returns 400 if not open.
- Sets `treeState.gateDecision = undefined` via `updateSessionTreeState`.
- Appends a `tree_update` session_event so the curator timeline records
  the user-initiated release.
- Returns `{ ok: true }`.

Route shim follows the established handler-in-`lib/` + thin route shim
pattern.

### 4. Sessions handler — narrow schema, persist messageText

- `declineOrDeferSchema.reason` → `z.literal('defer')`.
- `DeclineOrDeferSessionResult` narrows to `status: 'deferred'`.
- `advanceSession` writes `aiResponse.messageText = nextTree.message` on
  the appended observation event.
- `submitRepairObservationForUser` already persists guidance text — no
  change needed there.

### 5. Decline-or-Defer UI — `components/screens/decline-or-defer*.tsx`

`decline-or-defer.tsx` (presentational):

- `Props.confirmAsk` gains `yesLabel?` / `noLabel?`. Buttons render the
  labels when present, fall back to `Yes`/`No`. Busy text is `Working…`.
- New eyebrow above the hero card: `FASTEST PATH FORWARD`. One-line
  italic descriptor under the prompt.
- Spokes section header copy: `OR, IF YOU CAN'T ANSWER YET`. Lead text
  `Three ways forward` removed (or made conditional on options.length === 3).

`decline-or-defer-live.tsx` (wired):

- Drops `'decline'` from `OPTIONS_BY_REASON`. `optionKeys` prop type
  narrows to `('gather_more_low_risk' | 'defer')[]`.
- `handleConfirm`: POST `/advance`, then POST `/release-gate`, then
  `router.push(/sessions/[id])`. `Working…` state during.
- `handleFile` (Snap-it): POST `/capture`, then POST `/release-gate`,
  then `router.push`.
- `handleSelect` for `'gather'`: POST `/release-gate` first, then
  `router.push`.
- Pass `yesLabel` / `noLabel` from `wwcObj` to `confirmAsk`.

### 6. Curator case page — `app/curator/cases/[sessionId]/page.tsx`

- When rendering each event with `aiResponse.messageText`, show that
  text inline below the tech's observation in the existing event list
  layout. No structural change beyond conditional render.

### 7. Tests (TDD — failing test before each implementation)

- `tests/unit/release-gate-handler.test.ts` — new. Asserts gate cleared,
  ownership rejected, closed-session rejected, event appended.
- `tests/unit/decline-or-defer-handler.test.ts` — update existing tests:
  the decline path now returns 400; defer remains the only success
  path; assert events still record the deferral.
- `tests/unit/decline-or-defer-screen.test.tsx` — update existing tests:
  remove decline-spoke assertions; add yesLabel/noLabel tests; add
  Working… state assertion; assert release-gate is hit on each exit.
- `tests/unit/gap-handler.test.ts` — update default-options assertion to
  `['gather_more_low_risk', 'defer']`.
- `tests/unit/advance-session-handler.test.ts` — assert
  `aiResponse.messageText` is persisted on the observation event.
- `tests/unit/tree-engine.test.ts` — assert `parseTreeJson` accepts
  optional `yesLabel`/`noLabel` and rejects non-string values.

### 8. Verification

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Then `/review` and `/security-review` on the diff before commit.

## Open questions

1. Do we want to render `aiResponse.messageText` for old session_events
   that predate this change? They'll be `undefined`. Current behavior
   (show only the routing summary) is fine and forward-compatible — the
   docs page will show the new field for new turns and the old summary
   for old turns. No backfill needed.

2. The `DECLINE_LANGUAGE_SYSTEM` prompt still mentions decline in its
   system message. Worth simplifying to defer-only language for clarity,
   or leave it as a noop for the existing call site that only ever sends
   `reason='defer'` now? Recommendation: leave the system prompt alone;
   the handler-side narrowing is the load-bearing change. Touching the
   shared prompt risks regressions in any future use.

3. Should the Defer spoke also pop a confirmation ("Send to curator?")
   given it's now the only escalation? Out of scope here; surface in a
   separate spec if desired.

## Success criteria

- Tech tapping any Decline-screen exit lands on the active-session
  view with the AI's updated context visible. Zero loops.
- Tech taps Yes / No → buttons immediately read `Working…` → screen
  transitions within the AI round-trip latency budget.
- Decline option absent from all surfaces; stale clients posting
  `reason: 'decline'` receive 400.
- Curator case page shows AI message text per turn for new sessions
  created after this change ships.
- All existing tests still pass; new tests assert the new behaviors.
- Diff passes `/review` and `/security-review` skills before commit.
