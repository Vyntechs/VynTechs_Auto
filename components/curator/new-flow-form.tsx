'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createFlow } from '@/app/curator/flows/actions'
import { MainHeader, Field } from '@/components/vt/desktop'
import type { SlugChoice } from '@/lib/curator/slug-catalog'

export type ExistingFlow = {
  flowId: string
  platformSlug: string
  symptomSlug: string
  title: string
}

type PriorRun = { id: string; flowId?: string; flowVersionId?: string }

type StartResponse =
  | { runId: string; reused?: boolean }
  | { priorRun: PriorRun | null }
  | { error: string }

export function NewFlowForm({
  platforms,
  symptoms,
  existing = [],
}: {
  platforms: SlugChoice[]
  symptoms: SlugChoice[]
  existing?: ExistingFlow[]
}) {
  const router = useRouter()
  const [platformSlug, setPlatformSlug] = useState('')
  const [symptomSlug, setSymptomSlug] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [priorRun, setPriorRun] = useState<PriorRun | null>(null)
  const [pending, startTransition] = useTransition()
  // Which path is running, so each button shows its OWN progress label.
  const [busyKind, setBusyKind] = useState<'manual' | 'research' | null>(null)

  // One flow per (vehicle, symptom): if the chosen pair already exists, steer
  // the curator to it instead of letting them submit into an error.
  const duplicate =
    platformSlug && symptomSlug
      ? existing.find((e) => e.platformSlug === platformSlug && e.symptomSlug === symptomSlug)
      : undefined

  const validate = () => {
    setError(null)
    if (!platformSlug || !symptomSlug || !title.trim()) {
      setError('Pick a vehicle and a problem, then give it a title.')
      return false
    }
    return true
  }

  const onManual = (e: React.FormEvent) => {
    e.preventDefault()
    if (duplicate || !validate()) return
    const slug = `${platformSlug}__${symptomSlug}`
    setBusyKind('manual')
    startTransition(async () => {
      try {
        const { flowId, flowVersionId } = await createFlow({
          platformSlug, symptomSlug, slug, displayTitle: title.trim(),
        })
        router.push(`/curator/flows/${flowId}/edit?versionId=${flowVersionId}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the flow.')
        setBusyKind(null)
      }
    })
  }

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
      throw new Error('error' in data ? data.error : 'Could not start the research run.')
    }
    if (!('runId' in data)) throw new Error('Could not start the research run.')
    router.push(`/curator/flows/${flowId}/researching?runId=${data.runId}`)
  }

  const onResearch = () => {
    if (duplicate || !validate()) return
    setPriorRun(null)
    setBusyKind('research')
    startTransition(async () => {
      try {
        const res = await fetch('/api/curator/research-runs/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platformSlug, symptomSlug }),
        })
        const data = (await res.json()) as StartResponse
        if (!res.ok || 'error' in data) {
          throw new Error('error' in data ? data.error : 'Could not start the research run.')
        }
        if ('priorRun' in data && data.priorRun?.flowVersionId) {
          setPriorRun(data.priorRun)
          setBusyKind(null)
          return
        }
        await createAndDispatch()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the research run.')
        setBusyKind(null)
      }
    })
  }

  const reusePrior = () => {
    if (!priorRun?.flowId || !priorRun.flowVersionId) return
    router.push(`/curator/flows/${priorRun.flowId}/edit?versionId=${priorRun.flowVersionId}`)
  }

  const runFresh = () => {
    setPriorRun(null)
    setBusyKind('research')
    startTransition(async () => {
      try {
        await createAndDispatch()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the research run.')
        setBusyKind(null)
      }
    })
  }

  return (
    <>
      <MainHeader
        eyebrowSlot={<Link href="/curator/flows" className="vt-curator-backlink">← Flows</Link>}
        title="New flow"
        sub="Pick the vehicle and the problem this guide covers, then choose how to build it."
      />
      <form onSubmit={onManual} className="vt-main__body vt-newflow">
        <div className="vt-newflow__fields">
          <Field label="Vehicle" htmlFor="nf-vehicle">
            <select
              id="nf-vehicle"
              className="vt-field__select"
              value={platformSlug}
              onChange={(e) => setPlatformSlug(e.target.value)}
              required
            >
              <option value="">Choose a vehicle…</option>
              {platforms.map((p) => (
                <option key={p.slug} value={p.slug}>{p.display}</option>
              ))}
            </select>
          </Field>

          <Field label="Problem" htmlFor="nf-symptom">
            <select
              id="nf-symptom"
              className="vt-field__select"
              value={symptomSlug}
              onChange={(e) => setSymptomSlug(e.target.value)}
              required
            >
              <option value="">Choose a problem…</option>
              {symptoms.map((s) => (
                <option key={s.slug} value={s.slug}>{s.display}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Title techs will see"
            htmlFor="nf-title"
            hint="Write it the way a tech would recognize the job."
          >
            <input
              id="nf-title"
              className="vt-field__input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2003–2007 F-250 6.0 Power Stroke — Cranks, no start"
              required
            />
          </Field>
        </div>

        {error && <div className="vt-newflow__error" role="alert">{error}</div>}

        {duplicate ? (
          <div className="vt-callout vt-callout--info">
            <p className="vt-callout__title">A flow for this vehicle + problem already exists.</p>
            <p className="vt-callout__body">“{duplicate.title}” — only one flow per pair is allowed.</p>
            <Link href={`/curator/flows/${duplicate.flowId}`} className="vt-btn vt-btn--accent">
              Open that flow
            </Link>
          </div>
        ) : priorRun ? (
          <div className="vt-callout vt-callout--info">
            <p className="vt-callout__title">This case was researched recently.</p>
            <p className="vt-callout__body">
              Reuse that draft now (free, opens straight away), or run a fresh search (about 3–6 minutes).
            </p>
            <div className="vt-newflow__reuse-actions">
              <button type="button" onClick={reusePrior} disabled={pending} className="vt-btn vt-btn--accent">
                Reuse that draft
              </button>
              <button type="button" onClick={runFresh} disabled={pending} className="vt-btn">
                {busyKind === 'research' ? 'Starting…' : 'Run fresh research'}
              </button>
            </div>
          </div>
        ) : (
          <div className="vt-newflow__choices">
            <div className="vt-choice">
              <div className="vt-choice__head">
                <span className="vt-choice__name">Research this case first</span>
                <span className="vt-choice__time">~3–6 min</span>
              </div>
              <p className="vt-choice__desc">
                Three diesel-tech viewpoints search sources and draft a starting tree with
                citations. You review and edit before anything goes live.
              </p>
              <button type="button" onClick={onResearch} disabled={pending} className="vt-btn vt-btn--accent">
                {busyKind === 'research' ? 'Starting…' : 'Research this case'}
              </button>
            </div>

            <div className="vt-choice">
              <div className="vt-choice__head">
                <span className="vt-choice__name">Write it myself</span>
              </div>
              <p className="vt-choice__desc">
                Start from a blank flow and build the steps by hand.
              </p>
              <button type="submit" disabled={pending} className="vt-btn">
                {busyKind === 'manual' ? 'Creating…' : 'Start editing'}
              </button>
            </div>
          </div>
        )}
      </form>
    </>
  )
}
