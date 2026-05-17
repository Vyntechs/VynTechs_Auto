'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import {
  ChipPicker,
  FieldGroup,
  ScopeEditor,
  TagInput,
  type Scope,
} from '@/components/knowledge/form-helpers'
import { ImageUpload } from '@/components/knowledge/image-upload'
import { SYSTEM_CODES } from '@/lib/knowledge/constants'

type Conn = {
  from_component: string
  from_pin?: string
  to_component: string
  to_pin?: string
  wire_color?: string
  splice_id?: string
  notes?: string
}

export function WiringForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as {
    name?: string
    image_ref?: string
    connections?: Conn[]
  }
  const [title, setTitle] = useState(existing?.title ?? '')
  const [name, setName] = useState(sd.name ?? '')
  const [imageRef, setImageRef] = useState<string>(sd.image_ref ?? '')
  const [connections, setConnections] = useState<Conn[]>(sd.connections ?? [])
  const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
  const [systemCodes, setSystemCodes] = useState<string[]>(existing?.systemCodes ?? [])
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? [])
  const [scopes, setScopes] = useState<Scope[]>(
    existing?.vehicleScopes.map((s) => ({
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model ?? undefined,
      engine: s.engine ?? undefined,
    })) ?? [{ yearStart: 2020, yearEnd: 2020, make: '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (busy) return
    if (!imageRef) {
      setError('Diagram image is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        type: 'wiring_diagram' as const,
        title,
        structuredData: {
          name: name || title,
          image_ref: imageRef,
          connections,
        },
        dtcList: dtcs,
        systemCodes,
        symptoms,
        vehicleScopes: scopes,
      }
      const url = existing ? `/api/knowledge/${existing.id}` : '/api/knowledge/save'
      const method = existing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const id = existing ? existing.id : ((await res.json()) as { id: string }).id
      router.push(`/knowledge?detail=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="vk-form"
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
      <FieldGroup label="Title" aiAttributed={false}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
        />
      </FieldGroup>
      <FieldGroup label="Diagram name" aiAttributed={false}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="defaults to title if blank"
        />
      </FieldGroup>
      <FieldGroup label="Diagram image (required)" aiAttributed={false}>
        <ImageUpload
          knowledgeType="wiring_diagram"
          value={imageRef}
          onChange={setImageRef}
        />
      </FieldGroup>

      <FieldGroup label="Vehicle scope" aiAttributed={false}>
        <ScopeEditor scopes={scopes} setScopes={setScopes} />
      </FieldGroup>
      <FieldGroup label="DTCs" aiAttributed={false}>
        <TagInput values={dtcs} setValues={setDtcs} placeholder="P0562" />
      </FieldGroup>
      <FieldGroup label="System codes" aiAttributed={false}>
        <ChipPicker
          values={systemCodes}
          options={[...SYSTEM_CODES]}
          setValues={setSystemCodes}
        />
      </FieldGroup>
      <FieldGroup label="Symptoms" aiAttributed={false}>
        <TagInput
          values={symptoms}
          setValues={setSymptoms}
          placeholder="battery_light_intermittent"
        />
      </FieldGroup>

      <FieldGroup label="Connections (optional)" aiAttributed={false}>
        <table className="vk-conntable">
          <thead>
            <tr>
              <th>From</th>
              <th>Pin</th>
              <th>To</th>
              <th>Pin</th>
              <th>Wire</th>
              <th>Splice</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={c.from_component}
                    onChange={(e) =>
                      setConnections(
                        connections.map((x, j) =>
                          j === i ? { ...x, from_component: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={c.from_pin ?? ''}
                    onChange={(e) =>
                      setConnections(
                        connections.map((x, j) =>
                          j === i ? { ...x, from_pin: e.target.value || undefined } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={c.to_component}
                    onChange={(e) =>
                      setConnections(
                        connections.map((x, j) =>
                          j === i ? { ...x, to_component: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={c.to_pin ?? ''}
                    onChange={(e) =>
                      setConnections(
                        connections.map((x, j) =>
                          j === i ? { ...x, to_pin: e.target.value || undefined } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={c.wire_color ?? ''}
                    onChange={(e) =>
                      setConnections(
                        connections.map((x, j) =>
                          j === i ? { ...x, wire_color: e.target.value || undefined } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={c.splice_id ?? ''}
                    onChange={(e) =>
                      setConnections(
                        connections.map((x, j) =>
                          j === i ? { ...x, splice_id: e.target.value || undefined } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={c.notes ?? ''}
                    onChange={(e) =>
                      setConnections(
                        connections.map((x, j) =>
                          j === i ? { ...x, notes: e.target.value || undefined } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => setConnections(connections.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="vk-btn vk-btn--ghost"
          onClick={() =>
            setConnections([...connections, { from_component: '', to_component: '' }])
          }
        >
          + Add connection
        </button>
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button
          type="button"
          className="vk-btn vk-btn--ghost"
          onClick={() => router.push('/knowledge')}
        >
          Cancel
        </button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
      </footer>
    </form>
  )
}
