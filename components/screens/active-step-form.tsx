'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DotsThree } from '@phosphor-icons/react/dist/ssr'
import { PhotoCapture } from '@/components/session/photo-capture'
import { AudioCapture } from '@/components/session/audio-capture'
import { VideoCapture } from '@/components/session/video-capture'
import { AmbientConditionsCapture } from '@/components/session/ambient-conditions-capture'

type RequestedArtifact = {
  kind:
    | 'photo'
    | 'scan_screen'
    | 'wiring_diagram'
    | 'audio'
    | 'video'
    | 'ambient_conditions'
  prompt: string
}

type Props = {
  sessionId: string
  nodeId: string
  requestedArtifact?: RequestedArtifact
}

// iOS Safari surfaces a fetch failure (timeout / dropped connection /
// CORS) as `TypeError: Load failed`. Chrome's equivalent is "Failed to
// fetch". The string is opaque to a tech, so map fetch-level failures
// to actionable copy. HTTP error bodies (thrown above as `new Error(...)`)
// keep their original message — those are usually informative.
function describeFetchError(err: unknown): string {
  if (err instanceof TypeError) {
    return 'AI took too long or your connection dropped — tap again to retry.'
  }
  return err instanceof Error ? err.message : 'Network error'
}

export function ActiveStepForm({ sessionId, nodeId, requestedArtifact }: Props) {
  const [observation, setObservation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!observation.trim()) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ observation: observation.trim() }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.error ?? `Failed (${res.status})`)
          return
        }
        setObservation('')
        router.refresh()
      } catch (err) {
        setError(describeFetchError(err))
      }
    })
  }

  return (
    <form onSubmit={submit}>
      {requestedArtifact && (
        <div style={{ marginBottom: 12 }}>
          {(requestedArtifact.kind === 'photo' ||
            requestedArtifact.kind === 'scan_screen' ||
            requestedArtifact.kind === 'wiring_diagram') && (
            <PhotoCapture
              sessionId={sessionId}
              nodeId={nodeId}
              kind={requestedArtifact.kind}
              label={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'audio' && (
            <AudioCapture
              sessionId={sessionId}
              nodeId={nodeId}
              prompt={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'video' && (
            <VideoCapture
              sessionId={sessionId}
              nodeId={nodeId}
              label={requestedArtifact.prompt}
              onUploaded={() => router.refresh()}
            />
          )}
          {requestedArtifact.kind === 'ambient_conditions' && (
            <AmbientConditionsCapture
              sessionId={sessionId}
              prompt={requestedArtifact.prompt}
              onCaptured={() => router.refresh()}
            />
          )}
        </div>
      )}
      <label htmlFor={`obs-${sessionId}`} className="vt-sr-only">
        Observation
      </label>
      <textarea
        id={`obs-${sessionId}`}
        value={observation}
        onChange={(e) => setObservation(e.target.value)}
        placeholder="Log what you observed."
        rows={2}
        disabled={isPending}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--vt-bone-100)',
          border: '0.5px solid var(--vt-rule-strong)',
          borderRadius: 'var(--vt-radius-2)',
          padding: '10px 12px',
          fontFamily: 'var(--vt-font-serif)',
          fontSize: 15,
          color: 'var(--vt-fg)',
          resize: 'none',
          outline: 0,
          marginBottom: 8,
          letterSpacing: '-0.005em',
        }}
      />
      {error && (
        <div
          role="alert"
          style={{
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 12,
            color: 'var(--vt-risk-destructive)',
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={isPending || !observation.trim()}
        >
          {isPending ? 'Logging…' : 'Log observation'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="More options"
          disabled={isPending}
        >
          <DotsThree size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
