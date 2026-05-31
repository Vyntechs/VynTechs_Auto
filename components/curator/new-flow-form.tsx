'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createFlow } from '@/app/curator/flows/actions'
import type { SlugChoice } from '@/lib/curator/slug-catalog'

export function NewFlowForm({ platforms, symptoms }: { platforms: SlugChoice[]; symptoms: SlugChoice[] }) {
  const router = useRouter()
  const [platformSlug, setPlatformSlug] = useState('')
  const [symptomSlug, setSymptomSlug] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!platformSlug || !symptomSlug || !title.trim()) {
      setError('Pick a vehicle + symptom and enter a title.')
      return
    }
    const slug = `${platformSlug}__${symptomSlug}`
    startTransition(async () => {
      try {
        const { flowId, flowVersionId } = await createFlow({
          platformSlug, symptomSlug, slug, displayTitle: title.trim(),
        })
        router.push(`/curator/flows/${flowId}/edit?versionId=${flowVersionId}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create flow')
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="vt-curator-form">
      <label>
        Vehicle
        <select value={platformSlug} onChange={(e) => setPlatformSlug(e.target.value)} required>
          <option value="">— pick a vehicle —</option>
          {platforms.map((p) => (
            <option key={p.slug} value={p.slug}>{p.display}</option>
          ))}
        </select>
      </label>

      <label>
        Symptom
        <select value={symptomSlug} onChange={(e) => setSymptomSlug(e.target.value)} required>
          <option value="">— pick a symptom —</option>
          {symptoms.map((s) => (
            <option key={s.slug} value={s.slug}>{s.display}</option>
          ))}
        </select>
      </label>

      <label>
        Title (what techs see)
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. 2003–2007 F-250 6.0 PSD — Cranks-No-Start"
          required
        />
      </label>

      {error && <div className="vt-form-error">{error}</div>}

      <button type="submit" disabled={pending} className="vt-btn vt-btn-primary">
        {pending ? 'Creating…' : 'Create + start editing'}
      </button>
    </form>
  )
}
