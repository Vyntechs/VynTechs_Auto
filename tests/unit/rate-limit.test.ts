import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { checkRateLimit, rateLimitReject } from '@/lib/rate-limit'

describe('checkRateLimit', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
    vi.useRealTimers()
  })

  it('allows the first request and decrements remaining', async () => {
    const result = await checkRateLimit(db, 'intake:user-a', 5)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks once the per-window cap is reached', async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(db, 'intake:user-a', 3)
    }
    const fourth = await checkRateLimit(db, 'intake:user-a', 3)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
  })

  it('keeps separate counters per key', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(db, 'intake:user-a', 5)
    }
    const otherUser = await checkRateLimit(db, 'intake:user-b', 5)
    expect(otherUser.allowed).toBe(true)
    expect(otherUser.remaining).toBe(4)
  })

  it('rolls over to a fresh window when the next minute starts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'))
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(db, 'intake:user-a', 3)
    }
    const blocked = await checkRateLimit(db, 'intake:user-a', 3)
    expect(blocked.allowed).toBe(false)

    // Cross the minute boundary; the bucket must reset.
    vi.setSystemTime(new Date('2026-01-01T00:01:05Z'))
    const fresh = await checkRateLimit(db, 'intake:user-a', 3)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(2)
  })
})

describe('rateLimitReject', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns null when the request is under the cap', async () => {
    const res = await rateLimitReject(db, 'intake:user-a', 5)
    expect(res).toBeNull()
  })

  it('returns a 429 with Retry-After once the cap is hit', async () => {
    for (let i = 0; i < 3; i++) {
      await rateLimitReject(db, 'intake:user-a', 3)
    }
    const blocked = await rateLimitReject(db, 'intake:user-a', 3)
    expect(blocked).not.toBeNull()
    expect(blocked?.status).toBe(429)
    const retryAfter = blocked?.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThan(0)
    const body = await blocked?.json()
    expect(body).toMatchObject({ error: 'rate_limited' })
    expect(typeof body.resetAt).toBe('string')
  })
})
