'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TodayTicketJob, TodayTicketJobs } from '@/lib/tickets'
import type { TeamMember } from '@/lib/intake/team'
import { canUseManualWork } from '@/lib/shop-os/manual-work-policy'
import {
  createTodayJobOverride,
  parseAssignmentEnvelope,
  parseTodayJobsResponse,
  placeTodayJob,
  projectTodayBoard,
  type TodayJobOverride,
} from '@/lib/shop-os/today-board'
import { parsePartRequestResponse } from '@/lib/shop-os/part-requests-ui'
import type { SimpleWorkProjectionView } from '@/lib/shop-os/simple-work-ui'
import { TicketAssignmentControl } from './ticket-assignment-control'
import { InlineQuoteWorkspace, type QuoteWorkspaceProjection } from './inline-quote-workspace'
import { InlineWorkWorkspace } from './inline-work-workspace'
import { TicketInterruptionAction, type InterruptionJobView } from './ticket-interruption-action'
import styles from './today-jobs-board.module.css'

type Props = {
  myJobs: TodayTicketJob[]
  openJobs: TodayTicketJob[]
  teamJobs?: TodayTicketJob[]
  createdJobs?: TodayTicketJob[]
  partsJobs?: TodayTicketJob[]
  canDispatchWork?: boolean
  canBuildQuote?: boolean
  currentProfileId?: string
  team?: TeamMember[]
  hasMore?: boolean
  // Resolved server-side release availability. Fail closed so a missing prop
  // can never reopen a diagnostic-engine entrance.
  diagnosticsEntitled?: boolean
}

type Announcement = {
  kind: 'status' | 'error'
  text: string
}

type DiagnosticStartBody = {
  state?: unknown
  sessionId?: unknown
  warning?: unknown
}

const duplicateCostWarning =
  'This diagnostic may already have used a paid provider call. Starting again could create a duplicate cost.'
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const emptyJobs: TodayTicketJob[] = []
const emptyTeam: TeamMember[] = []

const titleCase: Record<TodayTicketJob['kind'], string> = {
  diagnostic: 'Diagnostic',
  repair: 'Repair',
  maintenance: 'Maintenance',
}

const statusLabel: Record<TodayTicketJob['workStatus'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
}

export function TodayJobsBoard({
  myJobs,
  openJobs,
  teamJobs = emptyJobs,
  createdJobs = emptyJobs,
  partsJobs = emptyJobs,
  canDispatchWork = false,
  canBuildQuote = false,
  currentProfileId,
  team = emptyTeam,
  hasMore = false,
  diagnosticsEntitled = false,
}: Props) {
  const router = useRouter()
  const boardRef = useRef<HTMLElement>(null)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [pendingDiagnosticJobId, setPendingDiagnosticJobId] = useState<string | null>(null)
  const [ambiguousJobStates, setAmbiguousJobStates] = useState<
    Map<string, TodayTicketJob['diagnosticStartState']>
  >(() => new Map())
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [jobOverrides, setJobOverrides] = useState<Map<string, TodayJobOverride>>(
    () => new Map(),
  )
  const [serverJobs, setServerJobs] = useState<TodayTicketJobs>(() => ({
    myJobs,
    openJobs,
    teamJobs,
    createdJobs,
    partsJobs,
    linkedSessionIds: [],
    hasMore,
  }))
  const [resolvedPartRequests, setResolvedPartRequests] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [activeQuoteJob, setActiveQuoteJob] = useState<TodayTicketJob | null>(null)
  const [activeWorkJob, setActiveWorkJob] = useState<TodayTicketJob | null>(null)
  const activeWorkspaceRef = useRef(false)
  const [focusRequest, setFocusRequest] = useState<{
    kind: 'board' | 'row' | 'claim'
    jobId: string
  } | null>(null)
  const claimButtons = useRef(new Map<string, HTMLButtonElement>())
  const diagnosticButtons = useRef(new Map<string, HTMLButtonElement>())
  const claimAttempts = useRef(new Map<string, string>())
  useEffect(() => {
    setServerJobs({
      myJobs,
      openJobs,
      teamJobs,
      createdJobs,
      partsJobs,
      linkedSessionIds: [],
      hasMore,
    })
  }, [myJobs, openJobs, teamJobs, createdJobs, partsJobs, hasMore])

  useEffect(() => {
    activeWorkspaceRef.current = activeQuoteJob !== null || activeWorkJob !== null
  }, [activeQuoteJob, activeWorkJob])

  const refreshTodayJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/today/jobs', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const body: unknown = await response.json().catch(() => null)
      const fresh = response.ok ? parseTodayJobsResponse(body) : null
      if (!fresh || activeWorkspaceRef.current) return
      setServerJobs(fresh)
      setResolvedPartRequests((current) => {
        if (current.size === 0) return current
        const active = new Map(fresh.partsJobs.map((job) => [job.id, job.partRequest?.id ?? null]))
        const next = new Map(current)
        for (const [jobId, requestId] of current) {
          if (active.get(jobId) !== requestId) next.delete(jobId)
        }
        return next
      })
    } catch {
      // The displayed server truth remains useful when a background refresh
      // misses. Do not interrupt a technician with a transient network toast.
    }
  }, [])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshTodayJobs()
    }
    const interval = window.setInterval(refreshWhenVisible, 20_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refreshTodayJobs])

  const board = useMemo(() => projectTodayBoard({
    myJobs: serverJobs.myJobs,
    openJobs: serverJobs.openJobs,
    teamJobs: serverJobs.teamJobs,
    createdJobs: serverJobs.createdJobs,
    partsJobs: serverJobs.partsJobs.filter((job) => (
      !job.partRequest || resolvedPartRequests.get(job.id) !== job.partRequest.id
    )),
    canDispatchWork,
    overrides: jobOverrides,
  }), [serverJobs, resolvedPartRequests, canDispatchWork, jobOverrides])

  useEffect(() => {
    if (!focusRequest) return
    const movedRow = Array.from(
      boardRef.current?.querySelectorAll<HTMLElement>('[data-job-id]') ?? [],
    ).find((element) => element.dataset.jobId === focusRequest.jobId)
    const focusTarget = focusRequest.kind === 'board'
      ? boardRef.current
      : focusRequest.kind === 'row'
        ? movedRow
        : claimButtons.current.get(focusRequest.jobId)
    focusTarget?.focus()
    setFocusRequest(null)
  }, [focusRequest, board])

  function applyJobTruth(before: TodayTicketJob, after: TodayTicketJob) {
    setJobOverrides((current) => new Map(current).set(
      before.id,
      createTodayJobOverride(before, after),
    ))
  }

  async function claim(job: TodayTicketJob) {
    if (pendingJobId) return
    const requestKey = claimAttempts.current.get(job.id) ?? crypto.randomUUID()
    claimAttempts.current.set(job.id, requestKey)
    let returnFocusToBoard = false
    let returnFocusToRow = false

    setPendingJobId(job.id)
    setAnnouncement({ kind: 'status', text: `Claiming ticket ${job.ticketNumber}.` })

    try {
      const response = await fetch(
        `/api/tickets/${job.ticketId}/jobs/${job.id}/assignment`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'claim', requestKey }),
        },
      )

      const body: unknown = await response.json().catch(() => ({}))
      if (response.ok) {
        const assignment = parseAssignmentEnvelope(body, {
          ticketId: job.ticketId,
          jobId: job.id,
        })
        if (!assignment) {
          applyJobTruth(job, { ...job, canClaim: false })
          setAnnouncement({
            kind: 'error',
            text: `Ticket ${job.ticketNumber} changed, but this screen couldn't safely reconcile it. View the ticket.`,
          })
          returnFocusToRow = true
          return
        }
        const updatedJob: TodayTicketJob = {
          ...job,
          workStatus: assignment.workStatus,
          assignmentState: assignment.state,
          assignedTechName: assignment.assignedTechName,
          canClaim: false,
        }
        applyJobTruth(job, updatedJob)
        claimAttempts.current.delete(job.id)
        setAnnouncement({
          kind: 'status',
          text: assignment.state === 'mine'
            ? `Ticket ${job.ticketNumber} claimed.`
            : `Ticket ${job.ticketNumber} assignment updated.`,
        })
        const lane = placeTodayJob(updatedJob, canDispatchWork)
        returnFocusToBoard = lane === 'hidden'
        returnFocusToRow = lane !== 'hidden'
        return
      }

      if (
        response.status === 409 &&
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        body.error === 'assignment_conflict'
      ) {
        const currentAssignee = 'currentAssignee' in body &&
          typeof body.currentAssignee === 'object' &&
          body.currentAssignee !== null
          ? body.currentAssignee
          : null
        const winner = currentAssignee && 'fullName' in currentAssignee
          ? currentAssignee.fullName
          : null
        const trimmedWinner = typeof winner === 'string' ? winner.trim() : ''
        const safeWinner = trimmedWinner.length > 0 && trimmedWinner.length <= 120
          ? trimmedWinner
          : null
        const updatedJob: TodayTicketJob = {
          ...job,
          assignmentState: 'team',
          assignedTechName: safeWinner,
          canClaim: false,
        }
        applyJobTruth(job, updatedJob)
        setAnnouncement({
          kind: 'status',
          text: safeWinner
            ? `Already claimed by ${safeWinner}.`
            : 'This job was already claimed.',
        })
        const lane = placeTodayJob(updatedJob, canDispatchWork)
        returnFocusToBoard = lane === 'hidden'
        returnFocusToRow = lane !== 'hidden'
        return
      }

      throw new Error('claim_failed')
    } catch {
      setAnnouncement({
        kind: 'error',
        text: `Couldn't claim ticket ${job.ticketNumber}. Try again.`,
      })
    } finally {
      setPendingJobId(null)
      setFocusRequest({
        kind: returnFocusToBoard ? 'board' : returnFocusToRow ? 'row' : 'claim',
        jobId: job.id,
      })
    }
  }

  async function resolvePart(job: TodayTicketJob) {
    const request = job.partRequest
    if (!request) return
    if (pendingJobId) return

    setPendingJobId(job.id)
    setAnnouncement({ kind: 'status', text: `Marking parts found for ticket ${job.ticketNumber}.` })
    try {
      const response = await fetch(
        `/api/tickets/${job.ticketId}/part-requests/${request.id}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'sourced' }),
        },
      )
      const body: unknown = await response.json().catch(() => null)
      const resolved = response.ok ? parsePartRequestResponse(body) : null
      if (!resolved || resolved.id !== request.id || resolved.status !== 'sourced') {
        throw new Error('part_request_not_resolved')
      }
      setResolvedPartRequests((current) => new Map(current).set(job.id, request.id))
      setAnnouncement({ kind: 'status', text: `Parts found for ticket ${job.ticketNumber}.` })
      void refreshTodayJobs()
    } catch {
      setAnnouncement({
        kind: 'error',
        text: `Couldn't mark parts found for ticket ${job.ticketNumber}. Try again.`,
      })
    } finally {
      setPendingJobId(null)
    }
  }

  function applyAssignment(job: TodayTicketJob, assignment: {
    workStatus: TodayTicketJob['workStatus']
    state: TodayTicketJob['assignmentState']
    assignedTechName: string | null
  }) {
    const updatedJob: TodayTicketJob = {
      ...job,
      workStatus: assignment.workStatus,
      assignmentState: assignment.state,
      assignedTechName: assignment.assignedTechName,
      canClaim: false,
    }
    applyJobTruth(job, updatedJob)
    setAnnouncement({
      kind: 'status',
      text: assignment.state === 'unassigned'
        ? `Ticket ${job.ticketNumber} is available.`
        : assignment.assignedTechName
          ? `Ticket ${job.ticketNumber} assigned to ${assignment.assignedTechName}.`
          : `Ticket ${job.ticketNumber} handoff saved.`,
    })
    setFocusRequest({
      kind: placeTodayJob(updatedJob, canDispatchWork) === 'hidden' ? 'board' : 'row',
      jobId: job.id,
    })
    void refreshTodayJobs()
  }

  function applyAssignmentConflict(job: TodayTicketJob, assignedTechName: string) {
    const updatedJob: TodayTicketJob = {
      ...job,
      assignmentState: 'team',
      assignedTechName,
      canClaim: false,
    }
    applyJobTruth(job, updatedJob)
    setAnnouncement({ kind: 'status', text: `Already assigned to ${assignedTechName}.` })
    setFocusRequest({
      kind: placeTodayJob(updatedJob, canDispatchWork) === 'hidden' ? 'board' : 'row',
      jobId: job.id,
    })
    void refreshTodayJobs()
  }

  const applyQuoteProjection = useCallback((projection: QuoteWorkspaceProjection) => {
    const byJobId = new Map(projection.map((job) => [job.id, job]))
    const update = (job: TodayTicketJob) => {
      const next = byJobId.get(job.id)
      if (!next || (
        job.workStatus === next.workStatus && job.approvalState === next.approvalState
      )) return job
      return { ...job, workStatus: next.workStatus, approvalState: next.approvalState }
    }
    setServerJobs((current) => {
      const myJobs = current.myJobs.map(update)
      const openJobs = current.openJobs.map(update)
      const teamJobs = current.teamJobs.map(update)
      const createdJobs = current.createdJobs.map(update)
      const partsJobs = current.partsJobs.map(update)
      const changed = myJobs.some((job, index) => job !== current.myJobs[index])
        || openJobs.some((job, index) => job !== current.openJobs[index])
        || teamJobs.some((job, index) => job !== current.teamJobs[index])
        || createdJobs.some((job, index) => job !== current.createdJobs[index])
        || partsJobs.some((job, index) => job !== current.partsJobs[index])
      return changed
        ? { ...current, myJobs, openJobs, teamJobs, createdJobs, partsJobs }
        : current
    })
    setActiveQuoteJob((current) => current ? update(current) : current)
  }, [])

  function applyWorkProjection(job: TodayTicketJob, work: SimpleWorkProjectionView) {
    // A completed job naturally leaves Today on the next refresh. Keep the
    // mounted workspace stable until the technician closes it, rather than
    // making the confirmation disappear mid-task.
    if (work.status === 'open' || work.status === 'in_progress') {
      const workStatus: TodayTicketJob['workStatus'] = work.status
      setServerJobs((current) => {
        const update = (candidate: TodayTicketJob) => candidate.id === job.id
          ? { ...candidate, workStatus }
          : candidate
        return {
          ...current,
          myJobs: current.myJobs.map(update),
          openJobs: current.openJobs.map(update),
          teamJobs: current.teamJobs.map(update),
          createdJobs: current.createdJobs.map(update),
          partsJobs: current.partsJobs.map(update),
        }
      })
    }
  }

  function applyResolvedHold(job: TodayTicketJob, resolved: InterruptionJobView) {
    if (resolved.id !== job.id || (
      resolved.workStatus !== 'open' && resolved.workStatus !== 'in_progress'
    )) return
    const workStatus: TodayTicketJob['workStatus'] = resolved.workStatus
    const update = (candidate: TodayTicketJob) => candidate.id === job.id
      ? { ...candidate, workStatus }
      : candidate
    setServerJobs((current) => ({
      ...current,
      myJobs: current.myJobs.map(update),
      openJobs: current.openJobs.map(update),
      teamJobs: current.teamJobs.map(update),
      createdJobs: current.createdJobs.map(update),
      partsJobs: current.partsJobs.map(update),
    }))
    setAnnouncement({ kind: 'status', text: `Hold resolved for ticket ${job.ticketNumber}.` })
    void refreshTodayJobs()
  }

  function applyInterruptedWork(job: TodayTicketJob, interrupted: InterruptionJobView) {
    if (interrupted.id !== job.id || interrupted.workStatus !== 'blocked') return
    const update = (candidate: TodayTicketJob) => candidate.id === job.id
      ? { ...candidate, workStatus: 'blocked' as const }
      : candidate
    setServerJobs((current) => ({
      ...current,
      myJobs: current.myJobs.map(update),
      openJobs: current.openJobs.map(update),
      teamJobs: current.teamJobs.map(update),
      createdJobs: current.createdJobs.map(update),
      partsJobs: current.partsJobs.map(update),
    }))
    activeWorkspaceRef.current = false
    setActiveWorkJob(null)
    setAnnouncement({ kind: 'status', text: `Work on hold for ticket ${job.ticketNumber}.` })
    setFocusRequest({ kind: 'row', jobId: job.id })
    void refreshTodayJobs()
  }

  function closeQuote(job: TodayTicketJob) {
    activeWorkspaceRef.current = false
    setActiveQuoteJob(null)
    setFocusRequest({ kind: 'row', jobId: job.id })
    void refreshTodayJobs()
  }

  function closeWork(job: TodayTicketJob) {
    activeWorkspaceRef.current = false
    setActiveWorkJob(null)
    setFocusRequest({ kind: 'board', jobId: job.id })
    void refreshTodayJobs()
  }

  async function startDiagnostic(
    job: TodayTicketJob,
    confirmAmbiguousRetry = false,
    statusOnly = false,
  ) {
    if (pendingDiagnosticJobId) return

    setPendingDiagnosticJobId(job.id)
    setAnnouncement({
      kind: 'status',
      text: statusOnly
        ? `Checking diagnosis status for ticket ${job.ticketNumber}.`
        : `Starting diagnosis for ticket ${job.ticketNumber}.`,
    })

    try {
      const payload = {
        attemptKey: crypto.randomUUID(),
        ...(confirmAmbiguousRetry ? { confirmAmbiguousRetry: true } : {}),
        ...(statusOnly ? { statusOnly: true } : {}),
      }
      const response = await fetch(
        `/api/tickets/${job.ticketId}/jobs/${job.id}/diagnostic/start`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const body = await response.json().catch(() => ({})) as DiagnosticStartBody

      if (
        response.status === 200 &&
        body.state === 'ready' &&
        typeof body.sessionId === 'string' &&
        uuidPattern.test(body.sessionId)
      ) {
        setAmbiguousJobStates((current) => {
          const next = new Map(current)
          next.delete(job.id)
          return next
        })
        setAnnouncement({
          kind: 'status',
          text: `Diagnosis ready for ticket ${job.ticketNumber}. Opening now.`,
        })
        router.push(`/sessions/${body.sessionId}`)
        return
      }

      if (response.status === 202 && body.state === 'initializing') {
        setAmbiguousJobStates((current) => {
          const next = new Map(current)
          next.delete(job.id)
          return next
        })
        setAnnouncement({
          kind: 'status',
          text: statusOnly
            ? 'Diagnosis is still starting. Refreshing status.'
            : 'Diagnosis is already starting. Refreshing status.',
        })
        router.refresh()
        return
      }

      if (statusOnly && response.status === 409 && body.state === 'failed') {
        setAmbiguousJobStates((current) => {
          const next = new Map(current)
          next.delete(job.id)
          return next
        })
        setAnnouncement({
          kind: 'status',
          text: 'Diagnosis did not start. Refreshing status.',
        })
        router.refresh()
        return
      }

      if (
        response.status === 409 &&
        body.state === 'ambiguous' &&
        body.warning === 'possible_duplicate_cost'
      ) {
        setAmbiguousJobStates((current) => new Map(current).set(
          job.id,
          job.diagnosticStartState ?? 'idle',
        ))
        setAnnouncement({
          kind: 'status',
          text: `Diagnosis start for ticket ${job.ticketNumber} needs confirmation.`,
        })
        return
      }

      setAmbiguousJobStates((current) => {
        const next = new Map(current)
        next.delete(job.id)
        return next
      })
      throw new Error('diagnostic_start_failed')
    } catch {
      setAnnouncement({
        kind: 'error',
        text: `Couldn't start diagnosis for ticket ${job.ticketNumber}. Try again.`,
      })
    } finally {
      setPendingDiagnosticJobId(null)
      requestAnimationFrame(() => diagnosticButtons.current.get(job.id)?.focus())
    }
  }

  const inlineWorkspaceProps = {
    canBuildQuote,
    onOpenQuote: setActiveQuoteJob,
    activeQuoteJobId: activeQuoteJob?.id,
    onCloseQuote: closeQuote,
    onQuoteProjection: applyQuoteProjection,
    activeWorkJobId: activeWorkJob?.id,
    onOpenWork: setActiveWorkJob,
    onCloseWork: closeWork,
    onWorkProjection: applyWorkProjection,
    onInterrupted: applyInterruptedWork,
    onResolveHold: applyResolvedHold,
  }

  return (
    <section
      ref={boardRef}
      className={styles.board}
      aria-label="Ticket jobs"
      tabIndex={-1}
      data-empty={
        board.mine.length === 0 &&
        board.open.length === 0 &&
        board.team.length === 0 &&
        board.created.length === 0 &&
        board.parts.length === 0 &&
        !announcement
      }
    >
      {board.mine.length > 0 && (
        <JobSection
          label="My work"
          jobs={board.mine}
          mode="mine"
          pendingDiagnosticJobId={pendingDiagnosticJobId}
          diagnosticsDisabled={pendingDiagnosticJobId !== null}
          diagnosticsEntitled={diagnosticsEntitled}
          ambiguousJobStates={ambiguousJobStates}
          onStartDiagnostic={startDiagnostic}
          onRefreshDiagnostic={() => router.refresh()}
          onCheckDiagnostic={(job) => startDiagnostic(job, false, true)}
          setDiagnosticButton={(jobId, element) => {
            if (element) diagnosticButtons.current.set(jobId, element)
            else diagnosticButtons.current.delete(jobId)
          }}
          canDispatchWork={canDispatchWork}
          currentProfileId={currentProfileId}
          team={team}
          onAssignment={applyAssignment}
          onAssignmentConflict={applyAssignmentConflict}
          onResolvePart={resolvePart}
          partsDisabled={pendingJobId !== null}
          {...inlineWorkspaceProps}
        />
      )}
      {board.open.length > 0 && (
        <JobSection
          label={canDispatchWork ? 'Needs assignment' : 'Available'}
          jobs={board.open}
          mode="open"
          pendingJobId={pendingJobId}
          claimsDisabled={pendingJobId !== null}
          onClaim={claim}
          setClaimButton={(jobId, element) => {
            if (element) claimButtons.current.set(jobId, element)
            else claimButtons.current.delete(jobId)
          }}
          canDispatchWork={canDispatchWork}
          currentProfileId={currentProfileId}
          team={team}
          onAssignment={applyAssignment}
          onAssignmentConflict={applyAssignmentConflict}
          onResolvePart={resolvePart}
          partsDisabled={pendingJobId !== null}
          {...inlineWorkspaceProps}
        />
      )}
      {board.team.length > 0 && (
        <JobSection
          label="With the team"
          jobs={board.team}
          mode="team"
          canDispatchWork={canDispatchWork}
          currentProfileId={currentProfileId}
          team={team}
          onAssignment={applyAssignment}
          onAssignmentConflict={applyAssignmentConflict}
          onResolvePart={resolvePart}
          partsDisabled={pendingJobId !== null}
          {...inlineWorkspaceProps}
        />
      )}
      {board.created.length > 0 && (
        <JobSection
          label="Created by me"
          jobs={board.created}
          mode="created"
          canDispatchWork={canDispatchWork}
          currentProfileId={currentProfileId}
          team={team}
          onAssignment={applyAssignment}
          onAssignmentConflict={applyAssignmentConflict}
          onResolvePart={resolvePart}
          partsDisabled={pendingJobId !== null}
          {...inlineWorkspaceProps}
        />
      )}
      {board.parts.length > 0 && (
        <JobSection
          label="Parts needed"
          jobs={board.parts}
          mode="parts"
          canDispatchWork={canDispatchWork}
          currentProfileId={currentProfileId}
          team={team}
          onAssignment={applyAssignment}
          onAssignmentConflict={applyAssignmentConflict}
          onResolvePart={resolvePart}
          partsDisabled={pendingJobId !== null}
          {...inlineWorkspaceProps}
        />
      )}
      {serverJobs.hasMore && (
        <p className={styles.announcement} role="status">
          Showing the first 200 active jobs. Assigned work appears first; remaining work stays stored.
        </p>
      )}
      {announcement && (
        <p
          className={styles.announcement}
          role={announcement.kind === 'error' ? 'alert' : 'status'}
          aria-live={announcement.kind === 'error' ? 'assertive' : 'polite'}
        >
          {announcement.text}
        </p>
      )}
    </section>
  )
}

function JobSection({
  label,
  jobs,
  mode,
  pendingJobId = null,
  claimsDisabled = false,
  onClaim,
  setClaimButton,
  pendingDiagnosticJobId = null,
  diagnosticsDisabled = false,
  diagnosticsEntitled = false,
  ambiguousJobStates = new Map(),
  onStartDiagnostic,
  onRefreshDiagnostic,
  onCheckDiagnostic,
  setDiagnosticButton,
  canDispatchWork = false,
  currentProfileId,
  team = [],
  onAssignment,
  onAssignmentConflict,
  onResolvePart,
  partsDisabled = false,
  canBuildQuote = false,
  onOpenQuote,
  activeQuoteJobId,
  onCloseQuote,
  onQuoteProjection,
  activeWorkJobId,
  onOpenWork,
  onCloseWork,
  onWorkProjection,
  onInterrupted,
  onResolveHold,
}: {
  label: string
  jobs: TodayTicketJob[]
  mode: 'mine' | 'open' | 'team' | 'created' | 'parts'
  pendingJobId?: string | null
  claimsDisabled?: boolean
  onClaim?: (job: TodayTicketJob) => void
  setClaimButton?: (jobId: string, element: HTMLButtonElement | null) => void
  pendingDiagnosticJobId?: string | null
  diagnosticsDisabled?: boolean
  diagnosticsEntitled?: boolean
  ambiguousJobStates?: Map<string, TodayTicketJob['diagnosticStartState']>
  onStartDiagnostic?: (job: TodayTicketJob, confirmAmbiguousRetry?: boolean) => void
  onRefreshDiagnostic?: () => void
  onCheckDiagnostic?: (job: TodayTicketJob) => void
  setDiagnosticButton?: (jobId: string, element: HTMLButtonElement | null) => void
  canDispatchWork?: boolean
  currentProfileId?: string
  team?: TeamMember[]
  onAssignment?: (job: TodayTicketJob, assignment: {
    workStatus: TodayTicketJob['workStatus']
    state: TodayTicketJob['assignmentState']
    assignedTechName: string | null
  }) => void
  onAssignmentConflict?: (job: TodayTicketJob, assignedTechName: string) => void
  onResolvePart?: (job: TodayTicketJob) => void
  partsDisabled?: boolean
  canBuildQuote?: boolean
  onOpenQuote?: (job: TodayTicketJob) => void
  activeQuoteJobId?: string
  onCloseQuote?: (job: TodayTicketJob) => void
  onQuoteProjection?: (projection: QuoteWorkspaceProjection) => void
  activeWorkJobId?: string
  onOpenWork?: (job: TodayTicketJob) => void
  onCloseWork?: (job: TodayTicketJob) => void
  onWorkProjection?: (job: TodayTicketJob, work: SimpleWorkProjectionView) => void
  onInterrupted?: (job: TodayTicketJob, interrupted: InterruptionJobView) => void
  onResolveHold?: (job: TodayTicketJob, resolved: InterruptionJobView) => void
}) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <h2 className={styles.heading}>{label}</h2>
        <span className={styles.count}>{jobs.length}</span>
      </div>
      <div className={styles.ledger}>
        {jobs.map((job) => (
          <div key={job.id} className={styles.jobSlot}>
            <JobRow
              job={job}
              mode={mode}
              pending={pendingJobId === job.id}
              claimDisabled={claimsDisabled}
              onClaim={onClaim}
              setClaimButton={setClaimButton}
              diagnosticPending={pendingDiagnosticJobId === job.id}
              diagnosticDisabled={diagnosticsDisabled}
              diagnosticsEntitled={diagnosticsEntitled}
              forceAmbiguous={
                ambiguousJobStates.get(job.id) === (job.diagnosticStartState ?? 'idle')
              }
              onStartDiagnostic={onStartDiagnostic}
              onRefreshDiagnostic={onRefreshDiagnostic}
              onCheckDiagnostic={onCheckDiagnostic}
              setDiagnosticButton={setDiagnosticButton}
              canDispatchWork={canDispatchWork}
              currentProfileId={currentProfileId}
              team={team}
              onAssignment={onAssignment}
              onAssignmentConflict={onAssignmentConflict}
              onResolvePart={onResolvePart}
              partsDisabled={partsDisabled}
              canBuildQuote={canBuildQuote}
              onOpenQuote={onOpenQuote}
              commandBusy={activeQuoteJobId !== undefined || activeWorkJobId !== undefined}
              onOpenWork={onOpenWork}
              onResolveHold={onResolveHold}
            />
            {activeQuoteJobId === job.id && currentProfileId && (
              <div className={styles.workspacePanel}>
                <InlineQuoteWorkspace
                  actorId={currentProfileId}
                  ticket={{
                    id: job.ticketId,
                    ticketNumber: job.ticketNumber,
                    concern: job.concern,
                    customer: job.customerName ? { name: job.customerName } : null,
                    vehicle: job.vehicle,
                  }}
                  onProjection={onQuoteProjection ?? (() => {})}
                  onClose={() => onCloseQuote?.(job)}
                />
              </div>
            )}
            {activeWorkJobId === job.id && currentProfileId && job.customerName && job.vehicle && (
              <div className={styles.workspacePanel}>
                <InlineWorkWorkspace
                  actorProfileId={currentProfileId}
                  ticket={{
                    id: job.ticketId,
                    number: job.ticketNumber,
                    customerName: job.customerName,
                    vehicle: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`,
                  }}
                  jobId={job.id}
                  onProjection={(work) => onWorkProjection?.(job, work)}
                  onInterrupted={(interrupted) => onInterrupted?.(job, interrupted)}
                  onClose={() => onCloseWork?.(job)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function JobRow({
  job,
  mode,
  pending,
  claimDisabled,
  onClaim,
  setClaimButton,
  diagnosticPending,
  diagnosticDisabled,
  diagnosticsEntitled,
  forceAmbiguous,
  onStartDiagnostic,
  onRefreshDiagnostic,
  onCheckDiagnostic,
  setDiagnosticButton,
  canDispatchWork,
  currentProfileId,
  team,
  onAssignment,
  onAssignmentConflict,
  onResolvePart,
  partsDisabled,
  canBuildQuote,
  onOpenQuote,
  commandBusy,
  onOpenWork,
  onResolveHold,
}: {
  job: TodayTicketJob
  mode: 'mine' | 'open' | 'team' | 'created' | 'parts'
  pending: boolean
  claimDisabled: boolean
  onClaim?: (job: TodayTicketJob) => void
  setClaimButton?: (jobId: string, element: HTMLButtonElement | null) => void
  diagnosticPending: boolean
  diagnosticDisabled: boolean
  diagnosticsEntitled?: boolean
  forceAmbiguous: boolean
  onStartDiagnostic?: (job: TodayTicketJob, confirmAmbiguousRetry?: boolean) => void
  onRefreshDiagnostic?: () => void
  onCheckDiagnostic?: (job: TodayTicketJob) => void
  setDiagnosticButton?: (jobId: string, element: HTMLButtonElement | null) => void
  canDispatchWork?: boolean
  currentProfileId?: string
  team?: TeamMember[]
  onAssignment?: (job: TodayTicketJob, assignment: {
    workStatus: TodayTicketJob['workStatus']
    state: TodayTicketJob['assignmentState']
    assignedTechName: string | null
  }) => void
  onAssignmentConflict?: (job: TodayTicketJob, assignedTechName: string) => void
  onResolvePart?: (job: TodayTicketJob) => void
  partsDisabled?: boolean
  canBuildQuote?: boolean
  onOpenQuote?: (job: TodayTicketJob) => void
  commandBusy?: boolean
  onOpenWork?: (job: TodayTicketJob) => void
  onResolveHold?: (job: TodayTicketJob, resolved: InterruptionJobView) => void
}) {
  const vehicle = job.vehicle
    ? `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`
    : 'Vehicle not recorded'
  const manualDiagnosticWorkAvailable = job.approvalState === 'approved'
    && canUseManualWork({
      kind: job.kind,
      sessionId: job.sessionId,
      diagnosticsEntitled: diagnosticsEntitled ?? true,
    })

  return (
    <article
      className={styles.row}
      aria-label={`Ticket ${job.ticketNumber}: ${job.title}`}
      data-job-id={job.id}
      tabIndex={-1}
    >
      <Link
        href={`/tickets/${job.ticketId}`}
        className={styles.ticketStamp}
        aria-label={`Open ticket ${job.ticketNumber}`}
      >
        #{String(job.ticketNumber).padStart(4, '0')}
      </Link>
      <div className={styles.details}>
        <div className={styles.partyLine}>
          <span>{job.customerName ?? 'Customer not recorded'}</span>
          <span aria-hidden="true">·</span>
          <span>{vehicle}</span>
        </div>
        <h3 className={styles.title}>{job.title}</h3>
        {mode === 'parts' && job.partRequest && (
          <p className={styles.partsNote}>
            Needs {job.partRequest.quantity}× {job.partRequest.description}
            {job.partRequest.preference ? ` · ${job.partRequest.preference}` : ''}
          </p>
        )}
        <div className={styles.facts}>
          <span>{titleCase[job.kind]}</span>
          <span>Tier {job.requiredSkillTier}</span>
          <span>{statusLabel[job.workStatus]}</span>
          {(mode === 'team' || mode === 'created') && job.assignedTechName && (
            <span>{job.assignedTechName}</span>
          )}
        </div>
      </div>
      <div className={styles.action}>
        {mode === 'open' && job.workStatus === 'open' && job.canClaim
          && (!canDispatchWork || !currentProfileId) ? (
          <button
            ref={(element) => setClaimButton?.(job.id, element)}
            type="button"
            className={`${styles.control} ${styles.claim}`}
            disabled={claimDisabled}
            onClick={() => onClaim?.(job)}
          >
            {pending ? 'Claiming…' : 'Claim job'}
          </button>
        ) : canDispatchWork && currentProfileId && (
          mode === 'open' || (mode === 'team' && (
            job.approvalState !== 'pending_quote' || !canBuildQuote
          ))
        ) ? (
          <TicketAssignmentControl
            ticketId={job.ticketId}
            job={{
              id: job.id,
              requiredSkillTier: job.requiredSkillTier,
              hasAssignee: job.assignmentState !== 'unassigned',
              workStatus: job.workStatus,
            }}
            command={{
              kind: mode === 'open' ? 'assign' : 'handoff',
              jobId: job.id,
              label: mode === 'open' ? 'Assign work' : 'Hand off',
            }}
            team={team ?? []}
            currentProfileId={currentProfileId}
            onApplied={(assignment) => onAssignment?.(job, assignment)}
            onConflict={({ assignedTechName }) => onAssignmentConflict?.(job, assignedTechName)}
          />
        ) : mode === 'open' ? (
          <Link
            href={`/tickets/${job.ticketId}`}
            className={`${styles.control} ${styles.secondary}`}
          >
            View ticket
          </Link>
        ) : mode === 'parts' && job.partRequest ? (
          <button
            type="button"
            className={`${styles.control} ${styles.claim}`}
            disabled={pending || partsDisabled}
            onClick={() => onResolvePart?.(job)}
          >
            {pending ? 'Saving…' : 'Got it'}
          </button>
        ) : mode === 'parts' ? (
          <Link
            href={`/tickets/${job.ticketId}#parts-requested-heading`}
            className={`${styles.control} ${styles.secondary}`}
          >
            Review parts
          </Link>
        ) : mode === 'mine' && job.workStatus === 'blocked'
          && job.approvalState === 'approved'
          && canUseManualWork({
            kind: job.kind,
            sessionId: job.sessionId,
            diagnosticsEntitled: diagnosticsEntitled ?? true,
          }) ? (
          <TicketInterruptionAction
            ticketId={job.ticketId}
            jobId={job.id}
            className={`${styles.control} ${styles.claim}`}
            onApplied={(resolved) => onResolveHold?.(job, resolved)}
          />
        ) : canBuildQuote && (mode === 'mine' || mode === 'created' || mode === 'team')
          && job.approvalState === 'pending_quote' && job.concern ? (
          <button
            type="button"
            className={`${styles.control} ${styles.claim}`}
            disabled={commandBusy}
            onClick={() => onOpenQuote?.(job)}
          >
            Build quote
          </button>
        ) : mode === 'created' || mode === 'team' ? (
          <Link
            href={`/tickets/${job.ticketId}`}
            className={`${styles.control} ${styles.secondary}`}
          >
            View ticket
          </Link>
        ) : manualDiagnosticWorkAvailable ? (
          <SimpleWorkAction
            job={job}
            inPlace={mode === 'mine' && Boolean(currentProfileId)}
            disabled={commandBusy}
            onOpen={onOpenWork}
          />
        ) : job.kind === 'diagnostic' ? (
          <DiagnosticAction
            job={job}
            pending={diagnosticPending}
            disabled={diagnosticDisabled}
            entitled={diagnosticsEntitled ?? true}
            forceAmbiguous={forceAmbiguous}
            onStart={onStartDiagnostic}
            onRefresh={onRefreshDiagnostic}
            onCheck={onCheckDiagnostic}
            setButton={setDiagnosticButton}
          />
        ) : (
          <SimpleWorkAction
            job={job}
            inPlace={mode === 'mine' && Boolean(currentProfileId)}
            disabled={commandBusy}
            onOpen={onOpenWork}
          />
        )}
      </div>
    </article>
  )
}

function SimpleWorkAction({
  job,
  inPlace = false,
  disabled = false,
  onOpen,
}: {
  job: TodayTicketJob
  inPlace?: boolean
  disabled?: boolean
  onOpen?: (job: TodayTicketJob) => void
}) {
  const identityComplete = job.customerName !== null && job.vehicle !== null
  const workAvailable = identityComplete && job.workStatus !== 'blocked' && job.sessionId === null
  if (workAvailable && inPlace && onOpen) {
    return (
      <button
        type="button"
        className={`${styles.control} ${styles.openDiagnosis}`}
        disabled={disabled}
        onClick={() => onOpen(job)}
      >
        {job.workStatus === 'in_progress' ? 'Continue work' : 'Open work'}
      </button>
    )
  }
  return (
    <Link
      href={workAvailable
        ? `/tickets/${job.ticketId}/jobs/${job.id}/work`
        : `/tickets/${job.ticketId}`}
      className={`${styles.control} ${workAvailable ? styles.openDiagnosis : styles.secondary}`}
    >
      {workAvailable ? 'Open work' : job.workStatus === 'blocked' ? 'Review blocked work' : 'Review work order'}
    </Link>
  )
}

function DiagnosticAction({
  job,
  pending,
  disabled,
  entitled,
  forceAmbiguous,
  onStart,
  onRefresh,
  onCheck,
  setButton,
}: {
  job: TodayTicketJob
  pending: boolean
  disabled: boolean
  entitled: boolean
  forceAmbiguous: boolean
  onStart?: (job: TodayTicketJob, confirmAmbiguousRetry?: boolean) => void
  onRefresh?: () => void
  onCheck?: (job: TodayTicketJob) => void
  setButton?: (jobId: string, element: HTMLButtonElement | null) => void
}) {
  const persistedState = job.diagnosticStartState ?? 'idle'
  const state = forceAmbiguous ? 'ambiguous' : persistedState

  // One-slot rule: when the engine is unavailable, the same slot carries the
  // manual text path. No disabled control or upsell teaser competes with work.
  if (!entitled) {
    return (
      <Link
        href={`/tickets/${job.ticketId}/quote`}
        className={`${styles.control} ${styles.claim}`}
      >
        Record findings
      </Link>
    )
  }

  if (job.sessionId) {
    return (
      <Link
        href={`/sessions/${job.sessionId}`}
        className={`${styles.control} ${styles.openDiagnosis}`}
      >
        Open diagnosis
      </Link>
    )
  }

  if (state === 'ready') {
    return (
      <button
        type="button"
        className={`${styles.control} ${styles.secondary}`}
        onClick={onRefresh}
      >
        Refresh diagnosis status
      </button>
    )
  }

  if (state === 'initializing') {
    return (
      <div className={styles.ambiguity}>
        <button type="button" className={`${styles.control} ${styles.approval}`} disabled>
          Diagnosis starting…
        </button>
        <button
          type="button"
          className={`${styles.control} ${styles.secondary}`}
          ref={(element) => setButton?.(job.id, element)}
          disabled={disabled}
          onClick={() => onCheck?.(job)}
        >
          {pending ? 'Checking status…' : 'Refresh diagnosis status'}
        </button>
      </div>
    )
  }

  if (state === 'ambiguous') {
    return (
      <div className={styles.ambiguity}>
        <p className={styles.warning}>{duplicateCostWarning}</p>
        <button
          ref={(element) => setButton?.(job.id, element)}
          type="button"
          className={`${styles.control} ${styles.secondary}`}
          disabled={disabled}
          onClick={() => onStart?.(job, true)}
        >
          {pending ? 'Starting diagnosis…' : 'Start again despite possible duplicate cost'}
        </button>
      </div>
    )
  }

  return (
    <button
      ref={(element) => setButton?.(job.id, element)}
      type="button"
      className={`${styles.control} ${styles.claim}`}
      disabled={disabled}
      onClick={() => onStart?.(job)}
    >
      {pending ? 'Starting diagnosis…' : 'Start diagnosis'}
    </button>
  )
}
