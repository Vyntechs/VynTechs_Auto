# Shop-management Foundation — toggle, RO concept, persist customer authorization

**Date:** 2026-05-17
**Sub-project:** 1 of N in the optional shop-management add-on (the full sequence is decomposed below).
**Integration branch:** `release/shop-management` — clone of `origin/main` HEAD. All shop-management sub-projects merge here first. Only the final validated state of the full module merges to `main`, and only Brandon merges via the GitHub UI after Vercel-preview validation.
**Working branch:** `feat/shop-mgmt-foundation` — cut from `release/shop-management`.
**No Claude Design handoff for this PR.** This PR has zero UI changes — it's a database column, a new table, a backend behavior change, and a small bug fix on a field we currently discard. There is nothing for Claude Design to design until PR 2 (estimates).

---

## Plain-English summary

Vyntechs is today a diagnostic app. After research into Tekmetric / Mitchell 1 / Shopmonkey friction (Capterra, G2, Reddit, Diagnostic Network forums), we are adding an optional, purchasable **shop-management module**. Some shops will buy it and run their whole shop on Vyntechs. Most shops will not — they will keep using Vyntechs only as a diagnostic tool alongside their existing shop-management software (Tekmetric, etc.).

This first PR is foundation only. After it ships, three things are true:

1. Every shop has a flag for whether shop-management is enabled. Default: off.
2. When the flag is on for a shop, every intake submission silently opens a repair-order record alongside the diagnostic session it creates. The technician sees nothing different.
3. The "customer authorized this work?" answer the intake form already collects gets persisted (today it is dropped before save).

No UI changes. No user-visible behavior change. The two shops with the flag flipped on at ship time — Young Motorsports and Mac's shop — verify the plumbing by inspecting the database, not the app.

---

## Where this fits in the bigger picture

The shop-management module is decomposed into eight sub-projects, in build order. Each is its own spec → plan → PR sequence merging into `release/shop-management`:

1. **Foundation (this PR)** — toggle + RO concept + persist customer authorization.
2. **Estimates + customer authorization** — service writer builds an estimate from a closed diagnosis with AI-informed labor times; customer one-clicks approval via a link.
3. **Customer comms** — built-in 2-way SMS + email, after-hours auto-reply, "your car is ready" template, deferred-work follow-up redirected at the customer (not the tech, as today).
4. **Parts + labor lookup** — parts catalog with vendor integration, labor times sourced from our own closed-session corpus plus a fallback guide.
5. **Invoicing + payment recording** — generate invoice, shop swipes the customer's card on the shop's **existing** payment processor (BYO Stripe/Square/Clover — Vyntechs never touches a card), Vyntechs records what was paid plus AR/AP and taxes.
6. **Scheduling + dispatch** — appointment calendar, bay assignments, tech-to-job board.
7. **Reports** — ARO, car count, technician productivity, parts margin, deferred-work surfacing.
8. **Time clock + employee records** — clock-in/out, hourly tracking, billable-vs-clock efficiency.

The two product calls baked into the whole module:

- **Optional and toggleable** — every shop in our system runs in one of two modes: diagnostic-only (default) or diagnostic + shop-management. Every gated API route and every gated navigation item checks the flag.
- **Bring-your-own payment processor** — Vyntechs never touches a card. No PCI scope. No merchant of record. Same record-not-move pattern QuickBooks uses.

---

## Scope of this PR

### In scope

- New boolean column on the `shops` table: `shop_mgmt_enabled` (default `false`).
- New table: `repair_orders`. Minimal columns only — id, shop_id (FK), customer_id (FK), vehicle_id (FK), status (`'open' | 'closed'`), opened_by (profile FK), opened_at, closed_at (nullable), updated_at.
- New nullable column on `sessions`: `repair_order_id` (FK to `repair_orders`). NULL means "no RO" (diagnostic-only shop or pre-toggle session).
- New nullable column on `sessions`: `customer_authorized` (boolean, nullable). Populated from intake form's existing `authorized` field, which is today collected and discarded.
- Intake submission (`POST /api/intake/submit` and `POST /api/sessions`) checks the shop's flag. If on: customer + vehicle + RO + session created in one transaction, session linked to RO. If off: customer + vehicle + session as today, no RO. Either way, the `customer_authorized` value is persisted to the session.
- Drizzle migration applied to local rehearsal DB first, then to live Supabase via MCP `apply_migration`. Live migration is part of this PR per the standing rule (PGlite tests passing does not mean live DB has the schema).
- Unit tests covering both flag paths and the authorized-field persistence.
- One database integration test that runs the intake transaction end-to-end against PGlite.

### Out of scope (deferred to later PRs or follow-ups)

- Any user-visible RO UI — list, detail, create form, edit form. Lands in PR 2 (estimates).
- Self-serve toggle activation (Stripe upgrade flow). For now Brandon flips the flag manually in the live DB for Young Motorsports and Mac's shop. Self-serve lands as part of the future estimates / invoicing PRs once there is something to upgrade to.
- Team management UI (no-invite-flow gap). Affects both modes and is independently scoped — separate small PR, not this one.
- Backfill of historical sessions into ROs. Past sessions stay `repair_order_id = NULL`. If a specific shop wants their history rolled up after-the-fact, a one-off script is fine.
- All seven other shop-management sub-projects.
- RO line items, parts, labor, estimates, totals, invoices, payments, scheduling, dispatch, time clock, comms — none of these land in this PR.

---

## Data model

### `shops` — add one column

| column | type | constraints | meaning |
|---|---|---|---|
| `shop_mgmt_enabled` | boolean | not null, default `false` | When true, the shop has paid for and uses the shop-management module. Gates every shop-management feature added in later PRs. |

### `repair_orders` — new table

| column | type | constraints | meaning |
|---|---|---|---|
| `id` | uuid | primary key, default generated | RO identifier. |
| `shop_id` | uuid | not null, FK → `shops.id` cascade | Which shop. |
| `customer_id` | uuid | not null, FK → `customers.id` restrict | Which customer this RO is for. Restrict on delete — we never silently lose ROs. |
| `vehicle_id` | uuid | not null, FK → `vehicles.id` restrict | Which vehicle. Restrict on delete — same reason. |
| `status` | text | not null, default `'open'`, check in (`'open'`, `'closed'`) | Lifecycle. PR 2 may expand the enum; foundation only needs these two. |
| `opened_by` | uuid | not null, FK → `profiles.id` restrict | Who opened the RO. Comes from the intake handler's authenticated profile. |
| `opened_at` | timestamptz | not null, default `now()` | When opened. |
| `closed_at` | timestamptz | nullable | When closed. NULL while open. PR 2 will populate this; foundation leaves it NULL. |
| `updated_at` | timestamptz | not null, default `now()`, auto-updated | Standard. |

Indexes:
- `(shop_id, status)` — every list query in future PRs will filter on shop and status.
- `(customer_id)` — for customer-history lookups later.
- `(vehicle_id)` — for vehicle-history lookups later.

No partial unique constraint enforcing one open RO per (shop, customer, vehicle). Reason: the typical case is 1:1 RO-to-session today, but the intake handler enforces the invariant in application code, and a DB-level constraint would block future "multi-session per RO" without a migration. Application-level enforcement is enough for foundation.

### `sessions` — add two columns

| column | type | constraints | meaning |
|---|---|---|---|
| `repair_order_id` | uuid | nullable, FK → `repair_orders.id` set null | The RO this session belongs to. NULL for diagnostic-only shops and for any pre-foundation sessions. |
| `customer_authorized` | boolean | nullable | Did the customer authorize the work at intake? NULL for sessions where the field was not collected, true/false otherwise. |

Set-null cascade on `repair_order_id` rather than restrict — a session can outlive an RO logically if we ever need to dissolve an RO; the diagnostic data is more valuable than the RO wrapper.

`customer_authorized` is nullable rather than defaulting false because we are migrating live data — existing sessions never had this value collected, and `NULL` is the honest signal for "we never asked." Future logic that needs a boolean can treat NULL as "not asked" distinct from "asked and answered no."

---

## Behavior change

Only one runtime path changes: intake submission.

### Current behavior (both `POST /api/intake/submit` and `POST /api/sessions`)

1. Authenticated profile resolved.
2. `upsertCustomer(shopId, phone, name, email)` — dedup by `(shopId, phone)`.
3. `upsertVehicle(customerId, year, make, model, vin, plate, mileage)` — dedup by `(customerId, vin)` or `(customerId, year/make/model/plate)`.
4. AI generates the initial decision tree.
5. `sessions` row inserted with the customer/vehicle/tree.
6. Intake form's `authorized` answer is dropped on the floor — never persisted.

### New behavior

1. Authenticated profile resolved.
2. `upsertCustomer` (unchanged).
3. `upsertVehicle` (unchanged).
4. AI generates the initial decision tree (unchanged).
5. **Check `shops.shop_mgmt_enabled` for the current shop.**
   - **If enabled:** insert a `repair_orders` row (status `'open'`, opened_by = current profile, customer_id, vehicle_id, shop_id). Then insert `sessions` row with `repair_order_id` set to the new RO's id, and `customer_authorized` set from the intake form's `authorized` field.
   - **If not enabled:** insert `sessions` row with `repair_order_id = NULL` and `customer_authorized` set from the intake form's `authorized` field.
6. Steps 2 through 5 run in a single database transaction. RO creation failure rolls back the whole intake.

Authentication, validation, and error responses are unchanged from today.

### Intake form

No visible change. The form already collects the `authorized` answer; this PR just plumbs it through to persistence.

---

## Edge cases

**Toggle flips OFF → ON during the lifetime of a shop.**
Future intakes get an RO. Past sessions remain `repair_order_id = NULL`. No automatic backfill. Explicitly documented in the migration commit message so future-Brandon knows where to find the one-off backfill recipe.

**Toggle flips ON → OFF during the lifetime of a shop.**
Future intakes skip RO creation. Existing `repair_orders` rows remain in the table — they are not deleted. No UI today reads them; later PRs that surface ROs must gate the read path on `shop_mgmt_enabled` too, otherwise a shop that toggled off then on again would see stale data they may not want resurfaced. This invariant goes in the PR 2 spec, not here.

**RO creation fails mid-transaction.**
The whole intake transaction rolls back. The tech sees the same error UI as any other intake failure today, retries the submit. No half-created customer/vehicle/RO/session state. Same failure mode as a vehicle upsert failure today.

**Intake submitted with no `authorized` value (form bug, in-flight request, API client other than the form).**
`customer_authorized` saves as NULL. Intake still succeeds. No validation rule on the field — it is documentation, not gating.

**Two intakes for the same customer/vehicle from the same shop within seconds (race).**
The customer dedup logic already handles this (`upsertCustomer` is `(shopId, phone)` unique). Two RO rows can be created — both legitimate, they refer to distinct visits. No deduplication of ROs at this stage. If a real-world race causes nuisance duplicates later, that's a PR 2 problem (when ROs are visible) — fix at that layer.

**Migration applied to PGlite test DB but not to live Supabase.**
Caught by the standing rule baked into this spec's acceptance criteria: live migration is part of this PR, applied via Supabase MCP `apply_migration`, verified before the PR is approved. Without this, every API route touching `repair_orders` 500s in prod the moment the code merges.

---

## Testing

### Unit tests

- `customer_authorized` persists from intake form input to session row.
- `customer_authorized` saves as NULL when omitted from intake form.
- Intake against a shop with `shop_mgmt_enabled = false` creates session with `repair_order_id = NULL` and no `repair_orders` row.
- Intake against a shop with `shop_mgmt_enabled = true` creates exactly one `repair_orders` row with the expected columns, and the session's `repair_order_id` points to it.
- Intake transaction rolls back on simulated RO insert failure — no orphan customer/vehicle/session rows left behind.

### Integration test

- Full PGlite end-to-end pass: shop toggled on, intake POST, verify RO + session + customer + vehicle all present and linked correctly.

### Manual verification on live Supabase after migration

- Brandon flips `shop_mgmt_enabled = true` for Young Motorsports and Mac's shop in the live DB.
- Real intake from the app for each shop.
- Confirm a `repair_orders` row appears with the expected linkage and the session's `customer_authorized` is set.
- Flip `shop_mgmt_enabled = false` for a control shop (any other shop). Real intake. Confirm no RO row created, `customer_authorized` still persisted.

### Per-PR memory checks (from CLAUDE.md / auto-memory)

- Migration is applied to live Supabase via MCP `apply_migration` as part of this PR's task list — not deferred. PGlite passing alone does not close this acceptance criterion.
- Cosmetic UI does not need mobile validation here because there is no UI in this PR.
- Vitest fork-pool flake on cold cache: if `pnpm test` shows "PGlite is closed" errors on the first run, rerun once before treating as a regression.

---

## Acceptance criteria

1. Drizzle migration file present, applies cleanly to a fresh PGlite instance and to the rehearsal DB.
2. Migration applied to live Supabase project via `apply_migration`. Confirmed by reading `shops.shop_mgmt_enabled`, `repair_orders` table existence, and `sessions.repair_order_id` / `sessions.customer_authorized` columns through MCP.
3. `pnpm typecheck` and `pnpm test` pass.
4. New unit tests and the integration test described above pass.
5. Manual live verification (per "Testing" section) executed end-to-end before PR is approved.
6. PR description includes:
   - Plain-English statement of what changed for users (nothing visible).
   - Migration safety note: the change is purely additive — new columns and a new table, no existing data altered, no existing column removed or retyped.
   - Manual SQL one-liner Brandon can run on live DB to flip Young Motorsports and Mac's shops on, included verbatim in the PR description so it is paste-and-run.
7. PR opens against `release/shop-management`. Not against `main`. Not against `staging`.

---

## Risk assessment

**Migration risk:** Low. Three additive columns, one new table. No data alteration. Reversible via `DROP TABLE repair_orders; ALTER TABLE sessions DROP COLUMN ...; ALTER TABLE shops DROP COLUMN ...`. Acceptable.

**Behavior risk:** Low. The only runtime path that changes is intake submission, and only behind a per-shop flag that is `false` for every existing shop. Worst case: bug in the new branch creates a 500 on intake — but only for shops with the flag flipped on, which is two shops (Young Motorsports and Mac's), both of which are trivially observable.

**Coordination risk:** Low. This PR has no UI changes — no Claude Design dependency. It also does not touch any of the in-flight knowledge-page-UI work happening on a different branch.

**Scope-creep risk:** Medium. The temptation to add "just one small UI" or "just persist parts info too while we're here" should be resisted. Anything beyond the In-Scope list in this spec waits for its own PR.
