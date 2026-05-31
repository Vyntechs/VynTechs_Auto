'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ResearchRunStatusView } from '@/lib/research/types'

/**
 * Real-status progress view for a research run. Polls the status endpoint every 2s
 * and renders ONLY what the DB reports (per the #98 trust sweep): real per-agent
 * status + counts, a genuine wait estimate (not a fake countdown), and no "AI" word.
 * On completion it lands the curator in the draft editor (PR-N2).
 */
export function ResearchProgress({ runId, flowId }: { runId: string; flowId: string }) {
  const router = useRouter()
  const [view, setView] = useState<ResearchRunStatusView | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          setError(data.errorMessage ?? 'Research failed')
          return
        }
        timer = setTimeout(tick, 2_000)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'poll failed')
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [runId, flowId, router])

  if (error) {
    return (
      <div className="vt-research-progress vt-research-progress--error">
        <h2>Research couldn’t finish</h2>
        <p>{error}</p>
        <p>You can still proceed to the manual editor.</p>
      </div>
    )
  }

  if (!view) return <div className="vt-research-progress">Starting research…</div>

  return (
    <div className="vt-research-progress">
      <h2>Researching this case</h2>
      <p>Three diesel-tech perspectives are working in parallel. Typical wait is 3–6 minutes.</p>
      <ul className="vt-research-progress-agents">
        {view.agents.map((a) => (
          <li key={a.persona} className={`vt-research-progress-agent vt-status-${a.status}`}>
            <strong>{a.displayName}</strong>: {a.progressNote ?? a.status}
          </li>
        ))}
      </ul>
      <p className="vt-research-progress-note">
        When it’s done you’ll land in the draft editor. Sources and any disagreements are shown
        inline for you to review.
      </p>
    </div>
  )
}
