'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase-client'
import { readJobTimerPreference } from '@/lib/shop-os/job-timer-preference-client'
import { Module } from './module'

type Props = {
  initialFullName: string
  email: string
  profileId: string
  canTrackJobTime: boolean
  initialJobTimerEnabled: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type ResetState = 'idle' | 'sending' | 'sent' | 'error'
type TimerState = 'idle' | 'saving' | 'saved' | 'restored' | 'error'

export function AccountSection({
  initialFullName,
  email,
  profileId,
  canTrackJobTime,
  initialJobTimerEnabled,
}: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initialFullName)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resetState, setResetState] = useState<ResetState>('idle')
  const [resetError, setResetError] = useState<string | null>(null)
  const [jobTimerEnabled, setJobTimerEnabled] = useState(initialJobTimerEnabled)
  const [savedJobTimerEnabled, setSavedJobTimerEnabled] = useState(
    initialJobTimerEnabled,
  )
  const [timerState, setTimerState] = useState<TimerState>('idle')
  const [timerError, setTimerError] = useState<string | null>(null)

  const trimmed = fullName.trim()
  const dirty = trimmed !== initialFullName.trim()
  const canSave = dirty && trimmed.length > 0 && trimmed.length <= 100
  const timerDirty = jobTimerEnabled !== savedJobTimerEnabled

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
    // Points at the server route handler that calls verifyOtp and sets the
    // session cookie before the user lands on /reset-password. The email
    // template (Supabase dashboard) appends `?token_hash=...&type=recovery
    // &next=/reset-password` to this URL.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm`,
    })
    if (error) {
      setResetError(error.message)
      setResetState('error')
      return
    }
    setResetState('sent')
  }

  async function saveJobTimerPreference() {
    if (!timerDirty || timerState === 'saving') return
    const requested = jobTimerEnabled
    setTimerState('saving')
    setTimerError(null)

    try {
      const response = await fetch('/api/account/job-timer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: requested }),
      })
      const preference = response.ok
        ? await readJobTimerPreference(response, profileId)
        : null
      if (preference) {
        setJobTimerEnabled(preference.enabled)
        setSavedJobTimerEnabled(preference.enabled)
        setTimerState(preference.enabled === requested ? 'saved' : 'restored')
        router.refresh()
        return
      }
      if (response.status !== 409 && response.status < 500 && !response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string
        }
        setTimerError(humanizeTimerError(body.error))
        setTimerState('error')
        return
      }
    } catch {
      // The request may have reached the server. Reconcile below before making
      // any claim about whether the preference was saved.
    }

    await reconcileJobTimerPreference(requested)
  }

  async function reconcileJobTimerPreference(requested: boolean) {
    try {
      const response = await fetch('/api/account/job-timer', {
        method: 'GET',
        cache: 'no-store',
      })
      const preference = response.ok
        ? await readJobTimerPreference(response, profileId)
        : null
      if (!preference) {
        setTimerError('Could not confirm the current setting. Try again.')
        setTimerState('error')
        return
      }
      setJobTimerEnabled(preference.enabled)
      setSavedJobTimerEnabled(preference.enabled)
      setTimerState(preference.enabled === requested ? 'saved' : 'restored')
      router.refresh()
    } catch {
      setTimerError('Could not confirm the current setting. Try again.')
      setTimerState('error')
    }
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

      {canTrackJobTime && (
        <Module num="02" label="Work tools">
          <div className="vt-job-timer-preference">
            <label className="vt-job-timer-preference__choice">
              <input
                type="checkbox"
                aria-label="Track time on my jobs"
                checked={jobTimerEnabled}
                disabled={timerState === 'saving'}
                onChange={(event) => {
                  setJobTimerEnabled(event.target.checked)
                  setTimerState('idle')
                  setTimerError(null)
                }}
              />
              <span>Track time on my jobs</span>
              <span className="vt-job-timer-preference__marker">
                Personal tool
              </span>
            </label>
            <p className="vt-job-timer-preference__help">
              Personal job-time reference. Not payroll or performance tracking.
            </p>
            <div className="vt-job-timer-preference__actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!timerDirty || timerState === 'saving'}
                onClick={saveJobTimerPreference}
              >
                {timerState === 'saving' ? 'Saving…' : 'Save time tracking'}
              </button>
              {timerState === 'saved' && (
                <span role="status" className="vt-team-success">
                  Saved
                </span>
              )}
              {timerState === 'restored' && (
                <span role="status" className="vt-job-timer-preference__restored">
                  The change did not land. Current setting restored.
                </span>
              )}
              {timerState === 'error' && timerError && (
                <span role="alert" className="vt-team-error">
                  {timerError}
                </span>
              )}
            </div>
          </div>
        </Module>
      )}

      <Module num={canTrackJobTime ? '03' : '02'} label="Password">
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

function humanizeTimerError(code: string | undefined): string {
  if (code === 'ineligible') return 'Time tracking is available only for people who wrench.'
  if (code === 'membership_pending') return 'Accept your invite before changing this setting.'
  if (code === 'deactivated') return 'Your account is no longer active.'
  if (code === 'paywall') return 'Subscription required to save changes.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not save the setting. Try again.'
}
