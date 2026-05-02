'use client'

import { useEffect, useRef, useState } from 'react'

const MIME = 'audio/webm;codecs=opus'

type Props = {
  sessionId: string
  nodeId: string
  prompt?: string
  maxSeconds?: number
  onUploaded: (artifactId: string) => void
}

export function AudioCapture({
  sessionId,
  nodeId,
  prompt,
  maxSeconds = 30,
  onUploaded,
}: Props) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)

  const [recording, setRecording]   = useState(false)
  const [elapsed, setElapsed]       = useState(0)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Live elapsed-seconds counter while recording
  useEffect(() => {
    if (!recording) { setElapsed(0); return }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [recording])

  async function upload() {
    setBusy(true)
    try {
      const blob = new Blob(chunksRef.current, { type: MIME })
      const fd = new FormData()
      fd.append('file', blob, 'audio.webm')
      fd.append('kind', 'audio')
      fd.append('nodeId', nodeId)
      fd.append('durationMs', String(Date.now() - startedAtRef.current))

      const res = await fetch(`/api/sessions/${sessionId}/capture`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error(await res.text())

      const { artifactId } = await res.json()
      onUploaded(artifactId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  function stop() {
    // Set null first so a second rapid call is a no-op
    const rec = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    rec?.stop()
  }

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported(MIME) ? MIME : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType })

      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        await upload()
      }

      rec.start()
      recorderRef.current = rec
      startedAtRef.current = Date.now()
      setRecording(true)

      setTimeout(() => {
        if (recorderRef.current?.state === 'recording') stop()
      }, maxSeconds * 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone unavailable')
    }
  }

  const promptId = prompt ? 'audio-capture-prompt' : undefined

  return (
    <div>
      {prompt && (
        <p
          id={promptId}
          style={{
            marginBottom: 8,
            fontFamily: 'var(--vt-font-sans)',
            fontSize: 12,
            color: 'var(--vt-fg-2)',
          }}
        >
          {prompt}
        </p>
      )}

      {!recording ? (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%', minHeight: 48 }}
          disabled={busy}
          aria-describedby={promptId}
          onClick={start}
        >
          {busy ? 'Uploading…' : 'Record audio'}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          style={{
            width: '100%',
            minHeight: 48,
            background: 'var(--vt-amber-600)',
          }}
          aria-describedby={promptId}
          onClick={stop}
        >
          Stop ({elapsed}s)
        </button>
      )}

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
