# Shop OS Technician Work Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a technician start and complete approved work without mandatory typing or time tracking, while preserving an optional personal job timer, unusual work detail, truthful recovery, and an in-place Today completion receipt.

**Architecture:** Keep work truth in the existing `ticket_jobs` record and the mounted Work/Today surfaces. Add one default-off per-person timer preference, make `start_work` independent from `clock_on`, replace the two-write note/finish path with one explicit atomic completion intent, version the bounded browser draft for lossless recovery, and reconcile server-confirmed completion back into Today without a page jump. Extend the migration runner with a narrowly targeted production cutoff so independent migration `0049a` can never pull paused migrations `0050` or `0051` with it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Drizzle/PostgreSQL, PGlite, Zod 4, CSS Modules, Vitest 4, Testing Library, Playwright 1.59.

**Approved design:** `docs/superpowers/specs/2026-08-05-shop-os-technician-work-core-design.md`

**Design-direction approval:** Buzz event `74bfb55967e73f88da82b341d5404bd8bc29259750a23795c57b61fa3078c3b0`

**Written-spec approval and language correction:** Buzz event `f695178533302a501fcf5476d5810d70619d4ab276ed877775c93be153ca25ae`

## Intent and Acceptance Contract

- **True outcome:** Finishing normal approved work is one deliberate tap, not paperwork. Optional tools never become gates.
- **Normal technician path:** `Start work` → `Complete as approved` → server-confirmed receipt → Today settles the job to Complete.
- **Exceptional path:** `Add detail` → `Anything worth recording? (optional)` → `Complete with detail`; the detail and completion land atomically.
- **Timer rule:** A wrenching person may enable `Track time on my jobs`; default is off, it is personal job-time only, and it is never payroll, performance scoring, or a management dashboard.
- **Acceptance:** A timer-off technician can start and complete approved work without typing; a timer-on wrenching person starts/banks time truthfully; typed detail survives clock changes, reloads, ambiguous responses, and concurrent edits; completion remains one-time and server-confirmed; Today changes in place without hiding the receipt.
- **Authority:** Source code, tests, docs, commits, branch push, and a reviewable PR are approved. Applying migration `0049a`, merging, and production deployment each remain explicit owner gates.

## Global Constraints

- Never show `note`, `notes`, `work note`, or the legacy `workNotes` storage name in technician-facing copy. Use `Add detail`, `Anything worth recording? (optional)`, and `Complete with detail`.
- `Start work` is the core work transition. It succeeds with the timer preference off and does not depend on a text field.
- `Complete as approved` does not ask the technician to retype the approved scope. Preserve an existing saved legacy detail when the technician supplies no replacement; if none exists, record the canonical internal completion value `Completed as approved.`.
- Optional detail is internal shop truth and remains excluded from customer-facing copy. It is saved in the same transaction as completion; no separate Save step or partial success is allowed.
- Timer eligibility follows persisted wrenching skill tier `1 | 2 | 3`, not role title. The person may change their own preference in My Account; an owner/founder may change it for that same-shop person in Team.
- The default-off preference is server truth shared across devices. Do not implement browser-only state or a role-wide switch.
- If a timer is already running when preference or eligibility becomes false, it remains visible and stoppable. Time must never continue invisibly.
- Enabling the preference after a job is already in progress does not retroactively start its timer. The person may use the explicit Clock on control.
- `clock_on` resumes only already-started work and requires current effective timer eligibility. It no longer changes `open` to `in_progress`.
- `clock_off` remains idempotent and may bank an already-running timer even when the preference is now off.
- Completion is idempotent. A repeated request returns the exact persisted completion receipt without rebanking time or rewriting detail.
- All mutations recheck tenant, active membership, assignment, approved pinned authorization, supported work state, and expected job freshness inside the transaction.
- Ambiguous client outcomes reload exact server truth before claiming success or failure. Local detail clears only after exact completion proof.
- Local drafts are bounded by actor, ticket, job, work state, authorization state, and saved detail baseline. Migrate the exact legacy v1 draft forward; never discard a compatible typed value silently.
- Found-concern, tier, parts, and hold drafts remain existing secondary tools. Expanding those workflows belongs to Chunk 6.
- Keep the current routes thin, the existing mounted Work/Today surfaces, one-active-tool arbitration, and source-first migration ledger.
- Add no new page, provider, dependency, permission, quote/pricing behavior, photo workflow, payroll meaning, management reporting, diagnostic activation, or production repair-order mutation.
- Migration `0049a_shop_os_job_timer_preference.sql` must be additive, non-destructive, independently selectable, and default off. It must not baseline, skip, fake, reorder, edit, or apply migrations `0050` or `0051`.
- Production `apply --through 0049a` must refuse before any write unless the selected pending set is exactly `0049a`. An already-recorded `0049a` may return a safe no-op; any unexpected earlier pending file is a refusal.
- Before every commit, repo-local `git config user.name` and `git config user.email` must resolve. Use `Co-authored-by` before `Signed-off-by` with those exact values.
- Database-heavy Vitest uses at most two workers. The complete suite runs only with `node scripts/test-shards.mjs`. Stop after the same technical approach fails twice.

---

### Task 1: Independently targeted timer-preference migration

**Owner:** Inline implementation lane

**Files:**
- Create: `drizzle/migrations/0049a_shop_os_job_timer_preference.sql`
- Modify: `scripts/db-migrate.mjs`
- Modify: `lib/db/schema.ts`
- Modify: `tests/helpers/db.ts`
- Modify: `tests/unit/db-migrate.test.ts`
- Create: `tests/unit/shop-os-job-timer-preference-schema.test.ts`
- Modify only for exact migration-order assertions: `tests/unit/migration-replay.test.ts`

**Interfaces:**

```js
export function selectApplyMigrations({ files, pending, through, production })
```

The helper returns the selected pending files or throws before database writes. `commandApply(url, through, production)` must run drift/missing/refusal checks first, call this helper, then create the ledger/apply only the returned selection.

```ts
jobTimerEnabled: boolean('job_timer_enabled').default(false).notNull()
```

- [ ] **Step 1: Write RED migration-selection tests**

Add tests proving:

1. `0049a` is a valid sortable filename between `0049` and `0050`.
2. `--through 0049a` resolves exactly one file; missing or ambiguous prefixes refuse.
3. Production with `0049` recorded selects only `0049a` and leaves `0050`/`0051` pending.
4. Production refuses if any unexpected earlier migration is also pending.
5. Production returns a no-op if exact `0049a` is already recorded.
6. Non-production `apply` without `--through` retains the existing all-pending behavior.
7. Drift and missing-file checks still run before selection.

- [ ] **Step 2: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/db-migrate.test.ts --maxWorkers=1
```

Expected: imports and targeted-cutoff assertions fail because `apply` currently ignores `--through`.

- [ ] **Step 3: Implement the pure selector and wire it into apply**

Resolve a cutoff by exact unique prefix, then select pending files through that filename. For a production cutoff, enforce this invariant before `CREATE_LEDGER_SQL` or any migration statement:

```js
if (production && through && selected.some((file) => file.name !== target.name)) {
  throw new Error(`Production cutoff ${through} would apply unexpected migrations`)
}
```

Do not weaken the no-ledger safeguard, checksum drift refusal, missing-file refusal, per-file transaction, redaction, or filename ordering.

- [ ] **Step 4: Write the additive migration and schema projection**

The complete migration is one additive statement:

```sql
alter table profiles
  add column if not exists job_timer_enabled boolean not null default false;
```

Add the matching Drizzle field. In `tests/helpers/db.ts`, add a narrowly named `ensureJobTimerPreferenceMigration(client)` after the customer-copy prerequisite and before paused `0050`/`0051` helpers. It must inspect the exact column contract, apply only this file when absent, and verify boolean/not-null/default-false afterward.

- [ ] **Step 5: Write schema/replay tests**

Prove clean apply, default false for existing/new profiles, exact replay safety, non-null enforcement, filename placement, and that applying the helper does not create the `0050` customer-copy or `0051` correction objects.

- [ ] **Step 6: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/db-migrate.test.ts tests/unit/shop-os-job-timer-preference-schema.test.ts tests/unit/migration-replay.test.ts --maxWorkers=1
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add drizzle/migrations/0049a_shop_os_job_timer_preference.sql scripts/db-migrate.mjs lib/db/schema.ts tests/helpers/db.ts tests/unit/db-migrate.test.ts tests/unit/shop-os-job-timer-preference-schema.test.ts tests/unit/migration-replay.test.ts
git commit -m "feat: add optional job timer preference" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: targeted-selection, schema, replay, TypeScript, and diff checks pass. No live database is contacted.

---

### Task 2: One tenant-safe preference domain and two thin routes

**Owner:** Inline implementation lane

**Files:**
- Create: `lib/shop-os/job-timer-preference.ts`
- Create: `app/api/account/job-timer/route.ts`
- Create: `app/api/team/job-timer/route.ts`
- Create: `tests/unit/shop-os-job-timer-preference.test.ts`
- Create: `tests/unit/account-job-timer-route.test.ts`
- Create: `tests/unit/team-job-timer-route.test.ts`

**Interfaces:**

```ts
export type JobTimerPreferenceActor = {
  profileId: string
  shopId: string | null
  role: string
  membershipStatus: string
  isFounder: boolean
}

export type JobTimerPreferenceResult =
  | { ok: true; preference: { profileId: string; enabled: boolean } }
  | { ok: false; error: 'invalid_input' | 'forbidden' | 'no_shop' | 'not_found' | 'membership_pending' }

export function isWrenchingSkillTier(value: unknown): value is 1 | 2 | 3
export async function getJobTimerPreference(db: AppDb, input: {
  actor: JobTimerPreferenceActor
  targetProfileId?: string
}): Promise<JobTimerPreferenceResult>
export async function updateJobTimerPreference(db: AppDb, input: {
  actor: JobTimerPreferenceActor
  targetProfileId?: string
  enabled: boolean
}): Promise<JobTimerPreferenceResult>
```

- [ ] **Step 1: Write RED domain authorization tests**

Prove active wrenching people may read/change only themselves; owner/founder team managers may read/change an active same-shop wrenching person; office-only, pending, deactivated, missing, and cross-shop targets fail closed; a role title never makes a tierless person eligible; returned truth contains only profile ID and enabled state.

- [ ] **Step 2: Write RED route-envelope tests**

Self route:

```text
GET  /api/account/job-timer
POST /api/account/job-timer { enabled: boolean }
```

Team route:

```text
GET  /api/team/job-timer?profileId=<uuid>
POST /api/team/job-timer { profileId: <uuid>, enabled: boolean }
```

Prove authentication/paywall precede domain work, bodies are strict, all responses use `Cache-Control: no-store`, same-shop authority is preserved, invalid/domain failures map to bounded status codes, and no profile PII or broader settings escape.

- [ ] **Step 3: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-job-timer-preference.test.ts tests/unit/account-job-timer-route.test.ts tests/unit/team-job-timer-route.test.ts --maxWorkers=1
```

Expected: new modules and routes are absent.

- [ ] **Step 4: Implement one shared domain helper**

Use the existing persisted-profile, active-membership, founder, and team-management conventions. Select the target by both profile ID and shop ID. Perform updates with the same tenant and active wrenching predicates used for reads, then return the saved projection from the update. Never trust role/skill values from the browser.

- [ ] **Step 5: Implement thin no-store routes**

Routes parse UUID/boolean input, construct the current actor from trusted auth context, call the domain helper, and map its bounded result. Do not duplicate authorization or write raw Drizzle queries in routes.

- [ ] **Step 6: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-job-timer-preference.test.ts tests/unit/account-job-timer-route.test.ts tests/unit/team-job-timer-route.test.ts --maxWorkers=1
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/shop-os/job-timer-preference.ts app/api/account/job-timer/route.ts app/api/team/job-timer/route.ts tests/unit/shop-os-job-timer-preference.test.ts tests/unit/account-job-timer-route.test.ts tests/unit/team-job-timer-route.test.ts
git commit -m "feat: manage personal job timing safely" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: domain, route, TypeScript, and diff checks pass.

---

### Task 3: Calm personal and owner timer controls

**Owner:** Inline implementation lane

**Files:**
- Modify: `app/(app)/settings/account/page.tsx`
- Modify: `components/vt/account-section.tsx`
- Modify: `app/(app)/settings/team/page.tsx`
- Modify: `components/vt/team-section.tsx`
- Create: `tests/unit/account-section.test.tsx`
- Modify: `tests/unit/team-section.test.tsx`

**Interfaces and copy:**

```ts
type TimerPreferenceProps = {
  canTrackJobTime: boolean
  initialJobTimerEnabled: boolean
}
```

```text
Track time on my jobs
Personal job-time reference. Not payroll or performance tracking.
```

- [ ] **Step 1: Write RED My Account tests**

Prove the control appears only for a persisted wrenching tier; default-off truth is visible; changing the checkbox is local until deliberate Save; a successful POST settles to returned server truth; timeout, invalid envelope, 409, or 5xx triggers exact GET reconciliation; the UI never says saved until the server confirms; office-only users see no timer control.

- [ ] **Step 2: Write RED Team tests**

Prove an owner sees a row-level timer control only for eligible people; owner-techs are included; advisors/parts/office-only people are excluded; no role-wide switch exists; an unsaved role/tier edit disables the timer preference with a specific save-first explanation; successful/ambiguous writes settle to exact returned/GET truth without disturbing role or tier edits.

- [ ] **Step 3: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/account-section.test.tsx tests/unit/team-section.test.tsx --maxWorkers=1
```

Expected: preference props and controls are absent.

- [ ] **Step 4: Pass server truth from both pages**

Select `skillTier` and `jobTimerEnabled` from the trusted profile in My Account. Include `jobTimerEnabled` in the bounded Team member projection. Derive wrenching eligibility from the persisted tier only.

- [ ] **Step 5: Implement deliberate controls and truthful recovery**

Use one small preference block, no dashboard card. POST only after Save. On an ambiguous response, GET the exact current preference and set both displayed and baseline values from that response. Keep a running timer concern out of these settings surfaces; Work is responsible for showing an already-running clock after the preference changes.

- [ ] **Step 6: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/account-section.test.tsx tests/unit/team-section.test.tsx --maxWorkers=1
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add app/'(app)'/settings/account/page.tsx components/vt/account-section.tsx app/'(app)'/settings/team/page.tsx components/vt/team-section.tsx tests/unit/account-section.test.tsx tests/unit/team-section.test.tsx
git commit -m "feat: expose optional job timing controls" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: account/team behavior, TypeScript, and diff checks pass.

---

### Task 4: Independent start, optional clock, atomic completion

**Owner:** Inline implementation lane

**Files:**
- Modify: `lib/shop-os/simple-work.ts`
- Modify only if the bounded envelope requires it: `app/api/tickets/[id]/jobs/[jobId]/work/route.ts`
- Modify: `lib/shop-os/simple-work-ui.ts`
- Modify: `tests/unit/shop-os-simple-work.test.ts`
- Modify: `tests/unit/shop-os-simple-work-routes.test.ts`
- Modify: `tests/unit/shop-os-simple-work-ui.test.ts`

**Mutation body:**

```ts
const simpleWorkActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start_work'), expectedUpdatedAt: z.string().datetime() }),
  z.strictObject({ action: z.literal('clock_on') }),
  z.strictObject({ action: z.literal('clock_off') }),
  z.strictObject({
    action: z.literal('complete'),
    expectedUpdatedAt: z.string().datetime(),
    completion: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('as_approved') }),
      z.strictObject({ kind: z.literal('with_detail'), detail: z.string().trim().min(1).max(2000) }),
    ]),
  }),
])
```

Add `timerEnabled: boolean` to the strict work projection. It means current effective eligibility and preference, not whether a timer is running.

- [ ] **Step 1: Write RED start-work tests**

Prove approved assigned open work starts with preference off and leaves `clockedOnSince` null; effective preference on starts work and clock in the same transaction; non-wrenching/pending/deactivated actors never get a timer from a stored true value; stale approval/assignment/updatedAt fails with zero mutation; retry after success is idempotent and never starts a timer later.

- [ ] **Step 2: Write RED clock tests**

Prove `clock_on` no longer starts open work; it only resumes already-in-progress work with current effective preference; `clock_off` banks an existing interval even after the preference or tier is disabled; off/on retries are idempotent; active-seconds math and multiple-job policy remain unchanged.

- [ ] **Step 3: Write RED completion tests**

Prove `as_approved` completes with no text and stores canonical detail only when no prior value exists; a legacy saved detail is preserved; `with_detail` validates and writes 1–2000 normalized characters; detail, done status, completion timestamp, and timer banking happen in one update; concurrent/stale state writes nothing; a repeated completed request returns unchanged exact receipt.

- [ ] **Step 4: Write RED parser/route tests**

Prove strict bodies accept the three new intents, reject legacy `save_note`, reject missing/extra/malformed completion fields, keep responses no-store, return only the bounded projection, and preserve GET/read authorization.

- [ ] **Step 5: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-routes.test.ts tests/unit/shop-os-simple-work-ui.test.ts --maxWorkers=1
```

Expected: `start_work`, explicit completion intent, timer preference projection, and route/parser assertions fail.

- [ ] **Step 6: Implement locked actor and safe projection changes**

Extend the persisted locked actor selection with `skillTier` and `jobTimerEnabled`. Derive effective timer state only as:

```ts
const timerEnabled = actor.jobTimerEnabled === true
  && (actor.skillTier === 1 || actor.skillTier === 2 || actor.skillTier === 3)
```

Include it in every success read/mutation projection. Do not leak the raw preference or skill tier.

- [ ] **Step 7: Implement the state machine**

Keep lock order unchanged. `start_work` performs the only `open` → `in_progress` transition. `clock_on` requires `in_progress` and effective timer state. `clock_off` keys off persisted `clockedOnSince`, not current preference. Completion uses the explicit intent and one compare-and-swap update to save optional detail, bank running time, stop clock, mark done, and stamp completion.

- [ ] **Step 8: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-routes.test.ts tests/unit/shop-os-simple-work-ui.test.ts --maxWorkers=1
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/shop-os/simple-work.ts app/api/tickets/'[id]'/jobs/'[jobId]'/work/route.ts lib/shop-os/simple-work-ui.ts tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-routes.test.ts tests/unit/shop-os-simple-work-ui.test.ts
git commit -m "feat: make technician work independent" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: domain, parser, route, TypeScript, and diff checks pass.

---

### Task 5: Lossless Work Rail and v2 detail draft

**Owner:** Inline implementation lane

**Files:**
- Modify: `components/screens/simple-work-workspace.tsx`
- Modify: `components/screens/simple-work-workspace.module.css`
- Modify: `lib/shop-os/simple-work-draft.ts`
- Modify: `tests/unit/shop-os-simple-work-workspace.test.tsx`
- Modify: `tests/unit/shop-os-simple-work-draft.test.ts`

**v2 draft contract:**

```ts
type SimpleWorkDraftScopeV2 = {
  actorProfileId: string
  ticketId: string
  jobId: string
  workStatus: 'open' | 'in_progress'
  authorization: 'approved'
  savedDetailBaseline: string
}

type SimpleWorkDraftValuesV2 = {
  detail: string
  detailOpen: boolean
  concern: string
  tier: string
  parts: ExistingPartsDraft
  hold: ExistingHoldDraft
}
```

- [ ] **Step 1: Write RED copy and action-hierarchy tests**

Prove approved open work presents one dominant `Start work`; in-progress clean work presents one dominant `Complete as approved` and secondary `Add detail`; opening detail shows `Anything worth recording? (optional)` and changes the dominant action to `Complete with detail` only when nonempty; user-visible content contains no standalone `note`, `notes`, `work note`, or Save-note control.

- [ ] **Step 2: Write RED timer-visibility tests**

Prove timer controls are absent when disabled and stopped; appear as secondary controls when enabled; remain visible/stoppable when a timer is running after preference turns off; Start work never looks like a timer command; a running clock is distinct from payroll copy.

- [ ] **Step 3: Write RED v2/legacy draft tests**

Prove v2 keys include the bounded scope; exact compatible v1 draft decodes and migrates into v2; corrupt/wrong actor/job/authorization drafts fail closed; clock-only server changes do not invalidate a dirty detail; a changed saved-detail baseline yields both local and server values as a conflict instead of returning null; auxiliary drafts remain intact.

- [ ] **Step 4: Write RED ambiguous-response and conflict tests**

For timeout, invalid envelope, 409, or 5xx, prove the client GETs current work and classifies exact intent truth:

```ts
start_work -> workStatus === 'in_progress'
clock_on   -> clockedOnSince !== null
clock_off  -> clockedOnSince === null
complete   -> workStatus === 'done'
with_detail completion -> done && workNotes === submitted normalized detail
```

If exact truth cannot be proven, show `Couldn't confirm what happened` and retain every draft. Show `Your detail` and `Saved elsewhere` with deliberate `Use my detail` / `Use saved detail` choices when the baseline changed.

- [ ] **Step 5: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-simple-work-draft.test.ts --maxWorkers=1
```

Expected: new action hierarchy, copy, draft version, conflict, and recovery assertions fail.

- [ ] **Step 6: Implement v2 draft with exact v1 migration**

Read v2 first. If absent, derive the exact existing v1 key, validate actor/ticket/job/authorization compatibility, map `note` to `detail`, store v2, then remove only that exact legacy key. Return a discriminated decode result for `clean`, `recovered`, `conflict`, or `invalid`; never discard a valid local value because `updatedAt` changed for a clock action.

- [ ] **Step 7: Implement the Work Rail state and recovery**

Rename local/UI concepts from note to detail while translating only at the server projection boundary. Keep detail state separate from general workspace replacement so `applyWork` never clobbers dirty local text on clock responses. Use one mutation runner that POSTs, validates the strict envelope, and GET-reconciles ambiguous outcomes. Clear detail only after exact server-confirmed completion.

- [ ] **Step 8: Implement calm visual hierarchy**

Reuse existing primitives and CSS variables. The Work Rail has one dominant button at a time; Add detail and timer controls are secondary. Preserve 44×44px targets, visible focus, readable receipt, reduced motion, and small-screen containment. Do not add generic cards or dashboard chrome.

- [ ] **Step 9: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-simple-work-draft.test.ts --maxWorkers=1
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add components/screens/simple-work-workspace.tsx components/screens/simple-work-workspace.module.css lib/shop-os/simple-work-draft.ts tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-simple-work-draft.test.ts
git commit -m "feat: finish approved work without paperwork" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: workspace, draft, TypeScript, and diff checks pass.

---

### Task 6: Settle completed work in Today without hiding the receipt

**Owner:** Inline implementation lane

**Files:**
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `tests/unit/shop-os-today-jobs-board.test.tsx`

- [ ] **Step 1: Write RED mounted-settlement tests**

Prove a server-confirmed done projection immediately changes the row to `Complete`, removes mutation commands, retains the completed Work receipt mounted, announces completion once, and does not require a route/page refresh. Closing the receipt then removes the job from local My Work, focuses the board, and refreshes server truth. Repeated done projections and close taps are idempotent.

- [ ] **Step 2: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-today-jobs-board.test.tsx --maxWorkers=1
```

Expected: Today currently leaves the row active until workspace close and refresh.

- [ ] **Step 3: Implement a bounded completion override**

Maintain a local `Set<string>` of server-confirmed completed job IDs. `applyWorkProjection` adds a done job without closing its workspace. Pass completion truth into row/section projection so the row settles in place. When the user closes a completed receipt, remove that job from each bounded local Today group and completion set, close/focus, then refresh. Do not widen the persisted active Today status type.

- [ ] **Step 4: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-simple-work-workspace.test.tsx --maxWorkers=1
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add components/screens/today-jobs-board.tsx tests/unit/shop-os-today-jobs-board.test.tsx
git commit -m "feat: settle completed work in today" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: mounted receipt/Today settlement, TypeScript, and diff checks pass.

---

### Task 7: Real phone/desktop Work Rail proof

**Owner:** Inline implementation lane

**Files:**
- Modify: `tests/e2e/technician-handoff-harness/app/page.tsx`
- Modify: `tests/e2e/technician-handoff-harness/app/harness-client.tsx`
- Modify only as required by the changed component contract: `tests/e2e/technician-handoff-harness/app/api/tickets/[id]/jobs/[jobId]/work/route.ts`
- Modify: `tests/e2e/technician-handoff-proof.spec.ts`
- Create: `docs/strategy/SHOP_OS_TECHNICIAN_WORK_CORE_TEST_REPORT.md`

- [ ] **Step 1: Expand the hermetic harness**

Exercise real Today and Work components with deterministic in-process route state. Cover timer-off Start/Complete, optional detail atomic completion, timer-on start/pause/resume, running timer after preference off, detail survival across clock response/reload, ambiguous response reconciliation, concurrent detail conflict, completion receipt, and in-place Today settlement. Keep all network inside the harness origin.

- [ ] **Step 2: Prove phone and desktop journeys**

Run at 390×844 and 1440×900. For each viewport prove the primary journeys, 44×44px targets, visible focus, no horizontal overflow, no serious Axe finding, no uncaught browser error, no failed request, and no outside-origin network.

```bash
node scripts/run-technician-handoff-proof.mjs
```

Expected: every named Work Rail journey passes and screenshots are retained under the existing proof-output convention.

- [ ] **Step 3: Write the evidence report**

Record exact HEAD, commands, viewport/journey matrix, screenshots, accessibility/network/browser-fault results, and honest skipped items. State explicitly that no production database, migration apply, merge, deployment, or repair-order data was touched.

- [ ] **Step 4: Commit browser proof**

```bash
git diff --check
git config user.name
git config user.email
git add tests/e2e/technician-handoff-harness tests/e2e/technician-handoff-proof.spec.ts docs/strategy/SHOP_OS_TECHNICIAN_WORK_CORE_TEST_REPORT.md
git commit -m "test: prove technician work rail journeys" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: proof artifacts match the exact committed component state.

---

### Task 8: Converge, verify, push, and open the review gate

**Owner:** Atlas control lane

**Files:**
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify only if acceptance evidence changes: `docs/strategy/SHOP_OS_TECHNICIAN_WORK_CORE_TEST_REPORT.md`
- Modify when a non-obvious correction occurs: `tasks/lessons.md`

- [ ] **Step 1: Run focused static, security, and runtime review**

Review the integrated diff from a clean frame for tenant/authz gaps, migration cutoff bypasses, atomicity, stale/ambiguous recovery, hidden running clocks, customer-copy leakage, draft loss, user-facing `note` language, accidental `0050`/`0051` activation, debug code, unrelated changes, and rollback feasibility. Consolidate all blocking findings into one repair wave, then do one focused re-review.

- [ ] **Step 2: Run focused regression packs**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/db-migrate.test.ts tests/unit/shop-os-job-timer-preference-schema.test.ts tests/unit/migration-replay.test.ts tests/unit/shop-os-job-timer-preference.test.ts tests/unit/account-job-timer-route.test.ts tests/unit/team-job-timer-route.test.ts tests/unit/account-section.test.tsx tests/unit/team-section.test.tsx tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-routes.test.ts tests/unit/shop-os-simple-work-ui.test.ts tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-simple-work-draft.test.ts tests/unit/shop-os-today-jobs-board.test.tsx --maxWorkers=2
```

- [ ] **Step 3: Run the complete repository gate once after repair**

```bash
node scripts/test-shards.mjs
node_modules/.bin/tsc --noEmit --pretty false
pnpm build
node scripts/run-technician-handoff-proof.mjs
git diff --check
git status --short
git rev-parse HEAD
```

Attribute every result to the exact `git rev-parse HEAD` observed in the same shell. Any newly generated evidence change must be committed and the affected proof rerun at the new HEAD.

- [ ] **Step 4: Update the durable driver and commit**

Record outcome, current slice, exact last proof, next safe move, open owner gates, and rollback. Ensure no production action is described as complete.

```bash
git config user.name
git config user.email
git add docs/strategy/SHOP_OS_DRIVER_STATE.md docs/strategy/SHOP_OS_TECHNICIAN_WORK_CORE_TEST_REPORT.md
git add -f tasks/lessons.md
git commit -m "docs: preserve technician work release proof" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
git log -1 --format=fuller
```

- [ ] **Step 5: Push the exact branch and open a channel-linked PR**

Push only after the complete gate is green. Open the PR through Buzz with channel `95938fc9-02c1-4c1a-8b20-84f540bc6c74`; if the channel still has no registered Buzz repository announcement, use GitHub as the proven fallback and put the Buzz channel, design approval event, written approval event, migration boundary, verification report, and rollback in the PR body.

- [ ] **Step 6: Stop at the owner gate**

Do not apply `0049a`, merge, or deploy. Present one plain approval request covering:

- exact PR/head
- every test and hosted check conclusion
- `0049a` targeted-apply command and pre-write refusal proof
- proof that `0050` and `0051` remain pending
- production smoke/log plan
- source rollback and schema rollback boundary

Expected final source state: reviewable PR, exact green proof, no production database change, and one explicit owner decision remaining.

## Rollback and Stop Conditions

- Source rollback before merge: close the PR and retain the branch/proof.
- Source rollback after a separately approved merge: revert the merge commit.
- The default-off column is additive. Do not drop it automatically in production; a schema rollback requires a separately reviewed/approved migration because dropping could destroy a person's preference.
- Stop immediately if the targeted runner would select any migration other than `0049a`, if `0050`/`0051` is no longer pending, if a customer-facing path gains internal detail, if a timer can run invisibly, if tenant authorization is ambiguous, or if the same technical approach fails twice.
- A fresh blocking defect after the one focused re-review triggers an architecture stop and one re-plan, not an open-ended repair loop.
