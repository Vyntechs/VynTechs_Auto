import Link from 'next/link'
import { db } from '@/lib/db/client'
import { listPendingNovelPatterns } from '@/lib/curator/queries'

export default async function NovelPatternQueuePage() {
  const rows = await listPendingNovelPatterns(db)

  if (rows.length === 0) {
    return (
      <div className="vt-novel-empty">
        No new problems to review.
      </div>
    )
  }

  return (
    <div className="vt-novel-page">
      <header className="vt-novel-header">
        <h1>New problems</h1>
        <span className="vt-novel-count">{rows.length} pending</span>
      </header>
      <table className="vt-novel-table">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Complaint</th>
            <th>Max similarity</th>
            <th>Flagged at</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ queue, session }) => {
            const intake = session.intake
            const vehicle = `${intake.vehicleYear} ${intake.vehicleMake} ${intake.vehicleModel}`
            return (
              <tr key={queue.id}>
                <td>
                  <Link
                    href={`/curator/cases/${session.id}?from=novel`}
                    className="vt-novel-link"
                  >
                    {vehicle}
                  </Link>
                </td>
                <td className="vt-novel-complaint">
                  {intake.customerComplaint}
                </td>
                <td className="vt-novel-similarity">
                  {queue.maxRetrievalSimilarity.toFixed(2)}
                </td>
                <td>
                  <time dateTime={queue.createdAt.toISOString()}>
                    {queue.createdAt.toLocaleString()}
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
