'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { PasteRouteResponse } from '@/lib/knowledge/classify-paste'

const SOFT_CAP = 8_000
const HARD_CAP = 20_000

export function PasteSheet() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const open = search.get('paste') === '1'

  const [scope, setScope] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('paste')
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname, search])

  const handleSave = useCallback(async () => {
    if (text.length === 0 || text.length > HARD_CAP || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/knowledge/paste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: text, scopeHint: scope || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const proposal = (await res.json()) as PasteRouteResponse
      sessionStorage.setItem(
        'vk-paste-proposal',
        JSON.stringify({ proposal, rawText: text, scopeHint: scope }),
      )
      router.push('/knowledge/review-paste')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'paste failed')
    } finally {
      setBusy(false)
    }
  }, [text, scope, busy, router])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, handleSave])

  if (!open) return null

  const count = text.length
  const counterClass =
    count > HARD_CAP
      ? 'vk-paste-sheet__count--high'
      : count > SOFT_CAP
        ? 'vk-paste-sheet__count--medium'
        : ''

  return (
    <div className="vk-paste-overlay">
      <section
        className="vk-paste-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Paste reference text"
      >
        <header className="vk-paste-sheet__head">
          <div>
            <h2 className="vk-paste-sheet__title">Paste reference text</h2>
            <input
              className="vk-paste-sheet__scope"
              type="text"
              placeholder="Optional scope hint (e.g. 2017–19 F-250 6.7L)"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              maxLength={500}
            />
          </div>
          <button type="button" className="vk-btn vk-btn--ghost" onClick={close}>
            ×
          </button>
        </header>

        <textarea
          className="vk-paste-sheet__area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste shop notes, OEM text, AllData snippet, your own writeup… (≤ 20k chars)"
          autoFocus
        />

        <div className={`vk-paste-sheet__status ${counterClass}`}>
          <span>
            {count.toLocaleString()} / {HARD_CAP.toLocaleString()} chars
          </span>
          {count > HARD_CAP && <span> · hard cap exceeded</span>}
          {count > SOFT_CAP && count <= HARD_CAP && <span> · soft cap</span>}
          {busy && <span> · sorting…</span>}
          {error && <span> · {error}</span>}
        </div>

        <footer className="vk-paste-sheet__foot">
          <button type="button" className="vk-btn vk-btn--ghost" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="vk-btn vk-btn--primary"
            disabled={count === 0 || count > HARD_CAP || busy}
            onClick={handleSave}
          >
            {busy ? 'Sorting…' : 'Sort and review'}
          </button>
        </footer>
      </section>
    </div>
  )
}
