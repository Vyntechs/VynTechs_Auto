import { Gauge, Eye, Ear, Wind, Ruler, Wrench, Circle } from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'

const METHOD_ICON: Record<string, Icon> = {
  PID: Gauge,
  VISUAL: Eye,
  AUDIBLE: Ear,
  SMELL: Wind,
  MEASUREMENT: Ruler,
  BENCH: Wrench,
}

export function MethodChip({ method }: { method: string }) {
  const upper = method.toUpperCase()
  const Icon = METHOD_ICON[upper] ?? Circle
  return (
    <span className="method-chip">
      <Icon size={12} />
      {upper}
    </span>
  )
}
