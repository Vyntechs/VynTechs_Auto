'use client'
import Link from 'next/link'
import { useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-client'

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setBusy(true)
    const formData = new FormData(e.currentTarget)
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')

    const supabase = getBrowserSupabase()
    const { error: authError } = await supabase.auth.signUp({ email, password })
    if (authError) {
      setError(authError.message)
      setBusy(false)
      return
    }
    setSuccess(true)
    setBusy(false)
  }

  return (
    <>
      <span className="eyebrow">Vyntechs · Onboarding</span>
      <h1
        className="vt-h2"
        style={{ margin: '12px 0 8px', color: 'var(--vt-fg)' }}
      >
        Create account
      </h1>
      <p
        style={{
          fontFamily: 'var(--vt-font-serif)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--vt-fg-2)',
          lineHeight: 1.5,
          margin: '0 0 24px',
        }}
      >
        Start a session, capture an outcome, contribute to the corpus. Your shop joins after the first sign-in.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={busy}
            placeholder="you@shop.com"
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={busy}
            placeholder="At least 8 characters"
          />
        </div>
        {error && (
          <div className="ai-reject" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div
            role="status"
            style={{
              marginTop: 10,
              padding: '12px 14px',
              background: 'oklch(74% 0.13 170 / 0.10)',
              borderLeft: '2px solid var(--vt-risk-low)',
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg)',
              lineHeight: 1.45,
              borderRadius: 2,
            }}
          >
            Check your email to confirm. The link routes you to <strong>/today</strong>.
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
          style={{ width: '100%', marginTop: 18 }}
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <div
        style={{
          marginTop: 20,
          fontFamily: 'var(--vt-font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vt-fg-3)',
        }}
      >
        <Link
          href="/sign-in"
          style={{ textDecoration: 'none', color: 'var(--vt-fg-2)' }}
        >
          Already a tech · Sign in →
        </Link>
      </div>
    </>
  )
}
