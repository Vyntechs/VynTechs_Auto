# Log Button — Real Backend Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the LogButton's `freezeStage` prop to real per-stage events emitted by a new streaming `/advance/stream` endpoint, so the narration label always matches what the server is actually doing.

**Architecture:** Two `onProgress` callbacks added to `lib/sessions.ts → advanceSession` and `lib/retrieval/wire-into-tree.ts → buildUpdateTreeWithRetrieval`. New streaming route `app/api/sessions/[id]/advance/stream/route.ts` returns NDJSON of `init`, `stage`, `done`, and `error` events. New client hook `lib/use-advance-stream.ts` reads the body stream and exposes `{ stages, stageIdx, isLoading, isDone, error, tree }`. Form (`active-step-form.tsx`) swaps inline `fetch`+`useTransition` for the hook and feeds `stageIdx` to the LogButton's existing `freezeStage` prop. **The LogButton component is unchanged.**

**Tech Stack:** React 19, Next.js 16 App Router (Node.js runtime), TypeScript, Vitest + happy-dom, NDJSON over `text/plain`.

**Spec:** `docs/superpowers/specs/2026-05-10-log-button-streaming-events-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/advance-stream-events.ts` | CREATE | The `StreamEvent` discriminated union type, shared by route + hook + tests. Single source of truth for the wire format. |
| `lib/sessions.ts` | MODIFY | `advanceSession` accepts an optional `onProgress?: (event: StreamEvent) => void`. Emits stages 0, 1, 4. |
| `lib/retrieval/wire-into-tree.ts` | MODIFY | `buildUpdateTreeWithRetrieval` deps gain optional `onProgress?: (event: StreamEvent) => void`. Wrapper emits stages 2, 3. |
| `app/api/sessions/[id]/advance/stream/route.ts` | CREATE | New POST endpoint. Same auth as `/advance`. Returns a `Response` whose body is a `ReadableStream` of NDJSON events. |
| `lib/use-advance-stream.ts` | CREATE | React hook. `submit(input)` POSTs to the stream endpoint, parses NDJSON line-by-line, exposes state. |
| `components/screens/active-step-form.tsx` | MODIFY | Swap inline fetch for `useAdvanceStream`. Feed `state.stageIdx` to LogButton's `freezeStage`, `state.stages` to `stages`. |
| `tests/unit/advance-progress-callbacks.test.ts` | CREATE | Tests `advanceSession` emits expected events when given an `onProgress`; tests `buildUpdateTreeWithRetrieval` emits `updating_retrieval` and `re-scoring`. |
| `tests/unit/advance-stream-route.test.ts` | CREATE | Tests `/advance/stream` route's response body parses to expected NDJSON sequence. |
| `tests/unit/use-advance-stream.test.ts` | CREATE | Hook tests: happy path, photo skipped, error event, network drop, HTTP error, reset. |
| `tests/unit/active-step-form.test.tsx` | MODIFY | Stub `useAdvanceStream` so existing 4 tests stay focused on form behavior, not stream details. |

---

## Phase A — Shared types

### Task A1: Define `StreamEvent` shared types

**Files:** Create `lib/advance-stream-events.ts`

- [ ] **Step 1: Write the file**

```ts
import type { TreeState } from '@/lib/ai/tree-engine'

export type AdvanceStreamStage = { label: string }

export type AdvanceStreamEvent =
  | { type: 'init'; stages: AdvanceStreamStage[] }
  | { type: 'stage'; idx: number; label: string }
  | { type: 'done'; tree: TreeState }
  | { type: 'error'; status: number; message: string }

/** Encode one event as a single NDJSON line (with trailing newline). */
export function encodeEvent(event: AdvanceStreamEvent): string {
  return JSON.stringify(event) + '\n'
}

/** Parse a single NDJSON line. Throws if not a valid AdvanceStreamEvent shape. */
export function parseEvent(line: string): AdvanceStreamEvent {
  const obj = JSON.parse(line)
  if (
    !obj ||
    typeof obj !== 'object' ||
    typeof obj.type !== 'string' ||
    !['init', 'stage', 'done', 'error'].includes(obj.type)
  ) {
    throw new Error(`invalid stream event: ${line}`)
  }
  return obj as AdvanceStreamEvent
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/advance-stream-events.ts
git commit -m "feat(advance-stream): shared StreamEvent type + NDJSON helpers"
```

---

## Phase B — Wrap retrieval orchestrator with progress

### Task B1: Failing test — `buildUpdateTreeWithRetrieval` emits stages 2 and 3

**Files:** Create `tests/unit/advance-progress-callbacks.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildUpdateTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'
import type { TreeState } from '@/lib/ai/tree-engine'

const makeFakeTree = (): TreeState => ({
  nodes: [],
  currentNodeId: 'n1',
  message: 'ok',
} as unknown as TreeState)

describe('buildUpdateTreeWithRetrieval onProgress', () => {
  it('emits stage 2 (Updating retrieval ladder) before runRetrieval and stage 3 (Re-scoring) after', async () => {
    const events: AdvanceStreamEvent[] = []
    const onProgress = (e: AdvanceStreamEvent) => events.push(e)

    const runRetrieval = vi.fn().mockResolvedValue({
      results: [],
      cacheHits: [],
      errors: [],
    })
    const validateRetrievalResults = vi.fn().mockResolvedValue([])
    const updateTree = vi.fn().mockResolvedValue(makeFakeTree())

    const wrapped = buildUpdateTreeWithRetrieval({
      db: {} as never,
      adapters: [],
      updateTree: updateTree as never,
      runRetrieval: runRetrieval as never,
      validateRetrievalResults: validateRetrievalResults as never,
      onProgress,
    })

    await wrapped({
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        vehicleEngine: '5.0L',
        customerComplaint: 'misfire',
      } as never,
      currentTree: makeFakeTree(),
      observation: 'plug 4 burnt',
    } as never)

    const stageEvents = events.filter((e) => e.type === 'stage')
    expect(stageEvents).toHaveLength(2)
    expect(stageEvents[0]).toMatchObject({ type: 'stage', label: 'Updating retrieval ladder' })
    expect(stageEvents[1]).toMatchObject({ type: 'stage', label: 'Re-scoring confidence' })
  })

  it('does nothing when onProgress is not provided', async () => {
    const runRetrieval = vi.fn().mockResolvedValue({ results: [], cacheHits: [], errors: [] })
    const validateRetrievalResults = vi.fn().mockResolvedValue([])
    const updateTree = vi.fn().mockResolvedValue(makeFakeTree())

    const wrapped = buildUpdateTreeWithRetrieval({
      db: {} as never,
      adapters: [],
      updateTree: updateTree as never,
      runRetrieval: runRetrieval as never,
      validateRetrievalResults: validateRetrievalResults as never,
    })

    await expect(
      wrapped({
        intake: {
          vehicleYear: 2020,
          vehicleMake: 'Ford',
          vehicleModel: 'F-150',
          vehicleEngine: '5.0L',
          customerComplaint: 'misfire',
        } as never,
        currentTree: makeFakeTree(),
        observation: 'plug 4 burnt',
      } as never),
    ).resolves.toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/advance-progress-callbacks.test.ts`
Expected: First test FAILS (`stageEvents` length is 0). Second test PASSES (no-op default works).

- [ ] **Step 3: Commit failing test**

```bash
git add tests/unit/advance-progress-callbacks.test.ts
git commit -m "test(advance-progress): expect retrieval wrapper to emit stage events"
```

### Task B2: Implement onProgress in `buildUpdateTreeWithRetrieval`

**Files:** Modify `lib/retrieval/wire-into-tree.ts`

- [ ] **Step 1: Add import + type field**

In `lib/retrieval/wire-into-tree.ts`, add the import at the top alongside other type imports:

```ts
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'
```

In `BuildUpdateTreeWithRetrievalDeps`, add the optional field:

```ts
  /** Optional. Called with stage events ('Updating retrieval ladder' before
   *  retrieval starts, 'Re-scoring confidence' after retrieval resolves and
   *  before the LLM call). Defaults to no-op. */
  onProgress?: (event: AdvanceStreamEvent) => void
```

- [ ] **Step 2: Emit stages from inside the wrapper**

In `buildUpdateTreeWithRetrieval`, after the `ctx` constant is built (~line 71) and BEFORE `retrievalPromise` is created, add:

```ts
    deps.onProgress?.({
      type: 'stage',
      idx: -1, // route fills the absolute idx; wrapper just signals "this stage"
      label: 'Updating retrieval ladder',
    })
```

After `Promise.all([retrievalPromise, corpusPromise])` resolves and BEFORE `return deps.updateTree(...)`, add:

```ts
    deps.onProgress?.({
      type: 'stage',
      idx: -1,
      label: 'Re-scoring confidence',
    })
```

The `idx: -1` sentinel is rewritten by the route handler before sending on the wire (the route knows the canonical idx given the `init` stage list it sent first). The wrapper deliberately does not know about the absolute order.

- [ ] **Step 3: Run tests**

Run: `pnpm test tests/unit/advance-progress-callbacks.test.ts`
Expected: BOTH tests pass.

- [ ] **Step 4: Run full retrieval test suite to verify no regressions**

Run: `pnpm test tests/unit/wire-into-tree.test.ts tests/unit/retrieval-orchestrator.test.ts`
Expected: existing tests pass (the optional new prop defaults to undefined, behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/retrieval/wire-into-tree.ts
git commit -m "feat(retrieval): emit progress events from updateTree wrapper"
```

---

## Phase C — Wrap `advanceSession` with progress

### Task C1: Failing test — `advanceSession` emits stages 0, 1 (when photo present), 4

**Files:** Modify `tests/unit/advance-progress-callbacks.test.ts` (append cases)

- [ ] **Step 1: Append the test cases**

Add to the same file, AFTER the existing describe block:

```ts
import { advanceSession } from '@/lib/sessions'

describe('advanceSession onProgress', () => {
  function makeStubs(opts: { artifacts?: Array<{ kind: string }> } = {}) {
    const events: AdvanceStreamEvent[] = []
    const onProgress = (e: AdvanceStreamEvent) => events.push(e)

    const updateTree = vi.fn().mockResolvedValue(makeFakeTree())
    const listArtifacts = vi.fn().mockResolvedValue(
      (opts.artifacts ?? []).map((a, i) => ({
        id: `a${i}`,
        sessionId: 's1',
        nodeId: 'n1',
        kind: a.kind,
        extractionStatus: 'done',
        extraction: { summary: 'test' },
      })),
    )

    return { events, onProgress, updateTree, listArtifacts }
  }

  // Mock all of lib/sessions's db dependencies via vi.mock at top of file (see Step 2).

  it('emits stage 0 (Recording observation) right after auth/load', async () => {
    const { events, onProgress, updateTree, listArtifacts } = makeStubs()

    await advanceSession({
      db: {} as never,
      userId: 'u1',
      sessionId: 's1',
      body: { observation: 'plug 4 burnt' },
      updateTree,
      listArtifacts: listArtifacts as never,
      onProgress,
    })

    const stageEvents = events.filter((e) => e.type === 'stage')
    expect(stageEvents[0]).toMatchObject({ label: 'Recording observation' })
    expect(stageEvents[stageEvents.length - 1]).toMatchObject({
      label: 'Promoting next step',
    })
  })

  it('emits stage 1 (Parsing photo · N frames) when nodeArtifacts has a photo', async () => {
    const { events, onProgress, updateTree, listArtifacts } = makeStubs({
      artifacts: [{ kind: 'photo' }, { kind: 'photo' }],
    })

    await advanceSession({
      db: {} as never,
      userId: 'u1',
      sessionId: 's1',
      body: { observation: 'plug 4 burnt' },
      updateTree,
      listArtifacts: listArtifacts as never,
      onProgress,
    })

    const photoEvent = events.find(
      (e) => e.type === 'stage' && e.label.startsWith('Parsing photo'),
    )
    expect(photoEvent).toBeDefined()
    expect(photoEvent).toMatchObject({ label: 'Parsing photo · 2 frames' })
  })

  it('does NOT emit photo stage when no photo artifacts exist', async () => {
    const { events, onProgress, updateTree, listArtifacts } = makeStubs({
      artifacts: [{ kind: 'audio' }],
    })

    await advanceSession({
      db: {} as never,
      userId: 'u1',
      sessionId: 's1',
      body: { observation: 'plug 4 burnt' },
      updateTree,
      listArtifacts: listArtifacts as never,
      onProgress,
    })

    expect(
      events.some((e) => e.type === 'stage' && e.label.startsWith('Parsing photo')),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Add db query mocks at the top of the test file**

Right after the imports in `tests/unit/advance-progress-callbacks.test.ts`, add:

```ts
vi.mock('@/lib/db/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/queries')>(
    '@/lib/db/queries',
  )
  return {
    ...actual,
    getProfileByUserId: vi.fn().mockResolvedValue({ id: 'p1', shopId: 'shop1' }),
    getSessionById: vi.fn().mockResolvedValue({
      id: 's1',
      techId: 'p1',
      status: 'open',
      treeState: { nodes: [], currentNodeId: 'n1', message: '' },
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        vehicleEngine: '5.0L',
        customerComplaint: 'misfire',
      },
    }),
    listArtifactsForSession: vi.fn().mockResolvedValue([]),
    appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    updateSessionTreeState: vi.fn().mockResolvedValue(undefined),
    recordTechAssistRequest: vi.fn().mockResolvedValue({ exhausted: false }),
  }
})

vi.mock('@/lib/gating/gap-handler', () => ({
  gateProposedAction: vi.fn().mockResolvedValue({ ok: true }),
}))
```

- [ ] **Step 3: Run tests, expect fails**

Run: `pnpm test tests/unit/advance-progress-callbacks.test.ts`
Expected: 3 new advanceSession tests FAIL (no events emitted). The 2 wrapper tests still pass.

- [ ] **Step 4: Commit failing tests**

```bash
git add tests/unit/advance-progress-callbacks.test.ts
git commit -m "test(advance): expect advanceSession to emit stages 0, 1, 4"
```

### Task C2: Implement `onProgress` in `advanceSession`

**Files:** Modify `lib/sessions.ts`

- [ ] **Step 1: Add the import**

Top of `lib/sessions.ts`, add to the existing imports block:

```ts
import type { AdvanceStreamEvent } from './advance-stream-events'
```

- [ ] **Step 2: Add `onProgress` to the function signature**

In `advanceSession`'s opts type (line ~101), add:

```ts
  /** Optional. Called as the function moves through stages. Defaults to no-op. */
  onProgress?: (event: AdvanceStreamEvent) => void
```

- [ ] **Step 3: Emit stages at the right moments**

After `nodeArtifacts` and `sessionDtcs` are compiled (after line 163, before the `let nextTree: TreeState` line), add:

```ts
  opts.onProgress?.({
    type: 'stage',
    idx: -1,
    label: 'Recording observation',
  })

  const photoArtifactCount = nodeArtifacts.filter((a) =>
    ['photo', 'scan_screen', 'wiring_diagram'].includes(a.kind),
  ).length
  if (photoArtifactCount > 0) {
    opts.onProgress?.({
      type: 'stage',
      idx: -1,
      label: `Parsing photo · ${photoArtifactCount} frames`,
    })
  }
```

Just BEFORE the `await appendSessionEvent(...)` call (around line 213), add:

```ts
  opts.onProgress?.({
    type: 'stage',
    idx: -1,
    label: 'Promoting next step',
  })
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/unit/advance-progress-callbacks.test.ts`
Expected: ALL 5 tests pass.

- [ ] **Step 5: Run the existing advance-session test to confirm no regression**

Run: `pnpm test tests/unit/advance-session-handler.test.ts`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add lib/sessions.ts
git commit -m "feat(sessions): emit progress events from advanceSession"
```

---

## Phase D — Streaming route

### Task D1: Failing test for `/advance/stream` route

**Files:** Create `tests/unit/advance-stream-route.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseEvent } from '@/lib/advance-stream-events'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
    },
  }),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))

const getSessionByIdMock = vi.fn().mockResolvedValue({
  id: 's1',
  treeState: { currentNodeId: 'n1' },
})
const listArtifactsForSessionMock = vi.fn().mockResolvedValue([])
vi.mock('@/lib/db/queries', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/db/queries')>('@/lib/db/queries')
  return {
    ...actual,
    getSessionById: (...args: unknown[]) => getSessionByIdMock(...args),
    listArtifactsForSession: (...args: unknown[]) =>
      listArtifactsForSessionMock(...args),
  }
})

const advanceSessionMock = vi.fn()
vi.mock('@/lib/sessions', () => ({
  advanceSession: (opts: Parameters<typeof advanceSessionMock>[0]) =>
    advanceSessionMock(opts),
}))

const buildUpdateTreeWithRetrievalMock = vi.fn(() => () => Promise.resolve({}))
vi.mock('@/lib/retrieval/wire-into-tree', () => ({
  buildUpdateTreeWithRetrieval: (deps: unknown) =>
    buildUpdateTreeWithRetrievalMock(deps),
}))

vi.mock('@/lib/ai/tree-engine', () => ({ updateTree: vi.fn() }))
vi.mock('@/lib/retrieval/orchestrator', () => ({ runRetrieval: vi.fn() }))
vi.mock('@/lib/retrieval/validator', () => ({ validateRetrievalResults: vi.fn() }))
vi.mock('@/lib/corpus/retrieval', () => ({ retrieveCorpus: vi.fn() }))
vi.mock('@/lib/retrieval/adapters/nhtsa', () => ({ NHTSAAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/manufacturer-recall', () => ({
  ManufacturerRecallAdapter: class {},
}))
vi.mock('@/lib/retrieval/adapters/forum', () => ({ ForumAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/youtube', () => ({ YouTubeAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/reddit', () => ({ RedditAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/web-search', () => ({ WebSearchAdapter: class {} }))

import { POST } from '@/app/api/sessions/[id]/advance/stream/route'

async function readAllEvents(res: Response): Promise<AdvanceStreamEvent[]> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parseEvent)
}

describe('POST /api/sessions/[id]/advance/stream', () => {
  beforeEach(() => {
    advanceSessionMock.mockReset()
    buildUpdateTreeWithRetrievalMock.mockReset()
    buildUpdateTreeWithRetrievalMock.mockReturnValue(() =>
      Promise.resolve({} as never),
    )
  })

  it('emits init -> stages -> done on success', async () => {
    advanceSessionMock.mockImplementation(async (opts) => {
      // Simulate advanceSession emitting stages 0, 4
      opts.onProgress({ type: 'stage', idx: -1, label: 'Recording observation' })
      // Simulate the wrapper emitting stages 2, 3 — buildUpdateTreeWithRetrieval
      // would have called onProgress directly. For the route test, mimic those
      // by invoking the wrapper's onProgress via the captured deps.
      const wrapperDeps = buildUpdateTreeWithRetrievalMock.mock.calls[0][0] as {
        onProgress: (e: AdvanceStreamEvent) => void
      }
      wrapperDeps.onProgress({ type: 'stage', idx: -1, label: 'Updating retrieval ladder' })
      wrapperDeps.onProgress({ type: 'stage', idx: -1, label: 'Re-scoring confidence' })
      opts.onProgress({ type: 'stage', idx: -1, label: 'Promoting next step' })
      return { ok: true, tree: { nodes: [], currentNodeId: 'n2', message: 'ok' } }
    })

    const req = new Request('http://localhost/api/sessions/s1/advance/stream', {
      method: 'POST',
      body: JSON.stringify({ observation: 'plug 4 burnt' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)

    const events = await readAllEvents(res)
    expect(events[0]).toMatchObject({ type: 'init' })
    const init = events[0] as Extract<AdvanceStreamEvent, { type: 'init' }>
    expect(init.stages.map((s) => s.label)).toEqual([
      'Recording observation',
      'Updating retrieval ladder',
      'Re-scoring confidence',
      'Promoting next step',
    ])

    const stages = events.filter((e) => e.type === 'stage') as Array<
      Extract<AdvanceStreamEvent, { type: 'stage' }>
    >
    expect(stages.map((s) => s.idx)).toEqual([0, 1, 2, 3])

    expect(events[events.length - 1]).toMatchObject({ type: 'done' })
  })

  it('emits init with photo stage when nodeArtifacts contains a photo', async () => {
    listArtifactsForSessionMock.mockResolvedValueOnce([
      { id: 'a1', nodeId: 'n1', kind: 'photo', extractionStatus: 'done' },
      { id: 'a2', nodeId: 'n1', kind: 'photo', extractionStatus: 'done' },
      { id: 'a3', nodeId: 'n1', kind: 'photo', extractionStatus: 'done' },
    ])

    advanceSessionMock.mockImplementation(async (opts) => {
      opts.onProgress({ type: 'stage', idx: -1, label: 'Recording observation' })
      opts.onProgress({ type: 'stage', idx: -1, label: 'Parsing photo · 3 frames' })
      const wrapperDeps = buildUpdateTreeWithRetrievalMock.mock.calls[0][0] as {
        onProgress: (e: AdvanceStreamEvent) => void
      }
      wrapperDeps.onProgress({ type: 'stage', idx: -1, label: 'Updating retrieval ladder' })
      wrapperDeps.onProgress({ type: 'stage', idx: -1, label: 'Re-scoring confidence' })
      opts.onProgress({ type: 'stage', idx: -1, label: 'Promoting next step' })
      return { ok: true, tree: {} }
    })

    const req = new Request('http://localhost/api/sessions/s1/advance/stream', {
      method: 'POST',
      body: JSON.stringify({ observation: 'plug 4 burnt' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })

    const events = await readAllEvents(res)
    const init = events[0] as Extract<AdvanceStreamEvent, { type: 'init' }>
    expect(init.stages).toHaveLength(5)
    expect(init.stages[1].label).toBe('Parsing photo · 3 frames')
  })

  it('emits error event when advanceSession returns ok:false', async () => {
    advanceSessionMock.mockResolvedValue({ ok: false, status: 400, error: 'bad input' })

    const req = new Request('http://localhost/api/sessions/s1/advance/stream', {
      method: 'POST',
      body: JSON.stringify({ observation: '' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })

    const events = await readAllEvents(res)
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })

  it('returns 401 JSON when unauthenticated', async () => {
    const supabaseMod = await import('@/lib/supabase-server')
    ;(supabaseMod.getServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })

    const req = new Request('http://localhost/api/sessions/s1/advance/stream', {
      method: 'POST',
      body: JSON.stringify({ observation: 'x' }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run tests, expect ALL fail (route doesn't exist)**

Run: `pnpm test tests/unit/advance-stream-route.test.ts`
Expected: All 4 fail with "module not found".

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/advance-stream-route.test.ts
git commit -m "test(advance-stream): failing tests for streaming route"
```

### Task D2: Implement the streaming route

**Files:** Create `app/api/sessions/[id]/advance/stream/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { db } from '@/lib/db/client'
import { advanceSession } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { updateTree } from '@/lib/ai/tree-engine'
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import { buildUpdateTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'
import { WebSearchAdapter } from '@/lib/retrieval/adapters/web-search'
import { retrieveCorpus } from '@/lib/corpus/retrieval'
import { listArtifactsForSession } from '@/lib/db/queries'
import { getSessionById } from '@/lib/db/queries'
import {
  encodeEvent,
  type AdvanceStreamEvent,
  type AdvanceStreamStage,
} from '@/lib/advance-stream-events'

export const runtime = 'nodejs'

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
  new WebSearchAdapter(),
]

const PHOTO_KINDS = new Set(['photo', 'scan_screen', 'wiring_diagram'])

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => null)

  // Predict the stage list BEFORE advanceSession runs, so the client gets a
  // truthful `init` event up front and every subsequent stage event streams
  // live as the server hits that step. The cost is one extra DB read for the
  // current node's artifacts (cheap; the same query advanceSession runs).
  let plannedStages: AdvanceStreamStage[]
  let photoCount = 0
  try {
    const session = await getSessionById(db, id)
    const currentNodeId = session?.treeState.currentNodeId
    const allArtifacts = currentNodeId
      ? await listArtifactsForSession(db, id)
      : []
    photoCount = allArtifacts.filter(
      (a) =>
        a.nodeId === currentNodeId &&
        a.extractionStatus === 'done' &&
        PHOTO_KINDS.has(a.kind),
    ).length

    plannedStages = [
      { label: 'Recording observation' },
      ...(photoCount > 0
        ? [{ label: `Parsing photo · ${photoCount} frames` }]
        : []),
      { label: 'Updating retrieval ladder' },
      { label: 'Re-scoring confidence' },
      { label: 'Promoting next step' },
    ]
  } catch {
    // If we can't predict (session missing / DB hiccup), fall back to the
    // 4-stage list. advanceSession will report the real error inside the
    // stream as an `error` event.
    plannedStages = [
      { label: 'Recording observation' },
      { label: 'Updating retrieval ladder' },
      { label: 'Re-scoring confidence' },
      { label: 'Promoting next step' },
    ]
  }

  const labelToIdx = new Map(plannedStages.map((s, i) => [s.label, i]))

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: AdvanceStreamEvent) =>
        controller.enqueue(encoder.encode(encodeEvent(event)))

      // Send init FIRST so the client knows the canonical stage set.
      emit({ type: 'init', stages: plannedStages })

      // Translate the wrapper/advance's idx-agnostic stage events into
      // canonical-idx stage events using the prebuilt label→idx map.
      const onProgress = (event: AdvanceStreamEvent) => {
        if (event.type !== 'stage') {
          emit(event)
          return
        }
        const idx = labelToIdx.get(event.label)
        if (idx !== undefined) {
          emit({ type: 'stage', idx, label: event.label })
        }
        // If a label arrives that wasn't in plannedStages (e.g., photo count
        // changed between the prediction read and the actual run), drop it
        // silently — better than emitting a misleading idx.
      }

      const updateTreeWithRetrieval = buildUpdateTreeWithRetrieval({
        db,
        adapters: ADAPTERS,
        updateTree,
        runRetrieval,
        validateRetrievalResults,
        retrieveCorpus,
        sessionId: id,
        onProgress,
      })

      try {
        const result = await advanceSession({
          db,
          userId: user.id,
          sessionId: id,
          body,
          updateTree: updateTreeWithRetrieval,
          onProgress,
        })

        if (!result.ok) {
          emit({
            type: 'error',
            status: result.status,
            message: result.error,
          })
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

This emits truly live: `init` lands within ~30ms of the request, then each `stage` event lands the moment the server hits that step (with sub-second resolution between stages). The form's hook updates `freezeStage` per event, so each label sits visibly while its real work runs.

Cost: one extra DB read (`getSessionById` + `listArtifactsForSession`) before `advanceSession` runs. Both queries are also called inside `advanceSession`; in this PR we accept the duplication for simplicity. If profiling shows it's hot, a future PR can expose a "compile artifacts" helper used by both call sites.

- [ ] **Step 2: Run tests**

Run: `pnpm test tests/unit/advance-stream-route.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/sessions/[id]/advance/stream/route.ts
git commit -m "feat(advance-stream): NDJSON streaming route for LogButton narration"
```

---

## Phase E — Client hook

### Task E1: Failing tests for `useAdvanceStream`

**Files:** Create `tests/unit/use-advance-stream.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useAdvanceStream } from '@/lib/use-advance-stream'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'
import { encodeEvent } from '@/lib/advance-stream-events'

function streamFromEvents(events: AdvanceStreamEvent[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(encodeEvent(e)))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAdvanceStream', () => {
  it('happy path: parses init -> stages -> done', async () => {
    const tree = { nodes: [], currentNodeId: 'n2', message: 'ok' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamFromEvents([
          {
            type: 'init',
            stages: [
              { label: 'Recording observation' },
              { label: 'Updating retrieval ladder' },
              { label: 'Re-scoring confidence' },
              { label: 'Promoting next step' },
            ],
          },
          { type: 'stage', idx: 0, label: 'Recording observation' },
          { type: 'stage', idx: 1, label: 'Updating retrieval ladder' },
          { type: 'stage', idx: 2, label: 'Re-scoring confidence' },
          { type: 'stage', idx: 3, label: 'Promoting next step' },
          { type: 'done', tree: tree as never },
        ]),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.stages).toHaveLength(4)
    expect(result.current.state.stageIdx).toBe(3)
    expect(result.current.state.isDone).toBe(true)
    expect(result.current.state.error).toBeNull()
    expect(result.current.state.tree).toEqual(tree)
  })

  it('error event sets error and isDone=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamFromEvents([
          { type: 'init', stages: [{ label: 'Recording observation' }] },
          { type: 'stage', idx: 0, label: 'Recording observation' },
          { type: 'error', status: 500, message: 'tree update failed' },
        ]),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.error).toBe('tree update failed')
    expect(result.current.state.isDone).toBe(false)
  })

  it('HTTP error before stream sets error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.error).toBe('unauthorized')
    expect(result.current.state.isLoading).toBe(false)
  })

  it('network drop (TypeError on fetch) sets error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.error).toMatch(/dropped|connection|too long/i)
  })

  it('reset clears state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamFromEvents([
          { type: 'init', stages: [{ label: 'Recording observation' }] },
          { type: 'stage', idx: 0, label: 'Recording observation' },
          { type: 'done', tree: {} as never },
        ]),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })
    expect(result.current.state.isDone).toBe(true)

    act(() => result.current.reset())

    expect(result.current.state.stages).toBeNull()
    expect(result.current.state.stageIdx).toBeNull()
    expect(result.current.state.isDone).toBe(false)
    expect(result.current.state.tree).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests, expect all fail**

Run: `pnpm test tests/unit/use-advance-stream.test.ts`
Expected: All fail with module-not-found.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/use-advance-stream.test.ts
git commit -m "test(use-advance-stream): failing tests for streaming hook"
```

### Task E2: Implement `useAdvanceStream`

**Files:** Create `lib/use-advance-stream.ts`

- [ ] **Step 1: Write the hook**

```ts
'use client'

import { useCallback, useState } from 'react'
import type { TreeState } from '@/lib/ai/tree-engine'
import {
  parseEvent,
  type AdvanceStreamEvent,
  type AdvanceStreamStage,
} from '@/lib/advance-stream-events'

export type AdvanceStreamState = {
  stages: AdvanceStreamStage[] | null
  stageIdx: number | null
  isLoading: boolean
  isDone: boolean
  error: string | null
  tree: TreeState | null
}

const INITIAL_STATE: AdvanceStreamState = {
  stages: null,
  stageIdx: null,
  isLoading: false,
  isDone: false,
  error: null,
  tree: null,
}

function describeFetchError(err: unknown): string {
  if (err instanceof TypeError) {
    return 'AI took too long or your connection dropped — tap again to retry.'
  }
  return err instanceof Error ? err.message : 'Network error'
}

async function* readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<AdvanceStreamEvent> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line.length === 0) continue
      yield parseEvent(line)
    }
  }

  buffer += decoder.decode()
  const last = buffer.trim()
  if (last.length > 0) yield parseEvent(last)
}

export function useAdvanceStream() {
  const [state, setState] = useState<AdvanceStreamState>(INITIAL_STATE)

  const submit = useCallback(
    async (input: { sessionId: string; observation: string }) => {
      setState({ ...INITIAL_STATE, isLoading: true })
      try {
        const res = await fetch(
          `/api/sessions/${input.sessionId}/advance/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ observation: input.observation }),
          },
        )

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setState({
            ...INITIAL_STATE,
            error: body.error ?? `Failed (${res.status})`,
          })
          return
        }

        if (!res.body) {
          setState({
            ...INITIAL_STATE,
            error: 'empty response',
          })
          return
        }

        const reader = res.body.getReader()
        for await (const event of readEvents(reader)) {
          if (event.type === 'init') {
            setState((s) => ({ ...s, stages: event.stages }))
          } else if (event.type === 'stage') {
            setState((s) => ({ ...s, stageIdx: event.idx }))
          } else if (event.type === 'done') {
            setState((s) => ({
              ...s,
              isLoading: false,
              isDone: true,
              tree: event.tree,
            }))
          } else if (event.type === 'error') {
            setState((s) => ({
              ...s,
              isLoading: false,
              error: event.message,
            }))
          }
        }
      } catch (err) {
        setState({
          ...INITIAL_STATE,
          error: describeFetchError(err),
        })
      }
    },
    [],
  )

  const reset = useCallback(() => setState(INITIAL_STATE), [])

  return { state, submit, reset }
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm test tests/unit/use-advance-stream.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/use-advance-stream.ts
git commit -m "feat(use-advance-stream): NDJSON-stream consumer hook for LogButton"
```

---

## Phase F — Wire form to the hook

### Task F1: Update form tests to stub the hook

**Files:** Modify `tests/unit/active-step-form.test.tsx`

- [ ] **Step 1: Read the existing test file to confirm current shape**

```bash
cat tests/unit/active-step-form.test.tsx
```

- [ ] **Step 2: Replace it with the hook-stubbed version**

Write to `tests/unit/active-step-form.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

const submitMock = vi.fn()
const resetMock = vi.fn()
let mockState: {
  stages: Array<{ label: string }> | null
  stageIdx: number | null
  isLoading: boolean
  isDone: boolean
  error: string | null
  tree: unknown
}
vi.mock('@/lib/use-advance-stream', () => ({
  useAdvanceStream: () => ({
    state: mockState,
    submit: submitMock,
    reset: resetMock,
  }),
}))

import { ActiveStepForm } from '@/components/screens/active-step-form'

describe('ActiveStepForm — log-button integration', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    submitMock.mockReset()
    resetMock.mockReset()
    mockState = {
      stages: null,
      stageIdx: null,
      isLoading: false,
      isDone: false,
      error: null,
      tree: null,
    }
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
      shouldAdvanceTime: true,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the LogButton in idle state by default', () => {
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    const btn = screen.getByRole('button', { name: /log observation/i })
    expect(btn).toHaveAttribute('aria-busy', 'false')
  })

  it('disables the LogButton when textarea is empty', () => {
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(
      screen.getByRole('button', { name: /log observation/i }),
    ).toBeDisabled()
  })

  it('calls submit on click and shows loading state when hook reports isLoading', () => {
    const { rerender } = render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    fireEvent.change(
      screen.getByPlaceholderText(/log what you observed/i),
      { target: { value: 'left front squeal' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /log observation/i }))

    expect(submitMock).toHaveBeenCalledWith({
      sessionId: 's1',
      observation: 'left front squeal',
    })

    // Simulate the hook reporting isLoading=true
    mockState.isLoading = true
    rerender(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(
      screen.getByRole('button', { name: /log observation|recording/i }),
    ).toHaveAttribute('aria-busy', 'true')
  })

  it('holds done state for 700ms then triggers refresh', async () => {
    const { rerender } = render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    fireEvent.change(
      screen.getByPlaceholderText(/log what you observed/i),
      { target: { value: 'left front squeal' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /log observation/i }))

    // Hook flips to done
    mockState = {
      ...mockState,
      isLoading: false,
      isDone: true,
      tree: { nodes: [], currentNodeId: 'n2', message: 'ok' },
    }
    rerender(<ActiveStepForm sessionId="s1" nodeId="n1" />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /logged.*advancing/i }).className,
      ).toMatch(/is-done/)
    })
    expect(refreshMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(750)
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('shows error text when hook reports an error', () => {
    mockState.error = 'tree update failed'
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(screen.getByRole('alert')).toHaveTextContent('tree update failed')
  })
})
```

- [ ] **Step 3: Run the test file, expect FAILS**

Run: `pnpm test tests/unit/active-step-form.test.tsx`
Expected: tests fail because the form does NOT yet use `useAdvanceStream` and instead uses inline `fetch`.

- [ ] **Step 4: Commit failing tests**

```bash
git add tests/unit/active-step-form.test.tsx
git commit -m "test(active-step-form): expect form to consume useAdvanceStream"
```

### Task F2: Wire form to `useAdvanceStream`

**Files:** Modify `components/screens/active-step-form.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat components/screens/active-step-form.tsx
```

- [ ] **Step 2: Rewrite it**

Write to `components/screens/active-step-form.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DotsThree } from '@phosphor-icons/react/dist/ssr'
import { PhotoCapture } from '@/components/session/photo-capture'
import { AudioCapture } from '@/components/session/audio-capture'
import { VideoCapture } from '@/components/session/video-capture'
import { AmbientConditionsCapture } from '@/components/session/ambient-conditions-capture'
import { LogButton, DEFAULT_STAGES } from '@/components/vt/log-button'
import { useAdvanceStream } from '@/lib/use-advance-stream'

type RequestedArtifact = {
  kind:
    | 'photo'
    | 'scan_screen'
    | 'wiring_diagram'
    | 'audio'
    | 'video'
    | 'ambient_conditions'
  prompt: string
}

type Props = {
  sessionId: string
  nodeId: string
  requestedArtifact?: RequestedArtifact
}

const DONE_HOLD_MS = 700

export function ActiveStepForm({ sessionId, nodeId, requestedArtifact }: Props) {
  const [observation, setObservation] = useState('')
  const [phase, setPhase] = useState<'idle' | 'done'>('idle')
  const router = useRouter()
  const { state, submit } = useAdvanceStream()

  // When the hook reports done, hold the done face for 700ms then refresh.
  useEffect(() => {
    if (!state.isDone) return
    setPhase('done')
    setObservation('')
    const t = setTimeout(() => {
      setPhase('idle')
      router.refresh()
    }, DONE_HOLD_MS)
    return () => clearTimeout(t)
  }, [state.isDone, router])

  const buttonState: 'idle' | 'loading' | 'done' = state.isLoading
    ? 'loading'
    : phase

  const stages = state.stages ?? DEFAULT_STAGES

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!observation.trim()) return
    submit({ sessionId, observation: observation.trim() })
  }

  return (
    <form onSubmit={onSubmit}>
      {requestedArtifact && (
        <div style={{ marginBottom: 12 }}>
          {(requestedArtifact.kind === 'photo' ||
            requestedArtifact.kind === 'scan_screen' ||
            requestedArtifact.kind === 'wiring_diagram') && (
            <PhotoCapture
              sessionId={sessionId}
              nodeId={nodeId}
              kind={requestedArtifact.kind}
              label={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'audio' && (
            <AudioCapture
              sessionId={sessionId}
              nodeId={nodeId}
              prompt={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'video' && (
            <VideoCapture
              sessionId={sessionId}
              nodeId={nodeId}
              label={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'ambient_conditions' && (
            <AmbientConditionsCapture
              sessionId={sessionId}
              prompt={requestedArtifact.prompt}
              onCaptured={() => router.refresh()}
            />
          )}
        </div>
      )}
      <label htmlFor={`obs-${sessionId}`} className="vt-sr-only">
        Observation
      </label>
      <textarea
        id={`obs-${sessionId}`}
        value={observation}
        onChange={(e) => setObservation(e.target.value)}
        placeholder="Log what you observed."
        rows={2}
        disabled={state.isLoading}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--vt-bone-100)',
          border: '0.5px solid var(--vt-rule-strong)',
          borderRadius: 'var(--vt-radius-2)',
          padding: '10px 12px',
          fontFamily: 'var(--vt-font-serif)',
          fontSize: 15,
          color: 'var(--vt-fg)',
          resize: 'none',
          outline: 0,
          marginBottom: 8,
          letterSpacing: '-0.005em',
        }}
      />
      {state.error && (
        <div
          role="alert"
          style={{
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 12,
            color: 'var(--vt-risk-destructive)',
            marginBottom: 8,
          }}
        >
          {state.error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <LogButton
            type="submit"
            state={buttonState}
            freezeStage={state.stageIdx}
            stages={stages}
            disabled={state.isLoading || !observation.trim()}
            label="Log observation"
            variant="graphite"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="More options"
          disabled={state.isLoading}
        >
          <DotsThree size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Run form tests, expect PASS**

Run: `pnpm test tests/unit/active-step-form.test.tsx`
Expected: 5/5 tests pass.

- [ ] **Step 4: Run LogButton tests to confirm no regression (button is unchanged)**

Run: `pnpm test tests/unit/log-button.test.tsx`
Expected: 10/10 pass.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: full suite green. Per Brandon's standing rule (Vitest fork-pool flake), if 50+ "PGlite is closed" errors appear on first run after a fresh shell, rerun once.

- [ ] **Step 6: Commit**

```bash
git add components/screens/active-step-form.tsx
git commit -m "feat(active-step-form): consume useAdvanceStream, drive freezeStage"
```

---

## Phase G — Verify & ship

### Task G1: Typecheck + build

**Files:** None (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: clean. Note: the new route appears in the build output's route list as `/api/sessions/[id]/advance/stream`.

### Task G2: Update PR 20 to cover both phases

**Files:** None (PR description edit only)

- [ ] **Step 1: Push commits**

```bash
git push origin Loading-animation
```

Expected: Vercel preview redeploys.

- [ ] **Step 2: Edit PR title and body**

```bash
gh pr edit 20 --title "feat(ui): three-state narrating Log Observation button + real-event narration" --body "$(cat <<'EOF'
## Summary

Two stacked phases on the same branch — both required for the feature to be honest with the technician.

**Phase A (PR 20 commits):** ports the Claude design's three-state Log Observation button (`idle` / `loading` / `done`). Adds `<LogButton>` primitive at `components/vt/log-button.tsx` and `--vt-amber-200/300/400/500` color tokens.

**Phase B (PR 21 commits):** wires the button's stage labels to real backend events from a new streaming `/api/sessions/[id]/advance/stream` endpoint. The `Parsing photo · N frames` stage fires only when a photo is on the step; otherwise the cycle is 4 stages. The non-streaming `/advance` endpoint and the decline-or-defer flow are unchanged.

The LogButton component is identical across both phases — Phase B drives its existing `freezeStage` prop (already shipped in Phase A for the design canvas) from outside, so the visual you validated in Phase A is unchanged.

## Files

- **New:** `components/vt/log-button.tsx`, `components/vt/log-button.css`, `lib/advance-stream-events.ts`, `lib/use-advance-stream.ts`, `app/api/sessions/[id]/advance/stream/route.ts`
- **Modified:** `app/globals.css`, `app/layout.tsx`, `lib/sessions.ts`, `lib/retrieval/wire-into-tree.ts`, `components/screens/active-step-form.tsx`
- **Tests:** `tests/unit/log-button.test.tsx`, `tests/unit/active-step-form.test.tsx`, `tests/unit/advance-progress-callbacks.test.ts`, `tests/unit/advance-stream-route.test.ts`, `tests/unit/use-advance-stream.test.ts`
- **Docs:** spec + plan for both phases under `docs/superpowers/`

## Test plan

- [x] `pnpm test` — full suite green
- [x] `pnpm exec tsc --noEmit` — clean
- [x] `pnpm build` — clean
- [ ] **Manual on Vercel preview (Brandon):** walk `intake → active session → log observation` on a real iPhone in shop-light context. Confirm:
  - Stages now sit at their real work instead of cycling on a timer
  - `Parsing photo` stage only fires when a photo is on the step (counter shows `01/04` instead of `01/05`)
  - Done flash + advance still works as in PR 20
  - If you airplane-mode mid-tap, button falls back gracefully and the red error text appears

## DO NOT MERGE

Brandon validates on the Vercel preview and squash-merges himself.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Confirm PR is updated**

```bash
gh pr view 20 --json title,body | head -30
```

Expected: title and body reflect both phases.

- [ ] **Step 4: Hand off to Brandon**

Tell him: PR #20 now covers both phases on the same branch; preview URL has both pieces; he validates and squash-merges. Do NOT merge.

---

## Done criteria

- [ ] All new tests in this plan pass + all PR 20 tests still pass.
- [ ] `pnpm test` green, `pnpm exec tsc --noEmit` clean, `pnpm build` clean.
- [ ] Loading-animation branch pushed; Vercel preview deployed.
- [ ] PR #20's title/body updated to reflect both phases.
- [ ] No commits or merges to `main`.
