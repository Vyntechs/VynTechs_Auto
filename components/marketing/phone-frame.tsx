import Image from 'next/image'
import type { ReactNode } from 'react'
import type { ScreenshotAsset } from './screenshots.config'

type PhoneFrameProps = {
  image?: ScreenshotAsset | null
  children?: ReactNode
  size?: 'sm' | 'lg' | 'xl'
  className?: string
  priority?: boolean
  loading?: 'eager' | 'lazy'
}

export function PhoneFrame({
  image,
  children,
  size = 'lg',
  className = '',
  priority,
  loading,
}: PhoneFrameProps) {
  const sizeClass =
    size === 'lg' ? 'mk__phone--lg' : size === 'xl' ? 'mk__phone--xl' : ''
  const classes = ['mk__phone', sizeClass, className].filter(Boolean).join(' ')
  return (
    <div className={classes} aria-hidden="true">
      <div className="mk__phone__notch" />
      <div className="mk__phone__screen">
        {image ? (
          <Image
            className="mk__phone__img"
            src={image.src}
            alt={image.alt}
            fill
            priority={priority ?? false}
            loading={loading}
            sizes="(max-width: 768px) 280px, 360px"
          />
        ) : (
          children
        )}
      </div>
    </div>
  )
}
