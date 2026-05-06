import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { listCasesForDriftAlert } from '@/lib/curator/queries'
import type { RiskClass } from '@/lib/db/schema'

const RISK_LABELS: Record<RiskClass, string> = {
  zero: 'Zero', low: 'Low', medium: 'Medium', high: 'High', destructive: 'Destructive',
}

export default async function DriftDrillDownPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const result = await listCasesForDriftAlert(db, id)
  if (!result) notFound()

  const { alert, cases } = result

  return (
    <div className="vt-drift-drill">
      <header>
        <Link href="/curator/drift">← Back to queue</Link>
        <h1>
          {RISK_LABELS[alert.riskClass]}-risk · {alert.vehicleFamily} · {alert.symptomClass}
        </h1>
        <p>
          {cases.length} {cases.length === 1 ? 'case' : 'cases'} in the 4 weeks before this
          recommendation was raised &nbsp;·&nbsp; threshold {alert.oldThreshold.toFixed(2)} →{' '}
          {alert.newThreshold.toFixed(2)} &nbsp;·&nbsp; comeback rate{' '}
          {(alert.comebackRate * 100).toFixed(0)}%
        </p>
      </header>

      {cases.length === 0 ? (
        <p style={{ color: 'var(--vt-fg-3)', marginTop: 24 }}>
          No closed sessions matched this cell in the look-back window. The sample
          may have come from an earlier calibration period.
        </p>
      ) : (
        <table className="vt-drill-cases">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Complaint</th>
              <th>AI proposed</th>
              <th>Tech action (notes)</th>
              <th>Outcome</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              // Vehicle and complaint fields live inside the intake JSON column
              const intake = c.intake
              // AI proposed action lives in treeState JSON under proposedAction
              const treeState = c.treeState
              // Outcome data (root cause, notes) lives in outcome JSON column
              const outcome = c.outcome

              return (
                <tr key={c.id}>
                  <td>
                    {/* Vehicle cell is the link anchor — brings curator to the full case detail */}
                    <Link href={`/curator/cases/${c.id}?from=drift/${alert.id}`}>
                      {intake.vehicleYear} {intake.vehicleMake} {intake.vehicleModel}
                    </Link>
                  </td>
                  <td>{intake.customerComplaint}</td>
                  <td>{treeState?.proposedAction?.description ?? '—'}</td>
                  <td>{outcome?.notes ?? '—'}</td>
                  <td>{c.status}</td>
                  <td>
                    {c.closedAt
                      ? new Date(c.closedAt).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
