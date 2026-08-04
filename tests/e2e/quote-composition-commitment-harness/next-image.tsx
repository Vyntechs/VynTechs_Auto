import type { ImgHTMLAttributes } from 'react'

export default function Image({ priority: _priority, fill: _fill, ...props }:
ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean }) {
  return <img {...props} />
}
