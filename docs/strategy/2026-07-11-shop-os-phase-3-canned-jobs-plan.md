# Shop OS row 19 — canned jobs and completed Door C implementation plan

**Goal:** Ship owner-managed canned priced work, atomic application to existing quotes, and a complete Quick Quote handoff without widening into approval, send, story, parts, or repair execution.

**Architecture:** One strict canned-template domain owns customer-safe validation, projections, fingerprints, CRUD, and atomic copy-on-apply. Applied templates become ordinary editable manual lines so Row 18 visible totals and Row 17 immutable snapshots remain identical. Door C reuses its existing customer/vehicle transaction and redirects to the quote builder for the explicit preparation tap.

## Hard constraints

- No schema or production data change. `canned_jobs` from row 16 is the only template store.
- Listing/apply uses persisted `canBuildQuotes`; management is owner-only with founder override supplied only by the authenticated boundary. Domain transactions reauthorize current membership/capability.
- Never accept or expose unit cost, core, vendor/offer/order state, approval state, story, attachment, diagnostic, assignment, or work state.
- Every copied line is `source='manual'`, fully visible/editable, and included in both live and immutable totals.
- Customer/vehicle/ticket/job/line Quick Quote creation is one transaction with actor-bound request identity; mutable customer/vehicle records are not falsely claimed as a durable request snapshot.
- Preparation remains a separate explicit user tap. Prepared does not mean sent, approved, authorized, ordered, or started.

## Task 1: Claim and prove the contract

- [x] Base the branch on merged row 18 and preserve its exact green source tree.
- [x] Run independent pre-code reviews of canned-domain safety and the Door C interaction.
- [ ] Mark row 19 active in the master plan, publish this packet, and open a draft PR.
- [x] Independently review this design for simpler seams, hidden totals, authority, concurrency, test gaps, and rollback.

## Task 2: Strict canned library domain and API

- [ ] Add one strict safe template/line validator, canonical projection, exact subtotal/tax summary, and fingerprint.
- [ ] Add stable active listing plus client-keyed idempotent create, fingerprint-guarded full replace, and idempotent retirement; corrupt stored JSON fails closed.
- [ ] Add thin authenticated/paywalled routes. All builders may list; only owner/founder may manage.
- [ ] Prove tenant/privacy, role/activity, retired/corrupt state, bounds, extra/internal field rejection, retry, stale fingerprint, and no physical deletion.

## Task 3: Atomic existing-ticket apply

- [ ] Add one ticket-first `NOWAIT` mutation taking request key, canned ID, expected fingerprint, and expected tax context; resolve a first-success-wins committed same-key result before requiring the template to remain active/current.
- [ ] Create one unassigned repair/maintenance job and exact manual-source line copies; invalidate one active version once.
- [ ] Make committed same-key retries return the existing job, rotate keys on changed input, and roll back every new-request failure; do not claim schema-free historical input binding.
- [ ] Prove complete refreshed builder totals equal the next immutable snapshot totals and later template edits cannot mutate applied truth.

## Task 4: Owner canned-library surface

- [ ] Extend protected Shop settings with a calibrated canned-job library and one strict create/edit surface.
- [ ] Support part/labor/fee lines, exact prices/taxability, stable ordering, explicit discard, stale refresh, and retirement confirmation.
- [ ] Prove owner/founder access, 44px controls, visible focus, decimal keyboards, 375px stacking, safe-area/error behavior, and no optimistic/fake save.

## Task 5: Existing quote canned application

- [ ] Load only safe active templates into the protected quote page and show the selected title/kind, line breakdown, exact subtotal, and configured tax/total or unavailable state before one explicit Add canned job action.
- [ ] Preserve one request key across ambiguous retries, rotate on selection/success, serialize operations, and refresh strict builder truth.
- [ ] Restore focus to the new job and map access, not-found, stale, busy, malformed success, and network outcomes without inventing causes.

## Task 6: Complete Door C Quick Quote

- [ ] Add canned/manual source selection to the existing customer/vehicle flow with server-projected exact template preview; disclose that manual and null-tax paths remain incomplete drafts.
- [ ] Add durable request identity and atomically create customer/vehicle/ticket/job/manual-line copies for new and existing vehicles.
- [ ] Redirect only from a strict UUID success to `/tickets/[id]/quote`; keep manual fallback and make the explicit Prepare tap the completion step.
- [ ] Prove first-success-wins same-key retry, client key rotation on normalized input change, stale template/tax context for new requests, rollback after every stage, no session/assignment/approval, and exact totals.

## Task 7: Visual, accessibility, and independent review

- [ ] Prove changed Quick Quote controls at desktop and 375px: native labels, visible focus, 44px targets, stale-refresh focus, safe-area footer, keyboard clearance, mode switching, and calm errors.
- [ ] Run the loaded configured-tax existing-vehicle canned fixture from first interaction through visible Prepared V1, recording elapsed time, tap/key count, and exact preview/display/snapshot total equality; if browser authentication/environment blocks it, record the exact gate without claiming elapsed success.
- [ ] Independently review product truth, money, tenant/privacy, idempotency, accessibility, and future-row scope; resolve every finding.

## Task 8: Verify, reconcile, and ship

- [ ] Run focused tests, full suite, TypeScript, production build, and diff checks.
- [ ] Add the row-19 implementation correction, mark row 19 complete, and identify row 20 as the next non-overlapping lane.
- [ ] Push final head, pass GitHub checks, mark ready, squash-merge, verify tree equality, and continue the next safe source lane.

## Stop conditions

- Stop if durable template provenance is required; that needs a schema/source lane.
- Stop for production migration/application, external account or credential, spend, irreversible action, or a new approval/send/work authority decision.
- Stop if complete visible totals cannot exactly match copied line and immutable snapshot truth.
