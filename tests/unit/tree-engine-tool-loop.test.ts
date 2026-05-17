import { describe, it, expect, vi } from 'vitest'
import { generateInitialTree, updateTree } from '@/lib/ai/tree-engine'
import type { IntakePayload } from '@/lib/types'

const fakeIntake: IntakePayload = {
  vehicleYear: 2019,
  vehicleMake: 'Ford',
  vehicleModel: 'F-250',
  vehicleEngine: '6.7L Powerstroke',
  customerComplaint: 'Battery light on, dim headlights',
  mileage: 90000,
} as unknown as IntakePayload

const fakeTool = {
  name: 'lookup_knowledge',
  description: 'x',
  input_schema: { type: 'object' as const, properties: {}, required: [] },
}

const f250Item = {
  id: 'abc-123',
  shopId: 's1',
  type: 'cause_fix' as const,
  title: 'P0620 LIN',
  body: null,
  structuredData: null,
  dtcList: ['P0620'],
  systemCodes: ['charging'],
  symptoms: [],
  fireCount: 0,
  score: 100,
}

describe('tree-engine tool-use loop — generateInitialTree', () => {
  it('handles tool_use → tool_result → final text', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'lookup_knowledge',
            input: { vehicle: { year: 2019, make: 'Ford', model: 'F-250' }, dtcs: ['P0620'] },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
              currentNodeId: 'scan-codes',
              message: 'Found it in vetted knowledge [ref:abc-123]. Start with a pin test.',
            }),
          },
        ],
      })

    const dispatcher = vi.fn().mockResolvedValue({ items: [f250Item] })

    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      tools: [fakeTool],
      dispatcher,
      client: { messages: { create } } as never,
    })

    expect(create).toHaveBeenCalledTimes(2)
    expect(dispatcher).toHaveBeenCalledTimes(1)
    expect(result.tree.message).toContain('[ref:abc-123]')
    expect(result.consultedItems.map((i) => i.id)).toContain('abc-123')
  })

  it('handles pure-text response (no tool calls) — backwards compatible', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'a', label: 'a', status: 'active' }],
            currentNodeId: 'a',
            message: 'Hello.',
          }),
        },
      ],
    })
    const dispatcher = vi.fn()
    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      client: { messages: { create } } as never,
    })
    expect(dispatcher).not.toHaveBeenCalled()
    expect(result.tree.message).toBe('Hello.')
    expect(result.consultedItems).toEqual([])
  })

  it('caps tool rounds at MAX_TOOL_ROUNDS', async () => {
    const toolUseResp = {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tu_x', name: 'lookup_knowledge', input: {} },
      ],
    }
    const create = vi.fn().mockResolvedValue(toolUseResp)
    const dispatcher = vi.fn().mockResolvedValue({ items: [] })
    await expect(
      generateInitialTree(fakeIntake, undefined, undefined, {
        tools: [fakeTool],
        dispatcher,
        client: { messages: { create } } as never,
      }),
    ).rejects.toThrow(/tool-use round cap/)
  })

  it('continues normally on dispatcher error — sends error tool_result + no throw', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_err', name: 'lookup_knowledge', input: {} }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              nodes: [{ id: 'a', label: 'a', status: 'active' }],
              currentNodeId: 'a',
              message: 'OK — continuing.',
            }),
          },
        ],
      })
    const dispatcher = vi.fn().mockRejectedValue(new Error('db down'))
    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      tools: [fakeTool],
      dispatcher,
      client: { messages: { create } } as never,
    })
    expect(result.tree.message).toBe('OK — continuing.')
    expect(result.consultedItems).toEqual([])
  })
})

describe('tree-engine tool-use loop — updateTree', () => {
  const currentTree = {
    nodes: [{ id: 'a', label: 'a', status: 'active' as const }],
    currentNodeId: 'a',
    message: 'prior message',
  }

  it('returns TreeEngineResult shape', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [{ id: 'b', label: 'b', status: 'active' }],
            currentNodeId: 'b',
            message: 'updated.',
          }),
        },
      ],
    })
    const result = await updateTree({
      intake: fakeIntake,
      currentTree,
      observation: 'tech said x',
      client: { messages: { create } } as never,
    })
    expect(result.tree.message).toBe('updated.')
    expect(result.consultedItems).toEqual([])
  })

  it('threads consulted items across rounds', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'lookup_knowledge', input: {} }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              nodes: [{ id: 'b', label: 'b', status: 'active' }],
              currentNodeId: 'b',
              message: 'cited [ref:abc-123]',
            }),
          },
        ],
      })
    const dispatcher = vi.fn().mockResolvedValue({ items: [f250Item] })
    const result = await updateTree({
      intake: fakeIntake,
      currentTree,
      observation: 'x',
      tools: [fakeTool],
      dispatcher,
      client: { messages: { create } } as never,
    })
    expect(result.consultedItems.map((i) => i.id)).toContain('abc-123')
  })
})
