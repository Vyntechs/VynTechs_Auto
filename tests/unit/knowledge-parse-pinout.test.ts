import { describe, it, expect, vi } from 'vitest'
import { parsePinout, type AnthropicLike } from '@/lib/knowledge/parse-pinout'

function makeClient(responseText: string): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

describe('parsePinout', () => {
  it('returns parsed pinout with multiple pin rows', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          connector_ref: 'Alternator 4-pin',
          pins: [
            { pin_number: '1', signal_name: '12V SUPPLY', wire_color: 'RED' },
            { pin_number: '3', signal_name: 'LIN BUS', wire_color: 'GRN/WHT', expected_voltage_or_waveform: 'Steady 5V' },
          ],
        },
        sourceSpans: { 'pins[0]': '1  RED  12V SUPPLY' },
      }),
    )
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
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'parsed',
          draft: { pins: [{ pin_number: '1', signal_name: 'A' }] },
          sourceSpans: {},
        }),
      }],
    })
    const client: AnthropicLike = { messages: { create } }
    await parsePinout(
      { rawText: '1  RED  A', connectorHint: 'BCM C2280' },
      client,
    )
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('BCM C2280')
  })

  it('strips fenced code blocks from the LLM response', async () => {
    const client = makeClient(
      '```json\n' +
        JSON.stringify({
          status: 'parsed',
          draft: { pins: [{ pin_number: '1', signal_name: 'X' }] },
          sourceSpans: {},
        }) +
        '\n```',
    )
    const result = await parsePinout({ rawText: '1 X' }, client)
    expect(result.status).toBe('parsed')
    expect(result.draft.pins[0].pin_number).toBe('1')
  })

  it('throws on malformed JSON', async () => {
    const client = makeClient('not json at all')
    await expect(parsePinout({ rawText: 'something' }, client)).rejects.toThrow()
  })

  it('throws when the LLM returns no pins on a parsed status', async () => {
    const client = makeClient(
      JSON.stringify({ status: 'parsed', draft: { pins: [] }, sourceSpans: {} }),
    )
    await expect(parsePinout({ rawText: 'x' }, client)).rejects.toThrow(/at least one pin/i)
  })

  it('preserves slash-separated tracer colors (GRN/WHT) without splitting', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          pins: [{ pin_number: '3', signal_name: 'LIN', wire_color: 'GRN/WHT' }],
        },
        sourceSpans: {},
      }),
    )
    const result = await parsePinout({ rawText: '3 GRN/WHT LIN' }, client)
    expect(result.draft.pins[0].wire_color).toBe('GRN/WHT')
  })
})
