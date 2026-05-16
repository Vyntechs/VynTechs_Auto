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
  const hasImageClass = image ? 'mk__phone--has-image' : ''
  const classes = ['mk__phone', sizeClass, hasImageClass, className].filter(Boolean).join(' ')
  const screenClasses = ['mk__phone__screen', image ? 'mk__phone__screen--has-image' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} aria-hidden="true">
      {!image && <div className="mk__phone__notch" />}
      <div className={screenClasses}>
        {image ? (
          // Safe-area wrapper sits inside the rounded screen and insets the
          // image away from the screen corners — same role as
          // `safe-area-inset-*` on iOS. Lets the screen keep generous
          // iPhone-y rounding without the rounded corners eating content
          // at the edges of the captured screenshot.
          <div className="mk__phone__safe-area">
            <Image
              className="mk__phone__img"
              src={image.src}
              alt={image.alt}
              fill
              priority={priority ?? false}
              loading={loading}
              sizes="(max-width: 768px) 280px, 360px"
            />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
