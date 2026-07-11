'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  AdaptiveCoverage,
  DiagnosticMode,
} from '@/lib/diagnostics/adaptive/contracts'
import styles from './adaptive-diagnostic-entry.module.css'

const COVERAGE_LABELS: Record<AdaptiveCoverage['state'], string> = {
  exact: 'Exact verified',
  verified_equivalent: 'Verified equivalent',
  partial: 'Partial coverage',
  draft: 'Draft — manual only',
  unsupported: 'Unsupported — manual only',
}

export function AdaptiveDiagnosticEntry(props: {
  sessionId: string
  concern: string
  vehicleName: string
  coverage: AdaptiveCoverage
  onSelected?: (mode: DiagnosticMode) => void
}): React.JSX.Element {
  const router = useRouter()
  const requestKey = useRef(crypto.randomUUID())
  const [pendingMode, setPendingMode] = useState<DiagnosticMode | null>(null)
  const [retryMode, setRetryMode] = useState<DiagnosticMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function selectMode(mode: DiagnosticMode) {
    if (retryMode !== null && retryMode !== mode) return
    setPendingMode(mode)
    setError(null)

    try {
      const response = await fetch(`/api/sessions/${props.sessionId}/adaptive/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestKey: requestKey.current,
          expectedRevision: 0,
          mode,
        }),
      })
      if (!response.ok) throw new Error('mode selection rejected')

      props.onSelected?.(mode)
      router.refresh()
    } catch {
      setRetryMode(mode)
      setPendingMode(null)
      setError(`Could not confirm whether this choice was saved. Refreshing saved session state; retry ${mode === 'guided' ? 'Guide me' : "I've got it"} if this screen remains.`)
      router.refresh()
    }
  }

  const guidedAvailable = props.coverage.technicianInstructionsAvailable
    && props.coverage.instructionProof !== null
  const pendingLabel = pendingMode === 'guided'
    ? 'Opening guided diagnosis…'
    : pendingMode === 'manual'
      ? 'Opening manual diagnosis…'
      : ''

  return (
    <main className={styles.shell}>
      <section className={styles.plate} aria-labelledby="adaptive-entry-title">
        <header className={styles.header}>
          <p className={styles.eyebrow}>Diagnostic orientation</p>
          <p className={styles.vehicle}>{props.vehicleName}</p>
          <h1 id="adaptive-entry-title" className={styles.concern}>
            {props.concern}
          </h1>
        </header>

        <dl className={styles.truth}>
          <div>
            <dt>Coverage</dt>
            <dd>{COVERAGE_LABELS[props.coverage.state]}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{props.coverage.system} system</dd>
          </div>
        </dl>

        <div className={`${styles.choices} ${guidedAvailable ? '' : styles.manualOnly}`}>
          {guidedAvailable ? (
            <button
              className={styles.choice}
              type="button"
              disabled={pendingMode !== null || (retryMode !== null && retryMode !== 'guided')}
              onClick={() => selectMode('guided')}
            >
              <svg className={styles.trace} viewBox="0 0 320 72" aria-hidden="true">
                <path d="M0 36h76v-18h54v36h54V36h44v-14h46v14h46" />
                <circle cx="76" cy="36" r="3" />
                <circle cx="184" cy="36" r="3" />
                <circle cx="274" cy="36" r="3" />
              </svg>
              <span className={styles.choiceTitle}>Guide me</span>
              <span className={styles.choiceDetail}>Show the next supported test</span>
            </button>
          ) : null}

          <button
            className={styles.choice}
            type="button"
            disabled={pendingMode !== null || (retryMode !== null && retryMode !== 'manual')}
            onClick={() => selectMode('manual')}
          >
            <span className={styles.choiceTitle}>I've got it</span>
            <span className={styles.choiceDetail}>Work freely and capture evidence</span>
          </button>
        </div>

        <p className={styles.feedback} role="status" aria-live="polite">
          {pendingLabel}
        </p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </main>
  )
}
