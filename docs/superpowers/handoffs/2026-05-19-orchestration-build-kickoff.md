# Vyntechs Orchestration Build — Kickoff

**Trigger phrases:** "orchestration build" · "diagnostic orchestration storage" · "skill build for diagnostic pre-fill" · anything referencing Option D / relational nodes-and-edges storage

**One-line for Brandon's paste:**

```
Resume from docs/superpowers/handoffs/2026-05-19-orchestration-build-kickoff.md
```

---

## What this is

The 4-prompt diagnostic orchestration design (Prompts 1, 2, 3, 4A) is cold-context validated and the design package is committed to the `staging-interactive-diagnostics` branch. The DB stack decision is locked: **Option D — relational nodes-and-edges tables in the existing Supabase Postgres**. Next phase is the build.

## State as of 2026-05-19

| Thing | Where |
|---|---|
| Integration branch | `origin/staging-interactive-diagnostics` |
| Validation report | `docs/interactive-diagnostics/validation-2026-05-19-orchestration.md` |
| Design package | `docs/interactive-diagnostics/` (prompts, architecture, graph schema, layouts, reference renders) |
| Live Vyntechs project | Supabase project `ynmtszuybeenjbigxdyl` (ACTIVE — handle with care, no writes without per-op approval) |
| Local rehearsal DB | `vyntechs_rehearsal` (mirrors prod schema — rehearse migrations here first) |

## What's locked

- **All 4 prompts dialed** with two architectural fixes applied during validation: Prompt 1 closing-line count enumeration; Prompt 2 opacity-not-stated = GAP. The second one is load-bearing for Prompt 3's OBSERVABILITY HALT.
- **One known minor:** Prompt 1 closing-line off-by-1 count tally. Noise floor of LLM counting. Documented and accepted.
- **Storage primitive:** Option D — relational tables in Supabase Postgres. NOT Apache AGE (Supabase doesn't support it), NOT Neo4j (deferred until query patterns demand it). Tables for nodes (Platform, Component, TestAction, Symptom, BranchLogic, TechOutcome, DiagnosticSession, ArchitectureFact, ObservableProperty) and tables for edges (EQUIVALENT_FOR_SYSTEM, CONNECTS_TO, IMPLICATES_TEST, HAS_BRANCH, ROUTES_TO, PROBES, OUTCOME_OF, RESOLVED_BY, etc.) with foreign-key relationships. Compounding-database effect preserved via shared-FK references.

## What's NOT locked (still to decide before any code)

1. **Smallest-viable-test scope** — Brandon's call:
   - Which **platform** to seed first? (Suggested: 2018 F-250 6.7L PSD — canonical case used throughout the design package.)
   - Which **system** to seed first? (Suggested: fuel system — the reference prototype already exists.)
   - Which **three symptoms** to test against? (Suggested: P0087 fuel rail too low, P0088 fuel rail too high, no-start cranks normally. But Brandon owns the call.)
2. **Schema naming conventions** — singular vs plural table names; whether to use `created_at` / `updated_at` on graph nodes; how to handle the source provenance tagging (separate column vs JSONB field).
3. **Whether to seed any sample data into the live DB during the smallest-viable-test phase**, or keep all live-DB seeding gated behind manual per-op approval for each insert.

## Build phases (in order)

### Phase 1 — Schema design + migration

**Scope:** Translate `docs/interactive-diagnostics/graph-schema.md` into relational tables. Write the migration SQL. Rehearse on `vyntechs_rehearsal` local DB. Apply to live Supabase via MCP `apply_migration` ONLY with explicit per-op approval.

**Likely shape (subject to brainstorming):**

- One table per node type (platforms, components, test_actions, symptoms, branch_logic, tech_outcomes, diagnostic_sessions, architecture_facts, observable_properties)
- One table per edge type, with composite foreign keys (platform_equivalents, component_connections, symptom_test_implications, test_action_branches, branch_routes, tech_outcome_origins, etc.)
- RLS policies matching existing shop-scoping patterns (every node owned by a shop_id; cross-shop visibility through explicit equivalence edges, not row-level reads)
- Indexes on every FK plus the lookup-by-platform-and-symptom path

**Prerequisites:** Brainstorming session with Brandon to lock the table layout in plain English BEFORE any SQL is written. Mirrors how the knowledge platform schema (PR #63) was planned.

**Migration application discipline:**
1. Write SQL in `drizzle/migrations/NNNN_<name>.sql` so the schema change is in source control
2. Rehearse on `vyntechs_rehearsal` local — verify migration applies cleanly, schema looks right, no surprise locks
3. Surface to Brandon for explicit per-op approval
4. Apply via Supabase MCP `apply_migration` after approval
5. Run MCP `get_advisors` after to catch new lints (unindexed FKs, missing RLS, etc.)

### Phase 2 — Smallest viable test (end-to-end, against the live DB)

**Scope:** Manually orchestrate the 4-prompt chain against the real Supabase. ONE platform, ONE system, THREE symptoms. Verify:

1. **Prompt 1 → graph mutations land correctly.** Run Prompt 1 with the seeded vehicle+system input. Vet the output with Brandon. Apply the resulting `architecture_facts` + `platforms` rows.
2. **Prompt 2 → component nodes + observability profiles + edges land correctly.** Brandon narrates the system. Prompt 2 produces structured model. Apply the resulting `components`, `observable_properties`, and `component_connections` rows.
3. **Prompt 3 → test actions + branch logic land correctly per symptom.** Run Prompt 3 against each of the three symptoms. Verify the diagnostic path renders from a graph query (manual SQL at this stage; rendering layer comes later).
4. **Cached diagnostic serves on repeat request.** Run the same vehicle+symptom a second time; verify the chain does NOT regenerate — the query returns the existing test sequence.
5. **Prompt 4A → equivalence edges form correctly.** Run 4A with the source diagnostic + 2-3 candidate vehicles. Apply the resulting `platform_equivalents` rows. Verify the cached-diagnostic query traverses the edge correctly for an equivalent vehicle.
6. **Field outcomes write back.** Manually simulate a tech completing a test. Apply a `tech_outcomes` row. Verify it attaches to the correct `test_action_id` and accumulates with future outcomes on the same test.

**Critical gate:** This phase MUST complete successfully before Phase 3 starts. The validation report's "What was NOT tested" section explicitly calls this out — the prompts were validated in isolation; this is where the chain is exercised against real storage for the first time.

### Phase 3 — Claude Code skill for database pre-fill

**Scope:** A Claude Code skill (`.claude/skills/` or similar) that wraps the 4-prompt chain. Brandon invokes it with a vehicle + system; it runs Prompts 1 and 2 (with user-vet step between), produces structured outputs, and writes the resulting nodes/edges to Supabase via the established migration API.

**The skill uses Brandon's Claude Code subscription** — not paid API calls — so seeding new platforms doesn't burn API credits. This is the operational lever that lets the database grow without scaling cost linearly with case volume.

**Prerequisites:** Phase 2 must be complete. The schema must be live in Supabase. The graph mutation operations must have been tested manually first. The skill is a wrapper around proven operations, not a substitute for them.

## Hard constraints (carry forward, apply to ALL phases)

- **No writes to live Supabase without explicit per-op approval from Brandon.** Reads are fine. Schema migrations go through rehearsal + approval cycle described above.
- **Brandon merges PRs himself.** Don't merge.
- **PRs target `staging-interactive-diagnostics`** (this branch), not `main`. Don't push to main.
- **Cut new feature branches off this branch**, not off main. Each feature PR is small and merges back here.
- **Brandon is the non-engineer founder.** Plain-English check-ins at every phase boundary. No SQL / Drizzle / TypeScript jargon when surfacing decisions for his call. Reserve technical detail for the spec doc artifact.
- **Mobile validation required** when UI surfaces appear later. Not yet relevant.

## Branch state

- Branch `staging-interactive-diagnostics` cut from `origin/main` (commit `0719249` — bone-paper landing v2).
- Two commits applied:
  1. `docs(interactive-diagnostics): import 4-prompt orchestration design package` — full design package import
  2. `docs(interactive-diagnostics): add prompt orchestration validation report` — 2026-05-19 validation report
- Branch pushed to `origin/staging-interactive-diagnostics`. No PR opened against `main` (this branch is the integration target, not a feature branch awaiting merge).

## Reference

- **Validation report (primary):** `docs/interactive-diagnostics/validation-2026-05-19-orchestration.md`
- **Design package README:** `docs/interactive-diagnostics/README.md`
- **Graph schema (Cypher-form, translate to relational):** `docs/interactive-diagnostics/graph-schema.md`
- **Architecture (4-prompt orchestration):** `docs/interactive-diagnostics/architecture.md`
- **Final validation context (Brandon's overnight pass):** `docs/interactive-diagnostics/validation-final.md`
- **Prompts (the dialed versions):** `docs/interactive-diagnostics/prompts/`
- **METER layout spec (locked):** `docs/interactive-diagnostics/layouts/layout-meter.md`
- **Reference renders:** `docs/interactive-diagnostics/reference/`

## What to do first when resuming

1. Read this kickoff doc.
2. Read the validation report (`docs/interactive-diagnostics/validation-2026-05-19-orchestration.md`) for the full context of what was validated and what wasn't.
3. Ask Brandon to lock the smallest-viable-test scope (platform / system / three symptoms).
4. Invoke `superpowers:brainstorming` to design the Phase 1 schema with him in plain English.
5. Write the schema spec, get his approval, then move to migration SQL.

Do NOT skip to Phase 3 (skill build) before Phase 2 completes. The smallest-viable-test against the real database is the gate. Skipping it means wiring assumptions that haven't been tested under live conditions.
