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

function assignmentEnvelope(input: {
  ticket: TicketDetail
  ticketId: string
  jobId: string
  actorProfileId: string
}) {
  if (input.ticket.id !== input.ticketId) return null
  const job = input.ticket.jobs.find((candidate) => candidate.id === input.jobId)
  if (!job || !activeWorkStatuses.has(job.workStatus)) return null

  return {
    ticketId: input.ticketId,
    jobId: input.jobId,
    workStatus: job.workStatus as 'open' | 'in_progress' | 'blocked',
    state:
      job.assignedTechId === input.actorProfileId
        ? 'mine' as const
        : job.assignedTechId === null
          ? 'unassigned' as const
          : 'team' as const,
    assignedTechName: job.assignedTech?.fullName ?? null,
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
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
    return NextResponse.json(error, { status: ticketDomainStatus(result, 200) })
  }
  const assignment = assignmentEnvelope({
    ticket: result.ticket,
    ticketId: id,
    jobId,
    actorProfileId: ctx.profile.id,
  })
  if (!assignment) {
    return NextResponse.json({ error: 'invalid_assignment_result' }, { status: 500 })
  }
  return NextResponse.json({ assignment }, { status: 200 })
}
