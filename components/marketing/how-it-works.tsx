const HOW = [
  'You type the car and what’s wrong.',
  'It reads the open web for that exact car. Forums, TSBs, the works. Shows you every source.',
  'It tells you what to check next, and why. Every step shows how sure it is.',
  'It locks the diagnosis when the evidence is there. Then it walks you through the fix.',
] as const

export function HowItWorks() {
  return (
    <section className="mk__section">
      <div className="mk-container">
        <div className="mk__how-head">
          <div className="mk__eyebrow">How it works</div>
          <h2 className="mk__h2">From &ldquo;what&rsquo;s wrong&rdquo; to the locked diagnosis.</h2>
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
