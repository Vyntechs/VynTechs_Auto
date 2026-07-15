# ShopOS Production Media Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every tooling task and `superpowers:verification-before-completion` before the tooling PR or production purge is called complete. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and independently verify an operator-only, fail-closed tool that inventories and permanently removes Vyntechs-controlled operational media without logging customer content or changing protected ShopOS records, then execute it only in a separate production lane after the no-media application release is deployed and proved.

**Architecture:** Keep destructive operations outside the Next.js application, API routes, cron routes, and migrations. A dependency-injected core produces aggregate-only signed-by-digest manifests; a thin production CLI binds independently supplied Supabase and database targets, performs complete keyset inventories, removes storage objects before deleting the bucket, and only then deletes `public.artifacts` plus `public.job_attachments` in one guarded PostgreSQL transaction. Tool implementation and production execution are separate deliverables: completing the tooling tasks does not run or authorize a production command.

**Tech Stack:** Node.js ESM, `postgres`, `@supabase/supabase-js`, Zod, Vitest, PostgreSQL 17 catalog functions, Supabase Storage API.

## Global Constraints

- Authority is the approved [ShopOS no-media shutdown and purge design](../specs/2026-07-15-shop-os-no-media-shutdown-and-purge-design.md), project `AGENTS.md`, and Row 49 of the active ShopOS plan.
- Production deletion remains a hard technical gate even though the founder authorized this exact purge outcome. Tasks 1–6 build and verify tooling only; Task 7 runs only in a fresh production-operator lane after every named prerequisite passes.
- The no-media application release must be merged, deployed, and production-proved before any destructive subcommand runs.
- The only deletable production resources are objects in the private `artifacts` bucket, the empty `artifacts` bucket itself, rows in `public.artifacts`, and rows in `public.job_attachments`.
- Keep the two media tables. Do not add, apply, or modify a database migration. Do not drop a table, column, constraint, policy, or function.
- Do not call `pnpm db:migrate`, `drizzle-kit migrate`, Supabase `emptyBucket`, or direct SQL against `storage.objects` for deletion.
- Object deletion must use the Supabase Storage API. Database-row deletion must use one direct PostgreSQL transaction.
- Every direct PostgreSQL connection must use certificate-verifying TLS with hostname verification. URL query parameters, including `sslmode=disable`, may never downgrade transport security. PostgreSQL debug output is disabled and notices are consumed by an explicit no-op callback; a falsey notice handler is forbidden because installed `postgres@3.4.9` falls back to `console.log`.
- Before a service-role key is copied into an adapter, supplied to `createClient`, or can reach any fetch/header path, `NEXT_PUBLIC_SUPABASE_URL` must match the exact canonical root `https://<validated-ref>.supabase.co/`, using HTTPS with its implicit default port and no explicit port, no userinfo, no path beyond `/`, no query, and no hash. The derived Storage URL must retain that exact HTTPS origin.
- No backup copy of media is created. Existing database backups are not represented as containing Storage bytes.
- Credentials are accepted from environment variables only inside a dedicated fail-fast operator child shell/process with silent `EXIT`, `HUP`, `INT`, and `TERM` cleanup. That process owns every secret-bearing validation and production CLI step, scrubs every purge variable and exits before any documentation or Git process starts. Never accept a service-role key, database URL, cookie, token, or password as a CLI argument or leave it exported in the controller's long-lived shell.
- Standard output, standard error, state files, Git, PR text, screenshots, and reports may contain only bounded aggregate counts, byte totals, UTC operation timestamps, commit SHAs, domain-separated keyed SHA-256 deletion-set/preservation digests, aggregate-manifest SHA-256 digests, the two allowlisted recovery statuses `committed|rolled-back`, and allowlisted error codes.
- Never emit media bytes, object keys, filenames, UUIDs, emails, vehicle/customer/job descriptions, signed URLs, environment values, Supabase raw errors, database raw errors, or stack traces.
- State files live only under ignored `tmp/no-media/$VYNTECHS_NO_MEDIA_RUN_ID/`, are created with mode `0600`, reject symbolic links, and are never committed.
- Every inventory page is keyset-paginated and must prove exhaustion. Any incomplete query, duplicate key, malformed byte count, schema drift, unexpected inbound foreign key, user trigger, target mismatch, or inventory drift fails closed.
- The tool never sleeps or waits internally. It records timestamps and returns `WAIT_WINDOW_NOT_SATISFIED` until a later invocation proves the required interval.
- The application remains available. Any legitimate concurrent protected-record change causes the next destructive gate to stop and requires fresh stable manifests; it is never ignored as noise.
- A media-route, diagnostic-release, service-worker privacy, deployment, authentication, schema, or preservation failure is stop-ship.
- Once the row transaction may have dispatched `COMMIT`, a lost acknowledgement, connection loss, or signal cannot be represented as rollback. It enters the fail-closed public state `COMMIT_STATUS_UNKNOWN`: scrub credentials, start no further mutation, and reconcile read-only in a fresh operator lane before deciding whether commit occurred.

## File Structure

- Create `scripts/production/no-media/core.mjs`: pure manifest, reconciliation, stability, redaction, and purge orchestration functions with injected database and storage adapters.
- Create `scripts/production/no-media/run.mjs`: target-bound PostgreSQL/Supabase adapters and the operator-only CLI.
- Create `tests/unit/no-media-production-script.test.ts`: core, CLI, privacy, pagination, target-binding, partial-failure, transaction, and state-machine regressions using fakes only.
- Modify `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`: record tooling readiness at the hard gate, then production zero-media proof only after Task 7 succeeds.
- Modify `docs/strategy/SHOP_OS_DRIVER_STATE.md`: keep the production purge as the next gated move after tooling verification; close it only after Task 7 proof.
- Append only to `docs/operations/2026-07-14-autoeye-lane-coordination.md`: announce the production mutation immediately before Task 7 and record the aggregate verdict afterward.

## Interfaces

`scripts/production/no-media/core.mjs` exports exactly:

```js
export class PurgeStop extends Error
export const BUCKET = 'artifacts'
export const MEDIA_TABLES = ['public.artifacts', 'public.job_attachments']
export const PROTECTED_SCHEMAS = ['public']
export const PROTECTED_AUTH_TABLES = ['auth.users']
export const VOLATILE_SCHEMA_RULES
export const EXPECTED_BUCKET_CATALOGS
export const DELETION_SOURCE_RELATIONS
export const APPROVED_DELETION_SOURCE_RELATIONSHIPS
export const MANIFEST_SCHEMA_VERSION = 1
export const canonicalJson
export const sha256
export const targetHash
export const collectInventory
export const assertStableInventories
export const assertObjectPurgeReady
export const purgeObjectsAndDeleteBucket
export const assertRowPurgeReady
export const purgeMediaRowsAtomically
export const verifyFinalState
export const readStateFile
export const writeStateFile
export const safeFailure
```

The injected database adapter implements:

```js
{
  readMediaRows(): Promise<{
    rows: Array<{
      table: 'artifacts' | 'job_attachments',
      storageKey: string,
      declaredBytes: bigint
    }>,
    keyedSets: {
      artifacts: { rows: bigint, declaredBytes: bigint, digest: string },
      jobAttachments: { rows: bigint, declaredBytes: bigint, digest: string }
    }
  }>,
  readStorageObjects(): Promise<{
    rows: Array<{ name: string, declaredBytes: bigint }>,
    keyedSet: { rows: bigint, declaredBytes: bigint, digest: string }
  }>,
  readBucketState(): Promise<'present-private' | 'absent' | 'unsafe'>,
  readReferenceCounts(): Promise<{
    mutableStories: bigint,
    immutableQuoteAttachments: bigint,
    immutableQuoteArtifactReferences: bigint,
    openSessionsWithMedia: bigint,
    activeJobsWithMedia: bigint
  }>,
  readSafetyFacts({ bucketCatalogExpectation }): Promise<{
    mediaTablesPresent: boolean,
    unexpectedInboundForeignKeys: bigint,
    unexpectedUserTriggers: bigint,
    deletionSourceRelationshipCount: bigint,
    deletionSourceRelationshipDigest: string,
    unapprovedDeletionSourceRelationships: bigint,
    protectedCascadePaths: bigint,
    bucketCatalogCount: bigint,
    bucketCatalogDigest: string,
    bucketCatalogExpectation: 'private-artifacts-only' | 'empty',
    unexpectedBucketEntries: bigint,
    objectsOutsideExpectedBuckets: bigint,
    mediaKeysOutsideArtifacts: bigint,
    protectedCatalogCount: bigint,
    protectedCatalogDigest: string,
    unclassifiedTables: bigint,
    safetyDigest: string
  }>,
  readProtectedFingerprints(): Promise<Array<{
    table: string,
    required: boolean,
    state: 'present' | 'absent',
    rows: bigint,
    digest: string
  }>>,
  deleteMediaRowsAtomically({ expectedFingerprints, expectedMediaSets, signal }): Promise<{
    artifactsDeleted: bigint,
    jobAttachmentsDeleted: bigint,
    commitAcknowledged: true,
    protectedFingerprints: Array<{
      table: string,
      required: boolean,
      state: 'present' | 'absent',
      rows: bigint,
      digest: string
    }>
  }>
}
```

The injected storage adapter implements:

```js
{
  removeObjects(names: string[]): Promise<void>,
  deleteBucket(name: 'artifacts'): Promise<void>
}
```

Each version-1 inventory state file contains only:

```js
{
  schemaVersion: 1,
  stage: 'baseline-1' | 'baseline-2' | 'bucket-barrier'
    | 'row-drain-1' | 'row-drain-2' | 'final',
  runId: string,
  capturedAt: string,
  deployedAt: string,
  deployedSha: string,
  targetHash: string,
  bucket: { state: 'present-private' | 'absent', objects: string, declaredBytes: string },
  keyedDeletionSets: {
    storageObjects: string,
    artifacts: string,
    jobAttachments: string
  },
  mediaRows: {
    artifacts: { rows: string, declaredBytes: string },
    jobAttachments: { rows: string, declaredBytes: string }
  },
  reconciliation: {
    rowBackedObjects: string,
    orphanObjects: string,
    rowsMissingObjects: string,
    duplicateRowKeys: string,
    duplicateObjectKeys: string
  },
  references: {
    mutableStories: string,
    immutableQuoteAttachments: string,
    immutableQuoteArtifactReferences: string,
    openSessionsWithMedia: string,
    activeJobsWithMedia: string
  },
  safety: {
    mediaTablesPresent: true,
    unexpectedInboundForeignKeys: '0',
    unexpectedUserTriggers: '0',
    deletionSourceRelationshipCount: string,
    deletionSourceRelationshipDigest: string,
    unapprovedDeletionSourceRelationships: '0',
    protectedCascadePaths: '0',
    bucketCatalogCount: string,
    bucketCatalogDigest: string,
    bucketCatalogExpectation: 'private-artifacts-only' | 'empty',
    unexpectedBucketEntries: '0',
    objectsOutsideExpectedBuckets: '0',
    mediaKeysOutsideArtifacts: '0',
    protectedCatalogCount: string,
    protectedCatalogDigest: string,
    unclassifiedTables: '0',
    safetyDigest: string
  },
  protectedFingerprints: Array<{
    table: string,
    required: boolean,
    state: 'present' | 'absent',
    rows: string,
    digest: string
  }>,
  inventoryDigest: string
}
```

`inventoryDigest` is SHA-256 over canonical JSON of every field except `capturedAt`, `stage`, and `inventoryDigest`. `keyedDeletionSets` contains only domain-separated HMAC-SHA-256 aggregate digests. Object keys and row identifiers exist only in memory during one invocation and are never part of the state-file value.

The sole additional local state shape is `tmp/no-media/$VYNTECHS_NO_MEDIA_RUN_ID/row-commit-status.json`:

```js
{
  schemaVersion: 1,
  runId: string,
  targetHash: string,
  rowDrainInventoryDigest: string,
  phase: 'pending' | 'unknown' | 'acknowledged'
    | 'recovered-committed' | 'recovered-rolled-back',
  updatedAt: string,
  journalDigest: string,
}
```

`journalDigest` is SHA-256 over canonical JSON of the other six fields. The journal uses the same path-containment, symlink refusal, `0600`, redaction, and tamper checks as inventory state. Create `pending` atomically before opening the row transaction; atomically replace it with `unknown` immediately before commit can be dispatched; replace it with `acknowledged` only after the driver confirms commit. A proven pre-commit rollback becomes `recovered-rolled-back`. If acknowledgement is lost, a fresh read-only recovery may replace `pending|unknown` only with `recovered-committed` or `recovered-rolled-back`. After the originating invocation creates `pending`, every subsequent `purge-rows` invocation fails closed for every journal phase, so a crash or signal cannot bypass the no-rerun rule. Only `acknowledged|recovered-committed` permits `verify final`; journal writes never contain a credential, raw row, object key, count, or protected fingerprint.

Use these exact call shapes throughout the plan:

```js
collectInventory({
  database,
  now,
  run: { runId, deployedAt, deployedSha, targetHash },
  stage,
})

assertStableInventories(first, second, { minimumSeconds })

assertObjectPurgeReady({ baseline, live, confirmation })

purgeObjectsAndDeleteBucket({
  database,
  storage,
  baseline,
  confirmation,
  now,
  signal,
})

assertRowPurgeReady({ baseline, barrier, rowDrain1, rowDrain2, live, confirmation })

purgeMediaRowsAtomically({
  database,
  baseline,
  barrier,
  rowDrain1,
  rowDrain2,
  confirmation,
  signal,
})

verifyFinalState({ database, expectedCatalogDigest, expectedSafetyDigest, now, run })

writeStateFile({ repoRoot, runId, stage, value })
readStateFile({ repoRoot, runId, stage })

runCli({ argv, env, repoRoot, now, createAdapters, writeOut, writeErr, signal })
```

---

## Part A — Build and verify operator tooling only

### Task 1: Lock the aggregate manifest and redaction boundary

**Files:**
- Create: `scripts/production/no-media/core.mjs`
- Create: `tests/unit/no-media-production-script.test.ts`

**Interfaces:**
- Produces: `PurgeStop`, `canonicalJson`, `sha256`, `targetHash`, `safeFailure`, `readStateFile`, and `writeStateFile` with the signatures above.
- Consumes: Node `crypto`, `fs/promises`, and `path`; no production clients.

- [ ] **Step 1: Write failing manifest and redaction tests**

Add tests that pin canonical ordering, aggregate-only serialization, tamper rejection, safe errors, file permissions, path containment, and symlink refusal:

```ts
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const importCore = () => import('../../scripts/production/no-media/core.mjs')

describe('no-media production state boundary', () => {
  it('canonicalizes object keys and hashes without echoing input', async () => {
    const { canonicalJson, sha256, targetHash } = await importCore()
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } }))
      .toBe('{"a":{"x":3,"y":2},"z":1}')
    expect(sha256('sentinel-project-ref')).toMatch(/^[a-f0-9]{64}$/)
    expect(targetHash('sentinel-project-ref')).not.toContain('sentinel')
  })

  it('writes only under tmp/no-media with mode 0600 and rejects tampering', async () => {
    const { readStateFile, writeStateFile } = await importCore()
    const root = await mkdtemp(join(tmpdir(), 'vyntechs-purge-'))
    await mkdir(join(root, 'tmp/no-media/run-00000001'), { recursive: true })
    const file = await writeStateFile({
      repoRoot: root,
      runId: '20260715T050000Z-00000001',
      stage: 'baseline-1',
      value: validManifest('baseline-1'),
    })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    parsed.mediaRows.artifacts.rows = '999'
    await writeFile(file, `${JSON.stringify(parsed)}\n`, { mode: 0o600 })
    await expect(readStateFile({ repoRoot: root, runId: parsed.runId, stage: 'baseline-1' }))
      .rejects.toMatchObject({ code: 'MANIFEST_DIGEST_MISMATCH' })
  })

  it('rejects path escape and symbolic-link state targets', async () => {
    const { writeStateFile } = await importCore()
    const root = await mkdtemp(join(tmpdir(), 'vyntechs-purge-'))
    await mkdir(join(root, 'tmp/no-media'), { recursive: true })
    await symlink(tmpdir(), join(root, 'tmp/no-media/linked'))
    await expect(writeStateFile({
      repoRoot: root,
      runId: '../escape',
      stage: 'baseline-1',
      value: validManifest('baseline-1'),
    })).rejects.toMatchObject({ code: 'UNSAFE_STATE_PATH' })
    await expect(writeStateFile({
      repoRoot: root,
      runId: 'linked',
      stage: 'baseline-1',
      value: validManifest('baseline-1'),
    })).rejects.toMatchObject({ code: 'UNSAFE_STATE_PATH' })
  })

  it('reduces arbitrary provider failures to one allowlisted code', async () => {
    const { safeFailure } = await importCore()
    const output = JSON.stringify(safeFailure(Object.assign(
      new Error('customer@example.com eyJ-secret postgresql://secret'),
      { code: 'XX999', details: 'vehicle and object key' },
    )))
    expect(output).toBe('{"ok":false,"code":"OPERATION_FAILED"}')
    expect(output).not.toMatch(/customer|eyJ|postgresql|vehicle|XX999/)
  })
})
```

Define `validManifest(stage)` in the same test file with literal zero fault counts, explicit stage-correct bucket expectation, fixed deletion-source relationship count/digest, three fixed 64-character `keyedDeletionSets` digests plus fixed catalog/safety/protected/inventory digests, `runId: '20260715T050000Z-00000001'`, `capturedAt: '2026-07-15T05:00:00.000Z'`, `deployedAt: '2026-07-15T04:55:00.000Z'`, and a 40-character lowercase hexadecimal deployed SHA.

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'state boundary'
```

Expected: FAIL because `scripts/production/no-media/core.mjs` does not exist.

- [ ] **Step 3: Implement the manifest core**

Use a `PurgeStop` whose public surface is only an allowlisted `code`, recursively sort plain-object keys in `canonicalJson`, use `createHash('sha256')`, validate state files with a strict Zod schema, recompute `inventoryDigest` during reads, and create files with `{ flag: 'wx', mode: 0o600 }`. Resolve the state path from `repoRoot/tmp/no-media/runId/stage.json`, require the run ID to match `/^\d{8}T\d{6}Z-[a-f0-9]{8}$/`, require an allowlisted stage, `lstat` every existing path component, and reject symbolic links.

Use these exact public error codes:

```js
export const ERROR_CODES = new Set([
  'INVALID_INPUT',
  'TARGET_MISMATCH',
  'UNSAFE_STATE_PATH',
  'STATE_FILE_EXISTS',
  'STATE_FILE_MISSING',
  'MANIFEST_INVALID',
  'MANIFEST_DIGEST_MISMATCH',
  'WAIT_WINDOW_NOT_SATISFIED',
  'INCOMPLETE_INVENTORY',
  'SCHEMA_DRIFT',
  'INVENTORY_DRIFT',
  'CONFIRMATION_MISMATCH',
  'OBJECT_PURGE_FAILED',
  'BUCKET_BARRIER_FAILED',
  'ROW_PURGE_FAILED',
  'PROTECTED_RECORD_DRIFT',
  'FINAL_VERIFICATION_FAILED',
  'OPERATION_ABORTED',
  'COMMIT_STATUS_UNKNOWN',
  'OPERATION_FAILED',
])
```

`safeFailure(error)` returns `{ ok: false, code }` only when `error` is a `PurgeStop` with an allowlisted code; otherwise it returns `{ ok: false, code: 'OPERATION_FAILED' }`.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'state boundary'
git diff --check
git add scripts/production/no-media/core.mjs tests/unit/no-media-production-script.test.ts
git commit -m "test: lock no-media purge state boundary"
```

Expected: focused tests PASS; the commit contains only the core state boundary and its tests.

### Task 2: Build complete read-only inventory and preservation proof

**Files:**
- Modify: `scripts/production/no-media/core.mjs`
- Create: `scripts/production/no-media/run.mjs`
- Modify: `tests/unit/no-media-production-script.test.ts`

**Interfaces:**
- Produces: `collectInventory({ database, now, run, stage })` and the production database adapter methods named above.
- Consumes: Task 1 manifest, digest, and safe-failure contracts.

- [ ] **Step 1: Write failing pagination, reconciliation, schema, and privacy tests**

Create fakes whose media and Storage keys contain sentinel UUIDs, emails, filenames, and tokens. Use a fixed 32-byte test-only fingerprint key. Prove changing one protected row changes its keyed digest, changing the key changes every present-table and deletion-set digest, and neither the key, a raw deletion tuple, an item digest, nor an unkeyed row hash appears in a manifest or CLI output. Pin these results:

```ts
it('reconciles complete media and storage inventories without serializing keys', async () => {
  const { collectInventory } = await importCore()
  const database = fakeDatabase({
    mediaRows: [
      { table: 'artifacts', storageKey: 'customer@example.com/private.jpg', declaredBytes: 10n },
      { table: 'job_attachments', storageKey: 'eyJ-token/private.pdf', declaredBytes: 20n },
      { table: 'job_attachments', storageKey: 'missing/private.txt', declaredBytes: 30n },
    ],
    storageObjects: [
      { name: 'customer@example.com/private.jpg', declaredBytes: 10n },
      { name: 'eyJ-token/private.pdf', declaredBytes: 20n },
      { name: 'orphan/secret.mov', declaredBytes: 40n },
    ],
  })
  const result = await collectInventory({
    database,
    now: new Date('2026-07-15T05:00:00.000Z'),
    run: fixedRun(),
    stage: 'baseline-1',
  })
  expect(result.reconciliation).toEqual({
    rowBackedObjects: '2', orphanObjects: '1', rowsMissingObjects: '1',
    duplicateRowKeys: '0', duplicateObjectKeys: '0',
  })
  expect(result.keyedDeletionSets).toEqual({
    storageObjects: expect.stringMatching(/^[a-f0-9]{64}$/),
    artifacts: expect.stringMatching(/^[a-f0-9]{64}$/),
    jobAttachments: expect.stringMatching(/^[a-f0-9]{64}$/),
  })
  expect(JSON.stringify(result)).not.toMatch(/customer|private|eyJ|orphan|missing/)
})

it('binds identical aggregates to the exact deletion sets', async () => {
  const first = await inventoryWithFixedKey({
    artifactId: '00000000-0000-4000-8000-000000000001',
    artifactKey: 'private/first.jpg',
    objectKey: 'private/first.jpg',
    bytes: 10n,
  })
  const changed = await inventoryWithFixedKey({
    artifactId: '00000000-0000-4000-8000-000000000002',
    artifactKey: 'private/second.jpg',
    objectKey: 'private/second.jpg',
    bytes: 10n,
  })
  expect(changed.mediaRows).toEqual(first.mediaRows)
  expect(changed.bucket.objects).toBe(first.bucket.objects)
  expect(changed.bucket.declaredBytes).toBe(first.bucket.declaredBytes)
  expect(changed.keyedDeletionSets).not.toEqual(first.keyedDeletionSets)
  expect(changed.inventoryDigest).not.toBe(first.inventoryDigest)
})

it.each([
  ['duplicate row key', { duplicateMediaKey: true }, 'INCOMPLETE_INVENTORY'],
  ['duplicate object key', { duplicateObjectKey: true }, 'INCOMPLETE_INVENTORY'],
  ['negative byte count', { negativeBytes: true }, 'INCOMPLETE_INVENTORY'],
  ['missing required table', { missingRequiredTable: true }, 'SCHEMA_DRIFT'],
  ['inbound foreign key', { inboundForeignKeys: 1n }, 'SCHEMA_DRIFT'],
  ['user trigger', { userTriggers: 1n }, 'SCHEMA_DRIFT'],
  ['media key in another bucket', { mediaKeysOutsideArtifacts: 1n }, 'SCHEMA_DRIFT'],
  ['public bucket', { bucketState: 'unsafe' }, 'SCHEMA_DRIFT'],
  ['stable extra bucket', { extraBucket: true }, 'SCHEMA_DRIFT'],
  ['object outside expected bucket', { objectOutsideExpectedBucket: true }, 'SCHEMA_DRIFT'],
  ['protected cascade path', { protectedCascadePaths: 1n }, 'SCHEMA_DRIFT'],
  ['unapproved deletion-source trigger', { unapprovedDeletionTrigger: true }, 'SCHEMA_DRIFT'],
])('fails closed on %s', async (_name, fault, code) => {
  const { collectInventory } = await importCore()
  await expect(collectInventory({
    database: fakeDatabase(fault),
    now: new Date('2026-07-15T05:00:00.000Z'),
    run: fixedRun(),
    stage: 'baseline-1',
  })).rejects.toMatchObject({ code })
})
```

Add production-adapter tests that independently return 1,201 Storage rows and 1,201 media rows across 500/500/201 keyset pages, prove both last pages are consumed, and reject a repeated cursor or a full page whose last key does not advance. Include duplicate storage keys on opposite sides of a media-row page boundary; pagination must still complete because each table's unique primary-key `id` is the in-memory cursor. Return only `storageKey`, aggregate fields, and final keyed deletion-set digests to the core. Prove pagination boundaries do not change a set digest and that same-count/same-byte object-name or media-row-ID substitutions do change it. Add a bucket-catalog test proving an added, removed, renamed, or public/private-changed bucket changes `bucketCatalogDigest` without serializing any non-operational bucket name.

Add raw Storage-size regressions for `null`, blank text, non-decimal text, a negative value, a fractional value, a non-canonical leading-zero value, and any integer greater than `9223372036854775807`; each must fail with `INCOMPLETE_INVENTORY` without echoing the raw value. Preserve the exact string `"0"` as the valid zero-byte value.

Add stage-bound bucket-catalog tests. `baseline-1` and `baseline-2` accept exactly one catalog row whose ID and name are both `artifacts` and whose `public` flag is false. `bucket-barrier`, both row drains, and `final` accept exactly zero bucket rows and zero Storage objects globally. Prove a second bucket present in both otherwise-identical baseline inventories is rejected rather than certified as stable; prove an object in any non-expected bucket is also rejected without serializing its bucket or object name.

Add deletion-source catalog regressions covering all inbound/outbound foreign keys and every non-internal trigger on `storage.buckets`, `storage.objects`, `public.artifacts`, and `public.job_attachments`. Prove a protected-table cascade, a trigger-function definition change, an added trigger, a changed FK action, and any relationship absent from the reviewed exact allowlist each produce `SCHEMA_DRIFT`. Prove only an exact explicitly approved Supabase-internal signature is accepted.

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'inventory|reconcile|pagination|schema|keyed set|Storage size|bucket catalog|dependency|trigger|cascade'
```

Expected: FAIL because inventory and production adapters are absent.

- [ ] **Step 3: Implement aggregate inventory in the core**

`collectInventory` performs all reads before constructing a manifest. It treats object and row keys as transient sets, requires every byte value to be a non-negative `bigint`, rejects duplicates, counts the intersection/differences, requires `auth.users` and the core ShopOS identity/job tables, classifies every other live ordinary table, fingerprints the complete protected and bucket catalogs, binds each complete deletion set to a domain-separated keyed digest, and rejects unsafe buckets, media-key matches outside `artifacts`, inbound foreign keys, user triggers, or any unclassified relation.

Use these exact deletion-set domains and tuples:

```text
vyntechs:no-media:v1:storage-object      [bucket_id, name, declared_bytes]
vyntechs:no-media:v1:artifact-row        [id, storage_key, bytes]
vyntechs:no-media:v1:job-attachment-row  [id, storage_key, byte_size]
```

For each tuple, use exact database text for IDs and keys and canonical unsigned decimal strings for byte values, then compute HMAC-SHA-256 with the decoded per-run fingerprint key over UTF-8 `canonicalJson([domain, tuple])`. Sort the fixed-length hexadecimal item HMACs and compute the final set HMAC over UTF-8 `canonicalJson([domain, decimalCount, itemHmacs])`. Define the empty-set digest with the same algorithm and an empty `itemHmacs` array. Only the final three 64-character set digests enter `keyedDeletionSets`; raw tuples and item HMACs remain invocation-local and are scrubbed with the adapter. `inventoryDigest`, `assertStableInventories`, object-purge live comparison, row-drain live comparison, and final zero proof all include these set digests. This makes a key, row ID, or object-name substitution drift even when every count and byte total is unchanged.

The public `collectInventory` result is still the strict aggregate manifest only. An internal snapshot helper may additionally return transient object names and media reconciliation sets to the same invocation. `purgeObjectsAndDeleteBucket` must delete the exact transient object-name set that produced the fresh live set digest compared with baseline 2; it must not compare one enumeration and then perform a second unbound enumeration for deletion. `writeStateFile`, CLI writers, errors, and return values reject the transient snapshot shape.

Classify the live relation catalog rather than maintaining a partial hand-written allowlist:

```js
export const PROTECTED_SCHEMAS = ['public']
export const PROTECTED_AUTH_TABLES = ['auth.users']
export const EXPECTED_BUCKET_CATALOGS = {
  'private-artifacts-only': [{ id: 'artifacts', name: 'artifacts', public: false }],
  empty: [],
}
export const DELETION_SOURCE_RELATIONS = [
  'storage.buckets',
  'storage.objects',
  'public.artifacts',
  'public.job_attachments',
]
export const APPROVED_DELETION_SOURCE_RELATIONSHIPS = [
  {
    kind: 'foreign-key', source: 'storage.objects', columns: ['bucket_id'],
    target: 'storage.buckets', targetColumns: ['id'],
    onDelete: 'cascade', onUpdate: 'no action', deferrable: false,
    classification: 'supabase-internal',
  },
  {
    kind: 'foreign-key', source: 'public.artifacts', columns: ['session_id'],
    target: 'public.sessions', targetColumns: ['id'],
    onDelete: 'cascade', onUpdate: 'no action', deferrable: false,
    classification: 'media-child-to-protected-parent',
  },
  {
    kind: 'foreign-key', source: 'public.job_attachments', columns: ['shop_id', 'job_id'],
    target: 'public.ticket_jobs', targetColumns: ['shop_id', 'id'],
    onDelete: 'restrict', onUpdate: 'no action', deferrable: false,
    classification: 'media-child-to-protected-parent',
  },
  {
    kind: 'foreign-key', source: 'public.job_attachments',
    columns: ['shop_id', 'uploaded_by_profile_id'],
    target: 'public.profiles', targetColumns: ['shop_id', 'id'],
    onDelete: 'restrict', onUpdate: 'no action', deferrable: false,
    classification: 'media-child-to-protected-parent',
  },
]
export const VOLATILE_SCHEMA_RULES = [
  { schema: 'auth', except: ['users'], classification: 'volatile-auth-infrastructure' },
  { schema: 'storage', classification: 'storage-safety-catalog' },
]
```

Bind the expectation to the state-machine stage rather than inferring it from whatever production happens to contain: both baseline stages require `private-artifacts-only`; `bucket-barrier`, both row-drain stages, and `final` require `empty`. Query the complete `storage.buckets` catalog and the global `storage.objects` count. Any catalog row outside the exact expected array, any configuration mismatch on the expected `artifacts` row, or any object whose bucket is not expected is `SCHEMA_DRIFT` even if it is present and unchanged in two consecutive inventories. Unknown storage is never silently reclassified as operational media; it requires a separate ownership decision and reviewed plan update.

`APPROVED_DELETION_SOURCE_RELATIONSHIPS` is an exact structural allowlist, not a schema/name wildcard. The four entries above are the only initially approved foreign keys: the Supabase-owned object-to-bucket relationship and the three source-controlled media-child relationships. Enumerate every inbound and outbound foreign key plus every trigger—including internal constraint triggers—whose owning or referenced relation is in `DELETION_SOURCE_RELATIONS`. An internal trigger is accepted only when `tgconstraint` resolves to one of the four approved FK signatures. No non-internal trigger is approved initially. If the live Supabase version adds a prefix, multipart, vector, analytics, Iceberg, or other internal relationship/trigger, preflight stops; classify its exact columns/actions or trigger timing/events/function identity and `pg_get_functiondef` SHA-256 in a separately reviewed tooling change before rerunning.

Walk the side-effect-capable dependency closure through `pg_constraint`, `pg_trigger`, `pg_proc`, `pg_rewrite`, and the relevant `pg_depend` links. Reject any delete rule, trigger, or inbound FK action that can cascade, set null/default, or otherwise mutate a protected relation. Provider-owned effects are not trusted by schema name alone. Canonically hash all approved relationship signatures and return count/digest only; any added, removed, or changed signature, unapproved trigger function digest, or protected cascade is `SCHEMA_DRIFT`.

Every ordinary or partitioned table in `public` is protected except the two exact `MEDIA_TABLES`. This automatically covers jobs, follow-ups, `tech_assist_requests`, `diagnostic_sessions`, migration-created `tech_outcomes`, AutoEYE-adjacent public records, and any other current public table. `auth.users` is protected. Other `auth` tables are explicitly volatile authentication infrastructure; `storage.buckets` and `storage.objects` are classified as the separately locked safety catalog. Any ordinary table in another application schema, any relation that matches none of these rules, or any media-table name outside the exact allowlist is `SCHEMA_DRIFT`.

The adapter returns a keyed digest of the complete classified relation set (schema, relation, relkind, classification) plus its aggregate count. Baseline stability requires the same catalog digest. Unit tests must build the expected current catalog from source/migration fixtures and explicitly include `follow_ups`, `tech_assist_requests`, `diagnostic_sessions`, and `tech_outcomes`; adding an unclassified schema/table must fail closed.

- [ ] **Step 4: Implement the read-only production database adapter**

In `run.mjs`, parse `DATABASE_URL_DIRECT` with `URL`, perform the exact-target hostname checks, and build a sanitized connection URL that removes `sslmode`, `ssl`, `sslrootcert`, `sslcert`, and `sslkey` query parameters without ever serializing the URL. Create one `postgres` client with the sanitized URL and these explicit options:

```js
const ignorePostgresNotice = () => {}

{
  prepare: false,
  max: 1,
  ssl: { rejectUnauthorized: true },
  onnotice: ignorePostgresNotice,
  debug: false,
}
```

The explicit TLS object must win regardless of any unsafe source-URL setting, preserve hostname verification through the direct `db.<project-ref>.supabase.co` host, and use the platform trust store. Do not allow `ssl: 'require'`, `allow`, or `prefer`, because Postgres.js disables certificate verification for those string modes. Installed `postgres@3.4.9` passes a falsey `onnotice` through and then calls `console.log` for a server notice, so the production option must be a stable explicit no-op function; `false`, omission, and a logging callback are forbidden. Keep `debug: false` rather than installing a debug callback. Then keyset-read Storage metadata in pages of 500:

```sql
select name,
       metadata ->> 'size' as declared_bytes
from storage.objects
where bucket_id = 'artifacts'
  and ($1::text is null or name > $1::text)
order by name
limit 501
```

Do not cast or coalesce the Storage size in SQL. Before constructing a `bigint`, require the returned value to be a string matching `/^(0|[1-9][0-9]*)$/`, require it to be no greater than PostgreSQL bigint maximum `9223372036854775807`, and otherwise fail with `INCOMPLETE_INVENTORY`. This preserves a genuine zero-byte object while refusing missing, blank, malformed, negative, fractional, non-canonical, or oversized metadata without logging it.

Read both media tables without content fields, in separate keyset-paginated queries of 501 rows ordered by primary-key `id`; discard the cursor IDs before returning adapter rows:

```sql
select id::text as cursor_id,
       storage_key,
       bytes::bigint::text as declared_bytes
from public.artifacts
where ($1::uuid is null or id > $1::uuid)
order by id
limit 501

select id::text as cursor_id,
       storage_key,
       byte_size::bigint::text as declared_bytes
from public.job_attachments
where ($1::uuid is null or id > $1::uuid)
order by id
limit 501
```

Use each validated `cursor_id` in its table's domain-separated deletion tuple before discarding it from the adapter's public `rows` array. Thus the returned aggregate digest binds the exact row identities consumed across every page even though no ID enters the core manifest.

Read reference counts with JSONPath and joins, returning counts only:

```sql
select
  (select count(*) from public.ticket_jobs
   where jsonb_path_exists(customer_story, '$.howWeKnow[*].sourceArtifactIds[*]'))::text
    as mutable_stories,
  (select count(*) from public.quote_versions
   where jsonb_path_exists(snapshot, '$.jobs[*].attachments[*]'))::text
    as immutable_quote_attachments,
  (select count(*) from public.quote_versions
   where jsonb_path_exists(snapshot, '$.jobs[*].customerStory.howWeKnow[*].sourceArtifactIds[*]'))::text
    as immutable_quote_artifact_references,
  (select count(distinct s.id) from public.sessions s
   join public.artifacts a on a.session_id = s.id
   where s.status = 'open')::text
    as open_sessions_with_media,
  (select count(distinct j.id) from public.ticket_jobs j
   join public.job_attachments a on a.job_id = j.id and a.shop_id = j.shop_id
   where j.work_status in ('open','in_progress','blocked'))::text
    as active_jobs_with_media
```

Add a static schema-source assertion to the test that `sessions.status` retains `open|closed|declined|deferred` and `ticket_jobs.work_status` retains `open|in_progress|blocked|done|canceled`; any enum drift requires the reference query and test to change together. Do not weaken the query to count every session/job.

Query `pg_constraint` in both directions for every foreign key whose owning or referenced relation is one of the four `DELETION_SOURCE_RELATIONS`. Query every `pg_trigger` row on those four relations, including internal constraint triggers; resolve `tgconstraint`, trigger timing/events/orientation/enabled state, and the owning function through `pg_proc`. Walk `pg_rewrite` and relevant `pg_depend` edges to detect delete rules and side-effect-capable dependents. Canonicalize structural signatures without OIDs, because OIDs are deployment-local.

Require the foreign-key set to equal `APPROVED_DELETION_SOURCE_RELATIONSHIPS`. Accept internal constraint triggers only when they resolve to those approved constraints. Require zero unapproved non-internal triggers or rewrite rules. For any separately reviewed provider trigger, the future allowlist entry must pin relation, timing, events, orientation, enabled state, function schema/name/identity arguments, and SHA-256 of `pg_get_functiondef`; schema ownership alone is insufficient. Explicitly compute whether deleting from any of the four source relations can cascade, set null/default, or invoke a function that mutates any protected relation, and require zero protected paths. Return only approved relationship count/digest plus zero unapproved/protected counts, and bind them into `safetyDigest`.

Read the complete `storage.buckets` catalog ordered by ID and compute a database-side keyed SHA-256 digest over each bucket's ID, name, public flag, file-size limit, and allowed MIME types. Return only the catalog count and digest. Compare the complete rows with the stage's explicit expected array: baseline stages require exactly one private `artifacts` row; post-barrier stages require no rows. Also count all `storage.objects` rows globally and all rows whose `bucket_id` falls outside the stage's expected set. Baseline accepts only objects in `artifacts`; post-barrier accepts no Storage object at all. Return only counts/digests and require unexpected counts to be zero. This rejects even a stable extra bucket or object without writing its name to a manifest.

Require a per-run 32-byte base64 fingerprint key and prove `extensions.hmac(bytea, bytea, text)` exists before any inventory. The key stays environment-only, is passed as a bound `bytea` parameter or held only in the production adapter's private closure, never enters SQL source or state, and remains constant for the complete run. The adapter uses that same key for the three domain-separated deletion-set digests. For each relation classified protected from the same catalog snapshot, verify it still resolves with the expected relkind and compute the fingerprint inside PostgreSQL so no row content or unkeyed row hash reaches Node. A disappeared or changed relation is `SCHEMA_DRIFT`:

```sql
select count(*)::bigint::text as rows,
       pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(
         coalesce(pg_catalog.string_agg(row_digest, '' order by row_digest), ''),
         'UTF8'), $1::bytea, 'sha256'), 'hex') as digest
from (
  select pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(pg_catalog.to_jsonb(t)::text, 'UTF8'),
    $1::bytea,
    'sha256'
  ), 'hex') as row_digest
  from public.shops t
) fingerprints
```

Generate table identifiers only from the relations returned by the already-validated classified catalog snapshot; allow only the `public` schema plus exact `auth.users`, re-check the expected relkind, and quote every identifier with the `postgres` client identifier helper. Never interpolate an environment value or an unvalidated database result into SQL source.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'inventory|reconcile|pagination|schema|fingerprint|keyed set|Storage size|bucket catalog|dependency|trigger|cascade'
git diff --check
git add scripts/production/no-media/core.mjs scripts/production/no-media/run.mjs tests/unit/no-media-production-script.test.ts
git commit -m "feat: add read-only media purge preflight"
```

Expected: all read-only inventory tests PASS; no production connection is attempted.

### Task 3: Bind the CLI to one production target and stable drain manifests

**Files:**
- Modify: `scripts/production/no-media/core.mjs`
- Modify: `scripts/production/no-media/run.mjs`
- Modify: `tests/unit/no-media-production-script.test.ts`

**Interfaces:**
- Produces: `runCli({ argv, env, repoRoot, now, createAdapters, writeOut, writeErr, signal })` and `assertStableInventories`.
- Consumes: Task 2 inventory and state-file contracts.

- [ ] **Step 1: Write failing target, timing, output, and drift tests**

Pin the exact required environment names:

```js
[
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL_DIRECT',
  'VYNTECHS_NO_MEDIA_FINGERPRINT_KEY',
  'VYNTECHS_EXPECTED_SUPABASE_PROJECT_REF',
  'VYNTECHS_NO_MEDIA_RUN_ID',
  'VYNTECHS_NO_MEDIA_DEPLOYED_AT',
  'VYNTECHS_NO_MEDIA_DEPLOYED_SHA',
]
```

Tests must prove:

- The independently supplied project ref must be canonical lowercase alphanumeric Supabase-ref text. `NEXT_PUBLIC_SUPABASE_URL` must match only `https://<that-ref>.supabase.co/`: HTTPS with the implicit default port (no explicit port), no userinfo, no path beyond `/`, no query, and no hash. Its parsed origin and the origin of `new URL('storage/v1', validatedUrl)` must both equal the exact `https://<that-ref>.supabase.co` origin.
- Table-driven negative cases cover `http`, any explicit port (including `:443`), userinfo, a non-root path, query, hash, uppercase/mixed-case authority, suffix/prefix hosts, percent-encoded dots or host characters, Unicode/IDNA lookalikes, and credential-like text embedded in authority. Every case fails before the Supabase factory, custom fetch, Postgres factory, or adapter factory is called; a sentinel service-role key never reaches an Authorization header or any request observer.
- Supabase URL ref, direct-database hostname ref, and independently supplied expected ref must all match after the exact public-origin validation.
- The database URL hostname must start with `db.`, end with `.supabase.co`, and contain the exact independently supplied project reference between those fixed segments; a transaction-pooler URL is rejected.
- A source URL containing `sslmode=disable`, `allow`, `prefer`, `require`, `verify-ca`, duplicate SSL parameters, or certificate/key path parameters is sanitized before the Postgres factory sees it; the captured client options still contain `ssl: { rejectUnauthorized: true }`, an explicit function-valued `onnotice`, and `debug: false`.
- A behavioral regression uses the actual injected Postgres-factory/options path, captures `writeOut`, `writeErr`, `process.stdout.write`, `process.stderr.write`, and `console.log`/`warn`/`error`, invokes the supplied notice handler with credential/PII sentinels, and proves every capture stays empty. It rejects a falsey value, omission, or any handler that forwards the notice; no debug callback receives SQL or parameters.
- The fingerprint key must decode from canonical base64 to exactly 32 bytes; malformed, short, or non-canonical values fail before adapters are created.
- Deployed SHA is exactly 40 lowercase hexadecimal characters.
- Missing or malformed values fail before `createAdapters` runs.
- `preflight baseline-1` prints only `{"ok":true,"stage":"baseline-1","inventoryDigest":"` followed by exactly 64 lowercase hexadecimal characters and `"}`.
- Baseline 2 is rejected until at least 120 seconds after deployment and 60 seconds after baseline 1.
- Baseline 2 rejects any digest drift.
- Raw fake-provider errors containing every sentinel credential and PII value reduce to an allowlisted code.
- The mutable environment object has every credential and confirmation key deleted on validation failure, adapter failure, normal success, and interruption; adapter clients close in `finally`.
- Real child-process tests spawn a test-only harness around `runCli`, send `SIGINT`, `SIGTERM`, and `SIGHUP`, and prove one safe exit, no sentinel output, no later object batch, no bucket deletion after an interrupted batch, and rollback of a transaction interrupted before commit dispatch.
- A real `zsh -f` harness with sentinel-only fake credentials proves normal success, an ordinary nonzero child command, and each catchable signal terminate the operator shell through its cleanup trap; a cleanup marker may contain only a boolean and never a credential value. After each path, spawn a fake downstream documentation/Git subprocess and assert its environment lacks every purge credential and `VYNTECHS_NO_MEDIA_CONFIRM`.

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'target|TLS|notice|timing|drift|CLI output|signal|cleanup|abort'
```

Expected: FAIL because target-bound CLI and stability checks are incomplete.

- [ ] **Step 3: Implement target binding and preflight CLI**

Export `runCli` for tests. Do not rely on installed `@supabase/supabase-js@2.105.1` URL validation: its helper accepts both HTTP and HTTPS, and its constructor derives the Storage endpoint from that accepted base. Validate non-secret target material in strict order before reading or copying `SUPABASE_SERVICE_ROLE_KEY`: require `VYNTECHS_EXPECTED_SUPABASE_PROJECT_REF` to match `/^[a-z0-9]{20}$/`; construct the one expected public root string `https://${ref}.supabase.co/`; require the raw `NEXT_PUBLIC_SUPABASE_URL` to equal it byte-for-byte; then parse it and independently require protocol `https:`, empty username/password/port/search/hash, pathname `/`, exact hostname, exact origin, and `new URL('storage/v1', url).origin` equal to the expected origin. Validate the direct-database hostname against the same ref and sanitize/validate its TLS options next. Only after every exact-origin and database-target check passes may code copy the service-role key, call the injected Supabase factory, construct an authenticated fetch, instantiate Postgres, or create adapters. The Supabase factory receives the already-validated exact public root; a pre-validation request/header path is structurally unreachable.

Instantiate production clients only inside `createProductionAdapters` after that ordered target and TLS-option validation succeeds. Inject both Supabase and Postgres factories in tests. Assert the exact validated Supabase root, sanitized database URL, and security options before any client connects. The Postgres options use a stable explicit no-op notice function and `debug: false`; the notice regression invokes that exact captured function from the actual factory path while all output surfaces are intercepted. Copy validated secret values into the adapters only at the final construction boundary, then immediately delete every sensitive key (including `VYNTECHS_NO_MEDIA_CONFIRM`) from the mutable environment object. The executable entry point creates one `AbortController` before validation and installs `SIGINT`, `SIGTERM`, and `SIGHUP` handlers that abort it with internal signal metadata whose only public result is `OPERATION_ABORTED`, except for the commit-uncertainty boundary below. Pass its signal through `runCli`, the object purge, and the row transaction. The entry point prints one safe JSON line, closes both clients and scrubs the environment again in `finally`, removes its signal handlers, and exits as 130, 143, or 129 respectively without printing a raw error.

Every adapter call checks the signal before and after I/O. The object purge checks it before every batch, after every batch, and before bucket deletion; an in-flight batch may finish, but an abort starts no later batch and never deletes the bucket. The direct-database adapter owns its single connection and exposes an internal abort hook. Before commit dispatch becomes possible, a signal cancels or terminates that dedicated connection, awaits confirmed rollback/close, and returns only `OPERATION_ABORTED`. Immediately before returning from the transaction callback, check the signal and then atomically move the adapter's internal phase from `pre-commit` to `commit-may-have-started`. Once in that phase, any signal, socket loss, timeout, driver rejection, or missing success acknowledgement maps to `COMMIT_STATUS_UNKNOWN`, never to rollback or ordinary failure. Only resolution of the Postgres transaction promise with the expected affected counts constitutes `commitAcknowledged: true` and permits the later final-verification command. An unknown status leaves the durable recovery journal, scrubs credentials, closes the process, starts no later mutation, and may be resolved only by the read-only recovery command in a fresh operator lane.

Support exactly these commands and stages:

```text
preflight baseline-1
preflight baseline-2
preflight row-drain-1
preflight row-drain-2
purge-objects baseline-2
purge-rows row-drain-2
recover row-commit
verify final
```

`recover row-commit` is read-only and is accepted only for the same persisted run with a valid `pending|unknown` row-commit journal (including an abrupt exit that left `pending`). It creates no adapter with mutation methods and accepts no confirmation value. Against a fresh exact-target connection, it reads the complete bucket, object, media-row, deletion-set, safety, and protected-fingerprint state. Exact final-zero media/storage state with expected empty-set and safety digests classifies `committed`; exact Row Drain 2 media counts/bytes/set digests plus its protected fingerprints classifies `rolled-back`. Any partial, substituted, drifting, safety-changed, or fingerprint-ambiguous state remains `COMMIT_STATUS_UNKNOWN` and stops for owner review. Neither result directly reruns deletion: `committed` may proceed only to `verify final`; `rolled-back` closes this run and requires a separately reviewed fresh-drain recovery plan.

Define one exact purge-environment allowlist shared by CLI scrubbing and subprocess tests. It includes all eight required binding variables plus `VYNTECHS_NO_MEDIA_CONFIRM` and the two temporary run-ID variables. The real-shell harness must demonstrate that the secret-owning `zsh -f` process exits after success as well as failure/signal cleanup, then launch a separate fake documentation/Git subprocess from the controller side and inspect that child's environment directly. Any listed name present downstream fails the test. Documentation and Git execution are never callbacks or subprocesses of the still-secret-bearing operator shell.

`assertStableInventories(first, second, { minimumSeconds })` requires matching `runId`, target hash, deployed SHA, deployed time, safety digest, protected fingerprints, media counts, object counts, reconciliation, references, all three keyed deletion-set digests, and inventory digest. It parses UTC timestamps, rejects clock reversal, and uses `minimumSeconds: 60` for each pair. Baseline 2 also requires `capturedAt - deployedAt >= 120 seconds`.

`preflight row-drain-1` and `row-drain-2` require the persisted bucket-barrier state and an absent bucket with zero objects. Row drain 1 requires at least 120 seconds after the barrier; Row drain 2 requires at least 60 seconds after Row drain 1 and an identical inventory digest.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'target|TLS|notice|timing|drift|CLI output|signal|cleanup|abort'
git diff --check
git add scripts/production/no-media/core.mjs scripts/production/no-media/run.mjs tests/unit/no-media-production-script.test.ts
git commit -m "feat: guard media purge target and drain"
```

Expected: target, timing, drift, and redaction tests PASS.

### Task 4: Delete Storage objects and establish the bucket barrier

**Files:**
- Modify: `scripts/production/no-media/core.mjs`
- Modify: `scripts/production/no-media/run.mjs`
- Modify: `tests/unit/no-media-production-script.test.ts`

**Interfaces:**
- Produces: `assertObjectPurgeReady` and `purgeObjectsAndDeleteBucket`.
- Consumes: exact baseline-2 manifest, live inventory, and injected `storage.removeObjects`/`deleteBucket`.

- [ ] **Step 1: Write failing object-purge tests**

Cover these exact cases:

```ts
it.each([
  ['missing confirmation', '', 'CONFIRMATION_MISMATCH'],
  ['wrong digest', 'PURGE_OPERATIONAL_MEDIA:' + 'f'.repeat(64), 'CONFIRMATION_MISMATCH'],
  ['inventory drift', 'correct', 'INVENTORY_DRIFT'],
  ['bucket already unsafe', 'correct', 'SCHEMA_DRIFT'],
])('does not delete objects on %s', async (_name, confirmation, code) => {
  const storage = fakeStorage()
  await expect(runObjectPurge({ confirmation, fault: _name, storage }))
    .rejects.toMatchObject({ code })
  expect(storage.removeCalls).toEqual([])
  expect(storage.deleteBucketCalls).toEqual([])
})
```

Add success and partial-failure tests proving:

- 251 objects are removed as 100/100/51 sorted-key batches.
- Keys are never written into the returned barrier manifest or output.
- The fresh object's keyed deletion-set digest must equal baseline 2; a same-count/same-byte key substitution is `INVENTORY_DRIFT` before the first delete.
- A failed second batch stops; no bucket deletion or media-row deletion occurs.
- An abort during the second batch permits that in-flight batch to finish but starts no third batch and never deletes the bucket.
- A retry starts from a fresh complete enumeration and may safely remove remaining keys.
- After all batches, a complete from-the-beginning inventory must be zero before bucket deletion.
- Bucket deletion is followed by a complete bucket-catalog query that must return the exact empty set and global Storage object count zero.
- An absent-bucket retry is accepted only with the same persisted private-`artifacts` baseline after zero objects were reached; an initially absent baseline and any extra stable bucket/object are rejected.
- Failure to prove absence returns `BUCKET_BARRIER_FAILED`.

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'object purge|bucket barrier'
```

Expected: FAIL because object purge functions are absent.

- [ ] **Step 3: Implement object deletion and bucket barrier**

Require confirmation to equal:

```js
`PURGE_OPERATIONAL_MEDIA:${baseline.inventoryDigest}`
```

Immediately before the first delete, collect a fresh inventory and require its complete manifest, including all three keyed deletion-set digests and the exact private-`artifacts`-only catalog, to match baseline 2. The only absent-bucket exception is an idempotent retry using the same persisted baseline 2 after a prior invocation deleted the bucket but failed before writing `bucket-barrier.json`; that retry must prove the complete bucket catalog empty, the global Storage object count zero, and the keyed empty-object-set digest before reconstructing the barrier. An initially absent bucket or a new run whose baseline did not prove the exact private `artifacts` catalog is `SCHEMA_DRIFT`. For a present-private bucket, sort the transient object names, split them into batches of 100, check the abort signal before and after each batch, and call `removeObjects`. Do not retry inside a single invocation; the safe retry is the persisted run or fresh complete preflight as applicable. After all calls, read all Storage objects again from the beginning and require global zero plus the keyed empty-object-set digest. Check the signal again before `deleteBucket`; an interrupted invocation never deletes the bucket. Call `deleteBucket('artifacts')` only when the bucket is present; then require the complete bucket catalog to be empty.

Write `bucket-barrier.json` with zero object count, absent bucket state, the keyed empty-object-set digest, unchanged media-row/reference/protected counts and media-row set digests, the current timestamp, and a new digest. Do not delete media rows in this command.

In the production storage adapter, use:

```js
await supabase.storage.from('artifacts').remove(names)
await supabase.storage.deleteBucket('artifacts')
```

Treat any non-null Supabase error or missing response contract as failure. Map it to `OBJECT_PURGE_FAILED` or `BUCKET_BARRIER_FAILED` without serializing the provider error. Map a signal abort to `OPERATION_ABORTED`; after that abort, no later batch or bucket deletion may begin.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'object purge|bucket barrier'
git diff --check
git add scripts/production/no-media/core.mjs scripts/production/no-media/run.mjs tests/unit/no-media-production-script.test.ts
git commit -m "feat: add guarded media object purge"
```

Expected: object purge and barrier tests PASS; no database-row delete exists yet.

### Task 5: Delete media rows atomically without changing protected records

**Files:**
- Modify: `scripts/production/no-media/core.mjs`
- Modify: `scripts/production/no-media/run.mjs`
- Modify: `tests/unit/no-media-production-script.test.ts`

**Interfaces:**
- Produces: `assertRowPurgeReady`, `purgeMediaRowsAtomically`, and `verifyFinalState`.
- Consumes: baseline-2, bucket-barrier, row-drain-1, and row-drain-2 manifests.

- [ ] **Step 1: Write failing row-transaction and final-proof tests**

Pin these invariants:

- Row purge confirmation equals the JavaScript value `` `PURGE_MEDIA_ROWS:${rowDrain2.inventoryDigest}` ``.
- Bucket must be absent and object count zero in barrier, both row-drain manifests, and a fresh live read.
- Row-drain manifests are identical and satisfy their 120/60-second intervals.
- The complete fresh live manifest, including media-row counts, declared bytes, and all keyed deletion-set digests, must equal Row Drain 2 before opening the transaction.
- Current protected fingerprints must match row-drain 2 before deletion.
- After all four table locks, the transaction must recompute both media tables' counts, bytes, and domain-separated keyed set digests and require exact equality with Row Drain 2 before either delete.
- After all four locks, the transaction must re-read the four-relation dependency/trigger digest and require the same exact approved set with zero protected cascade paths before either delete.
- A transaction deletes exactly `public.artifacts` and `public.job_attachments`.
- Each delete's affected-row count must equal its Row Drain 2 expected count; any mismatch rolls back.
- The transaction recomputes protected fingerprints after deletes and rolls back on any mismatch.
- A simulated second-delete failure rolls back the first delete.
- A late inserted row and a same-count/same-byte row replacement between Row Drain 2 and transaction lock acquisition both roll back as `INVENTORY_DRIFT` before deletion.
- A signal before the adapter enters `commit-may-have-started` terminates/cancels the dedicated connection and proves the open transaction rolls back as `OPERATION_ABORTED`.
- Before the transaction opens, a mode-`0600`, digest-checked `pending` journal must exist. A second `purge-rows` process is rejected for every journal phase; a tampered, symlinked, missing-at-transition, or non-atomically replaceable journal fails before another mutation.
- A deterministic lost-ack test lets the callback finish, observes commit dispatch, withholds the driver acknowledgement, and requires `COMMIT_STATUS_UNKNOWN` with no automatic retry or later mutation.
- A deterministic server-committed-before-receipt test applies both deletes atomically but drops the acknowledgement; the initial command still returns `COMMIT_STATUS_UNKNOWN`, and a fresh read-only `recover row-commit` classifies `committed` before final verification.
- Recovery tests classify only exact final-zero as `committed` and exact Row Drain 2 plus matching protected fingerprints as `rolled-back`; partial deletes, replacements, safety drift, or ambiguous fingerprints remain `COMMIT_STATUS_UNKNOWN` and require owner review. Every unknown path scrubs credentials before the fresh lane starts.
- The public unknown result is exactly `{"ok":false,"code":"COMMIT_STATUS_UNKNOWN"}`. It contains no signal name, driver message, SQL state, stack, URL, credential, count, or identifier.
- No SQL contains `drop`, `truncate`, `storage.objects`, `auth.users`, or any protected table after a `delete from` token.
- Final verification requires absent bucket, zero objects, zero rows, and zero late rows/objects. The authoritative protected-record comparison is the before/after comparison inside the deletion transaction; unrelated legitimate writes after commit must not make an irreversible successful purge look corrupt.
- Historical reference counts may remain nonzero because immutable quote UUIDs are inert; final proof records counts but never rewrites snapshots.

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'row purge|transaction|commit status|recovery|final verification'
```

Expected: FAIL because atomic row purge and final verification are absent.

- [ ] **Step 3: Implement atomic row deletion in the production database adapter**

Use one direct PostgreSQL transaction and one deterministic lock order:

```sql
set transaction isolation level serializable;
set local lock_timeout = '5s';
lock table storage.buckets, storage.objects in share row exclusive mode;
lock table public.artifacts, public.job_attachments in access exclusive mode;
```

Inside that transaction:

1. Re-read bucket state through `storage.buckets` and require absence.
2. Re-read `storage.objects` and require zero rows for `artifacts`.
3. Recompute, with the same bound per-run HMAC key and exact domain/tuple algorithms, `public.artifacts` and `public.job_attachments` row counts, declared-byte totals, and keyed deletion-set digests.
4. Require every value from step 3 to equal Row Drain 2; mismatch is `INVENTORY_DRIFT` and occurs before either delete.
5. Re-read safety facts, including the complete deletion-source relationship/trigger digest, and protected fingerprints.
6. Require the safety facts to equal Row Drain 2, every relationship to remain explicitly approved, protected cascade paths to remain zero, and protected fingerprints to equal Row Drain 2.
7. Check the abort signal, execute `delete from public.artifacts`, and require the affected count to equal Row Drain 2's `artifacts` count.
8. Check the abort signal, execute `delete from public.job_attachments`, and require the affected count to equal Row Drain 2's `jobAttachments` count.
9. Require both media tables to count zero and reproduce their keyed empty-set digests.
10. Recompute protected fingerprints and require byte-for-byte equality with step 5.
11. Re-read `storage.buckets` and `storage.objects` under the retained locks and again require absent bucket, zero objects, and the keyed empty-object-set digest immediately before commit.
12. Check the abort signal immediately before returning from the transaction callback; durably and atomically replace the run's `pending` commit journal with `unknown`; only after that write succeeds mark the adapter `commit-may-have-started`; return counts to the driver; and accept success only after the transaction promise acknowledges commit, returning `commitAcknowledged: true`.

Before opening the transaction, write the `pending` commit journal; if that write fails, do not connect mutably. Before `commit-may-have-started`, any lock timeout, affected-count mismatch, database error, or serialization failure has a proven rollback, atomically marks the journal `recovered-rolled-back`, and maps to `ROW_PURGE_FAILED`; pre-commit signal cancellation does the same and maps to `OPERATION_ABORTED`; pre-delete media-set mismatch maps to `INVENTORY_DRIFT`; and protected mismatch maps to `PROTECTED_RECORD_DRIFT`. At or after `commit-may-have-started`, any missing acknowledgement—regardless of whether caused by signal, socket loss, timeout, or driver error—leaves or rewrites the journal as `unknown` and maps only to `COMMIT_STATUS_UNKNOWN`. An acknowledged commit atomically marks it `acknowledged`; if that local update fails, retain/fall back to `unknown` and require read-only recovery even though the database acknowledgement was received. Never retry a transaction automatically. An unknown outcome permits only fresh-lane read-only recovery; no deletion command may run until recovery classifies the old outcome, and ambiguity stops for owner review. Tests must deterministically attempt a concurrent bucket/object recreation while the transaction holds its locks and prove the writer cannot cross the pre-commit barrier. Separate deterministic tests insert or replace a media row before lock acquisition and prove the locked pre-delete equality check prevents either row delete.

- [ ] **Step 4: Implement core row gate and final verification**

Require confirmation to equal:

```js
`PURGE_MEDIA_ROWS:${rowDrain2.inventoryDigest}`
```

`assertRowPurgeReady` requires the fresh live manifest to equal Row Drain 2 across target/deployment binding, catalog and safety digests, references, protected fingerprints, bucket/object zero state, media-row counts and bytes, reconciliation, and all three keyed deletion-set digests. Before calling it for `purge-rows`, the CLI requires that no row-commit journal already exists; it then creates `pending` and binds that journal to the same run, target hash, and Row Drain 2 inventory digest. Pass Row Drain 2's media counts, bytes, keyed set digests, and protected fingerprints as the single expected contract to `deleteMediaRowsAtomically`; the adapter repeats the media equality check only after its locks are held.

`verifyFinalState` collects a fresh inventory after commit and requires:

```js
{
  bucket: { state: 'absent', objects: '0', declaredBytes: '0' },
  mediaRows: {
    artifacts: { rows: '0', declaredBytes: '0' },
    jobAttachments: { rows: '0', declaredBytes: '0' },
  },
  reconciliation: {
    rowBackedObjects: '0', orphanObjects: '0', rowsMissingObjects: '0',
    duplicateRowKeys: '0', duplicateObjectKeys: '0',
  },
}
```

It also requires the keyed empty-set digest for Storage objects and both media tables. It requires the same classified-catalog and safety digests, but records a fresh post-commit protected fingerprint set without comparing it to the transaction snapshot; a legitimate unrelated protected write after commit is allowed. It writes only `final.json` and the single safe CLI summary. A test must prove a post-commit protected write does not invalidate the final media-zero receipt, while a protected change caused inside the media-row transaction still rolls back.

The CLI's internal read-only recovery classifier requires a valid run/target/Row-Drain-bound journal in `pending|unknown`, loads the persisted Row Drain 2 contract, opens newly constructed read-only database/Storage adapters in a fresh process, and collects one complete exact-target inventory. It returns only `{"ok":true,"status":"committed"}` for exact final-zero and atomically journals `recovered-committed`, or `{"ok":true,"status":"rolled-back"}` for an exact Row Drain 2 media/fingerprint match and atomically journals `recovered-rolled-back`. It leaves the phase `unknown` and throws the allowlisted `COMMIT_STATUS_UNKNOWN` for every mixed or ambiguous state. It never calls `deleteMediaRowsAtomically`, exposes mutation methods, consumes `VYNTECHS_NO_MEDIA_CONFIRM`, or treats a client-side timeout as evidence of rollback. `verify final` requires a valid `acknowledged|recovered-committed` journal bound to the same run and target.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts -t 'row purge|transaction|commit status|recovery|final verification'
git diff --check
git add scripts/production/no-media/core.mjs scripts/production/no-media/run.mjs tests/unit/no-media-production-script.test.ts
git commit -m "feat: add atomic media row purge"
```

Expected: all atomicity and final-proof tests PASS.

### Task 6: Pressure-test tooling, record readiness, and stop at production

**Files:**
- Review: `scripts/production/no-media/core.mjs`
- Review: `scripts/production/no-media/run.mjs`
- Review: `tests/unit/no-media-production-script.test.ts`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`

**Interfaces:**
- Produces: a reviewed tooling PR that remains non-destructive until Task 7.
- Consumes: Tasks 1–5.

- [ ] **Step 1: Run complete focused proof**

Run:

```bash
pnpm vitest run tests/unit/no-media-production-script.test.ts
```

Expected: every exact-origin target, certificate-verifying TLS, behaviorally proved notice/debug silence, redaction, manifest, domain-separated keyed-set, raw-size, pagination, exact bucket catalog, four-relation dependency/trigger, drift, partial failure, signal/fail-fast/downstream-process cleanup, bucket barrier, transaction, commit-uncertainty recovery, and final-proof test passes with no retries.

- [ ] **Step 2: Run privacy and destructive-scope static checks**

Run:

```bash
rg -n "console\.(log|error)|process\.env|signedUrl|createSignedUrl|emptyBucket|truncate|drop table|delete from storage\.objects" \
  scripts/production/no-media tests/unit/no-media-production-script.test.ts
rg -n "delete from" scripts/production/no-media
rg -n "rejectUnauthorized|onnotice|debug|sslmode" \
  scripts/production/no-media/run.mjs tests/unit/no-media-production-script.test.ts
git diff --name-only origin/main...HEAD
```

Expected:

- environment access exists only in the target-validation/adapter factory;
- executable output uses the safe JSON writer only;
- the production Postgres options force `rejectUnauthorized: true`, a function-valued explicit no-op `onnotice`, and `debug: false`; no falsey notice handler exists; unsafe `sslmode` text appears only in URL-sanitization logic and downgrade tests;
- no signed URL, empty-bucket shortcut, direct Storage SQL deletion, truncate, or table drop exists;
- `delete from` appears only for `public.artifacts` and `public.job_attachments` inside the direct transaction;
- no API, cron, migration, schema, provider, pricing, AutoEYE, or unrelated file is changed.

- [ ] **Step 3: Run repository gates**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

Expected: full suite, TypeScript, production build, and diff check exit 0.

- [ ] **Step 4: Run independent security and operations review**

Require one reviewer to attack exact public-origin binding (including encoded/mixed host tricks), pre-validation service-role leakage, URL TLS downgrade attempts, certificate/hostname verification, behaviorally exercised notice/debug leakage, credential/log leakage, secret-owning child exit and downstream documentation/Git environments, path/symlink handling, raw Storage-size validation, pagination, keyed deletion-set binding, exact stage-bound bucket ownership, stable extra storage, and Storage failure behavior. Require a second reviewer to attack all four deletion-source dependency/trigger signatures, protected cascade discovery, transaction boundaries, locked pre-delete media-set equality, affected-count checks, protected fingerprints, concurrency, proven pre-commit rollback versus lost commit acknowledgement, read-only `COMMIT_STATUS_UNKNOWN` recovery, and final proof. Resolve every Critical and Important finding, rerun affected focused tests, then repeat Steps 1–3.

- [ ] **Step 5: Record tooling readiness without claiming deletion**

In Row 49, record the tooling PR, exact test counts, TypeScript/build proof, and:

```text
Operator tooling verified; production media is unchanged. Destructive execution remains closed until the separately deployed no-media release, signed-in refusal smoke, exact-target proof, and stable production manifests all pass.
```

Update `SHOP_OS_DRIVER_STATE.md` so the next safe move is the separate production-operator Task 7. Do not mark Row 49 complete.

- [ ] **Step 6: Commit readiness evidence and stop**

Run:

```bash
git add scripts/production/no-media/core.mjs scripts/production/no-media/run.mjs \
  tests/unit/no-media-production-script.test.ts \
  docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md \
  docs/strategy/SHOP_OS_DRIVER_STATE.md
git commit -m "docs: record guarded media purge tooling"
git status --short
```

Expected: clean worktree and no production command executed. Open or update the tooling PR and stop at the production gate.

---

## Part B — Separate production execution hard gate

### Task 7: Execute the founder-authorized purge in a fresh production lane

**Files:**
- Execute: merged `scripts/production/no-media/run.mjs`
- Write locally only: `tmp/no-media/$VYNTECHS_NO_MEDIA_RUN_ID/*.json`
- Append after proof: `docs/operations/2026-07-14-autoeye-lane-coordination.md`
- Modify after proof: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify after proof: `docs/strategy/SHOP_OS_DRIVER_STATE.md`

**Interfaces:**
- Consumes: merged tooling, deployed no-media application release, secure production environment, production deployment SHA/time, and the manifests created in this task.
- Produces: absent operational-media bucket, zero media rows, an authoritative in-transaction protected-fingerprint match, and aggregate-only closure proof.

- [ ] **Step 1: Establish the production prerequisites without deleting anything**

Fetch current `main`, verify a clean worktree, and prove the deployed commit contains both the reviewed purge tooling and the reversible no-media application release. Confirm through signed-in production smoke that:

- diagnostic entry is unavailable for paid, grandfathered, and comped shops;
- diagnostic capture, simple-work attachment upload, attachment download, and artifact extraction reject before reading multipart bytes, Storage, downloads, or providers;
- the reviewed release's source audit proves no third operational-media ingress, bucket, or external media-storage provider exists;
- no mobile, tablet, desktop, keyboard, or direct-link UI exposes a media control;
- text-only simple-work completion succeeds;
- `/api/health` is healthy;
- production deployment and error logs are clean.

Stop if any proof fails. Do not create a new account, customer, vehicle, job, or media fixture solely for this purge unless a separately authorized QA-data plan exists.

- [ ] **Step 2: Append the production mutation announcement**

Append this UTC entry to the coordination Log and publish the docs-only change through the normal reviewed PR path before connecting the destructive lane:

```text
2026-07-15 · controller → autoeye · FYI · Row 49 production media purge is entering read-only preflight against the deployed global no-media release. The only authorized destructive scope after stable proof is the private artifacts bucket plus public.artifacts and public.job_attachments. No AutoEYE repo, branch, receipt, benchmark, retrieval, corpus, topology, risk, engine schema, pricing, or protected ShopOS history changes. Missing wake-up never transfers monitoring to the founder; the gate stays closed on drift.
```

If production execution occurs after 2026-07-15 UTC, replace only the leading date with the actual execution date required by the Log protocol; do not change the message or add counts, identifiers, URLs, or credentials.

Commit the append-only announcement before production credentials are loaded:

```bash
git add docs/operations/2026-07-14-autoeye-lane-coordination.md
git diff --cached --check
git commit -m "docs: announce production media purge preflight"
```

Expected: the local commit changes only the coordination Log and contains no production count, identifier, URL, credential, or manifest. Publish it through the repository's normal reviewed branch/PR path only under the separate Git-publication authority gate. Do not load production credentials or continue to Step 3 until that Log entry is merged to `main`.

- [ ] **Step 3: Enter a disposable operator process, install cleanup, then bind the run**

Before starting the child, the controller may generate and retain only the non-secret run ID as an unexported process-control value; it passes that one value through a scoped environment assignment and retains the corresponding local scratch-directory path for later aggregate cleanup. It never receives any target or credential value:

```bash
NO_MEDIA_RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)"
NO_MEDIA_RUN_NONCE="$(openssl rand -hex 4)"
NO_MEDIA_RUN_ID="$NO_MEDIA_RUN_TS-$NO_MEDIA_RUN_NONCE"
unset NO_MEDIA_RUN_TS NO_MEDIA_RUN_NONCE
VYNTECHS_NO_MEDIA_RUN_ID="$NO_MEDIA_RUN_ID" zsh -f
```

Start that dedicated `zsh -f` child process for secret-bearing Steps 3–10; do not export production credentials in the controller's long-lived shell. The child must exit through Step 11 cleanup before any post-purge product-smoke, documentation, or Git process starts. Before loading any value, disable tracing/history and install silent cleanup for every exit path:

```bash
unset HISTFILE
set +x
setopt ERR_EXIT PIPE_FAIL
cleanup_no_media_env() {
  unset VYNTECHS_EXPECTED_SUPABASE_PROJECT_REF NEXT_PUBLIC_SUPABASE_URL \
    SUPABASE_SERVICE_ROLE_KEY DATABASE_URL_DIRECT VYNTECHS_NO_MEDIA_FINGERPRINT_KEY \
    VYNTECHS_NO_MEDIA_DEPLOYED_AT VYNTECHS_NO_MEDIA_DEPLOYED_SHA \
    VYNTECHS_NO_MEDIA_RUN_ID VYNTECHS_NO_MEDIA_CONFIRM \
    NO_MEDIA_RUN_TS NO_MEDIA_RUN_NONCE
}
trap 'cleanup_no_media_env' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
```

Run every credential-bearing validation and CLI command as a top-level simple command so `ERR_EXIT` cannot be suppressed by a conditional, list, or command substitution wrapper. Where a command must be inspected, use `command || { rc=$?; exit $rc; }` so ordinary nonzero status always terminates this disposable shell and runs cleanup. `PIPE_FAIL` makes any failed pipeline component do the same. Never continue to another purge stage after a failed command in the same process.

Only after the traps exist, load production values from the approved secret source into these environment variables inside that child process:

```bash
export VYNTECHS_EXPECTED_SUPABASE_PROJECT_REF
export NEXT_PUBLIC_SUPABASE_URL
export SUPABASE_SERVICE_ROLE_KEY
export DATABASE_URL_DIRECT
export VYNTECHS_NO_MEDIA_FINGERPRINT_KEY
export VYNTECHS_NO_MEDIA_DEPLOYED_AT
export VYNTECHS_NO_MEDIA_DEPLOYED_SHA
export VYNTECHS_NO_MEDIA_RUN_ID
```

Do not use `set -x`, shell history, command-line secret arguments, or any command that echoes these values. Confirm only that each variable is non-empty:

```bash
node <<'NODE'
const names = [
  'VYNTECHS_EXPECTED_SUPABASE_PROJECT_REF',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL_DIRECT',
  'VYNTECHS_NO_MEDIA_FINGERPRINT_KEY',
  'VYNTECHS_NO_MEDIA_DEPLOYED_AT',
  'VYNTECHS_NO_MEDIA_DEPLOYED_SHA',
  'VYNTECHS_NO_MEDIA_RUN_ID',
]
if (names.some((name) => !process.env[name])) process.exit(1)
NODE
```

Expected: exit 0 with no output. The first CLI invocation then proves the public Supabase URL is the byte-exact canonical HTTPS root for the independently supplied ref and that its derived Storage origin is identical before the service-role key can reach a factory or header. If any later command fails, or the operator process receives `HUP`, `INT`, or `TERM`, it exits through cleanup; its credentials are scrubbed and only mode-`0600` aggregate recovery manifests remain. A Node interruption before commit dispatch stops later Storage batches/bucket deletion or cancels the dedicated database transaction with confirmed rollback. An interruption or lost response after commit may have started returns only `COMMIT_STATUS_UNKNOWN`; it never claims rollback. A resumed or recovery run starts a fresh disposable process and reloads credentials rather than reusing a long-lived shell.

- [ ] **Step 4: Capture two stable baseline manifests**

Run:

```bash
node scripts/production/no-media/run.mjs preflight baseline-1
```

Expected: one safe JSON line with `ok`, `stage`, and `inventoryDigest`; `tmp/no-media/$VYNTECHS_NO_MEDIA_RUN_ID/baseline-1.json` exists with mode `0600`.

After at least 60 seconds, and at least 120 seconds after the verified deployment time, run:

```bash
node scripts/production/no-media/run.mjs preflight baseline-2
```

Expected: both baselines prove the complete live bucket catalog is exactly one private `artifacts` row, every Storage object belongs to that bucket, and the complete inventory—including all three domain-separated keyed deletion-set digests, the exact approved deletion-source relationship digest, and protected fingerprints—matches. `WAIT_WINDOW_NOT_SATISFIED`, `INVENTORY_DRIFT`, or any other failure leaves production unchanged and returns to baseline 1 with a new run ID after investigation.

- [ ] **Step 5: Re-read the aggregate manifest and stop on every exception**

Inspect only the allowlisted aggregate fields in baseline 2. Require:

- complete bucket catalog exactly one private `artifacts` row;
- zero buckets or objects outside that explicit expected set;
- zero duplicate keys;
- valid exact Storage byte metadata and stable keyed deletion-set digests;
- media tables present;
- zero unexpected inbound foreign keys and user triggers;
- exact approved dependency/trigger signatures across all four deletion-source relations and zero protected cascade paths;
- every required protected table present;
- optional protected tables consistently present or absent;
- no unclassified dependency.

Nonzero orphan/missing/reference counts are not silently ignored. Compare them to the approved design categories. Stop if a count implies a resource outside the `artifacts` bucket, either media table, inert immutable snapshot UUIDs, mutable story text history, or existing open session/job linkage already covered by the design.

- [ ] **Step 6: Execute object deletion and establish the bucket barrier**

Set confirmation from the locally validated baseline manifest without printing it:

```bash
VYNTECHS_NO_MEDIA_CONFIRM="$(node -e '
  const fs = require("node:fs");
  const path = `tmp/no-media/${process.env.VYNTECHS_NO_MEDIA_RUN_ID}/baseline-2.json`;
  const value = JSON.parse(fs.readFileSync(path, "utf8"));
  process.stdout.write(`PURGE_OPERATIONAL_MEDIA:${value.inventoryDigest}`);
')" || { rc=$?; exit $rc; }
export VYNTECHS_NO_MEDIA_CONFIRM
node scripts/production/no-media/run.mjs purge-objects baseline-2
unset VYNTECHS_NO_MEDIA_CONFIRM
```

Expected: every explicitly enumerated object from the baseline-bound keyed set is removed in bounded batches; a fresh full enumeration returns zero plus the keyed empty-object-set digest; the bucket is deleted and proved absent; `bucket-barrier.json` is written. If any batch, interruption, or barrier check fails, no later batch or bucket deletion runs, media rows remain unchanged, and the lane returns to fresh baseline manifests.

- [ ] **Step 7: Capture two stable post-bucket row manifests**

At least 120 seconds after the bucket-barrier timestamp, run:

```bash
node scripts/production/no-media/run.mjs preflight row-drain-1
```

At least 60 seconds later, run:

```bash
node scripts/production/no-media/run.mjs preflight row-drain-2
```

Expected: both runs prove the complete bucket catalog empty, global Storage object count zero, keyed empty-object-set digest, unchanged exact deletion-source relationship/trigger digest with zero protected cascade paths, exact stable media-row counts/bytes/keyed set digests, and matching protected fingerprints. Any late or substituted row, recreated/extra bucket or object, dependency/trigger drift, or protected drift stops row deletion and restarts the drain proof.

- [ ] **Step 8: Execute the atomic media-row deletion**

Set the second confirmation without printing it:

```bash
VYNTECHS_NO_MEDIA_CONFIRM="$(node -e '
  const fs = require("node:fs");
  const path = `tmp/no-media/${process.env.VYNTECHS_NO_MEDIA_RUN_ID}/row-drain-2.json`;
  const value = JSON.parse(fs.readFileSync(path, "utf8"));
  process.stdout.write(`PURGE_MEDIA_ROWS:${value.inventoryDigest}`);
')" || { rc=$?; exit $rc; }
export VYNTECHS_NO_MEDIA_CONFIRM
node scripts/production/no-media/run.mjs purge-rows row-drain-2
unset VYNTECHS_NO_MEDIA_CONFIRM
```

Expected: before the transaction opens, the tool atomically writes the Row-Drain-bound `pending` journal; any pre-existing journal blocks this and every later `purge-rows` invocation. One serializable transaction then locks all four catalogs/tables, proves the media counts/bytes/keyed set digests still equal Row Drain 2, deletes exactly both expected row counts, sees zero plus both keyed empty-set digests afterward, and proves protected fingerprints unchanged inside the transaction. Success is reported only after the driver acknowledges commit and the journal becomes `acknowledged`. Any error or signal while the adapter is still `pre-commit` proves rollback and journals `recovered-rolled-back`. Any signal, connection loss, timeout, missing response, or acknowledgement-journal failure after `commit-may-have-started` leaves `unknown` and emits only `COMMIT_STATUS_UNKNOWN`; the shell cleanup trap runs, the child exits, and no command from Step 10 onward runs in that process.

- [ ] **Step 9: Recover a lost commit acknowledgement read-only, only if required**

Skip this step only when Step 8 returned acknowledged success and the local journal is validly `acknowledged`. If Step 8 returned `COMMIT_STATUS_UNKNOWN`, or an abrupt exit left the journal `pending|unknown`, do not rerun `purge-rows`, do not generate a new confirmation, and do not infer rollback from a signal or connection error. After the first operator child has exited and scrubbed its environment, start a fresh disposable `zsh -f` recovery child using the Step 3 trap contract, the same locally retained run ID, the same fingerprint key, and freshly loaded exact-target credentials. This recovery child is restricted to the read-only command:

```bash
node scripts/production/no-media/run.mjs recover row-commit
```

Expected outcomes:

- `{"ok":true,"status":"committed"}` only when a complete fresh inventory proves exact final-zero media/storage, all three keyed empty-set digests, and unchanged safety boundary. Continue to Step 10 in this fresh child.
- `{"ok":true,"status":"rolled-back"}` only when the complete media counts/bytes/keyed sets and protected fingerprints exactly match Row Drain 2. Exit through cleanup; do not rerun deletion. A separately reviewed fresh-drain recovery plan is required.
- `COMMIT_STATUS_UNKNOWN` for every partial, substituted, safety-drifted, fingerprint-drifted, or otherwise ambiguous state. Exit through cleanup and stop for owner review.

The recovery path never accepts `VYNTECHS_NO_MEDIA_CONFIRM`, never exposes a mutation adapter, and never changes production.

- [ ] **Step 10: Run final machine verification inside the secret-owning child**

Run this only with a valid same-run journal phase of `acknowledged` after Step 8 or `recovered-committed` after Step 9:

```bash
node scripts/production/no-media/run.mjs verify final
```

Expected: `final.json` proves the complete bucket catalog empty, global Storage object count zero, zero `artifacts` rows, zero `job_attachments` rows, all three keyed empty-set digests, zero reconciliation counts, the exact approved four-relation dependency/trigger digest with zero protected cascade paths, and the unchanged classified catalog/safety boundary. It records fresh protected fingerprints without stale-comparing them to pre-commit values.

- [ ] **Step 11: Scrub every purge value and exit before downstream work**

Still inside the successful operator child, scrub explicitly, disable the traps only after cleanup, prove a newly spawned downstream probe receives none of the purge environment, and exit. Do not run a browser, editor, documentation command, or Git command in this process:

```bash
cleanup_no_media_env
trap - EXIT HUP INT TERM
node <<'NODE'
const { spawnSync } = require('node:child_process')
const names = [
  'VYNTECHS_EXPECTED_SUPABASE_PROJECT_REF', 'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL_DIRECT',
  'VYNTECHS_NO_MEDIA_FINGERPRINT_KEY', 'VYNTECHS_NO_MEDIA_DEPLOYED_AT',
  'VYNTECHS_NO_MEDIA_DEPLOYED_SHA', 'VYNTECHS_NO_MEDIA_RUN_ID',
  'VYNTECHS_NO_MEDIA_CONFIRM', 'NO_MEDIA_RUN_TS', 'NO_MEDIA_RUN_NONCE',
]
if (names.some((name) => Object.hasOwn(process.env, name))) process.exit(1)
const probe = spawnSync(process.execPath, ['-e',
  `const n=${JSON.stringify(names)};process.exit(n.some(k=>Object.hasOwn(process.env,k))?1:0)`
], { env: { ...process.env }, stdio: 'ignore' })
process.exit(probe.status ?? 1)
NODE
exit 0
```

Expected: the secret-owning child exits 0. The controller retains only `NO_MEDIA_RUN_ID` as non-exported process-control metadata and the aggregate mode-`0600` state directory. No purge variable exists in the controller or downstream probe environment.

- [ ] **Step 12: Repeat product proof, record aggregate closure, and remove scratch state**

Only after Step 11 has proved the child exited cleanly, and before any product, documentation, or Git subprocess is allowed to inherit the controller environment, assert again that every purge credential and confirmation name is absent:

```bash
node <<'NODE'
const names = [
  'VYNTECHS_EXPECTED_SUPABASE_PROJECT_REF', 'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL_DIRECT',
  'VYNTECHS_NO_MEDIA_FINGERPRINT_KEY', 'VYNTECHS_NO_MEDIA_CONFIRM',
]
if (names.some((name) => Object.hasOwn(process.env, name))) process.exit(1)
NODE
```

Repeat the signed-in production smoke from Step 1 in a separate non-purge process. Check `/api/health`, authentication boundaries, deployment logs, and fresh application errors. Confirm text-only simple-work completion and historical quote non-media rendering without creating media.

Update Row 49 to `complete` only after all proof passes. Record only:

- production purge UTC completion time;
- deployed and tooling commit SHAs;
- zero bucket/object/media-row result with all three keyed empty-set proofs;
- locked pre-delete media count/byte/set-digest match and exact affected-count result;
- in-transaction protected-fingerprint match result;
- smoke, health, authentication, and log verdicts;
- exact test counts from the reviewed tooling PR.

Append a controller Log `HANDOFF` stating the same aggregate verdict and that AutoEYE was untouched. Update `SHOP_OS_DRIVER_STATE.md` so Bay Pulse is the next separate slice. Then remove the local aggregate manifests using only the retained non-secret run ID:

```bash
NO_MEDIA_RUN_DIR="tmp/no-media/$NO_MEDIA_RUN_ID"
rm -rf -- "$NO_MEDIA_RUN_DIR"
unset NO_MEDIA_RUN_DIR NO_MEDIA_RUN_ID
git status --short
```

Expected: downstream product, documentation, and Git processes never inherit purge credentials or confirmation; aggregate scratch state is gone; and only the intentional aggregate documentation edits remain.

- [ ] **Step 13: Commit closure documentation**

Run:

```bash
git add docs/operations/2026-07-14-autoeye-lane-coordination.md \
  docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md \
  docs/strategy/SHOP_OS_DRIVER_STATE.md
git diff --cached --check
git commit -m "docs: record production media purge proof"
```

Expected: the local commit contains aggregate documentation only; no manifest, secret, identifier, media content, production dump, or unrelated file appears. Publish it through the normal reviewed branch/PR path only under the separate Git-publication authority gate; never push a production closure commit directly to `main`.

## Rollback and Recovery

- Tasks 1–6 are source-only and Git-revert-able.
- Before object deletion, every command is read-only.
- A partial object-delete failure leaves both media tables intact; rerun from a fresh complete inventory after resolving the error.
- Once objects are removed, they are intentionally irrecoverable. Do not recreate the bucket as rollback.
- Bucket removal is the durable storage-write barrier. A later unexpected media row cannot reference retrievable bytes and blocks row closure until drained.
- The two media-row deletes are one transaction. Every failure proved before `commit-may-have-started` rolls both back; protected-fingerprint mismatch occurs in that pre-commit phase and rolls back row deletion.
- After `commit-may-have-started`, loss of the driver acknowledgement is `COMMIT_STATUS_UNKNOWN`, not rollback. No mutation is retried; the secret-bearing process exits and a fresh lane performs only exact read-only inventory/fingerprint recovery. Ambiguity stops for owner review.
- After the row transaction commits, media-row deletion is intentionally irrecoverable.
- Do not restore a pre-purge database backup into production without rerunning the no-media reconciliation before opening application traffic; such a backup may contain dormant metadata rows but does not contain Supabase Storage bytes.
- Any need to restore media bytes, create a replacement bucket, or re-enable media requires a new Evidence Vault design, explicit storage ownership, independent review, and a separate production gate.

## Done When

- The operator tool has complete fake-adapter and real subprocess coverage for byte-exact Supabase HTTPS-origin binding before service-role use, certificate-verifying PostgreSQL TLS, explicit no-op notice/debug silence, privacy, domain-separated keyed deletion sets, raw Storage-size refusal, pagination, explicit stage-bound bucket ownership, stable-extra storage rejection, all four deletion-source dependency/trigger signatures, protected cascade refusal, schema drift, stable manifests, secret-child/downstream-process cleanup, object partial failures, bucket barrier, locked pre-delete media equality, acknowledged atomic rows, lost-ack `COMMIT_STATUS_UNKNOWN` recovery, and final proof.
- Full tests, TypeScript, production build, diff checks, and two independent reviews pass.
- The tooling PR records that production remains unchanged and stops at the hard gate.
- A later, separate production lane proves the deployed no-media release and exact target before deletion.
- The complete live bucket catalog is empty and no Storage object exists globally.
- `public.artifacts` and `public.job_attachments` both contain zero rows.
- Locked media counts, bytes, and keyed set digests match Row Drain 2 before deletion; affected counts match exactly; protected ShopOS fingerprints match immediately before/after the media deletes inside the serializable transaction; commit is either driver-acknowledged or classified committed by fresh read-only recovery; final live proof records, but does not stale-compare, the post-commit protected set.
- Media routes remain fail-closed and text-only work remains healthy.
- Only aggregate closure evidence is committed.
- Bay Pulse remains a separate next plan and does not enter this purge.
