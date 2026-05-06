import Link from 'next/link'
import { db } from '@/lib/db/client'
import { listPendingDriftAlerts } from '@/lib/curator/queries'
import { DriftRow } from '@/components/curator/drift-row'
import { DriftFilters } from '@/components/curator/drift-filters'
import type { RiskClass } from '@/lib/db/schema'

const VALID_RISKS: RiskClass[] = ['zero', 'low', 'medium', 'high', 'destructive']
function parseRisk(s: string | undefined): RiskClass | undefined {
  return s && (VALID_RISKS as readonly string[]).includes(s) ? (s as RiskClass) : undefined
}

export default async function DriftQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string; vehicle?: string; symptom?: string }>
}) {
  const sp = await searchParams
  const rows = await listPendingDriftAlerts(db, {
    riskClass: parseRisk(sp.risk),
    vehicleFamily: sp.vehicle,
    symptomClass: sp.symptom,
  })

  if (rows.length === 0) {
    return (
      <div className="vt-drift-empty">
        <p>Queue empty.</p>
        <p>
          <Link href="/curator/calibration">View all thresholds →</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="vt-drift-page">
      <header className="vt-drift-page-header">
        <h1>Today&apos;s recommendations</h1>
        <DriftFilters current={sp} />
      </header>
      <ul className="vt-drift-list">
        {rows.map(row => <DriftRow key={row.id} row={row} />)}
      </ul>
    </div>
  )
}
