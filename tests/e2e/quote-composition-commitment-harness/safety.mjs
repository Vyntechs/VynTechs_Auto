const FORBIDDEN_ENVIRONMENT = [
  'DATABASE_URL',
  'DATABASE_URL_DIRECT',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
]

export const CANONICAL_QUOTE_COMMITMENT_BASE_URL = 'http://127.0.0.1:4182'

export function assertQuoteCommitmentHarnessSafety(
  environment = process.env,
  baseUrl = CANONICAL_QUOTE_COMMITMENT_BASE_URL,
) {
  if (baseUrl !== CANONICAL_QUOTE_COMMITMENT_BASE_URL) {
    throw new Error('quote commitment harness requires its canonical loopback URL')
  }
  if (environment.VERCEL_ENV === 'production') {
    throw new Error('quote commitment harness refuses production Vercel mode')
  }
  const present = FORBIDDEN_ENVIRONMENT.filter((name) => (
    Object.prototype.hasOwnProperty.call(environment, name)
  ))
  if (present.length > 0) {
    throw new Error(`quote commitment harness refuses forbidden environment names: ${present.join(', ')}`)
  }
  return {
    baseUrl,
    loopback: true,
    productionVercelMode: false,
    forbiddenEnvironmentPresent: false,
  }
}
