import { describe, it, expect } from 'vitest'
import { buildSearchQuery } from '@/lib/retrieval/query-builder'

describe('buildSearchQuery', () => {
  it('strips conversational filler and keeps symptom-bearing terms', () => {
    // Real example from session 9f7b004c (2015 F-150 6R80 TCC shudder).
    const q = buildSearchQuery({
      vehicleYear: 2015,
      vehicleMake: 'FORD',
      vehicleModel: 'F150',
      vehicleEngine: '3.5 EcoBoost',
      complaintText:
        'Customer states, when driving down the highway, light throttle, the truck shakes and vibrates at tip in / light throttle maintaining speed',
    })

    // Symptom words preserved
    expect(q.toLowerCase()).toContain('shakes')
    expect(q.toLowerCase()).toContain('vibrates')
    expect(q.toLowerCase()).toContain('throttle')
    expect(q.toLowerCase()).toContain('highway')

    // Conversational filler stripped
    expect(q.toLowerCase()).not.toContain('customer')
    expect(q.toLowerCase()).not.toContain('states')
    expect(q.toLowerCase()).not.toContain('truck')

    // Vehicle metadata up front
    expect(q).toContain('2015')
    expect(q).toContain('FORD')
    expect(q).toContain('F150')
    expect(q).toContain('3.5')
    expect(q.toLowerCase()).toContain('ecoboost')
  })

  it('preserves DTC codes verbatim', () => {
    const q = buildSearchQuery({
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-250',
      complaintText: 'loss of power, intermittent stumble',
      dtcs: ['P0087', 'P0088'],
    })
    expect(q).toContain('P0087')
    expect(q).toContain('P0088')
    expect(q.toLowerCase()).toContain('power')
    expect(q.toLowerCase()).toContain('stumble')
  })

  it('preserves DTCs that appear inline in complaint text', () => {
    const q = buildSearchQuery({
      vehicleYear: 2018,
      vehicleMake: 'Honda',
      vehicleModel: 'Accord',
      complaintText: 'CEL with P0420 stored, intermittent',
    })
    // P0420 has a letter so survives the pure-digit filter
    expect(q.toLowerCase()).toContain('p0420')
  })

  it('includes symptom terms from observation text', () => {
    const q = buildSearchQuery({
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-250',
      complaintText: 'P0087, loss of power',
      dtcs: ['P0087'],
      observation: 'rail pressure crashes at 3000 RPM under hard load',
    })
    expect(q.toLowerCase()).toContain('rail')
    expect(q.toLowerCase()).toContain('crashes')
    expect(q.toLowerCase()).toContain('rpm')
    expect(q.toLowerCase()).toContain('load')
    // Pure digit "3000" gets dropped
    expect(q).not.toMatch(/\b3000\b/)
  })

  it('dedupes repeated terms case-insensitively, preserving first-occurrence case', () => {
    const q = buildSearchQuery({
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-250',
      complaintText: 'shudder Shudder SHUDDER vibration shudder',
    })
    const matches = q.toLowerCase().match(/shudder/g) ?? []
    expect(matches).toHaveLength(1)
    expect(q).toContain('shudder') // first occurrence is lowercase, preserved
  })

  it('preserves hyphenated technical terms like tip-in and 5w-30', () => {
    const q = buildSearchQuery({
      vehicleYear: 2015,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      complaintText: 'shudder at tip-in, recently changed to 5w-30 oil',
    })
    expect(q.toLowerCase()).toContain('tip-in')
    expect(q.toLowerCase()).toContain('5w-30')
  })

  it('truncates the query when it exceeds the 200-char cap', () => {
    const longText = 'shudder vibration noise rattle clunk knock surge stall '.repeat(50)
    const q = buildSearchQuery({
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-250',
      complaintText: longText,
    })
    expect(q.length).toBeLessThanOrEqual(200)
  })

  it('drops short tokens (under 3 chars)', () => {
    const q = buildSearchQuery({
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-250',
      complaintText: 'it is a no go but the rpm is up',
    })
    // "is", "a", "go" are too short; "no" is 2 chars, "up" is 2 chars
    expect(q.toLowerCase()).not.toMatch(/\bgo\b/)
    expect(q.toLowerCase()).not.toMatch(/\bup\b/)
    expect(q.toLowerCase()).toContain('rpm')
  })

  it('handles missing optional fields gracefully', () => {
    const q = buildSearchQuery({
      vehicleYear: 2020,
      vehicleMake: 'Tesla',
      vehicleModel: 'Model 3',
      complaintText: 'clunk over bumps',
    })
    expect(q).toContain('2020')
    expect(q).toContain('Tesla')
    expect(q).toContain('Model 3')
    expect(q.toLowerCase()).toContain('clunk')
    expect(q.toLowerCase()).toContain('bumps')
  })
})
