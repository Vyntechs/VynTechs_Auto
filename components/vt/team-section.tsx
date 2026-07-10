'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Module } from './module'
import { SHOP_ROLES, type ShopRole } from '@/lib/shop-os/capabilities'

export type TeamMemberRow = {
  userId: string
  profileId: string
  fullName: string | null
  role: string
  skillTier: number | null
  deactivated: boolean
}

type Props = {
  members: TeamMemberRow[]
  currentUserId: string
}

type ActionKind = 'save' | 'deactivate'

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

const ROLE_LABELS: Record<ShopRole, string> = {
  tech: 'Tech',
  advisor: 'Advisor',
  parts: 'Parts',
  owner: 'Owner',
}

const TIER_OPTIONS = [
  { value: '', label: 'Does not wrench' },
  { value: '3', label: 'A-tech · diagnostics / electrical' },
  { value: '2', label: 'B-tech · general repair' },
  { value: '1', label: 'C-tech · maintenance' },
] as const

export function TeamSection({ members, currentUserId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [actionState, setActionState] = useState<ActionState>({ kind: 'idle' })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ShopRole>('tech')
  const [inviteTier, setInviteTier] = useState<number | null>(null)
  const [invite, setInvite] = useState<InviteState>({ kind: 'idle' })

  const activeOwners = members.filter(
    (member) => member.role === 'owner' && !member.deactivated,
  )
  const lastOwnerUserId = activeOwners.length === 1 ? activeOwners[0].userId : null

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

  async function sendInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
        body: JSON.stringify({
          email,
          role: inviteRole,
          skillTier: inviteTier,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setInvite({ kind: 'error', message: humanizeInviteError(data.error) })
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
          {members.map((member) => {
            const name = member.fullName?.trim() || 'Unnamed teammate'
            const isSelf = member.userId === currentUserId
            const isLastOwner = member.userId === lastOwnerUserId
            const isCurator = member.role === 'curator'
            const busyHere =
              actionState.kind === 'busy' && actionState.userId === member.userId

            return (
              <li
                key={member.userId}
                className={`vt-team-row${member.deactivated ? ' vt-team-row--deactivated' : ''}`}
              >
                <div className="vt-team-row__name">
                  <span className="vt-team-row__name-text">{name}</span>
                  {isSelf && <span className="vt-team-row__you">You</span>}
                  <span className="vt-team-row__status">
                    {member.deactivated ? 'Deactivated' : 'Active'}
                  </span>
                </div>

                {isCurator || member.deactivated ? (
                  <div className="vt-team-row__summary">
                    <span>{roleLabel(member.role)}</span>
                    <span>{tierLabel(member.skillTier)}</span>
                  </div>
                ) : (
                  <MemberEditor
                    member={member}
                    name={name}
                    isLastOwner={isLastOwner}
                    busy={busyHere}
                    onSave={(role, skillTier) =>
                      callTeamApi(
                        '/api/team/role',
                        { userId: member.userId, role, skillTier },
                        'save',
                        member.userId,
                      )
                    }
                  />
                )}

                <div className="vt-team-row__actions">
                  {!isCurator && !isSelf && !member.deactivated && (
                    <button
                      type="button"
                      className="btn btn-ghost vt-team-row__deactivate"
                      disabled={busyHere || isLastOwner}
                      title={
                        isLastOwner ? 'Cannot deactivate the only Owner.' : undefined
                      }
                      onClick={() =>
                        callTeamApi(
                          '/api/team/deactivate',
                          { userId: member.userId },
                          'deactivate',
                          member.userId,
                        )
                      }
                    >
                      {busyHere &&
                      actionState.kind === 'busy' &&
                      actionState.action === 'deactivate'
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
          <div className="vt-team-invite-grid">
            <div className="field">
              <label htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => {
                  setInviteEmail(event.target.value)
                  if (invite.kind !== 'idle' && invite.kind !== 'sending') {
                    setInvite({ kind: 'idle' })
                  }
                }}
                autoComplete="email"
                placeholder="teammate@yourshop.com"
                disabled={invite.kind === 'sending'}
              />
            </div>
            <div className="field">
              <label htmlFor="invite-role">Invite role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as ShopRole)}
                disabled={invite.kind === 'sending'}
              >
                {SHOP_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="invite-tier">Invite skill tier</label>
              <TierSelect
                id="invite-tier"
                value={inviteTier}
                disabled={invite.kind === 'sending'}
                onChange={setInviteTier}
              />
            </div>
          </div>
          <p className="vt-team-help">
            Skill tier controls wrenching eligibility. Choose “Does not wrench” for
            office-only owners, advisors, or parts staff.
          </p>
          <div className="vt-team-invite-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                invite.kind === 'sending' ||
                !EMAIL_RE.test(inviteEmail.trim().toLowerCase())
              }
            >
              {invite.kind === 'sending' ? 'Sending…' : 'Send invite'}
            </button>
            {invite.kind === 'sent' && (
              <span role="status" className="vt-team-success">
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

function MemberEditor({
  member,
  name,
  isLastOwner,
  busy,
  onSave,
}: {
  member: TeamMemberRow
  name: string
  isLastOwner: boolean
  busy: boolean
  onSave: (role: ShopRole, skillTier: number | null) => void
}) {
  const [role, setRole] = useState(member.role as ShopRole)
  const [skillTier, setSkillTier] = useState(member.skillTier)
  const dirty = role !== member.role || skillTier !== member.skillTier
  const removesLastOwner = isLastOwner && role !== 'owner'

  return (
    <div className="vt-team-row__controls">
      <select
        aria-label={`Role for ${name}`}
        value={role}
        disabled={busy}
        onChange={(event) => setRole(event.target.value as ShopRole)}
      >
        {SHOP_ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </select>
      <TierSelect
        ariaLabel={`Skill tier for ${name}`}
        value={skillTier}
        disabled={busy}
        onChange={setSkillTier}
      />
      <button
        type="button"
        className="btn btn-ghost"
        aria-label={`Save ${name}`}
        disabled={busy || !dirty || removesLastOwner}
        title={removesLastOwner ? 'Promote another Owner first.' : undefined}
        onClick={() => onSave(role, skillTier)}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function TierSelect({
  id,
  ariaLabel,
  value,
  disabled,
  onChange,
}: {
  id?: string
  ariaLabel?: string
  value: number | null
  disabled: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value === null ? '' : String(value)}
      disabled={disabled}
      onChange={(event) =>
        onChange(event.target.value === '' ? null : Number(event.target.value))
      }
    >
      {TIER_OPTIONS.map((option) => (
        <option key={option.value || 'none'} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function roleLabel(role: string): string {
  if (role === 'curator') return 'Curator'
  return ROLE_LABELS[role as ShopRole] ?? role
}

function tierLabel(skillTier: number | null): string {
  return TIER_OPTIONS.find((option) => option.value === String(skillTier ?? ''))?.label ?? 'Unknown tier'
}

function humanizeActionError(code: string | undefined): string {
  if (code === 'last_admin') return 'Shop needs at least one Owner. Promote someone first.'
  if (code === 'cannot_self') return 'You cannot deactivate your own account.'
  if (code === 'invalid_role') return 'That role is not allowed.'
  if (code === 'protected_role') return 'Curator access is managed separately.'
  if (code === 'invalid_skill_tier') return 'Choose A-tech, B-tech, C-tech, or Does not wrench.'
  if (code === 'not_found') return 'That teammate is no longer in the shop.'
  if (code === 'forbidden') return 'Only Owners can change team roles.'
  if (code === 'paywall') return 'Subscription required to change roles.'
  if (code === 'deactivated') return 'Your account is no longer active.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not save the change. Try again.'
}

function humanizeInviteError(code: string | undefined): string {
  if (code === 'invalid_email') return 'Enter a valid email address.'
  if (code === 'invalid_role') return 'Choose a valid shop role.'
  if (code === 'invalid_skill_tier') return 'Choose a valid wrenching tier.'
  if (code === 'already_in_shop') return 'That person is already in your shop.'
  if (code === 'already_in_other_shop') return 'That email is already registered to another shop.'
  if (code === 'already_user') return 'That email already has an account. Ask them to sign in.'
  if (code === 'forbidden') return 'Only Owners can send invites.'
  if (code === 'no_shop') return 'No shop is assigned to your account.'
  if (code === 'invite_failed') return 'Supabase rejected the invite. Check the email and try again.'
  if (code === 'paywall') return 'Subscription required to invite teammates.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not send the invite. Try again.'
}
