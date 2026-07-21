import {
  canAssignWork,
  canBuildQuotes,
  canCloseTickets,
  isShopRole,
} from '@/lib/shop-os/capabilities'
import { canUseManualWork } from '@/lib/shop-os/manual-work-policy'

export type LivingTicketJob = {
  id: string
  kind: string
  requiredSkillTier: number
  assignedTechId: string | null
  sessionId: string | null
  workStatus: string
  approvalState: string
  assignmentState?: 'mine' | 'team' | 'unassigned'
}

export type LivingTicketCommand = {
  kind: 'assign' | 'claim' | 'handoff' | 'quote' | 'work' | 'resolve_hold' | 'ring_out' | 'close'
  label: string
  jobId?: string
}

export type LivingTicketCommands = {
  primary: LivingTicketCommand | null
  secondary: LivingTicketCommand[]
}

type Input = {
  role: string
  profileId: string | null
  skillTier: number | null
  ticketStatus: string
  jobs: LivingTicketJob[]
  ringOut: { balanceCents: number; canClose: boolean } | null
  diagnosticsEntitled?: boolean
}

type RankedCommand = LivingTicketCommand & { rank: number }

function sameId(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && left.toLowerCase() === right.toLowerCase()
}

function assignmentState(
  job: LivingTicketJob,
  profileId: string,
): 'mine' | 'team' | 'unassigned' {
  if (job.assignmentState) return job.assignmentState
  if (job.assignedTechId === null) return 'unassigned'
  return sameId(job.assignedTechId, profileId) ? 'mine' : 'team'
}

function quoteCommand(input: Input, activeJobs: LivingTicketJob[]): RankedCommand | null {
  if (!canBuildQuotes(input.role)) return null
  const needsDraft = activeJobs.some((job) => job.approvalState === 'pending_quote')
  if (needsDraft) return { kind: 'quote', label: 'Build quote', rank: 30 }

  const awaitsDecision = activeJobs.some((job) => (
    job.approvalState === 'quote_ready' || job.approvalState === 'sent' || job.approvalState === 'deferred'
  ))
  if (!awaitsDecision) return null
  return {
    kind: 'quote',
    label: canCloseTickets(input.role) ? 'Record approval' : 'View quote',
    rank: 30,
  }
}

export function projectLivingTicketCommands(input: Input): LivingTicketCommands {
  if (input.ticketStatus !== 'open' || !input.profileId || !isShopRole(input.role)) {
    return { primary: null, secondary: [] }
  }

  const commands: RankedCommand[] = []
  const openJobs = input.jobs.filter((job) => job.workStatus === 'open')
  const activeJobs = input.jobs.filter((job) => (
    job.workStatus === 'open' || job.workStatus === 'in_progress' || job.workStatus === 'blocked'
  ))

  for (const job of activeJobs) {
    const state = assignmentState(job, input.profileId)
    const isOwnApprovedSimpleWork = state === 'mine'
      && job.approvalState === 'approved'
      && canUseManualWork({
        kind: job.kind,
        sessionId: job.sessionId,
        diagnosticsEntitled: input.diagnosticsEntitled ?? true,
      })
    if (isOwnApprovedSimpleWork && job.workStatus === 'blocked') {
      commands.push({
        kind: 'resolve_hold',
        jobId: job.id,
        label: 'Resolve hold',
        rank: 0,
      })
    }
    if (isOwnApprovedSimpleWork && (job.workStatus === 'open' || job.workStatus === 'in_progress')) {
      commands.push({
        kind: 'work',
        jobId: job.id,
        label: job.workStatus === 'in_progress' ? 'Continue work' : 'Start work',
        rank: job.workStatus === 'in_progress' ? 0 : 20,
      })
    }
  }

  if (canAssignWork(input.role)) {
    for (const job of activeJobs) {
      if (assignmentState(job, input.profileId) === 'unassigned') {
        if (job.workStatus === 'open') {
          commands.push({ kind: 'assign', jobId: job.id, label: 'Assign work', rank: 10 })
        }
      } else {
        commands.push({
          kind: 'handoff',
          jobId: job.id,
          label: 'Hand off',
          rank: job.workStatus === 'blocked' ? 10 : 60,
        })
      }
    }
  } else if (input.skillTier !== null && input.skillTier >= 1 && input.skillTier <= 3) {
    for (const job of openJobs) {
      if (assignmentState(job, input.profileId) === 'unassigned'
        && input.skillTier >= job.requiredSkillTier) {
        commands.push({ kind: 'claim', jobId: job.id, label: 'Claim work', rank: 40 })
      }
    }
  }

  const quote = quoteCommand(input, activeJobs)
  if (quote) commands.push(quote)

  const allWorkTerminal = input.jobs.length > 0 && input.jobs.every((job) => (
    job.workStatus === 'done' || job.workStatus === 'canceled'
  ))
  if (allWorkTerminal && canCloseTickets(input.role) && input.ringOut) {
    commands.push(input.ringOut.balanceCents > 0
      ? { kind: 'ring_out', label: 'Collect & close', rank: 50 }
      : { kind: 'close', label: 'Close repair order', rank: 50 })
  }

  commands.sort((left, right) => left.rank - right.rank)
  const [primary, ...secondary] = commands
  return {
    primary: primary ? withoutRank(primary) : null,
    secondary: secondary.map(withoutRank),
  }
}

function withoutRank(command: RankedCommand): LivingTicketCommand {
  const { rank: _rank, ...publicCommand } = command
  return publicCommand
}
