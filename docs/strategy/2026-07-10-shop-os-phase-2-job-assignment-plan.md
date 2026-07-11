# Shop OS Phase-2 Atomic Job Assignment Implementation Plan

**Goal:** Give Shop OS one tenant-safe mutation contract for claiming, unclaiming, and reassigning an open ticket job before row 14 exposes My Jobs/Open Jobs in Today.

**Approved design:** Add one domain handler and one thin authenticated route at `/api/tickets/[id]/jobs/[jobId]/assignment`. `claim` is self-only and succeeds through one conditional update only when the job is open and unassigned and the current active wrenching profile meets its required tier. `unclaim` is allowed to the current assignee or an advisor/owner. `reassign` is advisor/owner-only and reuses the canonical active same-shop tier validation plus explicit below-tier confirmation.

**Truth and race rules:**

- Every mutation requires the job to belong to the named same-shop ticket and have `workStatus='open'`; otherwise it fails closed.
- Claim sets `assignedTechId` to the actor and `claimedAt` to the database timestamp in the same update.
- Unclaim and advisor assignment clear `claimedAt`; assignment is not falsely called a self-claim.
- A losing claim returns a safe projection of the current assignee, not a generic conflict and never cross-tenant identity.
- Null-tier, insufficient-tier, pending, deactivated, unsupported-role, cross-shop, closed-ticket, non-open-job, malformed, and unauthorized mutations fail without writes.
- `reassign` below tier returns the existing structured warning and requires `confirmBelowTier=true`; no silent bypass.
- No work start/status transition, diagnostic bootstrap, quote/approval, Today UI, schema, migration, production, provider, or engine behavior changes.

## Task 1: Claim and publish row 13

- [x] Record PR #123 merge commit/tree equality and close row 12's final shipping checkbox.
- [x] Audit assignment capabilities, creation-time validation, ticket/job schema, API conventions, and Rev-4 race rules against current `main`.
- [x] Choose one domain seam and one route without adding schema or UI.
- [x] Commit/push this packet and open draft PR #124 before implementation.

## Task 2: Prove and build atomic assignment mutations

**Files:**

- Modify: `lib/tickets.ts`
- Create: `tests/unit/shop-os-job-assignment.test.ts`

- [x] Write failing tests first for eligible self-claim, exact `claimedAt`, self-unclaim, privileged unclaim, and privileged reassign.
- [x] Prove claim is one conditional update over same-shop ticket/job, open ticket/job state, null assignment, and active sufficient-tier actor.
- [x] Prove a sequential and concurrent losing claim returns the safe current assignee and never overwrites the winner.
- [x] Prove below-tier reassign warns, explicit confirmation succeeds, and assignment clears `claimedAt`.
- [x] Prove every tenant, role, membership, tier, ticket/job state, malformed-input, and authorization negative path leaves rows unchanged.
- [x] Return only the canonical safe ticket projection or safe conflict assignee; expose no profile user/shop fields.
- [x] Independently review the domain task; resolve the Important tier-confirmation TOCTOU finding through TDD and receive final approval with zero findings.

## Task 3: Add the thin assignment route

**Files:**

- Create: `app/api/tickets/[id]/jobs/[jobId]/assignment/route.ts`
- Create: `tests/unit/shop-os-job-assignment-route.test.ts`

- [x] Write failing tests for auth, paywall, invalid JSON, actor translation, every action result, warning envelope, and status mapping.
- [x] Keep the route auth → paywall → parse → domain; do not duplicate assignment policy in the route.
- [x] Return the updated safe ticket on success and the safe current assignee only on a losing claim.
- [x] Independently review the route task and receive approval with zero findings.

## Task 4: Verify, review, reconcile, and ship row 13

- [x] Run focused tests (4 files/67 tests), full suite (203 files/1,750 tests), TypeScript, production build, and diff check; all pass.
- [x] Inspect the complete diff for non-atomic writes, identity leaks, tier/tenant bypass, work-start drift, and unrelated changes; none remain.
- [x] Obtain two task reviews and one whole-branch review; resolve two Important tier-confirmation and supported-target-role TOCTOU findings through TDD and receive final approvals with zero findings.
- [x] Add the Phase-2 assignment implementation correction, mark row 13 complete, preserve every owner gate, and identify row 14 as next.
- [x] Push final head, pass GitGuardian/Vercel, mark ready, and squash-merge PR #124 as `7a0b49dbd44a859eb14b6a6999677b8cf1dac890`; reviewed and merged trees both equal `c3dfd57d82762194ac2f7ef4f5aa40353f85d8bb`, then continue row 14.

## Verification

```bash
pnpm test tests/unit/shop-os-job-assignment.test.ts tests/unit/shop-os-job-assignment-route.test.ts tests/unit/shop-os-tickets-access.test.ts tests/unit/shop-os-ticket-routes.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before any production data/schema write, external credential/account action, spend, feature enablement, or irreversible operation.
- Stop if atomic claim requires schema or if assignment cannot remain separate from row-15 diagnostic start.
- Stop if a safe losing-racer response would require exposing fields outside the canonical profile projection.
