'use client'
import { useRef, useState } from 'react'

const MAX_MB = 10

export function ImageUpload({
  knowledgeType,
  value,
  onChange,
}: {
  knowledgeType: 'connector' | 'wiring_diagram'
  value: string
  onChange: (storageKey: string) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(
        `That's ${(file.size / 1024 / 1024).toFixed(1)} MB — pick something under ${MAX_MB} MB.`,
      )
      return
    }
    if (!/^image\/(jpeg|png|svg\+xml)$/.test(file.type)) {
      setError(`Unsupported format ${file.type}. JPG, PNG, or SVG only.`)
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('knowledgeType', knowledgeType)
      const res = await fetch('/api/knowledge/upload-image', { method: 'POST', body: form })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { storageKey, signedUrl: newSigned } = (await res.json()) as {
        storageKey: string
        signedUrl: string | null
      }
      setSignedUrl(newSigned)
      onChange(storageKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setBusy(false)
    }
  }

  if (value) {
    return (
      <div className="vk-imgupload vk-imgupload--filled">
        {signedUrl ? (
          <img src={signedUrl} alt="" />
        ) : (
          <div className="vk-imgupload__placeholder">
            Image attached · key {value.slice(0, 24)}{value.length > 24 ? '…' : ''}
          </div>
        )}
        <div className="vk-imgupload__meta">
          <button
            type="button"
            className="vk-btn vk-btn--ghost"
            onClick={() => fileInput.current?.click()}
          >
            Replace
          </button>
          <button
            type="button"
            className="vk-btn vk-btn--ghost"
            onClick={() => {
              onChange('')
              setSignedUrl(null)
            }}
          >
            Remove
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
          }}
        />
      </div>
    )
  }

  return (
    <label className="vk-imgupload vk-imgupload--empty">
      <input
        type="file"
        accept="image/jpeg,image/png,image/svg+xml"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
        }}
      />
      <span className="vk-imgupload__prompt">
        {busy ? 'Uploading…' : 'Drop the image, or click to pick.'}
      </span>
      <span className="vk-imgupload__hint">
        JPG · PNG · SVG · ≤ {MAX_MB} MB
      </span>
      {error && <span className="vk-imgupload__error">{error}</span>}
    </label>
  )
}
