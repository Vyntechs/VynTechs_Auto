'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
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
      return 'This account cannot create a quick ticket.'
    default:
      return 'Could not create the quick ticket. Try again.'
  }
}

export function QuickTicket({
  userEmail,
  recentCustomers = [],
}: {
  userEmail?: string
  recentCustomers?: RecentCustomer[]
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
  const [workKind, setWorkKind] = useState<WorkKind>('repair')
  const [requestedWork, setRequestedWork] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickedVehicle = recentCustomers
    .flatMap((customer) => customer.vehicles)
    .find((vehicle) => vehicle.id === pickedVehicleId)
  const isExisting = pickedVehicleId !== null
  const requestedWorkValid = requiredTextWithin(requestedWork, 200)
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
    requestedWorkValid &&
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
    if (!canSubmit) return
    setBusy(true)
    setError(null)

    const body = isExisting
      ? {
          vehicleMode: 'existing' as const,
          existingVehicleId: pickedVehicleId!,
          mileage: optionalNumber(mileage),
          requestedWork: { kind: workKind, description: requestedWork.trim() },
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
          requestedWork: { kind: workKind, description: requestedWork.trim() },
        }

    try {
      const response = await fetch('/api/tickets/quick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as {
        ticket?: { id?: string }
        error?: string
      }
      if (!response.ok || !payload.ticket?.id) {
        setError(quickTicketError(payload.error))
        setBusy(false)
        return
      }
      router.push(`/tickets/${payload.ticket.id}`)
    } catch {
      setError('The ticket service could not be reached. Try again.')
      setBusy(false)
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

  return (
    <div className={`vt-app ${styles.screen}`}>
      <Topbar
        product="Shop"
        crumbs={[{ label: 'Today' }, { label: 'Quick ticket', bold: true }]}
        user={userEmail || '—'}
      />
      <div className="vt-workspace">
        <main className="vt-main">
          <MainHeader
            eyebrow="One requested job"
            title="Quick ticket"
            sub="Capture the customer, vehicle, and one requested job. This step does not approve repair."
            actions={
              <>
                <Btn kind="ghost" size="sm" type="button" onClick={() => router.push('/today')}>
                  Discard
                </Btn>
                <Btn
                  kind="primary"
                  type="submit"
                  form="quick-ticket-form"
                  disabled={!canSubmit}
                  kbd="⌘ ↵"
                >
                  Create quick ticket
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
            >
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

              <FormGroup
                name="Requested work"
                hint="Creates one open, unassigned job. No diagnosis starts here."
                last
              >
                <FormRow>
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
                </FormRow>
                <aside className={styles.truthStrip} aria-label="Quick ticket boundary">
                  <span>OPEN</span>
                  <span>UNASSIGNED</span>
                  <span>NO REPAIR APPROVAL</span>
                </aside>
              </FormGroup>

              {error && <div className={styles.error} role="alert">{error}</div>}

              <FormFooter
                meta={busy ? 'Creating ticket…' : 'Ticket only · no diagnosis started'}
                actions={
                  <>
                    <Btn kind="ghost" type="button" onClick={() => router.push('/today')}>
                      Cancel
                    </Btn>
                    <Btn kind="primary" type="submit" disabled={!canSubmit} kbd="⌘ ↵">
                      Create quick ticket
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
