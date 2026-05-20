import type { ReactNode } from 'react'

export function ScenarioChip({ children }: { children: ReactNode }) {
  return <span className="scenario-chip">{children}</span>
}
