'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  SystemTopology,
  TopologyScenario,
  TopologyPin,
  TopologyComponent,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import type { ResolvedScene, StepTemplate } from '@/lib/diagnostics/diagram/slot-interface'
import {
  buildStepSequence,
  stepReducerInit,
  selectCurrentStep,
  // resolveFork + ForkVerdict are part of the T7 contract this screen owns the
  // single mapping point for — see the R9 note below. Not called in the v1
  // render path (no step-navigation UI yet), so not imported until that lands.
} from '@/lib/diagnostics/diagram/step-sequence'
import { resolveSlots } from '@/lib/diagnostics/diagram/slot-resolver'
import { resolveTemplate } from '@/components/diagram-kit/templates/registry'
import { MeterSheet } from '@/components/diagram-kit/meter-sheet'
import { Meter } from '@/components/diagram-kit/meter'
import { formatSymptomTitle } from '@/components/topology/topology-format'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import {
  TopologyDetailPanel,
  type TopologySelection,
} from '@/components/topology/topology-detail-panel'
import type { TopologySelectionState } from '@/components/topology/topology-flow'
import { ScenarioBar } from '@/components/topology/scenario-bar'
import { defaultScenarioSlug } from '@/components/topology/wire-state'
import { CapturedMissingFooter } from '@/components/topology/captured-missing-footer'

/**
 * The render pipeline, as a pure function (no React, no DOM): the current
 * symptom's ordered steps (T7) → the current step → the resolved scene (T3) →
 * the per-shape template (T4). Returns `empty` when nothing is implicated — the
 * honest "needs field check" degrade, never a throw. No per-case/per-system
 * branching: it never inspects kind/role/observationMethod itself.
 */
export type StepView =
  | { kind: 'scene'; scene: ResolvedScene; Template: StepTemplate }
  | { kind: 'empty' }

export function assembleStepView(
  topology: SystemTopology,
  activeScenario: TopologyScenario | null,
): StepView {
  const steps = buildStepSequence(topology)
  const state = stepReducerInit(steps)
  const step = selectCurrentStep(state)
  if (step === null) return { kind: 'empty' }
  const scene = resolveSlots(topology, step, activeScenario)
  const Template = resolveTemplate(scene.shape)
  return { kind: 'scene', scene, Template }
}

/* ---------------------------------------------------------------------------
 * R9 — fork-token bridge discipline (documented; no navigation built in v1).
 *
 * v1 has NO step-navigation UI, so resolveFork is intentionally not called in
 * the render path yet. When T6 later routes a fork (a verdict→next-step jump),
 * THIS screen is the single mapping point that owns the token translation:
 *
 *   resolveFork(step, RAW_BRANCH_VERDICT)   // 'fail' | 'pass' | 'neutral'
 *
 * It feeds resolveFork the RAW branch verdict string ('fail'), NEVER the scene
 * VerdictSignal ('branch-fail'). The two vocabularies must not be conflated:
 * 'branch-fail' is the rendered signal C3 already decided; 'fail' is the raw
 * branch.verdict the engine matches on. Mapping happens here and ONLY here.
 * No dead navigation code is added until the navigation UI exists.
 * ------------------------------------------------------------------------- */

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  vehicleName: string
  sessionId: string
  /** Symptom switcher options, rendered in the floating control dock. */
  symptoms: { slug: string; label: string }[]
  /** The currently-loaded symptom slug (drives the active pill). */
  activeSymptomSlug: string
}

type SelectionState =
  | { kind: 'empty' }
  | { kind: 'component'; id: string }
  | { kind: 'pin'; id: string }
  | { kind: 'connection'; id: string }

/**
 * Owns scenario state + free part selection (tap-to-inspect, KEPT per Brandon)
 * + the silent current-step (T7 engine) + the whole-system escape. The current
 * step drives the default assembled view; the tech can tap any shown element to
 * pull its detail. No "step N of M" is ever shown — the index is internal.
 */
export function TopologyDiagnostic({
  topology,
  layout,
  vehicleName,
  sessionId,
  symptoms,
  activeSymptomSlug,
}: Props) {
  const [selection, setSelection] = useState<SelectionState>({ kind: 'empty' })
  const [showWholeSystem, setShowWholeSystem] = useState(false)
  const assembledRef = useRef<HTMLDivElement>(null)
  const [diagramScale, setDiagramScale] = useState(1)
  const [activeScenarioSlug, setActiveScenarioSlug] = useState<string | null>(
    () => defaultScenarioSlug(topology.scenarios, topology.lastScenarioSlug),
  )

  const componentById = useMemo(
    () => new Map(topology.components.map((c) => [c.id, c])),
    [topology],
  )
  const pinById = useMemo(() => {
    const map = new Map<string, { pin: TopologyPin; component: TopologyComponent }>()
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

  // The assembled view for the current step (T7 → T3 → T4). The current step is
  // computed silently from the initial sequence state — no "step N of M" UI in
  // v1 (the current step IS the default view). buildStepSequence +
  // selectCurrentStep are the genuinely-used T7 surface; a later navigation
  // track can swap stepReducerInit for a live reducer without re-plumbing.
  const stepView = useMemo(
    () => assembleStepView(topology, activeScenario),
    [topology, activeScenario],
  )

  const panelSelection: TopologySelection = useMemo(() => {
    if (selection.kind === 'empty') return { kind: 'empty' }
    if (selection.kind === 'component') {
      const c = componentById.get(selection.id)
      return c ? { kind: 'component', component: c } : { kind: 'empty' }
    }
    if (selection.kind === 'connection') {
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
    if (selection.kind === 'pin') {
      const entry = pinById.get(selection.id)
      return entry
        ? {
            kind: 'pin',
            pin: entry.pin,
            component: entry.component,
            scenario: activeScenario,
          }
        : { kind: 'empty' }
    }
    return { kind: 'empty' }
  }, [selection, componentById, connectionById, pinById, activeScenario])

  // Free selection KEPT: tapping any shown element resolves it to the right
  // selection kind by looking it up in the loaded graph (component first, then
  // pin, then connection). Routes by id, never by part kind — scalability-safe.
  const handleInspect = useCallback(
    (partId: string) => {
      if (componentById.has(partId)) setSelection({ kind: 'component', id: partId })
      else if (pinById.has(partId)) setSelection({ kind: 'pin', id: partId })
      else if (connectionById.has(partId)) setSelection({ kind: 'connection', id: partId })
    },
    [componentById, pinById, connectionById],
  )

  const diagramSelection: TopologySelectionState = useMemo(() => {
    if (selection.kind === 'empty') return { kind: 'empty', activeScenarioSlug }
    return { kind: selection.kind, id: selection.id, activeScenarioSlug }
  }, [selection, activeScenarioSlug])

  const persistScenario = useCallback(
    (slug: string) => {
      void fetch(`/api/sessions/${sessionId}/scenario`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      }).catch(() => {
        // Fire-and-forget: a failed persistence write must not block the UI.
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

  const selectedPartId =
    selection.kind === 'component' || selection.kind === 'pin'
      ? selection.id
      : null

  // Zoom-to-fit: the templates draw on a fixed 1320×760 stage; scale that stage
  // to the host width so the whole diagram fits on screen (the "settleCamera"
  // port the templates declared a framing hint for, computed here since CSS
  // cannot derive a unitless scale from a container width).
  const STAGE_W = 1320
  useEffect(() => {
    const el = assembledRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setDiagramScale(w / STAGE_W)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [stepView.kind, showWholeSystem])

  return (
    <div className="topo">
      {/* The canvas fills the entire window; every control floats over it. */}
      <div className="topo__canvas-wrap">
        {showWholeSystem ? (
          // Brandon override: the whole-system button drops into the EXISTING
          // full faded-system view (xyflow), not a placeholder.
          <TopologyDiagram
            topology={topology}
            layout={layout}
            selection={diagramSelection}
            onSelectComponent={(id) => setSelection({ kind: 'component', id })}
            onSelectPin={(id) => setSelection({ kind: 'pin', id })}
            onClearSelection={() => setSelection({ kind: 'empty' })}
          />
        ) : stepView.kind === 'scene' ? (
          <div className="topo__assembled" ref={assembledRef}>
            <div
              className="topo__stage"
              style={{ transform: `scale(${diagramScale})`, transformOrigin: 'top left' }}
            >
              <stepView.Template
                scene={stepView.scene}
                onInspect={handleInspect}
                selectedPartId={selectedPartId}
              />
            </div>
          </div>
        ) : (
          <div className="topo__no-plan">
            <p className="topo__no-plan-title">
              No test plan captured for this code yet
            </p>
            <p className="topo__no-plan-sub">
              This case is online but its diagnostic steps aren’t authored. Use
              the whole-system view to inspect the parts, or check back as it
              fills in.
            </p>
          </div>
        )}

        <button
          type="button"
          className="topo__whole-system"
          aria-pressed={showWholeSystem}
          onClick={() => setShowWholeSystem((v) => !v)}
        >
          {showWholeSystem ? 'Back to step' : 'Whole system'}
        </button>

        {/* The Meter sits BELOW the diagram (not over it) on desktop; T5's CSS
            promotes it to a tap-to-toggle bottom sheet at mobile widths. Only
            mounted on a gauge-bearing scene. */}
        {!showWholeSystem &&
          stepView.kind === 'scene' &&
          stepView.scene.gaugeSpec !== null && (
            <MeterSheet
              nowShowing={`${activeScenario?.label ?? ''} · ${stepView.scene.shape}`}
              gaugeSpec={stepView.scene.gaugeSpec}
            >
              {(g) => (g ? <Meter gauge={g} /> : null)}
            </MeterSheet>
          )}

        {/* Footer overlays the diagram bottom (CSS: position absolute). On
            mobile it pins to the bottom edge as a collapsible strip. */}
        <CapturedMissingFooter topology={topology} />
      </div>

      {/* Floating left control dock — Back, the symptom switch, the
          ignition/fault simulator, and the live status. All float over the
          diagram; on mobile the dock reflows to a bottom sheet. */}
      <aside className="topo__dock" aria-label="Diagram controls">
        <Link href="/curator" className="topo__back">
          ← Back
        </Link>

        <div className="topo__dock-head">
          <div className="topo__eyebrow">Electrical topology</div>
          <h1 className="topo__title">
            {formatSymptomTitle(topology.symptom.slug)}
          </h1>
          <div className="topo__vehicle">
            {vehicleName} · {topology.platform.name}
          </div>
        </div>

        {symptoms.length > 0 && (
          <nav className="topo__symptoms" aria-label="Symptom">
            {symptoms.map((s) => {
              const active = s.slug === activeSymptomSlug
              return (
                <Link
                  key={s.slug}
                  href={`/curator/topology?symptom=${s.slug}`}
                  className={`topo__symptom${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {s.label}
                </Link>
              )
            })}
          </nav>
        )}

        {topology.scenarios.length > 0 && (
          <ScenarioBar
            scenarios={topology.scenarios}
            activeSlug={activeScenarioSlug}
            onScenarioChange={handleScenarioChange}
          />
        )}

        {activeScenario && (
          <div
            className={`topo__readout${activeScenario.kind === 'fault' ? ' is-fault' : ''}`}
          >
            Now showing · <b>{activeScenario.label}</b> — {activeScenario.sub}
          </div>
        )}
      </aside>

      <TopologyDetailPanel
        selection={panelSelection}
        onSelectComponent={(id) => setSelection({ kind: 'component', id })}
        onSelectPin={(id) => setSelection({ kind: 'pin', id })}
        onClose={() => setSelection({ kind: 'empty' })}
        open={panelSelection.kind !== 'empty'}
      />
    </div>
  )
}
