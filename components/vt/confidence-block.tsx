export function ConfidenceBlock({
  value,
  gate,
  basis,
  blocked = false,
}: {
  value: number
  gate?: number
  basis?: string
  blocked?: boolean
}) {
  const filled = Math.min(1, Math.max(0, value))
  const color = blocked ? 'var(--vt-risk-destructive)' : 'var(--vt-signal-500)'
  const percent = (value * 100).toFixed(1)
  const gatePercent = gate ? (gate * 100).toFixed(0) : null

  return (
    <div role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="AI confidence">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 8,
        }}
      >
        <span className="eyebrow">Confidence</span>
        <span className="eyebrow" style={{ color }}>
          {blocked && gatePercent ? `Below gate · ${gatePercent}%` : 'Met'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 32,
            fontWeight: 500,
            color,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {percent}
          <span style={{ fontSize: 16, opacity: 0.6 }}>%</span>
        </div>
      </div>
      <div className="confidence-bar" style={{ marginTop: 10, position: 'relative' }}>
        <div className="filled" style={{ flex: filled, background: color }} />
        <div className="empty" style={{ flex: 1 - filled }} />
        {gate && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${gate * 100}%`,
              top: -2,
              width: 1,
              height: 8,
              background: 'var(--vt-fg)',
            }}
          />
        )}
      </div>
      {basis && (
        <div
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 11,
            color: 'var(--vt-fg-3)',
            marginTop: 8,
          }}
        >
          {basis}
        </div>
      )}
    </div>
  )
}
