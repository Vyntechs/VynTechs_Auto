import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exchangeCodeForSession, verifyOtp } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({
    auth: { exchangeCodeForSession, verifyOtp },
  })),
}))

import { GET as callback } from '@/app/auth/callback/route'
import { GET as confirm } from '@/app/auth/confirm/route'

function callbackRequest(next: string): Request {
  const url = new URL('https://vyntechs.dev/auth/callback')
  url.searchParams.set('code', 'synthetic-code')
  url.searchParams.set('next', next)
  return new Request(url)
}

function confirmRequest(next: string): Request {
  const url = new URL('https://vyntechs.dev/auth/confirm')
  url.searchParams.set('token_hash', 'synthetic-token')
  url.searchParams.set('type', 'recovery')
  url.searchParams.set('next', next)
  return new Request(url)
}

describe('authentication return-route security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exchangeCodeForSession.mockResolvedValue({ error: null })
    verifyOtp.mockResolvedValue({ error: null })
  })

  it.each([
    ['OAuth callback', callbackRequest, callback],
    ['OTP confirmation', confirmRequest, confirm],
  ] as const)('%s rejects the decoded backslash authority escape', async (_label, request, handler) => {
    const response = await handler(request('/\\evil.example') as never)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://vyntechs.dev/today')
  })

  it.each([
    ['OAuth callback', callbackRequest, callback],
    ['OTP confirmation', confirmRequest, confirm],
  ] as const)('%s preserves a benign application path', async (_label, request, handler) => {
    const response = await handler(request('/tickets/synthetic?from=today') as never)
    expect(response.headers.get('location')).toBe(
      'https://vyntechs.dev/tickets/synthetic?from=today',
    )
  })
})
