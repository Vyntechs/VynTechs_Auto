import { eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flows, flowVersions } from '@/lib/db/schema'
import { platformDisplayName, symptomDisplayName } from '@/lib/curator/slug-catalog'
import { FlowList, type FlowRow } from '@/components/curator/flow-list'

export const metadata = { title: 'Curator — Flows' }

export default async function FlowsIndexPage() {
  // Pull non-retired flows with ALL their versions, then derive each flow's
  // real lifecycle state in JS (beta scale: a handful of flows). The previous
  // query only joined the published version, so a flow with an in-progress
  // draft looked identical to an untouched one — the draft state was invisible.
  const rows = await db
    .select({
      flowId: flows.id,
      displayTitle: flows.displayTitle,
      platformSlug: flows.platformSlug,
      symptomSlug: flows.symptomSlug,
      createdAt: flows.createdAt,
      versionNumber: flowVersions.versionNumber,
      versionState: flowVersions.state,
      publishedAt: flowVersions.publishedAt,
      authoredAt: flowVersions.authoredAt,
    })
    .from(flows)
    .leftJoin(flowVersions, eq(flowVersions.flowId, flows.id))
    .where(eq(flows.isRetired, false))
    .orderBy(desc(flows.createdAt), desc(flowVersions.versionNumber))

  // Group versions by flow.
  const byFlow = new Map<string, (typeof rows)>()
  for (const r of rows) {
    const list = byFlow.get(r.flowId) ?? []
    list.push(r)
    byFlow.set(r.flowId, list)
  }

  const listRows: FlowRow[] = [...byFlow.values()].map((versions) => {
    const f = versions[0]
    const published = versions.find((v) => v.versionState === 'published')
    const drafts = versions
      .filter((v) => v.versionState === 'draft')
      .sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0))
    const latestDraft = drafts[0]

    let status: FlowRow['status']
    if (published && latestDraft && (latestDraft.versionNumber ?? 0) > (published.versionNumber ?? 0)) {
      status = 'changed' // live version published, newer draft in progress
    } else if (published) {
      status = 'published'
    } else if (latestDraft) {
      status = 'draft' // authored but never published
    } else {
      status = 'empty'
    }

    const liveVersion = published?.versionNumber ?? latestDraft?.versionNumber ?? null
    const updatedAt = published?.publishedAt ?? latestDraft?.authoredAt ?? f.createdAt

    return {
      flowId: f.flowId,
      displayTitle: f.displayTitle,
      platformDisplay: platformDisplayName(f.platformSlug),
      symptomDisplay: symptomDisplayName(f.symptomSlug),
      status,
      versionNumber: liveVersion,
      hasDraft: drafts.length > 0,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
    }
  })

  return <FlowList rows={listRows} />
}
