import { describe, it, expect, vi } from 'vitest'
import { parseTheory, type AnthropicLike } from '@/lib/knowledge/parse-theory'

function makeClient(responseText: string): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

describe('parseTheory', () => {
  it('returns parsed theory with section splits', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          title: '6.7L Powerstroke Charging System',
          sections: [
            { heading: 'Overview', body: 'The 6.7L uses a smart alternator.' },
            { heading: 'LIN bus control', body: 'BCM commands the field via LIN.' },
          ],
        },
        sourceSpans: {},
      }),
    )
    const result = await parseTheory(
      { rawText: 'SYSTEM DESCRIPTION\nThe 6.7L uses a smart alternator.\n\nLIN BUS\nBCM commands the field via LIN.' },
      client,
    )
    expect(result.status).toBe('parsed')
    expect(result.draft.sections).toHaveLength(2)
    expect(result.draft.sections[0]).toMatchObject({ heading: 'Overview' })
  })

  it('returns failed for empty paste without calling the LLM', async () => {
    const create = vi.fn()
    const client: AnthropicLike = { messages: { create } }
    const result = await parseTheory({ rawText: '   ' }, client)
    expect(result.status).toBe('failed')
    expect(create).not.toHaveBeenCalled()
  })

  it('passes title hint to the LLM when provided', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'parsed',
          draft: { sections: [{ heading: 'h', body: 'b' }] },
          sourceSpans: {},
        }),
      }],
    })
    const client: AnthropicLike = { messages: { create } }
    await parseTheory({ rawText: 'X', titleHint: 'Charging System' }, client)
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('Charging System')
  })

  it('returns single-section result when no headings are present', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          sections: [{ heading: 'Description', body: 'One paragraph of prose with no section headings.' }],
        },
        sourceSpans: {},
      }),
    )
    const result = await parseTheory(
      { rawText: 'One paragraph of prose with no section headings.' },
      client,
    )
    expect(result.draft.sections).toHaveLength(1)
    expect(result.draft.sections[0].heading).toBe('Description')
  })

  it('throws when parsed status returns empty sections', async () => {
    const client = makeClient(
      JSON.stringify({ status: 'parsed', draft: { sections: [] }, sourceSpans: {} }),
    )
    await expect(parseTheory({ rawText: 'x' }, client)).rejects.toThrow(/at least one section/i)
  })

  it('throws on malformed JSON', async () => {
    const client = makeClient('not json')
    await expect(parseTheory({ rawText: 'x' }, client)).rejects.toThrow()
  })

  it('strips fenced code blocks from the LLM response', async () => {
    const client = makeClient(
      '```\n' +
        JSON.stringify({
          status: 'parsed',
          draft: { sections: [{ heading: 'A', body: 'B' }] },
          sourceSpans: {},
        }) +
        '\n```',
    )
    const result = await parseTheory({ rawText: 'X' }, client)
    expect(result.draft.sections[0].heading).toBe('A')
  })
})
