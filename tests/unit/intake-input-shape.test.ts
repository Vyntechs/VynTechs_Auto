import { describe, it, expect } from 'vitest'
import { detectInputShape } from '@/lib/intake/input-shape'

describe('detectInputShape', () => {
  it('detects 10-digit phone numbers', () => {
    expect(detectInputShape('7705551234')).toEqual({ kind: 'phone', value: '7705551234' })
  })

  it('detects formatted phone numbers', () => {
    expect(detectInputShape('(770) 555-1234')).toEqual({ kind: 'phone', value: '7705551234' })
  })

  it('detects 17-character VINs', () => {
    expect(detectInputShape('1FTFW1ET5BFA12345')).toEqual({ kind: 'vin', value: '1FTFW1ET5BFA12345' })
  })

  it('rejects VIN-shape containing I, O, or Q as name', () => {
    expect(detectInputShape('1FTFW1ET5BFA1234O')).toEqual({ kind: 'name', value: '1FTFW1ET5BFA1234O' })
  })

  it('detects 4-digit years in range', () => {
    expect(detectInputShape('2024')).toEqual({ kind: 'year', value: 2024 })
    expect(detectInputShape('1980')).toEqual({ kind: 'year', value: 1980 })
  })

  it('rejects out-of-range years as name', () => {
    expect(detectInputShape('1979')).toEqual({ kind: 'name', value: '1979' })
    expect(detectInputShape('2099')).toEqual({ kind: 'name', value: '2099' })
  })

  it('detects known makes case-insensitively (canonical casing returned)', () => {
    expect(detectInputShape('ford')).toEqual({ kind: 'make', value: 'Ford' })
    expect(detectInputShape('FORD')).toEqual({ kind: 'make', value: 'Ford' })
  })

  it('treats unknown makes as name', () => {
    expect(detectInputShape('Trabant')).toEqual({ kind: 'name', value: 'Trabant' })
  })

  it('detects email addresses', () => {
    expect(detectInputShape('john@smith.com')).toEqual({ kind: 'email', value: 'john@smith.com' })
  })

  it('detects 5-8 char alphanumeric plates', () => {
    expect(detectInputShape('ABC1234')).toEqual({ kind: 'plate', value: 'ABC1234' })
    expect(detectInputShape('F4XQ2')).toEqual({ kind: 'plate', value: 'F4XQ2' })
  })

  it('falls back to name for anything else', () => {
    expect(detectInputShape('Smith')).toEqual({ kind: 'name', value: 'Smith' })
    expect(detectInputShape('123')).toEqual({ kind: 'name', value: '123' })
  })

  it('normalizes case for VIN (uppercases)', () => {
    expect(detectInputShape('1ftfw1et5bfa12345')).toEqual({ kind: 'vin', value: '1FTFW1ET5BFA12345' })
  })
})

describe('detectInputShape — extended make coverage', () => {
  it.each([
    ['chevrolet', 'Chevrolet'],
    ['ram', 'RAM'],
    ['tesla', 'Tesla'],
    ['mercedes-benz', 'Mercedes-Benz'],
    ['land rover', 'Land Rover'],
  ])('detects "%s" as make %s', (input, expected) => {
    expect(detectInputShape(input)).toEqual({ kind: 'make', value: expected })
  })
})
