# Shop OS — what stands between today and "we run the shop on this"

**Date:** 2026-07-28 · **Status:** inventory for the owner. Every claim below was
checked against the code on `main` and against the live production database for
Young Motorsports (`089560cb…`), not against memory or prior documents.

The goal this list serves, in the owner's words: *it must remove lots and lots of
friction on first use and grow with each use, without needing much time behind the
driver's seat to be expert-level.*

So each item is scored two ways — **does the shop hit a wall**, and **does it cost
someone time every single ticket**. Those are different problems and they get fixed
in a different order.

---

## What the real shop actually looks like right now

| | |
|---|---|
| Shop | Young Motorsports — rates set: 8.25% tax, $155/hr labor, 65% parts markup |
| People | 5 accounts: 3 owner, 1 tech, 1 parts. **No advisor-role user exists.** All comped, so no paywall risk. |
| Tickets | 5, every one still `open`. **Nothing has ever been closed or paid in production.** |
| Canned jobs | **0** |

Two things follow from that table. First, tomorrow is the first time the money end
of the product meets a real customer — quote → approve → perform → ring out → close
has only ever been walked by the automated Golden Shop Day, never by a person with a
real invoice. Second, the role that this product was mostly designed around — the
service advisor — does not exist as a user in the shop. Everything advisor-shaped
will be done by an owner account.

---

## Tier 1 — walls. A real day hits these and stops.

### 1. A closed repair order disappears
The moment a ticket closes it leaves Today and there is no way to find it again — no
search over closed work, no closed list, no customer or plate lookup that reaches
past open tickets. Vehicle history exists but you have to already know the vehicle.

*Cost:* the first time someone asks "what did we charge Sanchez for the brake job
last week," the answer is not in the product.
*State:* Row 61. The server half is written and tested (18/18) on draft PR #202.
What is left is the route and the Today surface that mounts a found repair order in
place. This is a day of work, not a project.

### 2. Nothing ever leaves the building
There is no estimate, no invoice, no receipt — no document to print, hand over,
text, or email. Searched the whole codebase: no PDF generation, no print view, no
Twilio, no email sender. Quote approval is recorded as the advisor's word
(`phone` or `in_person`). The schema has a `sent` state for a quote, but no code
anywhere can set it — nothing sends.

*Cost:* the customer leaves with nothing. There is no written authorization to point
at in a dispute and no receipt for the money you just took. This is the single
biggest reason the product cannot yet be the *sole* system — every other paper trail
in the shop currently comes from somewhere else.
*What closing it takes:* one printable repair-order document that serves all three
moments (estimate, authorization, invoice), plus a way to get it to a phone. The
document's content — what your shop states, warrants, and disclaims — is a business
decision, not an engineering one.

### 3. The canned-job library is empty
Zero rows. Every brake job, every oil service, every diesel filter set is priced from
scratch every time, by hand, in the quote builder.

*Cost:* minutes per ticket, forever, on the most repetitive work in the shop.
*What closing it takes:* authoring your ten or fifteen most common jobs once. The
machinery is built and works; nobody has filled it.

---

## Tier 2 — friction. It works, but it taxes someone every ticket.

### 4. Two front doors, and you must choose before you know the job
`/intake` is the counter door for unknown causes and leads toward diagnostic work.
`/tickets/new` is the quick-ticket door for known work and leads to a quote. Both
ask for the same customer and vehicle. The advisor's real state at the counter is
very often "not sure yet" — and the product asks them to commit first.

*This is the friction the owner named.* The write-up should not require the advisor
to have already diagnosed the direction of the job.

### 5. Diagnostic write-up has no defaults
The code deliberately refuses to invent a diagnostic title, hours, or price, so the
advisor types a description, a number of hours, and a dollar amount every single
time they sell diagnostic time.

*What closing it takes:* one shop-level default — your standard diagnostic title,
hours, and price — set once in settings. That is a founder decision, then it is
gone forever as a friction point.

### 6. The tech receives words only
Media is off, so nothing visual reaches the ticket — no photo of the leak, no photo
of the dash, no photo of the part number. The concern arrives as retyped prose
("noise at 40 mph"), which is exactly the information that degrades between the
customer's mouth and the tech's bay.

### 7. Real time is captured and never used
The tech clocks on and the product accumulates real seconds against the job. That
number is never shown against the quoted hours. Nobody — tech or owner — can see
whether the shop is beating the book on a job or losing on it.

*Cost:* the most valuable operational number the product already collects is
invisible.

### 8. No advisor exists to feel the advisor relief
Three owners, one tech, one parts. Whether the role separation actually reduces
friction is untested with a real person in the seat.

---

## Tier 3 — the owner is blind at the end of the day

### 9. There is no day view
Today shows a count — "Closed today · N" — and nothing else. No money in, no money
still owed, no tech hours, no what-came-in-versus-what-went-out. Ring-out is
per-ticket only.

### 10. There is no till or day close
Payments are recorded per ticket as cash/card with a note. Nothing sums them, so
nothing reconciles against the drawer at close.

---

## What already grows with use — and it is better than expected

This is the part that is genuinely working, and it should be protected:

- **Customer and vehicle memory.** Both front doors carry the same predictive search
  over customers and vehicles by name, phone, plate, and VIN, with prior visits
  attached. A returning customer is found and filled, not retyped. This is the real
  compounding mechanism and it already exists.
- **VIN decode.** Year, make, model, and engine fill themselves from the VIN through
  NHTSA.
- **Vehicle history.** Prior work on a vehicle is reachable.

### What does not compound yet

- **A finished job never becomes a saved job.** Canned jobs can only be authored by
  hand in settings. The shop does the work of pricing a job perfectly, and the
  product forgets it. Every completed job should be able to become a template in one
  tap — that single change turns the empty library problem (item 3) from data entry
  into a byproduct of working.
- **Part costs are not remembered.** The same part number bought twice is priced from
  scratch twice.
- **A vehicle's repeat concerns are not surfaced.** The product knows this truck was
  here for the same complaint before; it does not say so at write-up.
- **No tech time history.** See item 7.

---

## Recommended order

The ranking is by "how much relief per day of work," not by difficulty.

1. **Save a finished job as a canned job (one tap).** Smallest change on this list
   with the largest compounding return — it fixes the empty library by making the
   library a byproduct of doing the work, and it is exactly the "grows with each
   use" behavior the goal asks for.
2. **Set the shop's diagnostic default.** Founder decision plus a small settings
   field. Kills a per-ticket tax permanently.
3. **Find a closed repair order (Row 61).** Half built. Closes the day-one wall.
4. **One repair-order document.** Estimate, authorization, and invoice in one
   printable/shareable artifact. Largest single item; needs your input on content
   before any code.
5. **One front door.** Let the advisor write up what the customer said and decide the
   direction afterward, instead of choosing a door first.
6. **Owner's day view.** Money in, money owed, hours, closed count.
7. **Quoted hours versus real hours** on the job card.

Items 1–3 are small and independent. Item 4 is the one that decides whether this can
be the sole system in the shop, and it starts with a decision, not a commit.

---

## Open owner decisions

- What your repair-order document says — shop identity, authorization language,
  warranty statement, disclaimers.
- Your standard diagnostic title, hours, and price.
- Whether an advisor-role account should exist, or owners keep doing counter work.
- Which ten jobs seed the canned library (or whether item 1 ships first and they
  seed themselves).
