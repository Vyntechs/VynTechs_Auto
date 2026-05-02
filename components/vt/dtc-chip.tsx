import type { HTMLAttributes, ReactNode } from 'react'

export function DtcChip({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
  return (
    <span className={`dtc-chip ${className ?? ''}`} {...rest}>
      {children}
    </span>
  )
}
