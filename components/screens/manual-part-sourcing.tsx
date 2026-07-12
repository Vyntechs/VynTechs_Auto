'use client'

import { useEffect, useRef, useState } from 'react'
import { parseMoneyToCents } from '@/lib/shop-os/quote-builder-ui'
import { parseScaledDecimal } from '@/lib/shop-os/quote-math'
import styles from './manual-part-sourcing.module.css'
import {
  buildManualOfferPayload,
  manualPartCommitLabel,
  normalizedManualPartSignature,
  parseCreatedVendorAccountResponse,
  parseManualOfferResponse,
  type ManualPartDraft,
  type SafeManualVendorAccount,
  type SafeSourcedQuoteLine,
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
  onSaved: (line: SafeSourcedQuoteLine) => Promise<boolean>
  onRefreshQuote: () => Promise<boolean>
  onAccessFailure: (status: 401 | 403 | 404, body: unknown) => void
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
  ticketId,
  ticketLabel,
  vehicleLabel,
  job,
  accounts,
  catalogAvailable,
  canCreateVendorAccount,
  diagnosisSeed,
  busy,
  onBusyChange,
  onAccountCreated,
  onSaved,
  onRefreshQuote,
  onAccessFailure,
  onClose,
}: ManualPartSourcingProps) {
  const initialAccountId = accounts.length === 1 ? accounts[0].id : ''
  const [draft, setDraft] = useState(() => createManualPartDraft(initialAccountId))
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID())
  const [localAccounts, setLocalAccounts] = useState(accounts)
  const [accountFormOpen, setAccountFormOpen] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [accountClientKey, setAccountClientKey] = useState<string | null>(null)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [savedLine, setSavedLine] = useState<SafeSourcedQuoteLine | null>(null)
  const [captureRefreshRequired, setCaptureRefreshRequired] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [status, setStatus] = useState('')
  const initialSignature = useRef(normalizedManualPartSignature(createManualPartDraft(initialAccountId)))
  const fieldRefs = useRef<Partial<Record<DraftKey, HTMLElement | null>>>({})
  const panelRef = useRef<HTMLElement | null>(null)
  const confirmRef = useRef<HTMLElement | null>(null)
  const keepEditingRef = useRef<HTMLButtonElement | null>(null)
  const closeReturnFocusRef = useRef<HTMLElement | null>(null)
  const supplierCreatedRef = useRef(false)
  const mutationInFlightRef = useRef(false)

  const dirty = normalizedManualPartSignature(draft) !== initialSignature.current
  const isBusy = busy || mutationBusy
  const requiredError = firstInvalidField(draft, catalogAvailable)
  const invalidDetailsKey = requiredError?.details ? requiredError.key : null

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

  function resetOfferLifecycle() {
    const resetAccountId = localAccounts.length === 1 ? localAccounts[0].id : ''
    const resetDraft = createManualPartDraft(resetAccountId)
    initialSignature.current = normalizedManualPartSignature(resetDraft)
    setDraft(resetDraft)
    setClientKey(crypto.randomUUID())
    setAccountFormOpen(false)
    setAccountName('')
    setAccountClientKey(null)
    setSavedLine(null)
    setCaptureRefreshRequired(false)
    setDetailsOpen(false)
    setConfirmingClose(false)
    setStatus('')
    closeReturnFocusRef.current = null
    supplierCreatedRef.current = false
  }

  function closeAfterSuccessfulRefresh() {
    resetOfferLifecycle()
    onClose()
  }

  function requestClose() {
    if (isBusy || mutationInFlightRef.current) return
    if (dirty) {
      closeReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setConfirmingClose(true)
      return
    }
    onClose()
  }

  function openAccountForm() {
    setStatus('')
    setAccountName('')
    setAccountClientKey(crypto.randomUUID())
    setAccountFormOpen(true)
  }

  function updateAccountName(value: string) {
    setStatus('')
    setAccountName((previous) => {
      if (previous.trim() !== value.trim()) setAccountClientKey(crypto.randomUUID())
      return value
    })
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && (isBusy || mutationInFlightRef.current)) {
        event.preventDefault()
        return
      }
      if (event.key === 'Escape' && confirmingClose) {
        event.preventDefault()
        keepEditing()
        return
      }
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
    const focusKey = !catalogAvailable || accounts.length === 0 ? 'vendorAccountId' : error?.key ?? 'description'
    fieldRefs.current[focusKey]?.focus()
    // Initial focus is set only when the panel opens; validation handles later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (confirmingClose) keepEditingRef.current?.focus()
  }, [confirmingClose])

  useEffect(() => {
    if (open && invalidDetailsKey) setDetailsOpen(true)
  }, [invalidDetailsKey, open])

  if (!open) return null

  const commitLabel = manualPartCommitLabel(draft)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = firstInvalidField(draft, catalogAvailable)
    if (error) {
      if (error.details) setDetailsOpen(true)
      setStatus(error.label)
      requestAnimationFrame(() => fieldRefs.current[error.key]?.focus())
      return
    }
    if (savedLine || isBusy) return
    await captureOffer()
  }

  async function readJson(response: Response): Promise<unknown> {
    try { return await response.json() } catch { return {} }
  }

  function delegateAccessFailure(status: number, body: unknown): boolean {
    if (status !== 401 && status !== 403 && status !== 404) return false
    onAccessFailure(status, body)
    return true
  }

  async function createAccount() {
    const displayName = accountName.trim()
    if (!accountClientKey || displayName.length === 0 || displayName.length > 120 || isBusy) {
      setStatus('Supplier name')
      return
    }
    setMutationBusy(true)
    mutationInFlightRef.current = true
    onBusyChange(true)
    try {
      const response = await fetch('/api/shop/vendor-accounts', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: accountClientKey, displayName }),
      })
      const body = await readJson(response)
      if (delegateAccessFailure(response.status, body)) return
      const parsed = parseCreatedVendorAccountResponse(response.status, body)
      if (!parsed
        || parsed.vendorAccount.id !== accountClientKey.toLowerCase()
        || parsed.vendorAccount.displayName !== displayName) {
        setStatus('The saved response could not be verified. Refresh before continuing.')
        return
      }
      supplierCreatedRef.current = true
      setLocalAccounts((current) => current.some((account) => account.id === parsed.vendorAccount.id)
        ? current
        : [...current, parsed.vendorAccount])
      updateDraft('vendorAccountId', parsed.vendorAccount.id)
      setAccountFormOpen(false)
      onAccountCreated(parsed.vendorAccount)
      setStatus('Supplier saved. Continue with the part details.')
      requestAnimationFrame(() => {
        const missing = firstInvalidField({ ...draft, vendorAccountId: parsed.vendorAccount.id }, catalogAvailable)
        fieldRefs.current[missing?.key ?? 'description']?.focus()
      })
    } catch {
      setStatus('Connection interrupted. Retry with the same details.')
    } finally {
      mutationInFlightRef.current = false
      setMutationBusy(false)
      onBusyChange(false)
    }
  }

  async function captureOffer() {
    let payload
    try {
      payload = buildManualOfferPayload(draft, clientKey)
    } catch {
      setStatus('Review the visible fields, then retry.')
      return
    }
    setMutationBusy(true)
    mutationInFlightRef.current = true
    onBusyChange(true)
    try {
      const response = await fetch(`/api/tickets/${ticketId}/quote/jobs/${job.id}/parts/manual-offers`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await readJson(response)
      if (response.status === 404) {
        setLocalAccounts((current) => current.filter((account) => account.id !== payload.vendorAccountId))
        updateDraft('vendorAccountId', '')
        setStatus('That supplier is no longer available. Choose another.')
        return
      }
      if (response.status === 409) {
        const conflict = body && typeof body === 'object' ? body as Record<string, unknown> : null
        if (conflict?.error === 'conflict' && conflict.retryable === true) {
          setCaptureRefreshRequired(true)
          setStatus('This quote changed elsewhere. Refresh and retry.')
        } else {
          setStatus('The saved response could not be verified. Refresh before continuing.')
        }
        return
      }
      if (delegateAccessFailure(response.status, body)) return
      const parsed = parseManualOfferResponse(response.status, body)
      if (!parsed) {
        setStatus('The saved response could not be verified. Refresh before continuing.')
        return
      }
      if ('unavailable' in parsed) {
        setStatus('Supplier reports this part unavailable. No quote line was added.')
        return
      }
      const selectedAccount = localAccounts.find((account) => account.id === payload.vendorAccountId)
      if (!selectedAccount
        || parsed.line.id !== payload.clientKey
        || parsed.line.jobId !== job.id.toLowerCase()
        || parsed.line.description !== payload.description
        || parsed.line.quantity !== payload.quantity
        || parsed.line.priceCents !== payload.priceCents
        || parsed.line.taxable !== payload.taxable
        || parsed.line.partNumber !== payload.partNumber
        || parsed.line.brand !== payload.brand
        || parsed.line.fitment !== payload.fitment
        || parsed.sourcing.vendorAccountId !== payload.vendorAccountId
        || parsed.sourcing.displayName !== selectedAccount.displayName
        || parsed.sourcing.externalOfferId !== payload.externalOfferId
        || parsed.sourcing.unitCostCents !== payload.unitCostCents
        || parsed.sourcing.coreChargeCents !== payload.coreChargeCents
        || parsed.sourcing.availability !== payload.availability
        || parsed.sourcing.fulfillment.method !== payload.fulfillment.method
        || parsed.sourcing.fulfillment.locationLabel !== payload.fulfillment.locationLabel) {
        setStatus('The saved response could not be verified. Refresh before continuing.')
        return
      }
      setSavedLine(parsed.line)
      let refreshed
      try {
        refreshed = await onSaved(parsed.line)
      } catch {
        setStatus('Part saved. Refresh the quote to see current totals.')
        return
      }
      if (refreshed) {
        closeAfterSuccessfulRefresh()
        return
      }
      setStatus('Part saved. Refresh the quote to see current totals.')
    } catch {
      setStatus(supplierCreatedRef.current
        ? 'Supplier saved. The part was not added yet.'
        : 'Connection interrupted. Retry with the same details.')
    } finally {
      mutationInFlightRef.current = false
      setMutationBusy(false)
      onBusyChange(false)
    }
  }

  async function refreshSavedLine() {
    if (!savedLine || isBusy) return
    setMutationBusy(true)
    mutationInFlightRef.current = true
    onBusyChange(true)
    try {
      if (await onSaved(savedLine)) closeAfterSuccessfulRefresh()
      else setStatus('Part saved. Refresh the quote to see current totals.')
    } catch {
      setStatus('Part saved. Refresh the quote to see current totals.')
    } finally {
      mutationInFlightRef.current = false
      setMutationBusy(false)
      onBusyChange(false)
    }
  }

  async function refreshCaptureConflict() {
    if (!captureRefreshRequired || isBusy) return
    setMutationBusy(true)
    mutationInFlightRef.current = true
    onBusyChange(true)
    try {
      if (await onRefreshQuote()) {
        setCaptureRefreshRequired(false)
        setStatus('')
      } else {
        setStatus('This quote changed elsewhere. Refresh and retry.')
      }
    } catch {
      setStatus('This quote changed elsewhere. Refresh and retry.')
    } finally {
      mutationInFlightRef.current = false
      setMutationBusy(false)
      onBusyChange(false)
    }
  }

  function useDiagnosisSeed() {
    if (!diagnosisSeed) return
    updateDraft('description', diagnosisSeed.description)
  }

  function keepEditing() {
    const target = closeReturnFocusRef.current
    setConfirmingClose(false)
    queueMicrotask(() => target?.focus())
  }

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-part-sourcing-title"
    >
      <div className={styles.content} data-testid="manual-part-dialog-content" inert={confirmingClose ? true : undefined}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{vehicleLabel ? `${vehicleLabel} · ${ticketLabel}` : ticketLabel}</p>
            <h2 id="manual-part-sourcing-title">Source part for {job.title}</h2>
          </div>
          <button type="button" className={styles.close} disabled={isBusy} onClick={requestClose} aria-label="Close part sourcing">×</button>
        </header>

        <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.body}>
          {!catalogAvailable ? (
            <p ref={(node) => { fieldRefs.current.vendorAccountId = node }} className={styles.notice} tabIndex={-1}>Sourcing is temporarily unavailable. Manual quote entry still works.</p>
          ) : (
            <fieldset className={styles.fieldset}>
              <legend>Supplier</legend>
              {localAccounts.length > 0 ? (
                <div className={styles.chips}>
                  {localAccounts.map((account) => (
                    <label className={styles.chip} key={account.id}>
                      <input
                        ref={(node) => { if (account.id === localAccounts[0]?.id) fieldRefs.current.vendorAccountId = node }}
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
              ) : canCreateVendorAccount ? (accountFormOpen ? (
                <div className={styles.field}>
                  <label htmlFor="manual-supplier-name">Supplier name</label>
                  <input
                    ref={(node) => { fieldRefs.current.vendorAccountId = node }}
                    id="manual-supplier-name"
                    value={accountName}
                    maxLength={121}
                    onChange={(event) => updateAccountName(event.target.value)}
                  />
                  <button type="button" className={styles.secondary} disabled={isBusy} onClick={createAccount}>Save supplier</button>
                </div>
              ) : (
                <button ref={(node) => { fieldRefs.current.vendorAccountId = node }} type="button" className={styles.secondary} onClick={openAccountForm}>Add supplier</button>
              )) : (
                <p ref={(node) => { fieldRefs.current.vendorAccountId = node }} className={styles.notice} tabIndex={-1}>An owner needs to add a supplier before this part can be sourced.</p>
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
            onClick={() => setDetailsOpen((current) => requiredError?.details ? true : !current)}
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
          <p role="status" aria-live="polite">
            {isBusy
              ? (accountFormOpen ? 'Saving supplier…' : savedLine || captureRefreshRequired ? 'Refreshing quote…' : 'Adding sourced part…')
              : status || (requiredError ? `Needed: ${requiredError.label}` : '')}
          </p>
          {savedLine ? (
            <button type="button" className={styles.commit} disabled={isBusy} onClick={refreshSavedLine}>Refresh quote</button>
          ) : captureRefreshRequired ? (
            <button type="button" className={styles.commit} disabled={isBusy} onClick={refreshCaptureConflict}>Refresh quote</button>
          ) : (
            <button type="submit" className={styles.commit} disabled={isBusy || !catalogAvailable || localAccounts.length === 0 || requiredError !== null}>
              {isBusy ? 'Adding sourced part…' : commitLabel}
            </button>
          )}
        </footer>
        </form>
      </div>

      {confirmingClose ? (
        <div className={styles.confirmBackdrop}>
          <section ref={confirmRef} className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="discard-draft-title" aria-describedby="discard-draft-consequence">
            <h3 id="discard-draft-title">Discard sourced part draft?</h3>
            <p id="discard-draft-consequence">The details entered here are kept only while this quote is open.</p>
            <div>
              <button ref={keepEditingRef} type="button" onClick={keepEditing}>Keep editing</button>
              <button type="button" className={styles.danger} disabled={isBusy} onClick={() => {
                if (!isBusy && !mutationInFlightRef.current) onClose()
              }}>Discard draft</button>
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
  if (draft.fulfillmentMethod !== 'unknown' && draft.locationLabel.trim().length > 500) return { key: 'locationLabel', label: 'Location label', details: true }
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
