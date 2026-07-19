import Link from 'next/link'
import { AppHeader, Module } from '@/components/vt'
import type { VehicleHistoryTicket } from '@/lib/tickets'

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

const mono = { fontFamily: 'var(--vt-font-mono)' }

function repairOrder(n: number): string {
  return `RO ${String(n).padStart(6, '0')}`
}

function visitDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function jobOutcome(job: VehicleHistoryTicket['jobs'][number]): string {
  if (job.workStatus === 'done') return 'completed'
  if (job.workStatus === 'canceled') return 'canceled'
  switch (job.approvalState) {
    case 'declined':
      return 'declined'
    case 'approved':
      return 'approved'
    case 'sent':
      return 'quote sent'
    case 'quote_ready':
      return 'quote ready'
    default:
      return 'quote pending'
  }
}

export function VehicleHistory({
  vehicle,
  customer,
  visits,
  hasMore = false,
}: {
  vehicle: VehicleHistoryVehicle
  customer: VehicleHistoryCustomer
  visits: VehicleHistoryTicket[]
  hasMore?: boolean
}) {
  const recommended = visits.flatMap((visit) =>
    visit.jobs
      .filter((job) => job.approvalState === 'declined')
      .map((job) => ({
        job,
        ticketId: visit.id,
        ticketNumber: visit.ticketNumber,
        date: visit.createdAt,
      })),
  )

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

        {recommended.length > 0 && (
          <Module num="—" label="Recommended · not done yet">
            <p
              style={{
                margin: '0 0 10px',
                fontSize: 13,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.5,
              }}
            >
              Work quoted on a past visit that the customer declined. Worth
              raising next time they&rsquo;re in.
            </p>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {recommended.map(({ job, ticketId, ticketNumber, date }) => (
                <li
                  key={job.id}
                  style={{ borderLeft: '2px solid var(--vt-signal-500)', paddingLeft: 10 }}
                >
                  <Link
                    href={`/tickets/${ticketId}`}
                    style={{ color: 'var(--vt-fg)', fontWeight: 600, textDecoration: 'none' }}
                  >
                    {job.title}
                  </Link>
                  <div style={{ ...mono, fontSize: 11, color: 'var(--vt-fg-3)', marginTop: 2 }}>
                    {repairOrder(ticketNumber)} · {visitDate(date)} · declined
                  </div>
                </li>
              ))}
            </ul>
          </Module>
        )}

        <Module num="—" label="Past visits">
          {hasMore && (
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--vt-fg-3)', lineHeight: 1.5 }}>
              Showing the 100 most recent visits. Older repair orders remain stored.
            </p>
          )}
          {visits.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--vt-fg-3)', lineHeight: 1.5 }}>
              No past visits recorded for this vehicle yet.
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {visits.map((visit) => (
                <li key={visit.id}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'baseline',
                    }}
                  >
                    <Link
                      href={`/tickets/${visit.id}`}
                      style={{ ...mono, fontSize: 12, color: 'var(--vt-fg)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      {repairOrder(visit.ticketNumber)}
                    </Link>
                    <span style={{ ...mono, fontSize: 11, color: 'var(--vt-fg-3)' }}>
                      {visitDate(visit.createdAt)}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: 13,
                      color: 'var(--vt-fg-2)',
                      lineHeight: 1.45,
                    }}
                  >
                    {visit.concern}
                  </p>
                  {visit.jobs.length > 0 && (
                    <ul
                      style={{
                        listStyle: 'none',
                        margin: '6px 0 0',
                        padding: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      {visit.jobs.map((job) => (
                        <li
                          key={job.id}
                          style={{
                            ...mono,
                            fontSize: 11,
                            color: 'var(--vt-fg-3)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                          }}
                        >
                          <span style={{ color: 'var(--vt-fg-2)' }}>{job.title}</span>
                          <span>{jobOutcome(job)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Module>
      </div>
    </div>
  )
}
