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

// Citations pass is now PER-STEP: the model returns only this step's Citation[]
// via the emit_citations tool, never a re-emitted flow body. For a 1-step flow
// that's a single emit_citations call.
const citationsResp = (
  citations: Array<{ sourceUrl: string }>,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 1, output_tokens: 1 },
) =>
  toolResp(
    'emit_citations',
    {
      citations: citations.map((c) => ({
        sourceUrl: c.sourceUrl,
        title: 'Diagnostic',
        fetchedAt: '2026-05-26T00:00:00Z',
        excerpt: 'Pull codes first.',
        evidenceGrade: 'confirmed',
      })),
    },
    usage,
  )

describe('runSynthesis (tool-use, 3-pass)', () => {
  beforeEach(() => createMock.mockReset())

  it('produces a Flow draft with citations + empty conflicts + summed token usage', async () => {
    createMock
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 100, output_tokens: 200 }))
      .mockResolvedValueOnce(citationsResp([{ sourceUrl: 'https://dieselhub.com/test' }], { input_tokens: 150, output_tokens: 250 }))
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
      .mockResolvedValueOnce(citationsResp([{ sourceUrl: 'https://real.com/a' }, { sourceUrl: 'https://fabricated.invalid/x' }]))
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

  it("keeps the other steps cited when one step's citation call fails (per-step isolation)", async () => {
    const twoStep = {
      startStepId: 'step-1',
      steps: {
        'step-1': { kind: 'question', n: 1, of: 2, title: 'Pull codes', question: 'Q1?', answers: [{ id: 'a1', label: 'No', next: 'step-2' }] },
        'step-2': { kind: 'question', n: 2, of: 2, title: 'Test ICP', question: 'Q2?', answers: [{ id: 'a1', label: 'No', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
      },
    }
    // Key on the per-step user message so only step-2's citation call fails.
    createMock.mockImplementation((req: { tool_choice?: { name?: string }; messages?: Array<{ content?: string }> }) => {
      const name = req?.tool_choice?.name
      if (name === 'emit_flow') return Promise.resolve(toolResp('emit_flow', twoStep, { input_tokens: 1, output_tokens: 1 }))
      if (name === 'emit_citations') {
        const content = req?.messages?.[0]?.content ?? ''
        if (content.includes('"title": "Test ICP"')) return Promise.reject(new Error('overloaded')) // step-2 fails
        return Promise.resolve(citationsResp([{ sourceUrl: 'https://real.com/a' }]))
      }
      return Promise.resolve(toolResp('emit_conflicts', { conflicts: [] }, { input_tokens: 1, output_tokens: 1 }))
    })

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), agentWith([]), agentWith([])],
    })
    // step-1 cited (its call succeeded); step-2 uncited (its call failed) — run survived.
    expect(out.draftBody.steps['step-1'].citations?.[0]?.sourceUrl).toBe('https://real.com/a')
    expect(out.draftBody.steps['step-2'].citations ?? []).toEqual([])
  })

  it('does not crash when an agent finding is missing its sources / visitedUrls (real-API tolerance)', async () => {
    createMock
      .mockResolvedValueOnce(toolResp('emit_flow', structurePass, { input_tokens: 1, output_tokens: 1 }))
      .mockResolvedValueOnce(citationsResp([{ sourceUrl: 'https://real.com/a' }]))
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
      .mockResolvedValueOnce(citationsResp([{ sourceUrl: 'https://real.com/a' }], { input_tokens: 5, output_tokens: 5 }))
      .mockRejectedValueOnce(new Error('conflicts pass failed'))

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url: 'https://real.com/a' }]), agentWith([]), agentWith([])],
    })
    expect(out.draftBody.startStepId).toBe('step-1')
    expect(out.conflicts).toEqual([])
  })

  // Why this matters: prod produced an 18-step draft with 0 citations because the old
  // single whole-flow citations call truncated and graceful-degrade fell back to the
  // uncited structure. The per-step pass must keep every step cited regardless of size.
  it('attaches citations to every step on a many-step flow (per-step chunking; no truncation)', async () => {
    const N = 12
    const url = 'https://dieselhub.com/test'
    const manyStep = {
      startStepId: 'step-1',
      steps: Object.fromEntries(
        Array.from({ length: N }, (_, i) => [
          `step-${i + 1}`,
          {
            kind: 'question',
            n: i + 1,
            of: N,
            title: `Step ${i + 1}`,
            question: 'Q?',
            answers: [{ id: 'a1', label: 'No', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }],
          },
        ]),
      ),
    }
    const oneCitation = {
      citations: [{ sourceUrl: url, title: 'T', fetchedAt: '2026-05-26T00:00:00Z', excerpt: 'E', evidenceGrade: 'confirmed' }],
    }
    // Tool-name-keyed mock: robust to per-step call ordering / bounded parallelism.
    // (A trailing no-arg invocation from vitest's cleanup hook returns the empty
    // default — runSynthesis itself makes exactly 1 + N + 1 well-formed calls.)
    createMock.mockImplementation((req: { tool_choice?: { name?: string } }) => {
      const name = req?.tool_choice?.name
      if (name === 'emit_flow') return Promise.resolve(toolResp('emit_flow', manyStep, { input_tokens: 10, output_tokens: 10 }))
      if (name === 'emit_citations') return Promise.resolve(toolResp('emit_citations', oneCitation, { input_tokens: 1, output_tokens: 1 }))
      return Promise.resolve(toolResp('emit_conflicts', { conflicts: [] }, { input_tokens: 1, output_tokens: 1 }))
    })

    const out = await runSynthesis({
      platformDisplay: 'p',
      symptomDisplay: 's',
      agents: [agentWith([{ url }]), agentWith([]), agentWith([])],
    })

    const steps = Object.values(out.draftBody.steps)
    expect(steps).toHaveLength(N)
    for (const step of steps) {
      expect(step.citations?.[0]?.sourceUrl).toBe(url)
    }
    // Usage summed across structure + N per-step citation calls + conflicts.
    expect(out.tokenUsage.inputTokens).toBe(10 + N * 1 + 1)
  })
})
