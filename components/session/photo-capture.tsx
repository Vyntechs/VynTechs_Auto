'use client'

import { useRef, useState } from 'react'

type Props = {
  sessionId: string
  nodeId: string
  kind: 'photo' | 'scan_screen' | 'wiring_diagram'
  label?: string
  onUploaded: (artifactId: string) => void
}

export function PhotoCapture({ sessionId, nodeId, kind, label, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)
    setBusy(true)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      form.append('nodeId', nodeId)

      const res = await fetch(`/api/sessions/${sessionId}/capture`, {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Upload failed (${res.status})`)
        return
      }

      const { artifactId } = await res.json()
      onUploaded(artifactId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : (label ?? 'Take photo')}
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
