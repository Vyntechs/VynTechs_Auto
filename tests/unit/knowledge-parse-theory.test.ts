import { describe, it, expect, vi } from 'vitest'
import { parseTheory, type AnthropicLike } from '@/lib/knowledge/parse-theory'

// PR-6 hotfix: parse-theory now uses Anthropic tool calling instead of
// asking the model to emit free-form JSON. The mock returns a tool_use
// content block whose `input` is the already-structured proposal.
function makeClient(input: unknown): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'submit_parsed_theory', input, id: 'tu_test' },
        ],
      }),
    },
  }
}

describe('parseTheory', () => {
  it('returns parsed theory with section splits', async () => {
    const client = makeClient({
      status: 'parsed',
      draft: {
        title: '6.7L Powerstroke Charging System',
        sections: [
          { heading: 'Overview', body: 'The 6.7L uses a smart alternator.' },
          { heading: 'LIN bus control', body: 'BCM commands the field via LIN.' },
        ],
      },
      sourceSpans: {},
    })
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
      content: [
        {
          type: 'tool_use',
          name: 'submit_parsed_theory',
          input: {
            status: 'parsed',
            draft: { sections: [{ heading: 'h', body: 'b' }] },
            sourceSpans: {},
          },
          id: 'tu_test',
        },
      ],
    })
    const client: AnthropicLike = { messages: { create } }
    await parseTheory({ rawText: 'X', titleHint: 'Charging System' }, client)
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('Charging System')
  })

  it('returns single-section result when no headings are present', async () => {
    const client = makeClient({
      status: 'parsed',
      draft: {
        sections: [{ heading: 'Description', body: 'One paragraph of prose with no section headings.' }],
      },
      sourceSpans: {},
    })
    const result = await parseTheory(
      { rawText: 'One paragraph of prose with no section headings.' },
      client,
    )
    expect(result.draft.sections).toHaveLength(1)
    expect(result.draft.sections[0].heading).toBe('Description')
  })

  it('throws when parsed status returns empty sections', async () => {
    const client = makeClient({ status: 'parsed', draft: { sections: [] }, sourceSpans: {} })
    await expect(parseTheory({ rawText: 'x' }, client)).rejects.toThrow(/at least one section/i)
  })

  it('throws when the model returns text instead of calling the tool', async () => {
    // tool_choice forces the tool call at the SDK layer, so this is a
    // defensive guard for SDK / model regressions.
    const client: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'I am free-form prose.' }],
        }),
      },
    }
    await expect(parseTheory({ rawText: 'x' }, client)).rejects.toThrow(/did not call/i)
  })

  it('throws on invalid status value in the tool input', async () => {
    const client = makeClient({
      status: 'maybe',
      draft: { sections: [{ heading: 'A', body: 'B' }] },
      sourceSpans: {},
    })
    await expect(parseTheory({ rawText: 'x' }, client)).rejects.toThrow(/invalid status/i)
  })
})
