# Log Observation Button — Loading Animation

**Status:** Ready for implementation
**Branch:** `Loading-animation`
**Date:** 2026-05-10
**Source design:** `/Volumes/Creativity/dev/projects/vyntechs/log-observation-loading/` (Claude design, treated as source of truth)

---

## Goal

Replace the current 2-state `<button>{isPending ? 'Logging…' : 'Log observation'}</button>` in `components/screens/active-step-form.tsx` with the three-state narrating button defined in the Claude design package (`log-button.jsx` + `log-button.css`). Faithful 1:1 port — not a redesign.

The design is the source of truth. Stage labels, timings, easings, animations, variants, and visual tokens are all carried across as-given.

## Non-goals (explicit)

- Redesigning labels, easings, timings, variants, or any visual element of the design.
- Wiring real backend per-stage events (the design uses a pure-timer cycle that loops until the server responds — that is the design's behavior).
- Applying the button to other surfaces in this PR. Only the Log Observation button on `active-step-form.tsx`.
- Changing the existing error display under the textarea.

---

## Visual & behavioral spec (from the design files, verbatim)

### Three states

| State | Visual | Triggered when |
|---|---|---|
| `idle` | Dark graphite substrate, "Log observation" + chevron | Default; after error; on form mount |
| `loading` | Shimmer sweep, pulsing amber dot, italic serif narration cycling 5 stages, draining amber hairline, mono `01/05` counter | `useTransition`'s `isPending === true` |
| `done` | Teal-green substrate flash, checkmark pop-in, "Logged · advancing" | Successful response; held for **700ms** before `router.refresh()` |

### Stages (verbatim from `DEFAULT_STAGES` in `log-button.jsx`)

```js
const DEFAULT_STAGES = [
  { label: "Recording observation", ms: 600 },
  { label: "Parsing photo · 3 frames", ms: 900 },
  { label: "Updating retrieval ladder", ms: 900 },
  { label: "Re-scoring confidence", ms: 800 },
  { label: "Promoting next step", ms: 700 },
];
```

Total cycle = 3,900ms. While `state === 'loading'`, `requestAnimationFrame` advances `stageIdx` based on `(now - startedAt) % totalMs` — i.e. the stages **loop indefinitely** until the parent flips state. Per design.

### Variants

`graphite` (default), `amber`, `paper`. We port all three; only `graphite` is used by the Log Observation surface in this PR. The other variants come along for free for future surfaces.

### `freezeStage` prop

The design includes a `freezeStage` numeric prop that pins the button to a specific stage with no animation. Used by the design canvas's tweaks panel. We port it as-is — useful for Storybook-style previews and tests.

---

## Files to add

### 1. `components/vt/log-button.tsx`

1:1 port of `log-button.jsx`, converted from the design's destructured `React.useState` etc. to standard imports. TypeScript types added. `'use client'` directive at top (uses `useEffect`, `useRef`, `requestAnimationFrame`).

Props:
```ts
type Stage = { label: string; ms: number }

type LogButtonProps = {
  stages?: Stage[]            // default DEFAULT_STAGES from design
  state?: 'idle' | 'loading' | 'done'
  freezeStage?: number | null
  variant?: 'graphite' | 'amber' | 'paper'
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  label?: string              // idle face label, default 'Log observation'
  type?: 'button' | 'submit'  // added so it can be used inside a <form>
  disabled?: boolean          // added to match form's empty-textarea check
}
```

Exports `LogButton` (named) and `DEFAULT_STAGES` (named, for tests / future hookups).

`type='submit'` and `disabled` are the only additions to the design's interface — required to drop into the existing `<form onSubmit>` without changing the form's semantics.

### 2. `components/vt/log-button.css`

Copied verbatim from `log-button.css` in the design package. No edits to selectors, keyframes, or values. Imported once from `app/globals.css` (or a shared CSS entry already loaded).

### 3. Token additions in `app/globals.css`

The design's CSS references `--vt-amber-200/300/400/500` which don't exist in the live `app/globals.css`. Pulled from the original Claude design system (`colors_and_type.css`):

```css
--vt-amber-200: oklch(94% 0.08   90);
--vt-amber-300: oklch(89% 0.14   88);
--vt-amber-400: oklch(84% 0.19   82);
--vt-amber-500: oklch(80% 0.215  78);
```

Placed alongside the existing `--vt-signal-*` and `--vt-elem-*` scales.

Easings (`--vt-ease`, `--vt-ease-instrument`, `--vt-ease-out`) and durations (`--vt-dur-*`) referenced by the CSS already exist in `app/globals.css`. No additions needed.

---

## Files to edit

### `components/screens/active-step-form.tsx`

Replace lines 123–140 (the inline `<button>` + `<DotsThree>` group) so that:

1. The primary submit becomes `<LogButton>` instead of the inline `<button className="btn btn-primary">`.
2. Component owns a small state machine driven by `useTransition`:

```ts
const [isPending, startTransition] = useTransition()
const [phase, setPhase] = useState<'idle' | 'done'>('idle')

const buttonState: 'idle' | 'loading' | 'done' =
  isPending ? 'loading' : phase

function submit(e) {
  e.preventDefault()
  if (!observation.trim()) return
  setError(null)
  startTransition(async () => {
    try {
      const res = await fetch(...)
      if (!res.ok) {
        // ... existing error handling, no change
        return
      }
      setObservation('')
      setPhase('done')
      setTimeout(() => {
        setPhase('idle')
        router.refresh()
      }, 700)
    } catch (err) {
      // existing error handling, no change
    }
  })
}
```

Why the 700ms hold: `router.refresh()` triggers a server re-render that often unmounts this form (because the next active step has a different `nodeId`). Without the hold, the `done` face would never paint. 700ms matches the design's own stage durations (600–900ms range).

3. The secondary `<DotsThree>` "more options" button stays exactly as it is (separate concern; not part of the loading-animation work).

4. The submit button's `disabled={isPending || !observation.trim()}` rule is preserved by passing `disabled` through to `<LogButton>` for the empty-textarea case. The `loading` state already disables clicks via `aria-busy` per the design.

---

## Data flow

```
user types text
  └─> textarea onChange ──> setObservation
user taps button (idle, has text)
  └─> form onSubmit
       └─> startTransition(async)
            ├─> fetch POST /api/sessions/[id]/advance
            │    (server runs adapters, scores tree, returns next node)
            ├─> on 2xx: setPhase('done') [button → done face]
            │    └─> 700ms timeout: setPhase('idle') + router.refresh()
            └─> on error: setError(...) [button → idle, red text under textarea]
```

The button is fully presentational. It doesn't fetch, doesn't know about sessions or the API, and has no side effects beyond its own animation timers. The form owns all I/O and state.

---

## Tests

`tests/log-button.test.tsx` (Vitest + React Testing Library, alongside other component tests):

1. **Renders idle by default** — finds "Log observation" label, no shimmer class.
2. **Loading state shows narration** — render with `state='loading'`, expect `aria-busy="true"`, expect first stage label "Recording observation" visible.
3. **Loading cycles stages on timer** — use `vi.useFakeTimers()`, render with `state='loading'`, advance 700ms, expect stage label to be "Parsing photo · 3 frames".
4. **`freezeStage` pins stage** — render with `state='loading'` and `freezeStage={3}`, expect "Re-scoring confidence" with no rAF activity.
5. **Done state shows check + label** — render with `state='done'`, expect "Logged · advancing", expect `is-done` class.
6. **`disabled` prop blocks click** — render `disabled`, click, expect `onClick` not called.

Plus the existing `active-step-form` tests continue to pass — the form's existing behavioral contract (advance call, error display, observation reset) is unchanged.

## Verification

1. `pnpm test` — green (including new button tests).
2. `pnpm lint` — clean.
3. `pnpm tsc --noEmit` — clean.
4. Branch pushed; Vercel preview deploys; Brandon walks through `intake → active session → log observation` on a real iPhone and confirms:
   - Loading feels calm (slow shimmer, not a fast spinner).
   - Done state is visible — "Logged · advancing" reads before the form transitions.
   - Stage labels read clearly in shop light at button size.

---

## Out of scope (deferred)

- Replacing the form's inline-styled textarea with the design system's textarea treatment.
- Applying `<LogButton>` to other "submit + wait + advance" surfaces (decline-or-defer, repair-ask-form, etc.).
- Wiring real per-adapter backend events into the narration. The design's pure-timer cycling stands.

---

## Open questions for Brandon

None blocking. Defaults chosen:
- Done-state hold: **700ms** (in design's stage-duration range; can tune on preview).
- Variant for Log Observation: **`graphite`** (matches current `btn-primary`).
