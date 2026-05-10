import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('@/lib/ai/client', () => ({
  anthropic: { messages: { create: mockCreate } },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

import { extractScanScreen, extractWiringDiagram, transcribeAudio, parseJson } from '@/lib/ai/vision'

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

describe('extractScanScreen — input validation', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('rejects unsupported mime type', async () => {
    await expect(
      extractScanScreen({
        bytes: new Uint8Array([0x00]),
        mimeType: 'image/heic',
      }),
    ).rejects.toThrow('unsupported image type for vision')
  })

  it('throws on missing rawText in response', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ screenType: 'unknown' }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 20 },
    })

    await expect(
      extractScanScreen({
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow('missing required field: rawText')
  })
})

describe('transcribeAudio', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns transcript + diagnostic summary from audio bytes', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            transcript: 'OK so listen to this idle...',
            diagnosticSummary: 'Distinct lifter tick at idle on driver side.',
            acousticTags: ['lifter_tick'],
            confidence: 0.78,
          }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1200, output_tokens: 80 },
    })

    const result = await transcribeAudio({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
    })

    expect(result.transcript).toBe('OK so listen to this idle...')
    expect(result.diagnosticSummary).toBe('Distinct lifter tick at idle on driver side.')
    expect(result.acousticTags).toContain('lifter_tick')
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('rejects unsupported audio mime type', async () => {
    await expect(
      transcribeAudio({
        bytes: new Uint8Array([0x00]),
        mimeType: 'audio/flac',
      }),
    ).rejects.toThrow('unsupported audio type for transcription: audio/flac')
  })

  it('throws when response is missing required field: confidence', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            transcript: 'Some engine noise',
            diagnosticSummary: 'Possible knock on acceleration.',
            acousticTags: ['knock'],
            // confidence intentionally omitted
          }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 400, output_tokens: 50 },
    })

    await expect(
      transcribeAudio({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/wav',
      }),
    ).rejects.toThrow('missing required field: confidence')
  })

  it('throws when response is truncated at max_tokens', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"transcript":"partial' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 400, output_tokens: 1600 },
    })
    await expect(
      transcribeAudio({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm' }),
    ).rejects.toThrow(/truncated at max_tokens/)
  })

  it('accepts codec-suffixed mime type (audio/webm;codecs=opus)', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            transcript: 'tap tap tap',
            diagnosticSummary: 'Mechanical tapping at idle.',
            acousticTags: ['tap'],
            confidence: 0.7,
          }),
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 400, output_tokens: 60 },
    })

    await expect(
      transcribeAudio({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm;codecs=opus' }),
    ).resolves.toMatchObject({ transcript: 'tap tap tap' })
  })
})

describe('extractGenericPhoto', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns structured + summary + confidence per the extractFor instruction', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            text: 'pin 1 KEY/RUN, pin 2 GROUND, pin 3 HSCAN-, pin 4 HSCAN+, pin 5 LIN',
            structured: {
              pins: [
                { number: 1, function: 'KEY/RUN' },
                { number: 4, function: 'HSCAN+' },
              ],
            },
            summary: 'C171 pinout — 5 pins identified, HSCAN+ on pin 4',
            confidence: 0.92,
          }),
        },
      ],
      stop_reason: 'end_turn',
    })

    const { extractGenericPhoto } = await import('@/lib/ai/vision')
    const result = await extractGenericPhoto({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      extractFor: 'full pinout for connector C171',
    })

    expect(result.summary).toMatch(/HSCAN\+/)
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.structured).toBeDefined()
  })

  it('returns confidence < 0.4 with re-snap suggestion when image is unreadable', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: 'pin column glared — re-snap with light angled away from the page',
            confidence: 0.2,
          }),
        },
      ],
      stop_reason: 'end_turn',
    })

    const { extractGenericPhoto } = await import('@/lib/ai/vision')
    const result = await extractGenericPhoto({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      extractFor: 'full pinout for connector C171',
    })

    expect(result.confidence).toBeLessThan(0.4)
    expect(result.summary).toMatch(/re-snap/i)
  })

  it('rejects unsupported mime type', async () => {
    const { extractGenericPhoto } = await import('@/lib/ai/vision')
    await expect(
      extractGenericPhoto({
        bytes: new Uint8Array([0]),
        mimeType: 'application/pdf',
        extractFor: 'anything',
      }),
    ).rejects.toThrow(/unsupported/)
  })
})
