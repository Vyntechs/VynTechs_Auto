'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CuratorCorpusInput } from '@/lib/curator/corpus-actions'

const ACTION_TYPES: CuratorCorpusInput['actionType'][] = [
  'part_replacement',
  'repair',
  'adjustment',
  'cleaning',
  'no_fix',
  'referred',
]

type Verification = CuratorCorpusInput['verification']

export function FounderNoteReviewForm({
  noteId,
  draft,
}: {
  noteId: string
  draft: Partial<CuratorCorpusInput>
}) {
  const router = useRouter()

  const [vehicleYear, setVehicleYear] = useState(draft.vehicleYear?.toString() ?? '')
  const [vehicleMake, setVehicleMake] = useState(draft.vehicleMake ?? '')
  const [vehicleModel, setVehicleModel] = useState(draft.vehicleModel ?? '')
  const [vehicleEngine, setVehicleEngine] = useState(draft.vehicleEngine ?? '')
  const [symptomTags, setSymptomTags] = useState((draft.symptomTags ?? []).join(', '))
  const [dtcs, setDtcs] = useState((draft.dtcs ?? []).join(', '))
  const [summary, setSummary] = useState(draft.summary ?? '')
  const [rootCause, setRootCause] = useState(draft.rootCause ?? '')
  const [actionType, setActionType] = useState<CuratorCorpusInput['actionType']>(
    draft.actionType ?? 'repair',
  )
  const [partName, setPartName] = useState(draft.partInfo?.name ?? '')
  const [partOem, setPartOem] = useState(draft.partInfo?.oemNumber ?? '')
  const [partCost, setPartCost] = useState(
    draft.partInfo?.cost !== undefined ? String(draft.partInfo.cost) : '',
  )
  const [verification, setVerification] = useState<Verification>(
    draft.verification ?? { codesCleared: false, testDrive: false, symptomsResolved: 'partial' },
  )
  const [dismissNote, setDismissNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePromote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    const yearNum = Number(vehicleYear)
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      setError('Vehicle year must be an integer between 1900 and 2100.')
      setSubmitting(false)
      return
    }

    const partInfo: { name?: string; oemNumber?: string; cost?: number } | null =
      partName.trim() === '' && partOem.trim() === '' && partCost.trim() === ''
        ? null
        : {
            ...(partName.trim() ? { name: partName.trim() } : {}),
            ...(partOem.trim() ? { oemNumber: partOem.trim() } : {}),
            ...(partCost.trim() && !Number.isNaN(Number(partCost))
              ? { cost: Number(partCost) }
              : {}),
          }

    const body = {
      input: {
        vehicleYear: yearNum,
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleEngine: vehicleEngine.trim(),
        symptomTags: symptomTags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        dtcs: dtcs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        summary: summary.trim(),
        freezeFramePattern: {},
        rootCause: rootCause.trim(),
        actionType,
        partInfo,
        verification,
      },
    }

    const res = await fetch(`/api/founder-notes/${noteId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setSubmitting(false)
    if (!res.ok) {
      setError(`Promote failed (${res.status}).`)
      return
    }

    router.push('/curator/founder-notes')
    router.refresh()
  }

  async function handleDismiss() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    const res = await fetch(`/api/founder-notes/${noteId}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: dismissNote.trim() || null }),
    })
    setSubmitting(false)
    if (!res.ok) {
      setError(`Dismiss failed (${res.status}).`)
      return
    }
    router.push('/curator/founder-notes')
    router.refresh()
  }

  return (
    <form className="vt-founder-note-review-form" onSubmit={handlePromote}>
      <fieldset>
        <legend>Vehicle</legend>
        <label>
          Year
          <input
            type="number"
            required
            value={vehicleYear}
            onChange={(e) => setVehicleYear(e.target.value)}
          />
        </label>
        <label>
          Make
          <input
            type="text"
            required
            value={vehicleMake}
            onChange={(e) => setVehicleMake(e.target.value)}
          />
        </label>
        <label>
          Model
          <input
            type="text"
            required
            value={vehicleModel}
            onChange={(e) => setVehicleModel(e.target.value)}
          />
        </label>
        <label>
          Engine
          <input
            type="text"
            required
            value={vehicleEngine}
            onChange={(e) => setVehicleEngine(e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Symptoms</legend>
        <label>
          Symptom tags (comma-separated)
          <input
            type="text"
            value={symptomTags}
            onChange={(e) => setSymptomTags(e.target.value)}
          />
        </label>
        <label>
          DTCs (comma-separated)
          <input type="text" value={dtcs} onChange={(e) => setDtcs(e.target.value)} />
        </label>
        <label>
          Summary
          <textarea required value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Resolution</legend>
        <label>
          Root cause
          <textarea
            required
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
          />
        </label>
        <label>
          Action type
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value as CuratorCorpusInput['actionType'])}
          >
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Part name (optional)
          <input type="text" value={partName} onChange={(e) => setPartName(e.target.value)} />
        </label>
        <label>
          Part OEM number (optional)
          <input type="text" value={partOem} onChange={(e) => setPartOem(e.target.value)} />
        </label>
        <label>
          Part cost (optional)
          <input
            type="number"
            step="0.01"
            value={partCost}
            onChange={(e) => setPartCost(e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Verification</legend>
        <label>
          <input
            type="checkbox"
            checked={verification.codesCleared}
            onChange={(e) => setVerification({ ...verification, codesCleared: e.target.checked })}
          />
          Codes cleared
        </label>
        <label>
          <input
            type="checkbox"
            checked={verification.testDrive}
            onChange={(e) => setVerification({ ...verification, testDrive: e.target.checked })}
          />
          Test drive done
        </label>
        <label>
          Symptoms resolved
          <select
            value={verification.symptomsResolved}
            onChange={(e) =>
              setVerification({
                ...verification,
                symptomsResolved: e.target.value as Verification['symptomsResolved'],
              })
            }
          >
            <option value="yes">yes</option>
            <option value="partial">partial</option>
            <option value="no">no</option>
          </select>
        </label>
      </fieldset>

      {error && (
        <p role="alert" className="vt-founder-note-review-error">
          {error}
        </p>
      )}

      <div className="vt-founder-note-review-buttons">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Promote to corpus'}
        </button>
      </div>

      <fieldset className="vt-founder-note-dismiss-block">
        <legend>Or dismiss</legend>
        <label>
          Reason (optional)
          <input
            type="text"
            value={dismissNote}
            onChange={(e) => setDismissNote(e.target.value)}
          />
        </label>
        <button type="button" onClick={handleDismiss} disabled={submitting}>
          Dismiss note
        </button>
      </fieldset>
    </form>
  )
}
