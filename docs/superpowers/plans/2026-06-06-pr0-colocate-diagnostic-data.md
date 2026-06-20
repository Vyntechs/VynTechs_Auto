# PR0 — Co-locate diagnostic auto-draw code with the curator/research line

**Date:** 2026-06-06 · **Branch:** `feat/system-data-ingest` (cut off `feat/wizard-band-primitive`, the N4/curator line) · **Owner:** Brandon (non-technical founder).

## Goal
Get the two halves onto ONE branch so later PRs can build on both:
- **Half A (curator/research, already here):** `lib/research/*` pipeline, curator console, flow editor/publish, modern curator gate.
- **Half B (auto-draw, ported from `feat/6.0-psd-cranks-no-start-seed`):** the code that renders a wiring diagram FROM database facts.

**Ships NO user-visible feature.** Its only job: the two halves coexist and the full test suite stays green.

## Decisive context (verified 2026-06-06)
- **Prod already has all 14 diagnostic tables WITH data** (platforms, architecture_facts 141, components 126, observable_properties 188, symptoms 3, test_actions 28, branch_logic 83, component_connections **194**, component_pins 9, system_scenarios 8, scenario_wire_states 72, symptom_test_implications 44, platform_equivalents 0, system_data_status 1). → **PR0 makes ZERO live-DB changes.** Migrations added here are only so the local PGlite test DB can build these tables (`tests/helpers/db.ts` runs every migration in `drizzle/migrations/`).
- The curator branch (this one) has **none** of the diagnostic tables in `schema.ts` → the port is purely additive, no name collisions.
- Branches diverge at migration 0017. Curator line: `0017_rate_limit_buckets → 0018_profile_is_curator_flag → 0019_curator_flows_schema → 0020_sessions_wizard_state`. Seed line: `0017_diagnostic_orchestration → 0018_session_cache_hit_fks → 0019_component_systems → 0020_interactive_electrical_topology`.
- The 3 diagnostic migrations are **pure DDL, no INSERTs, statement-breakpoints intact** (0017: 12 CREATE; 0019: ALTER only; 0020: 5 CREATE).
- `react-arborist` has **no usages** on this branch but is **left in place** (out of PR0 scope; surgical).

## Exact changes
1. **`lib/db/schema.ts`** — append the ~14 diagnostic/topology table defs + their enums from the seed schema. **Additive only.** Do NOT modify any existing curator/core table. Reconcile any missing drizzle imports. Keep the existing "platform_slug/symptom_slug are TEXT not FK" curator convention untouched.
2. **Migrations** — copy from seed `drizzle/migrations/`, renumbered to land AFTER 0020 (preserve relative order + every `--> statement-breakpoint` marker):
   - `0017_diagnostic_orchestration.sql` → `0021_diagnostic_orchestration.sql`
   - `0019_component_systems.sql` → `0022_component_systems.sql`
   - `0020_interactive_electrical_topology.sql` → `0023_interactive_electrical_topology.sql`
   - Add 3 entries to `drizzle/migrations/meta/_journal.json` (idx 21/22/23, monotonic `when`).
   - **SKIP** seed's `0018_session_cache_hit_fks.sql` (session-linking feature, not needed to draw; avoids extra coupling).
   - **No prod apply** (tables already exist in prod).
3. **Port `lib/diagnostics/`** (curator branch lacks these): `load-system-topology.ts`, `topology-layout.ts`, `cached-lookup.ts`, `gate-thresholds.ts`, `symptom-label.ts`. **Do NOT overwrite** `resolve-platform.ts` (identical) or `symptom-resolver.ts` (DIVERGES — keep the curator version). If a ported file imports seed-specific `symptom-resolver` behavior, **surface it, don't silently clobber.**
4. **Port `components/topology/`** — all 11 files (branch has none): captured-missing-footer, scenario-bar, topology-detail-panel, topology-diagram, topology-flow, topology-format, topology-node, topology-selection-context, topology.css, wire-edge, wire-state.
5. **`package.json`** — add `@dagrejs/dagre ^3.0.0` and `@xyflow/react ^12.10.2`. Leave everything else.

## Success criteria
- `pnpm install` OK.
- `pnpm test` GREEN — check the **real exit code** (never mask with `| tail`); rerun once if the first cold run shows PGlite-closed flake. **Must not ADD failures** beyond the characterized pre-existing baseline.
- `pnpm exec tsc --noEmit` clean.
- `pnpm build` clean.
- Ported loader + topology components compile against the merged schema.

## Out of scope (later PRs)
Any UI route, any INSERT into diagnostic tables, any AI code, any live-DB change.

## Carry-forward flags
- **Prod has 194 component_connections** — contradicts the "boxes with no lines" assumption. Verify at PR1 whether they cover the 6.0 cranks-no-start case (the picture may light up with no hand-seeding).
- `symptom-resolver.ts` diverged (seed +73/−24). Reconcile only if/when the loader needs it.
