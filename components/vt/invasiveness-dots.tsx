export function InvasivenessDots({ value }: { value: number }) {
  const clamped = Math.max(1, Math.min(5, value))
  return (
    <span className="inv-dots" data-level={clamped}>
      <span className="inv-dots__row">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`dot ${i <= clamped ? 'filled' : ''}`} />
        ))}
      </span>
      <span className="inv-dots__label">inv · {clamped}</span>
    </span>
  )
}
