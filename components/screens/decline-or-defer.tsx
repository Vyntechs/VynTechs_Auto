import { VehicleStrip } from '@/components/vt'

type Option = {
  number: 1 | 2 | 3
  title: string
  description: string
  emphasized?: boolean
}

type Props = {
  vehicleName: string
  vehicleVin: string
  timer: string
  riskLabel?: string
  gap: string
  options: Option[]
}

export function DeclineOrDefer({
  vehicleName,
  vehicleVin,
  timer,
  riskLabel = 'Gating · destructive class',
  gap,
  options,
}: Props) {
  return (
    <div className="app">
      <VehicleStrip name={vehicleName} vin={vehicleVin} timer={timer} />
      <div className="dod-surface" style={{ flex: 1, overflow: 'auto' }}>
        <span
          className="eyebrow"
          style={{ color: 'var(--vt-risk-destructive)' }}
        >
          ⏵ {riskLabel}
        </span>
        <h2 className="dod-headline" style={{ marginTop: 10 }}>
          Confidence too low to commit to a destructive action.
        </h2>
        <p className="dod-gap">{gap}</p>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12 }}
        >
          {options.map((opt) => (
            <button
              key={opt.number}
              type="button"
              className="btn btn-secondary"
              style={{
                textAlign: 'left',
                padding: '14px 16px',
                ...(opt.emphasized ? { borderColor: 'var(--vt-amber-500)' } : null),
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  marginBottom: 4,
                  ...(opt.emphasized ? { color: 'var(--vt-amber-500)' } : null),
                }}
              >
                {opt.number} · {opt.title}
              </div>
              <div
                style={{
                  fontFamily: 'var(--vt-font-sans)',
                  fontSize: 12,
                  color: 'var(--vt-fg-2)',
                  fontWeight: 400,
                  lineHeight: 1.4,
                }}
              >
                {opt.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
