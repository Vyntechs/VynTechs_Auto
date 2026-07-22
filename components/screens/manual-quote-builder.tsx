'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  buildManualLineInput,
  classifyQuoteFailure,
  formatMoneyCents,
  getQuotePreparationState,
  parseCustomerStoryMutationResponse,
  parseCustomerStoryWorkspaceResponse,
  parseQuoteBuilderProjection,
  parseQuoteDecisionResponse,
  parsePreparedVersionResponse,
  summarizeQuoteMoney,
  type ManualLineFormValues,
  type ManualLineKind,
} from '@/lib/shop-os/quote-builder-ui'
import {
  parseAppliedCannedJobResponse,
  isJobLimitReachedFailure,
  type SafeCannedJobTemplate,
} from '@/lib/shop-os/canned-jobs-ui'
import {
  parseManualOfferRemovalResponse,
  selectLockedDiagnosisSeed,
  type SafeManualVendorAccount,
  type SafeSourcedQuoteLine,
} from '@/lib/shop-os/parts-sourcing-ui'
import {
  encodeQuoteEditorDraft,
  parseQuoteEditorDraft,
  quoteEditorDraftKey,
} from '@/lib/shop-os/quote-editor-draft'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import { CUSTOMER_STORY_WAIVER } from '@/lib/shop-os/customer-story-contracts'
import { ManualPartSourcing } from './manual-part-sourcing'
import styles from './manual-quote-builder.module.css'

type QuoteBuilder = Extract<QuoteBuilderResult, { ok: true }>['builder']

export type QuoteTicketIdentity = {
  id: string
  ticketNumber: number
  concern: string
  customer: { name: string } | null
  vehicle: { year: number | null; make: string | null; model: string | null } | null
}

export function ManualQuoteBuilder({
  actorId = null,
  ticket,
  builder,
  cannedJobs = [],
  cannedCatalogAvailable = true,
  vendorAccounts = [],
  vendorCatalogAvailable = false,
  canCreateVendorAccount = false,
  embedded = false,
  onClose,
  onProjection,
  onReloadCatalog,
}: {
  actorId?: string | null
  ticket: QuoteTicketIdentity
  builder: QuoteBuilder
  cannedJobs?: SafeCannedJobTemplate[]
  cannedCatalogAvailable?: boolean
  vendorAccounts?: SafeManualVendorAccount[]
  vendorCatalogAvailable?: boolean
  canCreateVendorAccount?: boolean
  embedded?: boolean
  onClose?: () => void
  onProjection?: (jobs: Array<{
    id: string
    workStatus: 'open' | 'in_progress' | 'blocked'
    approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined' | 'deferred'
  }>) => void
  onReloadCatalog?: () => void
}): React.JSX.Element {
  const router = useRouter()
  const [current, setCurrent] = useState(builder)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [error, setError] = useState<{
    message: string
    refresh: boolean
    reloadPage?: boolean
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'refresh' | 'line' | 'remove' | 'prepare' | 'canned' | 'sourcing' | null>(null)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [confirmedTarget, setConfirmedTarget] = useState<string | null>(null)
  const [selectedCannedId, setSelectedCannedId] = useState<string | null>(null)
  const [cannedClientKey, setCannedClientKey] = useState<string | null>(null)
  const [decision, setDecision] = useState<DecisionState | null>(null)
  const [accounts, setAccounts] = useState(vendorAccounts)
  const [sourcingJobId, setSourcingJobId] = useState<string | null>(null)
  const [pendingSourcedRemoval, setPendingSourcedRemoval] = useState<{
    jobId: string
    lineId: string
  } | null>(null)
  const [decisionVerdicts, setDecisionVerdicts] = useState<Record<string, string>>({})
  const focusRefs = useRef(new Map<string, HTMLElement>())
  const inFlightRef = useRef(false)
  const editorFirstInputRef = useRef<HTMLInputElement>(null)
  const editorFocusKeyRef = useRef<string | null>(null)
  const recoveryRefreshRef = useRef<HTMLButtonElement>(null)
  const cannedSelectRef = useRef<HTMLSelectElement>(null)
  const cannedUnavailableRef = useRef<HTMLDivElement>(null)
  const reloadPendingRef = useRef(false)
  const resetCannedSelectionOnReloadRef = useRef(false)
  const sourcingSavedCloseRef = useRef(false)
  const reloadBaselineRef = useRef<{
    builder: QuoteBuilder
    catalogSignature: string
    available: boolean
  } | null>(null)
  const selectedFingerprintRef = useRef<string | null>(null)
  const draftRecoveryAttemptedRef = useRef(false)
  const quotePath = `/tickets/${ticket.id}/quote`
  const catalogSignature = cannedJobs.map((job) => `${job.id}:${job.fingerprint}`).join('|')

  useEffect(() => setCurrent(builder), [builder])
  useEffect(() => {
    if (!actorId || draftRecoveryAttemptedRef.current) return
    draftRecoveryAttemptedRef.current = true
    let key: string
    try {
      key = quoteEditorDraftKey(actorId, ticket.id)
    } catch {
      return
    }
    const raw = sessionStorage.getItem(key)
    if (!raw) return
    const draft = parseQuoteEditorDraft(raw, { actorId, ticketId: ticket.id })
    if (!draft) {
      sessionStorage.removeItem(key)
      return
    }
    const job = current.jobs.find((candidate) => candidate.id === draft.jobId)
    const line = draft.lineId
      ? job?.lines.find((candidate) => candidate.id === draft.lineId)
      : undefined
    if (!job || (draft.mode === 'edit' && (
      !line || !line.mutable || line.kind !== draft.kind
    ))) {
      sessionStorage.removeItem(key)
      return
    }
    setEditor({
      mode: draft.mode,
      jobId: draft.jobId,
      kind: draft.kind,
      line,
      values: draft.values,
      dirty: true,
      hoursChanged: draft.hoursChanged,
      clientKey: draft.clientKey,
      invokerKey: editorInvokerKey({
        mode: draft.mode,
        jobId: draft.jobId,
        kind: draft.kind,
        line,
      }),
    })
    setStatusMessage(`Unsaved ${draft.kind} restored`)
  }, [actorId, current.jobs, ticket.id])
  useEffect(() => {
    if (!actorId || !editor?.dirty) return
    try {
      const key = quoteEditorDraftKey(actorId, ticket.id)
      sessionStorage.setItem(key, encodeQuoteEditorDraft({
        version: 1,
        actorId,
        ticketId: ticket.id,
        jobId: editor.jobId,
        mode: editor.mode,
        kind: editor.kind,
        lineId: editor.line?.id ?? null,
        values: editor.values,
        hoursChanged: editor.hoursChanged,
        clientKey: editor.clientKey,
        savedAt: Date.now(),
      }))
    } catch {
      setStatusMessage('Draft remains open, but reload protection is unavailable')
    }
  }, [actorId, editor, ticket.id])
  useEffect(() => {
    if (!editor?.dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [editor?.dirty])
  useEffect(() => {
    if (!confirmedTarget) return
    const timer = window.setTimeout(() => setConfirmedTarget(null), 1_200)
    return () => window.clearTimeout(timer)
  }, [confirmedTarget])
  useEffect(() => {
    onProjection?.(current.jobs.map((job) => ({
      id: job.id,
      workStatus: job.workStatus,
      approvalState: job.approval.state,
    })))
  }, [current, onProjection])
  useEffect(() => {
    if (!reloadPendingRef.current || !reloadBaselineRef.current) return
    const baseline = reloadBaselineRef.current
    const changed = baseline.builder !== builder
      || baseline.catalogSignature !== catalogSignature
      || baseline.available !== cannedCatalogAvailable
    if (!changed) return
    reloadPendingRef.current = false
    reloadBaselineRef.current = null
    const selectionStillCurrent = !resetCannedSelectionOnReloadRef.current
      && selectedCannedId !== null && cannedJobs.some((job) =>
      job.id === selectedCannedId && job.fingerprint === selectedFingerprintRef.current)
    if (!selectionStillCurrent) {
      setSelectedCannedId(null)
      setCannedClientKey(null)
      selectedFingerprintRef.current = null
    }
    resetCannedSelectionOnReloadRef.current = false
    setError(null)
    setTimeout(() => {
      if (cannedCatalogAvailable) cannedSelectRef.current?.focus()
      else cannedUnavailableRef.current?.focus()
    }, 0)
  }, [builder, cannedCatalogAvailable, cannedJobs, catalogSignature, selectedCannedId])
  useEffect(() => {
    if (!focusTarget) return
    const element = focusRefs.current.get(focusTarget)
    if (element) {
      queueMicrotask(() => element.focus())
      setFocusTarget(null)
    }
  }, [current, focusTarget])
  useEffect(() => {
    if (error?.refresh && pendingSourcedRemoval) {
      queueMicrotask(() => recoveryRefreshRef.current?.focus())
    }
  }, [error, pendingSourcedRemoval])
  useEffect(() => {
    // When a line editor opens (not on every keystroke), bring it into view and
    // focus its first field. On mobile the editor renders far below the tapped
    // Add button, so without this the tap looks inert; focusing also un-pins the
    // fixed Prepare bar so it can't cover the editor's actions.
    if (!editor) {
      editorFocusKeyRef.current = null
      return
    }
    const key = `${editor.mode}:${editor.jobId}:${editor.kind}:${editor.line?.id ?? 'new'}`
    if (editorFocusKeyRef.current === key) return
    editorFocusKeyRef.current = key
    const input = editorFirstInputRef.current
    if (!input) return
    queueMicrotask(() => {
      input.focus()
      const bounds = input.getBoundingClientRect()
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
        try { input.scrollIntoView({ block: 'center' }) } catch { /* layout-less env */ }
      }
    })
  }, [editor])

  const lines = current.jobs.flatMap((job) => job.lines)
  const sourcingJob = sourcingJobId
    ? current.jobs.find((job) => job.id === sourcingJobId) ?? null
    : null
  const diagnosisSeed = selectLockedDiagnosisSeed(current.jobs)
  const selectedCannedJob = cannedJobs.find((job) => job.id === selectedCannedId) ?? null
  const totals = summarizeQuoteMoney(lines, current.configuration.taxRateBps)
  const basePreparation = getQuotePreparationState({
    builder: current,
    totals,
    editorOpen: editor !== null || sourcingJob !== null,
    modalOpen: modal !== null,
    busy,
  })
  const pendingStory = !current.activeVersion && current.jobs.some((job) =>
    job.kind === 'diagnostic' && job.lines.length > 0
      && job.storyMode !== 'authorization_only'
      && (job.story.content === null || job.story.reviewStatus !== 'reviewed'))
  const preparation = basePreparation.kind === 'ready' && pendingStory
    ? { kind: 'blocked' as const, reasons: ['Review every diagnostic story.'] }
    : basePreparation

  function beginOperation(kind: NonNullable<typeof operation>): boolean {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    setBusy(true)
    setOperation(kind)
    return true
  }

  function endOperation(): void {
    inFlightRef.current = false
    setBusy(false)
    setOperation(null)
  }

  function requestEditor(target: EditorTarget, invoker: HTMLElement): void {
    if (inFlightRef.current || modal || sourcingJobId) return
    if (editor?.dirty) {
      setModal({ kind: 'discard', target, invoker })
      return
    }
    clearStoredEditorDraft()
    setError(null)
    setEditor(createEditor(target))
  }

  function requestEmbeddedClose(invoker: HTMLElement): void {
    if (inFlightRef.current || modal || sourcingJobId) return
    if (editor?.dirty) {
      setModal({ kind: 'discard-close', target: editor, invoker })
      return
    }
    onClose?.()
  }

  function createEditor(target: EditorTarget): EditorState {
    const line = target.line
    return {
      ...target,
      dirty: false,
      hoursChanged: false,
      clientKey: target.mode === 'create' ? crypto.randomUUID() : null,
      values: line ? valuesFromLine(line) : emptyValues(),
      invokerKey: editorInvokerKey(target),
    }
  }

  function clearStoredEditorDraft(): void {
    if (!actorId) return
    try {
      sessionStorage.removeItem(quoteEditorDraftKey(actorId, ticket.id))
    } catch {
      // Storage is an optional reload guard. The mounted editor remains authoritative.
    }
  }

  function cancelEditor(): void {
    if (inFlightRef.current || !editor) return
    const invokerKey = editor.invokerKey
    clearStoredEditorDraft()
    setEditor(null)
    setError(null)
    setStatusMessage('Draft cleared')
    setTimeout(() => focusRefs.current.get(invokerKey)?.focus(), 0)
  }

  function updateValue<K extends keyof ManualLineFormValues>(
    key: K,
    value: ManualLineFormValues[K],
  ): void {
    setEditor((active) => active ? {
      ...active,
      dirty: true,
      hoursChanged: active.hoursChanged || key === 'hours',
      clientKey: active.mode === 'create' ? crypto.randomUUID() : active.clientKey,
      values: { ...active.values, [key]: value },
    } : null)
  }

  async function readJson(response: Response): Promise<unknown> {
    try { return await response.json() } catch { return {} }
  }

  function applyFailure(status: number, body: unknown, forceRefresh = false): void {
    const action = classifyQuoteFailure(status, body, quotePath)
    if (action.kind === 'navigate') {
      if (status === 404) router.replace(action.href)
      else router.push(action.href)
      return
    }
    setError({ message: action.message, refresh: forceRefresh || action.refresh })
  }

  async function refreshQuote(
    nextFocus?: string,
    closeEditor = false,
    nested = false,
    expectedVersion?: { id: string; versionNumber: number },
    expectedAppliedJob?: {
      id: string
      title: string
      kind: 'repair' | 'maintenance'
      lineCount: number
    },
    expectedSourcedLine?:
      | { line: SafeSourcedQuoteLine; state: 'present' }
      | { jobId: string; lineId: string; state: 'absent' },
  ): Promise<boolean> {
    const ownsOperation = !nested
    if (ownsOperation && !beginOperation('refresh')) return false
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/quote`, {
        method: 'GET', headers: { accept: 'application/json' },
      })
      const body = await readJson(response)
      if (!response.ok) {
        applyFailure(response.status, body, expectedSourcedLine?.state === 'absent')
        return false
      }
      const refreshed = body && typeof body === 'object' && 'builder' in body
        ? parseQuoteBuilderProjection((body as { builder: unknown }).builder)
        : null
      if (!refreshed || refreshed.ticket.id !== ticket.id.toLowerCase()) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return false
      }
      if (expectedVersion && (
        refreshed.activeVersion?.id !== expectedVersion.id
        || refreshed.activeVersion.versionNumber !== expectedVersion.versionNumber
      )) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return false
      }
      if (expectedAppliedJob) {
        const appliedJob = refreshed.jobs.find((job) => job.id === expectedAppliedJob.id)
        if (
          !appliedJob
          || appliedJob.title !== expectedAppliedJob.title
          || appliedJob.kind !== expectedAppliedJob.kind
          || appliedJob.lines.length !== expectedAppliedJob.lineCount
          || refreshed.activeVersion !== null
        ) {
          setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
          return false
        }
      }
      if (expectedSourcedLine) {
        const jobId = expectedSourcedLine.state === 'present'
          ? expectedSourcedLine.line.jobId
          : expectedSourcedLine.jobId
        const lineId = expectedSourcedLine.state === 'present'
          ? expectedSourcedLine.line.id
          : expectedSourcedLine.lineId
        const expectedJob = refreshed.jobs.find((job) => job.id === jobId)
        const expectedLine = expectedJob?.lines.find((line) => line.id === lineId)
        const expectationMet = refreshed.activeVersion === null && (expectedSourcedLine.state === 'present'
          ? expectedLine?.id === expectedSourcedLine.line.id
            && expectedJob?.id === expectedSourcedLine.line.jobId
            && expectedLine.kind === expectedSourcedLine.line.kind
            && expectedLine.source === expectedSourcedLine.line.source
            && expectedLine.mutable === expectedSourcedLine.line.mutable
            && expectedLine.description === expectedSourcedLine.line.description
            && expectedLine.quantity === expectedSourcedLine.line.quantity
            && expectedLine.priceCents === expectedSourcedLine.line.priceCents
            && expectedLine.taxable === expectedSourcedLine.line.taxable
            && expectedLine.partNumber === expectedSourcedLine.line.partNumber
            && expectedLine.brand === expectedSourcedLine.line.brand
            && expectedLine.fitment === expectedSourcedLine.line.fitment
          : Boolean(expectedJob) && expectedLine === undefined)
        if (!expectationMet) {
          setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
          return false
        }
      }
      setCurrent(refreshed)
      setError(null)
      const editorLineStillExists = editor?.mode !== 'edit' || refreshed.jobs.some((job) =>
        job.id === editor.jobId && job.lines.some((line) => line.id === editor.line?.id))
      if (closeEditor || !editorLineStillExists) setEditor(null)
      if (nextFocus) setFocusTarget(nextFocus)
      return true
    } catch {
      setError({
        message: 'Connection interrupted. Retry with the same details.',
        refresh: expectedSourcedLine?.state === 'absent',
      })
      return false
    } finally {
      if (ownsOperation) endOperation()
    }
  }

  async function submitEditor(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!editor || inFlightRef.current) return
    let line: Record<string, unknown>
    try {
      const laborRate = editor.mode === 'edit' && editor.line?.kind === 'labor'
        ? editor.line.laborRateCents
        : current.configuration.laborRateCents
      line = buildManualLineInput(
        editor.kind,
        editor.values,
        laborRate,
      )
      if (editor.mode === 'edit' && editor.line) line.sort = editor.line.sort
      if (
        editor.mode === 'edit'
        && editor.line?.kind === 'labor'
        && !editor.hoursChanged
      ) {
        line.priceCents = editor.line.priceCents
      }
      if (editor.mode === 'edit' && editor.line?.kind === 'part') {
        line.coreChargeCents = editor.line.coreChargeCents
      }
    } catch {
      setError({ message: 'Review the visible fields, then refresh and retry.', refresh: false })
      return
    }

    const base = `/api/tickets/${ticket.id}/quote/jobs/${editor.jobId}/lines`
    const url = editor.mode === 'create' ? base : `${base}/${editor.line?.id}`
    const body = editor.mode === 'create'
      ? { clientKey: editor.clientKey, line }
      : line
    if (!beginOperation('line')) return
    setError(null)
    try {
      const response = await fetch(url, {
        method: editor.mode === 'create' ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await readJson(response)
      if (!response.ok) {
        applyFailure(response.status, result)
        return
      }
      const returnedLine = result && typeof result === 'object' && 'line' in result
        ? (result as { line?: { id?: unknown } }).line
        : null
      const lineId = typeof returnedLine?.id === 'string'
        ? returnedLine.id
        : editor.line?.id
      const target = lineId ? `line:${lineId}` : `add:${editor.jobId}:${editor.kind}`
      const refreshed = await refreshQuote(target, true, true)
      if (refreshed) {
        clearStoredEditorDraft()
        setConfirmedTarget(target)
        setStatusMessage(`${capitalize(editor.kind)} ${editor.mode === 'create' ? 'added' : 'updated'}`)
      }
    } catch {
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  async function confirmRemove(): Promise<void> {
    if (modal?.kind !== 'remove' || !beginOperation('remove')) return
    const removeTarget = modal.target
    setError(null)
    try {
      const response = await fetch(
        `/api/tickets/${ticket.id}/quote/jobs/${removeTarget.jobId}/lines/${removeTarget.line.id}`,
        { method: 'DELETE', headers: { accept: 'application/json' } },
      )
      const body = await readJson(response)
      if (!response.ok) {
        closeModal()
        applyFailure(response.status, body)
        return
      }
      const jobId = removeTarget.jobId
      setModal(null)
      if (editor?.mode === 'edit' && editor.line?.id === removeTarget.line.id) setEditor(null)
      await refreshQuote(`add:${jobId}:part`, false, true)
    } catch {
      closeModal()
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  async function confirmSourcedRemove(): Promise<void> {
    if (modal?.kind !== 'remove-sourced' || !beginOperation('remove')) return
    const removeTarget = modal.target
    setError(null)
    try {
      const response = await fetch(
        `/api/tickets/${ticket.id}/quote/jobs/${removeTarget.jobId}/parts/manual-offers/${removeTarget.line.id}`,
        { method: 'DELETE', headers: { accept: 'application/json' } },
      )
      const body = await readJson(response)
      if (!response.ok) {
        closeModal()
        applyFailure(response.status, body)
        return
      }
      if (!parseManualOfferRemovalResponse(response.status, body)) {
        closeModal()
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return
      }
      const recovery = {
        jobId: removeTarget.jobId,
        lineId: removeTarget.line.id,
      }
      setPendingSourcedRemoval(recovery)
      setModal(null)
      await recoverSourcedRemoval(recovery, true)
    } catch {
      closeModal()
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  async function recoverSourcedRemoval(
    recovery: NonNullable<typeof pendingSourcedRemoval>,
    nested = false,
  ): Promise<void> {
    const refreshed = await refreshQuote(
      `source:${recovery.jobId}`,
      false,
      nested,
      undefined,
      undefined,
      { jobId: recovery.jobId, lineId: recovery.lineId, state: 'absent' },
    )
    if (refreshed) setPendingSourcedRemoval(null)
  }

  async function prepareQuote(): Promise<void> {
    if (preparation.kind !== 'ready' || !beginOperation('prepare')) return
    setError(null)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/quote/versions`, {
        method: 'POST',
        headers: { accept: 'application/json' },
      })
      const body = await readJson(response)
      if (!response.ok) {
        applyFailure(response.status, body)
        return
      }
      const prepared = parsePreparedVersionResponse(response.status, body)
      if (!prepared) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return
      }
      // Preparation changes the operator's next decision. Move focus to the
      // first authorization strip, rather than leaving it on a passive status
      // message below a long mobile quote workspace.
      const firstDecisionJob = current.jobs.find((job) => job.workStatus === 'open')
      await refreshQuote(
        firstDecisionJob ? `decision:${firstDecisionJob.id}` : 'prepared',
        false,
        true,
        prepared.version,
      )
    } catch {
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  function openDecision(
    job: QuoteBuilder['jobs'][number],
    kind: 'phone' | 'in_person' | 'declined' | 'deferred',
    invoker: HTMLButtonElement,
  ): void {
    const version = current.activeVersion
    const versionJob = version?.jobs.find((item) => item.jobId === job.id)
    if (!version || !versionJob || !job.decisionEligible
      || !current.capabilities.canRecordCustomerApproval) return
    setDecision({
      jobId: job.id, title: job.title, kind, requestKey: crypto.randomUUID(),
      versionId: version.id, versionNumber: version.versionNumber,
      jobSubtotalCents: versionJob.subtotalCents, totalCents: version.totalCents,
      busy: false, error: null, reason: '', invoker,
    })
  }

  async function submitDecision(): Promise<void> {
    if (!decision || decision.busy) return
    const pending = decision
    setDecision({ ...pending, busy: true, error: null })
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/quote/decisions`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          requestKey: pending.requestKey, jobId: pending.jobId,
          quoteVersionId: pending.versionId,
          decision: pending.kind === 'declined' || pending.kind === 'deferred' ? pending.kind : 'approved',
          ...(pending.kind === 'deferred'
            ? { reason: pending.reason.trim() }
            : pending.kind === 'declined'
              ? {}
              : { approvedVia: pending.kind }),
        }),
      })
      const body = await readJson(response)
      if (!response.ok) {
        setDecision({ ...pending, busy: false, error: response.status === 409
          ? 'Quote changed. Refresh before recording this decision.'
          : 'Review the visible fields, then retry.' })
        return
      }
      const parsed = parseQuoteDecisionResponse(response.status, body)
      const changedApprovalMatches = parsed?.changed === true
        && pending.kind !== 'declined'
        && parsed.event.kind === 'approved'
        && parsed.event.approvedVia === pending.kind
        && parsed.event.quoteVersionId === pending.versionId
        && parsed.projection.approvalState === 'approved'
        && parsed.projection.approvedQuoteVersionId === pending.versionId
      const changedDeclineMatches = parsed?.changed === true
        && pending.kind === 'declined'
        && parsed.event.kind === 'declined'
        && parsed.event.quoteVersionId === pending.versionId
        && parsed.projection.approvalState === 'declined'
        && parsed.projection.approvedQuoteVersionId === null
      const changedDeferralMatches = parsed?.changed === true
        && pending.kind === 'deferred'
        && parsed.event.kind === 'deferred'
        && parsed.event.quoteVersionId === pending.versionId
        && parsed.projection.approvalState === 'deferred'
        && parsed.projection.approvedQuoteVersionId === null
      if (!parsed || parsed.event.jobId !== pending.jobId
        || (parsed.changed && !changedApprovalMatches && !changedDeclineMatches && !changedDeferralMatches)) {
        setDecision({ ...pending, busy: false, error: 'Server truth did not match this decision. Refresh and retry.' })
        return
      }
      if (parsed.changed) {
        setCurrent((active) => ({
          ...active,
          jobs: active.jobs.map((job) => job.id === pending.jobId
            ? { ...job, approval: {
              state: parsed.projection.approvalState,
              quoteVersionId: parsed.projection.approvedQuoteVersionId,
            } } : job),
        }))
      }
      setDecisionVerdicts((verdicts) => {
        const next = { ...verdicts }
        if (changedDeclineMatches) {
          next[pending.jobId] = `Declined · V${pending.versionNumber}`
        } else if (changedDeferralMatches) {
          next[pending.jobId] = `Deferred · follow up · V${pending.versionNumber}`
        } else if (changedApprovalMatches) {
          next[pending.jobId] = `Approved · ${parsed.event.approvedVia === 'phone' ? 'Phone' : 'In person'} · V${pending.versionNumber}`
        } else {
          delete next[pending.jobId]
        }
        return next
      })
      setDecision(null)
      setFocusTarget(`decision:${pending.jobId}`)
      const refreshed = await refreshQuote(`decision:${pending.jobId}`, false, true)
      if (refreshed) {
        setDecisionVerdicts((verdicts) => {
          const next = { ...verdicts }
          delete next[pending.jobId]
          return next
        })
      }
    } catch {
      setDecision({ ...pending, busy: false, error: 'Connection interrupted. Retry with the same decision.' })
    }
  }

  async function applyCannedJob(): Promise<void> {
    if (!selectedCannedJob || !cannedClientKey || editor || modal || sourcingJobId || inFlightRef.current) return
    if (selectedCannedJob.kind === 'diagnostic') {
      setError({ message: 'Diagnostic authorization templates are selected during intake.', refresh: false })
      return
    }
    if (!beginOperation('canned')) return
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/quote/canned-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          clientKey: cannedClientKey,
          cannedJobId: selectedCannedJob.id,
          expectedFingerprint: selectedCannedJob.fingerprint,
          expectedTaxRateBps: current.configuration.taxRateBps,
        }),
      })
      const body = await readJson(response)
      if (!response.ok) {
        const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
        if (isJobLimitReachedFailure(response.status, body)) {
          setError({
            message: 'This repair order already has 25 jobs. Remove a job before adding another.',
            refresh: true,
          })
        } else if (response.status === 404 || (response.status === 409 && record.retryable !== true)) {
          resetCannedSelectionOnReloadRef.current = true
          setError({
            message: 'Quote or canned-job context changed. Refresh canned jobs and choose again.',
            refresh: true,
            reloadPage: true,
          })
        } else {
          applyFailure(response.status, body)
        }
        return
      }
      const applied = parseAppliedCannedJobResponse(response.status, body)
      if (!applied) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return
      }
      if (
        applied.job.title !== selectedCannedJob.title
        || applied.job.kind !== selectedCannedJob.kind
        || applied.job.requiredSkillTier !== selectedCannedJob.defaultRequiredSkillTier
        || applied.job.lineCount !== selectedCannedJob.lines.length
      ) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return
      }
      const expectedAppliedJob = {
        id: applied.job.id,
        title: selectedCannedJob.title,
        kind: selectedCannedJob.kind,
        lineCount: selectedCannedJob.lines.length,
      }
      const refreshed = await refreshQuote(`job:${applied.job.id}`, false, true, undefined, expectedAppliedJob)
      if (refreshed) {
        setSelectedCannedId(null)
        setCannedClientKey(null)
      }
    } catch {
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  function closeModal(restore: 'invoker' | 'editor' = 'invoker'): void {
    const invoker = modal?.invoker
    setModal(null)
    setTimeout(() => {
      if (restore === 'editor') editorFirstInputRef.current?.focus()
      else invoker?.focus()
    }, 0)
  }

  function reloadCannedPage(): void {
    reloadPendingRef.current = true
    reloadBaselineRef.current = { builder, catalogSignature, available: cannedCatalogAvailable }
    if (embedded && onReloadCatalog) onReloadCatalog()
    else router.refresh()
  }

  function setSourcingBusy(nextBusy: boolean): void {
    if (nextBusy) beginOperation('sourcing')
    else if (inFlightRef.current) endOperation()
  }

  const decidedVersion = embedded
    && current.activeVersion
    && current.jobs.length > 0
    && current.jobs.every((job) => (
      job.approval.state === 'approved' || job.approval.state === 'declined'
    ))
    && !editor
    && !modal
    && !decision
    && !sourcingJob
    && !busy
    && !error
      ? current.activeVersion
      : null

  if (decidedVersion) {
    return (
      <section className={styles.embeddedProof} aria-label="Quote workspace">
        <div className={styles.embeddedProofHead}>
          <div>
            <p className={styles.eyebrow}>Quote V{decidedVersion.versionNumber} · recorded</p>
            <h2>Quote complete</h2>
          </div>
          <button className={styles.closeEmbedded} type="button" onClick={onClose}>Close quote</button>
        </div>
        <ul className={styles.embeddedProofJobs}>
          {current.jobs.map((job) => (
            <li key={job.id}>
              <span>{job.title}</span>
              <strong>
                {job.approval.state === 'approved' ? 'Approved' : 'Declined'} · Version {decidedVersion.versionNumber}
              </strong>
            </li>
          ))}
        </ul>
        <div className={styles.embeddedProofTotal}>
          <span>Ticket total</span>
          <strong>{formatMoneyCents(decidedVersion.totalCents)}</strong>
        </div>
      </section>
    )
  }

  const Root = embedded ? 'section' : 'main'
  return (
    <Root
      className={`${embedded ? styles.embeddedScreen : `app ${styles.screen}`} ${sourcingJob ? styles.screenWithSourcing : ''}`}
      aria-label={embedded ? 'Quote workspace' : undefined}
    >
      {statusMessage && (
        <p className={styles.liveStatus} role="status" aria-label="Quote update" aria-live="polite">
          {statusMessage}
        </p>
      )}
      <div data-testid="quote-background" inert={modal || decision || sourcingJob ? true : undefined}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Repair order {String(ticket.ticketNumber).padStart(6, '0')}
          </p>
          {embedded ? <h2>Build quote</h2> : <h1>Build quote</h1>}
          {ticket.customer && ticket.vehicle && (
            <p className={styles.identity}>
              <span>{ticket.customer.name}</span>
              <span>{vehicleName(ticket.vehicle)}</span>
            </p>
          )}
        </div>
        {embedded ? (
          <button
            type="button"
            className={styles.closeEmbedded}
            onClick={(event) => requestEmbeddedClose(event.currentTarget)}
          >
            Close quote
          </button>
        ) : (
          <Link href={`/tickets/${ticket.id}`}>Back to ticket</Link>
        )}
      </div>

      <section className={styles.truth} aria-label="Quote readiness">
        <p>
          {current.ticket.reconciled
            ? 'Customer and vehicle · Ready'
            : 'Customer and vehicle · Still needed'}
        </p>
        <p>
          Labor rate · {current.configuration.laborRateCents === null
            ? 'Not configured'
            : `${formatMoneyCents(current.configuration.laborRateCents)}/hr`}
        </p>
        <p>
          Tax rate · {current.configuration.taxRateBps === null
            ? 'Not configured'
            : formatTaxRate(current.configuration.taxRateBps)}
        </p>
      </section>

      {!current.ticket.reconciled && (
        <p className={styles.notice}>
          Draft quote lines now. Prepare stays blocked until customer and vehicle are added.
        </p>
      )}

      <div className={styles.workspace}>
        <section className={styles.ledger} aria-labelledby="quote-jobs-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Persisted work</p>
              <h2 id="quote-jobs-heading">Quote ledger</h2>
            </div>
            <p>{current.jobs.length} {current.jobs.length === 1 ? 'job' : 'jobs'}</p>
          </div>

          {!cannedCatalogAvailable ? (
            <div className={styles.cannedUnavailable} tabIndex={-1} ref={cannedUnavailableRef}>
              <strong>Canned jobs unavailable</strong>
              <p>Manual quote lines remain available. Refresh before using the library.</p>
              <button type="button" className={styles.lineAction} onClick={reloadCannedPage}>
                Refresh canned jobs
              </button>
            </div>
          ) : cannedJobs.length === 0 ? (
            <p className={styles.cannedEmpty}>No canned jobs saved. Manual quote lines remain available.</p>
          ) : (
            <section className={styles.cannedPicker} aria-labelledby="canned-job-heading">
              <div>
                <p className={styles.eyebrow}>Saved work</p>
                <h3 id="canned-job-heading">Add canned job</h3>
              </div>
              <label htmlFor="quote-canned-job">Canned job</label>
              <select
                id="quote-canned-job"
                ref={cannedSelectRef}
                value={selectedCannedId ?? ''}
                disabled={busy}
                onChange={(event) => {
                  setSelectedCannedId(event.target.value || null)
                  setCannedClientKey(crypto.randomUUID())
                  selectedFingerprintRef.current = cannedJobs.find((job) => job.id === event.target.value)?.fingerprint ?? null
                  setError(null)
                }}
              >
                <option value="">Choose saved work</option>
                {cannedJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
              </select>
              {selectedCannedJob && (
                <div className={styles.cannedPreview} aria-live="polite">
                  <p className={styles.cannedFacts}>
                    {selectedCannedJob.kind === 'repair' ? 'Repair' : 'Maintenance'} · Tier {selectedCannedJob.defaultRequiredSkillTier}
                  </p>
                  <ul>
                    {selectedCannedJob.lines.map((line, index) => (
                      <li key={`${line.sort}:${index}:${line.description}`}>
                        <span>{cannedLineLabel(line)} · {line.description}</span>
                        <strong className={styles.money}>{formatMoneyCents(line.priceCents)}</strong>
                      </li>
                    ))}
                  </ul>
                  <dl>
                    <div><dt>Subtotal</dt><dd className={styles.money}>{formatMoneyCents(selectedCannedJob.summary.subtotalCents)}</dd></div>
                    <div><dt>Tax</dt><dd>{selectedCannedJob.summary.taxCents === null ? 'Not configured' : formatMoneyCents(selectedCannedJob.summary.taxCents)}</dd></div>
                    <div><dt>Total</dt><dd>{selectedCannedJob.summary.totalCents === null ? 'Unavailable' : formatMoneyCents(selectedCannedJob.summary.totalCents)}</dd></div>
                  </dl>
                  <button
                    type="button"
                    className={styles.cannedApply}
                    disabled={busy || editor !== null || modal !== null || sourcingJob !== null}
                    onClick={applyCannedJob}
                  >
                    {operation === 'canned' ? 'Adding…' : 'Add canned job'}
                  </button>
                </div>
              )}
            </section>
          )}

          {current.jobs.length === 0 ? (
            <p className={styles.empty}>No eligible jobs on this ticket.</p>
          ) : (
            <ol className={styles.jobs}>
              {current.jobs.map((job, index) => (
                <li
                  key={job.id}
                  className={styles.job}
                  data-change-state={confirmedTarget === `job:${job.id}` ? 'confirmed' : undefined}
                  tabIndex={-1}
                  ref={(element) => {
                    if (element) focusRefs.current.set(`job:${job.id}`, element)
                    else focusRefs.current.delete(`job:${job.id}`)
                  }}
                >
                  <div className={styles.jobNumber} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div className={styles.jobBody}>
                    <div className={styles.jobHeader}>
                      <div>
                        <p className={styles.eyebrow}>{job.kind} · {formatStatus(job.workStatus)}</p>
                        <h3>{job.title}</h3>
                      </div>
                      <p>{job.lines.length} {job.lines.length === 1 ? 'line' : 'lines'}</p>
                    </div>
                    {job.customerSuppliedPartsNote && (
                      <p className={styles.storyTruth}>
                        Customer supplied: {job.customerSuppliedPartsNote}
                      </p>
                    )}

                    {job.lines.length === 0 ? (
                      <p className={styles.empty}>No quote lines yet.</p>
                    ) : (
                      <ul className={styles.lines}>
                        {job.lines.map((line) => (
                          <li
                            key={line.id}
                            className={styles.line}
                            data-change-state={confirmedTarget === `line:${line.id}` ? 'confirmed' : undefined}
                            tabIndex={-1}
                            ref={(element) => {
                              if (element) focusRefs.current.set(`line:${line.id}`, element)
                              else focusRefs.current.delete(`line:${line.id}`)
                            }}
                          >
                            <div className={styles.lineLead}>
                              <div>
                                <p className={styles.lineKind}>{lineLabel(line)}</p>
                                <p className={styles.description}>{line.description}</p>
                              </div>
                              <div className={styles.linePrice}>
                                <span>Line price</span>
                                <strong className={styles.money}>{safeMoney(line.priceCents)}</strong>
                              </div>
                            </div>
                            <LineFacts line={line} />
                            {line.mutable ? <div className={styles.lineControls}>
                              <button
                                type="button"
                                className={styles.lineAction}
                                disabled={busy}
                                ref={(element) => {
                                  const key = `edit:${line.id}`
                                  if (element) focusRefs.current.set(key, element)
                                  else focusRefs.current.delete(key)
                                }}
                                onClick={(event) => requestEditor(
                                  { mode: 'edit', jobId: job.id, kind: line.kind, line },
                                  event.currentTarget,
                                )}
                              >
                                Edit {line.description}
                              </button>
                              <button
                                type="button"
                                className={styles.lineAction}
                                disabled={busy}
                                onClick={(event) => {
                                  if (!inFlightRef.current && !modal) {
                                    setModal({
                                      kind: 'remove', target: { jobId: job.id, line },
                                      invoker: event.currentTarget,
                                    })
                                  }
                                }}
                              >
                                Remove {line.description}
                              </button>
                            </div> : (
                              <div className={styles.lineControls}>
                                <p className={styles.lineKind}>Sourced · read-only</p>
                                {line.source === 'vendor_offer' && (
                                  <button
                                    type="button"
                                    className={styles.lineAction}
                                    disabled={busy || (
                                      pendingSourcedRemoval?.jobId === job.id
                                      && pendingSourcedRemoval.lineId === line.id
                                    )}
                                    onClick={(event) => {
                                      const removalPending = pendingSourcedRemoval?.jobId === job.id
                                        && pendingSourcedRemoval.lineId === line.id
                                      if (!removalPending && !inFlightRef.current && !modal && !sourcingJobId) {
                                        setModal({
                                          kind: 'remove-sourced', target: { jobId: job.id, line },
                                          invoker: event.currentTarget,
                                        })
                                      }
                                    }}
                                  >
                                    Remove sourced part: {line.description}
                                  </button>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className={styles.addActions}>
                      {(['part', 'labor', 'fee'] as const).map((kind) => {
                        const active = editor?.jobId === job.id
                          && editor.mode === 'create' && editor.kind === kind
                        const editorId = quoteEditorId(job.id)
                        return <button
                          key={kind}
                          type="button"
                          className={styles.lineAction}
                          disabled={busy}
                          aria-expanded={active}
                          aria-controls={active ? editorId : undefined}
                          data-active={active ? 'true' : undefined}
                          ref={(element) => {
                            const key = `add:${job.id}:${kind}`
                            if (element) focusRefs.current.set(key, element)
                            else focusRefs.current.delete(key)
                          }}
                          onClick={(event) => requestEditor(
                            { mode: 'create', jobId: job.id, kind },
                            event.currentTarget,
                          )}
                        >
                          {active ? `Adding ${kind}` : `Add ${kind}`}
                        </button>
                      })}
                      {(job.kind === 'repair' || job.kind === 'maintenance')
                        && (job.workStatus === 'open' || job.workStatus === 'blocked') && (
                        <button
                          type="button"
                          className={styles.lineAction}
                          disabled={busy || sourcingJobId !== null || editor !== null || modal !== null}
                          ref={(element) => {
                            const key = `source:${job.id}`
                            if (element) focusRefs.current.set(key, element)
                            else focusRefs.current.delete(key)
                          }}
                          onClick={() => {
                            if (inFlightRef.current || modal || editor || sourcingJobId) return
                            setError(null)
                            sourcingSavedCloseRef.current = false
                            setSourcingJobId(job.id)
                          }}
                        >
                          Source part
                        </button>
                      )}
                    </div>
                    {editor?.jobId === job.id && (
                      <LineEditor
                        id={quoteEditorId(job.id)}
                        editor={editor}
                        laborRateCents={current.configuration.laborRateCents}
                        busy={busy}
                        firstInputRef={editorFirstInputRef}
                        onChange={updateValue}
                        onCancel={cancelEditor}
                        onSubmit={submitEditor}
                      />
                    )}
                    {job.kind === 'diagnostic' && (
                      <StoryCard
                        ticketId={ticket.id}
                        ticketConcern={ticket.concern}
                        job={job}
                        focusRef={(element) => {
                          if (element) focusRefs.current.set(`story:${job.id}`, element)
                          else focusRefs.current.delete(`story:${job.id}`)
                        }}
                        onServerChange={() => refreshQuote(`story:${job.id}`)}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className={styles.tape} aria-label="Quote totals">
          <p className={styles.eyebrow}>Live quote tape</p>
          <h2>{current.activeVersion ? 'Prepared quote' : 'Current draft'}</h2>
          {!current.activeVersion && (!totals.ok ? (
            <div className={styles.blocked}>
              <strong>Totals unavailable</strong>
              <p>Stored quote money could not be totaled safely. Review the quote data.</p>
            </div>
          ) : (
            <dl className={styles.totalList}>
              <div>
                <dt>Subtotal</dt>
                <dd className={styles.money}>{formatMoneyCents(totals.subtotalCents)}</dd>
              </div>
              <div>
                <dt>Taxable subtotal</dt>
                <dd className={styles.money}>{formatMoneyCents(totals.taxableSubtotalCents)}</dd>
              </div>
              {totals.taxConfigured ? (
                <div>
                  <dt>Tax</dt>
                  <dd className={styles.money}>{formatMoneyCents(totals.taxCents)}</dd>
                </div>
              ) : (
                <div className={styles.unavailable}>
                  <dt>Tax — Not configured</dt>
                  <dd>—</dd>
                </div>
              )}
              <div className={styles.grandTotal}>
                <dt>Total</dt>
                <dd className={totals.totalCents === null ? undefined : styles.money}>
                  {totals.totalCents === null
                    ? 'Total unavailable'
                    : formatMoneyCents(totals.totalCents)}
                </dd>
              </div>
            </dl>
          ))}
          {!current.activeVersion && <p className={styles.version}>No prepared version</p>}
          {preparation.kind === 'prepared' ? (
            <div className={styles.preparedState}>
              <p role="status" aria-live="polite" tabIndex={-1} ref={(element) => {
                if (element) focusRefs.current.set('prepared', element)
                else focusRefs.current.delete('prepared')
              }}>Prepared version V{preparation.version.versionNumber}</p>
              {current.activeVersion?.jobs.map((versionJob) => {
                const job = current.jobs.find((candidate) => candidate.id === versionJob.jobId)
                return job ? (
                  <AuthorizationStrip
                    key={job.id}
                    job={job}
                    versionNumber={current.activeVersion!.versionNumber}
                    jobSubtotalCents={versionJob.subtotalCents}
                    totalCents={current.activeVersion!.totalCents}
                    canDecide={current.capabilities.canRecordCustomerApproval}
                    immediateVerdict={decisionVerdicts[job.id]}
                    focusRef={(element) => {
                      if (element) focusRefs.current.set(`decision:${job.id}`, element)
                      else focusRefs.current.delete(`decision:${job.id}`)
                    }}
                    onDecision={(kind, invoker) => openDecision(job, kind, invoker)}
                  />
                ) : null
              })}
            </div>
          ) : (
            <div className={styles.prepareState}>
              {preparation.kind === 'blocked' && (
                <ul>
                  {preparation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              <button
                type="button"
                className={styles.prepareAction}
                disabled={preparation.kind !== 'ready'}
                onClick={prepareQuote}
              >
                {operation === 'prepare' ? 'Preparing…' : 'Prepare quote'}
              </button>
            </div>
          )}
        </aside>
      </div>

      {error && (
        <div className={styles.error} aria-live="assertive">
          <p>{error.message}</p>
          {error.refresh && (
            <button
              type="button"
              className={styles.lineAction}
              disabled={busy}
              ref={pendingSourcedRemoval ? recoveryRefreshRef : undefined}
              onClick={() => error.reloadPage
                ? reloadCannedPage()
                : pendingSourcedRemoval
                  ? recoverSourcedRemoval(pendingSourcedRemoval)
                  : refreshQuote()}
            >
              {error.reloadPage ? 'Refresh canned jobs' : 'Refresh quote'}
            </button>
          )}
        </div>
      )}
      </div>

      {sourcingJob && (
        <ManualPartSourcing
          open
          ticketId={ticket.id}
          ticketLabel={`Repair order ${String(ticket.ticketNumber).padStart(6, '0')}`}
          vehicleLabel={ticket.vehicle ? vehicleName(ticket.vehicle) : null}
          job={{ id: sourcingJob.id, title: sourcingJob.title }}
          accounts={accounts}
          catalogAvailable={vendorCatalogAvailable}
          canCreateVendorAccount={canCreateVendorAccount}
          partsMarkupBps={current.configuration.partsMarkupBps}
          diagnosisSeed={diagnosisSeed}
          busy={busy}
          onBusyChange={setSourcingBusy}
          onAccountCreated={(account) => setAccounts((currentAccounts) => (
            currentAccounts.some((candidate) => candidate.id === account.id)
              ? currentAccounts
              : [...currentAccounts, account]
          ))}
          onSaved={async (line) => {
            const refreshed = await refreshQuote(
              `line:${line.id}`,
              false,
              true,
              undefined,
              undefined,
              { line, state: 'present' },
            )
            if (refreshed) sourcingSavedCloseRef.current = true
            return refreshed
          }}
          onRefreshQuote={() => refreshQuote(undefined, false, true)}
          onAccessFailure={applyFailure}
          onClose={() => {
            setSourcingJobId(null)
            if (sourcingSavedCloseRef.current) sourcingSavedCloseRef.current = false
            else setFocusTarget(`source:${sourcingJob.id}`)
          }}
        />
      )}

      {modal && (
        <ConfirmationModal
          modal={modal}
          busy={busy}
          onCancel={() => {
            if (!inFlightRef.current) closeModal()
          }}
          onDiscard={() => {
            if (inFlightRef.current) return
            if (modal.kind === 'discard') {
              clearStoredEditorDraft()
              setEditor(createEditor(modal.target))
              closeModal('editor')
              setError(null)
            } else if (modal.kind === 'discard-close') {
              clearStoredEditorDraft()
              setEditor(null)
              setModal(null)
              setError(null)
              onClose?.()
            }
          }}
          onRemove={confirmRemove}
          onRemoveSourced={confirmSourcedRemove}
        />
      )}
      {decision && (
        <DecisionDialog
          decision={decision}
          onCancel={() => {
            if (decision.busy) return
            const invoker = decision.invoker
            setDecision(null)
            setTimeout(() => invoker.focus(), 0)
          }}
          onConfirm={submitDecision}
          onReasonChange={(reason) => setDecision((current) => (
            current?.kind === 'deferred' ? { ...current, reason, error: null } : current
          ))}
        />
      )}
    </Root>
  )
}

type BuilderLine = QuoteBuilder['jobs'][number]['lines'][number]
type BuilderJob = QuoteBuilder['jobs'][number]
type DecisionState = {
  jobId: string
  title: string
  kind: 'phone' | 'in_person' | 'declined' | 'deferred'
  requestKey: string
  versionId: string
  versionNumber: number
  jobSubtotalCents: number
  totalCents: number
  busy: boolean
  error: string | null
  reason: string
  invoker: HTMLButtonElement
}

function StoryCard({
  ticketId,
  ticketConcern,
  job,
  focusRef,
  onServerChange,
}: {
  ticketId: string
  ticketConcern: string
  job: BuilderJob
  focusRef: (element: HTMLElement | null) => void
  onServerChange: () => Promise<boolean>
}): React.JSX.Element {
  // Manual story modes share one editor: topology_manual (locked topology
  // session) and manual_findings (no session — shop without the diagnostics
  // add-on records findings by hand). Both write the same story shape.
  const manualStoryMode = job.storyMode === 'topology_manual' || job.storyMode === 'manual_findings'
  const [open, setOpen] = useState(manualStoryMode)
  const [story, setStory] = useState(job.story.content)
  const [revision, setRevision] = useState(job.story.revision)
  const [reviewStatus, setReviewStatus] = useState(job.story.reviewStatus)
  const [whatWeFound, setWhatWeFound] = useState(job.story.content?.whatWeFound ?? '')
  const [whatWeRecommend, setWhatWeRecommend] = useState(job.story.content?.whatWeRecommend ?? '')
  const dirtyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reviewKey = useRef<string | null>(null)
  const endpoint = `/api/tickets/${ticketId}/quote/jobs/${job.id}/story`

  useEffect(() => {
    setStory(job.story.content)
    setRevision(job.story.revision)
    setReviewStatus(job.story.reviewStatus)
    if (!dirtyRef.current) {
      setWhatWeFound(job.story.content?.whatWeFound ?? '')
      setWhatWeRecommend(job.story.content?.whatWeRecommend ?? '')
    }
  }, [job.story.content, job.story.reviewStatus, job.story.revision])

  async function readBody(response: Response): Promise<unknown> {
    try { return await response.json() } catch { return {} }
  }

  function edit(field: 'found' | 'recommend', value: string): void {
    if (field === 'found') setWhatWeFound(value)
    else setWhatWeRecommend(value)
    reviewKey.current = crypto.randomUUID()
    dirtyRef.current = true
  }

  async function rebaseStoryDraft(): Promise<void> {
    if (job.storyMode !== 'ordinary_locked_tree') {
      await onServerChange()
      setError('Story refreshed. Your draft is preserved; review current proof and retry.')
      return
    }
    try {
      const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
      const parsed = response.ok ? parseCustomerStoryWorkspaceResponse(await readBody(response)) : null
      if (!parsed) {
        setError('Story changed elsewhere. Your draft is preserved; refresh before retrying.')
        return
      }
      setStory(parsed.story)
      setRevision(parsed.storyRevision)
      setReviewStatus(parsed.storyMeta?.reviewStatus ?? null)
      setError('Story refreshed. Your draft is preserved; review current proof and retry.')
    } catch {
      setError('Story changed elsewhere. Your draft is preserved; refresh before retrying.')
    }
  }

  async function saveReview(): Promise<void> {
    if (busy || !whatWeFound.trim() || !whatWeRecommend.trim()) return
    reviewKey.current ??= crypto.randomUUID()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ clientKey: reviewKey.current, expectedStoryRevision: revision,
          whatWeFound: whatWeFound.trim(), whatWeRecommend: whatWeRecommend.trim() }),
      })
      if (response.status === 409) {
        await rebaseStoryDraft()
        return
      }
      const parsed = response.ok ? parseCustomerStoryMutationResponse(await readBody(response)) : null
      if (!parsed) {
        setError(response.status === 409
          ? 'Story changed elsewhere. Your text is preserved; refresh before retrying.'
          : 'Story review did not return safe server truth. Retry with the same text.')
        return
      }
      setStory(parsed.story)
      setRevision(parsed.storyRevision)
      setReviewStatus(parsed.storyMeta.reviewStatus ?? null)
      setWhatWeFound(parsed.story.whatWeFound)
      setWhatWeRecommend(parsed.story.whatWeRecommend)
      reviewKey.current = null
      await onServerChange()
      dirtyRef.current = false
    } catch {
      setError('Connection interrupted. Retry with the same text.')
    } finally { setBusy(false) }
  }

  if (job.storyMode === 'published_wizard_unsupported') {
    return <section ref={focusRef} tabIndex={-1} className={styles.storyCard} aria-label={`Diagnostic story for ${job.title}`}><p className={styles.storyTruth}>Published-wizard stories are not supported yet.</p></section>
  }
  if (job.storyMode === 'authorization_only') {
    return <section ref={focusRef} tabIndex={-1} className={styles.storyCard} aria-label={`Diagnostic authorization for ${job.title}`}><p className={styles.storyTruth}>Diagnostic labor only. Findings are recorded after the technician performs the approved testing.</p></section>
  }
  if (job.storyMode === 'unavailable') {
    return <section ref={focusRef} tabIndex={-1} className={styles.storyCard} aria-label={`Diagnostic story for ${job.title}`}><p className={styles.storyTruth}>Finish and lock this diagnosis before preparing its customer story.</p></section>
  }
  if (job.storyMode === 'ordinary_locked_tree' && !story) {
    return <section ref={focusRef} tabIndex={-1} className={styles.storyCard} aria-label={`Diagnostic story for ${job.title}`}><p className={styles.storyTruth}>Legacy AI story generation is unavailable while diagnostics is off. Record findings in the work order instead.</p></section>
  }

  return (
    <section ref={focusRef} className={styles.storyCard} role="region" aria-label={`Diagnostic story for ${job.title}`} tabIndex={-1}>
      <div className={styles.storyHeading}>
        <div><p className={styles.eyebrow}>Diagnostic story</p><h4>{job.storyMode === 'topology_manual' ? 'Human-authored topology story' : job.storyMode === 'manual_findings' ? 'Recorded findings' : 'Customer-ready finding'}</h4></div>
        {job.storyMode === 'ordinary_locked_tree' && !open && (
          <button type="button" className={styles.lineAction} onClick={() => setOpen(true)}>Review saved story</button>
        )}
      </div>
      {open && <>
          {reviewStatus === 'pending' && <p className={styles.pending}>Pending human review</p>}
          {reviewStatus === 'reviewed' && <p className={styles.reviewed} role="status">Reviewed customer story</p>}
          {(story || manualStoryMode) && (
            <div className={styles.storyEditor}>
              {story && <><p className={styles.storyLabel}>What you told us</p><p>{story.whatYouToldUs}</p></>}
              {!story && manualStoryMode && <>
                <p className={styles.storyLabel}>What you told us</p><p>{ticketConcern}</p>
                <p className={styles.storyLabel}>If deferred</p><p>{CUSTOMER_STORY_WAIVER}</p>
              </>}
              <label>What we found<textarea value={whatWeFound} maxLength={5000} onChange={(event) => edit('found', event.target.value)} /></label>
              {story && story.howWeKnow.length > 0 && <details className={styles.proof}><summary>Proof · {story.howWeKnow.length} sourced {story.howWeKnow.length === 1 ? 'observation' : 'observations'}</summary>{story.howWeKnow.map((claim) => <p key={claim.claim}>{claim.claim}</p>)}</details>}
              {story && <><p className={styles.storyLabel}>If deferred</p><p>{story.whatItMeansIfWaived}</p></>}
              <label>What we recommend<textarea value={whatWeRecommend} maxLength={5000} onChange={(event) => edit('recommend', event.target.value)} /></label>
              <button type="button" className={styles.storyAction} disabled={busy || !whatWeFound.trim() || !whatWeRecommend.trim()} onClick={saveReview}>{busy ? 'Saving…' : !story && manualStoryMode ? 'Review and save story' : 'Save reviewed story'}</button>
            </div>
          )}
          {busy && !story && <p role="status" aria-live="polite">Loading story truth…</p>}
          {error && <p className={styles.storyError} role="alert">{error}</p>}
      </>}
    </section>
  )
}

function AuthorizationStrip({ job, versionNumber, jobSubtotalCents, totalCents, canDecide, immediateVerdict, focusRef, onDecision }: {
  job: BuilderJob
  versionNumber: number
  jobSubtotalCents: number
  totalCents: number
  canDecide: boolean
  immediateVerdict?: string
  focusRef: (element: HTMLElement | null) => void
  onDecision: (kind: 'phone' | 'in_person' | 'declined' | 'deferred', invoker: HTMLButtonElement) => void
}): React.JSX.Element {
  const verdict = immediateVerdict ?? (job.approval.state === 'approved'
    ? `Approved · V${versionNumber}`
    : job.approval.state === 'declined' ? `Declined · V${versionNumber}`
      : job.approval.state === 'deferred' ? `Deferred · follow up · V${versionNumber}` : null)
  return (
    <section className={styles.authorizationStrip} role="region" aria-label={`Authorization for ${job.title}`} tabIndex={-1} ref={focusRef}>
      <p className={styles.eyebrow}>Quote V{versionNumber} · immutable</p>
      <p className={styles.authorizationTitle}>{job.title}</p>
      <dl><div><dt>Job subtotal before tax</dt><dd className={styles.money}>{formatMoneyCents(jobSubtotalCents)}</dd></div><div><dt>Ticket total</dt><dd className={styles.money}>{formatMoneyCents(totalCents)}</dd></div></dl>
      {verdict && <p className={styles.verdict} role="status" aria-live="polite">{verdict}</p>}
      {canDecide && job.decisionEligible && job.approval.state !== 'approved' && job.approval.state !== 'declined' ? (
        <div className={styles.decisionActions}>
          <button type="button" onClick={(event) => onDecision('phone', event.currentTarget)}>Phone approval</button>
          <button type="button" onClick={(event) => onDecision('in_person', event.currentTarget)}>In-person approval</button>
          <button type="button" onClick={(event) => onDecision('declined', event.currentTarget)}>Record declined</button>
          <button type="button" onClick={(event) => onDecision('deferred', event.currentTarget)}>Defer decision</button>
        </div>
      ) : !verdict && <p className={styles.storyTruth}>{canDecide
        ? 'Customer decision is unavailable for this job’s current state.'
        : 'Advisor or owner records the customer decision.'}</p>}
    </section>
  )
}

function DecisionDialog({ decision, onCancel, onConfirm, onReasonChange }: {
  decision: DecisionState
  onCancel: () => void
  onConfirm: () => void
  onReasonChange: (reason: string) => void
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  useEffect(() => { if (decision.busy) dialogRef.current?.focus() }, [decision.busy])
  const channel = decision.kind === 'phone' ? 'phone' : decision.kind === 'in_person' ? 'in-person' : null
  const title = channel ? `Record ${channel} approval?`
    : decision.kind === 'deferred' ? 'Defer customer decision?' : 'Record declined?'
  return (
    <div ref={dialogRef} className={styles.decisionDialog} role="alertdialog" tabIndex={-1} aria-modal="true" aria-label={title} onKeyDown={(event) => {
      if (event.key === 'Escape' && !decision.busy) { event.preventDefault(); onCancel(); return }
      if (event.key !== 'Tab') return
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      if (buttons.length === 0) { event.preventDefault(); dialogRef.current?.focus(); return }
      const first = buttons[0]; const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
      <p className={styles.eyebrow}>Authorization strip</p><h2>{title}</h2>
      <p>{decision.title} · V{decision.versionNumber}</p>
      <dl><div><dt>Job subtotal before tax</dt><dd>{formatMoneyCents(decision.jobSubtotalCents)}</dd></div><div><dt>Ticket total</dt><dd>{formatMoneyCents(decision.totalCents)}</dd></div></dl>
      {decision.kind === 'deferred' && <label>What are we waiting for?
        <textarea value={decision.reason} maxLength={500} onChange={(event) => onReasonChange(event.target.value)} />
      </label>}
      {decision.error && <p className={styles.storyError} role="alert">{decision.error}</p>}
      <div className={styles.decisionActions}>
        <button ref={cancelRef} type="button" disabled={decision.busy} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={decision.busy || (decision.kind === 'deferred' && decision.reason.trim().length < 1)} onClick={onConfirm}>{decision.busy ? 'Recording…' : channel ? 'Record approval' : decision.kind === 'deferred' ? 'Defer decision' : 'Record declined'}</button>
      </div>
    </div>
  )
}

type EditorTarget = {
  mode: 'create' | 'edit'
  jobId: string
  kind: ManualLineKind
  line?: BuilderLine
}

type EditorState = EditorTarget & {
  values: ManualLineFormValues
  dirty: boolean
  hoursChanged: boolean
  clientKey: string | null
  invokerKey: string
}

type ModalState =
  | { kind: 'discard'; target: EditorTarget; invoker: HTMLElement }
  | { kind: 'discard-close'; target: EditorTarget; invoker: HTMLElement }
  | {
    kind: 'remove'
    target: { jobId: string; line: BuilderLine }
    invoker: HTMLElement
  }
  | {
    kind: 'remove-sourced'
    target: { jobId: string; line: BuilderLine }
    invoker: HTMLElement
  }

function LineEditor({
  id,
  editor,
  laborRateCents,
  busy,
  firstInputRef,
  onChange,
  onCancel,
  onSubmit,
}: {
  id: string
  editor: EditorState
  laborRateCents: number | null
  busy: boolean
  firstInputRef: React.RefObject<HTMLInputElement | null>
  onChange: <K extends keyof ManualLineFormValues>(key: K, value: ManualLineFormValues[K]) => void
  onCancel: () => void
  onSubmit: (event: React.FormEvent) => void
}): React.JSX.Element {
  const headingId = `${id}-heading`
  const effectiveLaborRate = editor.mode === 'edit' && editor.line?.kind === 'labor'
    ? editor.line.laborRateCents
    : laborRateCents
  let calculated: string | null = null
  if (editor.kind === 'labor' && effectiveLaborRate !== null) {
    try {
      const payload = buildManualLineInput('labor', editor.values, effectiveLaborRate)
      calculated = formatMoneyCents(payload.priceCents as number)
    } catch { calculated = null }
  }
  return (
    <form id={id} className={styles.editor} aria-labelledby={headingId} onSubmit={onSubmit}>
      <h4 id={headingId}>{editor.mode === 'create' ? 'Add' : 'Edit'} {editor.kind} line</h4>
      <label>
        Description
        <input
          ref={firstInputRef}
          value={editor.values.description}
          maxLength={500}
          autoComplete="off"
          onChange={(event) => onChange('description', event.target.value)}
        />
      </label>
      {editor.kind === 'part' && (
        <>
          <label>Quantity<input inputMode="decimal" autoComplete="off" maxLength={64} value={editor.values.quantity} onChange={(event) => onChange('quantity', event.target.value)} /></label>
          <label>Part number<input autoComplete="off" maxLength={200} value={editor.values.partNumber} onChange={(event) => onChange('partNumber', event.target.value)} /></label>
          <label>Brand<input autoComplete="off" maxLength={200} value={editor.values.brand} onChange={(event) => onChange('brand', event.target.value)} /></label>
          <label>Fitment<input autoComplete="off" maxLength={500} value={editor.values.fitment} onChange={(event) => onChange('fitment', event.target.value)} /></label>
        </>
      )}
      {editor.kind === 'labor' && (
        <label>Hours<input inputMode="decimal" autoComplete="off" maxLength={64} value={editor.values.hours} onChange={(event) => onChange('hours', event.target.value)} /></label>
      )}
      {(editor.kind !== 'labor' || effectiveLaborRate === null) && (
        <label>Line price<input inputMode="decimal" autoComplete="off" maxLength={64} value={editor.values.price} onChange={(event) => onChange('price', event.target.value)} /></label>
      )}
      {editor.kind === 'labor' && effectiveLaborRate !== null && (
        <p className={styles.calculated}>
          {editor.mode === 'edit' && !editor.hoursChanged
            ? `Stored line price · ${safeMoney(editor.line?.priceCents ?? 0)}`
            : `Calculated line price · ${calculated ?? 'Enter valid hours'}`}
        </p>
      )}
      <label className={styles.checkbox}>
        <input type="checkbox" checked={editor.values.taxable} onChange={(event) => onChange('taxable', event.target.checked)} />
        Taxable
      </label>
      <div className={styles.editorActions}>
        <button type="button" className={styles.lineAction} disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.lineAction} disabled={busy}>{busy ? 'Saving…' : 'Save line'}</button>
      </div>
    </form>
  )
}

function ConfirmationModal({
  modal,
  busy,
  onCancel,
  onDiscard,
  onRemove,
  onRemoveSourced,
}: {
  modal: ModalState
  busy: boolean
  onCancel: () => void
  onDiscard: () => void
  onRemove: () => void
  onRemoveSourced: () => void
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = `quote-confirm-${modal.kind}`
  useEffect(() => cancelRef.current?.focus(), [])
  useEffect(() => {
    if (busy) dialogRef.current?.focus()
  }, [busy])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      if (busy) return
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    )
    if (buttons.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const discard = modal.kind === 'discard' || modal.kind === 'discard-close'
  const sourced = modal.kind === 'remove-sourced'
  const descriptionId = discard ? undefined : `${titleId}-target`
  return (
    <div
      ref={dialogRef}
      className={styles.confirmation}
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={onKeyDown}
    >
      <strong id={titleId}>
        {discard
          ? 'Discard unsaved line changes?'
          : sourced ? 'Remove sourced part?' : 'Remove this quote line?'}
      </strong>
      {!discard && <p id={descriptionId}>{modal.target.line.description}</p>}
      <div>
        <button ref={cancelRef} type="button" className={styles.lineAction} disabled={busy} onClick={onCancel}>
          {discard ? 'Keep editing' : sourced ? 'Keep sourced part' : 'Keep line'}
        </button>
        <button
          type="button"
          className={styles.lineAction}
          disabled={busy}
          onClick={discard ? onDiscard : sourced ? onRemoveSourced : onRemove}
        >
          {discard ? 'Discard changes' : sourced ? 'Confirm removal' : 'Confirm remove'}
        </button>
      </div>
    </div>
  )
}

function emptyValues(): ManualLineFormValues {
  return {
    description: '', quantity: '1', hours: '1', price: '', taxable: true,
    partNumber: '', brand: '', fitment: '',
  }
}

function valuesFromLine(line: BuilderLine): ManualLineFormValues {
  return {
    description: line.description,
    quantity: line.quantity,
    hours: line.laborHours ?? '1',
    price: formatMoneyCents(line.priceCents).slice(1).replace(/,/g, ''),
    taxable: line.taxable,
    partNumber: line.partNumber ?? '',
    brand: line.brand ?? '',
    fitment: line.fitment ?? '',
  }
}

function LineFacts({ line }: { line: BuilderLine }): React.JSX.Element | null {
  const facts: string[] = []
  if (line.kind === 'part') {
    if (line.partNumber || line.brand) facts.push([line.partNumber, line.brand].filter(Boolean).join(' · '))
    if (line.fitment) facts.push(`Fitment · ${line.fitment}`)
  }
  if (line.kind === 'labor' && line.laborRateCents !== null) {
    facts.push(`Rate · ${safeMoney(line.laborRateCents)}/hr`)
  }
  if (line.coreChargeCents !== null) {
    facts.push(`Included in line price · ${safeMoney(line.coreChargeCents)}`)
  }
  if (line.taxable) facts.push('Taxable')
  if (facts.length === 0) return null
  return (
    <div className={styles.lineFacts}>
      {facts.map((fact) => <span key={fact}>{fact}</span>)}
    </div>
  )
}

function lineLabel(line: BuilderLine): string {
  if (line.kind === 'part') return `Part · Qty ${line.quantity}`
  if (line.kind === 'labor') return `Labor · ${line.laborHours ?? '—'} hr`
  return 'Fee'
}

function cannedLineLabel(line: SafeCannedJobTemplate['lines'][number]): string {
  if (line.kind === 'part') return `Part · Qty ${line.quantity}`
  if (line.kind === 'labor') return `Labor · ${line.hours} hr`
  return 'Fee'
}

function safeMoney(cents: number): string {
  try {
    return formatMoneyCents(cents)
  } catch {
    return 'Unavailable'
  }
}

function formatTaxRate(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) return 'Unavailable'
  const value = BigInt(bps)
  const whole = value / 100n
  const fraction = (value % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}%` : `${whole}%`
}

function vehicleName(vehicle: NonNullable<QuoteTicketIdentity['vehicle']>): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`
}

function formatStatus(status: string): string {
  return status.replace('_', ' ')
}

function quoteEditorId(jobId: string): string {
  return `quote-line-editor-${jobId}`
}

function editorInvokerKey(editor: EditorTarget): string {
  if (editor.mode === 'edit' && editor.line) return `edit:${editor.line.id}`
  return `add:${editor.jobId}:${editor.kind}`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
