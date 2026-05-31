'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useFlowEditor } from './flow-editor-provider'
import { saveDraft, publishDraft } from '@/app/curator/flows/actions'
import { validateFlowForPublish } from '@/lib/curator/flow-validation'

export function PublishBar() {
  const { flowId, flowVersionId, body, changeNote, setChangeNote, markSaved, dirty } = useFlowEditor()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<string[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const onSave = () => {
    startTransition(async () => {
      try {
        await saveDraft({ flowVersionId, body, changeNote })
        markSaved()
        setSavedAt(new Date().toLocaleTimeString())
        setErrors([])
      } catch (e) {
        setErrors([e instanceof Error ? e.message : 'Save failed'])
      }
    })
  }

  const onPublish = () => {
    const localValidation = validateFlowForPublish(body)
    if (!localValidation.ok) {
      setErrors(localValidation.errors)
      return
    }
    if (!changeNote.trim()) {
      setErrors(['Add a change note before publishing.'])
      return
    }
    startTransition(async () => {
      const result = await publishDraft({ flowVersionId, changeNote })
      if (result.ok) {
        setErrors([])
        router.push(`/curator/flows/${flowId}`)
      } else {
        setErrors(result.errors)
      }
    })
  }

  return (
    <footer className="vt-publish-bar">
      <input
        className="vt-publish-bar-changenote"
        placeholder="Change note (required for publish)"
        value={changeNote}
        onChange={(e) => setChangeNote(e.target.value)}
      />
      <button onClick={onSave} disabled={!dirty || pending} className="vt-btn vt-btn-secondary">
        {pending ? 'Saving…' : 'Save draft'}
      </button>
      <button onClick={onPublish} disabled={pending} className="vt-btn vt-btn-primary">Publish</button>
      {savedAt && <span className="vt-publish-bar-saved">Saved {savedAt}</span>}
      {errors.length > 0 && (
        <ul className="vt-publish-bar-errors">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </footer>
  )
}
