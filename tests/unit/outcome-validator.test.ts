import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: createMock,
    },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

beforeEach(() => {
  createMock.mockReset()
})

describe('validateSpecificity', () => {
  it('rejects vague text with feedback', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            feedback: 'Add the bolt location to Root cause.',
          }),
        },
      ],
      usage: { input_tokens: 50, output_tokens: 30 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity({ rootCause: 'the wire was bad' })
    expect(r.ok).toBe(false)
    expect(r.feedback).toMatch(/add/i)
  })

  it('accepts specific text', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      usage: { input_tokens: 50, output_tokens: 10 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity({
      rootCause:
        'Wastegate actuator vacuum line cracked ~2in from the actuator-can end on driver-side turbo, F-150 3.5L EcoBoost. Smoke test confirmed leak.',
    })
    expect(r.ok).toBe(true)
  })

  it('includes the notes field in the user message when provided', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      usage: { input_tokens: 50, output_tokens: 10 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    await validateSpecificity({
      rootCause: 'Ground fault on engine block',
      notes: 'Driver side, lower corner near the oil pan',
    })
    const call = createMock.mock.calls[0][0]
    const userMessage = call.messages[0].content as string
    expect(userMessage).toContain('Ground fault on engine block')
    expect(userMessage).toContain('Driver side, lower corner near the oil pan')
    expect(userMessage.toLowerCase()).toContain('notes')
  })

  it('marks notes as (none) when not provided', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      usage: { input_tokens: 50, output_tokens: 10 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    await validateSpecificity({ rootCause: 'Ground fault on engine block' })
    const call = createMock.mock.calls[0][0]
    const userMessage = call.messages[0].content as string
    expect(userMessage).toContain('(none)')
  })
})
