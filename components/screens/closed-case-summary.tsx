import Link from 'next/link'
import { VehicleStrip, Module } from '@/components/vt'
import { formatVehicleName, formatElapsed } from '@/lib/format'
import type { Session } from '@/lib/db/schema'

type Props = {
  session: Session
}

export function ClosedCaseSummary({ session }: Props) {
  const vehicle = formatVehicleName(session.intake)
  const closedAgo = session.closedAt ? formatElapsed(new Date(session.closedAt)) : '—'
  const outcome = session.outcome
  const tree = session.treeState
  const declinedNoRepair = outcome?.closeout?.kind === 'declined_no_repair'

  return (
    <div className="app">
      <VehicleStrip
        name={vehicle}
        vin={`Case closed · session ${session.id.slice(0, 8)}`}
        timer={closedAgo}
        back={{ href: '/today', label: 'My Jobs' }}
      />
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Module
          num="—"
          label="Status"
          status={
            <span
              style={{
                fontFamily: 'var(--vt-font-mono)',
                fontSize: 10,
                color: 'var(--vt-status-closed)',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              Closed
            </span>
          }
        >
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {session.intake.customerComplaint}
          </p>
        </Module>

        {(tree.rootCauseSummary || outcome?.rootCause) && (
          <Module num="—" label="Diagnosis">
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontSize: 15,
                color: 'var(--vt-fg-1)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {outcome?.rootCause ?? tree.rootCauseSummary}
            </p>
          </Module>
        )}

        {outcome && !declinedNoRepair && (
          <Module num="—" label="Repair">
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 12,
                rowGap: 6,
                margin: 0,
                fontFamily: 'var(--vt-font-serif)',
                fontSize: 14,
                color: 'var(--vt-fg-1)',
              }}
            >
              <dt style={{ color: 'var(--vt-fg-3)' }}>Action</dt>
              <dd style={{ margin: 0 }}>{outcome.actionType.replace(/_/g, ' ')}</dd>
              {outcome.partInfo?.name && (
                <>
                  <dt style={{ color: 'var(--vt-fg-3)' }}>Part</dt>
                  <dd style={{ margin: 0 }}>
                    {outcome.partInfo.name}
                    {outcome.partInfo.oemNumber && ` (${outcome.partInfo.oemNumber})`}
                  </dd>
                </>
              )}
              <dt style={{ color: 'var(--vt-fg-3)' }}>Verification</dt>
              <dd style={{ margin: 0 }}>
                resolved: {outcome.verification.symptomsResolved}
                {outcome.verification.codesCleared && ' · codes cleared'}
                {outcome.verification.testDrive && ' · test drive'}
              </dd>
              <dt style={{ color: 'var(--vt-fg-3)' }}>Time</dt>
              <dd style={{ margin: 0 }}>
                diag {outcome.diagMinutes} min · repair {outcome.repairMinutes} min
              </dd>
            </dl>
          </Module>
        )}

        {declinedNoRepair && (
          <Module num="—" label="Closeout">
            <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--vt-font-serif)', fontWeight: 400 }}>
              No repair performed
            </h2>
            <p style={{ margin: 0, color: 'var(--vt-fg-2)', lineHeight: 1.5 }}>
              Customer declined the quoted work. This case records no repair or verification.
            </p>
          </Module>
        )}

        {outcome?.notes && (
          <Module num="—" label="Notes for next time">
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontSize: 14,
                color: 'var(--vt-fg-1)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              {outcome.notes}
            </p>
          </Module>
        )}

        <Link
          href="/today"
          className="btn btn-ghost"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            textDecoration: 'none',
            alignSelf: 'flex-start',
          }}
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  )
}
