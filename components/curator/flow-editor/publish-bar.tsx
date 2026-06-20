'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useFlowEditor } from './flow-editor-provider'
import { saveDraft, publishDraft } from '@/app/curator/flows/actions'
import { describePublishIssues } from '@/lib/curator/flow-publish-issues'

export function PublishBar() {
  const { flowId, flowVersionId, body, changeNote, setChangeNote, markSaved, dirty } = useFlowEditor()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [issues, setIssues] = useState<string[]>([])
  const [showIssues, setShowIssues] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const onSave = () => {
    startTransition(async () => {
      try {
        await saveDraft({ flowVersionId, body, changeNote })
        markSaved()
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
        setIssues([])
      } catch (e) {
        setIssues([e instanceof Error ? e.message : 'Could not save.'])
        setShowIssues(true)
      }
    })
  }

  const onPublish = () => {
    const found = describePublishIssues(body)
    if (!changeNote.trim()) found.push('Add a short note saying what this version is, then publish.')
    if (found.length > 0) {
      setIssues(found)
      setShowIssues(true)
      return
    }
    startTransition(async () => {
      try {
        await saveDraft({ flowVersionId, body, changeNote })
        markSaved()
        const result = await publishDraft({ flowVersionId, changeNote })
        if (result.ok) {
          setIssues([])
          router.push(`/curator/flows/${flowId}`)
        } else {
          setIssues(result.errors)
          setShowIssues(true)
        }
      } catch (e) {
        setIssues([e instanceof Error ? e.message : 'Could not publish.'])
        setShowIssues(true)
      }
    })
  }

  return (
    <footer className="vt-publishbar">
      {showIssues && issues.length > 0 && (
        <div className="vt-publishbar__issues">
          <div className="vt-publishbar__issues-head">
            <span>Fix these before publishing</span>
            <button type="button" onClick={() => setShowIssues(false)} aria-label="Dismiss">✕</button>
          </div>
          <ul>
            {issues.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
      <div className="vt-publishbar__row">
        <div className="vt-publishbar__note">
          <label className="vt-field__label" htmlFor="pb-note">Why this version (needed to publish)</label>
          <input
            id="pb-note"
            className="vt-field__input"
            placeholder="e.g. First draft from research — added fuel-pressure branch"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
          />
        </div>
        <div className="vt-publishbar__actions">
          <span className="vt-publishbar__state">
            {dirty ? 'Unsaved changes' : savedAt ? `Saved ${savedAt}` : 'Saved'}
          </span>
          <button type="button" onClick={onSave} disabled={!dirty || pending} className="vt-btn">
            {pending ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={onPublish} disabled={pending} className="vt-btn vt-btn--accent">
            Publish
          </button>
        </div>
      </div>
    </footer>
  )
}
