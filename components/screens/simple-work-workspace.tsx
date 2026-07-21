'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/vt'
import { LocalizedTimestamp } from '@/components/vt/localized-timestamp'
import {
  activeDurationSeconds,
  formatDurationSeconds,
  parseEscalationResponse,
  parseSimpleWorkMutationResponse,
  parseSimpleWorkWorkspaceResponse,
  retainEscalationAttempt,
  type EscalationAttempt,
  type SimpleWorkProjectionView,
  type SimpleWorkEscalationView,
  type SimpleWorkWorkspaceView,
} from '@/lib/shop-os/simple-work-ui'
import type { PartRequestView } from '@/lib/shop-os/part-requests-ui'
import {
  decodeSimpleWorkDraft,
  encodeSimpleWorkDraft,
  simpleWorkDraftStorageKey,
  type SimpleWorkDraftValues,
} from '@/lib/shop-os/simple-work-draft'
import { PartsNeededPanel, type PartRequestDraft } from './parts-needed-panel'
import {
  parseInterruptionJob,
  type InterruptionJobView,
} from './ticket-interruption-action'
import styles from './simple-work-workspace.module.css'

type Props = {
  actorProfileId?: string
  ticket: { id: string; number: number; customerName: string; vehicle: string }
  initialWorkspace: SimpleWorkWorkspaceView
  initialPartRequests?: PartRequestView[]
  embedded?: boolean
  onClose?: () => void
  onProjection?: (work: SimpleWorkProjectionView) => void
  onEscalation?: (job: SimpleWorkEscalationView) => void
  onInterrupted?: (job: InterruptionJobView) => void
}

type Notice = { kind: 'status' | 'error'; text: string }
type Pending = 'clock' | 'note' | 'complete' | 'escalation' | 'hold' | null

const WORK_KIND_LABEL: Record<SimpleWorkWorkspaceView['kind'], string> = {
  diagnostic: 'Diagnostic',
  repair: 'Repair',
  maintenance: 'Maintenance',
}

const EMPTY_PARTS_DRAFT: PartRequestDraft = {
  description: '', preference: '', quantity: '1', requestKey: null,
}

function readLocalDraft(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function clearLocalDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Local draft recovery is best-effort and never blocks work.
  }
}

function writeLocalDraft(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // A full or unavailable browser store must not interrupt repair work.
  }
}

export function SimpleWorkWorkspace({
  actorProfileId,
  ticket,
  initialWorkspace,
  initialPartRequests = [],
  embedded = false,
  onClose,
  onProjection,
  onEscalation,
  onInterrupted,
}: Props) {
  const router = useRouter()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [note, setNote] = useState(initialWorkspace.workNotes ?? '')
  const [pending, setPending] = useState<Pending>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [concern, setConcern] = useState('')
  const [tier, setTier] = useState<SimpleWorkDraftValues['tier']>('')
  const [createdConcern, setCreatedConcern] = useState(false)
  const [partsDraftDirty, setPartsDraftDirty] = useState(false)
  const [partsDraft, setPartsDraft] = useState<PartRequestDraft>(EMPTY_PARTS_DRAFT)
  const [holdKind, setHoldKind] = useState('')
  const [holdNote, setHoldNote] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const escalationAttempt = useRef<EscalationAttempt | null>(null)
  const restoredDraftScope = useRef<string | null>(null)
  const basePath = `/api/tickets/${ticket.id}/jobs/${workspace.id}`
  const hasOtherUnsavedDraft = note !== (workspace.workNotes ?? '')
    || concern.trim().length > 0
    || tier !== ''
    || partsDraftDirty
  const hasHoldDraft = holdKind !== '' || holdNote.trim().length > 0
  const hasAuxiliaryDraft = concern.trim().length > 0
    || tier !== ''
    || partsDraftDirty
    || hasHoldDraft
  const hasUnsavedDraft = hasOtherUnsavedDraft || hasHoldDraft
  const draftScope = actorProfileId ? {
    actorProfileId,
    ticketId: ticket.id,
    jobId: workspace.id,
    workspaceUpdatedAt: workspace.updatedAt,
    workStatus: workspace.workStatus,
    authorization: workspace.authorization,
  } : null
  const draftScopeKey = draftScope ? simpleWorkDraftStorageKey(draftScope) : null
  const draftRevision = draftScopeKey ? `${draftScopeKey}:${workspace.updatedAt}` : null

  useEffect(() => {
    if (!draftScope || !draftScopeKey) {
      restoredDraftScope.current = null
      setDraftReady(true)
      return
    }
    const restored = decodeSimpleWorkDraft(readLocalDraft(draftScopeKey), draftScope)
    if (!restored) {
      clearLocalDraft(draftScopeKey)
    } else {
      setNote(restored.note)
      setConcern(restored.concern)
      setTier(restored.tier)
      setPartsDraft(restored.parts)
      setHoldKind(restored.hold.kind)
      setHoldNote(restored.hold.note)
    }
    restoredDraftScope.current = draftRevision
    setDraftReady(true)
  }, [
    actorProfileId,
    draftRevision,
    draftScopeKey,
    ticket.id,
    workspace.authorization,
    workspace.id,
    workspace.updatedAt,
    workspace.workStatus,
  ])

  useEffect(() => {
    if (!draftScope || !draftScopeKey || !draftRevision || !draftReady || restoredDraftScope.current !== draftRevision) return
    if (workspace.workStatus !== 'in_progress' || workspace.authorization !== 'approved') {
      clearLocalDraft(draftScopeKey)
      return
    }
    const values: SimpleWorkDraftValues = {
      note,
      concern,
      tier,
      parts: partsDraft,
      hold: { kind: holdKind as SimpleWorkDraftValues['hold']['kind'], note: holdNote },
    }
    const hasDraft = note !== (workspace.workNotes ?? '')
      || concern.trim().length > 0
      || tier !== ''
      || partsDraft.description.trim().length > 0
      || partsDraft.preference.trim().length > 0
      || partsDraft.quantity !== '1'
      || partsDraft.requestKey !== null
      || holdKind !== ''
      || holdNote.trim().length > 0
      || partsDraftDirty
    const encoded = hasDraft ? encodeSimpleWorkDraft(draftScope, values) : null
    if (encoded) writeLocalDraft(draftScopeKey, encoded)
    else clearLocalDraft(draftScopeKey)
  }, [
    concern,
    draftReady,
    draftScope,
    draftScopeKey,
    draftRevision,
    holdKind,
    holdNote,
    note,
    partsDraft,
    partsDraftDirty,
    tier,
    workspace.authorization,
    workspace.workNotes,
    workspace.workStatus,
  ])

  function clearDraft(): void {
    if (draftScopeKey) clearLocalDraft(draftScopeKey)
  }

  function discardLocalDraft(): void {
    setNote(workspace.workNotes ?? '')
    setConcern('')
    setTier('')
    setCreatedConcern(false)
    setPartsDraft(EMPTY_PARTS_DRAFT)
    setPartsDraftDirty(false)
    setHoldKind('')
    setHoldNote('')
    escalationAttempt.current = null
    clearDraft()
    setNotice({ kind: 'status', text: 'Local draft discarded. Saved repair-order work is unchanged.' })
  }

  function requestClose(): void {
    if (pending !== null || hasUnsavedDraft) {
      setNotice({ kind: 'error', text: 'Finish or clear the draft before closing work.' })
      return
    }
    onClose?.()
  }

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
    onProjection?.(work)
  }

  function stalePage() {
    if (embedded) {
      setNotice({ kind: 'error', text: 'This work changed or is no longer assigned to you. The repair order is still open.' })
      return
    }
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
      setConcern('')
      setTier('')
      onEscalation?.(result.job)
      setNotice({ kind: 'status', text: 'Sent to be quoted. It is on the ticket, unassigned until the advisor prices it.' })
    } catch {
      setNotice({ kind: 'error', text: 'Not saved — check your connection and retry.' })
    } finally {
      setPending(null)
    }
  }

  async function placeOnHold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const normalizedNote = holdNote.trim()
    if (!['parts', 'customer', 'schedule', 'shop'].includes(holdKind) || normalizedNote.length < 1) {
      setNotice({ kind: 'error', text: 'Choose why work is paused and say what needs to happen next.' })
      return
    }
    if (hasOtherUnsavedDraft) {
      setNotice({ kind: 'error', text: 'Save or clear the open draft before placing work on hold.' })
      return
    }
    setPending('hold')
    setNotice({ kind: 'status', text: 'Placing work on hold…' })
    try {
      const response = await fetch(`${basePath}/interruption`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'block',
          requestKey: crypto.randomUUID(),
          holdKind,
          holdNote: normalizedNote,
        }),
      })
      const body = await response.json().catch(() => null)
      const job = response.ok && body && typeof body === 'object'
        ? parseInterruptionJob((body as { job?: unknown }).job)
        : null
      if (!job) throw new Error('hold_failed')
      clearDraft()
      onInterrupted?.(job)
      if (embedded) onClose?.()
      else router.replace(`/tickets/${ticket.id}`)
    } catch {
      setNotice({ kind: 'error', text: 'Work was not put on hold. Check the connection and retry.' })
      setPending(null)
    }
  }

  const completeReady = workspace.workStatus === 'in_progress'
    && Boolean(workspace.workNotes?.trim())

  const Root = embedded ? 'section' : 'main'
  return (
    <Root
      className={embedded ? styles.embeddedScreen : `app ${styles.screen}`}
      {...(embedded ? { 'aria-label': 'Work workspace' } : {})}
    >
      {!embedded && <AppHeader
        title={`Work order ${String(ticket.number).padStart(6, '0')}`}
        meta={<span>{ticket.customerName} · {ticket.vehicle}</span>}
        back={{ href: `/tickets/${ticket.id}`, label: 'Ticket' }}
      />}
      <div className={styles.content}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{WORK_KIND_LABEL[workspace.kind]} · assigned work</p>
            <h1>{workspace.title}</h1>
          </div>
          {embedded && <button className={styles.closeEmbedded} type="button" onClick={requestClose}>Close work</button>}
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
              <p className={styles.helper}>
                {hasAuxiliaryDraft
                  ? 'Finish or clear the open concern or parts draft first.'
                  : 'Requires a saved work note.'}
              </p>
              <button className={styles.primary} type="button" disabled={pending !== null || !completeReady || hasAuxiliaryDraft}
                onClick={() => mutateWork({ action: 'complete', expectedUpdatedAt: workspace.updatedAt }, 'complete', 'Completing…', 'Work completed.')}>
                {pending === 'complete' ? 'Completing…' : 'Complete work'}
              </button>
            </section>
            <PartsNeededPanel
              ticketId={ticket.id}
              jobId={workspace.id}
              initialRequests={initialPartRequests}
              onDraftChange={setPartsDraftDirty}
              initialDraft={partsDraft}
              onDraft={setPartsDraft}
            />
            <details className={styles.concern}>
              <summary>Put work on hold</summary>
              <form onSubmit={placeOnHold}>
                <p className={styles.helper}>Your saved time stays with this work. The repair order keeps the next thing that must happen.</p>
                <label className={styles.label} htmlFor="hold-kind">Reason for hold</label>
                <select id="hold-kind" value={holdKind} onChange={(event) => setHoldKind(event.target.value)}>
                  <option value="">Choose reason</option>
                  <option value="parts">Waiting on parts</option>
                  <option value="customer">Waiting on customer</option>
                  <option value="schedule">Schedule or availability</option>
                  <option value="shop">Shop decision</option>
                </select>
                <label className={styles.label} htmlFor="hold-note">What needs to happen next?</label>
                <textarea id="hold-note" value={holdNote} maxLength={500} onChange={(event) => setHoldNote(event.target.value)} />
                {hasOtherUnsavedDraft && <p className={styles.helper}>Save or clear the open draft before placing work on hold.</p>}
                <button className={styles.secondary} type="submit" disabled={pending !== null || hasOtherUnsavedDraft || holdKind === '' || holdNote.trim().length < 1}>
                  {pending === 'hold' ? 'Placing on hold…' : 'Put work on hold'}
                </button>
              </form>
            </details>
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
                    setTier(event.target.value as SimpleWorkDraftValues['tier']); escalationAttempt.current = null
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
        {hasUnsavedDraft && (
          <button className={styles.secondary} type="button" onClick={discardLocalDraft}>
            Discard local draft
          </button>
        )}
        {!embedded && <Link className={styles.ticketLink} href={`/tickets/${ticket.id}`}>View repair order</Link>}
      </div>
    </Root>
  )
}

function ReadOnlyState({ title, copy }: { title: string; copy: string }) {
  return <section className={styles.state}><p className={styles.stateMark}>Hold</p><h2>{title}</h2><p>{copy}</p></section>
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
  const [now, setNow] = useState<number | null>(null)
  const total = activeDurationSeconds(activeSeconds, clockedOnSince, now ?? new Date(clockedOnSince ?? 0).getTime())
  const done = completedAt !== null

  useEffect(() => {
    if (!clockedOnSince) return
    const tick = () => setNow(Date.now())
    tick()
    const interval = window.setInterval(tick, 1_000)
    return () => window.clearInterval(interval)
  }, [clockedOnSince])

  if (total === 0 && !clockedOnSince && !done) return null
  return (
    <dl className={styles.clock}>
      <div><dt>On the job</dt><dd>{formatDurationSeconds(total)}</dd></div>
      {done ? (
        <div><dt>Finished</dt><dd><LocalizedTimestamp value={completedAt} kind="time" /></dd></div>
      ) : (
        <div><dt>Clock</dt><dd>{clockedOnSince ? <>Running since <LocalizedTimestamp value={clockedOnSince} kind="time" /></> : 'Paused'}</dd></div>
      )}
    </dl>
  )
}
