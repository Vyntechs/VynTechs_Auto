# Shop OS Row 31 Transactional Purge Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task 7 purge discovery advance past any locked candidate prefix without reordering globally eligible work or mixing shops inside a transaction.

**Architecture:** Replace fixed look-ahead with `(retain_until, id)` keyset pages. Process only contiguous same-shop runs, one shop-first transaction at a time, and advance the cursor after a run makes no progress.

**Tech Stack:** TypeScript 6, Drizzle SQL, PostgreSQL/PGlite, Vitest 4.

## Global Constraints

- Modify only `lib/shop-os/messaging-retention-purge.ts` and `tests/unit/shop-os-messaging-retention-purge.test.ts` during runtime implementation.
- Keep `purgeExpiredMessagingRecords({ db, now, batchSize })` and `PurgeCounts` unchanged.
- Preserve global `retain_until, id` order, shop-first locks, single-shop definer context, dependency gates, and the 1–100 successful-delete budget.
- Add no migration, schema, route, cron, provider, credential, send, production mutation, or diagnostic-engine change.
- Stop if locked-prefix behavior cannot be reproduced deterministically before the fix.

---

### Task 1: Keyset Candidate Discovery and Contiguous Shop Execution

**Files:**
- Modify: `lib/shop-os/messaging-retention-purge.ts`
- Test: `tests/unit/shop-os-messaging-retention-purge.test.ts`

**Interfaces:**
- Consumes: existing `Hint`, `Family`, `candidateHints`, `runAtomicFamily`, and `purgeExpiredMessagingRecords`.
- Produces: an internal `CandidateCursor` and a cursor-aware `candidateHints(db, family, now, limit, cursor)`; public exports remain unchanged.

- [ ] **Step 1: Replace the source-only scheduler assertion with deterministic failing orchestration tests**

Create a minimal fake `AppDb` whose notification candidate pages are supplied in global order, whose transaction callback delegates to the same fake, and whose candidate-lock query returns no row for configured locked IDs. Record attempted deletion IDs.

Pin these cases through `purgeExpiredMessagingRecords`:

```ts
it('walks past an arbitrary locked prefix to the next eligible shop', async () => {
  const fake = purgeDb({
    pages: [[hint('A1', shopA)], [hint('B1', shopB)], [hint('C1', shopC)]],
    locked: new Set(['A1', 'B1']),
  })
  const result = await purgeExpiredMessagingRecords({
    db: fake.db, now: new Date('2026-07-12T00:00:00.000Z'), batchSize: 1,
  })
  expect(result.notifications).toBe(1)
  expect(fake.deleted).toEqual(['C1'])
})

it('does not coalesce non-contiguous runs from the same shop', async () => {
  const fake = purgeDb({
    pages: [[hint('A1', shopA), hint('B1', shopB)], [hint('A2', shopA)]],
    locked: new Set(['A1']),
  })
  await purgeExpiredMessagingRecords({
    db: fake.db, now: new Date('2026-07-12T00:00:00.000Z'), batchSize: 2,
  })
  expect(fake.deleted).toEqual(['B1'])
})
```

The fake must also assert that every transaction locks exactly one shop before a candidate-lock query and that no transaction receives hints from two shops.

- [ ] **Step 2: Run the two tests and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts -t "arbitrary locked prefix|non-contiguous runs"
```

Expected: FAIL because the current `remaining + 1` discovery stops before C and groups later A hints together.

- [ ] **Step 3: Add a cursor to every family candidate query**

Add:

```ts
type CandidateCursor = Readonly<{ retainUntil: Date; id: string }>

function nextCursor(hint: Hint): CandidateCursor {
  return Object.freeze({ retainUntil: new Date(hint.retainUntil), id: hint.id })
}
```

Extend `candidateHints` with `cursor?: CandidateCursor`. In each of its eight family queries, add the family-alias equivalent of:

```sql
and (
  ${cursor?.retainUntil ?? null}::timestamptz is null
  or (n.retain_until, n.id) > (
    ${cursor?.retainUntil ?? null}::timestamptz,
    ${cursor?.id ?? null}::uuid
  )
)
```

Keep the existing `order by <alias>.retain_until, <alias>.id limit ${limit}` clauses.

- [ ] **Step 4: Replace shop coalescing with contiguous runs and keyset walking**

Replace `runFirstProcessableShop` with logic equivalent to:

```ts
async function runFirstProcessableShop(
  db: AppDb,
  family: Family,
  now: Date,
  limit: number,
): Promise<{ deleted: number; newlyHeld: number }> {
  let cursor: CandidateCursor | undefined
  while (true) {
    const hints = await candidateHints(db, family, now, limit, cursor)
    if (hints.length === 0) return { deleted: 0, newlyHeld: 0 }

    for (let start = 0; start < hints.length;) {
      let end = start + 1
      while (end < hints.length && hints[end]!.shopId === hints[start]!.shopId) end += 1
      const run = hints.slice(start, end)
      const result = await runAtomicFamily(db, family, run, now)
      if (result.deleted > 0 || result.newlyHeld > 0) return result
      cursor = nextCursor(run[run.length - 1]!)
      start = end
    }

    if (hints.length < limit) return { deleted: 0, newlyHeld: 0 }
  }
}
```

Call it from `purgeExpiredMessagingRecords` without a preloaded fixed hint list:

```ts
const result = await runFirstProcessableShop(
  input.db, family, input.now, remaining,
)
```

- [ ] **Step 5: Run focused GREEN proof**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts
```

Expected: all Task 7 tests pass, including locked-prefix, non-contiguous ordering, cross-shop underfill, atomic rollback, and dependency-accurate `skippedHeld` tests.

- [ ] **Step 6: Run Row 31 regression and static proof**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-messaging-retention-policy.test.ts tests/unit/shop-os-messaging-consent.test.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts tests/unit/shop-os-server-only-acl.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: seven suites pass, TypeScript exits 0, and diff check exits 0.

- [ ] **Step 7: Perform one bounded review and commit**

Review only the locked-prefix and stable-order acceptance criteria. A new blocker requires a concrete Critical or Important reproducer. Then stage only the runtime and test files:

```bash
git add lib/shop-os/messaging-retention-purge.ts tests/unit/shop-os-messaging-retention-purge.test.ts
git commit -m "Close messaging purge lock starvation"
```

Do not include the existing `tasks/lessons.md` changes.
