import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  mutateTicketJobAssignment,
  ticketActorFromProfile,
  ticketDomainStatus,
  type TicketDetail,
} from '@/lib/tickets'

const activeWorkStatuses = new Set(['open', 'in_progress', 'blocked'])
const approvalStates = new Set([
  'pending_quote', 'quote_ready', 'sent', 'approved', 'declined', 'deferred',
])

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function noStoreResponse(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function sameUuid(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase()
}

function assignmentEnvelope(input: {
  ticket: TicketDetail
  ticketId: string
  jobId: string
  actorProfileId: string
}) {
  if (!sameUuid(input.ticket.id, input.ticketId)) return null
  const job = input.ticket.jobs.find((candidate) => sameUuid(candidate.id, input.jobId))
  if (
    !job ||
    !activeWorkStatuses.has(job.workStatus) ||
    !approvalStates.has(job.approvalState)
  ) return null

  return {
    ticketId: input.ticketId,
    jobId: input.jobId,
    workStatus: job.workStatus as 'open' | 'in_progress' | 'blocked',
    state:
      job.assignedTechId !== null && sameUuid(job.assignedTechId, input.actorProfileId)
        ? 'mine' as const
        : job.assignedTechId === null
          ? 'unassigned' as const
          : 'team' as const,
    assignedTechName: job.assignedTech?.fullName ?? null,
    approvalState: job.approvalState as
      | 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined' | 'deferred',
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
    return noStoreJson({ error: 'unauthenticated' }, 401)
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return noStoreResponse(denied)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return noStoreJson({ error: 'invalid_json' }, 400)
  }

  const { id, jobId } = await params
  const result = await mutateTicketJobAssignment(db, {
    actor: ticketActorFromProfile(ctx.profile),
    ticketId: id,
    jobId,
    body,
  })
  if (!result.ok) {
    const error = result.warning
      ? { error: result.error, warning: result.warning }
      : result.error === 'assignment_conflict' && result.currentAssignee
        ? {
            error: result.error,
            currentAssignee: { fullName: result.currentAssignee.fullName },
          }
        : { error: result.error }
    return noStoreJson(error, ticketDomainStatus(result, 200))
  }
  const assignment = assignmentEnvelope({
    ticket: result.ticket,
    ticketId: id,
    jobId,
    actorProfileId: ctx.profile.id,
  })
  if (!assignment) {
    return noStoreJson({ error: 'invalid_assignment_result' }, 500)
  }
  return noStoreJson({ assignment }, 200)
}
