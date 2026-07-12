# Shop OS Row 31 — Messaging Retention and Deletion Design

## Outcome

Create the smallest enforceable data foundation for optional transactional repair messaging. Vyntechs keeps enough privacy-minimized evidence to prove consent and honor revocation, while deleting ordinary delivery data and internal notifications on deterministic schedules.

This design is owner-approved product direction. It is not legal advice, does not claim counsel review, and does not authorize a production migration, provider account, credential, spend, public-policy publication, or customer message.

## Owner-approved policy

The governing principle is:

> Delete the conversation; preserve the minimum proof and suppression signal.

The approved posture is balanced:

- consent and revocation proof: five years;
- provider delivery metadata: twelve months;
- internal notifications and deduplication: ninety days;
- deleted backup copies: age out within the existing published ninety-day backup window; and
- no retention period restores consent after it expires.

Consent remains optional. Phone and in-person approval stay complete. A technician who only diagnoses or performs requested work encounters no consent task, warning, or blocking step.

## Current authority and external baseline

Row 25 remains the authority for program scope, disclosure language, consent capture, reasonable revocation, sender identification, and STOP/HELP behavior. Row 31 turns only its consent-proof, suppression, retention, and deletion contract into an implementable data boundary.

Checked July 12, 2026:

- Twilio requires proof of consent, including date and capture method, for as long as legally required and at least until withdrawal.
- FCC rules require reasonable revocation methods to be honored. Certain do-not-call records must be honored for five years; Vyntechs adopts five years as its conservative privacy-minimized suppression window even though V1 is transactional rather than marketing.
- The general federal limitations period for civil actions arising under federal law is four years unless another law provides otherwise. The selected five-year proof window exceeds that general floor without becoming indefinite.
- California requires collection, use, and retention to remain reasonably necessary and proportionate. Verified deletion may preserve narrowly limited information for legal compliance or claims, but not ordinary use.

Primary references:

- [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy)
- [Twilio Consent Management API](https://www.twilio.com/docs/messaging/features/consent-api)
- [47 CFR § 64.1200](https://www.law.cornell.edu/cfr/text/47/64.1200)
- [FCC revocation effective-date notice](https://docs.fcc.gov/public/attachments/DA-24-1068A1_Rcd.pdf)
- [28 USC § 1658](https://uscode.house.gov/view.xhtml?edition=prelim&f=treesort&jumpTo=true&num=0&req=%28title%3A28+section%3A1658+edition%3Aprelim%29+OR+%28granuleid%3AUSC-prelim-title28-section1658%29)
- [California Civil Code §§ 1798.100–1798.199.100](https://www.leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=&chapter=&division=3.&lawCode=CIV&part=4.&title=1.81.5.)

Carrier, provider, privacy, and legal requirements can change. Row 35 must re-check provider and FCC behavior before implementation, and production messaging still requires final published policy review, ideally by qualified counsel.

## Scope

### Included in Row 31

- source-controlled schema and migration;
- append-only consent history and a derived current-state projection;
- shop-wide destination suppression that duplicate customer rows cannot bypass;
- quote-send, redacted delivery, notification, compliance-tombstone, and retention-hold records;
- shared deterministic retention-clock calculations;
- one retry-safe internal deletion workflow with a durable suppression gate;
- one bounded automatic purge worker;
- privacy-safe operational audit counts;
- local migration, tenant-isolation, permission, lifecycle, race, and failure-path tests; and
- a separate owner gate before any production migration apply.

### Explicitly excluded

- provider selection, registration, credentials, sender purchase, or spend;
- real message sending or receiving;
- public approval links, customer-facing consent UI, or customer-facing deletion UI;
- provider webhooks, STOP confirmations, delivery polling, or a two-way inbox;
- published Privacy Policy, SMS Terms, or subprocessor edits;
- technician prompts or required consent work;
- diagnostic-engine, topology, quote-math, parts, repair, or closeout behavior;
- raw approval tokens, secure URLs, message bodies, diagnostic details, VINs, plates, supplier costs, payment data, signed documents, or raw webhook payloads; and
- an administrative dashboard for holds. Initial hold operations remain tightly controlled and internal.

## Retention schedule

| Record | Normal retention | Verified-deletion behavior |
|---|---|---|
| Active consent proof | While consent remains active | Compact into the compliance tombstone |
| Consent/revocation proof | Five years after the latest relevant consent, automated send, revocation, or verified deletion event | Retain only the privacy-minimized tombstone for the remaining window |
| Active suppression | Five years after the latest revocation | Retain the keyed destination fingerprint; never restore prior consent |
| Quote-send operation | While its secure approval action is usable | Revoke/delete token material immediately |
| Terminal quote-send metadata | Twelve months after approved, declined, superseded, revoked, expired, or ticket-closed state | Delete immediately except the minimum tombstone facts |
| Provider delivery metadata | Twelve months after final delivery or failure state | Delete immediately except the minimum tombstone facts |
| Internal notification and deduplication | Ninety days after creation | Delete immediately |
| Raw message/webhook content | Never deliberately persisted | Nothing to retain |
| Application logs | Existing short redacted operational window | No customer-specific exception |
| Backups | Existing rolling backup window | Deleted copies age out within ninety days |

The latest relevant event may extend the five-year proof clock only when it is a real consent, automated send, revocation, or verified deletion event. Reads, retries, projection repairs, exports, purges, and ordinary administrative access do not extend retention.

Suppression expiry changes the destination to fresh-consent-required. It never lifts an opt-out into a sendable state. A later valid customer-controlled consent event may create new consent under Row 25; absence of an active suppression row is never consent.

## Logical record model

The implementation plan may refine physical names, indexes, and constraint syntax, but it must preserve these boundaries.

### Consent events

An append-only event stream records asked, declined, consented, revoked, re-consented, and verified-deletion transitions. Each event is bound to:

- shop;
- one opaque subject key and, while present, one customer;
- the transactional repair-update program version;
- keyed destination fingerprint and key version;
- event type and server commit time;
- source occurrence time as evidence, never transaction authority;
- capture method and customer-controlled-action flag;
- exact disclosure version, bounded rendered-disclosure hash, and public link destinations;
- privacy-minimized evidence kind/reference;
- staff actor only when recording a signed source; and
- bounded provider event reference when applicable.

Corrections append a compensating event. Updates and deletes are prohibited until the verified-deletion workflow compacts the stream into one immutable tombstone.

### Current consent state

A derived projection provides fast eligibility checks. It is not independent authority. A send is eligible only when:

1. the projection says consented;
2. its source event exists and is valid;
3. shop, customer, destination fingerprint, and program match;
4. no active suppression matches the shop and destination; and
5. the requested message subject remains inside the disclosed transactional program.

Missing, malformed, stale, or contradictory state fails closed. Revocation invalidates prior consent; projection repair cannot silently resurrect it.

### Suppression registry

Suppression is keyed by shop plus destination fingerprint, intentionally broader than customer or ticket identity. It records the latest revocation source, committed time, current active state, and retain-until time. Duplicate customers, campaigns, repair orders, or sender numbers under the same shop cannot bypass it.

Fresh full-disclosure consent may supersede an active suppression only through the ordered event transaction defined by Row 25. Provider START alone never clears application suppression.

### Quote sends

A quote-send record binds one immutable quote version to one shop, ticket, destination fingerprint, channel, token hash, expiry, request key, actor, and operational state. It never stores a raw token or complete URL.

Operational states must support the Row-25 race contract: queued, claimed, submitting, submitted, cancelled, and terminal delivery/response states. Row 31 defines durable fields and constraints; Rows 32 and 35 own public tokens, provider submission, and webhook transitions.

### SMS delivery log

The delivery log stores only provider/message identifiers, quote-send reference, redacted template key/version, bounded provider state, bounded error code, provider occurrence time, server receipt time, and retain-until time. It never stores a message body, secure URL, customer name, phone number, vehicle detail, diagnosis, quote amount, or raw webhook.

### Notifications

Notifications store the shop, recipient profile, bounded event type, privacy-safe entity reference, created/read timestamps, and unique deduplication key. They contain no customer message body. Row 36 owns routing and mutation behavior.

### Compliance tombstones

Verified deletion replaces readable messaging identity and ordinary history with one immutable, privacy-minimized tombstone containing:

- shop and opaque subject key;
- keyed destination fingerprint and key version;
- consent/revocation event types and timestamps needed for proof;
- disclosure/program version and hash;
- bounded evidence/provider references;
- deletion timestamp, reason code, and authorizing actor;
- prior-record counts by type; and
- final retain-until time.

The tombstone does not retain a readable phone number, customer name, message body, secure URL, vehicle detail, free-text reason, or unrelated shop record.

### Retention holds

A separate hold targets one identified record or one opaque subject set. It requires a bounded reason code, authorized actor, start time, review time, and expiration. One hold may last no more than 365 days. Renewal requires a new explicit authorized event; no hold renews silently.

Holds pause deletion only for the named records. They do not permit messaging, restore consent, broaden access, or stop deletion of unrelated data. Released or expired holds remain in the privacy-safe audit record for the same five-year compliance window.

## Destination fingerprints and key rotation

Compliance tables do not duplicate a readable phone number. They store an HMAC-SHA-256 fingerprint of the normalized E.164 destination using a versioned server secret held outside the database and repository.

The fingerprint is pseudonymous, not anonymous. Access remains server-only. The key identifier is safe to store; key material is not.

Rotation uses a bounded dual-read process:

1. new records use the current key version;
2. eligibility and suppression checks compare fingerprints for every still-supported key version;
3. a controlled batch re-fingerprints live records after resolving the source destination through authorized customer data;
4. old key material remains available only until every live fingerprint is migrated or its record expires; and
5. rotation stops if any record cannot be reconciled without exposing or guessing a destination.

Deletion tombstones cannot be re-fingerprinted from stored plaintext because none exists. Their old key version therefore remains supported until the last such tombstone expires, unless a separately approved secure re-key protocol proves an equivalent match without plaintext persistence.

## Verified-deletion workflow

Row 31 exposes an internal handler that accepts an already verified shop/customer request. Public identity verification and customer-facing request intake remain outside this row.

The handler uses two ordered transactions so a cleanup failure can never erase the request or leave messaging eligible:

1. The suppression-gate transaction locks the shop/customer messaging identity, writes or refreshes suppression, records an actor-bound deletion request as pending, and commits.
2. Once the gate commits, every eligibility check fails closed for that destination even if cleanup has not finished.
3. The cleanup transaction locks the pending request and matching records.
4. It cancels every queued or claimed send and records any already-submitting/submitted send honestly as in flight.
5. It revokes and removes token material.
6. It compacts consent history into one compliance tombstone.
7. It deletes quote-send metadata, delivery metadata, notifications, and projections not protected by a valid hold.
8. It detaches messaging proof from the readable customer identity.
9. It records privacy-safe counts, completion time, and completed request state.
10. It commits atomically.

The request key is actor-bound and retry-safe. A retry returns the same pending or completed request and cannot duplicate suppression, tombstones, or audit counts. A cleanup failure rolls back only cleanup; the committed suppression and pending request remain durable until a retry completes. A suppression-gate failure creates no accepted deletion claim and returns a bounded retryable error. No caller may report acceptance, and messaging fails closed whenever the compliance store is unavailable or cannot complete its eligibility checks.

Deletion does not erase unrelated repair, quote, authorization, accounting, or safety records. Their separate retention policy is outside Row 31. Where an existing customer foreign key prevents messaging deletion, the messaging record must detach or pseudonymize rather than cascade into unrelated Shop OS history.

## Automatic purge worker

The worker is an internal bounded batch operation, not a general data-deletion framework.

- It selects only records whose retain-until time has passed and that have no active hold.
- It uses stable ordering, a fixed batch limit, and retry-safe deletion.
- It never extends a retention clock merely by inspecting or retrying a record.
- It compacts expired active evidence only when the approved tombstone window still applies; otherwise it permanently deletes the record.
- It emits counts by record type and result code, never identifiers or payloads.
- One failed record does not produce an unbounded loop or delete later dependent records out of order.
- The production schedule remains disabled until the production migration and retention behavior are separately approved and verified.

Before production messaging is enabled, a scheduled invocation and alerting path must be live and proven. Shipping an unenforced policy is not sufficient for customer messaging.

## Access and security

- Every table is tenant-owned and carries shop identity where queryable.
- Parent/child same-shop consistency is enforced in handlers and database constraints.
- Compliance tables are server-only: no direct, inherited, PUBLIC, authenticated, or anonymous client table privileges.
- RLS is defense in depth, not the only boundary.
- Only capability-authorized server handlers may record staff consent evidence, revocation, deletion, or holds.
- No ordinary API returns destination fingerprints, consent evidence references, provider identifiers, or tombstones.
- Logs and error responses use bounded codes and counts only.
- Free-text hold reasons, deletion reasons, provider payloads, and customer messages are prohibited.
- Production migration proof must inspect direct and effective privileges, policies, foreign keys, indexes, functions/triggers, and security advisors.

## Race and failure behavior

- Suppression always beats consent.
- Revocation/deletion that commits before submitting cancels the send.
- A send that commits submitting first may be in flight and cannot be recalled; every later send remains suppressed.
- Missing or contradictory consent fails closed.
- Duplicate customer rows cannot bypass shop/destination suppression.
- Provider occurrence time never overrides server transaction order.
- Projection repair cannot erase revocation or create consent.
- A failed deletion remains retryable and cannot restore messaging.
- Expired holds are ignored by purge and may not renew themselves.
- Expired suppression never restores consent.
- Provider failure, lost registration, or disabled SMS leaves phone/in-person service complete.

## Required proof

### Schema and migration

- exact clean-source migration and guarded standard-fixture adoption;
- local rollback proof before any live apply;
- same-shop composite constraints and expected indexes;
- append-only event/tombstone enforcement;
- retain-until and hold-expiry checks;
- complete server-only privilege proof; and
- no production apply without a separate owner-approved migration packet.

### Domain behavior

- consent cannot transfer between shops, customers, destinations, or programs;
- duplicate customers cannot bypass suppression;
- customer-controlled re-consent is ordered after revocation;
- START alone does not restore consent;
- request-key retries cannot duplicate events, deletion, tombstones, or notifications;
- five-year, twelve-month, and ninety-day boundaries are deterministic at exact clock edges;
- non-retention events never extend the clock;
- verified deletion removes readable messaging identity and ordinary metadata;
- deletion preserves only the approved tombstone;
- suppression remains effective after customer deletion;
- expired suppression still requires fresh consent;
- holds expire, apply narrowly, and require explicit renewal;
- key rotation preserves matching across supported versions;
- cross-shop reads/writes and forged parent links fail; and
- no log, error, snapshot, or fixture contains a real phone number, message body, token, or secure URL.

### Integration boundaries

- Rows 32, 35, and 36 can consume the records without widening them;
- ticketless or legacy diagnostic behavior remains unchanged;
- SMS-disabled shops and customers who decline remain fully operable;
- technicians encounter no new required step;
- no provider network call occurs; and
- full repository tests, TypeScript, production build, diff checks, schema/security review, privacy review, and whole-branch review pass before merge.

## Production gates

Row 31 source implementation does not authorize live DDL. Production migration requires separate owner approval of:

1. exact SQL and rollback;
2. unchanged existing Shop OS data;
3. direct/effective ACL and RLS proof;
4. clean relevant security/performance advisors;
5. application compatibility before and after apply; and
6. backup/deletion language consistent with the actual provider configuration.

Production messaging remains disabled until all of the following are separately complete:

- Row 26 provider/sender structure, registration, credentials, and spend;
- Row 32 secure public token/response foundation;
- Row 35 provider submission, signed webhooks, STOP/HELP, and deletion-provider reconciliation;
- Row 36 notification routing;
- scheduled purge execution and failure alerting;
- final public Privacy Policy, SMS Terms, and subprocessor disclosure;
- provider-side content-retention configuration and contract review; and
- controlled test-number proof before any real customer receives a message.

## Acceptance boundary

Row 31 is complete when the source schema, lifecycle helpers, internal deletion workflow, bounded purge worker, tests, and independent reviews prove the approved policy without touching production or enabling messaging.

It is not complete merely because tables exist. The implementation must prove deterministic clocks, privacy-minimized deletion, durable suppression, retry/race behavior, key rotation, tenant isolation, complete client privilege revocation, and compatibility with the later messaging rows.
