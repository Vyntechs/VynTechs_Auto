import { notFound } from 'next/navigation'
import { and, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flows, flowVersions } from '@/lib/db/schema'
import type { Flow } from '@/lib/flows/types'
import { platformDisplayName, symptomDisplayName } from '@/lib/curator/slug-catalog'
import { FlowEditor } from '@/components/curator/flow-editor/flow-editor'

export const metadata = { title: 'Curator — Edit flow' }

export default async function EditFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ flowId: string }>
  searchParams: Promise<{ versionId?: string }>
}) {
  const { flowId } = await params
  const { versionId } = await searchParams

  const [flow] = await db
    .select({
      id: flows.id,
      displayTitle: flows.displayTitle,
      platformSlug: flows.platformSlug,
      symptomSlug: flows.symptomSlug,
    })
    .from(flows)
    .where(eq(flows.id, flowId))
    .limit(1)

  if (!flow) notFound()

  const [version] = versionId
    ? await db
        .select()
        .from(flowVersions)
        .where(and(eq(flowVersions.id, versionId), eq(flowVersions.flowId, flowId)))
        .limit(1)
    : await db
        .select()
        .from(flowVersions)
        .where(and(eq(flowVersions.flowId, flowId), eq(flowVersions.state, 'draft')))
        .orderBy(desc(flowVersions.versionNumber))
        .limit(1)

  if (!version) {
    return (
      <div className="vt-curator-page">
        <p>No draft version. Open the published view and click "Edit" to clone a new draft.</p>
      </div>
    )
  }
  if (version.state !== 'draft') {
    return (
      <div className="vt-curator-page">
        <p>This version is {version.state}. Drafts are the only editable state.</p>
      </div>
    )
  }

  return (
    <FlowEditor
      flowId={flow.id}
      displayTitle={flow.displayTitle}
      platformDisplay={platformDisplayName(flow.platformSlug)}
      symptomDisplay={symptomDisplayName(flow.symptomSlug)}
      flowVersionId={version.id}
      versionNumber={version.versionNumber}
      initialBody={version.body as Flow}
      initialChangeNote={version.changeNote}
    />
  )
}
