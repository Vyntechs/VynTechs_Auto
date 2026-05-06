import Link from 'next/link'
import { db } from '@/lib/db/client'
import { listCalibrationCells, countPendingDriftAlerts } from '@/lib/curator/queries'
import type { RiskClass } from '@/lib/db/schema'

const VALID_RISKS: RiskClass[] = ['zero', 'low', 'medium', 'high', 'destructive']
function parseRisk(s: string | undefined): RiskClass | undefined {
  return s && (VALID_RISKS as readonly string[]).includes(s) ? (s as RiskClass) : undefined
}

function formatThreshold(pct: number): string {
  return `${Math.round(pct * 100)}%`
}

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toISOString().slice(0, 10)
}

export default async function CalibrationPage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string; vehicle?: string; symptom?: string }>
}) {
  const sp = await searchParams

  const [cells, pending] = await Promise.all([
    listCalibrationCells(db, {
      riskClass: parseRisk(sp.risk),
      vehicleFamily: sp.vehicle,
      symptomClass: sp.symptom,
    }),
    countPendingDriftAlerts(db),
  ])

  return (
    <div className="vt-calibration-page">
      <header className="vt-calibration-header">
        <h1>Calibration thresholds</h1>
        {pending > 0 && (
          <Link href="/curator/drift" className="vt-calibration-pending-link">
            🔔 {pending} pending
          </Link>
        )}
      </header>

      {cells.length === 0 ? (
        <p className="vt-calibration-empty">No calibration cells found.</p>
      ) : (
        <table className="vt-calibration-table">
          <thead>
            <tr>
              <th>Slice</th>
              <th>Threshold</th>
              <th>Last refit</th>
            </tr>
          </thead>
          <tbody>
            {cells.map(cell => (
              <tr key={cell.id}>
                <td>
                  <Link
                    href={`/curator/calibration/${encodeURIComponent(cell.riskClass)}/${encodeURIComponent(cell.vehicleFamily)}/${encodeURIComponent(cell.symptomClass)}`}
                    className="vt-calibration-slice-link"
                  >
                    <span className={`vt-calibration-risk risk-${cell.riskClass}`}>{cell.riskClass}</span>
                    {' · '}
                    <span>{cell.vehicleFamily}</span>
                    {' · '}
                    <span>{cell.symptomClass}</span>
                  </Link>
                </td>
                <td className="vt-calibration-threshold">{formatThreshold(cell.thresholdPct)}</td>
                <td className="vt-calibration-refit">{formatDate(cell.lastRefitAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
