'use client'

import { useEffect, useRef, useState } from 'react'
import { parseMoneyToCents } from '@/lib/shop-os/quote-builder-ui'
import { parseScaledDecimal } from '@/lib/shop-os/quote-math'
import styles from './manual-part-sourcing.module.css'
import {
  manualPartCommitLabel,
  normalizedManualPartSignature,
  type ManualPartDraft,
  type SafeManualVendorAccount,
} from '@/lib/shop-os/parts-sourcing-ui'

export type ManualPartSourcingProps = {
  open: boolean
  ticketId: string
  ticketLabel: string
  vehicleLabel: string | null
  job: { id: string; title: string }
  accounts: SafeManualVendorAccount[]
  catalogAvailable: boolean
  canCreateVendorAccount: boolean
  diagnosisSeed: { description: string } | null
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onAccountCreated: (account: SafeManualVendorAccount) => void
  onSaved: (lineId: string) => Promise<boolean>
  onClose: () => void
}

function createManualPartDraft(vendorAccountId: string): ManualPartDraft {
  return {
    vendorAccountId,
    description: '',
    quantity: '1',
    unitCost: '',
    customerPrice: '',
    taxable: true,
    partNumber: '',
    brand: '',
    fitment: '',
    externalOfferId: '',
    coreCharge: '0.00',
    availability: 'unknown',
    fulfillmentMethod: 'unknown',
    locationLabel: '',
  }
}

type DraftKey = keyof ManualPartDraft

const MAX_PART_QUANTITY_SCALED = 999_999_999_999n
const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ManualPartSourcing({
  open,
  ticketLabel,
  vehicleLabel,
  job,
  accounts,
  catalogAvailable,
  canCreateVendorAccount,
  diagnosisSeed,
  busy,
  onClose,
}: ManualPartSourcingProps) {
  const initialAccountId = accounts.length === 1 ? accounts[0].id : ''
  const [draft, setDraft] = useState(() => createManualPartDraft(initialAccountId))
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID())
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [status, setStatus] = useState('')
  const initialSignature = useRef(normalizedManualPartSignature(createManualPartDraft(initialAccountId)))
  const fieldRefs = useRef<Partial<Record<DraftKey, HTMLElement | null>>>({})
  const panelRef = useRef<HTMLElement | null>(null)
  const confirmRef = useRef<HTMLElement | null>(null)
  const keepEditingRef = useRef<HTMLButtonElement | null>(null)

  const dirty = normalizedManualPartSignature(draft) !== initialSignature.current

  function updateDraft<K extends DraftKey>(key: K, value: ManualPartDraft[K]) {
    setStatus('')
    setDraft((previous) => {
      const next = { ...previous, [key]: value }
      if (normalizedManualPartSignature(previous) !== normalizedManualPartSignature(next)) {
        setClientKey(crypto.randomUUID())
      }
      return next
    })
  }

  function requestClose() {
    if (dirty) {
      setConfirmingClose(true)
      return
    }
    onClose()
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !confirmingClose) {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const container = confirmingClose ? confirmRef.current : panelRef.current
      if (!container) return
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  useEffect(() => {
    if (!open) return
    const error = firstInvalidField(draft, catalogAvailable)
    fieldRefs.current[error?.key ?? 'description']?.focus()
    // Initial focus is set only when the panel opens; validation handles later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (confirmingClose) keepEditingRef.current?.focus()
  }, [confirmingClose])

  if (!open) return null

  const requiredError = firstInvalidField(draft, catalogAvailable)
  const commitLabel = manualPartCommitLabel(draft)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = firstInvalidField(draft, catalogAvailable)
    if (!error) return
    if (error.details) setDetailsOpen(true)
    setStatus(error.label)
    requestAnimationFrame(() => fieldRefs.current[error.key]?.focus())
  }

  function useDiagnosisSeed() {
    if (!diagnosisSeed) return
    updateDraft('description', diagnosisSeed.description)
  }

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-part-sourcing-title"
      data-client-key={clientKey}
    >
      <div className={styles.content} data-testid="manual-part-dialog-content" inert={confirmingClose ? true : undefined}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{vehicleLabel ? `${vehicleLabel} · ${ticketLabel}` : ticketLabel}</p>
            <h2 id="manual-part-sourcing-title">Source part for {job.title}</h2>
          </div>
          <button type="button" className={styles.close} onClick={requestClose} aria-label="Close part sourcing">×</button>
        </header>

        <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.body}>
          {!catalogAvailable ? (
            <p className={styles.notice}>Sourcing is temporarily unavailable. Manual quote entry still works.</p>
          ) : (
            <fieldset className={styles.fieldset}>
              <legend>Supplier</legend>
              {accounts.length > 0 ? (
                <div className={styles.chips}>
                  {accounts.map((account) => (
                    <label className={styles.chip} key={account.id}>
                      <input
                        ref={(node) => { if (account.id === accounts[0]?.id) fieldRefs.current.vendorAccountId = node }}
                        type="radio"
                        name="vendor-account"
                        value={account.id}
                        checked={draft.vendorAccountId === account.id}
                        onChange={() => updateDraft('vendorAccountId', account.id)}
                      />
                      <span>{account.displayName}</span>
                    </label>
                  ))}
                </div>
              ) : canCreateVendorAccount ? (
                <button type="button" className={styles.secondary}>Add supplier</button>
              ) : (
                <p className={styles.notice}>An owner needs to add a supplier before this part can be sourced.</p>
              )}
            </fieldset>
          )}

          {diagnosisSeed ? (
            <aside className={styles.seed} aria-label="Starting point from locked diagnosis">
              <p>Starting point from locked diagnosis</p>
              <p>{diagnosisSeed.description}</p>
              <button type="button" onClick={useDiagnosisSeed}>Use</button>
            </aside>
          ) : null}

          <div className={styles.field}>
            <label htmlFor="manual-part-description">Part description</label>
            <input
              ref={(node) => { fieldRefs.current.description = node }}
              id="manual-part-description"
              value={draft.description}
              maxLength={501}
              onChange={(event) => updateDraft('description', event.target.value)}
            />
          </div>

          <div className={styles.costGrid}>
            <div className={styles.field}>
              <label htmlFor="manual-part-quantity">Quantity</label>
              <input
                ref={(node) => { fieldRefs.current.quantity = node }}
                id="manual-part-quantity"
                inputMode="decimal"
                value={draft.quantity}
                onChange={(event) => updateDraft('quantity', event.target.value)}
              />
            </div>
            <MoneyField
              id="manual-part-unit-cost"
              label="Supplier unit cost"
              value={draft.unitCost}
              setRef={(node) => { fieldRefs.current.unitCost = node }}
              onChange={(value) => updateDraft('unitCost', value)}
            />
          </div>

          <div className={`${styles.field} ${styles.customerPrice}`}>
            <label htmlFor="manual-part-customer-price">Customer line price</label>
            <span>Complete price shown on the quote</span>
            <input
              ref={(node) => { fieldRefs.current.customerPrice = node }}
              id="manual-part-customer-price"
              inputMode="decimal"
              value={draft.customerPrice}
              onChange={(event) => updateDraft('customerPrice', event.target.value)}
            />
          </div>

          <label className={styles.toggle}>
            <input type="checkbox" checked={draft.taxable} onChange={(event) => updateDraft('taxable', event.target.checked)} />
            <span>Taxable</span>
          </label>

          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={detailsOpen}
            aria-controls="manual-part-details"
            onClick={() => setDetailsOpen((current) => !current)}
          >
            Part details <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
          </button>

          {detailsOpen ? (
            <div id="manual-part-details" className={styles.details}>
              <TextField id="manual-part-number" label="Part number" value={draft.partNumber} setRef={(node) => { fieldRefs.current.partNumber = node }} onChange={(value) => updateDraft('partNumber', value)} />
              <TextField id="manual-part-brand" label="Brand" value={draft.brand} setRef={(node) => { fieldRefs.current.brand = node }} onChange={(value) => updateDraft('brand', value)} />
              <TextField id="manual-part-fitment" label="Fitment" value={draft.fitment} setRef={(node) => { fieldRefs.current.fitment = node }} onChange={(value) => updateDraft('fitment', value)} />
              <TextField id="manual-part-reference" label="Human reference" value={draft.externalOfferId} setRef={(node) => { fieldRefs.current.externalOfferId = node }} onChange={(value) => updateDraft('externalOfferId', value)} />
              <MoneyField id="manual-part-core" label="Supplier core charge" value={draft.coreCharge} setRef={(node) => { fieldRefs.current.coreCharge = node }} onChange={(value) => updateDraft('coreCharge', value)} />

              <ChoiceGroup
                legend="Availability"
                name="availability"
                value={draft.availability}
                choices={[['in_stock', 'In stock'], ['special_order', 'Special order'], ['unknown', 'Unknown']]}
                onChange={(value) => updateDraft('availability', value as ManualPartDraft['availability'])}
              />
              <ChoiceGroup
                legend="Fulfillment"
                name="fulfillment"
                value={draft.fulfillmentMethod}
                choices={[['pickup', 'Pickup'], ['delivery', 'Delivery'], ['ship', 'Ship'], ['unknown', 'Unknown']]}
                onChange={(value) => updateDraft('fulfillmentMethod', value as ManualPartDraft['fulfillmentMethod'])}
              />
              {draft.fulfillmentMethod !== 'unknown' ? (
                <TextField id="manual-part-location" label="Location label" value={draft.locationLabel} setRef={(node) => { fieldRefs.current.locationLabel = node }} onChange={(value) => updateDraft('locationLabel', value)} />
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <p role="status" aria-live="polite">{status || (requiredError ? `Needed: ${requiredError.label}` : '')}</p>
          <button type="submit" className={styles.commit} disabled={busy || !catalogAvailable || accounts.length === 0}>
            {busy ? 'Adding sourced part…' : commitLabel}
          </button>
        </footer>
        </form>
      </div>

      {confirmingClose ? (
        <div className={styles.confirmBackdrop}>
          <section ref={confirmRef} className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="discard-draft-title">
            <h3 id="discard-draft-title">Discard sourced part draft?</h3>
            <p>The details entered here are kept only while this quote is open.</p>
            <div>
              <button ref={keepEditingRef} type="button" onClick={() => setConfirmingClose(false)}>Keep editing</button>
              <button type="button" className={styles.danger} onClick={onClose}>Discard draft</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}

function TextField({ id, label, value, onChange, setRef }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  setRef: (node: HTMLInputElement | null) => void
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input ref={setRef} id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function MoneyField(props: Omit<React.ComponentProps<typeof TextField>, 'onChange'> & { onChange: (value: string) => void }) {
  return (
    <div className={styles.field}>
      <label htmlFor={props.id}>{props.label}</label>
      <input ref={props.setRef} id={props.id} inputMode="decimal" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </div>
  )
}

function ChoiceGroup({ legend, name, value, choices, onChange }: {
  legend: string
  name: string
  value: string
  choices: [string, string][]
  onChange: (value: string) => void
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <div className={styles.chips}>
        {choices.map(([choiceValue, label]) => (
          <label className={styles.chip} key={choiceValue}>
            <input
              type="radio"
              name={name}
              value={choiceValue}
              checked={value === choiceValue}
              aria-label={label === 'Unknown' ? `Unknown ${legend.toLowerCase()}` : label}
              onChange={() => onChange(choiceValue)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

type FieldError = { key: DraftKey; label: string; details?: boolean }

function firstInvalidField(draft: ManualPartDraft, catalogAvailable: boolean): FieldError | null {
  if (!catalogAvailable) return null
  if (!draft.vendorAccountId) return { key: 'vendorAccountId', label: 'Supplier' }
  if (!draft.description.trim() || draft.description.trim().length > 500) return { key: 'description', label: 'Part description' }
  if (!validQuantity(draft.quantity)) return { key: 'quantity', label: 'Quantity' }
  if (!validMoney(draft.unitCost)) return { key: 'unitCost', label: 'Supplier unit cost' }
  if (!validMoney(draft.customerPrice)) return { key: 'customerPrice', label: 'Customer line price' }
  if (draft.partNumber.trim().length > 200) return { key: 'partNumber', label: 'Part number', details: true }
  if (draft.brand.trim().length > 200) return { key: 'brand', label: 'Brand', details: true }
  if (draft.fitment.trim().length > 500) return { key: 'fitment', label: 'Fitment', details: true }
  if (draft.externalOfferId.trim().length > 500) return { key: 'externalOfferId', label: 'Human reference', details: true }
  if (!validMoney(draft.coreCharge)) return { key: 'coreCharge', label: 'Supplier core charge', details: true }
  if (draft.locationLabel.trim().length > 500) return { key: 'locationLabel', label: 'Location label', details: true }
  return null
}

function validQuantity(value: string): boolean {
  try {
    const quantity = parseScaledDecimal(value.trim(), 3)
    return quantity > 0n && quantity <= MAX_PART_QUANTITY_SCALED
  } catch {
    return false
  }
}

function validMoney(value: string): boolean {
  try {
    parseMoneyToCents(value.trim())
    return true
  } catch {
    return false
  }
}
