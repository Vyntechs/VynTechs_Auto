'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TodayTicketJob } from '@/lib/tickets'
import styles from './today-jobs-board.module.css'

type Props = {
  myJobs: TodayTicketJob[]
  openJobs: TodayTicketJob[]
}

type Announcement = {
  kind: 'status' | 'error'
  text: string
}

type ConflictBody = {
  error?: unknown
  currentAssignee?: { fullName?: unknown } | null
}

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

export function TodayJobsBoard({ myJobs, openJobs }: Props) {
  const router = useRouter()
  const boardRef = useRef<HTMLElement>(null)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const claimButtons = useRef(new Map<string, HTMLButtonElement>())

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

  return (
    <section
      ref={boardRef}
      className={styles.board}
      aria-label="Ticket jobs"
      tabIndex={-1}
      data-empty={myJobs.length === 0 && openJobs.length === 0 && !announcement}
    >
      {myJobs.length > 0 && (
        <JobSection label="My jobs" jobs={myJobs} mode="mine" />
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
}: {
  label: string
  jobs: TodayTicketJob[]
  mode: 'mine' | 'open'
  pendingJobId?: string | null
  claimsDisabled?: boolean
  onClaim?: (job: TodayTicketJob) => void
  setClaimButton?: (jobId: string, element: HTMLButtonElement | null) => void
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
}: {
  job: TodayTicketJob
  mode: 'mine' | 'open'
  pending: boolean
  claimDisabled: boolean
  onClaim?: (job: TodayTicketJob) => void
  setClaimButton?: (jobId: string, element: HTMLButtonElement | null) => void
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
        ) : job.kind === 'diagnostic' && job.sessionId ? (
          <Link
            href={`/sessions/${job.sessionId}`}
            className={`${styles.control} ${styles.openDiagnosis}`}
          >
            Open diagnosis
          </Link>
        ) : job.kind !== 'diagnostic' ? (
          <button
            type="button"
            className={`${styles.control} ${styles.approval}`}
            style={{ minHeight: 44 }}
            disabled
          >
            Quote and approval required
          </button>
        ) : null}
      </div>
    </article>
  )
}
