'use client'

import { useEffect, useRef } from 'react'

type Row = { time: string; kind: string; cls: string; html: string }

const SCRIPT_ROWS: Row[] = [
  { time: '08:14', kind: 'INTAKE', cls: 'k-step', html: '<em>2018 F-250</em> · crank, no start' },
  { time: '08:16', kind: 'ASSIGN', cls: 'k-obs', html: 'Fuel-system check assigned to <em>Bay 03</em>' },
  { time: '08:43', kind: 'NOTE', cls: 'k-rung', html: 'Manual finding: supply pressure drops under crank.' },
  { time: '08:48', kind: 'QUOTE', cls: 'k-step', html: 'Pump test and repair line ready for review.' },
  { time: '08:55', kind: 'OK', cls: 'k-ok', html: 'Customer approved · work status moved to ready.' },
  { time: '', kind: '', cls: '', html: '' },
]

export function HeroTerminal() {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let index = 0
    let timeout: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const renderRow = (row: Row, immediate: boolean) => {
      const element = document.createElement('div')
      element.className = 'vm-term-row'
      if (immediate) {
        element.style.animation = 'none'
        element.style.opacity = '1'
      }
      element.innerHTML = `<div class="vm-term-time">${row.time}</div><div class="vm-term-kind ${row.cls}">${row.kind}</div><div class="vm-term-text">${row.html}</div>`
      body.appendChild(element)
      while (body.children.length > 8) body.firstChild?.remove()
    }

    const addRow = () => {
      if (cancelled) return
      if (index >= SCRIPT_ROWS.length) {
        timeout = setTimeout(() => {
          if (cancelled) return
          body.innerHTML = ''
          index = 0
          addRow()
        }, 3500)
        return
      }
      const row = SCRIPT_ROWS[index++]
      if (!row.time) {
        timeout = setTimeout(addRow, 700)
        return
      }
      renderRow(row, false)
      timeout = setTimeout(addRow, reduce ? 0 : 850)
    }

    while (index < 3) renderRow(SCRIPT_ROWS[index++], true)
    timeout = setTimeout(addRow, 900)
    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  return (
    <div className="vm-term">
      <div className="vm-term-head">
        <span>Living repair order</span>
        <span className="vm-term-live"><span className="vm-dot2" />Live &middot; Bay 03</span>
        <span className="vm-term-vin">RO 000127 &middot; example workflow</span>
      </div>
      <div className="vm-term-body" ref={bodyRef} />
    </div>
  )
}
