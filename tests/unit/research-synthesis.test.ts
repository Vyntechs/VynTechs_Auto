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

// Synthesis now uses tool-use: the model is forced to call a tool and the SDK
// returns the parsed object on a `tool_use` block — no free-text JSON parsing.
const toolResp = (
  name: string,
  input: unknown,
  usage: { input_tokens: number; output_tokens: number },
  stop_reason = 'tool_use',
) => ({ content: [{ type: 'tool_use', id: 'tu_1', name, input }], usage, stop_reason })

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

describe('runSynthesis (tool-use, 3-pass)', () => {
  beforeEach(() => createMock.mockReset())

  it('produces a Flow draft with citations + empty conflicts + summed token usage', async () => {
    createMock
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 100, output_tokens: 200 }))
      .mockResolvedValueOnce(toolResp('emit_flow', citationsPass([{ sourceUrl: 'https://dieselhub.com/test' }]), { input_tokens: 150, output_tokens: 250 }))
      .mockResolvedValueOnce(toolResp('emit_conflicts', { conflicts: [] }, { input_tokens: 80, output_tokens: 50 }))

    const out = await runSynthesis({
      platformDisplay: '2003-2007 F-250 6.0 PSD',
      symptomDisplay: 'Cranks, no start',
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
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 1, output_tokens: 1 }))
      .mockResolvedValueOnce(
        toolResp('emit_flow', citationsPass([{ sourceUrl: 'https://real.com/a' }, { sourceUrl: 'https://fabricated.invalid/x' }]), { input_tokens: 1, output_tokens: 1 }),
      )
      .mockResolvedValueOnce(toolResp('emit_conflicts', { conflicts: [] }, { input_tokens: 1, output_tokens: 1 }))

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), agentWith([]), agentWith([])],
    })
    const urls = (out.draftBody.steps['step-1'].citations ?? []).map((c) => c.sourceUrl)
    expect(urls).toEqual(['https://real.com/a'])
    expect(urls).not.toContain('https://fabricated.invalid/x')
  })

  it('degrades to the uncited structure draft when the citations pass throws (never kills the run)', async () => {
    createMock
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 5, output_tokens: 5 }))
      .mockRejectedValueOnce(new Error('overloaded_error / output truncated')) // pass 2 fails
      .mockResolvedValueOnce(toolResp('emit_conflicts', { conflicts: [] }, { input_tokens: 5, output_tokens: 5 }))

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), agentWith([]), agentWith([])],
    })
    // Still a usable Flow — the structure draft, just without citations.
    expect(out.draftBody.startStepId).toBe('step-1')
    const step = out.draftBody.steps['step-1']
    expect(step.kind).toBe('question')
    if (step.kind === 'question') expect(step.answers).toHaveLength(1)
    expect(out.conflicts).toEqual([])
  })

  it('degrades when the citations pass returns an unusable (no-steps) body', async () => {
    createMock
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 5, output_tokens: 5 }))
      .mockResolvedValueOnce(toolResp('emit_flow', { startStepId: 'x' }, { input_tokens: 5, output_tokens: 5 })) // no steps
      .mockResolvedValueOnce(toolResp('emit_conflicts', { conflicts: [] }, { input_tokens: 5, output_tokens: 5 }))

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), agentWith([]), agentWith([])],
    })
    expect(out.draftBody.steps['step-1']).toBeDefined() // kept the structure draft
  })

  it('does not crash when an agent finding is missing its sources / visitedUrls (real-API tolerance)', async () => {
    createMock
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 1, output_tokens: 1 }))
      .mockResolvedValueOnce(toolResp('emit_flow', citationsPass([{ sourceUrl: 'https://real.com/a' }]), { input_tokens: 1, output_tokens: 1 }))
      .mockResolvedValueOnce(toolResp('emit_conflicts', { conflicts: [] }, { input_tokens: 1, output_tokens: 1 }))

    const malformed = {
      persona: 'oem-master-tech',
      status: 'completed',
      researchLog: '',
      findings: [{ id: 'f1', claim: 'c' }], // no `sources`
      // no `visitedUrls`
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    } as unknown as ResearchAgentOutput

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), malformed, agentWith([])],
    })
    expect(out.draftBody.startStepId).toBe('step-1')
  })

  it('still returns the draft when the conflicts pass throws (conflicts default to [])', async () => {
    createMock
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 5, output_tokens: 5 }))
      .mockResolvedValueOnce(toolResp('emit_flow', citationsPass([{ sourceUrl: 'https://real.com/a' }]), { input_tokens: 5, output_tokens: 5 }))
      .mockRejectedValueOnce(new Error('conflicts pass failed'))

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), agentWith([]), agentWith([])],
    })
    expect(out.draftBody.startStepId).toBe('step-1')
    expect(out.conflicts).toEqual([])
  })
})
