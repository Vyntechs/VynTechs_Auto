# Shop OS Phase-1 Counter Intake v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, and `frontend-design` task-by-task. Steps use checkbox syntax for durable progress. This packet is subordinate to `2026-07-10-shop-os-spec-and-phased-plan.md`.

**Goal:** Make the existing default-off owner counter surface create one real, readable Shop OS ticket with honest open-or-assigned jobs, structured concern/authorization data, working VIN decode, and a ticket redirect—without creating a diagnostic session early or changing any legacy diagnostic path.

**Approved design:** The active Rev-4 plan and Brandon's approval select ticket-first counter intake. The new UI uses a dedicated `/api/tickets/counter` seam. The existing `/api/intake/submit` diagnostic-session route stays byte-for-byte unchanged for legacy flows and engine regression coverage. Feature enablement remains the separate owner gate through `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED=false` by default.

**Architecture:** A new injected `createCounterTicket(db, input)` handler validates the counter body, resolves or creates the customer and vehicle in one outer transaction, and calls the row-8 `createTicket` handler through a nested savepoint so ticket numbering, jobs, and assignment rules remain canonical. A thin authenticated/paywalled/rate-limited route maps the result. `CounterIntake` calls that route, wires the existing VIN decoder, sends one diagnostic job plus an optional requested repair/maintenance job, handles explicit below-tier confirmation, and redirects to `/tickets/[id]`. The roster query combines open ticket jobs with only ticketless legacy open sessions.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Drizzle/PGlite, Zod, Testing Library, Vitest 4, existing Workshop Instrument desktop components.

## Design alternatives considered

1. **Recommended — dedicated ticket-first counter seam.** Preserves the old session initializer, avoids early AI/provider work, makes the ticket the spine, and leaves row 15 as the only diagnostic-start owner. Cost: one small counter orchestration handler and route.
2. **Create a ticket after the existing intake session.** Rejected because a slow/failed AI call can prevent the ticket, `sessions.techId` destroys true-open assignment, and row 15 would inherit an already-created session.
3. **Replace `/api/intake/submit` in place.** Rejected because it silently changes an existing engine path and invalidates mature topology/tree/cold-case regression coverage.

## Global constraints

- Do not apply migrations, enable the feature flag, or write production Supabase. Row 6 and feature enablement remain owner gates.
- Do not change `/api/intake/submit`, `createSessionFromIntake`, diagnostic prompts, retrieval, topology, session initialization, repair/close behavior, or engine output semantics.
- Do not create or link a diagnostic session. Row 15 owns idempotent full diagnostic bootstrap.
- Counter source always requires a same-shop customer and vehicle. Cross-shop/missing resources fail closed through the handler.
- The first job is diagnostic, required A-tier, and titled deterministically from the persisted concern. One optional requested-service field may add one repair (B-tier) or maintenance (C-tier) job; no quote lines or canned jobs enter row 10.
- Assignment applies to every created job. `null` stays truly open. A below-tier selection requires the row-8 explicit confirmation round trip; it is never silently downgraded or reassigned to the advisor.
- VIN decode is explicit and real: a 17-character VIN enables `Decode VIN`; success fills year/make/model/engine, invalid/unavailable results remain editable and visibly explained.
- Diagnostic authorization is an optional decimal-dollar amount plus optional note. The server parses amount to non-negative integer cents; it never infers repair approval.
- Unsafe or malformed customer, vehicle, job, authorization, assignment, and existing-vehicle inputs return domain errors before writes. Failed ticket creation rolls back new customer/vehicle rows.
- Preserve calm technical copy, existing tokens/fonts, real controls, 44px interactive targets, visible focus, keyboard operation, and 375px behavior. No new color palette, fake autosave/camera/AI claims, or motion.

## Data flow

```text
OWNER COUNTER (flag still off by default)
  ├── existing customer/vehicle
  │   └── same-shop resolve + optional mileage update [DB transaction]
  └── new customer/vehicle
      └── upsert inside the same transaction
          └── createTicket [nested savepoint]
              ├── diagnostic job · A-tier
              ├── optional repair/maintenance job · B/C-tier
              ├── assigned profile OR null = truly open
              └── success → /tickets/[id]

VIN
  └── Decode VIN [API]
      ├── success → fill year/make/model/engine
      └── invalid/unavailable → explain; manual fields stay editable
```

## Error and rollback contract

- Route order: parse JSON → authenticate → paywall → shared intake rate limit → handler.
- Handler owns strict input validation and tenant checks. The route never queries customer, vehicle, profile, ticket, or job tables.
- `tier_confirmation_required` returns the warning needed for a single explicit `Assign anyway` retry.
- No success without `{ ticket }`; the UI never redirects from an error envelope.
- The outer transaction makes customer/vehicle resolution plus ticket/job creation all-or-nothing.

---

### Task 1: Claim and publish the counter-intake lane

**Files:**

- Create: `docs/strategy/2026-07-10-shop-os-phase-1-counter-intake-v2-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-ticket-detail-plan.md`

- [ ] Mark row 10 `in_progress` on `feat/shop-os-p1-counter-intake-v2` while preserving both owner gates.
- [ ] Record PR #120's completed merge/tree verification.
- [ ] Commit/push the approved design and open a draft PR before implementation.

---

### Task 2: Make the wrenching roster and workload truthful

**Files:**

- Modify: `lib/intake/team.ts`
- Modify: `components/vt/tech-selector/index.tsx`
- Modify: `components/vt/tech-selector/tech-selector.css`
- Modify: `tests/unit/intake-submit-tech-id.test.ts`
- Modify: `tests/unit/counter-intake.test.tsx`

- [ ] Write tests first for active non-null-tier roster membership, A/B/C labels, ticket-job + ticketless-session workload, linked-session de-duplication, degradation, and solo open-queue behavior.
- [ ] Verify RED against the legacy session-only query and inert solo selector.
- [ ] Return `skillTier` with each member; count open/today assigned ticket jobs plus only legacy sessions with no linked ticket job.
- [ ] Keep workload best-effort while roster failures remain fatal; preserve current-user pinning and deterministic sort.
- [ ] Make one-member selection truthful: default Open queue, allow assigning the sole profile, and allow clearing back to Open.
- [ ] Render compact A/B/C tier labels without changing the selector's keyboard/listbox behavior.
- [ ] Run the focused roster/selector suites, TypeScript, and independent task review; commit only after approval.

---

### Task 3: Create the atomic counter-ticket handler and thin route

**Files:**

- Create: `lib/intake/counter-ticket.ts`
- Create: `app/api/tickets/counter/route.ts`
- Create: `tests/unit/shop-os-counter-ticket.test.ts`
- Create: `tests/unit/shop-os-counter-ticket-route.test.ts`

- [ ] Write PGlite tests first for new/existing vehicle paths, diagnostic + maintenance fixture, full concern, structured authorization, true-open, assigned, below-tier confirmation, cross-shop/missing/invalid inputs, mileage update, and full rollback.
- [ ] Verify RED because the handler/route do not exist.
- [ ] Validate a strict discriminated new-vs-existing body; parse optional authorization dollars to integer cents without floating-point rounding.
- [ ] Resolve/upsert customer and vehicle inside one transaction; update only existing mileage when supplied.
- [ ] Call row-8 `createTicket` inside the transaction and return its exact safe projection/warning.
- [ ] Keep the route thin: parse → auth → paywall → shared rate limit → actor translation → handler → status/envelope mapping.
- [ ] Prove `/api/intake/submit` and legacy session creation are untouched.
- [ ] Run focused handler/route suites, TypeScript, and independent task review; commit only after approval.

---

### Task 4: Wire the honest counter UI test-first

**Files:**

- Modify: `components/screens/counter-intake.tsx`
- Modify: `tests/unit/counter-intake.test.tsx`
- Modify: `tests/unit/intake-page-wiring.test.tsx`

- [ ] Write DOM tests first for VIN decode success/invalid/unavailable, editable decoded fields, primary diagnostic job, optional repair/maintenance job, structured authorization, true-open body, assigned body, below-tier confirmation, error envelopes, and ticket redirect.
- [ ] Verify RED against the current dead decode copy, free-text authorization, legacy endpoint, and session redirect.
- [ ] Add a real 44px `Decode VIN` control with busy/error/status semantics and no auto-fill claim before a successful response.
- [ ] Replace free-text authorization with optional amount/note fields and keep repair approval language absent.
- [ ] Always send one diagnostic job from the concern; optionally add one requested repair/maintenance job through a small explicit service field.
- [ ] POST `/api/tickets/counter`, keep `assignedTechId: null` for Open, support one explicit below-tier confirmation retry, and redirect only to `/tickets/${ticket.id}`.
- [ ] Preserve existing search, new/existing customer paths, discard/cancel behavior, required-field parity, calm copy, and default-off layout gate.
- [ ] Run all counter/intake-focused DOM tests, TypeScript, and independent task review; commit only after approval.

---

### Task 5: Verify, review, reconcile, and ship row 10

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-counter-intake-v2-plan.md`

- [ ] Run all row-10 focused tests, `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check`; record exact counts.
- [ ] Inspect desktop and 375px layout, keyboard/focus, decode/error/status announcements, Open assignment, below-tier confirmation, and ticket redirect through the required browser accessibility workflow when Chrome is available.
- [ ] Inspect the full diff for early session creation, engine changes, cross-shop reads, non-atomic customer/vehicle writes, advisor fallback, free-text money, fake controls, unrelated changes, and intent drift.
- [ ] Obtain independent task reviews and one whole-branch review; resolve every Critical/Important finding and re-review.
- [ ] Add the Phase-1 counter-intake implementation correction, mark row 10 complete, and preserve row 6 plus feature enablement as owner gates.
- [ ] Push the final head, wait for GitHub checks, mark the PR ready, squash-merge, verify `origin/main` matches the merged tree, and immediately continue the next dependency-safe row.

## Verification

```bash
pnpm test tests/unit/intake-submit-tech-id.test.ts tests/unit/counter-intake.test.tsx tests/unit/intake-page-wiring.test.tsx tests/unit/shop-os-counter-ticket.test.ts tests/unit/shop-os-counter-ticket-route.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```
