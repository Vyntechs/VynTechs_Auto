import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))

describe('GET /api/health', () => {
  let close: () => Promise<void>

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
  })

  afterEach(async () => {
    await close()
  })

  it('returns ok: true on a healthy DB and does NOT leak infra details', async () => {
    // Prior versions of this endpoint echoed databaseUrlHost, supabaseUrl,
    // and key-presence flags. That's reconnaissance for an unauthenticated
    // attacker; this test guards the stripped shape.
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(body).not.toHaveProperty('databaseUrlHost')
    expect(body).not.toHaveProperty('databaseUrlDirectHost')
    expect(body).not.toHaveProperty('supabaseUrl')
    expect(body).not.toHaveProperty('voyageKeyPresent')
    expect(body).not.toHaveProperty('anthropicKeyPresent')
    expect(body).not.toHaveProperty('pingError')
    expect(body).not.toHaveProperty('nodeEnv')
  })
})
