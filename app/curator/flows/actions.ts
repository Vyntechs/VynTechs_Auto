'use server'

import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db/client'
import { flows, flowVersions } from '@/lib/db/schema'
import type { Flow } from '@/lib/flows/types'
import { requireCuratorProfile } from '@/lib/curator/route-helpers'
import { validateFlowForPublish, validateFlowSlugs } from '@/lib/curator/flow-validation'
import { isKnownPlatformSlug, isKnownSymptomSlug } from '@/lib/curator/slug-catalog'
import { nextVersionFor } from '@/lib/curator/flow-versions'

/**
 * Create a new flow + its first draft flow_version (empty body) for the given
 * (platformSlug, symptomSlug). Throws if a non-retired flow already exists for
 * the pair, or if either slug is not in the known catalog (authoring-time
 * referential integrity — replaces the removed DB FK).
 */
export async function createFlow(args: {
  platformSlug: string
  symptomSlug: string
  displayTitle: string
  slug: string
}): Promise<{ flowId: string; flowVersionId: string }> {
  const profile = await requireCuratorProfile()

  // Authoring-time slug gate.
  if (!isKnownPlatformSlug(args.platformSlug)) {
    throw new Error(`Unknown platform "${args.platformSlug}".`)
  }
  if (!isKnownSymptomSlug(args.symptomSlug)) {
    throw new Error(`Unknown symptom "${args.symptomSlug}".`)
  }

  // Pair uniqueness (the partial unique index flows_active_platform_symptom_uniq
  // also enforces this — defensive pre-check for a clean error message).
  const existing = await db
    .select({ id: flows.id })
    .from(flows)
    .where(
      and(
        eq(flows.platformSlug, args.platformSlug),
        eq(flows.symptomSlug, args.symptomSlug),
        eq(flows.isRetired, false),
      ),
    )
    .limit(1)
  if (existing.length > 0) {
    throw new Error('A non-retired flow already exists for this vehicle + symptom.')
  }

  return await db.transaction(async (tx) => {
    const [flow] = await tx
      .insert(flows)
      .values({
        slug: args.slug,
        platformSlug: args.platformSlug,
        symptomSlug: args.symptomSlug,
        displayTitle: args.displayTitle,
      })
      .returning({ id: flows.id })

    const emptyBody: Flow = {
      startStepId: 'step-1',
      steps: { 'step-1': { kind: 'question', n: 1, of: 1, title: '', question: '', answers: [] } },
    }

    const [version] = await tx
      .insert(flowVersions)
      .values({
        flowId: flow.id,
        versionNumber: 1,
        state: 'draft',
        body: emptyBody,
        authoredBy: profile.id,
        changeNote: 'initial draft',
      })
      .returning({ id: flowVersions.id })

    revalidatePath('/curator/flows')
    return { flowId: flow.id, flowVersionId: version.id }
  })
}

/**
 * Save edits to an existing draft. Drafts are mutable in place; only publish
 * creates immutability. Throws if the version is not in 'draft' state.
 */
export async function saveDraft(args: { flowVersionId: string; body: Flow; changeNote: string }) {
  const profile = await requireCuratorProfile()
  const [version] = await db
    .select({ state: flowVersions.state, flowId: flowVersions.flowId })
    .from(flowVersions)
    .where(eq(flowVersions.id, args.flowVersionId))
    .limit(1)
  if (!version) throw new Error('Flow version not found')
  if (version.state !== 'draft') throw new Error('Only draft versions can be edited; clone published first.')

  await db
    .update(flowVersions)
    .set({ body: args.body, changeNote: args.changeNote, authoredBy: profile.id })
    .where(eq(flowVersions.id, args.flowVersionId))

  revalidatePath(`/curator/flows/${version.flowId}/edit`)
}

/**
 * Publish a draft. Validates the body AND the slug pair (known-slug gate) first.
 * Archives the previously-published version (if any) in the same transaction.
 */
export async function publishDraft(args: {
  flowVersionId: string
  changeNote: string
}): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const profile = await requireCuratorProfile()

  const [version] = await db
    .select()
    .from(flowVersions)
    .where(eq(flowVersions.id, args.flowVersionId))
    .limit(1)
  if (!version) throw new Error('Flow version not found')
  if (version.state !== 'draft') throw new Error('Only drafts can be published')

  const bodyCheck = validateFlowForPublish(version.body as Flow)
  if (!bodyCheck.ok) return bodyCheck

  // Known-slug gate — replaces the removed DB FK to platforms/symptoms.
  const [flow] = await db
    .select({ platformSlug: flows.platformSlug, symptomSlug: flows.symptomSlug })
    .from(flows)
    .where(eq(flows.id, version.flowId))
    .limit(1)
  if (!flow) throw new Error('Parent flow not found')
  const slugCheck = validateFlowSlugs(flow.platformSlug, flow.symptomSlug)
  if (!slugCheck.ok) return slugCheck

  if (!args.changeNote.trim()) {
    return { ok: false, errors: ['A change note is required to publish.'] }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(flowVersions)
      .set({ state: 'archived', archivedAt: new Date(), archivedBy: profile.id })
      .where(and(eq(flowVersions.flowId, version.flowId), eq(flowVersions.state, 'published')))

    await tx
      .update(flowVersions)
      .set({ state: 'published', publishedAt: new Date(), publishedBy: profile.id, changeNote: args.changeNote })
      .where(eq(flowVersions.id, args.flowVersionId))
  })

  revalidatePath('/curator/flows')
  revalidatePath(`/curator/flows/${version.flowId}`)
  return { ok: true }
}

/**
 * Clone a published version into a new draft for editing. Returns the new
 * draft's flowVersionId.
 */
export async function cloneFromPublished(args: { flowId: string }): Promise<{ flowVersionId: string }> {
  const profile = await requireCuratorProfile()

  return await db.transaction(async (tx) => {
    const [published] = await tx
      .select()
      .from(flowVersions)
      .where(and(eq(flowVersions.flowId, args.flowId), eq(flowVersions.state, 'published')))
      .limit(1)
    if (!published) throw new Error('No published version to clone from')

    // Shared helper — the single source of MAX(version_number)+1. The tx handle is
    // AppDb-compatible, so the clone runs inside this transaction. Do NOT re-inline.
    const nextVersion = await nextVersionFor(tx, args.flowId)

    const [draft] = await tx
      .insert(flowVersions)
      .values({
        flowId: args.flowId,
        versionNumber: nextVersion,
        state: 'draft',
        body: published.body,
        bodySchemaVersion: published.bodySchemaVersion,
        authoredBy: profile.id,
        changeNote: `cloned from v${published.versionNumber}`,
        forkedFromVersionId: published.id,
      })
      .returning({ id: flowVersions.id })

    revalidatePath(`/curator/flows/${args.flowId}`)
    return { flowVersionId: draft.id }
  })
}

/**
 * Archive a draft without publishing — for abandoning a draft that never ships.
 */
export async function archiveDraft(args: { flowVersionId: string }) {
  const profile = await requireCuratorProfile()
  const [v] = await db
    .select({ state: flowVersions.state, flowId: flowVersions.flowId })
    .from(flowVersions)
    .where(eq(flowVersions.id, args.flowVersionId))
    .limit(1)
  if (!v) throw new Error('Not found')
  if (v.state !== 'draft') throw new Error('Only drafts can be archived without publishing')

  await db
    .update(flowVersions)
    .set({ state: 'archived', archivedAt: new Date(), archivedBy: profile.id })
    .where(eq(flowVersions.id, args.flowVersionId))

  revalidatePath(`/curator/flows/${v.flowId}`)
}
