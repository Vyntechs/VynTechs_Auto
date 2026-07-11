import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  countOpenSessionsForTech,
  getOpenSessionForTech,
} from '@/lib/db/queries'
import { generateInitialDiagnosticTree } from '@/lib/diagnostics/initial-tree-bootstrap'
import { rateLimitReject } from '@/lib/rate-limit'
import { MAX_OPEN_SESSIONS_PER_TECH } from '@/lib/session-limits'
import {
  acquireDiagnosticStart,
  finalizeDiagnosticStart,
  recordDiagnosticStartFailure,
  type DiagnosticStartActor,
  type SettleDiagnosticStartResult,
} from '@/lib/shop-os/diagnostic-start'
import { getServerSupabase } from '@/lib/supabase-server'

export const maxDuration = 60

const requestSchema = z.object({
  attemptKey: z.uuid(),
  confirmAmbiguousRetry: z.boolean().optional(),
}).strict()

type Attempt = {
  actor: DiagnosticStartActor
  ticketId: string
  jobId: string
  attemptKey: string
}

function safeStateResponse(result: SettleDiagnosticStartResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error === 'not found' ? 'not_found' : 'start_unavailable' },
      { status: result.status },
    )
  }
  if (result.state === 'ready') {
    return NextResponse.json(
      { state: 'ready', sessionId: result.sessionId },
      { status: 200 },
    )
  }
  if (result.state === 'initializing') {
    return NextResponse.json(
      { state: 'initializing', retryAfterSeconds: 5 },
      { status: 202 },
    )
  }
  if (result.state === 'ambiguous') {
    return NextResponse.json(
      { state: 'ambiguous', warning: 'possible_duplicate_cost' },
      { status: 409 },
    )
  }
  return NextResponse.json(
    { state: 'failed', error: 'start_failed' },
    { status: 409 },
  )
}

function genericUnavailableResponse(): NextResponse {
  return NextResponse.json({ error: 'start_unavailable' }, { status: 500 })
}

async function recordFailure(
  attempt: Attempt,
  certainty: 'certain' | 'uncertain',
  errorCode: string,
): Promise<SettleDiagnosticStartResult | null> {
  try {
    return await recordDiagnosticStartFailure(db, {
      ...attempt,
      certainty,
      errorCode,
    })
  } catch {
    return null
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const { id, jobId } = await params
  const attempt = {
    actor: {
      profileId: ctx.profile.id,
      shopId: ctx.profile.shopId,
    },
    ticketId: id,
    jobId,
    attemptKey: parsed.data.attemptKey,
  }
  const acquired = await acquireDiagnosticStart(db, {
    ...attempt,
    confirmAmbiguousRetry: parsed.data.confirmAmbiguousRetry,
  })

  if (!acquired.ok || acquired.state !== 'initializing' || !acquired.leaseAcquired) {
    return safeStateResponse(acquired)
  }

  const limited = await rateLimitReject(db, `intake:${ctx.user.id}`, 10)
  if (limited) {
    const settled = await recordFailure(attempt, 'certain', 'rate_limited')
    if (!settled) return genericUnavailableResponse()
    return settled.ok && settled.state === 'failed'
      ? limited
      : safeStateResponse(settled)
  }

  const openCount = await countOpenSessionsForTech(db, ctx.profile.id)
  if (openCount >= MAX_OPEN_SESSIONS_PER_TECH) {
    const openSession = await getOpenSessionForTech(db, ctx.profile.id)
    const settled = await recordFailure(attempt, 'certain', 'open_session_limit')
    if (!settled) return genericUnavailableResponse()
    if (!(settled.ok && settled.state === 'failed')) return safeStateResponse(settled)
    return NextResponse.json(
      {
        error: 'open_session_limit',
        openSessionId: openSession?.id,
        limit: MAX_OPEN_SESSIONS_PER_TECH,
      },
      { status: 409 },
    )
  }

  let treeState
  try {
    treeState = await generateInitialDiagnosticTree(db, acquired.context.intake)
  } catch {
    const settled = await recordFailure(attempt, 'uncertain', 'initializer_outcome_uncertain')
    return settled ? safeStateResponse(settled) : genericUnavailableResponse()
  }

  try {
    return safeStateResponse(await finalizeDiagnosticStart(db, {
      ...attempt,
      sessionId: acquired.attemptKey,
      context: acquired.context,
      treeState,
    }))
  } catch {
    const settled = await recordFailure(attempt, 'uncertain', 'persistence_outcome_uncertain')
    return settled ? safeStateResponse(settled) : genericUnavailableResponse()
  }
}
