'use client'

import { ArrowRight } from '@phosphor-icons/react/dist/ssr'

export function CtaBar({
  leadLeft = 'Step 1 of plan',
  leadRight = 'no commit',
  label = 'Start diagnosis',
  onClick,
  disabled,
}: {
  leadLeft?: string
  leadRight?: string
  label?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <div className="cov-cta">
      <div className="cov-cta__lead">
        <span>{leadLeft}</span>
        <span>{leadRight}</span>
      </div>
      <button className="cov-cta__btn" onClick={onClick} disabled={disabled}>
        <span>{label}</span>
        <ArrowRight size={18} />
      </button>
    </div>
  )
}
