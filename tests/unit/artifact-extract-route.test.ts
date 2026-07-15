import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/db/queries', () => ({
  getArtifactById: vi.fn(),
  getProfileByUserId: vi.fn(),
  getSessionById: vi.fn(),
}))
vi.mock('@/lib/ai/extraction-worker', () => ({ processArtifactExtraction: vi.fn() }))

import { POST } from '@/app/api/artifacts/[id]/extract/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { getArtifactById, getProfileByUserId, getSessionById } from '@/lib/db/queries'
import { processArtifactExtraction } from '@/lib/ai/extraction-worker'

const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
}

describe('POST /api/artifacts/[id]/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('preserves auth and base access ordering', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    const params = { then: vi.fn() } as unknown as Promise<{ id: string }>
    let response = await POST(new Request('http://localhost'), { params })
    expect(response.status).toBe(401)
    expect(params.then).not.toHaveBeenCalled()

    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    const denied = Response.json({ error: 'deactivated' }, { status: 403 })
    vi.mocked(paywallReject).mockResolvedValue(denied as never)
    response = await POST(new Request('http://localhost'), { params })
    expect(response).toBe(denied)
    expect(params.then).not.toHaveBeenCalled()
  })

  it('returns the same closed response before identifiers, ownership, or extraction work', async () => {
    const params = { then: vi.fn() } as unknown as Promise<{ id: string }>

    const response = await POST(new Request('http://localhost'), { params })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_available' })
    expect(params.then).not.toHaveBeenCalled()
    expect(getArtifactById).not.toHaveBeenCalled()
    expect(getSessionById).not.toHaveBeenCalled()
    expect(getProfileByUserId).not.toHaveBeenCalled()
    expect(processArtifactExtraction).not.toHaveBeenCalled()
  })
})
