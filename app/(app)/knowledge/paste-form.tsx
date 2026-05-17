'use client'
import { useState } from 'react'

type SimpleType = 'cause_fix' | 'reference_doc' | 'bulletin' | 'note'

type Proposal = {
  status: 'parsed' | 'failed'
  draft: {
    type?: SimpleType
    title?: string
    body?: string
    structuredData?: Record<string, unknown>
    dtcList?: string[]
    systemCodes?: string[]
    symptoms?: string[]
    vehicleScopes?: Array<{
      yearStart: number
      yearEnd: number
      make: string
      model?: string
      engine?: string
    }>
  }
}

const fieldRow: React.CSSProperties = { display: 'block', marginBottom: 12, fontSize: 14 }
const labelStyle: React.CSSProperties = { display: 'block', color: '#444', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 14,
}

export function KnowledgePasteForm() {
  const [rawText, setRawText] = useState('')
  const [scopeHint, setScopeHint] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  // form draft fields (owner edits the proposal here)
  const [editType, setEditType] = useState<SimpleType>('note')
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')

  async function handlePaste() {
    setLoading(true)
    setError(null)
    setSavedId(null)
    try {
      const res = await fetch('/api/knowledge/paste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText, scopeHint: scopeHint || undefined }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string }
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const result = (await res.json()) as Proposal
      setProposal(result)
      if (result.draft.type) setEditType(result.draft.type)
      if (result.draft.title) setEditTitle(result.draft.title)
      if (result.draft.body) setEditBody(result.draft.body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    setSavedId(null)
    try {
      const payload: Record<string, unknown> = {
        type: editType,
        title: editTitle,
      }
      if (editType === 'note' || editType === 'reference_doc') {
        payload.body = editBody
      } else if (proposal?.draft.structuredData) {
        payload.structuredData = proposal.draft.structuredData
      }
      if (proposal?.draft.dtcList) payload.dtcList = proposal.draft.dtcList
      if (proposal?.draft.systemCodes) payload.systemCodes = proposal.draft.systemCodes
      if (proposal?.draft.symptoms) payload.symptoms = proposal.draft.symptoms
      if (proposal?.draft.vehicleScopes) payload.vehicleScopes = proposal.draft.vehicleScopes

      const res = await fetch('/api/knowledge/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string }
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { id } = (await res.json()) as { id: string }
      setSavedId(id)
      setRawText('')
      setScopeHint('')
      setProposal(null)
      setEditTitle('')
      setEditBody('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <label style={fieldRow}>
        <span style={labelStyle}>Paste reference text</span>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={6}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="TSB 21-2299 — 6.7L Powerstroke alternator pulley..."
        />
      </label>
      <label style={fieldRow}>
        <span style={labelStyle}>Vehicle scope hint (optional)</span>
        <input
          type="text"
          value={scopeHint}
          onChange={(e) => setScopeHint(e.target.value)}
          style={inputStyle}
          placeholder="2018 F-250 6.7L Powerstroke"
        />
      </label>
      <button
        type="button"
        onClick={handlePaste}
        disabled={loading || rawText.trim().length === 0}
        style={{
          padding: '8px 16px',
          border: '1px solid #0070f3',
          background: loading ? '#cccccc' : '#0070f3',
          color: 'white',
          borderRadius: 4,
          fontSize: 14,
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Working...' : 'Get AI proposal'}
      </button>

      {proposal && (
        <div style={{ marginTop: 24, padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Review proposal</h2>
          <label style={fieldRow}>
            <span style={labelStyle}>Type</span>
            <select
              value={editType}
              onChange={(e) => setEditType(e.target.value as SimpleType)}
              style={inputStyle}
            >
              <option value="cause_fix">cause_fix</option>
              <option value="reference_doc">reference_doc</option>
              <option value="bulletin">bulletin</option>
              <option value="note">note</option>
            </select>
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Title</span>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={inputStyle}
            />
          </label>
          {(editType === 'note' || editType === 'reference_doc') && (
            <label style={fieldRow}>
              <span style={labelStyle}>Body</span>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={6}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </label>
          )}
          {proposal.draft.structuredData && (
            <pre
              style={{
                background: '#f6f6f6',
                padding: 8,
                borderRadius: 4,
                fontSize: 12,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(proposal.draft.structuredData, null, 2)}
            </pre>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || editTitle.trim().length === 0}
            style={{
              padding: '8px 16px',
              border: '1px solid #16a34a',
              background: loading ? '#cccccc' : '#16a34a',
              color: 'white',
              borderRadius: 4,
              fontSize: 14,
              cursor: loading ? 'wait' : 'pointer',
              marginTop: 8,
            }}
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      {savedId && (
        <p style={{ marginTop: 16, color: '#16a34a', fontSize: 14 }}>Saved (id: {savedId})</p>
      )}
      {error && (
        <p style={{ marginTop: 16, color: '#b00020', fontSize: 14 }}>Error: {error}</p>
      )}
    </div>
  )
}
