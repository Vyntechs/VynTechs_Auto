# Role-flow audit — what each person can actually do, 2026-07-31

Read-only audit of Shop OS as it stands on `main` at `ba13440`. Every claim below
was read out of the code, not out of a plan or a design doc. Where something is
intended but not shipped, this document says so. Where a subagent reported a
defect that turned out not to exist, it is listed at the end as a cleared false
positive so nobody re-files it.

Nothing was changed. No migration was run. No production data was touched.

---

## The verdict

**Who can do a full day's work today:**

| Role | Can they? | The short reason |
|---|---|---|
| **Technician** | **Yes**, with friction — and one trap | Find work, clock on, write findings, ask for parts, put it on hold, finish. The whole loop is real and the clock genuinely accumulates. What they cannot do is hand a job to someone else, un-claim one they took by mistake, or attach a photo. The trap: the board shows a green **Open work** button on jobs the customer declined, so a tech can start unapproved work in good faith. |
| **Advisor** | **No** | They can write a repair order, quote it, and take money. They cannot close a repair order once the customer declines any line — and a customer declining a line is the most ordinary thing that happens at a counter. |
| **Owner (at the counter)** | **No** | Same as the advisor. Every advisor limit is an owner limit. |
| **Owner (running the business)** | **No** | There is no reporting screen of any kind. Not revenue, not what the shop is owed, not what closed today, not tech productivity. The data is all in the database and none of it is on a screen. |
| **Parts** | **No** | There is a real shop-wide list of what techs need, and one button: "Got it." There is no ordering step, no receiving step, and no record afterwards of what they sourced. The app's own help text tells them to go do the actual work in RepairLink or First Call. |

**The three worst pieces of friction in the whole product:**

1. **A declined line is not handled anywhere, and it costs twice.** Customer
   approves the brakes, declines the tires. First, the tech's board still shows a
   green **Open work** button on the tires, because the row never renders
   approval state — so a technician can start unapproved work in good faith.
   Second, once the brakes are done and you take the money, the repair order will
   not close, and cannot be canceled either, because you already took money. It
   sits on the board permanently. There is no control anywhere in the product to
   retire a job the customer said no to.

2. **Nothing can be found once it leaves the Today board.** There is no repair
   order list, no repair order search, and no way to open a closed repair order —
   or to reopen one. The customer who comes back at 4pm on a ticket you closed at
   noon has to be written up from scratch on a new number.

3. **Refusals blame the internet.** Across six screens, an authorization refusal,
   a state refusal, and a rate-limit refusal all print the same sentence: *"check
   your connection and try again."* Retrying will never work. And there is not a
   single error page in the entire application, so any server-side failure drops
   the user on Next.js's raw default error screen with no way back.

**The single highest-leverage fix** is at the bottom of this document.

---

## How to read the findings

Each finding gives you: what the person would experience in one sentence, how bad
it is, where in the code it lives, and roughly what it would cost to fix.

- **BLOCKER** — that role cannot do their job.
- **FRICTION** — they can, but it is worse than the software they left.
- **POLISH** — it is not costing anyone a job, but it is not the standard.

Five defect shapes are called out by name:

- **DEAD END** — the flow stops and there is no way forward from that screen.
- **DOUBLE BACK** — you must leave, go elsewhere, and come back to continue.
- **SILENT REFUSAL** — a control is dead or rejects, and the reason is not where
  you are looking. This shape has already shipped four separate times in this
  repo. It was hunted deliberately here.
- **MISSING** — a step a real shop performs, with no implementation at all.
- **SETTING GAP** — the product needs a value it will not let anyone set.

---

## Before the roles: what everyone shares

### There is one door and two rooms

The whole signed-in application is reachable from a hamburger menu with three
items: **My Jobs**, **Settings**, and **Sign out**
(`components/vt/app-header-menu.tsx:71-105`). That is the entire navigation.

Everything a shop does hangs off `/today`. There is no `/tickets` list route —
`app/(app)/tickets/` contains only `[id]` and `new`. There is no customer list,
no vehicle list, and no search for a repair order. The only search in the product
lives inside the intake screen and returns customers and vehicles, never tickets
(`lib/intake/search.ts:53-58`).

The Today board is not actually "today" — it correctly shows all open work with
no date filter (`lib/tickets.ts:562-575`), which is right. The problem is what
falls off it.

### The wall display is signed in as one person, so it shows one person's view

`/floor` is a read-only 65" board (`app/floor/page.tsx:16-27`). It reuses
`listTodayTicketJobs` scoped to whoever is signed in on that laptop
(`app/floor/page.tsx:23`). If the wall is signed in as a technician, the board
shows that technician's jobs and nothing else, and its "Waiting on customer" lane
is permanently empty, because ready-to-collect returns nothing to anyone who
cannot close tickets (`lib/shop-os/ready-to-collect.ts:44-52`).

There is also no link to `/floor` anywhere in the product. Someone has to know to
type the URL.

- **What you'd experience:** the shop TV either shows the wrong slice of the shop
  or is missing lanes, depending on which account happens to be signed in on that
  laptop, and there is no way to reach it from the app.
- **Severity:** FRICTION
- **Evidence:** `app/floor/page.tsx:23`, `lib/shop-os/ready-to-collect.ts:44-52`;
  no `href="/floor"` exists anywhere in `app/` or `components/`.
- **Fix:** half a day — give `/floor` a fixed shop-wide projection instead of an
  actor-scoped one, and put it in the menu.

### The "Waiting on customer" lane on the wall can never light up

The wall board sorts trucks by who owes the next move. A truck waiting on the
customer's yes/no is supposed to land in the `customer` lane via
`ticket.quoteSent` (`lib/shop-os/floor-board.ts:109`), which is set from
`job.approvalState === 'sent'` (`:131`).

Nothing in the entire codebase ever writes `'sent'`. It is a valid value in the
schema (`lib/db/schema.ts:393`) and it is read in four places, and it is written
in zero. So the string `'QUOTE SENT'` at `lib/shop-os/floor-board.ts:120` is
unreachable, and a truck awaiting a customer decision sits in "With a tech",
misrepresenting the floor to everyone looking at the TV.

- **Severity:** FRICTION
- **Evidence:** `lib/shop-os/floor-board.ts:109,120,131`; `lib/db/schema.ts:393`.
- **Fix:** falls out of fixing the quote-send gap; on its own, an hour.

### There is no error page anywhere in the application

`find app -name "error.tsx" -o -name "not-found.tsx" -o -name "global-error.tsx"`
returns nothing. The only `loading.tsx` in the repo is inside the dark
diagnostics surface.

That means: a database hiccup while loading `/today` shows Next.js's unstyled
default error page. A permission refusal — an advisor opening
`/settings/shop`, or a technician opening `/intake` — calls `notFound()`
(`app/(app)/settings/shop/page.tsx:26`, `app/(app)/intake/layout.tsx:15`) and
renders the bare framework 404: *"This page could not be found."* No explanation
of what happened, no link back to work.

`notFound()` is called **19 times** across `app/(app)/**`, and a large share of
those are permission refusals rather than genuinely missing pages. **The product
currently has no way to tell anyone they lack permission**, because there is no
boundary in which to say it.

- **What you'd experience:** the app breaks or refuses you, and you get a black
  and white developer error page with no way back to your job.
- **Severity:** FRICTION (BLOCKER the moment it happens mid-shift, because there
  is no recovery path on the screen)
- **Evidence:** no `error.tsx` in `app/`; 19 `notFound()` calls in `app/(app)/**`,
  including `app/(app)/settings/shop/page.tsx:26`, `app/(app)/intake/layout.tsx:15`,
  `app/(app)/tickets/[id]/quote/page.tsx:33`, `app/(app)/settings/(admin)/layout.tsx:17`,
  `app/(app)/tickets/[id]/page.tsx:38`.
- **Fix:** half a day — one `app/(app)/error.tsx` and one `not-found.tsx` that
  say what happened and link to `/today`. Half a day more to turn the permission
  refusals into an honest "advisors only" page instead of a 404.

### A new hire who has not finished accepting their invite sees a normal quiet day

`listTodayTicketJobs` returns an empty board whenever `membershipStatus !==
'active'` (`lib/tickets.ts:420-426`). The screen that results is the ordinary
empty state: *"No assigned work yet. New work orders and quick tickets appear
here."* (`components/screens/today-home.tsx:209-213`).

- **What you'd experience:** your second employee signs in on their first
  morning, sees a calm empty board, and assumes the shop is slow — when in fact
  their account was never activated.
- **Severity:** FRICTION
- **Evidence:** `lib/tickets.ts:420-426`; `components/screens/today-home.tsx:209-213`.
- **Fix:** one hour. This is the same shape as the skill-tier hole below: a
  refusal collapsed into an empty list.

### Six screens blame the network for refusals that have nothing to do with the network

This is the fourth-and-fifth instance of the defect class the driver state
already named. A business-rule refusal arrives as a 403 or a 409 with a
structured reason, and the client throws it away:

| Screen | What it says | What actually happened |
|---|---|---|
| `components/screens/parts-needed-panel.tsx:105-110` | "Not sent — check your connection and try again." | Job not approved, not in progress, or 20-request rate limit (`lib/shop-os/part-requests.ts:151-158`, `:183-185`) |
| `components/screens/simple-work-workspace.tsx:288-291` | "Work changed elsewhere. Review the current state and try again." | Approval was withdrawn, or work is not ready — same 409 as a genuine conflict (`app/api/tickets/[id]/jobs/[jobId]/work/route.ts:15-23`) |
| `components/screens/ticket-assignment-control.tsx:153-154` | "Handoff was not saved. Check the connection and retry." | Role forbidden, or below skill tier (`lib/shop-os/interruption.ts:264`, `:288`) |
| `components/screens/ticket-lifecycle-control.tsx:76` | "The repair order was not changed. Check the connection and retry." | Cancel refused because a payment already exists (`lib/shop-os/interruption.ts:538-543`) |
| `components/screens/ticket-part-requests.tsx:37` | "Not saved — check your connection and try again." | 403 or a 409 where someone else already handled it |
| `components/screens/ticket-interruption-action.tsx` | same shape | same |

- **What you'd experience:** you are told your Wi-Fi is bad. You retry. It fails
  again. It will always fail, because the reason is not the network.
- **Severity:** FRICTION
- **Evidence:** the six files and line numbers above.
- **Fix:** two days — the server already returns named reasons; each client needs
  a `humanize(code)` map like the good ones already in
  `components/screens/ring-out-section.tsx:23-42` and
  `components/vt/team-section.tsx:376-389`.

### The Today board hides the fact that it has gone stale

The board polls every 20 seconds. On any failure — including a 403 from the
paywall or a deactivation — it returns silently and the empty `catch` is
deliberate (`components/screens/today-jobs-board.tsx:159-178`). The wall board
does the same (`components/screens/floor-board.tsx:38-44`).

- **What you'd experience:** the board looks fine and is quietly frozen. Nobody
  knows a truck moved.
- **Severity:** FRICTION
- **Evidence:** `components/screens/today-jobs-board.tsx:159-178`.
- **Fix:** two hours — a small "last updated 4 min ago" stamp that goes amber.

---

## The advisor / owner at the counter

### The walk

1. **Greet, find the customer.** From `/today`, tap **New work order** — a link
   to `/intake` rendered at `components/screens/today-home.tsx:99-116` — or
   **Quick ticket** to `/tickets/new` (`:117-135`). Counter intake is the
   full door: `components/screens/counter-intake.tsx`, mounted through
   `app/(app)/intake/layout.tsx`.
2. **Search.** Type a name, phone, VIN or plate into the combined search at
   `components/vt/intake-search/index.tsx`; pick a customer or vehicle from the
   dropdown (`components/vt/intake-search/dropdown.tsx`), or create new.
3. **Write the concern.** One free-text box —
   `components/screens/counter-intake.tsx`, the section PR #215 collapsed from
   four into one.
4. **Authorize the work.** Either diagnostic labor with an explicit title, hours
   and price, or known work from the saved-job list — same screen.
5. **Assign.** `components/vt/tech-selector/index.tsx`, rendered at
   `components/screens/counter-intake.tsx:470`.
6. **Submit.** `POST /api/tickets/counter` → `lib/intake/counter-ticket.ts:183`.
   You land on the repair order.
7. **Quote.** From `/today` or the repair order, **Build quote** →
   `/tickets/[id]/quote` → `components/screens/manual-quote-builder.tsx`. Add
   labor, parts and fees; the labor rate prefills from the shop rate and can be
   typed over per line (`lib/shop-os/quote-builder-ui.ts:500-508`).
8. **Prepare.** The **Prepare quote** button at
   `components/screens/manual-quote-builder.tsx:1335-1342` freezes an immutable
   version. Anything blocking it is listed immediately above the button
   (`:1330-1334`) — this is the best-behaved disabled control in the product.
9. **Send it.** *This step does not exist.* See below.
10. **Record the decision.** Phone the customer, then use the authorization strip
    — **Record approval** / **Record declined** / **Defer decision** at
    `components/screens/manual-quote-builder.tsx:1645-1651`.
11. **Order parts.** *No ordering step exists.* You see what the tech asked for
    at `components/screens/ticket-part-requests.tsx` and mark it "Got it".
12. **Keep the customer informed.** *Nothing exists.* The repair order page
    offers a `tel:` and a `mailto:` link (`components/screens/ticket-detail.tsx:326,331`).
13. **Collect.** **Collect & close** on the Today board, or the ring-out panel on
    the repair order — `components/screens/ring-out-section.tsx`. Amount, method
    (cash / card / check / other), note.
14. **Close.** Same panel → `lib/shop-os/ring-out.ts:399`.

### Findings

#### 1. One declined line jams the repair order forever — BLOCKER

This is the single worst thing in the product.

Recording a decision writes `approvalState` and nothing else — the job's
`workStatus` stays `'open'` (`lib/shop-os/quotes.ts:1800-1804`). Closing a repair
order refuses if *any* job is still `open`, `in_progress` or `blocked`
(`lib/shop-os/ring-out.ts:372-381`).

There is no control anywhere in the product to retire a single job. The
command vocabulary the repair order can offer is
`assign | claim | handoff | quote | work | resolve_hold | ring_out | close`
(`lib/shop-os/living-ticket.ts:21`) — there is no cancel. The only two places in
the entire codebase that set one job to `canceled` are the whole-ticket cancel
(`lib/shop-os/interruption.ts:554`) and the AI-session close-out
(`lib/sessions.ts:592`), which is dark in production.

And the whole-ticket cancel escape hatch closes the moment you take money:
`lib/shop-os/interruption.ts:538-543` refuses if a payment row exists.

- **What you'd experience:** the customer approves the brakes and declines the
  tires. Your tech finishes the brakes. You take the $800. You press Close and
  it says *"Finish or cancel every work item before closing this repair order"* —
  and there is nothing on any screen that finishes or cancels the tire job. You
  try to cancel the whole repair order instead and it refuses, because you
  already took the money. That repair order is now on your board forever.
- **Severity:** BLOCKER
- **Evidence:** `lib/shop-os/quotes.ts:1800-1804`; `lib/shop-os/ring-out.ts:372-381`;
  `lib/shop-os/living-ticket.ts:21`; `lib/shop-os/interruption.ts:538-543`, `:554`.
- **Fix:** about a day. The server-side cancel already exists in
  `interruption.ts`; this needs one new command kind, one control, and the
  existing per-job update path.

#### 2. A closed repair order cannot be found or reopened — BLOCKER

Once `tickets.status` is `'closed'`, the repair order disappears from Today
(`lib/tickets.ts:563` filters `status = 'open'`) and there is no list or search to
find it again. If you somehow have the URL, the lifecycle control renders nothing
at all — `components/screens/ticket-lifecycle-control.tsx:43` returns `null` for
closed. The API agrees: reopen requires `status === 'canceled'`
(`lib/shop-os/interruption.ts:474`). A *canceled* repair order can be reopened; a
*closed* one never can.

This is already known — the driver state calls it Row 61 and the server half sits
on draft PR #202 — but it is not shipped, and it is a blocker, so it belongs here.

- **What you'd experience:** you closed RO #412 at noon. At 4pm the customer is
  back with the same noise, or you realise you forgot to bill a $90 part. You
  cannot open that repair order, you cannot find it, and you cannot reopen it.
  You write a new one on a new number with no link to the first.
- **Severity:** BLOCKER
- **Evidence:** `lib/tickets.ts:563`; `components/screens/ticket-lifecycle-control.tsx:43`;
  `lib/shop-os/interruption.ts:474`.
- **Fix:** a week for the full lookup surface (the server half is already
  written); two days for the narrow version — a search box on Today plus allowing
  reopen from `closed`.

#### 3. There is no way to send a quote to a customer — FRICTION

Not a stub, not a placeholder — nothing. No send control anywhere. No SMS or
email provider in the repo at all (`twilio`, `resend`, `sendgrid`, `postmark`,
`nodemailer` return zero hits across `lib/` and `app/`). No customer-facing page:
every route in the app sits behind `(app)`, `(auth)`, `/curator`, or static legal
pages.

The scaffolding is all built and completely dark: a `quote_sends` table with
`channel = 'sms'` (`lib/db/schema.ts:891`), an `sms_log` table (`:1160`), an
`sms_suppressions` table (`:1463`), and a full TCPA consent subsystem across
`lib/shop-os/messaging-consent.ts`, `messaging-deletion.ts` and
`messaging-retention-policy.ts`. No component or API route references any of it.
`canSendQuotes()` (`lib/shop-os/capabilities.ts:17-19`) has no call sites other
than the three aliases defined directly beneath it.

- **What you'd experience:** you build a beautiful quote and then pick up the
  phone, exactly as you did before, and type the answer back in by hand.
- **Severity:** FRICTION — most independent shops sell on the phone anyway, and
  the decision is recorded honestly as "Phone approval." But it is the single
  biggest thing a customer would notice missing versus the competition.
- **Evidence:** `lib/shop-os/capabilities.ts:17-19`; `lib/db/schema.ts:891`,
  `:1160`, `:1463`; no provider dependency in `package.json`.
- **Fix:** a week or more, and it is a business decision before it is a build —
  A2P 10DLC registration, a provider, and a customer-facing quote page.

#### 4. A failed search tells the advisor the customer does not exist — FRICTION

When the search request fails, `lib/intake/use-search.ts:88-91` and `:110-114`
set state to `{ kind: 'error', message: 'Search unavailable' }`. That message is
never rendered anywhere. `components/vt/intake-search/index.tsx:309` routes the
error state into the **same component as a genuine zero-result**, which prints
*"Nothing matches …"* and offers **"Create new customer with this info"**
(`components/vt/intake-search/dropdown.tsx:254-260`).

- **What you'd experience:** a returning customer of eight years walks in, the
  search backend hiccups, and the product tells you they are not in the system
  and invites you to create them again. You end up with two of everybody.
- **Severity:** FRICTION (data-corrupting, so it punches above its weight)
- **Evidence:** `lib/intake/use-search.ts:88-91`;
  `components/vt/intake-search/index.tsx:309`.
- **Fix:** one hour. Render the error state as an error.

#### 5. A customer or vehicle can never be edited — FRICTION

Outside creation, the only write to `customers` or `vehicles` anywhere is
mileage (`lib/intake/quick-ticket.ts:209`, `:239`;
`lib/intake/counter-ticket.ts:296`). There is no `app/api/customers` or
`app/api/vehicles` route and no edit UI. The repair order's concern is equally
write-once — the only three `update(tickets)` sites are cancel, reopen and close
(`lib/shop-os/interruption.ts:512`, `:579`; `lib/shop-os/ring-out.ts:399`).

- **What you'd experience:** a mistyped phone number, a misspelled name or a
  wrong VIN is permanent. So is a concern you typed before the customer finished
  the sentence.
- **Severity:** FRICTION
- **Evidence:** no customer/vehicle write path outside creation;
  `components/screens/ticket-detail.tsx:369-371` renders the concern read-only.
- **Fix:** a day for customer and vehicle edit; two hours for the concern.

#### 6. Two dead buttons on the counter's own add-work controls — FRICTION

`components/screens/add-diagnostic-time.tsx:146` disables Save on
`!ready || busy`, where `ready` requires both hours and a price (`:46`). Nothing
adjacent to the button says so; the only text near it is an error slot
(`:141-145`) that is empty until a request fails. Same shape at
`components/screens/add-repair-job.tsx:112`.

This is the exact defect class PR #209 fixed on the intake form. It survives on
these two.

- **What you'd experience:** you press the button and nothing happens, twice, and
  then you go looking for what you missed.
- **Severity:** FRICTION
- **Evidence:** `components/screens/add-diagnostic-time.tsx:146`, `:46`;
  `components/screens/add-repair-job.tsx:112`, `:30`.
- **Fix:** two hours, following the pattern already in `counter-intake.tsx:69-132`.

#### 7. "Add canned job" and "Source part" go dead with no reason — FRICTION

`components/screens/manual-quote-builder.tsx:1041` and `:1214` disable on
`busy || editor !== null || modal !== null || sourcingJob !== null`. Nothing
adjacent explains "close the open line editor first." The Prepare button ten
lines away does explain itself (`:1330-1334`), so the good pattern is already in
the same file.

Same shape on the repair order: **Build quote** at
`components/screens/ticket-detail.tsx:216` and the work opener at `:451` are both
disabled on `activeTool !== null` with no adjacent text.

- **Severity:** FRICTION
- **Fix:** two hours.

#### 8. A blocked-quote instruction points an advisor at a page they get a 404 on — FRICTION

When the shop has no tax rate, Prepare is blocked with the reason *"Configure a
tax rate in shop settings."* (`lib/shop-os/quote-builder-ui.ts:416`). Shop
settings are owner-only: `app/(app)/settings/shop/page.tsx:26` calls `notFound()`
unless `canManageTeam` (`lib/shop-os/capabilities.ts:29-34`).

- **What you'd experience:** the product tells you exactly what to do, you go do
  it, and you get a bare 404.
- **Severity:** FRICTION
- **Fix:** one hour — say "ask an owner to set the tax rate in Settings → Shop".

#### 9. A brand-new shop has no assignable technicians and no way to say so — FRICTION

The assignable roster filters on `isNotNull(profiles.skillTier)`
(`lib/intake/team.ts:39-40`). A freshly created shop's owner has a null tier, so
the roster is empty. The tech selector then does not render at all —
`components/screens/counter-intake.tsx:470` hides it with no empty state and no
explanation. On the repair order, the equivalent control at least says *"No
active wrenching profiles are available."* (`components/screens/ticket-assignment-control.tsx:215-216`),
though with no link to fix it.

- **Severity:** FRICTION on day one, invisible after
- **Fix:** two hours.

#### 10. Payment is a ledger entry that can never be corrected — FRICTION

`app/api/tickets/[id]/payments/route.ts` exposes `POST` only. There is no void,
no delete, no refund, and the amount must be at least 1 cent
(`lib/shop-os/ring-out.ts:59`). The only Stripe integration in the repo is the
shop's own subscription, not customer payments.

- **What you'd experience:** you fat-finger $54 instead of $45 and there is no
  way to take it back.
- **Severity:** FRICTION
- **Evidence:** `app/api/tickets/[id]/payments/route.ts` (POST only);
  `lib/shop-os/ring-out.ts:59`.
- **Fix:** half a day for a reversing entry.

#### 11. No invoice and no receipt — FRICTION

`components/screens/ring-out-section.tsx:143` relabels its heading to "Receipt"
once the repair order closes, and that is the extent of it. Nothing prints,
downloads, emails or exports. There is no `window.print` and no `@media print`
anywhere in the repo.

- **Severity:** FRICTION
- **Fix:** two days for a printable repair-order view.

#### 12. The Close button looks available before it is — POLISH

`lib/shop-os/ring-out.ts:199` computes `canClose` from status and balance only —
it does not check for unfinished work, which `closeTicket` does at `:372-381`.
The button renders live and the real reason appears after the click. The message
that appears is good (`components/screens/ring-out-section.tsx:29-30`); it is
just late, and in the declined case (finding #1) it is unactionable.

- **Severity:** POLISH on its own; it is finding #1 that gives it teeth.
- **Fix:** one hour.

---

## The technician

### The walk

1. **Find my work.** `/today` → `components/screens/today-jobs-board.tsx`.
   The header reads "My Jobs" for a tech and "Shop floor" for anyone who can
   dispatch (`components/screens/today-home.tsx:69`). A tech sees two lanes: "My
   work" (`:704-729`) and "Available" — unassigned open jobs at or below their
   skill tier (`:730-751`).
2. **Claim.** The **Claim job** button at
   `components/screens/today-jobs-board.tsx:1195`.
3. **Understand what is approved.** Open the job → the approved-scope panel at
   `components/screens/simple-work-workspace.tsx:421`, which itemises the exact
   approved parts, labor and fees plus any customer-supplied-parts note
   (`:564-586`). This is genuinely good and it renders before you clock on.
4. **Clock on.** `components/screens/simple-work-workspace.tsx:443-446`.
   Real time: `ticket_jobs.clocked_on_since` and `ticket_jobs.active_seconds`
   (`lib/db/schema.ts:408-409`), banked in SQL at
   `lib/shop-os/simple-work.ts:188-191`.
5. **Record findings.** The work-note textarea at
   `components/screens/simple-work-workspace.tsx:467-468`, saved to
   `ticket_jobs.work_notes` with optimistic-concurrency protection and a
   `sessionStorage` crash draft (`lib/shop-os/simple-work-draft.ts:8-45`).
6. **Request parts.** `components/screens/parts-needed-panel.tsx:139-157`,
   mounted inside the workspace at `simple-work-workspace.tsx:489-500`.
7. **Put it on hold.** A collapsed `<details>` at
   `components/screens/simple-work-workspace.tsx:501-520` — reason
   (parts / customer / schedule / shop) plus a required note.
8. **Hand off.** *Not available to a technician.*
9. **Complete.** `components/screens/simple-work-workspace.tsx:477-488`. A saved
   work note is required, server-enforced at `lib/shop-os/simple-work.ts:337`.
10. **Next job.** Back to the board.

The core of this is real and it works. The findings below are what surrounds it.

### Findings

#### 1. The board shows a green "Open work" button on work the customer declined — BLOCKER

`workAvailable` at `components/screens/today-jobs-board.tsx:1320` checks customer,
vehicle, work status and session — **it never checks `approvalState`**. So a
declined job renders the primary "Open work" button (`:1329`, `:1340`). The tech
taps it, the workspace loads, and they get a read-only panel saying *"Customer
declined this work."* (`components/screens/simple-work-workspace.tsx:434-435`).

`approvalState` is fetched for every row (`lib/tickets.ts:617`) and rendered on
none of them — the facts row prints kind, tier and work status only
(`components/screens/today-jobs-board.tsx:1179-1186`).

- **What you'd experience:** the board tells you to start a job the customer said
  no to. You find out after you have walked to the truck.
- **Severity:** BLOCKER — a technician starting unapproved work is how a shop
  eats a repair.
- **Evidence:** `components/screens/today-jobs-board.tsx:1320`, `:1179-1186`;
  `lib/tickets.ts:617`.
- **Fix:** two hours. The data is already on the row.

#### 2. A technician cannot hand off a job, and nothing says so — FRICTION

`canAssignWork` is advisor-or-owner only (`lib/shop-os/capabilities.ts:17-23`),
enforced at `lib/shop-os/interruption.ts:264`. The assignment control only renders
under `canDispatchWork` (`components/screens/today-jobs-board.tsx:1200`). A tech
looking at their own job sees no handoff control and no sentence explaining that
handoff is an advisor's action, nor any way to ask for one.

Worse: `unclaimTicketJob` explicitly permits the assigned tech
(`lib/tickets.ts:1651-1659`), but the only UI that sends `unclaim` is inside the
advisor-only picker (`components/screens/ticket-assignment-control.tsx:230-239`).
A working server capability with no technician surface.

- **What you'd experience:** you claimed the wrong job, or you have to leave at 3
  and the truck needs to move to someone else, and there is no button. You go
  find the advisor.
- **Severity:** FRICTION
- **Evidence:** `lib/shop-os/capabilities.ts:17-23`;
  `components/screens/today-jobs-board.tsx:1200`; `lib/tickets.ts:1651-1659`;
  `components/screens/ticket-assignment-control.tsx:230-239`.
- **Fix:** half a day for un-claim (server is done); the handoff question is a
  policy decision for the owner before it is a build.

#### 3. Putting a job on hold 404s the page you are standing on — FRICTION

`lib/shop-os/simple-work.ts:405-411` returns `not_found` once `workStatus` is
`blocked`, so `/tickets/[id]/jobs/[jobId]/work` hard-404s
(`app/(app)/tickets/[id]/jobs/[jobId]/work/page.tsx:36`). The component handles
this by force-navigating to the repair order
(`components/screens/simple-work-workspace.tsx:390`). To resume, the tech has to
get back to `/today`, find the row, press **Resolve hold**
(`components/screens/today-jobs-board.tsx:1246-1258`), then press **Open work**
again.

Worse in sequence: the natural move is *hold for parts, then tell parts what you
need* — and that is impossible, because the parts form lives on the page that
just 404'd, and the server requires `workStatus === 'in_progress'` anyway
(`lib/shop-os/part-requests.ts:157`).

- **Severity:** FRICTION
- **Fix:** half a day — let the workspace load in a blocked state with a resume
  control, rather than refusing it.

#### 4. The hold reason is written down where nobody looks — FRICTION

The tech is required to type what needs to happen next
(`components/screens/simple-work-workspace.tsx:513-514`) and it is stored
properly (`ticket_jobs.hold_note`, `lib/db/schema.ts:410-418`). It is rendered in
exactly one place: a line inside the collapsed "Repair order activity"
`<details>` at the bottom of the repair order
(`lib/tickets.ts:1027`; `components/screens/ticket-detail.tsx:541-554`).

Everywhere the advisor actually looks it is absent: the Today row says only
`Blocked` (`components/screens/today-jobs-board.tsx:1182`); the wall board's
"Held" lane shows the tech's first name or the word `HELD`
(`lib/shop-os/floor-board.ts:113-124`); the job ledger shows a `Work · Blocked`
stamp (`components/screens/ticket-detail.tsx:417-419`).

- **What you'd experience:** the tech carefully writes "waiting on the injector
  cup tool from Snap-on, Thursday" and the advisor sees the word "Blocked."
- **Severity:** FRICTION
- **Fix:** two hours — put the hold note on the board row and the wall.

#### 5. Complete is permanently disabled by a draft you cannot see — FRICTION

`components/screens/simple-work-workspace.tsx:484` disables **Complete work** on
`hasAuxiliaryDraft`, which includes `hasHoldDraft` (`:114-118`). The adjacent
helper text (`:479-483`) says *"Finish or clear the open concern or parts draft
first"* — it never mentions the hold draft. And the hold form is a `<details>`
that is collapsed by default, so the offending field is not even on screen.

- **What you'd experience:** you typed one character into the hold reason,
  changed your mind, collapsed it, finished the job — and Complete is dead, with
  a message pointing at two boxes that are both empty.
- **Severity:** FRICTION
- **Evidence:** `components/screens/simple-work-workspace.tsx:484`, `:114-118`,
  `:479-483`.
- **Fix:** one hour.

#### 6. The clock runs and the time reaches nothing — FRICTION

`active_seconds` is banked correctly on every path — clock off, hold, handoff,
complete, cancel (`lib/shop-os/simple-work.ts:188-191`, `:283-296`, `:338-353`;
`lib/shop-os/interruption.ts:298`, `:334`, `:555`). And then it stops. Grepping
`activeSeconds` across `lib/shop-os/quotes.ts`, `quote-math.ts`, `ring-out.ts` and
`ready-to-collect.ts` returns nothing. It is never billed, never compared against
quoted hours, never shown to an advisor or an owner.

- **What you'd experience:** the tech clocks on and off all day and the number
  exists only on their own screen until they close the panel.
- **Severity:** FRICTION (and it is the missing half of any future productivity
  reporting)
- **Evidence:** `lib/db/schema.ts:408-409`; no consumer outside
  `simple-work*.ts` and the tech's own workspace.
- **Fix:** half a day to surface actual-vs-quoted hours on the repair order.

#### 7. No photos, no measurements — FRICTION

The `job_attachments` table exists (`lib/db/schema.ts:584-620`) and its routes
exist — and the POST handler is a hard 404 stub
(`app/api/tickets/[id]/jobs/[jobId]/attachments/route.ts:19-22` returning
`OPERATIONAL_MEDIA_UNAVAILABLE`, `lib/release-policy.ts:4-7`). No component
references `/attachments` at all. Findings are one free-text box; there is no
structured place for a pressure, a voltage, a torque value or a DTC.

- **What you'd experience:** you photograph the cracked line on your phone's
  camera roll and describe it in a sentence.
- **Severity:** FRICTION
- **Fix:** a week — this is a storage, cost and retention decision as much as a
  build.

#### 8. Skill tier silently deletes work from the board — FRICTION

A job above the tech's tier is not greyed out, it is **removed from the query**
(`lib/tickets.ts:429-442`). A tech whose tier is null ("Does not wrench") gets no
Available lane at all and no message. The one sentence in the whole codebase that
explains the tier rule sits on an advisor-only control
(`components/screens/ticket-assignment-control.tsx:246`). A technician is never
shown their own tier anywhere.

- **Severity:** FRICTION
- **Fix:** two hours — show the tier on the tech's own header and say "3 jobs
  above your tier" on an empty Available lane.

#### 9. Handoff of active work has no below-tier override, initial assignment does — POLISH

`components/screens/ticket-assignment-control.tsx:162-168` refuses a below-tier
handoff and says so adjacent to the control — correct behavior, honestly
surfaced. But initial assignment *can* be overridden with "Assign anyway"
(`:250-254`) and a handoff cannot (`lib/shop-os/interruption.ts:283-289`, no
`confirmBelowTier`). In a real shop, "the A-tech left, give it to the B-tech" is
the more common case.

- **Severity:** POLISH (a policy call, not a defect)
- **Fix:** two hours, once the owner decides.

#### 10. The technician's "Record findings" button opens the priced quote builder — POLISH

For an unapproved diagnostic job with diagnostics off — which is every shop in
production — `components/screens/today-jobs-board.tsx:1371-1379` renders a link
labelled **Record findings** pointing at `/tickets/[id]/quote`. That page gates on
`canBuildQuotes`, which returns true for every shop role
(`lib/shop-os/capabilities.ts:13-15`). So a tech tapping it lands in the full
money-bearing quote builder, contradicting the "techs never see money" rule the
code states elsewhere (`app/(app)/tickets/[id]/page.tsx:48`).

- **Severity:** POLISH today (the shop is small and everyone trusts everyone);
  it becomes a real problem at eight employees.
- **Fix:** an owner decision, then two hours.

---

## The parts person

### The walk

1. **Sign in.** Land on `/today` like everyone else — there is no role-based
   routing (`lib/safe-next-path.ts:13` hardcodes `/today`).
2. **See what is needed.** A genuine shop-wide "Parts needed" lane
   (`components/screens/today-jobs-board.tsx:782-796`), fed by a query scoped only
   to the shop and to open requests (`lib/tickets.ts:505`, `:456-464`). This is
   right, and it means the parts person does not have to open tickets one at a
   time.
3. **Source it.** *Outside the product.*
4. **Order it.** *Does not exist.*
5. **Mark it received.** *Does not exist.*
6. **Know which job is unblocked.** *Does not exist.*

The only action in the lane is a button labelled **Got it**
(`components/screens/today-jobs-board.tsx:1230-1237`), which sets the request to
`sourced` and removes the row.

### Findings

#### 1. There is no ordering step and no receiving step — BLOCKER

The part-request status enum is `requested | sourced | dismissed`
(`lib/shop-os/part-requests.ts:25`, `:47`). That is the whole lifecycle.

The database already models the real one. `lib/db/schema.ts:773` declares
`part_status in ('proposed','needs_order','ordered','received','installed','returned')`
with `ordered_at` / `ordered_by_profile_id` (`:775-776`) and `received_at` /
`received_by_profile_id` (`:777-778`). Every write path in the product hardcodes
`'proposed'` with all four columns null (`lib/shop-os/parts-offers.ts:496`;
`lib/shop-os/quotes.ts:1849`; `lib/shop-os/canned-jobs.ts:352-355`, `:806-809`),
and the validators actively reject anything else
(`lib/shop-os/parts-adapters.ts:135-148`). The strings `'ordered'`, `'received'`
and `'needs_order'` appear in no product code outside the schema.

There is also no vendor selection or price comparison:
`ManualPartsAdapter.searchParts` always returns `{ kind: 'manual_entry_required' }`
(`lib/shop-os/parts-adapters.ts:166`). And the product's own help text says the
quiet part out loud — *"Source these in RepairLink / First Call, then mark them."*
(`components/screens/ticket-part-requests.tsx:46`).

- **What you'd experience:** you see the list, you go order in someone else's
  system, you come back and press one button that means nothing more specific
  than "seen." Nobody is told the part landed. The tech finds out by re-opening
  the job.
- **Severity:** BLOCKER for the role
- **Evidence:** `lib/shop-os/part-requests.ts:25`, `:47`; `lib/db/schema.ts:773-778`;
  `lib/shop-os/parts-adapters.ts:135-148`, `:166`.
- **Fix:** a week for the real spine (ordered / received, with a resume of the
  held job on receipt). Two days for the honest minimum: an "Ordered" state, a
  "Received" state, and clearing the tech's hold when the part lands.

#### 2. Marking a part sourced tells nobody — BLOCKER (shared with #1)

`resolvePartRequest` (`lib/shop-os/part-requests.ts:238-256`) writes only to
`job_part_requests`. It never touches `ticketJobs.workStatus`, and there is no
notification table in the product. A job that was held "waiting on parts" stays
held until a human notices.

- **Severity:** BLOCKER
- **Fix:** part of the two days above.

#### 3. Once handled, the parts person can never see that job again — FRICTION

The row leaves the lane (`components/screens/today-jobs-board.tsx:196-199`) and
there is no repair order list, no search and no history. A parts person has no
record of what they sourced today, and no way to answer "did that water pump ever
come in?"

- **Severity:** FRICTION
- **Fix:** falls out of the repair-order lookup work in advisor finding #2.

#### 4. Every refusal on the tech's parts request blames the network — FRICTION

Covered in the shared section. Specifically:
`lib/shop-os/part-requests.ts:151-158` refuses when the job is not yours, not
approved, or not in progress; the client prints *"Not sent — check your
connection and try again."* (`components/screens/parts-needed-panel.tsx:105-110`).
The 20-per-window rate limit reads identically
(`app/api/tickets/[id]/jobs/[jobId]/part-requests/route.ts:29-34`).

#### 5. "Got it" failures say "try again" on errors where retrying never works — FRICTION

A 409 — someone else already dismissed it — prints *"Couldn't mark parts found
for ticket N. Try again."* (`components/screens/today-jobs-board.tsx:365-368`).

- **Severity:** FRICTION
- **Fix:** one hour.

#### 6. The "Review parts" deep link lands on nothing — POLISH

`components/screens/today-jobs-board.tsx:1241` links to
`/tickets/[id]#parts-requested-heading`, but
`components/screens/ticket-part-requests.tsx:20` returns `null` when the list is
empty, so the anchor does not exist and the browser lands at the top of the page.

- **Severity:** POLISH
- **Fix:** one hour.

#### 7. The no-supplier message is the pattern everything else should copy — (positive)

`components/screens/manual-part-sourcing.tsx:509` — *"An owner needs to add a
supplier in Settings → Shop before this part can be sourced."* Correct diagnosis,
named remedy, rendered at the control. Worth preserving as the house standard.

---

## The owner beyond the counter

### The walk

1. **Set up the shop.** Hamburger → **Settings** → **Shop**. Name, tax rate,
   labor rate, parts markup (`components/vt/shop-section.tsx`,
   `components/vt/rates-section.tsx:180-234`), plus suppliers and canned jobs
   further down the same page (`app/(app)/settings/shop/page.tsx:48-72`).
2. **Price the work.** Same page. Canned jobs are the strong part — an explicit
   customer price, hours and optional per-line labor rate
   (`components/vt/canned-jobs-section.tsx`).
3. **Add and manage people.** Settings → **Team**
   (`components/vt/team-section.tsx`). Invite with a role and a skill tier
   (`:245-252`), change either later (`:335-344`), deactivate (`:185-190`).
4. **See what happened today.** *Does not exist.*
5. **See what the shop is owed.** *Does not exist.*

### Findings

#### 1. There is no reporting screen of any kind — BLOCKER

Not revenue, not accounts receivable, not open repair orders, not tech
productivity, not what closed today. There is no route for it and no query for
it. The data is all there — `ticket_payments` with methods
(`lib/db/schema.ts:1119-1133`), `active_seconds` per job, closed timestamps — and
none of it is aggregated anywhere in the product.

The closest thing is the "Ready to collect" strip on `/today`, and it is not
accounts receivable: it is capped at 25 rows
(`lib/shop-os/ready-to-collect.ts:29`), it only includes repair orders where
*every* job is finished (`:63-71`), so a half-finished job carrying a deposit is
invisible, and it shows no total.

Even "closed today" is dead: `app/(app)/today/page.tsx:32` passes
`closedToday={[]}` hardcoded, and the block that would render it is behind
`diagnosticsEntitled`, which is hardcoded `false` on the same page (`:19`).

- **What you'd experience:** at the end of the day you cannot answer "what did we
  take in," "who owes us," or "how did the shop do." You go back to a notepad or
  QuickBooks.
- **Severity:** BLOCKER
- **Evidence:** no reporting route exists; `lib/shop-os/ready-to-collect.ts:29`,
  `:63-71`; `app/(app)/today/page.tsx:19`, `:32`.
- **Fix:** two days for an honest first version — today's payments by method,
  open repair orders with balances, and a closed-today list. A week for anything
  with date ranges and tech productivity.

#### 2. A new shop starts with no labor rate, no tax rate and no markup, and nothing says so — FRICTION

`lib/db/queries.ts:82` auto-creates the shop as `"<email>'s Shop"` with
`laborRateCents`, `taxRateBps` and `partsMarkupBps` all null — the columns are
nullable with no defaults (`lib/db/schema.ts:82-84`). There is no onboarding of
any kind. The owner's first screen is the same empty Today board a tech gets:
*"No assigned work yet. New work orders and quick tickets appear here."*
(`components/screens/today-home.tsx:209-213`).

The consequences are quiet. With no tax rate, quotes cannot be prepared at all
(`lib/shop-os/quote-builder-ui.ts:416`) — the reason at least appears next to the
button. With no parts markup, the sourcing dialog silently switches to
hand-entered retail (`components/screens/manual-part-sourcing.tsx:123-124`). The
rates form itself shows blank inputs with no indication the values are unset
(`components/vt/rates-section.tsx:193-196`).

- **Severity:** FRICTION
- **Fix:** half a day — a first-run checklist on Today until the three rates are
  set.

#### 3. The settings menu hides where the money settings live — FRICTION

`components/vt/settings-list.tsx:15` labels the Shop section *"Rename your
shop."* That page is also where the labor rate, the tax rate, the parts markup,
the canned-job library and the supplier list live
(`app/(app)/settings/shop/page.tsx:48-72`).

- **What you'd experience:** you go looking for your labor rate, read "Rename
  your shop," and go somewhere else.
- **Severity:** FRICTION
- **Fix:** ten minutes.

#### 4. Setting gaps — values a real shop needs and cannot set

The entire `shops` table is five columns (`lib/db/schema.ts:76-86`). Four are
settable. Missing entirely — no column, no UI:

- Shop address, phone, email, website, logo, hours, timezone.
- **Shop-supplies percentage, hazmat / EPA disposal fee, environmental fee.**
  Fees exist only as manual per-quote lines (`lib/db/schema.ts:758`), so every
  repair order requires retyping them or baking them into a canned job.
- Differential labor rates (diagnostic vs mechanical vs warranty) — there is one
  flat rate. Per-line override exists (PR #207) but there is no default.
- Warranty terms, invoice disclaimer, payment terms.
- Supplier account numbers — a supplier is a display name and nothing else
  (`lib/shop-os/parts.ts:96-98` asserts empty config and a null secret ref).

Settable in the database only:

- `shops.next_ticket_number` (`lib/db/schema.ts:81`) — the update route accepts
  only name, tax, labor rate and markup (`app/api/shop/route.ts:57-63`). **A shop
  migrating from Mitchell 1 cannot set its starting repair-order number from the
  product**, which the Mitchell 1 migration plan depends on.
- `profiles.is_comp`, `profiles.is_curator` (`lib/db/schema.ts:120-121`).
- `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` (`lib/feature-flags.ts:1-3`) — the counter
  door itself is an environment variable with no owner-facing toggle, and its
  default is `false` (`.env.example:57`). It **is** on in production today: the
  hosted gate clicks **New work order** and completes the intake form against
  production (`tests/e2e/golden-shop-day.spec.ts:89-101`) and passed on
  `7fdb1e5`. The hazard is a future deploy, not the shop's current environment —
  the Today board renders that button on role alone
  (`app/(app)/today/page.tsx:35`) with no flag check, so if the variable is ever
  lost the primary counter button becomes a bare 404.

- **Severity:** FRICTION (the shop-supplies and disposal fees are the ones a real
  shop will feel every single repair order)
- **Fix:** a day for a fees-and-identity block on the shop settings page; two
  hours for `next_ticket_number`.

#### 5. Deactivating someone leaves their jobs assigned to them, silently — FRICTION

`deactivateTeamMember` (`lib/shop-os/team.ts:213-263`) sets `deactivatedAt` and
touches nothing else. It never reassigns `ticketJobs.assignedTechId`. The
deactivated person drops off the assignable roster
(`lib/intake/team.ts:39-40`), so they cannot be picked again, but their open jobs
keep showing their name in the team lane (`lib/tickets.ts:449-454`) and nothing
flags them.

- **What you'd experience:** you let someone go on Friday and nobody tells you
  the four trucks they were on just went quiet.
- **Severity:** FRICTION
- **Fix:** two hours — list the affected jobs in the deactivation confirmation.

#### 6. Deactivation cannot be undone from the product — FRICTION

`app/api/team/` contains `invite`, `role` and `deactivate` — there is no
reactivate route. And `components/vt/team-section.tsx:157-176` replaces the whole
editor with a read-only summary once a member is deactivated, freezing role,
tier and status.

- **What you'd experience:** you misclick, and that person is gone until someone
  edits the database.
- **Severity:** FRICTION
- **Fix:** two hours.

#### 7. The last-owner guard is a tooltip — FRICTION

`components/vt/team-section.tsx:185-190` disables Deactivate on `isLastOwner`
with the reason in a `title` attribute — invisible on a phone, which has no
hover. Same at `:346-347`. The server-side message is good (`:381`) but
unreachable, because the button cannot be clicked.

- **Severity:** FRICTION
- **Fix:** thirty minutes.

#### 8. A failed invite blames the email address for a missing server secret — FRICTION

`lib/supabase-admin.ts:18-19` builds the admin client with
`process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''`. A missing key produces a runtime
failure mapped to `invite_failed` → 502 (`lib/shop-os/team.ts:87-94`, `:275`),
which the UI renders as *"Supabase rejected the invite. Check the email and try
again."* (`components/vt/team-section.tsx:392`).

There is also an ordering flaw: the Supabase auth user is created *before* the
duplicate-profile check (`lib/shop-os/team.ts:85`, then `:96-107`), so inviting
someone who already belongs to another shop leaves an orphan auth user.

- **Severity:** FRICTION
- **Fix:** two hours.
- **UNVERIFIED:** whether invite emails actually deliver. The send path is real
  (`supabaseAdmin.auth.admin.inviteUserByEmail`,
  `app/api/team/invite/route.ts:41`), but delivery depends on SMTP configured in
  the Supabase dashboard, which is outside this repo. Supabase's built-in SMTP is
  heavily rate-limited and unreliable to real inboxes. **This should be tested
  with one real invite before the shop's staff are onboarded.**

#### 9. Skill tier is settable and done properly — (positive)

`components/vt/team-section.tsx:41-46` offers "Does not wrench / C-tech / B-tech /
A-tech" on both the invite form (`:245-252`) and the per-member editor
(`:335-344`), persisted through `app/api/team/role/route.ts`. The one worth
copying.

---

## Two people on the same repair order at once

This is better than expected and deserves saying so.

The quote path takes real row locks — `for update nowait` throughout
`loadDraftContext` (`lib/shop-os/quotes.ts:893-910`) — and translates Postgres
`55P03` into a named, retryable conflict (`lib/shop-os/quotes.ts:829`, `:834-841`).
The client then surfaces it distinctly: *"Quote changed. Refresh before recording
this decision."* (`components/screens/manual-quote-builder.tsx:714-716`) and
*"Story changed elsewhere. Your text is preserved; refresh before retrying."*
(`:1562-1563`).

The tech workspace uses optimistic concurrency on `expectedUpdatedAt`
(`lib/shop-os/simple-work.ts:313-332`), and every mutating route carries an
idempotency client key.

Editing a quote line after a version is prepared does the right thing: it
supersedes the active version and resets approval to `pending_quote`
(`lib/shop-os/quotes.ts:940-991`, called from `createDraftLine` at `:1996-2001`),
so totals cannot silently drift away from what the customer is deciding against.

**The gap is the message, not the mechanism.** Two of the six conflict paths — the
technician's clock-on (`components/screens/simple-work-workspace.tsx:288-291`) and
the lifecycle cancel (`components/screens/ticket-lifecycle-control.tsx:76`) —
collapse a real conflict into the generic connection message, so the second
person is told to check their Wi-Fi rather than to refresh.

- **Severity:** POLISH
- **Fix:** included in the two days for honest refusal messages.

---

## Empty states and error states

**Good empty states, worth keeping:** intake search on a brand-new shop
(`components/vt/intake-search/dropdown.tsx:19-36`), suppliers
(`components/vt/suppliers-section.tsx:271-274`), canned jobs
(`components/vt/canned-jobs-section.tsx:122`), the quote builder's canned-job
picker (`components/screens/manual-quote-builder.tsx:997`), and ring-out
(`components/screens/ring-out-section.tsx:172`). Each says what is missing and
what to do about it.

**Weak or wrong empty states:**

| Surface | What a new shop sees | Problem |
|---|---|---|
| Today, all lanes empty | "No assigned work yet. New work orders and quick tickets appear here." (`components/screens/today-home.tsx:209-213`) | Correct for a tech. For a **parts person** the noun is wrong, and for an **owner on day one** it is the entire onboarding. |
| Today, partially empty | Each lane is `length > 0 &&` (`components/screens/today-jobs-board.tsx:694-796`) — absent lanes simply are not there | A parts person with nothing to source sees no "Parts needed" heading at all, so they cannot tell "nothing to do" from "broken." |
| Tech selector, no roster | Component not rendered (`components/screens/counter-intake.tsx:470`) | No empty state and no explanation. |
| Part requests, none | Component returns `null` (`components/screens/ticket-part-requests.tsx:20`) | The whole section vanishes, taking its anchor with it. |
| Rates, unset | Blank inputs (`components/vt/rates-section.tsx:193-196`) | Nothing indicates quotes are running with no tax. |
| No shop assigned | "No shop is assigned to your account yet." (`app/(app)/settings/shop/page.tsx:34`) | True dead end — correct message, no remedy offered. |

**Error states:** covered above — no `error.tsx` anywhere, `notFound()` used for
permission refusals, six screens blaming the network, and a silently stale board.
The good ones to copy are `components/screens/ring-out-section.tsx:23-42`,
`components/vt/team-section.tsx:376-389`, and
`app/(app)/settings/shop/page.tsx:61-71`, which all name the failure and offer a
next action.

---

## The phone

This is the strongest part of the product, and it should be said plainly before
the findings: **somebody clearly did this work on purpose.**

**What is genuinely good, and proven:**

- The viewport is set correctly (`app/layout.tsx:35-40`).
- **Horizontal overflow is machine-proven at 390×844.** The hosted journey
  asserts `document.documentElement.scrollWidth === clientWidth === viewport
  width` at **17 checkpoints across all four roles** — owner, advisor, tech and
  parts (`tests/e2e/golden-browser-receipts.ts:41-49`;
  `playwright.golden.config.ts:29`; checkpoint list in
  `tests/e2e/golden-shop-day.spec.ts:88-351`). Every checkpoint is also checked
  for serious and critical accessibility violations.
- Tap targets are a real discipline, not an accident: roughly 45 explicit
  `min-height: 44px` rules across the codebase, and the hamburger is a proper
  44×44 (`components/vt/vt.css:148-149`).
- Phone keyboards are right: `type="tel"` for phone numbers, `type="number"` for
  year and mileage, `inputMode="decimal"` for money and hours across the counter,
  the quote builder, sourcing and ring-out.
- Settings is genuinely mobile-first — a master/detail pane swap and 68px rows
  below the breakpoint (`components/vt/vt.css:1434-1441`); team members collapse
  to a stacked card with 44px buttons under 768px and only shrink to 38px on
  desktop (`components/vt/vt.css:1625-1652`).
- **The sticky-bar-covers-the-field defect is genuinely fixed.** The quote
  builder's Prepare bar goes `position: fixed` on phones and then explicitly
  un-sticks itself the moment a line editor or the story editor takes focus
  (`components/screens/manual-quote-builder.module.css:1071-1092`). That is the
  exact bug PR #173 closed, and the fix holds in the code.

**Two things the proof does not cover, which is where the findings live:**

1. **The gate is not automatic.** `.github/workflows/` contains `ci.yml` and
   `daily-db-backup.yml` and neither mentions Playwright or the golden harness.
   The journey runs only when a human runs `pnpm test:e2e:golden`
   (`package.json:15`) against `https://vyntechs.dev`
   (`playwright.golden.config.ts:3`). So overflow is disproven for whatever was
   last deployed when someone last ran it — not for every commit.
2. **`scrollWidth` says nothing about whether a field is usable.** A layout of
   `200px 1fr` on a 390px screen squeezes the input toward nothing and passes the
   assertion cleanly. And the accessibility tags stop at WCAG 2.1
   (`tests/e2e/golden-browser-receipts.ts:63`), while minimum tap-target size is
   WCAG 2.2 — so **tap targets are not guarded by the gate at all.**

### Findings

#### 1. "Add repair" and "Add diagnostic time" leave about 100px for the input — FRICTION

`components/vt/v2.css:384-391` sets `.vt-form__group` to
`grid-template-columns: 200px 1fr` with `padding: 18px 32px` and a 24px gap —
and **`v2.css` contains no media queries at all**. On a 390px phone that is
390 − 64 − 200 − 24 ≈ **102px of usable field width**.

Counter intake and quick ticket both override this to a single stacked column on
phones (`components/screens/counter-intake.module.css:145-149`;
`components/screens/quick-ticket.module.css:240`). The quote builder does not —
and `components/screens/add-repair-job.tsx:75` and
`components/screens/add-diagnostic-time.tsx:82` render that class directly,
inside the quote builder.

Those are exactly the two controls PR #216 shipped to fix the owner's report that
a repair order *"only appears to let me add more diagnostics."* They were on
screen at two hosted checkpoints (`advisor-local-labor-editor`,
`advisor-quote-draft`) and passed, because `1fr` shrinks rather than overflows.

- **What you'd experience:** at the counter on your phone, adding a repair after
  the diagnosis means typing a description and a price into a slot about a third
  of the screen wide, next to a label that takes half of it.
- **Severity:** FRICTION
- **Evidence:** `components/vt/v2.css:384-391` (no media queries in the file);
  `components/screens/add-repair-job.tsx:75`;
  `components/screens/add-diagnostic-time.tsx:82`; the override that exists at
  `components/screens/counter-intake.module.css:145-149`.
- **Fix:** thirty minutes — one phone breakpoint stacking `.vt-form__group`,
  copied from the counter's own stylesheet.

#### 2. The back control on a phone is an arrow about 7px wide — FRICTION

`.app-header__back` is 11px type with 2px of vertical padding
(`components/vt/vt.css:63-72`), and below 480px the label text is deliberately
hidden to keep the header on one row
(`components/vt/vt.css:83-88`), leaving only the arrow. It is the back control on
**15 screens** and it is far below any reasonable thumb target.

The comment in the stylesheet says the hamburger provides primary navigation and
the arrow is "a contextual hint" — which is a fair design position, except the
hamburger only offers My Jobs, Settings and Sign out, so the arrow is genuinely
the only way back from a repair order or a work screen.

- **Severity:** FRICTION
- **Evidence:** `components/vt/vt.css:63-72`, `:83-88`; 15 `back=` call sites.
- **Fix:** one hour — give it a 44×44 hit area.

#### 3. The parts person's only two buttons are 40px — POLISH

`components/screens/ticket-part-requests.module.css:13` sets `.got, .drop` to
`min-height: 40px`. Those are **Got it** and **Not needed** — the entire action
vocabulary of the parts role. Same at
`components/vt/vt.css:1573` for the team editor's Save button.

- **Severity:** POLISH
- **Fix:** ten minutes.

#### 4. The counter's most-used button is the smallest one on the screen — POLISH

`components/screens/today-home.tsx:100-115` renders **New work order** with
inline `padding: '6px 12px'` and `fontSize: 13` and **no** `minHeight`. The base
`.btn` class sets no minimum height either (`components/vt/vt.css:246-258`), so
the button lands near 28px tall. **Quick ticket**, immediately beside it, sets
`minHeight: 44` explicitly (`components/screens/today-home.tsx:126`).

- **What you'd experience:** the primary button for writing up a customer is
  noticeably harder to hit than the secondary one next to it.
- **Severity:** POLISH
- **Fix:** five minutes.

#### 5. Counter intake hides its own overflow — POLISH, but it weakens the proof

`components/screens/counter-intake.module.css:105` sets `overflow-x: hidden` on
the screen root under 767px. That is a legitimate belt-and-braces choice, but it
also means the document can never grow wider than the viewport on that screen —
so the hosted overflow assertion cannot fail there even if a child genuinely is
too wide. `components/screens/quick-ticket.module.css:199` does the same.

No actual clipped content was found. Recorded because it means the intake
checkpoints are weaker evidence than the other fifteen.

- **Severity:** POLISH
- **Fix:** none needed; know what the gate is and is not proving.

#### 6. Long forms with the submit at the bottom — mitigated, not solved — POLISH

Counter intake runs about twenty fields with the submit at
`components/screens/counter-intake.tsx:1005`. The sticky footer at
`components/vt/v2.css:507-517` has no travel, and Playwright auto-scrolls to the
button it clicks (`tests/e2e/golden-shop-day.spec.ts:102`), so the journey never
pays the scroll cost a human does.

What *is* solved, and well: the submit is never disabled — it is gated only on
`busy` (`:1005`) — and when it refuses it names the first missing field, moves
focus to it, and repeats the message in the footer
(`components/screens/counter-intake.tsx:69-141`, `:260-269`, `:999`). This is the
pattern every other refusal in this document should copy.

- **Severity:** POLISH
- **Fix:** two hours for a sticky submit on phones.

#### 7. Overflow on the screens the journey never walks — checked, and clean

For completeness: the hosted journey never navigates to the standalone
`/tickets/[id]/quote` page (it opens the inline workspace instead —
`tests/e2e/golden-shop-day.spec.ts:108-109`), and never touches
`components/screens/manual-part-sourcing.tsx`, `/tickets/new`, any of
`/settings/*`, `/vehicles/[vehicleId]`, `/whats-new` or `/floor`.

Those were read directly for overflow risk and are **clean**. Every fixed-width
rule in them either resets under a phone breakpoint
(`components/vt/vt.css:1577`→`:1636`;
`components/screens/manual-part-sourcing.module.css:223`, `:343`→`:379`) or is
dead CSS whose class appears in no component (`.vt-twopane` / `.vt-threepane` at
`components/vt/v2.css:531`, `:581`; `.frame-phone { width: 402px }` at
`components/vt/intake-search/intake-search.css:595`).

Four stylesheets carry no mobile rules at all —
`components/screens/floor-board.module.css` (correct; it is a television),
`inline-quote-workspace.module.css`, `inline-work-workspace.module.css` and
`ticket-part-requests.module.css`. The last three are built from fluid grid and
`overflow-wrap: anywhere`, so they narrow rather than break.

- **Severity:** none — recorded so nobody re-audits it.

---

## What this audit could not verify

Everything above was read from source. These four could not be settled that way
and should not be treated as proven either direction.

1. **Whether team-invite emails actually arrive.** The send path is real
   (`app/api/team/invite/route.ts:41`), but delivery depends on SMTP configured
   in the Supabase dashboard, outside this repo, and Supabase's built-in sender is
   heavily rate-limited. **Send one real invite before onboarding the staff.**
2. **The production environment variables.** `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED`
   is proven `true` on the deployed site `vyntechs.dev`, because the hosted
   journey clicks **New work order** there and completes intake
   (`tests/e2e/golden-shop-day.spec.ts:88-101`). No other environment variable
   was checked; the Vercel environment was not queried, per the read-only scope.
3. **Anything requiring a running browser.** No dev server, browser or database
   was run — another lane owns the hosted gate. Every layout claim here is from
   CSS and the harness's own assertions, not from a rendered page.
4. **A repair order with zero jobs.** Both intake doors always create one job, so
   the empty-ledger branch in `components/screens/ticket-detail.tsx:396-522`
   appears unreachable — but "appears unreachable" is not "is unreachable," and it
   was not proven.

---

## Cleared false positives — do not re-file these

Checked during this audit and found **not** to be defects. Recorded so the next
review does not spend the time again.

1. **"A prepared quote can never be revised."** False. Editing any quote line
   calls `invalidateActiveQuoteVersion` (`lib/shop-os/quotes.ts:940-991`, invoked
   from `createDraftLine` at `:1996-2001`), which supersedes the active version
   and resets approval to `pending_quote`. The Prepare button then returns and
   V2 can be issued. The revise loop works.

2. **"Diagnostics entitlement can render a door that middleware refuses."**
   False. `resolveShopEntitlements` short-circuits to `{ diagnostics: false }`
   whenever the release is off (`lib/entitlements.ts:50`), and
   `getDiagnosticsRelease()` returns `'off'` unconditionally in production
   (`lib/release-policy.ts:9-12`). The trap is closed.

3. **"A repair order can be created with no jobs and become invisible."** False.
   Both intake doors always create exactly one job
   (`lib/intake/counter-ticket.ts:171-180`; `lib/intake/quick-ticket.ts:255-262`).

4. **"`/billing` is a broken redirect target."** False.
   `next.config.js:5-12` permanently redirects `/billing` → `/settings/billing`.

5. **"The counter tells the advisor the customer was texted."** The copy exists —
   *"The customer has been notified by text. The AI plan is locked in."* at
   `components/screens/counter-work-order-confirm.tsx:57`, alongside a **Print
   receipt** button hardcoded `disabled` with `title="Wires up in Counter 04"`
   (`:60-68`). But the component is imported by nothing except its own test, so
   no user ever sees it. **It should be deleted** — a screen that claims a text
   was sent is one careless import away from lying to a customer.

---

## The one change worth making first

**Teach the product what a declined job is.**

That is two small pieces of work with one root cause, and together they retire
the worst finding in this audit plus the technician's only trap:

**(a) A per-job "Not doing this" control.** Today a customer declining one
recommended line makes the repair order impossible to close and impossible to
cancel — the most ordinary outcome at any service counter permanently jams the
system of record. The work is small because the hard parts already exist:

- The server already cancels jobs, transactionally, banking the clock and writing
  an activity row — `lib/shop-os/interruption.ts:552-562`. It just only does it
  for the whole ticket at once.
- The command surface needs one more kind alongside the eight already in
  `lib/shop-os/living-ticket.ts:21`.
- The close path already reads `workStatus`, so a canceled job stops blocking
  closure the moment it is set (`lib/shop-os/ring-out.ts:372-381`).

**(b) Put approval state on the board row.** `approvalState` is already fetched
for every job (`lib/tickets.ts:617`) and rendered on none of them
(`components/screens/today-jobs-board.tsx:1179-1186`), and `workAvailable` never
consults it (`:1320`). Showing it, and not offering **Open work** on declined
work, is a couple of hours against data that is already on the row.

**Estimate: about one day for both.** It turns the advisor and owner from
"cannot do their job" into "can, with friction," and it stops a technician
starting work the customer refused.

*Runner-up, for when there is a second day:* replace the six "check your
connection" messages with the named server reason each of them already receives.
The servers return structured codes; two screens already humanize them properly
(`components/screens/ring-out-section.tsx:23-42`,
`components/vt/team-section.tsx:376-389`). Copying that pattern to the other six
removes the defect class this repo has now shipped five separate times.
