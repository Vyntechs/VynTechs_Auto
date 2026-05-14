const NOT_YET = [
  'Doesn’t read scope traces or scan tool screens. Wiring diagrams it does — upload a photo.',
  'Doesn’t talk to shop software.',
  'When the open web doesn’t have info on your car, it tells you.',
] as const

export function NotYet() {
  return (
    <section className="mk__section mk__not-yet">
      <div className="mk-container">
        <div className="mk__diff-head">
          <div className="mk__eyebrow">Not yet</div>
          <h2 className="mk__h2">What it can&apos;t do.</h2>
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
