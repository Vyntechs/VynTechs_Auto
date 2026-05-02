import type { ReactNode } from 'react'

export function Module({
  num,
  label,
  status,
  children,
}: {
  num?: string
  label: string
  status?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="module" aria-label={label}>
      <div className="module-header">
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          {num && <span className="module-num">{num}·</span>}
          <span className="eyebrow">{label}</span>
        </div>
        {status}
      </div>
      <div className="module-body">{children}</div>
    </section>
  )
}
