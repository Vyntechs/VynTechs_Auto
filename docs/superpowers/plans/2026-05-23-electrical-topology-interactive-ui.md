# Interactive Electrical Topology UI — PR-C/B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shipped browse-only topology page into a live electrical instrument — compositional scenario picker drives 13-state wire animations across 6 role colors, pin-click isolates a circuit path, side panel shows scenario-scoped readings, captured/missing footer surfaces the data gap, and the active scenario persists per session.

**Architecture:** All schema + loader work already shipped in PR-C/A (#90). This PR is **UI + state + one DB write**. The flow: server page passes `sessionId` to `loadSystemTopology` (which now returns `lastScenarioSlug`), `<TopologyDiagnostic>` lifts both the selection state and the active-scenario state, the compositional picker derives a scenario slug from compound UI state (ignition/engine/load/fault) by matching against `topology.scenarios[].keyPosition/engineState/loadLevel/kind`, React Flow edges become a custom `wire-edge` type that reads `data.wireState` + `data.electricalRole` and applies a `wire wire--<role> <state>` className, each component node renders per-pin React Flow handles + clickable pin rectangles, pin click isolates the matching wires via CSS classes (`.is-active` / `.dim`), and scenario changes fire-and-forget POST to `/api/sessions/[id]/scenario` to persist.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · @xyflow/react (React Flow) · dagre (existing positioner — unchanged) · Drizzle ORM · Supabase (existing helpers via `getSessionForUser`) · Vitest + happy-dom + React Testing Library · PGlite for DB-backed tests.

**Branch:** `feat/topology-interactive-ui` (already cut from `origin/staging-interactive-diagnostics`).
**Base for PR:** `staging-interactive-diagnostics` (NOT main — stacked PR series per [[project_release_branch_pattern]]).
**Spec:** `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md` (18 decisions locked).
**Prototype:** `mockups/topology-guidance/round-3-opus/topology.html` (visual + animation contract reference).

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `components/topology/wire-state.ts` | Pure helpers: re-export `TopologyWireState` from loader; `wireClassName({ role, state, isActive, isDim })`; `defaultScenarioSlug(scenarios, lastScenarioSlug)` resolver |
| `components/topology/wire-edge.tsx` | Custom React Flow edge component. Reads `data: { electricalRole, pinId, wireState, isActive, isDim }` and renders `<BaseEdge>` with `className="wire wire--<role> <state>"` (+ `is-active` / `dim` when applicable) |
| `components/topology/scenario-bar.tsx` | The compositional picker (spec §4.8 + §5.1): ignition switch + engine state + load level + 2 fault buttons. Derives scenario slug; emits `onScenarioChange(slug)` |
| `components/topology/captured-missing-footer.tsx` | Two-column footer (spec §4.7 + §7.6). Wrapper copy from `topology.dataStatus`; bullet rows derived from `topology.components` + `topology.connections` (count captured fields vs nullable fields) |
| `components/topology/topology-selection-context.tsx` | Tiny React context exposing `{ onSelectPin, onSelectComponent, onClear }` so the custom node component can wire pin clicks without prop-drilling through React Flow's `data` |
| `lib/sessions/set-last-scenario.ts` | DB write helper: validates the slug belongs to a real scenario for the session's platform/system, writes `sessions.last_scenario_slug` |
| `app/api/sessions/[id]/scenario/route.ts` | POST endpoint. Mirrors `lock-diagnosis/route.ts` pattern: paywall + auth + `getSessionForUser` ownership check + helper call |
| `tests/unit/wire-state.test.ts` | Pure tests for class-name builder + slug resolver |
| `tests/unit/wire-edge.test.tsx` | Render test confirming className composition for state × role × active/dim matrix |
| `tests/unit/scenario-bar.test.tsx` | Compositional picker: ignition Off hides engine/load; engine Off hides load; fault click overrides; emits correct slug; persisted slug restores correct UI control positions |
| `tests/unit/captured-missing-footer.test.tsx` | Derives captured/missing bullet rows from topology fixture; renders wrapper copy from dataStatus |
| `tests/unit/set-last-scenario.test.ts` | DB-backed (PGlite) test for the helper — happy path + rejection of foreign-slug |
| `tests/unit/scenario-route.test.ts` | API route test: 401 unauth, 403 not-owner, 400 missing/bad slug, 204 success |

### Files to modify

| Path | What changes |
|---|---|
| `app/globals.css` | Add 6 `--role-*` tokens (spec §4.3) |
| `app/(app)/sessions/[id]/page.tsx` | Add `sessionId: session.id` to `loadSystemTopology` call (line 68 today) — without it `lastScenarioSlug` is always null |
| `components/screens/topology-diagnostic.tsx` | Replace polymorphic `selectedId: string \| null` with typed `selection: { kind, id }`; add `activeScenarioSlug` state with default-from-`lastScenarioSlug`-or-`isDefault`; render `<ScenarioBar>`, live readout, and `<CapturedMissingFooter>`; fire-and-forget POST on scenario change |
| `components/topology/topology-diagram.tsx` | Register `edgeTypes = { wire: WireEdge }`; accept `activeScenarioSlug` + extended selection; wrap children in `TopologySelectionContext.Provider`; remove `onSelectConnection` (replaced by pin-or-component) |
| `components/topology/topology-flow.ts` | Stamp `data.pins` on every component node; for each connection, set `type: 'wire'` when `electricalRole` is non-null (else keep `smoothstep`); compute `data.wireState` from `scenarios.find(slug).pinStates[fromPinId ?? toPinId]`; set `sourceHandle: fromPinId` / `targetHandle: toPinId` when present; mark `isActive` / `isDim` based on selected pin |
| `components/topology/topology-node.tsx` | Render per-pin `<Handle>` + clickable pin rectangles (using `data.pins`); pin click calls `onSelectPin(pin.id)` from context with `stopPropagation`; existing top/bottom handles stay for non-pin connections (fluid lines / mechanical linkages) |
| `components/topology/topology-detail-panel.tsx` | Extend `TopologySelection` union with `{ kind: 'pin', pin, component, scenario }`; add `PinBody` component (spec §4.6 pin-selected layout); component panel adds pin list (spec §4.6 component-selected, suppress for PCM + mechanical + splice) |
| `components/topology/topology.css` | Add: 13 wire-state animation classes + `@keyframes flow`; `.wire`/`.wire.is-active`/`.wire.dim`; pin rectangle styles (default/hover/selected); scenario-bar styles; live-readout styles; captured-missing-footer styles; pin-detail panel `.right-now`/`.expect`/`.alarm` boxes; mobile (≤414px) overrides per spec §6 — inline panel below diagram, suppress empty-state on mobile |
| `tests/unit/topology-diagnostic.test.tsx` | Add coverage: scenario change updates wire data; pin selection persists across scenario change; scenario persistence write is fired on change; default scenario resolves correctly |
| `tests/unit/topology-diagram.test.tsx` | Add coverage: pin click sets `is-active` on matching edges + `dim` on others; scenario change re-tunes all edges; component click does NOT isolate wires |
| `tests/unit/topology-flow.test.ts` | Add coverage: wire edges get correct `wireState` from active scenario; non-electrical edges keep smoothstep type; `isActive`/`isDim` flags set correctly for selected pin |

### Files NOT touched (explicit non-goals)

- `lib/diagnostics/load-system-topology.ts` — PR-C/A finalised; only the page-level call site changes (sessionId addition)
- `lib/diagnostics/topology-layout.ts` — dagre layout still correct for components
- `lib/db/schema.ts` — `lastScenarioSlug` column already present from PR-C/A migration 0020
- `drizzle/migrations/` — no schema changes in this PR
- `components/screens/cached-overview.tsx` / `lib/diagnostics/cached-lookup.ts` — already off the cache-hit path (later cleanup, deferred per spec §8.3)

---

## Decision log (locked from spec — apply without re-asking)

- **D11** Scenario persists across reloads + active name shown prominently
- **D13** Scenario picker is compositional (ignition + engine + load + faults), NOT a flat pill row
- **D14** Mobile baseline = inline panel below diagram (bottom-sheet polish deferred)
- **D15** Footer = hybrid (hand-written wrapper + data-derived bullets)
- **D17** Default scenario = `idle` (Ignition On + Engine Running + Load Idle)
- **D18** Claude Design visual polish parked
- **No "AI" word in any user-facing copy** (D8)
- **No outcome recording** (D7) — diagram is the diagnostic, no `tech_outcomes` writes
- **No new schema** — PR-C/A landed everything

---

## Phase 0 — Pre-flight

### Task 0: Establish baseline

**Files:** none

- [ ] **Step 1: Confirm branch + working tree**

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: branch `feat/topology-interactive-ui`; only untracked files (the screenshot pile + the PR-C/A resume handoff). No staged or modified files.

- [ ] **Step 2: Confirm base is `staging-interactive-diagnostics`**

```bash
git fetch origin
git log --oneline origin/staging-interactive-diagnostics..HEAD | head -5
```

Expected: only the kickoff doc commit (`f891e97`) since `origin/staging-interactive-diagnostics` includes PR-C/A.

- [ ] **Step 3: Baseline typecheck**

```bash
pnpm tsc --noEmit
```

Expected: errors ONLY under `designs/design_handoff_vehicle_knowledge/reference/*.tsx` (pre-existing noise — see PR-C/A handoff). Any other tsc error is a baseline issue to flag before starting.

- [ ] **Step 4: Baseline tests**

```bash
pnpm test
```

Expected: green. If cold-cache PGlite flake (~7 "Hook timed out in 10000ms" failures in `beforeEach`), rerun once per [[feedback_vitest_pglite_flake]]:

```bash
pnpm test
```

Second run must be clean.

- [ ] **Step 5: Confirm seed data is live**

```bash
grep -l "fuel-pins-scenarios\|electrical-topology-fuel-seed" drizzle/data/ 2>/dev/null
```

The seed file from PR-C/A should be present. Production has the data — confirmed in PR-C/A's handoff (smoke-test against F-350/P0087 session showed 9 pins, 8 scenarios, 9/9 pinStates+pinReadings).

---

## Phase 1 — Foundations (no UI visible yet)

### Task 1: Add `--role-*` tokens to globals.css

**Files:**
- Modify: `app/globals.css` (extend the `:root` token block around lines 34–187)

- [ ] **Step 1: Add the 6 role tokens**

Find the existing `:root` block and append the role palette (alphabetised within the block; place near existing semantic colour tokens):

```css
  /* Wire-role palette (spec 2026-05-23 §4.3) — semantic to electrical function,
     NOT real wire colors which the tech already knows from the WSM. */
  --role-signal:    #4ca866; /* fresh green — sensor signal */
  --role-5v-ref:    #c97842; /* burnt orange — PCM 5V reference */
  --role-low-ref:   #6b6657; /* graphite — sensor analog ground */
  --role-pwm:       #b3a82e; /* chartreuse mustard — PCM PWM drive */
  --role-12v:       #b34d4d; /* red coral — power supply */
  --role-ground:    #1a1a1a; /* black — chassis ground */
```

- [ ] **Step 2: Typecheck still passes**

```bash
pnpm tsc --noEmit
```

Expected: same baseline noise, no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(topology): add wire-role color tokens to globals

6 semantic role tokens for the interactive topology UI per spec §4.3.
Additive only — no existing tokens touched.
"
```

---

### Task 2: Wire-state pure module + tests

**Files:**
- Create: `components/topology/wire-state.ts`
- Create: `tests/unit/wire-state.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/wire-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  wireClassName,
  defaultScenarioSlug,
  WIRE_STATE_CLASSES,
} from '@/components/topology/wire-state'
import type { TopologyScenario } from '@/lib/diagnostics/load-system-topology'

const baseScenario = (
  overrides: Partial<TopologyScenario>,
): TopologyScenario => ({
  id: 'x',
  slug: 'x',
  label: 'x',
  sub: 'x',
  kind: 'operation',
  keyPosition: 'on',
  engineState: 'running',
  loadLevel: 'idle',
  isDefault: false,
  displayOrder: 0,
  pinStates: {},
  pinReadings: {},
  ...overrides,
})

describe('wireClassName', () => {
  it('composes role + state classes', () => {
    expect(
      wireClassName({ role: 'signal', state: 'signal-med' }),
    ).toBe('wire wire--signal signal-med')
  })

  it('appends is-active when flagged', () => {
    expect(
      wireClassName({ role: 'pwm', state: 'pwm-high', isActive: true }),
    ).toBe('wire wire--pwm pwm-high is-active')
  })

  it('appends dim when flagged', () => {
    expect(
      wireClassName({ role: '5v-ref', state: 'steady-5v', isDim: true }),
    ).toBe('wire wire--5v-ref steady-5v dim')
  })

  it('does not append both is-active and dim (is-active wins)', () => {
    expect(
      wireClassName({
        role: 'ground',
        state: 'steady-gnd',
        isActive: true,
        isDim: true,
      }),
    ).toBe('wire wire--ground steady-gnd is-active')
  })

  it('uses off when state is not provided', () => {
    expect(wireClassName({ role: '12v' })).toBe('wire wire--12v off')
  })
})

describe('defaultScenarioSlug', () => {
  const scenarios: TopologyScenario[] = [
    baseScenario({ id: 'a', slug: 'key-off', isDefault: false }),
    baseScenario({ id: 'b', slug: 'idle', isDefault: true }),
    baseScenario({ id: 'c', slug: 'heavy-load', isDefault: false }),
  ]

  it('returns lastScenarioSlug when it matches a real scenario', () => {
    expect(defaultScenarioSlug(scenarios, 'heavy-load')).toBe('heavy-load')
  })

  it('falls back to isDefault when lastScenarioSlug is null', () => {
    expect(defaultScenarioSlug(scenarios, null)).toBe('idle')
  })

  it('falls back to isDefault when lastScenarioSlug points to a missing scenario', () => {
    expect(defaultScenarioSlug(scenarios, 'fault-from-deleted-platform')).toBe(
      'idle',
    )
  })

  it('falls back to first scenario when nothing is marked default', () => {
    const noDefault = scenarios.map((s) => ({ ...s, isDefault: false }))
    expect(defaultScenarioSlug(noDefault, null)).toBe('key-off')
  })

  it('returns null when no scenarios at all (graceful no-scenarios fallback)', () => {
    expect(defaultScenarioSlug([], null)).toBeNull()
  })
})

describe('WIRE_STATE_CLASSES', () => {
  it('contains all 13 states from spec §4.4', () => {
    expect(WIRE_STATE_CLASSES).toEqual([
      'off',
      'steady-12v', 'steady-5v', 'steady-gnd',
      'signal-rest', 'signal-low', 'signal-med', 'signal-high', 'signal-pegged',
      'pwm-low', 'pwm-med', 'pwm-high', 'pwm-max',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test wire-state -- --run
```

Expected: FAIL with "Cannot find module '@/components/topology/wire-state'".

- [ ] **Step 3: Create the module**

`components/topology/wire-state.ts`:

```ts
import type {
  TopologyScenario,
  TopologyWireState,
} from '@/lib/diagnostics/load-system-topology'

export type { TopologyWireState } from '@/lib/diagnostics/load-system-topology'

export type ElectricalRole =
  | 'signal'
  | '5v-ref'
  | 'low-ref'
  | 'pwm'
  | '12v'
  | 'ground'

/** Spec §4.4 — all 13 wire-state classes, in display order. */
export const WIRE_STATE_CLASSES: TopologyWireState[] = [
  'off',
  'steady-12v', 'steady-5v', 'steady-gnd',
  'signal-rest', 'signal-low', 'signal-med', 'signal-high', 'signal-pegged',
  'pwm-low', 'pwm-med', 'pwm-high', 'pwm-max',
]

type WireClassNameInput = {
  role: ElectricalRole
  state?: TopologyWireState
  isActive?: boolean
  isDim?: boolean
}

/**
 * Builds the CSS class string for a wire SVG path.
 *
 *   wire wire--<role> <state> [is-active|dim]
 *
 * Spec §4.4 — role + state are the visual contract. is-active wins over dim
 * when both are set (the selected pin's own wire is never dimmed).
 */
export function wireClassName({
  role,
  state = 'off',
  isActive = false,
  isDim = false,
}: WireClassNameInput): string {
  const parts = ['wire', `wire--${role}`, state]
  if (isActive) parts.push('is-active')
  else if (isDim) parts.push('dim')
  return parts.join(' ')
}

/**
 * Picks the scenario slug to activate on page load.
 *
 *   1. lastScenarioSlug (from sessions.last_scenario_slug) if it points to a
 *      real scenario for this (platform, system)
 *   2. the scenario marked isDefault — D17 mandates exactly one per slice
 *   3. the first scenario in the array (graceful fallback if data is mid-seed)
 *   4. null if there are no scenarios (no-scenarios fallback per spec §9.A)
 */
export function defaultScenarioSlug(
  scenarios: TopologyScenario[],
  lastScenarioSlug: string | null,
): string | null {
  if (scenarios.length === 0) return null
  if (lastScenarioSlug) {
    const matched = scenarios.find((s) => s.slug === lastScenarioSlug)
    if (matched) return matched.slug
  }
  const isDefault = scenarios.find((s) => s.isDefault)
  if (isDefault) return isDefault.slug
  return scenarios[0]!.slug
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test wire-state -- --run
```

Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add components/topology/wire-state.ts tests/unit/wire-state.test.ts
git commit -m "feat(topology): add wire-state pure helpers

wireClassName composes role + state + active/dim classes per spec §4.4.
defaultScenarioSlug resolves on-load scenario via lastScenarioSlug ->
isDefault -> first-available fallback chain.
"
```

---

### Task 3: Wire-state CSS animation classes

**Files:**
- Modify: `components/topology/topology.css` (append at end of file, before the mobile breakpoint section at line ~234)

- [ ] **Step 1: Add the 13 animation classes + keyframes + role colours + active/dim**

Append to `components/topology/topology.css`:

```css
/* =============================================================================
   Interactive wiring topology (spec 2026-05-23 §4.4)

   The shipped .topo-edge--<connectionKind> palette stays for non-electrical
   connections (fluid lines, mechanical linkages). The .wire palette below
   replaces it for connections carrying an electricalRole; the custom
   <WireEdge> component picks the right className.
   ============================================================================= */

.wire {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition:
    stroke-width var(--vt-dur-2) var(--vt-ease),
    opacity var(--vt-dur-2) var(--vt-ease);
}

.wire--signal  { stroke: var(--role-signal); }
.wire--5v-ref  { stroke: var(--role-5v-ref); }
.wire--low-ref { stroke: var(--role-low-ref); }
.wire--pwm     { stroke: var(--role-pwm); }
.wire--12v     { stroke: var(--role-12v); }
.wire--ground  { stroke: var(--role-ground); }

.wire.off          { opacity: 0.16; animation: none !important; stroke-dasharray: 0; }
.wire.steady-12v   { stroke-dasharray: 12 4; animation: flow 2.4s linear infinite; }
.wire.steady-5v    { stroke-dasharray: 10 4; animation: flow 2.8s linear infinite; opacity: 0.92; }
.wire.steady-gnd   { stroke-dasharray: 16 3; animation: flow 2.6s linear infinite; opacity: 0.85; }
.wire.signal-rest  { stroke-dasharray: 6 8;  animation: flow 3.2s linear infinite; opacity: 0.55; }
.wire.signal-low   { stroke-dasharray: 6 6;  animation: flow 2.4s linear infinite; opacity: 0.70; }
.wire.signal-med   { stroke-dasharray: 6 5;  animation: flow 1.6s linear infinite; }
.wire.signal-high  { stroke-dasharray: 6 4;  animation: flow 1.0s linear infinite; }
.wire.signal-pegged{ stroke-dasharray: 6 3;  animation: flow 0.5s linear infinite; }
.wire.pwm-low      { stroke-dasharray: 5 4;  animation: flow 1.5s linear infinite; opacity: 0.85; }
.wire.pwm-med      { stroke-dasharray: 5 3;  animation: flow 0.85s linear infinite; }
.wire.pwm-high     { stroke-dasharray: 4 2;  animation: flow 0.42s linear infinite; }
.wire.pwm-max      { stroke-dasharray: 4 2;  animation: flow 0.22s linear infinite; }

.wire.is-active {
  stroke-width: 3.5;
  filter: drop-shadow(0 0 6px currentColor);
}
.wire.dim { opacity: 0.25; }

@keyframes flow {
  to { stroke-dashoffset: -16; }
}

/* Respect reduced-motion — disable the dash flow without losing the static
   role color (the tech still gets to read the diagram). */
@media (prefers-reduced-motion: reduce) {
  .wire {
    animation: none !important;
  }
}
```

- [ ] **Step 2: Visual smoke check** (no automated test for pure CSS — just confirm build doesn't break)

```bash
pnpm tsc --noEmit
```

Expected: same baseline noise.

- [ ] **Step 3: Commit**

```bash
git add components/topology/topology.css
git commit -m "feat(topology): add 13 wire-state animations + role stroke colors

Spec §4.4 + §4.3. Wire-state classes drive stroke-dasharray + @keyframes flow
cycle duration. .is-active glow + .dim isolation classes for pin selection.
Reduced-motion media query disables the dash flow but keeps the role color.
"
```

---

## Phase 2 — Wire rendering (custom React Flow edge)

### Task 4: Custom wire-edge React Flow component + tests

**Files:**
- Create: `components/topology/wire-edge.tsx`
- Create: `tests/unit/wire-edge.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/unit/wire-edge.test.tsx`:

```tsx
import '../helpers/react-flow-mock'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { WireEdge } from '@/components/topology/wire-edge'

function renderEdge(data: Partial<React.ComponentProps<typeof WireEdge>['data']>) {
  // Smoke-mount via a 2-node + 1-edge ReactFlow so the custom edge actually
  // receives the props React Flow passes to edge components.
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 400 }}>
        <ReactFlow
          nodes={[
            { id: 'a', position: { x: 0, y: 0 }, data: {} },
            { id: 'b', position: { x: 400, y: 200 }, data: {} },
          ]}
          edges={[
            {
              id: 'e1',
              source: 'a',
              target: 'b',
              type: 'wire',
              data: {
                electricalRole: 'pwm',
                pinId: 'pin-vcv-a',
                wireState: 'pwm-high',
                isActive: false,
                isDim: false,
                ...data,
              },
            },
          ]}
          edgeTypes={{ wire: WireEdge }}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </ReactFlowProvider>,
  )
}

describe('WireEdge', () => {
  it('renders the edge path with wire + role + state classes', () => {
    const { container } = renderEdge({})
    const path = container.querySelector('.wire')
    expect(path).not.toBeNull()
    expect(path?.classList.contains('wire--pwm')).toBe(true)
    expect(path?.classList.contains('pwm-high')).toBe(true)
  })

  it('applies is-active when data.isActive', () => {
    const { container } = renderEdge({ isActive: true })
    const path = container.querySelector('.wire')
    expect(path?.classList.contains('is-active')).toBe(true)
  })

  it('applies dim when data.isDim and not active', () => {
    const { container } = renderEdge({ isDim: true })
    const path = container.querySelector('.wire')
    expect(path?.classList.contains('dim')).toBe(true)
  })

  it('falls back to off state when wireState is undefined', () => {
    const { container } = renderEdge({ wireState: undefined })
    const path = container.querySelector('.wire')
    expect(path?.classList.contains('off')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test wire-edge -- --run
```

Expected: FAIL with "Cannot find module '@/components/topology/wire-edge'".

- [ ] **Step 3: Create the custom edge component**

`components/topology/wire-edge.tsx`:

```tsx
'use client'

import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import {
  wireClassName,
  type TopologyWireState,
  type ElectricalRole,
} from './wire-state'

export type WireEdgeData = {
  electricalRole: ElectricalRole
  /** The pin whose wire activity drives this edge (fromPinId ?? toPinId). */
  pinId: string | null
  /** Resolved by toFlowElements from the active scenario; undefined → off. */
  wireState?: TopologyWireState
  /** True when this edge is the selected pin's own wire. */
  isActive: boolean
  /** True when a pin is selected and this edge isn't its wire. */
  isDim: boolean
}

/**
 * Custom React Flow edge for wires carrying an electricalRole.
 *
 * Path geometry: smoothstep (same as PR-B's default). The visual differences
 * live entirely in the className — stroke color from --role-<role>, dash
 * pattern + animation cycle from the wire-state class. is-active glows and
 * thickens; dim drops to 25% opacity.
 *
 * Non-electrical connections (fluid lines, mechanical linkages) don't use
 * this edge type — they keep the smoothstep + .topo-edge--<kind> styling from
 * PR-B.
 */
export function WireEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<WireEdgeData>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const className = wireClassName({
    role: data?.electricalRole ?? '12v',
    state: data?.wireState,
    isActive: data?.isActive ?? false,
    isDim: data?.isDim ?? false,
  })

  return <BaseEdge id={undefined} path={path} className={className} markerEnd={markerEnd} />
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test wire-edge -- --run
```

Expected: PASS (all 4 cases). The `react-flow-mock` helper handles the happy-dom SVG quirks; if any case fails on `.wire` not found, check that the mock import is first in the test file.

- [ ] **Step 5: Commit**

```bash
git add components/topology/wire-edge.tsx tests/unit/wire-edge.test.tsx
git commit -m "feat(topology): custom WireEdge React Flow component

Renders smoothstep path with wire + role + state classes from wireClassName.
is-active and dim flags drive selection isolation visuals (spec §4.4 + §5.3).
"
```

---

### Task 5: Extend `toFlowElements` to emit wire-edge data + per-pin handles

**Files:**
- Modify: `components/topology/topology-flow.ts`
- Modify: `tests/unit/topology-flow.test.ts`

- [ ] **Step 1: Write the failing test additions**

Append to `tests/unit/topology-flow.test.ts` (read the file first to confirm fixture helpers; mirror its existing setup pattern):

```ts
import type {
  SystemTopology,
  TopologyScenario,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'

const buildTopologyWithScenarios = (): SystemTopology => {
  const pcm = {
    id: 'pcm-id', slug: 'pcm', name: 'PCM', kind: 'module',
    location: null, function: null, electricalContract: null,
    subtitle: null, role: null, wireSummary: null, body: null,
    probingTactic: null, unknownNote: null,
    sourceProvenance: 'TRAINING-CONFIRMED' as const,
    observableProperties: [], testActions: [],
    pins: [{
      id: 'pin-pcm-out', slug: 'pcm-out', name: 'VCV A out',
      roleAbbreviation: 'A', pinNumber: null, edge: 'right' as const, displayOrder: 0,
      probeLocation: 'x', expectedReading: 'x', missingLogic: 'x',
      labelGap: null, sourceProvenance: 'TRAINING-CONFIRMED',
    }],
  }
  const vcv = {
    id: 'vcv-id', slug: 'vcv', name: 'VCV', kind: 'solenoid',
    location: null, function: null, electricalContract: null,
    subtitle: null, role: null, wireSummary: null, body: null,
    probingTactic: null, unknownNote: null,
    sourceProvenance: 'TRAINING-CONFIRMED' as const,
    observableProperties: [], testActions: [],
    pins: [{
      id: 'pin-vcv-a', slug: 'vcv-a', name: 'Pin A',
      roleAbbreviation: 'A', pinNumber: null, edge: 'left' as const, displayOrder: 0,
      probeLocation: 'x', expectedReading: 'x', missingLogic: 'x',
      labelGap: null, sourceProvenance: 'TRAINING-CONFIRMED',
    }],
  }
  const idle: TopologyScenario = {
    id: 'scn-idle', slug: 'idle', label: 'Idle', sub: 'sub',
    kind: 'operation', keyPosition: 'on', engineState: 'running',
    loadLevel: 'idle', isDefault: true, displayOrder: 0,
    pinStates: { 'pin-pcm-out': 'pwm-med', 'pin-vcv-a': 'pwm-med' },
    pinReadings: {},
  }
  return {
    platform: { slug: 'p', name: 'P' },
    symptom: { slug: 's', description: 'S' },
    system: 'fuel',
    components: [pcm, vcv],
    connections: [{
      id: 'conn-1',
      fromComponentId: 'pcm-id',
      toComponentId: 'vcv-id',
      connectionKind: 'electrical-wire',
      direction: 'unidirectional',
      description: null,
      sourceProvenance: 'TRAINING-CONFIRMED',
      electricalRole: 'pwm',
      fromPinId: 'pin-pcm-out',
      toPinId: 'pin-vcv-a',
    }, {
      // Fluid line — no electricalRole, no pins
      id: 'conn-2',
      fromComponentId: 'vcv-id',
      toComponentId: 'pcm-id',
      connectionKind: 'fluid-line',
      direction: 'unidirectional',
      description: 'fuel return',
      sourceProvenance: 'TRAINING-CONFIRMED',
      electricalRole: null,
      fromPinId: null,
      toPinId: null,
    }],
    scenarios: [idle],
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

const layout: TopologyLayout = {
  nodes: [
    { id: 'pcm-id', x: 0, y: 0 },
    { id: 'vcv-id', x: 300, y: 200 },
  ],
}

describe('toFlowElements — scenarios + pins (PR-C/B)', () => {
  it('emits wire-type edges for electrical connections with active scenario state', () => {
    const topology = buildTopologyWithScenarios()
    const { edges } = toFlowElements(topology, layout, {
      kind: 'empty',
      activeScenarioSlug: 'idle',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')
    expect(wireEdge?.type).toBe('wire')
    expect(wireEdge?.data?.electricalRole).toBe('pwm')
    expect(wireEdge?.data?.pinId).toBe('pin-pcm-out')
    expect(wireEdge?.data?.wireState).toBe('pwm-med')
    expect(wireEdge?.sourceHandle).toBe('pin-pcm-out')
    expect(wireEdge?.targetHandle).toBe('pin-vcv-a')
  })

  it('keeps fluid lines on smoothstep with the existing topo-edge palette', () => {
    const topology = buildTopologyWithScenarios()
    const { edges } = toFlowElements(topology, layout, {
      kind: 'empty',
      activeScenarioSlug: 'idle',
    })
    const fluid = edges.find((e) => e.id === 'conn-2')
    expect(fluid?.type).toBe('smoothstep')
    expect(fluid?.className).toContain('topo-edge--fluid-line')
  })

  it('marks edges as isActive when their pin is the selected pin', () => {
    const topology = buildTopologyWithScenarios()
    const { edges } = toFlowElements(topology, layout, {
      kind: 'pin',
      id: 'pin-pcm-out',
      activeScenarioSlug: 'idle',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')
    expect(wireEdge?.data?.isActive).toBe(true)
    expect(wireEdge?.data?.isDim).toBe(false)
  })

  it('marks edges as isDim when a different pin is selected', () => {
    const topology = buildTopologyWithScenarios()
    // 'pin-different' doesn't match conn-1's pins → conn-1 should dim
    const { edges } = toFlowElements(topology, layout, {
      kind: 'pin',
      id: 'pin-different',
      activeScenarioSlug: 'idle',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')
    expect(wireEdge?.data?.isDim).toBe(true)
    expect(wireEdge?.data?.isActive).toBe(false)
  })

  it('falls back to off when scenario has no state for the pin', () => {
    const topology = buildTopologyWithScenarios()
    // scenario slug that doesn't exist → wire defaults to off
    const { edges } = toFlowElements(topology, layout, {
      kind: 'empty',
      activeScenarioSlug: 'no-such-scenario',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')
    expect(wireEdge?.data?.wireState).toBe('off')
  })

  it('stamps pins onto component node data', () => {
    const topology = buildTopologyWithScenarios()
    const { nodes } = toFlowElements(topology, layout, {
      kind: 'empty',
      activeScenarioSlug: 'idle',
    })
    const pcmNode = nodes.find((n) => n.id === 'pcm-id')
    expect(pcmNode?.data.pins).toHaveLength(1)
    expect(pcmNode?.data.pins[0]!.id).toBe('pin-pcm-out')
  })
})
```

The existing tests in `topology-flow.test.ts` use a positional 3rd arg (`selectedId: string | null`). The new signature is an object `selectionState`. **Update those existing tests at the same time** to pass `{ kind: 'empty' | 'component' | 'connection', id, activeScenarioSlug: null }`. Read the existing tests first and migrate each call site.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test topology-flow -- --run
```

Expected: FAIL on the new PR-C/B cases (missing fields). If pre-existing tests now fail, it's because the old `selectedId` arg signature changed — proceed to Step 3 which updates the signature.

- [ ] **Step 3: Update `topology-flow.ts`**

Replace `components/topology/topology-flow.ts` with the new contract:

```ts
import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyConnection,
  TopologyPin,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import type { WireEdgeData } from './wire-edge'

export type TopologyNodeData = {
  component: TopologyComponent
  pins: TopologyPin[]
  selected: boolean
  selectedPinId: string | null
}

export type TopologyEdgeData = {
  connection: TopologyConnection
}

export type TopologyFlowNode = Node<TopologyNodeData, 'topology'>
export type TopologyFlowEdge =
  | Edge<TopologyEdgeData>
  | (Edge<WireEdgeData> & { type: 'wire' })

/** The selection state the diagram needs to know about. */
export type TopologySelectionState =
  | { kind: 'empty'; activeScenarioSlug: string | null }
  | { kind: 'component'; id: string; activeScenarioSlug: string | null }
  | { kind: 'connection'; id: string; activeScenarioSlug: string | null }
  | { kind: 'pin'; id: string; activeScenarioSlug: string | null }

/**
 * Build React Flow nodes + edges from topology + layout + selection state.
 * Pure (no React, no DOM). Splits edge types:
 *
 *   - electrical wires (electricalRole != null) → custom 'wire' type carrying
 *     wireState, electricalRole, pinId, isActive, isDim
 *   - everything else (fluid lines, mechanical linkages, etc.) → smoothstep
 *     with the existing topo-edge--<kind> className from PR-B
 */
export function toFlowElements(
  topology: SystemTopology,
  layout: TopologyLayout,
  selection: TopologySelectionState,
): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const positionById = new Map(layout.nodes.map((n) => [n.id, n]))

  // Resolve the active scenario to a pin-state map (empty if not found).
  const activeScenario = selection.activeScenarioSlug
    ? topology.scenarios.find((s) => s.slug === selection.activeScenarioSlug)
    : undefined
  const pinStates = activeScenario?.pinStates ?? {}

  const selectedComponentId =
    selection.kind === 'component' ? selection.id : null
  const selectedPinId = selection.kind === 'pin' ? selection.id : null

  const nodes: TopologyFlowNode[] = topology.components.map((component) => {
    const pos = positionById.get(component.id)
    return {
      id: component.id,
      type: 'topology',
      position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
      data: {
        component,
        pins: component.pins,
        selected: selectedComponentId === component.id,
        selectedPinId,
      },
    }
  })

  const edges: TopologyFlowEdge[] = topology.connections.map((connection) => {
    const isSelectedEdge =
      selection.kind === 'connection' && selection.id === connection.id

    // Non-electrical → smoothstep with the existing palette
    if (connection.electricalRole == null) {
      return {
        id: connection.id,
        source: connection.fromComponentId,
        target: connection.toComponentId,
        type: 'smoothstep',
        data: { connection },
        className: `topo-edge topo-edge--${connection.connectionKind}${
          isSelectedEdge ? ' is-selected' : ''
        }`,
        markerEnd:
          connection.direction === 'unidirectional'
            ? { type: MarkerType.ArrowClosed }
            : undefined,
      }
    }

    // Electrical → custom wire edge with scenario-driven state
    const drivingPinId = connection.fromPinId ?? connection.toPinId
    const wireState = drivingPinId ? pinStates[drivingPinId] : undefined
    const isActive =
      selectedPinId != null &&
      (connection.fromPinId === selectedPinId ||
        connection.toPinId === selectedPinId)
    const isDim = selectedPinId != null && !isActive

    return {
      id: connection.id,
      source: connection.fromComponentId,
      target: connection.toComponentId,
      sourceHandle: connection.fromPinId ?? undefined,
      targetHandle: connection.toPinId ?? undefined,
      type: 'wire',
      data: {
        electricalRole: connection.electricalRole,
        pinId: drivingPinId,
        wireState: wireState ?? 'off',
        isActive,
        isDim,
      },
      markerEnd:
        connection.direction === 'unidirectional'
          ? { type: MarkerType.ArrowClosed }
          : undefined,
    }
  })

  return { nodes, edges }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test topology-flow -- --run
```

Expected: all cases pass. If existing tests still fail, the old call sites need migration — update each pre-existing test that called `toFlowElements(topology, layout, selectedId)` to use the new object signature.

- [ ] **Step 5: Commit**

```bash
git add components/topology/topology-flow.ts tests/unit/topology-flow.test.ts
git commit -m "feat(topology): emit wire-type edges with scenario state + pin handles

toFlowElements now splits edge types: electrical wires (custom 'wire' type
with scenario-driven wireState, isActive, isDim) and everything else (kept
on smoothstep). Component nodes carry pins for in-node rendering. Selection
state is now a typed union so pin selection joins component + connection.
"
```

---

## Phase 3 — Pin handles + node rendering

### Task 6: Selection context + extended topology-node with pins

**Files:**
- Create: `components/topology/topology-selection-context.tsx`
- Modify: `components/topology/topology-node.tsx`
- Modify: `tests/unit/topology-diagram.test.tsx` (add pin render coverage — read existing first to mirror its setup)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/topology-diagram.test.tsx`:

```tsx
describe('TopologyDiagram — pin rendering (PR-C/B)', () => {
  it('renders a clickable pin rectangle for each component pin', () => {
    const topology = buildFixtureWithPins() // mirror existing helper pattern
    const onSelectPin = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={topologyLayoutFor(topology)}
        selection={{ kind: 'empty', activeScenarioSlug: 'idle' }}
        onSelectComponent={vi.fn()}
        onSelectPin={onSelectPin}
        onClearSelection={vi.fn()}
      />,
    )
    // Each pin should be a button-role element with the pin's name as aria-label
    const pin = screen.getByRole('button', { name: /pin a/i })
    fireEvent.click(pin)
    expect(onSelectPin).toHaveBeenCalledWith(expect.stringMatching(/pin-/))
  })

  it('does not fire component-select when pin is clicked (stopPropagation)', () => {
    const topology = buildFixtureWithPins()
    const onSelectComponent = vi.fn()
    const onSelectPin = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={topologyLayoutFor(topology)}
        selection={{ kind: 'empty', activeScenarioSlug: 'idle' }}
        onSelectComponent={onSelectComponent}
        onSelectPin={onSelectPin}
        onClearSelection={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /pin a/i }))
    expect(onSelectPin).toHaveBeenCalled()
    expect(onSelectComponent).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test topology-diagram -- --run
```

Expected: FAIL — `onSelectPin` is not a prop yet on TopologyDiagram, and pins aren't rendered.

- [ ] **Step 3: Create the selection context**

`components/topology/topology-selection-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

type SelectionHandlers = {
  onSelectPin: (pinId: string) => void
  onSelectComponent: (componentId: string) => void
  onClear: () => void
}

const TopologySelectionContext = createContext<SelectionHandlers | null>(null)

export const TopologySelectionProvider = TopologySelectionContext.Provider

/**
 * Custom React Flow nodes (rendered inside <ReactFlow>) can't receive
 * arbitrary props from the parent — only `data`. This context lets the
 * custom node fire pin/component clicks back up without prop-drilling
 * through edge `data`.
 */
export function useTopologySelection(): SelectionHandlers {
  const ctx = useContext(TopologySelectionContext)
  if (!ctx) {
    throw new Error('useTopologySelection must be inside TopologySelectionProvider')
  }
  return ctx
}
```

- [ ] **Step 4: Update `topology-node.tsx` to render pins**

Replace `components/topology/topology-node.tsx`:

```tsx
'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { TopologyFlowNode } from './topology-flow'
import type { TopologyPin } from '@/lib/diagnostics/load-system-topology'
import { useTopologySelection } from './topology-selection-context'

const EDGE_TO_POSITION: Record<TopologyPin['edge'], Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/**
 * The bone faceplate. PR-B rendered name + kind + location + GAP marker.
 * PR-C/B adds: pins along the component's edges, each with a React Flow
 * Handle (for edge routing) and a clickable rectangle (for selection).
 *
 * The two original top/bottom handles stay for non-pin connections (fluid
 * lines, mechanical linkages route by component, not pin).
 */
export function TopologyNode({ data }: NodeProps<TopologyFlowNode>) {
  const { component, pins, selected, selectedPinId } = data
  const { onSelectPin, onSelectComponent } = useTopologySelection()

  // Group pins by edge to compute even spacing along that side
  const byEdge: Record<TopologyPin['edge'], TopologyPin[]> = {
    top: [], right: [], bottom: [], left: [],
  }
  for (const pin of pins) byEdge[pin.edge].push(pin)
  for (const edge of Object.keys(byEdge) as TopologyPin['edge'][]) {
    byEdge[edge].sort((a, b) => a.displayOrder - b.displayOrder)
  }

  return (
    <div
      className={`topo-node topo-node--${component.kind}${
        selected ? ' is-selected' : ''
      }`}
      role="button"
      tabIndex={0}
      aria-label={`${component.kind} ${component.name}`}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return // pin clicks already handled
        onSelectComponent(component.id)
      }}
    >
      {/* Legacy top/bottom handles — for non-pin connections (fluid lines etc.) */}
      <Handle type="target" position={Position.Top} className="topo-handle" />
      <Handle type="source" position={Position.Bottom} className="topo-handle" />

      <div className="topo-node__name">{component.name}</div>
      <div className="topo-node__kind">{component.kind}</div>
      {component.location && (
        <div className="topo-node__loc">{component.location}</div>
      )}
      {component.sourceProvenance === 'GAP' && (
        <div className="topo-node__gap">needs field check</div>
      )}

      {/* Per-pin handles + clickable rectangles */}
      {(Object.entries(byEdge) as [TopologyPin['edge'], TopologyPin[]][]).flatMap(
        ([edge, pinsOnEdge]) =>
          pinsOnEdge.map((pin, index) => {
            const offsetPercent = ((index + 1) / (pinsOnEdge.length + 1)) * 100
            const positionStyle = pinPositionStyle(edge, offsetPercent)
            const isSel = selectedPinId === pin.id
            return (
              <div key={pin.id} style={positionStyle} className="topo-pin-wrap">
                <Handle
                  id={pin.id}
                  type="source"
                  position={EDGE_TO_POSITION[edge]}
                  className="topo-pin-handle"
                  isConnectable={false}
                />
                <button
                  type="button"
                  className={`topo-pin${isSel ? ' is-selected' : ''}`}
                  aria-label={`${component.name} ${pin.name} pin`}
                  aria-pressed={isSel}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectPin(pin.id)
                  }}
                >
                  <span className="topo-pin__role">{pin.roleAbbreviation}</span>
                  <span className="topo-pin__num">{pin.pinNumber ?? '—'}</span>
                </button>
              </div>
            )
          }),
      )}
    </div>
  )
}

function pinPositionStyle(
  edge: TopologyPin['edge'],
  offsetPercent: number,
): React.CSSProperties {
  switch (edge) {
    case 'top':    return { position: 'absolute', top: -10, left: `${offsetPercent}%`, transform: 'translateX(-50%)' }
    case 'right':  return { position: 'absolute', right: -10, top: `${offsetPercent}%`, transform: 'translateY(-50%)' }
    case 'bottom': return { position: 'absolute', bottom: -10, left: `${offsetPercent}%`, transform: 'translateX(-50%)' }
    case 'left':   return { position: 'absolute', left: -10, top: `${offsetPercent}%`, transform: 'translateY(-50%)' }
  }
}
```

- [ ] **Step 5: Wire context provider into `topology-diagram.tsx`**

Modify `components/topology/topology-diagram.tsx`. Update Props + render:

```tsx
'use client'

import { useMemo, type KeyboardEvent } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './topology.css'

import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import {
  toFlowElements,
  type TopologySelectionState,
} from './topology-flow'
import { TopologyNode } from './topology-node'
import { WireEdge } from './wire-edge'
import { TopologySelectionProvider } from './topology-selection-context'

const nodeTypes: NodeTypes = { topology: TopologyNode }
const edgeTypes: EdgeTypes = { wire: WireEdge }
const FIT_VIEW_OPTIONS = { padding: 0.2, minZoom: 0.7 }

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  selection: TopologySelectionState
  onSelectComponent: (componentId: string) => void
  onSelectPin: (pinId: string) => void
  onClearSelection: () => void
}

export function TopologyDiagram({
  topology,
  layout,
  selection,
  onSelectComponent,
  onSelectPin,
  onClearSelection,
}: Props) {
  const { nodes, edges } = useMemo(
    () => toFlowElements(topology, layout, selection),
    [topology, layout, selection],
  )

  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') onClearSelection()
  }

  return (
    <TopologySelectionProvider
      value={{ onSelectPin, onSelectComponent, onClear: onClearSelection }}
    >
      <div className="topo__canvas" onKeyDown={onCanvasKeyDown}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          onPaneClick={onClearSelection}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          colorMode="light"
        >
          <Background />
          <Controls showInteractive={false} fitViewOptions={FIT_VIEW_OPTIONS} />
        </ReactFlow>
      </div>
    </TopologySelectionProvider>
  )
}
```

- [ ] **Step 6: Add CSS for pin rectangles**

Append to `components/topology/topology.css` (before the mobile breakpoint):

```css
/* Pin rectangle + handle (spec §4.5) */
.topo-pin-wrap {
  pointer-events: none; /* handle is invisible; pin button takes clicks */
}
.topo-pin-handle {
  /* Override React Flow's default handle dot — make it the geometric anchor only */
  width: 1px !important;
  height: 1px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  background: transparent !important;
  border: none !important;
}
.topo-pin {
  pointer-events: auto;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 32px; /* Brandon's mobile hit-target floor per spec §6 */
  min-height: 28px;
  padding: 2px 4px;
  background: var(--vt-bone-200, #e5e2db);
  border: 0.6px solid var(--vt-fg-2, #555);
  border-radius: 1.5px;
  font-family: var(--vt-font-mono);
  font-size: 8.5px;
  line-height: 1;
  color: var(--vt-fg, #1a1a1a);
  cursor: pointer;
  transition: background var(--vt-dur-2) var(--vt-ease), border-color var(--vt-dur-2) var(--vt-ease);
}
.topo-pin:hover,
.topo-pin:focus {
  background: var(--vt-amber-400, #f4b73a);
  outline: none;
}
.topo-pin.is-selected {
  background: var(--vt-amber-500, #d99a1f);
  border-color: var(--vt-amber-500, #d99a1f);
  color: var(--vt-bone-50, #faf8f3);
}
.topo-pin__role {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.topo-pin__num {
  font-size: 7px;
  opacity: 0.6;
}
```

- [ ] **Step 7: Run tests**

```bash
pnpm test topology-diagram -- --run
pnpm test topology-flow -- --run
pnpm tsc --noEmit
```

Expected: all PR-C/B coverage passes; tsc clean (except gitignored noise).

- [ ] **Step 8: Commit**

```bash
git add components/topology/topology-node.tsx components/topology/topology-selection-context.tsx components/topology/topology-diagram.tsx components/topology/topology.css tests/unit/topology-diagram.test.tsx
git commit -m "feat(topology): per-pin handles + clickable pin rectangles on nodes

Each pin renders a React Flow Handle (positioned by pin.edge) plus a button
with the role abbreviation. Pin clicks fire onSelectPin via a React context
(so the custom node can call back without prop-drilling). stopPropagation
keeps pin clicks from firing the component-select handler. Hit target meets
the 32x28 mobile floor per spec §6.
"
```

---

## Phase 4 — Pin panel + selection model

### Task 7: Extend TopologySelection union + pin panel content

**Files:**
- Modify: `components/topology/topology-detail-panel.tsx`
- Modify: `tests/unit/topology-detail-panel.test.tsx` (read existing first, mirror its setup)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/topology-detail-panel.test.tsx`:

```tsx
describe('TopologyDetailPanel — pin selection (PR-C/B)', () => {
  it('renders pin kind + title + where-to-probe + right-now + expected + diagnostic', () => {
    const pin: TopologyPin = {
      id: 'pin-1', slug: 'frp-signal', name: 'Signal',
      roleAbbreviation: 'S', pinNumber: null, edge: 'top', displayOrder: 0,
      probeLocation: 'Back-probe the signal pin at FRP connector',
      expectedReading: '0.5–4.5 <b>V</b>',
      missingLogic: '<b>High</b> = circuit open',
      labelGap: 'Wire color not captured',
      sourceProvenance: 'TRAINING-CONFIRMED',
    }
    const component = buildFixtureComponent({ pins: [pin] })
    const scenario: TopologyScenario = buildFixtureScenario({
      slug: 'idle', label: 'Idle',
      pinReadings: { 'pin-1': '<b>1.4 V</b> at idle pressure' },
    })
    render(
      <TopologyDetailPanel
        selection={{ kind: 'pin', pin, component, scenario }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/Pin · Signal/i)).toBeInTheDocument()
    expect(screen.getByText(/FRP Sensor · Signal/i)).toBeInTheDocument()
    expect(screen.getByText(/Back-probe/i)).toBeInTheDocument()
    expect(screen.getByText(/1.4 V/i)).toBeInTheDocument()  // from pinReadings
    expect(screen.getByText(/0.5/i)).toBeInTheDocument()    // from expectedReading
    expect(screen.getByText(/circuit open/i)).toBeInTheDocument() // from missingLogic
    expect(screen.getByText(/Wire color not captured/i)).toBeInTheDocument()
  })

  it('shows "no live reading captured" italic placeholder when pinReadings missing', () => {
    const pin = buildFixturePin()
    const component = buildFixtureComponent({ pins: [pin] })
    const scenario = buildFixtureScenario({ pinReadings: {} })
    render(
      <TopologyDetailPanel
        selection={{ kind: 'pin', pin, component, scenario }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/no live reading captured for this scenario/i),
    ).toBeInTheDocument()
  })

  it('applies is-fault class on the right-now box when scenario is a fault', () => {
    const pin = buildFixturePin()
    const component = buildFixtureComponent({ pins: [pin] })
    const scenario = buildFixtureScenario({
      kind: 'fault', label: 'Pegged high pressure',
      pinReadings: { [pin.id]: 'Pegged 4.9 V' },
    })
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'pin', pin, component, scenario }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector('.topo-panel__right-now.is-fault')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test topology-detail-panel -- --run
```

Expected: FAIL on the new cases (no pin variant).

- [ ] **Step 3: Extend the panel component**

Replace the `TopologySelection` export + add `PinBody` in `components/topology/topology-detail-panel.tsx`:

```tsx
import type {
  TopologyComponent,
  TopologyConnection,
  TopologyPin,
  TopologyScenario,
} from '@/lib/diagnostics/load-system-topology'

export type TopologySelection =
  | { kind: 'empty' }
  | { kind: 'component'; component: TopologyComponent }
  | {
      kind: 'connection'
      connection: TopologyConnection
      fromComponent: TopologyComponent | null
      toComponent: TopologyComponent | null
    }
  | {
      kind: 'pin'
      pin: TopologyPin
      component: TopologyComponent
      scenario: TopologyScenario | null
    }
```

Add a `PinBody` component (and a small inline-emphasis renderer that only re-enables `<b>` per spec §7.8):

```tsx
/**
 * Renders text with limited inline markup: only <b> is re-enabled, everything
 * else is escaped. Spec §7.8 — keeps signal-navy emphasis pattern without a
 * full Markdown layer.
 */
function withBoldOnly(text: string): React.ReactNode {
  // Split on <b>...</b> spans, alternating plain text and bold
  const parts: React.ReactNode[] = []
  const regex = /<b>(.*?)<\/b>/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(<b key={key++}>{match[1]}</b>)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function PinBody({
  pin,
  component,
  scenario,
}: {
  pin: TopologyPin
  component: TopologyComponent
  scenario: TopologyScenario | null
}) {
  const reading = scenario ? scenario.pinReadings[pin.id] : undefined
  const isFault = scenario?.kind === 'fault'

  return (
    <>
      <div className="topo-panel__kind">Pin · {pin.name}</div>
      <h2 className="topo-panel__title">
        {component.name} · {pin.name}
      </h2>
      <div className="topo-panel__subtitle">
        click another to compare · click the diagram background to clear
      </div>
      <div className="topo-panel__rule" />

      <div className="topo-panel__section-title">Where to probe</div>
      <div className="topo-panel__body">{field(pin.probeLocation)}</div>

      <div className="topo-panel__section-title">Right now</div>
      <div
        className={`topo-panel__right-now${isFault ? ' is-fault' : ''}`}
      >
        {scenario && (
          <div className="topo-panel__right-now-label">{scenario.label}</div>
        )}
        {reading ? (
          <div>{withBoldOnly(reading)}</div>
        ) : (
          <div className="topo-panel__right-now-missing">
            <em>no live reading captured for this scenario yet</em>
          </div>
        )}
      </div>

      <div className="topo-panel__section-title">Expected range (overall)</div>
      <div className="topo-panel__expect">
        {withBoldOnly(field(pin.expectedReading))}
      </div>

      <div className="topo-panel__section-title">If the reading is wrong</div>
      <div className="topo-panel__alarm">
        <b>Diagnostic:</b> {withBoldOnly(field(pin.missingLogic))}
      </div>

      {pin.labelGap && (
        <div className="topo-panel__label-gap">
          <em>{pin.labelGap}</em>
        </div>
      )}
    </>
  )
}
```

In the `TopologyDetailPanel` JSX, add the pin branch:

```tsx
{selection.kind === 'pin' && (
  <PinBody
    pin={selection.pin}
    component={selection.component}
    scenario={selection.scenario}
  />
)}
```

Also update `ComponentBody` to render the spec §4.6 pin list **when the component has pins AND is not PCM AND is not mechanical AND is not splice** — uses `onSelectComponent`-style callback (rename or add `onSelectPin` prop to enable pin-jump from the panel). For now, scoped change:

```tsx
// In Props:
onSelectPin?: (pinId: string) => void

// In ComponentBody — at the end:
{component.pins.length > 0 &&
  component.slug !== 'pcm' &&
  component.kind !== 'mechanical' &&
  component.kind !== 'splice' &&
  onSelectPin && (
    <>
      <div className="topo-panel__section-title">Pins on this component</div>
      <ul className="topo-panel__pin-list">
        {component.pins.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="topo-panel__pin-list-item"
              onClick={() => onSelectPin(p.id)}
            >
              <span>{p.name}</span>
              <span className="topo-panel__pin-list-role">
                {p.roleAbbreviation}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )}
```

(Thread `onSelectPin` through `Props` and JSX call sites.)

Append CSS for the new panel pieces to `topology.css`:

```css
.topo-panel__subtitle { font-family: var(--vt-font-mono); font-size: 12px; color: var(--vt-fg-2); margin-bottom: 12px; }
.topo-panel__rule { height: 1px; background: var(--vt-rule, #e5e2db); margin: 16px -20px; }

.topo-panel__right-now {
  background: #1a1a1a;
  color: var(--vt-bone-50, #faf8f3);
  padding: 12px 14px;
  border-radius: 2px;
  font-family: var(--vt-font-mono);
  font-size: 12.5px;
  margin: 8px 0 16px;
}
.topo-panel__right-now-label {
  color: #e7c87a;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.topo-panel__right-now.is-fault {
  background: #2d1818;
  border-left: 3px solid var(--role-12v);
}
.topo-panel__right-now.is-fault .topo-panel__right-now-label { color: var(--role-12v); }
.topo-panel__right-now-missing { opacity: 0.6; }

.topo-panel__expect {
  background: var(--vt-bone-50, #faf8f3);
  border: 1px solid var(--vt-rule, #e5e2db);
  border-radius: 2px;
  padding: 10px 12px;
  font-family: var(--vt-font-mono);
  font-size: 12px;
  margin: 6px 0 16px;
}
.topo-panel__expect b { color: var(--vt-signal-500, #2a3f6b); }

.topo-panel__alarm {
  background: rgba(179, 77, 77, 0.06);
  border-left: 2px solid var(--role-12v);
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--vt-fg, #1a1a1a);
  margin: 6px 0 16px;
}
.topo-panel__alarm b { color: var(--role-12v); font-weight: 600; }

.topo-panel__label-gap {
  font-family: var(--vt-font-mono);
  font-size: 11px;
  color: var(--vt-fg-3);
  margin-top: 8px;
}

.topo-panel__pin-list { list-style: none; padding: 0; margin: 8px 0 16px; }
.topo-panel__pin-list-item {
  display: flex; justify-content: space-between; width: 100%;
  padding: 6px 8px; background: none; border: 1px solid transparent;
  border-radius: 2px; font-family: inherit; font-size: 13px;
  text-align: left; cursor: pointer;
}
.topo-panel__pin-list-item:hover {
  background: var(--vt-bone-100, #f1ede4);
  border-color: var(--vt-amber-500, #d99a1f);
}
.topo-panel__pin-list-role {
  font-family: var(--vt-font-mono); font-size: 10px;
  color: var(--vt-fg-2);
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test topology-detail-panel -- --run
```

Expected: PASS for all new pin cases + all existing component/connection cases still pass.

- [ ] **Step 5: Commit**

```bash
git add components/topology/topology-detail-panel.tsx components/topology/topology.css tests/unit/topology-detail-panel.test.tsx
git commit -m "feat(topology): pin variant of detail panel + scenario-scoped reading

PinBody renders the 5-section pin layout from spec §4.6: Where to probe,
Right now (dark inset, red-coral border on fault), Expected range, If wrong
(red-coral alarm), Label gap. Inline <b> emphasis re-enabled per spec §7.8.
Component panel adds the optional pin list (skipped for PCM/mechanical/splice
per spec §4.6).
"
```

---

## Phase 5 — Compositional scenario picker + live readout

### Task 8: Scenario bar + tests

**Files:**
- Create: `components/topology/scenario-bar.tsx`
- Create: `tests/unit/scenario-bar.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/unit/scenario-bar.test.tsx`:

```tsx
import '../helpers/react-flow-mock'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScenarioBar } from '@/components/topology/scenario-bar'
import type { TopologyScenario } from '@/lib/diagnostics/load-system-topology'

const scn = (overrides: Partial<TopologyScenario>): TopologyScenario => ({
  id: overrides.slug ?? 'x',
  slug: 'x',
  label: 'x',
  sub: 'x',
  kind: 'operation',
  keyPosition: null,
  engineState: null,
  loadLevel: null,
  isDefault: false,
  displayOrder: 0,
  pinStates: {},
  pinReadings: {},
  ...overrides,
})

const eightScenarios: TopologyScenario[] = [
  scn({ slug: 'key-off', label: 'Key off', kind: 'operation', keyPosition: 'off' }),
  scn({ slug: 'key-on',  label: 'Key on',  kind: 'operation', keyPosition: 'on', engineState: 'off' }),
  scn({ slug: 'idle',    label: 'Idle',    kind: 'operation', keyPosition: 'on', engineState: 'running', loadLevel: 'idle', isDefault: true }),
  scn({ slug: 'light-load',  label: 'Light',  kind: 'operation', keyPosition: 'on', engineState: 'running', loadLevel: 'light' }),
  scn({ slug: 'medium-load', label: 'Medium', kind: 'operation', keyPosition: 'on', engineState: 'running', loadLevel: 'medium' }),
  scn({ slug: 'heavy-load',  label: 'Heavy',  kind: 'operation', keyPosition: 'on', engineState: 'running', loadLevel: 'heavy' }),
  scn({ slug: 'fault-high',  label: 'Pegged high pressure', kind: 'fault' }),
  scn({ slug: 'fault-low',   label: 'No pressure',          kind: 'fault' }),
]

describe('ScenarioBar', () => {
  it('renders all 6 operation pills + 2 fault buttons for the idle default', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="idle"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /ignition.*on/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /engine.*running/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^idle$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pegged high pressure/i })).toBeInTheDocument()
  })

  it('hides engine state when ignition is off', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-off"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /engine.*running/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^idle$/i })).toBeNull()
  })

  it('hides load level when engine is off', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-on"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /^heavy$/i })).toBeNull()
  })

  it('emits the right slug when ignition toggled to On (from key-off → idle by default)', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-off"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ignition.*on/i }))
    // Default landing when ignition flips on with no engine choice yet = key-on
    expect(onScenarioChange).toHaveBeenCalledWith('key-on')
  })

  it('emits heavy-load when load is set to Heavy with engine running', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="idle"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^heavy$/i }))
    expect(onScenarioChange).toHaveBeenCalledWith('heavy-load')
  })

  it('fault click overrides operation state', () => {
    const onScenarioChange = vi.fn()
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="idle"
        onScenarioChange={onScenarioChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /pegged high pressure/i }))
    expect(onScenarioChange).toHaveBeenCalledWith('fault-high')
  })

  it('shows fault buttons even when ignition is off', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="key-off"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /pegged high pressure/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /no pressure/i })).toBeInTheDocument()
  })

  it('marks the active operation control with aria-pressed', () => {
    render(
      <ScenarioBar
        scenarios={eightScenarios}
        activeSlug="heavy-load"
        onScenarioChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^heavy$/i }))
      .toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test scenario-bar -- --run
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the scenario bar**

`components/topology/scenario-bar.tsx`:

```tsx
'use client'

import type { TopologyScenario } from '@/lib/diagnostics/load-system-topology'

type CompoundState = {
  keyPosition: 'off' | 'on'
  engineState: 'off' | 'running'
  loadLevel: 'idle' | 'light' | 'medium' | 'heavy'
}

type Props = {
  scenarios: TopologyScenario[]
  activeSlug: string | null
  onScenarioChange: (slug: string) => void
}

/**
 * Compositional picker (spec D13 + §4.8 + §5.1).
 *
 * The picker shows 4 control groups that mirror physical truck controls:
 *
 *   - Ignition (Off | On)                 always visible
 *   - Engine state (Off | Running)        visible when ignition = On
 *   - Load level (Idle | Light | Med | Heavy) visible when engine = Running
 *   - Fault buttons (Pegged high | No pressure) always visible
 *
 * When a user toggles a control we derive the new compound state and look up
 * the matching scenario slug from the data. The 8 scenarios in the DB carry
 * keyPosition/engineState/loadLevel/kind so the picker doesn't have a
 * hardcoded mapping table — it's all data-driven.
 */
export function ScenarioBar({ scenarios, activeSlug, onScenarioChange }: Props) {
  const activeScenario = scenarios.find((s) => s.slug === activeSlug) ?? null
  const isFaultActive = activeScenario?.kind === 'fault'
  const operationScenarios = scenarios.filter((s) => s.kind === 'operation')
  const faultScenarios = scenarios.filter((s) => s.kind === 'fault')

  const compound = deriveCompound(activeScenario)

  const handleIgnition = (keyPosition: 'off' | 'on') => {
    const candidate = findOperationSlug(operationScenarios, { ...compound, keyPosition })
    if (candidate) onScenarioChange(candidate)
  }
  const handleEngine = (engineState: 'off' | 'running') => {
    const candidate = findOperationSlug(operationScenarios, { ...compound, engineState })
    if (candidate) onScenarioChange(candidate)
  }
  const handleLoad = (loadLevel: CompoundState['loadLevel']) => {
    const candidate = findOperationSlug(operationScenarios, { ...compound, loadLevel })
    if (candidate) onScenarioChange(candidate)
  }

  return (
    <div className="topo-scenario-bar" role="group" aria-label="Scenario simulator">
      <div className="topo-scenario-bar__group">
        <span className="topo-scenario-bar__label">Ignition</span>
        <button
          type="button"
          aria-pressed={!isFaultActive && compound.keyPosition === 'off'}
          aria-label="Ignition off"
          className={`topo-scenario-bar__pill${!isFaultActive && compound.keyPosition === 'off' ? ' is-active' : ''}`}
          onClick={() => handleIgnition('off')}
        >
          Off
        </button>
        <button
          type="button"
          aria-pressed={!isFaultActive && compound.keyPosition === 'on'}
          aria-label="Ignition on"
          className={`topo-scenario-bar__pill${!isFaultActive && compound.keyPosition === 'on' ? ' is-active' : ''}`}
          onClick={() => handleIgnition('on')}
        >
          On
        </button>
      </div>

      {compound.keyPosition === 'on' && (
        <div className="topo-scenario-bar__group">
          <span className="topo-scenario-bar__label">Engine</span>
          {(['off', 'running'] as const).map((state) => (
            <button
              key={state}
              type="button"
              aria-pressed={!isFaultActive && compound.engineState === state}
              aria-label={`Engine ${state}`}
              className={`topo-scenario-bar__pill${!isFaultActive && compound.engineState === state ? ' is-active' : ''}`}
              onClick={() => handleEngine(state)}
            >
              {state === 'off' ? 'Off' : 'Running'}
            </button>
          ))}
        </div>
      )}

      {compound.keyPosition === 'on' && compound.engineState === 'running' && (
        <div className="topo-scenario-bar__group">
          <span className="topo-scenario-bar__label">Load</span>
          {(['idle', 'light', 'medium', 'heavy'] as const).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={!isFaultActive && compound.loadLevel === level}
              aria-label={level}
              className={`topo-scenario-bar__pill${!isFaultActive && compound.loadLevel === level ? ' is-active' : ''}`}
              onClick={() => handleLoad(level)}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      )}

      <div className="topo-scenario-bar__group topo-scenario-bar__group--fault">
        <span className="topo-scenario-bar__label">Pretend fault</span>
        {faultScenarios.map((s) => (
          <button
            key={s.slug}
            type="button"
            aria-pressed={activeSlug === s.slug}
            aria-label={s.label}
            className={`topo-scenario-bar__pill topo-scenario-bar__pill--fault${
              activeSlug === s.slug ? ' is-active' : ''
            }`}
            onClick={() => onScenarioChange(s.slug)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Picks the operation scenario that matches the requested compound state.
 * Defensive: if the perfect match doesn't exist (e.g., requesting engine=off
 * but only key-on + engine-running are seeded), falls back to the same key
 * position with the lowest-friction matching scenario.
 */
function findOperationSlug(
  operations: TopologyScenario[],
  target: CompoundState,
): string | null {
  // Exact match (key + engine + load)
  const exact = operations.find(
    (s) =>
      s.keyPosition === target.keyPosition &&
      s.engineState === target.engineState &&
      s.loadLevel === target.loadLevel,
  )
  if (exact) return exact.slug

  // Key-on engine-off has no load level
  if (target.keyPosition === 'on' && target.engineState === 'off') {
    const candidate = operations.find(
      (s) => s.keyPosition === 'on' && s.engineState === 'off',
    )
    if (candidate) return candidate.slug
  }

  // Key-off has no engine or load
  if (target.keyPosition === 'off') {
    const candidate = operations.find((s) => s.keyPosition === 'off')
    if (candidate) return candidate.slug
  }

  // Anything in the same key position
  const sameKey = operations.find((s) => s.keyPosition === target.keyPosition)
  return sameKey?.slug ?? null
}

/**
 * Pulls compound UI state out of the active scenario. For fault scenarios (no
 * keyPosition/engineState/loadLevel set), assume the truck was at idle when
 * the fault was simulated — keeps the operation controls in a sensible
 * resume position when the tech taps an operation pill to clear the fault.
 */
function deriveCompound(active: TopologyScenario | null): CompoundState {
  if (!active || active.kind === 'fault') {
    return { keyPosition: 'on', engineState: 'running', loadLevel: 'idle' }
  }
  return {
    keyPosition: active.keyPosition ?? 'on',
    engineState: active.engineState ?? 'running',
    loadLevel: active.loadLevel ?? 'idle',
  }
}
```

- [ ] **Step 4: Add scenario-bar CSS**

Append to `components/topology/topology.css`:

```css
/* Scenario bar (spec §4.8) — compositional picker */
.topo-scenario-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 20px;
  align-items: center;
  padding: 12px 16px;
  background: var(--vt-bone-50, #faf8f3);
  border: 1px solid var(--vt-rule, #e5e2db);
  border-radius: 2px;
  margin-bottom: 12px;
}
.topo-scenario-bar__group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.topo-scenario-bar__group--fault { margin-left: auto; }
.topo-scenario-bar__label {
  font-family: var(--vt-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--vt-fg-2);
  margin-right: 4px;
}
.topo-scenario-bar__pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--vt-rule, #e5e2db);
  border-radius: 2px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--vt-fg, #1a1a1a);
  cursor: pointer;
  transition: background var(--vt-dur-2) var(--vt-ease), border-color var(--vt-dur-2) var(--vt-ease);
  min-height: 32px;
}
.topo-scenario-bar__pill:hover { background: var(--vt-bone-100, #f1ede4); }
.topo-scenario-bar__pill.is-active {
  background: var(--vt-fg, #1a1a1a);
  color: var(--vt-bone-50, #faf8f3);
  border-color: var(--vt-fg, #1a1a1a);
}
.topo-scenario-bar__pill--fault.is-active {
  background: var(--role-12v);
  border-color: var(--role-12v);
  color: var(--vt-bone-50, #faf8f3);
}

@media (max-width: 414px) {
  .topo-scenario-bar { gap: 12px; padding: 10px 12px; }
  .topo-scenario-bar__group--fault { margin-left: 0; flex-basis: 100%; }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test scenario-bar -- --run
```

Expected: PASS (all 8 cases).

- [ ] **Step 6: Commit**

```bash
git add components/topology/scenario-bar.tsx components/topology/topology.css tests/unit/scenario-bar.test.tsx
git commit -m "feat(topology): compositional scenario picker per spec §4.8

ScenarioBar mirrors physical truck controls — ignition + engine + load +
fault buttons. Engine hides when ignition off; load hides when engine off
(natural mobile collapse). Slug derived from compound state by data-driven
lookup against scenarios[].keyPosition/engineState/loadLevel. ARIA pressed
on every control for screen reader correctness.
"
```

---

## Phase 6 — State management + persistence

### Task 9: API route + DB write helper for scenario persistence

**Files:**
- Modify: `lib/sessions.ts` (add `setLastScenarioForSession` next to `getSessionForUser` at line 75)
- Create: `app/api/sessions/[id]/scenario/route.ts`
- Modify: `tests/unit/sessions.test.ts` if it exists (otherwise create `tests/unit/set-last-scenario.test.ts`)
- Create: `tests/unit/scenario-route.test.ts`

**Existing pattern (verified by reading lock-diagnosis/route.ts + lib/sessions.ts):**

- Route imports `db` from `@/lib/db/client` (already instantiated, NOT a factory)
- Route auth: `getServerSupabase()` → `supabase.auth.getUser()` (NOT `requireUserAndProfile`)
- Route paywall: `paywallReject(db, user.id)` returns NextResponse or undefined
- Route ownership: handled inside the helper via `getSessionById` + `session.techId !== profile.id`
- Helpers return `{ ok: true, ... } | { ok: false, status, error }` discriminated result, NEVER throw
- The sessions schema uses `cacheHitPlatformId` and `cacheHitSymptomId` (NOT `platformId`/`symptomId`)
- Helpers live in `@/lib/sessions` (single file, NOT a `lib/sessions/` directory)

- [ ] **Step 1: Confirm the pattern**

```bash
grep -n "lockDiagnosisForUser\|getSessionForUser\|paywallReject" lib/sessions.ts | head -5
cat app/api/sessions/\[id\]/lock-diagnosis/route.ts
```

- [ ] **Step 2: Write the failing test for the helper**

`tests/unit/set-last-scenario.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { setLastScenarioForSession } from '@/lib/sessions/set-last-scenario'
import { sessions, systemScenarios, platforms } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

describe('setLastScenarioForSession', () => {
  let testDb: TestDb
  beforeEach(async () => { testDb = await createTestDb() })
  afterEach(() => testDb.close())

  it('writes last_scenario_slug when slug exists for a real scenario', async () => {
    // Seed minimum fixture — copy patterns from load-system-topology.test.ts
    const { db } = testDb
    // ... seed platform, session, scenario as in the existing loader tests ...
    await setLastScenarioForSession({ db, sessionId: 'session-1', slug: 'idle' })
    const row = await db.query.sessions.findFirst({
      where: eq(sessions.id, 'session-1'),
      columns: { lastScenarioSlug: true },
    })
    expect(row?.lastScenarioSlug).toBe('idle')
  })

  it('rejects when slug does not match any scenario', async () => {
    const { db } = testDb
    // seed session...
    await expect(
      setLastScenarioForSession({ db, sessionId: 'session-1', slug: 'no-such-slug' }),
    ).rejects.toThrow(/unknown scenario/i)
  })

  it('rejects when session does not exist', async () => {
    const { db } = testDb
    await expect(
      setLastScenarioForSession({ db, sessionId: 'no-such-session', slug: 'idle' }),
    ).rejects.toThrow(/session not found/i)
  })
})
```

(Read `tests/unit/load-system-topology.test.ts` to copy the platform/session/scenario seed fixture pattern — DO NOT inline-invent seed SQL.)

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test set-last-scenario -- --run
```

Expected: FAIL — helper doesn't exist.

- [ ] **Step 4: Implement the helper inside `lib/sessions.ts`**

Add to `lib/sessions.ts` (next to `getSessionForUser` at ~line 75). Use the file's existing pattern: discriminated `{ ok, ... } | { ok: false, status, error }` result, profile lookup + ownership check inline, `cacheHitPlatformId`/`cacheHitSymptomId` for the session's vehicle context:

```ts
export type SetLastScenarioResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

export async function setLastScenarioForSession(opts: {
  db: AppDb
  userId: string
  sessionId: string
  slug: string
}): Promise<SetLastScenarioResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }

  if (!opts.slug || typeof opts.slug !== 'string' || opts.slug.trim() === '') {
    return { ok: false, status: 400, error: 'slug required' }
  }

  if (!session.cacheHitPlatformId || !session.cacheHitSymptomId) {
    return { ok: false, status: 400, error: 'session has no cache-hit context' }
  }

  // Resolve the system from the cache-hit symptom
  const symptom = await opts.db.query.symptoms.findFirst({
    where: eq(symptoms.id, session.cacheHitSymptomId),
    columns: { system: true },
  })
  if (!symptom?.system) {
    return { ok: false, status: 400, error: 'symptom has no system' }
  }

  // Validate the slug refers to a real scenario for this (platform, system)
  const scenario = await opts.db.query.systemScenarios.findFirst({
    where: and(
      eq(systemScenarios.platformId, session.cacheHitPlatformId),
      eq(systemScenarios.system, symptom.system),
      eq(systemScenarios.slug, opts.slug),
      eq(systemScenarios.isRetired, false),
    ),
    columns: { id: true },
  })
  if (!scenario) {
    return { ok: false, status: 400, error: `unknown scenario "${opts.slug}"` }
  }

  await opts.db
    .update(sessions)
    .set({ lastScenarioSlug: opts.slug })
    .where(eq(sessions.id, opts.sessionId))

  return { ok: true }
}
```

Confirm `symptoms` and `systemScenarios` are already imported at the top of `lib/sessions.ts` — if not, add them. Confirm `getProfileByUserId` and `getSessionById` are already imported (they should be, since `getSessionForUser` uses both).

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test set-last-scenario -- --run
```

Expected: PASS.

- [ ] **Step 6: Write the route test**

`tests/unit/scenario-route.test.ts` — mirror the testing approach used by the existing `/lock-diagnosis/route.ts` test (search the codebase for that test as a template):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/sessions/[id]/scenario/route'

// ... mock requireUserAndProfile + getSessionForUser + setLastScenarioForSession ...

describe('POST /api/sessions/[id]/scenario', () => {
  it('returns 401 when unauthenticated', async () => { /* ... */ })
  it('returns 403 when session is not owned by the user', async () => { /* ... */ })
  it('returns 400 when slug is missing', async () => { /* ... */ })
  it('returns 400 when slug is empty string', async () => { /* ... */ })
  it('returns 204 on success', async () => { /* ... */ })
  it('surfaces helper rejection as 400 (unknown scenario)', async () => { /* ... */ })
})
```

(Fill in mocks following the existing test pattern — if a sibling route test like `lock-diagnosis.test.ts` exists, copy its mock skeleton exactly. If no sibling exists, create stubs for `requireUserAndProfile` and `getSessionForUser` matching their signatures.)

- [ ] **Step 7: Run test to verify it fails**

```bash
pnpm test scenario-route -- --run
```

Expected: FAIL — route doesn't exist.

- [ ] **Step 8: Implement the route** — exactly mirror `app/api/sessions/[id]/lock-diagnosis/route.ts`

`app/api/sessions/[id]/scenario/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { setLastScenarioForSession } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const denied = await paywallReject(db, user.id)
  if (denied) return denied

  let payload: { slug?: unknown }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const slug = typeof payload.slug === 'string' ? payload.slug : ''

  const result = await setLastScenarioForSession({
    db,
    userId: user.id,
    sessionId: id,
    slug,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 9: Run test to verify it passes**

```bash
pnpm test scenario-route -- --run
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/sessions/set-last-scenario.ts app/api/sessions/[id]/scenario/route.ts tests/unit/set-last-scenario.test.ts tests/unit/scenario-route.test.ts
git commit -m "feat(api): POST /api/sessions/:id/scenario persists last_scenario_slug

Validates the slug refers to a real scenario for the session's
(platform, system) before writing. Standard paywall + auth + ownership
gating mirrors the existing lock-diagnosis route. Returns 204 on success.
"
```

---

### Task 10: Lift scenario state into TopologyDiagnostic + wire persistence

**Files:**
- Modify: `app/(app)/sessions/[id]/page.tsx`
- Modify: `components/screens/topology-diagnostic.tsx`
- Modify: `tests/unit/topology-diagnostic.test.tsx`

- [ ] **Step 1: Add `sessionId` to loader call site**

`app/(app)/sessions/[id]/page.tsx` — find the `loadSystemTopology` call (~line 68) and add `sessionId: session.id`:

```tsx
const topology = await loadSystemTopology({
  db,
  platformSlug,
  symptomSlug,
  sessionId: session.id,  // PR-C/B — surfaces sessions.lastScenarioSlug on the screen
})
```

(Confirm `session.id` is the right field name from `getSessionForUser`'s return shape.)

- [ ] **Step 2: Write the failing tests for TopologyDiagnostic**

Add to `tests/unit/topology-diagnostic.test.tsx`:

```tsx
describe('TopologyDiagnostic — scenario state (PR-C/B)', () => {
  it('defaults to lastScenarioSlug when present and valid', () => {
    const topology = buildFixtureWith8Scenarios({ lastScenarioSlug: 'heavy-load' })
    render(<TopologyDiagnostic topology={topology} layout={layoutFor(topology)} vehicleName="F-350" sessionId="s1" />)
    // The active scenario name should be visible in the live readout
    expect(screen.getByText(/heavy/i)).toBeInTheDocument()
  })

  it('falls back to isDefault scenario when lastScenarioSlug is null', () => {
    const topology = buildFixtureWith8Scenarios({ lastScenarioSlug: null })
    render(<TopologyDiagnostic topology={topology} layout={layoutFor(topology)} vehicleName="F-350" sessionId="s1" />)
    expect(screen.getByText(/idle/i)).toBeInTheDocument()
  })

  it('fires POST to /api/sessions/:id/scenario on scenario change', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const topology = buildFixtureWith8Scenarios({ lastScenarioSlug: null })
    render(<TopologyDiagnostic topology={topology} layout={layoutFor(topology)} vehicleName="F-350" sessionId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /^heavy$/i }))
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sessions/s1/scenario',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    fetchMock.mockRestore()
  })

  it('preserves pin selection across scenario change', () => {
    // Render, select a pin (assert panel shows it), change scenario, pin still selected
    // ... (use fireEvent and check the panel kind === 'pin' still)
  })

  it('does NOT render the empty-state on mobile (≤414 px) when nothing is selected', () => {
    // matchMedia mock — confirm spec §6 mobile-baseline rule
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm test topology-diagnostic -- --run
```

Expected: FAIL on new cases.

- [ ] **Step 4: Refactor TopologyDiagnostic**

Replace `components/screens/topology-diagnostic.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useMemo, useState, useEffect, useCallback } from 'react'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import { formatSymptomTitle } from '@/components/topology/topology-format'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import {
  TopologyDetailPanel,
  type TopologySelection,
} from '@/components/topology/topology-detail-panel'
import { ScenarioBar } from '@/components/topology/scenario-bar'
import { CapturedMissingFooter } from '@/components/topology/captured-missing-footer'
import { defaultScenarioSlug } from '@/components/topology/wire-state'

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  vehicleName: string
  sessionId: string
}

type SelectionState =
  | { kind: 'empty' }
  | { kind: 'component'; id: string }
  | { kind: 'pin'; id: string }
  | { kind: 'connection'; id: string }

export function TopologyDiagnostic({ topology, layout, vehicleName, sessionId }: Props) {
  const [selection, setSelection] = useState<SelectionState>({ kind: 'empty' })
  const [activeScenarioSlug, setActiveScenarioSlug] = useState<string | null>(() =>
    defaultScenarioSlug(topology.scenarios, topology.lastScenarioSlug),
  )

  const componentById = useMemo(
    () => new Map(topology.components.map((c) => [c.id, c])),
    [topology],
  )
  const pinById = useMemo(() => {
    const map = new Map<
      string,
      { pin: import('@/lib/diagnostics/load-system-topology').TopologyPin; component: import('@/lib/diagnostics/load-system-topology').TopologyComponent }
    >()
    for (const c of topology.components) {
      for (const p of c.pins) map.set(p.id, { pin: p, component: c })
    }
    return map
  }, [topology])
  const connectionById = useMemo(
    () => new Map(topology.connections.map((c) => [c.id, c])),
    [topology],
  )
  const activeScenario = useMemo(
    () => topology.scenarios.find((s) => s.slug === activeScenarioSlug) ?? null,
    [topology, activeScenarioSlug],
  )

  const panelSelection: TopologySelection = useMemo(() => {
    switch (selection.kind) {
      case 'empty': return { kind: 'empty' }
      case 'component': {
        const c = componentById.get(selection.id)
        return c ? { kind: 'component', component: c } : { kind: 'empty' }
      }
      case 'pin': {
        const entry = pinById.get(selection.id)
        return entry
          ? { kind: 'pin', pin: entry.pin, component: entry.component, scenario: activeScenario }
          : { kind: 'empty' }
      }
      case 'connection': {
        const conn = connectionById.get(selection.id)
        return conn
          ? {
              kind: 'connection',
              connection: conn,
              fromComponent: componentById.get(conn.fromComponentId) ?? null,
              toComponent: componentById.get(conn.toComponentId) ?? null,
            }
          : { kind: 'empty' }
      }
    }
  }, [selection, componentById, pinById, connectionById, activeScenario])

  const persistScenario = useCallback(
    (slug: string) => {
      void fetch(`/api/sessions/${sessionId}/scenario`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      }).catch(() => {
        // Fire-and-forget — a failed persistence write doesn't block the UI;
        // tech still sees the new scenario and a refresh will surface the
        // server-side state. Soft-fail per [[feedback_soft_fail_cosmetic_ui]].
      })
    },
    [sessionId],
  )

  const handleScenarioChange = useCallback(
    (slug: string) => {
      setActiveScenarioSlug(slug)
      persistScenario(slug)
    },
    [persistScenario],
  )

  return (
    <div className="topo">
      <header className="topo__header">
        <Link href="/today" className="topo__back-link">← Sessions</Link>
        <div className="topo__eyebrow">
          Electrical topology · diagnostic-complete from theory
        </div>
        <h1 className="topo__title">
          {formatSymptomTitle(topology.symptom.slug)}
        </h1>
        <div className="topo__vehicle">
          {vehicleName} · {topology.platform.name}
        </div>
      </header>

      <ScenarioBar
        scenarios={topology.scenarios}
        activeSlug={activeScenarioSlug}
        onScenarioChange={handleScenarioChange}
      />

      {activeScenario && (
        <div
          className={`topo__readout${activeScenario.kind === 'fault' ? ' is-fault' : ''}`}
        >
          Now showing · <b>{activeScenario.label}</b> — {activeScenario.sub}
        </div>
      )}

      <TopologyDiagram
        topology={topology}
        layout={layout}
        selection={{ ...selection, activeScenarioSlug }}
        onSelectComponent={(id) => setSelection({ kind: 'component', id })}
        onSelectPin={(id) => setSelection({ kind: 'pin', id })}
        onClearSelection={() => setSelection({ kind: 'empty' })}
      />

      <TopologyDetailPanel
        selection={panelSelection}
        onSelectComponent={(id) => setSelection({ kind: 'component', id })}
        onSelectPin={(id) => setSelection({ kind: 'pin', id })}
        onClose={() => setSelection({ kind: 'empty' })}
        open={panelSelection.kind !== 'empty'}
      />

      <CapturedMissingFooter topology={topology} />
    </div>
  )
}
```

Add a `topo__readout` CSS rule:

```css
.topo__readout {
  font-family: var(--vt-font-mono);
  font-size: 12px;
  color: var(--vt-fg-2);
  padding: 8px 0 16px;
}
.topo__readout b {
  color: var(--vt-amber-500, #d99a1f);
  font-weight: 600;
}
.topo__readout.is-fault b { color: var(--role-12v); }
```

- [ ] **Step 5: Run tests**

```bash
pnpm test topology-diagnostic -- --run
pnpm tsc --noEmit
```

Expected: PASS. Adjust any type mismatches.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/sessions/\[id\]/page.tsx components/screens/topology-diagnostic.tsx components/topology/topology.css tests/unit/topology-diagnostic.test.tsx
git commit -m "feat(topology): lift scenario state + persistence into TopologyDiagnostic

Scenario default chain: lastScenarioSlug -> isDefault -> first available
(per spec D11 + D17). On change, fire-and-forget POST persists. Pin
selection co-managed with scenario — both orthogonal, both live on the
same parent so scenario change re-renders the pin panel without losing
selection (per spec §5.1).
"
```

---

## Phase 7 — Captured/missing footer

### Task 11: Footer component + tests

**Files:**
- Create: `components/topology/captured-missing-footer.tsx`
- Create: `tests/unit/captured-missing-footer.test.tsx`

- [ ] **Step 1: Write the failing test**

`tests/unit/captured-missing-footer.test.tsx`:

```tsx
import '../helpers/react-flow-mock'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CapturedMissingFooter } from '@/components/topology/captured-missing-footer'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'

const buildTopology = (overrides: Partial<SystemTopology> = {}): SystemTopology => ({
  platform: { slug: 'p', name: 'P' },
  symptom: { slug: 's', description: 'S' },
  system: 'fuel',
  components: [],
  connections: [],
  scenarios: [],
  dataStatus: {
    capturedHeader: 'Captured from theory · enough to diagnose',
    missingHeader: 'Labels not yet captured · make probing faster, not possible',
    closingNote: 'Each gap above closes one at a time as techs encounter the information in the bay — paste, save, label appears on the diagram. The diagram itself doesn\'t wait for completion to be useful.',
  },
  lastScenarioSlug: null,
  ...overrides,
})

describe('CapturedMissingFooter', () => {
  it('renders both column headers from dataStatus', () => {
    render(<CapturedMissingFooter topology={buildTopology()} />)
    expect(screen.getByText(/captured from theory/i)).toBeInTheDocument()
    expect(screen.getByText(/labels not yet captured/i)).toBeInTheDocument()
  })

  it('renders the closing italic note from dataStatus', () => {
    render(<CapturedMissingFooter topology={buildTopology()} />)
    expect(screen.getByText(/Each gap above closes one at a time/i)).toBeInTheDocument()
  })

  it('derives captured bullets from topology data (components + pins + scenarios)', () => {
    const topology = buildTopology({
      components: [/* 5 fixtures */],
      connections: [/* with electricalRole */],
      scenarios: [/* 8 */],
    })
    render(<CapturedMissingFooter topology={topology} />)
    expect(screen.getByText(/5 components/i)).toBeInTheDocument()
    expect(screen.getByText(/8 scenarios/i)).toBeInTheDocument()
  })

  it('derives missing bullets from null fields (pinNumber, etc.)', () => {
    const topology = buildTopology({
      components: [
        buildFixtureComponent({
          pins: [
            { ...buildFixturePin(), pinNumber: null },
            { ...buildFixturePin(), pinNumber: '47' },
          ],
        }),
      ],
    })
    render(<CapturedMissingFooter topology={topology} />)
    expect(screen.getByText(/1 pin number/i)).toBeInTheDocument()
  })

  it('soft-fails when dataStatus is null', () => {
    const topology = buildTopology({ dataStatus: null })
    const { container } = render(<CapturedMissingFooter topology={topology} />)
    // Returns null OR renders an empty wrapper without crashing
    expect(container.querySelectorAll('.topo-footer')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test captured-missing-footer -- --run
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the footer**

`components/topology/captured-missing-footer.tsx`:

```tsx
'use client'

import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'

type Props = { topology: SystemTopology }

/**
 * Spec §4.7 + §7.6 — hybrid: hand-written framing wrapper from dataStatus,
 * bullet rows derived from the loaded topology (counts of captured vs null).
 */
export function CapturedMissingFooter({ topology }: Props) {
  if (!topology.dataStatus) return null
  const { capturedHeader, missingHeader, closingNote } = topology.dataStatus

  const captured = buildCapturedRows(topology)
  const missing = buildMissingRows(topology)

  return (
    <footer className="topo-footer">
      <div className="topo-footer__col">
        <div className="topo-footer__header">{capturedHeader}</div>
        <ul className="topo-footer__list topo-footer__list--captured">
          {captured.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      </div>
      <div className="topo-footer__col">
        <div className="topo-footer__header">{missingHeader}</div>
        <ul className="topo-footer__list topo-footer__list--missing">
          {missing.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
        <div className="topo-footer__closing-note">
          <em>{closingNote}</em>
        </div>
      </div>
    </footer>
  )
}

function buildCapturedRows(topology: SystemTopology): string[] {
  const rows: string[] = []
  const compCount = topology.components.length
  if (compCount > 0) rows.push(`${compCount} component${compCount === 1 ? '' : 's'} in this system`)

  const totalPins = topology.components.reduce((sum, c) => sum + c.pins.length, 0)
  if (totalPins > 0) rows.push(`${totalPins} pin${totalPins === 1 ? '' : 's'} mapped to roles`)

  const electricalConnections = topology.connections.filter((c) => c.electricalRole != null).length
  if (electricalConnections > 0) {
    rows.push(`${electricalConnections} electrical wire${electricalConnections === 1 ? '' : 's'} with role + endpoints`)
  }

  const scenarioCount = topology.scenarios.length
  if (scenarioCount > 0) rows.push(`${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'} with live readings`)

  return rows
}

function buildMissingRows(topology: SystemTopology): string[] {
  const rows: string[] = []
  const pinsWithoutNumber = topology.components
    .flatMap((c) => c.pins)
    .filter((p) => p.pinNumber == null).length
  if (pinsWithoutNumber > 0) {
    rows.push(`${pinsWithoutNumber} pin number${pinsWithoutNumber === 1 ? '' : 's'} — not yet captured`)
  }

  const componentsWithoutLocation = topology.components.filter((c) => !c.location).length
  if (componentsWithoutLocation > 0) {
    rows.push(`${componentsWithoutLocation} component location${componentsWithoutLocation === 1 ? '' : 's'} — not yet captured`)
  }

  const pinsWithoutLabelGap = topology.components
    .flatMap((c) => c.pins)
    .filter((p) => p.labelGap != null).length
  if (pinsWithoutLabelGap > 0) {
    rows.push(`${pinsWithoutLabelGap} pin${pinsWithoutLabelGap === 1 ? '' : 's'} with label gaps noted`)
  }

  // Soft-fail empty: if there are NO missing items, return an empty array;
  // the component renders the column heading + closing note but no bullets.
  return rows
}
```

Append CSS to `topology.css`:

```css
/* Captured / Not captured footer (spec §4.7) */
.topo-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  padding-top: 28px;
  border-top: 1px solid var(--vt-rule, #e5e2db);
  margin-top: 40px;
}
.topo-footer__header {
  font-family: var(--vt-font-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vt-fg, #1a1a1a);
  margin-bottom: 12px;
}
.topo-footer__list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
}
.topo-footer__list li {
  padding: 8px 0;
  border-bottom: 1px solid var(--vt-rule, #e5e2db);
  font-family: var(--vt-font-sans);
  font-size: 13px;
  color: var(--vt-fg, #1a1a1a);
  position: relative;
  padding-left: 16px;
}
.topo-footer__list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.topo-footer__list--captured li::before {
  background: var(--role-signal);
}
.topo-footer__list--missing li::before {
  background: transparent;
  border: 1.5px solid var(--vt-amber-500, #d99a1f);
}
.topo-footer__closing-note {
  background: var(--vt-bone-100, #f1ede4);
  border-left: 2px solid var(--vt-signal-500, #2a3f6b);
  padding: 12px 14px;
  font-size: 12.5px;
  color: var(--vt-fg, #1a1a1a);
  line-height: 1.55;
}

@media (max-width: 414px) {
  .topo-footer { grid-template-columns: 1fr; gap: 24px; }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test captured-missing-footer -- --run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/topology/captured-missing-footer.tsx components/topology/topology.css tests/unit/captured-missing-footer.test.tsx
git commit -m "feat(topology): captured/missing footer — hybrid wrapper + derived rows

Hand-written framing from dataStatus; bullet rows derived from topology
(component count, pin count, electrical-connection count, scenario count
for captured; pin-number nulls, location nulls, label-gap counts for
missing). Spec §4.7 + §7.6.
"
```

---

## Phase 8 — Mobile baseline

### Task 12: Mobile CSS sweep + no-empty-state on small screens

**Files:**
- Modify: `components/topology/topology.css`
- Modify: `components/topology/topology-detail-panel.tsx` (suppress empty state on mobile per spec §6)

- [ ] **Step 1: Replace the existing mobile breakpoint section**

Locate the `@media (max-width: 1023px)` block in `topology.css` (around line 234). Replace with the spec D14 baseline (inline panel below diagram, NOT a bottom sheet):

```css
@media (max-width: 1023px) {
  .topo {
    grid-template-columns: 1fr;
    grid-template-areas:
      "header"
      "scenario"
      "readout"
      "canvas"
      "panel"
      "footer";
  }
  .topo__header   { grid-area: header; }
  .topo-scenario-bar { grid-area: scenario; }
  .topo__readout  { grid-area: readout; }
  .topo__canvas   { grid-area: canvas; }
  .topo-panel     { grid-area: panel; position: static; transform: none; }
  .topo-footer    { grid-area: footer; }

  .topo-panel { max-height: none; }
}

/* Spec §6 — suppress the empty-state on phone-sized viewports. The footer
   renders directly below the diagram until the tech taps something. */
@media (max-width: 414px) {
  .topo-panel.is-empty-mobile-hidden { display: none; }
}
```

- [ ] **Step 2: Update the panel to skip empty state on small screens**

In `components/topology/topology-detail-panel.tsx`, add a className suffix when selection is empty AND we're on a small viewport:

```tsx
// In the <aside> className:
className={`topo-panel${open ? ' is-open' : ''}${selection.kind === 'empty' ? ' is-empty-mobile-hidden' : ''}`}
```

(The CSS rule above handles the actual hiding only at ≤414 px; desktop still renders the empty state per spec §4.6.)

- [ ] **Step 3: Add mobile-baseline `.topo` grid layout if not already there**

Check if a base desktop grid exists for `.topo`. If not, add:

```css
.topo {
  display: grid;
  grid-template-columns: 1fr 380px;
  grid-template-areas:
    "header header"
    "scenario scenario"
    "readout readout"
    "canvas panel"
    "footer footer";
  gap: 32px;
  max-width: 1320px;
  margin: 0 auto;
  padding: 40px 32px 80px;
}
```

(The mobile breakpoint above already inherits and overrides.)

- [ ] **Step 4: Manual visual sweep (no automated test for pure CSS)**

```bash
pnpm tsc --noEmit
pnpm test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add components/topology/topology.css components/topology/topology-detail-panel.tsx
git commit -m "feat(topology): mobile baseline — inline panel below diagram

Per spec D14 + §6: phone viewports (375–414 px) get a single-column stack
with the panel inline below the diagram, NOT a bottom sheet (deferred to
Claude Design's polish pass). Empty-state suppressed on ≤414 px so the
footer renders directly under the diagram until the tech taps something.
Scenario picker collapses naturally because controls hide based on parent
state (engine hidden when ignition off, load hidden when engine off).
"
```

---

## Phase 9 — Validation + ship

### Task 13: Full test sweep + tsc

- [ ] **Step 1: Type check**

```bash
pnpm tsc --noEmit
```

Expected: errors ONLY under `designs/design_handoff_vehicle_knowledge/reference/*.tsx`. Any other error → fix before moving on.

- [ ] **Step 2: Full test run**

```bash
pnpm test
```

Expected: green. If PGlite cold-cache flake, rerun once (memory: [[feedback_vitest_pglite_flake]]).

- [ ] **Step 3: Fix any failures**

If anything fails: open the failing file, read it, fix the root cause (not a workaround). Commit fixes with `fix(topology): <what>` messages.

---

### Task 14: Browser smoke test on the real authed app

**Per [[feedback_verification_rigor]] and [[feedback_claude_validates_first]]:** fixes aren't "fixed" until proven on the real authed user-facing surface. Type-check + tests passing ≠ feature works.

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

Wait for "Ready in N s". Note the local URL (typically `http://localhost:3000`).

- [ ] **Step 2: Sign in as authed user** (need an existing test account — check `.env.local` for `TEST_USER_EMAIL` or use Brandon's account)

- [ ] **Step 3: Navigate to the F-350 / P0087 session**

URL: `http://localhost:3000/sessions/681de115-5de9-474e-9721-263f65066e08`

Verify on load:
- [ ] Active scenario badge shows "Idle" (or whatever `lastScenarioSlug` is in DB)
- [ ] Wires are animating (PWM lines pulsing, 12V steady, signal lines at appropriate cadence)
- [ ] No console errors

- [ ] **Step 4: Walk all 8 scenarios at desktop (1280, 1440 px)**

For each: click the picker → wires re-tune; live readout updates; if you have a pin selected, the panel's "Right now" updates.

- [ ] **Step 5: Click every pin (~9 of them) and read the panel end-to-end**

For each pin: verify Where to probe / Right now / Expected / If wrong / Label gap render with seed content. Click the canvas background → panel returns to empty (or hidden on mobile).

- [ ] **Step 6: Switch to mobile viewports (375, 390, 414 px)**

Use browser devtools responsive mode. For each viewport:
- Compositional picker collapses (engine hidden when ignition off, etc.)
- Diagram pinch-zooms; pin tap targets meet the 32 px floor
- Tap a pin → panel scrolls into view below canvas (inline, NOT a bottom sheet)
- Footer renders inline below

- [ ] **Step 7: Regression check** — verify PR-B browse mode (non-cache-hit topology) still works.

- [ ] **Step 8: Screenshot desktop 1440 + mobile 390 + tablet 768**

Save to repo root with informative names:
- `pr-c-b-desktop-1440-idle.png`
- `pr-c-b-desktop-1440-pin-selected.png`
- `pr-c-b-desktop-1440-fault.png`
- `pr-c-b-mobile-390-stack.png`
- `pr-c-b-mobile-390-pin-selected.png`
- `pr-c-b-tablet-768-stack.png`

(Use Playwright MCP or Chrome DevTools MCP if convenient.)

- [ ] **Step 9: Verify scenario persistence**

Pick a scenario different from default (e.g. Heavy load). Hard-refresh the page. Active scenario should remain "Heavy load" on reload. Confirm the POST fired in the network tab (`/api/sessions/681de115-.../scenario` → 204).

- [ ] **Step 10: Stop dev server**

---

### Task 15: Push branch + open PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/topology-interactive-ui
```

- [ ] **Step 2: Open PR against `staging-interactive-diagnostics`**

```bash
gh pr create --base staging-interactive-diagnostics --title "PR-C/B: Interactive electrical topology UI — baseline" --body "$(cat <<'EOF'
## Summary
- Turns the shipped browse-only topology page into a live electrical instrument: compositional scenario picker (ignition + engine + load + 2 fault buttons) drives 13-state wire animations across 6 role colors
- Pin-click isolates a circuit path (selected wire glows + thickens; others dim to 25%); side panel shows scenario-scoped "Right now" reading + overall expected + diagnostic-if-wrong + label gap
- Hybrid captured/missing footer (hand-written wrapper from dataStatus + bullet rows derived from topology data — pin numbers, locations, etc.)
- Scenario persists per session via fire-and-forget POST to /api/sessions/[id]/scenario; defaults to Idle (D17) on first load
- Mobile baseline (D14): inline panel below diagram, empty-state suppressed on phone, controls collapse naturally
- No schema changes (PR-C/A handled all of that); no AI in any user-facing copy (D8); no outcome recording (D7)

Spec: docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md
Plan: docs/superpowers/plans/2026-05-23-electrical-topology-interactive-ui.md

## Test plan
- [ ] pnpm test — all new unit tests pass (wire-state, wire-edge, scenario-bar, captured-missing-footer, set-last-scenario, scenario-route + extended topology-flow/diagnostic/diagram/detail-panel coverage)
- [ ] pnpm tsc --noEmit — clean (only gitignored designs/* noise)
- [ ] Walk all 8 scenarios on the F-350 / P0087 session at desktop (1280 + 1440 px) — wire animations track correctly
- [ ] Click every pin — panel content matches seed; "Right now" updates when scenario changes
- [ ] Mobile (375 + 390 + 414 px) — picker collapses, pin tap targets ≥ 32 px, panel inline below diagram
- [ ] Scenario persists across reload (POST → 204 → reload shows persisted slug)
- [ ] PR-B browse-only topology still works (no regression)
EOF
)"
```

- [ ] **Step 3: Brandon merges via GitHub UI** — do NOT merge from CLI per [[feedback_never_push_to_main]].

---

## Self-review checklist

- [ ] **Spec coverage** — every locked decision (D1–D18) has at least one task:
  - D1 (diagram is the diagnostic) → architecture (no wizard/sequencer)
  - D2 (6 ops + 2 faults) → Task 8 scenario bar
  - D3 (animation = activity, color = role) → Tasks 1 + 2 + 3 (tokens, helpers, CSS)
  - D4 (pins clickable) → Task 6
  - D5 (pin isolation) → Tasks 5 + 6 (toFlowElements isActive/isDim + CSS)
  - D6 (scenario re-tune + selection refresh) → Task 10
  - D7 (no outcome writes) → architecture (no `tech_outcomes` calls)
  - D8 (no "AI" word) → spec adherence in copy
  - D9 (captured/missing footer) → Task 11
  - D10 (fuel + 6.7 PSD scope) → inherited
  - D11 (persist + prominent badge) → Tasks 9 + 10 (route + lift + readout)
  - D12 (eyebrow framing) → Task 10
  - D13 (compositional picker) → Task 8
  - D14 (mobile inline baseline) → Task 12
  - D15 (hybrid footer) → Task 11
  - D16 (Claude validates seed) → N/A — PR-C/A already validated
  - D17 (default = Idle) → Task 10 default chain
  - D18 (Claude Design polish parked) → not in scope
- [ ] **No placeholders** — every step has runnable code/commands
- [ ] **Type consistency** — `wireClassName` signature matches between Task 2 and Task 4; `TopologySelectionState` shape matches between Task 5 and Task 10; `setLastScenarioForSession` signature matches between Task 9 helper and route
- [ ] **TDD** — every task that adds code has a failing-test step before the implementation step
- [ ] **Frequent commits** — one commit per task, named to make `git log --oneline` readable

---

## Open risks / gotchas to surface during execution

1. **Pin-handle positioning vs dagre layout.** Dagre positions component nodes (top-left x/y). Pin handles get positioned via CSS `position: absolute` inside the node div, with React Flow's `<Handle>` using its standard `Position.Top|Right|Bottom|Left` enum. **If pin handles render off-screen or wires don't connect at the right spot**, the issue is likely the node not being measured before React Flow tries to route. The PR-B `topology-node.tsx` already worked with React Flow's measurement; same pattern should hold.
2. **React Flow edge re-render cost** when scenario changes (all wire edges get new `data`). For ~9 components / ~15 edges this is fine, but if there's noticeable jank, memoize by edge ID rather than rebuilding the whole array.
3. **Splice pins** — spec §5.4 says splices render as components with no pins. The renderer treats `null` `fromPinId`/`toPinId` on a connection terminating at a splice as "wire ends at component body." Per Task 5: when `electricalRole` is present but `fromPinId` AND `toPinId` are both null, the custom wire edge still works (just no handle attachment); React Flow falls back to the default top/bottom handles. **Test this case in Task 5** by adding a splice fixture.
4. **The `is-fault` styling on the live readout** — make sure the toggle is applied only when `activeScenario.kind === 'fault'`. If a fault is active and the user taps an operation control to clear it, the new scenario will have `kind === 'operation'` and the readout drops back to non-fault.
5. **`pnpm test scenario-route` requires mocking `requireUserAndProfile` + `getSessionForUser`** — if there's no existing pattern in `tests/unit/` for API-route mocks, the cleanest path is `vi.mock('@/lib/auth/require-user', ...)` at the top of the file. Read another sibling route test first; if no template exists, the API test can be marked `.skip` initially and the helper test (Task 9 Step 2) is the load-bearing coverage. The route is small enough that browser smoke-testing in Task 14 catches anything the unit tests miss.
6. **Order of CSS rules** — appending to `topology.css` works for additive rules. If a new rule needs to override an existing one (e.g. the mobile breakpoint replacement), the location matters. Task 12 explicitly replaces the existing mobile block rather than appending.
