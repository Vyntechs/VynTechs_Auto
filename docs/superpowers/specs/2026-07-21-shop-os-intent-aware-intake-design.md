# ShopOS Intent-Aware Intake Design

**Date:** 2026-07-21  
**Status:** Approved through the active thread goal  
**Owner:** ShopOS control lane

## Outcome

Repair-order intake must turn the customer's reason for visiting into honest, authorized, technician-ready work. A reported symptom must not silently become a repair, known work must not be forced through diagnosis, and the technician must see the exact scope the customer approved before starting.

## Interaction

The existing New work order page keeps customer, vehicle, concern, assignment, and one inline work decision:

```text
Customer visit
│
├── Find the cause
│   ├── choose the shop's saved diagnostic authorization
│   ├── create one sessionless diagnostic job
│   ├── copy its labor/fee lines atomically
│   ├── prepare and record approval without findings
│   └── technician sees concern + approved operations + authorized hours
│
└── Perform known work
    ├── Saved work
    │   └── copy the selected repair/maintenance template atomically
    └── Custom work
        ├── name the requested operation
        └── optionally record the customer-supplied item
```

“Find the cause” is an explicit advisor choice, never a keyword guess. Diagnostic templates live in the existing canned-job library; the first active diagnostic template in library order is selected by default. If none exists, intake explains that the owner must save one and refuses to invent a price or authorization.

“Perform known work” supports repair, maintenance, installation, and customer-supplied items. A single optional `customerSuppliedPartsNote` carries the truth; null means the shop is not recording a supplied item. This avoids a separate boolean that could disagree with its description.

## Data contracts

### Canned diagnostic authorization

`canned_jobs.kind` expands to `diagnostic`. A diagnostic template must contain at least one labor line and may contain labor or fee lines only. Repair and maintenance templates keep their current rules. Quick Quote continues to offer only repair and maintenance templates; diagnostic authorization belongs to New work order.

### Customer-supplied item

`ticket_jobs.customer_supplied_parts_note` is nullable, trimmed, and bounded to 500 characters. It is allowed only on repair or maintenance jobs. It is projected into ticket detail, quote-builder truth, the immutable approved quote snapshot, and the technician workspace.

### Diagnostic authorization versus findings

A sessionless diagnostic job with no story is an authorization quote, not a diagnosis claim. Its immutable snapshot carries `authorizationPurpose: "diagnosis"`, has no findings story, and must contain at least one labor line. A linked AutoEye diagnostic still requires its existing reviewed evidence-bound story. The diagnostic engine, entitlement, and media boundaries remain untouched.

Once manual diagnostic work starts, its approved quote is pinned exactly like repair/maintenance work. Later quote edits cannot rewrite the scope already being performed.

### Technician scope

The technician workspace derives `approvedScope` from the exact approved immutable quote version, never from mutable draft lines. It exposes only work-relevant truth:

- operation type and description;
- labor hours;
- part quantity and identifying text;
- customer-supplied item note;
- diagnostic authorization purpose.

Customer pricing and internal cost/vendor fields stay out of the technician projection.

## Failure behavior

- Missing or stale canned-template truth fails before customer, vehicle, ticket, job, or line writes commit.
- Missing diagnostic configuration blocks intake with a specific next action; no free or guessed line is created.
- A diagnostic authorization snapshot without a labor line is rejected.
- Linked/engine diagnostics without a reviewed story remain rejected.
- A technician cannot clock onto work without a pinned approved snapshot containing the exact job.
- Unsafe or malformed approved scope fails closed instead of falling back to mutable lines.

## No-scope boundaries

- No AutoEye or diagnostic-engine enablement.
- No media, storage, attachments, or photo requirements.
- No new page or route hierarchy.
- No AI classification of customer language.
- No customer-supplied-parts inventory or warranty-policy system.
- No change to public messaging, vendor ordering, or hosted customer approval.

## Proof

The change is complete only when focused domain/component tests and a four-role flow prove:

1. new and existing customers can create diagnosis or known-work visits;
2. diagnostic templates create a sessionless diagnostic job plus labor atomically;
3. known templates create their exact job and lines;
4. custom customer-supplied work preserves its note through approval and technician execution;
5. diagnostic authorization can be prepared without findings, while linked diagnostics cannot;
6. the technician sees the immutable approved operations and hours before Clock on;
7. phone and desktop layouts remain contained and use the existing mounted surfaces;
8. diagnostics and media remain unavailable.
