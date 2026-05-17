import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, shops } from '@/lib/db/schema'

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

// Mock the storage upload + signedUrl so the route test never reaches Supabase.
// Keep validateKnowledgeImageBytes + constants as the real implementation so we
// can verify the route's validation gate.
vi.mock('@/lib/storage/knowledge-image', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/knowledge-image')>(
    '@/lib/storage/knowledge-image',
  )
  return {
    ...actual,
    uploadKnowledgeImage: vi.fn(async ({ shopId, knowledgeType }) => {
      return `knowledge/${shopId}/${knowledgeType}/test-uuid.jpg`
    }),
    knowledgeImageSignedUrl: vi.fn(async (key) => `https://signed.example/${key}`),
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
const TECH_USER_ID = '00000000-0000-0000-0000-000000000002'

const VALID_JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

function multipartFile(opts: {
  kind: string
  bytes: Uint8Array
  mimeType: string
  filename?: string
}) {
  const form = new FormData()
  form.append('knowledgeType', opts.kind)
  form.append(
    'file',
    new Blob([opts.bytes.slice().buffer as ArrayBuffer], { type: opts.mimeType }),
    opts.filename ?? 'upload.bin',
  )
  return form
}

describe('POST /api/knowledge/upload-image', () => {
  let close: () => Promise<void>

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    await currentDb
      .insert(profiles)
      .values({ userId: OWNER_USER_ID, role: 'owner', shopId: shop.id, fullName: 'Owner' })
    await currentDb
      .insert(profiles)
      .values({ userId: TECH_USER_ID, role: 'tech', shopId: shop.id, fullName: 'Tech' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    await mockUser(null)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tech-role user', async () => {
    await mockUser(TECH_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when no multipart body is present', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', {
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 422 when knowledgeType is missing', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = new FormData()
    form.append('file', new Blob([VALID_JPG_BYTES.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }))
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when knowledgeType is not connector or wiring_diagram', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'pinout', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when MIME type is not in the accept-list', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({
      kind: 'connector',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mimeType: 'application/pdf',
    })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when bytes do not match the declared MIME type', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/png' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 201 with storageKey and signedUrl on success', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { storageKey: string; signedUrl: string }
    expect(json.storageKey).toMatch(/^knowledge\/.+\/connector\/.+\.jpg$/)
    expect(json.signedUrl).toContain('signed.example')
  })

  it('accepts SVG with valid <svg start', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const form = multipartFile({ kind: 'wiring_diagram', bytes: svg, mimeType: 'image/svg+xml' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(201)
  })

  it('rejects SVG whose bytes are actually HTML', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
    const form = multipartFile({ kind: 'wiring_diagram', bytes: html, mimeType: 'image/svg+xml' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })
})
