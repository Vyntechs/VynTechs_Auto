import { z } from 'zod'

export const intakeSchema = z.object({
  vehicleYear: z.number().int().max(new Date().getFullYear() + 1),
  vehicleMake: z.string(),
  vehicleModel: z.string(),
  customerComplaint: z.string().min(5),
})

export type IntakePayload = z.infer<typeof intakeSchema>
