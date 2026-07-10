# Shop OS Phase-1 Ticket/Job Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for every behavior change and `superpowers:subagent-driven-development` for task execution and review. This packet is subordinate to `2026-07-10-shop-os-spec-and-phased-plan.md`.

**Goal:** Ship the tenant-safe ticket/job domain contract needed by the Phase-1 ticket read surface, counter intake, quick quote, and provisional diagnostic wrapper without implementing those downstream UI or engine-seam rows.

**Architecture:** Keep one narrow domain module, `lib/tickets.ts`, as the authority for ticket creation, job addition, ticket-detail reads, validation, access gates, and HTTP status mapping. Thin Next.js route shims authenticate, enforce the existing paywall, translate the profile into a domain actor, call the injected-database handler, and return its discriminated result. Ticket creation and ticket-number allocation happen in one database transaction; no route writes directly to `tickets`, `ticket_jobs`, or `shops`.

**Tech Stack:** TypeScript 6, Zod 4, Drizzle ORM 0.45, PostgreSQL/PGlite, Next.js 16 route handlers, Vitest 4.

## Global constraints

- Do not apply migrations or write to production Supabase; row 6 remains the production owner gate.
- Do not change schema, diagnostic prompts, risk/gating, retrieval, topology, session initialization, repair/close behavior, or engine output semantics.
- Use `lib/tickets.ts` handlers with `db: AppDb` injection and thin `app/api/tickets/**/route.ts` shims; route files do not contain domain SQL.
- Only active, non-deactivated profiles with a supported Shop OS role may use this domain. Same-shop active profiles may read tickets and create open tickets/jobs; cross-shop reads and writes return `not_found` without disclosing existence.
- `counter` and `quick_quote` require a same-shop customer and that customer's vehicle. `tech_quick` requires both customer and vehicle to be null until reconciliation.
- Ticket creation requires one to 25 jobs and allocates one positive `(shopId, ticketNumber)` atomically by incrementing `shops.nextTicketNumber` inside the same transaction as ticket/job inserts.
- Clients cannot set ticket status, work status, approval state, session linkage, diagnostic-start state, timestamps, or ticket numbers.
- Job kinds are exactly `diagnostic|repair|maintenance`; required skill tier is exactly `1|2|3`; titles and concerns are trimmed and bounded.
- Open work persists `assignedTechId = null`. Any non-null initial assignment must reference an active, non-deactivated, non-null-tier profile in the same shop.
- An active shop-role actor may assign themselves only when their tier meets the job requirement. Assigning another profile requires `canAssignWork`. A below-tier assignment by advisor/owner returns `tier_confirmation_required` until explicitly resubmitted with confirmation.
- Adding a job is allowed only while the ticket is open. Ticket close/cancel/delivery, claim/reassign, UI, diagnostic bootstrap, and quote behavior remain owned by later rows.
- The read contract exposes customer/vehicle ticket context and safe assignee display fields, but never profile user IDs, billing flags, membership timestamps, or diagnostic session internals.

---

### Task 1: Claim and publish the ticket-domain lane

**Files:**

- Create: `docs/strategy/2026-07-10-shop-os-phase-1-ticket-api-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`

**Interfaces:**

- Produces: row 8 owned by `feat/shop-os-p1-ticket-api`; row 6 remains `owner_gate`.

- [x] Record row 8 as `in_progress` with branch `feat/shop-os-p1-ticket-api`.
- [x] Commit this execution packet and status claim.
- [x] Push the branch and open draft PR #119 against `main` before production-code edits.

---

### Task 2: Build atomic ticket creation test-first

**Files:**

- Create: `lib/tickets.ts`
- Create: `tests/unit/shop-os-tickets-create.test.ts`

**Interfaces:**

```ts
export type TicketActor = {
  profileId: string
  shopId: string | null
  role: string
  skillTier: number | null
  membershipStatus: string
  deactivatedAt: Date | null
}

export type TicketDomainError =
  | 'forbidden'
  | 'no_shop'
  | 'inactive_profile'
  | 'invalid_input'
  | 'not_found'
  | 'invalid_assignee'
  | 'tier_confirmation_required'
  | 'ticket_not_open'

export type AssignmentTierWarning = {
  code: 'below_required_tier'
  assignedTechId: string
  assignedSkillTier: 1 | 2 | 3
  requiredSkillTier: 1 | 2 | 3
}

export type CreateTicketResult =
  | { ok: true; ticket: TicketDetail }
  | { ok: false; error: TicketDomainError; warning?: AssignmentTierWarning }

export async function createTicket(
  db: AppDb,
  input: { actor: TicketActor; body: unknown },
): Promise<CreateTicketResult>
```

The accepted body is:

```ts
{
  source: 'counter' | 'tech_quick' | 'quick_quote'
  customerId: string | null
  vehicleId: string | null
  concern: string
  whenStarted?: string | null
  howOften?: string | null
  diagnosticAuthorizedCents?: number | null
  diagnosticAuthorizationNote?: string | null
  jobs: Array<{
    title: string
    kind: 'diagnostic' | 'repair' | 'maintenance'
    requiredSkillTier: 1 | 2 | 3
    assignedTechId?: string | null
    confirmBelowTier?: boolean
  }>
}
```

- [x] Write PGlite tests for active tech/advisor/parts/owner creation, unsupported/pending/deactivated/no-shop actors, and invalid body fields.
- [x] Verify RED because `lib/tickets.ts` does not exist.
- [x] Add Zod validation that trims concern/title/optional text, limits concern to 5,000 characters, job title to 200, optional context fields to 1,000, authorization note to 2,000, and rejects unsafe or negative authorization cents.
- [x] Prove non-`tech_quick` creation rejects missing/mismatched/cross-shop customer/vehicle pairs and `tech_quick` rejects either non-null field.
- [x] Prove open assignment remains null, self-assignment requires sufficient active tier, assigning another requires `canAssignWork`, and below-tier advisor/owner assignment requires explicit confirmation.
- [x] Prove concurrent same-shop creates receive distinct consecutive ticket numbers and different shops maintain independent sequences.
- [x] Implement one transaction that atomically increments `shops.nextTicketNumber`, inserts the ticket, inserts all jobs, and returns the canonical read contract through one private safe-projection loader; Task 3 adds the actor-gated exported read wrapper around that loader.
- [x] Run `pnpm test tests/unit/shop-os-tickets-create.test.ts`; verify GREEN.
- [x] Commit only the creation handler and focused tests.

---

### Task 3: Add job mutation and safe ticket-detail query test-first

**Files:**

- Modify: `lib/tickets.ts`
- Create: `tests/unit/shop-os-tickets-access.test.ts`

**Interfaces:**

```ts
export type TicketDetail = {
  id: string
  ticketNumber: number
  source: string
  status: string
  concern: string
  whenStarted: string | null
  howOften: string | null
  diagnosticAuthorizedCents: number | null
  diagnosticAuthorizationNote: string | null
  customer: { id: string; name: string; phone: string; email: string | null } | null
  vehicle: {
    id: string
    year: number
    make: string
    model: string
    engine: string | null
    vin: string | null
    mileage: number | null
    plate: string | null
  } | null
  jobs: Array<{
    id: string
    title: string
    kind: string
    requiredSkillTier: number
    assignedTechId: string | null
    assignedTech: {
      id: string
      fullName: string | null
      role: string
      skillTier: number | null
    } | null
    sessionId: string | null
    workStatus: string
    approvalState: string
    workNotes: string | null
    diagnosticStartState: string
    diagnosticStartErrorCode: string | null
    createdAt: Date
    updatedAt: Date
  }>
  createdAt: Date
  updatedAt: Date
}

export async function getTicketDetail(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown },
): Promise<{ ok: true; ticket: TicketDetail } | { ok: false; error: TicketDomainError }>

export async function addTicketJob(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown; body: unknown },
): Promise<{ ok: true; ticket: TicketDetail } | { ok: false; error: TicketDomainError; warning?: AssignmentTierWarning }>
```

- [x] Write PGlite tests proving every active Shop OS role can read a same-shop ticket and add a job to an open ticket.
- [x] Verify RED because the read/add exports are absent.
- [x] Prove unsupported, pending, deactivated, and no-shop actors are rejected before data access.
- [x] Prove malformed IDs return validation errors; missing and cross-shop ticket IDs both return `not_found`.
- [x] Prove adding to closed/canceled tickets returns `ticket_not_open` without mutation.
- [x] Reuse the exact assignment validator from creation; do not duplicate role/tier rules.
- [x] Return jobs in stable `createdAt`, then `id` order and expose only the safe `TicketDetail` projection.
- [x] Run `pnpm test tests/unit/shop-os-tickets-create.test.ts tests/unit/shop-os-tickets-access.test.ts`; verify GREEN.
- [x] Commit the access query, add-job mutation, and focused tests.

---

### Task 4: Wire thin ticket route shims and HTTP access tests

**Files:**

- Modify: `lib/tickets.ts`
- Create: `app/api/tickets/route.ts`
- Create: `app/api/tickets/[id]/route.ts`
- Create: `app/api/tickets/[id]/jobs/route.ts`
- Create: `tests/unit/shop-os-ticket-routes.test.ts`

**Interfaces:**

- `POST /api/tickets` calls `createTicket` and returns `201` with `{ticket}`.
- `GET /api/tickets/:id` calls `getTicketDetail` and returns `200` with `{ticket}`.
- `POST /api/tickets/:id/jobs` calls `addTicketJob` and returns `201` with `{ticket}`.
- All routes call `requireUserAndProfile`, return `401 {error:'unauthenticated'}` when absent, then call the existing `paywallReject` before the domain handler.
- `ticketActorFromProfile` maps the authenticated profile's `id`, `shopId`, `role`, `skillTier`, `membershipStatus`, and `deactivatedAt` once; route files do not duplicate that mapping.
- `ticketDomainStatus(result, successStatus)` maps validation to 422, forbidden/no-shop/inactive to 403, not-found to 404, tier confirmation/ticket-not-open to 409, and successful create/add to the caller-supplied status.

- [x] Write route tests first for authentication, paywall short-circuit, body parsing, actor translation, status mapping, route parameter forwarding, and success JSON.
- [x] Verify RED because the three route modules do not exist.
- [x] Add the three route shims without direct Drizzle table imports or business validation.
- [x] Ensure invalid JSON returns `400 {error:'invalid_json'}` before calling a mutation handler.
- [x] Run `pnpm test tests/unit/shop-os-ticket-routes.test.ts`; verify GREEN.
- [x] Run all three row-8 focused test files together and commit the route slice.

---

### Task 5: Reconcile the durable plan and prove the complete row

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-ticket-api-plan.md`

**Interfaces:**

- Produces: row 8 `complete` with PR/proof; rows 9, 11, 12, and 13 become eligible but remain unclaimed; row 6 remains `owner_gate`.

- [ ] Run the focused row-8 suite and record exact file/test counts.
- [ ] Run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check`.
- [ ] Inspect the full branch diff for unrelated files, engine-semantic changes, schema changes, direct route SQL, unsafe data exposure, and status drift.
- [ ] Obtain independent task reviews plus one whole-branch review; resolve every Critical/Important finding and re-review.
- [ ] Update the Phase-1 implementation correction with exact proof and the explicit no-production/no-engine boundary.
- [ ] Mark row 8 complete only after all verification and review evidence exists.
- [ ] Push the final head, wait for GitHub checks, mark the PR ready, squash-merge, verify `origin/main` matches the merged tree, and immediately continue the next dependency-safe row.

## Verification

```bash
pnpm test tests/unit/shop-os-tickets-create.test.ts tests/unit/shop-os-tickets-access.test.ts tests/unit/shop-os-ticket-routes.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```
