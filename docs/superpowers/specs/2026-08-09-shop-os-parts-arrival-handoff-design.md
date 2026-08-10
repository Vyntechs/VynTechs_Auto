# Parts Arrival Handoff Design

**Date:** 2026-08-09
**Status:** Approved for implementation
**Approval:** Buzz event `906ffe0ba0ae02dd7f1c1573e9b1a689686e6ca92f109735dc8bb4dcdbe8a9d6`
**Production baseline:** `616b88019e3fd8d8cb7e42b93bd4f4f31dccecb2`

## Outcome

Inside the existing repair order, each customer-approved part has one truthful
manual path: **Needs order → Ordered → Received**. Parts, advisor, and owner can
advance the exact line. The assigned technician sees the same truth without a
mutation control. Receiving the last part reports **All parts here** but never
releases a hold, starts work, or changes any other ticket state.

## Source of truth

- The current approved `quote_versions.snapshot` identifies the exact approved
  job and part line, including the line ID and customer-approved commercial facts.
- The corresponding tenant-scoped `job_lines` row owns live arrival state and the
  existing ordered/received actor and timestamp receipts.
- No new table, migration, supplier record, or duplicate parts-order model is
  introduced.

The approved snapshot stays immutable. Only these live fields may change:
`partStatus`, `orderedAt`, `orderedByProfileId`, `receivedAt`,
`receivedByProfileId`, and `updatedAt`.

## State contract

| Stored state | Display state | Allowed next action |
| --- | --- | --- |
| `proposed` | Needs order | Mark ordered |
| `needs_order` | Needs order | Mark ordered |
| `ordered` | Ordered | Mark received |
| `received` | Received | None |
| `installed` | Received | None |
| `returned` | Unsupported | None; fail closed |

An exact replay is idempotent. A repeated **Mark ordered** on an ordered or later
line returns current truth without rewriting its receipt. A repeated **Mark
received** on a received or installed line does the same. **Mark received** before
Ordered is a conflict, and a returned line is outside this slice.

## Read projection

The server returns only the data this mounted surface needs:

- ticket ID, job ID, approved quote version ID, and job title;
- each approved part line's ID, description, quantity, part number, brand;
- display state, next action, and ordered/received actor name and timestamp;
- received count, total count, and `allHere`.

No price, internal cost, vendor account, offer ID, fitment, vendor snapshot, or
supplier credential appears in this contract. Parts/advisor/owner may read all
approved jobs on the ticket. A technician may read only an approved job assigned
to that active profile. Read paths use a consistent read-only snapshot and do not
take work locks.

## Mutation boundary

The mutation accepts only `{ action: 'mark_ordered' | 'mark_received' }` plus the
ticket/job/line IDs in the route. It resolves the active persisted actor from the
authenticated profile ID and never trusts a client-supplied role or shop.

The transaction locks rows in the shared order already used by Shop OS:

```text
ticket → every ticket job by ID → every ticket line by ID
       → every ticket quote version by ID → actor
```

After locking, it proves all of the following before writing:

1. the actor is active, tenant-scoped, and can place parts orders;
2. the ticket is open;
3. the job belongs to that ticket, is approved, is not done/canceled, and still
   points to the exact locked approved version;
4. that version validates against the ticket and contains this exact part line;
5. the live line still belongs to the job and matches the approved line's stable
   identity and commercial facts;
6. the requested transition is legal from the locked current state.

Lock contention returns a retryable conflict. Cross-shop, stale-version,
unapproved, closed, removed-line, wrong-role, and deactivated attempts reveal no
record existence.

## Mounted interaction

The surface lives inside the existing approved job card. It preserves the
approved prototype's literal three-stop rail, one visible next action, partial
count, receipts, and explicit hold-safe language.

- Parts/advisor/owner see one button for the legal next action.
- Technician sees the rail and receipts, labeled read-only.
- State settles only from a validated server projection.
- If a response is lost or malformed, the client performs one read
  reconciliation and installs server truth before showing failure.
- Controls remain at least 44px, keyboard/focus visible, reduced-motion safe, and
  free of horizontal overflow at 390×844 and 1440×900.

## Adversarial pre-code review

| Risk | Design answer | Disconfirming test |
| --- | --- | --- |
| Two people tap at once | NOWAIT mutation locks plus state-conditional write | Concurrent attempts produce one receipt and one truthful replay/retry |
| A client claims an elevated role | Persisted actor lookup is the only authority | Tech, inactive, and cross-shop mutation attempts fail |
| Quote changed after screen load | Exact approved version and line identity revalidated under locks | Stale version/changed commercial facts cannot mutate |
| Lost response causes a double receipt | Transitions are idempotent and receipts are never restamped | Replay preserves original actor/time |
| Partial arrival implies readiness | `allHere` derives from every approved part line | One missing line keeps job partial |
| Last part silently starts work | Mutation touches only six permitted line fields | Before/after ticket and job rows are identical |
| Technician learns internal sourcing data | Explicit safe projection, strict client parser | Serialized response contains no cost/vendor fields |
| Reads interfere with quote/work edits | Repeatable-read, read-only projection | Read path contains no `FOR UPDATE` and runs during role-shaped tests |
| Rollback needs data repair | No schema or destructive change; code can be reverted | Diff contains no migration or supplier call |

## Acceptance

The slice is accepted only when focused domain, route, parser, component, and
mounted browser tests pass; the complete repository test shards, TypeScript, and
production build pass; phone and desktop proof show the real mounted component;
and independent static, security, runtime, accessibility, and scope review finds
no blocker.
