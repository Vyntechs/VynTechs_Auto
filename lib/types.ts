import { z } from 'zod'

export const ambientConditionsSchema = z.object({
  temperatureF: z.number().finite(),
  humidityPct: z.number().min(0).max(100).optional(),
  windKph: z.number().nonnegative().optional(),
  conditions: z.string().max(120).optional(),
  source: z.enum(['geolocation', 'manual']),
  capturedAt: z.string().datetime({ offset: true }),
  // lat/lon are optional and intentionally low-precision (~11km) to avoid
  // pinpointing the tech's location while still letting a curator audit that
  // the lookup wasn't wildly off (e.g. VPN'd).
  approxLat: z.number().min(-90).max(90).optional(),
  approxLon: z.number().min(-180).max(180).optional(),
})

export type AmbientConditions = z.infer<typeof ambientConditionsSchema>

export const intakeSchema = z.object({
  vehicleYear: z.number().int().max(new Date().getFullYear() + 1),
  vehicleMake: z.string(),
  vehicleModel: z.string(),
  vehicleEngine: z.string().optional(),
  mileage: z.number().int().nonnegative().optional(),
  customerComplaint: z.string().min(5),
  ambientConditions: ambientConditionsSchema.optional(),
})

export type IntakePayload = z.infer<typeof intakeSchema>

export const outcomeSchema = z.object({
  rootCause: z.string().min(10).max(2000),
  actionType: z.enum([
    'part_replacement',
    'repair',
    'adjustment',
    'cleaning',
    'no_fix',
    'referred',
  ]),
  partInfo: z
    .object({
      name: z.string().min(1),
      oemNumber: z.string().optional(),
      aftermarket: z.string().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
  verification: z.object({
    codesCleared: z.boolean(),
    testDrive: z.boolean(),
    symptomsResolved: z.enum(['yes', 'no', 'partial']),
  }),
  diagMinutes: z.number().nonnegative(),
  repairMinutes: z.number().nonnegative(),
  notes: z.string().max(2000).optional(),
  override: z
    .object({
      at: z.string().datetime({ offset: true }),
      lastFeedback: z.string(),
    })
    .optional(),
})

export type OutcomePayload = z.infer<typeof outcomeSchema>
