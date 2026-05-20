import { timingSafeEqual } from 'node:crypto'

export type CronAuthResult =
  | { kind: 'allow' }
  | { kind: 'deny'; status: number; error: string }

/**
 * Authorizes a Vercel Cron request against the configured CRON_SECRET.
 *
 * In production, an unset secret is fatal — the endpoint would otherwise
 * be open to the internet and trigger paid AI batch jobs. In dev/test,
 * an unset secret is allowed so `curl localhost:3000/api/cron/...` works
 * without setting the env.
 *
 * When the secret is set, the comparison is constant-time against header
 * length and bytes.
 */
export function authorizeCronRequest(opts: {
  authorizationHeader: string | null
  secret: string | undefined
  nodeEnv: string | undefined
}): CronAuthResult {
  const { authorizationHeader, secret, nodeEnv } = opts

  if (!secret) {
    if (nodeEnv === 'production') {
      return { kind: 'deny', status: 500, error: 'cron_secret_not_configured' }
    }
    return { kind: 'allow' }
  }

  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(authorizationHeader ?? '')
  if (actual.length !== expected.length) {
    return { kind: 'deny', status: 403, error: 'forbidden' }
  }
  if (!timingSafeEqual(actual, expected)) {
    return { kind: 'deny', status: 403, error: 'forbidden' }
  }
  return { kind: 'allow' }
}
