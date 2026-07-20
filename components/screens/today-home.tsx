import Link from 'next/link'
import { Plus } from '@phosphor-icons/react/dist/ssr'
import {
  AppHeader,
  Module,
  Pill,
  Risk,
  DtcChip,
} from '@/components/vt'
import { FollowUpPanel } from '@/components/comeback/follow-up-panel'
import { formatVehicleName, formatElapsed } from '@/lib/format'
import type { Session } from '@/lib/db/schema'
import type { DueFollowUp } from '@/lib/comeback/list'
import type { TodayTicketJobs } from '@/lib/tickets'
import { TodayJobsBoard } from '@/components/screens/today-jobs-board'

type Props = {
  techName: string
  bay?: string
  inProgress: Session[]
  closedToday: Session[]
  dueFollowUps?: DueFollowUp[]
  canCurate?: boolean
  canWriteCounterOrder?: boolean
  canCreateTickets?: boolean
  canDispatchWork?: boolean
  todayJobs?: TodayTicketJobs
  diagnosticsEntitled?: boolean
}

export function TodayHome({
  techName,
  bay,
  inProgress,
  closedToday,
  dueFollowUps = [],
  canCurate = false,
  canWriteCounterOrder = false,
  canCreateTickets = false,
  canDispatchWork = false,
  todayJobs = {
    myJobs: [],
    openJobs: [],
    createdJobs: [],
    teamJobs: [],
    linkedSessionIds: [],
  },
  diagnosticsEntitled = false,
}: Props) {
  const meta = bay ? (
    <span>
      {techName} · {bay}
    </span>
  ) : (
    <span>{techName}</span>
  )

  return (
    <main className="app">
      <AppHeader title={canDispatchWork ? 'Shop floor' : 'My Jobs'} meta={meta} />
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '12px 14px 0',
        }}
      >
        {canCurate && (
          <Link
            href="/curator"
            aria-label="Reviewer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 13,
              textDecoration: 'none',
              color: 'var(--vt-fg-2)',
              fontFamily: 'var(--vt-font-mono)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Reviewer →
          </Link>
        )}
        {canWriteCounterOrder && (
          <Link
            href="/intake"
            aria-label="New work order"
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            New work order
          </Link>
        )}
        {canCreateTickets && (
          <Link
            href="/tickets/new"
            aria-label="Quick ticket"
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minHeight: 44,
              padding: '6px 12px',
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            Quick ticket
          </Link>
        )}
      </div>
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
        <TodayJobsBoard
          myJobs={todayJobs.myJobs}
          openJobs={todayJobs.openJobs}
          teamJobs={todayJobs.teamJobs}
          createdJobs={todayJobs.createdJobs}
          canDispatchWork={canDispatchWork}
          hasMore={todayJobs.hasMore}
          diagnosticsEntitled={diagnosticsEntitled}
        />

        {diagnosticsEntitled && inProgress.length > 0 && (
          <Module
            num="01"
            label="In progress"
            status={
              <Pill kind="active">
                {formatElapsed(new Date(inProgress[0].createdAt))}
              </Pill>
            }
          >
            {inProgress.map((s, i) => (
              <SessionRow
                key={s.id}
                session={s}
                kind="active"
                isFirst={i === 0}
                isLast={i === inProgress.length - 1}
              />
            ))}
          </Module>
        )}

        <FollowUpPanel items={dueFollowUps} />

        {diagnosticsEntitled && closedToday.length > 0 && (
          <Module num="02" label={`Closed today · ${closedToday.length}`}>
            {closedToday.map((s, i) => (
              <SessionRow
                key={s.id}
                session={s}
                kind="closed"
                isFirst={i === 0}
                isLast={i === closedToday.length - 1}
              />
            ))}
          </Module>
        )}

        {inProgress.length === 0 &&
          closedToday.length === 0 &&
          dueFollowUps.length === 0 &&
          todayJobs.myJobs.length === 0 &&
          todayJobs.openJobs.length === 0 &&
          todayJobs.teamJobs.length === 0 &&
          todayJobs.createdJobs.length === 0 && (
            <Module num="—" label="My Jobs">
              <p style={{ margin: 0, color: 'var(--vt-fg-2)', lineHeight: 1.5 }}>
                No assigned work yet. New work orders and quick tickets appear here.
              </p>
            </Module>
          )}
      </div>
    </main>
  )
}

function SessionRow({
  session,
  kind = 'active',
  isFirst,
  isLast,
}: {
  session: Session
  kind?: 'active' | 'closed'
  isFirst?: boolean
  isLast?: boolean
}) {
  // Real risk class for this job, if a gate decision exists yet. Never a
  // hardcoded "low" — two different jobs must not look identical (trust sweep
  // 2026-05-29). No step "N / M" road-ahead count, per the cognitive-load rule.
  const riskLevel = session.treeState.gateDecision?.riskClass

  const rowStyle: React.CSSProperties = {
    textDecoration: 'none',
    color: 'inherit',
    display: 'flex',
  }
  if (isFirst) rowStyle.paddingTop = 0
  if (isLast) rowStyle.borderBottom = 0

  return (
    <Link href={`/sessions/${session.id}`} className="queue-row" style={rowStyle}>
      <div className="queue-meta">
        <div className="queue-vehicle">{formatVehicleName(session.intake)}</div>
        {kind === 'closed' && (
          <span
            style={{
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 10,
              color: 'var(--vt-status-closed)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
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
      {kind === 'active' && riskLevel && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <Risk level={riskLevel} />
        </div>
      )}
      {kind === 'closed' && (
        <div className="queue-time">closed</div>
      )}
    </Link>
  )
}
