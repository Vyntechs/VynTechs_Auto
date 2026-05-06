import Link from 'next/link'
import { db } from '@/lib/db/client'
import { listDeferredSessions } from '@/lib/curator/queries'

export default async function DeferredQueuePage() {
  const rows = await listDeferredSessions(db)

  if (rows.length === 0) {
    return (
      <div className="vt-deferred-empty">
        <p>No deferred cases.</p>
      </div>
    )
  }

  return (
    <div className="vt-deferred-page">
      <header className="vt-deferred-header">
        <h1>Deferred cases</h1>
        <span className="vt-deferred-count">{rows.length} open</span>
      </header>
      <table className="vt-deferred-table">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Complaint</th>
            <th>Session started</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const intake = row.intake
            const vehicle = `${intake.vehicleYear} ${intake.vehicleMake} ${intake.vehicleModel}`
            return (
              <tr key={row.id}>
                <td>
                  <Link
                    href={`/curator/cases/${row.id}?from=deferred`}
                    className="vt-deferred-link"
                  >
                    {vehicle}
                  </Link>
                </td>
                <td className="vt-deferred-complaint">
                  {intake.customerComplaint}
                </td>
                <td>
                  <time
                    dateTime={row.createdAt.toISOString()}
                    className="vt-deferred-date"
                  >
                    {row.createdAt.toLocaleString()}
                  </time>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
