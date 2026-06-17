/**
 * Gate B honesty signal. Mounted at the top of every AI-diagnostic container
 * (ActiveSession diagnosing-active, DiagnosisProposedReview, RepairPhaseView).
 *
 * The AI path is the fall-through for cases NO sourced curator flow covers — i.e.
 * the least-vetted, highest-risk output. It must say so, unmissably, every time.
 * Uses the amber "needs-field-check" register (--vt-amber-*) by design.
 *
 * Deliberately NOT shown on the curator-flow wizard, which IS shop-sourced.
 */
export function AiUnverifiedBanner() {
  return (
    <div
      role="note"
      aria-label="This diagnosis is an AI guess and has not been verified by a real tech"
      style={{
        background: 'var(--vt-amber-300)',
        borderLeft: '3px solid var(--vt-amber-600)',
        borderRadius: 4,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--vt-font-mono)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          // Dark ink on the amber field — the amber bg + border carry the caution
          // register; the eyebrow stays max-contrast (AA) so the warning is legible.
          color: 'var(--vt-fg)',
        }}
      >
        AI guess · not verified by a real tech
      </span>
      <span
        style={{
          fontFamily: 'var(--vt-font-serif)',
          fontSize: 13,
          lineHeight: 1.45,
          color: 'var(--vt-fg)',
        }}
      >
        This may be wrong. Verify it yourself before condemning any part.
      </span>
    </div>
  )
}
