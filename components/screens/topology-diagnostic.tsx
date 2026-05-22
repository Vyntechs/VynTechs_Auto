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
