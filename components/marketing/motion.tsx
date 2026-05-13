'use client'

import { useEffect, useRef, useState } from 'react'
import { PhoneFrame } from './phone-frame'
import { SCREENS } from './screens'

const STEPS = [
  {
    n: '01',
    eyebrow: 'Open',
    h: 'Start with the vehicle and what’s wrong.',
    sub: 'No drop-downs. No checklists. Plain words.',
  },
  {
    n: '02',
    eyebrow: 'Research',
    h: 'It studies the exact car you’re working on.',
    sub: 'Pulls service info, TSBs, forum reports — for this VIN. Cites every source.',
  },
  {
    n: '03',
    eyebrow: 'Propose',
    h: 'It asks what to check, and tells you why.',
    sub: 'Each branch shows the reasoning, the calibrated confidence, and the citations behind it.',
  },
  {
    n: '04',
    eyebrow: 'Confirm',
    h: 'You confirm in your own words.',
    sub: 'Type what you saw at the harness, the connector, the smell. It updates everything downstream.',
  },
  {
    n: '05',
    eyebrow: 'Lock',
    h: 'Diagnosis locks. Repair coaching opens.',
    sub: 'Two phases. It doesn’t conflate finding the problem with fixing it.',
  },
] as const

export function Motion() {
  const trackRef = useRef<HTMLElement | null>(null)
  const [active, setActive] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onScroll = () => {
      const r = el.getBoundingClientRect()
      const total = r.height - window.innerHeight
      if (total <= 0) return
      const raw = Math.min(Math.max(-r.top / total, 0), 1)
      setProgress(raw)
      setActive(Math.min(Math.floor(raw * STEPS.length), STEPS.length - 1))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const Screen = SCREENS[active]

  return (
    <section
      ref={trackRef}
      className="mk__section mk__section--bleed mk__motion"
      style={{ ['--mk-progress' as string]: String(progress) }}
    >
      <div className="mk__motion-track">
        <div className="mk__motion-pin">
          <div className="mk__motion-head">
            <div className="mk__motion__eyebrow">Product in motion</div>
            <div className="mk__motion-scrollhint">Scroll</div>
          </div>

          <div className="mk__motion-copy">
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className="mk__motion-step"
                data-active={String(i === active)}
              >
                <div className="mk__motion-step__eyebrow">
                  <b>{s.n}</b>
                  {s.eyebrow}
                </div>
                <h2 className="mk__motion-step__h">{s.h}</h2>
                <p className="mk__motion-step__sub">{s.sub}</p>
              </div>
            ))}
          </div>

          <div className="mk__motion-screen">
            <PhoneFrame size="lg">
              <Screen />
            </PhoneFrame>
          </div>

          <div className="mk__motion-progress">
            <div className="mk__motion-progress__fill" />
          </div>
        </div>
      </div>
    </section>
  )
}
