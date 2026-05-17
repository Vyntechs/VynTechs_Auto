import { describe, it, expect, vi } from 'vitest'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import { KNOWLEDGE_TOOLS } from '@/lib/knowledge/tools'
import type { IntakePayload } from '@/lib/types'

// CRITICAL — empty fall-through is the highest-stakes guarantee in PR 4.
//
// If knowledge tool calls return zero items, the AI MUST continue normal
// diagnostic guidance with NO mention of "no verified data", "I don't have",
// or similar refusal language. Surfacing the absence would invert UX for
// every vehicle the shop hasn't fully covered yet — exactly the failure
// mode memory `feedback_no_unvetted_technical_data` warns against.
//
// This test mocks the Anthropic response, so it does NOT empirically prove
// the production prompt yields the right behavior on real Anthropic calls.
// What it proves: the infrastructure honors the spec. Empty results return
// clean, no item references, downstream consumers see empty consultedItems.
// The prompt's behavior is locked by the system-prompt clauses (lib/ai/prompts.ts)
// and validated manually on the Vercel preview before merge.
//
// The regex guardrail catches future drift: if anyone edits the test fixture
// in a way that surfaces refusal language, the test fails loudly.

const REFUSAL_PATTERNS = [
  /no\s+(verified|vetted|confirmed)\s+data/i,
  /i\s+don't\s+have\s+(verified|vetted|specific)/i,
  /unable\s+to\s+find\s+(verified|vetted|reliable)/i,
  /no\s+(matching|matches?)\s+in\s+(the|our)\s+(knowledge|vetted|shop)/i,
  /knowledge\s+base\s+(is\s+empty|has\s+no|returned\s+nothing)/i,
  /shop\s+has\s+not\s+curated/i,
]

const fakeIntake: IntakePayload = {
  vehicleYear: 2021,
  vehicleMake: 'Hyundai',
  vehicleModel: 'Sonata',
  vehicleEngine: '2.5L',
  customerComplaint: 'Check engine on',
  mileage: 45000,
} as unknown as IntakePayload

describe('empty fall-through (CRITICAL)', () => {
  it('AI message contains NO refusal language when tool returns empty', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_x',
            name: 'lookup_knowledge',
            input: {
              vehicle: { year: 2021, make: 'Hyundai', model: 'Sonata' },
              dtcs: ['P0420'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              nodes: [
                { id: 'scan-codes', label: 'Pull DTCs and freeze frame', status: 'active' },
              ],
              currentNodeId: 'scan-codes',
              // Spec-compliant fallthrough: AI continues normal diagnostic.
              // No mention of the empty knowledge base. THIS IS THE BEHAVIOR
              // WE LOCK.
              message:
                'Start by pulling codes and freeze frame. With the cat-efficiency code we will look at upstream/downstream O2 trends.',
            }),
          },
        ],
      })

    const dispatcher = vi.fn().mockResolvedValue({ items: [] })
    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      tools: KNOWLEDGE_TOOLS,
      dispatcher,
      client: { messages: { create } } as never,
    })

    for (const re of REFUSAL_PATTERNS) {
      expect(result.tree.message, `refusal pattern matched: ${re}`).not.toMatch(re)
    }
    expect(result.consultedItems).toEqual([])
  })

  it('multiple empty tool calls in a row still produce clean fall-through', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'lookup_knowledge',
            input: { vehicle: { year: 2021, make: 'Hyundai', model: 'Sonata' } },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'get_connector_pinout',
            input: {
              vehicle: { year: 2021, make: 'Hyundai', model: 'Sonata' },
              connector_ref: 'O2-Heater',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              nodes: [{ id: 'a', label: 'a', status: 'active' }],
              currentNodeId: 'a',
              message: 'Test the O2 heater circuit. Verify pin assignments from the OEM pinout.',
            }),
          },
        ],
      })
    const dispatcher = vi.fn().mockResolvedValue({ items: [] })
    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      tools: KNOWLEDGE_TOOLS,
      dispatcher,
      client: { messages: { create } } as never,
    })
    for (const re of REFUSAL_PATTERNS) {
      expect(result.tree.message).not.toMatch(re)
    }
    expect(dispatcher).toHaveBeenCalledTimes(2)
    expect(result.consultedItems).toEqual([])
  })
})
