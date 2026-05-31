import Link from 'next/link'

type Row = {
  flowId: string
  displayTitle: string
  platformDisplay: string
  symptomDisplay: string
  currentVersionNumber: number | null
  currentVersionState: 'draft' | 'published' | 'archived' | null
}

export function FlowList({ rows }: { rows: Row[] }) {
  return (
    <ul className="vt-curator-flow-list">
      {rows.map((r) => (
        <li key={r.flowId} className="vt-curator-flow-row">
          <Link href={`/curator/flows/${r.flowId}`} className="vt-curator-flow-link">
            <div className="vt-curator-flow-title">{r.displayTitle}</div>
            <div className="vt-curator-flow-meta">{r.platformDisplay} · {r.symptomDisplay}</div>
            <div className="vt-curator-flow-status">
              {r.currentVersionState === 'published' && r.currentVersionNumber != null
                ? `published · v${r.currentVersionNumber}`
                : 'no published version yet'}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
