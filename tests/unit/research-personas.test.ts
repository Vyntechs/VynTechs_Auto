import { describe, it, expect } from 'vitest'
import { RESEARCH_PERSONAS, getPersona } from '@/lib/research/personas'

describe('RESEARCH_PERSONAS', () => {
  it('has exactly 3 personas with distinct ids', () => {
    expect(RESEARCH_PERSONAS).toHaveLength(3)
    const ids = RESEARCH_PERSONAS.map((p) => p.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('each persona system prompt includes the anti-fabrication clause', () => {
    for (const p of RESEARCH_PERSONAS) {
      expect(p.systemPrompt).toContain('NON-NEGOTIABLE')
      expect(p.systemPrompt).toContain('fetched in this session')
    }
  })

  it('getPersona returns the right persona by id', () => {
    expect(getPersona('aftermarket-shop-owner').displayName).toMatch(/aftermarket/i)
    expect(getPersona('oem-master-tech').displayName).toMatch(/OEM|Ford-certified/i)
    expect(getPersona('independent-diesel-shop').displayName).toMatch(/independent/i)
  })

  it('throws on unknown persona', () => {
    expect(() => getPersona('bogus' as never)).toThrow()
  })
})
