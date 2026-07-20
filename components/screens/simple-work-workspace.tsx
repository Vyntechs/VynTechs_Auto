'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/vt'
import {
  activeDurationSeconds,
  formatDurationSeconds,
  parseEscalationResponse,
  parseSimpleWorkMutationResponse,
  parseSimpleWorkWorkspaceResponse,
  retainEscalationAttempt,
  type EscalationAttempt,
  type SimpleWorkProjectionView,
  type SimpleWorkWorkspaceView,
} from '@/lib/shop-os/simple-work-ui'
import type { PartRequestView } from '@/lib/shop-os/part-requests-ui'
import { PartsNeededPanel } from './parts-needed-panel'
import styles from './simple-work-workspace.module.css'

type Props = {
  ticket: { id: string; number: number; customerName: string; vehicle: string }
  initialWorkspace: SimpleWorkWorkspaceView
  initialPartRequests?: PartRequestView[]
}

type Notice = { kind: 'status' | 'error'; text: string }
type Pending = 'clock' | 'note' | 'complete' | 'escalation' | null

export function SimpleWorkWorkspace({ ticket, initialWorkspace, initialPartRequests = [] }: Props) {
  const router = useRouter()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [note, setNote] = useState(initialWorkspace.workNotes ?? '')
  const [pending, setPending] = useState<Pending>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [concern, setConcern] = useState('')
  const [tier, setTier] = useState('')
  const [createdConcern, setCreatedConcern] = useState(false)
  const escalationAttempt = useRef<EscalationAttempt | null>(null)
  const basePath = `/api/tickets/${ticket.id}/jobs/${workspace.id}`

  function applyWork(work: SimpleWorkProjectionView) {
    setWorkspace((current) => ({
      ...current,
      workStatus: work.status,
      workNotes: work.workNotes,
      startedAt: work.startedAt,
      completedAt: work.completedAt,
      clockedOnSince: work.clockedOnSince,
      activeSeconds: work.activeSeconds,
      updatedAt: work.updatedAt,
    }))
    setNote(work.workNotes ?? '')
  }

  function stalePage() {
    router.replace(`/tickets/${ticket.id}`)
  }

  async function refreshWorkspace(): Promise<SimpleWorkWorkspaceView | null> {
    const response = await fetch(`${basePath}/work`, { method: 'GET', cache: 'no-store' })
    if (response.status === 404) {
      stalePage()
      return null
    }
    const body = await response.json().catch(() => null)
    const next = response.ok ? parseSimpleWorkWorkspaceResponse(body) : null
    if (!next) return null
    setWorkspace(next)
    setNote(next.workNotes ?? '')
    return next
  }

  async function mutateWork(
    action: Record<string, unknown>,
    mode: Exclude<Pending, 'escalation' | null>,
    busy: string,
    success: string,
  ) {
    if (pending) return
    setPending(mode)
    setNotice({ kind: 'status', text: busy })
    try {
      const response = await fetch(`${basePath}/work`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      })
      if (response.status === 404) {
        stalePage()
        return
      }
      const body = await response.json().catch(() => null)
      const result = response.ok ? parseSimpleWorkMutationResponse(body) : null
      if (!result) {
        if (response.status === 409) {
          await refreshWorkspace().catch(() => null)
          setNotice({ kind: 'error', text: 'Work changed elsewhere. Review the current state and try again.' })
          return
        }
        throw new Error('invalid_response')
      }
      applyWork(result.work)
      setNotice({ kind: 'status', text: success })
    } catch {
      setNotice({ kind: 'error', text: 'Not saved — check your connection and retry.' })
    } finally {
      setPending(null)
    }
  }

  async function createConcern(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const normalizedConcern = concern.trim()
    const requiredSkillTier = Number(tier)
    if (normalizedConcern.length < 5 || normalizedConcern.length > 500 || ![1, 2, 3].includes(requiredSkillTier)) {
      setNotice({ kind: 'error', text: 'Enter the concern and choose the required skill tier.' })
      return
    }
    const attempt = retainEscalationAttempt(
      escalationAttempt.current,
      normalizedConcern,
      requiredSkillTier,
    )
    escalationAttempt.current = attempt
    setPending('escalation')
    setNotice({ kind: 'status', text: 'Sending…' })
    try {
      const response = await fetch(`${basePath}/escalations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestKey: attempt.requestKey, concern: normalizedConcern, requiredSkillTier }),
      })
      if (response.status === 404) {
        stalePage()
        return
      }
      const body = await response.json().catch(() => null)
      if (response.status === 409 && body?.error === 'job_limit_reached') {
        escalationAttempt.current = null
        setNotice({ kind: 'error', text: 'This repair order already has its maximum number of jobs.' })
        return
      }
      const result = response.ok ? parseEscalationResponse(body) : null
      if (!result) throw new Error('escalation_failed')
      escalationAttempt.current = null
      setCreatedConcern(true)
      setNotice({ kind: 'status', text: 'Sent to be quoted. It is on the ticket, unassigned until the advisor prices it.' })
    } catch {
      setNotice({ kind: 'error', text: 'Not saved — check your connection and retry.' })
    } finally {
      setPending(null)
    }
  }

  const completeReady = workspace.workStatus === 'in_progress'
    && Boolean(workspace.workNotes?.trim())

  return (
    <main className={`app ${styles.screen}`}>
      <AppHeader
        title={`Work order ${String(ticket.number).padStart(6, '0')}`}
        meta={<span>{ticket.customerName} · {ticket.vehicle}</span>}
        back={{ href: `/tickets/${ticket.id}`, label: 'Ticket' }}
      />
      <div className={styles.content}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{workspace.kind === 'repair' ? 'Repair' : 'Maintenance'} · assigned work</p>
          <h1>{workspace.title}</h1>
        </header>

        {workspace.workStatus === 'done' ? (
          <section className={styles.state} aria-labelledby="work-complete">
            <p className={styles.stateMark}>Complete</p>
            <h2 id="work-complete">Work complete</h2>
            <p className={styles.savedNote}>{workspace.workNotes ?? 'No work note recorded.'}</p>
            <JobClock
              clockedOnSince={workspace.clockedOnSince}
              activeSeconds={workspace.activeSeconds}
              completedAt={workspace.completedAt}
            />
          </section>
        ) : workspace.authorization === 'declined' ? (
          <ReadOnlyState title="Customer declined this work" copy="This work is not authorized. No work action is available." />
        ) : workspace.authorization !== 'approved' ? (
          <ReadOnlyState title="Work not approved" copy="This work has not been authorized to start." />
        ) : workspace.workStatus === 'open' ? (
          <section className={styles.state} aria-labelledby="ready-heading">
            <p className={styles.stateMark}>Ready</p>
            <h2 id="ready-heading">Approved and ready</h2>
            <p>Clock on when you start working it. You can be clocked on to more than one job at a time.</p>
            <button className={styles.primary} type="button" disabled={pending !== null}
              onClick={() => mutateWork({ action: 'clock_on' }, 'clock', 'Clocking on…', 'Clocked on.')}>
              {pending === 'clock' ? 'Clocking on…' : 'Clock on'}
            </button>
          </section>
        ) : (
          <>
            <section className={styles.state} aria-labelledby="progress-heading">
              <p className={styles.stateMark}>Now</p>
              <h2 id="progress-heading">Work in progress</h2>
              <JobClock
                clockedOnSince={workspace.clockedOnSince}
                activeSeconds={workspace.activeSeconds}
                completedAt={null}
              />
              <button className={styles.primary} type="button" disabled={pending !== null}
                onClick={() => workspace.clockedOnSince
                  ? mutateWork({ action: 'clock_off' }, 'clock', 'Clocking off…', 'Clocked off. Time saved.')
                  : mutateWork({ action: 'clock_on' }, 'clock', 'Clocking on…', 'Clocked back on.')}>
                {pending === 'clock' ? 'Saving…' : workspace.clockedOnSince ? 'Clock off' : 'Clock back on'}
              </button>
            </section>
            <section className={styles.module} aria-labelledby="note-heading">
              <div className={styles.moduleHeading}><span>01</span><h2 id="note-heading">Work note</h2></div>
              <label className={styles.label} htmlFor="work-note">Work note</label>
              <textarea id="work-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
              <div className={styles.actionRow}>
                <span>{note.length} / 2,000</span>
                <button className={styles.secondary} type="button" disabled={pending !== null || note.trim().length < 1}
                  onClick={() => mutateWork({ action: 'save_note', note, expectedUpdatedAt: workspace.updatedAt }, 'note', 'Saving note…', 'Work note saved.')}>
                  {pending === 'note' ? 'Saving note…' : 'Save note'}
                </button>
              </div>
            </section>
            <section className={styles.module} aria-labelledby="complete-heading">
              <div className={styles.moduleHeading}><span>02</span><h2 id="complete-heading">Complete work</h2></div>
              <p className={styles.helper}>Requires a saved work note.</p>
              <button className={styles.primary} type="button" disabled={pending !== null || !completeReady}
                onClick={() => mutateWork({ action: 'complete', expectedUpdatedAt: workspace.updatedAt }, 'complete', 'Completing…', 'Work completed.')}>
                {pending === 'complete' ? 'Completing…' : 'Complete work'}
              </button>
            </section>
            <PartsNeededPanel ticketId={ticket.id} jobId={workspace.id} initialRequests={initialPartRequests} />
            <details className={styles.concern}>
              <summary>Found another concern</summary>
              {createdConcern ? (
                <button type="button" className={styles.secondary} onClick={() => {
                  setCreatedConcern(false); setConcern(''); setTier(''); escalationAttempt.current = null
                }}>Add another concern</button>
              ) : (
                <form onSubmit={createConcern}>
                  <label className={styles.label} htmlFor="found-concern">Concern</label>
                  <textarea id="found-concern" value={concern} maxLength={500} onChange={(event) => {
                    setConcern(event.target.value); escalationAttempt.current = null
                  }} />
                  <label className={styles.label} htmlFor="concern-tier">Required skill tier</label>
                  <select id="concern-tier" value={tier} onChange={(event) => {
                    setTier(event.target.value); escalationAttempt.current = null
                  }}>
                    <option value="">Choose tier</option><option value="1">C-tech · Tier 1</option>
                    <option value="2">B-tech · Tier 2</option><option value="3">A-tech · Tier 3</option>
                  </select>
                  <button className={styles.secondary} type="submit" disabled={pending !== null}>
                    {pending === 'escalation' ? 'Sending…' : 'Send to be quoted'}
                  </button>
                </form>
              )}
            </details>
          </>
        )}

        {notice && <p className={notice.kind === 'error' ? styles.error : styles.notice}
          role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}>
          {notice.text}
        </p>}
        <Link className={styles.ticketLink} href={`/tickets/${ticket.id}`}>View repair order</Link>
      </div>
    </main>
  )
}

function ReadOnlyState({ title, copy }: { title: string; copy: string }) {
  return <section className={styles.state}><p className={styles.stateMark}>Hold</p><h2>{title}</h2><p>{copy}</p></section>
}

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// The job's own time: total actual time the tech has clocked on it (banked
// intervals plus the interval running right now), whether the clock is running
// or paused, and — once done — when it was finished. No money, just the time.
function JobClock({
  clockedOnSince,
  activeSeconds,
  completedAt,
}: {
  clockedOnSince: string | null
  activeSeconds: number
  completedAt: string | null
}) {
  const total = activeDurationSeconds(activeSeconds, clockedOnSince, Date.now())
  const done = completedAt !== null
  if (total === 0 && !clockedOnSince && !done) return null
  return (
    <dl className={styles.clock}>
      <div><dt>On the job</dt><dd>{formatDurationSeconds(total)}</dd></div>
      {done ? (
        <div><dt>Finished</dt><dd>{formatClockTime(completedAt)}</dd></div>
      ) : (
        <div><dt>Clock</dt><dd>{clockedOnSince ? `Running since ${formatClockTime(clockedOnSince)}` : 'Paused'}</dd></div>
      )}
    </dl>
  )
}
