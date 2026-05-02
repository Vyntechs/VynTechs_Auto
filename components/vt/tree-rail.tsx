import type { TreeStep } from './types'

export function TreeRail({ steps }: { steps: TreeStep[] }) {
  return (
    <ol className="tree-rail" aria-label="Diagnostic tree">
      {steps.map((step, i) => (
        <li
          key={step.id ?? i}
          className={`tree-step ${step.status}`}
          aria-current={step.status === 'active' ? 'step' : undefined}
        >
          <span className="node-dot" aria-hidden="true" />
          <span className="num">{String(i + 1).padStart(2, '0')}</span>
          {step.label}
        </li>
      ))}
    </ol>
  )
}
