import { describe, it, expect, vi } from 'vitest'
import {
  structureFounderNote,
  REQUIRED_FIELDS,
  type AnthropicLike,
} from '@/lib/founder/structure-note'

function makeClient(responseText: string): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

describe('structureFounderNote', () => {
  it('returns parsed when LLM fills every required field', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          vehicleYear: 2016,
          vehicleMake: 'Ford',
          vehicleModel: 'F-150',
          vehicleEngine: '5.0L V8',
          symptomTags: ['misfire'],
          dtcs: ['P0316'],
          rootCause: 'Cam phasers worn out',
          summary: '2014-2018 5.0L F-150 cold-start misfire — cam phasers verified by replacement.',
          actionType: 'part_replacement',
        },
        missingFields: [],
      }),
    )
    const result = await structureFounderNote(
      '2014-2018 F-150 5.0L, P0316 cold-start misfire — 9/10 cam phasers',
      client,
    )
    expect(result.status).toBe('parsed')
    expect(result.draft.vehicleMake).toBe('Ford')
    expect(result.missingFields).toEqual([])
  })

  it('returns partial with missing fields surfaced', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'partial',
        draft: { vehicleMake: 'Toyota', vehicleModel: 'Camry', rootCause: 'Bad MAF' },
        missingFields: ['vehicleYear', 'vehicleEngine', 'summary', 'actionType'],
        llmNotes: 'Year and engine displacement were not mentioned.',
      }),
    )
    const result = await structureFounderNote('Camry — replaced MAF, runs better', client)
    expect(result.status).toBe('partial')
    expect(result.missingFields).toContain('vehicleYear')
    expect(result.llmNotes).toMatch(/year/i)
  })

  it('short-circuits empty input to failed without calling the LLM', async () => {
    const create = vi.fn()
    const client: AnthropicLike = { messages: { create } }
    const result = await structureFounderNote('   ', client)
    expect(result.status).toBe('failed')
    expect(create).not.toHaveBeenCalled()
    expect(result.missingFields).toEqual([...REQUIRED_FIELDS])
  })

  it('strips fenced code blocks from the LLM response', async () => {
    const client = makeClient(
      '```json\n' +
        JSON.stringify({ status: 'failed', draft: {}, missingFields: [...REQUIRED_FIELDS] }) +
        '\n```',
    )
    const result = await structureFounderNote('totally unrelated note', client)
    expect(result.status).toBe('failed')
  })

  it('throws on unrecognized status string so the route can persist as failed', async () => {
    const client = makeClient(JSON.stringify({ status: 'maybe', draft: {}, missingFields: [] }))
    await expect(structureFounderNote('something', client)).rejects.toThrow(/invalid status/)
  })
})
