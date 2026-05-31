import { describe, it, expect, afterEach } from 'vitest'
import { createTestDb } from '../helpers/db'
import { flows, flowVersions, shops, profiles } from '@/lib/db/schema'
import type { Flow } from '@/lib/flows/types'
import { nextVersionFor } from '@/lib/curator/flow-versions'

const SHOP = '00000000-0000-0000-0000-0000000000c1'
const USER = '00000000-0000-0000-0000-0000000000c2'
const CURATOR = '00000000-0000-0000-0000-0000000000c3'

const emptyBody: Flow = { startStepId: 'step-1', steps: {} }

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

async function seed() {
  const { db, close: c } = await createTestDb()
  close = c
  await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
  await db.insert(profiles).values({
    id: CURATOR, userId: USER, shopId: SHOP, fullName: 'Curator', role: 'tech',
  })
  return db
}

describe('nextVersionFor', () => {
  it('returns 1 when the flow has no versions', async () => {
    const db = await seed()
    const [flow] = await db
      .insert(flows)
      .values({
        slug: 's1',
        platformSlug: 'ford-super-duty-3rd-gen-60-psd',
        symptomSlug: 'cranks-no-start',
        displayTitle: 't',
      })
      .returning({ id: flows.id })
    expect(await nextVersionFor(db, flow.id)).toBe(1)
  })

  it('returns MAX(version_number)+1 when versions exist', async () => {
    const db = await seed()
    const [flow] = await db
      .insert(flows)
      .values({
        slug: 's2',
        platformSlug: 'ford-super-duty-3rd-gen-60-psd',
        symptomSlug: 'cranks-no-start',
        displayTitle: 't',
      })
      .returning({ id: flows.id })
    await db.insert(flowVersions).values([
      { flowId: flow.id, versionNumber: 1, state: 'archived', body: emptyBody, changeNote: 'v1', authoredBy: CURATOR },
      { flowId: flow.id, versionNumber: 2, state: 'published', body: emptyBody, changeNote: 'v2', authoredBy: CURATOR },
    ])
    expect(await nextVersionFor(db, flow.id)).toBe(3)
  })
})
