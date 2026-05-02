import { db } from '@/lib/db/client'
import { confidenceCalibration, type RiskClass } from '@/lib/db/schema'

const SEED: Array<{ riskClass: RiskClass; thresholdPct: number }> = [
  { riskClass: 'zero', thresholdPct: 0.0 },
  { riskClass: 'low', thresholdPct: 0.7 },
  { riskClass: 'medium', thresholdPct: 0.8 },
  { riskClass: 'high', thresholdPct: 0.9 },
  { riskClass: 'destructive', thresholdPct: 0.95 },
]

export async function seedCalibrationBaseline() {
  for (const row of SEED) {
    await db
      .insert(confidenceCalibration)
      .values({
        riskClass: row.riskClass,
        vehicleFamily: '*',
        symptomClass: '*',
        thresholdPct: row.thresholdPct,
      })
      .onConflictDoNothing()
  }
}

if (require.main === module) {
  seedCalibrationBaseline()
    .then(() => {
      console.log('calibration baseline seeded')
      process.exit(0)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
