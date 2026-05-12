import type { ReactNode } from 'react'

export function Glyph() {
  return <span className="pis__glyph" />
}

export function Mark({ children }: { children: ReactNode }) {
  return <em className="pis__mark">{children}</em>
}

export function ScanBtn({ label = 'Scan VIN/plate' }: { label?: string }) {
  return (
    <button type="button" className="pis__scan-btn" aria-disabled="true" title="Scan coming">
      <span className="pis__scan-btn__ring" />
      {label}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="pis__kbd">{children}</span>
}

export function Caret() {
  return <span className="pis__caret" />
}

export type RowProps = {
  kind: string
  primary: ReactNode
  secondary?: ReactNode
  meta?: ReactNode
  focused?: boolean
  onClick?: () => void
  id?: string
}

export function Row({ kind, primary, secondary, meta, focused, onClick, id }: RowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={focused ? 'true' : 'false'}
      id={id}
      className={`pis__row ${focused ? 'pis__row--focused' : ''}`}
      onClick={onClick}
    >
      <span className="pis__row-kind">{kind}</span>
      <div>
        <div className="pis__row-primary">{primary}</div>
        {secondary && <div className="pis__row-secondary">{secondary}</div>}
      </div>
      {meta && <span className="pis__row-meta">{meta}</span>}
    </button>
  )
}

export function CreateRow({
  label = 'Create new customer',
  hint,
  kbd = '↩',
  focused,
  onClick,
  id,
}: {
  label?: string
  hint?: string
  kbd?: string
  focused?: boolean
  onClick?: () => void
  id?: string
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={focused ? 'true' : 'false'}
      id={id}
      className={`pis__create ${focused ? 'pis__row--focused' : ''}`}
      onClick={onClick}
    >
      <span className="pis__create__plus">+</span>
      <span>
        {label}
        {hint && <span className="pis__create__hint">{hint}</span>}
      </span>
      {kbd && <span className="pis__row-meta">{kbd}</span>}
    </button>
  )
}

export function GroupHead({ label, count }: { label: string; count?: string | number }) {
  return (
    <div className="pis__group-head">
      <span>{label}</span>
      {count !== undefined && <span>{count}</span>}
    </div>
  )
}
