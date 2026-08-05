import type { AnchorHTMLAttributes, ReactNode } from 'react'

export default function Link({
  href,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string
  children: ReactNode
}): React.JSX.Element {
  return <a href={href} {...props}>{children}</a>
}
