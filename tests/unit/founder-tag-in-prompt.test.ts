import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CorpusMatch } from '@/lib/corpus/retrieval'

const mockCreate = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  anthropic: { messages: { create: mockCreate } },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

const STUB_RESPONSE = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        nodes: [{ id: 'n1', label: 'step', status: 'active' }],
        currentNodeId: 'n1',
        message: 'm',
      }),
    },
  ],
  usage: { input_tokens: 10, output_tokens: 10 },
}

describe('corpus block tagging in tree-engine prompts', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue(STUB_RESPONSE)
  })

  it('tags founder entries as SHOP-OWNER VERIFIED in the updateTree user message', async () => {
    const founderMatch: CorpusMatch = {
      id: 'f1',
      rootCause: 'Cam phasers',
      summary: 'verified pattern',
      confidenceScore: 0.95,
      successConfirmCount: 0,
      comebackRecordedCount: 0,
      similarityScore: 0.7,
      entrySource: 'founder',
    }
    const autoMatch: CorpusMatch = { ...founderMatch, id: 'a1', entrySource: 'auto_promoted' }

    const { updateTree } = await import('@/lib/ai/tree-engine')
    await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'misfire',
      },
      currentTree: { nodes: [], currentNodeId: 'n0', message: '' },
      observation: 'codes pulled',
      corpus: [founderMatch, autoMatch],
    })
    const userMsg = mockCreate.mock.calls.at(-1)![0].messages[0].content as string
    // Founder match must carry the SHOP-OWNER VERIFIED tag; auto-promoted must not.
    expect(userMsg).toMatch(/\(1\)\s*\[SHOP-OWNER VERIFIED — highest trust\]/)
    expect(userMsg).not.toMatch(/\(2\)\s*\[SHOP-OWNER VERIFIED/)
  })

  it('does not tag any match when there are no founder entries', async () => {
    const autoMatch: CorpusMatch = {
      id: 'a1',
      rootCause: 'Coil',
      summary: 'x',
      confidenceScore: 0.6,
      successConfirmCount: 2,
      comebackRecordedCount: 0,
      similarityScore: 0.8,
      entrySource: 'auto_promoted',
    }
    const { updateTree } = await import('@/lib/ai/tree-engine')
    await updateTree({
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'misfire',
      },
      currentTree: { nodes: [], currentNodeId: 'n0', message: '' },
      observation: 'codes pulled',
      corpus: [autoMatch],
    })
    const userMsg = mockCreate.mock.calls.at(-1)![0].messages[0].content as string
    expect(userMsg).not.toMatch(/SHOP-OWNER VERIFIED/)
  })
})
