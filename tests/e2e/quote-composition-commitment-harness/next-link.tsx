import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'

export default function Link({
  href,
  children,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event)
        if (event.defaultPrevented || event.button !== 0) return
        event.preventDefault()
        window.history.pushState(null, '', href)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }}
    >
      {children}
    </a>
  )
}
