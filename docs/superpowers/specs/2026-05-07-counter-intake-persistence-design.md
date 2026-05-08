# Counter Intake Persistence — Design

**Date:** 2026-05-07
**Status:** Draft for review
**Track:** Shop management — PR 1 (first slice of the marathon)
**Working name:** Counter Intake Persistence
**Author:** Brandon (founder) + Claude (brainstorm)

---

## Context

The vyntechs codebase has a partially-built advisor-facing intake screen at `/intake` (rendered by `components/screens/counter-intake.tsx`). It's a desktop form where a service advisor at the counter writes up a customer dropping off a car: customer info, vehicle info, and the customer's complaint. **It looks finished.** It is not.

What's actually wired:

- Form UI (330 lines, captures customer name/phone/email, vehicle year/make/model/engine/VIN/mileage/plate, complaint description/when-started/how-often/authorization).
- Submit handler at `/api/intake/submit` (placeholder — accepts JSON, returns a random `draftId`, **persists nothing**).
- Authorize handler at `/api/intake/authorize` (placeholder — accepts JSON, returns a random `workOrderId`, **persists nothing**).
- A "plan & quote" middle screen at `/intake/plan-quote/[draftId]` with stubbed AI plan data.
- A confirmation page at `/intake/confirmed/[workOrderId]`.
- The whole thing is gated behind `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` (currently `false` everywhere — the flag was turned off when the May 5 platform-split spec deferred shop-management work).

What's missing from the database:

- **No `customers` table** — customers don't exist as records. The form captures their name/phone/email and discards it.
- **No `vehicles` table** — vehicles only exist embedded in `session.intake` JSON, not as standalone queryable records.
- **No link from `sessions` to a real customer or vehicle** — sessions today have a `shopId` and `techId` but no way to express "this session is for Maria's F-150."

PR 1 closes that gap: take the existing form, give it a real database to write to, and turn on the flag for testing.

---

## What this PR is, in one breath

Right now the advisor-facing write-up page captures everything correctly and **throws it on the floor at submit**. PR 1 makes the existing page actually save what the advisor types, attached to real customer and vehicle records (with a customer being able to have multiple vehicles, properly modeled). After PR 1, when the advisor presses "Send to Techs," the data lives in the database, a real session is created, the tech sees it on `/today`, and life is good.

The diagnostic engine, the curator surface, and the tech mobile flow do not change.

---

## Goals

1. The advisor at `/intake` can write up a customer, hit one button, and have the system create real, queryable customer + vehicle + session records in the database.
2. A customer's relationship to their vehicles is modeled correctly (1-to-many) from day one — even though PR 1 doesn't surface multi-vehicle UX yet (that's PR 1.5).
3. The data shape laid down in PR 1 is the same shape every later shop-management feature (estimate, invoice, history per VIN, customer-facing flows) will plug into. **No throw-away schema.**
4. Existing diagnostic-side data (sessions, session_events, artifacts, etc.) is untouched.

## Non-Goals (explicit deferrals — do NOT scope-creep these in)

- **Phone-lookup intelligence / "welcome back" UX.** PR 1.5 — separate PR.
- **Multi-vehicle picker for returning customers.** PR 1.5.
- **AI plan & quote.** Existing stub stays stubbed; this PR removes the plan-quote screen from the post-submit flow entirely. AI plan/quote becomes its own future PR.
- **Customer or vehicle CRUD admin pages** (list/search/edit/delete). Future PR.
- **Estimate, invoice, customer approval, history** — separate PRs in the marathon.
- **Backfilling existing sessions** with synthetic customer/vehicle records. Existing sessions stay un-attached. Backfill is part of a future "shop onboarding / customer import" feature, not PR 1.
- **Pre-assigning a job to a specific tech.** PR 1 creates jobs as open / unassigned; tech claims via `/today` (existing behavior). Pre-assignment is a follow-up.
- **Advisor role.** PR 1 gates `/intake` to `owner` only. When team admin lands, an `advisor` role gets added to the allow-list.
- **Platform split** (`apps/diagnostic` + `apps/shop`). Code for PR 1 lives in the current flat structure. Tech debt is acknowledged: when the May 5 platform-split lands, this code moves to `apps/shop`. The PR-1 surface is small enough that the rehome is straightforward (~1 follow-up PR).

---

## Setup preconditions (before any code)

- **Fast-forward `preview-curator` from `main`.** The integration branch is currently 6 commits behind `main` (PRs #3/#4/#6/#7/#8/#9 from 2026-05-07). Building PR 1 on stale `preview-curator` would test against the wrong base. Sequence: pull `main` into `preview-curator`, push, verify Vercel preview rebuilds clean.
- **Branch off `preview-curator`** for the feature branch (e.g. `feature/counter-intake-persistence`).

---

## Data model

Three changes. The first two are new tables; the third is one new column on an existing table.

### New table: `customers`

A real customer of a shop. Multi-tenant — every shop has its own customer list.

| field | type | notes |
|---|---|---|
| id | uuid PK | |
| shop_id | uuid FK → `shops.id` | not null. The customer belongs to exactly one shop. |
| name | text | not null. |
| phone | text | not null. Stored as the advisor types it; normalization happens at lookup time (PR 1.5). |
| email | text | nullable. |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Uniqueness:** *no DB-level unique constraint on `(shop_id, phone)` in PR 1.* Reasoning: real-world phone formats are noisy (formatting, partial entries, fake numbers). A hard unique constraint causes painful 500 errors. Lookup-by-phone within the upsert logic is good enough for the persistence-only PR 1; PR 1.5 (phone-lookup intelligence) adds normalization and may revisit.

### New table: `vehicles`

A real vehicle, owned by a customer. The 1-to-many relationship Brandon flagged: one customer, many vehicles.

| field | type | notes |
|---|---|---|
| id | uuid PK | |
| customer_id | uuid FK → `customers.id` | not null. Vehicle belongs to exactly one customer. ON DELETE CASCADE so deleting a customer cleans up vehicles. |
| year | integer | not null. |
| make | text | not null. |
| model | text | not null. |
| engine | text | nullable. |
| vin | text | nullable. The 17-char gold-standard identifier when present. Optional because walk-ins often don't have it. |
| mileage | integer | nullable. |
| plate | text | nullable. |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Indexes:** `customer_id`, and an optional `(customer_id, vin)` index to speed up VIN lookup within a customer's vehicle list.

### `sessions` — one new column

Add `vehicle_id` (uuid, nullable, FK → `vehicles.id`). Nullable because pre-existing sessions in the database have no vehicle record to point to (per "Non-Goals" — no backfill in PR 1). New sessions created via the advisor intake fill this in.

The existing `intake` JSON column on `sessions` stays exactly as it is. It continues to hold the vehicle info as a snapshot at the time of intake. The new `vehicle_id` is additive.

### Drizzle schema location

`lib/db/schema.ts` already holds all schema. Add the two new tables and the new column there. New types exported: `Customer`, `NewCustomer`, `Vehicle`, `NewVehicle`. Update `sessionsRelations` to include the optional vehicle relation. Add `customersRelations` and `vehiclesRelations`.

### Migration

A single Drizzle migration file (next number after `0011b_session_max_corpus_similarity.sql`, so `0012_*.sql`). Contains:
1. `CREATE TABLE customers (...)`
2. `CREATE TABLE vehicles (...)`
3. `ALTER TABLE sessions ADD COLUMN vehicle_id uuid REFERENCES vehicles(id)`

Reversible: down migration drops the column then the two tables in reverse order. No data destroyed.

---

## Flow: what one button press does

The advisor fills out the form on `/intake`. All fields filled per existing required-ness rules in `CounterIntake` (name, vin, complaint description are required there; we keep that). The advisor presses **"Send to Techs"**.

In one HTTP POST to `/api/intake/submit`:

1. Server reads body: `{ customer: { name, phone, email }, vehicle: { vin, year, make, model, engine, mileage, plate }, complaint: { description, whenStarted, howOften, authorized } }` — exact existing shape.
2. Server resolves the `shopId` from the authenticated user's profile (`requireUserAndProfile` — existing helper).
3. **Customer upsert.** Look up `customers WHERE shop_id = $shopId AND phone = $phone`. If found, use that row. If not, insert a new customer row with the form data and the resolved `shopId`. (App-level upsert, no `ON CONFLICT` needed since there's no DB-unique constraint.)
4. **Vehicle upsert.** Within that customer's vehicles:
   - **Primary path (PR 1).** The existing `CounterIntake` form requires VIN client-side, so the typical request always has a VIN. Look up `vehicles WHERE customer_id = $customerId AND vin = $vin`. If found, use it. If not, insert.
   - **Fallback path (defensive).** If VIN is somehow absent (direct API hit bypassing the form): look up by `(customer_id, year, make, model, plate)`. If exactly one match, use it; if multiple match, pick the most recently created (`ORDER BY created_at DESC LIMIT 1`); if no match, insert. This branch is rarely exercised in PR 1 — VIN-required form prevents it. PR 1.5 (which makes VIN optional for walk-ins) is when this path becomes the primary for VIN-less cases.
5. **Session create.** Insert a row into `sessions` with: `shop_id`, `tech_id` = null OR a placeholder (existing schema has `tech_id` as not-null FK to `profiles.id` — see *Open question 1* below), `status: 'open'`, `intake: { ...complaint, vehicleYear, vehicleMake, vehicleModel, vehicleEngine, mileage, customerComplaint: complaint.description }`, `tree_state: <empty initial state>`, `vehicle_id: $vehicleId`.
6. All three writes happen inside a single Drizzle transaction. If any step fails, all roll back.
7. Server returns `{ sessionId: <uuid> }`.

Client receives `sessionId`, redirects to `/sessions/[sessionId]` (the existing tech-facing session view). For PR 1 this same view doubles as the "advisor confirmation" view; if it doesn't fit the advisor's needs, a separate `/intake/jobs/[sessionId]` view can be added in a follow-up PR.

The `/api/intake/authorize` endpoint becomes dead code in PR 1 (the plan-quote middle screen is removed). It can be deleted or left in place stubbed; the PR will delete it to keep the codebase tidy.

### Open question 1: `sessions.tech_id` is currently NOT NULL

Today, `sessions.tech_id` is `not null` and FK to `profiles.id`. PR 1 wants to create sessions as "open / unassigned." Two ways to handle this without changing the existing diagnostic flow:

- **(a)** Use the advisor's own `profile.id` as the initial `tech_id`. The session is "owned" by the advisor on creation; when a tech claims it from `/today`, the claim flow updates `tech_id` to the claiming tech. This works but is a small white lie ("the advisor is the tech for 30 seconds").
- **(b)** Migrate `sessions.tech_id` to nullable. Now an unassigned session is genuinely `tech_id IS NULL`. Cleaner data shape but a wider migration that touches everything that reads `tech_id`.

**Recommendation: (a) for PR 1.** Smaller blast radius. (b) becomes part of the "claim / pre-assign" PR when that lands.

---

## UI changes

Minimal in PR 1:

1. **`CounterIntake.tsx`** — change the submit button copy from its current label to **"Send to Techs"** (or whatever final label you confirm). Change the post-submit redirect target from `/intake/plan-quote/[draftId]` to `/sessions/[sessionId]`.
2. **`/intake/layout.tsx`** — current gate is `if (!isDesktopIntakeEnabled()) notFound()`. Add a role check: also `notFound()` if the authed user's `profile.role !== 'owner'`. (When advisor role exists, expand the allow-list to `['owner', 'advisor']`.)
3. **Delete** `/intake/plan-quote/[draftId]/page.tsx`, `/intake/confirmed/[workOrderId]/page.tsx`, `components/screens/counter-plan-quote.tsx`, `components/screens/counter-confirmed.tsx` (if they exist), and `/api/intake/authorize/route.ts`. They were placeholders for a flow PR 1 collapses.
4. **Feature flag.** Set `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=true` for the preview-curator branch's Vercel preview env. Stays `false` on `main` env until merge sign-off.

No new components. No design-system additions. No new shadcn/ui pieces.

---

## Error handling

| failure | response |
|---|---|
| Invalid JSON body | 400, `{ error: 'invalid_json' }` |
| Missing required field (name, phone, vin OR year+make+model, complaint description) | 422, `{ error: '<field> is required' }` |
| Authed user has no profile, or profile has no `shopId` | 401/403 redirect to sign-in (existing `requireUserAndProfile` handles this) |
| User's role is not `owner` | 404 from layout (looks like the page doesn't exist) |
| Customer insert fails (DB error) | Transaction rolls back, 500 with a generic error message |
| Vehicle insert fails | Transaction rolls back |
| Session insert fails | Transaction rolls back |
| Form submit network failure (client side) | Existing form already shows an error message in red; reuse that path |

The form's existing client-side validation (`canSubmit` requires `name`, `vin`, `description`) stays. We do *not* relax it in PR 1.

---

## Testing strategy

TDD per Brandon's preference. Test order: write failing tests first, then implement.

### Unit tests (Vitest)

- `lib/intake/upsert-customer.ts` — given a shopId + customer fields, upserts. Test cases: new customer creates; matching phone within shop returns existing; same phone in different shop creates new (multi-tenant isolation).
- `lib/intake/upsert-vehicle.ts` — given a customerId + vehicle fields, upserts. Test cases: new vehicle creates; matching VIN reuses; no-VIN with matching year+make+model+plate reuses; no-VIN no-match creates new; vehicle for different customer is its own row.
- `lib/intake/create-session.ts` — given resolved customerId + vehicleId + complaint, creates a session and returns the id.

### Integration test (Vitest + PGlite)

- End-to-end: POST to `/api/intake/submit` with a known body. Assert: 1 customer row exists, 1 vehicle row exists linked to that customer, 1 session row exists linked to the vehicle.
- Multi-vehicle case: POST same customer info twice with different vehicle info. Assert: 1 customer row, 2 vehicle rows, 2 session rows.
- Wrong-role case: POST as a `tech`-role user. Assert: 404 (or whatever middleware does).

### Playwright E2E (one happy-path test)

- Sign in as `owner`. Visit `/intake`. Fill all fields. Click "Send to Techs". Assert URL becomes `/sessions/<some-uuid>`. Assert the page shows the customer + vehicle data.

---

## Acceptance criteria

PR 1 ships when:

- [ ] Schema migration `0012_*.sql` exists and runs cleanly on a fresh database.
- [ ] `/api/intake/submit` creates real customer + vehicle + session records inside a transaction.
- [ ] Returning the same phone within the same shop reuses the customer record.
- [ ] Returning the same VIN (or year+make+model+plate combo when no VIN) within the same customer reuses the vehicle record.
- [ ] `/intake` is gated to `owner` role only; techs see 404.
- [ ] `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=true` on the preview branch's Vercel env; `false` on `main`.
- [ ] Plan-quote screen, confirmed screen, and `authorize` endpoint are deleted; no dead links.
- [ ] All unit tests pass.
- [ ] One Playwright E2E test covers the happy path.
- [ ] On the deployed preview URL, manual write-up by Brandon as `owner` produces a real session that a `tech`-role user can see in `/today`.

---

## Marathon view: where PR 1 sits

```
PR 1   Counter intake persistence       ← this spec
PR 1.5 Phone lookup + returning-customer + vehicle picker
PR 2   Estimate (parts + labor) on a session
PR 3   Customer-facing approval link (signed token, no auth)
PR 4   Invoice + close-out
PR 5   Customer history per VIN
...    (more, defined as we go)
later  Shop onboarding / customer import (also retroactively links old sessions IF wanted)
```

Each is a small PR shipped independently to `main` via `preview-curator`. None of these are blocked on the platform-split landing; if/when the split lands, this whole stack rehomes to `apps/shop` in one mechanical follow-up PR.

---

## Out-of-band concerns acknowledged

- **Platform-split spec divergence.** The May 5 platform-split design treats shop-management features as deferred until the split is complete. PR 1 knowingly lands shop-mgmt feature work in the flat structure ahead of the split. Tradeoff accepted: faster time-to-validation in exchange for one mechanical rehome PR later.
- **Phone normalization.** PR 1 stores phone as-typed. Lookup is exact-string match within the same shop. PR 1.5 introduces normalization (strip non-digits, optional country code) when the lookup intelligence is built.
- **Pre-existing sessions are floating.** They have `vehicle_id IS NULL` forever (or until a future shop-onboarding feature retroactively links them). This is fine — the diagnostic side never queries by `vehicle_id`.

---

## Sign-off

- [ ] Brandon reviews and approves this spec.
- [ ] Spec committed to `docs/superpowers/specs/2026-05-07-counter-intake-persistence-design.md`.
- [ ] `superpowers:writing-plans` invoked next to produce the implementation plan.
