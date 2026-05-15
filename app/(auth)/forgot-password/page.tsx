'use client'
import Link from 'next/link'
import { useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase-client'

type Phase = 'idle' | 'sending' | 'sent' | 'error'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!email.trim()) return
    setPhase('sending')
    setErrorMsg(null)
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    })
    if (error) {
      setErrorMsg(error.message)
      setPhase('error')
      return
    }
    setPhase('sent')
  }

  return (
    <>
      <span className="eyebrow">Vyntechs · Authentication</span>
      <h1
        className="vt-h2"
        style={{ margin: '12px 0 8px', color: 'var(--vt-fg)' }}
      >
        Reset your password
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
        Enter the email on your account. We'll send a link to set a new
        password.
      </p>

      {phase === 'sent' ? (
        <>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 15,
              color: 'var(--vt-fg)',
              lineHeight: 1.5,
              margin: '0 0 16px',
            }}
          >
            If an account exists for <strong>{email.trim()}</strong>, a reset
            link is on its way. Check your inbox (and spam) — the link expires
            in about an hour.
          </p>
          <Link
            href="/sign-in"
            className="btn btn-primary"
            style={{
              width: '100%',
              display: 'block',
              textAlign: 'center',
              textDecoration: 'none',
            }}
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="reset-email">Email</label>
            <input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (phase === 'error') setPhase('idle')
              }}
              disabled={phase === 'sending'}
              placeholder="you@shop.com"
            />
          </div>
          {phase === 'error' && errorMsg && (
            <div className="ai-reject" role="alert">
              {errorMsg}
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={phase === 'sending' || !email.trim()}
            style={{ width: '100%', marginTop: 14 }}
          >
            {phase === 'sending' ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

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
        <Link href="/sign-in" style={{ textDecoration: 'none', color: 'var(--vt-fg-2)' }}>
          ← Back to sign in
        </Link>
      </div>
    </>
  )
}
