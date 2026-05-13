'use client'

import { useState } from 'react'

const FAQ_ITEMS = [
  {
    q: 'What does it work on?',
    a: 'Any car you describe in words. Strongest where prior info is widely documented; honest “I don’t know” otherwise.',
  },
  {
    q: 'Can I use it on customer cars from day one?',
    a: 'Yes.',
  },
  {
    q: 'How does it know it’s right?',
    a: 'Every reasoning step cites the source it’s pulling from. Tap a citation, see what it read.',
  },
  {
    q: 'Can I see past diagnoses on the same vehicle?',
    a: 'Yes — vehicle history view ships with launch.',
  },
  {
    q: 'Is my shop data private?',
    a: 'Your sessions train the engine — that’s how it gets smarter. Sessions stay private between you and Vyntechs; we don’t sell or share data.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes, instantly from your billing page.',
  },
] as const

export function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  return (
    <section className="mk__section">
      <div className="mk-container">
        <div className="mk__faq-head">
          <div className="mk__eyebrow">Questions</div>
          <h2 className="mk__h2">Six common ones.</h2>
        </div>
        <div className="mk__faq">
          {FAQ_ITEMS.map((it, i) => {
            const open = openIdx === i
            return (
              <div
                key={i}
                className="mk__faq__item"
                data-open={String(open)}
              >
                <button
                  className="mk__faq__q"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenIdx(open ? null : i)}
                >
                  <span>{it.q}</span>
                  <span className="mk__faq__glyph" aria-hidden="true" />
                </button>
                <div className="mk__faq__a" role="region">
                  {it.a}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
