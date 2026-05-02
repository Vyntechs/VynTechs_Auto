import Link from 'next/link'
import {
  AppHeader,
  Module,
  Pill,
  Risk,
  DtcChip,
} from '@/components/vt'
import { formatVehicleName, formatElapsed } from '@/lib/format'
import type { Session } from '@/lib/db/schema'

type Props = {
  techName: string
  bay?: string
  inProgress: Session[]
  queued: Session[]
  closedToday: Session[]
}

export function TodayHome({ techName, bay, inProgress, queued, closedToday }: Props) {
  const meta = bay ? (
    <span>
      {techName} · {bay}
    </span>
  ) : (
    <span>{techName}</span>
  )

  return (
    <div className="app">
      <AppHeader title="Today" meta={meta} />
      <div
        style={{
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          flex: 1,
          overflow: 'auto',
        }}
      >
        {inProgress.length > 0 && (
          <Module
            num="01"
            label="In progress"
            status={
              <Pill kind="active">
                {formatElapsed(new Date(inProgress[0].createdAt))}
              </Pill>
            }
          >
            {inProgress.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </Module>
        )}

        {queued.length > 0 && (
          <Module num="02" label={`Queued · ${queued.length}`}>
            {queued.map((s) => (
              <SessionRow key={s.id} session={s} kind="queued" />
            ))}
          </Module>
        )}

        {closedToday.length > 0 && (
          <Module num="03" label={`Closed today · ${closedToday.length}`}>
            {closedToday.map((s) => (
              <SessionRow key={s.id} session={s} kind="closed" />
            ))}
          </Module>
        )}

        {inProgress.length === 0 && queued.length === 0 && closedToday.length === 0 && (
          <Module num="—" label="Today">
            <p style={{ margin: 0, color: 'var(--vt-fg-2)', lineHeight: 1.5 }}>
              No sessions queued. Start a new diagnosis to begin.
            </p>
            <div style={{ marginTop: 14 }}>
              <Link href="/sessions/new" className="btn btn-primary">
                New diagnosis
              </Link>
            </div>
          </Module>
        )}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  kind = 'active',
}: {
  session: Session
  kind?: 'active' | 'queued' | 'closed'
}) {
  const stepCount = session.treeState.nodes.length
  const stepIndex = session.treeState.nodes.findIndex(
    (n) => n.id === session.treeState.currentNodeId,
  )
  const stepLabel =
    stepIndex >= 0 && stepCount > 0 ? `step ${stepIndex + 1} / ${stepCount}` : `${stepCount} steps`

  return (
    <Link
      href={`/sessions/${session.id}`}
      className="queue-row"
      style={{ paddingTop: 0, textDecoration: 'none', color: 'inherit', display: 'flex' }}
    >
      <div className="queue-meta">
        <div className="queue-vehicle">{formatVehicleName(session.intake)}</div>
        {kind === 'queued' && <Pill kind="queued">Queued</Pill>}
        {kind === 'closed' && (
          <span
            style={{
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 10,
              color: 'var(--vt-status-closed)',
            }}
          >
            closed
          </span>
        )}
        {kind === 'active' && (
          <DtcChip>{session.intake.customerComplaint.slice(0, 24).toUpperCase()}</DtcChip>
        )}
      </div>
      <div className="queue-complaint">{session.intake.customerComplaint}</div>
      {kind === 'active' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <Risk level="low" />
          <span className="queue-time" style={{ marginLeft: 'auto' }}>
            {stepLabel}
          </span>
        </div>
      )}
      {kind !== 'active' && (
        <div className="queue-time">
          {kind === 'queued'
            ? `created ${formatElapsed(new Date(session.createdAt))} ago`
            : `closed`}
        </div>
      )}
    </Link>
  )
}
