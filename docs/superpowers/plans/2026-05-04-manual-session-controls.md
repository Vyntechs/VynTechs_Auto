# Manual Session Controls — Implementation Plan

> **Status (2026-05-04):** Tasks 1–4 shipped to production at vyntechs.dev. **Task 5 (Brandon's phone smoke) outstanding** — until that ratifies, the loop is "shipped-pending-validation." See `docs/superpowers/sessions/2026-05-04-handoff-prod-deploy-shipped.md` for the full session record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the manual control surface for session lifecycle that the previous Phase F partial-implementation skipped — a persistent "New diagnosis" CTA on TodayHome and a "Close case" button on ActiveSession. Together these unblock the close-session loop end-to-end on real cars where the AI tree doesn't reach `done=true` on its own.

**Architecture:** Two surface-level component changes. No new routes, no new API endpoints, no schema changes. The `/sessions/[id]/outcome` route already accepts manual closes — `closeSessionForUser` (lib/sessions.ts:223) only requires `status === 'open'`, not `treeState.done`. Phase F's auto-redirect on `treeState.done && open` stays — manual controls are the peer rail for when the tree doesn't converge.

**Tech Stack:** Next.js App Router (server components), `@phosphor-icons/react` for icons, `@testing-library/react` + Vitest for component tests, existing `@/components/vt` design system (AppHeader, Module, btn classes).

---

## Files Touched

- **Modify:** `components/screens/today-home.tsx` — add persistent New-diagnosis CTA in header right slot; remove dead Bell icon
- **Modify:** `components/screens/active-session.tsx` — add "Close case" Module after Plan
- **Create:** `tests/unit/today-home.test.tsx` — new component test
- **Create:** `tests/unit/active-session.test.tsx` — new component test

No backend, route, schema, prompt, or API changes.

---

## Task 1: Persistent "New diagnosis" CTA on TodayHome

**Why:** Today the CTA only renders inside the empty-state branch (`inProgress.length === 0 && queued.length === 0 && closedToday.length === 0`). Once any session exists in any list, the CTA disappears entirely — Brandon's "I don't have buttons for new session" maps directly to this. The header right slot currently holds a non-functional Bell icon (no onClick, no Link, no notification system behind it). Replace it.

**Files:**
- Modify: `components/screens/today-home.tsx`
- Create: `tests/unit/today-home.test.tsx`

- [x] **Step 1: Write the failing test**

Create `tests/unit/today-home.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TodayHome } from '@/components/screens/today-home'
import type { Session } from '@/lib/db/schema'

const baseSession: Session = {
  id: '00000000-0000-0000-0000-000000000001',
  shopId: 'shop-1',
  techId: 'tech-1',
  status: 'open',
  intake: {
    customerComplaint: 'Lost power on highway',
    vehicle: {
      year: 2013,
      make: 'Ford',
      model: 'F-150',
      trim: '3.5 EcoBoost',
      mileage: 159000,
    },
  },
  treeState: {
    nodes: [],
    currentNodeId: null,
    done: false,
    message: null,
    requestedArtifact: null,
    proposedAction: null,
    gateDecision: null,
  },
  createdAt: new Date('2026-05-04T12:00:00Z'),
  closedAt: null,
  outcome: null,
} as unknown as Session

describe('TodayHome', () => {
  it('renders persistent New diagnosis CTA in header when sessions exist', () => {
    render(
      <TodayHome
        techName="Brandon"
        inProgress={[baseSession]}
        queued={[]}
        closedToday={[]}
      />,
    )
    const link = screen.getByRole('link', { name: /new diagnosis/i })
    expect(link).toHaveAttribute('href', '/sessions/new')
  })

  it('renders New diagnosis CTA in empty state too', () => {
    render(
      <TodayHome techName="Brandon" inProgress={[]} queued={[]} closedToday={[]} />,
    )
    const links = screen.getAllByRole('link', { name: /new diagnosis/i })
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0]).toHaveAttribute('href', '/sessions/new')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/today-home.test.tsx`
Expected: FAIL — no `link` with name "new diagnosis" exists in the rendered header (today only the Bell icon is there).

- [x] **Step 3: Modify TodayHome to add persistent header CTA**

In `components/screens/today-home.tsx`:

1. Replace the import of `Bell`:

```tsx
import { Plus } from '@phosphor-icons/react/dist/ssr'
```

(Remove the `Bell` import.)

2. Replace the `right` prop on `<AppHeader>`. Find:

```tsx
right={
  <Bell
    size={18}
    weight="regular"
    style={{ color: 'var(--vt-fg-2)' }}
    aria-label="Notifications"
  />
}
```

Replace with:

```tsx
right={
  <Link
    href="/sessions/new"
    aria-label="New diagnosis"
    className="btn btn-primary"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      fontSize: 13,
      textDecoration: 'none',
    }}
  >
    <Plus size={14} weight="bold" aria-hidden="true" />
    New diagnosis
  </Link>
}
```

(`Link` is already imported from `next/link` at the top of the file.)

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/today-home.test.tsx`
Expected: PASS — both tests green. Header CTA + empty-state CTA both reachable.

- [x] **Step 5: Run typecheck and build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: clean. No type errors, build succeeds.

- [x] **Step 6: Commit**

```bash
git add components/screens/today-home.tsx tests/unit/today-home.test.tsx
git commit -m "feat(today-home): persistent New diagnosis CTA in header"
```

---

## Task 2: "Close case" button on ActiveSession

**Why:** ActiveSession today has no manual close path — the only route to outcome capture is Phase F's auto-redirect when `treeState.done && open`. On real diagnoses (the F-150 dogfood is the proof) the tree may not converge to `done=true`, leaving the tech locked into the active flow forever. `closeSessionForUser` already accepts manual closes. We just need a button on the active session that navigates to `/sessions/[id]/outcome`. Place it as a dedicated Module after the Plan module — discoverable, doesn't interrupt the active step, uses the same "Close case" terminology as the OutcomeCapture form's submit button.

**Files:**
- Modify: `components/screens/active-session.tsx`
- Create: `tests/unit/active-session.test.tsx`

- [x] **Step 1: Write the failing test**

Create `tests/unit/active-session.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActiveSession } from '@/components/screens/active-session'
import type { Session } from '@/lib/db/schema'

const session: Session = {
  id: '11111111-1111-1111-1111-111111111111',
  shopId: 'shop-1',
  techId: 'tech-1',
  status: 'open',
  intake: {
    customerComplaint: 'Lost power on highway',
    vehicle: {
      year: 2013,
      make: 'Ford',
      model: 'F-150',
      trim: '3.5 EcoBoost',
      mileage: 159000,
    },
  },
  treeState: {
    nodes: [
      {
        id: 'n1',
        label: 'Pull DTCs and freeze frame data',
        status: 'active',
        rationale: 'Establish what the truck saw before the symptom.',
      },
    ],
    currentNodeId: 'n1',
    done: false,
    message: null,
    requestedArtifact: null,
    proposedAction: null,
    gateDecision: null,
  },
  createdAt: new Date('2026-05-04T12:00:00Z'),
  closedAt: null,
  outcome: null,
} as unknown as Session

describe('ActiveSession', () => {
  it('renders Close case link pointing to /sessions/[id]/outcome', () => {
    render(<ActiveSession session={session} />)
    const link = screen.getByRole('link', { name: /close case/i })
    expect(link).toHaveAttribute(
      'href',
      `/sessions/${session.id}/outcome`,
    )
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/active-session.test.tsx`
Expected: FAIL — no link named "close case" exists in ActiveSession.

- [x] **Step 3: Modify ActiveSession to add Close case Module**

In `components/screens/active-session.tsx`:

1. Add import at the top of the file:

```tsx
import Link from 'next/link'
```

2. Find the closing `</Module>` for the Plan module (the one wrapping `<TreeRail steps={steps} />`). Immediately after that closing `</Module>` tag — and still inside the same parent flex container `div`, before the closing `</div>` and `<CaptureBar />` — add:

```tsx
<Module num="—" label="Close case">
  <p
    style={{
      fontFamily: 'var(--vt-font-serif)',
      fontStyle: 'italic',
      fontSize: 14,
      color: 'var(--vt-fg-2)',
      lineHeight: 1.5,
      margin: '0 0 12px',
    }}
  >
    Done diagnosing? Capture what fixed it and close the case.
  </p>
  <Link
    href={`/sessions/${session.id}/outcome`}
    className="btn btn-primary"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      textDecoration: 'none',
    }}
  >
    Close case
  </Link>
</Module>
```

The final layout of the inner flex container becomes (in order): Active step Module, optional Confidence Module, Plan Module, Close case Module — then `<CaptureBar />` outside the flex container as it is today.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/active-session.test.tsx`
Expected: PASS — link exists with correct href.

- [x] **Step 5: Run typecheck and build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: clean.

- [x] **Step 6: Commit**

```bash
git add components/screens/active-session.tsx tests/unit/active-session.test.tsx
git commit -m "feat(active-session): manual Close case button to /outcome"
```

---

## Task 3: Full-suite verification

**Why:** Before declaring done, run the full project verification per AGENTS.md. The pglite test-DB flake (4–20 failures per run, pre-existing) is NOT a regression — we run twice to distinguish flake from real breakage. Our new tests (`today-home.test.tsx`, `active-session.test.tsx`) must pass on every run.

- [x] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: ~292 pass / ≤20 pglite-flake fails. **Both new test files must pass.** If anything else newly fails, that's a regression — return to Phase 1 of systematic-debugging.

- [x] **Step 2: Re-run the full test suite to confirm flake pattern**

Run: `pnpm test`
Expected: similar pass count, different specific pglite tests fail (flake confirmed). New tests still pass.

- [x] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean exit.

- [x] **Step 4: Run production build**

Run: `pnpm build`
Expected: clean build, all routes listed.

---

## Task 4: Automated session-loop integration test

**Why:** Phase F was declared shipped without ever walking the close-session loop end-to-end. The component tests in Tasks 1 and 2 prove the buttons render with correct hrefs, but they don't prove the **data flow** works — that an intake submission, a close, and corpus promotion all chain together correctly with the real services. The existing `close-session-handler.test.ts` mocks `promoteToCorpus`. The existing `corpus-promotion.test.ts` mocks `db.execute`. Neither walks the full chain. **This test fills the gap.**

`pglite` ships with `pgvector` — `tests/helpers/db.ts` enables the extension at setup, so corpus inserts work in tests. The only external dependency is `@/lib/ai/embeddings.embed` (OpenAI), which we mock with a fixed 1536-dim vector.

**This is the automation that mirrors what Brandon would do on a phone.** It walks: intake (simulating "tap New diagnosis → fill form → submit"), close-with-real-promote (simulating "tap Close case → fill outcome → submit"), assert corpus row appears (simulating "the brain learned").

**Files:**
- Create: `tests/integration/manual-session-loop.test.ts`

- [x] **Step 1: Create integration test directory if missing**

Run: `mkdir -p tests/integration`
Expected: silent success (already exists or created).

- [x] **Step 2: Write the integration test**

Create `tests/integration/manual-session-loop.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { ensureProfileAndShop } from '@/lib/db/queries'
import { createSessionForUser, closeSessionForUser } from '@/lib/sessions'
import { promoteSessionToCorpus } from '@/lib/corpus/promotion'
import type { TreeState } from '@/lib/ai/tree-engine'

const embedMock = vi.fn().mockResolvedValue(Array(1536).fill(0.1))
vi.mock('@/lib/ai/embeddings', () => ({
  embed: (...args: unknown[]) => embedMock(...args),
}))

const stubTree: TreeState = {
  nodes: [{ id: 'root', label: 'Pull DTCs', status: 'active' }],
  currentNodeId: 'root',
  message: 'starting',
}

describe('manual session loop — what Brandon would do on a phone', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    embedMock.mockClear()
  })

  afterEach(async () => {
    await close()
  })

  it('walks intake → close case → corpus row appears (real promote, mocked embed)', async () => {
    // ─── Step A: Brandon taps "New diagnosis" and fills intake ─────────────
    const userId = crypto.randomUUID()
    await ensureProfileAndShop(db, userId, 'brandon@vyntechs.test')

    const created = await createSessionForUser({
      db,
      userId,
      body: {
        vehicleYear: 2013,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        vehicleEngine: '3.5L EcoBoost',
        customerComplaint: 'loss of power going up hills',
      },
      treeState: stubTree,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('intake create failed')
    const sessionId = created.id

    // ─── Step B: Brandon taps "Close case" and submits outcome ────────────
    // (Skipping the AI tree advance — irrelevant for proving the close loop.
    //  The whole point of the manual Close case button is that you don't
    //  need treeState.done to close.)
    const closeResult = await closeSessionForUser({
      db,
      userId,
      sessionId,
      body: {
        rootCause:
          'Wastegate vacuum line cracked at actuator-can end on driver-side turbo',
        actionType: 'part_replacement',
        partInfo: {
          name: 'Vacuum line, silicone 4mm',
          oemNumber: 'BL3Z-9C915-A',
          cost: 12.5,
        },
        verification: {
          codesCleared: true,
          testDrive: true,
          symptomsResolved: 'yes',
        },
        diagMinutes: 25,
        repairMinutes: 18,
        notes: 'Confirmed with smoke test',
      },
      validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
      promoteToCorpus: promoteSessionToCorpus,
    })
    expect(closeResult.ok).toBe(true)

    // ─── Step C: Verify the brain learned ─────────────────────────────────
    const rows = (await db.execute(sql`
      SELECT id, root_cause, action_type, vehicle_make, vehicle_model, source_session_id
      FROM corpus_entries
      WHERE source_session_id = ${sessionId}
    `)) as unknown as Array<{
      id: string
      root_cause: string
      action_type: string
      vehicle_make: string
      vehicle_model: string
      source_session_id: string
    }>

    expect(rows).toHaveLength(1)
    expect(rows[0].root_cause).toContain('Wastegate')
    expect(rows[0].action_type).toBe('part_replacement')
    expect(rows[0].vehicle_make).toBe('Ford')
    expect(rows[0].vehicle_model).toBe('F-150')
    expect(rows[0].source_session_id).toBe(sessionId)

    // Embed was called once for the promotion vector.
    expect(embedMock).toHaveBeenCalled()
  })
})
```

- [x] **Step 3: Run the integration test**

Run: `pnpm exec vitest run tests/integration/manual-session-loop.test.ts`
Expected: PASS — the assertion `expect(rows).toHaveLength(1)` is the proof the corpus row was written. If this fails with `0` rows, the close-loop chain is broken and we return to systematic-debugging Phase 1 with real evidence about which stage dropped the ball.

- [x] **Step 4: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add tests/integration/manual-session-loop.test.ts
git commit -m "test(integration): automated session-loop end-to-end walk"
```

---

## Task 5: Brandon's final human smoke (real phone, ~5 min)

**Why:** Tasks 1–4 verify the code works. They don't catch what only a real browser+phone walk catches: CSS layout bugs that hide the buttons, click handlers that fail in WebKit, font sizes that look fine in dev preview but tiny on the iPhone, auth flows that break in production-like conditions. **Five minutes of human walking** ratifies the automation. If Tasks 1–4 all pass and Brandon's smoke walk uncovers anything broken, we have a sharp signal: the gap is environmental, not logic.

**This task is for Brandon. Not implemented by an agent.**

**Update (2026-05-04 prod deploy):** Walk this on **https://vyntechs.dev** instead of the local dev server — the production deploy of Voyage-backed code is live there. Steps below still apply; just use the deployed URL on Safari. Local dev server still works as a fallback if needed.

- [ ] **Step 1: Open vyntechs.dev (or start local dev server as fallback)**

Production: `https://vyntechs.dev` on iPhone Safari. Sign in.
Local fallback: `pnpm exec next dev --webpack -H 0.0.0.0 -p 3000` (Webpack required — Turbopack hits the cross-origin Client-Manifest bug. `next.config.js` has `allowedDevOrigins: ['192.168.1.36']` for iPhone-on-LAN.)

- [ ] **Step 2: Smoke walk on the phone**

Verify:

1. `/today` — "New diagnosis" button is visible in the header (not just empty state)
2. Tap it → `/sessions/new` intake form renders
3. Fill quick fake intake, submit → lands on `/sessions/[id]`
4. Active session screen shows "Close case" Module below the Plan tree
5. Tap "Close case" → `/sessions/[id]/outcome` form renders
6. Fill quick fake outcome, submit → lands on `/sessions` with the row showing closed

Time budget: 5 minutes. **If anything looks broken or hidden, stop and report.** Don't try to fix on the phone.

- [ ] **Step 3: Update the latest handoff**

Append a slim handoff in `docs/superpowers/sessions/` named `2026-05-04-manual-session-controls-verified.md`. Include: closed session id, the corpus_entries id from the integration test run, and any phone-walk observations. Slim format per AGENTS.md.

---

## Self-Review

**Spec coverage:**
- ✓ "Buttons for new session" → Task 1 (persistent header CTA on TodayHome)
- ✓ "Buttons for ending a session" → Task 2 (Close case Module on ActiveSession)
- ✓ "Selecting what fixed it" → Task 2 unblocks navigation to OutcomeCapture, which has the action-type dropdown + part-info fields already
- ✓ "Full plans, no partial implementation" → Task 4 (automated integration walk) is the verification gate. No "shipped" claim until the corpus_entries row appears in the test DB. Task 5 is Brandon's quick human ratification of the automated proof.

**Why automation in Task 4 instead of Brandon walking:** Brandon's request — "wire it so I don't have to manually do it until you've verified it works." pglite has pgvector enabled in `tests/helpers/db.ts`, so the corpus-promotion path runs in tests with only the embedding call mocked. This is the closest possible "what would happen on a real phone" test without spinning up Playwright + auth + AI mocking infra (a 4-6 hour investment for ~5% additional confidence). Brandon's 5-minute phone smoke (Task 5) catches the residual UI/CSS/browser-only failure modes.

**Placeholder scan:** no TBDs, no "implement later", code blocks present at every code step, exact paths used, expected test outputs specified.

**Type consistency:** `Session` shape pulled from `@/lib/db/schema` matches both component contracts. `treeState.nodes`, `currentNodeId`, `done` keys consistent across both test fixtures and the production components I read at `components/screens/today-home.tsx` and `components/screens/active-session.tsx`.

**Risk:** the test fixtures in Tasks 1 and 2 use `as unknown as Session` to cast minimal session shapes. If the `Session` type drifts (new required field added) the fixtures need updating but the runtime behavior the tests verify is independent. Acceptable trade-off for surface-level component tests; the typed casts are intentionally wide so the tests stay focused on the rendered UI.
