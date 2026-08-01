# The morning after the import: what Shop OS does when the Mitchell data lands

Audit date: 2026-07-31
Companion to: [`2026-07-30-mitchell1-data-migration.md`](./2026-07-30-mitchell1-data-migration.md) — that document is about getting the data **out** of Mitchell 1. This one is about what happens on **our** side when it arrives.
Method: read-only. Production schema inspected through the Supabase project `ynmtszuybeenjbigxdyl` ("Vyntechs Auto") with `SELECT` and `information_schema` only. No product code changed, no migration run, no production data touched, no customer information copied into this document.

Every claim below cites a file and line, or the exact query that produced it. Anything not verified is labelled **UNVERIFIED**.

---

## The verdict, in plain words

**No. The shop cannot run on Shop OS the morning after the import.** Not because the product is bad — the repair-order machinery underneath is careful, well-tested and honest about money. It is because the product has only ever been asked to hold one repair order, and the import asks it to hold thousands.

Three things decide the answer:

1. **There is no importer.** Not a partial one, not a rough one. There is no code anywhere in this repository that reads a Mitchell file, and no column to put a Mitchell repair-order number in. Every repair order in the system today was typed in through the same web form the advisor uses. Writing the import is not a "last step" — it is the largest single piece of unbuilt work in this whole project.

2. **The shop cannot find a closed repair order.** There is exactly one search box in the entire product, it lives inside the *"start a new repair order"* screen, and it searches customers and vehicles only. It cannot search by repair-order number, and it never returns a repair order. Every one of the shop's imported historical repair orders is closed. On day one, the shop's ten years of history is technically present and practically unreachable except by a four-step detour.

3. **Money on an open repair order cannot survive the trip.** What a customer owes is not stored anywhere. It is recalculated on demand by summing *approved quote snapshots* (`lib/shop-os/ring-out.ts:85-151`). An imported repair order with no quote snapshot owes **$0.00** — and can then be closed and marked delivered without anyone paying. Importing the shop's open repair orders with correct balances means synthesising a valid quote snapshot for every one of them, matching a strict schema (`lib/shop-os/quotes.ts:266-325`), or the money is silently wrong.

Underneath those three, there is a fourth thing the owner should hear plainly: **Shop OS is not yet a shop management system.** It is an excellent repair-order workflow. It has no accounts receivable, no invoice or statement to hand the customer, no appointment book, no reports, and no way to total a day's sales. Mitchell 1 does all of those. Those gaps are covered in section 7 and they are not import problems — they are product problems that the import will make visible on day one.

**Recommended posture:** do not cut over. Run the import into a copy first, work the ranked blocker list below, and keep Mitchell 1 paid and running — exactly as the migration document already recommends in its Pass 4.

---

## Ranked blockers — the order they have to be fixed

Ranked by what stops the shop getting a car in, worked, billed and out of the door on day one. Cheap items are pulled forward where they are independent.

| # | Blocker | What the shop hits | Size |
|---|---|---|---|
| **1** | **No importer exists at all** (§1.1) | Nothing lands. Everything below assumes an importer that has not been started. | **Weeks** |
| **2** | **Decide the columns *before* extraction** (§1.2, §3.3, §3.4, §6.5) | `legacy_ro_number`, odometer-per-visit, customer address, vehicle colour, shop address. If these do not exist when the import runs, the data is dropped and the import has to be redone. | **~1 day of schema**, but it gates everything |
| **3** | **A closed repair order cannot be found** (§2) | Ten years of history becomes write-only. There is no repair-order list and no way to search by number. | **~1 week** — server half already written in draft PR #202 |
| **4** | **Open repair orders arrive owing $0.00** (§4.2) | Silently wrong money on every one of them. Worse than a crash, because nobody notices. | **~1 week**, inside the importer |
| **5** | **A repair order cannot close while money is owed** (§4.4, §7.1) | No accounts receivable at all. Any customer who does not pay in full on pickup strands a repair order open forever. | **1–2 weeks** |
| **6** | **The counter's "ready to collect" lane shows the 25 *oldest* repair orders** (§5.1) | The lane fills with 2015 paperwork; today's finished car never appears. | **Hours** |
| **7** | **New repair orders would attach to the wrong customer** (§5.7) | Customer matching is on phone number alone, first match wins. Invisible at four customers, weekly at three thousand. | **Hours** |
| **8** | **New repair orders restart numbering at 3** (§1.2) | The shop writes RO 000003 the day after closing RO 48213, and no screen anywhere can fix it. | **Hours** + a decision |
| **9** | **An employee who signs up gets their own private shop** (§6.3) | Happens the first morning everyone creates an account. Nine such orphan shops already exist in production. | **~4 hours** |
| **10** | **Counter search would crawl, and mis-sort** (§5.3) | Measured against production: unindexed full scans on every keystroke, plus a sort key the import will leave blank. | **~1 day** |
| **11** | **No printable invoice, receipt or statement** (§7.2) | Nothing to hand the customer. The product's one "Print receipt" button is disabled in code. | **~1 week** |
| **12** | **No end-of-day sales total** (§7.7) | The drawer cannot be balanced. Cheapest blocker on the list — the data model is already right. | **~2–3 days** |
| **13** | **No deferred-work callback list** (§7.3) | The reasons are already captured and nothing can read them back. In a real shop this list *is* the marketing department. | **~1–2 days** |

**Start the A2P 10DLC carrier registration now, in parallel** (§7.8). Customer texting does not exist and its lead time is measured in weeks and is outside anyone's control. It does not block day one, but starting it late blocks the month.

Everything else — appointments, sales-tax reporting, technician efficiency, parts ordering, warranty, time clock — is in sections 5 through 7 with severities and sizes. Inventory is **not** on that list: the owner has ruled it out (§7.10).

---

## 1. Repair-order numbers

### 1.1 There is no importer, and no place to put a Mitchell repair-order number — **BLOCKER**

**What the shop would experience:** nothing happens. There is no button, script, or admin screen that takes Mitchell data in. Someone has to write one from scratch first.

The migration document proposes storing the original Mitchell number in "a dedicated, permanent, immutable column (`legacy_ro_number`), indexed and searchable, and **display it** on the migrated ticket." None of that is built:

- The `tickets` table has 22 columns and none of them is a legacy number. Verified directly against production:
  `select column_name from information_schema.columns where table_name='tickets'` → `id, shop_id, ticket_number, source, customer_id, vehicle_id, concern, when_started, how_often, diagnostic_authorized_cents, diagnostic_authorization_note, status, created_by_profile_id, canceled_at, canceled_by_profile_id, canceled_reason, delivered_at, delivered_by_profile_id, closed_at, closed_by_profile_id, created_at, updated_at`. Same list in `lib/db/schema.ts:256-283`.
- There is no import script. `scripts/` contains three files — `db-migrate.mjs`, `shop-os-golden-browser.mjs`, `test-shards.mjs`. A repository-wide search for "mitchell" outside the `docs/` folder returns nothing.
- The one path that creates a repair order in code is `insertTicketInTransaction` (`lib/tickets.ts:772-794`), and its own type signature refuses legacy data: `source: 'counter' | 'tech_quick' | 'quick_quote'` (`lib/tickets.ts:760`).

**The `legacy_repair_order` value is a decoy.** The database *does* accept a fourth source value, `legacy_repair_order` (`lib/db/schema.ts:263`), and the ticket screen even has a label for it (`components/screens/ticket-detail.tsx:44`). It is not for Mitchell. It was created in July 2026 by a one-time backfill that wrapped the app's own old AI diagnostic sessions into the then-new repair-order tables (`drizzle/migrations/0026_shop_os_ticket_spine.sql:315-345`). Do not mistake it for import support.

**Fix:** weeks. The importer has to write, in one transaction per repair order, across `customers`, `vehicles`, `tickets`, `ticket_jobs`, `job_lines`, `quote_versions`, `quote_events` and `ticket_payments`, honouring the constraints in §4 below. Add the `legacy_ro_number` column and an index at the same time — that part is an hour.

### 1.2 Our numbering will not continue the shop's series — **BLOCKER**

**What the shop would experience:** on Friday they close RO 48213 in Mitchell. On Monday the first repair order they write in Shop OS is numbered **RO 000003**.

Shop OS numbers repair orders from a counter on the shop record. Each new repair order bumps `shops.next_ticket_number` by one and takes the old value (`lib/tickets.ts:772-786`):

```
.update(shops).set({ nextTicketNumber: sql`${shops.nextTicketNumber} + 1` })
...
ticketNumber: sequence.nextTicketNumber - 1,
```

The Young Motorsports production shop record currently reads `next_ticket_number = 3` (verified: `select next_ticket_number from shops`). Nothing in the import path touches it, because there is no import path. Unless someone runs SQL by hand, the shop's numbering restarts at 3.

**There is no screen to change it.** A search across every `.ts` and `.tsx` file finds exactly one write to `next_ticket_number` — the increment above. No settings page, no API route, no admin tool. Re-seeding it is a manual SQL statement against production, with no confirmation and no undo.

**Fix:** hours of code — but it needs a decision from the owner first. The migration document proposes *both* keeping Mitchell's number in a separate `legacy_ro_number` column *and* seeding our sequence to `max+1`. Those two together create a subtle problem, see 1.4.

### 1.3 Two shops cannot collide; a re-import can — **PAINFUL**

**What the shop would experience:** if the import is run twice — which the migration plan explicitly calls for, "a dry run today, a second dry run next week, and a final delta pull the night of cutover" — the second run either crashes halfway or silently duplicates every customer and vehicle.

- **Across shops: safe.** The uniqueness is per-shop: `CREATE UNIQUE INDEX tickets_shop_ticket_number_uq ON tickets (shop_id, ticket_number)` (verified in production; `lib/db/schema.ts:305`). Two shops can both have RO 1000.
- **Re-import into the same shop: unsafe.** That same unique index means a second run inserting the same repair-order numbers fails with a duplicate-key error partway through, leaving a half-imported database.
- **Customers and vehicles are worse — they duplicate silently.** There is no unique constraint that would catch a repeat. Production indexes on `customers` are only `customers_pkey`, `customers_shop_id_id_uq` and a non-unique `customers_shop_id_phone_idx`. On `vehicles`, only `vehicles_pkey`, `vehicles_customer_id_id_uq`, and non-unique indexes on `customer_id` and `(customer_id, vin)`. Nothing stops the same person or the same VIN being inserted twice. There is no `external_id` column anywhere to key a re-run against.

**Fix:** a day, inside the importer — carry the Mitchell primary key on every imported row and upsert against it.

### 1.4 History would display in import order, not date order — **PAINFUL**

**What the shop would experience:** a truck's visit list on the vehicle page is in the wrong order, and it looks random.

The vehicle history query sorts by our repair-order number, not by date: `.orderBy(desc(tickets.ticketNumber))` (`lib/tickets.ts:243` and `:263`). The same is true of the counter list (`lib/shop-os/ready-to-collect.ts:88`) and the Today board (`lib/tickets.ts:583`). Everywhere in the product, the repair-order number is used as a stand-in for chronology.

That is fine as long as our number *is* Mitchell's number. If the plan instead keeps Mitchell's number in a separate `legacy_ro_number` column and assigns our own sequence 3, 4, 5… in whatever order the importer happens to loop, then a truck's ten-year history sorts by import order. **Recommendation: put Mitchell's number directly into `ticket_number` and seed the sequence to `max+1`.** Keep `legacy_ro_number` as well if you want a permanent immutable copy, but the number the product sorts and displays should be the shop's real one.

---

## 2. Finding anything after the import

### 2.1 There is no way to look up a repair order. At all. — **BLOCKER**

**What the shop would experience:** a customer walks in holding an invoice for RO 47188 and asks what was done. The advisor has nowhere to type "47188". There is no search box on the home screen. Typing it into the only search box in the product returns nothing.

Precisely, from each screen:

| Screen | Can the advisor find a closed repair order? |
|---|---|
| `/today` (the home screen) | **No.** There is no search field. The board only ever queries `eq(tickets.status, 'open')` — `lib/tickets.ts:563`. Closed work is excluded by the query. |
| `/intake` (start a new repair order) | **Partly, sideways.** The one search box lives here (`components/screens/counter-intake.tsx:515`). It searches customers and vehicles only, never repair orders — `lib/intake/search.ts:83-98` and `:171-189`. A repair-order number typed here matches nothing. |
| `/vehicles/{id}` (vehicle history) | **Yes, if you already know the vehicle.** Reachable only by clicking a vehicle in the intake dropdown (`components/vt/intake-search/dropdown.tsx:387`) or from an open repair order (`components/screens/ticket-detail.tsx:362`). |
| `/tickets/{id}` | **Only by direct link.** There is no repair-order index page — the full list of pages under `app/(app)/` is intake, sessions, settings, subscribe, tickets/[id], tickets/new, today, vehicles/[vehicleId], whats-new. There is no `/tickets` list and no `/customers` page. |

**So the real day-one workflow is:** press "New repair order" → type the customer's name → click their vehicle → scroll the visit list → click the right repair order → press back twice to get out of the half-started new repair order you never meant to create. Four extra steps, on a screen designed for something else, and it fails outright if the advisor only has the RO number.

**What it costs on day one:** every returning-customer conversation at the counter, every warranty question ("you did this brake job eight months ago"), every parts-return lookup, every "what did I quote him last time". That is not an edge case in an independent shop; it is most of the counter's day.

### 2.2 The fix is half-written and parked — **BLOCKER (but cheaper than it looks)**

PR **#202**, `feat/row61-repair-order-lookup`, is **open and unmerged**, and its own description says: *"Nothing routes to it yet, so it is unreachable in the product."*

It adds one file, `lib/shop-os/ticket-lookup.ts`, with a `lookupTickets` function that does exactly the right thing: folds `12`, `#12`, `RO 12` and `RO#12` into the same query, matches repair-order number or customer name or plate or VIN or make or model, is tenant-scoped, and carries no money so a technician can find work without seeing a balance. It has 18 passing tests. It is genuinely good work.

It is also only the server half. There is no API route and no screen. The missing piece is a search field on `/today` and a route to call it.

**Two cautions before it ships against ten thousand repair orders:**

- **It is capped at ten results** (`TICKET_LOOKUP_LIMIT = 10`, in the PR diff) with no paging. Searching "Ford" in a shop with 4,000 Fords returns ten of them, ordered by newest repair-order number, with no way to see the eleventh.
- **Every search term is a wildcard match on unindexed text.** The lookup builds `ILIKE '%token%'` over `customers.name`, `customers.phone`, `vehicles.plate`, `vehicles.vin`, `vehicles.make`, `vehicles.model`. A pattern that starts with `%` cannot use a normal database index, and production has no text-search indexes at all — I checked every index on `customers` and `vehicles` in production and searched the migrations for `pg_trgm`, `gin`, `gist` and `to_tsvector`; there are none. On one repair order that is instant. On 10,000 joined to 4,000 customers and 5,000 vehicles it is a full scan **per keystroke**, because the search box fires as you type (`lib/intake/use-search.ts:80`).

**Fix:** roughly a week — finish the route and the Today screen, add a trigram index, add paging.

### 2.3 The existing intake search will slow down and mis-sort — **PAINFUL**

**What the shop would experience:** the customer-name search that feels instant today takes a visible pause after the import, and the results come back in a nonsensical order.

Two separate causes:

- **Unindexed wildcard search, computed twice per row.** `searchIntake` matches with `ILIKE '%…%'` on name, phone and email (`lib/intake/search.ts:66-72`), then *orders* by a correlated sub-select that runs once per matching row (`lib/intake/search.ts:76-81`, used again in the `ORDER BY` at `:97`). The `LIMIT 5` is applied after the sort, so the sub-query runs for every match, not just the five returned. Same shape on the vehicle side (`:167-189`).
- **"Last visit" will be blank for every imported customer.** That sort key reads `MAX(sessions.created_at)` — the *AI diagnostic sessions* table, not repair orders (`lib/intake/search.ts:77`). Imported Mitchell history creates `tickets`, not `sessions`. Every imported customer's last visit computes as null, falls back to `TIMESTAMP 'epoch'`, and the "most recent customer first" ordering collapses into an arbitrary tie. A ten-year customer sorts the same as a stranger.

**Fix:** half a day to point "last visit" at `tickets`; a further half day for the index.

---

## 3. Vehicle and customer history

### 3.1 The history screen is bounded and correct — **no finding**

Worth saying plainly, because it is the one place the volume story is already handled. `listVehicleTicketHistory` (`lib/tickets.ts:225-317`) fetches at most 101 repair orders, uses the 101st only as a "there is more" flag, and pulls at most 26 jobs per repair order through a lateral join rather than a query-per-row. It will not fall over on a truck with 200 visits. Good work.

### 3.2 What it shows is a shadow of what Mitchell shows — **PAINFUL**

**What the shop would experience:** they open a truck with ten years of history and see a list of dates, complaints and job titles. No dollars. No parts. No mileage. Nothing they can quote from or defend a warranty claim with.

Everything the screen can display is in one type (`lib/tickets.ts:161-172`) and it is: repair-order number, complaint, status, opened date, closed date, and per job the title, kind, approval state and work status. The rendering confirms it (`components/screens/vehicle-history.tsx`) — searching that file for any money formatting finds none.

Dropped versus what Mitchell holds:

| Not shown | Where it would have to come from |
|---|---|
| What the visit cost | `quote_versions.snapshot` or `job_lines`; neither is read by this screen |
| Parts fitted, part numbers, brands | `job_lines.part_number` / `.brand` (columns exist, verified in production) |
| Labour hours and rate | `job_lines.labor_hours` / `.labor_rate_cents` (exist) |
| **Odometer at that visit** | **Nowhere. There is no such column.** See 3.3. |
| Which technician did the work | `ticket_jobs.assigned_tech_id` (exists, not surfaced here) |

The one genuinely good thing here: declined jobs are pulled out into a "recommended" section (`components/screens/vehicle-history.tsx:60-68`), so deferred work *is* visible — per vehicle. There is no shop-wide version of it. See §7.

### 3.3 Mileage at each visit is lost forever — **PAINFUL**

**What the shop would experience:** the shop can never answer "how many miles ago did we do that?", and every service-interval and warranty judgement is guesswork.

`vehicles.mileage` exists (verified in production) and holds *one* number — the vehicle's current mileage. The `tickets` table has no mileage column at all (full column list in §1.1). Mitchell records the odometer on every repair order. Every historical odometer reading in the shop's ten years of data has nowhere to go.

**Fix:** hours to add `tickets.mileage_in`, plus the importer and history-screen work. But it must be decided **before** the import, because the source data will not be re-read.

### 3.4 Customer and vehicle records will silently lose fields — **PAINFUL**

**What the shop would experience:** the mailing addresses are gone. So are the fleet unit numbers, the vehicle colours, the second phone numbers and the customer notes.

Verified in production, `customers` has exactly seven columns: `id, shop_id, name, phone, email, created_at, updated_at`. There is no address, city, state, ZIP, second phone, company name, or notes field.

`vehicles` has: `id, customer_id, year, make, model, engine, vin, mileage, plate, created_at, updated_at, platform_id`. No colour, no trim/sub-model, no transmission, no licence state, no fleet unit number, no notes.

Two of those constraints will actively **reject** rows rather than lose a field:

- `customers.phone` is `NOT NULL`. Any Mitchell customer with no phone on file cannot be inserted as-is.
- `vehicles.year`, `.make` and `.model` are all `NOT NULL`, and `year` is an integer. Any vehicle with a blank or non-numeric year cannot be inserted as-is.

The migration document rightly notes that Identifix drops vehicle colour and production date and that this is "trivially avoidable". It is only avoidable if the columns exist. They do not.

There is also a modelling difference worth flagging: **`vehicles` has no `shop_id`.** A vehicle belongs to a customer, and tenancy is inferred by joining through `customers` (`lib/intake/search.ts:186-187`). In Mitchell a vehicle can change owners. Here that is a different row, and the history splits.

**Fix:** a day for the columns and the migration; the real cost is that it has to be decided before extraction.

---

## 4. The open repair orders, and the money

This is the section the owner should read twice. The machinery here is careful and well-tested — and that carefulness is exactly what makes an import hard, because every guard assumes the repair order was built by a human clicking through the product in order.

### 4.1 The state machine will accept an imported repair order in any state — **no finding**

Good news first. Nothing structurally prevents representing a partly-finished repair order. The states are plain text columns with check constraints, not a locked-down transition table:

- `tickets.status` ∈ open / closed / canceled (`lib/db/schema.ts:328`)
- `ticket_jobs.work_status` ∈ open / in_progress / blocked / done / canceled (`lib/db/schema.ts:390`)
- `ticket_jobs.approval_state` ∈ pending_quote / quote_ready / sent / approved / declined / deferred (`lib/db/schema.ts:393`)

An importer writing directly to the database with the service role can put a job into `in_progress` + `approved`, or `done` + `declined`, or any other combination. There are no triggers on `tickets` or `ticket_jobs` blocking it. There *are* append-only and immutability triggers, but only on `quote_events` (`drizzle/migrations/0028_shop_os_quote_foundation.sql:277-293`), `quote_versions` (`:296-329`) and `ticket_activity` (`drizzle/migrations/0045_shop_os_interruption_ledger.sql:70-87`) — all of which an importer can satisfy by inserting rows once and never updating them.

### 4.2 An imported open repair order will show a balance of $0.00 — **BLOCKER**

**What the shop would experience:** a truck arrives with $2,400 of approved work on it. Shop OS shows the customer owes nothing, and cheerfully lets the advisor close the repair order and hand back the keys.

The amount owed is **never stored**. It is recomputed every time from approved quote snapshots (`lib/shop-os/ring-out.ts:85-151`). For a job to contribute a single cent it must satisfy all four of:

1. `approval_state = 'approved'` (`ring-out.ts:101`)
2. `approved_quote_version_id` is not null (`ring-out.ts:127`)
3. a matching row exists in `quote_versions` for that ticket (`ring-out.ts:112-122`)
4. that row's `snapshot` JSON parses against the strict schema and contains this job by id (`ring-out.ts:130`, into `readApprovedJobBreakdown` at `lib/shop-os/quotes.ts:354-366`)

Any job failing any of those is skipped by `continue`. Nothing warns. Nothing logs. The total is simply lower.

That schema is not forgiving. `quoteSnapshotSchema` (`lib/shop-os/quotes.ts:266-325`) is a `z.strictObject` — it rejects unknown keys — and requires `schemaVersion: 1`, a full ticket header with UUID customer and vehicle ids, at least one job, per-job `totals.subtotalCents` and `totals.taxableSubtotalCents`, and per line a UUID, a kind, a description, a decimal-string quantity, a price in cents, a taxable flag, and cross-field rules (a part line may not carry labour fields; a labour line must have hours). The importer has to construct all of this per repair order, correctly, or the money is wrong and silent.

**Fix:** roughly a week inside the importer, and it needs a reconciliation report the owner signs off — total of imported open balances versus the Mitchell A/R aging report from Pass 0.

### 4.3 The tax rate must be set or quoting fails with an unhelpful error — **BLOCKER if unset**

**What the shop would experience (if the rate were blank):** the advisor builds a quote, presses save, and gets "conflict". Nothing tells them the tax rate is missing.

`buildQuoteSnapshot` throws when the shop's tax rate is null (`lib/shop-os/quotes.ts:1245-1248`):

```
if (context.shop.taxRateBps === null || !Number.isInteger(context.shop.taxRateBps)
  || context.shop.taxRateBps < 0 || context.shop.taxRateBps > 10_000) {
  throw new RangeError('shop tax rate is unconfigured or unsafe')
}
```

The caller swallows the reason and returns a generic conflict (`lib/shop-os/quotes.ts:1509-1513`).

**For Young Motorsports specifically this is already fine.** Verified in production: `labor_rate_cents = 15500` ($155.00/hr), `tax_rate_bps = 825` (8.25%). Recorded here because it is a live trap for the *next* shop, and because the error message gives the advisor no way to work it out.

One thing worth the owner's eye: `parts_markup_bps = 0` on the production shop record — parts are configured to sell at zero markup. That may be deliberate; it is worth confirming before the shop bills anything real. (Whether that field actually drives pricing is covered in §6.)

### 4.4 A repair order cannot be closed while money is owed — **BLOCKER**

**What the shop would experience:** a fleet customer picks up a truck and says "bill me". The advisor cannot close the repair order. It stays on the open board forever, and the shop has no list of who owes what.

`closeTicket` refuses outright (`lib/shop-os/ring-out.ts:393-395`):

```
if (owed.totalCents - paidCents > 0) {
  return { ok: false as const, error: 'balance_outstanding' }
}
```

Related hard edges in the same file:

- **No partial-payment close, no write-off, no discount.** The only escape is recording a payment that never happened.
- **Overpayment is rejected** (`ring-out.ts:300-302`), and payments must be positive (`ticket_payments_amount_positive`, `lib/db/schema.ts:1150`). **There is no refund and no correction.** A payment entered at $1,200 instead of $120 can only be fixed with direct SQL — and even then, the shop cannot do it.
- **Closing sets `delivered_at` to now** (`ring-out.ts:404`), so imported closed repair orders must be written directly to the database, not pushed through this path.

This is the single largest functional gap versus Mitchell. Mitchell has full accounts receivable; the migration document notes Identifix explicitly refuses to migrate A/R and treats that as our differentiator. It cannot be our differentiator until it exists on this side.

**Fix:** 1–2 weeks. Allow close-with-balance, add an A/R list, add reversing entries.

### 4.5 Adding one job to an in-progress repair order wipes every prior approval — **PAINFUL**

**What the shop would experience:** the technician finds one more thing, the advisor adds it, and now the customer has to re-approve the three items they already approved this morning.

A quote covers the whole repair order, and only one version can be live at a time. Creating a new version supersedes the old one and resets every job it contained back to `pending_quote`, clearing `approved_quote_version_id` (`lib/shop-os/quotes.ts:1524-1546`). Approving a job also requires exactly one active version (`lib/shop-os/quotes.ts:1775`: `activeVersions.length !== 1`).

There is a partial escape: jobs already `in_progress` or `done` are treated as pinned and left alone (`isPinnedSimpleWork`, `lib/shop-os/quotes.ts:480-486`). So approvals only evaporate for work that has been approved but not started — which, on a shop floor waiting on parts, is most of it.

This matters on import day beyond the everyday friction: the imported open repair orders are the ones most likely to have work added mid-stream in week one.

### 4.6 Pinned work never gets billed — **PAINFUL, and it is a money bug**

Follow the two rules in 4.5 and 4.2 together. `buildQuoteSnapshot` **excludes** pinned jobs from the snapshot entirely (`lib/shop-os/quotes.ts:1257-1259`):

```
.filter((job) => job.workStatus !== 'canceled'
  && !isPinnedSimpleWork(job)
  && (linesByJob.get(job.id)?.length ?? 0) > 0)
```

A job excluded from the snapshot never gets an `approved_quote_version_id`. A job with no `approved_quote_version_id` contributes $0.00 to the bill (`ring-out.ts:127`). So a repair job that was started before the next quote version was cut can end up **complete and unbillable**.

I have not reproduced this end-to-end against a running database, so: **UNVERIFIED as a live reproduction.** The two code paths and their interaction are verified at the lines above. It deserves a test before the shop bills anything real, import or no import.

---

## 5. Volume — what a real amount of data does to the screens

Every number in this section was checked against the production database. Two things are worth saying up front, because they are good and they were not guaranteed:

- **Every index the code declares actually exists in production.** All indexes on `tickets`, `ticket_jobs`, `customers`, `vehicles`, `sessions`, `profiles`, `quote_versions`, `job_lines`, `job_part_requests`, `ticket_payments`, `ticket_activity` and `canned_jobs` were compared against `pg_indexes`. **Zero drift.** That is not typical and it is worth knowing.
- **The Today board's own query will not fall over.** It filters `eq(tickets.status, 'open')` (`lib/tickets.ts:563`), so ten thousand closed repair orders cost it nothing, and every join and filter column is covered by an index that is present in production. The five part-request sub-queries sit in the SELECT list (`lib/tickets.ts:455-504`), so they run only for rows that are actually returned. **UNVERIFIED caveat:** production has four tickets, so the query plan at ten thousand could not be measured — only that the indexes for the good plan exist. One `EXPLAIN ANALYZE` against the restored copy during Pass 1 settles it.

There is also no full-table `COUNT(*)` on any shop screen, and no tenant-scoped query anywhere in `lib/` or `app/` that forgot its `WHERE`.

Now the problems.

### 5.1 The counter's "ready to collect" list would show the 25 oldest repair orders — **BLOCKER**

**What the shop would experience:** the lane at the counter that is supposed to show cars finished and waiting to be paid for fills up with paperwork from 2015, and the truck the customer is standing there to collect is not on it.

Two lines do it. The query is capped at 25 (`READY_TO_COLLECT_LIMIT = 25`, `lib/shop-os/ready-to-collect.ts:30`) and sorted **oldest first** — `.orderBy(asc(tickets.ticketNumber))` (`lib/shop-os/ready-to-collect.ts:88`). The lane holds every open repair order with no active job left on it. Every imported open repair order whose work was already finished qualifies, and every one of them has a lower repair-order number than anything written after the cutover.

**Fix:** hours — sort newest first and raise or page the cap. This is the highest ratio of pain-avoided to effort in the entire audit.

### 5.2 That same lane asks the database ~100 questions, every twenty seconds, forever — **PAINFUL**

**What the shop would experience:** the wall display and the home screen both get slow and stay slow, all day, and the database bill goes up.

`listReadyToCollectTickets` calls the full money calculation once per card (`lib/shop-os/ready-to-collect.ts:96-99`). Each of those is four sequential queries (`lib/shop-os/ring-out.ts:214-224`, `:88-101`, `:110-118`, `:158-171`). Twenty-five full cards is roughly a hundred round trips. The database connection pool is the postgres-js default of ten (`lib/db/client.ts:9` sets only `{ prepare: false }`), so those hundred queries serialise into ten or twelve waves.

It runs on `/today` (`app/(app)/today/page.tsx:23`), on the wall display (`app/floor/page.tsx:23`), and on the polling API (`app/api/today/jobs/route.ts:17`) — which both screens re-hit **every twenty seconds** (`components/screens/floor-board.tsx:48`, `components/screens/today-jobs-board.tsx:185`).

The code says so itself, honestly, at `lib/shop-os/ready-to-collect.ts:93-95`: *"a shop has only a handful of repair orders waiting at the counter at once."* Sixty-seven open repair orders is the assumption breaking.

**Fix:** about half a day — batch the money calculation into one query keyed by the 25 ticket ids.

### 5.3 The customer search box scans every customer and every vehicle on each keystroke — **BLOCKER**

**What the shop would experience:** typing a customer's name at the counter goes from instant to a visible pause, and gets slower every year the shop operates.

This was measured, not guessed — a real `EXPLAIN` against production:

- The filter is a leading-wildcard match (`ILIKE '%token%'`, `lib/intake/search.ts:49-53`), which no ordinary index can serve, and `customers` has **no index on `name` or `email` at all** (`lib/db/schema.ts:156-157` declares only `(shop_id, phone)` and `(shop_id, id)`). Production plan: `Seq Scan on customers … Filter: (name ~~* '%sm%' OR phone ~~ '%sm%' OR email ~~* '%sm%')`.
- **The expensive part is the sort, not the filter.** The "last visit" sub-query is used inside the `ORDER BY` (`lib/intake/search.ts:97`), so Postgres evaluates it for **every matching row before the `LIMIT 5` applies**. The production plan puts that sub-plan *under* the Sort node, and each execution is another sequential scan of `sessions` and `vehicles`. There is no index on `sessions.vehicle_id` in production.
- The vehicle half is worse: the match condition spans both `vehicles` and `customers` (`lib/intake/search.ts:155-165`), so the filter cannot be pushed into either table and Postgres hash-joins the full sets first.
- The box fires as you type, on a 150 ms debounce (`lib/intake/use-search.ts:5`). The browser aborts the request when you keep typing; **the database query keeps running**.

No trigram indexing is available today — `pg_trgm` is not installed in production (confirmed against `pg_extension`).

**Fix:** about a day — install `pg_trgm`, add GIN indexes on the searched text, move the last-visit lookup out of the `ORDER BY` into a lateral join applied after the limit, and index `sessions(vehicle_id)`. (Better still, re-source last-visit from `tickets`, per §2.3.)

### 5.4 "Recent customers" will be permanently empty — **ANNOYING**

The zero-query "recent today" list inner-joins `sessions` (`lib/intake/recent-customers.ts:42-50`), which the Mitchell import will not populate and which the disabled diagnostics feature no longer creates. It will return nothing, forever. Same root cause as §2.3 and the same fix.

### 5.5 The Today board stops at 200 jobs, and there is no other door — **BLOCKER, conditionally**

**What the shop would experience:** the home board shows 200 jobs and one line of small text, and the work past 200 has no other way to be reached.

`TODAY_JOB_LIMIT = 200` (`lib/tickets.ts:403`, applied at `:587` and `:601`). The only signal to the user is a notice reading *"Showing the first 200 active jobs. Assigned work appears first; remaining work stays stored."* (`components/screens/today-jobs-board.tsx:797-800`).

For an owner or advisor this matters more, not less, because `canAssignWork` is true and the query therefore matches **every active job in the shop**, not a personal slice (`lib/tickets.ts:560-575`). Sixty-seven open repair orders at three to five jobs each lands somewhere between 200 and 350. Which side of the line it falls on is decided entirely by how the importer maps Mitchell's repair-order lines into jobs — and that importer does not exist yet, so this is genuinely undetermined.

**Compounding it:** the board sorts oldest-first within each group (`asc(tickets.ticketNumber)`, `lib/tickets.ts:583`), so if it does overflow, the work that gets cut is the **newest** — the cars actually in the shop today.

**Fix:** raising the cap is minutes. Making the overflow reachable is the same work as the repair-order lookup in §2.2.

### 5.6 The wall display's lane counts would quietly under-report — **PAINFUL**

**What the shop would experience:** the shop-floor screen says "12 need a tech" when there are 20, with nothing on screen to suggest it is wrong.

`components/screens/floor-board.tsx:104` renders `lane.total`, computed at `lib/shop-os/floor-board.ts:237` from the list that was **already truncated at 200**. Unlike the Today board, the floor board never receives or renders a "there is more" flag (`lib/shop-os/floor-board.ts:184-190`). A wrong number with no warning is worse than a missing one. (The `+N more` tail on each lane is the intentional 16-row display budget and is fine.)

**Fix:** a few hours.

### 5.7 New repair orders would attach to the wrong customer — **BLOCKER**

**What the shop would experience:** an advisor writes up a new car, and it lands on a different person's account — a spouse, a business partner, or one of the hundreds of imported records that share a placeholder phone number.

`upsertCustomer` matches on **phone number alone**, takes the first row it finds, and returns it as the customer (`lib/intake/customers.ts:15-20`). No name check, no disambiguation, no "did you mean". It is called from both ways of creating a repair order (`lib/intake/quick-ticket.ts:199`, `lib/intake/counter-ticket.ts:283`).

`customers.phone` is `NOT NULL` (`lib/db/schema.ts:150`), so every Mitchell customer with no phone on file has to be imported with some placeholder — and every one of them then collides with every other one.

This is a correctness bug, not a speed bug, and it is invisible at four customers because no two share a phone. At three thousand it is a weekly occurrence, and the damage — work history and money on the wrong account — is the kind a shop discovers months later.

**Fix:** a few hours — match on phone *and* name, or return the matches and make the advisor choose.

### 5.8 Two more, smaller

- **The canned-job library loads whole, every column, with no limit, on four screens** — `lib/shop-os/canned-jobs.ts:459-462` has no `.limit()` and no column projection, so the JSON line payloads come too. It is server-rendered into `app/(app)/intake/page.tsx:32`, `app/(app)/settings/shop/page.tsx:40`, `app/(app)/tickets/new/page.tsx:30` and `app/(app)/tickets/[id]/quote/page.tsx:65`, then filtered in the browser (`components/screens/counter-intake.tsx:202-203`), and one screen renders every entry as a single dropdown option (`components/screens/quick-ticket.tsx:564`). **PAINFUL** — but only if the imported library is large. Count the rows during Pass 1 before spending the half day.
- **A long-standing vehicle's history page ships up to 2,500 rows in one scroll** — 100 visits × 25 jobs (`lib/tickets.ts:154`, `lib/shop-os/job-limits.ts:6`), with no "load more", only a static line (`components/screens/vehicle-history.tsx:170-173`). The query is properly bounded and indexed; this is page weight, not a slow query. **ANNOYING.**

### 5.9 Not an import-day problem, but do not rediscover it later

Three unbounded helpers on the AI-diagnostics side: `listSessionsForShop` (`lib/db/queries.ts:122-131`, no limit, **no callers**), `listSessionsForVehicle` (`:148-156`, no limit, no index on `sessions.vehicle_id`, **no callers**), and `countOpenSessionsForTech` (`:170-178`, fetches every matching row and counts them in JavaScript). Diagnostics are hard-disabled (`app/(app)/today/page.tsx:19`) and the Mitchell import will not populate `sessions`, so none of this bites on import day.

---

## 6. Settings the shop must set before it can work

The good news first, because it is genuinely good: **the settings surface is more complete than the rest of this audit would lead you to expect.** There are four settings screens (`components/vt/settings-list.tsx:13-18`) and between them the owner can set almost everything that matters, without anyone touching the database.

| What | Screen? | Set for Young Motorsports today? | What happens if it is blank |
|---|---|---|---|
| Shop name | Yes — `components/vt/shop-section.tsx:52-56` | Yes | Cosmetic |
| **Labour rate** | Yes — `components/vt/rates-section.tsx:206-223` | **Yes, $155.00/hr** | Quoting still works, but hours × rate stops; the advisor types a dollar total per labour line (`lib/shop-os/quote-builder-ui.ts:499-502`) |
| **Tax rate** | Yes — `components/vt/rates-section.tsx:186-203` | **Yes, 8.25%** | **Quoting is blocked.** Honestly, though: the button is disabled with the literal message *"Configure a tax rate in shop settings."* (`lib/shop-os/quote-builder-ui.ts:416`) |
| **Parts markup** | Yes — `components/vt/rates-section.tsx:226-243` | **Yes — and it is set to 0%.** See below | Sourcing screen lets the operator type the customer price instead |
| Canned jobs | Yes, one at a time — `components/vt/canned-jobs-section.tsx:117-128` | 3 exist across all shops | Nothing breaks; the advisor types every job by hand |
| Staff, roles, skill tiers | Yes — `components/vt/team-section.tsx:105-113`, real invite emails via `app/api/team/invite/route.ts:40-41` | Partially — see 6.3 | A tech with no skill tier cannot be assigned work (`lib/tickets.ts:1072-1080`) |
| Suppliers | Yes — `components/vt/suppliers-section.tsx:147-188` | 3 accounts | Manual part entry only |

### 6.1 Parts are configured to sell at cost — **deferred, owner decision 2026-07-31**

**There is no parts-supplier integration yet, so a markup on nothing prices nothing.** The owner has deferred this until supplier ordering exists (§7.9). Do not raise it as a live defect before then; the section below is kept only so the mechanism is understood when that day comes.

**What the shop would experience:** every part the parts person sources is priced to the customer at exactly what the shop paid for it, and on that screen there is no box to change it.

Verified in production: `parts_markup_bps = 0` on the Young Motorsports shop record. The sourcing screen multiplies cost by `(10000 + markupBps) / 10000` (`lib/shop-os/parts-sourcing-ui.ts:178`) — at zero, that is cost. Worse, when the markup is a real number the customer-price field is **read-only derived text**; only when the markup is *null* does the operator get an editable price box (`components/screens/manual-part-sourcing.tsx:553-584`). So `0` is a worse state than "not set". The price can still be corrected later in the quote builder, so no money is unrecoverably lost — but the default the shop would work from is zero gross profit on parts.

**Fix:** fifteen minutes to set a real number. About two hours to make the derived price overridable at the point of sourcing.

### 6.2 Canned jobs cannot be loaded in bulk — **PAINFUL**

**What the shop would experience:** all of the shop's saved service templates get re-typed by hand, one at a time.

The editor is complete — title, work type, skill tier, lines with part/labour/fee, price, taxable (`components/vt/canned-jobs-section.tsx:161-176`). There is simply no import. No CSV route under `app/api/shop/`, no import script in `scripts/`. A real shop typically carries 50–300 canned jobs; production has 3.

The migration document flags this as a differentiator — *"Note Identifix explicitly drops canned jobs; we shouldn't."* We currently would, unless someone types them.

**Fix:** about a day for a paste-a-list or CSV endpoint.

### 6.3 An employee who signs up instead of using the invite gets their own private shop — **BLOCKER on day one**

**What the shop would experience:** a technician creates an account the obvious way, sees an empty shop with none of the shop's work in it, and the owner has no way to pull them in. Re-inviting them fails.

`ensureProfileAndShop` creates a brand-new shop with the person as `owner` for anyone who arrives without an invite (`lib/db/queries.ts:74-94`). Once that has happened, the owner's invite is rejected with `already_in_other_shop` (`lib/shop-os/team.ts:102-110`), and there is no "join an existing shop" path anywhere. Fixing it means SQL.

This is not hypothetical. **Production already contains nine orphan single-owner shops** created exactly this way, all still named after an email address with every rate left blank (verified: `select name, labor_rate_cents, tax_rate_bps from shops`).

On a cutover morning, when every one of the shop's staff creates an account at roughly the same time, this will happen to somebody.

**Fix:** about four hours — either block self-signup for non-invited users, or add a join-existing-shop path.

### 6.4 Two settings have no screen at all and require SQL — **BLOCKER for a new shop**

- **`profiles.is_comp`** (`lib/db/schema.ts:120`) is the only way to let a shop use the product without a live Stripe subscription (`lib/auth-access.ts:106-113`). A search across `app/`, `lib/` and `components/` finds only reads — **there is no write path in the product.** Someone must run SQL. Every working shop in production has it set by hand.
- **`shop_entitlements.diagnostics`** is read at `lib/entitlements.ts:57-61` with no write route. Currently harmless — the default is `true` and diagnostics are release-gated off anyway.

**Fix:** about four hours for a founder-only toggle.

### 6.5 There is no first-run setup, and the shop record has no address — **PAINFUL**

Signing up silently creates a shop named `youremail@example.com's Shop` with all three rates null (`lib/db/queries.ts:82`). There is no onboarding route, no setup wizard, no first-run checklist anywhere under `app/`.

The `shops` table is seven columns — `id, name, next_ticket_number, labor_rate_cents, tax_rate_bps, parts_markup_bps, created_at` (`lib/db/schema.ts:76-103`). **There is no shop address, phone number, business hours, or holiday calendar.** That costs nothing today because nothing is printed. It becomes a hard blocker the moment a printed estimate or invoice ships (§7.2) — an invoice without the shop's address is not a document a customer or an insurer will accept.

### 6.6 A latent tax bug worth removing before it can bite — **ANNOYING**

`lib/shop-os/ring-out.ts:144` reads `calculateTicketTotals(lines, taxRateBps ?? 0)`. A null tax rate would ring a customer out with **zero tax, silently**. It is not reachable today, because ring-out only totals jobs that carry an `approvedQuoteVersionId` and creating a quote version already requires a non-null tax rate. Thirty minutes to remove the fallback and fail loudly instead.

---

## 7. What Mitchell does that Shop OS does not

This is the section that should decide the cutover date, and it needs to be said without softening: **Shop OS is an excellent repair-order workflow. It is not yet a shop management system.** Mitchell 1 ships 180+ reports. Shop OS ships zero — `find app -ipath "*report*"` returns nothing, and a search for the word "report" across every API route and every page file matches no files at all.

Of thirteen functions the shop uses in Mitchell, **eight do not exist in any form**, four partially exist, and one exists.

The important framing for the owner: these are not switched off. There is exactly one feature-flag module in the codebase (`lib/feature-flags.ts`, sixteen lines, three flags — desktop intake, cold-case synthesis, adaptive canvas). **None of the functions below is behind a flag.** They are absent from the code.

### 7.1 Accounts receivable — **absent** · BLOCKER

Covered in §4.4. There is no due date, no terms, no aging bucket, and no customer-level balance — `ticket_payments` attaches money to a repair order, never to a person, and `customers` has no balance or credit-limit column (both verified in production). A search for "receivable" or "aging" across `app/`, `lib/` and `components/` returns nothing but an unrelated substring. **~1 week.**

### 7.2 An invoice, receipt, or statement the customer can hold — **absent** · BLOCKER

**What the shop would experience:** the customer pays and asks for their paperwork, and there is nothing to give them.

- **No PDF or printing library is installed at all.** The full dependency list (`package.json:24-55`) contains no `jspdf`, `pdfkit`, `@react-pdf/renderer`, `puppeteer` or equivalent.
- The one "Print receipt" button in the product is **disabled in code**, with the title `"Wires up in Counter 04"` (`components/screens/counter-work-order-confirm.tsx:60-67`).
- There is an on-screen `Receipt` heading on a closed repair order (`components/screens/ring-out-section.tsx:143-171`) — a list of jobs, subtotal, tax and total inside the shop's own app. No print stylesheet, no route, no export, no email.
- No statement concept anywhere, and no statements table in production.

Note this depends on §6.5: an invoice needs the shop's address, and there is no column for it. **~1 week, plus the address columns.**

### 7.3 A callback list for deferred and declined work — **the data exists, nothing reads it** · BLOCKER

**What the shop would experience:** the system faithfully records every "not today" — including *why* — and then nobody can ever see the list.

The capture side is careful: `approval_state` includes `declined` and `deferred` (`lib/db/schema.ts:393`), and the deferred decision schema *requires* a reason of 1–500 characters (`lib/shop-os/quotes.ts:84-97`). Every decision is written to `quote_events` (`lib/shop-os/quotes.ts:700`).

Nothing ever queries it back across customers. A search for cross-ticket queries on `ticketJobs.approvalState` finds none — every hit is the schema, the type, or the write path. The one place declined work surfaces is per vehicle, on the vehicle history screen (`components/screens/vehicle-history.tsx:60-68`).

(Do not be fooled by `app/curator/deferred/page.tsx` — that is the back-office AI tool, filtering `sessions.status = 'deferred'` via `lib/curator/queries.ts:240`. Same word, different thing entirely.)

**This is the cheapest high-value item in the whole audit** — one query and one screen over data that is already structured with reasons attached. In a real shop this list *is* the marketing department. **~1–2 days.**

### 7.4 Appointments, scheduling, and promised time — **absent** · BLOCKER

**What the shop would experience:** no calendar, no way to book next Tuesday, and nowhere to write down what time you promised the truck back.

- No `appointments` table among the 64 tables in production.
- No promised time, no scheduled date, no drop-off time on `tickets` (full column list in §1.1). `when_started` and `how_often` describe *the symptom*, not the schedule (`lib/db/schema.ts:269-270`).
- A search for `appointment`, `scheduled_at`, `promised_at`, `drop_off` or `calendar` across the app finds only unrelated date arithmetic in the messaging-retention code.
- The closest thing is a hold flag — a job can be marked blocked on `'schedule'` (`lib/db/schema.ts:410-412`), with no date attachable.

Mitchell's W.I.P. screen, which the migration document describes as what the owner looks at every day, has both "sched" and "promised" columns. **~2 weeks.**

### 7.5 Sales tax reporting — **computed correctly, never reported** · BLOCKER within the first filing period

The arithmetic is right — `calculateTicketTotals` applies the shop rate with a proper taxable/non-taxable split (`lib/shop-os/ring-out.ts:132-144`) and it renders on the ticket (`components/screens/ring-out-section.tsx:162-165`).

Adding it up is impossible. There is no report screen. Filing the state return means opening every closed repair order one at a time.

**The caution this section carried is now answered, and it was a live defect — owner, 2026-07-31.** Texas does not tax separately stated labour on motor vehicle repair. A single flat shop rate plus a per-line `taxable` flag is therefore the *right* mechanism: labour simply must not carry the flag. The defect was the **default**. Every hand-written line started taxable, in all three places that chose one — the quote builder's blank line editor, a new canned-job line, and the part-to-labour conversion in the canned-job editor. An advisor who forgot to uncheck the box charged 8.25% on labour the state does not levy: **$12.79 on a single $155 hour**, invisible because a quote shows the taxable subtotal and never which lines went into it. Fixed in PR #229 (`defaultLineTaxable`), with the checkbox left untouched so a labour-taxing state still works. What remains open in this section is the **report**, not the computation. **~2–3 days once any report shell exists.**

### 7.6 Technician efficiency, flag hours, commission — **raw clock only** · PAINFUL

The stopwatch works. `ticket_jobs.clocked_on_since` and `active_seconds` (`lib/db/schema.ts:407-408`) are maintained by identical banked-clock logic in `lib/shop-os/simple-work.ts:189-190` and `lib/shop-os/interruption.ts:145-146`.

Nothing ever aggregates it. Those two files are the *only* consumers in the whole codebase — no query groups by technician, no query sums across a date range, and nothing compares clock hours to billed hours, which is the number that actually matters. Searches for `payroll`, `commission`, `flag_hour` and `efficiency` return nothing. **~1 week — the hard part already exists.**

### 7.7 End-of-day close and daily sales — **absent** · BLOCKER

**What the shop would experience:** at close of business there is no screen that says what the shop sold today, or how much came in as cash versus card versus check. The drawer cannot be balanced and a deposit cannot be prepared.

The data is all there and correctly shaped — `ticket_payments` carries amount, method (`cash|card|check|other`, `lib/db/schema.ts:1124-1126`) and `recorded_at`. There is simply no screen. This is the **cheapest blocker on the list**: **~2–3 days.** (An index on `(shop_id, recorded_at)` would serve it better than the existing `(shop_id, ticket_id, recorded_at)`.)

### 7.8 Texting or emailing the customer — **absent, and this one has an external clock** · BLOCKER

This is the most misleading area of the codebase, and the owner should understand why.

**Nothing can send anything.** A search for `twilio`, `sendgrid`, `resend`, `postmark`, `mailgun` or `nodemailer` across the whole application returns zero provider hits, and no messaging dependency appears in `package.json`.

**But there is a great deal of infrastructure that looks like it should work.** Six compliance tables — `messaging_consent_events`, `messaging_consent_state`, `sms_suppressions`, `messaging_deletion_requests`, `messaging_deletion_work_items`, `messaging_retention_holds`, plus `quote_sends` and `sms_log` — roughly 700 lines of schema, all with **zero rows in production**. Every code reference to `quoteSends` and `smsLog` outside the schema file is in the code that *deletes* them (`lib/shop-os/messaging-retention-purge.ts`, `lib/shop-os/messaging-deletion.ts`). There is no insert anywhere, because nothing ever sends.

**How approval actually happens today:** the advisor picks up the phone, and then types in what the customer said. `approvedVia` accepts exactly two values — `'phone'` and `'in_person'` (`lib/shop-os/quotes.ts:81`). Tellingly, the *database column* also allows `'page'` (`lib/db/schema.ts:1040`): a customer-facing approval page was designed in and never built.

**One live consequence to fix regardless of everything else:** the intake confirmation screen tells the advisor *"The customer has been notified by text."* (`components/screens/counter-work-order-confirm.tsx:57`). No text was sent. That sentence should come out before anyone relies on it.

**Why this one cannot be crashed by working harder:** business texting in the United States requires A2P 10DLC brand and campaign registration through the carriers. That takes weeks, is outside anyone's control, and can be rejected. If the shop needs to text customers at cutover, **that registration should be filed now, in parallel with everything else.** **~2 weeks of engineering plus carrier lead time.**

### 7.9 Parts ordering, purchase orders, vendor invoices — **request-only** · PAINFUL

A technician can flag "I need this part" and someone can mark it sourced. That is the whole workflow: `job_part_requests.status` is exactly `['requested', 'sourced', 'dismissed']` (`lib/db/schema.ts:637-639`, confirmed in production). There is no *ordered*, no *received*, no *backordered*. The request row carries no vendor, no part number, no cost, no PO reference and no received date.

There are no `purchase_orders` or `vendor_invoices` tables in production. Vendor integration is manual by construction — `SafeVendorAccount.mode` is typed as the literal `'manual'` (`lib/shop-os/parts.ts:21`); the schema allows `'api'` and `'punchout'` (`lib/db/schema.ts:695`) but no adapter implements either. Ordering and reconciling still happen on the phone and in a paper pile.

**~2–3 days for an ordered/received status extension, which buys most of the daily relief. Weeks for a real purchase-order loop.**

### 7.10 Parts inventory — **absent, and deliberately so** · NOT A GAP

**Owner decision, 2026-07-31: the shop is not doing inventory and wants nothing to do with it.** This row is closed. Do not raise it again, do not size it, and do not treat its absence as a blocker for any shop this product is aimed at.

For the record only: no inventory or stock table exists in production; no `on_hand`, `stock_qty` or `reorder` anywhere in the code. Parts exist only as lines on a quote (`job_lines`) or as requests. There is no part master record. That is now the intended shape.

Severity depends on the shop: many independents stock almost nothing. **This needs a direct answer from the owner** — if Young Motorsports stocks parts, this becomes a blocker. **Weeks.**

### 7.11 The rest, briefly

| Function | State | Severity | Evidence | Size |
|---|---|---|---|---|
| **Warranty tracking** | Absent | PAINFUL | `warranty` appears twice in the codebase, both in prose (`lib/ai/prompts.ts:36`, `app/terms/page.tsx:62`). No warranty period, no comeback linked to the original repair order. A shop that cannot prove what it warrantied and when carries real exposure. | ~1 week |
| **Employee time clock** | Absent | PAINFUL | No time-clock table; no `punch_in`/`clock_in` anywhere. Per-*job* clocking exists (§7.6) but there is no clock-in for the workday, so payroll hours have no source. | ~1 week |
| **Digital inspections with photos** | Absent | PAINFUL | Searches for `inspection`/`dvi` return only an AI prompt and a terms-of-service line. A `job_attachments` table exists with zero rows in production, but no inspection structure. Note the migration document §2.4 warns Mitchell's own photos may not even be in the backup — so this is a missing feature *and* a possible silent data loss. | Weeks |
| **Fleet / commercial accounts** | Partial shape | PAINFUL | One customer can own many vehicles (`lib/db/schema.ts:163`), so the structure works. There is no company name, no unit numbering, no consolidated statement — and fleets pay on terms, which inherits §7.1. | With §7.1–7.2 |
| ~~**Labour guide integration**~~ | **Struck** | — | This row conflated a labour-time guide with ProDemand, which is a **service manual** and has nothing to do with a shop management system. Owner correction, 2026-07-31. Labour times are typed by hand and that is not a finding. | — |
| **VIN decode** | **Exists** | — | `app/api/intake/decode-vin/route.ts`, with its own end-to-end test config (`playwright.vin-decode.config.ts`). Plate lookup does not exist; `vehicles.plate` is a hand-typed field. | — |

---

## Honest framing on the blocker count

Section 7 alone names eight things that a shop management system is expected to have and this one does not. It would be easy to read that as "eight blockers" and conclude the project is further from ready than it is. Two corrections, both in the owner's favour:

**The count is worse than the effort.** Four of the most painful gaps are genuinely small because the data model is already right: the deferred-work callback list (~1–2 days), the end-of-day sales total (~2–3 days), the repair-order lookup (server half already written, ~1 week to finish), and storing the Mitchell repair-order number (~1 day). Those four alone change the day-one experience more than anything else on the list.

**Not everything blocks Monday equally.** Sales-tax reporting blocks the first filing deadline, not the first morning. Technician efficiency blocks the first payroll conversation. Appointments block the first week the shop tries to book ahead. The ranked list at the top of this document is deliberately shorter than the full findings list, because it names only the things that stop the shop from getting a car in, worked, billed and out of the door on the first day.

---

## What this audit could not verify

Listed so nobody mistakes an unproven thing for a proven one.

1. **Query plans at real volume.** Production holds four repair orders and this audit was read-only, so no query could be measured against ten thousand rows. Every index the code declares was confirmed present in production, and the intake-search plans in §5.3 were confirmed by a real `EXPLAIN` — but which plan Postgres chooses for the Today board's five-branch `OR` (`lib/tickets.ts:564-573`) at scale is **UNVERIFIED**. One `EXPLAIN ANALYZE` against the restored Mitchell copy during Pass 1 settles it, and should be done.

2. **Whether §5.5 (the 200-job cap) is a blocker or merely painful.** That depends entirely on how many `ticket_jobs` the importer creates per Mitchell repair order, and no importer exists to inspect. Undetermined.

3. **§4.6, the pinned-work billing interaction.** The two code paths and their interaction are verified at the cited lines. It was **not reproduced end-to-end against a running database.** It needs a test before the shop bills anything real.

4. **Live production environment variables.** The three feature flags in `lib/feature-flags.ts` all fail closed in code, but their actual values on Vercel were not read. None of the gaps in §7 depend on a flag, so this does not change any finding.

5. **These four were asked of the owner and are now answered, 2026-07-31.** Do not re-file them.
   - **Inventory (§7.10) — closed, not wanted.** The shop is not doing inventory and wants nothing to do with it. Drop it from every list; it is not a blocker and not a gap.
   - **Parts markup (§6.1) — moot for now.** There is no parts-supplier integration yet, so a markup on nothing prices nothing. Revisit when supplier ordering exists, not before.
   - **Texas tax (§7.5) — answered, and it was a live defect.** Texas does not tax separately stated labour on motor vehicle repair. The per-line taxable flag and the split in `calculateTicketTotals` were already the right mechanism, but every hand-written line **started taxable**, so forgetting to uncheck the box billed the customer 8.25% on untaxed labour — $12.79 on one $155 hour, invisible because a quote shows only the taxable subtotal. Fixed in PR #229: `defaultLineTaxable` starts labour untaxed in all three places that chose a default, with the checkbox untouched so a labour-taxing state still works. What remains open here is the **reporting**, not the computation.
   - **ProDemand (§7.11) — was never a real gap.** ProDemand is a service manual. It has nothing to do with a shop management system, and the row conflated it with a labour-time guide. Struck.

**Method note.** No product code was changed, no migration was run, and no production data was written. All database access was `SELECT` and `information_schema`/`pg_indexes`/`EXPLAIN` inspection. No customer information appears anywhere in this document.

