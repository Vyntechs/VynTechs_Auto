import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('@/lib/ai/client', () => ({
  anthropic: { messages: { create: mockCreate } },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

import { extractScanScreen, extractWiringDiagram, parseJson } from '@/lib/ai/vision'

describe('extractScanScreen', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns structured DTC list from image bytes', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            screenType: 'dtc_list',
            dtcs: [
              { code: 'P0299', description: 'Turbo underboost', status: 'active' },
              { code: 'P0236', description: 'TC boost sensor circuit', status: 'pending' },
            ],
            rawText: 'P0299 ACTIVE Turbo underboost\nP0236 PENDING TC boost sensor',
          }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 800, output_tokens: 120 },
    })

    const result = await extractScanScreen({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]), // JPEG magic bytes; mock ignores content
      mimeType: 'image/jpeg',
    })

    expect(result.screenType).toBe('dtc_list')
    expect(result.dtcs).toHaveLength(2)
    expect(result.dtcs?.[0].code).toBe('P0299')
    expect(result.dtcs?.[1].status).toBe('pending')
    expect(result.rawText).toContain('P0299')
  })
})

describe('extractWiringDiagram', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns structured wire-color facts from image bytes and circuit hint', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            circuit: 'MAF signal',
            wireColors: [
              { signal: 'MAF signal', color: 'yellow/black', pin: '2', connector: 'C1' },
              { signal: 'MAF ground', color: 'brown', pin: '1', connector: 'C1' },
            ],
            groundPoints: [{ id: 'G102', location: 'left strut tower' }],
            buildDateApplicable: 'all',
          }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 900, output_tokens: 200 },
    })

    const result = await extractWiringDiagram({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes; mock ignores content
      mimeType: 'image/png',
      circuitHint: 'MAF sensor wiring',
    })

    expect(result.circuit).toBe('MAF signal')
    expect(result.wireColors).toHaveLength(2)
    expect(result.wireColors[0].color).toBe('yellow/black')
    expect(result.wireColors[0].pin).toBe('2')
    expect(result.groundPoints).toHaveLength(1)
    expect(result.groundPoints?.[0].id).toBe('G102')

    // Verify circuitHint was passed through to the API call
    const callArgs = mockCreate.mock.calls[0][0]
    const textBlock = callArgs.messages[0].content.find(
      (b: { type: string }) => b.type === 'text',
    )
    expect(textBlock?.text).toContain('MAF sensor wiring')
  })
})

describe('parseJson recovery', () => {
  it('extracts JSON from stray prose wrapping', () => {
    const input = 'Sure, here is the JSON: {"screenType":"unknown","rawText":""}'
    const result = parseJson<{ screenType: string; rawText: string }>(input)
    expect(result.screenType).toBe('unknown')
    expect(result.rawText).toBe('')
  })
})
