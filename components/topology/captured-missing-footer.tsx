'use client'

import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'

type Props = { topology: SystemTopology }

/**
 * Spec §4.7 + §7.6 — hybrid: hand-written framing wrapper from dataStatus,
 * bullet rows derived from the loaded topology (counts of captured vs null
 * fields). As field labels get captured (e.g. a tech adds a pin number), the
 * "Not captured" count decrements automatically — itself a trust-building
 * moment per the spec rationale.
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

function pluralise(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function buildCapturedRows(topology: SystemTopology): string[] {
  const rows: string[] = []
  if (topology.components.length > 0) {
    rows.push(`${pluralise(topology.components.length, 'component')} in this system`)
  }
  const totalPins = topology.components.reduce((sum, c) => sum + c.pins.length, 0)
  if (totalPins > 0) {
    rows.push(`${pluralise(totalPins, 'pin')} mapped to roles`)
  }
  const electrical = topology.connections.filter(
    (c) => c.electricalRole != null,
  ).length
  if (electrical > 0) {
    rows.push(
      `${pluralise(electrical, 'electrical wire')} with role + endpoints`,
    )
  }
  if (topology.scenarios.length > 0) {
    rows.push(
      `${pluralise(topology.scenarios.length, 'scenario')} with live readings`,
    )
  }
  return rows
}

function buildMissingRows(topology: SystemTopology): string[] {
  const rows: string[] = []
  const pinsWithoutNumber = topology.components
    .flatMap((c) => c.pins)
    .filter((p) => p.pinNumber == null).length
  if (pinsWithoutNumber > 0) {
    rows.push(
      `${pluralise(pinsWithoutNumber, 'pin number')} — not yet captured`,
    )
  }
  const componentsWithoutLocation = topology.components.filter(
    (c) => !c.location,
  ).length
  if (componentsWithoutLocation > 0) {
    rows.push(
      `${pluralise(componentsWithoutLocation, 'component location')} — not yet captured`,
    )
  }
  const pinsWithLabelGap = topology.components
    .flatMap((c) => c.pins)
    .filter((p) => p.labelGap != null).length
  if (pinsWithLabelGap > 0) {
    rows.push(`${pluralise(pinsWithLabelGap, 'pin')} with label gaps noted`)
  }
  return rows
}
