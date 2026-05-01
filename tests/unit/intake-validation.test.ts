import { describe, it, expect } from 'vitest'
import { intakeSchema } from '@/lib/types'

describe('intakeSchema', () => {
  it('accepts a complete valid intake payload', () => {
    const result = intakeSchema.safeParse({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power going up hills',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a vehicleYear far in the future', () => {
    const result = intakeSchema.safeParse({
      vehicleYear: 2050,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power going up hills',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty customerComplaint', () => {
    const result = intakeSchema.safeParse({
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: '',
    })
    expect(result.success).toBe(false)
  })
})
