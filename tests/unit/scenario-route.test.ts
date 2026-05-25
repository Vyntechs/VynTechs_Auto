import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))
vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/sessions', () => ({
  setLastScenarioForSession: vi.fn(),
}))

import { POST } from '@/app/api/sessions/[id]/scenario/route'
import { getServerSupabase } from '@/lib/supabase-server'
import { setLastScenarioForSession } from '@/lib/sessions'

function makeReq(body: unknown) {
  return new Request('http://test/api/sessions/s1/scenario', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const okSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
}
const unauthSupabase = {
  auth: { getUser: async () => ({ data: { user: null } }) },
}

describe('POST /api/sessions/[id]/scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when no user', async () => {
    vi.mocked(getServerSupabase).mockResolvedValue(unauthSupabase as never)
    const res = await POST(makeReq({ slug: 'idle' }), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid JSON', async () => {
    vi.mocked(getServerSupabase).mockResolvedValue(okSupabase as never)
    const req = new Request('http://test/api/sessions/s1/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(400)
  })

  it('passes slug to the helper and returns helper error verbatim', async () => {
    vi.mocked(getServerSupabase).mockResolvedValue(okSupabase as never)
    vi.mocked(setLastScenarioForSession).mockResolvedValue({
      ok: false,
      status: 404,
      error: 'not found',
    })
    const res = await POST(makeReq({ slug: 'idle' }), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('not found')
  })

  it('returns 200 on success', async () => {
    vi.mocked(getServerSupabase).mockResolvedValue(okSupabase as never)
    vi.mocked(setLastScenarioForSession).mockResolvedValue({ ok: true })
    const res = await POST(makeReq({ slug: 'idle' }), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)
  })

  it('calls the helper with the right args', async () => {
    vi.mocked(getServerSupabase).mockResolvedValue(okSupabase as never)
    vi.mocked(setLastScenarioForSession).mockResolvedValue({ ok: true })
    await POST(makeReq({ slug: 'heavy-load' }), { params: Promise.resolve({ id: 's1' }) })
    expect(setLastScenarioForSession).toHaveBeenCalledWith({
      db: expect.anything(),
      userId: 'u1',
      sessionId: 's1',
      slug: 'heavy-load',
    })
  })
})
