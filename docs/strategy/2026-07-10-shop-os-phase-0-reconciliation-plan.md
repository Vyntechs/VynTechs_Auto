# Shop OS Phase-0 Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:test-driven-development` for the SQL rehearsal and `supabase:supabase` for every live-schema check. This packet is subordinate to `2026-07-10-shop-os-spec-and-phased-plan.md`.

**Goal:** Prove a reversible migration from the two live predecessor Shop OS schemas to the approved `tickets` + `ticket_jobs` foundation without touching production.

**Architecture:** Two SQL drafts run transactionally against a PGlite fixture that mirrors the exact live predecessor schema. The forward draft fails closed unless the v2 tables are empty, its added customer/vehicle fields remain default-only, legacy repair-order relationships are tenant-consistent, and every repair order has exactly one linked session. The rollback draft restores the predecessor schema and original IDs, and is valid only before the application writes non-legacy canonical tickets.

**Tech stack:** PostgreSQL 17-compatible SQL, PGlite 0.4, Vitest 4, Drizzle test conventions, Supabase MCP read-only inspection.

## Global constraints

- Do not call Supabase `apply_migration`; production application remains status row 6 `owner_gate`.
- Do not add the drafts to `drizzle/migrations/`; Phase 1 row 5 promotes the reviewed SQL into the official Drizzle schema/migration.
- Preserve the existing `repair_orders.id` as the canonical `tickets.id` so rollback can restore the exact row identity.
- Preserve the linked `sessions.id`; the canonical job points outward to it and the session row is not rewritten.
- Never translate `customers.preferred_channel='sms'` or `opt_ins={}` into consent.
- Preserve source-controlled `vehicles.platform_id`; retire only the live-only, all-null `vehicles.diesel_context` field.
- New canonical tables are server-only: RLS enabled, direct `anon`/`authenticated` DML revoked, explicit deny-all policies present.
- Commit, push, PR creation, production DDL, customer writes, and external spend are outside this packet.

---

### Task 1: Lock the approved live preconditions into a failing test

**Files:**

- Create: `tests/unit/shop-os-reconciliation-draft.test.ts`
- Read: `docs/strategy/sql/2026-07-10-shop-os-reconciliation-forward.sql`
- Read: `docs/strategy/sql/2026-07-10-shop-os-reconciliation-rollback.sql`

**Interfaces:**

- `createLegacyDb(): Promise<PGlite>` creates the representative predecessor schema and one tenant-consistent repair order/session.
- `readDraft(name: 'forward' | 'rollback'): Promise<string>` reads the exact SQL draft.
- `tableExists(db, table): Promise<boolean>` verifies schema state without Drizzle declarations.

- [x] Write the test fixture with fixed UUIDs and these live facts:

```ts
const IDS = {
  shop: '00000000-0000-0000-0000-000000000001',
  owner: '00000000-0000-0000-0000-000000000002',
  tech: '00000000-0000-0000-0000-000000000003',
  customer: '00000000-0000-0000-0000-000000000004',
  vehicle: '00000000-0000-0000-0000-000000000005',
  repairOrder: '00000000-0000-0000-0000-000000000006',
  session: '00000000-0000-0000-0000-000000000007',
} as const
```

- [x] Add a forward test asserting:
  - `tickets` and `ticket_jobs` exist;
  - one ticket preserves `repair_orders.id`, tenant, customer, vehicle, opener, timestamps, status, and session complaint;
  - one diagnostic job preserves the linked session and assigned technician;
  - `shops.next_ticket_number` advances past the imported ticket number;
  - all predecessor tables/columns are absent;
  - `vehicles.platform_id` remains;
  - RLS and explicit server-only policies are present.
- [x] Add failure-path tests for nonempty v2 tables, non-default consent-like fields, cross-tenant legacy links, and an unlinked/multiply-linked repair order.
- [x] Add a rollback test asserting the exact repair-order ID/session link and predecessor columns/tables return while canonical tables/columns disappear.
- [x] Run:

```bash
npx --yes pnpm@10 test tests/unit/shop-os-reconciliation-draft.test.ts
```

Expected: fail because both SQL draft files are absent.

---

### Task 2: Write the minimal forward SQL draft

**Files:**

- Create: `docs/strategy/sql/2026-07-10-shop-os-reconciliation-forward.sql`
- Test: `tests/unit/shop-os-reconciliation-draft.test.ts`

**Interfaces:**

- Consumes the exact predecessor schema from live migrations `20260517134921` and `20260610181258`.
- Produces Phase-1 foundation tables `tickets` and `ticket_jobs`, `shops.next_ticket_number`, and `profiles.skill_tier`.

- [x] Add one transaction with precondition guards before DDL:

```sql
do $$
begin
  if exists (select 1 from work_orders)
     or exists (select 1 from concerns)
     or exists (select 1 from line_items)
     or exists (select 1 from authorizations)
     or exists (select 1 from outbound_messages) then
    raise exception 'shop_os_reconciliation:v2_tables_not_empty';
  end if;
end $$;
```

- [x] Add canonical tables with direct `shop_id`, composite same-shop FKs where the existing model permits them, unique session linkage, status/source checks, and deterministic ticket numbering.
- [x] Migrate each repair order into a ticket using the same UUID and one linked diagnostic job.
- [x] Advance `shops.next_ticket_number` per shop.
- [x] Enable RLS, revoke direct client DML, grant server-role DML, and add explicit false policies for `anon`/`authenticated`.
- [x] Drop only the validated predecessor objects and the all-default/all-null v2 fields.
- [x] Run the targeted test. Expected: forward, guard, and rollback tests still fail only because rollback is absent.

---

### Task 3: Write the exact rollback SQL draft

**Files:**

- Create: `docs/strategy/sql/2026-07-10-shop-os-reconciliation-rollback.sql`
- Test: `tests/unit/shop-os-reconciliation-draft.test.ts`

**Interfaces:**

- Consumes only canonical rows where `tickets.source='legacy_repair_order'` and refuses rollback if any other canonical ticket/job exists.
- Restores the exact schemas recorded in Supabase migration history, including numeric precision, FKs, indexes, RLS state, and default-only v2 columns.

- [x] Add a precondition that blocks rollback after any non-legacy canonical write.
- [x] Recreate `shop_mgmt_enabled`, `repair_orders`, the two legacy session columns, five v2 tables, two customer fields, and `vehicles.diesel_context`.
- [x] Restore repair orders with their original ticket UUIDs and restore session links from diagnostic jobs.
- [x] Drop canonical tables and helper indexes/columns only after restoration succeeds.
- [x] Run the targeted test. Expected: all reconciliation tests pass.

---

### Task 4: Reconcile durable documentation and status

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-audit.md`
- Modify: this packet

- [x] Record Brandon's approval in status row 2 as `complete`.
- [x] Mark row 3 `complete` only after both SQL drafts pass every local test; include the packet path in its claim field.
- [x] Keep row 6 `owner_gate`; do not imply production authorization.
- [x] Add the newly confirmed drift fields and sanitized live preconditions to the audit.
- [x] Mark all packet checkboxes complete only after their command output exists.

---

### Task 5: Verify the complete local slice

- [x] Run the targeted reconciliation test.
- [x] Run `npx --yes pnpm@10 test`.
- [x] Run `npx --yes pnpm@10 exec tsc --noEmit`.
- [x] Run `npx --yes pnpm@10 build`.
- [x] Run `git diff --check` and inspect every changed artifact.
- [x] Re-query live counts and migration history read-only; confirm no production migration was added and the predecessor counts are unchanged.
- [x] Stop at row 6. Production apply requires a separate explicit authorization after Brandon reviews the SQL and proof.
