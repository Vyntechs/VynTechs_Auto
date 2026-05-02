import type { ReactNode } from 'react'
import type { PillKind } from './types'

export function Pill({ kind, children }: { kind: PillKind; children: ReactNode }) {
  return (
    <span className={`pill ${kind}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  )
}
