import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { flows, flowVersions, profiles } from '@/lib/db/schema'
import { getPublishedFlowFor, getFlowVersionById } from '@/lib/flows/lookup'
import type { Flow } from '@/lib/flows/types'

let db: TestDb
let close: (() => Promise<void>) | undefined

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  close = t.close
})
afterEach(async () => {
  await close?.()
  close = undefined
})

const body: Flow = {
  startStepId: 's1',
  steps: {
    s1: { kind: 'question', n: 1, of: 1, title: 't', question: 'q', answers: [{ id: 'a1', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
  },
}

describe('getPublishedFlowFor', () => {
  it('returns null when no flow exists for the (platform_slug, symptom_slug)', async () => {
    const result = await getPublishedFlowFor(db, { platformSlug: 'no-such', symptomSlug: 'no-such' })
    expect(result).toBeNull()
  })

  it('returns the published version when one exists (slug-keyed, no platforms/symptoms tables)', async () => {
    const [profile] = await db.insert(profiles).values({ userId: crypto.randomUUID() }).returning({ id: profiles.id })
    const [flow] = await db.insert(flows).values({
      slug: 'sd3-60psd-cranks-no-start',
      platformSlug: 'ford-super-duty-3rd-gen-60-psd',
      symptomSlug: 'cranks-no-start',
      displayTitle: '2003-2007 F-250 6.0 PSD — Cranks-No-Start',
    }).returning({ id: flows.id })
    await db.insert(flowVersions).values({
      flowId: flow.id,
      versionNumber: 1,
      state: 'published',
      body,
      authoredBy: profile.id,
      publishedBy: profile.id,
      publishedAt: new Date(),
      changeNote: 'initial',
    })

    const result = await getPublishedFlowFor(db, {
      platformSlug: 'ford-super-duty-3rd-gen-60-psd',
      symptomSlug: 'cranks-no-start',
    })
    expect(result).not.toBeNull()
    expect(result?.versionNumber).toBe(1)
    expect(result?.body.startStepId).toBe('s1')
  })

  it('ignores draft + archived versions; returns only published', async () => {
    const [profile] = await db.insert(profiles).values({ userId: crypto.randomUUID() }).returning({ id: profiles.id })
    const [flow] = await db.insert(flows).values({
      slug: 'p2-s2',
      platformSlug: 'ford-super-duty-4th-gen-67-psd',
      symptomSlug: 'no-fuel-system-suspect',
      displayTitle: 'F2',
    }).returning({ id: flows.id })
    await db.insert(flowVersions).values([
      { flowId: flow.id, versionNumber: 1, state: 'draft', body, authoredBy: profile.id, changeNote: 'd' },
      { flowId: flow.id, versionNumber: 2, state: 'archived', body, authoredBy: profile.id, changeNote: 'a' },
    ])

    const result = await getPublishedFlowFor(db, {
      platformSlug: 'ford-super-duty-4th-gen-67-psd',
      symptomSlug: 'no-fuel-system-suspect',
    })
    expect(result).toBeNull()
  })

  it('ignores retired flows', async () => {
    const [profile] = await db.insert(profiles).values({ userId: crypto.randomUUID() }).returning({ id: profiles.id })
    const [flow] = await db.insert(flows).values({
      slug: 'retired',
      platformSlug: 'ford-super-duty-3rd-gen-60-psd',
      symptomSlug: 'cranks-no-start',
      displayTitle: 'Retired',
      isRetired: true,
    }).returning({ id: flows.id })
    await db.insert(flowVersions).values({
      flowId: flow.id, versionNumber: 1, state: 'published', body, authoredBy: profile.id, publishedBy: profile.id, publishedAt: new Date(), changeNote: 'x',
    })
    const result = await getPublishedFlowFor(db, { platformSlug: 'ford-super-duty-3rd-gen-60-psd', symptomSlug: 'cranks-no-start' })
    expect(result).toBeNull()
  })
})

describe('getFlowVersionById', () => {
  it('returns the version row regardless of state', async () => {
    const [profile] = await db.insert(profiles).values({ userId: crypto.randomUUID() }).returning({ id: profiles.id })
    const [flow] = await db.insert(flows).values({
      slug: 'fvb-test',
      platformSlug: 'test-platform',
      symptomSlug: 'test-symptom',
      displayTitle: 'FVB Test',
    }).returning({ id: flows.id })
    const [version] = await db.insert(flowVersions).values({
      flowId: flow.id,
      versionNumber: 1,
      state: 'published',
      body,
      authoredBy: profile.id,
      publishedBy: profile.id,
      publishedAt: new Date(),
      changeNote: 'fvb-initial',
    }).returning({ id: flowVersions.id })

    const result = await getFlowVersionById(db, { flowVersionId: version.id })
    expect(result).not.toBeNull()
    expect(result?.versionNumber).toBe(1)
    expect(result?.body.startStepId).toBe('s1')
  })

  it('returns a draft version (no state filter)', async () => {
    const [profile] = await db.insert(profiles).values({ userId: crypto.randomUUID() }).returning({ id: profiles.id })
    const [flow] = await db.insert(flows).values({
      slug: 'fvb-draft-test',
      platformSlug: 'test-platform',
      symptomSlug: 'test-symptom-draft',
      displayTitle: 'FVB Draft Test',
    }).returning({ id: flows.id })
    const [version] = await db.insert(flowVersions).values({
      flowId: flow.id,
      versionNumber: 2,
      state: 'draft',
      body,
      authoredBy: profile.id,
      changeNote: 'draft-version',
    }).returning({ id: flowVersions.id })

    const result = await getFlowVersionById(db, { flowVersionId: version.id })
    expect(result).not.toBeNull()
    expect(result?.versionNumber).toBe(2)
    expect(result?.body.startStepId).toBe('s1')
  })

  it('returns null for a random uuid that does not exist', async () => {
    const result = await getFlowVersionById(db, { flowVersionId: crypto.randomUUID() })
    expect(result).toBeNull()
  })
})
