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

export function ConnectorForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as Record<string, string>
  const [title, setTitle] = useState(existing?.title ?? '')
  const [connectorId, setConnectorId] = useState(sd.connector_id ?? '')
  const [componentName, setComponentName] = useState(sd.component_name ?? '')
  const [location, setLocation] = useState(sd.location_description ?? '')
  const [imageRef, setImageRef] = useState<string>(sd.image_ref ?? '')
  const [matingImageRef, setMatingImageRef] = useState<string>(
    sd.mating_end_image_ref ?? '',
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

  async function handleSave() {
    if (busy) return
    if (!imageRef) {
      setError('In-place image is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = {
        type: 'connector' as const,
        title,
        structuredData: {
          connector_id: connectorId,
          component_name: componentName,
          location_description: location || undefined,
          image_ref: imageRef,
          mating_end_image_ref: matingImageRef || undefined,
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
      <FieldGroup label="Connector ID" aiAttributed={false}>
        <input
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          required
          maxLength={60}
        />
      </FieldGroup>
      <FieldGroup label="Component" aiAttributed={false}>
        <input
          value={componentName}
          onChange={(e) => setComponentName(e.target.value)}
          required
          maxLength={120}
        />
      </FieldGroup>
      <FieldGroup label="Location" aiAttributed={false}>
        <textarea
          rows={3}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={2_000}
        />
      </FieldGroup>

      <FieldGroup label="In-place image (required)" aiAttributed={false}>
        <ImageUpload knowledgeType="connector" value={imageRef} onChange={setImageRef} />
      </FieldGroup>
      <FieldGroup label="Mating end image (optional)" aiAttributed={false}>
        <ImageUpload
          knowledgeType="connector"
          value={matingImageRef}
          onChange={setMatingImageRef}
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
