export function isDesktopIntakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED === 'true'
}
