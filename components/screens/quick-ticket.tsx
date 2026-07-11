'use client'

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
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
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CreateNewPrefill } from '@/lib/intake/tokens-to-prefill'
import { formatMoneyCents, type SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'
import styles from './quick-ticket.module.css'

type WorkKind = 'repair' | 'maintenance'

const MAX_MILEAGE = 2_147_483_647
const MAX_VEHICLE_YEAR = new Date().getFullYear() + 1

function optionalText(value: string): string | null {
  return value.trim() || null
}

function optionalNumber(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

function requiredTextWithin(value: string, max: number): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max
}

function optionalTextWithin(value: string, max: number): boolean {
  return value.trim().length <= max
}

function mileageWithinBounds(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  if (!/^\d+$/.test(trimmed)) return false
  const numeric = Number(trimmed)
  return Number.isSafeInteger(numeric) && numeric <= MAX_MILEAGE
}

function yearWithinBounds(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1886 && numeric <= MAX_VEHICLE_YEAR
}

function vinWithinBounds(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || trimmed.length === 17
}

function quickTicketError(error?: string): string {
  switch (error) {
    case 'not_found':
      return 'That record is no longer available. Choose the customer or vehicle again.'
    case 'invalid_input':
      return 'Check the customer, vehicle, mileage, and requested work fields.'
    case 'forbidden':
    case 'inactive_profile':
    case 'no_shop':
      return 'This account cannot create a quick quote.'
    default:
      return 'Could not create the quick quote. Try again.'
  }
}

function ticketIdFromResponse(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  if (Object.keys(root).length !== 1 || !root.ticket || typeof root.ticket !== 'object' || Array.isArray(root.ticket)) return null
  const ticket = root.ticket as Record<string, unknown>
  if (Object.keys(ticket).length !== 1 || typeof ticket.id !== 'string') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticket.id)
    ? ticket.id.toLowerCase()
    : null
}

function cannedLineLabel(line: SafeCannedJobTemplate['lines'][number]): string {
  if (line.kind === 'part') return `Part · Qty ${line.quantity} · ${line.description}`
  if (line.kind === 'labor') return `Labor · ${line.hours} hr · ${line.description}`
  return `Fee · ${line.description}`
}

export function QuickTicket({
  userEmail,
  recentCustomers = [],
  cannedJobs = [],
  cannedTaxRateBps = null,
  cannedCatalogAvailable = true,
}: {
  userEmail?: string
  recentCustomers?: RecentCustomer[]
  cannedJobs?: SafeCannedJobTemplate[]
  cannedTaxRateBps?: number | null
  cannedCatalogAvailable?: boolean
}) {
  const router = useRouter()
  const [pickedVehicleId, setPickedVehicleId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [year, setYear] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [engine, setEngine] = useState('')
  const [vin, setVin] = useState('')
  const [mileage, setMileage] = useState('')
  const [plate, setPlate] = useState('')
  const [quoteMode, setQuoteMode] = useState<'canned' | 'manual'>(cannedJobs.length > 0 ? 'canned' : 'manual')
  const [selectedCannedId, setSelectedCannedId] = useState(cannedJobs[0]?.id ?? '')
  const [workKind, setWorkKind] = useState<WorkKind>('repair')
  const [requestedWork, setRequestedWork] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalogRefreshRequired, setCatalogRefreshRequired] = useState(false)
  const inFlightRef = useRef(false)
  const requestIdentityRef = useRef<{ signature: string; clientKey: string } | null>(null)
  const catalogRefreshPendingRef = useRef(false)
  const sourceSelectRef = useRef<HTMLSelectElement>(null)

  const pickedVehicle = recentCustomers
    .flatMap((customer) => customer.vehicles)
    .find((vehicle) => vehicle.id === pickedVehicleId)
  const isExisting = pickedVehicleId !== null
  const selectedCannedJob = cannedJobs.find((job) => job.id === selectedCannedId) ?? null
  useEffect(() => {
    if (!catalogRefreshPendingRef.current) return
    catalogRefreshPendingRef.current = false
    const nextMode = cannedCatalogAvailable && cannedJobs.length > 0 ? 'canned' : 'manual'
    setQuoteMode(nextMode)
    setSelectedCannedId(nextMode === 'canned' ? cannedJobs[0].id : '')
    requestIdentityRef.current = null
    setCatalogRefreshRequired(false)
    setError(null)
    setTimeout(() => sourceSelectRef.current?.focus(), 0)
  }, [cannedCatalogAvailable, cannedJobs, cannedTaxRateBps])
  const requestedWorkValid = requiredTextWithin(requestedWork, 200)
  const quoteValid = quoteMode === 'canned' ? selectedCannedJob !== null : requestedWorkValid
  const newVehicleValid =
    requiredTextWithin(name, 200) &&
    requiredTextWithin(phone, 100) &&
    optionalTextWithin(email, 320) &&
    yearWithinBounds(year) &&
    requiredTextWithin(make, 100) &&
    requiredTextWithin(model, 100) &&
    optionalTextWithin(engine, 200) &&
    vinWithinBounds(vin) &&
    mileageWithinBounds(mileage) &&
    optionalTextWithin(plate, 32)
  const canSubmit =
    !busy &&
    !catalogRefreshRequired &&
    quoteValid &&
    (isExisting ? mileageWithinBounds(mileage) : newVehicleValid)

  const pickVehicle = (vehicleId: string) => {
    setPickedVehicleId(vehicleId)
    setMileage('')
    setError(null)
  }

  const createNew = (prefill: CreateNewPrefill) => {
    if (pickedVehicleId !== null) setMileage('')
    setPickedVehicleId(null)
    if (prefill.name !== undefined) setName(prefill.name)
    if (prefill.phone !== undefined) setPhone(prefill.phone)
    if (prefill.email !== undefined) setEmail(prefill.email)
    if (prefill.year !== undefined) setYear(String(prefill.year))
    if (prefill.make !== undefined) setMake(prefill.make)
    if (prefill.vin !== undefined) setVin(prefill.vin.toUpperCase())
    if (prefill.plate !== undefined) setPlate(prefill.plate)
  }

  const submit = async () => {
    if (!canSubmit || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError(null)

    const quote = quoteMode === 'canned' && selectedCannedJob
      ? {
          mode: 'canned' as const,
          cannedJobId: selectedCannedJob.id,
          expectedFingerprint: selectedCannedJob.fingerprint,
          expectedTaxRateBps: cannedTaxRateBps,
        }
      : { mode: 'manual' as const, kind: workKind, description: requestedWork.trim() }
    const unsignedBody = isExisting
      ? {
          vehicleMode: 'existing' as const,
          existingVehicleId: pickedVehicleId!,
          mileage: optionalNumber(mileage),
          quote,
        }
      : {
          vehicleMode: 'new' as const,
          customer: {
            name: name.trim(),
            phone: phone.trim(),
            email: optionalText(email),
          },
          vehicle: {
            year: Number(year),
            make: make.trim(),
            model: model.trim(),
            engine: optionalText(engine),
            vin: optionalText(vin),
            mileage: optionalNumber(mileage),
            plate: optionalText(plate),
          },
          quote,
        }
    const signature = JSON.stringify(unsignedBody)
    if (requestIdentityRef.current?.signature !== signature) {
      requestIdentityRef.current = { signature, clientKey: crypto.randomUUID() }
    }
    const body = { ...unsignedBody, clientKey: requestIdentityRef.current.clientKey }

    try {
      const response = await fetch('/api/tickets/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      let payload: unknown
      try { payload = await response.json() } catch { payload = null }
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const ticketId = response.status === 201 ? ticketIdFromResponse(payload) : null
      if (response.status === 409 && record.retryable !== true) {
        setCatalogRefreshRequired(true)
        setError('Quote or canned-job context changed. Refresh canned jobs and choose again.')
        setBusy(false)
        inFlightRef.current = false
        return
      }
      if (response.status !== 201 || !ticketId) {
        setError(quickTicketError(typeof record.error === 'string' ? record.error : undefined))
        setBusy(false)
        inFlightRef.current = false
        return
      }
      router.push(`/tickets/${ticketId}/quote`)
    } catch {
      setError('The quote service could not be reached. Retry with the same details.')
      setBusy(false)
      inFlightRef.current = false
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
    event.preventDefault()
    event.stopPropagation()
    if (canSubmit) event.currentTarget.requestSubmit()
  }

  const refreshCatalog = () => {
    catalogRefreshPendingRef.current = true
    router.refresh()
  }

  return (
    <div className={`vt-app ${styles.screen}`}>
      <Topbar
        product="Shop"
        crumbs={[{ label: 'Today' }, { label: 'Quick quote', bold: true }]}
        user={userEmail || '—'}
      />
      <div className="vt-workspace">
        <main className="vt-main">
          <MainHeader
            eyebrow="One honest draft"
            title="Quick quote"
            sub="Capture the customer and vehicle, then start with exact saved work or a clearly incomplete manual draft."
            actions={
              <>
                <Btn kind="ghost" size="sm" type="button" disabled={busy} onClick={() => router.push('/today')}>
                  Discard
                </Btn>
                <Btn
                  kind="primary"
                  type="submit"
                  form="quick-ticket-form"
                  disabled={!canSubmit}
                  kbd="⌘ ↵"
                >
                  Create quote
                </Btn>
              </>
            }
          />

          <div className="vt-main__body">
            <form
              id="quick-ticket-form"
              className="vt-form"
              onSubmit={handleSubmit}
              onKeyDownCapture={handleKeyDown}
              aria-busy={busy}
            >
              <fieldset className={styles.formLock} disabled={busy}>
              <div className={styles.search}>
                <PredictiveIntakeSearch
                  recentCustomers={recentCustomers}
                  onPickVehicle={pickVehicle}
                  onCreateNew={createNew}
                />
              </div>

              {isExisting ? (
                <div className={styles.selectedVehicle} role="status">
                  <div>
                    <span className={styles.selectedLabel}>Existing vehicle</span>
                    <strong>
                      {pickedVehicle
                        ? `${pickedVehicle.year} ${pickedVehicle.make} ${pickedVehicle.model} selected`
                        : 'Vehicle selected'}
                    </strong>
                  </div>
                  <button
                    className={styles.changeButton}
                    type="button"
                    onClick={() => {
                      setPickedVehicleId(null)
                      setMileage('')
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <FormGroup name="Customer" hint="Name and phone are required. Email is optional.">
                    <FormRow>
                      <Field label="Name" htmlFor="qt-name">
                        <Input id="qt-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required />
                      </Field>
                      <Field label="Phone" htmlFor="qt-phone">
                        <Input id="qt-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={100} required />
                      </Field>
                      <Field label="Email" htmlFor="qt-email">
                        <Input id="qt-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} placeholder="optional" />
                      </Field>
                    </FormRow>
                  </FormGroup>

                  <FormGroup name="Vehicle" hint="Enter the vehicle details you can verify now.">
                    <FormRow>
                      <Field label="Year" htmlFor="qt-year">
                        <Input id="qt-year" type="number" min={1886} max={MAX_VEHICLE_YEAR} step={1} value={year} onChange={(event) => setYear(event.target.value)} required mono />
                      </Field>
                      <Field label="Make" htmlFor="qt-make">
                        <Input id="qt-make" value={make} onChange={(event) => setMake(event.target.value)} maxLength={100} required />
                      </Field>
                      <Field label="Model" htmlFor="qt-model">
                        <Input id="qt-model" value={model} onChange={(event) => setModel(event.target.value)} maxLength={100} required />
                      </Field>
                      <Field label="Engine" htmlFor="qt-engine">
                        <Input id="qt-engine" value={engine} onChange={(event) => setEngine(event.target.value)} maxLength={200} placeholder="optional" />
                      </Field>
                    </FormRow>
                    <FormRow>
                      <Field label="VIN" htmlFor="qt-vin" hint="Optional · 17 characters">
                        <Input id="qt-vin" value={vin} onChange={(event) => setVin(event.target.value.toUpperCase())} pattern=".{17}" maxLength={17} mono />
                      </Field>
                      <Field label="Mileage today" htmlFor="qt-mileage">
                        <Input id="qt-mileage" type="number" min={0} max={MAX_MILEAGE} step={1} value={mileage} onChange={(event) => setMileage(event.target.value)} mono />
                      </Field>
                      <Field label="License plate" htmlFor="qt-plate">
                        <Input id="qt-plate" value={plate} onChange={(event) => setPlate(event.target.value)} maxLength={32} mono />
                      </Field>
                    </FormRow>
                  </FormGroup>
                </>
              )}

              {isExisting && (
                <FormGroup name="This visit" hint="Optional — update the current odometer reading.">
                  <Field label="Mileage today" htmlFor="qt-existing-mileage">
                    <Input id="qt-existing-mileage" type="number" min={0} max={MAX_MILEAGE} step={1} value={mileage} onChange={(event) => setMileage(event.target.value)} mono />
                  </Field>
                </FormGroup>
              )}

              <FormGroup name="Quote source" hint="Creates one open, unassigned job. Nothing is prepared, sent, approved, or started here." last>
                <FormRow>
                  <Field label="Source" htmlFor="qt-quote-source">
                    <select
                      id="qt-quote-source"
                      ref={sourceSelectRef}
                      className="vt-field__input"
                      value={quoteMode}
                      onChange={(event) => {
                        setQuoteMode(event.target.value as 'canned' | 'manual')
                        setError(null)
                      }}
                    >
                      {cannedJobs.length > 0 && <option value="canned">Canned job</option>}
                      <option value="manual">Manual draft</option>
                    </select>
                  </Field>
                  {quoteMode === 'canned' ? (
                    <Field label="Canned job" htmlFor="qt-canned-job">
                      <select
                        id="qt-canned-job"
                        className="vt-field__input"
                        value={selectedCannedId}
                        onChange={(event) => {
                          setSelectedCannedId(event.target.value)
                          setError(null)
                        }}
                      >
                        {cannedJobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                      </select>
                    </Field>
                  ) : (
                    <>
                      <Field label="Work type" htmlFor="qt-work-kind">
                        <select
                          id="qt-work-kind"
                          className="vt-field__input"
                          value={workKind}
                          onChange={(event) => setWorkKind(event.target.value as WorkKind)}
                        >
                          <option value="repair">Repair</option>
                          <option value="maintenance">Maintenance</option>
                        </select>
                      </Field>
                      <Field label="Requested work" htmlFor="qt-requested-work" hint="Required · 200 characters maximum">
                        <Textarea
                          id="qt-requested-work"
                          rows={3}
                          maxLength={200}
                          value={requestedWork}
                          onChange={(event) => setRequestedWork(event.target.value)}
                          required
                        />
                      </Field>
                    </>
                  )}
                </FormRow>
                {!cannedCatalogAvailable && (
                  <p className={styles.catalogNotice} role="status">
                    Canned jobs are unavailable. Manual quote capture is still available.
                  </p>
                )}
                {quoteMode === 'canned' && selectedCannedJob ? (
                  <section className={styles.quotePreview} aria-label="Exact quote preview">
                    <header>
                      <div>
                        <span>{selectedCannedJob.kind === 'repair' ? 'Repair' : 'Maintenance'} · Tier {selectedCannedJob.defaultRequiredSkillTier}</span>
                        <strong>{selectedCannedJob.title}</strong>
                      </div>
                      <strong>{formatMoneyCents(selectedCannedJob.summary.subtotalCents)}</strong>
                    </header>
                    <ul>
                      {selectedCannedJob.lines.map((line, index) => (
                        <li key={`${line.sort}:${line.kind}:${index}`}>
                          <span>{cannedLineLabel(line)}</span>
                          <strong>{formatMoneyCents(line.priceCents)}</strong>
                        </li>
                      ))}
                    </ul>
                    <dl>
                      <div><dt>Subtotal</dt><dd>{formatMoneyCents(selectedCannedJob.summary.subtotalCents)}</dd></div>
                      <div><dt>Tax</dt><dd>{selectedCannedJob.summary.taxCents === null ? 'Unavailable' : formatMoneyCents(selectedCannedJob.summary.taxCents)}</dd></div>
                      <div><dt>Total</dt><dd>{selectedCannedJob.summary.totalCents === null ? 'Unavailable' : formatMoneyCents(selectedCannedJob.summary.totalCents)}</dd></div>
                    </dl>
                    {selectedCannedJob.summary.totalCents === null && (
                      <p>Tax is not configured. This will remain an incomplete draft.</p>
                    )}
                  </section>
                ) : quoteMode === 'manual' ? (
                  <p className={styles.draftNotice}>Manual capture creates an incomplete draft with no priced lines.</p>
                ) : null}
                <aside className={styles.truthStrip} aria-label="Quick ticket boundary">
                  <span>OPEN</span>
                  <span>UNASSIGNED</span>
                  <span>NOT PREPARED</span>
                  <span>NO REPAIR APPROVAL</span>
                </aside>
              </FormGroup>

              {error && (
                <div className={styles.error} role="alert">
                  <span>{error}</span>
                  {catalogRefreshRequired && (
                    <button type="button" className={styles.changeButton} onClick={refreshCatalog}>
                      Refresh canned jobs
                    </button>
                  )}
                </div>
              )}

              <FormFooter
                meta={busy ? 'Creating quote draft…' : 'Explicit Prepare happens on the quote page'}
                actions={
                  <>
                    <Btn kind="ghost" type="button" onClick={() => router.push('/today')}>
                      Cancel
                    </Btn>
                    <Btn kind="primary" type="submit" disabled={!canSubmit} kbd="⌘ ↵">
                      Create quote
                    </Btn>
                  </>
                }
              />
              </fieldset>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}
