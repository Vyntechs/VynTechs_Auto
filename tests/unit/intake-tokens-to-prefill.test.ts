import { describe, it, expect } from 'vitest'
import { tokensToPrefill } from '@/lib/intake/tokens-to-prefill'

describe('tokensToPrefill', () => {
  it('routes a phone token to phone field', () => {
    expect(tokensToPrefill(['(720) 555-1234'])).toEqual({ phone: '7205551234' })
  })

  it('routes a VIN token to vin field', () => {
    expect(tokensToPrefill(['1FTFW1ET5BFA12345'])).toEqual({ vin: '1FTFW1ET5BFA12345' })
  })

  it('routes a year token to year field', () => {
    expect(tokensToPrefill(['2024'])).toEqual({ year: 2024 })
  })

  it('routes a make token to make field', () => {
    expect(tokensToPrefill(['Ford'])).toEqual({ make: 'Ford' })
  })

  it('routes an email token to email field', () => {
    expect(tokensToPrefill(['john@smith.com'])).toEqual({ email: 'john@smith.com' })
  })

  it('routes a plate token to plate field', () => {
    expect(tokensToPrefill(['ABC1234'])).toEqual({ plate: 'ABC1234' })
  })

  it('joins multiple name tokens with a single space', () => {
    expect(tokensToPrefill(['John', 'Smith'])).toEqual({ name: 'John Smith' })
  })

  it('routes a mixed multi-token query into separate fields', () => {
    const result = tokensToPrefill(['Smith', '(720)', '555-1234', '2018', 'Ford', 'F-150'])
    expect(result).toEqual({
      name: 'Smith F-150',
      phone: '7205551234',
      year: 2018,
      make: 'Ford',
    })
  })

  it('returns an empty object for an empty token array', () => {
    expect(tokensToPrefill([])).toEqual({})
  })

  it('returns an empty object for whitespace-only tokens', () => {
    expect(tokensToPrefill(['', '  '])).toEqual({})
  })
})
