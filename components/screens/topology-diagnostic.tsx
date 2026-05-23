'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import { formatSymptomTitle } from '@/components/topology/topology-format'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import {
  TopologyDetailPanel,
  type TopologySelection,
} from '@/components/topology/topology-detail-panel'
import type { TopologySelectionState } from '@/components/topology/topology-flow'

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  vehicleName: string
}

/** PR-C/B Task 6 — typed selection state. Pin selection joins component +
 *  connection. Scenario state lifted in Task 10. */
type SelectionState =
  | { kind: 'empty' }
  | { kind: 'component'; id: string }
  | { kind: 'pin'; id: string }
  | { kind: 'connection'; id: string }

export function TopologyDiagnostic({ topology, layout, vehicleName }: Props) {
  const [selection, setSelection] = useState<SelectionState>({ kind: 'empty' })

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

  // Panel selection (the shape the detail panel consumes — Task 7 extends
  // this with a 'pin' kind).
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
    // Pin selected — panel falls back to empty until Task 7 adds the pin variant.
    return { kind: 'empty' }
  }, [selection, componentById, connectionById])

  // Diagram selection (typed shape consumed by toFlowElements).
  const diagramSelection: TopologySelectionState = useMemo(() => {
    if (selection.kind === 'empty') {
      return { kind: 'empty', activeScenarioSlug: null }
    }
    return {
      kind: selection.kind,
      id: selection.id,
      activeScenarioSlug: null,
    }
  }, [selection])

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
        <h1 className="topo__title">
          {formatSymptomTitle(topology.symptom.slug)}
        </h1>
        <div className="topo__vehicle">
          {vehicleName} · {topology.platform.name}
        </div>
      </header>

      <TopologyDiagram
        topology={topology}
        layout={layout}
        selection={diagramSelection}
        onSelectComponent={(id) => setSelection({ kind: 'component', id })}
        onSelectPin={(id) => setSelection({ kind: 'pin', id })}
        onClearSelection={() => setSelection({ kind: 'empty' })}
      />

      <TopologyDetailPanel
        selection={panelSelection}
        onSelectComponent={(id) => setSelection({ kind: 'component', id })}
        onClose={() => setSelection({ kind: 'empty' })}
        open={panelSelection.kind !== 'empty'}
      />
    </div>
  )
}
