# Shop OS Row 21 — Story Review and Exact-Version Approval Design

**Date:** 2026-07-11  
**Status:** Control-lane approved for implementation  
**Owner:** advisor/customer UI lane (`A`)  
**Depends on:** rows 17 and 20

## Outcome

An advisor, owner, or technician can turn a diagnostic result into honest customer-facing language, while only an advisor or owner can record a phone or in-person decision against the exact prepared quote version. Parts-role users may view/build quote lines but cannot mutate stories or customer decisions.

This row completes the existing domain work. It does not add a second story generator, a second approval handler, messaging, public links, repair authorization, or diagnostic-engine behavior.

## Subject, audience, and single job

- **Subject:** the service counter at the moment technical findings become customer authorization.
- **Primary audience:** an advisor or owner using a phone or counter computer while speaking with the customer.
- **Secondary audience:** the technician who reviews or manually writes the diagnostic story before it reaches the customer.
- **Single page job:** make the customer story trustworthy, prepare an immutable quote, then record exactly what the customer decided.

## Product decisions

### 1. One quote workspace, two deliberate checkpoints

The existing `/tickets/[id]/quote` surface remains the only workspace.

1. **Story checkpoint:** AI-authored language is visibly pending until a human reviews it. A manually written topology story is human-authored from the start and becomes reviewed when deliberately saved.
2. **Authorization checkpoint:** after a quote version exists, the UI pins its version, immutable job subtotal before tax, and immutable ticket total before recording phone or in-person approval.

There is no wizard, progress rail, or forced pipeline. The page shows only the current state and available next action.

### 2. Story truth rules

- Ordinary locked-tree sessions may use row 20's bounded evidence picker and generator.
- Topology sessions use a manual story in this row. Published-wizard stories remain unsupported; the UI never implies that AI reviewed or generated either path.
- Existing AI proof claims and their source IDs are read-only during narrative review. A human may regenerate with a different evidence selection, but cannot silently rewrite a sourced excerpt while retaining its provenance.
- Human review edits only `What we found` and `What we recommend`. The server preserves the exact ticket concern, neutral waiver, and source-bound proof.
- A manual topology story uses the exact ticket concern, an empty `howWeKnow`, the neutral waiver, and technician-entered finding/recommendation. It never invents proof.
- Any changed story invalidates the active quote version through the existing invalidation helper.
- AI stories must be `reviewed` before version creation. The existing fail-closed snapshot guard remains authoritative.

### 3. Review mutation contract

Add one handler and extend the existing story route with `PUT`:

```ts
saveReviewedCustomerStory(db, {
  actor,
  ticketId,
  jobId,
  body: {
    clientKey,
    expectedStoryRevision,
    whatWeFound,
    whatWeRecommend,
  },
})
```

The handler:

- authenticates an active same-shop `tech`, `advisor`, or `owner` actor; parts are denied;
- locks ticket, jobs in ID order, versions in ID order, target session when present, and actor;
- accepts only an open diagnostic job on an open ticket;
- preserves `source: 'ai'` for a generated story and uses `source: 'manual'` when creating a human-only story;
- preserves `whatYouToldUs`, `whatItMeansIfWaived`, and source-bound `howWeKnow` from server truth for AI stories;
- creates manual stories only for topology sessions, with `source: 'manual'`, exact server-side concern, empty proof, and the neutral waiver;
- persists `storyRevision`, review request identity/fingerprint, reviewer, and review time in `storyMeta` JSONB;
- returns committed truth for a canonical same-key/same-actor/same-payload retry before checking the now-stale expected revision, and rejects key reuse by another actor or with different content;
- rejects a stale expected revision;
- invalidates the active version only when story content changes;
- marks the saved story `reviewed` and never calls an AI provider.

No schema migration is needed because `storyMeta` is already bounded JSONB and the additive fields are source-level types.

### 4. Exact-version decision projection

The existing builder projection gains only safe facts needed by the UI:

- each job's story and review state;
- each job's approval state and approved version ID;
- the active version's ID, number, immutable ticket total, and immutable per-job subtotals before tax;
- `canRecordCustomerApproval`, computed from the current actor capability.

The UI posts to the existing `/api/tickets/[id]/quote/decisions` route. It never writes approval projections directly.

### 5. Approval interaction

Prepared quote actions are per job because that is the approval granularity. Row 21 extends the existing decision guard so a diagnostic job may be approved only when its immutable snapshot contains a valid reviewed/manual story. Repair and maintenance eligibility remains unchanged.

```text
Prepared quote V3 · immutable
│
├── Front brake repair · $842.17
│   ├── Record phone approval
│   ├── Record in-person approval
│   └── Record declined
│
└── Cabin filter · $74.20
    ├── Record phone approval
    ├── Record in-person approval
    └── Record declined
```

Approval requires one confirmation sheet that restates:

- job title;
- immutable version number;
- immutable job subtotal before tax and immutable ticket total;
- channel (`Phone` or `In person`);
- the exact action (`Record approval`).

The client creates one request UUID when the confirmation opens and retains it through transport retries. A decline uses the existing channel-neutral domain contract and is labeled simply `Record declined`.

## Visual direction

Use the existing Vyntechs token system and typography. This is an extension of a live product surface, not a rebrand.

- **Palette:** existing `--vt-*` paper, ink, muted, rule, signal, and error tokens only.
- **Type:** existing display face for the customer verdict; existing body face for explanation; existing utility face for version, money, channel, and evidence labels.
- **Layout:** the story sits inside each diagnostic job; the prepared-version authorization rail replaces the draft tape's next-action area without hiding immutable totals.
- **Signature:** an **authorization strip** visually binds `V#`, job title, immutable job subtotal before tax, immutable ticket total, and channel into one quiet confirmation object. It should feel like signing a repair order, not submitting a generic form.

```text
Mobile
┌──────────────────────────────┐
│ Ticket 1042                  │
│ Customer · Vehicle           │
├──────────────────────────────┤
│ DIAGNOSTIC STORY · REVIEW    │
│ Customer concern · fixed     │
│ What we found                │
│ [editable narrative]         │
│                              │
│ Proof                        │
│ ▸ 3 sourced observations     │
│                              │
│ [Save reviewed story]        │
├──────────────────────────────┤
│ QUOTE V3 · IMMUTABLE         │
│ Brake subtotal       $842.17 │
│ Ticket total         $916.38 │
│ [Phone] [In person]          │
│ [Record declined]            │
└──────────────────────────────┘
```

At desktop width, the story remains in the ledger and authorization remains in the right-hand tape. At mobile width they stack in reading order. Every action is at least 44px, focus is visible, errors are announced, and reduced motion is respected.

## State behavior

| State | Story surface | Quote action | Approval surface |
|---|---|---|---|
| No diagnostic story, ordinary locked tree | Select evidence and generate | blocked until reviewed | hidden |
| AI story pending | Editable narrative + read-only sourced proof | blocked | hidden |
| Manual topology story absent | Empty manual editor with explicit human-authored label | blocked | hidden |
| Published-wizard story | Explicitly unsupported in this row | blocked | hidden |
| Story reviewed, no version | Reviewed summary | prepare when other quote rules pass | hidden |
| Active prepared version | Frozen story/version facts | already prepared | per-job decisions for capable actor |
| Approved/declined | Frozen result and channel when applicable | edit requires new version | no misleading repeat action |
| Stale revision/version | preserve input; show server-truth refresh | blocked | blocked until refresh |

## Security and race requirements

- Tenant and actor checks repeat inside the write transaction.
- All denials collapse to existing uniform not-found/forbidden boundaries.
- Story review uses expected revision plus persisted request identity; quote decision keeps its existing request-key idempotency.
- Approval acts only on the single active immutable version and a job present in that snapshot.
- Client-provided totals, approval state, metadata source, reviewer IDs, timestamps, and version state are ignored.
- No customer story, concern, evidence, VIN, phone number, or decision body enters logs or analytics.
- Tech users can review stories but never receive enabled customer-approval controls. Parts users can build quote lines but cannot review stories or record decisions.

## Out of scope

- SMS, hosted approval links, public tokens, and customer questions.
- Repair/maintenance execution and closeout authorization guards (rows 22–24).
- Adaptive topology finding bridge.
- New tables, migrations, engine prompts, topology semantics, or production configuration.

## Acceptance proof

- AI story cannot be versioned before review; a diagnostic job with quote lines cannot be versioned without a valid reviewed/manual story.
- Reviewed AI story and manually authored topology story can be versioned; published-wizard story remains unsupported.
- Editing a story invalidates the active version; a metadata-only canonical retry does not.
- Diagnostic, repair, and maintenance phone/in-person approval and decline record one append-only event against the exact active version when their server-side eligibility rules pass.
- Cross-shop, stale revision, stale version, role, duplicate-key, changed-key, and concurrent attempts fail safely.
- 375px and desktop surfaces expose the complete flow with keyboard/focus/announcement proof. Browser timing demonstrates verdict visible immediately, proof available in one tap, and a phone/in-person decision recorded in two taps and under 60 seconds.
- Focused tests, full suite, TypeScript, production build, diff review, independent review, and browser accessibility proof pass.
