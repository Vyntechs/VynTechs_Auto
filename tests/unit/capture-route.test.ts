import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/sessions', () => ({ captureArtifact: vi.fn() }))
vi.mock('@/lib/storage/client', () => ({ uploadArtifact: vi.fn() }))
vi.mock('@/lib/db/queries', () => ({ createArtifact: vi.fn() }))
vi.mock('@/lib/ai/extraction-worker', () => ({ processArtifactExtraction: vi.fn() }))

import { POST } from '@/app/api/sessions/[id]/capture/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { captureArtifact } from '@/lib/sessions'

const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
}

describe('POST /api/sessions/[id]/capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('preserves the unauthenticated rejection before request or route data', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    const request = { formData: vi.fn() } as unknown as Request
    const params = { then: vi.fn() } as unknown as Promise<{ id: string }>

    const response = await POST(request, { params })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
    expect(request.formData).not.toHaveBeenCalled()
    expect(params.then).not.toHaveBeenCalled()
    expect(captureArtifact).not.toHaveBeenCalled()
  })

  it('preserves the base-access rejection before request or route data', async () => {
    const denied = Response.json({ error: 'paywall' }, { status: 403 })
    vi.mocked(paywallReject).mockResolvedValue(denied as never)
    const request = { formData: vi.fn() } as unknown as Request
    const params = { then: vi.fn() } as unknown as Promise<{ id: string }>

    const response = await POST(request, { params })

    expect(response).toBe(denied)
    expect(request.formData).not.toHaveBeenCalled()
    expect(params.then).not.toHaveBeenCalled()
    expect(captureArtifact).not.toHaveBeenCalled()
  })

  it('returns one closed media response before parsing bytes or resolving identifiers', async () => {
    const request = { formData: vi.fn() } as unknown as Request
    const params = { then: vi.fn() } as unknown as Promise<{ id: string }>

    const response = await POST(request, { params })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_available' })
    expect(request.formData).not.toHaveBeenCalled()
    expect(params.then).not.toHaveBeenCalled()
    expect(captureArtifact).not.toHaveBeenCalled()
  })
})
