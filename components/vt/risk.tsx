import type { RiskLevel } from './types'

const labels: Record<RiskLevel, string> = {
  zero: 'Zero',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  destructive: 'Destructive',
}

export function Risk({ level }: { level: RiskLevel }) {
  return (
    <span className={`risk risk-${level}`} aria-label={`Risk class: ${labels[level]}`}>
      <span className="glyph" aria-hidden="true" />
      Risk · {labels[level]}
    </span>
  )
}
