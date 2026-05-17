'use client'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect } from 'react'

const STRUCTURED = [
  { key: '1', href: '/knowledge/new/pinout', label: 'Pinout', sub: 'Pin-by-pin signal table' },
  { key: '2', href: '/knowledge/new/connector', label: 'Connector', sub: 'Connector ID + location + images' },
  { key: '3', href: '/knowledge/new/wiring', label: 'Wiring diagram', sub: 'Image + connections table' },
  { key: '4', href: '/knowledge/new/theory', label: 'Theory of operation', sub: 'Long-form sections' },
] as const

export function AddKnowledgePicker() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const open = search.get('add') === '1'

  const close = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('add')
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname, search])

  const openPaste = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('add')
    next.set('paste', '1')
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [router, pathname, search])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return }
      if (e.key.toLowerCase() === 'p') { openPaste(); return }
      const s = STRUCTURED.find(s => s.key === e.key)
      if (s) router.push(s.href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, openPaste, router])

  if (!open) return null

  return (
    <>
      <div className="vk-scrim" onClick={close} aria-hidden />
      <div className="vk-picker" role="dialog" aria-modal="true" aria-label="Add knowledge">
        <header className="vk-picker__head">
          <h2 className="vk-picker__title">Add knowledge</h2>
          <p className="vk-picker__sub">Pick a flow</p>
        </header>

        <button type="button" className="vk-picker__primary" onClick={openPaste}>
          <span className="vk-picker__glyph">P</span>
          <span className="vk-picker__primary-text">
            <strong>Paste reference text</strong>
            <em>For cause+fix, bulletins, notes — AI sorts it for you.</em>
          </span>
        </button>

        <div className="vk-picker__grid">
          {STRUCTURED.map(s => (
            <Link key={s.key} href={s.href} className="vk-picker__opt" onClick={close}>
              <span className="vk-picker__opt-key">{s.key}</span>
              <div className="vk-picker__opt-text">
                <strong>{s.label}</strong>
                <em>{s.sub}</em>
              </div>
            </Link>
          ))}
        </div>

        <footer className="vk-picker__foot">P · paste · 1 / 2 / 3 / 4 · structured · ESC · close</footer>
      </div>
    </>
  )
}
