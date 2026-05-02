import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              riskClass: 'high',
              rationale: 'novel mechanical poke at idle could de-seat sensor',
              reversible: true,
            }),
          },
        ],
        usage: { input_tokens: 80, output_tokens: 40 },
      }),
    },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

describe('classifyAction', () => {
  it('uses hardcoded rule for "read PID" (zero risk)', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction('Read live PID for MAF airflow')
    expect(r.riskClass).toBe('zero')
    expect(r.source).toBe('rule')
  })

  it('uses hardcoded rule for "back-probe B+" (high risk)', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction('Back-probe the alternator B+ circuit at the splice')
    expect(r.riskClass).toBe('high')
    expect(r.source).toBe('rule')
  })

  it('uses hardcoded rule for "cut wire" (destructive, irreversible)', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction('Cut the K-CAN-H wire at pin 7')
    expect(r.riskClass).toBe('destructive')
    expect(r.reversible).toBe(false)
    expect(r.source).toBe('rule')
  })

  it('uses hardcoded rule for "smoke test" (low risk)', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction('Run a smoke test on the intake to find the boost leak')
    expect(r.riskClass).toBe('low')
    expect(r.source).toBe('rule')
  })

  it('falls through to LLM judge for novel actions', async () => {
    const { classifyAction } = await import('@/lib/gating/risk-classifier')
    const r = await classifyAction(
      'Tap on the throttle body with a deadblow at idle to reproduce the stumble',
    )
    expect(r.riskClass).toBe('high')
    expect(r.source).toBe('llm')
  })
})
