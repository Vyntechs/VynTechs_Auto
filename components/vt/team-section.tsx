'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Module } from './module'

export type TeamMemberRow = {
  userId: string
  profileId: string
  fullName: string | null
  role: 'tech' | 'owner' | 'curator' | string
  deactivated: boolean
}

type Props = {
  members: TeamMemberRow[]
  currentUserId: string
}

type ActionKind = 'promote' | 'demote' | 'deactivate'

type ActionState =
  | { kind: 'idle' }
  | { kind: 'busy'; action: ActionKind; userId: string }
  | { kind: 'error'; message: string }

type InviteState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function TeamSection({ members, currentUserId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [actionState, setActionState] = useState<ActionState>({ kind: 'idle' })
  const [inviteEmail, setInviteEmail] = useState('')
  const [invite, setInvite] = useState<InviteState>({ kind: 'idle' })

  const activeAdminCount = members.filter(
    (m) => m.role === 'owner' && !m.deactivated,
  ).length
  const lastAdminUserId =
    activeAdminCount === 1
      ? members.find((m) => m.role === 'owner' && !m.deactivated)?.userId ?? null
      : null

  async function callTeamApi(
    path: string,
    body: object,
    action: ActionKind,
    userId: string,
  ) {
    setActionState({ kind: 'busy', action, userId })
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setActionState({ kind: 'error', message: humanizeActionError(data.error) })
        return
      }
      setActionState({ kind: 'idle' })
      startTransition(() => router.refresh())
    } catch {
      setActionState({
        kind: 'error',
        message: 'Could not reach the server. Try again.',
      })
    }
  }

  async function sendInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = inviteEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      setInvite({ kind: 'error', message: 'Enter a valid email address.' })
      return
    }
    setInvite({ kind: 'sending' })
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setInvite({
          kind: 'error',
          message: humanizeInviteError(data.error),
        })
        return
      }
      setInvite({ kind: 'sent', email })
      setInviteEmail('')
      startTransition(() => router.refresh())
    } catch {
      setInvite({
        kind: 'error',
        message: 'Could not reach the server. Try again.',
      })
    }
  }

  return (
    <>
      <Module num="01" label="Members">
        <ul className="vt-team-list" role="list">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId
            const isLastAdmin = m.userId === lastAdminUserId
            const isCurator = m.role === 'curator'
            const isAdmin = m.role === 'owner'
            const isTech = m.role === 'tech'
            const busyHere =
              actionState.kind === 'busy' && actionState.userId === m.userId

            return (
              <li
                key={m.userId}
                className={`vt-team-row${m.deactivated ? ' vt-team-row--deactivated' : ''}`}
              >
                <div className="vt-team-row__name">
                  <span className="vt-team-row__name-text">
                    {m.fullName?.trim() || 'Tech (no name set)'}
                  </span>
                  {isSelf && <span className="vt-team-row__you">You</span>}
                </div>
                <div className="vt-team-row__role">{roleLabel(m.role)}</div>
                <div className="vt-team-row__status">
                  {m.deactivated ? 'Deactivated' : 'Active'}
                </div>
                <div className="vt-team-row__actions">
                  {!isCurator && !m.deactivated && isTech && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busyHere}
                      onClick={() =>
                        callTeamApi(
                          '/api/team/role',
                          { userId: m.userId, role: 'owner' },
                          'promote',
                          m.userId,
                        )
                      }
                    >
                      {busyHere && actionState.kind === 'busy' && actionState.action === 'promote'
                        ? 'Promoting…'
                        : 'Promote to Admin'}
                    </button>
                  )}
                  {!isCurator && !m.deactivated && isAdmin && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busyHere || isLastAdmin}
                      title={isLastAdmin ? 'Cannot demote the only Admin.' : undefined}
                      onClick={() =>
                        callTeamApi(
                          '/api/team/role',
                          { userId: m.userId, role: 'tech' },
                          'demote',
                          m.userId,
                        )
                      }
                    >
                      {busyHere && actionState.kind === 'busy' && actionState.action === 'demote'
                        ? 'Demoting…'
                        : 'Demote to Tech'}
                    </button>
                  )}
                  {!isCurator && !isSelf && !m.deactivated && (
                    <button
                      type="button"
                      className="btn btn-ghost vt-team-row__deactivate"
                      disabled={busyHere || (isAdmin && isLastAdmin)}
                      title={
                        isAdmin && isLastAdmin
                          ? 'Cannot deactivate the only Admin.'
                          : undefined
                      }
                      onClick={() =>
                        callTeamApi(
                          '/api/team/deactivate',
                          { userId: m.userId },
                          'deactivate',
                          m.userId,
                        )
                      }
                    >
                      {busyHere && actionState.kind === 'busy' && actionState.action === 'deactivate'
                        ? 'Deactivating…'
                        : 'Deactivate'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {actionState.kind === 'error' && (
          <p role="alert" className="vt-team-error">
            {actionState.message}
          </p>
        )}
      </Module>

      <Module num="02" label="Invite a teammate">
        <form onSubmit={sendInvite} noValidate>
          <div className="field">
            <label htmlFor="invite-email">Email</label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value)
                if (invite.kind !== 'idle' && invite.kind !== 'sending') {
                  setInvite({ kind: 'idle' })
                }
              }}
              autoComplete="email"
              placeholder="tech@yourshop.com"
              disabled={invite.kind === 'sending'}
            />
          </div>
          <p
            style={{
              marginTop: 8,
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--vt-fg-3)',
              lineHeight: 1.5,
            }}
          >
            Sends a one-time invite email. They&rsquo;ll click the link, set a
            password, and land in your shop as a Tech. You can promote them to
            Admin later.
          </p>
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
              disabled={
                invite.kind === 'sending' || !EMAIL_RE.test(inviteEmail.trim().toLowerCase())
              }
            >
              {invite.kind === 'sending' ? 'Sending…' : 'Send invite'}
            </button>
            {invite.kind === 'sent' && (
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
                Invite sent to {invite.email}
              </span>
            )}
            {invite.kind === 'error' && (
              <span role="alert" className="vt-team-error">
                {invite.message}
              </span>
            )}
          </div>
        </form>
      </Module>
    </>
  )
}

function roleLabel(role: string): string {
  if (role === 'owner') return 'Admin'
  if (role === 'tech') return 'Tech'
  if (role === 'curator') return 'Curator'
  return role
}

function humanizeActionError(code: string | undefined): string {
  if (code === 'last_admin')
    return 'Shop needs at least one Admin. Promote someone first.'
  if (code === 'cannot_self') return 'You cannot deactivate your own account.'
  if (code === 'invalid_role') return 'That role is not allowed.'
  if (code === 'not_found') return 'That teammate is no longer in the shop.'
  if (code === 'forbidden') return 'Only Admins can change team roles.'
  if (code === 'paywall') return 'Subscription required to change roles.'
  if (code === 'deactivated') return 'Your account is no longer active.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not save the change. Try again.'
}

function humanizeInviteError(code: string | undefined): string {
  if (code === 'invalid_email') return 'Enter a valid email address.'
  if (code === 'already_in_shop') return 'That person is already in your shop.'
  if (code === 'already_in_other_shop')
    return 'That email is already registered to another shop.'
  if (code === 'already_user')
    return 'That email already has an account. Ask them to sign in.'
  if (code === 'forbidden') return 'Only Admins can send invites.'
  if (code === 'no_shop') return 'No shop is assigned to your account.'
  if (code === 'invite_failed')
    return 'Supabase rejected the invite. Check the email and try again.'
  if (code === 'paywall') return 'Subscription required to invite teammates.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not send the invite. Try again.'
}
