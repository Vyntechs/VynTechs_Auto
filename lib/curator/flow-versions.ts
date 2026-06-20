import { eq, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { flowVersions } from '@/lib/db/schema'

/**
 * The single source of truth for "what version number comes next for this flow":
 * MAX(version_number)+1, or 1 if the flow has no versions yet. `cloneFromPublished`
 * (this PR), the PR-N3 orchestrator (passing its tx), and PR-N7 all import this —
 * no PR re-inlines the MAX+1 query. `db` is AppDb so a transaction handle works too.
 */
export async function nextVersionFor(db: AppDb, flowId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`MAX(${flowVersions.versionNumber})` })
    .from(flowVersions)
    .where(eq(flowVersions.flowId, flowId))
  return Number(row?.max ?? 0) + 1
}
