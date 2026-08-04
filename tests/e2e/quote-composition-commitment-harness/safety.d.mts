export const CANONICAL_QUOTE_COMMITMENT_BASE_URL: 'http://127.0.0.1:4182'

export function assertQuoteCommitmentHarnessSafety(
  environment?: Record<string, string | undefined>,
  baseUrl?: string,
): {
  baseUrl: string
  loopback: true
  productionVercelMode: false
  forbiddenEnvironmentPresent: false
}
