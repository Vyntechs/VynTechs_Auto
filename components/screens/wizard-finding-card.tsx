'use client'

import type { Finding, WizardState } from '@/lib/flows/types'

export function WizardFindingCard({
  finding, history, onBack, onLockIn, pending, error,
}: {
  finding: Finding
  history: WizardState['history']
  onBack: () => void
  onLockIn: () => void
  pending: boolean
  error: string | null
}) {
  return (
    <article className={`vt-finding-card vt-finding-card--${finding.severity}`}>
      <header>
        <h2>FINDING</h2>
        <p className="vt-finding-verdict">{finding.verdict}</p>
      </header>

      <section className="vt-finding-section">
        <h3>What to do</h3>
        <p>{finding.action}</p>
      </section>

      {finding.expectedSignal && (
        <section className="vt-finding-section">
          <h3>What to look for after</h3>
          <p>{finding.expectedSignal}</p>
        </section>
      )}

      {/* Real walk history — the honest "how we got here" trail, not canned narration. */}
      <section className="vt-finding-section">
        <h3>How we got here</h3>
        <ol>
          {history.map((h, i) => (
            <li key={i}>{h.title} — {h.label}</li>
          ))}
        </ol>
      </section>

      <footer className="vt-finding-actions">
        <button onClick={onBack} className="vt-btn vt-btn-tertiary">Back</button>
        <button onClick={onLockIn} disabled={pending} className="vt-btn vt-btn-primary">
          {pending ? 'Locking in…' : 'Lock in diagnosis'}
        </button>
      </footer>

      {error && <div className="vt-form-error" role="alert">{error}</div>}
    </article>
  )
}
