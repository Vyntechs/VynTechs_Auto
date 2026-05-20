export function ConfidenceGate({ gate }: { gate: number }) {
  const pct = (Math.max(0, Math.min(1, gate)) * 100).toFixed(0)
  return (
    <div className="cov-gate">
      <span className="cov-gate__label">Gate</span>
      <div className="cov-gate__track">
        <div className="cov-gate__mark" style={{ left: `${pct}%` }} />
      </div>
      <span className="cov-gate__val">≥ {pct} %</span>
    </div>
  )
}
