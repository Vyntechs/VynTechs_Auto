import { Gauge, Eye, Lightning, Ear, Wind, HandPalm, Waveform, Circle } from '@phosphor-icons/react/dist/ssr'
import type { Icon } from '@phosphor-icons/react'

type MethodEntry = { Icon: Icon; label: string }

// Keyed by the real observation_method enum values (case-insensitive lookup below).
const METHOD_MAP: Record<string, MethodEntry> = {
  scan_tool_pid: { Icon: Gauge, label: 'Scan PID' },
  direct_visual_external: { Icon: Eye, label: 'Visual' },
  direct_visual_internal: { Icon: Eye, label: 'Visual (internal)' },
  electrical_measurement_at_pin: { Icon: Lightning, label: 'Pin measure' },
  pressure_test_with_gauge: { Icon: Gauge, label: 'Pressure' },
  audible: { Icon: Ear, label: 'Audible' },
  smell: { Icon: Wind, label: 'Smell' },
  touch: { Icon: HandPalm, label: 'Touch' },
  waveform_capture: { Icon: Waveform, label: 'Waveform' },
}

export function MethodChip({ method }: { method: string }) {
  const entry = METHOD_MAP[method.toLowerCase()] ?? { Icon: Circle, label: method }
  const { Icon, label } = entry
  return (
    <span className="method-chip">
      <Icon size={12} />
      {label}
    </span>
  )
}
