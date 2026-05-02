import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: vi
        .fn()
        .mockResolvedValueOnce({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                feedback:
                  'Where exactly was the crack? Give a landmark another tech could find in 60 seconds.',
              }),
            },
          ],
          usage: { input_tokens: 50, output_tokens: 30 },
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
          usage: { input_tokens: 50, output_tokens: 10 },
        }),
    },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

describe('validateSpecificity', () => {
  it('rejects vague text with feedback', async () => {
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity('the wire was bad')
    expect(r.ok).toBe(false)
    expect(r.feedback).toMatch(/where/i)
  })

  it('accepts specific text', async () => {
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity(
      'Wastegate actuator vacuum line cracked ~2in from the actuator-can end on driver-side turbo, F-150 3.5L EcoBoost. Smoke test confirmed leak.',
    )
    expect(r.ok).toBe(true)
  })
})
