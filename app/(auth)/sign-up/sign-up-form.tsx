'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-client'

export function SignUpForm() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showCanceledNotice, setShowCanceledNotice] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setShowCanceledNotice(params.get('canceled') === 'true')
  }, [])

  async function startCheckout() {
    const res = await fetch('/api/stripe/checkout', { method: 'POST' })
    const body: { url?: string; error?: string } = await res
      .json()
      .catch(() => ({}))
    if (!res.ok || !body.url) {
      throw new Error(body.error ?? 'Could not start checkout')
    }
    window.location.href = body.url
  }

  async function handleEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
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

    try {
      await startCheckout()
      // window.location.href is changing; keep the button disabled.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout')
      setBusy(false)
    }
  }

  async function handleGoogleSignUp() {
    setError(null)
    setBusy(true)
    const supabase = getBrowserSupabase()
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/api/stripe/checkout-redirect`,
      },
    })
    if (authError) {
      setError(authError.message)
      setBusy(false)
    }
    // signInWithOAuth navigates the window; nothing else to do here.
  }

  return (
    <>
      <span className="eyebrow">Vyntechs · Onboarding</span>
      <h1
        className="vt-h2"
        style={{ margin: '12px 0 8px', color: 'var(--vt-fg)' }}
      >
        Subscribe
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
        $100/month, single seat. Cancel anytime from your billing page.
      </p>

      {showCanceledNotice && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            background: 'oklch(74% 0.13 60 / 0.10)',
            borderLeft: '2px solid var(--vt-risk-med, oklch(74% 0.13 60))',
            fontFamily: 'var(--vt-font-serif)',
            fontStyle: 'italic',
            fontSize: 14,
            color: 'var(--vt-fg)',
            lineHeight: 1.45,
            borderRadius: 2,
          }}
        >
          You didn&rsquo;t complete checkout. Pick up where you left off.
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleGoogleSignUp}
        disabled={busy}
        style={{ width: '100%' }}
      >
        Continue with Google
      </button>

      <div
        style={{
          margin: '20px 0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'var(--vt-font-mono)',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--vt-fg-3)',
        }}
      >
        <span
          style={{ flex: 1, height: 0, borderTop: '0.5px solid var(--vt-rule)' }}
          aria-hidden
        />
        or
        <span
          style={{ flex: 1, height: 0, borderTop: '0.5px solid var(--vt-rule)' }}
          aria-hidden
        />
      </div>

      <form onSubmit={handleEmailSubmit} noValidate>
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
        <button
          type="submit"
          className="btn"
          disabled={busy}
          style={{ width: '100%', marginTop: 14 }}
        >
          {busy ? 'Opening checkout…' : 'Create account · Continue to checkout'}
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
