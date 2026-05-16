'use client'

import { useEffect, useRef } from 'react'

// Illustrative session — a single F-150 commit path. The data is the
// shape a real session takes; numbers + part IDs are example.
type Row = { time: string; kind: string; cls: string; html: string }

const SCRIPT_ROWS: Row[] = [
  {
    time: '08:14:02',
    kind: 'STEP',
    cls: 'k-step',
    html: '<em>Step 03 ·</em> Inspect cold-side intercooler boot at the throttle-body joint.',
  },
  {
    time: '08:14:05',
    kind: 'OBS',
    cls: 'k-obs',
    html: 'Tech: photo captured. <em>3 frames, lower-clamp seam.</em>',
  },
  {
    time: '08:14:07',
    kind: 'RUNG',
    cls: 'k-rung',
    html: 'Rung 0 — shop corpus · <b>14 matches</b> · build-date specific',
  },
  {
    time: '08:14:09',
    kind: 'RUNG',
    cls: 'k-rung',
    html: 'Rung 1 — open web · <b>OEM TSB 22-2148: cold-side boot weep, MY18–19</b>',
  },
  {
    time: '08:14:11',
    kind: 'STEP',
    cls: 'k-step',
    html: '<em>Step 04 ·</em> Smoke test cold-side @ 5 psi. Photograph escape locations.',
  },
  {
    time: '08:14:48',
    kind: 'OBS',
    cls: 'k-obs',
    html: 'Smoke leak observed · lower clamp seam · <span class="vm-num">3.6 psi</span>',
  },
  {
    time: '08:14:51',
    kind: 'RUNG',
    cls: 'k-rung',
    html: 'Confidence updated <span class="vm-term-dial"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="oklch(28% 0.012 260)" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="9" stroke="oklch(62% 0.15 245)" stroke-width="2" fill="none" stroke-dasharray="56.5" stroke-dashoffset="7.3" transform="rotate(-90 12 12)" stroke-linecap="round"/></svg><span class="vm-dial-num">87.0%</span></span>',
  },
  {
    time: '08:14:53',
    kind: 'OK',
    cls: 'k-ok',
    html: 'Above gate · committable. <b>Replace lower clamp · part FL3Z-6K786-A</b>',
  },
  { time: '', kind: '', cls: '', html: '' },
]

export function HeroTerminal() {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let i = 0
    let timeout: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const renderRow = (row: Row, immediate: boolean) => {
      const el = document.createElement('div')
      el.className = 'vm-term-row'
      if (immediate) {
        el.style.animation = 'none'
        el.style.opacity = '1'
      }
      el.innerHTML =
        '<div class="vm-term-time">' +
        row.time +
        '</div><div class="vm-term-kind ' +
        row.cls +
        '">' +
        row.kind +
        '</div><div class="vm-term-text">' +
        row.html +
        '</div>'
      body.appendChild(el)
      while (body.children.length > 10) {
        const first = body.firstChild
        if (first) body.removeChild(first)
      }
    }

    const addRow = () => {
      if (cancelled) return
      if (i >= SCRIPT_ROWS.length) {
        timeout = setTimeout(() => {
          if (cancelled) return
          body.innerHTML = ''
          i = 0
          addRow()
        }, 4000)
        return
      }
      const row = SCRIPT_ROWS[i++]
      if (!row.time) {
        timeout = setTimeout(addRow, 800)
        return
      }
      renderRow(row, false)
      if (reduce) {
        addRow()
        return
      }
      const delay =
        row.kind === 'STEP'
          ? 900
          : row.kind === 'GATE'
            ? 1100
            : row.kind === 'OK'
              ? 1400
              : 600 + Math.random() * 400
      timeout = setTimeout(addRow, delay)
    }

    // Seed first 4 rows so the panel isn't empty on first paint
    while (i < 4 && i < SCRIPT_ROWS.length) {
      renderRow(SCRIPT_ROWS[i++], true)
    }
    timeout = setTimeout(addRow, 900)

    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  return (
    <div className="vm-term">
      <div className="vm-term-head">
        <span>Session log</span>
        <span className="vm-term-live">
          <span className="vm-dot2" />
          Live &middot; Bay 03
        </span>
        <span className="vm-term-vin">
          P0299 &middot; 2018 F-150 — example session
        </span>
      </div>
      <div className="vm-term-body" ref={bodyRef} />
    </div>
  )
}
