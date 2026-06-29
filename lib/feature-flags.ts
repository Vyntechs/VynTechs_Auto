export function isDesktopIntakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED === 'true'
}

// Gates DRAFT-ONLY cold-case system-data generation in the intake route AND
// inside executePipeline. OFF by default — when unset/!= 'true' no research run
// fires and no system_data_draft write occurs. Apply migration 0025 to the prod
// project (ynmtszuybeenjbigxdyl) before setting this to 'true' in prod.
export function isColdCaseSynthesisEnabled(): boolean {
  return process.env.COLD_CASE_SYNTHESIS_ENABLED === 'true'
}
