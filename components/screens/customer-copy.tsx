'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type {
  CustomerCopyBlocker,
  CustomerCopyProjection,
  CustomerCopyResult,
} from '@/lib/shop-os/customer-copy'
import styles from './customer-copy.module.css'

const DOCUMENT_LABELS: Record<CustomerCopyProjection['documentKind'], string> = {
  estimate: 'Estimate',
  invoice: 'Invoice',
  paid_receipt: 'Paid receipt',
}

const DECISION_LABELS: Record<CustomerCopyProjection['decisions'][number]['decision'], string> = {
  approved: 'Customer said yes',
  declined: 'Customer said no',
  deferred: 'Customer said later',
}

const IDENTITY_BLOCKERS: CustomerCopyBlocker[] = [
  'shop_phone',
  'shop_address_line_1',
  'shop_city',
  'shop_region',
  'shop_postal_code',
]

export function CustomerCopy({
  copy: initialCopy,
  canManageShopIdentity,
  ticketId,
  refreshCopy,
}: {
  copy: CustomerCopyProjection
  canManageShopIdentity: boolean
  ticketId?: string
  refreshCopy?: (ticketId: string) => Promise<CustomerCopyResult>
}): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [copy, setCopy] = useState(initialCopy)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const [printAuthorized, setPrintAuthorized] = useState(false)
  const [printPending, setPrintPending] = useState(false)
  useEffect(() => headingRef.current?.focus(), [])
  useEffect(() => {
    setCopy(initialCopy)
    setPrintAuthorized(false)
    setPrintPending(false)
  }, [initialCopy])
  useEffect(() => {
    if (!printPending || refreshing || !copy.readyToPrint || !printAuthorized) return
    setPrintPending(false)
    window.print()
  }, [copy, printAuthorized, printPending, refreshing])
  useEffect(() => {
    function revokePrintAuthorization(): void {
      setPrintAuthorized(false)
      setPrintPending(false)
    }
    window.addEventListener('afterprint', revokePrintAuthorization)
    return () => window.removeEventListener('afterprint', revokePrintAuthorization)
  }, [])
  const documentLabel = DOCUMENT_LABELS[copy.documentKind]
  const missingIdentity = copy.blockers.filter((blocker) => IDENTITY_BLOCKERS.includes(blocker))
  const pricingUnavailable = copy.blockers.includes('pricing_unavailable')
  const screenReady = copy.readyToPrint && !refreshError
  const printable = screenReady && printAuthorized

  async function printFreshCopy(): Promise<void> {
    setPrintAuthorized(false)
    setPrintPending(false)
    if (!refreshCopy || !ticketId) {
      setRefreshError(true)
      return
    }
    setRefreshing(true)
    setRefreshError(false)
    try {
      const result = await refreshCopy(ticketId)
      if (!result.ok) {
        setRefreshError(true)
        return
      }
      setCopy(result.copy)
      if (result.copy.readyToPrint) {
        setPrintAuthorized(true)
        setPrintPending(true)
      }
    } catch {
      setRefreshError(true)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className={styles.preview} aria-label="Customer copy preview" data-customer-copy-preview>
      <div className={styles.controls} data-customer-copy-controls>
        <div>
          <p>Customer copy</p>
          <span>{refreshing ? 'Refreshing current money…' : screenReady ? `${documentLabel} ready` : 'Printing unavailable'}</span>
        </div>
        <button
          type="button"
          disabled={!copy.readyToPrint || refreshing}
          onClick={() => void printFreshCopy()}
        >
          {refreshing ? 'Refreshing…' : 'Print customer copy'}
        </button>
      </div>

      {refreshError && (
        <p className={styles.blocker} role="alert">
          Customer copy could not be refreshed. Nothing was printed. Try again.
        </p>
      )}

      {pricingUnavailable && (
        <p className={styles.blocker} role="alert">
          Pricing must be repaired before this customer copy can print.
        </p>
      )}
      {missingIdentity.length > 0 && (
        <div className={styles.blocker} role="alert">
          <p>Add {identityList(missingIdentity)} before printing.</p>
          {canManageShopIdentity
            ? <Link href="/settings/shop">Open Shop Settings</Link>
            : <span>An owner can add this in Shop Settings.</span>}
        </div>
      )}

      <article
        className={styles.paper}
        data-customer-copy-document
        data-document-kind={copy.documentKind}
        data-print-ready={String(printable)}
      >
        <header className={styles.documentHeader}>
          <div className={styles.shopIdentity}>
            <p className={styles.shopName}>{copy.shop.name}</p>
            {copy.shop.phone && <p>{copy.shop.phone}</p>}
            {copy.shop.address.map((line) => <p key={line}>{line}</p>)}
          </div>
          <div className={styles.documentIdentity}>
            <p>RO {String(copy.ticketNumber).padStart(6, '0')}</p>
            <h2 ref={headingRef} tabIndex={-1}>{documentLabel}</h2>
            {copy.documentKind === 'paid_receipt' && copy.closedAt && (
              <p className={styles.closedAt}>Closed {dateOnly(copy.closedAt)}</p>
            )}
            <p className={styles.balanceLabel}>Balance</p>
            <p className={styles.balance}>{money(copy.totals.balanceCents)}</p>
          </div>
        </header>

        <div className={styles.factGrid}>
          <section aria-labelledby="customer-copy-customer">
            <h3 id="customer-copy-customer">Customer</h3>
            <p>{copy.customer.name}</p>
          </section>
          <section aria-labelledby="customer-copy-vehicle">
            <h3 id="customer-copy-vehicle">Vehicle</h3>
            <p>{copy.vehicle.year} {copy.vehicle.make} {copy.vehicle.model}</p>
            {copy.vehicle.vin && <p><span>VIN</span> {copy.vehicle.vin}</p>}
            {copy.vehicle.odometer !== null && (
              <p><span>Odometer</span> {copy.vehicle.odometer.toLocaleString('en-US')} mi</p>
            )}
          </section>
        </div>

        <section className={styles.work} aria-labelledby="customer-copy-work">
          <h3 id="customer-copy-work">Work and pricing</h3>
          {copy.jobs.length === 0 ? (
            <p className={styles.empty}>No trustworthy pricing is available.</p>
          ) : copy.jobs.map((job, jobIndex) => (
            <article key={`${job.kind}:${job.title}:${jobIndex}`} className={styles.job} data-customer-copy-job>
              <header>
                <p>{job.kind}</p>
                <h4>{job.title}</h4>
              </header>
              <ul>
                {job.lines.map((line, index) => (
                  <li key={`${line.kind}:${line.description}:${index}`}>
                    <div>
                      <p>{line.description}</p>
                      <span>{lineDetail(line)}</span>
                      {line.taxable && <span> · Taxable</span>}
                    </div>
                    <strong>{money(line.priceCents)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        {copy.decisions.length > 0 && (
          <section className={styles.decisions} aria-labelledby="customer-copy-decisions">
            <h3 id="customer-copy-decisions">Recorded customer decisions</h3>
            <ul>
              {copy.decisions.map((decision, index) => (
                <li key={`${decision.jobTitle}:${decision.recordedAt}:${index}`}>
                  <span>{decision.jobTitle}</span>
                  <strong>{decisionText(decision)}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={styles.moneyGrid}>
          {copy.totals.payments.length > 0 && (
            <section className={styles.payments} aria-labelledby="customer-copy-payments">
              <h3 id="customer-copy-payments">Payments</h3>
              <ul>
                {copy.totals.payments.map((payment, index) => (
                  <li key={`${payment.recordedAt}:${index}`}>
                    <span>{titleCase(payment.method)} · {dateTime(payment.recordedAt)}</span>
                    <strong>{money(payment.amountCents)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <dl className={styles.totals} data-customer-copy-totals>
            <div><dt>Subtotal</dt><dd>{money(copy.totals.subtotalCents)}</dd></div>
            <div><dt>Tax</dt><dd>{money(copy.totals.taxCents)}</dd></div>
            <div><dt>Total</dt><dd>{money(copy.totals.totalCents)}</dd></div>
            <div><dt>Paid</dt><dd>{money(copy.totals.paidCents)}</dd></div>
            <div className={styles.totalBalance}><dt>Balance</dt><dd>{money(copy.totals.balanceCents)}</dd></div>
          </dl>
        </div>
      </article>
      <p className={styles.printBlocker} data-customer-copy-print-blocker>
        Customer copy is not ready to print. Return to Shop OS and resolve the blocker.
      </p>
    </section>
  )
}

function identityList(blockers: CustomerCopyBlocker[]): string {
  const labels = blockers.map((blocker) => ({
    shop_phone: 'the shop phone',
    shop_address_line_1: 'the street address',
    shop_city: 'city',
    shop_region: 'state or region',
    shop_postal_code: 'postal code',
    pricing_unavailable: 'pricing',
  })[blocker])
  if (labels.length < 2) return labels[0] ?? 'the missing shop details'
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

function lineDetail(line: CustomerCopyProjection['jobs'][number]['lines'][number]): string {
  if (line.kind === 'part') {
    return [line.quantity, line.partNumber, line.brand].filter(Boolean).join(' · ')
  }
  if (line.kind === 'labor') {
    return `${line.hours} hr${line.laborRateCents === null ? '' : ` · ${money(line.laborRateCents)}/hr`}`
  }
  return 'Fee'
}

function decisionText(decision: CustomerCopyProjection['decisions'][number]): string {
  return [
    DECISION_LABELS[decision.decision],
    decision.method ? titleCase(decision.method.replace('_', ' ')) : null,
    dateTime(decision.recordedAt),
  ].filter(Boolean).join(' · ')
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}

function dateOnly(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(value))
}
