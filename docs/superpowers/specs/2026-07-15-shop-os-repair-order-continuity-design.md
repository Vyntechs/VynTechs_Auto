# ShopOS Repair Order Continuity Design

**Date:** 2026-07-15  
**Status:** Direction approved through the active goal; written specification awaiting founder review  
**Implementation authority:** None until this written specification is approved  
**Product definition:** One living repair order per vehicle visit by default, with independently truthful work items and explicit exceptions

## Intent

**Project:** Vyntechs ShopOS  
**Plain-language outcome:** A person can add every concern, requested service, discovered issue, assignment, authorization, and result to the correct vehicle visit without losing it, duplicating the repair order, or refreshing the whole application.  
**Why now:** Production use exposed two open repair orders for the same vehicle, hidden work after assignment, and no reliable way to recover or close the visit.  
**Done when:** The same repair order remains visible and correct from intake through delivery and vehicle history for every intended shop role on phone, tablet, laptop, and desktop.  
**Hard no:** No hard one-open-RO constraint, silent merge, destructive cleanup, new page maze, diagnostic-engine entrance, operational media, inherited approval, client-trusted authorization, or production migration without its explicit gate.  
**Assumptions:** `tickets` remains the vehicle-visit spine; `ticket_jobs` remains the unit of work and approval; appointments, payments, accounting-grade invoicing, and diagnostic-engine redesign remain outside this design.  

## Product vision

ShopOS should feel as though the vehicle has one durable operational memory while
each employee sees only the slice that helps them act. Intake does not create a
new silo merely because another concern was spoken. Assignment does not make
work disappear. Finishing a job does not make the repair order unrecoverable.
Adding work does not rewrite what the customer already approved.

The product signature is **continuity without ceremony**:

```text
Vehicle selected
│
├── No open visit
│   └── Create one living repair order
│
├── One active visit
│   └── Add the work item there by default
│
├── Visit is ready to close or internally inconsistent
│   └── Show the exact repair order and require a deliberate resolution
│
└── Separate repair order is legitimate
    └── Start it explicitly and preserve why
```

Every visible action must answer three questions without making the user think:

1. Which vehicle visit will this affect?
2. Which exact work item will this affect?
3. What changed after the server accepted it?

## Source truth and explicit supersessions

This design is subordinate to project `AGENTS.md` and does not replace the
active status table in
`docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`. After written-spec
approval and before code begins, the control lane must add or revise bounded
rows in that table with one owner, lane, dependency set, allowed paths,
verification, and rollback per row. The mapping is explicit: Packets A-D get
new rows; Packet E replaces the unfinished base scope of Row 44; Packet F
replaces the unfinished base scope of Row 45; Packet G supersedes Row 48; and
Packet H preserves the deferred message/order-aware portion of Rows 44-45
behind their still-unmet dependencies. This is a split of unfinished scope,
not a duplicate lifecycle or UI program.

This design preserves:

- the ticket-as-spine and optional-session architecture;
- tenant-safe handlers in `lib/` with thin authenticated route shims;
- role capability helpers as the authorization authority;
- immutable quote versions, append-only approval events, and pinned approvals;
- the four permitted diagnostic-engine seams;
- the adaptive application shell and living-entity contracts;
- the global diagnostic-off and no-operational-media release;
- manual findings and text-only work as the complete launch floor.

This design explicitly supersedes only these older assumptions:

1. `tickets.concern`, `tickets.when_started`, and `tickets.how_often` cannot
   remain the sole source for every child job on a multi-work-item repair order.
2. Counter intake must not automatically create one Tier-3 diagnostic job for
   every visit. Each entered work item declares whether the shop is finding the
   cause, performing requested work, or performing routine service.
3. Adaptive ShopOS Wave 2 cannot adopt a living repair order "without changing
   domain handlers." Precise projections remain correct, but continuity requires
   domain changes first.
4. Historical simple-work photo requirements are obsolete. No media control,
   dependency, storage path, or customer-facing media claim may return.

Completed rows and shipped PRs remain true historical evidence. This design
corrects forward behavior; it does not rewrite completed rows as though their
work never shipped.

## Evidence-backed capability map

| Capability | Status | Current evidence | Required correction |
| --- | --- | --- | --- |
| Ticket and multi-job spine | working | `tickets`, `ticket_jobs`, tenant-safe detail, general add-job handler | Preserve and extend |
| Per-work-item request truth | missing | Ticket has one root concern; child jobs have only a short title | Add job-local statement, context, provenance, and authorization |
| Active-RO continuity | missing | Counter and quick intake always create another ticket | Transactional candidate resolver and default append |
| Parallel RO exceptions | missing | No explicit distinction between duplicate and legitimate parallel work | Persist linked reason and note |
| Assignment domain | working | Claim, unclaim, and reassign handlers exist | Add role-correct inline presentation and projections |
| Shop-wide role visibility | partial | Today shows own work plus unassigned work | Add Shop Today, My Work, and Parts Queue projections |
| Ticket lifecycle | partial | Columns exist; no shipped ticket deliver/close/cancel workflow | Add derived stage and guarded terminal mutations |
| Vehicle history and recovery | missing | Vehicle history renders identity only | List active, closed, and canceled ROs with durable recovery |
| Quote and approval immutability | working with continuity gap | Immutable versions and pinned simple-work approval exist | Preserve unchanged job approvals when later work is added |
| Adaptive application foundation | working | Persistent shell and `AdaptiveWorkbench` shipped | Adopt after the domain contract is corrected |
| Diagnostics release | working off | Global release policy fails closed | Keep engine unavailable; permit truthful manual findings only |
| Operational media | working off | Routes and UI fail closed | Keep every continuity path structured-text only |

## Considered architectures

### Selected: additive job-local continuity

Keep `tickets` as one repair order/vehicle visit and make each `ticket_job` an
independently truthful work item. Add a transactional resolver around the
canonical add-job and create-ticket paths.

Why selected:

- it fixes the actual wrong-binding defect;
- it reuses the shipped ticket, assignment, quote, and adaptive foundations;
- it supports diagnostic concerns, known repairs, maintenance, and discovered
  work without another abstraction layer;
- it can migrate additively and roll back without deleting data;
- it is the smallest architecture that remains correct under concurrency.

### Rejected: UI-only “use the existing RO?” prompt

A prompt alone leaves later jobs bound to the ticket's first concern, permits
concurrent duplicate creation, does not repair approval semantics, and does not
create lifecycle or role visibility. It would make the screenshots look better
while preserving the underlying defect.

### Rejected for this scope: `vehicle_visits` plus separate concern tables

A separate visit and concern graph is conceptually pure but duplicates the role
already played by `tickets`, requires broad rewiring across quoting, assignment,
work, diagnostics, and history, and provides no v1 capability the additive
job-local model cannot provide. Reconsider only if one concern must later fan
out into multiple independently billed jobs in a way the current job/quote
model cannot represent.

### Explicitly prohibited: unique one-open-RO-per-vehicle constraint

Warranty, comeback, separate payer, internal work, scheduled/future work, and
fleet accounting can legitimately require parallel repair orders. Continuity
is a server-locked default and an explicit user decision, not a database rule
that makes valid shop work impossible.

## Core domain model

```text
tickets = living repair order / vehicle visit
│
├── customer + vehicle
├── durable open / closed / canceled status
├── monotonic projection + continuity revisions
├── optional separate-from relationship + reason
├── explicit delivery / closure disposition
│
└── ticket_jobs = independently identified work items
    │
    ├── exact work statement + source
    ├── short staff-facing title
    ├── started/frequency context when applicable
    ├── kind: diagnostic | repair | maintenance
    ├── job-local diagnostic-fee authorization when applicable
    ├── creator + optional source job
    ├── assignment + work state + approval state
    ├── monotonic job revision + migrated-review state
    └── optional diagnostic session
```

### Repair order

The existing `tickets` row remains the visit identity. Logical additions:

| Field | Contract |
| --- | --- |
| `projectionRevision` | Non-negative bigint incremented for every actor-visible ticket or child mutation |
| `continuityRevision` | Non-negative bigint incremented only when active-candidate identity, state, or summary semantics change |
| `separateFromTicketId` | Same-shop active RO that was deliberately not reused, nullable |
| `separateReason` | Bounded enum required with `separateFromTicketId` |
| `separateReasonNote` | Bounded explanation, required for `other` |
| `closeDisposition` | `delivered`, `customer_declined`, `no_repair`, or `remote_quote_not_proceeding`; required only with `closed` |
| `closeNote` | Bounded human note for non-delivery closure where required |
| `cancelReasonCode` | `duplicate_created`, `customer_canceled_before_authorization`, `administrative_error`, or `other`; required only with `canceled` |

Allowed separate reasons are initially:

- `warranty`
- `comeback`
- `different_payer`
- `internal_work`
- `future_or_scheduled_work`
- `fleet_split`
- `other`

The relationship is evidence, not hierarchy. Closing one repair order does not
close its related parallel repair order. The relationship fields are paired,
immutable after creation, may not self-link, and must point under lock to an RO
for the same shop, customer, and vehicle. The database uses a composite
`(shop_id, separate_from_ticket_id)` foreign key; the handler enforces the
same-customer/vehicle rule because `vehicles` intentionally has no `shop_id`.

### Work item

The existing `ticket_jobs` row remains the work/authorization unit. Logical
additions:

| Field | Contract |
| --- | --- |
| `workStatement` | Exact reason this job exists; required for every new write |
| `statementSource` | `customer_concern`, `customer_request`, `technician_found`, `advisor_added`, `shop_internal`, or `legacy_migrated` |
| `statementReviewState` | `confirmed` for new/root truth or `review_required` for a bounded legacy fallback that must not be presented as a complete customer quote |
| `statementConfirmedByProfileId/At` | Paired actor/timestamp recorded only when a migrated fallback is explicitly confirmed |
| `whenStarted` | Optional bounded context for a symptom |
| `howOften` | Optional bounded frequency/context |
| `diagnosticAuthorizedCents` | Optional non-negative fee authorization for this work item only |
| `diagnosticAuthorizationNote` | Optional bounded fee note for this work item only |
| `createdByProfileId` | Same-shop profile that added the item; new mutations require the actor to be active, but historical membership need not remain active |
| `creatorProvenance` | `direct` for a new mutation or `ticket_creator_backfill` for migration |
| `createdFromJobId` | Same-ticket source job for a technician-found issue, nullable |
| `revision` | Non-negative monotonic entity revision |
| `approvedAuthorizationFingerprint` | Versioned canonical fingerprint of the exact customer-authorized fields, nullable until approval |
| `approvedApprovalEventId` | Immutable same-shop/ticket approval event paired with the existing approved quote-version pointer |

`title` remains a concise staff label. It is never the sole customer statement
or diagnostic complaint for a new write.

New-write bounds remain explicit: trimmed `workStatement` 1-5,000 characters,
`title` 1-200, `whenStarted`/`howOften` 0-1,000 each, diagnostic authorization
note 0-2,000, and separate/close/cancel human notes 0-2,000. A request key is a
UUID. Enum values and money use strict schemas; unknown fields fail closed.

Owner/advisor may invoke `confirm_legacy_work_statement` only on an open
same-shop RO and a `review_required` job. The idempotent request supplies the
expected job revision plus an explicit replacement statement, applicable
context, and non-legacy source. The transaction records confirmer/time, moves
the job to `confirmed`, leaves the immutable ticket root unchanged, invalidates
only that job's prior authorization fingerprint if the approved scope changed,
and bumps job/projection/continuity revisions from their derived signatures.
Packet B owns the handler, Packet F owns its action envelope, and Packet G owns
the inline presentation. Until confirmation, customer-facing quote/diagnostic
claims that require complete statement truth fail closed.

Ticket-level concern/context/diagnostic-authorization columns remain as an
immutable legacy root summary through at least one fully verified production
release. At creation they are populated only from ordered `workItems[0]`.
Appending any later item never overwrites them. Every migrated/new consumer
uses job-local truth; the root summary is compatibility fallback only and is
not dropped or destructively reinterpreted by this goal.

`createdFromJobId` uses a composite `(shop_id, ticket_id, job_id)` source-job
foreign key. Creator, approval-event, and receipt-result relationships receive
equivalent composite tenant constraints. New writes reload active membership;
history preserves an inactive former employee as truthful provenance.

### Revision contract

All revisions are database `bigint`, transported as decimal strings, compared
with compare-and-swap semantics, and incremented in the same transaction as
the mutation. No JavaScript number carries a revision.

| Mutation | Job `revision` | Ticket `projectionRevision` | Ticket `continuityRevision` |
| --- | --- | --- | --- |
| Job statement, context, story, line, quote, approval, assignment, note, or diagnostic-session truth | affected jobs | yes | iff `ContinuitySignatureV1` changes |
| Job add/remove or work status crossing `open/in_progress/blocked/done/canceled` | affected jobs | yes | yes |
| Ticket status, delivery/closure/cancel truth, vehicle/customer/reconciliation, or separate-RO evidence | n/a | yes | yes |
| Presentation-only preference or unrelated user state | no | no | no |

Packet A defines one pure canonical `ContinuitySignatureV1` before any writer
retrofit. It contains ticket ID, customer/vehicle IDs, status and terminal
fields, reconciliation state, separate-RO evidence, and ordered child records
containing job ID, kind, work statement, statement-review state, work status,
approval state, approved-fingerprint presence, and ordered part statuses. It
explicitly excludes assignee, claim timestamps, internal notes, UI state,
customer-story prose, and price values. A writer derives before/after
signatures under lock and increments `continuityRevision` iff the signatures
differ. Packet D uses the same function for candidate summaries and validation;
it may not invent a second field list.

Packet A inventories and converts every existing writer before any resolver is
enabled, including assignment, quote, story, simple-work, diagnostic-start,
ticket creation/add-job, job-line/parts-state, and lifecycle writers. A shared mutation helper owns
atomic parent/child bumps. Projection responses replace only a strictly older
`projectionRevision`; candidate validation uses candidate IDs plus
`continuityRevision`, so an unrelated assignment or note does not invalidate a
safe intake decision.

### Idempotency receipt

Create one server-only `ticket_mutation_receipts` header plus ordered
`ticket_mutation_receipt_jobs` result rows for public and race-prone continuity
mutations:

- shop-global uniqueness on `(shop_id, request_key)`, with actor stored in the
  receipt so another actor cannot reuse the same key;
- mutation/schema version, mutation kind, actor, canonical target/candidate
  binding, and a versioned server-keyed fingerprint of the normalized request;
- resulting ticket ID plus zero to 25 result jobs stored as composite-FK child
  rows with unique zero-based ordinals;
- bounded timestamps only;
- no raw customer statement, note, phone, email, VIN, or media content;
- an exact retry first reloads current actor authority, then returns the
  persisted mutation identity and a current actor-safe projection;
- changed actor, mutation kind, payload, target, or candidate binding conflicts
  without a write.

This receipt foundation owns schema, canonicalization, replay, collision, and
retention behavior for create/append/separate and ticket lifecycle mutations.
Receipts are immutable and retained at least as long as the repair-order audit
record; this goal defines no receipt purge. It does not replace immutable quote
or message event ledgers.

## Work-item entry contract

The user answers one plain question: **Why is it here?** Each statement gets one
explicit intent:

```text
Why is it here?
│
├── Find the cause
│   ├── ticket_job.kind = diagnostic
│   ├── manual findings remain available
│   └── diagnostic engine remains globally unavailable
│
├── Perform requested work
│   └── ticket_job.kind = repair
│
└── Routine service
    └── ticket_job.kind = maintenance
```

`workItems` is an ordered atomic array of 1 to 25 validated items. Counter
intake may submit the full array; either every item is created in order on one
RO or none is. The mutation receipt preserves all ordered result job IDs. The
server no longer prepends a diagnostic job automatically. Conditions, fee
authorization, and assignment belong to the applicable item.

Each item may carry an optional normalized `quoteSeed` of ordered part/labor/
fee lines. Quick Ticket resolves canned-job truth server-side before locking,
normalizes and fingerprints the resolved seed with the item, then passes that
same immutable payload to the resolver. The resolver inserts each job and all
of its seeded lines atomically before revision bumps and receipt creation. A
failure rolls back the ticket, every job, every line, and the receipt; replay
returns the ordered persisted job identities without reinserting lines.

The v1 internal `repair` kind means known/requested work, not an assertion that
a failure was diagnosed. It includes known repair, accessory or lift-kit
installation, customer-supplied parts, inspection, sublet work, setup,
programming, and similar non-diagnostic requests. Routine recurring service
uses `maintenance`; finding an unknown cause uses `diagnostic`.

Quick ticket remains the fastest known-work/quote entrance and creates repair
or maintenance work. It uses the same continuity resolver and no longer owns a
separate duplicate-ticket behavior.

“Found another concern” creates a `technician_found` work item on the same
repair order with `createdFromJobId`. It records the technician's statement even
when they continue doing the original job without opening a Vyntechs diagnostic
workflow. No file, image, diagnostic-engine call, or AI inference is required.

Stale clients may use the legacy counter payload for one compatibility release.
The server converts it deterministically into work-item input and never treats
the old payload as permission to enter the disabled diagnostic engine.

## Active repair-order resolution

### Candidate definition

Continuity lookup considers every same-shop ticket for the selected vehicle
with `status = open`. A normal active candidate also has:

- no delivery timestamp;
- reconciled customer and vehicle identity.

An open ticket with a delivery timestamp or unreconciled identity is not
silently omitted; it is classified `ambiguous` and surfaced as an exception.

Candidates receive a derived continuity state using first-match precedence:
invariant/reconciliation failure or zero jobs is `ambiguous`; otherwise any
active job is `active_work`; otherwise any done job is `ready_to_close`;
otherwise a nonempty all-canceled set is `voidable`; every impossible remainder
is `ambiguous`.

| State | Definition | Default behavior |
| --- | --- | --- |
| `active_work` | At least one job is open, in progress, or blocked | Append candidate |
| `ready_to_close` | No active job and at least one done job | Show append versus close/start-separate decision |
| `voidable` | Nonempty job set and every job is canceled | Require resolution; never silently append |
| `ambiguous` | Zero jobs, corrupt, duplicate, unreconciled, or unsupported state | Fail closed and show recoverable bounded context |

Age alone never decides whether a visit is active. A vehicle can legitimately
wait for parts. The UI shows RO number, created date, current stage, and work
summary so an old open record is visible rather than silently ignored.

### Mutation input

Every existing-vehicle submission carries an actor-bound request key, request
fingerprint, and one continuity intent:

```text
continuity.mode
│
├── auto
│   └── expected candidate IDs + continuity revisions
│       ├── zero still current → create
│       ├── one active_work still current → append
│       └── anything else → continuity_choice_required
│
├── append
│   └── exact expected ticket ID + continuity revision
│
└── separate
    └── complete expected candidate set + continuity revisions
        + exact separate-from ticket
        + required reason + optional bounded note
```

The server never trusts the browser's candidate decision by itself.

### Repository lock order

Every participating transaction follows one total order:

1. active actor profile;
2. shop row whenever `create`, `separate`, or `auto` may allocate a ticket
   number—`auto` locks it before candidate inspection even when it later appends;
3. customer, then vehicle;
4. tickets sorted by ID;
5. jobs sorted by ID;
6. job lines sorted by ID;
7. quote versions, approval events, sends, and order rows, each sorted by ID;
8. mutation receipt header/result rows.

Packets A-C must reconcile every existing writer that can join these resources,
including quote, assignment, simple-work, story, diagnostic-start, and ticket
creation. A transaction that cannot acquire its next stable lock returns one
consistent retryable conflict through `NOWAIT`/bounded retry policy; it never
locks the same resources in reverse. Receipt lookup may be a non-locking replay
check before this sequence, but receipt insertion/locking is last.

### Transaction and race behavior

The handler:

1. authenticates, reloads, and locks the active actor;
2. locks the shop row when the requested mode may allocate, then follows the
   repository lock order through the same-shop customer/vehicle;
3. loads and locks candidate tickets and child truth in stable ID order;
4. compares current candidate IDs/continuity revisions with the request;
5. applies one atomic create, batch append, or explicit separate creation;
6. increments affected revisions;
7. writes the receipt and ordered result rows in the same transaction;
8. returns the complete actor-safe ticket/job projection plus revisioned entity
   invalidation references. Packet F later owns role-home summary calculation
   and response enrichment.

Two devices that simultaneously observe zero candidates cannot create two
silent repair orders. The second transaction sees the first result and returns
current truth or an exact idempotent replay.

Add a composite lookup index on `(shop_id, vehicle_id, status)`. Do not add a
partial unique index for open tickets.

Every counter, quick-ticket, generic create/add-job, found-concern, and legacy
route enters this one server continuity policy. No old route may bypass
`preview`, `on`, or `hold` into duplicate creation.

### Conflict experience

A stale or ambiguous choice returns a bounded `continuity_choice_required`
projection. The user's typed work item remains in the composer. They choose the
current repair order or a justified separate RO without retyping.

## Quote and authorization continuity

The governing rule is:

> Adding work must not authorize the new work and must not revoke an unchanged
> job's already-recorded authorization.

The approved scope is represented by a versioned canonical authorization
fingerprint using exact normalized decimal/string encodings.
`AuthorizationScopeV1` is strictly job-local: job identity, statement/scope,
story, ordered job lines,
quantities, unit prices, tax treatment, job subtotal, deterministically
allocated job tax/fees, and job total. It excludes the whole-ticket aggregate,
unrelated job IDs/content, quote-version number/active state, assignment, work
status, internal notes, and UI state. The immutable quote retains whole-ticket
totals for display, while its job-local scope, approval event, and fingerprint
are pinned together.

Required behavior:

- a new work item starts `pending_quote` with no approved version;
- existing immutable quote versions and approval events are never rewritten;
- an approved job remains pinned to its exact canonical authorization
  fingerprint, immutable quote version, and approval event when unrelated work
  changes, even if the ticket later receives another quote version;
- changed price, labor, part, story, or work scope invalidates only the changed
  job's approval;
- a sent but undecided ticket quote may be superseded and its link revoked when
  new scope is prepared; it is never silently changed beneath the customer;
- new work is visibly labeled as additional authorization required;
- a previously approved job is never copied forward as though the customer
  approved changed or additional scope.

The current pinned-simple-work rule becomes the model for all unchanged jobs.
An unrelated new job/version must preserve the original pin. Changing any
fingerprinted field invalidates only that job atomically. Diagnostic repair
access validates the exact immutable approved job fingerprint/version/event,
not whether that version remains the ticket's sole globally active version.

## Ticket lifecycle and recovery

Ticket stage is a deterministic server projection, never a manually maintained
kanban value. The first matching predicate wins:

| Precedence | Stage | Exact predicate |
| --- | --- | --- |
| 1 | `attention_required` | Any status/timestamp check fails; an open RO has terminal timestamps; a terminal RO has nonterminal jobs; customer/vehicle truth is unreconciled; or an approved job lacks its pinned version/event/fingerprint |
| 2 | `canceled` | `ticket.status = canceled` and all cancel invariants hold |
| 3 | `closed` | `ticket.status = closed` and all close invariants hold |
| 4 | `in_progress` | Open RO with any job `in_progress` |
| 5 | `blocked` | Open RO with no in-progress job and any job `blocked` |
| 6 | `ready_to_deliver` | Open RO with no active job and at least one `done` job |
| 7 | `voidable` | Open RO whose jobs are all `canceled` |
| 8 | `awaiting_approval` | Open RO with an active job in approval state `sent` |
| 9 | `ready_to_work` | Open RO with an `open` approved job |
| 10 | `estimating` | Any other valid open RO |

Here, active means job status `open`, `in_progress`, or `blocked`; terminal
means `done` or `canceled`. Candidate state `ready_to_close` is the continuity
name for stage `ready_to_deliver`. An empty-job RO is `attention_required`, not
silently voidable.

### Terminal state invariants

Database checks and handlers enforce these exact shapes:

| Ticket status | Required | Forbidden |
| --- | --- | --- |
| `open` | no terminal actor/timestamp/disposition | canceled, delivered, or closed actor/timestamp; close/cancel disposition |
| `closed` | paired `closedAt/closedBy`, one `closeDisposition`, all jobs terminal | canceled actor/timestamp/reason |
| `canceled` | paired `canceledAt/canceledBy`, one `cancelReasonCode`, all jobs canceled | delivered/closed actor/timestamp/disposition |

`closeDisposition = delivered` additionally requires paired
`deliveredAt/deliveredBy`. Every other close disposition forbids delivery
fields. `no_repair` requires a bounded note. `other` cancellation requires the
existing bounded cancellation note. Actor/timestamp pairs are both null or
both present. Closed and canceled repair orders never reopen; correcting a
terminal mistake requires a separately designed append-only correction event.

### Transition matrix

All lifecycle mutations require an open reconciled RO, owner/advisor authority,
current `projectionRevision`, a shop-global request key, and the repository lock
order. "Active sent quote" below means an unresolved send still awaiting a
customer response; approved/consented, declined, expired, and revoked sends are
resolved. "Consequential parts" means a part line in `needs_order`, `ordered`,
or `received`; installed work is already performed.

| Action | Required child/approval state | Atomic result |
| --- | --- | --- |
| `deliver_and_close` | Every job terminal; at least one `done`; no active send; no consequential parts/order inconsistency | Close as `delivered`; record delivery and close actor/timestamps together |
| `close_customer_declined` | No `in_progress`, `done`, or approved job; every nonterminal job is explicitly `declined`; no active send or consequential parts/money | Cancel remaining open/blocked jobs and close as `customer_declined` without delivery |
| `close_no_repair` | Only diagnostic jobs may be `done`; no repair/maintenance job is `in_progress`, `done`, or approved; every remaining nonterminal item is declined/cancelable; no active send or consequential parts/money | Cancel eligible remainder and close as `no_repair` without delivery; note required |
| `close_remote_quote_not_proceeding` | No `in_progress`, `done`, or approved job; every send is declined, expired, or revoked; no consequential parts/money | Cancel eligible remainder and close as `remote_quote_not_proceeding`; implemented only by Packet H |
| `cancel` | No `in_progress`, `done`, or approved job/pin; no active send; every part line is `proposed`; no consequential order or money state | Cancel every open/blocked job and set ticket `canceled` with reason; never delete |
| `return_job_to_open_queue` | RO is open; selected job is `open` or `blocked` | Set blocked job to `open`, clear assignment/claim, preserve approval; reject `in_progress`, `done`, or `canceled` |

The base lifecycle kernel uses only tables proven live: tickets, jobs, immutable
quote/approval truth, and job-line part status. One deployment-aware
`LifecycleSendAdapter` returns exactly:

- `unavailable` only when the schema manifest proves send tables are absent and
  every send runtime is disabled; no hidden send row can exist, while any job
  still in approval state `sent` remains conservatively unresolved;
- `available` only after Packet H's verified schema/runtime adapter is deployed,
  in which case terminal mutations lock and query its exact send rows; or
- `unknown_or_mismatch`, which blocks every terminal mutation.

The kernel never queries a messaging, send, order, or inbox table that is
absent. Messaging/send schema or runtime may not enable before Packet H. If
either becomes live first, terminal mutations enter hold until the adapter is
deployed and verified. Packet H then adds send/order-aware legality; until it
lands, remote-quote closure is unavailable and any unprovable state remains
`attention_required`.

### Recovery

Vehicle history lists open, closed, and canceled repair orders in reverse
activity order. Each row shows the RO number, visit date, exact stage,
work-item summaries, and durable `/tickets/[id]` destination. Packet E must make
truthful recovery work through direct RO links and vehicle history. Packet F
then adds `ready_to_close`, `voidable`, and `attention_required` exceptions to
role homes so terminal child states cannot strand a hidden open parent.

No migration auto-merges, deletes, cancels, or closes existing duplicate or
zombie tickets. A read-only classification report precedes any separately
authorized cleanup.

## Role-shaped projections

One domain projection produces different role surfaces without creating
different products:

```text
/today
│
├── Owner / Advisor → Shop Today
│   ├── every active RO in the shop
│   ├── unassigned and assigned work
│   └── closeout / inconsistency exceptions
│
├── Technician → My Work
│   ├── assigned active jobs
│   ├── tier-eligible unassigned jobs
│   └── parent-RO context for each job
│
└── Parts → Parts Queue
    ├── jobs with parts-relevant line state
    └── repair-order context without wrenching-tier requirements

/tickets/[id]
└── Same living repair order, actions derived from server authority
```

| Role | Default actions |
| --- | --- |
| Owner/advisor | Add work, confirm migrated work truth, assign, reassign, return an eligible job to the open queue, quote, record approval, deliver, close, cancel |
| Technician | Claim eligible work, open assigned work, save structured text findings/notes, complete, add discovered concern |
| Parts | Source, prepare, order, receive when those rows are available; view story truth without forbidden edit controls |
| Reviewer/curator | Separate content-review console only; reviewer status never grants shop-wide RO access |

Every active ShopOS role may use its already-authorized create-ticket and
build-quote capability. The UI must stop imposing owner-only counter access
where server doctrine grants broader capability. Server capability helpers,
not visible controls, remain authoritative.

One repair order appears once in a role queue even when it has several jobs.
Its child ledger communicates work ownership and state without multiplying the
vehicle into several top-level cards. Before order tables are live, Parts Queue
is derived only from deployed `job_lines.partStatus` truth and exposes no
fictional order action. Packet H adds order-aware actions later.

## Adaptive no-new-page presentation

Reuse the existing authenticated shell, `/today`, `/tickets/[id]`, `/intake`,
`/tickets/new`, and quote routes. Do not create a second dashboard, mobile app,
desktop app, or standalone concern page.

```text
Workspace width
│
├── Compact (<840px)
│   ├── one focused queue or RO surface
│   ├── anchored bottom sheet for add/assign/close choices
│   └── back restores exact selected card and scroll
│
├── Split (840–1279px)
│   └── role queue + selected living RO
│
├── Workbench (1280–1679px)
│   └── navigation + role queue + living RO
│
└── Expanded (>=1680px)
    └── optional customer/vehicle/history context rail
```

`AdaptiveWorkbench` is the shared composition primitive. Existing routes remain
deep-link and rollback boundaries, while the mounted application frame and
appropriate queue remain stable.

Add work, choose separate RO, assign/reassign, quote, close, and history context
open as anchored sheets or rails within the existing workspace. The target RO
keeps a durable URL.

Mutations return exact ticket/job and dependent summary projections. Ticket
projections carry `projectionRevision`, jobs carry `revision`, and all values
travel as decimal strings. The client applies only a strictly newer entity
revision. `router.refresh()` is recovery, not the normal success path. A role
or tenant loss removes inaccessible projections immediately.

Swipe may duplicate the one server-permitted primary action and bounded
secondary actions after visible controls pass. It never hard-deletes repair
history and is never required. Every action has a 44-by-44-pixel keyboard,
screen-reader, touch, mouse, and reduced-motion equivalent.

## Diagnostics-off and no-media behavior

- `DIAGNOSTICS_RELEASE` remains globally fail-closed in production.
- A `diagnostic` work item means the human shop needs to find the cause; it does
  not imply that Vyntechs can start its legacy diagnostic engine.
- The existing manual-finding path remains the complete optional work-item
  path while diagnostics are off.
- Counter intake, active-RO resolution, assignment, quoting, work notes,
  lifecycle, and history must not depend on a diagnostic session.
- No continuity UI renders a camera, gallery, upload, attachment, disabled
  media placeholder, or future-media teaser.
- Media routes continue failing closed before reading bytes or touching
  storage.
- No quote, story, projection, invalidation, log, receipt, or test fixture adds
  new operational-media references.

## Security and authorization

- Every candidate, ticket, job, receipt, history, and role-home query is scoped
  by the persisted actor's active same-shop membership.
- Cross-shop, inactive, malformed, and unauthorized targets remain
  indistinguishable from not found where disclosure would leak existence.
- Candidate decisions, available actions, assignment, lifecycle legality, and
  approval validity come from server truth.
- New server-only tables enable RLS, revoke all client table privileges,
  install deny-all direct-client policies, and expose only intended
  `service_role` operations.
- Tenant integrity preserves the deployed transitive vehicle model: the
  existing `(shop_id, customer_id)` ticket/customer FK plus
  `(customer_id, vehicle_id)` customer/vehicle FK. The resolver locks and
  verifies both rows; this design does not pretend `vehicles.shop_id` exists.
- Composite FKs protect ticket/job/source-job, creator, approval, receipt
  result, and related-RO identity. Related ROs additionally receive handler
  checks for paired-null fields, no self-link, same customer/vehicle, and
  immutable relationship evidence.
- Revisions are compared and incremented in the same transaction as mutation.
- Invalidation envelopes contain only shop-scoped entity kind, ID, revision,
  and ordering token. They never carry customer, vehicle, work-statement,
  authorization, note, or diagnostic content.
- Logs and receipts contain bounded codes, IDs, counts, and fingerprints—not
  customer PII or work narratives.

## Error and empty states

| Condition | Product behavior |
| --- | --- |
| No active candidate | Create the RO and return it selected |
| One current active candidate | Show and append there by default |
| Ready-to-close candidate | Preserve input; choose append, close first, or justified separate |
| Multiple candidates | Preserve input; require one explicit target or justified separate |
| Candidate changed before submit | Replace candidate summary with server truth; do not write |
| Ticket closed/canceled during submit | Preserve input and offer current valid destination |
| Duplicate exact request | Return the persisted result without another row |
| Changed reuse of request key | Conflict without write |
| Assignment race | Show current assignee and current available actions |
| Role/membership loss | Remove inaccessible data and route through auth boundary |
| Network uncertainty | Say not confirmed; retain request identity and safe input |
| No work for the role | Honest role-specific empty state plus only authorized creation actions |

No error requires the user to retype a work statement already held safely in
the current application session.

## Migration contract

Migration is additive, staged, and independently gated.

### Deployed dependency matrix

Every packet re-verifies this matrix against the live schema before planning or
deployment. As of this design:

| Truth | Production state | Safe dependency now |
| --- | --- | --- |
| Tickets, jobs, job lines, immutable quote versions/events | deployed | Packets A-G may consume only their verified columns |
| Messaging consent/sends/log migrations `0033`-`0035` | not applied | No production query; Packet H waits |
| Parts-order schema/handlers from Rows 38/41 | not shipped | Base lifecycle uses `job_lines.partStatus`; Packet H waits |
| Advisor response inbox Rows 36/37 | not shipped | Base recovery uses direct RO/history; Packet F owns role-home exceptions |
| Continuity fields/receipts/revisions | not applied | No declaration/read/write may deploy before the continuity DDL gate |

Code must never query an unavailable table or column. Build-time schema
declarations are not proof of production availability.

### Stage 1 — held migration artifact and local proof

- add nullable job-local work/context/authorization/provenance/review columns;
- add projection, continuity, and job revisions;
- add related-RO/lifecycle fields, receipt header/results, composite FKs,
  checks, indexes, RLS, ACLs, and policies;
- generate and verify source schema, migration SQL, and metadata together;
- apply only to local PGlite and run the writer/lock/revision inventory;
- keep the artifact on an immutable held branch; do not merge or deploy runtime
  schema declarations while production lacks the columns.

### Stage 2 — named production DDL gate

Production DDL requires separate founder authorization. If approved, apply the
exact reviewed migration from its immutable ref before merging/deploying code
whose Drizzle schema declares the new columns. Verify columns, checks, indexes,
FKs, RLS, ACLs, policies, and database advisors immediately. A failed or
partial apply stops the lane; application release stays on the old schema.

### Stage 3 — deterministic backfill

The backfill orders each ticket's jobs by `(created_at, id)` and uses this exact
idempotent classifier:

1. If a ticket has exactly one job, that job receives the full stored ticket
   concern as its `legacy_migrated` statement, root context, and diagnostic fee
   only when applicable; the root association is `confirmed`.
2. If a ticket has multiple jobs and exactly one diagnostic title byte-matches
   the existing constructor output
   `("Diagnose: " + ticket.concern).slice(0, 200)`, that one job receives the
   full root concern/context and is
   `confirmed`.
3. Every other job receives its bounded stored title as
   `legacy_migrated`/`review_required`. The `Diagnose:` prefix is retained;
   truncation means the migration never pretends its suffix is the complete
   customer concern.
4. If a stored title is blank after bounded normalization, use the explicit
   neutral statement `Legacy work item — review required` with
   `review_required`; no migrated row remains semantically null.
5. Multiple root matches or no root match on a multi-job ticket use rule 3 for
   every job. They never guess which item owns the ticket concern.

The program uses the same JavaScript string-slice semantics as the historical
writer, not an approximately equivalent SQL substring. Creator backfills from
the same-shop ticket creator with `ticket_creator_backfill`, whether that
profile is now active or inactive. Immutable quote snapshots, approval events,
and historical bodies are not rewritten.

Before any production data mutation, a read-only dry run records only aggregate
class counts, an immutable row-roster hash, and anomaly counts—never customer
text or PII. The separately authorized transactional backfill updates only
still-null continuity fields, verifies every classified row and all
postconditions, and is safe to rerun with the same roster/result hash. Any
unexpected class/count/hash change stops before write.

### Stage 4 — compatibility release

- every reader prefers job-local truth and uses the immutable ticket root only
  for an unmigrated root fallback;
- creation writes ordered `workItems[0]` to the legacy root summary plus every
  item to job-local truth; append writes job-local truth only and can never
  overwrite the root summary;
- every participating writer uses the shared lock/revision contract;
- diagnostic start, manual/AI story, quote, ticket detail, found-concern, and
  role projections bind to the selected job's work statement;
- automatic append remains unavailable.

### Stage 5 — coverage and approval constraints

After migration verification proves every job has bounded work truth and
provenance, new writes enforce non-empty job-local truth. A later migration may
make fields physically non-null only after stale-client and rollback windows
close. Approval-continuity tests must pass before resolver enablement.

### Stage 6 — continuity enablement

Only after concern binding, writer revision, receipt replay, canonical approval,
lock-order, and race regressions pass may active-RO append behavior be enabled.

No production DDL, backfill, cleanup, merge, cancellation, closure, or feature
enablement is authorized by approving this design. Each remains its named gate.

## Rollout and rollback

Use one fail-closed server release policy:

```text
SHOP_OS_CONTINUITY_RELEASE
├── compat  → dual read/write; current creation behavior during the pre-enable release only
├── preview → approved QA shop allowlist only
├── on      → continuity resolver and living-RO presentation enabled
└── hold    → safe rollback; existing-vehicle mutation pauses without creating a duplicate
```

Missing or unknown values resolve to `hold`. `compat` must be set explicitly,
may be used only before the first production continuity enablement, and may
never be the rollback target after continuity writes exist. Preview shop
identifiers stay in environment configuration, never source or client state.
Every existing-vehicle write route calls the central policy before mutation;
an old route cannot interpret `hold` as permission to create a new ticket.

Rollout sequence:

1. schema and domain compatibility in local/CI only;
2. separately approved production additive migration;
3. verified runtime-schema/compatibility release in explicit `compat` mode;
4. read-only production classification and advisor checks;
5. QA identity/shop preview with controlled synthetic work;
6. owner/advisor, technician, and parts role matrix proof;
7. bounded production enablement with error/latency monitoring;
8. full release only after the preview proof is clean.

Each promotion first rechecks the deployed dependency matrix. Missing
continuity columns or an unavailable message/order table blocks the consuming
code path; source declarations, feature flags, and optimistic fallbacks cannot
substitute for live-schema proof.

Rollback after new continuity writes is code-first and non-destructive:

- switch resolver/presentation to `hold`, which preserves typed input and
  refuses existing-vehicle mutation instead of restoring duplicate creation;
- keep job-local compatibility reads and additive columns;
- keep every appended job and immutable authorization record readable;
- disable unsafe lifecycle mutations while preserving history;
- forward-fix data or domain behavior rather than dropping columns or restoring
  wrong ticket-level concern binding.

The old UI/routes remain a presentation fallback, not permission to revert to
incorrect data interpretation.

## Verification contract

### Domain and migration

- source and PGlite schema enforce exact checks, indexes, FKs, RLS, ACLs, and
  direct-client refusal;
- every migrated job receives deterministic bounded work truth and explicit
  provenance/review state, including ambiguous and blank-title fallbacks;
- root and additional job concerns never cross-bind in diagnostic intake,
  manual findings, stories, quotes, or history;
- a 1-item and 25-item intake are atomic, preserve order, and replay all result
  job IDs; an invalid item rolls back the entire batch;
- quick/canned seeded lines commit or roll back with their owning work item and
  never duplicate on replay;
- zero, one, ready-to-close, voidable, multiple, stale, and cross-shop active-RO
  candidate cases are exact;
- simultaneous submissions for one vehicle cannot silently create two ROs;
- exact request retries re-authorize then replay; changed actor, kind, payload,
  target, or candidate reuse conflicts;
- every participating writer follows the lock/revision matrix, and contention
  returns one bounded retryable conflict without deadlock or partial write;
- every included `ContinuitySignatureV1` field change bumps continuity revision
  and every explicitly excluded assignment/note-only change does not;
- every old and new intake route passes the central release policy;
- no new diagnostics or media entrance becomes reachable.

### Authorization and lifecycle

- a new job never inherits approval;
- unchanged approved work remains pinned after unrelated work is added;
- changed scope invalidates only the changed job;
- sent links never change scope beneath the customer;
- legacy confirmation requires owner/advisor authority and expected revision,
  records provenance, preserves the root summary, and invalidates only changed
  approved scope;
- every stage predicate and terminal status/timestamp check is exact;
- each deliver/close/cancel matrix row accepts only its listed shape and rejects
  all neighboring job×approval×send×part states;
- lifecycle send adapter modes `unavailable`, `available`, and
  `unknown_or_mismatch` permit/block exactly as specified;
- terminal ROs never reopen; return-to-open is job-scoped only;
- terminal mutations are actor-bound, idempotent, revision-checked, and
  tenant-safe.

### Role matrix

Cover owner, advisor, technician with/without sufficient tier, parts, reviewer
axis, inactive actor, and cross-tenant actor across:

- unassigned, assigned-to-self, assigned-to-other;
- open, in progress, blocked, done, canceled;
- active, ready-to-close, parallel, closed, and canceled ROs;
- create, append, assign, claim, reassign, return-job-to-open-queue, quote, approve, work,
  deliver, close, cancel, and history recovery.

Every successful create or append remains discoverable from the actor's normal
role-shaped home after navigation and after assignment to somebody else where
that role is expected to retain shop-wide visibility.

### Application behavior

- one RO appears once with multiple child jobs;
- a routine mutation performs no full-document navigation or broad refresh;
- only affected projections and declared counts rerender;
- typed input, selected work, scroll, focus, disclosure state, and unrelated
  pending work survive;
- compact, split, workbench, and expanded compositions share action names and
  server intent;
- visible button, swipe, mouse, keyboard, screen reader, 200% zoom, reduced
  motion, resize, rotation, weak network, reconnect, and stale response paths
  remain equivalent and truthful.

Minimum responsive matrix remains 320×568, 375×812, 430×932, 768×1024,
1024×768, 1280×800, 1440×900, and 1920×1080.

### Release proof

- focused unit, PGlite domain, route, component, role, and migration tests;
- complete test suite, TypeScript, production build, and clean diff;
- source guards for diagnostic-off, no-media, no hard unique open-RO rule, and
  no ticket-level concern consumption in migrated job paths;
- keyboard/accessibility and browser proof on the real wired surfaces;
- independent domain, authorization/security, product/role, and whole-branch
  reviews with no unresolved Critical or Important findings;
- non-mutating production smoke before controlled QA mutations;
- clean deployment, application, database-advisor, error, and latency proof.

## Success criteria

This design is complete when:

1. selecting an existing vehicle shows the current visit before submission;
2. the normal path adds the work item to the correct living RO;
3. a legitimate separate RO requires and preserves an explicit reason;
4. every job carries its own exact work statement and conditions;
5. later diagnostic/story/quote behavior uses the selected job, never the
   ticket's first complaint;
6. existing approval remains valid only for the unchanged canonical
   authorization fingerprint;
7. owner/advisor never loses an RO because another technician claimed it;
8. technician and parts surfaces show the correct actionable subset;
9. done/canceled child jobs cannot strand a hidden open parent ticket;
10. vehicle history recovers every open, closed, and canceled RO;
11. phone through wide desktop use the same mounted application and projection;
12. no diagnostics engine or operational media is reachable;
13. no production data is merged, deleted, or reinterpreted without its gate.

## Capability packets and execution order

This umbrella design crosses several independent subsystems. It must not become
one giant implementation plan.

### Packet A — Additive migration and mutation foundation

**Outcome:** The database and shared mutation primitives can represent job
truth, revision ordering, receipt replay, and lifecycle evidence safely.  
**Includes:** held source schema/migration artifact, local PGlite proof,
composite constraints/RLS/ACLs, total lock order, revision helper, immutable
receipt header/results/replay helper, and retrofit inventory for every existing
ticket/job writer.  
**Release boundary:** Stop at the named production-DDL gate. Runtime schema
declarations and helpers merge/deploy only after the exact DDL is live and
verified.  
**Excludes:** backfill execution, job-truth consumers, resolver behavior, UI.  
**Done when:** Local proof is complete; then, only if the DDL gate is approved,
the deployed schema and every participating writer satisfy the lock/revision/
receipt contracts before Packet D can consume them.

### Packet B — Job-local work truth and compatibility

**Outcome:** Every job owns the exact request/context used by downstream
consumers while the immutable legacy root remains readable.  
**Includes:** ordered batch contract, exact backfill program/dry run,
job-local readers/writers, root-only creation compatibility, and diagnostic,
story, quote, manual-finding, detail, found-concern binding, and the guarded
legacy-statement confirmation mutation.  
**Release boundary:** Production backfill is a separate data-mutation gate;
compat readers remain safe before it runs.  
**Excludes:** active append, approval pinning changes, role-home/UI redesign.  
**Done when:** Every row has deterministic truth/review state and two concerns
on one ticket cannot cross-bind anywhere.

### Packet C — Immutable per-job authorization continuity

**Outcome:** Unrelated added work neither authorizes itself nor revokes an
unchanged approved job.  
**Includes:** versioned canonical authorization fingerprint, immutable
version/event/fingerprint pin, job-local invalidation, sent-link behavior, and
repair-access validation.  
**Excludes:** customer messaging transport and resolver UI.  
**Done when:** Adding an unrelated job/version preserves an unchanged approval,
while changing one fingerprinted field invalidates only that job. Packet D is
blocked until this proof passes.

### Packet D — Transactional RO resolver

**Outcome:** Existing-vehicle intake creates, batch-appends, or starts separate
exactly as the current locked candidate set permits.  
**Includes:** candidate projection, central route policy, customer/vehicle lock,
atomic 1-to-25 item-plus-normalized-quote-seed mutation, quick/canned line
insertion, create/append/separate intents, and consumption of Packet A
receipts/revisions.  
**Excludes:** production cleanup, hard uniqueness, and receipt schema changes.  
**Done when:** Concurrent submissions cannot silently duplicate an RO, retries
replay every ordered result, and every legitimate separate RO preserves why.

### Packet E — Lifecycle and direct recovery kernel

**Active-plan ownership:** Replaces the unfinished base scope of Row 44.  
**Outcome:** Every living RO can reach one honest terminal state and be found
later using currently deployed truth.  
**Includes:** exact stage precedence/checks, base deliver/close/cancel handlers,
job-only return-to-open-queue, direct RO recovery, and vehicle history.  
**Excludes:** messaging/order-aware closeout, role-home exception presentation,
payments, accounting invoice, and appointments.  
**Done when:** Every lifecycle matrix case is exact and a terminal-child/open-
parent exception remains recoverable by direct link and vehicle history.

### Packet F — Server role projections and action authority

**Active-plan ownership:** Replaces the unfinished base scope of Row 45.  
**Outcome:** Each role receives the correct grouped RO queue, exact exceptions,
and server-permitted actions.  
**Includes:** `ShopTodayProjection`, `MyWorkProjection`, deployed-truth
`PartsQueueProjection`, ticket/action envelopes, role matrix, and minimal
semantic route wiring, including confirmation authority for migrated work.  
**Excludes:** adaptive composition, gestures, reviewer-console redesign, and
unshipped provider-order actions.  
**Done when:** Owner/advisor, technician, and parts discovery remains correct
before/after assignment and lifecycle changes, including closeout exceptions.

### Packet G — Adaptive living repair order

**Active-plan ownership:** Supersedes Row 48; any still-live shared-path lease
remains a file-ownership gate, not an AutoEYE product dependency.  
**Outcome:** Existing role queues and the living RO compose continuously across
all screen sizes with precise local updates.  
**Includes:** exclusive ownership of `AdaptiveWorkbench`, Today/ticket-detail
responsive composition, sheets/rails, entity reducer, focus/history/reconnect,
inline legacy-statement confirmation, and optional gestures only after visible
actions pass.  
**Interface:** Consumes Packet F projections/action envelopes and may not
rederive role or lifecycle authority in the client.  
**Excludes:** new routes/pages, native applications, domain mutation semantics,
and broad real-time payloads.  
**Done when:** Acting on one element changes only that element and declared
summaries without losing context on any supported viewport/input mode.

### Packet H — Message/order-aware lifecycle extension

**Active-plan ownership:** Preserves the deferred dependency-bound portion of
Rows 44-45 after their base scope moves to Packets E-F.  
**Outcome:** Remote quote and consequential order truth participates in
closeout and Parts Queue without weakening the base kernel.  
**Depends on:** Live/verified messaging migrations and Rows 36-38, 41-42 as
applicable; absent dependencies keep this packet unavailable.  
**Includes:** active-send revocation/expiry guards,
`LifecycleSendAdapter` activation, `remote_quote_not_proceeding`, parts-order
legality, order-aware exceptions, and already-authorized parts actions.  
**Excludes:** provider transport/spend and accounting payments.  
**Done when:** Message/order states cannot be bypassed during lifecycle and no
code path queries an undeployed table.

Dependency order is A → B → C → D → E → F → G. Packet H starts only after E
and its external dependencies are genuinely live; it may land after G. Each
packet receives its own exact implementation plan, fresh writer lane, tests,
review, rollback, and shipping proof.

Module ownership is equally explicit: A owns new
`lib/shop-os/continuity/mutation-foundation` primitives and database artifacts;
B owns job-truth contracts/readers; C owns authorization-continuity; D owns
`repair-order-continuity`; E owns `ticket-lifecycle` and `vehicle-history`; F
owns `role-home` and action envelopes; G exclusively owns adaptive production
composition; H extends lifecycle/order adapters. `lib/tickets.ts` remains a
compatibility orchestrator/export seam, not the place all eight packets grow.

Approval of this written umbrella design authorizes plan creation for all eight
packets. The control lane must not request another generic “continue” approval
between them. Production DDL, backfill, feature enablement, cleanup, deploy,
spend, provider, and other named gates remain separate.

## Stop conditions

Stop and return with exact evidence if implementation would require:

- a new visit/concern subsystem instead of the approved additive model;
- a unique one-open-ticket constraint;
- dropping or rewriting legacy ticket concern fields or immutable snapshots;
- weakening quote approval, assignment, tenant, role, idempotency, or revision
  checks;
- diagnostic prompt, risk, retrieval, topology, corpus, or engine-semantic
  changes;
- operational media, private-content caching, or new storage economics;
- production migration, live-data cleanup, feature enablement, deployment,
  external provider, spend, or customer communication without its gate;
- a separate mobile/desktop product or an unnecessary new page;
- a third replan of the same packet or the same failed approach twice.

## Current evidence

- `origin/main` at `4a36296d86504fdae44b5eef4a3e4065821cec6c`
  after PR #171 restored creator-side discoverability for unassigned work.
- Current schema stores visit concern on `tickets` and only short title on
  `ticket_jobs`.
- Counter and quick intake always create a new ticket for an existing vehicle.
- Diagnostic start and customer-story paths read the ticket's root concern.
- Assignment handlers exist, but the UI exposes self-claim only.
- Ticket delivery/close/cancel handlers and real vehicle history are not
  shipped; active plan Rows 44–45 remain pending.
- Adaptive application foundation is shipped but has no living-RO domain
  consumer.
- A privacy-minimized production aggregate confirmed duplicate open-RO and
  hidden terminal-child/open-parent shapes; no production row was changed.
- Current industry tools also model multiple concerns/services within one work
  order or repair order: [Protractor](https://help.protractor.com/shopmanager/Work_Orders/New_Work_Order.htm),
  [Tekmetric](https://support.tekmetric.com/hc/en-us/articles/36897066105111-The-Customer-Concern),
  and [Shopmonkey](https://support.shopmonkey.io/hc/en-us/articles/38743982351380-Add-Remove-Services-on-Estimates).

## Written-spec review gate

Before implementation planning, the founder reviews this file for one decision:

> Approve or modify the additive job-local continuity model and its eight-packet
> execution boundary.

After approval, the control lane updates the active ShopOS status table and
driver state, writes the Packet A implementation plan, and continues through
the remaining safe planning/execution sequence without generic approval stops.
Packet A will stop only at its named production-DDL gate; later production
backfill, enablement, cleanup, deployment, spend, provider, or scope gates also
return to the founder.
