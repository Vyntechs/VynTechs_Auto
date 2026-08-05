import {
  canAssignWork,
  canBuildQuotes,
  canCloseTickets,
  canRecordCustomerApproval,
  isShopRole,
} from '@/lib/shop-os/capabilities'
import { canUseManualWork } from '@/lib/shop-os/manual-work-policy'
import type { TodayTicketJob } from '@/lib/tickets'

export type LivingTicketJob = {
  id: string
  kind: string
  requiredSkillTier: number
  assignedTechId: string | null
  sessionId: string | null
  workStatus: string
  approvalState: string
  assignmentState?: 'mine' | 'team' | 'unassigned'
  clockedOnSince?: string | null
}

export type TechnicianJobReadiness =
  | { state: 'claimable'; label: 'Claim work' }
  | { state: 'below_tier'; label: `Requires ${string}` }
  | { state: 'waiting_quote'; label: 'Waiting for quote' }
  | { state: 'waiting_advisor'; label: 'Waiting for advisor' }
  | { state: 'waiting_customer'; label: 'Waiting for customer' }
  | { state: 'declined'; label: 'Customer declined' }
  | { state: 'review'; label: 'Review & start work' }
  | { state: 'running'; label: 'Clock running since'; clockedOnSince: string }
  | { state: 'paused'; label: 'Work in progress' }
  | { state: 'continue'; label: 'Continue work' }
  | { state: 'unavailable'; label: 'Review repair order' }

type TechnicianJobReadinessInput = {
  assignmentState: 'mine' | 'team' | 'unassigned'
  approvalState: TodayTicketJob['approvalState']
  workStatus: TodayTicketJob['workStatus']
  canClaim: boolean
  requiredSkillTier: number
  clockedOnSince: string | null
}

const shopTierLabel: Record<number, string> = {
  3: 'A-tech',
  2: 'B-tech',
  1: 'C-tech',
}

export function projectTechnicianJobReadiness(
  input: TechnicianJobReadinessInput,
): TechnicianJobReadiness {
  if (input.approvalState === 'declined') {
    return { state: 'declined', label: 'Customer declined' }
  }
  if (input.approvalState === 'deferred') {
    return { state: 'waiting_customer', label: 'Waiting for customer' }
  }
  if (input.workStatus === 'blocked') {
    return { state: 'unavailable', label: 'Review repair order' }
  }
  if (input.assignmentState === 'unassigned') {
    if (input.workStatus !== 'open') {
      return { state: 'unavailable', label: 'Review repair order' }
    }
    return input.canClaim
      ? { state: 'claimable', label: 'Claim work' }
      : {
          state: 'below_tier',
          label: `Requires ${shopTierLabel[input.requiredSkillTier] ?? `Tier ${input.requiredSkillTier}`}`,
        }
  }
  if (input.assignmentState !== 'mine') {
    return { state: 'unavailable', label: 'Review repair order' }
  }
  if (input.approvalState === 'pending_quote') {
    return { state: 'waiting_quote', label: 'Waiting for quote' }
  }
  if (input.approvalState === 'quote_ready') {
    return { state: 'waiting_advisor', label: 'Waiting for advisor' }
  }
  if (input.approvalState === 'sent') {
    return { state: 'waiting_customer', label: 'Waiting for customer' }
  }
  if (input.workStatus === 'open') {
    return { state: 'review', label: 'Review & start work' }
  }
  if (input.workStatus === 'in_progress' && input.clockedOnSince) {
    return {
      state: 'running',
      label: 'Clock running since',
      clockedOnSince: input.clockedOnSince,
    }
  }
  if (input.workStatus === 'in_progress') {
    return { state: 'paused', label: 'Work in progress' }
  }
  return { state: 'unavailable', label: 'Review repair order' }
}

export type LivingTicketCommand = {
  kind: 'assign' | 'claim' | 'handoff' | 'quote' | 'work' | 'resolve_hold' | 'cancel_job' | 'ring_out' | 'close'
  label: string
  jobId?: string
}

export type LivingTicketCommandGroup = {
  label: string
  commands: LivingTicketCommand[]
}

export type LivingTicketCommands = {
  primary: LivingTicketCommand | null
  primaryGroup: LivingTicketCommandGroup | null
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

const technicianApprovalStates = new Set<TodayTicketJob['approvalState']>([
  'pending_quote', 'quote_ready', 'sent', 'approved', 'declined', 'deferred',
])
const technicianWorkStatuses = new Set<TodayTicketJob['workStatus']>([
  'open', 'in_progress', 'blocked',
])
const claimableApprovalStates = new Set<TodayTicketJob['approvalState']>([
  'pending_quote', 'quote_ready', 'sent', 'approved',
])

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

function technicianReadiness(
  job: LivingTicketJob,
  profileId: string,
  skillTier: number | null,
): TechnicianJobReadiness {
  if (!technicianApprovalStates.has(job.approvalState as TodayTicketJob['approvalState'])
    || !technicianWorkStatuses.has(job.workStatus as TodayTicketJob['workStatus'])) {
    return { state: 'unavailable', label: 'Review repair order' }
  }
  const state = assignmentState(job, profileId)
  const approvalState = job.approvalState as TodayTicketJob['approvalState']
  const canClaim = state === 'unassigned'
    && job.workStatus === 'open'
    && skillTier !== null
    && skillTier >= job.requiredSkillTier
    && claimableApprovalStates.has(approvalState)
  return projectTechnicianJobReadiness({
    assignmentState: state,
    approvalState,
    workStatus: job.workStatus as TodayTicketJob['workStatus'],
    canClaim,
    requiredSkillTier: job.requiredSkillTier,
    clockedOnSince: job.clockedOnSince ?? null,
  })
}

function quoteCommands(input: Input, activeJobs: LivingTicketJob[]): RankedCommand[] {
  if (!canBuildQuotes(input.role)) return []

  const buildable = activeJobs.filter((job) => (
    job.approvalState === 'pending_quote'
      && (input.role !== 'tech' || assignmentState(job, input.profileId!) === 'mine')
  ))
  if (buildable.length > 0) {
    return buildable.map((job) => ({
      kind: 'quote' as const,
      jobId: job.id,
      label: 'Build ticket',
      rank: 30,
    }))
  }

  if (input.role === 'tech') return []

  const awaitsDecision = activeJobs.some((job) => (
    job.approvalState === 'quote_ready' || job.approvalState === 'sent' || job.approvalState === 'deferred'
  ))
  if (!awaitsDecision) return []
  return [{
    kind: 'quote',
    label: canCloseTickets(input.role) ? 'Record approval' : 'View quote',
    rank: 30,
  }]
}

export function projectLivingTicketCommands(input: Input): LivingTicketCommands {
  if (input.ticketStatus !== 'open' || !input.profileId || !isShopRole(input.role)) {
    return { primary: null, primaryGroup: null, secondary: [] }
  }

  const commands: RankedCommand[] = []
  const openJobs = input.jobs.filter((job) => job.workStatus === 'open')
  const activeJobs = input.jobs.filter((job) => (
    job.workStatus === 'open' || job.workStatus === 'in_progress' || job.workStatus === 'blocked'
  ))

  for (const job of activeJobs) {
    const state = assignmentState(job, input.profileId)
    const readiness = technicianReadiness(job, input.profileId, input.skillTier)
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
        label: job.workStatus === 'in_progress'
          ? 'Continue work'
          : readiness.state === 'review'
            ? readiness.label
            : 'Review & start work',
        rank: job.workStatus === 'in_progress' ? 0 : 20,
      })
    }
  }

  // Declined work still sitting on the board is what keeps a paid repair order
  // from closing, so retiring it outranks moving it around.
  if (canRecordCustomerApproval(input.role)) {
    for (const job of activeJobs) {
      if (job.approvalState === 'declined') {
        commands.push({ kind: 'cancel_job', jobId: job.id, label: 'Not doing this one', rank: 5 })
      }
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
      if (technicianReadiness(job, input.profileId, input.skillTier).state === 'claimable') {
        commands.push({ kind: 'claim', jobId: job.id, label: 'Claim work', rank: 40 })
      }
    }
  }

  commands.push(...quoteCommands(input, activeJobs))

  const allWorkTerminal = input.jobs.length > 0 && input.jobs.every((job) => (
    job.workStatus === 'done' || job.workStatus === 'canceled'
  ))
  if (allWorkTerminal && canCloseTickets(input.role) && input.ringOut) {
    commands.push(input.ringOut.balanceCents > 0
      ? { kind: 'ring_out', label: 'Take payment', rank: 50 }
      : { kind: 'close', label: 'Close it out', rank: 50 })
  }

  commands.sort((left, right) => left.rank - right.rank)
  const bestRank = commands[0]?.rank
  const bestRanked = bestRank === undefined
    ? []
    : commands.filter((command) => command.rank === bestRank)
  const jobIds = bestRanked.map((command) => command.jobId)
  const hasAmbiguousBestRank = bestRanked.length >= 2
    && jobIds.every((jobId): jobId is string => jobId !== undefined)
    && new Set(jobIds).size === bestRanked.length
  if (hasAmbiguousBestRank) {
    return {
      primary: null,
      primaryGroup: {
        label: `${bestRanked.length} jobs need attention`,
        commands: bestRanked.map(withoutRank),
      },
      secondary: commands.filter((command) => command.rank !== bestRank).map(withoutRank),
    }
  }

  const [primary, ...secondary] = commands
  return {
    primary: primary ? withoutRank(primary) : null,
    primaryGroup: null,
    secondary: secondary.map(withoutRank),
  }
}

function withoutRank(command: RankedCommand): LivingTicketCommand {
  const { rank: _rank, ...publicCommand } = command
  return publicCommand
}
