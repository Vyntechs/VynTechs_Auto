# Shop OS Row 22 — Repair Authorization and Honest Closeout Design

**Date:** 2026-07-11
**Status:** Approved by the active Shop OS plan for implementation
**Owner:** engine integration lane (`I`)
**Depends on:** rows 15 and 17

## Outcome

Ticket-backed diagnostic sessions may enter repair mutations and record a performed-repair outcome only while their exact immutable quote version remains approved. A declined diagnostic may close only through a distinct no-repair path that records that no repair occurred. Ticketless legacy sessions keep their current handler, route, and UI behavior.

This row is the authorization intercept already approved in §3.3 of the active plan. It adds no schema, quote mutation, AI prompt, topology behavior, external service, feature flag, or ticket-close workflow.

## Approaches considered

1. **Recommended — one shared server-owned authorization boundary.** Pages read a bounded projection; every repair mutation repeats the same validation inside a transaction. This prevents UI-only security and keeps quote races fail-closed.
2. **Guard only the close endpoint.** Smaller diff, but repair observations and AI repair guidance would still run before approval. Rejected because the plan says every repair mutation requires approval.
3. **Copy approval checks into each route.** Locally simple, but lock order and exact-version validation would drift. Rejected in favor of one domain contract.

## Authorization states

`resolveDiagnosticRepairAccess` returns only the facts the repair UI needs:

```ts
type DiagnosticRepairAccess =
  | { state: 'legacy' }
  | { state: 'approved'; ticketId: string; jobId: string; quoteVersionId: string }
  | { state: 'declined'; ticketId: string; jobId: string }
  | { state: 'awaiting_approval'; ticketId: string; jobId: string }
  | { state: 'unavailable' }
```

- `legacy`: no `ticket_jobs.session_id` link exists. Existing behavior is preserved.
- `approved`: the linked diagnostic job is active, its approval projection names an unsuperseded exact quote version, the validated snapshot contains that job, and an append-only approved event exists for that job/version.
- `declined`: the linked active diagnostic job has a declined projection and no approved version.
- `awaiting_approval`: a valid linked job exists but has not been approved or declined.
- `unavailable`: linkage, tenant, kind, status, version, snapshot, or event truth is corrupt or no longer actionable. Mutations fail closed.

The read projection is advisory for rendering. It never authorizes a mutation.

## Transaction and race contract

Ticket-backed mutations repeat authorization in one transaction using the quote domain's established order:

```text
ticket [NOWAIT]
  └── all ticket jobs by ID [NOWAIT]
      └── quote versions by ID [NOWAIT]
          └── target session [NOWAIT]
              └── current actor [NOWAIT]
```

The transaction rechecks same-shop linkage, diagnostic kind, active job/session state, owning active technician, approval projection, exact unsuperseded version, validated snapshot membership, and append-only decision event. A quote edit, supersession, reassignment, deactivation, duplicate close, or lock race returns a retryable conflict without a repair event, close event, outcome, or job-state write.

Legacy sessions use the existing path without Shop OS locks or new requirements.

## Mutation behavior

### Repair observations

- `legacy` and `approved` may append a repair observation and request guidance.
- `declined`, `awaiting_approval`, and `unavailable` return a bounded authorization failure before persisting the observation or calling the AI provider.
- Approval is checked in the same transaction that appends the observation. The external guidance call remains outside that transaction; the persisted observation is still retained if guidance later fails, matching existing behavior.

### Performed-repair close

- `legacy` keeps the existing close behavior.
- `approved` accepts the existing outcome form, atomically closes the session, appends the close event, and marks the linked diagnostic job `done`.
- Every other ticket-backed state rejects the normal outcome payload before specificity validation or downstream promotion/follow-up work.

### Declined/no-repair close

The dedicated request is intentionally small:

```ts
{ mode: 'declined_no_repair'; note?: string }
```

Only current `declined` state accepts it. The server constructs the honest stored outcome from server truth:

- root cause comes from the locked diagnosis;
- `actionType` is `no_fix`;
- all verification flags are false and `symptomsResolved` is `no`;
- `repairMinutes` is `0`;
- a typed `closeout: { kind: 'declined_no_repair' }` marker distinguishes it from “no fix needed”;
- optional note is bounded and is never interpreted as proof of work.

The transaction closes the session, appends a close event with the typed disposition, and marks the linked job `canceled`. It does not run specificity validation, corpus promotion, proof-of-fix recording, or any AI call. Existing non-mutating follow-up behavior is not expanded in this row.

## UI behavior

The diagnosis-lock summary remains visible in every ticket-backed state.

```text
Locked diagnosis
│
├── Approved exact version
│   ├── repair conversation + Ask AI
│   └── existing repair outcome form
├── Declined
│   └── “No repair authorized” + one confirmed close-without-repair action
├── Waiting for approval
│   └── “Quote approval required” + ticket/quote return link
└── Legacy ticketless session
    └── existing repair and close UI unchanged
```

The declined confirmation says exactly what will be recorded: customer declined, no repair performed, no verification claimed. It has a 44px minimum target, visible focus, busy lock, inline error announcement, and no celebratory repair language. The closed summary renders “No repair performed” instead of a Repair module when the typed closeout marker is present.

The outcome route refuses the standard repair form for ticket-backed pending, declined, corrupt, canceled, or superseded states. Direct URL entry therefore cannot bypass the repair screen.

## Security and privacy

- Actor, tenant, ownership, membership activity, job linkage, approval, version, snapshot, and event truth are server-owned.
- Client totals, job IDs, version IDs, approval states, actor IDs, and repair claims are ignored.
- Same-shop denial remains non-enumerating; actionable state conflicts use bounded codes without customer, vehicle, quote, or diagnosis content.
- No approval body, story, customer contact, VIN, raw quote snapshot, or outcome note enters logs.
- No production migration or credential is required.

## Acceptance proof

- Approved ticket-backed diagnostic repair observation and normal close succeed and mark the job done.
- Pending, declined, superseded, malformed-snapshot, missing-event, canceled-job, inactive-actor, cross-shop, reassigned, and lock-race paths persist no repair mutation.
- Declined closeout alone closes without repair, stores the typed disposition, claims no verification, and marks the job canceled.
- A declined request cannot smuggle part, repair, verification, time, actor, job, or quote facts.
- Direct outcome URL access cannot expose a performed-repair form without current approval.
- Ticketless legacy handler results and rendered controls remain unchanged.
- Focused tests, full suite, TypeScript, production build, clean diff, independent review, and signed browser proof pass before merge.

## Stop conditions

- The implementation requires a table or migration.
- Exact approval cannot be proved from the existing immutable version, projection, and event records.
- A repair mutation cannot share the established ticket-first lock order.
- Legacy ticketless behavior would need to change.
- Work expands into simple repair/maintenance jobs, attachments, delivery, ticket closure, messaging, or diagnostic semantics owned by later rows.
