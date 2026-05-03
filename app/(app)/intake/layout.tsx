import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'

export default function IntakeLayout({ children }: { children: ReactNode }) {
  if (!isDesktopIntakeEnabled()) notFound()
  return <>{children}</>
}
