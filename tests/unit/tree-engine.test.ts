import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('@/lib/ai/client', () => ({
  anthropic: { messages: { create: mockCreate } },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (text: string) => [
    { type: 'text', text, cache_control: { type: 'ephemeral' } },
  ],
}))

import { generateInitialTree, parseTreeJson, updateTree } from '@/lib/ai/tree-engine'

describe('generateInitialTree', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns a parsed tree from a valid JSON LLM response', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [
              {
                id: 'scan-codes',
                label: 'Pull DTCs and freeze frame',
                status: 'active',
              },
            ],
            currentNodeId: 'scan-codes',
            message: 'Start by pulling codes and the freeze frame for the active code.',
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    })

    const tree = await generateInitialTree({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleEngine: '3.5L EcoBoost',
      customerComplaint: 'loss of power going up hills',
    })

    expect(tree.nodes).toHaveLength(1)
    expect(tree.nodes[0].id).toBe('scan-codes')
    expect(tree.currentNodeId).toBe('scan-codes')
    expect(tree.message).toContain('codes')
  })
})

describe('parseTreeJson', () => {
  const validJson = JSON.stringify({
    nodes: [{ id: 'a', label: 'Step', status: 'active' }],
    currentNodeId: 'a',
    message: 'go',
  })

  it('strips ```json … ``` markdown fences before parsing', () => {
    const wrapped = '```json\n' + validJson + '\n```'
    const tree = parseTreeJson(wrapped)
    expect(tree.currentNodeId).toBe('a')
  })

  it('strips bare ``` … ``` fences before parsing', () => {
    const wrapped = '```\n' + validJson + '\n```'
    const tree = parseTreeJson(wrapped)
    expect(tree.currentNodeId).toBe('a')
  })

  it('throws when the parsed payload is missing nodes', () => {
    const bad = JSON.stringify({ currentNodeId: 'a', message: 'go' })
    expect(() => parseTreeJson(bad)).toThrow(/invalid tree response/)
  })

  it('throws when the parsed payload is missing currentNodeId', () => {
    const bad = JSON.stringify({ nodes: [], message: 'go' })
    expect(() => parseTreeJson(bad)).toThrow(/invalid tree response/)
  })

  it('throws when the parsed payload is missing message', () => {
    const bad = JSON.stringify({ nodes: [], currentNodeId: 'a' })
    expect(() => parseTreeJson(bad)).toThrow(/invalid tree response/)
  })
})

describe('updateTree', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns the updated tree based on the tech observation', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            nodes: [
              { id: 'scan-codes', label: 'Pull DTCs', status: 'resolved' },
              { id: 'inspect-cac', label: 'Inspect CAC pipe', status: 'active' },
            ],
            currentNodeId: 'inspect-cac',
            message: 'Codes confirmed. Now inspect the cold-side intercooler pipe.',
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    })

    const result = await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      currentTree: {
        nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
        currentNodeId: 'scan-codes',
        message: 'Pull codes',
      },
      observation: 'Got P0299 with 3.6 psi underboost in the freeze frame',
    })

    expect(result.currentNodeId).toBe('inspect-cac')
    expect(result.nodes.find((n) => n.id === 'scan-codes')?.status).toBe('resolved')
  })
})
