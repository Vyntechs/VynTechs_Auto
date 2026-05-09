# Camera evidence — AI asks, never bluffs

**Branch:** `staging/camera-vision` (off `origin/main`)
**Date:** 2026-05-09
**Status:** spec — pending Brandon review

## Problem

The tree-engine emits free-text `whatWouldClose` strings when `proposedAction.confidence` falls below the calibrated threshold. The strings are good but the gating surface only accepts text replies — there is no way for the AI to say *"snap a photo of the source"* and have the UI render that as a one-tap camera ask. This pushes the AI toward bluffing vehicle-specific facts (pin numbers, wire colors, what a healthy part should look like) when retrieval is thin and a fast text reply is the only available gap-closer.

The behavior we want: when the AI is about to make an ungrounded claim, it asks the tech for the cheapest sufficient evidence — a yes/no the tech can attest to, OR a photo of the source (always the broadest useful frame) when text confirmation cannot close the gap. Photos become rare and meaningful, not decoration. The trust posture (AI as tool not source of truth; honest about its limits; never pushes work onto the tech that the tech's own attestation could resolve) becomes self-enforcing in the prompt.

## Behavior change (what the tech sees)

When `proposedAction.confidence < threshold` AND the AI emits `whatWouldClose: { kind: 'photo', ... }`, the gating surface adds a fourth option alongside Decline / Defer / Gather more: a **camera button** labeled with the AI's plain-English reason (`"Snap the pinout page from your service info — I'll grab all pins for connector C171 at once."`). One tap → existing capture pipeline → generic vision extractor reads the image with the AI's `extractFor` instruction → AI consumes the result on the next turn → confidence either rises and the action unblocks, or the AI honestly reports the photo didn't close it.

When `whatWouldClose: { kind: 'confirm', ... }`, the surface renders **`[ Yes ] [ No ]`** for tech-attestable yes/no questions. Most asks land here — it is the cheapest path and the default.

The existing 1+2 follow-up budget per node (Tech-Assisted Retrieval, AGENTS.md §"Risk gating + Decline-or-Defer") caps repetition. After the budget is exhausted the surface pivots to Decline / Defer — the tech is never trapped in a "one more snap" loop.

## Scope

**In scope (this round — pieces 1-4 from the brainstorm):**

1. Tree-engine prompt update — structured `whatWouldClose` with confirm-vs-photo decision rubric
2. Type/parse change — `whatWouldClose` accepts `{ kind: 'confirm' | 'photo', prompt, extractFor? }` OR legacy `string`
3. UI render at the gating surface — camera button, Yes/No, prose fallback
4. Generic photo extractor — replace the inert `photo` case in the extraction worker

**Out of scope (deferred):**

- Tuned named extractors for service-info / part-visual / label kinds — generic covers all in v1
- Client-side image resize (~5× cost win) — optimization, no user value until volume
- Tech-initiated unrequested photo capture — separate feature, layer later if dogfood signals demand
- Audio transcription stub fix — different transport problem, separate branch

## Implementation

### 1. Prompt update — `lib/ai/prompts.ts → TREE_ENGINE_SYSTEM`

Replace the existing `confidenceGap` / `whatWouldClose` paragraph with structured rules:

```
type WhatWouldClose =
  | { kind: "confirm"; prompt: string }
  | { kind: "photo"; prompt: string; extractFor: string }

WHEN proposedAction.confidence is below 0.95, you MUST populate:
  - confidenceGap: one sentence naming the specific uncertainty.
  - whatWouldClose: a confirm OR photo ask (see decision rule).

DECISION RULE — confirm vs photo:
  Default to confirm. The tech is a trained diagnostician with eyes and
  hands; their attestation is sufficient for anything they can verify in a
  sentence. Escalate to photo ONLY when the gap is closed by data the tech
  cannot easily attest to in words AND a photo would let YOU extract that
  data directly.

  Confirm examples (correct):
    - "Confirm the connector positively latches and the back-shell sits flush
       — yes / no?"
    - "Wire visibly chafed where it crosses the bracket — yes / no?"
    - "Coolant in the reservoir milky / cloudy — yes / no?"

  Photo examples (correct — broadest useful frame, never the narrow piece):
    - "Snap the pinout page from your service info for connector C171 — I'll
       grab all pins at once." (extractFor: "full pinout for connector C171")
    - "Snap the engine-bay decal so I can read the build code."
       (extractFor: "build code on the engine-bay decal")
    - "Snap the scan-tool freeze-frame screen so I can read all PIDs at the
       moment of the misfire." (extractFor: "all PIDs in the freeze-frame")

  Anti-patterns (NEVER ask for a photo of these):
    - Anything the tech can verify with eyes and hands and report in one
      sentence. Connector latched? Wire chafed? Oil milky? Belt routing
      correct? — these are confirms, not photos.

  When a photo IS warranted, request the BROADEST useful frame, not the
  narrow piece. Same one-snap cost to the tech, much richer return — once
  you have the full pinout you don't need to re-ask for the next pin.

  extractFor is a one-line instruction to the vision extractor about WHAT
  to pull from the image. Be specific: "full pinout for C171" beats "pin
  numbers"; "build code on the decal" beats "decal text".
```

Keep the existing "senior tech mentoring a junior" voice, the "include WHY and what it unlocks" rule, and the existing 1+2 follow-up budget caveat. The new rule is additive.

### 2. Type / parse — `lib/ai/tree-engine.ts`

- Update the `ProposedAction` TS type doc inside `TREE_ENGINE_SYSTEM` (above) so the model sees the new shape.
- Update the runtime parser (`parseTreeJson` and any `ProposedAction` validation) to accept `whatWouldClose` as `string | WhatWouldClose`. String remains valid for legacy session events; new emissions are objects.
- Object-shape validation: when `kind === 'photo'`, `extractFor` is required; when `kind === 'confirm'`, only `prompt` is required. Throw a clear error on shape violations so the retry loop catches model regressions early.
- No DB migration. `session_events` stores `ProposedAction` in JSON; forward-compat is purely in the parser.

### 3. UI render — `components/screens/active-step-form.tsx` and the gating surface

The active-step-form already renders capture components when `requestedArtifact` is set (existing AI-led photo asks for `scan_screen` / `wiring_diagram` / `audio` / `video`). Keep that path unchanged.

Add a new branch keyed off `proposedAction.whatWouldClose`:

- `kind === 'confirm'` — render `[ Yes ] [ No ]` buttons. On click, POST the chosen reply as an observation to `/api/sessions/[id]/advance` (`{ observation: 'Yes' }` or `'No'`, plus the prompt as context).
- `kind === 'photo'` — render a camera button labeled with `whatWouldClose.prompt`. On click, route through the existing capture endpoint `/api/sessions/[id]/capture` with `kind: 'photo'`. No extra payload — the worker re-derives `extractFor` from session state at extraction time (see worker section).
- legacy `string` — fall through to the existing prose render.

The Decline-or-Defer screen (`/decline` route) gets the same fourth-option treatment when its `gateDecision` carries a `whatWouldClose.kind === 'photo'` payload.

### 4. Generic photo extractor — `lib/ai/vision.ts` + `lib/ai/extraction-worker.ts`

Add `extractGenericPhoto({ bytes, mimeType, extractFor })` to `vision.ts`:

- Single Claude vision call. New system prompt `GENERIC_PHOTO_VISION_SYSTEM` in `prompts.ts`: *"You extract structured facts from an automotive technician's photo. The user message will tell you EXACTLY what to extract. Return JSON: `{ text?: string, structured?: object, summary: string, confidence: number }`. If the image is unreadable for the requested extraction, set `confidence < 0.4` and put a specific re-snap suggestion in `summary` (e.g., 'pin column glared — re-snap with light angled away from the page')."*
- User message: image as base64 + `extractFor` as the literal extraction instruction.
- Plumbing matches existing extractors: `max_tokens: 4096`, `withRetry`, MIME gate, shape validation, `parseJson` recovery.

In `extraction-worker.ts`:

- Replace the `photo` case (currently the inert "Stored — vision not auto-invoked" stub at ~line 108) with a call to `extractGenericPhoto`.
- Source the `extractFor` string by reading the latest `treeState.proposedAction.whatWouldClose.extractFor` from the session row, matched by `artifact.nodeId`. No migration. Costs one DB read on a path that already loads the session. If the value isn't derivable (e.g. the tree advanced past the node before extraction ran), the worker records a `failed` extraction with a clear reason rather than calling vision blind.
- Add `'photo'` to `HIGH_SIGNAL_KINDS` in `lib/ai/artifact-kinds.ts` so inline auto-extraction fires on capture.

## Testing

**Unit:**

- `tests/unit/vision.test.ts` — 3 new tests for `extractGenericPhoto`: happy path with a fake-pinout fixture, unreadable image returns `confidence < 0.4` with a re-snap summary, MIME gate rejects unsupported types.
- `tests/unit/extraction-worker.test.ts` — replace the existing "describe-first stub" test for `photo`. New tests: `photo` kind invokes vision when `extractFor` is derivable; `photo` with no derivable `extractFor` records a clear failed status rather than calling vision blind.
- `tests/unit/tree-engine.test.ts` — parse `whatWouldClose` as both legacy `string` and new object shapes; reject `{ kind: 'photo' }` missing `extractFor`; reject unknown `kind`.
- `tests/unit/active-step-form.test.tsx` (new) — renders camera button for `kind: 'photo'`, Yes/No for `kind: 'confirm'`, prose fallback for `string`. Uses Testing Library's existing patterns from `outcome-capture.test.tsx`.

**E2E:** out of scope this round — Playwright camera testing requires fixture infrastructure we don't have. Manual verification covers the gap.

**Manual verification before declaring done** (per `feedback_verification_rigor.md`):

- One full `confirm` flow on the staging Vercel preview as an authed tech: AI hits a low-confidence step → Yes/No appears → click Yes → AI advances on the confirmation.
- One full `photo` flow on the staging preview: AI hits a low-confidence step needing a spec → camera button appears → snap a fixture photo → AI consumes and advances.

## Risks

1. **Prompt regression — over-asking.** New rule could nudge the AI to demand a photo or a confirm at every uncertain step. Mitigation: existing 1+2 follow-up budget caps repetition; the rubric explicitly forbids photo asks when confirm closes the gap; existing `pnpm test` suite catches grosser regressions. Verify on dogfood sessions before declaring done.
2. **Generic extractor accuracy.** One universal vision prompt might extract less precisely than the tuned `scan_screen` / `wiring_diagram` extractors. Mitigation: keep tuned extractors live for their kinds; generic only runs on the `photo` kind. If accuracy proves shaky in dogfood, add a tuned named flavor (deferred work, not blocking).
3. **Backward compat for legacy session events.** Old sessions stored `whatWouldClose` as plain strings. Parser accepts both shapes; UI renders strings via the prose fallback.
4. **`extractFor` source-of-truth.** Reading from session state on extraction time couples the worker to the tree-state shape. Acceptable cost — the worker already imports `getArtifactById` and the session row is one cheap join away.

## Acceptance

- [ ] Tree-engine prompt updated; `pnpm test` green.
- [ ] `whatWouldClose` accepts both shapes; legacy strings still parse and render.
- [ ] Active-step-form (and decline-or-defer surface) renders camera button + Yes/No + prose fallback per shape.
- [ ] `photo` kind end-to-end: capture → upload → generic extractor → AI consumes on next turn.
- [ ] Unit tests for vision, extraction-worker, tree-engine, active-step-form pass.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm build` clean.
- [ ] Manual verification on staging preview: one full `confirm` flow + one full `photo` flow on a real authed session.
- [ ] Brandon promotes from `staging/camera-vision` to `main` when satisfied — agent does not push to main.
