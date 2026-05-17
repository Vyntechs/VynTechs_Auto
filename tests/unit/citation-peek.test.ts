import { describe, it, expect } from 'vitest'
import { getCitationPeek } from '@/lib/knowledge/citation-peek'
import type { KnowledgeListRow } from '@/lib/knowledge/list'

// Minimal factory — peek only reads type / body / structuredData.
function makeRow(overrides: Partial<KnowledgeListRow>): KnowledgeListRow {
  return {
    id: 'k_1',
    shopId: 's_1',
    type: 'note',
    title: 'Untitled',
    body: null,
    structuredData: null,
    dtcList: [],
    systemCodes: [],
    symptoms: [],
    relatedItemIds: null,
    createdByUserId: 'u_1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    retired: false,
    retiredAt: null,
    retiredByUserId: null,
    fireCount: 0,
    vehicleScopes: [],
    ...overrides,
  }
}

describe('getCitationPeek', () => {
  describe('pinout', () => {
    it('returns data segments built from the first pin', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'pinout',
          structuredData: {
            connector_ref: 'PCM C175',
            pins: [
              {
                pin_number: '31',
                signal_name: 'Boost pressure sensor signal',
                wire_color: 'GN/WT',
                expected_voltage_or_waveform: '0.5–4.5 V analog',
              },
            ],
          },
        }),
      )
      expect(peek.kind).toBe('data')
      if (peek.kind !== 'data') return
      const text = peek.segments.map(s => s.text).join('')
      expect(text).toContain('pin')
      expect(text).toContain('31')
      expect(text).toContain('Boost pressure sensor signal')
      expect(text).toContain('GN/WT')
      expect(text).toContain('0.5–4.5 V analog')
    })

    it('marks separators and labels as dim', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'pinout',
          structuredData: {
            connector_ref: 'C1',
            pins: [{ pin_number: '1', signal_name: 'Signal', wire_color: 'BK' }],
          },
        }),
      )
      if (peek.kind !== 'data') throw new Error('expected data peek')
      // `pin ` (label) and ` · ` (separators) are dim; values are not
      const dimSegments = peek.segments.filter(s => s.dim).map(s => s.text)
      expect(dimSegments).toContain('pin ')
      expect(dimSegments.some(s => s.includes('·'))).toBe(true)
    })

    it('falls back to connector_ref prose when pins are missing', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'pinout',
          structuredData: { connector_ref: 'PCM C175', pins: [] },
        }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'PCM C175' })
    })

    it('falls back to a generic label when nothing usable is present', () => {
      const peek = getCitationPeek(makeRow({ type: 'pinout', structuredData: {} }))
      expect(peek.kind).toBe('prose')
      if (peek.kind === 'prose') expect(peek.text.length).toBeGreaterThan(0)
    })

    it('skips optional pin fields without inserting empty separators', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'pinout',
          structuredData: {
            connector_ref: 'C1',
            // wire_color and expected_voltage_or_waveform omitted
            pins: [{ pin_number: '31', signal_name: 'Signal' }],
          },
        }),
      )
      if (peek.kind !== 'data') throw new Error('expected data peek')
      // No segment should be the empty separator surrounding an absent field.
      const sepCount = peek.segments.filter(s => s.text === ' · ').length
      // Only one separator between pin number and signal name.
      expect(sepCount).toBe(1)
    })
  })

  describe('connector', () => {
    it('prefers location_description', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'connector',
          structuredData: {
            component_name: 'PCM',
            location_description: 'Left-front fender well, behind the air-box.',
          },
        }),
      )
      expect(peek).toEqual({
        kind: 'prose',
        text: 'Left-front fender well, behind the air-box.',
      })
    })

    it('falls back to component_name when location is missing', () => {
      const peek = getCitationPeek(
        makeRow({ type: 'connector', structuredData: { component_name: 'PCM' } }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'PCM' })
    })
  })

  describe('wiring_diagram', () => {
    it('returns data segments built from the first connection', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'wiring_diagram',
          structuredData: {
            name: 'Boost feedback',
            connections: [
              {
                from_component: 'Boost sensor',
                from_pin: 'B',
                to_component: 'PCM C175',
                to_pin: '31',
                wire_color: 'GN/WT',
              },
            ],
          },
        }),
      )
      expect(peek.kind).toBe('data')
      if (peek.kind !== 'data') return
      const text = peek.segments.map(s => s.text).join('')
      expect(text).toContain('Boost sensor')
      expect(text).toContain('B')
      expect(text).toContain('PCM C175')
      expect(text).toContain('31')
      expect(text).toContain('GN/WT')
      expect(text).toContain('→')
    })

    it('falls back to name prose when connections are empty', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'wiring_diagram',
          structuredData: { name: 'Boost feedback', connections: [] },
        }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'Boost feedback' })
    })
  })

  describe('theory_of_operation', () => {
    it('returns the first section body as prose', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'theory_of_operation',
          structuredData: {
            sections: [
              { heading: 'What it measures', body: 'Commanded vs. actual boost…' },
            ],
          },
        }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'Commanded vs. actual boost…' })
    })

    it('falls back to heading when the first section has no body', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'theory_of_operation',
          structuredData: { sections: [{ heading: 'Theory' }] },
        }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'Theory' })
    })
  })

  describe('cause_fix', () => {
    it('prefers correction over cause over complaint', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'cause_fix',
          structuredData: {
            complaint: 'Power loss',
            cause: 'Cracked CAC pipe',
            correction: 'Replace cold-side CAC pipe.',
          },
        }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'Replace cold-side CAC pipe.' })
    })

    it('falls back to complaint when correction and cause are missing', () => {
      const peek = getCitationPeek(
        makeRow({ type: 'cause_fix', structuredData: { complaint: 'Power loss' } }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'Power loss' })
    })
  })

  describe('bulletin', () => {
    it('returns data segments with source, id, and summary', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'bulletin',
          structuredData: {
            source: 'Ford TSB',
            bulletin_id: '18-2218',
            summary: 'Updated CAC pipe with reinforced ferrule.',
          },
        }),
      )
      expect(peek.kind).toBe('data')
      if (peek.kind !== 'data') return
      const text = peek.segments.map(s => s.text).join('')
      expect(text).toContain('Ford TSB')
      expect(text).toContain('18-2218')
      expect(text).toContain('Updated CAC pipe with reinforced ferrule.')
    })

    it('omits the bulletin id when missing', () => {
      const peek = getCitationPeek(
        makeRow({
          type: 'bulletin',
          structuredData: { source: 'Ford TSB', summary: 'short summary' },
        }),
      )
      if (peek.kind !== 'data') throw new Error('expected data peek')
      const text = peek.segments.map(s => s.text).join('')
      expect(text).not.toMatch(/Ford TSB\s+·\s+·/) // no double separator
    })
  })

  describe('note + reference_doc', () => {
    it('returns item.body as prose for note', () => {
      const peek = getCitationPeek(
        makeRow({ type: 'note', body: 'Start at 5 psi for the first sweep.' }),
      )
      expect(peek).toEqual({
        kind: 'prose',
        text: 'Start at 5 psi for the first sweep.',
      })
    })

    it('returns item.body as prose for reference_doc', () => {
      const peek = getCitationPeek(
        makeRow({ type: 'reference_doc', body: 'See Ford TIS doc 8.5.' }),
      )
      expect(peek).toEqual({ kind: 'prose', text: 'See Ford TIS doc 8.5.' })
    })

    it('falls back to a generic label for an empty note body', () => {
      const peek = getCitationPeek(makeRow({ type: 'note', body: '' }))
      expect(peek.kind).toBe('prose')
      if (peek.kind === 'prose') expect(peek.text.length).toBeGreaterThan(0)
    })
  })

  describe('robustness', () => {
    it('handles null structuredData', () => {
      const peek = getCitationPeek(makeRow({ type: 'pinout', structuredData: null }))
      expect(peek.kind).toBe('prose')
    })

    it('handles missing structuredData keys', () => {
      const peek = getCitationPeek(makeRow({ type: 'connector', structuredData: {} }))
      expect(peek.kind).toBe('prose')
    })
  })
})
