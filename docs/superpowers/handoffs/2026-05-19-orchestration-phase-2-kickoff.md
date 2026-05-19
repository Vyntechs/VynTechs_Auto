# Vyntechs Orchestration — Phase 2 Kickoff

**Trigger phrases:** "orchestration phase 2" · "smallest viable test for diagnostic orchestration" · "manual orchestration test" · anything referencing 2018 F-250 6.7L PSD seed run

**One-line for Brandon's paste:**

```
Resume from docs/superpowers/handoffs/2026-05-19-orchestration-phase-2-kickoff.md
```

---

## What this is

Phase 1 (schema migration) landed live on Supabase at the end of session 2026-05-19. Phase 2 is **manually running the 4-prompt orchestration chain end-to-end** against the live database, using the 2018 F-250 6.7L PSD canonical case. The goal is to verify the schema works under real conditions — that prompt outputs translate cleanly to graph inserts, that cached diagnostics serve correctly, that field outcomes write back, and that equivalence edges form.

Phase 2 is the gate for Phase 3 (Claude Code skill wrapper). Don't skip it.

## State as of end-of-session 2026-05-19

| Thing | Where |
|---|---|
| Integration branch | `origin/staging-interactive-diagnostics` (commit `b9918dc`) |
| Live Supabase project | `ynmtszuybeenjbigxdyl` (12 new tables live, RLS policies attached, all constraints in place) |
| Drizzle schema | `lib/db/schema.ts` (495 → 1022 lines, 12 new tables + `vehicles.platform_id`) |
| Migration | `drizzle/migrations/0017_diagnostic_orchestration.sql` (already applied to live) |
| Schema verification file | `drizzle/tests/0017_schema_verification.sql` (re-runnable; 14 assertion tests) |
| Spec | `docs/superpowers/specs/2026-05-19-orchestration-schema-design.md` |
| Plan (Phase 1) | `docs/superpowers/plans/2026-05-19-orchestration-schema-phase1.md` (all 4 tasks complete) |
| Design package | `docs/interactive-diagnostics/` (the 4 prompts, architecture, graph schema, layouts, reference renders) |
| Validation report | `docs/interactive-diagnostics/validation-2026-05-19-orchestration.md` |
| Original kickoff | `docs/superpowers/handoffs/2026-05-19-orchestration-build-kickoff.md` |

## What's locked from Phase 1

- **All 12 tables live with explicit cascade behavior on every FK.** Cascade types (CASCADE / RESTRICT / SET NULL) match the spec. No bare references.
- **RLS posture:** 4 policies each on `tech_outcomes` and `diagnostic_sessions` (insert/update/delete own-shop, select all authenticated). The 10 graph tables have RLS enabled-no-policy via Supabase's `rls_auto_enable()` trigger — consistent with every other table in the codebase. Service-role bypasses RLS.
- **Two-dimensional source tagging:** every fact-bearing row carries `source_provenance` (TRAINING-CONFIRMED / TRAINING-INFERRED / FIELD-VERIFIED / GAP) + `inference_class` (LAW / LOGIC / PATTERN, nullable).
- **Retirement pattern:** `is_retired` flag + `replaced_by_id` self-FK + retirement-invariant CHECK on every fact-bearing table. Append-new + retire-old for corrections.
- **Partial unique indexes** on slugs (fact-bearing node tables) and natural-identity tuples (junction tables), scoped to `is_retired = false`.
- **Canonical ordering** on `platform_equivalents` (CHECK `platform_a_id < platform_b_id`) — app code must reorder before INSERT.

## Phase 2 scope (the smallest viable test)

Run the 4-prompt chain manually for the canonical case. All 5 runs must complete cleanly:

1. **Run 1:** 2018 F-250 6.7L PSD + P0087 (cold start, full orchestration). Expect ~115 new rows across the 12 tables.
   - Prompt 1 → 1 `platforms` row + ~30 `architecture_facts` rows
   - Brandon vets the architecture-fact list; corrects errors; optionally flips GAPs to FIELD-VERIFIED
   - Prompt 2 → ~12 `components` + ~25 `observable_properties` + ~15 `component_connections`
   - Prompt 3 → 1 `symptoms` (P0087) + ~8 `test_actions` + ~6 `branch_logic` + ~8 `symptom_test_implications`
   - Simulated tech walk → 1 `diagnostic_sessions` + ~5 `tech_outcomes`

2. **Run 2:** Same vehicle + P0088. Prompts 1 & 2 skip (platform/components exist). Prompt 3 writes ~10 new rows.

3. **Run 3:** Same vehicle + no-start cranks normally. Same skip pattern as Run 2.

4. **Run 4:** 2019 F-350 + P0087 (different VIN, same architecture). Cache lookup via `platform_equivalents`; zero new rows.

5. **Run 5:** Real tech runs the cached diagnostic; records `tech_outcomes` rows; flips at least one GAP `observable_properties` row to FIELD-VERIFIED via the retirement pattern.

When all 5 pass, Phase 3 (Claude Code skill wrapper) is unblocked.

## Hard constraints (carry forward from Phase 1)

- **No writes to live Supabase without explicit per-op approval.** Reads are fine. Every INSERT during Phase 2 is gated. Brandon approves each batch.
- **Brandon merges PRs himself.** Don't merge `staging-interactive-diagnostics` to `main`.
- **`staging-interactive-diagnostics` is the integration target.** All Phase 2 PRs land here, not `main`. Branch stays open until Phase 1+2+3 all complete.
- **Brandon is non-engineer founder.** Plain-English check-ins at every phase boundary. No SQL/Drizzle/TypeScript jargon when surfacing decisions. Reserve technical detail for the spec/plan artifacts.
- **Mobile validation required** when UI surfaces appear (not relevant in Phase 2 — Phase 2 is server-side orchestration; UI lands in Phase 3).

## Workflow notes (things Phase 2 should know)

- **`pnpm drizzle-kit generate` is broken since the 0011b snapshot corruption.** Hand-write any new migrations and journal entries directly. The malformed snapshot has been the reality since migration 0012. A future cleanup PR could repair the snapshot to restore drizzle-kit automation — out of scope for orchestration work.
- **Verification file pattern (A+B combo).** When future migrations touch 0017's tables, add corresponding assertions to `drizzle/tests/0017_schema_verification.sql` (or a sibling 00XX_schema_verification.sql for new migrations). Re-runnable regression tests catch silent constraint drops.
- **The orphan `symptoms` table is gone from prod.** Migration 0017 dropped the legacy (`name TEXT PK, display_label, usage_count`) shape and recreated it with the orchestration shape (UUID PK, slug, description, category). Don't be confused by old design docs that referenced the legacy shape.
- **3 junction tables (`component_connections`, `symptom_test_implications`, `platform_equivalents`) have no Drizzle `relations()` exports.** Phase 2's manual orchestration uses raw SQL or `db.select()`, so this doesn't bite. If you later use `db.query.componentConnections.findFirst({ with: ... })`, add the relations blocks first.
- **`platform_equivalents` canonical ordering:** application code MUST reorder the two platform UUIDs (smaller as `platform_a_id`) before any INSERT, or the CHECK constraint fails. Phase 2 manual SQL should follow the same convention. Helper shape: `function canonicalPair(a, b) { return a < b ? [a, b] : [b, a] }`.

## Follow-ups recommended (optional, before or during Phase 2)

The final code review surfaced four small cleanups. None block Phase 2 from starting; each is small enough to do as a one-PR follow-up if it becomes useful.

1. **CI integration of the verification file.** Today `drizzle/tests/0017_schema_verification.sql` is a manual `psql -f` artifact. A small addition to the existing test pipeline (run via pglite or against the rehearsal DB on every PR) would catch accidental constraint drops on future migrations. Mechanical wiring; pick up when CI workflow gets touched next.
2. **Cover the 11 unindexed FK lints** with a small migration 0018: indexes on the 8 `replaced_by_id` self-FKs (partial: `WHERE replaced_by_id IS NOT NULL`) + `diagnostic_sessions.tech_id` + `diagnostic_sessions.resolved_component_id` + `tech_outcomes.tech_id`. Silences `get_advisors` performance INFO lints and may help per-tech dashboard queries.
3. **Decide on RLS allow-read policies for the 10 graph tables** during the Phase 2 brainstorm. Today they're RLS-enabled-no-policy (server-side service-role reads only). If Phase 2 or Phase 3 surfaces graph data to authenticated client sessions, add `SELECT TO authenticated USING (true)` policies. Cheap to add; awareness required.
4. **Add `relations()` exports for the 3 junction tables** IF Phase 2 wants to use Drizzle's typed-relations API on them. Skip if Phase 2 sticks to raw SQL / `db.select()`.

## What to do first when resuming

1. Read this kickoff doc.
2. Read the original kickoff (`docs/superpowers/handoffs/2026-05-19-orchestration-build-kickoff.md`) for the full multi-phase build context.
3. Confirm with Brandon that Phase 2's smallest-viable-test scope is still the F-250 6.7L PSD / fuel / 3 symptoms case (it should be; this was locked at the start of Phase 1).
4. Invoke `superpowers:brainstorming` to plan Phase 2 step-by-step. The brainstorm should produce a Phase 2 spec covering:
   - How to invoke each prompt manually (paste into Claude.ai chat? scripted call? Brandon's preference)
   - How to translate each prompt's structured output to SQL INSERT statements (the `INSERT ... ON CONFLICT (slug) DO UPDATE` pattern)
   - Where to surface the user-vet step between Prompt 1 and Prompt 2
   - How to simulate the tech-time outcomes step
   - Per-op approval discipline for every batch of inserts
5. Write a Phase 2 plan in `docs/superpowers/plans/2026-MM-DD-orchestration-phase2-smallest-viable-test.md`.
6. Execute via subagent-driven-development (same pattern as Phase 1).

Do NOT skip to Phase 3 (skill build) before all 5 Phase 2 runs complete cleanly.
