import { describe, it, expect, vi } from 'vitest'
import {
  classifyPaste,
  type AnthropicLike,
} from '@/lib/knowledge/classify-paste'

// PR-6 hotfix: classify-paste now uses Anthropic tool calling instead of
// asking the model to emit free-form JSON. The mock returns a tool_use
// content block whose `input` is the already-structured proposal.
function makeClient(input: unknown): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          { type: 'tool_use', name: 'submit_classified_paste', input, id: 'tu_test' },
        ],
      }),
    },
  }
}

describe('classifyPaste', () => {
  it('returns parsed cause_fix proposal with structured fields', async () => {
    const client = makeClient({
      status: 'parsed',
      draft: {
        type: 'cause_fix',
        title: '6.7L Powerstroke hard-shift — TCM C171 corrosion',
        structuredData: {
          complaint: 'Hard shift into 4th and 5th',
          cause: 'TCM C171 connector corrosion',
          correction: 'Replace TCM C171 connector',
          first_check: 'Inspect TCM C171 for green corrosion on pin 12',
          dtcs_common: ['P0700', 'P0775'],
        },
        dtcList: ['P0700', 'P0775'],
        systemCodes: ['transmission'],
        symptoms: ['hard_shift'],
        vehicleScopes: [
          { yearStart: 2011, yearEnd: 2016, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
        ],
      },
      sourceSpans: {
        cause: 'TCM C171 connector corrosion',
        dtcList: 'P0700, P0775',
      },
    })
    const result = await classifyPaste(
      { rawText: '2011-2016 6.7 Powerstroke hard shift, TCM C171 corrosion, P0700, P0775' },
      client,
    )
    expect(result.status).toBe('parsed')
    expect(result.draft.type).toBe('cause_fix')
    expect(result.draft.dtcList).toEqual(['P0700', 'P0775'])
    expect(result.draft.vehicleScopes?.[0].make).toBe('Ford')
  })

  it('returns parsed bulletin proposal', async () => {
    const client = makeClient({
      status: 'parsed',
      draft: {
        type: 'bulletin',
        title: 'TSB 21-2299 — 6.7L Powerstroke alternator pulley',
        structuredData: {
          source: 'Ford',
          bulletin_id: 'TSB 21-2299',
          summary: 'Alternator pulley failure on 2017-2019 6.7L Powerstroke',
          body: 'Inspect alternator pulley for play.',
          link: 'https://example.com/tsb',
        },
        dtcList: [],
        systemCodes: ['charging'],
        symptoms: [],
        vehicleScopes: [
          { yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
        ],
      },
      sourceSpans: {},
    })
    const result = await classifyPaste({ rawText: 'TSB 21-2299 alternator pulley...' }, client)
    expect(result.draft.type).toBe('bulletin')
    expect(result.draft.structuredData).toMatchObject({ source: 'Ford', bulletin_id: 'TSB 21-2299' })
  })

  it('short-circuits empty input to failed without calling the LLM', async () => {
    const create = vi.fn()
    const client: AnthropicLike = { messages: { create } }
    const result = await classifyPaste({ rawText: '   ' }, client)
    expect(result.status).toBe('failed')
    expect(create).not.toHaveBeenCalled()
  })

  it('passes scopeHint into the LLM prompt when provided', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'submit_classified_paste',
          input: {
            status: 'parsed',
            draft: { type: 'note', title: 'x', body: 'x' },
            sourceSpans: {},
          },
          id: 'tu_test',
        },
      ],
    })
    const client: AnthropicLike = { messages: { create } }
    await classifyPaste(
      { rawText: 'check the ground strap', scopeHint: '2018 F-250 6.7L Powerstroke' },
      client,
    )
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('2018 F-250 6.7L Powerstroke')
    expect(call.messages[0].content).toContain('check the ground strap')
  })

  it('rejects a proposed type that is not in the simple-types enum', async () => {
    // The 4 simple types are cause_fix, reference_doc, bulletin, note. Rich
    // types (pinout/connector/wiring/theory) go through Path B in PR 3 and
    // must not be proposed here. (input_schema enum already constrains the
    // model, but we double-check at the boundary.)
    const client = makeClient({
      status: 'parsed',
      draft: { type: 'pinout', title: 'C2280', body: '...' },
      sourceSpans: {},
    })
    await expect(
      classifyPaste({ rawText: 'C2280 pinout for alternator' }, client),
    ).rejects.toThrow(/simple type/i)
  })

  it('throws when the model does not call the tool', async () => {
    // tool_choice forces the tool call at the Anthropic SDK layer, so this
    // is a defensive guard for SDK / model regressions. Falling back to a
    // text-only response should fail fast, not silently return an empty
    // proposal.
    const client: AnthropicLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'I am free-form prose.' }],
        }),
      },
    }
    await expect(classifyPaste({ rawText: 'hello' }, client)).rejects.toThrow(
      /did not call/i,
    )
  })

  it('throws on invalid status value in the tool input', async () => {
    const client = makeClient({
      status: 'maybe',
      draft: { type: 'note', title: 'x', body: 'x' },
      sourceSpans: {},
    })
    await expect(classifyPaste({ rawText: 'hello' }, client)).rejects.toThrow(
      /invalid status/i,
    )
  })
})
