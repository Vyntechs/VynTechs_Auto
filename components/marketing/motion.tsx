'use client'

import { useEffect, useRef, useState } from 'react'
import { PhoneFrame } from './phone-frame'
import { SCREENS } from './screens'
import { SCREENSHOTS } from './screenshots.config'

const STEPS = [
  {
    n: '01',
    eyebrow: 'Open',
    h: 'Start with the car and what’s wrong.',
    sub: 'Type what the customer told you. That’s it.',
  },
  {
    n: '02',
    eyebrow: 'Research',
    h: 'It researches the exact car you’re on.',
    sub: 'Reads forums, TSBs, the open web. For the car in your bay. Shows you every source.',
  },
  {
    n: '03',
    eyebrow: 'Propose',
    h: 'It tells you what to check, and why.',
    sub: 'Every step shows the reasoning, how sure it is, and what it read.',
  },
  {
    n: '04',
    eyebrow: 'Confirm',
    h: 'You tell it what you found.',
    sub: 'Type what you saw at the harness, the connector, the smell. The whole plan updates.',
  },
  {
    n: '05',
    eyebrow: 'Lock',
    h: 'Diagnosis locks. Repair coaching opens.',
    sub: 'Two jobs, kept separate. Find the problem first. Fix it second.',
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

  const ActiveScreen = SCREENS[active]
  const activeImage = SCREENSHOTS.motionPhone[active]

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
            <PhoneFrame
              size="lg"
              image={activeImage}
              loading={active < 2 ? 'eager' : undefined}
            >
              <ActiveScreen />
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
