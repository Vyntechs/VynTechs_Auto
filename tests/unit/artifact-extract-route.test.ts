import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { artifacts, profiles, sessions, shops } from '@/lib/db/schema'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn().mockResolvedValue(null),
}))

const extractMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/ai/extraction-worker', () => ({
  processArtifactExtraction: extractMock,
}))

async function makeContext(opts: { ownerUserId: string }) {
  const shop = (await currentDb.insert(shops).values({ name: 'Shop' }).returning())[0]
  const ownerProfile = (
    await currentDb
      .insert(profiles)
      .values({ userId: opts.ownerUserId, shopId: shop.id, role: 'tech' })
      .returning()
  )[0]
  const session = (
    await currentDb
      .insert(sessions)
      .values({
        shopId: shop.id,
        techId: ownerProfile.id,
        intake: {
          vehicleYear: 2018,
          vehicleMake: 'Ford',
          vehicleModel: 'F-150',
          customerComplaint: 'misfire',
        },
        treeState: { nodes: [], currentNodeId: 'n1', message: '' },
        status: 'open',
      })
      .returning()
  )[0]
  const artifact = (
    await currentDb
      .insert(artifacts)
      .values({
        sessionId: session.id,
        nodeId: 'n1',
        kind: 'photo',
        storageKey: 'k',
        mimeType: 'image/jpeg',
        bytes: 100,
        extractionStatus: 'pending',
      })
      .returning()
  )[0]
  return { shop, ownerProfile, session, artifact }
}

async function mockAuthAs(userId: string) {
  const supabaseMock = vi.mocked(
    (await import('@/lib/supabase-server')).getServerSupabase,
  )
  supabaseMock.mockResolvedValueOnce({
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  } as never)
}

describe('POST /api/artifacts/[id]/extract', () => {
  let close: () => Promise<void>

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
    extractMock.mockClear()
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 404 when a user from a DIFFERENT shop tries to extract an artifact (IDOR guard)', async () => {
    const { artifact } = await makeContext({
      ownerUserId: '00000000-0000-0000-0000-000000000aaa',
    })

    // Attacker is authenticated, has their own shop+profile, but does NOT
    // own the session that contains this artifact.
    const attackerShop = (
      await currentDb.insert(shops).values({ name: 'Other Shop' }).returning()
    )[0]
    const attackerUserId = '00000000-0000-0000-0000-000000000bbb'
    await currentDb
      .insert(profiles)
      .values({ userId: attackerUserId, shopId: attackerShop.id, role: 'tech' })

    await mockAuthAs(attackerUserId)
    const { POST } = await import('@/app/api/artifacts/[id]/extract/route')
    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: artifact.id }),
    })

    expect(res.status).toBe(404)
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the artifact id does not exist', async () => {
    await makeContext({ ownerUserId: '00000000-0000-0000-0000-000000000ccc' })
    await mockAuthAs('00000000-0000-0000-0000-000000000ccc')
    const { POST } = await import('@/app/api/artifacts/[id]/extract/route')
    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000fff' }),
    })

    expect(res.status).toBe(404)
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('runs the extraction for a same-shop user', async () => {
    const { artifact, ownerProfile } = await makeContext({
      ownerUserId: '00000000-0000-0000-0000-000000000ddd',
    })
    // Different user, same shop — should be allowed.
    const sameShopUserId = '00000000-0000-0000-0000-000000000eee'
    await currentDb
      .insert(profiles)
      .values({ userId: sameShopUserId, shopId: ownerProfile.shopId, role: 'tech' })

    await mockAuthAs(sameShopUserId)
    const { POST } = await import('@/app/api/artifacts/[id]/extract/route')
    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: artifact.id }),
    })

    expect(res.status).toBe(200)
    expect(extractMock).toHaveBeenCalledWith(expect.anything(), artifact.id)
  })
})
