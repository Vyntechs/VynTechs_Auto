const DIFF = [
  'Every reasoning step cites a real source — no black box.',
  'Honest “I don’t know” — silent when there’s no evidence.',
  'Researches the exact vehicle live; doesn’t guess from training data.',
  'Two-phase: locks the diagnosis before coaching the repair.',
  'Calibrated confidence at every step.',
] as const

export function Different() {
  return (
    <section className="mk__section">
      <div className="mk-container">
        <div className="mk__diff-head">
          <div className="mk__eyebrow">What&apos;s different</div>
          <h2 className="mk__h2">Five things this gets right.</h2>
        </div>
        <div className="mk__diff-list">
          {DIFF.map((row, i) => (
            <div className="mk__diff-row" key={i}>
              <span className="mk__num">{String(i + 1).padStart(2, '0')}</span>
              <p className="mk__diff-row__body">{row}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
