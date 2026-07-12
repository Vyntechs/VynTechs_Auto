# Shop OS Row 23 — Simple Work, Attachments, and Escalation Handler Design

**Date:** 2026-07-11
**Status:** Approved-plan execution design
**Source:** Row 23 in `2026-07-10-shop-os-spec-and-phased-plan.md`

## Outcome

Add the server contract that lets an assigned technician perform approved repair or maintenance work, save one bounded work note, attach proof, complete the job, or open a separate diagnostic concern without invoking AI. Row 24 owns every new technician UI surface.

## Scope boundary

Row 23 changes handlers, thin authenticated routes, storage helpers, tests, and durable plan state only.

It does not add or alter:

- database schema or migrations;
- production data or feature flags;
- diagnostic sessions, prompts, topology, wizard, gates, retrieval, corpus, or AI calls;
- quote math, story generation, decision recording, parts ordering, messaging, or delivery. The one narrow quote lifecycle correction preserves already-started/completed simple-work approval provenance and excludes that historical scope from later authorization totals;
- technician UI, which remains row 24.

## Product contract

### Simple work

A repair or maintenance job is actionable only when all current persisted truth agrees:

- the ticket is open and belongs to the actor's shop;
- the job is repair or maintenance, has no diagnostic session, and is assigned to the active actor;
- the job projection is `approved` with one non-null approved quote version;
- before start, that version is the ticket's single active immutable version; after start, it remains the job's pinned immutable approval even if later ticket work supersedes the active quote;
- the pinned snapshot contains this exact job ID and persisted job kind;
- the latest decision event for this job and version is `approved`;
- the actor still has an active, non-deactivated shop role.

Start moves `open → in_progress` only from the current active approved version. Existing quote invalidation/version code is narrowed so later ticket quote work preserves the pinned approval fields for an `in_progress` or `done` repair or maintenance job, while line/canned/story mutation of that started job itself remains blocked. Subsequent note, attachment, completion, done replay, and history reads retain the pinned version, matching approval event, and exact snapshot job even when that version is superseded.

Later quote snapshots exclude `in_progress` and `done` repair/maintenance jobs: their scope and totals remain historical in the pinned superseded version and are never re-presented for customer authorization. Open/blocked simple work and in-progress diagnostic jobs retain their existing quote behavior. This keeps authorized scope immutable without double-counting completed/active work, stranding it, or blocking a newly escalated diagnostic job from being quoted.

A start retry against the actor's already-started job returns the same safe state without another write. Workspace results include `updatedAt`; note and completion bodies carry `expectedUpdatedAt`. Saving the same trimmed note is a no-op, while a delayed different note or completion against a newer row returns conflict instead of overwriting current truth. Completion moves `in_progress → done` only after at least one non-empty work note and one Row-23 work-proof photo uploaded by the assigned actor exist. A lost completion response replay returns the already-`done` state without requiring approval to become current again.

Every mutating action rechecks authorization under ticket-first `NOWAIT` locks. If approval changes, assignment changes, the ticket closes, or another writer holds the contract rows, the action fails before mutation with a retryable conflict where appropriate.

The workspace read is deliberately less restrictive than mutation: the active assigned actor may reopen safe metadata for their own `open`, `in_progress`, or `done` simple job, including completed history. One read-only repeatable-read transaction projects job, approval, and attachment metadata consistently but does not treat a read as permission to mutate. Cross-shop, unassigned, canceled, and inactive-actor reads remain unavailable.

### Attachments

An assigned actor may attach proof only while approved simple work is in progress. The route accepts bounded multipart bytes and a strict kind/MIME pair:

- photo: JPEG, PNG, or WebP;
- video: MP4 or WebM;
- document: PDF or plain text.

Job proof uses a 4 MiB file ceiling so the complete multipart request remains below Vercel Functions' current 4.5 MB request limit. The route rejects an excessive `Content-Length` before `request.formData()`; Vercel's platform cap remains the outer bound for chunked requests. This intentionally differs from the older 25 MB session-artifact constant rather than advertising an upload size production cannot accept. See [Vercel Functions limits](https://vercel.com/docs/functions/limitations#request-body-size).

The client supplies a UUID request key. The server derives the attachment ID from shop + job + actor + request key, and derives the private object path from that identity plus a SHA-256 content digest. The persisted storage path therefore proves exact retry bytes without a new column. A retry matches attachment ID, job, uploader, kind, canonical MIME, size, and derived digest path; any mismatch is a conflict.

Upload happens outside database locks and uses idempotent upsert only at the content-bound deterministic path. Authorization is checked before upload and again under the final transaction. If the final check or insert fails after upload, a best-effort compensating delete removes the object; cleanup failure is logged without exposing the path. Retrying the same bytes safely replaces the same orphan and can finalize, so failed cleanup does not permanently strand the request.

The handler canonicalizes MIME and verifies magic bytes: JPEG/PNG/WebP, MP4/WebM, PDF, or fatal UTF-8 plain text. `File.type` alone is never authority. Completion counts only a photo created through this job-proof handler, whose server-owned path convention, uploader, and in-progress-only insertion distinguish it from earlier quote/reference attachments without a schema change.

Attachment reads use a separate authenticated handler that validates an active same-shop shop role and the attachment's ticket/job relationship, rejects persisted byte-size/MIME metadata outside the Row-23 contract before storage access, then downloads and rechecks actual byte length before proxying the ≤4 MiB private object with its canonical content type, `nosniff`, and bounded private cache headers. It returns neither a raw path nor a signed URL containing that path. Read access does not depend on a still-active quote approval, so legitimate completed history remains viewable after later quote versions or ticket closure.

### Found-another-concern escalation

While approved simple work is in progress, the assigned actor may record a bounded concern and required skill tier. The handler creates one separate, unassigned diagnostic job on the same open ticket:

- ID is deterministically derived from shop + ticket + source job + actor + UUID request key for retry-safe, source-bound creation;
- title is `Diagnose: <concern>`;
- `workStatus = open`;
- `approvalState = pending_quote`;
- `sessionId = null` and `assignedTechId = null`.

It does not start a diagnosis, call a provider, infer urgency, alter the source job, or claim customer authorization. Replaying the same request recomputes the source-bound ID and returns the same job only when its persisted shape matches exactly; a collision fails closed and a request from another source job or actor derives a different ID.

Adding the diagnostic concern does not rewrite an existing immutable quote version. The new job remains independently locked until quoted and approved through the existing contract.

## API surface

- `GET /api/tickets/:ticketId/jobs/:jobId/work` — privacy-minimized technician workspace.
- `POST /api/tickets/:ticketId/jobs/:jobId/work` — strict `start`, `save_note`, or `complete` action.
- `POST /api/tickets/:ticketId/jobs/:jobId/attachments` — bounded multipart upload.
- `GET /api/tickets/:ticketId/jobs/:jobId/attachments/:attachmentId` — authenticated private proof proxy.
- `POST /api/tickets/:ticketId/jobs/:jobId/escalations` — retry-safe diagnostic concern creation.

All routes authenticate, apply the existing paywall, delegate to `lib/`, map bounded domain errors, and contain no business logic.

## Locking and concurrency

The mutation lock order is:

1. ticket;
2. all ticket jobs ordered by ID;
3. ticket quote versions ordered by ID;
4. active actor profile;
5. target attachment rows ordered by ID when needed.

Quote decisions already acquire ticket and job/version locks before appending events, so decision truth cannot change while this transaction holds the parent locks. No storage or signing call runs inside a database transaction.

## Honest failure states

Public results stay bounded to `invalid_input`, `not_found`, `not_authorized`, `not_ready`, and `conflict`; retryable lock/unique races carry a retry hint. Notes are trimmed 1–2,000 characters, concerns are trimmed 5–500 characters, proof downloads use a 60-second private cache ceiling, and every MIME value is canonicalized to its base lower-case form. Cross-shop, inactive, reassigned, malformed snapshot, stale decision, and identity-collision cases do not reveal which internal fact failed.

## Verification

- Red/green PGlite handler tests for authorization, pinned approval through in-progress/done quote invalidation, exclusion of historical simple-work totals from later versions, exact snapshot kind, completion replay/history, optimistic note concurrency, transitions, tenant isolation, retry identity, attachment cleanup recovery, and source-bound escalation shape.
- Thin-route tests for auth, paywall, strict bodies, pre-buffer request limits, byte/MIME validation, proxy headers, status mapping, and no leaked storage paths.
- Quote-decision and Row 22 authorization regressions remain green.
- Full test suite, TypeScript, production build, clean diff, and independent whole-branch review.

## Rollback

Revert the Row 23 source commit(s). No migration, data backfill, flag, or external account rollback is required. Existing disabled simple-work UI remains safe until row 24 ships.
