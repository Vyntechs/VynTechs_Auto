export const CANONICAL_TICKET_CORRECTION_BASE_URL: 'http://127.0.0.1:4181'

export function assertTicketCorrectionHarnessSafety(
  environment?: Record<string, string | undefined>,
  baseUrl?: string,
): {
  baseUrl: string
  loopback: true
  productionVercelMode: false
  forbiddenEnvironmentPresent: false
}
