# Decline-screen + conversation-persistence fixes — implementation plan

> **For agentic workers:** Implement task-by-task in order. Each task has a
> failing-test-first checkbox before the implementation checkbox; do not
> skip the test. Steps use `- [ ]` for tracking.

**Goal:** Eliminate the redirect loop on the Decline screen, frame the hero
card as the primary path forward, delete the "Decline this job" option
across every layer, and start persisting the AI's per-turn message text so
the curator timeline is reconstructable.

**Architecture:** No new infra. One new endpoint
(`POST /api/sessions/[id]/release-gate`) that wipes
`treeState.gateDecision`. All four Decline-screen exits (Yes / No / Snap /
Gather) call it before navigating, so the tech reliably lands on the
active-session view. Decline-option removal is a layer-by-layer narrowing
with the URL kept for back-compat.

**Tech stack:** Next.js 16 App Router, Drizzle, Supabase, Anthropic SDK
0.92 (Claude Sonnet 4.6), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-09-decline-screen-and-conversation-fixes.md`
**Branch:** `claude/location-ambient-temp-jJL3M` (off `staging/camera-vision`).
Brandon promotes to `staging/camera-vision`; agent does not push to staging
or main.

---

## File map

**Modify:**
- `lib/ai/tree-engine.ts` — `WhatWouldClose.confirm` adds optional
  `yesLabel` / `noLabel`; `parseTreeJson` validates them.
- `lib/ai/prompts.ts` — `TREE_ENGINE_SYSTEM` instructs the model to emit
  `yesLabel` / `noLabel` for confirms.
- `lib/gating/gap-handler.ts` — `GateOption` type narrows; default
  options array drops `'decline'`.
- `lib/gating/decline-language.ts` — `DeclineLanguageInput.reason`
  narrows to `'defer'`; user message stops branching.
- `lib/sessions.ts` — `declineOrDeferSchema.reason` becomes
  `z.literal('defer')`; `DeclineOrDeferSessionResult` narrows;
  `advanceSession` writes `aiResponse.messageText`. Adds
  `releaseGateForUser` handler.
- `lib/db/schema.ts` — `session_events.aiResponse` jsonb shape gains
  optional `messageText: string`.
- `components/screens/decline-or-defer.tsx` — eyebrow above hero, italic
  descriptor, button label echoing, busy-text `Working…`, spokes header
  rename.
- `components/screens/decline-or-defer-live.tsx` — drop `'decline'`
  spoke; all four exits POST `/release-gate` before navigating; pass
  `yesLabel` / `noLabel` through.
- `app/curator/cases/[sessionId]/page.tsx` — render
  `aiResponse.messageText` per event when present.

**New:**
- `app/api/sessions/[id]/release-gate/route.ts` — thin shim → handler.

**Test (modify or extend):**
- `tests/unit/tree-engine.test.ts` — accept optional `yesLabel`/`noLabel`,
  reject non-string values.
- `tests/unit/gap-handler.test.ts` — default-options assertion updated.
- `tests/unit/decline-or-defer-handler.test.ts` — decline path now 400;
  defer path unchanged.
- `tests/unit/decline-or-defer-screen.test.tsx` — drop decline-spoke
  tests; add yesLabel/noLabel tests; add Working… tests; add
  release-gate-on-each-exit tests.
- `tests/unit/advance-session-handler.test.ts` — assert
  `messageText` is persisted on the observation event.
- `tests/unit/release-gate-handler.test.ts` — **new.**

---

## Task 1 — Extend `WhatWouldClose.confirm` with optional labels

**Files:** `lib/ai/tree-engine.ts`, `tests/unit/tree-engine.test.ts`

- [ ] **Step 1.1 — Failing test first.** Append to
  `tests/unit/tree-engine.test.ts`:

  ```ts
  describe('parseTreeJson — confirm with optional labels', () => {
    it('accepts yesLabel and noLabel as optional strings on confirm', () => {
      const result = parseTreeJson(
        JSON.stringify({
          nodes: [{ id: 'n1', label: 'Step', status: 'active' }],
          currentNodeId: 'n1',
          message: 'm',
          proposedAction: {
            description: 'verify 12V at coil',
            confidence: 0.85,
            confidenceGap: 'no electrical confirmation yet',
            whatWouldClose: {
              kind: 'confirm',
              prompt: 'Do you have 12V at the clutch coil?',
              yesLabel: 'Yes — I have 12V',
              noLabel: 'No — no voltage',
            },
          },
        }),
      )
      const wwc = result.proposedAction!.whatWouldClose
      expect(wwc).toMatchObject({
        kind: 'confirm',
        yesLabel: 'Yes — I have 12V',
        noLabel: 'No — no voltage',
      })
    })

    it('accepts confirm without labels (back-compat)', () => {
      const result = parseTreeJson(
        JSON.stringify({
          nodes: [{ id: 'n1', label: 'Step', status: 'active' }],
          currentNodeId: 'n1',
          message: 'm',
          proposedAction: {
            description: 'check coolant',
            confidence: 0.85,
            confidenceGap: 'visual not yet attested',
            whatWouldClose: { kind: 'confirm', prompt: 'Coolant milky?' },
          },
        }),
      )
      expect(result.proposedAction!.whatWouldClose).toMatchObject({
        kind: 'confirm',
        prompt: 'Coolant milky?',
      })
    })

    it('rejects non-string yesLabel', () => {
      expect(() =>
        parseTreeJson(
          JSON.stringify({
            nodes: [{ id: 'n1', label: 'x', status: 'active' }],
            currentNodeId: 'n1',
            message: 'm',
            proposedAction: {
              description: 'x',
              confidence: 0.5,
              whatWouldClose: { kind: 'confirm', prompt: 'q', yesLabel: 42 },
            },
          }),
        ),
      ).toThrow(/yesLabel/)
    })
  })
  ```

  Run `pnpm exec vitest run tests/unit/tree-engine.test.ts` → expect failure.

- [ ] **Step 1.2 — Implement.**
  - Widen `WhatWouldClose` confirm variant in `lib/ai/tree-engine.ts`:
    ```ts
    | { kind: 'confirm'; prompt: string; yesLabel?: string; noLabel?: string }
    ```
  - In `parseTreeJson`, after the existing `confirm` branch validation,
    if `obj.kind === 'confirm'`:
    ```ts
    if (obj.yesLabel !== undefined && typeof obj.yesLabel !== 'string') {
      throw new Error('invalid whatWouldClose: yesLabel must be a string')
    }
    if (obj.noLabel !== undefined && typeof obj.noLabel !== 'string') {
      throw new Error('invalid whatWouldClose: noLabel must be a string')
    }
    ```
  - Re-run the test → green.

## Task 2 — Update `TREE_ENGINE_SYSTEM` to emit labels

**Files:** `lib/ai/prompts.ts`

- [ ] **Step 2.1 — No new test (system prompts aren't unit-tested in this
  repo; behavior is exercised by the Task 1 parser tests + downstream UI
  tests). Implement directly:**
  - In the `RISK GATING` / `CONFIRM vs PHOTO — DECISION RULE` block,
    update the `WhatWouldClose` type definition shown to the model and
    add an instruction:

    ```
    type WhatWouldClose =
      | { kind: "confirm"; prompt: string; yesLabel?: string; noLabel?: string }
      | { kind: "photo"; prompt: string; extractFor: string }
    ```

    Append: *"For confirm shapes, populate `yesLabel` and `noLabel` —
    3 to 5 words each, echoing the answer state in plain English (e.g.
    `'Yes — I have 12V'` / `'No — no voltage'`,
    `'Yes — milky'` / `'No — clean'`,
    `'Yes — latched'` / `'No — not seated'`). The UI renders them on the
    Yes/No buttons so the tap reads as a real answer rather than a
    generic confirm. Both fields are OPTIONAL (the UI falls back to plain
    `Yes`/`No`); prefer to provide them whenever the question has a
    natural short echo."*

- [ ] **Step 2.2 — Verify** by running
  `pnpm exec vitest run tests/unit/tree-engine.test.ts` (parser tests still
  green) and `pnpm exec tsc --noEmit`.

## Task 3 — Add `messageText` to `aiResponse` shape and persist on advance

**Files:** `lib/db/schema.ts`, `lib/sessions.ts`,
`tests/unit/advance-session-handler.test.ts`

- [ ] **Step 3.1 — Failing test.** Add to
  `tests/unit/advance-session-handler.test.ts`:

  ```ts
  it('persists the AI message text on the observation event', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const updateTree = vi.fn().mockResolvedValue({
      ...updatedTree,
      message: 'next: scan ECM. inspect-cac is still queued.',
    })
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'pulled P0299' },
      updateTree,
    })
    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    expect(events[0].aiResponse?.messageText).toBe(
      'next: scan ECM. inspect-cac is still queued.',
    )
  })
  ```

  Run → expect failure.

- [ ] **Step 3.2 — Implement.**
  - In `lib/db/schema.ts`, extend the inline jsonb type for
    `sessionEvents.aiResponse` to include `messageText?: string`.
  - In `lib/sessions.ts → advanceSession`, where it currently calls
    `appendSessionEvent` with `aiResponse: { nextNodeId: nextTree.currentNodeId }`,
    expand to include `messageText: nextTree.message`.
  - Re-run → green.

## Task 4 — Render `messageText` on the curator case page

**Files:** `app/curator/cases/[sessionId]/page.tsx`

- [ ] **Step 4.1 — No new test.** This page has a JSON-dump fallback for
  treeState and isn't unit-tested today; visual change is small enough
  that a TDD test would be ceremony. Implement directly:
  - Where the event renderer currently shows
    `→ node ${ev.aiResponse.nextNodeId}` (or `(tree update)`), if
    `ev.aiResponse?.messageText` is present, render it on the next line
    in the existing event block, styled as italic body text.

- [ ] **Step 4.2 — Verify.** `pnpm build` clean.

## Task 5 — Remove "Decline this job" — type, options, schema

**Files:** `lib/gating/gap-handler.ts`, `lib/gating/decline-language.ts`,
`lib/sessions.ts`, `tests/unit/gap-handler.test.ts`,
`tests/unit/decline-or-defer-handler.test.ts`

- [ ] **Step 5.1 — Failing tests first.**
  - Update
    `tests/unit/gap-handler.test.ts:39-50` — change the assertion from
    `['gather_more_low_risk', 'decline', 'defer']` to
    `['gather_more_low_risk', 'defer']`. Test should fail until the array
    is updated.
  - Update `tests/unit/decline-or-defer-handler.test.ts`:
    - The "declines an open session" test → flip to expect 400 with the
      reason='decline' body, confirming the schema now rejects it.
    - The "appends a close event with the decline payload" test → swap
      the body to `reason: 'defer'` and assert the event records
      `{ reason: 'defer', ... }`.
    - The 400 zod-validation test stays.

  Run → expect failures.

- [ ] **Step 5.2 — Implement.**
  - `lib/gating/gap-handler.ts`:
    `GateOption = 'gather_more_low_risk' | 'defer'`; default options
    array drops `'decline'`.
  - `lib/gating/decline-language.ts`: `DeclineLanguageInput.reason`
    becomes `'defer'`; the inline ternary in the user message simplifies
    to the defer-only string.
  - `lib/sessions.ts`:
    `declineOrDeferSchema.reason = z.literal('defer')`;
    `DeclineOrDeferSessionResult.success.status` narrows to
    `'deferred'`; remove the `parsed.data.reason === 'decline' ? ... : ...`
    expression in favor of a constant `'deferred'`.
  - Re-run all three test files → green.

## Task 6 — `releaseGateForUser` handler + endpoint

**Files:** `lib/sessions.ts`, `app/api/sessions/[id]/release-gate/route.ts`,
`tests/unit/release-gate-handler.test.ts`

- [ ] **Step 6.1 — Failing test.** New file
  `tests/unit/release-gate-handler.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
  import { eq } from 'drizzle-orm'
  import { createTestDb, type TestDb } from '../helpers/db'
  import {
    ensureProfileAndShop,
    createProfile,
    createSession,
    getSessionById,
  } from '@/lib/db/queries'
  import { releaseGateForUser } from '@/lib/sessions'
  import { sessionEvents, sessions } from '@/lib/db/schema'

  const blockedTree = {
    nodes: [{ id: 'n1', label: 'x', status: 'active' as const }],
    currentNodeId: 'n1',
    message: 'm',
    gateDecision: {
      allow: false,
      riskClass: 'high' as const,
      threshold: 0.9,
      confidence: 0.7,
      rationale: 'r',
      gap: 'g',
      options: ['gather_more_low_risk', 'defer'] as const,
    },
  }

  describe('releaseGateForUser', () => {
    let db: TestDb
    let close: () => Promise<void>
    beforeEach(async () => { ;({ db, close } = await createTestDb()) })
    afterEach(async () => { await close() })

    async function seed() {
      const userId = crypto.randomUUID()
      const profile = await ensureProfileAndShop(db, userId, 'a@b.com')
      const session = await createSession(db, {
        shopId: profile.shopId!,
        techId: profile.id,
        intake: {
          vehicleYear: 2018,
          vehicleMake: 'F',
          vehicleModel: 'M',
          customerComplaint: 'x'.repeat(10),
        },
        treeState: blockedTree,
      })
      return { userId, session }
    }

    it('clears gateDecision and returns ok', async () => {
      const { userId, session } = await seed()
      const result = await releaseGateForUser({
        db, userId, sessionId: session.id,
      })
      expect(result.ok).toBe(true)
      const fetched = await getSessionById(db, session.id)
      expect(fetched?.treeState.gateDecision).toBeUndefined()
    })

    it('appends a tree_update event to record the release', async () => {
      const { userId, session } = await seed()
      await releaseGateForUser({ db, userId, sessionId: session.id })
      const events = await db.select().from(sessionEvents).where(
        eq(sessionEvents.sessionId, session.id),
      )
      expect(events).toHaveLength(1)
      expect(events[0].eventType).toBe('tree_update')
    })

    it('returns 404 when session belongs to another tech', async () => {
      const { session } = await seed()
      const intruderId = crypto.randomUUID()
      await createProfile(db, { userId: intruderId })
      const result = await releaseGateForUser({
        db, userId: intruderId, sessionId: session.id,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
    })

    it('returns 400 when session is not open', async () => {
      const { userId, session } = await seed()
      await db.update(sessions).set({ status: 'closed' }).where(
        eq(sessions.id, session.id),
      )
      const result = await releaseGateForUser({
        db, userId, sessionId: session.id,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    })
  })
  ```

  Run → expect failure (handler doesn't exist yet).

- [ ] **Step 6.2 — Implement handler.** Add to `lib/sessions.ts`:

  ```ts
  export type ReleaseGateResult =
    | { ok: true }
    | { ok: false; status: 400 | 404; error: string }

  export async function releaseGateForUser(opts: {
    db: AppDb
    userId: string
    sessionId: string
  }): Promise<ReleaseGateResult> {
    const profile = await getProfileByUserId(opts.db, opts.userId)
    if (!profile) return { ok: false, status: 400, error: 'no profile' }

    const session = await getSessionById(opts.db, opts.sessionId)
    if (!session || session.techId !== profile.id) {
      return { ok: false, status: 404, error: 'not found' }
    }
    if (session.status !== 'open') {
      return { ok: false, status: 400, error: 'session is not open' }
    }

    const { gateDecision: _drop, ...nextTree } = session.treeState
    await updateSessionTreeState(opts.db, opts.sessionId, nextTree)
    await appendSessionEvent(opts.db, {
      sessionId: opts.sessionId,
      nodeId: session.treeState.currentNodeId,
      eventType: 'tree_update',
    })
    return { ok: true }
  }
  ```

- [ ] **Step 6.3 — Route shim.** Create
  `app/api/sessions/[id]/release-gate/route.ts` (~25 lines, mirror the
  `/abandon` route's shape):

  ```ts
  import { NextResponse } from 'next/server'
  import { db } from '@/lib/db/client'
  import { releaseGateForUser } from '@/lib/sessions'
  import { getServerSupabase } from '@/lib/supabase-server'

  export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const { id } = await params
    const supabase = await getServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const result = await releaseGateForUser({ db, userId: user.id, sessionId: id })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true })
  }
  ```

- [ ] **Step 6.4 — Verify.** Re-run release-gate test file → green.
  `pnpm exec tsc --noEmit` clean.

## Task 7 — Wire all four exits to release the gate

**Files:** `components/screens/decline-or-defer-live.tsx`,
`tests/unit/decline-or-defer-screen.test.tsx`

- [ ] **Step 7.1 — Failing tests.** In
  `tests/unit/decline-or-defer-screen.test.tsx`:
  - Update the existing "routes back to the session when 'Gather more
    low-risk data' is clicked" test:
    - Mock `fetch` to expect a POST to `/api/sessions/sess-abc/release-gate`
      and resolve `{ ok: true, json: async () => ({ ok: true }) }`.
    - Assert `pushSpy` was called with `/sessions/sess-abc` after the fetch.
  - Drop the "POSTs reason=decline" test entirely (option no longer
    exists).
  - Add a new test: when Yes is clicked on a confirm hero, fetch is
    called twice — first to `/advance`, then to `/release-gate` — then
    `pushSpy` fires.
  - Add: when Snap-it triggers a file change, fetch is called twice —
    `/capture`, then `/release-gate`.
  - Add: button text reads `Working…` while the fetch is in flight (use
    `act` and a never-resolving fetch promise to assert the mid-flight
    label).

  Run → expect failures.

- [ ] **Step 7.2 — Implement.** In `decline-or-defer-live.tsx`:
  - Drop `'decline'` from `OPTIONS_BY_REASON`.
  - Narrow `optionKeys` prop to
    `Array<'gather_more_low_risk' | 'defer'>`.
  - Extract a small helper `releaseGate()` that POSTs
    `/api/sessions/${props.sessionId}/release-gate` and ignores 4xx
    (best-effort: even if release fails, the user navigation should
    proceed; the next observation will re-gate if needed).
  - `handleConfirm`: after the `/advance` call succeeds, call
    `releaseGate()` before `router.push`.
  - `handleFile`: after `/capture` succeeds, call `releaseGate()` before
    `router.push`.
  - `handleSelect` for `'gather'`: call `releaseGate()` first, then
    `router.push`.
  - Defer spoke is unchanged.
  - In the `confirmAsk` prop wired through, pass
    `yesLabel: wwcObj.yesLabel`, `noLabel: wwcObj.noLabel` (these will
    become props on the presentational component in Task 8).

- [ ] **Step 7.3 — Verify.** Re-run screen test file → green.

## Task 8 — Presentational refresh on the Decline screen

**Files:** `components/screens/decline-or-defer.tsx`,
`tests/unit/decline-or-defer-screen.test.tsx`

- [ ] **Step 8.1 — Failing tests.**
  - Add a test: `confirmAsk={{ prompt, onYes, onNo, yesLabel: 'Yes — I
    have 12V', noLabel: 'No — no voltage' }}` renders both labels as
    button text.
  - Add a test: omit yesLabel/noLabel, expect plain `Yes`/`No` rendered
    (back-compat).
  - Add a test: `confirmAsk.busy === true` renders `Working…` on both
    buttons.
  - Add a test: when `options.length === 2`, the spokes section header
    reads `OR, IF YOU CAN'T ANSWER YET` (or whichever string we settle
    on); when `options.length === 3` (legacy preview), keep
    `Three ways forward`.
  - Add a test: presence of an eyebrow `FASTEST PATH FORWARD` above the
    confirm card when `confirmAsk` is provided; absent when not.

  Run → expect failures.

- [ ] **Step 8.2 — Implement.** In `decline-or-defer.tsx`:
  - Extend `Props.confirmAsk` to
    `{ prompt; onYes; onNo; busy?; yesLabel?: string; noLabel?: string }`.
  - In the hero card render block (the existing confirmAsk branch):
    - Add an eyebrow span above the prompt: `FASTEST PATH FORWARD` styled
      to match other eyebrow labels in the file.
    - Add a one-line italic descriptor under the prompt:
      `Answering this lets the AI commit to the next step. ~10 sec.`
    - Buttons render
      `{busy ? 'Working…' : (yesLabel ?? 'Yes')}` and
      `{busy ? 'Working…' : (noLabel ?? 'No')}`.
  - In the `photoAsk` block, change the `Snap it` busy text from the
    existing `Uploading…` to `Working…` for consistency (or leave —
    decision in code review).
  - In the spokes section, replace the hard-coded `Three ways forward`
    lead text with: `options.length === 2 ? 'Or, if you can't answer
    yet' : 'Three ways forward'` (or just drop the lead text entirely —
    decision in code review).

- [ ] **Step 8.3 — Verify.** Re-run all decline-screen tests → green.

## Task 9 — Final verification + review

- [ ] **Step 9.1 — Suite run.**
  ```bash
  pnpm exec tsc --noEmit
  pnpm test
  pnpm build
  ```
  All clean.

- [ ] **Step 9.2 — Skill review.** Run `/review` on the staged diff.
  Address findings or document why deferred.

- [ ] **Step 9.3 — Security review.** Run `/security-review` on the
  staged diff. Address findings.

- [ ] **Step 9.4 — Commit + push.** Single commit (or split per task
  if review reveals issues that warrant atomic reverts).
  Push to `claude/location-ambient-temp-jJL3M`.

- [ ] **Step 9.5 — Notify Brandon** to fast-forward
  `claude/location-ambient-temp-jJL3M` onto `staging/camera-vision`
  for preview validation.

---

## Acceptance criteria (mapped from spec)

| Spec criterion | Verifiable by |
|---|---|
| Decline-screen exits land on active-session view, zero loops | Manual on preview + Task 7 tests |
| Yes/No buttons immediately read `Working…` | Task 8 test + manual |
| `Decline this job` absent from all surfaces; reason='decline' rejects 400 | Task 5 tests |
| Curator case page shows AI message text per turn (new sessions) | Task 3 test + Task 4 manual |
| `pnpm test` / `tsc` / `build` clean | Task 9.1 |
| Diff passes `/review` + `/security-review` | Task 9.2 / 9.3 |

## Out-of-scope reminders

- No backfill of `messageText` for pre-change session_events.
- No change to `DECLINE_LANGUAGE_SYSTEM` system prompt body (still
  mentions decline; never invoked with that reason after Task 5).
- No "Are you sure?" confirm on the Defer spoke.
- No inline gate dial on the active-session view (the larger refactor).
