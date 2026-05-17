'use client'
import { useState } from 'react'

type RichType = 'pinout' | 'connector' | 'wiring_diagram' | 'theory_of_operation'

type PinRow = {
  pin_number: string
  signal_name: string
  wire_color?: string
  expected_voltage_or_waveform?: string
  notes?: string
}

type TheorySection = { heading: string; body: string }

type WiringConnection = {
  from_component: string
  from_pin?: string
  to_component: string
  to_pin?: string
  wire_color?: string
  splice_id?: string
  notes?: string
}

const fieldRow: React.CSSProperties = { display: 'block', marginBottom: 12, fontSize: 14 }
const labelStyle: React.CSSProperties = { display: 'block', color: '#444', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 14,
  boxSizing: 'border-box',
}
const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #0070f3',
  background: '#0070f3',
  color: 'white',
  borderRadius: 4,
  fontSize: 14,
  cursor: 'pointer',
}
const saveButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: '1px solid #16a34a',
  background: '#16a34a',
}

export function RichKnowledgeForm() {
  const [type, setType] = useState<RichType>('pinout')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  // Pinout state
  const [pinoutConnectorRef, setPinoutConnectorRef] = useState('')
  const [pinoutPasteText, setPinoutPasteText] = useState('')
  const [pinoutPins, setPinoutPins] = useState<PinRow[]>([{ pin_number: '', signal_name: '' }])

  // Connector state
  const [connectorId, setConnectorId] = useState('')
  const [connectorComponentName, setConnectorComponentName] = useState('')
  const [connectorLocation, setConnectorLocation] = useState('')
  const [connectorImageKey, setConnectorImageKey] = useState('')
  const [connectorMatingImageKey, setConnectorMatingImageKey] = useState('')

  // Wiring diagram state
  const [wiringName, setWiringName] = useState('')
  const [wiringImageKey, setWiringImageKey] = useState('')
  const [wiringConnections] = useState<WiringConnection[]>([])

  // Theory state
  const [theoryTitle, setTheoryTitle] = useState('')
  const [theoryPasteText, setTheoryPasteText] = useState('')
  const [theorySections, setTheorySections] = useState<TheorySection[]>([{ heading: '', body: '' }])

  async function handleParsePinout() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/knowledge/parse-pinout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rawText: pinoutPasteText,
          connectorHint: pinoutConnectorRef || undefined,
        }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string }
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { draft } = (await res.json()) as {
        draft: { connector_ref?: string; pins: PinRow[] }
      }
      if (draft.connector_ref && !pinoutConnectorRef) setPinoutConnectorRef(draft.connector_ref)
      if (draft.pins?.length) setPinoutPins(draft.pins)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI assist failed — fill the table manually.')
    } finally {
      setLoading(false)
    }
  }

  async function handleParseTheory() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/knowledge/parse-theory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rawText: theoryPasteText,
          titleHint: theoryTitle || title || undefined,
        }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string }
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { draft } = (await res.json()) as {
        draft: { title?: string; sections: TheorySection[] }
      }
      if (draft.title && !theoryTitle) setTheoryTitle(draft.title)
      if (draft.sections?.length) setTheorySections(draft.sections)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI assist failed — fill the sections manually.')
    } finally {
      setLoading(false)
    }
  }

  async function handleImageUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    setKey: (s: string) => void,
    knowledgeType: 'connector' | 'wiring_diagram',
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('knowledgeType', knowledgeType)
      form.append('file', file)
      const res = await fetch('/api/knowledge/upload-image', { method: 'POST', body: form })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string; reason?: string }
        throw new Error(j.message || j.reason || j.error || `HTTP ${res.status}`)
      }
      const { storageKey } = (await res.json()) as { storageKey: string }
      setKey(storageKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    setSavedId(null)
    try {
      let structuredData: Record<string, unknown>
      if (type === 'pinout') {
        structuredData = {
          connector_ref: pinoutConnectorRef,
          pins: pinoutPins.filter((p) => p.pin_number.trim() && p.signal_name.trim()),
        }
      } else if (type === 'connector') {
        structuredData = {
          connector_id: connectorId,
          component_name: connectorComponentName,
          ...(connectorLocation ? { location_description: connectorLocation } : {}),
          ...(connectorImageKey ? { image_ref: connectorImageKey } : {}),
          ...(connectorMatingImageKey ? { mating_end_image_ref: connectorMatingImageKey } : {}),
        }
      } else if (type === 'wiring_diagram') {
        structuredData = {
          name: wiringName,
          image_ref: wiringImageKey,
          ...(wiringConnections.length > 0 ? { connections: wiringConnections } : {}),
        }
      } else {
        structuredData = {
          title: theoryTitle || title,
          sections: theorySections.filter((s) => s.heading.trim() && s.body.trim()),
        }
      }

      const res = await fetch('/api/knowledge/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, title, structuredData }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string; issues?: unknown[] }
        throw new Error(j.message || JSON.stringify(j.issues ?? j.error) || `HTTP ${res.status}`)
      }
      const { id } = (await res.json()) as { id: string }
      setSavedId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 32, padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Rich knowledge type (preview)</h2>

      <label style={fieldRow}>
        <span style={labelStyle}>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as RichType)} style={inputStyle}>
          <option value="pinout">pinout</option>
          <option value="connector">connector</option>
          <option value="wiring_diagram">wiring_diagram</option>
          <option value="theory_of_operation">theory_of_operation</option>
        </select>
      </label>

      <label style={fieldRow}>
        <span style={labelStyle}>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
          placeholder="e.g. Alternator 4-pin pinout — 6.7L Powerstroke"
        />
      </label>

      {type === 'pinout' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Connector reference</span>
            <input
              type="text"
              value={pinoutConnectorRef}
              onChange={(e) => setPinoutConnectorRef(e.target.value)}
              style={inputStyle}
              placeholder="e.g. C2280, Alternator 4-pin"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Paste OEM pinout text (AI assist)</span>
            <textarea
              value={pinoutPasteText}
              onChange={(e) => setPinoutPasteText(e.target.value)}
              rows={5}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder={'1  RED  12V SUPPLY\n2  BLK  GROUND\n3  GRN/WHT  LIN BUS\n4  YEL  IGNITION ENABLE'}
            />
          </label>
          <button
            type="button"
            onClick={handleParsePinout}
            disabled={loading || pinoutPasteText.trim().length === 0}
            style={buttonStyle}
          >
            {loading ? 'Parsing…' : 'Parse with AI'}
          </button>

          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 8px' }}>Pins</h3>
          {pinoutPins.map((pin, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={pin.pin_number}
                onChange={(e) => {
                  const next = [...pinoutPins]
                  next[i] = { ...next[i], pin_number: e.target.value }
                  setPinoutPins(next)
                }}
                placeholder="Pin #"
                style={{ ...inputStyle, width: 80, flex: '0 0 80px' }}
              />
              <input
                type="text"
                value={pin.signal_name}
                onChange={(e) => {
                  const next = [...pinoutPins]
                  next[i] = { ...next[i], signal_name: e.target.value }
                  setPinoutPins(next)
                }}
                placeholder="Signal"
                style={{ ...inputStyle, flex: '1 1 140px', minWidth: 0 }}
              />
              <input
                type="text"
                value={pin.wire_color ?? ''}
                onChange={(e) => {
                  const next = [...pinoutPins]
                  next[i] = { ...next[i], wire_color: e.target.value || undefined }
                  setPinoutPins(next)
                }}
                placeholder="Color"
                style={{ ...inputStyle, width: 100, flex: '0 0 100px' }}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPinoutPins([...pinoutPins, { pin_number: '', signal_name: '' }])}
            style={{ ...buttonStyle, background: '#666', border: '1px solid #666', marginTop: 8 }}
          >
            Add pin row
          </button>
        </>
      )}

      {type === 'connector' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Connector OEM ID</span>
            <input type="text" value={connectorId} onChange={(e) => setConnectorId(e.target.value)} style={inputStyle} placeholder="e.g. C2280" />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Component name</span>
            <input
              type="text"
              value={connectorComponentName}
              onChange={(e) => setConnectorComponentName(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Body Control Module"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Location description</span>
            <textarea
              value={connectorLocation}
              onChange={(e) => setConnectorLocation(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="e.g. Behind driver kick panel"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Connector image (JPG/PNG/SVG, max 10MB)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/svg+xml"
              onChange={(e) => handleImageUpload(e, setConnectorImageKey, 'connector')}
              style={inputStyle}
            />
            {connectorImageKey && (
              <small style={{ display: 'block', marginTop: 4, color: '#16a34a' }}>
                Uploaded: {connectorImageKey}
              </small>
            )}
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Mating end image (optional)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/svg+xml"
              onChange={(e) => handleImageUpload(e, setConnectorMatingImageKey, 'connector')}
              style={inputStyle}
            />
            {connectorMatingImageKey && (
              <small style={{ display: 'block', marginTop: 4, color: '#16a34a' }}>
                Uploaded: {connectorMatingImageKey}
              </small>
            )}
          </label>
        </>
      )}

      {type === 'wiring_diagram' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Diagram name</span>
            <input
              type="text"
              value={wiringName}
              onChange={(e) => setWiringName(e.target.value)}
              style={inputStyle}
              placeholder="e.g. BCM to Alternator charging circuit"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Diagram image (JPG/PNG/SVG, max 10MB) — required</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/svg+xml"
              onChange={(e) => handleImageUpload(e, setWiringImageKey, 'wiring_diagram')}
              style={inputStyle}
            />
            {wiringImageKey && (
              <small style={{ display: 'block', marginTop: 4, color: '#16a34a' }}>
                Uploaded: {wiringImageKey}
              </small>
            )}
          </label>
          <p style={{ fontSize: 12, color: '#666' }}>
            Structured connections list is optional in v1 — image-only diagrams are valid.
          </p>
        </>
      )}

      {type === 'theory_of_operation' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Document title</span>
            <input
              type="text"
              value={theoryTitle}
              onChange={(e) => setTheoryTitle(e.target.value)}
              style={inputStyle}
              placeholder="e.g. 6.7L Powerstroke Charging System"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Paste OEM theory text (AI assist)</span>
            <textarea
              value={theoryPasteText}
              onChange={(e) => setTheoryPasteText(e.target.value)}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="SYSTEM DESCRIPTION&#10;The 6.7L uses a smart alternator controlled via LIN bus..."
            />
          </label>
          <button
            type="button"
            onClick={handleParseTheory}
            disabled={loading || theoryPasteText.trim().length === 0}
            style={buttonStyle}
          >
            {loading ? 'Parsing…' : 'Parse with AI'}
          </button>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 8px' }}>Sections</h3>
          {theorySections.map((sec, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <input
                type="text"
                value={sec.heading}
                onChange={(e) => {
                  const next = [...theorySections]
                  next[i] = { ...next[i], heading: e.target.value }
                  setTheorySections(next)
                }}
                placeholder="Section heading"
                style={inputStyle}
              />
              <textarea
                value={sec.body}
                onChange={(e) => {
                  const next = [...theorySections]
                  next[i] = { ...next[i], body: e.target.value }
                  setTheorySections(next)
                }}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', marginTop: 4 }}
                placeholder="Section body"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTheorySections([...theorySections, { heading: '', body: '' }])}
            style={{ ...buttonStyle, background: '#666', border: '1px solid #666' }}
          >
            Add section
          </button>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || title.trim().length === 0}
          style={saveButtonStyle}
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>

      {savedId && (
        <p style={{ marginTop: 12, color: '#16a34a', fontSize: 14 }}>Saved (id: {savedId})</p>
      )}
      {error && (
        <p style={{ marginTop: 12, color: '#b00020', fontSize: 14 }}>Error: {error}</p>
      )}
    </div>
  )
}
