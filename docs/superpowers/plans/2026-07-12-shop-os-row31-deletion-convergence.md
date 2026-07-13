# Shop OS Row 31 Deletion Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every permanent messaging-deletion `busy` ceiling with a bounded, retry-safe workflow that coalesces duplicate requests and completes one exact privacy-safe tombstone after finite retries.

**Architecture:** A partial unique index makes one pending deletion request canonical per `(shop_id, customer_id)`. Each cleanup call locks shop → canonical request → customer, mutates no more than the existing family/aggregate budgets, and atomically advances a strict monotonic progress envelope; a bounded security-definer function authorizes exact consent-event batches. Cursor-independent final reconciliation prevents late rows, random UUID ordering, or expired holds from being skipped before the one terminal pending → completed transition.

**Tech Stack:** TypeScript 6, Drizzle ORM SQL templates, PostgreSQL/PGlite PL/pgSQL triggers and security-definer functions, Vitest, pnpm.

## Global Constraints

- Authority is `docs/superpowers/specs/2026-07-12-shop-os-row31-deletion-convergence-design.md`, then Task 6 of `docs/superpowers/plans/2026-07-12-shop-os-row31-messaging-retention-deletion.md`, then `AGENTS.md`.
- Suppression commits before cleanup and remains active through every retry.
- One canonical pending deletion operation coordinates a `(shop_id, customer_id)` at a time.
- Every cleanup call locks shop → canonical request → customer before resource rows.
- Preserve the existing resource lock order: quote sends → consent projections/events → child SMS logs → notifications → active holds.
- A call may commit no more than `MAX_SENDS = 128`, `MAX_CONSENT_EVENTS = 256`, `MAX_CONSENT_PROJECTIONS = 128`, `MAX_SMS_LOGS = 512`, `MAX_NOTIFICATIONS = 256`, `MAX_HOLDS = 256`, and `MAX_TOTAL_RESOURCES = 1024` successful family outcomes.
- Pending progress is exact, monotonic, below 4 KiB, and contains no destination, customer name/ID, phone number, token, message content, evidence payload, vehicle detail, provider payload, or secure URL.
- Transaction failure rolls back both resource mutation and progress; completed tombstones remain immutable.
- Active holds remain narrow; held content is never copied into progress or the tombstone.
- Preserve exact multi-key suppression validation and multi-subject cleanup.
- Preserve request-key idempotency, cross-shop isolation, live actor authorization, and no readable destination identity in results/errors.
- Do not apply a migration, touch production, provider/routes/UI/cron/credentials/public policy/diagnostic engine, or enable messaging.
- Existing uncommitted RED tests and `tasks/lessons.md` belong to the current worktree; do not discard, stage, or commit `tasks/lessons.md`.
- Stop if the implementation needs a new table, a cursor containing readable identity, an unbounded mutation query, a relaxed suppression check, or a lock-order inversion.

## File Map

- `drizzle/migrations/0033_shop_os_messaging_retention.sql` — canonical pending-request index, pending-progress constraint/guard, canonical quote-send lifecycle lookup, bounded consent compaction, and exact deferred delete authorization.
- `lib/db/schema.ts` — exact Drizzle mirror of the changed request constraint and partial unique index.
- `lib/shop-os/messaging-deletion.ts` — progress types/parsing, request coalescing, bounded family passes, cursor advancement, count accumulation, final reconciliation, and completion.
- `tests/helpers/db.ts` — exact function signatures, marker counts, trigger metadata, and normalized function digests for migration drift detection.
- `tests/unit/shop-os-messaging-retention-schema.test.ts` — direct database RED/GREEN proof for canonical requests, monotonic progress, bounded definer authorization, rollback, and immutable completion.
- `tests/unit/shop-os-messaging-retention-acl.test.ts` — exact ACL proof for the replacement definer signature.
- `tests/unit/shop-os-messaging-deletion.test.ts` — handler/runtime coalescing, all-family convergence, exact counts, failure rollback, holds, idempotency, and privacy proof.
- `tests/unit/shop-os-messaging-consent.test.ts` — suppression and `deletion_pending` regression coverage.
- `tests/unit/shop-os-messaging-retention-purge.test.ts` — purge/compaction authorization separation regression coverage.
- `.superpowers/sdd/deletion-convergence-fix-report.md` — final RED/GREEN commands, results, diff review, skipped work, and concerns; do not commit it because the directory is ignored.

---

### Task 1: Canonical Pending Operation and Strict Monotonic Progress

**Files:**
- Modify: `drizzle/migrations/0033_shop_os_messaging_retention.sql:102-147,376-453,1160-1204`
- Modify: `lib/db/schema.ts:1290-1396`
- Modify: `lib/shop-os/messaging-deletion.ts:156-335,346-510`
- Modify: `tests/helpers/db.ts:300-410,500-725`
- Modify: `tests/unit/shop-os-messaging-retention-schema.test.ts:1812-1870`
- Modify: `tests/unit/shop-os-messaging-deletion.test.ts:250-475`

**Interfaces:**
- Consumes: existing `MessagingDeletionResult`, `requestMessagingDeletion`, `semanticCustomerBinding`, `liveAuthority`, and suppression normalization.
- Produces:

```ts
export type PriorRecordCounts = Readonly<{
  consentEvents: number
  consentProjections: number
  notifications: number
  quoteSends: number
  smsLogs: number
}>

export type DeletionResultCounts = Readonly<{
  consentEventsDeleted: number
  notificationsDeleted: number
  smsLogsDeleted: number
  quoteSendsDeleted: number
  quoteSendsRetained: number
}>

export type DeletionHeldCounts = Readonly<{
  heldConsentEvents: number
  heldConsentProjections: number
  heldQuoteSends: number
  heldSmsLogs: number
  heldNotifications: number
  total: number
}>

export type DeletionCursor = Readonly<{ at: string; id: string }>

export type PendingDeletionProgress = Readonly<{
  progressVersion: 1
  resultCounts: DeletionResultCounts
  heldCounts: DeletionHeldCounts
  detachedSuppressionSources: number
  cursors: Readonly<Partial<Record<
    'quoteSends' | 'consentSubjects' | 'consentEvents' |
    'smsLogs' | 'notifications' | 'holds',
    DeletionCursor
  >>>
}>
```

- Produces database invariant: at most one row satisfies `state = 'pending' and customer_id is not null` for a `(shop_id, customer_id)`.
- Produces pending mutation invariant: only `prior_record_counts` and `proof_summary` may change; exact allowed keys contain non-negative safe integers, and every count/cursor tuple is lexicographically monotonic.

- [ ] **Step 1: Preserve and extend the failing schema tests**

Keep the existing uncommitted `allows monotonic pending cleanup progress and rejects tampering before final completion` RED. Make its progress object match the exact interface above and add these assertions in the same test transaction:

```ts
const zeroProgress: PendingDeletionProgress = {
  progressVersion: 1,
  resultCounts: {
    consentEventsDeleted: 0, notificationsDeleted: 0, smsLogsDeleted: 0,
    quoteSendsDeleted: 0, quoteSendsRetained: 0,
  },
  heldCounts: {
    heldConsentEvents: 0, heldConsentProjections: 0, heldQuoteSends: 0,
    heldSmsLogs: 0, heldNotifications: 0, total: 0,
  },
  detachedSuppressionSources: 0,
  cursors: {},
}
const firstCounts = {
  consentEvents: 0, consentProjections: 0, notifications: 1,
  quoteSends: 2, smsLogs: 1,
}
const firstProgress = {
  ...zeroProgress,
  resultCounts: {
    ...zeroProgress.resultCounts,
    notificationsDeleted: 1, smsLogsDeleted: 1, quoteSendsDeleted: 2,
  },
  cursors: {
    quoteSends: { at: '2026-07-12T10:00:00.000Z', id: crypto.randomUUID() },
  },
}
await client.query(
  `update messaging_deletion_requests
   set prior_record_counts = $1, proof_summary = $2 where id = $3`,
  [firstCounts, firstProgress, requestId],
)
```

Assert each of these rejects and leaves the previously committed progress byte-for-byte unchanged: decrement one count; delete one required key; add unknown key `destination`; use `Number.MAX_SAFE_INTEGER + 1`; move cursor time backward; change cursor ID backward at the same time; change customer, subject, request key/fingerprint, destination fingerprint, key version, reason, actor, requested time, state, or any completion/retention field.

- [ ] **Step 2: Add canonical-operation RED tests**

In `tests/unit/shop-os-messaging-retention-schema.test.ts`, insert one pending request and assert a second pending row for the same shop/customer fails with `messaging_deletion_requests_shop_customer_pending_uq`. In `tests/unit/shop-os-messaging-deletion.test.ts`, request deletion twice with distinct valid actor-bound request keys and fingerprints, then assert:

```ts
expect(second).toEqual({
  ok: true,
  requestId: first.requestId,
  state: 'pending',
})
expect(await db.select().from(messagingDeletionRequests)).toHaveLength(1)
expect(await db.select().from(smsSuppressions)).toHaveLength(Object.keys(keyRing.keys).length)
```

Also retry the canonical key with a changed fingerprint and require `{ ok: false, error: 'request_conflict' }`.

- [ ] **Step 3: Run Task 1 tests and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'monotonic pending cleanup progress|canonical pending deletion'
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'coalesces a second deletion request'
```

Expected: the progress test fails with `messaging deletion requests permit pending to completed exactly once`; the direct duplicate insert succeeds or lacks the named unique violation; the runtime test creates two request rows or returns a second request ID.

- [ ] **Step 4: Add the canonical index and pending-state constraint**

In migration 0033 and the Drizzle mirror, add this exact partial unique index:

```sql
create unique index messaging_deletion_requests_shop_customer_pending_uq
on messaging_deletion_requests (shop_id, customer_id)
where state = 'pending' and customer_id is not null;
```

Replace `messaging_deletion_requests_state_consistent` so pending rows allow either both progress columns null (fresh request) or both non-null (started cleanup), while completion fields remain null:

```sql
(state = 'pending' and customer_id is not null
  and completed_at is null and latest_relevant_at is null and retain_until is null
  and ((prior_record_counts is null and proof_summary is null)
    or (prior_record_counts is not null and proof_summary is not null)))
or
(state = 'completed' and customer_id is null
  and completed_at is not null and latest_relevant_at is not null
  and prior_record_counts is not null and proof_summary is not null
  and retain_until is not null)
```

Do not add a table or a new column.

- [ ] **Step 5: Replace the deletion-request mutation guard with exact validation**

Keep DELETE/purge and completed immutability branches unchanged. For `pending → pending`, first reject any identity/lifecycle change using row comparisons:

```sql
if new.state = 'pending' then
  if (new.id, new.request_key, new.request_fingerprint, new.shop_id,
      new.subject_key, new.customer_id, new.destination_fingerprint,
      new.fingerprint_key_version, new.reason_code,
      new.requesting_actor_profile_id, new.requested_at,
      new.completed_at, new.latest_relevant_at, new.retain_until)
    is distinct from
     (old.id, old.request_key, old.request_fingerprint, old.shop_id,
      old.subject_key, old.customer_id, old.destination_fingerprint,
      old.fingerprint_key_version, old.reason_code,
      old.requesting_actor_profile_id, old.requested_at,
      old.completed_at, old.latest_relevant_at, old.retain_until)
  then
    raise exception 'messaging deletion request identity is immutable';
  end if;
```

Require the exact top-level proof keys with:

```sql
if jsonb_typeof(new.prior_record_counts) <> 'object'
  or jsonb_typeof(new.proof_summary) <> 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(new.prior_record_counts) key)
    <> array['consentEvents','consentProjections','notifications','quoteSends','smsLogs']
  or (select array_agg(key order by key) from jsonb_object_keys(new.proof_summary) key)
    <> array['cursors','detachedSuppressionSources','heldCounts','progressVersion','resultCounts']
  or new.proof_summary->>'progressVersion' <> '1'
then
  raise exception 'invalid messaging deletion progress proof';
end if;
```

Validate the exact result/held/cursor key sets, JSON number type, integer text regex `^(0|[1-9][0-9]{0,15})$`, value `<= 9007199254740991`, cursor time parseability, UUID parseability, and cursor key membership. Compare `coalesce(old count, 0) <= new count`; compare cursor `(at::timestamptz, id::uuid)` tuples; reject regressions with `messaging deletion progress must be monotonic`. Keep `pending → completed` as the only other accepted update and retain all immutable identity checks.

- [ ] **Step 6: Make the quote-send lifecycle guard consume only the canonical request**

Replace the loop over all matching pending requests with one exact lookup protected by the partial unique index:

```sql
select deletion_request.id, deletion_request.requested_at
into locked_request_id, locked_request_requested_at
from public.messaging_deletion_requests deletion_request
where deletion_request.shop_id = old.shop_id
  and deletion_request.customer_id = old.customer_id
  and deletion_request.state = 'pending'
for share;

if found then
  approved_deletion_barrier := locked_request_requested_at + interval '5 years';
end if;
```

Keep the exact old-send `(shop_id, destination_fingerprint, fingerprint_key_version)` suppression lookup, non-liftable reason set, and `retain_until >= approved_deletion_barrier` check unchanged. Extend the schema test to inspect `pg_get_functiondef`, require the canonical lookup and `FOR SHARE`, reject a restored request loop, and prove current plus legacy-key held sends still detach only behind their exact strong barriers.

- [ ] **Step 7: Coalesce runtime requests under the shop/customer lock**

In `requestMessagingDeletion`, preserve the current exact actor/request-key lookup before coalescing. After all supported-key suppressions are normalized, select the canonical row:

```ts
const canonical = unwrapRows<RequestRow>(await tx.execute(sql`
  select id, shop_id as "shopId", request_key as "requestKey",
    request_fingerprint as "requestFingerprint", customer_id as "customerId",
    destination_fingerprint as "destinationFingerprint",
    fingerprint_key_version as "fingerprintKeyVersion", state,
    reason_code as "reasonCode",
    requesting_actor_profile_id as "requestingActorProfileId",
    prior_record_counts as counts, proof_summary as proof
  from messaging_deletion_requests
  where shop_id = ${input.actor.shopId}::uuid
    and customer_id = ${input.customerId}::uuid and state = 'pending'
  for update
`))[0]
if (canonical) {
  return { ok: true, requestId: canonical.id, state: 'pending' }
}
```

Insert only when no canonical row exists. Extend structured unique-race recovery to recognize `messaging_deletion_requests_shop_customer_pending_uq`, reacquire shop → actor → customer → canonical request, revalidate the live customer/destination and strong suppressions, and return only that canonical ID. Do not echo either fingerprint.

- [ ] **Step 8: Update exact schema fixtures and function digests**

Update `tests/helpers/db.ts` expected index count from 28 to 29, add the partial index predicate to marker inspection, and update the normalized SHA-256 digests for `guard_messaging_deletion_request_mutation()` and `guard_quote_send_lifecycle()` after their final SQL is stable. Compute each digest with the same normalization as the fixture:

```bash
node -e "const fs=require('fs'),c=require('crypto');const s=fs.readFileSync('/tmp/guard.sql','utf8').trim().replace(/\\s+/g,' ');console.log(c.createHash('sha256').update(s).digest('hex'))"
```

Obtain `/tmp/guard.sql` from `select prosrc from pg_proc where oid = 'guard_messaging_deletion_request_mutation()'::regprocedure` in the focused PGlite test; never hash a hand-edited approximation.

- [ ] **Step 9: Run Task 1 GREEN tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'monotonic pending cleanup progress|canonical pending deletion|pending-to-completed'
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'coalesces a second deletion request|request-key|suppression'
pnpm exec tsc --noEmit
git diff --check
```

Expected: all selected tests pass; TypeScript and diff checks exit 0. Verify a rejected progress update leaves the prior JSON unchanged and suppression rows remain active.

- [ ] **Step 10: Review and commit Task 1**

Review:

```bash
git diff -- drizzle/migrations/0033_shop_os_messaging_retention.sql lib/db/schema.ts lib/shop-os/messaging-deletion.ts tests/helpers/db.ts tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-deletion.test.ts
git status --short
```

Stage only Task 1 files; explicitly exclude `tasks/lessons.md`, the ignored report, and later-task files.

```bash
git add drizzle/migrations/0033_shop_os_messaging_retention.sql lib/db/schema.ts lib/shop-os/messaging-deletion.ts tests/helpers/db.ts tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-deletion.test.ts
git commit -m "Canonicalize messaging deletion progress"
```

Rollback/stop gate: revert this Task 1 commit only if the partial unique index breaks clean-source migration or exact request-key conflict behavior cannot coexist with canonical coalescing; do not weaken either invariant.

---

### Task 2: Bounded Consent Compaction and Exact Deferred Authorization

**Files:**
- Modify: `drizzle/migrations/0033_shop_os_messaging_retention.sql:685-960,1310-1323`
- Modify: `tests/helpers/db.ts:320-390,540-650,760-845`
- Modify: `tests/unit/shop-os-messaging-retention-schema.test.ts:1845-2190,2296-2425`
- Modify: `tests/unit/shop-os-messaging-retention-acl.test.ts:20-205,280-310`
- Modify: `tests/unit/shop-os-messaging-deletion.test.ts:590-700`

**Interfaces:**
- Consumes: canonical pending request and `PendingDeletionProgress` from Task 1.
- Replaces:

```sql
compact_messaging_consent_events(uuid, uuid, uuid) returns integer
```

- Produces:

```sql
compact_messaging_consent_events(
  p_shop_id uuid,
  p_subject_key uuid,
  p_request_id uuid,
  p_after_event_id uuid,
  p_batch_limit integer
) returns table (
  deleted_count integer,
  detached_suppression_sources integer,
  next_event_id uuid,
  exhausted boolean
)
```

- `p_batch_limit` must be between 1 and 256. The function authorizes and deletes at most that many event IDs, updates canonical progress in the same transaction, and accumulates exact event IDs in transaction-local settings.

- [ ] **Step 1: Write bounded-compaction RED tests**

In the schema test, seed 257 same-customer events under one subject, one projection, a canonical pending request, and strong exact-key suppressions. Call:

```ts
const first = await client.query<{
  deleted_count: number
  detached_suppression_sources: number
  next_event_id: string
  exhausted: boolean
}>(`
  select * from compact_messaging_consent_events($1, $2, $3, $4, $5)
`, [shopId, subjectKey, requestId, '00000000-0000-0000-0000-000000000000', 256])
expect(first.rows[0]).toMatchObject({ deleted_count: 256, exhausted: false })
```

Commit the first transaction and assert request state is still pending, exactly one original event remains, progress counts increased by 256, and suppression remains active. Call again with `next_event_id`; expect one deletion, `exhausted: true`, zero remaining original events, and accumulated count 257.

- [ ] **Step 2: Add authorization, hold, rollback, and limit RED tests**

Require the five-argument function to reject: limit 0; limit 257; wrong shop/request/customer; non-canonical request; mixed subject ownership; active subject hold; active hold on any selected event; cursor regression; direct event DELETE with spoofed settings; event IDs not selected by the definer; mixing purge and compaction contexts; and a second request/shop in one transaction. Inject a request-progress guard failure after selection and assert event deletes, suppression-source detachment, and progress all roll back.

Keep purge tests proving `purge_expired_messaging_consent_event` settings cannot authorize compaction and compaction settings cannot authorize purge.

- [ ] **Step 3: Run Task 2 tests and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'bounded consent compaction|exact event authorization|compaction.*rollback'
pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts -t 'function'
```

Expected: PostgreSQL reports the five-argument function does not exist; old deferred authorization rejects pending batch commits; ACL expectations still reference the three-argument signature.

- [ ] **Step 4: Replace subject-wide deferred authorization with exact event IDs**

In `reject_messaging_consent_event_mutation`, retain the purge branch unchanged. For compaction, parse transaction-local settings:

```text
vyntechs.messaging_consent_compaction_request
vyntechs.messaging_consent_compaction_shop
vyntechs.messaging_consent_compaction_events
```

Allow DELETE only when current user owns the exact five-argument security-definer function, old shop equals configured shop, and old ID is in the configured UUID array. In `require_messaging_compaction_completion`, replace subject/completed checks with the same exact request/shop/event checks and require the request to remain the same-shop canonical `state = 'pending'` row or to be the same row completed later in the transaction. Reject all malformed settings closed.

- [ ] **Step 5: Implement the bounded security-definer function**

Use this order inside the function: reject mixed purge context → validate 1..256 limit → lock canonical request `FOR UPDATE` → validate existing request/shop context → lock subject projection by ID → lock selected event page by `(committed_at, id)` → prove exact ownership → reject subject/event holds → detach selected suppression source references → authorize exact event IDs in transaction-local context → delete exact IDs → monotonically update request progress → return cursor/exhaustion.

Read `cursor_at` and the stored cursor ID from `proof_summary.cursors.consentEvents`; for a fresh request use `('-infinity', '00000000-0000-0000-0000-000000000000')`. Require `p_after_event_id` to equal the stored ID so a caller cannot skip or rewind rows. Write the returned `(committed_at, id)` tuple back into that same cursor atomically with counts before returning.

The selected page must be:

```sql
select e.id, e.committed_at, e.event_type
from public.messaging_consent_events e
where e.shop_id = p_shop_id
  and e.subject_key = p_subject_key
  and e.customer_id = request_customer_id
  and (e.committed_at, e.id) > (cursor_at, p_after_event_id)
order by e.committed_at, e.id
limit p_batch_limit + 1
for update
```

Delete only the first `p_batch_limit` IDs. Count synthetic `event_type = 'deleted' and program_version = 'internal_deletion_v1'` as authorization markers, not prior customer records: exclude them from `prior_record_counts.consentEvents` and `resultCounts.consentEventsDeleted`. Accumulate exact selected IDs with `array_agg(distinct id order by id)` before `set_config`. Delete the projection only when no event remains for the subject and no active hold exists.

- [ ] **Step 6: Update function ACLs and exact fixtures**

Replace every three-argument signature in migration ACL statements, `tests/helpers/db.ts`, and ACL tests with:

```text
compact_messaging_consent_events(uuid,uuid,uuid,uuid,integer)
```

Keep `SECURITY DEFINER`, owner `postgres`, `search_path = ''`, service-role execute only, and no PUBLIC/anon/authenticated execute. Update exact trigger/function marker fragments and normalized SHA-256 digests for the compact function, append-only guard, and deferred guard from PGlite `prosrc` using the Task 1 digest procedure.

- [ ] **Step 7: Run Task 2 GREEN tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'bounded consent compaction|exact event authorization|compaction.*rollback|unsafe privileged function|weakened customer-wide compaction'
pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts
pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts -t 'consent|authorization|purge'
pnpm exec tsc --noEmit
git diff --check
```

Expected: all selected tests pass; first batch commits while pending; second batch exhausts; unauthorized direct deletes fail; ACL and static checks exit 0.

- [ ] **Step 8: Review and commit Task 2**

```bash
git diff -- drizzle/migrations/0033_shop_os_messaging_retention.sql tests/helpers/db.ts tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
git status --short
git add drizzle/migrations/0033_shop_os_messaging_retention.sql tests/helpers/db.ts tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
git commit -m "Bound messaging consent deletion batches"
```

Rollback/stop gate: revert Task 2 if exact event IDs cannot authorize a committed pending batch without also authorizing arbitrary DELETE; never restore whole-subject or marker-only authorization.

---

### Task 3: Runtime Family Batching, Exact Accumulation, and Final Reconciliation — Superseded Before Production

**Status:** Replaced before production by the request-scoped deletion work journal in `2026-07-13-shop-os-row31-deletion-work-journal.md`. The cursor-based runtime in this section was never applied; it is retained only as historical planning context.

**Files:**
- Modify: `lib/shop-os/messaging-deletion.ts:156-850`
- Modify: `tests/unit/shop-os-messaging-deletion.test.ts:150-1160`
- Modify: `tests/unit/shop-os-messaging-consent.test.ts` only for suppression/eligibility regression assertions
- Modify: `tests/unit/shop-os-messaging-retention-purge.test.ts` only for shared compaction/purge regression assertions

**Interfaces:**
- Consumes: canonical request/progress from Task 1 and bounded five-argument consent definer from Task 2.
- Produces internal helpers:

```ts
type CleanupFamily =
  | 'quoteSends'
  | 'consentSubjects'
  | 'consentEvents'
  | 'smsLogs'
  | 'notifications'
  | 'holds'

type CleanupBudget = Readonly<{
  sends: number
  consentEvents: number
  consentProjections: number
  smsLogs: number
  notifications: number
  holds: number
  total: number
}>

type CleanupDelta = Readonly<{
  prior: PriorRecordCounts
  results: DeletionResultCounts
  detachedSuppressionSources: number
  cursors: PendingDeletionProgress['cursors']
  outcomes: number
}>

function parsePendingProgress(row: CleanupRequest): PendingDeletionProgress
function addCleanupDelta(
  progress: PendingDeletionProgress,
  prior: PriorRecordCounts,
  delta: CleanupDelta,
): Readonly<{ progress: PendingDeletionProgress; prior: PriorRecordCounts }>
function hasCleanupBudget(budget: CleanupBudget): boolean
```

- `completeMessagingDeletion` retains its public signature. A successful nonterminal pass returns `{ ok: true, requestId, state: 'pending', counts: accumulatedResultCounts }`; a completed retry returns the immutable final counts.

- [ ] **Step 1: Preserve the 129-send RED and convert every former ceiling assertion to convergence RED**

Keep the existing uncommitted 129-send test. Replace each `maximum + 1 => busy` expectation with a bounded retry loop:

```ts
async function completeUntilTerminal(requestId: string, maximumAttempts: number) {
  const snapshots: MessagingDeletionResult[] = []
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const result = await completeMessagingDeletion({ db, actor: owner, requestId, now })
    snapshots.push(result)
    const barriers = await db.select().from(smsSuppressions)
    expect(barriers.every((row) => row.liftedAt === null
      && ['verified_deletion', 'permanent_failure', 'number_reassigned'].includes(row.reason)))
      .toBe(true)
    if (!result.ok || result.state === 'completed') return { result, snapshots }
  }
  throw new Error('deletion did not converge within deterministic attempt budget')
}
```

Use deterministic attempt ceilings of `2 + Math.ceil(resourceCount / familyLimit)` per isolated family and `10 + Math.ceil(total / MAX_TOTAL_RESOURCES)` for mixed resources. Require exact accumulated prior/result counts and one completed tombstone.

- [ ] **Step 2: Add all-family and mixed-total RED datasets**

Add separate tests for 129 sends, 257 same-subject consent events, 129 projections across distinct subjects, 513 SMS rows, 257 notifications, 257 active holds, and 1,025 mixed total resources. For held families, assert each retained resource is counted once across retries. Add a multi-key/multi-subject case where one held subject remains, one unheld subject spans two consent batches, and current/legacy sends both converge.

Expected final counts must be literal fixture totals, not derived from implementation responses.

- [ ] **Step 3: Add rollback, cursor, idempotency, and late-row RED tests**

For each family mutation, inject failure immediately before pending progress UPDATE and require resource rows plus progress to roll back. Inject failure immediately after progress UPDATE and before commit with the same expectation. Retry normally and require one count per resource.

Add these cursor-independent reconciliation cases:

- a retained held record sorts before the stored cursor, its hold expires, and a later retry deletes it;
- a new privacy-safe notification is inserted between retries with an ordering UUID below the cursor and is still deleted;
- a new hold is inserted between retries and is honored;
- repeated completed calls return byte-identical counts/proof;
- two concurrent completion calls serialize behind the shop/canonical request locks.

- [ ] **Step 4: Run Task 3 tests and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'converges|ceiling|aggregate|rollback|cursor|late|concurrent'
```

Expected: current code returns permanent `busy` for every `limit + 1` dataset, creates no progress, and fails the late-row/final-count assertions.

- [ ] **Step 5: Implement exact progress parsing and accumulation**

Parse only own enumerable plain-object properties. Reject malformed stored progress with `retryable`; never repair it silently. Initialize fresh rows with all zero count objects and empty cursors. `addCleanupDelta` must use `Number.isSafeInteger`, reject negative/overflow results, sum prior/result/detachment counts exactly, and accept only cursor tuples that advance `(Date.parse(at), id)`.

The pending UPDATE must set both JSON columns in one statement and retain `state = 'pending'`:

```ts
await tx.execute(sql`
  update messaging_deletion_requests
  set prior_record_counts = ${JSON.stringify(next.prior)}::jsonb,
      proof_summary = ${JSON.stringify(next.progress)}::jsonb
  where id = ${request.id}::uuid and state = 'pending'
`)
```

Return pending only after that transaction commits.

- [ ] **Step 6: Implement one bounded resource pass per transaction**

Always lock shop → canonical request → customer first. Remove `MAX_PENDING_REQUESTS` and sibling scans because the partial unique index proves one canonical row. Select family pages by stable server timestamp plus UUID and `limit familyRemaining + 1`; mutate only the first `familyRemaining`. Decrement `MAX_TOTAL_RESOURCES` for every deleted, detached, or lawfully classified retained resource.

Within a quote-send graph pass: lock sends first; lock relevant consent rows only when needed for subject classification; lock child SMS; lock notifications; lock active holds last. Never delete a send until all child SMS pages are exhausted. Delete unheld children, preserve held children, then delete an unheld parent or detach/revoke a held parent according to `cancellable`/`inFlight` without changing immutable subject identity or submission anchors.

Within consent passes: append exactly one internal deletion marker per subject using deterministic request key:

```sql
(md5(request.id::text || ':' || subject_key::text))::uuid
```

Detach exact suppression sources for the selected batch, call the five-argument definer, and delete the projection only after the definer reports exhausted. Held subjects advance a privacy-safe `(updated_at, subject_key)` cursor but do not increment `heldCounts` yet; final reconciliation computes retained counts once so an expired hold cannot overcount.

Notification and hold scans use `(created_at, id)` and `(starts_at, id)` respectively. A cursor is an optimization for immutable lawfully retained rows, never completion authority.

- [ ] **Step 7: Implement cursor-independent final reconciliation**

Before completion, under the same shop → request → customer lock, query each family without cursor filters. Each query must return at most `familyLimit + 1` candidate rows and active-hold classification. If any unheld or not-yet-detached/deleted row exists, process a bounded delta and return pending.

When only lawfully retained rows remain, compute exact retained counts with aggregate `count(distinct resource_id)` queries (bounded scalar results), verify all customer-readable links that may lawfully detach are null, verify every relevant suppression is active/non-liftable through request time + five years, and require no unheld consent event/projection, SMS log, notification, or customer-bound send remains.

Construct the final proof from accumulated counts plus reconciled held counts:

```ts
const finalProof = Object.freeze({
  version: 2,
  customerBinding: semanticCustomerBinding({
    shopId: request.shopId,
    customerId: request.customerId,
    requestKey: request.requestKey,
    requestFingerprint: request.requestFingerprint,
    reasonCode: request.reasonCode,
    requestingActorProfileId: request.requestingActorProfileId,
  }),
  suppressionActive: 1,
  deletedBarrier: 1,
  suppressionSourceReferencesDetached: progress.detachedSuppressionSources,
  suppressionSourcesDetached: progress.detachedSuppressionSources > 0,
  retained: reconciledHeldCounts,
  resultCounts: progress.resultCounts,
})
```

Do not copy `cursors` or any progress-only field into the completed proof. Complete exactly once with null customer ID, monotonic database completion time, exact five-calendar-year retention, and accumulated prior counts.

- [ ] **Step 8: Run Task 3 GREEN tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-deletion.test.ts
pnpm test tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: complete deletion file passes, every former ceiling converges within its deterministic attempt budget, consent/purge regressions pass, and static checks exit 0.

- [ ] **Step 9: Review and commit Task 3**

```bash
git diff -- lib/shop-os/messaging-deletion.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
git status --short
git add lib/shop-os/messaging-deletion.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
git commit -m "Make messaging deletion retries converge"
```

Rollback/stop gate: revert Task 3 if any family can commit a mutation without the matching count/cursor, if a retry can double-count, if final reconciliation trusts cursors, or if one call exceeds any family/total budget.

---

### Task 4: Full Row 31 Verification and Closure

**Files:**
- Modify: `.superpowers/sdd/deletion-convergence-fix-report.md` (ignored evidence only; do not stage)
- Test only: `tests/unit/shop-os-messaging-retention-schema.test.ts`
- Test only: `tests/unit/shop-os-messaging-retention-acl.test.ts`
- Test only: `tests/unit/shop-os-messaging-retention-policy.test.ts`
- Test only: `tests/unit/shop-os-messaging-consent.test.ts`
- Test only: `tests/unit/shop-os-messaging-deletion.test.ts`
- Test only: `tests/unit/shop-os-messaging-retention-purge.test.ts`
- Test only: `tests/unit/shop-os-quote-decisions.test.ts`
- Test only: `tests/unit/shop-os-quote-versions.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3 commits.
- Produces: reviewable proof that migration/schema/runtime/ACL behavior matches the owner-approved convergence design; no production apply.

- [ ] **Step 1: Run focused convergence and canonical-operation proof**

```bash
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'converges|coalesces|ceiling|aggregate|rollback|cursor|late|concurrent'
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'canonical pending deletion|monotonic pending cleanup progress|bounded consent compaction|exact event authorization'
```

Expected: all focused tests pass with zero skipped selected cases and no warning/error output.

- [ ] **Step 2: Run complete Row 31 schema, ACL, policy, consent, deletion, and purge suites**

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-messaging-retention-policy.test.ts tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
```

Expected: all test files pass. Exact schema marker/digest/authority counts and ACL checks remain green.

- [ ] **Step 3: Run adjacent quote lifecycle regressions**

```bash
pnpm test tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-versions.test.ts
```

Expected: quote-send lifecycle, immutable quote-event references, and quote-version behavior pass unchanged.

- [ ] **Step 4: Run static and diff verification**

```bash
pnpm exec tsc --noEmit
git diff --check
git status --short
```

Expected: TypeScript and diff checks exit 0. Status contains no staged or committed `tasks/lessons.md`, no production credential/config change, and no file outside the authorized source/test boundary.

- [ ] **Step 5: Perform source-level safety review**

Run:

```bash
rg -n "MAX_(SENDS|CONSENT_EVENTS|CONSENT_PROJECTIONS|SMS_LOGS|NOTIFICATIONS|HOLDS|TOTAL_RESOURCES)|limit .*\+ 1|state: 'pending'|state: 'completed'" lib/shop-os/messaging-deletion.ts
rg -n "messaging_deletion_requests_shop_customer_pending_uq|compact_messaging_consent_events|messaging_consent_compaction_events|security definer|set search_path = ''" drizzle/migrations/0033_shop_os_messaging_retention.sql
rg -n "destination|phone|token|message|evidence" lib/shop-os/messaging-deletion.ts tests/unit/shop-os-messaging-deletion.test.ts
```

Confirm manually: every mutation path decrements a family and total budget; every pending commit writes progress atomically; no pending proof includes forbidden readable fields; exact suppressions remain active; no raw SQL interpolation (`sql.raw`) was added; final proof excludes cursors; and completed retry reads stored immutable result counts.

- [ ] **Step 6: Write the closure report**

Append to `.superpowers/sdd/deletion-convergence-fix-report.md`:

Use these literal section labels and replace each section body with the observed command output or database result; omit no section:

```text
Status
Commits
RED proof
GREEN proof
Canonical operation
Bounded convergence (129 sends; 257 consent events; 129 projections;
513 SMS rows; 257 notifications; 257 holds; 1,025 mixed resources)
Rollback proof
Privacy review
Production apply: not performed; remains a separate owner gate
Skipped/Failed
```

Do not stage the ignored report.

- [ ] **Step 7: Review commit boundaries and close**

```bash
git log -3 --oneline
git show --stat --oneline HEAD~2
git show --stat --oneline HEAD~1
git show --stat --oneline HEAD
git status --short
```

Expected commit subjects, in order:

```text
Canonicalize messaging deletion progress
Bound messaging consent deletion batches
Make messaging deletion retries converge
```

If verification required a source/test correction, make one narrowly scoped fourth commit with subject `Close messaging deletion convergence regressions`, rerun Steps 1-5, and record it. Do not squash away independently reviewable Task 1-3 boundaries unless the control lane explicitly requests it.

Rollback/stop gate: stop closure on any failed suite, digest drift, unauthorized file, unbounded mutation, privacy leak, or suppression/hold regression. Do not apply migration 0033 to any external database.
