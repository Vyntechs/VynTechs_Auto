export const CANONICAL_TECHNICIAN_HANDOFF_BASE_URL = 'http://127.0.0.1:4173'

export const TECHNICIAN_HANDOFF_FORBIDDEN_ENVIRONMENT = Object.freeze([
  'DATABASE_URL',
  'DATABASE_URL_DIRECT',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'BUZZ_RELAY_URL',
  'BUZZ_AUTH_TAG',
  'BUZZ_PRIVATE_KEY',
  'NOSTR_PRIVATE_KEY',
  'VERCEL_TOKEN',
])

export const TECHNICIAN_HANDOFF_PASSTHROUGH_ENVIRONMENT = Object.freeze([
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'CI',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_USE_SYSTEM_CHROME',
])

const forbiddenPrefix = /^(?:BUZZ_|NOSTR_|GOLDEN_QA_(?:OWNER|ADVISOR|TECH|RELIEF|PARTS)_)/

export function technicianHandoffEnvironment(
  environment = process.env,
  baseUrl = CANONICAL_TECHNICIAN_HANDOFF_BASE_URL,
) {
  const result = {}
  for (const name of TECHNICIAN_HANDOFF_PASSTHROUGH_ENVIRONMENT) {
    const value = environment[name]
    if (value === undefined) continue
    result[name] = value
  }
  result.TECHNICIAN_HANDOFF_BASE_URL = baseUrl
  return result
}

export function assertTechnicianHandoffHarnessSafety(
  environment = process.env,
  baseUrl = CANONICAL_TECHNICIAN_HANDOFF_BASE_URL,
) {
  if (baseUrl !== CANONICAL_TECHNICIAN_HANDOFF_BASE_URL) {
    throw new Error('technician handoff harness requires its canonical loopback URL')
  }
  if (environment.VERCEL_ENV === 'production') {
    throw new Error('technician handoff harness refuses production Vercel mode')
  }
  const present = Object.keys(environment).filter((name) => (
    TECHNICIAN_HANDOFF_FORBIDDEN_ENVIRONMENT.includes(name) || forbiddenPrefix.test(name)
  ))
  if (present.length > 0) {
    throw new Error(
      `technician handoff harness refuses forbidden environment names: ${present.join(', ')}`,
    )
  }
  return {
    baseUrl,
    loopback: true,
    productionVercelMode: false,
    forbiddenEnvironmentPresent: false,
  }
}
