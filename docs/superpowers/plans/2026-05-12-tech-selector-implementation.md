# Tech Selector on `/intake` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional tech selector pill to `/intake`'s form header so the writer can route a new work order to a specific tech in their shop, with silent server-side fallback to the advisor when nothing is picked.

**Architecture:** New `<TechSelector>` component mounted in `MainHeader`'s new `eyebrowSlot` of `CounterIntake`. A new `getShopTeam` server helper fetches roster + workload (workload best-effort, soft-fail). Server-side fallback in `createSessionFromIntake` stamps the advisor when `assignedTechId` is absent — keeps `sessions.tech_id NOT NULL`, **no schema migration**.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM 0.45, Vitest 4 + PGlite for DB-touching unit tests, React Testing Library 16 + happy-dom for component tests, existing `--vt-*` design tokens, `@/components/vt/desktop` primitives.

**Spec:** `docs/superpowers/specs/2026-05-12-tech-selector-design.md`

**Design handoff (gitignored, reference only):** `designs/design_handoff_tech_selector/`

---

## File structure

**Files to create:**

| Path | Responsibility |
|---|---|
| `lib/intake/team.ts` | `getShopTeam` helper — roster + workload (soft-fail) |
| `components/vt/tech-selector/index.tsx` | `<TechSelector>` component (resting + solo + popover + sheet + search + keyboard + ARIA) |
| `components/vt/tech-selector/tech-selector.css` | Component styles, ported from handoff |
| `tests/unit/get-shop-team.test.ts` | Backend tests for `getShopTeam` |
| `tests/unit/intake-submit-tech-id.test.ts` | Route tests for `assignedTechId` validation + fallback |
| `tests/unit/tech-selector.test.tsx` | Component tests |

**Files to modify:**

| Path | Change |
|---|---|
| `lib/intake/session.ts` | Add `assignedTechId?: string \| null` to input; use fallback at insert site |
| `app/api/intake/submit/route.ts` | Parse + validate `assignedTechId`, cross-shop guard, pass through |
| `components/vt/desktop/index.tsx` | `MainHeader` gets `eyebrowSlot?: ReactNode` prop |
| `components/screens/counter-intake.tsx` | Accept `team` + `workloadFailed` props, hold `assignedTechId` state, render `<TechSelector>` via `MainHeader.eyebrowSlot`, include in submit body |
| `app/(app)/intake/page.tsx` | Parallel-fetch team alongside `recentCustomers` |

**Regression coverage to keep green:** `tests/unit/intake-submit-route.test.ts`, `tests/unit/intake-submit-pick-existing.test.ts`, `tests/unit/intake-session.test.ts`, `tests/unit/counter-intake.test.tsx`.

---

## Task ordering + dependencies

```
Task 1 (session fallback)
   └─ Task 2 (route validation + guard)
Task 3 (getShopTeam helper)  [independent]
Task 4 (MainHeader.eyebrowSlot)  [independent]
   └─ Task 5 (TechSelector base)
        └─ Task 6 (popover + pick + clear)
             └─ Task 7 (search + workload + soft-fail)
                  └─ Task 8 (keyboard + ARIA)
Task 9 (CSS port)  [can run alongside 5-8]
Task 10 (wire into CounterIntake + page)  [requires 1-3 + 4-9]
Task 11 (phone bottom sheet polish)  [requires 10]
Task 12 (manual Vercel verification + Brandon handoff)  [requires 11]
```

Tasks 1+3+4 can run in parallel. Tasks 5-8 are sequential. Task 9 can run alongside the component build.

---

## Task 1: Server-side fallback in `createSessionFromIntake`

**Files:**
- Modify: `lib/intake/session.ts:7-48` (input type), `lib/intake/session.ts:126-143` (insert site)
- Test: `tests/unit/intake-session.test.ts` (extend existing file)

- [ ] **Step 1: Read the existing test file to match its style and helpers**

Run: `cat tests/unit/intake-session.test.ts | head -80`

Expected: see how the existing test seeds shop + profile + customer/vehicle + calls `createSessionFromIntake` with `advisorProfileId`.

- [ ] **Step 2: Add a failing test for the "assignedTechId omitted → falls back to advisor" case (regression of current behavior)**

Append to `tests/unit/intake-session.test.ts` inside the existing `describe`:

```typescript
  it('falls back to advisorProfileId when assignedTechId is omitted', async () => {
    const { sessionId } = await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      // assignedTechId intentionally omitted
      customer: { name: 'Tester', phone: '555-0001', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150',
        engine: null, vin: null, mileage: null, plate: null,
      },
      complaint: {
        description: 'no start',
        whenStarted: '', howOften: '', authorized: '',
      },
    })
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(advisorProfileId)
  })

  it('uses assignedTechId when provided', async () => {
    const [other] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000099',
        role: 'tech',
        shopId,
        fullName: 'Other Tech',
      })
      .returning()

    const { sessionId } = await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      assignedTechId: other.id,
      customer: { name: 'Tester', phone: '555-0002', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150',
        engine: null, vin: null, mileage: null, plate: null,
      },
      complaint: {
        description: 'no start',
        whenStarted: '', howOften: '', authorized: '',
      },
    })
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(other.id)
  })

  it('falls back to advisorProfileId when assignedTechId is explicitly null', async () => {
    const { sessionId } = await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      assignedTechId: null,
      customer: { name: 'Tester', phone: '555-0003', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150',
        engine: null, vin: null, mileage: null, plate: null,
      },
      complaint: {
        description: 'no start',
        whenStarted: '', howOften: '', authorized: '',
      },
    })
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(advisorProfileId)
  })
```

If `profiles` isn't already imported at the top of the test, add it: `import { profiles, sessions } from '@/lib/db/schema'`.

- [ ] **Step 3: Run the new tests and verify they fail**

Run: `pnpm test tests/unit/intake-session.test.ts`

Expected: the two non-trivial tests pass (current behavior happens to be advisor-fallback because `techId: input.advisorProfileId` is hardcoded), but TypeScript may complain that `assignedTechId` isn't a known property. If the type rejects it, tests fail to compile → that IS the failure. If TS accepts (excess property in object literal flagged differently in Drizzle helpers) and the test runs, you'll see the "uses assignedTechId" case fail because the field is silently dropped.

- [ ] **Step 4: Add `assignedTechId` to the input type**

Edit `lib/intake/session.ts`, modify `CreateSessionFromIntakeInput`:

```typescript
export type CreateSessionFromIntakeInput = {
  shopId: string
  advisorProfileId: string
  /**
   * Optional override for sessions.tech_id. When null/undefined, falls back to
   * advisorProfileId. The route is responsible for cross-shop validation
   * BEFORE calling this helper.
   */
  assignedTechId?: string | null
  customer: { name: string; phone: string; email: string | null }
  vehicle: {
    year: number
    make: string
    model: string
    engine: string | null
    vin: string | null
    mileage: number | null
    plate: string | null
  }
  complaint: {
    description: string
    whenStarted: string
    howOften: string
    authorized: string
  }
  treeState?: TreeState
  existingCustomerId?: string
  existingVehicleId?: string
}
```

- [ ] **Step 5: Use the fallback at the insert site**

Edit `lib/intake/session.ts:130`, change `techId: input.advisorProfileId,` to:

```typescript
        techId: input.assignedTechId ?? input.advisorProfileId,
```

- [ ] **Step 6: Run the tests, verify all three pass**

Run: `pnpm test tests/unit/intake-session.test.ts`

Expected: all tests pass, including the two new ones.

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `pnpm test`

Expected: all green. The existing `expect(sessionRows[0].techId).toBe(ownerProfileId)` assertions in `intake-submit-route.test.ts` and `intake-submit-pick-existing.test.ts` keep passing because they don't pass `assignedTechId`.

> **Note on PGlite flake:** Per CLAUDE.md memory `feedback_vitest_pglite_flake.md`, the first `pnpm test` after a fresh shell can show 50+ "PGlite is closed" errors. Rerun once before treating it as a regression.

- [ ] **Step 8: Commit**

```bash
git add lib/intake/session.ts tests/unit/intake-session.test.ts
git commit -m "feat(intake): createSessionFromIntake accepts assignedTechId with advisor fallback"
```

---

## Task 2: `/api/intake/submit` parses + validates `assignedTechId`

**Files:**
- Modify: `app/api/intake/submit/route.ts` (body type at L33, validation block near L86, helper call at L200)
- Create: `tests/unit/intake-submit-tech-id.test.ts`

- [ ] **Step 1: Create the new test file**

Create `tests/unit/intake-submit-tech-id.test.ts` mirroring the mock setup of `tests/unit/intake-submit-route.test.ts` (read its first 80 lines as the template — same mock structure for db client, supabase, auth, tree-engine, corpus).

The test file should set up:
- A primary shop with `ownerProfileId` (the advisor, authenticated user).
- A second profile `teammateProfileId` in the SAME shop.
- A third profile `otherShopProfileId` in a DIFFERENT shop.

Then write these test cases inside `describe('POST /api/intake/submit — assignedTechId', () => {`:

```typescript
  it('stamps tech_id = advisor when assignedTechId omitted', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BODY),  // no assignedTechId field
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const [row] = await currentDb.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(ownerProfileId)
  })

  it('stamps tech_id = advisor when assignedTechId is null', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: null }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const [row] = await currentDb.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(ownerProfileId)
  })

  it('stamps tech_id = teammate when assignedTechId points to a same-shop profile', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: teammateProfileId }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const [row] = await currentDb.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(teammateProfileId)
  })

  it('returns 403 cross_shop_forbidden when assignedTechId is in a different shop', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: otherShopProfileId }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('cross_shop_forbidden')
    // No session row written.
    expect(await currentDb.select().from(sessions)).toHaveLength(0)
  })

  it('returns 404 profile_not_found when assignedTechId is unknown', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...SAMPLE_BODY,
        assignedTechId: '00000000-0000-0000-0000-0000000000ff',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('profile_not_found')
  })

  it('returns 422 invalid_assigned_tech_id for non-uuid strings', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: 'not-a-uuid' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_assigned_tech_id')
  })
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `pnpm test tests/unit/intake-submit-tech-id.test.ts`

Expected: the first three pass (no `assignedTechId` parsing yet, falls through to advisor for all of them — including the teammate case which gets advisor since the field is ignored). The 403 / 404 / 422 tests fail (route currently has no validation).

- [ ] **Step 3: Add `assignedTechId` to the route body type and validation**

Edit `app/api/intake/submit/route.ts`:

First, extend `IntakeBody` (around L33):

```typescript
type IntakeBody = {
  existingVehicleId?: string
  customer?: { name?: string; phone?: string; email?: string }
  vehicle?: {
    vin?: string
    year?: string
    make?: string
    model?: string
    engine?: string
    mileage?: string
    plate?: string
  }
  complaint?: {
    description?: string
    whenStarted?: string
    howOften?: string
    authorized?: string
  }
  assignedTechId?: string | null  // NEW
}
```

Add a UUID-shape regex helper near the other helpers (around L62):

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
```

Add validation + cross-shop guard inside `POST`, AFTER the existing `description` check (~L89) and BEFORE the resolve-customer-and-vehicle block:

```typescript
  // Validate assignedTechId shape + scope. Null / undefined falls through to
  // the helper's advisor fallback.
  let assignedTechId: string | null = null
  if (body.assignedTechId !== undefined && body.assignedTechId !== null) {
    if (typeof body.assignedTechId !== 'string' || !UUID_RE.test(body.assignedTechId)) {
      return NextResponse.json({ error: 'invalid_assigned_tech_id' }, { status: 422 })
    }
    const [target] = await db
      .select({ id: profiles.id, shopId: profiles.shopId })
      .from(profiles)
      .where(eq(profiles.id, body.assignedTechId))
      .limit(1)
    if (!target) {
      return NextResponse.json({ error: 'profile_not_found' }, { status: 404 })
    }
    if (target.shopId !== ctx.profile.shopId) {
      return NextResponse.json({ error: 'cross_shop_forbidden' }, { status: 403 })
    }
    assignedTechId = body.assignedTechId
  }
```

Add `profiles` to the schema import at the top (the route currently imports `customers as customersTable, vehicles as vehiclesTable`):

```typescript
import { customers as customersTable, vehicles as vehiclesTable, profiles } from '@/lib/db/schema'
```

Finally, pass `assignedTechId` through to the helper call (around L200):

```typescript
  const { sessionId } = await createSessionFromIntake(db, {
    shopId: ctx.profile.shopId,
    advisorProfileId: ctx.profile.id,
    assignedTechId,
    customer: { ... },  // unchanged
    vehicle: { ... },   // unchanged
    complaint: { ... }, // unchanged
    treeState,
    existingCustomerId: resolvedCustomerId,
    existingVehicleId: resolvedVehicleId,
  })
```

- [ ] **Step 4: Run tests, verify all six pass**

Run: `pnpm test tests/unit/intake-submit-tech-id.test.ts`

Expected: all six green.

- [ ] **Step 5: Run regression suites**

Run: `pnpm test tests/unit/intake-submit-route.test.ts tests/unit/intake-submit-pick-existing.test.ts`

Expected: still green. Existing tests don't pass `assignedTechId`, so they hit the fallback (which is unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add app/api/intake/submit/route.ts tests/unit/intake-submit-tech-id.test.ts
git commit -m "feat(intake): /api/intake/submit accepts + validates assignedTechId"
```

---

## Task 3: `getShopTeam` helper

**Files:**
- Create: `lib/intake/team.ts`
- Create: `tests/unit/get-shop-team.test.ts`

- [ ] **Step 1: Create the failing test file**

Create `tests/unit/get-shop-team.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, sessions, shops, customers, vehicles } from '@/lib/db/schema'
import { getShopTeam } from '@/lib/intake/team'

describe('getShopTeam', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let advisorId: string
  let aliceId: string
  let bobId: string

  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close

    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id

    const [advisor] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        role: 'owner', shopId, fullName: 'Charlie Advisor',
      })
      .returning()
    advisorId = advisor.id

    const [alice] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000002',
        role: 'tech', shopId, fullName: 'Alice Tech',
      })
      .returning()
    aliceId = alice.id

    const [bob] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000003',
        role: 'tech', shopId, fullName: 'Bob Tech',
      })
      .returning()
    bobId = bob.id

    // Other-shop profile should NOT appear in results.
    const [otherShop] = await db.insert(shops).values({ name: 'Other' }).returning()
    await db.insert(profiles).values({
      userId: '00000000-0000-0000-0000-000000000004',
      role: 'tech', shopId: otherShop.id, fullName: 'Excluded',
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns members scoped to the shop, current user pinned to top', async () => {
    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.members.map((m) => m.id)).toEqual([advisorId, aliceId, bobId])
    expect(result.members[0].isCurrentUser).toBe(true)
    expect(result.members[1].isCurrentUser).toBe(false)
    expect(result.workloadFailed).toBe(false)
  })

  it('sorts non-current-user members by fullName ASC (nulls last)', async () => {
    // Insert a fourth member with null fullName — should sort last.
    await db.insert(profiles).values({
      userId: '00000000-0000-0000-0000-000000000005',
      role: 'tech', shopId, fullName: null,
    })
    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.members[0].id).toBe(advisorId)               // pinned
    expect(result.members[1].name).toBe('Alice Tech')           // alpha
    expect(result.members[2].name).toBe('Bob Tech')
    expect(result.members[3].name).toBe('Tech')                 // null fullName → fallback label
  })

  it('returns workload counts when sessions exist', async () => {
    // Seed a customer + vehicle so sessions can FK in.
    const [c] = await db.insert(customers).values({
      shopId, name: 'C', phone: '555-0000',
    }).returning()
    const [v] = await db.insert(vehicles).values({
      customerId: c.id, year: 2020, make: 'X', model: 'Y',
    }).returning()
    const emptyTree = { nodes: [], currentNodeId: '', message: '' }
    const intake = {
      vehicleYear: 2020, vehicleMake: 'X', vehicleModel: 'Y',
      customerComplaint: 'noise',
    }
    // Alice: 2 open sessions, 1 created today.
    await db.insert(sessions).values([
      { shopId, techId: aliceId, vehicleId: v.id, status: 'open',
        intake, treeState: emptyTree },
      { shopId, techId: aliceId, vehicleId: v.id, status: 'open',
        intake, treeState: emptyTree },
    ])
    // Bob: 1 open, 0 today (force created_at into yesterday).
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000)
    await db.insert(sessions).values({
      shopId, techId: bobId, vehicleId: v.id, status: 'open',
      intake, treeState: emptyTree, createdAt: yesterday,
    })

    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    const alice = result.members.find((m) => m.id === aliceId)!
    const bob = result.members.find((m) => m.id === bobId)!
    expect(alice.workload).toEqual({ open: 2, today: 2 })
    expect(bob.workload).toEqual({ open: 1, today: 0 })
  })

  it('sets workloadFailed=true and omits workload when the workload query throws', async () => {
    // Force the workload query to throw by passing a corrupted db.
    const brokenDb = new Proxy(db, {
      get(target, prop) {
        const value = target[prop as keyof TestDb]
        // Detect the workload query by intercepting select chain on a
        // second invocation. Cleaner: stub `execute` to throw for the
        // sessions query. For simplicity, just throw on any second select.
        return value
      },
    })
    // Use vi.spyOn to make the workload query reject.
    const original = db.select.bind(db)
    let callCount = 0
    const spy = vi.spyOn(db, 'select').mockImplementation((...args: Parameters<typeof original>) => {
      callCount += 1
      // First call = roster; second = workload.
      if (callCount === 2) {
        throw new Error('simulated workload failure')
      }
      return original(...args)
    })

    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.workloadFailed).toBe(true)
    expect(result.members.every((m) => m.workload === undefined)).toBe(true)
    spy.mockRestore()
  })

  it('returns a single-member array when only the current user is in the shop', async () => {
    // Delete the other shop members.
    await db.delete(profiles).where(/* shopId match + id != advisorId */
      // use drizzle: eq(profiles.shopId, shopId) AND ne(profiles.id, advisorId)
      // helper imports needed
      eq(profiles.id, aliceId),
    )
    await db.delete(profiles).where(eq(profiles.id, bobId))
    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.members).toHaveLength(1)
    expect(result.members[0].id).toBe(advisorId)
  })
})
```

Required imports at top: `import { eq } from 'drizzle-orm'`.

- [ ] **Step 2: Run tests, confirm import-not-found failure**

Run: `pnpm test tests/unit/get-shop-team.test.ts`

Expected: tests fail with `Cannot find module '@/lib/intake/team'`. That's the failure we want.

- [ ] **Step 3: Create `lib/intake/team.ts`**

```typescript
import { and, eq, sql } from 'drizzle-orm'
import { profiles, sessions } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

export type TeamMember = {
  id: string
  name: string
  isCurrentUser: boolean
  workload?: { open: number; today: number }
}

export type GetShopTeamInput = {
  db: AppDb
  shopId: string
  currentUserId: string
}

export type GetShopTeamResult = {
  members: TeamMember[]
  workloadFailed: boolean
}

export async function getShopTeam(input: GetShopTeamInput): Promise<GetShopTeamResult> {
  const { db, shopId, currentUserId } = input

  // Query 1 — roster. Bubble errors (page 500s).
  const roster = await db
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
    })
    .from(profiles)
    .where(eq(profiles.shopId, shopId))

  // Sort: nulls last on fullName, then by id (stable). Drizzle pg has no
  // direct NULLS LAST helper across versions; sort in JS for portability.
  roster.sort((a, b) => {
    if (a.fullName === null && b.fullName !== null) return 1
    if (a.fullName !== null && b.fullName === null) return -1
    if (a.fullName === null && b.fullName === null) return a.id < b.id ? -1 : 1
    return (a.fullName ?? '').localeCompare(b.fullName ?? '')
  })

  const memberIds = roster.map((r) => r.id)

  // Query 2 — workload counts. Soft-fail on any error.
  let workloadFailed = false
  const workloadByTech = new Map<string, { open: number; today: number }>()
  if (memberIds.length > 0) {
    try {
      const rows = await db
        .select({
          techId: sessions.techId,
          openCount: sql<number>`count(*) filter (where ${sessions.status} = 'open')::int`,
          todayCount: sql<number>`count(*) filter (where ${sessions.createdAt} >= date_trunc('day', now()))::int`,
        })
        .from(sessions)
        .where(and(
          eq(sessions.shopId, shopId),
          sql`${sessions.techId} = ANY(${memberIds})`,
        ))
        .groupBy(sessions.techId)
      for (const row of rows) {
        if (row.techId) {
          workloadByTech.set(row.techId, {
            open: Number(row.openCount),
            today: Number(row.todayCount),
          })
        }
      }
    } catch (err) {
      console.error('getShopTeam workload query failed:', err)
      workloadFailed = true
    }
  }

  // Compose members, pin current user, apply workload.
  const members: TeamMember[] = roster.map((row) => {
    const isCurrentUser = row.id === currentUserId
    const name = row.fullName ?? 'Tech'
    const base: TeamMember = { id: row.id, name, isCurrentUser }
    if (!workloadFailed) {
      base.workload = workloadByTech.get(row.id) ?? { open: 0, today: 0 }
    }
    return base
  })

  // Pin current user to the front.
  const currentIdx = members.findIndex((m) => m.isCurrentUser)
  if (currentIdx > 0) {
    const [current] = members.splice(currentIdx, 1)
    members.unshift(current)
  }

  return { members, workloadFailed }
}
```

- [ ] **Step 4: Run tests, confirm passes**

Run: `pnpm test tests/unit/get-shop-team.test.ts`

Expected: all five tests green. If "PGlite is closed" errors appear on the first run, rerun once (CLAUDE.md `feedback_vitest_pglite_flake.md`).

- [ ] **Step 5: Commit**

```bash
git add lib/intake/team.ts tests/unit/get-shop-team.test.ts
git commit -m "feat(intake): getShopTeam helper — roster + workload soft-fail"
```

---

## Task 4: `MainHeader.eyebrowSlot` prop

**Files:**
- Modify: `components/vt/desktop/index.tsx:52-73`
- No new test file — change is additive and exercised by existing `counter-intake.test.tsx` after wiring.

- [ ] **Step 1: Modify `MainHeader` to accept an optional `eyebrowSlot`**

Edit `components/vt/desktop/index.tsx`, replace the existing `MainHeader` definition:

```typescript
export function MainHeader({
  eyebrow,
  eyebrowSlot,
  title,
  sub,
  actions,
}: {
  eyebrow?: string
  eyebrowSlot?: ReactNode
  title: string
  sub?: string
  actions?: ReactNode
}) {
  return (
    <header className="vt-main__header">
      <div className="vt-main__title-block">
        {(eyebrow || eyebrowSlot) && (
          <div className="vt-main__eyebrow-row">
            {eyebrow && <span className="vt-main__eyebrow">{eyebrow}</span>}
            {eyebrowSlot}
          </div>
        )}
        <h1 className="vt-main__title">{title}</h1>
        {sub && <p className="vt-main__sub">{sub}</p>}
      </div>
      {actions && <div className="vt-main__actions">{actions}</div>}
    </header>
  )
}
```

- [ ] **Step 2: Add the `.vt-main__eyebrow-row` style**

Find the existing `.vt-main__eyebrow` style in the desktop stylesheet (search the project for the selector to locate it). Add alongside:

```css
.vt-main__eyebrow-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
```

If the stylesheet isn't immediately findable, do `rg "vt-main__eyebrow" --type css` to locate. Most likely under `app/globals.css` or a sibling file imported from there.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `pnpm test`

Expected: all green. The existing tests don't pass `eyebrowSlot`, so layout is identical.

- [ ] **Step 4: Commit**

```bash
git add components/vt/desktop/index.tsx app/globals.css  # whichever stylesheet got touched
git commit -m "feat(vt): MainHeader accepts optional eyebrowSlot for inline controls"
```

---

## Task 5: `<TechSelector>` skeleton — resting pill + solo inert variant

**Files:**
- Create: `components/vt/tech-selector/index.tsx`
- Create: `components/vt/tech-selector/tech-selector.css` (empty stub; styles land in Task 9)
- Create: `tests/unit/tech-selector.test.tsx`

- [ ] **Step 1: Create the failing test file**

Create `tests/unit/tech-selector.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TechSelector, type TeamMember } from '@/components/vt/tech-selector'

function mem(id: string, name: string, isCurrentUser = false): TeamMember {
  return { id, name, isCurrentUser }
}

describe('TechSelector — resting + solo states', () => {
  it('renders an inert "You · only tech" pill when team has one member', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true)]}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    const pill = screen.getByRole('group', { name: /assigned to/i })
    expect(pill).toHaveAttribute('aria-disabled', 'true')
    expect(pill).toHaveTextContent(/you/i)
    expect(pill).toHaveTextContent(/only tech/i)
  })

  it('renders an active "Open queue ▾" combobox when team has 2+ members and nothing selected', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true), mem('b', 'Diana')]}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent(/open queue/i)
  })

  it('renders the selected member name when selectedId is set', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true), mem('b', 'Diana')]}
        selectedId="b"
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    expect(trigger).toHaveTextContent(/diana/i)
    expect(trigger).not.toHaveTextContent(/open queue/i)
  })
})
```

- [ ] **Step 2: Run tests, confirm import-not-found failure**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: import error for `@/components/vt/tech-selector`.

- [ ] **Step 3: Create the empty CSS stub**

Create `components/vt/tech-selector/tech-selector.css` containing just:

```css
/* tech-selector styles — populated in Task 9 (CSS port from handoff) */
```

- [ ] **Step 4: Create the component skeleton**

Create `components/vt/tech-selector/index.tsx`:

```tsx
'use client'

import { useId, useState, useRef, useEffect, type KeyboardEvent } from 'react'
import './tech-selector.css'

export type TeamMember = {
  id: string
  name: string
  isCurrentUser: boolean
  workload?: { open: number; today: number }
}

export type TechSelectorProps = {
  currentUserId: string
  team: TeamMember[]
  workloadFailed?: boolean
  selectedId: string | null
  onChange: (id: string | null) => void
}

export function TechSelector({
  currentUserId: _currentUserId,
  team,
  workloadFailed: _workloadFailed = false,
  selectedId,
  onChange: _onChange,
}: TechSelectorProps) {
  const labelId = useId()

  // Solo inert variant.
  if (team.length === 1) {
    return (
      <div
        className="ts ts--solo"
        role="group"
        aria-labelledby={labelId}
        aria-disabled="true"
      >
        <span id={labelId} className="ts__label">Assigned to</span>
        <div className="ts__trigger ts__trigger--inert">
          <span className="ts__avatar" aria-hidden="true">
            {initials(team[0].name)}
          </span>
          <span className="ts__name">You</span>
          <span className="ts__tag">Only tech</span>
        </div>
      </div>
    )
  }

  // Active multi-member variant.
  const selected = selectedId ? team.find((m) => m.id === selectedId) ?? null : null
  return (
    <div className="ts" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="ts__label">Assigned to</span>
      <button
        type="button"
        className="ts__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={false}
        aria-controls={`${labelId}-listbox`}
      >
        {selected ? (
          <>
            <span className="ts__avatar" aria-hidden="true">{initials(selected.name)}</span>
            <span className="ts__name">{selected.name}</span>
          </>
        ) : (
          <span className="ts__name ts__name--placeholder">Open queue</span>
        )}
        <span className="ts__caret" aria-hidden="true">▾</span>
      </button>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
```

- [ ] **Step 5: Run tests, verify all three pass**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: all three tests green.

- [ ] **Step 6: Commit**

```bash
git add components/vt/tech-selector/ tests/unit/tech-selector.test.tsx
git commit -m "feat(intake): TechSelector skeleton — resting pill + solo inert variant"
```

---

## Task 6: `<TechSelector>` popover — open/close, listbox rows, pick, clear

**Files:**
- Modify: `components/vt/tech-selector/index.tsx`
- Extend: `tests/unit/tech-selector.test.tsx`

- [ ] **Step 1: Add failing tests for popover behavior**

Append to `tests/unit/tech-selector.test.tsx` inside a new `describe` block:

```tsx
import { fireEvent } from '@testing-library/react'

describe('TechSelector — popover', () => {
  const TEAM = [
    mem('a', 'Brandon', true),
    mem('b', 'Diana'),
    mem('c', 'Marcus'),
  ]

  it('opens the popover on trigger click and lists all members (current user pinned)', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={TEAM}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    // Current user pinned to top — assumed already sorted by caller (getShopTeam),
    // component renders array order.
    expect(options[0]).toHaveTextContent(/brandon/i)
    expect(options[1]).toHaveTextContent(/diana/i)
    expect(options[2]).toHaveTextContent(/marcus/i)
    expect(listbox).toBeInTheDocument()
  })

  it('closes the popover on Escape', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('calls onChange with the selected id and closes the popover when a row is clicked', () => {
    const onChange = vi.fn()
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    fireEvent.click(screen.getByRole('option', { name: /diana/i }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows a Clear row only when a selection exists, and onChange(null) when clicked', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.queryByRole('option', { name: /clear/i })).not.toBeInTheDocument()

    rerender(
      <TechSelector currentUserId="a" team={TEAM} selectedId="b" onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    const clear = screen.getByRole('option', { name: /clear.*open queue/i })
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('closes the popover when clicking outside', () => {
    render(
      <div>
        <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />
        <button>Outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: /outside/i }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests, confirm five new failures**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: five new failures — no popover implementation yet.

- [ ] **Step 3: Implement popover state + listbox + click-outside**

Edit `components/vt/tech-selector/index.tsx`. Replace the active-variant branch with this expanded version. Keep the solo branch unchanged.

```tsx
'use client'

import { useId, useState, useRef, useEffect, type KeyboardEvent } from 'react'
import './tech-selector.css'

export type TeamMember = {
  id: string
  name: string
  isCurrentUser: boolean
  workload?: { open: number; today: number }
}

export type TechSelectorProps = {
  currentUserId: string
  team: TeamMember[]
  workloadFailed?: boolean
  selectedId: string | null
  onChange: (id: string | null) => void
}

export function TechSelector(props: TechSelectorProps) {
  const { team, selectedId, onChange } = props
  const labelId = useId()
  const listboxId = `${labelId}-listbox`
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Solo branch — unchanged from Task 5.
  if (team.length === 1) {
    return (
      <div
        ref={rootRef}
        className="ts ts--solo"
        role="group"
        aria-labelledby={labelId}
        aria-disabled="true"
      >
        <span id={labelId} className="ts__label">Assigned to</span>
        <div className="ts__trigger ts__trigger--inert">
          <span className="ts__avatar" aria-hidden="true">{initials(team[0].name)}</span>
          <span className="ts__name">You</span>
          <span className="ts__tag">Only tech</span>
        </div>
      </div>
    )
  }

  const selected = selectedId ? team.find((m) => m.id === selectedId) ?? null : null

  function commit(id: string | null) {
    onChange(id)
    setOpen(false)
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
  }

  return (
    <div ref={rootRef} className="ts" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="ts__label">Assigned to</span>
      <button
        type="button"
        className="ts__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {selected ? (
          <>
            <span className="ts__avatar" aria-hidden="true">{initials(selected.name)}</span>
            <span className="ts__name">{selected.name}</span>
          </>
        ) : (
          <span className="ts__name ts__name--placeholder">Open queue</span>
        )}
        <span className="ts__caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="ts__popover">
          <span className="ts__eyebrow">Assigning to</span>
          <ul id={listboxId} className="ts__list" role="listbox">
            {team.map((m) => (
              <li
                key={m.id}
                role="option"
                aria-selected={selectedId === m.id}
                className={`ts__row${selectedId === m.id ? ' ts__row--selected' : ''}`}
                onClick={() => commit(m.id)}
              >
                <span className="ts__avatar" aria-hidden="true">{initials(m.name)}</span>
                <span className="ts__name">{m.name}</span>
                {m.isCurrentUser && <span className="ts__tag">You</span>}
              </li>
            ))}
            {selectedId !== null && (
              <li
                role="option"
                aria-selected="false"
                aria-label="Clear assignment, return to open queue"
                className="ts__row ts__row--clear"
                onClick={() => commit(null)}
              >
                <span className="ts__name">× Clear · Open queue</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: all 8 tests (3 from Task 5 + 5 new) green.

- [ ] **Step 5: Commit**

```bash
git add components/vt/tech-selector/index.tsx tests/unit/tech-selector.test.tsx
git commit -m "feat(intake): TechSelector popover open/close + pick + clear"
```

---

## Task 7: `<TechSelector>` search filter + workload badges + soft-fail

**Files:**
- Modify: `components/vt/tech-selector/index.tsx`
- Extend: `tests/unit/tech-selector.test.tsx`

- [ ] **Step 1: Add failing tests for search + workload**

Append to `tests/unit/tech-selector.test.tsx`:

```tsx
describe('TechSelector — search + workload', () => {
  function bigTeam(n: number): TeamMember[] {
    const names = ['Brandon', 'Diana', 'Marcus', 'Alice', 'Bob', 'Charlie', 'Eve', 'Frank', 'Grace']
    return Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      name: names[i],
      isCurrentUser: i === 0,
      workload: { open: i, today: 0 },
    }))
  }

  it('does NOT render the search input when team.length <= 5', () => {
    render(
      <TechSelector
        currentUserId="m0"
        team={bigTeam(5)}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('renders a search input when team.length > 5 and filters live', () => {
    render(
      <TechSelector
        currentUserId="m0"
        team={bigTeam(8)}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'di' } })
    const options = screen.getAllByRole('option').filter(
      (o) => !o.getAttribute('aria-label')?.includes('Clear'),
    )
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent(/diana/i)
  })

  it('renders workload badges "{open} open · {today} today" when workloadFailed is false', () => {
    const team: TeamMember[] = [
      { id: 'a', name: 'Brandon', isCurrentUser: true, workload: { open: 3, today: 1 } },
      { id: 'b', name: 'Diana', isCurrentUser: false, workload: { open: 5, today: 2 } },
    ]
    render(
      <TechSelector currentUserId="a" team={team} selectedId={null} onChange={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.getByText(/3 open/i)).toBeInTheDocument()
    expect(screen.getByText(/1 today/i)).toBeInTheDocument()
    expect(screen.getByText(/5 open/i)).toBeInTheDocument()
    expect(screen.getByText(/2 today/i)).toBeInTheDocument()
  })

  it('does NOT render workload badges when workloadFailed is true', () => {
    const team: TeamMember[] = [
      { id: 'a', name: 'Brandon', isCurrentUser: true, workload: { open: 3, today: 1 } },
      { id: 'b', name: 'Diana', isCurrentUser: false, workload: { open: 5, today: 2 } },
    ]
    render(
      <TechSelector
        currentUserId="a"
        team={team}
        workloadFailed
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.queryByText(/\d+ open/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ today/i)).not.toBeInTheDocument()
  })

  it('tints the open number with the .ts__badge--busy class when open >= 5', () => {
    const team: TeamMember[] = [
      { id: 'a', name: 'Brandon', isCurrentUser: true, workload: { open: 5, today: 0 } },
      { id: 'b', name: 'Diana', isCurrentUser: false, workload: { open: 4, today: 0 } },
    ]
    render(
      <TechSelector currentUserId="a" team={team} selectedId={null} onChange={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    const brandonBadge = screen.getByText(/5 open/i).closest('.ts__badge')
    const dianaBadge = screen.getByText(/4 open/i).closest('.ts__badge')
    expect(brandonBadge).toHaveClass('ts__badge--busy')
    expect(dianaBadge).not.toHaveClass('ts__badge--busy')
  })
})
```

- [ ] **Step 2: Run tests, confirm five new failures**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: five new failures.

- [ ] **Step 3: Add search state + workload rendering to the component**

Edit `components/vt/tech-selector/index.tsx`. Inside the component body, after the existing `useState`:

```tsx
  const [query, setQuery] = useState('')

  const showSearch = team.length > 5
  const filteredTeam = showSearch && query.trim() !== ''
    ? team.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()))
    : team
```

Replace the `<ul>` block with a richer version that includes the search input and the workload badges. (Note: `workloadFailed` was a placeholder underscore-prefix import — un-rename it now.)

Inside the `{open && (...)}` block:

```tsx
      {open && (
        <div className="ts__popover">
          {showSearch && (
            <div className="ts__search">
              <input
                type="search"
                role="searchbox"
                className="ts__search-input"
                placeholder="Filter techs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="ts__search-count">
                {filteredTeam.length} of {team.length}
              </span>
            </div>
          )}
          <span className="ts__eyebrow">Assigning to</span>
          <ul id={listboxId} className="ts__list" role="listbox">
            {filteredTeam.map((m) => (
              <li
                key={m.id}
                role="option"
                aria-selected={selectedId === m.id}
                className={`ts__row${selectedId === m.id ? ' ts__row--selected' : ''}`}
                onClick={() => commit(m.id)}
              >
                <span className="ts__avatar" aria-hidden="true">{initials(m.name)}</span>
                <span className="ts__name">{m.name}</span>
                {m.isCurrentUser && <span className="ts__tag">You</span>}
                {!workloadFailed && m.workload && (
                  <span
                    className={`ts__badge${m.workload.open >= 5 ? ' ts__badge--busy' : ''}`}
                  >
                    <span className="ts__badge-num">{m.workload.open}</span> open
                    <span className="ts__badge-sep" aria-hidden="true">·</span>
                    <span className="ts__badge-num">{m.workload.today}</span> today
                  </span>
                )}
              </li>
            ))}
            {selectedId !== null && (
              <li
                role="option"
                aria-selected="false"
                aria-label="Clear assignment, return to open queue"
                className="ts__row ts__row--clear"
                onClick={() => commit(null)}
              >
                <span className="ts__name">× Clear · Open queue</span>
              </li>
            )}
          </ul>
        </div>
      )}
```

Also: change the props destructure at the top to NOT prefix `workloadFailed` with underscore:

```tsx
export function TechSelector(props: TechSelectorProps) {
  const { team, selectedId, onChange, workloadFailed = false } = props
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: 13 tests green (3 + 5 + 5).

- [ ] **Step 5: Commit**

```bash
git add components/vt/tech-selector/index.tsx tests/unit/tech-selector.test.tsx
git commit -m "feat(intake): TechSelector search filter + workload badges + soft-fail"
```

---

## Task 8: `<TechSelector>` keyboard map + ARIA polish

**Files:**
- Modify: `components/vt/tech-selector/index.tsx`
- Extend: `tests/unit/tech-selector.test.tsx`

- [ ] **Step 1: Add failing tests for keyboard navigation**

Append to `tests/unit/tech-selector.test.tsx`:

```tsx
describe('TechSelector — keyboard', () => {
  const TEAM = [
    mem('a', 'Brandon', true),
    mem('b', 'Diana'),
    mem('c', 'Marcus'),
  ]

  it('opens on Enter from the trigger and focuses the first row', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // aria-activedescendant should point to the first option.
    const options = screen.getAllByRole('option')
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[0].id)
  })

  it('opens on Space from the trigger', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves focus with ArrowDown and wraps at the bottom', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const options = screen.getAllByRole('option')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[1].id)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[2].id)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[0].id) // wrap
  })

  it('moves focus with ArrowUp and wraps at the top', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const options = screen.getAllByRole('option')
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[options.length - 1].id)
  })

  it('commits the activedescendant on Enter and closes the popover', () => {
    const onChange = vi.fn()
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={onChange} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })       // open
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })   // focus row 'b'
    fireEvent.keyDown(trigger, { key: 'Enter' })       // commit
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests, confirm five new failures**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: five new failures (no keyboard yet beyond Escape).

- [ ] **Step 3: Implement keyboard navigation**

Edit `components/vt/tech-selector/index.tsx`. Add `activeIndex` state and a richer `onTriggerKeyDown`.

After the existing `[query, setQuery]`:

```tsx
  const [activeIndex, setActiveIndex] = useState(0)

  // Reset active index whenever the popover opens or the filtered list changes.
  useEffect(() => {
    if (open) setActiveIndex(0)
  }, [open])
```

Compute row IDs (they must be stable per render so `aria-activedescendant` can point at them):

```tsx
  const optionIdOf = (memberId: string) => `${listboxId}-opt-${memberId}`
```

Replace the existing `onTriggerKeyDown` with:

```tsx
  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    // open === true
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % filteredTeam.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + filteredTeam.length) % filteredTeam.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const m = filteredTeam[activeIndex]
      if (m) commit(m.id)
      return
    }
  }
```

Set `aria-activedescendant` on the trigger:

```tsx
      <button
        type="button"
        className="ts__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && filteredTeam[activeIndex] ? optionIdOf(filteredTeam[activeIndex].id) : undefined
        }
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
```

Add `id` to each `<li>` so `aria-activedescendant` can refer to it:

```tsx
            {filteredTeam.map((m) => (
              <li
                key={m.id}
                id={optionIdOf(m.id)}
                role="option"
                aria-selected={selectedId === m.id}
                className={`ts__row${selectedId === m.id ? ' ts__row--selected' : ''}${
                  filteredTeam[activeIndex]?.id === m.id ? ' ts__row--active' : ''
                }`}
                onClick={() => commit(m.id)}
                onMouseEnter={() => setActiveIndex(filteredTeam.indexOf(m))}
              >
```

- [ ] **Step 4: Run tests, verify all 18 pass**

Run: `pnpm test tests/unit/tech-selector.test.tsx`

Expected: 18 green.

- [ ] **Step 5: Commit**

```bash
git add components/vt/tech-selector/index.tsx tests/unit/tech-selector.test.tsx
git commit -m "feat(intake): TechSelector keyboard nav (↑↓↩ Esc) + aria-activedescendant"
```

---

## Task 9: Port CSS from the design handoff

**Files:**
- Modify: `components/vt/tech-selector/tech-selector.css`

This task is manual-verification heavy. The handoff CSS file is the source of truth; we re-write rather than copy literally because of the token rename gotcha.

- [ ] **Step 1: Read the handoff CSS**

Run: `cat designs/design_handoff_tech_selector/tech-selector.css`

Read the entire file. Note the token names used (`--vt-amber-*` is the one that needs renaming).

- [ ] **Step 2: Find the project's signal token names**

Run: `grep -n "\\-\\-vt-signal" app/globals.css | head -20`

Expected: identifies the actual token names used in the repo (e.g. `--vt-signal-500`).

Per CLAUDE.md memory `feedback_design_walkthroughs_plain_english.md` and the prior PR #27 (predictive search), the convention is: design handoff says `--vt-amber-*`, repo uses `--vt-signal-*` — rename during port.

- [ ] **Step 3: Port the CSS into `components/vt/tech-selector/tech-selector.css`**

Replace the stub with the ported styles. Apply these transforms during the port:
- `--vt-amber-*` → `--vt-signal-*` (e.g. `--vt-amber-500` → `--vt-signal-500`).
- Component class prefix stays `.ts__*` (matches the JSX written in Tasks 5-8).
- Keep ALL pixel sizes, opacities, and shadow definitions as-written in the handoff CSS — those are locked.
- Drop any Direction B (`.ts--field`) styles. We're only shipping Direction A.
- Drop the `.ts__solo--field` variant — Direction A's solo variant uses `.ts ts--solo` only.
- Drop the `⌘ T` kbd-chip styles — Direction A has no shortcut.

Add a `.ts__badge-num` rule that flips text color when the parent has `.ts__badge--busy`:

```css
.ts__badge--busy .ts__badge-num {
  color: var(--vt-signal-500);
}
```

- [ ] **Step 4: Start the dev server and manually verify the design**

Run (background): `pnpm dev`

Open: http://localhost:3000/intake (after Task 10 wires the selector in)

Until Task 10 lands, you can pre-view the styles by adding a temporary import + render to a throwaway design page. Skip if it's easier to verify after Task 10.

- [ ] **Step 5: Commit**

```bash
git add components/vt/tech-selector/tech-selector.css
git commit -m "style(intake): port TechSelector CSS from handoff (amber→signal token rename)"
```

---

## Task 10: Wire `<TechSelector>` into `CounterIntake` + intake page server fetch

**Files:**
- Modify: `app/(app)/intake/page.tsx`
- Modify: `components/screens/counter-intake.tsx`
- Extend: `tests/unit/counter-intake.test.tsx`

- [ ] **Step 1: Add failing tests to `tests/unit/counter-intake.test.tsx`**

Append to the existing `describe('CounterIntake', () => {`:

```tsx
  function team(...members: Array<{ id: string; name: string; isCurrentUser?: boolean }>) {
    return members.map((m) => ({
      id: m.id,
      name: m.name,
      isCurrentUser: m.isCurrentUser ?? false,
      workload: { open: 0, today: 0 },
    }))
  }

  it('renders the inert "You · only tech" pill when team has one member', () => {
    render(
      <CounterIntake
        userEmail="brandon@example.com"
        team={team({ id: 'a', name: 'Brandon', isCurrentUser: true })}
        workloadFailed={false}
      />,
    )
    const pill = screen.getByRole('group', { name: /assigned to/i })
    expect(pill).toHaveAttribute('aria-disabled', 'true')
  })

  it('omits assignedTechId from the submit body when nothing is picked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <CounterIntake
        userEmail="brandon@example.com"
        team={team(
          { id: 'a', name: 'Brandon', isCurrentUser: true },
          { id: 'b', name: 'Diana' },
        )}
        workloadFailed={false}
      />,
    )
    // Fill required fields and submit.
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'C' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText(/make/i), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'Y' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), { target: { value: 'noise' } })
    fireEvent.submit(screen.getByRole('button', { name: /create repair order/i }).closest('form')!)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })
    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse(init!.body as string) as { assignedTechId?: string | null }
    expect(body.assignedTechId).toBeNull()
  })

  it('includes the picked assignedTechId in the submit body when a tech is picked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <CounterIntake
        userEmail="brandon@example.com"
        team={team(
          { id: 'a', name: 'Brandon', isCurrentUser: true },
          { id: 'b', name: 'Diana' },
        )}
        workloadFailed={false}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    fireEvent.click(screen.getByRole('option', { name: /diana/i }))

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'C' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2020' } })
    fireEvent.change(screen.getByLabelText(/make/i), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'Y' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), { target: { value: 'noise' } })
    fireEvent.submit(screen.getByRole('button', { name: /create repair order/i }).closest('form')!)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })
    const [, init] = fetchSpy.mock.calls[0]
    const body = JSON.parse(init!.body as string) as { assignedTechId?: string | null }
    expect(body.assignedTechId).toBe('b')
  })
```

Existing tests in this file pass `team` undefined. After the wiring, `team` must be an optional prop that defaults to a single-member solo team using the current user — OR — the tests must pass a team. Cleaner: make `team` required from the page side, but optional in the type signature with a default for tests. Pick: keep `team` optional with default `[]`, and have the component render no pill when `team` is empty. That keeps existing tests untouched.

Update the existing test that only passes `userEmail` accordingly:
- If `team` defaults to `[]`, no pill renders, existing tests stay green.
- If you want the existing tests to also verify the pill, pass `team` explicitly. **Recommendation: do not change existing tests; just default `team={[]}` to mean "hide pill".**

- [ ] **Step 2: Run tests, confirm three new failures**

Run: `pnpm test tests/unit/counter-intake.test.tsx`

Expected: three new failures + all existing tests still passing.

- [ ] **Step 3: Modify `CounterIntake` to accept team + render the selector**

Edit `components/screens/counter-intake.tsx`:

At the top, alongside existing imports:

```tsx
import { TechSelector, type TeamMember } from '@/components/vt/tech-selector'
```

Extend the props:

```tsx
export function CounterIntake({
  userEmail,
  recentCustomers = [],
  team = [],
  workloadFailed = false,
}: {
  userEmail?: string
  recentCustomers?: RecentCustomer[]
  team?: TeamMember[]
  workloadFailed?: boolean
}) {
```

Add state for the assignment:

```tsx
  const [assignedTechId, setAssignedTechId] = useState<string | null>(null)
```

In the submit body, in BOTH branches (pick-existing and manual), add `assignedTechId`:

```tsx
    const body: IntakeBody = isPickExisting
      ? {
          existingVehicleId: pickedVehicleId!,
          assignedTechId,  // NEW
          vehicle: { ... },
          complaint: { ... },
        }
      : {
          assignedTechId,  // NEW
          customer: { ... },
          vehicle: { ... },
          complaint: { ... },
        }
```

Also extend the `IntakeBody` type at top of file:

```tsx
type IntakeBody = {
  existingVehicleId?: string
  assignedTechId?: string | null    // NEW
  customer?: { name: string; phone: string; email: string }
  // ... rest unchanged
}
```

In `MainHeader`, add `eyebrowSlot` when the team has members. The current user id needs to come from somewhere — use the first `isCurrentUser` team member's id, or pass it down separately. Cleanest: derive from team itself.

```tsx
  const currentUserId = team.find((m) => m.isCurrentUser)?.id ?? ''

  // ...

  <MainHeader
    eyebrow="New work order"
    eyebrowSlot={
      team.length > 0 && currentUserId ? (
        <TechSelector
          currentUserId={currentUserId}
          team={team}
          workloadFailed={workloadFailed}
          selectedId={assignedTechId}
          onChange={setAssignedTechId}
        />
      ) : undefined
    }
    title="Who's at the counter?"
    sub="Search to find an existing customer or vehicle, or fill in the form below."
    actions={...}
  />
```

- [ ] **Step 4: Modify the server component to fetch team alongside recentCustomers**

Edit `app/(app)/intake/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { getShopTeam } from '@/lib/intake/team'
import { CounterIntake } from '@/components/screens/counter-intake'

export default async function IntakePage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const [recentCustomers, team] = await Promise.all([
    ctx.profile.shopId
      ? getRecentIntakeCustomers({ db, shopId: ctx.profile.shopId, withinHours: 12, limit: 8 })
      : Promise.resolve([]),
    ctx.profile.shopId
      ? getShopTeam({ db, shopId: ctx.profile.shopId, currentUserId: ctx.profile.id })
      : Promise.resolve({ members: [], workloadFailed: false }),
  ])

  return (
    <CounterIntake
      userEmail={ctx.user.email}
      recentCustomers={recentCustomers}
      team={team.members}
      workloadFailed={team.workloadFailed}
    />
  )
}
```

- [ ] **Step 5: Run tests, verify all pass**

Run: `pnpm test tests/unit/counter-intake.test.tsx tests/unit/intake-submit-route.test.ts tests/unit/intake-submit-pick-existing.test.ts`

Expected: all green.

Also run the full suite once to catch wider regressions:

Run: `pnpm test`

Expected: all green (rerun once if the PGlite cold-start flake hits).

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/intake/page.tsx components/screens/counter-intake.tsx tests/unit/counter-intake.test.tsx
git commit -m "feat(intake): wire TechSelector into CounterIntake + page server fetch"
```

---

## Task 11: Phone bottom-sheet polish

**Files:**
- Modify: `components/vt/tech-selector/tech-selector.css`

This task is CSS-only. The component already renders identical markup on every viewport; the bottom-sheet behavior comes from CSS media queries that re-position the popover as a fixed bottom sheet under 768 px.

- [ ] **Step 1: Read the handoff phone-sheet styles**

Run: `cat designs/design_handoff_tech_selector/tech-selector.css | grep -A 30 "@media"`

- [ ] **Step 2: Port the `@media (max-width: 767px)` block**

Append to `components/vt/tech-selector/tech-selector.css`:

```css
@media (max-width: 767px) {
  .ts__popover {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-height: 80vh;
    border-radius: 10px 10px 0 0;
    /* …other styles per handoff */
  }
  /* Scrim, handle bar, larger tap targets — copy from handoff */
}
```

Apply the same `--vt-amber-*` → `--vt-signal-*` rename.

- [ ] **Step 3: Test on the dev server, phone-width viewport**

Run (background): `pnpm dev`

Open Chrome DevTools → device emulation → iPhone 14 Pro. Navigate to `http://localhost:3000/intake`. Tap the pill. The popover should rise from the bottom as a sheet with a scrim above the form.

- [ ] **Step 4: Commit**

```bash
git add components/vt/tech-selector/tech-selector.css
git commit -m "style(intake): TechSelector phone bottom-sheet variant"
```

---

## Task 12: Manual Vercel preview verification + handoff to Brandon

**Files:**
- None — this is a verification + push task.

- [ ] **Step 1: Run the full test suite + typecheck**

Run: `pnpm test && npx tsc --noEmit`

Expected: all green. Both must pass before pushing.

- [ ] **Step 2: Push the feature branch to origin**

Run: `git push -u origin feat/intake-tech-selector`

This creates the remote branch + spins up a Vercel preview deployment. Capture the preview URL once the GitHub Actions / Vercel checks complete.

- [ ] **Step 3: Open a draft PR for review**

Run:

```bash
gh pr create --draft \
  --title "feat(intake): optional tech selector pill (Direction A · open queue default)" \
  --body "$(cat <<'EOF'
## Summary
- Adds optional tech selector to `/intake` form header (inline pill in `MainHeader.eyebrowSlot`).
- Default UX label "Open queue"; submit silently falls back to advisor when nothing is picked — no schema migration.
- Workload badge per row (`{open} open · {today} today`), amber tint at open ≥ 5, soft-fail on workload query.
- Solo-shop case renders inert "You · only tech" pill.

Spec: `docs/superpowers/specs/2026-05-12-tech-selector-design.md`

## Test plan
- [ ] Logic suite: `pnpm test` all green (advisor-fallback, cross-shop guard, workload soft-fail, component states)
- [ ] Vercel preview — solo case: pill reads "You · only tech", inert, submit lands on Brandon's Today as before
- [ ] Vercel preview — multi-tech case (after seeding a second profile via Supabase MCP `BEGIN; …; ROLLBACK;` rehearsal): pill opens, search appears past 5, pick → submit → session shows on the picked tech's Today
- [ ] Vercel preview — workload soft-fail: badges absent, selector still works
- [ ] Phone viewport (Chrome DevTools): bottom sheet rises from floor with scrim

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Hand off to Brandon for personal validation on the preview URL**

Surface the preview URL to Brandon. Walk through the four manual checks (solo, multi-tech, soft-fail, phone). Per CLAUDE.md `feedback_verification_rigor.md`, fixes aren't "fixed" until proven on the real authed user-facing surface. Brandon merges via the GitHub UI once he's satisfied — no auto-merge.

---

## Self-review

### Spec coverage

- ✅ Direction A pill in MainHeader eyebrow — Task 4 (slot) + Task 5 (component) + Task 10 (wiring)
- ✅ Open queue resting state — Task 5
- ✅ Picked-tech display — Task 5
- ✅ Solo-shop inert variant — Task 5
- ✅ Popover open/close + click outside — Task 6
- ✅ Listbox + pick — Task 6
- ✅ Clear row — Task 6
- ✅ Search past 5 — Task 7
- ✅ Workload badges + amber-at-≥5 tint — Task 7
- ✅ Soft-fail (badges hidden) — Task 7
- ✅ Keyboard map (↑↓↩ Esc, Space) — Task 8
- ✅ `aria-activedescendant` — Task 8
- ✅ Phone bottom sheet — Task 11
- ✅ `getShopTeam` helper — Task 3
- ✅ `assignedTechId` fallback in `createSessionFromIntake` — Task 1
- ✅ `/api/intake/submit` parse + validate + cross-shop guard — Task 2
- ✅ Wire-up — Task 10
- ✅ Manual verification — Task 12

No gaps.

### Type consistency check

- `TeamMember` shape used in Tasks 3, 5, 6, 7, 8, 10 — all match the same fields: `{ id, name, isCurrentUser, workload? }`.
- `TechSelectorProps` shape used in Tasks 5-8 — `{ currentUserId, team, workloadFailed?, selectedId, onChange }` — consistent.
- `getShopTeam` return type `{ members, workloadFailed }` used in Task 3 + Task 10 — consistent.
- `assignedTechId` field name used in `IntakeBody` (Task 2), `CreateSessionFromIntakeInput` (Task 1), `CounterIntake` state + submit body (Task 10), test fixtures (Tasks 1, 2) — all `string | null | undefined`.

No mismatches.

### Placeholder scan

- No TBDs, no "implement later", no "similar to Task N", no "appropriate error handling".
- Every code step shows the actual code.
- Test cases include expected assertions.
- Commit messages spelled out per task.

No placeholders found.
