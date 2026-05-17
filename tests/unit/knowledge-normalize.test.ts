import { describe, it, expect } from 'vitest'
import { normalizeDtc, normalizeEngine } from '@/lib/knowledge/normalize'

describe('normalizeDtc', () => {
  it.each([
    ['P0420', 'P0420'],
    ['P0420-00', 'P0420'],
    ['P0420-FF', 'P0420'],
    ['p0420', 'P0420'],
    ['  P0420  ', 'P0420'],
    ['U0100-08', 'U0100'],
    ['b1234', 'B1234'],
    ['C0035-04', 'C0035'],
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeDtc(input)).toBe(expected)
  })

  it('returns null for input that is not a valid DTC shape', () => {
    expect(normalizeDtc('not-a-dtc')).toBeNull()
    expect(normalizeDtc('')).toBeNull()
    expect(normalizeDtc('P420')).toBeNull()
    expect(normalizeDtc('X0420')).toBeNull()
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
