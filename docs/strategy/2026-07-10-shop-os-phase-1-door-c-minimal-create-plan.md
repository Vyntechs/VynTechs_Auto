# Shop OS Phase-1 Door C Minimal Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, and `frontend-design` task-by-task. Steps use checkbox syntax for durable progress. This packet is subordinate to `2026-07-10-shop-os-spec-and-phased-plan.md`.

**Goal:** Give every active Shop OS role an honest, fast Door C path that creates one real sessionless quick ticket with a required customer, vehicle, and repair or maintenance job, then redirects to the canonical ticket detail—without claiming a quote, approval, assignment, or diagnostic session exists.

**Approved design:** Rev 4 defines Door C as customer + vehicle + requested work with no diagnostic session unless work later needs one. Row 11 is deliberately the minimal ticket slice; row 19 owns lines, canned jobs, totals, and the completed quote flow. The UI calls a dedicated `/api/tickets/quick` seam because the generic row-8 route accepts existing IDs only and cannot atomically create a new customer/vehicle.

**Architecture:** A new injected `createQuickTicket(db, input)` handler strictly validates an existing-vs-new vehicle body, resolves or creates the customer/vehicle inside one transaction, and calls the row-8 `createTicket` handler through a nested savepoint. It creates exactly one unassigned repair (B-tier) or maintenance (C-tier) job with `source: quick_quote`; the requested-work description is also the ticket concern. A thin authenticated/paywalled/rate-limited route maps the result. A protected `/tickets/new` page reuses predictive customer/vehicle search, posts the minimal body, and redirects only from a returned ticket ID.

## Scope boundaries

- Do not add quote lines, prices, taxes, canned jobs, photos, approval, send, payment, assignment, claim, work-start, or diagnostic escalation. Rows 13–19 own those capabilities.
- Do not create or link a diagnostic session. Do not change `/api/intake/submit`, diagnostic prompts, retrieval, topology, gates, lock, repair, close, or engine output semantics.
- Do not change schema, migrations, production Supabase, the counter feature flag, or the owner-only counter route.
- Customer and vehicle are required. Existing vehicles resolve only through a same-shop customer; missing and cross-shop IDs fail closed.
- New customer/vehicle resolution plus ticket/job creation is all-or-nothing. Domain failure rolls back every new row.
- Requested work is one trimmed 1–200 character repair or maintenance description. It creates exactly one job, always `assignedTechId: null`; repair requires tier 2 and maintenance tier 1.
- `quick_quote` is the durable source enum, but product copy says **Quick ticket** until row 19 creates a real quote. No price, estimate, approval, autosave, or AI claim may appear.
- Every active paid Shop OS role may use Door C, matching `canCreateTickets`. The page and API still fail closed for pending, deactivated, no-shop, unauthenticated, or unpaid actors.
- Preserve existing tokens/fonts, calm imperative copy, visible focus, keyboard operation, 44px targets at every width, and intentional 375px stacking.

## Data flow

```text
QUICK TICKET
  ├── existing customer/vehicle
  │   └── same-shop resolve + optional mileage update [DB transaction]
  └── new customer/vehicle
      └── upsert inside the same transaction
          └── createTicket [nested savepoint]
              ├── source = quick_quote
              ├── one repair B-tier OR maintenance C-tier job
              ├── assignedTechId = null
              ├── no session, price, quote, or approval
              └── success → /tickets/[id]
```

---

### Task 1: Claim and publish the Door C lane

**Files:**

- Create: `docs/strategy/2026-07-10-shop-os-phase-1-door-c-minimal-create-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-counter-intake-v2-plan.md`

- [x] Record PR #121 merge commit/tree equality and close row 10's final shipping checkbox.
- [x] Mark row 11 `in_progress` on `feat/shop-os-p1-door-c-minimal-create` while preserving row 6 and counter enablement owner gates.
- [x] Commit/push this execution packet and open draft PR #122 before implementation.

### Task 2: Create the atomic quick-ticket handler and thin route

**Files:**

- Create: `lib/intake/quick-ticket.ts`
- Create: `app/api/tickets/quick/route.ts`
- Create: `tests/unit/shop-os-quick-ticket.test.ts`
- Create: `tests/unit/shop-os-quick-ticket-route.test.ts`

- [x] Write PGlite tests first for new/existing vehicle paths, repair/maintenance tiers, true-open assignment, exact source/concern, same-shop enforcement, role gates, input bounds, mileage update, and complete rollback.
- [x] Verify RED because the handler and route do not exist.
- [x] Validate a strict new-vs-existing body and resolve/upsert customer/vehicle inside one outer transaction.
- [x] Call canonical `createTicket` with one sessionless repair or maintenance job; throw a rollback sentinel for every domain failure.
- [x] Keep the route thin: auth → paywall → parse → shared intake rate limit → actor translation → handler → status/envelope mapping.
- [x] Prove no session, counter, engine, quote, schema, or production path changes.
- [x] Run 2 focused handler/route files (29/29), TypeScript, diff check, and independent review; approved with no findings.

### Task 3: Wire the honest quick-ticket surface test-first

**Files:**

- Create: `app/(app)/tickets/new/page.tsx`
- Create: `components/screens/quick-ticket.tsx`
- Create: `components/screens/quick-ticket.module.css`
- Modify: `components/screens/today-home.tsx`
- Modify: `app/(app)/today/page.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Create: `tests/unit/shop-os-quick-ticket-ui.test.tsx`
- Modify: `tests/unit/today-home.test.tsx`
- Modify: `tests/unit/shop-os-ticket-detail.test.tsx`

- [x] Write DOM/page tests first for role-visible entry, new/existing bodies, required work parity, repair/maintenance selection, true-open semantics, error envelopes, and ticket-only redirect.
- [x] Verify RED because `/tickets/new` and the quick-ticket surface do not exist.
- [x] Reuse predictive search; support same-shop existing vehicle selection and a minimal new customer/vehicle form.
- [x] Use honest **Quick ticket** copy and state that this step does not approve repair; do not render quote/price/AI/assignment theater.
- [x] POST only `/api/tickets/quick` and redirect only from `{ticket:{id}}` to `/tickets/${id}`.
- [x] Add a 44px Today entry for active Shop OS roles and label `quick_quote` tickets as **Quick ticket** on detail.
- [x] Preserve keyboard/focus behavior, handler-parity input bounds, entity-state resets, and intentional single-column 375px layout.
- [x] Run 3 Door C DOM files (38/38), TypeScript, diff check, and independent re-review; approved with no findings.

### Task 4: Verify, review, reconcile, and ship row 11

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-door-c-minimal-create-plan.md`

- [x] Run all row-11 focused tests (5 files/67 tests), full suite (198 files/1,668 tests), TypeScript, production build, and diff check; all pass.
- [x] Attempt the required signed-in Chrome workflow; Chrome was not running and no launch authority was granted, so CSS/static and DOM proof protect 375px layout, 44px targets, keyboard behavior, errors, and ticket-id-only redirect.
- [x] Inspect the full diff for sessions, diagnostic work, fake quote/approval claims, cross-shop reads, partial writes, assignment ceremony, unrelated changes, and intent drift; none found.
- [x] Obtain two task reviews and one whole-branch review; the UI task's three Important findings were resolved and re-reviewed, and the final branch review approved with zero findings.
- [x] Add the Phase-1 Door C implementation correction, mark row 11 complete, and preserve all production/external gates.
- [ ] Push final head, wait for GitHub checks, mark ready, squash-merge, verify `origin/main` tree equality, and immediately continue row 12.

## Verification

```bash
pnpm test tests/unit/shop-os-quick-ticket.test.ts tests/unit/shop-os-quick-ticket-route.test.ts tests/unit/shop-os-quick-ticket-ui.test.tsx tests/unit/today-home.test.tsx tests/unit/shop-os-ticket-detail.test.tsx
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```
