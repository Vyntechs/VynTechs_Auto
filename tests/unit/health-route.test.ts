import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }))

vi.mock('@/lib/db/client', () => ({ db: { execute: executeMock } }))

describe('GET /api/health', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns fixed process liveness without database work or infrastructure details', async () => {
    const { GET } = await import('@/app/api/health/route')

    for (let request = 0; request < 10; request += 1) {
      const response = await GET()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual({ ok: true })
      expect(body).not.toHaveProperty('databaseUrlHost')
      expect(body).not.toHaveProperty('databaseUrlDirectHost')
      expect(body).not.toHaveProperty('supabaseUrl')
      expect(body).not.toHaveProperty('voyageKeyPresent')
      expect(body).not.toHaveProperty('anthropicKeyPresent')
      expect(body).not.toHaveProperty('pingError')
      expect(body).not.toHaveProperty('nodeEnv')
    }

    expect(executeMock).not.toHaveBeenCalled()
  })
})
