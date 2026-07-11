import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/db/queries', () => ({ getSessionById: vi.fn(async () => null) }))
vi.mock('@/lib/sessions', () => ({
  closeSessionForUser: vi.fn(),
  submitRepairObservationForUser: vi.fn(),
}))

import { POST as closePost } from '@/app/api/sessions/[id]/close/route'
import { POST as observationPost } from '@/app/api/sessions/[id]/repair-observation/route'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { closeSessionForUser, submitRepairObservationForUser } from '@/lib/sessions'

const sessionId = '00000000-0000-4000-8000-000000000030'
const params = Promise.resolve({ id: sessionId })

function request(path: 'close' | 'repair-observation') {
  return new Request(`http://localhost/api/sessions/${sessionId}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(path === 'close'
      ? { mode: 'declined_no_repair' }
      : { observation: 'Pressure still drops.' }),
  })
}

describe('Shop OS repair and close route mappings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSupabase).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
    } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('preserves retryable lock conflicts on both routes', async () => {
    vi.mocked(closeSessionForUser).mockResolvedValue({
      ok: false, status: 409, error: 'conflict', retryable: true,
    })
    vi.mocked(submitRepairObservationForUser).mockResolvedValue({
      ok: false, status: 409, error: 'conflict', retryable: true,
    })

    const closeResponse = await closePost(request('close'), { params })
    const observationResponse = await observationPost(request('repair-observation'), { params })

    expect(closeResponse.status).toBe(409)
    expect(await closeResponse.json()).toEqual({ error: 'conflict', retryable: true })
    expect(observationResponse.status).toBe(409)
    expect(await observationResponse.json()).toEqual({ error: 'conflict', retryable: true })
  })

  it('returns bounded authorization errors without extra state', async () => {
    vi.mocked(closeSessionForUser).mockResolvedValue({
      ok: false, status: 409, error: 'repair_not_authorized',
    })
    vi.mocked(submitRepairObservationForUser).mockResolvedValue({
      ok: false, status: 409, error: 'repair_not_authorized',
    })

    const closeResponse = await closePost(request('close'), { params })
    const observationResponse = await observationPost(request('repair-observation'), { params })

    expect(await closeResponse.json()).toEqual({ error: 'repair_not_authorized' })
    expect(await observationResponse.json()).toEqual({ error: 'repair_not_authorized' })
  })

  it('rejects unauthenticated requests before the paywall or handler', async () => {
    vi.mocked(getServerSupabase).mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    } as never)

    expect((await closePost(request('close'), { params })).status).toBe(401)
    expect((await observationPost(request('repair-observation'), { params })).status).toBe(401)
    expect(paywallReject).not.toHaveBeenCalled()
    expect(closeSessionForUser).not.toHaveBeenCalled()
    expect(submitRepairObservationForUser).not.toHaveBeenCalled()
  })
})
