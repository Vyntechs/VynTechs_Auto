'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase-client'

export default function SignInPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const formData = new FormData(e.currentTarget)
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')

    const supabase = getBrowserSupabase()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError(authError.message)
      setBusy(false)
      return
    }
    router.push('/today')
  }

  return (
    <>
      <span className="eyebrow">Vyntechs · Authentication</span>
      <h1
        className="vt-h2"
        style={{ margin: '12px 0 8px', color: 'var(--vt-fg)' }}
      >
        Sign in
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
        Pick up where you left off — your bay, your queue, your sessions.
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
            autoComplete="current-password"
            required
            disabled={busy}
            placeholder="—"
          />
        </div>
        {error && (
          <div className="ai-reject" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
          style={{ width: '100%', marginTop: 18 }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div
        style={{
          marginTop: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          fontFamily: 'var(--vt-font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--vt-fg-3)',
        }}
      >
        <Link href="/sign-up" style={{ textDecoration: 'none', color: 'var(--vt-fg-2)' }}>
          New tech · Create account →
        </Link>
        <span>Forgot password</span>
      </div>
    </>
  )
}
