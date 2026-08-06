import type { ImgHTMLAttributes } from 'react'

export default function Image({
  priority: _priority,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }): React.JSX.Element {
  return <img {...props} />
}
