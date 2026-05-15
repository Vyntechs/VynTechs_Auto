'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase-client'
import { Module } from './module'

type Props = {
  initialFullName: string
  email: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type ResetState = 'idle' | 'sending' | 'sent' | 'error'

export function AccountSection({ initialFullName, email }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initialFullName)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resetState, setResetState] = useState<ResetState>('idle')
  const [resetError, setResetError] = useState<string | null>(null)

  const trimmed = fullName.trim()
  const dirty = trimmed !== initialFullName.trim()
  const canSave = dirty && trimmed.length > 0 && trimmed.length <= 100

  async function saveName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSave) return
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch('/api/account/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setSaveError(humanizeSaveError(body.error))
        setSaveState('error')
        return
      }
      setSaveState('saved')
      router.refresh()
    } catch {
      setSaveError('Could not reach the server. Try again.')
      setSaveState('error')
    }
  }

  async function sendResetEmail() {
    setResetState('sending')
    setResetError(null)
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) {
      setResetError(error.message)
      setResetState('error')
      return
    }
    setResetState('sent')
  }

  return (
    <>
      <Module num="01" label="Profile">
        <form onSubmit={saveName} noValidate>
          <div className="field">
            <label htmlFor="account-fullname">Display name</label>
            <input
              id="account-fullname"
              type="text"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value)
                if (saveState !== 'idle') setSaveState('idle')
              }}
              maxLength={100}
              autoComplete="name"
              placeholder="What you'd like coworkers to see"
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

      <Module num="02" label="Password">
        <p
          style={{
            fontFamily: 'var(--vt-font-serif)',
            fontStyle: 'italic',
            fontSize: 14,
            color: 'var(--vt-fg-2)',
            margin: '0 0 14px',
            lineHeight: 1.5,
          }}
        >
          We&rsquo;ll email a one-time link to{' '}
          <strong style={{ color: 'var(--vt-fg)', fontStyle: 'normal' }}>
            {email}
          </strong>
          . Tap it to set a new password.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={sendResetEmail}
          disabled={resetState === 'sending' || resetState === 'sent'}
        >
          {resetState === 'sending'
            ? 'Sending…'
            : resetState === 'sent'
              ? 'Email sent — check your inbox'
              : 'Reset password'}
        </button>
        {resetState === 'error' && resetError && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--vt-risk-high, #b22)',
            }}
          >
            {resetError}
          </p>
        )}
      </Module>
    </>
  )
}

function humanizeSaveError(code: string | undefined): string {
  if (code === 'invalid_name') return 'Name must be 1–100 characters.'
  if (code === 'paywall') return 'Subscription required to save changes.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not save. Try again.'
}
