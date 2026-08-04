# Shop OS Ticket Building and Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an advisor finish and correct a mixed repair order without losing a draft, creating duplicate truth, mutating prepared history, or leaving an old customer handoff actionable.

**Architecture:** Keep `/intake` and Quick Ticket as short first-save doors. Add bounded actor-scoped intake recovery, repair supplemental diagnostic idempotency, then add one default-off correction transaction and mounted inline correction workspace. Every persisted correction locks in the existing quote order, invalidates active prepared truth before changing facts, appends one privacy-minimized receipt, and settles only after the server returns refreshed truth.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Drizzle/PostgreSQL, PGlite, Zod 4, CSS Modules, Vitest 4, Testing Library, Playwright 1.59.

**Re-plans:** 3 — Task 7 browser proof was split before execution after preflight found the existing golden-browser helper always pulls the production database, including for localhost. Re-plan 2 consolidated the mounted-browser findings. The repaired proof then exposed, in order, a real empty-listbox accessibility defect, one stale proof selector caused by that semantic repair, and a slow-state wait with only 150 ms of scheduler margin. The three-run stop is active: do not patch the monolithic journey again. The recommended reset separates transient search proof from Finish/Correct/Recover and drives the five-second client threshold with a deterministic browser clock.

**Current architecture stop (2026-08-03):** Brandon approved a fresh bounded focus-repair lane in Buzz event `00c24370c712715aa35f41fed1ff7ced612a31c5131769c9bcc823f39914916f`. The selector-only product repair passed 80 focused checks, TypeScript, diff integrity, and independent source review. In the one authorized system-Chrome run, search passed on phone and desktop; both correction cases then passed normal focus, normal motion, reduced-motion focus/equivalence, browser Back recovery, screenshot creation, and the final 44px scan. The gate still exited 1 because the final strict request ledger found three `GET /api/whats-new/unseen-count` requests per journey. Independent read-only review classifies this as a proof-harness omission: every mounted ticket header intentionally requests the real `{ count: number }` route on initial ticket mount, reload, and post-Back remount, while the hermetic fixture has no explicit branch and returns synthetic 599. Production impact is not identified. The promised stop is active: no fixture edit or browser rerun is authorized. Recommended owner decision: add one exact `{ count: 0 }` fixture branch, assert exactly three reads without weakening any ledger, and run the unchanged gate once; or preserve Chunk 2 unmerged.

## Global constraints

- One main implementation owner executes these tasks in order. Static, security, and runtime reviewers may run in parallel only after the integrated implementation is ready.
- Keep intake short. Add no wizard, global edit mode, correction route/page, modal, customer merge, dependency, provider, notification, payment, media, or diagnostic-engine behavior.
- `SHOP_OS_TICKET_CORRECTION_ENABLED` is exact-`true` and default OFF. The correction page surface, route, and domain fail closed before correction database work.
- Source may merge under the approved program. Migration `0051` and production activation remain separate A3 gates.
- Never edit a prepared snapshot. Invalidate its active status and actionable link atomically, then change current repair-order truth.
- A mistaken unstarted job becomes `work_status = 'canceled'`; never delete the job or its historical lines. Its receipt retains `job_id`, and the UI calls it Removed.
- Store no customer name, phone, email, VIN, plate, concern text, job title, or free-text note in `ticket_activity` payloads or logs.
- Search may unlock create-new only after an authoritative `no-match`. Searching, slow, and error states cannot invoke create by pointer, Enter, or Shift+Enter.
- Cached search rows may remain visible during a slow request only when stored normalized-query provenance exactly matches the current normalized query.
- Any active prepared snapshot must pass the existing full semantic validator against the locked ticket before supplemental or correction invalidation.
- Before every commit, run `git config user.name` and `git config user.email`. They must resolve to `Vyntechs` and `brandon@vyntechs.com`; otherwise stop. Every commit uses `Co-authored-by` before `Signed-off-by` with those exact values.
- Database-heavy Vitest commands use at most two workers. Stop after the same technical approach fails twice.

---

### Task 1: Make search truth authoritative and add the intake-draft codec

**Files:**
- Modify: `lib/intake/use-search.ts`
- Modify: `components/vt/intake-search/index.tsx`
- Modify: `components/vt/intake-search/dropdown.tsx`
- Modify: `components/vt/intake-search/intake-search.css`
- Create: `lib/intake/ticket-intake-draft.ts`
- Create: `tests/unit/shop-os-ticket-intake-draft.test.ts`
- Modify: `tests/unit/intake-search-component.test.tsx`

**Interfaces:**
- `useIntakeSearch()` additionally returns `retry(): void` for the current nonblank query.
- Add a retry-only `DropdownUnavailable` and make `DropdownSlow` expose cached exact rows plus Retry, never create-new.
- Export `ticketIntakeDraftKey(actorId, surface)`, `encodeTicketIntakeDraft(draft, now?)`, and `parseTicketIntakeDraft(raw, scope)`.
- Draft surfaces are `write_up | quick_ticket`; encoded payloads are strict version 1, maximum 16 KiB, maximum age 12 hours, and carry `{ signature, clientKey } | null` for an ambiguous submission.

- [x] **Step 1: Write RED search-state tests**

Assert that `error` renders `Search unavailable` and a 44px `Retry search` control; pointer/Enter invokes retry and never `onCreateNew`. Assert Shift+Enter cannot create during `searching`, `slow`, or `error`. Assert slow state retains selectable cached rows only when their stored normalized query exactly matches the current normalized query; changing the query hides and disables the old customer rows. Slow state has no create row. Assert only real `no-match` offers `Create new customer with this info`. Cover `rowCount`, `aria-activedescendant`, and Escape without adding a dead keyboard target.

- [x] **Step 2: Write RED codec tests**

Cover valid Write-up and Quick Ticket drafts; all user-editable form fields; existing-vehicle selection; selected canned IDs plus fingerprints; assignment/work kind; actor/surface mismatch; malformed or extra keys; invalid UUIDs; invalid enum/value bounds; corrupt JSON; over 16 KiB; future/expired timestamps; and exact pending `{ signature, clientKey }` recovery. Assert the key contains only normalized actor UUID and surface, and parsing never throws.

- [x] **Step 3: Prove RED**

```bash
pnpm exec vitest run tests/unit/intake-search-component.test.tsx tests/unit/shop-os-ticket-intake-draft.test.ts --maxWorkers=1
```

Expected: search assertions fail on the current no-match/error branch and the draft module does not exist.

- [x] **Step 4: Implement the minimum search state machine**

Keep `matched` and real `no-match` behavior. Add a stable retry callback that re-fires the exact current query. Store normalized-query provenance with cached rows and expose them only on an exact current-query match. Remove create rows and create fallthrough from searching/slow/error keyboard handling. Give eligible cached slow rows deterministic IDs and keyboard indices; give Retry its own ID. Do not relabel an outage as no-match or clear the typed query.

- [x] **Step 5: Implement the strict pure codec**

Use exact-key validation and normalized UUIDs. Store editable strings as typed, not normalized server truth. Include catalog fingerprints so restore can detect a changed saved-work choice. Return `null` for every scope/schema/age/size failure; the component will delete rejected storage.

- [x] **Step 6: Prove GREEN and commit**

```bash
pnpm exec vitest run tests/unit/intake-search-component.test.tsx tests/unit/intake-search-query.test.ts tests/unit/shop-os-ticket-intake-draft.test.ts --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/intake/use-search.ts lib/intake/ticket-intake-draft.ts components/vt/intake-search tests/unit/intake-search-component.test.tsx tests/unit/shop-os-ticket-intake-draft.test.ts
git commit -m "fix: preserve truthful intake recovery" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: focused search/codec tests, TypeScript, and diff checks pass.

---

### Task 2: Mount bounded draft recovery in both creation doors

**Files:**
- Modify: `app/(app)/intake/page.tsx`
- Modify: `app/(app)/tickets/new/page.tsx`
- Modify: `components/screens/write-up.tsx`
- Modify: `components/screens/write-up.module.css`
- Modify: `components/screens/quick-ticket.tsx`
- Modify: `components/screens/quick-ticket.module.css`
- Modify: `tests/unit/intake-page-wiring.test.tsx`
- Modify: `tests/unit/shop-os-write-up-ui.test.tsx`
- Modify: `tests/unit/shop-os-quick-ticket-ui.test.tsx`
- Modify: `tests/unit/write-up.test.tsx`

**Interfaces:**
- `WriteUp` and `QuickTicket` receive required `actorId: string` from the authenticated profile, never email.
- Each surface restores once, announces `Draft restored`, exposes `Discard draft`, and registers `beforeunload` only while meaningful typed work exists.

- [x] **Step 1: Write RED mounted recovery tests**

For both screens, assert same-actor restore of every field and selection, other-actor/corrupt/expired deletion, explicit discard, successful-submit clearing, failed-submit retention, `beforeunload` lifecycle, and no raw encoded draft in the DOM. Prove an ambiguous network failure stores the current signature/client key and a remount retries the byte-identical key. Prove editing the submission rotates the key. Prove a missing or changed canned fingerprint preserves ordinary typed fields but refuses the stale selection and names the next action.

- [x] **Step 2: Prove RED**

```bash
pnpm exec vitest run tests/unit/intake-page-wiring.test.tsx tests/unit/shop-os-write-up-ui.test.tsx tests/unit/shop-os-quick-ticket-ui.test.tsx tests/unit/write-up.test.tsx --maxWorkers=1
```

Expected: actor props, session restore, discard, unload, and cross-remount request identity assertions fail.

- [x] **Step 3: Wire actor scope and restore without an initial overwrite**

Pass `ctx.profile.id` from both server pages. Read and validate storage before enabling persistence; use a restoration guard so blank initial state cannot overwrite a valid draft. Restore all values and the request-identity ref. Validate canned IDs/fingerprints against the current catalog before accepting them.

- [x] **Step 4: Persist and clear at truthful boundaries**

Persist after meaningful changes and synchronously immediately before fetch. Clear only after a validated success response or explicit discard. Keep the same key for ambiguous/network/malformed-success recovery. The existing top action `Discard` performs the storage clear before navigation. Add one quiet inline restored state and local discard control; no toast-only feedback.

- [x] **Step 5: Prove GREEN and commit**

```bash
pnpm exec vitest run tests/unit/shop-os-ticket-intake-draft.test.ts tests/unit/intake-page-wiring.test.tsx tests/unit/shop-os-write-up-ui.test.tsx tests/unit/shop-os-quick-ticket-ui.test.tsx tests/unit/write-up.test.tsx tests/unit/shop-os-counter-ticket-route.test.ts tests/unit/shop-os-quick-ticket-route.test.ts --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add app/'(app)'/intake/page.tsx app/'(app)'/tickets/new/page.tsx components/screens/write-up.tsx components/screens/write-up.module.css components/screens/quick-ticket.tsx components/screens/quick-ticket.module.css tests/unit/intake-page-wiring.test.tsx tests/unit/shop-os-write-up-ui.test.tsx tests/unit/shop-os-quick-ticket-ui.test.tsx tests/unit/write-up.test.tsx
git commit -m "feat: recover interrupted repair order drafts" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

---

### Task 3: Make supplemental diagnostic time idempotent and version-safe

**Files:**
- Modify: `lib/shop-os/quotes.ts`
- Modify: `lib/tickets.ts`
- Modify: `app/api/tickets/[id]/quote/diagnostic-time/route.ts`
- Modify: `components/screens/add-diagnostic-time.tsx`
- Modify: `tests/unit/shop-os-supplemental-diagnostic.test.ts`
- Modify: `tests/unit/shop-os-add-diagnostic-time.test.tsx`
- Modify: `tests/unit/shop-os-diagnostic-time-route.test.ts`

**Interfaces:**
- The POST body requires `clientKey: UUID`.
- `laborHours` accepts at most two decimal places, matching `numeric(8,2)` storage; the same canonical value drives insertion, replay, and confirmation.
- `addSupplementalDiagnosticTime` derives one namespaced job UUID from shop, ticket, persisted actor, and client key; exact replay returns the first job, while same key/different normalized intent conflicts. Success includes a server-derived confirmation bound to client key, deterministic job ID, canonical title/hours, and price.
- The mutation locks ticket → all jobs by ID → all lines by ID → active versions by ID → caller plus inherited assignee profiles by ID, then calls `invalidateActiveQuoteVersion` before inserting priced work. It reauthorizes the locked caller as an active advisor/owner and validates any inherited assignee from the locked rows.
- Lock contention returns `{ ok: false, error: 'conflict', retryable: true }` through the route. Optional `afterTicketLock` and `afterLinkLock` dependencies provide deterministic rollback/concurrency seams, while `captureLockSql` proves the generated lock order without changing production behavior.

- [x] **Step 1: Write RED domain tests**

Cover exact replay, same-key/different-intent, deterministic single job/line under ambiguous retry, rejection of more-than-two-decimal hours, ticket-scoped request identity, closed ticket, stale/deactivated or role-drifted caller, concurrently deactivated assignee, lock contention, job limit, and assignment warning. For an existing deterministic job, lock and validate its persisted assignee; prove replay still succeeds after the original diagnostic is reassigned and refuses after the supplemental job's own assignee is deactivated. Prepare V1 and an actionable link, add diagnostic time, then assert V1 superseded, link expired/token cleared, old snapshot byte-for-byte unchanged, old included unpinned jobs reset, and the new priced job is present only in Current draft. Force both schema-invalid and schema-valid-but-semantically-corrupt snapshots, or link-lock failure, and assert zero job/line insertion and no partial invalidation. Prove caller and assignee profiles lock in deterministic ID order after active versions.

- [x] **Step 2: Write RED route/UI tests**

In the dedicated diagnostic-time route suite, assert malformed/missing client key is refused, the route passes the key unchanged, retryable lock conflicts preserve `retryable: true`, and success propagates the exact server confirmation. Assert the component reuses one key for the same details after network or malformed-success failure, rotates it when details change, disables duplicate mounted submits, and reports invalidated current truth through its existing refresh callback. A deferred success for an older signature must refresh that server truth without clearing newer typed intent; the next submit uses a new key. Reject wrong confirmation client key/job/title/hours/price and unrelated same-title jobs, while accepting an exact replay whose current job lifecycle legitimately advanced.

- [x] **Step 3: Prove RED**

```bash
pnpm exec vitest run tests/unit/shop-os-supplemental-diagnostic.test.ts tests/unit/shop-os-add-diagnostic-time.test.tsx tests/unit/shop-os-diagnostic-time-route.test.ts --maxWorkers=1
```

Expected: key/replay/version/link assertions fail against the non-idempotent insert path.

- [x] **Step 4: Implement one canonical transaction**

Re-use `invalidateActiveQuoteVersion`; do not duplicate its snapshot/link logic. Export/reuse the existing full semantic snapshot validator and run it against a locked ticket projection containing `id`, `ticketNumber`, `customerId`, and `vehicleId` before invalidation. Convert validator exceptions into transactional conflict results; never leak a 500 or commit partial invalidation. Validate replay against the deterministic ticket-scoped job and its exact single labor line before any new write. For replay, lock/validate that job's persisted assignee; only a new write derives the inherited assignee from current diagnostic context. Use `FOR UPDATE NOWAIT` and the established lock order. After versions, lock the persisted caller and relevant assignee together in sorted profile-ID order, reauthorize the caller's fresh `canAssignWork` capability, and validate the assignee as active and same-shop from those rows. Catch `isLockUnavailable` at every lock stage and return a retryable conflict. Return refreshed `TicketDetail` plus the server-derived canonical confirmation only after the transaction has a coherent result.

- [x] **Step 5: Preserve mounted retry identity**

Hold `{ signature, clientKey }` in the component across a definite retry. Generate a new key only when normalized description/hours/price changes or after confirmed success. Validate the server confirmation against the submitted signature, then validate current ticket/job lifecycle separately. If fields changed while an older request was in flight, apply its validated server refresh but preserve the newer fields and rotate their next key; never let late success erase newer intent.

- [x] **Step 6: Prove GREEN and commit**

```bash
pnpm exec vitest run tests/unit/shop-os-supplemental-diagnostic.test.ts tests/unit/shop-os-add-diagnostic-time.test.tsx tests/unit/shop-os-diagnostic-time-route.test.ts tests/unit/shop-os-quote-versions.test.ts --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/shop-os/quotes.ts lib/tickets.ts app/api/tickets/'[id]'/quote/diagnostic-time/route.ts components/screens/add-diagnostic-time.tsx tests/unit/shop-os-supplemental-diagnostic.test.ts tests/unit/shop-os-add-diagnostic-time.test.tsx tests/unit/shop-os-diagnostic-time-route.test.ts
git commit -m "fix: keep added diagnostic work current" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

---

### Task 4: Add the dormant correction ledger and release boundary

**Files:**
- Create: `drizzle/migrations/0051_shop_os_ticket_corrections.sql`
- Modify: `lib/db/schema.ts`
- Modify: `tests/helpers/db.ts`
- Modify: `.env.example`
- Modify: `lib/release-policy.ts`
- Modify: `lib/shop-os/ticket-activity.ts`
- Modify: `lib/tickets.ts`
- Modify: `tests/unit/release-policy.test.ts`
- Modify: `tests/unit/shop-os-ticket-activity.test.ts`
- Modify: `tests/unit/migration-replay.test.ts`
- Modify: `tests/unit/db-migrate.test.ts`

**Interfaces:**
- Add `ticket_corrected` to `TICKET_ACTIVITY_KINDS` and the exact database check.
- Add `isTicketCorrectionEnabled()` and `TICKET_CORRECTION_UNAVAILABLE = { status: 404, body: { error: 'unavailable' } }`.
- `TicketActivityView` and its formatter expose a safe correction summary using only the validated scope and optional current job title.
- The append boundary accepts `ticket_corrected` only through a strict V1 receipt allowlist: exact scope/job envelope, lowercase SHA-256 intent hash, finite canonical `changedFields`, strict UUID/version pairs, and no unknown or free-text keys.
- Raw migration `0051` accepts only the exact old constraint state and refuses an already-complete or unexpected state. The ephemeral helper applies exact-old, no-ops on exact-complete, and refuses every missing/partial/unexpected definition.
- This task creates dormant source only. Production apply remains blocked until `0049`/`0050` dependencies and one authoritative, ledger-consistent migration path are separately approved; no selective raw apply is authorized here.

- [x] **Step 1: Write RED release and migration tests**

Assert every value except exact `true` fails closed. Assert raw migration SQL applies only from exact-old and refuses exact-complete/missing/partial/unexpected state; assert the ephemeral helper applies exact-old, no-ops on exact-complete, and refuses every other state before changing DDL. Assert the SQL sets bounded local lock and statement timeouts, locks `public.ticket_activity` in `ACCESS EXCLUSIVE` mode before catalog inspection, rolls back cleanly on forced post-lock failure, and full folder replay reaches the exact complete constraint. Separately prove the runner transaction rolls back both DDL and its migration-ledger receipt. Update the canonical migration-folder assertion to `0051`. Assert `ticket_corrected` inserts once, remains append-only, supports a job-scoped receipt, and rejects unknown/free-text receipt keys, invalid hashes, non-canonical fields, scope/job mismatches, unknown kinds, and non-object/oversized payloads. Feed hostile/malformed correction payloads through the activity projection and prove only exact scopes `identity | concern | job | job_removed` affect safe copy, raw customer/vehicle/concern/title values never reach `TicketActivityView`, and `job_removed` renders Removed rather than customer-declined work.

- [x] **Step 2: Prove RED**

```bash
pnpm exec vitest run tests/unit/release-policy.test.ts tests/unit/shop-os-ticket-activity.test.ts tests/unit/migration-replay.test.ts tests/unit/db-migrate.test.ts --maxWorkers=1
```

Expected: the new release helper, migration, and correction kind do not exist.

- [x] **Step 3: Add the additive migration and exact ephemeral seam**

Migration `0051` begins with bounded `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout`, acquires `LOCK TABLE public.ticket_activity IN ACCESS EXCLUSIVE MODE`, then inspects the exact constraint type, validation/inheritance flags, and definition while that lock is held. It aborts unless `ticket_activity_kind_valid` exactly matches the expected old state, then only drops/recreates that constraint with the existing kinds plus `ticket_corrected`; raw re-execution against complete state refuses. It must not touch triggers, rows, indexes, payload checks, privileges, or migration history outside the runner transaction. `ensureTicketCorrectionMigration` applies only from exact-old, no-ops on exact-complete, refuses every other state, and verifies complete state. A later production apply is not part of this task: first resolve and approve the `0049`/`0050` dependency order and one authoritative path that records the same migration ledger, then repeat the locked exact-state preflight immediately before guarded DDL.

- [x] **Step 4: Add the default-off source boundary and safe projection**

Add `.env.example` default false. Add the strict helper/404 body. Validate the privacy-minimized correction receipt before any append query, then extend the activity view/summary without returning raw correction payloads to the browser. Render `job_removed` as Removed, not customer-declined work.

- [x] **Step 5: Prove GREEN and commit**

```bash
pnpm exec vitest run tests/unit/release-policy.test.ts tests/unit/shop-os-ticket-activity.test.ts tests/unit/migration-replay.test.ts tests/unit/db-migrate.test.ts --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add drizzle/migrations/0051_shop_os_ticket_corrections.sql lib/db/schema.ts tests/helpers/db.ts .env.example lib/release-policy.ts lib/shop-os/ticket-activity.ts lib/tickets.ts tests/unit/release-policy.test.ts tests/unit/shop-os-ticket-activity.test.ts tests/unit/migration-replay.test.ts tests/unit/db-migrate.test.ts
git commit -m "feat: add dormant repair order correction ledger" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

---

### Task 5: Build the correction transaction and fail-closed route

**Files:**
- Create: `lib/shop-os/ticket-corrections.ts`
- Create: `app/api/tickets/[id]/corrections/route.ts`
- Modify: `lib/shop-os/quotes.ts`
- Modify: `lib/shop-os/ticket-activity.ts`
- Modify: `lib/auth-access.ts`
- Modify: `middleware.ts`
- Create: `tests/unit/shop-os-ticket-corrections.test.ts`
- Create: `tests/unit/shop-os-ticket-correction-route.test.ts`
- Create: `tests/unit/shop-os-ticket-correction-auth.test.ts`
- Modify: `tests/unit/shop-os-ticket-activity.test.ts`

**Public contract:**

```ts
export type TicketCorrectionResult =
  | {
      ok: true
      outcome: 'changed' | 'replayed' | 'unchanged'
      changed: boolean
      scope: 'identity' | 'concern' | 'job' | 'job_removed'
      invalidatedVersionNumber: number | null
      ticket: TicketDetail
    }
  | {
      ok: false
      error: 'unavailable' | 'invalid_input' | 'not_found' | 'forbidden'
        | 'conflict' | 'ticket_not_open' | 'job_not_open' | 'last_job'
      retryable?: boolean
    }

export function correctTicket(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown; body: unknown },
  dependencies?: TicketCorrectionDependencies,
): Promise<TicketCorrectionResult>
```

Dependencies expose only deterministic test seams after ticket/job-line/version/link/actor locks and before the final write. Production code supplies none.

- [ ] **Step 1: Write RED validation/authorization tests**

Cover strict discriminated bodies; UUID/timestamp/text/vehicle bounds; exact advisor/owner authorization from the persisted profile; missing shop; tech/parts/inactive/deactivated roles; and cross-shop ticket/customer/vehicle/job/request-key hiding. Prove the exact correction route matcher and middleware return the shared no-store 404 before `refreshSession`, while neighboring ticket routes still follow normal auth. Prove the route-level OFF gate also precedes params, rate limit, media-type checks, body, and domain queries. Require a normalized media type of exactly `application/json`; missing, form, multipart, and `text/plain` requests return no-store 415 before stream reading or domain work. An actual body over 8 KiB must be rejected before JSON parsing even when `Content-Length` is missing or misleading. Canonicalize and validate the route ticket UUID before constructing the quota key; uppercase/lowercase spellings must share one bucket. Prove limiter-store failure returns no-store 503 before reading the body or calling the domain.

- [ ] **Step 2: Write RED idempotency/concurrency tests**

For each scope, prove the canonical ticket → jobs → lines → active versions → actor locks and locked reauthorization happen before receipt lookup. Same request key + same intent returns `outcome: 'replayed'` with the first receipt even after current timestamps move; same key/different intent conflicts; a new normalized no-op returns `outcome: 'unchanged'`; a real write returns `outcome: 'changed'`; and `changed` is true only for that last outcome. Include a replay created before any prepared version so scope/version cannot be used to guess the outcome. Before trusting replay scope/version, validate the entire persisted receipt with `isTicketCorrectionReceiptV1`; hostile direct-DB rows with unknown keys, malformed versions, or scope/job mismatch must conflict without returning current ticket data. Prove stale ticket/job/active-version conflicts, multiple active versions conflict, NOWAIT contention is retryable, actor deactivation, demotion, or shop reassignment at `afterVersionLock` before replay/new-write reauthorization is refused, and receipt/mutation roll back together. The locked actor query must remain bound to the originally resolved shop. Store an intent hash of the canonical request including its random request key, never raw PII/free text.

- [ ] **Step 3: Write RED correction/version tests**

Prove identity relinks only this ticket to an existing or reused/new same-shop pair and never mutates the old rows. Identity and concern correction are ticket-wide and must refuse when any non-canceled job is non-open, session-linked, in diagnostic `initializing`/`ambiguous`, or otherwise pinned by the shared quote-work predicate. Prove concern updates. Prove job title/kind/supplied-note changes preserve assignment and skill tier. Target-job correction/removal must refuse a session, non-open state, or diagnostic `initializing`/`ambiguous`. `remove_job` requires another non-canceled job, sets canceled without deleting job/lines, and writes a job-scoped `job_removed` receipt.

For each mutation with V1 active, assert canonical locks, full semantic validation against the locked ticket, old snapshot byte-for-byte equality, V1 superseded, actionable link expired/token-cleared, included unpinned jobs reset, and exactly one privacy-minimized receipt. Force schema-invalid and schema-valid-but-semantically-corrupt snapshots, unknown included job, CAS/link/actor contention, and assert zero fact change/receipt. Freeze time: every changed correction must advance `tickets.updated_at` strictly beyond its prior value, and job/remove must also advance the target job timestamp; unchanged/replayed requests preserve both. A new normalized no-op returns `outcome: 'unchanged'`, `changed: false`, and leaves facts, receipt, V1, and handoff untouched. An exact replay returns `outcome: 'replayed'`, `changed: false`, with the original scope/version receipt and fresh authorized ticket truth loaded inside the still-locked transaction.

- [ ] **Step 4: Prove RED**

```bash
SHOP_OS_TICKET_CORRECTION_ENABLED=true pnpm exec vitest run tests/unit/shop-os-ticket-corrections.test.ts tests/unit/shop-os-ticket-correction-route.test.ts tests/unit/shop-os-ticket-correction-auth.test.ts --maxWorkers=1
```

Expected: module and route do not exist.

- [ ] **Step 5: Implement strict parsing and canonical transaction**

Fail closed before parsing/DB. Resolve tenant scope only from the persisted actor row, then lock ticket → all jobs sorted → all lines sorted → active versions sorted → the same actor constrained by profile ID, original shop ID, active membership, and null deactivation; reauthorize advisor/owner before any receipt can produce a response. Export/reuse the shared pinned-work predicate so correction safety exactly matches quote invalidation. Check the immutable receipt by `(shop_id, request_key)` after those locks and before stale/state validation; first require `isTicketCorrectionReceiptV1(existing.payload, existing.jobId)`, then compare exact ticket, actor, kind, job envelope, and intent hash. Dependencies are named `afterVersionLock`, `afterActorLock`, `afterLinkLock`, and `beforeFactWrite`, matching those exact deterministic boundaries. For a new write, validate expectations/state and the active snapshot with the full semantic validator plus exact locked job and line truth. Return a normalized no-op without fact, receipt, version, or handoff changes. Otherwise call `invalidateActiveQuoteVersion`, apply the fact change with a monotonic millisecond timestamp, append the safe receipt through `INSERT ... ON CONFLICT DO NOTHING RETURNING`, compare any concurrent winner without first aborting the PostgreSQL transaction, and commit. Reuse `upsertCustomer`/`upsertVehicle` only inside this transaction. Before the transaction callback returns, construct the actor only from the locked persisted profile and reload through `getTicketDetail` on that same transaction; never reload PII afterward from caller-supplied role/shop fields.

- [ ] **Step 6: Implement the route boundary**

Add an exact `isTicketCorrectionRoute` matcher and middleware gate so disabled correction POSTs return the shared no-store 404 before session refresh. Repeat that gate at the route before auth, params, rate limit, media type, body, or DB. When enabled: authenticate, paywall-check, resolve and lowercase one valid ticket UUID, then call `checkRateLimit` with the stable actor key `ticket-correction:{shopId}:{profileId}` at 20 requests/minute. The route UUID must be valid before quota work, but attacker-selected UUIDs never create fresh buckets or bypass the actor cap. A denied bucket returns no-store 429 with `Retry-After`; limiter-store failure returns no-store 503 and fails closed before stream reading or domain work. Require normalized `application/json`, returning no-store 415 otherwise. Read at most 8 KiB of actual request text before JSON parsing (never trust `Content-Length` as the bound), then pass only profile-derived actor. Success is HTTP 200 with exact `{ outcome, changed, scope, invalidatedVersionNumber, ticket }`; failures are `{ error, retryable? }`, mapping invalid JSON/input 400, unsupported media 415, oversized 413, hidden 404, forbidden 403, conflict/state 409, limiter failure 503, and rate limit 429. Normalize every disabled, auth, paywall, rate-limit, parse, domain, and success response to `Cache-Control: no-store`, including correction-route middleware denials and responses returned by shared helpers; return no cross-shop current record on an error.

- [ ] **Step 7: Prove GREEN and commit**

```bash
SHOP_OS_TICKET_CORRECTION_ENABLED=true pnpm exec vitest run tests/unit/shop-os-ticket-corrections.test.ts tests/unit/shop-os-ticket-correction-route.test.ts tests/unit/shop-os-ticket-correction-auth.test.ts tests/unit/shop-os-ticket-activity.test.ts tests/unit/shop-os-quote-versions.test.ts --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/shop-os/ticket-corrections.ts app/api/tickets/'[id]'/corrections/route.ts lib/shop-os/quotes.ts lib/shop-os/ticket-activity.ts lib/auth-access.ts middleware.ts tests/unit/shop-os-ticket-corrections.test.ts tests/unit/shop-os-ticket-correction-route.test.ts tests/unit/shop-os-ticket-correction-auth.test.ts tests/unit/shop-os-ticket-activity.test.ts
git commit -m "feat: correct repair order truth atomically" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

---

### Task 6: Mount correction at the fact with the detent settle

**Files:**
- Create: `lib/shop-os/ticket-correction-draft.ts`
- Create: `lib/shop-os/ticket-correction-ui.ts`
- Create: `components/screens/ticket-correction-workspace.tsx`
- Create: `components/screens/ticket-correction-workspace.module.css`
- Modify: `app/(app)/tickets/[id]/page.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `components/screens/ticket-detail.module.css`
- Modify: `lib/tickets.ts`
- Create: `tests/unit/shop-os-ticket-correction-draft.test.ts`
- Create: `tests/unit/shop-os-ticket-correction-ui.test.ts`
- Create: `tests/unit/shop-os-ticket-correction-workspace.test.tsx`
- Modify: `tests/unit/shop-os-ticket-activity.test.ts`
- Modify: `tests/unit/shop-os-ticket-detail.test.tsx`
- Modify: `tests/unit/shop-os-ticket-page.test.tsx`

**Interfaces:**
- Add `canCorrectTicket?: boolean` to `TicketDetailScreen`; the server page sets it only when the strict flag and the same `canAssignWork(role)` capability enforced by the correction domain are true.
- `TicketCorrectionWorkspace` receives actor/ticket/target and `onApplied(result)` / `onClose()` callbacks. Its typed applied projection contains target, `outcome: changed | replayed | unchanged`, validated ticket, validated quote state, invalidated version number, and exact announcement. `TicketDetailScreen` owns and atomically installs that ticket-plus-quote projection; success state cannot disappear merely because the workspace unmounts.
- The workspace loads fresh ticket and quote baselines before editing and never trusts stale page props for expected timestamps/version. After a changed result or replay, it reloads the quote projection before declaring success because the mutation response does not hard-code active-version truth.
- `TicketDetailScreen` owns one discriminated open-tool state (`quote | work | correction | null`). A correction opens only from idle and never silently closes or discards another mounted tool.
- The correction draft is actor/ticket/target scoped, strict, 8 KiB/12 hours, sessionStorage only, and includes the exact normalized pending request body/signature plus request key. An ambiguous retry reuses that byte-equivalent intent; refreshing expectations rotates the key instead of creating a same-key/different-intent conflict.
- `parseTicketCorrectionBaseline` and `parseTicketCorrectionSuccess` strictly rehydrate dates, IDs, job/activity shapes, and correction outcomes from JSON before any local state or confirmed settle is installed; no response is cast to `TicketDetail`.
- `TicketActivityView` exposes only a validated correction-scope enum for `ticket_corrected` rows. Reloaded job rows use exact `job_removed` scope to render Removed; ordinary customer-declined/canceled rows are never relabeled.

- [ ] **Step 1: Write RED draft/workspace tests**

Cover scope/age/size/corrupt rejection, exact target restore, byte-equivalent pending-body/signature plus request-key reuse, expectation-refresh key rotation, and no raw storage rendering. For identity, concern, job, and remove: editor renders directly below the touched block; no modal/overlay/route change; cancel restores invoking focus; loading announces `Checking current repair-order truth…`; saving announces `Saving correction…` without success color/motion; conflict refreshes current baseline beside retained typed fields and exposes focused Retry only when retry is valid; forbidden/started/last-job refusal names the actual next action. A malformed/failed ticket or quote refresh keeps the editor, draft, and request identity with an inline amber 2px rail and paints no confirmed state. Strict parser tests reject missing/extra keys, malformed timestamps/IDs, incomplete jobs/activities, and mismatched correction outcomes before state installation.

- [ ] **Step 2: Write RED page/detail tests**

Assert no correction UI or correction baseline fetch while flag OFF or role is tech/parts. With flag ON + advisor/owner, assert a combined customer/vehicle identity target, concern target, and each eligible job target; unique 44px labels (`Correct customer or vehicle`, `Correct concern`, `Correct job 02: [title]`); one discriminated open tool that never auto-closes dirty work; accurate provisional identity action; and only a job with validated `job_removed` activity scope labeled Removed after reload. Assert the typed applied projection atomically updates identity/concern/job plus quote truth without a reload or `router.refresh()`, and V1 invalidation renders `Current draft · V1 no longer current`.

- [ ] **Step 3: Write RED detent-settle/accessibility tests**

After—not before—both validated ticket and quote truth: collapse editor, apply `data-correction-state="confirmed"` to only the corrected fact, focus its `tabIndex={-1}` block, expose a polite exact live-region message plus visible local status, and show a dedicated 2px signal rail. Changed/replayed outcomes seat `translateY(-2px) → 0` and `opacity: .92 → 1` for `200ms var(--vt-ease-out)`; the rail/status persist until another correction opens or reload. A new unchanged no-op shows `No change needed` with no detent or signal rail. Removal says `Removed from active work. It remains in History.` Replay says `Already saved. The repair order is current.` Assert visible focus styling, scroll margin, no restart loop/bounce/gradient/sparkle, one primary action, and reduced motion removes all transform/transition while retaining updated text, rail where applicable, focus, status, announcement, and version truth.

- [ ] **Step 4: Prove RED**

```bash
SHOP_OS_TICKET_CORRECTION_ENABLED=true pnpm exec vitest run tests/unit/shop-os-ticket-correction-draft.test.ts tests/unit/shop-os-ticket-correction-ui.test.ts tests/unit/shop-os-ticket-correction-workspace.test.tsx tests/unit/shop-os-ticket-activity.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-ticket-page.test.tsx --maxWorkers=1
```

Expected: draft/workspace and page prop do not exist; mounted correction assertions fail.

- [ ] **Step 5: Implement fresh baseline and local recovery**

On opening a fact, load existing tenant-safe ticket and quote GET projections with `cache: no-store`, pass both through strict client parsers, validate ticket/job IDs and active version, then initialize or reconcile the scoped draft. Keep typed fields through 409/refusal; refresh expectations beside the typed proposal, rotate the request key, and explain the next valid action. After POST changed/replayed success, reload the quote projection with `cache: no-store`; if that refresh fails, preserve the exact pending body/signature and request key, render local amber recovery, and offer Retry without painting success. Clear only after both refreshed ticket and quote truth are validated, on a validated unchanged result, or on explicit discard.

- [ ] **Step 6: Implement the mounted fact editors**

Reuse `PredictiveIntakeSearch` for identity selection. Wrap customer and vehicle in one combined identity target and render its editor below both; use the concern section as its target; render job editor/remove confirmation inside that job row. Add a dedicated rail element, attaching the job rail to `.jobBody` rather than reusing the numbered ledger spine pseudo-element. Give every target a stable accessible name, `tabIndex={-1}`, visible focus treatment, and scroll margin. Preserve assignment/skill as visible read-only truth. Make remove history-preserving and refuse the final active job before submission when current truth already proves it.

- [ ] **Step 7: Integrate server truth and the mechanical settle**

Keep one current ticket projection and one current quote projection in `TicketDetailScreen`; install both atomically only from the typed applied projection or refreshed server props. The correction path must not call `router.refresh()` after apply; local ticket/quote/assignment/work/approval maps reconcile to the new projection without masking it, and the rail/status persist until another correction opens or a later explicit reload. Extend the existing quote/work arbitration to the correction union: only one tool may open, and another mounted tool must be explicitly closed/cleared rather than silently discarded. On validated changed/replayed truth, collapse the editor and settle the exact fact over 200ms using existing Shop OS bone/signal/amber tokens; focus it; announce the outcome; persist its local status/rail; and reveal the invalidated version number when present. Clear the prior confirmed state when a new correction opens so the same fact can settle again. A new no-op leaves version/handoff visible and receives no detent. Reduced motion retains all non-motion truth.

- [ ] **Step 8: Prove GREEN and commit**

```bash
SHOP_OS_TICKET_CORRECTION_ENABLED=true pnpm exec vitest run tests/unit/shop-os-ticket-correction-draft.test.ts tests/unit/shop-os-ticket-correction-ui.test.ts tests/unit/shop-os-ticket-correction-workspace.test.tsx tests/unit/shop-os-ticket-activity.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-ticket-page.test.tsx tests/unit/intake-search-component.test.tsx --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/shop-os/ticket-correction-draft.ts lib/shop-os/ticket-correction-ui.ts components/screens/ticket-correction-workspace.tsx components/screens/ticket-correction-workspace.module.css app/'(app)'/tickets/'[id]'/page.tsx components/screens/ticket-detail.tsx components/screens/ticket-detail.module.css lib/tickets.ts tests/unit/shop-os-ticket-correction-draft.test.ts tests/unit/shop-os-ticket-correction-ui.test.ts tests/unit/shop-os-ticket-correction-workspace.test.tsx tests/unit/shop-os-ticket-activity.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-ticket-page.test.tsx
git commit -m "feat: settle corrections into repair order truth" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

---

### Task 7: Prove Finish, Correct, Recover and converge once

**Files:**
- Create or modify: `tests/e2e/ticket-building-correction-proof.spec.ts`
- Create: `tests/e2e/ticket-building-correction-harness/` (local Vite mount, fixture, and required Next aliases only)
- Create: `playwright.ticket-building-correction.config.ts`
- Create: `tests/unit/shop-os-ticket-building-correction-harness.test.ts`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `docs/superpowers/specs/2026-08-03-shop-os-ticket-building-correction-design.md`
- Modify: `docs/superpowers/plans/2026-08-03-shop-os-ticket-building-correction.md`
- Modify: `tasks/lessons.md`

- [x] **Step 1: Add mounted phone and desktop proof**

Use a deliberately split proof boundary. Persistence, migration `0051`, authorization, immutable V1, link expiry, receipts, replay, and zero-duplicate guarantees run against the real domain in the existing ephemeral PGlite golden-shop suites with the flag true. Browser evidence runs at 390×844 and 1440×900 in a localhost-only Vite harness that mounts the production React surfaces and uses deterministic in-memory HTTP fixtures. The browser harness proves rendered interaction, not database persistence; the two receipts are accepted only together.

The harness must not import or invoke `scripts/shop-os-golden-browser.mjs`, pull Vercel environment files, read `.env.local`, contact Supabase, or receive `DATABASE_URL`, `DATABASE_URL_DIRECT`, or `SUPABASE_SERVICE_ROLE_KEY`. Its server/config exits before startup if the base URL is not loopback, `VERCEL_ENV=production`, or any database/auth secret is present. No correction-enabled browser run may target production or preview infrastructure. Prove:

- **Finish:** the domain journey persists diagnosis-first plus one in-place repair job and exact pricing; the harness independently proves the mounted repair-order transition and reload rendering from the resulting deterministic state.
- **Correct:** the domain journey corrects identity, concern, and one unstarted job before prepare, then independently after V1/share proves Current draft, expired handoff, and immutable V1; the harness proves the local detent settle from validated dual projections.
- **Recover:** the domain journey proves draft/request identity and exactly one supplemental job/line; the harness proves pending/slow/error search cannot create, stale correction retains typed fields while truth refreshes, and browser Back does not lose or duplicate a completed visual save.

Assert no horizontal overflow, browser faults, serious/critical Axe findings, broken focus order, target below 44px, motion without reduced-motion equivalence, or generic success decoration. Save one phone and one desktop screenshot to ignored `test-results/ticket-building-correction/`.

- [x] **Step 2: Run focused integrated proof**

```bash
SHOP_OS_TICKET_CORRECTION_ENABLED=true node node_modules/vitest/vitest.mjs run \
  tests/unit/intake-search-component.test.tsx \
  tests/unit/shop-os-ticket-intake-draft.test.ts \
  tests/unit/shop-os-write-up-ui.test.tsx \
  tests/unit/shop-os-quick-ticket-ui.test.tsx \
  tests/unit/shop-os-supplemental-diagnostic.test.ts \
  tests/unit/shop-os-add-diagnostic-time.test.tsx \
  tests/unit/shop-os-diagnostic-time-route.test.ts \
  tests/unit/release-policy.test.ts \
  tests/unit/shop-os-ticket-activity.test.ts \
  tests/unit/shop-os-ticket-corrections.test.ts \
  tests/unit/shop-os-ticket-correction-route.test.ts \
  tests/unit/shop-os-ticket-correction-auth.test.ts \
  tests/unit/shop-os-ticket-correction-draft.test.ts \
  tests/unit/shop-os-ticket-correction-ui.test.ts \
  tests/unit/shop-os-ticket-correction-workspace.test.tsx \
  tests/unit/shop-os-ticket-detail.test.tsx \
  tests/unit/shop-os-ticket-page.test.tsx \
  tests/unit/shop-os-ticket-building-correction-harness.test.ts \
  --maxWorkers=2
node node_modules/vitest/vitest.mjs run tests/unit/migration-replay.test.ts tests/unit/db-migrate.test.ts --maxWorkers=1
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
```

The migrated-domain receipt must explicitly include exact-old → complete `0051` replay, exact-complete no-op, drift refusal, DDL/data/trigger/ledger atomic rollback, correction receipt persistence, immutable V1, expired actionable handoff, and zero duplicate supplemental work. It is the persistence half of the split proof.

- [x] **Step 3: Build and run the mounted browser half**

Run only `playwright.ticket-building-correction.config.ts` against the dedicated loopback harness, using system Chrome when bundled Chromium is unavailable. Intercept the harness APIs with deterministic stateful fixtures that exercise pending, slow, failure, stale conflict, malformed refresh, exact replay, late success, and browser Back. The fixture may preserve state across a reload, but its receipt must say that this is deterministic harness state, not database persistence.

```bash
env -u DATABASE_URL -u DATABASE_URL_DIRECT -u SUPABASE_SERVICE_ROLE_KEY -u VERCEL_ENV \
  PLAYWRIGHT_USE_SYSTEM_CHROME=1 \
  corepack pnpm@10.18.3 exec playwright test --config playwright.ticket-building-correction.config.ts
```

Record exact loopback base URL, commit-or-dirty-tree status, viewport, screenshots, Axe/browser-fault receipts, and the harness's no-secret/no-network startup assertion. Never use the production-backed golden-browser helper for this proof.

- [x] **Step 4: Commit proof/docs and establish a clean verification head**

```bash
git config user.name
git config user.email
git add tests/e2e/ticket-building-correction-proof.spec.ts tests/e2e/ticket-building-correction-harness playwright.ticket-building-correction.config.ts tests/unit/shop-os-ticket-building-correction-harness.test.ts docs/strategy/SHOP_OS_DRIVER_STATE.md docs/superpowers/specs/2026-08-03-shop-os-ticket-building-correction-design.md docs/superpowers/plans/2026-08-03-shop-os-ticket-building-correction.md tasks/lessons.md
git commit -m "test: prove ticket correction recovery" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
git log -1 --format=full
git status --porcelain
```

Require empty `git status --porcelain`. Dirty-tree proof is useful while building but is not final acceptance evidence.

- [x] **Step 5: Run the exact full gate on that clean head**

```bash
git rev-parse HEAD
node scripts/test-shards.mjs
node_modules/.bin/tsc --noEmit --pretty false
corepack pnpm@10.18.3 build
env -u DATABASE_URL -u DATABASE_URL_DIRECT -u SUPABASE_SERVICE_ROLE_KEY -u VERCEL_ENV PLAYWRIGHT_USE_SYSTEM_CHROME=1 corepack pnpm@10.18.3 exec playwright test --config playwright.ticket-building-correction.config.ts
git diff --check
git status --porcelain
git rev-parse HEAD
```

Confirm all eight serialized shards ran and the script reported a nonzero total test count. Require both HEAD values to match and final status to be empty.

- [x] **Step 6: Run parallel final review and one repair wave**

Dispatch independent static/intent, security/privacy/concurrency, and runtime/accessibility reviewers against the exact implementation head. Consolidate all Critical/Important findings, make one repair wave, rerun focused tests, then one focused re-review. A new unrelated blocking defect after that re-review triggers the architecture stop.

If repair changes any file, commit the consolidated repair with the required trailers, establish a new clean head, and rerun Steps 2, 3, and 5 in full. No pre-repair full-suite, build, browser, or review receipt may be attributed to the repaired head.

- [x] **Step 7: Push and open the channel-linked PR, then prove preview OFF**

Push the exact clean reviewed head, then open a current-channel-linked PR for channel `95938fc9-02c1-4c1a-8b20-84f540bc6c74`. Prefer Buzz NIP-34 when the relay has a valid Shop OS repository announcement; otherwise use the GitHub connector, record the channel/thread in the PR, and publish the PR URL back to that thread. Report exact head, local proof, split-proof evidence ceiling, dormant flag/migration posture, reviewers, and rollback. On the exact PR preview, prove `/api/health` is healthy and the correction POST returns exact no-store `404 {"error":"unavailable"}` while the flag is absent. The authenticated UI-absence claim remains source/page-test evidence; do not use the production-backed golden helper or mutate its QA tenant to manufacture a preview receipt.

- [x] **Step 8: Assert every hosted check before merge**

Require the exact PR head to have completed successful check runs for `CI / verify`, `CI / test (1)` through `CI / test (8)`, Vercel, and GitGuardian Security Checks. Reconcile these expectations against the exact names returned by GitHub; fail on missing, pending, skipped, neutral, stale-SHA, or unsuccessful checks. Repository protection or an auto-merge label is not evidence. Only then merge under the existing preapproval and verify the merge commit tree equals the tested feature-head tree.

- [x] **Step 9: Post-merge dormant production proof**

Wait for the production deployment explicitly bound to the merge SHA. Verify `/api/health` succeeds and the correction route returns exact no-store `404 {"error":"unavailable"}` with the flag absent. Through read-only production inspection only, confirm the pre-`0051` constraint definition, no `0051_shop_os_ticket_corrections.sql` migration-ledger row, and zero `ticket_corrected` rows. Do not run baseline, migration, DDL, cleanup, or a correction-enabled browser. Record that activation remains blocked on explicit `0049`/`0050` dependency approval plus one authoritative, ledger-consistent migration path.

## Rollback and stop contract

- Source rollback: revert the Chunk 2 merge. The default-off correction flag means correction rows cannot exist before a separately approved activation.
- Pre-activation migration rollback, if separately authorized later: use a separately approved forward migration only after proving zero `ticket_corrected` rows, then restore the old check definition under the same locked exact-state and atomic-ledger rules. Never drop history or bypass append-only triggers.
- Stop immediately for production migration/activation, destructive customer cleanup, secrets/external-provider needs, uncertain cross-shop visibility, a third replan, the same implementation approach failing twice, or a new unrelated blocker after focused re-review.
- Intake recovery and supplemental diagnostic corrections remain normal source behavior; if either independently regresses, revert its bounded commit rather than activating dormant correction code.

## Acceptance map

| Gate | Observable proof |
|---|---|
| Finish | Ephemeral migrated-domain proof persists one mixed diagnostic/repair order; the localhost browser harness separately proves the real mounted phone/desktop workspace and reload rendering. |
| Correct | The domain writes one safe receipt per correction and preserves immutable V1/link rules; the browser harness separately proves inline geometry, atomic projection, and the detent settle. |
| Recover | Domain proof prevents duplicates and preserves exact request identity; the browser harness separately proves retained fields, Retry, late success, and browser Back behavior. |
| Premium interaction | The touched fact alone settles after server truth, focus/announcement/rail agree, and reduced motion remains equally clear. |
| Release safety | Full suite/type/build/reviews/hosted checks pass on one head; source merges default-off; production route/UI remain unavailable and migration unapplied. |

## Task 7 execution receipt — 2026-08-03

- Focused integrated unit gate: 18 files / 408 tests passed with the correction flag enabled.
- Migration gate: 2 files / 13 tests passed; the new migrated-domain harness contributes 11 passing tests.
- TypeScript and `git diff --check`: passed.
- Dedicated browser gate: implementation complete but receipt blocked. The sandbox refused `127.0.0.1:4181` listen with `EPERM`; the required escalated system-Chrome rerun was interrupted before startup. Under the two browser/sandbox issue stop rule, no third attempt was made and no screenshot, Axe, viewport, browser-fault, or rendered-interaction claim is attributed to this tree.
- Consolidated browser repair: the deterministic fixture now refuses ticket reads before the exact create transition, records exact request bodies/identities in an explicit ledger with unordered concurrent baseline epochs, and checks transient/recovery Axe, overflow, focus, normal/reduced motion, stable correction-target names, listbox wiring, and every visible enabled interactive target. Production accessibility repairs are limited to the predictive-search name/listbox relationship and correction-target names. The control lane still owns the only final browser rerun and no runtime claim is attributed to this source-only repair.
- Architecture stop after three repaired-tree browser runs: run 1 found the pending panel exposed as an empty listbox on both widths; strict RED/GREEN repair now exposes stable status semantics. Run 2 found the proof's old pending-copy selector; the proof now targets the exact accessible status. Run 3 reached slow search on both widths but the 5.3-second assertion allowed only 150 ms beyond the production debounce plus slow threshold. No phone/desktop journey has passed, so Task 7 and Chunk 2 remain unaccepted.
- Recommended reset: split transient search accessibility/recovery from the repair-order Finish/Correct/Recover journey and advance the production five-second slow timer with Playwright's browser clock. Preserve the same strict Axe, 44px, no-network, ledger, focus, motion, and reduced-motion gates; do not merely increase another wall-clock timeout.
- Release state: dirty local proof tree only. No commit, push, PR, preview, hosted check, merge, production migration, activation, external request, or secret access occurred in this lane.
- Final bounded recovery: Brandon reopened one harness-only lane in Buzz event `c0171527c8a63768bcb96c2b882cfd6dd276ab8d8bc748cdf6c42c561e769b27`. The correction-route `409` expected-refusal rule was added RED-first beside the existing close-route rule; its negative cases preserve all other faults. The complete focused gate passed 19 files / 419 tests plus 2 migration/replay files / 13 tests, TypeScript, diff integrity, and four-case discovery, followed by independent APPROVE with no finding.
- Dedicated browser GREEN: the exact loopback system-Chrome gate passed all four cases in 18.6 seconds. Search passed in 3.7 seconds phone / 3.4 seconds desktop; Finish / Correct / Recover passed in 4.2 seconds phone / 4.6 seconds desktop. The two deterministic screenshots are 390×844 (`02723a…704f9`) and 1440×900 (`a3cf20…f7197`) and were inspected without visible overlap. This proves rendered harness behavior, not database persistence; the migrated PGlite half remains the persistence receipt.
- Clean-head convergence: the proof source and CSS-module selector repair passed 19 files / 419 focused tests, 13 migration/replay tests, all eight shards / 4,205 tests, TypeScript, a 69-page build, and repeated 4/4 loopback system-Chrome runs. Final security returned PASS and runtime/accessibility found no product defect.
- Consolidated review repair: final static review found that retained `Removed` provenance depended on the capped recent feed. RED-first server and UI regressions prove the failure after 21 newer activities; the tenant/ticket/job-bound validated projection repair passed three focused files / 101 tests, TypeScript, and diff integrity. Focused static re-review closed the original Important finding and status drift with no remaining Critical, Important, or Minor finding.
- Final exact-head release gate: tested head `e22bade` passed 19 files / 423 focused tests, 13 migration/replay tests, all eight local shards / 4,209 tests, TypeScript, a 69-page build, and repeated 4/4 loopback system-Chrome runs. Phone and desktop screenshots remained byte-identical across runs at `02723a…704f9` and `a3cf20…f7197`.
- Hosted convergence: Buzz had no Shop OS repository announcement, so PR #244 was opened through the GitHub connector with the exact Buzz channel/thread recorded in its body and the PR URL published back to that thread. It carried exact head `e22bade`; preview deployment `dpl_6SWfNnzyD8qmXR5Eft1dW3sw6oXo` was READY and returned health `200 {"ok":true}` plus correction no-store `404 {"error":"unavailable"}`. Verify, shards 1–8, Vercel Preview Comments, and GitGuardian Security Checks all completed successfully on that exact SHA.
- Merge and dormant production: PR #244 merged as `3972834`; its tree equals the tested feature tree and its merge commit carries both required human trailers. Production deployment `dpl_DHnTQdPXQRp3Z2k8iP7KYWKf1mbf` is READY and bound to the merge. The exact deployment and `vyntechs.dev` both returned health `200` and correction no-store `404 unavailable`. Read-only production inspection found the pre-`0051` constraint, zero `0051` ledger rows, and zero `ticket_corrected` rows.
- Current release state: source is merged and deployed dormant. Migration `0051`, correction activation, legal posture, production mutation, and correction-enabled external proof remain separate owner gates.
