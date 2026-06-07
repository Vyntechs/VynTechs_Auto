# Handoff — Diagnostic Diagram Rebuild: PLAN COMPLETE, ready to build Wave 0

**Date:** 2026-06-07 · **Branch:** `feat/system-data-ingest` · **Remote:** `origin` = github.com/Vyntechs/VynTechs_Auto
**Worktree:** `.claude/worktrees/system-data-ingest` (the branch is checked out as a git worktree — `git checkout feat/system-data-ingest` from the main dir fails with "already used by worktree"; `cd` into the worktree instead).
**Supersedes:** `2026-06-07-diagnostic-diagram-HANDOFF.md` (that one paused mid-plan-authoring; the plan is now finished).

---

## TL;DR — where we are

The **implementation plan is DONE, self-reviewed, and committed** (`3a4f773`). All 8 per-track plans (T1–T7 + INTEGRATION) + the master plan are written. The adversarial self-review found the plan **scalability-clean** but caught ~12 cross-track contract mismatches; **all are reconciled into the Wave 0 contract freeze in the master plan**, and the 3 dangerous "passes-green-but-proves-nothing" landmines are already fixed in the track code blocks.

**Next action:** build **Wave 0** — the type-only contract freeze — via TDD, then execute Waves 1→4.

## The one document that is the source of truth

**`docs/superpowers/plans/2026-06-07-diagnostic-diagram.md`** (the master plan). Read it first. It contains:
- §1 the SCALABILITY BAR (the acceptance test, verbatim)
- **§2 the WAVE 0 CONTRACT FREEZE — C1/C2/C3 fully reconciled.** This is THE contract; every track builds against these exact type names/shapes.
- §3 dependency waves, §4 conventions (exclusive file ownership, the deterministic leak test, multi-system fixtures, verdict/fork token discipline), §5 the R1–R14 reconciliation log, §6 accepted v1 deferrals, §7 the per-track index, §8 definition of done.

Each per-track file (`2026-06-07-diagram-<track>.md`) opens with a **⚠️ CONTRACT AUTHORITY banner**: master §2 wins on any conflict, and the banner lists that track's required cross-track deltas to apply at fork time.

## EXACTLY where to resume

1. `cd .claude/worktrees/system-data-ingest` (you're already on `feat/system-data-ingest`).
2. Read the master plan §2 + §4. Then build **Wave 0** (a single short-lived branch/PR off this base):
   - The type-only contract modules: `lib/diagnostics/load-system-topology.ts` (C1 types incl. exported `MeterMode`), `components/diagram-kit/part-api.ts` (C2 types), `lib/diagnostics/diagram/slot-interface.ts` (C3 types).
   - The `app/globals.css` token block (the six `--role-*`, `--vt-recede`, `--vt-amber-600`).
   - Widen `vitest.config.ts` `include` to also collect `lib/**/*.test.ts` + `components/**/*.test.{ts,tsx}`, and **lock `vitest.config.ts` ownership to Wave 0** (no Wave 1 track edits it).
   - Wave 0 has no runtime logic except the token CSS — types, unions, const tables, tokens.
3. Use **`superpowers:subagent-driven-development`** (fresh subagent per task, recommended) or `superpowers:executing-plans`. **Wave 0 must merge before any Wave 1 track forks.**
4. Then: Wave 1 (T1, T2, T3, T4, T7 in parallel) → Wave 2 (T5) → Wave 3 (T6) → Wave 4 (INTEGRATION, the scalability gate).

## Brandon's locked decisions (do not re-litigate)

- **Scalability is the acceptance test** (data-only growth; validated across fuel + electrical + DEF). The full quality bar is **resilient / robust / scalable / honest / maintainable** — see memory `diagnostic-diagram-quality-bar`.
- **Full parallel development** — each track its own branch/PR off the shared feature base; exclusive file ownership.
- **KEEP tap-any-shown-part-to-inspect** (adapt `components/topology/topology-selection-context.tsx`; structurally enabled by the widened `StepTemplate.onInspect`).
- **"Whole system" button → the existing full faded-system view** (`<TopologyDiagram>`, xyflow+dagre RETAINED behind the escape; the assembled diagram is the new default).
- **Mobile reading sheet → tap-to-toggle** (peek ↔ expanded), not a free-drag sheet.

## NEW — merge/deploy policy (changed this session)

Claude **MAY merge to `main` AND deploy to prod**, but ONLY through a **risk-elimination gate** (proportional to the change): read the actual diff; `tsc` green across all consumers; full test suite green with REAL evidence (no skips, non-zero collected counts, cold-cache rerun per the PGlite note); verify INTENT against the spec/plan, not just behavior; run review tooling (`/code-review` / pr-review agents; `security-review` when relevant); merge only when all green with evidence; fail loud and STOP on any red/skip. Memory: `pr-merge-ownership`. (Earlier "never merge to main" is REVERSED.)

## Deferred work (intentional — the light path Brandon chose)

The per-track code blocks still contain shape/name drift (R1, R2, R4, R5, R6, R7, R8, R10) — e.g. T4's `SlotFill` shape, T2's `OverlayKind`/`PartReading`, the runtime `assembleScene` import in T6/INTEGRATION. The **CONTRACT AUTHORITY banners list each file's deltas**; apply them against master §2 when the track forks. The vacuous-test landmines (R3 leak filter `elementKind` + positive control, R12 dead ternary, R13 placeholder) are **already fixed** in T3/T6/INTEGRATION.

## Watch-outs (carry-over, still true)

- **Apply the T1 migration to live staging Supabase**, not just PGlite — `test_actions.step_kind` + `pin_scenario_readings.is_out_of_range` (both nullable). Only those two are NEW columns; the meter fields + `routesToTestActionId`/`reasoning` + `priority` already exist (loader un-drops). Prod-adjacent write → full evidence + per-op care.
- Hand-written Drizzle migrations need `--> statement-breakpoint` markers or the PGlite unit suite breaks. Rerun `pnpm test` once on cold cache before trusting failures.
- The loader change is **additive only** — `tsc` across all existing consumers must stay green.
- Targets **staging-curator / V2**.

## Key artifacts (all committed on the branch)

- **Master plan (source of truth):** `docs/superpowers/plans/2026-06-07-diagnostic-diagram.md`
- **Per-track plans:** `docs/superpowers/plans/2026-06-07-diagram-{T1,T2,T3,T4,T5,T6,T7,INTEGRATION}.md`
- **Spec (the design + scalability bar):** `docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md`
- **Decomposition + pinned contracts:** `.design-shots/tracks.json`, `.design-shots/scope-dialin-result.json`
- **Plan-authoring workflow (re-runnable):** `.design-shots/plan-authoring.workflow.js`
- **Exploration output + throwaway prototype (REFERENCE ONLY):** `.design-shots/canvas-exploration-result.json`, `.design-shots/mockups/proto-meter.html`
- **Real scene fixture:** `.design-shots/scene-data.json` (parts-only, no `test_actions`)

## Environment note

The `/usr/bin/git` shim was license-blocked mid-session (it routes to full Xcode via `xcode-select`, which gates on the Xcode license). Resolved by accepting the license. If it recurs: `sudo xcode-select --switch /Library/Developer/CommandLineTools` (the standalone CLI tools have no license gate).
