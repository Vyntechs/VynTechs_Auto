'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MainHeader } from '@/components/vt/desktop'
import type { ResearchRunStatusView } from '@/lib/research/types'

/**
 * Real-status progress view for a research run. Polls the status endpoint every
 * 2s and renders ONLY what the DB reports (#98 trust sweep): real per-agent
 * status + counts, a genuine elapsed clock + an honest static range (never a
 * fake countdown), and no "AI" word. On completion it lands the curator in the
 * draft editor (PR-N2).
 */

const STATUS_WORD: Record<string, string> = {
  running: 'Working',
  completed: 'Done',
  failed: 'No luck',
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ResearchProgress({ runId, flowId }: { runId: string; flowId: string }) {
  const router = useRouter()
  const [view, setView] = useState<ResearchRunStatusView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Poll the real run status.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const res = await fetch(`/api/curator/research-runs/${runId}`)
        if (!res.ok) throw new Error(await res.text())
        const data = (await res.json()) as ResearchRunStatusView
        if (!alive) return
        setView(data)
        if (data.status === 'completed' || data.status === 'partial') {
          if (data.flowVersionId) {
            router.replace(`/curator/flows/${flowId}/edit?versionId=${data.flowVersionId}`)
          }
          return
        }
        if (data.status === 'failed') {
          setError(data.errorMessage ?? 'Research couldn’t finish.')
          return
        }
        timer = setTimeout(tick, 2_000)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Lost contact with the research run.')
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [runId, flowId, router])

  // A real elapsed clock (counts up from the run's start — never a countdown).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  const backToFlow = (
    <Link href={`/curator/flows/${flowId}`} className="vt-curator-backlink">← Back to flow</Link>
  )

  if (error) {
    return (
      <>
        <MainHeader eyebrowSlot={backToFlow} title="Research couldn’t finish" />
        <div className="vt-main__body vt-research">
          <div className="vt-callout vt-callout--warn">
            <p className="vt-callout__title">The research run didn’t complete.</p>
            <p className="vt-callout__body">{error}</p>
            <Link href={`/curator/flows/${flowId}/edit`} className="vt-btn vt-btn--accent">
              Build this flow by hand instead
            </Link>
          </div>
        </div>
      </>
    )
  }

  const agents = view?.agents ?? []
  const done = agents.filter((a) => a.status === 'completed').length
  const total = agents.length
  const startedMs = view?.startedAt ? new Date(view.startedAt).getTime() : now
  const isComplete = view?.status === 'completed' || view?.status === 'partial'

  return (
    <>
      <MainHeader
        eyebrowSlot={backToFlow}
        title="Researching this case"
        sub="Three diesel-tech viewpoints are searching sources in parallel and drafting a starting tree. You’ll review everything before it goes live."
      />
      <div className="vt-main__body vt-research">
        <div className="vt-research__summary">
          <div className="vt-research__count">
            <span className="vt-research__count-num">{total ? `${done} of ${total}` : '—'}</span>
            <span className="vt-research__count-label">
              {isComplete ? 'finished — opening your draft' : 'viewpoints done'}
            </span>
          </div>
          <div className="vt-research__clock">
            <span className="vt-research__elapsed">{fmtElapsed(now - startedMs)}</span>
            <span className="vt-research__range">elapsed · typically 3–6 min</span>
          </div>
        </div>

        <ul className="vt-tracklist">
          {agents.map((a) => (
            <li key={a.persona} className={`vt-track vt-track--${a.status}`}>
              <span className="vt-track__icon" aria-hidden="true" />
              <div className="vt-track__body">
                <span className="vt-track__name">{a.displayName}</span>
                <span className="vt-track__note">
                  {a.progressNote ?? (a.status === 'running' ? 'Searching…' : STATUS_WORD[a.status])}
                </span>
              </div>
              <span className="vt-track__status">{STATUS_WORD[a.status] ?? a.status}</span>
            </li>
          ))}
          {total > 0 && (
            <li className="vt-track vt-track--synthesis">
              <span className="vt-track__icon" aria-hidden="true" />
              <div className="vt-track__body">
                <span className="vt-track__name">Drafting the tree</span>
                <span className="vt-track__note">
                  {isComplete ? 'Done' : 'Starts once the viewpoints finish'}
                </span>
              </div>
            </li>
          )}
        </ul>

        {!isComplete && (
          <p className="vt-research__leave">
            You can leave this page — the search keeps running, and the draft will be waiting in the flow.
          </p>
        )}
      </div>
    </>
  )
}
