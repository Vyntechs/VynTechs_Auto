'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type LogButtonStage = { label: string; ms: number }

// Fallback narration, used only when the server hasn't streamed real stage
// updates yet. A single honest label — never a fabricated sequence of work
// ("parsing photo · 3 frames", "re-scoring confidence") that may not be
// happening. Real server-streamed stages narrate the actual work.
export const DEFAULT_STAGES: LogButtonStage[] = [
  { label: 'Logging…', ms: 800 },
]

export type LogButtonState = 'idle' | 'loading' | 'done'
export type LogButtonVariant = 'graphite' | 'amber' | 'paper'

export type LogButtonProps = {
  stages?: LogButtonStage[]
  state?: LogButtonState
  freezeStage?: number | null
  variant?: LogButtonVariant
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  label?: string
  type?: 'button' | 'submit'
  disabled?: boolean
}

export function LogButton({
  stages = DEFAULT_STAGES,
  state = 'idle',
  freezeStage = null,
  variant = 'graphite',
  onClick,
  label = 'Log observation',
  type = 'button',
  disabled = false,
}: LogButtonProps) {
  const [stageIdx, setStageIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  const totalMs = useMemo(
    () => stages.reduce((a, s) => a + s.ms, 0),
    [stages],
  )

  useEffect(() => {
    if (state !== 'loading' || freezeStage != null) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      startedAtRef.current = null
      return
    }
    startedAtRef.current = performance.now()
    const tick = (now: number) => {
      const start = startedAtRef.current ?? now
      const elapsed = (now - start) % totalMs
      let acc = 0
      let idx = 0
      for (let i = 0; i < stages.length; i++) {
        if (elapsed < acc + stages[i].ms) {
          idx = i
          break
        }
        acc += stages[i].ms
      }
      setStageIdx(idx)
      setProgress(elapsed / totalMs)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [state, freezeStage, totalMs, stages])

  useEffect(() => {
    if (freezeStage != null) {
      const idx = Math.max(0, Math.min(stages.length - 1, freezeStage))
      setStageIdx(idx)
      let acc = 0
      for (let i = 0; i <= idx; i++) acc += stages[i].ms
      setProgress(Math.min(1, acc / totalMs))
    }
  }, [freezeStage, totalMs, stages])

  const isLoading = state === 'loading'
  const isDone = state === 'done'
  const currentStage = stages[stageIdx]

  return (
    <button
      type={type}
      className={`lb lb--${variant} ${isLoading ? 'is-loading' : ''} ${
        isDone ? 'is-done' : ''
      }`}
      onClick={onClick}
      disabled={disabled}
      aria-live="polite"
      aria-busy={isLoading}
    >
      <span className="lb__shimmer" aria-hidden="true"></span>

      <span className="lb__progress" aria-hidden="true">
        <span
          className="lb__progress-fill"
          style={{ transform: `scaleX(${progress})` }}
        ></span>
      </span>

      <span className="lb__content">
        <span
          className={`lb__face lb__face--idle ${
            isLoading || isDone ? 'is-out' : ''
          }`}
        >
          <span className="lb__label">{label}</span>
          <span className="lb__chevron" aria-hidden="true">
            <svg
              viewBox="0 0 12 12"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                d="M3.5 3 L8 6 L3.5 9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>

        {isDone && (
          <span className="lb__face lb__face--done">
            <span className="lb__check" aria-hidden="true">
              <svg
                viewBox="0 0 14 14"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path
                  d="M3 7.5 L6 10.2 L11 4.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="lb__label">Logged · advancing</span>
          </span>
        )}

        {isLoading && (
          <span className="lb__face lb__face--loading" key={stageIdx}>
            <span className="lb__dot" aria-hidden="true"></span>
            <span className="lb__narration">
              <span className="lb__narration-text">{currentStage.label}</span>
              <span className="lb__narration-dots" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </span>
            <span className="lb__counter" aria-hidden="true">
              <span className="lb__counter-num">
                {String(stageIdx + 1).padStart(2, '0')}
              </span>
              <span className="lb__counter-sep">/</span>
              <span className="lb__counter-tot">
                {String(stages.length).padStart(2, '0')}
              </span>
            </span>
          </span>
        )}
      </span>
    </button>
  )
}
