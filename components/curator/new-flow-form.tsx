'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createFlow } from '@/app/curator/flows/actions'
import type { SlugChoice } from '@/lib/curator/slug-catalog'

type PriorRun = { id: string; flowId?: string; flowVersionId?: string }

type StartResponse =
  | { runId: string; reused?: boolean }
  | { priorRun: PriorRun | null }
  | { error: string }

export function NewFlowForm({ platforms, symptoms }: { platforms: SlugChoice[]; symptoms: SlugChoice[] }) {
  const router = useRouter()
  const [platformSlug, setPlatformSlug] = useState('')
  const [symptomSlug, setSymptomSlug] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [priorRun, setPriorRun] = useState<PriorRun | null>(null)
  const [pending, startTransition] = useTransition()

  const validate = () => {
    setError(null)
    if (!platformSlug || !symptomSlug || !title.trim()) {
      setError('Pick a vehicle + symptom and enter a title.')
      return false
    }
    return true
  }

  // "Create + start editing" — unchanged manual path.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
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

  // Create the flow row, then dispatch a fresh research run against it.
  const createAndDispatch = async () => {
    const slug = `${platformSlug}__${symptomSlug}`
    const { flowId } = await createFlow({
      platformSlug, symptomSlug, slug, displayTitle: title.trim(),
    })
    const res = await fetch('/api/curator/research-runs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformSlug, symptomSlug, flowId }),
    })
    const data = (await res.json()) as StartResponse
    if (!res.ok || 'error' in data) {
      throw new Error('error' in data ? data.error : 'Failed to start research')
    }
    if (!('runId' in data)) throw new Error('Failed to start research')
    router.push(`/curator/flows/${flowId}/researching?runId=${data.runId}`)
  }

  // "Create + Research this case" — check for a recent prior run first (cost guard),
  // then either offer reuse or create the flow and dispatch.
  const onResearch = () => {
    if (!validate()) return
    setPriorRun(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/curator/research-runs/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platformSlug, symptomSlug }),
        })
        const data = (await res.json()) as StartResponse
        if (!res.ok || 'error' in data) {
          throw new Error('error' in data ? data.error : 'Failed to start research')
        }
        if ('priorRun' in data && data.priorRun?.flowVersionId) {
          setPriorRun(data.priorRun)
          return
        }
        await createAndDispatch()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start research')
      }
    })
  }

  const reusePrior = () => {
    if (!priorRun?.flowId || !priorRun.flowVersionId) return
    router.push(`/curator/flows/${priorRun.flowId}/edit?versionId=${priorRun.flowVersionId}`)
  }

  const runFresh = () => {
    setPriorRun(null)
    startTransition(async () => {
      try {
        await createAndDispatch()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start research')
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

      {priorRun ? (
        <div className="vt-research-reuse">
          <p>We already researched this vehicle + complaint recently. Reuse that draft, or run fresh research?</p>
          <div className="vt-research-reuse-actions">
            <button type="button" onClick={reusePrior} disabled={pending} className="vt-btn vt-btn-primary">
              Reuse prior research
            </button>
            <button type="button" onClick={runFresh} disabled={pending} className="vt-btn">
              {pending ? 'Starting…' : 'Run fresh research'}
            </button>
          </div>
        </div>
      ) : (
        <div className="vt-curator-form-actions">
          <button type="submit" disabled={pending} className="vt-btn vt-btn-primary">
            {pending ? 'Working…' : 'Create + start editing'}
          </button>
          <button type="button" onClick={onResearch} disabled={pending} className="vt-btn">
            {pending ? 'Working…' : 'Create + Research this case'}
          </button>
        </div>
      )}
    </form>
  )
}
