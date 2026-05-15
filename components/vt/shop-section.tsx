'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Module } from './module'

type Props = { initialName: string }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function ShopSection({ initialName }: Props) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const trimmed = name.trim()
  const dirty = trimmed !== initialName.trim()
  const canSave = dirty && trimmed.length > 0 && trimmed.length <= 80

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSave) return
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch('/api/shop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setSaveError(humanizeSaveError(body.error))
        setSaveState('error')
        return
      }
      setSaveState('saved')
      // Re-runs the server-rendered (app) layout, which re-fetches the shop
      // row and feeds the new name through AppHeaderProvider → context →
      // AppHeaderShopName. No logout / hard reload required.
      router.refresh()
    } catch {
      setSaveError('Could not reach the server. Try again.')
      setSaveState('error')
    }
  }

  return (
    <Module num="01" label="Shop name">
      <form onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor="shop-name">Shop name</label>
          <input
            id="shop-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (saveState !== 'idle') setSaveState('idle')
            }}
            maxLength={80}
            placeholder="What customers see"
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 12,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSave || saveState === 'saving'}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {saveState === 'saved' && (
            <span
              role="status"
              style={{
                fontFamily: 'var(--vt-font-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--vt-fg-3)',
              }}
            >
              Saved
            </span>
          )}
          {saveState === 'error' && saveError && (
            <span
              role="alert"
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 13,
                color: 'var(--vt-risk-high, #b22)',
              }}
            >
              {saveError}
            </span>
          )}
        </div>
      </form>
    </Module>
  )
}

function humanizeSaveError(code: string | undefined): string {
  if (code === 'invalid_name') return 'Shop name must be 1–80 characters.'
  if (code === 'forbidden') return 'Only admins can rename the shop.'
  if (code === 'no_shop') return 'No shop is assigned to your account.'
  if (code === 'paywall') return 'Subscription required to save changes.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not save. Try again.'
}
