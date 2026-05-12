import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, ButtonHTMLAttributes } from 'react'

export type Crumb = { label: string; bold?: boolean }

export function Topbar({
  product,
  crumbs = [],
  user = 'MT',
}: {
  product: string
  crumbs?: Crumb[]
  user?: string
}) {
  return (
    <div className="vt-topbar">
      <div className="vt-topbar__brand">
        <span className="vt-topbar__brand-mark" aria-hidden="true">
          ▼
        </span>
        <span className="vt-topbar__brand-name">Vyntechs</span>
        <span className="vt-topbar__brand-sep" aria-hidden="true" />
        <span className="vt-topbar__product">{product}</span>
      </div>
      <div className="vt-topbar__center">
        {crumbs.length > 0 && (
          <nav className="vt-topbar__crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} style={{ display: 'contents' }}>
                {i > 0 && (
                  <span className="vt-topbar__crumbs-sep" aria-hidden="true">
                    /
                  </span>
                )}
                {c.bold ? <b>{c.label}</b> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
      </div>
      <div className="vt-topbar__right">
        <div className="vt-topbar__user">
          <span className="vt-topbar__avatar" aria-hidden="true">
            {user[0]}
          </span>
          <span>{user}</span>
        </div>
      </div>
    </div>
  )
}

export function MainHeader({
  eyebrow,
  eyebrowSlot,
  title,
  sub,
  actions,
}: {
  eyebrow?: string
  eyebrowSlot?: ReactNode
  title: string
  sub?: string
  actions?: ReactNode
}) {
  return (
    <header className="vt-main__header">
      <div className="vt-main__title-block">
        {(eyebrow || eyebrowSlot) && (
          <div className="vt-main__eyebrow-row">
            {eyebrow && <span className="vt-main__eyebrow">{eyebrow}</span>}
            {eyebrowSlot}
          </div>
        )}
        <h1 className="vt-main__title">{title}</h1>
        {sub && <p className="vt-main__sub">{sub}</p>}
      </div>
      {actions && <div className="vt-main__actions">{actions}</div>}
    </header>
  )
}

export type BtnKind = 'primary' | 'secondary' | 'accent' | 'ghost'

export function Btn({
  kind = 'secondary',
  size,
  kbd,
  children,
  className,
  ...rest
}: {
  kind?: BtnKind
  size?: 'sm'
  kbd?: string
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ['vt-btn', `vt-btn--${kind}`, size === 'sm' ? 'vt-btn--sm' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={classes} {...rest}>
      {children}
      {kbd && <span className="vt-btn__kbd">{kbd}</span>}
    </button>
  )
}

export type VtPillKind =
  | 'default'
  | 'active'
  | 'accent'
  | 'deferred'
  | 'declined'
  | 'drift'
  | 'novel'
  | 'gating'
  | 'risk'

export function VtPill({ kind = 'default', children }: { kind?: VtPillKind; children: ReactNode }) {
  const variant = kind === 'default' ? '' : `vt-pill--${kind}`
  return (
    <span className={`vt-pill ${variant}`.trim()}>
      <span className="vt-pill__dot" aria-hidden="true" />
      {children}
    </span>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  hintAccent,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  hintAccent?: boolean
  children: ReactNode
}) {
  return (
    <div className="vt-field">
      <label className="vt-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && (
        <span className={`vt-field__hint${hintAccent ? ' vt-field__hint--accent' : ''}`}>
          {hint}
        </span>
      )}
    </div>
  )
}

export function Input({
  mono,
  className,
  ...rest
}: { mono?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const classes = ['vt-field__input', mono ? 'vt-field__input--mono' : '', className]
    .filter(Boolean)
    .join(' ')
  return <input className={classes} {...rest} />
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`vt-field__textarea ${className ?? ''}`.trim()} {...rest} />
}

export function FormGroup({
  name,
  hint,
  last,
  children,
}: {
  name: string
  hint?: string
  last?: boolean
  children: ReactNode
}) {
  return (
    <div className={`vt-form__group${last ? ' vt-form__group--last' : ''}`}>
      <div className="vt-form__group-label">
        <span className="vt-form__group-name">{name}</span>
        {hint && <span className="vt-form__group-hint">{hint}</span>}
      </div>
      <div className="vt-form__group-fields">{children}</div>
    </div>
  )
}

export function FormRow({ children }: { children: ReactNode }) {
  return <div className="vt-form__row">{children}</div>
}

export function FormFooter({
  meta,
  actions,
}: {
  meta?: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="vt-form__footer">
      <div className="vt-form__footer-meta">{meta}</div>
      <div className="vt-form__footer-actions">{actions}</div>
    </div>
  )
}
