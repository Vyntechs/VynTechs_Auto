# PR-C/A · Interactive Electrical Topology · Schema + Seed + Loader — Execution Kickoff

**Date:** 2026-05-23
**Branch:** `feat/topology-guided-walk` (cut from `staging-interactive-diagnostics` post-PR-#89; name predates the framing change — concept underneath is "interactive electrical topology," not "guided walk")
**PR target base:** `staging-interactive-diagnostics`

**Brandon's one-line paste to start the execution session:**

```
Read docs/superpowers/handoffs/2026-05-23-pr-c-a-execution-kickoff.md and execute the plan via superpowers:subagent-driven-development. You should be on branch feat/topology-guided-walk; if not, git fetch && git switch feat/topology-guided-walk.
```

---

## What this PR ships

The data foundation for the interactive electrical topology — additive Postgres schema, fuel-system seed data on the 6.7L Power Stroke (extracted verbatim from Brandon's prototype), and an extended `loadSystemTopology` that returns the richer assembled graph (pins + electrical wire roles + scenarios with pin-state + per-pin per-scenario readings + captured/missing footer status + per-session lastScenarioSlug). **No UI changes — PR-C/B follows.**

## What to read first (in order)

1. **The plan** — `docs/superpowers/plans/2026-05-23-electrical-topology-schema-loader.md`. 15 tasks, each TDD-style with bite-sized steps. Authoritative for execution order.
2. **The spec** — `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`. Authoritative for "why this shape." Read §2 (decisions D11–D18) and §7 (data model) before touching schema.
3. **The seed source** — `mockups/topology-guidance/round-3-opus/topology.html`. Brandon's hand-built prototype; its `DATA`, `SCENARIOS`, and `PIN_READINGS` JavaScript constants are the source of truth for the seed (Task 11 extracts them).

## Standing rules that apply

- **Live-DB schema changes** (Task 3) and **seed application** (Task 13) require **explicit per-op Brandon approval** per `[[no-dangerous-prod-ops]]`. Surface the SQL in chat + wait for "yes" before calling the Supabase MCP `apply_migration` / `execute_sql` tool.
- **`drizzle-kit generate` is broken since 0011b** per `[[drizzle-kit-broken-since-0011b]]`. Hand-write the migration SQL (Task 1) — do not run drizzle-kit.
- **Rehearse migrations + seed on the local `vyntechs_rehearsal` Postgres** before applying to live, per `[[reference_local_rehearsal_db]]`.
- **Never push to main** per `[[never-push-to-main]]`. Push to the feature branch only. Brandon merges the PR via the GitHub UI.
- **Test cold-cache flake:** `pnpm test` may fail on first run with PGlite "is closed" errors per `[[vitest-pglite-flake]]` — rerun once before treating as a regression.
- **No "AI" word in any user-facing copy or PR description.** Plumbing only.
- **Brandon validates the live tool, not the seed SQL line-by-line** per D16. The execution session does the re-read + spec-fit validation of the prototype prose before generating the seed.

## What's deferred (NOT in this PR)

- **All UI changes.** PR-C/B does the React rendering: custom edge type with wire animation classes, pin handles on components, the compositional scenario picker (ignition + engine + load + fault buttons per §4.8), the pin-selected panel variant, the hybrid captured/missing footer, the beefed-up live readout, mobile inline panel layout. Separate plan, separate session.
- **The Claude Design visual polish round.** Parked at `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md` until the baseline (PR-C/A + PR-C/B) ships and validates.
- **Outcome recording** (`tech_outcomes` writes per tap). Not in this PR; not planned for the immediate-next PR either. See spec §9 ("Explicitly deferred").

## Done criteria for PR-C/A

- Live Supabase has the new schema (5 tables, 9 columns, last_scenario_slug on sessions)
- Live Supabase has the fuel-system seed (7 components with prose, ~9 pins, 8 scenarios, ~72 wire-state rows, ~72 pin readings, 1 status row)
- `loadSystemTopology` returns the extended shape when called against the 2017 F-350 / P0087 session — verified by running it
- Unit tests pass (including new coverage for pins, scenarios, dataStatus, lastScenarioSlug)
- `pnpm tsc --noEmit` clean
- PR opened against `staging-interactive-diagnostics`; Brandon merges

## After PR-C/A merges

Fresh session (Brandon `/clear`s):
1. Reads the spec again with the schema now in place
2. Writes the PR-C/B plan (interactive UI on top of this data foundation)
3. Executes PR-C/B via subagent-driven-development
4. After PR-C/B merges + validates: engage Claude Design via the parked handoff for the polish pass

## Related

- Topology arc memory: `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/project_orchestration_phase_3_inflight.md`
- PR-A spec (the topology this extends): `docs/superpowers/specs/2026-05-20-interactive-topology-diagnostic-design.md`
- PR-B fast-follow spec: `docs/superpowers/specs/2026-05-22-topology-pr-b-fast-follow-design.md`
