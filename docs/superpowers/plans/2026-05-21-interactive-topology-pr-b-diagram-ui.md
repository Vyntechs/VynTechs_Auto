# Interactive Topology Diagnostic — PR-B: Diagram UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static cached-overview test-plan list with an explorable, auto-laid-out wiring-topology diagram — every component and connection clickable, each opening a detail panel with its diagnostic payload.

**Architecture:** A pure dagre-based `layoutTopology` turns the PR-A loader's `SystemTopology` into deterministic node positions. A React Flow client component (`<TopologyDiagram>`) renders the pan/zoom canvas with custom bone-styled nodes and connection-kind-styled edges. `<TopologyDetailPanel>` renders the empty/component/connection states. `<TopologyDiagnostic>` composes header + diagram + panel and owns selection state; the session detail page's `cached-overview` branch renders it. Layout runs server-side; only the canvas is a client component.

**Tech Stack:** TypeScript, React 19, Next 16, `@xyflow/react` (React Flow v12), `@dagrejs/dagre`, Vitest + `@testing-library/react` (happy-dom).

**Spec:** `docs/superpowers/specs/2026-05-20-interactive-topology-diagnostic-design.md` (§5–§13).
**Reference prototype:** `docs/superpowers/reference/vyntechs-fuel-system-prototype.html` (on branch `docs/interactive-topology-kickoff`; the canonical *aesthetic* target — bone canvas, serif labels, faceplate nodes — not a layout target).
**Branch:** `feat/interactive-topology-pr-b` (already cut from `staging-interactive-diagnostics`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `@xyflow/react`, `@dagrejs/dagre` |
| `tests/helpers/react-flow-mock.ts` | Create | happy-dom shims (ResizeObserver, DOMMatrix, element sizing) so React Flow renders in tests |
| `lib/diagnostics/topology-layout.ts` | Create | `layoutTopology` — pure `SystemTopology → node positions` (dagre); shared node-size constants |
| `tests/unit/topology-layout.test.ts` | Create | Unit tests for `layoutTopology` |
| `components/topology/topology-flow.ts` | Create | `toFlowElements` — pure `SystemTopology + TopologyLayout → React Flow nodes/edges`; flow types |
| `tests/unit/topology-flow.test.ts` | Create | Unit tests for `toFlowElements` |
| `components/topology/topology.css` | Create | The whole topology stylesheet — nodes, edges, panel, diagnostic layout, mobile sheet |
| `components/topology/topology-node.tsx` | Create | `<TopologyNode>` — React Flow custom node, styled by component `kind` |
| `components/topology/topology-detail-panel.tsx` | Create | `<TopologyDetailPanel>` — empty / component / connection states (spec §8) |
| `tests/unit/topology-detail-panel.test.tsx` | Create | Unit tests for the panel (all three states, soft-fail) |
| `components/topology/topology-diagram.tsx` | Create | `<TopologyDiagram>` — React Flow canvas (`'use client'`), pan/zoom, click→select |
| `tests/unit/topology-diagram.test.tsx` | Create | Smoke test for the diagram |
| `components/screens/topology-diagnostic.tsx` | Create | `<TopologyDiagnostic>` — composes header + diagram + panel, owns selection (`'use client'`) |
| `tests/unit/topology-diagnostic.test.tsx` | Create | Smoke test for the composer |
| `app/(app)/sessions/[id]/page.tsx` | Modify | Route swap — `cached-overview` branch loads topology + renders `<TopologyDiagnostic>` |

**Task dependencies (for parallel execution):** Task 1 unblocks everything. Then Task 2 ∥ Task 4. Task 3 needs 1+2. Task 5 needs 1+4. Task 6 needs 3+4. Task 7 needs 5+6+2. Tasks 8→9 are sequential at the end.

**Testing reality:** `layoutTopology`, `toFlowElements`, and `<TopologyDetailPanel>` are pure/presentational and get full unit tests (TDD). `<TopologyDiagram>` and `<TopologyDiagnostic>` embed React Flow, which does not measure layout under happy-dom — they get *smoke tests* (render without throwing, expected labels present) and the real diagram QA happens in Task 9 (live validation).

---

### Task 1: Dependencies + React Flow test shim

**Files:**
- Modify: `package.json` (via `pnpm add`)
- Create: `tests/helpers/react-flow-mock.ts`

- [ ] **Step 1: Install the diagram libraries**

Run: `pnpm add @xyflow/react @dagrejs/dagre`
Expected: both added to `dependencies`; `pnpm-lock.yaml` updated.
Note: `@dagrejs/dagre` ships its own TypeScript types. If `tsc` later reports the module has no types, run `pnpm add -D @types/dagre` as a fallback (its `dagre`-module types are API-compatible).

- [ ] **Step 2: Create the React Flow happy-dom shim**

React Flow needs browser APIs happy-dom does not fully implement. Without these, any test that renders `<ReactFlow>` throws. Create `tests/helpers/react-flow-mock.ts`:

```ts
// Importing this module installs the browser-API shims React Flow needs
// to render under happy-dom. Import it at the top of any test that mounts
// a component containing <ReactFlow>.

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyMock {
  m22 = 1
  constructor(_transform?: string) {}
}

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverMock
} else {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverMock
}
;(globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly =
  DOMMatrixReadOnlyMock

// React Flow measures nodes via getBoundingClientRect / offset*; happy-dom
// returns zeros. Give every element a non-zero box so layout code runs.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get: () => 100 },
  offsetWidth: { configurable: true, get: () => 200 },
})
if (typeof SVGElement !== 'undefined') {
  ;(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox =
    () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
}
```

- [ ] **Step 3: Verify the existing suite still passes**

Run: `pnpm test`
Expected: PASS (no regression — nothing imports the new files yet). If a cold run shows "PGlite is closed" noise, re-run once before treating it as real (known fork-pool flake).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml tests/helpers/react-flow-mock.ts
git commit -m "chore(topology): add React Flow + dagre, React Flow test shim"
```

---

### Task 2: `layoutTopology` — pure dagre layout

**Files:**
- Create: `lib/diagnostics/topology-layout.ts`
- Test: `tests/unit/topology-layout.test.ts`

- [ ] **Step 1: Write the failing test**

`layoutTopology` is pure — it takes a `SystemTopology` object literal, no database. Create `tests/unit/topology-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  layoutTopology,
  NODE_WIDTH,
  NODE_HEIGHT,
} from '@/lib/diagnostics/topology-layout'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'

function component(id: string, name: string) {
  return {
    id,
    slug: id,
    name,
    kind: 'sensor',
    location: null,
    function: null,
    electricalContract: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [],
    testActions: [],
  }
}

function makeTopology(): SystemTopology {
  return {
    platform: { slug: 'p', name: 'Platform' },
    symptom: { slug: 's', description: 'symptom' },
    system: 'fuel',
    components: [
      component('a', 'PCM'),
      component('b', 'FRP Sensor'),
      component('c', 'Lift Pump'),
    ],
    connections: [
      {
        id: 'e1',
        fromComponentId: 'a',
        toComponentId: 'b',
        connectionKind: 'electrical-wire',
        direction: 'bidirectional',
        description: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        id: 'e2',
        fromComponentId: 'a',
        toComponentId: 'c',
        connectionKind: 'electrical-wire',
        direction: 'unidirectional',
        description: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ],
  }
}

describe('layoutTopology', () => {
  it('places every component, keyed by id', () => {
    const layout = layoutTopology(makeTopology())
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('is deterministic — the same topology lays out identically', () => {
    const topo = makeTopology()
    expect(layoutTopology(topo)).toEqual(layoutTopology(topo))
  })

  it('gives every node the fixed footprint', () => {
    for (const n of layoutTopology(makeTopology()).nodes) {
      expect(n.width).toBe(NODE_WIDTH)
      expect(n.height).toBe(NODE_HEIGHT)
    }
  })

  it('produces non-overlapping node rectangles', () => {
    const { nodes } = layoutTopology(makeTopology())
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const overlap =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        expect(overlap).toBe(false)
      }
    }
  })

  it('returns an empty layout for an empty component list', () => {
    const empty = { ...makeTopology(), components: [], connections: [] }
    expect(layoutTopology(empty).nodes).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-layout`
Expected: FAIL — cannot resolve `@/lib/diagnostics/topology-layout`.

- [ ] **Step 3: Implement `layoutTopology`**

Create `lib/diagnostics/topology-layout.ts`:

```ts
import dagre from '@dagrejs/dagre'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'

/**
 * Fixed node footprint. The diagram CSS (`.topo-node` in topology.css) MUST
 * size nodes to match, or edges will not meet node borders cleanly.
 */
export const NODE_WIDTH = 210
export const NODE_HEIGHT = 86

export type TopologyNodeLayout = {
  id: string
  /** Top-left corner — React Flow's coordinate convention. */
  x: number
  y: number
  width: number
  height: number
}

export type TopologyLayout = {
  nodes: TopologyNodeLayout[]
  width: number
  height: number
}

/**
 * Pure layered layout: SystemTopology -> deterministic node positions.
 * dagre is deterministic, so the same topology always lays out the same way
 * (snapshot-testable). The PCM reads as the hub because every other fuel
 * component connects to it, so dagre ranks it at the top.
 */
export function layoutTopology(topology: SystemTopology): TopologyLayout {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const c of topology.components) {
    g.setNode(c.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const conn of topology.connections) {
    // The loader guarantees both endpoints are in the set, but guard so a
    // stray edge can never make dagre throw.
    if (g.hasNode(conn.fromComponentId) && g.hasNode(conn.toComponentId)) {
      g.setEdge(conn.fromComponentId, conn.toComponentId)
    }
  }

  dagre.layout(g)

  const nodes: TopologyNodeLayout[] = topology.components.map((c) => {
    const n = g.node(c.id)
    // dagre reports the node CENTRE; React Flow positions by TOP-LEFT.
    return {
      id: c.id,
      x: n.x - NODE_WIDTH / 2,
      y: n.y - NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }
  })

  const graph = g.graph()
  return { nodes, width: graph.width ?? 0, height: graph.height ?? 0 }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-layout`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/diagnostics/topology-layout.ts tests/unit/topology-layout.test.ts
git commit -m "feat(topology): add layoutTopology dagre layout function"
```

---

### Task 3: `toFlowElements` — topology → React Flow nodes/edges

**Files:**
- Create: `components/topology/topology-flow.ts`
- Test: `tests/unit/topology-flow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/topology-flow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toFlowElements } from '@/components/topology/topology-flow'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'

function component(id: string, name: string, kind = 'sensor') {
  return {
    id,
    slug: id,
    name,
    kind,
    location: null,
    function: null,
    electricalContract: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [],
    testActions: [],
  }
}

const topology: SystemTopology = {
  platform: { slug: 'p', name: 'Platform' },
  symptom: { slug: 's', description: 'symptom' },
  system: 'fuel',
  components: [component('a', 'PCM', 'module'), component('b', 'FRP', 'sensor')],
  connections: [
    {
      id: 'e1',
      fromComponentId: 'a',
      toComponentId: 'b',
      connectionKind: 'electrical-wire',
      direction: 'unidirectional',
      description: 'PCM reads FRP',
      sourceProvenance: 'TRAINING-CONFIRMED',
    },
  ],
}

const layout: TopologyLayout = {
  width: 400,
  height: 300,
  nodes: [
    { id: 'a', x: 10, y: 20, width: 210, height: 86 },
    { id: 'b', x: 30, y: 200, width: 210, height: 86 },
  ],
}

describe('toFlowElements', () => {
  it('maps every component to a topology node at its laid-out position', () => {
    const { nodes } = toFlowElements(topology, layout, null)
    expect(nodes).toHaveLength(2)
    const a = nodes.find((n) => n.id === 'a')!
    expect(a.type).toBe('topology')
    expect(a.position).toEqual({ x: 10, y: 20 })
    expect(a.data.component.name).toBe('PCM')
  })

  it('maps every connection to an edge with source/target ids', () => {
    const { edges } = toFlowElements(topology, layout, null)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ id: 'e1', source: 'a', target: 'b' })
  })

  it('classes each edge by connection_kind for CSS styling', () => {
    const { edges } = toFlowElements(topology, layout, null)
    expect(edges[0].className).toContain('topo-edge--electrical-wire')
  })

  it('flags the selected node and edge', () => {
    const sel = toFlowElements(topology, layout, 'a')
    expect(sel.nodes.find((n) => n.id === 'a')!.data.selected).toBe(true)
    expect(sel.nodes.find((n) => n.id === 'b')!.data.selected).toBe(false)
    const selEdge = toFlowElements(topology, layout, 'e1')
    expect(selEdge.edges[0].className).toContain('is-selected')
  })

  it('falls back to {0,0} when a component has no layout entry', () => {
    const { nodes } = toFlowElements(topology, { ...layout, nodes: [] }, null)
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-flow`
Expected: FAIL — cannot resolve `@/components/topology/topology-flow`.

- [ ] **Step 3: Implement `toFlowElements`**

Create `components/topology/topology-flow.ts`:

```ts
import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyConnection,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'

export type TopologyNodeData = {
  component: TopologyComponent
  selected: boolean
}
export type TopologyEdgeData = {
  connection: TopologyConnection
}

export type TopologyFlowNode = Node<TopologyNodeData, 'topology'>
export type TopologyFlowEdge = Edge<TopologyEdgeData>

/**
 * Build the React Flow node + edge arrays from a topology and its layout.
 * Pure — no React, no DOM — so it is fully unit-testable. `selectedId` is the
 * id of the selected component OR connection; it is stamped onto node data
 * and edge classes so the canvas can style the selection.
 */
export function toFlowElements(
  topology: SystemTopology,
  layout: TopologyLayout,
  selectedId: string | null,
): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const positionById = new Map(layout.nodes.map((n) => [n.id, n]))

  const nodes: TopologyFlowNode[] = topology.components.map((component) => {
    const pos = positionById.get(component.id)
    return {
      id: component.id,
      type: 'topology',
      position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
      data: { component, selected: selectedId === component.id },
    }
  })

  const edges: TopologyFlowEdge[] = topology.connections.map((connection) => {
    const isSelected = selectedId === connection.id
    return {
      id: connection.id,
      source: connection.fromComponentId,
      target: connection.toComponentId,
      type: 'smoothstep',
      data: { connection },
      // connection_kind drives colour; class keeps the palette in topology.css
      // (spec D4). `is-selected` thickens/highlights the chosen edge.
      className: `topo-edge topo-edge--${connection.connectionKind}${
        isSelected ? ' is-selected' : ''
      }`,
      markerEnd:
        connection.direction === 'unidirectional'
          ? { type: MarkerType.ArrowClosed }
          : undefined,
    }
  })

  return { nodes, edges }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-flow`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add components/topology/topology-flow.ts tests/unit/topology-flow.test.ts
git commit -m "feat(topology): add toFlowElements mapper"
```

---

### Task 4: `topology.css` + `<TopologyNode>`

**Files:**
- Create: `components/topology/topology.css`
- Create: `components/topology/topology-node.tsx`

This task creates the **entire** topology stylesheet (later tasks only reference its classes — no other task edits it, avoiding parallel-edit conflicts) and the React Flow custom node. There is no unit test: the node needs React Flow context (`<Handle>`) and is exercised by Task 6's diagram smoke test. Visual values here are functional starting points — Task 9 refines them against the prototype with a screenshot.

- [ ] **Step 1: Create the stylesheet**

Create `components/topology/topology.css`. Uses existing `--vt-*` design tokens from `app/globals.css` (the bone palette, fonts, `--vt-elem-*` system colours, `--vt-shadow-sheet`). The 1024px breakpoint matches the project convention.

```css
/* Interactive wiring-topology diagnostic — PR-B.
   Tokens (--vt-*) are defined in app/globals.css. */

/* ---- layout shell --------------------------------------------------- */
.topo {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: var(--vt-space-6);
  align-items: stretch;
  height: 100dvh;
  padding: var(--vt-space-5);
  background: var(--vt-bg);
}
.topo__header {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.topo__eyebrow {
  font-family: var(--vt-font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--vt-fg-3);
}
.topo__title {
  font-family: var(--vt-font-serif);
  font-size: var(--vt-fs-32);
  color: var(--vt-fg);
}
.topo__vehicle {
  font-family: var(--vt-font-mono);
  font-size: 13px;
  color: var(--vt-fg-2);
}

/* ---- canvas --------------------------------------------------------- */
.topo__canvas {
  position: relative;
  min-height: 0;
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-2);
  background: var(--vt-bone-100);
  overflow: hidden;
}
.topo__canvas .react-flow__attribution { display: none; }

/* ---- node ----------------------------------------------------------- */
.topo-node {
  width: 210px;
  height: 86px;
  box-sizing: border-box;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--vt-bone-50);
  border: 1.4px solid var(--vt-fg);
  border-radius: var(--vt-radius-1);
  cursor: pointer;
  transition: box-shadow var(--vt-dur-2) var(--vt-ease);
}
.topo-node:hover { box-shadow: var(--vt-shadow-pop); }
.topo-node.is-selected {
  border-color: var(--vt-amber-500);
  border-width: 2px;
}
.topo-node--mechanical {
  background: var(--vt-bone-100);
  border-style: dashed;
  border-color: var(--vt-bone-400);
}
.topo-node--splice,
.topo-node--connector { border-radius: var(--vt-radius-3); }
.topo-node__name {
  font-family: var(--vt-font-serif);
  font-size: 15px;
  color: var(--vt-fg);
}
.topo-node__kind {
  font-family: var(--vt-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vt-fg-3);
}
.topo-node__loc {
  font-family: var(--vt-font-mono);
  font-size: 9px;
  color: var(--vt-fg-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topo-node__gap {
  font-family: var(--vt-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vt-amber-600);
}
/* connection handles exist for React Flow edge routing — keep them invisible */
.topo-handle {
  opacity: 0;
  pointer-events: none;
}

/* ---- edges (connection_kind palette, spec D4) ----------------------- */
.topo-edge .react-flow__edge-path { stroke-width: 2; }
.topo-edge.is-selected .react-flow__edge-path { stroke-width: 3.5; }
.topo-edge--electrical-wire .react-flow__edge-path { stroke: var(--vt-elem-voltage); }
.topo-edge--fluid-line .react-flow__edge-path { stroke: var(--vt-elem-fuel); }
.topo-edge--mechanical-linkage .react-flow__edge-path { stroke: var(--vt-elem-mech); }
.topo-edge--can-bus .react-flow__edge-path { stroke: var(--vt-signal-500); }
.topo-edge--controlled_by .react-flow__edge-path { stroke: var(--vt-graphite-600); }
.topo-edge--reports_to .react-flow__edge-path { stroke: var(--vt-graphite-500); }

/* ---- detail panel --------------------------------------------------- */
.topo-panel {
  display: flex;
  flex-direction: column;
  gap: var(--vt-space-3);
  padding: var(--vt-space-5);
  background: var(--vt-surface);
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-2);
  overflow-y: auto;
}
.topo-panel__empty {
  margin: auto;
  text-align: center;
  color: var(--vt-fg-3);
  font-family: var(--vt-font-serif);
  font-size: var(--vt-fs-18);
}
.topo-panel__kind {
  font-family: var(--vt-font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--vt-amber-600);
}
.topo-panel__title {
  font-family: var(--vt-font-serif);
  font-size: var(--vt-fs-24);
  color: var(--vt-fg);
}
.topo-panel__row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--vt-rule);
  font-size: 13px;
}
.topo-panel__row-label {
  font-family: var(--vt-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vt-fg-3);
}
.topo-panel__section-title {
  font-family: var(--vt-font-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--vt-fg);
  margin-top: var(--vt-space-2);
}
.topo-panel__probe,
.topo-panel__test {
  padding: 8px 10px;
  background: var(--vt-bone-50);
  border: 1px solid var(--vt-rule);
  border-radius: var(--vt-radius-1);
  font-size: 12.5px;
}
.topo-panel__test.is-implicated { border-color: var(--vt-amber-400); }
.topo-panel__provenance {
  align-self: flex-start;
  font-family: var(--vt-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 7px;
  border: 1px solid var(--vt-rule);
  border-radius: var(--vt-radius-1);
  color: var(--vt-fg-3);
}
.topo-panel__provenance[data-provenance='GAP'] {
  color: var(--vt-amber-600);
  border-color: var(--vt-amber-400);
}
.topo-panel__link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--vt-signal-600);
  cursor: pointer;
  text-align: left;
}

/* ---- mobile: stack; panel becomes a tap-to-open sheet --------------- */
@media (max-width: 1023px) {
  .topo {
    grid-template-columns: 1fr;
    height: 100dvh;
  }
  .topo__canvas { min-height: 0; }
  .topo-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 72dvh;
    border-radius: var(--vt-radius-3) var(--vt-radius-3) 0 0;
    box-shadow: var(--vt-shadow-sheet);
    transform: translateY(100%);
    transition: transform var(--vt-dur-3) var(--vt-ease);
    z-index: 20;
  }
  .topo-panel.is-open { transform: translateY(0); }
}
```

- [ ] **Step 2: Create the custom node**

Create `components/topology/topology-node.tsx`:

```tsx
'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { TopologyFlowNode } from './topology-flow'

/**
 * React Flow custom node — the bone faceplate. Styled by component `kind`
 * via a `topo-node--<kind>` class (see topology.css). The two Handles exist
 * only so React Flow can route edges; they are visually hidden.
 */
export function TopologyNode({ data }: NodeProps<TopologyFlowNode>) {
  const { component, selected } = data
  return (
    <div
      className={`topo-node topo-node--${component.kind}${
        selected ? ' is-selected' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="topo-handle" />
      <div className="topo-node__name">{component.name}</div>
      <div className="topo-node__kind">{component.kind}</div>
      {component.location && (
        <div className="topo-node__loc">{component.location}</div>
      )}
      {component.sourceProvenance === 'GAP' && (
        <div className="topo-node__gap">needs field check</div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="topo-handle"
      />
    </div>
  )
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: PASS — no type errors in the new files. (`NodeProps<TopologyFlowNode>` is the React Flow v12 signature.)

- [ ] **Step 4: Commit**

```bash
git add components/topology/topology.css components/topology/topology-node.tsx
git commit -m "feat(topology): add topology stylesheet + custom node"
```

---

### Task 5: `<TopologyDetailPanel>` — the detail panel

**Files:**
- Create: `components/topology/topology-detail-panel.tsx`
- Test: `tests/unit/topology-detail-panel.test.tsx`

Implements spec §8. Pure presentational — no React Flow, fully RTL-testable.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/topology-detail-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDetailPanel } from '@/components/topology/topology-detail-panel'
import type {
  TopologyComponent,
  TopologyConnection,
} from '@/lib/diagnostics/load-system-topology'

const frp: TopologyComponent = {
  id: 'frp',
  slug: 'frp',
  name: 'FRP Sensor',
  kind: 'sensor',
  location: 'Front of DS rail',
  function: 'Reports rail pressure',
  electricalContract: '3-wire analog',
  sourceProvenance: 'TRAINING-CONFIRMED',
  observableProperties: [
    { slug: 'op1', description: 'Back-probe the signal pin', observationMethod: 'electrical_measurement_at_pin' },
  ],
  testActions: [
    {
      slug: 'ta-not',
      description: 'Check FRP at idle',
      scenarioRequired: 'idle',
      observationMethod: 'scan_tool_pid',
      expectedObservation: 'Idle pressure',
      invasiveness: 1,
      implicatedByCurrentSymptom: false,
      branches: [],
    },
    {
      slug: 'ta-imp',
      description: 'Check FRP at key-on',
      scenarioRequired: 'key-on',
      observationMethod: 'scan_tool_pid',
      expectedObservation: '26,000-28,000 PSI',
      invasiveness: 1,
      implicatedByCurrentSymptom: true,
      branches: [{ condition: 'Below range', verdict: 'fail', nextAction: 'Suspect supply' }],
    },
  ],
}

const pcm: TopologyComponent = {
  id: 'pcm',
  slug: 'pcm',
  name: 'PCM',
  kind: 'module',
  location: null,
  function: null,
  electricalContract: null,
  sourceProvenance: 'GAP',
  observableProperties: [],
  testActions: [],
}

describe('TopologyDetailPanel', () => {
  it('shows the empty-state prompt when nothing is selected', () => {
    render(<TopologyDetailPanel selection={{ kind: 'empty' }} onSelectComponent={vi.fn()} />)
    expect(screen.getByText(/click any part or line/i)).toBeInTheDocument()
  })

  it('renders a component name, location, and function', () => {
    render(
      <TopologyDetailPanel selection={{ kind: 'component', component: frp }} onSelectComponent={vi.fn()} />,
    )
    expect(screen.getByText('FRP Sensor')).toBeInTheDocument()
    expect(screen.getByText('Front of DS rail')).toBeInTheDocument()
    expect(screen.getByText('Reports rail pressure')).toBeInTheDocument()
  })

  it('soft-fails missing fields to an em dash, never crashes', () => {
    render(
      <TopologyDetailPanel selection={{ kind: 'component', component: pcm }} onSelectComponent={vi.fn()} />,
    )
    expect(screen.getByText('PCM')).toBeInTheDocument()
    // location + function + electrical contract all null -> dashes shown
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('orders symptom-implicated test actions before the rest', () => {
    render(
      <TopologyDetailPanel selection={{ kind: 'component', component: frp }} onSelectComponent={vi.fn()} />,
    )
    const tests = screen.getAllByTestId('topo-test')
    expect(tests[0]).toHaveTextContent('Check FRP at key-on') // implicated first
    expect(tests[1]).toHaveTextContent('Check FRP at idle')
  })

  it('renders a GAP provenance marker as "needs field verification"', () => {
    render(
      <TopologyDetailPanel selection={{ kind: 'component', component: pcm }} onSelectComponent={vi.fn()} />,
    )
    expect(screen.getByText(/needs field verification/i)).toBeInTheDocument()
  })

  it('renders a connection: description, kind, direction, and both endpoints', () => {
    const connection: TopologyConnection = {
      id: 'c1',
      fromComponentId: 'pcm',
      toComponentId: 'frp',
      connectionKind: 'electrical-wire',
      direction: 'bidirectional',
      description: 'PCM reads the FRP signal',
      sourceProvenance: 'TRAINING-CONFIRMED',
    }
    const onSelect = vi.fn()
    render(
      <TopologyDetailPanel
        selection={{ kind: 'connection', connection, fromComponent: pcm, toComponent: frp }}
        onSelectComponent={onSelect}
      />,
    )
    expect(screen.getByText('PCM reads the FRP signal')).toBeInTheDocument()
    expect(screen.getByText(/electrical-wire/i)).toBeInTheDocument()
    // clicking an endpoint jumps back to that component
    fireEvent.click(screen.getByRole('button', { name: /FRP Sensor/i }))
    expect(onSelect).toHaveBeenCalledWith('frp')
  })

  it('never says the word "AI" anywhere in the panel', () => {
    const { container } = render(
      <TopologyDetailPanel selection={{ kind: 'component', component: frp }} onSelectComponent={vi.fn()} />,
    )
    expect(container.textContent ?? '').not.toMatch(/\bAI\b/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-detail-panel`
Expected: FAIL — cannot resolve `@/components/topology/topology-detail-panel`.

- [ ] **Step 3: Implement the panel**

Create `components/topology/topology-detail-panel.tsx`. `import './topology.css'` is intentionally omitted here — the diagram component owns the single CSS import (Task 6) so it loads once.

```tsx
import type {
  TopologyComponent,
  TopologyConnection,
} from '@/lib/diagnostics/load-system-topology'

/** What the panel is currently showing. */
export type TopologySelection =
  | { kind: 'empty' }
  | { kind: 'component'; component: TopologyComponent }
  | {
      kind: 'connection'
      connection: TopologyConnection
      fromComponent: TopologyComponent | null
      toComponent: TopologyComponent | null
    }

type Props = {
  selection: TopologySelection
  /** Jump the panel to a component (used by connection-endpoint buttons). */
  onSelectComponent: (componentId: string) => void
  /** Mobile: present as an open bottom sheet. */
  open?: boolean
}

/** Missing display values soft-fail to an em dash — never crash the page. */
function field(value: string | null): string {
  return value && value.trim() !== '' ? value : '—'
}

const PROVENANCE_LABEL: Record<string, string> = {
  'TRAINING-CONFIRMED': 'from theory',
  'TRAINING-INFERRED': 'inferred from theory',
  'FIELD-VERIFIED': 'field-verified',
  GAP: 'needs field verification',
}

function Provenance({ value }: { value: string }) {
  return (
    <span className="topo-panel__provenance" data-provenance={value}>
      {PROVENANCE_LABEL[value] ?? value.toLowerCase()}
    </span>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="topo-panel__row">
      <span className="topo-panel__row-label">{label}</span>
      <span>{value}</span>
    </div>
  )
}

function ComponentBody({ component }: { component: TopologyComponent }) {
  // Spec §8: symptom-implicated test actions surface first.
  const tests = [...component.testActions].sort(
    (a, b) =>
      Number(b.implicatedByCurrentSymptom) - Number(a.implicatedByCurrentSymptom),
  )
  return (
    <>
      <div className="topo-panel__kind">{component.kind}</div>
      <h2 className="topo-panel__title">{component.name}</h2>
      <Provenance value={component.sourceProvenance} />

      <Row label="Location" value={field(component.location)} />
      <Row label="Function" value={field(component.function)} />
      <Row label="Electrical" value={field(component.electricalContract)} />

      {component.observableProperties.length > 0 && (
        <>
          <div className="topo-panel__section-title">Probe points</div>
          {component.observableProperties.map((op) => (
            <div key={op.slug} className="topo-panel__probe">
              <div>{op.description}</div>
              <div className="topo-panel__row-label">{op.observationMethod}</div>
            </div>
          ))}
        </>
      )}

      {tests.length > 0 && (
        <>
          <div className="topo-panel__section-title">
            What to expect / what a wrong reading means
          </div>
          {tests.map((t) => (
            <div
              key={t.slug}
              data-testid="topo-test"
              className={`topo-panel__test${
                t.implicatedByCurrentSymptom ? ' is-implicated' : ''
              }`}
            >
              <div>{t.description}</div>
              {t.expectedObservation && (
                <div className="topo-panel__row-label">
                  expect: {t.expectedObservation}
                </div>
              )}
              {/* Branches sorted by condition — stable display order
                  (PR-A code-review follow-up: branch_logic has no DB order). */}
              {[...t.branches]
                .sort((a, b) => a.condition.localeCompare(b.condition))
                .map((b, i) => (
                  <div key={i}>
                    {b.condition} → {b.verdict}: {b.nextAction}
                  </div>
                ))}
            </div>
          ))}
        </>
      )}
    </>
  )
}

function ConnectionBody({
  connection,
  fromComponent,
  toComponent,
  onSelectComponent,
}: {
  connection: TopologyConnection
  fromComponent: TopologyComponent | null
  toComponent: TopologyComponent | null
  onSelectComponent: (id: string) => void
}) {
  return (
    <>
      <div className="topo-panel__kind">connection</div>
      <h2 className="topo-panel__title">{connection.connectionKind}</h2>
      <Provenance value={connection.sourceProvenance} />

      <Row label="Description" value={field(connection.description)} />
      <Row label="Kind" value={connection.connectionKind} />
      <Row label="Direction" value={connection.direction} />

      <div className="topo-panel__section-title">Links</div>
      {[fromComponent, toComponent].map((c, i) =>
        c ? (
          <button
            key={c.id}
            type="button"
            className="topo-panel__link"
            onClick={() => onSelectComponent(c.id)}
          >
            {i === 0 ? 'From' : 'To'}: {c.name}
          </button>
        ) : null,
      )}
    </>
  )
}

export function TopologyDetailPanel({ selection, onSelectComponent, open }: Props) {
  return (
    <aside
      className={`topo-panel${open ? ' is-open' : ''}`}
      aria-live="polite"
    >
      {selection.kind === 'empty' && (
        <div className="topo-panel__empty">
          Click any part or line to see what it is, where it is, and what to
          expect when you probe it.
        </div>
      )}
      {selection.kind === 'component' && (
        <ComponentBody component={selection.component} />
      )}
      {selection.kind === 'connection' && (
        <ConnectionBody
          connection={selection.connection}
          fromComponent={selection.fromComponent}
          toComponent={selection.toComponent}
          onSelectComponent={onSelectComponent}
        />
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-detail-panel`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add components/topology/topology-detail-panel.tsx tests/unit/topology-detail-panel.test.tsx
git commit -m "feat(topology): add TopologyDetailPanel"
```

---

### Task 6: `<TopologyDiagram>` — the React Flow canvas

**Files:**
- Create: `components/topology/topology-diagram.tsx`
- Test: `tests/unit/topology-diagram.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/unit/topology-diagram.test.tsx`. The React Flow shim import MUST be first.

```tsx
import '../helpers/react-flow-mock'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'

function component(id: string, name: string) {
  return {
    id, slug: id, name, kind: 'sensor',
    location: null, function: null, electricalContract: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [], testActions: [],
  }
}

const topology: SystemTopology = {
  platform: { slug: 'p', name: 'Platform' },
  symptom: { slug: 's', description: 'symptom' },
  system: 'fuel',
  components: [component('a', 'PCM'), component('b', 'FRP Sensor')],
  connections: [
    {
      id: 'e1', fromComponentId: 'a', toComponentId: 'b',
      connectionKind: 'electrical-wire', direction: 'unidirectional',
      description: null, sourceProvenance: 'TRAINING-CONFIRMED',
    },
  ],
}

describe('TopologyDiagram', () => {
  it('renders a node for every component', () => {
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selectedId={null}
        onSelectComponent={vi.fn()}
        onSelectConnection={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    expect(screen.getByText('PCM')).toBeInTheDocument()
    expect(screen.getByText('FRP Sensor')).toBeInTheDocument()
  })

  it('calls onSelectComponent with the component id when a node is clicked', () => {
    const onSelectComponent = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selectedId={null}
        onSelectComponent={onSelectComponent}
        onSelectConnection={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('PCM'))
    expect(onSelectComponent).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-diagram`
Expected: FAIL — cannot resolve `@/components/topology/topology-diagram`.

- [ ] **Step 3: Implement the diagram**

Create `components/topology/topology-diagram.tsx`. This is the single import site for both the React Flow stylesheet and `topology.css`.

```tsx
'use client'

import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './topology.css'

import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import { toFlowElements, type TopologyFlowNode } from './topology-flow'
import { TopologyNode } from './topology-node'

const nodeTypes: NodeTypes = { topology: TopologyNode }

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  selectedId: string | null
  onSelectComponent: (componentId: string) => void
  onSelectConnection: (connectionId: string) => void
  onClearSelection: () => void
}

/**
 * The interactive pan/zoom canvas. Nodes are not draggable or connectable —
 * the layout is computed (Task 2), the tech only explores. Selection state
 * is owned by the parent (<TopologyDiagnostic>) and passed down.
 */
export function TopologyDiagram({
  topology,
  layout,
  selectedId,
  onSelectComponent,
  onSelectConnection,
  onClearSelection,
}: Props) {
  const { nodes, edges } = useMemo(
    () => toFlowElements(topology, layout, selectedId),
    [topology, layout, selectedId],
  )

  const onNodeClick: NodeMouseHandler<TopologyFlowNode> = (_event, node) => {
    onSelectComponent(node.id)
  }
  const onEdgeClick: EdgeMouseHandler = (_event, edge) => {
    onSelectConnection(edge.id)
  }

  return (
    <div className="topo__canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onClearSelection}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        colorMode="light"
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-diagram`
Expected: PASS — both smoke tests green. (If React Flow warns about node dimensions in the console, that is expected under happy-dom and not a failure.)

- [ ] **Step 5: Commit**

```bash
git add components/topology/topology-diagram.tsx tests/unit/topology-diagram.test.tsx
git commit -m "feat(topology): add TopologyDiagram React Flow canvas"
```

---

### Task 7: `<TopologyDiagnostic>` — the composer

**Files:**
- Create: `components/screens/topology-diagnostic.tsx`
- Test: `tests/unit/topology-diagnostic.test.tsx`

Sibling of `cached-overview.tsx`. Owns selection state; resolves a clicked node/edge id into a `TopologySelection`; composes header + diagram + panel. `'use client'` (it holds state).

- [ ] **Step 1: Write the failing smoke test**

Create `tests/unit/topology-diagnostic.test.tsx`:

```tsx
import '../helpers/react-flow-mock'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDiagnostic } from '@/components/screens/topology-diagnostic'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'

function component(id: string, name: string) {
  return {
    id, slug: id, name, kind: 'sensor',
    location: 'somewhere', function: 'does a thing', electricalContract: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [], testActions: [],
  }
}

const topology: SystemTopology = {
  platform: { slug: 'ford-sd', name: 'Ford Super Duty (2017-2022)' },
  symptom: { slug: 'p0087', description: 'Fuel rail pressure too low' },
  system: 'fuel',
  components: [component('a', 'PCM'), component('b', 'FRP Sensor')],
  connections: [],
}

describe('TopologyDiagnostic', () => {
  it('renders the vehicle + symptom header and an empty panel', () => {
    render(<TopologyDiagnostic topology={topology} layout={layoutTopology(topology)} vehicleName="2019 Ford F-250" />)
    expect(screen.getByText('2019 Ford F-250')).toBeInTheDocument()
    expect(screen.getByText(/fuel rail pressure too low/i)).toBeInTheDocument()
    expect(screen.getByText(/click any part or line/i)).toBeInTheDocument()
  })

  it('fills the panel with the component when its node is clicked', () => {
    render(<TopologyDiagnostic topology={topology} layout={layoutTopology(topology)} vehicleName="2019 Ford F-250" />)
    fireEvent.click(screen.getByText('FRP Sensor'))
    // panel title now shows the component; "does a thing" is its function row
    expect(screen.getByText('does a thing')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-diagnostic`
Expected: FAIL — cannot resolve `@/components/screens/topology-diagnostic`.

- [ ] **Step 3: Implement the composer**

Create `components/screens/topology-diagnostic.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import {
  TopologyDetailPanel,
  type TopologySelection,
} from '@/components/topology/topology-detail-panel'

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  vehicleName: string
}

/** Selection is tracked as a single id — component id OR connection id. */
export function TopologyDiagnostic({ topology, layout, vehicleName }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const componentById = useMemo(
    () => new Map(topology.components.map((c) => [c.id, c])),
    [topology],
  )
  const connectionById = useMemo(
    () => new Map(topology.connections.map((c) => [c.id, c])),
    [topology],
  )

  // Resolve the selected id into what the panel renders.
  const selection: TopologySelection = useMemo(() => {
    if (!selectedId) return { kind: 'empty' }
    const component = componentById.get(selectedId)
    if (component) return { kind: 'component', component }
    const connection = connectionById.get(selectedId)
    if (connection) {
      return {
        kind: 'connection',
        connection,
        fromComponent: componentById.get(connection.fromComponentId) ?? null,
        toComponent: componentById.get(connection.toComponentId) ?? null,
      }
    }
    return { kind: 'empty' }
  }, [selectedId, componentById, connectionById])

  return (
    <div className="topo">
      <header className="topo__header">
        <Link
          href="/today"
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: 'var(--vt-fg-3)',
            textDecoration: 'none',
          }}
        >
          ← Sessions
        </Link>
        <div className="topo__eyebrow">
          Wiring topology · {topology.system} system
        </div>
        <h1 className="topo__title">{topology.symptom.description}</h1>
        <div className="topo__vehicle">
          {vehicleName} · {topology.platform.name}
        </div>
      </header>

      <TopologyDiagram
        topology={topology}
        layout={layout}
        selectedId={selectedId}
        onSelectComponent={setSelectedId}
        onSelectConnection={setSelectedId}
        onClearSelection={() => setSelectedId(null)}
      />

      <TopologyDetailPanel
        selection={selection}
        onSelectComponent={setSelectedId}
        open={selection.kind !== 'empty'}
      />
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-diagnostic`
Expected: PASS — both smoke tests green.

- [ ] **Step 5: Run the full unit suite — no regressions**

Run: `pnpm test`
Expected: PASS (every topology test + all pre-existing tests). Re-run once if a cold run shows PGlite flake.

- [ ] **Step 6: Commit**

```bash
git add components/screens/topology-diagnostic.tsx tests/unit/topology-diagnostic.test.tsx
git commit -m "feat(topology): add TopologyDiagnostic composer"
```

---

### Task 8: Route swap — render the diagram on a cache hit

**Files:**
- Modify: `app/(app)/sessions/[id]/page.tsx`

The `cached-overview` branch currently calls `loadCachedDiagnostic` and renders `<CachedOverview>`. Swap it to load the topology and render `<TopologyDiagnostic>`. `loadCachedDiagnostic` / `<CachedOverview>` stay in the file but off this path (spec §6 — removal is later cleanup).

- [ ] **Step 1: Update the imports**

In `app/(app)/sessions/[id]/page.tsx`, replace this line:

```ts
import { loadCachedDiagnostic } from '@/lib/diagnostics/cached-lookup'
```

with these three:

```ts
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'
import { TopologyDiagnostic } from '@/components/screens/topology-diagnostic'
```

Then **delete** the now-dead import line:

```ts
import { CachedOverview } from '@/components/screens/cached-overview'
```

After the swap, `page.tsx` neither calls `loadCachedDiagnostic` nor renders `<CachedOverview>`, so both imports are dead. The component *file* `components/screens/cached-overview.tsx` stays in the repo (spec §6 — file removal is later cleanup); only the unused import line is removed here. Leave every other import (`formatVehicleName`, `eq`, `platforms`, `symptoms`, `sessionEvents`, …) untouched — the other route branches still use them.

- [ ] **Step 2: Replace the body of the `cached-overview` branch**

Replace this block (currently lines ~66–81 — the `loadCachedDiagnostic` call through the `<CachedOverview>` return):

```tsx
    const diagnostic = await loadCachedDiagnostic({
      db,
      platformSlug: platformRow.slug,
      symptomSlug: symptomRow.slug,
    })
    if (!diagnostic) notFound()

    return (
      <CachedOverview
        sessionId={session.id}
        diagnostic={diagnostic}
        vehicleName={formatVehicleName(session.intake)}
        vin={null}
        mileage={session.intake.mileage ?? null}
      />
    )
```

with:

```tsx
    const topology = await loadSystemTopology({
      db,
      platformSlug: platformRow.slug,
      symptomSlug: symptomRow.slug,
    })

    // Spec §10: a null topology (no system tagged, or no components) renders
    // a clean empty state — never a 500, never notFound().
    if (!topology) {
      return (
        <div
          style={{
            display: 'flex',
            minHeight: '100dvh',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '24px',
            fontFamily: 'var(--vt-font-serif)',
            fontSize: 'var(--vt-fs-18)',
            color: 'var(--vt-fg-3)',
          }}
        >
          A system diagram is not available for this vehicle yet.
        </div>
      )
    }

    return (
      <TopologyDiagnostic
        topology={topology}
        layout={layoutTopology(topology)}
        vehicleName={formatVehicleName(session.intake)}
      />
    )
```

The surrounding `cached-overview` branch is unchanged: it still resolves `platformRow` / `symptomRow` from `session.cacheHitPlatformId` / `cacheHitSymptomId` and still `notFound()`s when either is missing.

- [ ] **Step 3: Verify the build and types**

Run: `pnpm exec tsc --noEmit`
Expected: PASS — no type errors.

Run: `pnpm exec next build`
Expected: build succeeds with no unused-import errors — Step 1 already removed the two dead imports.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/sessions/[id]/page.tsx
git commit -m "feat(topology): render TopologyDiagnostic on a cache hit"
```

---

### Task 9: Live validation

**Files:** none — this is verification, not code.

Spec §11 requires validating the real workflow on a real cached code, desktop **and** mobile, with a screenshot to Brandon before any merge.

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Note: the dev server talks to the **live** Supabase project. Any test session rows created here must be cleaned up in Step 5.

- [ ] **Step 2: Reach a cached diagnostic**

Sign in to the running app. Create an intake that resolves to a cached vehicle + symptom — a `6.7 Power Stroke` / `F-350` intake against a fuel symptom (`p0087`, `p0088`, or a no-start-fuel symptom). Confirm the session routes to the topology diagram (not the old test-plan list, not a 500).

- [ ] **Step 2b: Validate with messy real-world input**

Repeat Step 2 using the abbreviated input a tech actually types — e.g. `6.7`, `F350` (no space), a lowercase `p0087`. The diagram must still resolve and render. (The platform/symptom resolvers handle this upstream; this confirms PR-B did not regress it.)

- [ ] **Step 3: Exercise the workflow — desktop**

At a desktop viewport (≥1024px): the diagram renders all ~22 fuel components and their connections; pan and zoom work; clicking a part fills the side panel with its location/function/probe points/expected readings; clicking a connection shows its description and endpoints; clicking an endpoint jumps to that component; clicking empty canvas clears the panel. Confirm the 8 injectors are present as 8 separate clickable nodes. **Keyboard (spec §7):** Tab reaches nodes/edges and Enter or Space selects the focused one, Escape clears. (React Flow renders nodes/edges focusable; if Enter does not trigger selection, that is a small `onKeyDown` follow-up on `<TopologyNode>` — flag it to Brandon rather than widening this PR.) Capture a screenshot: `validation-pr-b-desktop-1440.png`.

- [ ] **Step 4: Exercise the workflow — mobile**

At a 375–414px viewport: the diagram fits the width on load; pinch-zoom and drag work; tapping a part opens the detail panel as a bottom sheet; the sheet dismisses; no horizontal overflow; the header is readable. Capture: `validation-pr-b-mobile-390.png`.

- [ ] **Step 5: Clean up + report**

Delete any test session rows created in Step 2 from the live database. Send both screenshots to Brandon with a one-line status. Do not merge until Brandon has validated (he is the final gate, per project rule).

- [ ] **Step 6: Commit the validation screenshots is NOT required** — screenshots are review artifacts, not source. Leave them untracked.

---

## Self-Review

**Spec coverage:**
- §5.2 `layoutTopology` (pure, deterministic, library = dagre) → Task 2. ✅
- §5.3 `<TopologyDiagram>` (React Flow, custom nodes by kind, edges by connection_kind, pan/zoom/click) → Tasks 3, 4, 6. ✅
- §5.4 / §8 `<TopologyDetailPanel>` (empty / component / connection states, probe points, test actions implicated-first, provenance markers, no "AI" wording) → Task 5. ✅
- §5.5 `<TopologyDiagnostic>` (composes header + diagram + panel) → Task 7. ✅
- §6 route integration (the `cached-overview` branch swap; `cached-lookup`/`<CachedOverview>` left in place) → Task 8. ✅
- §7 the diagram (nodes by kind, edges by connection_kind + direction marker, auto layout, click-select, 8 injectors as separate nodes, mobile) → Tasks 2, 4, 6 + topology.css. ✅
- §10 error handling (loader `null` → empty state; soft-fail `—` on missing fields) → Task 8 Step 2, Task 5 `field()`. ✅
- §11 testing (TDD, layout test, panel tests, live desktop+mobile validation, cleanup) → Tasks 2, 3, 5 + Task 9. ✅
- §13 8-injector treatment (separate nodes) → covered by Task 2/6 rendering each component as its own node; Task 9 Step 3 explicitly checks it. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step carries complete code; every run step carries the exact command and expected result. ✅

**Type consistency:** `SystemTopology`, `TopologyComponent`, `TopologyConnection`, `TopologyTestAction`, etc. are imported from the PR-A loader (`@/lib/diagnostics/load-system-topology`) and never redefined. `TopologyLayout` / `TopologyNodeLayout` are defined once in Task 2 and consumed unchanged in Tasks 3, 6, 7, 8. `TopologyFlowNode` / `TopologyEdgeData` are defined once in Task 3 and consumed in Tasks 4, 6. `TopologySelection` is defined once in Task 5 and consumed in Task 7. `NODE_WIDTH` / `NODE_HEIGHT` are defined once in Task 2; topology.css (Task 4) sizes `.topo-node` to the same `210 × 86`. `layoutTopology` arg shape (`SystemTopology`) and `<TopologyDiagnostic>` props (`{ topology, layout, vehicleName }`) match every call site. ✅

**Known limitation (deliberate, not a gap):** edges use React Flow's built-in `smoothstep` type. The dagre `TB` layout makes most edges flow downward and read cleanly; a minority (`reports_to` edges pointing back up to the PCM) route as longer curves. This is acceptable for v1 and is exactly what Task 9's screenshot check evaluates — if edge readability suffers, floating edges are a documented fast-follow, out of scope for this PR.

## Out of scope (→ later)

Scenario animation, electrical-role wire colouring, pin-level sub-nodes, systems other than fuel, outcome recording, and removing the now-unused `cached-lookup.ts` / `<CachedOverview>` — all per spec §9.
