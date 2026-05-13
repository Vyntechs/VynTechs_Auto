'use client'

import { useState } from 'react'

const FAQ_ITEMS = [
  {
    q: 'What does it work on?',
    a: 'Any car you can describe in words. Best on cars with a lot of forum and TSB history. When the open web doesn’t have good info, it tells you.',
  },
  {
    q: 'Can I use it on customer cars from day one?',
    a: 'Yes.',
  },
  {
    q: 'How does it know it’s right?',
    a: 'It doesn’t claim to be right. It shows you what it read. Tap any source. Check the work yourself.',
  },
  {
    q: 'Can I see past diagnoses on the same car?',
    a: 'Yes. Every car has its own history page. Past sessions, locked diagnoses, the lot.',
  },
  {
    q: 'Is my shop data private?',
    a: 'Your sessions train the engine. That’s how it gets sharper. We don’t sell or share your data.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel button is on your billing page.',
  },
] as const

export function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  return (
    <section className="mk__section">
      <div className="mk-container">
        <div className="mk__faq-head">
          <div className="mk__eyebrow">Questions</div>
          <h2 className="mk__h2">The common ones.</h2>
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
