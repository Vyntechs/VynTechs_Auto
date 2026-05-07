import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db/client'
import { listHistoryForCell } from '@/lib/curator/queries'
import { parseRisk } from '@/lib/curator/parse-risk'

function formatDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10)
}

function formatThreshold(pct: number): string {
  return `${Math.round(pct * 100)}%`
}

function formatDecision(decision: string | null): string {
  if (decision === 'applied') return 'applied'
  if (decision === 'dismissed') return 'dismissed'
  return 'pending'
}

export default async function CellHistoryPage({
  params,
}: {
  params: Promise<{ risk: string; vehicle: string; symptom: string }>
}) {
  const { risk, vehicle, symptom } = await params

  const riskClass = parseRisk(decodeURIComponent(risk))
  if (!riskClass) notFound()

  const vehicleFamily = decodeURIComponent(vehicle)
  const symptomClass = decodeURIComponent(symptom)

  const history = await listHistoryForCell(db, riskClass, vehicleFamily, symptomClass)

  return (
    <div className="vt-history-page">
      <header className="vt-history-header">
        <Link href="/curator/calibration" className="vt-history-back">
          ← calibration
        </Link>
        <h1>
          {riskClass} &times; {vehicleFamily} &times; {symptomClass} — history
        </h1>
      </header>

      {history.length === 0 ? (
        <p className="vt-history-empty">No prior recommendations for this slice.</p>
      ) : (
        <table className="vt-history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Recommended</th>
              <th>Decision</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td className="vt-history-date">{formatDate(h.createdAt)}</td>
                <td className="vt-history-recommended">
                  {formatThreshold(h.oldThreshold)} &rarr; {formatThreshold(h.newThreshold)}
                </td>
                <td className={`vt-history-decision vt-history-decision--${formatDecision(h.decision)}`}>
                  {formatDecision(h.decision)}
                </td>
                <td className="vt-history-note">{h.decisionNote ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
