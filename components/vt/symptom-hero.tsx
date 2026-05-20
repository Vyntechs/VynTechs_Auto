import { ConfidenceGate } from './confidence-gate'

export function SymptomHero({
  dtc,
  name,
  gate,
  priorFixCount,
}: {
  dtc: string | null
  name: string
  gate: number
  priorFixCount: number
}) {
  return (
    <div className="cov-symptom">
      <div className="cov-symptom__eyebrow">
        <span>Matched symptom</span>
        {dtc && <span className="cov-symptom__dtc">{dtc}</span>}
      </div>
      <h1 className="cov-symptom__name">{name}</h1>
      {priorFixCount > 0 && (
        <div className="cov-symptom__meta">
          <span>
            {priorFixCount} prior {priorFixCount === 1 ? 'fix' : 'fixes'} · cross-shop corpus
          </span>
        </div>
      )}
      <ConfidenceGate gate={gate} />
    </div>
  )
}
