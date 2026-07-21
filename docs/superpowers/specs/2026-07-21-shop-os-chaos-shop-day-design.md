# ShopOS Chaos Shop Day Design

**Status:** Approved under the active living-repair-order goal on 2026-07-21.

## Intent

- **Plain-language outcome:** A repair order remains the one durable place to recover real shop work when a technician is interrupted, a part is late, a customer changes direction, or the day has to be rearranged.
- **Done when:** Every permitted role can see the honest current state and take one obvious safe next action without leaving the mounted repair order, losing typed work, enabling diagnostics/media, or making the interface behave like a page reload.
- **Hard no:** No new operational page, diagnostic flow, media/storage, message/calendar integration, provider call, dependency, automatic reassignment, silent status change, optimistic server truth, or production customer-data fixture.

## The product decision

**A blocked job remains owned by its technician until an advisor or owner explicitly hands it off.**

This is the smallest behavior that preserves accountability. An interruption should never make a job disappear from the person who knows it, and dispatch should never need to guess whether a technician still owns it.

```text
One mounted repair order
│
├── Technician pauses
│   └── timer stops; work remains theirs
│
├── Technician blocks or defers work
│   └── job stays theirs; a short reason explains the hold
│
├── Advisor/owner hands it off
│   └── time is banked; the new technician receives the exact hold or progress
│
├── Customer approves only some work
│   └── approved job proceeds; declined/pending job stays visibly separate
│
└── Advisor/owner cancels then reopens an interrupted ticket
    └── active jobs restore from the cancellation snapshot; completed work stays done
```

## Evidence from current main

The live workbench is the correct base: mounted quote/work tools, local projection updates, bounded quote-draft recovery, explicit dirty-draft protection, role-shaped commands, job-level approval, and phone/desktop Golden Shop Day proof already exist.

The current interruption gaps are precise:

1. `clock_off` banks time but has no auditable pause event or reload-safe simple-work draft.
2. `blocked` is a dead end: the technician workspace deliberately refuses it and command projection exposes no recovery action.
3. Assignment permits only `open` jobs, so active or blocked work cannot be deliberately handed off.
4. Ticket cancellation columns exist but no cancellation/reopen handler, mounted control, snapshot, or audit history exists.
5. There is no general append-only ticket activity ledger; quote/payment records cannot tell the complete interruption story.

## Approaches considered

### A. One hold state plus a typed interruption record — selected

Use the existing `blocked` work state as the only stop-work state. Store why it is held and which usable state it returns to (`open` or `in_progress`). Keep pause as a timer condition, not a new status. Record every meaningful state/ownership change in one append-only activity ledger.

This preserves current terminology, avoids state explosion, gives every role one comprehensible action, and keeps recovery local to the affected job.

### B. Add `paused`, `deferred`, `awaiting_parts`, `reopened`, and `on_hold` states — rejected

It would create overlapping states, unclear transitions, duplicate queue logic, and more ways for work to become stranded.

### C. Put a ticket-level hold over the entire repair order — rejected

One job can be waiting on a part while a second approved job can proceed. A global hold would hide useful work and force needless queue movement.

## State and authority contract

### Job state

`work_status` remains exactly `open | in_progress | blocked | done | canceled`.

- **Pause:** `in_progress` with `clocked_on_since = null`. The job is not blocked; it is simply not currently clocking time. `work_paused` is recorded in the activity ledger.
- **Block/defer:** `open` or `in_progress` becomes `blocked`. The server banks any open timer interval, stores a required hold kind and bounded note, and records whether recovery returns to `open` or `in_progress`.
- **Resolve hold:** restores the stored recovery state. It does not start the clock. The technician sees either **Start work** or **Continue work**.
- **Handoff/reassign:** advisor/owner only. A running clock is banked first. An `open` or `in_progress` job retains its progress state; a `blocked` job retains its hold details. There is no automatic unassign.
- **Partial approval:** remains job-level. An approved job can progress while another job remains quoted, pending, or declined. Quote controls describe the remaining decision instead of blocking approved work.

### Who can act

| Action | Technician | Parts | Advisor / owner |
| --- | --- | --- | --- |
| Pause/resume own approved manual work | Yes | No | Their own assigned manual work only |
| Block/defer own assigned manual work | Yes | No | Any eligible job |
| Resolve a hold | Assigned technician | No | Any eligible job |
| Reassign/handoff | No | No | Yes |
| Record customer approval | No | No | Yes |
| Cancel/reopen a ticket | No | No | Yes |

Parts remains able to receive/resolve its existing bounded part request. It does not gain technician work or customer-decision authority.

## Durable audit truth

Add one tenant-bound, append-only `ticket_activity` table. It is a ledger, not a user-facing event feed system.

Each row contains only:

- `shop_id`, `ticket_id`, optional `job_id`, `actor_profile_id`, `kind`, `created_at`;
- a strict, small JSON payload with identifiers, before/after work state, before/after assignee, hold kind, safe bounded note, and cancellation snapshot when applicable;
- a request key for retry-safe mutation events.

Allowed event kinds are finite: `work_paused`, `work_resumed`, `job_blocked`, `job_hold_resolved`, `job_reassigned`, `job_handed_off`, `ticket_canceled`, and `ticket_reopened`.

The database rejects `UPDATE` and `DELETE` of activity rows. Domain handlers write the job/ticket mutation and its activity receipt in the same transaction, with locked ticket/job rows and request-key idempotency. The browser receives a safe projection; no raw internal payload or customer record is sent unnecessarily.

### Cancellation and reopen

- Only an open ticket with no recorded payment can be canceled. This deliberately avoids inventing a refund path.
- Cancellation requires a bounded reason. Every nonterminal job becomes `canceled`; any running clock is banked. The cancellation event snapshots each interrupted job's last usable state, assignment, hold details, and time fields.
- Reopen is for a canceled ticket. Only an advisor/owner can reopen it. It restores the snapshot's interrupted jobs exactly; deliberately completed/canceled work remains terminal. The ticket becomes `open` and receives a `ticket_reopened` receipt.
- A completed/paid closed ticket is not silently reopened. Follow-up work remains a future, explicit workflow rather than corrupting payment/closeout truth.

## Mounted interaction contract

The repair order never navigates away. It shows no generic dashboard or new page for exceptions.

### One obvious next action

Priority is deterministic:

1. A technician's assigned blocked job: **Resolve hold**.
2. A technician's assigned in-progress job: **Continue work**.
3. An advisor/owner's unassigned open job: **Assign work**.
4. A quote needing a customer decision: **Record approval** for advisors/owners, **View quote** otherwise.
5. Closeout only after every job is terminal and money is settled.

Secondary exception actions live in a compact **Manage work** disclosure on the affected job. It opens inline directly below that job and closes back to the invoking control with focus retained. It is never a modal page or an opaque status menu.

### Hold panel

The mounted panel asks only what the server needs:

```text
Manage work
│
├── Pause now
│   └── banks elapsed time; no reason required
│
├── Put on hold
│   ├── Parts / customer / schedule / shop decision
│   └── What needs to happen next? (required, 1–500 characters)
│
├── Hand off (advisor/owner)
│   └── choose eligible technician; warn before below-tier assignment
│
└── Cancel repair order (advisor/owner)
    └── bounded reason and one explicit confirmation
```

An active hold displays the concise reason, owner, and `Next: resolve hold` directly on the job. The activity section is collapsed by default and shows only factual, readable receipts—no noisy ticker.

### No lost work

- Existing server-saved work notes remain authoritative.
- A bounded, versioned `sessionStorage` draft for the mounted simple-work note / found-concern / parts request is scoped by current actor, ticket, and job. It is restored only when the current server job still matches; corrupt, stale, cross-user, cross-ticket, oversized, or terminal drafts are deleted.
- Block, handoff, cancel, close, or tool-close actions cannot discard a dirty local draft. The user must save, explicitly discard, or stay put.
- Server mutations never claim success until the strict response projection is accepted. On conflict, the draft stays intact and the mounted repair order explains that work changed elsewhere.

### Responsive contract

- The same mounted interaction is used at 390×844 and 1440×900. Desktop gains width, not a second workflow.
- No document-level horizontal scrolling; every note, hold reason, assignee, and status wraps intentionally.
- Controls remain at least 44 CSS pixels, keyboard reachable, focused predictably, and reduced-motion safe.
- Local server-confirmed state changes use the existing restrained bay-pulse orientation cue; no toast stack, confetti, reload, or decorative motion is added.

## Chaos Shop Day acceptance journey

Use isolated authenticated QA accounts and two technicians (the normal technician plus a relief technician). Run the same journey at phone and desktop viewports and clean every created operational row.

1. Owner creates a normal text-only repair order and assigns the first technician.
2. Advisor prepares a quote with two jobs; customer approves one and declines/defer the other. The approved job remains actionable.
3. First technician starts work, types a note, proves reload recovery, pauses, then blocks for parts with a required reason.
4. Advisor sees the exact hold, hands it to the relief technician, and receives a server-confirmed local projection without navigation.
5. Relief technician resolves the hold, sees the persisted note and correct **Continue work** action, completes work, and the event trail proves every transition.
6. A separate synthetic interruption ticket is blocked, canceled without a payment, reopened by an advisor/owner, and proven to restore its owner/hold state and one next action.
7. All four normal roles prove only their intended controls; forbidden controls are absent, not disabled theater.
8. Phone and desktop prove mounted URLs, zero horizontal overflow, no serious/critical Axe findings, focus return, no console/runtime faults, diagnostics/media absent, and zero retained QA operational rows.

## Verification and stop conditions

1. Domain tests cover every legal and illegal transition, role/tenant boundary, idempotent retry, timer banking, stale update, cancellation snapshot, reopen restoration, and activity immutability.
2. Component tests cover next-action priority, mounted panels, dirty-draft guard/recovery, local projection, focus, role visibility, activity text, long content, and reduced motion.
3. The authenticated Chaos Shop Day extends the existing Golden infrastructure and passes at 390×844 and 1440×900.
4. Run affected tests, then the documented eight sequential database-heavy Vitest shards (at most two workers), TypeScript, build, diff/security checks, deployment gates, and exact-production authenticated rerun.
5. Stop and re-plan if this requires enabling diagnostics/media, a paid/refund workflow, messaging/calendar, a new operational page, a new cross-device draft store, a permission expansion beyond the table above, or a new Critical/Important defect unrelated to the repair.
