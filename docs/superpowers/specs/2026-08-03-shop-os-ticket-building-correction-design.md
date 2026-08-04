# Shop OS Ticket Building and Correction Design

**Status:** Source merged and deployed dormant in PR #244. Production migration and activation remain separate gates.

## Executive result

Keep intake short and make the saved repair order the durable place where an advisor finishes and corrects the work. A correction opens exactly where the fact lives, preserves typed work across interruption, commits once through a tenant-scoped idempotent transaction, visibly settles into server truth, and reveals the next valid action.

Prepared quote history is never edited. Correcting customer/vehicle identity, concern, job scope, or priced diagnostic work first makes the active prepared version no longer current and expires any actionable customer link in the same transaction. The old immutable snapshot remains byte-for-byte in History; the current repair order returns to draft truth.

## Intent normalization

### Likely true outcome

An advisor can write in a customer and vehicle, capture the concern and first job, finish a mixed diagnostic/repair work order on the saved repair order, and correct an ordinary mistake without losing a draft, duplicating the repair order, or leaving the customer and shop on different versions of truth.

### Explicit requirements

- Intake/search/create, duplicate-safe customer choice, customer/vehicle/concern/job correction, real draft preservation, plain language, phone density, and conflict recovery.
- Before preparation, eligible repair-order facts may be corrected with an activity receipt.
- After preparation or sharing, a vehicle-, scope-, or money-affecting correction makes the active version no longer current, closes the old actionable handoff, and preserves the historical snapshot byte-for-byte.
- Finish, Correct, and Recover must pass on phone and desktop.
- Every decisive interaction must feel world class through truthful, restrained motion, color, geometry, and focus—not decoration.

### Inferred requirements

- The primary `/intake` door remains a short first durable save; it does not become a multi-step whole-repair-order wizard.
- Correction is repair-order scoped. It may relink this repair order to the right existing or newly resolved customer/vehicle pair; it never silently rewrites customer or vehicle rows used by other repair orders.
- Only an active advisor or owner may correct customer-facing repair-order truth.
- A job may be corrected or removed only while it is unstarted: ticket open, job `open`, and no diagnostic session. Work already in progress, held, finished, or canceled stays immutable.
- An ambiguous retry must reuse the same request identity. A conflicting retry refreshes current truth and preserves the local correction draft.

### Constraints and non-goals

- No global customer merge, customer cleanup, or entity deduplication project.
- No global Edit mode, correction modal, new page, generic version manager, or multi-job intake wizard.
- No mutation of prepared quote snapshots, quote-event history, approval history, worked scope, or completed work.
- No new external provider, notification, payment, media, dependency, or diagnostic-engine behavior.
- No user-facing term `successor draft`; the interface says `Current draft` and names the exact prepared version that is no longer current.
- No production migration or enablement in this chunk without its separate authority gate.

### Effort and authority

- **Tier:** T2 cross-functional, because one user journey crosses intake, identity, ticket, quote version, activity, and mounted UI contracts.
- **Source authority:** A2 under Brandon's preapproval through reviewed merge.
- **Production authority:** A3 remains required for migration `0051` and `SHOP_OS_TICKET_CORRECTION_ENABLED=true`.

## Current product truth to preserve

- `/intake` and Quick Ticket already create one real repair order atomically with a retry key; they deliberately save one initial job, not the entire future repair order (`components/screens/write-up.tsx:343-445`, `lib/intake/counter-ticket.ts:277-337`, `components/screens/quick-ticket.tsx:308-377`).
- The repair order already mounts Build Quote in place, and the quote workspace already adds ad-hoc repair/maintenance work (`components/screens/ticket-detail.tsx:223-315`, `lib/shop-os/quotes.ts:2181-2324`).
- Quote-line create/edit/delete and canned work already share the correct active-version/link invalidation primitive (`lib/shop-os/quotes.ts:980-1056`, `lib/shop-os/canned-jobs.ts:776-822`).
- Prepared versions are immutable numbered snapshots; changed content supersedes rather than rewrites them (`lib/shop-os/quotes.ts:1612-1683`).
- The quote editor already proves actor/ticket-scoped session draft recovery, bounded age/size, exact retry identity, server-truth refresh, focus restoration, and visible confirmation (`components/screens/manual-quote-builder.tsx:192-265`, `611-768`).
- Customer, vehicle, concern, and job facts are currently read-only after creation (`components/screens/ticket-detail.tsx:361-475`).
- `ticket_activity` is append-only and idempotent, but its finite database-checked kinds do not include a truthful correction receipt (`lib/db/schema.ts:525-585`, `lib/shop-os/ticket-activity.ts`).
- Supplemental diagnostic time currently creates priced work without invalidating an active version and without a retry key (`lib/tickets.ts:1267-1365`, `components/screens/add-diagnostic-time.tsx:40-72`).
- Search failure currently renders through the same path as a real no-match and offers new-customer creation (`components/vt/intake-search/index.tsx:309-315`, `components/vt/intake-search/dropdown.tsx:216-260`).
- Slow search currently retains result rows without retaining the normalized query that produced them, so cached customer data cannot safely remain selectable after the query changes (`lib/intake/use-search.ts:30`, `70-76`).

## Product decisions

### 1. The repair order, not intake, is the complete workspace

Intake saves customer/vehicle identity, the concern, and one initial work item. The existing in-place quote workspace owns adding the second repair/maintenance job. This produces the earliest durable save and avoids rebuilding quote composition inside intake.

### 2. Identity correction is repair-order scoped

`Correct customer or vehicle` selects an existing same-shop vehicle/customer pair or resolves a new pair with the existing bounded intake rules. It updates only `tickets.customer_id` and `tickets.vehicle_id`. It does not mutate the previously linked customer or vehicle row, so another repair order's history cannot change as collateral damage.

The old unused row is not deleted or merged. Customer cleanup is separate scope.

### 3. Job correction stops at the work boundary

An advisor may change an unstarted job's title, kind, or customer-supplied-item note while preserving its assignment and required skill tier. They may remove an unstarted mistaken job only when at least one other non-canceled job remains. Removal is a history-preserving transition to `work_status = 'canceled'`, never a row delete; its `ticket_corrected` receipt keeps the target `job_id`, and the repair order renders that retained row as removed. A session, `in_progress`, `blocked`, `done`, or `canceled` state refuses correction with current truth.

### 4. Every persisted correction shares one version boundary

The mutation locks the repair order, all its jobs, all lines, and active versions in the canonical quote order, then calls `invalidateActiveQuoteVersion` before changing repair-order facts. That helper supersedes the active version, expires submitted link handoffs, and returns unpinned included jobs to `pending_quote`. Only after it succeeds may the correction write.

### 5. A truthful receipt requires migration `0051`

Reusing `ticket_reopened`, `ticket_canceled`, or a quote event would falsify history. Migration `0051_shop_os_ticket_corrections.sql` extends only the existing `ticket_activity_kind_valid` check with `ticket_corrected`. It takes a bounded `ACCESS EXCLUSIVE` table lock before exact catalog inspection so concurrent DDL cannot invalidate the guard. Raw SQL accepts only exact-old state; the ephemeral helper additionally no-ops on exact-complete state. Source and UI stay behind strict runtime flag `SHOP_OS_TICKET_CORRECTION_ENABLED === 'true'`, default OFF, so deployment is safe before migration apply.

The receipt payload is privacy-minimized:

```ts
type TicketCorrectionReceiptV1 = {
  v: 1
  scope: 'identity' | 'concern' | 'job' | 'job_removed'
  intentHash: string
  changedFields: Array<
    | 'customer_id' | 'vehicle_id' | 'concern' | 'title' | 'kind'
    | 'customer_supplied_parts_note' | 'work_status'
  >
  fromCustomerId?: string | null
  toCustomerId?: string | null
  fromVehicleId?: string | null
  toVehicleId?: string | null
  fromKind?: 'diagnostic' | 'repair' | 'maintenance'
  toKind?: 'diagnostic' | 'repair' | 'maintenance'
  invalidatedVersionId?: string | null
  invalidatedVersionNumber?: number | null
}
```

It stores no customer name, phone, email, VIN, plate, concern text, job title, or free-text note.
The generic activity writer validates this envelope before any query: unknown keys, raw text, malformed hashes/UUIDs/version pairs, non-canonical field sets, and scope/job mismatches fail closed and never enter the immutable ledger.

### 6. Recovery fixes that need no migration ship normally

- Searching, slow, and error states never expose or keyboard-trigger create-new before an authoritative response. Slow state may keep exact cached matches pickable; error becomes `Search unavailable` with Retry. Only a real `no-match` response exposes create-new.
- A slow search may expose cached matches only when their stored normalized-query provenance exactly equals the current normalized query. Changing the query immediately hides the prior rows and their customer data.
- Write-up and Quick Ticket preserve bounded actor/surface-scoped drafts for 12 hours in `sessionStorage`, including a pending submission's request identity. Corrupt, expired, wrong-actor, discarded, or successfully submitted drafts are removed.
- Supplemental diagnostic time gains a request key, a shop/ticket/actor/key-scoped deterministic job identity, same-key replay validation, full semantic validation of any active prepared snapshot, canonical quote invalidation, and exact refreshed truth. Hours accept at most two decimals to match storage. Success carries a server-derived confirmation bound to client key, deterministic job, canonical title/hours, and price; the mounted form validates it separately from the job's current lifecycle. Its transaction follows ticket → jobs → lines → active versions → sorted caller/relevant-assignee profiles → actionable links; replay locks the persisted supplemental assignee, while only new writes inherit current diagnostic assignment. The locked caller must still be an active advisor/owner and the relevant assignee must still be active in the same shop. Snapshot-validation exceptions and all `NOWAIT` contention abort transactionally as conflict; contention carries `retryable: true`. Deterministic `afterTicketLock` and `afterLinkLock` seams prove rollback without changing production behavior. A late success refreshes server truth but never clears newer typed intent.

## Correction request contract

One strict endpoint, `POST /api/tickets/[id]/corrections`, accepts exactly one correction per request.

```ts
type TicketCorrectionCommon = {
  requestKey: string
  expectedTicketUpdatedAt: string
  expectedActiveVersionId: string | null
}

type TicketCorrectionBody = TicketCorrectionCommon & (
  | {
      action: 'identity'
      selection:
        | { mode: 'existing'; vehicleId: string }
        | {
            mode: 'new'
            customer: { name: string; phone: string; email: string | null }
            vehicle: {
              year: number
              make: string
              model: string
              engine: string | null
              vin: string | null
              mileage: number | null
              plate: string | null
            }
          }
    }
  | { action: 'concern'; concern: string }
  | {
      action: 'job'
      jobId: string
      expectedJobUpdatedAt: string
      title: string
      kind: 'diagnostic' | 'repair' | 'maintenance'
      customerSuppliedPartsNote: string | null
    }
  | {
      action: 'remove_job'
      jobId: string
      expectedJobUpdatedAt: string
    }
)
```

Successful response:

```ts
type TicketCorrectionSuccess = {
  ok: true
  outcome: 'changed' | 'replayed' | 'unchanged'
  changed: boolean
  scope: 'identity' | 'concern' | 'job' | 'job_removed'
  invalidatedVersionNumber: number | null
  ticket: TicketDetail
}
```

For a new request whose normalized intent already equals current truth, `outcome` is `unchanged` and `changed` is `false`: facts, receipt, prepared version, and customer handoff remain untouched. An exact replay returns `outcome: 'replayed'` and `changed: false`, plus the original receipt's scope and invalidated version number with fresh tenant-safe `TicketDetail`. A real mutation alone returns `outcome: 'changed'` and `changed: true`. Quote-version truth is reloaded from the existing quote projection; the mutation response never hard-codes it to null.

Errors are `unavailable`, `invalid_input`, tenant-safe `not_found`, `forbidden`, `conflict`, `ticket_not_open`, `job_not_open`, and `last_job`. The route maps malformed input to 400, actual oversized bytes to 413, non-JSON media to 415, unavailable/hidden scope to 404, forbidden to 403, stale/contended/intent-mismatched work to 409, rate limit to 429, and limiter-store failure to 503. Every middleware/route response is `Cache-Control: no-store`, including shared auth/paywall responses. A 409 is recoverable and returns no cross-shop data.

## Transaction and concurrency contract

1. Fail closed on the release flag in an exact route matcher before middleware session refresh, and repeat the same shared no-store 404 inside the route before authentication, params, body parsing, rate limiting, or domain/database work. Neighboring ticket routes remain authenticated normally.
2. Parse strict UUIDs, ISO timestamps, bounded text, integer vehicle fields, and the discriminated action.
3. Start one transaction. Load the persisted actor without trusting caller-supplied shop or role; use that unlocked row only to resolve tenant scope for the locks that follow.
4. Lock the tenant-scoped ticket `FOR UPDATE NOWAIT`, then all ticket jobs by `id`, all job lines by `id`, and all active quote versions by `id`, matching the existing quote-mutation order (`lib/shop-os/quotes.ts:911-976`).
5. Lock that same actor row `FOR UPDATE NOWAIT` after the active-version locks, constrained by profile ID, the originally resolved shop ID, active membership, and null deactivation, then re-authorize advisor/owner capability. This preserves the established quote-mutation lock order and closes concurrent deactivation, demotion, or shop reassignment for both replay and new writes.
6. Deterministic seams exist immediately after version locks, after actor lock, after actionable-link lock, and before fact write; production supplies none. Only after canonical locks and reauthorization, look up `ticket_activity` by `(shop_id, request_key)`. Require `isTicketCorrectionReceiptV1(existing.payload, existing.jobId)` before trusting any replay field. Same ticket, actor, `ticket_corrected` kind, target envelope, and intent hash is `outcome: 'replayed'` even if current timestamps moved; a malformed receipt or any mismatch is conflict with no ticket projection. A replay bypasses stale/state checks, never authorization. New receipt insertion uses `ON CONFLICT DO NOTHING RETURNING`, then compares a concurrent winner without issuing a statement from an aborted PostgreSQL transaction.
7. For a new write, require the ticket to be open with exact `updated_at`, and require `expectedActiveVersionId` to equal the sole active version ID or null. More than one active version is conflict. Identity/concern corrections refuse while any non-canceled job is non-open, session-linked, in diagnostic `initializing`/`ambiguous`, or pinned by the shared quote-work predicate. Target-job correction/removal also refuses those unsafe states on its job.
8. Validate any active snapshot with the existing full semantic validator against the locked ticket identity, totals, unique jobs/lines/attachments, and bounded structure, then compare every included job and normalized line value against the locked current rows before invalidation. A schema-valid but semantically corrupt or drifted snapshot is conflict.
9. Validate the selected same-shop customer/vehicle pair or resolve the new pair inside the same transaction. Validate target-job timestamp and work/session state where applicable.
10. If normalized requested truth already equals current truth, commit no fact, receipt, version, timestamp, or handoff change and return `outcome: 'unchanged'`, `changed: false`, with refreshed truth.
11. Otherwise call `invalidateActiveQuoteVersion`; it next locks actionable links in deterministic ID order. Any unknown included job, link contention, or CAS miss aborts the entire transaction.
12. Apply the ticket/job correction, advance `tickets.updated_at` strictly beyond its prior millisecond and likewise the target job timestamp for job/remove, append the privacy-minimized receipt, and commit. Frozen-time writes still advance monotonically.
13. Before the transaction callback returns, reconstruct the actor only from the locked persisted row and reload `TicketDetail` through its tenant-safe projection on that same transaction. Reload quote-version truth through its existing tenant-safe projection before the UI confirms or settles. No PII-bearing success or replay response is returned after locked authorization has been released or from caller-supplied role/shop fields.

The enabled route lowercases and validates one ticket UUID before quota work, then uses `checkRateLimit` at the stable actor key `ticket-correction:{shopId}:{profileId}`, 20 requests per minute. Rotating attacker-selected valid ticket UUIDs therefore cannot create fresh buckets or bypass the cap. Limiter-store failure is a no-store 503 and never falls through to body or domain work. A denied bucket is a no-store 429 with `Retry-After`. The route then requires normalized media type `application/json`, rejecting missing, form, multipart, and `text/plain` bodies with no-store 415. It reads at most 8 KiB from the actual request stream through the bounded JSON helper; `Content-Length` is only an early refusal hint, never the authority.

All lock-contention failures are retryable conflicts. No unbounded wait, partial identity write, partial invalidation, or receipt-without-mutation is allowed.

## Mounted correction recovery and projection contract

- The correction draft is actor/ticket/target scoped and stores the exact normalized pending request body/signature plus request key. An ambiguous retry reuses that byte-equivalent intent. If a conflict refresh changes expected ticket/job/version truth, the UI rotates the key before submitting the refreshed intent.
- Ticket and correction-success JSON pass through strict client parsers that rehydrate timestamps and validate complete ID, job, activity, outcome, scope, and version shapes. No response is cast to `TicketDetail`, and no settle begins from partially validated data.
- `TicketActivityView` may expose only a validated correction-scope enum. A reloaded job is labeled Removed only from exact `job_removed` scope; ordinary declined or canceled work is never relabeled.
- The server page and correction domain use the same advisor/owner `canAssignWork` capability. The strict flag remains an additional UI and route requirement, never an authorization substitute.
- After both ticket and quote projections validate, `TicketDetailScreen` installs them atomically without `router.refresh()`. Local assignment/work/approval overlays reconcile to the new projection, while the confirmed rail and status persist until another correction opens or a later explicit reload.

## Draft preservation contract

`lib/intake/ticket-intake-draft.ts` owns strict versioned codecs for `write_up` and `quick_ticket`.

- Storage key: actor UUID plus surface; never email, customer text, or a global key.
- Storage: `sessionStorage` only; no localStorage, cookie, URL, log, analytics, or server upload.
- Bound: 16 KiB encoded, 12-hour age, exact schema, UUID versions 1–8.
- Contents: current form fields, selected existing vehicle ID, catalog selection IDs/fingerprints, assignment, and `{ signature, clientKey } | null` for an in-flight/ambiguous submission.
- Lifecycle: save after meaningful changes and immediately before fetch; restore once; show `Draft restored` plus `Discard draft`; warn on unload; clear on confirmed success or explicit discard.
- Privacy: never render or log raw encoded drafts. A different actor cannot restore the entry. Expired/corrupt entries are deleted.

## Finish / Correct / Recover acceptance

### Finish

At 390×844 and 1440×900, an advisor creates a diagnosis-first repair order, lands on that repair order, opens the in-place quote workspace, adds one repair job, prices it, reloads, and sees both persisted jobs and exact facts without leaving the repair order.

### Correct

- Before prepare, the advisor corrects identity, concern, and one unstarted job. Each save produces one `ticket_corrected` receipt, zero quote versions, refreshed server truth, exact focus, and one local settle.
- After preparing V1, independently correcting identity, concern, or job scope makes V1 no longer current, expires an actionable link if one exists, resets unpinned quote state to Current draft, and leaves V1's stored snapshot byte-for-byte unchanged.
- Supplemental diagnostic time added after V1 follows the same invalidation rule and an ambiguous retry creates exactly one job/line.

### Recover

- Search pending/slow/outage states never offer or keyboard-trigger new-customer creation; cached exact matches remain pickable, an outage offers Retry, and only an authoritative no-match unlocks create-new.
- Cached slow-search matches remain visible only for the exact normalized query that produced them; changing the query cannot expose or select prior customer data.
- Reload/back restores a bounded intake draft and the same ambiguous-submission request key.
- Stale timestamps, changed active version, lock contention, same-key/different-intent, started work, and last-job removal all preserve typed correction fields, re-fetch current truth, explain the actual refusal, and expose the next valid action.
- An expired prior customer link discloses no repair-order data and records no response.

## World-class interaction direction

### Subject, audience, and single job

- **Subject:** a living automotive repair order, treated as a calibrated shop instrument.
- **Audience:** an advisor working quickly at a counter or on a phone, with no tolerance for software ceremony.
- **Single job:** make the corrected fact visibly become durable truth without losing the surrounding repair order.

### Token plan

Use the existing Shop OS system exactly; no new palette or typeface:

- **Lit paper** `#FDFAF4` (`--vt-bone-50`) — readable/touchable facts.
- **Bench paper** `#F5F1EA` (`--vt-bone-100`) — the receding page around the fact.
- **Divider steel** `#D5D0C8` (`--vt-bone-300`) — rules and inset boundaries.
- **Graphite ink** `#15100D` (`--vt-bone-900`) — primary truth.
- **Blueprint signal** `#0064C3` (`--vt-signal-500`) — confirmed current truth, focus, and the settle rail.
- **Inspection amber** `#FFBB00` (`--vt-amber-400`) — stale/conflict/action-required only.

Typography remains Instrument Serif for human-readable repair-order truth, Inter Tight for compact controls/status, and JetBrains Mono for RO numbers, VINs, timestamps, and version labels (`app/globals.css:158-177`).

### Layout

Phone:

```text
┌ RO 000123 · Open ───────────────┐
│ Customer / vehicle      Correct │
│ DREW GRAMH · 2021 RAM 2500      │
│ [editor expands directly here]  │
├─────────────────────────────────┤
│ Concern                 Correct │
│ Engine ticking cold and hot     │
├─────────────────────────────────┤
│ Jobs                            │
│ Diagnostic ...          Correct │
│ Repair ...              Correct │
└─────────────────────────────────┘
```

Desktop keeps Customer and Vehicle in one combined identity target; concern owns its section; each job owns its `.jobBody`. The editor expands beneath the touched target and pushes later content down. A dedicated rail element must not reuse the job ledger-spine pseudo-element. No overlay, drawer, route change, or detached save bar.

`TicketDetailScreen` owns one discriminated open-tool union (`quote | work | correction | null`) and one typed applied projection containing target, outcome, validated ticket, validated quote truth, invalidated version, and announcement. Another mounted tool is never silently closed or discarded. Every correction target has a stable accessible name, `tabIndex={-1}`, visible focus treatment, and scroll margin.

### Signature: the detent settle

Opening is motionless and announces `Checking current repair-order truth…`; saving announces `Saving correction…`. Only after both refreshed ticket and quote truth validate:

- the inline editor collapses in place;
- for changed/replayed outcomes, the corrected block moves `translateY(-2px) → 0` and `opacity: .92 → 1` over `200ms var(--vt-ease-out)`;
- a dedicated 2px blueprint-signal rail appears at the corrected edge and persists with visible local status until another correction opens or reload;
- focus lands on that block;
- a polite live region states the exact result;
- if V1 was invalidated, the adjacent state becomes `Current draft · V1 no longer current` at the same moment.

Changed copy names the exact fact; replay says `Already saved. The repair order is current.` Removal says `Removed from active work. It remains in History.` A new unchanged no-op says `No change needed` and receives no detent or signal rail. Conflict/error keeps the editor and request identity, uses only the 2px inspection-amber rail plus exact local next action, and focuses Retry only when valid.

Reduced motion removes transform and transition entirely while retaining updated text, any truthful rail, focus, visible status, announcement, and version truth. No bounce, sparkle, gradient, confetti, generic toast-only success, or motion before dual-projection confirmation.

### Self-critique

The risk was turning Shop OS into a familiar cream-card/serif template. The correction is subject-specific: geometry follows the existing repair-order ledger, the only memorable motion is a mechanical detent, and every color/line communicates current, stale, or conflict truth. No decorative element survives.

## Verification contract

- Red domain tests for strict validation, tenant hiding, role reauthorization, idempotent replay, same-key mismatch, stale ticket/job/version, canonical lock order, malformed snapshot, link expiry, immutable snapshots, job-state freezes, last-job refusal, and transaction rollback.
- Red migration tests for the exact kind constraint, append-only receipt, partial-schema refusal, and full migration replay.
- Red component tests for local mount location, retained drafts, search-error Retry, warning copy, focus, live region, settle class, reduced motion, 44px targets, and no dead primary action.
- Split proof: ephemeral PGlite domain journeys own migration/persistence/authorization/receipt truth; a localhost-only, no-secret Vite harness mounts the real React phone/desktop surfaces for Finish, Correct, Recover, overflow, browser faults, focus, and serious/critical Axe findings. The production-backed golden-browser helper is forbidden for correction-enabled proof.
- Full eight-shard suite, TypeScript, production build, diff checks, independent static/security/runtime review, one consolidated repair wave, and exact hosted checks before merge.
- Post-merge production proof must show the correction route/UI unavailable while migration and flag remain off.

## Rollback and release

- Source rollback: revert the chunk merge; the default-off flag means no production correction rows exist before activation.
- Migration rollback, if ever needed before activation, is a separately approved forward migration—not an edit/removal of `0051` or its ledger row. With the flag OFF, it must lock the table, prove zero `ticket_corrected` rows, recreate the old constraint, verify it, and record the new migration atomically.
- Migration `0051` sets a bounded local lock timeout, takes `ACCESS EXCLUSIVE` on `ticket_activity`, and only then runs an in-migration guard that aborts before DDL unless `ticket_activity_kind_valid` exactly matches the expected old definition. Neither source nor a future activation may overwrite unexpected drift.
- Activation is not authorized by this source merge. A future decision must first approve the `0049`/`0050` dependency order and one authoritative path that records the repository migration ledger; selective raw SQL or an unrecorded connector apply is not acceptable. Only then: locked exact-state preflight → guarded `0051` → verify constraint, ledger, and append-only trigger/advisors → set the strict flag → deploy → run isolated QA Finish/Correct/Recover → leave customer-approval activation separately gated.
- Never rely on repository protection to wait for the full team gate; assert every expected hosted check is completed and successful before issuing the merge command.

## Evidence and assumptions

Facts come from source-equivalent production merge `60d1ffc`, the current-state audit, the interaction acceptance review, the active premium-interaction roadmap, and cited current code/tests. The no-migration architecture lane missed two time boxes and produced no usable verdict; Atlas independently traced the database constraint and canonical quote lock/invalidation code. The conclusion is direct source evidence: the database check cannot truthfully accept `ticket_corrected` without an additive migration.

## Task 7 release status — 2026-08-04

The migrated PGlite half and mounted phone/desktop half passed together on tested head `e22bade`: 19 focused files / 423 tests, 13 migration/replay tests, all eight local shards / 4,209 tests, TypeScript, 69 build pages, and repeated 4/4 loopback system-Chrome proof. Final static review found one Important retained-row defect; RED-first domain and mounted-UI regressions now prove that a validated older `job_removed` receipt remains projected after 21 newer activities without expanding the presentation feed or trusting raw payload scope. Focused re-review closed that finding. PR #244 merged as `3972834`; the merge tree equals the tested tree, every expected hosted check passed, and preview/production dormant proof returned health `200` plus correction no-store `404 unavailable`. Read-only production inspection confirms the pre-`0051` constraint, no `0051` ledger row, and zero correction rows. Production migration `0051` and correction activation remain untouched and separately gated.
