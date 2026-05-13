import type { ReactNode } from 'react'

type PhoneFrameProps = {
  children?: ReactNode
  size?: 'sm' | 'lg' | 'xl'
  className?: string
}

export function PhoneFrame({ children, size = 'lg', className = '' }: PhoneFrameProps) {
  const sizeClass =
    size === 'lg' ? 'mk__phone--lg' : size === 'xl' ? 'mk__phone--xl' : ''
  const classes = ['mk__phone', sizeClass, className].filter(Boolean).join(' ')
  return (
    <div className={classes} aria-hidden="true">
      <div className="mk__phone__notch" />
      <div className="mk__phone__screen">{children}</div>
    </div>
  )
}
