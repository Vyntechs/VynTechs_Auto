import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

const FOUNDER_EMAIL = 'brandon@vyntechs.com'
const NON_FOUNDER_EMAIL = 'tech@example.com'

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
    vi.stubEnv('FOUNDER_EMAILS', FOUNDER_EMAIL)
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await close()
  })

  it('allows non-curator routes without checking role', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, NON_FOUNDER_EMAIL, '/today')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('redirects unauthed user on /curator path to /sign-in with next= preserved', async () => {
    const result = await guardCuratorRoute(db, null, null, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/sign-in?next=%2Fcurator%2Fdrift' })
  })

  it('encodes a deeper /curator path correctly into the next param', async () => {
    const result = await guardCuratorRoute(
      db,
      null,
      null,
      '/curator/founder-notes/abc?from=novel',
    )
    expect(result).toEqual({
      kind: 'redirect',
      to: '/sign-in?next=%2Fcurator%2Ffounder-notes%2Fabc%3Ffrom%3Dnovel',
    })
  })

  it('redirects authed tech on /curator path to /', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, NON_FOUNDER_EMAIL, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  it('allows authed curator on /curator path regardless of email', async () => {
    const result = await guardCuratorRoute(db, CURATOR_USER, NON_FOUNDER_EMAIL, '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('DENIES authed owner without founder email on /curator path', async () => {
    // Regression guard: pre-fix, owner role implicitly granted curator access.
    // Post-fix, owner is just a shop role — curator requires founder email.
    const result = await guardCuratorRoute(db, OWNER_USER, NON_FOUNDER_EMAIL, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  it('ALLOWS authed owner with founder email on /curator path', async () => {
    const result = await guardCuratorRoute(db, OWNER_USER, FOUNDER_EMAIL, '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('ALLOWS authed tech with founder email on /curator path (founder gate trumps role)', async () => {
    const result = await guardCuratorRoute(db, TECH_USER, FOUNDER_EMAIL, '/curator/drift')
    expect(result).toEqual({ kind: 'allow' })
  })

  it('DENIES authed user when FOUNDER_EMAILS is unset and role is not curator', async () => {
    vi.stubEnv('FOUNDER_EMAILS', '')
    vi.stubEnv('FOUNDER_EMAIL', '')
    const result = await guardCuratorRoute(db, OWNER_USER, FOUNDER_EMAIL, '/curator/drift')
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })
})
