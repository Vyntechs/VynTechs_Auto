import Link from 'next/link'
import { MainHeader } from '@/components/vt/desktop'
import { FlowStatusPill, type FlowStatus } from '@/components/curator/flow-status-pill'

export type FlowRow = {
  flowId: string
  displayTitle: string
  platformDisplay: string
  symptomDisplay: string
  status: FlowStatus
  versionNumber: number | null
  hasDraft: boolean
  updatedAt: string | null
}

function relativeDate(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso)
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function FlowList({ rows }: { rows: FlowRow[] }) {
  const newButton = (
    <Link href="/curator/flows/new" className="vt-btn vt-btn--accent">
      New flow
    </Link>
  )

  return (
    <>
      <MainHeader
        eyebrow="Diagnostic guides"
        title="Flows"
        sub="Step-by-step guides that walk a tech through diagnosing one vehicle problem. Build them by hand or from research, review, then publish."
        actions={rows.length > 0 ? newButton : undefined}
      />
      <div className="vt-main__body">
        {rows.length === 0 ? (
          <div className="vt-curator-empty">
            <p className="vt-curator-empty__title">No flows yet.</p>
            <p className="vt-curator-empty__body">
              A flow is a guided diagnosis for one vehicle + problem. Start one by
              hand, or have it researched and pre-filled for you to review.
            </p>
            <Link href="/curator/flows/new" className="vt-btn vt-btn--accent">
              Create your first flow
            </Link>
          </div>
        ) : (
          <ul className="vt-flowlist">
            {rows.map((r) => (
              <li key={r.flowId}>
                <Link href={`/curator/flows/${r.flowId}`} className="vt-flow-row">
                  <FlowStatusPill status={r.status} />
                  <span className="vt-flow-row__main">
                    <span className="vt-flow-row__title">{r.displayTitle}</span>
                    <span className="vt-flow-row__sub">
                      {r.platformDisplay} · {r.symptomDisplay}
                    </span>
                  </span>
                  <span className="vt-flow-row__meta">
                    {r.versionNumber != null && (
                      <span className="vt-flow-row__ver">v{r.versionNumber}</span>
                    )}
                    {r.updatedAt && (
                      <span className="vt-flow-row__age">{relativeDate(r.updatedAt)}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
