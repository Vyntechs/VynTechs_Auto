import Link from 'next/link'
import { VehicleStrip, Module, Pill } from '@/components/vt'
import { formatVehicleName, formatElapsed } from '@/lib/format'
import type { Session, SessionEvent } from '@/lib/db/schema'
import { AbandonButton } from './abandon-button'
import { RepairConversation } from './repair-conversation'
import { RepairAskForm } from './repair-ask-form'

type Props = {
  session: Session
  events: SessionEvent[]
}

export function RepairPhaseView({ session, events }: Props) {
  const elapsed = formatElapsed(new Date(session.createdAt))
  const proposedAction = session.treeState.proposedAction
  const lockedAt = session.treeState.diagnosisLockedAt
  const lockedAtDisplay = lockedAt
    ? new Date(lockedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—'

  const repairEvents = events.filter(
    e => e.eventType === 'repair_observation' || e.eventType === 'repair_guidance',
  )

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
          num="🔒"
          label="Diagnosis locked"
          status={<Pill kind="active">In repair</Pill>}
        >
          <span className="eyebrow" style={{ fontSize: 10, color: 'var(--vt-fg-3)' }}>
            Locked at {lockedAtDisplay}
          </span>
          {session.treeState.rootCauseSummary && (
            <h2
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontWeight: 400,
                fontSize: 20,
                lineHeight: 1.25,
                margin: '4px 0 12px',
              }}
            >
              {session.treeState.rootCauseSummary}
            </h2>
          )}
          {proposedAction?.description && (
            <div style={{ marginTop: 8 }}>
              <span className="eyebrow">Recommended repair</span>
              <p
                style={{
                  fontFamily: 'var(--vt-font-serif)',
                  fontSize: 14,
                  lineHeight: 1.55,
                  margin: '6px 0 0',
                }}
              >
                {proposedAction.description}
              </p>
            </div>
          )}
          {proposedAction?.expectedSignal && (
            <div style={{ marginTop: 12 }}>
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

        <Module num="—" label="Repair conversation">
          {repairEvents.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--vt-font-serif)',
                fontStyle: 'italic',
                fontSize: 14,
                color: 'var(--vt-fg-3)',
                margin: 0,
              }}
            >
              No repair-time questions yet. Ask anything you find while you work.
            </p>
          ) : (
            <RepairConversation events={events} />
          )}
        </Module>

        <Module num="—" label="Ask the AI">
          <RepairAskForm sessionId={session.id} />
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
            Repair done? Verified the fix? Close the case to record the outcome.
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
            Repair done & verified — close case
          </Link>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 13,
              color: 'var(--vt-fg-3)',
              margin: '14px 0 8px',
            }}
          >
            Hit a wall? Mark this case incomplete and start fresh.
          </p>
          <AbandonButton sessionId={session.id} />
        </Module>
      </div>
    </div>
  )
}
