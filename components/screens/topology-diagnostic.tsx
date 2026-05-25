'use client'

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
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

/**
 * Owns scenario state + pin/component/connection selection. Scenario default
 * on first load = lastScenarioSlug → isDefault scenario → first available.
 * Scenario change is fire-and-forget POST to /api/sessions/:id/scenario; a
 * failed write doesn't block the UI per the soft-fail rule.
 */
export function TopologyDiagnostic({
  topology,
  layout,
  vehicleName,
  sessionId,
}: Props) {
  const [selection, setSelection] = useState<SelectionState>({ kind: 'empty' })
  const [activeScenarioSlug, setActiveScenarioSlug] = useState<string | null>(
    () => defaultScenarioSlug(topology.scenarios, topology.lastScenarioSlug),
  )

  const componentById = useMemo(
    () => new Map(topology.components.map((c) => [c.id, c])),
    [topology],
  )
  const pinById = useMemo(() => {
    const map = new Map<
      string,
      {
        pin: import('@/lib/diagnostics/load-system-topology').TopologyPin
        component: import('@/lib/diagnostics/load-system-topology').TopologyComponent
      }
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
    () =>
      topology.scenarios.find((s) => s.slug === activeScenarioSlug) ?? null,
    [topology, activeScenarioSlug],
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

  const diagramSelection: TopologySelectionState = useMemo(() => {
    if (selection.kind === 'empty') {
      return { kind: 'empty', activeScenarioSlug }
    }
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
        // Reload will surface server state if the tech wants to re-sync.
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
          Electrical topology · diagnostic-complete from theory
        </div>
        <h1 className="topo__title">
          {formatSymptomTitle(topology.symptom.slug)}
        </h1>
        <div className="topo__vehicle">
          {vehicleName} · {topology.platform.name}
        </div>
      </header>

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

      <div className="topo__canvas-wrap">
        <TopologyDiagram
          topology={topology}
          layout={layout}
          selection={diagramSelection}
          onSelectComponent={(id) => setSelection({ kind: 'component', id })}
          onSelectPin={(id) => setSelection({ kind: 'pin', id })}
          onClearSelection={() => setSelection({ kind: 'empty' })}
        />
        {/* Footer lives inside the canvas wrap so it can overlay the
            diagram bottom (CSS: position absolute). On mobile the wrap
            collapses to a flex column and the footer renders inline. */}
        <CapturedMissingFooter topology={topology} />
      </div>

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
