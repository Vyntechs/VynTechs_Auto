import type { ReactNode } from 'react'

export function AppHeader({
  title,
  meta,
  right,
}: {
  title: string
  meta?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className="app-header">
      <div>
        <div className="title">{title}</div>
        {meta && <div className="meta" style={{ marginTop: 2 }}>{meta}</div>}
      </div>
      {right}
    </header>
  )
}
