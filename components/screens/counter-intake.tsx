'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
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

type IntakeBody = {
  customer: { name: string; phone: string; email: string }
  vehicle: {
    vin: string
    vinScanned: boolean
    year: string
    make: string
    model: string
    engine: string
    mileage: string
    plate: string
  }
  complaint: { description: string; whenStarted: string; howOften: string; authorized: string }
}

export function CounterIntake() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [vin, setVin] = useState('')
  const [scanned, setScanned] = useState(false)
  const [year, setYear] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [engine, setEngine] = useState('')
  const [mileage, setMileage] = useState('')
  const [plate, setPlate] = useState('')
  const [description, setDescription] = useState('')
  const [whenStarted, setWhenStarted] = useState('')
  const [howOften, setHowOften] = useState('')
  const [authorized, setAuthorized] = useState('Diagnostic only · $0 quote review')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !busy && name.trim() !== '' && vin.trim() !== '' && description.trim() !== ''

  const handleVinChange = (e: ChangeEvent<HTMLInputElement>) =>
    setVin(e.target.value.toUpperCase())

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const body: IntakeBody = {
      customer: { name: name.trim(), phone: phone.trim(), email: email.trim() },
      vehicle: {
        vin: vin.trim(),
        vinScanned: scanned,
        year: year.trim(),
        make: make.trim(),
        model: model.trim(),
        engine: engine.trim(),
        mileage: mileage.trim(),
        plate: plate.trim(),
      },
      complaint: {
        description: description.trim(),
        whenStarted: whenStarted.trim(),
        howOften: howOften.trim(),
        authorized: authorized.trim(),
      },
    }
    try {
      const res = await fetch('/api/intake/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await res.json()) as { sessionId?: string; error?: string }
      if (!res.ok || !payload.sessionId) {
        setError(payload.error ?? 'Could not submit. Try again.')
        setBusy(false)
        return
      }
      router.push(`/sessions/${payload.sessionId}`)
    } catch {
      setError('Network error. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="vt-app">
      <Topbar
        product="Counter"
        crumbs={[{ label: 'Today' }, { label: 'Intake', bold: true }]}
        user="Diana"
      />
      <div className="vt-workspace">
        <main className="vt-main">
          <MainHeader
            eyebrow="New work order"
            title="Who's at the counter?"
            sub="Type or paste. Tab moves through fields. When you submit, the job lands in a tech's queue."
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
                  Send to Techs
                </Btn>
              </>
            }
          />

          <div className="vt-main__body">
            <form id="counter-intake-form" className="vt-form" onSubmit={handleSubmit}>
              <FormGroup name="Customer" hint="Name and phone are required. Email is optional.">
                <FormRow>
                  <Field label="Name" htmlFor="ci-name">
                    <Input
                      id="ci-name"
                      name="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
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
                hint="VIN auto-fills year, make, model. Verify the engine."
              >
                <Field label="VIN" htmlFor="ci-vin">
                  <div className="vt-field__compound">
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
                      className={`vt-field__scan-btn${scanned ? ' vt-field__scan-btn--scanned' : ''}`}
                      onClick={() => setScanned((s) => !s)}
                      aria-pressed={scanned}
                    >
                      {scanned ? '◎ Scanned' : 'Scan with camera'}
                    </button>
                  </div>
                </Field>
                <FormRow>
                  <Field label="Year" htmlFor="ci-year">
                    <Input
                      id="ci-year"
                      name="year"
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

              <FormGroup
                name="Complaint"
                hint="In the customer's own words is best. The AI does the translation."
                last
              >
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
                  <Field label="Customer authorized" htmlFor="ci-authorized">
                    <Input
                      id="ci-authorized"
                      name="authorized"
                      value={authorized}
                      onChange={(e) => setAuthorized(e.target.value)}
                    />
                  </Field>
                </FormRow>
              </FormGroup>

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
                meta={busy ? 'Submitting…' : 'Auto-saved · last keystroke just now'}
                actions={
                  <>
                    <Btn kind="ghost" type="button" onClick={() => router.push('/today')}>
                      Cancel
                    </Btn>
                    <Btn kind="primary" type="submit" disabled={!canSubmit} kbd="⌘ ↵">
                      Send to Techs
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
