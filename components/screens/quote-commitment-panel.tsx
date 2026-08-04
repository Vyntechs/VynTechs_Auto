'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import {
  formatMoneyCents,
  type DraftCommitment,
  type QuoteBuilderProjection,
  type QuoteMoneySummary,
  type QuotePreparationState,
} from '@/lib/shop-os/quote-builder-ui'
import styles from './manual-quote-builder.module.css'

export type QuoteCommitmentPanelProps = {
  builder: QuoteBuilderProjection
  totals: QuoteMoneySummary
  preparation: QuotePreparationState
  editorDirty: boolean
  preparing: boolean
  confirmation: DraftCommitment | null
  preparedFocusRef: (element: HTMLParagraphElement | null) => void
  headingFocusRef?: (element: HTMLHeadingElement | null) => void
  prepareActionRef?: (element: HTMLButtonElement | null) => void
  onOpenPrepare: () => void
  onCancelPrepare: () => void
  onConfirmPrepare: () => void
  preparedActions?: ReactNode
  railStatic?: boolean
  settled?: boolean
}

export function QuoteCommitmentPanel({
  builder,
  totals,
  preparation,
  editorDirty,
  preparing,
  confirmation,
  preparedFocusRef,
  headingFocusRef,
  prepareActionRef,
  onOpenPrepare,
  onCancelPrepare,
  onConfirmPrepare,
  preparedActions,
  railStatic = false,
  settled = false,
}: QuoteCommitmentPanelProps): ReactNode {
  const commitmentHeadingRef = useRef<HTMLHeadingElement>(null)
  const activeVersion = builder.activeVersion
  const lastPrepared = builder.lastPreparedVersion
  const revised = activeVersion === null && lastPrepared?.state === 'superseded'

  useEffect(() => {
    if (confirmation) commitmentHeadingRef.current?.focus()
  }, [confirmation])

  const heading = activeVersion
    ? editorDirty
      ? `Prepared V${activeVersion.versionNumber} remains current`
      : `Prepared V${activeVersion.versionNumber}`
    : 'Current draft'

  return (
    <aside
      className={styles.tape}
      aria-label="Quote totals"
      data-rail-static={railStatic || confirmation !== null ? 'true' : 'false'}
      data-settled={settled ? 'true' : undefined}
    >
      <div className={styles.signalRail} aria-hidden="true" />
      <p className={styles.eyebrow}>Quote Bench</p>
      <h2 id="quote-commitment-heading" tabIndex={-1} ref={headingFocusRef}>{heading}</h2>

      {editorDirty && <p className={styles.unsavedTruth}>Unsaved line changes</p>}

      {activeVersion ? (
        <>
          <dl className={styles.totalList}>
            <div className={styles.grandTotal}>
              <dt>Customer total</dt>
              <dd className={styles.money}>{formatMoneyCents(activeVersion.totalCents)}</dd>
            </div>
          </dl>
          <div className={styles.preparedState}>
            <p
              role="status"
              aria-live="polite"
              tabIndex={-1}
              ref={preparedFocusRef}
            >
              Prepared V{activeVersion.versionNumber} · exact customer total
            </p>
            {preparedActions && <div className={styles.preparedActions}>{preparedActions}</div>}
          </div>
        </>
      ) : (
        <>
          {!totals.ok ? (
            <div className={styles.blocked}>
              <strong>Totals unavailable</strong>
              <p>Stored quote money could not be totaled safely. Review the quote data.</p>
            </div>
          ) : (
            <dl className={styles.totalList}>
              <div className={styles.compactDetail}>
                <dt>Subtotal</dt>
                <dd className={styles.money}>{formatMoneyCents(totals.subtotalCents)}</dd>
              </div>
              <div className={styles.compactDetail}>
                <dt>Taxable subtotal</dt>
                <dd className={styles.money}>{formatMoneyCents(totals.taxableSubtotalCents)}</dd>
              </div>
              {totals.taxConfigured ? (
                <div className={styles.compactDetail}>
                  <dt>Tax</dt>
                  <dd className={styles.money}>{formatMoneyCents(totals.taxCents)}</dd>
                </div>
              ) : (
                <div className={`${styles.unavailable} ${styles.compactDetail}`}>
                  <dt>Tax — Not configured</dt>
                  <dd>—</dd>
                </div>
              )}
              <div className={styles.grandTotal}>
                <dt>{revised ? 'Current total' : 'Total'}</dt>
                <dd className={totals.totalCents === null ? undefined : styles.money}>
                  {totals.totalCents === null ? 'Total unavailable' : formatMoneyCents(totals.totalCents)}
                </dd>
              </div>
              {revised && (
                <div className={styles.historicalTotal}>
                  <dt>Last prepared total</dt>
                  <dd className={styles.money}>{formatMoneyCents(lastPrepared.totalCents)}</dd>
                </div>
              )}
            </dl>
          )}

          <p className={styles.version}>
            {revised
              ? `V${lastPrepared.versionNumber} no longer current`
              : 'Customer has not received this'}
          </p>

          {confirmation ? (
            <div
              className={styles.commitmentPlate}
              role="dialog"
              aria-modal="false"
              aria-labelledby="quote-prepare-heading"
            >
              <h3 id="quote-prepare-heading" ref={commitmentHeadingRef} tabIndex={-1}>
                Prepare this exact quote?
              </h3>
              <p>{confirmation.jobCount} {confirmation.jobCount === 1 ? 'job' : 'jobs'} · {confirmation.lineCount} {confirmation.lineCount === 1 ? 'line' : 'lines'}</p>
              <strong>Customer will see {formatMoneyCents(confirmation.totalCents)}</strong>
              <div className={styles.commitmentActions}>
                <button type="button" className={styles.lineAction} disabled={preparing} onClick={onCancelPrepare}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.prepareAction}
                  data-primary-action="true"
                  disabled={preparing}
                  onClick={onConfirmPrepare}
                >
                  {preparing
                    ? `Preparing ${formatMoneyCents(confirmation.totalCents)}…`
                    : `Prepare ${formatMoneyCents(confirmation.totalCents)}`}
                </button>
              </div>
            </div>
          ) : preparation.kind === 'blocked' ? (
            <div className={styles.prepareState}>
              <ul>{preparation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          ) : preparation.kind === 'ready' ? (
            <div className={styles.prepareState}>
              <button
                type="button"
                className={styles.prepareAction}
                data-primary-action="true"
                ref={prepareActionRef}
                onClick={onOpenPrepare}
              >
                Prepare quote
              </button>
            </div>
          ) : null}
        </>
      )}
    </aside>
  )
}
