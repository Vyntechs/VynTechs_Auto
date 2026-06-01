/**
 * Slug-keyed published-flow lookup.
 *
 * Design decisions:
 *  - No joins to `platforms` or `symptoms` tables — those tables do not exist
 *    on the main-line schema (they live on a separate V2 branch). All lookups
 *    query `flows` directly on the `platform_slug` / `symptom_slug` TEXT columns.
 *  - Two partial unique indexes already enforce the invariants this code relies
 *    on: `flows_active_platform_symptom_uniq` (one active flow per slug-pair)
 *    and `flow_versions_one_published_per_flow` (at most one published version
 *    per flow). Therefore `.limit(1)` is a safety belt, not a tiebreaker.
 *  - `db` is injected so unit tests can pass the PGlite TestDb instance without
 *    any monkey-patching. `AppDb` is assignable by both PostgresJsDatabase and
 *    PgliteDatabase.
 *  - `getFlowVersionById` is used for version-pinning: a session started on v1
 *    keeps its `flowVersionId` even when v2 publishes. It returns the row
 *    regardless of current state so the wizard page can compare the pinned
 *    version against the current published version and surface a "newer version
 *    available" notice to the tech without interrupting the active session.
 */
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { flows, flowVersions } from '@/lib/db/schema'
import type { Flow } from '@/lib/flows/types'

export type PublishedFlowLookup = {
  flowId: string
  flowVersionId: string
  versionNumber: number
  bodySchemaVersion: string
  body: Flow
}

/**
 * Returns the single published, non-retired flow version for the given
 * (platformSlug, symptomSlug) pair, or null if none exists.
 *
 * Uses TEXT slug columns on `flows` directly — no join to platforms/symptoms.
 */
export async function getPublishedFlowFor(
  db: AppDb,
  args: { platformSlug: string; symptomSlug: string },
): Promise<PublishedFlowLookup | null> {
  const [row] = await db
    .select({
      flowId: flows.id,
      flowVersionId: flowVersions.id,
      versionNumber: flowVersions.versionNumber,
      bodySchemaVersion: flowVersions.bodySchemaVersion,
      body: flowVersions.body,
    })
    .from(flows)
    .innerJoin(flowVersions, eq(flowVersions.flowId, flows.id))
    .where(
      and(
        eq(flows.platformSlug, args.platformSlug),
        eq(flows.symptomSlug, args.symptomSlug),
        eq(flows.isRetired, false),
        eq(flowVersions.state, 'published'),
      ),
    )
    .limit(1)

  if (!row) return null
  return {
    flowId: row.flowId,
    flowVersionId: row.flowVersionId,
    versionNumber: row.versionNumber,
    bodySchemaVersion: row.bodySchemaVersion,
    body: row.body as Flow,
  }
}

/**
 * Returns a specific flow version by its UUID, regardless of its current
 * state (draft / published / archived). Used for version-pinning: once a
 * session locks in a `flowVersionId`, subsequent page loads fetch that exact
 * row so the wizard can continue on the same authored body even if a newer
 * version has since published.
 *
 * Returns null when the id does not exist.
 */
export async function getFlowVersionById(
  db: AppDb,
  args: { flowVersionId: string },
): Promise<PublishedFlowLookup | null> {
  const [row] = await db
    .select({
      flowId: flowVersions.flowId,
      flowVersionId: flowVersions.id,
      versionNumber: flowVersions.versionNumber,
      bodySchemaVersion: flowVersions.bodySchemaVersion,
      body: flowVersions.body,
    })
    .from(flowVersions)
    .where(eq(flowVersions.id, args.flowVersionId))
    .limit(1)

  if (!row) return null
  return {
    flowId: row.flowId,
    flowVersionId: row.flowVersionId,
    versionNumber: row.versionNumber,
    bodySchemaVersion: row.bodySchemaVersion,
    body: row.body as Flow,
  }
}
