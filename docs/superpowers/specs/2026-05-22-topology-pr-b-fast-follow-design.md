# Interactive Topology PR-B — Fast-Follow Fixes — Design

**Date:** 2026-05-22
**Status:** Approved for planning
**Branch:** `fix/topology-pr-b-fast-follow`, cut from `origin/staging-interactive-diagnostics`; merges back to `staging-interactive-diagnostics`.

## Context

PR-B (#88, the interactive wiring-topology diagram UI) merged into `staging-interactive-diagnostics`
on 2026-05-22 without its plan's Task 9 (live validation) formally done. Post-merge live validation —
against a real cached fuel session (2017 F-350 / P0087, platform `ford-super-duty-4th-gen-67-psd`,
session `681de115-5de9-474e-9721-263f65066e08`) on the deployed `staging-interactive-diagnostics`
preview — surfaced 5 issues. All are small; none require a rebuild. This spec covers a single
fast-follow PR fixing all 5.

What already works (confirmed in validation, not changed here): the diagram renders all 22 fuel
components (8 injectors as separate nodes), edges render colour-coded by connection kind, mouse
selection works for components / connections / endpoint jumps / empty-canvas clear, zoom + pan +
Fit View work, and there are no console errors.

## Fixes

### Fix 1 — Mobile detail panel cannot be dismissed

**Problem.** On viewports ≤1023px the detail panel is a `position: fixed` bottom sheet (the mobile
block in `topology.css`). When a part or connection is selected the sheet slides up
(`is-open` → `translateY(0)`). Measured at 390×844 it covers 100% of the diagram canvas (canvas
rect 493–824, sheet rect 236–844 — 0 px of canvas left uncovered). The only code path that clears
the selection is `onPaneClick` → `onClearSelection`, and the pane is entirely behind the sheet.
There is no close button, no scrim, and no swipe handler. Result: after the first tap a phone user
cannot return to the diagram without reloading the page.

**Fix.** Add an explicit close control to `<TopologyDetailPanel>`.

- `<TopologyDetailPanel>` takes a new `onClose: () => void` prop.
- `<TopologyDiagnostic>` passes `onClose={() => setSelectedId(null)}`.
- The panel renders a close button — accessible name "Close", visible ✕ glyph — at its top, only
  when `selection.kind !== 'empty'`.
- Shown on both desktop and mobile. On desktop (the panel is a permanent column) it returns the
  panel to its empty prompt — harmless and consistent.
- Styled in `topology.css` (`.topo-panel__close`), positioned at the top-right of the panel.

Alternatives considered: a tap-to-dismiss scrim over the strip above the sheet, and swipe-down.
Rejected for this pass — a button is the most discoverable and is keyboard/assistive-tech
accessible. A scrim or swipe can be added later if wanted.

**Files:** `components/topology/topology-detail-panel.tsx`, `components/screens/topology-diagnostic.tsx`,
`components/topology/topology.css`.

### Fix 2 — Page heading is the raw symptom description

**Problem.** `<TopologyDiagnostic>` renders `<h1>{topology.symptom.description}</h1>`. The symptom
`description` is a paragraph written for a specific Phase-2 scenario; for symptom
`p0087-fuel-rail-pressure-too-low` it reads "P0087 DTC active, MIL on… Vehicle: 2018 Ford F-250
6.7L Power Stroke Diesel. No prior test results at intake." Two defects: (a) paragraph-length text
in a 32px serif `<h1>` — on mobile it consumes roughly 8 lines / half the screen before the
diagram; (b) it names "2018 Ford F-250", contradicting the actual session vehicle "2017 Ford F-350"
shown on the line directly below.

**Fix.** Derive a short title from `topology.symptom.slug`.

- New pure function `formatSymptomTitle(slug: string): string`.
  - Split the slug on `-`. If the first segment matches `/^[pbcu]\d{4}$/i` it is a DTC code:
    uppercase that segment, title-case the remaining segments, join as `"<CODE> — <Title Case Rest>"`.
    Example: `p0087-fuel-rail-pressure-too-low` → `"P0087 — Fuel Rail Pressure Too Low"`.
    If a DTC slug has no remaining segments, the title is just the code (no trailing dash).
  - Otherwise title-case every segment. Example:
    `no-start-cranks-normally-fuel-system-suspect` → `"No Start Cranks Normally Fuel System Suspect"`.
- `<TopologyDiagnostic>`'s `<h1>` renders `formatSymptomTitle(topology.symptom.slug)`.
- No database or loader change — `slug` is already present on `SystemTopology.symptom`.

**Files:** new `components/topology/topology-format.ts` (`formatSymptomTitle`),
`components/screens/topology-diagnostic.tsx`.

### Fix 3 — Diagram opens too zoomed-out to read

**Problem.** `<TopologyDiagram>` passes `fitView` with `fitViewOptions={{ padding: 0.2 }}`. For the
22-node fuel graph, fitView lands at zoom ≈0.31; node text (15px in the design) renders at ≈5px and
is unreadable. The tech must manually zoom in before the diagram is usable.

**Fix.** Make the opening view sit at a zoom where node text is legible.

- On initial mount, fit the view with a `minZoom` floor so it cannot zoom out past a readable scale
  (target ≈0.6, tuned during implementation against the live diagram). If the graph does not fully
  fit at the floor it opens centred and overflowing; the tech pans / zooms out to see the rest.
- The canvas `minZoom` stays `0.2`, so manual zoom-out and the Controls "Fit View" button still
  reach the full bird's-eye overview.
- The mechanism (a floor applied to the initial fit only, vs. applied to the Fit View button too)
  is an implementation-plan decision. The required behaviour: **opens readable; full overview still
  reachable.**

**Files:** `components/topology/topology-diagram.tsx`.

### Fix 4 — Keyboard cannot select a node or edge

**Problem.** React Flow renders nodes and edges focusable, so Tab reaches them, but Enter/Space
does not trigger selection — the detail panel never opens via keyboard. `<TopologyNode>` is a plain
`div` with no key handler; selection only flows through React Flow's pointer events
(`onNodeClick` / `onEdgeClick`). PR-B's own plan (Task 9) anticipated this as a follow-up.

**Fix.** Enter or Space on a focused node selects it; Escape clears the selection.

- `<TopologyNode>` gets an `onKeyDown` handler: Enter or Space selects this component. The select
  callback is threaded to the node (via React Flow node `data`, or an equivalent — the exact
  threading is an implementation-plan decision).
- Escape clears the current selection (closes the panel / mobile sheet).

**Out of scope, noted deliberately:** (a) keyboard selection of connection *edges* — a keyboard
user inspects the 22 components, which carry the diagnostic content; edges have no custom component
so key-handling them is disproportionate here. (b) Tab focus order — Tab currently visits all ~36
edges before the first node, and correcting that means fighting React Flow's render order. Neither
is addressed in this pass.

**Files:** `components/topology/topology-node.tsx`; threading via
`components/topology/topology-flow.ts` and/or `components/topology/topology-diagram.tsx`.

### Fix 5 — Connection panel title shows a raw enum

**Problem.** `<TopologyDetailPanel>`'s `ConnectionBody` renders
`<h2>{connection.connectionKind}</h2>`, showing raw enum values such as `reports_to`.

**Fix.** New pure function `formatConnectionKind(kind: string): string`, with an explicit map:

| enum value | displayed |
|---|---|
| `electrical-wire` | Electrical wire |
| `fluid-line` | Fluid line |
| `mechanical-linkage` | Mechanical linkage |
| `can-bus` | CAN bus |
| `lin-bus` | LIN bus |
| `controlled_by` | Controlled by |
| `reports_to` | Reports to |

Fallback for any unmapped value: replace `-` and `_` with spaces and capitalise the first letter.
`ConnectionBody` renders `formatConnectionKind(connection.connectionKind)`.

**Files:** `components/topology/topology-format.ts` (`formatConnectionKind`, alongside
`formatSymptomTitle`), `components/topology/topology-detail-panel.tsx`.

## Testing

Test-driven — a failing test before each fix where it is testable:

- `formatSymptomTitle` — unit tests: a DTC slug, a non-DTC slug, and edge cases (empty string,
  single segment).
- `formatConnectionKind` — unit tests: every mapped kind, plus an unmapped value hitting the
  fallback.
- Fix 1 — `<TopologyDetailPanel>` test: a close button renders when a selection is present; clicking
  it calls `onClose`; the empty state renders no close button.
- Fix 4 — `<TopologyNode>` test: `keyDown` Enter and Space each fire the select callback. Escape
  clearing is tested at the component that owns selection state.
- Fix 3 — a React Flow config change, not unit-testable under happy-dom. Verified in live
  re-validation.
- Whole suite: `pnpm test` green, `pnpm exec tsc --noEmit` clean.
- Live re-validation on a fresh preview, reusing the existing 2017 F-350 / P0087 session
  (`681de115-…`): desktop and mobile (375–414px) — heading reads "P0087 — Fuel Rail Pressure Too
  Low", diagram opens readable, mobile sheet opens **and closes**, keyboard selects a part,
  connection label reads plain English. No test data created in the live database.

## Out of scope

- The "messy input" resolver check (PR-B plan Task 9 Step 2b) — it exercises resolver code that
  PR-B did not touch.
- Tab focus order (edges visited before nodes) — see Fix 4.
- A tap-outside scrim for the mobile sheet — see Fix 1.
- Removing the now-unused `cached-lookup.ts` / `<CachedOverview>` (PR-B spec §9 — separate later
  cleanup).

## Files touched (summary)

| File | Change |
|---|---|
| `components/topology/topology-detail-panel.tsx` | Close button + `onClose` prop (Fix 1); `formatConnectionKind` for the connection title (Fix 5) |
| `components/screens/topology-diagnostic.tsx` | Pass `onClose` (Fix 1); formatted `<h1>` title (Fix 2) |
| `components/topology/topology.css` | Close-button styling (Fix 1) |
| `components/topology/topology-diagram.tsx` | Readable opening zoom (Fix 3); keyboard-selection threading (Fix 4) |
| `components/topology/topology-node.tsx` | `onKeyDown` selection (Fix 4) |
| `components/topology/topology-flow.ts` | Thread the select callback to nodes, if the chosen mechanism needs it (Fix 4) |
| `components/topology/topology-format.ts` *(new)* | `formatSymptomTitle` (Fix 2), `formatConnectionKind` (Fix 5) |
| `tests/unit/…` | New unit tests per the Testing section |
