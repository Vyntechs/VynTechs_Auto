import { describe, it, expect, vi } from 'vitest'

// Mock the SHARED client module (lib/ai/client) — the synthesis runner imports `anthropic` from there.
vi.mock('@/lib/ai/client', () => {
  const create = vi
    .fn()
    // Pass 1: structure
    .mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            startStepId: 'step-1',
            steps: {
              'step-1': {
                kind: 'question',
                n: 1,
                of: 1,
                title: 'Pull codes',
                question: 'Any codes?',
                answers: [
                  {
                    id: 'a1',
                    label: 'No',
                    finding: { verdict: 'Move on', action: 'Test ICP', severity: 'fixable' },
                  },
                ],
              },
            },
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 200 },
    })
    // Pass 2: citations
    .mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            startStepId: 'step-1',
            steps: {
              'step-1': {
                kind: 'question',
                n: 1,
                of: 1,
                title: 'Pull codes',
                question: 'Any codes?',
                citations: [
                  {
                    sourceUrl: 'https://dieselhub.com/test',
                    title: 'Diagnostic',
                    fetchedAt: '2026-05-26T00:00:00Z',
                    excerpt: 'Pull codes first.',
                    evidenceGrade: 'confirmed',
                  },
                ],
                answers: [
                  {
                    id: 'a1',
                    label: 'No',
                    finding: { verdict: 'Move on', action: 'Test ICP', severity: 'fixable' },
                  },
                ],
              },
            },
          }),
        },
      ],
      usage: { input_tokens: 150, output_tokens: 250 },
    })
    // Pass 3: conflicts
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify([]) }],
      usage: { input_tokens: 80, output_tokens: 50 },
    })
  return {
    anthropic: { messages: { create } },
    MODEL: 'claude-test',
    cachedSystem: (t: string) => [{ type: 'text', text: t }],
  }
})

import { runSynthesis } from '@/lib/research/synthesis-runner'

describe('runSynthesis (3-pass)', () => {
  it('produces a Flow draft with citations + empty conflicts + summed token usage', async () => {
    const out = await runSynthesis({
      platformDisplay: '2003-2007 F-250 6.0 PSD',
      symptomDisplay: 'Cranks, no start',
      agents: [
        { persona: 'aftermarket-shop-owner', status: 'completed', researchLog: '', findings: [], visitedUrls: [], tokenUsage: { inputTokens: 0, outputTokens: 0 } },
        { persona: 'oem-master-tech', status: 'completed', researchLog: '', findings: [], visitedUrls: [], tokenUsage: { inputTokens: 0, outputTokens: 0 } },
        { persona: 'independent-diesel-shop', status: 'completed', researchLog: '', findings: [], visitedUrls: [], tokenUsage: { inputTokens: 0, outputTokens: 0 } },
      ],
    })
    expect(out.draftBody.startStepId).toBe('step-1')
    expect(out.draftBody.steps['step-1'].citations?.[0]?.sourceUrl).toBe('https://dieselhub.com/test')
    expect(out.conflicts).toEqual([])
    expect(out.tokenUsage.inputTokens).toBe(100 + 150 + 80)
    expect(out.tokenUsage.outputTokens).toBe(200 + 250 + 50)
  })
})
