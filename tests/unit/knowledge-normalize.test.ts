import { describe, it, expect } from 'vitest'
import { normalizeDtc, normalizeEngine } from '@/lib/knowledge/normalize'

describe('normalizeDtc', () => {
  describe('canonical bare codes', () => {
    it('passes through canonical input', () => {
      expect(normalizeDtc('P0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('uppercases lowercase input', () => {
      expect(normalizeDtc('p0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('accepts all four valid first letters', () => {
      expect(normalizeDtc('P0001')?.canonical).toBe('P0001')
      expect(normalizeDtc('B0001')?.canonical).toBe('B0001')
      expect(normalizeDtc('C0001')?.canonical).toBe('C0001')
      expect(normalizeDtc('U0001')?.canonical).toBe('U0001')
    })

    it('accepts hex bodies (bug fix — today P0A80 is rejected)', () => {
      expect(normalizeDtc('P0A80')).toEqual({ canonical: 'P0A80', subCode: null })
    })

    it('accepts OEM-extended codes (second char 1-3)', () => {
      expect(normalizeDtc('P1234')?.canonical).toBe('P1234')
      expect(normalizeDtc('P2345')?.canonical).toBe('P2345')
      expect(normalizeDtc('P3456')?.canonical).toBe('P3456')
    })
  })

  describe('silent cleanup', () => {
    it('strips internal whitespace', () => {
      expect(normalizeDtc('P 0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('P 0 4 2 0')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips internal dashes', () => {
      expect(normalizeDtc('P-0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips leading/trailing whitespace', () => {
      expect(normalizeDtc('  P0420  ')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips a "code" prefix', () => {
      expect(normalizeDtc('code P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('Code: P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('CODE:P0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips a "DTC" prefix', () => {
      expect(normalizeDtc('DTC P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('DTC: P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('dtc:P0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('applies the letter-O → digit-0 fix in body positions only', () => {
      expect(normalizeDtc('PO420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('POO20')).toEqual({ canonical: 'P0020', subCode: null })
    })

    it('does NOT swap the first-letter position', () => {
      expect(normalizeDtc('00420')).toBeNull()
    })
  })

  describe('sub-code capture', () => {
    it('captures dash-style sub-code', () => {
      expect(normalizeDtc('P0420-00')).toEqual({ canonical: 'P0420', subCode: '00' })
    })

    it('captures colon-style sub-code', () => {
      expect(normalizeDtc('P0420:11')).toEqual({ canonical: 'P0420', subCode: '11' })
    })

    it('captures hex sub-code', () => {
      expect(normalizeDtc('P0420-FF')).toEqual({ canonical: 'P0420', subCode: 'FF' })
      expect(normalizeDtc('P0420-AB')).toEqual({ canonical: 'P0420', subCode: 'AB' })
    })

    it('captures sub-code through letter-case mixing', () => {
      expect(normalizeDtc('p0420-ab')).toEqual({ canonical: 'P0420', subCode: 'AB' })
    })

    it('captures sub-code with prefix-strip and whitespace combined', () => {
      expect(normalizeDtc('DTC: p 0420-00')).toEqual({ canonical: 'P0420', subCode: '00' })
    })

    it('drops a malformed sub-code but preserves the base', () => {
      expect(normalizeDtc('P0420-XYZ')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('P0420-0')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('P0420-')).toEqual({ canonical: 'P0420', subCode: null })
    })
  })

  describe('hard rejects', () => {
    it('rejects empty input', () => {
      expect(normalizeDtc('')).toBeNull()
      expect(normalizeDtc('   ')).toBeNull()
    })

    it('rejects wrong first letter', () => {
      expect(normalizeDtc('Z0420')).toBeNull()
      expect(normalizeDtc('A1234')).toBeNull()
      expect(normalizeDtc('X0001')).toBeNull()
    })

    it('rejects wrong second char (must be 0-3)', () => {
      expect(normalizeDtc('P4420')).toBeNull()
      expect(normalizeDtc('PA420')).toBeNull()
    })

    it('rejects wrong length', () => {
      expect(normalizeDtc('P042')).toBeNull()
      expect(normalizeDtc('P04200')).toBeNull()
      expect(normalizeDtc('P02663')).toBeNull()
    })

    it('rejects non-hex chars in body', () => {
      expect(normalizeDtc('P0G20')).toBeNull()
      expect(normalizeDtc('P042X')).toBeNull()
      expect(normalizeDtc('P04ZZ')).toBeNull()
    })

    it('rejects missing first letter', () => {
      expect(normalizeDtc('0420')).toBeNull()
    })

    it('rejects pure jibberish', () => {
      expect(normalizeDtc('not a code')).toBeNull()
      expect(normalizeDtc('???')).toBeNull()
    })
  })
})

describe('normalizeEngine', () => {
  it.each([
    ['6.7 Powerstroke', '6.7L Powerstroke'],
    ['6.7L Powerstroke', '6.7L Powerstroke'],
    ['6.7L Power Stroke', '6.7L Powerstroke'],
    ['6.7L PSD', '6.7L Powerstroke'],
    ['6.7l powerstroke', '6.7L Powerstroke'],
    ['6.4 Powerstroke', '6.4L Powerstroke'],
    ['6.4L PSD', '6.4L Powerstroke'],
  ])('canonicalizes %s -> %s', (input, expected) => {
    expect(normalizeEngine(input)).toBe(expected)
  })

  it('passes through unknown engines unchanged (trimmed)', () => {
    expect(normalizeEngine('2.0L Turbo')).toBe('2.0L Turbo')
    expect(normalizeEngine('  3.5L EcoBoost  ')).toBe('3.5L EcoBoost')
  })

  it('returns null/empty input as null', () => {
    expect(normalizeEngine(null)).toBeNull()
    expect(normalizeEngine(undefined)).toBeNull()
    expect(normalizeEngine('   ')).toBeNull()
  })
})
