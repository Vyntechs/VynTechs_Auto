import {
  VehicleStrip,
  Module,
  Pill,
  ConfidenceBlock,
  TreeRail,
  CaptureBar,
} from '@/components/vt'
import { formatVehicleName, formatElapsed, nodesToSteps, getActiveNode } from '@/lib/format'
import type { Session } from '@/lib/db/schema'
import { ActiveStepForm } from './active-step-form'
import { AbandonButton } from './abandon-button'
import { LockDiagnosisButton } from './lock-diagnosis-button'

export function DiagnosisProposedReview({ session }: { session: Session }) {
  const active = getActiveNode(session.treeState.nodes)
  const steps = nodesToSteps(session.treeState.nodes)
  const elapsed = formatElapsed(new Date(session.createdAt))
  const proposedAction = session.treeState.proposedAction

  return (
    <div className="app">
      <VehicleStrip
        name={formatVehicleName(session.intake)}
        vin={`Session · ${session.id.slice(0, 8)}`}
        timer={elapsed}
        back={{ href: '/today', label: 'My Jobs' }}
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
          num="✓"
          label="Diagnosis proposed"
          status={<Pill kind="active">Confirm & start repair</Pill>}
        >
          {session.treeState.rootCauseSummary && (
            <h2
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontWeight: 400,
                fontSize: 22,
                lineHeight: 1.25,
                letterSpacing: '-0.02em',
                margin: '0 0 12px',
              }}
            >
              {session.treeState.rootCauseSummary}
            </h2>
          )}
          {session.treeState.message && (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-2)',
                lineHeight: 1.55,
                margin: '0 0 14px',
              }}
            >
              {session.treeState.message}
            </p>
          )}
          {(proposedAction?.description || active?.label) && (
            <div style={{ marginTop: 12 }}>
              <span className="eyebrow">Recommended repair</span>
              <p
                style={{
                  fontFamily: 'var(--vt-font-serif)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: '6px 0 0',
                }}
              >
                {proposedAction?.description ?? active?.label}
              </p>
            </div>
          )}
          {proposedAction?.expectedSignal && (
            <div style={{ marginTop: 14 }}>
              <span className="eyebrow">What to look for after the repair</span>
              <p
                style={{
                  fontFamily: 'var(--vt-font-serif)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: '6px 0 0',
                }}
              >
                {proposedAction.expectedSignal}
              </p>
            </div>
          )}
        </Module>

        {proposedAction?.confidence !== undefined && (
          <Module num="—" label="Confidence">
            <ConfidenceBlock
              value={proposedAction.confidence}
              basis={
                proposedAction.confidenceGap
                  ? `gap: ${proposedAction.confidenceGap}`
                  : 'based on AI reasoning + retrieval'
              }
            />
          </Module>
        )}

        <Module num="—" label="Push back?">
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '0 0 12px',
            }}
          >
            Disagree with the diagnosis? Send another finding and the AI will rethink it.
          </p>
          <ActiveStepForm
            sessionId={session.id}
            nodeId={session.treeState.currentNodeId}
            requestedArtifact={session.treeState.requestedArtifact}
          />
        </Module>

        <Module
          num="—"
          label="Plan"
          status={<span className="eyebrow">{steps.length} steps</span>}
        >
          <TreeRail steps={steps} />
        </Module>

        <Module num="—" label="Lock in & start repair">
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: '0 0 12px',
            }}
          >
            When you've reviewed the diagnosis and you're ready to do the repair, lock it in. The AI will switch to repair mode — it can answer questions while you work but won't change the diagnosis.
          </p>
          <LockDiagnosisButton sessionId={session.id} />
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 13,
              color: 'var(--vt-fg-3)',
              margin: '14px 0 8px',
            }}
          >
            Started by mistake or testing? Mark it incomplete instead — no diagnosis required.
          </p>
          <AbandonButton sessionId={session.id} />
        </Module>
      </div>
      <CaptureBar />
    </div>
  )
}
