# Interactive Topology Diagnostic — PR-B Kickoff (the diagram UI)

**Date:** 2026-05-21
**Resume trigger:** "resume interactive topology PR-B" / "continue topology"

## Status — PR-A is done

PR-A (data foundation) is complete and in review on branch `feat/interactive-topology-diagnostic`, PR'd into `staging-interactive-diagnostics`.

Delivered + verified:
- Schema columns `components.systems` (text array) and `symptoms.system` (text) + migration `0019`.
- `loadSystemTopology` loader + 9 unit tests (spec + code-quality reviewed via subagent-driven-development).
- Live Supabase (`ynmtszuybeenjbigxdyl`): migration `0019` applied; 22 fuel components + 3 fuel symptoms tagged. All verified.

**Do not redo PR-A.** Once PR-A merges into `staging-interactive-diagnostics`, cut the PR-B branch from `staging-interactive-diagnostics` so it includes the loader.

## What PR-B is — the diagnostic UI

The explorable diagram itself. Spec §12 / §5.2–5.5:
- `layoutTopology` — pure function `SystemTopology → node positions` (layered, deterministic; rendering-library choice decided in the PR-B plan).
- `<TopologyDiagram>` — interactive pan/zoom canvas; nodes styled by component `kind`, edges by `connection_kind`; click to select.
- `<TopologyDetailPanel>` — empty / component / connection states (spec §8).
- `<TopologyDiagnostic>` — composes header + diagram + panel; sibling of `components/screens/cached-overview.tsx`.
- Route swap — the session detail page's `cached-overview` branch calls `loadSystemTopology` and renders `<TopologyDiagnostic>` instead of `<CachedOverview>` (spec §6).
- Desktop + mobile (375–414px); live validation on a real cached code.

## What the loader hands you

`loadSystemTopology({ db, platformSlug, symptomSlug }) → SystemTopology | null` — in `lib/diagnostics/load-system-topology.ts`. Returns `null` (never throws) on missing/empty input. `SystemTopology` = `{ platform, symptom, system, components[], connections[] }`; each component carries `observableProperties[]` and `testActions[]` (with branches + an `implicatedByCurrentSymptom` flag). PR-B consumes this shape — do not change it without reason.

## References

- Spec: `docs/superpowers/specs/2026-05-20-interactive-topology-diagnostic-design.md`
- PR-A plan — includes a **"PR-B follow-ups"** section (4 code-review items: parallelize the loader's queries, one-pass group-by assembly, enum-type-widening decision, deterministic branch ordering) to fold into PR-B's plan: `docs/superpowers/plans/2026-05-20-interactive-topology-pr-a-data-foundation.md`
- Visual target — prototype HTML: `docs/superpowers/reference/vyntechs-fuel-system-prototype.html` (on branch `docs/interactive-topology-kickoff`, PR #84)

## First step

PR-B has no implementation plan yet. Phase 1: brainstorm the open items (rendering library; 8-injector visual treatment — spec §13), then write the PR-B implementation plan with `superpowers:writing-plans`, then execute via `superpowers:subagent-driven-development`.
