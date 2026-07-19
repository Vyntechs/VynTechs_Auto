# ShopOS customer-lens audit — follow-ups

**Date:** 2026-07-18

A walk of the whole shop-facing product from the lens of an ideal customer
(independent shop owner + service advisor + techs), scoring every journey for
friction and honesty. This file is the durable tracker: what shipped, and every
item **not done yet**, so nothing is lost across sessions.

**Method / boundary (so findings are weighted fairly):** read-and-trace audit of
source + flows (not a live click-through — the app is founder-gated and no QA
login was available). The AI-diagnosis surface is switched **off in production**
(`lib/release-policy.ts` forces `off` in prod), so those screens were assessed as
the experience a tech *would* get when it is re-enabled. The internal "curator"
console was out of scope.

---

## Shipped on `claude/handoff-opus-fable-strategy-zxe329`

| Fix | Commit | What |
| --- | --- | --- |
| Tax & labor rate settings | `f213567` | Owners can finally set sales-tax and labor rate in **Settings → Shop**; quotes can produce a correct total. Completes the earlier Build-Quote "configure a tax rate in shop settings" prompt, which pointed at a screen that did not exist. |
| Honest case-close record | `65f435f` | Verification no longer pre-asserts a clean fix (boxes start off; tech must state whether symptoms resolved before closing); the fabricated per-phase "diag/repair min" is collapsed to the one true number — how long the case was open. Also drops the inaccurate "all fields required" eyebrow. |
| Vehicle history with recoverable work | `47c3496` | Vehicle-history screen now lists a vehicle's past repair orders, and leads with **Recommended — not done yet** (jobs the customer declined, `ticketJobs.approvalState = 'declined'`), each linking to its ticket. Read-only. |
| Supplier setup in Settings | `5943c0f` | New **Settings → Shop → Suppliers** (module 04): owners add, rename, and turn suppliers on/off ahead of time, reusing the existing vendor-account domain/API unchanged. Sourcing's non-owner dead-end now points at Settings → Shop. First slice of the founder bench direction (principle 1). |
| Parts markup — set it | `6857852` | New `shops.parts_markup_bps` (nullable, additive migration 0037) + a **Default parts markup** field in the Rates section; `POST /api/shop` validates/saves it. Management sets markup once. |
| Parts markup — auto-price | `430c4cf` | With a markup set, the part-sourcing panel derives the customer line price from supplier cost × quantity × markup and shows it **read-only** — techs/advisors never type retail (principles 2 + 3). Mirrors how a labor line already hides its price when a labor rate is set. |
| Getting paid — ring out & close | _(this branch)_ | New **Ring out** panel on the ticket screen (advisor/owner only — techs never see it). Bill = the approved jobs' subtotals taxed once (derived, never stored); record cash/card/check/other payments (deposits + partials welcome); balance = owed − collected; the ticket closes only when the balance clears, stamping `closedAt`/`deliveredAt`/`closedBy`. New append-only `ticket_payments` table (server-only, migration 0038 with RLS deny + service-role-only ACL, mirroring `shop_entitlements`); `POST /api/tickets/[id]/payments` (idempotent by requestKey, rejects overpayment) and `POST /api/tickets/[id]/close`. No card processing — the app records the money truth and closes the order; the shop takes payment however it already does. First time a ticket can reach `closed` — those columns had zero writers before. |

All: TypeScript clean, targeted tests green, production build passes. Not
driven through a live authenticated session (QA-credential gate).

**Deliberately deferred on getting-paid (v1 keeps it simple):** closing with an
outstanding balance / write-off (v1 requires paid-in-full or a $0 close);
reopening a closed ticket; voiding/refunding a recorded payment; a per-line or
parts-vs-labor customer receipt (kept to job subtotals + tax + total to preserve
the existing margin-protection rule that customers never see itemized parts);
and closing a still-open ticket where the customer declined *all* work (the
ring-out panel only appears once there's money to collect or a receipt to show).

---

## Not done yet — ranked

### High

- **Trust cues that lie (diagnosis surface — fix before it is re-enabled).**
  - Confidence meter always renders a green **"Met"** regardless of the real
    number — `components/vt/confidence-block.tsx:28-30`, used gate-less at
    `components/screens/diagnosis-proposed-review.tsx:105-115` and
    `components/screens/active-session.tsx:135-146`. Drive from the real gate or
    drop the pill on the AI path.
  - Risk badge hardcoded **"Low"** even on a destructive step —
    `components/screens/active-session.tsx:77`. Drive from the active node or hide.
  - "req ≥ 70%" hardcoded, unrelated to the node's real gate —
    `components/screens/active-session.tsx:85`.
- **Deferred vs abandoned collapse into one bin (revenue).** A genuine
  customer defer and a fat-finger/test abandon both write session status
  `deferred`, surfaced as "Incomplete" under "Closed" — real remembered revenue
  is indistinguishable from junk. Give abandon its own status/reason.
  `lib/db/sessions.ts:1110,1169`, `app/curator/deferred/page.tsx:19`.
  *(Related to the vehicle-history revenue theme; this is the diagnostic-session
  side. The shipped vehicle-history used the live ticket/job `declined` signal.)*
- **No first-run setup for a new shop.** A freshly-paid owner lands on an empty
  job board with no "do these first" (name shop · set rates · add canned jobs ·
  invite team). `components/screens/today-home.tsx:179-184`.

### Medium

- **Close the loop from a closed case to the vehicle.** Closed-case summary
  dead-ends at "Back to dashboard"; add a **View vehicle history** link (now that
  history is real) and show part cost / margin.
  `components/screens/closed-case-summary.tsx:98-106,148-160`.
  *(Cheap related follow-up to the shipped vehicle-history work.)*
- **Advisor locked out of counter intake.** Owner-only inline check; advisors can
  close and quote but cannot open a counter order. Make it a named capability and
  decide advisors in. `app/(app)/today/page.tsx:52`,
  `app/api/tickets/counter/route.ts:23-25`.
- **Two front doors, and the fast one drops the customer's concern.** Counter vs
  Quick differ in powers/destination/data with look-alike buttons; Quick has no
  "what brought them in" field (the story is the moat).
  `components/screens/today-home.tsx:82-118`, `components/screens/quick-ticket.tsx`.
- **Shop auto-named `"{email}'s Shop"`** — capture the real name at sign-up.
  `lib/db/queries.ts:82`.
- **Invite never captures a name** → roster of "Unnamed teammate".
  `components/vt/team-section.tsx:135`, `lib/shop-os/team.ts:119`.
- **Two "add a part" doors with opposite behavior**; "Source part" forces a
  supplier cost. One door + a "sourced" toggle; make cost optional.
  `components/screens/manual-quote-builder.tsx:842-895`,
  `components/screens/manual-part-sourcing.tsx:681`.
- **No "Save as canned job"** from a built job — the template library is only
  authored in Settings. `components/screens/manual-quote-builder.tsx`.
- **Ticket-detail provisional dead-end** — "Customer and vehicle still needed"
  with no button to fix it. `components/screens/ticket-detail.tsx:98-108`.
- **No "send quote to the customer" step** — approvals assume an offline
  conversation; the "notified by text" screen is an unwired mock.
  `components/screens/counter-work-order-confirm.tsx`.
- **Simple-work friction** — Complete stays disabled until the note is saved as a
  separate tap (make it save-then-complete); escalation forces a skill-tier choice
  on the tech. `components/screens/simple-work-workspace.tsx:143-144,205-227`.
- **Diagnosis-flow polish (dark surface).** Manual "Refresh" polling instead of
  auto-poll (`components/screens/today-jobs-board.tsx:528-545`); guided topology
  has no record/lock action and Back goes to `/curator`
  (`components/screens/topology-diagnostic.tsx:310`); tree-generating never
  advances itself (`app/(app)/sessions/[id]/page.tsx:43-47`); coverage jargon
  (`components/screens/adaptive-diagnostic-entry.tsx:11-17`); repair question does
  a full page reload (`components/screens/repair-ask-form.tsx:46`).

### Low

- **Abandon says "can't be undone" (it can) and uses a native `window.confirm`.**
  `components/screens/abandon-button.tsx:21-24`.
- **Owner-vs-tech identity copy** on the auth screens.
  `app/(auth)/sign-up/sign-up-form.tsx:229`, `app/(auth)/sign-in/page.tsx:187`.
- **`counter-work-order-confirm` mobile breakage** (unshipped prototype — no live
  customer hits it). `components/screens/counter-work-order-confirm.tsx:42,90`.

---

## What the audit affirmed (keep)

Live honest-money quote tape ("Total — unavailable", never a fake $0); the
immutable prepared quote + authorization record; the standing "AI guess — not
verified" banner; last-owner guardrails; concurrency-aware job claims; the
one-slot entitlement degradation; plain-English skill-tier labels.

---

## Founder bench direction — technician parts & labor (2026-07-18)

Founder walkthrough of the PR #175 preview set this direction for the
technician seat. Principles (founder's words, condensed):

1. **Management sets up suppliers, not techs.** The shop's supplier list
   (O'Reilly First Call, RepairLink, Tri-State, 4M Auto Warehouse, …) is
   configured by management ahead of time.
2. **Techs never touch money.** No supplier cost, no markup, no customer price
   in the tech flow — they only pick the parts they need.
3. **Techs enter labor time only** (hours; the shop labor rate does the
   pricing).
4. **One page.** The tech's job page is where everything happens — parts,
   labor, notes, completion. No navigating away to finish a task.

### Verified current state (2026-07-18 sweep — three read-only agents)

- **Supplier setup in Settings: absent.** Vendors are created only mid-sourcing
  and only by owner/founder (`canManageIntegrations`,
  `lib/shop-os/capabilities.ts:29-50`); everyone else dead-ends on "An owner
  needs to add a supplier" (`components/screens/manual-part-sourcing.tsx:484`).
  `vendorAccounts` already supports `manual | api | punchout` modes
  (`lib/db/schema.ts:518-580`) — bones ready for real supplier integrations
  later; UI only ever creates `manual`.
- **Markup automation: absent repo-wide.** Supplier cost (`unitCostCents`) and
  customer price (`priceCents`) are independent hand-typed fields; the sourcing
  panel requires BOTH (`manual-part-sourcing.tsx:678-682`); no markup/margin
  logic exists anywhere.
- **Tech money exposure — inverted vs principle 2.** Any role incl. `tech` can
  author priced quote lines (`canBuildQuotes` gate,
  `app/(app)/tickets/[id]/quote/page.tsx:33`, re-checked in
  `lib/shop-os/quotes.ts:760`); adding a part **requires typing the customer
  retail price** (`manual-quote-builder.tsx:1556-1558`) with no cost or margin
  context on screen.
- **Tech work screen violates principle 4.**
  `components/screens/simple-work-workspace.tsx` offers Start / Save note /
  Complete / "Found another concern" only — no parts, no labor entry, no money,
  no link to add parts. A parts action = hop out to the ticket, then into the
  quote builder (today → work → ticket → quote; 4–5 routes per job).
- **Labor.** Quote-line `laborHours` × shop rate auto-prices when a rate is set
  (mechanism live now that PR #175 ships rate settings) — principle 3 works at
  the quote. **Actual** wrench time is captured nowhere: `ticketJobs` has no
  started/finished stamps; transitions only bump `updatedAt`
  (`lib/shop-os/simple-work.ts:196-247`); only `claimedAt` exists.
- **The "one line" the founder saw.** The builder's edit form stacks fields
  one-per-row (fine). Density lives in the read-only line rows
  (`manual-quote-builder.tsx:820-898` — kind · qty · description · price on one
  lead row) and the sourcing panel's 2-per-row cost grid
  (`manual-part-sourcing.module.css:220-225`, quantity + supplier cost side by
  side above 800px). End customers never see itemized parts — approval surfaces
  show job subtotals + tax + total only (`lib/shop-os/quotes.ts:184-185`),
  which protects margin; **keep** that.

### New gaps confirmed by the sweep

- **~~High — Getting paid is absent.~~ SHIPPED (this branch).** Ring-out now
  bills approved work, takes payments, and closes/delivers the ticket
  (`tickets.closedAt/deliveredAt/closedBy` finally have writers). Remaining
  getting-paid gaps are the "deliberately deferred" list under Shipped:
  balance-on-delivery / write-off close, reopen, void/refund, and a $0 close for
  a fully-declined ticket. Canceling a ticket (`canceledAt`) is still unwritten —
  that's a separate "abandon vs close" concept, not part of ring-out.
- **High — Mid-job discovery is a detour.** Adding a repair job to an open
  ticket exists in the domain (`lib/tickets.ts:872`,
  `POST app/api/tickets/[id]/jobs/route.ts:35`) but the only in-UI button mints
  a `diagnostic` job — dead engine in prod — via escalation
  (`lib/shop-os/simple-work.ts:384-452`). Needs a plain "found something →
  repair job to quote" move from the work screen.
- **Med — Approval-channel honesty.** Approvals record staff-witnessed
  `phone | in_person` only (`lib/shop-os/quotes.ts:81`) — fine — but the
  counter confirm screen claims "The customer has been notified by text" while
  send is unwired (`counter-work-order-confirm.tsx:57-65`; `quote_sends` /
  `sms_log` have no production writers). The screen must stop claiming a text
  was sent. (Same disease as the fake-green trust cues.)
- **Med — Actual job time.** Stamp started/finished on the work transitions the
  tech already taps; quoted hours vs actual time is the shop's job-costing
  truth.
- **Med — Work history loses people.** Reassign overwrites `assignedTechId`
  with no history (`lib/tickets.ts:1198,1314`); a closed RO shows the current
  assignee only. No comeback/warranty linkage between tickets (repair spine has
  no rework-of field; the only "comeback" domain is diagnostic corpus quality).
- **Low — Parts lifecycle scaffolding unused.** `partStatus`
  (`proposed|needs_order|ordered|received|installed|returned`) +
  `coreChargeCents` + ordered/received stamps exist in schema
  (`lib/db/schema.ts:596-608`) but the live path writes only `'proposed'`
  (`lib/shop-os/quotes.ts:1653`). No backorder/ETA, customer-supplied parts, or
  sublet notions anywhere.

### What checked out production-grade (keep)

Quote versioning: append-only versions with supersede, affected jobs reset to
`pending_quote` on edit, and jobs already `in_progress`/`done` are pinned and
excluded from re-quoting (`lib/shop-os/quotes.ts:336,779,1333`).

### Build order (founder direction, plain)

1. **Suppliers + markup rule in Settings (management side).** DONE — suppliers
   (`5943c0f`) and the parts markup, both set-it (`6857852`) and auto-price
   (`430c4cf`). Remaining nuance for later: the derived price is a flat
   shop-wide markup shown **read-only** (like labor). Two possible follow-ups if
   a shop asks: (a) a **per-line override** for the odd part priced by hand
   (labor has the same rigidity today, so not urgent); (b) a **tiered parts
   matrix** (markup by cost band) — the industry norm, but heavier and against
   the "minimal friction" bias unless a real shop needs it.
   **Founder integration path (researched 2026-07-18):** for real in-app
   supplier catalogs, the practical first deal is the **PartsTech partner API**
   (one integration → 30k+ supplier locations incl. O'Reilly First Call,
   AutoZone Pro, Advance Pro, NAPA; shops link their own supplier accounts).
   Direct O'Reilly punchout/ordering integration: email
   `integrations@oreillyauto.com` / First Call support 1-800-934-2451; shops
   ordering through an approved system earn a 2% statement discount (+2% early
   pay). `vendorAccounts.mode` already reserves `api`/`punchout` for this.
2. **The big one — the tech job page becomes the one page:** parts picker
   (supplier from the shop's list + description + qty, zero money), labor
   hours, "found something" creating a repair job, start/finish stamps. This
   changes a technician surface — sequence against the driver-state gates
   before building.
3. **Real supplier catalog hookups** (`api`/`punchout` modes) are a later
   business-deal lane. Do not fake them in the UI before they exist.
