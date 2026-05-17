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
import { SYSTEM_CODES } from '@/lib/knowledge/constants'

type Pin = {
  pin_number: string
  signal_name: string
  wire_color?: string
  expected_voltage_or_waveform?: string
  notes?: string
}

export function PinoutForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as {
    connector_ref?: string
    pins?: Pin[]
  }

  const [title, setTitle] = useState(existing?.title ?? '')
  const [connectorRef, setConnectorRef] = useState(sd.connector_ref ?? '')
  const [pins, setPins] = useState<Pin[]>(
    sd.pins ?? [{ pin_number: '1', signal_name: '' }],
  )
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

  const duplicatePin = pins.length !== new Set(pins.map((p) => p.pin_number)).size

  async function handleSave() {
    if (busy) return
    if (duplicatePin) {
      setError('duplicate pin numbers')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        type: 'pinout' as const,
        title,
        structuredData: { connector_ref: connectorRef, pins },
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
      <FieldGroup label="Connector ref" aiAttributed={false}>
        <input
          value={connectorRef}
          onChange={(e) => setConnectorRef(e.target.value)}
          required
          maxLength={120}
          placeholder="C171 or component name"
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

      <FieldGroup label="Pin table" aiAttributed={false}>
        <table className="vk-pintable">
          <thead>
            <tr>
              <th>Pin</th>
              <th>Signal</th>
              <th>Wire</th>
              <th>Expected</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pins.map((p, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={p.pin_number}
                    onChange={(e) =>
                      setPins(
                        pins.map((x, j) =>
                          j === i ? { ...x, pin_number: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={p.signal_name}
                    onChange={(e) =>
                      setPins(
                        pins.map((x, j) =>
                          j === i ? { ...x, signal_name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={p.wire_color ?? ''}
                    onChange={(e) =>
                      setPins(
                        pins.map((x, j) =>
                          j === i ? { ...x, wire_color: e.target.value || undefined } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={p.expected_voltage_or_waveform ?? ''}
                    onChange={(e) =>
                      setPins(
                        pins.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                expected_voltage_or_waveform: e.target.value || undefined,
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    value={p.notes ?? ''}
                    onChange={(e) =>
                      setPins(
                        pins.map((x, j) =>
                          j === i ? { ...x, notes: e.target.value || undefined } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => setPins(pins.filter((_, j) => j !== i))}
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
            setPins([...pins, { pin_number: String(pins.length + 1), signal_name: '' }])
          }
        >
          + Add pin
        </button>
        {duplicatePin && <div className="vk-form__error">Duplicate pin numbers</div>}
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
        <button
          type="submit"
          className="vk-btn vk-btn--primary"
          disabled={busy || duplicatePin}
        >
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
      </footer>
    </form>
  )
}
