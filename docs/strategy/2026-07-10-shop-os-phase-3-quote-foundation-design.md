# Shop OS Phase-3 Quote Foundation Schema Design

**Status:** Approved as row 16 of the Shop OS phased plan. Source and local migration proof only; production application remains an owner gate.

## Outcome

Add the relational foundation required for manual quote building, immutable approvals, canned simple work, and evidence-bound stories without implementing handlers, UI, customer sends, vendor transport, or repair authorization.

## Chosen approach

Ship one additive source migration and matching Drizzle declarations:

- Add safe shop defaults for `laborRateCents` and `taxRateBps`.
- Add `customerStory`, `storyMeta`, and `approvedQuoteVersionId` to ticket jobs.
- Add shop-scoped `job_attachments`, `job_lines`, `canned_jobs`, `quote_versions`, and `quote_events`.
- Add composite uniqueness to existing ticket jobs so every child can enforce the same shop and, where relevant, the same ticket.
- Keep public-schema access server-only with RLS, revoked direct-client DML, deny-all direct policies, and service-role grants.
- Enforce append-only quote events and immutable quote-version content in SQL. A quote version may only transition `supersededAt` from null to one timestamp; its snapshot never changes.

The repository's Drizzle snapshot chain contains a known malformed historical snapshot, so row 16 follows the established hand-written SQL plus journal-entry pattern used by rows 5 and 8. Nothing runs against production.

## Money and quantity representation

- Customer prices, costs, core charges, and labor rates are integer cents stored as bigint/number and constrained non-negative.
- Tax is basis points constrained to `0..10_000`.
- Parts quantity is `numeric(12,3)` and labor hours is `numeric(8,2)`, matching the approved precision contract without floating-point storage.
- `priceCents` is the extended customer price. Quantity and hours/rate remain pinned context for later deterministic quote math.
- Existing shops receive zero rate/tax defaults. Later settings and quote handlers must require deliberate configuration where zero is not a valid business choice; this migration invents no shop price.

## Table boundaries

### Job attachments

Stores job-owned storage metadata only: shop, job, storage key, kind, MIME type, byte size, uploader, and creation time. `(shopId, jobId)` and `(shopId, uploadedByProfileId)` are enforced. Storage keys are unique per shop. No upload handler or bucket mutation is included.

### Job lines

Stores manual quote inputs and future vendor snapshots: kind (`part|labor|fee`), description, sort, quantity, extended price, taxable flag, optional part/vendor context, optional labor context, part status, lifecycle actors/timestamps, and source (`manual|vendor_offer|diagnosis_seed|guide`). Every line belongs to a same-shop job. Future `vendorAccountId` and external offer values remain nullable identifiers with no premature foreign key to the row-27 table.

### Canned jobs

Stores shallow same-shop repair/maintenance templates with default tier, JSON default lines, sort, and retirement timestamp. No nesting, vehicle matrix, inventory, or handler is added.

### Quote versions

Stores one immutable JSON snapshot per `(shopId, ticketId, versionNumber)`, creator, creation time, and optional supersession time. Composite uniqueness supports exact-version references from jobs/events. The snapshot shape is intentionally opaque at the schema row; row 17 owns its validated typed contract and deterministic totals.

### Quote events

Stores append-only exact-version audit events with same-shop ticket/version, optional same-ticket job, future nullable send ID, event kind, optional actor/approval channel, tenant-unique request key, tenant-unique non-null provider event ID, body, user agent, and creation time. Approval events require `approvedVia`; non-approval events forbid it. IP is not stored.

## Integrity and security

- Every new tenant-owned table carries `shopId` and a composite same-shop parent foreign key.
- Job/event references cannot cross tickets; approved job versions cannot reference another ticket's version.
- Non-negative/precision/range checks reject malformed money, quantity, byte, sort, tier, and version inputs.
- Quote events reject update/delete. Quote versions reject delete and all updates except one null-to-timestamp supersession.
- No raw public token, phone, credential, secret, IP address, provider transport, or production data is introduced.

## Alternatives rejected

- **JSON-only quote blob on tickets:** cannot enforce version identity, line ownership, or append-only approval history.
- **Handlers before schema:** would duplicate validation around an unstable persistence contract.
- **Include sends/vendors now:** crosses row ownership and external-gate boundaries.
- **Apply production migration now:** explicitly outside this source lane and requires separate approval.

## Verification

- Schema tests inspect Drizzle declarations and exact table/column contracts.
- PGlite applies the full source migration chain, then proves defaults, composite tenant/ticket foreign keys, money/precision checks, RLS/policies/grants, event append-only behavior, and quote-version immutability.
- Focused tests, full suite, TypeScript, production build, diff audit, task reviews, and whole-branch review must pass before merge.

## Scope exclusions

No production migration, Supabase advisor claim, quote math/CRUD, version creation handler, story generation, canned-job UI, attachment upload, approval UI, quote send/token, vendor account, SMS, repair mutation, diagnostic-engine change, or feature enablement.
