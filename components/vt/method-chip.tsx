import { Gauge, Eye, Ear, Wind, Ruler, Wrench, Circle } from '@phosphor-icons/react/dist/ssr'
import type { FC } from 'react'

type PhosphorIcon = FC<{ size?: number }>

const METHOD_ICON: Record<string, PhosphorIcon> = {
  PID: Gauge as PhosphorIcon,
  VISUAL: Eye as PhosphorIcon,
  AUDIBLE: Ear as PhosphorIcon,
  SMELL: Wind as PhosphorIcon,
  MEASUREMENT: Ruler as PhosphorIcon,
  BENCH: Wrench as PhosphorIcon,
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
