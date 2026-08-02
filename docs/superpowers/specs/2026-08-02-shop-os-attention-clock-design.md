# Shop OS Attention Clock Design

**Status:** Approved for implementation on 2026-08-02 by Vyntechs in the Buzz command thread.

## Intent

- **Project:** Shop OS
- **Plain-language outcome:** Today and the shop-floor wall make a vehicle quiet for three days visibly different from one whose work changed 42 minutes ago.
- **Why now:** A full-shop production audit found that old work and new work currently look identical, while the shop deliberately avoids invented due dates.
- **Done when:** Every active Today job and every vehicle on the Floor carry a truthful, automatically aging `Quiet <age>` signal sourced from real job changes.
- **Hard no:** No due dates, promises, appointments, messaging claim, reminder, automation, new route, permission change, migration, dependency, or diagnostic/media entrance.

## Product vision

The clock is an attention signal, not a deadline. It answers one question: **how long has this work been quiet?** It must help a technician or advisor notice forgotten work without pretending the software knows when a vehicle was promised or when the customer last heard from the shop.

The embarrassing failure is a confident but false clock. A ticket-created clock would call actively moving work stale. A customer-contact clock would claim delivery truth that the product does not yet possess. This slice therefore names and displays only the truth already recorded: the latest change to the job.

## Capability packet

- **Name:** Missing attention clock
- **User/business outcome:** Old work becomes visible before it silently disappears into the board.
- **Included:** Read-only last-job-change projection; relative age; stronger 24-hour treatment; automatic on-screen aging; Today job cards; one vehicle-level Floor signal; finished-open vehicles on Floor.
- **Excluded:** Customer-contact clock, outbound messaging, notifications, due dates, scheduling, reminders, sorting, automation, schema changes, new pages.
- **Source truth:** `ticket_jobs.updated_at`; for a vehicle with several jobs, the newest job timestamp; for a finished-open repair order, the newest terminal-job timestamp.
- **Dependencies:** Existing `listTodayTicketJobs`, strict Today feed parser, Today quiet refresh, Floor vehicle projection.
- **Risk gates:** Stop if the timestamp cannot be shown as “last job change” without overclaiming; stop before production merge or deploy.
- **Done when:** The approved visual behavior passes focused, full-suite, type, build, accessibility, phone, desktop, and wall-layout proof.

## Chosen design

### Copy and time math

One shared pure formatter returns:

| Elapsed silence | Label | Visual tier |
| --- | --- | --- |
| less than 1 minute or a future-skewed timestamp | `Quiet now` | normal |
| 1–59 minutes | `Quiet 42m` | normal |
| 1–23 hours | `Quiet 7h` | normal |
| 24 hours or more | `Quiet 3d` | stale |

Units are floored, never rounded up. The label describes elapsed silence, not urgency. The stale tier uses the existing amber system and stronger weight; it does not use emergency red, add an alert icon, or claim a missed promise.

### Today

Each active job row receives one compact clock in the existing facts line. Recent work stays visually subordinate. At 24 hours the label earns the strongest fact-level emphasis. The row order and all existing actions remain unchanged.

### Floor

Each vehicle row receives one clock beneath its existing right-hand state. When a repair order contains several active jobs, the newest job change wins because any real movement means the vehicle as a whole is not quiet. A finished-open repair order uses its newest terminal-job change, so `Ready` vehicles also have an honest clock.

The clock must remain legible at wall distance without widening the row or reducing the current vehicle type. Overflow tails continue to summarize unseated vehicles; they do not invent an aggregate age.

## State flow

```text
real shop action
      |
      v
ticket_jobs.updated_at
      |
      +--> authorized Today feed --> Today job clock
      |
      +--> newest timestamp per repair order --> Floor vehicle clock

browser minute tick --> recompute label/tier only
20-second board poll --> replace timestamp only with valid server truth
```

## Data and security

- Add an ISO `attentionAt` field to the already authorized job projection.
- Add the latest terminal-job ISO `attentionAt` to ready-to-collect cards for Floor aggregation.
- Validate both fields in the strict client parser before replacing mounted state.
- Do not expose actors, notes, event payloads, contact details, money, or new identifiers.
- Do not add a database column or query a new tenant surface.

## Error and empty states

- A malformed timestamp makes the full refreshed payload invalid, preserving the last true mounted board.
- A future-skewed but valid server timestamp displays `Quiet now` rather than a negative age.
- The initial server/client hydration renders no relative label until the client clock starts, preventing time-dependent hydration mismatch.
- Existing empty-board behavior remains unchanged.

## Acceptance tests

1. `42 minutes` renders `Quiet 42m`; `3 days` renders `Quiet 3d` with stale emphasis.
2. Future timestamps render `Quiet now`; invalid timestamps never enter mounted state.
3. Today projects the exact job `updated_at` and displays it without changing row order or actions.
4. Floor collapses multiple jobs to the newest timestamp and includes finished-open vehicles.
5. One client timer per board updates labels without requiring a reload.
6. The 20-second server refresh still fails safe on malformed or failed responses.
7. Phone Today, desktop Today, and the wall board have no horizontal overflow, serious/critical accessibility findings, or browser faults.
8. Full tests, TypeScript, production build, changed-path review, and protected PR checks pass.

## Rollback

The slice is additive and read-only. Reverting the feature commit removes the projection fields, formatter, and visual labels. No data rollback exists because no data or schema changes occur.

