# Shop OS Phase-3 Quote Domain Design

**Status:** Proposed execution design for row 17. This row is source-only and does not apply migration `0028` to production.

## Outcome

Build the tenant-safe domain and thin API seams that turn mutable job-line drafts into deterministic immutable ticket quote versions and record exact-version phone/in-person decisions idempotently. Row 18 owns the manual builder UI; later rows own sends, public tokens, repair authorization, attachments, vendors, and messaging.

## Smallest viable architecture

- `lib/shop-os/quote-math.ts` owns pure integer-safe math and canonical decimal normalization.
- `lib/shop-os/quotes.ts` owns injected database handlers and exact snapshot types.
- Thin ticket quote routes authenticate, paywall-check, translate the current profile, call the handler, and map its discriminated result.
- Existing `job_lines` are the mutable current draft. `quote_versions.snapshot` is the immutable customer-facing record.
- No new table or migration is introduced. No production DDL is applied.

## Authority and privacy

- Every active supported Shop OS role may build quotes through `canBuildQuotes`.
- Only advisor or owner may record customer approval/decline through `canRecordCustomerApproval`.
- Every handler re-reads the current profile inside its transaction, derives `shopId` server-side, and collapses missing/cross-shop ticket, job, line, or version to the same not-found result.
- Draft reads and line CRUD are allowed on an open provisional `tech_quick` ticket. Version creation and decisions reject unreconciled tickets without both customer and vehicle.
- Curator/founder remains a separate content capability and never grants Shop OS quote authority by itself.

## Draft line contract

- Create requires a client-proposed UUID. An exact same-ID retry normalizes omitted labor price/rate against the line's already pinned stored rate, even if the shop default later changes; changed payload reuse conflicts.
- Strict discriminated inputs prevent field smuggling: manual part lines accept part context but no labor/order lifecycle fields; labor requires hours and accepts an optional pinned rate/explicit price but no part/vendor fields; fee accepts only description, taxable, and extended price. Row 17 writes `source=manual` and never exposes order/provider lifecycle fields.
- Exact current-state updates are no-ops. Delete returns idempotent success when the authorized ticket/job exists and the named line is already absent; cross-shop or unknown parent context still collapses to not-found.
- Mutations reject closed/canceled tickets and canceled/done jobs. They may operate on an open unreconciled provisional ticket.
- `priceCents` is the stored extended customer price. For labor, an omitted price is computed from `laborHours × line laborRateCents`, falling back to the configured shop labor rate. An explicit price remains an override.
- Parts quantity accepts at most three decimals; labor hours at most two. Cents and basis points remain within the schema's JavaScript-safe integer ranges.
- Every real draft change invalidates the sole active ticket version in the same transaction: read its explicit snapshot job IDs, supersede it once, reset every included job to `pending_quote`, and clear any approved pointer. Excluded jobs remain unchanged. A no-op retry never invalidates a version created after the original request. More than one active version is a fail-closed anomaly. With no `quote_sends` table yet, send revocation remains a later-row responsibility.

## Deterministic math

All arithmetic uses integers or canonical scaled integers; floating-point multiplication is forbidden.

```text
each line extended cents
  ├── explicit stored price → use exact cents
  └── labor price omitted → labor hundredths × rate cents, half-up to cents

ticket totals
  ├── subtotal = sum every extended line once
  ├── taxable subtotal = sum taxable extended lines once
  ├── tax = half-up(taxable subtotal × tax bps / 10,000)
  └── total = subtotal + tax
```

Decimals parse into scaled `bigint`. Labor uses `(hoursHundredths * rateCents + 50n) / 100n`; tax uses `(taxableSubtotal * taxBps + 5000n) / 10000n`. BigInt numerators may exceed `Number.MAX_SAFE_INTEGER`; validated inputs and every persisted/output cents value, subtotal, tax, and total must be safe before conversion to `number`. Tests pin half-cent boundaries, zero tax, maximum safe outputs, a valid above-safe numerator, multiple taxable lines, precision rejection, and labor-rate fallback/override behavior.

## Canonical immutable snapshot

`QuoteSnapshotV1` is deterministic and JSON-stable:

- schema version, ticket ID/number, customer ID, vehicle ID, and configured shop rate/tax inputs;
- jobs ordered by persisted creation time then ID;
- each job's title/kind/story plus lines ordered by `sort`, creation time, then ID;
- line input fields, canonical decimal strings, extended cents, and source/vendor context already stored on the line;
- attachments ordered by creation time then ID and limited to stable ID/job/kind metadata, never storage credentials or signed URLs;
- per-job totals and ticket totals.

Snapshot content identity contains stable quote inputs only; actor and timestamps remain in `quote_versions` columns. JSON objects are recursively key-canonicalized, line IDs are immutable snapshot line keys, and array order follows the persisted tie-breakers above. The included set is every non-canceled ticket job with at least one persisted line; an empty quote is rejected and excluded jobs remain untouched.

Creating a version locks the ticket and dependent rows, rechecks authority/reconciliation, validates every snapshot field, and loads all prior versions. More than one active version fails closed. An exact canonical match against the sole active version returns it. Otherwise the handler supersedes that active row if present, allocates `max(versionNumber) + 1`, inserts the new snapshot, and sets only included jobs to `quote_ready` without approving them. The unique version constraint remains a backstop.

## Exact-version decisions

Phone/in-person input is discriminated: approval requires `{ requestKey, jobId, quoteVersionId, decision: 'approved', approvedVia: 'phone'|'in_person' }`; decline requires the same IDs with `decision: 'declined'` and forbids `approvedVia`.

- Only `approved|declined` and `phone|in_person` are accepted here; page approval belongs to the future public-token row.
- The transaction locks and rechecks the ticket, job, version, and actor. The version must be current, same-shop, same-ticket, and contain the named job.
- After current actor authorization, an identical request-key retry—including the persisted actor ID—returns the existing event before stale-version checks, so an ambiguous successful response remains recoverable. Reuse with any changed field or actor conflicts.
- Approval appends the exact-version event and sets the job to `approved` with that version in one transaction.
- Decline appends the exact-version event, sets `declined`, and clears the approved pointer in the same transaction.
- A new actor-authorized request key may append the opposite decision on the same current version while row 17 has no work-execution path. Ticket/job locks serialize it and the projection follows the latest committed event; exact same-key retries remain idempotent. Row 22 must prohibit revocation after repair/work execution begins. No request may directly repoint or clear the projection outside decision/invalidation. Negative tests preserve the row-16 security finding as an executable row-17 contract.

## Builder read seam

One tenant-safe read model/GET route returns only row-18 builder inputs: ticket reconciliation/open state, shop rate/tax configuration state, eligible jobs, strict manual line fields, and the current active version summary. It never returns storage keys, vendor snapshots, event bodies, internal profile data, or mutable projection controls.

## Concurrency and rollback

- Quote mutations lock the tenant ticket first, then dependent jobs/lines/versions in stable ID order with `FOR UPDATE NOWAIT`. If any later row is held—including a diagnostic job locked by the existing job→ticket finalize path—the quote transaction immediately rolls back and returns a retryable 409; it never waits while holding the ticket. A held-diagnostic-job regression must cover draft mutation, version creation, and decision recording. Add-job already serializes on the ticket lock.
- Version-number uniqueness and request-key uniqueness are database backstops, not substitutes for transaction serialization.
- Before merge, branch revert is safe. After production data exists, rewriting/deleting versions or events remains a destructive owner gate. This row performs no live rollback or apply.

## Scope exclusions

No UI, canned-job application, story AI, upload/storage mutation, quote sends/tokens, SMS, vendor lookup/order, repair mutation, simple-work start, ticket closeout, production migration, diagnostic prompt/retrieval/tree change, or feature enablement.
