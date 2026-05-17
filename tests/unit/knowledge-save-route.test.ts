import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  knowledgeItems,
  knowledgeItemVehicles,
  profiles,
  shops,
} from '@/lib/db/schema'

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

async function mockUser(userId: string | null, email: string | null = 'owner@shop.test') {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001'
const TECH_USER_ID = '00000000-0000-0000-0000-000000000002'

describe('POST /api/knowledge/save', () => {
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    await currentDb
      .insert(profiles)
      .values({ userId: OWNER_USER_ID, role: 'owner', shopId, fullName: 'Owner' })
    await currentDb
      .insert(profiles)
      .values({ userId: TECH_USER_ID, role: 'tech', shopId, fullName: 'Tech' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    await mockUser(null)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({ type: 'note', title: 't', body: 'b' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tech-role user', async () => {
    await mockUser(TECH_USER_ID, 'tech@shop.test')
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({ type: 'note', title: 't', body: 'b' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('saves a note with body and returns 201 with the row id', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'note',
          title: 'Quick note',
          body: 'check the ground strap',
        }),
      }),
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string }
    expect(json.id).toBeTruthy()

    const [row] = await currentDb
      .select()
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, json.id))
    expect(row.type).toBe('note')
    expect(row.title).toBe('Quick note')
    expect(row.body).toBe('check the ground strap')
    expect(row.shopId).toBe(shopId)
  })

  it('saves a cause_fix with structured data and vehicle scopes', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'cause_fix',
          title: '6.7L Powerstroke hard-shift TCM C171',
          structuredData: {
            complaint: 'Hard shift',
            cause: 'TCM C171 corrosion',
            correction: 'Replace TCM C171 connector',
            first_check: 'Inspect TCM C171',
            dtcs_common: ['P0700'],
          },
          dtcList: ['P0700-00', 'p0775'],
          systemCodes: ['transmission'],
          symptoms: ['hard_shift'],
          vehicleScopes: [
            {
              yearStart: 2011,
              yearEnd: 2016,
              make: 'Ford',
              model: 'F-250',
              engine: '6.7 Powerstroke',
            },
          ],
        }),
      }),
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string }

    const [row] = await currentDb
      .select()
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, json.id))
    expect(row.type).toBe('cause_fix')
    expect(row.dtcList).toEqual(['P0700', 'P0775'])
    expect(row.structuredData).toMatchObject({
      complaint: 'Hard shift',
      cause: 'TCM C171 corrosion',
      correction: 'Replace TCM C171 connector',
    })

    const scopes = await currentDb
      .select()
      .from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, json.id))
    expect(scopes).toHaveLength(1)
    expect(scopes[0].engine).toBe('6.7L Powerstroke')
    expect(scopes[0].make).toBe('Ford')
    expect(scopes[0].yearStart).toBe(2011)
    expect(scopes[0].yearEnd).toBe(2016)
  })

  it('saves a bulletin with required structured fields', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'bulletin',
          title: 'TSB 21-2299',
          structuredData: {
            source: 'Ford',
            bulletin_id: 'TSB 21-2299',
            summary: 'Alternator pulley failure',
            body: 'Inspect alternator pulley for play',
            link: 'https://example.com/tsb',
          },
          systemCodes: ['charging'],
        }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it('saves a reference_doc with markdown body', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'reference_doc',
          title: 'Ford wire color chart',
          body: '## Color codes\n\n- BK = ground',
        }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it('returns 422 when cause_fix structured data is missing cause/correction', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'cause_fix',
          title: 'x',
          structuredData: { complaint: 'only complaint, no cause' },
        }),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when note has no body', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({ type: 'note', title: 'x' }),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when a vehicleScope has yearEnd < yearStart', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'note',
          title: 'x',
          body: 'x',
          vehicleScopes: [{ yearStart: 2018, yearEnd: 2015, make: 'Ford' }],
        }),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 400 when type is a rich type (pinout/connector/etc) — handled in PR 3', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({ type: 'pinout', title: 'x', body: 'x' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('ignores any shopId in the request body — uses the owner profile shop', async () => {
    // Regression guard: owners cannot inject another shop's id by passing one
    // in the body. Shop is sourced from the authenticated profile.
    const [otherShop] = await currentDb.insert(shops).values({ name: 'Other Shop' }).returning()

    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'note',
          title: 'x',
          body: 'x',
          shopId: otherShop.id,
        }),
      }),
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string }
    const [row] = await currentDb
      .select()
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, json.id))
    expect(row.shopId).toBe(shopId)
    expect(row.shopId).not.toBe(otherShop.id)
  })
})
