import { describe, it, expect, vi, afterEach } from 'vitest'
import { cachedSystem, MODEL } from '@/lib/ai/client'

describe('cachedSystem', () => {
  it('wraps the text in a single text block tagged with ephemeral cache_control', () => {
    const result = cachedSystem('hello system')
    expect(result).toEqual([
      { type: 'text', text: 'hello system', cache_control: { type: 'ephemeral' } },
    ])
  })
})

describe('MODEL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('falls back to claude-sonnet-4-6 when ANTHROPIC_MODEL is unset', () => {
    expect(MODEL).toBe('claude-sonnet-4-6')
  })

  it('honors ANTHROPIC_MODEL when set in env', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-haiku-4-5')
    vi.resetModules()
    const mod = await import('@/lib/ai/client')
    expect(mod.MODEL).toBe('claude-haiku-4-5')
  })
})
