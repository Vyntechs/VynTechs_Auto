# Intake Customer-Select Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the predictive-search customer-pick flow so clicking a customer routes by vehicle count (0 → create-new, 1 → autopick, 2+ → tier) instead of silently dropping to manual entry; also fix the tier's "Add another vehicle for this customer" CTA to preserve customer prefill.

**Architecture:** Server side embeds each customer's vehicle list (capped at 10 most-recent) directly into `CustomerHit` and `RecentCustomer` via a batched `inArray` post-query. Client side rewrites the `pickCustomer` handler in `components/vt/intake-search/index.tsx` to route on `customer.vehicles.length`, eliminating dependency on the global `state.vehicles` results array. The tier's mouse-click "Add another vehicle" path now matches the keyboard Enter path (customer-prefilled `onCreateNew`).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM 0.45 with `inArray`, Vitest 4 + PGlite for DB tests, React Testing Library 16 + happy-dom for component tests.

**Spec:** `docs/superpowers/specs/2026-05-12-intake-customer-select-fix-design.md`

---

## File structure

**Modified:**

| Path | Change |
|---|---|
| `lib/intake/search.ts` | Add `CustomerVehicle` type, extend `CustomerHit` with `vehicles: CustomerVehicle[]`, add post-query batched vehicles fetch |
| `lib/intake/recent-customers.ts` | Add `vehicles: CustomerVehicle[]` to `RecentCustomer`, same post-query strategy, re-export `CustomerVehicle` |
| `components/vt/intake-search/index.tsx` | Rewrite `pickCustomer` to route on `c.vehicles.length`; change tier prop wiring so "Add another vehicle" calls customer-prefilled `onCreateNew` instead of `fireCreateNew` |
| `components/vt/intake-search/dropdown.tsx` | `DropdownWhichVehicle` prop type widens from `VehicleHit[]` to `CustomerVehicle[]` (shape subset). No JSX change. |
| `tests/unit/intake-search-query.test.ts` | New cases for embedded vehicles + cap |
| `tests/unit/intake-recent-customers.test.ts` | New case for embedded vehicles |
| `tests/unit/intake-search-component.test.tsx` | New cases for the customer-pick routing + tier "Add another vehicle" |

**Created:** None.

---

## Task ordering

```
Task 1 (server: searchIntake vehicles)           [independent]
Task 2 (server: getRecentIntakeCustomers vehicles) [independent]
Task 3 (client: pickCustomer + tier fix)         [requires Task 1 + 2]
Task 4 (manual Vercel preview verification)      [requires Task 3]
```

Tasks 1 + 2 can run in parallel (independent files). Task 3 requires both. Task 4 is the verification + push gate.

---

## Task 1: Server — `searchIntake` embeds `vehicles` in `CustomerHit`

**Files:**
- Modify: `lib/intake/search.ts`
- Modify: `tests/unit/intake-search-query.test.ts`

- [ ] **Step 1: Read the existing test file's seed pattern**

Run: `head -80 tests/unit/intake-search-query.test.ts`

Confirm: it seeds a shop, customers, vehicles, sessions via PGlite. You'll mirror this pattern for the new cases.

- [ ] **Step 2: Add the failing tests**

Append to `tests/unit/intake-search-query.test.ts` inside the existing `describe`:

```typescript
  it('embeds an empty vehicles array when the matched customer has 0 vehicles', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    await db.insert(customers).values({
      shopId: shop.id, name: 'Solo Customer', phone: '555-9001', email: null,
    })

    const result = await searchIntake({ db, shopId: shop.id, q: 'Solo' })

    expect(result.customers).toHaveLength(1)
    expect(result.customers[0].vehicles).toEqual([])
    expect(result.customers[0].vehicleCount).toBe(0)
  })

  it('embeds the customer\'s vehicles ordered by last_visit DESC, capped at 10', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    const [c] = await db.insert(customers).values({
      shopId: shop.id, name: 'Multi Customer', phone: '555-9002', email: null,
    }).returning()

    // Seed 12 vehicles. We'll write 12 sessions, each newer than the last,
    // tied to vehicles in a known order so we can assert top-10 by recency.
    const vehiclesSeed = []
    for (let i = 0; i < 12; i += 1) {
      const [v] = await db.insert(vehicles).values({
        customerId: c.id, year: 2010 + i, make: 'Ford', model: `M${i}`,
      }).returning()
      vehiclesSeed.push(v)
    }
    const emptyTree = { nodes: [], currentNodeId: '', message: '' }
    const intake = { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'M0', customerComplaint: 'noise' }
    // Session times: v0 oldest, v11 newest. Use 1-day spacing.
    for (let i = 0; i < 12; i += 1) {
      const createdAt = new Date(Date.now() - (12 - i) * 86_400_000)
      await db.insert(sessions).values({
        shopId: shop.id,
        techId: c.id, // any UUID works for FK constraint in PGlite — but we need a real profile
        // ... fix this below
      })
    }
    // ... see "tech profile FK" note before this test
  })
```

> **Note on the sessions tech_id FK:** `sessions.tech_id` references `profiles.id` with NOT NULL. To seed sessions you need a profile in the same shop. Mirror the helper from `tests/unit/intake-recent-customers.test.ts:43` which does this dance — or extract a small `seedProfile` helper. For simplicity in this test, seed ONE profile and reuse its id for `techId` across all 12 sessions.

Rewrite the second test cleanly:

```typescript
  it('embeds the customer\'s vehicles ordered by last_visit DESC, capped at 10', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    const [profile] = await db.insert(profiles).values({
      userId: '00000000-0000-0000-0000-000000000099',
      role: 'tech', shopId: shop.id, fullName: 'Tester',
    }).returning()
    const [c] = await db.insert(customers).values({
      shopId: shop.id, name: 'Multi Customer', phone: '555-9002', email: null,
    }).returning()

    const seededVehicleIds: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const [v] = await db.insert(vehicles).values({
        customerId: c.id, year: 2010 + i, make: 'Ford', model: `M${i}`,
      }).returning()
      seededVehicleIds.push(v.id)
    }
    const emptyTree = { nodes: [], currentNodeId: '', message: '' }
    const intakePayload = {
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'M0', customerComplaint: 'noise',
    }
    // v0 oldest, v11 newest.
    for (let i = 0; i < 12; i += 1) {
      const createdAt = new Date(Date.now() - (12 - i) * 86_400_000)
      await db.insert(sessions).values({
        shopId: shop.id,
        techId: profile.id,
        vehicleId: seededVehicleIds[i],
        status: 'open',
        intake: intakePayload,
        treeState: emptyTree,
        createdAt,
      })
    }

    const result = await searchIntake({ db, shopId: shop.id, q: 'Multi' })

    expect(result.customers).toHaveLength(1)
    expect(result.customers[0].vehicleCount).toBe(12)
    expect(result.customers[0].vehicles).toHaveLength(10)
    // Most-recent first: v11 → v10 → ... → v2 (top 10).
    expect(result.customers[0].vehicles[0].id).toBe(seededVehicleIds[11])
    expect(result.customers[0].vehicles[9].id).toBe(seededVehicleIds[2])
    // The two oldest (v0, v1) are dropped.
    expect(result.customers[0].vehicles.map((v) => v.id)).not.toContain(seededVehicleIds[0])
    expect(result.customers[0].vehicles.map((v) => v.id)).not.toContain(seededVehicleIds[1])
  })

  it('returns vehicles array even when the customer has no sessions yet', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    const [c] = await db.insert(customers).values({
      shopId: shop.id, name: 'Fresh Customer', phone: '555-9003', email: null,
    }).returning()
    await db.insert(vehicles).values([
      { customerId: c.id, year: 2018, make: 'Honda', model: 'Civic' },
      { customerId: c.id, year: 2020, make: 'Honda', model: 'Accord' },
    ])

    const result = await searchIntake({ db, shopId: shop.id, q: 'Fresh' })

    expect(result.customers[0].vehicles).toHaveLength(2)
    // Both have null last_visit → order falls back to year DESC.
    expect(result.customers[0].vehicles[0].year).toBe(2020)
    expect(result.customers[0].vehicles[1].year).toBe(2018)
  })

  it('embedded vehicle shape matches CustomerVehicle (id, year, make, model, engine, vin, plate, mileage, lastVisit)', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    const [c] = await db.insert(customers).values({
      shopId: shop.id, name: 'Shape Customer', phone: '555-9004', email: null,
    }).returning()
    await db.insert(vehicles).values({
      customerId: c.id,
      year: 2019, make: 'BMW', model: '335i', engine: 'N55',
      vin: '1FTEW1EP5JFC10001', plate: 'ABC123', mileage: 84000,
    })

    const result = await searchIntake({ db, shopId: shop.id, q: 'Shape' })
    const v = result.customers[0].vehicles[0]
    expect(v.id).toBeTruthy()
    expect(v.year).toBe(2019)
    expect(v.make).toBe('BMW')
    expect(v.model).toBe('335i')
    expect(v.engine).toBe('N55')
    expect(v.vin).toBe('1FTEW1EP5JFC10001')
    expect(v.plate).toBe('ABC123')
    expect(v.mileage).toBe(84000)
    expect(v.lastVisit).toBeNull()
    // CustomerVehicle does NOT have ownerId / ownerName — those are on VehicleHit.
    // @ts-expect-error — confirm at compile-time that ownerId is not on the type
    expect(v.ownerId).toBeUndefined()
  })
```

Required imports at the top of the file (add if missing): `import { profiles } from '@/lib/db/schema'` (it may already be there from the existing tests — check first).

- [ ] **Step 3: Run the tests, confirm 4 new failures**

Run: `pnpm test tests/unit/intake-search-query.test.ts`

Expected: 4 new failures, all complaining about `result.customers[0].vehicles` being `undefined` (since the type doesn't have that field yet). The `@ts-expect-error` may flip to an unused-directive warning — fine, it'll be valid once the type lands in Step 4.

- [ ] **Step 4: Add the `CustomerVehicle` type and extend `CustomerHit`**

Edit `lib/intake/search.ts`. At the top, add the new type alongside the existing ones:

```typescript
export type CustomerVehicle = {
  id: string
  year: number | null
  make: string | null
  model: string | null
  engine: string | null
  vin: string | null
  plate: string | null
  mileage: number | null
  lastVisit: Date | null
}

export type CustomerHit = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  vehicles: CustomerVehicle[]   // NEW
  lastVisit: Date | null
}
```

Add `inArray` to the imports:

```typescript
import { and, desc, eq, ilike, inArray, like, or, sql } from 'drizzle-orm'
```

- [ ] **Step 5: Implement the post-query vehicle fetch + grouping**

Edit `lib/intake/search.ts`. After `customerRows` is built (around line 82) and before the `// ----- Vehicles -----` block, insert:

```typescript
  // ----- Embedded vehicles per customer (capped at 10 most-recent) -----
  const customerIds = customerRows.map((c) => c.id)
  const vehiclesByCustomer = new Map<string, CustomerVehicle[]>()
  if (customerIds.length > 0) {
    const embeddedLastVisitExpr = sql<Date | null>`(
      SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} = ${vehicles.id}
    )`
    const embeddedRows = await opts.db
      .select({
        customerId: vehicles.customerId,
        id: vehicles.id,
        year: vehicles.year,
        make: vehicles.make,
        model: vehicles.model,
        engine: vehicles.engine,
        vin: vehicles.vin,
        plate: vehicles.plate,
        mileage: vehicles.mileage,
        lastVisit: embeddedLastVisitExpr.as('embedded_last_visit'),
      })
      .from(vehicles)
      .where(inArray(vehicles.customerId, customerIds))
      .orderBy(
        vehicles.customerId,
        desc(sql`COALESCE(${embeddedLastVisitExpr}, TIMESTAMP 'epoch')`),
        desc(vehicles.year),
        vehicles.id,
      )

    for (const row of embeddedRows) {
      const bucket = vehiclesByCustomer.get(row.customerId) ?? []
      if (bucket.length < 10) {
        bucket.push({
          id: row.id,
          year: row.year,
          make: row.make,
          model: row.model,
          engine: row.engine,
          vin: row.vin,
          plate: row.plate,
          mileage: row.mileage,
          lastVisit:
            row.lastVisit instanceof Date
              ? row.lastVisit
              : row.lastVisit
                ? new Date(row.lastVisit as unknown as string)
                : null,
        })
      }
      vehiclesByCustomer.set(row.customerId, bucket)
    }
  }
```

Then in the final `return` block, update the `customers` mapping to include `vehicles`:

```typescript
    customers: customerRows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      vehicleCount: Number(c.vehicleCount),
      vehicles: vehiclesByCustomer.get(c.id) ?? [],   // NEW
      lastVisit:
        c.lastVisit instanceof Date
          ? c.lastVisit
          : c.lastVisit
            ? new Date(c.lastVisit as unknown as string)
            : null,
    })),
```

- [ ] **Step 6: Run the tests, verify all 4 new + existing pass**

Run: `pnpm test tests/unit/intake-search-query.test.ts`

Expected: all green. If the PGlite cold-start flake hits, rerun once (CLAUDE.md `feedback_vitest_pglite_flake.md`).

- [ ] **Step 7: Commit**

```bash
git add lib/intake/search.ts tests/unit/intake-search-query.test.ts
git commit -m "feat(intake-search): embed top-10 vehicles per customer hit"
```

---

## Task 2: Server — `getRecentIntakeCustomers` embeds `vehicles` in `RecentCustomer`

**Files:**
- Modify: `lib/intake/recent-customers.ts`
- Modify: `tests/unit/intake-recent-customers.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/intake-recent-customers.test.ts` inside the existing `describe`:

```typescript
  it('embeds the customer\'s vehicles (capped at 10) on each recent row', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    const [profile] = await db.insert(profiles).values({
      userId: '00000000-0000-0000-0000-000000000099',
      role: 'tech', shopId: shop.id, fullName: 'Tester',
    }).returning()
    const [c] = await db.insert(customers).values({
      shopId: shop.id, name: 'Multi Customer', phone: '555-9100', email: null,
    }).returning()

    // Seed 3 vehicles, all visited within the recents window.
    const seededVehicleIds: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const [v] = await db.insert(vehicles).values({
        customerId: c.id, year: 2018 + i, make: 'Ford', model: `M${i}`,
      }).returning()
      seededVehicleIds.push(v.id)
    }
    const emptyTree = { nodes: [], currentNodeId: '', message: '' }
    const intakePayload = {
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'M0', customerComplaint: 'noise',
    }
    for (let i = 0; i < 3; i += 1) {
      // 1, 2, 3 hours ago — newest = i=2 (v2).
      const createdAt = new Date(Date.now() - (3 - i) * 3600_000)
      await db.insert(sessions).values({
        shopId: shop.id,
        techId: profile.id,
        vehicleId: seededVehicleIds[i],
        status: 'open',
        intake: intakePayload,
        treeState: emptyTree,
        createdAt,
      })
    }

    const result = await getRecentIntakeCustomers({
      db, shopId: shop.id, withinHours: 12, limit: 8,
    })

    expect(result).toHaveLength(1)
    expect(result[0].vehicleCount).toBe(3)
    expect(result[0].vehicles).toHaveLength(3)
    expect(result[0].vehicles[0].id).toBe(seededVehicleIds[2]) // newest
    expect(result[0].vehicles[2].id).toBe(seededVehicleIds[0]) // oldest
  })
```

The existing tests in this file should already have helpers + imports for shops/customers/vehicles/sessions/profiles. If `profiles` isn't imported yet, add: `import { profiles } from '@/lib/db/schema'`.

- [ ] **Step 2: Run the test, confirm failure**

Run: `pnpm test tests/unit/intake-recent-customers.test.ts`

Expected: the new test fails on `result[0].vehicles` being undefined.

- [ ] **Step 3: Implement the vehicle embedding**

Edit `lib/intake/recent-customers.ts`:

Add `inArray` to imports and `CustomerVehicle` from the search module:

```typescript
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { customers, sessions, vehicles } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import type { CustomerVehicle } from './search'

export type { CustomerVehicle } // re-export for callers
```

Update `RecentCustomer`:

```typescript
export type RecentCustomer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  vehicles: CustomerVehicle[]   // NEW
  lastVisit: Date
}
```

Inside `getRecentIntakeCustomers`, after the existing `rows` query and before the `return rows.map(...)`:

```typescript
  // Embed top-10 most-recent vehicles per recent customer.
  const customerIds = rows.map((r) => r.id)
  const vehiclesByCustomer = new Map<string, CustomerVehicle[]>()
  if (customerIds.length > 0) {
    const embeddedLastVisitExpr = sql<Date | null>`(
      SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} = ${vehicles.id}
    )`
    const embeddedRows = await opts.db
      .select({
        customerId: vehicles.customerId,
        id: vehicles.id,
        year: vehicles.year,
        make: vehicles.make,
        model: vehicles.model,
        engine: vehicles.engine,
        vin: vehicles.vin,
        plate: vehicles.plate,
        mileage: vehicles.mileage,
        lastVisit: embeddedLastVisitExpr.as('embedded_last_visit'),
      })
      .from(vehicles)
      .where(inArray(vehicles.customerId, customerIds))
      .orderBy(
        vehicles.customerId,
        desc(sql`COALESCE(${embeddedLastVisitExpr}, TIMESTAMP 'epoch')`),
        desc(vehicles.year),
        vehicles.id,
      )
    for (const row of embeddedRows) {
      const bucket = vehiclesByCustomer.get(row.customerId) ?? []
      if (bucket.length < 10) {
        bucket.push({
          id: row.id,
          year: row.year,
          make: row.make,
          model: row.model,
          engine: row.engine,
          vin: row.vin,
          plate: row.plate,
          mileage: row.mileage,
          lastVisit:
            row.lastVisit instanceof Date
              ? row.lastVisit
              : row.lastVisit
                ? new Date(row.lastVisit as unknown as string)
                : null,
        })
      }
      vehiclesByCustomer.set(row.customerId, bucket)
    }
  }
```

Update the final `return` mapping:

```typescript
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    vehicleCount: Number(r.vehicleCount),
    vehicles: vehiclesByCustomer.get(r.id) ?? [],   // NEW
    lastVisit: r.lastVisit instanceof Date ? r.lastVisit : new Date(r.lastVisit as unknown as string),
  }))
```

- [ ] **Step 4: Run the test, verify pass**

Run: `pnpm test tests/unit/intake-recent-customers.test.ts`

Expected: all green.

- [ ] **Step 5: Run the full suite to catch type ripple**

Run: `pnpm test && npx tsc --noEmit`

Expected: all green. The `RecentCustomer` type now has a required `vehicles` field; any test that builds a `RecentCustomer` literal will need to add it. The `tests/unit/intake-search-component.test.tsx` already mocks `recents` literals at the top — add `vehicles: []` to each.

If `tsc` reports errors in `intake-search-component.test.tsx`, edit the `recents` constant (around lines 6-23) to add `vehicles: []` to each entry. This is intentional — those tests don't exercise the customer-pick routing yet (Task 3 adds new tests with real `vehicles`).

- [ ] **Step 6: Commit**

```bash
git add lib/intake/recent-customers.ts tests/unit/intake-recent-customers.test.ts tests/unit/intake-search-component.test.tsx
git commit -m "feat(intake-search): embed top-10 vehicles in recent-customer rows"
```

---

## Task 3: Client — rewrite `pickCustomer` + fix tier "Add another vehicle"

**Files:**
- Modify: `components/vt/intake-search/index.tsx`
- Modify: `components/vt/intake-search/dropdown.tsx`
- Modify: `tests/unit/intake-search-component.test.tsx`

- [ ] **Step 1: Add failing tests for the routing + tier behavior**

Append to `tests/unit/intake-search-component.test.tsx` inside the existing `describe('<PredictiveIntakeSearch>')`:

```typescript
  it('routes customer click with 0 vehicles to onCreateNew with prefill', async () => {
    const onCreate = vi.fn()
    const onPick = vi.fn()
    const user = userEvent.setup()
    const recents = [
      {
        id: 'c-zero', name: 'Zero Customer', phone: '555-1', email: null,
        vehicleCount: 0, vehicles: [], lastVisit: new Date(),
      },
    ]
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={onPick}
        onCreateNew={onCreate}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Zero Customer'))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Zero Customer', phone: '555-1' }),
    )
    expect(onPick).not.toHaveBeenCalled()
  })

  it('routes customer click with 1 vehicle to onPickVehicle (auto-pick)', async () => {
    const onCreate = vi.fn()
    const onPick = vi.fn()
    const user = userEvent.setup()
    const recents = [
      {
        id: 'c-one', name: 'One Vehicle Customer', phone: '555-2', email: null,
        vehicleCount: 1,
        vehicles: [{
          id: 'v-1', year: 2020, make: 'Honda', model: 'Civic',
          engine: null, vin: null, plate: null, mileage: null, lastVisit: null,
        }],
        lastVisit: new Date(),
      },
    ]
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={onPick}
        onCreateNew={onCreate}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('One Vehicle Customer'))
    expect(onPick).toHaveBeenCalledWith('v-1')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('routes customer click with 2+ vehicles to the Which vehicle? tier', async () => {
    const onCreate = vi.fn()
    const onPick = vi.fn()
    const user = userEvent.setup()
    const recents = [
      {
        id: 'c-many', name: 'Multi Customer', phone: '555-3', email: null,
        vehicleCount: 2,
        vehicles: [
          {
            id: 'v-a', year: 2020, make: 'Honda', model: 'Civic',
            engine: null, vin: null, plate: null, mileage: null, lastVisit: null,
          },
          {
            id: 'v-b', year: 2018, make: 'Ford', model: 'F-150',
            engine: null, vin: null, plate: null, mileage: null, lastVisit: null,
          },
        ],
        lastVisit: new Date(),
      },
    ]
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={onPick}
        onCreateNew={onCreate}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Multi Customer'))

    // Tier should render with both vehicles visible.
    expect(screen.getByText(/which vehicle\?/i)).toBeInTheDocument()
    expect(screen.getByText(/2020 Honda Civic/i)).toBeInTheDocument()
    expect(screen.getByText(/2018 Ford F-150/i)).toBeInTheDocument()
    expect(onPick).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('picks a vehicle from the tier when its row is clicked', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    const recents = [
      {
        id: 'c-many', name: 'Multi Customer', phone: '555-3', email: null,
        vehicleCount: 2,
        vehicles: [
          { id: 'v-a', year: 2020, make: 'Honda', model: 'Civic',
            engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
          { id: 'v-b', year: 2018, make: 'Ford', model: 'F-150',
            engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
        ],
        lastVisit: new Date(),
      },
    ]
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={onPick}
        onCreateNew={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Multi Customer'))
    await user.click(screen.getByText(/2018 Ford F-150/i))
    expect(onPick).toHaveBeenCalledWith('v-b')
  })

  it('tier "Add another vehicle" preserves customer prefill (not blank tokens)', async () => {
    const onCreate = vi.fn()
    const user = userEvent.setup()
    const recents = [
      {
        id: 'c-many', name: 'Multi Customer', phone: '555-3', email: 'mc@x.test',
        vehicleCount: 2,
        vehicles: [
          { id: 'v-a', year: 2020, make: 'Honda', model: 'Civic',
            engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
          { id: 'v-b', year: 2018, make: 'Ford', model: 'F-150',
            engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
        ],
        lastVisit: new Date(),
      },
    ]
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={onCreate}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Multi Customer'))
    await user.click(screen.getByText(/add another vehicle for this customer/i))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Multi Customer',
        phone: '555-3',
        email: 'mc@x.test',
      }),
    )
  })
```

- [ ] **Step 2: Run the tests, confirm 5 new failures**

Run: `pnpm test tests/unit/intake-search-component.test.tsx`

Expected: 5 new failures. The "Add another vehicle" test will fail because `fireCreateNew` currently fires with token-based prefill (empty `name`/`phone`/`email` since the user didn't type a query). The routing tests will fail because the current `pickCustomer` falls through to `onCreateNew` from the recents path regardless of vehicle count.

- [ ] **Step 3: Rewrite `pickCustomer` in `index.tsx`**

Edit `components/vt/intake-search/index.tsx`. Replace the existing `pickCustomer` (lines 111-146) with:

```typescript
  const pickCustomer = useCallback(
    (c: CustomerHit | RecentCustomer) => {
      if (c.vehicles.length === 0) {
        onCreateNew({
          name: c.name,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
        })
        setOpen(false)
        setFocusedIdx(null)
        return
      }
      if (c.vehicles.length === 1) {
        onPickVehicle(c.vehicles[0].id)
        setOpen(false)
        setFocusedIdx(null)
        return
      }
      // 2+ vehicles → open the Which vehicle? tier.
      setTier({
        customer: { id: c.id, name: c.name, phone: c.phone, email: c.email },
        vehicles: c.vehicles,
      })
      setFocusedIdx(0)
    },
    [onPickVehicle, onCreateNew],
  )
```

The `tier` state shape changes — update the `useState` declaration at line 34:

```typescript
  const [tier, setTier] = useState<{
    customer: { id: string; name: string; phone: string | null; email: string | null }
    vehicles: CustomerVehicle[]
  } | null>(null)
```

Import `CustomerVehicle` at the top (alongside existing imports from `@/lib/intake/search`):

```typescript
import type { CustomerHit, CustomerVehicle, VehicleHit } from '@/lib/intake/search'
```

(Keep `VehicleHit` — it's still used for the global vehicle results array.)

- [ ] **Step 4: Update the keyboard-Enter handler so it pulls customer info from the new tier shape**

Same file. The existing tier-Enter block (around lines 178-191) reads `tier.customer.name/phone/email` — that still works since the new tier shape preserves those fields. **No change needed there.**

Verify by reading lines 178-191 after the state-shape change. The `tier.vehicles[i]` reads use only `id/year/make/model/...` — all on `CustomerVehicle`. No change.

- [ ] **Step 5: Wire the tier's mouse-click "Add another vehicle" to use the customer prefill**

Same file. Find the `<DropdownWhichVehicle>` render (lines 253-266). Change the `onCreateNew` prop from `fireCreateNew` to a customer-prefilled inline callback:

```typescript
          {tier ? (
            <DropdownWhichVehicle
              customerName={tier.customer.name}
              vehicles={tier.vehicles}
              focusedIdx={focusedIdx}
              onBack={() => {
                setTier(null)
                setFocusedIdx(null)
              }}
              onPickVehicle={(v) => {
                onPickVehicle(v.id)
                setOpen(false)
              }}
              onCreateNew={() => {
                onCreateNew({
                  name: tier.customer.name,
                  phone: tier.customer.phone ?? undefined,
                  email: tier.customer.email ?? undefined,
                })
                setOpen(false)
                setFocusedIdx(null)
                setTier(null)
              }}
            />
          ) : /* ... rest unchanged */
```

- [ ] **Step 6: Widen `DropdownWhichVehicle` prop type**

Edit `components/vt/intake-search/dropdown.tsx`. Find the `DropdownWhichVehicle` signature (around line 340):

Change `vehicles: VehicleHit[]` to `vehicles: CustomerVehicle[]`. Update `onPickVehicle` signature too — it receives a `CustomerVehicle` now (no `ownerId`/`ownerName`). Adjust imports at the top of the file:

```typescript
import type { CustomerHit, CustomerVehicle, VehicleHit } from '@/lib/intake/search'
```

The internal JSX only reads `v.id`, `v.year`, `v.make`, `v.model`, `v.vin`, `v.plate`, `v.mileage`, `v.lastVisit` — all on `CustomerVehicle`. No JSX change.

- [ ] **Step 7: Run the new tests, verify they pass**

Run: `pnpm test tests/unit/intake-search-component.test.tsx`

Expected: 5 new tests green + existing tests still green.

- [ ] **Step 8: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit`

Expected: all green. If any other component/test reads `tier` with the old shape, fix the type by reading `tier.customer.name` instead of `tier.customer` (which used to be a full `CustomerHit`).

- [ ] **Step 9: Commit**

```bash
git add components/vt/intake-search/index.tsx components/vt/intake-search/dropdown.tsx tests/unit/intake-search-component.test.tsx
git commit -m "fix(intake-search): customer-pick routes on vehicles.length + tier add-another preserves customer prefill"
```

---

## Task 4: Manual Vercel preview verification + push + draft PR

**Files:** None — this is a verification + push task.

- [ ] **Step 1: Final test suite + typecheck**

Run: `pnpm test && npx tsc --noEmit`

Expected: all green. Don't push until both pass.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin fix/intake-customer-select
```

- [ ] **Step 3: Open a draft PR**

```bash
gh pr create --draft \
  --title "fix(intake): customer-pick routes by vehicle count (autopick + tier + add-another-vehicle)" \
  --body "$(cat <<'EOF'
## Summary
- Fixes the predictive-search customer-pick flow. Clicking a customer (from typed-query results OR recents list) now routes correctly:
  - **0 vehicles** → create-new form with customer info prefilled
  - **1 vehicle** → auto-picks that vehicle, jumps to concern fields
  - **2+ vehicles** → opens the "Which vehicle?" tier with all of them listed
- Fixes the tier's "Add another vehicle for this customer" link so it preserves the customer's name/phone/email when opening the create-new form (was previously starting blank).

## Architecture
Server side now embeds each customer's top-10 most-recent vehicles directly into the search + recents response. Client routes on `customer.vehicles.length` without depending on the global vehicle-results array. No schema migration.

Spec: \`docs/superpowers/specs/2026-05-12-intake-customer-select-fix-design.md\`
Plan: \`docs/superpowers/plans/2026-05-12-intake-customer-select-fix.md\`

## Test coverage
- \`tests/unit/intake-search-query.test.ts\` — 4 new cases (0 vehicles, 12 cap, no-sessions order, shape)
- \`tests/unit/intake-recent-customers.test.ts\` — 1 new case (vehicles embedded on recent rows)
- \`tests/unit/intake-search-component.test.tsx\` — 5 new cases (0/1/2+ routing, tier vehicle pick, tier add-another preserves prefill)

## Test plan (Vercel preview)
- [ ] Click a customer from recents with 1 vehicle → form jumps to concern, vehicle pre-selected
- [ ] Click a customer from recents with 2+ vehicles → "Which vehicle?" tier appears with all of them
- [ ] Click "Add another vehicle for this customer" in the tier → create-new form opens with customer info prefilled
- [ ] Click a customer from a typed-query result (same as recents path, just verifying same behavior)
- [ ] Click a vehicle row directly → still works (regression)
- [ ] Tech selector still works (regression — added in PR #28)
- [ ] Manual intake submission still works end-to-end

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Hand off to Brandon**

Surface the preview URL once the Vercel check resolves. Walk the manual checks above. Per CLAUDE.md memory, fixes aren't "fixed" until proven on the real authed user-facing surface. Brandon merges via GitHub UI when satisfied.

---

## Self-review

### Spec coverage

- ✅ Server: embed top-10 vehicles in `CustomerHit` — Task 1
- ✅ Server: embed in `RecentCustomer` with same `CustomerVehicle` type — Task 2
- ✅ Client: `pickCustomer` routes on `vehicles.length` — Task 3 Step 3
- ✅ Client: tier "Add another vehicle" preserves customer prefill — Task 3 Step 5
- ✅ Type changes: `CustomerVehicle` exported from search, re-exported from recents — Task 1 Step 4 + Task 2 Step 3
- ✅ Cap at 10 most-recent — Task 1 Step 5 + Task 2 Step 3 (JS-side bucket cap)
- ✅ No schema migration — explicitly out of scope per spec
- ✅ Manual verification — Task 4

No gaps.

### Type consistency

- `CustomerVehicle` shape used identically in search.ts (Task 1), recent-customers.ts (Task 2), tier state (Task 3), DropdownWhichVehicle prop (Task 3 Step 6).
- `pickCustomer` accepts `CustomerHit | RecentCustomer` — both now have `vehicles` field after Tasks 1+2.
- `tier.customer` normalized to `{ id, name, phone, email }` — consistent between mouse path (Task 3 Step 3) and keyboard Enter (existing code already reads these fields).

### Placeholder scan

- No TBDs, no "implement later", no vague error-handling language.
- Test cases include full assertions.
- Implementation steps show actual code.
- Commit messages spelled out.

No placeholders found.
