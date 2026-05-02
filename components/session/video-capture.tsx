'use client'

import { useId, useRef, useState } from 'react'
import { MAX_CAPTURE_BYTES } from '@/lib/sessions'

type Props = {
  sessionId: string
  nodeId: string
  maxSeconds?: number
  label?: string
  onUploaded: (artifactId: string) => void
}

export function VideoCapture({
  sessionId,
  nodeId,
  maxSeconds,
  label = 'Record short clip',
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // S2: stable unique id — safe if two VideoCaptures render simultaneously
  const _id = useId()
  const captionId = maxSeconds != null ? _id : undefined

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (busy) return
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_CAPTURE_BYTES) {
      setError('Clip too large (max 25 MB). Re-record a shorter clip.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    setError(null)
    setBusy(true)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', 'video')
      form.append('nodeId', nodeId)

      const res = await fetch(`/api/sessions/${sessionId}/capture`, {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }

      const { artifactId } = await res.json()
      onUploaded(artifactId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      {/* maxSeconds is advisory — the actual gate is the 25 MB size check */}
      {maxSeconds != null && (
        <p
          id={captionId}
          style={{
            marginBottom: 8,
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 12,
            color: 'var(--vt-fg-2)',
          }}
        >
          Keep clip under {maxSeconds} seconds (~25 MB)
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="environment"
        onChange={handleChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: '100%', minHeight: 48 }}
        disabled={busy}
        aria-describedby={captionId}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : label}
      </button>

      {error && (
        <p
          role="alert"
          style={{
            marginTop: 6,
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 12,
            color: 'var(--vt-risk-destructive)',
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
