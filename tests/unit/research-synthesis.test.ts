import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ResearchAgentOutput } from '@/lib/research/types'

// Hoisted mock fn so each test can queue its own response sequence.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('@/lib/ai/client', () => ({
  anthropic: { messages: { create: createMock } },
  MODEL: 'claude-test',
  cachedSystem: (t: string) => [{ type: 'text', text: t }],
}))

import { runSynthesis } from '@/lib/research/synthesis-runner'

const textResp = (payload: unknown, usage: { input_tokens: number; output_tokens: number }) => ({
  content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
  usage,
})

const agentWith = (sources: Array<{ url: string }>): ResearchAgentOutput => ({
  persona: 'aftermarket-shop-owner',
  status: 'completed',
  researchLog: '',
  findings: [{ id: 'f1', claim: 'c', sources: sources.map((s) => ({ url: s.url, title: 't', fetchedAt: 'now', excerpt: 'e' })) }],
  visitedUrls: sources.map((s) => s.url),
  tokenUsage: { inputTokens: 0, outputTokens: 0 },
})

const structurePass = {
  startStepId: 'step-1',
  steps: {
    'step-1': {
      kind: 'question',
      n: 1,
      of: 1,
      title: 'Pull codes',
      question: 'Any codes?',
      answers: [{ id: 'a1', label: 'No', finding: { verdict: 'Move on', action: 'Test ICP', severity: 'fixable' } }],
    },
  },
}

const citationsPass = (citations: Array<{ sourceUrl: string }>) => ({
  startStepId: 'step-1',
  steps: {
    'step-1': {
      kind: 'question',
      n: 1,
      of: 1,
      title: 'Pull codes',
      question: 'Any codes?',
      citations: citations.map((c) => ({
        sourceUrl: c.sourceUrl,
        title: 'Diagnostic',
        fetchedAt: '2026-05-26T00:00:00Z',
        excerpt: 'Pull codes first.',
        evidenceGrade: 'confirmed',
      })),
      answers: [{ id: 'a1', label: 'No', finding: { verdict: 'Move on', action: 'Test ICP', severity: 'fixable' } }],
    },
  },
})

describe('runSynthesis (3-pass)', () => {
  beforeEach(() => createMock.mockReset())

  it('produces a Flow draft with citations + empty conflicts + summed token usage', async () => {
    createMock
      .mockResolvedValueOnce(textResp(structurePass, { input_tokens: 100, output_tokens: 200 }))
      .mockResolvedValueOnce(textResp(citationsPass([{ sourceUrl: 'https://dieselhub.com/test' }]), { input_tokens: 150, output_tokens: 250 }))
      .mockResolvedValueOnce(textResp([], { input_tokens: 80, output_tokens: 50 }))

    const out = await runSynthesis({
      platformDisplay: '2003-2007 F-250 6.0 PSD',
      symptomDisplay: 'Cranks, no start',
      // The cited URL must actually come from an agent (provenance rule).
      agents: [agentWith([{ url: 'https://dieselhub.com/test' }]), agentWith([]), agentWith([])],
    })
    expect(out.draftBody.startStepId).toBe('step-1')
    expect(out.draftBody.steps['step-1'].citations?.[0]?.sourceUrl).toBe('https://dieselhub.com/test')
    expect(out.conflicts).toEqual([])
    expect(out.tokenUsage.inputTokens).toBe(100 + 150 + 80)
    expect(out.tokenUsage.outputTokens).toBe(200 + 250 + 50)
  })

  it('strips citations whose sourceUrl no agent actually fetched (anti-fabrication)', async () => {
    createMock
      .mockResolvedValueOnce(textResp(structurePass, { input_tokens: 1, output_tokens: 1 }))
      .mockResolvedValueOnce(
        textResp(
          citationsPass([{ sourceUrl: 'https://real.com/a' }, { sourceUrl: 'https://fabricated.invalid/x' }]),
          { input_tokens: 1, output_tokens: 1 },
        ),
      )
      .mockResolvedValueOnce(textResp([], { input_tokens: 1, output_tokens: 1 }))

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), agentWith([]), agentWith([])],
    })
    const urls = (out.draftBody.steps['step-1'].citations ?? []).map((c) => c.sourceUrl)
    expect(urls).toEqual(['https://real.com/a'])
    expect(urls).not.toContain('https://fabricated.invalid/x')
  })
})
