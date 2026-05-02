import { describe, it, expect } from 'vitest'
import { outcomeSchema } from '@/lib/types'

describe('outcomeSchema', () => {
  it('accepts a complete part_replacement payload', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'Wastegate vacuum line cracked at actuator-can end',
      actionType: 'part_replacement',
      partInfo: { name: 'Vacuum line, silicone 4mm', oemNumber: 'BL3Z-9C915-A', cost: 12.5 },
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 25,
      repairMinutes: 18,
      notes: 'Confirmed with smoke test',
    })
    expect(r.success).toBe(true)
  })

  it('accepts a no_fix payload without partInfo', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'No fault reproduced after 30-min road test under load',
      actionType: 'no_fix',
      verification: { codesCleared: false, testDrive: true, symptomsResolved: 'partial' },
      diagMinutes: 45,
      repairMinutes: 0,
    })
    expect(r.success).toBe(true)
  })

  it('rejects rootCause shorter than 10 chars', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'bad wire',
      actionType: 'repair',
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 10,
      repairMinutes: 5,
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown actionType', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'Replaced spark plugs and ignition coil',
      actionType: 'guesswork',
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 10,
      repairMinutes: 30,
    })
    expect(r.success).toBe(false)
  })

  it('rejects negative minutes', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'Replaced spark plugs and ignition coil',
      actionType: 'repair',
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: -1,
      repairMinutes: 5,
    })
    expect(r.success).toBe(false)
  })
})
