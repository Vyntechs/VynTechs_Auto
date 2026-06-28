export function isDesktopIntakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED === 'true'
}

// Gates the DRAFT-ONLY cold-case system-data generation trigger in the intake
// route. OFF by default — when unset/!= 'true' the intake path is unchanged and
// no research run fires. MUST stay off in prod until migration 0025 is applied.
export function isColdCaseSynthesisEnabled(): boolean {
  return process.env.COLD_CASE_SYNTHESIS_ENABLED === 'true'
}
