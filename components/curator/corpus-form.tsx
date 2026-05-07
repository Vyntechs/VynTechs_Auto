'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type CorpusFormPrefill = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine: string
  rootCause: string
  actionType: 'part_replacement' | 'repair' | 'adjustment' | 'cleaning' | 'no_fix' | 'referred'
  partInfo: { name?: string; oemNumber?: string; cost?: number } | null
  verification: { codesCleared: boolean; testDrive: boolean; symptomsResolved: 'yes' | 'no' | 'partial' }
  summary: string
}

const ACTION_TYPES: CorpusFormPrefill['actionType'][] = [
  'part_replacement', 'repair', 'adjustment', 'cleaning', 'no_fix', 'referred',
]

export function CorpusForm({
  prefill,
  fromQueueEntryId,
}: {
  prefill: CorpusFormPrefill | null
  fromQueueEntryId: string | null
}) {
  const router = useRouter()

  // primitive state for each field; CSV inputs for arrays; JSON textarea for freezeFramePattern
  const [vehicleYear, setVehicleYear] = useState(prefill?.vehicleYear?.toString() ?? '')
  const [vehicleMake, setVehicleMake] = useState(prefill?.vehicleMake ?? '')
  const [vehicleModel, setVehicleModel] = useState(prefill?.vehicleModel ?? '')
  const [vehicleEngine, setVehicleEngine] = useState(prefill?.vehicleEngine ?? '')
  const [symptomTags, setSymptomTags] = useState('')  // CSV
  const [dtcs, setDtcs] = useState('')  // CSV
  const [summary, setSummary] = useState(prefill?.summary ?? '')
  const [freezeFramePatternJson, setFreezeFramePatternJson] = useState('{}')
  const [rootCause, setRootCause] = useState(prefill?.rootCause ?? '')
  const [actionType, setActionType] = useState<CorpusFormPrefill['actionType']>(prefill?.actionType ?? 'repair')
  const [partName, setPartName] = useState(prefill?.partInfo?.name ?? '')
  const [partOem, setPartOem] = useState(prefill?.partInfo?.oemNumber ?? '')
  const [partCost, setPartCost] = useState(prefill?.partInfo?.cost?.toString() ?? '')
  const [codesCleared, setCodesCleared] = useState(prefill?.verification.codesCleared ?? false)
  const [testDrive, setTestDrive] = useState(prefill?.verification.testDrive ?? false)
  const [symptomsResolved, setSymptomsResolved] = useState<'yes' | 'no' | 'partial'>(
    prefill?.verification.symptomsResolved ?? 'partial',
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    let freezeFramePattern: Record<string, string | number>
    try {
      freezeFramePattern = freezeFramePatternJson.trim() === ''
        ? {}
        : JSON.parse(freezeFramePatternJson)
    } catch {
      setError('Freeze frame pattern must be valid JSON.')
      setSubmitting(false)
      return
    }

    const partInfo: { name?: string; oemNumber?: string; cost?: number } | null =
      partName.trim() === '' && partOem.trim() === '' && partCost.trim() === ''
        ? null
        : {
            ...(partName.trim() ? { name: partName.trim() } : {}),
            ...(partOem.trim() ? { oemNumber: partOem.trim() } : {}),
            ...(partCost.trim() && !Number.isNaN(Number(partCost)) ? { cost: Number(partCost) } : {}),
          }

    const yearNum = Number(vehicleYear)
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      setError('Vehicle year must be an integer between 1900 and 2100.')
      setSubmitting(false)
      return
    }

    const body = {
      input: {
        vehicleYear: yearNum,
        vehicleMake: vehicleMake.trim(),
        vehicleModel: vehicleModel.trim(),
        vehicleEngine: vehicleEngine.trim(),
        symptomTags: symptomTags.split(',').map(s => s.trim()).filter(Boolean),
        dtcs: dtcs.split(',').map(s => s.trim()).filter(Boolean),
        summary: summary.trim(),
        freezeFramePattern,
        rootCause: rootCause.trim(),
        actionType,
        partInfo,
        verification: { codesCleared, testDrive, symptomsResolved },
      },
      ...(fromQueueEntryId ? { fromQueueEntryId } : {}),
    }

    const res = await fetch('/api/curator/corpus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setSubmitting(false)

    if (!res.ok) {
      setError(`Failed to save corpus entry (${res.status}). Try again.`)
      return
    }

    router.push('/curator/corpus')
  }

  return (
    <form className="vt-corpus-form" onSubmit={handleSubmit}>
      {/* Vehicle */}
      <fieldset>
        <legend>Vehicle</legend>
        <label>Year <input type="number" required value={vehicleYear} onChange={e => setVehicleYear(e.target.value)} /></label>
        <label>Make <input type="text" required value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} /></label>
        <label>Model <input type="text" required value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} /></label>
        <label>Engine <input type="text" required value={vehicleEngine} onChange={e => setVehicleEngine(e.target.value)} /></label>
      </fieldset>

      {/* Symptoms */}
      <fieldset>
        <legend>Symptoms</legend>
        <label>Symptom tags (comma-separated) <input type="text" value={symptomTags} onChange={e => setSymptomTags(e.target.value)} /></label>
        <label>DTCs (comma-separated) <input type="text" value={dtcs} onChange={e => setDtcs(e.target.value)} /></label>
        <label>Summary (case narrative) <textarea required value={summary} onChange={e => setSummary(e.target.value)} /></label>
        <label>Freeze frame pattern (JSON) <textarea value={freezeFramePatternJson} onChange={e => setFreezeFramePatternJson(e.target.value)} /></label>
      </fieldset>

      {/* Root cause + action */}
      <fieldset>
        <legend>Resolution</legend>
        <label>Root cause <textarea required value={rootCause} onChange={e => setRootCause(e.target.value)} /></label>
        <label>Action type
          <select value={actionType} onChange={e => setActionType(e.target.value as typeof actionType)}>
            {ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Part name (optional) <input type="text" value={partName} onChange={e => setPartName(e.target.value)} /></label>
        <label>Part OEM number (optional) <input type="text" value={partOem} onChange={e => setPartOem(e.target.value)} /></label>
        <label>Part cost (optional) <input type="number" step="0.01" value={partCost} onChange={e => setPartCost(e.target.value)} /></label>
      </fieldset>

      {/* Verification */}
      <fieldset>
        <legend>Verification</legend>
        <label><input type="checkbox" checked={codesCleared} onChange={e => setCodesCleared(e.target.checked)} /> Codes cleared</label>
        <label><input type="checkbox" checked={testDrive} onChange={e => setTestDrive(e.target.checked)} /> Test drive done</label>
        <label>Symptoms resolved
          <select value={symptomsResolved} onChange={e => setSymptomsResolved(e.target.value as typeof symptomsResolved)}>
            <option value="yes">yes</option>
            <option value="partial">partial</option>
            <option value="no">no</option>
          </select>
        </label>
      </fieldset>

      {error && <p role="alert" className="vt-corpus-form-error">{error}</p>}

      <div className="vt-corpus-form-buttons">
        <button type="submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save corpus entry'}</button>
      </div>
    </form>
  )
}
