'use client'

import { usePathname } from 'next/navigation'

/** Routes under /curator that are deliberately mobile-friendly and must
 *  bypass the desktop-only gate. The founder-notes flow is jot-and-go
 *  from a phone via SuperWhisper — blocking it on mobile defeats the
 *  feature's purpose. */
const MOBILE_ALLOWED_PREFIXES = ['/curator/founder-notes']

export function DesktopOnlyFallback() {
  const pathname = usePathname()
  const allowMobile = MOBILE_ALLOWED_PREFIXES.some((p) => pathname?.startsWith(p))
  if (allowMobile) return null

  return (
    <div className="vt-curator-desktop-only">
      <div>
        <h2>Curator tools need a wider window</h2>
        <p>
          Resize this window to at least 960 pixels wide, or open it on a
          larger screen. The data tables here don&apos;t fit on phones.
        </p>
      </div>
    </div>
  )
}
