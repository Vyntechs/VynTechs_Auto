import { describe, it, expect, vi } from 'vitest'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import { extractCitedItems } from '@/lib/knowledge/citations'
import { KNOWLEDGE_TOOLS } from '@/lib/knowledge/tools'
import type { IntakePayload } from '@/lib/types'

const f250Item = {
  id: '11111111-2222-3333-4444-555555555555',
  shopId: 's1',
  type: 'cause_fix' as const,
  title: 'P0620 LIN bus pull-up failure on 6.7L',
  body: null,
  structuredData: null,
  dtcList: ['P0620'],
  systemCodes: ['charging'],
  symptoms: [],
  fireCount: 3,
  score: 100,
}

const intake: IntakePayload = {
  vehicleYear: 2019,
  vehicleMake: 'Ford',
  vehicleModel: 'F-250',
  vehicleEngine: '6.7L Powerstroke',
  customerComplaint: 'Battery light, dim headlights',
  mileage: 90000,
} as unknown as IntakePayload

describe('AI cites vetted tool results', () => {
  it('cited [ref:item_id] from message → hydrated citedItems via extractCitedItems', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'lookup_knowledge',
            input: {
              vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
              dtcs: ['P0620'],
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
                { id: 'verify-pull-up', label: 'Verify LIN bus pull-up', status: 'active' },
              ],
              currentNodeId: 'verify-pull-up',
              message:
                'Shop has a vetted case for this exact code [ref:11111111-2222-3333-4444-555555555555]. Start with pin-3 voltage check.',
            }),
          },
        ],
      })
    const dispatcher = vi.fn().mockResolvedValue({ items: [f250Item] })
    const result = await generateInitialTree(intake, undefined, undefined, {
      tools: KNOWLEDGE_TOOLS,
      dispatcher,
      client: { messages: { create } } as never,
    })

    expect(result.consultedItems.map((i) => i.id)).toContain(f250Item.id)
    const cited = extractCitedItems(result.tree.message, result.consultedItems)
    expect(cited.map((c) => c.id)).toEqual([f250Item.id])
    expect(cited[0].title).toBe(f250Item.title)
  })

  it('mixed tool calls — first cited, second consulted only', async () => {
    const pinoutItem = {
      ...f250Item,
      id: 'pinout-id-99',
      type: 'pinout' as const,
      title: 'Alt 4-pin connector',
    }
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_a',
            name: 'lookup_knowledge',
            input: {
              vehicle: { year: 2019, make: 'Ford', model: 'F-250' },
              dtcs: ['P0620'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_b',
            name: 'get_connector_pinout',
            input: {
              vehicle: { year: 2019, make: 'Ford', model: 'F-250' },
              connector_ref: 'Alternator 4-pin',
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
              nodes: [{ id: 'verify', label: 'verify', status: 'active' }],
              currentNodeId: 'verify',
              // AI cites the first result (cause_fix) inline, consults the
              // pinout but doesn't cite it (uses the data implicitly). The
              // pinout should still appear in consultedItems even though it
              // isn't in citedItems.
              message: 'See [ref:11111111-2222-3333-4444-555555555555] for the pattern.',
            }),
          },
        ],
      })
    const dispatcher = vi
      .fn()
      .mockResolvedValueOnce({ items: [f250Item] })
      .mockResolvedValueOnce({ items: [pinoutItem] })

    const result = await generateInitialTree(intake, undefined, undefined, {
      tools: KNOWLEDGE_TOOLS,
      dispatcher,
      client: { messages: { create } } as never,
    })

    expect(result.consultedItems.map((i) => i.id)).toEqual([f250Item.id, pinoutItem.id])
    const cited = extractCitedItems(result.tree.message, result.consultedItems)
    expect(cited.map((c) => c.id)).toEqual([f250Item.id])
  })
})
