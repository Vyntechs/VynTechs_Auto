import { db } from '@/lib/db/client'
import { fetchCuratorCaseDetail } from '@/lib/curator/case-detail-query'
import { CorpusForm, type CorpusFormPrefill } from '@/components/curator/corpus-form'

export default async function NewCorpusEntryPage({
  searchParams,
}: { searchParams: Promise<{ fromCase?: string; fromQueueEntry?: string }> }) {
  const sp = await searchParams

  let prefill: CorpusFormPrefill | null = null
  if (sp.fromCase) {
    const detail = await fetchCuratorCaseDetail(db, sp.fromCase)
    if (detail) {
      const intake = detail.session.intake
      const outcome = detail.session.outcome  // OutcomePayload | null
      prefill = {
        vehicleYear: intake.vehicleYear,
        vehicleMake: intake.vehicleMake,
        vehicleModel: intake.vehicleModel,
        vehicleEngine: intake.vehicleEngine ?? '',
        rootCause: outcome?.rootCause ?? '',
        actionType: outcome?.actionType ?? 'repair',
        partInfo: outcome?.partInfo ?? null,
        verification: outcome?.verification ?? { codesCleared: false, testDrive: false, symptomsResolved: 'partial' },
        // session.outcome.notes is the closest thing to a narrative; use as summary seed (curator can edit)
        summary: outcome?.notes ?? '',
      }
    }
  }

  return (
    <div className="vt-corpus-form-page">
      <h1>New corpus entry</h1>
      <CorpusForm prefill={prefill} fromQueueEntryId={sp.fromQueueEntry ?? null} />
    </div>
  )
}
