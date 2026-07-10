# Shop OS Phase-1 Ticket Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for every behavior change and `supabase:supabase` for live checks. This packet is subordinate to `2026-07-10-shop-os-spec-and-phased-plan.md`.

**Goal:** Promote the approved Phase-0 ticket/job rehearsal into the source Drizzle schema and one official migration that works for both the clean source migration chain and the exact live predecessor state, without applying production DDL.

**Architecture:** `lib/db/schema.ts` declares the post-reconciliation canonical model. Migration `0026_shop_os_ticket_spine.sql` has two explicit entry states: a clean source database with no predecessor Shop OS objects, or the complete live predecessor schema guarded by the Phase-0 preservation checks. Partial or changed predecessor state aborts before DDL; the live path preserves the repair-order/session identity and the clean path creates an empty canonical spine.

**Tech Stack:** TypeScript 6, Drizzle ORM 0.45, PostgreSQL 17 SQL, PGlite 0.4, Vitest 4, Supabase read-only inspection.

## Global Constraints

- Do not call Supabase `apply_migration`; active-plan row 6 remains `owner_gate`.
- Do not change diagnostic prompts, gating, retrieval, topology behavior, or session semantics.
- Preserve `vehicles.platform_id` in both Drizzle schema and SQL.
- Keep `profiles.role` as text during this row because legacy curator behavior is migrated with row 7; add only nullable `skill_tier` here.
- Existing active `role='tech'` profiles receive tier 1; every other profile remains null.
- New canonical tables are server-only: RLS enabled, direct `anon`/`authenticated` DML revoked, explicit deny policies, `service_role` DML granted.
- Customer/vehicle may both be null only for `source='tech_quick'`; all other tickets require both.
- The official migration must be locally repeatable only through the normal one-time migration journal; its SQL aborts if canonical tables already exist.
- Commit, push, and a draft PR are allowed. Production DDL, customer writes, vendor applications, and spend are not.

---

### Task 1: Claim and publish the schema lane

**Files:**

- Create: `docs/strategy/2026-07-10-shop-os-phase-1-schema-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`

**Interfaces:**

- Produces: status row 5 owned by `feat/shop-os-p1-schema`; row 6 remains unchanged.

- [ ] Change row 5 from `pending` to `in_progress` with branch `feat/shop-os-p1-schema`.
- [ ] Keep row 6 as `owner_gate`.
- [ ] Commit the execution packet and status claim.
- [ ] Push the branch and open a draft PR against `main`.

---

### Task 2: Write failing source-schema and migration tests

**Files:**

- Create: `tests/unit/shop-os-ticket-spine-schema.test.ts`
- Modify: `tests/unit/shop-os-reconciliation-draft.test.ts`
- Test target: `drizzle/migrations/0026_shop_os_ticket_spine.sql`

**Interfaces:**

- Consumes: `createTestDb(): Promise<{db: TestDb; close(): Promise<void>}>` from `tests/helpers/db.ts`.
- Produces: schema contract for exports `tickets`, `ticketJobs`, `Ticket`, `NewTicket`, `TicketJob`, and `NewTicketJob`.
- Produces: one official SQL migration exercised by both the clean source chain and the live predecessor fixture.

- [ ] Add a clean-source test that calls `createTestDb()` and asserts `tickets`, `ticket_jobs`, `shops.next_ticket_number`, `profiles.skill_tier`, and `vehicles.platform_id` exist.
- [ ] Assert the clean path creates zero canonical rows and gives a seeded active tech tier 1 only when the migration has a predecessor profile to map.
- [ ] Change the Phase-0 forward rehearsal reader to load `drizzle/migrations/0026_shop_os_ticket_spine.sql`; keep rollback pointed at the reviewed rollback draft.
- [ ] Add a partial-predecessor test that creates only one predecessor table and expects `shop_os_reconciliation:partial_predecessor_schema`.
- [ ] Run `pnpm test tests/unit/shop-os-ticket-spine-schema.test.ts tests/unit/shop-os-reconciliation-draft.test.ts`.
- [ ] Verify RED: missing migration/schema exports or missing canonical tables; no unrelated failure.

---

### Task 3: Declare the canonical Drizzle schema

**Files:**

- Modify: `lib/db/schema.ts`
- Test: `tests/unit/shop-os-ticket-spine-schema.test.ts`

**Interfaces:**

- `shops.nextTicketNumber: number` maps to positive `bigint` default 1.
- `profiles.skillTier: number | null` maps to integer constrained to 1–3.
- `vehicles.platformId: string | null` maps to the existing `platforms.id` FK with `ON DELETE SET NULL`.
- `tickets` matches the Phase-0 SQL fields and constraints.
- `ticketJobs` matches the Phase-0 SQL fields and constraints.

- [ ] Import `bigint`, `check`, and `foreignKey` from `drizzle-orm/pg-core`.
- [ ] Add `nextTicketNumber` and its positive check to `shops`.
- [ ] Add nullable `skillTier` and its 1–3 check to `profiles` without narrowing `role`.
- [ ] Restore `vehicles.platformId` to the Drizzle declaration using the existing `AnyPgColumn` late-reference pattern and index.
- [ ] Add composite uniqueness needed for same-shop FKs on customers, profiles, vehicles, and sessions.
- [ ] Declare `tickets` with tenant/customer/vehicle/profile FKs, source/status checks, numbering uniqueness, and provisional-pair check.
- [ ] Declare `ticketJobs` with tenant ticket/assignee/session FKs, one-session uniqueness, skill/status/state checks, and claim/start indexes.
- [ ] Add relations and inferred select/insert types without changing existing engine relations.
- [ ] Run the focused tests and TypeScript; schema assertions may remain red only because migration 0026 is not written yet.

---

### Task 4: Promote the two-path official migration

**Files:**

- Create: `drizzle/migrations/0026_shop_os_ticket_spine.sql`
- Modify: `drizzle/migrations/meta/_journal.json`
- Reference: `docs/strategy/sql/2026-07-10-shop-os-reconciliation-forward.sql`
- Test: `tests/unit/shop-os-ticket-spine-schema.test.ts`
- Test: `tests/unit/shop-os-reconciliation-draft.test.ts`

**Interfaces:**

- Clean entry: all six predecessor tables and all predecessor-only columns are absent.
- Live entry: all six predecessor tables and predecessor-only columns are present and pass every Phase-0 guard.
- Any partial predecessor state raises `shop_os_reconciliation:partial_predecessor_schema` before DDL.
- Both successful entries produce identical empty-or-mapped canonical schema.

- [ ] Run `pnpm drizzle-kit generate --custom --name shop_os_ticket_spine` to create the journaled custom migration shell; rename only if the generated index is not `0026`.
- [ ] Add one transaction and a preflight `DO` block that distinguishes clean, complete-live, partial, and canonical-already-present states.
- [ ] Reuse every Phase-0 live data guard, including v2 emptiness, exact customer/vehicle/session defaults, tenant relationships, enabled-shop mapping, and exactly one linked session per repair order.
- [ ] Add canonical columns, helper indexes, tables, checks, FKs, RLS, policies, and grants.
- [ ] Run legacy row migration inside a conditional PL/pgSQL block so clean source databases never reference absent predecessor tables.
- [ ] Drop predecessor tables/columns with guarded `IF EXISTS` operations after mapping succeeds.
- [ ] Preserve `vehicles.platform_id` and its existing FK/index.
- [ ] Run the focused tests and verify GREEN for clean, complete-live, guard, and rollback cases.

---

### Task 5: Reconcile status and verify the local implementation slice

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-schema-plan.md`

**Interfaces:**

- Produces: row 5 `complete` with PR/proof; row 6 still `owner_gate`.

- [ ] Confirm the official migration diff contains no unrelated schema generated from stale snapshots.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm exec tsc --noEmit`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check` and inspect every changed artifact.
- [ ] Re-query live migration names/counts read-only and confirm no production state changed.
- [ ] Mark row 5 complete only after proof exists; keep row 6 `owner_gate`.
- [ ] Update the draft PR body with the exact checks and explicit no-production boundary.
