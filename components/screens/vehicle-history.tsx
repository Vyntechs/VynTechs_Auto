import Link from 'next/link'
import { AppHeader, Module, Pill } from '@/components/vt'
import type { Session } from '@/lib/db/schema'

export type VehicleHistoryVehicle = {
  id: string
  year: number
  make: string
  model: string
  vin: string | null
  plate: string | null
}

export type VehicleHistoryCustomer = {
  id: string
  name: string
}

export function VehicleHistory({
  vehicle,
  customer,
  sessions,
}: {
  vehicle: VehicleHistoryVehicle
  customer: VehicleHistoryCustomer
  sessions: Session[]
}) {
  const open = sessions.filter((s) => s.status === 'open')
  const closed = sessions.filter((s) => s.status !== 'open')

  return (
    <div className="app">
      <AppHeader
        title="Vehicle history"
        back={{ href: '/intake', label: 'Intake' }}
        meta={
          <span>
            {vehicle.year} {vehicle.make} {vehicle.model} · {customer.name}
          </span>
        }
      />
      <div
        style={{
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Module num="—" label="Vehicle">
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '6px 16px',
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 12,
              color: 'var(--vt-fg-2)',
            }}
          >
            <dt>Owner</dt>
            <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>{customer.name}</dd>
            <dt>Year / Make / Model</dt>
            <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </dd>
            {vehicle.vin && (
              <>
                <dt>VIN</dt>
                <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>{vehicle.vin}</dd>
              </>
            )}
            {vehicle.plate && (
              <>
                <dt>Plate</dt>
                <dd style={{ margin: 0, color: 'var(--vt-fg)' }}>{vehicle.plate}</dd>
              </>
            )}
          </dl>
        </Module>

        {sessions.length === 0 ? (
          <Module num="01" label="Sessions">
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 15,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.5,
              }}
            >
              No prior sessions for this vehicle.
            </p>
          </Module>
        ) : (
          <>
            {open.length > 0 && (
              <Module num="01" label={`Open · ${open.length}`}>
                {open.map((s, i) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    isFirst={i === 0}
                    isLast={i === open.length - 1}
                  />
                ))}
              </Module>
            )}
            {closed.length > 0 && (
              <Module num={open.length > 0 ? '02' : '01'} label={`Closed · ${closed.length}`}>
                {closed.map((s, i) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    isFirst={i === 0}
                    isLast={i === closed.length - 1}
                  />
                ))}
              </Module>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SessionCard({
  session,
  isFirst,
  isLast,
}: {
  session: Session
  isFirst?: boolean
  isLast?: boolean
}) {
  const rowStyle: React.CSSProperties = {
    textDecoration: 'none',
    color: 'inherit',
    display: 'flex',
  }
  if (isFirst) rowStyle.paddingTop = 0
  if (isLast) rowStyle.borderBottom = 0

  const created = new Date(session.createdAt)

  return (
    <Link href={`/sessions/${session.id}`} className="queue-row" style={rowStyle}>
      <div className="queue-meta">
        <div className="queue-vehicle">{formatDate(created)}</div>
        <StatusBadge status={session.status} />
      </div>
      <div className="queue-complaint">{session.intake.customerComplaint}</div>
      {session.status === 'closed' && session.outcome?.rootCause ? (
        <div className="queue-time">Resolved: {session.outcome.rootCause}</div>
      ) : (
        <div className="queue-time">{formatDate(created)}</div>
      )}
    </Link>
  )
}

function StatusBadge({ status }: { status: Session['status'] }) {
  if (status === 'open') return <Pill kind="active">Live</Pill>
  if (status === 'deferred') return <Pill kind="deferred">Deferred</Pill>

  const colorMap: Record<string, string> = {
    closed: 'var(--vt-status-closed)',
    declined: 'var(--vt-status-declined)',
  }
  return (
    <span
      style={{
        fontFamily: 'var(--vt-font-mono)',
        fontSize: 10,
        color: colorMap[status] ?? 'var(--vt-fg-3)',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}
    >
      {status}
    </span>
  )
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
