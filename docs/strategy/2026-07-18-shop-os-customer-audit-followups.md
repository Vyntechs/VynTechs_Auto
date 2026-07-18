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

All three: TypeScript clean, targeted tests green, production build passes. Not
driven through a live authenticated session (QA-credential gate).

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
- **No supplier/vendor setup in Settings** (only creatable mid-sourcing).
  `app/api/shop/vendor-accounts/*`.
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
