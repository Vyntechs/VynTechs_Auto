import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { readBoundedJson } from '@/lib/http/bounded-json'
import { checkRateLimit } from '@/lib/rate-limit'
import { CUSTOMER_APPROVAL_UNAVAILABLE, isCustomerApprovalEnabled } from '@/lib/release-policy'
import {
  loadCustomerApproval,
  recordCustomerApprovalResponse,
} from '@/lib/shop-os/customer-approval'

const PRIVACY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
} as const

function tokenFrom(req: Request): string {
  const authorization = req.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

function acceptsJson(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

function response(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...PRIVACY_HEADERS, ...headers },
  })
}

function clientIdentity(req: Request): string {
  // Vercel overwrites its forwarded-for header at ingress, so callers cannot
  // rotate bearer values to mint new persistent limiter buckets.
  for (const header of ['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip']) {
    const address = req.headers.get(header)?.split(',')[0]?.trim() ?? ''
    if (isIP(address)) return address.toLowerCase()
  }
  return 'unknown'
}

async function publicLimit(req: Request): Promise<NextResponse | null> {
  const key = createHash('sha256').update(clientIdentity(req)).digest('hex')
  let limit: Awaited<ReturnType<typeof checkRateLimit>>
  try {
    limit = await checkRateLimit(db, `public-quote-approval-ip:${key}`, 60)
  } catch {
    return response({ error: 'unavailable' }, 503)
  }
  if (limit.allowed) return null
  const retryAfter = Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1_000))
  return response({ error: 'unavailable' }, 429, { 'Retry-After': String(retryAfter) })
}

function resultStatus(result: { ok: boolean; error?: string }, changed = false): number {
  if (result.ok) return changed ? 201 : 200
  if (result.error === 'invalid_input') return 422
  if (result.error === 'conflict') return 409
  return 404
}

export async function GET(req: Request) {
  if (!isCustomerApprovalEnabled()) {
    return response(CUSTOMER_APPROVAL_UNAVAILABLE.body, CUSTOMER_APPROVAL_UNAVAILABLE.status)
  }
  const token = tokenFrom(req)
  const limited = await publicLimit(req)
  if (limited) return limited
  const result = await loadCustomerApproval(db, { token })
  if (result.ok) return response({ quote: result.quote }, 200)
  if (result.retryable) return response({ error: 'unavailable', retryable: true }, 503, { 'Retry-After': '1' })
  return response(
    { error: result.error === 'invalid_input' ? 'unavailable' : result.error },
    resultStatus(result),
  )
}

export async function POST(req: Request) {
  if (!isCustomerApprovalEnabled()) {
    return response(CUSTOMER_APPROVAL_UNAVAILABLE.body, CUSTOMER_APPROVAL_UNAVAILABLE.status)
  }
  const token = tokenFrom(req)
  const limited = await publicLimit(req)
  if (limited) return limited
  if (!acceptsJson(req)) return response({ error: 'unsupported_media_type' }, 415)
  const body = await readBoundedJson(req, 16 * 1024)
  if (!body.ok) {
    return response(
      { error: body.error },
      body.error === 'payload_too_large' ? 413 : 400,
    )
  }
  const result = await recordCustomerApprovalResponse(db, { token, body: body.value })
  if (!result.ok) {
    if (result.retryable) {
      return response({ error: 'unavailable', retryable: true }, 503, { 'Retry-After': '1' })
    }
    const error = result.error === 'invalid_input' ? 'invalid_input' : 'unavailable'
    return response({ error }, resultStatus(result))
  }
  return response(
    { changed: result.changed, receipt: result.receipt },
    resultStatus(result, result.changed),
  )
}
