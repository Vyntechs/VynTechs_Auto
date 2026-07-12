'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/vt'
import {
  classifySimpleWorkFile,
  parseAttachmentResponse,
  parseEscalationResponse,
  parseSimpleWorkMutationResponse,
  parseSimpleWorkWorkspaceResponse,
  retainEscalationAttempt,
  retainFileAttempt,
  type EscalationAttempt,
  type FileUploadAttempt,
  type SimpleWorkProjectionView,
  type SimpleWorkWorkspaceView,
} from '@/lib/shop-os/simple-work-ui'
import styles from './simple-work-workspace.module.css'

type Props = {
  ticket: { id: string; number: number; customerName: string; vehicle: string }
  initialWorkspace: SimpleWorkWorkspaceView
}

type Notice = { kind: 'status' | 'error'; text: string }
type Pending = 'start' | 'note' | 'proof' | 'complete' | 'escalation' | null

export function SimpleWorkWorkspace({ ticket, initialWorkspace }: Props) {
  const router = useRouter()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [note, setNote] = useState(initialWorkspace.workNotes ?? '')
  const [pending, setPending] = useState<Pending>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [selectedProof, setSelectedProof] = useState<FileUploadAttempt | null>(null)
  const fileAttempt = useRef<FileUploadAttempt | null>(null)
  const [concern, setConcern] = useState('')
  const [tier, setTier] = useState('')
  const [createdConcern, setCreatedConcern] = useState(false)
  const escalationAttempt = useRef<EscalationAttempt | null>(null)
  const basePath = `/api/tickets/${ticket.id}/jobs/${workspace.id}`

  function applyWork(work: SimpleWorkProjectionView) {
    setWorkspace((current) => ({
      ...current,
      workStatus: work.status,
      workNotes: work.workNotes,
      updatedAt: work.updatedAt,
    }))
    setNote(work.workNotes ?? '')
  }

  function stalePage() {
    router.replace(`/tickets/${ticket.id}`)
  }

  async function refreshWorkspace(): Promise<SimpleWorkWorkspaceView | null> {
    const response = await fetch(`${basePath}/work`, { method: 'GET', cache: 'no-store' })
    if (response.status === 404) {
      stalePage()
      return null
    }
    const body = await response.json().catch(() => null)
    const next = response.ok ? parseSimpleWorkWorkspaceResponse(body) : null
    if (!next) return null
    setWorkspace(next)
    setNote(next.workNotes ?? '')
    return next
  }

  async function mutateWork(
    action: Record<string, unknown>,
    mode: Exclude<Pending, 'proof' | 'escalation' | null>,
    success: string,
  ) {
    if (pending) return
    setPending(mode)
    setNotice({ kind: 'status', text: mode === 'start' ? 'Starting work…' : mode === 'note' ? 'Saving note…' : 'Completing work…' })
    try {
      const response = await fetch(`${basePath}/work`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      })
      if (response.status === 404) {
        stalePage()
        return
      }
      const body = await response.json().catch(() => null)
      const result = response.ok ? parseSimpleWorkMutationResponse(body) : null
      if (!result) {
        if (response.status === 409) {
          await refreshWorkspace().catch(() => null)
          setNotice({ kind: 'error', text: 'Work changed elsewhere. Review the current state and try again.' })
          return
        }
        throw new Error('invalid_response')
      }
      applyWork(result.work)
      setNotice({ kind: 'status', text: success })
    } catch {
      setNotice({ kind: 'error', text: 'Not saved — check your connection and retry.' })
    } finally {
      setPending(null)
    }
  }

  async function chooseProof(file: File) {
    const kind = classifySimpleWorkFile(file)
    if (!kind) {
      setNotice({ kind: 'error', text: 'Choose a supported, non-empty file no larger than 4 MiB.' })
      return
    }
    const attempt = retainFileAttempt(fileAttempt.current, file, kind)
    fileAttempt.current = attempt
    setSelectedProof(attempt)
    await uploadProof(attempt)
  }

  async function uploadProof(attempt: FileUploadAttempt) {
    if (pending) return
    setPending('proof')
    setNotice({ kind: 'status', text: 'Uploading proof…' })
    try {
      const form = new FormData()
      form.set('requestKey', attempt.requestKey)
      form.set('kind', attempt.kind)
      form.set('file', attempt.file)
      const response = await fetch(`${basePath}/attachments`, { method: 'POST', body: form })
      if (response.status === 404) {
        stalePage()
        return
      }
      const body = await response.json().catch(() => null)
      const result = response.ok ? parseAttachmentResponse(body) : null
      if (!result) throw new Error('upload_failed')
      fileAttempt.current = null
      setSelectedProof(null)
      setWorkspace((current) => ({
        ...current,
        attachments: current.attachments.some((item) => item.id === result.attachment.id)
          ? current.attachments
          : [...current.attachments, result.attachment],
      }))
      const refreshed = await refreshWorkspace().catch(() => null)
      setNotice({
        kind: 'status',
        text: refreshed ? 'Proof uploaded.' : 'Proof uploaded; refresh the page to confirm completion readiness.',
      })
    } catch {
      setNotice({ kind: 'error', text: 'Not saved — check your connection and retry proof upload.' })
    } finally {
      setPending(null)
    }
  }

  async function createConcern(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const normalizedConcern = concern.trim()
    const requiredSkillTier = Number(tier)
    if (normalizedConcern.length < 5 || normalizedConcern.length > 500 || ![1, 2, 3].includes(requiredSkillTier)) {
      setNotice({ kind: 'error', text: 'Enter the concern and choose the required skill tier.' })
      return
    }
    const attempt = retainEscalationAttempt(
      escalationAttempt.current,
      normalizedConcern,
      requiredSkillTier,
    )
    escalationAttempt.current = attempt
    setPending('escalation')
    setNotice({ kind: 'status', text: 'Adding diagnostic job…' })
    try {
      const response = await fetch(`${basePath}/escalations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestKey: attempt.requestKey, concern: normalizedConcern, requiredSkillTier }),
      })
      if (response.status === 404) {
        stalePage()
        return
      }
      const body = await response.json().catch(() => null)
      const result = response.ok ? parseEscalationResponse(body) : null
      if (!result) throw new Error('escalation_failed')
      escalationAttempt.current = null
      setCreatedConcern(true)
      setNotice({ kind: 'status', text: 'Diagnostic job added. It is unassigned and unstarted.' })
    } catch {
      setNotice({ kind: 'error', text: 'Not saved — check your connection and retry.' })
    } finally {
      setPending(null)
    }
  }

  const completeReady = workspace.workStatus === 'in_progress'
    && Boolean(workspace.workNotes?.trim())
    && workspace.hasCompletionProof

  return (
    <main className={`app ${styles.screen}`}>
      <AppHeader
        title={`Work order ${String(ticket.number).padStart(6, '0')}`}
        meta={<span>{ticket.customerName} · {ticket.vehicle}</span>}
        back={{ href: `/tickets/${ticket.id}`, label: 'Ticket' }}
      />
      <div className={styles.content}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{workspace.kind === 'repair' ? 'Repair' : 'Maintenance'} · assigned work</p>
          <h1>{workspace.title}</h1>
        </header>

        {workspace.workStatus === 'done' ? (
          <section className={styles.state} aria-labelledby="work-complete">
            <p className={styles.stateMark}>Complete</p>
            <h2 id="work-complete">Work complete</h2>
            <p className={styles.savedNote}>{workspace.workNotes ?? 'No work note recorded.'}</p>
            <ProofList ticketId={ticket.id} jobId={workspace.id} workspace={workspace} />
          </section>
        ) : workspace.authorization === 'declined' ? (
          <ReadOnlyState title="Customer declined this work" copy="This work is not authorized. No work action is available." />
        ) : workspace.authorization !== 'approved' ? (
          <ReadOnlyState title="Work not approved" copy="This work has not been authorized to start." />
        ) : workspace.workStatus === 'open' ? (
          <section className={styles.state} aria-labelledby="ready-heading">
            <p className={styles.stateMark}>Ready</p>
            <h2 id="ready-heading">Approved and ready</h2>
            <p>Start only when the vehicle and bay are ready.</p>
            <button className={styles.primary} type="button" disabled={pending !== null}
              onClick={() => mutateWork({ action: 'start' }, 'start', 'Work started.')}>
              {pending === 'start' ? 'Starting work…' : 'Start work'}
            </button>
          </section>
        ) : (
          <>
            <section className={styles.state} aria-labelledby="progress-heading">
              <p className={styles.stateMark}>Now</p>
              <h2 id="progress-heading">Work in progress</h2>
            </section>
            <section className={styles.module} aria-labelledby="note-heading">
              <div className={styles.moduleHeading}><span>01</span><h2 id="note-heading">Work note</h2></div>
              <label className={styles.label} htmlFor="work-note">Work note</label>
              <textarea id="work-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
              <div className={styles.actionRow}>
                <span>{note.length} / 2,000</span>
                <button className={styles.secondary} type="button" disabled={pending !== null || note.trim().length < 1}
                  onClick={() => mutateWork({ action: 'save_note', note, expectedUpdatedAt: workspace.updatedAt }, 'note', 'Work note saved.')}>
                  {pending === 'note' ? 'Saving note…' : 'Save note'}
                </button>
              </div>
            </section>
            <section className={styles.module} aria-labelledby="proof-heading">
              <div className={styles.moduleHeading}><span>02</span><h2 id="proof-heading">Proof</h2></div>
              <p className={styles.helper}>Add one work photo before completion. Supported files are private and limited to 4 MiB.</p>
              <div className={styles.proofActions}>
                <label className={styles.primaryFile}>Take proof photo
                  <input data-proof-camera type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
                    disabled={pending !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseProof(file) }} />
                </label>
                <label className={styles.secondaryFile}>Add file
                  <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,application/pdf,text/plain"
                    disabled={pending !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void chooseProof(file) }} />
                </label>
              </div>
              {selectedProof && (
                <div className={styles.retryRow}>
                  <span>{selectedProof.file.name}</span>
                  <button type="button" className={styles.secondary} disabled={pending !== null}
                    onClick={() => uploadProof(selectedProof)}>Retry proof upload</button>
                </div>
              )}
              <ProofList ticketId={ticket.id} jobId={workspace.id} workspace={workspace} />
            </section>
            <section className={styles.module} aria-labelledby="complete-heading">
              <div className={styles.moduleHeading}><span>03</span><h2 id="complete-heading">Complete work</h2></div>
              <p className={styles.helper}>Requires a saved work note and a confirmed proof photo.</p>
              <button className={styles.primary} type="button" disabled={pending !== null || !completeReady}
                onClick={() => mutateWork({ action: 'complete', expectedUpdatedAt: workspace.updatedAt }, 'complete', 'Work completed.')}>
                {pending === 'complete' ? 'Completing…' : 'Complete work'}
              </button>
            </section>
            <details className={styles.concern}>
              <summary>Found another concern</summary>
              {createdConcern ? (
                <button type="button" className={styles.secondary} onClick={() => {
                  setCreatedConcern(false); setConcern(''); setTier(''); escalationAttempt.current = null
                }}>Add another concern</button>
              ) : (
                <form onSubmit={createConcern}>
                  <label className={styles.label} htmlFor="found-concern">Concern</label>
                  <textarea id="found-concern" value={concern} maxLength={500} onChange={(event) => {
                    setConcern(event.target.value); escalationAttempt.current = null
                  }} />
                  <label className={styles.label} htmlFor="concern-tier">Required skill tier</label>
                  <select id="concern-tier" value={tier} onChange={(event) => {
                    setTier(event.target.value); escalationAttempt.current = null
                  }}>
                    <option value="">Choose tier</option><option value="1">C-tech · Tier 1</option>
                    <option value="2">B-tech · Tier 2</option><option value="3">A-tech · Tier 3</option>
                  </select>
                  <button className={styles.secondary} type="submit" disabled={pending !== null}>
                    {pending === 'escalation' ? 'Adding diagnostic job…' : 'Create diagnostic job'}
                  </button>
                </form>
              )}
            </details>
          </>
        )}

        {notice && <p className={notice.kind === 'error' ? styles.error : styles.notice}
          role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}>
          {notice.text}
        </p>}
        <Link className={styles.ticketLink} href={`/tickets/${ticket.id}`}>View repair order</Link>
      </div>
    </main>
  )
}

function ReadOnlyState({ title, copy }: { title: string; copy: string }) {
  return <section className={styles.state}><p className={styles.stateMark}>Hold</p><h2>{title}</h2><p>{copy}</p></section>
}

function ProofList({ ticketId, jobId, workspace }: { ticketId: string; jobId: string; workspace: SimpleWorkWorkspaceView }) {
  if (workspace.attachments.length === 0) return <p className={styles.emptyProof}>No proof attached yet.</p>
  return <ul className={styles.proofList}>{workspace.attachments.map((attachment) => (
    <li key={attachment.id}>
      <a href={`/api/tickets/${ticketId}/jobs/${jobId}/attachments/${attachment.id}`} target="_blank" rel="noreferrer">
        Open {attachment.kind} proof
      </a>
      <span>{formatBytes(attachment.byteSize)}</span>
    </li>
  ))}</ul>
}

function formatBytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`
}
