import { describe, it, expect, vi } from 'vitest'
import { parsePinout, type AnthropicLike } from '@/lib/knowledge/parse-pinout'

// PR-6 hotfix: parse-pinout now uses Anthropic tool calling instead of
// asking the model to emit free-form JSON. The mock returns a tool_use
// content block whose `input` is the already-structured proposal.
function makeClient(input: unknown): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'submit_parsed_pinout', input, id: 'tu_test' },
        ],
      }),
    },
  }
}

describe('parsePinout', () => {
  it('returns parsed pinout with multiple pin rows', async () => {
    const client = makeClient({
      status: 'parsed',
      draft: {
        connector_ref: 'Alternator 4-pin',
        pins: [
          { pin_number: '1', signal_name: '12V SUPPLY', wire_color: 'RED' },
          { pin_number: '3', signal_name: 'LIN BUS', wire_color: 'GRN/WHT', expected_voltage_or_waveform: 'Steady 5V' },
        ],
      },
      sourceSpans: { 'pins[0]': '1  RED  12V SUPPLY' },
    })
    const result = await parsePinout(
      { rawText: '1  RED  12V SUPPLY\n3  GRN/WHT  LIN BUS  Steady 5V' },
      client,
    )
    expect(result.status).toBe('parsed')
    expect(result.draft.pins).toHaveLength(2)
    expect(result.draft.pins[0]).toMatchObject({ pin_number: '1', wire_color: 'RED' })
    expect(result.draft.connector_ref).toBe('Alternator 4-pin')
  })

  it('returns failed for empty paste without calling the LLM', async () => {
    const create = vi.fn()
    const client: AnthropicLike = { messages: { create } }
    const result = await parsePinout({ rawText: '   ' }, client)
    expect(result.status).toBe('failed')
    expect(create).not.toHaveBeenCalled()
  })

  it('passes connector hint to the LLM when provided', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_parsed_pinout',
          input: {
            status: 'parsed',
            draft: { pins: [{ pin_number: '1', signal_name: 'A' }] },
            sourceSpans: {},
          },
          id: 'tu_test',
        },
      ],
    })
    const client: AnthropicLike = { messages: { create } }
    await parsePinout(
      { rawText: '1  RED  A', connectorHint: 'BCM C2280' },
      client,
    )
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('BCM C2280')
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
    await expect(parsePinout({ rawText: '1 X' }, client)).rejects.toThrow(/did not call/i)
  })

  it('throws on invalid status value in the tool input', async () => {
    const client = makeClient({
      status: 'maybe',
      draft: { pins: [{ pin_number: '1', signal_name: 'A' }] },
      sourceSpans: {},
    })
    await expect(parsePinout({ rawText: 'x' }, client)).rejects.toThrow(/invalid status/i)
  })

  it('throws when the LLM returns no pins on a parsed status', async () => {
    const client = makeClient({ status: 'parsed', draft: { pins: [] }, sourceSpans: {} })
    await expect(parsePinout({ rawText: 'x' }, client)).rejects.toThrow(/at least one pin/i)
  })

  it('preserves slash-separated tracer colors (GRN/WHT) without splitting', async () => {
    const client = makeClient({
      status: 'parsed',
      draft: {
        pins: [{ pin_number: '3', signal_name: 'LIN', wire_color: 'GRN/WHT' }],
      },
      sourceSpans: {},
    })
    const result = await parsePinout({ rawText: '3 GRN/WHT LIN' }, client)
    expect(result.draft.pins[0].wire_color).toBe('GRN/WHT')
  })
})
