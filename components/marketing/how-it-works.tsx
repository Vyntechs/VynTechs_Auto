const HOW = [
  'You describe the vehicle and the symptom in plain text.',
  'It researches the exact vehicle live, cites its sources, asks you what to check next.',
  'It explains why it’s asking — not just what to check. You see the reasoning, not a black-box answer.',
  'It locks the diagnosis only when it has enough evidence. Then it coaches the repair.',
] as const

export function HowItWorks() {
  return (
    <section className="mk__section">
      <div className="mk-container">
        <div className="mk__how-head">
          <div className="mk__eyebrow">How it works</div>
          <h2 className="mk__h2">Four moves, in order.</h2>
        </div>
        <div className="mk__how-list">
          {HOW.map((row, i) => (
            <div className="mk__how-row" key={i}>
              <span className="mk__num">{String(i + 1).padStart(2, '0')}</span>
              <p className="mk__how-row__body">{row}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
