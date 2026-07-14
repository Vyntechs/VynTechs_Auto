'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TodayTicketJob } from '@/lib/tickets'
import { EvidenceReceiptPreview } from '@/components/screens/evidence-receipt-preview'
import syntheticReceiptFixture from '@/lib/autoeye/receipt/fixtures/valid_full.json'
import styles from './today-jobs-board.module.css'

type Props = {
  myJobs: TodayTicketJob[]
  openJobs: TodayTicketJob[]
  // Per-shop diagnostics add-on entitlement (plan §3). Defaults true to
  // match DIAGNOSTICS_DEFAULT_UNTIL_PRICED — the server resolves the real
  // value and middleware/handlers enforce it; this only picks which action
  // fills the job's single slot.
  diagnosticsEntitled?: boolean
  // EVIDENCE_RECEIPT_PREVIEW flag (server-resolved, default OFF). When on —
  // and only for an entitled shop's diagnostic job — the existing action-slot
  // card additionally shows the read-only synthetic Evidence-Receipt preview.
  // The fixture above is imported statically; no network is involved.
  evidenceReceiptPreview?: boolean
}

type Announcement = {
  kind: 'status' | 'error'
  text: string
}

type ConflictBody = {
  error?: unknown
  currentAssignee?: { fullName?: unknown } | null
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
  diagnosticsEntitled = true,
  evidenceReceiptPreview = false,
}: Props) {
  const router = useRouter()
  const boardRef = useRef<HTMLElement>(null)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [pendingDiagnosticJobId, setPendingDiagnosticJobId] = useState<string | null>(null)
  const [ambiguousJobStates, setAmbiguousJobStates] = useState<
    Map<string, TodayTicketJob['diagnosticStartState']>
  >(() => new Map())
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const claimButtons = useRef(new Map<string, HTMLButtonElement>())
  const diagnosticButtons = useRef(new Map<string, HTMLButtonElement>())

  async function claim(job: TodayTicketJob) {
    if (pendingJobId) return
    let returnFocusToBoard = false

    setPendingJobId(job.id)
    setAnnouncement({ kind: 'status', text: `Claiming ticket ${job.ticketNumber}.` })

    try {
      const response = await fetch(
        `/api/tickets/${job.ticketId}/jobs/${job.id}/assignment`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'claim' }),
        },
      )

      const body = await response.json().catch(() => ({})) as ConflictBody
      if (response.ok) {
        setAnnouncement({
          kind: 'status',
          text: `Ticket ${job.ticketNumber} claimed. Refreshing jobs.`,
        })
        returnFocusToBoard = true
        router.refresh()
        return
      }

      if (response.status === 409 && body.error === 'assignment_conflict') {
        const winner = body.currentAssignee?.fullName
        const safeWinner = typeof winner === 'string' && winner.trim()
          ? winner.trim()
          : null
        setAnnouncement({
          kind: 'status',
          text: safeWinner
            ? `Already claimed by ${safeWinner}. Refreshing jobs.`
            : 'This job was already claimed. Refreshing jobs.',
        })
        returnFocusToBoard = true
        router.refresh()
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
      requestAnimationFrame(() => {
        const focusTarget = returnFocusToBoard
          ? boardRef.current
          : claimButtons.current.get(job.id)
        focusTarget?.focus()
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
      data-empty={myJobs.length === 0 && openJobs.length === 0 && !announcement}
    >
      {myJobs.length > 0 && (
        <JobSection
          label="My jobs"
          jobs={myJobs}
          mode="mine"
          pendingDiagnosticJobId={pendingDiagnosticJobId}
          diagnosticsDisabled={pendingDiagnosticJobId !== null}
          diagnosticsEntitled={diagnosticsEntitled}
          evidenceReceiptPreview={evidenceReceiptPreview}
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
      {openJobs.length > 0 && (
        <JobSection
          label="Open jobs"
          jobs={openJobs}
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
  diagnosticsEntitled = true,
  evidenceReceiptPreview = false,
  ambiguousJobStates = new Map(),
  onStartDiagnostic,
  onRefreshDiagnostic,
  onCheckDiagnostic,
  setDiagnosticButton,
}: {
  label: string
  jobs: TodayTicketJob[]
  mode: 'mine' | 'open'
  pendingJobId?: string | null
  claimsDisabled?: boolean
  onClaim?: (job: TodayTicketJob) => void
  setClaimButton?: (jobId: string, element: HTMLButtonElement | null) => void
  pendingDiagnosticJobId?: string | null
  diagnosticsDisabled?: boolean
  diagnosticsEntitled?: boolean
  evidenceReceiptPreview?: boolean
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
            evidenceReceiptPreview={evidenceReceiptPreview}
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
  evidenceReceiptPreview,
  forceAmbiguous,
  onStartDiagnostic,
  onRefreshDiagnostic,
  onCheckDiagnostic,
  setDiagnosticButton,
}: {
  job: TodayTicketJob
  mode: 'mine' | 'open'
  pending: boolean
  claimDisabled: boolean
  onClaim?: (job: TodayTicketJob) => void
  setClaimButton?: (jobId: string, element: HTMLButtonElement | null) => void
  diagnosticPending: boolean
  diagnosticDisabled: boolean
  diagnosticsEntitled?: boolean
  evidenceReceiptPreview?: boolean
  forceAmbiguous: boolean
  onStartDiagnostic?: (job: TodayTicketJob, confirmAmbiguousRetry?: boolean) => void
  onRefreshDiagnostic?: () => void
  onCheckDiagnostic?: (job: TodayTicketJob) => void
  setDiagnosticButton?: (jobId: string, element: HTMLButtonElement | null) => void
}) {
  const vehicle = job.vehicle
    ? `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`
    : 'Vehicle not recorded'

  return (
    <article
      className={styles.row}
      aria-label={`Ticket ${job.ticketNumber}: ${job.title}`}
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
        </div>
      </div>
      <div className={styles.action}>
        {mode === 'open' ? (
          <button
            ref={(element) => setClaimButton?.(job.id, element)}
            type="button"
            className={`${styles.control} ${styles.claim}`}
            disabled={claimDisabled}
            onClick={() => onClaim?.(job)}
          >
            {pending ? 'Claiming…' : 'Claim job'}
          </button>
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
      {/* Receipt lane gate 3: the synthetic Evidence-Receipt preview lives
          inside this existing diagnostic action-slot card — no new page, no
          nav change. Renders only when the server-resolved flag is on AND
          the shop holds the diagnostics entitlement AND the job is the
          mine-mode diagnostic slot. Read-only; fixture data only. */}
      {evidenceReceiptPreview &&
        diagnosticsEntitled &&
        mode === 'mine' &&
        job.kind === 'diagnostic' && (
          <div className={styles.receiptSlot}>
            <EvidenceReceiptPreview receiptData={syntheticReceiptFixture} />
          </div>
        )}
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

  // One-slot rule (plan §3): without the diagnostics add-on the same slot
  // carries the manual path. Record findings opens the quote workspace,
  // where the tech fills the customer story and enters lines by hand —
  // the same shapes the AI path fills. The single line below the action is
  // the only permissible upsell affordance.
  if (!entitled) {
    return (
      <div className={styles.ambiguity}>
        <Link
          href={`/tickets/${job.ticketId}/quote`}
          className={`${styles.control} ${styles.claim}`}
        >
          Record findings
        </Link>
        <p className={styles.addOnNote}>Diagnose with AI — add-on</p>
      </div>
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
