'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TodayTicketJob } from '@/lib/tickets'
import { canUseManualWork } from '@/lib/shop-os/manual-work-policy'
import {
  createTodayJobOverride,
  parseAssignmentEnvelope,
  placeTodayJob,
  projectTodayBoard,
  type TodayJobOverride,
} from '@/lib/shop-os/today-board'
import styles from './today-jobs-board.module.css'

type Props = {
  myJobs: TodayTicketJob[]
  openJobs: TodayTicketJob[]
  teamJobs?: TodayTicketJob[]
  createdJobs?: TodayTicketJob[]
  partsJobs?: TodayTicketJob[]
  canDispatchWork?: boolean
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
  teamJobs = [],
  createdJobs = [],
  partsJobs = [],
  canDispatchWork = false,
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
  const [focusRequest, setFocusRequest] = useState<{
    kind: 'board' | 'row' | 'claim'
    jobId: string
  } | null>(null)
  const claimButtons = useRef(new Map<string, HTMLButtonElement>())
  const diagnosticButtons = useRef(new Map<string, HTMLButtonElement>())
  const claimAttempts = useRef(new Map<string, string>())
  const board = useMemo(() => projectTodayBoard({
    myJobs,
    openJobs,
    teamJobs,
    createdJobs,
    partsJobs,
    canDispatchWork,
    overrides: jobOverrides,
  }), [myJobs, openJobs, teamJobs, createdJobs, partsJobs, canDispatchWork, jobOverrides])

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
        />
      )}
      {board.team.length > 0 && (
        <JobSection
          label="With the team"
          jobs={board.team}
          mode="team"
        />
      )}
      {board.created.length > 0 && (
        <JobSection
          label="Created by me"
          jobs={board.created}
          mode="created"
        />
      )}
      {board.parts.length > 0 && (
        <JobSection
          label="Parts needed"
          jobs={board.parts}
          mode="parts"
        />
      )}
      {hasMore && (
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
}) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <h2 className={styles.heading}>{label}</h2>
        <span className={styles.count}>{jobs.length}</span>
      </div>
      <div className={styles.ledger}>
        {jobs.map((job) => (
          <JobRow
            key={job.id}
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
          />
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
        {mode === 'open' && job.workStatus === 'open' && job.canClaim ? (
          <button
            ref={(element) => setClaimButton?.(job.id, element)}
            type="button"
            className={`${styles.control} ${styles.claim}`}
            disabled={claimDisabled}
            onClick={() => onClaim?.(job)}
          >
            {pending ? 'Claiming…' : 'Claim job'}
          </button>
        ) : mode === 'open' ? (
          <Link
            href={`/tickets/${job.ticketId}`}
            className={`${styles.control} ${styles.secondary}`}
          >
            View ticket
          </Link>
        ) : mode === 'parts' ? (
          <Link
            href={`/tickets/${job.ticketId}#parts-requested-heading`}
            className={`${styles.control} ${styles.claim}`}
          >
            Source parts
          </Link>
        ) : mode === 'created' || mode === 'team' ? (
          <Link
            href={`/tickets/${job.ticketId}`}
            className={`${styles.control} ${styles.secondary}`}
          >
            View ticket
          </Link>
        ) : manualDiagnosticWorkAvailable ? (
          <SimpleWorkAction job={job} />
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
          <SimpleWorkAction job={job} />
        )}
      </div>
    </article>
  )
}

function SimpleWorkAction({ job }: { job: TodayTicketJob }) {
  const identityComplete = job.customerName !== null && job.vehicle !== null
  const workAvailable = identityComplete && job.workStatus !== 'blocked' && job.sessionId === null
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
