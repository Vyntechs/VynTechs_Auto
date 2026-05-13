import Image from 'next/image'
import type { ReactNode } from 'react'
import type { ScreenshotAsset } from './screenshots.config'

type LaptopFrameProps = {
  image?: ScreenshotAsset | null
  children?: ReactNode
  priority?: boolean
}

export function LaptopFrame({ image, children, priority }: LaptopFrameProps) {
  return (
    <div className="mk__laptop" aria-hidden="true">
      <div className="mk__laptop__titlebar">
        <div className="mk__laptop__lights">
          <span className="mk__laptop__light mk__laptop__l1" />
          <span className="mk__laptop__light mk__laptop__l2" />
          <span className="mk__laptop__light mk__laptop__l3" />
        </div>
        <span className="mk__laptop__url">vyntechs.dev</span>
        <span className="mk__laptop__spacer" />
      </div>
      <div className="mk__laptop__screen">
        {image ? (
          <Image
            className="mk__laptop__img"
            src={image.src}
            alt={image.alt}
            fill
            priority={priority ?? false}
            sizes="(max-width: 768px) 95vw, (max-width: 1280px) 720px, 960px"
          />
        ) : (
          children
        )}
      </div>
    </div>
  )
}
