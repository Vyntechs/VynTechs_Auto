'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase-client'

type Phase = 'verifying' | 'ready' | 'invalid'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('verifying')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // The user lands here AFTER /auth/confirm has called verifyOtp() and set
  // session cookies. We just need to confirm the session is present, then
  // render the form. If there's no session, the OTP confirmation didn't
  // happen (direct visit, expired link routed elsewhere, etc.) — show the
  // "invalid" copy.
  useEffect(() => {
    let cancelled = false
    async function check() {
      const supabase = getBrowserSupabase()
      const { data, error } = await supabase.auth.getUser()
      if (cancelled) return
      if (error || !data.user) {
        setPhase('invalid')
        return
      }
      setPhase('ready')
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  async function setNewPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (password.length < 8) {
      setSubmitError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    setSubmitError(null)
    const supabase = getBrowserSupabase()
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setSubmitError(error.message)
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
        Set a new password
      </h1>

      {phase === 'verifying' && (
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
          Verifying your reset link…
        </p>
      )}

      {phase === 'invalid' && (
        <>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 15,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '0 0 16px',
            }}
          >
            This reset link is invalid or has expired. Request a new one from{' '}
            <strong style={{ color: 'var(--vt-fg)', fontStyle: 'normal' }}>
              Settings → My Account
            </strong>
            .
          </p>
          <a
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
          </a>
        </>
      )}

      {phase === 'ready' && (
        <>
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
            Pick something at least 8 characters.
          </p>
          <form onSubmit={setNewPassword} noValidate>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                placeholder="At least 8 characters"
              />
            </div>
            {submitError && (
              <div className="ai-reject" role="alert">
                {submitError}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              style={{ width: '100%', marginTop: 14 }}
            >
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </form>
        </>
      )}
    </>
  )
}
