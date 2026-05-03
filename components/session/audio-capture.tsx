'use client'

import { useEffect, useId, useRef, useState } from 'react'

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
  const streamRef = useRef<MediaStream | null>(null)
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mimeTypeRef = useRef<string>(MIME)

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

  // C1: Stop recorder, stream, and timer on unmount
  useEffect(() => {
    return () => {
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current)
        autoStopTimerRef.current = null
      }
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        try { rec.stop() } catch {}
      }
      recorderRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  async function upload() {
    setBusy(true)
    // I2a: guard against zero-byte recording
    if (chunksRef.current.length === 0) {
      setError('Recording was too short — please try again')
      setBusy(false)
      return
    }
    try {
      // I3: use the actual recorded mime type, not the hardcoded constant
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current })
      const fd = new FormData()
      fd.append('file', blob, 'audio.webm')
      fd.append('kind', 'audio')
      fd.append('nodeId', nodeId)
      fd.append('durationMs', String(Date.now() - startedAtRef.current))

      const res = await fetch(`/api/sessions/${sessionId}/capture`, {
        method: 'POST',
        body: fd,
      })
      // I2b: JSON-aware error display (matches photo-capture pattern)
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
    }
  }

  function stop() {
    // I1: clear auto-stop timer before it fires a redundant stop()
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
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
      streamRef.current = stream

      const isTypeSupported = MediaRecorder.isTypeSupported(MIME)
      const mimeType = isTypeSupported ? MIME : 'audio/webm'
      mimeTypeRef.current = mimeType

      const rec = new MediaRecorder(stream, { mimeType })

      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        // Use ref so unmount/error cleanup paths that already stopped tracks don't double-stop
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        await upload()
      }
      // C2: surface MediaRecorder hardware/permission errors
      rec.onerror = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recorderRef.current = null
        if (autoStopTimerRef.current) {
          clearTimeout(autoStopTimerRef.current)
          autoStopTimerRef.current = null
        }
        setRecording(false)
        setError('Recording failed')
      }

      rec.start()
      recorderRef.current = rec
      startedAtRef.current = Date.now()
      setRecording(true)

      autoStopTimerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') stop()
      }, maxSeconds * 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone unavailable')
    }
  }

  // S2: stable, unique id — safe if two AudioCaptures render simultaneously
  const _id = useId()
  const promptId = prompt ? _id : undefined

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
            background: 'var(--vt-signal-600)',
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
