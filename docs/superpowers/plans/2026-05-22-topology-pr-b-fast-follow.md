# Topology PR-B Fast-Follow Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 5 issues found in the post-merge live validation of PR-B's interactive wiring-topology diagram.

**Architecture:** Five small, independent fixes plus a re-validation, all inside the topology UI (`components/topology/`, `components/screens/topology-diagnostic.tsx`). A new pure module `topology-format.ts` holds two display formatters; the rest are localized component and CSS changes. No database, schema, or loader changes.

**Tech Stack:** TypeScript, React 19, Next 16, `@xyflow/react` (React Flow v12), Vitest + `@testing-library/react` (happy-dom).

**Spec:** `docs/superpowers/specs/2026-05-22-topology-pr-b-fast-follow-design.md`

**Branch:** `fix/topology-pr-b-fast-follow` — already cut from `origin/staging-interactive-diagnostics`, and the spec is already committed on it. Merges back to `staging-interactive-diagnostics`.

**Every commit message ends with this trailer line:**
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

**Test runner note:** `pnpm test <pattern>` runs files matching `<pattern>` once and exits. A cold first run may emit spurious "PGlite is closed" errors (a known fork-pool flake) — re-run once before treating that as a real failure. `pnpm exec tsc --noEmit` type-checks the whole project.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `components/topology/topology-format.ts` | Create | `formatSymptomTitle`, `formatConnectionKind` — pure display formatters |
| `tests/unit/topology-format.test.ts` | Create | Unit tests for both formatters |
| `components/screens/topology-diagnostic.tsx` | Modify | Heading uses `formatSymptomTitle` (Fix 2); passes `onClose` to the panel (Fix 1) |
| `components/topology/topology-detail-panel.tsx` | Modify | Connection title uses `formatConnectionKind` (Fix 5); `onClose` prop + close button (Fix 1) |
| `components/topology/topology.css` | Modify | `.topo-panel__close` styling (Fix 1) |
| `components/topology/topology-diagram.tsx` | Modify | Keyboard selection (Fix 4); readable opening zoom (Fix 3) |
| `tests/unit/topology-diagnostic.test.tsx` | Modify | Updated for the formatted heading |
| `tests/unit/topology-detail-panel.test.tsx` | Modify | `onClose` on all renders; close-button + connection-label assertions |
| `tests/unit/topology-diagram.test.tsx` | Modify | Keyboard-selection tests |

**Task order:** Task 1 (formatters) unblocks Tasks 2 and 3. Tasks 2–5 then run in order (Tasks 2 & 4 both touch `topology-diagnostic.tsx`; Tasks 3 & 4 both touch `topology-detail-panel.tsx` and its test — sequential, no conflict). Task 6 (re-validation) is last and runs in the main session, not a subagent.

---

### Task 1: The `topology-format.ts` formatters

Two pure functions, no React and no DOM — fully unit-testable. `formatSymptomTitle` (Fix 2) turns a symptom slug into a short page title. `formatConnectionKind` (Fix 5) turns a raw `connection_kind` enum value into a human label.

**Files:**
- Create: `components/topology/topology-format.ts`
- Create: `tests/unit/topology-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/topology-format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  formatSymptomTitle,
  formatConnectionKind,
} from '@/components/topology/topology-format'

describe('formatSymptomTitle', () => {
  it('formats a DTC slug as "CODE — Title Case Name"', () => {
    expect(formatSymptomTitle('p0087-fuel-rail-pressure-too-low')).toBe(
      'P0087 — Fuel Rail Pressure Too Low',
    )
  })

  it('title-cases a non-DTC slug throughout', () => {
    expect(formatSymptomTitle('no-start-cranks-normally')).toBe(
      'No Start Cranks Normally',
    )
  })

  it('returns just the code when a DTC slug has no name segments', () => {
    expect(formatSymptomTitle('p0087')).toBe('P0087')
  })

  it('returns an empty string for an empty slug', () => {
    expect(formatSymptomTitle('')).toBe('')
  })
})

describe('formatConnectionKind', () => {
  it('maps known connection kinds to human labels', () => {
    expect(formatConnectionKind('reports_to')).toBe('Reports to')
    expect(formatConnectionKind('electrical-wire')).toBe('Electrical wire')
    expect(formatConnectionKind('can-bus')).toBe('CAN bus')
  })

  it('falls back to separator-stripped, capitalised text for unmapped kinds', () => {
    expect(formatConnectionKind('hydraulic_coupling')).toBe('Hydraulic coupling')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-format`
Expected: FAIL — cannot resolve `@/components/topology/topology-format`.

- [ ] **Step 3: Implement the formatters**

Create `components/topology/topology-format.ts`:

```ts
/**
 * Pure display formatters for the topology UI. No React, no DOM — fully
 * unit-testable. Used by <TopologyDiagnostic> (the page heading) and
 * <TopologyDetailPanel> (the connection title).
 */

/** A diagnostic trouble code: letter P/B/C/U followed by four digits. */
const DTC_PATTERN = /^[pbcu]\d{4}$/i

/** Capitalise the first letter of a single word: "fuel" -> "Fuel". */
function titleCaseWord(word: string): string {
  if (word === '') return ''
  return word[0].toUpperCase() + word.slice(1)
}

/**
 * Turn a symptom slug into a short page title.
 *
 * A slug whose first segment is a DTC code (e.g. `p0087-fuel-rail-pressure-too-low`)
 * becomes `"P0087 — Fuel Rail Pressure Too Low"`. A DTC slug with no further
 * segments becomes just the code. A slug with no DTC prefix
 * (e.g. `no-start-cranks-normally`) is title-cased throughout.
 */
export function formatSymptomTitle(slug: string): string {
  const segments = slug.split('-').filter((s) => s !== '')
  if (segments.length === 0) return ''

  const [first, ...rest] = segments
  if (DTC_PATTERN.test(first)) {
    const code = first.toUpperCase()
    if (rest.length === 0) return code
    return `${code} — ${rest.map(titleCaseWord).join(' ')}`
  }
  return segments.map(titleCaseWord).join(' ')
}

/** `connection_kind` enum value -> human label. */
const CONNECTION_KIND_LABELS: Record<string, string> = {
  'electrical-wire': 'Electrical wire',
  'fluid-line': 'Fluid line',
  'mechanical-linkage': 'Mechanical linkage',
  'can-bus': 'CAN bus',
  'lin-bus': 'LIN bus',
  controlled_by: 'Controlled by',
  reports_to: 'Reports to',
}

/**
 * Turn a raw `connection_kind` enum value into a human-readable label.
 * Unmapped values fall back to separator-stripped, first-letter-capitalised text.
 */
export function formatConnectionKind(kind: string): string {
  const mapped = CONNECTION_KIND_LABELS[kind]
  if (mapped) return mapped
  const spaced = kind.replace(/[-_]/g, ' ').trim()
  if (spaced === '') return ''
  return spaced[0].toUpperCase() + spaced.slice(1)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-format`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 6: Commit**

```bash
git add components/topology/topology-format.ts tests/unit/topology-format.test.ts
git commit -m "fix(topology): add symptom-title and connection-kind formatters" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fix 2 — page heading uses `formatSymptomTitle`

`<TopologyDiagnostic>` currently renders `topology.symptom.description` (a long paragraph that names the wrong vehicle) as the `<h1>`. Switch it to the short slug-derived title.

**Files:**
- Modify: `tests/unit/topology-diagnostic.test.tsx`
- Modify: `components/screens/topology-diagnostic.tsx`

- [ ] **Step 1: Update the test to expect the formatted heading**

In `tests/unit/topology-diagnostic.test.tsx`, change the `symptom` field of the `topology` fixture. Replace:

```ts
  symptom: { slug: 'p0087', description: 'Fuel rail pressure too low' },
```

with:

```ts
  symptom: {
    slug: 'p0087-fuel-rail-pressure-too-low',
    description: 'Fuel rail pressure too low',
  },
```

Then, in the test `'renders the vehicle + symptom header and an empty panel'`, replace this line:

```ts
    expect(screen.getByText(/fuel rail pressure too low/i)).toBeInTheDocument()
```

with:

```ts
    expect(
      screen.getByText('P0087 — Fuel Rail Pressure Too Low'),
    ).toBeInTheDocument()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-diagnostic`
Expected: FAIL — the `<h1>` still renders the `description` ("Fuel rail pressure too low"), so the exact-text query for "P0087 — Fuel Rail Pressure Too Low" finds nothing.

- [ ] **Step 3: Implement — use the formatter for the heading**

In `components/screens/topology-diagnostic.tsx`, add this import alongside the existing imports:

```tsx
import { formatSymptomTitle } from '@/components/topology/topology-format'
```

Then replace this line:

```tsx
        <h1 className="topo__title">{topology.symptom.description}</h1>
```

with:

```tsx
        <h1 className="topo__title">
          {formatSymptomTitle(topology.symptom.slug)}
        </h1>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-diagnostic`
Expected: PASS — both tests in the file green.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/screens/topology-diagnostic.tsx tests/unit/topology-diagnostic.test.tsx
git commit -m "fix(topology): use a short slug-derived title for the diagnostic heading" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Fix 5 — connection title uses `formatConnectionKind`

`<TopologyDetailPanel>`'s `ConnectionBody` renders the raw enum (`reports_to`, `electrical-wire`, …) as the panel `<h2>`. Run it through the formatter.

**Files:**
- Modify: `tests/unit/topology-detail-panel.test.tsx`
- Modify: `components/topology/topology-detail-panel.tsx`

- [ ] **Step 1: Update the connection test assertion**

In `tests/unit/topology-detail-panel.test.tsx`, inside the test `'renders a connection: description, kind, direction, and both endpoints'`, replace:

```ts
    expect(screen.getByText(/electrical-wire/i)).toBeInTheDocument()
```

with:

```ts
    expect(screen.getByText('Electrical wire')).toBeInTheDocument()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test topology-detail-panel`
Expected: FAIL — the connection title still renders `electrical-wire`, so the query for "Electrical wire" finds nothing.

- [ ] **Step 3: Implement — format the connection kind**

In `components/topology/topology-detail-panel.tsx`, add this import at the top of the file:

```tsx
import { formatConnectionKind } from '@/components/topology/topology-format'
```

Then, inside the `ConnectionBody` function, replace this line:

```tsx
      <h2 className="topo-panel__title">{connection.connectionKind}</h2>
```

with:

```tsx
      <h2 className="topo-panel__title">
        {formatConnectionKind(connection.connectionKind)}
      </h2>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test topology-detail-panel`
Expected: PASS — all 7 tests in the file green.

- [ ] **Step 5: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/topology/topology-detail-panel.tsx tests/unit/topology-detail-panel.test.tsx
git commit -m "fix(topology): show a plain-English label for connection kind" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fix 1 — mobile detail-panel close button

On mobile the detail panel is a bottom sheet that, once open, covers the entire diagram with no way to dismiss it. Add an always-present (when a selection exists) close button that clears the selection. `onClose` becomes a **required** prop on `<TopologyDetailPanel>`.

**Files:**
- Modify: `tests/unit/topology-detail-panel.test.tsx`
- Modify: `components/topology/topology-detail-panel.tsx`
- Modify: `components/screens/topology-diagnostic.tsx`
- Modify: `components/topology/topology.css`

- [ ] **Step 1: Write the failing tests**

`onClose` will be a required prop, so every `<TopologyDetailPanel>` render in the test file needs it. Replace the **entire contents** of `tests/unit/topology-detail-panel.test.tsx` with:

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
    render(
      <TopologyDetailPanel
        selection={{ kind: 'empty' }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/click any part or line/i)).toBeInTheDocument()
  })

  it('shows no close button in the empty state', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'empty' }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('renders a component name, location, and function', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('FRP Sensor')).toBeInTheDocument()
    expect(screen.getByText('Front of DS rail')).toBeInTheDocument()
    expect(screen.getByText('Reports rail pressure')).toBeInTheDocument()
  })

  it('soft-fails missing fields to an em dash, never crashes', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: pcm }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('PCM')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('orders symptom-implicated test actions before the rest', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const tests = screen.getAllByTestId('topo-test')
    expect(tests[0]).toHaveTextContent('Check FRP at key-on')
    expect(tests[1]).toHaveTextContent('Check FRP at idle')
  })

  it('renders a GAP provenance marker as "needs field verification"', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: pcm }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
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
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('PCM reads the FRP signal')).toBeInTheDocument()
    expect(screen.getByText('Electrical wire')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /FRP Sensor/i }))
    expect(onSelect).toHaveBeenCalledWith('frp')
  })

  it('shows a close button that calls onClose when a part is selected', () => {
    const onClose = vi.fn()
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never says the word "AI" anywhere in the panel', () => {
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(/\bAI\b/)
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm test topology-detail-panel`
Expected: FAIL — `'shows a close button…'` fails (no button with the accessible name "Close" exists yet). The other tests pass.

- [ ] **Step 3: Implement — `onClose` prop + close button**

In `components/topology/topology-detail-panel.tsx`, replace the `Props` type:

```tsx
type Props = {
  selection: TopologySelection
  /** Jump the panel to a component (used by connection-endpoint buttons). */
  onSelectComponent: (componentId: string) => void
  /** Mobile: present as an open bottom sheet. */
  open?: boolean
}
```

with:

```tsx
type Props = {
  selection: TopologySelection
  /** Jump the panel to a component (used by connection-endpoint buttons). */
  onSelectComponent: (componentId: string) => void
  /** Clear the selection — closes the panel (and the mobile bottom sheet). */
  onClose: () => void
  /** Mobile: present as an open bottom sheet. */
  open?: boolean
}
```

Then replace the `TopologyDetailPanel` export function:

```tsx
export function TopologyDetailPanel({ selection, onSelectComponent, open }: Props) {
  return (
    <aside
      className={`topo-panel${open ? ' is-open' : ''}`}
      aria-live="polite"
    >
      {selection.kind === 'empty' && (
```

with:

```tsx
export function TopologyDetailPanel({
  selection,
  onSelectComponent,
  onClose,
  open,
}: Props) {
  return (
    <aside
      className={`topo-panel${open ? ' is-open' : ''}`}
      aria-live="polite"
    >
      {selection.kind !== 'empty' && (
        <button
          type="button"
          className="topo-panel__close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      )}
      {selection.kind === 'empty' && (
```

(The rest of the function — the empty / component / connection branches and the closing `</aside>` — is unchanged.)

- [ ] **Step 4: Implement — pass `onClose` from `<TopologyDiagnostic>`**

In `components/screens/topology-diagnostic.tsx`, replace:

```tsx
      <TopologyDetailPanel
        selection={selection}
        onSelectComponent={setSelectedId}
        open={selection.kind !== 'empty'}
      />
```

with:

```tsx
      <TopologyDetailPanel
        selection={selection}
        onSelectComponent={setSelectedId}
        onClose={() => setSelectedId(null)}
        open={selection.kind !== 'empty'}
      />
```

- [ ] **Step 5: Implement — style the close button**

In `components/topology/topology.css`, add this block immediately after the `.topo-panel { … }` rule (before `.topo-panel__empty`):

```css
.topo-panel__close {
  position: sticky;
  top: 0;
  align-self: flex-end;
  flex: none;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vt-bone-50);
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-1);
  color: var(--vt-fg-2);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.topo-panel__close:hover {
  background: var(--vt-bone-100);
}
```

`position: sticky; top: 0` keeps the button pinned to the top-right of the panel while the panel body scrolls — important on mobile, where the sheet content is long.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test topology-detail-panel`
Expected: PASS — all 9 tests green.

- [ ] **Step 7: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS — `onClose` is now supplied at the one `<TopologyDetailPanel>` call site (`<TopologyDiagnostic>`).

- [ ] **Step 8: Commit**

```bash
git add components/topology/topology-detail-panel.tsx components/screens/topology-diagnostic.tsx components/topology/topology.css tests/unit/topology-detail-panel.test.tsx
git commit -m "fix(topology): add a close button so the mobile detail sheet can be dismissed" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Fixes 4 + 3 — diagram keyboard selection and readable opening zoom

Two changes to `<TopologyDiagram>`. **Fix 4:** a canvas-level `onKeyDown` so Enter/Space on a focused node selects it and Escape clears the selection. **Fix 3:** a `minZoom` floor in `fitViewOptions` so the diagram opens at a legible zoom.

**Files:**
- Modify: `tests/unit/topology-diagram.test.tsx`
- Modify: `components/topology/topology-diagram.tsx`

- [ ] **Step 1: Write the failing keyboard tests**

In `tests/unit/topology-diagram.test.tsx`, add these two tests immediately before the closing `})` of the `describe('TopologyDiagram', …)` block:

```tsx
  it('selects a node when Enter is pressed on it', () => {
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
    fireEvent.keyDown(screen.getByText('PCM'), { key: 'Enter' })
    expect(onSelectComponent).toHaveBeenCalledWith('a')
  })

  it('clears the selection when Escape is pressed', () => {
    const onClearSelection = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selectedId={null}
        onSelectComponent={vi.fn()}
        onSelectConnection={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    )
    fireEvent.keyDown(screen.getByText('PCM'), { key: 'Escape' })
    expect(onClearSelection).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test topology-diagram`
Expected: FAIL — both new tests fail; there is no key handler, so neither callback is invoked.

- [ ] **Step 3: Implement — replace the whole `topology-diagram.tsx`**

Replace the **entire contents** of `components/topology/topology-diagram.tsx` with:

```tsx
'use client'

import { useMemo, type KeyboardEvent } from 'react'
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
 * the layout is computed, the tech only explores. Selection state is owned by
 * the parent (<TopologyDiagnostic>) and passed down.
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

  // Keyboard selection. React Flow makes nodes focusable but does not select
  // them on Enter/Space. This handler catches the key event bubbling up from a
  // focused node (React Flow stamps the component id onto `data-id`) and
  // selects it; Escape clears the current selection.
  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClearSelection()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!(event.target instanceof HTMLElement)) return
    const nodeEl = event.target.closest<HTMLElement>('.react-flow__node')
    if (nodeEl?.dataset.id) {
      event.preventDefault()
      onSelectComponent(nodeEl.dataset.id)
    }
  }

  return (
    <div className="topo__canvas" onKeyDown={onCanvasKeyDown}>
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
        fitViewOptions={{ padding: 0.2, minZoom: 0.7 }}
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

The only changes from the previous version: the `KeyboardEvent` type import, the `onCanvasKeyDown` handler, `onKeyDown={onCanvasKeyDown}` on the `.topo__canvas` div, and `minZoom: 0.7` added to `fitViewOptions`. `minZoom={0.2}` on `<ReactFlow>` is unchanged, so manual zoom-out still reaches the full overview.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test topology-diagram`
Expected: PASS — all 4 tests in the file green (2 original + 2 new).

- [ ] **Step 5: Run the full unit suite and type-check**

Run: `pnpm test`
Expected: PASS — every topology test plus all pre-existing tests. Re-run once if a cold run shows the PGlite fork-pool flake.

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/topology/topology-diagram.tsx tests/unit/topology-diagram.test.tsx
git commit -m "fix(topology): keyboard-select nodes and open the diagram at a readable zoom" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Live re-validation and PR

**Run this task in the main session** — it needs the signed-in app and the Playwright browser, which the main session holds. Do not dispatch it to a subagent.

**Files:** none — this is verification.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/topology-pr-b-fast-follow
```

- [ ] **Step 2: Get a green preview**

Find the Vercel preview deployment for the pushed branch and confirm it builds green (`vercel ls --meta githubCommitRef=fix/topology-pr-b-fast-follow`). If the build dies at `modifyConfig` (the known Vercel-side flake), redeploy and retry — it is not a code problem.

- [ ] **Step 3: Re-validate on the preview**

Sign in (`brandon@vyntechs.com`) and open the existing cached session
`/sessions/681de115-5de9-474e-9721-263f65066e08` (2017 F-350 / P0087 — reused, no test data created). Confirm, on **desktop (≥1024px)** and **mobile (375–414px)**:

1. **Heading** reads "P0087 — Fuel Rail Pressure Too Low" — not the old paragraph.
2. **Opening zoom** — node names are legible on load without zooming in. If 0.7 is still too small or now overshoots, adjust `minZoom` in `fitViewOptions` (`topology-diagram.tsx`), re-run `pnpm test topology-diagram`, and commit.
3. **Mobile sheet** — tap a part: the sheet opens; the ✕ Close button is visible and tapping it returns to the diagram.
4. **Keyboard** — Tab to a part, press Enter: its panel opens. Press Escape: it clears.
5. **Connection label** — tap a connection: the title reads plain English (e.g. "Reports to"), not `reports_to`.

Capture `validation-pr-b-ff-desktop-1440.png` and `validation-pr-b-ff-mobile-390.png` (leave untracked — screenshots are review artifacts, not source).

- [ ] **Step 4: Open the PR**

Open a PR from `fix/topology-pr-b-fast-follow` into `staging-interactive-diagnostics`. The body states what was fixed and the validation results (desktop + mobile). Brandon reviews and merges — do not merge it yourself.

```bash
gh pr create --base staging-interactive-diagnostics --head fix/topology-pr-b-fast-follow --title "Fast-follow: topology PR-B validation fixes"
```

---

## Self-Review

**Spec coverage** — every fix in the spec maps to a task:
- Fix 1 (mobile panel cannot be dismissed) → Task 4. ✅
- Fix 2 (raw symptom description as heading) → Task 1 (`formatSymptomTitle`) + Task 2 (wiring). ✅
- Fix 3 (opens too zoomed-out) → Task 5 (`fitViewOptions` `minZoom`). ✅
- Fix 4 (keyboard cannot select) → Task 5 (`onCanvasKeyDown`). ✅
- Fix 5 (raw enum in connection panel) → Task 1 (`formatConnectionKind`) + Task 3 (wiring). ✅
- Spec "Testing" — unit tests for both formatters (Task 1), the close button (Task 4), keyboard selection (Task 5); existing tests updated (Tasks 2, 3, 4); live re-validation (Task 6). ✅
- Spec out-of-scope items (messy-input check, Tab focus order, scrim, `cached-lookup` removal) — correctly absent from every task. ✅

**Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N". Every code step carries complete file content or an exact old→new replacement; every run step carries the exact command and expected result. ✅

**Type consistency:** `formatSymptomTitle(slug: string): string` and `formatConnectionKind(kind: string): string` are defined in Task 1 and called with a `string` argument in Tasks 2 and 3. `onClose: () => void` is added to `TopologyDetailPanel`'s `Props` in Task 4 and supplied as `onClose={() => setSelectedId(null)}` at its one call site in the same task. `<TopologyDiagram>`'s `Props` is unchanged across Task 5 (the `onCanvasKeyDown` handler is internal). The import path `@/components/topology/topology-format` is used identically in Tasks 2 and 3. ✅
