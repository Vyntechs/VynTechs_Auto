# Interactive Wiring-Topology Diagnostic — Design Spec

**Date:** 2026-05-20
**Status:** Draft — awaiting Brandon's review
**Feature branch:** `feat/interactive-topology-diagnostic` (cut from `staging-interactive-diagnostics`)
**Supersedes:** the static cached-overview test-plan list shipped in Phase 3 PR1 — `components/screens/cached-overview.tsx`
**Source brainstorm:** `docs/superpowers/handoffs/2026-05-20-interactive-topology-diagnostic-kickoff.md`
**Reference prototype:** `docs/superpowers/reference/vyntechs-fuel-system-prototype.html` (canonical visual target; lives on PR #84)

---

## 1. Goal

When a tech's intake resolves to a cached vehicle + symptom, replace the static
test-plan list with an **explorable wiring-topology diagram of the whole
system** — drawn live from the Phase 2 database. Every component and every
connection is clickable; clicking opens a side panel carrying that point's
diagnostic payload (where it is, what it does, what to expect when probed, what a
wrong reading means). The tech explores the system; the answer is attached to
every point.

This is the diagnostic surface itself — not a list, not a Q&A. It restores the
intent in long-standing project memory: *the canonical topology from the theory
of operation IS the diagnostic surface.*

**Performance is a feature.** The whole load path is structured database reads —
no AI call, no retrieval in the hot path. A cache hit renders the diagram
instantly. "Diagnostic efficiency" is a design constraint, not an afterthought.

## 2. Decisions locked

| # | Decision | Who | Notes |
|---|----------|-----|-------|
| D1 | Scope = the **whole fuel system**, not just the parts a code tests | Brandon, 2026-05-20 | Avoids re-creating PR1's narrow dead-end view |
| D2 | Scenario **animation deferred** to a follow-up | Brandon, 2026-05-20 | Its data isn't in the DB and won't scale hand-authored |
| D3 | **Auto-layout** at render — no stored coordinates | logged | Scales free to the diesel-seeding platforms |
| D4 | Edges styled by **`connection_kind`** (electrical-wire / fluid-line / mechanical-linkage / can-bus / controlled_by / reports_to) | logged | Electrical *role* (5V/signal/PWM/ground) is not structured in the DB — deferred |
| D5 | System grouping via a new **`components.systems` text-array** column | logged | A component belongs to many systems (PCM is in all of them) — array, not single enum |
| D6 | Interactive **pan/zoom canvas**; exact rendering library chosen in the implementation plan | logged | Custom-styled nodes/edges either way, to keep the prototype's aesthetic |
| D7 | **No AI in the load path** — pure structured reads | logged | Instant render; structured-first principle |

## 3. Prototype ↔ database: what exists, what's missing

The prototype is a hand-built, hand-curated slice. The database (`components`,
`component_connections`, `observable_properties`, `test_actions`,
`branch_logic`, `symptoms`, `symptom_test_implications` for platform
`ford-super-duty-4th-gen-67-psd`) is the comprehensive capture. They were built
from the same theory of operation but are different shapes.

| Prototype needs | Database has it? | Resolution in v1 |
|---|---|---|
| Components (boxes) with name, kind, location, function | **Yes** — `components` (123 rows) | Render directly |
| Wires/lines between components | **Yes** — `component_connections` (188 rows, every row has a prose `description`) | Render directly |
| Probe points with what-to-expect / what-wrong-means | **Yes** — `observable_properties` (187) + `test_actions` (28) + `branch_logic` (83) | Shown in the detail panel |
| Screen coordinates / layout | **No** | Auto-layout (D3) |
| A "system" grouping (which parts are *the fuel system*) | **No** — no system field on `components` | New `components.systems` column (D5) + a one-time tagging pass |
| Wire electrical role (signal / 5V / PWM / ground) for colour-coding | **No** — only `connection_kind` | Colour by `connection_kind` (D4); electrical role deferred |
| Per-pin sub-nodes + pin-level wire endpoints | **No** — connections are component→component | Probe points live in the panel, not as diagram dots |
| Scenario animation matrix + per-pin per-scenario readings | **No** — 100% hand-authored in the prototype | Deferred (D2) |

**Honest consequence:** the rendered diagram is drawn from the database, which is
slightly more precise than the prototype's sketch in places (e.g. the 6.7L PSD
uses an Inlet Metering Valve on the CP4.2 plus a mechanical rail pressure-relief
valve — not the prototype's two PWM "regulators"). It will look very close to the
prototype, not pixel-identical. The database is the source of truth.

## 4. Data-model changes

Two small, additive columns. No existing column changes, no drops.

```sql
-- components: which system diagram(s) a component appears in.
-- Array because hubs (PCM, grounds, CAN bus) belong to every system.
ALTER TABLE components ADD COLUMN systems text[] NOT NULL DEFAULT '{}';

-- symptoms: which system's diagram a cached symptom opens.
ALTER TABLE symptoms ADD COLUMN system text;
```

Drizzle (`lib/db/schema.ts`) — matching the existing `corpus_entries.symptom_tags`
array pattern:

```ts
// components
systems: text('systems').array().notNull().default([]),
// symptoms
system: text('system'),
```

System vocabulary reuses the existing `platform_equivalents.system` enum values
(`fuel`, `cooling`, `turbo`, `egr`, `aftertreatment`, `electrical`,
`engine-mechanical`, …). v1 only uses `fuel`.

**Migration mechanics** (project constraints):
- Hand-write the migration SQL — `drizzle-kit generate` is broken since 0011b.
- Rehearse on the local `vyntechs_rehearsal` database first.
- Apply to live Supabase via the Supabase MCP `apply_migration` — **with Brandon's
  per-op approval**. Schema PRs must apply to the live DB, not just the test DB.

**Data population (the tagging pass):**
- Tag the fuel-system components — `UPDATE components SET systems = '{fuel}' …`
  for the ~22 fuel parts + the PCM. The exact list is an **open item (§13)** —
  Brandon eyeballs it before it touches the live database.
- Backfill the 3 existing symptoms: `UPDATE symptoms SET system = 'fuel'` (all
  three — `p0087…`, `p0088…`, `no-start-cranks-normally…` — are fuel).
- Tagging runs as a reviewed data step, same approval gate as the migration.

## 5. Architecture

Five units, each independently testable, communicating through plain typed data.

```
intake → cache hit (sessions.cacheHitSymptomId set)
   │
   ▼
routeForSession() ──kind: 'cached-overview'──▶ session detail page (server component)
   │
   ▼
loadSystemTopology({ db, platformSlug, symptomSlug })   ── lib/diagnostics/load-system-topology.ts
   │   (pure structured DB reads — no AI)
   ▼
SystemTopology  ──▶  layoutTopology(topology)            ── lib/diagnostics/topology-layout.ts
   │                    (pure: graph → node positions)
   ▼
<TopologyDiagnostic>                                     ── components/screens/topology-diagnostic.tsx
   ├─ <TopologyDiagram>   (canvas: nodes + edges, pan/zoom, click)  ── components/topology/
   └─ <TopologyDetailPanel> (empty / component / connection states) ── components/topology/
```

**5.1 `loadSystemTopology`** — `lib/diagnostics/load-system-topology.ts`, sibling
of the existing `cached-lookup.ts`. Given a platform slug + symptom slug:
1. Resolve the platform and the symptom.
2. Read `symptom.system` → the target system (`fuel`); a null `system`
   yields an empty diagram, never an error (§10).
3. Load components: `platformId = X AND <system> = ANY(systems) AND isRetired = false`.
4. Load connections among that component set — **both endpoints in the set**
   (edges leaving the system are not drawn in v1).
5. Load `observable_properties` for those components.
6. Load `test_actions` + their `branch_logic` for those components; mark each
   with whether the current symptom implicates it (via
   `symptom_test_implications`). All are loaded — the diagram panel uses the
   flag to surface implicated tests first.
7. Return a `SystemTopology`. Returns `null` when the platform/symptom is missing
   or no components are tagged for the system.

**5.2 `layoutTopology`** — `lib/diagnostics/topology-layout.ts`. A **pure
function**: `SystemTopology → { nodes: Map<id,{x,y}>, edges: routed paths }`.
Layered/hierarchical layout (the PCM as the controlling hub). Deterministic — the
same topology always lays out the same way (so it's snapshot-testable). Library
choice (e.g. dagre) is finalised in the implementation plan.

**5.3 `<TopologyDiagram>`** — the interactive canvas. Custom-styled nodes (per
component `kind`) and edges (per `connection_kind`), pan + zoom, click handling,
selection state. Keeps the prototype's bone/serif aesthetic.

**5.4 `<TopologyDetailPanel>`** — see §8.

**5.5 `<TopologyDiagnostic>`** — `components/screens/topology-diagnostic.tsx`,
sibling of `cached-overview.tsx`. Composes the vehicle/symptom header + diagram +
panel. This is what the `cached-overview` route kind now renders.

## 6. Data flow & integration

`lib/session-routing.ts` already routes a cache-hit session
(`session.cacheHitSymptomId` set) to `{ kind: 'cached-overview' }`. **No routing
change.** The only integration change: the session detail page, in its
`cached-overview` branch, calls `loadSystemTopology` and renders
`<TopologyDiagnostic>` instead of calling `loadCachedDiagnostic` and rendering
`<CachedOverview>`.

`loadCachedDiagnostic` / `cached-lookup.ts` and `<CachedOverview>` are left in
place but no longer on the cache-hit path; their removal is a later cleanup, not
part of v1 (keeps this change surgical and the diff reviewable).

The platform + symptom resolvers from PR1/PR83
(`resolve-platform.ts`, `symptom-resolver.ts`) are unchanged and upstream of
this — they already accept the messy inputs techs type (`6.7`, `F350`).

## 7. The diagram

- **Nodes** — one per component, styled by `kind`
  (`module` / `sensor` / `actuator` / `valve` / `pump` / `mechanical` /
  `splice` / `connector`). Label = component `name`. The PCM reads as the hub.
- **Edges** — one per connection, styled by `connection_kind`; `direction`
  (uni/bi) indicated. A short label may render on hover/selection.
- **Layout** — auto, layered, deterministic (§5.2). ~22 fuel nodes — comfortably
  within clean auto-layout range.
- **Interaction** — click a node or an edge → it selects, the panel fills.
  Click empty canvas → clear. Pan + zoom. Keyboard: focusable nodes/edges,
  Enter/Space to select, Escape to clear (the prototype already models this).
- **8 injectors** — eight near-identical nodes; layout/visual handling
  (cluster vs row) is an open item (§13), resolved at build time with a screenshot.

## 8. The detail panel

**Empty state** — "Click any part or line" prompt (prototype's empty panel).

**Component selected** — from the `components` row + its children:
- Kind, location, function, electrical contract.
- **Probe points** — its `observable_properties` (each: observation method +
  description = where/what to expect). Clickable list.
- **What to expect / what a wrong reading means** — the component's
  `test_actions` (expected value/observation) + their `branch_logic`
  (condition → verdict → next action). Test actions implicated by the current
  symptom are surfaced first.
- **Provenance marker** — `sourceProvenance` (`TRAINING-CONFIRMED` /
  `TRAINING-INFERRED` / `FIELD-VERIFIED` / `GAP`) shown as a small source tag.
  `GAP` components (the DB has some, e.g. names ending "— GAP") render visibly
  as "needs field verification." This is the prototype's footer concept,
  per-component. Honors *evidence-with-sources, not authoritative claims.*
  **No "AI" wording** anywhere in the panel — frame around "from theory" /
  "needs field check" / the source.

**Connection selected** — from the `component_connections` row:
- The prose `description`, the `connection_kind`, the `direction`, the two
  components it links (each a jump back into its node).
- Provenance marker, same as above.

## 9. v1 scope boundaries

**In v1:** the explorable fuel-system diagram on a cache hit; full component &
connection detail panels; provenance markers; pan/zoom; desktop **and** mobile
(375–414px); the two schema columns + fuel tagging.

**Explicitly deferred (not v1):**
- Scenario animation + per-pin per-scenario readings (D2).
- Electrical-role wire colouring (D4).
- Pin-level sub-nodes / probe dots placed on the diagram.
- Systems other than fuel; platforms other than the 6.7 PSD.
- Outcome recording — v1 is explore-only. No `diagnostic_sessions` /
  `tech_outcomes` writes from this surface. `<TopologyDiagnostic>` carries no
  action CTA — exploring *is* the diagnostic — so PR1's disabled "Start
  diagnosis / coming in the next update" button has no place on this surface.
- Removing the now-unused `cached-lookup.ts` / `<CachedOverview>` (later cleanup).

## 10. Error handling & resilience

- `loadSystemTopology` returns `null` (never throws) when platform/symptom is
  missing or no components are tagged → the page renders a clean **empty state**
  ("system diagram not available yet"), never a 500 and never a crash.
- A component with a null `location` / `function` / `electricalContract` →
  panel renders `—` for that field. Cosmetic fields **soft-fail**; a missing
  display value never breaks the page.
- A connection whose endpoint component is retired/absent → that edge is
  dropped from the graph, not rendered half-attached.
- `layoutTopology` is pure and total — every node in the input gets a position;
  it cannot partially fail.

## 11. Testing & validation

- **TDD** — failing test first, then implementation, for every unit.
- `load-system-topology.test.ts` — correct graph for a platform+symptom;
  retired rows excluded; only both-endpoints-in-set edges; `null` on
  missing/empty; symptom-implicated test actions flagged. Runs on PGlite.
- `topology-layout.test.ts` — pure layout: every node placed, deterministic
  output, no overlapping nodes.
- Panel/diagram component tests — empty / component / connection states;
  soft-fail on missing fields.
- **Live validation** — the real authed app, a real cached code, the *workflow*
  not just a render; desktop **and** mobile viewports; a screenshot of the
  laid-out diagram to Brandon before any merge. (Note: dev server talks to the
  live Supabase — clean up any test session rows created.)

## 12. Build sequence

Two small, independently reviewable PRs into `staging-interactive-diagnostics`:

- **PR-A — Data foundation.** The migration (2 columns), the reviewed fuel
  tagging, `loadSystemTopology`, unit tests. No UI. Done when: live DB has the
  columns + fuel tags; the loader is tested.
- **PR-B — The diagnostic UI.** `layoutTopology`, `<TopologyDiagnostic>`,
  `<TopologyDiagram>`, `<TopologyDetailPanel>`, the route-page swap, mobile,
  live validation. (`layoutTopology` sits with PR-B — node sizing and spacing
  are coupled to how nodes render.) Done when: a cache hit renders the
  explorable diagram on desktop + phone.

The implementation plan (superpowers `writing-plans`) finalises task-level
breakdown and ordering.

## 13. Open items

1. **Fuel component list** — the exact set tagged `systems = '{fuel}'`. Draft set
   (~22 + PCM): `pcm`, `lift-pump`, `lift-pump-relay`, `fuel-tank`,
   `fuel-filter-ws`, `fuel-level-sender`, `wif-sensor`, `cp4-pump`, `imv`,
   `frp-sensor`, `hp-rail-bank-a`, `hp-rail-bank-b`, `injector-1`…`injector-8`,
   `pressure-relief-valve`, `return-circuit`. The list should also carry the
   ground and power-chain context the diagram needs to read coherently (e.g.
   the prototype draws the lift-pump ground to chassis). **Brandon reviews this
   list before the live-DB tagging runs.**
2. **8-injector visual treatment** — row vs cluster vs collapsed group; decided
   at build time against a real screenshot.
3. **Session detail page path** — the exact server component holding the
   `cached-overview` branch is confirmed when the implementation plan is written.
4. **Empty/fallback behavior** — whether a non-fuel cached symptom (none exist
   today) falls back to the old test-plan list or just shows the empty state;
   default is the empty state.
