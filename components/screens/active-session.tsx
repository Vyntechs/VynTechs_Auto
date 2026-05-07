import Link from 'next/link'
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
import { AbandonButton } from './abandon-button'

export function ActiveSession({ session }: { session: Session }) {
  const active = getActiveNode(session.treeState.nodes)
  const steps = nodesToSteps(session.treeState.nodes)
  const elapsed = formatElapsed(new Date(session.createdAt))
  const stepNumber = active
    ? String(session.treeState.nodes.indexOf(active) + 1).padStart(2, '0')
    : '—'
  const done = session.treeState.done === true
  const proposedAction = session.treeState.proposedAction

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
        {done ? (
          <Module
            num="✓"
            label="Diagnosis complete"
            status={<Pill kind="active">Ready to repair</Pill>}
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
                <span className="eyebrow">Expected signal post-repair</span>
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
        ) : (
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
        )}

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

        <Module
          num="—"
          label="Plan"
          status={<span className="eyebrow">{steps.length} steps</span>}
        >
          <TreeRail steps={steps} />
        </Module>

        <Module num="—" label="Close case">
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
            {done
              ? 'Repair done? Verified the fix? Close the case to record the outcome.'
              : 'Done diagnosing? Capture what fixed it and close the case.'}
          </p>
          <Link
            href={`/sessions/${session.id}/outcome`}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              textDecoration: 'none',
            }}
          >
            Close case
          </Link>
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
