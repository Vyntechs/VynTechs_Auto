import { describe, it, expect } from 'vitest'
import { authorizeCronRequest } from '@/lib/cron-auth'

const SECRET = 'a'.repeat(64)

describe('authorizeCronRequest', () => {
  it('denies with 500 in production when secret is not configured', () => {
    const result = authorizeCronRequest({
      authorizationHeader: 'Bearer anything',
      secret: undefined,
      nodeEnv: 'production',
    })
    expect(result).toEqual({
      kind: 'deny',
      status: 500,
      error: 'cron_secret_not_configured',
    })
  })

  it('allows in development when secret is not configured', () => {
    const result = authorizeCronRequest({
      authorizationHeader: null,
      secret: undefined,
      nodeEnv: 'development',
    })
    expect(result).toEqual({ kind: 'allow' })
  })

  it('allows in test when secret is not configured', () => {
    const result = authorizeCronRequest({
      authorizationHeader: null,
      secret: undefined,
      nodeEnv: 'test',
    })
    expect(result).toEqual({ kind: 'allow' })
  })

  it('denies with 403 when secret is set and header is missing', () => {
    const result = authorizeCronRequest({
      authorizationHeader: null,
      secret: SECRET,
      nodeEnv: 'production',
    })
    expect(result).toEqual({ kind: 'deny', status: 403, error: 'forbidden' })
  })

  it('denies with 403 when secret is set and header has wrong length', () => {
    const result = authorizeCronRequest({
      authorizationHeader: 'Bearer short',
      secret: SECRET,
      nodeEnv: 'production',
    })
    expect(result).toEqual({ kind: 'deny', status: 403, error: 'forbidden' })
  })

  it('denies with 403 when secret is set and header has same length but wrong bytes', () => {
    const wrong = 'b'.repeat(64)
    const result = authorizeCronRequest({
      authorizationHeader: `Bearer ${wrong}`,
      secret: SECRET,
      nodeEnv: 'production',
    })
    expect(result).toEqual({ kind: 'deny', status: 403, error: 'forbidden' })
  })

  it('allows when secret is set and header matches exactly', () => {
    const result = authorizeCronRequest({
      authorizationHeader: `Bearer ${SECRET}`,
      secret: SECRET,
      nodeEnv: 'production',
    })
    expect(result).toEqual({ kind: 'allow' })
  })

  it('denies when header has correct secret but missing Bearer prefix', () => {
    const result = authorizeCronRequest({
      authorizationHeader: SECRET,
      secret: SECRET,
      nodeEnv: 'production',
    })
    expect(result).toEqual({ kind: 'deny', status: 403, error: 'forbidden' })
  })
})
