'use client'

import { useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
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
import styles from './counter-intake.module.css'

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
  requestedService?: { kind: 'repair' | 'maintenance'; description: string }
  assignedTechId: string | null
  confirmBelowTier?: boolean
}

type TierWarning = {
  code: 'below_required_tier'
  assignedTechId: string
  assignedSkillTier: 1 | 2 | 3
  requiredSkillTier: 1 | 2 | 3
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
    case 'forbidden':
    case 'inactive_profile':
    case 'no_shop':
      return 'This account cannot create a counter ticket.'
    default:
      return 'Could not create the ticket. Try again.'
  }
}

export function CounterIntake({
  userEmail,
  recentCustomers = [],
  team = [],
  workloadFailed = false,
}: {
  userEmail?: string
  recentCustomers?: RecentCustomer[]
  team?: TeamMember[]
  workloadFailed?: boolean
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
  const [whenStarted, setWhenStarted] = useState('')
  const [howOften, setHowOften] = useState('')
  const [requestedServiceKind, setRequestedServiceKind] = useState<'repair' | 'maintenance'>(
    'repair',
  )
  const [requestedServiceDescription, setRequestedServiceDescription] = useState('')
  const [vinBusy, setVinBusy] = useState(false)
  const [vinStatus, setVinStatus] = useState<string | null>(null)
  const [vinStatusKind, setVinStatusKind] = useState<'success' | 'error' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tierWarning, setTierWarning] = useState<TierWarning | null>(null)

  const isPickExisting = pickedVehicleId !== null
  // Mirror the counter-ticket requirements. VIN remains optional for walk-ins;
  // customer contact, year/make/model, and concern are required.
  const canSubmit =
    !busy &&
    description.trim() !== '' &&
    (isPickExisting ||
      (name.trim() !== '' &&
        phone.trim() !== '' &&
        year.trim() !== '' &&
        make.trim() !== '' &&
        model.trim() !== ''))

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
        setVinStatus(
          'error' in payload && payload.error === 'invalid'
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
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    setTierWarning(null)
    const requestedService = requestedServiceDescription.trim()
      ? { kind: requestedServiceKind, description: requestedServiceDescription.trim() }
      : undefined
    const common = {
      concern: description.trim(),
      whenStarted: optionalText(whenStarted),
      howOften: optionalText(howOften),
      requestedService,
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
    try {
      const res = await fetch('/api/tickets/counter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await res.json()) as {
        ticket?: { id?: string }
        error?: string
        warning?: TierWarning
      }
      if (payload.error === 'tier_confirmation_required' && payload.warning) {
        setTierWarning(payload.warning)
        setBusy(false)
        return
      }
      if (!res.ok || !payload.ticket?.id) {
        setError(ticketErrorMessage(payload.error))
        setBusy(false)
        return
      }
      router.push(`/tickets/${payload.ticket.id}`)
    } catch {
      setError('The counter service could not be reached. Try again.')
      setBusy(false)
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void submitTicket()
  }

  const handleFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || (!e.metaKey && !e.ctrlKey)) return
    e.preventDefault()
    if (!canSubmit) return
    e.currentTarget.requestSubmit()
  }

  return (
    <div className={`vt-app ${styles.screen}`}>
      <Topbar
        product="Counter"
        crumbs={[{ label: 'Today' }, { label: 'Intake', bold: true }]}
        user={userEmail || '—'}
      />
      <div className="vt-workspace">
        <main className="vt-main">
          <MainHeader
            eyebrow="New work order"
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
            title="Who's at the counter?"
            sub="Search to find an existing customer or vehicle, or fill in the form below."
            actions={
              <>
                <Btn kind="ghost" size="sm" type="button" onClick={() => router.push('/today')}>
                  Discard
                </Btn>
                <Btn
                  kind="primary"
                  type="submit"
                  form="counter-intake-form"
                  kbd="⌘ ↵"
                  disabled={!canSubmit}
                >
                  Create repair order
                </Btn>
              </>
            }
          />

          <div className="vt-main__body">
            <form
              id="counter-intake-form"
              className="vt-form"
              onSubmit={handleSubmit}
              onKeyDown={handleFormKeyDown}
            >
              <div className={styles.search}>
                <PredictiveIntakeSearch
                  recentCustomers={recentCustomers}
                  onPickVehicle={handlePickVehicle}
                  onCreateNew={handleCreateNew}
                />
              </div>

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
                    complaint below and submit to start the ticket.
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
                        />
                      </Field>
                      <Field label="Phone" htmlFor="ci-phone" hint="Used for completion text">
                        <Input
                          id="ci-phone"
                          name="phone"
                          type="tel"
                          mono
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required
                        />
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
                        />
                      </Field>
                      <Field label="Make" htmlFor="ci-make">
                        <Input
                          id="ci-make"
                          name="make"
                          value={make}
                          onChange={(e) => setMake(e.target.value)}
                        />
                      </Field>
                      <Field label="Model" htmlFor="ci-model">
                        <Input
                          id="ci-model"
                          name="model"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                        />
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

              <FormGroup name="Complaint" hint="Record the customer's own words.">
                <Field label="What brought them in?" htmlFor="ci-description">
                  <Textarea
                    id="ci-description"
                    name="description"
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </Field>
                <FormRow>
                  <Field label="When did it start?" htmlFor="ci-when-started">
                    <Input
                      id="ci-when-started"
                      name="whenStarted"
                      value={whenStarted}
                      onChange={(e) => setWhenStarted(e.target.value)}
                    />
                  </Field>
                  <Field label="How often?" htmlFor="ci-how-often">
                    <Input
                      id="ci-how-often"
                      name="howOften"
                      value={howOften}
                      onChange={(e) => setHowOften(e.target.value)}
                    />
                  </Field>
                </FormRow>
              </FormGroup>

              <FormGroup
                name="Work requested"
                hint="Optional — name the work now. Otherwise, the customer’s concern becomes one repair job."
                last
              >
                <FormRow>
                  <Field label="Work type" htmlFor="ci-service-kind">
                    <select
                      id="ci-service-kind"
                      name="requestedServiceKind"
                      className="vt-field__input"
                      value={requestedServiceKind}
                      onChange={(e) =>
                        setRequestedServiceKind(e.target.value as 'repair' | 'maintenance')
                      }
                    >
                      <option value="repair">Repair</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </Field>
                  <Field
                    label="Requested work"
                    htmlFor="ci-service-description"
                    hint="Optional — becomes this repair order’s one work item"
                  >
                    <Input
                      id="ci-service-description"
                      name="requestedServiceDescription"
                      placeholder="e.g. replace rear brake pads"
                      value={requestedServiceDescription}
                      onChange={(e) => setRequestedServiceDescription(e.target.value)}
                    />
                  </Field>
                </FormRow>
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
                meta={busy ? 'Submitting…' : ''}
                actions={
                  <>
                    <Btn kind="ghost" type="button" onClick={() => router.push('/today')}>
                      Cancel
                    </Btn>
                    <Btn kind="primary" type="submit" disabled={!canSubmit} kbd="⌘ ↵">
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
