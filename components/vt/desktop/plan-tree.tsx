export type PlanStep = {
  n: string
  title: string
  detail?: string
  meta?: string
  conf?: number
  auth?: boolean
}

export type PlanTreeVariant = 'editable' | 'readonly'

const DEFAULT_GATE = 70
const LOW_BAND = 10

function classifyStep(conf: number | undefined, gate: number): '' | 'gating' | 'low' {
  if (conf === undefined) return ''
  if (conf < gate) return 'gating'
  if (conf < gate + LOW_BAND) return 'low'
  return ''
}

export function PlanTree({
  steps,
  variant = 'editable',
  gate = DEFAULT_GATE,
  title = 'Confidence-weighted plan',
}: {
  steps: PlanStep[]
  variant?: PlanTreeVariant
  gate?: number
  title?: string
}) {
  return (
    <div className="vt-plan-tree">
      {variant === 'editable' && (
        <div className="vt-plan-tree__head">
          <h3 className="vt-plan-tree__head-title">{title}</h3>
          <span className="vt-plan-tree__head-meta">{`Gate · ≥ ${gate} to proceed`}</span>
        </div>
      )}
      {steps.map((s) => {
        const kind = variant === 'editable' ? classifyStep(s.conf, gate) : ''
        const stepClass = ['vt-plan-step', kind ? `vt-plan-step--${kind}` : '']
          .filter(Boolean)
          .join(' ')
        return (
          <div key={s.n} className={stepClass}>
            <span className="vt-plan-step__num">{s.n}</span>
            <div className="vt-plan-step__body">
              <span className="vt-plan-step__title">{s.title}</span>
              {s.detail && <span className="vt-plan-step__detail">{s.detail}</span>}
              {s.meta && <span className="vt-plan-step__meta">{s.meta}</span>}
            </div>
            {variant === 'editable' && s.conf !== undefined && (
              <div className="vt-plan-step__conf">
                <span className="vt-plan-step__conf-num">{s.conf}</span>
                <span className="vt-plan-step__conf-bar">
                  <span style={{ width: `${s.conf}%` }} />
                </span>
              </div>
            )}
            {variant === 'readonly' && s.auth !== undefined && (
              <div className="vt-plan-step__conf">
                <span className={`vt-plan-step__status${s.auth ? ' vt-plan-step__status--authorized' : ''}`}>
                  {s.auth ? 'Authorized' : 'Pending call'}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
