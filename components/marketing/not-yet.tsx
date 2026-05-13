const NOT_YET = [
  'Doesn’t read your scope, scan tool, or photos — you describe what you see in words.',
  'Doesn’t integrate with shop software.',
  'If the web doesn’t have good info on your vehicle, it says so.',
] as const

export function NotYet() {
  return (
    <section className="mk__section mk__not-yet">
      <div className="mk-container">
        <div className="mk__diff-head">
          <div className="mk__eyebrow">What it doesn&apos;t do yet</div>
          <h2 className="mk__h2">Three things it can&apos;t.</h2>
        </div>
        <div className="mk__diff-list">
          {NOT_YET.map((row, i) => (
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
