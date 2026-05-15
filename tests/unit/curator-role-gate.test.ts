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
  let prevFounderEmail: string | undefined

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values([
      { id: CURATOR_PROFILE, userId: CURATOR_USER, shopId: SHOP, role: 'curator' },
      { id: TECH_PROFILE, userId: TECH_USER, shopId: SHOP, role: 'tech' },
      { id: OWNER_PROFILE, userId: OWNER_USER, shopId: SHOP, role: 'owner' },
    ])
    // Pin the founder email so isFounder() is deterministic across tests.
    prevFounderEmail = process.env.FOUNDER_EMAIL
    process.env.FOUNDER_EMAIL = 'founder@example.test'
  })
  afterEach(async () => {
    await close()
    process.env.FOUNDER_EMAIL = prevFounderEmail
  })

  it('allows non-curator routes without checking role', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, 'tech@example.test', '/today')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('redirects unauthed user on /curator path to /sign-in with next= preserved', async () => {
    const result = await guardCuratorRoute(db, null, null, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/sign-in?next=%2Fcurator%2Fdrift' })
  })

  it('encodes a deeper /curator path correctly into the next param', async () => {
    const result = await guardCuratorRoute(db, null, null, '/curator/founder-notes/abc?from=novel')
    expect(result).toEqual({
      kind: 'redirect',
      to: '/sign-in?next=%2Fcurator%2Ffounder-notes%2Fabc%3Ffrom%3Dnovel',
    })
  })

  it('redirects authed non-curator non-founder on /curator path to /', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, 'tech@example.test', '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  it('allows authed curator on /curator path', async () => {
    const result = await guardCuratorRoute(db, CURATOR_USER, 'curator@example.test', '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('allows authed owner who is NOT the founder (Mac case)', async () => {
    // Admin (DB role 'owner') inherits curator access. Mac and Angel
    // both run as Admins of their shops and curate alongside Brandon.
    const result = await guardCuratorRoute(db, OWNER_USER, 'mac@example.test', '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('allows authed owner who IS the founder via FOUNDER_EMAIL', async () => {
    const result = await guardCuratorRoute(db, OWNER_USER, 'founder@example.test', '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('allows authed user without a profile if email matches FOUNDER_EMAIL', async () => {
    // The founder gate is email-based and survives a missing profile row.
    const result = await guardCuratorRoute(
      db,
      '00000000-0000-0000-0000-000000099999',
      'founder@example.test',
      '/curator/drift',
    )
    expect(result).toEqual({ kind: 'allow' })
  })
})
