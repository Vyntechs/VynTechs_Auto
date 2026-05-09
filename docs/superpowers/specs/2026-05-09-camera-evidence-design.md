# Camera evidence — AI asks, never bluffs

**Branch:** `staging/camera-vision` (off `origin/main`)
**Date:** 2026-05-09
**Status:** spec — pending Brandon review

## Problem

The tree-engine emits free-text `whatWouldClose` strings when `proposedAction.confidence` falls below the calibrated threshold. The gating surface only accepts text replies — there is no way for the AI to say *"snap a photo of the source"* and have the UI render that as a one-tap camera ask. This pushes the AI toward bluffing vehicle-specific facts (pin numbers, wire colors, what a healthy part should look like) when retrieval is thin and a fast text reply is the only available gap-closer. We want the AI honest about its limits at the gate — asking for the cheapest sufficient evidence: a yes/no the tech can attest to, OR a photo of the source when text won't close it.

## Behavior change

When the gating threshold fires (`gateProposedAction` returns `allow: false`), the Decline-or-Defer screen adds a fourth option keyed off the AI's structured `whatWouldClose`:

- **`kind: 'confirm'`** → `[ Yes ] [ No ]` for tech-attestable yes/no questions. *"Confirm the connector positively latches and the back-shell sits flush — yes / no?"* Click → POST the choice as observation → advance.
- **`kind: 'photo'`** → camera button labeled with the AI's plain-English reason. *"Snap the pinout page from your service info — I'll grab all pins for connector C171 at once."* Click → existing capture pipeline → generic vision extractor reads the image with the AI's `extractFor` instruction → AI consumes on next turn.

Most asks land on `confirm` — cheaper, default. Photos are reserved for evidence the tech cannot easily attest to in words AND a snap lets the AI extract directly. The existing 1+2 follow-up budget per node caps repetition; after the budget is exhausted the screen pivots to Decline / Defer.

## Scope

**In:** prompt update; structured `whatWouldClose` parse; gating-surface UI; generic photo extractor.
**Out (deferred):** tuned named extractors per kind; client-side image resize; tech-initiated capture; audio stub fix.

## Implementation

### 1. Prompt — `lib/ai/prompts.ts → TREE_ENGINE_SYSTEM`

Replace the existing `whatWouldClose` paragraph with the structured rule:

```
type WhatWouldClose =
  | { kind: "confirm"; prompt: string }
  | { kind: "photo"; prompt: string; extractFor: string }

WHEN proposedAction.confidence < 0.95, you MUST populate:
  - confidenceGap: one sentence naming the specific uncertainty.
  - whatWouldClose: a confirm OR photo ask.

Default to confirm. The tech is a trained diagnostician; their attestation
is sufficient for anything they can verify in a sentence. Escalate to photo
ONLY when (a) the gap is closed by data the tech cannot easily attest to
in words AND (b) a photo would let YOU extract that data directly.

  Confirm: "Coolant in the reservoir milky / cloudy — yes / no?"
  Photo:   "Snap the pinout page from your service info for connector C171
            — I'll grab all pins at once." (extractFor: "full pinout for C171")

NEVER ask for a photo of something the tech can verify with eyes and hands
and report in one sentence (latched, chafed, milky, belt routing, etc.) —
those are confirms.

When a photo IS warranted, request the BROADEST useful frame, never the
narrow piece. extractFor is a one-line, specific instruction to the vision
extractor: "full pinout for C171" beats "pin numbers".
```

### 2. Parse — `lib/ai/tree-engine.ts`

Update the `ProposedAction` parser to accept `whatWouldClose` as `string | WhatWouldClose`. Validate object shapes — `kind: 'photo'` requires `extractFor`; unknown `kind` rejected. String remains valid for legacy session events. No DB migration.

### 3. UI — Decline-or-Defer screen

The gating surface (DeclineOrDefer component, `/decline` route) adds a fourth option keyed off `gateDecision.whatWouldClose`:

- `kind: 'confirm'` → `[ Yes ] [ No ]` buttons. POST the choice as the next observation to `/api/sessions/[id]/advance`.
- `kind: 'photo'` → camera button labeled with `prompt`. Route through existing `/api/sessions/[id]/capture` with `kind: 'photo'`.
- legacy `string` → existing prose render unchanged.

### 4. Generic vision — `lib/ai/vision.ts` + `lib/ai/extraction-worker.ts`

Add `extractGenericPhoto({ bytes, mimeType, extractFor })`:

- Single Claude vision call. New `GENERIC_PHOTO_VISION_SYSTEM` prompt: extract per the `extractFor` instruction; return `{ text?, structured?, summary, confidence }`; set `confidence < 0.4` with a specific re-snap suggestion in `summary` when unreadable.
- Plumbing matches existing extractors: `max_tokens: 4096`, `withRetry`, MIME gate, shape validation.

Worker: replace the inert `photo` case with a call to `extractGenericPhoto`. Source `extractFor` by reading the latest `treeState.proposedAction.whatWouldClose.extractFor` from the session row, matched by `artifact.nodeId`. If not derivable, record `failed` rather than calling vision blind. Add `'photo'` to `HIGH_SIGNAL_KINDS`.

## Testing

- `tests/unit/vision.test.ts` — 3 new tests for `extractGenericPhoto`: happy, unreadable returns `confidence < 0.4`, MIME gate rejects.
- `tests/unit/extraction-worker.test.ts` — replace the describe-first `photo` test with two: invokes vision when `extractFor` resolvable, records `failed` when not.
- `tests/unit/tree-engine.test.ts` — parse both shapes; reject `kind: 'photo'` missing `extractFor`; reject unknown `kind`.
- DeclineOrDefer component test — renders Yes/No for confirm, camera button for photo, prose fallback for legacy string.
- **Manual verification on staging Vercel preview before declaring done** (per verification-rigor): one full `confirm` flow + one full `photo` flow on a real authed session.

## Risks

1. **Prompt over-asking.** New rule could nudge the AI to demand confirm/photo at every uncertain step. Mitigation: existing 1+2 follow-up budget caps repetition; rubric explicitly forbids photo asks when confirm closes the gap. Verify on dogfood before declaring done.
2. **Generic extractor accuracy.** One universal vision prompt may extract less precisely than the tuned `scan_screen` / `wiring_diagram` extractors. Mitigation: tuned extractors stay live for their kinds; generic only runs on `photo`. If accuracy is shaky, add a tuned named flavor (deferred).
3. **Backward compat.** Old sessions with string `whatWouldClose` still parse and render via the prose fallback.

## Acceptance

- [ ] Tree-engine prompt updated; `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build` all clean.
- [ ] `whatWouldClose` accepts both shapes; legacy strings still parse and render.
- [ ] Decline-or-Defer surface renders Yes/No, camera button, prose fallback per shape.
- [ ] `photo` kind end-to-end: capture → upload → generic extractor → AI consumes on next turn.
- [ ] Manual verification on staging preview: confirm flow + photo flow on a real authed session.
- [ ] Brandon promotes from `staging/camera-vision` to `main` when satisfied — agent does not push to main.
