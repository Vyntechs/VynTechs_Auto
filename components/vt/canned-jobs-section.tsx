'use client'

import { useEffect, useRef, useState } from 'react'
import { Module } from './module'
import {
  cannedJobToDraft, classifyCannedJobFailure, formatMoneyCents, newCannedJobDraft, newCannedLine,
  normalizeCannedJobDraft, normalizedCannedJobSignature, parseCannedJobListResponse,
  parseCannedJobMutationResponse, parseManagementCannedJobMutationResponse,
  type CannedJobDraft, type CannedJobProjection,
} from '@/lib/shop-os/canned-jobs-ui'
import styles from './canned-jobs-section.module.css'

type Props = { initialJobs: CannedJobProjection[]; initialTaxRateBps: number | null }
type Editor = { mode: 'create'; draft: CannedJobDraft } | { mode: 'edit'; original: CannedJobProjection; draft: CannedJobDraft }

export function CannedJobsSection({ initialJobs, initialTaxRateBps }: Props) {
  const [jobs, setJobs] = useState(initialJobs)
  const [taxRateBps, setTaxRateBps] = useState(initialTaxRateBps)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [retiring, setRetiring] = useState<CannedJobProjection | null>(null)
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null)
  const keyRef = useRef<{ signature: string; key: string } | null>(null)
  const inFlightRef = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const dialogCancel = useRef<HTMLButtonElement | null>(null)
  const editorFirstField = useRef<HTMLInputElement | null>(null)
  const newButton = useRef<HTMLButtonElement | null>(null)

  const dirty = editor ? draftSignature(editor.draft) !== (editor.mode === 'edit' ? draftSignature(cannedJobToDraft(editor.original)) : draftSignature(newCannedJobDraft())) : false

  useEffect(() => { if (retiring || discardAction) dialogCancel.current?.focus() }, [retiring, discardAction])

  function requestSwitch(action: () => void) {
    if (inFlightRef.current) return
    if (dirty) { returnFocus.current = document.activeElement as HTMLElement; setDiscardAction(() => action) }
    else action()
  }

  async function refresh() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true); setMessage(null)
    try {
      const response = await fetch('/api/shop/canned-jobs')
      const parsed = response.ok ? parseCannedJobListResponse(await response.json().catch(() => null)) : null
      if (!response.ok) setMessage(classifyCannedJobFailure(response.status))
      else if (!parsed) setMessage('The library response was incomplete. Refresh and try again.')
      else {
        setJobs(parsed.cannedJobs); setTaxRateBps(parsed.taxRateBps)
        setEditor((current) => {
          if (!current || current.mode === 'create') return current
          const refreshed = parsed.cannedJobs.find((job) => job.id === current.original.id)
          if (!refreshed) { queueMicrotask(() => newButton.current?.focus()); return null }
          return { ...current, original: refreshed }
        })
        setMessage(editor?.mode === 'edit' && !parsed.cannedJobs.some((job) => job.id === editor.original.id)
          ? 'That canned job is no longer active. The editor was closed.'
          : 'Library refreshed.')
      }
    } catch { setMessage('Could not reach the server. Try again.') }
    finally { inFlightRef.current = false; setBusy(false) }
  }

  async function save() {
    if (!editor || inFlightRef.current) return
    let body: ReturnType<typeof normalizeCannedJobDraft>; let signature: string
    try { body = normalizeCannedJobDraft(editor.draft); signature = JSON.stringify(body) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Check every field.'); return }
    inFlightRef.current = true; setBusy(true); setMessage(null)
    try {
      const creating = editor.mode === 'create'
      if (creating && keyRef.current?.signature !== signature) keyRef.current = { signature, key: crypto.randomUUID() }
      const response = await fetch(creating ? '/api/shop/canned-jobs' : `/api/shop/canned-jobs/${editor.original.id}`, {
        method: creating ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(creating ? { clientKey: keyRef.current!.key, cannedJob: body } : { expectedFingerprint: editor.original.fingerprint, cannedJob: body }),
      })
      const payload = response.ok ? await response.json().catch(() => null) : null
      const parsed = response.ok ? (creating
        ? parseCannedJobMutationResponse(response.status, payload)
        : parseManagementCannedJobMutationResponse(payload)) : null
      if (!response.ok) setMessage(classifyCannedJobFailure(response.status))
      else if (!parsed || (!creating && parsed.cannedJob.id !== editor.original.id)) setMessage('The saved response was incomplete. Refresh before making another change.')
      else {
        setJobs((current) => [...current.filter((job) => job.id !== parsed.cannedJob.id), parsed.cannedJob].sort(compareJobs))
        keyRef.current = null; setEditor(null); setMessage(parsed.changed ? 'Canned job saved.' : 'Canned job already matched.')
      }
    } catch { setMessage('Could not reach the server. Your form is still open; try again.') }
    finally { inFlightRef.current = false; setBusy(false) }
  }

  async function retire() {
    if (!retiring || inFlightRef.current) return
    const target = retiring
    inFlightRef.current = true; setBusy(true); setMessage(null)
    try {
      const response = await fetch(`/api/shop/canned-jobs/${target.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedFingerprint: target.fingerprint }) })
      const parsed = response.ok ? parseManagementCannedJobMutationResponse(await response.json().catch(() => null)) : null
      if (!response.ok) setMessage(classifyCannedJobFailure(response.status))
      else if (!parsed || parsed.cannedJob.id !== target.id) setMessage('The retirement response was incomplete. Refresh before continuing.')
      else { setJobs((current) => current.filter((job) => job.id !== target.id)); setMessage('Canned job retired. Existing quotes are unchanged.') }
    } catch { setMessage('Could not reach the server. Try again.') }
    finally { inFlightRef.current = false; setBusy(false); setRetiring(null); queueMicrotask(() => returnFocus.current?.focus()) }
  }

  return (
    <Module num="02" label="Canned jobs" status={<span className={styles.count}>{jobs.length} active</span>}>
      <div className={styles.library} inert={retiring || discardAction ? true : undefined}>
        <header className={styles.intro}>
          <p>Keep priced repair and maintenance work ready for fast quotes.</p>
          <div className={styles.actions}>
            <button ref={newButton} className="btn btn-primary" disabled={busy} onClick={() => requestSwitch(() => setEditor({ mode: 'create', draft: newCannedJobDraft() }))}>New canned job</button>
            <button className="btn" disabled={busy} onClick={refresh}>Refresh</button>
          </div>
        </header>
        {message && <p className={styles.message} role="status" aria-live="polite">{message}</p>}
        {jobs.length === 0 ? <div className={styles.empty}><strong>No canned jobs yet.</strong><span>Create one priced template to speed up routine quotes.</span></div> : (
          <ul className={styles.list}>
            {jobs.map((job) => <li key={job.id} className={styles.card}>
              <div><span className={styles.kind}>{job.kind} · tier {job.defaultRequiredSkillTier}</span><h3>{job.title}</h3><p>{job.lines.length} {job.lines.length === 1 ? 'line' : 'lines'} · {formatMoneyCents(job.summary.subtotalCents)} before tax</p>{taxRateBps === null && <small>Tax is not configured; final total remains unavailable.</small>}</div>
              <div className={styles.cardActions}>
                <button className="btn" disabled={busy} onClick={() => requestSwitch(() => setEditor({ mode: 'edit', original: job, draft: cannedJobToDraft(job) }))}>Edit</button>
                <button className="btn" disabled={busy} onClick={(event) => { returnFocus.current = event.currentTarget; setRetiring(job) }}>Retire</button>
              </div>
            </li>)}
          </ul>
        )}
        {editor && <EditorForm editor={editor} busy={busy} setEditor={setEditor} onSave={save} onClose={() => requestSwitch(() => setEditor(null))} titleRef={editorFirstField} />}
      </div>
      {(retiring || discardAction) && <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) { const target = retiring ? returnFocus.current : editorFirstField.current ?? returnFocus.current; setRetiring(null); setDiscardAction(null); queueMicrotask(() => target?.focus()) } }}>
        <div role="alertdialog" aria-modal="true" aria-labelledby="canned-confirm-title" className={styles.dialog} onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) { const target = retiring ? returnFocus.current : editorFirstField.current ?? returnFocus.current; setRetiring(null); setDiscardAction(null); queueMicrotask(() => target?.focus()); return }
          if (e.key === 'Tab') trapDialogTab(e)
        }}>
          <h3 id="canned-confirm-title">{retiring ? `Retire ${retiring.title}?` : 'Discard unsaved changes?'}</h3>
          <p>{retiring ? 'It leaves the active library. Existing quotes stay unchanged.' : 'The open form will return to its last saved state.'}</p>
          <div className={styles.actions}><button ref={dialogCancel} className="btn" disabled={busy} onClick={() => { const target = retiring ? returnFocus.current : editorFirstField.current ?? returnFocus.current; setRetiring(null); setDiscardAction(null); queueMicrotask(() => target?.focus()) }}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => { if (retiring) void retire(); else { const action = discardAction; setDiscardAction(null); action?.(); queueMicrotask(() => (editorFirstField.current ?? newButton.current)?.focus()) } }}>{retiring ? 'Retire canned job' : 'Discard changes'}</button></div>
        </div>
      </div>}
    </Module>
  )
}

function EditorForm({ editor, busy, setEditor, onSave, onClose, titleRef }: { editor: Editor; busy: boolean; setEditor: React.Dispatch<React.SetStateAction<Editor | null>>; onSave: () => void; onClose: () => void; titleRef: React.RefObject<HTMLInputElement | null> }) {
  const draft = editor.draft
  const update = (next: Partial<CannedJobDraft>) => setEditor({ ...editor, draft: { ...draft, ...next } })
  const updateLine = (index: number, next: Partial<CannedJobDraft['lines'][number]>) => update({ lines: draft.lines.map((line, position) => position === index ? { ...line, ...next } : line) })
  return <section className={styles.editor} aria-label={editor.mode === 'create' ? 'Create canned job' : `Edit ${editor.original.title}`}>
    <header><div><span className={styles.kind}>{editor.mode === 'create' ? 'New library entry' : 'Replace saved entry'}</span><h3>{editor.mode === 'create' ? 'Build a canned job' : `Edit ${editor.original.title}`}</h3></div><button className="btn" disabled={busy} onClick={onClose}>Close</button></header>
    <div className={styles.grid}>
      <label>Title<input ref={titleRef} value={draft.title} maxLength={200} disabled={busy} onChange={(e) => update({ title: e.target.value })} /></label>
      <label>Work type<select value={draft.kind} disabled={busy} onChange={(e) => update({ kind: e.target.value as CannedJobDraft['kind'] })}><option value="repair">Repair</option><option value="maintenance">Maintenance</option></select></label>
      <label>Required skill tier<select value={draft.tier} disabled={busy} onChange={(e) => update({ tier: e.target.value })}><option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option></select></label>
      <label>Library order<input inputMode="numeric" value={draft.sort} disabled={busy} onChange={(e) => update({ sort: e.target.value })} /></label>
    </div>
    <div className={styles.linesHeader}><h4>Priced lines</h4><button className="btn" disabled={busy || draft.lines.length >= 25} onClick={() => update({ lines: [...draft.lines, newCannedLine()] })}>Add line</button></div>
    <ol className={styles.lines}>{draft.lines.map((line, index) => <li key={line.key}><fieldset className={styles.line}><legend>Line {index + 1}: {line.kind}</legend>
      <div className={styles.grid}>
        <label>Line type<select aria-label={`Line ${index + 1} type`} value={line.kind} disabled={busy} onChange={(e) => updateLine(index, { kind: e.target.value as typeof line.kind })}><option value="part">Part</option><option value="labor">Labor</option><option value="fee">Fee</option></select></label>
        <label>Description<input aria-label={`Line ${index + 1} description`} value={line.description} maxLength={500} disabled={busy} onChange={(e) => updateLine(index, { description: e.target.value })} /></label>
        <label>Customer price<input aria-label={`Line ${index + 1} customer price`} inputMode="decimal" value={line.price} disabled={busy} onChange={(e) => updateLine(index, { price: e.target.value })} /></label>
        <label>Line order<input aria-label={`Line ${index + 1} order`} inputMode="numeric" value={line.sort} disabled={busy} onChange={(e) => updateLine(index, { sort: e.target.value })} /></label>
        {line.kind === 'part' && <><label>Quantity<input aria-label={`Line ${index + 1} quantity`} inputMode="decimal" value={line.quantity} disabled={busy} onChange={(e) => updateLine(index, { quantity: e.target.value })} /></label><label>Part number<input aria-label={`Line ${index + 1} part number`} value={line.partNumber} maxLength={200} disabled={busy} onChange={(e) => updateLine(index, { partNumber: e.target.value })} /></label><label>Brand<input aria-label={`Line ${index + 1} brand`} value={line.brand} maxLength={200} disabled={busy} onChange={(e) => updateLine(index, { brand: e.target.value })} /></label></>}
        {line.kind === 'labor' && <><label>Hours<input aria-label={`Line ${index + 1} hours`} inputMode="decimal" value={line.hours} disabled={busy} onChange={(e) => updateLine(index, { hours: e.target.value })} /></label><label>Labor rate (optional)<input aria-label={`Line ${index + 1} labor rate`} inputMode="decimal" value={line.laborRate} disabled={busy} onChange={(e) => updateLine(index, { laborRate: e.target.value })} /></label></>}
        <label className={styles.check}><input aria-label={`Line ${index + 1} taxable`} type="checkbox" checked={line.taxable} disabled={busy} onChange={(e) => updateLine(index, { taxable: e.target.checked })} />Taxable</label>
      </div>
      <button className="btn" aria-label={`Remove line ${index + 1}`} disabled={busy || draft.lines.length === 1} onClick={() => update({ lines: draft.lines.filter((_, position) => position !== index) })}>Remove line</button>
    </fieldset></li>)}</ol>
    <footer className={styles.editorFooter}><button className="btn" disabled={busy} onClick={onClose}>Discard</button><button className="btn btn-primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save canned job'}</button></footer>
  </section>
}

function compareJobs(a: CannedJobProjection, b: CannedJobProjection) { return a.sort - b.sort || a.title.localeCompare(b.title) || a.id.localeCompare(b.id) }
function draftSignature(draft: CannedJobDraft) {
  try { return normalizedCannedJobSignature(draft) }
  catch { return JSON.stringify({ ...draft, lines: draft.lines.map(({ key: _key, ...line }) => line) }) }
}
function trapDialogTab(event: React.KeyboardEvent<HTMLDivElement>) {
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  if (controls.length === 0) return
  const first = controls[0]; const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
