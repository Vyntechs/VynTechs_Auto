# Shop OS row 19 — canned jobs and completed Door C design

**Goal:** Let a shop owner maintain safe priced canned work, let every active Shop OS role apply it without hidden totals, and complete Door C from customer/vehicle capture to a reviewable prepared quote in under sixty seconds.

## Product flow

```text
Owner settings
└── Canned jobs
    ├── create or replace one repair/maintenance template
    ├── explicit customer prices and taxability
    └── retire; never delete applied history

Existing quote
└── Add canned job
    └── one atomic job + editable manual-line copy
        └── refreshed complete quote truth

Quick quote
├── customer + vehicle
├── canned template or manual requested work
└── one atomic ticket/job/line commit
    └── /tickets/[id]/quote
        └── human reviews and taps Prepare quote
```

The final `Prepare quote` tap remains explicit. Row 19 does not auto-create an immutable version, send anything, record approval, assign work, or imply authorization.

## Authority

- Listing and applying active canned jobs uses the existing universal `canBuildQuotes` capability.
- Managing the shop-wide canned library is owner-only, matching the master plan's owner authority over rates and settings. Founder override may enter only from the authenticated `isFounder` boundary.
- Every handler derives the tenant from the authenticated actor and loads persisted active, non-deactivated membership. Replace, retire, apply, and Quick Quote repeat actor/capability authorization inside their locking transaction; route/page checks are not authority.
- Unsupported, inactive, deactivated, cross-shop, retired, missing, or corrupt state fails closed without revealing whether another tenant owns it.

## Template contract

`canned_jobs.default_lines` is untrusted JSON. One strict discriminated validator owns create, read, replace, apply, and Quick Quote use.

- Template: title 1–200, repair or maintenance, skill tier 1–3, sort 0–1,000,000, 1–25 lines, validated JSON at most 16 KiB.
- Every line has an explicit complete extended customer `priceCents`; quantity is informational and is never multiplied again.
- Part: canonical positive quantity to three decimals, optional part number/brand, no unit cost/core/vendor/fitment/order state in v1.
- Labor: canonical positive hours to two decimals, explicit price, and a pinned nonnegative rate when present. A missing shop rate is allowed only because price is explicit.
- Fee: explicit price and taxability.
- Unknown or internal fields are rejected. Safe projections omit shop/profile IDs, unit cost, vendor/offer state, approval state, and work state.

The server returns a SHA-256 fingerprint over canonical validated customer-safe content plus `updatedAt`. Create takes a manager-generated UUID, derives template identity from shop + key, returns `changed:false` for an exact normalized collision, and returns `409` for a mismatched collision. Replace, retire, and new apply requests require the expected fingerprint. Quote-facing projections also return the current `taxRateBps`; apply and Quick Quote submit the expected value, including `null`, and recheck it under the transaction. Stale template or tax context returns `409` and makes no write.

## Copy-on-apply boundary

Canned lines expand into ordinary `source='manual'`, `partStatus='proposed'` rows with forced-null internal/vendor/order fields. This is intentional:

- Row 18 already renders and edits every mutable manual line.
- Visible totals therefore contain every copied line.
- Row 17 immutable versions snapshot the same complete job/line truth.
- Later template changes cannot alter applied jobs or versions.

Durable canned provenance is explicitly out of scope. If product later requires it, stop for a separate schema/source lane; do not infer provenance from copied content.

## Atomicity and retry truth

Existing-ticket apply locks in Row 17 order: ticket, jobs, lines, active versions, actor. Request keys are first-success-wins: after current actor/ticket authorization, an existing deterministic job identity returns its safe projection with `changed:false` before current-template validation, even if the source template was later replaced or retired. Only a new identity revalidates the active same-shop template, fingerprint, and tax context before creating the unassigned job and every copied line and invalidating the active version once. Changed UI input must rotate the key; strict historical input binding would require a separate schema-backed idempotency/provenance lane.

The client supplies a UUID request key. Deterministic job/line IDs make a committed retry return `changed:false`. Changed selection rotates the key; different keys intentionally create distinct jobs.

Quick Quote uses the same first-success-wins rule with a UUID request key and deterministic actor-bound ticket identity. After current actor/shop authorization, a committed same-key retry returns that safe ticket before current-template validation. The client must rotate the key whenever normalized input changes. Strict historical input binding or a durable customer/contact request snapshot would require a separate schema lane. Customer/vehicle resolution or creation, mileage update, ticket/job creation, and line copies share one outer transaction and roll back together.

## UI direction

- Preserve the existing predictive customer/vehicle capture, keyboard submit, 44px targets, and 375px layout.
- Rename only this surface to `Quick quote`; keep the stored source label honest.
- When active templates exist, a native labeled select is the fastest glove/mobile/a11y control. Show the selected template's job facts, exact before-tax subtotal, line breakdown, and configured tax/total or unavailable state before explicit application.
- Manual requested work remains a first-class fallback and creates an empty quote draft that still needs priced lines. A null-tax canned selection discloses that preparation will remain blocked before submit.
- Existing quote builder gets the same selected-template line and total preview plus one explicit `Add canned job` control; successful apply refreshes strict server truth and restores focus to the added job.
- Owner Shop settings gets one library module with one open editor, explicit discard, strict line fields, stale-fingerprint recovery, retirement confirmation, visible focus, and no optimistic saves.

## Boundaries

No production migration or apply; no diagnostic prompts/retrieval/topology/session behavior; no story, attachment, send, approval, ordering, assignment, repair start, or closeout work. No hidden line source may coexist with a live-total claim.

The measured under-sixty-second acceptance path is specific: a loaded protected fixture with an existing vehicle, one valid active canned template, and configured tax. Time starts at the first Quick Quote interaction and ends when Prepared V1 and the exact matching total are visible on `/tickets/[id]/quote`; record elapsed time and tap/key count. Manual and null-tax paths remain honest incomplete drafts and are not used to claim this acceptance.
