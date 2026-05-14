const DIFF = [
  'Every step shows you what it read. No black box.',
  'When it doesn’t know, it says so. It doesn’t guess.',
  'It reads the open web for the car in your bay. Not training data.',
  'Locks the diagnosis first. Then walks you through the fix.',
  'Every step shows how sure it is.',
] as const

export function Different() {
  return (
    <section className="mk__section">
      <div className="mk-container">
        <div className="mk__diff-head">
          <div className="mk__eyebrow">What&apos;s different</div>
          <h2 className="mk__h2">Why this isn&rsquo;t more AI hype.</h2>
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
