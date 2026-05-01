import { describe, it, expect } from 'vitest'
import { getAuthRedirect } from '@/lib/auth-redirects'

describe('getAuthRedirect', () => {
  it('redirects anonymous users from /sessions to /sign-in', () => {
    expect(getAuthRedirect('/sessions', false)).toBe('/sign-in')
  })

  it('redirects anonymous users from /sessions subroutes to /sign-in', () => {
    expect(getAuthRedirect('/sessions/abc-123', false)).toBe('/sign-in')
  })

  it('redirects anonymous users from /billing to /sign-in', () => {
    expect(getAuthRedirect('/billing', false)).toBe('/sign-in')
  })

  it('redirects signed-in users away from /sign-in to /sessions', () => {
    expect(getAuthRedirect('/sign-in', true)).toBe('/sessions')
  })

  it('redirects signed-in users away from /sign-up to /sessions', () => {
    expect(getAuthRedirect('/sign-up', true)).toBe('/sessions')
  })
})
