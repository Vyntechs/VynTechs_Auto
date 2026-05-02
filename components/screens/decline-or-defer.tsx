'use client'
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
  confidenceGap?: string
  options: Option[]
  onSelectOption?: (number: 1 | 2 | 3) => void
  pending?: 1 | 2 | 3 | null
  error?: string | null
}

export function DeclineOrDefer({
  vehicleName,
  vehicleVin,
  timer,
  riskLabel = 'Gating · destructive class',
  gap,
  confidenceGap,
  options,
  onSelectOption,
  pending = null,
  error = null,
}: Props) {
  return (
    <div className="app">
      <VehicleStrip name={vehicleName} vin={vehicleVin} timer={timer} />
      <div className="dod-surface" style={{ flex: 1, overflow: 'auto' }}>
        <span
          className="eyebrow"
          style={{ color: 'var(--vt-risk-destructive)' }}
        >
          <span aria-hidden="true">⏵ </span>
          {riskLabel}
        </span>
        <h2 className="dod-headline" style={{ marginTop: 10 }}>
          Confidence too low to commit to a destructive action.
        </h2>
        {confidenceGap && (
          <p
            className="dod-gap"
            style={{ color: 'var(--vt-fg)', fontWeight: 500 }}
          >
            {confidenceGap}
          </p>
        )}
        <p
          className="dod-gap"
          style={confidenceGap ? { fontSize: 12, opacity: 0.7, marginTop: -4 } : undefined}
        >
          {gap}
        </p>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12 }}
        >
          {options.map((opt) => {
            const isPending = pending === opt.number
            const isDisabled = pending !== null
            return (
              <button
                key={opt.number}
                type="button"
                className="btn btn-secondary"
                onClick={onSelectOption ? () => onSelectOption(opt.number) : undefined}
                disabled={isDisabled}
                aria-busy={isPending}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  cursor: onSelectOption && !isDisabled ? 'pointer' : 'default',
                  opacity: isDisabled && !isPending ? 0.5 : 1,
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
                  {isPending ? 'Working…' : opt.description}
                </div>
              </button>
            )
          })}
        </div>
        {error && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              fontFamily: 'var(--vt-font-sans)',
              fontSize: 12,
              color: 'var(--vt-risk-destructive)',
            }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
