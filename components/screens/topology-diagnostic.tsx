'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type {
  SystemTopology,
  TopologyScenario,
  TopologyPin,
  TopologyComponent,
  TopologyTestAction,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import type { ResolvedScene, StepTemplate } from '@/lib/diagnostics/diagram/slot-interface'
import {
  buildStepSequence,
  stepReducer,
  stepReducerInit,
  selectCurrentStep,
  stepKeyOf,
  resolveFork,
  type ForkResolution,
} from '@/lib/diagnostics/diagram/step-sequence'
import { verdictFromReading, type ReadingInput } from '@/lib/diagnostics/diagram/verdict-from-reading'
import { accumulateConfidence } from '@/lib/diagnostics/diagram/confidence'
import { hasReachedGate } from '@/lib/diagnostics/diagram/verdict-gate'
import { formatRuledOut } from '@/lib/diagnostics/diagram/progress-line'
import { ReadingEntry } from '@/components/topology/reading-entry'
import { ProgressLine } from '@/components/topology/progress-line'
import { VerdictPanel } from '@/components/topology/verdict-panel'
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
  step?: TopologyTestAction | null,
): StepView {
  // When the live loop drives the view it passes the current reducer step. When
  // `step` is omitted (the original static caller + its test), fall back to the
  // first step of the sequence — identical behavior to the pre-loop screen.
  const resolved =
    step === undefined ? selectCurrentStep(stepReducerInit(buildStepSequence(topology))) : step
  if (resolved === null) return { kind: 'empty' }
  const scene = resolveSlots(topology, resolved, activeScenario)
  const Template = resolveTemplate(scene.shape)
  return { kind: 'scene', scene, Template }
}

/* ---------------------------------------------------------------------------
 * R9 — fork-token bridge discipline (LIVE as of the loop wiring).
 *
 * THIS screen is the single mapping point that owns the verdict-token
 * translation. In `handleReadingSubmit` we derive a RAW ForkVerdict
 * ('fail' | 'pass' | 'neutral') via `verdictFromReading` and feed it straight to
 * `resolveFork` — NEVER the scene VerdictSignal ('branch-fail'). The two
 * vocabularies must not be conflated: 'branch-fail' is the rendered signal C3
 * decided; 'fail' is the raw branch.verdict the engine matches on. Mapping
 * happens here and ONLY here.
 *
 * Routing note: `resolveFork` returns `toTestActionId` (a test_actions row id),
 * but the sequence is keyed by slug (see stepKeyOf), so a `goTo(id)` can't match
 * today. Almost every seeded branch has a null route and degrades to 'words', so
 * the honest behavior is to ADVANCE to the next implicated check. When a public
 * test-action id is surfaced, swap the advance for a `goTo` here.
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
  /** Real count of prior techs who closed this exact case as a confirmed fix.
   *  Surfaced in the verdict ONLY when > 0; never fabricated. Defaults to 0
   *  (e.g. the curator preview, which has no session context). */
  priorFixCount?: number
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
  priorFixCount = 0,
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

  // ---- The live elimination loop -------------------------------------------
  // The ordered implicated checks (T7), advanced by a live reducer. The current
  // step drives the assembled scene — there is NO "step N of M"; the current
  // check IS the view.
  const steps = useMemo(() => buildStepSequence(topology), [topology])
  const [stepState, dispatch] = useReducer(stepReducer, steps, stepReducerInit)
  const currentStep = selectCurrentStep(stepState)

  // Loop state. `confirmedBoosts` feeds the INTERNAL confidence accumulator only
  // (never rendered). `confirmedCount` is the true count of checks the tech
  // actually completed — the only number the verdict is allowed to show. A skip
  // is NOT a confirmed check, so it touches neither.
  const [confirmedBoosts, setConfirmedBoosts] = useState<number[]>([])
  const [confirmedCount, setConfirmedCount] = useState(0)
  const [lastRuledOut, setLastRuledOut] = useState<string | null>(null)
  // Only ever holds a decisive (matched) resolution — the 'none' case is never
  // stored, so the verdict can read reasoning/nextActionText without narrowing.
  const [lastResolution, setLastResolution] = useState<
    Exclude<ForkResolution, { kind: 'none' }> | null
  >(null)
  const [closed, setClosed] = useState(false)

  // INTERNAL ONLY — drives the gate, never shown. (Memory: no-user-facing-confidence.)
  const gateReached = hasReachedGate(accumulateConfidence(confirmedBoosts), topology.symptom.slug)

  const handleReadingSubmit = useCallback(
    (input: ReadingInput) => {
      if (!currentStep || closed) return
      const verdict = verdictFromReading(input, currentStep)
      if (verdict === null) return // no reading + no tap → cannot advance honestly
      const resolution = resolveFork(currentStep, verdict)
      const nextBoosts = [...confirmedBoosts, currentStep.confidenceBoost]
      const wasLast = stepState.index >= steps.length - 1

      setConfirmedBoosts(nextBoosts)
      setConfirmedCount((c) => c + 1)
      setLastRuledOut(formatRuledOut(resolution))
      if (resolution.kind !== 'none') setLastResolution(resolution)
      dispatch({ type: 'advance' }) // route id can't match a slug key today — advance

      // Earn the verdict when internal confidence crosses the gate, or honestly
      // hand off when the authored checks are exhausted.
      if (hasReachedGate(accumulateConfidence(nextBoosts), topology.symptom.slug) || wasLast) {
        setClosed(true)
      }
    },
    [currentStep, closed, confirmedBoosts, stepState.index, steps.length, topology.symptom.slug],
  )

  const handleSkip = useCallback(() => {
    if (!currentStep || closed) return
    // A skip records NO outcome and NO confidence credit — honesty.
    setLastRuledOut(null)
    const wasLast = stepState.index >= steps.length - 1
    dispatch({ type: 'advance' })
    if (wasLast) setClosed(true)
  }, [currentStep, closed, stepState.index, steps.length])

  const handleRunAgain = useCallback(() => {
    setConfirmedBoosts([])
    setConfirmedCount(0)
    setLastRuledOut(null)
    setLastResolution(null)
    setClosed(false)
    if (steps.length > 0) dispatch({ type: 'goTo', stepKey: stepKeyOf(steps[0]) })
  }, [steps])

  // The assembled view for the CURRENT live step (T7 → T3 → T4).
  const stepView = useMemo(
    () => assembleStepView(topology, activeScenario, currentStep),
    [topology, activeScenario, currentStep],
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
          <div className={`topo__assembled${closed ? ' is-dimmed' : ''}`} ref={assembledRef}>
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

        {/* The verdict — center stage over the dimmed diagram when internal
            confidence earned it (gate) or the authored checks ran out (handoff).
            True data only; never a percent. */}
        {closed && !showWholeSystem && (
          <VerdictPanel
            mode={gateReached ? 'verdict' : 'handoff'}
            confirmedCount={confirmedCount}
            priorFixCount={priorFixCount}
            direction={
              lastResolution
                ? { reasoning: lastResolution.reasoning, nextAction: lastResolution.nextActionText }
                : null
            }
            onRunAgain={handleRunAgain}
          />
        )}
      </div>

      {/* Floating left control dock — Back, the symptom switch, the
          ignition/fault simulator, and the live status. All float over the
          diagram; on mobile the dock reflows to a bottom sheet. */}
      <aside className="topo__dock" aria-label="Diagram controls">
        <Link href="/curator" className="topo__back">
          ← Back
        </Link>

        <div className="topo__dock-head">
          <div className="topo__eyebrow">Guided diagnostic</div>
          <h1 className="topo__title">
            {formatSymptomTitle(topology.symptom.slug)}
          </h1>
          <div className="topo__vehicle">
            {vehicleName} · {topology.platform.name}
          </div>
        </div>

        {/* The elimination loop console — the one ask, plus what the last check
            ruled out. Hidden in the whole-system escape and once the verdict
            lands (the verdict takes center stage). */}
        {!showWholeSystem && currentStep && !closed && (
          <div className="topo__loop-dock">
            <ReadingEntry
              key={stepKeyOf(currentStep)}
              step={currentStep}
              onSubmit={handleReadingSubmit}
              onSkip={handleSkip}
            />
            <ProgressLine text={lastRuledOut} />
          </div>
        )}

        {!showWholeSystem && closed && (
          <div className="topo__loop-done">
            <span className="topo__loop-done-mark" aria-hidden="true">✓</span>
            Diagnosis complete — see the verdict.
          </div>
        )}

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
