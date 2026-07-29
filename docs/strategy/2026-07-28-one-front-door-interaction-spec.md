# One front door — interaction spec

**Date:** 2026-07-28
**Author:** shop-floor interaction designer
**Status:** proposal, ready for a surface engineer to build from
**Shop it is written for:** Young Motorsports — 5 users (3 owner, 1 tech, 1 parts, **no advisor account**), $155/hr labor, 8.25% tax, 65% parts markup, **zero canned jobs saved**.

Every friction claim below carries a `path:line` citation. Where I could not verify
something, it says so.

**One correction to the brief up front:** server validation for the two doors does
**not** live in `app/api/intake/submit/route.ts`. That route is the AI diagnostic
session path — it calls `createSessionFromIntake` and six web-retrieval adapters and
runs up to 300 seconds (`app/api/intake/submit/route.ts:8-31`). Neither front door
touches it. The real validators are `lib/intake/counter-ticket.ts` (posted to by
`components/screens/counter-intake.tsx:295`) and `lib/intake/quick-ticket.ts` (posted
to by `components/screens/quick-ticket.tsx:231`).

---

## The flow today (counted, cited)

### Step 0 — the door choice, made before anyone knows what the job is

`/today` renders two adjacent primary buttons, both with a `+` icon, with no
explanation of which one to use:

| Button | Route | Shown when | Cite |
|---|---|---|---|
| "New work order" | `/intake` | `canWriteCounterOrder` = `canAssignWork(role)` → **owner or advisor only** | `components/screens/today-home.tsx:99-116`, `app/(app)/today/page.tsx:35`, `lib/shop-os/capabilities.ts:17-23` |
| "Quick ticket" | `/tickets/new` | `canCreateTickets(role)` → **any shop role** | `components/screens/today-home.tsx:117-135`, `app/(app)/today/page.tsx:36`, `lib/shop-os/capabilities.ts:9-11` |

There is no other entry point to creating work anywhere in the app — the header menu
carries only Today, Settings, Reviewer (`components/vt/app-header-menu.tsx:72-89`).

**Consequence for this shop, today:** the tech and the parts person cannot use the
counter door at all. `/intake` hard-404s for them at the layout
(`app/(app)/intake/layout.tsx:15`), and the counter API 404s them again
(`app/api/tickets/counter/route.ts:24-26`). With no advisor account, all three owners
carry every complaint-bearing write-up. The counter door is also behind an env flag —
`NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED === 'true'` — or the whole route 404s
(`lib/feature-flags.ts:1-3`, `app/(app)/intake/layout.tsx:10`,
`app/api/tickets/counter/route.ts:13-15`). **Unverified:** I did not check the value
of that variable in the production environment.

### Door A — `/intake` → `components/screens/counter-intake.tsx` (889 lines)

One screen, one form, lands on `/tickets/{id}` (`counter-intake.tsx:315`).

Required before the Create button enables (`counter-intake.tsx:155-164`):

| Field | Required | Cite |
|---|---|---|
| Complaint ("What brought them in?") | always | `counter-intake.tsx:606-616` |
| Customer name | new customer only | `counter-intake.tsx:437-445` |
| Phone | new customer only | `counter-intake.tsx:446-456` |
| Year | new customer only | `counter-intake.tsx:526-536` |
| Make | new customer only | `counter-intake.tsx:537-544` |
| Model | new customer only | `counter-intake.tsx:545-552` |
| Work scope (`workReady`) | always | `counter-intake.tsx:148-154` |

Optional fields also on screen: email `457-466`, VIN + Decode button `474-507`, engine
`553-560`, mileage `562-573` (or `588-604` on the existing-vehicle path), plate
`574-582`, when-started `617-625`, how-often `626-633`, customer-supplied item
`796-808`, tech assignment `344-357`.

Forced choices:

1. **"Find the cause" vs "Perform known work"** — two big buttons,
   `counter-intake.tsx:637-658`. With zero diagnostic canned jobs this **defaults to
   "Perform known work"** (`counter-intake.tsx:119-121`), so at Young Motorsports
   today every diagnosis costs one extra deliberate tap.
2. **Scope source** (Preset vs Custom) — only rendered when the shop has canned jobs
   of that kind (`counter-intake.tsx:668-680` diagnostic, `739-751` known). At zero
   canned jobs both selects vanish and the form falls straight to the manual fields.
3. **Work type** (Repair / Maintenance) — `counter-intake.tsx:767-780`, defaults to
   Repair, so it costs nothing unless the job is maintenance.

With **zero canned jobs**, the two branches require:

- **Find the cause:** description `702-711` + hours `712-722` + price `723-732` — all
  three, all typed, every single time (`counter-intake.tsx:151`).
- **Perform known work:** requested-work text `781-793`.

**Counted friction, Door A, new customer, unknown cause, zero canned jobs.**
Scenario: "Dale Whitcomb, 970-555-1188, 2015 Ford F-250, grinding noise from the front
when braking." Tap = one pointer target or one deliberate key action; field-to-field
tabbing is not counted.

| # | Tap | Cite |
|---|---|---|
| 1 | "New work order" on `/today` | `today-home.tsx:100` |
| 2 | Focus the search bar (it does **not** autofocus) | `components/vt/intake-search/bar.tsx:28-41` |
| 3 | "Create new customer with this info" | `components/vt/intake-search/dropdown.tsx:216-263` |
| 4 | Phone | `counter-intake.tsx:446` |
| 5 | Year | `counter-intake.tsx:526` |
| 6 | Make | `counter-intake.tsx:537` |
| 7 | Model | `counter-intake.tsx:545` |
| 8 | Complaint | `counter-intake.tsx:606` |
| 9 | "Find the cause" | `counter-intake.tsx:639` |
| 10 | Diagnostic description | `counter-intake.tsx:702` |
| 11 | Hours | `counter-intake.tsx:713` |
| 12 | Price | `counter-intake.tsx:723` |
| 13 | Create repair order | `counter-intake.tsx:877` |

**13 taps.** Typed characters: `"Dale Whitcomb"` 13 (the search text becomes the name
via `lib/intake/tokens-to-prefill.ts:75`) + phone 10 + year 4 + make 4 + model 4 +
complaint 41 + diagnostic description 29 + hours 1 + price 3 = **109 characters**.

Returning customer, unknown cause: taps 1, 2, pick the row, (+1 more tap if the
customer has 2+ vehicles — `components/vt/intake-search/index.tsx:132-137` opens a
second tier), complaint, "Find the cause", description, hours, price, create =
**9–10 taps / 78 characters**.

### Door B — `/tickets/new` → `components/screens/quick-ticket.tsx` (534 lines)

One screen, one form, lands on `/tickets/{id}/quote` (`quick-ticket.tsx:256`).

Required (`quick-ticket.tsx:150-165`): name `354`, phone `357`, year `368`, make `371`,
model `374`, and requested work `448-457`. Optional: email `360`, engine `377`, VIN
`382`, mileage `385`, plate `388`.

What this door **cannot** do, at all:

- **No complaint field exists.** The server writes `concern = title`, i.e. the RO's
  "customer complaint" is literally the name of the work item
  (`lib/intake/quick-ticket.ts:254`). When-started and how-often do not exist here.
- **No VIN decode.** The VIN field is plain text (`quick-ticket.tsx:382-384`) even
  though the decoder the other door uses is a shared API route
  (`counter-intake.tsx:194-229` → `app/api/intake/decode-vin/route.ts` →
  `lib/intake/decode-vin.ts`).
- **No tech assignment.** Hardcoded `assignedTechId: null`
  (`lib/intake/quick-ticket.ts:259`).
- **No diagnostic work.** The page filters diagnostic canned jobs out
  (`app/(app)/tickets/new/page.tsx:32`) and the server rejects them outright
  (`lib/intake/quick-ticket.ts:186-188`).
- At zero canned jobs, the "Source" select renders with exactly **one** option,
  "Manual draft" (`quick-ticket.tsx:406-419`, option gated at `417`) — a control that
  can only be set to what it already is.

**Counted friction, Door B, new customer, known work:** door (1) + search focus (2) +
create-new (3) + phone (4) + year (5) + make (6) + model (7) + requested work (8) +
create (9) = **9 taps**, ~13+10+4+4+4+20 = **55 characters**.

### The cost of guessing wrong

The customer says "there's a noise." That sounds like a ticket, not a diagnosis, so the
advisor takes Door B. Ten fields later they are on the quote page and discover the
complaint was never recorded, the job is titled with their guess, and there is no
diagnostic labor on the RO.

Recovery is bad, and this is the part that matters:

- They can add diagnostic labor from the quote page — description, hours, price again
  (`components/screens/add-diagnostic-time.tsx:70-80`, posted to
  `app/api/tickets/[id]/quote/diagnostic-time/route.ts`), and only if they are an owner
  or advisor (`route.ts:19-21`).
- They **cannot remove the wrong job.** There is no remove-job operation anywhere in
  the quote domain (`lib/shop-os/quotes.ts` has only part/labor/fee line kinds at
  `45-65` and approved/declined/deferred job decisions at `80-93`), and the public
  add-job entrance is retired (`app/api/tickets/[id]/jobs/route.ts:3-15`). The only way
  to make the junk job disappear from the customer's total is to record it as
  **declined by the customer** — writing a false fact into the shop's own history.
- The complaint is unrecoverable on that RO. Nothing in the ticket surface writes
  `concern` after creation.

So the door choice, made before the advisor can possibly know the answer, is
effectively **irreversible**.

### One more thing today's counter door does not do

`POST /api/tickets/counter` has **no idempotency**. A flaky counter Wi-Fi retry creates
a second repair order. Door B solved this — it mints a `clientKey` and derives a
deterministic ticket id so a retry returns the first ticket
(`quick-ticket.tsx:224-228`, `lib/intake/quick-ticket.ts:90-101`, `159-161`). Door A has
none of that machinery.

---

## Where it actually hurts

**The earliest forced commitment is the button on `/today`** — the advisor must classify
the job before the customer has finished the sentence, and the classification cannot be
undone. Everything downstream is a symptom.

### What the product already knows at that moment and does not use

1. **The shop's labor rate.** `shops.laborRateCents` exists (`lib/db/schema.ts:82`) and
   the quote builder already defaults every labor line to it
   (`lib/shop-os/quotes.ts:1169`, `1270`). The intake page never loads it — it passes
   only recent customers, team, canned jobs and tax rate
   (`app/(app)/intake/page.tsx:42-51`). So the advisor hand-types `155` into a price box
   the product could have filled, and can fat-finger it.
2. **The vehicle they just picked.** Door A never shows which vehicle was selected:
   `handlePickVehicle` sets only the id (`counter-intake.tsx:166-169`), and
   `setPickedLabel` is only ever called with `null` (`counter-intake.tsx:175`, `185`), so
   the banner at `counter-intake.tsx:411-414` permanently reads "Existing vehicle
   selected." with no vehicle named. Door B tries, but looks the vehicle up only inside
   `recentCustomers` (`quick-ticket.tsx:132-135`) — a list that is empty for this shop,
   see (4) — so it falls back to "Vehicle selected" (`quick-ticket.tsx:336`). **Neither
   door tells the advisor what they just picked.**
3. **The vehicle's entire repair history, including work the customer already declined.**
   `listVehicleTicketHistory` returns every prior RO with per-job outcomes
   (`lib/tickets.ts:225-245`), and the history screen already computes the declined-work
   list (`components/screens/vehicle-history.tsx:60-68`). The door shows none of it. The
   only link to it sits inside the "which vehicle?" tier
   (`components/vt/intake-search/dropdown.tsx:386-392`), it appears only for customers
   with 2+ vehicles, and clicking it **navigates away and discards the half-filled
   form**.
4. **Who has been in today.** "Recent · today" is powered by a query that inner-joins
   the `sessions` table (`lib/intake/recent-customers.ts:46-47`). `sessions` rows are
   written only by diagnostic-session code (`lib/sessions.ts:263`,
   `lib/db/queries.ts:70`, `lib/intake/session.ts:133`,
   `lib/shop-os/diagnostic-start.ts:447`) — never by ticket creation — and diagnostics
   are switched off (`app/(app)/today/page.tsx:19`). **For Young Motorsports that list
   will be empty forever**, so the door will always greet them with "No one's been
   through the counter yet today" (`dropdown.tsx:19-35`). The same dead join drives
   `lastVisit`, so every search result row shows "—" (`dropdown.tsx:171`, `199`) and the
   "most recent first" ordering is a no-op (`lib/intake/search.ts:76-81`, `97`,
   `167-169`, `188`).
5. **That the shop has no canned jobs.** Instead of saying so, Door B renders a select
   with one option (`quick-ticket.tsx:406-419`) and Door A silently flips its default to
   "Perform known work" (`counter-intake.tsx:119-121`) — the wrong default for a counter.

### First-use defects that will bite during the pressure test

- The "Requested work" field is labelled **"Optional"** (`counter-intake.tsx:784`) but
  the Create button will not enable without it (`counter-intake.tsx:154`). A first-time
  user will stare at a dead button.
- A tech or parts user who reaches the counter API is told **"The selected customer or
  vehicle is no longer available. Choose it again."** — because the role denial returns
  404 `not_found` (`app/api/tickets/counter/route.ts:24-26`) and the client maps
  `not_found` to that sentence (`counter-intake.tsx:65-68`). The message blames the data
  for a permissions problem.
- Door A does not lock the form while submitting; it only disables the button and shows
  "Submitting…" (`counter-intake.tsx:155-156`, `871`). Door B wraps the whole form in a
  disabled fieldset (`quick-ticket.tsx:320`). Door A's behaviour is the weaker one.
- `components/screens/counter-work-order-confirm.tsx` is an orphan — no route renders it
  (verified by grep across `app/`). It promises "The customer has been notified by text.
  The AI plan is locked in." Do not resurrect it as part of this work.

---

## What I recommend (one flow)

**One door. It asks who, what vehicle, and what the customer said. It never asks the
advisor to classify the job — it defaults to the honest answer and lets them change it
in one tap.**

Route: keep `/intake` as the single door and permanently redirect `/tickets/new` to it.
Remove the "Quick ticket" button (`today-home.tsx:117-135`); one primary button on
`/today` reading **New work order**, shown to every shop role.

### Screen 1 — "Who's at the counter?" (the only screen)

It is one page, in this order. Nothing here is new layout work; it is the existing
counter form with a different spine.

**Block 1 — Search.** `PredictiveIntakeSearch` exactly as it is
(`components/vt/intake-search/index.tsx`), with one change: **autofocus the input on
mount** (`bar.tsx:28`). That removes one tap from every single write-up. `⌘K` and `/`
already work (`index.tsx:44-65`).

**Block 2 — Who and what (fills itself).**

- *Returning customer picked:* replace today's anonymous banner with a named card —
  `2015 Ford F-250 · Dale Whitcomb · plate ABC-1234 · 148,220 mi · last in 3 weeks ago`
  — plus, when there is prior declined or deferred work, a one-line strip:
  *"Last visit they passed on: front brake pads, cabin filter."* with a **Add to this
  ticket** affordance per item. This is the single highest-value thing on the screen and
  the data is already computed (`lib/tickets.ts:225`,
  `components/screens/vehicle-history.tsx:60-68`).
- *New customer:* the existing Customer + Vehicle field groups
  (`counter-intake.tsx:435-584`), unchanged, with VIN + **Decode VIN** kept
  (`counter-intake.tsx:474-507`) — decode is now available on the only door, which by
  itself removes three typed fields whenever a VIN is at hand.

**Block 3 — "What did they say?"** The complaint textarea, always required, always
present, for every job type (`counter-intake.tsx:606-616`). When-started and how-often
stay as optional single-line fields. This is the field the advisor can always answer,
and it is the one Door B throws away today.

**Block 4 — "What happens next?" — pre-answered, not asked.**

The screen arrives with **Find the cause** already selected and already priced, and a
single quiet link: *"I already know the work →"*.

- **Find the cause (default).** Shows one line of plain text, not a form:
  *Diagnose customer concern · 1.0 hr · $155.* Sourced, in priority order:
  1. the shop's saved diagnostic canned job, if one exists — the component already
     defaults to it (`counter-intake.tsx:117`, `119-121`, `131`);
  2. otherwise `shops.laborRateCents` × the shop's default diagnostic hours, rendered
     into the existing description/hours/price fields as **editable prefill**
     (`counter-intake.tsx:702-732`);
  3. otherwise — no rate configured — the three fields, empty, exactly as today, with
     the honest hint *"Set your labor rate in Shop settings and this fills itself."*
- **I already know the work.** Reveals the known-work block
  (`counter-intake.tsx:738-809`): the saved-work picker when the shop has canned jobs,
  otherwise the requested-work line with its label corrected from "Optional" to
  "Required" (`counter-intake.tsx:784`).

**Block 5 — Assignment (owner/advisor only).** `TechSelector` stays where it is
(`counter-intake.tsx:344-357`), defaulting to Open. It is not required, and it is not a
reason to make the tech use a different door — assignment can also be changed later on
the RO (`components/screens/ticket-assignment-control.tsx`).

**Create repair order.** Lands on `/tickets/{id}`, which already hosts the full quote
builder inline (`components/screens/ticket-detail.tsx:21-24`,
`components/screens/inline-quote-workspace.tsx:9`) — so nothing is lost by retiring Door
B's landing at `/tickets/{id}/quote`; it is the same builder on a second URL.

### What each role sees

| Role | At Young Motorsports | What the door shows |
|---|---|---|
| Owner (×3) | all three accounts | Everything: search, complaint, both work branches, custom diagnostic price, tech assignment |
| Advisor | **no account exists** | Same as owner |
| Tech (×1) | the bay | Same door, same search, same complaint. **No** tech selector, **no** custom price fields. The diagnosis branch uses the shop's saved diagnostic; the known branch takes a description. The RO comes out unassigned and unpriced for an owner to finish |
| Parts (×1) | counter/phone | Identical to tech |

The rule is: *an operator without pricing authority may create work, but may not invent
a number.* Picking the shop's own saved diagnostic is not inventing a number — the price
comes from the shop's catalog, verified server-side by fingerprint
(`lib/intake/counter-ticket.ts:208-218`).

### Every state, specified

| State | Behaviour | Reuses |
|---|---|---|
| **Search idle, nobody in yet** | "No one's been through the counter yet today. Start typing — or create a new customer." | `dropdown.tsx:8-35` — but only correct **after** the recent-customers fix below; today it is a permanent lie |
| **Search idle, recents exist** | "Recent · today" list, up to 5 + "See all" | `dropdown.tsx:38-83` |
| **Searching** | spinner + elapsed ms, previous results held, create-new always reachable | `dropdown.tsx:85-123`, debounce 150 ms `lib/intake/use-search.ts:6` |
| **Slow (>5 s)** | "Still searching", cached rows still pickable, create-new never blocked | `dropdown.tsx:265-339`, `use-search.ts:7` |
| **Matched** | customers then vehicles, tokens highlighted, last-visit in the meta column | `dropdown.tsx:125-214` |
| **No match** | "Nothing matches X" + what was searched + shape routing ("looks like a plate — we'll prefill License plate") | `dropdown.tsx:216-263`, `lib/intake/input-shape.ts` |
| **Search error** | same as no-match; create-new is never blocked | `index.tsx:309-315` |
| **Customer with 2+ vehicles** | "which vehicle?" tier with a per-vehicle history link — the link must open **in a new tab** so the form is not destroyed | `dropdown.tsx:341-405`, link at `386-392` |
| **Returning vehicle picked** | named card + last visit + declined-work strip (new) | data from `lib/tickets.ts:225` |
| **Submitting** | whole form locked in a disabled fieldset, footer reads "Creating repair order…" | adopt `quick-ticket.tsx:320` over `counter-intake.tsx:871` |
| **Retry after a dropped connection** | same `clientKey` returns the same RO, no duplicate | port `lib/intake/quick-ticket.ts:90-101`, `159-161` |
| **Tech below required tier** | inline warning + "Assign anyway" | `counter-intake.tsx:812-850` |
| **Canned catalog unavailable** | "The shop's saved work is temporarily unavailable. You can still describe the work." Manual paths stay open | `counter-intake.tsx:663-666`, `696-699` |
| **No labor rate configured** | diagnostic fields empty + "Set your labor rate in Shop settings and this fills itself" | new copy |
| **Role denied** | "This account can't price work. Create the ticket and an owner will finish it." — **not** today's "customer or vehicle is no longer available" | fix `counter-intake.tsx:65-68` + `app/api/tickets/counter/route.ts:24-26` |

---

## Before / after

Tap = one pointer target or one deliberate key action. Field-to-field tabbing not
counted. "After" assumes the owner has saved one diagnostic canned job (see *Decision
for the owner*) — a settings row, not code.

| Case | Today: taps | Today: chars | Proposed: taps | Proposed: chars |
|---|---|---|---|---|
| New customer, unknown cause | **13** (Door A) | **109** | **8** | **76** |
| Returning customer, unknown cause | **9–10** (Door A) | **78** | **4–5** | **45** |
| New customer, known work | **9** (Door B) | **55** | **9** | **55 + complaint** |
| Returning customer, known work, canned job saved | **6** (Door B) | **4** | **6** | **4 + complaint** |
| Wrong door chosen, then corrected | **9, then ~8 more** on the quote page, and a false "customer declined" left on the RO | 55 + ~33 | **0 extra** — there is no wrong door | — |

Where the savings come from, precisely: the door-choice tap disappears; the search bar
autofocuses (`bar.tsx:28`); "Find the cause" is the default instead of a tap
(`counter-intake.tsx:119-121`); and the diagnostic description, hours and price stop
being typed because the shop's saved diagnostic supplies them
(`counter-intake.tsx:131`, `681-694`).

Known work is honestly **not faster** — it costs the same taps plus a complaint the shop
now actually has on file. The win there is that the operator was never on the wrong
surface, and the RO carries the customer's own words.

---

## What grows with each use

1. **The customer and vehicle book fills itself.** Every create upserts both
   (`lib/intake/counter-ticket.ts:258-273`), so tomorrow's search finds today's walk-in
   by name, phone, VIN, plate, or year/make/model (`lib/intake/search.ts:66-72`,
   `155-165`) with no data-entry session, ever.
2. **Last-visit becomes real** — once `getRecentIntakeCustomers` and the two
   `lastVisit` subqueries stop joining `sessions` and start reading `tickets`
   (`lib/intake/recent-customers.ts:46-47`, `lib/intake/search.ts:76-81`, `167-169`).
   Then "Recent · today" actually lists this morning's customers, and search ranks the
   truck that was here last week above one from 2023.
3. **Declined work compounds into next visit's revenue.** Every job the customer passes
   on is already stored with its decision (`lib/shop-os/quotes.ts:80-93`) and already
   surfaced by the history screen (`vehicle-history.tsx:60-68`). Putting it on the door
   turns the shop's own record into the advisor's first sentence.
4. **Saved work turns typing into picking.** The moment the owner saves a canned job,
   the known-work branch becomes a one-tap select with a priced preview
   (`counter-intake.tsx:752-764`, `quick-ticket.tsx:466-491`), and the diagnosis branch
   stops asking for hours and price entirely.
5. **VIN decodes are cached** in-process, LRU 1000 (`lib/intake/decode-vin.ts:7`,
   `12`), so a fleet customer's second truck decodes instantly.

---

## Decision for the owner

**One decision: what is Young Motorsports' standard diagnostic charge, and what is it
called on the customer's paper?**

The code deliberately refuses to invent a diagnostic title, hours, or price — every
diagnosis today makes the advisor type all three (`counter-intake.tsx:151`,
`702-732`). That refusal is correct; the number is the owner's, not the software's.

Concretely, he needs to answer: *"Diagnose customer concern — 1.0 hour — $155"*, or
whatever his real first-hour policy is.

Designed for both answers:

- **If he sets it** (one canned job of kind `diagnostic` in Shop settings): the door
  needs **no code at all** for this part — `counter-intake.tsx:117`, `119-121` and `131`
  already default to "Find the cause" with that job preselected the moment one exists.
  Every diagnosis write-up loses three typed fields.
- **If he declines to set a standing number:** the door prefills hours and price from
  `shops.laborRateCents` (`lib/db/schema.ts:82`) as an editable suggestion, and if even
  the labor rate is unset the three fields render empty exactly as today. Nothing
  breaks; the advisor just keeps typing.

Two smaller judgments that ride along, both his:

- **May a tech or parts person open a repair order?** I have designed for yes — they can
  capture the customer, the vehicle and the complaint, but cannot set a price or assign
  anyone. With three owners and one advisor-shaped hole in the roster, "no" means every
  phone call waits for an owner.
- **What happens to a wrong job on an RO?** Today the only exit is recording it as
  "declined by the customer" (`lib/shop-os/quotes.ts:80-93`), which puts a false fact in
  the shop's history. I am not proposing to build a delete in this spec, but he should
  know that is the current state.

---

## Runner-up, rejected

Keep both doors and add a small chooser screen — "Do you know the job?" — in front of
them: rejected because it makes the impossible commitment *more* explicit rather than
removing it, and leaves two form surfaces, two validators, and two divergent sets of
capabilities to keep honest forever.

---

## Honest sizing

### Reuses what already exists — no new capability

- Predictive search, all six states, keyboard nav, tiering, shape routing —
  `components/vt/intake-search/*`, `lib/intake/use-search.ts`, `lib/intake/search.ts`,
  `lib/intake/input-shape.ts`, `lib/intake/tokens-to-prefill.ts`.
- VIN decode with NHTSA, 5 s timeout, LRU cache — `lib/intake/decode-vin.ts`,
  `app/api/intake/decode-vin/route.ts`.
- Customer/vehicle upsert, ticket creation, canned-job fingerprint verification, tier
  warning — `lib/intake/counter-ticket.ts` end to end.
- The landing surface: `/tickets/{id}` already carries the whole quote builder inline
  (`components/screens/inline-quote-workspace.tsx`), plus assignment, lifecycle, parts,
  ring-out (`components/screens/ticket-detail.tsx:20-30`).
- Vehicle history including declined work — `lib/tickets.ts:225`.
- The two-branch UI itself. Door A **already contains both doors**; the merge is mostly
  deletion, not construction.

### Needs building — small (each is a contained change)

1. **Retire Door B.** Delete the second button (`today-home.tsx:117-135`), redirect
   `/tickets/new` → `/intake` (`app/(app)/tickets/new/page.tsx`). Leave
   `lib/intake/quick-ticket.ts` in place until its idempotency is ported, then remove
   `components/screens/quick-ticket.tsx`.
2. **Autofocus the search input** — `components/vt/intake-search/bar.tsx:28`.
3. **Name the picked vehicle.** Widen `onPickVehicle` to carry a label and set
   `pickedLabel` (`counter-intake.tsx:166-169`, `411-414`). The label already exists in
   the search result rows (`dropdown.tsx:181-184`).
4. **Fix the "Optional" lie** on requested work — `counter-intake.tsx:784`.
5. **Lock the form while submitting** — copy the disabled-fieldset pattern from
   `quick-ticket.tsx:320`.
6. **Fix the role-denial message** — distinguish `forbidden` from `not_found`
   (`app/api/tickets/counter/route.ts:24-26`, `counter-intake.tsx:65-68`).
7. **Open the history link in a new tab** — `dropdown.tsx:386-392`.
8. **Prefill diagnostic hours/price from the shop rate.** Load `shops.laborRateCents` in
   `app/(app)/intake/page.tsx` (the shape is already read elsewhere,
   `lib/shop-os/quotes.ts:967`) and seed `counter-intake.tsx:713-732`.

### Needs building — medium

9. **Idempotent create.** Port `clientKey` + `deterministicTicketId` +
   first-success replay from `lib/intake/quick-ticket.ts:90-101`, `159-161` into
   `lib/intake/counter-ticket.ts`. ~40 lines, one new column-free hash, and it removes a
   real duplicate-RO risk during a live pressure test.
10. **Let tech and parts through the door.** Relax the gate from `canAssignWork` to
    `canCreateTickets` at `app/api/tickets/counter/route.ts:24`,
    `app/(app)/intake/layout.tsx:15` and `lib/intake/counter-ticket.ts:109`, and add a
    guard: an actor without `canAssignWork` may not send `assignedTechId` and may not
    send `work.mode: 'diagnosis-manual'` (the free-price mode). Small code, but it
    changes who can write to the ticket table — treat it as the riskiest item here and
    cover it with tests.
11. **Prior-visit panel on the door.** A small read-only route wrapping
    `listVehicleTicketHistory` (`lib/tickets.ts:225`) plus the named-vehicle card and the
    declined-work strip. The query and the outcome logic exist; the API route and the
    panel do not.

### Needs building — the one that changes the most

12. **Make recency real.** Rewrite `getRecentIntakeCustomers`
    (`lib/intake/recent-customers.ts:33-50`) and the three `lastVisit` subqueries
    (`lib/intake/search.ts:76-81`, `105-107`, `167-169`) to read `tickets` — or a union
    of `tickets` and `sessions` — instead of `sessions` alone. Until this lands, "Recent
    · today" is empty forever for a ticket-only shop and every relevance sort in the
    search is dead weight. Pure query work, no schema change, but it touches the hottest
    read path on the screen and deserves its own tests.

### Explicitly not in this spec

Deleting a wrong job from an RO; the orphaned
`components/screens/counter-work-order-confirm.tsx`; anything touching
`app/api/intake/submit/route.ts` or the diagnostic session engine, which stays dark
(`app/(app)/today/page.tsx:19`).

---

Skipped/Failed: I did not run the app or the test suite — this worktree has no
`node_modules` by design, so every count above is read from source, not from a browser.
The value of `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` in production is unverified. Typed-
character counts use one representative walk-in ("Dale Whitcomb", 2015 Ford F-250,
grinding brake noise); the tap counts do not depend on that choice, the character counts
do. One number is an estimate and is marked as such: the "~8 more" taps to correct a
wrong-door ticket on the quote page — I read the add-diagnostic-time form
(`components/screens/add-diagnostic-time.tsx:70-95`) and the job-decision schema
(`lib/shop-os/quotes.ts:80-93`) but did not count the decline flow control by control.
