import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from '@phosphor-icons/react/dist/ssr'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { listSessionsForShop } from '@/lib/db/queries'
import { AppHeader, Module, Pill } from '@/components/vt'
import { formatVehicleName, formatElapsed } from '@/lib/format'
import type { Session } from '@/lib/db/schema'

export default async function SessionsPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const items = ctx.profile.shopId
    ? await listSessionsForShop(db, ctx.profile.shopId)
    : []

  const open = items.filter((s) => s.status === 'open')
  const resolved = items.filter((s) => s.status !== 'open')

  return (
    <div className="app">
      <AppHeader
        title="Work Orders"
        back={{ href: '/today', label: 'My Jobs' }}
        meta={
          <span>
            {ctx.profile.fullName ?? 'Technician'}
            {ctx.profile.shopId ? ' · ' + ctx.profile.shopId.slice(0, 8) : ''}
          </span>
        }
        right={
          <Link
            href="/sessions/new"
            aria-label="New diagnosis"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 999,
              background: 'var(--vt-bone-900)',
              color: 'var(--vt-bone-50)',
              textDecoration: 'none',
            }}
          >
            <Plus size={16} weight="bold" aria-hidden="true" />
          </Link>
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
        {items.length === 0 ? (
          <Module num="—" label="Sessions">
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
              No sessions yet. The first diagnosis you start will live here forever.
            </p>
            <div style={{ marginTop: 16 }}>
              <Link href="/sessions/new" className="btn btn-primary">
                Start a diagnosis
              </Link>
            </div>
          </Module>
        ) : (
          <>
            {open.length > 0 && (
              <Module num="01" label={`Open · ${open.length}`}>
                {open.map((s, i) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    isFirst={i === 0}
                    isLast={i === open.length - 1}
                  />
                ))}
              </Module>
            )}
            {resolved.length > 0 && (
              <Module num="02" label={`Closed · ${resolved.length}`}>
                {resolved.map((s, i) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    isFirst={i === 0}
                    isLast={i === resolved.length - 1}
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

function SessionRow({
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

  return (
    <Link href={`/sessions/${session.id}`} className="queue-row" style={rowStyle}>
      <div className="queue-meta">
        <div className="queue-vehicle">{formatVehicleName(session.intake)}</div>
        <StatusBadge status={session.status} />
      </div>
      <div className="queue-complaint">{session.intake.customerComplaint}</div>
      <div className="queue-time">
        {session.status === 'open'
          ? `started ${formatElapsed(new Date(session.createdAt))} ago`
          : session.closedAt
            ? `closed ${formatElapsed(new Date(session.closedAt))} ago`
            : `created ${formatElapsed(new Date(session.createdAt))} ago`}
      </div>
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
