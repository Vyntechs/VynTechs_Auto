# Existing Diagnostic Flow — Mental Model

**Date:** 2026-05-22
**Branch:** `feat/topology-guided-walk`
**Why this exists:** During the topology-guided-diagnostic brainstorm, the mid-walk mockups read as a "10-step checklist" — counter to how techs actually diagnose. This doc maps the existing flow so the redesign is grounded in what's already there, not in the kickoff's framing alone.

---

## TL;DR

1. **Two diagnostic paths exist today.** A tech enters `/sessions/new` (year/make/model/DTC/complaint). If platform + symptom resolve to the DB → **topology screen** (cache hit, instant). If not → **AI tree walk** (cache miss, 30–60s generation, very different UI).

2. **"Cache" = "we have it in the DB."** Not session caching. The system tries to map (year, make, model, engine) → platform slug, then (platform, complaint/DTC) → symptom slug. Both resolve → topology. Either fails → AI tree.

3. **Today's topology is pure free-browse.** Tech sees the wiring diagram, clicks any part to read its tests + branch logic. No progress tracking, no outcome recording, no guided path. Implicated tests are flagged in the side panel only — the diagram itself doesn't highlight them.

The guided diagnostic we're designing **transforms** today's free-browse into a guided sequence. That transformation is what's creating the friction in the mockups: forcing a numbered 1→10 path feels like a regression from "click anywhere" to "follow the checklist."

---

## The today flow (cache hit path)

1. Tech opens `/sessions/new` → fills `NewSessionForm` (vehicle + complaint).
2. The `CachedComplaintPicker` calls `/api/diagnostics/cached-complaints` and surfaces pre-cached symptoms for that platform if there is one. Tech can click a chip to pre-select.
3. Submit → POST `/api/sessions`:
   - `resolvePlatformSlug({ year, make, model, engine })` looks up the platform.
   - `resolveSymptomSlug({ platformSlug, selectedSymptomSlug, dtcCodes, complaintText })` looks up the symptom.
   - If both resolve: set `cacheHitPlatformId` + `cacheHitSymptomId` on the session row; treeState is `CACHE_HIT_SENTINEL`.
   - If either misses: AI tree runs.
4. Redirect to `/sessions/{id}`.
5. Session page calls `routeForSession()`:
   - Closed → `<ClosedCaseSummary>`.
   - `cacheHitSymptomId` set → **`<TopologyDiagnostic>`** (the screen we're enhancing).
   - Empty treeState → `<TreeGenerating>`.
   - Otherwise → `<ActiveSession>` (the AI tree walk).
6. On `<TopologyDiagnostic>`: `loadSystemTopology({ db, platformSlug, symptomSlug })` runs as pure SQL, returns the `SystemTopology` object → `layoutTopology()` (dagre auto-layout) → `<TopologyDiagram>` + `<TopologyDetailPanel>`.

Three symptoms cached today (all on the 2017 6.7L PSD): `p0087-…`, `p0088-…`, `no-start-cranks-normally-…`. Everything else falls through to AI tree.

## What the topology shows today

**Diagram:** 22 fuel components rendered as nodes (bone design, styled by kind). Edges color-coded by connection kind (electrical / fluid / mechanical / can-bus / etc.). React Flow canvas with pan/zoom/fit-view.

**Panel (side or bottom sheet on mobile):**
- Empty state: "Click any part or line to see what it is, where it is, and what to expect when you probe it."
- Component selected: kind, name, provenance badge, location, function, electrical contract, probe points (observable properties), tests sorted by implicated-first. Tests have description, expected observation, branch logic.
- Connection selected: kind (formatted), description, direction, jump-to-endpoint buttons.

**`implicatedByCurrentSymptom` rendering today:**
- Tests implicated by the cache-hit symptom get `.is-implicated` (amber border) in the panel's test list.
- The **diagram itself does not highlight implicated components.** A part may have an implicated test but the node doesn't light up.

**What doesn't happen today:**
- No progress tracking, no "step N of M" counter.
- No outcome recording — no writes to `tech_outcomes` or `diagnostic_sessions`.
- No branch routing — taps on branch logic in the panel are visual only.
- No "active vs upcoming vs done" states on the diagram.

## The two diagnostic paths, side by side

| Aspect | Cache Hit (Topology) | Cache Miss (AI Tree) |
|---|---|---|
| Entry | Intake resolves to platform + symptom | Intake doesn't resolve |
| Generation | Instant (DB reads) | 30–60s (LLM + retrieval) |
| UI | Diagram + detail panel | Step-by-step Q&A cards |
| Data source | Phase 2 curated schema | LLM + web retrieval (NHTSA, forums, YouTube, etc.) |
| Outcome writes | Empty until guided PR | Session events only |
| Coverage | 3 symptoms (fuel only) | Unlimited |

## Prior PRs in this stack (already merged)

- **PR-A (#87) — Data foundation.** Migrated `components.systems` (array) + `symptoms.system`. Tagged 22 fuel components + 3 fuel symptoms. Built `loadSystemTopology()` SQL loader. No UI.
- **PR-B (#88) — Diagram UI.** Built `<TopologyDiagram>` (React Flow), `<TopologyDetailPanel>`, `<TopologyDiagnostic>`. Cache-hit route now opens this instead of the old `<CachedOverview>`.
- **PR #89 fast-follow.** Added close button (mobile critical). Symptom title formatting from slug. Opening zoom floor (`minZoom: 0.7`). Keyboard select (Enter/Space/Escape). Connection-kind text formatting (`reports_to` → "Reports to").

## `diagnostic_sessions` and `tech_outcomes` tables

Both exist in schema (migration 0017, live on Supabase). Both effectively empty on cache hits — only one simulated Phase 2 walk row sits in each. **The guided diagnostic PR is the first time real techs' walk data will be collected.**

The PR will:
- Insert a `diagnostic_sessions` row when the first test is tapped (or when the walk starts).
- Insert a `tech_outcomes` row per branch-option tap.
- Update `diagnostic_sessions` with `completedAt`, `finalVerdict`, `resolvedComponentId`, `cumulativeConfidence` on terminal.
- Re-derive walk state from those rows on reload (no separate state column).

## Phase 3 roadmap context

Phase 3 (`2026-05-19-orchestration-phase-3-kickoff.md`) has 5 PRs:
1. Platform resolver + diagnostic lookup → **already shipped** as `resolveSymptomSlug` in intake.
2. Diagnostic walk surface.
3. Outcome recording.
4. AI-on-demand (new symptoms auto-populate after AI gen).
5. Cross-platform inheritance (`platform_equivalents`).

**This PR is a fusion of #2 + #3** — by design, per kickoff. After this PR, the cache will grow as more symptoms are diagnosed; AI-on-demand becomes the next major piece.

## The mental model the existing UI presents

**Today: free-browse system map.** Tech opens the topology and thinks "I can see the whole fuel system. I can click any component and learn what to expect. I can pick the test I think is most useful." They do NOT think "I have to go through these 22 parts in a fixed order."

**The kickoff's guided diagnostic shifts that to: "I'm walking through a sequence. Each test is highlighted in test order. I record what I see. The system tells me the next step."** That shift is the source of the friction in the mid-walk mockups. The diagram becomes a progress scoreboard, but at the cost of the free-explore feel that exists today.

## Things to verify with Brandon

1. **Diagnosis-as-checklist vs diagnosis-as-recommended-next.** The kickoff says checklist (numbered 1→10). Today is free-browse. There's a middle path: recommend the next-highest-value test (with reasoning), let the tech tap that or any other component. Soft guidance, not hard sequence.
2. **All-passes ending.** If every step is OK and no fault is found, what does the tech see — summary card, suggest escalation, "still suspect X"?
3. **Reload-resume UX.** Sticky banner ("You were on test 3 of 6 — resume here?") or silent resume?
4. **"Can't run this" handling.** Branch option or escape button? Logs an outcome with `impossible` verdict, or skips silently?
5. **Badge styling.** Match existing `--vt-amber-500` / `--vt-elem-*` tokens?

## Key insights for the design

1. **The topology is zero-latency.** That's a *feature*. The guided diagnostic inherits it — no AI in the loop means no spinner between taps. Emphasize this when contrasting with the AI tree.
2. **Implication data is already rich.** `symptom_test_implications` + `test_actions.invasiveness` give you priority ordering for free. The walk sequence doesn't need a new schema column.
3. **The topology is read-only today because there's nowhere to record observations.** Once `tech_outcomes` writes are in place, every tap is a data point that compounds the library. First few real walks will feel low-confidence; after 10–20, the recommendations get sharp.
4. **Mobile is a first-class constraint.** Bottom sheet, close button, zoom floor — all exist because most techs are on phones. Don't trade mobile usability for desktop elegance.

## Pointers

- Intake form: `components/intake/NewSessionForm.tsx`, `app/(app)/sessions/new/page.tsx`
- Session API + routing: `app/api/sessions/route.ts`, `lib/session-routing.ts`
- Topology screen: `components/screens/topology-diagnostic.tsx`
- Topology pieces: `components/topology/*` (topology-diagram.tsx, topology-detail-panel.tsx, topology-node.tsx, topology-flow.ts, topology-layout.ts, topology-format.ts, topology.css)
- Loader: `lib/diagnostics/load-system-topology.ts`
- Layout: `lib/diagnostics/layout-topology.ts`
- Schema: `lib/db/schema.ts` (look for `diagnosticSessions`, `techOutcomes`, `symptomTestImplications`)
- Cache-miss tree walk: `components/screens/active-session.tsx`
- Phase 3 roadmap: `docs/superpowers/handoffs/2026-05-19-orchestration-phase-3-kickoff.md`
- Topology specs: `docs/superpowers/specs/2026-05-20-interactive-topology-diagnostic-design.md`, `2026-05-22-topology-pr-b-fast-follow-design.md`
