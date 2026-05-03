import {
  VehicleStrip,
  Module,
  Pill,
  Risk,
  ConfidenceBlock,
  TreeRail,
  CaptureBar,
} from '@/components/vt'
import { formatVehicleName, formatElapsed, nodesToSteps, getActiveNode } from '@/lib/format'
import type { Session } from '@/lib/db/schema'
import { ActiveStepForm } from './active-step-form'

export function ActiveSession({ session }: { session: Session }) {
  const active = getActiveNode(session.treeState.nodes)
  const steps = nodesToSteps(session.treeState.nodes)
  const elapsed = formatElapsed(new Date(session.createdAt))
  const stepNumber = active
    ? String(session.treeState.nodes.indexOf(active) + 1).padStart(2, '0')
    : '—'

  return (
    <div className="app">
      <VehicleStrip
        name={formatVehicleName(session.intake)}
        vin={`Session · ${session.id.slice(0, 8)}`}
        timer={elapsed}
      />
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          overflow: 'auto',
        }}
      >
        <Module
          num={stepNumber}
          label="Active step"
          status={<Pill kind="active">In progress</Pill>}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Risk level="low" />
            <span
              style={{
                fontFamily: 'var(--vt-font-mono)',
                fontSize: 10,
                color: 'var(--vt-fg-3)',
              }}
            >
              req. ≥ 70 %
            </span>
          </div>
          <h2
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontWeight: 400,
              fontSize: 22,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
              margin: '0 0 10px',
            }}
          >
            {active?.label ?? 'No active step.'}
          </h2>
          {active?.rationale && (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.5,
                margin: '0 0 14px',
              }}
            >
              {active.rationale}
            </p>
          )}
          {!active?.rationale && session.treeState.message && (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.5,
                margin: '0 0 14px',
              }}
            >
              {session.treeState.message}
            </p>
          )}
          <ActiveStepForm
            sessionId={session.id}
            nodeId={session.treeState.currentNodeId}
            requestedArtifact={session.treeState.requestedArtifact}
          />
        </Module>

        <Module num="—" label="Confidence">
          <ConfidenceBlock value={0.87} basis="47 corpus matches · build-date specific" />
        </Module>

        <Module
          num="—"
          label="Tree"
          status={<span className="eyebrow">{steps.length} steps</span>}
        >
          <TreeRail steps={steps} />
        </Module>
      </div>
      <CaptureBar />
    </div>
  )
}
