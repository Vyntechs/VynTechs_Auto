# Shop OS Quote Composition and Commitment Design

**Status:** Draft for Brandon's design approval. No implementation authority is implied by this artifact.

## Executive result

Turn the existing mounted quote builder into one calm Quote Bench where an advisor can compose the repair, see exact durable totals, deliberately prepare the exact quote they reviewed, and correct it without losing the prior version of truth.

The quote never leaves the repair order. One restrained product-specific motion makes a durable save or prepared version feel mechanically seated. Prepared truth is claimed only after the server has locked, compared, written, and returned the same quote the advisor confirmed.

## Intent normalization

### Likely true outcome

An advisor can finish a mixed labor, part, fee, canned-job, and manual-job quote on phone or desktop; confirm the exact customer-facing total; create one immutable prepared version; correct a mistake; and prepare the next version without ambiguity, duplicate work, or stale-price overwrite.

### Explicit requirements

- Start the next highest-leverage Shop OS chunk after Ticket Building and Correction.
- Give the work an understandable chunk order and visible customer outcome.
- Make Quote Composition and Commitment feel world class while preserving Shop OS's mounted repair-order workflow.
- Prove Finish, Correct, and Recover on phone and desktop.
- Keep production migrations and dormant features behind their existing approval gates.

### Inferred requirements

- The amount confirmed must be cryptographically bound to the canonical draft the server prepares; matching totals alone are insufficient.
- A stale line editor must not overwrite a newer price or description without a conflict.
- The interface must distinguish the currently actionable prepared version from the latest historical version.
- An open editor is local unsaved intent, not durable quote truth.
- Every blocked state must explain why preparation is unavailable.

### Constraints and non-goals

- No new page, wizard, drawer, schema, migration, dependency, provider, pricing field, payment flow, notification, approval channel, or permission model.
- No customer-viewed, sent, approved, authorized, or committed claim from preparation alone.
- No full version-history browser or historical diff tool.
- No optimistic prepared styling, automatic preparation, automatic sharing, or mutation of immutable quote history.
- No production data write, feature activation, or migration `0050`/`0051` apply.

### Effort and authority

- **Tier:** T2 cross-functional: composition, exact money, immutable versioning, concurrency, accessibility, and interaction design meet in one journey.
- **Design authority:** A1. This document is a reviewable proposal.
- **Source authority after approval:** A2 on an isolated branch, through tests, independent review, and a linked pull request.
- **Production authority:** A3 remains required for deployment or any dormant-feature activation.

## Capability packet

### User and setting

The primary user is the advisor building a real repair order at the counter or beside a vehicle. They may be interrupted, switch between phone and desktop, or share the repair order with another authorized shop user.

### Product job

> Turn the repair work I have saved into the exact customer-facing quote I intend, then let me correct it without confusing old, current, and unsaved truth.

### Intended feeling

Calm certainty. The interface should feel like a physical estimate tape feeding through a machine and seating under a version stamp: exact, deliberate, and difficult to misread.

### One signature device

**Tape detent:** after refreshed server truth proves a durable line save or prepared version, the affected line and quote tape receive a restrained 2px signal rail. Preparation seats the tape once from `translateY(-2px)` to rest over 200ms. Reduced-motion mode removes the transform and transition while preserving the rail, words, exact total, focus destination, and live announcement.

No sparkle, gradient, count-up, confetti, vibration, sound, generic pulse, or decorative celebration.

## Current source truth

- The repair order already mounts the quote workspace in place (`components/screens/ticket-detail.tsx`).
- `ManualQuoteBuilder` already supports manual parts, labor, fees, jobs, canned work, durable session drafts, exact BigInt money, focus recovery, active versions, and customer actions (`components/screens/manual-quote-builder.tsx`).
- Quote mutations use tenant-scoped `NOWAIT` locks and atomically supersede an active version and expire its actionable link through `invalidateActiveQuoteVersion` (`lib/shop-os/quotes.ts`).
- Immutable quote versions and their snapshots already exist; no storage change is required (`lib/db/schema.ts`, migration `0028`).
- The builder query already loads all versions but currently projects only the active one. After a persisted correction the interface therefore falls back to `No prepared version`, even though immutable Vn still exists.
- Prepare currently performs a bodyless POST on the first tap. It can therefore prepare a different concurrent draft than the amount the screen showed.
- Manual line PUT and DELETE currently carry no expected revision. A stale editor can overwrite a newer line.
- Existing line and job saves already refresh and validate server truth before announcing completion.

## Approaches considered

### A. Evolve the mounted Quote Bench — recommended

Keep the current page and data model. Add server-derived commitment and concurrency fingerprints, a durable latest-prepared summary, an inline exact-total confirmation, and one focused commitment component.

Why: smallest coherent change; preserves repair-order continuity; fixes real stale-truth defects; requires no migration.

### B. Add a separate Revise mode — rejected

This would make prepared-versus-editable state explicit, but adds an extra workflow step and global mode the existing atomic invalidation contract does not need.

### C. Add a quote preview page or split view — rejected

This could create visual ceremony, but duplicates the mounted quote, adds navigation and recovery surfaces, and weakens the repair order as the single workspace.

## Experience contract

```text
Repair order stays mounted
│
└── Quote Bench
    ├── Compose
    │   ├── Open one local editor → Unsaved line changes
    │   └── Save → server refresh → line and total settle
    │
    ├── Review
    │   └── Current draft · exact server-bound total
    │
    ├── Prepare
    │   ├── First tap opens commitment plate; no POST
    │   ├── Customer will see $X.XX · jobs N · lines N
    │   └── Prepare $X.XX → [API]
    │
    ├── Commit
    │   ├── Locked fingerprint matches → immutable Vn
    │   └── Refresh proves Vn + exact total → tape seats once
    │
    └── Correct or recover
        ├── Unsaved edit → Vn remains current; local change is not saved
        ├── Saved edit → Current draft · Vn no longer current
        └── Stale truth → no write; refresh and review again
```

### Visible states and primary action

| State | Visible truth | Sole filled action |
|---|---|---|
| Line editor open | `Unsaved line changes`; prepared Vn remains current until save | `Save line` |
| Never prepared draft | `Current draft`; `Customer has not received this`; exact draft total | `Prepare quote` |
| Revised prepared draft | `Current draft`; `Vn no longer current`; current and last prepared totals | `Prepare quote` |
| Commitment plate | Jobs, lines, and `Customer will see $X.XX` | `Prepare $X.XX` |
| Preparing | Same amount remains visible; no version claim | Disabled `Preparing $X.XX…` |
| Prepared | `Prepared Vn`; exact snapshot total | Existing eligible next action only |
| Recoverable conflict | Local intent remains; exact reason and refreshed truth | `Review updated quote` or `Retry save` |
| Truly blocked | All preparation blockers visible beside the tape | None |

Add, edit, remove, type selectors, cancel, and alternate customer-decision actions remain outlined or text controls. There is never more than one filled primary in an actionable state.

### Phone and desktop

- Desktop preserves the ledger-left, sticky-tape-right composition.
- Phone uses one safe-area-aware commitment rail with exact state and total only when no editing surface or software keyboard owns the action.
- While any input, textarea, select, story editor, sourcing tool, or confirmation is active, the rail becomes static and may not cover Save, Cancel, errors, or the focused field.
- Every interactive target is at least 44×44px. Long descriptions and money wrap without horizontal overflow. Money remains tabular.
- Focus returns to the touched line after save, the refreshed quote after conflict, and prepared truth or the next eligible action after preparation.

## Server and data contract

### 1. Keep current and historical prepared truth separate

Preserve `activeVersion` as the sole current/actionable prepared version. Add an allowlisted read-only summary:

```ts
type LastPreparedVersion = {
  id: string
  versionNumber: number
  totalCents: number
  contentFingerprint: string
  state: 'current' | 'superseded'
} | null
```

Select the latest by maximum validated `versionNumber`, never UUID or timestamp. Validate the historical snapshot schema and ticket binding, but do not require an old snapshot's customer or job facts to equal current rows. Add the same allowlisted `contentFingerprint` to `activeVersion`. If `state === 'current'`, its ID, version, total, and fingerprint must equal `activeVersion`; contradiction fails the projection closed.

`lastPreparedVersion` is display/history context only. Customer links, approval controls, and decision actions may consume only `activeVersion`.

### 2. Bind preparation to the reviewed draft

Add a server-derived projection when the draft is versionable:

```ts
type DraftCommitment = {
  algorithm: 'quote-draft-v1-sha256'
  fingerprint: string
  totalCents: number
  jobCount: number
  lineCount: number
} | null
```

The fingerprint covers the full canonical customer-facing snapshot, including every identity, job, line, attachment, tax, subtotal, and total field that would enter the immutable version. It is an opaque concurrency token, not a secret or authorization credential.

`POST /api/tickets/:id/quote/versions` becomes strict JSON:

```ts
{ expectedDraftFingerprint: string }
```

Inside the existing transaction and lock order, rebuild the canonical snapshot, calculate the same versioned fingerprint, and compare before superseding or inserting anything. A mismatch returns no-store `409 conflict` with zero version, job, link, or approval write. The UI refreshes the draft and requires a new deliberate confirmation; it never auto-submits the new total.

An exact active-version content match remains an idempotent replay and returns the same immutable version.

### 3. Prevent stale line overwrite

Every projected mutable manual line gains an opaque `lineFingerprint` over its canonical persisted editable fields, binding IDs, and exact persisted `updatedAt` revision. PUT and DELETE become strict JSON and require `expectedLineFingerprint`; the domain compares it against the locked row before any no-op check, update, delete, or quote invalidation.

A mismatch returns no-store `409 conflict`, writes nothing, preserves local editor intent, refreshes current server truth, and asks the advisor to reconcile. Create keeps its existing client-key idempotency. Non-manual sourced-line removal remains on its existing locked contract and does not gain manual-line overwrite semantics.

### 4. Preserve authority and atomicity

- Prepare and quote composition keep the existing `canBuildQuotes` authority.
- Customer link/send/decision controls remain restricted to their existing advisor/owner capability and dormant activation gates.
- Reauthorize the persisted actor inside the existing locked transaction; never trust client role/shop fields.
- Every snapshot-affecting successful mutation reuses `invalidateActiveQuoteVersion` in the same transaction. Conflicts and semantic no-ops do not invalidate.
- Hashes never replace tenant checks, authorization, schema validation, immutable snapshot validation, or exact money checks.

## Component boundary

Keep `InlineQuoteWorkspace` as loader/retry owner and `ManualQuoteBuilder` as the mounted composition owner. Extract one focused `QuoteCommitmentPanel` from the existing tape/mobile action markup. It receives already parsed builder truth, totals, preparation state, and callbacks; it does not fetch, authorize, calculate money, or own server state.

Expected source surface:

- `lib/shop-os/quotes.ts` — safe fingerprints, projections, locked comparisons.
- `lib/shop-os/quote-builder-ui.ts` — strict client projection parsing and explicit preparation states.
- `app/api/tickets/[id]/quote/versions/route.ts` — strict expected fingerprint request.
- `app/api/tickets/[id]/quote/jobs/[jobId]/lines/[lineId]/route.ts` — line CAS request contract.
- `components/screens/manual-quote-builder.tsx` — local editor, confirmation, refresh, and focus orchestration.
- `components/screens/quote-commitment-panel.tsx` — presentational commitment states.
- `components/screens/manual-quote-builder.module.css` — tape detent, commitment rail, phone safety, reduced motion.

No new page, endpoint, table, migration, provider, dependency, public permission, or global component system.

## Failure, recovery, and concurrency

- **Unsaved editor:** show that prepared Vn remains current; never imply session storage is a server save.
- **Stale line:** keep typed values, refresh the locked row, show `This line changed elsewhere`, and require explicit resubmission against the new fingerprint.
- **Stale preparation:** keep the commitment plate visible only long enough to explain that the quote changed, refresh totals, close or reset confirmation, and require review before another POST.
- **Lost save response:** reuse the existing create key and converge on one durable line.
- **Lost prepare response:** refresh first. If the expected fingerprint is now active, settle into that version; otherwise show truthful draft/conflict state. Do not create a duplicate version.
- **Malformed success or failed refresh:** no durable-success styling. Keep the mounted workspace and offer the one safe refresh/retry action.
- **Concurrent preparation:** identical canonical content converges on one current immutable version; different content yields conflict before mutation.
- **Link race:** invalidation and actionable-link expiry remain one transaction; no link response may claim an invalidated version is current.

## Acceptance tests

### Finish

- Build a mixed quote without leaving the repair order.
- A saved line and recalculated total appear only after validated refreshed truth and survive reload.
- The first Prepare tap sends no request and repeats the server-bound exact total, job count, and line count.
- The confirmation sends the displayed fingerprint once; locked server truth matches; refreshed `activeVersion` and total match; the tape seats once.

### Correct

- Opening a prepared line shows unsaved local intent while Vn remains current.
- Saving with the current line fingerprint atomically makes Vn and its link non-current, preserves its immutable snapshot byte-for-byte, and shows `Current draft · Vn no longer current` after refresh.
- A stale PUT or DELETE returns conflict with zero writes and preserves the local draft.
- Re-preparing the corrected fingerprint creates Vn+1; Vn remains immutable and historical.

### Recover

- Interrupted create retry reuses its request key and creates one line.
- Stale preparation fingerprint, stale line fingerprint, lock contention, malformed success, failed refresh, and late success never show false prepared or saved truth.
- Two-connection tests cover stale confirmation versus line edit, stale PUT, stale DELETE, concurrent Prepare, and link response racing invalidation.

### Browser proof

Run actual production React/CSS at 390×844 and 1440×900 for two journeys, four cases total:

1. `finish-correct` — compose mixed quote, confirm exact total, prepare V1, edit and invalidate, show V1 historical truth, prepare V2.
2. `recover` — interrupted line save, stale line conflict, stale preparation conflict, malformed success, and truthful refresh.

Each case proves exact request identity, focus destination, keyboard/safe-area behavior, complete 44px target scan, no horizontal overflow, normal/reduced-motion equivalence, zero serious/critical Axe findings, no unexpected browser/network faults, and preserved screenshots/receipts before any rerun.

The loopback browser proof remains an interaction/accessibility receipt. PGlite/domain tests remain the durable transaction and persistence receipt; do not overclaim one environment as the other.

## Verification and convergence

1. RED tests first for projection parsing, exact fingerprint inputs, stale line write refusal, stale Prepare refusal, and UI state language.
2. Implement the smallest domain, route, and mounted UI changes.
3. Run focused tests during development.
4. Run static, security, and runtime/accessibility reviewers in parallel.
5. Consolidate all blocking findings into one repair wave and one focused re-review.
6. Run the entire serialized unit suite, TypeScript, production build, source integrity checks, and four-case browser proof on the exact final HEAD.
7. Open a linked PR only after the evidence passes. Do not merge or deploy without the required authority.

## Rollback and stop conditions

Rollback is a source revert. Historical quote versions remain immutable; never delete or rewrite them.

Stop and return for a new decision if implementation requires a migration, a new public endpoint, broader permissions, production secrets/data, dormant-feature activation, customer-viewed semantics, or a new Critical/Important defect after focused final re-review.

## Evidence and reviewer reconciliation

- Product/roadmap source: `PLANS/SHOP_OS_PREMIUM_INTERACTION_ROADMAP_2026_08_02.md` and `docs/strategy/2026-05-29-customer-interaction-doctrine.md`.
- Current implementation: `components/screens/manual-quote-builder.tsx`, `components/screens/manual-quote-builder.module.css`, `lib/shop-os/quotes.ts`, `lib/shop-os/quote-builder-ui.ts`, quote routes, schema, and named unit/E2E receipts at exact baseline `9dc3845fad78615eef6d8a0de724b94db4702f91`.
- Runtime/accessibility review: approved the mounted Quote Bench, exact-total commitment plate, tape detent, single filled action, phone keyboard rules, and Finish/Correct/Recover proof.
- Static/source review: required a server-derived canonical draft fingerprint and durable last-prepared projection; rejected a cosmetic confirmation around the existing bodyless POST.
- Security review: found no Critical issue and required three Important design changes: fingerprint-bound Prepare, line-level compare-and-swap, and strict separation of active versus last prepared truth. All three are incorporated above.
- Secret/dependency review: no dependency diff; heuristic redacted source/history scan found no live-format credential material. Dedicated secret-scanner binaries were unavailable.
- Clean-main baseline: the serialized eight-shard suite reported 4,208 passing tests and one existing focus assertion failure in `shop-os-manual-quote-builder`; that exact test passed immediately in a one-worker isolated rerun. Treat the full baseline as red/flaky until the final branch reruns the entire gate successfully.

## Approval gate

Brandon approves or adjusts this written design before implementation planning or code begins. Approval authorizes source work only. It does not authorize migration `0050`/`0051`, Customer Approval activation, Ticket Correction activation, preview/production data mutation, merge, or deployment.
