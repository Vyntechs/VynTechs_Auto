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
  parseInlineSimpleWorkResponse,
  parseSimpleWorkMutationResponse,
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
  legacySimpleWorkDraftStorageKey,
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
  onStale?: () => void
  onEscalation?: (job: SimpleWorkEscalationView) => void
  onInterrupted?: (job: InterruptionJobView) => void
}

type Notice = { kind: 'status' | 'error'; text: string }
type Pending = 'work' | 'clock' | 'complete' | 'escalation' | 'hold' | null
type WorkIntent =
  | { kind: 'start_work' }
  | { kind: 'clock_on' }
  | { kind: 'clock_off' }
  | { kind: 'complete'; expectedDetail: string }
type DetailConflict = { local: string; saved: string }

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

function hasPartDraft(draft: PartRequestDraft): boolean {
  return draft.description.trim().length > 0
    || draft.preference.trim().length > 0
    || draft.quantity !== '1'
    || draft.requestKey !== null
}

function workspaceProjection(workspace: SimpleWorkWorkspaceView): SimpleWorkProjectionView {
  return {
    status: workspace.workStatus,
    workNotes: workspace.workNotes,
    startedAt: workspace.startedAt,
    completedAt: workspace.completedAt,
    clockedOnSince: workspace.clockedOnSince,
    activeSeconds: workspace.activeSeconds,
    updatedAt: workspace.updatedAt,
    timerEnabled: workspace.timerEnabled,
  }
}

function workspaceIntentSatisfied(work: SimpleWorkProjectionView, intent: WorkIntent): boolean {
  if (intent.kind === 'start_work') return work.status === 'in_progress'
  if (intent.kind === 'clock_on') return work.status === 'in_progress' && work.clockedOnSince !== null
  if (intent.kind === 'clock_off') return work.status !== 'open' && work.clockedOnSince === null
  return work.status === 'done' && work.workNotes === intent.expectedDetail
}

export function SimpleWorkWorkspace({
  actorProfileId,
  ticket,
  initialWorkspace,
  initialPartRequests = [],
  embedded = false,
  onClose,
  onProjection,
  onStale,
  onEscalation,
  onInterrupted,
}: Props) {
  const router = useRouter()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [detail, setDetail] = useState(initialWorkspace.workNotes ?? '')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailConflict, setDetailConflict] = useState<DetailConflict | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [stale, setStale] = useState(false)
  const [concern, setConcern] = useState('')
  const [tier, setTier] = useState<SimpleWorkDraftValues['tier']>('')
  const [createdConcern, setCreatedConcern] = useState(false)
  const [partsDraftDirty, setPartsDraftDirty] = useState(false)
  const [partsDraft, setPartsDraft] = useState<PartRequestDraft>(EMPTY_PARTS_DRAFT)
  const [holdKind, setHoldKind] = useState('')
  const [holdNote, setHoldNote] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const escalationAttempt = useRef<EscalationAttempt | null>(null)
  const approvedScopeHeading = useRef<HTMLHeadingElement>(null)
  const completionHeading = useRef<HTMLHeadingElement>(null)
  const staleHeading = useRef<HTMLHeadingElement>(null)
  const restoredDraftScope = useRef<string | null>(null)
  const basePath = `/api/tickets/${ticket.id}/jobs/${workspace.id}`
  const savedDetail = workspace.workNotes ?? ''
  const hasOtherUnsavedDraft = detail !== savedDetail
    || detailConflict !== null
    || concern.trim().length > 0
    || tier !== ''
    || partsDraftDirty
  const hasHoldDraft = holdKind !== '' || holdNote.trim().length > 0
  const hasUnsavedDraft = hasOtherUnsavedDraft || hasHoldDraft
  const draftScope = actorProfileId
    && workspace.authorization === 'approved'
    && workspace.workStatus !== 'done' ? {
    actorProfileId,
    ticketId: ticket.id,
    jobId: workspace.id,
    workStatus: workspace.workStatus,
    authorization: 'approved' as const,
    savedDetailBaseline: savedDetail,
  } : null
  const draftScopeKey = draftScope ? simpleWorkDraftStorageKey(draftScope) : null
  const legacyDraftScopeKey = draftScope ? legacySimpleWorkDraftStorageKey(draftScope) : null
  const draftRevision = draftScopeKey
    ? JSON.stringify([draftScopeKey, workspace.workStatus, workspace.authorization, savedDetail])
    : null

  useEffect(() => {
    if (!embedded) return
    if (stale) {
      staleHeading.current?.focus()
      return
    }
    if (workspace.authorization !== 'approved' || !workspace.approvedScope) return
    approvedScopeHeading.current?.focus()
  }, [embedded, stale, workspace.authorization, workspace.id])

  useEffect(() => {
    if (workspace.workStatus === 'done') completionHeading.current?.focus()
  }, [workspace.workStatus])

  useEffect(() => {
    setDraftReady(false)
    if (!draftScope || !draftScopeKey || !legacyDraftScopeKey) {
      restoredDraftScope.current = null
      setDraftReady(true)
      return
    }
    const raw = readLocalDraft(draftScopeKey)
    const legacyRaw = raw === null ? readLocalDraft(legacyDraftScopeKey) : null
    const restored = decodeSimpleWorkDraft(raw, draftScope, legacyRaw)
    if (restored.kind === 'invalid') {
      clearLocalDraft(draftScopeKey)
      if (legacyRaw !== null) clearLocalDraft(legacyDraftScopeKey)
      setDetail(savedDetail)
      setDetailOpen(false)
      setDetailConflict(null)
    } else if (restored.kind === 'recovered' || restored.kind === 'conflict') {
      const values = restored.values
      setDetail(values.detail)
      setDetailOpen(values.detailOpen)
      setConcern(values.concern)
      setTier(values.tier)
      setPartsDraft(values.parts)
      setPartsDraftDirty(hasPartDraft(values.parts))
      setHoldKind(values.hold.kind)
      setHoldNote(values.hold.note)
      setDetailConflict(restored.kind === 'conflict'
        ? { local: values.detail, saved: restored.currentSavedDetail }
        : null)
      if (restored.source === 'v1') {
        const encoded = encodeSimpleWorkDraft(draftScope, values)
        if (encoded) writeLocalDraft(draftScopeKey, encoded)
        clearLocalDraft(legacyDraftScopeKey)
      }
    } else {
      setDetail(savedDetail)
      setDetailOpen(false)
      setDetailConflict(null)
    }
    restoredDraftScope.current = draftRevision
    setDraftReady(true)
  }, [
    actorProfileId,
    draftRevision,
    draftScopeKey,
    legacyDraftScopeKey,
    savedDetail,
    ticket.id,
    workspace.authorization,
    workspace.id,
    workspace.workStatus,
  ])

  useEffect(() => {
    if (!draftScope || !draftScopeKey || !draftRevision || !draftReady || restoredDraftScope.current !== draftRevision) return
    if (workspace.workStatus !== 'in_progress' || workspace.authorization !== 'approved') {
      clearLocalDraft(draftScopeKey)
      if (legacyDraftScopeKey) clearLocalDraft(legacyDraftScopeKey)
      return
    }
    if (detailConflict) return
    const values: SimpleWorkDraftValues = {
      detail,
      detailOpen,
      concern,
      tier,
      parts: partsDraft,
      hold: { kind: holdKind as SimpleWorkDraftValues['hold']['kind'], note: holdNote },
    }
    const hasDraft = detailOpen
      || detail !== savedDetail
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
    detail,
    detailConflict,
    detailOpen,
    draftReady,
    draftScope,
    draftScopeKey,
    draftRevision,
    holdKind,
    holdNote,
    legacyDraftScopeKey,
    partsDraft,
    partsDraftDirty,
    tier,
    workspace.authorization,
    workspace.workStatus,
    savedDetail,
  ])

  function clearDraft(): void {
    if (draftScopeKey) clearLocalDraft(draftScopeKey)
    if (legacyDraftScopeKey) clearLocalDraft(legacyDraftScopeKey)
  }

  function discardLocalDraft(): void {
    setDetail(savedDetail)
    setDetailOpen(false)
    setDetailConflict(null)
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
    if (stale) {
      onClose?.()
      return
    }
    if (pending !== null || hasUnsavedDraft) {
      setNotice({ kind: 'error', text: 'Finish or clear the draft before closing work.' })
      return
    }
    onClose?.()
  }

  function applyWork(work: SimpleWorkProjectionView, intent: WorkIntent) {
    setWorkspace((current) => ({
      ...current,
      workStatus: work.status,
      workNotes: work.workNotes,
      startedAt: work.startedAt,
      completedAt: work.completedAt,
      clockedOnSince: work.clockedOnSince,
      activeSeconds: work.activeSeconds,
      updatedAt: work.updatedAt,
      timerEnabled: work.timerEnabled,
    }))
    if (intent.kind === 'complete') {
      setDetail(work.workNotes ?? '')
      setDetailOpen(false)
      setDetailConflict(null)
      clearDraft()
    }
    onProjection?.(work)
  }

  function applyWorkspaceTruth(next: SimpleWorkWorkspaceView): void {
    const localWasChanged = detail !== savedDetail
    if (localWasChanged && (next.workNotes ?? '') !== savedDetail) {
      setDetailConflict({ local: detail, saved: next.workNotes ?? '' })
      setDetailOpen(true)
    } else if (!localWasChanged) {
      setDetail(next.workNotes ?? '')
    }
    setWorkspace(next)
    onProjection?.(workspaceProjection(next))
  }

  function stalePage() {
    if (embedded) {
      setStale(true)
      setNotice(null)
      onStale?.()
      return
    }
    router.replace(`/tickets/${ticket.id}`)
  }

  if (embedded && stale) {
    return (
      <section className={styles.embeddedScreen} aria-label="Work on this job">
        <div className={styles.content}>
          <header className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>{WORK_KIND_LABEL[workspace.kind]} · assigned work</p>
              <h1>{workspace.title}</h1>
            </div>
            <button className={styles.closeEmbedded} type="button" onClick={requestClose}>Close work</button>
          </header>
          <section className={styles.state} aria-labelledby="stale-work-heading">
            <p className={styles.stateMark}>Refresh required</p>
            <h2 ref={staleHeading} id="stale-work-heading" tabIndex={-1}>Work access changed</h2>
            <p>This work is no longer safe to change here. Review the current repair order before continuing.</p>
            <Link className={styles.ticketLink} href={`/tickets/${ticket.id}`}>Review repair order</Link>
          </section>
        </div>
      </section>
    )
  }

  async function refreshWorkspace(): Promise<SimpleWorkWorkspaceView | null> {
    const response = await fetch(`${basePath}/work`, { method: 'GET', cache: 'no-store' })
    if (response.status === 404) {
      stalePage()
      return null
    }
    const body = await response.json().catch(() => null)
    const next = response.ok ? parseInlineSimpleWorkResponse(body) : null
    return next?.workspace ?? null
  }

  async function reconcileWork(intent: WorkIntent, success: string): Promise<void> {
    const current = await refreshWorkspace().catch(() => null)
    if (!current) {
      setNotice({ kind: 'error', text: "Couldn't confirm what happened. Your draft is still here; retry when the connection is steady." })
      return
    }
    if (workspaceIntentSatisfied(workspaceProjection(current), intent)) {
      applyWorkspaceTruth(current)
      if (intent.kind === 'complete') {
        setDetail(current.workNotes ?? '')
        setDetailOpen(false)
        setDetailConflict(null)
        clearDraft()
      }
      setNotice({ kind: 'status', text: success })
      return
    }
    applyWorkspaceTruth(current)
    setNotice({ kind: 'error', text: "Couldn't confirm what happened. Current shop truth is shown and your draft is still here." })
  }

  async function mutateWork(
    action: Record<string, unknown>,
    mode: Exclude<Pending, 'escalation' | null>,
    busy: string,
    success: string,
    intent: WorkIntent,
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
      if (result && workspaceIntentSatisfied(result.work, intent)) {
        applyWork(result.work, intent)
        setNotice({ kind: 'status', text: success })
        return
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 409) {
        setNotice({ kind: 'error', text: 'That action was refused. Review the current work and try again.' })
        return
      }
      await reconcileWork(intent, success)
    } catch {
      await reconcileWork(intent, success)
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
      setNotice({ kind: 'error', text: 'Clear the open draft before placing work on hold.' })
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
      // The embedded Today surface projects the blocked job before it closes
      // this workspace. Let that parent own the close so the row never flashes
      // back to its stale in-progress state.
      if (embedded) {
        if (!onInterrupted) onClose?.()
      } else {
        router.replace(`/tickets/${ticket.id}`)
      }
    } catch {
      setNotice({ kind: 'error', text: 'Work was not put on hold. Check the connection and retry.' })
      setPending(null)
    }
  }

  const normalizedDetail = detail.trim()
  const hasNewDetail = detailOpen && normalizedDetail.length > 0 && detail !== savedDetail
  const completionBlocker = detailConflict
    ? 'Choose which detail to keep before completing.'
    : partsDraftDirty
      ? 'Finish or clear the parts draft before completing.'
      : concern.trim().length > 0 || tier !== ''
        ? 'Finish or clear the found-concern draft before completing.'
        : hasHoldDraft
          ? 'Finish or clear the hold draft before completing.'
          : null

  function completeWork(): void {
    if (completionBlocker) return
    const completion = hasNewDetail
      ? { kind: 'with_details' as const, details: normalizedDetail }
      : { kind: 'as_approved' as const }
    const expectedDetail = completion.kind === 'with_details'
      ? completion.details
      : savedDetail.trim().length > 0
        ? savedDetail
        : 'Completed as approved.'
    void mutateWork(
      { action: 'complete', expectedUpdatedAt: workspace.updatedAt, completion },
      'complete',
      'Completing…',
      'Work completed.',
      { kind: 'complete', expectedDetail },
    )
  }

  const Root = embedded ? 'section' : 'main'
  return (
    <Root
      className={embedded ? styles.embeddedScreen : `app ${styles.screen}`}
      {...(embedded ? { 'aria-label': 'Work on this job' } : {})}
    >
      {!embedded && <AppHeader
        title={`RO ${String(ticket.number).padStart(6, '0')}`}
        meta={<span>{ticket.customerName} · {ticket.vehicle}</span>}
        back={{ href: `/tickets/${ticket.id}`, label: 'Repair order' }}
      />}
      <div className={styles.content}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{WORK_KIND_LABEL[workspace.kind]} · assigned work</p>
            <h1>{workspace.title}</h1>
          </div>
          {embedded && <button className={styles.closeEmbedded} type="button" onClick={requestClose}>Close work</button>}
        </header>

        {workspace.approvedScope && (
          <ApprovedScope scope={workspace.approvedScope} headingRef={approvedScopeHeading} />
        )}

        {workspace.workStatus === 'done' ? (
          <section className={styles.state} aria-labelledby="work-complete">
            <p className={styles.stateMark}>Complete</p>
            <h2 ref={completionHeading} id="work-complete" tabIndex={-1}>Work complete</h2>
            <p className={styles.savedNote}>{workspace.workNotes ?? 'Completed as approved.'}</p>
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
            <p>Start when you begin the approved job. Personal job timing follows your setting.</p>
            <button className={styles.primary} type="button" disabled={pending !== null}
              onClick={() => mutateWork(
                { action: 'start_work', expectedUpdatedAt: workspace.updatedAt },
                'work',
                'Starting work…',
                'Work started.',
                { kind: 'start_work' },
              )}>
              {pending === 'work' ? 'Starting work…' : 'Start work'}
            </button>
          </section>
        ) : (
          <>
            <section className={styles.state} aria-labelledby="progress-heading">
              <p className={styles.stateMark}>Now</p>
              <h2 id="progress-heading">Work in progress</h2>
              {(workspace.timerEnabled || workspace.clockedOnSince || workspace.activeSeconds > 0) && (
                <JobClock
                  clockedOnSince={workspace.clockedOnSince}
                  activeSeconds={workspace.activeSeconds}
                  completedAt={null}
                />
              )}
              {(workspace.timerEnabled || workspace.clockedOnSince) && (
                <div className={styles.timerTool}>
                  <p className={styles.helper}>Personal job time only. Not payroll or a performance score.</p>
                  <button className={styles.secondary} type="button" disabled={pending !== null}
                    onClick={() => workspace.clockedOnSince
                      ? mutateWork(
                        { action: 'clock_off' },
                        'clock',
                        'Clocking off…',
                        'Clocked off. Time saved.',
                        { kind: 'clock_off' },
                      )
                      : mutateWork(
                        { action: 'clock_on' },
                        'clock',
                        'Clocking on…',
                        'Clocked on.',
                        { kind: 'clock_on' },
                      )}>
                    {pending === 'clock' ? 'Saving…' : workspace.clockedOnSince ? 'Clock off' : 'Clock on'}
                  </button>
                </div>
              )}
            </section>
            <section className={styles.module} aria-labelledby="work-rail-heading">
              <div className={styles.moduleHeading}><span>01</span><h2 id="work-rail-heading">Finish this job</h2></div>
              <p className={styles.helper}>The approved scope is the record. Add detail only when something extra is worth keeping.</p>
              {detailConflict && (
                <div className={styles.detailConflict} role="group" aria-label="Choose saved detail">
                  <div><strong>Your detail</strong><p>{detailConflict.local || 'No extra detail.'}</p></div>
                  <div><strong>Saved elsewhere</strong><p>{detailConflict.saved || 'No extra detail.'}</p></div>
                  <div className={styles.actionRow}>
                    <button className={styles.secondary} type="button" onClick={() => {
                      setDetail(detailConflict.local); setDetailOpen(true); setDetailConflict(null)
                    }}>Use my detail</button>
                    <button className={styles.secondary} type="button" onClick={() => {
                      setDetail(detailConflict.saved); setDetailOpen(detailConflict.saved.length > 0); setDetailConflict(null)
                    }}>Use saved detail</button>
                  </div>
                </div>
              )}
              {detailOpen && !detailConflict && (
                <div className={styles.detailField}>
                  <label className={styles.label} htmlFor="work-detail">Anything worth recording? (optional)</label>
                  <textarea id="work-detail" value={detail} maxLength={2000}
                    onChange={(event) => setDetail(event.target.value)} />
                  <span className={styles.detailCount}>{detail.length} / 2,000</span>
                </div>
              )}
              {completionBlocker && <p className={styles.helper}>{completionBlocker}</p>}
              <div className={styles.workRailActions}>
                <button className={styles.primary} type="button"
                  disabled={pending !== null || completionBlocker !== null}
                  onClick={completeWork}>
                  {pending === 'complete'
                    ? 'Completing…'
                    : hasNewDetail
                      ? 'Complete with detail'
                      : 'Complete as approved'}
                </button>
                {!detailOpen && !detailConflict && (
                  <button className={styles.secondary} type="button" disabled={pending !== null}
                    onClick={() => setDetailOpen(true)}>Add detail</button>
                )}
              </div>
            </section>
            <PartsNeededPanel
              ticketId={ticket.id}
              jobId={workspace.id}
              initialRequests={initialPartRequests}
              onDraftChange={setPartsDraftDirty}
              initialDraft={partsDraft}
              onDraft={setPartsDraft}
              onRequestSaved={() => {
                setPartsDraft(EMPTY_PARTS_DRAFT)
                setPartsDraftDirty(false)
              }}
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
                  <option value="schedule">No room or time yet</option>
                  <option value="shop">Shop is deciding</option>
                </select>
                <label className={styles.label} htmlFor="hold-note">What needs to happen next?</label>
                <textarea id="hold-note" value={holdNote} maxLength={500} onChange={(event) => setHoldNote(event.target.value)} />
                {hasOtherUnsavedDraft && <p className={styles.helper}>Clear the open draft before placing work on hold.</p>}
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
                  <label className={styles.label} htmlFor="concern-tier">Who can do it</label>
                  <select id="concern-tier" value={tier} onChange={(event) => {
                    setTier(event.target.value as SimpleWorkDraftValues['tier']); escalationAttempt.current = null
                  }}>
                    <option value="">Choose one</option><option value="1">C-tech</option>
                    <option value="2">B-tech</option><option value="3">A-tech</option>
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

function ApprovedScope({
  scope,
  headingRef,
}: {
  scope: NonNullable<SimpleWorkWorkspaceView['approvedScope']>
  headingRef?: React.RefObject<HTMLHeadingElement | null>
}) {
  return (
    <section className={styles.approvedScope} aria-labelledby="approved-scope-heading">
      <div>
        <p className={styles.eyebrow}>{scope.authorizationPurpose === 'diagnosis' ? 'Diagnostic authorization' : 'Approved scope'}</p>
        <h2 id="approved-scope-heading" ref={headingRef} tabIndex={-1}>Exactly what is approved</h2>
      </div>
      <ul>
        {scope.lines.map((line, index) => (
          <li key={`${line.kind}:${index}:${line.description}`}>
            <span>{line.kind}</span>
            <strong>{line.description}</strong>
            {line.kind === 'labor' && <small>{line.hours} labor {line.hours === '1' ? 'hour' : 'hours'}</small>}
            {line.kind === 'part' && <small>{line.quantity} × {[line.brand, line.partNumber].filter(Boolean).join(' · ') || 'specified part'}</small>}
          </li>
        ))}
      </ul>
      {scope.customerSuppliedPartsNote && (
        <p className={styles.customerSupplied}>Customer supplied: {scope.customerSuppliedPartsNote}</p>
      )}
    </section>
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
