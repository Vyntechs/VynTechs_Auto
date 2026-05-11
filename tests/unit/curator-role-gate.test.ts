import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { profiles, shops } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import { guardCuratorRoute } from '@/lib/curator/role-gate'

// userId must be valid UUIDs — the profiles.userId column is uuid type.
const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR_USER = '00000000-0000-0000-0000-000000000002'
const CURATOR_PROFILE = '00000000-0000-0000-0000-000000000010'
const TECH_USER = '00000000-0000-0000-0000-000000000003'
const TECH_PROFILE = '00000000-0000-0000-0000-000000000011'
const OWNER_USER = '00000000-0000-0000-0000-000000000004'
const OWNER_PROFILE = '00000000-0000-0000-0000-000000000012'

describe('guardCuratorRoute', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values([
      { id: CURATOR_PROFILE, userId: CURATOR_USER, shopId: SHOP, role: 'curator' },
      { id: TECH_PROFILE, userId: TECH_USER, shopId: SHOP, role: 'tech' },
      { id: OWNER_PROFILE, userId: OWNER_USER, shopId: SHOP, role: 'owner' },
    ])
  })
  afterEach(async () => { await close() })

  it('allows non-curator routes without checking role', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, '/today')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('redirects unauthed user on /curator path to /sign-in with next= preserved', async () => {
    const result = await guardCuratorRoute(db, null, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/sign-in?next=%2Fcurator%2Fdrift' })
  })

  it('encodes a deeper /curator path correctly into the next param', async () => {
    const result = await guardCuratorRoute(db, null, '/curator/founder-notes/abc?from=novel')
    expect(result).toEqual({
      kind: 'redirect',
      to: '/sign-in?next=%2Fcurator%2Ffounder-notes%2Fabc%3Ffrom%3Dnovel',
    })
  })

  it('redirects authed non-curator on /curator path to /', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  it('allows authed curator on /curator path', async () => {
    const result = await guardCuratorRoute(db, CURATOR_USER, '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('allows authed owner on /curator path (founder is both)', async () => {
    const result = await guardCuratorRoute(db, OWNER_USER, '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })
})
