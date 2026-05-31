import Link from 'next/link'
import { sql, eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { flows, flowVersions } from '@/lib/db/schema'
import { platformDisplayName, symptomDisplayName } from '@/lib/curator/slug-catalog'
import { FlowList } from '@/components/curator/flow-list'

export const metadata = { title: 'Curator — Flows' }

export default async function FlowsIndexPage() {
  // Non-retired flows + their currently-published version (if any).
  const rows = await db
    .select({
      flowId: flows.id,
      slug: flows.slug,
      displayTitle: flows.displayTitle,
      platformSlug: flows.platformSlug,
      symptomSlug: flows.symptomSlug,
      currentVersionNumber: flowVersions.versionNumber,
      currentVersionState: flowVersions.state,
      publishedAt: flowVersions.publishedAt,
      authoredAt: flowVersions.authoredAt,
    })
    .from(flows)
    .leftJoin(
      flowVersions,
      sql`${flowVersions.flowId} = ${flows.id} AND ${flowVersions.state} = 'published'`,
    )
    .where(eq(flows.isRetired, false))
    .orderBy(desc(sql`COALESCE(${flowVersions.publishedAt}, ${flows.createdAt})`))

  const listRows = rows.map((r) => ({
    flowId: r.flowId,
    displayTitle: r.displayTitle,
    platformDisplay: platformDisplayName(r.platformSlug),
    symptomDisplay: symptomDisplayName(r.symptomSlug),
    currentVersionNumber: r.currentVersionNumber,
    currentVersionState: r.currentVersionState,
  }))

  return (
    <div className="vt-curator-page">
      <header className="vt-curator-page-header">
        <h1>Flows</h1>
        <Link href="/curator/flows/new" className="vt-btn vt-btn-primary">+ Add new flow</Link>
      </header>

      {listRows.length === 0 ? (
        <div className="vt-curator-empty">
          <p>No flows yet. Add your first.</p>
          <Link href="/curator/flows/new" className="vt-btn vt-btn-primary">+ Add new flow</Link>
        </div>
      ) : (
        <FlowList rows={listRows} />
      )}
    </div>
  )
}
