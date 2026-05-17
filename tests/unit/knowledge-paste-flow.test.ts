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

vi.mock('@/lib/knowledge/classify-paste', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/knowledge/classify-paste')>(
      '@/lib/knowledge/classify-paste',
    )
  return {
    ...actual,
    classifyPaste: vi.fn(),
  }
})

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

describe('knowledge paste → save round-trip (integration)', () => {
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
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  async function pasteThenSave(pasteText: string, savePayload: Record<string, unknown>) {
    await mockUser(OWNER_USER_ID)

    // 1. POST /api/knowledge/paste — receives the AI proposal
    const { POST: pastePost } = await import('@/app/api/knowledge/paste/route')
    const pasteRes = await pastePost(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: pasteText }),
      }),
    )
    expect(pasteRes.status).toBe(200)
    const proposal = (await pasteRes.json()) as {
      status: string
      draft: Record<string, unknown>
    }
    expect(proposal.status).toBe('parsed')

    // 2. POST /api/knowledge/save — submits the (possibly-edited) proposal
    const { POST: savePost } = await import('@/app/api/knowledge/save/route')
    const saveRes = await savePost(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify(savePayload),
      }),
    )
    expect(saveRes.status).toBe(201)
    const { id } = (await saveRes.json()) as { id: string }
    return id
  }

  it('cause_fix: classifier proposes → owner saves → row + vehicle scope appear', async () => {
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: {
        type: 'cause_fix',
        title: 'F-250 6.7L hard-shift — TCM C171 corrosion',
        structuredData: {
          complaint: 'Hard shift into 4th',
          cause: 'TCM C171 corrosion',
          correction: 'Replace TCM C171 connector',
          first_check: 'Inspect TCM C171',
          dtcs_common: ['P0700'],
        },
        dtcList: ['P0700'],
        systemCodes: ['transmission'],
        symptoms: ['hard_shift'],
        vehicleScopes: [
          { yearStart: 2011, yearEnd: 2016, make: 'Ford', model: 'F-250', engine: '6.7 Powerstroke' },
        ],
      },
      sourceSpans: {},
    })

    const id = await pasteThenSave(
      '2011-2016 F-250 6.7 Powerstroke hard shift, TCM C171 corrosion, P0700',
      {
        type: 'cause_fix',
        title: 'F-250 6.7L hard-shift — TCM C171 corrosion',
        structuredData: {
          complaint: 'Hard shift into 4th',
          cause: 'TCM C171 corrosion',
          correction: 'Replace TCM C171 connector',
          first_check: 'Inspect TCM C171',
          dtcs_common: ['P0700'],
        },
        dtcList: ['P0700'],
        systemCodes: ['transmission'],
        symptoms: ['hard_shift'],
        vehicleScopes: [
          { yearStart: 2011, yearEnd: 2016, make: 'Ford', model: 'F-250', engine: '6.7 Powerstroke' },
        ],
      },
    )

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('cause_fix')
    expect(row.shopId).toBe(shopId)
    expect(row.dtcList).toEqual(['P0700'])

    const scopes = await currentDb
      .select()
      .from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, id))
    expect(scopes).toHaveLength(1)
    expect(scopes[0].engine).toBe('6.7L Powerstroke')
  })

  it('bulletin: round-trip persists OEM + bulletin_id + body in structured data', async () => {
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: {
        type: 'bulletin',
        title: 'TSB 21-2299 — F-250 alternator pulley',
        structuredData: {
          source: 'Ford',
          bulletin_id: 'TSB 21-2299',
          summary: 'Alternator pulley failure on 2017-2019 6.7L',
          body: 'Inspect pulley for play.',
        },
        systemCodes: ['charging'],
        vehicleScopes: [{ yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250' }],
      },
      sourceSpans: {},
    })

    const id = await pasteThenSave('TSB 21-2299 — alternator pulley...', {
      type: 'bulletin',
      title: 'TSB 21-2299 — F-250 alternator pulley',
      structuredData: {
        source: 'Ford',
        bulletin_id: 'TSB 21-2299',
        summary: 'Alternator pulley failure on 2017-2019 6.7L',
        body: 'Inspect pulley for play.',
      },
      systemCodes: ['charging'],
      vehicleScopes: [{ yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250' }],
    })

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('bulletin')
    expect(row.structuredData).toMatchObject({
      source: 'Ford',
      bulletin_id: 'TSB 21-2299',
    })
  })

  it('reference_doc: round-trip persists markdown body in body column', async () => {
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: {
        type: 'reference_doc',
        title: 'Ford wire colors',
        body: '## Color codes\n- BK = ground',
      },
      sourceSpans: {},
    })

    const id = await pasteThenSave('Ford wire color quick ref...', {
      type: 'reference_doc',
      title: 'Ford wire colors',
      body: '## Color codes\n- BK = ground',
    })

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('reference_doc')
    expect(row.body).toContain('Color codes')
  })

  it('note: round-trip persists free-form body', async () => {
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: {
        type: 'note',
        title: 'Ground strap check',
        body: 'Always check the engine-to-frame ground strap first',
      },
      sourceSpans: {},
    })

    const id = await pasteThenSave('check the ground strap', {
      type: 'note',
      title: 'Ground strap check',
      body: 'Always check the engine-to-frame ground strap first',
    })

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('note')
    expect(row.body).toMatch(/ground strap/)
  })
})
