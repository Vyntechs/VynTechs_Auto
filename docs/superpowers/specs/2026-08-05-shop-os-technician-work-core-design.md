# Shop OS Technician Work Core Design

**Date:** 2026-08-05
**Baseline:** production merge `0be601555aaf964255bbed64b07027a8ccb817d6`
**Direction approval:** Buzz event `74bfb55967e73f88da82b341d5404bd8bc29259750a23795c57b61fa3078c3b0`

## Executive result

Technicians get one short, truthful path from approved work to completion:

```text
Start work
  → do the approved job
  → Complete as approved
     or Add details and complete
  → server-confirmed receipt
  → Today settles the job to Complete in place
```

The timer stops defining the workflow. It becomes an optional personal tool for people who wrench. A technician can finish the job without starting a timer or typing a note.

The preference is stored per person, defaults off, is available to wrenching-eligible people in My Account, and can also be managed for that person by an owner in Team. When enabled before work starts, **Start work** also starts the job timer. The timer remains job-time for personal reference, not payroll or performance measurement.

## Intent normalization

### Desired outcome

A technician can:

- start the approved job without being forced to track time;
- complete routine work without retyping the approved scope;
- add a useful internal detail when something is worth recording;
- pause or resume optional personal time tracking without losing typed work;
- recover honestly from stale data, a lost response, or a second screen changing the job;
- see server-confirmed completion settle Today without closing and reopening the workspace.

### Explicit requirements

- The clock is an optional tool, not a required work state.
- Timer control is per person rather than per role.
- A wrenching-eligible person can manage their own timer preference.
- An owner can manage the preference for that person under Team.
- Office-only owners, advisors, and other non-wrenching people do not see the preference.
- Routine completion reuses the approved work instead of requiring a note.
- Extra work details are optional and internal.
- No typed detail may disappear because the clock changes, the page reloads, or the server response is ambiguous.
- Today visibly settles completed work without a page jump.

### Inferred requirements

- `Start work` and `Clock on` must become separate domain meanings even when one tap performs both for a person whose preference is enabled.
- The server, not a client-supplied boolean, must decide whether the person's enabled preference starts the timer.
- Completion with optional details must be one atomic server action; there can be no saved-note/unfinished-job partial success.
- `Complete as approved` must create durable completion truth even when no custom detail exists.
- Turning the preference off while a timer is already running cannot create invisible time.
- A lost response must refresh server truth before the interface claims success or failure.
- The two paused migrations must stay unapplied while the new preference is introduced.

### Constraints and non-goals

- No payroll meaning, timecard approval, utilization scoring, performance reporting, manager dashboard, or labor billing changes.
- No new page, provider, dependency, customer message, price control, media flow, or diagnostic entrance.
- No expansion of parts requests, found work, holds, or handoffs; those remain Chunk 6.
- No rewrite of the existing job-time ledger or multiple-running-job policy.
- No customer-visible use of internal completion details.
- No automatic inference that work is complete.
- No silent auto-save before completion.
- No application, activation, baselining, or ledger fabrication for migrations `0050` or `0051`.
- No production repair-order mutation for release proof.

### Effort and authority

- **Tier:** T2 cross-functional. This joins work state, optional timekeeping, profile settings, owner administration, migration order, draft recovery, completion, and mounted Today behavior.
- **Design authority:** A1.
- **Source authority after written approval:** A2 in an isolated branch through tests and independent review.
- **Migration, merge, and production deployment:** A3. Each remains an explicit owner gate immediately before execution.

## Current source truth

- Work currently begins as a side effect of the first `clock_on`. There is no independent `start_work` action (`lib/shop-os/simple-work.ts`).
- `clock_off` banks elapsed job time and leaves work in progress. The clock is job-time, not payroll or technician-attributed labor history.
- Completion currently refuses an empty saved `workNotes`, so the technician must type and separately save text before finishing.
- The mounted editor replaces its local note from the returned server projection after clock mutations. The local draft also binds to the workspace-wide `updatedAt`, so an ordinary clock write can invalidate typed text (`components/screens/simple-work-workspace.tsx`, `lib/shop-os/simple-work-draft.ts`).
- The Today projection omits done work. While the mounted workspace is open, a successful completion does not settle the parent card until that workspace is closed and the board refreshes (`components/screens/today-jobs-board.tsx`, `lib/shop-os/today-board.ts`).
- Profiles already carry tenant, role, and `skillTier`; Team already lets an owner edit an individual member. `skillTier` is the existing reliable signal that a person wrenches, including an owner-technician (`lib/db/schema.ts`, `lib/shop-os/capabilities.ts`, settings surfaces).
- There is no general cross-device user-preference store.
- `workNotes` are internal and explicitly excluded from Customer Copy (`tests/unit/shop-os-customer-copy.test.ts`).
- The production migration ledger is current through `0049`. Migrations `0050` and `0051` are intentionally unapplied and separately gated.
- The migration runner recognizes names shaped like `0049a_...`, sorts them by filename, already parses `--through`, and presently applies every pending file when `apply` is used (`scripts/db-migrate.mjs`).

## Approaches considered

### A. Core work plus an optional per-person timer — selected

Add an independent work-start action, atomic completion choices, per-person timer preference, draft-safe recovery, and in-place completion settling. Persist the preference in an additive profile field.

This matches the operator's real workflow and preserves timer usefulness without forcing it on anyone.

### B. Keep clocking mandatory but hide it visually — rejected

The domain would still claim that work cannot begin without time tracking. Hiding a mandatory rule does not make it optional and leaves completion coupled to the wrong state.

### C. Store the preference only in the browser — rejected

Phone and desktop would disagree, an owner could not manage it in Team, and clearing browser data would silently change behavior.

### D. Use one role-wide timer switch — rejected

Technicians within the same role want different behavior, and role title does not describe an owner-technician who still wrenches.

### E. Apply a normal `0052` migration — rejected

The current runner would also apply the pending `0050` and `0051` migrations. That violates their explicit gates and widens the blast radius of a small personal preference.

## Experience contract

### Work rail

```text
Approved and assigned
│
├── Start work
│   ├── time preference off → work starts; no timer
│   └── time preference on  → work and timer start together
│
├── In progress
│   ├── timer unavailable/off → no timer controls
│   ├── timer enabled/running → Track time · Running / Clock off
│   └── timer enabled/paused  → Track time · Paused / Clock on
│
└── Finish
    ├── Complete as approved
    └── Add details
        └── details + completion commit together
```

### Start work

1. The assigned technician reviews the exact approved scope.
2. They tap **Start work**.
3. The server revalidates active membership, tenant, assignment, ticket state, current pinned approval, and the person's stored timer preference.
4. The server changes the job from open to in progress and records `workStartedAt`.
5. If and only if the stored preference is enabled and the person remains wrenching-eligible, the same transaction also records `clockedOnSince`.
6. The returned projection says **Work in progress**. It says **Track time · Running** only when the persisted server response contains a running clock.

The client never decides whether the timer should start by posting `startTimer: true`.

### Complete as approved

The dominant finish action is **Complete as approved**. It means the technician deliberately confirms that the approved scope was performed without adding a custom internal detail.

- The confirmation is never inferred from time elapsed, parts, or screen state.
- The server stores a canonical internal completion statement, `Completed as approved.`
- If an older in-progress job already has a saved work note, **Complete as approved** preserves that note instead of replacing it with the canonical statement.
- The same transaction marks the job done, records completion time, banks any running timer, and returns the read-only receipt.
- No separate note save is required.

### Add details and complete

**Add details** reveals one bounded internal field labeled **Anything worth recording? (optional)**.

Examples include a result, exception, measurement, or useful handoff fact. It is not customer copy and is not required for ordinary work.

- Empty details collapse back to **Complete as approved**.
- Nonempty details normalize whitespace and allow 1–2,000 characters.
- While a nonempty detail draft exists, the dominant button reads **Complete with details**. Clearing the draft deliberately restores **Complete as approved**.
- One action stores the details and completes the job in the same transaction.
- The interface never reports “details saved” while completion failed.
- The completion confirmation names that details will be kept internally.

### Optional timer preference

- Label: **Track time on my jobs**.
- Helper: **Personal job-time reference. Not payroll or performance tracking.**
- Default: off.
- Eligible people: active tenant members with a wrenching `skillTier` under the existing capability rules.
- Self-service: My Account.
- Owner service: the existing Team member editor.
- Non-wrenching people neither see nor change the preference.
- A demotion below wrenching eligibility makes the preference ineffective even if the stored value remains true.
- Re-enabling eligibility does not restart time or retroactively count anything.

If the preference changes while work is already in progress:

- off → on: future **Start work** actions use it; the current job does not silently start a timer;
- on → off with no running timer: timer controls disappear after confirmed save;
- on → off with a running timer: the running clock remains visible with **Clock off** until stopped; no time can continue invisibly;
- an owner changing another person's preference follows the same rule.

### Mounted completion settle

After server-confirmed completion:

1. The work tool becomes a read-only completion receipt.
2. The parent Today row immediately settles to **Complete**.
3. The receipt stays mounted until the technician closes it; the parent update cannot destroy the receipt before paint.
4. Closing the receipt removes the completed job from My Work using the same returned server truth, without a route change or manual reload.
5. If Today refresh fails after completion, the receipt remains authoritative and offers **Refresh Today**; it never re-enables Complete.

### Phone and desktop

- The same work rail exists at 390×844 and 1440×900; only layout changes.
- Start work and the current dominant completion action are at least 44×44px.
- Timer controls remain visually secondary to work and completion.
- Optional details survive focus changes, timer controls, reloads, and constrained phone height.
- Long approved scope, detail, customer, vehicle, and receipt text wraps without horizontal overflow.
- Focus moves to the in-progress heading after Start work and to the completion receipt after completion.
- Reduced motion preserves ordering, wording, focus, and live announcements.

## Server and data contract

### 1. Separate work state from time state

Extend the strict work mutation union with `start_work`:

```ts
{
  action: 'start_work'
  expectedUpdatedAt: string
}
```

Inside the existing work transaction:

- lock and revalidate ticket before job;
- reauthorize the current actor after locks;
- require active same-shop assignment, open repair order, current approved pinned revision, and an open job;
- read the actor's current profile preference and wrenching eligibility;
- write `status = 'in_progress'` and `workStartedAt` once;
- set `clockedOnSince` in the same write only when the server-side preference is effective;
- return current truth without another write if the exact job is already in progress;
- refuse done, canceled, blocked, stale, reassigned, unapproved, or unsupported work with the existing privacy-safe envelope.

`clock_on` becomes a timer-only command. It requires an in-progress job and effective timer access. It no longer starts work.

`clock_off` remains the banking command. It is also permitted for a currently running timer after the preference or wrenching eligibility was turned off, so invisible time can always be stopped safely.

### 2. Make completion atomic

Replace the saved-note prerequisite with an explicit completion intent:

```ts
{
  action: 'complete'
  completion:
    | { kind: 'as_approved' }
    | { kind: 'with_details'; details: string }
  expectedUpdatedAt: string
}
```

The transaction:

1. performs the same ticket-first lock, current-actor reauthorization, tenant, assignment, and approval checks;
2. validates the explicit completion intent; the mounted client separately names and blocks completion while any local parts, found-work, or hold draft is unfinished because those drafts do not yet exist on the server;
3. derives normalized submitted details, preserves an existing saved note, or uses `Completed as approved.` when neither exists;
4. stores `workNotes`, sets done/completed timestamps, and banks/nulls any running timer in one write boundary;
5. appends the existing completion activity once;
6. returns the exact completion receipt and parent-row settle projection.

If the job is already done, replay returns its existing receipt and performs no second write. If the expected revision is stale, no completion field changes.

### 3. Preserve local detail independently of clock writes

The optional detail draft is scoped to the job and its saved-detail baseline, not the whole mutable work `updatedAt`.

- A clock or parent-row change cannot invalidate the draft.
- A local draft survives reload with its job, tenant, actor, and saved-detail baseline binding.
- If the saved detail changed elsewhere, recovery shows **Your draft** and **Saved elsewhere** together.
- The technician chooses **Use my draft** or **Use saved details**; neither version is silently erased.
- Completion clears the local draft only after the returned receipt proves that exact detail or the exact `as_approved` intent landed.
- Chunk 6 auxiliary drafts keep their existing bounded behavior and exact blockers.

### 4. Recover ambiguous responses from durable truth

For Start work, Clock on/off, preference save, and completion:

- deterministic 4xx refusal returns the exact safe recovery;
- timeout, disconnect, invalid envelope, and 5xx trigger one read-only refresh;
- if durable truth proves the intended state landed, show success;
- if durable truth disproves it, retain the draft and show the current next action;
- if truth still cannot be loaded, say **Couldn't confirm what happened** and keep all repeatable inputs;
- a retry is idempotent against the same server state and cannot duplicate completion or time.

### 5. Add one per-person profile field

Add to `profiles`:

```sql
job_timer_enabled boolean not null default false
```

The API projections expose the effective setting only to:

- the current eligible person in My Account;
- an authorized owner editing that tenant member in Team;
- the server work mutation that decides whether Start work also starts the timer.

The setting is not public, not customer data, not part of Customer Copy, and not a new role/capability grant.

### 6. Apply only the new independent migration

Name the additive migration:

```text
0049a_shop_os_job_timer_preference.sql
```

This deliberately sorts after already-applied `0049` and before separately gated `0050` and `0051`. No existing migration changes.

Extend `db-migrate.mjs apply` so its already-parsed `--through` cutoff is enforced:

```text
node scripts/db-migrate.mjs apply --production --through 0049a
```

Safety contract:

- the cutoff must resolve to exactly one migration prefix;
- drifted or missing applied files still refuse the entire command;
- only pending files at or before the resolved cutoff may be planned;
- with `--production --through`, the selected set must be exactly the one resolved cutoff file or the runner refuses before the first write;
- the command prints the exact selected file before the first write;
- each selected migration retains its own database transaction and checksum receipt;
- a post-apply status proves `0049a` applied while `0050` and `0051` remain pending;
- `--through` is optional for normal all-pending development use, but mandatory for this production release;
- no baseline, manual ledger row, fake checksum, skip marker, or direct SQL path is allowed.

The runner and migration require focused migration replay tests plus an adversarial test proving that a production-shaped ledger through `0049` applies `0049a` and does not execute or record `0050`/`0051`.

## Permissions and privacy

- Work reads and mutations remain tenant-scoped, paywall-safe, and assigned-actor only.
- Start work does not expand who can claim, assign, view, or complete work.
- Timer preference eligibility follows current wrenching skill truth; it does not grant work access.
- Self-service can mutate only the signed-in profile's timer preference.
- Team mutation requires current owner capability and same-tenant active membership.
- Server work logic rechecks effective eligibility; a crafted client cannot start a timer by submitting a hidden field.
- Work detail remains internal and excluded from Customer Copy, public links, advisor customer messaging, and logs.
- Mutation errors and observability never print detail text, profile data, credentials, raw SQL, or customer information.

## Failure and recovery matrix

| Failure | Required result |
|---|---|
| Work lost assignment before Start work | No write; mounted surface becomes unavailable with safe current owner when allowed |
| Approval changed before Start work | No write; show current authorization truth |
| Preference enabled from another screen before Start work | Server uses the newly persisted setting |
| Preference disabled from another screen before Start work | Work starts without a timer |
| Preference disabled while timer runs | Timer stays visible until Clock off succeeds |
| Clock mutation while details are typed | Draft remains byte-for-byte present after normalized decode |
| Saved details changed elsewhere | Show both versions and require a deliberate choice |
| Completion response is lost but commit landed | Refresh returns the receipt; no second activity or time bank |
| Completion response is lost and commit did not land | Draft and completion intent remain available |
| Today parent projection fails after completion | Receipt remains mounted and Complete stays disabled |
| Migration cutoff is absent | Production release procedure refuses before database mutation |
| Cutoff does not resolve exactly | Runner refuses before database mutation |
| Applied checksum drift or missing file exists | Runner refuses before database mutation |
| `0050` or `0051` appears in selected plan | Release stops; no migration runs |

## Acceptance tests

### Finish

1. An assigned approved technician with timer preference off taps Start work; work becomes in progress and no timer starts.
2. The technician completes routine work with **Complete as approved** without typing or separately saving a note.
3. A technician adds optional details and one action stores the details and completes the job atomically.
4. The completion receipt shows exact approved scope, completion time, optional internal detail when present, and banked job time when present.
5. Today settles the row to Complete immediately; the receipt remains mounted until closed, then the row leaves My Work without page navigation.

### Optional time tool

6. An eligible person enables **Track time on my jobs** in My Account; the next Start work begins both work and timer from server truth.
7. An owner changes the same setting for an eligible team member; that person's next Start work follows it.
8. A non-wrenching person cannot see or mutate the setting through either surface or a crafted request.
9. Clock off/on remains secondary, banks correctly, and never changes or clears optional completion details.
10. Turning the preference off during a running timer leaves that timer visible and stoppable until confirmed off.

### Correct

11. A clock write, reload, or stale parent-row update cannot erase typed details.
12. Concurrent saved-detail change displays local and remote versions without automatic overwrite.
13. An unfinished Chunk 6 draft names its exact completion blocker rather than mysteriously disabling Complete.
14. Repeating an already-landed completion returns the same receipt and creates no duplicate activity or time.

### Recover

15. Lost Start work, timer, preference, and completion responses refresh server truth before reporting an outcome.
16. Stale assignment, approval, actor, expected revision, or closed ticket writes nothing and returns the safe current path.
17. A completion that landed but whose parent Today refresh failed remains visibly complete and cannot be resubmitted.
18. Local draft data is cleared only after exact persisted completion truth is proven.

### Migration, privacy, and presentation

19. Clean replay and production-shaped replay both add the non-null default-off preference successfully.
20. Targeted apply through `0049a` records only `0049a`; `0050` and `0051` remain pending and unchanged.
21. Migration drift, missing history, ambiguous cutoff, or a production selected set other than exactly `0049a` refuses before any schema write.
22. Customer Copy and public/customer surfaces contain no timer preference or internal work detail.
23. Phone and desktop journeys pass with at least 44px dominant controls, correct focus, no horizontal overflow, no serious/critical accessibility finding, no unexpected browser fault, and no outside-network request.
24. Existing claim/start, work, Today, Team, My Account, Customer Copy, migration runner, full-suite, TypeScript, and production build gates remain green.

## Verification and review path

The implementation converges once:

1. write failing domain, migration-runner, settings, draft, mounted-work, Today, privacy, and browser acceptance tests;
2. implement the smallest source changes that satisfy this specification;
3. run focused tests while repairing;
4. run independent static, security/migration, and phone/desktop runtime review in parallel;
5. consolidate blocking findings into one repair wave;
6. run focused re-review;
7. run all test shards, TypeScript, production build, and the real-component browser proof once on the clean candidate;
8. open a linked PR and require every expected hosted check to finish successfully;
9. request explicit owner approval immediately before applying `0049a`, merging, and deploying;
10. apply only through `0049a`, prove `0050`/`0051` remain pending, deploy the exact tested revision, and verify production without creating or changing a live repair order.

Any new Critical or Important defect found after the focused re-review triggers an architecture stop rather than another open-ended repair loop.

## Rollback and release boundary

- Before migration: source-only rollback is branch deletion or revert.
- After `0049a`: source rollback reverts the release while the harmless default-off column remains. No destructive down migration is proposed.
- If deployment fails after the migration, keep the preference default off and revert the source release; existing work and timer rows remain unchanged.
- If the targeted migration plan includes `0050`, `0051`, or any unexpected file, stop before applying anything.
- If production proof would require changing a real repair order, stop and use the already-proven hermetic browser journey plus read-only production checks.

## Decision record

Accepted direction:

- Start work is the core job transition.
- Time tracking is an optional per-person wrenching tool, default off.
- Routine completion reuses the approved scope.
- Optional details commit atomically with completion.
- Today settles completed work in place while preserving the receipt.
- The independent preference migration uses the explicit `0049a`/`--through` safety path so paused migrations remain untouched.

Written-spec approval authorizes the test-first implementation plan and source build. It does **not** authorize applying a migration, merging, deploying, activating customer approval, activating ticket correction, or mutating production repair-order data.
