import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flows } from '@/lib/db/schema'
import { listPlatformChoices, listSymptomChoices } from '@/lib/curator/slug-catalog'
import { NewFlowForm, type ExistingFlow } from '@/components/curator/new-flow-form'

export const metadata = { title: 'Curator — New flow' }

export default async function NewFlowPage() {
  // Active flows already cover some (vehicle, symptom) pairs — exactly one flow
  // is allowed per pair. Pass them so the form can offer "open the existing one"
  // BEFORE the curator submits into a uniqueness error.
  const existingRows = await db
    .select({
      flowId: flows.id,
      platformSlug: flows.platformSlug,
      symptomSlug: flows.symptomSlug,
      displayTitle: flows.displayTitle,
    })
    .from(flows)
    .where(eq(flows.isRetired, false))

  const existing: ExistingFlow[] = existingRows.map((r) => ({
    flowId: r.flowId,
    platformSlug: r.platformSlug,
    symptomSlug: r.symptomSlug,
    title: r.displayTitle,
  }))

  return (
    <NewFlowForm
      platforms={listPlatformChoices()}
      symptoms={listSymptomChoices()}
      existing={existing}
    />
  )
}
