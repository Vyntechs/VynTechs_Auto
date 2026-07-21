'use client'

import { useRef, useState } from 'react'
import type { TeamMember } from '@/lib/intake/team'
import type { LivingTicketCommand } from '@/lib/shop-os/living-ticket'
import { parseAssignmentEnvelope, type AssignmentEnvelope } from '@/lib/shop-os/today-board'
import { parseInterruptionJob } from './ticket-interruption-action'
import styles from './ticket-detail.module.css'

type AssignmentCommand = LivingTicketCommand & {
  kind: 'assign' | 'claim' | 'handoff'
}

type AppliedAssignment = AssignmentEnvelope & {
  assignedTechId: string | null
}

type Props = {
  ticketId: string
  job: {
    id: string
    requiredSkillTier: number
    hasAssignee: boolean
    workStatus: 'open' | 'in_progress' | 'blocked'
  }
  command: AssignmentCommand
  team: TeamMember[]
  currentProfileId: string
  onApplied: (assignment: AppliedAssignment) => void
  onConflict: (input: { assignedTechName: string }) => void
}

type Candidate = TeamMember & { confirmBelowTier: boolean }

function safeConflictName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  if (record.error !== 'assignment_conflict'
    || typeof record.currentAssignee !== 'object'
    || record.currentAssignee === null
    || Array.isArray(record.currentAssignee)) return null
  const name = (record.currentAssignee as Record<string, unknown>).fullName
  if (typeof name !== 'string') return null
  const normalized = name.trim()
  return normalized.length >= 1 && normalized.length <= 120 ? normalized : null
}

export function TicketAssignmentControl({
  ticketId,
  job,
  command,
  team,
  currentProfileId,
  onApplied,
  onConflict,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [notice, setNotice] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)
  const invokerRef = useRef<HTMLButtonElement>(null)
  const assignmentAttempts = useRef(new Map<string, string>())
  const isActiveHandoff = command.kind === 'handoff' && job.workStatus !== 'open'

  function retainAssignmentAttempt(body: Record<string, unknown>) {
    const signature = JSON.stringify(body)
    const requestKey = assignmentAttempts.current.get(signature) ?? crypto.randomUUID()
    assignmentAttempts.current.set(signature, requestKey)
    return { signature, body: { ...body, requestKey } }
  }

  async function mutate(
    body: Record<string, unknown>,
    assignedTechId: string | null,
  ): Promise<void> {
    if (pending) return
    const attempt = retainAssignmentAttempt(body)
    let restoreInvoker = true
    setPending(true)
    setNotice({ kind: 'status', text: 'Saving handoff…' })
    try {
      const response = await fetch(
        `/api/tickets/${ticketId}/jobs/${job.id}/${isActiveHandoff ? 'interruption' : 'assignment'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(attempt.body),
        },
      )
      const responseBody = await response.json().catch(() => null)
      if (!response.ok) {
        const winner = response.status === 409 ? safeConflictName(responseBody) : null
        if (winner) {
          restoreInvoker = false
          onConflict({ assignedTechName: winner })
          setOpen(false)
          setCandidate(null)
          setNotice(null)
          return
        }
        throw new Error('assignment_failed')
      }

      const interrupted = isActiveHandoff ? parseInterruptionJob(
        responseBody && typeof responseBody === 'object'
          ? (responseBody as { job?: unknown }).job
          : null,
      ) : null
      const activeWorkStatus = interrupted && ['open', 'in_progress', 'blocked'].includes(interrupted.workStatus)
        ? interrupted.workStatus as 'open' | 'in_progress' | 'blocked'
        : null
      if (isActiveHandoff && (!interrupted || !activeWorkStatus || interrupted.assignedTechId !== assignedTechId)) {
        throw new Error('invalid_active_handoff_response')
      }
      const assignment = isActiveHandoff && interrupted
        ? (() => {
            const state = interrupted.assignedTechId === currentProfileId
              ? 'mine' as const
              : interrupted.assignedTechId === null
                ? 'unassigned' as const
                : 'team' as const
            const assignedTechName = interrupted.assignedTechId === currentProfileId
              ? team.find((member) => member.id === currentProfileId)?.name ?? null
              : team.find((member) => member.id === interrupted.assignedTechId)?.name ?? null
            return {
              ticketId,
              jobId: job.id,
              workStatus: activeWorkStatus as 'open' | 'in_progress' | 'blocked',
              state,
              assignedTechName,
            }
          })()
        : parseAssignmentEnvelope(responseBody, {
            ticketId,
            jobId: job.id,
          })
      if (!assignment) throw new Error('invalid_assignment_response')

      const safeAssignedTechId = assignment.state === 'unassigned'
        ? null
        : assignment.state === 'mine'
          ? currentProfileId
          : assignedTechId
      if (assignment.state === 'team' && !safeAssignedTechId) {
        throw new Error('missing_assignment_identity')
      }
      onApplied({ ...assignment, assignedTechId: safeAssignedTechId })
      assignmentAttempts.current.delete(attempt.signature)
      restoreInvoker = false
      setOpen(false)
      setCandidate(null)
      setNotice(null)
    } catch {
      setNotice({ kind: 'error', text: 'Handoff was not saved. Check the connection and retry.' })
    } finally {
      setPending(false)
      if (restoreInvoker) setTimeout(() => invokerRef.current?.focus(), 0)
    }
  }

  function select(member: TeamMember): void {
    if (member.skillTier < job.requiredSkillTier) {
      if (isActiveHandoff) {
        setNotice({ kind: 'error', text: 'Active work can only be handed to a technician at the required tier.' })
        return
      }
      setCandidate({ ...member, confirmBelowTier: true })
      return
    }
    void mutate(
      isActiveHandoff
        ? { action: 'handoff', assignedTechId: member.id }
        : { action: 'reassign', assignedTechId: member.id },
      member.id,
    )
  }

  if (command.kind === 'claim') {
    return (
      <div className={styles.assignmentControl}>
        <button
          ref={invokerRef}
          type="button"
          className={styles.inlineAction}
          disabled={pending}
          onClick={() => void mutate({ action: 'claim' }, currentProfileId)}
        >
          {pending ? 'Claiming…' : command.label}
        </button>
        {notice && <p className={notice.kind === 'error' ? styles.assignmentError : styles.assignmentNotice}
          role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.text}</p>}
      </div>
    )
  }

  return (
    <div className={styles.assignmentControl}>
      <button
        ref={invokerRef}
        type="button"
        className={styles.inlineAction}
        aria-expanded={open}
        disabled={pending}
        onClick={() => {
          setOpen((current) => !current)
          setCandidate(null)
          setNotice(null)
        }}
      >
        {command.label}
      </button>

      {open && (
        <div className={styles.assignmentPicker} aria-label="Choose technician">
          {team.length === 0 ? (
            <p>No active wrenching profiles are available.</p>
          ) : (
            <div className={styles.assignmentChoices}>
              {team.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  disabled={pending}
                  onClick={() => select(member)}
                >
                  <span>{member.name}</span>
                  <small>{tierLabel(member.skillTier)}</small>
                </button>
              ))}
              {job.hasAssignee && !isActiveHandoff && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void mutate({ action: 'unclaim' }, null)}
                >
                  <span>Leave open</span>
                  <small>No technician</small>
                </button>
              )}
            </div>
          )}

          {candidate && (
            <div className={styles.tierConfirmation} role="group" aria-label="Below-tier confirmation">
              <p>
                {`${candidate.name} is ${tierLabel(candidate.skillTier)}. This work requires ${tierRequirement(job.requiredSkillTier)}.`}
              </p>
              <div>
                <button type="button" disabled={pending} onClick={() => setCandidate(null)}>Choose another</button>
                <button type="button" disabled={pending} onClick={() => void mutate({
                  action: 'reassign',
                  assignedTechId: candidate.id,
                  confirmBelowTier: true,
                }, candidate.id)}>Assign anyway</button>
              </div>
            </div>
          )}
        </div>
      )}

      {notice && <p className={notice.kind === 'error' ? styles.assignmentError : styles.assignmentNotice}
        role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.text}</p>}
    </div>
  )
}

function tierLabel(tier: number): string {
  if (tier === 3) return 'A-tech'
  if (tier === 2) return 'B-tech'
  return 'C-tech'
}

function tierRequirement(tier: number): string {
  const label = tierLabel(tier)
  return `${tier === 3 ? 'an' : 'a'} ${label}`
}
