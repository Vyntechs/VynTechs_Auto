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
import type { Session, SessionEvent } from '@/lib/db/schema'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import { ActiveStepForm } from './active-step-form'
import { AbandonButton } from './abandon-button'
import { DiagnosisProposedReview } from './diagnosis-proposed-review'
import { RepairPhaseView } from './repair-phase-view'
import { ActiveStepCitations } from './active-step-citations'
import { KnowledgeDrawer } from '@/components/knowledge/drawer'

type Props = {
  session: Session
  events?: SessionEvent[]
  // PR 6: cited knowledge items for the current diagnose step, hydrated
  // server-side from currentNode.citationItemIds. Empty in repair phase
  // and on the proposed-review screen (out of scope for PR 6).
  citedItems?: KnowledgeListRow[]
  // PR 6: the knowledge item currently open in the drawer (from ?detail=
  // in the URL). Null when the drawer is closed.
  drawerItem?: KnowledgeListRow | null
}

export function ActiveSession({
  session,
  events = [],
  citedItems = [],
  drawerItem = null,
}: Props) {
  const phase = session.treeState.phase ?? 'diagnosing'
  const done = session.treeState.done === true

  if (phase === 'repairing') {
    return <RepairPhaseView session={session} events={events} />
  }
  if (phase === 'diagnosing' && done) {
    return <DiagnosisProposedReview session={session} />
  }

  // Diagnosing-active UI (the !done path) — unchanged from d70a357 / 964c377.
  const active = getActiveNode(session.treeState.nodes)
  const steps = nodesToSteps(session.treeState.nodes)
  const elapsed = formatElapsed(new Date(session.createdAt))
  const stepNumber = active
    ? String(session.treeState.nodes.indexOf(active) + 1).padStart(2, '0')
    : '—'
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
          <ActiveStepCitations items={citedItems} />
          <ActiveStepForm
            sessionId={session.id}
            nodeId={session.treeState.currentNodeId}
            requestedArtifact={session.treeState.requestedArtifact}
          />
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
            Done diagnosing? Capture what fixed it and close the case.
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
      <KnowledgeDrawer item={drawerItem} ownerMode={false} />
    </div>
  )
}
