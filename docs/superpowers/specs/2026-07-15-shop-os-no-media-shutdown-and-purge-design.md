# ShopOS No-Media Shutdown and Purge Design

**Date:** 2026-07-15
**Status:** Founder-authorized outcome; control-lane design approved under explicit autonomous delegation
**Sequence:** Complete this no-media shutdown before Bay Pulse changes any technician surface

## Outcome

Vyntechs accepts, stores, serves, or requires no uploaded operational media at
this time. Existing uploaded media is permanently purged after every ingress is
closed and protected ShopOS records are proved unchanged.

The product remains useful through structured status, short text notes, numeric
measurements, and other non-file data. A later Evidence Vault may restore media
through a separately approved, disabled-by-default release backed by
shop-owned storage. Nothing in this design pre-builds that future system.

## Founder decisions

The founder explicitly decided:

1. Bay Pulse is the first smaller ShopOS wedge.
2. Vyntechs will have no photos anywhere at this time.
3. The storage-cost concern applies to uploaded media generally, not only Bay
   Pulse photographs.
4. Existing uploaded media should be permanently purged.
5. Users, jobs, notes, statuses, and other non-media operating history must be
   preserved.
6. The control lane may choose reversible implementation details and continue
   autonomously; an unexpected live-data dependency or an irreversible action
   outside this exact purge remains a stop gate.

## Definition of media

This design disables and purges uploaded or captured files used as operational
evidence:

- photographs;
- videos;
- audio recordings;
- scan-tool screen captures;
- wiring-diagram captures; and
- uploaded documents or text files.

This design does not remove static application assets such as the Vyntechs
logo, icons, fonts, or the public application shell. It also does not remove
structured text notes, measurements, status changes, timestamps, event logs,
or structured ambient-condition values that do not create a stored file.

## Current reality

All operational media bytes use the private Supabase `artifacts` bucket.
Diagnostic metadata lives in `artifacts`; ShopOS work-proof metadata lives in
`job_attachments`. Both paths use the same storage client.

The current system has two active server ingress paths:

- authenticated diagnostic capture, accepting photo, video, audio, scan-screen,
  and wiring-diagram media; and
- authenticated simple-work attachments, accepting photo, video, PDF, and text
  files.

The simple-work domain currently requires a note and a qualifying technician
photo before work can become `done`. Job-attachment IDs may be copied into
immutable quote snapshots. Diagnostic artifact IDs may be copied into customer
stories and then into immutable quote snapshots. Removing bytes alone would
therefore create false proof and dangling live behavior.

## Relationship to the active plans

This design does not replace the ShopOS status table in
`docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`. Its implementation
plan must add one bounded no-media row with explicit ownership, dependencies,
allowed paths, verification, rollback, and the separate production-purge gate.

The no-media release touches diagnostic availability and paths previously
coordinated with the AutoEYE lane. Before shared-seam code changes begin, the
controller appends one coordination Log entry naming the intended paths and
the global-off outcome. AutoEYE retrieval, receipt, benchmark, and API work
continues separately and is not deleted, merged, or modified by this design.

## Considered approaches

### Selected: shut down, prove, then purge

First deploy code that closes every media ingress and removes every media
requirement. Then run a read-only production preflight, purge bytes and media
rows, and prove protected operating records are unchanged.

This prevents new uploads from racing with deletion and makes every cleanup
step idempotently retryable.

### Rejected: purge before shutdown

An upload could land between bucket enumeration and the final delete. Existing
UI and completion logic could also claim proof that no longer exists.

### Rejected: disable new uploads but retain existing media

This leaves current storage usage and does not satisfy the founder's explicit
purge decision.

## Selected architecture

```text
Wave A — reversible no-media release
│
├── Server policy rejects every media upload
├── Media UI is absent on every screen size
├── Simple work completes from truthful text, not a photo
├── New stories and quotes cannot add media references
└── Legacy business history remains readable without serving media
    │
    ▼
Wave B — read-only production preflight
│
├── Inventory both media tables and the private bucket
├── Detect referenced rows, orphan rows, and orphan objects
├── Fingerprint protected operating records
└── Abort on any unclassified dependency or incomplete read
    │
    ▼
Wave C — founder-authorized permanent purge
│
├── Re-prove media ingress is closed
├── Delete every object from the operational-media bucket
├── Verify the bucket contains zero objects
├── Delete every artifacts and job_attachments row
└── Prove media zero and protected records unchanged
```

### One fail-closed media policy

The server owns one small policy that resolves operational media to `off`.
Missing, malformed, or unknown configuration also resolves to `off`. No
browser state, shop role, query parameter, or client feature flag can enable
media.

Operational media supports only `off`; it does not name or implement a future
provider. Re-enabling media requires a new reviewed release, an explicit
storage owner, and a production gate.

Every media route checks the server policy before parsing a multipart body,
reading bytes, contacting storage, inserting metadata, or starting extraction.
Disabled routes return one indistinguishable not-available response and never
reveal whether a session, job, attachment, or artifact exists.

### UI boundary

The release removes or does not render:

- simple-work `Take proof photo` and `Add file` controls;
- simple-work proof lists and proof download links;
- diagnostic camera, audio, and video capture controls;
- confidence-gap media capture; and
- any copy claiming a photo is needed or attached.

There is no disabled camera placeholder, upsell, empty gallery, or future-media
teaser. Mobile, tablet, desktop, keyboard, and direct-URL behavior are tested.
Marketing FAQ, Terms, and Privacy source copy are reconciled in the same
reversible release so Vyntechs no longer promises capture or says it currently
collects uploaded files. Historical or legally required descriptions are
retained only when they remain factually necessary; no public copy claims that
third-party temporary processing or infrastructure backups were purged.

### Simple-work completion

Simple work remains authorized and tenant-bound exactly as today. Completion
requires:

1. the job is assigned to the acting technician;
2. the pinned customer approval remains valid;
3. the work is `in_progress`;
4. the technician has saved a non-empty short work note; and
5. the optimistic-concurrency timestamp still matches server truth.

A photo or attachment is not queried, projected, or required. Existing `done`
jobs remain `done`; the purge does not reopen work or fabricate a replacement
proof state.

### New quote and story behavior

New quote snapshots always emit an empty attachment array for compatibility
with the current version-1 schema. New customer-story generation and review
cannot select artifact evidence and persist no new `sourceArtifactIds`.
Event-backed and manual text evidence remain available.

The product does not rewrite immutable historical quote snapshots. A legacy
snapshot may retain an inert attachment or artifact UUID as part of its
byte-stable business record, but no file, media row, download route, or UI
affordance remains behind that UUID. These inert IDs are not media and carry
no object key, filename, customer content, or retrievable bytes.

Mutable current customer stories that reference a purged artifact remain text
history but cannot be reused as newly verified artifact evidence. The purge
does not silently rewrite their claims. Any later quote preparation must use
current non-media evidence or explicit human-reviewed text.

### Diagnostic boundary

Diagnostics remains unavailable in the ShopOS release direction already set
by the founder. `DIAGNOSTICS_RELEASE` recognizes `off` and the existing
`legacy` engine; missing or unknown values fail to `off`, production is
hard-off in code, and using `legacy` outside local/test verification requires
a new reviewed code release and production gate. This global release gate
resolves before shop entitlement or comp status is considered, so neither a
grandfathered nor comped shop can enter a diagnostic surface while it is off.
Direct media capture and every `/api/artifacts/*` extraction route fail closed
before body parsing, storage download, or an external extraction call, even if
a stale link or client calls them.

The no-media release does not change diagnostic reasoning, risk thresholds,
topology semantics, retrieval, corpus, AutoEYE contracts, or historical text
events. Ambient conditions remain allowed only when represented as structured
non-file data. Existing diagnostic sessions are not deleted or closed by this
design; they remain inaccessible while the global diagnostic release is off.

The signed-in Counter intake at `/intake` is core ShopOS work-order creation,
not the diagnostic engine. It and its customer-search and VIN-decode helpers
remain available. Only diagnostic session creation and navigation are closed;
an owner can still create a repair order and a technician can still record
manual findings without invoking diagnostic generation or a media path.

## Production preflight

The preflight is read-only and produces no media content, filenames, user
emails, customer descriptions, storage credentials, or signed URLs in logs or
committed artifacts.

The control lane does not create a backup copy of media before deletion. Only
aggregate counts and non-reversible preservation proof survive the purge.

It must prove:

1. the exact private buckets present and which one contains operational media;
2. row counts and total declared bytes for `artifacts` and `job_attachments`;
3. object count and total object bytes for the operational-media bucket;
4. the sets of row-backed objects, orphan objects, and rows whose objects are
   already missing;
5. whether media IDs appear in mutable customer stories or immutable quote
   snapshots;
6. whether any open session or active job currently references a media row;
7. that no second ingress or external provider exists; and
8. preservation fingerprints for the protected record set.

The preflight aborts if any database query, bucket page, pagination cursor,
authorization check, or final reconciliation is incomplete. It never labels a
record as test data from a name, email, vehicle, or description.

## Permanent purge procedure

The purge begins only after the no-media release is deployed and production
smoke proof shows both upload APIs plus every extraction API reject before
reading or downloading bytes. Because the longest current media route has a
60-second execution limit, wait 120 seconds after the verified deployment,
then require two identical complete bucket-and-row inventories 60 seconds
apart. Any drift restarts the drain and inventory sequence.

1. Repeat the complete preflight immediately before deletion.
2. Enumerate the union of every bucket object and every storage key referenced
   by either media table.
3. Delete bucket objects in bounded retryable batches.
4. Re-enumerate the bucket from the beginning; require zero objects, then
   remove the empty `artifacts` bucket.
5. Prove the bucket is absent and cannot accept an upload.
6. Treat bucket removal as the definitive storage-write barrier. Wait another
   120 seconds, then require two identical row inventories 60 seconds apart.
   Any late `artifacts` or `job_attachments` row restarts this drain and row
   inventory sequence.
7. In one database transaction, acquire write-blocking locks on the bucket and
   object catalogs plus both media tables, re-prove the bucket absent and
   object count zero, delete all rows from `artifacts` and `job_attachments`,
   then repeat the absence/zero checks immediately before commit.
8. Require both media tables to contain zero rows after commit.
9. Inside the serializable deletion transaction, fingerprint every classified
   protected table immediately before and after the two deletes and require
   byte-for-byte equality. This in-transaction comparison is authoritative;
   final live verification does not misclassify unrelated post-commit shop
   activity as purge damage.
10. Run product smoke proof for simple-work completion, historical quote
   reading, direct media-route refusal, and authenticated application health.

If object deletion partially fails, no media rows are deleted; the operation
is safely rerun from a fresh enumeration. If the object purge succeeds but the
database transaction fails, media remains unavailable and the row deletion is
retried after a fresh zero-object and preservation preflight. The UI never
claims missing media still exists. A late media row after bucket removal cannot
reference retrievable bytes; it is still treated as a race signal, not ignored
or certified, and must be drained before the final row deletion.

The empty media tables remain for legacy schema and immutable-history
compatibility. The canonical fresh-project bootstrap no longer creates the
`artifacts` bucket, so a new environment is media-free by construction.
Dropping the tables adds unnecessary migration risk without reducing stored
bytes. A future Evidence Vault must use a newly approved bootstrap and must
not reuse these dormant writers without a new data-ownership design.

## Protected records

The purge may delete only storage objects and rows in the two media tables.
It must preserve:

- authentication identities;
- shops, profiles, memberships, and roles;
- customers and vehicles;
- tickets and ticket numbering;
- jobs, assignment, approval, work status, and work notes;
- session status, tree state, and non-media session events;
- job lines, canned jobs, supplier data, and quote events;
- quote versions and their immutable snapshots;
- messaging consent, retention, deletion, and suppression records; and
- entitlement and billing records.

No migration may cascade from a media row into a protected record. The plan
must classify every current public table, fingerprint every non-media public
table plus authentication identities, and fail closed on an unclassified
catalog entry. It must prove the actual production constraints before deletion
rather than rely only on source schema.

## Security and privacy

- Authorization and tenant checks remain on disabled routes so the response
  cannot become an existence oracle.
- Multipart bodies are rejected before buffering.
- No media content is downloaded for preflight or verification.
- No signed URLs are created.
- Logs contain bounded counts, aggregate manifest hashes, and keyed HMAC-SHA-256
  preservation fingerprints only; the per-run key remains environment-only.
- Service-worker and browser caches continue to exclude authenticated media.
- Secrets, customer content, object keys, and personal identifiers never enter
  Git, task reports, screenshots, or test fixtures.
- Production credentials live only inside a dedicated operator child process
  with exit/signal cleanup; an interrupted run preserves aggregate recovery
  state but no long-lived shell credentials.
- The purge claims deletion only from Vyntechs-controlled object storage and
  media tables. It does not claim deletion from an external AI provider's
  temporary processing systems or infrastructure backups without separate
  contract evidence.

## Verification

### Reversible release proof

- every media UI control is absent at representative mobile, tablet, desktop,
  keyboard-only, and reduced-motion settings;
- both upload endpoints reject before parsing or storage access;
- direct download and extraction routes fail closed;
- global diagnostics stays off for paid, grandfathered, and comped shops;
- a simple repair or maintenance job completes with an authorized short note
  and no attachment;
- no new quote or customer story can persist a media reference;
- legacy quote snapshots still parse and render their non-media content;
- focused route, domain, UI, quote, story, privacy, and service-worker tests
  pass; and
- the complete test suite, TypeScript check, production build, and diff review
  pass.

### Production purge proof

- operational-media bucket object count equals zero;
- the operational-media bucket is absent and cannot accept uploads;
- `artifacts` row count equals zero;
- `job_attachments` row count equals zero;
- repeated enumeration finds no late or orphan object;
- both upload APIs and every extraction API still reject before bytes after
  purge;
- protected-record fingerprints match the preflight;
- simple-work text-only completion succeeds;
- historical quote non-media content remains readable; and
- application health, authentication boundary, and deployment logs are clean.

## Rollback and stop conditions

The no-media code release is Git-revert-able. The media deletion is
intentionally irreversible and was explicitly authorized by the founder.

Stop before any deletion if:

- the no-media code is not deployed and production-proved;
- the actual production schema differs from the expected purge boundary;
- a database constraint can cascade into a protected record;
- complete bucket enumeration cannot be proved;
- an object exists outside the approved operational-media boundary;
- deletion would require rewriting an immutable quote snapshot;
- the protected-record fingerprint cannot be reproduced; or
- the purge would touch money, external publication, another product's data,
  or any live-data category not explicitly covered by the founder's decision.

Any stop produces one concise exception report and leaves the purge closed. It
does not transfer investigation, retries, or routine monitoring to the
founder.

## Bay Pulse handoff

After the reversible no-media release is verified, Bay Pulse may proceed as a
separate design and implementation plan. It consumes only existing job and
repair-order truth plus a small status/note contract. It does not wait for the
production purge if code and test fixtures already prove zero media
dependency, but the purge must complete before claiming the product has no
stored media.
