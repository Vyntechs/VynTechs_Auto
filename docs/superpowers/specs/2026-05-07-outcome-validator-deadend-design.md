# Outcome-Validator Dead-End — Design

**Date:** 2026-05-07
**Branch:** `fix/outcome-validator-deadend-2026-05-07` (off `main`)
**Reported by:** Brandon, during preview-curator validation of the two-phase stack (real test vehicle: 2008 Chevy 3500, session `2cc41b36`)

## Problem

A tech finishes a real diagnostic + repair on a real vehicle, opens the close-case form, fills in everything correctly, and tries to submit. The AI validator (`validateSpecificity` in `lib/ai/outcome-validator.ts`) rejects with feedback like *"The ground bolt location needs a more specific identifier (e.g., which block ground stud, bolt size, or connector/cable ID)..."*

The tech has the answer — they put it in the **Notes for next time** field. But the validator only ever reads the **Root cause** field. Notes is invisible to the AI.

The tech's only ways out:
1. Give up and click *Mark this case incomplete* (wrong — the case is solved)
2. Keep editing Root cause until the AI is satisfied (frustrating, no guarantee it ever passes)

There is no *"submit anyway"* path. The validator is gospel.

## Goal

The tech can always close a case they actually solved, in at most one retry, without needing to satisfy an AI. Corpus quality is preserved by:
- Better validator output (reads more context, gives actionable instructions)
- Override flag captured for admin (Brandon) to fact-check later

## Design

### 1. Validator reads Root cause + Notes

`validateSpecificity(text)` becomes `validateSpecificity({ rootCause, notes })`. The user-message sent to Anthropic joins both:

```
Root cause:
<rootCause>

Notes for next time:
<notes — or "(none)" if blank>

Return JSON only.
```

The system prompt is updated to mention notes:
> Both fields are written by the same tech. Notes often contain the location/identifier specifics; treat them as part of the root cause for evaluation.

This alone catches Brandon's exact case (he gave the bolt location in notes).

### 2. Feedback phrased as instruction, not critique

System prompt addendum:
> When `ok` is false, the `feedback` field MUST be phrased as an instruction telling the tech what to add to the Root cause field. Never describe what is missing — describe what to type. Example: NOT "The bolt size is missing." but YES "Add the bolt's location and observable condition to Root cause (e.g., 'driver-side block ground, lower corner near oil pan; visibly corroded')."

### 3. One retry, then accept

**Client (`outcome-capture.tsx`):**
- New state: `attemptCount` (starts at 0).
- On 422 response, increment `attemptCount` to 1, show feedback as today, change button label from *"Submit & close case"* to *"Submit & close case (override AI)"*.
- On submit when `attemptCount >= 1`, include `override: { lastFeedback: <stored feedback> }` in payload.

**Server (`lib/sessions.ts` → `closeSessionForUser`):**
- If body has `override` with valid shape, **skip the validator call entirely**. Save `outcome.override = { at: <ISO now>, lastFeedback }` alongside the normal outcome data.
- If body has no `override`, behave exactly as today (validator runs; 422 on rejection).

**Why no second AI call:** Brandon explicitly said "after the tech makes an attempt, AI just accepts." Skipping the call also saves an Anthropic round-trip and removes a class of bugs (what if 2nd validator rejects too?).

### 4. Schema additions

`outcomeSchema` (in `lib/types.ts`) gains an optional field:
```ts
override: z.object({
  at: z.string(),         // ISO timestamp
  lastFeedback: z.string()  // the AI feedback that was overridden
}).optional()
```

The `outcome` column on `sessions` is already jsonb — no DB migration needed. Existing rows have `override: undefined` and read normally.

### 5. Admin surfacing — DEFERRED

Out of scope for this PR. The override flag is captured in the data; surfacing in the curator's *Needs review* surface is a follow-up small PR.

## File-by-file impact

| File | Change |
|---|---|
| `lib/types.ts` | Extend `outcomeSchema` with optional `override` field |
| `lib/ai/prompts.ts` | Update `OUTCOME_VALIDATOR_SYSTEM` — feedback-as-instruction rule + notes-as-context rule |
| `lib/ai/outcome-validator.ts` | Change `validateSpecificity` signature to `({ rootCause, notes? })` |
| `lib/sessions.ts` | `closeSessionForUser`: if `body.override` present, skip validator, store override metadata |
| `app/api/sessions/[id]/close/route.ts` | No code change — the route already passes the body through |
| `components/screens/outcome-capture.tsx` | Add `attemptCount` + `lastFeedback` state; change button label after first 422; send `override` on retry |
| `tests/unit/outcome-validator.test.ts` | Update existing tests for new signature; add test that notes is included in prompt |
| `tests/unit/outcome-schema.test.ts` | Add test that override field passes validation |
| `tests/unit/outcome-capture.test.tsx` | Add test: after 422, button label changes; second submit includes `override` |
| `tests/integration` (or new) | Add test: closeSessionForUser with `override` skips validator + persists override metadata |

## Out of scope

- Curator surface for "overridden" outcomes (follow-up PR)
- Allowing > 1 retry before override (intentionally just one retry — keeps the loop predictable)
- Re-running validator on the override path (intentional — saves API call, simpler logic)
- Migrating any existing rows
