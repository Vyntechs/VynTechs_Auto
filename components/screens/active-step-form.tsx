'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DotsThree } from '@phosphor-icons/react/dist/ssr'
import { PhotoCapture } from '@/components/session/photo-capture'
import { AudioCapture } from '@/components/session/audio-capture'
import { VideoCapture } from '@/components/session/video-capture'
import { AmbientConditionsCapture } from '@/components/session/ambient-conditions-capture'
import { LogButton, DEFAULT_STAGES } from '@/components/vt/log-button'
import { useAdvanceStream } from '@/lib/use-advance-stream'

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

const DONE_HOLD_MS = 700

export function ActiveStepForm({ sessionId, nodeId, requestedArtifact }: Props) {
  const [observation, setObservation] = useState('')
  const [phase, setPhase] = useState<'idle' | 'done'>('idle')
  const router = useRouter()
  const { state, submit } = useAdvanceStream()

  // When the hook reports done, hold the done face for 700ms then refresh.
  useEffect(() => {
    if (!state.isDone) return
    setPhase('done')
    setObservation('')
    const t = setTimeout(() => {
      setPhase('idle')
      router.refresh()
    }, DONE_HOLD_MS)
    return () => clearTimeout(t)
  }, [state.isDone, router])

  const buttonState: 'idle' | 'loading' | 'done' = state.isLoading
    ? 'loading'
    : phase

  // The wire stages only carry { label }; LogButton's stages need { label, ms }.
  // ms only feeds the timer's totalMs calc — when freezeStage is set (it always
  // is once the server speaks), the timer doesn't run, so any non-zero ms works.
  const stages = state.stages
    ? state.stages.map((s) => ({ ...s, ms: 800 }))
    : DEFAULT_STAGES

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!observation.trim()) return
    submit({ sessionId, observation: observation.trim() })
  }

  return (
    <form onSubmit={onSubmit}>
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
        disabled={state.isLoading}
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
      {state.error && (
        <div
          role="alert"
          style={{
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 12,
            color: 'var(--vt-risk-destructive)',
            marginBottom: 8,
          }}
        >
          {state.error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <LogButton
            type="submit"
            state={buttonState}
            freezeStage={state.stageIdx}
            stages={stages}
            disabled={state.isLoading || !observation.trim()}
            label="Log observation"
            variant="graphite"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="More options"
          disabled={state.isLoading}
        >
          <DotsThree size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
