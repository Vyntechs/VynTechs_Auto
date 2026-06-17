import { describe, it, expect } from 'vitest'
import { parseStructuredOutput } from '@/lib/research/subagent-runner'

// Reproduces the real Phase-1 failure: web_search responses emit the findings JSON
// in an EARLIER text block and end with a short prose sign-off. The old parser read
// only the last block → 0 findings → every persona "failed" as thin.
const findingsJson = JSON.stringify({
  researchLog: 'Searched 10 sources on 6.7 PSD DEF derate.',
  findings: [
    { id: 'f1', claim: 'P204F indicates SCR reductant system performance fault.', sources: [{ url: 'https://a', title: 'T1', fetchedAt: '2026-06-17', excerpt: 'e1' }] },
    { id: 'f2', claim: 'P20EE is NOx catalyst efficiency below threshold (bank 1).', sources: [{ url: 'https://b', title: 'T2', fetchedAt: '2026-06-17', excerpt: 'e2' }] },
    { id: 'f3', claim: 'Low-quality DEF triggers a staged derate after warnings.', sources: [{ url: 'https://c', title: 'T3', fetchedAt: '2026-06-17', excerpt: 'e3' }] },
  ],
})

describe('parseStructuredOutput — web_search multi-block responses', () => {
  it('extracts findings from an earlier text block when the last block is a prose sign-off', () => {
    const content = [
      { type: 'web_search_tool_result', content: [] },
      { type: 'text', text: findingsJson },
      { type: 'text', text: ' Always heat-soak sensor threads with penetrant before removal.' },
    ] as never
    const out = parseStructuredOutput(content)
    expect(out.findings).toHaveLength(3)
    expect(out.findings[0].claim).toMatch(/P204F/)
  })

  it('parses a single-block JSON response (regression)', () => {
    const out = parseStructuredOutput([{ type: 'text', text: findingsJson }] as never)
    expect(out.findings).toHaveLength(3)
  })

  it('handles a ```json fenced block', () => {
    const out = parseStructuredOutput([{ type: 'text', text: '```json\n' + findingsJson + '\n```' }] as never)
    expect(out.findings).toHaveLength(3)
  })

  it('returns 0 findings and preserves the last text when no JSON is present', () => {
    const out = parseStructuredOutput([{ type: 'text', text: 'no json here at all' }] as never)
    expect(out.findings).toHaveLength(0)
    expect(out.researchLog).toContain('no json')
  })
})
