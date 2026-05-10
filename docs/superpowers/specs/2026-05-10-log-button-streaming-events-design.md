# Log Button — Real Backend Events (PR 21)

**Status:** Ready for implementation
**Branch:** `Loading-animation` (stacked on top of PR 20's commits)
**Date:** 2026-05-10
**Predecessor:** PR 20 (`docs/superpowers/specs/2026-05-10-log-button-loading-animation-design.md`) — visual landed; narration is a pure timer loop

---

## Goal

Stop the LogButton's stage narration from cycling on a timer that ignores reality. Wire the button's `freezeStage` prop to real per-stage events emitted by a new streaming `/advance/stream` endpoint. The label the technician reads matches the work the server is genuinely doing in that moment.

PR 21 is **purely additive** to PR 20 — the LogButton component itself is not modified. PR 21 stacks on top of PR 20 on the same `Loading-animation` branch and ships as one squash-merge after both pieces are validated together on the Vercel preview.

## Non-goals

- Modifying `components/vt/log-button.tsx` (already shipped in PR 20).
- Replacing the existing `/api/sessions/[id]/advance` JSON endpoint. We add a new sibling `/advance/stream` so the second `/advance` consumer (`decline-or-defer-live.tsx`) is untouched.
- Adding sub-counters to the narration ("checking source 3 of 6"). The design's counter is stage-level (`01/05`); we don't expand it.
- Reworking `updateTree`'s internals. We instrument `advanceSession`'s outer choreography only.

---

## Stage mapping

The 5 design stages map to real moments in `advanceSession`:

| Stage idx | Design label | Server moment | Source code touchpoint |
|---|---|---|---|
| 0 | "Recording observation" | request received, profile + session loaded, artifacts compiled | `lib/sessions.ts:101–164` (top of `advanceSession`) |
| 1 | "Parsing photo · 3 frames" | **conditional:** only fired when the current node has at least one photo/scan/wiring artifact in `nodeArtifacts` | `lib/sessions.ts:141–148` |
| 2 | "Updating retrieval ladder" | inside `updateTree` while `runRetrieval` is walking adapters; we tap into the orchestrator's existing per-adapter loop | `lib/retrieval/orchestrator.ts:36` |
| 3 | "Re-scoring confidence" | after `runRetrieval` returns and `updateTree`'s LLM call begins (the AI is reading retrieval results) | `lib/sessions.ts:167` (call to `updateTree`); event fires from inside the `buildUpdateTreeWithRetrieval` wrapper after retrieval but before `updateTree`'s actual LLM step |
| 4 | "Promoting next step" | gate decision + `appendSessionEvent` + `updateSessionTreeState` | `lib/sessions.ts:179–223` |

If no photo artifact exists, stage 1 is skipped — client jumps from idx 0 to idx 2 (and the counter still shows `01/04` … `04/04` because the `stages` array passed to LogButton excludes the photo entry).

---

## Streaming protocol

**Format:** newline-delimited JSON (NDJSON) over a `Response` body. Plain `text/plain; charset=utf-8` content-type. One JSON object per line; the client splits on `\n` and parses each.

NDJSON is chosen over Server-Sent Events because:
- We don't need EventSource auto-reconnect (a fetch-driven request is one-shot — if it drops, the form resubmits or errors).
- The client lives inside React state, not a long-lived listener — `fetch` + `response.body.getReader()` is enough.
- No special middleware or content-type negotiation; works on Vercel's standard Node.js function runtime.

### Event shape

```ts
type StreamEvent =
  | { type: 'init'; stages: Array<{ label: string }> }  // FIRST event — declares the stage set for this run
  | { type: 'stage'; idx: number; label: string }       // stage transition; idx is into the init.stages array
  | { type: 'done'; tree: TreeState }                   // success terminal
  | { type: 'error'; status: number; message: string }  // failure terminal
```

The server always emits `init` first, with a stage list that reflects what will actually fire on this request — photo stage included only if `nodeArtifacts` contains at least one photo/scan/wiring artifact. After `init`, every `stage` event's `idx` is into that same array (not into the design's canonical 5-stage list). So `init.stages.length` is either 4 or 5, the counter displays accordingly (`01/04`...`04/04` or `01/05`...`05/05`), and the client never has to maintain its own server-mirroring stage table.

Wire example for a successful flow without a photo on the step:

```
{"type":"init","stages":[{"label":"Recording observation"},{"label":"Updating retrieval ladder"},{"label":"Re-scoring confidence"},{"label":"Promoting next step"}]}
{"type":"stage","idx":0,"label":"Recording observation"}
{"type":"stage","idx":1,"label":"Updating retrieval ladder"}
{"type":"stage","idx":2,"label":"Re-scoring confidence"}
{"type":"stage","idx":3,"label":"Promoting next step"}
{"type":"done","tree":{...}}
```

With a photo, `init.stages.length === 5` and an extra `Parsing photo · N frames` slot sits at idx 1.

`label` is duplicated on `stage` events for log-readability; the client can use either `idx` or `label` to drive `freezeStage`.

---

## Server side

### `app/api/sessions/[id]/advance/stream/route.ts` — NEW

Mirrors `app/api/sessions/[id]/advance/route.ts`'s auth + body parsing, but returns a streaming response:

```ts
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const body = await req.json().catch(() => null)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))

      const updateTreeWithRetrieval = buildUpdateTreeWithRetrieval({
        db, adapters: ADAPTERS, updateTree, runRetrieval,
        validateRetrievalResults, retrieveCorpus,
        sessionId: id,
        onProgress: (event) => emit(event), // NEW: orchestrator emits stage 2 + 3
      })

      try {
        const result = await advanceSession({
          db,
          userId: user.id,
          sessionId: id,
          body,
          updateTree: updateTreeWithRetrieval,
          onProgress: emit, // NEW: advanceSession emits stages 0, 1, 4
        })
        if (!result.ok) {
          emit({ type: 'error', status: result.status, message: result.error })
        } else {
          emit({ type: 'done', tree: result.tree })
        }
      } catch (err) {
        emit({
          type: 'error',
          status: 500,
          message: err instanceof Error ? err.message : 'stream error',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
```

### `lib/sessions.ts` — MODIFY `advanceSession`

Add an optional `onProgress?: (event: StreamEvent) => void` opt. Defaults to `() => {}` so the existing JSON endpoint and tests are unaffected.

Stage emissions inside `advanceSession`:
- After auth/load succeeds and artifacts are compiled (line ~163): emit stage 0 (`Recording observation`)
- If `nodeArtifacts.some(a => ['photo','scan_screen','wiring_diagram'].includes(a.kind))`: emit stage 1 (`Parsing photo · N frames`) **before** calling `updateTree`. The `N` reflects actual frame count when known; otherwise omit `· N frames` from the label.
- Stage 2 + 3 are emitted by the orchestrator (see below)
- Just before `appendSessionEvent` (line ~213): emit stage 4 (`Promoting next step`)

### `lib/retrieval/wire-into-tree.ts` — MODIFY `buildUpdateTreeWithRetrieval`

Add an `onProgress?: (event: StreamEvent) => void` field to the input. Inside the wrapped function:
- Before calling `runRetrieval`: emit stage 2 (`Updating retrieval ladder`)
- After `runRetrieval` resolves but before calling `updateTree` (the LLM step): emit stage 3 (`Re-scoring confidence`)

Default is no-op so existing tests / non-streaming endpoint are unaffected.

We do NOT crack open `updateTree` itself — its internal LLM call is opaque and we don't want to refactor it for this PR.

---

## Client side

### `lib/use-advance-stream.ts` — NEW

A small headless hook. Owns `fetch`, stream parsing, and exposes state.

```ts
export type AdvanceStreamState = {
  stages: Array<{ label: string }> | null  // populated by the init event
  stageIdx: number | null                  // null until first stage event; integer thereafter
  isLoading: boolean
  isDone: boolean
  error: string | null
  tree: TreeState | null
}

export function useAdvanceStream(): {
  state: AdvanceStreamState
  submit: (input: { sessionId: string; observation: string }) => Promise<void>
  reset: () => void
}
```

`submit` POSTs to `/api/sessions/${sessionId}/advance/stream`, reads the response body via `getReader()`, splits on `\n`, parses events, and updates `state` accordingly. On `done` event: `isDone=true, tree=event.tree`. On `error` event: `error=event.message, isDone=false`. On stream-level `TypeError` (network drop): `error=describeFetchError(err), isDone=false`.

The hook does NOT call `router.refresh()` — that stays in the form, called inside the existing `setTimeout(() => router.refresh(), 700)` after `done` lands.

### `components/screens/active-step-form.tsx` — MODIFY

Replace the inline `fetch` + `useTransition` with `useAdvanceStream`. Mapping:

```ts
const { state, submit, reset } = useAdvanceStream()

const buttonState: 'idle' | 'loading' | 'done' =
  state.isLoading ? 'loading' : phase

// `state.stages` comes from the init event, so the form never decides which stages exist.
// While stages is null (request just started), pass DEFAULT_STAGES so the button's timer
// can run as a brief fallback until init lands (~30ms typical).
const stages = state.stages ?? DEFAULT_STAGES

<LogButton
  type="submit"
  state={buttonState}
  freezeStage={state.stageIdx}    // null until first stage event; integer once known
  stages={stages}
  disabled={state.isLoading || !observation.trim()}
  label="Log observation"
  variant="graphite"
/>
```

The form keeps its existing 700ms done-state hold + `router.refresh()` choreography. On error: same red text under the textarea.

When `state.stageIdx === null` (loading just started, no event yet — happens for the first ~30ms before the `init` and first `stage` events arrive), `freezeStage={null}` lets the button's internal timer briefly tick. That's the graceful fallback: it looks like PR 20's behavior for the first frame and then snaps to the real stage as soon as the server speaks.

---

## Failure modes

| Mode | Behavior |
|---|---|
| Stream drops mid-flight (network blip, server crash) | Hook catches the error from `reader.read()`. `state.error` set; button snaps to idle; existing red error text shows. No mid-stream "stuck" UI. |
| HTTP-level error (4xx/5xx) before stream starts | Hook reads non-2xx response, parses JSON error body, sets `state.error`. Button snaps to idle. Same as today's `/advance` failure. |
| Stream completes but emits `{type:'error',...}` | Hook treats it as a logical error: `state.error = event.message`, `state.isDone = false`. Button snaps to idle, red text appears. |
| Server is faster than the eye | Stages flash past. Acceptable — matches reality. |
| User closes tab mid-stream | Browser aborts the fetch; the route's `controller.close()` runs in `finally`. Server-side already-persisted state (e.g., observation save) sticks; the rest is dropped. Same as today's `/advance` mid-flight close. |
| `runRetrieval` is fully cache-hit (skips per-adapter work) | Stages 2 and 3 still fire (orchestrator entered + finished); they just resolve fast. Honest. |

---

## Tests

### `tests/unit/use-advance-stream.test.ts` — NEW
- **happy path:** mock `fetch` to return a ReadableStream emitting all 5 stages then `done`. Assert state progresses 0 → 1 → 2 → 3 → 4 → done with correct `tree`.
- **photo skipped:** stream emits 0, then jumps to 2 (no stage 1). Assert `stageIdx` reflects the jump correctly.
- **error event:** stream emits stage 0, then `{type:'error', status:500, message:'tree update failed'}`. Assert `state.error === 'tree update failed'`, `isDone === false`.
- **network drop mid-stream:** mock reader throws on second `read()`. Assert `state.error` populated.
- **HTTP error before stream:** mock `fetch` returns `{ok:false, status:401, json:() => ({error:'unauthorized'})}`. Assert `state.error === 'unauthorized'`.
- **reset clears state:** call `reset()`, assert all fields back to defaults.

### `tests/unit/advance-stream-route.test.ts` — NEW
- Mock `advanceSession` to invoke its `onProgress` callback with stages 0, 1, 4.
- Mock `buildUpdateTreeWithRetrieval` factory so the wrapper invokes `onProgress` with stages 2, 3.
- Assert response body parses to expected NDJSON event sequence ending in `done`.
- Assert auth failure returns 401 JSON (not stream).

### `tests/unit/active-step-form.test.tsx` — MODIFY
- Existing 4 tests stay; some require updating because the form now uses `useAdvanceStream` instead of bare `fetch`. Strategy: stub `useAdvanceStream` via vi.mock so the form's tests stay focused on form behavior (state machine, done-hold, error display) — same coverage, decoupled from streaming details.

### `tests/unit/log-button.test.tsx` — UNCHANGED
The LogButton itself does not change; its 10 tests pass as-is.

---

## Verification

1. `pnpm test` — full suite green.
2. `pnpm exec tsc --noEmit` — clean.
3. `pnpm build` — clean.
4. Push to `Loading-animation`. Vercel preview includes both PR 20 + PR 21.
5. Brandon walks the flow on iPhone:
   - Confirm stages now sit at their real work instead of cycling
   - Confirm photo stage only fires when there's a photo on the step
   - Confirm error fallback (network drop test: turn airplane mode mid-tap) shows red error text
   - Confirm done flash + advance still works as in PR 20

---

## Out of scope (future work)

- Per-adapter sub-counter ("Searching · 3 of 6 sources").
- Streaming response for decline-or-defer's `/advance` call (no LogButton there yet).
- Cracking open `updateTree`'s internal LLM step into multiple sub-stages.

---

## Open questions for Brandon

None blocking. Defaults chosen:
- Photo-stage label uses `· N frames` count when known; falls back to `Parsing photo` otherwise.
- Photo-detection uses node-attached photo artifacts (consistent with how `nodeArtifacts` is compiled in `advanceSession`).
- Stream protocol: NDJSON over plain text/plain.
- No reconnect on stream drop (single-shot fetch + form resubmit on user action).
