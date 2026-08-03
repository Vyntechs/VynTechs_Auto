'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Btn,
  Field,
  FormFooter,
  FormGroup,
  FormRow,
  Input,
  MainHeader,
  Textarea,
  Topbar,
} from '@/components/vt/desktop'
import { PredictiveIntakeSearch } from '@/components/vt/intake-search'
import { TechSelector, type TeamMember } from '@/components/vt/tech-selector'
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CreateNewPrefill } from '@/lib/intake/tokens-to-prefill'
import type { SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'
import {
  encodeTicketIntakeDraft,
  parseTicketIntakeDraft,
  ticketIntakeDraftKey,
  type TicketIntakeDraft,
} from '@/lib/intake/ticket-intake-draft'
import styles from './write-up.module.css'

type CounterBody = {
  vehicleMode: 'new' | 'existing'
  existingVehicleId?: string
  customer?: { name: string; phone: string; email: string | null }
  vehicle?: {
    year: number
    make: string
    model: string
    engine: string | null
    vin: string | null
    mileage: number | null
    plate: string | null
  }
  mileage?: number | null
  concern: string
  whenStarted: string | null
  howOften: string | null
  work:
    | { mode: 'diagnosis'; cannedJobId: string; expectedFingerprint: string; expectedTaxRateBps: number | null }
    | { mode: 'diagnosis-manual'; description: string; laborHours: number; priceCents: number }
    | { mode: 'canned'; cannedJobId: string; expectedFingerprint: string; expectedTaxRateBps: number | null; customerSuppliedPartsNote?: string | null }
    | { mode: 'manual'; kind: 'repair' | 'maintenance'; description: string; customerSuppliedPartsNote?: string | null }
  assignedTechId: string | null
  confirmBelowTier?: boolean
}

type TierWarning = {
  code: 'below_required_tier'
  assignedTechId: string
  assignedSkillTier: 1 | 2 | 3
  requiredSkillTier: 1 | 2 | 3
}

// The one place that decides whether this form can be sent. It answers with the
// first thing still missing, in the order the writer reads the form, so pressing
// Create repair order can always name it and move focus to it instead of leaving
// a dead button on a long scrolling form.
/**
 * The last option in either scope picker. Choosing it swaps the saved-work
 * dropdown for typed fields, so the writer never has to answer a separate
 * question about where the scope is coming from.
 */
const CUSTOM_SCOPE = 'custom'

type MissingRequirement = { fieldId: string; message: string }

function firstMissingRequirement(form: {
  isPickExisting: boolean
  name: string
  phone: string
  year: string
  make: string
  model: string
  description: string
  intent: 'diagnosis' | 'known'
  diagMode: 'canned' | 'manual'
  knownMode: 'canned' | 'manual'
  cannedCatalogAvailable: boolean
  selectedDiagnostic: SafeCannedJobTemplate | null
  selectedKnown: SafeCannedJobTemplate | null
  customDiagDescription: string
  customDiagHours: string
  customDiagPrice: string
  requestedServiceDescription: string
}): MissingRequirement | null {
  if (!form.isPickExisting) {
    if (form.name.trim() === '') return { fieldId: 'ci-name', message: 'Add the customer’s name.' }
    if (form.phone.trim() === '') {
      return { fieldId: 'ci-phone', message: 'Add a phone number — that is how the shop reaches them.' }
    }
    if (form.year.trim() === '') return { fieldId: 'ci-year', message: 'Add the vehicle year.' }
    if (form.make.trim() === '') return { fieldId: 'ci-make', message: 'Add the make.' }
    if (form.model.trim() === '') return { fieldId: 'ci-model', message: 'Add the model.' }
  }
  if (form.description.trim() === '') {
    return { fieldId: 'ci-description', message: 'Add what brought them in.' }
  }
  if (form.intent === 'diagnosis') {
    if (form.diagMode === 'canned') {
      return form.cannedCatalogAvailable && form.selectedDiagnostic !== null
        ? null
        : {
            fieldId: 'ci-diagnostic-template',
            message: 'Pick the diagnostic labor to authorize, or choose to type it.',
          }
    }
    if (form.customDiagDescription.trim() === '') {
      return { fieldId: 'ci-diag-description', message: 'Say what the diagnostic time covers.' }
    }
    if (!(Number(form.customDiagHours) > 0)) {
      return { fieldId: 'ci-diag-hours', message: 'Add the diagnostic hours.' }
    }
    if (form.customDiagPrice.trim() === '' || !(Number(form.customDiagPrice) >= 0)) {
      return { fieldId: 'ci-diag-price', message: 'Add the diagnostic price in dollars.' }
    }
    return null
  }
  if (form.knownMode === 'canned') {
    return form.cannedCatalogAvailable && form.selectedKnown !== null
      ? null
      : {
          fieldId: 'ci-known-template',
          message: 'Pick the saved work, or choose to type it.',
        }
  }
  if (form.requestedServiceDescription.trim() === '') {
    return { fieldId: 'ci-service-description', message: 'Add the work they are asking for.' }
  }
  return null
}

function focusMissing(fieldId: string) {
  const field = document.getElementById(fieldId)
  if (!field) return
  if (typeof field.scrollIntoView === 'function') {
    field.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  field.focus({ preventScroll: true })
}

function optionalText(value: string): string | null {
  return value.trim() || null
}

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function ticketErrorMessage(error?: string): string {
  switch (error) {
    case 'not_found':
      return 'The selected customer or vehicle is no longer available. Choose it again.'
    case 'invalid_input':
      return 'Check the customer, vehicle, mileage, and requested-work fields.'
    case 'invalid_assignee':
      return 'That technician is no longer available for assignment. Choose Open or another technician.'
    case 'conflict':
      return 'The shop work menu changed. Refresh this page and choose the scope again.'
    case 'forbidden':
    case 'inactive_profile':
    case 'no_shop':
      return 'Your account cannot start a repair order.'
    default:
      return 'Could not create the ticket. Try again.'
  }
}

function ticketIdFromCounterResponse(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const ticket = (value as { ticket?: unknown }).ticket
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) return null
  const id = (ticket as { id?: unknown }).id
  return typeof id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id.toLowerCase()
    : null
}

export function WriteUp({
  actorId,
  userEmail,
  recentCustomers = [],
  team = [],
  workloadFailed = false,
  cannedJobs = [],
  cannedTaxRateBps = null,
  cannedCatalogAvailable = true,
}: {
  actorId: string
  userEmail?: string
  recentCustomers?: RecentCustomer[]
  team?: TeamMember[]
  workloadFailed?: boolean
  cannedJobs?: SafeCannedJobTemplate[]
  cannedTaxRateBps?: number | null
  cannedCatalogAvailable?: boolean
}) {
  const router = useRouter()
  const [assignedTechId, setAssignedTechId] = useState<string | null>(null)
  const [pickedVehicleId, setPickedVehicleId] = useState<string | null>(null)
  const [pickedLabel, setPickedLabel] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [vin, setVin] = useState('')
  const [year, setYear] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [engine, setEngine] = useState('')
  const [mileage, setMileage] = useState('')
  const [plate, setPlate] = useState('')
  const [description, setDescription] = useState('')
  const diagnosticJobs = cannedJobs.filter((job) => job.kind === 'diagnostic')
  const knownWorkJobs = cannedJobs.filter((job) => job.kind !== 'diagnostic')
  const [intent, setIntent] = useState<'diagnosis' | 'known'>(
    diagnosticJobs.length > 0 ? 'diagnosis' : 'known',
  )
  const [knownMode, setKnownMode] = useState<'canned' | 'manual'>(
    knownWorkJobs.length > 0 ? 'canned' : 'manual',
  )
  const [diagMode, setDiagMode] = useState<'canned' | 'manual'>(
    diagnosticJobs.length > 0 ? 'canned' : 'manual',
  )
  const [customDiagDescription, setCustomDiagDescription] = useState('')
  const [customDiagHours, setCustomDiagHours] = useState('')
  const [customDiagPrice, setCustomDiagPrice] = useState('')
  const [selectedDiagnosticId, setSelectedDiagnosticId] = useState(diagnosticJobs[0]?.id ?? '')
  const [selectedKnownId, setSelectedKnownId] = useState(knownWorkJobs[0]?.id ?? '')
  const [requestedServiceKind, setRequestedServiceKind] = useState<'repair' | 'maintenance'>('repair')
  const [requestedServiceDescription, setRequestedServiceDescription] = useState('')
  const [customerSuppliedPartsNote, setCustomerSuppliedPartsNote] = useState('')
  const [vinBusy, setVinBusy] = useState(false)
  const [vinStatus, setVinStatus] = useState<string | null>(null)
  const [vinStatusKind, setVinStatusKind] = useState<'success' | 'error' | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tierWarning, setTierWarning] = useState<TierWarning | null>(null)
  const [draftNotice, setDraftNotice] = useState<string | null>(null)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [selectionTouched, setSelectionTouched] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [draftActive, setDraftActive] = useState(true)
  // Held across retries so a repeat of the same submission is a replay, not a
  // second repair order. Rotated when the writer changes what they are sending,
  // and cleared once the server has recorded this one.
  const requestIdentityRef = useRef<{ signature: string; clientKey: string } | null>(null)
  const restoredRef = useRef(false)

  const isPickExisting = pickedVehicleId !== null
  // Mirror the counter-ticket requirements. VIN remains optional for walk-ins;
  // customer contact, year/make/model, and concern are required.
  const selectedDiagnostic = diagnosticJobs.find((job) => job.id === selectedDiagnosticId) ?? null
  const selectedKnown = knownWorkJobs.find((job) => job.id === selectedKnownId) ?? null
  const draftKey = ticketIntakeDraftKey(actorId, 'write_up')
  const formDraft: TicketIntakeDraft['form'] = {
    existingVehicleId: pickedVehicleId,
    name,
    phone,
    email,
    year,
    make,
    model,
    engine,
    vin,
    mileage,
    plate,
    concern: description,
    assignedTechId,
    intent,
    diagnosticMode: diagMode,
    knownWorkMode: knownMode,
    selectedDiagnostic: selectedDiagnostic ? { id: selectedDiagnostic.id, fingerprint: selectedDiagnostic.fingerprint } : null,
    selectedKnownWork: selectedKnown ? { id: selectedKnown.id, fingerprint: selectedKnown.fingerprint } : null,
    customDiagnosticDescription: customDiagDescription,
    customDiagnosticHours: customDiagHours,
    customDiagnosticPrice: customDiagPrice,
    requestedServiceKind,
    requestedServiceDescription,
    customerSuppliedPartsNote,
    quoteMode: 'manual',
    selectedCannedJob: null,
    workKind: 'repair',
    requestedWork: '',
  }
  const hasMeaningfulDraft = Boolean(
    draftActive && (restoredDraft || selectionTouched || pickedVehicleId || name || phone || email || year || make || model || engine || vin || mileage || plate || description
    || assignedTechId || customDiagDescription || customDiagHours || customDiagPrice
    || requestedServiceDescription || customerSuppliedPartsNote),
  )
  const persistDraft = (pending = requestIdentityRef.current) => {
    if (!draftKey || !hasMeaningfulDraft) return
    const encoded = encodeTicketIntakeDraft({ actorId, surface: 'write_up', form: formDraft, pending })
    if (!encoded) return
    try { sessionStorage.setItem(draftKey, encoded) } catch { /* recovery is optional when storage is unavailable */ }
  }
  const clearDraft = () => {
    if (!draftKey) return
    try { sessionStorage.removeItem(draftKey) } catch { /* nothing to clear when storage is unavailable */ }
  }

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (!draftKey) {
      setRecoveryReady(true)
      return
    }
    let raw: string | null = null
    try { raw = sessionStorage.getItem(draftKey) } catch { /* keep an ordinary blank form */ }
    const draft = parseTicketIntakeDraft(raw, { actorId, surface: 'write_up' })
    if (!draft) {
      if (raw !== null) clearDraft()
      setRecoveryReady(true)
      return
    }
    const form = draft.form
    const diagnostic = form.selectedDiagnostic && diagnosticJobs.find((job) =>
      job.id === form.selectedDiagnostic!.id && job.fingerprint === form.selectedDiagnostic!.fingerprint)
    const known = form.selectedKnownWork && knownWorkJobs.find((job) =>
      job.id === form.selectedKnownWork!.id && job.fingerprint === form.selectedKnownWork!.fingerprint)
    const staleSavedWork = (form.selectedDiagnostic !== null && !diagnostic) || (form.selectedKnownWork !== null && !known)
    setPickedVehicleId(form.existingVehicleId)
    setName(form.name); setPhone(form.phone); setEmail(form.email); setYear(form.year); setMake(form.make); setModel(form.model)
    setEngine(form.engine); setVin(form.vin); setMileage(form.mileage); setPlate(form.plate); setDescription(form.concern)
    setAssignedTechId(form.assignedTechId); setIntent(form.intent)
    setDiagMode(form.selectedDiagnostic && !diagnostic ? 'manual' : form.diagnosticMode)
    setKnownMode(form.selectedKnownWork && !known ? 'manual' : form.knownWorkMode)
    setSelectedDiagnosticId(diagnostic?.id ?? '')
    setSelectedKnownId(known?.id ?? '')
    setCustomDiagDescription(form.customDiagnosticDescription); setCustomDiagHours(form.customDiagnosticHours); setCustomDiagPrice(form.customDiagnosticPrice)
    setRequestedServiceKind(form.requestedServiceKind); setRequestedServiceDescription(form.requestedServiceDescription)
    setCustomerSuppliedPartsNote(form.customerSuppliedPartsNote)
    requestIdentityRef.current = draft.pending
    setRestoredDraft(true)
    setDraftNotice('Draft restored')
    if (staleSavedWork) setRecoveryNotice('Saved work changed. Choose a current option or type the work.')
    setRecoveryReady(true)
  // This runs once after the catalog for this server render is available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  useEffect(() => {
    if (!recoveryReady) return
    if (hasMeaningfulDraft) persistDraft()
    else clearDraft()
  // Persist only observable form changes, after mounted recovery has completed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryReady, hasMeaningfulDraft, JSON.stringify(formDraft)])

  useEffect(() => {
    if (!recoveryReady || !hasMeaningfulDraft) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [recoveryReady, hasMeaningfulDraft])
  const missing = firstMissingRequirement({
    isPickExisting,
    name,
    phone,
    year,
    make,
    model,
    description,
    intent,
    diagMode,
    knownMode,
    cannedCatalogAvailable,
    selectedDiagnostic,
    selectedKnown,
    customDiagDescription,
    customDiagHours,
    customDiagPrice,
    requestedServiceDescription,
  })

  // Rendered right where focus lands, so the writer never has to guess which
  // field the form is waiting on.
  const missingNote = (fieldId: string) =>
    attempted && missing && missing.fieldId === fieldId ? (
      <span id={`${fieldId}-missing`} role="alert" className={styles.missingNote}>
        {missing.message}
      </span>
    ) : null
  const missingProps = (fieldId: string) =>
    attempted && missing && missing.fieldId === fieldId
      ? { 'aria-invalid': true, 'aria-describedby': `${fieldId}-missing` }
      : {}

  const handlePickVehicle = (vehicleId: string) => {
    setPickedVehicleId(vehicleId)
    setError(null)
  }

  const handleCreateNew = (prefill: CreateNewPrefill) => {
    setPickedVehicleId(null)
    setPickedLabel(null)
    if (prefill.name !== undefined) setName(prefill.name)
    if (prefill.phone !== undefined) setPhone(prefill.phone)
    if (prefill.email !== undefined) setEmail(prefill.email)
    if (prefill.vin !== undefined) setVin(prefill.vin)
    if (prefill.year !== undefined) setYear(String(prefill.year))
    if (prefill.make !== undefined) setMake(prefill.make)
    if (prefill.plate !== undefined) setPlate(prefill.plate)
  }

  const handleClearPicked = () => {
    setPickedVehicleId(null)
    setPickedLabel(null)
  }

  const handleVinChange = (e: ChangeEvent<HTMLInputElement>) => {
    setVin(e.target.value.toUpperCase())
    setVinStatus(null)
    setVinStatusKind(null)
  }

  const handleDecodeVin = async () => {
    if (vin.length !== 17 || vinBusy) return
    setVinBusy(true)
    setVinStatus('Decoding VIN…')
    setVinStatusKind(null)
    try {
      const response = await fetch('/api/intake/decode-vin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vin: vin.trim() }),
      })
      const payload = (await response.json()) as
        | { year: number; make: string; model: string; engine: string }
        | { error: string }
      if (!response.ok || 'error' in payload) {
        setVinStatusKind('error')
        // `invalid_vin` is the route refusing the characters we sent, and
        // `invalid` is NHTSA refusing the VIN itself. Both are the writer's VIN,
        // not the service — reporting them as an outage sent the writer looking
        // for a problem that was not there.
        const reason = 'error' in payload ? payload.error : null
        setVinStatus(
          reason === 'invalid_vin'
            ? 'That VIN is not 17 valid characters — check for a space or a typo.'
            : reason === 'invalid'
              ? 'VIN was not recognized. Enter the vehicle details manually.'
              : 'VIN lookup is unavailable. Enter the vehicle details manually.',
        )
        return
      }
      setYear(String(payload.year))
      setMake(payload.make)
      setModel(payload.model)
      setEngine(payload.engine)
      setVinStatusKind('success')
      setVinStatus('VIN decoded. Verify each vehicle field before creating the ticket.')
    } catch {
      setVinStatusKind('error')
      setVinStatus('VIN lookup is unavailable. Enter the vehicle details manually.')
    } finally {
      setVinBusy(false)
    }
  }

  const submitTicket = async (confirmBelowTier = false) => {
    if (busy) return
    if (missing) {
      setAttempted(true)
      focusMissing(missing.fieldId)
      return
    }
    setBusy(true)
    setError(null)
    setTierWarning(null)
    const suppliedNote = optionalText(customerSuppliedPartsNote)
    const work: CounterBody['work'] = intent === 'diagnosis' && diagMode === 'manual'
      ? {
          mode: 'diagnosis-manual',
          description: customDiagDescription.trim(),
          laborHours: Number(customDiagHours),
          priceCents: Math.round(Number(customDiagPrice) * 100),
        }
      : intent === 'diagnosis' && selectedDiagnostic
      ? {
          mode: 'diagnosis',
          cannedJobId: selectedDiagnostic.id,
          expectedFingerprint: selectedDiagnostic.fingerprint,
          expectedTaxRateBps: cannedTaxRateBps,
        }
      : knownMode === 'canned' && selectedKnown
        ? {
            mode: 'canned',
            cannedJobId: selectedKnown.id,
            expectedFingerprint: selectedKnown.fingerprint,
            expectedTaxRateBps: cannedTaxRateBps,
            ...(suppliedNote ? { customerSuppliedPartsNote: suppliedNote } : {}),
          }
        : {
            mode: 'manual',
            kind: requestedServiceKind,
            description: requestedServiceDescription.trim(),
            ...(suppliedNote ? { customerSuppliedPartsNote: suppliedNote } : {}),
          }
    const common = {
      concern: description.trim(),
      // Onset and frequency are no longer asked for separately — the writer
      // records them in the customer's own words in the concern. The columns
      // stay so existing repair orders keep what was captured before.
      whenStarted: null,
      howOften: null,
      work,
      assignedTechId,
      ...(confirmBelowTier ? { confirmBelowTier: true } : {}),
    }
    const body: CounterBody = isPickExisting
      ? {
          vehicleMode: 'existing',
          existingVehicleId: pickedVehicleId!,
          mileage: optionalNumber(mileage),
          ...common,
        }
      : {
          vehicleMode: 'new',
          customer: { name: name.trim(), phone: phone.trim(), email: optionalText(email) },
          vehicle: {
            year: Number(year),
            make: make.trim(),
            model: model.trim(),
            engine: optionalText(engine),
            vin: optionalText(vin),
            mileage: optionalNumber(mileage),
            plate: optionalText(plate),
          },
          ...common,
        }
    const signature = JSON.stringify(body)
    if (requestIdentityRef.current?.signature !== signature) {
      requestIdentityRef.current = { signature, clientKey: crypto.randomUUID() }
    }
    persistDraft(requestIdentityRef.current)
    try {
      const res = await fetch('/api/tickets/counter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, clientKey: requestIdentityRef.current.clientKey }),
      })
      let payload: unknown
      try { payload = await res.json() } catch { payload = null }
      const record = payload && typeof payload === 'object' ? payload as { error?: unknown; warning?: unknown } : {}
      if (record.error === 'tier_confirmation_required' && record.warning) {
        setTierWarning(record.warning as TierWarning)
        setBusy(false)
        return
      }
      const ticketId = res.status === 201 ? ticketIdFromCounterResponse(payload) : null
      if (!ticketId) {
        setError(ticketErrorMessage(typeof record.error === 'string' ? record.error : undefined))
        setBusy(false)
        return
      }
      requestIdentityRef.current = null
      clearDraft()
      setDraftActive(false)
      router.push(`/tickets/${ticketId}`)
    } catch {
      setError('Could not reach the shop. Try again.')
      setBusy(false)
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void submitTicket()
  }

  const discard = () => {
    clearDraft()
    setDraftActive(false)
    router.push('/today')
  }

  const handleFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || (!e.metaKey && !e.ctrlKey)) return
    e.preventDefault()
    e.currentTarget.requestSubmit()
  }

  return (
    <div className={`vt-app ${styles.screen}`}>
      <Topbar
        product="Write-up"
        crumbs={[{ label: 'Today' }, { label: 'Write-up', bold: true }]}
        user={userEmail || '—'}
      />
      <div className="vt-workspace">
        <main className="vt-main">
          <MainHeader
            eyebrow="New repair order"
            eyebrowSlot={
              team.length > 0 ? (
                <TechSelector
                  team={team}
                  workloadFailed={workloadFailed}
                  selectedId={assignedTechId}
                  onChange={(id) => {
                    setAssignedTechId(id)
                    setTierWarning(null)
                  }}
                />
              ) : undefined
            }
            title="Who's the customer?"
            sub="Search to find an existing customer or vehicle, or fill in the form below."
            actions={
              <>
                <Btn kind="ghost" size="sm" type="button" onClick={discard}>
                  Discard
                </Btn>
                <Btn
                  kind="primary"
                  type="submit"
                  form="write-up-form"
                  kbd="⌘ ↵"
                  disabled={busy}
                >
                  Create repair order
                </Btn>
              </>
            }
          />

          <div className="vt-main__body">
            <form
              id="write-up-form"
              className="vt-form"
              onSubmit={handleSubmit}
              onKeyDown={handleFormKeyDown}
              // The browser's own validation bubble blocks submit before this
              // form can name the missing field in shop language, and it never
              // fires at all for the work-scope requirements. This screen owns
              // the message; `required` stays for assistive tech.
              noValidate
            >
              <div className={styles.search}>
                <PredictiveIntakeSearch
                  recentCustomers={recentCustomers}
                  onPickVehicle={handlePickVehicle}
                  onCreateNew={handleCreateNew}
                />
              </div>

              {draftNotice && (
                <div className={styles.draftRecovery} role="status" aria-label="Draft restored">
                  <span>{draftNotice}</span>
                  <button type="button" className={styles.changeButton} onClick={discard}>Discard draft</button>
                </div>
              )}
              {recoveryNotice && <p className={styles.draftRecoveryAlert} role="alert">{recoveryNotice}</p>}

              {isPickExisting ? (
                <div
                  role="status"
                  style={{
                    margin: '16px 32px',
                    padding: '14px 18px',
                    background: 'var(--vt-bone-100)',
                    border: '0.5px solid var(--vt-rule-strong)',
                    borderRadius: 3,
                    fontFamily: 'var(--vt-font-serif)',
                    fontSize: 15,
                    color: 'var(--vt-fg-2)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                  }}
                >
                  <span>
                    Existing vehicle selected{pickedLabel ? ` · ${pickedLabel}` : ''}. Type the
                    complaint below and submit to start the repair order.
                  </span>
                  <button
                    className={styles.changeButton}
                    type="button"
                    onClick={handleClearPicked}
                    style={{
                      background: 'transparent',
                      border: 0,
                      color: 'var(--vt-signal-500)',
                      fontFamily: 'var(--vt-font-serif)',
                      fontStyle: 'italic',
                      fontSize: 14,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <FormGroup name="Customer" hint="Name and phone are required. Email is optional.">
                    <FormRow>
                      <Field label="Name" htmlFor="ci-name">
                        <Input
                          id="ci-name"
                          name="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                          {...missingProps('ci-name')}
                        />
                        {missingNote('ci-name')}
                      </Field>
                      <Field label="Phone" htmlFor="ci-phone" hint="We text this number when the work is done">
                        <Input
                          id="ci-phone"
                          name="phone"
                          type="tel"
                          mono
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required
                          {...missingProps('ci-phone')}
                        />
                        {missingNote('ci-phone')}
                      </Field>
                      <Field label="Email" htmlFor="ci-email">
                        <Input
                          id="ci-email"
                          name="email"
                          type="email"
                          placeholder="optional"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </Field>
                    </FormRow>
                  </FormGroup>

                  <FormGroup
                    name="Vehicle"
                    hint="Decode a complete VIN, or enter the vehicle details manually."
                  >
                    <Field label="VIN" htmlFor="ci-vin">
                      <div
                        className={styles.vinRow}
                      >
                        <Input
                          id="ci-vin"
                          name="vin"
                          mono
                          maxLength={17}
                          value={vin}
                          onChange={handleVinChange}
                          placeholder="17 characters"
                        />
                        <button
                          type="button"
                          onClick={() => void handleDecodeVin()}
                          disabled={vin.length !== 17 || vinBusy}
                          aria-busy={vinBusy}
                          style={{
                            minHeight: 44,
                            padding: '0 16px',
                            border: '1px solid var(--vt-rule-strong)',
                            borderRadius: 3,
                            background: 'var(--vt-bone-50)',
                            color: 'var(--vt-fg)',
                            fontFamily: 'var(--vt-font-sans)',
                            fontSize: 13,
                            fontWeight: 650,
                            cursor: vin.length === 17 && !vinBusy ? 'pointer' : 'default',
                          }}
                        >
                          {vinBusy ? 'Decoding…' : 'Decode VIN'}
                        </button>
                      </div>
                      {vinStatus && (
                        <span
                          role={vinStatusKind === 'error' ? 'alert' : 'status'}
                          aria-live={vinStatusKind === 'error' ? 'assertive' : 'polite'}
                          style={{
                            display: 'block',
                            marginTop: 7,
                            fontFamily: 'var(--vt-font-serif)',
                            fontStyle: 'italic',
                            fontSize: 13,
                            color: 'var(--vt-fg-3)',
                          }}
                        >
                          {vinStatus}
                        </span>
                      )}
                    </Field>
                    <FormRow>
                      <Field label="Year" htmlFor="ci-year">
                        <Input
                          id="ci-year"
                          name="year"
                          type="number"
                          min={1886}
                          mono
                          value={year}
                          onChange={(e) => setYear(e.target.value)}
                          required
                          {...missingProps('ci-year')}
                        />
                        {missingNote('ci-year')}
                      </Field>
                      <Field label="Make" htmlFor="ci-make">
                        <Input
                          id="ci-make"
                          name="make"
                          value={make}
                          onChange={(e) => setMake(e.target.value)}
                          required
                          {...missingProps('ci-make')}
                        />
                        {missingNote('ci-make')}
                      </Field>
                      <Field label="Model" htmlFor="ci-model">
                        <Input
                          id="ci-model"
                          name="model"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          required
                          {...missingProps('ci-model')}
                        />
                        {missingNote('ci-model')}
                      </Field>
                      <Field label="Engine" htmlFor="ci-engine">
                        <Input
                          id="ci-engine"
                          name="engine"
                          value={engine}
                          onChange={(e) => setEngine(e.target.value)}
                        />
                      </Field>
                    </FormRow>
                    <FormRow>
                      <Field label="Mileage today" htmlFor="ci-mileage">
                        <Input
                          id="ci-mileage"
                          name="mileage"
                          type="number"
                          min={0}
                          mono
                          value={mileage}
                          onChange={(e) => setMileage(e.target.value)}
                        />
                      </Field>
                      <Field label="License plate" htmlFor="ci-plate">
                        <Input
                          id="ci-plate"
                          name="plate"
                          mono
                          value={plate}
                          onChange={(e) => setPlate(e.target.value)}
                        />
                      </Field>
                    </FormRow>
                  </FormGroup>
                </>
              )}

              {isPickExisting && (
                <FormGroup name="This visit" hint="Optional — log the current odometer reading.">
                  <FormRow>
                    <Field label="Mileage today" htmlFor="ci-mileage-pick">
                      <Input
                        id="ci-mileage-pick"
                        name="mileage"
                        type="number"
                        min={0}
                        mono
                        value={mileage}
                        onChange={(e) => setMileage(e.target.value)}
                      />
                    </Field>
                  </FormRow>
                </FormGroup>
              )}

              <FormGroup
                name="Complaint"
                hint={cannedCatalogAvailable
                  ? 'The customer’s own words, then what the shop is authorized to do.'
                  : 'The shop’s work menu is temporarily unavailable — type the scope.'}
                last
              >
                <Field
                  label="What brought them in?"
                  htmlFor="ci-description"
                  hint="Their words. Include when it started and how often if they said."
                >
                  <Textarea
                    id="ci-description"
                    name="description"
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                    {...missingProps('ci-description')}
                  />
                  {missingNote('ci-description')}
                </Field>

                <FormRow>
                  <button
                    type="button"
                    className={`${styles.intentChoice} ${intent === 'diagnosis' ? styles.intentChoiceActive : ''}`}
                    aria-pressed={intent === 'diagnosis'}
                    onClick={() => { setIntent('diagnosis'); setSelectionTouched(true); setTierWarning(null) }}
                  >
                    <strong>Find the cause</strong>
                    <span>Authorize the shop’s diagnostic labor before assignment.</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.intentChoice} ${intent === 'known' ? styles.intentChoiceActive : ''}`}
                    aria-pressed={intent === 'known'}
                    onClick={() => { setIntent('known'); setSelectionTouched(true); setTierWarning(null) }}
                  >
                    <strong>Perform known work</strong>
                    <span>The requested repair or maintenance is already known.</span>
                  </button>
                </FormRow>

                {intent === 'diagnosis' ? (
                  <>
                    {diagnosticJobs.length > 0 && (
                      <Field label="Diagnostic labor to authorize" htmlFor="ci-diagnostic-template">
                        <select
                          id="ci-diagnostic-template"
                          className="vt-field__input"
                          value={diagMode === 'manual' ? CUSTOM_SCOPE : selectedDiagnosticId}
                          onChange={(event) => {
                            setSelectionTouched(true)
                            if (event.target.value === CUSTOM_SCOPE) {
                              setDiagMode('manual')
                              return
                            }
                            setDiagMode('canned')
                            setSelectedDiagnosticId(event.target.value)
                          }}
                          {...missingProps('ci-diagnostic-template')}
                        >
                          {diagnosticJobs.map((job) => (
                            <option key={job.id} value={job.id}>{job.title}</option>
                          ))}
                          <option value={CUSTOM_SCOPE}>Something else — type it</option>
                        </select>
                        {missingNote('ci-diagnostic-template')}
                      </Field>
                    )}
                    {diagMode === 'manual' && (
                    <>
                      <Field label="Description" htmlFor="ci-diag-description">
                        <Input
                          id="ci-diag-description"
                          name="customDiagDescription"
                          maxLength={200}
                          placeholder="e.g. diagnose intermittent no-start"
                          value={customDiagDescription}
                          onChange={(event) => setCustomDiagDescription(event.target.value)}
                          {...missingProps('ci-diag-description')}
                        />
                        {missingNote('ci-diag-description')}
                      </Field>
                      <FormRow>
                        <Field label="Hours" htmlFor="ci-diag-hours">
                          <Input
                            id="ci-diag-hours"
                            name="customDiagHours"
                            inputMode="decimal"
                            mono
                            value={customDiagHours}
                            onChange={(event) => setCustomDiagHours(event.target.value)}
                            {...missingProps('ci-diag-hours')}
                          />
                          {missingNote('ci-diag-hours')}
                        </Field>
                        <Field label="Price (USD)" htmlFor="ci-diag-price">
                          <Input
                            id="ci-diag-price"
                            name="customDiagPrice"
                            inputMode="decimal"
                            mono
                            value={customDiagPrice}
                            onChange={(event) => setCustomDiagPrice(event.target.value)}
                            {...missingProps('ci-diag-price')}
                          />
                          {missingNote('ci-diag-price')}
                        </Field>
                      </FormRow>
                    </>
                    )}
                  </>
                ) : (
                  <>
                    {knownWorkJobs.length > 0 && (
                      <Field label="Work to perform" htmlFor="ci-known-template">
                        <select
                          id="ci-known-template"
                          className="vt-field__input"
                          value={knownMode === 'manual' ? CUSTOM_SCOPE : selectedKnownId}
                          onChange={(event) => {
                            setSelectionTouched(true)
                            if (event.target.value === CUSTOM_SCOPE) {
                              setKnownMode('manual')
                              return
                            }
                            setKnownMode('canned')
                            setSelectedKnownId(event.target.value)
                          }}
                          {...missingProps('ci-known-template')}
                        >
                          {knownWorkJobs.map((job) => (
                            <option key={job.id} value={job.id}>{job.title}</option>
                          ))}
                          <option value={CUSTOM_SCOPE}>Something else — type it</option>
                        </select>
                        {missingNote('ci-known-template')}
                      </Field>
                    )}
                    {knownMode === 'manual' && (
                    <FormRow>
                  <Field label="Work type" htmlFor="ci-service-kind">
                    <select
                      id="ci-service-kind"
                      name="requestedServiceKind"
                      className="vt-field__input"
                      value={requestedServiceKind}
                      onChange={(e) => {
                        setSelectionTouched(true)
                        setRequestedServiceKind(e.target.value as 'repair' | 'maintenance')
                      }}
                    >
                      <option value="repair">Repair</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </Field>
                  <Field
                    label="Requested work"
                    htmlFor="ci-service-description"
                    hint="Required. This becomes the one job on the repair order."
                  >
                    <Input
                      id="ci-service-description"
                      name="requestedServiceDescription"
                      maxLength={200}
                      placeholder="e.g. replace rear brake pads"
                      value={requestedServiceDescription}
                      onChange={(e) => setRequestedServiceDescription(e.target.value)}
                      required
                      {...missingProps('ci-service-description')}
                    />
                    {missingNote('ci-service-description')}
                  </Field>
                    </FormRow>
                    )}
                    <Field
                      label="Customer-supplied item"
                      htmlFor="ci-customer-supplied"
                      hint="Optional — record what the customer is providing; this is not a shop-supplied part."
                    >
                      <Input
                        id="ci-customer-supplied"
                        value={customerSuppliedPartsNote}
                        maxLength={500}
                        placeholder="e.g. customer supplied unopened lift kit"
                        onChange={(event) => setCustomerSuppliedPartsNote(event.target.value)}
                      />
                    </Field>
                  </>
                )}
              </FormGroup>

              {tierWarning && (
                <div
                  role="alert"
                  style={{
                    margin: '12px 32px',
                    padding: '12px 14px',
                    borderLeft: '2px solid var(--vt-risk-medium)',
                    background: 'var(--vt-bone-100)',
                    fontFamily: 'var(--vt-font-serif)',
                    fontSize: 14,
                    color: 'var(--vt-fg-2)',
                  }}
                >
                  <div>
                    This technician is below the required tier for this work. Review the
                    assignment before continuing.
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitTicket(true)}
                    disabled={busy}
                    style={{
                      minHeight: 44,
                      marginTop: 8,
                      padding: '0 14px',
                      border: '1px solid var(--vt-rule-strong)',
                      borderRadius: 3,
                      background: 'var(--vt-bone-50)',
                      color: 'var(--vt-fg)',
                      fontFamily: 'var(--vt-font-sans)',
                      fontSize: 13,
                      fontWeight: 650,
                      cursor: busy ? 'default' : 'pointer',
                    }}
                  >
                    Assign anyway
                  </button>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  style={{
                    margin: '12px 32px',
                    padding: '10px 14px',
                    borderLeft: '2px solid var(--vt-risk-high)',
                    background: 'var(--vt-bone-100)',
                    fontFamily: 'var(--vt-font-serif)',
                    fontStyle: 'italic',
                    fontSize: 14,
                    color: 'var(--vt-fg-2)',
                  }}
                >
                  {error}
                </div>
              )}

              <FormFooter
                meta={busy ? 'Submitting…' : attempted && missing ? missing.message : ''}
                actions={
                  <>
                    <Btn kind="ghost" type="button" onClick={discard}>
                      Cancel
                    </Btn>
                    <Btn kind="primary" type="submit" disabled={busy} kbd="⌘ ↵">
                      Create repair order
                    </Btn>
                  </>
                }
              />
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}
