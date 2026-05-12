# Intake customer-select bug fix — design spec

**Status:** Ready for implementation review
**Branch:** `fix/intake-customer-select` (cut from `origin/main` after PR #28 merged 2026-05-12)
**Date:** 2026-05-12
**Predecessor:** PR #27 `feat(intake): predictive search on /intake` (commit `e6fcbbe`) shipped the search dropdown but left the customer-pick → vehicle-tier flow broken. PR #28 `feat(intake): optional tech selector pill` shipped on top. This PR fixes the latent customer-pick bug without touching the tech selector.
**Investigation report:** `feature-dev:code-explorer` subagent 2026-05-12 — see headline findings below.

---

## Goal

Make the predictive search dropdown behave correctly when the writer clicks a **customer row** (from the recents list or from a typed-query result):

- **0 vehicles on file** → drop into the create-new form with customer's name/phone/email prefilled. Manual vehicle entry. (Existing behavior; just no longer the silent fallback for every other case.)
- **1 vehicle on file** → auto-pick that vehicle. Form jumps to just-the-concern fields. Same end state as clicking the vehicle row directly.
- **2+ vehicles on file** → open the "Which vehicle?" second tier with all of them listed (capped at 10 most-recent). Plus an "+ Add another vehicle for [Customer]" row at the bottom that preserves the customer linkage when picked.

Additionally fix the "Add another vehicle for this customer" CTA inside the tier so it carries the picked customer's data through to the create-new form — currently it discards the customer linkage and starts a blank intake.

---

## Non-goals

- **No DB migration.** Both queries pull from existing `customers` + `vehicles` tables.
- **`See all N ↓` button at the bottom of the dropdown** stays non-functional (no `onClick`). Separate follow-up.
- **Focus-jump to Name** on create-new stays unimplemented. Separate follow-up.
- **VIN exact-match auto-routing** stays as-is (user clicks the vehicle row manually). Separate follow-up.
- **Tab from search input → first form field** stays incidental (native focus order). Separate follow-up.
- **No tier-level search** when a customer has 11+ vehicles. v1 caps at 10 most-recent; tier "show all" is a future PR.
- **No customer + vehicle CRUD** beyond what already exists.

---

## Root cause (from subagent investigation)

`components/vt/intake-search/index.tsx:111-146` (`pickCustomer` handler):

```
if (c.vehicleCount === 0) → onCreateNew with prefill        [works]
if (state.kind === 'matched') filter state.vehicles by ownerId === c.id
  → 1 owned in result → onPickVehicle                        [works only when match in result]
  → >1 owned in result → setTier({...})                      [works only when matches in result]
fallback → onCreateNew with prefill                          [BUG SURFACE]
```

The fallback fires whenever:
- The user clicked a customer from the recents list (`state.kind === 'idle'`, no vehicles in scope)
- The user typed a query that matched the customer's name BUT their vehicles didn't make it into the top-5 vehicle results (because the global `PER_GROUP_LIMIT = 5` is shared across all customers)

Either case drops to the "create new" path silently, with no signal to the writer that they just discarded the customer's history.

**The fix:** the search and recents queries embed each customer's vehicle list (capped at 10 most-recent) directly into the customer hit. The client routes on `customer.vehicles.length` without needing the global vehicle-results array to coincide.

---

## Server-side changes

### `lib/intake/search.ts`

Extend `CustomerHit`:

```ts
export type CustomerHit = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number          // total count, unchanged
  vehicles: CustomerVehicle[]   // NEW — up to 10 most-recent
  lastVisit: Date | null
}

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
```

Populate `vehicles` for each customer row in the response:

1. After the existing customer query runs and returns `customerRows`, collect `customerIds = customerRows.map(c => c.id)`.
2. If `customerIds` is non-empty, run a second query:
   ```sql
   select v.id, v.year, v.make, v.model, v.engine, v.vin, v.plate, v.mileage,
          v.customer_id,
          (select max(s.created_at) from sessions s where s.vehicle_id = v.id) as last_visit
   from vehicles v
   where v.customer_id = any($customerIds)
   order by v.customer_id asc,
            coalesce(last_visit, timestamp 'epoch') desc,
            v.year desc nulls last,
            v.id asc
   ```
   Implemented with Drizzle `inArray` (per Task 3 of PR #28 — `sql\`= ANY(...)\`` does not bind reliably in PGlite).
3. In JS, group rows by `customer_id`, take the top 10 per customer (input is already sorted), strip `customer_id` from each vehicle.
4. Merge: `customerHit.vehicles = grouped.get(customerHit.id) ?? []`.

`vehicleCount` (total) stays as it is — counts all vehicles, not just the embedded 10. The tier renders the embedded list; if a customer has 11+ vehicles, only the 10 most-recent appear. v1 accepts this; a follow-up could add tier-level pagination.

### `lib/intake/recent-customers.ts`

Same `vehicles` field added to `RecentCustomer`. Same shape, same population strategy. The post-fetch step runs the same vehicles-by-customer-id query against the recent-customer IDs.

```ts
export type RecentCustomer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  vehicles: CustomerVehicle[]   // NEW — same type as CustomerHit.vehicles
  lastVisit: Date
}
```

Export `CustomerVehicle` from a shared location — either `lib/intake/search.ts` (since both files now need it) or a new `lib/intake/types.ts`. Easiest: export from `search.ts` and re-export from `recent-customers.ts`.

### Response shape: backwards compatibility

Both functions add a new optional-looking field. Existing client code that doesn't read `customer.vehicles` keeps working. Other callers (none discovered in this scope) are unaffected.

---

## Client-side changes

### `components/vt/intake-search/index.tsx`

Rewrite `pickCustomer` (line 111-146) to use `customer.vehicles` directly:

```ts
const pickCustomer = useCallback(
  (c: CustomerHit | RecentCustomer) => {
    if (c.vehicles.length === 0) {
      onCreateNew({
        name: c.name,
        phone: c.phone ?? '',
        email: c.email ?? '',
      })
      setQuery('')
      setShowDropdown(false)
      return
    }
    if (c.vehicles.length === 1) {
      onPickVehicle(c.vehicles[0].id)
      setQuery('')
      setShowDropdown(false)
      return
    }
    // 2+ vehicles → open the Which vehicle? tier.
    setTier({
      customerId: c.id,
      customerName: c.name,
      customerPhone: c.phone,
      customerEmail: c.email,
      vehicles: c.vehicles,
    })
  },
  [onCreateNew, onPickVehicle],
)
```

The `tier` state shape changes to carry the customer linkage (currently it only carried the vehicle list).

### `components/vt/intake-search/dropdown.tsx`

`DropdownWhichVehicle` (line 340-393):

- The "Add another vehicle for this customer" CTA (line 385-390) currently calls `fireCreateNew()` with no customer context. Change it to call a new prop `onAddVehicleForCustomer(customer)` which the parent wires to `onCreateNew` with the customer's prefilled name/phone/email.
- The tier now reads `tier.customerName` for the heading instead of pulling it from the first vehicle's `ownerName` (subtle but the customer-row click path doesn't populate `ownerName` on each vehicle since vehicles are scoped to the customer).

### `lib/intake/recent-customers.ts` type re-export

Make sure the page/component type chain is updated. `app/(app)/intake/page.tsx` already passes `recentCustomers` into `CounterIntake` and through into `PredictiveIntakeSearch` — no signature change there, just the shape of the array elements.

---

## Test plan

### Server-side (Vitest + PGlite)

`tests/unit/intake-search.test.ts` (extend existing or add):

1. Customer search with query matching a customer that has 0 vehicles → result includes `customer.vehicles === []`.
2. Customer with 1 vehicle → `customer.vehicles.length === 1` and the vehicle matches the seeded row.
3. Customer with 5 vehicles → `customer.vehicles.length === 5`, ordered by `last_visit DESC, year DESC`.
4. Customer with 12 vehicles → `customer.vehicles.length === 10` (cap), most-recent 10 only.
5. `vehicleCount` total stays correct even when `vehicles` is capped.

`tests/unit/intake-recent-customers.test.ts` (extend existing):

6. Recent customer with 2 vehicles → `recentCustomer.vehicles.length === 2`.
7. Recent customer with 0 vehicles → `recentCustomer.vehicles === []` (recents query already requires `INNER JOIN vehicles INNER JOIN sessions`, so a zero-vehicle customer wouldn't appear at all — verify this assumption holds).

### Client-side (Vitest + RTL)

`tests/unit/intake-search-component.test.tsx` (extend existing):

8. Customer row click, 0 vehicles → `onCreateNew` fires with prefill, NOT `onPickVehicle`.
9. Customer row click, 1 vehicle → `onPickVehicle` fires with that vehicle's id, NOT `onCreateNew`.
10. Customer row click, 2 vehicles → tier opens, both vehicles render, `onCreateNew` does NOT fire.
11. Inside tier, click a vehicle → `onPickVehicle` fires with that id, tier closes.
12. Inside tier, click "Add another vehicle for [Customer]" → `onCreateNew` fires with prefilled name/phone/email (NOT a blank `tokensToPrefill` payload).
13. Customer row click from recents list (state `idle`) → routes correctly per vehicle count. **This is the primary regression test for the reported bug.**

### Regression coverage

- `tests/unit/counter-intake.test.tsx` — manual entry path, mileage update on pick-existing, tech selector wiring all stay green.
- `tests/unit/intake-submit-route.test.ts` + `intake-submit-pick-existing.test.ts` — submit body shapes unchanged.

---

## Files touched

**Modified:**

| Path | Change |
|---|---|
| `lib/intake/search.ts` | Add `CustomerVehicle` type, extend `CustomerHit.vehicles`, add post-query vehicle fetch + grouping |
| `lib/intake/recent-customers.ts` | Add `vehicles` to `RecentCustomer`, same post-query strategy |
| `components/vt/intake-search/index.tsx` | Rewrite `pickCustomer`, change tier state shape, add `onAddVehicleForCustomer` callback path |
| `components/vt/intake-search/dropdown.tsx` | Wire "Add another vehicle" row to new callback, render customer name in tier header from `tier.customerName` |
| `tests/unit/intake-search.test.ts` | New cases 1-5 |
| `tests/unit/intake-recent-customers.test.ts` | New cases 6-7 |
| `tests/unit/intake-search-component.test.tsx` | New cases 8-13 |

**Created:** None.

---

## Live database migration

**No migration required.** Both queries operate on existing `customers` and `vehicles` tables.

---

## Risk + rollback

- Rollback = revert the PR. Pure code change; no DB state to clean up.
- The added `vehicles` field is additive on the response shape — existing client code that ignores it keeps working.
- The new vehicles-by-customer-id query is a single batched `inArray(...)` against a `customers_id` index. Realistic load: ~5-8 customers × ~10 vehicles each = ~80 rows per request. No performance concern at MVP scale.
- The "Add another vehicle for this customer" callback is a new prop — if not wired, the tier's CTA falls back to the existing `fireCreateNew` path (which is what's there today). Defensive: keep the existing fallback in place during the refactor so a partial state doesn't break behavior worse than current.

---

## Open questions

1. **Cap at 10 — adequate?** Service customers typically have 1-3 vehicles, occasionally 4-5 for family households, very rarely 10+. 10 covers >99% of cases. If you anticipate fleet customers (commercial shops with shared customer accounts), bump to 25 — but the tier UX gets noisy past ~6 entries. Holding at 10 unless told otherwise.
2. **Customer-name vs vehicle's `ownerName`** — the existing vehicle row rendering uses `vehicle.ownerName` to show "Honda Civic — Maria Lopez." In the tier, vehicles are scoped to one customer, so the inline owner-name is redundant. Recommend dropping it from the tier rows specifically (the tier header already names the customer).
