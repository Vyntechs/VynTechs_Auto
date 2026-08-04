export const CANONICAL_TECHNICIAN_HANDOFF_BASE_URL: 'http://127.0.0.1:4173'
export const TECHNICIAN_HANDOFF_FORBIDDEN_ENVIRONMENT: readonly string[]

export function technicianHandoffEnvironment(
  environment?: Record<string, string | undefined>,
  baseUrl?: string,
): Record<string, string>

export function assertTechnicianHandoffHarnessSafety(
  environment?: Record<string, string | undefined>,
  baseUrl?: string,
): {
  baseUrl: string
  loopback: true
  productionVercelMode: false
  forbiddenEnvironmentPresent: false
}
