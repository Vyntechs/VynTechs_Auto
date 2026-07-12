# Shop OS Row 31 Messaging Retention and Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dormant, tenant-safe messaging compliance foundation that preserves five-year privacy-minimized consent/revocation proof, deletes ordinary messaging data on the approved schedule, and never enables production messaging.

**Architecture:** Eight server-only tables separate append-only consent truth, current eligibility, shop-wide suppression, quote-send operations, redacted delivery events, internal notifications, deletion/tombstone workflow, and narrow retention holds. Injected domain helpers own deterministic clocks, HMAC destination fingerprints, ordered consent state, two-transaction deletion, and bounded purge behavior. No route, provider, UI, public policy edit, cron enablement, production DDL, credential, spend, or diagnostic-engine change enters this row.

**Tech Stack:** Next.js 16 repository conventions, TypeScript 6, Drizzle ORM/PostgreSQL, PGlite, Zod 4, Node crypto HMAC-SHA-256, Vitest.

## Global Constraints

- Authority: [Row 31 design](../../strategy/2026-07-12-shop-os-row31-messaging-retention-deletion-design.md), [Row 25 consent design](../../strategy/2026-07-11-shop-os-row25-a2p-consent-design.md), project `AGENTS.md`, and the active Shop OS plan.
- Retention: five calendar years for consent/revocation proof, twelve calendar months for terminal delivery metadata, ninety days for notifications/deduplication, and the existing published ninety-day backup age-out.
- Calendar arithmetic: add UTC calendar years/months and clamp an invalid day to the destination month's last UTC day; day retention is exact 24-hour UTC days.
- Suppression always beats consent; suppression expiry means fresh-consent-required and never restores prior consent.
- The suppression gate commits before retryable deletion cleanup.
- Compliance tables store only a keyed HMAC-SHA-256 E.164 destination fingerprint plus key version, never a readable destination.
- The HMAC key ring is injected; no environment read occurs in domain helpers, and no key material enters database rows, fixtures, logs, errors, or git.
- Consent events and completed deletion tombstones are immutable; corrections append events.
- All new tables are server-only with complete client/PUBLIC privilege revocation, service-role CRUD, RLS enabled, and deny-direct policies.
- No customer-facing route, provider call, message, raw webhook, message body, secure URL, raw token, production migration, or cron schedule is added.
- No diagnostic-engine, topology, quote math, parts, work, repair, or closeout behavior changes.
- Every task follows RED → GREEN → focused regression → commit. One lane owns heavy test runs.

## File map

- `lib/db/schema.ts` — Drizzle declarations, constraints, indexes, and relations for the eight Row 31 tables.
- `drizzle/migrations/0033_shop_os_messaging_retention.sql` — source DDL for Row 31; never apply live in this plan.
- `drizzle/migrations/0034_shop_os_messaging_retention_acl.sql` — idempotent complete ACL hardening for the new tables.
- `tests/helpers/db.ts` — guarded absent/complete/partial migration fixture plus complete server-only ACL inspection.
- `lib/shop-os/messaging-retention-policy.ts` — pure clock, normalization, HMAC, and bounded-retention helpers.
- `lib/shop-os/messaging-consent.ts` — append-only consent/suppression transitions and fail-closed eligibility.
- `lib/shop-os/messaging-deletion.ts` — durable suppression gate and retryable cleanup transaction.
- `lib/shop-os/messaging-retention-purge.ts` — narrow hold lifecycle and bounded purge.
- `tests/unit/shop-os-messaging-retention-schema.test.ts` — physical schema/migration/constraint proof.
- `tests/unit/shop-os-messaging-retention-acl.test.ts` — direct, inherited, PUBLIC, RLS, and service-role proof.
- `tests/unit/shop-os-messaging-retention-policy.test.ts` — exact clock and HMAC behavior.
- `tests/unit/shop-os-messaging-consent.test.ts` — consent, revocation, duplicate-contact, and eligibility behavior.
- `tests/unit/shop-os-messaging-deletion.test.ts` — two-transaction deletion, retries, in-flight sends, and tombstones.
- `tests/unit/shop-os-messaging-retention-purge.test.ts` — holds, expiry, stable batches, and privacy-safe counts.
- `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md` and `docs/strategy/SHOP_OS_DRIVER_STATE.md` — close the row only after all proof and reviews pass.

---

### Task 1: Core Consent, Suppression, Deletion, and Hold Schema

**Files:**
- Create: `tests/unit/shop-os-messaging-retention-schema.test.ts`
- Create: `drizzle/migrations/0033_shop_os_messaging_retention.sql`
- Modify: `lib/db/schema.ts`
- Modify: `tests/helpers/db.ts`

**Interfaces:**
- Produces Drizzle tables `messagingConsentEvents`, `messagingConsentState`, `smsSuppressions`, `messagingDeletionRequests`, and `messagingRetentionHolds`.
- Produces `ensureMessagingRetentionMigration(client: PGlite): Promise<void>` for the standard test fixture.
- Later tasks consume the exact table/column names defined here; no task invents a parallel consent projection or suppression store.

- [ ] **Step 1: Write the failing schema contract**

Create the test with exact expected table names and critical invariants:

```ts
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  messagingConsentEvents,
  messagingConsentState,
  smsSuppressions,
  messagingDeletionRequests,
  messagingRetentionHolds,
} from '@/lib/db/schema'

describe('Shop OS messaging retention source schema', () => {
  it('declares the five core compliance tables', () => {
    expect([
      messagingConsentEvents,
      messagingConsentState,
      smsSuppressions,
      messagingDeletionRequests,
      messagingRetentionHolds,
    ].map((table) => getTableConfig(table).name)).toEqual([
      'messaging_consent_events',
      'messaging_consent_state',
      'sms_suppressions',
      'messaging_deletion_requests',
      'messaging_retention_holds',
    ])
    expect(getTableColumns(messagingConsentEvents)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      subjectKey: expect.anything(),
      customerId: expect.anything(),
      destinationFingerprint: expect.anything(),
      fingerprintKeyVersion: expect.anything(),
      programVersion: expect.anything(),
      eventType: expect.anything(),
      committedAt: expect.anything(),
      occurredAt: expect.anything(),
      captureMethod: expect.anything(),
      customerControlled: expect.anything(),
      disclosureSnapshot: expect.anything(),
      disclosureHash: expect.anything(),
      evidenceKind: expect.anything(),
      evidenceRef: expect.anything(),
      actorProfileId: expect.anything(),
      requestKey: expect.anything(),
      requestFingerprint: expect.anything(),
      retainUntil: expect.anything(),
    })
  })
})
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts
```

Expected: FAIL because the five exports and migration fixture do not exist.

- [ ] **Step 3: Add exact Drizzle declarations**

Add the five tables after `quoteEvents` and before relation declarations. Use:

```ts
export const messagingConsentEvents = pgTable('messaging_consent_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull(),
  subjectKey: uuid('subject_key').notNull(),
  customerId: uuid('customer_id').notNull(),
  destinationFingerprint: text('destination_fingerprint').notNull(),
  fingerprintKeyVersion: text('fingerprint_key_version').notNull(),
  programVersion: text('program_version').notNull(),
  eventType: text('event_type', {
    enum: ['asked', 'declined', 'consented', 'revoked', 'reconsented', 'deleted'],
  }).notNull(),
  committedAt: timestamp('committed_at', { withTimezone: true }).defaultNow().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  captureMethod: text('capture_method', {
    enum: ['customer_web', 'signed_form', 'provider_webhook', 'staff_request'],
  }).notNull(),
  customerControlled: boolean('customer_controlled').notNull(),
  disclosureSnapshot: jsonb('disclosure_snapshot').$type<Record<string, unknown>>(),
  disclosureHash: text('disclosure_hash'),
  evidenceKind: text('evidence_kind', {
    enum: ['customer_checkbox', 'signed_form_reference', 'provider_event', 'staff_request'],
  }).notNull(),
  evidenceRef: text('evidence_ref'),
  actorProfileId: uuid('actor_profile_id'),
  requestKey: uuid('request_key').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  retainUntil: timestamp('retain_until', { withTimezone: true }).notNull(),
})
```

Define the remaining tables with these exact responsibilities:

- `messaging_consent_state`: shop, subject, customer, destination fingerprint/key version, program, status `declined|consented|revoked`, source event, consent/revocation times, retain-until, updated-at.
- `sms_suppressions`: shop, destination fingerprint/key version, source event, reason `customer_revocation|verified_deletion|permanent_failure|number_reassigned`, suppressed-at, lifted-at, retain-until, updated-at.
- `messaging_deletion_requests`: request id/key/fingerprint, shop, subject, nullable customer, destination fingerprint/key version, state `pending|completed`, bounded reason code, requesting actor, requested/completed times, bounded JSON counts/proof summary, retain-until.
- `messaging_retention_holds`: shop, resource type/id or subject key, bounded reason code, authorizing actor, start/review/expiry/release times.

Every table gets a unique `(shop_id, id)` index. Add same-shop composite foreign keys to shops/customers/profiles/events, bounded 64-character lowercase-hex fingerprint/hash checks, bounded slug checks, JSON object/4-KiB checks, state-consistency checks, and:

```ts
check(
  'messaging_retention_holds_max_duration',
  sql${table.expiresAt} > ${table.startsAt}
    and ${table.expiresAt} <= ${table.startsAt} + interval '365 days'`,
)
```

The completed deletion request is the compliance tombstone. Its consistency check requires completed-at, null customer-id, proof summary, and retain-until when state is completed; pending requires a customer-id and null completed-at.

- [ ] **Step 4: Write migration 0033 from the declarations**

Create the five tables, constraints, indexes, append-only triggers, RLS, deny-direct policies, and service-role CRUD. Use explicit named constraints matching the Drizzle declarations.

The consent-event trigger rejects UPDATE/DELETE. The deletion-request trigger permits pending → completed exactly once, rejects completed-row mutation, and allows the purge worker to delete only after retain-until using a SECURITY DEFINER function with `SET search_path = ''` and service-role-only execution.

Do not add 0033 to the stale Drizzle journal by hand. Run `pnpm db:generate` once after the declarations. If the known malformed historical snapshots still prevent generation, preserve the exact source migration and fixture path; do not edit historical metadata.

- [ ] **Step 5: Add guarded fixture adoption**

Add a marker query covering exact table, column, constraint, index, RLS, policy, and trigger counts:

```ts
export async function ensureMessagingRetentionMigration(client: PGlite): Promise<void> {
  const before = await messagingRetentionMarkers(client)
  if (isCompleteMessagingRetention(before)) return
  if (hasAnyMessagingRetentionMarker(before)) {
    throw new Error('partial messaging retention schema in ephemeral database')
  }
  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0033_shop_os_messaging_retention.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))
  const after = await messagingRetentionMarkers(client)
  if (!isCompleteMessagingRetention(after)) {
    throw new Error('messaging retention schema hardening failed in ephemeral database')
  }
}
```

Call it after `ensureShopOsServerOnlyAclMigration` only if 0033 includes complete initial ACL; Task 3 will reorder the final fixture once 0034 exists.

- [ ] **Step 6: Expand RED/GREEN schema proof**

Add tests for:

- clean standard-fixture apply and idempotent re-check;
- partial state refusal after dropping one trigger or constraint;
- cross-shop customer/actor/event FK rejection;
- invalid fingerprint/hash/key/program/status/capture/evidence values;
- disclosure/proof JSON type and 4-KiB bounds;
- pending/completed deletion consistency;
- 365-day hold bound;
- consent-event UPDATE/DELETE rejection outside the authorized compaction/purge functions; and
- completed tombstone UPDATE rejection.

- [ ] **Step 7: Run focused proof**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: focused schema tests PASS, TypeScript exits 0, diff check exits 0.

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0033_shop_os_messaging_retention.sql tests/helpers/db.ts tests/unit/shop-os-messaging-retention-schema.test.ts
git commit -m "Add messaging compliance source schema"
```

---

### Task 2: Quote-Send, Delivery, and Notification Schema

**Files:**
- Modify: `tests/unit/shop-os-messaging-retention-schema.test.ts`
- Modify: `drizzle/migrations/0033_shop_os_messaging_retention.sql`
- Modify: `lib/db/schema.ts`
- Modify: `tests/helpers/db.ts`

**Interfaces:**
- Produces `quoteSends`, `smsLog`, and `notifications`.
- Adds the same-shop `quote_events_shop_ticket_send_fk` from existing `quoteEvents.quoteSendId` to `quoteSends`.
- Rows 32, 35, and 36 consume these tables; Row 31 does not add runtime routes.

- [ ] **Step 1: Add failing operational-table contracts**

Assert exact table names, fields, and the existing quote-event reference:

```ts
expect([quoteSends, smsLog, notifications].map((table) => getTableConfig(table).name))
  .toEqual(['quote_sends', 'sms_log', 'notifications'])
expect(tableNames(quoteEvents).foreignKeys)
  .toContain('quote_events_shop_ticket_send_fk')
```

Require:

- quote sends: shop/ticket/version/customer, destination fingerprint/key version, channel `sms`, nullable token hash/expiry, actor-bound request key/fingerprint, state `queued|claimed|submitting|submitted|cancelled|delivered|failed|responded|expired`, submission/terminal/retention timestamps.
- SMS log: shop/send, nullable bounded provider message/event IDs, template key/version, state `accepted|queued|sent|delivered|undelivered|failed|opt_out|help|start`, bounded error code, provider occurrence/server receipt/retain-until timestamps.
- notifications: shop/recipient, bounded type, bounded entity type/id, dedupe key, created/read/retain-until timestamps.

- [ ] **Step 2: Run the contract and verify RED**

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts
```

Expected: FAIL because the three exports and quote-send FK do not exist.

- [ ] **Step 3: Add the minimal declarations and DDL**

Implement all three tables with same-shop FKs and indexes needed for:

- one actor-bound quote-send request retry per shop;
- one provider event ID per shop when present;
- stable `(state, retain_until, id)` purge scans;
- stable `(shop_id, destination_fingerprint, fingerprint_key_version)` eligibility/deletion scans;
- one notification dedupe key per shop/recipient; and
- quote-event → quote-send same-shop/ticket integrity.

State-consistency checks require:

- token hash and expiry only while the approval action may be used;
- submitting-at for submitting/submitted/terminal send states;
- submitted-at for submitted/terminal provider states;
- terminal-at and retain-until for terminal states;
- cancelled before submitting;
- read-at not before notification creation; and
- retain-until not before the record's terminal/created timestamp.

- [ ] **Step 4: Prove privacy bounds and FK behavior**

Add PGlite tests that reject raw/oversized token hashes, template/error/provider identifiers, invalid states, inconsistent timestamps, cross-shop ticket/version/customer/send/recipient references, and duplicate request/provider/dedupe keys.

Assert no column named `message_body`, `raw_body`, `destination`, `phone`, `secure_url`, or `token` exists in any Row 31 table.

- [ ] **Step 5: Run focused proof**

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: focused schema tests PASS, TypeScript exits 0, diff check exits 0.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/migrations/0033_shop_os_messaging_retention.sql tests/helpers/db.ts tests/unit/shop-os-messaging-retention-schema.test.ts
git commit -m "Add dormant messaging operation records"
```

---

### Task 3: Complete Server-Only ACL and Fixture Proof

**Files:**
- Create: `drizzle/migrations/0034_shop_os_messaging_retention_acl.sql`
- Create: `tests/unit/shop-os-messaging-retention-acl.test.ts`
- Modify: `tests/helpers/db.ts`
- Modify: `tests/unit/shop-os-server-only-acl.test.ts`

**Interfaces:**
- Produces `ensureMessagingRetentionAclMigration(client: PGlite): Promise<void>`.
- Expands the canonical server-only table list to all sixteen Shop OS tables.

- [ ] **Step 1: Write failing complete-privilege tests**

Define the exact new table list:

```ts
const MESSAGING_TABLES = [
  'messaging_consent_events',
  'messaging_consent_state',
  'sms_suppressions',
  'quote_sends',
  'sms_log',
  'notifications',
  'messaging_deletion_requests',
  'messaging_retention_holds',
] as const
```

For each table assert:

- RLS enabled;
- one `FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)` policy;
- zero direct anon/authenticated grants;
- zero effective SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER through PUBLIC or inherited membership; and
- exactly service-role SELECT/INSERT/UPDATE/DELETE.

- [ ] **Step 2: Run ACL tests and verify RED**

```bash
pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-server-only-acl.test.ts
```

Expected: FAIL because the canonical ACL inspection and 0034 do not include the new tables.

- [ ] **Step 3: Add idempotent migration 0034**

For all eight tables:

```sql
revoke all privileges
on table
  public.messaging_consent_events,
  public.messaging_consent_state,
  public.sms_suppressions,
  public.quote_sends,
  public.sms_log,
  public.notifications,
  public.messaging_deletion_requests,
  public.messaging_retention_holds
from public, anon, authenticated;

grant select, insert, update, delete
on table
  public.messaging_consent_events,
  public.messaging_consent_state,
  public.sms_suppressions,
  public.quote_sends,
  public.sms_log,
  public.notifications,
  public.messaging_deletion_requests,
  public.messaging_retention_holds
to service_role;
```

Revoke PUBLIC execution on every Row 31 trigger/purge function and grant only the minimum function execution to service-role.

- [ ] **Step 4: Make fixture order exact**

The standard fixture order becomes:

1. journaled migrations;
2. adaptive 0029 guard;
3. vendor 0030 guard;
4. quote search-path 0031 guard;
5. legacy Shop OS ACL 0032 guard;
6. messaging schema 0033 guard; and
7. messaging ACL 0034 guard.

The marker check fails closed on absent tables after the schema step, partial ACL, PUBLIC leakage, inherited client access, missing service CRUD, extra policy, or unsafe function execution.

- [ ] **Step 5: Run ACL and schema proof**

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-server-only-acl.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: all focused tests PASS and both static checks exit 0.

- [ ] **Step 6: Commit**

```bash
git add drizzle/migrations/0034_shop_os_messaging_retention_acl.sql tests/helpers/db.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-server-only-acl.test.ts
git commit -m "Harden messaging compliance table access"
```

---

### Task 4: Deterministic Retention and Destination Fingerprints

**Files:**
- Create: `lib/shop-os/messaging-retention-policy.ts`
- Create: `tests/unit/shop-os-messaging-retention-policy.test.ts`

**Interfaces:**
- Produces:

```ts
export type FingerprintKeyRing = {
  currentVersion: string
  keys: Readonly<Record<string, string>>
}
export function normalizeE164(input: unknown): string
export function fingerprintDestination(
  normalizedE164: string,
  keyVersion: string,
  secret: string,
): string
export function fingerprintsForKeyRing(
  input: unknown,
  keyRing: FingerprintKeyRing,
): ReadonlyArray<{ keyVersion: string; fingerprint: string }>
export function addUtcCalendarYearsClamped(at: Date, years: number): Date
export function addUtcCalendarMonthsClamped(at: Date, months: number): Date
export function consentProofRetainUntil(latestRelevantAt: Date): Date
export function deliveryRetainUntil(terminalAt: Date): Date
export function notificationRetainUntil(createdAt: Date): Date
export function validatePurgeBatchSize(input: unknown): number
```

- [ ] **Step 1: Write failing pure tests**

Cover:

- strict E.164 normalization with `+12025550123` as fictional data;
- rejection of spaces, punctuation, national numbers, all-zero country code, and more than 15 digits;
- stable lowercase 64-character HMAC output;
- distinct shop key material/version output;
- missing/short key rejection without echoing the destination or secret;
- current plus legacy version fingerprints in deterministic version order;
- five-year and twelve-month calendar clamping at Feb 29/month-end;
- exact ninety-day UTC arithmetic;
- no input-date mutation; and
- purge batch integer range 1–100.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm test tests/unit/shop-os-messaging-retention-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement minimal pure helpers**

Use injected secrets and `node:crypto` only:

```ts
import { createHmac } from 'node:crypto'
import { z } from 'zod'

const e164Schema = z.string().regex(/^\\+[1-9][0-9]{7,14}$/)
const keyVersionSchema = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)

export function fingerprintDestination(
  normalizedE164: string,
  keyVersion: string,
  secret: string,
): string {
  const destination = e164Schema.parse(normalizedE164)
  keyVersionSchema.parse(keyVersion)
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('invalid_fingerprint_key')
  return createHmac('sha256', secret)
    .update('vyntechs:sms-destination:')
    .update(keyVersion)
    .update(':')
    .update(destination)
    .digest('hex')
}
```

Implement calendar clamping by calculating the destination year/month, setting UTC day to 1 first, then clamping the original day to the last day of the target UTC month. Consent uses +5 years; delivery uses +12 months; notifications use +90 × 24 hours.

- [ ] **Step 4: Run focused proof**

```bash
pnpm test tests/unit/shop-os-messaging-retention-policy.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: policy tests PASS and static checks exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/shop-os/messaging-retention-policy.ts tests/unit/shop-os-messaging-retention-policy.test.ts
git commit -m "Add deterministic messaging retention policy"
```

---

### Task 5: Consent Events, Suppression, and Eligibility

**Files:**
- Create: `lib/shop-os/messaging-consent.ts`
- Create: `tests/unit/shop-os-messaging-consent.test.ts`
- Modify: `lib/shop-os/capabilities.ts`
- Modify: `tests/unit/shop-os-capabilities.test.ts`

**Interfaces:**
- Produces:

```ts
export type MessagingActor = {
  profileId: string
  shopId: string
  role: string
}
export type MessagingEligibility =
  | { allowed: true; consentEventId: string; destinationFingerprint: string; keyVersion: string }
  | { allowed: false; reason:
      | 'missing_consent'
      | 'suppressed'
      | 'stale_projection'
      | 'customer_mismatch'
      | 'program_mismatch'
      | 'deletion_pending'
      | 'compliance_unavailable' }
export async function recordMessagingConsentEvent(input: {
  db: AppDb
  actor: MessagingActor
  customerId: string
  destination: string
  programVersion: string
  eventType: 'asked' | 'declined' | 'consented' | 'revoked' | 'reconsented'
  captureMethod: 'customer_web' | 'signed_form' | 'provider_webhook' | 'staff_request'
  customerControlled: boolean
  disclosureSnapshot?: Record<string, unknown>
  disclosureHash?: string
  evidenceKind: 'customer_checkbox' | 'signed_form_reference' | 'provider_event' | 'staff_request'
  evidenceRef?: string
  requestKey: string
  requestFingerprint: string
  occurredAt: Date
  now: Date
  keyRing: FingerprintKeyRing
}): Promise<{ ok: true; eventId: string; status: 'declined' | 'consented' | 'revoked' } | { ok: false; error: string }>
export async function getMessagingEligibility(input: {
  db: AppDb
  shopId: string
  customerId: string
  destination: string
  programVersion: string
  keyRing: FingerprintKeyRing
}): Promise<MessagingEligibility>
```

- [ ] **Step 1: Add failing capability and domain tests**

Pin:

- advisor/owner may record a signed source or staff-received revocation;
- tech/parts cannot record or alter consent;
- no staff role may fabricate customer-controlled web consent;
- consent/reconsent requires complete bounded disclosure proof;
- declined does not enable sends;
- revocation creates/refreshes shop-wide suppression;
- one customer's consent cannot authorize another customer using the same number;
- duplicate customers sharing a number are all suppressed by one revocation;
- same number in another shop is unaffected;
- START/provider event cannot create re-consent;
- exact actor-bound request retry returns the original event;
- same request key with changed fingerprint fails;
- projection/source mismatch fails closed; and
- compliance DB failure returns `compliance_unavailable` without logging PII.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm test tests/unit/shop-os-capabilities.test.ts tests/unit/shop-os-messaging-consent.test.ts
```

Expected: FAIL because the capability and domain helpers do not exist.

- [ ] **Step 3: Add the narrow capability**

```ts
export function canManageCustomerMessaging(role: string | null | undefined): boolean {
  return role === 'advisor' || role === 'owner'
}

export function canManageMessagingRetention(
  role: string | null | undefined,
  founderOverride = false,
): boolean {
  return founderOverride || role === 'owner'
}
```

- [ ] **Step 4: Implement ordered consent transition**

Use one transaction with stable locks:

1. exact request event;
2. customer;
3. every active fingerprint-version suppression row in sorted version order;
4. current projection.

Validate authority and customer/shop before mutation. Insert one append-only event, upsert the projection from that event, and upsert suppression for revoked. Re-consent may lift suppression only when customer-controlled full disclosure is present and the new committed event follows the revocation.

The public consent helper rejects the internal `deleted` event type. Task 6 inserts that event only inside the cleanup transaction immediately before authorized compaction into the completed deletion tombstone.

Eligibility loads every supported fingerprint, checks pending deletion and active suppression first, then validates projection → source event byte-for-byte on shop/customer/program/fingerprint/version/status. Any query or invariant failure returns a bounded denial.

- [ ] **Step 5: Run focused and adjacent proof**

```bash
pnpm test tests/unit/shop-os-capabilities.test.ts tests/unit/shop-os-messaging-retention-policy.test.ts tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-quote-decisions.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: focused and adjacent tests PASS; static checks exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/shop-os/capabilities.ts lib/shop-os/messaging-consent.ts tests/unit/shop-os-capabilities.test.ts tests/unit/shop-os-messaging-consent.test.ts
git commit -m "Add fail-closed messaging consent truth"
```

---

### Task 6: Durable Suppression-First Deletion Workflow

**Files:**
- Create: `lib/shop-os/messaging-deletion.ts`
- Create: `tests/unit/shop-os-messaging-deletion.test.ts`

**Interfaces:**
- Produces:

```ts
export type MessagingDeletionResult =
  | { ok: true; requestId: string; state: 'pending' | 'completed'; counts?: Record<string, number> }
  | { ok: false; error: 'forbidden' | 'not_found' | 'request_conflict' | 'busy' | 'retryable' }
export async function requestMessagingDeletion(input: {
  db: AppDb
  actor: MessagingActor
  customerId: string
  destination: string
  reasonCode: 'customer_request' | 'shop_request' | 'account_deletion'
  requestKey: string
  requestFingerprint: string
  now: Date
  keyRing: FingerprintKeyRing
}): Promise<MessagingDeletionResult>
export async function completeMessagingDeletion(input: {
  db: AppDb
  actor: MessagingActor
  requestId: string
  now: Date
}): Promise<MessagingDeletionResult>
```

- [ ] **Step 1: Write failing deletion tests**

Cover:

- only owner/founder-authorized internal actor may request deletion;
- cross-shop customer/request fails;
- phase one commits suppression plus one pending request;
- phase-two injected failure leaves suppression and pending request;
- retry completes exactly one tombstone;
- queued/claimed sends become cancelled;
- submitting/submitted sends remain honestly in flight;
- token hashes/expiries are nulled for submitting, submitted, and delivered sends before ordinary metadata deletion;
- consent events and projection are compacted/deleted;
- unheld notifications and SMS logs are deleted;
- a quote send is deleted only when it has no held child SMS log;
- retained quote sends detach customer identity and strip token material;
- quote events never change, and their quote-send ID remains an immutable historical identifier that may no longer resolve;
- completed request has null customer ID, bounded counts/proof, and five-year retain-until;
- same request retry is stable and changed fingerprint conflicts;
- customer/vehicle/ticket/quote/repair history is unchanged;
- no result/error contains destination, token, message body, or evidence payload; and
- eligibility denies `deletion_pending` between phases.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm test tests/unit/shop-os-messaging-deletion.test.ts
```

Expected: FAIL because the deletion module does not exist.

- [ ] **Step 3: Implement suppression-gate transaction**

Authorize with `canManageMessagingRetention`. Lock the customer and supported suppression keys. Reuse an exact actor/request retry when present. Otherwise normalize every relevant current and still-supported legacy suppression row to an active, non-liftable deletion barrier (`verified_deletion`, `permanent_failure`, or `number_reassigned`) retained through at least the request timestamp plus five calendar years, then insert one pending request in the same transaction. A `customer_revocation` row must be strengthened to `verified_deletion`; phase one must never leave a relevant supported-key row liftable or short-retained.

Return pending only after commit. Any database error returns `retryable`; never claim acceptance.

- [ ] **Step 4: Implement cleanup transaction**

Use one global lock order: shop → matching pending deletion requests → customer → quote sends → consent projection/events → child SMS logs → notifications → active holds. Lock the existing shop row `FOR UPDATE` as the cleanup transaction's first operation, then lock every matching pending request in stable ascending ID order. Preserve shop → request → customer → send order: the quote-send lifecycle guard deterministically reacquires those already-held request rows `FOR SHARE`, which conflicts with pending → completed updates and prevents completion from committing around authorized detachment or token revocation. The guard then consumes phase one's suppression contract for the old send key: it locks the exact shop/destination-fingerprint/key-version suppression row, requires an active non-liftable deletion reason, and requires retention through at least the latest matching pending request's requested-at plus five years. The request may store only the current key; a held send under any still-supported legacy key is authorized only by its own exact phase-one suppression barrier. `customer_revocation`, lifted, short-retained, missing, or mismatched suppressions never authorize deletion. This request-first then suppression validation is deterministic and remains under the already-held shop lock, matching the shop-first order used by consent transitions and hold insertion without introducing an inverted Task 5 lock path. Hold the shop lock through the final hold scan, every cleanup delete or update, and transaction commit. Hold targets are immutable: cleanup never mutates or reparents a hold target, and renewal creates a new hold row with a new authorization. Apply the exact state rule:

```ts
const cancellable = new Set(['queued', 'claimed'])
const inFlight = new Set(['submitting', 'submitted'])
```

Delete unheld notifications and SMS logs. Delete a quote send only when it has no held child SMS log; otherwise detach its customer identity and strip token material. Quote events never change, and their quote-send ID remains an immutable historical identifier that may no longer resolve. Revoke tokens for submitting, submitted, and delivered sends without fabricating state or lifecycle anchors. Append the internal deleted event, create the bounded proof/count summary from already loaded metadata, delete consent events through the authorized compaction function, set customer ID null, state completed, completed-at, and retain-until. Do not touch unrelated Shop OS records.

If held records remain, detach their readable customer link where lawful, record only held counts in the tombstone, and leave suppression active. Do not copy their content into the tombstone.

- [ ] **Step 5: Run focused and race regression proof**

```bash
pnpm test tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-versions.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: focused/race tests PASS and static checks exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/shop-os/messaging-deletion.ts tests/unit/shop-os-messaging-deletion.test.ts
git commit -m "Add suppression-first messaging deletion"
```

---

### Task 7: Narrow Holds and Bounded Automatic Purge

**Files:**
- Create: `lib/shop-os/messaging-retention-purge.ts`
- Create: `tests/unit/shop-os-messaging-retention-purge.test.ts`

**Interfaces:**
- Produces:

```ts
export type PurgeCounts = {
  consentEvents: number
  suppressions: number
  quoteSends: number
  smsLog: number
  notifications: number
  deletionRequests: number
  skippedHeld: number
  failed: number
}
export async function createMessagingRetentionHold(input: {
  db: AppDb
  actor: MessagingActor
  resourceType: 'consent_event' | 'suppression' | 'quote_send' | 'sms_log' | 'notification' | 'deletion_request' | 'subject'
  resourceId?: string
  subjectKey?: string
  reasonCode: 'legal_claim' | 'subpoena' | 'fraud_review' | 'security_investigation'
  startsAt: Date
  reviewAt: Date
  expiresAt: Date
}): Promise<{ ok: true; holdId: string } | { ok: false; error: string }>
export async function releaseMessagingRetentionHold(input: {
  db: AppDb
  actor: MessagingActor
  holdId: string
  releasedAt: Date
}): Promise<{ ok: true } | { ok: false; error: string }>
export async function purgeExpiredMessagingRecords(input: {
  db: AppDb
  now: Date
  batchSize: number
}): Promise<PurgeCounts>
```

- [ ] **Step 1: Write failing hold and purge tests**

Pin:

- only owner/founder-authorized internal actor creates/releases holds;
- exactly one resource ID or subject key is required;
- review is after start and not after expiry;
- expiry is at most 365 days;
- release never permits messaging;
- renewal is a new hold record, not mutation;
- purge uses `retain_until, id` stable order and batch 1–100;
- exact-edge record is eligible when `retain_until <= now`;
- active hold skips only its target;
- expired/released hold does not block purge;
- failed row increments bounded failure count and does not loop;
- reads/retries do not extend retention;
- expired suppression deletes without restoring consent;
- completed tombstone permanently deletes at expiry;
- counts contain no identifiers; and
- running the same purge twice is idempotent.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts
```

Expected: FAIL because the purge module does not exist.

- [ ] **Step 3: Implement hold lifecycle**

Validate exact bounded enums and times, authorize, insert immutable hold, and release only by setting released-at once. Reject free text and silent extension. A renewal creates a new row referencing the same target after a fresh authorization check.

- [ ] **Step 4: Implement bounded purge**

Process record families in dependency order:

1. notifications;
2. SMS log;
3. terminal quote sends;
4. stale consent projection;
5. expired consent events;
6. lifted/expired suppressions;
7. completed deletion tombstones; and
8. expired hold audit rows after their five-year proof window.

Each family selects at most the remaining batch budget with `FOR UPDATE SKIP LOCKED`, excludes active holds, deletes only `retain_until <= now`, and returns a count. A family error rolls back that family, increments `failed` once, and allows later families only when dependency safety remains provable.

Do not add an API route or Vercel cron. Row 35/production enablement owns scheduled invocation after provider and public-policy gates.

- [ ] **Step 5: Run focused proof**

```bash
pnpm test tests/unit/shop-os-messaging-retention-policy.test.ts tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: all messaging domain tests PASS and static checks exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/shop-os/messaging-retention-purge.ts tests/unit/shop-os-messaging-retention-purge.test.ts
git commit -m "Add bounded messaging retention purge"
```

---

### Task 8: Whole-Branch Verification, Reviews, and Durable Closure

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify only if a new lesson was triggered: `tasks/lessons.md`

**Interfaces:**
- Consumes all Task 1–7 outputs.
- Produces the verified Row 31 source checkpoint. It does not apply production DDL.

- [ ] **Step 1: Run the complete focused suite**

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-messaging-retention-policy.test.ts tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts tests/unit/shop-os-server-only-acl.test.ts tests/unit/shop-os-capabilities.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-versions.test.ts
```

Expected: all focused/adjacent files and tests PASS with zero failures.

- [ ] **Step 2: Run the full repository gates**

Run serially:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

Expected: full suite PASS, TypeScript exits 0, production build exits 0, diff check exits 0.

- [ ] **Step 3: Review the actual branch**

Require independent review for:

- PostgreSQL schema/migration/trigger/lock correctness;
- tenant isolation, complete ACL/RLS, HMAC/key handling, and log privacy;
- consent/revocation/deletion legal-product consistency against Row 25 and Row 31;
- quote-send compatibility and no diagnostic-engine behavior change; and
- whole-branch senior regression/overengineering review.

Address findings test-first. Re-run affected focused tests after every fix and the full gates after the final fix.

- [ ] **Step 4: Update durable status only from proof**

In the active-plan Row 31 entry record:

- source implementation PR and stable merge commit only after merge;
- exact focused/full test counts;
- TypeScript/build/diff results;
- independent review results;
- explicit no-production-DDL/no-message/no-provider/no-credential/no-spend statement; and
- production migration as the next separate owner gate.

Update `SHOP_OS_DRIVER_STATE.md` with current slice, last proof, next safe move, open gates, and worker lanes. Do not write a self-referential branch-head hash.

- [ ] **Step 5: Commit the verified closeout**

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md tasks/lessons.md
git commit -m "Record verified Shop OS Row 31 source"
```

Stage `tasks/lessons.md` only when it changed.

- [ ] **Step 6: Stop at the production gate**

Return:

- source PR/commit;
- focused/full counts;
- TypeScript/build/diff results;
- review outcomes;
- exact production migration SQL and rollback packet location; and
- statement that live DDL, public policy publication, provider work, messaging, credentials, spend, and real customer data were skipped.

Do not apply migration 0033/0034, enable a cron, create a provider account, or send a test/customer message without a new explicit owner approval.

## Stop conditions

- Stop before live Supabase mutation, migration apply, rollback, public policy publication, provider account/credential action, spend, feature enablement, or customer/test-number send.
- Stop if the source implementation needs a raw phone number in a compliance table, log, error, fixture, snapshot, or tombstone.
- Stop if deletion cannot durably commit suppression before retryable cleanup.
- Stop if consent eligibility cannot fail closed on missing/contradictory state or compliance-store failure.
- Stop if a client role gains direct/effective access to any compliance table or function.
- Stop if preserving quote, repair, and diagnostic behavior requires an engine change.
- Stop after two failed attempts at the same migration-generation or locking approach and return the exact evidence for re-planning.
