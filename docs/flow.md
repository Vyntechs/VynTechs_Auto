# Vyntechs living repair-order flow

Verified against the current Shop OS source on 2026-07-21. AutoEye, operational media, and guided diagnostics remain off. The repair order is the shared living object; role-specific queues and inline workspaces are projections of that one server-owned truth.

```text
ADVISOR / OWNER — NEW WORK ORDER (one existing intake page)
  customer + vehicle + customer concern
  │
  ├─ Find the cause
  │    └─ select the shop's diagnostic authorization template
  │         ├─ copied labor/fee scope (labor required; parts forbidden)
  │         ├─ optional technician assignment
  │         └─ no findings invented before testing
  │
  └─ Perform known work
       ├─ select saved repair/maintenance work, or describe a custom request
       ├─ record any customer-supplied item explicitly
       └─ optional technician assignment
            │
            ▼
LIVING REPAIR ORDER
  one durable job + its copied lines are created atomically
  │
  ├─ owner/advisor: team queue, assignment/handoff, quote and customer decision
  ├─ technician: assigned queue; work remains locked until exact quote approval
  └─ parts: parts-needed queue only when a technician requests a part
            │
            ▼
QUOTE — INLINE ON THE SAME REPAIR ORDER
  advisor reviews the copied lines and prepares an immutable version
  │
  ├─ diagnostic authorization snapshot
  │    ├─ authorizationPurpose = diagnosis
  │    ├─ labor required; parts forbidden
  │    └─ customerStory = null until testing produces findings
  └─ known-work snapshot
       └─ preserves customer-supplied-item truth
            │
            ▼
CUSTOMER DECISION
  approved / declined / deferred, recorded by an authorized role
  │
  ├─ declined/deferred → work stays locked
  └─ approved → exact version is pinned to that job
            │
            ▼
TECHNICIAN WORKSPACE — INLINE OR DEEP-LINK FALLBACK
  “Exactly what is approved” appears before the clock/work actions
  │
  ├─ line descriptions + labor hours + part identity/quantity
  ├─ customer-supplied item note
  ├─ no prices, costs, vendor data, or private quote metadata
  ├─ clock on/off, work note, parts request, hold/handoff, found concern
  └─ approved scope stays pinned once work starts
            │
            ▼
PARTS / COMPLETION / RING-OUT
  parts resolves requested items → technician completes with a saved work note
  → authorized front-office role records payment and closes the repair order
```

## Failure behavior

- A missing or stale diagnostic template blocks diagnosis intake visibly; the server never guesses labor.
- A template/tax fingerprint mismatch rolls back the entire intake write.
- A diagnostic authorization containing a part or no labor cannot become a quote version.
- A technician cannot start unapproved work or work assigned to someone else.
- A corrupt or missing approved snapshot fails closed instead of showing an empty or reconstructed scope.
- Phone and desktop use the same routes and server contracts; responsive layout changes presentation, not truth or permissions.

## Deliberately absent

- No AutoEye or AI diagnostic execution.
- No photo, video, audio, document upload, or operational media requirement.
- No extra intake, approval, or technician page introduced by this flow.
- No customer-supplied item represented as a shop-sourced catalog part.
